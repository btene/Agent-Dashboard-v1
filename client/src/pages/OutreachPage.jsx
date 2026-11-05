import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApi, useLiveEvents, useThrottled } from '../lib/hooks.js';
import { when, EMAIL_STATUS_LABEL } from '../lib/intel.js';
import { Help, ConfirmButton } from '../components/intel.jsx';
import { ErrorBox, Empty } from '../components/ui.jsx';

function EmailEditor({ email, styles, docs, settings, onChange }) {
  const [f, setF] = useState({ subject: email.subject, body: email.body, to: email.to || '', attachments: email.attachments || [] });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  useEffect(() => setF({ subject: email.subject, body: email.body, to: email.to || '', attachments: email.attachments || [] }), [email.id, email.updatedAt]);
  const dirty = f.subject !== email.subject || f.body !== email.body || f.to !== (email.to || '') || JSON.stringify(f.attachments) !== JSON.stringify(email.attachments || []);
  async function act(fn) { setError(null); setBusy(true); try { await fn(); onChange(); } catch (e) { setError(e); } setBusy(false); }
  const save = () => act(() => api(`/emails/${email.id}`, { method: 'PATCH', body: f }));
  const editable = !['sent', 'replied'].includes(email.status);
  const sendingEnabled = settings?.automations?.email_sending?.enabled;
  const approvable = docs.filter((d) => d.approvedForOutreach && !d.sensitive);
  return (
    <div className="card card-pad stack" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div><span className="badge">{EMAIL_STATUS_LABEL[email.status]}</span> <span className="small text-2">{styles?.[email.style]?.label} · drafted by {email.trigger} · {when(email.createdAt)}</span></div>
        {email.project && <Link to={`/projects/${email.project.id}`} className="small">Project: {email.project.displayName} (score {email.project.score})</Link>}
      </div>
      <label className="field">To<input value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} disabled={!editable} placeholder="Recipient email — required before approval" /></label>
      <label className="field">Subject<input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} disabled={!editable} /></label>
      <label className="field">Message<textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} disabled={!editable} style={{ minHeight: 260, fontFamily: 'var(--font)', fontSize: 13.5 }} /></label>
      <div className="small text-2">
        <strong>Facts used:</strong> {Object.entries(email.factsUsed || {}).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'none'}<br />
        {email.missingFacts?.length > 0 && <><strong>Not available from sources (left out, never invented):</strong> {email.missingFacts.join(', ')}</>}
      </div>
      {editable && (
        <div>
          <div className="small" style={{ fontWeight: 550 }}>Attachments (only documents you approved for outreach; nothing is attached automatically)</div>
          {approvable.length === 0 && <Help>No documents are approved for outreach. Review them under Documents.</Help>}
          <div className="chips">{approvable.map((d) => <label key={d.id} className="check small"><input type="checkbox" checked={f.attachments.includes(d.id)} onChange={(e) => setF({ ...f, attachments: e.target.checked ? [...f.attachments, d.id] : f.attachments.filter((x) => x !== d.id) })} />{d.title}</label>)}</div>
        </div>
      )}
      <ErrorBox error={error} />
      <div className="row">
        {editable && <button className="btn" disabled={!dirty || busy} onClick={save}>Save changes</button>}
        {['pending_approval', 'draft', 'rejected', 'failed'].includes(email.status) && <button className="btn primary" disabled={busy || dirty} title={dirty ? 'Save your changes first' : ''} onClick={() => act(() => api(`/emails/${email.id}/approve`, { method: 'POST' }))}>Approve</button>}
        {['pending_approval', 'draft', 'approved'].includes(email.status) && <ConfirmButton className="btn" confirmText="Reject this draft?" onConfirm={() => act(() => api(`/emails/${email.id}/reject`, { method: 'POST', body: {} }))}>Reject</ConfirmButton>}
        {email.status === 'approved' && <ConfirmButton className="btn primary" confirmText={`Send to ${email.to} now?`} onConfirm={() => act(() => api(`/emails/${email.id}/send`, { method: 'POST' }))}>Send now</ConfirmButton>}
        {email.status === 'sent' && <button className="btn" disabled={busy} onClick={() => act(() => api(`/emails/${email.id}/replied`, { method: 'POST' }))}>Mark as replied</button>}
      </div>
      {email.status === 'approved' && !settings?.email?.smtpHost && <div className="warn-box small">No email account is connected yet, so sending will fail. Connect one under <Link to="/settings#email">Settings → Email account</Link>.</div>}
      {email.status === 'approved' && settings?.mode === 'automatic' && !sendingEnabled && <div className="notice small">Automatic mode is on but “Automated email sending” is off in the Control Center, so this will only go out when you press Send now.</div>}
      {email.error && <div className="error-box small">{email.error}</div>}
      <details><summary className="small">History</summary>{email.history.map((h, i) => <div key={i} className="small text-2">{when(h.at)} — {h.event}{h.by ? ` by ${h.by}` : ''}{h.error ? `: ${h.error}` : ''}</div>)}</details>
    </div>
  );
}

