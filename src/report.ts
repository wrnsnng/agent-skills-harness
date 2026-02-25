import chalk from "chalk";
import type { Report, TestResult } from "./types.js";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export function printResults(results: TestResult[]): void {
  // Group by skill
  const bySkill = new Map<string, TestResult[]>();
  for (const r of results) {
    const arr = bySkill.get(r.skill) ?? [];
    arr.push(r);
    bySkill.set(r.skill, arr);
  }

  for (const [skill, tests] of bySkill) {
    console.log(`\n${chalk.bold.white(skill)}`);
    for (const t of tests) {
      const icon = t.judge.passed ? chalk.green("✓") : chalk.red("✗");
      const score = t.judge.overall.toFixed(1);
      const scoreColor = t.judge.overall >= 4 ? chalk.green : t.judge.overall >= 3 ? chalk.yellow : chalk.red;
      console.log(
        `  ${icon} ${chalk.dim(t.test)} ${chalk.dim("(")}${chalk.cyan(t.model)}${chalk.dim(")")} ${scoreColor(score)}/5 ${chalk.dim(`${t.durationMs}ms`)}`
      );
      if (!t.judge.passed) {
        for (const s of t.judge.scores) {
          if (s.score < 3) {
            console.log(`    ${chalk.dim("└")} ${chalk.red(`${s.score}/5`)} ${chalk.dim(s.criterion)}`);
          }
        }
      }
    }
  }
}

export function printScorecard(results: TestResult[]): void {
  // Build skill × model matrix
  const skills = [...new Set(results.map((r) => r.skill))].sort();
  const models = [...new Set(results.map((r) => r.model))].sort();

  console.log(`\n${chalk.bold("━".repeat(60))}`);
  console.log(chalk.bold.white("  SCORECARD"));
  console.log(chalk.bold("━".repeat(60)));

  // Header
  const header = chalk.dim("  skill".padEnd(35)) + models.map((m) => chalk.cyan(m.padStart(10))).join("");
  console.log(header);
  console.log(chalk.dim("  " + "─".repeat(55)));

  for (const skill of skills) {
    let row = `  ${skill.padEnd(33)}`;
    for (const model of models) {
      const modelResults = results.filter((r) => r.skill === skill && r.model === model);
      if (modelResults.length === 0) {
        row += chalk.dim("     —    ");
        continue;
      }
      const avg = modelResults.reduce((s, r) => s + r.judge.overall, 0) / modelResults.length;
      const str = avg.toFixed(1).padStart(8);
      row += avg >= 4 ? chalk.green(str) + "  " : avg >= 3 ? chalk.yellow(str) + "  " : chalk.red(str) + "  ";
    }
    console.log(row);
  }

  // Totals
  console.log(chalk.dim("  " + "─".repeat(55)));
  let totRow = chalk.bold("  AVERAGE".padEnd(35));
  for (const model of models) {
    const modelResults = results.filter((r) => r.model === model);
    const avg = modelResults.reduce((s, r) => s + r.judge.overall, 0) / modelResults.length;
    const str = avg.toFixed(1).padStart(8);
    totRow += chalk.bold(avg >= 4 ? chalk.green(str) : avg >= 3 ? chalk.yellow(str) : chalk.red(str)) + "  ";
  }
  console.log(totRow);

  const passed = results.filter((r) => r.judge.passed).length;
  console.log(`\n  ${chalk.green(passed)} passed / ${chalk.red(results.length - passed)} failed / ${results.length} total`);
}

export async function buildReport(results: TestResult[]): Promise<Report> {
  const summary: Record<string, Record<string, number>> = {};
  for (const r of results) {
    if (!summary[r.skill]) summary[r.skill] = {};
    const existing = summary[r.skill][r.model];
    if (existing === undefined) {
      summary[r.skill][r.model] = r.judge.overall;
    } else {
      // Average with previous
      const prev = results.filter((x) => x.skill === r.skill && x.model === r.model);
      summary[r.skill][r.model] = prev.reduce((s, x) => s + x.judge.overall, 0) / prev.length;
    }
  }

  return {
    timestamp: new Date().toISOString(),
    results,
    summary,
  };
}

export async function loadLatestReport(reportsDir: string): Promise<Report | null> {
  try {
    const files = await readdir(reportsDir);
    const jsonFiles = files.filter((f) => f.endsWith(".json")).sort().reverse();
    if (jsonFiles.length === 0) return null;
    return Bun.file(join(reportsDir, jsonFiles[0])).json() as Promise<Report>;
  } catch {
    return null;
  }
}
