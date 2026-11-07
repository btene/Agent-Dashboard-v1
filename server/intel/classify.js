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

const SMALL_RESIDENTIAL = /\b(single[- ]family|1 or 2 family|duplex|adu\b|accessory dwelling|n?sfd\b|n?sfr\b|new single[- ]family residence|residential remodel|kitchen|bathroom|bedroom|garage conversion|pool|spa\b|fire rebuild of a)/i;

export const LANDSCAPE_TERMS = [
  ['landscap', 'landscape work mentioned'], ['irrigation', 'irrigation mentioned'], ['planting', 'planting mentioned'],
  ['plant material', 'plant material mentioned'], ['tree', 'trees mentioned'], ['hardscape', 'hardscape mentioned'],
  ['site improvement', 'site improvements mentioned'], ['site work', 'site work mentioned'], ['courtyard', 'courtyard mentioned'],
  ['plaza', 'plaza mentioned'], ['open space', 'open space mentioned'], ['podium deck', 'podium/roof deck mentioned'],
  ['roof deck', 'roof deck mentioned'], ['bioretention', 'bioretention / stormwater planting mentioned'], ['bioswale', 'bioswale mentioned'],
  ['green roof', 'green roof mentioned'], ['streetscape', 'streetscape mentioned'], ['parking lot', 'parking lot (typically requires landscape islands/screening)'],
];

// Work that almost never involves exterior landscape: interior tenant
// improvements, equipment, roofing, signage, seismic, utilities.
export const NON_LANDSCAPE_WORK = [
  [/\b(tenant improvement|\bT\.?I\.?\b|interior (remodel|improvement|alteration|renovation|build[- ]?out)|office remodel|interior only)/i, 'interior tenant improvement'],
  [/\b(re-?roof|roofing|roof replacement|roof repair)\b/i, 'roofing'],
  [/\b(seismic|retrofit|soft[- ]story)\b/i, 'seismic retrofit'],
  [/\b(sign|signage|monument sign|wall sign)\b/i, 'signage'],
  [/\b(fire sprinkler|fire alarm|sprinkler system|NFPA)\b/i, 'fire protection'],
  [/\b(elevator|escalator)\b/i, 'elevator'],
  [/\b(HVAC|mechanical unit|rooftop unit|boiler|chiller)\b/i, 'mechanical equipment'],
  [/\b(solar|photovoltaic|PV system|battery storage|ESS)\b/i, 'solar / energy'],
  [/\b(EV charg|electric vehicle)\b/i, 'EV charging'],
  [/\b(cell site|antenna|telecom|wireless facility)\b/i, 'telecom'],
  [/\b(change of (use|occupancy)|occupancy change)\b/i, 'change of use'],
  [/\b(demolition|demo of|demolish)\b/i, 'demolition'],
  [/\b(ADA|accessibility|restroom|bathroom)\b/i, 'accessibility / restroom'],
  [/\b(window|storefront|facade|exterior paint)\b/i, 'facade / windows'],
];

// Property types that typically carry recurring commercial maintenance contracts.
const MAINTENANCE_TYPES = ['hospitality', 'multifamily', 'shopping_center', 'office', 'mixed_use', 'institutional', 'industrial_logistics', 'retail'];

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
  // "New" counts only when it describes a building or site element, not new partitions/ceilings inside an existing building.
  const newConstruction = /^Bldg-New$|^Nonbldg-New$/i.test(rec.permitType || '') || /\bnew\s+(\d+[- ]?(story|stories|storey)|building|construction|structure|warehouse|hotel|motel|center|centre|plaza|campus|facility|school|church|clinic|dealership|restaurant|store|parking (structure|lot|garage))\b/i.test(rec.description || '');
  if (newConstruction) landscapeSignals.push('New construction — site landscaping is normally required by local code');
  if (/grading/i.test(rec.permitType || '')) landscapeSignals.push('Grading permit — precedes site/landscape work');

  const landscapeLikelihood = landscapeSignals.length === 0 ? 'unknown' : landscapeSignals.some((s) => /landscape|irrigation|planting|plant material/.test(s)) ? 'documented' : 'likely';

  // ---- Landscape relevance: is this a genuine landscaping opportunity or a general permit?
  const nonLandscape = NON_LANDSCAPE_WORK.filter(([re]) => re.test(text)).map(([, label]) => label);
  const isAlteration = /Alter|Repair|Addition/i.test(rec.permitType || '') && !newConstruction;
  const mentionsLandscape = landscapeLikelihood === 'documented';
  let landscapeRelevance; const relevanceReasons = [];
  if (type === 'residential_small') { landscapeRelevance = 'unlikely'; relevanceReasons.push('Small residential work is outside commercial landscaping'); }
  else if (mentionsLandscape) { landscapeRelevance = 'strong'; relevanceReasons.push('The permit text itself mentions landscape, irrigation or planting work'); }
  else if (newConstruction && !nonLandscape.includes('demolition')) {
    landscapeRelevance = 'strong';
    relevanceReasons.push('New building on a site — local codes normally require new landscape, irrigation and street trees');
    if (rec.squareFootage != null && rec.squareFootage < 5000) { landscapeRelevance = 'possible'; relevanceReasons.push(`Only ${Math.round(rec.squareFootage).toLocaleString('en-US')} sq ft — small footprint limits the landscape scope`); }
  } else if (/grading/i.test(rec.permitType || '') || /\b(site work|site improvement|parking lot|hardscape|plaza|courtyard)\b/i.test(text)) {
    landscapeRelevance = 'possible'; relevanceReasons.push('Site work implied by the permit (grading, parking, plaza or courtyard) — landscape often follows');
  } else if (isAlteration && nonLandscape.length) {
    landscapeRelevance = 'unlikely'; relevanceReasons.push(`Alteration permit for ${nonLandscape.join(', ')} — no exterior landscape scope expected`);
  } else if (isAlteration) {
    landscapeRelevance = 'possible'; relevanceReasons.push('Alteration or addition permit with no mention of site work — a landscape scope is possible but not indicated');
  } else { landscapeRelevance = 'possible'; relevanceReasons.push('Nothing in the record confirms or rules out landscape work'); }
  if (nonLandscape.length && landscapeRelevance !== 'unlikely') relevanceReasons.push(`Note: the work also includes ${nonLandscape.join(', ')}`);

  // ---- Opportunity type: landscape construction vs recurring maintenance.
  const maintenanceCandidate = MAINTENANCE_TYPES.includes(type);
  let opportunityType;
  if (landscapeRelevance === 'unlikely') opportunityType = maintenanceCandidate && !isAlteration ? 'maintenance' : 'unlikely';
  else if ((newConstruction || landscapeRelevance === 'strong') && maintenanceCandidate) opportunityType = 'both';
  else if (newConstruction || landscapeRelevance === 'strong' || /grading/i.test(rec.permitType || '')) opportunityType = 'construction';
  else opportunityType = maintenanceCandidate ? 'maintenance' : 'unlikely';

  return {
    landscapeRelevance, // strong | possible | unlikely
    relevanceReasons,
    nonLandscapeWork: nonLandscape,
    opportunityType, // construction | maintenance | both | unlikely
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
