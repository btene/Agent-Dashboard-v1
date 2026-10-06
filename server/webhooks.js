// Outbound webhooks: POST run events to other systems/dashboards.
// Payloads are signed with HMAC-SHA256 (header X-Agent-Dashboard-Signature)
// when the webhook has a secret.
import crypto from 'node:crypto';

export const WEBHOOK_EVENTS = ['run.created', 'run.started', 'run.succeeded', 'run.failed', 'run.cancelled', 'agent.created', 'agent.updated', 'agent.deleted'];

export async function deliver(hook, event) {
  const body = JSON.stringify(event);
  const headers = { 'content-type': 'application/json', 'x-agent-dashboard-event': event.type };
  if (hook.secret) {
    headers['x-agent-dashboard-signature'] = `sha256=${crypto.createHmac('sha256', hook.secret).update(body).digest('hex')}`;
  }
  const res = await fetch(hook.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) });
  return res.status;
}

export function attachWebhooks({ store, bus }) {
  return bus.subscribe(async (event) => {
    if (event.type === 'run.log' || event.type === 'run.updated') return;
    // Strip bulky fields before sending.
    const data = event.data?.logs ? { ...event.data, logs: undefined } : event.data;
    for (const hook of store.list('webhooks')) {
      if (!hook.enabled) continue;
      if (hook.events?.length && !hook.events.includes(event.type)) continue;
      try {
        const status = await deliver(hook, { ...event, data });
        store.update('webhooks', hook.id, { lastStatus: status, lastDeliveryAt: new Date().toISOString() });
      } catch (err) {
        store.update('webhooks', hook.id, { lastStatus: `error: ${err.message}`, lastDeliveryAt: new Date().toISOString() });
      }
    }
  });
}
