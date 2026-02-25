# Agent Skills Test Harness

## What
A CLI tool that tests Marc's 20 published UI/UX agent skills (at `/Users/george/_GitHub/agent-skills/skills/`) by running them through multiple LLMs and generating a quality scorecard.

## Skills location
`/Users/george/_GitHub/agent-skills/skills/` — 20 directories, each with a `SKILL.md` file following the agentskills.io standard.

## Architecture

### Test suite structure
Each skill gets a test file at `tests/<skill-name>.json`:
```json
{
  "skill": "component-anatomy",
  "tests": [
    {
      "name": "explicit-invocation",
      "prompt": "Use the component-anatomy skill to break down a date picker component for a design system",
      "type": "explicit",
      "rubric": {
        "criteria": [
          "Lists all sub-parts (trigger, calendar, header, day cells, etc.)",
          "Covers all states (default, hover, focus, disabled, error, loading)",
          "Includes accessibility requirements (ARIA roles, keyboard nav)",
          "Lists variants (size, density, orientation)",
          "Flags common pitfalls"
        ],
        "minScore": 3
      }
    },
    {
      "name": "implicit-invocation",
      "prompt": "I need to spec out a combobox for our design system. What should I think about?",
      "type": "implicit",
      "rubric": {
        "criteria": [
          "Produces a structured component breakdown",
          "Covers sub-parts and states",
          "Mentions accessibility"
        ],
        "minScore": 2
      }
    },
    {
      "name": "edge-case",
      "prompt": "Break down a component that doesn't really exist: a 'mood gradient selector' — a slider that transitions between emotional states with color and haptic feedback",
      "type": "edge",
      "rubric": {
        "criteria": [
          "Adapts the anatomy framework to a novel component",
          "Still produces structured output",
          "Identifies accessibility challenges for novel interactions"
        ],
        "minScore": 2
      }
    }
  ]
}
```

### Runner (`src/runner.ts`)
- Bun + TypeScript
- Takes: `--skills component-anatomy,design-critique` (or `--all`) + `--models claude,gpt` (defaults to claude-sonnet + gpt-4o)
- For each skill × test × model:
  1. Read the SKILL.md content
  2. Send system prompt: "You are an AI assistant with the following skill loaded:\n\n{SKILL.md content}\n\nFollow the skill's instructions when relevant."
  3. Send the test prompt as user message
  4. Capture the response
  5. Send response + rubric to a judge LLM (claude-sonnet by default) with prompt: "Score this response against each criterion (1-5). Return JSON: { scores: [{criterion, score, reason}], overall: number, passed: boolean }"
  6. Collect results

### Models to support
- `claude` → Anthropic API (claude-sonnet-4-20250514)
- `gpt` → OpenAI API (gpt-4o)
- `codex` → OpenAI API (o3-mini or whatever's available)
- Models configured in `src/models.ts`, easy to add more

### Output
- JSON report at `reports/<timestamp>.json` with all results
- Pretty terminal output with pass/fail per skill/model
- Summary scorecard: skill × model matrix with scores

### Judge prompt
```
You are evaluating an AI assistant's response to a design task.

The assistant had this skill loaded:
{skill_name}: {skill_description}

The user asked: {prompt}

The assistant responded: {response}

Score the response against each criterion below on a 1-5 scale:
1 = Not addressed at all
2 = Barely touched on
3 = Adequately covered
4 = Well covered with good detail
5 = Excellent, comprehensive, insightful

Criteria:
{criteria list}

Return ONLY valid JSON:
{
  "scores": [
    {"criterion": "...", "score": N, "reason": "brief explanation"}
  ],
  "overall": N.N,
  "passed": true/false,
  "notes": "any overall observations"
}

"passed" = true if overall >= {minScore}
```

### CLI interface
```bash
# Test all skills with default models
bun run src/cli.ts --all

# Test specific skills
bun run src/cli.ts --skills component-anatomy,design-critique

# Test with specific models
bun run src/cli.ts --all --models claude,gpt

# Generate test stubs for skills that don't have tests yet
bun run src/cli.ts --generate-tests

# Just show the scorecard from last run
bun run src/cli.ts --report
```

### Test generation
`--generate-tests` should:
1. Read each SKILL.md
2. Use an LLM to generate 3 test cases (explicit, implicit, edge) with rubrics
3. Write to `tests/<skill-name>.json`
4. Human reviews/edits before running

## Tech
- **Runtime:** Bun
- **Language:** TypeScript
- **APIs:** Anthropic SDK (`@anthropic-ai/sdk`), OpenAI SDK (`openai`)
- **No frameworks** — this is a CLI tool, keep it lean
- **API keys:** From env vars `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`

## File structure
```
agent-skills-harness/
├── src/
│   ├── cli.ts          # Entry point, arg parsing
│   ├── runner.ts       # Core test runner
│   ├── judge.ts        # LLM-as-judge scoring
│   ├── models.ts       # Model configs and API calls
│   ├── generator.ts    # Auto-generate test cases from SKILL.md
│   └── report.ts       # Output formatting + scorecard
├── tests/              # Test cases per skill (JSON)
├── reports/            # Generated reports
├── package.json
├── tsconfig.json
└── README.md
```

## Important
- Use `Bun.env` for env vars
- Use native fetch or SDKs, no axios
- Pretty output with colors (use chalk or similar)
- Concurrent execution per model (don't run sequentially if we can parallel)
- Rate limiting awareness (add small delays between API calls)
- The tool should be useful for iterating on skill quality — run, see what scores low, improve the SKILL.md, re-run
