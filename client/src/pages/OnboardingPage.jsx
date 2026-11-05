import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApi } from '../lib/hooks.js';
import { uploadFile, usd, STAGE_LABEL } from '../lib/intel.js';
import { Help, ScoreBadge, SourceLinks, Switch } from '../components/intel.jsx';
import { ErrorBox } from '../components/ui.jsx';

const EXPLAIN = {
  company: { what: 'Tell the system who you are and where you work.', why: 'The company name and sender appear in every email, and the territory decides which projects earn location points and which permit sources matter.', need: 'Company name, the person who signs emails, and the counties and cities you serve.' },
  documents: { what: 'Upload your contractor license, insurance certificate, capability statement and similar files.', why: 'Approved credentials can be quoted in outreach, and the system warns you before a license or policy expires. Files are encrypted on this server.', need: 'PDF or image files. You can add more later under Documents.' },
  email: { what: 'Connect the mailbox outreach will be sent from.', why: 'Emails go out from your own address so replies arrive in your normal inbox. Nothing is sent until you approve it.', need: 'Email address, SMTP server, and a password or app password from your provider.' },
  sources: { what: 'Choose which permit databases and construction-data providers to monitor.', why: 'Only real records from official or licensed sources enter the system. Each source shows what it covers and what it cannot provide.', need: 'Nothing for the City of Los Angeles open data. Other jurisdictions need a portal export you upload.' },
  preferences: { what: 'Set the minimum project size and the score needed before outreach is drafted.', why: 'Keeps the list focused on commercial projects large enough to carry a real landscaping contract.', need: 'A minimum permit valuation and a minimum score (defaults are sensible).' },
  tone: { what: 'Pick the default writing style for outreach emails.', why: 'Developers and general contractors prefer short notes; property owners respond to a relationship-focused tone; procurement teams expect a bid response.', need: 'One choice. Any draft can use a different style.' },
  review: { what: 'Look at the first projects retrieved from your sources.', why: 'Confirms the data is real, current and relevant before any outreach happens. Every project has a “View original source” link.', need: 'At least one source has been run. Press “Retrieve now” if the list is empty.' },
  campaign: { what: 'Approve the first batch of outreach drafts.', why: 'Nothing is ever sent without approval. This step shows you exactly what a draft looks like and lets you edit it.', need: 'At least one project with a contact who has an email address.' },
};

export default function OnboardingPage() {
  const navigate = useNavigate();
  const onboarding = useApi('/onboarding');
  const settings = useApi('/settings');
  const reference = useApi('/reference');
  const [current, setCurrent] = useState(null);
  const [error, setError] = useState(null);
  const steps = onboarding.data?.steps || [];
  useEffect(() => { if (steps.length && current === null) setCurrent(steps.find((s) => s.status === 'pending')?.id || steps[0].id); }, [steps, current]);
  const idx = steps.findIndex((s) => s.id === current);
  const step = steps[idx];
  async function mark(status) {
    setError(null);
    try { await api(`/onboarding/step/${current}`, { method: 'POST', body: { status } }); onboarding.reload(); window.dispatchEvent(new Event('als2000:settings-changed')); if (idx < steps.length - 1) setCurrent(steps[idx + 1].id); else navigate('/'); } catch (e) { setError(e); }
  }
  if (!step || !settings.data) return <ErrorBox error={onboarding.error || settings.error} />;
  const ex = EXPLAIN[step.id];
  const done = steps.filter((s) => s.status !== 'pending').length;
  return (
    <>
      <div className="page-header"><div><h1>Guided setup</h1><p>Eight short steps. Optional steps can be skipped and finished later from Settings. {done} of {steps.length} done.</p></div>
        <button className="btn ghost sm" onClick={async () => { await api('/onboarding/dismiss', { method: 'POST' }); window.dispatchEvent(new Event('als2000:settings-changed')); navigate('/'); }}>Skip setup for now</button></div>
      <div className="wizard">
        <div className="card card-pad step-list">
          {steps.map((s, i) => <button key={s.id} className={`step ${s.id === current ? 'active' : ''} ${s.status === 'complete' ? 'done' : s.status === 'skipped' ? 'skipped' : ''}`} onClick={() => setCurrent(s.id)}><span className="n">{s.status === 'complete' ? '✓' : i + 1}</span><span style={{ flex: 1 }}>{s.title}{s.optional && <span className="small muted"> · optional</span>}</span>{s.detected && s.status === 'pending' && <span className="tag">looks done</span>}</button>)}
        </div>
        <div className="stack">
          <div className="card card-pad">
            <div className="small muted">Step {idx + 1} of {steps.length}{step.optional ? ' · optional' : ' · required'} · {step.status === 'complete' ? 'Complete' : step.status === 'skipped' ? 'Skipped' : 'Not done yet'}</div>
            <h2 style={{ margin: '4px 0 10px' }}>{step.title}</h2>
            <dl className="kv"><dt>What you’re doing</dt><dd>{ex.what}</dd><dt>Why it matters</dt><dd>{ex.why}</dd><dt>What’s needed</dt><dd>{ex.need}</dd></dl>
          </div>
          <StepBody id={step.id} settings={settings.data} reference={reference.data} reloadSettings={settings.reload} />
          <ErrorBox error={error} />
          <div className="row">
            {idx > 0 && <button className="btn" onClick={() => setCurrent(steps[idx - 1].id)}>← Back</button>}
            <span className="spacer" />
            {step.optional && step.status === 'pending' && <button className="btn" onClick={() => mark('skipped')}>Skip for now</button>}
            <button className="btn primary" onClick={() => mark('complete')}>{idx === steps.length - 1 ? 'Finish setup' : 'Mark complete and continue →'}</button>
          </div>
        </div>
      </div>
    </>
  );
}

