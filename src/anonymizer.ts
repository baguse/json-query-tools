/**
 * PII Anonymizer & Sanitizer Engine
 * 
 * Provides offline, zero-dependency detection, masking, redaction, and
 * deterministic pseudonymization of sensitive data (credentials, tokens,
 * emails, phone numbers, credit card numbers, national IDs, and IPs).
 */

export type AnonymizerStrategy = 'mask' | 'redact' | 'synthetic' | 'hash';

export interface AnonymizerRuleOptions {
  credentials?: boolean;   // JWT, Bearer tokens, private keys, passwords, api keys
  emails?: boolean;        // Email addresses
  phones?: boolean;        // Phone numbers (international & US)
  creditCards?: boolean;   // 13-19 digit card numbers with Luhn verification
  nationalIds?: boolean;   // Social Security Numbers (###-##-####)
  ipAddresses?: boolean;   // IPv4 and IPv6 addresses
  keyNames?: boolean;      // Sensitive object key names (password, secret, token, etc.)
}

export interface AnonymizerOptions {
  strategy?: AnonymizerStrategy;
  rules?: AnonymizerRuleOptions;
  withReport?: boolean;
}

export interface AnonymizeReport {
  totalFieldsScanned: number;
  totalSanitized: number;
  countsByCategory: Record<string, number>;
  categoriesDetected: string[];
}

export interface AnonymizeResult<T = unknown> {
  data: T;
  report: AnonymizeReport;
}

const DEFAULT_RULES: Required<AnonymizerRuleOptions> = {
  credentials: true,
  emails: true,
  phones: true,
  creditCards: true,
  nationalIds: true,
  ipAddresses: true,
  keyNames: true
};

