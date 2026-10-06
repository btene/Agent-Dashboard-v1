import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, ErrorBox } from './ui.jsx';
import { api } from '../lib/api.js';

export default function RunDialog({ agent, onClose }) {
  const navigate = useNavigate();
  const [input, setInput] = useState(agent.defaultInput || '');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function run(openAfter) {
    setBusy(true);
    setError(null);
    try {
      const r = await api(`/agents/${agent.id}/runs`, { method: 'POST', body: { input } });
      onClose();
      if (openAfter) navigate(`/runs/${r.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal title={`Run ${agent.name}`} onClose={onClose}
      footer={<>
        <button className="btn" onClick={() => run(false)} disabled={busy}>Run in background</button>
        <button className="btn primary" onClick={() => run(true)} disabled={busy}>▶ Run &amp; watch</button>
      </>}>
      <div className="form">
        <label className="field">Input
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={6} autoFocus
            placeholder={agent.inputPlaceholder || 'Instructions or data for the agent…'}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(true); }} />
          <span className="hint">⌘/Ctrl + Enter to run</span>
        </label>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
