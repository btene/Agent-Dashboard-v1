// Runs connectors, upserts projects, records change history and source runs,
// and verifies individual projects against their original source.
import { SOURCE_DEFINITIONS, definitionFor, allowedPollOptions, REFRESH } from './sources.js';
import * as laCity from './connectors/laCity.js';
import { riversideCounty, santaBarbaraCity, santaMonica, venturaCounty } from './connectors/regional.js';
import { SourceUnavailableError } from './connectors/socrata.js';
import { parseSpreadsheet, suggestMapping, normalizeImportedRows } from './connectors/csvImport.js';
import { buildProject, applySourceUpdate, projectKey, PIPELINE_STAGES } from './projects.js';

const CONNECTORS = {
  socrata: {
    discover: (source, opts) => laCity.discover(source, opts),
    lookup: (source, permitNumber, opts) => laCity.lookup(source, permitNumber, opts),
    metadata: (source, opts) => laCity.metadata(source, opts),
  },
  'arcgis-riverside': riversideCounty,
  'arcgis-santa-barbara': santaBarbaraCity,
  'ckan-santa-monica': santaMonica,
  'ventura-pdf': venturaCounty,
  csv: null, // import-only; handled by importFile()
};

export const SOURCE_UNAVAILABLE_TEXT = 'Source unavailable — verification pending';

