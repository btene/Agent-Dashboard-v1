// Generic ArcGIS REST (FeatureServer / MapServer layer) query helper.
import { fetchJson, SourceUnavailableError } from './socrata.js';

export function layerQueryUrl(layerUrl, params) {
  const u = new URL(`${layerUrl}/query`);
  for (const [k, v] of Object.entries({ f: 'json', ...params })) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  return u.toString();
}

/** Page through a layer query (servers cap results at maxRecordCount, usually 2000). */
export async function queryAll(layerUrl, { where, outFields = '*', orderByFields, returnGeometry = true, pageSize = 1000, maxRows = 4000 }, opts = {}) {
  const features = [];
  let offset = 0;
  while (features.length < maxRows) {
    const url = layerQueryUrl(layerUrl, { where, outFields, orderByFields, returnGeometry, outSR: 4326, resultOffset: offset, resultRecordCount: Math.min(pageSize, maxRows - features.length) });
    const data = await fetchJson(url, {}, opts);
    if (data.error) throw new SourceUnavailableError(`ArcGIS error: ${data.error.message || JSON.stringify(data.error)}`);
    features.push(...(data.features || []));
    if (!data.exceededTransferLimit || !(data.features || []).length) break;
    offset += data.features.length;
  }
  return features;
}

export async function layerStats(layerUrl, stats, where = '1=1', opts = {}) {
  const data = await fetchJson(layerQueryUrl(layerUrl, { where, outStatistics: JSON.stringify(stats) }), {}, opts);
  if (data.error) throw new SourceUnavailableError(`ArcGIS error: ${data.error.message}`);
  return data.features?.[0]?.attributes || {};
}

export function centroid(geometry) {
  if (!geometry) return { lat: null, lon: null };
  if (geometry.x != null) return { lat: geometry.y, lon: geometry.x };
  const ring = geometry.rings?.[0];
  if (!ring?.length) return { lat: null, lon: null };
  const [sx, sy] = ring.reduce(([a, b], [x, y]) => [a + x, b + y], [0, 0]);
  return { lat: sy / ring.length, lon: sx / ring.length };
}

export const esriDate = (v) => (v == null ? null : new Date(v).toISOString());
export const sqlDate = (iso) => `DATE '${String(iso).slice(0, 10)}'`;
