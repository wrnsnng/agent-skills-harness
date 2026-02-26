#!/usr/bin/env bun
import { readdir, mkdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { listSkills, loadSkillMd, loadTest, runTest, setSkillsDir, getSkillsDir } from "./runner.js";
import { generateTests } from "./generator.js";
import { MODEL_CONFIGS, hasAnthropic, hasOpenAI } from "./models.js";
import type { TestResult } from "./types.js";

// ROOT = parent of src/ directory (where this file lives)
const ROOT = dirname(dirname(import.meta.path));
const TESTS_DIR = join(ROOT, "tests");
const REPORTS_DIR = join(ROOT, "reports");

console.log("Starting agent skills test harness...");

// Resolve skills dir: --skills-dir arg > SKILLS_DIR env > ./skills/
function parseSkillsDirArg(): string | undefined {
  const eqArg = process.argv.find((a) => a.startsWith("--skills-dir="));
  if (eqArg) return eqArg.split("=")[1];
  const idx = process.argv.indexOf("--skills-dir");
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return undefined;
}
const skillsDir = resolve(parseSkillsDirArg() ?? Bun.env.SKILLS_DIR ?? "./skills");

if (!existsSync(skillsDir)) {
  console.error(`\n  ❌ Skills directory not found: ${skillsDir}\n`);
  console.log("  Set via:");
  console.log("    SKILLS_DIR=./path/to/skills bun run dev");
  console.log("    bun run src/server.ts --skills-dir ./path/to/skills");
  console.log("    Or place skills in ./skills/\n");
  process.exit(1);
}
setSkillsDir(skillsDir);

await mkdir(TESTS_DIR, { recursive: true });
await mkdir(REPORTS_DIR, { recursive: true });

// SSE connections for live updates
const sseClients = new Set<ReadableStreamDefaultController>();

function broadcast(event: string, data: any) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const controller of sseClients) {
    try { controller.enqueue(new TextEncoder().encode(msg)); } catch { sseClients.delete(controller); }
  }
}

// Active run state
let activeRun: { abort: boolean } | null = null;

const port = parseInt(Bun.env.PORT ?? "3847");

