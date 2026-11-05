// Outreach: three email styles, drafts built only from verified project facts,
// an approval workflow, and sending through the connected SMTP account.
import nodemailer from 'nodemailer';
import { NOT_YET_VERIFIED } from './projects.js';

export const EMAIL_STYLES = {
  short_direct: { label: 'Short and direct', audience: 'Developers and general contractors' },
  relationship: { label: 'Professional and relationship-focused', audience: 'Property owners and asset managers' },
  bid_response: { label: 'Bid opportunity response', audience: 'Procurement teams and construction estimators' },
};

export const EMAIL_STATUSES = ['draft', 'pending_approval', 'approved', 'scheduled', 'sent', 'failed', 'rejected', 'replied'];

/**
 * Collect the only facts a draft may reference. Each fact must come from a
 * verified source field; nothing else is interpolated. Missing facts are
 * reported so the UI can explain why a draft is thin or blocked.
 */
export function verifiedFacts(project, contact) {
  const ok = (f) => project[f] != null && ['government', 'third_party', 'user'].includes(project.provenance?.[f]);
  const facts = {
    projectName: ok('projectName') ? project.projectName : null,
    address: ok('streetAddress') ? project.streetAddress : ok('address') ? project.address : null,
    city: ok('city') ? project.city : null,
    permitNumber: ok('permitNumber') ? project.permitNumber : null,
    description: ok('description') ? project.description : null,
    status: ok('status') ? project.status : null,
    issuedAt: ok('issuedAt') ? project.issuedAt.slice(0, 10) : null,
    bidDeadline: ok('bidDeadline') ? project.bidDeadline.slice(0, 10) : null,
    firstName: contact?.firstName || null,
    company: contact?.company || project.generalContractor || project.applicant || project.propertyOwner || null,
  };
  const missing = Object.entries(facts).filter(([, v]) => v == null).map(([k]) => k);
  return { facts, missing };
}

