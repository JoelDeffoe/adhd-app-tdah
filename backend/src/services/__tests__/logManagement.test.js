const fs = require('fs').promises;
const path = require('path');
const LogManager = require('../logManager');
const DiskSpaceMonitor = require('../diskSpaceMonitor');
const LogDirectoryManager = require('../logDirectoryManager');
const IntegratedLogManager = require('../integratedLogManager');

// Test directory
const testLogsDir = path.join(__dirname, '../../../test-logs');

describe('Log Management System', () => {
  let logManager;
  let diskSpaceMonitor;
  let directoryManager;
  let integratedManager;

  beforeAll(async () => {
    // Clean up test directory if it exists
    try {
      await fs.rmdir(testLogsDir, { recursive: true });
    } catch (error) {
      // Directory doesn't exist, that's fine
    }
  });

  afterAll(async () => {
    // Clean up test directory
    try {
      await fs.rmdir(testLogsDir, { recursive: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('LogManager', () => {
    beforeEach(() => {
      logManager = new LogManager(testLogsDir);
    });

    test('should initialize and create log directory', async () => {
      await logManager.initialize();
      
      const stats = await fs.stat(testLogsDir);
      expect(stats.isDirectory()).toBe(true);
    });

    test('should get log files', async () => {
      await logManager.initialize();
      
      // Create a test log file
      const testLogPath = path.join(testLogsDir, 'test.log');
      await fs.writeFile(testLogPath, 'test log content');
      
      const logFiles = await logManager.getLogFiles();
      expect(logFiles.length).toBeGreaterThan(0);
      expect(logFiles[0].name).toBe('test.log');
    });

    test('should get statistics', async () => {
      await logManager.initialize();
      
      const stats = await logManager.getStats();
      expect(stats).toHaveProperty('totalFiles');
      expect(stats).toHaveProperty('totalSize');
      expect(stats).toHaveProperty('compressedFiles');
    });
  });

  describe('DiskSpaceMonitor', () => {
    beforeEach(() => {
      diskSpaceMonitor = new DiskSpaceMonitor(testLogsDir);
    });

    test('should get disk space information', async () => {
      const spaceInfo = await diskSpaceMonitor.getDiskSpace();
      
      expect(spaceInfo).toHaveProperty('available');
      expect(typeof spaceInfo.available).toBe('number');
    });

    test('should check disk space status', async () => {
      const status = await diskSpaceMonitor.checkDiskSpace();
      
      expect(status).toHaveProperty('available');
      expect(status).toHaveProperty('isLow');
      expect(status).toHaveProperty('isCritical');
      expect(typeof status.isLow).toBe('boolean');
      expect(typeof status.isCritical).toBe('boolean');
    });

    test('should format bytes correctly', () => {
      expect(diskSpaceMonitor.formatBytes(1024)).toBe('1 KB');
      expect(diskSpaceMonitor.formatBytes(1024 * 1024)).toBe('1 MB');
      expect(diskSpaceMonitor.formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
    });
  });

  describe('LogDirectoryManager', () => {
    beforeEach(() => {
      directoryManager = new LogDirectoryManager(testLogsDir);
    });

    test('should initialize directory structure', async () => {
      const result = await directoryManager.initialize();
      expect(result).toBe(true);
      
      // Check that subdirectories were created
      const dirInfo = await directoryManager.getDirectoryInfo();
      expect(dirInfo.structure).toHaveProperty('application');
      expect(dirInfo.structure).toHaveProperty('errors');
      expect(dirInfo.structure).toHaveProperty('performance');
    });

    test('should get log file path', async () => {
      await directoryManager.initialize();
      
      const logPath = await directoryManager.getLogFilePath('error', 'test-service');
      expect(logPath).toContain('errors');
      expect(logPath).toContain('test-service');
      expect(logPath).toMatch(/\.log$/);
    });

    test('should validate and fix directory structure', async () => {
      const validation = await directoryManager.validateAndFix();
      
      expect(validation).toHaveProperty('issues');
      expect(validation).toHaveProperty('fixes');
      expect(validation).toHaveProperty('isValid');
      expect(Array.isArray(validation.issues)).toBe(true);
      expect(Array.isArray(validation.fixes)).toBe(true);
    });
  });

  describe('IntegratedLogManager', () => {
    beforeEach(() => {
      integratedManager = new IntegratedLogManager(testLogsDir);
    });

    afterEach(async () => {
      if (integratedManager.isInitialized) {
        await integratedManager.shutdown();
      }
    });

    test('should initialize integrated system', async () => {
      const result = await integratedManager.initialize();
      expect(result).toBe(true);
      expect(integratedManager.isInitialized).toBe(true);
    });

    test('should get system status', async () => {
      await integratedManager.initialize();
      
      const status = await integratedManager.getSystemStatus();
      expect(status).toHaveProperty('initialized');
      expect(status).toHaveProperty('timestamp');
      expect(status).toHaveProperty('logs');
      expect(status).toHaveProperty('diskSpace');
      expect(status).toHaveProperty('directories');
      expect(status).toHaveProperty('health');
    });

    test('should get health check', async () => {
      await integratedManager.initialize();
      
      const healthCheck = await integratedManager.getHealthCheck();
      expect(healthCheck).toHaveProperty('status');
      expect(healthCheck).toHaveProperty('timestamp');
      expect(healthCheck).toHaveProperty('details');
      expect(['healthy', 'warning', 'critical', 'error']).toContain(healthCheck.status);
    });

    test('should perform maintenance', async () => {
      await integratedManager.initialize();
      
      // This should not throw an error
      await expect(integratedManager.performMaintenance()).resolves.not.toThrow();
    });

    test('should force cleanup', async () => {
      await integratedManager.initialize();
      
      const result = await integratedManager.forceCleanup();
      expect(typeof result).toBe('boolean');
    });
  });
});