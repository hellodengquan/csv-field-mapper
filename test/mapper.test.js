import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { normalizeFieldName, autoMatch, applyManualMappings } from '../src/mapper.js';
import {
  loadHistory, saveHistory, recordMappings, clearHistory, resolveFromHistory, getHistoryPath, listNamespaces,
} from '../src/history.js';

const TMP_DIR = join(process.cwd(), '.test-tmp');

beforeEach(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
  await mkdir(TMP_DIR, { recursive: true });
});

describe('normalizeFieldName - 字段名规范化', () => {
  test('mixedCase 驼峰 → 空格小写', () => {
    assert.equal(normalizeFieldName('userName'), 'user name');
    assert.equal(normalizeFieldName('UserName'), 'user name');
    assert.equal(normalizeFieldName('getHTTPResponseCode'), 'get http response code');
  });

  test('snake_case → 空格小写', () => {
    assert.equal(normalizeFieldName('user_name'), 'user name');
    assert.equal(normalizeFieldName('user_email_address'), 'user email address');
  });

  test('kebab-case → 空格小写', () => {
    assert.equal(normalizeFieldName('user-name'), 'user name');
    assert.equal(normalizeFieldName('hire-date'), 'hire date');
  });

  test('混合风格统一', () => {
    assert.equal(normalizeFieldName('User_Name'), 'user name');
    assert.equal(normalizeFieldName('user__name'), 'user name');
    assert.equal(normalizeFieldName('user-Name'), 'user name');
    assert.equal(normalizeFieldName('userName_field-test'), 'user name field test');
  });

  test('大小写差异匹配为相同规范化值', () => {
    assert.equal(normalizeFieldName('NAME'), normalizeFieldName('name'));
    assert.equal(normalizeFieldName('UserEmail'), normalizeFieldName('user_email'));
    assert.equal(normalizeFieldName('HireDate'), normalizeFieldName('hire_date'));
  });
});

describe('autoMatch 规范化精确匹配', () => {
  test('mixedCase 源字段匹配 snake_case 目标字段 - method=normalized', () => {
    const source = ['userName', 'userEmail', 'hireDate'];
    const target = ['user_name', 'user_email', 'hire_date'];
    const { mappings } = autoMatch(source, target);

    assert.equal(mappings.length, 3);
    assert.equal(mappings.find(m => m.target === 'user_name').source, 'userName');
    assert.equal(mappings.find(m => m.target === 'user_name').method, 'normalized');
    assert.equal(mappings.find(m => m.target === 'user_email').source, 'userEmail');
    assert.equal(mappings.find(m => m.target === 'user_email').method, 'normalized');
    assert.equal(mappings.find(m => m.target === 'hire_date').source, 'hireDate');
    assert.equal(mappings.find(m => m.target === 'hire_date').method, 'normalized');
  });

  test('snake_case 源字段匹配 kebab-case 目标字段', () => {
    const source = ['user_name', 'salary_amount'];
    const target = ['user-name', 'salary-amount'];
    const { mappings } = autoMatch(source, target);

    assert.equal(mappings.find(m => m.target === 'user-name').source, 'user_name');
    assert.equal(mappings.find(m => m.target === 'salary-amount').source, 'salary_amount');
    assert.equal(mappings.find(m => m.target === 'user-name').method, 'normalized');
  });

  test('exact 相同优先于 normalized', () => {
    const source = ['user_name', 'userName'];
    const target = ['user_name'];
    const { mappings } = autoMatch(source, target);

    assert.equal(mappings[0].source, 'user_name');
    assert.equal(mappings[0].method, 'exact');
  });

  test('规范化 + 大小写差异匹配', () => {
    const source = ['UserName', 'EmailAddress'];
    const target = ['user_name', 'email_address'];
    const { mappings } = autoMatch(source, target);

    assert.equal(mappings.length, 2);
    for (const m of mappings) {
      assert.ok(m.source, `${m.target} 应有匹配`);
      assert.equal(m.method, 'normalized');
    }
  });
});

