const ErrorAggregationIntegration = require('../errorAggregationIntegration');
const path = require('path');

describe('ErrorAggregationIntegration', () => {
  let integration;
  let testStorageDir;

  beforeEach(async () => {
    testStorageDir = path.join(__dirname, '../../../logs/test-integration', Date.now().toString());
    
    integration = new ErrorAggregationIntegration({
      storageDir: testStorageDir,
      criticalErrorThreshold: 3
    });

    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, 200));
  });

  afterEach(async () => {
    await integration.shutdown();
    
    // Clean up test files
    try {
      const fs = require('fs').promises;
      await fs.rmdir(testStorageDir, { recursive: true });
    } catch (error) {
      // Directory might not exist
    }
  });

  describe('Error Data Extraction', () => {
    test('should extract error data from string message', () => {
      const logData = 'Database connection failed';
      const errorData = integration.extractErrorData(logData);

      expect(errorData).toMatchObject({
        message: 'Database connection failed',
        name: 'UnknownError'
      });
    });

    test('should extract error data from object with error property', () => {
      const logData = {
        message: 'Operation failed',
        error: {
          name: 'ValidationError',
          message: 'Invalid input',
          stack: 'Error stack trace'
        },
        userId: 'user123',
        correlationId: 'req-456'
      };

      const errorData = integration.extractErrorData(logData);

      expect(errorData).toMatchObject({
        name: 'ValidationError',
        message: 'Invalid input',
        stack: 'Error stack trace',
        userId: 'user123',
        sessionId: 'req-456'
      });
    });

    test('should extract context information', () => {
      const logData = {
        message: 'API error',
        error: { name: 'APIError', message: 'Request failed' },
        method: 'POST',
        url: '/api/users',
        statusCode: 500,
        context: {
          database: 'primary',
          timeout: 5000
        }
      };

      const errorData = integration.extractErrorData(logData);

      expect(errorData.context).toMatchObject({
        method: 'POST',
        url: '/api/users',
        database: 'primary',
        timeout: 5000
      });
    });
  });

  describe('Error Detection', () => {
    test('should detect error by name', () => {
      const errorInfo = {
        name: 'ValidationError',
        message: 'Invalid input'
      };

      expect(integration.isErrorLog(errorInfo)).toBe(true);
    });

    test('should detect error by status code', () => {
      const errorInfo = {
        name: 'HTTPResponse',
        message: 'Bad request',
        statusCode: 400
      };

      expect(integration.isErrorLog(errorInfo)).toBe(true);
    });

    test('should detect error by message keywords', () => {
      const errorInfo = {
        name: 'SystemEvent',
        message: 'Database connection failed'
      };

      expect(integration.isErrorLog(errorInfo)).toBe(true);
    });

    test('should not detect non-error logs', () => {
      const errorInfo = {
        name: 'InfoLog',
        message: 'User logged in successfully'
      };

      expect(integration.isErrorLog(errorInfo)).toBe(false);
    });
  });

  describe('Error Processing', () => {
    test('should process and aggregate errors', async () => {
      const logData = {
        message: 'Database error occurred',
        error: {
          name: 'DatabaseError',
          message: 'Connection timeout'
        },
        userId: 'user123',
        service: 'userService'
      };

      const result = await integration.processError(logData);

      expect(result).toBeDefined();
      expect(result.category).toBe('DATABASE_ERROR');
      expect(result.count).toBe(1);
    });

    test('should handle multiple similar errors', async () => {
      const baseLogData = {
        message: 'Validation failed',
        error: {
          name: 'ValidationError',
          message: 'User ID 123 is invalid'
        },
        service: 'userService'
      };

      // Process multiple similar errors
      for (let i = 1; i <= 3; i++) {
        await integration.processError({
          ...baseLogData,
          userId: `user${i}`
        });
      }

      const errorGroups = integration.getErrorGroups();
      expect(errorGroups.total).toBe(1);
      expect(errorGroups.groups[0].count).toBe(3);
      expect(errorGroups.groups[0].affectedUsersCount).toBe(3);
    });

    test('should flag critical errors', async () => {
      const logData = {
        message: 'Critical system error',
        error: {
          name: 'FatalError',
          message: 'System crash'
        },
        statusCode: 500,
        service: 'systemService'
      };

      await integration.processError(logData);

      const criticalErrors = integration.getCriticalErrors();
      expect(criticalErrors.length).toBe(1);
      expect(criticalErrors[0].errorName).toBe('FatalError');
    });
  });

  describe('Error Management', () => {
    beforeEach(async () => {
      // Add some test errors
      const errors = [
        {
          message: 'Validation error',
          error: { name: 'ValidationError', message: 'Invalid email' },
          userId: 'user1'
        },
        {
          message: 'Database error',
          error: { name: 'DatabaseError', message: 'Connection failed' },
          statusCode: 500,
          userId: 'user2'
        }
      ];

      for (const error of errors) {
        await integration.processError(error);
      }
    });

    test('should retrieve error groups with filtering', () => {
      const allGroups = integration.getErrorGroups();
      expect(allGroups.total).toBe(2);

      const validationErrors = integration.getErrorGroups({ 
        category: 'VALIDATION_ERROR' 
      });
      expect(validationErrors.total).toBe(1);
      expect(validationErrors.groups[0].category).toBe('VALIDATION_ERROR');
    });

    test('should get error statistics', () => {
      const stats = integration.getErrorStatistics();

      expect(stats.totalGroups).toBe(2);
      expect(stats.totalErrors).toBe(2);
      expect(stats.categoryCounts).toHaveProperty('VALIDATION_ERROR', 1);
      expect(stats.categoryCounts).toHaveProperty('DATABASE_ERROR', 1);
    });

    test('should get specific error group by signature', () => {
      const allGroups = integration.getErrorGroups();
      const signature = allGroups.groups[0].signature;
      
      const errorGroup = integration.getErrorGroup(signature);
      expect(errorGroup).toBeDefined();
      expect(errorGroup.signature).toBe(signature);
    });

    test('should mark error as resolved', async () => {
      const allGroups = integration.getErrorGroups();
      const signature = allGroups.groups[0].signature;
      
      const result = await integration.markErrorResolved(signature, 'Fixed validation logic');
      expect(result).toBe(true);

      const resolvedGroup = integration.getErrorGroup(signature);
      expect(resolvedGroup.resolutionStatus).toBe('RESOLVED');
      expect(resolvedGroup.resolutionNotes).toBe('Fixed validation logic');
      expect(resolvedGroup.resolvedAt).toBeInstanceOf(Date);
    });
  });

  describe('Express Middleware', () => {
    test('should create Express middleware', () => {
      const middleware = integration.createExpressMiddleware();
      expect(typeof middleware).toBe('function');
      expect(middleware.length).toBe(3); // req, res, next
    });

    test('should process errors from Express responses', (done) => {
      const middleware = integration.createExpressMiddleware();
      
      const mockReq = {
        method: 'POST',
        url: '/api/users',
        user: { id: 'user123' },
        get: jest.fn().mockReturnValue('Mozilla/5.0'),
        ip: '127.0.0.1'
      };

      const mockRes = {
        statusCode: 400,
        json: jest.fn()
      };

      const mockNext = jest.fn();

      // Spy on processError
      const processErrorSpy = jest.spyOn(integration, 'processError')
        .mockResolvedValue({});

      middleware(mockReq, mockRes, mockNext);

      // Simulate error response
      mockRes.json({ message: 'Validation failed', error: 'Invalid input' });

      // Wait for async processing
      setTimeout(() => {
        expect(processErrorSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            statusCode: 400,
            message: 'Validation failed',
            userId: 'user123',
            method: 'POST',
            url: '/api/users'
          })
        );
        
        processErrorSpy.mockRestore();
        done();
      }, 100);
    });
  });

  describe('Winston Transport', () => {
    test('should create Winston transport', () => {
      const TransportClass = integration.createWinstonTransport();
      expect(typeof TransportClass).toBe('function');
      
      const transport = new TransportClass();
      expect(transport).toBeDefined();
      expect(typeof transport.log).toBe('function');
    });

    test('should process error logs through Winston transport', (done) => {
      const TransportClass = integration.createWinstonTransport();
      const transport = new TransportClass();

      // Spy on processError
      const processErrorSpy = jest.spyOn(integration, 'processError')
        .mockResolvedValue({});

      const logInfo = {
        level: 'error',
        message: 'Database connection failed',
        error: {
          name: 'DatabaseError',
          message: 'Connection timeout'
        },
        userId: 'user123'
      };

      transport.log(logInfo, () => {
        setTimeout(() => {
          expect(processErrorSpy).toHaveBeenCalledWith(logInfo);
          processErrorSpy.mockRestore();
          done();
        }, 100);
      });
    });

    test('should ignore non-error logs in Winston transport', (done) => {
      const TransportClass = integration.createWinstonTransport();
      const transport = new TransportClass();

      // Spy on processError
      const processErrorSpy = jest.spyOn(integration, 'processError');

      const logInfo = {
        level: 'info',
        message: 'User logged in',
        userId: 'user123'
      };

      transport.log(logInfo, () => {
        setTimeout(() => {
          expect(processErrorSpy).not.toHaveBeenCalled();
          processErrorSpy.mockRestore();
          done();
        }, 100);
      });
    });
  });

  describe('Initialization and Shutdown', () => {
    test('should handle uninitialized state gracefully', async () => {
      const uninitializedIntegration = new ErrorAggregationIntegration();
      uninitializedIntegration.initialized = false;

      const result = await uninitializedIntegration.processError({
        message: 'Test error',
        error: { name: 'TestError', message: 'Test' }
      });

      expect(result).toBeUndefined();
    });

    test('should shutdown gracefully', async () => {
      const shutdownSpy = jest.spyOn(integration.aggregationService, 'shutdown');
      
      await integration.shutdown();
      
      expect(shutdownSpy).toHaveBeenCalled();
      shutdownSpy.mockRestore();
    });
  });
});