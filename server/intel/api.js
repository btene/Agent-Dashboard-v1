// REST routes for the construction-intelligence platform. Mounted under /api/v1.
import express from 'express';
import { presentProject, PIPELINE_STAGES, PROVENANCE, NOT_YET_VERIFIED } from './projects.js';
import { scoreProject, tierFor, SCORE_CATEGORIES } from './scoring.js';
import { PROJECT_TYPE_LABELS } from './classify.js';
import { AUTOMATIONS, MODES, ONBOARDING_STEPS } from './settings.js';
import { POLL_OPTIONS } from './sources.js';
import { IMPORT_TARGET_FIELDS } from './connectors/csvImport.js';
import { EMAIL_STYLES, EMAIL_STATUSES } from './email.js';
import { DOCUMENT_TYPES, ROLES, roleRank } from './documents.js';
import { CONTACT_ROLES, COMPANY_TYPES } from './crm.js';
import { seedDemoProjects, clearDemoProjects } from './demo.js';
import { computeDashboard } from './dashboard.js';

const err = (status, message) => Object.assign(new Error(message), { status });

export function createIntelApi({ store, bus, settingsService, sourceService, emailService, documentService, crmService, scheduler, replyService, researchService }) {
  const api = express.Router();
  const now = () => new Date().toISOString();
  const requireRole = (role) => (req, res, next) => (roleRank(req.role || 'owner') >= roleRank(role) ? next() : next(err(403, `This action needs the ${role} role`)));

  // ---- Reference data ---------------------------------------------------
  api.get('/reference', (req, res) => res.json({
    automations: AUTOMATIONS, modes: MODES, onboardingSteps: ONBOARDING_STEPS, pollOptions: POLL_OPTIONS, pipelineStages: PIPELINE_STAGES, provenance: PROVENANCE,
    notYetVerified: NOT_YET_VERIFIED, scoreCategories: SCORE_CATEGORIES, projectTypes: PROJECT_TYPE_LABELS, importFields: IMPORT_TARGET_FIELDS, emailStyles: EMAIL_STYLES,
    emailStatuses: EMAIL_STATUSES, documentTypes: DOCUMENT_TYPES, roles: ROLES, contactRoles: CONTACT_ROLES, companyTypes: COMPANY_TYPES, role: req.role || 'owner',
  }));

  // ---- Settings / onboarding --------------------------------------------
  api.get('/settings', (req, res) => res.json(settingsService.publicView()));
  api.patch('/settings', requireRole('owner'), (req, res) => {
    const patch = { ...req.body };
    delete patch.id; delete patch.createdAt;
    if (patch.mode && !MODES[patch.mode]) throw err(400, 'Unknown mode');
    if (patch.email?.password === '••••••••') delete patch.email.password;
    const s = settingsService.update(patch);
    bus.publish('settings.updated', { keys: Object.keys(patch) });
    res.json(settingsService.publicView(s));
  });
  api.post('/settings/email/test', requireRole('owner'), async (req, res) => res.json(await emailService.testConnection()));
  api.post('/settings/email/test-imap', requireRole('owner'), async (req, res) => res.json(await replyService.testConnection()));
  api.post('/inbox/check', requireRole('staff'), async (req, res) => res.json(await replyService.checkInbox({ sinceDays: Number(req.body?.sinceDays) || 30 })));
  api.get('/email-providers', (req, res) => res.json(replyService.EMAIL_PROVIDERS));

  // ---- Decision-maker research -----------------------------------------
  api.get('/providers', (req, res) => {
    const s = settingsService.publicView();
    res.json(Object.entries(researchService.PROVIDER_INFO).map(([id, info]) => ({ ...info, config: s.providers?.[id] || { enabled: false } })));
  });
  api.patch('/providers/:id', requireRole('owner'), (req, res) => {
    if (!researchService.PROVIDER_INFO[req.params.id]) throw err(404, 'Unknown provider');
    const patch = {};
    if (req.body.enabled !== undefined) patch.enabled = Boolean(req.body.enabled);
    for (const c of researchService.PROVIDER_INFO[req.params.id].credentials) if (typeof req.body[c.key] === 'string' && req.body[c.key] !== '••••••••') patch[c.key] = req.body[c.key].trim();
    settingsService.update({ providers: { [req.params.id]: patch } });
    const s = settingsService.publicView();
    res.json({ ...researchService.PROVIDER_INFO[req.params.id], config: s.providers[req.params.id] });
  });
  api.post('/providers/:id/test', requireRole('owner'), async (req, res) => {
    const id = req.params.id;
    const { PROVIDERS } = await import('./providers/index.js');
    if (!PROVIDERS[id]) throw err(404, 'Unknown provider');
    const cfg = settingsService.get().providers[id];
    if (!PROVIDERS[id].isConfigured(cfg)) return res.json({ ok: false, error: 'Credentials are missing.' });
    try {
      const r = await PROVIDERS[id].enrichCompany(cfg, { domain: 'constructconnect.com', name: 'ConstructConnect' });
      res.json({ ok: true, detail: r ? `Connected. Test lookup returned "${r.name}".` : 'Connected (test lookup returned no match, which is fine).' });
    } catch (e) { res.json({ ok: false, error: e.message }); }
  });
  api.post('/projects/:id/research', requireRole('staff'), async (req, res) => res.json(await researchService.findDecisionMakers({ projectId: req.params.id, domain: req.body?.domain, trigger: 'manual' })));
  api.get('/projects/:id/research', (req, res) => {
    const p = store.get('projects', req.params.id);
    if (!p) throw err(404, 'Project not found');
    const companies = researchService.companiesFor(p).map((c) => ({ ...c, company: c.company ? { id: c.company.id, domain: c.company.domain, website: c.company.website } : null, relationship: researchService.relationshipFor(c.name, p.environment), linkedin: researchService.linkedinLinks({ company: c.name, titles: researchService.titleSetFor(p.classification?.opportunityType).slice(0, 4).flatMap((g) => g.titles.slice(0, 1)) }) }));
    const runs = store.list('researchRuns').filter((r) => r.projectId === p.id).slice(-5).reverse();
    res.json({ projectId: p.id, opportunityType: p.classification?.opportunityType, titlePriorities: researchService.titleSetFor(p.classification?.opportunityType).map((g) => g.label), companies, candidates: researchService.candidatesFor({ projectId: p.id }), runs });
  });
  api.post('/companies/:id/research', requireRole('staff'), async (req, res) => res.json(await researchService.findDecisionMakers({ companyId: req.params.id, domain: req.body?.domain, trigger: 'manual' })));
  api.post('/companies/:id/enrich', requireRole('staff'), async (req, res) => res.json(await researchService.enrichCompany(req.params.id)));
  api.get('/companies/:id', (req, res) => {
    const c = store.get('companies', req.params.id);
    if (!c) throw err(404, 'Company not found');
    const projects = store.list('projects').filter((p) => p.environment === c.environment && [p.generalContractor, p.applicant, p.propertyOwner].some((n) => n && n.toLowerCase() === c.name.toLowerCase())).map((p) => ({ id: p.id, displayName: p.displayName, city: p.city, score: p.score?.total, stage: p.stage, role: p.generalContractor?.toLowerCase() === c.name.toLowerCase() ? 'general contractor' : p.applicant?.toLowerCase() === c.name.toLowerCase() ? 'developer / applicant' : 'property owner' }));
    res.json({ ...c, projects, relationship: researchService.relationshipFor(c.name, c.environment), candidates: researchService.candidatesFor({ companyId: c.id }), contacts: store.list('contacts').filter((x) => x.companyId === c.id || (x.company || '').toLowerCase() === c.name.toLowerCase()), linkedin: researchService.linkedinLinks({ company: c.name, titles: researchService.titleSetFor('both').slice(0, 6).flatMap((g) => g.titles.slice(0, 1)) }) });
  });
  api.patch('/companies/:id', requireRole('staff'), (req, res) => { const c = store.get('companies', req.params.id); if (!c) throw err(404, 'Company not found'); const patch = {}; for (const k of ['name', 'type', 'website', 'domain', 'phone', 'address', 'notes', 'linkedinUrl']) if (typeof req.body[k] === 'string') patch[k] = req.body[k].trim() || null; if (patch.website && !patch.domain) patch.domain = patch.website.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, ''); res.json(store.update('companies', c.id, { ...patch, updatedAt: now() })); });
  api.get('/candidates', (req, res) => res.json(researchService.candidatesFor({ projectId: req.query.projectId, companyId: req.query.companyId })));
  api.post('/candidates/:id/reveal', requireRole('staff'), async (req, res) => res.json(await researchService.revealCandidate(req.params.id)));
  api.post('/candidates/:id/verify-email', requireRole('staff'), async (req, res) => res.json(await researchService.verifyCandidateEmail(req.params.id)));
  api.post('/candidates/:id/save', requireRole('staff'), (req, res) => res.status(201).json(researchService.saveCandidate(req.params.id, { linkedinUrl: req.body?.linkedinUrl })));
  api.post('/candidates/:id/dismiss', requireRole('staff'), (req, res) => res.json(researchService.dismissCandidate(req.params.id, req.body?.reason)));
  api.post('/contacts/manual', requireRole('staff'), (req, res) => res.status(201).json(researchService.addManualContact(req.body || {})));
  api.post('/relationships', requireRole('staff'), (req, res) => {
    // Record an introduction, referral, meeting, previous bid or past project against a company and/or contact.
    const { type, companyName, companyId, contactId, projectId, summary, at } = req.body || {};
    if (!['introduction', 'referral', 'meeting', 'previous_bid', 'past_project', 'call', 'note'].includes(type)) throw err(400, 'Unknown relationship type');
    if (!companyName && !companyId && !contactId && !projectId) throw err(400, 'Link the record to a company, contact or project');
    const company = companyId ? store.get('companies', companyId) : null;
    const a = store.insert('activities', { id: store.newId('act'), type, projectId: projectId || null, contactId: contactId || null, companyId: company?.id || null, companyName: companyName || company?.name || null, at: at || now(), summary: String(summary || type).slice(0, 2000), recordedAt: now() });
    if (contactId) store.update('contacts', contactId, { lastContactedAt: a.at });
    res.status(201).json(a);
  });
  api.get('/relationships/check', (req, res) => res.json(researchService.relationshipFor(req.query.company, 'live')));

  api.get('/onboarding', (req, res) => {
    const s = settingsService.get();
    const docs = store.list('documents').length;
    const sources = store.list('sources').filter((x) => x.enabled).length;
    const live = store.list('projects').filter((p) => p.environment === 'live').length;
    const approved = store.list('emails').filter((e) => ['approved', 'sent', 'replied'].includes(e.status)).length;
    const auto = { company: Boolean(s.company.name && s.company.senderName), documents: docs > 0, email: Boolean(s.email.address && s.email.smtpHost), sources: sources > 0, preferences: true, tone: Boolean(s.outreach.defaultStyle), review: live > 0, campaign: approved > 0 };
    const steps = ONBOARDING_STEPS.map((st) => ({ ...st, ...s.onboarding.steps[st.id], detected: auto[st.id] }));
    res.json({ ...s.onboarding, steps, showWizard: !s.onboarding.completedAt && !s.onboarding.dismissed });
  });
  api.post('/onboarding/step/:id', requireRole('owner'), (req, res) => {
    const st = ONBOARDING_STEPS.find((x) => x.id === req.params.id);
    if (!st) throw err(404, 'Unknown step');
    const status = ['complete', 'skipped', 'pending'].includes(req.body?.status) ? req.body.status : 'complete';
    if (status === 'skipped' && !st.optional) throw err(400, 'This step is required');
    const s = settingsService.get();
    const patch = { onboarding: { startedAt: s.onboarding.startedAt || now(), steps: { [st.id]: { status, completedAt: status === 'pending' ? null : now() } } } };
    const next = settingsService.update(patch);
    const allDone = ONBOARDING_STEPS.every((x) => next.onboarding.steps[x.id].status !== 'pending');
    if (allDone && !next.onboarding.completedAt) settingsService.update({ onboarding: { completedAt: now() } });
    res.json(settingsService.get().onboarding);
  });
  api.post('/onboarding/dismiss', requireRole('owner'), (req, res) => res.json(settingsService.update({ onboarding: { dismissed: true } }).onboarding));
  api.post('/onboarding/reset', requireRole('owner'), (req, res) => res.json(settingsService.update({ onboarding: { dismissed: false, completedAt: null, steps: Object.fromEntries(ONBOARDING_STEPS.map((x) => [x.id, { status: 'pending', completedAt: null }])) } }).onboarding));

  // ---- Automation Control Center ---------------------------------------
  api.get('/automations', (req, res) => {
    const s = settingsService.get();
    res.json({ mode: s.mode, modes: MODES, pauseAll: s.pauseAll, items: scheduler.snapshot() });
  });
  api.patch('/automations/mode', requireRole('owner'), (req, res) => {
    if (!MODES[req.body?.mode]) throw err(400, `mode must be one of ${Object.keys(MODES).join(', ')}`);
    settingsService.update({ mode: req.body.mode });
    bus.publish('automations.changed', { mode: req.body.mode });
    res.json({ mode: req.body.mode });
  });
  api.post('/automations/pause-all', requireRole('owner'), (req, res) => { settingsService.update({ pauseAll: true }); bus.publish('automations.changed', { pauseAll: true }); res.json({ pauseAll: true }); });
  api.post('/automations/resume-all', requireRole('owner'), (req, res) => { settingsService.update({ pauseAll: false }); bus.publish('automations.changed', { pauseAll: false }); res.json({ pauseAll: false }); });
  api.patch('/automations/:id', requireRole('owner'), (req, res) => {
    if (!AUTOMATIONS.some((a) => a.id === req.params.id)) throw err(404, 'Unknown automation');
    const patch = {};
    if (req.body.enabled !== undefined) patch.enabled = Boolean(req.body.enabled);
    if (req.body.interval !== undefined) { if (!POLL_OPTIONS.some((o) => o.id === req.body.interval)) throw err(400, 'Unknown interval'); patch.interval = req.body.interval; }
    settingsService.update({ automations: { [req.params.id]: patch } });
    bus.publish('automations.changed', { id: req.params.id, ...patch });
    res.json(scheduler.snapshot().find((a) => a.id === req.params.id));
  });
  api.post('/automations/:id/run', requireRole('staff'), async (req, res) => res.json(await scheduler.run(req.params.id, { trigger: 'manual', force: true })));

  // ---- Sources / integrations ------------------------------------------
  api.get('/sources', (req, res) => res.json(sourceService.list()));
  api.get('/sources/:id', (req, res) => { const v = sourceService.view(req.params.id); if (!v) throw err(404, 'Source not found'); res.json(v); });
  api.patch('/sources/:id', requireRole('owner'), (req, res) => res.json(sourceService.update(req.params.id, req.body || {})));
  api.post('/sources/:id/run', requireRole('staff'), async (req, res) => res.json(await sourceService.runSource(req.params.id, { trigger: 'manual', lookbackDays: Number(req.body?.lookbackDays) || undefined })));
  api.get('/sources/:id/diagnostics', async (req, res) => res.json(await sourceService.diagnose(req.params.id)));
  api.get('/sources/:id/runs', (req, res) => res.json(store.list('sourceRuns').filter((r) => r.sourceId === req.params.id).slice(-50).reverse()));

  // File import (CSV / Excel). Body: raw file bytes; filename and source in the query string.
  api.post('/imports', requireRole('staff'), express.raw({ type: '*/*', limit: '30mb' }), (req, res) => {
    const { sourceId, filename } = req.query;
    if (!sourceId) throw err(400, 'sourceId is required');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw err(400, 'Upload the file as the request body');
    res.status(201).json(sourceService.previewImport(req.body, String(filename || 'upload.csv'), String(sourceId)));
  });
  api.get('/imports', (req, res) => res.json(store.list('imports').map(({ rows, ...i }) => i).slice(-50).reverse()));
  api.post('/imports/:id/commit', requireRole('staff'), (req, res) => res.json(sourceService.commitImport(req.params.id, req.body?.mapping)));

  // ---- Projects ---------------------------------------------------------
  function filterProjects(q) {
    const env = q.environment === 'demo' ? 'demo' : 'live';
    let list = store.list('projects').filter((p) => p.environment === env);
    if (q.tier) list = list.filter((p) => String(q.tier).split(',').includes(p.tier));
    if (q.minScore) list = list.filter((p) => (p.score?.total || 0) >= Number(q.minScore));
    if (q.stage) list = list.filter((p) => String(q.stage).split(',').includes(p.stage));
    if (q.open === 'true') list = list.filter((p) => !['lost', 'not_a_fit', 'awarded'].includes(p.stage));
    if (q.sourceId) list = list.filter((p) => p.sourceId === q.sourceId);
    if (q.county) list = list.filter((p) => String(q.county).split(',').map((s) => s.toLowerCase()).includes((p.county || '').toLowerCase()));
    if (q.city) list = list.filter((p) => (p.city || '').toLowerCase() === String(q.city).toLowerCase());
    if (q.projectType) list = list.filter((p) => String(q.projectType).split(',').includes(p.classification?.projectType));
    if (q.relevance) list = list.filter((p) => String(q.relevance).split(',').includes(p.classification?.landscapeRelevance));
    if (q.opportunity) list = list.filter((p) => String(q.opportunity).split(',').includes(p.classification?.opportunityType));
    if (q.excludeResidential !== 'false') list = list.filter((p) => !p.classification?.excluded || q.includeExcluded === 'true');
    if (q.verified === 'true') list = list.filter((p) => p.verification?.status === 'verified');
    if (q.needsVerification === 'true') list = list.filter((p) => p.verification?.status !== 'verified' || (p.lastVerifiedAt && Date.parse(p.lastVerifiedAt) < Date.now() - 30 * 86_400_000));
    if (q.recentDays) list = list.filter((p) => Date.parse(p.firstSeenAt) >= Date.now() - Number(q.recentDays) * 86_400_000);
    if (q.q) { const needle = String(q.q).toLowerCase(); list = list.filter((p) => [p.displayName, p.permitNumber, p.address, p.description, p.applicant, p.generalContractor, p.propertyOwner].some((v) => v && String(v).toLowerCase().includes(needle))); }
    const sort = q.sort || 'score';
    list = list.slice().sort((a, b) => sort === 'newest' ? Date.parse(b.firstSeenAt) - Date.parse(a.firstSeenAt) : sort === 'issued' ? Date.parse(b.issuedAt || 0) - Date.parse(a.issuedAt || 0) : sort === 'valuation' ? (b.valuation || 0) - (a.valuation || 0) : (b.score?.total || 0) - (a.score?.total || 0));
    return list;
  }
  api.get('/projects', (req, res) => {
    const list = filterProjects(req.query);
    const limit = Math.min(Number(req.query.limit) || 100, 1000);
    const offset = Number(req.query.offset) || 0;
    const contactsByProject = new Map();
    for (const c of store.list('contacts')) for (const pid of c.projectIds || []) contactsByProject.set(pid, [...(contactsByProject.get(pid) || []), c]);
    res.json({ total: list.length, limit, offset, environment: req.query.environment === 'demo' ? 'demo' : 'live', items: list.slice(offset, offset + limit).map((p) => presentProject(p, { contacts: contactsByProject.get(p.id) || [] })) });
  });
  api.get('/projects/export.csv', (req, res) => {
    res.set('content-type', 'text/csv').set('content-disposition', `attachment; filename="projects-${now().slice(0, 10)}.csv"`);
    res.send(crmService.exportCsv('projects', filterProjects(req.query)));
  });
  api.get('/projects/:id', (req, res) => {
    const p = store.get('projects', req.params.id);
    if (!p) throw err(404, 'Project not found');
    const history = store.list('projectHistory').filter((h) => h.projectId === p.id).slice().reverse();
    const verifications = store.list('verifications').filter((v) => v.projectId === p.id).slice().reverse();
    const contacts = store.list('contacts').filter((c) => c.projectIds?.includes(p.id));
    const emails = store.list('emails').filter((e) => e.projectId === p.id).slice().reverse();
    const activities = store.list('activities').filter((a) => a.projectId === p.id).slice().reverse();
    res.json({ ...presentProject(p, { includeRaw: req.query.raw === 'true', contacts }), history, verifications, contacts, emails, activities });
  });
  api.patch('/projects/:id', requireRole('staff'), (req, res) => {
    const p = store.get('projects', req.params.id);
    if (!p) throw err(404, 'Project not found');
    const patch = { updatedAt: now() };
    // Facts a person enters are labelled "Entered by your team", never as verified government data.
    for (const f of ['applicant', 'propertyOwner', 'generalContractor', 'propertyManager', 'constructionManager', 'architect', 'landscapeScopeDocumented', 'bidDeadline', 'schedule', 'projectName']) {
      if (req.body[f] !== undefined) { patch[f] = req.body[f] || null; patch.provenance = { ...(patch.provenance || p.provenance), [f]: req.body[f] ? 'user' : 'unverified' }; }
    }
    if (req.body.projectName !== undefined) { patch.displayName = req.body.projectName || p.displayName; patch.userNamed = Boolean(req.body.projectName); }
    // Where a researched fact came from (news article, agency page, company website). Kept per field.
    if (req.body.factSources && typeof req.body.factSources === 'object') {
      patch.factSources = { ...(p.factSources || {}) };
      for (const [field, src] of Object.entries(req.body.factSources)) {
        if (!src || typeof src !== 'object') continue;
        const url = typeof src.url === 'string' && /^https?:\/\//.test(src.url) ? src.url : null;
        patch.factSources[field] = { url, note: String(src.note || '').slice(0, 300), recordedAt: now() };
      }
    }
    if (req.body.bidAmount !== undefined) patch.bidAmount = req.body.bidAmount == null ? null : Number(req.body.bidAmount);
    if (req.body.contractValue !== undefined) patch.contractValue = req.body.contractValue == null ? null : Number(req.body.contractValue);
    if (typeof req.body.note === 'string' && req.body.note.trim()) patch.notes = [...(p.notes || []), { at: now(), text: req.body.note.trim() }];
    const merged = { ...p, ...patch };
    merged.score = scoreProject(merged, settingsService.get());
    merged.tier = tierFor(merged.score.total).key;
    store.update('projects', p.id, merged);
    store.insert('projectHistory', { id: store.newId('hist'), projectId: p.id, at: now(), type: 'user_edit', trigger: 'user', changes: Object.keys(patch).filter((k) => !['updatedAt', 'provenance'].includes(k)).map((k) => ({ field: k, before: p[k] ?? null, after: patch[k] })) });
    res.json(presentProject(merged));
  });
  api.post('/projects/:id/verify', requireRole('staff'), async (req, res) => {
    const v = await sourceService.verifyProject(req.params.id, { trigger: 'manual' });
    res.json({ verification: v, project: presentProject(store.get('projects', req.params.id)) });
  });
  api.post('/projects/:id/stage', requireRole('staff'), (req, res) => {
    const p = store.get('projects', req.params.id);
    if (!p) throw err(404, 'Project not found');
    if (p.environment === 'demo') throw err(403, 'Demo projects cannot enter the live pipeline.');
    res.json(presentProject(crmService.setStage(p.id, req.body?.stage, { note: req.body?.note })));
  });
  api.post('/projects/:id/activities', requireRole('staff'), (req, res) => {
    const p = store.get('projects', req.params.id);
    if (!p) throw err(404, 'Project not found');
    if (p.environment === 'demo') throw err(403, 'Demo projects cannot record CRM activity.');
    res.status(201).json(crmService.addActivity({ ...req.body, projectId: p.id }));
  });

  // ---- CRM --------------------------------------------------------------
  api.get('/contacts', (req, res) => {
    const env = req.query.environment === 'demo' ? 'demo' : 'live';
    let list = store.list('contacts').filter((c) => c.environment === env);
    if (req.query.projectId) list = list.filter((c) => c.projectIds?.includes(req.query.projectId));
    res.json(list);
  });
  api.get('/contacts/export.csv', (req, res) => {
    res.set('content-type', 'text/csv').set('content-disposition', `attachment; filename="contacts-${now().slice(0, 10)}.csv"`);
    res.send(crmService.exportCsv('contacts', store.list('contacts').filter((c) => c.environment === 'live')));
  });
  api.post('/contacts', requireRole('staff'), (req, res) => res.status(201).json(crmService.upsertContact({ ...req.body, environment: 'live' })));
  api.patch('/contacts/:id', requireRole('staff'), (req, res) => {
    const c = store.get('contacts', req.params.id);
    if (!c) throw err(404, 'Contact not found');
    const saved = crmService.upsertContact({ ...c, ...req.body, id: c.id, environment: c.environment });
    const extra = {};
    if (typeof req.body.linkedinUrl === 'string') { extra.linkedinUrl = req.body.linkedinUrl.trim() || null; extra.linkedinVerifiedAt = extra.linkedinUrl ? now() : null; }
    if (req.body.optedOut !== undefined) extra.optedOut = Boolean(req.body.optedOut);
    if (req.body.emailConfirmed === true) { extra.emailVerification = { status: 'valid', detail: 'Confirmed by your team', method: 'manual', checkedAt: now() }; extra.lastVerifiedAt = now(); }
    res.json(Object.keys(extra).length ? store.update('contacts', saved.id, extra) : saved);
  });
  api.delete('/contacts/:id', requireRole('staff'), (req, res) => { crmService.removeContact(req.params.id); res.status(204).end(); });
  api.get('/companies', (req, res) => res.json(store.list('companies').filter((c) => c.environment === 'live')));
  api.post('/companies', requireRole('staff'), (req, res) => res.status(201).json(crmService.upsertCompany({ ...req.body, environment: 'live' })));
  api.get('/activities', (req, res) => res.json(store.list('activities').slice(-200).reverse()));
  api.get('/reminders', (req, res) => res.json(store.list('reminders').filter((r) => req.query.status ? r.status === req.query.status : true).slice().reverse()));
  api.patch('/reminders/:id', requireRole('staff'), (req, res) => { const r = store.get('reminders', req.params.id); if (!r) throw err(404, 'Reminder not found'); res.json(store.update('reminders', r.id, { status: req.body.status === 'done' ? 'done' : 'open', doneAt: req.body.status === 'done' ? now() : null })); });
  api.get('/pipeline', (req, res) => {
    const live = store.list('projects').filter((p) => p.environment === 'live' && !p.classification?.excluded);
    res.json(PIPELINE_STAGES.map((stage) => ({ stage, count: live.filter((p) => p.stage === stage).length, projects: live.filter((p) => p.stage === stage).sort((a, b) => (b.score?.total || 0) - (a.score?.total || 0)).slice(0, 50).map((p) => ({ id: p.id, displayName: p.displayName, city: p.city, score: p.score?.total, tier: p.tier, valuation: p.valuation, bidAmount: p.bidAmount, contractValue: p.contractValue, contactCount: p.contactCount })) })));
  });

  // ---- Outreach ---------------------------------------------------------
  api.get('/emails', (req, res) => {
    let list = store.list('emails');
    if (req.query.status) list = list.filter((e) => String(req.query.status).split(',').includes(e.status));
    if (req.query.projectId) list = list.filter((e) => e.projectId === req.query.projectId);
    const projects = new Map(store.list('projects').map((p) => [p.id, p]));
    res.json(list.slice().reverse().map((e) => ({ ...e, project: projects.get(e.projectId) ? { id: e.projectId, displayName: projects.get(e.projectId).displayName, city: projects.get(e.projectId).city, score: projects.get(e.projectId).score?.total } : null })));
  });
  api.post('/emails/preview', (req, res) => {
    const p = store.get('projects', req.body?.projectId);
    if (!p) throw err(404, 'Project not found');
    const contact = req.body?.contactId ? store.get('contacts', req.body.contactId) : null;
    const { approvedCredentials } = emailService;
    res.json(emailService.renderEmail({ style: req.body?.style, project: p, contact, company: settingsService.get().company, credentials: (approvedCredentials ? approvedCredentials(store.list('documents')) : []) }));
  });
  api.post('/emails', requireRole('staff'), (req, res) => res.status(201).json(emailService.createDraft({ projectId: req.body?.projectId, contactId: req.body?.contactId, style: req.body?.style, trigger: 'manual' })));
  api.patch('/emails/:id', requireRole('staff'), (req, res) => res.json(emailService.update(req.params.id, req.body || {})));
  api.post('/emails/:id/approve', requireRole('owner'), (req, res) => res.json(emailService.approve(req.params.id)));
  api.post('/emails/:id/reject', requireRole('staff'), (req, res) => res.json(emailService.reject(req.params.id, req.body?.reason)));
  api.post('/emails/:id/send', requireRole('owner'), async (req, res) => res.json(await emailService.send(req.params.id, { by: 'user', force: true })));
  api.post('/emails/:id/replied', requireRole('staff'), (req, res) => res.json(emailService.markReplied(req.params.id)));
  api.post('/campaigns/approve', requireRole('owner'), (req, res) => {
    // Approve a batch of drafts at once (first outreach campaign in onboarding).
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : store.list('emails').filter((e) => e.status === 'pending_approval').map((e) => e.id);
    const results = ids.map((id) => { try { return { id, ok: true, email: emailService.approve(id) }; } catch (e) { return { id, ok: false, error: e.message }; } });
    res.json({ approved: results.filter((r) => r.ok).length, results });
  });

  // ---- Documents --------------------------------------------------------
  api.get('/documents', (req, res) => res.json({ items: documentService.list(req.role || 'owner'), warnings: documentService.warnings(), types: DOCUMENT_TYPES }));
  api.post('/documents', requireRole('staff'), express.raw({ type: '*/*', limit: '30mb' }), async (req, res) => {
    const { filename, type, title, mimetype } = req.query;
    res.status(201).json(await documentService.upload({ buffer: req.body, filename: String(filename || 'upload'), mimetype: String(mimetype || req.get('content-type') || ''), type: String(type || 'other'), title: title ? String(title) : undefined, uploadedBy: req.role || 'owner' }));
  });
  api.patch('/documents/:id', requireRole('owner'), (req, res) => res.json(documentService.review(req.params.id, req.body || {}, { by: req.role || 'owner' })));
  api.delete('/documents/:id', requireRole('owner'), (req, res) => { documentService.remove(req.params.id); res.status(204).end(); });
  api.get('/documents/:id/download', async (req, res) => {
    const d = store.get('documents', req.params.id);
    if (!d) throw err(404, 'Document not found');
    if (roleRank(req.role || 'owner') < roleRank(d.minRole)) throw err(403, 'You do not have access to this document');
    const buf = await documentService.readBuffer(d);
    res.set('content-type', d.mimetype).set('content-disposition', `attachment; filename="${d.filename}"`).send(buf);
  });

  // ---- Demo environment -------------------------------------------------
  api.post('/demo/seed', requireRole('owner'), (req, res) => res.json({ demoProjects: seedDemoProjects({ store, settings: settingsService.get() }) }));
  api.delete('/demo', requireRole('owner'), (req, res) => res.json({ removed: clearDemoProjects({ store }) }));

  // ---- Dashboard --------------------------------------------------------
  api.get('/dashboard', (req, res) => res.json(computeDashboard({ store, settings: settingsService.get(), days: Math.min(Math.max(Number(req.query.days) || 30, 1), 365) })));

  // ---- Diagnostics summary ---------------------------------------------
  api.get('/diagnostics', (req, res) => {
    const s = settingsService.get();
    const sources = sourceService.list();
    res.json({
      checkedAt: now(),
      environment: { dataDir: process.env.DATA_DIR || 'data', apiKeyAuth: Boolean(process.env.DASHBOARD_API_KEY), documentEncryptionKeyFromEnv: Boolean(process.env.DOCUMENT_ENCRYPTION_KEY), node: process.version },
      sources: sources.map((x) => ({ id: x.id, name: x.name, status: x.status, enabled: x.enabled, accessMethod: x.accessMethod, lastSuccessAt: x.lastSuccessAt, lastError: x.lastError, recordCount: x.recordCount, lastSourceUpdatedAt: x.lastSourceUpdatedAt })),
      automations: scheduler.snapshot().map((a) => ({ id: a.id, label: a.label, enabled: a.config?.enabled, status: a.status, lastRunAt: a.lastRunAt, lastError: a.lastError, nextRunAt: a.nextRunAt })),
      email: { configured: Boolean(s.email.smtpHost && s.email.address), lastTestOk: s.email.lastTestOk, lastTestError: s.email.lastTestError },
      mode: s.mode, pauseAll: s.pauseAll,
      counts: { liveProjects: store.list('projects').filter((p) => p.environment === 'live').length, demoProjects: store.list('projects').filter((p) => p.environment === 'demo').length, contacts: store.list('contacts').length, emails: store.list('emails').length, documents: store.list('documents').length },
    });
  });

  return api;
}
