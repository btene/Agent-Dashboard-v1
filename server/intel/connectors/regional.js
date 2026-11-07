// Connectors for Southern California jurisdictions beyond the City of LA.
// Each exports { discover, lookup, metadata } with the same contract as laCity.js.
// All field values are copied from the government record or left null.
import { queryAll, layerStats, layerQueryUrl, centroid, esriDate, sqlDate } from './arcgis.js';
import { fetchJson, SourceUnavailableError } from './socrata.js';
import { recentMondays, reportUrls, parseReport, normalizeVenturaEntry } from './venturaPdf.js';

const str = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

// ---------------------------------------------------------------------------
// Riverside County — PLUS (Public Land Use System) activities, OpenData/General layer 280.
// Unincorporated Riverside County. No address, valuation or applicant fields;
// location comes from the parcel polygon. Landscape Permit (LSP/LPP) cases are
// government-documented landscape scopes.
export const RIVERSIDE_CASE_TYPES = [
  'LANDSCAPE PERMIT (LSP)', 'LANDSCAPE MINOR PLOT PLAN (LPP)', 'COMMERCIAL BUILDINGS (BNR)', 'MANUFACTURED BUILDINGS COMMERCIAL (BMN)',
  'GRADING (BGR)', 'PLOT PLAN TRANSMITTED (PPT)', 'PLOT PLAN ADMIN (PPA)', 'CONDITIONAL USE PERMIT (CUP)', 'TENTATIVE TRACT MAP (TTM)',
  'SPECIAL MULTI FAMILY DEVELOPMENT (SMF)', 'DEVELOPMENT AGREEMENT (DA)', 'TENANT IMPROVEMENT (BTI)',
];
const RIVERSIDE_TYPE_LABEL = { LSP: 'Landscape permit', LPP: 'Landscape minor plot plan', BNR: 'Commercial building', BMN: 'Commercial manufactured building', BGR: 'Grading', PPT: 'Plot plan (development review)', PPA: 'Plot plan (administrative)', CUP: 'Conditional use permit', TTM: 'Tentative tract map', SMF: 'Special multi-family development', DA: 'Development agreement', BTI: 'Tenant improvement' };

function riversideRecord(group, source) {
  const a = group[0].attributes;
  const code = (a.CASE_TYPE || '').match(/\(([A-Z]+)\)/)?.[1] || null;
  const { lat, lon } = centroid(group[0].geometry);
  const apns = Array.from(new Set(group.map((f) => f.attributes.APN).filter(Boolean)));
  const approved = a.APPROVED_DATE && a.APPROVED_DATE <= Date.now() + 86_400_000 ? esriDate(a.APPROVED_DATE) : null;
  const isLandscape = code === 'LSP' || code === 'LPP';
  const isBuilding = ['BNR', 'BMN', 'BTI'].includes(code);
  return {
    sourceId: source.id, sourceName: source.name, sourceAgency: source.agency, recordClass: 'government',
    permitNumber: str(a.CASE_ID), projectName: null,
    sourceRecordUrl: layerQueryUrl(source.config.layerUrl, { where: `CASE_ID='${a.CASE_ID}'`, outFields: '*', returnGeometry: false, f: 'html' }),
    sourcePortalUrl: source.officialUrl, agencyLookupUrl: source.recordLookupUrl || null,
    address: apns.length ? `APN ${apns.join(', ')}, unincorporated Riverside County, CA` : null, streetAddress: null,
    city: 'Unincorporated Riverside County', county: 'Riverside', state: 'CA', zip: null,
    description: str(a.CASE_DESCR),
    permitType: `${RIVERSIDE_TYPE_LABEL[code] || a.CASE_TYPE}${a.CASE_WORK_CLASS ? ` · ${a.CASE_WORK_CLASS}` : ''}`,
    // Make the existing classifier treat new commercial buildings as new construction.
    permitSubType: isBuilding ? 'Commercial' : null, useDescription: null,
    appliedAt: esriDate(a.APPLIED_DATE), issuedAt: approved, status: str(a.CASE_STATUS), statusDate: null,
    valuation: null, squareFootage: null, dwellingUnits: a.UNIT_COUNT || null, heightFt: a.HEIGHT || null, lat, lon, apn: apns.join(', ') || null,
    applicant: null, propertyOwner: null, generalContractor: null, bidDeadline: null, schedule: null,
    landscapeScopeDocumented: isLandscape ? `Riverside County landscape permit ${a.CASE_ID}: ${str(a.CASE_DESCR) || 'no description'}` : null,
    sourceUpdatedAt: null,
    raw: { ...a, caseCode: code, parcels: apns },
  };
}

