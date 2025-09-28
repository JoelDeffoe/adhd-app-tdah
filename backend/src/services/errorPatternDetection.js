const fs = require('fs').promises;
const path = require('path');

/**
 * Error Pattern Detection Service
 * Implements pattern detection algorithms, trend analysis, and threshold-based alerting
 */
class ErrorPatternDetection {
  constructor(errorAggregationService, options = {}) {
    this.aggregationService = errorAggregationService;
    this.storageDir = options.storageDir || path.join(__dirname, '../../logs/patterns');
    this.patternsFile = path.join(this.storageDir, 'error-patterns.json');
    this.trendsFile = path.join(this.storageDir, 'error-trends.json');
    this.alertsFile = path.join(this.storageDir, 'pattern-alerts.json');
    
    // Configuration
    this.config = {
      // Pattern detection thresholds
      minOccurrencesForPattern: options.minOccurrencesForPattern || 5,
      patternDetectionWindow: options.patternDetectionWindow || 86400000, // 24 hours
      trendAnalysisWindow: options.trendAnalysisWindow || 604800000, // 7 days
      
      // Alert thresholds
      errorRateThreshold: options.errorRateThreshold || 10, // errors per minute
      errorGrowthThreshold: options.errorGrowthThreshold || 2.0, // 200% increase
      newPatternAlertThreshold: options.newPatternAlertThreshold || 3, // 3 occurrences
      
      // Analysis intervals
      patternAnalysisInterval: options.patternAnalysisInterval || 300000, // 5 minutes
      trendAnalysisInterval: options.trendAnalysisInterval || 3600000, // 1 hour
      
      ...options.config
    };

    // In-memory caches
    this.detectedPatterns = new Map();
    this.errorTrends = new Map();
    this.activeAlerts = new Map();
    this.analysisHistory = [];
    
    this.initialize();
  }

