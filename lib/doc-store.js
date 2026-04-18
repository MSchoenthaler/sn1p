import fs from "fs/promises";
import fssync from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.join(__dirname, "..");
export const STORAGE_DIR = path.join(ROOT_DIR, "_storage");
export const PUBLIC_DIR = path.join(ROOT_DIR, "public");
export const DOC_NAME_MAX_LEN = 64;

if (!fssync.existsSync(STORAGE_DIR)) {
  fssync.mkdirSync(STORAGE_DIR, { recursive: true });
}

export function canonicalDocName(name) {
  const value = (name || "")
    .toString()
    .trim()
    .toLowerCase();
  return /^[a-z0-9]+$/.test(value) && value.length <= DOC_NAME_MAX_LEN ? value : null;
}

export function sanitizeDocName(name) {
  return canonicalDocName(name);
}

export function docPath(name) {
  return path.join(STORAGE_DIR, `${name}.json`);
}

export async function loadDoc(name) {
  const p = docPath(name);
  try {
    const rawBuf = await fs.readFile(p);
    try {
      return JSON.parse(rawBuf.toString("utf8"));
    } catch {
      return { v: 0, unsupported: true };
    }
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

export async function writeDoc(name, doc) {
  const p = docPath(name);
  const tmp = `${p}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(doc), "utf8");
  await fs.rename(tmp, p);
}

export async function removeDoc(name) {
  try {
    await fs.unlink(docPath(name));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

const docQueues = new Map();

export function withDocLock(name, task) {
  const prev = docQueues.get(name) || Promise.resolve();
  const next = prev.catch(() => {}).then(task);
  docQueues.set(name, next);
  return next.finally(() => {
    if (docQueues.get(name) === next) {
      docQueues.delete(name);
    }
  });
}

function randomDocId(len = Number(process.env.DOC_ID_LEN) || 12) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export async function allocateDocId() {
  for (let i = 0; i < 8; i++) {
    const id = randomDocId();
    if (!fssync.existsSync(docPath(id))) return id;
  }
  return randomDocId(14);
}

export function nowIso() {
  return new Date().toISOString();
}
