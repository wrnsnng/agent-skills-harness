import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { callModel } from "./models.js";
import { judge } from "./judge.js";
import type { ModelConfig, SkillTest, TestResult } from "./types.js";

let skillsDir = "";

export function setSkillsDir(dir: string) {
  skillsDir = dir;
}

export function getSkillsDir(): string {
  return skillsDir;
}

export async function loadSkillMd(skillName: string): Promise<string> {
  const path = join(skillsDir, skillName, "SKILL.md");
  return Bun.file(path).text();
}

export async function loadTest(skillName: string, testsDir: string): Promise<SkillTest | null> {
  const path = join(testsDir, `${skillName}.json`);
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  return file.json() as Promise<SkillTest>;
}

export async function listSkills(): Promise<string[]> {
  const entries = await readdir(skillsDir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

function extractDescription(skillMd: string): string {
  const match = skillMd.match(/description:\s*>?\s*\n?\s*([\s\S]*?)(?=\n\w|\n---)/);
  if (match) return match[1].replace(/\n\s+/g, " ").trim();
  const lines = skillMd.split("\n");
  const descLine = lines.find((l) => l.startsWith("description:"));
  return descLine?.replace("description:", "").trim().replace(/^['">]+|['">]+$/g, "") ?? skillName;
}

let skillName = "";

export async function runTest(
  skill: string,
  test: SkillTest,
  model: ModelConfig,
  testsDir: string
): Promise<TestResult[]> {
  skillName = skill;
  const skillMd = await loadSkillMd(skill);
  const description = extractDescription(skillMd);
  const results: TestResult[] = [];

  for (const tc of test.tests) {
    const systemPrompt = `You are an AI assistant with the following skill loaded:\n\n${skillMd}\n\nFollow the skill's instructions when relevant to the user's request.`;

    const start = Date.now();
    let response: string;
    try {
      response = await callModel(model, systemPrompt, tc.prompt);
    } catch (err: any) {
      response = `[ERROR] ${err.message}`;
    }
    const durationMs = Date.now() - start;

    // Small delay for rate limiting
    await Bun.sleep(500);

    let judgeResult;
    try {
      judgeResult = await judge(skill, description, tc, response);
    } catch (err: any) {
      judgeResult = {
        scores: tc.rubric.criteria.map((c) => ({ criterion: c, score: 0, reason: "Judge error" })),
        overall: 0,
        passed: false,
        notes: `Judge error: ${err.message}`,
      };
    }

    // Another small delay
    await Bun.sleep(500);

    results.push({
      skill,
      test: tc.name,
      testType: tc.type,
      model: model.id,
      response,
      judge: judgeResult,
      durationMs,
    });
  }

  return results;
}