function StepBody({ id, settings, reference, reloadSettings }) {
  const [form, setForm] = useState(settings);
  const [msg, setMsg] = useState(null);
  useEffect(() => setForm(settings), [settings]);
  const save = async (body) => { setMsg(null); try { await api('/settings', { method: 'PATCH', body }); setMsg('Saved'); reloadSettings(); window.dispatchEvent(new Event('als2000:settings-changed')); } catch (e) { setMsg(e.message); } };
  const upd = (path, value) => setForm((prev) => { const next = structuredClone(prev); const keys = path.split('.'); let o = next; for (const k of keys.slice(0, -1)) o = o[k]; o[keys.at(-1)] = value; return next; });
  if (!form) return null;

  if (id === 'company') return (
    <div className="card card-pad form">
      <div className="form-row"><label className="field">Company name<input value={form.company.name} onChange={(e) => upd('company.name', e.target.value)} /></label><label className="field">Who signs the emails?<input value={form.company.senderName} onChange={(e) => upd('company.senderName', e.target.value)} placeholder="Your name" /></label></div>
      <div className="form-row"><label className="field">Phone<input value={form.company.phone} onChange={(e) => upd('company.phone', e.target.value)} /></label><label className="field">Website<input value={form.company.website} onChange={(e) => upd('company.website', e.target.value)} /></label></div>
      <label className="field">Service territory in words<input value={form.territory.description} onChange={(e) => upd('territory.description', e.target.value)} /></label>
      <label className="field">Counties (comma-separated)<input value={form.territory.counties.join(', ')} onChange={(e) => upd('territory.counties', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} /></label>
      <label className="field">Preferred cities (comma-separated)<input value={form.territory.preferredCities.join(', ')} onChange={(e) => upd('territory.preferredCities', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} /></label>
      <div className="row"><button className="btn primary sm" onClick={() => save({ company: form.company, territory: form.territory })}>Save</button><span className="small muted">{msg}</span></div>
    </div>
  );
  if (id === 'documents') return <DocumentsStep />;
  if (id === 'email') return (
    <div className="card card-pad form">
      <div className="form-row"><label className="field">Email address<input value={form.email.address} onChange={(e) => upd('email.address', e.target.value)} /></label><label className="field">SMTP server<input value={form.email.smtpHost} onChange={(e) => upd('email.smtpHost', e.target.value)} placeholder="smtp.gmail.com" /></label></div>
      <div className="form-row"><label className="field">Username<input value={form.email.username} onChange={(e) => upd('email.username', e.target.value)} /></label><label className="field">Password / app password<input type="password" value={form.email.password} onChange={(e) => upd('email.password', e.target.value)} placeholder={form.email.hasPassword ? 'saved' : ''} /></label></div>
      <div className="form-row"><label className="field">Port<input type="number" value={form.email.smtpPort} onChange={(e) => upd('email.smtpPort', Number(e.target.value))} /></label><label className="check" style={{ marginTop: 26 }}><input type="checkbox" checked={form.email.smtpSecure} onChange={(e) => upd('email.smtpSecure', e.target.checked)} />SSL (port 465)</label></div>
      <div className="row"><button className="btn primary sm" onClick={() => save({ email: form.email })}>Save</button><button className="btn sm" onClick={async () => { const r = await api('/settings/email/test', { method: 'POST' }); setMsg(r.ok ? 'Connected successfully' : r.error); }}>Test connection</button><span className="small muted">{msg}</span></div>
      <Help>Google Workspace: smtp.gmail.com, port 587, and an app password (Google Account → Security → App passwords). Microsoft 365: smtp.office365.com, port 587.</Help>
    </div>
  );
  if (id === 'sources') return <SourcesStep />;
  if (id === 'preferences') return (
    <div className="card card-pad form">
      <div className="form-row"><label className="field">Minimum permit valuation ($)<input type="number" value={form.scoring.minValuation} onChange={(e) => upd('scoring.minValuation', Number(e.target.value))} /></label><label className="field">Minimum score before drafting outreach<input type="number" value={form.scoring.minScoreForOutreach} onChange={(e) => upd('scoring.minScoreForOutreach', Number(e.target.value))} /></label></div>
      <label className="check"><input type="checkbox" checked={form.scoring.excludeResidential} onChange={(e) => upd('scoring.excludeResidential', e.target.checked)} />Exclude individual homes and small residential work</label>
      <Help>How scoring works: size 20 · type 20 · timing 20 · landscaping requirement 20 · decision-maker accessibility 10 · location 10. Every project shows the reason for each point.</Help>
      <div className="row"><button className="btn primary sm" onClick={() => save({ scoring: form.scoring })}>Save</button><span className="small muted">{msg}</span></div>
    </div>
  );
  if (id === 'tone') return (
    <div className="card card-pad form">
      {Object.entries(reference?.emailStyles || {}).map(([k, v]) => <label key={k} className="check"><input type="radio" name="style" checked={form.outreach.defaultStyle === k} onChange={() => upd('outreach.defaultStyle', k)} /><span><strong>{v.label}</strong> — {v.audience}{k === 'short_direct' ? ' (recommended default)' : ''}</span></label>)}
      <div className="row"><button className="btn primary sm" onClick={() => save({ outreach: form.outreach })}>Save</button><span className="small muted">{msg}</span></div>
    </div>
  );
  if (id === 'review') return <ReviewStep />;
  if (id === 'campaign') return <CampaignStep />;
  return null;
}

function DocumentsStep() {
  const docs = useApi('/documents');
  const [type, setType] = useState('contractor_license');
  const [msg, setMsg] = useState(null);
  return (
    <div className="card card-pad form">
      <div className="row"><select value={type} onChange={(e) => setType(e.target.value)} style={{ maxWidth: 280 }}>{(docs.data?.types || []).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
        <label className="btn">Choose file<input type="file" style={{ display: 'none' }} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { await uploadFile('/documents', f, { type }); setMsg(`Uploaded ${f.name}`); docs.reload(); } catch (err) { setMsg(err.message); } }} /></label><span className="small muted">{msg}</span></div>
      <div className="small">{(docs.data?.items || []).length} document{docs.data?.items?.length === 1 ? '' : 's'} uploaded so far. {docs.data?.items?.length > 0 && <Link to="/documents">Review extracted dates and approve them →</Link>}</div>
    </div>
  );
}

function SourcesStep() {
  const sources = useApi('/sources');
  const [busy, setBusy] = useState(null);
  return (
    <div className="card card-pad stack" style={{ gap: 10 }}>
      {(sources.data || []).map((s) => (
        <div key={s.id} className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div style={{ flex: 1, minWidth: 240 }}><strong>{s.name}</strong><div className="small text-2">{s.coverage.jurisdiction} · {{ api: 'official API', portal: 'portal export only', csv: 'licensed export' }[s.accessMethod]} · publisher refresh {s.refresh?.label.toLowerCase()}</div>{s.lastError && <div className="small check-bad">{s.lastError}</div>}</div>
          <div className="row">{s.connectorSupported && <button className="btn sm" disabled={busy === s.id} onClick={async () => { setBusy(s.id); await api(`/sources/${s.id}/run`, { method: 'POST', body: {} }); sources.reload(); setBusy(null); }}>{busy === s.id ? 'Retrieving…' : s.lastSuccessAt ? `Retrieve again (${s.recordCount} records)` : 'Retrieve now'}</button>}
            <Switch checked={s.enabled} label="Enabled" onChange={async (v) => { await api(`/sources/${s.id}`, { method: 'PATCH', body: { enabled: v } }); sources.reload(); }} /></div>
        </div>
      ))}
      <Help>Details, credentials and import instructions for every source are under <Link to="/admin">Setup guide</Link>.</Help>
    </div>
  );
}

function ReviewStep() {
  const projects = useApi('/projects?limit=8&sort=score');
  const items = projects.data?.items || [];
  return (
    <div className="card card-pad stack" style={{ gap: 10 }}>
      {projects.data && items.length === 0 && <Help>No live projects yet. Go back to the Sources step and press “Retrieve now” on the City of Los Angeles source.</Help>}
      {items.map((p) => <div key={p.id} className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 8 }}><div style={{ flex: 1, minWidth: 240 }}><ScoreBadge score={p.score?.total} tier={p.tier} /> <Link to={`/projects/${p.id}`}>{p.displayName}</Link><div className="small text-2">{p.display.status} · valuation {usd(p.valuation)} · {p.classification?.projectTypeLabel} (estimate)</div></div><SourceLinks project={p} size="sm" /></div>)}
      {items.length > 0 && <Link to="/projects">See all projects →</Link>}
    </div>
  );
}

function CampaignStep() {
  const emails = useApi('/emails?status=pending_approval,approved');
  const list = emails.data || [];
  return (
    <div className="card card-pad stack" style={{ gap: 10 }}>
      {emails.data && list.length === 0 && <Help>No drafts yet. Open a high-scoring project, add the decision-maker you identified, and press “Draft email”. The draft will appear here and under Outreach for approval.</Help>}
      {list.map((e) => <div key={e.id} className="history-item"><Link to={`/outreach?open=${e.id}`}>{e.subject}</Link><div className="small text-2">{e.to || 'no recipient yet'} · {e.status.replace(/_/g, ' ')} · {e.project?.displayName}</div></div>)}
      {list.length > 0 && <Link to="/outreach" className="btn primary sm" style={{ alignSelf: 'flex-start' }}>Review and approve in Outreach →</Link>}
    </div>
  );
}
