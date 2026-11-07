// Document store. Data lives in memory for fast synchronous access by the rest
// of the server, and is persisted either to a JSON file (single always-on
// server) or to Postgres (Vercel + Supabase, where many short-lived instances
// share one database). Swap persistence without touching the rest of the code.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const COLLECTIONS = [
  'agents', 'runs', 'dashboards', 'webhooks',
  // Construction-intelligence platform
  'projects', 'projectHistory', 'verifications', 'sources', 'sourceRuns',
  'companies', 'contacts', 'activities', 'emails', 'documents', 'reminders',
  'jobRuns', 'settings', 'imports', 'candidates', 'researchRuns',
];
const MAX_RUNS = Number(process.env.MAX_RUNS || 20000);

/**
 * @param {object} opts
 * @param {string} [opts.dataDir]   folder for db.json (file mode)
 * @param {boolean} [opts.persist]  false = memory only (tests)
 * @param {object} [opts.adapter]   Postgres adapter (see persistence/postgres.js)
 */
export function createStore({ dataDir = process.env.DATA_DIR || 'data', persist = true, adapter = null } = {}) {
  const file = path.resolve(dataDir, 'db.json');
  let db = Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
  const dirty = new Map(); // `${collection}\u0000${id}` -> { collection, id }
  let ready;
  let isReady = false;

  if (adapter) {
    ready = adapter.loadAll().then((loaded) => {
      for (const c of COLLECTIONS) db[c] = Array.isArray(loaded[c]) ? loaded[c] : [];
      isReady = true;
    });
  } else {
    if (persist && fs.existsSync(file)) {
      try {
        const loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const c of COLLECTIONS) db[c] = Array.isArray(loaded[c]) ? loaded[c] : [];
      } catch (err) {
        console.error(`[store] could not read ${file}, starting empty:`, err.message);
      }
    }
    isReady = true;
    ready = Promise.resolve();
  }

  function mark(collection, id) { if (adapter && id != null) dirty.set(`${collection}\u0000${id}`, { collection, id }); }

  let saveTimer = null;
  let flushing = Promise.resolve();
  function scheduleSave() {
    if (adapter) {
      // Background work that outlives a request (e.g. an agent run) still gets saved.
      if (!saveTimer) {
        saveTimer = setTimeout(() => { saveTimer = null; keepAlive(flush()); }, 50);
      }
      return;
    }
    if (!persist || saveTimer) return;
    saveTimer = setTimeout(flush, 250);
  }

  function keepAlive(promise) {
    if (process.env.VERCEL) import('@vercel/functions').then(({ waitUntil }) => waitUntil(promise)).catch(() => {});
    return promise;
  }

  /** Write pending changes. Returns a promise in Postgres mode. */
  function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (adapter) {
      if (!dirty.size) return flushing;
      const changes = [...dirty.values()].map(({ collection, id }) => ({ collection, id, doc: db[collection].find((x) => x.id === id) || null }));
      dirty.clear();
      flushing = flushing.then(() => adapter.write(changes)).catch((err) => {
        console.error('[store] write failed, will retry:', err.message);
        for (const c of changes) dirty.set(`${c.collection}\u0000${c.id}`, c);
        throw err;
      });
      return flushing;
    }
    if (!persist) return Promise.resolve();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, file);
    return Promise.resolve();
  }

  /** Pull changes other instances wrote (Postgres mode). Keeps object identity for updated docs. */
  async function sync() {
    if (!adapter) return 0;
    await ready;
    const changes = await adapter.changesSince();
    for (const ch of changes) {
      if (!COLLECTIONS.includes(ch.collection)) continue;
      if (dirty.has(`${ch.collection}\u0000${ch.id}`)) continue; // our unsaved local edit wins
      const list = db[ch.collection];
      const i = list.findIndex((x) => x.id === ch.id);
      if (ch.deleted) { if (i >= 0) list.splice(i, 1); continue; }
      if (i >= 0) { for (const k of Object.keys(list[i])) if (!(k in ch.data)) delete list[i][k]; Object.assign(list[i], ch.data); }
      else list.push(ch.data);
    }
    return changes.length;
  }

  function assertCollection(c) {
    if (!COLLECTIONS.includes(c)) throw new Error(`Unknown collection: ${c}`);
  }

  return {
    get ready() { return ready; },
    get isReady() { return isReady; },
    mode: adapter ? 'postgres' : persist ? 'file' : 'memory',
    files: adapter?.files || null,
    /** True for exactly one instance per key (always true without a shared database). */
    claim: (key) => (adapter?.claim ? adapter.claim(key) : Promise.resolve(true)),
    sync,
    newId: (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    list(c) {
      assertCollection(c);
      return db[c];
    },
    get(c, id) {
      assertCollection(c);
      return db[c].find((x) => x.id === id) || null;
    },
    insert(c, doc) {
      assertCollection(c);
      db[c].push(doc);
      mark(c, doc.id);
      if (c === 'runs' && db.runs.length > MAX_RUNS) for (const r of db.runs.splice(0, db.runs.length - MAX_RUNS)) mark('runs', r.id);
      scheduleSave();
      return doc;
    },
    insertMany(c, docs) {
      assertCollection(c);
      db[c].push(...docs);
      for (const d of docs) mark(c, d.id);
      scheduleSave();
    },
    update(c, id, patch) {
      const doc = this.get(c, id);
      if (!doc) return null;
      Object.assign(doc, patch);
      mark(c, id);
      scheduleSave();
      return doc;
    },
    remove(c, id) {
      assertCollection(c);
      const i = db[c].findIndex((x) => x.id === id);
      if (i === -1) return false;
      db[c].splice(i, 1);
      mark(c, id);
      scheduleSave();
      return true;
    },
    removeWhere(c, pred) {
      assertCollection(c);
      const before = db[c].length;
      const keep = [];
      for (const x of db[c]) { if (pred(x)) mark(c, x.id); else keep.push(x); }
      db[c] = keep;
      scheduleSave();
      return before - db[c].length;
    },
    flush,
  };
}
