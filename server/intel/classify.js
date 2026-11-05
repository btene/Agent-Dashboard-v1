// Rule-based classification of a permit record. Everything produced here is an
// ESTIMATE derived from the record's text, and is labelled as such
// (provenance "ai_estimate"). It is never presented as a verified fact.

export const PROJECT_TYPES = [
  'commercial', 'industrial_logistics', 'shopping_center', 'retail', 'hospitality', 'office',
  'multifamily', 'mixed_use', 'institutional', 'parking_site', 'residential_small', 'other',
];

export const PROJECT_TYPE_LABELS = {
  commercial: 'Commercial development', industrial_logistics: 'Industrial / logistics', shopping_center: 'Shopping center',
  retail: 'Retail', hospitality: 'Hotel / resort', office: 'Office', multifamily: 'Multifamily (commercial-scale)',
  mixed_use: 'Mixed-use', institutional: 'Institutional (school, hospital, civic)', parking_site: 'Parking / site work',
  residential_small: 'Individual home / small residential', other: 'Other / unclear',
};

const RULES = [
  ['industrial_logistics', /\b(warehouse|distribution|logistics|industrial|manufactur|fulfil+ment|cold storage|truck)/i],
  ['hospitality', /\b(hotel|motel|resort|hospitality|inn\b|lodging)/i],
  ['mixed_use', /\b(mixed[- ]use|mixed use|retail over|over retail|ground floor (retail|commercial)|with ground floor)/i],
  ['shopping_center', /\b(shopping center|shopping centre|mall\b|retail center|retail plaza)/i],
  ['institutional', /\b(school|university|college|campus|hospital|medical center|clinic|church|library|civic|fire station|police|courthouse|government)/i],
  ['office', /\b(office)/i],
  ['retail', /\b(retail|restaurant|store|market|grocery|shop\b|dealership|bank\b)/i],
  ['parking_site', /\b(parking (structure|garage|lot)|site work|grading|paving)/i],
  ['multifamily', /\b(apartment|apartments|multi[- ]?family|condominium|condo|units?\b|senior housing|affordable housing|dwelling units)/i],
  ['commercial', /\b(commercial)/i],
];

const SMALL_RESIDENTIAL = /\b(single[- ]family|1 or 2 family|duplex|adu\b|accessory dwelling|sfd\b|residential remodel|kitchen|bathroom|bedroom|garage conversion|pool|spa\b)/i;

export const LANDSCAPE_TERMS = [
  ['landscap', 'landscape work mentioned'], ['irrigation', 'irrigation mentioned'], ['planting', 'planting mentioned'],
  ['plant material', 'plant material mentioned'], ['tree', 'trees mentioned'], ['hardscape', 'hardscape mentioned'],
  ['site improvement', 'site improvements mentioned'], ['site work', 'site work mentioned'], ['courtyard', 'courtyard mentioned'],
  ['plaza', 'plaza mentioned'], ['open space', 'open space mentioned'], ['podium deck', 'podium/roof deck mentioned'],
  ['roof deck', 'roof deck mentioned'], ['bioretention', 'bioretention / stormwater planting mentioned'], ['bioswale', 'bioswale mentioned'],
  ['green roof', 'green roof mentioned'], ['streetscape', 'streetscape mentioned'], ['parking lot', 'parking lot (typically requires landscape islands/screening)'],
];

export function classifyProject(rec) {
  const text = [rec.description, rec.useDescription, rec.permitSubType, rec.permitType, rec.projectName].filter(Boolean).join(' \n ');
  const reasons = [];
  let type = 'other';
  let confidence = 0.35;

  if (SMALL_RESIDENTIAL.test(text) && !/\b(apartment|units|mixed|commercial)/i.test(text)) {
    type = 'residential_small';
    confidence = 0.8;
    reasons.push('Text describes an individual home or small residential work');
  } else if (/1 or 2 Family Dwelling/i.test(rec.permitSubType || '')) {
    type = 'residential_small';
    confidence = 0.9;
    reasons.push(`Permit sub-type is "${rec.permitSubType}"`);
  } else {
    for (const [t, re] of RULES) {
      const m = text.match(re);
      if (m) { type = t; confidence = 0.65; reasons.push(`Matched "${m[0].trim()}" in the permit description`); break; }
    }
    if (type === 'other' && /Commercial/i.test(rec.permitSubType || '')) { type = 'commercial'; confidence = 0.55; reasons.push('Permit sub-type is "Commercial" but the description does not say what kind'); }
    if (type === 'multifamily' && rec.dwellingUnits != null) {
      if (rec.dwellingUnits >= 20) { confidence = 0.8; reasons.push(`${rec.dwellingUnits} dwelling units on the permit`); }
      else { type = 'residential_small'; confidence = 0.6; reasons.push(`Only ${rec.dwellingUnits} dwelling units — below commercial scale`); }
    }
    if (type === 'multifamily' && /mixed|retail|commercial/i.test(text)) { type = 'mixed_use'; reasons.push('Also mentions retail/commercial space'); }
  }

  const landscapeSignals = LANDSCAPE_TERMS.filter(([term]) => text.toLowerCase().includes(term)).map(([, label]) => label);
  const newConstruction = /^Bldg-New$|^Nonbldg-New$/i.test(rec.permitType || '') || /\bnew\b/i.test(rec.description || '');
  if (newConstruction) landscapeSignals.push('New construction — site landscaping is normally required by local code');
  if (/grading/i.test(rec.permitType || '')) landscapeSignals.push('Grading permit — precedes site/landscape work');

  const landscapeLikelihood = landscapeSignals.length === 0 ? 'unknown' : landscapeSignals.some((s) => /landscape|irrigation|planting|plant material/.test(s)) ? 'documented' : 'likely';

  return {
    projectType: type,
    projectTypeLabel: PROJECT_TYPE_LABELS[type],
    confidence,
    reasons,
    landscapeLikelihood, // documented | likely | unknown
    landscapeSignals,
    excluded: type === 'residential_small',
    provenance: 'ai_estimate',
    method: 'rule-based text classification v1',
    classifiedAt: new Date().toISOString(),
  };
}
