// Demo environment: clearly fictional sample projects for learning the UI.
// They carry environment: "demo", permit numbers prefixed DEMO-, a fictional
// source, and are blocked from the outreach queue, CRM pipeline and metrics.
import { buildProject } from './projects.js';

export const DEMO_SOURCE = { id: 'demo-fictional', name: 'DEMO — fictional sample data (not a real agency)', agency: 'None — generated for demonstration', recordClass: 'third_party', officialUrl: null, config: {} };

const SAMPLES = [
  { permitNumber: 'DEMO-0001', projectName: 'DEMO: Harborview Logistics Center', streetAddress: '100 Example Way', city: 'Oxnard', county: 'Ventura', zip: '93030', description: 'FICTIONAL SAMPLE — new 180,000 sq ft distribution warehouse with truck court, employee parking lot, landscape and irrigation per approved plans', permitType: 'Bldg-New', permitSubType: 'Commercial', status: 'Issued', issuedAt: daysAgo(40), appliedAt: daysAgo(300), valuation: 24_500_000, squareFootage: 180_000, lat: 34.19, lon: -119.18, applicant: 'Example Industrial Partners (fictional)', generalContractor: 'Sample Builders Inc. (fictional)' },
  { permitNumber: 'DEMO-0002', projectName: 'DEMO: Mission Plaza Retail', streetAddress: '200 Placeholder Blvd', city: 'San Bernardino', county: 'San Bernardino', zip: '92401', description: 'FICTIONAL SAMPLE — new single-story retail shopping center, 4 buildings, parking lot with landscape islands and streetscape', permitType: 'Bldg-New', permitSubType: 'Commercial', status: 'Ready to Issue', appliedAt: daysAgo(120), valuation: 9_800_000, squareFootage: 42_000, lat: 34.108, lon: -117.29, propertyOwner: 'Fictional Holdings LLC' },
  { permitNumber: 'DEMO-0003', projectName: 'DEMO: Coastal Garden Hotel', streetAddress: '300 Sample St', city: 'Santa Barbara', county: 'Santa Barbara', zip: '93101', description: 'FICTIONAL SAMPLE — new 120-room hotel with pool courtyard, roof deck planting and drought-tolerant landscape', permitType: 'Bldg-New', permitSubType: 'Commercial', status: 'Issued', issuedAt: daysAgo(200), appliedAt: daysAgo(500), valuation: 38_000_000, squareFootage: 95_000, lat: 34.42, lon: -119.70 },
  { permitNumber: 'DEMO-0004', projectName: 'DEMO: Kitchen remodel', streetAddress: '4 Nowhere Ct', city: 'Los Angeles', county: 'Los Angeles', zip: '90001', description: 'FICTIONAL SAMPLE — kitchen and bathroom remodel for single-family dwelling', permitType: 'Bldg-Alter/Repair', permitSubType: '1 or 2 Family Dwelling', status: 'Issued', issuedAt: daysAgo(10), valuation: 60_000, squareFootage: 400, lat: 33.97, lon: -118.25 },
  { permitNumber: 'DEMO-0005', projectName: 'DEMO: Valley Commons Mixed-Use', streetAddress: '500 Mockup Ave', city: 'Los Angeles', county: 'Los Angeles', zip: '91401', description: 'FICTIONAL SAMPLE — 6-story mixed-use building, 210 apartments over ground-floor retail, podium courtyard with planting', permitType: 'Bldg-New', permitSubType: 'Apartment', status: 'Permit Finaled', issuedAt: daysAgo(900), valuation: 61_000_000, squareFootage: 240_000, dwellingUnits: 210, lat: 34.18, lon: -118.45 },
];

function daysAgo(n) { return new Date(Date.now() - n * 86_400_000).toISOString(); }

export function seedDemoProjects({ store, settings }) {
  const existing = store.list('projects').filter((p) => p.environment === 'demo');
  if (existing.length) return existing.length;
  const now = new Date().toISOString();
  for (const s of SAMPLES) {
    const rec = { ...DEMO_SOURCE, sourceId: DEMO_SOURCE.id, sourceName: DEMO_SOURCE.name, sourceAgency: DEMO_SOURCE.agency, state: 'CA', address: `${s.streetAddress}, ${s.city}, CA ${s.zip}`, sourceRecordUrl: null, sourcePortalUrl: null, ...s, raw: { demo: true } };
    const p = buildProject(rec, { id: store.newId('demo'), environment: 'demo', settings, now });
    p.verification = { status: 'demo', lastCheckedAt: now, sourceTimestamp: null, retrievedAt: now, error: 'Fictional sample — there is no real source to verify.', changes: 0 };
    p.displayName = s.projectName;
    store.insert('projects', p);
  }
  return SAMPLES.length;
}

export function clearDemoProjects({ store }) {
  const ids = new Set(store.list('projects').filter((p) => p.environment === 'demo').map((p) => p.id));
  store.removeWhere('projects', (p) => ids.has(p.id));
  store.removeWhere('projectHistory', (h) => ids.has(h.projectId));
  store.removeWhere('verifications', (v) => ids.has(v.projectId));
  store.removeWhere('contacts', (c) => c.environment === 'demo');
  store.removeWhere('companies', (c) => c.environment === 'demo');
  return ids.size;
}
