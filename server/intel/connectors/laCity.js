// Mapping for the City of Los Angeles "Building Permits Issued from 2020 to
// Present" dataset (data.lacity.org, id pi9x-tg5x). Every output field is
// copied from the government record or left null; nothing is inferred here.
import { query, resourceUrl, fetchMetadata } from './socrata.js';

export const LA_CITY_FIELDS = {
  permitNumber: 'permit_nbr', address: 'primary_address', zip: 'zip_code', description: 'work_desc',
  submitted: 'submitted_date', issued: 'issue_date', status: 'status_desc', statusDate: 'status_date',
  valuation: 'valuation', squareFootage: 'square_footage', lat: 'lat', lon: 'lon', refreshTime: 'refresh_time',
};

const COMMERCIAL_SUB_TYPES = ['Commercial', 'Apartment'];
const PROJECT_PERMIT_TYPES = ['Bldg-New', 'Bldg-Addition', 'Bldg-Alter/Repair', 'Grading', 'Nonbldg-New'];

/** SoQL filter that keeps only permits that could be commercial projects. */
export function discoveryWhere({ sinceIso, minValuation = 250_000 } = {}) {
  const parts = [
    `permit_sub_type IN (${COMMERCIAL_SUB_TYPES.map((s) => `'${s}'`).join(',')})`,
    `permit_type IN (${PROJECT_PERMIT_TYPES.map((s) => `'${s}'`).join(',')})`,
    `valuation::number >= ${Number(minValuation) || 0}`,
  ];
  if (sinceIso) parts.push(`issue_date >= '${sinceIso.slice(0, 19)}'`);
  return parts.join(' AND ');
}

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const str = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
const date = (v) => (v ? new Date(v).toISOString() : null);

/** Convert one raw LA City row into the platform's normalized record. */
export function normalizeLaCityRow(row, source) {
  const permitNumber = str(row.permit_nbr);
  const address = str(row.primary_address);
  const city = 'Los Angeles';
  return {
    sourceId: source.id,
    sourceName: source.name,
    sourceAgency: source.agency,
    recordClass: 'government',
    permitNumber,
    sourceRecordUrl: permitNumber ? resourceUrl(source.config, { permit_nbr: permitNumber }) : null,
    sourcePortalUrl: source.officialUrl,
    agencyLookupUrl: source.recordLookupUrl || null,
    address: address ? `${address}, ${city}, CA ${str(row.zip_code) || ''}`.trim() : null,
    streetAddress: address,
    city,
    county: 'Los Angeles',
    state: 'CA',
    zip: str(row.zip_code),
    description: str(row.work_desc),
    permitType: str(row.permit_type),
    permitSubType: str(row.permit_sub_type),
    useDescription: str(row.use_desc),
    zoning: str(row.zone),
    constructionType: str(row.construction),
    appliedAt: date(row.submitted_date),
    issuedAt: date(row.issue_date),
    status: str(row.status_desc),
    statusDate: date(row.status_date),
    valuation: num(row.valuation),
    squareFootage: num(row.square_footage),
    dwellingUnits: num(row.du_changed),
    heightFt: num(row.height),
    lat: num(row.lat),
    lon: num(row.lon),
    sourceUpdatedAt: date(row.refresh_time),
    // The open dataset does not include these; they stay null (= "Not yet verified").
    applicant: null, propertyOwner: null, generalContractor: null, bidDeadline: null, schedule: null,
    raw: row,
  };
}

export async function discover(source, { sinceIso, minValuation, maxRows = 2000, fetchImpl } = {}) {
  const where = discoveryWhere({ sinceIso, minValuation });
  const rows = await query(source.config, { where, order: 'issue_date DESC', maxRows }, { fetchImpl });
  return rows.map((r) => normalizeLaCityRow(r, source));
}

export async function lookup(source, permitNumber, { fetchImpl } = {}) {
  const safe = String(permitNumber).replace(/'/g, "''");
  const rows = await query(source.config, { where: `permit_nbr = '${safe}'`, maxRows: 5 }, { fetchImpl });
  return rows.length ? normalizeLaCityRow(rows[0], source) : null;
}

export async function metadata(source, opts) {
  return fetchMetadata(source.config, opts);
}
