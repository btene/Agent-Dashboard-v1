import { useState } from 'react';
import { Link } from 'react-router-dom';
import { NOT_YET_VERIFIED, PROVENANCE_LABEL, TIER_LABEL, usd } from '../lib/intel.js';

export function ProvenanceBadge({ kind, compact = false }) {
  if (!kind) return null;
  const cls = { government: 'prov-gov', third_party: 'prov-third', ai_estimate: 'prov-ai', unverified: 'prov-unv', user: 'prov-user' }[kind] || 'prov-unv';
  return <span className={`prov ${cls}`} title={PROVENANCE_LABEL[kind]}>{compact ? { government: 'Gov', third_party: '3rd party', ai_estimate: 'Estimate', unverified: 'Unverified', user: 'Team' }[kind] : PROVENANCE_LABEL[kind]}</span>;
}

/** A labelled fact. Null values show "Not yet verified" and the provenance chip says where the value came from. */
export function Fact({ label, value, provenance, format, children }) {
  const missing = value === null || value === undefined || value === NOT_YET_VERIFIED || value === '';
  const text = missing ? NOT_YET_VERIFIED : format ? format(value) : String(value);
  return (
    <div className="fact">
      <div className="fact-label">{label} {provenance && <ProvenanceBadge kind={missing ? 'unverified' : provenance} compact />}</div>
      <div className={`fact-value ${missing ? 'missing' : ''}`}>{children ?? text}</div>
    </div>
  );
}

export function ScoreBadge({ score, tier }) {
  const t = tier || (score >= 75 ? 'high' : score >= 50 ? 'medium' : score >= 25 ? 'low' : 'none');
  return <span className={`score tier-${t}`} title={TIER_LABEL[t]}>{score ?? '—'}<small>/100</small></span>;
}

export function ScoreBreakdown({ score }) {
  if (!score) return null;
  return (
    <div className="stack" style={{ gap: 10 }}>
      {score.breakdown.map((b) => (
        <div key={b.key} className="score-row">
          <div className="row" style={{ justifyContent: 'space-between' }}><strong>{b.label}</strong><span className="tabular">{b.points} / {b.max}</span></div>
          <div className="bar"><div className="bar-fill" style={{ width: `${(b.points / b.max) * 100}%` }} /></div>
          <div className="small text-2">{b.reason}</div>
        </div>
      ))}
      {score.notes?.map((n, i) => <div key={i} className="notice small">{n}</div>)}
      <div className="small muted">Scored {new Date(score.scoredAt).toLocaleString()} · method {score.version}</div>
    </div>
  );
}

export function Switch({ checked, onChange, disabled, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`switch ${checked ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="knob" />
    </button>
  );
}

export function DemoBanner({ environment }) {
  if (environment !== 'demo') return null;
  return <div className="demo-banner">You are viewing the <strong>DEMO environment</strong>. Every project here is fictional sample data for learning the screens. Demo records can never be emailed, added to the pipeline, or counted on the business dashboard. <Link to="/settings#environment">Switch back to live data</Link>.</div>;
}

export function Help({ children }) { return <p className="help">{children}</p>; }

export function ConfirmButton({ className = 'btn', onConfirm, children, confirmText = 'Are you sure?', disabled }) {
  const [arm, setArm] = useState(false);
  if (!arm) return <button className={className} disabled={disabled} onClick={() => setArm(true)}>{children}</button>;
  return <span className="row"><span className="small text-2">{confirmText}</span><button className="btn sm danger" onClick={() => { setArm(false); onConfirm(); }}>Yes</button><button className="btn sm" onClick={() => setArm(false)}>No</button></span>;
}

export function Money({ value }) { return <span className="tabular">{usd(value)}</span>; }

export function SourceLinks({ project, size = '' }) {
  const url = project.sourceRecordUrl;
  return (
    <span className="row">
      {url ? <a className={`btn ${size} primary`} href={url} target="_blank" rel="noreferrer">VIEW ORIGINAL SOURCE ↗</a>
        : <button className={`btn ${size}`} disabled title="This record came from a file import without a link to the original">VIEW ORIGINAL SOURCE</button>}
      {project.agencyLookupUrl && <a className={`btn ${size}`} href={project.agencyLookupUrl} target="_blank" rel="noreferrer" title="Open the agency's own permit lookup and enter the permit number">Agency lookup ↗</a>}
      {project.sourcePortalUrl && <a className={`btn ${size} ghost`} href={project.sourcePortalUrl} target="_blank" rel="noreferrer">Dataset page ↗</a>}
    </span>
  );
}
