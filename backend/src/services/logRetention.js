const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * Log Retention and Deletion Service
 * Handles data retention policies and user log deletion requests
 */
class LogRetentionService {
  constructor(config = {}) {
    this.config = {
      retentionDays: config.retentionDays || 30,
      maxLogSize: config.maxLogSize || 100 * 1024 * 1024, // 100MB
      enableAutoPurge: config.enableAutoPurge !== false,
      purgeInterval: config.purgeInterval || 24 * 60 * 60 * 1000, // 24 hours
      logsDirectory: config.logsDirectory || path.join(__dirname, '../../logs'),
      backupDirectory: config.backupDirectory || path.join(__dirname, '../../logs/backup'),
      ...config
    };

    this.deletionRequests = new Map();
    this.retentionPolicies = new Map();
    this.purgeTimer = null;

    // Default retention policies
    this.setRetentionPolicy('error', 90); // Keep error logs for 90 days
    this.setRetentionPolicy('warn', 60);  // Keep warning logs for 60 days
    this.setRetentionPolicy('info', 30);  // Keep info logs for 30 days
    this.setRetentionPolicy('debug', 7);  // Keep debug logs for 7 days

    if (this.config.enableAutoPurge) {
      this.startAutoPurge();
    }
  }

  /**
   * Set retention policy for a specific log level
   */
  setRetentionPolicy(level, days) {
    this.retentionPolicies.set(level, days);
    console.log(`Set retention policy: ${level} logs will be kept for ${days} days`);
  }

  /**
   * Get retention policy for a log level
   */
  getRetentionPolicy(level) {
    return this.retentionPolicies.get(level) || this.config.retentionDays;
  }

  /**
   * Request deletion of user logs
   */
  async requestUserLogDeletion(userId, reason = 'user_request') {
    const requestId = crypto.randomUUID();
    const request = {
      id: requestId,
      userId,
      reason,
      requestedAt: new Date(),
      status: 'pending',
      processedAt: null,
      deletedFiles: [],
      errors: []
    };

    this.deletionRequests.set(requestId, request);

    try {
      await this.processUserLogDeletion(requestId);
      return { success: true, requestId, deletedFiles: request.deletedFiles };
    } catch (error) {
      request.status = 'failed';
      request.errors.push(error.message);
      console.error('User log deletion failed:', error);
      return { success: false, requestId, error: error.message };
    }
  }

  /**
   * Process user log deletion request
   */
  async processUserLogDeletion(requestId) {
    const request = this.deletionRequests.get(requestId);
    if (!request) {
      throw new Error('Deletion request not found');
    }

    request.status = 'processing';
    const { userId } = request;

    try {
      // Find all log files
      const logFiles = await this.findLogFiles();
      
      for (const filePath of logFiles) {
        try {
          const deletedCount = await this.deleteUserLogsFromFile(filePath, userId);
          if (deletedCount > 0) {
            request.deletedFiles.push({
              file: path.basename(filePath),
              deletedEntries: deletedCount
            });
          }
        } catch (error) {
          request.errors.push(`Failed to process ${filePath}: ${error.message}`);
        }
      }

      request.status = 'completed';
      request.processedAt = new Date();
      
      console.log(`User log deletion completed for user ${userId}:`, {
        requestId,
        deletedFiles: request.deletedFiles.length,
        errors: request.errors.length
      });

    } catch (error) {
      request.status = 'failed';
      request.errors.push(error.message);
      throw error;
    }
  }

  /**
   * Delete user logs from a specific file
   */
  async deleteUserLogsFromFile(filePath, userId) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split('\n');
      const filteredLines = [];
      let deletedCount = 0;

      for (const line of lines) {
        if (!line.trim()) {
          filteredLines.push(line);
          continue;
        }

        try {
          const logEntry = JSON.parse(line);
          
          // Check if this log entry belongs to the user
          if (this.isUserLog(logEntry, userId)) {
            deletedCount++;
            // Skip this line (delete it)
            continue;
          }
          
          filteredLines.push(line);
        } catch (parseError) {
          // If we can't parse the line, keep it
          filteredLines.push(line);
        }
      }

      if (deletedCount > 0) {
        // Write the filtered content back to the file
        await fs.writeFile(filePath, filteredLines.join('\n'));
        console.log(`Deleted ${deletedCount} log entries for user ${userId} from ${path.basename(filePath)}`);
      }