export default function OutreachPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const emails = useApi(`/emails${status ? `?status=${status}` : ''}`);
  const reference = useApi('/reference');
  const docs = useApi('/documents');
  const settings = useApi('/settings');
  const [openId, setOpenId] = useState(params.get('open'));
  const reload = useThrottled(() => { emails.reload(); }, 800);
  useLiveEvents((e) => { if (e.type.startsWith('email.')) reload(); });
  const list = emails.data || [];
  const open = list.find((e) => e.id === openId) || list[0];
  const pending = list.filter((e) => e.status === 'pending_approval');
  const [bulkMsg, setBulkMsg] = useState(null);
  async function approveAll() { const r = await api('/campaigns/approve', { method: 'POST', body: { ids: pending.filter((e) => e.to).map((e) => e.id) } }); setBulkMsg(`${r.approved} approved${r.results.some((x) => !x.ok) ? `; ${r.results.filter((x) => !x.ok).length} could not be approved (missing recipient or wording check)` : ''}`); emails.reload(); }

  return (
    <>
      <div className="page-header">
        <div><h1>Outreach</h1><p>Every email starts as a draft that waits for you. Drafts only mention facts that came from a verified source, never a relationship, referral or past conversation.</p></div>
        <div className="row">
          <select value={status} onChange={(e) => { const p = new URLSearchParams(params); if (e.target.value) p.set('status', e.target.value); else p.delete('status'); setParams(p); }}>
            <option value="">All emails</option><option value="pending_approval">Awaiting approval</option><option value="approved">Approved, not sent</option><option value="sent,replied">Sent</option><option value="replied">Replied</option><option value="failed">Failed</option><option value="rejected">Rejected</option>
          </select>
          {pending.length > 1 && <ConfirmButton className="btn primary" confirmText={`Approve ${pending.filter((e) => e.to).length} drafts that have a recipient?`} onConfirm={approveAll}>Approve all pending</ConfirmButton>}
        </div>
      </div>
      {bulkMsg && <div className="notice" style={{ marginBottom: 12 }}>{bulkMsg}</div>}
      <ErrorBox error={emails.error} />
      <div className="card card-pad small" style={{ marginBottom: 16 }}>
        <strong>Styles:</strong> {Object.entries(reference.data?.emailStyles || {}).map(([k, s]) => <span key={k} className="tag" style={{ marginLeft: 6 }} title={s.audience}>{s.label}{settings.data?.outreach?.defaultStyle === k ? ' (default)' : ''}</span>)}
        <span className="muted"> · Change the default under Settings → Outreach. Drafts are created from a project page or by the “AI email drafting” automation.</span>
      </div>
      {emails.data && list.length === 0 && <Empty icon="✉️" title="No emails here">Open a project with a contact and press “Draft email”, or let the drafting automation create drafts for high-priority projects.</Empty>}
      {list.length > 0 && (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(260px, 1fr) minmax(0, 2fr)', alignItems: 'start' }}>
          <div className="card">
            {list.map((e) => (
              <button key={e.id} className="project-row" style={{ gridTemplateColumns: '1fr', width: '100%', textAlign: 'left', font: 'inherit', color: 'inherit', background: open?.id === e.id ? 'var(--accent-wash)' : 'transparent', border: 'none', borderTop: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => setOpenId(e.id)}>
                <div><strong>{e.subject}</strong><div className="small text-2">{EMAIL_STATUS_LABEL[e.status]} · {e.to || <span className="check-bad">no recipient</span>}</div><div className="small muted">{e.project?.displayName}</div></div>
              </button>
            ))}
          </div>
          {open && <EmailEditor key={open.id} email={open} styles={reference.data?.emailStyles} docs={docs.data?.items || []} settings={settings.data} onChange={() => { emails.reload(); window.dispatchEvent(new Event('als2000:settings-changed')); }} />}
        </div>
      )}
    </>
  );
}
