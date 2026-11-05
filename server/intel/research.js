// Company & decision-maker research engine. Works inside the permit platform:
// starts from the companies a verified project names, asks the enabled
// providers for people with relevant titles, scores each candidate with
// written reasons and source citations, builds one-click LinkedIn search
// links, checks the CRM for existing relationships, and saves verified
// contacts with provenance. Nothing is invented: a candidate exists only if a
// provider, the agency record, or a person supplied it.
import { PROVIDERS, PROVIDER_INFO, enabledProviders } from './providers/index.js';

// ---- Title priorities (construction vs recurring maintenance) ---------------
export const TITLE_PRIORITIES = {
  construction: [
    { titles: ['VP of Construction', 'Vice President of Construction', 'Director of Construction'], weight: 1.0, authority: 1.0, label: 'VP / Director of Construction' },
    { titles: ['VP of Development', 'Vice President of Development', 'Director of Development', 'Development Manager'], weight: 0.95, authority: 0.95, label: 'VP / Director of Development' },
    { titles: ['Project Executive', 'Senior Project Manager', 'Project Manager'], weight: 0.9, authority: 0.7, label: 'Project Executive / Project Manager' },
    { titles: ['Chief Estimator', 'Preconstruction Manager', 'Director of Preconstruction', 'Senior Estimator', 'Estimator'], weight: 0.9, authority: 0.65, label: 'Chief Estimator / Preconstruction Manager' },
    { titles: ['Procurement Manager', 'Purchasing Manager', 'Director of Procurement', 'Buyer'], weight: 0.85, authority: 0.6, label: 'Procurement / Purchasing Manager' },
    { titles: ['Construction Manager', 'Superintendent', 'General Superintendent'], weight: 0.7, authority: 0.5, label: 'Construction Manager / Superintendent' },
    { titles: ['Owner', 'Principal', 'President', 'Partner', 'Chief Executive Officer', 'Managing Director'], weight: 0.6, authority: 1.0, label: 'Owner / Principal' },
  ],
  maintenance: [
    { titles: ['Director of Facilities', 'Facilities Manager', 'VP of Facilities', 'Facilities Director'], weight: 1.0, authority: 0.85, label: 'Director of Facilities' },
    { titles: ['Regional Property Manager', 'Senior Property Manager', 'Property Manager', 'General Manager'], weight: 0.95, authority: 0.75, label: 'Regional Property Manager' },
    { titles: ['Director of Property Management', 'VP of Property Management', 'Vice President of Property Management'], weight: 0.95, authority: 0.9, label: 'Director of Property Management' },
    { titles: ['Asset Manager', 'Senior Asset Manager', 'Director of Asset Management', 'VP of Asset Management'], weight: 0.9, authority: 0.9, label: 'Asset Manager' },
    { titles: ['Director of Operations', 'VP of Operations', 'Operations Manager'], weight: 0.7, authority: 0.7, label: 'Operations' },
    { titles: ['Procurement Manager', 'Purchasing Manager', 'Vendor Manager'], weight: 0.7, authority: 0.6, label: 'Procurement / Vendor Manager' },
    { titles: ['Owner', 'Principal', 'President', 'Partner', 'Chief Executive Officer'], weight: 0.6, authority: 1.0, label: 'Owner / Principal' },
  ],
};

export function titleSetFor(opportunityType) {
  if (opportunityType === 'maintenance') return TITLE_PRIORITIES.maintenance;
  if (opportunityType === 'both') return [...TITLE_PRIORITIES.construction, ...TITLE_PRIORITIES.maintenance];
  return TITLE_PRIORITIES.construction;
}

const SENIORITY = [[/\b(chief|ceo|coo|cfo|president|owner|principal|partner|founder|managing director)\b/i, 1.0], [/\b(vice president|vp|svp|evp|executive)\b/i, 0.9], [/\b(director|head of)\b/i, 0.8], [/\b(senior|sr\.?|regional|lead|chief estimator)\b/i, 0.65], [/\b(manager|superintendent|estimator)\b/i, 0.5], [/\b(coordinator|assistant|associate|analyst|intern|administrator)\b/i, 0.2]];

