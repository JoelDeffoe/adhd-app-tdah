const logger = require('./logger');
const { createTimer } = require('../utils/logUtils');

/**
 * Enhanced Firestore logging service
 */
class FirestoreLogger {
  constructor() {
    this.slowQueryThreshold = 1000; // 1 second
    this.connectionStatus = 'unknown';
    this.queryCount = 0;
    this.errorCount = 0;
  }

  /**
   * Log database connection status
   */
  logConnectionStatus(status, details = {}) {
    this.connectionStatus = status;
    logger.info('Firestore connection status', {
      status,
      timestamp: new Date().toISOString(),
      ...details
    });
  }

  /**
   * Log query performance with detailed metrics
   */
  logQuery(operation, collection, duration, details = {}) {
    this.queryCount++;
    
    const logData = {
      operation,
      collection,
      duration: `${duration}ms`,
      queryCount: this.queryCount,
      isSlowQuery: duration > this.slowQueryThreshold,
      timestamp: new Date().toISOString(),
      ...details
    };

    if (duration > this.slowQueryThreshold) {
      logger.warn('Slow Firestore query detected', logData);
    } else {
      logger.info('Firestore query executed', logData);
    }

    // Log performance metrics
    logger.performance('firestore_query', {
      duration,
      operation,
      collection,
      isSlowQuery: duration > this.slowQueryThreshold
    });
  }

  /**
   * Log query errors with context
   */
  logQueryError(operation, collection, error, duration, details = {}) {
    this.errorCount++;
    
    logger.error('Firestore query failed', error, {
      operation,
      collection,
      duration: `${duration}ms`,
      errorCount: this.errorCount,
      timestamp: new Date().toISOString(),
      ...details
    });
  }

  /**
   * Log batch operations
   */
  logBatchOperation(operations, duration, details = {}) {
    logger.info('Firestore batch operation', {
      operationCount: operations.length,
      operations: operations.map(op => ({
        type: op.type,
        collection: op.collection,
        documentId: op.documentId
      })),
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
      ...details
    });
  }

  /**
   * Log transaction operations
   */
  logTransaction(operations, duration, success, details = {}) {
    const logLevel = success ? 'info' : 'error';
    const message = success ? 'Firestore transaction completed' : 'Firestore transaction failed';
    
    logger[logLevel](message, {
      operationCount: operations.length,
      operations: operations.map(op => ({
        type: op.type,
        collection: op.collection,
        documentId: op.documentId
      })),
      duration: `${duration}ms`,
      success,
      timestamp: new Date().toISOString(),
      ...details
    });
  }

