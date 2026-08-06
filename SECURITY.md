# Security policy

## Reporting a vulnerability

Please do not disclose a suspected vulnerability in a public GitHub issue, merge request, or discussion. Use GitHub's private vulnerability reporting for this repository:

<https://github.com/hataiit9x/review-code-ai/security/advisories/new>

If private reporting is unavailable, contact the repository maintainers through a private channel associated with the repository owner and provide only the minimum information needed to establish contact. Do not include credentials, personal data, or live-system access details in a public fallback report.

Please include, when safe:

- affected package version or commit;
- affected component and configuration;
- a concise description of the security impact;
- a minimal reproduction or static evidence that does not target a live system;
- relevant logs with tokens, authorization headers, source secrets, and private code removed;
- any suggested mitigation or rotation step.

If a GitLab, OpenAI-compatible, or Gemini credential may have been exposed, revoke or rotate it first and report only the redacted circumstances.

There is currently no formal response-time or supported-version SLA. The project will assess reports against the current default branch and the version/commit supplied by the reporter.

## Security design

The project includes defensive controls described in [`docs/security-model.md`](docs/security-model.md):

- environment-first credential configuration and deprecation warnings for secret flags;
- redaction of known credentials and authorization-style values from handled errors;
- validation of GitLab and provider responses;
- bounded request timeouts, retries, and rate-limit handling;
- prompt-injection resistance for untrusted repository content in security profiles;
- structured security finding validation requiring direct diff evidence;
- suppression of malformed findings and attack-oriented output.

These controls reduce risk but do not protect a compromised runner, over-privileged token, untrusted model endpoint, or provider with unsuitable data-handling practices.

## Scope

Security reports are appropriate for the CLI, compiled entrypoint, GitLab integration, provider integrations, credential handling, output validation, and release artifacts maintained by this repository. Reports about a third-party GitLab instance, model provider, dependency, or deployment should be sent to that operator as well.

## Safe testing

Use local fixtures, mocked HTTP responses, and isolated test projects. Do not send exploit payloads to live systems, test credentials belonging to someone else, or include unredacted secrets in issue trackers, logs, or pull requests.