export function titleRelevance(title, opportunityType) {
  const t = String(title || '').toLowerCase();
  if (!t) return { score: 0, reason: 'No job title known', matched: null };
  let best = { score: 0, matched: null };
  for (const group of titleSetFor(opportunityType)) {
    for (const want of group.titles) {
      const w = want.toLowerCase();
      if (t === w || t.includes(w)) { if (group.weight > best.score) best = { score: group.weight, matched: group.label }; }
      else { const key = w.split(' ').pop(); if (t.includes(key) && /construction|development|estimat|procure|purchas|facilit|property|asset|project|precon/.test(t) && group.weight * 0.7 > best.score) best = { score: group.weight * 0.7, matched: `${group.label} (partial match)` }; }
    }
  }
  if (!best.matched) {
    if (/landscap|grounds|site|exterior/.test(t)) best = { score: 0.8, matched: 'Landscape / grounds responsibility' };
    else if (/construction|development|estimat|procure|purchas|facilit|property|asset|project/.test(t)) best = { score: 0.4, matched: 'Related field, non-priority title' };
    else if (/sales|marketing|hr|human resources|recruit|accounting|finance|legal|it\b|software/.test(t)) best = { score: 0.05, matched: 'Unrelated function' };
    else best = { score: 0.2, matched: 'Title not in the priority list' };
  }
  return { score: best.score, reason: best.matched, matched: best.matched };
}

export function authorityScore(title) {
  const t = String(title || '');
  for (const [re, v] of SENIORITY) if (re.test(t)) return v;
  return t ? 0.35 : 0;
}

/**
 * Contact score (0–100): relevance 35, project connection 30, authority 20,
 * verified contact availability 15. Every component has a reason and the
 * source it rests on.
 */
export function scoreCandidate(c, { project, companyRole, opportunityType }) {
  const rel = titleRelevance(c.title, opportunityType);
  const parts = [];
  parts.push({ key: 'relevance', label: 'Relevance of job responsibilities', points: Math.round(rel.score * 35), max: 35, reason: c.title ? `Title "${c.title}" → ${rel.reason}` : 'No title on record', source: c.sourceLabel || 'unknown' });
  let conn = 0; let connReason;
  if (c.projectConnection === 'named_on_record') { conn = 1; connReason = 'Named on the permit or project record itself'; }
  else if (c.projectConnection === 'confirmed_by_user') { conn = 1; connReason = 'Your team confirmed this person works on the project'; }
  else if (companyRole) { conn = { generalContractor: 0.7, applicant: 0.75, propertyOwner: 0.65, propertyManager: 0.6, constructionManager: 0.7, architect: 0.4 }[companyRole] ?? 0.5; connReason = `Works at the ${({ generalContractor: 'general contractor', applicant: 'developer/applicant', propertyOwner: 'property owner', propertyManager: 'property manager', constructionManager: 'construction manager', architect: 'architect' })[companyRole] || 'company'} named on the record (${project?.provenance?.[companyRole] === 'government' ? 'government record' : project?.provenance?.[companyRole] === 'third_party' ? 'third-party record' : 'entered by your team'}); individual assignment to this project is NOT confirmed`; }
  else { conn = 0.2; connReason = 'Company link to the project is unverified'; }
  parts.push({ key: 'connection', label: 'Direct connection to the project', points: Math.round(conn * 30), max: 30, reason: connReason, source: companyRole ? `${project?.sourceName || 'project record'}` : 'none' });
  const auth = authorityScore(c.title);
  parts.push({ key: 'authority', label: 'Decision-making authority', points: Math.round(auth * 20), max: 20, reason: c.title ? `Seniority inferred from title "${c.title}"` : 'Unknown without a title', source: c.sourceLabel || 'unknown' });
  let avail = 0; const availWhy = [];
  if (c.email && c.emailVerification?.status === 'valid') { avail += 0.7; availWhy.push(`email verified (${c.emailVerification.detail})`); }
  else if (c.email) { avail += 0.4; availWhy.push('email on file, not yet verified'); }
  if (c.phone) { avail += 0.15; availWhy.push('business phone on file'); }
  if (c.linkedinUrl) { avail += c.linkedinVerifiedAt ? 0.15 : 0.1; availWhy.push(c.linkedinVerifiedAt ? 'LinkedIn profile verified by your team' : 'LinkedIn URL from provider'); }
  parts.push({ key: 'availability', label: 'Verified professional contact availability', points: Math.round(Math.min(1, avail) * 15), max: 15, reason: availWhy.join('; ') || 'No contact details', source: c.sourceLabel || 'unknown' });
  const total = parts.reduce((s, p) => s + p.points, 0);
  return { total, parts, scoredAt: new Date().toISOString() };
}

