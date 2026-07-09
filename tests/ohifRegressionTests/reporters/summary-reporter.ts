import * as fs from 'fs';
import * as path from 'path';
import type {
  FullConfig,
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';

interface RecordedTest {
  file: string;
  title: string;
  status: string;
  durationMs: number;
  error?: string;
}

/**
 * Writes test-results/summary.md and test-results/summary.json after each run.
 */
export default class SummaryReporter implements Reporter {
  private tests: RecordedTest[] = [];
  private outputDir = path.resolve(__dirname, '../test-results');

  onTestEnd(test: TestCase, result: TestResult) {
    // Only record the final attempt (skip retry duplicates unless the last one failed).
    if (result.retry < test.results.length - 1) return;

    this.tests.push({
      file: path.basename(test.location.file),
      title: test.title,
      status: result.status,
      durationMs: result.duration,
      error: result.error?.message
        ? stripAnsi(result.error.message).split('\n').slice(0, 8).join('\n')
        : undefined,
    });
  }

  onEnd(result: FullResult) {
    fs.mkdirSync(this.outputDir, { recursive: true });

    const passed = this.tests.filter((t) => t.status === 'passed');
    const failed = this.tests.filter((t) => t.status === 'failed' || t.status === 'timedOut');
    const skipped = this.tests.filter((t) => t.status === 'skipped');
    const interrupted = this.tests.filter((t) => t.status === 'interrupted');

    const meta = {
      timestamp: new Date().toISOString(),
      baseURL: process.env.XNAT_BASE_URL || 'https://cirxnat3.cir.mcw.edu',
      study: {
        projectId: process.env.OHIF_TEST_PROJECT || 'CIR_OverreadsTest',
        subjectId: process.env.OHIF_TEST_SUBJECT || 'CIRXNAT3_S00662',
        experimentId: process.env.OHIF_TEST_EXPERIMENT || 'CIRXNAT3_E00878',
        experimentLabel: process.env.OHIF_TEST_LABEL || 'MCW_0334_A',
      },
      durationMs: result.duration,
      totals: {
        passed: passed.length,
        failed: failed.length,
        skipped: skipped.length,
        interrupted: interrupted.length,
      },
      tests: this.tests,
    };

    const mdPath = path.join(this.outputDir, 'summary.md');
    const jsonPath = path.join(this.outputDir, 'summary.json');

    fs.writeFileSync(jsonPath, JSON.stringify(meta, null, 2));
    fs.writeFileSync(mdPath, formatMarkdown(meta, result.status));

    console.log(`\nSummary written to ${mdPath}`);
  }
}

function formatMarkdown(
  meta: {
    timestamp: string;
    baseURL: string;
    study: Record<string, string>;
    durationMs: number;
    totals: { passed: number; failed: number; skipped: number; interrupted: number };
    tests: RecordedTest[];
  },
  runStatus: FullResult['status'],
): string {
  const { study, totals } = meta;
  const studyUrl = `${meta.baseURL}/VIEWER/?subjectId=${study.subjectId}&projectId=${study.projectId}&experimentId=${study.experimentId}&experimentLabel=${study.experimentLabel}`;

  const lines: string[] = [
    '# OHIF Regression Test Summary',
    '',
    `**Run status:** ${runStatus}`,
    `**When:** ${meta.timestamp}`,
    `**Target:** ${meta.baseURL}`,
    `**Study:** ${study.experimentLabel} (${study.experimentId})`,
    `**Viewer URL:** ${studyUrl}`,
    `**Duration:** ${(meta.durationMs / 1000).toFixed(1)}s`,
    '',
    '## Totals',
    '',
    `| Passed | Failed | Skipped |`,
    `|--------|--------|---------|`,
    `| ${totals.passed} | ${totals.failed} | ${totals.skipped} |`,
    '',
  ];

  const byStatus = (statuses: string[]) =>
    meta.tests.filter((t) => statuses.includes(t.status));

  const section = (heading: string, items: RecordedTest[], icon: string) => {
    if (!items.length) return;
    lines.push(`## ${heading}`, '');
    for (const t of items) {
      lines.push(`- [${icon}] **${t.title}** (\`${t.file}\`, ${(t.durationMs / 1000).toFixed(1)}s)`);
      if (t.error) {
        const indented = t.error
          .split('\n')
          .map((line) => `    ${line}`)
          .join('\n');
        lines.push(indented);
      }
    }
    lines.push('');
  };

  section('Passed', byStatus(['passed']), 'PASS');
  section('Failed', byStatus(['failed', 'timedOut']), 'FAIL');
  section('Skipped', byStatus(['skipped']), 'SKIP');
  section('Interrupted', byStatus(['interrupted']), 'WARN');

  return lines.join('\n');
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}