function groupByCase(features) {
  const m = new Map();
  for (const f of features) { const k = f.attributes.CASE_ID; if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(f); }
  return [...m.values()];
}

export const riversideCounty = {
  async discover(source, { sinceIso, fetchImpl, maxRows = 4000 } = {}) {
    const types = RIVERSIDE_CASE_TYPES.map((t) => `'${t.replace(/'/g, "''")}'`).join(',');
    const where = `CASE_TYPE IN (${types})${sinceIso ? ` AND APPLIED_DATE >= ${sqlDate(sinceIso)}` : ''}`;
    const features = await queryAll(source.config.layerUrl, { where, outFields: 'CASE_ID,CASE_DESCR,CASE_TYPE,CASE_WORK_CLASS,CASE_STATUS,APPLIED_DATE,APPROVED_DATE,APN,BUILDING_COUNT,UNIT_COUNT,FLOOR_COUNT,HEIGHT', orderByFields: 'APPLIED_DATE DESC', maxRows }, { fetchImpl });
    return groupByCase(features).map((g) => riversideRecord(g, source));
  },
  async lookup(source, permitNumber, { fetchImpl } = {}) {
    const features = await queryAll(source.config.layerUrl, { where: `CASE_ID='${String(permitNumber).replace(/'/g, "''")}'`, outFields: '*', maxRows: 50 }, { fetchImpl });
    return features.length ? riversideRecord(features, source) : null;
  },
  async metadata(source, { fetchImpl } = {}) {
    const s = await layerStats(source.config.layerUrl, [{ statisticType: 'max', onStatisticField: 'APPLIED_DATE', outStatisticFieldName: 'latest' }], `APPLIED_DATE <= ${sqlDate(new Date(Date.now() + 86_400_000).toISOString())}`, { fetchImpl });
    return { name: 'Riverside County PLUS activities (OpenData/General layer 280)', rowsUpdatedAt: null, latestRecordAt: esriDate(s.latest), publisherRefreshRate: 'Not stated (new cases appear daily)', webUrl: source.officialUrl };
  },
};

// ---------------------------------------------------------------------------
// City of Santa Barbara — Building_Permits FeatureServer (Accela export).
const SB_TYPES = ['Commercial New', 'Commercial Alteration', 'Commercial Revision', 'Sitework Grading', 'Demolition'];
function santaBarbaraRecord(f, source) {
  const a = f.attributes;
  const { lat, lon } = centroid(f.geometry);
  const addr = str(a.Address);
  return {
    sourceId: source.id, sourceName: source.name, sourceAgency: source.agency, recordClass: 'government',
    permitNumber: str(a.RECORD_ID), projectName: str(a.Record_Name) && !/^[A-Z/ -]{2,15}$/.test(a.Record_Name) ? str(a.Record_Name) : null,
    sourceRecordUrl: layerQueryUrl(source.config.layerUrl, { where: `RECORD_ID='${a.RECORD_ID}'`, outFields: '*', returnGeometry: false, f: 'html' }),
    sourcePortalUrl: source.officialUrl, agencyLookupUrl: source.recordLookupUrl || null,
    address: addr, streetAddress: addr ? addr.replace(/,\s*SANTA BARBARA.*$/i, '') : null, city: 'Santa Barbara', county: 'Santa Barbara', state: 'CA', zip: addr?.match(/\b(\d{5})\b\s*$/)?.[1] || null,
    description: str(a.DESCRIPTION), permitType: str(a.Record_Type), permitSubType: /^Commercial/.test(a.Record_Type || '') ? 'Commercial' : null, useDescription: null,
    appliedAt: esriDate(a.Date_Opened), issuedAt: esriDate(a.Building_Permit_Date), status: str(a.RECORD_STATUS), statusDate: esriDate(a.Completed_Date),
    valuation: null, squareFootage: null, lat, lon, apn: str(a.APN),
    applicant: null, propertyOwner: null, generalContractor: null, bidDeadline: null, schedule: null,
    sourceUpdatedAt: esriDate(a.last_edited_date), raw: { ...a, parcelAreaSqFt: a.Area_in_Square_Feet },
  };
}
export const santaBarbaraCity = {
  async discover(source, { sinceIso, fetchImpl } = {}) {
    const where = `Record_Type IN (${SB_TYPES.map((t) => `'${t}'`).join(',')})${sinceIso ? ` AND Date_Opened >= ${sqlDate(sinceIso)}` : ''}`;
    const features = await queryAll(source.config.layerUrl, { where, orderByFields: 'Date_Opened DESC', maxRows: 2000 }, { fetchImpl });
    return features.map((f) => santaBarbaraRecord(f, source));
  },
  async lookup(source, permitNumber, { fetchImpl } = {}) {
    const f = await queryAll(source.config.layerUrl, { where: `RECORD_ID='${String(permitNumber).replace(/'/g, "''")}'`, maxRows: 5 }, { fetchImpl });
    return f.length ? santaBarbaraRecord(f[0], source) : null;
  },
  async metadata(source, { fetchImpl } = {}) {
    const s = await layerStats(source.config.layerUrl, [{ statisticType: 'max', onStatisticField: 'Date_Opened', outStatisticFieldName: 'latest' }, { statisticType: 'max', onStatisticField: 'last_edited_date', outStatisticFieldName: 'edited' }], '1=1', { fetchImpl });
    return { name: 'City of Santa Barbara Building_Permits', rowsUpdatedAt: esriDate(s.edited), latestRecordAt: esriDate(s.latest), publisherRefreshRate: 'Reloaded daily; newest permit shown by latestRecordAt', webUrl: source.officialUrl };
  },
  // A lookback longer than usual is needed because the publisher stopped adding new permits.
  defaultLookbackDays: 730,
};

