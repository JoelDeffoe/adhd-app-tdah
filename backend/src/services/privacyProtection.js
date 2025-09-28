const crypto = require('crypto');

/**
 * Privacy Protection Service
 * Handles data masking, PII detection, and sensitive field redaction
 */
class PrivacyProtectionService {
  constructor(config = {}) {
    this.config = {
      maskingChar: '*',
      preserveLength: true,
      enablePIIDetection: true,
      enableTokenRedaction: true,
      customSensitiveFields: [],
      ...config
    };

    // Common PII patterns
    this.piiPatterns = {
      email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      phone: /(\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g,
      ssn: /\b\d{3}-?\d{2}-?\d{4}\b/g,
      creditCard: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
      ipAddress: /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g,
      url: /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g
    };

    // Sensitive field names (case-insensitive) - exact matches or contains
    this.sensitiveFields = [
      'password', 'passwd', 'pwd', 'secret', 'token', 'auth', 'authorization',
      'credential', 'key', 'private', 'confidential', 'sensitive',
      'email', 'mail', 'phone', 'telephone', 'mobile', 'cell',
      'address', 'street', 'city', 'zip', 'postal', 'location',
      'ssn', 'social', 'security', 'tax', 'identification',
      'credit', 'card', 'payment', 'billing', 'account', 'bank',
      'name', 'firstname', 'lastname', 'fullname', 'username',
      'dob', 'birthdate', 'birthday', 'age',
      'session', 'sessionid', 'csrf', 'xsrf',
      ...this.config.customSensitiveFields
    ];

    // Authentication token patterns
    this.tokenPatterns = {
      jwt: /eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g,
      bearer: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
      basic: /Basic\s+[A-Za-z0-9+/]+=*/gi,
      apiKey: /API_KEY[:\s=]+[A-Za-z0-9\-._~+/]+/gi,
      accessToken: /[Aa]ccess[_-]?[Tt]oken[:\s=]+[A-Za-z0-9\-._~+/]+=*/g,
      refreshToken: /[Rr]efresh[_-]?[Tt]oken[:\s=]+[A-Za-z0-9\-._~+/]+=*/g
    };
  }

  /**
   * Main method to sanitize data for logging
   */
  sanitizeForLogging(data, options = {}) {
    if (!data) return data;

    const opts = {
      maskPII: this.config.enablePIIDetection,
      redactTokens: this.config.enableTokenRedaction,
      maskSensitiveFields: true,
      preserveStructure: true,
      ...options
    };

    try {
      return this.processData(data, opts);
    } catch (error) {
      console.error('Privacy protection failed:', error);
      return '[PRIVACY_PROTECTION_ERROR]';
    }
  }

  /**
   * Process data recursively
   */
  processData(data, options, path = '', depth = 0) {
    // Prevent infinite recursion
    if (depth > 10) {
      return '[MAX_DEPTH_REACHED]';
    }

    if (data === null || data === undefined) {
      return data;
    }

    // Handle different data types
    if (typeof data === 'string') {
      return this.sanitizeString(data, options, path);
    }

    if (typeof data === 'number' || typeof data === 'boolean') {
      return data;
    }

    if (data instanceof Date) {
      return data.toISOString();
    }

    if (Array.isArray(data)) {
      return data.map((item, index) => 
        this.processData(item, options, `${path}[${index}]`, depth + 1)
      );
    }

    if (typeof data === 'object') {
      return this.sanitizeObject(data, options, path, depth);
    }

    return data;
  }

  /**
   * Sanitize string data
   */
  sanitizeString(str, options, path) {
    if (typeof str !== 'string') return str;

    let sanitized = str;

    // Check if field name indicates sensitive data
    if (options.maskSensitiveFields && this.isSensitiveField(path)) {
      return this.maskValue(str);
    }

    // Redact authentication tokens
    if (options.redactTokens) {
      sanitized = this.redactTokens(sanitized);
    }

    // Mask PII patterns
    if (options.maskPII) {
      sanitized = this.maskPII(sanitized);
    }

    return sanitized;
  }

  /**
   * Sanitize object data
   */
  sanitizeObject(obj, options, path, depth) {
    const sanitized = {};

    for (const [key, value] of Object.entries(obj)) {
      const currentPath = path ? `${path}.${key}` : key;
      
      // Check if this key should be masked entirely
      if (this.isSensitiveField(key)) {
        sanitized[key] = this.maskValue(value);
      } else {
        sanitized[key] = this.processData(value, options, currentPath, depth + 1);
      }
    }

    return sanitized;
  }

  /**
   * Check if field name indicates sensitive data
   */
  isSensitiveField(fieldName) {
    if (!fieldName || typeof fieldName !== 'string') return false;
    
    const lowerField = fieldName.toLowerCase();
    
    // Check if it's explicitly in custom sensitive fields first
    const isCustomSensitive = this.config.customSensitiveFields.some(custom => 
      custom.toLowerCase() === lowerField
    );
    
    if (isCustomSensitive) {
      return true;
    }
    
    // Whitelist common non-sensitive fields that might match sensitive patterns
    const whitelistedFields = [
      'id', 'uid', 'pid', 'sid', 'timestamp', 'created', 'updated', 'version',
      'message', 'description', 'content', 'text', 'body', 'data', 'value',
      'status', 'type', 'category', 'level', 'priority', 'source', 'target'
    ];
    
    if (whitelistedFields.includes(lowerField)) {
      return false;
    }
    
    // Check for exact matches in default sensitive fields
    if (this.sensitiveFields.includes(lowerField)) {
      return true;
    }
    
    // Check for partial matches but be more restrictive
    return this.sensitiveFields.some(sensitive => {
      const lowerSensitive = sensitive.toLowerCase();
      // Only match if the sensitive word is substantial part of the field name
      // Allow "key" as it's commonly used in compound field names
      if (lowerSensitive.length < 3 || (lowerSensitive.length === 3 && lowerSensitive !== 'key')) {
        return false;
      }
      
      // Check if field name starts or ends with sensitive word, or is a compound
      return (lowerField.startsWith(lowerSensitive) || 
              lowerField.endsWith(lowerSensitive) ||
              lowerField.includes(lowerSensitive + '_') ||
              lowerField.includes('_' + lowerSensitive)) &&
              lowerField.length > lowerSensitive.length;
    });
  }

  /**
   * Mask a value while preserving its type and structure
   */
  maskValue(value) {
    if (value === null || value === undefined) return value;

    if (typeof value === 'string') {
      if (value.length === 0) return value;
      
      if (this.config.preserveLength) {
        return this.config.maskingChar.repeat(Math.min(value.length, 8));
      } else {
        return '[REDACTED]';
      }
    }

    if (typeof value === 'number') {
      return '[REDACTED_NUMBER]';
    }

    if (typeof value === 'boolean') {
      return '[REDACTED_BOOLEAN]';
    }

    if (Array.isArray(value)) {
      return '[REDACTED_ARRAY]';
    }

    if (typeof value === 'object') {
      return '[REDACTED_OBJECT]';
    }

    return '[REDACTED]';
  }

  /**
   * Redact authentication tokens and secrets
   */
  redactTokens(str) {
    let sanitized = str;

    for (const [tokenType, pattern] of Object.entries(this.tokenPatterns)) {
      sanitized = sanitized.replace(pattern, `[REDACTED_${tokenType.toUpperCase()}]`);
    }

    return sanitized;
  }

  /**
   * Mask personally identifiable information
   */
  maskPII(str) {
    let sanitized = str;

    for (const [piiType, pattern] of Object.entries(this.piiPatterns)) {
      sanitized = sanitized.replace(pattern, (match) => {
        switch (piiType) {
          case 'email':
            return this.maskEmail(match);
          case 'phone':
            return this.maskPhone(match);
          case 'creditCard':
            return this.maskCreditCard(match);
          case 'ssn':
            return 'XXX-XX-XXXX';
          case 'ipAddress':
            return this.maskIPAddress(match);
          case 'url':
            return this.maskURL(match);
          default:
            return `[MASKED_${piiType.toUpperCase()}]`;
        }
      });
    }

    return sanitized;
  }

  /**
   * Mask email addresses while preserving domain for debugging
   */
  maskEmail(email) {
    const [local, domain] = email.split('@');
    if (!domain) return '[MASKED_EMAIL]';
    
    if (local.length <= 2) {
      return '***@' + domain;
    }
    
    const maskedLocal = local[0] + '*'.repeat(local.length - 2) + local[local.length - 1];
    return `${maskedLocal}@${domain}`;
  }

  /**
   * Mask phone numbers
   */
  maskPhone(phone) {
    const digits = phone.replace(/\D/g, '');
    if (digits.length >= 10) {
      return `XXX-XXX-${digits.slice(-4)}`;
    }
    return 'XXX-XXXX';
  }

  /**
   * Mask credit card numbers
   */
  maskCreditCard(cardNumber) {
    const digits = cardNumber.replace(/\D/g, '');
    if (digits.length >= 4) {
      return `****-****-****-${digits.slice(-4)}`;
    }
    return '****-****-****-****';
  }

  /**
   * Mask IP addresses while preserving network info
   */
  maskIPAddress(ip) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.XXX.XXX`;
    }
    return 'XXX.XXX.XXX.XXX';
  }

  /**
   * Mask URLs while preserving domain for debugging
   */
  maskURL(url) {
    try {
      const urlObj = new URL(url);
      return `${urlObj.protocol}//${urlObj.hostname}[MASKED_PATH]`;
    } catch {
      return '[MASKED_URL]';
    }
  }

  /**
   * Generate a hash for sensitive data that needs to be tracked
   */
  generateDataHash(data) {
    if (!data) return null;
    
    const dataString = typeof data === 'string' ? data : JSON.stringify(data);
    return crypto.createHash('sha256').update(dataString).digest('hex').substring(0, 16);
  }

  /**
   * Create a privacy-safe summary of an object
   */
  createPrivacySafeSummary(obj) {
    if (!obj || typeof obj !== 'object') return obj;

    const summary = {
      _type: Array.isArray(obj) ? 'array' : 'object',
      _size: Array.isArray(obj) ? obj.length : Object.keys(obj).length,
      _hash: this.generateDataHash(obj)
    };

    // Add non-sensitive field names for debugging
    if (!Array.isArray(obj)) {
      summary._fields = Object.keys(obj).filter(key => !this.isSensitiveField(key));
      summary._sensitiveFields = Object.keys(obj).filter(key => this.isSensitiveField(key)).length;
    }

    return summary;
  }

  /**
   * Validate that data has been properly sanitized
   */
  validateSanitization(data) {
    const issues = [];
    
    try {
      const dataString = JSON.stringify(data);
      
      // Check for common PII patterns
      for (const [piiType, pattern] of Object.entries(this.piiPatterns)) {
        const matches = dataString.match(pattern);
        if (matches) {
          issues.push({
            type: 'PII_DETECTED',
            piiType,
            count: matches.length,
            samples: matches.slice(0, 3) // First 3 matches for debugging
          });
        }
      }

      // Check for token patterns
      for (const [tokenType, pattern] of Object.entries(this.tokenPatterns)) {
        const matches = dataString.match(pattern);
        if (matches) {
          issues.push({
            type: 'TOKEN_DETECTED',
            tokenType,
            count: matches.length
          });
        }
      }

    } catch (error) {
      issues.push({
        type: 'VALIDATION_ERROR',
        error: error.message
      });
    }

    return {
      isClean: issues.length === 0,
      issues
    };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    
    // Update sensitive fields if provided
    if (newConfig.customSensitiveFields) {
      this.sensitiveFields = [
        ...this.sensitiveFields.filter(field => 
          !this.config.customSensitiveFields.includes(field)
        ),
        ...newConfig.customSensitiveFields
      ];
    }
  }

  /**
   * Get current configuration
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Get statistics about privacy protection
   */
  getStats() {
    return {
      sensitiveFieldsCount: this.sensitiveFields.length,
      piiPatternsCount: Object.keys(this.piiPatterns).length,
      tokenPatternsCount: Object.keys(this.tokenPatterns).length,
      config: this.getConfig()
    };
  }
}

module.exports = PrivacyProtectionService;