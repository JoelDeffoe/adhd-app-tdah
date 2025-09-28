const ErrorAggregationService = require('./errorAggregationService');
const ErrorResolutionTracker = require('./errorResolutionTracker');
const path = require('path');

/**
 * Integration layer for Error Aggregation Service with existing logging infrastructure
 */
class ErrorAggregationIntegration {
  constructor(options = {}) {
    this.aggregationService = new ErrorAggregationService({
      storageDir: options.storageDir || path.join(__dirname, '../../logs/aggregation'),
      criticalErrorThreshold: options.criticalErrorThreshold || 10,
      ...options
    });
    
    this.resolutionTracker = new ErrorResolutionTracker({
      storageDir: options.resolutionStorageDir || path.join(__dirname, '../../logs/resolution'),
      ...options.resolutionOptions
    });
    
    this.initialized = false;
    this.initialize();
  }

  /**
   * Initialize the integration
   */
  async initialize() {
    try {
      // Wait for aggregation service to initialize
      await new Promise(resolve => setTimeout(resolve, 100));
      this.initialized = true;
      console.log('Error aggregation integration initialized');
    } catch (error) {
      console.error('Failed to initialize error aggregation integration:', error);
    }
  }

  /**
   * Process error from existing logger format
   */
  async processError(logData) {
    if (!this.initialized) {
      console.warn('Error aggregation not initialized, skipping error processing');
      return;
    }

    try {
      // Extract error information from log data
      const errorData = this.extractErrorData(logData);
      
      if (errorData) {
        const result = await this.aggregationService.aggregateError(errorData);
        
        // Check if this error was previously resolved and is now recurring
        const resolutionStatus = this.resolutionTracker.getResolutionStatus(result.signature);
        if (resolutionStatus.hasResolution && resolutionStatus.status === 'RESOLVED') {
          await this.resolutionTracker.trackErrorRecurrence(result.signature, {
            context: errorData.context,
            timestamp: errorData.timestamp
          });
        }
        
        return result;
      }
    } catch (error) {
      console.error('Error processing error aggregation:', error);
    }
  }

  /**
   * Extract error data from various log formats
   */
  extractErrorData(logData) {
    // Handle different log data formats
    let errorInfo = {};

    // If logData is a string message
    if (typeof logData === 'string') {
      errorInfo = {
        message: logData,
        name: 'UnknownError'
      };
    }
    // If logData is an object with error information
    else if (typeof logData === 'object') {
      errorInfo = {
        name: logData.error?.name || logData.name || 'UnknownError',
        message: logData.error?.message || logData.message || 'No message provided',
        stack: logData.error?.stack || logData.stack,
        code: logData.error?.code || logData.code,
        statusCode: logData.statusCode || logData.status,
        userId: logData.userId,
        sessionId: logData.sessionId || logData.correlationId,
        context: this.extractContext(logData),
        userAgent: logData.userAgent,
        ip: logData.ip,
        service: logData.service || 'unknown',
        operation: logData.operation,
        timestamp: logData.timestamp ? new Date(logData.timestamp) : new Date()
      };
    }

    // Only process actual errors (not info/debug logs)
    if (this.isErrorLog(errorInfo)) {
      return errorInfo;
    }

    return null;
  }

  /**
   * Extract context information from log data
   */
  extractContext(logData) {
    const context = {};

    // Common context fields
    const contextFields = [
      'method', 'url', 'endpoint', 'component', 'screen', 'operation',
      'database', 'query', 'timeout', 'memoryUsage', 'networkStatus',
      'deviceInfo', 'appVersion', 'environment'
    ];

    contextFields.forEach(field => {
      if (logData[field] !== undefined) {
        context[field] = logData[field];
      }
    });

    // Include any additional context
    if (logData.context && typeof logData.context === 'object') {
      Object.assign(context, logData.context);
    }

    return Object.keys(context).length > 0 ? context : undefined;
  }

  /**
   * Determine if log entry represents an error
   */
  isErrorLog(errorInfo) {
    // Check if it's explicitly an error
    if (errorInfo.name && errorInfo.name.toLowerCase().includes('error')) {
      return true;
    }

    // Check for error status codes
    if (errorInfo.statusCode && errorInfo.statusCode >= 400) {
      return true;
    }

    // Check for error-like messages
    const errorKeywords = ['error', 'exception', 'failed', 'failure', 'crash', 'fatal'];
    const message = (errorInfo.message || '').toLowerCase();
    
    return errorKeywords.some(keyword => message.includes(keyword));
  }

  /**
   * Get error groups with optional filtering
   */
  getErrorGroups(options = {}) {
    return this.aggregationService.getErrorGroups(options);
  }

