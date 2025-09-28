const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

/**
 * Log Encryption Service
 * Handles encryption of sensitive logs at rest and secure transmission
 */
class LogEncryptionService {
  constructor(config = {}) {
    this.config = {
      algorithm: 'aes-256-cbc',
      keyLength: 32,
      ivLength: 16,
      encryptionKey: config.encryptionKey || process.env.LOG_ENCRYPTION_KEY,
      enableEncryption: config.enableEncryption !== false,
      encryptSensitiveLogs: config.encryptSensitiveLogs !== false,
      ...config
    };

    // Initialize encryption key if not provided
    if (!this.config.encryptionKey && this.config.enableEncryption) {
      this.config.encryptionKey = this.generateEncryptionKey();
      console.warn('Generated new encryption key. Store this securely:', this.config.encryptionKey);
    }

    this.sensitiveLogLevels = ['error', 'warn'];
    this.auditLog = [];
  }

  /**
   * Generate a new encryption key
   */
  generateEncryptionKey() {
    return crypto.randomBytes(this.config.keyLength).toString('hex');
  }

  /**
   * Encrypt log data
   */
  encryptLogData(data, metadata = {}) {
    if (!this.config.enableEncryption) {
      return {
        encrypted: false,
        data: data,
        metadata
      };
    }

    try {
      const key = Buffer.from(this.config.encryptionKey, 'hex');
      const iv = crypto.randomBytes(this.config.ivLength);
      const cipher = crypto.createCipheriv(this.config.algorithm, key, iv);

      let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const result = {
        encrypted: true,
        data: encrypted,
        iv: iv.toString('hex'),
        algorithm: this.config.algorithm,
        metadata,
        timestamp: new Date().toISOString()
      };

      // Log access for audit
      this.logAccess('encrypt', metadata);

      return result;
    } catch (error) {
      console.error('Encryption failed:', error);
      // Fallback to unencrypted if encryption fails
      return {
        encrypted: false,
        data: data,
        metadata,
        error: error.message
      };
    }
  }

  /**
   * Decrypt log data
   */
  decryptLogData(encryptedData) {
    if (!encryptedData.encrypted) {
      return encryptedData.data;
    }

    if (!this.config.enableEncryption || !this.config.encryptionKey) {
      throw new Error('Encryption key not available for decryption');
    }

    try {
      const key = Buffer.from(this.config.encryptionKey, 'hex');
      const iv = Buffer.from(encryptedData.iv, 'hex');
      const decipher = crypto.createDecipheriv(encryptedData.algorithm || this.config.algorithm, key, iv);

      let decrypted = decipher.update(encryptedData.data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      // Log access for audit
      this.logAccess('decrypt', encryptedData.metadata);

      return JSON.parse(decrypted);
    } catch (error) {
      console.error('Decryption failed:', error);
      throw new Error('Failed to decrypt log data: ' + error.message);
    }
  }

  /**
   * Determine if log should be encrypted based on level and content
   */
  shouldEncryptLog(logEntry) {
    if (!this.config.enableEncryption) {
      return false;
    }

    // Always encrypt sensitive log levels
    if (this.sensitiveLogLevels.includes(logEntry.level)) {
      return true;
    }

    // Encrypt if log contains sensitive data
    if (this.config.encryptSensitiveLogs && this.containsSensitiveData(logEntry)) {
      return true;
    }

    return false;
  }

  /**
   * Check if log entry contains sensitive data
   */
  containsSensitiveData(logEntry) {
    const sensitiveKeywords = [
      'password', 'token', 'secret', 'key', 'credential',
      'auth', 'session', 'cookie', 'private', 'confidential'
    ];

    const logString = JSON.stringify(logEntry).toLowerCase();
    return sensitiveKeywords.some(keyword => logString.includes(keyword));
  }

  /**
   * Encrypt log file
   */
  async encryptLogFile(filePath, outputPath) {
    if (!this.config.enableEncryption) {
      throw new Error('Encryption is disabled');
    }

    try {
      const data = await fs.readFile(filePath, 'utf8');
      const logs = data.split('\n').filter(line => line.trim());
      
      const encryptedLogs = logs.map(logLine => {
        try {
          const logEntry = JSON.parse(logLine);
          if (this.shouldEncryptLog(logEntry)) {
            return JSON.stringify(this.encryptLogData(logEntry, {
              originalFile: path.basename(filePath),
              encryptedAt: new Date().toISOString()
            }));
          }
          return logLine;
        } catch (error) {
          // If line is not valid JSON, encrypt as string
          return JSON.stringify(this.encryptLogData(logLine, {
            type: 'raw_log_line',
            originalFile: path.basename(filePath),
            encryptedAt: new Date().toISOString()
          }));
        }
      });

      await fs.writeFile(outputPath || filePath, encryptedLogs.join('\n'));
      
      this.logAccess('encrypt_file', {
        file: path.basename(filePath),
        logsProcessed: logs.length
      });

      return {
        success: true,
        logsProcessed: logs.length,
        outputFile: outputPath || filePath
      };
    } catch (error) {
      console.error('File encryption failed:', error);
      throw error;
    }
  }

  /**
   * Decrypt log file
   */
  async decryptLogFile(filePath, outputPath) {
    if (!this.config.enableEncryption) {
      throw new Error('Encryption is disabled');
    }

    try {
      const data = await fs.readFile(filePath, 'utf8');
      const logs = data.split('\n').filter(line => line.trim());
      
      const decryptedLogs = logs.map(logLine => {
        try {
          const logEntry = JSON.parse(logLine);
          if (logEntry.encrypted) {
            const decryptedData = this.decryptLogData(logEntry);
            return typeof decryptedData === 'string' ? decryptedData : JSON.stringify(decryptedData);
          }
          return logLine;
        } catch (error) {
          console.warn('Failed to decrypt log line:', error.message);
          return logLine; // Return original if decryption fails
        }
      });

      await fs.writeFile(outputPath || filePath, decryptedLogs.join('\n'));
      
      this.logAccess('decrypt_file', {
        file: path.basename(filePath),
        logsProcessed: logs.length
      });

      return {
        success: true,
        logsProcessed: logs.length,
        outputFile: outputPath || filePath
      };
    } catch (error) {
      console.error('File decryption failed:', error);
      throw error;
    }
  }

  /**
   * Create secure transmission payload
   */
  createSecurePayload(logs, metadata = {}) {
    const payload = {
      logs: logs,
      metadata: {
        timestamp: new Date().toISOString(),
        source: 'focusmate-backend',
        version: '1.0.0',
        ...metadata
      }
    };

    // Encrypt sensitive logs in the payload
    if (this.config.enableEncryption) {
      payload.logs = logs.map(log => {
        if (this.shouldEncryptLog(log)) {
          return this.encryptLogData(log, {
            transmissionId: crypto.randomUUID(),
            encryptedForTransmission: true
          });
        }
        return log;
      });
    }

    // Add integrity hash
    payload.integrity = this.generateIntegrityHash(payload);

    return payload;
  }

  /**
   * Verify secure transmission payload
   */
  verifySecurePayload(payload) {
    if (!payload.integrity) {
      throw new Error('Payload missing integrity hash');
    }

    const receivedHash = payload.integrity;
    delete payload.integrity;
    
    const calculatedHash = this.generateIntegrityHash(payload);
    
    if (receivedHash !== calculatedHash) {
      throw new Error('Payload integrity verification failed');
    }

    // Decrypt logs if encrypted
    if (this.config.enableEncryption) {
      payload.logs = payload.logs.map(log => {
        if (log.encrypted && log.metadata?.encryptedForTransmission) {
          return this.decryptLogData(log);
        }
        return log;
      });
    }

    return payload;
  }

  /**
   * Generate integrity hash for payload
   */
  generateIntegrityHash(payload) {
    const payloadString = JSON.stringify(payload, Object.keys(payload).sort());
    return crypto.createHash('sha256').update(payloadString).digest('hex');
  }

  /**
   * Log access for audit trail
   */
  logAccess(operation, metadata = {}) {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      operation,
      metadata,
      sessionId: crypto.randomUUID()
    };

    this.auditLog.push(auditEntry);

    // Keep audit log size manageable
    if (this.auditLog.length > 1000) {
      this.auditLog = this.auditLog.slice(-500);
    }

    // In production, this should be written to a secure audit log
    if (process.env.NODE_ENV === 'development') {
      console.log('Audit:', auditEntry);
    }
  }

