#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { readCsvHeaders, readCsvRecords, readCsvSample } from './csv-reader.js';
import { autoMatch, applyManualMappings } from './mapper.js';
import { previewMappings } from './preview.js';
import { detectConflicts, reportConflicts } from './conflict.js';
import { exportMappingResult, exportTransformedData } from './exporter.js';
import { readFile } from 'fs/promises';
import { loadHistory, recordMappings, clearHistory, listNamespaces } from './history.js';

const program = new Command();

program
  .name('csv-mapper')
  .description('CSV 字段映射工具 - 支持匹配预览、冲突提示和 JSON 结果导出')
  .version('1.0.0');

program
  .command('map')
  .description('映射源 CSV 字段到目标字段')
  .requiredOption('-s, --source <path>', '源 CSV 文件路径')
  .requiredOption('-n, --template-name <name>', 'BI 模板名称（用于历史记忆分桶）')
  .option('-t, --target <fields>', '目标字段列表（逗号分隔）')
  .option('-T, --target-csv <path>', '目标 CSV 模板文件（取其表头作为目标字段）')
  .option('-m, --mapping <path>', '手动映射 JSON 文件路径')
  .option('-o, --output <path>', '导出映射结果到 JSON 文件')
  .option('-d, --data-output <path>', '导出转换后的数据到 JSON 文件')
  .option('--threshold <number>', '模糊匹配阈值 (0-1)', parseFloat, 0.6)
  .option('--no-preview', '跳过预览直接导出')
  .option('--no-history', '不使用历史记忆，也不记录')
  .option('--no-save-history', '使用历史记忆但不保存本次结果')
  .option('--history-path <path>', '自定义历史记录文件路径')
  .action(async (opts) => {
    try {
      if (!opts.target && !opts.targetCsv) {
        console.error(chalk.red('错误: 必须指定 --target 或 --target-csv'));
        process.exit(1);
      }

      const ns = opts.templateName;

      console.log(chalk.bold('\n🔍 CSV 字段映射工具\n'));
      console.log(chalk.gray(`模板: ${ns}`));

      const sourceFields = await readCsvHeaders(opts.source);
      console.log(chalk.gray(`源文件: ${opts.source}`));
      console.log(chalk.gray(`源字段 (${sourceFields.length}): ${sourceFields.join(', ')}`));

      let targetFields;
      if (opts.targetCsv) {
        targetFields = await readCsvHeaders(opts.targetCsv);
        console.log(chalk.gray(`目标模板: ${opts.targetCsv}`));
      } else {
        targetFields = opts.target.split(',').map(f => f.trim()).filter(Boolean);
      }
      console.log(chalk.gray(`目标字段 (${targetFields.length}): ${targetFields.join(', ')}\n`));

      const historyMap = opts.noHistory ? new Map() : await loadHistory(opts.historyPath, ns);
      if (!opts.noHistory && historyMap.size > 0) {
        console.log(chalk.magenta(`💾 已加载历史记忆 [${ns}]: ${historyMap.size} 条记录`));
      }

      const matchResult = autoMatch(sourceFields, targetFields, { threshold: opts.threshold, historyMap });
      let mappings = matchResult.mappings;
      const matchConflicts = matchResult.conflicts;

      if (matchResult.resolvedByHistory && matchResult.resolvedByHistory.length > 0) {
        console.log(chalk.magenta(`✨ 历史记忆自动解析 ${matchResult.resolvedByHistory.length} 个歧义映射`));
      }

      if (opts.mapping) {
        const manualContent = await readFile(opts.mapping, 'utf-8');
        const manualMap = JSON.parse(manualContent);
        console.log(chalk.blue(`已加载手动映射: ${opts.mapping}`));
        mappings = applyManualMappings(mappings, manualMap);
      }

      const conflicts = detectConflicts(mappings, sourceFields, matchConflicts);

      if (opts.preview !== false) {
        const sampleData = await readCsvSample(opts.source, 5);
        previewMappings(mappings, sampleData);
      }

      const summary = reportConflicts(conflicts);

      if (summary.hasBlockingIssues && !opts.dataOutput) {
        console.log(chalk.yellow('\n⚠ 存在冲突错误，建议先解决冲突再导出数据。'));
      }

      if (opts.output || !opts.dataOutput) {
        await exportMappingResult(mappings, conflicts, {
          outputPath: opts.output,
          sourceFile: opts.source,
          targetFields,
        });
      }

      if (opts.dataOutput) {
        const records = await readCsvRecords(opts.source);
        await exportTransformedData(records, mappings, opts.dataOutput);
      }

      if (!opts.noHistory && !opts.noSaveHistory) {
        const recordResult = await recordMappings(mappings, opts.historyPath, ns);
        if (recordResult.updated > 0) {
          console.log(chalk.magenta(`\n💾 已记录 ${recordResult.updated} 条映射到历史记忆 [${ns}] (共 ${recordResult.total} 条)`));
        }
      }
    } catch (err) {
      console.error(chalk.red(`\n❌ 错误: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('inspect')
  .description('查看 CSV 文件的字段信息和样本数据')
  .requiredOption('-f, --file <path>', 'CSV 文件路径')
  .option('-n, --lines <number>', '显示的样本行数', parseInt, 5)
  .action(async (opts) => {
    try {
      const headers = await readCsvHeaders(opts.file);
      const sample = await readCsvSample(opts.file, opts.lines);
      const records = await readCsvRecords(opts.file);

      console.log(chalk.bold(`\n📁 文件: ${opts.file}`));
      console.log(chalk.cyan(`字段数量: ${headers.length}`));
      console.log(chalk.cyan(`记录总数: ${records.length}`));
      console.log(chalk.cyan(`字段列表: ${headers.join(', ')}\n`));

      if (sample.length > 0) {
        const Table = (await import('cli-table3')).default;
        const table = new Table({
          head: [chalk.cyan('#'), ...headers.map(h => chalk.cyan(h))],
          wordWrap: true,
        });
        sample.forEach((row, idx) => {
          table.push([idx + 1, ...headers.map(h => {
            const val = row[h] ?? '';
            return val.length > 40 ? val.slice(0, 37) + '...' : val;
          })]);
        });
        console.log(chalk.bold('样本数据：'));
        console.log(table.toString());
      }
    } catch (err) {
      console.error(chalk.red(`\n❌ 错误: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('init-mapping')
  .description('生成手动映射模板 JSON 文件')
  .requiredOption('-s, --source <path>', '源 CSV 文件路径')
  .option('-t, --target <fields>', '目标字段列表（逗号分隔）')
  .option('-T, --target-csv <path>', '目标 CSV 模板文件')
  .option('-o, --output <path>', '输出文件路径', 'mapping-template.json')
  .action(async (opts) => {
    try {
      if (!opts.target && !opts.targetCsv) {
        console.error(chalk.red('错误: 必须指定 --target 或 --target-csv'));
        process.exit(1);
      }

      const sourceFields = await readCsvHeaders(opts.source);
      let targetFields;
      if (opts.targetCsv) {
        targetFields = await readCsvHeaders(opts.targetCsv);
      } else {
        targetFields = opts.target.split(',').map(f => f.trim()).filter(Boolean);
      }

      const matchResult = autoMatch(sourceFields, targetFields);
      const mappings = matchResult.mappings;
      const template = {};
      for (const m of mappings) {
        if (m.source) {
          template[m.source] = m.target;
        }
      }

      const { writeFile } = await import('fs/promises');
      await writeFile(opts.output, JSON.stringify(template, null, 2), 'utf-8');
      console.log(chalk.green(`✅ 映射模板已生成: ${opts.output}`));
      console.log(chalk.gray('编辑此文件后，使用 --mapping 参数指定即可覆盖自动匹配结果'));
    } catch (err) {
      console.error(chalk.red(`\n❌ 错误: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('reset-history')
  .description('清空历史映射记忆（指定模板清单一，不指定清全部）')
  .option('-n, --template-name <name>', '清空指定模板的历史记录（不指定则清空全部）')
  .option('--history-path <path>', '自定义历史记录文件路径')
  .action(async (opts) => {
    try {
      const ns = opts.templateName || null;
      const result = await clearHistory(opts.historyPath, ns);

      if (ns) {
        if (result.cleared) {
          console.log(chalk.green(`✅ 模板 "${ns}" 的历史记忆已清空: ${result.path}`));
        } else {
          console.log(chalk.yellow(`ℹ️  模板 "${ns}" 的历史记录不存在: ${result.path}`));
        }
      } else {
        if (result.cleared) {
          console.log(chalk.green(`✅ 全部历史记忆已清空: ${result.path}`));
        } else {
          console.log(chalk.yellow(`ℹ️  历史记忆文件不存在，无需清空: ${result.path}`));
        }
      }
    } catch (err) {
      console.error(chalk.red(`\n❌ 错误: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('list-history')
  .description('查看历史记忆中的模板列表')
  .option('--history-path <path>', '自定义历史记录文件路径')
  .action(async (opts) => {
    try {
      const namespaces = await listNamespaces(opts.historyPath);
      if (namespaces.length === 0) {
        console.log(chalk.yellow('ℹ️  暂无历史记忆记录'));
        return;
      }
      console.log(chalk.bold('\n📋 历史记忆模板列表：'));
      for (const { namespace, count } of namespaces) {
        console.log(chalk.cyan(`  ${namespace}: ${count} 条映射记录`));
      }
    } catch (err) {
      console.error(chalk.red(`\n❌ 错误: ${err.message}`));
      process.exit(1);
    }
  });

program.parse();
