# @hataiit9x/review-code-ai

![Preview](preview.png)

A CLI tool for automated code review on GitLab Merge Requests using AI (OpenAI or Google Gemini).

## Features

- 🤖 Support for OpenAI and Google Gemini as AI backends
- 🛠️ Configurable GitLab API URL (supports self-hosted instances)
- ⚙️ Load balancing across multiple API keys (comma-separated)
- � DSesigned for CI/CD pipeline integration
- 🚦 Automatic retry on rate limit (429 errors)
- 💬 Posts review comments directly on the MR at relevant code locations

## Installation

```bash
npm install -g @hataiit9x/review-code-ai
```

## Usage

### CLI Options

```
Usage: review-code-ai [options]

Options:
  -g, --gitlab-api-url <string>       GitLab API URL (default: "https://gitlab.com/api/v4")
  -t, --gitlab-access-token <string>  GitLab Access Token (deprecated; prefer environment variables)
  -o, --openai-api-url <string>       OpenAI/Gemini API URL (default: "https://api.openai.com/v1")
  -a, --openai-access-token <string>  API Access Token (deprecated; prefer environment variables)
  -p, --project-id <number>           GitLab Project ID
  -m, --merge-request-id <string>     GitLab Merge Request ID
  -org, --organization-id <string>    OpenAI Organization ID (optional)
  -c, --custom-model <string>         Custom Model ID (default: "gpt-5.6-terra")
  -mode, --mode <string>              AI mode: "openai" or "gemini" (default: "openai")
  --review-profile <profile>          Review profile: "standard", "security", or "wordpress-security" (default: "standard")
  -h, --help                          Display help
```

### Defensive security profile

Use `--review-profile security` for evidence-based source-code security assistance. The profile reports only findings supported by direct code evidence and separates confirmed evidence from assumptions. It does not generate exploit payloads or instructions for attacking live systems.

The default `standard` profile remains unchanged. Security findings are defensive assistance and require human security review; they are not a replacement for that review.

### Credentials and environment variables

Environment variables take precedence over command-line values. The legacy secret flags remain available for compatibility, but `--gitlab-access-token/-t` and `--openai-access-token/-a` are deprecated and produce a startup warning. Secret values are not included in warnings or error messages.

Preferred variables are:

- `GITLAB_ACCESS_TOKEN` - GitLab token used to read merge request data and post review comments
- `OPENAI_API_KEY` - OpenAI-compatible provider key; comma-separated keys remain supported for compatibility
- `GEMINI_API_KEY` - Gemini key when `--mode gemini` is selected

The following non-secret variables are also supported: `GITLAB_API_URL`, `GITLAB_PROJECT_ID`, `GITLAB_MERGE_REQUEST_ID`, `OPENAI_API_URL`, `OPENAI_MODEL`, `GEMINI_API_URL`, `GEMINI_MODEL`, and `OPENAI_ORGANIZATION_ID`. Compatibility aliases include `GITLAB_TOKEN`, `OPENAI_ACCESS_TOKEN`, and `GEMINI_ACCESS_TOKEN`. Set `CUSTOM_MODEL` or `MODEL` when a provider-specific model variable is not suitable.

For GitLab CI, define secret variables in the project or group settings as both **Protected** and **Masked**. Keep tokens out of `.gitlab-ci.yml`, shell history, and command arguments.

### WordPress defensive security profile

Use `--review-profile wordpress-security` to prioritize WordPress AJAX and REST authorization, admin handlers, capabilities, nonces, input/output boundaries, `$wpdb` queries, uploads and filesystem operations, and payment or membership integrity paths. It requires code-path evidence and does not report an issue merely because a function or hook name appears.

The profile names a minimum plausible attacker role only when the changed code supports it; otherwise it reports `insufficient evidence`. Limitations include incomplete diffs, behavior in unchanged files, runtime hook registration, WordPress/plugin configuration, version-specific behavior, and external payment or membership systems. Results are defensive assistance and require human review and targeted testing.

### Example

```bash
# Preferred: export credentials in the environment, not on the command line.
export GITLAB_ACCESS_TOKEN='your-gitlab-token'
export OPENAI_API_KEY='your-openai-key'

# Using OpenAI
review-code-ai \
  -p 432288 \
  -m 8

# Using Gemini
export GEMINI_API_KEY='your-gemini-key'
review-code-ai \
  -o https://generativelanguage.googleapis.com \
  -c gemini-1.5-flash-latest \
  -mode gemini \
  -p 432288 \
  -m 8
```

### GitLab CI/CD Integration

Add the following to your `.gitlab-ci.yml`:

```yaml
stages:
  - review

code-review:
  stage: review
  image: node:18
  script:
    - npm install -g @hataiit9x/review-code-ai
    - review-code-ai -c "$CUSTOM_MODEL" -p "$CI_MERGE_REQUEST_PROJECT_ID" -m "$CI_MERGE_REQUEST_IID"
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

Configure these CI/CD variables in GitLab project/group settings; mark secret variables as **Protected** and **Masked**:

- `GITLAB_ACCESS_TOKEN` - GitLab token with only the project/group access and API scope needed by this job
- `OPENAI_API_KEY` or `GEMINI_API_KEY` - the selected model provider key
- `CUSTOM_MODEL` - (Optional) Model ID to use

### Rotation and least privilege

Use a project or group access token instead of a personal token where possible. Grant the lowest role that can read merge request diffs and create notes for this job. A read-only review workflow can use a read API scope; grant the broader API scope only when posting comments requires it. Avoid owner-level or unrelated repository permissions.

Rotate credentials on a regular schedule and immediately after suspected exposure. Revoke the old token, create the replacement, update the protected/masked CI variable, verify one pipeline, and then remove any temporary overlap. Do not put replacement values in source control, issue comments, debug logs, or command-line arguments.

## Contributing

Welcome to contribute code, ask questions and suggestions! 👏

## License

MIT

---

This README was written by Kiro
