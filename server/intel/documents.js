// Company document library: encrypted at rest, text extraction for review,
// expiration tracking, outreach approval and role-based access.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DOCUMENT_TYPES = [
  { id: 'contractor_license', label: 'Contractor license', expires: true, sensitive: false, minRole: 'staff' },
  { id: 'insurance_certificate', label: 'Insurance certificate (COI)', expires: true, sensitive: false, minRole: 'staff' },
  { id: 'w9', label: 'W-9 form', expires: false, sensitive: true, minRole: 'owner' },
  { id: 'business_registration', label: 'Business registration', expires: true, sensitive: true, minRole: 'owner' },
  { id: 'capability_statement', label: 'Capability statement', expires: false, sensitive: false, minRole: 'viewer' },
  { id: 'project_portfolio', label: 'Project portfolio', expires: false, sensitive: false, minRole: 'viewer' },
  { id: 'safety_documentation', label: 'Safety documentation', expires: true, sensitive: false, minRole: 'staff' },
  { id: 'certification', label: 'Certification', expires: true, sensitive: false, minRole: 'staff' },
  { id: 'vendor_qualification', label: 'Vendor qualification package', expires: false, sensitive: true, minRole: 'owner' },
  { id: 'company_presentation', label: 'Company presentation', expires: false, sensitive: false, minRole: 'viewer' },
  { id: 'other', label: 'Other', expires: false, sensitive: true, minRole: 'owner' },
];

export const ROLES = ['viewer', 'staff', 'owner'];
export const roleRank = (r) => Math.max(0, ROLES.indexOf(r || 'viewer'));
export const canAccess = (role, doc) => roleRank(role) >= roleRank(doc.minRole);

// Vercel Functions accept request bodies up to 4.5 MB, so uploads are capped lower there.
export const MAX_UPLOAD_BYTES = process.env.VERCEL ? 4 * 1024 * 1024 : 25 * 1024 * 1024;

// Where encrypted files live: a folder on disk, or the Postgres `als.files` table.
let fileStore = null;
export function setFileStore(fs_) { fileStore = fs_; }

function dataDir() { return path.resolve(process.env.DATA_DIR || 'data'); }

/** 32-byte key from DOCUMENT_ENCRYPTION_KEY, or one generated once and kept next to the data. */
export function encryptionKey() {
  const env = process.env.DOCUMENT_ENCRYPTION_KEY;
  if (env) return crypto.createHash('sha256').update(env).digest();
  if (process.env.VERCEL || fileStore) throw Object.assign(new Error('DOCUMENT_ENCRYPTION_KEY is not set. Add it in Vercel → Project → Settings → Environment Variables, then redeploy.'), { status: 500 });
  const keyFile = path.join(dataDir(), 'documents', '.key');
  if (fs.existsSync(keyFile)) return Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex');
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, key.toString('hex'), { mode: 0o600 });
  return key;
}

export function encrypt(buffer) {
  const key = encryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]);
}

export function encryptToFile(buffer, filePath) {
  const blob = encrypt(buffer);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, blob, { mode: 0o600 });
}

async function storeEncrypted(id, buffer) {
  if (fileStore) { await fileStore.put(id, encrypt(buffer)); return `db:als.files/${id}`; }
  const storagePath = path.join(dataDir(), 'documents', `${id}.enc`);
  encryptToFile(buffer, storagePath);
  return storagePath;
}

