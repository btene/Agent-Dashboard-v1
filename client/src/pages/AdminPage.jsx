import { useApi } from '../lib/hooks.js';
import { when } from '../lib/intel.js';
import { Help } from '../components/intel.jsx';
import { ErrorBox } from '../components/ui.jsx';

export default function AdminPage() {
  const sources = useApi('/sources');
  const diag = useApi('/diagnostics');
  const d = diag.data;
  return (
    <>
      <div className="page-header"><div><h1>Setup guide &amp; diagnostics</h1><p>Exactly how to connect each data source, where to obtain any credentials, and a live health summary of the whole system.</p></div><button className="btn" onClick={() => { diag.reload(); sources.reload(); }}>Refresh</button></div>
      <ErrorBox error={diag.error || sources.error} />
      {d && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <h2>System health — checked {when(d.checkedAt)}</h2>
          <div className="facts" style={{ marginTop: 10 }}>
            <div className="fact"><div className="fact-label">Operating mode</div><div className="fact-value">{d.mode}{d.pauseAll ? ' · PAUSED' : ''}</div></div>
            <div className="fact"><div className="fact-label">Live projects</div><div className="fact-value">{d.counts.liveProjects}</div></div>
            <div className="fact"><div className="fact-label">Demo projects (never counted)</div><div className="fact-value">{d.counts.demoProjects}</div></div>
            <div className="fact"><div className="fact-label">Email account</div><div className={`fact-value ${d.email.configured ? '' : 'missing'}`}>{d.email.configured ? (d.email.lastTestOk ? 'Configured and tested' : d.email.lastTestError ? `Configured — last test failed: ${d.email.lastTestError}` : 'Configured — not tested yet') : 'Not connected'}</div></div>
            <div className="fact"><div className="fact-label">API key protection</div><div className="fact-value">{d.environment.apiKeyAuth ? 'On' : 'Off (local use only)'}</div></div>
            <div className="fact"><div className="fact-label">Document encryption key</div><div className="fact-value">{d.environment.documentEncryptionKeyFromEnv ? 'From DOCUMENT_ENCRYPTION_KEY' : 'Auto-generated in the data folder'}</div></div>
            <div className="fact"><div className="fact-label">Data folder</div><div className="fact-value mono">{d.environment.dataDir}</div></div>
          </div>
          <h3 style={{ marginTop: 16 }}>Source registry</h3>
          <div className="table-wrap"><table className="small"><thead><tr><th>Source</th><th>Access</th><th>Status</th><th>Enabled</th><th>Last successful retrieval</th><th>Publisher last updated</th><th>Records</th><th>Last error</th></tr></thead>
            <tbody>{d.sources.map((s) => <tr key={s.id}><td className="wrap">{s.name}</td><td>{s.accessMethod}</td><td>{s.status}</td><td>{s.enabled ? 'yes' : 'no'}</td><td>{s.lastSuccessAt ? when(s.lastSuccessAt) : 'never'}</td><td>{s.lastSourceUpdatedAt ? when(s.lastSourceUpdatedAt) : '—'}</td><td className="num">{s.recordCount}</td><td className="wrap check-bad">{s.lastError || ''}</td></tr>)}</tbody></table></div>
          <h3 style={{ marginTop: 16 }}>Automations</h3>
          <div className="table-wrap"><table className="small"><thead><tr><th>Automation</th><th>Enabled</th><th>Status</th><th>Last run</th><th>Next run</th><th>Last error</th></tr></thead>
            <tbody>{d.automations.map((a) => <tr key={a.id}><td>{a.label}</td><td>{a.enabled ? 'yes' : 'no'}</td><td>{a.status}</td><td>{a.lastRunAt ? when(a.lastRunAt) : 'never'}</td><td>{a.nextRunAt ? when(a.nextRunAt) : '—'}</td><td className="wrap check-bad">{a.lastError || ''}</td></tr>)}</tbody></table></div>
        </div>
      )}

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h2>Before you start</h2>
        <ol className="plain">
          <li><strong>Email account.</strong> Go to Settings → Email account and enter your SMTP details (for Google Workspace: smtp.gmail.com, port 587, an <em>app password</em> created at myaccount.google.com → Security → App passwords; for Microsoft 365: smtp.office365.com, port 587, your mailbox password or an app password). Press “Test connection”.</li>
          <li><strong>Protect the site.</strong> If this server is reachable from the internet, set <code>DASHBOARD_API_KEY</code> (owner), and optionally <code>DASHBOARD_STAFF_KEY</code> and <code>DASHBOARD_VIEWER_KEY</code> for staff with fewer rights. Set <code>DOCUMENT_ENCRYPTION_KEY</code> to a long random phrase and keep a copy somewhere safe: uploaded documents cannot be opened without it.</li>
          <li><strong>Back up the data folder.</strong> Everything lives in the folder named above (database file plus encrypted documents).</li>
        </ol>
      </div>

      <h2 style={{ margin: '8px 0' }}>How to connect each data source</h2>
      <Help>No source is ever scraped or accessed around a login. Where a jurisdiction offers only a web portal, you export the results yourself and import the file.</Help>
      <div className="stack" style={{ marginTop: 8 }}>
        {(sources.data || []).map((s) => (
          <div key={s.id} id={s.id} className="card card-pad">
            <div className="row" style={{ justifyContent: 'space-between' }}><h3>{s.name}</h3><span className={`status-pill ${s.status}`}>{s.status}</span></div>
            <dl className="kv small" style={{ marginTop: 8 }}>
              <dt>Official URL</dt><dd><a href={s.officialUrl} target="_blank" rel="noreferrer">{s.officialUrl}</a></dd>
              {s.recordLookupUrl && <><dt>Record lookup</dt><dd><a href={s.recordLookupUrl} target="_blank" rel="noreferrer">{s.recordLookupUrl}</a></dd></>}
              <dt>Geographic coverage</dt><dd>{s.coverage.jurisdiction}{s.coverage.county ? ` — ${s.coverage.county} County` : ''}</dd>
              <dt>Access method</dt><dd>{{ api: 'Documented public API (Socrata SODA)', portal: 'Web portal only — export and import', csv: 'Licensed subscriber export (CSV/Excel); API by enterprise agreement' }[s.accessMethod]}</dd>
              <dt>Licence restrictions</dt><dd>{s.license}</dd>
              <dt>Refresh frequency</dt><dd>{s.refresh?.label} — {s.refresh?.note}</dd>
              {s.fieldsAvailable && <><dt>Fields provided</dt><dd>{s.fieldsAvailable.join(', ')}</dd></>}
              {s.fieldsMissing && <><dt>Fields NOT provided</dt><dd>{s.fieldsMissing.join(', ')} — these show as “Not yet verified” until researched</dd></>}
              <dt>Credentials</dt><dd>{s.connector === 'socrata' ? 'None required. Optional free app token (see steps).' : s.accessMethod === 'csv' ? 'Your own paid subscription login; nothing is stored here.' : 'None. Public portal.'}</dd>
            </dl>
            <details className="how" open><summary>Steps</summary><ol className="plain">{s.howToConnect.map((step, i) => <li key={i}>{step}</li>)}</ol></details>
          </div>
        ))}
      </div>
    </>
  );
}
