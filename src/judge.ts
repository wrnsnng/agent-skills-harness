import { callModel, MODEL_CONFIGS, hasAnthropic } from "./models.js";
import type { JudgeResult, TestCase } from "./types.js";

// Use whichever model is available — prefer claude, fall back to gpt
const JUDGE_MODEL = hasAnthropic() ? MODEL_CONFIGS.claude : MODEL_CONFIGS.gpt;

export async function judge(
  skillName: string,
  skillDescription: string,
  test: TestCase,
  response: string
): Promise<JudgeResult> {
  const criteriaList = test.rubric.criteria
    .map((c, i) => `${i + 1}. ${c}`)
    .join("\n");

  const prompt = `You are evaluating an AI assistant's response to a design task.

The assistant had this skill loaded:
${skillName}: ${skillDescription}

The user asked: ${test.prompt}

The assistant responded:
---
${response}
---

Score the response against each criterion below on a 1-5 scale:
1 = Not addressed at all
2 = Barely touched on
3 = Adequately covered
4 = Well covered with good detail
5 = Excellent, comprehensive, insightful

Criteria:
${criteriaList}

Return ONLY valid JSON (no markdown fences):
{
  "scores": [
    {"criterion": "...", "score": N, "reason": "brief explanation"}
  ],
  "overall": N.N,
  "passed": true/false,
  "notes": "any overall observations"
}

"passed" = true if overall >= ${test.rubric.minScore}`;

  const raw = await callModel(
    JUDGE_MODEL,
    "You are a strict but fair evaluator of AI-generated design work. Return only valid JSON.",
    prompt
  );

  try {
    // Strip markdown fences if present
    const cleaned = raw.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned) as JudgeResult;
  } catch {
    return {
      scores: test.rubric.criteria.map((c) => ({
        criterion: c,
        score: 0,
        reason: "Judge failed to parse",
      })),
      overall: 0,
      passed: false,
      notes: `Judge parse error. Raw: ${raw.slice(0, 200)}`,
    };
  }
}
