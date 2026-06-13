import { readFile, writeFile, unlink, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_HISTORY_PATH = join(__dirname, '..', '.mapper-history.json');

export function getHistoryPath(customPath) {
  return customPath || DEFAULT_HISTORY_PATH;
}

export async function loadHistory(customPath) {
  const path = getHistoryPath(customPath);
  try {
    await access(path);
  } catch {
    return new Map();
  }
  const content = await readFile(path, 'utf-8');
  const obj = JSON.parse(content || '{}');
  const map = new Map();
  for (const [source, target] of Object.entries(obj.mappings || {})) {
    map.set(source, target);
  }
  return map;
}

export async function saveHistory(historyMap, customPath) {
  const path = getHistoryPath(customPath);
  const obj = {
    updatedAt: new Date().toISOString(),
    mappings: Object.fromEntries(historyMap.entries()),
  };
  await writeFile(path, JSON.stringify(obj, null, 2), 'utf-8');
  return path;
}

export async function recordMappings(mappings, customPath) {
  const history = await loadHistory(customPath);
  let updated = 0;
  for (const m of mappings) {
    if (m.source && m.target && m.method !== 'none' && m.confidence > 0) {
      history.set(m.source, m.target);
      updated++;
    }
  }
  if (updated > 0) {
    await saveHistory(history, customPath);
  }
  return { updated, total: history.size };
}

export async function clearHistory(customPath) {
  const path = getHistoryPath(customPath);
  try {
    await unlink(path);
    return { cleared: true, path };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { cleared: false, path, reason: 'not_exists' };
    }
    throw err;
  }
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
