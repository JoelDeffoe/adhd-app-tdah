const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * Error Aggregation Service
 * Implements error categorization, grouping, frequency tracking, and severity classification
 */
class ErrorAggregationService {
  constructor(options = {}) {
    this.storageDir = options.storageDir || path.join(__dirname, '../../logs/aggregation');
    this.aggregationFile = path.join(this.storageDir, 'error-aggregation.json');
    this.criticalErrorsFile = path.join(this.storageDir, 'critical-errors.json');
    
    // Configuration
    this.config = {
      criticalErrorThreshold: options.criticalErrorThreshold || 10, // errors per hour
      groupingTimeWindow: options.groupingTimeWindow || 3600000, // 1 hour in ms
      maxGroupSize: options.maxGroupSize || 1000,
      severityLevels: {
        LOW: 1,
        MEDIUM: 2,
        HIGH: 3,
        CRITICAL: 4
      },
      ...options.config
    };

    // In-memory cache for performance
    this.errorGroups = new Map();
    this.criticalErrors = new Map();
    this.lastFlush = Date.now();
    
    this.initialize();
  }

  /**
   * Initialize the service and create necessary directories
   */
  async initialize() {
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      await this.loadExistingData();
      
      // Set up periodic flush to disk
      this.flushInterval = setInterval(() => {
        this.flushToDisk();
      }, 60000); // Flush every minute
      
    } catch (error) {
      console.error('Failed to initialize ErrorAggregationService:', error);
    }
  }

  /**
   * Load existing aggregation data from disk
   */
  async loadExistingData() {
    try {
      // Load error groups
      try {
        const aggregationData = await fs.readFile(this.aggregationFile, 'utf8');
        const parsed = JSON.parse(aggregationData);
        
        for (const [key, value] of Object.entries(parsed)) {
          this.errorGroups.set(key, {
            ...value,
            firstOccurrence: new Date(value.firstOccurrence),
            lastOccurrence: new Date(value.lastOccurrence),
            occurrences: value.occurrences.map(occ => ({
              ...occ,
              timestamp: new Date(occ.timestamp)
            })),
            contexts: new Set(value.contexts || []),
            affectedUsers: new Set(value.affectedUsers || [])
          });
        }
      } catch (error) {
        // File doesn't exist or is corrupted, start fresh
        console.log('No existing aggregation data found, starting fresh');
      }

      // Load critical errors
      try {
        const criticalData = await fs.readFile(this.criticalErrorsFile, 'utf8');
        const parsed = JSON.parse(criticalData);
        
        for (const [key, value] of Object.entries(parsed)) {
          this.criticalErrors.set(key, {
            ...value,
            flaggedAt: new Date(value.flaggedAt),
            lastOccurrence: new Date(value.lastOccurrence)
          });
        }
      } catch (error) {
        console.log('No existing critical errors data found, starting fresh');
      }
      
    } catch (error) {
      console.error('Error loading existing aggregation data:', error);
    }
  }

  /**
   * Process and aggregate an error
   */
  async aggregateError(errorData) {
    try {
      const processedError = this.preprocessError(errorData);
      const errorSignature = this.generateErrorSignature(processedError);
      const category = this.categorizeError(processedError);
      const severity = this.classifySeverity(processedError, category);

      // Get or create error group
      let errorGroup = this.errorGroups.get(errorSignature);
      
      if (!errorGroup) {
        errorGroup = {
          signature: errorSignature,
          category: category,
          severity: severity,
          count: 0,
          firstOccurrence: new Date(),
          lastOccurrence: new Date(),
          errorName: processedError.name,
          errorMessage: processedError.message,
          stackTrace: processedError.stack,
          occurrences: [],
          contexts: new Set(),
          affectedUsers: new Set(),
          resolutionStatus: 'UNRESOLVED',
          tags: this.generateTags(processedError, category)
        };
        
        this.errorGroups.set(errorSignature, errorGroup);
      }

      // Update error group
      errorGroup.count++;
      errorGroup.lastOccurrence = new Date();
      errorGroup.severity = Math.max(errorGroup.severity, severity);

      // Add occurrence details (keep only recent ones to prevent memory bloat)
      const occurrence = {
        timestamp: new Date(),
        userId: processedError.userId,
        sessionId: processedError.sessionId,
        context: processedError.context,
        userAgent: processedError.userAgent,
        ip: processedError.ip
      };

      errorGroup.occurrences.push(occurrence);
      
      // Keep only last 100 occurrences per group
      if (errorGroup.occurrences.length > 100) {
        errorGroup.occurrences = errorGroup.occurrences.slice(-100);
      }

      // Track contexts and affected users
      if (processedError.context) {
        errorGroup.contexts.add(JSON.stringify(processedError.context));
      }
      if (processedError.userId) {
        errorGroup.affectedUsers.add(processedError.userId);
      }

      // Check if this should be flagged as critical
      await this.checkCriticalError(errorGroup, processedError);

      return {
        signature: errorSignature,
        category: category,
        severity: severity,
        count: errorGroup.count,
        isCritical: this.criticalErrors.has(errorSignature)
      };

    } catch (error) {
      console.error('Error in aggregateError:', error);
      throw error;
    }
  }

  /**
   * Preprocess error data to normalize format
   */
  preprocessError(errorData) {
    return {
      name: errorData.name || errorData.error?.name || 'UnknownError',
      message: errorData.message || errorData.error?.message || 'No message provided',
      stack: errorData.stack || errorData.error?.stack || '',
      code: errorData.code || errorData.error?.code,
      statusCode: errorData.statusCode || errorData.status,
      userId: errorData.userId,
      sessionId: errorData.sessionId || errorData.correlationId,
      context: errorData.context || {},
      userAgent: errorData.userAgent,
      ip: errorData.ip,
      service: errorData.service || 'unknown',
      operation: errorData.operation,
      timestamp: new Date(errorData.timestamp || Date.now())
    };
  }

  /**
   * Generate a unique signature for error grouping
   */
  generateErrorSignature(errorData) {
    // Create signature based on error name, message pattern, and stack trace pattern
    const normalizedMessage = this.normalizeErrorMessage(errorData.message);
    const stackPattern = this.extractStackPattern(errorData.stack);
    
    const signatureData = {
      name: errorData.name,
      messagePattern: normalizedMessage,
      stackPattern: stackPattern,
      code: errorData.code,
      service: errorData.service
    };

    return crypto
      .createHash('sha256')
      .update(JSON.stringify(signatureData))
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Normalize error message to group similar errors
   */
  normalizeErrorMessage(message) {
    if (!message) return '';
    
    return message
      // Replace URLs with placeholder (must come before path replacement)
      .replace(/https?:\/\/[^\s]+/g, '{URL}')
      // Replace file paths with placeholder
      .replace(/\/[^\s]+/g, '{PATH}')
      // Replace UUIDs with placeholder (must come before number replacement)
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{UUID}')
      // Replace timestamps with placeholder (must come before number replacement)
      .replace(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(\.\d{3})?[Z]?/gi, '{TIMESTAMP}')
      // Replace numbers with placeholder
      .replace(/\d+/g, '{NUMBER}')
      .toLowerCase()
      .trim();
  }

  /**
   * Extract pattern from stack trace for grouping
   */
  extractStackPattern(stack) {
    if (!stack) return '';
    
    const lines = stack.split('\n').slice(0, 5); // Take first 5 lines
    return lines
      .map(line => line.replace(/:\d+:\d+/g, ':LINE:COL')) // Remove line/column numbers
      .join('|');
  }

  /**
   * Categorize error based on type and context
   */
  categorizeError(errorData) {
    const { name, message, code, statusCode, context, service } = errorData;
    
    // Authentication/Authorization errors (check before general status codes)
    if (name.includes('Auth') || name.includes('Permission') || name.includes('Unauthorized') ||
        message.includes('auth') || message.includes('permission') || statusCode === 401 || statusCode === 403) {
      return 'AUTH_ERROR';
    }

    // Database errors (check before general network errors)
    if (name.includes('Database') || name.includes('SQL') || name.includes('Connection') ||
        message.includes('database') || message.includes('connection')) {
      return 'DATABASE_ERROR';
    }

    // Network/API errors
    if (statusCode >= 400 || name.includes('Network') || name.includes('Request')) {
      if (statusCode >= 500) return 'SERVER_ERROR';
      if (statusCode >= 400) return 'CLIENT_ERROR';
      return 'NETWORK_ERROR';
    }

    // Validation errors
    if (name.includes('Validation') || name.includes('Invalid') || 
        message.includes('validation') || message.includes('invalid')) {
      return 'VALIDATION_ERROR';
    }

    // System errors
    if (name.includes('System') || name.includes('Internal') || name.includes('Runtime') ||
        message.includes('system') || message.includes('internal')) {
      return 'SYSTEM_ERROR';
    }

    // Business logic errors
    if (context?.operation || service) {
      return 'BUSINESS_LOGIC_ERROR';
    }

    // Default category
    return 'UNKNOWN_ERROR';
  }

  /**
   * Classify error severity
   */
  classifySeverity(errorData, category) {
    const { statusCode, name, message, context } = errorData;

    // Critical severity conditions
    if (
      statusCode >= 500 ||
      name.includes('Fatal') ||
      name.includes('Critical') ||
      message.includes('fatal') ||
      message.includes('critical') ||
      category === 'SYSTEM_ERROR'
    ) {
      return this.config.severityLevels.CRITICAL;
    }

    // High severity conditions
    if (
      statusCode >= 400 ||
      category === 'DATABASE_ERROR' ||
      category === 'AUTH_ERROR' ||
      name.includes('Error') && !name.includes('Validation')
    ) {
      return this.config.severityLevels.HIGH;
    }

    // Medium severity conditions
    if (
      category === 'VALIDATION_ERROR' ||
      category === 'CLIENT_ERROR' ||
      name.includes('Warning')
    ) {
      return this.config.severityLevels.MEDIUM;
    }

    // Default to low severity
    return this.config.severityLevels.LOW;
  }

  /**
   * Generate tags for error categorization
   */
  generateTags(errorData, category) {
    const tags = [category.toLowerCase()];
    
    if (errorData.service) tags.push(`service:${errorData.service}`);
    if (errorData.operation) tags.push(`operation:${errorData.operation}`);
    if (errorData.statusCode) tags.push(`status:${errorData.statusCode}`);
    if (errorData.code) tags.push(`code:${errorData.code}`);
    
    return tags;
  }

  /**
   * Check if error should be flagged as critical
   */
  async checkCriticalError(errorGroup, errorData) {
    const now = Date.now();
    const oneHour = 3600000;
    
    // Count recent occurrences (last hour)
    const recentOccurrences = errorGroup.occurrences.filter(
      occ => (now - occ.timestamp.getTime()) < oneHour
    ).length;

    // Flag as critical if threshold exceeded
    if (recentOccurrences >= this.config.criticalErrorThreshold ||
        errorGroup.severity === this.config.severityLevels.CRITICAL) {
      
      if (!this.criticalErrors.has(errorGroup.signature)) {
        const criticalError = {
          signature: errorGroup.signature,
          category: errorGroup.category,
          severity: errorGroup.severity,
          count: errorGroup.count,
          recentCount: recentOccurrences,
          flaggedAt: new Date(),
          lastOccurrence: errorGroup.lastOccurrence,
          errorName: errorGroup.errorName,
          errorMessage: errorGroup.errorMessage,
          affectedUsersCount: errorGroup.affectedUsers.size,
          status: 'ACTIVE',
          alertsSent: 0
        };
        
        this.criticalErrors.set(errorGroup.signature, criticalError);
        
        // Emit critical error event for alerting
        this.emitCriticalErrorAlert(criticalError);
      } else {
        // Update existing critical error
        const criticalError = this.criticalErrors.get(errorGroup.signature);
        criticalError.count = errorGroup.count;
        criticalError.recentCount = recentOccurrences;
        criticalError.lastOccurrence = errorGroup.lastOccurrence;
        criticalError.affectedUsersCount = errorGroup.affectedUsers.size;
      }
    }
  }

  /**
   * Emit critical error alert (can be extended to integrate with alerting systems)
   */
  emitCriticalErrorAlert(criticalError) {
    console.error('CRITICAL ERROR DETECTED:', {
      signature: criticalError.signature,
      category: criticalError.category,
      count: criticalError.count,
      recentCount: criticalError.recentCount,
      affectedUsers: criticalError.affectedUsersCount,
      errorName: criticalError.errorName,
      errorMessage: criticalError.errorMessage
    });
    
    // TODO: Integrate with external alerting systems (email, Slack, PagerDuty, etc.)
  }

  /**
   * Get error groups with filtering and pagination
   */
  getErrorGroups(options = {}) {
    const {
      category,
      severity,
      timeRange,
      limit = 50,
      offset = 0,
      sortBy = 'count',
      sortOrder = 'desc'
    } = options;

    let groups = Array.from(this.errorGroups.values());

    // Apply filters
    if (category) {
      groups = groups.filter(group => group.category === category);
    }
    
    if (severity) {
      groups = groups.filter(group => group.severity >= severity);
    }
    
    if (timeRange) {
      const { start, end } = timeRange;
      groups = groups.filter(group => 
        group.lastOccurrence >= start && group.lastOccurrence <= end
      );
    }

    // Sort groups
    groups.sort((a, b) => {
      let aVal = a[sortBy];
      let bVal = b[sortBy];
      
      if (sortBy === 'affectedUsers') {
        aVal = a.affectedUsers.size;
        bVal = b.affectedUsers.size;
      }
      
      return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
    });

    // Apply pagination
    const total = groups.length;
    groups = groups.slice(offset, offset + limit);

    // Convert Sets to arrays for JSON serialization
    return {
      groups: groups.map(group => ({
        ...group,
        contexts: Array.from(group.contexts),
        affectedUsers: Array.from(group.affectedUsers),
        affectedUsersCount: group.affectedUsers.size
      })),
      total,
      limit,
      offset
    };
  }

  /**
   * Get critical errors
   */
  getCriticalErrors() {
    return Array.from(this.criticalErrors.values());
  }

  /**
   * Get error statistics
   */
  getErrorStatistics(timeRange) {
    const groups = Array.from(this.errorGroups.values());
    let filteredGroups = groups;

    if (timeRange) {
      const { start, end } = timeRange;
      filteredGroups = groups.filter(group => 
        group.lastOccurrence >= start && group.lastOccurrence <= end
      );
    }

    const stats = {
      totalGroups: filteredGroups.length,
      totalErrors: filteredGroups.reduce((sum, group) => sum + group.count, 0),
      criticalErrors: this.criticalErrors.size,
      categoryCounts: {},
      severityCounts: {},
      topErrors: filteredGroups
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
        .map(group => ({
          signature: group.signature,
          category: group.category,
          severity: group.severity,
          count: group.count,
          errorName: group.errorName,
          errorMessage: group.errorMessage
        }))
    };

    // Calculate category counts
    filteredGroups.forEach(group => {
      stats.categoryCounts[group.category] = (stats.categoryCounts[group.category] || 0) + group.count;
    });

    // Calculate severity counts
    filteredGroups.forEach(group => {
      const severityName = Object.keys(this.config.severityLevels)
        .find(key => this.config.severityLevels[key] === group.severity) || 'UNKNOWN';
      stats.severityCounts[severityName] = (stats.severityCounts[severityName] || 0) + group.count;
    });

    return stats;
  }

  /**
   * Flush aggregation data to disk
   */
  async flushToDisk() {
    try {
      // Convert Maps to objects for JSON serialization
      const aggregationData = {};
      for (const [key, value] of this.errorGroups.entries()) {
        aggregationData[key] = {
          ...value,
          contexts: Array.from(value.contexts),
          affectedUsers: Array.from(value.affectedUsers)
        };
      }

      const criticalData = {};
      for (const [key, value] of this.criticalErrors.entries()) {
        criticalData[key] = value;
      }

      // Write to disk
      await fs.writeFile(this.aggregationFile, JSON.stringify(aggregationData, null, 2));
      await fs.writeFile(this.criticalErrorsFile, JSON.stringify(criticalData, null, 2));
      
      this.lastFlush = Date.now();
      
    } catch (error) {
      console.error('Error flushing aggregation data to disk:', error);
    }
  }

  /**
   * Cleanup old data
   */
  async cleanup(retentionDays = 30) {
    const cutoffDate = new Date(Date.now() - (retentionDays * 24 * 60 * 60 * 1000));
    
    // Remove old error groups
    for (const [signature, group] of this.errorGroups.entries()) {
      if (group.lastOccurrence < cutoffDate) {
        this.errorGroups.delete(signature);
      }
    }

    // Remove resolved critical errors older than retention period
    for (const [signature, criticalError] of this.criticalErrors.entries()) {
      if (criticalError.status === 'RESOLVED' && criticalError.lastOccurrence < cutoffDate) {
        this.criticalErrors.delete(signature);
      }
    }

    await this.flushToDisk();
  }

  /**
   * Shutdown the service
   */
  async shutdown() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    await this.flushToDisk();
  }
}

module.exports = ErrorAggregationService;