describe('autoMatch 冲突候选输出', () => {
  test('多源字段规范化相同 → 产生歧义 candidates 与 ambiguousMatches 警告', () => {
    const source = ['userName', 'user_name'];
    const target = ['user-name'];
    const result = autoMatch(source, target);

    assert.equal(result.mappings.length, 1);
    const mapping = result.mappings[0];
    assert.ok(mapping.source, '应默认选中第一个候选');
    assert.ok(Array.isArray(mapping.candidates) && mapping.candidates.length >= 2,
      'candidates 应包含多个源字段');
    assert.ok(mapping.candidates.includes('userName') && mapping.candidates.includes('user_name'),
      'candidates 应包含 userName 和 user_name');

    assert.ok(result.conflicts.ambiguousMatches.length >= 1,
      '应有 ambiguousMatches 冲突记录');
    const conflict = result.conflicts.ambiguousMatches[0];
    assert.equal(conflict.target, 'user-name');
    assert.ok(conflict.candidates.includes('userName') && conflict.candidates.includes('user_name'));
  });

  test('无匹配目标 → 附带候选建议 candidates', () => {
    const source = ['user_name_field_abc', 'user_email_field_xyz'];
    const target = ['user_name_field'];
    const result = autoMatch(source, target, { threshold: 0.9 });

    assert.equal(result.mappings.length, 1);
    assert.equal(result.mappings[0].source, null);
    assert.ok(Array.isArray(result.mappings[0].candidates),
      'candidates 应为数组');
    assert.ok(result.mappings[0].candidates.length >= 1,
      '应提供候选建议列表');
  });

  test('多个目标字段规范化相同 → 输出 duplicateTargets 冲突', () => {
    const source = ['user_name'];
    const target = ['userName', 'user_name'];
    const result = autoMatch(source, target);

    assert.ok(result.conflicts.duplicateTargets.length >= 1,
      '应有 duplicateTargets 冲突记录');
    const dup = result.conflicts.duplicateTargets[0];
    assert.equal(dup.normalizedName, 'user name');
    assert.ok(dup.targets.includes('userName'));
    assert.ok(dup.targets.includes('user_name'));
  });
});

