import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/hooks.js';
import { useEnvironment, setEnvironment } from '../lib/intel.js';
import { Help, ConfirmButton } from '../components/intel.jsx';
import { ErrorBox } from '../components/ui.jsx';

function Section({ id, title, children, onSave, saving, saved }) {
  return (
    <div className="card card-pad" id={id}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}><h2>{title}</h2>{onSave && <button className="btn primary sm" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}</button>}</div>
      <div className="form">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const settings = useApi('/settings');
  const reference = useApi('/reference');
  const environment = useEnvironment();
  const [s, setS] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(null);
  const [saved, setSaved] = useState(null);
  const [emailTest, setEmailTest] = useState(null);
  useEffect(() => { if (settings.data) setS(structuredClone(settings.data)); }, [settings.data]);
  if (!s) return <ErrorBox error={settings.error} />;
  const upd = (path, value) => setS((prev) => { const next = structuredClone(prev); const keys = path.split('.'); let o = next; for (const k of keys.slice(0, -1)) o = o[k]; o[keys.at(-1)] = value; return next; });
  async function save(section, body) {
    setSaving(section); setError(null); setSaved(null);
    try { await api('/settings', { method: 'PATCH', body }); setSaved(section); settings.reload(); window.dispatchEvent(new Event('als2000:settings-changed')); } catch (e) { setError(e); }
    setSaving(null);
  }
  const list = (v) => v.split(',').map((x) => x.trim()).filter(Boolean);
  return (
    <>
      <div className="page-header"><div><h1>Settings</h1><p>Company profile, service territory, lead-scoring preferences, outreach defaults and your email account.</p></div></div>
      <ErrorBox error={error} />
      <div className="stack">
        <Section id="company" title="Company" onSave={() => save('company', { company: s.company })} saving={saving === 'company'} saved={saved === 'company'}>
          <div className="form-row"><label className="field">Company name<input value={s.company.name} onChange={(e) => upd('company.name', e.target.value)} /></label><label className="field">Website<input value={s.company.website} onChange={(e) => upd('company.website', e.target.value)} /></label></div>
          <div className="form-row"><label className="field">Phone<input value={s.company.phone} onChange={(e) => upd('company.phone', e.target.value)} /></label><label className="field">Office address<input value={s.company.address} onChange={(e) => upd('company.address', e.target.value)} /></label></div>
          <div className="form-row"><label className="field">Sender name (signs the emails)<input value={s.company.senderName} onChange={(e) => upd('company.senderName', e.target.value)} /></label><label className="field">Sender title<input value={s.company.senderTitle} onChange={(e) => upd('company.senderTitle', e.target.value)} /></label></div>
          <label className="field">One-sentence company summary used in emails<input value={s.company.summary} onChange={(e) => upd('company.summary', e.target.value)} /></label>
        </Section>
        <Section id="territory" title="Service territory" onSave={() => save('territory', { territory: s.territory })} saving={saving === 'territory'} saved={saved === 'territory'}>
          <label className="field">Description<input value={s.territory.description} onChange={(e) => upd('territory.description', e.target.value)} /></label>
          <label className="field">Counties served (comma-separated)<input value={s.territory.counties.join(', ')} onChange={(e) => upd('territory.counties', list(e.target.value))} /><span className="hint">Projects in these counties earn location points.</span></label>
          <label className="field">Preferred cities (comma-separated)<input value={s.territory.preferredCities.join(', ')} onChange={(e) => upd('territory.preferredCities', list(e.target.value))} /><span className="hint">Projects in these cities earn full location points.</span></label>
          <div className="form-row"><label className="field">Map center latitude<input type="number" step="0.01" value={s.territory.mapCenter.lat} onChange={(e) => upd('territory.mapCenter.lat', Number(e.target.value))} /></label><label className="field">Map center longitude<input type="number" step="0.01" value={s.territory.mapCenter.lon} onChange={(e) => upd('territory.mapCenter.lon', Number(e.target.value))} /></label></div>
        </Section>
        <Section id="scoring" title="Project preferences and lead scoring" onSave={() => save('scoring', { scoring: s.scoring })} saving={saving === 'scoring'} saved={saved === 'scoring'}>
          <Help>Scores are always out of 100 and always explained. These settings change which projects are retrieved and which ones qualify for outreach.</Help>
          <div className="form-row"><label className="field">Minimum permit valuation to retrieve ($)<input type="number" value={s.scoring.minValuation} onChange={(e) => upd('scoring.minValuation', Number(e.target.value))} /></label><label className="field">Minimum score for outreach<input type="number" min="0" max="100" value={s.scoring.minScoreForOutreach} onChange={(e) => upd('scoring.minScoreForOutreach', Number(e.target.value))} /></label></div>
          <label className="check"><input type="checkbox" checked={s.scoring.excludeResidential} onChange={(e) => upd('scoring.excludeResidential', e.target.checked)} />Exclude individual homes and small residential projects (recommended)</label>
        </Section>
        <Section id="outreach" title="Outreach" onSave={() => save('outreach', { outreach: s.outreach })} saving={saving === 'outreach'} saved={saved === 'outreach'}>
          <label className="field">Default email style<select value={s.outreach.defaultStyle} onChange={(e) => upd('outreach.defaultStyle', e.target.value)}>{Object.entries(reference.data?.emailStyles || {}).map(([k, v]) => <option key={k} value={k}>{v.label} — {v.audience}</option>)}</select></label>
          <div className="form-row"><label className="field">Follow-up reminder after (days without reply)<input type="number" value={s.outreach.followUpDays} onChange={(e) => upd('outreach.followUpDays', Number(e.target.value))} /></label><label className="field">Daily send limit<input type="number" value={s.outreach.dailySendLimit} onChange={(e) => upd('outreach.dailySendLimit', Number(e.target.value))} /></label></div>
          <label className="field">In Automatic mode, send approved emails without a per-email check only when the project scores at least<input type="number" min="0" max="100" value={s.outreach.autoSendMinScore} onChange={(e) => upd('outreach.autoSendMinScore', Number(e.target.value))} /></label>
        </Section>
        <Section id="email" title="Email account" onSave={() => save('email', { email: s.email })} saving={saving === 'email'} saved={saved === 'email'}>
          <Help>Outreach is sent from your own mailbox (SMTP) and replies are read from the same mailbox (IMAP), so every reply lands in your normal inbox and is matched back to the project automatically. The password is stored on this server only and never shown again.</Help>
          <label className="field">Email provider<select value={s.email.provider || 'other'} onChange={(e) => { const p = e.target.value; const preset = { gmail: { smtpHost: 'smtp.gmail.com', smtpPort: 587, smtpSecure: false, imapHost: 'imap.gmail.com', imapPort: 993 }, microsoft365: { smtpHost: 'smtp.office365.com', smtpPort: 587, smtpSecure: false, imapHost: 'outlook.office365.com', imapPort: 993 }, other: {} }[p]; setS((prev) => ({ ...prev, email: { ...prev.email, provider: p, ...preset } })); }}>
            <option value="gmail">Google Workspace / Gmail</option><option value="microsoft365">Microsoft 365 / Outlook</option><option value="other">Other (enter servers by hand)</option></select>
            <span className="hint">{s.email.provider === 'gmail' ? 'Gmail needs 2-Step Verification on, then an App password (Google Account → Security → 2-Step Verification → App passwords). Use that 16-character code as the password below.' : s.email.provider === 'microsoft365' ? 'Microsoft 365 no longer allows a plain password for IMAP (reply tracking), and will switch off password SMTP by default at the end of 2026. Sending may work with your mailbox password if your admin left SMTP AUTH on; reply tracking will not. A Google Workspace mailbox is the simpler choice for this platform.' : 'Ask your email provider for the SMTP (sending) and IMAP (reading) server names.'}</span></label>
          <div className="form-row"><label className="field">Your email address<input value={s.email.address} onChange={(e) => upd('email.address', e.target.value)} /></label><label className="field">SMTP server<input value={s.email.smtpHost} onChange={(e) => upd('email.smtpHost', e.target.value)} placeholder="smtp.gmail.com / smtp.office365.com" /></label></div>
          <div className="form-row"><label className="field">Port<input type="number" value={s.email.smtpPort} onChange={(e) => upd('email.smtpPort', Number(e.target.value))} /></label><label className="check" style={{ marginTop: 26 }}><input type="checkbox" checked={s.email.smtpSecure} onChange={(e) => upd('email.smtpSecure', e.target.checked)} />Use SSL (port 465). Leave off for port 587.</label></div>
          <div className="form-row"><label className="field">Username<input value={s.email.username} onChange={(e) => upd('email.username', e.target.value)} /></label><label className="field">Password / app password<input type="password" value={s.email.password} onChange={(e) => upd('email.password', e.target.value)} placeholder={s.email.hasPassword ? 'saved — enter to replace' : ''} /></label></div>
          <div className="form-row"><label className="field">IMAP server (for reading replies)<input value={s.email.imapHost || ''} onChange={(e) => upd('email.imapHost', e.target.value)} placeholder="imap.gmail.com" /></label><label className="field">IMAP port<input type="number" value={s.email.imapPort || 993} onChange={(e) => upd('email.imapPort', Number(e.target.value))} /></label></div>
          <div className="row"><button className="btn" onClick={async () => { setEmailTest('testing'); try { setEmailTest(await api('/settings/email/test', { method: 'POST' })); } catch (e) { setEmailTest({ ok: false, error: e.message }); } settings.reload(); }}>Test sending (SMTP)</button>
            <button className="btn" onClick={async () => { setEmailTest('testing'); try { const r = await api('/settings/email/test-imap', { method: 'POST' }); setEmailTest(r.ok ? { ok: true, detail: `Inbox opened (${r.messages} messages)` } : r); } catch (e) { setEmailTest({ ok: false, error: e.message }); } settings.reload(); }}>Test reading (IMAP)</button>
            <button className="btn" onClick={async () => { setEmailTest('testing'); try { const r = await api('/inbox/check', { method: 'POST', body: {} }); setEmailTest({ ok: true, detail: `${r.scanned} messages scanned, ${r.newReplies} new replies matched` }); } catch (e) { setEmailTest({ ok: false, error: e.message }); } }}>Check inbox for replies now</button>
            {emailTest === 'testing' && <span className="small muted">Testing…</span>}{emailTest && emailTest !== 'testing' && <span className={`small ${emailTest.ok ? 'check-ok' : 'check-bad'}`}>{emailTest.ok ? (emailTest.detail || 'Connected successfully') : emailTest.error}</span>}</div>
          <Help>Save first, then test. Last SMTP test: {s.email.lastTestOk == null ? 'never' : s.email.lastTestOk ? 'OK' : `failed (${s.email.lastTestError})`} · last IMAP test: {s.email.lastImapTestOk == null ? 'never' : s.email.lastImapTestOk ? 'OK' : `failed (${s.email.lastImapTestError})`} · last inbox check: {s.email.lastInboxCheckAt ? new Date(s.email.lastInboxCheckAt).toLocaleString() : 'never'}.</Help>
        </Section>
        <ProvidersSection />
        <Section id="environment" title="Live data vs demo data">
          <Help>The live environment holds real records retrieved from external sources. The demo environment holds clearly labelled fictional projects for learning the screens. Demo records can never be emailed, added to the pipeline, or counted on the dashboard.</Help>
          <div className="row">
            <div className="segmented"><button className={environment === 'live' ? 'active' : ''} onClick={() => setEnvironment('live')}>View live data</button><button className={environment === 'demo' ? 'active' : ''} onClick={() => setEnvironment('demo')}>View demo data</button></div>
            <button className="btn sm" onClick={async () => { await api('/demo/seed', { method: 'POST' }); }}>Create demo projects</button>
            <ConfirmButton className="btn sm danger" confirmText="Remove all demo projects and demo contacts?" onConfirm={async () => { await api('/demo', { method: 'DELETE' }); }}>Remove demo data</ConfirmButton>
          </div>
        </Section>
        <Section id="setup" title="Guided setup">
          <div className="row"><a className="btn" href="/setup">Open the guided setup</a><button className="btn sm ghost" onClick={async () => { await api('/onboarding/reset', { method: 'POST' }); window.dispatchEvent(new Event('als2000:settings-changed')); }}>Restart from step 1</button></div>
        </Section>
      </div>
    </>
  );
}


