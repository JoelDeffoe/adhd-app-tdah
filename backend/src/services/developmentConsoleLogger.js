const winston = require('winston');
const path = require('path');
const util = require('util');

/**
 * Development Console Logger
 * Provides enhanced console logging for development with color coding,
 * proper formatting, and source file information
 */
class DevelopmentConsoleLogger {
  constructor(options = {}) {
    this.options = {
      enableColors: options.enableColors !== false,
      enableSourceInfo: options.enableSourceInfo !== false,
      maxDepth: options.maxDepth || 3,
      indentSize: options.indentSize || 2,
      timestampFormat: options.timestampFormat || 'YYYY-MM-DD HH:mm:ss.SSS',
      ...options
    };

    this.colors = {
      debug: '\x1b[36m',    // Cyan
      info: '\x1b[32m',     // Green
      warn: '\x1b[33m',     // Yellow
      error: '\x1b[31m',    // Red
      reset: '\x1b[0m',     // Reset
      bold: '\x1b[1m',      // Bold
      dim: '\x1b[2m',       // Dim
      underline: '\x1b[4m'  // Underline
    };

    this.levelPriority = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3
    };

    this.currentLogLevel = options.logLevel || 'debug';
    this.filters = {
      level: null,
      service: null,
      component: null
    };

    this.setupWinstonTransport();
  }

  /**
   * Setup Winston transport for development console
   */
  setupWinstonTransport() {
    const customFormat = winston.format.combine(
      winston.format.timestamp({
        format: this.options.timestampFormat
      }),
      winston.format.errors({ stack: true }),
      winston.format.printf((info) => this.formatLogEntry(info))
    );

    this.transport = new winston.transports.Console({
      format: customFormat,
      level: this.currentLogLevel
    });
  }

  /**
   * Format log entry with colors, indentation, and source info
   */
  formatLogEntry(info) {
    const { timestamp, level, message, service, component, operation, userId, correlationId, ...meta } = info;
    
    // Apply filters
    if (!this.shouldLog(level, service, component)) {
      return '';
    }

    const colorCode = this.options.enableColors ? this.colors[level] || this.colors.info : '';
    const resetCode = this.options.enableColors ? this.colors.reset : '';
    const boldCode = this.options.enableColors ? this.colors.bold : '';
    const dimCode = this.options.enableColors ? this.colors.dim : '';

    // Format timestamp
    const formattedTimestamp = `${dimCode}${timestamp}${resetCode}`;
    
    // Format level with color and padding
    const levelUpper = level.toUpperCase();
    const paddedLevel = levelUpper.padEnd(5);
    const formattedLevel = `${colorCode}${boldCode}[${paddedLevel}]${resetCode}`;

    // Format service/component info
    let serviceInfo = '';
    if (service || component) {
      const serviceText = service || 'unknown';
      const componentText = component ? `::${component}` : '';
      serviceInfo = `${dimCode}[${serviceText}${componentText}]${resetCode} `;
    }

    // Format operation info
    let operationInfo = '';
    if (operation) {
      operationInfo = `${dimCode}(${operation})${resetCode} `;
    }

    // Format user/correlation info
    let contextInfo = '';
    if (userId || correlationId) {
      const userText = userId ? `user:${userId}` : '';
      const corrText = correlationId ? `corr:${correlationId.substring(0, 8)}` : '';
      const separator = userId && correlationId ? ' ' : '';
      contextInfo = `${dimCode}[${userText}${separator}${corrText}]${resetCode} `;
    }

    // Format main message
    const formattedMessage = `${colorCode}${message}${resetCode}`;

    // Format metadata
    let metaString = '';
    if (Object.keys(meta).length > 0) {
      metaString = '\n' + this.formatMetadata(meta, 1);
    }

    // Get source info if enabled
    let sourceInfo = '';
    if (this.options.enableSourceInfo) {
      sourceInfo = this.getSourceInfo();
      if (sourceInfo) {
        sourceInfo = `${dimCode}${sourceInfo}${resetCode} `;
      }
    }

    return `${formattedTimestamp} ${formattedLevel} ${serviceInfo}${operationInfo}${contextInfo}${sourceInfo}${formattedMessage}${metaString}`;
  }

  /**
   * Format metadata with proper indentation
   */
  formatMetadata(obj, depth = 0) {
    const indent = ' '.repeat(depth * this.options.indentSize);
    const dimCode = this.options.enableColors ? this.colors.dim : '';
    const resetCode = this.options.enableColors ? this.colors.reset : '';

    if (obj === null) return `${dimCode}null${resetCode}`;
    if (obj === undefined) return `${dimCode}undefined${resetCode}`;
    
    if (typeof obj !== 'object') {
      if (typeof obj === 'string') {
        return `'${obj}'`;
      }
      return util.inspect(obj, { colors: this.options.enableColors });
    }

    if (depth > this.options.maxDepth) {
      return '[Object: max depth reached]';
    }

    if (Array.isArray(obj)) {
      if (obj.length === 0) return '[]';
      const items = obj.map(item => 
        `${indent}  - ${this.formatMetadata(item, depth + 1)}`
      ).join('\n');
      return `[\n${items}\n${indent}]`;
    }

    const keys = Object.keys(obj);
    if (keys.length === 0) return '{}';

    const items = keys.map(key => {
      const value = this.formatMetadata(obj[key], depth + 1);
      return `${indent}  ${dimCode}${key}:${resetCode} ${value}`;
    }).join('\n');

    return `{\n${items}\n${indent}}`;
  }

  /**
   * Get source file and line number information
   */
  getSourceInfo() {
    try {
      const stack = new Error().stack;
      const lines = stack.split('\n');
      
      // Find the first line that's not from this logger or winston
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('developmentConsoleLogger.js') || 
            line.includes('winston') || 
            line.includes('node_modules')) {
          continue;
        }

        // Extract file and line info
        const match = line.match(/at .* \((.+):(\d+):(\d+)\)/) || 
                     line.match(/at (.+):(\d+):(\d+)/);
        
        if (match) {
          const filePath = match[1];
          const lineNumber = match[2];
          const fileName = path.basename(filePath);
          return `${fileName}:${lineNumber}`;
        }
      }
    } catch (error) {
      // Silently fail if we can't get source info
    }
    return null;
  }

  /**
   * Check if log should be displayed based on filters
   */
  shouldLog(level, service, component) {
    // Check log level
    if (this.levelPriority[level] < this.levelPriority[this.currentLogLevel]) {
      return false;
    }

    // Check level filter
    if (this.filters.level && this.filters.level !== level) {
      return false;
    }

    // Check service filter
    if (this.filters.service && service !== this.filters.service) {
      return false;
    }

    // Check component filter
    if (this.filters.component && component !== this.filters.component) {
      return false;
    }

    return true;
  }

  /**
   * Set log level filter
   */
  setLogLevel(level) {
    if (this.levelPriority.hasOwnProperty(level)) {
      this.currentLogLevel = level;
      this.transport.level = level;
    }
  }

  /**
   * Set service filter
   */
  filterByService(service) {
    this.filters.service = service;
  }

  /**
   * Set component filter
   */
  filterByComponent(component) {
    this.filters.component = component;
  }

  /**
   * Set level filter
   */
  filterByLevel(level) {
    this.filters.level = level;
  }

  /**
   * Clear all filters
   */
  clearFilters() {
    this.filters = {
      level: null,
      service: null,
      component: null
    };
  }

  /**
   * Get Winston transport for integration
   */
  getTransport() {
    return this.transport;
  }

  /**
   * Log debug message
   */
  debug(message, meta = {}) {
    this.log('debug', message, meta);
  }

  /**
   * Log info message
   */
  info(message, meta = {}) {
    this.log('info', message, meta);
  }

  /**
   * Log warning message
   */
  warn(message, meta = {}) {
    this.log('warn', message, meta);
  }

  /**
   * Log error message
   */
  error(message, error = null, meta = {}) {
    const logData = { ...meta };
    if (error) {
      logData.error = {
        name: error.name,
        message: error.message,
        stack: error.stack
      };
    }
    this.log('error', message, logData);
  }

  /**
   * Internal log method
   */
  log(level, message, meta = {}) {
    const logEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...meta
    };

    // Use console directly for immediate output
    const formattedMessage = this.formatLogEntry(logEntry);
    if (formattedMessage) {
      console.log(formattedMessage);
    }
  }

  /**
   * Print current configuration
   */
  printConfig() {
    console.log('\n' + this.colors.bold + '=== Development Console Logger Configuration ===' + this.colors.reset);
    console.log(`Log Level: ${this.colors.info}${this.currentLogLevel}${this.colors.reset}`);
    console.log(`Colors Enabled: ${this.colors.info}${this.options.enableColors}${this.colors.reset}`);
    console.log(`Source Info: ${this.colors.info}${this.options.enableSourceInfo}${this.colors.reset}`);
    console.log(`Max Depth: ${this.colors.info}${this.options.maxDepth}${this.colors.reset}`);
    console.log(`Filters: ${this.colors.info}${JSON.stringify(this.filters)}${this.colors.reset}`);
    console.log(this.colors.bold + '================================================\n' + this.colors.reset);
  }
}

module.exports = DevelopmentConsoleLogger;