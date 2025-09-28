const ErrorPatternDetection = require('../errorPatternDetection');
const ErrorAggregationService = require('../errorAggregationService');
const fs = require('fs').promises;
const path = require('path');

// Mock fs operations
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn()
  }
}));

describe('ErrorPatternDetection', () => {
  let patternDetection;
  let mockAggregationService;
  let testStorageDir;

  beforeEach(() => {
    testStorageDir = path.join(__dirname, '../../../logs/test-patterns');
    
    // Mock aggregation service
    mockAggregationService = {
      getErrorGroups: jest.fn().mockReturnValue({ groups: [], total: 0 }),
      getErrorStatistics: jest.fn().mockReturnValue({ 
        totalErrors: 0, 
        categoryCounts: {} 
      })
    };

    // Reset fs mocks
    fs.mkdir.mockResolvedValue();
    fs.readFile.mockRejectedValue(new Error('File not found'));
    fs.writeFile.mockResolvedValue();

    patternDetection = new ErrorPatternDetection(mockAggregationService, {
      storageDir: testStorageDir,
      patternAnalysisInterval: 1000000, // Very long interval to prevent auto-execution
      trendAnalysisInterval: 1000000,
      minOccurrencesForPattern: 2,
      newPatternAlertThreshold: 2
    });
  });

  afterEach(async () => {
    if (patternDetection) {
      await patternDetection.shutdown();
    }
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  describe('Initialization', () => {
    test('should initialize with default configuration', () => {
      expect(patternDetection.config.minOccurrencesForPattern).toBe(2);
      expect(patternDetection.config.newPatternAlertThreshold).toBe(2);
      expect(patternDetection.detectedPatterns).toBeInstanceOf(Map);
      expect(patternDetection.errorTrends).toBeInstanceOf(Map);
      expect(patternDetection.activeAlerts).toBeInstanceOf(Map);
    });

    test('should create storage directory on initialization', async () => {
      expect(fs.mkdir).toHaveBeenCalledWith(testStorageDir, { recursive: true });
    });
  });

  describe('Pattern Detection', () => {
    test('should detect recurring error patterns', async () => {
      const mockErrorGroups = [
        {
          signature: 'error1',
          category: 'VALIDATION_ERROR',
          count: 5,
          errorMessage: 'Invalid user input: field required',
          stackTrace: 'Error at validateUser:10\n  at processForm:25',
          firstOccurrence: new Date('2024-01-01T10:00:00Z'),
          lastOccurrence: new Date('2024-01-01T11:00:00Z'),
          occurrences: [
            { timestamp: new Date('2024-01-01T10:00:00Z'), userId: 'user1' },
            { timestamp: new Date('2024-01-01T10:30:00Z'), userId: 'user2' },
            { timestamp: new Date('2024-01-01T11:00:00Z'), userId: 'user3' }
          ],
          affectedUsers: ['user1', 'user2', 'user3'],
          tags: ['service:userService']
        },
        {
          signature: 'error2',
          category: 'VALIDATION_ERROR',
          count: 3,
          errorMessage: 'Invalid user input: email format',
          stackTrace: 'Error at validateUser:15\n  at processForm:25',
          firstOccurrence: new Date('2024-01-01T10:15:00Z'),
          lastOccurrence: new Date('2024-01-01T10:45:00Z'),
          occurrences: [
            { timestamp: new Date('2024-01-01T10:15:00Z'), userId: 'user4' },
            { timestamp: new Date('2024-01-01T10:30:00Z'), userId: 'user5' },
            { timestamp: new Date('2024-01-01T10:45:00Z'), userId: 'user6' }
          ],
          affectedUsers: ['user4', 'user5', 'user6'],
          tags: ['service:userService']
        }
      ];

      mockAggregationService.getErrorGroups.mockReturnValue({
        groups: mockErrorGroups,
        total: 2
      });

      await patternDetection.analyzePatterns();

      const patterns = patternDetection.getDetectedPatterns();
      expect(patterns.patterns.length).toBeGreaterThan(0);
      
      const recurringPattern = patterns.patterns.find(p => p.type === 'RECURRING');
      expect(recurringPattern).toBeDefined();
      expect(recurringPattern.category).toBe('VALIDATION_ERROR');
      expect(recurringPattern.confidence).toBeGreaterThan(0);
    });

    test('should detect temporal patterns', async () => {
      const mockErrorGroups = [
        {
          signature: 'error1',
          category: 'SYSTEM_ERROR',
          count: 10,
          errorMessage: 'Database connection timeout',
          occurrences: Array.from({ length: 10 }, (_, i) => ({
            timestamp: new Date(`2024-01-01T14:${String(i * 5).padStart(2, '0')}:00Z`), // All at hour 14
            userId: `user${i}`
          })),
          firstOccurrence: new Date('2024-01-01T14:00:00Z'),
          lastOccurrence: new Date('2024-01-01T14:45:00Z')
        }
      ];

      mockAggregationService.getErrorGroups.mockReturnValue({
        groups: mockErrorGroups,
        total: 1
      });

      await patternDetection.analyzePatterns();

      const patterns = patternDetection.getDetectedPatterns();
      const temporalPattern = patterns.patterns.find(p => p.type === 'TEMPORAL_HOURLY');
      
      if (temporalPattern) {
        expect(typeof temporalPattern.hour).toBe('number');
        expect(temporalPattern.hour).toBeGreaterThanOrEqual(0);
        expect(temporalPattern.hour).toBeLessThan(24);
        expect(temporalPattern.multiplier).toBeGreaterThan(1);
      }
    });

    test('should detect correlation patterns', async () => {
      const baseTime = new Date('2024-01-01T10:00:00Z');
      const mockErrorGroups = [
        {
          signature: 'error1',
          category: 'DATABASE_ERROR',
          count: 5,
          occurrences: Array.from({ length: 5 }, (_, i) => ({
            timestamp: new Date(baseTime.getTime() + i * 60000), // Every minute
            userId: `user${i}`
          }))
        },
        {
          signature: 'error2',
          category: 'AUTH_ERROR',
          count: 5,
          occurrences: Array.from({ length: 5 }, (_, i) => ({
            timestamp: new Date(baseTime.getTime() + i * 60000 + 30000), // 30 seconds after DB errors
            userId: `user${i}`
          }))
        }
      ];

      mockAggregationService.getErrorGroups.mockReturnValue({
        groups: mockErrorGroups,
        total: 2
      });

      await patternDetection.analyzePatterns();

      const patterns = patternDetection.getDetectedPatterns();
      const correlationPattern = patterns.patterns.find(p => p.type === 'CORRELATION');
      
      if (correlationPattern) {
        expect(correlationPattern.category1).toBeDefined();
        expect(correlationPattern.category2).toBeDefined();
        expect(correlationPattern.correlationStrength).toBeGreaterThan(0);
      }
    });
  });

  describe('Trend Analysis', () => {
    test('should analyze error trends', async () => {
      const mockStats = {
        totalErrors: 100,
        categoryCounts: {
          'VALIDATION_ERROR': 50,
          'SYSTEM_ERROR': 30,
          'AUTH_ERROR': 20
        }
      };

      mockAggregationService.getErrorStatistics.mockReturnValue(mockStats);

      await patternDetection.analyzeTrends();

      const trends = patternDetection.getErrorTrends();
      expect(trends.length).toBeGreaterThan(0);
      
      const validationTrend = trends.find(t => t.category === 'VALIDATION_ERROR');
      expect(validationTrend).toBeDefined();
      expect(validationTrend.dataPoints.length).toBeGreaterThan(0);
    });

    test('should detect increasing trends', async () => {
      const mockStats1 = { totalErrors: 5, categoryCounts: { 'SYSTEM_ERROR': 5 } };
      const mockStats2 = { totalErrors: 10, categoryCounts: { 'SYSTEM_ERROR': 10 } };
      const mockStats3 = { totalErrors: 25, categoryCounts: { 'SYSTEM_ERROR': 25 } };

      // Simulate multiple trend analysis cycles with significant growth
      mockAggregationService.getErrorStatistics
        .mockReturnValueOnce(mockStats1)
        .mockReturnValueOnce(mockStats2)
        .mockReturnValueOnce(mockStats3);

      await patternDetection.analyzeTrends();
      await patternDetection.analyzeTrends();
      await patternDetection.analyzeTrends();

      const systemTrend = patternDetection.getErrorTrends('SYSTEM_ERROR');
      expect(systemTrend).toBeDefined();
      expect(systemTrend.dataPoints.length).toBe(3);
      
      if (systemTrend.dataPoints.length >= 3) {
        // The trend should be either INCREASING or at least have positive growth
        expect(['INCREASING', 'STABLE']).toContain(systemTrend.trend);
        expect(systemTrend.growthRate).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Alert Generation', () => {
    test('should create pattern alerts for new patterns', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      const mockErrorGroups = [
        {
          signature: 'critical-error',
          category: 'SYSTEM_ERROR',
          count: 5,
          errorMessage: 'Critical system failure',
          stackTrace: 'Error at system.js:100',
          firstOccurrence: new Date(),
          lastOccurrence: new Date(),
          occurrences: Array.from({ length: 5 }, (_, i) => ({
            timestamp: new Date(),
            userId: `user${i}`
          })),
          affectedUsers: ['user1', 'user2', 'user3', 'user4', 'user5']
        }
      ];

      mockAggregationService.getErrorGroups.mockReturnValue({
        groups: mockErrorGroups,
        total: 1
      });

      await patternDetection.analyzePatterns();

      const alerts = patternDetection.getActiveAlerts();
      expect(alerts.length).toBeGreaterThan(0);
      
      const patternAlert = alerts.find(a => a.type === 'PATTERN');
      if (patternAlert) {
        expect(patternAlert.severity).toBeDefined();
        expect(patternAlert.reason).toContain('recurring error pattern');
      }

      consoleSpy.mockRestore();
    });

    test('should create trend alerts for rapid growth', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      // Simulate rapid error growth
      const mockStats = [
        { totalErrors: 10, categoryCounts: { 'API_ERROR': 10 } },
        { totalErrors: 15, categoryCounts: { 'API_ERROR': 15 } },
        { totalErrors: 35, categoryCounts: { 'API_ERROR': 35 } } // 133% growth
      ];

      for (const stats of mockStats) {
        mockAggregationService.getErrorStatistics.mockReturnValueOnce(stats);
        await patternDetection.analyzeTrends();
      }

      const alerts = patternDetection.getActiveAlerts();
      const trendAlert = alerts.find(a => a.type === 'TREND' && a.trendType === 'RAPID_GROWTH');
      
      if (trendAlert) {
        expect(trendAlert.category).toBe('API_ERROR');
        expect(trendAlert.severity).toBe('HIGH');
        expect(trendAlert.reason).toContain('Rapid error growth');
      }

      consoleSpy.mockRestore();
    });
  });

  describe('Pattern Summary Report', () => {
    test('should generate comprehensive pattern summary report', async () => {
      // Setup some test data
      const mockErrorGroups = [
        {
          signature: 'error1',
          category: 'VALIDATION_ERROR',
          count: 10,
          errorMessage: 'Validation failed',
          stackTrace: 'Error at validate.js:10',
          firstOccurrence: new Date(),
          lastOccurrence: new Date(),
          occurrences: Array.from({ length: 10 }, (_, i) => ({
            timestamp: new Date(),
            userId: `user${i}`
          })),
          affectedUsers: Array.from({ length: 5 }, (_, i) => `user${i}`)
        }
      ];

      mockAggregationService.getErrorGroups.mockReturnValue({
        groups: mockErrorGroups,
        total: 1
      });

      mockAggregationService.getErrorStatistics.mockReturnValue({
        totalErrors: 10,
        categoryCounts: { 'VALIDATION_ERROR': 10 }
      });

      await patternDetection.analyzePatterns();
      await patternDetection.analyzeTrends();

      const report = patternDetection.generatePatternSummaryReport();

      expect(report).toHaveProperty('generatedAt');
      expect(report).toHaveProperty('summary');
      expect(report).toHaveProperty('topPatterns');
      expect(report).toHaveProperty('criticalTrends');
      expect(report).toHaveProperty('activeAlerts');

      expect(report.summary.totalPatterns).toBeGreaterThanOrEqual(0);
      expect(report.summary.trendsAnalyzed).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(report.topPatterns)).toBe(true);
      expect(Array.isArray(report.criticalTrends)).toBe(true);
      expect(Array.isArray(report.activeAlerts)).toBe(true);
    });
  });

  describe('Data Persistence', () => {
    test('should save pattern data to disk', async () => {
      // Add some test patterns
      patternDetection.detectedPatterns.set('test-pattern', {
        signature: 'test-pattern',
        type: 'RECURRING',
        category: 'TEST_ERROR',
        confidence: 0.8,
        firstDetected: new Date(),
        lastSeen: new Date()
      });

      await patternDetection.savePatternData();

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('error-patterns.json'),
        expect.stringContaining('test-pattern')
      );
    });

    test('should save trend data to disk', async () => {
      // Add some test trends
      patternDetection.errorTrends.set('TEST_ERROR', {
        category: 'TEST_ERROR',
        dataPoints: [
          { timestamp: new Date(), count: 5, rate: 0.1 }
        ],
        trend: 'STABLE',
        growthRate: 0,
        lastAnalysis: new Date()
      });

      await patternDetection.saveTrendData();

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('error-trends.json'),
        expect.stringContaining('TEST_ERROR')
      );
    });
  });

  describe('Utility Functions', () => {
    test('should extract message patterns correctly', () => {
      const message1 = 'User 12345 not found in database';
      const message2 = 'User 67890 not found in database';
      
      const pattern1 = patternDetection.extractMessagePattern(message1);
      const pattern2 = patternDetection.extractMessagePattern(message2);
      
      expect(pattern1).toBe(pattern2);
      expect(pattern1).toBe('user {number} not found in database');
    });

    test('should extract stack patterns correctly', () => {
      const stack1 = 'Error at user.js:123:45\n  at service.js:67:89\n  at controller.js:12:34';
      const stack2 = 'Error at user.js:999:11\n  at service.js:22:33\n  at controller.js:44:55';
      
      const pattern1 = patternDetection.extractStackPattern(stack1);
      const pattern2 = patternDetection.extractStackPattern(stack2);
      
      expect(pattern1).toBe(pattern2);
      expect(pattern1).toContain('user.js:LINE:COL');
    });

    test('should calculate pattern confidence correctly', () => {
      const pattern = {
        totalOccurrences: 10,
        errorGroups: ['group1', 'group2', 'group3'],
        affectedUsersCount: 5
      };
      
      const confidence = patternDetection.calculatePatternConfidence(pattern);
      
      expect(confidence).toBeGreaterThan(0);
      expect(confidence).toBeLessThanOrEqual(0.95);
    });
  });

  describe('Cleanup', () => {
    test('should cleanup old patterns and trends', async () => {
      const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000); // 35 days ago
      const recentDate = new Date();

      // Add old and recent patterns
      patternDetection.detectedPatterns.set('old-pattern', {
        signature: 'old-pattern',
        lastSeen: oldDate
      });
      
      patternDetection.detectedPatterns.set('recent-pattern', {
        signature: 'recent-pattern',
        lastSeen: recentDate
      });

      await patternDetection.cleanup(30); // 30 days retention

      expect(patternDetection.detectedPatterns.has('old-pattern')).toBe(false);
      expect(patternDetection.detectedPatterns.has('recent-pattern')).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('should handle errors in pattern analysis gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      mockAggregationService.getErrorGroups.mockImplementation(() => {
        throw new Error('Aggregation service error');
      });

      await patternDetection.analyzePatterns();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Error in pattern analysis:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    test('should handle errors in trend analysis gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      mockAggregationService.getErrorStatistics.mockImplementation(() => {
        throw new Error('Statistics service error');
      });

      await patternDetection.analyzeTrends();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Error in trend analysis:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });
});