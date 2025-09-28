const { v4: uuidv4 } = require('uuid');
const loggingConfig = require('../config/logging');

/**
 * Generate a correlation ID for request tracking
 */
function generateCorrelationId() {
  return uuidv4();
}

/**
 * Mask sensitive data in objects
 */
function maskSensitiveData(obj) {
  if (!loggingConfig.maskSensitiveData || !obj || typeof obj !== 'object') {
    return obj;
  }

  const masked = { ...obj };
  
  function maskRecursive(target) {
    for (const key in target) {
      if (target.hasOwnProperty(key)) {
        const lowerKey = key.toLowerCase();
        
        // Check if key contains sensitive information
        const isSensitive = loggingConfig.sensitiveFields.some(field => 
          lowerKey.includes(field.toLowerCase())
        );
        
        if (isSensitive) {
          target[key] = '[MASKED]';
        } else if (typeof target[key] === 'object' && target[key] !== null) {
          maskRecursive(target[key]);
        }
      }
    }
  }
  
  maskRecursive(masked);
  return masked;
}

/**
 * Extract relevant request information for logging
 */
function extractRequestInfo(req) {
  const requestInfo = {
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip || req.connection.remoteAddress,
    correlationId: req.correlationId,
    timestamp: new Date().toISOString()
  };

  // Add user information if available
  if (req.user) {
    requestInfo.userId = req.user.id;
    requestInfo.userEmail = req.user.email;
  }

  // Add request body for non-production environments
  if (loggingConfig.logRequestBody && req.body) {
    requestInfo.body = maskSensitiveData(req.body);
  }

  // Add query parameters
  if (req.query && Object.keys(req.query).length > 0) {
    requestInfo.query = maskSensitiveData(req.query);
  }

  return requestInfo;
}

/**
 * Extract relevant response information for logging
 */
function extractResponseInfo(req, res, duration) {
  const responseInfo = {
    method: req.method,
    url: req.url,
    statusCode: res.statusCode,
    duration: `${duration}ms`,
    correlationId: req.correlationId,
    timestamp: new Date().toISOString()
  };

  // Add user information if available
  if (req.user) {
    responseInfo.userId = req.user.id;
  }

  // Add response body for debugging (non-production only)
  if (loggingConfig.logResponseBody && res.locals.responseBody) {
    responseInfo.responseBody = maskSensitiveData(res.locals.responseBody);
  }

  return responseInfo;
}

/**
 * Format error information for logging
 */
function formatError(error, context = {}) {
  const errorInfo = {
    name: error.name,
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
    ...context
  };

  // Add additional error properties if available
  if (error.code) errorInfo.code = error.code;
  if (error.status) errorInfo.status = error.status;
  if (error.statusCode) errorInfo.statusCode = error.statusCode;

  return errorInfo;
}

/**
 * Format performance metrics for logging
 */
function formatPerformanceMetrics(operation, startTime, additionalMetrics = {}) {
  const duration = Date.now() - startTime;
  
  return {
    operation,
    duration: `${duration}ms`,
    timestamp: new Date().toISOString(),
    isSlowOperation: duration > loggingConfig.slowQueryThreshold,
    ...additionalMetrics
  };
}

/**
 * Create a timer for performance measurement
 */
function createTimer() {
  const startTime = Date.now();
  
  return {
    end: (operation, additionalMetrics = {}) => {
      return formatPerformanceMetrics(operation, startTime, additionalMetrics);
    }
  };
}

/**
 * Sanitize log data to prevent log injection
 */
function sanitizeLogData(data) {
  if (typeof data === 'string') {
    // Remove newlines and control characters that could break log format
    return data.replace(/[\r\n\t]/g, ' ').trim();
  }
  
  if (typeof data === 'object' && data !== null) {
    const sanitized = {};
    for (const key in data) {
      if (data.hasOwnProperty(key)) {
        sanitized[key] = sanitizeLogData(data[key]);
      }
    }
    return sanitized;
  }
  
  return data;
}

module.exports = {
  generateCorrelationId,
  maskSensitiveData,
  extractRequestInfo,
  extractResponseInfo,
  formatError,
  formatPerformanceMetrics,
  createTimer,
  sanitizeLogData
};