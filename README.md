# Lazy PR Reviewer

A GitHub Action that explains a pull request instead of judging it. It reads the diff and writes a walkthrough to the PR's Checks tab. The walkthrough covers what changed, how the pieces connect, and which lines are worth a closer look. Every step links back to the code.

It doesn't find bugs, approve, block, or suggest edits. The check run always finishes as `neutral`.

See [PLAN.md](PLAN.md) for the design and roadmap. This is phase 1: diff-only explanations.

## What you get

- **Summary**: what the PR does, in 1 to 3 sentences.
- **Facts**: what the diff does, found by pattern matching rather than the model. New dependencies, npm scripts, env reads, network calls, file writes, process spawns, `eval`/raw HTML, new exports, and CI changes. PR text can't talk these away.
- **Walkthrough**: one entry per file in execution-flow order, linked to the Files tab.
- **Check yourself**: questions that point at specific changed lines. They never give answers or verdicts.
- **New concepts**: short explanations of libraries, APIs, and idioms the PR introduces, collapsed by default.
- **Not explained**: lockfiles, build output, vendored and binary files, and anything over the size budget.
- **AI-directed text warning**: shown when the PR contains text trying to steer AI tools.

## Use it in a repo

1. Add an `ANTHROPIC_API_KEY` repository secret.
2. Add `.github/workflows/lazy-pr-reviewer.yml`:

```yaml
name: Lazy PR Reviewer

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  checks: write
  contents: read

concurrency:
  group: lazy-pr-reviewer-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  explain:
    if: ${{ !github.event.pull_request.draft }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0 # needed to diff against the merge base
      - uses: <owner>/lazy-pr-reviewer@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

It works on any language. Facts have the most rules for TypeScript and JavaScript, with basic Python, Go, and Rust coverage.

### Inputs

| Input | Default | Notes |
| --- | --- | --- |
| `anthropic-api-key` | — | Empty means skip with a notice (fork and Dependabot PRs get no secrets) |
| `github-token` | `github.token` | Needs `checks: write` |
| `model` | `claude-opus-5` | `claude-sonnet-5` is cheaper |
| `effort` | `medium` | `low`, `medium`, `high`, `xhigh`, `max` |
| `max-tokens` | `32000` | Output cap |
| `max-diff-chars` | `300000` | About 85k input tokens. Files past the budget are listed as not explained |
| `exclude` | — | Extra globs to skip, one per line |
| `working-directory` | `.` | Where the repo is checked out |

## Limits

- Fork PRs are skipped: no secrets, and the token is read-only. Don't switch to `pull_request_target` to work around this, because that runs with secrets on untrusted code.
- Facts come from regexes on added lines. They miss obfuscated calls (`globalThis["fe" + "tch"]`) and ignore generated or excluded files.
- The walkthrough is model output and can be wrong. Read the linked code.

## Develop

```sh
npm install
npm test
npm run typecheck
npm run build        # bundles to dist/index.mjs, which must be committed

# Try it on any local repo without GitHub:
npm run dry-run -- --repo ../my-app --base main --head my-branch --title "PR title" --prompt-only
npm run dry-run -- --repo ../my-app --base main --head my-branch --title "PR title"   # calls the model
```

`dry-run` and `eval` read `ANTHROPIC_API_KEY` from the environment or a local `.env` file. See [eval/README.md](eval/README.md) for the regression set.
