# Building review-code-ai with Factory Droid

[Factory Droid](https://factory.ai) is the AI software engineering agent used
throughout the development and maintenance lifecycle of this repository.
Droid reads [`AGENTS.md`](AGENTS.md) as the project briefing, so every
automated or interactive change follows the same engineering rules.

## Development workflow

The workflows below use `droid exec`, Droid's headless one-shot mode. Runs are
read-only by default; `--auto` tiers opt in to edits and local commands
(`low` for file edits, `medium` for installs, builds, tests, and commits).
See the [Droid Exec documentation](https://docs.factory.ai/droid-exec/overview).

### 1. Repository analysis

```bash
droid exec "
Analyze this repository. Explain the architecture, the review pipeline,
the OpenAI/Gemini provider abstraction, the GitLab integration, and the
security-sensitive components.
"
```

### 2. Feature implementation

For scoped changes, let Droid plan first with spec mode, then implement:

```bash
droid exec --use-spec --auto medium "
Implement the requested change. Keep OpenAI and Gemini provider logic
behind the common provider interface. Run typecheck, lint, and tests
before finishing. Do not change public behavior unrelated to the change.
"
```

### 3. Defensive security review

```bash
droid exec "
Review this repository for security vulnerabilities. Only report findings
supported by direct source-code evidence. Focus on credential exposure,
GitLab API authorization handling, prompt injection boundaries, and unsafe
handling of provider responses. For every finding provide file, evidence,
impact, and remediation.
"
```

### 4. Regression testing

```bash
droid exec --auto medium "
Add regression tests for the confirmed bug. Tests must not require access
to a real GitLab instance or model provider, and must not contain real
credentials.
"
```

### 5. Documentation maintenance

```bash
droid exec --auto low "
Update README.md and docs/ so they match the current implementation.
Do not document commands or environment variables that do not exist in
the source code.
"
```

## Interactive use

For day-to-day work, open the repository in the interactive Droid CLI and ask
for changes directly. Droid reads `AGENTS.md`, inspects the codebase, makes the
edit, and runs the verification commands before declaring the task complete.

## Verification gates

Every change, whether from Droid or a human contributor, must pass:

```bash
npm ci
npm run build
npm run typecheck
npm run lint
npm test
```

CI runs the same gates on every push and pull request.
