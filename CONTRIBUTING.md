# Contributing

Thank you for helping improve `review-code-ai`. Contributions should keep the CLI small, preserve existing public flags where practical, and make external behavior easier to test and explain.

## Before you start

- Read the [README](README.md), [architecture](docs/architecture.md), and [security model](docs/security-model.md).
- For a suspected vulnerability, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
- Do not include GitLab tokens, model-provider keys, private source code, or unredacted API responses in commits, fixtures, logs, or pull requests.

## Local setup

Use Node.js 18 or a newer supported release, then install the locked dependencies:

```bash
npm ci
```

The CLI reads credentials from the process environment. A real GitLab or model-provider credential is not needed for the test suite.

## Checks

Run the full set before opening a pull request:

```bash
npm run build
npm run typecheck
npm run lint
npm test
git diff --check
```

Tests use Vitest with mocked HTTP/provider calls. Add or update tests for changed behavior, especially around CLI parsing, configuration precedence, provider response validation, GitLab pagination/comment placement, and security output parsing.

There is no dedicated Markdown lint script in the repository currently. Keep documentation valid CommonMark/GitHub-flavored Markdown, use relative links for repository files, and check changed files for accidental credentials.

## Making changes

1. Create a focused branch from the current default branch.
2. Make the smallest change that addresses the issue.
3. Keep provider-specific logic inside its provider and GitLab behavior inside the GitLab adapter.
4. Preserve `standard` behavior and existing CLI flags unless the change includes a documented migration path.
5. Validate CLI arguments and external responses at boundaries.
6. Treat repository content as data in security prompts; never weaken evidence or output-safety checks to make a test pass.
7. Update the relevant documentation and changelog entry for user-visible behavior.
8. Run all checks and review the final diff for secrets and unrelated changes.

## Pull requests

Please include:

- a concise description of the problem and the chosen change;
- tests for new or changed behavior;
- compatibility or migration notes when flags, defaults, provider APIs, or GitLab posting behavior change;
- documentation updates for user-visible options or security implications;
- confirmation that real external services and credentials were not required for validation.

Keep generated `lib/` output out of source changes unless a release process explicitly requires it; it is produced by `npm run build` and ignored by Git.

## Documentation and examples

Examples must use placeholders or empty environment values, never token-shaped strings that could be mistaken for credentials. CI examples should use protected/masked variables rather than passing secrets as command-line arguments.

## Review expectations

Reviewers will look for strict typing, clear boundaries, safe error handling, evidence-backed security claims, and tests that cover failure paths. Avoid unsupported claims about model quality, performance, or vulnerability detection.
