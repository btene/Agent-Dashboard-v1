import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi, useLiveEvents, useThrottled } from '../lib/hooks.js';
import { usd, day, useEnvironment, STAGE_LABEL, NOT_YET_VERIFIED } from '../lib/intel.js';
import { ProvenanceBadge, ScoreBadge, SourceLinks, Help } from '../components/intel.jsx';
import { ErrorBox, Empty } from '../components/ui.jsx';

export default function ProjectsPage() {
  const [params, setParams] = useSearchParams();
  const environment = useEnvironment();
  const reference = useApi('/reference');
  const query = useMemo(() => { const p = new URLSearchParams(params); p.set('environment', environment); if (!p.get('limit')) p.set('limit', '200'); return p.toString(); }, [params, environment]);
  const data = useApi(`/projects?${query}`);
  const reload = useThrottled(data.reload, 1500);
  useLiveEvents((e) => { if (e.type.startsWith('project.')) reload(); });

  const set = (k, v) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p); };
  const get = (k) => params.get(k) || '';
  const items = data.data?.items || [];
  const activeFilters = [...params.keys()].filter((k) => !['sort', 'limit'].includes(k));

  return (
    <>
      <div className="page-header">
        <div><h1>Projects</h1><p>Commercial permits and projects pulled from official sources, scored for landscaping fit. Nothing on this page is invented: missing facts say “{NOT_YET_VERIFIED}”.</p></div>
        <div className="row">
          <a className="btn" href={`/api/v1/projects/export.csv?${query}`}>Export CSV</a>
        </div>
      </div>
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="filters">
          <input placeholder="Search address, permit #, description…" value={get('q')} onChange={(e) => set('q', e.target.value)} />
          <select value={get('tier')} onChange={(e) => set('tier', e.target.value)}><option value="">Any priority</option><option value="high">High priority (75+)</option><option value="high,medium">Worth pursuing (50+)</option><option value="low">Low priority</option></select>
          <select value={get('stage')} onChange={(e) => set('stage', e.target.value)}><option value="">Any stage</option>{(reference.data?.pipelineStages || []).map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</select>
          <select value={get('projectType')} onChange={(e) => set('projectType', e.target.value)}><option value="">Any project type</option>{Object.entries(reference.data?.projectTypes || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select value={get('county')} onChange={(e) => set('county', e.target.value)}><option value="">Any county</option>{['Santa Barbara', 'Ventura', 'Los Angeles', 'San Bernardino', 'Orange'].map((c) => <option key={c}>{c}</option>)}</select>
          <select value={get('sort') || 'score'} onChange={(e) => set('sort', e.target.value)}><option value="score">Sort: score</option><option value="newest">Sort: newest found</option><option value="issued">Sort: issue date</option><option value="valuation">Sort: valuation</option></select>
          <label className="check small"><input type="checkbox" checked={get('needsVerification') === 'true'} onChange={(e) => set('needsVerification', e.target.checked ? 'true' : '')} />Needs verification</label>
          <label className="check small"><input type="checkbox" checked={get('includeExcluded') === 'true'} onChange={(e) => set('includeExcluded', e.target.checked ? 'true' : '')} />Show excluded residential</label>
        </div>
        {activeFilters.length > 0 && <div className="row small" style={{ marginTop: 8 }}><span className="muted">{data.data?.total ?? '…'} projects match.</span><button className="btn sm ghost" onClick={() => setParams(new URLSearchParams())}>Clear filters</button></div>}
      </div>
      <ErrorBox error={data.error} />
      {data.data && items.length === 0 && (
        <Empty icon="🏗️" title={environment === 'demo' ? 'No demo projects' : 'No live projects yet'}>
          {environment === 'demo' ? <>Seed sample data under <Link to="/settings#environment">Settings → Environment</Link>.</> : <>Connect a permit source under <Link to="/integrations">Integrations</Link> and run it, or clear the filters above.</>}
        </Empty>
      )}
      {items.length > 0 && (
        <div className="card">
          <div className="card-header"><div><h2>{data.data.total} project{data.data.total === 1 ? '' : 's'}</h2><p>Showing {environment === 'demo' ? 'fictional DEMO records' : 'live records'}. Scores explain themselves on the project page.</p></div></div>
          {items.map((p) => (
            <div key={p.id} className="project-row">
              <div><ScoreBadge score={p.score?.total} tier={p.tier} /></div>
              <div style={{ minWidth: 0 }}>
                <h3><Link to={`/projects/${p.id}`}>{p.displayName}</Link> {p.isDemo && <span className="tag env-demo">DEMO</span>}</h3>
                <div className="small text-2" style={{ marginTop: 2 }}>{p.display.address} · Permit {p.display.permitNumber} · {p.display.status}{p.issuedAt ? ` · issued ${day(p.issuedAt)}` : ''}</div>
                <div className="small" style={{ marginTop: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.display.description}</div>
                <div className="chips" style={{ marginTop: 6 }}>
                  <ProvenanceBadge kind={p.recordClass} compact />
                  <span className="tag">{p.classification?.projectTypeLabel} <ProvenanceBadge kind="ai_estimate" compact /></span>
                  <span className="tag">{STAGE_LABEL[p.stage]}</span>
                  <span className="tag">Valuation {usd(p.valuation, { compact: true })}</span>
                  {p.verification?.status !== 'verified' && <span className="tag" style={{ color: 'var(--critical-text)' }}>Verification: {p.verification?.status}</span>}
                  {p.contactCount > 0 && <span className="tag">{p.contactCount} contact{p.contactCount > 1 ? 's' : ''}</span>}
                </div>
              </div>
              <div className="stack" style={{ gap: 6, alignItems: 'flex-end' }}>
                <SourceLinks project={p} size="sm" />
                <Link className="btn sm" to={`/projects/${p.id}`}>Open</Link>
              </div>
            </div>
          ))}
        </div>
      )}
      <Help style={{ marginTop: 12 }}>Project type is an automated estimate from the permit text, never a verified fact. Individual homes and small residential work are scored as “Not a fit” and hidden unless you tick “Show excluded residential”.</Help>
    </>
  );
}
