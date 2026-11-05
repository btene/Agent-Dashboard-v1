// Commercial landscaping lead score (0–100). Every point has a written reason.
import { PROJECT_TYPE_LABELS } from './classify.js';

export const SCORE_CATEGORIES = [
  { key: 'size', label: 'Project size', max: 20 },
  { key: 'type', label: 'Project type', max: 20 },
  { key: 'timing', label: 'Project timing', max: 20 },
  { key: 'landscape', label: 'Landscaping requirement', max: 20 },
  { key: 'access', label: 'Decision-maker accessibility', max: 10 },
  { key: 'location', label: 'Location', max: 10 },
];

const TYPE_POINTS = {
  shopping_center: 20, industrial_logistics: 18, hospitality: 20, office: 18, mixed_use: 18, commercial: 16,
  retail: 14, institutional: 16, multifamily: 15, parking_site: 10, other: 6, residential_small: 0,
};

const EARLY_STATUS = /ready to issue|pc approved|pc info|plan check|not ready to issue|submitted|applied|in review|pending/i;
const ISSUED_STATUS = /^issued$|permit extended|re-activate|reactivated/i;
const LATE_STATUS = /finaled|cofo|cofc|closed|expired|revoke|refund|complete/i;

export function scoreProject(project, settings = {}) {
  const territory = settings.territory || {};
  const prefs = settings.scoring || {};
  const cls = project.classification || {};
  const breakdown = [];
  const add = (key, points, max, reason) => breakdown.push({ key, label: SCORE_CATEGORIES.find((c) => c.key === key).label, points: Math.max(0, Math.min(max, Math.round(points))), max, reason });

  // ---- Size (20) — valuation and footprint, but never assume a big building means big landscaping.
  const v = project.valuation;
  const sf = project.squareFootage;
  if (v == null && sf == null) add('size', 4, 20, 'No valuation or square footage published — size unknown');
  else {
    let p = 0; const why = [];
    if (v != null) { p += v >= 50e6 ? 14 : v >= 20e6 ? 12 : v >= 5e6 ? 10 : v >= 1e6 ? 7 : v >= 250e3 ? 4 : 1; why.push(`valuation $${Math.round(v).toLocaleString('en-US')}`); }
    if (sf != null) { p += sf >= 200e3 ? 6 : sf >= 50e3 ? 5 : sf >= 10e3 ? 3 : 1; why.push(`${Math.round(sf).toLocaleString('en-US')} sq ft`); }
    if (v != null && sf == null) p += 2;
    add('size', p, 20, `Based on published ${why.join(' and ')}. Size does not by itself prove a large landscape scope.`);
  }

  // ---- Type (20)
  const type = cls.projectType || 'other';
  add('type', TYPE_POINTS[type] ?? 6, 20, type === 'residential_small'
    ? 'Individual home / small residential — excluded from commercial targeting'
    : `${PROJECT_TYPE_LABELS[type]} (estimated from permit text, ${Math.round((cls.confidence || 0) * 100)}% confidence)`);

  // ---- Timing (20) — can a landscape contractor still be selected?
  const st = project.status || '';
  const issuedAgeDays = project.issuedAt ? (Date.now() - Date.parse(project.issuedAt)) / 86_400_000 : null;
  if (project.bidDeadline && Date.parse(project.bidDeadline) > Date.now()) add('timing', 20, 20, `Bid deadline ${project.bidDeadline.slice(0, 10)} is still open`);
  else if (LATE_STATUS.test(st)) add('timing', 2, 20, `Status "${st}" — construction is finished or the permit is closed`);
  else if (EARLY_STATUS.test(st)) add('timing', 18, 20, `Status "${st}" — permit not yet issued, subcontractors likely not selected`);
  else if (ISSUED_STATUS.test(st) || st === '') {
    if (issuedAgeDays == null) add('timing', 10, 20, 'Permit issued; issue date not published');
    else if (issuedAgeDays <= 90) add('timing', 16, 20, `Issued ${Math.round(issuedAgeDays)} days ago — early construction, landscape usually bid later`);
    else if (issuedAgeDays <= 365) add('timing', 12, 20, `Issued ${Math.round(issuedAgeDays)} days ago — mid-construction, landscape package may still be open`);
    else if (issuedAgeDays <= 730) add('timing', 6, 20, `Issued ${Math.round(issuedAgeDays / 30)} months ago — landscape likely awarded`);
    else add('timing', 2, 20, `Issued over two years ago`);
  } else add('timing', 8, 20, `Status "${st}" not recognised — timing uncertain`);

  // ---- Landscaping requirement (20) — the deciding category for "real opportunity vs general permit".
  if (project.landscapeScopeDocumented) add('landscape', 20, 20, `Landscape scope confirmed: "${String(project.landscapeScopeDocumented).slice(0, 80)}"`);
  else if (cls.landscapeRelevance === 'strong' && cls.landscapeLikelihood === 'documented') add('landscape', 17, 20, `Permit text mentions landscape work: ${cls.landscapeSignals.filter((s) => /landscape|irrigation|planting|plant material/.test(s)).join('; ')} (not yet confirmed from plans)`);
  else if (cls.landscapeRelevance === 'strong') add('landscape', 13, 20, `${cls.relevanceReasons[0]} — scope size not yet confirmed`);
  else if (cls.landscapeRelevance === 'possible') add('landscape', 6, 20, `${cls.relevanceReasons[0]} — needs research`);
  else add('landscape', 0, 20, cls.relevanceReasons[0] || 'No landscape scope expected');

  // ---- Decision-maker accessibility (10)
  const named = [project.generalContractor && 'general contractor', project.applicant && 'applicant/developer', project.propertyOwner && 'property owner'].filter(Boolean);
  const contactCount = project.contactCount || 0;
  if (contactCount > 0) add('access', 10, 10, `${contactCount} contact${contactCount > 1 ? 's' : ''} on file${named.length ? ` (${named.join(', ')} identified)` : ''}`);
  else if (named.length >= 2) add('access', 7, 10, `${named.join(' and ')} identified, no contact details yet`);
  else if (named.length === 1) add('access', 5, 10, `${named[0]} identified, no contact details yet`);
  else add('access', 1, 10, 'No developer, contractor or owner named in the record — needs research');

  // ---- Location (10)
  const preferred = (territory.preferredCities || []).map((c) => c.toLowerCase());
  const counties = (territory.counties || ['Santa Barbara', 'Ventura', 'Los Angeles', 'San Bernardino', 'Orange']).map((c) => c.toLowerCase());
  const city = (project.city || '').toLowerCase();
  const county = (project.county || '').toLowerCase();
  if (city && preferred.includes(city)) add('location', 10, 10, `${project.city} is a preferred city in your territory`);
  else if (county && counties.includes(county)) add('location', 7, 10, `${project.county} County is inside your service territory`);
  else if (!city && !county) add('location', 3, 10, 'Location not published');
  else add('location', 1, 10, `${project.city || project.county} is outside the configured territory`);

  let total = breakdown.reduce((s, b) => s + b.points, 0);
  const notes = [];
  if (cls.excluded) { total = Math.min(total, 15); notes.push('Capped at 15: individual homes and small residential projects are excluded.'); }
  if (cls.landscapeRelevance === 'unlikely' && !cls.excluded && !project.landscapeScopeDocumented) {
    total = Math.min(total, cls.opportunityType === 'maintenance' ? 45 : 30);
    notes.push(cls.opportunityType === 'maintenance'
      ? 'Capped at 45: this permit is not a landscape-construction opportunity, but the property type may carry a maintenance contract.'
      : 'Capped at 30: general construction permit with no landscape scope indicated (interior, roofing, equipment or similar).');
  }
  if (prefs.minValuation && v != null && v < prefs.minValuation) { total = Math.min(total, 30); notes.push(`Capped at 30: below your minimum valuation of $${Number(prefs.minValuation).toLocaleString('en-US')}.`); }

  return { total, breakdown, notes, scoredAt: new Date().toISOString(), version: 'als2000-v1' };
}

export const SCORE_TIERS = [
  { min: 75, label: 'High priority', key: 'high' },
  { min: 50, label: 'Worth pursuing', key: 'medium' },
  { min: 25, label: 'Low priority', key: 'low' },
  { min: 0, label: 'Not a fit', key: 'none' },
];
export const tierFor = (total) => SCORE_TIERS.find((t) => total >= t.min);
