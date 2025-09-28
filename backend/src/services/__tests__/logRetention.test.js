const LogRetentionService = require('../logRetention');
const fs = require('fs').promises;
const path = require('path');

describe('LogRetentionService', () => {
  let retentionService;
  let testLogsDir;

  beforeEach(() => {
    testLogsDir = path.join(__dirname, 'test-logs');
    retentionService = new LogRetentionService({
      logsDirectory: testLogsDir,
      enableAutoPurge: false, // Disable for testing
      retentionDays: 30
    });
  });

  afterEach(async () => {
    retentionService.shutdown();
    
    // Cleanup test directory
    try {
      await fs.rmdir(testLogsDir, { recursive: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Retention Policies', () => {
    test('should set and get retention policies', () => {
      retentionService.setRetentionPolicy('error', 90);
      expect(retentionService.getRetentionPolicy('error')).toBe(90);
      
      retentionService.setRetentionPolicy('debug', 7);
      expect(retentionService.getRetentionPolicy('debug')).toBe(7);
    });

    test('should return default retention for unknown levels', () => {
      const defaultRetention = retentionService.getRetentionPolicy('unknown');
      expect(defaultRetention).toBe(30);
    });
  });

  describe('User Log Deletion', () => {
    test('should create deletion request', async () => {
      const result = await retentionService.requestUserLogDeletion('user123', 'privacy_request');
      
      expect(result.success).toBe(true);
      expect(result.requestId).toBeTruthy();
      
      const status = retentionService.getDeletionRequestStatus(result.requestId);
      expect(status).toBeTruthy();
      expect(status.userId).toBe('user123');
      expect(status.reason).toBe('privacy_request');
    });

    test('should identify user logs correctly', () => {
      const userLog1 = { userId: 'user123', message: 'User action' };
      const userLog2 = { context: { userId: 'user123' }, message: 'Context action' };
      const userLog3 = { message: 'Action by user123' };
      const nonUserLog = { userId: 'user456', message: 'Other user action' };

      expect(retentionService.isUserLog(userLog1, 'user123')).toBe(true);
      expect(retentionService.isUserLog(userLog2, 'user123')).toBe(true);
      expect(retentionService.isUserLog(userLog3, 'user123')).toBe(true);
      expect(retentionService.isUserLog(nonUserLog, 'user123')).toBe(false);
    });

    test('should get user deletion requests', async () => {
      await retentionService.requestUserLogDeletion('user123', 'request1');
      await retentionService.requestUserLogDeletion('user123', 'request2');
      await retentionService.requestUserLogDeletion('user456', 'request3');

      const user123Requests = retentionService.getUserDeletionRequests('user123');
      expect(user123Requests).toHaveLength(2);
      expect(user123Requests[0].reason).toBe('request1');
      expect(user123Requests[1].reason).toBe('request2');

      const user456Requests = retentionService.getUserDeletionRequests('user456');
      expect(user456Requests).toHaveLength(1);
      expect(user456Requests[0].reason).toBe('request3');
    });
  });

  describe('Log Purging', () => {
    test('should determine if log should be purged', () => {
      const now = new Date();
      const oldDate = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000); // 40 days ago
      const recentDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 days ago

      const oldLog = { level: 'info', timestamp: oldDate.toISOString() };
      const recentLog = { level: 'info', timestamp: recentDate.toISOString() };

      expect(retentionService.shouldPurgeLog(oldLog)).toBe(true);
      expect(retentionService.shouldPurgeLog(recentLog)).toBe(false);
    });

    test('should respect different retention policies by level', () => {
      const now = new Date();
      const date20DaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);

      retentionService.setRetentionPolicy('error', 30);
      retentionService.setRetentionPolicy('debug', 7);

      const errorLog = { level: 'error', timestamp: date20DaysAgo.toISOString() };
      const debugLog = { level: 'debug', timestamp: date20DaysAgo.toISOString() };

      expect(retentionService.shouldPurgeLog(errorLog)).toBe(false); // Within 30 days
      expect(retentionService.shouldPurgeLog(debugLog)).toBe(true);  // Beyond 7 days
    });

    test('should handle invalid log entries gracefully', () => {
      const invalidLog = { level: 'info' }; // No timestamp
      expect(retentionService.shouldPurgeLog(invalidLog)).toBe(false);
    });
  });

  describe('Configuration', () => {
    test('should update configuration', () => {
      retentionService.updateConfig({
        retentionDays: 60,
        enableAutoPurge: true
      });

      expect(retentionService.config.retentionDays).toBe(60);
      expect(retentionService.config.enableAutoPurge).toBe(true);
    });

    test('should start and stop auto-purge', () => {
      expect(retentionService.purgeTimer).toBeNull();
      
      retentionService.updateConfig({ enableAutoPurge: true });
      expect(retentionService.purgeTimer).toBeTruthy();
      
      retentionService.stopAutoPurge();
      expect(retentionService.purgeTimer).toBeNull();
    });
  });

  describe('Statistics', () => {
    test('should provide retention statistics', async () => {
      const stats = await retentionService.getRetentionStats();
      
      expect(stats).toHaveProperty('totalFiles');
      expect(stats).toHaveProperty('retentionPolicies');
      expect(stats).toHaveProperty('deletionRequests');
      expect(stats).toHaveProperty('autoPurgeEnabled');
      expect(stats.retentionPolicies).toHaveProperty('error');
      expect(stats.retentionPolicies).toHaveProperty('warn');
    });
  });

  describe('Error Handling', () => {
    test('should handle missing deletion request', async () => {
      const status = retentionService.getDeletionRequestStatus('nonexistent');
      expect(status).toBeUndefined();
    });

    test('should handle file system errors gracefully', async () => {
      // Test with invalid directory
      const invalidService = new LogRetentionService({
        logsDirectory: '/invalid/path/that/does/not/exist',
        enableAutoPurge: false
      });

      const result = await invalidService.purgeOldLogs();
      expect(result.success).toBe(true); // Should succeed even with no files
      expect(result.purgedEntries).toBe(0);
      
      invalidService.shutdown();
    });
  });
});