/** Qualifications approved for outreach, taken from reviewed documents only. */
export function approvedCredentials(documents) {
  return documents
    .filter((d) => d.approvedForOutreach && d.reviewStatus === 'approved' && d.statusVerified && d.status === 'current')
    .map((d) => d.outreachSummary || `${d.typeLabel}${d.extracted?.licenseNumber ? ` #${d.extracted.licenseNumber}` : ''}`);
}

function projectLabel(f) {
  // Never invent a project name: fall back to the address, then the permit number.
  if (f.projectName) return f.projectName;
  if (f.address) return `the project at ${f.address}`;
  if (f.permitNumber) return `permit ${f.permitNumber}`;
  return 'your upcoming project';
}

export function renderEmail({ style = 'short_direct', project, contact, company, credentials = [] }) {
  const { facts, missing } = verifiedFacts(project, contact);
  const label = projectLabel(facts);
  const subjectName = facts.projectName || facts.address || (facts.permitNumber ? `Permit ${facts.permitNumber}` : 'Upcoming project');
  const where = facts.city ? ` in ${facts.city}` : '';
  const greeting = facts.firstName ? `Hi ${facts.firstName},` : 'Hello,';
  const sender = company?.senderName || '[Your name]';
  const co = company?.name || 'Advanced Landscape 2000';
  const creds = credentials.length ? `\n\n${co} is ${credentials.join('; ')}.` : '';
  const sig = `\n\nBest,\n${sender}${company?.senderTitle ? `\n${company.senderTitle}` : ''}\n${co}${company?.phone ? `\n${company.phone}` : ''}${company?.website ? `\n${company.website}` : ''}`;

  let subject; let body;
  if (style === 'relationship') {
    subject = `Landscape partnership — ${subjectName}`;
    body = `${greeting}\n\nI noticed ${label}${where} and wanted to introduce ${co}. We build and maintain commercial landscapes for property owners and asset managers across Southern California, with an emphasis on long-term plant health, water efficiency and curb appeal that protects asset value.${creds}\n\nIf landscape construction or ongoing maintenance for this property has not been finalised, I would welcome a short conversation about how we could support it.\n\nWould you be open to a brief call, or could you point me to the right person on your team?${sig}`;
  } else if (style === 'bid_response') {
    subject = `Landscape bid — ${subjectName}`;
    const deadline = facts.bidDeadline ? ` We note the bid date of ${facts.bidDeadline}.` : '';
    body = `${greeting}\n\n${co} would like to be included on the bid list for the landscape and irrigation scope of ${label}${where}.${deadline}${creds}\n\nWe self-perform commercial landscape construction, irrigation and ongoing maintenance throughout Southern California and can provide a complete proposal from the landscape drawings and specifications.\n\nCould you send the bid documents or let us know how to register as a bidder?${sig}`;
  } else {
    subject = `Landscaping — ${subjectName}`;
    body = `${greeting}\n\nI came across ${label}${where} and wanted to introduce ${co}.\n\nWe handle commercial landscape construction and ongoing maintenance throughout Southern California.${creds}\n\nI'd welcome the opportunity to review the landscape scope and see whether we could provide a competitive proposal.\n\nAre you the right person to coordinate with?${sig}`;
  }
  return { subject, body, factsUsed: Object.fromEntries(Object.entries(facts).filter(([, v]) => v != null)), missingFacts: missing };
}

/** Phrases a draft must never contain because they would assert an unverified relationship. */
export const FORBIDDEN_CLAIMS = [/as discussed/i, /per our (conversation|call)/i, /you (asked|requested|invited)/i, /was referred/i, /referred (me|us)/i, /following up on our/i, /thanks for (your|the) (call|time|meeting)/i, /invited to bid/i, /\bRFP\b.*received/i];

export function checkDraft(text) {
  const hits = FORBIDDEN_CLAIMS.filter((re) => re.test(text)).map((re) => re.source);
  return { ok: hits.length === 0, hits };
}

export function createEmailService({ store, bus, settingsService }) {
  const now = () => new Date().toISOString();

  function createDraft({ projectId, contactId, style, trigger = 'manual' }) {
    const project = store.get('projects', projectId);
    if (!project) throw Object.assign(new Error('Project not found'), { status: 404 });
    if (project.environment === 'demo') throw Object.assign(new Error('Demo projects cannot enter the outreach queue.'), { status: 403 });
    const contact = contactId ? store.get('contacts', contactId) : null;
    if (contactId && !contact) throw Object.assign(new Error('Contact not found'), { status: 404 });
    if (contact && contact.environment === 'demo') throw Object.assign(new Error('Demo contacts cannot be emailed.'), { status: 403 });
    const settings = settingsService.get();
    const useStyle = style || settings.outreach.defaultStyle || 'short_direct';
    const credentials = approvedCredentials(store.list('documents'));
    const rendered = renderEmail({ style: useStyle, project, contact, company: settings.company, credentials });
    const email = store.insert('emails', {
      id: store.newId('eml'), projectId, contactId: contact?.id || null, to: contact?.email || null, toName: contact ? `${contact.firstName || ''} ${contact.lastName || ''}`.trim() : null,
      style: useStyle, subject: rendered.subject, body: rendered.body, factsUsed: rendered.factsUsed, missingFacts: rendered.missingFacts,
      status: 'pending_approval', trigger, environment: 'live', attachments: [], createdAt: now(), updatedAt: now(), approvedAt: null, sentAt: null, error: null, repliedAt: null, history: [{ at: now(), event: 'drafted', by: trigger }],
    });
    bus.publish('email.drafted', { id: email.id, projectId });
    return email;
  }

  function update(id, patch) {
    const e = store.get('emails', id);
    if (!e) throw Object.assign(new Error('Email not found'), { status: 404 });
    if (['sent'].includes(e.status)) throw Object.assign(new Error('Sent emails cannot be edited'), { status: 409 });
    const next = {};
    for (const k of ['subject', 'body', 'to', 'toName', 'style']) if (typeof patch[k] === 'string') next[k] = patch[k];
    if (next.body) {
      const check = checkDraft(`${next.subject || e.subject}\n${next.body}`);
      if (!check.ok) throw Object.assign(new Error(`The draft claims a relationship that is not on record (${check.hits.join(', ')}). Remove that wording before saving.`), { status: 400 });
    }
    if (Array.isArray(patch.attachments)) {
      // Only documents explicitly approved for outreach may be attached; never automatically.
      const docs = store.list('documents');
      for (const docId of patch.attachments) {
        const d = docs.find((x) => x.id === docId);
        if (!d) throw Object.assign(new Error(`Document ${docId} not found`), { status: 400 });
        if (!d.approvedForOutreach || d.sensitive) throw Object.assign(new Error(`"${d.title}" is not approved for sending to prospects`), { status: 400 });
      }
      next.attachments = patch.attachments;
    }
    next.updatedAt = now();
    e.history.push({ at: next.updatedAt, event: 'edited', by: 'user' });
    return store.update('emails', id, next);
  }

  function approve(id, { by = 'user' } = {}) {
    const e = store.get('emails', id);
    if (!e) throw Object.assign(new Error('Email not found'), { status: 404 });
    if (!['pending_approval', 'draft', 'rejected', 'failed'].includes(e.status)) throw Object.assign(new Error(`Email is ${e.status}`), { status: 409 });
    if (!e.to) throw Object.assign(new Error('Add a recipient email address before approving.'), { status: 400 });
    const check = checkDraft(`${e.subject}\n${e.body}`);
    if (!check.ok) throw Object.assign(new Error(`Draft claims an unverified relationship (${check.hits.join(', ')})`), { status: 400 });
    e.history.push({ at: now(), event: 'approved', by });
    const updated = store.update('emails', id, { status: 'approved', approvedAt: now(), updatedAt: now(), error: null });
    bus.publish('email.approved', { id });
    return updated;
  }

  function reject(id, reason = '') {
    const e = store.get('emails', id);
    if (!e) throw Object.assign(new Error('Email not found'), { status: 404 });
    e.history.push({ at: now(), event: 'rejected', by: 'user', reason });
    return store.update('emails', id, { status: 'rejected', updatedAt: now() });
  }

  function transporter(settings) {
    const em = settings.email;
    if (!em?.smtpHost || !em?.username || !em?.password || !em?.address) return null;
    return nodemailer.createTransport({ host: em.smtpHost, port: Number(em.smtpPort) || 587, secure: Boolean(em.smtpSecure), auth: { user: em.username, pass: em.password } });
  }

  async function testConnection() {
    const settings = settingsService.get();
    const t = transporter(settings);
    if (!t) return { ok: false, error: 'Email account is not fully configured (address, SMTP host, username and password are required).' };
    try {
      await t.verify();
      settingsService.update({ email: { lastTestAt: now(), lastTestOk: true, lastTestError: null, connectedAt: settings.email.connectedAt || now() } });
      return { ok: true };
    } catch (err) {
      settingsService.update({ email: { lastTestAt: now(), lastTestOk: false, lastTestError: err.message } });
      return { ok: false, error: err.message };
    }
  }

  /** Send one approved email. Honors the master switch, pause-all and the daily limit. */
  async function send(id, { by = 'user', force = false } = {}) {
    const e = store.get('emails', id);
    if (!e) throw Object.assign(new Error('Email not found'), { status: 404 });
    if (e.status !== 'approved') throw Object.assign(new Error('Only approved emails can be sent'), { status: 409 });
    const settings = settingsService.get();
    if (settings.pauseAll) throw Object.assign(new Error('All automations are paused. Resume them to send.'), { status: 409 });
    if (!force && !settings.automations.email_sending?.enabled) throw Object.assign(new Error('Automated email sending is switched off in the Automation Control Center.'), { status: 409 });
    const sentToday = store.list('emails').filter((x) => x.status === 'sent' && x.sentAt?.slice(0, 10) === now().slice(0, 10)).length;
    if (sentToday >= (settings.outreach.dailySendLimit || 20)) throw Object.assign(new Error(`Daily send limit of ${settings.outreach.dailySendLimit} reached`), { status: 429 });
    const t = transporter(settings);
    if (!t) {
      const err = 'No email account connected. Connect one in Settings → Email account.';
      store.update('emails', id, { status: 'failed', error: err, updatedAt: now() });
      throw Object.assign(new Error(err), { status: 409 });
    }
    const attachments = (e.attachments || []).map((docId) => store.get('documents', docId)).filter((d) => d && d.approvedForOutreach && !d.sensitive).map((d) => ({ filename: d.filename, path: d.storagePath, encrypted: true, docId: d.id }));
    try {
      const info = await t.sendMail({ from: `"${settings.company.senderName || settings.company.name}" <${settings.email.address}>`, to: e.to, subject: e.subject, text: e.body, attachments: attachments.length ? await decryptAttachments(attachments) : undefined });
      e.history.push({ at: now(), event: 'sent', by, messageId: info.messageId });
      const updated = store.update('emails', id, { status: 'sent', sentAt: now(), updatedAt: now(), messageId: info.messageId, error: null });
      const project = store.get('projects', e.projectId);
      if (project && ['discovered', 'verified', 'researching'].includes(project.stage)) store.update('projects', e.projectId, { stage: 'contacted', updatedAt: now() });
      store.insert('activities', { id: store.newId('act'), type: 'email_sent', projectId: e.projectId, contactId: e.contactId, emailId: e.id, at: now(), summary: `Sent "${e.subject}" to ${e.to}` });
      bus.publish('email.sent', { id, projectId: e.projectId });
      return updated;
    } catch (err) {
      e.history.push({ at: now(), event: 'failed', error: err.message });
      store.update('emails', id, { status: 'failed', error: err.message, updatedAt: now() });
      throw Object.assign(new Error(`Sending failed: ${err.message}`), { status: 502 });
    }
  }

  async function decryptAttachments(list) {
    const { readDocumentBuffer } = await import('./documents.js');
    return Promise.all(list.map(async (a) => ({ filename: a.filename, content: await readDocumentBuffer(store.get('documents', a.docId)) })));
  }

  function markReplied(id) {
    const e = store.get('emails', id);
    if (!e) throw Object.assign(new Error('Email not found'), { status: 404 });
    e.history.push({ at: now(), event: 'replied', by: 'user' });
    store.update('emails', id, { status: 'replied', repliedAt: now(), updatedAt: now() });
    const project = store.get('projects', e.projectId);
    if (project && ['contacted', 'discovered', 'verified', 'researching'].includes(project.stage)) store.update('projects', e.projectId, { stage: 'replied', updatedAt: now() });
    store.list('reminders').filter((r) => r.emailId === id && r.status === 'open').forEach((r) => store.update('reminders', r.id, { status: 'done', doneAt: now() }));
    return store.get('emails', id);
  }

  return { createDraft, update, approve, reject, send, testConnection, markReplied, renderEmail, EMAIL_STYLES };
}