  /**
   * Get database statistics
   */
  getStatistics() {
    return {
      connectionStatus: this.connectionStatus,
      totalQueries: this.queryCount,
      totalErrors: this.errorCount,
      errorRate: this.queryCount > 0 ? (this.errorCount / this.queryCount) * 100 : 0,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Log database statistics periodically
   */
  logStatistics() {
    const stats = this.getStatistics();
    logger.info('Firestore statistics', stats);
    
    // Reset counters for next period
    this.queryCount = 0;
    this.errorCount = 0;
  }
}

// Create singleton instance
const firestoreLogger = new FirestoreLogger();

// Log statistics every 5 minutes
setInterval(() => {
  firestoreLogger.logStatistics();
}, 5 * 60 * 1000);

/**
 * Enhanced database wrapper with comprehensive logging
 */
function createEnhancedDatabaseWrapper(db) {
  // Log initial connection
  firestoreLogger.logConnectionStatus('connected', {
    projectId: db._settings?.projectId || 'unknown'
  });

  // Wrap collection method
  const originalCollection = db.collection;
  db.collection = function(collectionName) {
    const collection = originalCollection.call(this, collectionName);
    
    // Wrap query methods
    const originalGet = collection.get;
    const originalAdd = collection.add;
    const originalDoc = collection.doc;
    const originalWhere = collection.where;
    const originalOrderBy = collection.orderBy;
    const originalLimit = collection.limit;

    // Enhanced get method with detailed logging
    collection.get = async function(...args) {
      const timer = createTimer();
      try {
        const result = await originalGet.apply(this, args);
        const metrics = timer.end('collection.get');
        
        firestoreLogger.logQuery('collection.get', collectionName, metrics.duration, {
          resultSize: result.size || result.docs?.length || 0,
          isEmpty: result.empty,
          fromCache: result.metadata?.fromCache || false
        });
        
        return result;
      } catch (error) {
        const metrics = timer.end('collection.get');
        firestoreLogger.logQueryError('collection.get', collectionName, error, metrics.duration);
        throw error;
      }
    };

    // Enhanced add method
    collection.add = async function(data) {
      const timer = createTimer();
      try {
        const result = await originalAdd.call(this, data);
        const metrics = timer.end('collection.add');
        
        firestoreLogger.logQuery('collection.add', collectionName, metrics.duration, {
          documentId: result.id,
          dataSize: JSON.stringify(data).length
        });
        
        return result;
      } catch (error) {
        const metrics = timer.end('collection.add');
        firestoreLogger.logQueryError('collection.add', collectionName, error, metrics.duration, {
          dataSize: JSON.stringify(data).length
        });
        throw error;
      }
    };

    // Enhanced where method (returns new collection with logging)
    collection.where = function(field, operator, value) {
      const newCollection = originalWhere.call(this, field, operator, value);
      return wrapCollectionMethods(newCollection, collectionName + `[where:${field}${operator}${value}]`);
    };

    // Enhanced orderBy method
    collection.orderBy = function(field, direction) {
      const newCollection = originalOrderBy.call(this, field, direction);
      return wrapCollectionMethods(newCollection, collectionName + `[orderBy:${field}:${direction}]`);
    };

    // Enhanced limit method
    collection.limit = function(limitValue) {
      const newCollection = originalLimit.call(this, limitValue);
      return wrapCollectionMethods(newCollection, collectionName + `[limit:${limitValue}]`);
    };

    // Enhanced document method
    collection.doc = function(documentId) {
      const doc = originalDoc.call(this, documentId);
      return wrapDocumentMethods(doc, collectionName, documentId);
    };

    return collection;
  };

  // Wrap batch operations
  const originalBatch = db.batch;
  db.batch = function() {
    const batch = originalBatch.call(this);
    const operations = [];
    
    const originalSet = batch.set;
    const originalUpdate = batch.update;
    const originalDelete = batch.delete;
    const originalCommit = batch.commit;

    batch.set = function(docRef, data, options) {
      operations.push({
        type: 'set',
        collection: docRef.parent.id,
        documentId: docRef.id,
        hasOptions: !!options
      });
      return originalSet.call(this, docRef, data, options);
    };

    batch.update = function(docRef, data) {
      operations.push({
        type: 'update',
        collection: docRef.parent.id,
        documentId: docRef.id
      });
      return originalUpdate.call(this, docRef, data);
    };

    batch.delete = function(docRef) {
      operations.push({
        type: 'delete',
        collection: docRef.parent.id,
        documentId: docRef.id
      });
      return originalDelete.call(this, docRef);
    };

    batch.commit = async function() {
      const timer = createTimer();
      try {
        const result = await originalCommit.call(this);
        const metrics = timer.end('batch.commit');
        
        firestoreLogger.logBatchOperation(operations, metrics.duration, {
          success: true
        });
        
        return result;
      } catch (error) {
        const metrics = timer.end('batch.commit');
        firestoreLogger.logQueryError('batch.commit', 'batch', error, metrics.duration, {
          operationCount: operations.length
        });
        throw error;
      }
    };

    return batch;
  };

  return db;
}

/**
 * Helper function to wrap collection methods for chained queries
 */
function wrapCollectionMethods(collection, collectionName) {
  const originalGet = collection.get;
  
  collection.get = async function(...args) {
    const timer = createTimer();
    try {
      const result = await originalGet.apply(this, args);
      const metrics = timer.end('collection.get');
      
      firestoreLogger.logQuery('collection.get', collectionName, metrics.duration, {
        resultSize: result.size || result.docs?.length || 0,
        isEmpty: result.empty,
        fromCache: result.metadata?.fromCache || false
      });
      
      return result;
    } catch (error) {
      const metrics = timer.end('collection.get');
      firestoreLogger.logQueryError('collection.get', collectionName, error, metrics.duration);
      throw error;
    }
  };

  return collection;
}

/**
 * Helper function to wrap document methods
 */
function wrapDocumentMethods(doc, collectionName, documentId) {
  const originalGet = doc.get;
  const originalSet = doc.set;
  const originalUpdate = doc.update;
  const originalDelete = doc.delete;

  doc.get = async function(...args) {
    const timer = createTimer();
    try {
      const result = await originalGet.apply(this, args);
      const metrics = timer.end('document.get');
      
      firestoreLogger.logQuery('document.get', collectionName, metrics.duration, {
        documentId,
        exists: result.exists,
        fromCache: result.metadata?.fromCache || false
      });
      
      return result;
    } catch (error) {
      const metrics = timer.end('document.get');
      firestoreLogger.logQueryError('document.get', collectionName, error, metrics.duration, {
        documentId
      });
      throw error;
    }
  };

  doc.set = async function(data, options) {
    const timer = createTimer();
    try {
      const result = await originalSet.call(this, data, options);
      const metrics = timer.end('document.set');
      
      firestoreLogger.logQuery('document.set', collectionName, metrics.duration, {
        documentId,
        merge: options?.merge || false,
        dataSize: JSON.stringify(data).length
      });
      
      return result;
    } catch (error) {
      const metrics = timer.end('document.set');
      firestoreLogger.logQueryError('document.set', collectionName, error, metrics.duration, {
        documentId,
        dataSize: JSON.stringify(data).length
      });
      throw error;
    }
  };

  doc.update = async function(data) {
    const timer = createTimer();
    try {
      const result = await originalUpdate.call(this, data);
      const metrics = timer.end('document.update');
      
      firestoreLogger.logQuery('document.update', collectionName, metrics.duration, {
        documentId,
        updateFields: Object.keys(data).length
      });
      
      return result;
    } catch (error) {
      const metrics = timer.end('document.update');
      firestoreLogger.logQueryError('document.update', collectionName, error, metrics.duration, {
        documentId
      });
      throw error;
    }
  };

  doc.delete = async function() {
    const timer = createTimer();
    try {
      const result = await originalDelete.call(this);
      const metrics = timer.end('document.delete');
      
      firestoreLogger.logQuery('document.delete', collectionName, metrics.duration, {
        documentId
      });
      
      return result;
    } catch (error) {
      const metrics = timer.end('document.delete');
      firestoreLogger.logQueryError('document.delete', collectionName, error, metrics.duration, {
        documentId
      });
      throw error;
    }
  };

  return doc;
}

module.exports = {
  FirestoreLogger,
  firestoreLogger,
  createEnhancedDatabaseWrapper
};