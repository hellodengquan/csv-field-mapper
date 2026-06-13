import chalk from 'chalk';

export function detectConflicts(mappings, sourceFields, matchConflicts = {}) {
  const warnings = [];
  const errors = [];

  const targetToSources = new Map();
  for (const m of mappings) {
    if (!m.source) continue;
    if (!targetToSources.has(m.target)) {
      targetToSources.set(m.target, []);
    }
    targetToSources.get(m.target).push(m.source);
  }

  for (const [target, sources] of targetToSources) {
    if (sources.length > 1) {
      errors.push({
        type: 'duplicate_target',
        message: `目标字段 "${target}" 被多个源字段映射: ${sources.map(s => `"${s}"`).join(', ')}`,
        target,
        sources,
      });
    }
  }

  const mappedSources = new Set(mappings.filter(m => m.source).map(m => m.source));
  const unmappedSources = sourceFields.filter(f => !mappedSources.has(f));
  for (const field of unmappedSources) {
    warnings.push({
      type: 'unmapped_source',
      message: `源字段 "${field}" 未被映射到任何目标字段`,
      source: field,
    });
  }

  const unmappedTargets = mappings.filter(m => !m.source);
  for (const m of unmappedTargets) {
    const msgSuffix = m.candidates && m.candidates.length > 0
      ? ` (候选: ${m.candidates.join(', ')})`
      : '';
    warnings.push({
      type: 'missing_mapping',
      message: `目标字段 "${m.target}" 没有匹配的源字段${msgSuffix}`,
      target: m.target,
      candidates: m.candidates || [],
    });
  }

  const lowConfidence = mappings.filter(m => m.source && m.method === 'fuzzy' && m.confidence < 0.8);
  for (const m of lowConfidence) {
    warnings.push({
      type: 'low_confidence',
      message: `源字段 "${m.source}" → 目标字段 "${m.target}" 置信度较低 (${(m.confidence * 100).toFixed(0)}%)`,
      source: m.source,
      target: m.target,
      confidence: m.confidence,
    });
  }

  const ambiguousMatches = matchConflicts.ambiguousMatches || [];
  for (const conflict of ambiguousMatches) {
    warnings.push({
      type: 'normalized_ambiguous',
      message: `目标字段 "${conflict.target}" 存在多个规范化匹配的源字段: ${conflict.candidates.map(s => `"${s}"`).join(', ')} (当前选中: "${conflict.selected}")`,
      target: conflict.target,
      normalizedName: conflict.normalizedName,
      candidates: conflict.candidates,
      selected: conflict.selected,
    });
  }

  const duplicateTargets = matchConflicts.duplicateTargets || [];
  for (const conflict of duplicateTargets) {
    warnings.push({
      type: 'normalized_target_duplicate',
      message: `多个目标字段规范化后相同 (${conflict.normalizedName}): ${conflict.targets.map(t => `"${t}"`).join(', ')}, 可能造成映射歧义`,
      normalizedName: conflict.normalizedName,
      targets: conflict.targets,
      sourceCandidates: conflict.sourceCandidates,
    });
  }

  return { warnings, errors };
}

export function reportConflicts({ warnings, errors }) {
  if (errors.length > 0) {
    console.log('\n' + chalk.bold.red('❌ 冲突错误：'));
    for (const e of errors) {
      console.log(chalk.red(`  ✗ ${e.message}`));
    }
  }

  if (warnings.length > 0) {
    console.log('\n' + chalk.bold.yellow('⚠️  警告：'));
    for (const w of warnings) {
      console.log(chalk.yellow(`  ! ${w.message}`));
    }
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log('\n' + chalk.bold.green('✅ 无冲突，所有字段映射正常'));
  }

  const summary = {
    totalErrors: errors.length,
    totalWarnings: warnings.length,
    hasBlockingIssues: errors.length > 0,
  };

  console.log(chalk.gray(`\n  汇总: ${errors.length} 错误, ${warnings.length} 警告`));

  return summary;
}
