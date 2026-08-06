import { DEFAULT_OPENAI_MODEL } from './openai-config';
import { parseAllowPrivateApiUrls } from './api-url';

export const DEFAULT_GITLAB_API_URL = 'https://gitlab.com/api/v4';
export const DEFAULT_OPENAI_API_URL = 'https://api.openai.com/v1';

export interface ResolvedReviewConfig {
    gitlabApiUrl: string;
    gitlabAccessToken: string;
    projectId: string;
    mergeRequestId: string;
    mode: string;
    reviewProfile: string;
    providerApiUrl: string;
    providerAccessToken: string;
    allowPrivateApiUrls?: boolean;
    organizationId?: string;
    customModel: string;
}

export const resolveReviewConfig = (
    options: Readonly<Record<string, unknown>>,
    environment: NodeJS.ProcessEnv = process.env,
): ResolvedReviewConfig => {
    const mode = firstNonEmpty(readOption(options, 'mode')) ?? 'openai';
    const isGemini = mode === 'gemini';
    const providerApiUrl = firstNonEmpty(
        isGemini ? environment.GEMINI_API_URL : undefined,
        environment.OPENAI_API_URL,
        readOption(options, 'openaiApiUrl'),
        DEFAULT_OPENAI_API_URL,
    )!;
    const providerAccessToken = firstNonEmpty(
        ...(isGemini
            ? [
                environment.GEMINI_API_KEY,
                environment.GEMINI_ACCESS_TOKEN,
                environment.OPENAI_API_KEY,
                environment.OPENAI_ACCESS_TOKEN,
            ]
            : [environment.OPENAI_API_KEY, environment.OPENAI_ACCESS_TOKEN]),
        readOption(options, 'openaiAccessToken'),
    ) ?? '';

    return {
        gitlabApiUrl: firstNonEmpty(
            environment.GITLAB_API_URL,
            readOption(options, 'gitlabApiUrl'),
            DEFAULT_GITLAB_API_URL,
        )!,
        gitlabAccessToken: firstNonEmpty(
            environment.GITLAB_ACCESS_TOKEN,
            environment.GITLAB_TOKEN,
            readOption(options, 'gitlabAccessToken'),
        ) ?? '',
        projectId: firstNonEmpty(
            environment.GITLAB_PROJECT_ID,
            readOption(options, 'projectId'),
        ) ?? '',
        mergeRequestId: firstNonEmpty(
            environment.GITLAB_MERGE_REQUEST_ID,
            readOption(options, 'mergeRequestId'),
        ) ?? '',
        mode,
        reviewProfile: firstNonEmpty(readOption(options, 'reviewProfile')) ?? 'standard',
        providerApiUrl,
        providerAccessToken,
        allowPrivateApiUrls: parseAllowPrivateApiUrls(environment.ALLOW_PRIVATE_API_URLS),
        ...(firstNonEmpty(
            environment.OPENAI_ORGANIZATION_ID,
            readOption(options, 'organizationId'),
        )
            ? {
                organizationId: firstNonEmpty(
                    environment.OPENAI_ORGANIZATION_ID,
                    readOption(options, 'organizationId'),
                ),
            }
            : {}),
        customModel: firstNonEmpty(
            isGemini ? environment.GEMINI_MODEL : environment.OPENAI_MODEL,
            environment.MODEL,
            environment.CUSTOM_MODEL,
            readOption(options, 'customModel'),
            DEFAULT_OPENAI_MODEL,
        )!,
    };
};

export const warnAboutLegacySecretFlags = (
    argv: readonly string[],
    warn: (message: string) => void = console.warn,
): void => {
    if (hasFlag(argv, '--gitlab-access-token', '-t')) {
        warn('Warning: --gitlab-access-token/-t is deprecated. Prefer the protected, masked GITLAB_ACCESS_TOKEN environment variable.');
    }

    if (hasFlag(argv, '--openai-access-token', '-a')) {
        warn('Warning: --openai-access-token/-a is deprecated. Prefer OPENAI_API_KEY or GEMINI_API_KEY environment variables.');
    }
};

export const getSafeErrorMessage = (error: unknown, secrets: readonly string[] = []): string => {
    if (!(error instanceof Error)) {
        return 'Review operation failed unexpectedly.';
    }

    return redactSensitiveText(error.message, secrets);
};

export const redactSensitiveText = (value: string, secrets: readonly string[] = []): string => {
    const withKnownSecretsRedacted = secrets.reduce((redacted, secret) => {
        const normalizedSecret = secret.trim();
        return normalizedSecret ? redacted.split(normalizedSecret).join('[REDACTED]') : redacted;
    }, value);

    return withKnownSecretsRedacted
        .replace(/(bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
        .replace(/([?&](?:key|api[_-]?key|access[_-]?token|token)=)[^&\s]+/gi, '$1[REDACTED]')
        .replace(/((?:authorization|private-token|api-key|api[_-]?key|access-token|token|key)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]')
        .replace(/\b(?:sk-[A-Za-z0-9_-]+|glpat-[A-Za-z0-9_-]+)\b/g, '[REDACTED]');
};

const firstNonEmpty = (...values: unknown[]): string | undefined => {
    for (const value of values) {
        const stringValue = toConfigString(value);
        if (stringValue) {
            return stringValue;
        }
    }

    return undefined;
};

const readOption = (options: Readonly<Record<string, unknown>>, name: string): unknown => options[name];

const toConfigString = (value: unknown): string | undefined => {
    if (typeof value !== 'string' && typeof value !== 'number') {
        return undefined;
    }

    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : undefined;
};

const hasFlag = (argv: readonly string[], longFlag: string, shortFlag: string): boolean => {
    return argv.some((argument) => {
        return argument === longFlag || argument.startsWith(`${longFlag}=`) ||
            argument === shortFlag || argument.startsWith(`${shortFlag}=`);
    });
};
