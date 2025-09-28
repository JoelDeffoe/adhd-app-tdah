const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * Error Resolution Tracker Service
 * Implements comprehensive error resolution status tracking, fix documentation,
 * effectiveness monitoring, and suggested fixes database
 */
class ErrorResolutionTracker {
  constructor(options = {}) {
    this.storageDir = options.storageDir || path.join(__dirname, '../../logs/resolution');
    this.resolutionsFile = path.join(this.storageDir, 'error-resolutions.json');
    this.suggestedFixesFile = path.join(this.storageDir, 'suggested-fixes.json');
    this.effectivenessFile = path.join(this.storageDir, 'fix-effectiveness.json');
    
    // Configuration
    this.config = {
      recurrenceWindow: options.recurrenceWindow || 7 * 24 * 60 * 60 * 1000, // 7 days
      effectivenessThreshold: options.effectivenessThreshold || 0.8, // 80% success rate
      maxResolutionHistory: options.maxResolutionHistory || 1000,
      ...options.config
    };

    // In-memory storage
    this.resolutions = new Map(); // errorSignature -> resolution data
    this.suggestedFixes = new Map(); // errorPattern -> suggested fixes
    this.effectivenessData = new Map(); // fixId -> effectiveness metrics
    
    this.initialize();
  }

  /**
   * Initialize the service
   */
  async initialize() {
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      await this.loadExistingData();
      
      // Set up periodic data persistence
      this.persistInterval = setInterval(() => {
        this.persistToDisk();
      }, 300000); // Persist every 5 minutes
      
    } catch (error) {
      console.error('Failed to initialize ErrorResolutionTracker:', error);
    }
  }

  /**
   * Load existing resolution data from disk
   */
  async loadExistingData() {
    try {
      // Load resolutions
      try {
        const resolutionData = await fs.readFile(this.resolutionsFile, 'utf8');
        const parsed = JSON.parse(resolutionData);
        
        for (const [key, value] of Object.entries(parsed)) {
          this.resolutions.set(key, {
            ...value,
            resolvedAt: new Date(value.resolvedAt),
            lastRecurrence: value.lastRecurrence ? new Date(value.lastRecurrence) : null,
            resolutionHistory: value.resolutionHistory?.map(entry => ({
              ...entry,
              timestamp: new Date(entry.timestamp)
            })) || []
          });
        }
      } catch (error) {
        console.log('No existing resolution data found, starting fresh');
      }

      // Load suggested fixes
      try {
        const suggestedData = await fs.readFile(this.suggestedFixesFile, 'utf8');
        const parsed = JSON.parse(suggestedData);
        
        for (const [key, value] of Object.entries(parsed)) {
          this.suggestedFixes.set(key, {
            ...value,
            createdAt: new Date(value.createdAt),
            lastUpdated: new Date(value.lastUpdated)
          });
        }
      } catch (error) {
        console.log('No existing suggested fixes data found, starting fresh');
      }

      // Load effectiveness data
      try {
        const effectivenessData = await fs.readFile(this.effectivenessFile, 'utf8');
        const parsed = JSON.parse(effectivenessData);
        
        for (const [key, value] of Object.entries(parsed)) {
          this.effectivenessData.set(key, {
            ...value,
            lastUpdated: new Date(value.lastUpdated),
            applications: value.applications?.map(app => ({
              ...app,
              appliedAt: new Date(app.appliedAt),
              lastChecked: new Date(app.lastChecked)
            })) || []
          });
        }
      } catch (error) {
        console.log('No existing effectiveness data found, starting fresh');
      }
      
    } catch (error) {
      console.error('Error loading existing resolution data:', error);
    }
  }

  /**
   * Mark an error as resolved with comprehensive tracking
   */
  async markErrorResolved(errorSignature, resolutionData) {
    try {
      const {
        resolutionNotes,
        fixDescription,
        fixType,
        developerId,
        estimatedEffort,
        rootCause,
        preventionMeasures,
        relatedIssues = [],
        tags = []
      } = resolutionData;

      const resolutionId = this.generateResolutionId(errorSignature);
      
      const resolution = {
        id: resolutionId,
        errorSignature,
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolutionNotes,
        fixDescription,
        fixType, // 'CODE_FIX', 'CONFIG_CHANGE', 'INFRASTRUCTURE', 'DOCUMENTATION', etc.
        developerId,
        estimatedEffort, // in hours
        rootCause,
        preventionMeasures,
        relatedIssues,
        tags,
        recurrenceCount: 0,
        lastRecurrence: null,
        effectivenessScore: null, // Will be calculated over time
        resolutionHistory: [{
          action: 'RESOLVED',
          timestamp: new Date(),
          developerId,
          notes: resolutionNotes
        }]
      };

      this.resolutions.set(errorSignature, resolution);

      // Update suggested fixes database
      await this.updateSuggestedFixes(errorSignature, resolution);

      // Initialize effectiveness tracking
      await this.initializeEffectivenessTracking(resolutionId, resolution);

      return resolution;

    } catch (error) {
      console.error('Error marking error as resolved:', error);
      throw error;
    }
  }

  /**
   * Track error recurrence after resolution
   */
  async trackErrorRecurrence(errorSignature, recurrenceData) {
    try {
      const resolution = this.resolutions.get(errorSignature);
      
      if (!resolution) {
        // Error not previously resolved, nothing to track
        return null;
      }

      const now = new Date();
      const timeSinceResolution = now.getTime() - resolution.resolvedAt.getTime();

      // Update recurrence data
      resolution.recurrenceCount++;
      resolution.lastRecurrence = now;
      resolution.status = 'RECURRED';

      // Add to resolution history
      resolution.resolutionHistory.push({
        action: 'RECURRED',
        timestamp: now,
        timeSinceResolution,
        context: recurrenceData.context,
        notes: `Error recurred after ${Math.round(timeSinceResolution / (1000 * 60 * 60))} hours`
      });

      // Update effectiveness tracking
      await this.updateEffectivenessTracking(resolution.id, {
        recurred: true,
        recurrenceTime: timeSinceResolution,
        context: recurrenceData.context
      });

      // Check if fix needs to be marked as ineffective
      if (resolution.recurrenceCount >= 3 || timeSinceResolution < 24 * 60 * 60 * 1000) {
        resolution.effectivenessScore = 0.1; // Mark as ineffective
        
        // Add to resolution history
        resolution.resolutionHistory.push({
          action: 'MARKED_INEFFECTIVE',
          timestamp: now,
          notes: `Fix marked as ineffective due to ${resolution.recurrenceCount} recurrences`
        });
      }

      return {
        errorSignature,
        recurrenceCount: resolution.recurrenceCount,
        timeSinceResolution,
        effectivenessScore: resolution.effectivenessScore
      };

    } catch (error) {
      console.error('Error tracking error recurrence:', error);
      throw error;
    }
  }

  /**
   * Re-resolve an error with updated fix
   */
  async reResolveError(errorSignature, newResolutionData) {
    try {
      const existingResolution = this.resolutions.get(errorSignature);
      
      if (!existingResolution) {
        throw new Error(`No existing resolution found for error signature: ${errorSignature}`);
      }

      const {
        resolutionNotes,
        fixDescription,
        fixType,
        developerId,
        estimatedEffort,
        rootCause,
        preventionMeasures,
        tags = []
      } = newResolutionData;

      // Update resolution data
      existingResolution.status = 'RESOLVED';
      existingResolution.resolutionNotes = resolutionNotes;
      existingResolution.fixDescription = fixDescription;
      existingResolution.fixType = fixType;
      existingResolution.developerId = developerId;
      existingResolution.estimatedEffort = estimatedEffort;
      existingResolution.rootCause = rootCause;
      existingResolution.preventionMeasures = preventionMeasures;
      existingResolution.tags = [...existingResolution.tags, ...tags];
      existingResolution.effectivenessScore = null; // Reset for new tracking

      // Add to resolution history
      existingResolution.resolutionHistory.push({
        action: 'RE_RESOLVED',
        timestamp: new Date(),
        developerId,
        notes: resolutionNotes,
        previousRecurrenceCount: existingResolution.recurrenceCount
      });

      // Reset recurrence tracking for new fix
      existingResolution.recurrenceCount = 0;
      existingResolution.lastRecurrence = null;

      // Update suggested fixes with new information
      await this.updateSuggestedFixes(errorSignature, existingResolution);

      return existingResolution;

    } catch (error) {
      console.error('Error re-resolving error:', error);
      throw error;
    }
  }

  /**
   * Update suggested fixes database
   */
  async updateSuggestedFixes(errorSignature, resolution) {
    try {
      const errorPattern = this.extractErrorPattern(errorSignature, resolution);
      
      let suggestedFix = this.suggestedFixes.get(errorPattern);
      
      if (!suggestedFix) {
        suggestedFix = {
          pattern: errorPattern,
          fixes: [],
          createdAt: new Date(),
          lastUpdated: new Date(),
          applicationCount: 0,
          successRate: 0
        };
        this.suggestedFixes.set(errorPattern, suggestedFix);
      }

      // Add or update fix suggestion
      const existingFixIndex = suggestedFix.fixes.findIndex(
        fix => fix.fixType === resolution.fixType && 
               this.isSimilarFix(fix.fixDescription, resolution.fixDescription)
      );

      const fixSuggestion = {
        id: this.generateFixId(errorPattern, resolution.fixType),
        fixType: resolution.fixType,
        fixDescription: resolution.fixDescription,
        rootCause: resolution.rootCause,
        preventionMeasures: resolution.preventionMeasures,
        estimatedEffort: resolution.estimatedEffort,
        tags: resolution.tags,
        applicationCount: 1,
        successCount: resolution.recurrenceCount === 0 ? 1 : 0,
        lastApplied: new Date(),
        developerId: resolution.developerId
      };

      if (existingFixIndex >= 0) {
        // Update existing fix
        const existingFix = suggestedFix.fixes[existingFixIndex];
        existingFix.applicationCount++;
        if (resolution.recurrenceCount === 0) {
          existingFix.successCount++;
        }
        existingFix.lastApplied = new Date();
        existingFix.successRate = existingFix.successCount / existingFix.applicationCount;
      } else {
        // Add new fix suggestion
        fixSuggestion.successRate = fixSuggestion.successCount / fixSuggestion.applicationCount;
        suggestedFix.fixes.push(fixSuggestion);
      }

      // Update overall statistics
      suggestedFix.applicationCount++;
      suggestedFix.lastUpdated = new Date();
      
      // Calculate overall success rate
      const totalSuccess = suggestedFix.fixes.reduce((sum, fix) => sum + fix.successCount, 0);
      const totalApplications = suggestedFix.fixes.reduce((sum, fix) => sum + fix.applicationCount, 0);
      suggestedFix.successRate = totalApplications > 0 ? totalSuccess / totalApplications : 0;

      // Sort fixes by success rate and application count
      suggestedFix.fixes.sort((a, b) => {
        if (b.successRate !== a.successRate) {
          return b.successRate - a.successRate;
        }
        return b.applicationCount - a.applicationCount;
      });

    } catch (error) {
      console.error('Error updating suggested fixes:', error);
    }
  }

  /**
   * Initialize effectiveness tracking for a resolution
   */
  async initializeEffectivenessTracking(resolutionId, resolution) {
    try {
      const effectiveness = {
        resolutionId,
        errorSignature: resolution.errorSignature,
        fixType: resolution.fixType,
        developerId: resolution.developerId,
        appliedAt: resolution.resolvedAt,
        lastUpdated: new Date(),
        
        // Effectiveness metrics
        recurrenceCount: 0,
        timeToFirstRecurrence: null,
        averageTimeBetweenRecurrences: null,
        effectivenessScore: null, // Will be calculated over time
        
        // Application tracking
        applications: [{
          appliedAt: resolution.resolvedAt,
          developerId: resolution.developerId,
          context: {
            estimatedEffort: resolution.estimatedEffort,
            tags: resolution.tags
          },
          lastChecked: new Date(),
          status: 'MONITORING'
        }]
      };

      this.effectivenessData.set(resolutionId, effectiveness);

    } catch (error) {
      console.error('Error initializing effectiveness tracking:', error);
    }
  }

  /**
   * Update effectiveness tracking when recurrence occurs
   */
  async updateEffectivenessTracking(resolutionId, recurrenceData) {
    try {
      const effectiveness = this.effectivenessData.get(resolutionId);
      
      if (!effectiveness) {
        return;
      }

      effectiveness.recurrenceCount++;
      effectiveness.lastUpdated = new Date();

      if (recurrenceData.recurred) {
        if (!effectiveness.timeToFirstRecurrence) {
          effectiveness.timeToFirstRecurrence = recurrenceData.recurrenceTime;
        }

        // Calculate average time between recurrences
        const recurrenceTimes = effectiveness.applications
          .filter(app => app.status === 'RECURRED')
          .map(app => app.recurrenceTime || 0);
        
        recurrenceTimes.push(recurrenceData.recurrenceTime);
        
        effectiveness.averageTimeBetweenRecurrences = 
          recurrenceTimes.reduce((sum, time) => sum + time, 0) / recurrenceTimes.length;

        // Update application status
        const latestApplication = effectiveness.applications[effectiveness.applications.length - 1];
        latestApplication.status = 'RECURRED';
        latestApplication.recurrenceTime = recurrenceData.recurrenceTime;
        latestApplication.lastChecked = new Date();
      }

      // Calculate effectiveness score
      effectiveness.effectivenessScore = this.calculateEffectivenessScore(effectiveness);

    } catch (error) {
      console.error('Error updating effectiveness tracking:', error);
    }
  }

  /**
   * Calculate effectiveness score for a resolution
   */
  calculateEffectivenessScore(effectiveness) {
    const {
      recurrenceCount,
      timeToFirstRecurrence,
      averageTimeBetweenRecurrences,
      applications
    } = effectiveness;

    // Base score starts at 1.0 (perfect)
    let score = 1.0;

    // Penalize for recurrences
    if (recurrenceCount > 0) {
      score -= (recurrenceCount * 0.2); // -20% per recurrence
    }

    // Bonus for longer time to first recurrence
    if (timeToFirstRecurrence) {
      const daysToRecurrence = timeToFirstRecurrence / (1000 * 60 * 60 * 24);
      if (daysToRecurrence > 30) {
        score += 0.1; // +10% bonus for lasting > 30 days
      } else if (daysToRecurrence < 1) {
        score -= 0.3; // -30% penalty for recurring within 1 day
      }
    }

    // Consider application context
    const latestApplication = applications[applications.length - 1];
    if (latestApplication?.context?.estimatedEffort) {
      const effort = latestApplication.context.estimatedEffort;
      if (effort > 8 && recurrenceCount > 0) {
        score -= 0.2; // Extra penalty for high-effort fixes that still recur
      }
    }

    // Ensure score is between 0 and 1
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Get suggested fixes for an error pattern
   */
  getSuggestedFixes(errorSignature, options = {}) {
    const {
      minSuccessRate = 0.5,
      maxResults = 10,
      includeIneffective = false
    } = options;

    const errorPattern = this.extractErrorPattern(errorSignature);
    const suggestedFix = this.suggestedFixes.get(errorPattern);

    if (!suggestedFix) {
      return [];
    }

    let fixes = suggestedFix.fixes.filter(fix => {
      if (!includeIneffective && fix.successRate < minSuccessRate) {
        return false;
      }
      return true;
    });

    return fixes.slice(0, maxResults).map(fix => ({
      ...fix,
      confidence: this.calculateFixConfidence(fix),
      estimatedEffectiveness: fix.successRate
    }));
  }

  /**
   * Get resolution status and history for an error
   */
  getResolutionStatus(errorSignature) {
    const resolution = this.resolutions.get(errorSignature);
    
    if (!resolution) {
      return {
        status: 'UNRESOLVED',
        hasResolution: false
      };
    }

    return {
      ...resolution,
      hasResolution: true,
      daysSinceResolution: Math.floor(
        (Date.now() - resolution.resolvedAt.getTime()) / (1000 * 60 * 60 * 24)
      ),
      isEffective: resolution.effectivenessScore > this.config.effectivenessThreshold
    };
  }

  /**
   * Get fix effectiveness metrics
   */
  getFixEffectiveness(options = {}) {
    const {
      fixType,
      developerId,
      timeRange,
      minApplications = 1
    } = options;

    let effectivenessEntries = Array.from(this.effectivenessData.values());

    // Apply filters
    if (fixType) {
      effectivenessEntries = effectivenessEntries.filter(e => e.fixType === fixType);
    }
    
    if (developerId) {
      effectivenessEntries = effectivenessEntries.filter(e => e.developerId === developerId);
    }
    
    if (timeRange) {
      const { start, end } = timeRange;
      effectivenessEntries = effectivenessEntries.filter(e => 
        e.appliedAt >= start && e.appliedAt <= end
      );
    }

    effectivenessEntries = effectivenessEntries.filter(e => 
      e.applications.length >= minApplications
    );

    // Calculate aggregate metrics
    const totalFixes = effectivenessEntries.length;
    const effectiveFixes = effectivenessEntries.filter(e => 
      e.effectivenessScore > this.config.effectivenessThreshold
    ).length;

    const averageEffectiveness = totalFixes > 0 
      ? effectivenessEntries.reduce((sum, e) => sum + (e.effectivenessScore || 0), 0) / totalFixes
      : 0;

    const fixTypeBreakdown = {};
    effectivenessEntries.forEach(e => {
      if (!fixTypeBreakdown[e.fixType]) {
        fixTypeBreakdown[e.fixType] = {
          count: 0,
          effectiveCount: 0,
          averageEffectiveness: 0
        };
      }
      
      fixTypeBreakdown[e.fixType].count++;
      if (e.effectivenessScore > this.config.effectivenessThreshold) {
        fixTypeBreakdown[e.fixType].effectiveCount++;
      }
    });

    // Calculate averages for each fix type
    Object.keys(fixTypeBreakdown).forEach(fixType => {
      const typeEntries = effectivenessEntries.filter(e => e.fixType === fixType);
      fixTypeBreakdown[fixType].averageEffectiveness = 
        typeEntries.reduce((sum, e) => sum + (e.effectivenessScore || 0), 0) / typeEntries.length;
    });

    return {
      totalFixes,
      effectiveFixes,
      effectivenessRate: totalFixes > 0 ? effectiveFixes / totalFixes : 0,
      averageEffectiveness,
      fixTypeBreakdown,
      topPerformingFixes: effectivenessEntries
        .sort((a, b) => (b.effectivenessScore || 0) - (a.effectivenessScore || 0))
        .slice(0, 10)
        .map(e => ({
          resolutionId: e.resolutionId,
          errorSignature: e.errorSignature,
          fixType: e.fixType,
          effectivenessScore: e.effectivenessScore,
          recurrenceCount: e.recurrenceCount,
          daysSinceApplied: Math.floor(
            (Date.now() - e.appliedAt.getTime()) / (1000 * 60 * 60 * 24)
          )
        }))
    };
  }

  /**
   * Helper methods
   */
  generateResolutionId(errorSignature) {
    return crypto
      .createHash('sha256')
      .update(`${errorSignature}-${Date.now()}`)
      .digest('hex')
      .substring(0, 12);
  }

  generateFixId(errorPattern, fixType) {
    return crypto
      .createHash('sha256')
      .update(`${errorPattern}-${fixType}`)
      .digest('hex')
      .substring(0, 8);
  }

  extractErrorPattern(errorSignature, resolution = null) {
    // For now, use the error signature as the pattern
    // In a more sophisticated implementation, this could analyze
    // error characteristics to group similar error types
    return errorSignature.substring(0, 8);
  }

  isSimilarFix(fix1, fix2) {
    // Simple similarity check - in production, could use more sophisticated NLP
    const words1 = fix1.toLowerCase().split(/\s+/);
    const words2 = fix2.toLowerCase().split(/\s+/);
    
    const commonWords = words1.filter(word => words2.includes(word));
    const similarity = commonWords.length / Math.max(words1.length, words2.length);
    
    return similarity > 0.6; // 60% similarity threshold
  }

  calculateFixConfidence(fix) {
    // Calculate confidence based on success rate and application count
    const baseConfidence = fix.successRate;
    const applicationBonus = Math.min(0.2, fix.applicationCount * 0.02); // Max 20% bonus
    
    return Math.min(1.0, baseConfidence + applicationBonus);
  }

  /**
   * Persist data to disk
   */
  async persistToDisk() {
    try {
      // Convert Maps to objects for JSON serialization
      const resolutionData = {};
      for (const [key, value] of this.resolutions.entries()) {
        resolutionData[key] = value;
      }

      const suggestedFixesData = {};
      for (const [key, value] of this.suggestedFixes.entries()) {
        suggestedFixesData[key] = value;
      }

      const effectivenessData = {};
      for (const [key, value] of this.effectivenessData.entries()) {
        effectivenessData[key] = value;
      }

      // Write to disk
      await fs.writeFile(this.resolutionsFile, JSON.stringify(resolutionData, null, 2));
      await fs.writeFile(this.suggestedFixesFile, JSON.stringify(suggestedFixesData, null, 2));
      await fs.writeFile(this.effectivenessFile, JSON.stringify(effectivenessData, null, 2));
      
    } catch (error) {
      console.error('Error persisting resolution data to disk:', error);
    }
  }

  /**
   * Cleanup old data
   */
  async cleanup(retentionDays = 90) {
    const cutoffDate = new Date(Date.now() - (retentionDays * 24 * 60 * 60 * 1000));
    
    // Remove old resolved errors that haven't recurred
    for (const [signature, resolution] of this.resolutions.entries()) {
      if (resolution.status === 'RESOLVED' && 
          resolution.resolvedAt < cutoffDate && 
          resolution.recurrenceCount === 0) {
        this.resolutions.delete(signature);
      }
    }

    // Remove old effectiveness data
    for (const [resolutionId, effectiveness] of this.effectivenessData.entries()) {
      if (effectiveness.appliedAt < cutoffDate && effectiveness.recurrenceCount === 0) {
        this.effectivenessData.delete(resolutionId);
      }
    }

    await this.persistToDisk();
  }

  /**
   * Shutdown the service
   */
  async shutdown() {
    if (this.persistInterval) {
      clearInterval(this.persistInterval);
    }
    await this.persistToDisk();
  }
}

module.exports = ErrorResolutionTracker;