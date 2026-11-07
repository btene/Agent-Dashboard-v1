// Project records: normalization into the canonical shape, field provenance,
// upsert with change detection, and verification against the original source.
import { classifyProject } from './classify.js';
import { scoreProject, tierFor } from './scoring.js';

export const PROVENANCE = {
  government: { key: 'government', label: 'Verified government record' },
  third_party: { key: 'third_party', label: 'Verified third-party project information' },
  ai_estimate: { key: 'ai_estimate', label: 'Estimated (automated classification)' },
  unverified: { key: 'unverified', label: 'Unverified — needs research' },
  user: { key: 'user', label: 'Entered by your team' },
};

export const NOT_YET_VERIFIED = 'Not yet verified';

/** Fields copied verbatim from the source record and tracked for changes. */
export const SOURCE_FIELDS = [
  'permitNumber', 'projectName', 'address', 'streetAddress', 'city', 'county', 'state', 'zip', 'description', 'permitType', 'permitSubType',
  'useDescription', 'zoning', 'constructionType', 'appliedAt', 'issuedAt', 'status', 'statusDate', 'valuation', 'squareFootage',
  'dwellingUnits', 'heightFt', 'lat', 'lon', 'apn', 'applicant', 'propertyOwner', 'generalContractor', 'propertyManager', 'constructionManager', 'architect', 'bidDeadline', 'schedule',
  'landscapeScopeDocumented', 'sourceRecordUrl', 'sourcePortalUrl', 'agencyLookupUrl', 'sourceUpdatedAt',
];

export const PIPELINE_STAGES = ['discovered', 'verified', 'researching', 'contacted', 'replied', 'bid_submitted', 'awarded', 'lost', 'not_a_fit'];

export function projectKey(rec) {
  return `${rec.sourceId}::${String(rec.permitNumber).trim().toUpperCase()}`;
}

function provenanceMap(rec) {
  const p = {};
  for (const f of SOURCE_FIELDS) {
    if (rec[f] === null || rec[f] === undefined) p[f] = 'unverified';
    else p[f] = rec.recordClass === 'government' ? 'government' : 'third_party';
  }
  return p;
}

/** Build a complete project document from a normalized source record. */
export function buildProject(rec, { id, environment = 'live', settings = {}, now = new Date().toISOString() } = {}) {
  const base = { id, key: projectKey(rec), environment };
  for (const f of SOURCE_FIELDS) base[f] = rec[f] ?? null;
  base.sourceId = rec.sourceId;
  base.sourceName = rec.sourceName;
  base.sourceAgency = rec.sourceAgency;
  base.recordClass = rec.recordClass;
  base.provenance = provenanceMap(rec);
  base.raw = rec.raw || null;
  base.classification = classifyProject(base);
  base.displayName = rec.projectName || deriveDisplayName(base);
  base.retrievedAt = now;
  base.firstSeenAt = now;
  base.lastVerifiedAt = now;
  base.verification = { status: 'verified', lastCheckedAt: now, sourceTimestamp: rec.sourceUpdatedAt || null, retrievedAt: now, error: null, changes: 0 };
  base.stage = base.classification.excluded ? 'not_a_fit' : 'discovered';
  base.contactCount = 0;
  base.score = scoreProject(base, settings);
  base.tier = tierFor(base.score.total).key;
  base.notes = [];
  base.createdAt = now;
  base.updatedAt = now;
  return base;
}

/** A human-readable name that never invents facts: it is built from the address and permit type only. */
export function deriveDisplayName(p) {
  const what = p.classification?.projectTypeLabel && p.classification.projectType !== 'other' ? p.classification.projectTypeLabel : (p.permitSubType || p.permitType || 'Project');
  const where = p.streetAddress || p.address || (p.permitNumber ? `Permit ${p.permitNumber}` : 'Unknown address');
  return `${what} — ${where}`;
}

/** Compare the stored source fields with a freshly retrieved record. */
export function diffSourceFields(existing, rec) {
  const changes = [];
  for (const f of SOURCE_FIELDS) {
    if (f === 'sourceUpdatedAt' || f === 'sourceRecordUrl' || f === 'sourcePortalUrl' || f === 'agencyLookupUrl') continue;
    const before = existing[f] ?? null;
    const after = rec[f] ?? null;
    if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ field: f, before, after });
  }
  return changes;
}

