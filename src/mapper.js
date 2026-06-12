import { compareTwoStrings } from 'string-similarity';

function normalize(name) {
  return name
    .toLowerCase()
    .replace(/[_\-\s]+/g, '')
    .replace(/(id|Id|ID)$/, '')
    .trim();
}

export function autoMatch(sourceFields, targetFields, threshold = 0.6) {
  const mappings = [];
  const usedSource = new Set();

  for (const target of targetFields) {
    const normTarget = normalize(target);
    let bestSource = null;
    let bestScore = 0;

    for (const source of sourceFields) {
      if (usedSource.has(source)) continue;
      const normSource = normalize(source);

      if (normSource === normTarget) {
        bestSource = source;
        bestScore = 1.0;
        break;
      }

      const score = compareTwoStrings(normSource, normTarget);
      if (score > bestScore && score >= threshold) {
        bestScore = score;
        bestSource = source;
      }
    }

    if (bestSource) {
      mappings.push({
        source: bestSource,
        target,
        confidence: Math.round(bestScore * 100) / 100,
        method: bestScore === 1.0 ? 'exact' : 'fuzzy',
      });
      usedSource.add(bestSource);
    } else {
      mappings.push({
        source: null,
        target,
        confidence: 0,
        method: 'none',
      });
    }
  }

  return mappings;
}

export function applyManualMappings(mappings, manualMap) {
  const result = mappings.map(m => ({ ...m }));

  for (const [source, target] of Object.entries(manualMap)) {
    const existing = result.find(m => m.target === target);
    if (existing) {
      existing.source = source;
      existing.method = 'manual';
      existing.confidence = 1.0;
    } else {
      result.push({
        source,
        target,
        confidence: 1.0,
        method: 'manual',
      });
    }
  }

  return result;
}
