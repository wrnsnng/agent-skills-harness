export interface TestCase {
  name: string;
  prompt: string;
  type: "explicit" | "implicit" | "edge";
  rubric: {
    criteria: string[];
    minScore: number;
  };
}

export interface SkillTest {
  skill: string;
  tests: TestCase[];
}

export interface ScoreItem {
  criterion: string;
  score: number;
  reason: string;
}

export interface JudgeResult {
  scores: ScoreItem[];
  overall: number;
  passed: boolean;
  notes: string;
}

export interface TestResult {
  skill: string;
  test: string;
  testType: string;
  model: string;
  response: string;
  judge: JudgeResult;
  durationMs: number;
}

export interface Report {
  timestamp: string;
  results: TestResult[];
  summary: Record<string, Record<string, number>>; // skill -> model -> avg score
}

export interface ModelConfig {
  id: string;
  name: string;
  provider: "anthropic" | "openai";
  model: string;
}
