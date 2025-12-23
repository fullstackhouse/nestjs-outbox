import * as fs from 'fs';
import * as path from 'path';

export interface BenchmarkResult {
  name: string;
  metrics: {
    durationMs: number;
    eventsPerSecond?: number;
    eventCount?: number;
    listenerCount?: number;
    totalListenerCalls?: number;
    failureAttempts?: number;
    [key: string]: number | undefined;
  };
  timestamp: string;
}

export interface BenchmarkReport {
  version: string;
  timestamp: string;
  commit?: string;
  results: BenchmarkResult[];
}

export interface BenchmarkComparison {
  name: string;
  current: BenchmarkResult['metrics'];
  baseline?: BenchmarkResult['metrics'];
  diff?: {
    durationMs: { value: number; percent: number };
    eventsPerSecond?: { value: number; percent: number };
  };
}

class BenchmarkReporter {
  private results: BenchmarkResult[] = [];
  private outputPath: string;

  constructor() {
    this.outputPath = process.env.BENCHMARK_OUTPUT_PATH ||
      path.join(process.cwd(), 'benchmark-results.json');
  }

  record(name: string, metrics: BenchmarkResult['metrics']): void {
    this.results.push({
      name,
      metrics,
      timestamp: new Date().toISOString(),
    });
  }

  getReport(): BenchmarkReport {
    return {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      commit: process.env.GITHUB_SHA,
      results: this.results,
    };
  }

  async saveReport(): Promise<void> {
    const report = this.getReport();
    await fs.promises.writeFile(
      this.outputPath,
      JSON.stringify(report, null, 2),
    );
  }

  static compare(current: BenchmarkReport, baseline: BenchmarkReport): BenchmarkComparison[] {
    const comparisons: BenchmarkComparison[] = [];

    for (const result of current.results) {
      const baselineResult = baseline.results.find(r => r.name === result.name);

      const comparison: BenchmarkComparison = {
        name: result.name,
        current: result.metrics,
        baseline: baselineResult?.metrics,
      };

      if (baselineResult) {
        const durationDiff = result.metrics.durationMs - baselineResult.metrics.durationMs;
        const durationPercent = (durationDiff / baselineResult.metrics.durationMs) * 100;

        comparison.diff = {
          durationMs: { value: durationDiff, percent: durationPercent },
        };

        if (result.metrics.eventsPerSecond && baselineResult.metrics.eventsPerSecond) {
          const epsDiff = result.metrics.eventsPerSecond - baselineResult.metrics.eventsPerSecond;
          const epsPercent = (epsDiff / baselineResult.metrics.eventsPerSecond) * 100;
          comparison.diff.eventsPerSecond = { value: epsDiff, percent: epsPercent };
        }
      }

      comparisons.push(comparison);
    }

    return comparisons;
  }

  static formatMarkdownTable(comparisons: BenchmarkComparison[]): string {
    const lines: string[] = [
      '## Benchmark Results',
      '',
      '| Test | Duration (ms) | Events/sec | vs Baseline |',
      '|------|---------------|------------|-------------|',
    ];

    for (const comp of comparisons) {
      const duration = comp.current.durationMs.toFixed(2);
      const eps = comp.current.eventsPerSecond?.toFixed(2) || 'N/A';

      let vsBaseline = 'No baseline';
      if (comp.diff) {
        const sign = comp.diff.durationMs.percent > 0 ? '+' : '';
        const emoji = comp.diff.durationMs.percent > 5 ? '🔴' :
                      comp.diff.durationMs.percent < -5 ? '🟢' : '⚪';
        vsBaseline = `${emoji} ${sign}${comp.diff.durationMs.percent.toFixed(1)}%`;
      }

      lines.push(`| ${comp.name} | ${duration} | ${eps} | ${vsBaseline} |`);
    }

    return lines.join('\n');
  }

  static formatSummary(report: BenchmarkReport): string {
    const lines: string[] = [
      '## Benchmark Summary',
      '',
      `**Timestamp:** ${report.timestamp}`,
      report.commit ? `**Commit:** ${report.commit}` : '',
      '',
      '| Test | Duration | Events/sec | Events | Listeners |',
      '|------|----------|------------|--------|-----------|',
    ];

    for (const result of report.results) {
      const m = result.metrics;
      lines.push(
        `| ${result.name} | ${m.durationMs.toFixed(2)}ms | ${m.eventsPerSecond?.toFixed(2) || 'N/A'} | ${m.eventCount || 'N/A'} | ${m.listenerCount || 'N/A'} |`
      );
    }

    return lines.filter(Boolean).join('\n');
  }
}

export const benchmarkReporter = new BenchmarkReporter();
export { BenchmarkReporter };
