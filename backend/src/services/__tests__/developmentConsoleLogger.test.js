const DevelopmentConsoleLogger = require('../developmentConsoleLogger');

describe('DevelopmentConsoleLogger', () => {
  let logger;
  let consoleSpy;

  beforeEach(() => {
    logger = new DevelopmentConsoleLogger({
      enableColors: false, // Disable colors for testing
      enableSourceInfo: false // Disable source info for consistent testing
    });
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('Basic Logging', () => {
    test('should log debug messages', () => {
      logger.debug('Debug message', { service: 'test-service' });
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG]')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Debug message')
      );
    });

    test('should log info messages', () => {
      logger.info('Info message', { service: 'test-service' });
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[INFO ]')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Info message')
      );
    });

    test('should log warning messages', () => {
      logger.warn('Warning message', { service: 'test-service' });
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WARN ]')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Warning message')
      );
    });

    test('should log error messages', () => {
      const error = new Error('Test error');
      logger.error('Error message', error, { service: 'test-service' });
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR]')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error message')
      );
    });
  });

  describe('Log Level Filtering', () => {
    test('should respect log level hierarchy', () => {
      logger.setLogLevel('warn');
      
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');
      
      // Only warn and error should be logged
      expect(consoleSpy).toHaveBeenCalledTimes(2);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WARN ]')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR]')
      );
    });

    test('should filter by specific log level', () => {
      logger.filterByLevel('error');
      
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');
      
      // Only error should be logged
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR]')
      );
    });
  });

  describe('Service and Component Filtering', () => {
    test('should filter by service', () => {
      logger.filterByService('auth-service');
      
      logger.info('Message 1', { service: 'auth-service' });
      logger.info('Message 2', { service: 'todo-service' });
      logger.info('Message 3', { service: 'auth-service' });
      
      // Only auth-service messages should be logged
      expect(consoleSpy).toHaveBeenCalledTimes(2);
    });

    test('should filter by component', () => {
      logger.filterByComponent('database');
      
      logger.info('Message 1', { component: 'database' });
      logger.info('Message 2', { component: 'auth' });
      logger.info('Message 3', { component: 'database' });
      
      // Only database component messages should be logged
      expect(consoleSpy).toHaveBeenCalledTimes(2);
    });

    test('should clear filters', () => {
      logger.filterByService('auth-service');
      logger.filterByComponent('database');
      logger.filterByLevel('error');
      
      logger.clearFilters();
      
      logger.info('Test message', { service: 'todo-service', component: 'auth' });
      
      // Message should be logged after clearing filters
      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Metadata Formatting', () => {
    test('should format simple metadata', () => {
      logger.info('Test message', {
        service: 'test-service',
        userId: 'user-123',
        operation: 'test-operation'
      });
      
      const logOutput = consoleSpy.mock.calls[0][0];
      expect(logOutput).toContain('[test-service]');
      expect(logOutput).toContain('(test-operation)');
      expect(logOutput).toContain('[user:user-123]');
    });

    test('should format nested metadata', () => {
      logger.info('Test message', {
        service: 'test-service',
        data: {
          nested: {
            value: 'test',
            number: 42
          },
          array: [1, 2, 3]
        }
      });
      
      const logOutput = consoleSpy.mock.calls[0][0];
      expect(logOutput).toContain('data:');
      expect(logOutput).toContain('nested:');
      expect(logOutput).toContain("value: 'test'");
      expect(logOutput).toContain('number: 42');
    });

    test('should handle arrays in metadata', () => {
      logger.info('Test message', {
        service: 'test-service',
        items: ['item1', 'item2', 'item3']
      });
      
      const logOutput = consoleSpy.mock.calls[0][0];
      expect(logOutput).toContain('items:');
      expect(logOutput).toContain("- 'item1'");
      expect(logOutput).toContain("- 'item2'");
      expect(logOutput).toContain("- 'item3'");
    });
  });

  describe('Error Handling', () => {
    test('should format error objects properly', () => {
      const error = new Error('Test error message');
      error.stack = 'Error: Test error message\n    at test.js:1:1';
      
      logger.error('Error occurred', error, { service: 'test-service' });
      
      const logOutput = consoleSpy.mock.calls[0][0];
      expect(logOutput).toContain('Error occurred');
      expect(logOutput).toContain("name: 'Error'");
      expect(logOutput).toContain("message: 'Test error message'");
      expect(logOutput).toContain('stack:');
    });

    test('should handle null and undefined values', () => {
      logger.info('Test message', {
        service: 'test-service',
        nullValue: null,
        undefinedValue: undefined,
        emptyObject: {},
        emptyArray: []
      });
      
      const logOutput = consoleSpy.mock.calls[0][0];
      expect(logOutput).toContain('nullValue: null');
      expect(logOutput).toContain('undefinedValue: undefined');
      expect(logOutput).toContain('emptyObject: {}');
      expect(logOutput).toContain('emptyArray: []');
    });
  });

  describe('Configuration', () => {
    test('should create logger with custom options', () => {
      const customLogger = new DevelopmentConsoleLogger({
        enableColors: true,
        enableSourceInfo: true,
        maxDepth: 5,
        indentSize: 4,
        logLevel: 'warn'
      });
      
      expect(customLogger.options.enableColors).toBe(true);
      expect(customLogger.options.enableSourceInfo).toBe(true);
      expect(customLogger.options.maxDepth).toBe(5);
      expect(customLogger.options.indentSize).toBe(4);
      expect(customLogger.currentLogLevel).toBe('warn');
    });

    test('should use default options when not specified', () => {
      const defaultLogger = new DevelopmentConsoleLogger();
      
      expect(defaultLogger.options.enableColors).toBe(true);
      expect(defaultLogger.options.enableSourceInfo).toBe(true);
      expect(defaultLogger.options.maxDepth).toBe(3);
      expect(defaultLogger.options.indentSize).toBe(2);
      expect(defaultLogger.currentLogLevel).toBe('debug');
    });
  });

  describe('Winston Integration', () => {
    test('should provide Winston transport', () => {
      const transport = logger.getTransport();
      
      expect(transport).toBeDefined();
      expect(transport.level).toBe(logger.currentLogLevel);
    });

    test('should update transport level when log level changes', () => {
      const transport = logger.getTransport();
      
      logger.setLogLevel('error');
      
      expect(transport.level).toBe('error');
    });
  });

  describe('Source Information', () => {
    test('should extract source info when enabled', () => {
      const sourceLogger = new DevelopmentConsoleLogger({
        enableColors: false,
        enableSourceInfo: true
      });
      
      const sourceInfo = sourceLogger.getSourceInfo();
      
      // Should return filename:line format or null
      if (sourceInfo) {
        expect(sourceInfo).toMatch(/\w+\.js:\d+/);
      }
    });

    test('should handle source info extraction errors gracefully', () => {
      const sourceLogger = new DevelopmentConsoleLogger({
        enableSourceInfo: true
      });
      
      // Mock Error constructor to throw
      const originalError = global.Error;
      global.Error = function() {
        throw new originalError('Mock error');
      };
      
      const sourceInfo = sourceLogger.getSourceInfo();
      
      // Should return null when error occurs
      expect(sourceInfo).toBeNull();
      
      // Restore original Error
      global.Error = originalError;
    });
  });
});