import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApi, useLiveEvents, useThrottled } from '../lib/hooks.js';
import { when, ago, uploadFile, PROVENANCE_LABEL } from '../lib/intel.js';
import { Switch, Help } from '../components/intel.jsx';
import { ErrorBox, Modal } from '../components/ui.jsx';

function ImportWizard({ source, fields, onClose, onDone }) {
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function pick(file) {
    if (!file) return;
    setBusy(true); setError(null);
    try { const p = await uploadFile('/imports', file, { sourceId: source.id }); setPreview(p); setMapping(p.mapping); } catch (e) { setError(e); }
    setBusy(false);
  }
  async function commit() {
    setBusy(true); setError(null);
    try { setResult(await api(`/imports/${preview.id}/commit`, { method: 'POST', body: { mapping } })); onDone(); } catch (e) { setError(e); }
    setBusy(false);
  }
  return (
    <Modal title={`Import an export from ${source.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{result ? 'Close' : 'Cancel'}</button>{preview && !result && <button className="btn primary" disabled={busy || !mapping.permitNumber} onClick={commit}>Import {preview.rowCount} rows</button>}</>}>
      <div className="form">
        {!preview && (
          <>
            <Help>Export search results from the portal as CSV or Excel, then choose the file. Only exports you are permitted to download may be used; the system never bypasses a portal’s access controls.</Help>
            <label className="dropzone">{busy ? 'Reading file…' : 'Click to choose a .csv, .xlsx or .xls file'}<input type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={(e) => pick(e.target.files?.[0])} /></label>
          </>
        )}
        {preview && !result && (
          <>
            <Help>{preview.rowCount} rows found in “{preview.filename}”. Match each of your file’s columns to a field. “Permit / project number” is required; it is how duplicates are recognised on later imports.</Help>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
              {fields.map((f) => (
                <label key={f.key} className="field small">{f.label}{f.required && ' *'}
                  <select value={mapping[f.key] || ''} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value || undefined })}><option value="">— not in file —</option>{preview.columns.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                </label>
              ))}
            </div>
            <details><summary className="small">Preview first rows</summary><div className="table-wrap"><table className="small"><thead><tr>{preview.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{preview.sample.map((r, i) => <tr key={i}>{preview.columns.map((c) => <td key={c}>{String(r[c] ?? '')}</td>)}</tr>)}</tbody></table></div></details>
          </>
        )}
        {result && <div className="notice">Imported: {result.created} new, {result.updated} updated, {result.unchanged} unchanged, {result.problems.length} skipped.{result.problems.slice(0, 5).map((p, i) => <div key={i} className="small">Row {p.row}: {p.problem}</div>)}</div>}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function SourceCard({ s, fields, onChange }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [diag, setDiag] = useState(null);
  const [token, setToken] = useState('');
  const [importing, setImporting] = useState(false);
  async function run() { setBusy('run'); setError(null); try { await api(`/sources/${s.id}/run`, { method: 'POST', body: {} }); onChange(); } catch (e) { setError(e); } setBusy(null); }
  async function diagnose() { setBusy('diag'); setError(null); try { setDiag(await api(`/sources/${s.id}/diagnostics`)); } catch (e) { setError(e); } setBusy(null); }
  async function patch(body) { setError(null); try { await api(`/sources/${s.id}`, { method: 'PATCH', body }); onChange(); } catch (e) { setError(e); } }
  const statusLabel = { connected: 'Connected — retrieving records', ready: 'Ready — not run yet', error: 'Error', import_only: 'Import only (no API)' }[s.status] || s.status;
  return (
    <div className="card source-card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div><h3>{s.name}</h3><div className="small text-2">{s.agency}</div></div>
        <Switch checked={s.enabled} label="Enabled" onChange={(v) => patch({ enabled: v })} />
      </div>
      <div className="chips">
        <span className={`status-pill ${s.status}`}>{statusLabel}</span>
        <span className="tag">{{ api: 'Official API', portal: 'Web portal only', csv: 'Licensed export (CSV/Excel)' }[s.accessMethod]}</span>
        <span className="tag">{PROVENANCE_LABEL[s.recordClass]}</span>
        <span className="tag">Publisher refresh: {s.refresh?.label}</span>
        {s.recordCount > 0 && <span className="tag">{s.recordCount} live records</span>}
      </div>
      <dl className="kv small">
        <dt>Coverage</dt><dd>{s.coverage.jurisdiction}</dd>
        <dt>Official site</dt><dd><a href={s.officialUrl} target="_blank" rel="noreferrer">{s.officialUrl}</a></dd>
        <dt>Last successful retrieval</dt><dd>{s.lastSuccessAt ? `${when(s.lastSuccessAt)} (${ago(s.lastSuccessAt)})` : 'never'}</dd>
        <dt>Publisher last updated</dt><dd>{s.lastSourceUpdatedAt ? when(s.lastSourceUpdatedAt) : 'unknown'}</dd>
        {s.lastError && <><dt>Last error</dt><dd className="check-bad">{s.lastError}</dd></>}
        <dt>Licence</dt><dd>{s.license}</dd>
        <dt>Limitations</dt><dd>{s.limitations}</dd>
      </dl>
      <div className="row">
        <label className="field small" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>Check for updates
          <select value={s.pollInterval} onChange={(e) => patch({ pollInterval: e.target.value })} style={{ width: 170, padding: '4px 8px' }}>{s.pollOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
        </label>
        {s.pollOptions.length < 4 && <span className="small muted">Only intervals the publisher supports are offered. {s.refresh?.note}</span>}
      </div>
      {s.connector === 'socrata' && (
        <div className="row">
          <input placeholder={s.hasAppToken ? 'App token saved (enter a new one to replace)' : 'Optional Socrata app token'} value={token} onChange={(e) => setToken(e.target.value)} style={{ maxWidth: 320 }} />
          <button className="btn sm" disabled={!token} onClick={() => { patch({ config: { appToken: token } }); setToken(''); }}>Save token</button>
        </div>
      )}
      <div className="row">
        {s.connectorSupported && <button className="btn primary sm" disabled={busy} onClick={run}>{busy === 'run' ? 'Retrieving…' : 'Retrieve now'}</button>}
        <button className="btn sm" disabled={busy} onClick={diagnose}>{busy === 'diag' ? 'Testing…' : 'Run diagnostics'}</button>
        <button className="btn sm" onClick={() => setImporting(true)}>Import CSV / Excel</button>
        <Link className="btn sm ghost" to={`/admin#${s.id}`}>How to connect</Link>
      </div>
      {diag && <div className="stack" style={{ gap: 4 }}>{diag.checks.map((c, i) => <div key={i} className={`small ${c.info ? 'text-2' : c.ok ? 'check-ok' : 'check-bad'}`}>{c.info ? 'ℹ' : c.ok ? '✓' : '✗'} <strong>{c.name}</strong> — {c.detail}{c.sample?.sourceRecordUrl && <> · <a href={c.sample.sourceRecordUrl} target="_blank" rel="noreferrer">open the record</a></>}</div>)}</div>}
      {s.recentRuns?.length > 0 && <details><summary className="small">Recent retrievals ({s.recentRuns.length})</summary><div className="table-wrap"><table className="small"><thead><tr><th>When</th><th>Trigger</th><th>Result</th></tr></thead><tbody>{s.recentRuns.map((r) => <tr key={r.id}><td>{when(r.finishedAt)}</td><td>{r.trigger}</td><td className={r.ok ? '' : 'check-bad'}>{r.ok ? `${r.fetched ?? '—'} fetched · ${r.created} new · ${r.updated} changed${r.sourceUpdatedAt ? ` · publisher updated ${when(r.sourceUpdatedAt)}` : ''}` : r.error}</td></tr>)}</tbody></table></div></details>}
      <ErrorBox error={error} />
      {importing && <ImportWizard source={s} fields={fields} onClose={() => setImporting(false)} onDone={onChange} />}
    </div>
  );
}

export default function IntegrationsPage() {
  const sources = useApi('/sources');
  const reference = useApi('/reference');
  const reload = useThrottled(sources.reload, 1000);
  useLiveEvents((e) => { if (e.type === 'source.run' || e.type.startsWith('project.')) reload(); });
  const list = sources.data || [];
  const gov = list.filter((s) => s.recordClass === 'government');
  const third = list.filter((s) => s.recordClass !== 'government');
  return (
    <>
      <div className="page-header"><div><h1>Integrations</h1><p>Where project data comes from, what each source covers, how fresh it is, and what it cannot tell you. Only official APIs and permitted exports are used.</p></div><Link className="btn" to="/admin">Setup guide &amp; diagnostics</Link></div>
      <ErrorBox error={sources.error} />
      <h2 style={{ margin: '8px 0' }}>Government permit databases</h2>
      <div className="grid grid-2">{gov.map((s) => <SourceCard key={s.id} s={s} fields={reference.data?.importFields || []} onChange={sources.reload} />)}</div>
      <h2 style={{ margin: '24px 0 8px' }}>Construction intelligence providers (licensed)</h2>
      <Help>These are paid services. Their records are labelled “Verified third-party information” and keep a link to the provider’s own project page.</Help>
      <div className="grid grid-2" style={{ marginTop: 8 }}>{third.map((s) => <SourceCard key={s.id} s={s} fields={reference.data?.importFields || []} onChange={sources.reload} />)}</div>
    </>
  );
}