describe('history 候选选择记忆（带 namespace）', () => {
  const histPath = () => join(TMP_DIR, 'h.json');
  const NS = 'bi-employee-report';

  test('首次歧义后写入 history（带 namespace）', async () => {
    const source = ['userName', 'user_name'];
    const target = ['user-name'];
    const result = autoMatch(source, target);

    const r = await recordMappings(result.mappings, histPath(), NS);
    assert.ok(r.updated >= 1, '应记录至少 1 条');
    assert.equal(r.namespace, NS);

    const loaded = await loadHistory(histPath(), NS);
    const entry = Array.from(loaded.entries()).find(([s, t]) => t === 'user-name');
    assert.ok(entry, '应存在 user-name → 某源字段 的历史记录');
  });

  test('第二次相同输入 → 优先使用历史选择，method=history，不再产生 ambiguousMatches', async () => {
    const source = ['userName', 'user_name'];
    const target = ['user-name'];

    const first = autoMatch(source, target);
    await recordMappings(first.mappings, histPath(), NS);
    const firstSelected = first.mappings[0].source;

    const historyMap = await loadHistory(histPath(), NS);
    const second = autoMatch(source, target, { historyMap });

    const m = second.mappings.find(x => x.target === 'user-name');
    assert.equal(m.source, firstSelected, '第二次应与第一次选择相同');
    assert.equal(m.method, 'history', 'method 应为 history');
    assert.equal(second.conflicts.ambiguousMatches.length, 0,
      '历史命中时不应再产生 ambiguousMatches 冲突');
    assert.ok(second.resolvedByHistory.length >= 1, '应记录 resolvedByHistory');
  });

  test('历史指定不同选择时应优先历史记录', async () => {
    const source = ['userName', 'user_name'];
    const target = ['user-name'];
    const historyMap = new Map([['user_name', 'user-name']]);

    const result = autoMatch(source, target, { historyMap });
    const m = result.mappings[0];

    assert.equal(m.source, 'user_name', '应选 history 指定的 user_name');
    assert.equal(m.method, 'history');
  });

  test('resolveFromHistory 纯函数匹配候选', () => {
    const history = new Map([
      ['email_address', 'EmailAddress'],
      ['userName', 'UserName'],
    ]);
    const candidates = ['emailAddress', 'email_address'];
    assert.equal(resolveFromHistory(candidates, 'EmailAddress', history), 'email_address');
    assert.equal(resolveFromHistory(candidates, 'Other', history), null);
    assert.equal(resolveFromHistory([], 'EmailAddress', history), null);
  });

  test('clearHistory 带 namespace 清空单一模板', async () => {
    const customPath = histPath();
    const mappings = [
      { source: 'a', target: 'A', method: 'normalized', confidence: 1 },
    ];
    await recordMappings(mappings, customPath, 'template-x');
    await recordMappings(mappings, customPath, 'template-y');

    const result = await clearHistory(customPath, 'template-x');
    assert.equal(result.cleared, true);
    assert.equal(result.namespace, 'template-x');

    const remainY = await loadHistory(customPath, 'template-y');
    assert.equal(remainY.size, 1, 'template-y 应保留');

    const clearedX = await loadHistory(customPath, 'template-x');
    assert.equal(clearedX.size, 0, 'template-x 应已清空');
  });

  test('clearHistory 不带 namespace 清空全部', async () => {
    const customPath = histPath();
    const mappings = [
      { source: 'a', target: 'A', method: 'normalized', confidence: 1 },
    ];
    await recordMappings(mappings, customPath, 'ns-a');
    await recordMappings(mappings, customPath, 'ns-b');

    const result = await clearHistory(customPath, null);
    assert.equal(result.cleared, true);
    assert.equal(result.namespace, null);

    const afterA = await loadHistory(customPath, 'ns-a');
    const afterB = await loadHistory(customPath, 'ns-b');
    assert.equal(afterA.size, 0, 'ns-a 应已清空');
    assert.equal(afterB.size, 0, 'ns-b 应已清空');
  });

  test('clearHistory 使用默认路径时返回项目根路径', () => {
    const p = getHistoryPath();
    assert.ok(p.endsWith('.mapper-history.json'));
  });

  test('clearHistory 清空不存在的 namespace 返回 namespace_not_exists', async () => {
    const customPath = histPath();
    const mappings = [
      { source: 'a', target: 'A', method: 'normalized', confidence: 1 },
    ];
    await recordMappings(mappings, customPath, 'existing-ns');

    const result = await clearHistory(customPath, 'nonexistent-ns');
    assert.equal(result.cleared, false);
    assert.equal(result.reason, 'namespace_not_exists');
  });
});

