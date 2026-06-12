import { writeFile } from 'fs/promises';
import chalk from 'chalk';

export async function exportMappingResult(mappings, conflicts, options = {}) {
  const result = {
    metadata: {
      exportTime: new Date().toISOString(),
      sourceFile: options.sourceFile || '',
      targetFields: options.targetFields || [],
      totalMappings: mappings.length,
      matchedCount: mappings.filter(m => m.source).length,
      unmappedCount: mappings.filter(m => !m.source).length,
    },
    mappings: mappings.map(m => ({
      source: m.source || null,
      target: m.target,
      method: m.method,
      confidence: m.confidence,
    })),
    conflicts: {
      errors: conflicts.errors,
      warnings: conflicts.warnings,
    },
  };

  const json = JSON.stringify(result, null, 2);

  if (options.outputPath) {
    await writeFile(options.outputPath, json, 'utf-8');
    console.log(chalk.green(`\n💾 映射结果已导出: ${options.outputPath}`));
  } else {
    console.log('\n' + chalk.bold('📄 JSON 映射结果：'));
    console.log(json);
  }

  return result;
}

export async function exportTransformedData(records, mappings, outputPath) {
  const mapped = mappings.filter(m => m.source);
  const transformed = records.map(row => {
    const newRow = {};
    for (const m of mapped) {
      newRow[m.target] = row[m.source] ?? '';
    }
    return newRow;
  });

  const json = JSON.stringify(transformed, null, 2);
  await writeFile(outputPath, json, 'utf-8');
  console.log(chalk.green(`\n💾 转换数据已导出: ${outputPath} (${transformed.length} 条记录)`));

  return transformed;
}
