import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApi, useLiveEvents, useThrottled } from '../lib/hooks.js';
import { usd, num, day, when, STAGE_LABEL, EMAIL_STATUS_LABEL, NOT_YET_VERIFIED } from '../lib/intel.js';
import { Fact, ProvenanceBadge, ScoreBadge, ScoreBreakdown, SourceLinks, Help } from '../components/intel.jsx';
import { ErrorBox, Modal } from '../components/ui.jsx';

const FIELD_LABELS = { status: 'Status', statusDate: 'Status date', valuation: 'Valuation', issuedAt: 'Issue date', appliedAt: 'Application date', description: 'Description', address: 'Address', squareFootage: 'Square footage', applicant: 'Applicant / developer', propertyOwner: 'Property owner', generalContractor: 'General contractor', permitType: 'Permit type', zoning: 'Zoning', dwellingUnits: 'Dwelling units', heightFt: 'Height (ft)', constructionType: 'Construction type' };
const fmt = (f, v) => (v == null ? NOT_YET_VERIFIED : /At$|Date$|Deadline$/.test(f) ? day(v) : f === 'valuation' ? usd(v) : String(v));

function ContactForm({ projectId, onDone, roles }) {
  const [f, setF] = useState({ firstName: '', lastName: '', email: '', phone: '', title: '', company: '', role: 'general_contractor', sourceNote: '' });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save() {
    try { await api('/contacts', { method: 'POST', body: { ...f, projectIds: [projectId], provenance: 'user' } }); onDone(); } catch (e) { setError(e); }
  }
  return (
    <Modal title="Add a decision-maker" onClose={onDone} footer={<><button className="btn" onClick={onDone}>Cancel</button><button className="btn primary" onClick={save}>Save contact</button></>}>
      <div className="form">
        <Help>Only add people you have actually identified (from the agency record, a licensed provider, a company website or a call). Note where the information came from so it stays auditable.</Help>
        <div className="form-row"><label className="field">First name<input value={f.firstName} onChange={set('firstName')} /></label><label className="field">Last name<input value={f.lastName} onChange={set('lastName')} /></label></div>
        <div className="form-row"><label className="field">Email<input value={f.email} onChange={set('email')} type="email" /></label><label className="field">Phone<input value={f.phone} onChange={set('phone')} /></label></div>
        <div className="form-row"><label className="field">Company<input value={f.company} onChange={set('company')} /></label><label className="field">Title<input value={f.title} onChange={set('title')} /></label></div>
        <label className="field">Role<select value={f.role} onChange={set('role')}>{(roles || []).map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}</select></label>
        <label className="field">Where did this come from?<input value={f.sourceNote} onChange={set('sourceNote')} placeholder="e.g. LADBS permit report, company website, phone call on 3 Nov" /></label>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function EditFacts({ project, onDone }) {
  const [f, setF] = useState({ projectName: project.projectName || '', applicant: project.applicant || '', propertyOwner: project.propertyOwner || '', generalContractor: project.generalContractor || '', landscapeScopeDocumented: project.landscapeScopeDocumented || '', bidDeadline: project.bidDeadline?.slice(0, 10) || '', bidAmount: project.bidAmount ?? '', contractValue: project.contractValue ?? '', note: '' });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save() {
    try {
      const body = { ...f, bidDeadline: f.bidDeadline ? new Date(f.bidDeadline).toISOString() : null, bidAmount: f.bidAmount === '' ? null : Number(f.bidAmount), contractValue: f.contractValue === '' ? null : Number(f.contractValue) };
      await api(`/projects/${project.id}`, { method: 'PATCH', body }); onDone();
    } catch (e) { setError(e); }
  }
  return (
    <Modal title="Add researched facts" onClose={onDone} footer={<><button className="btn" onClick={onDone}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="form">
        <Help>Anything you type here is labelled “Entered by your team”, so it is never mistaken for a verified government record. Leave a field blank if you do not know it.</Help>
        <label className="field">Project name (as the developer calls it)<input value={f.projectName} onChange={set('projectName')} /></label>
        <div className="form-row"><label className="field">Applicant / developer<input value={f.applicant} onChange={set('applicant')} /></label><label className="field">Property owner<input value={f.propertyOwner} onChange={set('propertyOwner')} /></label></div>
        <div className="form-row"><label className="field">General contractor<input value={f.generalContractor} onChange={set('generalContractor')} /></label><label className="field">Bid deadline<input type="date" value={f.bidDeadline} onChange={set('bidDeadline')} /></label></div>
        <label className="field">Documented landscape scope<input value={f.landscapeScopeDocumented} onChange={set('landscapeScopeDocumented')} placeholder="e.g. L-series landscape sheets in the plan set; 2.1 acres of planting and irrigation" /></label>
        <div className="form-row"><label className="field">Your bid amount ($)<input type="number" value={f.bidAmount} onChange={set('bidAmount')} /></label><label className="field">Contract value if awarded ($)<input type="number" value={f.contractValue} onChange={set('contractValue')} /></label></div>
        <label className="field">Note<textarea value={f.note} onChange={set('note')} /></label>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

export default function ProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const data = useApi(`/projects/${id}`);
  const reference = useApi('/reference');
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const [drafting, setDrafting] = useState(false);
  const reload = useThrottled(data.reload, 800);
  useLiveEvents((e) => { if (e.data?.id === id || e.data?.projectId === id) reload(); });

  const p = data.data;
  if (data.error) return <ErrorBox error={data.error} />;
  if (!p) return <div className="muted">Loading…</div>;

  async function verify() {
    setVerifying(true); setError(null);
    try { const r = await api(`/projects/${id}/verify`, { method: 'POST' }); setVerifyResult(r.verification); data.reload(); } catch (e) { setError(e); }
    setVerifying(false);
  }
  async function stage(s) { setError(null); try { await api(`/projects/${id}/stage`, { method: 'POST', body: { stage: s } }); data.reload(); } catch (e) { setError(e); } }
  async function draft(contactId) {
    setDrafting(true); setError(null);
    try { const e = await api('/emails', { method: 'POST', body: { projectId: id, contactId } }); navigate(`/outreach?open=${e.id}`); } catch (e) { setError(e); }
    setDrafting(false);
  }
  async function activity(type, summary) { setError(null); try { await api(`/projects/${id}/activities`, { method: 'POST', body: { type, summary } }); data.reload(); } catch (e) { setError(e); } }

  const v = p.verification || {};
  const vClass = v.status === 'verified' ? 'connected' : v.status === 'demo' ? '' : 'error';

  return (
    <>
      <div className="row small" style={{ marginBottom: 8 }}><Link to="/projects">← Projects</Link></div>
      <div className="page-header">
        <div style={{ minWidth: 0 }}>
          <div className="row"><ScoreBadge score={p.score?.total} tier={p.tier} /><h1 style={{ overflowWrap: 'anywhere' }}>{p.displayName}</h1>{p.isDemo && <span className="tag env-demo">DEMO — fictional</span>}</div>
          <p>{p.display.address} · <ProvenanceBadge kind={p.recordClass} /> · Stage: <strong>{STAGE_LABEL[p.stage]}</strong></p>
        </div>
        <div className="stack" style={{ alignItems: 'flex-end', gap: 8 }}>
          <SourceLinks project={p} />
          <div className="row">
            <button className="btn" onClick={verify} disabled={verifying}>{verifying ? 'Checking the source…' : 'VERIFY PROJECT'}</button>
            <button className="btn" onClick={() => setModal('facts')} disabled={p.isDemo}>Add researched facts</button>
          </div>
        </div>
      </div>
      <ErrorBox error={error} />

      <div className={`card card-pad`} style={{ marginBottom: 16, borderColor: v.status === 'verified' ? 'var(--good)' : 'var(--warning)' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row"><span className={`status-pill ${vClass}`}>{v.status === 'verified' ? 'Verified against source' : v.status === 'demo' ? 'Demo — nothing to verify' : v.status === 'pending' ? 'Source unavailable — verification pending' : v.status === 'not_found' ? 'Not found at source — needs review' : v.status}</span>
            <span className="small text-2">Source timestamp: {v.sourceTimestamp ? day(v.sourceTimestamp) : 'not published'} · Retrieved: {when(v.retrievedAt)} · Last checked: {when(v.lastCheckedAt)}</span></div>
          <span className="small muted">Source: {p.sourceName}</span>
        </div>
        {v.error && <div className="small" style={{ marginTop: 6, color: 'var(--critical-text)' }}>{v.error}</div>}
        {verifyResult && (
          <div style={{ marginTop: 12 }}>
            <strong>{verifyResult.message}</strong>
            <div className="small muted">Source timestamp {verifyResult.sourceTimestamp ? day(verifyResult.sourceTimestamp) : 'not published'} · retrieved {when(verifyResult.retrievedAt)} · status: {verifyResult.status}</div>
            {verifyResult.changes?.length > 0 && (
              <div className="diff" style={{ marginTop: 8 }}>
                <div className="muted">Previous</div><div className="muted">Newly retrieved</div>
                {verifyResult.changes.map((c) => <><div key={`${c.field}-b`}><span className="muted">{FIELD_LABELS[c.field] || c.field}:</span> <span className="before">{fmt(c.field, c.before)}</span></div><div key={`${c.field}-a`}><span className="after">{fmt(c.field, c.after)}</span></div></>)}
              </div>
            )}
            {verifyResult.changes?.length === 0 && verifyResult.previous && (
              <div className="facts" style={{ marginTop: 8 }}>{Object.entries(verifyResult.previous).slice(0, 6).map(([k, val]) => <Fact key={k} label={FIELD_LABELS[k] || k} value={fmt(k, val)} />)}</div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-detail">
        <div className="stack">
          <div className="card card-pad">
            <h2>Permit record</h2>
            <Help>Values marked “Gov” were copied from the government record as published. Nothing is filled in by guesswork.</Help>
            <div className="facts" style={{ marginTop: 12 }}>
              <Fact label="Permit / application number" value={p.permitNumber} provenance={p.provenance.permitNumber} />
              <Fact label="Source agency" value={p.sourceAgency} provenance={p.recordClass} />
              <Fact label="Project address" value={p.address} provenance={p.provenance.address} />
              <Fact label="Permit type" value={p.permitType ? `${p.permitType}${p.permitSubType ? ` · ${p.permitSubType}` : ''}` : null} provenance={p.provenance.permitType} />
              <Fact label="Use" value={p.useDescription} provenance={p.provenance.useDescription} />
              <Fact label="Application date" value={p.appliedAt} format={day} provenance={p.provenance.appliedAt} />
              <Fact label="Issue date" value={p.issuedAt} format={day} provenance={p.provenance.issuedAt} />
              <Fact label="Current permit status" value={p.status ? `${p.status}${p.statusDate ? ` (${day(p.statusDate)})` : ''}` : null} provenance={p.provenance.status} />
              <Fact label="Estimated valuation (published)" value={p.valuation} format={usd} provenance={p.provenance.valuation} />
              <Fact label="Square footage" value={p.squareFootage} format={num} provenance={p.provenance.squareFootage} />
              <Fact label="Dwelling units" value={p.dwellingUnits} format={num} provenance={p.provenance.dwellingUnits} />
              <Fact label="Zoning" value={p.zoning} provenance={p.provenance.zoning} />
              <Fact label="Construction type" value={p.constructionType} provenance={p.provenance.constructionType} />
              <Fact label="Developer / applicant" value={p.applicant} provenance={p.provenance.applicant} />
              <Fact label="Property owner" value={p.propertyOwner} provenance={p.provenance.propertyOwner} />
              <Fact label="General contractor" value={p.generalContractor} provenance={p.provenance.generalContractor} />
              <Fact label="Bid deadline" value={p.bidDeadline} format={day} provenance={p.provenance.bidDeadline} />
              <Fact label="Construction schedule" value={p.schedule} provenance={p.provenance.schedule} />
              <Fact label="Landscaping scope (documented)" value={p.landscapeScopeDocumented} provenance={p.provenance.landscapeScopeDocumented} />
              <Fact label="Information retrieved" value={p.retrievedAt} format={when} />
              <Fact label="Last verified" value={p.lastVerifiedAt} format={when} />
              <Fact label="Publisher last updated this record" value={p.sourceUpdatedAt} format={day} />
            </div>
            <div style={{ marginTop: 14 }}><div className="fact-label">Work description <ProvenanceBadge kind={p.provenance.description} compact /></div><div className={p.description ? '' : 'fact-value missing'}>{p.display.description}</div></div>
          </div>

          <div className="card card-pad">
            <div className="row" style={{ justifyContent: 'space-between' }}><h2>Automated classification</h2><ProvenanceBadge kind="ai_estimate" /></div>
            <Help>These labels are estimates made by reading the permit text. They help sort the list; they are not facts from the agency.</Help>
            <div className="facts" style={{ marginTop: 12 }}>
              <Fact label="Project type (estimate)" value={`${p.classification.projectTypeLabel} — ${Math.round(p.classification.confidence * 100)}% confidence`} />
              <Fact label="Landscape likelihood (estimate)" value={{ documented: 'Landscape work mentioned in the record', likely: 'Likely — site work implied', unknown: 'Unknown — nothing in the record' }[p.classification.landscapeLikelihood]} />
            </div>
            <ul className="small text-2" style={{ margin: '8px 0 0', paddingLeft: 18 }}>{p.classification.reasons.map((r, i) => <li key={i}>{r}</li>)}{p.classification.landscapeSignals.map((r, i) => <li key={`l${i}`}>{r}</li>)}</ul>
          </div>

          <div className="card card-pad">
            <h2>Why this score: {p.score.total} / 100</h2>
            <div style={{ marginTop: 10 }}><ScoreBreakdown score={p.score} /></div>
          </div>

          <div className="card card-pad">
            <h2>Change history</h2>
            <Help>Every retrieval and verification is logged with what changed, so you can audit any value back to the source.</Help>
            <div style={{ marginTop: 8 }}>
              {p.history.length === 0 && <div className="muted small">No history yet.</div>}
              {p.history.map((h) => (
                <div key={h.id} className="history-item">
                  <div className="row"><strong>{{ created: 'Record created from source', source_changed: 'Source changed during monitoring', verified_changed: 'Verified — changes found', verified_unchanged: 'Verified — no changes', user_edit: 'Edited by your team' }[h.type] || h.type}</strong><span className="muted">{when(h.at)}</span>{h.sourceTimestamp && <span className="muted">· source timestamp {day(h.sourceTimestamp)}</span>}</div>
                  {h.changes?.length > 0 && <div className="diff" style={{ marginTop: 4 }}>{h.changes.map((c) => <><div key={`${h.id}${c.field}b`}><span className="muted">{FIELD_LABELS[c.field] || c.field}:</span> <span className="before">{fmt(c.field, c.before)}</span></div><div key={`${h.id}${c.field}a`}><span className="after">{fmt(c.field, c.after)}</span></div></>)}</div>}
                </div>
              ))}
              {p.verifications.filter((x) => x.status !== 'verified').map((x) => <div key={x.id} className="history-item"><div className="row"><strong style={{ color: 'var(--critical-text)' }}>Verification attempt: {x.status}</strong><span className="muted">{when(x.checkedAt)}</span></div><div className="small">{x.message}</div></div>)}
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card card-pad">
            <h2>Pipeline stage</h2>
            <select value={p.stage} onChange={(e) => stage(e.target.value)} disabled={p.isDemo} style={{ marginTop: 8 }}>{(reference.data?.pipelineStages || []).map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</select>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn sm" disabled={p.isDemo} onClick={() => activity('bid_submitted', 'Bid submitted')}>Mark bid submitted</button>
              <button className="btn sm" disabled={p.isDemo} onClick={() => activity('contract_awarded', 'Contract awarded')}>Mark awarded</button>
              <button className="btn sm" disabled={p.isDemo} onClick={() => activity('reply_received', 'Reply received')}>Reply received</button>
            </div>
            {(p.bidAmount != null || p.contractValue != null) && <div className="facts" style={{ marginTop: 10 }}><Fact label="Your bid" value={p.bidAmount} format={usd} /><Fact label="Contract value" value={p.contractValue} format={usd} /></div>}
            {p.isDemo && <Help>Demo projects cannot enter the live pipeline.</Help>}
          </div>

          <div className="card card-pad">
            <div className="row" style={{ justifyContent: 'space-between' }}><h2>Decision-makers</h2><button className="btn sm" onClick={() => setModal('contact')} disabled={p.isDemo}>＋ Add</button></div>
            {p.contacts.length === 0 && <Help>No contacts yet. The permit record does not name people; look up the permit at the agency ({p.agencyLookupUrl ? <a href={p.agencyLookupUrl} target="_blank" rel="noreferrer">lookup page</a> : 'portal'}) or a licensed provider, then add who you find.</Help>}
            {p.contacts.map((c) => (
              <div key={c.id} className="history-item">
                <div className="row"><strong>{c.firstName} {c.lastName}</strong><span className="tag">{c.role?.replace(/_/g, ' ')}</span><ProvenanceBadge kind={c.provenance} compact /></div>
                <div className="small text-2">{[c.title, c.company].filter(Boolean).join(' · ')}</div>
                <div className="small">{c.email || <span className="muted">no email</span>}{c.phone ? ` · ${c.phone}` : ''}</div>
                {c.sourceNote && <div className="small muted">Source: {c.sourceNote}</div>}
                <button className="btn sm" style={{ marginTop: 6 }} disabled={!c.email || drafting || p.isDemo} onClick={() => draft(c.id)}>Draft email</button>
              </div>
            ))}
            <button className="btn sm ghost" style={{ marginTop: 8 }} disabled={drafting || p.isDemo} onClick={() => draft(null)}>Draft email without a named contact</button>
          </div>

          <div className="card card-pad">
            <h2>Outreach on this project</h2>
            {p.emails.length === 0 && <Help>No emails yet.</Help>}
            {p.emails.map((e) => <div key={e.id} className="history-item"><Link to={`/outreach?open=${e.id}`}>{e.subject}</Link><div className="small text-2">{EMAIL_STATUS_LABEL[e.status]} · {when(e.updatedAt)}{e.to ? ` · to ${e.to}` : ''}</div></div>)}
          </div>

          <div className="card card-pad">
            <h2>Activity &amp; notes</h2>
            {p.activities.length === 0 && (p.notes || []).length === 0 && <Help>Nothing recorded yet.</Help>}
            {p.activities.map((a) => <div key={a.id} className="history-item"><div className="small muted">{when(a.at)} · {a.type.replace(/_/g, ' ')}</div>{a.summary}</div>)}
            {(p.notes || []).map((n, i) => <div key={i} className="history-item"><div className="small muted">{when(n.at)} · note</div>{n.text}</div>)}
          </div>
        </div>
      </div>
      {modal === 'contact' && <ContactForm projectId={id} roles={reference.data?.contactRoles} onDone={() => { setModal(null); data.reload(); }} />}
      {modal === 'facts' && <EditFacts project={p} onDone={() => { setModal(null); data.reload(); }} />}
    </>
  );
}
