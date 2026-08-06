# Modernization Plan

Audit date: 2026-08-06

This document records the modernization audit and a phased implementation plan
for `@hataiit9x/review-code-ai`. It is intentionally limited to planning and
does not change application code.

## Executive assessment

The repository has a simple, understandable baseline architecture: a
TypeScript CLI orchestrates GitLab diff retrieval, provider-specific AI review,
and GitLab discussion creation. OpenAI and Gemini are separated into classes
behind the `IAIClient` interface.

The project is not release-ready. The highest-priority blockers are:

- the package currently cannot run because `lib/` is absent while
  `bin/index.js` requires it;
- the npm package dry run excludes compiled output;
- malformed inputs and external API responses are not validated;
- credentials can be exposed through command-line arguments, Gemini URLs, and
  unsanitized errors;
- large merge requests are truncated by the default GitLab diff page;
- retries can loop forever and can repeat AI work after a GitLab comment error;
- per-hunk failures are swallowed and the process can still report success;
- there are no tests, lint checks, coverage checks, or CI workflows.

## Current architecture and execution flow

1. [`bin/index.js`](bin/index.js) requires compiled `lib/index.js` and invokes
   the exported `run` function.
2. [`src/index.ts`](src/index.ts) creates a Commander program and parses
   `process.argv` at module load time.
3. CLI options are passed into [`GitLab`](src/gitlab.ts), then either
   [`OpenAI`](src/openai.ts) or [`Gemini`](src/gemini.ts) is selected based on
   the mode string.
4. `GitLab.init()` retrieves merge-request metadata, including the source
   branch and diff references.
5. `getMergeRequestChanges()` retrieves one GitLab diff page.
6. Each eligible file diff is split into `@@` hunks. Each hunk is sent to the
   selected AI provider and the returned string is posted as a positioned GitLab
   discussion.
7. A 429 error waits 60 seconds and requeues the hunk. Other per-hunk errors
   are logged and processing continues.

## Audit findings

Each finding includes severity, affected files, evidence, recommended change,
and backward-compatibility risk.

### F-01: Unusable build and publication artifact

Severity: Critical

Affected files: [`package.json`](package.json), [`bin/index.js`](bin/index.js),
missing `lib/`.

Evidence:

- `bin/index.js` requires `../lib/index.js`.
- `package.json` exposes only `lib` and `bin` through `files`.
- `lib/` is not present in the repository.
- `node bin/index.js --help` fails with `Cannot find module '../lib/index.js'`.
- `npm pack --dry-run` contains only `LICENSE`, `README.md`, `package.json`,
  and `bin/index.js`.
- `package.json` declares `"main": "index.js"`, but the root `index.js` is
  also absent.

Recommended change:

- Add an automated `prepack` or equivalent build hook.
- Set `main` to `lib/index.js`, or define explicit package `exports`.
- Build and execute the generated package tarball in CI before publication.

Backward incompatibility risk: Low. This repairs a currently broken release
path; correcting `main` may make previously failing `require()` calls work.

### F-02: CLI execution and configuration are difficult to test

Severity: Medium

Affected files: [`src/index.ts`](src/index.ts), [`bin/index.js`](bin/index.js).

Evidence:

- Commander parsing happens at module load time.
- `run` is exported with `module.exports = run` after top-level setup.
- Any import of `src/index.ts` also parses the caller's process arguments.
- Invalid modes silently fall back to OpenAI because only `gemini` is handled
  explicitly.

Recommended change:

- Separate argument parsing, configuration validation, and orchestration.
- Inject provider and GitLab clients into the orchestration function.
- Use a typed provider-mode union and reject unsupported modes.
- Keep the existing CLI flags while introducing a clean internal config type.

Backward incompatibility risk: Low if existing flags and defaults remain
available.

### F-03: CLI inputs and external API responses are not validated

Severity: High

Affected files: [`src/index.ts`](src/index.ts), [`src/types.ts`](src/types.ts),
[`src/gitlab.ts`](src/gitlab.ts), [`src/openai.ts`](src/openai.ts),
[`src/gemini.ts`](src/gemini.ts).

Evidence:

- `program.opts()` is passed directly into constructors.
- No token, URL, project ID, merge-request ID, or provider-mode validation is
  present.
- Required options are not marked mandatory.
- `response.data` is assigned directly to `IMergeRequestInfo`.
- GitLab entries are cast to `IDiffChange` after reading `item.diff` as a
  string.
- Provider response fields are accessed through optional chains but are not
  validated as successful, complete provider responses.

