const ErrorAggregationService = require('../errorAggregationService');
const fs = require('fs').promises;
const path = require('path');

describe('ErrorAggregationService', () => {
  let service;
  let testStorageDir;

  beforeEach(async () => {
    // Create temporary test directory
    testStorageDir = path.join(__dirname, '../../../logs/test-aggregation');
    
    service = new ErrorAggregationService({
      storageDir: testStorageDir,
      criticalErrorThreshold: 5,
      config: {
        severityLevels: {
          LOW: 1,
          MEDIUM: 2,
          HIGH: 3,
          CRITICAL: 4
        }
      }
    });

    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterEach(async () => {
    await service.shutdown();
    
    // Clean up test files
    try {
      await fs.rmdir(testStorageDir, { recursive: true });
    } catch (error) {
      // Directory might not exist
    }
  });

  describe('Error Preprocessing', () => {
    test('should preprocess error data correctly', () => {
      const errorData = {
        name: 'ValidationError',
        message: 'Invalid input',
        stack: 'Error: Invalid input\n    at validate (/app/validator.js:10:5)',
        userId: 'user123',
        context: { field: 'email' }
      };

      const processed = service.preprocessError(errorData);

      expect(processed).toMatchObject({
        name: 'ValidationError',
        message: 'Invalid input',
        stack: expect.stringContaining('Error: Invalid input'),
        userId: 'user123',
        context: { field: 'email' },
        service: 'unknown'
      });
      expect(processed.timestamp).toBeInstanceOf(Date);
    });

    test('should handle nested error objects', () => {
      const errorData = {
        error: {
          name: 'DatabaseError',
          message: 'Connection failed',
          stack: 'Error: Connection failed'
        },
        userId: 'user456'
      };

      const processed = service.preprocessError(errorData);

      expect(processed.name).toBe('DatabaseError');
      expect(processed.message).toBe('Connection failed');
      expect(processed.userId).toBe('user456');
    });
  });

  describe('Error Signature Generation', () => {
    test('should generate consistent signatures for similar errors', () => {
      const error1 = {
        name: 'ValidationError',
        message: 'User ID 123 is invalid',
        stack: 'Error at line 45',
        service: 'userService'
      };

      const error2 = {
        name: 'ValidationError',
        message: 'User ID 456 is invalid',
        stack: 'Error at line 45',
        service: 'userService'
      };

      const signature1 = service.generateErrorSignature(error1);
      const signature2 = service.generateErrorSignature(error2);

      expect(signature1).toBe(signature2);
    });

    test('should generate different signatures for different errors', () => {
      const error1 = {
        name: 'ValidationError',
        message: 'Invalid input',
        service: 'userService'
      };

      const error2 = {
        name: 'DatabaseError',
        message: 'Connection failed',
        service: 'userService'
      };

      const signature1 = service.generateErrorSignature(error1);
      const signature2 = service.generateErrorSignature(error2);

      expect(signature1).not.toBe(signature2);
    });
  });

  describe('Message Normalization', () => {
    test('should normalize error messages correctly', () => {
      const testCases = [
        {
          input: 'User ID 123 not found',
          expected: 'user id {number} not found'
        },
        {
          input: 'File /path/to/file.txt not found',
          expected: 'file {path} not found'
        },
        {
          input: 'Request to https://api.example.com failed',
          expected: 'request to {url} failed'
        },
        {
          input: 'Error at 2023-12-01T10:30:00Z',
          expected: 'error at {timestamp}'
        }
      ];

      testCases.forEach(({ input, expected }) => {
        const normalized = service.normalizeErrorMessage(input);
        expect(normalized).toBe(expected);
      });
    });
  });

  describe('Error Categorization', () => {
    test('should categorize network errors correctly', () => {
      const networkError = {
        name: 'NetworkError',
        message: 'Request failed',
        statusCode: 500
      };

      const category = service.categorizeError(networkError);
      expect(category).toBe('SERVER_ERROR');
    });

    test('should categorize database errors correctly', () => {
      const dbError = {
        name: 'DatabaseConnectionError',
        message: 'Failed to connect to database'
      };

      const category = service.categorizeError(dbError);
      expect(category).toBe('DATABASE_ERROR');
    });

    test('should categorize validation errors correctly', () => {
      const validationError = {
        name: 'ValidationError',
        message: 'Invalid email format'
      };

      const category = service.categorizeError(validationError);
      expect(category).toBe('VALIDATION_ERROR');
    });

    test('should categorize auth errors correctly', () => {
      const authError = {
        name: 'UnauthorizedError',
        message: 'Access denied',
        statusCode: 401
      };

      const category = service.categorizeError(authError);
      expect(category).toBe('AUTH_ERROR');
    });
  });

  describe('Severity Classification', () => {
    test('should classify critical errors correctly', () => {
      const criticalError = {
        name: 'FatalError',
        message: 'System crash',
        statusCode: 500
      };

      const severity = service.classifySeverity(criticalError, 'SYSTEM_ERROR');
      expect(severity).toBe(4); // CRITICAL
    });

    test('should classify high severity errors correctly', () => {
      const highError = {
        name: 'DatabaseError',
        message: 'Query failed',
        statusCode: 400
      };

      const severity = service.classifySeverity(highError, 'DATABASE_ERROR');
      expect(severity).toBe(3); // HIGH
    });

    test('should classify medium severity errors correctly', () => {
      const mediumError = {
        name: 'ValidationError',
        message: 'Invalid input'
      };

      const severity = service.classifySeverity(mediumError, 'VALIDATION_ERROR');
      expect(severity).toBe(2); // MEDIUM
    });
  });

  describe('Error Aggregation', () => {
    test('should aggregate similar errors correctly', async () => {
      const errorData = {
        name: 'ValidationError',
        message: 'Invalid email',
        userId: 'user123',
        context: { field: 'email' }
      };

      // Aggregate the same error multiple times
      const result1 = await service.aggregateError(errorData);
      const result2 = await service.aggregateError(errorData);
      const result3 = await service.aggregateError(errorData);

      expect(result1.signature).toBe(result2.signature);
      expect(result2.signature).toBe(result3.signature);
      expect(result3.count).toBe(3);
    });

    test('should track affected users correctly', async () => {
      const errorData1 = {
        name: 'ValidationError',
        message: 'Invalid email',
        userId: 'user123'
      };

      const errorData2 = {
        name: 'ValidationError',
        message: 'Invalid email',
        userId: 'user456'
      };

      await service.aggregateError(errorData1);
      await service.aggregateError(errorData2);

      const groups = service.getErrorGroups();
      const group = groups.groups[0];

      expect(group.affectedUsersCount).toBe(2);
      expect(group.affectedUsers).toContain('user123');
      expect(group.affectedUsers).toContain('user456');
    });

    test('should limit occurrence history', async () => {
      const errorData = {
        name: 'TestError',
        message: 'Test message',
        userId: 'user123'
      };

      // Add more than 100 occurrences
      for (let i = 0; i < 150; i++) {
        await service.aggregateError({
          ...errorData,
          userId: `user${i}`
        });
      }

      const groups = service.getErrorGroups();
      const group = groups.groups[0];

      expect(group.count).toBe(150);
      expect(group.occurrences.length).toBe(100); // Should be limited to 100
    });
  });

  describe('Critical Error Detection', () => {
    test('should flag errors as critical when threshold exceeded', async () => {
      const errorData = {
        name: 'DatabaseError',
        message: 'Connection failed',
        userId: 'user123'
      };

      // Add errors to exceed threshold (5)
      for (let i = 0; i < 6; i++) {
        await service.aggregateError(errorData);
      }

      const criticalErrors = service.getCriticalErrors();
      expect(criticalErrors.length).toBe(1);
      expect(criticalErrors[0].status).toBe('ACTIVE');
    });

    test('should flag critical severity errors immediately', async () => {
      const criticalError = {
        name: 'FatalError',
        message: 'System crash',
        statusCode: 500,
        userId: 'user123'
      };

      await service.aggregateError(criticalError);

      const criticalErrors = service.getCriticalErrors();
      expect(criticalErrors.length).toBe(1);
    });
  });

  describe('Error Retrieval and Filtering', () => {
    beforeEach(async () => {
      // Add test data
      const errors = [
        {
          name: 'ValidationError',
          message: 'Invalid email',
          userId: 'user1'
        },
        {
          name: 'DatabaseError',
          message: 'Connection failed',
          statusCode: 500,
          userId: 'user2'
        },
        {
          name: 'AuthError',
          message: 'Unauthorized',
          statusCode: 401,
          userId: 'user3'
        }
      ];

      for (const error of errors) {
        await service.aggregateError(error);
      }
    });

    test('should retrieve all error groups', () => {
      const result = service.getErrorGroups();
      expect(result.groups.length).toBe(3);
      expect(result.total).toBe(3);
    });

    test('should filter by category', () => {
      const result = service.getErrorGroups({ category: 'VALIDATION_ERROR' });
      expect(result.groups.length).toBe(1);
      expect(result.groups[0].category).toBe('VALIDATION_ERROR');
    });

    test('should filter by severity', () => {
      const result = service.getErrorGroups({ severity: 3 }); // HIGH and above
      expect(result.groups.length).toBe(2); // DATABASE_ERROR and AUTH_ERROR
    });

    test('should support pagination', () => {
      const result = service.getErrorGroups({ limit: 2, offset: 1 });
      expect(result.groups.length).toBe(2);
      expect(result.total).toBe(3);
      expect(result.limit).toBe(2);
      expect(result.offset).toBe(1);
    });

    test('should sort by count descending by default', () => {
      const result = service.getErrorGroups();
      const counts = result.groups.map(g => g.count);
      
      for (let i = 1; i < counts.length; i++) {
        expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
      }
    });
  });

  describe('Error Statistics', () => {
    beforeEach(async () => {
      // Add test data with different categories and severities
      const errors = [
        { name: 'ValidationError', message: 'Invalid email' },
        { name: 'ValidationError', message: 'Invalid phone' },
        { name: 'DatabaseError', message: 'Connection failed', statusCode: 500 },
        { name: 'AuthError', message: 'Unauthorized', statusCode: 401 }
      ];

      for (const error of errors) {
        await service.aggregateError(error);
      }
    });

    test('should calculate error statistics correctly', () => {
      const stats = service.getErrorStatistics();

      expect(stats.totalGroups).toBe(4);
      expect(stats.totalErrors).toBe(4);
      expect(stats.categoryCounts).toHaveProperty('VALIDATION_ERROR', 2);
      expect(stats.categoryCounts).toHaveProperty('DATABASE_ERROR', 1);
      expect(stats.categoryCounts).toHaveProperty('AUTH_ERROR', 1);
      expect(stats.topErrors.length).toBeLessThanOrEqual(10);
    });
  });

  describe('Tag Generation', () => {
    test('should generate appropriate tags', () => {
      const errorData = {
        service: 'userService',
        operation: 'createUser',
        statusCode: 400,
        code: 'VALIDATION_FAILED'
      };

      const tags = service.generateTags(errorData, 'VALIDATION_ERROR');

      expect(tags).toContain('validation_error');
      expect(tags).toContain('service:userService');
      expect(tags).toContain('operation:createUser');
      expect(tags).toContain('status:400');
      expect(tags).toContain('code:VALIDATION_FAILED');
    });
  });

  describe('Data Persistence', () => {
    test('should persist and load aggregation data', async () => {
      const errorData = {
        name: 'TestError',
        message: 'Test message',
        userId: 'user123'
      };

      await service.aggregateError(errorData);
      await service.flushToDisk();

      // Create new service instance to test loading
      const newService = new ErrorAggregationService({
        storageDir: testStorageDir
      });

      await new Promise(resolve => setTimeout(resolve, 200)); // Wait for loading

      const groups = newService.getErrorGroups();
      expect(groups.groups.length).toBe(1);
      expect(groups.groups[0].errorName).toBe('TestError');

      await newService.shutdown();
    });
  });

  describe('Cleanup', () => {
    test('should clean up old error groups', async () => {
      const oldError = {
        name: 'OldError',
        message: 'Old error message',
        userId: 'user123'
      };

      await service.aggregateError(oldError);

      // Manually set old timestamp
      const groups = Array.from(service.errorGroups.values());
      groups[0].lastOccurrence = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000); // 31 days ago

      await service.cleanup(30); // 30 days retention

      const remainingGroups = service.getErrorGroups();
      expect(remainingGroups.groups.length).toBe(0);
    });
  });
});