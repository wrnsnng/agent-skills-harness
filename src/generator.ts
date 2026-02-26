import { callModel, MODEL_CONFIGS, hasAnthropic } from "./models.js";
import { loadSkillMd, listSkills } from "./runner.js";
import type { SkillTest } from "./types.js";
import { join } from "node:path";

const GEN_MODEL = hasAnthropic() ? MODEL_CONFIGS.claude : MODEL_CONFIGS.gpt;

export async function generateTests(
  skills: string[],
  testsDir: string
): Promise<void> {
  for (const skill of skills) {
    const outPath = join(testsDir, `${skill}.json`);
    if (await Bun.file(outPath).exists()) {
      console.log(`  ⏭  ${skill} — test file exists, skipping`);
      continue;
    }

    console.log(`  ✏️  ${skill} — generating tests...`);
    const skillMd = await loadSkillMd(skill);

    const prompt = `Given this agent skill definition:

---
${skillMd}
---

Generate 3 test cases to evaluate an AI assistant that has this skill loaded:

1. **Explicit invocation** — directly ask to use the skill by name or clear trigger keywords
2. **Implicit invocation** — describe a task that should trigger the skill without naming it
3. **Edge case** — an unusual or boundary scenario that tests the skill's flexibility

For each test, write:
- A realistic user prompt
- 3-5 scoring criteria (things a good response MUST include)
- A minimum passing score (1-5 scale, typically 3)

Return ONLY valid JSON (no markdown fences):
{
  "skill": "${skill}",
  "tests": [
    {
      "name": "explicit-invocation",
      "prompt": "...",
      "type": "explicit",
      "rubric": {
        "criteria": ["...", "..."],
        "minScore": 3
      }
    },
    {
      "name": "implicit-invocation",
      "prompt": "...",
      "type": "implicit",
      "rubric": {
        "criteria": ["...", "..."],
        "minScore": 2
      }
    },
    {
      "name": "edge-case",
      "prompt": "...",
      "type": "edge",
      "rubric": {
        "criteria": ["...", "..."],
        "minScore": 2
      }
    }
  ]
}`;

    try {
      const raw = await callModel(
        GEN_MODEL,
        "You generate test cases for AI agent skills. Return only valid JSON.",
        prompt
      );
      const cleaned = raw.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned) as SkillTest;
      await Bun.write(outPath, JSON.stringify(parsed, null, 2));
      console.log(`  ✅  ${skill} — saved`);
    } catch (err: any) {
      console.error(`  ❌  ${skill} — failed: ${err.message}`);
    }

    await Bun.sleep(1000); // rate limit
  }
}
