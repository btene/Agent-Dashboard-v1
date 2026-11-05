import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApi } from '../lib/hooks.js';
import { when } from '../lib/intel.js';
import { Help, ProvenanceBadge } from './intel.jsx';
import { ErrorBox, Modal } from './ui.jsx';

export function ConfirmationBadges({ c, compact = false }) {
  if (!c) return null;
  const cls = (s) => ({ confirmed: 'conf-ok', indicated: 'conf-mid', unconfirmed: 'conf-no' }[s] || 'conf-no');
  return (
    <span className="chips">
      {['company', 'contact', 'landscapeScope'].map((k) => <span key={k} className={`conf ${cls(c[k].status)}`} title={c[k].detail}>{c[k].status === 'confirmed' ? '✓' : c[k].status === 'indicated' ? '~' : '✗'} {c[k].label}</span>)}
    </span>
  );
}

export function RelationshipFlag({ rel }) {
  if (!rel || rel.level === 'none') return null;
  const cls = rel.level === 'warm' ? 'conf-ok' : rel.level === 'contacted' ? 'conf-mid' : 'conf-no';
  return <span className={`conf ${cls}`} title={rel.summary}>{rel.level === 'warm' ? '★ Existing relationship' : rel.level === 'contacted' ? '✉ Already contacted' : '◦ Known in CRM'}</span>;
}

export function CandidateScore({ score }) {
  if (!score) return null;
  return (
    <details className="small"><summary>Score {score.total}/100 — why</summary>
      {score.parts.map((p) => <div key={p.key} className="small text-2" style={{ marginTop: 4 }}><strong>{p.label}: {p.points}/{p.max}</strong> — {p.reason} <span className="muted">(source: {p.source})</span></div>)}
    </details>
  );
}

