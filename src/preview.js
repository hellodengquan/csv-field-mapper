import chalk from 'chalk';
import Table from 'cli-table3';

export function previewMappings(mappings, sampleData = []) {
  const table = new Table({
    head: [
      chalk.cyan('源字段'),
      chalk.cyan('目标字段'),
      chalk.cyan('匹配方式'),
      chalk.cyan('置信度'),
      chalk.cyan('状态'),
    ],
    colWidths: [22, 22, 12, 10, 14],
    wordWrap: true,
  });

  for (const m of mappings) {
    const methodLabel = {
      exact: chalk.green('精确'),
      normalized: chalk.cyan('规整'),
      fuzzy: chalk.yellow('模糊'),
      manual: chalk.blue('手动'),
      history: chalk.magenta('记忆'),
      none: chalk.red('未匹配'),
    }[m.method] || m.method;

    const statusLabel = m.source
      ? chalk.green('✓')
      : chalk.red('✗ 缺失');

    const confidenceLabel = m.confidence > 0
      ? `${(m.confidence * 100).toFixed(0)}%`
      : '-';

    let sourceDisplay = m.source || chalk.gray('(无)');
    if (m.candidates && m.candidates.length > 0 && m.method === 'normalized') {
      sourceDisplay += ` ${chalk.magenta(' [多候选]')}`;
    }

    table.push([
      sourceDisplay,
      m.target,
      methodLabel,
      confidenceLabel,
      statusLabel,
    ]);
  }

  console.log('\n' + chalk.bold('📋 字段映射预览：'));
  console.log(table.toString());

  const ambiguousMappings = mappings.filter(m => m.candidates && m.candidates.length > 1 && m.method === 'normalized');
  if (ambiguousMappings.length > 0) {
    console.log('\n' + chalk.bold.magenta('⚠️  存在歧义的映射（多个源字段规整后相同）：'));
    for (const m of ambiguousMappings) {
      console.log(chalk.magenta(`  目标字段 "${m.target}" 候选源字段：`));
      for (const candidate of m.candidates) {
        const marker = candidate === m.source ? chalk.green('  → ') : '    ';
        console.log(chalk.magenta(`${marker}"${candidate}"${candidate === m.source ? ' (当前选中)' : ''}`));
      }
    }
    console.log(chalk.gray('  使用 --mapping 参数可手动指定正确映射'));
  }

  const unmappedWithCandidates = mappings.filter(m => !m.source && m.candidates && m.candidates.length > 0);
  if (unmappedWithCandidates.length > 0) {
    console.log('\n' + chalk.bold.gray('💡 未匹配字段的候选建议：'));
    for (const m of unmappedWithCandidates) {
      console.log(chalk.gray(`  目标字段 "${m.target}" 候选：${m.candidates.join(', ')}`));
    }
  }

  if (sampleData.length > 0) {
    previewSampleData(mappings, sampleData);
  }
}

function previewSampleData(mappings, sampleData) {
  const mapped = mappings.filter(m => m.source && m.method !== 'none');
  if (mapped.length === 0) return;

  const headRow = [chalk.cyan('行号'), ...mapped.map(m => chalk.cyan(m.target))];
  const colWidths = [6, ...mapped.map(() => 18)];

  const sampleTable = new Table({ head: headRow, colWidths, wordWrap: true });

  sampleData.slice(0, 5).forEach((row, idx) => {
    const values = mapped.map(m => {
      const val = row[m.source] ?? '';
      return val.length > 30 ? val.slice(0, 27) + '...' : val;
    });
    sampleTable.push([idx + 1, ...values]);
  });

  console.log('\n' + chalk.bold('📊 数据预览（前5行）：'));
  console.log(sampleTable.toString());
}
