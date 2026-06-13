import { readFile, writeFile, unlink, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_HISTORY_PATH = join(__dirname, '..', '.mapper-history.json');

export function getHistoryPath(customPath) {
  return customPath || DEFAULT_HISTORY_PATH;
}

async function readRawHistory(customPath) {
  const path = getHistoryPath(customPath);
  try {
    await access(path);
  } catch {
    return {};
  }
  const content = await readFile(path, 'utf-8');
  const obj = JSON.parse(content || '{}');
  return obj.namespaces || {};
}

async function writeRawHistory(namespaces, customPath) {
  const path = getHistoryPath(customPath);
  const obj = {
    updatedAt: new Date().toISOString(),
    namespaces,
  };
  await writeFile(path, JSON.stringify(obj, null, 2), 'utf-8');
  return path;
}

function mapFromObj(obj) {
  const map = new Map();
  for (const [source, target] of Object.entries(obj || {})) {
    map.set(source, target);
  }
  return map;
}

function objFromMap(map) {
  return Object.fromEntries(map.entries());
}

export async function loadHistory(customPath, namespace) {
  const namespaces = await readRawHistory(customPath);
  return mapFromObj(namespaces[namespace]);
}

export async function saveHistory(historyMap, customPath, namespace) {
  const namespaces = await readRawHistory(customPath);
  namespaces[namespace] = objFromMap(historyMap);
  const path = await writeRawHistory(namespaces, customPath);
  return { path, namespace, count: historyMap.size };
}

export async function recordMappings(mappings, customPath, namespace) {
  const history = await loadHistory(customPath, namespace);
  let updated = 0;
  for (const m of mappings) {
    if (m.source && m.target && m.method !== 'none' && m.confidence > 0) {
      history.set(m.source, m.target);
      updated++;
    }
  }
  if (updated > 0) {
    await saveHistory(history, customPath, namespace);
  }
  return { updated, total: history.size, namespace };
}

export async function clearHistory(customPath, namespace) {
  if (namespace) {
    const namespaces = await readRawHistory(customPath);
    if (!namespaces[namespace]) {
      const path = getHistoryPath(customPath);
      return { cleared: false, path, reason: 'namespace_not_exists', namespace };
    }
    delete namespaces[namespace];
    const path = await writeRawHistory(namespaces, customPath);
    return { cleared: true, path, namespace };
  }

  const path = getHistoryPath(customPath);
  try {
    await unlink(path);
    return { cleared: true, path, namespace: null };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { cleared: false, path, reason: 'not_exists', namespace: null };
    }
    throw err;
  }
}

export async function listNamespaces(customPath) {
  const namespaces = await readRawHistory(customPath);
  const result = [];
  for (const [ns, mappings] of Object.entries(namespaces)) {
    result.push({ namespace: ns, count: Object.keys(mappings).length });
  }
  return result;
}

export function resolveFromHistory(candidates, target, historyMap) {
  if (!candidates || candidates.length === 0 || !historyMap || historyMap.size === 0) {
    return null;
  }
  for (const source of candidates) {
    const mappedTarget = historyMap.get(source);
    if (mappedTarget === target) {
      return source;
    }
  }
  return null;
}
