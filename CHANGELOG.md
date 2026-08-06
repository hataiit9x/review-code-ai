# Changelog

All notable user-visible changes are recorded here. The current modernization work is grouped under `Unreleased` until a release is intentionally published.

## [Unreleased]

### Added

- Strict TypeScript build, typecheck, lint, and Vitest test commands.
- A common review request/result contract with separate OpenAI and Gemini provider implementations.
- Configurable OpenAI-compatible base URL, model, organization settings where supported, request timeout, bounded retries, and `Retry-After` handling.
- Opt-in `security` and `wordpress-security` review profiles with structured, evidence-backed finding validation.
- GitLab change/discussion pagination, deleted/renamed/binary/truncated diff handling, duplicate prevention, line-position mapping, and summary fallback when inline placement is unavailable.
- Environment-first credential configuration and a secret-free `.env.example` reference.
- GitHub issue templates and release/security documentation.

### Changed

- `standard` remains the default review profile and existing public CLI flags remain available where practical.
- Legacy `--gitlab-access-token`/`-t` and `--openai-access-token`/`-a` flags are deprecated in favor of protected/masked environment variables.
- Provider and GitLab failures are mapped to user-facing messages without exposing authorization headers, configured tokens, or sensitive request content.

### Security

- Security prompts treat repository content as untrusted data and reject findings without direct diff evidence.
- WordPress findings require code-path evidence and report `insufficient evidence` rather than guessing an attacker role.
- Security profiles do not generate exploit payloads or live-system attack instructions.

### Documentation

- Added architecture, security model, limitations, contributing, and vulnerability-reporting guidance.
- Added migration notes from the previous flag-based CLI configuration.
