import type { ReviewRequest } from './types';

export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low' | 'informational';
export type SecurityConfidence = 'high' | 'medium' | 'low';

export interface SecurityFinding {
    title: string;
    severity: SecuritySeverity;
    confidence: SecurityConfidence;
    cwe?: string;
    filePath: string;
    location?: string;
    directCodeEvidence: string;
    confirmedEvidence: string;
    assumptions: string;
    securityImpact: string;
    remediation: string;
    suggestedDefensiveRegressionTest: string;
}

const SECURITY_SEVERITIES: readonly SecuritySeverity[] = [
    'critical',
    'high',
    'medium',
    'low',
    'informational',
];

const SECURITY_CONFIDENCES: readonly SecurityConfidence[] = ['high', 'medium', 'low'];

const UNSAFE_ATTACK_PATTERNS: readonly RegExp[] = [
    /\b(?:exploit payload|proof[- ]of[- ]concept|reverse shell|bind shell)\b/i,
    /\b(?:sqlmap|metasploit|nmap)\b/i,
    /\b(?:run|execute|send|post)\s+(?:this|the)\s+(?:payload|exploit|attack)\b/i,
    /\b(?:curl|wget)\b[^\r\n]*https?:\/\//i,
];

/**
 * Parse and validate the constrained JSON contract used by security mode.
 * Invalid findings are discarded so unsupported model output cannot become a
 * GitLab comment.
 */
export const parseSecurityReview = (responseText: unknown, request: ReviewRequest): SecurityFinding[] => {
    const parsed = parseJson(responseText);
    if (!isRecord(parsed) || !Array.isArray(parsed.findings)) {
        return [];
    }

    const findings: SecurityFinding[] = [];
    for (const candidate of parsed.findings) {
        const finding = parseFinding(candidate, request);
        if (finding) {
            findings.push(finding);
        }
    }

    return findings;
};