  /**
   * Get critical errors
   */
  getCriticalErrors() {
    return this.aggregationService.getCriticalErrors();
  }

  /**
   * Get error statistics
   */
  getErrorStatistics(timeRange) {
    return this.aggregationService.getErrorStatistics(timeRange);
  }

  /**
   * Get error group by signature
   */
  getErrorGroup(signature) {
    const groups = this.aggregationService.getErrorGroups();
    return groups.groups.find(group => group.signature === signature);
  }

  /**
   * Mark error as resolved with comprehensive tracking
   */
  async markErrorResolved(signature, resolutionData) {
    const groups = Array.from(this.aggregationService.errorGroups.values());
    const group = groups.find(g => g.signature === signature);
    
    if (group) {
      // Update aggregation service
      group.resolutionStatus = 'RESOLVED';
      group.resolutionNotes = resolutionData.resolutionNotes || resolutionData;
      group.resolvedAt = new Date();
      
      // Remove from critical errors if present
      if (this.aggregationService.criticalErrors.has(signature)) {
        const criticalError = this.aggregationService.criticalErrors.get(signature);
        criticalError.status = 'RESOLVED';
        criticalError.resolvedAt = new Date();
      }
      
      // Track resolution in resolution tracker
      if (typeof resolutionData === 'object') {
        await this.resolutionTracker.markErrorResolved(signature, resolutionData);
      } else {
        // Handle legacy string-only resolution notes
        await this.resolutionTracker.markErrorResolved(signature, {
          resolutionNotes: resolutionData,
          fixDescription: resolutionData,
          fixType: 'UNKNOWN',
          developerId: 'unknown',
          rootCause: 'Not specified',
          preventionMeasures: 'Not specified'
        });
      }
      
      await this.aggregationService.flushToDisk();
      return true;
    }
    
    return false;
  }

  /**
   * Re-resolve an error with updated fix information
   */
  async reResolveError(signature, newResolutionData) {
    try {
      const result = await this.resolutionTracker.reResolveError(signature, newResolutionData);
      
      // Update aggregation service as well
      const groups = Array.from(this.aggregationService.errorGroups.values());
      const group = groups.find(g => g.signature === signature);
      
      if (group) {
        group.resolutionStatus = 'RESOLVED';
        group.resolutionNotes = newResolutionData.resolutionNotes;
        group.resolvedAt = new Date();
        
        await this.aggregationService.flushToDisk();
      }
      
      return result;
    } catch (error) {
      console.error('Error re-resolving error:', error);
      throw error;
    }
  }

  /**
   * Get comprehensive resolution status for an error
   */
  getResolutionStatus(signature) {
    return this.resolutionTracker.getResolutionStatus(signature);
  }

  /**
   * Get suggested fixes for an error
   */
  getSuggestedFixes(signature, options = {}) {
    return this.resolutionTracker.getSuggestedFixes(signature, options);
  }

  /**
   * Get fix effectiveness metrics
   */
  getFixEffectiveness(options = {}) {
    return this.resolutionTracker.getFixEffectiveness(options);
  }

  /**
   * Create middleware for Express.js integration
   */
  createExpressMiddleware() {
    return (req, res, next) => {
      // Store original res.json to capture response data
      const originalJson = res.json;
      
      res.json = function(data) {
        // Check if response indicates an error
        if (res.statusCode >= 400) {
          const errorData = {
            statusCode: res.statusCode,
            message: data?.message || data?.error || 'HTTP Error',
            name: data?.name || 'HTTPError',
            userId: req.user?.id,
            sessionId: req.sessionID || req.correlationId,
            method: req.method,
            url: req.url,
            userAgent: req.get('User-Agent'),
            ip: req.ip,
            service: 'express-api',
            timestamp: new Date()
          };
          
          // Process error asynchronously
          this.processError(errorData).catch(console.error);
        }
        
        return originalJson.call(this, data);
      }.bind(this);
      
      next();
    };
  }

  /**
   * Create Winston transport for automatic error aggregation
   */
  createWinstonTransport() {
    const { Transport } = require('winston');
    const integration = this;
    
    return class ErrorAggregationTransport extends Transport {
      log(info, callback) {
        // Only process error level logs
        if (info.level === 'error') {
          integration.processError(info).catch(console.error);
        }
        
        callback();
      }
    };
  }

  /**
   * Shutdown the integration
   */
  async shutdown() {
    if (this.aggregationService) {
      await this.aggregationService.shutdown();
    }
    if (this.resolutionTracker) {
      await this.resolutionTracker.shutdown();
    }
  }
}

module.exports = ErrorAggregationIntegration;