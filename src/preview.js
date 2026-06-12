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
    colWidths: [20, 20, 12, 10, 14],
    wordWrap: true,
  });

  for (const m of mappings) {
    const methodLabel = {
      exact: chalk.green('精确'),
      fuzzy: chalk.yellow('模糊'),
      manual: chalk.blue('手动'),
      none: chalk.red('未匹配'),
    }[m.method] || m.method;

    const statusLabel = m.source
      ? chalk.green('✓')
      : chalk.red('✗ 缺失');

    const confidenceLabel = m.confidence > 0
      ? `${(m.confidence * 100).toFixed(0)}%`
      : '-';

    table.push([
      m.source || chalk.gray('(无)'),
      m.target,
      methodLabel,
      confidenceLabel,
      statusLabel,
    ]);
  }

  console.log('\n' + chalk.bold('📋 字段映射预览：'));
  console.log(table.toString());

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