// ---- LinkedIn: one-click public search links (no scraping, no automation) ----
export function linkedinLinks({ company, titles = [], personName, location = 'Southern California' }) {
  const enc = encodeURIComponent;
  const links = [];
  if (company) {
    links.push({ label: `Company page search: ${company}`, url: `https://www.linkedin.com/search/results/companies/?keywords=${enc(company)}`, kind: 'company' });
    const top = titles.slice(0, 4).map((t) => `"${t}"`).join(' OR ');
    links.push({ label: `People at ${company} with priority titles`, url: `https://www.linkedin.com/search/results/people/?keywords=${enc(`${company} ${top}`)}`, kind: 'people' });
    links.push({ label: `People at ${company} — estimating / preconstruction`, url: `https://www.linkedin.com/search/results/people/?keywords=${enc(`${company} estimator OR preconstruction`)}`, kind: 'people' });
    links.push({ label: `People at ${company} — construction / development leadership`, url: `https://www.linkedin.com/search/results/people/?keywords=${enc(`${company} "director of construction" OR "vp construction" OR "director of development"`)}`, kind: 'people' });
    links.push({ label: `Google: ${company} site:linkedin.com`, url: `https://www.google.com/search?q=${enc(`"${company}" site:linkedin.com/in ${location}`)}`, kind: 'web' });
    links.push({ label: `Google: ${company} website`, url: `https://www.google.com/search?q=${enc(`"${company}" construction OR development ${location}`)}`, kind: 'web' });
  }
  if (personName) links.push({ label: `LinkedIn profile search: ${personName}`, url: `https://www.linkedin.com/search/results/people/?keywords=${enc(`${personName} ${company || ''}`.trim())}`, kind: 'person' });
  return links;
}

