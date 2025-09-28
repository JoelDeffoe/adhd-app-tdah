const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

class DiskSpaceMonitor {
  constructor(logsDir = path.join(__dirname, '../../logs')) {
    this.logsDir = logsDir;
    this.lowSpaceThreshold = 100 * 1024 * 1024; // 100MB
    this.criticalSpaceThreshold = 50 * 1024 * 1024; // 50MB
    this.monitoringInterval = 5 * 60 * 1000; // 5 minutes
    this.isMonitoring = false;
    this.lastSpaceCheck = null;
    this.spaceCheckCache = null;
    this.cacheValidityMs = 60 * 1000; // 1 minute cache
  }

  /**
   * Start disk space monitoring
   */
  startMonitoring() {
    if (this.isMonitoring) {
      return;
    }

    this.isMonitoring = true;
    console.log('Starting disk space monitoring...');

    // Initial check
    this.checkDiskSpace();

    // Set up periodic monitoring
    this.monitoringTimer = setInterval(async () => {
      try {
        await this.checkDiskSpace();
      } catch (error) {
        console.error('Error during disk space monitoring:', error);
      }
    }, this.monitoringInterval);
  }

  /**
   * Stop disk space monitoring
   */
  stopMonitoring() {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
    this.isMonitoring = false;
    console.log('Stopped disk space monitoring');
  }

  /**
   * Get available disk space for the logs directory
   */
  async getDiskSpace() {
    // Use cache if available and valid
    if (this.spaceCheckCache && this.lastSpaceCheck && 
        (Date.now() - this.lastSpaceCheck) < this.cacheValidityMs) {
      return this.spaceCheckCache;
    }

    try {
      let spaceInfo;

      if (process.platform === 'win32') {
        // Windows - use a simpler approach
        try {
          const drive = path.parse(this.logsDir).root;
          const output = execSync(`dir /-c "${drive}"`, { encoding: 'utf8' });
          // For Windows, we'll use a fallback approach since disk space commands vary
          spaceInfo = {
            available: 1024 * 1024 * 1024, // Assume 1GB available as fallback
            platform: 'win32',
            fallback: true
          };
        } catch (winError) {
          // Windows fallback
          spaceInfo = {
            available: 1024 * 1024 * 1024, // 1GB fallback
            platform: 'win32',
            fallback: true
          };
        }
      } else {
        // Unix-like systems (Linux, macOS)
        const output = execSync(`df -B1 "${this.logsDir}"`, { encoding: 'utf8' });
        const lines = output.split('\n');
        if (lines.length > 1) {
          const parts = lines[1].split(/\s+/);
          spaceInfo = {
            available: parseInt(parts[3]),
            total: parseInt(parts[1]),
            used: parseInt(parts[2]),
            platform: process.platform
          };
        }
      }

      if (!spaceInfo) {
        throw new Error('Could not parse disk space information');
      }

      // Cache the result
      this.spaceCheckCache = spaceInfo;
      this.lastSpaceCheck = Date.now();

      return spaceInfo;
    } catch (error) {
      console.error('Error getting disk space:', error);
      // Return fallback values
      return {
        available: this.lowSpaceThreshold * 2, // Assume we have enough space
        error: error.message,
        platform: process.platform
      };
    }
  }

  /**
   * Check disk space and take action if needed
   */
  async checkDiskSpace() {
    const spaceInfo = await this.getDiskSpace();
    const availableSpace = spaceInfo.available;

    console.log(`Available disk space: ${this.formatBytes(availableSpace)}`);

    if (availableSpace <= this.criticalSpaceThreshold) {
      console.warn('CRITICAL: Very low disk space detected!');
      await this.handleCriticalSpace();
    } else if (availableSpace <= this.lowSpaceThreshold) {
      console.warn('WARNING: Low disk space detected');
      await this.handleLowSpace();
    }

    return {
      available: availableSpace,
      isLow: availableSpace <= this.lowSpaceThreshold,
      isCritical: availableSpace <= this.criticalSpaceThreshold,
      threshold: {
        low: this.lowSpaceThreshold,
        critical: this.criticalSpaceThreshold
      }
    };
  }

