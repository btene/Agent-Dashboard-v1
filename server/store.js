// Tiny JSON-file persistence layer. Swap this module for a real database
// (Postgres, SQLite, …) without touching the rest of the server.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const COLLECTIONS = ['agents', 'runs', 'dashboards', 'webhooks'];
const MAX_RUNS = Number(process.env.MAX_RUNS || 20000);

export function createStore({ dataDir = process.env.DATA_DIR || 'data', persist = true } = {}) {
  const file = path.resolve(dataDir, 'db.json');
  let db = Object.fromEntries(COLLECTIONS.map((c) => [c, []]));

  if (persist && fs.existsSync(file)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const c of COLLECTIONS) db[c] = Array.isArray(loaded[c]) ? loaded[c] : [];
    } catch (err) {
      console.error(`[store] could not read ${file}, starting empty:`, err.message);
    }
  }

  let saveTimer = null;
  function scheduleSave() {
    if (!persist || saveTimer) return;
    saveTimer = setTimeout(flush, 250);
  }
  function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!persist) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, file);
  }

  function assertCollection(c) {
    if (!COLLECTIONS.includes(c)) throw new Error(`Unknown collection: ${c}`);
  }

  return {
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
      if (c === 'runs' && db.runs.length > MAX_RUNS) db.runs.splice(0, db.runs.length - MAX_RUNS);
      scheduleSave();
      return doc;
    },
    insertMany(c, docs) {
      assertCollection(c);
      db[c].push(...docs);
      scheduleSave();
    },
    update(c, id, patch) {
      const doc = this.get(c, id);
      if (!doc) return null;
      Object.assign(doc, patch);
      scheduleSave();
      return doc;
    },
    remove(c, id) {
      assertCollection(c);
      const i = db[c].findIndex((x) => x.id === id);
      if (i === -1) return false;
      db[c].splice(i, 1);
      scheduleSave();
      return true;
    },
    removeWhere(c, pred) {
      assertCollection(c);
      const before = db[c].length;
      db[c] = db[c].filter((x) => !pred(x));
      scheduleSave();
      return before - db[c].length;
    },
    flush,
  };
}
