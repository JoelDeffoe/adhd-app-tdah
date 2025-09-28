const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');
const EncryptedTransport = require('./encryptedTransport');
const IntegratedLogManager = require('./integratedLogManager');
const ErrorAggregationIntegration = require('./errorAggregationIntegration');
const PrivacyProtectionService = require('./privacyProtection');
const LogEncryptionService = require('./logEncryption');
const LogRetentionService = require('./logRetention');

// Initialize integrated log management system
const logManager = new IntegratedLogManager();

// Initialize error aggregation integration
const errorAggregation = new ErrorAggregationIntegration({
  storageDir: path.join(__dirname, '../../logs/aggregation'),
  criticalErrorThreshold: 10
});

// Initialize privacy protection service
const privacyProtection = new PrivacyProtectionService({
  enablePIIDetection: process.env.NODE_ENV === 'production',
  enableTokenRedaction: true,
  preserveLength: false // Use [REDACTED] for production
});

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Initialize log encryption service
const logEncryption = new LogEncryptionService({
  enableEncryption: process.env.NODE_ENV === 'production',
  encryptSensitiveLogs: true,
  encryptionKey: process.env.LOG_ENCRYPTION_KEY
});

// Initialize log retention service
const logRetention = new LogRetentionService({
  retentionDays: parseInt(process.env.LOG_RETENTION_DAYS) || 30,
  enableAutoPurge: process.env.ENABLE_AUTO_PURGE !== 'false',
  logsDirectory: logsDir
});
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Initialize log management system
logManager.initialize().catch(error => {
  console.error('Failed to initialize log management system:', error);
});

// Custom format for structured JSON logging
const jsonFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Custom format for console logging (development)
const consoleFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    return `${timestamp} [${level}]: ${message} ${metaStr}`;
  })
);