export async function readDocumentBuffer(doc) {
  const blob = String(doc.storagePath).startsWith('db:') ? await fileStore.get(doc.id) : fs.readFileSync(doc.storagePath);
  if (!blob) throw Object.assign(new Error('Stored file not found'), { status: 404 });
  const key = encryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
  decipher.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
}

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec';
const DATE_PATTERNS = [
  /\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/g,
  new RegExp(`\\b(${MONTHS})[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'gi'),
  /\b(\d{4})-(\d{2})-(\d{2})\b/g,
];

function parseDates(text) {
  const out = [];
  for (const re of DATE_PATTERNS) {
    for (const m of text.matchAll(re)) {
      let d;
      if (re === DATE_PATTERNS[0]) d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
      else if (re === DATE_PATTERNS[2]) d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      else d = new Date(`${m[1]} ${m[2]} ${m[3]}`);
      if (!Number.isNaN(d.getTime())) out.push({ date: d.toISOString().slice(0, 10), context: text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 3).replace(/\s+/g, ' ') });
    }
  }
  return out;
}

/** Pull candidate facts from text. Everything is a suggestion until a person reviews it. */
export function extractFacts(text, typeId) {
  const t = text || '';
  const dates = parseDates(t);
  const expiryCandidates = dates.filter((d) => /expir|valid (until|through|thru)|exp\.?\s*date|renew|through/i.test(d.context));
  const effectiveCandidates = dates.filter((d) => /effective|issued|issue date|from/i.test(d.context));
  const facts = {
    expirationDate: expiryCandidates[0]?.date || null,
    expirationContext: expiryCandidates[0]?.context || null,
    effectiveDate: effectiveCandidates[0]?.date || null,
    licenseNumber: (t.match(/licen[sc]e\s*(?:no\.?|number|#)?\s*:?\s*([A-Z]?\d{5,8})/i) || [])[1] || null,
    classification: (t.match(/\b(C-?27|C27|A|B)\b(?=.{0,30}(landscap|general|class))/i) || [])[1] || null,
    policyNumber: (t.match(/policy\s*(?:no\.?|number|#)?\s*:?\s*([A-Z0-9-]{6,20})/i) || [])[1] || null,
    insurer: (t.match(/(?:insurer|carrier|underwriter|insurance company)\s*:?\s*([A-Z][A-Za-z&.,' ]{3,60})/i) || [])[1]?.trim() || null,
    generalAggregate: (t.match(/general aggregate\s*\$?\s*([\d,]{6,})/i) || [])[1] || null,
    eachOccurrence: (t.match(/each occurrence\s*\$?\s*([\d,]{6,})/i) || [])[1] || null,
    ein: /\b\d{2}-\d{7}\b/.test(t) ? 'present (not stored)' : null,
    dateCandidates: dates.slice(0, 12),
  };
  if (typeId === 'w9') { facts.expirationDate = null; }
  return facts;
}

async function extractText(buffer, mimetype, filename) {
  const lower = (filename || '').toLowerCase();
  if (mimetype === 'application/pdf' || lower.endsWith('.pdf')) {
    try {
      const mod = await import('pdf-parse');
      const pdf = mod.default || mod;
      const r = await pdf(buffer);
      return { text: r.text || '', pages: r.numpages || null, method: 'pdf-text' };
    } catch (err) {
      return { text: '', pages: null, method: 'pdf-failed', error: `Could not read PDF text (${err.message}). It may be a scanned image; enter the details by hand.` };
    }
  }
  if (/^text\//.test(mimetype || '') || /\.(txt|csv|md)$/.test(lower)) return { text: buffer.toString('utf8').slice(0, 200_000), pages: null, method: 'plain-text' };
  return { text: '', pages: null, method: 'none', error: 'Text extraction is only available for PDF and text files. Enter the details by hand.' };
}

export function documentStatus(doc, today = new Date()) {
  const type = DOCUMENT_TYPES.find((t) => t.id === doc.type) || DOCUMENT_TYPES.at(-1);
  if (!type.expires) return { status: doc.statusVerified ? 'current' : 'unverified', warning: null };
  const exp = doc.expirationDate;
  if (!exp) return { status: 'unverified', warning: 'No expiration date on record — status cannot be confirmed.' };
  const days = Math.floor((Date.parse(exp) - today.getTime()) / 86_400_000);
  if (days < 0) return { status: 'expired', warning: `Expired ${-days} day${days === -1 ? '' : 's'} ago (${exp}). Do not present this document as current.` };
  if (days <= 30) return { status: doc.statusVerified ? 'expiring' : 'unverified', warning: `Expires in ${days} day${days === 1 ? '' : 's'} (${exp}).` };
  return { status: doc.statusVerified ? 'current' : 'unverified', warning: doc.statusVerified ? null : 'Expiration date has not been confirmed by a person yet.' };
}

export function createDocumentService({ store, bus }) {
  const now = () => new Date().toISOString();

  function present(doc, role = 'owner') {
    const type = DOCUMENT_TYPES.find((t) => t.id === doc.type) || DOCUMENT_TYPES.at(-1);
    const st = documentStatus(doc);
    const { storagePath, extractedText, ...rest } = doc;
    return { ...rest, typeLabel: type.label, expires: type.expires, ...st, canAccess: canAccess(role, doc), hasText: Boolean(extractedText), textPreview: canAccess(role, doc) ? (extractedText || '').slice(0, 1200) : null };
  }

  function list(role) {
    return store.list('documents').filter((d) => canAccess(role, d)).map((d) => present(d, role));
  }

  async function upload({ buffer, filename, mimetype, type = 'other', title, uploadedBy = 'owner' }) {
    if (!buffer?.length) throw Object.assign(new Error('Empty upload'), { status: 400 });
    if (buffer.length > MAX_UPLOAD_BYTES) throw Object.assign(new Error(`File is larger than ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB`), { status: 413 });
    const typeDef = DOCUMENT_TYPES.find((t) => t.id === type) || DOCUMENT_TYPES.at(-1);
    const id = store.newId('doc');
    const safeName = path.basename(filename || 'upload').replace(/[^\w.\- ]+/g, '_');
    const storagePath = await storeEncrypted(id, buffer);
    const { text, pages, method, error } = await extractText(buffer, mimetype, safeName);
    const extracted = extractFacts(text, typeDef.id);
    const doc = store.insert('documents', {
      id, title: title || safeName, filename: safeName, mimetype: mimetype || 'application/octet-stream', size: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      type: typeDef.id, sensitive: typeDef.sensitive, minRole: typeDef.minRole, storagePath, encrypted: true, encryption: 'AES-256-GCM',
      extractedText: text, extraction: { method, pages, error: error || null, extractedAt: now() }, extracted,
      expirationDate: extracted.expirationDate, effectiveDate: extracted.effectiveDate,
      reviewStatus: 'pending_review', reviewedAt: null, reviewedBy: null, statusVerified: false,
      approvedForOutreach: false, outreachSummary: '', notes: '', uploadedBy, createdAt: now(), updatedAt: now(),
    });
    bus.publish('document.uploaded', { id, title: doc.title });
    return present(doc);
  }

  function review(id, patch, { by = 'owner' } = {}) {
    const doc = store.get('documents', id);
    if (!doc) throw Object.assign(new Error('Document not found'), { status: 404 });
    const next = { updatedAt: now() };
    for (const k of ['title', 'notes', 'outreachSummary']) if (typeof patch[k] === 'string') next[k] = patch[k];
    if (patch.type && DOCUMENT_TYPES.some((t) => t.id === patch.type)) { const t = DOCUMENT_TYPES.find((x) => x.id === patch.type); next.type = t.id; next.sensitive = t.sensitive; next.minRole = t.minRole; }
    if (patch.minRole && ROLES.includes(patch.minRole)) next.minRole = patch.minRole;
    if (patch.sensitive !== undefined) next.sensitive = Boolean(patch.sensitive);
    if (patch.expirationDate !== undefined) next.expirationDate = patch.expirationDate || null;
    if (patch.effectiveDate !== undefined) next.effectiveDate = patch.effectiveDate || null;
    if (patch.extracted && typeof patch.extracted === 'object') next.extracted = { ...doc.extracted, ...patch.extracted };
    if (patch.reviewStatus && ['pending_review', 'approved', 'rejected'].includes(patch.reviewStatus)) { next.reviewStatus = patch.reviewStatus; next.reviewedAt = now(); next.reviewedBy = by; }
    if (patch.statusVerified !== undefined) { next.statusVerified = Boolean(patch.statusVerified); next.statusVerifiedAt = next.statusVerified ? now() : null; next.statusVerifiedBy = next.statusVerified ? by : null; }
    if (patch.approvedForOutreach !== undefined) {
      const sensitive = next.sensitive ?? doc.sensitive;
      if (patch.approvedForOutreach && sensitive) throw Object.assign(new Error('Sensitive documents (W-9, registrations, qualification packages) cannot be approved for outreach.'), { status: 400 });
      next.approvedForOutreach = Boolean(patch.approvedForOutreach);
    }
    return present(store.update('documents', id, next));
  }

  function remove(id) {
    const doc = store.get('documents', id);
    if (!doc) throw Object.assign(new Error('Document not found'), { status: 404 });
    if (String(doc.storagePath).startsWith('db:')) fileStore?.remove(doc.id).catch(() => {});
    else { try { fs.unlinkSync(doc.storagePath); } catch { /* already gone */ } }
    store.remove('documents', id);
  }

  function warnings() {
    return store.list('documents').map((d) => ({ id: d.id, title: d.title, ...documentStatus(d) })).filter((d) => d.warning);
  }

  return { list, upload, review, remove, warnings, present, readBuffer: readDocumentBuffer };
}