  /**
   * Get audit log entries
   */
  getAuditLog(limit = 100) {
    return this.auditLog.slice(-limit);
  }

  /**
   * Clear audit log (use with caution)
   */
  clearAuditLog() {
    const clearedCount = this.auditLog.length;
    this.auditLog = [];
    
    this.logAccess('clear_audit_log', {
      clearedEntries: clearedCount
    });

    return clearedCount;
  }

  /**
   * Rotate encryption key
   */
  rotateEncryptionKey() {
    const oldKeyHash = crypto.createHash('sha256').update(this.config.encryptionKey).digest('hex').substring(0, 8);
    const newKey = this.generateEncryptionKey();
    
    this.config.encryptionKey = newKey;
    
    this.logAccess('key_rotation', {
      oldKeyHash,
      newKeyHash: crypto.createHash('sha256').update(newKey).digest('hex').substring(0, 8)
    });

    return {
      success: true,
      oldKeyHash,
      newKey: newKey,
      rotatedAt: new Date().toISOString()
    };
  }

  /**
   * Get encryption statistics
   */
  getEncryptionStats() {
    const auditOperations = this.auditLog.reduce((acc, entry) => {
      acc[entry.operation] = (acc[entry.operation] || 0) + 1;
      return acc;
    }, {});

    return {
      encryptionEnabled: this.config.enableEncryption,
      algorithm: this.config.algorithm,
      keyLength: this.config.keyLength,
      auditLogSize: this.auditLog.length,
      operations: auditOperations,
      lastActivity: this.auditLog.length > 0 ? this.auditLog[this.auditLog.length - 1].timestamp : null
    };
  }

  /**
   * Validate configuration
   */
  validateConfig() {
    const issues = [];

    if (this.config.enableEncryption) {
      if (!this.config.encryptionKey) {
        issues.push('Encryption enabled but no encryption key provided');
      } else if (this.config.encryptionKey.length !== this.config.keyLength * 2) {
        issues.push(`Encryption key length invalid. Expected ${this.config.keyLength * 2} hex characters`);
      }

      if (!crypto.constants || !crypto.constants[this.config.algorithm.toUpperCase().replace('-', '_')]) {
        issues.push(`Unsupported encryption algorithm: ${this.config.algorithm}`);
      }
    }

    return {
      valid: issues.length === 0,
      issues
    };
  }
}

module.exports = LogEncryptionService;