// Fast 32-bit FNV-1a hash algorithm for deterministic pseudonymization
function fnv1a(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// Luhn algorithm for valid credit card number detection
function isLuhnValid(numStr: string): boolean {
  const clean = numStr.replace(/\D/g, '');
  if (clean.length < 13 || clean.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = clean.length - 1; i >= 0; i--) {
    let digit = parseInt(clean.charAt(i), 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

// Key names that explicitly denote credentials or secrets
const CREDENTIAL_KEY_REGEX = /^(?:pass(?:word)?|passwd|secret|api_?key|auth(?:_?token)?|access_?token|refresh_?token|client_?secret|private_?key)$/i;

// Broader sensitive key names for fallback (ssn, cards)
const SENSITIVE_KEY_REGEX = /^(?:pass(?:word)?|passwd|secret|api_?key|auth(?:_?token)?|access_?token|refresh_?token|client_?secret|private_?key|ssn|social_?security|credit_?card|cvv|cvc)$/i;

// Regular expression patterns
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;
const IPV4_REGEX = /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;
const IPV6_REGEX = /\b(?:[A-Fa-f0-9]{1,4}:){7}[A-Fa-f0-9]{1,4}\b/g;
const PHONE_REGEX = /(?:\b|\+)(?:\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
const JWT_REGEX = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const BEARER_REGEX = /\bBearer\s+[A-Za-z0-9_.\-~+/]+=*\b/gi;
const PRIVATE_KEY_REGEX = /-----BEGIN[ A-Z0-9_-]*PRIVATE KEY[^-]*-----[\s\S]*?-----END[ A-Z0-9_-]*PRIVATE KEY-----/gi;
const CARD_CANDIDATE_REGEX = /\b(?:\d[ -]*?){13,19}\b/g;

/**
 * Transforms a detected email address based on strategy.
 */
function sanitizeEmail(email: string, strategy: AnonymizerStrategy): string {
  if (strategy === 'redact') return '[REDACTED_EMAIL]';
  if (strategy === 'hash') return `email_${fnv1a(email).substring(0, 8)}`;
  if (strategy === 'synthetic') {
    const hash = fnv1a(email).substring(0, 6);
    return `user_${hash}@example.com`;
  }
  // Default 'mask': j***e@domain.com
  const atIdx = email.indexOf('@');
  if (atIdx <= 1) return `*@${email.slice(atIdx + 1)}`;
  const user = email.slice(0, atIdx);
  const domain = email.slice(atIdx + 1);
  const maskedUser = user.length <= 2 
    ? `${user[0]}*` 
    : `${user[0]}${'*'.repeat(Math.min(user.length - 2, 4))}${user[user.length - 1]}`;
  return `${maskedUser}@${domain}`;
}

/**
 * Transforms a detected phone number based on strategy.
 */
function sanitizePhone(phone: string, strategy: AnonymizerStrategy): string {
  if (strategy === 'redact') return '[REDACTED_PHONE]';
  if (strategy === 'hash') return `phone_${fnv1a(phone).substring(0, 8)}`;
  if (strategy === 'synthetic') {
    const hashNum = parseInt(fnv1a(phone).substring(0, 4), 16) % 10000;
    return `+1-555-01${String(hashNum).padStart(4, '0').slice(-2)}`;
  }
  // Default 'mask': ***-***-1234
  const digits = phone.replace(/\D/g, '');
  const last4 = digits.slice(-4);
  return `***-***-${last4 || '0000'}`;
}

/**
 * Transforms a detected credit card based on strategy.
 */
function sanitizeCreditCard(card: string, strategy: AnonymizerStrategy): string {
  if (strategy === 'redact') return '[REDACTED_CARD]';
  if (strategy === 'hash') return `card_${fnv1a(card).substring(0, 8)}`;
  if (strategy === 'synthetic') return '4111-1111-1111-1111';
  // Default 'mask': ****-****-****-1234
  const digits = card.replace(/\D/g, '');
  const last4 = digits.slice(-4);
  return `****-****-****-${last4 || '0000'}`;
}

/**
 * Transforms a detected SSN based on strategy.
 */
function sanitizeSsn(ssn: string, strategy: AnonymizerStrategy): string {
  if (strategy === 'redact') return '[REDACTED_SSN]';
  if (strategy === 'hash') return `ssn_${fnv1a(ssn).substring(0, 8)}`;
  if (strategy === 'synthetic') return '999-00-0000';
  // Default 'mask': ***-**-1234
  const last4 = ssn.slice(-4);
  return `***-**-${last4}`;
}

/**
 * Transforms a detected IP address based on strategy.
 */
function sanitizeIp(ip: string, strategy: AnonymizerStrategy): string {
  if (strategy === 'redact') return '[REDACTED_IP]';
  if (strategy === 'hash') return `ip_${fnv1a(ip).substring(0, 8)}`;
  if (strategy === 'synthetic') {
    const hashByte = parseInt(fnv1a(ip).substring(0, 2), 16) % 250 + 1;
    return `10.0.0.${hashByte}`;
  }
  // Default 'mask': 192.168.*.*
  if (ip.includes('.')) {
    const parts = ip.split('.');
    return `${parts[0]}.${parts[1]}.*.*`;
  }
  return '2001:db8::*';
}

/**
 * Transforms a detected credential/secret based on strategy.
 */
function sanitizeSecret(secret: string, strategy: AnonymizerStrategy, label = 'SECRET'): string {
  if (strategy === 'redact') return `[REDACTED_${label}]`;
  if (strategy === 'hash') return `${label.toLowerCase()}_${fnv1a(secret).substring(0, 8)}`;
  if (strategy === 'synthetic') return `synth_${label.toLowerCase()}_${fnv1a(secret).substring(0, 6)}`;
  // Default 'mask'
  if (secret.length <= 8) return '********';
  return `${secret.slice(0, 3)}...[REDACTED]`;
}

/**
 * Core recursive data sanitizer.
 * Accepts either an options object or a strategy string directly (e.g. anonymize(data, 'redact')).
 * Returns sanitized data by default, or { data, report } if withReport is true.
 */
export function anonymize<T = unknown>(
  input: T,
  options: AnonymizerOptions & { withReport: true }
): AnonymizeResult<T>;
export function anonymize<T = unknown>(
  input: T,
  strategyOrOptions?: AnonymizerStrategy | AnonymizerOptions,
  ruleOverrides?: AnonymizerRuleOptions
): T;
export function anonymize<T = unknown>(
  input: T,
  strategyOrOptions?: AnonymizerStrategy | AnonymizerOptions,
  ruleOverrides?: AnonymizerRuleOptions
): T | AnonymizeResult<T> {
  const isOptionsObj = typeof strategyOrOptions === 'object' && strategyOrOptions !== null;
  const strategy: AnonymizerStrategy = isOptionsObj 
    ? (strategyOrOptions.strategy || 'mask')
    : (strategyOrOptions || 'mask');
  const withReport = isOptionsObj ? Boolean(strategyOrOptions.withReport) : false;
  const rules: Required<AnonymizerRuleOptions> = {
    ...DEFAULT_RULES,
    ...(isOptionsObj ? (strategyOrOptions.rules || {}) : {}),
    ...(ruleOverrides || {})
  };

  const report: AnonymizeReport = {
    totalFieldsScanned: 0,
    totalSanitized: 0,
    countsByCategory: {},
    categoriesDetected: []
  };

  function recordDetection(category: string) {
    report.totalSanitized++;
    report.countsByCategory[category] = (report.countsByCategory[category] || 0) + 1;
    if (!report.categoriesDetected.includes(category)) {
      report.categoriesDetected.push(category);
    }
  }

  function sanitizeString(val: string, keyName?: string): string {
    report.totalFieldsScanned++;
    let result = val;

    // 1. If keyName specifically represents a credential / secret, mask the entire value immediately
    if (rules.keyNames && keyName && CREDENTIAL_KEY_REGEX.test(keyName)) {
      if (typeof val === 'string' && val.length > 0) {
        recordDetection('Credentials & Key Names');
        return sanitizeSecret(val, strategy, 'SECRET');
      }
    }

    // 2. Private Key blocks
    if (rules.credentials && PRIVATE_KEY_REGEX.test(result)) {
      result = result.replace(PRIVATE_KEY_REGEX, () => {
        recordDetection('Private Keys');
        return sanitizeSecret('key', strategy, 'PRIVATE_KEY');
      });
    }

    // 3. JWT Tokens
    if (rules.credentials && JWT_REGEX.test(result)) {
      result = result.replace(JWT_REGEX, (jwt) => {
        recordDetection('JWT Tokens');
        if (strategy === 'mask') {
          return `${jwt.slice(0, 8)}...[REDACTED_JWT]`;
        }
        return sanitizeSecret(jwt, strategy, 'JWT');
      });
    }

    // 4. Bearer Tokens
    if (rules.credentials && BEARER_REGEX.test(result)) {
      result = result.replace(BEARER_REGEX, (bearer) => {
        recordDetection('Bearer Tokens');
        if (strategy === 'mask') {
          return `Bearer ${bearer.slice(7, 11)}...[REDACTED]`;
        }
        return sanitizeSecret(bearer, strategy, 'TOKEN');
      });
    }

    // 5. Credit Cards (with Luhn check)
    if (rules.creditCards) {
      result = result.replace(CARD_CANDIDATE_REGEX, (match) => {
        if (isLuhnValid(match)) {
          recordDetection('Credit Cards');
          return sanitizeCreditCard(match, strategy);
        }
        return match;
      });
    }

    // 6. National IDs (SSN)
    if (rules.nationalIds && SSN_REGEX.test(result)) {
      result = result.replace(SSN_REGEX, (ssn) => {
        recordDetection('National IDs (SSN)');
        return sanitizeSsn(ssn, strategy);
      });
    }

    // 7. Emails
    if (rules.emails && EMAIL_REGEX.test(result)) {
      result = result.replace(EMAIL_REGEX, (email) => {
        recordDetection('Email Addresses');
        return sanitizeEmail(email, strategy);
      });
    }

    // 8. Phone numbers
    if (rules.phones && PHONE_REGEX.test(result)) {
      result = result.replace(PHONE_REGEX, (phone) => {
        // Exclude simple date-like or timestamp sequences (e.g., 2026-10-01)
        if (/^\d{4}-\d{2}-\d{2}$/.test(phone.trim())) return phone;
        recordDetection('Phone Numbers');
        return sanitizePhone(phone, strategy);
      });
    }

    // 9. IP Addresses (IPv4 and IPv6)
    if (rules.ipAddresses) {
      if (IPV4_REGEX.test(result)) {
        result = result.replace(IPV4_REGEX, (ip) => {
          recordDetection('IP Addresses');
          return sanitizeIp(ip, strategy);
        });
      }
      if (IPV6_REGEX.test(result)) {
        result = result.replace(IPV6_REGEX, (ip) => {
          recordDetection('IP Addresses');
          return sanitizeIp(ip, strategy);
        });
      }
    }

    // 10. Check if the key name indicates a sensitive secret and no specific pattern modified it
    if (rules.keyNames && keyName && SENSITIVE_KEY_REGEX.test(keyName) && result === val) {
      if (typeof val === 'string' && val.length > 0) {
        recordDetection('Credentials & Key Names');
        return sanitizeSecret(val, strategy, 'SECRET');
      }
    }

    return result;
  }

  function walk(node: unknown, parentKey?: string): unknown {
    if (node === null || node === undefined) {
      return node;
    }

    if (typeof node === 'string') {
      return sanitizeString(node, parentKey);
    }

    if (typeof node === 'number' || typeof node === 'boolean') {
      report.totalFieldsScanned++;
      if (rules.keyNames && parentKey && SENSITIVE_KEY_REGEX.test(parentKey)) {
        recordDetection('Credentials & Key Names');
        return strategy === 'redact' ? 0 : (strategy === 'synthetic' ? 9999 : 0);
      }
      return node;
    }

    if (Array.isArray(node)) {
      return node.map((item) => walk(item, parentKey));
    }

    if (typeof node === 'object') {
      const copy: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        copy[k] = walk(v, k);
      }
      return copy;
    }

    return node;
  }

  const sanitizedData = walk(input) as T;
  if (withReport) {
    return { data: sanitizedData, report };
  }
  return sanitizedData;
}

/**
 * Returns both the sanitized data and the detection breakdown report.
 */
export function anonymizeWithReport<T = unknown>(
  input: T,
  strategyOrOptions?: AnonymizerStrategy | AnonymizerOptions,
  ruleOverrides?: AnonymizerRuleOptions
): AnonymizeResult<T> {
  const isOptionsObj = typeof strategyOrOptions === 'object' && strategyOrOptions !== null;
  const options: AnonymizerOptions = isOptionsObj
    ? { ...strategyOrOptions, withReport: true }
    : { strategy: strategyOrOptions, rules: ruleOverrides, withReport: true };
  return anonymize(input, options as AnonymizerOptions & { withReport: true });
}

/**
 * Shorthand helper for expression evaluations and inline queries.
 */
export function maskPII<T = unknown>(input: T, rules?: AnonymizerRuleOptions): T {
  return anonymize(input, 'mask', rules);
}

/**
 * Pre-sanitizes data before sending to remote AI models.
 */
export function sanitizeForAi<T = unknown>(input: T): T {
  return anonymize(input, 'redact');
}
