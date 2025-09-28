const ErrorResolutionTracker = require('../errorResolutionTracker');
const path = require('path');
const fs = require('fs').promises;

describe('ErrorResolutionTracker Integration', () => {
  let tracker;
  let testStorageDir;

  beforeEach(async () => {
    testStorageDir = path.join(__dirname, '../../../logs/test-resolution-integration');
    
    tracker = new ErrorResolutionTracker({
      storageDir: testStorageDir,
      recurrenceWindow: 24 * 60 * 60 * 1000,
      effectivenessThreshold: 0.8
    });

    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, 200));
  }, 15000);

  afterEach(async () => {
    if (tracker) {
      await tracker.shutdown();
      tracker = null;
    }
    
    try {
      await fs.rmdir(testStorageDir, { recursive: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  test('should complete full error resolution workflow', async () => {
    const errorSignature = 'integration-test-error';
    
    // Step 1: Mark error as resolved
    const resolution = await tracker.markErrorResolved(errorSignature, {
      resolutionNotes: 'Fixed integration test error',
      fixDescription: 'Added proper error handling',
      fixType: 'CODE_FIX',
      developerId: 'test-dev',
      estimatedEffort: 2,
      rootCause: 'Missing error handling',
      preventionMeasures: 'Add comprehensive error handling'
    });

    expect(resolution).toBeDefined();
    expect(resolution.status).toBe('RESOLVED');

    // Step 2: Check resolution status
    const status = tracker.getResolutionStatus(errorSignature);
    expect(status.hasResolution).toBe(true);
    expect(status.status).toBe('RESOLVED');

    // Step 3: Track recurrence
    const recurrence = await tracker.trackErrorRecurrence(errorSignature, {
      context: { component: 'test' }
    });

    expect(recurrence).toBeDefined();
    expect(recurrence.recurrenceCount).toBe(1);

    // Step 4: Get effectiveness metrics
    const effectiveness = tracker.getFixEffectiveness();
    expect(effectiveness.totalFixes).toBe(1);

    // Step 5: Get suggested fixes (should be empty for new pattern)
    const suggestedFixes = tracker.getSuggestedFixes('new-error-pattern');
    expect(Array.isArray(suggestedFixes)).toBe(true);
  }, 20000);

  test('should handle multiple similar errors for suggested fixes', async () => {
    // Create multiple similar errors
    const errors = [
      {
        signature: 'validation-001',
        data: {
          resolutionNotes: 'Fixed validation error 1',
          fixDescription: 'Added input validation',
          fixType: 'VALIDATION_FIX',
          developerId: 'dev1',
          estimatedEffort: 1,
          rootCause: 'Missing validation',
          preventionMeasures: 'Add validation framework'
        }
      },
      {
        signature: 'validation-002',
        data: {
          resolutionNotes: 'Fixed validation error 2',
          fixDescription: 'Added input validation',
          fixType: 'VALIDATION_FIX',
          developerId: 'dev2',
          estimatedEffort: 1.5,
          rootCause: 'Missing validation',
          preventionMeasures: 'Add validation framework'
        }
      }
    ];

    // Resolve all errors
    for (const error of errors) {
      await tracker.markErrorResolved(error.signature, error.data);
    }

    // Get suggested fixes
    const suggestedFixes = tracker.getSuggestedFixes('validation-003');
    expect(suggestedFixes.length).toBeGreaterThan(0);
    expect(suggestedFixes[0].fixType).toBe('VALIDATION_FIX');
    expect(suggestedFixes[0].applicationCount).toBeGreaterThan(1);
  }, 20000);
});