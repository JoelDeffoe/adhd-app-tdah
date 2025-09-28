const LogManager = require('./logManager');
const DiskSpaceMonitor = require('./diskSpaceMonitor');
const LogDirectoryManager = require('./logDirectoryManager');
const path = require('path');

class IntegratedLogManager {
  constructor(logsDir = path.join(__dirname, '../../logs')) {
    this.logsDir = logsDir;
    
    // Initialize component services
    this.logManager = new LogManager(logsDir);
    this.diskSpaceMonitor = new DiskSpaceMonitor(logsDir);
    this.directoryManager = new LogDirectoryManager(logsDir);
    
    this.isInitialized = false;
  }

  /**
   * Initialize the complete log management system
   */
  async initialize() {
    if (this.isInitialized) {
      console.log('Log management system already initialized');
      return true;
    }

    try {
      console.log('Initializing integrated log management system...');

      // 1. Initialize directory structure
      console.log('Setting up directory structure...');
      await this.directoryManager.initialize();

      // 2. Initialize log manager
      console.log('Initializing log manager...');
      await this.logManager.initialize();

      // 3. Start disk space monitoring
      console.log('Starting disk space monitoring...');
      this.diskSpaceMonitor.startMonitoring();

      // 4. Set up periodic maintenance
      this.startPeriodicMaintenance();

      this.isInitialized = true;
      console.log('Integrated log management system initialized successfully');
      
      // Log system status
      await this.logSystemStatus();
      
      return true;
    } catch (error) {
      console.error('Failed to initialize integrated log management system:', error);
      return false;
    }
  }

  /**
   * Start periodic maintenance tasks
   */
  startPeriodicMaintenance() {
    // Run maintenance every 6 hours
    const maintenanceInterval = 6 * 60 * 60 * 1000;
    
    this.maintenanceTimer = setInterval(async () => {
      try {
        console.log('Running periodic log maintenance...');
        await this.performMaintenance();
      } catch (error) {
        console.error('Error during periodic maintenance:', error);
      }
    }, maintenanceInterval);

    console.log('Periodic maintenance scheduled every 6 hours');
  }

  /**
   * Perform comprehensive maintenance
   */
  async performMaintenance() {
    try {
      console.log('Starting comprehensive log maintenance...');

      // 1. Validate and fix directory structure
      const validation = await this.directoryManager.validateAndFix();
      if (validation.fixes.length > 0) {
        console.log('Directory fixes applied:', validation.fixes);
      }

      // 2. Perform log cleanup and rotation
      await this.logManager.performCleanup();

      // 3. Check disk space and cleanup if needed
      const spaceStatus = await this.diskSpaceMonitor.checkDiskSpace();
      if (spaceStatus.isLow || spaceStatus.isCritical) {
        console.log('Disk space issue detected, performing cleanup...');
        await this.diskSpaceMonitor.forceCleanup();
      }

      // 4. Archive old directories (older than 3 months)
      const archivedCount = await this.directoryManager.archiveOldDirectories(3);
      if (archivedCount > 0) {
        console.log(`Archived ${archivedCount} old directories`);
      }

      // 5. Clean up empty directories
      const emptyDirsRemoved = await this.directoryManager.cleanupEmptyDirectories();
      if (emptyDirsRemoved > 0) {
        console.log(`Removed ${emptyDirsRemoved} empty directories`);
      }

      console.log('Comprehensive log maintenance completed');
      
      // Log maintenance summary
      await this.logMaintenanceSummary({
        validation,
        spaceStatus,
        archivedCount,
        emptyDirsRemoved
      });

    } catch (error) {
      console.error('Error during comprehensive maintenance:', error);
    }
  }

  /**
   * Get comprehensive system status
   */
  async getSystemStatus() {
    try {
      const [
        logStats,
        diskSpaceStatus,
        directoryInfo,
        diskSpaceMonitorStatus
      ] = await Promise.all([
        this.logManager.getStats(),
        this.diskSpaceMonitor.checkDiskSpace(),
        this.directoryManager.getDirectoryInfo(),
        Promise.resolve(this.diskSpaceMonitor.getStatus())
      ]);

      return {
        initialized: this.isInitialized,
        timestamp: new Date().toISOString(),
        logs: logStats,
        diskSpace: {
          ...diskSpaceStatus,
          monitoring: diskSpaceMonitorStatus
        },
        directories: directoryInfo,
        health: this.assessSystemHealth(logStats, diskSpaceStatus, directoryInfo)
      };
    } catch (error) {
      console.error('Error getting system status:', error);
      return {
        initialized: this.isInitialized,
        timestamp: new Date().toISOString(),
        error: error.message,
        health: 'error'
      };
    }
  }

