/**
 * Monitoring Routes for Logging System
 * Provides endpoints for health checks, metrics, and alerts
 */

const express = require('express');
const router = express.Router();
const LoggingHealthCheck = require('../monitoring/healthCheck');
const AlertManager = require('../monitoring/alertManager');
const PerformanceValidator = require('../monitoring/performanceValidator');
const logger = require('../services/logger');

// Initialize monitoring services
const healthCheck = new LoggingHealthCheck();
const alertManager = new AlertManager({
  email: {
    enabled: process.env.ALERT_EMAIL_ENABLED === 'true',
    smtp: {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    },
    recipients: {
      critical: (process.env.ALERT_CRITICAL_EMAILS || '').split(',').filter(Boolean),
      warning: (process.env.ALERT_WARNING_EMAILS || '').split(',').filter(Boolean),
      default: (process.env.ALERT_DEFAULT_EMAILS || '').split(',').filter(Boolean)
    }
  },
  slack: {
    enabled: process.env.ALERT_SLACK_ENABLED === 'true',
    webhook: process.env.SLACK_WEBHOOK_URL,
    channel: process.env.SLACK_CHANNEL || '#alerts'
  }
});

const performanceValidator = new PerformanceValidator({
  thresholds: {
    logWriteTime: parseInt(process.env.PERF_LOG_WRITE_THRESHOLD) || 100,
    batchProcessTime: parseInt(process.env.PERF_BATCH_THRESHOLD) || 1000,
    memoryUsage: parseInt(process.env.PERF_MEMORY_THRESHOLD) || 500 * 1024 * 1024,
    diskIORate: parseInt(process.env.PERF_DISK_IO_THRESHOLD) || 10 * 1024 * 1024
  }
});

/**
 * Health check endpoint
 */