describe('namespace 隔离 - 不同模板互不干扰', () => {
  const histPath = () => join(TMP_DIR, 'ns-isolation.json');

  test('不同模板的 history 互不干扰', async () => {
    const source = ['userName', 'user_name'];
    const target = ['user-name'];

    const result1 = autoMatch(source, target);
    await recordMappings(result1.mappings, histPath(), 'bi-employee');

    const historyMapEmp = await loadHistory(histPath(), 'bi-employee');
    assert.equal(historyMapEmp.size, 1, 'bi-employee 应有 1 条记录');

    const historyMapSales = await loadHistory(histPath(), 'bi-sales');
    assert.equal(historyMapSales.size, 0, 'bi-sales 应为空');

    const salesMappings = [
      { source: 'userName', target: 'SalesName', method: 'manual', confidence: 1 },
    ];
    await recordMappings(salesMappings, histPath(), 'bi-sales');

    const historyMapEmp2 = await loadHistory(histPath(), 'bi-employee');
    const historyMapSales2 = await loadHistory(histPath(), 'bi-sales');
    assert.equal(historyMapEmp2.size, 1, 'bi-employee 仍为 1 条，未被覆盖');
    assert.equal(historyMapSales2.get('userName'), 'SalesName', 'bi-sales 有自己的映射');
    assert.equal(historyMapEmp2.get('userName'), 'user-name', 'bi-employee 的映射未变');
  });

  test('清空单一模板时只删除对应 namespace', async () => {
    const customPath = histPath();
    const mappings = [
      { source: 'a', target: 'A', method: 'normalized', confidence: 1 },
      { source: 'b', target: 'B', method: 'normalized', confidence: 1 },
    ];
    await recordMappings(mappings, customPath, 'keep-this');
    await recordMappings(mappings, customPath, 'delete-this');

    await clearHistory(customPath, 'delete-this');

    const kept = await loadHistory(customPath, 'keep-this');
    assert.equal(kept.size, 2, 'keep-this 应完整保留');

    const deleted = await loadHistory(customPath, 'delete-this');
    assert.equal(deleted.size, 0, 'delete-this 应已清空');

    const raw = JSON.parse(await readFile(customPath, 'utf-8'));
    assert.ok(raw.namespaces['keep-this'], '文件中 keep-this 应存在');
    assert.equal(raw.namespaces['delete-this'], undefined, '文件中 delete-this 应已移除');
  });

  test('不带参数清空全部历史记录', async () => {
    const customPath = histPath();
    const mappings = [
      { source: 'x', target: 'X', method: 'normalized', confidence: 1 },
    ];
    await recordMappings(mappings, customPath, 'ns-1');
    await recordMappings(mappings, customPath, 'ns-2');
    await recordMappings(mappings, customPath, 'ns-3');

    const result = await clearHistory(customPath, null);
    assert.equal(result.cleared, true);

    for (const ns of ['ns-1', 'ns-2', 'ns-3']) {
      const loaded = await loadHistory(customPath, ns);
      assert.equal(loaded.size, 0, `${ns} 应已清空`);
    }
  });

  test('listNamespaces 列出所有模板及记录数', async () => {
    const customPath = histPath();
    const mappings1 = [
      { source: 'a', target: 'A', method: 'normalized', confidence: 1 },
    ];
    const mappings2 = [
      { source: 'x', target: 'X', method: 'normalized', confidence: 1 },
      { source: 'y', target: 'Y', method: 'normalized', confidence: 1 },
    ];
    await recordMappings(mappings1, customPath, 'alpha');
    await recordMappings(mappings2, customPath, 'beta');

    const list = await listNamespaces(customPath);
    assert.equal(list.length, 2);
    const alpha = list.find(n => n.namespace === 'alpha');
    const beta = list.find(n => n.namespace === 'beta');
    assert.equal(alpha.count, 1);
    assert.equal(beta.count, 2);
  });

  test('同一源字段在不同 namespace 映射到不同目标', async () => {
    const customPath = histPath();

    await recordMappings([
      { source: 'userName', target: 'EmployeeName', method: 'manual', confidence: 1 },
    ], customPath, 'hr-report');

    await recordMappings([
      { source: 'userName', target: 'CustomerName', method: 'manual', confidence: 1 },
    ], customPath, 'crm-report');

    const hr = await loadHistory(customPath, 'hr-report');
    const crm = await loadHistory(customPath, 'crm-report');

    assert.equal(hr.get('userName'), 'EmployeeName');
    assert.equal(crm.get('userName'), 'CustomerName');
  });
});

describe('applyManualMappings', () => {
  test('手动映射覆盖自动匹配结果，清除 candidates 与 method=manual', () => {
    const source = ['userName', 'user_name'];
    const target = ['user-name'];
    const { mappings: autoMappings } = autoMatch(source, target);
    assert.ok(autoMappings[0].candidates);

    const manual = { user_name: 'user-name' };
    const result = applyManualMappings(autoMappings, manual);
    const m = result.find(x => x.target === 'user-name');

    assert.equal(m.source, 'user_name');
    assert.equal(m.method, 'manual');
    assert.equal(m.confidence, 1);
    assert.equal(m.candidates, undefined);
  });
});