console.log(`\n  🧪 Agent skills test harness`);
console.log(`  📁 Skills: ${getSkillsDir()}`);
console.log(`  🔗 http://localhost:${port}\n`);

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);

    // CORS
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    // Serve static UI
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(Bun.file(join(ROOT, "ui", "index.html")), {
        headers: { "content-type": "text/html" },
      });
    }

    if (url.pathname.startsWith("/ui/")) {
      const filePath = join(ROOT, url.pathname);
      const file = Bun.file(filePath);
      if (await file.exists()) {
        const ext = url.pathname.split(".").pop();
        const types: Record<string, string> = { css: "text/css", js: "text/javascript", svg: "image/svg+xml" };
        return new Response(file, { headers: { "content-type": types[ext!] ?? "application/octet-stream" } });
      }
    }

    // API routes
    if (url.pathname === "/api/status") {
      return json({
        skillsDir: getSkillsDir(),
        hasAnthropic: hasAnthropic(),
        hasOpenAI: hasOpenAI(),
        models: Object.values(MODEL_CONFIGS).map((m) => ({
          ...m,
          available: m.provider === "anthropic" ? hasAnthropic() : hasOpenAI(),
        })),
      });
    }

    if (url.pathname === "/api/skills") {
      const skills = await listSkills();
      const result = await Promise.all(
        skills.map(async (name) => {
          const md = await loadSkillMd(name);
          const desc = extractDescription(md);
          const testFile = Bun.file(join(TESTS_DIR, `${name}.json`));
          const hasTests = await testFile.exists();
          let testCount = 0;
          if (hasTests) {
            const t = await testFile.json();
            testCount = t.tests?.length ?? 0;
          }
          return { name, description: desc, hasTests, testCount };
        })
      );
      return json(result);
    }

    if (url.pathname === "/api/skill" && url.searchParams.get("name")) {
      const name = url.searchParams.get("name")!;
      const md = await loadSkillMd(name);
      const testFile = Bun.file(join(TESTS_DIR, `${name}.json`));
      const tests = (await testFile.exists()) ? await testFile.json() : null;
      return json({ name, skillMd: md, tests });
    }

    if (url.pathname === "/api/generate-tests" && req.method === "POST") {
      const { skills } = (await req.json()) as { skills: string[] };
      // Run in background, stream progress via SSE
      (async () => {
        for (const skill of skills) {
          broadcast("generate-progress", { skill, status: "generating" });
          try {
            await generateTests([skill], TESTS_DIR);
            broadcast("generate-progress", { skill, status: "done" });
          } catch (err: any) {
            broadcast("generate-progress", { skill, status: "error", error: err.message });
          }
        }
        broadcast("generate-complete", { skills });
      })();
      return json({ ok: true, message: `Generating tests for ${skills.length} skills` });
    }

    if (url.pathname === "/api/run" && req.method === "POST") {
      const { skills, models: modelIds } = (await req.json()) as { skills: string[]; models: string[] };
      
      if (activeRun) {
        return json({ ok: false, error: "A run is already in progress" }, 409);
      }

      const run = { abort: false };
      activeRun = run;

      const models = modelIds
        .map((id) => MODEL_CONFIGS[id])
        .filter(Boolean);

      // Run in background, stream results via SSE
      (async () => {
        const allResults: TestResult[] = [];
        broadcast("run-start", { skills, models: modelIds, total: skills.length * models.length });

        for (const skill of skills) {
          if (run.abort) break;
          const test = await loadTest(skill, TESTS_DIR);
          if (!test) {
            broadcast("run-skip", { skill, reason: "no tests" });
            continue;
          }

          for (const model of models) {
            if (run.abort) break;
            broadcast("run-testing", { skill, model: model.id });
            try {
              const results = await runTest(skill, test, model, TESTS_DIR);
              allResults.push(...results);
              const avg = results.reduce((s, r) => s + r.judge.overall, 0) / results.length;
              broadcast("run-result", { skill, model: model.id, results, avg });
            } catch (err: any) {
              broadcast("run-error", { skill, model: model.id, error: err.message });
            }
          }
        }

        // Save report
        const summary: Record<string, Record<string, number>> = {};
        for (const r of allResults) {
          if (!summary[r.skill]) summary[r.skill] = {};
          const prev = allResults.filter((x) => x.skill === r.skill && x.model === r.model);
          summary[r.skill][r.model] = prev.reduce((s, x) => s + x.judge.overall, 0) / prev.length;
        }
        const report = { timestamp: new Date().toISOString(), results: allResults, summary };
        const reportPath = join(REPORTS_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
        await Bun.write(reportPath, JSON.stringify(report, null, 2));

        broadcast("run-complete", { report, reportPath });
        activeRun = null;
      })();

      return json({ ok: true });
    }

    if (url.pathname === "/api/stop" && req.method === "POST") {
      if (activeRun) {
        activeRun.abort = true;
        activeRun = null;
        broadcast("run-stopped", {});
        return json({ ok: true });
      }
      return json({ ok: false, error: "No active run" });
    }

    if (url.pathname === "/api/reports") {
      try {
        const files = await readdir(REPORTS_DIR);
        const jsonFiles = files.filter((f) => f.endsWith(".json")).sort().reverse();
        const reports = await Promise.all(
          jsonFiles.slice(0, 20).map(async (f) => {
            const report = await Bun.file(join(REPORTS_DIR, f)).json();
            const skillCount = new Set(report.results.map((r: any) => r.skill)).size;
            const passed = report.results.filter((r: any) => r.judge.passed).length;
            return { file: f, timestamp: report.timestamp, total: report.results.length, passed, skillCount };
          })
        );
        return json(reports);
      } catch {
        return json([]);
      }
    }

    if (url.pathname === "/api/report" && url.searchParams.get("file")) {
      const file = url.searchParams.get("file")!;
      // Sanitize
      if (file.includes("..") || !file.endsWith(".json")) return json({ error: "invalid" }, 400);
      const report = await Bun.file(join(REPORTS_DIR, file)).json();
      return json(report);
    }

    // SSE endpoint
    if (url.pathname === "/api/events") {
      const stream = new ReadableStream({
        start(controller) {
          sseClients.add(controller);
          controller.enqueue(new TextEncoder().encode("event: connected\ndata: {}\n\n"));
        },
        cancel(controller) {
          sseClients.delete(controller);
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
          ...corsHeaders(),
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders() },
  });
}

function corsHeaders() {
  return { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type" };
}

function extractDescription(skillMd: string): string {
  const match = skillMd.match(/description:\s*>?\s*\n?\s*([\s\S]*?)(?=\n\w|\n---)/);
  if (match) return match[1].replace(/\n\s+/g, " ").trim();
  const lines = skillMd.split("\n");
  const descLine = lines.find((l) => l.startsWith("description:"));
  return descLine?.replace("description:", "").trim().replace(/^['">]+|['">]+$/g, "") ?? "";
}

// Server is running (startup log already printed above Bun.serve)