function ProvidersSection() {
  const providers = useApi('/providers');
  const [form, setForm] = useState({});
  const [msg, setMsg] = useState({});
  const list = providers.data || [];
  async function save(p) { try { await api(`/providers/${p.id}`, { method: 'PATCH', body: { ...(form[p.id] || {}) } }); setForm({ ...form, [p.id]: {} }); setMsg({ ...msg, [p.id]: 'Saved' }); providers.reload(); } catch (e) { setMsg({ ...msg, [p.id]: e.message }); } }
  async function toggle(p, enabled) { try { await api(`/providers/${p.id}`, { method: 'PATCH', body: { enabled } }); providers.reload(); } catch (e) { setMsg({ ...msg, [p.id]: e.message }); } }
  async function test(p) { setMsg({ ...msg, [p.id]: 'Testing…' }); try { const r = await api(`/providers/${p.id}/test`, { method: 'POST' }); setMsg({ ...msg, [p.id]: r.ok ? r.detail : r.error }); } catch (e) { setMsg({ ...msg, [p.id]: e.message }); } }
  return (
    <Section id="providers" title="Contact research providers">
      <Help>These licensed services find people at the developers, contractors and owners named on permits. Each can be switched on or off; keys are stored on this server only. You can run the platform with none of them: LinkedIn search links and manual entry always work. See the setup guide for costs and what each one can and cannot do.</Help>
      {list.map((p) => (
        <div key={p.id} className="history-item">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div><strong>{p.name}</strong> <a className="small" href={p.docs} target="_blank" rel="noreferrer">docs ↗</a>{p.enterpriseOnly && <span className="tag" style={{ marginLeft: 6 }}>enterprise agreement required</span>}<div className="small text-2">{p.config?.configured ? 'Credentials saved' : 'No credentials yet'}</div></div>
            <label className="check small"><input type="checkbox" checked={Boolean(p.config?.enabled)} onChange={(e) => toggle(p, e.target.checked)} />Enabled</label>
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8, marginTop: 6 }}>
            {p.credentials.map((c) => <label key={c.key} className="field small">{c.label}<input type="password" placeholder={p.config?.[c.key] === '••••••••' ? 'saved — enter to replace' : ''} value={form[p.id]?.[c.key] || ''} onChange={(e) => setForm({ ...form, [p.id]: { ...(form[p.id] || {}), [c.key]: e.target.value } })} /><span className="hint">{c.help}</span></label>)}
          </div>
          <div className="row" style={{ marginTop: 6 }}><button className="btn sm primary" disabled={!form[p.id] || !Object.keys(form[p.id]).length} onClick={() => save(p)}>Save keys</button><button className="btn sm" disabled={!p.config?.configured} onClick={() => test(p)}>Test</button><span className="small muted">{msg[p.id]}</span></div>
        </div>
      ))}
    </Section>
  );
}