Recommended change:

- Add explicit CLI validation with actionable errors.
- Validate URL schemes and normalize trailing paths.
- Add runtime schemas or type guards for GitLab and provider response bodies.
- Reject empty tokens and malformed IDs before creating clients.

Backward incompatibility risk: Medium. Invalid invocations that currently fail
later will fail earlier and more clearly.

### F-04: TypeScript compiler safeguards are incomplete

Severity: Medium

Affected file: [`tsconfig.json`](tsconfig.json).

Evidence:

- `strict` is enabled.
- `skipLibCheck` is enabled.
- `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, and
  `noImplicitReturns` are not enabled.
- `noEmitOnError` is not enabled.
- `rootDir` and declaration output are not explicitly configured.
- A no-emit build check could not run in the checkout because `tsc` was not
  installed locally.

Recommended change:

- Enable stricter checks incrementally.
- Set `noEmitOnError: true`.
- Define `rootDir`, output behavior, and supported Node target explicitly.
- Treat compiler-only packages as development dependencies.

Backward incompatibility risk: Low to Medium. Existing type errors may surface
and need correction before builds pass.

### F-05: Dependency and lockfile drift

Severity: Medium

Affected files: [`package.json`](package.json),
[`package-lock.json`](package-lock.json), [`yarn.lock`](yarn.lock).

Evidence:

- `package.json` is version `1.0.3`, while `package-lock.json` is version
  `1.0.1`.
- npm and Yarn lockfiles resolve different Axios and TypeScript versions.
- Both `@types/axios` and `@types/commander` are runtime dependencies.
- `@types/axios` is deprecated because Axios provides its own declarations.
- Current registry versions have moved substantially beyond the versions
  represented in the lockfiles. See [Axios](https://www.npmjs.com/package/axios),
  [Commander](https://www.npmjs.com/package/commander), and
  [TypeScript](https://www.npmjs.com/package/typescript).

Recommended change:

- Select npm or Yarn as the supported package manager and remove the other
  lockfile.
- Regenerate the selected lockfile from the current manifest.
- Remove redundant type packages and move TypeScript tooling to
  `devDependencies`.
- Add an explicit Node.js `engines` policy before major dependency upgrades.
- Run dependency audit and license checks in CI.

Backward incompatibility risk: Medium to High for major dependency upgrades,
especially because current Commander releases require newer Node versions than
the README's Node 18 example.

### F-06: OpenAI default model and token rotation are fragile

Severity: High

Affected files: [`src/openai.ts`](src/openai.ts),
[`src/prompts.ts`](src/prompts.ts), [`src/index.ts`](src/index.ts).

Evidence:

- The default OpenAI model is hard-coded as `gpt-3.5-turbo`.
- OpenAI documents recurring model retirements and migration requirements in
  its [deprecation guidance](https://developers.openai.com/api/docs/deprecations).
- Multiple keys are split on commas without trimming or empty-value checks.
- The token index is incremented before selection, so the first request skips
  token 0 when multiple tokens are configured.
- Provider errors do not cause provider-local key health tracking.

Recommended change:

- Make the model default configurable and verify it against supported provider
  capabilities.
- Prefer a pinned, maintained model identifier for reproducible reviews.
- Normalize and validate the key list.
- Add per-key cooldown/circuit-breaker state and classify authentication,
  quota, and transient failures separately.

Backward incompatibility risk: High for changing the default model; output,
cost, availability, and first-request key selection can change. Preserve the
custom-model option and document the migration.

### F-07: Gemini authentication and response handling are unsafe

Severity: High

Affected files: [`src/gemini.ts`](src/gemini.ts),
[`src/prompts.ts`](src/prompts.ts), [`README.md`](README.md).

Evidence:

- The Gemini key is interpolated into the URL as `?key=${this.apiKey}`.
- All configured Gemini safety categories use `BLOCK_NONE`.
- Missing candidates or blocked responses become an empty string.
- Gemini mode does not implement the documented multiple-key rotation behavior.
- The default is the old `gemini-1.5-flash-latest` family.

Recommended change:

- Use header-based authentication such as `x-goog-api-key`; Google’s
  [API-key documentation](https://ai.google.dev/gemini-api/docs/api-key)
  treats keys as passwords.
- Validate candidates, finish reasons, blocked responses, and text parts.
- Use an explicit safety policy rather than globally disabling filters.
- Support a maintained stable model ID; Google’s [model guidance](https://ai.google.dev/gemini-api/docs/models)
  distinguishes stable IDs from hot-swapped `latest` aliases.
- Either implement Gemini key rotation or remove the claim that all providers
  support load balancing.

Backward incompatibility risk: Medium. Custom endpoints may only support query
keys, and safety-policy changes may alter which reviews are returned.

### F-08: GitLab diff retrieval is incomplete for large merge requests

Severity: High

Affected file: [`src/gitlab.ts`](src/gitlab.ts).

Evidence:

- `/merge_requests/:iid/diffs` is called without pagination parameters.
- GitLab documents `page` and `per_page`, with a default page size of 20,
  plus diff limits and `collapsed`/`too_large` results in the
  [merge-request API](https://docs.gitlab.com/api/merge_requests/).
- The implementation maps the response directly and ignores truncation or
  omitted-file indicators.

Recommended change:

- Page through all diffs or make an explicit review-size policy.
- Request and parse unified diffs deliberately.
- Detect overflow, collapsed, too-large, generated, and binary files.
- Report incomplete review status instead of silently skipping content.

Backward incompatibility risk: Medium to High. Large merge requests will cause
more provider calls, cost, runtime, and comments than today.

### F-09: Diff-to-line mapping can create incorrect comments

Severity: High

Affected files: [`src/utils.ts`](src/utils.ts),
[`src/index.ts`](src/index.ts), [`src/gitlab.ts`](src/gitlab.ts).

Evidence:

- Optional hunk counts are converted with `|| 0`; `@@ -1 +1 @@` can therefore
  calculate line 0.
- Position selection is based on the last line in a hunk rather than the line
  associated with the model finding.
- The algorithm assumes a trailing newline when selecting the last line.
- A separate parser in `gitlab.ts` requires explicit hunk counts and returns
  `-1` for other valid forms.
- GitLab requires valid old/new line semantics and matching diff references for
  positioned discussions; see the [discussions API](https://docs.gitlab.com/api/discussions/).

Recommended change:

- Build a tested unified-diff parser that maps each changed line explicitly.
- Require structured provider findings with a line offset or line range.
- Retrieve the latest merge-request diff version before posting comments.
- Add fixtures for additions, deletions, context lines, renames, single-line
  hunks, no-newline markers, and binary files.

Backward incompatibility risk: High because comment locations will change, but
this is required for reliable review behavior.

### F-10: Comment creation is not idempotent and failures are hidden

Severity: High

Affected files: [`src/index.ts`](src/index.ts),
[`src/prompts.ts`](src/prompts.ts), [`src/gitlab.ts`](src/gitlab.ts).

Evidence:

- Every non-error provider string is posted, including the `666` no-finding
  sentinel.
- Rerunning the CLI creates duplicate discussions.
- Non-429 hunk errors are logged and ignored.
- The process can print `Done` and exit successfully after incomplete review.

Recommended change:

- Replace the magic sentinel with a structured `findings: []` result.
- Add a stable review marker containing MR version, file, hunk, and finding
  identity; check existing discussions before posting.
- Aggregate failures and return a nonzero exit code when the review is partial.
- Skip empty or malformed provider output.

Backward incompatibility risk: High for CI pipelines that currently treat
partial reviews as successful. Document the new exit-status behavior.

### F-11: Secrets can leak through arguments, URLs, and logs

Severity: Critical

Affected files: [`src/index.ts`](src/index.ts),
[`src/gemini.ts`](src/gemini.ts), [`bin/index.js`](bin/index.js),
[`README.md`](README.md).

Evidence:

- GitLab and AI tokens are accepted as command-line arguments.
- README examples place credentials directly in shell commands.
- Gemini credentials are part of the request URL.
- The executable wrapper logs a complete error object, which may include Axios
  request configuration and authorization headers.
- No centralized redaction function exists.

Recommended change:

- Make environment variables, CI secret files, or stdin the preferred input.
- Retain existing flags temporarily for compatibility, but warn and deprecate
  them.
- Sanitize all errors before logging; never log Axios config, headers, query
  strings, request bodies, or tokens.
- Add tests that assert secrets never appear in logs or error messages.

Backward incompatibility risk: Low to Medium if flags remain supported during a
deprecation period.

### F-12: Untrusted diffs and security-review requirements are not addressed

Severity: High

Affected files: [`src/prompts.ts`](src/prompts.ts),
[`src/openai.ts`](src/openai.ts), [`src/gemini.ts`](src/gemini.ts),
[`src/gitlab.ts`](src/gitlab.ts), missing `SECURITY.md`.

Evidence:

- Repository code is sent as a user message without a clear trust-boundary or
  delimiter policy.
- The prompt requests bug and performance review but has no dedicated security
  review mode, evidence format, confidence level, or limitations disclaimer.
- Complete diffs are sent to external providers without documented data
  handling, retention, or secret-redaction behavior.

Recommended change:

- Treat diff contents as untrusted input and explicitly instruct providers not
  to follow instructions found inside code.
- Use structured findings containing evidence, affected lines, severity,
  confidence, and remediation.
- Add an opt-in security-review mode with a clear statement that it cannot
  guarantee vulnerability detection.
- Document provider data handling and add configurable redaction/policy rules.

Backward incompatibility risk: Medium because output format and provider
prompts will change. Keep the existing general review mode during migration.

### F-13: Retry, timeout, and rate-limit behavior is unsafe

Severity: High

Affected files: [`src/index.ts`](src/index.ts),
[`src/openai.ts`](src/openai.ts), [`src/gemini.ts`](src/gemini.ts),
[`src/gitlab.ts`](src/gitlab.ts).

Evidence:

- No Axios client configures a timeout.
- 429 handling waits a fixed 60 seconds.
- There is no retry limit, jitter, `Retry-After` handling, cancellation, or
  overall job deadline.
- A GitLab comment 429 requeues the hunk and repeats the AI request.
- Network errors and most 5xx/408 failures are not retried.

Recommended change:

- Create a shared bounded retry policy with exponential backoff and jitter.
- Honor `Retry-After` where available.
- Configure connect/request and overall-job timeouts.
- Retry AI generation and comment submission independently.
- Add cancellation and clear retry/failure telemetry without sensitive data.

Backward incompatibility risk: Medium. Jobs may complete sooner or fail instead
of hanging indefinitely.

### F-14: Scripts, tests, linting, and CI are missing

Severity: High

Affected files: [`package.json`](package.json); repository root.

Evidence:

- `package.json` contains only `start` and `build` scripts.
- There is no test script, test directory, lint configuration, coverage setup,
  or `.github` workflow.
- `start` only runs `tsc --watch`; it does not launch the CLI.

Recommended change:

- Add `typecheck`, `lint`, `test`, `test:coverage`, and package smoke-test
  scripts.
- Add unit tests for parsing and line positioning.
- Add mocked HTTP contract tests for both providers and GitLab.
- Add CI for supported Node versions, dependency checks, security checks, and
  `npm pack` verification.

Backward incompatibility risk: None directly. Tests may reveal behavior that
must be corrected or explicitly documented.

### F-15: README and contributor/security documentation are incomplete

Severity: High

Affected files: [`README.md`](README.md), missing `SECURITY.md`, missing
`CONTRIBUTING.md`.

Evidence:

- README contains an encoding/typographical error and an attribution line that
  is not appropriate for release documentation.
- Options and types are inconsistent between source and README.
- The README uses insecure command-line secret examples.
- It does not document token scopes, privacy/data handling, pagination limits,
  model compatibility, retry behavior, failure semantics, or known review
  limitations.
- There is no security reporting process or contribution workflow.

Recommended change:

- Rewrite the README around supported configuration, secure CI usage, provider
  behavior, permissions, limits, and troubleshooting.
- Add `SECURITY.md` with reporting contacts and supported versions.
- Add `CONTRIBUTING.md` with local setup, tests, linting, commit/PR expectations,
  and release procedure.
- Add a changelog and document backward-incompatible migrations.

Backward incompatibility risk: Low. Documentation changes should clarify
existing behavior; migration notes should accompany any behavioral changes.

## Phased implementation plan

### Phase 0: Release blockers and safety baseline

Goal: make the project safely buildable and prevent credential exposure.

Scope:

- Correct `main`/`exports` and add automated prepack compilation.
- Add package smoke tests against the generated tarball.
- Add typed configuration parsing and required-option validation.
- Add environment-variable support while preserving current CLI flags.
- Centralize error sanitization and secret redaction.
- Move TypeScript and type packages to development dependencies.
- Choose one lockfile and establish supported Node versions.

Exit criteria:

- `npm pack --dry-run` includes compiled `lib/` output.
- The packaged CLI successfully prints help in a clean temporary directory.
- Missing or invalid credentials fail before any HTTP request.
- Test logs contain no token, authorization header, or Gemini query key.

### Phase 1: Correct GitLab review behavior

Goal: ensure the review covers the intended diff and posts valid comments.

Scope:

- Implement GitLab diff pagination and explicit unified-diff handling.
- Detect and report overflow, collapsed, too-large, generated, binary, and
  skipped files.
- Replace the current line-position logic with a tested unified-diff parser.
- Use the latest merge-request diff version and validate required SHAs.
- Handle project paths and identifiers safely and consistently.
- Add idempotency markers and existing-discussion lookup.
- Replace the `666` sentinel with a structured no-finding result.

Exit criteria:

- Fixture tests cover all supported diff forms.
- A merge request with more than one diff page is fully accounted for.
- Rerunning the same review does not duplicate comments.
- Invalid positions are rejected before GitLab mutation.

### Phase 2: Provider modernization

Goal: make OpenAI and Gemini integrations maintainable and current without
removing the existing provider choice.

Scope:

- Keep provider logic separated behind a richer interface.
- Introduce structured provider results with findings, evidence, line hints,
  confidence, usage, and provider error categories.
- Make model IDs, endpoints, safety policy, and generation limits configurable.
- Replace obsolete defaults with maintained, documented defaults after testing.
- Use safe Gemini header authentication.
- Normalize multi-key configuration and implement provider-local key health.
- Add response validation for success, blocked, empty, and malformed results.
- Add explicit prompt-injection boundaries around source diffs.

Exit criteria:

- OpenAI and Gemini contract tests validate successful and failure responses.
- No provider response can create an empty or sentinel comment.
- Model defaults are documented with compatibility and migration notes.
- Security-review output includes evidence and a non-guarantee disclaimer.

### Phase 3: Resilience and operational behavior

Goal: make CI execution bounded, observable, and safe under provider/API load.

Scope:

- Implement timeout and cancellation policies.
- Add bounded exponential backoff, jitter, and `Retry-After` support.
- Separate AI retry from GitLab comment retry.
- Add overall job deadline, retry counters, and non-sensitive progress logs.
- Aggregate partial failures and return a meaningful exit status.
- Add configurable limits for files, hunks, bytes, tokens, comments, and cost.

Exit criteria:

- Persistent 429, 5xx, and network failures terminate predictably.
- A successful exit means all requested review work completed or was explicitly
  reported as skipped according to policy.
- Retry logs include request type and attempt count but no secrets or source
  content.

### Phase 4: Quality gates and maintainability

Goal: make future changes reviewable and regression-resistant.

Scope:

- Refactor import-time side effects out of the orchestration module.
- Strengthen TypeScript compiler settings.
- Add unit, contract, integration, and package smoke tests.
- Add linting, formatting, coverage thresholds, and dependency auditing.
- Add CI for supported Node versions and both provider modes using mocked APIs.

Exit criteria:

- CI runs typecheck, lint, tests, coverage, dependency checks, and package
  smoke tests.
- Core parsing, retry, redaction, idempotency, and provider behaviors have
  regression tests.
- No application code is published without a passing build and test suite.

### Phase 5: Documentation and release process

Goal: establish a trustworthy public release workflow.

Scope:

- Rewrite README usage and secure CI examples.
- Add `SECURITY.md`, `CONTRIBUTING.md`, changelog, and release checklist.
- Document required GitLab scopes and least-privilege token setup.
- Document provider data handling, model selection, limitations, retries, and
  incomplete-review behavior.
- Use versioned migration notes for changed defaults and output formats.
- Publish only from tagged commits after the package smoke test passes.

Exit criteria:

- A new contributor can install, test, and run a mocked review from the docs.
- A user can configure secrets without putting them in process arguments.
- Security reports and release responsibilities have documented owners.
- The published package contents match the intended runtime artifact.

## Backward-compatibility strategy

- Preserve existing short and long CLI flags during the first migration cycle.
- Add environment-variable configuration with documented precedence rather than
  removing flags immediately.
- Keep custom provider URLs and custom model options, but validate them.
- Make structured findings and security review opt-in before changing the
  default comment format.
- Announce changes to model defaults, retry limits, exit statuses, and
  idempotency behavior in the changelog.
- Treat an incomplete review as an explicit result, not an implicit success.

## Release gate

Do not publish a modernization release until Phase 0 is complete and the
following are true:

- clean package build and executable tarball smoke test pass;
- secrets are not present in logs, URLs, or documented examples;
- all external responses and CLI inputs are validated;
- GitLab pagination and positioned-comment fixtures pass;
- retries are bounded and timeouts are configured;
- partial reviews produce a nonzero or explicitly documented status;
- tests, lint, typecheck, and CI are running;
- `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, and release notes are current.
