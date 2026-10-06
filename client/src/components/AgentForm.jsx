import { useMemo, useState } from 'react';
import { Modal, ErrorBox } from './ui.jsx';
import { api } from '../lib/api.js';
import { useApi } from '../lib/hooks.js';

const ICONS = ['🤖', '🔎', '✉️', '📊', '🧾', '🛠️', '📝', '💬', '📈', '🧠', '⚡', '🗂️'];

function initialConfig(runner, existing) {
  const cfg = {};
  for (const f of runner?.configFields || []) {
    const v = existing?.[f.key] ?? f.default ?? '';
    cfg[f.key] = f.type === 'json' && typeof v === 'object' ? JSON.stringify(v, null, 2) : v;
  }
  return cfg;
}

/** Create or edit an agent. `agent` = existing agent to edit, or undefined. */
export default function AgentForm({ agent, onClose, onSaved }) {
  const runners = useApi('/runners');
  const [form, setForm] = useState({
    name: agent?.name || '',
    description: agent?.description || '',
    icon: agent?.icon || '🤖',
    tags: (agent?.tags || []).join(', '),
    runner: agent?.runner || 'http',
    inputPlaceholder: agent?.inputPlaceholder || '',
  });
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const runner = useMemo(() => runners.data?.find((r) => r.type === form.runner), [runners.data, form.runner]);
  const cfg = config ?? (runner ? initialConfig(runner, agent?.runner === form.runner ? agent.config : null) : {});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setCfg = (k) => (e) => setConfig({ ...cfg, [k]: e.target.value });

  async function save() {
    setError(null);
    try {
      const outConfig = {};
      for (const f of runner?.configFields || []) {
        let v = cfg[f.key];
        if (f.type === 'number') v = v === '' ? undefined : Number(v);
        if (f.type === 'json') v = v?.trim() ? JSON.parse(v) : {};
        if (f.required && (v === '' || v == null)) throw new Error(`${f.label} is required`);
        if (v !== undefined && v !== '') outConfig[f.key] = v;
      }
      setSaving(true);
      const body = {
        ...form,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        config: outConfig,
      };
      const saved = agent ? await api(`/agents/${agent.id}`, { method: 'PATCH', body }) : await api('/agents', { method: 'POST', body });
      onSaved?.(saved);
      onClose();
    } catch (e) {
      setError(e instanceof SyntaxError ? new Error('Headers must be valid JSON') : e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={agent ? `Edit ${agent.name}` : 'Add an agent'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save} disabled={saving || !form.name.trim()}>{saving ? 'Saving…' : agent ? 'Save changes' : 'Create agent'}</button></>}>
      <div className="form">
        <div className="form-row" style={{ gridTemplateColumns: '1fr auto' }}>
          <label className="field">Name<input value={form.name} onChange={set('name')} placeholder="e.g. Lead Researcher" autoFocus /></label>
          <label className="field">Icon
            <select value={form.icon} onChange={set('icon')} style={{ width: 72 }}>{ICONS.map((i) => <option key={i}>{i}</option>)}</select>
          </label>
        </div>
        <label className="field">Description<input value={form.description} onChange={set('description')} placeholder="What does this agent do?" /></label>
        <label className="field">Tags <span className="hint">Comma-separated — used for filtering</span><input value={form.tags} onChange={set('tags')} placeholder="sales, research" /></label>

        <label className="field">How is this agent run?
          <select value={form.runner} onChange={(e) => { setForm((f) => ({ ...f, runner: e.target.value })); setConfig(null); }}>
            {(runners.data || []).map((r) => (
              <option key={r.type} value={r.type} disabled={!r.available}>{r.label}{r.available ? '' : ' (disabled on server)'}</option>
            ))}
          </select>
          {runner && <span className="hint">{runner.description}</span>}
        </label>

        {runner?.configFields.map((f) => (
          <label key={f.key} className="field">{f.label}{f.required && ' *'}
            {f.type === 'select' ? (
              <select value={cfg[f.key]} onChange={setCfg(f.key)}>{f.options.map((o) => <option key={o}>{o}</option>)}</select>
            ) : f.type === 'textarea' || f.type === 'json' ? (
              <textarea value={cfg[f.key]} onChange={setCfg(f.key)} placeholder={f.placeholder} rows={f.type === 'json' ? 3 : 5} />
            ) : (
              <input type={f.type === 'number' ? 'number' : 'text'} step="any" value={cfg[f.key]} onChange={setCfg(f.key)} placeholder={f.placeholder} />
            )}
          </label>
        ))}

        <label className="field">Input hint <span className="hint">Placeholder shown in the run box</span>
          <input value={form.inputPlaceholder} onChange={set('inputPlaceholder')} placeholder="e.g. Company name or URL" />
        </label>
        <ErrorBox error={error || runners.error} />
      </div>
    </Modal>
  );
}
