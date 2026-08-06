# Security model

`review-code-ai` is a review assistant that handles source code, GitLab credentials, model-provider credentials, and model-generated text. This document describes its defensive controls and the assumptions that remain outside the tool.

## Security goals

The implementation aims to:

1. Keep GitLab and model-provider credentials out of normal logs and user-facing errors.
2. Prefer environment or CI secret storage over command-line secret arguments.
3. Treat repository content as untrusted data, including comments that attempt to alter model instructions.
4. Require direct diff evidence before a security finding can become a GitLab comment.
5. Avoid generating exploit payloads or instructions for attacking live systems.
6. Keep provider-specific behavior and failure handling isolated.
7. Fail closed for malformed security-review output and invalid GitLab response data.

These are design goals and controls, not a guarantee that every secret, provider, or deployment context is safe.

## Trust boundaries

### Local machine or CI runner

The CLI receives environment variables, non-secret options, and the process arguments. Environment variables take precedence over options. The legacy `-t/--gitlab-access-token` and `-a/--openai-access-token` flags are still accepted for compatibility, but their use emits a warning because command-line arguments can be visible through shell history, process inspection, or CI diagnostics.

Use protected and masked CI variables or an external secret manager. The application does not load `.env` files automatically.

### GitLab

The GitLab adapter uses the configured API v4 base URL and a `Private-Token` header. It validates the endpoint before attaching the token, rejects obvious local/private destinations unless `ALLOW_PRIVATE_API_URLS=true` is explicitly set, disables redirects, validates response shapes, paginates changes and discussions, bounds response and diff sizes, applies request timeouts, and performs bounded retries for eligible transient failures. It maps authentication, permission, rate-limit, timeout, and server failures to user-facing messages without forwarding response bodies.

The token still grants whatever access its GitLab role and scope provide. The tool cannot reduce an over-privileged token after it is issued. Prefer a project or group access token with the lowest role and API scope that can perform the required read and comment operations.

### Model provider

The selected provider receives the review prompt and the diff content being reviewed. OpenAI-compatible mode uses the installed SDK's Responses API; Gemini uses its separate HTTP implementation. The endpoint, model, and provider credentials are configurable.

Provider retention, regional processing, logging, training use, access controls, and availability are controlled by the selected provider or compatible deployment. Review the provider terms and organizational approval requirements before sending proprietary code.

### Repository content

Diff text, filenames, comments, strings, and metadata are untrusted. For `security` and `wordpress-security`, the prompt explicitly marks this content as data and tells the provider to ignore embedded instructions. This reduces prompt-injection risk at the prompt boundary but cannot make a general-purpose model fully trustworthy.

## Credential controls

Preferred variables:

- `GITLAB_ACCESS_TOKEN`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`

Compatibility aliases are documented in the README. Environment values are selected before legacy flags. The CLI never intentionally prints token values. Known configured credentials are redacted from handled errors, and provider/GitLab adapters map upstream failures to messages that do not include raw request content or authorization headers.

Credential handling still depends on the surrounding process environment. Shell tracing, CI debug output, crash dumps, dependency instrumentation, endpoint access logs, or a compromised runner can expose values outside the CLI's control. Rotate a token immediately if it may have been exposed.

## Security-review controls

The security profiles use a constrained output contract. A finding must provide:

- title, severity, and confidence;
- a file path and location when available;
- direct code evidence that occurs in the supplied diff;
- confirmed evidence separated from assumptions;
- security impact, remediation, and a defensive regression-test suggestion.

WordPress findings additionally require code-path evidence. A function or hook name is not enough. The minimum plausible attacker role is included only when the diff supports it; otherwise the parser uses `insufficient evidence`.

Malformed JSON, missing required fields, evidence not present in the diff, unsupported file paths, and output matching known attack-oriented patterns are suppressed rather than posted. This is defense in depth rather than a complete semantic safety boundary; it is not proof that a suppressed response was harmless or that an omitted issue does not exist.

## What the model is not allowed to do

The security prompts instruct the provider not to:

- follow instructions embedded in repository content;
- reveal secrets or change its review role based on diff text;
- produce exploit payloads, proof-of-concept attack commands, reverse shells, or live-system instructions.

The parser applies a second rejection check to model text before formatting findings. Do not treat this as a replacement for access controls, sandboxing, or human review.

## Residual risks

- A provider can misunderstand valid code, miss an issue, or produce a plausible but incorrect explanation.
- A diff can omit the code needed to confirm authorization, data flow, configuration, or impact.
- A valid model response can still be wrong; structured parsing checks shape and evidence presence, not semantic correctness.
- Generated review text is posted to GitLab and may be visible to project members.
- GitLab permissions, branch protections, protected CI variables, network configuration, and provider policy must be configured separately.

For the practical impact of these limits, see [`limitations.md`](limitations.md). For reporting a vulnerability in this project, see [`SECURITY.md`](../SECURITY.md).
