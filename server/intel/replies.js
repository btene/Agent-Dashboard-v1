// Reply tracking: reads the connected mailbox over IMAP and matches incoming
// messages to emails this platform sent (by Message-ID / In-Reply-To /
// References, then by recipient + subject as a fallback). Replies update the
// email, the project stage, CRM activity and close any open reminder.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

const PROVIDERS = {
  gmail: { imapHost: 'imap.gmail.com', imapPort: 993, smtpHost: 'smtp.gmail.com', smtpPort: 587, note: 'Requires 2-Step Verification and an App password.' },
  microsoft365: { imapHost: 'outlook.office365.com', imapPort: 993, smtpHost: 'smtp.office365.com', smtpPort: 587, note: 'Microsoft has retired basic (password) authentication for IMAP/SMTP on most tenants; OAuth is needed. Check with your IT admin.' },
  other: { imapHost: '', imapPort: 993, smtpHost: '', smtpPort: 587, note: 'Enter the IMAP and SMTP hosts from your email provider.' },
};
export const EMAIL_PROVIDERS = PROVIDERS;

function normalizeId(id) { return String(id || '').trim().replace(/^<|>$/g, '').toLowerCase(); }

export function createReplyService({ store, bus, settingsService, crmService }) {
  const now = () => new Date().toISOString();

  function imapConfig(settings) {
    const em = settings.email;
    const host = em.imapHost || PROVIDERS[em.provider]?.imapHost;
    if (!host || !em.username || !em.password) return null;
    return { host, port: Number(em.imapPort) || 993, secure: em.imapSecure !== false, auth: { user: em.username, pass: em.password }, logger: false };
  }

  async function testConnection() {
    const settings = settingsService.get();
    const cfg = imapConfig(settings);
    if (!cfg) return { ok: false, error: 'IMAP is not configured (host, username and password are required).' };
    const client = new ImapFlow(cfg);
    try {
      await client.connect();
      const mb = await client.mailboxOpen('INBOX', { readOnly: true });
      await client.logout();
      settingsService.update({ email: { lastImapTestAt: now(), lastImapTestOk: true, lastImapTestError: null } });
      return { ok: true, messages: mb.exists };
    } catch (err) {
      settingsService.update({ email: { lastImapTestAt: now(), lastImapTestOk: false, lastImapTestError: err.message } });
      return { ok: false, error: err.message };
    }
  }

  /** Match one inbound message to a sent email. Returns the email or null. */
  function matchSent(parsed, sentEmails) {
    const refs = [parsed.inReplyTo, ...(Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [])].map(normalizeId).filter(Boolean);
    const byId = sentEmails.find((e) => e.messageId && refs.includes(normalizeId(e.messageId)));
    if (byId) return { email: byId, how: 'message-id' };
    const from = (parsed.from?.value || []).map((a) => a.address?.toLowerCase()).filter(Boolean);
    const subject = String(parsed.subject || '').replace(/^(re|fwd?|aw|sv):\s*/gi, '').trim().toLowerCase();
    const bySubject = sentEmails.find((e) => e.to && from.includes(e.to.toLowerCase()) && e.subject && subject === e.subject.trim().toLowerCase());
    return bySubject ? { email: bySubject, how: 'sender+subject' } : null;
  }

  function recordReply(email, parsed, how) {
    const at = now();
    const snippet = String(parsed.text || '').replace(/\s+/g, ' ').slice(0, 600);
    email.history.push({ at, event: 'replied', by: 'inbox', how, from: parsed.from?.text, receivedAt: parsed.date?.toISOString?.() || null });
    store.update('emails', email.id, { status: 'replied', repliedAt: at, updatedAt: at, reply: { from: parsed.from?.text || null, subject: parsed.subject || null, receivedAt: parsed.date?.toISOString?.() || at, snippet, matchedBy: how } });
    const project = store.get('projects', email.projectId);
    if (project && ['contacted', 'discovered', 'verified', 'researching'].includes(project.stage)) store.update('projects', email.projectId, { stage: 'replied', updatedAt: at });
    store.insert('activities', { id: store.newId('act'), type: 'reply_received', projectId: email.projectId, contactId: email.contactId, emailId: email.id, at, summary: `Reply from ${parsed.from?.text || 'unknown'}: "${snippet.slice(0, 120)}"` });
    if (email.contactId) { const c = store.get('contacts', email.contactId); if (c) store.update('contacts', c.id, { lastRepliedAt: at, lastVerifiedAt: at, emailVerification: { ...(c.emailVerification || {}), status: 'valid', method: 'replied', checkedAt: at } }); }
    store.list('reminders').filter((r) => r.emailId === email.id && r.status === 'open').forEach((r) => store.update('reminders', r.id, { status: 'done', doneAt: at, closedBy: 'reply' }));
    bus.publish('email.replied', { id: email.id, projectId: email.projectId });
  }

  /** Check the inbox for replies to anything we sent. */
  async function checkInbox({ sinceDays = 30 } = {}) {
    const settings = settingsService.get();
    const cfg = imapConfig(settings);
    if (!cfg) throw Object.assign(new Error('No mailbox connected for reply tracking. Add IMAP details under Settings → Email account.'), { status: 409 });
    const sent = store.list('emails').filter((e) => e.status === 'sent' || e.status === 'replied');
    const openSent = sent.filter((e) => e.status === 'sent');
    const seenUids = new Set(settings.email.seenUids || []);
    const client = new ImapFlow(cfg);
    const result = { scanned: 0, matched: 0, newReplies: 0, errors: [] };
    await client.connect();
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const since = new Date(Math.min(Date.now() - sinceDays * 86_400_000, ...openSent.map((e) => Date.parse(e.sentAt || e.createdAt))));
        for await (const msg of client.fetch({ since }, { uid: true, envelope: true, source: true })) {
          result.scanned++;
          if (seenUids.has(msg.uid)) continue;
          try {
            const parsed = await simpleParser(msg.source);
            const hit = matchSent(parsed, sent);
            if (hit) {
              result.matched++;
              if (hit.email.status !== 'replied') { recordReply(hit.email, parsed, hit.how); result.newReplies++; }
            }
          } catch (err) { result.errors.push(`uid ${msg.uid}: ${err.message}`); }
          seenUids.add(msg.uid);
        }
      } finally { lock.release(); }
    } finally { await client.logout().catch(() => {}); }
    settingsService.update({ email: { seenUids: Array.from(seenUids).slice(-5000), lastInboxCheckAt: now(), lastInboxResult: result } });
    return result;
  }

  return { testConnection, checkInbox, matchSent, EMAIL_PROVIDERS };
}
