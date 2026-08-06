# Limitations

This project is intentionally a small diff-review assistant. The following limits should be considered before treating its output as a release, security, or compliance decision.

## Review coverage

- The normal input is the merge-request diff and related GitLab metadata. The tool does not automatically obtain the complete repository, all historical versions, dependency manifests, build artifacts, runtime configuration, or deployment state.
- Review quality depends on the selected model, prompt interpretation, supplied context, and provider response. No profile guarantees detection, severity accuracy, exploitability, or absence of vulnerabilities.
- The tool does not compile or execute the reviewed code. It does not replace unit tests, integration tests, static analysis, dependency scanning, secret scanning, dynamic analysis, threat modeling, or manual review.
- External systems such as identity providers, payment processors, membership services, queues, storage, and deployment platforms are not verified unless their relevant behavior is directly represented in the supplied diff.

## Diff and GitLab behavior

- Merge-request changes and discussions are paginated, but the integration applies safe page and request bounds. An unusual or malformed GitLab response can stop processing with a user-facing error.
- Individual diff content is bounded at `100,000` characters and marked as truncated. A truncated change is reviewed through a summary path with an explicit warning rather than treated as complete context.
- Binary and unavailable diffs do not receive normal inline AI review. Deleted, renamed, and some truncated changes are handled through a summary path; a summary may still lack enough content for a meaningful review.
- Inline comments require a valid changed-line position and GitLab diff references. When a position is unavailable or GitLab rejects it, the integration attempts a summary comment. A summary fallback is not equivalent to a line-accurate review.
- Existing discussions are read to reduce duplicates, but duplicate prevention is based on the available path, line, and comment content. It cannot account for semantically equivalent comments written differently or comments created concurrently by another process.
- Permission failures, rate limits, unavailable endpoints, and network failures can prevent comments from being posted. Bounded retries do not guarantee delivery.

## Provider behavior

- OpenAI-compatible mode sends requests through the installed OpenAI SDK's Responses API. A compatible base URL must support the expected endpoint, request fields, authentication, and response shape; compatibility is not guaranteed merely because an endpoint uses the OpenAI name.
- Gemini uses a separate provider implementation and has different endpoint, model, response, and policy behavior. Test the chosen provider and model in the intended environment.
- Model names are not validated against every provider before a request. An unavailable model results in a provider error rather than an automatic substitution.
- Timeouts and bounded retries reduce hanging requests and repeated transient work, but they do not solve provider outages or guarantee exactly-once behavior at the network boundary.
- Provider policies determine data retention, regional processing, logging, and access. The CLI cannot enforce those policies.

## Security profiles

- `security` and `wordpress-security` are opt-in defensive profiles. `standard` remains the default.
- Security findings are emitted only when the response is valid and contains direct evidence from the supplied diff. This can suppress useful leads when the diff is incomplete, the model cites an equivalent but differently formatted excerpt, or the response is malformed.
- Evidence validation checks whether text is present in the diff; it does not prove that the code is reachable, exploitable, or semantically unsafe.
- The security profiles do not run exploit attempts, interact with live systems, or establish a full attack path outside the changed code.
- Prompt-injection resistance is implemented through trusted instructions, untrusted-data framing, and output filtering. It reduces a known class of model manipulation but cannot guarantee that a provider will ignore every adversarial string.

### WordPress-specific limits

The WordPress profile prioritizes common security boundaries but cannot infer runtime behavior from a function or hook name. It requires code-path evidence for reported findings and reports `insufficient evidence` when a minimum attacker role is not supported. It cannot reliably determine:

- whether a hook is registered or reachable elsewhere;
- the effective WordPress/plugin/theme configuration;
- capability assignments and authentication state in deployment;
- behavior supplied by unchanged files or third-party plugins;
- WordPress version-specific semantics;
- payment, membership, or entitlement state maintained by external systems.

## Operational and privacy limits

- Credentials are safest in protected/masked environment variables, but the shell, CI runner, operating system, provider endpoint, and GitLab can have independent logging or access paths.
- Review prompts and diff content are sent to the configured model provider. Do not use an unapproved provider for confidential code.
- Generated comments can be wrong, incomplete, or inappropriate for the repository. Require normal code-owner and security-review processes before merging based on them.
- The project does not currently publish a formal support matrix or availability SLA. Record the exact package version, commit, provider, model, and profile when reporting a problem.
