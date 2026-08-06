# review-code-ai

`review-code-ai` is a TypeScript CLI that reviews GitLab merge-request diffs with a configured OpenAI-compatible or Gemini model provider. It retrieves the merge request changes, sends reviewable diff content to the selected provider, and posts the resulting review as GitLab discussions when a valid position is available.

This is AI-assisted code review, not a compiler, static analyzer, penetration-testing tool, or guarantee of vulnerability detection.

## Purpose

The project is intended for teams that want a small, scriptable review assistant in a GitLab workflow. The default `standard` profile provides general code-review feedback. The opt-in `security` and `wordpress-security` profiles apply stricter evidence requirements and are designed for defensive assistance.

## Architecture overview

The runtime flow is deliberately small:

```text
CLI and environment
        |
        v
GitLab metadata, diffs, and existing discussions
        |
        v
Diff classification and hunk/summary selection
        |
        v
Common provider interface
   |                 |
OpenAI-compatible   Gemini
        \           /
         v         v
Validated review result
        |
        v
GitLab inline discussion or summary fallback
```

OpenAI and Gemini implementations are separate behind a small provider contract. The GitLab adapter handles pagination, diff classification, timeouts, bounded retries, duplicate prevention, and fallback to a summary when inline placement is not possible. More detail is in [`docs/architecture.md`](docs/architecture.md).

## Installation

Install the published package globally:

```bash
npm install --global @hataiit9x/review-code-ai
```

For a source checkout:

```bash
npm ci
npm run build
```

The CLI expects GitLab and provider credentials at runtime. Do not commit them or put them in issue descriptions, merge requests, or shell history. [`.env.example`](.env.example) is a variable reference; the CLI reads the process environment and does not load a `.env` file by itself.

## Standard review usage

Set the preferred environment variables, then identify the project and merge request:

```bash
export GITLAB_ACCESS_TOKEN="<gitlab-token>"
export OPENAI_API_KEY="<provider-key>"

review-code-ai \
  --project-id 432288 \
  --merge-request-id 8
```

The standard profile is the backward-compatible default. It produces provider-generated review text and attempts to place it inline; the integration attempts a summary comment when an inline position is unavailable.

## Defensive security review usage

Security review is opt-in:

```bash
review-code-ai \
  --review-profile security \
  --project-id 432288 \
  --merge-request-id 8
```

Security mode treats repository content, including comments and strings, as untrusted data rather than instructions. It asks the provider for structured findings and accepts only findings with direct code evidence from the supplied diff. Findings distinguish confirmed evidence from assumptions and include remediation and a suggested defensive regression test when the response is valid. It does not generate exploit payloads, live-system attack instructions, or proof-of-concept commands.

Security mode is defensive assistance and requires human validation. See [`docs/security-model.md`](docs/security-model.md) and [`docs/limitations.md`](docs/limitations.md).

## WordPress security review usage

Use the opt-in WordPress profile on top of the security constraints:

```bash
review-code-ai \
  --review-profile wordpress-security \
  --project-id 432288 \
  --merge-request-id 8
```

The profile prioritizes WordPress AJAX handlers, REST `permission_callback`, admin-post and admin-action handlers, capability checks, nonces, sanitization/validation/escaping, `$wpdb` queries and `prepare`, upload/filesystem operations, authorization boundaries, and payment or membership integrity logic.

A hook or function name alone is not treated as a finding. The changed code must support the relevant code path and direct evidence. The minimum plausible attacker role is reported only when that role is supported; otherwise the result says `insufficient evidence`. WordPress-specific limitations are documented in [`docs/limitations.md`](docs/limitations.md).

## GitLab CI example

Create the secret variables in GitLab project or group settings, and mark them both **Protected** and **Masked**. Keep secret values out of `.gitlab-ci.yml`:

```yaml
stages:
  - review

code-review:
  stage: review
  image: node:18
  script:
    - npm install --global @hataiit9x/review-code-ai
    - review-code-ai --project-id "$CI_MERGE_REQUEST_PROJECT_ID" --merge-request-id "$CI_MERGE_REQUEST_IID" --review-profile standard
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
```

Configure `GITLAB_ACCESS_TOKEN` and either `OPENAI_API_KEY` or `GEMINI_API_KEY` as protected/masked CI variables. For a self-hosted GitLab instance set `GITLAB_API_URL`; for a compatible model endpoint set `OPENAI_API_URL` or `GEMINI_API_URL`. Protected variables are intentionally unavailable to untrusted pipeline contexts such as many fork pipelines; confirm the trust boundary before enabling review jobs.

## Environment variables and credentials

Environment variables take precedence over command-line values. The legacy secret flags remain accepted for compatibility, but `--gitlab-access-token`/`-t` and `--openai-access-token`/`-a` are deprecated and cause a startup warning. Warning and error paths do not print configured secret values.

| Variable | Purpose |
| --- | --- |
| `GITLAB_ACCESS_TOKEN` | Preferred GitLab access token. |
| `GITLAB_TOKEN` | Compatibility alias for the GitLab token. |
| `GITLAB_API_URL` | GitLab API v4 base URL; defaults to `https://gitlab.com/api/v4`. |
| `GITLAB_PROJECT_ID` | Project ID; the CLI flag remains available. |
| `GITLAB_MERGE_REQUEST_ID` | Merge-request IID; the CLI flag remains available. |
| `OPENAI_API_KEY` | Preferred OpenAI-compatible provider key. Comma-separated keys are supported by the OpenAI provider. |
| `OPENAI_ACCESS_TOKEN` | Compatibility alias for the OpenAI provider key. |
| `OPENAI_API_URL` | OpenAI-compatible API base URL; defaults to `https://api.openai.com/v1`. |
| `OPENAI_ORGANIZATION_ID` | Optional OpenAI organization identifier when supported by the endpoint. |
| `GEMINI_API_KEY` | Preferred Gemini API key when `--mode gemini` is selected. |
| `GEMINI_ACCESS_TOKEN` | Compatibility alias for the Gemini key. |
| `GEMINI_API_URL` | Gemini API base URL when `--mode gemini` is selected. |
| `OPENAI_MODEL` | OpenAI-compatible model identifier. |
| `GEMINI_MODEL` | Gemini model identifier. |
| `CUSTOM_MODEL` / `MODEL` | General model compatibility overrides. |