  /**
   * Handle low disk space situation
   */
  async handleLowSpace() {
    console.log('Handling low disk space...');
    
    try {
      // Get all log files
      const logFiles = await this.getLogFiles();
      
      // Prioritize cleanup: keep error logs, remove info/debug logs first
      const infoLogs = logFiles.filter(f => 
        f.name.includes('application-') && !f.name.includes('error-')
      );
      
      // Remove oldest info logs first
      const sortedInfoLogs = infoLogs.sort((a, b) => a.created - b.created);
      const logsToRemove = sortedInfoLogs.slice(0, Math.ceil(sortedInfoLogs.length * 0.3));
      
      for (const logFile of logsToRemove) {
        try {
          await fs.unlink(logFile.path);
          console.log(`Removed info log due to low space: ${logFile.name}`);
        } catch (error) {
          console.error(`Failed to remove log file ${logFile.name}:`, error);
        }
      }

      // Compress remaining uncompressed files
      const uncompressedLogs = logFiles.filter(f => !f.isCompressed && !logsToRemove.includes(f));
      for (const logFile of uncompressedLogs.slice(0, 5)) { // Limit to 5 files at a time
        try {
          await this.compressFile(logFile.path);
        } catch (error) {
          console.error(`Failed to compress log file ${logFile.name}:`, error);
        }
      }

    } catch (error) {
      console.error('Error handling low disk space:', error);
    }
  }

  /**
   * Handle critical disk space situation
   */
  async handleCriticalSpace() {
    console.log('Handling critical disk space...');
    
    try {
      const logFiles = await this.getLogFiles();
      
      // In critical situation, be more aggressive
      // Keep only error logs from the last 2 days
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      
      const logsToRemove = logFiles.filter(f => {
        // Keep recent error logs
        if (f.name.includes('error-') && f.created > twoDaysAgo) {
          return false;
        }
        // Keep recent exception logs
        if (f.name.includes('exception-') && f.created > twoDaysAgo) {
          return false;
        }
        // Remove everything else
        return true;
      });

      for (const logFile of logsToRemove) {
        try {
          await fs.unlink(logFile.path);
          console.log(`Removed log due to critical space: ${logFile.name}`);
        } catch (error) {
          console.error(`Failed to remove log file ${logFile.name}:`, error);
        }
      }

      console.log(`Removed ${logsToRemove.length} log files due to critical disk space`);

    } catch (error) {
      console.error('Error handling critical disk space:', error);
    }
  }

  /**
   * Get all log files with metadata
   */
  async getLogFiles() {
    try {
      const files = await fs.readdir(this.logsDir);
      const logFiles = [];
      
      for (const file of files) {
        const filePath = path.join(this.logsDir, file);
        try {
          const stats = await fs.stat(filePath);
          if (stats.isFile() && this.isLogFile(file)) {
            logFiles.push({
              name: file,
              path: filePath,
              size: stats.size,
              created: stats.birthtime,
              modified: stats.mtime,
              isCompressed: file.endsWith('.gz')
            });
          }
        } catch (statError) {
          console.warn(`Could not stat file ${file}:`, statError.message);
        }
      }
      
      return logFiles;
    } catch (error) {
      console.error('Error reading log directory:', error);
      return [];
    }
  }

  /**
   * Check if file is a log file
   */
  isLogFile(filename) {
    const logExtensions = ['.log', '.log.gz'];
    return logExtensions.some(ext => filename.endsWith(ext));
  }

  /**
   * Compress a log file
   */
  async compressFile(filePath) {
    const zlib = require('zlib');
    const { promisify } = require('util');
    const gzip = promisify(zlib.gzip);

    try {
      const data = await fs.readFile(filePath);
      const compressed = await gzip(data);
      const compressedPath = `${filePath}.gz`;
      
      await fs.writeFile(compressedPath, compressed);
      await fs.unlink(filePath); // Remove original file
      
      console.log(`Compressed file due to low space: ${path.basename(filePath)}`);
    } catch (error) {
      console.error(`Failed to compress file ${filePath}:`, error);
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
   * Get disk space monitoring status
   */
  getStatus() {
    return {
      isMonitoring: this.isMonitoring,
      lowSpaceThreshold: this.lowSpaceThreshold,
      criticalSpaceThreshold: this.criticalSpaceThreshold,
      monitoringInterval: this.monitoringInterval,
      lastCheck: this.lastSpaceCheck,
      cachedSpace: this.spaceCheckCache
    };
  }

  /**
   * Update monitoring configuration
   */
  updateConfig(config) {
    if (config.lowSpaceThreshold) {
      this.lowSpaceThreshold = config.lowSpaceThreshold;
    }
    if (config.criticalSpaceThreshold) {
      this.criticalSpaceThreshold = config.criticalSpaceThreshold;
    }
    if (config.monitoringInterval) {
      this.monitoringInterval = config.monitoringInterval;
      
      // Restart monitoring with new interval
      if (this.isMonitoring) {
        this.stopMonitoring();
        this.startMonitoring();
      }
    }
  }

  /**
   * Force a disk space check and cleanup if needed
   */
  async forceCleanup() {
    console.log('Forcing disk space check and cleanup...');
    const spaceStatus = await this.checkDiskSpace();
    
    if (spaceStatus.isCritical) {
      await this.handleCriticalSpace();
    } else if (spaceStatus.isLow) {
      await this.handleLowSpace();
    }
    
    return spaceStatus;
  }
}

module.exports = DiskSpaceMonitor;