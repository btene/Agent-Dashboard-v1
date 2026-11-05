// Generic Socrata (SODA 2.1) connector. Used for the City of Los Angeles
// building permit dataset and reusable for any other Socrata portal.
// It only ever fetches; it never fabricates fields it did not receive.

const DEFAULT_TIMEOUT = 30_000;

export class SourceUnavailableError extends Error {
  constructor(message, { status = null, cause = null } = {}) {
    super(message);
    this.name = 'SourceUnavailableError';
    this.status = status;
    this.cause = cause;
  }
}

function headers(config) {
  const h = { accept: 'application/json' };
  if (config.appToken) h['x-app-token'] = config.appToken;
  return h;
}

export function resourceUrl(config, params = {}) {
  const u = new URL(`https://${config.domain}/resource/${config.datasetId}.json`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  return u.toString();
}

export async function fetchJson(url, config = {}, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT } = {}) {
  let res;
  try {
    res = await fetchImpl(url, { headers: headers(config), signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new SourceUnavailableError(`Could not reach ${new URL(url).host}: ${err.message}`, { cause: err });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = `${res.status} ${res.statusText}`;
    try { msg = JSON.parse(text).message || msg; } catch { /* not json */ }
    throw new SourceUnavailableError(`Source returned ${msg}`, { status: res.status });
  }
  return res.json();
}

/** Dataset metadata, including the publisher's own "rows updated" timestamp. */
export async function fetchMetadata(config, opts) {
  const m = await fetchJson(`https://${config.domain}/api/views/${config.datasetId}.json`, config, opts);
  return {
    name: m.name,
    attribution: m.attribution,
    rowsUpdatedAt: m.rowsUpdatedAt ? new Date(m.rowsUpdatedAt * 1000).toISOString() : null,
    publisherRefreshRate: m.metadata?.custom_fields?.['Committed Update Frequency']?.['Refresh rate'] || null,
    license: m.license?.name || null,
    webUrl: `https://${config.domain}/d/${config.datasetId}`,
  };
}

/** Page through a SoQL query. `where`/`order`/`select` are raw SoQL fragments. */
export async function query(config, { where, order, select, limit = 1000, maxRows = 5000 } = {}, opts) {
  const rows = [];
  let offset = 0;
  while (rows.length < maxRows) {
    const pageLimit = Math.min(limit, maxRows - rows.length);
    const url = resourceUrl(config, { $where: where, $order: order, $select: select, $limit: pageLimit, $offset: offset });
    const page = await fetchJson(url, config, opts);
    rows.push(...page);
    if (page.length < pageLimit) break;
    offset += page.length;
  }
  return rows;
}