  /**
   * Initialize the pattern detection service
   */
  async initialize() {
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      await this.loadExistingData();
      
      // Start periodic analysis
      this.startPeriodicAnalysis();
      
    } catch (error) {
      console.error('Failed to initialize ErrorPatternDetection:', error);
    }
  }

  /**
   * Load existing pattern data from disk
   */
  async loadExistingData() {
    try {
      // Load detected patterns
      try {
        const patternsData = await fs.readFile(this.patternsFile, 'utf8');
        const parsed = JSON.parse(patternsData);
        
        for (const [key, value] of Object.entries(parsed)) {
          this.detectedPatterns.set(key, {
            ...value,
            firstDetected: new Date(value.firstDetected),
            lastSeen: new Date(value.lastSeen),
            occurrences: value.occurrences.map(occ => ({
              ...occ,
              timestamp: new Date(occ.timestamp)
            }))
          });
        }
      } catch (error) {
        console.log('No existing patterns data found, starting fresh');
      }

      // Load error trends
      try {
        const trendsData = await fs.readFile(this.trendsFile, 'utf8');
        const parsed = JSON.parse(trendsData);
        
        for (const [key, value] of Object.entries(parsed)) {
          this.errorTrends.set(key, {
            ...value,
            dataPoints: value.dataPoints.map(dp => ({
              ...dp,
              timestamp: new Date(dp.timestamp)
            }))
          });
        }
      } catch (error) {
        console.log('No existing trends data found, starting fresh');
      }

      // Load active alerts
      try {
        const alertsData = await fs.readFile(this.alertsFile, 'utf8');
        const parsed = JSON.parse(alertsData);
        
        for (const [key, value] of Object.entries(parsed)) {
          this.activeAlerts.set(key, {
            ...value,
            createdAt: new Date(value.createdAt),
            lastTriggered: new Date(value.lastTriggered)
          });
        }
      } catch (error) {
        console.log('No existing alerts data found, starting fresh');
      }
      
    } catch (error) {
      console.error('Error loading existing pattern data:', error);
    }
  }

  /**
   * Start periodic pattern analysis
   */
  startPeriodicAnalysis() {
    // Skip starting timers in test environment
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    // Pattern detection analysis
    this.patternAnalysisTimer = setInterval(() => {
      this.analyzePatterns();
    }, this.config.patternAnalysisInterval);

    // Trend analysis
    this.trendAnalysisTimer = setInterval(() => {
      this.analyzeTrends();
    }, this.config.trendAnalysisInterval);

    // Initial analysis
    setTimeout(() => {
      this.analyzePatterns();
      this.analyzeTrends();
    }, 5000); // Wait 5 seconds for aggregation service to initialize
  }

  /**
   * Analyze error patterns from aggregated data
   */
  async analyzePatterns() {
    try {
      const now = new Date();
      const windowStart = new Date(now.getTime() - this.config.patternDetectionWindow);
      
      // Get recent error groups
      const errorGroups = this.aggregationService.getErrorGroups({
        timeRange: { start: windowStart, end: now },
        limit: 1000
      });

      // Detect recurring patterns
      await this.detectRecurringPatterns(errorGroups.groups);
      
      // Detect temporal patterns
      await this.detectTemporalPatterns(errorGroups.groups);
      
      // Detect correlation patterns
      await this.detectCorrelationPatterns(errorGroups.groups);
      
      // Check for new patterns that need alerts
      await this.checkNewPatternAlerts();
      
      // Save analysis results
      await this.savePatternData();
      
    } catch (error) {
      console.error('Error in pattern analysis:', error);
    }
  }

  /**
   * Detect recurring error patterns
   */
  async detectRecurringPatterns(errorGroups) {
    const recurringPatterns = new Map();
    
    for (const group of errorGroups) {
      if (group.count < this.config.minOccurrencesForPattern) continue;
      
      // Analyze error message patterns
      const messagePattern = this.extractMessagePattern(group.errorMessage);
      const stackPattern = this.extractStackPattern(group.stackTrace);
      
      // Create pattern signature
      const patternSignature = this.generatePatternSignature({
        category: group.category,
        messagePattern,
        stackPattern,
        service: group.tags?.find(tag => tag.startsWith('service:'))?.split(':')[1]
      });
      
      if (!recurringPatterns.has(patternSignature)) {
        recurringPatterns.set(patternSignature, {
          signature: patternSignature,
          type: 'RECURRING',
          category: group.category,
          messagePattern,
          stackPattern,
          errorGroups: [],
          totalOccurrences: 0,
          affectedUsers: new Set(),
          firstDetected: group.firstOccurrence,
          lastSeen: group.lastOccurrence,
          confidence: 0
        });
      }
      
      const pattern = recurringPatterns.get(patternSignature);
      pattern.errorGroups.push(group.signature);
      pattern.totalOccurrences += group.count;
      pattern.lastSeen = new Date(Math.max(pattern.lastSeen, group.lastOccurrence));
      
      // Add affected users
      if (group.affectedUsers) {
        group.affectedUsers.forEach(user => pattern.affectedUsers.add(user));
      }
    }
    
    // Calculate confidence scores and update detected patterns
    for (const [signature, pattern] of recurringPatterns) {
      pattern.confidence = this.calculatePatternConfidence(pattern);
      pattern.affectedUsersCount = pattern.affectedUsers.size;
      pattern.affectedUsers = Array.from(pattern.affectedUsers); // Convert for storage
      
      // Update or add to detected patterns
      const existing = this.detectedPatterns.get(signature);
      if (existing) {
        existing.totalOccurrences = pattern.totalOccurrences;
        existing.lastSeen = pattern.lastSeen;
        existing.confidence = pattern.confidence;
        existing.affectedUsersCount = pattern.affectedUsersCount;
        existing.errorGroups = pattern.errorGroups;
      } else {
        this.detectedPatterns.set(signature, pattern);
      }
    }
  }

  /**
   * Detect temporal patterns (time-based patterns)
   */
  async detectTemporalPatterns(errorGroups) {
    const timeSlots = new Map(); // hour of day -> errors
    const daySlots = new Map(); // day of week -> errors
    
    for (const group of errorGroups) {
      for (const occurrence of group.occurrences || []) {
        const timestamp = occurrence.timestamp instanceof Date ? occurrence.timestamp : new Date(occurrence.timestamp);
        const hour = timestamp.getHours();
        const day = timestamp.getDay();
        
        // Track hourly patterns
        if (!timeSlots.has(hour)) {
          timeSlots.set(hour, { count: 0, errors: [] });
        }
        timeSlots.get(hour).count++;
        timeSlots.get(hour).errors.push(group.signature);
        
        // Track daily patterns
        if (!daySlots.has(day)) {
          daySlots.set(day, { count: 0, errors: [] });
        }
        daySlots.get(day).count++;
        daySlots.get(day).errors.push(group.signature);
      }
    }
    
    // Detect significant temporal patterns
    const avgHourlyErrors = Array.from(timeSlots.values()).reduce((sum, slot) => sum + slot.count, 0) / 24;
    const avgDailyErrors = Array.from(daySlots.values()).reduce((sum, slot) => sum + slot.count, 0) / 7;
    
    // Find peak hours (2x above average)
    for (const [hour, data] of timeSlots) {
      if (data.count > avgHourlyErrors * 2) {
        const patternSignature = `temporal_hourly_${hour}`;
        this.detectedPatterns.set(patternSignature, {
          signature: patternSignature,
          type: 'TEMPORAL_HOURLY',
          hour,
          errorCount: data.count,
          averageCount: avgHourlyErrors,
          multiplier: data.count / avgHourlyErrors,
          affectedErrorGroups: [...new Set(data.errors)],
          firstDetected: new Date(),
          lastSeen: new Date(),
          confidence: Math.min(0.95, (data.count / avgHourlyErrors) / 5) // Cap at 95%
        });
      }
    }
    
    // Find peak days (2x above average)
    for (const [day, data] of daySlots) {
      if (data.count > avgDailyErrors * 2) {
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const patternSignature = `temporal_daily_${day}`;
        this.detectedPatterns.set(patternSignature, {
          signature: patternSignature,
          type: 'TEMPORAL_DAILY',
          day,
          dayName: dayNames[day],
          errorCount: data.count,
          averageCount: avgDailyErrors,
          multiplier: data.count / avgDailyErrors,
          affectedErrorGroups: [...new Set(data.errors)],
          firstDetected: new Date(),
          lastSeen: new Date(),
          confidence: Math.min(0.95, (data.count / avgDailyErrors) / 5)
        });
      }
    }
  }

  /**
   * Detect correlation patterns between different error types
   */
  async detectCorrelationPatterns(errorGroups) {
    const correlations = new Map();
    
    // Group errors by time windows (5-minute windows)
    const timeWindows = new Map();
    const windowSize = 300000; // 5 minutes
    
    for (const group of errorGroups) {
      for (const occurrence of group.occurrences || []) {
        const timestamp = new Date(occurrence.timestamp);
        const windowKey = Math.floor(timestamp.getTime() / windowSize) * windowSize;
        
        if (!timeWindows.has(windowKey)) {
          timeWindows.set(windowKey, new Set());
        }
        timeWindows.get(windowKey).add(group.category);
      }
    }
    
    // Find categories that frequently occur together
    for (const [windowKey, categories] of timeWindows) {
      if (categories.size < 2) continue; // Need at least 2 different categories
      
      const categoryArray = Array.from(categories);
      for (let i = 0; i < categoryArray.length; i++) {
        for (let j = i + 1; j < categoryArray.length; j++) {
          const pair = [categoryArray[i], categoryArray[j]].sort().join('|');
          
          if (!correlations.has(pair)) {
            correlations.set(pair, { count: 0, windows: [] });
          }
          correlations.get(pair).count++;
          correlations.get(pair).windows.push(windowKey);
        }
      }
    }
    
    // Create correlation patterns for significant correlations
    const totalWindows = timeWindows.size;
    for (const [pair, data] of correlations) {
      const correlation = data.count / totalWindows;
      
      if (correlation > 0.3 && data.count >= 3) { // 30% correlation, minimum 3 occurrences
        const [category1, category2] = pair.split('|');
        const patternSignature = `correlation_${pair}`;
        
        this.detectedPatterns.set(patternSignature, {
          signature: patternSignature,
          type: 'CORRELATION',
          category1,
          category2,
          correlationStrength: correlation,
          coOccurrences: data.count,
          totalWindows,
          firstDetected: new Date(),
          lastSeen: new Date(),
          confidence: Math.min(0.9, correlation * 2) // Cap at 90%
        });
      }
    }
  }

  /**
   * Analyze error trends over time
   */
  async analyzeTrends() {
    try {
      const now = new Date();
      const windowStart = new Date(now.getTime() - this.config.trendAnalysisWindow);
      
      // Get error statistics for trend analysis
      const currentStats = this.aggregationService.getErrorStatistics({
        start: windowStart,
        end: now
      });
      
      // Update trends for each category
      for (const [category, count] of Object.entries(currentStats.categoryCounts)) {
        await this.updateCategoryTrend(category, count, now);
      }
      
      // Analyze overall error rate trend
      await this.updateOverallTrend(currentStats.totalErrors, now);
      
      // Check for trend-based alerts
      await this.checkTrendAlerts();
      
      // Save trend data
      await this.saveTrendData();
      
    } catch (error) {
      console.error('Error in trend analysis:', error);
    }
  }

  /**
   * Update trend data for a specific category
   */
  async updateCategoryTrend(category, count, timestamp) {
    if (!this.errorTrends.has(category)) {
      this.errorTrends.set(category, {
        category,
        dataPoints: [],
        trend: 'STABLE',
        growthRate: 0,
        lastAnalysis: timestamp
      });
    }
    
    const trend = this.errorTrends.get(category);
    
    // Add new data point
    trend.dataPoints.push({
      timestamp,
      count,
      rate: count / (this.config.trendAnalysisWindow / 60000) // errors per minute
    });
    
    // Keep only last 30 data points (for memory efficiency)
    if (trend.dataPoints.length > 30) {
      trend.dataPoints = trend.dataPoints.slice(-30);
    }
    
    // Calculate trend
    if (trend.dataPoints.length >= 3) {
      const recent = trend.dataPoints.slice(-3);
      const older = trend.dataPoints.slice(-6, -3);
      
      if (older.length > 0) {
        const recentAvg = recent.reduce((sum, dp) => sum + dp.count, 0) / recent.length;
        const olderAvg = older.reduce((sum, dp) => sum + dp.count, 0) / older.length;
        
        trend.growthRate = olderAvg > 0 ? (recentAvg - olderAvg) / olderAvg : 0;
        
        if (trend.growthRate > 0.5) trend.trend = 'INCREASING';
        else if (trend.growthRate < -0.3) trend.trend = 'DECREASING';
        else trend.trend = 'STABLE';
      }
    }
    
    trend.lastAnalysis = timestamp;
  }

  /**
   * Update overall error trend
   */
  async updateOverallTrend(totalErrors, timestamp) {
    const category = 'OVERALL';
    await this.updateCategoryTrend(category, totalErrors, timestamp);
  }

  /**
   * Check for new pattern alerts
   */
  async checkNewPatternAlerts() {
    for (const [signature, pattern] of this.detectedPatterns) {
      // Skip if already alerted
      if (this.activeAlerts.has(signature)) continue;
      
      // Check if pattern meets alert criteria
      let shouldAlert = false;
      let alertReason = '';
      
      if (pattern.type === 'RECURRING' && pattern.totalOccurrences >= this.config.newPatternAlertThreshold) {
        shouldAlert = true;
        alertReason = `New recurring error pattern detected with ${pattern.totalOccurrences} occurrences`;
      } else if (pattern.type === 'TEMPORAL_HOURLY' && pattern.multiplier >= 3) {
        shouldAlert = true;
        alertReason = `High error rate detected at hour ${pattern.hour} (${pattern.multiplier.toFixed(1)}x above average)`;
      } else if (pattern.type === 'TEMPORAL_DAILY' && pattern.multiplier >= 3) {
        shouldAlert = true;
        alertReason = `High error rate detected on ${pattern.dayName} (${pattern.multiplier.toFixed(1)}x above average)`;
      } else if (pattern.type === 'CORRELATION' && pattern.correlationStrength >= 0.5) {
        shouldAlert = true;
        alertReason = `Strong correlation detected between ${pattern.category1} and ${pattern.category2} errors`;
      }
      
      if (shouldAlert) {
        await this.createPatternAlert(signature, pattern, alertReason);
      }
    }
  }

  /**
   * Check for trend-based alerts
   */
  async checkTrendAlerts() {
    for (const [category, trend] of this.errorTrends) {
      const alertKey = `trend_${category}`;
      
      // Check for rapid growth
      if (trend.growthRate >= this.config.errorGrowthThreshold) {
        if (!this.activeAlerts.has(alertKey)) {
          await this.createTrendAlert(alertKey, trend, 'RAPID_GROWTH');
        }
      }
      
      // Check for high error rate
      if (trend.dataPoints.length > 0) {
        const latestRate = trend.dataPoints[trend.dataPoints.length - 1].rate;
        if (latestRate >= this.config.errorRateThreshold) {
          const rateAlertKey = `rate_${category}`;
          if (!this.activeAlerts.has(rateAlertKey)) {
            await this.createTrendAlert(rateAlertKey, trend, 'HIGH_RATE');
          }
        }
      }
    }
  }

  /**
   * Create a pattern alert
   */
  async createPatternAlert(signature, pattern, reason) {
    const alert = {
      id: signature,
      type: 'PATTERN',
      pattern: pattern.type,
      category: pattern.category || 'UNKNOWN',
      reason,
      severity: this.calculateAlertSeverity(pattern),
      createdAt: new Date(),
      lastTriggered: new Date(),
      status: 'ACTIVE',
      triggerCount: 1,
      metadata: {
        patternSignature: signature,
        confidence: pattern.confidence,
        affectedUsers: pattern.affectedUsersCount || 0
      }
    };
    
    this.activeAlerts.set(signature, alert);
    this.emitPatternAlert(alert);
  }

  /**
   * Create a trend alert
   */
  async createTrendAlert(alertKey, trend, alertType) {
    const alert = {
      id: alertKey,
      type: 'TREND',
      trendType: alertType,
      category: trend.category,
      reason: alertType === 'RAPID_GROWTH' 
        ? `Rapid error growth detected: ${(trend.growthRate * 100).toFixed(1)}% increase`
        : `High error rate detected: ${trend.dataPoints[trend.dataPoints.length - 1].rate.toFixed(2)} errors/min`,
      severity: alertType === 'RAPID_GROWTH' ? 'HIGH' : 'MEDIUM',
      createdAt: new Date(),
      lastTriggered: new Date(),
      status: 'ACTIVE',
      triggerCount: 1,
      metadata: {
        growthRate: trend.growthRate,
        currentRate: trend.dataPoints[trend.dataPoints.length - 1]?.rate || 0,
        trend: trend.trend
      }
    };
    
    this.activeAlerts.set(alertKey, alert);
    this.emitTrendAlert(alert);
  }

  /**
   * Calculate alert severity based on pattern characteristics
   */
  calculateAlertSeverity(pattern) {
    if (pattern.type === 'RECURRING' && pattern.affectedUsersCount > 10) return 'CRITICAL';
    if (pattern.type === 'TEMPORAL_HOURLY' && pattern.multiplier > 5) return 'HIGH';
    if (pattern.type === 'TEMPORAL_DAILY' && pattern.multiplier > 5) return 'HIGH';
    if (pattern.type === 'CORRELATION' && pattern.correlationStrength > 0.7) return 'HIGH';
    return 'MEDIUM';
  }

  /**
   * Emit pattern alert
   */
  emitPatternAlert(alert) {
    console.warn('PATTERN ALERT:', {
      id: alert.id,
      type: alert.type,
      pattern: alert.pattern,
      category: alert.category,
      reason: alert.reason,
      severity: alert.severity,
      metadata: alert.metadata
    });
    
    // TODO: Integrate with external alerting systems
  }

  /**
   * Emit trend alert
   */
  emitTrendAlert(alert) {
    console.warn('TREND ALERT:', {
      id: alert.id,
      type: alert.type,
      trendType: alert.trendType,
      category: alert.category,
      reason: alert.reason,
      severity: alert.severity,
      metadata: alert.metadata
    });
    
    // TODO: Integrate with external alerting systems
  }

  /**
   * Extract message pattern for grouping
   */
  extractMessagePattern(message) {
    if (!message) return '';
    
    return message
      .replace(/\d+/g, '{NUMBER}')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{UUID}')
      .replace(/https?:\/\/[^\s]+/g, '{URL}')
      .replace(/\/[^\s]+/g, '{PATH}')
      .toLowerCase()
      .trim();
  }

  /**
   * Extract stack pattern for grouping
   */
  extractStackPattern(stack) {
    if (!stack) return '';
    
    const lines = stack.split('\n').slice(0, 3); // Take first 3 lines
    return lines
      .map(line => line.replace(/:\d+:\d+/g, ':LINE:COL'))
      .join('|');
  }

  /**
   * Generate pattern signature
   */
  generatePatternSignature(patternData) {
    const crypto = require('crypto');
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(patternData))
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Calculate pattern confidence score
   */
  calculatePatternConfidence(pattern) {
    let confidence = 0;
    
    // Base confidence on occurrence count
    const occurrences = pattern.totalOccurrences || 0;
    confidence += Math.min(0.5, occurrences / 20);
    
    // Add confidence for multiple error groups
    const groupCount = pattern.errorGroups ? pattern.errorGroups.length : 0;
    confidence += Math.min(0.3, groupCount / 10);
    
    // Add confidence for affected users
    const userCount = pattern.affectedUsersCount || 0;
    confidence += Math.min(0.2, userCount / 5);
    
    // Ensure we return a valid number
    return Math.min(0.95, Math.max(0.1, confidence)); // Cap at 95%, minimum 10%
  }

  /**
   * Get detected patterns with filtering
   */
  getDetectedPatterns(options = {}) {
    const {
      type,
      category,
      minConfidence = 0,
      limit = 50,
      offset = 0,
      sortBy = 'confidence',
      sortOrder = 'desc'
    } = options;

    let patterns = Array.from(this.detectedPatterns.values());

    // Apply filters
    if (type) {
      patterns = patterns.filter(pattern => pattern.type === type);
    }
    
    if (category) {
      patterns = patterns.filter(pattern => pattern.category === category);
    }
    
    if (minConfidence > 0) {
      patterns = patterns.filter(pattern => pattern.confidence >= minConfidence);
    }

    // Sort patterns
    patterns.sort((a, b) => {
      let aVal = a[sortBy] || 0;
      let bVal = b[sortBy] || 0;
      
      return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
    });

    // Apply pagination
    const total = patterns.length;
    patterns = patterns.slice(offset, offset + limit);

    return {
      patterns,
      total,
      limit,
      offset
    };
  }

  /**
   * Get error trends
   */
  getErrorTrends(category = null) {
    if (category) {
      return this.errorTrends.get(category) || null;
    }
    
    return Array.from(this.errorTrends.values());
  }

  /**
   * Get active alerts
   */
  getActiveAlerts() {
    return Array.from(this.activeAlerts.values())
      .filter(alert => alert.status === 'ACTIVE');
  }

  /**
   * Generate pattern summary report
   */
  generatePatternSummaryReport() {
    const patterns = Array.from(this.detectedPatterns.values());
    const trends = Array.from(this.errorTrends.values());
    const alerts = this.getActiveAlerts();
    
    const report = {
      generatedAt: new Date(),
      summary: {
        totalPatterns: patterns.length,
        recurringPatterns: patterns.filter(p => p.type === 'RECURRING').length,
        temporalPatterns: patterns.filter(p => p.type.startsWith('TEMPORAL')).length,
        correlationPatterns: patterns.filter(p => p.type === 'CORRELATION').length,
        activeAlerts: alerts.length,
        trendsAnalyzed: trends.length
      },
      topPatterns: patterns
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
        .slice(0, 10)
        .map(pattern => ({
          signature: pattern.signature,
          type: pattern.type,
          category: pattern.category,
          confidence: pattern.confidence,
          totalOccurrences: pattern.totalOccurrences,
          affectedUsersCount: pattern.affectedUsersCount
        })),
      criticalTrends: trends
        .filter(trend => trend.trend === 'INCREASING' && trend.growthRate > 1)
        .map(trend => ({
          category: trend.category,
          trend: trend.trend,
          growthRate: trend.growthRate,
          currentRate: trend.dataPoints[trend.dataPoints.length - 1]?.rate || 0
        })),
      activeAlerts: alerts.map(alert => ({
        id: alert.id,
        type: alert.type,
        category: alert.category,
        severity: alert.severity,
        reason: alert.reason,
        createdAt: alert.createdAt
      }))
    };
    
    return report;
  }

  /**
   * Save pattern data to disk
   */
  async savePatternData() {
    try {
      const patternsData = {};
      for (const [key, value] of this.detectedPatterns.entries()) {
        patternsData[key] = value;
      }

      await fs.writeFile(this.patternsFile, JSON.stringify(patternsData, null, 2));
      
    } catch (error) {
      console.error('Error saving pattern data:', error);
    }
  }

  /**
   * Save trend data to disk
   */
  async saveTrendData() {
    try {
      const trendsData = {};
      for (const [key, value] of this.errorTrends.entries()) {
        trendsData[key] = value;
      }

      await fs.writeFile(this.trendsFile, JSON.stringify(trendsData, null, 2));
      
      // Save alerts
      const alertsData = {};
      for (const [key, value] of this.activeAlerts.entries()) {
        alertsData[key] = value;
      }

      await fs.writeFile(this.alertsFile, JSON.stringify(alertsData, null, 2));
      
    } catch (error) {
      console.error('Error saving trend data:', error);
    }
  }

  /**
   * Cleanup old patterns and trends
   */
  async cleanup(retentionDays = 30) {
    const cutoffDate = new Date(Date.now() - (retentionDays * 24 * 60 * 60 * 1000));
    
    // Remove old patterns
    for (const [signature, pattern] of this.detectedPatterns.entries()) {
      if (pattern.lastSeen < cutoffDate) {
        this.detectedPatterns.delete(signature);
      }
    }

    // Clean up old trend data points
    for (const [category, trend] of this.errorTrends.entries()) {
      trend.dataPoints = trend.dataPoints.filter(dp => dp.timestamp >= cutoffDate);
      if (trend.dataPoints.length === 0) {
        this.errorTrends.delete(category);
      }
    }

    // Remove resolved alerts older than retention period
    for (const [alertKey, alert] of this.activeAlerts.entries()) {
      if (alert.status === 'RESOLVED' && alert.lastTriggered < cutoffDate) {
        this.activeAlerts.delete(alertKey);
      }
    }

    await this.savePatternData();
    await this.saveTrendData();
  }

  /**
   * Shutdown the service
   */
  async shutdown() {
    if (this.patternAnalysisTimer) {
      clearInterval(this.patternAnalysisTimer);
    }
    if (this.trendAnalysisTimer) {
      clearInterval(this.trendAnalysisTimer);
    }
    
    await this.savePatternData();
    await this.saveTrendData();
  }
}

module.exports = ErrorPatternDetection;