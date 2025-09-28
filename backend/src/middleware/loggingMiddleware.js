const logger = require('../services/logger');
const { generateCorrelationId, extractRequestInfo, extractResponseInfo } = require('../utils/logUtils');

/**
 * Middleware to add correlation ID to requests
 */
function correlationIdMiddleware(req, res, next) {
  req.correlationId = generateCorrelationId();
  res.setHeader('X-Correlation-ID', req.correlationId);
  next();
}

/**
 * Middleware to log incoming requests
 */
function requestLoggingMiddleware(req, res, next) {
  // Skip logging for health check endpoints
  if (req.url === '/health' || req.url === '/') {
    return next();
  }

  // Log the incoming request
  logger.request(req, {
    headers: {
      'user-agent': req.get('User-Agent'),
      'content-type': req.get('Content-Type'),
      'content-length': req.get('Content-Length')
    }
  });

  next();
}

/**
 * Middleware to log outgoing responses
 */
function responseLoggingMiddleware(req, res, next) {
  const startTime = Date.now();

  // Override res.json to capture response data
  const originalJson = res.json;
  res.json = function(data) {
    res.locals.responseBody = data;
    return originalJson.call(this, data);
  };

  // Override res.send to capture response data
  const originalSend = res.send;
  res.send = function(data) {
    res.locals.responseBody = data;
    return originalSend.call(this, data);
  };

  // Log response when request finishes
  res.on('finish', () => {
    // Skip logging for health check endpoints
    if (req.url === '/health' || req.url === '/') {
      return;
    }

    const duration = Date.now() - startTime;
    
    // Log the response
    logger.response(req, res, duration, {
      responseSize: res.get('Content-Length') || 0
    });

    // Log slow requests as warnings
    if (duration > 1000) {
      logger.warn('Slow request detected', {
        method: req.method,
        url: req.url,
        duration: `${duration}ms`,
        correlationId: req.correlationId,
        userId: req.user?.uid || 'anonymous'
      });
    }
  });

  next();
}

/**
 * Error logging middleware
 */
function errorLoggingMiddleware(error, req, res, next) {
  // Log the error with context
  logger.error('Request error occurred', error, {
    method: req.method,
    url: req.url,
    correlationId: req.correlationId,
    userId: req.user?.uid || 'anonymous',
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    body: req.body,
    query: req.query,
    params: req.params
  });

  // Continue with error handling
  next(error);
}

/**
 * Middleware to log authentication events
 */
function authLoggingMiddleware(req, res, next) {
  const originalNext = next;
  
  next = function(error) {
    if (error) {
      // Log authentication failure
      logger.warn('Authentication failed', {
        method: req.method,
        url: req.url,
        correlationId: req.correlationId,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        error: {
          name: error.name,
          message: error.message
        }
      });
    } else if (req.user) {
      // Log successful authentication
      logger.info('User authenticated', {
        method: req.method,
        url: req.url,
        correlationId: req.correlationId,
        userId: req.user.uid,
        userEmail: req.user.email,
        ip: req.ip
      });
    }
    
    originalNext(error);
  };

  next();
}

/**
 * Middleware to log database operations
 */
function createDatabaseLoggingWrapper(db) {
  // This is a simplified wrapper - in a real implementation,
  // you might want to use a more sophisticated approach
  const originalCollection = db.collection;
  
  db.collection = function(collectionName) {
    const collection = originalCollection.call(this, collectionName);
    
    // Wrap common methods
    const originalGet = collection.get;
    const originalAdd = collection.add;
    const originalDoc = collection.doc;
    
    collection.get = async function(...args) {
      const startTime = Date.now();
      try {
        const result = await originalGet.apply(this, args);
        const duration = Date.now() - startTime;
        
        logger.database('collection.get', duration, {
          collection: collectionName,
          resultSize: result.size || result.docs?.length || 0
        });
        
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.error('Database operation failed', error, {
          operation: 'collection.get',
          collection: collectionName,
          duration: `${duration}ms`
        });
        throw error;
      }
    };
    
    collection.add = async function(data) {
      const startTime = Date.now();
      try {
        const result = await originalAdd.call(this, data);
        const duration = Date.now() - startTime;
        
        logger.database('collection.add', duration, {
          collection: collectionName,
          documentId: result.id
        });
        
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.error('Database operation failed', error, {
          operation: 'collection.add',
          collection: collectionName,
          duration: `${duration}ms`
        });
        throw error;
      }
    };
    
    // Wrap document operations
    collection.doc = function(documentId) {
      const doc = originalDoc.call(this, documentId);
      
      const originalDocGet = doc.get;
      const originalDocSet = doc.set;
      const originalDocUpdate = doc.update;
      const originalDocDelete = doc.delete;
      
      doc.get = async function(...args) {
        const startTime = Date.now();
        try {
          const result = await originalDocGet.apply(this, args);
          const duration = Date.now() - startTime;
          
          logger.database('document.get', duration, {
            collection: collectionName,
            documentId: documentId,
            exists: result.exists
          });
          
          return result;
        } catch (error) {
          const duration = Date.now() - startTime;
          logger.error('Database operation failed', error, {
            operation: 'document.get',
            collection: collectionName,
            documentId: documentId,
            duration: `${duration}ms`
          });
          throw error;
        }
      };
      
      doc.set = async function(data, options) {
        const startTime = Date.now();
        try {
          const result = await originalDocSet.call(this, data, options);
          const duration = Date.now() - startTime;
          
          logger.database('document.set', duration, {
            collection: collectionName,
            documentId: documentId,
            merge: options?.merge || false
          });
          
          return result;
        } catch (error) {
          const duration = Date.now() - startTime;
          logger.error('Database operation failed', error, {
            operation: 'document.set',
            collection: collectionName,
            documentId: documentId,
            duration: `${duration}ms`
          });
          throw error;
        }
      };
      
      doc.update = async function(data) {
        const startTime = Date.now();
        try {
          const result = await originalDocUpdate.call(this, data);
          const duration = Date.now() - startTime;
          
          logger.database('document.update', duration, {
            collection: collectionName,
            documentId: documentId
          });
          
          return result;
        } catch (error) {
          const duration = Date.now() - startTime;
          logger.error('Database operation failed', error, {
            operation: 'document.update',
            collection: collectionName,
            documentId: documentId,
            duration: `${duration}ms`
          });
          throw error;
        }
      };
      
      doc.delete = async function() {
        const startTime = Date.now();
        try {
          const result = await originalDocDelete.call(this);
          const duration = Date.now() - startTime;
          
          logger.database('document.delete', duration, {
            collection: collectionName,
            documentId: documentId
          });
          
          return result;
        } catch (error) {
          const duration = Date.now() - startTime;
          logger.error('Database operation failed', error, {
            operation: 'document.delete',
            collection: collectionName,
            documentId: documentId,
            duration: `${duration}ms`
          });
          throw error;
        }
      };
      
      return doc;
    };
    
    return collection;
  };
  
  return db;
}

module.exports = {
  correlationIdMiddleware,
  requestLoggingMiddleware,
  responseLoggingMiddleware,
  errorLoggingMiddleware,
  authLoggingMiddleware,
  createDatabaseLoggingWrapper
};