      return deletedCount;
    } catch (error) {
      console.error(`Failed to process file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Check if a log entry belongs to a specific user
   */
  isUserLog(logEntry, userId) {
    // Check various possible user ID fields
    const userFields = ['userId', 'user_id', 'uid', 'user'];
    
    for (const field of userFields) {
      if (logEntry[field] === userId) {
        return true;
      }
      
      // Check nested objects
      if (logEntry.context && logEntry.context[field] === userId) {
        return true;
      }
      
      if (logEntry.metadata && logEntry.metadata[field] === userId) {
        return true;
      }
    }

    // Check if user ID appears in the message or other string fields
    const logString = JSON.stringify(logEntry).toLowerCase();
    const userIdLower = userId.toString().toLowerCase();
    
    return logString.includes(userIdLower);
  }

  /**
   * Purge old logs based on retention policies
   */
  async purgeOldLogs() {
    console.log('Starting log purge process...');
    
    try {
      const logFiles = await this.findLogFiles();
      let totalPurged = 0;
      let totalFiles = 0;

      for (const filePath of logFiles) {
        try {
          const purged = await this.purgeOldLogsFromFile(filePath);
          totalPurged += purged;
          totalFiles++;
        } catch (error) {
          console.error(`Failed to purge logs from ${filePath}:`, error);
        }
      }

      // Also purge entire old files
      const purgedFiles = await this.purgeOldLogFiles();

      console.log(`Log purge completed: ${totalPurged} entries from ${totalFiles} files, ${purgedFiles} old files deleted`);
      
      return {
        success: true,
        purgedEntries: totalPurged,
        processedFiles: totalFiles,
        deletedFiles: purgedFiles
      };
    } catch (error) {
      console.error('Log purge failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Purge old logs from a specific file
   */
  async purgeOldLogsFromFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split('\n');
      const filteredLines = [];
      let purgedCount = 0;

      for (const line of lines) {
        if (!line.trim()) {
          filteredLines.push(line);
          continue;
        }

        try {
          const logEntry = JSON.parse(line);
          
          if (this.shouldPurgeLog(logEntry)) {
            purgedCount++;
            continue; // Skip this line (purge it)
          }
          
          filteredLines.push(line);
        } catch (parseError) {
          // If we can't parse the line, keep it
          filteredLines.push(line);
        }
      }

      if (purgedCount > 0) {
        await fs.writeFile(filePath, filteredLines.join('\n'));
      }

      return purgedCount;
    } catch (error) {
      console.error(`Failed to purge logs from ${filePath}:`, error);
      return 0;
    }
  }

  /**
   * Check if a log entry should be purged based on retention policies
   */
  shouldPurgeLog(logEntry) {
    try {
      const logDate = new Date(logEntry.timestamp);
      const now = new Date();
      const ageInDays = (now - logDate) / (1000 * 60 * 60 * 24);
      
      const retentionDays = this.getRetentionPolicy(logEntry.level);
      
      return ageInDays > retentionDays;
    } catch (error) {
      // If we can't determine the age, don't purge
      return false;
    }
  }

  /**
   * Purge entire old log files
   */
  async purgeOldLogFiles() {
    try {
      const files = await fs.readdir(this.config.logsDirectory);
      let deletedCount = 0;

      for (const file of files) {
        const filePath = path.join(this.config.logsDirectory, file);
        
        try {
          const stats = await fs.stat(filePath);
          
          if (stats.isFile() && file.endsWith('.log')) {
            const ageInDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
            
            // Delete files older than the maximum retention period
            const maxRetention = Math.max(...this.retentionPolicies.values());
            
            if (ageInDays > maxRetention) {
              // Backup before deletion if backup directory exists
              await this.backupLogFile(filePath);
              await fs.unlink(filePath);
              deletedCount++;
              console.log(`Deleted old log file: ${file} (${Math.round(ageInDays)} days old)`);
            }
          }
        } catch (error) {
          console.error(`Failed to process file ${file}:`, error);
        }
      }

      return deletedCount;
    } catch (error) {
      console.error('Failed to purge old log files:', error);
      return 0;
    }
  }

  /**
   * Backup log file before deletion
   */
  async backupLogFile(filePath) {
    try {
      // Ensure backup directory exists
      await fs.mkdir(this.config.backupDirectory, { recursive: true });
      
      const fileName = path.basename(filePath);
      const backupPath = path.join(this.config.backupDirectory, `${fileName}.backup`);
      
      await fs.copyFile(filePath, backupPath);
      console.log(`Backed up ${fileName} to backup directory`);
    } catch (error) {
      console.warn(`Failed to backup ${filePath}:`, error.message);
      // Don't throw - backup failure shouldn't prevent deletion
    }
  }

  /**
   * Find all log files in the logs directory
   */
  async findLogFiles() {
    try {
      const files = await fs.readdir(this.config.logsDirectory);
      const logFiles = [];

      for (const file of files) {
        if (file.endsWith('.log')) {
          logFiles.push(path.join(this.config.logsDirectory, file));
        }
      }

      return logFiles;
    } catch (error) {
      console.error('Failed to find log files:', error);
      return [];
    }
  }

  /**
   * Get deletion request status
   */
  getDeletionRequestStatus(requestId) {
    return this.deletionRequests.get(requestId);
  }

  /**
   * Get all deletion requests for a user
   */
  getUserDeletionRequests(userId) {
    const requests = [];
    for (const [id, request] of this.deletionRequests) {
      if (request.userId === userId) {
        requests.push({ id, ...request });
      }
    }
    return requests;
  }

  /**
   * Start automatic purge process
   */
  startAutoPurge() {
    if (this.purgeTimer) {
      clearInterval(this.purgeTimer);
    }

    this.purgeTimer = setInterval(async () => {
      try {
        await this.purgeOldLogs();
      } catch (error) {
        console.error('Auto-purge failed:', error);
      }
    }, this.config.purgeInterval);

    console.log(`Auto-purge started with interval: ${this.config.purgeInterval / 1000 / 60} minutes`);
  }

  /**
   * Stop automatic purge process
   */
  stopAutoPurge() {
    if (this.purgeTimer) {
      clearInterval(this.purgeTimer);
      this.purgeTimer = null;
      console.log('Auto-purge stopped');
    }
  }

  /**
   * Get retention statistics
   */
  async getRetentionStats() {
    try {
      const logFiles = await this.findLogFiles();
      let totalSize = 0;
      let totalEntries = 0;
      let oldestEntry = null;
      let newestEntry = null;

      for (const filePath of logFiles) {
        try {
          const stats = await fs.stat(filePath);
          totalSize += stats.size;

          // Sample the file to get entry count and date range
          const content = await fs.readFile(filePath, 'utf8');
          const lines = content.split('\n').filter(line => line.trim());
          totalEntries += lines.length;

          // Check first and last entries for date range
          if (lines.length > 0) {
            try {
              const firstEntry = JSON.parse(lines[0]);
              const lastEntry = JSON.parse(lines[lines.length - 1]);
              
              const firstDate = new Date(firstEntry.timestamp);
              const lastDate = new Date(lastEntry.timestamp);
              
              if (!oldestEntry || firstDate < oldestEntry) {
                oldestEntry = firstDate;
              }
              if (!newestEntry || lastDate > newestEntry) {
                newestEntry = lastDate;
              }
            } catch (parseError) {
              // Ignore parse errors for stats
            }
          }
        } catch (error) {
          console.warn(`Failed to get stats for ${filePath}:`, error.message);
        }
      }

      return {
        totalFiles: logFiles.length,
        totalSize,
        totalEntries,
        oldestEntry,
        newestEntry,
        retentionPolicies: Object.fromEntries(this.retentionPolicies),
        deletionRequests: this.deletionRequests.size,
        autoPurgeEnabled: this.config.enableAutoPurge
      };
    } catch (error) {
      console.error('Failed to get retention stats:', error);
      return {
        error: error.message
      };
    }
  }

  /**
   * Update retention configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    
    if (newConfig.enableAutoPurge !== undefined) {
      if (newConfig.enableAutoPurge) {
        this.startAutoPurge();
      } else {
        this.stopAutoPurge();
      }
    }

    if (newConfig.purgeInterval) {
      this.startAutoPurge(); // Restart with new interval
    }
  }

  /**
   * Cleanup resources
   */
  shutdown() {
    this.stopAutoPurge();
    console.log('Log retention service shutdown');
  }
}

module.exports = LogRetentionService;