// ---------------------------------------------------------------------------
// City of Santa Monica — "Active Building & Safety Permits" (CKAN datastore, daily).
const SM_SENTINEL = /^1900-/;
function santaMonicaRecord(r, source) {
  const d = (v) => (v && !SM_SENTINEL.test(v) ? new Date(`${v}T00:00:00Z`).toISOString() : null);
  const addr = str(r.address)?.replace(/\s+00000$/, '') || null;
  return {
    sourceId: source.id, sourceName: source.name, sourceAgency: source.agency, recordClass: 'government',
    permitNumber: str(r.permit_number), projectName: null,
    sourceRecordUrl: `https://data.santamonica.gov/api/3/action/datastore_search?resource_id=${source.config.resourceId}&filters=${encodeURIComponent(JSON.stringify({ permit_number: r.permit_number }))}`,
    sourcePortalUrl: source.officialUrl, agencyLookupUrl: source.recordLookupUrl || null,
    address: addr, streetAddress: addr ? addr.replace(/\s+SANTA MONICA.*$/i, '') : null, city: 'Santa Monica', county: 'Los Angeles', state: 'CA', zip: addr?.match(/(\d{5})$/)?.[1] || null,
    description: str(r.description), permitType: [str(r.permit_type), str(r.permit_sub_type)].filter(Boolean).join(' · ') || null,
    permitSubType: /Commercial/i.test(r.permit_type || '') ? 'Commercial' : /Multi|Apartment/i.test(r.class_code_description || '') ? 'Apartment' : null,
    useDescription: str(r.class_code_description),
    appliedAt: d(r.date_entered), issuedAt: d(r.date_issued), status: str(r.status), statusDate: null,
    valuation: r.valuation != null && Number(r.valuation) > 0 ? Number(r.valuation) : null, squareFootage: null,
    dwellingUnits: Number(r.number_of_units) || null, lat: r.latitude != null ? Number(r.latitude) : null, lon: r.longitude != null ? Number(r.longitude) : null, apn: str(r.parcel_no),
    applicant: null, propertyOwner: null, generalContractor: null, bidDeadline: null, schedule: null,
    sourceUpdatedAt: null, raw: r,
  };
}
async function smAll(source, opts) {
  const url = `https://data.santamonica.gov/api/3/action/datastore_search?resource_id=${source.config.resourceId}&limit=5000`;
  const data = await fetchJson(url, {}, opts);
  if (!data.success) throw new SourceUnavailableError(`CKAN error: ${JSON.stringify(data.error).slice(0, 200)}`);
  return data.result.records;
}
export const santaMonica = {
  async discover(source, { sinceIso, minValuation = 0, fetchImpl } = {}) {
    const rows = await smAll(source, { fetchImpl });
    return rows
      .filter((r) => (/Commercial|Multi/i.test(`${r.permit_type} ${r.class_code_description}`) || /^(10[3-5]|3[0-9]{2})$/.test(String(r.class_code || ''))) && Number(r.valuation || 0) >= minValuation)
      .filter((r) => !sinceIso || (r.date_entered && r.date_entered >= sinceIso.slice(0, 10)) || (r.date_issued && r.date_issued >= sinceIso.slice(0, 10)))
      .map((r) => santaMonicaRecord(r, source));
  },
  async lookup(source, permitNumber, { fetchImpl } = {}) {
    const url = `https://data.santamonica.gov/api/3/action/datastore_search?resource_id=${source.config.resourceId}&filters=${encodeURIComponent(JSON.stringify({ permit_number: permitNumber }))}`;
    const data = await fetchJson(url, {}, { fetchImpl });
    const r = data?.result?.records?.[0];
    return r ? santaMonicaRecord(r, source) : null;
  },
  async metadata(source, { fetchImpl } = {}) {
    const data = await fetchJson(`https://data.santamonica.gov/api/3/action/package_show?id=${source.config.packageId}`, {}, { fetchImpl });
    const r = data?.result || {};
    const fresh = (r.extras || []).find((e) => e.key === 'Data Freshness')?.value;
    return { name: r.title, rowsUpdatedAt: r.metadata_modified ? `${r.metadata_modified}Z` : null, publisherRefreshRate: fresh ? JSON.parse(fresh)['Update Frequency'] : null, webUrl: source.officialUrl };
  },
  // The dataset only holds currently active permits, so look at all of it every time.
  defaultLookbackDays: 3650,
};

