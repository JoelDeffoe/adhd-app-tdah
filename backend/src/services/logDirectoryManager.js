const fs = require('fs').promises;
const path = require('path');

class LogDirectoryManager {
  constructor(baseLogsDir = path.join(__dirname, '../../logs')) {
    this.baseLogsDir = baseLogsDir;
    this.directoryStructure = {
      application: 'application',
      errors: 'errors',
      performance: 'performance',
      audit: 'audit',
      exceptions: 'exceptions',
      archived: 'archived'
    };
  }

  /**
   * Initialize the complete log directory structure
   */
  async initialize() {
    try {
      console.log('Initializing log directory structure...');
      
      // Create base logs directory
      await this.ensureDirectory(this.baseLogsDir);
      
      // Create subdirectories for different log types
      for (const [type, dirName] of Object.entries(this.directoryStructure)) {
        const dirPath = path.join(this.baseLogsDir, dirName);
        await this.ensureDirectory(dirPath);
      }

      // Create date-based subdirectories for current month
      await this.createDateBasedDirectories();
      
      // Set appropriate permissions
      await this.setDirectoryPermissions();
      
      console.log('Log directory structure initialized successfully');
      return true;
    } catch (error) {
      console.error('Failed to initialize log directory structure:', error);
      return false;
    }
  }

  /**
   * Ensure a directory exists, create if it doesn't
   */
  async ensureDirectory(dirPath) {
    try {
      await fs.access(dirPath);
      console.log(`Directory exists: ${dirPath}`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        try {
          await fs.mkdir(dirPath, { recursive: true });
          console.log(`Created directory: ${dirPath}`);
        } catch (createError) {
          if (createError.code === 'EACCES') {
            console.error(`Permission denied creating directory: ${dirPath}`);
            await this.handlePermissionError(dirPath, 'create');
          } else {
            throw createError;
          }
        }
      } else if (error.code === 'EACCES') {
        console.error(`Permission denied accessing directory: ${dirPath}`);
        await this.handlePermissionError(dirPath, 'access');
      } else {
        throw error;
      }
    }
  }

  /**
   * Create date-based directory structure
   */
  async createDateBasedDirectories() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    // Create year/month structure for each log type
    for (const [type, dirName] of Object.entries(this.directoryStructure)) {
      if (type === 'archived') continue; // Skip archived directory
      
      const yearDir = path.join(this.baseLogsDir, dirName, String(year));
      const monthDir = path.join(yearDir, month);
      
      await this.ensureDirectory(yearDir);
      await this.ensureDirectory(monthDir);
    }