export const formatSecurityFindings = (findings: SecurityFinding[]): string => {
    if (findings.length === 0) {
        return '';
    }

    const formattedFindings = findings.map((finding) => {
        const location = finding.location ? ` (${finding.location})` : '';
        const safeEvidence = finding.directCodeEvidence.replace(/```/g, '` ` `');

        return [
            `### ${toSingleLine(finding.title)}`,
            `- Severity: ${finding.severity}`,
            `- Confidence: ${finding.confidence}`,
            `- CWE: ${finding.cwe ?? 'Not established from the available evidence'}`,
            `- File: ${toSingleLine(finding.filePath)}${location}`,
            '',
            '**Direct code evidence**',
            '```text',
            safeEvidence,
            '```',
            '',
            `**Confirmed evidence:** ${finding.confirmedEvidence}`,
            `**Assumptions:** ${finding.assumptions}`,
            `**Security impact:** ${finding.securityImpact}`,
            `**Remediation:** ${finding.remediation}`,
            `**Suggested defensive regression test:** ${finding.suggestedDefensiveRegressionTest}`,
        ].join('\n');
    });

    return [
        '### Defensive security review',
        '> Defensive assistance only; findings require human security review and validation.',
        ...formattedFindings,
    ].join('\n\n');
};

const parseFinding = (candidate: unknown, request: ReviewRequest): SecurityFinding | undefined => {
    if (!isRecord(candidate)) {
        return undefined;
    }

    const title = getRequiredString(candidate.title);
    const severity = getSeverity(candidate.severity);
    const confidence = getConfidence(candidate.confidence);
    const modelFilePath = getRequiredString(candidate.file_path);
    const filePath = modelFilePath ?? request.filePath?.trim();
    const directCodeEvidence = getRequiredString(candidate.direct_code_evidence);
    const confirmedEvidence = getRequiredString(candidate.confirmed_evidence);
    const assumptions = getRequiredString(candidate.assumptions);
    const securityImpact = getRequiredString(candidate.security_impact);
    const remediation = getRequiredString(candidate.remediation);
    const suggestedDefensiveRegressionTest = getRequiredString(candidate.suggested_defensive_regression_test);

    if (
        !title ||
        !severity ||
        !confidence ||
        !filePath ||
        !directCodeEvidence ||
        !confirmedEvidence ||
        !assumptions ||
        !securityImpact ||
        !remediation ||
        !suggestedDefensiveRegressionTest
    ) {
        return undefined;
    }

    if (request.filePath && modelFilePath && modelFilePath !== request.filePath) {
        return undefined;
    }

    if (!isDirectCodeEvidence(directCodeEvidence, request.diff)) {
        return undefined;
    }

    const valuesToCheck = [
        title,
        directCodeEvidence,
        confirmedEvidence,
        assumptions,
        securityImpact,
        remediation,
        suggestedDefensiveRegressionTest,
    ];
    if (valuesToCheck.some(containsUnsafeAttackInstructions)) {
        return undefined;
    }

    const location = getLocation(candidate.location) ?? getRequestLocation(request.line);
    const cwe = getCwe(candidate.cwe);

    return {
        title,
        severity,
        confidence,
        ...(cwe ? { cwe } : {}),
        filePath,
        ...(location ? { location } : {}),
        directCodeEvidence,
        confirmedEvidence,
        assumptions,
        securityImpact,
        remediation,
        suggestedDefensiveRegressionTest,
    };
};

const parseJson = (responseText: unknown): unknown => {
    if (typeof responseText !== 'string') {
        return undefined;
    }

    const trimmed = responseText.trim();
    if (!trimmed) {
        return undefined;
    }

    const fencedJson = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim();
    const jsonText = fencedJson ?? trimmed;

    try {
        return JSON.parse(jsonText) as unknown;
    } catch {
        return undefined;
    }
};

const getRequiredString = (value: unknown): string | undefined => {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
};

const getSeverity = (value: unknown): SecuritySeverity | undefined => {
    const normalized = getRequiredString(value)?.toLowerCase();
    return normalized && SECURITY_SEVERITIES.includes(normalized as SecuritySeverity)
        ? normalized as SecuritySeverity
        : undefined;
};

const getConfidence = (value: unknown): SecurityConfidence | undefined => {
    const normalized = getRequiredString(value)?.toLowerCase();
    return normalized && SECURITY_CONFIDENCES.includes(normalized as SecurityConfidence)
        ? normalized as SecurityConfidence
        : undefined;
};

const getCwe = (value: unknown): string | undefined => {
    if (typeof value !== 'string') {
        return undefined;
    }

    const cweNumber = value.trim().match(/^CWE[-\s]?(\d+)$/i)?.[1];
    return cweNumber ? `CWE-${cweNumber}` : undefined;
};

const getLocation = (value: unknown): string | undefined => {
    if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
    }

    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return `line ${value}`;
    }

    return undefined;
};

const getRequestLocation = (line: number | undefined): string | undefined => {
    return typeof line === 'number' && Number.isInteger(line) && line > 0 ? `line ${line}` : undefined;
};

const isDirectCodeEvidence = (evidence: string, diff: string): boolean => {
    const sourceText = diff
        .split(/\r?\n/)
        .filter((line) => !line.startsWith('@@') && !line.startsWith('+++') && !line.startsWith('---'))
        .map((line) => line.startsWith('+') || line.startsWith('-') ? line.slice(1) : line)
        .join('\n');

    const normalizedEvidence = normalizeForComparison(evidence);
    return normalizedEvidence.length > 0 && normalizeForComparison(sourceText).includes(normalizedEvidence);
};

const normalizeForComparison = (value: string): string => {
    return value.replace(/```(?:text|typescript|javascript|json)?/gi, '').replace(/\s+/g, ' ').trim();
};

const containsUnsafeAttackInstructions = (value: string): boolean => {
    return UNSAFE_ATTACK_PATTERNS.some((pattern) => pattern.test(value));
};

const toSingleLine = (value: string): string => value.replace(/\s+/g, ' ').trim();

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null;
};
