const DevelopmentConsoleLogger = require('./developmentConsoleLogger');

/**
 * Enhanced Log Filtering and Highlighting System
 * Extends the development console logger with advanced filtering and highlighting capabilities
 */
class LogFilteringAndHighlighting extends DevelopmentConsoleLogger {
  constructor(options = {}) {
    super(options);
    
    this.advancedFilters = {
      keywords: [],
      excludeKeywords: [],
      timeRange: null,
      userIds: [],
      correlationIds: [],
      operations: [],
      errorTypes: [],
      customFilters: []
    };

    this.highlightRules = [
      {
        name: 'critical-errors',
        pattern: /critical|fatal|emergency/i,
        color: '\x1b[41m\x1b[37m', // Red background, white text
        enabled: true
      },
      {
        name: 'performance-warnings',
        pattern: /slow|timeout|performance|memory/i,
        color: '\x1b[43m\x1b[30m', // Yellow background, black text
        enabled: true
      },
      {
        name: 'security-alerts',
        pattern: /security|auth|unauthorized|forbidden/i,
        color: '\x1b[45m\x1b[37m', // Magenta background, white text
        enabled: true
      },
      {
        name: 'database-operations',
        pattern: /database|query|transaction|connection/i,
        color: '\x1b[46m\x1b[30m', // Cyan background, black text
        enabled: true
      },
      {
        name: 'api-requests',
        pattern: /request|response|endpoint|api/i,
        color: '\x1b[42m\x1b[30m', // Green background, black text
        enabled: true
      }
    ];

    this.statistics = {
      totalLogs: 0,
      filteredLogs: 0,
      logsByLevel: { debug: 0, info: 0, warn: 0, error: 0 },
      logsByService: {},
      logsByComponent: {},
      startTime: Date.now()
    };
  }

