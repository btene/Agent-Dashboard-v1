import { useState } from 'react';
import { api } from '../lib/api.js';
import { useApi, useLiveEvents, useThrottled } from '../lib/hooks.js';
import { when, day, uploadFile } from '../lib/intel.js';
import { Help, ConfirmButton } from '../components/intel.jsx';
import { ErrorBox, Modal } from '../components/ui.jsx';

const STATUS_LABEL = { current: 'Current (verified)', expiring: 'Expiring soon', expired: 'EXPIRED', unverified: 'Not verified' };

function ReviewModal({ doc, types, roles, onClose, onSaved }) {
  const [f, setF] = useState({ title: doc.title, type: doc.type, expirationDate: doc.expirationDate || '', effectiveDate: doc.effectiveDate || '', extracted: { ...doc.extracted }, statusVerified: doc.statusVerified, approvedForOutreach: doc.approvedForOutreach, outreachSummary: doc.outreachSummary || '', minRole: doc.minRole, notes: doc.notes || '' });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setX = (k) => (e) => setF({ ...f, extracted: { ...f.extracted, [k]: e.target.value } });
  async function save(reviewStatus) { try { await api(`/documents/${doc.id}`, { method: 'PATCH', body: { ...f, reviewStatus, expirationDate: f.expirationDate || null, effectiveDate: f.effectiveDate || null } }); onSaved(); onClose(); } catch (e) { setError(e); } }
  const typeDef = types.find((t) => t.id === f.type);
  return (
    <Modal title={`Review: ${doc.title}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn" onClick={() => save('rejected')}>Reject</button><button className="btn primary" onClick={() => save('approved')}>Approve extracted data</button></>}>
      <div className="form">
        <Help>The system read the file and suggested these values. Check them against the document before approving. Only after you confirm the expiration date and tick “I verified this is current” will the document ever be described as current.</Help>
        {doc.extraction?.error && <div className="warn-box small">{doc.extraction.error}</div>}
        <div className="form-row"><label className="field">Title<input value={f.title} onChange={set('title')} /></label><label className="field">Type<select value={f.type} onChange={set('type')}>{types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label></div>
        <div className="form-row"><label className="field">Effective date<input type="date" value={f.effectiveDate} onChange={set('effectiveDate')} /></label><label className="field">Expiration date{typeDef?.expires ? '' : ' (not applicable)'}<input type="date" value={f.expirationDate} onChange={set('expirationDate')} disabled={!typeDef?.expires} /></label></div>
        {doc.extracted?.expirationContext && <div className="small muted">Found near: “…{doc.extracted.expirationContext}…”</div>}
        <div className="form-row"><label className="field">License number<input value={f.extracted.licenseNumber || ''} onChange={setX('licenseNumber')} /></label><label className="field">Classification<input value={f.extracted.classification || ''} onChange={setX('classification')} placeholder="e.g. C-27" /></label></div>
        <div className="form-row"><label className="field">Policy number<input value={f.extracted.policyNumber || ''} onChange={setX('policyNumber')} /></label><label className="field">Insurer<input value={f.extracted.insurer || ''} onChange={setX('insurer')} /></label></div>
        <div className="form-row"><label className="field">General aggregate<input value={f.extracted.generalAggregate || ''} onChange={setX('generalAggregate')} /></label><label className="field">Each occurrence<input value={f.extracted.eachOccurrence || ''} onChange={setX('eachOccurrence')} /></label></div>
        <label className="check"><input type="checkbox" checked={f.statusVerified} onChange={set('statusVerified')} />I verified this document is current (checked the dates against the original)</label>
        <label className="check"><input type="checkbox" checked={f.approvedForOutreach} onChange={set('approvedForOutreach')} disabled={typeDef?.sensitive} />Approved for use in outreach{typeDef?.sensitive ? ' — not allowed for sensitive documents' : ''}</label>
        <label className="field">One-line description for emails (what we may say)<input value={f.outreachSummary} onChange={set('outreachSummary')} placeholder="e.g. a California-licensed C-27 landscaping contractor (License #123456)" /></label>
        <label className="field">Who can open this file<select value={f.minRole} onChange={set('minRole')}>{roles.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
        <label className="field">Notes<textarea value={f.notes} onChange={set('notes')} /></label>
        {doc.textPreview && <details><summary className="small">Extracted text (first part)</summary><pre className="code-block small">{doc.textPreview}</pre></details>}
        {doc.extracted?.dateCandidates?.length > 0 && <details><summary className="small">All dates found in the document</summary>{doc.extracted.dateCandidates.map((d, i) => <div key={i} className="small text-2">{d.date} — “…{d.context}…”</div>)}</details>}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

export default function DocumentsPage() {
  const docs = useApi('/documents');
  const reference = useApi('/reference');
  const [type, setType] = useState('contractor_license');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [review, setReview] = useState(null);
  const reload = useThrottled(docs.reload, 800);
  useLiveEvents((e) => { if (e.type === 'document.uploaded') reload(); });
  async function pick(file) { if (!file) return; setBusy(true); setError(null); try { const d = await uploadFile('/documents', file, { type }); docs.reload(); setReview(d); } catch (e) { setError(e); } setBusy(false); }
  const items = docs.data?.items || [];
  const types = docs.data?.types || [];
  return (
    <>
      <div className="page-header"><div><h1>Document library</h1><p>Licenses, insurance, W-9s, capability statements and more. Files are encrypted on disk, expiration dates are tracked, and nothing is used in outreach until you approve it.</p></div></div>
      <ErrorBox error={docs.error || error} />
      {docs.data?.warnings?.length > 0 && <div className="warn-box" style={{ marginBottom: 16 }}><strong>Attention:</strong>{docs.data.warnings.map((w) => <div key={w.id} className="small">{w.title}: {w.warning}</div>)}</div>}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="row"><label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>Document type<select value={type} onChange={(e) => setType(e.target.value)} style={{ width: 260 }}>{types.map((t) => <option key={t.id} value={t.id}>{t.label}{t.sensitive ? ' (sensitive)' : ''}</option>)}</select></label></div>
        <label className="dropzone" style={{ marginTop: 10, display: 'block' }}>{busy ? 'Uploading and reading…' : 'Click to choose a PDF or other file (up to 25 MB)'}<input type="file" onChange={(e) => pick(e.target.files?.[0])} /></label>
        <Help>PDF text is read automatically to suggest dates and numbers. Scanned PDFs cannot be read; you can type the details in during review.</Help>
      </div>
      <div className="card">
        <div className="table-wrap"><table><thead><tr><th>Document</th><th>Type</th><th>Status</th><th>Expires</th><th>Review</th><th>Outreach</th><th>Access</th><th>Uploaded</th><th /></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={9} className="muted">No documents yet.</td></tr>}
            {items.map((d) => (
              <tr key={d.id}>
                <td>{d.title}<div className="small muted">{d.filename} · {(d.size / 1024).toFixed(0)} KB · {d.encryption}</div></td>
                <td>{d.typeLabel}{d.sensitive && <span className="tag" style={{ marginLeft: 4 }}>sensitive</span>}</td>
                <td><span className={`status-pill ${d.status === 'current' ? 'connected' : d.status === 'expired' ? 'error' : ''}`}>{STATUS_LABEL[d.status]}</span>{d.warning && <div className="small check-bad">{d.warning}</div>}</td>
                <td>{d.expires ? (d.expirationDate ? day(d.expirationDate) : <span className="muted">unknown</span>) : 'n/a'}</td>
                <td>{d.reviewStatus.replace(/_/g, ' ')}</td>
                <td>{d.approvedForOutreach ? '✓ approved' : '—'}</td>
                <td>{d.minRole}+</td>
                <td className="small">{when(d.createdAt)}</td>
                <td className="row"><button className="btn sm" onClick={() => setReview(d)}>Review</button><a className="btn sm" href={`/api/v1/documents/${d.id}/download`}>Download</a><ConfirmButton className="btn sm danger" onConfirm={async () => { await api(`/documents/${d.id}`, { method: 'DELETE' }); docs.reload(); }}>Delete</ConfirmButton></td>
              </tr>
            ))}
          </tbody></table></div>
      </div>
      {review && <ReviewModal doc={review} types={types} roles={reference.data?.roles || ['viewer', 'staff', 'owner']} onClose={() => setReview(null)} onSaved={docs.reload} />}
    </>
  );
}
