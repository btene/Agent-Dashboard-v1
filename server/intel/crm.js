// Built-in CRM: companies, contacts, activities and follow-up reminders.
import { PIPELINE_STAGES } from './projects.js';

export const CONTACT_ROLES = ['developer', 'property_owner', 'general_contractor', 'asset_manager', 'procurement', 'estimator', 'architect', 'landscape_architect', 'other'];
export const COMPANY_TYPES = ['developer', 'property_owner', 'general_contractor', 'asset_manager', 'architect', 'other'];

export function createCrmService({ store, bus }) {
  const now = () => new Date().toISOString();
  const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? undefined : String(v));

  function recountContacts(projectId) {
    const project = store.get('projects', projectId);
    if (!project) return;
    const n = store.list('contacts').filter((c) => c.projectIds?.includes(projectId) && c.environment === project.environment).length;
    store.update('projects', projectId, { contactCount: n, updatedAt: now() });
  }

  // ---- Companies
  function upsertCompany(body) {
    const name = str(body.name);
    if (!name) throw Object.assign(new Error('`name` is required'), { status: 400 });
    const existing = body.id ? store.get('companies', body.id) : store.list('companies').find((c) => c.name.toLowerCase() === name.toLowerCase() && c.environment === (body.environment || 'live'));
    const doc = {
      name, type: COMPANY_TYPES.includes(body.type) ? body.type : 'other', website: str(body.website) ?? null, phone: str(body.phone) ?? null, address: str(body.address) ?? null, notes: str(body.notes) ?? '',
      provenance: ['government', 'third_party', 'user'].includes(body.provenance) ? body.provenance : 'user', sourceNote: str(body.sourceNote) ?? null, environment: body.environment || 'live', updatedAt: now(),
    };
    if (existing) return store.update('companies', existing.id, doc);
    return store.insert('companies', { id: store.newId('co'), ...doc, createdAt: now() });
  }

  // ---- Contacts
  function upsertContact(body) {
    const email = str(body.email)?.toLowerCase() || null;
    const firstName = str(body.firstName) || null;
    const lastName = str(body.lastName) || null;
    if (!email && !firstName && !lastName) throw Object.assign(new Error('A name or email is required'), { status: 400 });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error('Invalid email address'), { status: 400 });
    const env = body.environment || 'live';
    const projectIds = Array.isArray(body.projectIds) ? body.projectIds.filter((id) => { const p = store.get('projects', id); if (p && p.environment !== env) throw Object.assign(new Error('Contacts cannot link live and demo records'), { status: 400 }); return Boolean(p); }) : [];
    const existing = body.id ? store.get('contacts', body.id) : email ? store.list('contacts').find((c) => c.email === email && c.environment === env) : null;
    const doc = {
      firstName, lastName, email, phone: str(body.phone) ?? null, title: str(body.title) ?? null, company: str(body.company) ?? null, companyId: body.companyId || null,
      role: CONTACT_ROLES.includes(body.role) ? body.role : 'other', notes: str(body.notes) ?? '',
      provenance: ['government', 'third_party', 'user'].includes(body.provenance) ? body.provenance : 'user', sourceNote: str(body.sourceNote) ?? null, confidence: body.confidence ?? null,
      projectIds: existing ? Array.from(new Set([...(existing.projectIds || []), ...projectIds])) : projectIds, environment: env, updatedAt: now(),
    };
    const saved = existing ? store.update('contacts', existing.id, doc) : store.insert('contacts', { id: store.newId('ct'), ...doc, createdAt: now(), optedOut: false });
    for (const pid of saved.projectIds) recountContacts(pid);
    bus.publish('contact.saved', { id: saved.id });
    return saved;
  }

  function removeContact(id) {
    const c = store.get('contacts', id);
    if (!c) throw Object.assign(new Error('Contact not found'), { status: 404 });
    store.remove('contacts', id);
    for (const pid of c.projectIds || []) recountContacts(pid);
  }

  function setStage(projectId, stage, { note } = {}) {
    if (!PIPELINE_STAGES.includes(stage)) throw Object.assign(new Error(`stage must be one of ${PIPELINE_STAGES.join(', ')}`), { status: 400 });
    const p = store.get('projects', projectId);
    if (!p) throw Object.assign(new Error('Project not found'), { status: 404 });
    store.update('projects', projectId, { stage, updatedAt: now() });
    store.insert('activities', { id: store.newId('act'), type: 'stage_changed', projectId, at: now(), summary: `Stage set to ${stage}${note ? ` — ${note}` : ''}` });
    bus.publish('project.stage', { id: projectId, stage });
    return store.get('projects', projectId);
  }

  function addActivity(body) {
    const p = store.get('projects', body.projectId);
    if (!p) throw Object.assign(new Error('Project not found'), { status: 404 });
    const type = ['note', 'call', 'meeting', 'bid_submitted', 'contract_awarded', 'reply_received', 'research'].includes(body.type) ? body.type : 'note';
    const a = store.insert('activities', { id: store.newId('act'), type, projectId: p.id, contactId: body.contactId || null, at: now(), summary: str(body.summary) || type, amount: body.amount != null ? Number(body.amount) : null });
    if (type === 'bid_submitted') store.update('projects', p.id, { stage: 'bid_submitted', bidAmount: a.amount ?? p.bidAmount ?? null, updatedAt: now() });
    if (type === 'contract_awarded') store.update('projects', p.id, { stage: 'awarded', contractValue: a.amount ?? p.contractValue ?? null, updatedAt: now() });
    if (type === 'reply_received') store.update('projects', p.id, { stage: p.stage === 'bid_submitted' || p.stage === 'awarded' ? p.stage : 'replied', updatedAt: now() });
    return a;
  }

  // ---- Reminders
  function createFollowUpReminders(followUpDays = 5) {
    const cutoff = Date.now() - followUpDays * 86_400_000;
    const open = new Set(store.list('reminders').filter((r) => r.status === 'open').map((r) => r.emailId));
    let created = 0;
    for (const e of store.list('emails')) {
      if (e.status !== 'sent' || !e.sentAt || Date.parse(e.sentAt) > cutoff || open.has(e.id)) continue;
      store.insert('reminders', { id: store.newId('rem'), emailId: e.id, projectId: e.projectId, contactId: e.contactId, dueAt: now(), status: 'open', title: `Follow up: "${e.subject}" sent ${e.sentAt.slice(0, 10)} — no reply yet`, createdAt: now() });
      created++;
    }
    return created;
  }

  // ---- Export / import
  function exportCsv(collection, rows) {
    const cols = collection === 'projects'
      ? ['id', 'displayName', 'permitNumber', 'address', 'city', 'county', 'status', 'permitType', 'valuation', 'squareFootage', 'issuedAt', 'appliedAt', 'applicant', 'propertyOwner', 'generalContractor', 'stage', 'score.total', 'tier', 'classification.projectTypeLabel', 'sourceName', 'sourceRecordUrl', 'recordClass', 'lastVerifiedAt', 'environment']
      : ['id', 'firstName', 'lastName', 'email', 'phone', 'title', 'company', 'role', 'provenance', 'projectIds', 'environment'];
    const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
    const esc = (v) => { if (v == null) return ''; const s = Array.isArray(v) ? v.join(';') : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(get(r, c))).join(','))].join('\n');
  }

  return { upsertCompany, upsertContact, removeContact, setStage, addActivity, createFollowUpReminders, exportCsv, recountContacts };
}