  /**
   * Enhanced log filtering with multiple criteria
   */
  shouldLog(level, service, component, message = '', meta = {}) {
    // Call parent filtering first
    if (!super.shouldLog(level, service, component)) {
      return false;
    }

    // Keyword filtering
    if (this.advancedFilters.keywords.length > 0) {
      const hasKeyword = this.advancedFilters.keywords.some(keyword => 
        message.toLowerCase().includes(keyword.toLowerCase()) ||
        JSON.stringify(meta).toLowerCase().includes(keyword.toLowerCase())
      );
      if (!hasKeyword) return false;
    }

    // Exclude keyword filtering
    if (this.advancedFilters.excludeKeywords.length > 0) {
      const hasExcludeKeyword = this.advancedFilters.excludeKeywords.some(keyword => 
        message.toLowerCase().includes(keyword.toLowerCase()) ||
        JSON.stringify(meta).toLowerCase().includes(keyword.toLowerCase())
      );
      if (hasExcludeKeyword) return false;
    }

    // Time range filtering
    if (this.advancedFilters.timeRange) {
      const now = Date.now();
      const { start, end } = this.advancedFilters.timeRange;
      if (start && now < start) return false;
      if (end && now > end) return false;
    }

    // User ID filtering
    if (this.advancedFilters.userIds.length > 0) {
      if (!meta.userId || !this.advancedFilters.userIds.includes(meta.userId)) {
        return false;
      }
    }

    // Correlation ID filtering
    if (this.advancedFilters.correlationIds.length > 0) {
      if (!meta.correlationId) return false;
      const hasCorrelation = this.advancedFilters.correlationIds.some(id => 
        meta.correlationId.includes(id)
      );
      if (!hasCorrelation) return false;
    }

    // Operation filtering
    if (this.advancedFilters.operations.length > 0) {
      if (!meta.operation || !this.advancedFilters.operations.includes(meta.operation)) {
        return false;
      }
    }

    // Error type filtering
    if (this.advancedFilters.errorTypes.length > 0) {
      if (!meta.error || !this.advancedFilters.errorTypes.includes(meta.error.name)) {
        return false;
      }
    }

    // Custom filters
    for (const customFilter of this.advancedFilters.customFilters) {
      if (!customFilter.fn(level, service, component, message, meta)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Enhanced message highlighting with pattern matching
   */
  applyHighlighting(message, level, meta = {}) {
    if (!this.options.enableColors) return message;

    let highlightedMessage = message;
    const resetCode = this.colors.reset;

    // Apply highlight rules
    for (const rule of this.highlightRules) {
      if (!rule.enabled) continue;

      if (rule.pattern.test(message) || rule.pattern.test(JSON.stringify(meta))) {
        highlightedMessage = `${rule.color}${highlightedMessage}${resetCode}`;
        break; // Apply only the first matching rule
      }
    }

    // Apply level-specific highlighting if no pattern matched
    if (highlightedMessage === message) {
      const levelColor = this.colors[level] || this.colors.info;
      highlightedMessage = `${levelColor}${highlightedMessage}${resetCode}`;
    }

    return highlightedMessage;
  }

  /**
   * Override formatLogEntry to include enhanced highlighting
   */
  formatLogEntry(info) {
    const { timestamp, level, message, service, component, operation, userId, correlationId, ...meta } = info;
    
    // Update statistics
    this.updateStatistics(level, service, component);

    // Reconstruct full meta object for filtering
    const fullMeta = { 
      ...meta, 
      operation, 
      userId, 
      correlationId 
    };

    // Apply advanced filtering
    if (!this.shouldLog(level, service, component, message, fullMeta)) {
      this.statistics.filteredLogs++;
      return '';
    }

    // Apply enhanced highlighting
    const highlightedMessage = this.applyHighlighting(message, level, fullMeta);

    // Create a temporary logger that bypasses filtering for parent call
    const tempLogger = Object.create(this);
    tempLogger.shouldLog = () => true; // Always return true to bypass parent filtering
    
    // Use parent formatting but with highlighted message
    const enhancedInfo = { ...info, message: highlightedMessage };
    return super.formatLogEntry.call(tempLogger, enhancedInfo);
  }

  /**
   * Update logging statistics
   */
  updateStatistics(level, service, component) {
    this.statistics.totalLogs++;
    this.statistics.logsByLevel[level] = (this.statistics.logsByLevel[level] || 0) + 1;
    
    if (service) {
      this.statistics.logsByService[service] = (this.statistics.logsByService[service] || 0) + 1;
    }
    
    if (component) {
      this.statistics.logsByComponent[component] = (this.statistics.logsByComponent[component] || 0) + 1;
    }
  }

  /**
   * Add keyword filter
   */
  addKeywordFilter(keyword) {
    if (!this.advancedFilters.keywords.includes(keyword)) {
      this.advancedFilters.keywords.push(keyword);
    }
  }

  /**
   * Add exclude keyword filter
   */
  addExcludeKeywordFilter(keyword) {
    if (!this.advancedFilters.excludeKeywords.includes(keyword)) {
      this.advancedFilters.excludeKeywords.push(keyword);
    }
  }

  /**
   * Set time range filter
   */
  setTimeRangeFilter(start, end) {
    this.advancedFilters.timeRange = { start, end };
  }

  /**
   * Add user ID filter
   */
  addUserIdFilter(userId) {
    if (!this.advancedFilters.userIds.includes(userId)) {
      this.advancedFilters.userIds.push(userId);
    }
  }

  /**
   * Add correlation ID filter
   */
  addCorrelationIdFilter(correlationId) {
    if (!this.advancedFilters.correlationIds.includes(correlationId)) {
      this.advancedFilters.correlationIds.push(correlationId);
    }
  }

  /**
   * Add operation filter
   */
  addOperationFilter(operation) {
    if (!this.advancedFilters.operations.includes(operation)) {
      this.advancedFilters.operations.push(operation);
    }
  }

  /**
   * Add error type filter
   */
  addErrorTypeFilter(errorType) {
    if (!this.advancedFilters.errorTypes.includes(errorType)) {
      this.advancedFilters.errorTypes.push(errorType);
    }
  }

  /**
   * Add custom filter function
   */
  addCustomFilter(name, filterFn) {
    this.advancedFilters.customFilters.push({
      name,
      fn: filterFn
    });
  }

  /**
   * Remove keyword filter
   */
  removeKeywordFilter(keyword) {
    const index = this.advancedFilters.keywords.indexOf(keyword);
    if (index > -1) {
      this.advancedFilters.keywords.splice(index, 1);
    }
  }

  /**
   * Remove exclude keyword filter
   */
  removeExcludeKeywordFilter(keyword) {
    const index = this.advancedFilters.excludeKeywords.indexOf(keyword);
    if (index > -1) {
      this.advancedFilters.excludeKeywords.splice(index, 1);
    }
  }

  /**
   * Clear time range filter
   */
  clearTimeRangeFilter() {
    this.advancedFilters.timeRange = null;
  }

  /**
   * Clear all advanced filters
   */
  clearAdvancedFilters() {
    this.advancedFilters = {
      keywords: [],
      excludeKeywords: [],
      timeRange: null,
      userIds: [],
      correlationIds: [],
      operations: [],
      errorTypes: [],
      customFilters: []
    };
  }

  /**
   * Enable highlight rule
   */
  enableHighlightRule(ruleName) {
    const rule = this.highlightRules.find(r => r.name === ruleName);
    if (rule) {
      rule.enabled = true;
    }
  }

  /**
   * Disable highlight rule
   */
  disableHighlightRule(ruleName) {
    const rule = this.highlightRules.find(r => r.name === ruleName);
    if (rule) {
      rule.enabled = false;
    }
  }

  /**
   * Add custom highlight rule
   */
  addHighlightRule(name, pattern, color) {
    this.highlightRules.push({
      name,
      pattern: new RegExp(pattern, 'i'),
      color,
      enabled: true
    });
  }

  /**
   * Remove highlight rule
   */
  removeHighlightRule(ruleName) {
    const index = this.highlightRules.findIndex(r => r.name === ruleName);
    if (index > -1) {
      this.highlightRules.splice(index, 1);
    }
  }

  /**
   * Get logging statistics
   */
  getStatistics() {
    const runtime = Date.now() - this.statistics.startTime;
    return {
      ...this.statistics,
      runtime: runtime,
      logsPerSecond: this.statistics.totalLogs / (runtime / 1000),
      filterEfficiency: this.statistics.filteredLogs / this.statistics.totalLogs * 100
    };
  }

  /**
   * Print current filter configuration
   */
  printFilterConfig() {
    console.log('\n' + this.colors.bold + '=== Advanced Filter Configuration ===' + this.colors.reset);
    console.log(`Keywords: ${this.colors.info}${JSON.stringify(this.advancedFilters.keywords)}${this.colors.reset}`);
    console.log(`Exclude Keywords: ${this.colors.info}${JSON.stringify(this.advancedFilters.excludeKeywords)}${this.colors.reset}`);
    console.log(`Time Range: ${this.colors.info}${JSON.stringify(this.advancedFilters.timeRange)}${this.colors.reset}`);
    console.log(`User IDs: ${this.colors.info}${JSON.stringify(this.advancedFilters.userIds)}${this.colors.reset}`);
    console.log(`Operations: ${this.colors.info}${JSON.stringify(this.advancedFilters.operations)}${this.colors.reset}`);
    console.log(`Error Types: ${this.colors.info}${JSON.stringify(this.advancedFilters.errorTypes)}${this.colors.reset}`);
    console.log(`Custom Filters: ${this.colors.info}${this.advancedFilters.customFilters.length}${this.colors.reset}`);
    console.log(this.colors.bold + '======================================\n' + this.colors.reset);
  }

  /**
   * Print highlight rules configuration
   */
  printHighlightConfig() {
    console.log('\n' + this.colors.bold + '=== Highlight Rules Configuration ===' + this.colors.reset);
    this.highlightRules.forEach(rule => {
      const status = rule.enabled ? this.colors.info + 'ENABLED' : this.colors.dim + 'DISABLED';
      console.log(`${rule.name}: ${status}${this.colors.reset} - ${rule.pattern}`);
    });
    console.log(this.colors.bold + '====================================\n' + this.colors.reset);
  }

  /**
   * Print logging statistics
   */
  printStatistics() {
    const stats = this.getStatistics();
    console.log('\n' + this.colors.bold + '=== Logging Statistics ===' + this.colors.reset);
    console.log(`Total Logs: ${this.colors.info}${stats.totalLogs}${this.colors.reset}`);
    console.log(`Filtered Logs: ${this.colors.info}${stats.filteredLogs}${this.colors.reset}`);
    console.log(`Filter Efficiency: ${this.colors.info}${stats.filterEfficiency.toFixed(2)}%${this.colors.reset}`);
    console.log(`Runtime: ${this.colors.info}${(stats.runtime / 1000).toFixed(2)}s${this.colors.reset}`);
    console.log(`Logs/Second: ${this.colors.info}${stats.logsPerSecond.toFixed(2)}${this.colors.reset}`);
    
    console.log('\nLogs by Level:');
    Object.entries(stats.logsByLevel).forEach(([level, count]) => {
      const color = this.colors[level] || this.colors.info;
      console.log(`  ${level}: ${color}${count}${this.colors.reset}`);
    });
    
    console.log('\nTop Services:');
    const topServices = Object.entries(stats.logsByService)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5);
    topServices.forEach(([service, count]) => {
      console.log(`  ${service}: ${this.colors.info}${count}${this.colors.reset}`);
    });
    
    console.log(this.colors.bold + '=========================\n' + this.colors.reset);
  }

  /**
   * Reset statistics
   */
  resetStatistics() {
    this.statistics = {
      totalLogs: 0,
      filteredLogs: 0,
      logsByLevel: { debug: 0, info: 0, warn: 0, error: 0 },
      logsByService: {},
      logsByComponent: {},
      startTime: Date.now()
    };
  }

  /**
   * Override log method to ensure filtering works
   */
  log(level, message, meta = {}) {
    const logEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...meta
    };

    // Use formatLogEntry which includes filtering
    const formattedMessage = this.formatLogEntry(logEntry);
    if (formattedMessage) {
      console.log(formattedMessage);
    }
  }
}

module.exports = LogFilteringAndHighlighting;