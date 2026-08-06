# Architecture

This document describes the current implementation of `review-code-ai`. The design favors a small number of explicit boundaries over a general plugin framework.

## Runtime flow

```text
bin/index.js
    |
    v
src/index.ts
    |  Commander options + process environment
    v
src/config.ts
    |  environment-first resolved configuration
    +--------------------------+
    |                          |
    v                          v
src/gitlab.ts              provider-factory.ts
    |                          |
    |                          +--> src/openai.ts
    |                          |
    |                          +--> src/gemini.ts
    v                          v
MR metadata, diffs,       ReviewResult
and discussions                |
    +------------+-------------+
                 v
        src/security-review.ts
        (security profiles only)
                 |
                 v
       inline discussion or summary
```

The compiled entry point is loaded by [`bin/index.js`](../bin/index.js). TypeScript source is compiled into `lib/` by `npm run build`.

## Components

### CLI and configuration

[`src/cli.ts`](../src/cli.ts) defines the existing Commander flags and validates the review profile. [`src/config.ts`](../src/config.ts) resolves environment variables before legacy flag values, keeps compatibility aliases, emits deprecation warnings for secret flags, and provides safe error redaction.

The public profile values are:

- `standard` — the backward-compatible default.
- `security` — structured, evidence-based defensive security review.
- `wordpress-security` — the security profile with WordPress-specific review priorities and code-path requirements.

### GitLab adapter

[`src/gitlab.ts`](../src/gitlab.ts) is responsible for GitLab API communication:

1. Validate the API URL, token, project, and merge-request identifiers.
2. Fetch merge-request metadata and diff references.
3. Paginate merge-request changes and existing discussions.
4. Normalize and classify text, deleted, renamed, binary, truncated, and unavailable changes.
5. Bound diff size before provider submission.
6. Track existing and newly-created comments to avoid duplicates.
7. Create a positioned discussion only when the changed-line position is valid.
8. Fall back to a summary discussion when GitLab cannot accept an inline position.

GitLab requests use a timeout and bounded retry policy. Retry delays use exponential backoff and honor `Retry-After` values when present. User-facing errors are mapped to safe messages rather than exposing response bodies or authorization headers.

### Provider boundary

[`src/types.ts`](../src/types.ts) defines the provider-independent `ReviewRequest`, `ReviewResult`, and `IAIProvider` contract. [`src/provider-factory.ts`](../src/provider-factory.ts) selects a provider from the existing `--mode` value without introducing a dependency-injection container.

The provider implementations are intentionally separate:

- [`src/openai.ts`](../src/openai.ts) uses the installed OpenAI SDK's Responses API, configurable base URL and model, optional organization/project headers where supported by the SDK, request timeout, bounded SDK retries, and response validation.
- [`src/gemini.ts`](../src/gemini.ts) keeps the existing Gemini HTTP implementation and validates its provider response separately.

Both providers return the common `ReviewResult` shape. Provider-specific configuration failures and HTTP failures remain provider-specific so the CLI can present useful messages without coupling the implementations.

### Prompt and result handling

[`src/prompts.ts`](../src/prompts.ts) selects standard, security, or WordPress security instructions. Security prompts put repository content in an explicitly untrusted data block and prohibit attack instructions. [`src/security-review.ts`](../src/security-review.ts) parses the constrained JSON result and discards malformed or unsupported findings before anything is posted to GitLab.

Security findings must include direct code evidence from the supplied diff. WordPress findings additionally require code-path evidence, and an attacker role is downgraded to `insufficient evidence` unless its supporting excerpt is present.

### Review orchestration

[`src/index.ts`](../src/index.ts) coordinates the flow. Text changes are split into diff hunks and reviewed separately when a GitLab line position can be derived. Changes that cannot support inline placement use a summary path. The standard profile posts provider text; security profiles format only validated findings.

## External boundaries and trust

| Boundary | Data leaving or entering | Main control |
| --- | --- | --- |
| GitLab API | MR metadata, diffs, discussions, review comments | HTTPS URL validation, token headers, timeouts, retries, safe error mapping |
| Model provider | Review prompts, file metadata, and diff content | Configurable endpoint/model, provider response validation, untrusted-data prompt framing for security profiles |
| Repository content | Code, comments, strings, filenames, and diff text | Treated as data; never treated as application instructions by security prompts |
| CI or local environment | Tokens, endpoints, project and MR identifiers | Environment-first resolution, deprecated flag warnings, redacted errors |

The CLI does not execute reviewed code and does not use a model response as a command. It does post accepted output to GitLab, so repository permissions and comment-review practices remain important.

## Testing boundary

Tests use Vitest and mocked HTTP/provider calls. The test suite covers CLI parsing, configuration precedence, provider selection and validation, OpenAI requests, security output parsing, WordPress fixtures, GitLab pagination/comment placement, and utility functions. No real GitLab instance or model credential is required to run the suite.

## Extension guidance

Additions should prefer a small typed boundary over a cross-cutting framework:

- New providers should implement the common request/result contract and own their configuration/error mapping.
- New profiles should define prompt constraints and result validation before changing posting behavior.
- GitLab behavior should remain behind `GitLab` so pagination, retries, and comment placement stay testable.
- External data must be validated before it is used to construct comments, positions, or provider requests.