function ManualContactModal({ projectId, companies, onClose, onSaved }) {
  const [f, setF] = useState({ firstName: '', lastName: '', title: '', email: '', phone: '', linkedinUrl: '', companyName: companies[0]?.name || '', companyRole: companies[0]?.role || '', sourceUrl: '', sourceNote: '' });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save() { try { await api('/contacts/manual', { method: 'POST', body: { ...f, projectId } }); onSaved(); onClose(); } catch (e) { setError(e); } }
  return (
    <Modal title="Add a person you found" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save as verified contact</button></>}>
      <div className="form">
        <Help>Use this after you open a LinkedIn search link or a company website and find the right person yourself. Paste the profile link so the contact is marked “LinkedIn verified by your team”.</Help>
        <div className="form-row"><label className="field">First name<input value={f.firstName} onChange={set('firstName')} /></label><label className="field">Last name<input value={f.lastName} onChange={set('lastName')} /></label></div>
        <div className="form-row"><label className="field">Title<input value={f.title} onChange={set('title')} placeholder="e.g. Chief Estimator" /></label><label className="field">Company<select value={f.companyName} onChange={(e) => { const c = companies.find((x) => x.name === e.target.value); setF({ ...f, companyName: e.target.value, companyRole: c?.role || '' }); }}>{companies.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}<option value="">Other</option></select></label></div>
        {!f.companyName && <label className="field">Company name<input onChange={set('companyName')} /></label>}
        <div className="form-row"><label className="field">Business email<input value={f.email} onChange={set('email')} /></label><label className="field">Business phone<input value={f.phone} onChange={set('phone')} /></label></div>
        <label className="field">LinkedIn profile URL<input value={f.linkedinUrl} onChange={set('linkedinUrl')} placeholder="https://www.linkedin.com/in/…" /></label>
        <label className="field">Where you found this (URL or note)<input value={f.sourceNote} onChange={set('sourceNote')} placeholder="e.g. company website team page" /></label>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

/** "Find decision-makers" panel used on project and company pages. */
export function ResearchPanel({ projectId, companyId }) {
  const path = projectId ? `/projects/${projectId}/research` : `/companies/${companyId}`;
  const data = useApi(path);
  const providers = useApi('/providers');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [lastRun, setLastRun] = useState(null);
  const [manual, setManual] = useState(false);
  const [linkedinFor, setLinkedinFor] = useState({});
  async function act(fn, key) { setBusy(key); setError(null); try { const r = await fn(); if (key === 'find') setLastRun(r); data.reload(); } catch (e) { setError(e); } setBusy(null); }
  const d = data.data;
  if (!d) return <ErrorBox error={data.error} />;
  const enabled = (providers.data || []).filter((p) => p.config?.enabled && p.config?.configured);
  const companies = projectId ? d.companies : [{ name: d.name, role: d.type, relationship: d.relationship, linkedin: d.linkedin, company: { id: d.id, domain: d.domain } }];
  const candidates = (d.candidates || []).filter((c) => c.status !== 'dismissed');
  return (
    <div className="card card-pad stack" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div><h2>Decision-makers</h2><Help>Starts from the companies named on the record, asks your enabled contact-data providers for people with priority titles, and gives one-click LinkedIn searches. Nothing is invented: every person shown came from a provider, the record, or you.</Help></div>
        <div className="row">
          <button className="btn primary" disabled={busy || companies.length === 0} onClick={() => act(() => api(projectId ? `/projects/${projectId}/research` : `/companies/${companyId}/research`, { method: 'POST', body: {} }), 'find')}>{busy === 'find' ? 'Searching…' : 'Find decision-makers'}</button>
          <button className="btn" onClick={() => setManual(true)} disabled={companies.length === 0}>Add a person I found</button>
        </div>
      </div>
      <ErrorBox error={error} />
      {projectId && <div className="small text-2">Priority titles for this project ({{ construction: 'landscape construction', maintenance: 'recurring maintenance', both: 'construction and maintenance', unlikely: 'general' }[d.opportunityType] || d.opportunityType}): {d.titlePriorities.join(' · ')}</div>}
      <div className="small">Providers enabled: {enabled.length ? enabled.map((p) => p.name).join(', ') : <span className="check-bad">none — <Link to="/settings#providers">connect Apollo.io, Hunter.io or People Data Labs</Link> to search automatically. LinkedIn links below still work.</span>}</div>
      {companies.length === 0 && <div className="warn-box small">This record does not name a developer, general contractor or owner, so there is no company to research yet. Look the permit up at the agency (button at the top), then press “Add researched facts” to record the companies you find. Only sourced names are used; nothing is guessed.</div>}
      {companies.map((c) => (
        <div key={c.name} className="history-item">
          <div className="row"><strong>{c.name}</strong><span className="tag">{{ generalContractor: 'general contractor', applicant: 'developer / applicant', propertyOwner: 'property owner', propertyManager: 'property manager', constructionManager: 'construction manager' }[c.role] || c.role}</span>{c.provenance && <ProvenanceBadge kind={c.provenance} compact />}<RelationshipFlag rel={c.relationship} />{c.company?.id && <Link className="small" to={`/companies/${c.company.id}`}>company profile</Link>}</div>
          {c.relationship && c.relationship.level !== 'none' && <div className="small text-2">{c.relationship.summary}{c.relationship.contacts?.length ? ` — ${c.relationship.contacts.map((x) => x.name).join(', ')}` : ''}. Check before sending cold outreach.</div>}
          <div className="chips" style={{ marginTop: 6 }}>{(c.linkedin || []).map((l) => <a key={l.url} className="btn sm" href={l.url} target="_blank" rel="noreferrer" title={l.label}>{l.kind === 'company' ? 'LinkedIn company' : l.kind === 'web' ? (l.label.includes('website') ? 'Google: website' : 'Google: LinkedIn profiles') : l.label.replace(`People at ${c.name} `, 'LinkedIn: ').replace(`People at ${c.name}`, 'LinkedIn: people')} ↗</a>)}</div>
        </div>
      ))}
      {lastRun && <div className="notice small">Search finished: {lastRun.candidateCount} candidate{lastRun.candidateCount === 1 ? '' : 's'} from {lastRun.providersUsed.length ? lastRun.providersUsed.join(', ') : 'no providers'}.{lastRun.errors.map((e, i) => <div key={i}>{e.provider ? `${e.provider}: ` : ''}{e.message}</div>)}</div>}
      {candidates.length > 0 && (
        <div>
          <h3>Candidates ({candidates.length})</h3>
          <Help>Unverified leads from providers are marked as such. Verify the email or confirm the LinkedIn profile, then save to the CRM.</Help>
          {candidates.map((c) => (
            <div key={c.id} className="history-item">
              <div className="row"><strong>{c.firstName} {c.lastName}</strong><span className="text-2">{c.title || 'title unknown'}</span><span className="tag">{c.companyName || c.company}</span>
                <span className={`conf ${c.status === 'saved' ? 'conf-ok' : c.emailVerification?.status === 'valid' || c.linkedinVerifiedAt ? 'conf-ok' : 'conf-no'}`}>{c.status === 'saved' ? 'Saved to CRM' : c.emailVerification?.status === 'valid' || c.linkedinVerifiedAt ? 'Verified' : 'Unverified lead'}</span>
                <span className="score tier-medium" style={{ fontSize: 14 }}>{c.score?.total ?? '—'}</span></div>
              <div className="small">{c.email || <span className="muted">no email</span>}{c.emailVerification && <span className={c.emailVerification.status === 'valid' ? 'check-ok' : 'check-bad'}> · {c.emailVerification.detail}</span>}{c.phone ? ` · ${c.phone}` : ''}{c.location ? ` · ${c.location}` : ''}</div>
              <div className="small muted">Source: {c.sourceLabel}{c.sourceUrl && <> · <a href={c.sourceUrl} target="_blank" rel="noreferrer">open source ↗</a></>}{c.linkedinUrl && c.sourceUrl !== c.linkedinUrl && <> · <a href={c.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn ↗</a></>}</div>
              <CandidateScore score={c.score} />
              {c.status !== 'saved' && (
                <div className="row" style={{ marginTop: 6 }}>
                  {c.email && !c.emailVerification && <button className="btn sm" disabled={busy} onClick={() => act(() => api(`/candidates/${c.id}/verify-email`, { method: 'POST' }), c.id)}>Verify email</button>}
                  <input placeholder="Paste LinkedIn URL you checked" value={linkedinFor[c.id] ?? c.linkedinUrl ?? ''} onChange={(e) => setLinkedinFor({ ...linkedinFor, [c.id]: e.target.value })} style={{ maxWidth: 280, padding: '4px 8px' }} />
                  <button className="btn sm primary" disabled={busy} onClick={() => act(() => api(`/candidates/${c.id}/save`, { method: 'POST', body: { linkedinUrl: linkedinFor[c.id] || undefined } }), c.id)}>Save to CRM</button>
                  <button className="btn sm ghost" disabled={busy} onClick={() => act(() => api(`/candidates/${c.id}/dismiss`, { method: 'POST', body: {} }), c.id)}>Dismiss</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {d.runs?.length > 0 && <details className="small"><summary>Research history</summary>{d.runs.map((r) => <div key={r.id} className="text-2">{when(r.startedAt)} — {r.providersUsed.join(', ') || 'no providers'} — {r.candidateCount} candidates{r.errors?.length ? ` — ${r.errors.map((e) => e.message).join('; ')}` : ''}</div>)}</details>}
      {manual && <ManualContactModal projectId={projectId} companies={companies.map((c) => ({ name: c.name, role: c.role }))} onClose={() => setManual(false)} onSaved={data.reload} />}
    </div>
  );
}
