import { useState } from 'react';
import { Modal } from './ui.jsx';
import { getApiKey, setApiKey } from '../lib/api.js';
import { resetEventSource } from '../lib/hooks.js';

export default function ApiKeyPrompt({ onClose }) {
  const [key, setKey] = useState(getApiKey());
  const save = () => {
    setApiKey(key.trim());
    resetEventSource();
    window.location.reload();
  };
  return (
    <Modal title="API key required" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save} disabled={!key.trim()}>Save &amp; reload</button></>}>
      <div className="form">
        <p className="text-2" style={{ margin: 0 }}>This dashboard is protected. Enter the value of <code>DASHBOARD_API_KEY</code> configured on the server. It is stored only in this browser.</p>
        <label className="field">API key
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && key.trim() && save()} />
        </label>
      </div>
    </Modal>
  );
}