/** Apply a freshly retrieved record to an existing project (verification or re-ingest). */
export function applySourceUpdate(existing, rec, { settings = {}, now = new Date().toISOString() } = {}) {
  const changes = diffSourceFields(existing, rec);
  for (const f of SOURCE_FIELDS) existing[f] = rec[f] ?? null;
  existing.provenance = { ...existing.provenance, ...provenanceMap(rec) };
  existing.raw = rec.raw || existing.raw;
  existing.classification = classifyProject(existing);
  if (!existing.userNamed) existing.displayName = rec.projectName || deriveDisplayName(existing);
  existing.retrievedAt = now;
  existing.lastVerifiedAt = now;
  existing.verification = { status: 'verified', lastCheckedAt: now, sourceTimestamp: rec.sourceUpdatedAt || null, retrievedAt: now, error: null, changes: changes.length };
  if (existing.stage === 'discovered' && !existing.classification.excluded) existing.stage = 'verified';
  existing.score = scoreProject(existing, settings);
  existing.tier = tierFor(existing.score.total).key;
  existing.updatedAt = now;
  return changes;
}

/**
 * What has actually been confirmed, as opposed to estimated. Shown on every
 * lead card so nobody mistakes an estimate for a verified fact.
 */
export function confirmations(p, contacts = []) {
  const scopeProv = p.provenance?.landscapeScopeDocumented;
  const landscapeScope = p.landscapeScopeDocumented && ['user', 'third_party', 'government'].includes(scopeProv)
    ? { status: 'confirmed', label: 'Landscape scope confirmed', detail: `Recorded from ${PROVENANCE[scopeProv]?.label.toLowerCase()}` }
    : p.classification?.landscapeLikelihood === 'documented'
      ? { status: 'indicated', label: 'Landscape mentioned in permit text', detail: 'Mentioned by the agency record but the scope and size are not confirmed' }
      : { status: 'unconfirmed', label: 'Landscape scope not confirmed', detail: 'Automated estimate only' };
  const verifiedContacts = contacts.filter((c) => c.environment === p.environment && (c.emailVerification?.status === 'valid' || c.linkedinVerifiedAt || c.provenance === 'user'));
  const anyContacts = contacts.filter((c) => c.environment === p.environment);
  const contact = verifiedContacts.length
    ? { status: 'confirmed', label: `${verifiedContacts.length} confirmed contact${verifiedContacts.length > 1 ? 's' : ''}`, detail: 'Verified email, verified LinkedIn profile, or entered by your team' }
    : anyContacts.length
      ? { status: 'indicated', label: `${anyContacts.length} unverified contact${anyContacts.length > 1 ? 's' : ''}`, detail: 'From a data provider; not yet verified by a person' }
      : { status: 'unconfirmed', label: 'No contact identified', detail: 'Use Find decision-makers' };
  const named = ['applicant', 'generalContractor', 'propertyOwner'].filter((f) => p[f]);
  const company = named.length
    ? { status: ['government', 'third_party', 'user'].includes(p.provenance?.[named[0]]) ? 'confirmed' : 'indicated', label: `${named.map((f) => ({ applicant: 'developer', generalContractor: 'GC', propertyOwner: 'owner' })[f]).join(', ')} named`, detail: named.map((f) => `${f}: ${PROVENANCE[p.provenance?.[f]]?.label || 'unknown source'}`).join('; ') }
    : { status: 'unconfirmed', label: 'No company named', detail: 'The source record does not name a developer, GC or owner' };
  return { landscapeScope, contact, company };
}

/** Shape sent to the UI: null source fields are replaced by the placeholder text with provenance kept alongside. */
export function presentProject(p, { includeRaw = false, contacts = [] } = {}) {
  const out = { ...p };
  out.confirmations = confirmations(p, contacts);
  if (!includeRaw) delete out.raw;
  out.display = {};
  for (const f of SOURCE_FIELDS) out.display[f] = p[f] === null || p[f] === undefined ? NOT_YET_VERIFIED : p[f];
  out.provenanceLabels = Object.fromEntries(Object.entries(p.provenance || {}).map(([k, v]) => [k, PROVENANCE[v]?.label || v]));
  out.isDemo = p.environment === 'demo';
  return out;
}
