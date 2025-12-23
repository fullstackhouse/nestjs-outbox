#!/usr/bin/env npx ts-node

import * as fs from 'fs';
import * as path from 'path';
import { BenchmarkReporter, BenchmarkReport } from '../src/test/benchmark-reporter';

const args = process.argv.slice(2);

if (args.length < 1) {
  console.log('Usage: compare-benchmarks.ts <current.json> [baseline.json]');
  console.log('');
  console.log('If only one file provided, shows summary.');
  console.log('If two files provided, shows comparison.');
  process.exit(1);
}

const currentPath = args[0];
const baselinePath = args[1];

function loadReport(filePath: string): BenchmarkReport {
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

const current = loadReport(currentPath);

if (baselinePath) {
  const baseline = loadReport(baselinePath);
  const comparisons = BenchmarkReporter.compare(current, baseline);
  console.log(BenchmarkReporter.formatMarkdownTable(comparisons));
} else {
  console.log(BenchmarkReporter.formatSummary(current));
}
