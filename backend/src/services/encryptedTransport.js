const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const LogEncryptionService = require('./logEncryption');

/**
 * Encrypted Winston Transport
 * Extends DailyRotateFile to add encryption capabilities
 */
class EncryptedTransport extends DailyRotateFile {
  constructor(options = {}) {
    super(options);
    
    this.encryptionService = options.encryptionService || new LogEncryptionService(options.encryption);
    this.encryptSensitiveLogs = options.encryptSensitiveLogs !== false;
    this.name = 'encryptedTransport';
  }

  log(info, callback) {
    // Process the log entry for encryption if needed
    let processedInfo = { ...info };

    if (this.encryptionService.shouldEncryptLog(info)) {
      try {
        const encryptedData = this.encryptionService.encryptLogData(info, {
          level: info.level,
          timestamp: info.timestamp,
          service: info.service
        });

        // Replace the log content with encrypted version
        processedInfo = {
          timestamp: info.timestamp,
          level: info.level,
          service: info.service,
          encrypted: true,
          ...encryptedData
        };
      } catch (error) {
        // If encryption fails, log the error and continue with original log
        console.error('Log encryption failed:', error);
        processedInfo.encryptionError = error.message;
      }
    }

    // Call parent log method with processed info
    super.log(processedInfo, callback);
  }

  /**
   * Get encryption statistics
   */
  getEncryptionStats() {
    return this.encryptionService.getEncryptionStats();
  }

  /**
   * Rotate encryption key
   */
  rotateEncryptionKey() {
    return this.encryptionService.rotateEncryptionKey();
  }

  /**
   * Get audit log
   */
  getAuditLog(limit) {
    return this.encryptionService.getAuditLog(limit);
  }
}

module.exports = EncryptedTransport;