// Permitted file imports (CSV / Excel) for sources that only offer a portal
// export, and for licensed third-party providers such as ConstructConnect.
import * as XLSX from 'xlsx';

export const IMPORT_TARGET_FIELDS = [
  { key: 'permitNumber', label: 'Permit / project number', required: true },
  { key: 'projectName', label: 'Project name' },
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'county', label: 'County' },
  { key: 'zip', label: 'ZIP' },
  { key: 'description', label: 'Description / scope' },
  { key: 'permitType', label: 'Permit type' },
  { key: 'status', label: 'Status' },
  { key: 'appliedAt', label: 'Application date' },
  { key: 'issuedAt', label: 'Issue date' },
  { key: 'valuation', label: 'Valuation ($)' },
  { key: 'squareFootage', label: 'Square footage' },
  { key: 'applicant', label: 'Applicant / developer' },
  { key: 'propertyOwner', label: 'Property owner' },
  { key: 'generalContractor', label: 'General contractor' },
  { key: 'bidDeadline', label: 'Bid deadline' },
  { key: 'landscapeScope', label: 'Landscaping scope' },
  { key: 'sourceRecordUrl', label: 'Link to source record' },
  { key: 'lat', label: 'Latitude' },
  { key: 'lon', label: 'Longitude' },
];

const SYNONYMS = {
  permitNumber: ['permit', 'permit number', 'permit #', 'permit_nbr', 'record number', 'record id', 'project id', 'project number', 'application number', 'case number'],
  projectName: ['project', 'project name', 'title', 'name'],
  address: ['address', 'site address', 'project address', 'location', 'primary_address', 'street'],
  city: ['city', 'municipality'],
  county: ['county'],
  zip: ['zip', 'zip code', 'postal code', 'zip_code'],
  description: ['description', 'work description', 'work_desc', 'scope', 'scope of work', 'project description'],
  permitType: ['permit type', 'type', 'record type', 'permit_type'],
  status: ['status', 'permit status', 'status_desc', 'stage', 'project stage'],
  appliedAt: ['applied', 'application date', 'submitted', 'submitted_date', 'date applied', 'file date'],
  issuedAt: ['issued', 'issue date', 'issue_date', 'date issued'],
  valuation: ['valuation', 'value', 'estimated value', 'project value', 'job value', 'cost'],
  squareFootage: ['square footage', 'sq ft', 'sqft', 'square_footage', 'area'],
  applicant: ['applicant', 'developer', 'owner/developer', 'applicant name'],
  propertyOwner: ['owner', 'property owner', 'owner name'],
  generalContractor: ['contractor', 'general contractor', 'gc', 'contractor name'],
  bidDeadline: ['bid date', 'bid deadline', 'bids due', 'due date'],
  landscapeScope: ['landscape', 'landscaping', 'landscape scope'],
  sourceRecordUrl: ['url', 'link', 'source url', 'record url', 'project url'],
  lat: ['lat', 'latitude'],
  lon: ['lon', 'lng', 'longitude'],
};

export function parseSpreadsheet(buffer, filename = '') {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const columns = rows.length ? Object.keys(rows[0]) : [];
  return { rows, columns, sheetName: wb.SheetNames[0], filename };
}

/** Best-effort automatic column mapping the user can correct in the UI. */
export function suggestMapping(columns) {
  const mapping = {};
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();
  for (const [field, names] of Object.entries(SYNONYMS)) {
    const hit = columns.find((c) => names.includes(norm(c))) || columns.find((c) => names.some((n) => norm(c).includes(n) && n.length > 3));
    if (hit && !Object.values(mapping).includes(hit)) mapping[field] = hit;
  }
  return mapping;
}

const toNum = (v) => { if (v === '' || v == null) return null; const n = Number(String(v).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : null; };
const toDate = (v) => { if (!v) return null; const d = v instanceof Date ? v : new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
const toStr = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());

/** Turn parsed rows into normalized records using the (possibly edited) mapping. */
export function normalizeImportedRows(rows, mapping, source, { recordClass } = {}) {
  const out = [];
  const problems = [];
  rows.forEach((row, i) => {
    const get = (f) => (mapping[f] ? row[mapping[f]] : undefined);
    const permitNumber = toStr(get('permitNumber'));
    if (!permitNumber) { problems.push({ row: i + 2, problem: 'Missing permit/project number — row skipped' }); return; }
    const address = toStr(get('address'));
    const city = toStr(get('city')) || source.coverage?.defaultCity || null;
    out.push({
      sourceId: source.id,
      sourceName: source.name,
      sourceAgency: source.agency,
      recordClass: recordClass || source.recordClass || 'third_party',
      permitNumber,
      projectName: toStr(get('projectName')),
      sourceRecordUrl: toStr(get('sourceRecordUrl')),
      sourcePortalUrl: source.officialUrl,
      agencyLookupUrl: source.recordLookupUrl || null,
      address: address ? [address, city, 'CA', toStr(get('zip'))].filter(Boolean).join(', ') : null,
      streetAddress: address,
      city,
      county: toStr(get('county')) || source.coverage?.county || null,
      state: 'CA',
      zip: toStr(get('zip')),
      description: toStr(get('description')),
      permitType: toStr(get('permitType')),
      permitSubType: null,
      useDescription: null,
      appliedAt: toDate(get('appliedAt')),
      issuedAt: toDate(get('issuedAt')),
      status: toStr(get('status')),
      statusDate: null,
      valuation: toNum(get('valuation')),
      squareFootage: toNum(get('squareFootage')),
      applicant: toStr(get('applicant')),
      propertyOwner: toStr(get('propertyOwner')),
      generalContractor: toStr(get('generalContractor')),
      bidDeadline: toDate(get('bidDeadline')),
      landscapeScopeDocumented: toStr(get('landscapeScope')),
      lat: toNum(get('lat')),
      lon: toNum(get('lon')),
      sourceUpdatedAt: null,
      raw: row,
    });
  });
  return { records: out, problems };
}
