const admin = require('firebase-admin');
const logger = require('../services/logger');

/**
 * Flexible authentication middleware that handles:
 * - Firebase authenticated users
 * - Guest users (anonymous)
 * - Offline users
 */
const flexibleAuthMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const idToken = authHeader?.split('Bearer ')[1];

  // If no token provided, treat as anonymous/guest user
  if (!idToken) {
    logger.info('Request without token - treating as anonymous user', {
      method: req.method,
      url: req.url,
      correlationId: req.correlationId,
      ip: req.ip
    });
    
    req.user = {
      uid: 'anonymous',
      isAnonymous: true,
      isGuest: true
    };
    
    return next();
  }

  try {
    // Try to verify the Firebase token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = {
      ...decodedToken,
      isAnonymous: false,
      isGuest: false
    };
    
    logger.info('Firebase token verified successfully', {
      uid: decodedToken.uid,
      method: req.method,
      url: req.url,
      correlationId: req.correlationId
    });
    
    next();
  } catch (error) {
    // If token verification fails, check if it's a guest token format
    if (idToken.startsWith('guest_') || idToken.startsWith('offline_')) {
      logger.info('Guest/offline token detected', {
        tokenPrefix: idToken.substring(0, 10),
        method: req.method,
        url: req.url,
        correlationId: req.correlationId,
        ip: req.ip
      });
      
      req.user = {
        uid: idToken,
        isAnonymous: true,
        isGuest: true,
        isOffline: idToken.startsWith('offline_')
      };
      
      return next();
    }

    // Log the error but don't fail the request for analytics endpoints
    logger.warn('Token verification failed - treating as anonymous', {
      error: error.message,
      method: req.method,
      url: req.url,
      correlationId: req.correlationId,
      ip: req.ip
    });

    // For analytics endpoints, allow anonymous access
    if (req.url.includes('/analytics')) {
      req.user = {
        uid: 'anonymous',
        isAnonymous: true,
        isGuest: true
      };
      return next();
    }

    // For other endpoints, return 403
    return res.status(403).json({ 
      message: 'Invalid token', 
      error: error.message,
      code: 'INVALID_TOKEN'
    });
  }
};

/**
 * Strict authentication middleware - requires valid Firebase token
 */
const strictAuthMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const idToken = authHeader?.split('Bearer ')[1];

  if (!idToken) {
    logger.warn('Authentication required but no token provided', {
      method: req.method,
      url: req.url,
      correlationId: req.correlationId,
      ip: req.ip
    });
    return res.status(401).json({ 
      message: 'Authentication required', 
      code: 'NO_TOKEN' 
    });
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = {
      ...decodedToken,
      isAnonymous: false,
      isGuest: false
    };
    
    logger.info('Strict authentication successful', {
      uid: decodedToken.uid,
      method: req.method,
      url: req.url,
      correlationId: req.correlationId
    });
    
    next();
  } catch (error) {
    logger.error('Strict authentication failed', error, {
      method: req.method,
      url: req.url,
      correlationId: req.correlationId,
      ip: req.ip
    });
    
    return res.status(403).json({ 
      message: 'Invalid token', 
      error: error.message,
      code: 'INVALID_TOKEN'
    });
  }
};

/**
 * Optional authentication middleware - works with or without token
 */
const optionalAuthMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const idToken = authHeader?.split('Bearer ')[1];

  if (!idToken) {
    req.user = null;
    return next();
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = {
      ...decodedToken,
      isAnonymous: false,
      isGuest: false
    };
  } catch (error) {
    logger.warn('Optional auth token verification failed', {
      error: error.message,
      method: req.method,
      url: req.url
    });
    req.user = null;
  }

  next();
};

module.exports = {
  flexibleAuthMiddleware,
  strictAuthMiddleware,
  optionalAuthMiddleware
};