// ---------------------------------------------------------------------------
// County of Ventura — weekly "Report of Permits Issued" PDFs (unincorporated county).
async function fetchPdf(url, fetchImpl) {
  const res = await (fetchImpl || fetch)(url, { signal: AbortSignal.timeout(30_000) }).catch((err) => { throw new SourceUnavailableError(`Could not reach rmadocs.venturacounty.gov: ${err.message}`); });
  if (res.status === 404) return null;
  if (!res.ok) throw new SourceUnavailableError(`Report request returned ${res.status}`);
  if (!/pdf/i.test(res.headers.get('content-type') || '')) return null;
  return Buffer.from(await res.arrayBuffer());
}
async function pdfText(buf) { const mod = await import('pdf-parse'); return (await (mod.default || mod)(buf)).text; }

const venturaLatest = new Map();
export const venturaCounty = {
  async discover(source, { sinceIso, minValuation = 0, fetchImpl } = {}) {
    let latest = null;
    const weeks = sinceIso ? Math.min(26, Math.ceil((Date.now() - Date.parse(sinceIso)) / (7 * 86_400_000)) + 1) : 8;
    const out = []; const found = [];
    for (const monday of recentMondays(weeks)) {
      for (const url of reportUrls(monday)) {
        const buf = await fetchPdf(url, fetchImpl);
        if (!buf) continue;
        const entries = parseReport(await pdfText(buf));
        found.push({ url, entries: entries.length });
        for (const e of entries) if (e.issuedOn && (!latest || e.issuedOn > latest)) latest = e.issuedOn;
        out.push(...entries.filter((e) => (e.valuation ?? 0) >= minValuation).map((e) => normalizeVenturaEntry(e, source, url)));
        break;
      }
    }
    if (!found.length) throw new SourceUnavailableError('No weekly report PDFs were found for the requested weeks. The county may have changed its report address.');
    venturaLatest.set(source.id, { latestRecordAt: latest ? `${latest}T00:00:00.000Z` : null, reports: found });
    return out;
  },
  async lookup(source, permitNumber, { fetchImpl, hintUrl } = {}) {
    // Re-read the report the record came from, if known, otherwise the last 8 weeks.
    const urls = hintUrl ? [hintUrl] : recentMondays(8).flatMap((m) => reportUrls(m));
    for (const url of urls) {
      const buf = await fetchPdf(url, fetchImpl);
      if (!buf) continue;
      const e = parseReport(await pdfText(buf)).find((x) => x.permitNumber === permitNumber);
      if (e) return normalizeVenturaEntry(e, source, url);
    }
    return null;
  },
  async metadata(source) {
    const seen = venturaLatest.get(source.id);
    return { name: 'County of Ventura weekly Report of Permits Issued', rowsUpdatedAt: null, latestRecordAt: seen?.latestRecordAt || null, reportsRead: seen?.reports || [], publisherRefreshRate: 'Weekly (PDF report, published about a week after the week ends)' };
  },
  defaultLookbackDays: 42,
};
