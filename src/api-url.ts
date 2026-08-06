import { isIP } from 'node:net';

export interface ApiUrlValidationOptions {
    allowPrivateHosts?: boolean;
}

/**
 * Validate an operator-supplied API endpoint before credentials are attached.
 * Private/local destinations require an explicit opt-in for trusted
 * self-hosted deployments.
 */
export const validateApiBaseUrl = (
    value: string | undefined,
    label: string,
    options: ApiUrlValidationOptions = {},
): string => {
    const trimmed = value?.trim() ?? '';
    if (!trimmed) {
        throw new Error(`${label} URL is required.`);
    }

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new Error(`${label} URL must be a valid HTTP(S) URL.`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`${label} URL must be a valid HTTP(S) URL.`);
    }

    if (parsed.username || parsed.password) {
        throw new Error(`${label} URL must not contain embedded credentials.`);
    }

    if (parsed.search || parsed.hash) {
        throw new Error(`${label} URL must not contain query parameters or fragments.`);
    }

    if (!options.allowPrivateHosts && isPrivateOrLocalHost(parsed.hostname)) {
        throw new Error(
            `${label} URL must not target a local or private host unless ALLOW_PRIVATE_API_URLS is enabled.`,
        );
    }

    return parsed.toString().replace(/\/+$/, '');
};

export const parseAllowPrivateApiUrls = (value: unknown): boolean => {
    if (typeof value !== 'string') {
        return false;
    }

    return ['1', 'true', 'yes'].includes(value.trim().toLowerCase());
};

const isPrivateOrLocalHost = (hostname: string): boolean => {
    const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');

    if (
        normalized === 'localhost' ||
        normalized.endsWith('.localhost') ||
        normalized.endsWith('.local') ||
        normalized.endsWith('.internal') ||
        normalized === 'metadata.google.internal'
    ) {
        return true;
    }

    const ipVersion = isIP(normalized);
    if (ipVersion === 4) {
        return isPrivateIpv4(normalized);
    }

    if (ipVersion === 6) {
        return isPrivateIpv6(normalized);
    }

    return false;
};

const isPrivateIpv4 = (value: string): boolean => {
    const octets = value.split('.').map(Number);
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
        return false;
    }

    const first = octets[0] ?? -1;
    const second = octets[1] ?? -1;
    return (
        first === 0 ||
        first === 10 ||
        first === 127 ||
        (first === 100 && second >= 64 && second <= 127) ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168) ||
        (first === 198 && second >= 18 && second <= 19)
    );
};

const isPrivateIpv6 = (value: string): boolean => {
    return (
        value === '::' ||
        value === '::1' ||
        value.startsWith('fc') ||
        value.startsWith('fd') ||
        /^fe[89ab]/i.test(value) ||
        value.startsWith('::ffff:')
    );
};