// File transport for all logs with daily rotation
const fileTransport = new DailyRotateFile({
  filename: path.join(logsDir, 'application-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '10m',
  maxFiles: '7d',
  format: jsonFormat,
  level: 'info'
});

// File transport for error logs only with encryption
const errorFileTransport = new EncryptedTransport({
  filename: path.join(logsDir, 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '10m',
  maxFiles: '7d',
  format: jsonFormat,
  level: 'error',
  encryptionService: logEncryption,
  encryptSensitiveLogs: true
});

// Console transport for development
const consoleTransport = new winston.transports.Console({
  format: consoleFormat,
  level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug'
});

// Create the logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: jsonFormat,
  defaultMeta: {
    service: 'focusmate-backend',
    environment: process.env.NODE_ENV || 'development'
  },
  transports: [
    fileTransport,
    errorFileTransport,
    consoleTransport
  ],
  // Handle uncaught exceptions and rejections
  exceptionHandlers: [
    new DailyRotateFile({
      filename: path.join(logsDir, 'exceptions-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '10m',
      maxFiles: '7d',
      format: jsonFormat
    })
  ],
  rejectionHandlers: [
    new DailyRotateFile({
      filename: path.join(logsDir, 'rejections-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '10m',
      maxFiles: '7d',
      format: jsonFormat
    })
  ]
});

// Enhanced logging methods with structured data and privacy protection
const enhancedLogger = {
  // Basic logging methods
  debug: (message, meta = {}) => {
    const sanitizedMeta = privacyProtection.sanitizeForLogging(meta);
    logger.debug(message, sanitizedMeta);
  },
  info: (message, meta = {}) => {
    const sanitizedMeta = privacyProtection.sanitizeForLogging(meta);
    logger.info(message, sanitizedMeta);
  },
  warn: (message, meta = {}) => {
    const sanitizedMeta = privacyProtection.sanitizeForLogging(meta);
    logger.warn(message, sanitizedMeta);
  },
  error: (message, error = null, meta = {}) => {
    const logData = { ...meta };
    if (error) {
      logData.error = {
        name: error.name,
        message: error.message,
        stack: error.stack
      };
    }
    
    // Sanitize log data for privacy
    const sanitizedLogData = privacyProtection.sanitizeForLogging(logData);
    
    // Process error for aggregation (use original data for analysis)
    const errorInfo = {
      message,
      error,
      ...logData,
      timestamp: new Date()
    };
    errorAggregation.processError(errorInfo).catch(console.error);
    
    logger.error(message, sanitizedLogData);
  },

  // Specialized logging methods with privacy protection
  request: (req, meta = {}) => {
    const requestData = {
      method: req.method,
      url: req.url,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      userId: req.user?.id || 'anonymous',
      correlationId: req.correlationId,
      ...meta
    };
    
    const sanitizedData = privacyProtection.sanitizeForLogging(requestData);
    logger.info('Incoming request', sanitizedData);
  },

  response: (req, res, duration, meta = {}) => {
    const responseData = {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userId: req.user?.id || 'anonymous',
      correlationId: req.correlationId,
      ...meta
    };
    
    const sanitizedData = privacyProtection.sanitizeForLogging(responseData);
    logger.info('Outgoing response', sanitizedData);
  },

  database: (operation, duration, meta = {}) => {
    const dbData = {
      operation,
      duration: `${duration}ms`,
      ...meta
    };
    
    const sanitizedData = privacyProtection.sanitizeForLogging(dbData);
    logger.info('Database operation', sanitizedData);
  },

  performance: (operation, metrics, meta = {}) => {
    const perfData = {
      operation,
      metrics,
      ...meta
    };
    
    const sanitizedData = privacyProtection.sanitizeForLogging(perfData);
    logger.info('Performance metrics', sanitizedData);
  },

  audit: (action, userId, meta = {}) => {
    const auditData = {
      action,
      userId,
      timestamp: new Date().toISOString(),
      ...meta
    };
    
    const sanitizedData = privacyProtection.sanitizeForLogging(auditData);
    logger.info('Audit log', sanitizedData);
  }
};

// Add log management methods to enhanced logger
enhancedLogger.management = {
  getStatus: () => logManager.getSystemStatus(),
  getHealthCheck: () => logManager.getHealthCheck(),
  forceCleanup: () => logManager.forceCleanup(),
  performMaintenance: () => logManager.performMaintenance(),
  updateConfig: (config) => logManager.updateConfiguration(config),
  shutdown: async () => {
    await errorAggregation.shutdown();
    return logManager.shutdown();
  }
};

// Add error aggregation methods to enhanced logger
enhancedLogger.errorAggregation = {
  getErrorGroups: (options) => errorAggregation.getErrorGroups(options),
  getCriticalErrors: () => errorAggregation.getCriticalErrors(),
  getErrorStatistics: (timeRange) => errorAggregation.getErrorStatistics(timeRange),
  getErrorGroup: (signature) => errorAggregation.getErrorGroup(signature),
  markErrorResolved: (signature, resolutionData) => errorAggregation.markErrorResolved(signature, resolutionData),
  reResolveError: (signature, newResolutionData) => errorAggregation.reResolveError(signature, newResolutionData),
  getResolutionStatus: (signature) => errorAggregation.getResolutionStatus(signature),
  getSuggestedFixes: (signature, options) => errorAggregation.getSuggestedFixes(signature, options),
  getFixEffectiveness: (options) => errorAggregation.getFixEffectiveness(options),
  createExpressMiddleware: () => errorAggregation.createExpressMiddleware()
};

// Add privacy protection methods to enhanced logger
enhancedLogger.privacy = {
  sanitizeData: (data, options) => privacyProtection.sanitizeForLogging(data, options),
  validateSanitization: (data) => privacyProtection.validateSanitization(data),
  createSafeSummary: (data) => privacyProtection.createPrivacySafeSummary(data),
  generateDataHash: (data) => privacyProtection.generateDataHash(data),
  updateConfig: (config) => privacyProtection.updateConfig(config),
  getConfig: () => privacyProtection.getConfig(),
  getStats: () => privacyProtection.getStats()
};

// Add encryption methods to enhanced logger
enhancedLogger.encryption = {
  encryptData: (data, metadata) => logEncryption.encryptLogData(data, metadata),
  decryptData: (encryptedData) => logEncryption.decryptLogData(encryptedData),
  createSecurePayload: (logs, metadata) => logEncryption.createSecurePayload(logs, metadata),
  verifySecurePayload: (payload) => logEncryption.verifySecurePayload(payload),
  shouldEncrypt: (logEntry) => logEncryption.shouldEncryptLog(logEntry),
  rotateKey: () => logEncryption.rotateEncryptionKey(),
  getAuditLog: (limit) => logEncryption.getAuditLog(limit),
  getStats: () => logEncryption.getEncryptionStats(),
  validateConfig: () => logEncryption.validateConfig()
};

// Add retention methods to enhanced logger
enhancedLogger.retention = {
  requestUserDeletion: (userId, reason) => logRetention.requestUserLogDeletion(userId, reason),
  purgeOldLogs: () => logRetention.purgeOldLogs(),
  setRetentionPolicy: (level, days) => logRetention.setRetentionPolicy(level, days),
  getRetentionPolicy: (level) => logRetention.getRetentionPolicy(level),
  getDeletionStatus: (requestId) => logRetention.getDeletionRequestStatus(requestId),
  getUserDeletionRequests: (userId) => logRetention.getUserDeletionRequests(userId),
  getStats: () => logRetention.getRetentionStats(),
  updateConfig: (config) => logRetention.updateConfig(config),
  shutdown: () => logRetention.shutdown()
};

// Log startup information
enhancedLogger.info('Logger initialized', {
  logLevel: process.env.LOG_LEVEL || 'info',
  environment: process.env.NODE_ENV || 'development',
  logsDirectory: logsDir
});

module.exports = enhancedLogger;