router.get('/health', async (req, res) => {
  try {
    const health = await healthCheck.performHealthCheck();
    
    // Process health results for alerts
    await alertManager.processHealthCheck(health);
    
    const statusCode = health.status === 'healthy' ? 200 : 
                      health.status === 'warning' ? 200 : 503;
    
    res.status(statusCode).json(health);
    
  } catch (error) {
    logger.error('Health check endpoint failed', error);
    res.status(500).json({
      status: 'error',
      message: 'Health check failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Detailed health status
 */
router.get('/health/detailed', async (req, res) => {
  try {
    const health = await healthCheck.performHealthCheck();
    const performance = performanceValidator.getPerformanceMetrics();
    const alerts = alertManager.getActiveAlerts();
    
    const detailedHealth = {
      ...health,
      performance,
      activeAlerts: alerts.length,
      alertSummary: {
        critical: alerts.filter(a => a.severity === 'critical').length,
        warning: alerts.filter(a => a.severity === 'warning').length,
        info: alerts.filter(a => a.severity === 'info').length
      }
    };
    
    res.json(detailedHealth);
    
  } catch (error) {
    logger.error('Detailed health check failed', error);
    res.status(500).json({
      status: 'error',
      message: 'Detailed health check failed',
      error: error.message
    });
  }
});

/**
 * Performance validation endpoint
 */
router.post('/performance/validate', async (req, res) => {
  try {
    logger.info('Performance validation requested', {
      requestedBy: req.ip,
      timestamp: new Date().toISOString()
    });
    
    const validation = await performanceValidator.validatePerformance();
    
    res.json(validation);
    
  } catch (error) {
    logger.error('Performance validation failed', error);
    res.status(500).json({
      status: 'error',
      message: 'Performance validation failed',
      error: error.message
    });
  }
});

/**
 * Performance metrics endpoint
 */
router.get('/performance/metrics', (req, res) => {
  try {
    const metrics = performanceValidator.getPerformanceMetrics();
    const validationResults = performanceValidator.getValidationResults(5);
    
    res.json({
      metrics,
      recentValidations: validationResults,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Failed to get performance metrics', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get performance metrics',
      error: error.message
    });
  }
});

/**
 * Active alerts endpoint
 */
router.get('/alerts', (req, res) => {
  try {
    const activeAlerts = alertManager.getActiveAlerts();
    const alertHistory = alertManager.getAlertHistory(20);
    
    res.json({
      active: activeAlerts,
      recent: alertHistory,
      summary: {
        total: activeAlerts.length,
        critical: activeAlerts.filter(a => a.severity === 'critical').length,
        warning: activeAlerts.filter(a => a.severity === 'warning').length,
        info: activeAlerts.filter(a => a.severity === 'info').length
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Failed to get alerts', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get alerts',
      error: error.message
    });
  }
});

/**
 * Resolve alert endpoint
 */
router.post('/alerts/:alertId/resolve', (req, res) => {
  try {
    const { alertId } = req.params;
    const { resolution } = req.body;
    
    alertManager.resolveAlert(alertId, resolution || 'Manual resolution via API');
    
    logger.info('Alert resolved via API', {
      alertId,
      resolution,
      resolvedBy: req.ip
    });
    
    res.json({
      status: 'success',
      message: 'Alert resolved',
      alertId,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Failed to resolve alert', error, { alertId: req.params.alertId });
    res.status(500).json({
      status: 'error',
      message: 'Failed to resolve alert',
      error: error.message
    });
  }
});

/**
 * Dashboard endpoint
 */
router.get('/dashboard', (req, res) => {
  try {
    const path = require('path');
    const dashboardPath = path.join(__dirname, '../monitoring/dashboard.html');
    res.sendFile(dashboardPath);
  } catch (error) {
    logger.error('Failed to serve dashboard', error);
    res.status(500).send('Dashboard not available');
  }
});

/**
 * System status summary
 */
router.get('/status', async (req, res) => {
  try {
    const health = healthCheck.getHealthStatus();
    const alerts = alertManager.getActiveAlerts();
    const performance = performanceValidator.getPerformanceMetrics();
    
    const status = {
      overall: health.status || 'unknown',
      components: {
        logging: health.status,
        alerts: alerts.length === 0 ? 'healthy' : 'has-alerts',
        performance: performance.monitoring?.enabled ? 'monitoring' : 'disabled'
      },
      metrics: {
        uptime: Math.round(process.uptime()),
        memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        activeAlerts: alerts.length,
        lastHealthCheck: health.lastCheck
      },
      timestamp: new Date().toISOString()
    };
    
    res.json(status);
    
  } catch (error) {
    logger.error('Failed to get system status', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get system status',
      error: error.message
    });
  }
});

/**
 * Logging system configuration
 */
router.get('/config', (req, res) => {
  try {
    const config = {
      logging: {
        level: logger.level,
        transports: logger.transports?.map(t => ({
          name: t.name,
          level: t.level,
          enabled: !t.silent
        })) || []
      },
      monitoring: {
        healthCheck: {
          enabled: true,
          interval: 'on-demand'
        },
        performance: {
          enabled: performanceValidator.isMonitoring,
          interval: performanceValidator.config.monitoring.interval
        },
        alerts: {
          email: alertManager.config.email.enabled,
          slack: alertManager.config.slack.enabled
        }
      },
      environment: process.env.NODE_ENV,
      version: process.env.npm_package_version || 'unknown',
      timestamp: new Date().toISOString()
    };
    
    res.json(config);
    
  } catch (error) {
    logger.error('Failed to get configuration', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get configuration',
      error: error.message
    });
  }
});

/**
 * Test alert endpoint (for testing alert system)
 */
router.post('/alerts/test', async (req, res) => {
  try {
    const { severity = 'info', message = 'Test alert' } = req.body;
    
    const testAlert = {
      type: 'test-alert',
      severity,
      message,
      details: {
        triggeredBy: req.ip,
        timestamp: new Date().toISOString(),
        test: true
      },
      source: 'api-test'
    };
    
    await alertManager.processAlert(alertManager.createAlert(testAlert));
    
    logger.info('Test alert generated', testAlert);
    
    res.json({
      status: 'success',
      message: 'Test alert generated',
      alert: testAlert
    });
    
  } catch (error) {
    logger.error('Failed to generate test alert', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to generate test alert',
      error: error.message
    });
  }
});

/**
 * Metrics export endpoint (Prometheus format)
 */
router.get('/metrics/prometheus', async (req, res) => {
  try {
    const health = healthCheck.getHealthStatus();
    const alerts = alertManager.getActiveAlerts();
    const performance = performanceValidator.getPerformanceMetrics();
    
    const metrics = [];
    
    // Health metrics
    metrics.push(`# HELP focusmate_logging_health_status Health status of logging system (1=healthy, 0=unhealthy)`);
    metrics.push(`# TYPE focusmate_logging_health_status gauge`);
    metrics.push(`focusmate_logging_health_status ${health.status === 'healthy' ? 1 : 0}`);
    
    // Alert metrics
    metrics.push(`# HELP focusmate_logging_active_alerts Number of active alerts`);
    metrics.push(`# TYPE focusmate_logging_active_alerts gauge`);
    metrics.push(`focusmate_logging_active_alerts ${alerts.length}`);
    
    // Memory metrics
    const memory = process.memoryUsage();
    metrics.push(`# HELP focusmate_logging_memory_usage_bytes Memory usage in bytes`);
    metrics.push(`# TYPE focusmate_logging_memory_usage_bytes gauge`);
    metrics.push(`focusmate_logging_memory_usage_bytes ${memory.heapUsed}`);
    
    // Uptime metrics
    metrics.push(`# HELP focusmate_logging_uptime_seconds Uptime in seconds`);
    metrics.push(`# TYPE focusmate_logging_uptime_seconds counter`);
    metrics.push(`focusmate_logging_uptime_seconds ${Math.round(process.uptime())}`);
    
    res.set('Content-Type', 'text/plain');
    res.send(metrics.join('\n') + '\n');
    
  } catch (error) {
    logger.error('Failed to export Prometheus metrics', error);
    res.status(500).send('# Error exporting metrics\n');
  }
});

/**
 * Error handler for monitoring routes
 */
router.use((error, req, res, next) => {
  logger.error('Monitoring route error', error, {
    path: req.path,
    method: req.method,
    ip: req.ip
  });
  
  res.status(500).json({
    status: 'error',
    message: 'Internal monitoring error',
    path: req.path,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;