export function createResearchService({ store, bus, settingsService, crmService, fetchImpl }) {
  const now = () => new Date().toISOString();

  /** Companies a project names, from verified fields only. */
  function companiesFor(project) {
    const out = [];
    for (const [field, role] of [['generalContractor', 'generalContractor'], ['applicant', 'applicant'], ['propertyOwner', 'propertyOwner'], ['propertyManager', 'propertyManager'], ['constructionManager', 'constructionManager']]) {
      const name = project[field];
      if (!name || !['government', 'third_party', 'user'].includes(project.provenance?.[field])) continue;
      const company = store.list('companies').find((c) => c.environment === project.environment && c.name.toLowerCase() === String(name).toLowerCase()) || null;
      out.push({ name, role: role, field, provenance: project.provenance[field], company });
    }
    return out;
  }

  /** Existing CRM relationships for a company name (for "already know them" flags). */
  function relationshipFor(name, environment = 'live') {
    if (!name) return null;
    const lower = String(name).toLowerCase();
    const company = store.list('companies').find((c) => c.environment === environment && c.name.toLowerCase() === lower) || null;
    const contacts = store.list('contacts').filter((c) => c.environment === environment && (c.company || '').toLowerCase() === lower || (company && c.companyId === company.id));
    const contactIds = new Set(contacts.map((c) => c.id));
    const emails = store.list('emails').filter((e) => contactIds.has(e.contactId));
    const activities = store.list('activities').filter((a) => (a.contactId && contactIds.has(a.contactId)) || (company && a.companyId === company.id) || (a.companyName && a.companyName.toLowerCase() === lower));
    const relationshipEvents = activities.filter((a) => ['introduction', 'referral', 'meeting', 'previous_bid', 'past_project', 'call'].includes(a.type));
    const sent = emails.filter((e) => ['sent', 'replied'].includes(e.status));
    const replied = emails.filter((e) => e.status === 'replied');
    const level = replied.length || relationshipEvents.some((a) => ['meeting', 'past_project', 'introduction', 'referral'].includes(a.type)) ? 'warm' : sent.length || relationshipEvents.length ? 'contacted' : contacts.length ? 'known' : 'none';
    return { company, contacts: contacts.map((c) => ({ id: c.id, name: `${c.firstName || ''} ${c.lastName || ''}`.trim(), title: c.title, email: c.email, lastContactedAt: c.lastContactedAt || null })), emailsSent: sent.length, replies: replied.length, relationshipEvents: relationshipEvents.slice(-10).reverse(), level, summary: level === 'warm' ? `Existing relationship: ${replied.length ? `${replied.length} repl${replied.length === 1 ? 'y' : 'ies'}` : ''}${relationshipEvents.length ? ` ${relationshipEvents.length} recorded interaction${relationshipEvents.length === 1 ? '' : 's'}` : ''}`.trim() : level === 'contacted' ? `Already contacted (${sent.length} email${sent.length === 1 ? '' : 's'} sent, no reply yet)` : level === 'known' ? `${contacts.length} contact${contacts.length === 1 ? '' : 's'} in CRM, no outreach yet` : 'No existing relationship in the CRM' };
  }

  function dedupeKey(c) { return c.email ? `e:${c.email.toLowerCase()}` : `n:${(c.firstName || '').toLowerCase()}|${(c.lastName || '').toLowerCase()}|${(c.company || '').toLowerCase()}`; }

  /** Run discovery for one project (or a company) and store candidates. */
  async function findDecisionMakers({ projectId, companyId, companyName, domain, trigger = 'manual' }) {
    const settings = settingsService.get();
    const project = projectId ? store.get('projects', projectId) : null;
    if (projectId && !project) throw Object.assign(new Error('Project not found'), { status: 404 });
    if (project?.environment === 'demo') throw Object.assign(new Error('Demo projects cannot be researched against live providers.'), { status: 403 });
    const company = companyId ? store.get('companies', companyId) : null;
    if (companyId && !company) throw Object.assign(new Error('Company not found'), { status: 404 });
    const opportunityType = project?.classification?.opportunityType || 'construction';
    const titleGroups = titleSetFor(opportunityType === 'unlikely' ? 'construction' : opportunityType);
    const titles = Array.from(new Set(titleGroups.flatMap((g) => g.titles)));
    const targets = project ? companiesFor(project) : [{ name: company?.name || companyName, role: company?.type === 'general_contractor' ? 'generalContractor' : company?.type === 'developer' ? 'applicant' : company?.type === 'property_owner' ? 'propertyOwner' : null, provenance: company?.provenance || 'user', company }];
    const providers = enabledProviders(settings);
    const run = { id: store.newId('rsr'), projectId: projectId || null, companyId: companyId || null, trigger, startedAt: now(), providersUsed: providers, targets: targets.map((t) => ({ name: t.name, role: t.role })), results: [], errors: [], linkedin: [], relationships: [] };
    const existingKeys = new Map(store.list('contacts').filter((c) => c.environment === 'live').map((c) => [dedupeKey(c), c]));
    const candidateKeys = new Map(store.list('candidates').map((c) => [`${c.projectId || c.companyId}|${dedupeKey(c)}`, c]));

    if (!targets.length) run.errors.push({ provider: null, message: 'This project does not name a developer, general contractor or owner yet. Look the permit up at the agency, or import provider data, then add the company under "Add researched facts".' });
    for (const t of targets) {
      const rel = relationshipFor(t.name, 'live');
      run.relationships.push({ company: t.name, role: t.role, ...rel, company: undefined, companyId: rel.company?.id || null });
      const dom = domain || t.company?.domain || null;
      run.linkedin.push({ company: t.name, role: t.role, links: linkedinLinks({ company: t.name, titles: titleGroups.slice(0, 4).flatMap((g) => g.titles.slice(0, 1)) }) });
      for (const pid of providers) {
        try {
          const people = await PROVIDERS[pid].searchPeople(settings.providers[pid], { company: t.name, domain: dom, titles, limit: 10, fetchImpl });
          for (const p of people) {
            const key = `${projectId || companyId}|${dedupeKey(p)}`;
            const existingContact = existingKeys.get(dedupeKey(p)) || null;
            const base = { ...p, projectId: projectId || null, companyId: companyId || t.company?.id || null, companyRole: t.role, companyName: t.name, projectConnection: 'company_named_on_record', existingContactId: existingContact?.id || null, environment: 'live' };
            base.score = scoreCandidate(base, { project, companyRole: t.role, opportunityType });
            const prior = candidateKeys.get(key);
            if (prior) { store.update('candidates', prior.id, { ...base, id: prior.id, status: prior.status, updatedAt: now() }); run.results.push(prior.id); }
            else { const doc = store.insert('candidates', { id: store.newId('cand'), ...base, status: 'candidate', createdAt: now(), updatedAt: now() }); candidateKeys.set(key, doc); run.results.push(doc.id); }
          }
          run.results.push(...[]);
        } catch (err) { run.errors.push({ provider: pid, message: err.message }); }
      }
      if (!providers.length) run.errors.push({ provider: null, message: `No contact-data provider is enabled. ${Object.values(PROVIDER_INFO).filter((p) => !p.enterpriseOnly).map((p) => p.name).join(', ')} can be connected under Settings → Contact research providers. LinkedIn search links are provided below for manual research.` });
    }
    run.finishedAt = now();
    run.candidateCount = new Set(run.results).size;
    store.insert('researchRuns', run);
    if (project && project.stage === 'verified' && run.candidateCount) store.update('projects', projectId, { stage: 'researching', updatedAt: now() });
    bus.publish('research.completed', { projectId, companyId, candidates: run.candidateCount });
    return viewRun(run);
  }

  function viewRun(run) {
    const candidates = run.results.length ? Array.from(new Set(run.results)).map((id) => store.get('candidates', id)).filter(Boolean).sort((a, b) => (b.score?.total || 0) - (a.score?.total || 0)) : [];
    return { ...run, candidates };
  }

  function candidatesFor({ projectId, companyId }) {
    return store.list('candidates').filter((c) => (projectId && c.projectId === projectId) || (companyId && c.companyId === companyId)).sort((a, b) => (b.score?.total || 0) - (a.score?.total || 0));
  }

  async function verifyCandidateEmail(candidateId) {
    const c = store.get('candidates', candidateId);
    if (!c?.email) throw Object.assign(new Error('Candidate has no email to verify'), { status: 400 });
    const settings = settingsService.get();
    const providers = enabledProviders(settings).filter((p) => PROVIDER_INFO[p].capabilities.emailVerification === true);
    const order = providers.length ? providers : enabledProviders(settings);
    if (!order.length) throw Object.assign(new Error('No provider enabled for email verification (Hunter.io offers a dedicated verifier).'), { status: 409 });
    const r = await PROVIDERS[order[0]].verifyEmail(settings.providers[order[0]], c.email, { fetchImpl });
    const emailVerification = { ...r, provider: order[0], checkedAt: now() };
    const updated = store.update('candidates', candidateId, { emailVerification, updatedAt: now() });
    updated.score = scoreCandidate(updated, { project: updated.projectId ? store.get('projects', updated.projectId) : null, companyRole: updated.companyRole, opportunityType: updated.projectId ? store.get('projects', updated.projectId)?.classification?.opportunityType : 'construction' });
    store.update('candidates', candidateId, { score: updated.score });
    if (updated.existingContactId) store.update('contacts', updated.existingContactId, { emailVerification, lastVerifiedAt: now() });
    return updated;
  }

  /** Save a candidate as a CRM contact (deduplicated by email, then name+company). */
  function saveCandidate(candidateId, { verifiedBy = 'user', linkedinUrl } = {}) {
    const c = store.get('candidates', candidateId);
    if (!c) throw Object.assign(new Error('Candidate not found'), { status: 404 });
    const existing = c.existingContactId ? store.get('contacts', c.existingContactId) : store.list('contacts').find((x) => x.environment === 'live' && dedupeKey(x) === dedupeKey(c));
    const sources = [...(existing?.sources || []), { provider: c.provider, label: c.sourceLabel, url: c.sourceUrl, retrievedAt: c.updatedAt }];
    const role = c.companyRole === 'generalContractor' ? 'general_contractor' : c.companyRole === 'applicant' ? 'developer' : c.companyRole === 'propertyOwner' ? 'property_owner' : c.companyRole === 'propertyManager' ? 'property_manager' : (/estimat|precon/i.test(c.title || '') ? 'estimator' : /procure|purchas/i.test(c.title || '') ? 'procurement' : /facilit/i.test(c.title || '') ? 'facilities' : /property manag/i.test(c.title || '') ? 'property_manager' : /asset/i.test(c.title || '') ? 'asset_manager' : 'other');
    const contact = crmService.upsertContact({
      id: existing?.id, firstName: c.firstName, lastName: c.lastName, email: c.email || existing?.email || null, phone: c.phone || existing?.phone || null, title: c.title || existing?.title || null, company: c.companyName || c.company, companyId: c.companyId || existing?.companyId || null,
      role: existing?.role && existing.role !== 'other' ? existing.role : role, provenance: 'third_party', sourceNote: `${PROVIDER_INFO[c.provider]?.name || c.provider}${c.sourceUrl ? ` — ${c.sourceUrl}` : ''}`, confidence: c.score?.total ?? null,
      projectIds: [...(existing?.projectIds || []), ...(c.projectId ? [c.projectId] : [])], environment: 'live', notes: existing?.notes || '',
    });
    const extra = { linkedinUrl: linkedinUrl || c.linkedinUrl || existing?.linkedinUrl || null, linkedinVerifiedAt: linkedinUrl ? now() : existing?.linkedinVerifiedAt || null, emailVerification: c.emailVerification || existing?.emailVerification || null, lastVerifiedAt: c.emailVerification?.checkedAt || existing?.lastVerifiedAt || null, sources, contactScore: c.score || null, candidateId: c.id, savedBy: verifiedBy, savedAt: now() };
    store.update('contacts', contact.id, extra);
    store.update('candidates', candidateId, { status: 'saved', existingContactId: contact.id, updatedAt: now() });
    if (c.companyName && !store.list('companies').some((x) => x.environment === 'live' && x.name.toLowerCase() === c.companyName.toLowerCase())) crmService.upsertCompany({ name: c.companyName, type: role === 'general_contractor' ? 'general_contractor' : role === 'developer' ? 'developer' : role === 'property_owner' ? 'property_owner' : 'other', domain: c.companyDomain || null, provenance: 'third_party', sourceNote: `${PROVIDER_INFO[c.provider]?.name || c.provider} search` });
    bus.publish('contact.saved', { id: contact.id, projectId: c.projectId });
    return store.get('contacts', contact.id);
  }

  function dismissCandidate(candidateId, reason = '') {
    const c = store.get('candidates', candidateId);
    if (!c) throw Object.assign(new Error('Candidate not found'), { status: 404 });
    return store.update('candidates', candidateId, { status: 'dismissed', dismissReason: reason, updatedAt: now() });
  }

  /** Record a manually found person (from LinkedIn or a website) as a verified candidate → contact. */
  function addManualContact({ projectId, companyName, companyRole, firstName, lastName, title, email, phone, linkedinUrl, sourceUrl, sourceNote }) {
    if (!firstName && !lastName && !email) throw Object.assign(new Error('A name or email is required'), { status: 400 });
    const project = projectId ? store.get('projects', projectId) : null;
    const doc = store.insert('candidates', { id: store.newId('cand'), provider: 'manual', projectId: projectId || null, companyId: null, companyRole: companyRole || null, companyName: companyName || null, firstName, lastName, title: title || null, company: companyName || null, email: email || null, phone: phone || null, linkedinUrl: linkedinUrl || null, sourceUrl: sourceUrl || linkedinUrl || null, sourceLabel: sourceNote || 'Found by your team', projectConnection: 'confirmed_by_user', linkedinVerifiedAt: linkedinUrl ? now() : null, status: 'candidate', environment: 'live', createdAt: now(), updatedAt: now() });
    doc.score = scoreCandidate(doc, { project, companyRole, opportunityType: project?.classification?.opportunityType });
    store.update('candidates', doc.id, { score: doc.score });
    return saveCandidate(doc.id, { verifiedBy: 'user', linkedinUrl });
  }

  async function enrichCompany(companyId) {
    const company = store.get('companies', companyId);
    if (!company) throw Object.assign(new Error('Company not found'), { status: 404 });
    const settings = settingsService.get();
    const errors = [];
    for (const pid of enabledProviders(settings)) {
      try {
        const r = await PROVIDERS[pid].enrichCompany(settings.providers[pid], { domain: company.domain, name: company.name, fetchImpl });
        if (r) { store.update('companies', companyId, { domain: r.domain || company.domain, website: r.website || company.website, industry: r.industry || company.industry || null, size: r.size || company.size || null, linkedinUrl: r.linkedinUrl || company.linkedinUrl || null, address: r.location || company.address, phone: r.phone || company.phone, enrichedBy: pid, enrichedAt: now(), sourceNote: `${company.sourceNote || ''}; ${r.sourceLabel}`.replace(/^; /, '') }); return { company: store.get('companies', companyId), provider: pid }; }
      } catch (err) { errors.push(err.message); }
    }
    return { company, provider: null, errors: errors.length ? errors : ['No provider returned company details. Add the website/domain by hand to enable domain-based people search.'] };
  }

  return { findDecisionMakers, candidatesFor, verifyCandidateEmail, saveCandidate, dismissCandidate, addManualContact, relationshipFor, companiesFor, enrichCompany, linkedinLinks, titleSetFor, PROVIDER_INFO };
}
