const LogFilteringAndHighlighting = require('../logFilteringAndHighlighting');

describe('LogFilteringAndHighlighting', () => {
  let logger;
  let consoleSpy;

  beforeEach(() => {
    logger = new LogFilteringAndHighlighting({
      enableColors: false, // Disable colors for testing
      enableSourceInfo: false // Disable source info for consistent testing
    });
    logger.clearFilters(); // Clear parent filters
    logger.clearAdvancedFilters(); // Clear advanced filters
    logger.resetStatistics(); // Reset statistics
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('Advanced Filtering', () => {
    test('should filter by keywords', () => {
      logger.addKeywordFilter('database');
      
      logger.info('Database query executed', { service: 'db-service' });
      logger.info('File operation completed', { service: 'file-service' });
      logger.info('Contains database keyword', { service: 'test-service' });
      
      // Only messages containing 'database' should be logged
      expect(consoleSpy).toHaveBeenCalledTimes(2);
    });

    test('should exclude keywords', () => {
      logger.addExcludeKeywordFilter('test');
      
      logger.info('Production message', { service: 'prod-service' });
      logger.info('Test message', { service: 'test-service' });
      logger.info('Another production message', { service: 'prod-service' });
      
      // Messages containing 'test' should be filtered out
      expect(consoleSpy).toHaveBeenCalledTimes(2);
    });

    test('should filter by user IDs', () => {
      logger.addUserIdFilter('user-123');
      
      logger.info('Message 1', { userId: 'user-123' });
      logger.info('Message 2', { userId: 'user-456' });
      logger.info('Message 3', { userId: 'user-123' });
      
      // Only messages from user-123 should be logged
      expect(consoleSpy).toHaveBeenCalledTimes(2);
    });

    test('should filter by correlation IDs', () => {
      logger.addCorrelationIdFilter('corr-123');
      
      logger.info('Message 1', { correlationId: 'corr-123-456' });
      logger.info('Message 2', { correlationId: 'corr-789-012' });
      logger.info('Message 3', { correlationId: 'corr-123-789' });
      
      // Only messages with correlation IDs containing 'corr-123' should be logged
      expect(consoleSpy).toHaveBeenCalledTimes(2);
    });

    test('should filter by operations', () => {
      logger.addOperationFilter('authentication');
      
      logger.info('Auth message', { operation: 'authentication' });
      logger.info('Other message', { operation: 'authorization' });
      logger.info('Another auth message', { operation: 'authentication' });
      
      // Only authentication operations should be logged
      expect(consoleSpy).toHaveBeenCalledTimes(2);
    });

    test('should filter by error types', () => {
      logger.addErrorTypeFilter('ValidationError');
      
      const validationError = new Error('Validation failed');
      validationError.name = 'ValidationError';
      
      const networkError = new Error('Network failed');
      networkError.name = 'NetworkError';
      
      logger.error('Error 1', validationError, { service: 'test' });
      logger.error('Error 2', networkError, { service: 'test' });
      logger.error('Error 3', validationError, { service: 'test' });
      
      // Only ValidationError should be logged
      expect(consoleSpy).toHaveBeenCalledTimes(2);
    });

    test('should support custom filters', () => {
      logger.addCustomFilter('high-priority', (level, service, component, message, meta) => {
        return meta.priority === 'high' || level === 'error';
      });
      
      logger.info('High priority', { priority: 'high' });
      logger.info('Low priority', { priority: 'low' });
      logger.error('Error message', null, { priority: 'low' });
      logger.warn('Warning message', { priority: 'low' });
      
      // Only high priority and error messages should be logged
      expect(consoleSpy).toHaveBeenCalledTimes(2);
    });

    test('should clear advanced filters', () => {
      logger.addKeywordFilter('test');
      logger.addUserIdFilter('user-123');
      logger.addOperationFilter('auth');
      
      logger.clearAdvancedFilters();
      
      logger.info('Test message', { 
        userId: 'user-456', 
        operation: 'other' 
      });
      
      // Message should be logged after clearing filters
      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Highlighting', () => {
    test('should apply highlighting based on patterns', () => {
      const colorLogger = new LogFilteringAndHighlighting({
        enableColors: true,
        enableSourceInfo: false
      });
      
      const spy = jest.spyOn(console, 'log').mockImplementation();
      
      colorLogger.info('Critical system failure', { service: 'test' });
      
      const logOutput = spy.mock.calls[0][0];
      expect(logOutput).toContain('\x1b[41m\x1b[37m'); // Red background for critical
      
      spy.mockRestore();
    });

    test('should enable and disable highlight rules', () => {
      logger.disableHighlightRule('critical-errors');
      
      const rule = logger.highlightRules.find(r => r.name === 'critical-errors');
      expect(rule.enabled).toBe(false);
      
      logger.enableHighlightRule('critical-errors');
      expect(rule.enabled).toBe(true);
    });

    test('should add custom highlight rules', () => {
      logger.addHighlightRule('custom-test', 'special', '\x1b[44m');
      
      const rule = logger.highlightRules.find(r => r.name === 'custom-test');
      expect(rule).toBeDefined();
      expect(rule.pattern.test('special')).toBe(true);
      expect(rule.color).toBe('\x1b[44m');
    });

    test('should remove highlight rules', () => {
      const initialCount = logger.highlightRules.length;
      
      logger.addHighlightRule('temp-rule', 'temp', '\x1b[45m');
      expect(logger.highlightRules.length).toBe(initialCount + 1);
      
      logger.removeHighlightRule('temp-rule');
      expect(logger.highlightRules.length).toBe(initialCount);
    });
  });

  describe('Statistics', () => {
    test('should track logging statistics', () => {
      logger.resetStatistics();
      
      logger.debug('Debug message', { service: 'test-service' });
      logger.info('Info message', { service: 'test-service' });
      logger.warn('Warning message', { service: 'other-service' });
      logger.error('Error message', null, { service: 'test-service' });
      
      const stats = logger.getStatistics();
      
      expect(stats.totalLogs).toBe(4);
      expect(stats.logsByLevel.debug).toBe(1);
      expect(stats.logsByLevel.info).toBe(1);
      expect(stats.logsByLevel.warn).toBe(1);
      expect(stats.logsByLevel.error).toBe(1);
      expect(stats.logsByService['test-service']).toBe(3);
      expect(stats.logsByService['other-service']).toBe(1);
    });

    test('should track filtered logs', () => {
      logger.resetStatistics();
      logger.addKeywordFilter('important');
      
      logger.info('Important message', { service: 'test' });
      logger.info('Regular message', { service: 'test' });
      logger.info('Another important message', { service: 'test' });
      
      const stats = logger.getStatistics();
      
      expect(stats.totalLogs).toBe(3);
      expect(stats.filteredLogs).toBe(1); // One message was filtered out
      expect(consoleSpy).toHaveBeenCalledTimes(2); // Only 2 messages logged
    });

    test('should calculate filter efficiency', () => {
      logger.resetStatistics();
      logger.addKeywordFilter('test');
      
      // Generate logs where half contain 'test'
      for (let i = 0; i < 10; i++) {
        const message = i % 2 === 0 ? `test message ${i}` : `other message ${i}`;
        logger.info(message, { service: 'test-service' });
      }
      
      const stats = logger.getStatistics();
      
      expect(stats.totalLogs).toBe(10);
      expect(stats.filteredLogs).toBe(5);
      expect(stats.filterEfficiency).toBe(50);
    });

    test('should reset statistics', () => {
      logger.info('Test message', { service: 'test' });
      
      let stats = logger.getStatistics();
      expect(stats.totalLogs).toBeGreaterThan(0);
      
      logger.resetStatistics();
      stats = logger.getStatistics();
      
      expect(stats.totalLogs).toBe(0);
      expect(stats.filteredLogs).toBe(0);
      expect(Object.values(stats.logsByLevel).every(count => count === 0)).toBe(true);
    });
  });

  describe('Filter Management', () => {
    test('should remove keyword filters', () => {
      logger.addKeywordFilter('test1');
      logger.addKeywordFilter('test2');
      
      expect(logger.advancedFilters.keywords).toContain('test1');
      expect(logger.advancedFilters.keywords).toContain('test2');
      
      logger.removeKeywordFilter('test1');
      
      expect(logger.advancedFilters.keywords).not.toContain('test1');
      expect(logger.advancedFilters.keywords).toContain('test2');
    });

    test('should remove exclude keyword filters', () => {
      logger.addExcludeKeywordFilter('exclude1');
      logger.addExcludeKeywordFilter('exclude2');
      
      expect(logger.advancedFilters.excludeKeywords).toContain('exclude1');
      expect(logger.advancedFilters.excludeKeywords).toContain('exclude2');
      
      logger.removeExcludeKeywordFilter('exclude1');
      
      expect(logger.advancedFilters.excludeKeywords).not.toContain('exclude1');
      expect(logger.advancedFilters.excludeKeywords).toContain('exclude2');
    });

    test('should set and clear time range filters', () => {
      const start = Date.now();
      const end = start + 60000; // 1 minute later
      
      logger.setTimeRangeFilter(start, end);
      
      expect(logger.advancedFilters.timeRange).toEqual({ start, end });
      
      logger.clearTimeRangeFilter();
      
      expect(logger.advancedFilters.timeRange).toBeNull();
    });

    test('should not add duplicate filters', () => {
      logger.addKeywordFilter('duplicate');
      logger.addKeywordFilter('duplicate');
      
      expect(logger.advancedFilters.keywords.filter(k => k === 'duplicate')).toHaveLength(1);
    });
  });

  describe('Configuration Display', () => {
    test('should print filter configuration without errors', () => {
      logger.addKeywordFilter('test');
      logger.addUserIdFilter('user-123');
      
      expect(() => logger.printFilterConfig()).not.toThrow();
    });

    test('should print highlight configuration without errors', () => {
      logger.addHighlightRule('test-rule', 'test', '\x1b[44m');
      
      expect(() => logger.printHighlightConfig()).not.toThrow();
    });

    test('should print statistics without errors', () => {
      logger.info('Test message', { service: 'test' });
      
      expect(() => logger.printStatistics()).not.toThrow();
    });
  });
});