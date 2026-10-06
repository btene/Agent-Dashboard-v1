import { useEffect } from 'react';
import { compact } from '../lib/format.js';

const STATUS_LABEL = { succeeded: 'Succeeded', failed: 'Failed', running: 'Running', queued: 'Queued', cancelled: 'Cancelled' };

export function StatusBadge({ status }) {
  if (!status) return <span className="badge">No runs yet</span>;
  return (
    <span className={`badge status-${status}`}>
      <span className="status-dot" aria-hidden="true" />
      {STATUS_LABEL[status] || status}
    </span>
  );
}

export function RunnerBadge({ runner }) {
  const label = { mock: 'Simulated', http: 'HTTP', claude: 'Claude', command: 'Command' }[runner] || runner;
  return <span className="tag">{label}</span>;
}

export function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Stat tile: label · value · optional delta vs previous period.
 * `upIsGood` decides whether an increase is colored as good or bad.
 */
export function StatTile({ label, value, current, previous, upIsGood = true, format = compact, deltaMode = 'relative' }) {
  let delta = null;
  if (current != null && previous != null && previous !== 0) {
    const diff = deltaMode === 'points' ? (current - previous) * 100 : ((current - previous) / Math.abs(previous)) * 100;
    if (Math.abs(diff) >= 0.05) {
      const good = diff > 0 === upIsGood;
      delta = (
        <div className={`delta ${good ? 'good' : 'bad'}`}>
          {diff > 0 ? '▲' : '▼'} {Math.abs(diff).toFixed(1)}{deltaMode === 'points' ? ' pts' : '%'} <span className="muted">vs prev. period</span>
        </div>
      );
    }
  }
  return (
    <div className="card tile">
      <div className="label">{label}</div>
      <div className="value">{value ?? format(current)}</div>
      {delta || <div className="delta">&nbsp;</div>}
    </div>
  );
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="error-box">{error.message || String(error)}</div>;
}

export function Empty({ icon = '🤖', title, children }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      <h2 style={{ margin: '8px 0 4px' }}>{title}</h2>
      <div>{children}</div>
    </div>
  );
}
