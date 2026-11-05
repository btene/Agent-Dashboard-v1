import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApi } from '../lib/hooks.js';
import { when, STAGE_LABEL } from '../lib/intel.js';
import { Help, ProvenanceBadge, ScoreBadge } from '../components/intel.jsx';
import { ErrorBox } from '../components/ui.jsx';
import { ResearchPanel, RelationshipFlag } from '../components/research.jsx';

const REL_TYPES = [['introduction', 'Introduction'], ['referral', 'Referral'], ['meeting', 'Meeting'], ['previous_bid', 'Previous bid'], ['past_project', 'Past project together'], ['call', 'Phone call'], ['note', 'Note']];

export function RelationshipForm({ companyId, companyName, contactId, projectId, onSaved }) {
  const [f, setF] = useState({ type: 'meeting', summary: '', at: new Date().toISOString().slice(0, 10) });
  const [error, setError] = useState(null);
  async function save() { try { await api('/relationships', { method: 'POST', body: { ...f, at: new Date(f.at).toISOString(), companyId, companyName, contactId, projectId } }); setF({ ...f, summary: '' }); onSaved(); } catch (e) { setError(e); } }
  return (
    <div className="form" style={{ gap: 8 }}>
      <div className="row"><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} style={{ width: 180 }}>{REL_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select><input type="date" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} style={{ width: 160 }} /></div>
      <input placeholder="What happened? e.g. Bid the Oxnard warehouse landscape in 2024; lost on price." value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} />
      <div className="row"><button className="btn sm primary" onClick={save} disabled={!f.summary}>Record</button></div>
      <ErrorBox error={error} />
    </div>
  );
}

export default function CompanyPage() {
  const { id } = useParams();
  const data = useApi(`/companies/${id}`);
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState(null);
  const c = data.data;
  if (!c) return <ErrorBox error={data.error} />;
  const f = edit || { website: c.website || '', type: c.type, phone: c.phone || '', linkedinUrl: c.linkedinUrl || '' };
  async function save() { setError(null); try { await api(`/companies/${id}`, { method: 'PATCH', body: f }); setEdit(null); data.reload(); } catch (e) { setError(e); } }
  async function enrich() { setError(null); try { const r = await api(`/companies/${id}/enrich`, { method: 'POST' }); if (r.errors) setError(new Error(r.errors.join(' '))); data.reload(); } catch (e) { setError(e); } }
  return (
    <>
      <div className="row small" style={{ marginBottom: 8 }}><Link to="/crm">← CRM</Link></div>
      <div className="page-header">
        <div><div className="row"><h1>{c.name}</h1><span className="tag">{c.type.replace(/_/g, ' ')}</span><ProvenanceBadge kind={c.provenance} /><RelationshipFlag rel={c.relationship} /></div>
          <p>{c.sourceNote || 'Company record'}{c.website ? <> · <a href={c.website} target="_blank" rel="noreferrer">{c.website}</a></> : ''}{c.linkedinUrl ? <> · <a href={c.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn</a></> : ''}</p></div>
        <button className="btn" onClick={enrich}>Look up company details (providers)</button>
      </div>
      <ErrorBox error={error} />
      <div className="grid grid-detail">
        <div className="stack">
          <ResearchPanel companyId={id} />
          <div className="card card-pad">
            <h2>Projects naming this company ({c.projects.length})</h2>
            {c.projects.length === 0 && <Help>No projects name this company yet.</Help>}
            {c.projects.map((p) => <div key={p.id} className="history-item"><ScoreBadge score={p.score} tier={p.score >= 75 ? 'high' : p.score >= 50 ? 'medium' : 'low'} /> <Link to={`/projects/${p.id}`}>{p.displayName}</Link> <span className="small text-2">· {p.role} · {p.city} · {STAGE_LABEL[p.stage]}</span></div>)}
          </div>
          <div className="card card-pad">
            <h2>Contacts at this company ({c.contacts.length})</h2>
            {c.contacts.map((x) => <div key={x.id} className="history-item"><strong>{x.firstName} {x.lastName}</strong> <span className="text-2">{x.title}</span><div className="small">{x.email || 'no email'}{x.linkedinUrl && <> · <a href={x.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn{x.linkedinVerifiedAt ? ' ✓' : ''}</a></>} · <ProvenanceBadge kind={x.provenance} compact />{x.lastVerifiedAt ? ` · verified ${when(x.lastVerifiedAt)}` : ''}</div></div>)}
          </div>
        </div>
        <div className="stack">
          <div className="card card-pad">
            <h2>Relationship history</h2>
            <Help>{c.relationship.summary}. Record introductions, referrals, meetings, past bids and past projects so cold outreach is never sent to someone you already know.</Help>
            {c.relationship.relationshipEvents.map((a) => <div key={a.id} className="history-item"><div className="small muted">{when(a.at)} · {a.type.replace(/_/g, ' ')}</div>{a.summary}</div>)}
            <div style={{ marginTop: 10 }}><RelationshipForm companyId={c.id} companyName={c.name} onSaved={data.reload} /></div>
          </div>
          <div className="card card-pad form">
            <h2>Company details</h2>
            <Help>Add the website so providers can search by domain, which is far more accurate than by name.</Help>
            <label className="field">Website<input value={f.website} onChange={(e) => setEdit({ ...f, website: e.target.value })} placeholder="https://example-builders.com" /></label>
            <label className="field">Type<select value={f.type} onChange={(e) => setEdit({ ...f, type: e.target.value })}>{['developer', 'property_owner', 'general_contractor', 'asset_manager', 'architect', 'other'].map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}</select></label>
            <div className="form-row"><label className="field">Phone<input value={f.phone} onChange={(e) => setEdit({ ...f, phone: e.target.value })} /></label><label className="field">LinkedIn company URL<input value={f.linkedinUrl} onChange={(e) => setEdit({ ...f, linkedinUrl: e.target.value })} /></label></div>
            <div className="row"><button className="btn sm primary" disabled={!edit} onClick={save}>Save</button>{c.domain && <span className="small muted">domain: {c.domain}</span>}</div>
          </div>
        </div>
      </div>
    </>
  );
}
