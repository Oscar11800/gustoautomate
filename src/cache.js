import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '..', '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'rows.json');

let _cache = null;

export function loadCache(reset = false) {
  if (reset) { _cache = {}; return _cache; }
  if (_cache) return _cache;
  try {
    _cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  } catch {
    _cache = {};
  }
  return _cache;
}

export function saveCache() {
  if (!_cache) return;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(_cache, null, 2));
}

function profileKey() {
  return process.argv.includes('--sheet-b') ? 'b' : 'a';
}

export function getCachedRow(row) {
  const cache = loadCache();
  return cache[profileKey()]?.[row] ?? null;
}

export function setCachedRow(row, data) {
  const cache = loadCache();
  const pk = profileKey();
  if (!cache[pk]) cache[pk] = {};
  cache[pk][row] = { ...cache[pk][row], ...data };
  saveCache();
}