  /**
   * Assess overall system health
   */
  assessSystemHealth(logStats, diskSpaceStatus, directoryInfo) {
    const issues = [];

    // Check disk space
    if (diskSpaceStatus.isCritical) {
      issues.push('critical_disk_space');
    } else if (diskSpaceStatus.isLow) {
      issues.push('low_disk_space');
    }

    // Check log file count
    if (logStats.totalFiles > 100) {
      issues.push('too_many_log_files');
    }

    // Check total log size (warn if over 1GB)
    if (logStats.totalSize > 1024 * 1024 * 1024) {
      issues.push('large_log_size');
    }

    // Check for oversized files
    if (logStats.oversizedFiles > 0) {
      issues.push('oversized_log_files');
    }

    // Determine overall health
    if (issues.length === 0) {
      return 'healthy';
    } else if (issues.some(issue => issue.includes('critical'))) {
      return 'critical';
    } else {
      return 'warning';
    }
  }

  /**
   * Log system status information
   */
  async logSystemStatus() {
    try {
      const status = await this.getSystemStatus();
      console.log('Log Management System Status:', {
        health: status.health,
        totalFiles: status.logs?.totalFiles || 0,
        totalSize: this.formatBytes(status.logs?.totalSize || 0),
        availableSpace: this.formatBytes(status.diskSpace?.available || 0),
        directories: Object.keys(status.directories?.structure || {}).length
      });
    } catch (error) {
      console.error('Error logging system status:', error);
    }
  }

  /**
   * Log maintenance summary
   */
  async logMaintenanceSummary(summary) {
    console.log('Maintenance Summary:', {
      timestamp: new Date().toISOString(),
      directoryFixes: summary.validation?.fixes?.length || 0,
      diskSpaceHealth: summary.spaceStatus?.isCritical ? 'critical' : 
                      summary.spaceStatus?.isLow ? 'low' : 'healthy',
      archivedDirectories: summary.archivedCount || 0,
      emptyDirectoriesRemoved: summary.emptyDirsRemoved || 0
    });
  }

  /**
   * Get log file path for a specific type and service
   */
  async getLogFilePath(logType, service = 'focusmate', date = new Date()) {
    return await this.directoryManager.getLogFilePath(logType, service, date);
  }

  /**
   * Force immediate cleanup
   */
  async forceCleanup() {
    console.log('Forcing immediate log cleanup...');
    
    try {
      // Perform all cleanup operations
      await this.logManager.performCleanup();
      await this.diskSpaceMonitor.forceCleanup();
      await this.directoryManager.cleanupEmptyDirectories();
      
      console.log('Forced cleanup completed');
      return true;
    } catch (error) {
      console.error('Error during forced cleanup:', error);
      return false;
    }
  }

  /**
   * Update configuration for all components
   */
  updateConfiguration(config) {
    if (config.logManager) {
      this.logManager.updateConfig(config.logManager);
    }
    
    if (config.diskSpaceMonitor) {
      this.diskSpaceMonitor.updateConfig(config.diskSpaceMonitor);
    }
    
    console.log('Configuration updated for log management system');
  }

  /**
   * Shutdown the log management system
   */
  async shutdown() {
    try {
      console.log('Shutting down log management system...');
      
      // Stop disk space monitoring
      this.diskSpaceMonitor.stopMonitoring();
      
      // Stop periodic maintenance
      if (this.maintenanceTimer) {
        clearInterval(this.maintenanceTimer);
        this.maintenanceTimer = null;
      }
      
      // Perform final cleanup
      await this.performMaintenance();
      
      this.isInitialized = false;
      console.log('Log management system shutdown completed');
    } catch (error) {
      console.error('Error during shutdown:', error);
    }
  }

  /**
   * Format bytes to human readable format
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Get health check endpoint data
   */
  async getHealthCheck() {
    const status = await this.getSystemStatus();
    
    return {
      status: status.health,
      timestamp: status.timestamp,
      details: {
        initialized: status.initialized,
        logFiles: status.logs?.totalFiles || 0,
        diskSpace: {
          available: status.diskSpace?.available || 0,
          isLow: status.diskSpace?.isLow || false,
          isCritical: status.diskSpace?.isCritical || false
        },
        monitoring: status.diskSpace?.monitoring?.isMonitoring || false
      }
    };
  }
}

module.exports = IntegratedLogManager;