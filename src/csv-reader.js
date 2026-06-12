import { parse } from 'csv-parse';
import { readFile } from 'fs/promises';

export async function readCsvHeaders(filePath) {
  const content = await readFile(filePath, 'utf-8');
  return new Promise((resolve, reject) => {
    parse(content, { max_records: 1, skip_empty_lines: true }, (err, records) => {
      if (err) return reject(err);
      if (!records || records.length === 0) return reject(new Error(`CSV 文件为空: ${filePath}`));
      resolve(records[0].map(h => h.trim()));
    });
  });
}

export async function readCsvRecords(filePath, options = {}) {
  const content = await readFile(filePath, 'utf-8');
  return new Promise((resolve, reject) => {
    parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      ...options,
    }, (err, records) => {
      if (err) return reject(err);
      resolve(records || []);
    });
  });
}

export async function readCsvSample(filePath, count = 5) {
  const content = await readFile(filePath, 'utf-8');
  return new Promise((resolve, reject) => {
    parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      to: count + 1,
    }, (err, records) => {
      if (err) return reject(err);
      resolve(records || []);
    });
  });
}