export function createSourceService({ store, bus, settingsService, fetchImpl }) {
  const now = () => new Date().toISOString();

  /** Merge static definitions with stored runtime state. Creates state rows on first use. */
  function syncRegistry() {
    for (const def of SOURCE_DEFINITIONS) {
      if (!store.get('sources', def.id)) {
        store.insert('sources', {
          id: def.id, enabled: def.enabledByDefault, config: { ...def.config }, pollInterval: CONNECTORS[def.connector] ? 'daily' : 'manual',
          status: CONNECTORS[def.connector] ? 'ready' : 'import_only', lastSuccessAt: null, lastAttemptAt: null, lastError: null,
          lastSourceUpdatedAt: null, recordCount: 0, nextRunAt: null, createdAt: now(), updatedAt: now(),
        });
      }
    }
  }

  function list() {
    syncRegistry();
    for (const def of SOURCE_DEFINITIONS) {
      const st = store.get('sources', def.id);
      if (st && st.status === 'import_only' && CONNECTORS[def.connector]) store.update('sources', def.id, { status: 'ready', pollInterval: 'daily' });
      if (st && ['ready', 'connected', 'error'].includes(st.status) && !CONNECTORS[def.connector]) store.update('sources', def.id, { status: 'import_only' });
    }
    return SOURCE_DEFINITIONS.map((def) => view(def.id));
  }

  function view(id) {
    const def = definitionFor(id);
    const state = store.get('sources', id);
    if (!def || !state) return null;
    const { config: stateConfig, ...rest } = state;
    const config = { ...def.config, ...stateConfig };
    const redacted = { ...config, appToken: config.appToken ? '••••' : '', apiKey: config.apiKey ? '••••' : undefined };
    const recordCount = store.list('projects').filter((p) => p.sourceId === id && p.environment === 'live').length;
    return {
      ...def, ...rest, config: redacted, hasAppToken: Boolean(config.appToken), recordCount,
      refresh: REFRESH[def.refreshFrequency], pollOptions: allowedPollOptions(def),
      recentRuns: store.list('sourceRuns').filter((r) => r.sourceId === id).slice(-10).reverse(),
      connectorSupported: Boolean(CONNECTORS[def.connector]),
    };
  }

  function resolved(id) {
    const def = definitionFor(id);
    const state = store.get('sources', id);
    if (!def || !state) throw Object.assign(new Error('Source not found'), { status: 404 });
    return { ...def, ...state, config: { ...def.config, ...state.config } };
  }

  function update(id, patch) {
    const state = store.get('sources', id);
    if (!state) throw Object.assign(new Error('Source not found'), { status: 404 });
    const def = definitionFor(id);
    const next = {};
    if (patch.enabled !== undefined) next.enabled = Boolean(patch.enabled);
    if (patch.pollInterval !== undefined) {
      if (!allowedPollOptions(def).some((o) => o.id === patch.pollInterval)) throw Object.assign(new Error(`This source publishes ${REFRESH[def.refreshFrequency].label.toLowerCase()} updates; "${patch.pollInterval}" is not offered for it.`), { status: 400 });
      next.pollInterval = patch.pollInterval;
    }
    if (patch.config && typeof patch.config === 'object') {
      next.config = { ...state.config };
      for (const [k, v] of Object.entries(patch.config)) if (typeof v === 'string' && v !== '••••') next.config[k] = v;
    }
    next.updatedAt = now();
    store.update('sources', id, next);
    return view(id);
  }

  function recordRun(sourceId, run) {
    const doc = store.insert('sourceRuns', { id: store.newId('srun'), sourceId, ...run });
    store.update('sources', sourceId, run.ok
      ? { lastAttemptAt: run.finishedAt, lastSuccessAt: run.finishedAt, lastError: null, status: 'connected', lastSourceUpdatedAt: run.sourceUpdatedAt || null, updatedAt: now() }
      : { lastAttemptAt: run.finishedAt, lastError: run.error, status: 'error', updatedAt: now() });
    if (run.ok && run.latestRecordAt !== undefined) store.update('sources', sourceId, { latestRecordAt: run.latestRecordAt, staleWarning: run.staleWarning || null });
    bus.publish('source.run', { sourceId, ...run });
    return doc;
  }

  /** Upsert normalized records. Returns counts and the list of touched project ids. */
  function upsertRecords(records, { environment = 'live', trigger = 'ingest' } = {}) {
    const settings = settingsService.get();
    const byKey = new Map(store.list('projects').filter((p) => p.environment === environment).map((p) => [p.key, p]));
    const result = { created: 0, updated: 0, unchanged: 0, ids: [] };
    for (const rec of records) {
      const key = projectKey(rec);
      const existing = byKey.get(key);
      if (!existing) {
        const p = buildProject(rec, { id: store.newId('prj'), environment, settings });
        store.insert('projects', p);
        store.insert('projectHistory', { id: store.newId('hist'), projectId: p.id, at: p.createdAt, type: 'created', trigger, changes: [], sourceTimestamp: rec.sourceUpdatedAt || null });
        byKey.set(key, p);
        result.created++;
        result.ids.push(p.id);
        bus.publish('project.created', { id: p.id, displayName: p.displayName, environment });
      } else {
        const changes = applySourceUpdate(existing, rec, { settings });
        store.update('projects', existing.id, existing);
        if (changes.length) {
          store.insert('projectHistory', { id: store.newId('hist'), projectId: existing.id, at: existing.updatedAt, type: 'source_changed', trigger, changes, sourceTimestamp: rec.sourceUpdatedAt || null });
          result.updated++;
          bus.publish('project.updated', { id: existing.id, changes: changes.length, environment });
        } else result.unchanged++;
        result.ids.push(existing.id);
      }
    }
    return result;
  }

  /** Run a connector-backed source now. */
  async function runSource(id, { trigger = 'manual', lookbackDays } = {}) {
    const source = resolved(id);
    const connector = CONNECTORS[source.connector];
    const startedAt = now();
    if (!connector) {
      const run = { ok: false, trigger, startedAt, finishedAt: now(), error: 'This source has no API. Upload an export from its portal instead.', created: 0, updated: 0, unchanged: 0 };
      return recordRun(id, run);
    }
    try {
      const settings = settingsService.get();
      const since = new Date(Date.now() - (lookbackDays || connector.defaultLookbackDays || (source.lastSuccessAt ? 45 : 365)) * 86_400_000).toISOString();
      // Discover first: some connectors (weekly reports) learn their freshness while reading.
      const records = await connector.discover(source, { sinceIso: since, minValuation: settings.scoring?.minValuation, fetchImpl });
      const meta = await connector.metadata(source, { fetchImpl }).catch(() => null);
      const counts = upsertRecords(records, { environment: 'live', trigger });
      // Newest record actually present at the source — catches publishers that stop adding data.
      const latestRecordAt = meta?.latestRecordAt || records.map((r) => r.appliedAt || r.issuedAt).filter(Boolean).sort().at(-1) || null;
      const staleDays = latestRecordAt ? Math.floor((Date.now() - Date.parse(latestRecordAt)) / 86_400_000) : null;
      const staleWarning = staleDays != null && staleDays > 60 ? `The newest record at this source is dated ${latestRecordAt.slice(0, 10)} (${staleDays} days ago). The publisher does not appear to be adding new permits.` : null;
      const run = { ok: true, trigger, startedAt, finishedAt: now(), error: null, fetched: records.length, ...counts, ids: undefined, sourceUpdatedAt: meta?.rowsUpdatedAt || records[0]?.sourceUpdatedAt || null, latestRecordAt, staleWarning, publisherRefreshRate: meta?.publisherRefreshRate || null, since };
      return recordRun(id, run);
    } catch (err) {
      const run = { ok: false, trigger, startedAt, finishedAt: now(), error: err.message, created: 0, updated: 0, unchanged: 0, unavailable: err instanceof SourceUnavailableError };
      return recordRun(id, run);
    }
  }

  /** Re-fetch one project from its original source and record what changed. */
  async function verifyProject(projectId, { trigger = 'manual' } = {}) {
    const project = store.get('projects', projectId);
    if (!project) throw Object.assign(new Error('Project not found'), { status: 404 });
    const checkedAt = now();
    const previous = Object.fromEntries(['status', 'statusDate', 'valuation', 'issuedAt', 'description', 'address', 'squareFootage', 'applicant', 'propertyOwner', 'generalContractor'].map((f) => [f, project[f] ?? null]));
    const base = { id: store.newId('ver'), projectId, trigger, checkedAt, previous };

    if (project.environment === 'demo') {
      const v = { ...base, status: 'demo', message: 'Demo records have no real source to verify against.', changes: [], retrievedAt: checkedAt, sourceTimestamp: null };
      store.insert('verifications', v);
      store.update('projects', projectId, { verification: { ...project.verification, status: 'demo', lastCheckedAt: checkedAt, error: v.message } });
      return v;
    }
    const def = definitionFor(project.sourceId);
    const connector = def && CONNECTORS[def.connector];
    if (!connector) {
      const v = { ...base, status: 'unavailable', message: `${SOURCE_UNAVAILABLE_TEXT}. ${def ? 'This source has no API; open the portal link and compare the record by hand, or re-import a fresh export.' : 'The source for this record is no longer registered.'}`, changes: [], retrievedAt: null, sourceTimestamp: null };
      store.insert('verifications', v);
      store.update('projects', projectId, { verification: { ...project.verification, status: 'pending', lastCheckedAt: checkedAt, error: v.message } });
      return v;
    }
    try {
      const source = resolved(project.sourceId);
      const rec = await connector.lookup(source, project.permitNumber, { fetchImpl, hintUrl: project.sourceRecordUrl });
      if (!rec) {
        const v = { ...base, status: 'not_found', message: 'The source no longer returns this permit number. The record was kept and marked for review.', changes: [], retrievedAt: now(), sourceTimestamp: null };
        store.insert('verifications', v);
        store.update('projects', projectId, { verification: { ...project.verification, status: 'not_found', lastCheckedAt: checkedAt, error: v.message } });
        return v;
      }
      const changes = applySourceUpdate(project, rec, { settings: settingsService.get() });
      store.update('projects', projectId, project);
      if (changes.length) store.insert('projectHistory', { id: store.newId('hist'), projectId, at: project.updatedAt, type: 'verified_changed', trigger, changes, sourceTimestamp: rec.sourceUpdatedAt || null });
      else store.insert('projectHistory', { id: store.newId('hist'), projectId, at: project.updatedAt, type: 'verified_unchanged', trigger, changes: [], sourceTimestamp: rec.sourceUpdatedAt || null });
      const v = { ...base, status: 'verified', message: changes.length ? `${changes.length} change${changes.length > 1 ? 's' : ''} detected` : 'No changes — the source record matches what we had', changes, current: Object.fromEntries(Object.keys(previous).map((f) => [f, project[f] ?? null])), retrievedAt: project.retrievedAt, sourceTimestamp: rec.sourceUpdatedAt || null };
      store.insert('verifications', v);
      bus.publish('project.verified', { id: projectId, changes: changes.length });
      return v;
    } catch (err) {
      const v = { ...base, status: 'unavailable', message: `${SOURCE_UNAVAILABLE_TEXT} (${err.message})`, changes: [], retrievedAt: null, sourceTimestamp: null };
      store.insert('verifications', v);
      store.update('projects', projectId, { verification: { ...project.verification, status: 'pending', lastCheckedAt: checkedAt, error: v.message } });
      return v;
    }
  }

  /** Stage 1 of a file import: parse and suggest a column mapping. */
  function previewImport(buffer, filename, sourceId) {
    resolved(sourceId);
    const { rows, columns, sheetName } = parseSpreadsheet(buffer, filename);
    const mapping = suggestMapping(columns);
    const doc = store.insert('imports', { id: store.newId('imp'), sourceId, filename, sheetName, columns, rowCount: rows.length, mapping, status: 'preview', rows, createdAt: now() });
    const { rows: _r, ...publicDoc } = doc;
    return { ...publicDoc, sample: rows.slice(0, 5) };
  }

  /** Stage 2: commit with the (possibly edited) mapping. */
  function commitImport(importId, mapping, { environment = 'live' } = {}) {
    const imp = store.get('imports', importId);
    if (!imp) throw Object.assign(new Error('Import not found'), { status: 404 });
    if (imp.status === 'committed') throw Object.assign(new Error('Import already committed'), { status: 409 });
    const source = resolved(imp.sourceId);
    const { records, problems } = normalizeImportedRows(imp.rows, mapping || imp.mapping, source);
    const counts = upsertRecords(records, { environment, trigger: 'import' });
    const finishedAt = now();
    recordRun(imp.sourceId, { ok: true, trigger: 'import', startedAt: imp.createdAt, finishedAt, error: null, fetched: imp.rows.length, created: counts.created, updated: counts.updated, unchanged: counts.unchanged, skipped: problems.length, filename: imp.filename });
    store.update('imports', importId, { status: 'committed', mapping: mapping || imp.mapping, rows: [], committedAt: finishedAt, result: { ...counts, ids: undefined, problems } });
    return { ...counts, problems };
  }

  /** Live checks for the Integration diagnostics page. */
  async function diagnose(id) {
    const source = resolved(id);
    const def = definitionFor(id);
    const checks = [];
    const t0 = Date.now();
    if (CONNECTORS[def.connector]) {
      try {
        const meta = await CONNECTORS[def.connector].metadata(source, { fetchImpl });
        checks.push({ name: 'Reach the publisher', ok: true, detail: `${meta.name} — publisher last updated ${meta.rowsUpdatedAt || 'unknown'}; stated refresh: ${meta.publisherRefreshRate || 'not stated'}${meta.latestRecordAt ? `; newest record ${meta.latestRecordAt.slice(0, 10)}` : ''}`, latencyMs: Date.now() - t0 });
      } catch (err) {
        checks.push({ name: 'Reach the publisher', ok: false, detail: err.message, latencyMs: Date.now() - t0 });
      }
      try {
        const t1 = Date.now();
        const sample = await CONNECTORS[def.connector].discover(source, { sinceIso: new Date(Date.now() - (def.connector === 'socrata' ? 180 : (CONNECTORS[def.connector].defaultLookbackDays || 180)) * 86_400_000).toISOString(), minValuation: def.connector === 'socrata' ? 1_000_000 : 0, maxRows: def.connector === 'socrata' ? 1 : 50, fetchImpl });
        checks.push({ name: 'Retrieve a real record', ok: sample.length > 0, detail: sample.length ? `Permit ${sample[0].permitNumber} at ${sample[0].address} — ${sample[0].sourceRecordUrl}` : 'Query succeeded but returned no rows', latencyMs: Date.now() - t1, sample: sample[0] ? { permitNumber: sample[0].permitNumber, address: sample[0].address, status: sample[0].status, issuedAt: sample[0].issuedAt, valuation: sample[0].valuation, sourceRecordUrl: sample[0].sourceRecordUrl } : null });
      } catch (err) {
        checks.push({ name: 'Retrieve a real record', ok: false, detail: err.message });
      }
    } else {
      checks.push({ name: 'API available', ok: false, detail: 'No public API. Import exports from the portal instead.', info: true });
      checks.push({ name: 'Import ready', ok: true, detail: 'CSV and Excel uploads are accepted for this source.' });
    }
    checks.push({ name: 'Enabled for automatic monitoring', ok: source.enabled, detail: source.enabled ? `Polling: ${source.pollInterval}` : 'Switched off', info: true });
    return { sourceId: id, checkedAt: now(), checks, ok: checks.filter((c) => !c.info).every((c) => c.ok) };
  }

  return { syncRegistry, list, view, resolved, update, runSource, verifyProject, upsertRecords, previewImport, commitImport, diagnose, PIPELINE_STAGES };
}
