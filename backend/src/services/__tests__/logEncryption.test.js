const LogEncryptionService = require('../logEncryption');
const crypto = require('crypto');

describe('LogEncryptionService', () => {
  let encryptionService;

  beforeEach(() => {
    encryptionService = new LogEncryptionService({
      enableEncryption: true,
      encryptionKey: crypto.randomBytes(32).toString('hex')
    });
  });

  describe('Basic Encryption/Decryption', () => {
    test('should encrypt and decrypt data correctly', () => {
      const originalData = { message: 'Test log entry', level: 'error' };
      
      const encrypted = encryptionService.encryptLogData(originalData);
      expect(encrypted.encrypted).toBe(true);
      expect(encrypted.data).toBeTruthy();
      expect(encrypted.iv).toBeTruthy();

      const decrypted = encryptionService.decryptLogData(encrypted);
      expect(decrypted).toEqual(originalData);
    });

    test('should handle string data', () => {
      const originalData = 'Simple log message';
      
      const encrypted = encryptionService.encryptLogData(originalData);
      const decrypted = encryptionService.decryptLogData(encrypted);
      
      expect(decrypted).toBe(originalData);
    });

    test('should return unencrypted data when encryption is disabled', () => {
      const disabledService = new LogEncryptionService({ enableEncryption: false });
      const data = { message: 'Test' };
      
      const result = disabledService.encryptLogData(data);
      
      expect(result.encrypted).toBe(false);
      expect(result.data).toEqual(data);
    });
  });

  describe('Log Level Detection', () => {
    test('should encrypt error level logs', () => {
      const errorLog = { level: 'error', message: 'Error occurred' };
      expect(encryptionService.shouldEncryptLog(errorLog)).toBe(true);
    });

    test('should encrypt warn level logs', () => {
      const warnLog = { level: 'warn', message: 'Warning message' };
      expect(encryptionService.shouldEncryptLog(warnLog)).toBe(true);
    });

    test('should not encrypt info level logs by default', () => {
      const infoLog = { level: 'info', message: 'Info message' };
      expect(encryptionService.shouldEncryptLog(infoLog)).toBe(false);
    });

    test('should encrypt logs with sensitive content', () => {
      const sensitiveLog = { 
        level: 'info', 
        message: 'User password reset',
        data: { token: 'abc123' }
      };
      expect(encryptionService.shouldEncryptLog(sensitiveLog)).toBe(true);
    });
  });

  describe('Secure Transmission', () => {
    test('should create secure payload with integrity hash', () => {
      const logs = [
        { level: 'info', message: 'Log 1' },
        { level: 'error', message: 'Log 2' }
      ];

      const payload = encryptionService.createSecurePayload(logs);
      
      expect(payload.logs).toHaveLength(2);
      expect(payload.metadata).toBeTruthy();
      expect(payload.integrity).toBeTruthy();
      expect(payload.logs[1].encrypted).toBe(true); // Error log should be encrypted
    });

    test('should verify secure payload integrity', () => {
      const logs = [{ level: 'info', message: 'Test log' }];
      const payload = encryptionService.createSecurePayload(logs);
      
      const verified = encryptionService.verifySecurePayload(payload);
      expect(verified.logs).toEqual(logs);
    });

    test('should reject tampered payload', () => {
      const logs = [{ level: 'info', message: 'Test log' }];
      const payload = encryptionService.createSecurePayload(logs);
      
      // Tamper with the payload
      payload.logs[0].message = 'Tampered message';
      
      expect(() => {
        encryptionService.verifySecurePayload(payload);
      }).toThrow('Payload integrity verification failed');
    });
  });

  describe('Key Management', () => {
    test('should generate new encryption key', () => {
      const key = encryptionService.generateEncryptionKey();
      expect(key).toBeTruthy();
      expect(key.length).toBe(64); // 32 bytes as hex string
    });

    test('should rotate encryption key', () => {
      const oldKeyHash = crypto.createHash('sha256')
        .update(encryptionService.config.encryptionKey)
        .digest('hex')
        .substring(0, 8);

      const result = encryptionService.rotateEncryptionKey();
      
      expect(result.success).toBe(true);
      expect(result.oldKeyHash).toBe(oldKeyHash);
      expect(result.newKey).toBeTruthy();
      expect(result.newKey).not.toBe(encryptionService.config.encryptionKey);
    });
  });

  describe('Audit Logging', () => {
    test('should log encryption operations', () => {
      const data = { message: 'Test' };
      encryptionService.encryptLogData(data);
      
      const auditLog = encryptionService.getAuditLog();
      expect(auditLog.length).toBeGreaterThan(0);
      expect(auditLog[auditLog.length - 1].operation).toBe('encrypt');
    });

    test('should log decryption operations', () => {
      const data = { message: 'Test' };
      const encrypted = encryptionService.encryptLogData(data);
      encryptionService.decryptLogData(encrypted);
      
      const auditLog = encryptionService.getAuditLog();
      const decryptEntry = auditLog.find(entry => entry.operation === 'decrypt');
      expect(decryptEntry).toBeTruthy();
    });

    test('should clear audit log', () => {
      encryptionService.encryptLogData({ message: 'Test' });
      expect(encryptionService.getAuditLog().length).toBeGreaterThan(0);
      
      const clearedCount = encryptionService.clearAuditLog();
      expect(clearedCount).toBeGreaterThan(0);
      expect(encryptionService.getAuditLog().length).toBe(1); // Clear operation itself
    });
  });

  describe('Statistics and Validation', () => {
    test('should provide encryption statistics', () => {
      const stats = encryptionService.getEncryptionStats();
      
      expect(stats.encryptionEnabled).toBe(true);
      expect(stats.algorithm).toBe('aes-256-cbc');
      expect(stats.keyLength).toBe(32);
      expect(stats.auditLogSize).toBeDefined();
    });

    test('should validate configuration', () => {
      const validation = encryptionService.validateConfig();
      expect(validation.valid).toBe(true);
      expect(validation.issues).toHaveLength(0);
    });

    test('should detect invalid configuration', () => {
      const invalidService = new LogEncryptionService({
        enableEncryption: true,
        encryptionKey: 'invalid-key'
      });
      
      const validation = invalidService.validateConfig();
      expect(validation.valid).toBe(false);
      expect(validation.issues.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    test('should handle encryption failure gracefully', () => {
      const invalidService = new LogEncryptionService({
        enableEncryption: true,
        encryptionKey: null
      });
      
      const result = invalidService.encryptLogData({ message: 'Test' });
      expect(result.encrypted).toBe(false);
      expect(result.error).toBeTruthy();
    });

    test('should handle decryption failure', () => {
      const invalidEncrypted = {
        encrypted: true,
        data: 'invalid-encrypted-data',
        iv: 'invalid-iv',
        authTag: 'invalid-tag',
        algorithm: 'aes-256-gcm'
      };
      
      expect(() => {
        encryptionService.decryptLogData(invalidEncrypted);
      }).toThrow();
    });
  });

  describe('File Operations', () => {
    test('should encrypt log file', async () => {
      // This would require file system mocking in a real test
      // For now, just test the method exists
      expect(typeof encryptionService.encryptLogFile).toBe('function');
    });

    test('should decrypt log file', async () => {
      // This would require file system mocking in a real test
      // For now, just test the method exists
      expect(typeof encryptionService.decryptLogFile).toBe('function');
    });
  });
});