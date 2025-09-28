const path = require('path');

const loggingConfig = {
  // Log levels: error, warn, info, http, verbose, debug, silly
  level: process.env.LOG_LEVEL || 'info',
  
  // Environment settings
  environment: process.env.NODE_ENV || 'development',
  
  // File settings
  logDirectory: path.join(__dirname, '../../logs'),
  maxFileSize: '10m',
  maxFiles: '7d',
  
  // Console logging settings
  enableConsole: process.env.NODE_ENV !== 'production',
  consoleLevel: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
  
  // Performance settings
  enablePerformanceLogging: true,
  slowQueryThreshold: 1000, // ms
  
  // Security settings
  maskSensitiveData: true,
  sensitiveFields: [
    'password',
    'token',
    'authorization',
    'cookie',
    'session',
    'secret',
    'key',
    'apiKey'
  ],
  
  // Request logging settings
  logRequests: true,
  logResponses: true,
  logRequestBody: process.env.NODE_ENV !== 'production',
  logResponseBody: false,
  
  // Database logging settings
  logDatabaseQueries: true,
  logSlowQueries: true,
  
  // Error handling settings
  logUncaughtExceptions: true,
  logUnhandledRejections: true
};

module.exports = loggingConfig;