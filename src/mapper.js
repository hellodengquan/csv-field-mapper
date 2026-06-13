import { compareTwoStrings } from 'string-similarity';
import { resolveFromHistory } from './history.js';

export function normalizeFieldName(name) {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function buildNormalizedIndex(fields) {
  const index = new Map();
  for (const field of fields) {
    const norm = normalizeFieldName(field);
    if (!index.has(norm)) {
      index.set(norm, []);
    }
    index.get(norm).push(field);
  }
  return index;
}

export function autoMatch(sourceFields, targetFields, options = {}) {
  const { threshold = 0.6, historyMap = null } = options;
  const mappings = [];
  const usedSource = new Set();
  const candidateConflicts = [];
  const resolvedByHistory = [];

  const sourceNormIndex = buildNormalizedIndex(sourceFields);
  const targetNormIndex = buildNormalizedIndex(targetFields);

  for (const target of targetFields) {
    const normTarget = normalizeFieldName(target);

    let bestSource = null;
    let bestScore = 0;
    let bestMethod = 'none';
    let candidates = [];
    let historyResolved = false;

    const exactMatch = sourceFields.find(s => s === target && !usedSource.has(s));
    if (exactMatch) {
      bestSource = exactMatch;
      bestScore = 1.0;
      bestMethod = 'exact';
    }

    if (!bestSource) {
      const matchedSources = sourceNormIndex.get(normTarget) || [];
      const availableMatches = matchedSources.filter(s => !usedSource.has(s));

      if (availableMatches.length === 1) {
        bestSource = availableMatches[0];
        bestScore = 1.0;
        bestMethod = 'normalized';
      } else if (availableMatches.length > 1) {
        candidates = availableMatches;
        const historyPick = resolveFromHistory(availableMatches, target, historyMap);
        if (historyPick) {
          bestSource = historyPick;
          historyResolved = true;
          resolvedByHistory.push({ target, source: historyPick, candidates: availableMatches });
        } else {
          bestSource = availableMatches[0];
          candidateConflicts.push({
            type: 'normalized_ambiguous',
            target,
            normalizedName: normTarget,
            candidates: availableMatches,
            selected: bestSource,
          });
        }
        bestScore = 1.0;
        bestMethod = historyResolved ? 'history' : 'normalized';
      }
    }

    if (!bestSource && historyMap && historyMap.size > 0) {
      for (const [histSource, histTarget] of historyMap) {
        if (histTarget === target && !usedSource.has(histSource) && sourceFields.includes(histSource)) {
          bestSource = histSource;
          bestScore = 1.0;
          bestMethod = 'history';
          historyResolved = true;
          resolvedByHistory.push({ target, source: histSource, candidates: [] });
          break;
        }
      }
    }

    if (!bestSource) {
      for (const source of sourceFields) {
        if (usedSource.has(source)) continue;
        const normSource = normalizeFieldName(source);
        const score = compareTwoStrings(normSource, normTarget);
        if (score > bestScore && score >= threshold) {
          bestScore = score;
          bestSource = source;
          bestMethod = 'fuzzy';
        }
      }
    }

    if (bestSource) {
      const mapping = {
        source: bestSource,
        target,
        confidence: Math.round(bestScore * 100) / 100,
        method: bestMethod,
      };
      if (candidates.length > 0) {
        mapping.candidates = candidates;
      }
      if (historyResolved) {
        mapping.resolvedByHistory = true;
      }
      mappings.push(mapping);
      usedSource.add(bestSource);
    } else {
      const possibleCandidates = [];
      for (const source of sourceFields) {
        if (usedSource.has(source)) continue;
        const normSource = normalizeFieldName(source);
        const score = compareTwoStrings(normSource, normTarget);
        if (score >= 0.4) {
          possibleCandidates.push({ source, score: Math.round(score * 100) / 100 });
        }
      }
      possibleCandidates.sort((a, b) => b.score - a.score);
      const mapping = {
        source: null,
        target,
        confidence: 0,
        method: 'none',
      };
      if (possibleCandidates.length > 0) {
        mapping.candidates = possibleCandidates.map(c => c.source);
      }
      mappings.push(mapping);
    }
  }

  const normalizedTargetConflicts = [];
  for (const [normName, targets] of targetNormIndex) {
    if (targets.length > 1) {
      const matchingSources = sourceNormIndex.get(normName) || [];
      if (matchingSources.length > 0) {
        normalizedTargetConflicts.push({
          type: 'normalized_target_duplicate',
          normalizedName: normName,
          targets,
          sourceCandidates: matchingSources,
        });
      }
    }
  }

  return {
    mappings,
    conflicts: {
      ambiguousMatches: candidateConflicts,
      duplicateTargets: normalizedTargetConflicts,
    },
    resolvedByHistory,
  };
}

export function applyManualMappings(mappings, manualMap) {
  const result = mappings.map(m => ({ ...m }));

  for (const [source, target] of Object.entries(manualMap)) {
    const existing = result.find(m => m.target === target);
    if (existing) {
      existing.source = source;
      existing.method = 'manual';
      existing.confidence = 1.0;
      delete existing.candidates;
      delete existing.resolvedByHistory;
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
