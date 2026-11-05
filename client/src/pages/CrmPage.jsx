import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApi, useLiveEvents, useThrottled } from '../lib/hooks.js';
import { usd, when, STAGE_LABEL } from '../lib/intel.js';
import { ProvenanceBadge, Help, ConfirmButton, ScoreBadge } from '../components/intel.jsx';
import { ErrorBox, Modal } from '../components/ui.jsx';

function ContactModal({ contact, roles, onClose, onSaved }) {
  const [f, setF] = useState(contact || { firstName: '', lastName: '', email: '', phone: '', title: '', company: '', role: 'general_contractor', sourceNote: '', notes: '' });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save() { try { if (contact) await api(`/contacts/${contact.id}`, { method: 'PATCH', body: f }); else await api('/contacts', { method: 'POST', body: f }); onSaved(); onClose(); } catch (e) { setError(e); } }
  return (
    <Modal title={contact ? 'Edit contact' : 'Add contact'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="form">
        <div className="form-row"><label className="field">First name<input value={f.firstName || ''} onChange={set('firstName')} /></label><label className="field">Last name<input value={f.lastName || ''} onChange={set('lastName')} /></label></div>
        <div className="form-row"><label className="field">Email<input value={f.email || ''} onChange={set('email')} /></label><label className="field">Phone<input value={f.phone || ''} onChange={set('phone')} /></label></div>
        <div className="form-row"><label className="field">Company<input value={f.company || ''} onChange={set('company')} /></label><label className="field">Title<input value={f.title || ''} onChange={set('title')} /></label></div>
        <label className="field">Role<select value={f.role} onChange={set('role')}>{roles.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}</select></label>
        <label className="field">Where this information came from<input value={f.sourceNote || ''} onChange={set('sourceNote')} /></label>
        <label className="field">Notes<textarea value={f.notes || ''} onChange={set('notes')} /></label>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

export default function CrmPage() {
  const pipeline = useApi('/pipeline');
  const contacts = useApi('/contacts');
  const companies = useApi('/companies');
  const reminders = useApi('/reminders');
  const reference = useApi('/reference');
  const [modal, setModal] = useState(null);
  const [q, setQ] = useState('');
  const reloadAll = () => { pipeline.reload(); contacts.reload(); companies.reload(); reminders.reload(); };
  const reload = useThrottled(reloadAll, 1000);
  useLiveEvents((e) => { if (/^(project|contact|email|crm)\./.test(e.type)) reload(); });
  const cs = (contacts.data || []).filter((c) => !q || [c.firstName, c.lastName, c.email, c.company].some((v) => v && v.toLowerCase().includes(q.toLowerCase())));
  const openReminders = (reminders.data || []).filter((r) => r.status === 'open');
  const stages = (pipeline.data || []).filter((s) => !['not_a_fit'].includes(s.stage));
  return (
    <>
      <div className="page-header"><div><h1>CRM</h1><p>Companies, decision-makers and where every live project stands. Demo records never appear here.</p></div>
        <div className="row"><a className="btn" href="/api/v1/contacts/export.csv">Export contacts</a><a className="btn" href="/api/v1/projects/export.csv">Export projects</a><button className="btn primary" onClick={() => setModal({})}>＋ Add contact</button></div></div>
      <ErrorBox error={pipeline.error || contacts.error} />
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div><h2>Pipeline</h2><p>Stages move automatically when emails are sent or replies are logged, and you can change them on any project page.</p></div></div>
        <div className="card-pad"><div className="pipeline">
          {stages.map((s) => (
            <div key={s.stage} className="col"><h3>{STAGE_LABEL[s.stage]} <span className="muted">{s.count}</span></h3>
              {s.projects.map((p) => <div key={p.id} className="item"><Link to={`/projects/${p.id}`}>{p.displayName}</Link><div className="row small text-2" style={{ marginTop: 2 }}><ScoreBadge score={p.score} tier={p.tier} />{p.city}{p.bidAmount ? <span>· bid {usd(p.bidAmount)}</span> : null}{p.contractValue ? <span>· {usd(p.contractValue)}</span> : null}</div></div>)}
              {s.count > s.projects.length && <Link className="small" to={`/projects?stage=${s.stage}`}>+{s.count - s.projects.length} more</Link>}
            </div>
          ))}
        </div></div>
      </div>
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-header"><div><h2>Contacts ({(contacts.data || []).length})</h2><p>Each contact records where it came from, so it stays auditable.</p></div><input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 200 }} /></div>
          <div className="table-wrap"><table><thead><tr><th>Name</th><th>Company</th><th>Role</th><th>Email</th><th>Source</th><th>Projects</th><th /></tr></thead>
            <tbody>{cs.map((c) => <tr key={c.id}><td>{c.firstName} {c.lastName}<div className="small muted">{c.title}</div></td><td>{c.company}</td><td>{c.role?.replace(/_/g, ' ')}</td><td>{c.email || <span className="muted">—</span>}{c.emailVerification?.status === 'valid' && <span className="check-ok" title={c.emailVerification.detail}> ✓</span>}{c.linkedinUrl && <div className="small"><a href={c.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn{c.linkedinVerifiedAt ? ' ✓' : ''}</a></div>}{c.lastVerifiedAt && <div className="small muted">verified {new Date(c.lastVerifiedAt).toLocaleDateString()}</div>}</td><td><ProvenanceBadge kind={c.provenance} compact />{c.sourceNote && <div className="small muted">{c.sourceNote}</div>}</td><td>{(c.projectIds || []).map((id) => <Link key={id} to={`/projects/${id}`} className="small" style={{ marginRight: 6 }}>open</Link>)}</td><td className="row"><button className="btn sm" onClick={() => setModal(c)}>Edit</button><ConfirmButton className="btn sm danger" onConfirm={async () => { await api(`/contacts/${c.id}`, { method: 'DELETE' }); reloadAll(); }}>Delete</ConfirmButton></td></tr>)}
              {cs.length === 0 && <tr><td colSpan={7} className="muted">No contacts yet. Add the people you identify on project pages.</td></tr>}</tbody></table></div>
        </div>
        <div className="stack">
          <div className="card card-pad" id="reminders">
            <h2>Follow-up reminders ({openReminders.length})</h2>
            {openReminders.length === 0 && <Help>None open. Reminders appear when a sent email has had no reply for the number of days set under Settings → Outreach.</Help>}
            {openReminders.map((r) => <div key={r.id} className="history-item"><Link to={`/projects/${r.projectId}`}>{r.title}</Link><div className="row small" style={{ marginTop: 4 }}><span className="muted">{when(r.dueAt)}</span><button className="btn sm" onClick={async () => { await api(`/reminders/${r.id}`, { method: 'PATCH', body: { status: 'done' } }); reminders.reload(); }}>Done</button></div></div>)}
          </div>
          <div className="card card-pad">
            <h2>Companies ({(companies.data || []).length})</h2>
            <Help>Developers, owners and contractors named on permits are added here automatically by the CRM sync, labelled with where the name came from.</Help>
            <div className="table-wrap" style={{ marginTop: 8 }}><table className="small"><thead><tr><th>Name</th><th>Type</th><th>Source</th></tr></thead><tbody>{(companies.data || []).slice(0, 100).map((c) => <tr key={c.id}><td><Link to={`/companies/${c.id}`}>{c.name}</Link></td><td>{c.type.replace(/_/g, ' ')}</td><td><ProvenanceBadge kind={c.provenance} compact /> {c.sourceNote}</td></tr>)}</tbody></table></div>
          </div>
        </div>
      </div>
      {modal && <ContactModal contact={modal.id ? modal : null} roles={reference.data?.contactRoles || []} onClose={() => setModal(null)} onSaved={reloadAll} />}
    </>
  );
}
