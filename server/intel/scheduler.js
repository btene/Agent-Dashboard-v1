// Background jobs for each automation. Each job records its status, last
// success, last error and next scheduled run so the Control Center can show
// them. Nothing runs while "Pause all" is on or the mode is Manual.
import { AUTOMATIONS } from './settings.js';
import { POLL_OPTIONS } from './sources.js';

const INTERVAL_MS = Object.fromEntries(POLL_OPTIONS.map((o) => [o.id, o.hours ? o.hours * 3_600_000 : null]));

export function createScheduler({ store, bus, settingsService, sourceService, emailService, crmService, tickMs = 60_000, autoStart = true }) {
  const state = Object.fromEntries(AUTOMATIONS.map((a) => [a.id, { id: a.id, status: 'idle', lastRunAt: null, lastSuccessAt: null, lastError: null, nextRunAt: null, lastSummary: null, running: false }]));
  let timer = null;
  const now = () => new Date().toISOString();

  function record(id, patch) {
    Object.assign(state[id], patch);
    bus.publish('automation.updated', state[id]);
  }

  function finishRun(id, startedAt, result) {
    const finishedAt = now();
    store.insert('jobRuns', { id: store.newId('job'), automationId: id, startedAt, finishedAt, ok: !result.error, summary: result.summary || null, error: result.error || null, trigger: result.trigger || 'schedule' });
    record(id, { running: false, status: result.error ? 'error' : 'ok', lastRunAt: finishedAt, lastSuccessAt: result.error ? state[id].lastSuccessAt : finishedAt, lastError: result.error || null, lastSummary: result.summary || null });
  }

  // ---- Job implementations -------------------------------------------------
  const jobs = {
    async permit_monitoring({ trigger }) {
      const sources = sourceService.list().filter((s) => s.enabled && s.connectorSupported);
      if (!sources.length) return { summary: 'No API-connected sources are enabled.' };
      const parts = [];
      let errors = 0;
      for (const s of sources) {
        const r = await sourceService.runSource(s.id, { trigger });
        if (r.ok) parts.push(`${s.name}: ${r.created} new, ${r.updated} changed`);
        else { errors++; parts.push(`${s.name}: ${r.error}`); }
      }
      return { summary: parts.join(' · '), error: errors === sources.length ? 'Every connected source failed. See Integrations for details.' : null };
    },
    async project_discovery() {
      // Re-score live projects against the current preferences so the dashboard reflects any changed rules.
      const { scoreProject, tierFor } = await import('./scoring.js');
      const settings = settingsService.get();
      let n = 0;
      for (const p of store.list('projects')) {
        if (p.environment !== 'live') continue;
        const score = scoreProject(p, settings);
        if (score.total !== p.score?.total) { store.update('projects', p.id, { score, tier: tierFor(score.total).key, updatedAt: now() }); n++; }
      }
      return { summary: `${n} project score${n === 1 ? '' : 's'} updated` };
    },
    async constructconnect_import() {
      const pending = store.list('imports').filter((i) => i.status === 'preview' && i.sourceId === 'constructconnect').length;
      return { summary: pending ? `${pending} ConstructConnect upload${pending > 1 ? 's' : ''} waiting for column mapping` : 'No pending uploads. Imports are processed when you upload a file.' };
    },
    async other_platform_integrations() {
      const pending = store.list('imports').filter((i) => i.status === 'preview' && i.sourceId !== 'constructconnect').length;
      return { summary: pending ? `${pending} upload${pending > 1 ? 's' : ''} waiting for column mapping` : 'No pending uploads.' };
    },
    async developer_research() {
      let flagged = 0;
      for (const p of store.list('projects')) {
        if (p.environment !== 'live' || p.classification?.excluded) continue;
        if (!p.applicant && !p.generalContractor && !p.propertyOwner && p.stage === 'verified' && (p.score?.total || 0) >= (settingsService.get().scoring.minScoreForOutreach || 60)) {
          store.update('projects', p.id, { stage: 'researching', updatedAt: now() });
          store.insert('activities', { id: store.newId('act'), type: 'research', projectId: p.id, at: now(), summary: 'Developer, owner and contractor are not in the permit record. Look them up on the agency record page or a licensed provider and add them here.' });
          flagged++;
        }
      }
      return { summary: `${flagged} project${flagged === 1 ? '' : 's'} flagged for research. No research provider is connected, so names are not filled in automatically.` };
    },
    async contact_enrichment() {
      const missing = store.list('contacts').filter((c) => c.environment === 'live' && !c.email).length;
      return { summary: `${missing} contact${missing === 1 ? '' : 's'} missing an email address. No enrichment provider is connected, so nothing was looked up.` };
    },
    async ai_email_drafting({ trigger }) {
      const settings = settingsService.get();
      const min = settings.scoring.minScoreForOutreach || 60;
      const drafted = new Set(store.list('emails').map((e) => `${e.projectId}:${e.contactId}`));
      let n = 0;
      for (const p of store.list('projects')) {
        if (p.environment !== 'live' || p.classification?.excluded || (p.score?.total || 0) < min || !['verified', 'researching', 'discovered'].includes(p.stage)) continue;
        const contacts = store.list('contacts').filter((c) => c.environment === 'live' && c.email && !c.optedOut && c.projectIds?.includes(p.id));
        for (const c of contacts) {
          if (drafted.has(`${p.id}:${c.id}`)) continue;
          emailService.createDraft({ projectId: p.id, contactId: c.id, trigger });
          n++;
        }
      }
      return { summary: `${n} new draft${n === 1 ? '' : 's'} waiting for approval` };
    },
    async email_sending({ trigger }) {
      const settings = settingsService.get();
      if (settings.mode !== 'automatic') return { summary: 'Sending without per-email approval only happens in Automatic mode. Approved emails are sent when you press Send.' };
      const minScore = settings.outreach.autoSendMinScore || 80;
      let sent = 0; let failed = 0; const errors = [];
      for (const e of store.list('emails').filter((x) => x.status === 'approved')) {
        const p = store.get('projects', e.projectId);
        if (!p || (p.score?.total || 0) < minScore) continue;
        try { await emailService.send(e.id, { by: trigger }); sent++; } catch (err) { failed++; errors.push(err.message); if (/No email account|limit|paused|switched off/.test(err.message)) break; }
      }
      return { summary: `${sent} sent, ${failed} failed`, error: failed && !sent ? errors[0] : null };
    },
    async follow_up_reminders() {
      const n = crmService.createFollowUpReminders(settingsService.get().outreach.followUpDays || 5);
      return { summary: `${n} reminder${n === 1 ? '' : 's'} created` };
    },
    async crm_sync() {
      let n = 0;
      for (const p of store.list('projects')) if (p.environment === 'live') { crmService.recountContacts(p.id); n++; }
      for (const name of new Set(store.list('projects').filter((p) => p.environment === 'live').flatMap((p) => [p.generalContractor, p.applicant, p.propertyOwner]).filter(Boolean))) {
        if (!store.list('companies').some((c) => c.name.toLowerCase() === name.toLowerCase())) crmService.upsertCompany({ name, type: 'other', provenance: 'government', sourceNote: 'Named on a permit record' });
      }
      bus.publish('crm.synced', { projects: n });
      return { summary: `${n} project${n === 1 ? '' : 's'} synchronised with the CRM` };
    },
  };

  async function run(id, { trigger = 'schedule', force = false } = {}) {
    if (!jobs[id]) throw Object.assign(new Error('Unknown automation'), { status: 404 });
    const settings = settingsService.get();
    const conf = settings.automations[id];
    if (!force) {
      if (settings.pauseAll) return { skipped: 'All automations are paused.' };
      if (!conf?.enabled) return { skipped: 'This automation is switched off.' };
      if (settings.mode === 'manual' && trigger === 'schedule') return { skipped: 'Manual mode — nothing runs on a schedule.' };
      if (id === 'email_sending' && settings.mode !== 'automatic') return { skipped: 'Emails are only sent automatically in Automatic mode.' };
    }
    if (state[id].running) return { skipped: 'Already running.' };
    const startedAt = now();
    record(id, { running: true, status: 'running' });
    try {
      const result = await jobs[id]({ trigger });
      finishRun(id, startedAt, { ...result, trigger });
      return state[id];
    } catch (err) {
      finishRun(id, startedAt, { error: err.message, trigger });
      return state[id];
    }
  }

  function computeNext(id, settings) {
    const conf = settings.automations[id];
    if (settings.pauseAll || !conf?.enabled || settings.mode === 'manual') return null;
    if (id === 'email_sending' && settings.mode !== 'automatic') return null;
    const ms = INTERVAL_MS[conf.interval || 'daily'];
    if (!ms) return null;
    const last = state[id].lastRunAt ? Date.parse(state[id].lastRunAt) : 0;
    return new Date(Math.max(Date.now(), last + ms)).toISOString();
  }

  async function tick() {
    const settings = settingsService.get();
    for (const a of AUTOMATIONS) {
      const next = computeNext(a.id, settings);
      state[a.id].nextRunAt = next;
      if (next && Date.parse(next) <= Date.now() && !state[a.id].running) {
        state[a.id].lastRunAt = now(); // claim the slot so a slow job isn't re-queued by the next tick
        run(a.id, { trigger: 'schedule' }).catch((err) => console.error(`[scheduler] ${a.id}:`, err.message));
      }
    }
  }

  function snapshot() {
    const settings = settingsService.get();
    return AUTOMATIONS.map((a) => ({ ...a, ...state[a.id], nextRunAt: computeNext(a.id, settings), config: settings.automations[a.id], recentRuns: store.list('jobRuns').filter((r) => r.automationId === a.id).slice(-5).reverse() }));
  }

  function start() { if (!timer) { timer = setInterval(() => tick().catch(() => {}), tickMs); timer.unref?.(); } }
  function stop() { clearInterval(timer); timer = null; }
  if (autoStart) start();

  return { run, tick, snapshot, start, stop, jobs: Object.keys(jobs) };
}
