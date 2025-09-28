const fs = require('fs').promises;
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);

class LogManager {
  constructor(logsDir = path.join(__dirname, '../../logs')) {
    this.logsDir = logsDir;
    this.maxFileSize = 10 * 1024 * 1024; // 10MB
    this.retentionDays = 7;
    this.compressionEnabled = true;
    this.cleanupInterval = 24 * 60 * 60 * 1000; // 24 hours
    
    // Start periodic cleanup
    this.startPeriodicCleanup();
  }

  /**
   * Initialize log directory and start cleanup processes
   */
  async initialize() {
    try {
      await this.ensureLogDirectory();
      await this.cleanupCorruptedFiles();
      await this.rotateOversizedFiles();
      await this.cleanupOldFiles();
      console.log('Log manager initialized successfully');
    } catch (error) {
      console.error('Failed to initialize log manager:', error);
    }
  }

  /**
   * Ensure log directory exists
   */
  async ensureLogDirectory() {
    try {
      await fs.access(this.logsDir);
    } catch (error) {
      if (error.code === 'ENOENT') {
        await fs.mkdir(this.logsDir, { recursive: true });
        console.log(`Created log directory: ${this.logsDir}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Get all log files in the directory
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
   * Rotate files that exceed maximum size
   */
  async rotateOversizedFiles() {
    const logFiles = await this.getLogFiles();
    const oversizedFiles = logFiles.filter(file => 
      file.size > this.maxFileSize && !file.isCompressed
    );

    for (const file of oversizedFiles) {
      try {
        await this.rotateFile(file);
        console.log(`Rotated oversized file: ${file.name}`);
      } catch (error) {
        console.error(`Failed to rotate file ${file.name}:`, error);
      }
    }
  }

  /**
   * Rotate a single file
   */
  async rotateFile(file) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rotatedName = `${path.parse(file.name).name}-${timestamp}.log`;
    const rotatedPath = path.join(this.logsDir, rotatedName);
    
    // Move current file to rotated name
    await fs.rename(file.path, rotatedPath);
    
    // Compress the rotated file if compression is enabled
    if (this.compressionEnabled) {
      await this.compressFile(rotatedPath);
    }
  }

  /**
   * Compress a log file
   */
  async compressFile(filePath) {
    try {
      const data = await fs.readFile(filePath);
      const compressed = await gzip(data);
      const compressedPath = `${filePath}.gz`;
      
      await fs.writeFile(compressedPath, compressed);
      await fs.unlink(filePath); // Remove original file
      
      console.log(`Compressed file: ${path.basename(filePath)}`);
    } catch (error) {
      console.error(`Failed to compress file ${filePath}:`, error);
    }
  }

  /**
   * Clean up files older than retention period
   */
  async cleanupOldFiles() {
    const logFiles = await this.getLogFiles();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);

    const oldFiles = logFiles.filter(file => file.created < cutoffDate);

    for (const file of oldFiles) {
      try {
        await fs.unlink(file.path);
        console.log(`Deleted old log file: ${file.name}`);
      } catch (error) {
        console.error(`Failed to delete old file ${file.name}:`, error);
      }
    }

    if (oldFiles.length > 0) {
      console.log(`Cleaned up ${oldFiles.length} old log files`);
    }
  }

  /**
   * Clean up corrupted or invalid log files
   */
  async cleanupCorruptedFiles() {
    const logFiles = await this.getLogFiles();
    const corruptedFiles = [];

    for (const file of logFiles) {
      try {
        // Check if file is readable and has valid content
        if (file.size === 0) {
          corruptedFiles.push(file);
          continue;
        }

        // For compressed files, try to read a small portion
        if (file.isCompressed) {
          const data = await fs.readFile(file.path);
          if (data.length < 10) { // Too small to be valid gzip
            corruptedFiles.push(file);
          }
        } else {
          // For regular log files, check if they contain valid JSON lines
          const data = await fs.readFile(file.path, 'utf8');
          const lines = data.split('\n').filter(line => line.trim());
          
          if (lines.length > 0) {
            // Try to parse first line as JSON
            try {
              JSON.parse(lines[0]);
            } catch (parseError) {
              // If it's not JSON, check if it's a valid log format
              if (!this.isValidLogLine(lines[0])) {
                corruptedFiles.push(file);
              }
            }
          }
        }
      } catch (error) {
        console.warn(`Could not validate file ${file.name}:`, error.message);
        corruptedFiles.push(file);
      }
    }

    // Remove corrupted files
    for (const file of corruptedFiles) {
      try {
        await fs.unlink(file.path);
        console.log(`Removed corrupted log file: ${file.name}`);
      } catch (error) {
        console.error(`Failed to remove corrupted file ${file.name}:`, error);
      }
    }

    if (corruptedFiles.length > 0) {
      console.log(`Cleaned up ${corruptedFiles.length} corrupted log files`);
    }
  }

  /**
   * Check if a log line is valid (basic validation)
   */
  isValidLogLine(line) {
    // Check for common log patterns
    const patterns = [
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/, // Timestamp pattern
      /\[(debug|info|warn|error)\]/, // Log level pattern
    ];
    
    return patterns.some(pattern => pattern.test(line));
  }

  /**
   * Get log management statistics
   */
  async getStats() {
    const logFiles = await this.getLogFiles();
    
    const stats = {
      totalFiles: logFiles.length,
      totalSize: logFiles.reduce((sum, file) => sum + file.size, 0),
      compressedFiles: logFiles.filter(f => f.isCompressed).length,
      uncompressedFiles: logFiles.filter(f => !f.isCompressed).length,
      oldestFile: logFiles.length > 0 ? Math.min(...logFiles.map(f => f.created.getTime())) : null,
      newestFile: logFiles.length > 0 ? Math.max(...logFiles.map(f => f.created.getTime())) : null,
      oversizedFiles: logFiles.filter(f => f.size > this.maxFileSize).length
    };

    return stats;
  }

  /**
   * Start periodic cleanup process
   */
  startPeriodicCleanup() {
    setInterval(async () => {
      try {
        console.log('Starting periodic log cleanup...');
        await this.rotateOversizedFiles();
        await this.cleanupOldFiles();
        await this.cleanupCorruptedFiles();
        console.log('Periodic log cleanup completed');
      } catch (error) {
        console.error('Error during periodic cleanup:', error);
      }
    }, this.cleanupInterval);
  }

  /**
   * Manual cleanup trigger
   */
  async performCleanup() {
    console.log('Starting manual log cleanup...');
    await this.rotateOversizedFiles();
    await this.cleanupOldFiles();
    await this.cleanupCorruptedFiles();
    console.log('Manual log cleanup completed');
  }

  /**
   * Update configuration
   */
  updateConfig(config) {
    if (config.maxFileSize) this.maxFileSize = config.maxFileSize;
    if (config.retentionDays) this.retentionDays = config.retentionDays;
    if (config.compressionEnabled !== undefined) this.compressionEnabled = config.compressionEnabled;
    if (config.cleanupInterval) {
      this.cleanupInterval = config.cleanupInterval;
      // Restart periodic cleanup with new interval
      this.startPeriodicCleanup();
    }
  }
}

module.exports = LogManager;