    console.log(`Created date-based directories for ${year}/${month}`);
  }

  /**
   * Get the appropriate directory path for a log type and date
   */
  getLogDirectory(logType, date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    
    // Map log types to directory names
    const typeMapping = {
      'application': 'application',
      'error': 'errors',
      'performance': 'performance',
      'audit': 'audit',
      'exception': 'exceptions',
      'rejection': 'exceptions'
    };

    const dirName = typeMapping[logType] || 'application';
    return path.join(this.baseLogsDir, dirName, String(year), month);
  }

  /**
   * Get the appropriate file path for a log
   */
  async getLogFilePath(logType, service = 'focusmate', date = new Date()) {
    const logDir = this.getLogDirectory(logType, date);
    
    // Ensure the directory exists
    await this.ensureDirectory(logDir);
    
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    const filename = `${service}-${logType}-${dateStr}.log`;
    
    return path.join(logDir, filename);
  }

  /**
   * Handle permission errors gracefully
   */
  async handlePermissionError(dirPath, operation) {
    console.warn(`Permission error during ${operation} for: ${dirPath}`);
    
    try {
      // Try to get current permissions
      const stats = await fs.stat(dirPath).catch(() => null);
      
      if (stats) {
        console.log(`Current permissions for ${dirPath}: ${stats.mode.toString(8)}`);
      }

      // Try alternative approaches
      if (process.platform !== 'win32') {
        // On Unix-like systems, try to fix permissions
        try {
          const { execSync } = require('child_process');
          execSync(`chmod 755 "${dirPath}"`, { stdio: 'ignore' });
          console.log(`Fixed permissions for: ${dirPath}`);
        } catch (chmodError) {
          console.warn(`Could not fix permissions for ${dirPath}:`, chmodError.message);
        }
      }

      // Create fallback directory in temp location
      const fallbackDir = path.join(require('os').tmpdir(), 'focusmate-logs');
      await this.ensureDirectory(fallbackDir);
      console.log(`Using fallback directory: ${fallbackDir}`);
      
      return fallbackDir;
    } catch (error) {
      console.error(`Error handling permission issue for ${dirPath}:`, error);
      throw error;
    }
  }

  /**
   * Set appropriate permissions for log directories
   */
  async setDirectoryPermissions() {
    if (process.platform === 'win32') {
      // Windows doesn't use Unix-style permissions
      console.log('Skipping permission setting on Windows');
      return;
    }

    try {
      // Set permissions for base directory and subdirectories
      const directories = [this.baseLogsDir];
      
      // Add all subdirectories
      for (const dirName of Object.values(this.directoryStructure)) {
        directories.push(path.join(this.baseLogsDir, dirName));
      }

      for (const dir of directories) {
        try {
          await fs.chmod(dir, 0o755); // rwxr-xr-x
          console.log(`Set permissions for: ${dir}`);
        } catch (error) {
          console.warn(`Could not set permissions for ${dir}:`, error.message);
        }
      }
    } catch (error) {
      console.error('Error setting directory permissions:', error);
    }
  }

  /**
   * Clean up empty directories
   */
  async cleanupEmptyDirectories() {
    try {
      const emptyDirs = await this.findEmptyDirectories(this.baseLogsDir);
      
      for (const dir of emptyDirs) {
        try {
          await fs.rmdir(dir);
          console.log(`Removed empty directory: ${dir}`);
        } catch (error) {
          console.warn(`Could not remove empty directory ${dir}:`, error.message);
        }
      }

      return emptyDirs.length;
    } catch (error) {
      console.error('Error cleaning up empty directories:', error);
      return 0;
    }
  }

  /**
   * Find empty directories recursively
   */
  async findEmptyDirectories(dirPath, emptyDirs = []) {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      if (entries.length === 0) {
        // Directory is empty
        emptyDirs.push(dirPath);
        return emptyDirs;
      }

      const subdirs = entries.filter(entry => entry.isDirectory());
      
      // Check subdirectories
      for (const subdir of subdirs) {
        const subdirPath = path.join(dirPath, subdir.name);
        await this.findEmptyDirectories(subdirPath, emptyDirs);
      }

      // Check if directory became empty after cleaning subdirectories
      const remainingEntries = await fs.readdir(dirPath);
      if (remainingEntries.length === 0 && dirPath !== this.baseLogsDir) {
        emptyDirs.push(dirPath);
      }

    } catch (error) {
      console.warn(`Error checking directory ${dirPath}:`, error.message);
    }

    return emptyDirs;
  }

  /**
   * Archive old log directories
   */
  async archiveOldDirectories(monthsOld = 3) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - monthsOld);
      
      const archivedCount = 0;
      
      for (const [type, dirName] of Object.entries(this.directoryStructure)) {
        if (type === 'archived') continue;
        
        const typeDir = path.join(this.baseLogsDir, dirName);
        
        try {
          const years = await fs.readdir(typeDir);
          
          for (const year of years) {
            const yearPath = path.join(typeDir, year);
            const yearStat = await fs.stat(yearPath);
            
            if (!yearStat.isDirectory()) continue;
            
            const months = await fs.readdir(yearPath);
            
            for (const month of months) {
              const monthPath = path.join(yearPath, month);
              const monthStat = await fs.stat(monthPath);
              
              if (!monthStat.isDirectory()) continue;
              
              // Check if this month directory is old enough to archive
              const monthDate = new Date(parseInt(year), parseInt(month) - 1);
              
              if (monthDate < cutoffDate) {
                await this.archiveDirectory(monthPath, type, year, month);
              }
            }
          }
        } catch (error) {
          console.warn(`Error processing directory ${typeDir}:`, error.message);
        }
      }

      return archivedCount;
    } catch (error) {
      console.error('Error archiving old directories:', error);
      return 0;
    }
  }

  /**
   * Archive a specific directory
   */
  async archiveDirectory(sourcePath, type, year, month) {
    try {
      const archiveDir = path.join(this.baseLogsDir, this.directoryStructure.archived);
      await this.ensureDirectory(archiveDir);
      
      const archiveName = `${type}-${year}-${month}`;
      const archivePath = path.join(archiveDir, archiveName);
      
      // Move the directory to archive location
      await fs.rename(sourcePath, archivePath);
      console.log(`Archived directory: ${sourcePath} -> ${archivePath}`);
      
      return true;
    } catch (error) {
      console.error(`Error archiving directory ${sourcePath}:`, error);
      return false;
    }
  }

  /**
   * Get directory structure information
   */
  async getDirectoryInfo() {
    const info = {
      baseDirectory: this.baseLogsDir,
      structure: {},
      totalSize: 0,
      fileCount: 0
    };

    try {
      for (const [type, dirName] of Object.entries(this.directoryStructure)) {
        const dirPath = path.join(this.baseLogsDir, dirName);
        
        try {
          const dirInfo = await this.getDirectoryStats(dirPath);
          info.structure[type] = {
            path: dirPath,
            exists: dirInfo.exists,
            size: dirInfo.size,
            fileCount: dirInfo.fileCount,
            subdirectories: dirInfo.subdirectories
          };
          
          info.totalSize += dirInfo.size;
          info.fileCount += dirInfo.fileCount;
        } catch (error) {
          info.structure[type] = {
            path: dirPath,
            exists: false,
            error: error.message
          };
        }
      }
    } catch (error) {
      console.error('Error getting directory info:', error);
    }

    return info;
  }

  /**
   * Get statistics for a specific directory
   */
  async getDirectoryStats(dirPath) {
    const stats = {
      exists: false,
      size: 0,
      fileCount: 0,
      subdirectories: []
    };

    try {
      await fs.access(dirPath);
      stats.exists = true;
      
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
          stats.subdirectories.push(entry.name);
          const subStats = await this.getDirectoryStats(entryPath);
          stats.size += subStats.size;
          stats.fileCount += subStats.fileCount;
        } else if (entry.isFile()) {
          const fileStat = await fs.stat(entryPath);
          stats.size += fileStat.size;
          stats.fileCount++;
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(`Error getting stats for ${dirPath}:`, error.message);
      }
    }

    return stats;
  }

  /**
   * Validate directory structure and fix issues
   */
  async validateAndFix() {
    console.log('Validating log directory structure...');
    
    const issues = [];
    const fixes = [];

    try {
      // Check base directory
      try {
        await fs.access(this.baseLogsDir);
      } catch (error) {
        issues.push(`Base directory missing: ${this.baseLogsDir}`);
        await this.ensureDirectory(this.baseLogsDir);
        fixes.push(`Created base directory: ${this.baseLogsDir}`);
      }

      // Check subdirectories
      for (const [type, dirName] of Object.entries(this.directoryStructure)) {
        const dirPath = path.join(this.baseLogsDir, dirName);
        
        try {
          await fs.access(dirPath);
        } catch (error) {
          issues.push(`Missing subdirectory: ${dirPath}`);
          await this.ensureDirectory(dirPath);
          fixes.push(`Created subdirectory: ${dirPath}`);
        }
      }

      // Clean up empty directories
      const emptyDirsRemoved = await this.cleanupEmptyDirectories();
      if (emptyDirsRemoved > 0) {
        fixes.push(`Removed ${emptyDirsRemoved} empty directories`);
      }

      console.log(`Validation complete. Issues found: ${issues.length}, Fixes applied: ${fixes.length}`);
      
      return {
        issues,
        fixes,
        isValid: issues.length === 0
      };
    } catch (error) {
      console.error('Error during directory validation:', error);
      return {
        issues: [...issues, `Validation error: ${error.message}`],
        fixes,
        isValid: false
      };
    }
  }
}

module.exports = LogDirectoryManager;