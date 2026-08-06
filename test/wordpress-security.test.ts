import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getReviewPrompts } from '../src/prompts';
import { formatSecurityFindings, parseSecurityReview } from '../src/security-review';
import type { ReviewRequest } from '../src/types';

const fixture = (name: string): string => {
    return readFileSync(resolve(__dirname, 'fixtures', 'wordpress', name), 'utf8');
};

const vulnerableSource = fixture('vulnerable-example.php');
const safeSource = fixture('safe-example.php');

const vulnerableRequest: ReviewRequest = {
    profile: 'wordpress-security',
    filePath: 'vulnerable-example.php',
    line: 12,
    diff: vulnerableSource,
};

const vulnerableFinding = (overrides: Record<string, unknown> = {}): string => JSON.stringify({
    findings: [{
        title: 'Public REST route allows membership state changes without authorization',
        severity: 'high',
        confidence: 'high',
        cwe: 'CWE-862',
        file_path: 'vulnerable-example.php',
        location: 'line 16',
        code_path_evidence: "register_rest_route('membership/v1', '/status', [",
        direct_code_evidence: "'permission_callback' => '__return_true'",
        confirmed_evidence: 'The registered route delegates access control to a callback that always returns true.',
        assumptions: 'The callback updates membership state as shown by the adjacent route code.',
        minimum_attacker_role: 'unauthenticated visitor',
        attacker_role_evidence: "'permission_callback' => '__return_true'",
        security_impact: 'A request without an authenticated WordPress session may reach the membership route.',
        remediation: 'Require an appropriate permission_callback using current_user_can and validate the requested state transition.',
        suggested_defensive_regression_test: 'Add an endpoint test that denies unauthenticated requests and unauthorized state changes.',
        ...overrides,
    }],
});

describe('WordPress security fixtures', () => {
    it('contains safe examples with code-path protections', () => {
        expect(safeSource).toContain("check_ajax_referer('save_membership', 'nonce')");
        expect(safeSource).toContain("current_user_can('manage_options')");
        expect(safeSource).toContain("'permission_callback' => static function");
        expect(safeSource).toContain('sanitize_key(wp_unslash');
        expect(safeSource).not.toContain("'permission_callback' => '__return_true'");
    });

    it('contains vulnerable examples for authorization, SQL, and upload regression coverage', () => {
        expect(vulnerableSource).toContain('wp_ajax_nopriv_update_membership');
        expect(vulnerableSource).toContain("'permission_callback' => '__return_true'");
        expect(vulnerableSource).toContain('$wpdb->query');
        expect(vulnerableSource).toContain('move_uploaded_file');
    });
});

describe('WordPress security parsing', () => {
    it('accepts a finding only when the WordPress code path and evidence are present', () => {
        const findings = parseSecurityReview(vulnerableFinding(), vulnerableRequest);

        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            cwe: 'CWE-862',
            codePathEvidence: "register_rest_route('membership/v1', '/status', [",
            directCodeEvidence: "'permission_callback' => '__return_true'",
            minimumAttackerRole: 'unauthenticated visitor',
        });

        const formatted = formatSecurityFindings(findings, 'wordpress-security');
        expect(formatted).toContain('WordPress defensive security review');
        expect(formatted).toContain('Code-path evidence');
        expect(formatted).toContain('**Minimum plausible attacker role:** unauthenticated visitor');
    });

    it('rejects a function-name-only claim even when the function appears in the diff', () => {
        const functionNameOnly = vulnerableFinding({
            code_path_evidence: 'register_rest_route',
            minimum_attacker_role: 'insufficient evidence',
        });

        expect(parseSecurityReview(functionNameOnly, vulnerableRequest)).toEqual([]);
    });

    it('downgrades unsupported attacker-role claims to insufficient evidence', () => {
        const unsupportedRole = vulnerableFinding({
            minimum_attacker_role: 'authenticated administrator',
            attacker_role_evidence: undefined,
        });
        const findings = parseSecurityReview(unsupportedRole, vulnerableRequest);

        expect(findings).toHaveLength(1);
        expect(findings[0]?.minimumAttackerRole).toBe('insufficient evidence');
        expect(findings[0]?.attackerRoleEvidence).toBeUndefined();
    });
});

describe('WordPress security prompts', () => {
    it('prioritizes WordPress boundaries and states its evidence limitations', () => {
        const prompts = getReviewPrompts(vulnerableRequest);

        expect(prompts.system).toContain('Do not claim a vulnerability merely because a WordPress function');
        expect(prompts.instructions).toContain('permission_callback');
        expect(prompts.instructions).toContain('current_user_can');
        expect(prompts.instructions).toContain('$wpdb');
        expect(prompts.instructions).toContain('insufficient evidence');
        expect(prompts.instructions).toContain('WordPress secure coding conventions');
        expect(prompts.input).toContain('wp_ajax_nopriv_update_membership');
    });
});
