// Postgres persistence for the document store (used on Vercel with Supabase).
//
// Every collection document is one row in `als.docs` (JSONB). Each write takes
// a value from a global sequence, so any server instance can catch up with
// changes made by others by asking for rows with a higher sequence number.
// Encrypted company documents are kept in `als.files` (BYTEA).
//
// `client` is anything with `query(text, params) -> { rows }`: a pg Pool in
// production, PGlite in tests.
// Tables live in their own `als` schema, which Supabase does not expose through
// its public Data API, and have row-level security switched on with no
// policies, so only the platform's own database login can read them.
const SCHEMA = `
CREATE SCHEMA IF NOT EXISTS als;
CREATE SEQUENCE IF NOT EXISTS als.seq;
CREATE TABLE IF NOT EXISTS als.docs (
  collection text NOT NULL,
  id text NOT NULL,
  data jsonb,
  deleted boolean NOT NULL DEFAULT false,
  seq bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS docs_seq_idx ON als.docs (seq);
CREATE TABLE IF NOT EXISTS als.files (
  id text PRIMARY KEY,
  content bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE als.docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE als.files ENABLE ROW LEVEL SECURITY;
`;

export function createPostgresAdapter(client) {
  let lastSeq = 0;
  let schemaReady = null;

  async function ensureSchema() {
    if (!schemaReady) schemaReady = (async () => { for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) await client.query(stmt); })();
    return schemaReady;
  }

  return {
    kind: 'postgres',
    /** Load every live document. Returns { collection: [docs] }. */
    async loadAll() {
      await ensureSchema();
      const { rows } = await client.query('SELECT collection, data, seq FROM als.docs WHERE NOT deleted ORDER BY seq');
      const out = {};
      for (const r of rows) {
        (out[r.collection] ||= []).push(typeof r.data === 'string' ? JSON.parse(r.data) : r.data);
        if (Number(r.seq) > lastSeq) lastSeq = Number(r.seq);
      }
      const max = await client.query('SELECT COALESCE(MAX(seq), 0) AS m FROM als.docs');
      lastSeq = Math.max(lastSeq, Number(max.rows[0].m));
      return out;
    },
    /** Changes written by any instance since this one last looked. */
    async changesSince() {
      await ensureSchema();
      const { rows } = await client.query('SELECT collection, id, data, deleted, seq FROM als.docs WHERE seq > $1 ORDER BY seq', [lastSeq]);
      for (const r of rows) if (Number(r.seq) > lastSeq) lastSeq = Number(r.seq);
      return rows.map((r) => ({ collection: r.collection, id: r.id, deleted: r.deleted, data: r.deleted ? null : (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) }));
    },
    /** Write upserts and deletes. `changes`: [{ collection, id, doc | null }]. */
    async write(changes) {
      if (!changes.length) return;
      await ensureSchema();
      for (let i = 0; i < changes.length; i += 400) {
        const chunk = changes.slice(i, i + 400);
        await client.query(
          `INSERT INTO als.docs (collection, id, data, deleted, seq, updated_at)
           SELECT c, i, CASE WHEN del THEN NULL ELSE d::jsonb END, del, nextval('als.seq'), now()
           FROM unnest($1::text[], $2::text[], $3::text[], $4::boolean[]) AS t(c, i, d, del)
           ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, deleted = EXCLUDED.deleted, seq = EXCLUDED.seq, updated_at = now()`,
          [chunk.map((c) => c.collection), chunk.map((c) => c.id), chunk.map((c) => (c.doc ? JSON.stringify(c.doc) : null)), chunk.map((c) => !c.doc)],
        );
      }
    },
    /** Claim a one-time task across all instances (e.g. first-run seeding). True for exactly one caller. */
    async claim(key) {
      await ensureSchema();
      const { rows } = await client.query(
        `INSERT INTO als.docs (collection, id, data, deleted, seq) VALUES ('_meta', $1, $2::jsonb, false, nextval('als.seq'))
         ON CONFLICT (collection, id) DO NOTHING RETURNING id`, [key, JSON.stringify({ claimedAt: new Date().toISOString() })]);
      return rows.length === 1;
    },
    files: {
      async put(id, buffer) { await ensureSchema(); await client.query('INSERT INTO als.files (id, content) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content', [id, buffer]); },
      async get(id) { await ensureSchema(); const { rows } = await client.query('SELECT content FROM als.files WHERE id = $1', [id]); if (!rows[0]) return null; const c = rows[0].content; return Buffer.isBuffer(c) ? c : Buffer.from(c); },
      async remove(id) { await ensureSchema(); await client.query('DELETE FROM als.files WHERE id = $1', [id]); },
    },
  };
}

/** Build a pg Pool from the environment (Supabase via the Vercel integration sets POSTGRES_URL). */
export async function poolFromEnv(env = process.env) {
  const raw = env.POSTGRES_URL || env.DATABASE_URL || env.SUPABASE_DB_URL;
  if (!raw) return null;
  const { default: pg } = await import('pg');
  // Supabase presents a certificate from its own authority. Encrypt the
  // connection but do not try to verify that chain (Supabase's documented setup
  // for node-postgres); strip sslmode so the URL does not override this.
  const url = new URL(raw);
  url.searchParams.delete('sslmode');
  url.searchParams.delete('supa');
  url.searchParams.delete('workaround');
  const pool = new pg.Pool({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, max: 3, idleTimeoutMillis: 10_000 });
  try { const { attachDatabasePool } = await import('@vercel/functions'); attachDatabasePool(pool); } catch { /* not on Vercel */ }
  return pool;
}
