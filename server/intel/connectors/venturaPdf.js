// County of Ventura — Division of Building and Safety "Report of Permits Issued"
// weekly PDFs (rmadocs.venturacounty.gov). There is no API or index page, so we
// request the report for each recent week by its published URL pattern and
// parse the entries. Every value comes from the PDF text; nothing is inferred.
const BASE = 'https://rmadocs.venturacounty.gov/building-and-safety/reports/weekly/';

/** Candidate URLs for the report issued for the week starting on `monday`. Both date spellings are used by the county. */
export function reportUrls(monday) {
  const y = monday.getUTCFullYear(); const m = monday.getUTCMonth() + 1; const d = monday.getUTCDate();
  const pad = (n) => String(n).padStart(2, '0');
  const forms = new Set([`${y}-${pad(m)}-${pad(d)}`, `${y}-${m}-${d}`, `${y}-${pad(m)}-${d}`, `${y}-${m}-${pad(d)}`]);
  return [...forms].map((f) => `${BASE}${f}-building-and-safety-report-permits-issued.pdf`);
}

export function recentMondays(weeks = 6, from = new Date()) {
  const out = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  for (let i = 0; i < weeks; i++) { out.push(new Date(d)); d.setUTCDate(d.getUTCDate() - 7); }
  return out;
}

const PERMIT_RE = /^([A-Z]{1,4}\d{2}-\d{4,6})(.*?)(\$[\d,]+\.\d\d)?$/;
const APN_RE = /^(\d{10})(Yes|No)?$/;

/** Parse the text of one report into permit entries. */
export function parseReport(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const entries = [];
  let office = null; let issuedOn = null; let permitType = null;
  let buf = [];
  const flush = (apn, electronic) => {
    const idx = buf.findIndex((l) => PERMIT_RE.test(l));
    if (idx < 0) { buf = []; return; }
    const address = buf.slice(0, idx).join(' ').replace(/\s+/g, ' ').trim();
    const m = buf[idx].match(PERMIT_RE);
    let rest = buf.slice(idx + 1);
    let valuation = m[3] || null;
    if (!valuation && rest[0] && /^\$[\d,]+\.\d\d$/.test(rest[0])) { valuation = rest[0]; rest = rest.slice(1); }
    const description = rest.join(' ').replace(/\s+/g, ' ').trim();
    entries.push({ permitNumber: m[1], projectType: (m[2] || '').trim() || null, valuation: valuation ? Number(valuation.replace(/[$,]/g, '')) : null, address: address || null, description: description || null, apn: apn, electronicSubmittal: electronic || null, office, issuedOn, permitType });
    buf = [];
  };
  for (const line of lines) {
    if (/^Note: Valuation items/.test(line) || /^Parcel NumberAddress/.test(line) || /^Valuation$|^Description$|^Electronic\s*$|^Submittal$/.test(line) || /^County of Ventura/.test(line) || /^Issued for the Week/.test(line) || /^Page \d+ of \d+/.test(line)) continue;
    if (/County Office$|Office$/.test(line) && line.length < 40) { office = line; buf = []; continue; }
    const di = line.match(/^Date of Issuance:\s*(.+)$/); if (di) { issuedOn = new Date(`${di[1]} UTC`).toISOString().slice(0, 10); buf = []; continue; }
    const pt = line.match(/^Permit Type:\s*(.+)$/); if (pt) { permitType = pt[1]; buf = []; continue; }
    const apn = line.match(APN_RE);
    if (apn) { flush(apn[1], apn[2]); continue; }
    const tail = line.match(/^(.*?)(\d{10})(Yes|No)$/);
    if (tail && buf.length) { if (tail[1]) buf.push(tail[1]); flush(tail[2], tail[3]); continue; }
    if (/^(Yes|No)$/.test(line)) continue;
    buf.push(line);
  }
  return entries;
}

const CITY_RE = /,\s*([A-Z][A-Z .'-]+?),\s*CA\s*(\d{5})?$/;

export function normalizeVenturaEntry(e, source, reportUrl) {
  const cm = e.address?.match(CITY_RE);
  const city = cm ? cm[1].trim().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\B\w+/g, (w) => w.toLowerCase()) : null;
  return {
    sourceId: source.id, sourceName: source.name, sourceAgency: source.agency, recordClass: 'government',
    permitNumber: e.permitNumber, projectName: null,
    sourceRecordUrl: reportUrl, sourcePortalUrl: source.officialUrl, agencyLookupUrl: source.recordLookupUrl || null,
    address: e.address, streetAddress: e.address ? e.address.replace(CITY_RE, '').trim() : null, city, county: 'Ventura', state: 'CA', zip: cm?.[2] || null,
    description: e.description, permitType: [e.permitType, e.projectType].filter(Boolean).join(' · ') || null, permitSubType: null, useDescription: null,
    appliedAt: null, issuedAt: e.issuedOn ? `${e.issuedOn}T00:00:00.000Z` : null, status: 'Issued', statusDate: e.issuedOn ? `${e.issuedOn}T00:00:00.000Z` : null,
    valuation: e.valuation, squareFootage: null, lat: null, lon: null, apn: e.apn,
    applicant: null, propertyOwner: null, generalContractor: null, bidDeadline: null, schedule: null,
    sourceUpdatedAt: e.issuedOn ? `${e.issuedOn}T00:00:00.000Z` : null,
    raw: { ...e, office: e.office, reportUrl },
  };
}
