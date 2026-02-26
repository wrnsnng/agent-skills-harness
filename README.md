# Agent skills test harness

Test your [agentskills.io](https://agentskills.io) skills across multiple LLMs and get a quality scorecard.

## How it works

1. **Generate tests** — reads each SKILL.md and creates 3 test cases (explicit, implicit, edge case) with scoring rubrics
2. **Run tests** — sends each test prompt to LLMs with the skill loaded as system context
3. **Judge responses** — a separate LLM scores each response against the rubric criteria (1-5)
4. **Scorecard** — skill × model matrix showing average scores

## Setup

```bash
bun install
```

Needs at least one API key:
```bash
export ANTHROPIC_API_KEY=sk-...   # Claude
export OPENAI_API_KEY=sk-...      # GPT-4o
```

## Usage

```bash
# Point to your skills directory
bun run src/cli.ts -d ./path/to/skills --all

# Or set via env var
export SKILLS_DIR=./path/to/skills

# Or just put skills in ./skills/ and it'll find them

# Generate test cases for all skills
bun run src/cli.ts --generate-tests

# Test all skills
bun run src/cli.ts --all

# Test specific skills
bun run src/cli.ts -s component-anatomy,design-critique

# Test with multiple models
bun run src/cli.ts --all -m claude,gpt

# View last report
bun run src/cli.ts --report
```

The skills directory should contain folders, each with a `SKILL.md`:
```
skills/
├── component-anatomy/
│   └── SKILL.md
├── design-critique/
│   └── SKILL.md
└── ...
```

## Available models

| ID | Model | Provider |
|----|-------|----------|
| `claude` | claude-sonnet-4-20250514 | Anthropic |
| `gpt` | gpt-4o | OpenAI |
| `o3` | o3-mini | OpenAI |

## Test structure

Tests live in `tests/<skill-name>.json`:

```json
{
  "skill": "component-anatomy",
  "tests": [
    {
      "name": "explicit-invocation",
      "prompt": "Use the component-anatomy skill to break down a date picker",
      "type": "explicit",
      "rubric": {
        "criteria": ["Lists sub-parts", "Covers all states", "Includes a11y"],
        "minScore": 3
      }
    }
  ]
}
```

Auto-generated tests are a starting point. Edit them to match your quality bar.

## Reports

JSON reports saved to `reports/` after each run. View the latest with `--report`.
