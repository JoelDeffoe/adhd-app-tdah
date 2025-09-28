const PrivacyProtectionService = require('../privacyProtection');

describe('PrivacyProtectionService', () => {
  let privacyService;

  beforeEach(() => {
    privacyService = new PrivacyProtectionService({
      preserveLength: false // Use [REDACTED] for consistent testing
    });
  });

  describe('PII Detection and Masking', () => {
    test('should mask email addresses', () => {
      const data = {
        message: 'User john.doe@example.com logged in',
        userEmail: 'jane.smith@company.org'
      };

      const sanitized = privacyService.sanitizeForLogging(data);

      expect(sanitized.message).toContain('j******e@example.com');
      expect(sanitized.userEmail).toBe('[REDACTED]'); // Field name is sensitive
    });

    test('should mask phone numbers', () => {
      const data = {
        message: 'Contact at (555) 123-4567 or +1-800-555-0199',
        phoneNumber: '555-123-4567'
      };

      const sanitized = privacyService.sanitizeForLogging(data);

      expect(sanitized.message).toContain('XXX-XXX-4567');
      expect(sanitized.message).toContain('XXX-XXX-0199');
      expect(sanitized.phoneNumber).toBe('[REDACTED]'); // Field name is sensitive
    });

    test('should mask credit card numbers', () => {
      const data = {
        message: 'Payment with card 4532 1234 5678 9012',
        cardNumber: '4532123456789012'
      };

      const sanitized = privacyService.sanitizeForLogging(data);

      expect(sanitized.message).toContain('****-****-****-9012');
      expect(sanitized.cardNumber).toBe('[REDACTED]'); // Field name is sensitive
    });

    test('should mask SSN', () => {
      const data = {
        message: 'SSN verification for 123-45-6789',
        ssn: '123456789'
      };

      const sanitized = privacyService.sanitizeForLogging(data);

      expect(sanitized.message).toContain('XXX-XX-XXXX');
      expect(sanitized.ssn).toBe('[REDACTED]'); // Field name is sensitive
    });

    test('should mask IP addresses', () => {
      const data = {
        message: 'Request from 192.168.1.100',
        clientIP: '10.0.0.1'
      };

      const sanitized = privacyService.sanitizeForLogging(data);

      expect(sanitized.message).toContain('192.168.XXX.XXX');
      expect(sanitized.clientIP).toContain('10.0.XXX.XXX');
    });

    test('should mask URLs while preserving domain', () => {
      const data = {
        message: 'Redirecting to https://example.com/user/profile?id=123',
        redirectUrl: 'https://api.company.com/v1/users/456/details'
      };

      const sanitized = privacyService.sanitizeForLogging(data);

      expect(sanitized.message).toContain('https://example.com[MASKED_PATH]');
      expect(sanitized.redirectUrl).toContain('https://api.company.com[MASKED_PATH]');
    });
  });

  describe('Token Redaction', () => {
    test('should redact JWT tokens', () => {
      const data = {
        message: 'Auth with token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature'
      };

      const sanitized = privacyService.sanitizeForLogging(data);

      expect(sanitized.message).toContain('[REDACTED_JWT]');
      expect(sanitized.token).toBe('[REDACTED]'); // Field name is sensitive
    });

    test('should redact Bearer tokens', () => {
      const data = {
        authorization: 'Bearer abc123def456ghi789',
        message: 'Request with Bearer token123abc'
      };

      const sanitized = privacyService.sanitizeForLogging(data);

      expect(sanitized.authorization).toBe('[REDACTED]'); // Field name is sensitive
      expect(sanitized.message).toContain('[REDACTED_BEARER]');
    });

    test('should redact API keys', () => {
      const data = {
        message: 'Using API_KEY=sk_test_123456789abcdef',
        apiKey: 'pk_live_abcdef123456789'
      };

      const sanitized = privacyService.sanitizeForLogging(data);

      expect(sanitized.message).toContain('[REDACTED_APIKEY]');
      expect(sanitized.apiKey).toBe('[REDACTED]'); // Field name is sensitive
    });
  });

  describe('Sensitive Field Detection', () => {
    test('should mask fields with sensitive names', () => {
      const data = {
        username: 'john_doe',
        password: 'secret123',
        email: 'john@example.com',
        phoneNumber: '555-1234',
        creditCard: '4532123456789012',
        socialSecurityNumber: '123-45-6789',
        address: '123 Main St',
        normalField: 'this should not be masked'
      };

      const sanitized = privacyService.sanitizeForLogging(data);

      expect(sanitized.username).toBe('[REDACTED]');
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.email).toBe('[REDACTED]');
      expect(sanitized.phoneNumber).toBe('[REDACTED]');
      expect(sanitized.creditCard).toBe('[REDACTED]');
      expect(sanitized.socialSecurityNumber).toBe('[REDACTED]');
      expect(sanitized.address).toBe('[REDACTED]');
      expect(sanitized.normalField).toBe('this should not be masked');
    });

    test('should handle nested objects', () => {
      const data = {
        user: {
          id: 123,
          email: 'user@example.com',
          profile: {
            name: 'John Doe',
            phone: '555-1234',
            preferences: {
              theme: 'dark',
              password: 'secret'
            }
          }
        },
        metadata: {
          timestamp: '2023-01-01T00:00:00Z',
          source: 'api'
        }
      };

      const sanitized = privacyService.sanitizeForLogging(data);

      expect(sanitized.user.id).toBe(123);
      expect(sanitized.user.email).toBe('[REDACTED]');
      expect(sanitized.user.profile.name).toBe('[REDACTED]');
      expect(sanitized.user.profile.phone).toBe('[REDACTED]');
      expect(sanitized.user.profile.preferences.theme).toBe('dark');
      expect(sanitized.user.profile.preferences.password).toBe('[REDACTED]');
      expect(sanitized.metadata.timestamp).toBe('2023-01-01T00:00:00Z');
      expect(sanitized.metadata.source).toBe('api');
    });

    test('should handle arrays', () => {
      const data = {
        users: [
          { id: 1, email: 'user1@example.com' },
          { id: 2, email: 'user2@example.com' }
        ],
        tags: ['public', 'private', 'confidential']
      };

      const sanitized = privacyService.sanitizeForLogging(data);

      expect(sanitized.users[0].id).toBe(1);
      expect(sanitized.users[0].email).toBe('[REDACTED]');
      expect(sanitized.users[1].id).toBe(2);
      expect(sanitized.users[1].email).toBe('[REDACTED]');
      expect(sanitized.tags).toEqual(['public', 'private', 'confidential']);
    });
  });

  describe('Configuration', () => {
    test('should respect custom sensitive fields', () => {
      const customService = new PrivacyProtectionService({
        customSensitiveFields: ['customSecret', 'internalId'],
        preserveLength: false
      });

      const data = {
        customSecret: 'should be masked',
        internalId: 'ID123',
        normalField: 'should not be masked'
      };

      const sanitized = customService.sanitizeForLogging(data);

      expect(sanitized.customSecret).toBe('[REDACTED]');
      expect(sanitized.internalId).toBe('[REDACTED]');
      expect(sanitized.normalField).toBe('should not be masked');
    });

    test('should respect masking character configuration', () => {
      const customService = new PrivacyProtectionService({
        maskingChar: 'X',
        preserveLength: true
      });

      const data = { message: 'Email: user@example.com' };
      const sanitized = customService.sanitizeForLogging(data);

      expect(sanitized.message).toContain('u**r@example.com');
    });

    test('should allow disabling PII detection', () => {
      const customService = new PrivacyProtectionService({
        enablePIIDetection: false
      });

      const data = { message: 'Contact john.doe@example.com' };
      const sanitized = customService.sanitizeForLogging(data);

      expect(sanitized.message).toBe('Contact john.doe@example.com');
    });

    test('should allow disabling token redaction', () => {
      const customService = new PrivacyProtectionService({
        enableTokenRedaction: false
      });

      const data = { message: 'Bearer token123abc' };
      const sanitized = customService.sanitizeForLogging(data);

      expect(sanitized.message).toBe('Bearer token123abc');
    });
  });

  describe('Utility Methods', () => {
    test('should generate data hash', () => {
      const data = { user: 'john', action: 'login' };
      const hash = privacyService.generateDataHash(data);

      expect(hash).toBeTruthy();
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(16);
    });

    test('should create privacy-safe summary', () => {
      const data = {
        id: 123,
        email: 'user@example.com',
        password: 'secret',
        preferences: { theme: 'dark' }
      };

      const summary = privacyService.createPrivacySafeSummary(data);

      expect(summary._type).toBe('object');
      expect(summary._size).toBe(4);
      expect(summary._hash).toBeTruthy();
      expect(summary._fields).toContain('id');
      expect(summary._fields).toContain('preferences');
      expect(summary._fields).not.toContain('email');
      expect(summary._fields).not.toContain('password');
      expect(summary._sensitiveFields).toBe(2);
    });

    test('should validate sanitization', () => {
      const cleanData = { message: 'User logged in', userId: 123 };
      const dirtyData = { message: 'User john@example.com logged in' };

      const cleanResult = privacyService.validateSanitization(cleanData);
      const dirtyResult = privacyService.validateSanitization(dirtyData);

      expect(cleanResult.isClean).toBe(true);
      expect(cleanResult.issues).toHaveLength(0);

      expect(dirtyResult.isClean).toBe(false);
      expect(dirtyResult.issues.length).toBeGreaterThan(0);
      expect(dirtyResult.issues[0].type).toBe('PII_DETECTED');
      expect(dirtyResult.issues[0].piiType).toBe('email');
    });
  });

  describe('Edge Cases', () => {
    test('should handle null and undefined values', () => {
      const data = {
        nullValue: null,
        undefinedValue: undefined,
        emptyString: '',
        zeroNumber: 0,
        falseBoolean: false
      };

      const sanitized = privacyService.sanitizeForLogging(data);

      expect(sanitized.nullValue).toBeNull();
      expect(sanitized.undefinedValue).toBeUndefined();
      expect(sanitized.emptyString).toBe('');
      expect(sanitized.zeroNumber).toBe(0);
      expect(sanitized.falseBoolean).toBe(false);
    });

    test('should handle circular references', () => {
      const data = { name: 'test' };
      data.self = data; // Create circular reference

      // Should not throw an error
      expect(() => {
        privacyService.sanitizeForLogging(data);
      }).not.toThrow();
    });

    test('should handle deep nesting', () => {
      let deepData = { level: 0 };
      let current = deepData;

      // Create 15 levels of nesting
      for (let i = 1; i <= 15; i++) {
        current.next = { level: i };
        current = current.next;
      }

      const sanitized = privacyService.sanitizeForLogging(deepData);
      
      // Should handle deep nesting gracefully
      expect(sanitized).toBeTruthy();
    });

    test('should handle various data types', () => {
      const data = {
        string: 'test',
        number: 123,
        boolean: true,
        date: new Date('2023-01-01'),
        array: [1, 2, 3],
        object: { nested: true },
        function: () => 'test', // Functions should be handled gracefully
        symbol: Symbol('test') // Symbols should be handled gracefully
      };

      const sanitized = privacyService.sanitizeForLogging(data);

      expect(sanitized.string).toBe('test');
      expect(sanitized.number).toBe(123);
      expect(sanitized.boolean).toBe(true);
      expect(sanitized.date).toBe('2023-01-01T00:00:00.000Z');
      expect(sanitized.array).toEqual([1, 2, 3]);
      expect(sanitized.object).toEqual({ nested: true });
    });
  });

  describe('Performance', () => {
    test('should handle large objects efficiently', () => {
      const largeData = {};
      for (let i = 0; i < 1000; i++) {
        largeData[`field${i}`] = `value${i}`;
      }

      const startTime = Date.now();
      const sanitized = privacyService.sanitizeForLogging(largeData);
      const endTime = Date.now();

      expect(sanitized).toBeTruthy();
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });
  });
});