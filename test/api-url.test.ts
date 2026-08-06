import { describe, expect, it } from 'vitest';
import { parseAllowPrivateApiUrls, validateApiBaseUrl } from '../src/api-url';

describe('configured API URL validation', () => {
    it('accepts public HTTP(S) base URLs and removes trailing slashes', () => {
        expect(validateApiBaseUrl('https://gitlab.example.test/api/v4/', 'GitLab API'))
            .toBe('https://gitlab.example.test/api/v4');
    });

    it('rejects URL credentials, query strings, and non-HTTP schemes', () => {
        expect(() => validateApiBaseUrl('https://user:secret@example.test/v1', 'Provider'))
            .toThrow('must not contain embedded credentials');
        expect(() => validateApiBaseUrl('https://provider.example/v1?key=secret', 'Provider'))
            .toThrow('must not contain query parameters');
        expect(() => validateApiBaseUrl('file:///etc/passwd', 'Provider'))
            .toThrow('valid HTTP(S) URL');
    });

    it('rejects obvious local and private destinations unless explicitly enabled', () => {
        for (const value of [
            'http://127.0.0.1:8080/api',
            'http://169.254.169.254/latest',
            'http://[::1]:8080/api',
            'https://service.internal/api',
        ]) {
            expect(() => validateApiBaseUrl(value, 'Provider')).toThrow('local or private host');
        }

        expect(validateApiBaseUrl('http://127.0.0.1:8080/api', 'Provider', { allowPrivateHosts: true }))
            .toBe('http://127.0.0.1:8080/api');
    });

    it('parses the private-endpoint opt-in conservatively', () => {
        expect(parseAllowPrivateApiUrls('true')).toBe(true);
        expect(parseAllowPrivateApiUrls(' YES ')).toBe(true);
        expect(parseAllowPrivateApiUrls('false')).toBe(false);
        expect(parseAllowPrivateApiUrls(undefined)).toBe(false);
    });
});