The precedence for provider credentials is the provider-specific environment variable, then its compatibility alias, then the legacy CLI flag. For non-secret settings, environment variables also take precedence over corresponding flags. See [`.env.example`](.env.example) for names without real credentials.

Use a project or group access token instead of a personal token where possible. Grant only the project access and API scope needed to read merge-request data and create review notes. A read-only workflow can use a read API scope; grant broader API access only when comment creation requires it. Rotate and revoke tokens after suspected exposure, update protected/masked variables, and avoid temporary credentials in source control or logs. See [`SECURITY.md`](SECURITY.md).

## Model configuration

Model selection is configurable; no model should be assumed to be available on every account or compatible endpoint.

- Use `OPENAI_MODEL` for OpenAI-compatible mode and `GEMINI_MODEL` for Gemini mode.
- `MODEL` and `CUSTOM_MODEL` are general environment overrides.
- `--custom-model` remains available for CLI compatibility.
- Environment values take precedence over `--custom-model`.
- The packaged OpenAI fallback is defined in [`src/openai-config.ts`](src/openai-config.ts), in one place. Set an explicit model for a deployment that uses a different model name.
- The OpenAI provider uses the installed SDK's Responses API and can send an optional organization identifier. A compatible endpoint must support the request and response shape expected by that SDK.

Model availability, pricing, retention, regional handling, and safety behavior are controlled by the selected provider or endpoint. Verify those terms before sending proprietary code.

## Privacy and data handling

The CLI retrieves merge-request metadata, changed-file diffs, and existing discussions from GitLab. It sends review prompts and the diff content being reviewed to the configured model provider. It posts accepted review text back to GitLab as an inline discussion or summary comment. The current CLI does not perform a full-repository upload or local code execution as part of review.

Do not send confidential source code to a provider unless your organization has approved that provider and its data-handling terms. The tool cannot control provider retention or human-access policies. Use an approved OpenAI-compatible/self-hosted endpoint when required, protect CI variables, and review generated comments before relying on them.

## Limitations

- Reviews are probabilistic model output. The tool does not guarantee that it will find, classify, or correctly prioritize bugs or security issues.
- The normal review input is the merge-request diff, not the complete repository, build environment, dependency graph, runtime configuration, or deployment context.
- Very large diffs are bounded and marked as truncated. Binary or unavailable diffs do not receive normal inline AI review; deleted, renamed, and truncated changes may be handled through a summary path.
- Inline placement depends on GitLab diff references and valid changed-line positions. If placement fails, the integration falls back to a summary when possible.
- The tool does not replace tests, code owners, static analysis, dependency scanning, secret scanning, dynamic testing, threat modeling, or human security review.
- Security profiles suppress responses that are malformed, lack direct diff evidence, or contain disallowed attack instructions. Suppression can also hide a real issue when the diff lacks enough context.
- WordPress analysis cannot establish behavior in unchanged files, runtime hook registration, plugin configuration, WordPress version differences, external services, or payment/membership systems unless the diff provides that evidence.

The complete limitation and fallback description is in [`docs/limitations.md`](docs/limitations.md).

## Responsible use

Use this project only on repositories and GitLab projects you are authorized to review. Treat generated output as a lead for human investigation, not as a final security decision. Do not use the security profiles to attack live systems or to generate exploit instructions. Redact sensitive code and credentials from bug reports and diagnostic output. For suspected vulnerabilities in this project, follow [`SECURITY.md`](SECURITY.md) rather than opening a public issue.

## Development commands

From a source checkout:

```bash
npm ci
npm run build       # emit compiled JavaScript to lib/
npm run typecheck   # strict TypeScript check including tests
npm run lint        # ESLint for source, tests, and bin/
npm test            # Vitest unit tests with mocked integrations
git diff --check
```

Tests do not require access to a real GitLab instance or model provider. Keep API keys and tokens out of fixtures and test output.

## Migration notes from the previous CLI

Existing public flags remain available:

```text
-g/--gitlab-api-url       -t/--gitlab-access-token
-o/--openai-api-url       -a/--openai-access-token
-p/--project-id           -m/--merge-request-id
-org/--organization-id    -c/--custom-model
-mode/--mode
```

The migration path is:

1. Move `-t`/`--gitlab-access-token` to `GITLAB_ACCESS_TOKEN`.
2. Move `-a`/`--openai-access-token` to `OPENAI_API_KEY` or `GEMINI_API_KEY`.
3. Keep non-secret flags or move project, merge-request, endpoint, and model settings to their documented environment variables.
4. Expect a deprecation warning if a legacy secret flag is still used; the flags are not removed in this compatibility period.
5. Keep `standard` as the default. Add `--review-profile security` or `--review-profile wordpress-security` only when defensive security assistance is wanted.

The OpenAI integration now uses the modern provider implementation and configurable model/base URL settings. The GitLab integration also handles paginated changes and discussions, duplicate prevention, bounded retries, and summary fallback; these changes do not add new required public flags.

## Contributing and security

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the development workflow and [`SECURITY.md`](SECURITY.md) for private vulnerability reporting.

## License

MIT. See [`LICENSE`](LICENSE).
