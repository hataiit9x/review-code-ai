# AGENTS.md

## Project purpose

This repository provides an open-source TypeScript CLI that reviews GitLab
merge requests using OpenAI-compatible or Gemini model APIs.

## Goals for this modernization

- Preserve existing GitLab merge request review behavior.
- Improve security, maintainability, typing, testing, and documentation.
- Replace obsolete model assumptions with configurable modern defaults.
- Never hard-code credentials, tokens, organization IDs, or repository secrets.
- Keep OpenAI and Gemini provider logic separated behind clear interfaces.
- Add evidence-based security review support without claiming guaranteed
  vulnerability detection.
- Maintain backward compatibility where practical.

## Engineering rules

- Use TypeScript strict mode.
- Avoid `any` unless justified in a comment.
- Validate all CLI arguments and external API responses.
- Never print API keys or GitLab tokens.
- Redact authorization headers and secrets from errors and logs.
- Add tests for changed behavior.
- Do not delete user-facing features without explaining the migration.
- Run build, lint, and tests before declaring work complete.
- Make small, reviewable changes.
