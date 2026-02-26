#!/usr/bin/env bun
import chalk from "chalk";
import { parseArgs } from "node:util";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { listSkills, loadTest, runTest, setSkillsDir } from "./runner.js";
import { generateTests } from "./generator.js";
import { printResults, printScorecard, buildReport, loadLatestReport } from "./report.js";
import { MODEL_CONFIGS } from "./models.js";
import type { TestResult } from "./types.js";

const ROOT = import.meta.dir.replace("/src", "");
const TESTS_DIR = join(ROOT, "tests");
const REPORTS_DIR = join(ROOT, "reports");

const { values } = parseArgs({
  options: {
    skills: { type: "string", short: "s" },
    models: { type: "string", short: "m" },
    "skills-dir": { type: "string", short: "d" },
    all: { type: "boolean", short: "a" },
    "generate-tests": { type: "boolean", short: "g" },
    report: { type: "boolean", short: "r" },
    help: { type: "boolean", short: "h" },
  },
  strict: false,
});

if (values.help) {
  console.log(`
${chalk.bold("Agent Skills Test Harness")}

${chalk.dim("Usage:")}
  bun run src/cli.ts --all                    Test all skills
  bun run src/cli.ts -s component-anatomy     Test specific skills
  bun run src/cli.ts --all -m claude,gpt      Test with specific models
  bun run src/cli.ts --generate-tests         Generate test cases
  bun run src/cli.ts --report                 Show last report
  bun run src/cli.ts -d ./path/to/skills      Use custom skills directory

${chalk.dim("Skills directory (resolved in order):")}
  1. --skills-dir / -d flag
  2. SKILLS_DIR env var
  3. ./skills/ in current directory

${chalk.dim("Models:")} ${Object.keys(MODEL_CONFIGS).join(", ")}
`);
  process.exit(0);
}

// Resolve skills directory
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const resolvedSkillsDir = resolve(
  values["skills-dir"] ?? Bun.env.SKILLS_DIR ?? "./skills"
);

if (!existsSync(resolvedSkillsDir)) {
  console.error(chalk.red(`Skills directory not found: ${resolvedSkillsDir}`));
  console.log(chalk.dim("Set via --skills-dir, SKILLS_DIR env var, or place skills in ./skills/"));
  process.exit(1);
}

setSkillsDir(resolvedSkillsDir);
console.log(chalk.dim(`Skills: ${resolvedSkillsDir}`));

await mkdir(TESTS_DIR, { recursive: true });
await mkdir(REPORTS_DIR, { recursive: true });

// Show last report
if (values.report) {
  const report = await loadLatestReport(REPORTS_DIR);
  if (!report) {
    console.log(chalk.yellow("No reports found. Run tests first."));
    process.exit(0);
  }
  printResults(report.results);
  printScorecard(report.results);
  process.exit(0);
}

// Determine skills to test
const allSkills = await listSkills();
let targetSkills: string[];

if (values.all) {
  targetSkills = allSkills;
} else if (values.skills) {
  targetSkills = values.skills.split(",").map((s) => s.trim());
  // Validate
  for (const s of targetSkills) {
    if (!allSkills.includes(s)) {
      console.error(chalk.red(`Unknown skill: ${s}`));
      console.log(chalk.dim(`Available: ${allSkills.join(", ")}`));
      process.exit(1);
    }
  }
} else if (values["generate-tests"]) {
  targetSkills = allSkills;
} else {
  console.log(chalk.yellow("Specify --all or --skills <name,name>. Use --help for usage."));
  process.exit(1);
}

// Generate tests
if (values["generate-tests"]) {
  console.log(chalk.bold(`\nGenerating tests for ${targetSkills.length} skills...\n`));
  await generateTests(targetSkills, TESTS_DIR);
  console.log(chalk.green("\nDone! Review tests in ./tests/ before running.\n"));
  process.exit(0);
}

// Determine models
const modelIds = values.models
  ? values.models.split(",").map((m) => m.trim())
  : [Bun.env.ANTHROPIC_API_KEY ? "claude" : "gpt"];

const models = modelIds.map((id) => {
  const config = MODEL_CONFIGS[id];
  if (!config) {
    console.error(chalk.red(`Unknown model: ${id}. Available: ${Object.keys(MODEL_CONFIGS).join(", ")}`));
    process.exit(1);
  }
  return config;
});

// Run tests
console.log(chalk.bold(`\n🧪 Testing ${targetSkills.length} skills × ${models.length} models\n`));

const allResults: TestResult[] = [];
let tested = 0;
let skipped = 0;

for (const skill of targetSkills) {
  const test = await loadTest(skill, TESTS_DIR);
  if (!test) {
    console.log(chalk.dim(`  ⏭  ${skill} — no test file (run --generate-tests first)`));
    skipped++;
    continue;
  }

  for (const model of models) {
    process.stdout.write(`  🔬 ${skill} × ${model.id}...`);
    const results = await runTest(skill, test, model, TESTS_DIR);
    allResults.push(...results);
    const avg = results.reduce((s, r) => s + r.judge.overall, 0) / results.length;
    const icon = avg >= 3 ? chalk.green("✓") : chalk.red("✗");
    process.stdout.write(`\r  ${icon}  ${skill} × ${model.id} — ${avg.toFixed(1)}/5\n`);
  }
  tested++;
}

if (allResults.length === 0) {
  console.log(chalk.yellow("\nNo tests to run. Generate tests first: --generate-tests"));
  process.exit(0);
}

// Print results
printResults(allResults);
printScorecard(allResults);

// Save report
const report = await buildReport(allResults);
const reportPath = join(REPORTS_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
await Bun.write(reportPath, JSON.stringify(report, null, 2));
console.log(chalk.dim(`\nReport saved: ${reportPath}`));

if (skipped > 0) {
  console.log(chalk.dim(`${skipped} skills skipped (no test files)`));
}
