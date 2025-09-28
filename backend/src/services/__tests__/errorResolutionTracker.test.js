const ErrorResolutionTracker = require('../errorResolutionTracker');
const fs = require('fs').promises;
const path = require('path');

describe('ErrorResolutionTracker', () => {
  let tracker;
  let testStorageDir;

  beforeEach(async () => {
    // Create temporary test directory
    testStorageDir = path.join(__dirname, '../../../logs/test-resolution');
    
    tracker = new ErrorResolutionTracker({
      storageDir: testStorageDir,
      recurrenceWindow: 24 * 60 * 60 * 1000, // 1 day for testing
      effectivenessThreshold: 0.8
    });

    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, 100));
  }, 10000); // Increase timeout for beforeEach

  afterEach(async () => {
    // Cleanup
    if (tracker) {
      await tracker.shutdown();
      tracker = null;
    }
    
    // Remove test directory
    try {
      await fs.rmdir(testStorageDir, { recursive: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Error Resolution Tracking', () => {
    test('should mark error as resolved with comprehensive data', async () => {
      const errorSignature = 'test-error-001';
      const resolutionData = {
        resolutionNotes: 'Fixed null pointer exception by adding validation',
        fixDescription: 'Added null check before accessing user.profile',
        fixType: 'CODE_FIX',
        developerId: 'dev-123',
        estimatedEffort: 2,
        rootCause: 'Missing null validation',
        preventionMeasures: 'Add comprehensive input validation',
        relatedIssues: ['ISSUE-456'],
        tags: ['validation', 'null-check']
      };

      const resolution = await tracker.markErrorResolved(errorSignature, resolutionData);

      expect(resolution).toBeDefined();
      expect(resolution.errorSignature).toBe(errorSignature);
      expect(resolution.status).toBe('RESOLVED');
      expect(resolution.resolutionNotes).toBe(resolutionData.resolutionNotes);
      expect(resolution.fixType).toBe(resolutionData.fixType);
      expect(resolution.developerId).toBe(resolutionData.developerId);
      expect(resolution.recurrenceCount).toBe(0);
      expect(resolution.resolutionHistory).toHaveLength(1);
      expect(resolution.resolutionHistory[0].action).toBe('RESOLVED');
    });

    test('should track error recurrence after resolution', async () => {
      const errorSignature = 'test-error-002';
      
      // First, mark as resolved
      await tracker.markErrorResolved(errorSignature, {
        resolutionNotes: 'Fixed database connection issue',
        fixDescription: 'Updated connection pool settings',
        fixType: 'CONFIG_CHANGE',
        developerId: 'dev-456',
        estimatedEffort: 1,
        rootCause: 'Insufficient connection pool size',
        preventionMeasures: 'Monitor connection pool metrics'
      });

      // Then track recurrence
      const recurrenceResult = await tracker.trackErrorRecurrence(errorSignature, {
        context: { component: 'database', operation: 'query' }
      });

      expect(recurrenceResult).toBeDefined();
      expect(recurrenceResult.errorSignature).toBe(errorSignature);
      expect(recurrenceResult.recurrenceCount).toBe(1);
      expect(recurrenceResult.timeSinceResolution).toBeGreaterThan(0);

      // Check resolution status
      const status = tracker.getResolutionStatus(errorSignature);
      expect(status.status).toBe('RECURRED');
      expect(status.recurrenceCount).toBe(1);
      expect(status.resolutionHistory).toHaveLength(2);
      expect(status.resolutionHistory[1].action).toBe('RECURRED');
    });

    test('should re-resolve error with updated fix', async () => {
      const errorSignature = 'test-error-003';
      
      // Initial resolution
      await tracker.markErrorResolved(errorSignature, {
        resolutionNotes: 'Initial fix attempt',
        fixDescription: 'Added try-catch block',
        fixType: 'CODE_FIX',
        developerId: 'dev-789',
        estimatedEffort: 1,
        rootCause: 'Unhandled exception',
        preventionMeasures: 'Add error handling'
      });

      // Track recurrence
      await tracker.trackErrorRecurrence(errorSignature, {
        context: { component: 'api', operation: 'process' }
      });

      // Re-resolve with better fix
      const newResolution = await tracker.reResolveError(errorSignature, {
        resolutionNotes: 'Improved fix with proper validation',
        fixDescription: 'Added comprehensive input validation and error handling',
        fixType: 'CODE_FIX',
        developerId: 'dev-789',
        estimatedEffort: 3,
        rootCause: 'Insufficient input validation',
        preventionMeasures: 'Implement validation framework',
        tags: ['validation', 'error-handling']
      });

      expect(newResolution.status).toBe('RESOLVED');
      expect(newResolution.recurrenceCount).toBe(0); // Reset for new fix
      expect(newResolution.resolutionHistory).toHaveLength(3);
      expect(newResolution.resolutionHistory[2].action).toBe('RE_RESOLVED');
      expect(newResolution.fixDescription).toBe('Added comprehensive input validation and error handling');
    });

    test('should get resolution status for unresolved error', () => {
      const status = tracker.getResolutionStatus('non-existent-error');
      
      expect(status.status).toBe('UNRESOLVED');
      expect(status.hasResolution).toBe(false);
    });

    test('should get resolution status for resolved error', async () => {
      const errorSignature = 'test-error-004';
      
      await tracker.markErrorResolved(errorSignature, {
        resolutionNotes: 'Fixed memory leak',
        fixDescription: 'Properly dispose resources',
        fixType: 'CODE_FIX',
        developerId: 'dev-111',
        estimatedEffort: 4,
        rootCause: 'Resource not disposed',
        preventionMeasures: 'Use using statements'
      });

      const status = tracker.getResolutionStatus(errorSignature);
      
      expect(status.hasResolution).toBe(true);
      expect(status.status).toBe('RESOLVED');
      expect(status.daysSinceResolution).toBe(0);
      expect(status.isEffective).toBe(true); // No recurrences yet
    });
  });

  describe('Suggested Fixes Database', () => {
    test('should create suggested fixes from resolutions', async () => {
      const errorSignature1 = 'similar-error-001';
      const errorSignature2 = 'similar-error-002';
      
      // Create similar resolutions
      await tracker.markErrorResolved(errorSignature1, {
        resolutionNotes: 'Fixed validation error',
        fixDescription: 'Added input validation',
        fixType: 'VALIDATION_FIX',
        developerId: 'dev-222',
        estimatedEffort: 2,
        rootCause: 'Missing validation',
        preventionMeasures: 'Implement validation rules'
      });

      await tracker.markErrorResolved(errorSignature2, {
        resolutionNotes: 'Fixed similar validation issue',
        fixDescription: 'Added input validation checks',
        fixType: 'VALIDATION_FIX',
        developerId: 'dev-333',
        estimatedEffort: 1,
        rootCause: 'Insufficient validation',
        preventionMeasures: 'Add validation framework'
      });

      // Get suggested fixes
      const suggestedFixes = tracker.getSuggestedFixes(errorSignature1);
      
      expect(suggestedFixes).toHaveLength(1);
      expect(suggestedFixes[0].fixType).toBe('VALIDATION_FIX');
      expect(suggestedFixes[0].applicationCount).toBe(2);
      expect(suggestedFixes[0].successCount).toBe(2);
      expect(suggestedFixes[0].successRate).toBe(1.0);
      expect(suggestedFixes[0].confidence).toBeGreaterThan(0.9);
    });

    test('should filter suggested fixes by success rate', async () => {
      const errorSignature = 'filter-test-error';
      
      // Create resolution that will recur (low success rate)
      await tracker.markErrorResolved(errorSignature, {
        resolutionNotes: 'Attempted fix',
        fixDescription: 'Quick fix attempt',
        fixType: 'QUICK_FIX',
        developerId: 'dev-444',
        estimatedEffort: 0.5,
        rootCause: 'Unknown',
        preventionMeasures: 'Monitor'
      });

      // Track multiple recurrences to lower success rate
      await tracker.trackErrorRecurrence(errorSignature, { context: {} });
      await tracker.trackErrorRecurrence(errorSignature, { context: {} });

      // Get suggested fixes with high success rate filter
      const highQualityFixes = tracker.getSuggestedFixes(errorSignature, {
        minSuccessRate: 0.8,
        includeIneffective: false
      });

      expect(highQualityFixes).toHaveLength(0);

      // Get all fixes including ineffective ones
      const allFixes = tracker.getSuggestedFixes(errorSignature, {
        minSuccessRate: 0.0,
        includeIneffective: true
      });

      expect(allFixes.length).toBeGreaterThan(0);
      expect(allFixes[0].successRate).toBeLessThan(0.8);
    });
  });

  describe('Fix Effectiveness Tracking', () => {
    test('should calculate effectiveness score correctly', async () => {
      const errorSignature = 'effectiveness-test-001';
      
      // Create resolution
      await tracker.markErrorResolved(errorSignature, {
        resolutionNotes: 'Effective fix',
        fixDescription: 'Comprehensive solution',
        fixType: 'CODE_FIX',
        developerId: 'dev-555',
        estimatedEffort: 3,
        rootCause: 'Logic error',
        preventionMeasures: 'Add unit tests'
      });

      // Get effectiveness metrics
      const effectiveness = tracker.getFixEffectiveness();
      
      expect(effectiveness.totalFixes).toBe(1);
      expect(effectiveness.effectiveFixes).toBe(1);
      expect(effectiveness.effectivenessRate).toBe(1.0);
      expect(effectiveness.averageEffectiveness).toBe(1.0);
      expect(effectiveness.fixTypeBreakdown['CODE_FIX']).toBeDefined();
      expect(effectiveness.fixTypeBreakdown['CODE_FIX'].count).toBe(1);
      expect(effectiveness.fixTypeBreakdown['CODE_FIX'].effectiveCount).toBe(1);
    });

    test('should track effectiveness over time with recurrences', async () => {
      const errorSignature = 'effectiveness-test-002';
      
      // Create resolution
      await tracker.markErrorResolved(errorSignature, {
        resolutionNotes: 'Initial fix',
        fixDescription: 'Basic solution',
        fixType: 'CODE_FIX',
        developerId: 'dev-666',
        estimatedEffort: 2,
        rootCause: 'Bug in logic',
        preventionMeasures: 'Code review'
      });

      // Track recurrence to lower effectiveness
      await tracker.trackErrorRecurrence(errorSignature, { context: {} });

      // Get effectiveness metrics
      const effectiveness = tracker.getFixEffectiveness();
      
      expect(effectiveness.totalFixes).toBe(1);
      expect(effectiveness.effectiveFixes).toBe(0); // Below threshold due to recurrence
      expect(effectiveness.effectivenessRate).toBe(0.0);
      expect(effectiveness.averageEffectiveness).toBeLessThanOrEqual(0.8);
    });

    test('should filter effectiveness by fix type', async () => {
      // Create different types of fixes
      await tracker.markErrorResolved('error-001', {
        resolutionNotes: 'Code fix',
        fixDescription: 'Fixed code issue',
        fixType: 'CODE_FIX',
        developerId: 'dev-777',
        estimatedEffort: 2,
        rootCause: 'Code bug',
        preventionMeasures: 'Testing'
      });

      await tracker.markErrorResolved('error-002', {
        resolutionNotes: 'Config fix',
        fixDescription: 'Updated configuration',
        fixType: 'CONFIG_CHANGE',
        developerId: 'dev-888',
        estimatedEffort: 1,
        rootCause: 'Wrong config',
        preventionMeasures: 'Config validation'
      });

      // Get effectiveness for specific fix type
      const codeFixEffectiveness = tracker.getFixEffectiveness({
        fixType: 'CODE_FIX'
      });

      expect(codeFixEffectiveness.totalFixes).toBe(1);
      expect(codeFixEffectiveness.fixTypeBreakdown['CODE_FIX']).toBeDefined();
      expect(codeFixEffectiveness.fixTypeBreakdown['CONFIG_CHANGE']).toBeUndefined();
    });

    test('should filter effectiveness by developer', async () => {
      const developerId = 'dev-999';
      
      await tracker.markErrorResolved('dev-error-001', {
        resolutionNotes: 'Developer specific fix',
        fixDescription: 'Fixed by specific developer',
        fixType: 'CODE_FIX',
        developerId: developerId,
        estimatedEffort: 3,
        rootCause: 'Complex bug',
        preventionMeasures: 'Better testing'
      });

      await tracker.markErrorResolved('dev-error-002', {
        resolutionNotes: 'Another developer fix',
        fixDescription: 'Fixed by different developer',
        fixType: 'CODE_FIX',
        developerId: 'other-dev',
        estimatedEffort: 2,
        rootCause: 'Simple bug',
        preventionMeasures: 'Code review'
      });

      // Get effectiveness for specific developer
      const developerEffectiveness = tracker.getFixEffectiveness({
        developerId: developerId
      });

      expect(developerEffectiveness.totalFixes).toBe(1);
      expect(developerEffectiveness.topPerformingFixes[0].resolutionId).toBeDefined();
    });
  });

  describe('Data Persistence', () => {
    test('should persist and load resolution data', async () => {
      const errorSignature = 'persistence-test-001';
      
      // Create resolution
      await tracker.markErrorResolved(errorSignature, {
        resolutionNotes: 'Persistence test fix',
        fixDescription: 'Test data persistence',
        fixType: 'CODE_FIX',
        developerId: 'dev-persist',
        estimatedEffort: 1,
        rootCause: 'Test case',
        preventionMeasures: 'Testing'
      });

      // Force persistence
      await tracker.persistToDisk();

      // Create new tracker instance to test loading
      const newTracker = new ErrorResolutionTracker({
        storageDir: testStorageDir
      });

      // Wait for initialization and loading
      await new Promise(resolve => setTimeout(resolve, 200));

      // Check if data was loaded
      const status = newTracker.getResolutionStatus(errorSignature);
      expect(status.hasResolution).toBe(true);
      expect(status.resolutionNotes).toBe('Persistence test fix');

      await newTracker.shutdown();
    });

    test('should handle cleanup of old data', async () => {
      const oldErrorSignature = 'old-error-001';
      
      // Create resolution
      await tracker.markErrorResolved(oldErrorSignature, {
        resolutionNotes: 'Old fix',
        fixDescription: 'Old solution',
        fixType: 'CODE_FIX',
        developerId: 'dev-old',
        estimatedEffort: 1,
        rootCause: 'Old issue',
        preventionMeasures: 'Old prevention'
      });

      // Manually set old date for testing
      const resolution = tracker.resolutions.get(oldErrorSignature);
      resolution.resolvedAt = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago

      // Run cleanup with short retention
      await tracker.cleanup(30); // 30 days retention

      // Check if old data was cleaned up
      const status = tracker.getResolutionStatus(oldErrorSignature);
      expect(status.hasResolution).toBe(false);
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid error signatures gracefully', async () => {
      const result = await tracker.trackErrorRecurrence('non-existent-error', {
        context: {}
      });

      expect(result).toBeNull();
    });

    test('should handle re-resolving non-existent error', async () => {
      await expect(
        tracker.reResolveError('non-existent-error', {
          resolutionNotes: 'New fix',
          fixDescription: 'New solution',
          fixType: 'CODE_FIX',
          developerId: 'dev-test',
          estimatedEffort: 1,
          rootCause: 'Test',
          preventionMeasures: 'Test'
        })
      ).rejects.toThrow('No existing resolution found');
    });

    test('should handle malformed resolution data', async () => {
      const errorSignature = 'malformed-test-001';
      
      // Should not throw error with minimal data
      const resolution = await tracker.markErrorResolved(errorSignature, {
        resolutionNotes: 'Minimal fix'
        // Missing other required fields
      });

      expect(resolution).toBeDefined();
      expect(resolution.resolutionNotes).toBe('Minimal fix');
      expect(resolution.fixType).toBeUndefined();
    });
  });
});