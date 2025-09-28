// Load environment variables
require('dotenv').config();

const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const OpenAI = require('openai');

// Import logging services
const logger = require('./src/services/logger');
const {
  correlationIdMiddleware,
  requestLoggingMiddleware,
  responseLoggingMiddleware,
  errorLoggingMiddleware,
  authLoggingMiddleware
} = require('./src/middleware/loggingMiddleware');
const { createEnhancedDatabaseWrapper } = require('./src/services/firestoreLogger');
const LogRetentionService = require('./src/services/logRetention');

// Import monitoring routes
const monitoringRoutes = require('./src/routes/monitoring');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Firebase Admin SDK
const serviceAccount = require('./focusmate-76950-firebase-adminsdk-fbsvc-ffa8d01505.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = createEnhancedDatabaseWrapper(admin.firestore());

// Initialize log retention service
const logRetentionService = new LogRetentionService({
  logsDirectory: process.env.LOGS_DIRECTORY || './logs',
  retentionDays: parseInt(process.env.LOG_RETENTION_DAYS) || 30,
  enableAutoPurge: process.env.ENABLE_AUTO_PURGE !== 'false'
});

// Log server startup
logger.info('Server starting up', {
  port: PORT,
  environment: process.env.NODE_ENV || 'development',
  nodeVersion: process.version
});

// Middleware setup
app.use(cors());
app.use(express.json());

// Add logging middleware
app.use(correlationIdMiddleware);
app.use(requestLoggingMiddleware);
app.use(responseLoggingMiddleware);

// Import flexible authentication middleware
const { flexibleAuthMiddleware, strictAuthMiddleware, optionalAuthMiddleware } = require('./src/middleware/flexibleAuth');

// Legacy middleware for backward compatibility
const verifyToken = strictAuthMiddleware;

app.get('/', (req, res) => {
  res.send('FocusMate Backend is running!');
});

// Add monitoring routes
app.use('/api/monitoring', monitoringRoutes);

// Analytics endpoints with flexible authentication
app.get('/api/analytics/monthly', flexibleAuthMiddleware, async (req, res) => {
  try {
    const userId = req.user?.uid || 'anonymous';
    
    logger.info('Analytics request received', {
      userId,
      isAnonymous: req.user?.isAnonymous || false,
      correlationId: req.correlationId
    });

    // For anonymous users, return sample data
    if (req.user?.isAnonymous) {
      return res.status(200).json({
        message: 'Sample analytics data for guest user',
        data: {
          totalTasks: 0,
          completedTasks: 0,
          focusTime: 0,
          streakDays: 0
        },
        isGuest: true
      });
    }

    // For authenticated users, return actual data (placeholder for now)
    res.status(200).json({
      message: 'Monthly analytics data',
      data: {
        totalTasks: 25,
        completedTasks: 18,
        focusTime: 1200, // minutes
        streakDays: 7
      },
      userId
    });
  } catch (error) {
    logger.error('Analytics endpoint error', error, {
      correlationId: req.correlationId,
      userId: req.user?.uid
    });
    res.status(500).json({ 
      message: 'Failed to fetch analytics', 
      error: error.message 
    });
  }
});

// Health check endpoint with database status
app.get('/health', async (req, res) => {
  const { firestoreLogger } = require('./src/services/firestoreLogger');
  
  try {
    // Test database connectivity
    const testRef = db.collection('health').doc('test');
    await testRef.get();
    
    const stats = firestoreLogger.getStatistics();
    
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: {
        status: stats.connectionStatus,
        totalQueries: stats.totalQueries,
        errorRate: stats.errorRate
      },
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.version
      }
    });
  } catch (error) {
    logger.error('Health check failed', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Authentication route (already implemented)
app.post('/api/authenticate', async (req, res) => {
  const { idToken } = req.body;
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;
    res.status(200).json({ message: 'Authenticated successfully', uid });
  } catch (error) {
    logger.error('Error authenticating user', error, {
      correlationId: req.correlationId,
      method: req.method,
      url: req.url
    });
    res.status(401).json({ message: 'Authentication failed', error: error.message });
  }
});

// --- To-Do List API Endpoints ---

// --- To-Do List API Endpoints ---

// Create a new To-Do item
app.post('/api/todos', verifyToken, async (req, res) => {
  try {
    const { title, description, priority, dueDate, duration, timerEnabled, timeLeft, timerStarted, completedAt } = req.body;
    const userId = req.user.uid;

    if (!title) {
      return res.status(400).json({ message: 'Title is required.' });
    }

    const newTodoRef = db.collection('users').doc(userId).collection('todos').doc();
    await newTodoRef.set({
      id: newTodoRef.id,
      title,
      description: description || '',
      completed: false,
      priority: priority || 'low',
      dueDate: dueDate || null,
      duration: duration || null,
      timerEnabled: timerEnabled || false,
      timeLeft: timeLeft || null,
      timerStarted: timerStarted || false,
      completedAt: completedAt || null, // For analytics
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(201).json({ message: 'To-Do item created successfully', todoId: newTodoRef.id });
  } catch (error) {
    logger.error('Error creating To-Do item', error, {
      correlationId: req.correlationId,
      userId: req.user?.uid,
      method: req.method,
      url: req.url,
      requestBody: req.body
    });
    res.status(500).json({ message: 'Failed to create To-Do item', error: error.message });
  }
});

// Get all To-Do items for a user
app.get('/api/todos', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const todosSnapshot = await db.collection('users').doc(userId).collection('todos').orderBy('createdAt', 'desc').get();
    const todos = todosSnapshot.docs.map(doc => doc.data());
    res.status(200).json(todos);
  } catch (error) {
    logger.error('Error fetching To-Do items', error, {
      correlationId: req.correlationId,
      userId: req.user?.uid,
      method: req.method,
      url: req.url
    });
    res.status(500).json({ message: 'Failed to fetch To-Do items', error: error.message });
  }
});

// Update a To-Do item
app.put('/api/todos/:id', verifyToken, async (req, res) => {
  try {
    const todoId = req.params.id;
    const userId = req.user.uid;
    const updates = req.body;

    await db.collection('users').doc(userId).collection('todos').doc(todoId).update(updates);
    res.status(200).json({ message: 'To-Do item updated successfully' });
  } catch (error) {
    console.error('Error updating To-Do item:', error);
    res.status(500).json({ message: 'Failed to update To-Do item', error: error.message });
  }
});

// Delete a To-Do item
app.delete('/api/todos/:id', verifyToken, async (req, res) => {
  try {
    const todoId = req.params.id;
    const userId = req.user.uid;

    await db.collection('users').doc(userId).collection('todos').doc(todoId).delete();
    res.status(200).json({ message: 'To-Do item deleted successfully' });
  } catch (error) {
    console.error('Error deleting To-Do item:', error);
    res.status(500).json({ message: 'Failed to delete To-Do item', error: error.message });
  }
});

// --- Enhanced Routines API Endpoints ---

// Create a new Routine with complex data structure
app.post('/api/routines', verifyToken, async (req, res) => {
  try {
    const routineData = req.body;
    const userId = req.user.uid;

    // Validate required fields
    if (!routineData.title || !routineData.tasks || !Array.isArray(routineData.tasks)) {
      return res.status(400).json({ message: 'Title and tasks array are required.' });
    }

    // Validate tasks
    for (const task of routineData.tasks) {
      if (!task.title || !task.estimatedDuration) {
        return res.status(400).json({ message: 'Each task must have a title and estimated duration.' });
      }
    }

    const newRoutineRef = db.collection('users').doc(userId).collection('routines').doc();

    // Create routine with full data structure
    const routine = {
      id: newRoutineRef.id,
      userId,
      title: routineData.title,
      description: routineData.description || '',
      tasks: routineData.tasks.map(task => ({
        id: task.id || generateTaskId(),
        title: task.title,
        description: task.description || '',
        estimatedDuration: task.estimatedDuration,
        bufferTime: task.bufferTime || 0,
        startTime: task.startTime || '',
        endTime: task.endTime || '',
        completed: false,
        focusSessionId: task.focusSessionId || null,
        todoId: task.todoId || null
      })),
      scheduleType: routineData.scheduleType || 'daily',
      scheduleDays: routineData.scheduleDays || [],
      scheduleDate: routineData.scheduleDate || null,
      customSchedule: routineData.customSchedule || null,
      startTime: routineData.startTime || '',
      endTime: routineData.endTime || '',
      priority: routineData.priority || 'medium',
      isTemplate: routineData.isTemplate || false,
      templateCategory: routineData.templateCategory || null,
      calendarSync: {
        enabled: routineData.calendarSync?.enabled || false,
        calendarId: routineData.calendarSync?.calendarId || null,
        eventIds: routineData.calendarSync?.eventIds || [],
        autoReschedule: routineData.calendarSync?.autoReschedule || false,
        privacyLevel: routineData.calendarSync?.privacyLevel || 'full'
      },
      aiGenerated: routineData.aiGenerated || false,
      aiPrompt: routineData.aiPrompt || null,
      analytics: {
        completionRate: 0,
        averageDuration: 0,
        consistencyScore: 0,
        lastCompleted: null,
        totalCompletions: 0,
        skipReasons: [],
        timeAdjustments: []
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await newRoutineRef.set(routine);

    res.status(201).json({
      message: 'Routine created successfully',
      routine: { ...routine, createdAt: new Date(), updatedAt: new Date() }
    });
  } catch (error) {
    console.error('Error creating routine:', error);
    res.status(500).json({ message: 'Failed to create routine', error: error.message });
  }
});

// Get routines with filtering and pagination
app.get('/api/routines', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const {
      scheduleType,
      priority,
      isTemplate,
      templateCategory,
      calendarSyncEnabled,
      searchQuery,
      limit = 50,
      offset = 0,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      includeAnalytics = 'true'
    } = req.query;

    let query = db.collection('users').doc(userId).collection('routines');

    // Apply filters
    if (scheduleType) {
      query = query.where('scheduleType', '==', scheduleType);
    }
    if (priority) {
      query = query.where('priority', '==', priority);
    }
    if (isTemplate !== undefined) {
      query = query.where('isTemplate', '==', isTemplate === 'true');
    }
    if (templateCategory) {
      query = query.where('templateCategory', '==', templateCategory);
    }
    if (calendarSyncEnabled !== undefined) {
      query = query.where('calendarSync.enabled', '==', calendarSyncEnabled === 'true');
    }

    // Apply sorting
    query = query.orderBy(sortBy, sortOrder);

    // Apply pagination
    if (offset > 0) {
      const offsetSnapshot = await query.limit(parseInt(offset)).get();
      if (!offsetSnapshot.empty) {
        const lastDoc = offsetSnapshot.docs[offsetSnapshot.docs.length - 1];
        query = query.startAfter(lastDoc);
      }
    }

    query = query.limit(parseInt(limit));

    const routinesSnapshot = await query.get();
    let routines = routinesSnapshot.docs.map(doc => ({
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate(),
      updatedAt: doc.data().updatedAt?.toDate()
    }));

    // Apply text search filter (client-side for now)
    if (searchQuery) {
      const searchLower = searchQuery.toLowerCase();
      routines = routines.filter(routine =>
        routine.title.toLowerCase().includes(searchLower) ||
        routine.description?.toLowerCase().includes(searchLower) ||
        routine.tasks.some(task =>
          task.title.toLowerCase().includes(searchLower) ||
          task.description?.toLowerCase().includes(searchLower)
        )
      );
    }

    // Optionally exclude analytics for performance
    if (includeAnalytics === 'false') {
      routines = routines.map(routine => {
        const { analytics, ...routineWithoutAnalytics } = routine;
        return routineWithoutAnalytics;
      });
    }

    res.status(200).json({
      routines,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: routinesSnapshot.docs.length === parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching routines:', error);
    res.status(500).json({ message: 'Failed to fetch routines', error: error.message });
  }
});

// Get a specific routine by ID
app.get('/api/routines/:id', verifyToken, async (req, res) => {
  try {
    const routineId = req.params.id;
    const userId = req.user.uid;

    const routineDoc = await db.collection('users').doc(userId).collection('routines').doc(routineId).get();

    if (!routineDoc.exists) {
      return res.status(404).json({ message: 'Routine not found' });
    }

    const routine = {
      ...routineDoc.data(),
      createdAt: routineDoc.data().createdAt?.toDate(),
      updatedAt: routineDoc.data().updatedAt?.toDate()
    };

    res.status(200).json(routine);
  } catch (error) {
    console.error('Error fetching routine:', error);
    res.status(500).json({ message: 'Failed to fetch routine', error: error.message });
  }
});

// Update a routine with complex data structure
app.put('/api/routines/:id', verifyToken, async (req, res) => {
  try {
    const routineId = req.params.id;
    const userId = req.user.uid;
    const updates = req.body;

    // Validate routine exists
    const routineDoc = await db.collection('users').doc(userId).collection('routines').doc(routineId).get();
    if (!routineDoc.exists) {
      return res.status(404).json({ message: 'Routine not found' });
    }

    // Validate tasks if provided
    if (updates.tasks && Array.isArray(updates.tasks)) {
      for (const task of updates.tasks) {
        if (!task.title || !task.estimatedDuration) {
          return res.status(400).json({ message: 'Each task must have a title and estimated duration.' });
        }
      }
    }

    // Prepare update data
    const updateData = {
      ...updates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Ensure task IDs are generated for new tasks
    if (updateData.tasks) {
      updateData.tasks = updateData.tasks.map(task => ({
        ...task,
        id: task.id || generateTaskId()
      }));
    }

    await db.collection('users').doc(userId).collection('routines').doc(routineId).update(updateData);

    // Fetch updated routine
    const updatedDoc = await db.collection('users').doc(userId).collection('routines').doc(routineId).get();
    const updatedRoutine = {
      ...updatedDoc.data(),
      createdAt: updatedDoc.data().createdAt?.toDate(),
      updatedAt: updatedDoc.data().updatedAt?.toDate()
    };

    res.status(200).json({
      message: 'Routine updated successfully',
      routine: updatedRoutine
    });
  } catch (error) {
    console.error('Error updating routine:', error);
    res.status(500).json({ message: 'Failed to update routine', error: error.message });
  }
});

// Delete a routine
app.delete('/api/routines/:id', verifyToken, async (req, res) => {
  try {
    const routineId = req.params.id;
    const userId = req.user.uid;

    // Validate routine exists
    const routineDoc = await db.collection('users').doc(userId).collection('routines').doc(routineId).get();
    if (!routineDoc.exists) {
      return res.status(404).json({ message: 'Routine not found' });
    }

    await db.collection('users').doc(userId).collection('routines').doc(routineId).delete();
    res.status(200).json({ message: 'Routine deleted successfully' });
  } catch (error) {
    console.error('Error deleting routine:', error);
    res.status(500).json({ message: 'Failed to delete routine', error: error.message });
  }
});

// Track routine task completion
app.post('/api/routines/:id/tasks/:taskId/complete', verifyToken, async (req, res) => {
  try {
    const { id: routineId, taskId } = req.params;
    const userId = req.user.uid;
    const { actualDuration, feedback, mood, energyLevel } = req.body;

    const routineRef = db.collection('users').doc(userId).collection('routines').doc(routineId);
    const routineDoc = await routineRef.get();

    if (!routineDoc.exists) {
      return res.status(404).json({ message: 'Routine not found' });
    }

    const routine = routineDoc.data();
    const taskIndex = routine.tasks.findIndex(task => task.id === taskId);

    if (taskIndex === -1) {
      return res.status(404).json({ message: 'Task not found' });
    }

    // Update task completion
    routine.tasks[taskIndex].completed = true;
    routine.tasks[taskIndex].completedAt = new Date();

    // Update analytics
    const completedTasks = routine.tasks.filter(task => task.completed).length;
    const totalTasks = routine.tasks.length;

    routine.analytics.completionRate = (completedTasks / totalTasks) * 100;
    routine.analytics.totalCompletions += 1;
    routine.analytics.lastCompleted = new Date();

    // Add time adjustment if provided
    if (actualDuration && actualDuration !== routine.tasks[taskIndex].estimatedDuration) {
      routine.analytics.timeAdjustments.push({
        taskId,
        originalDuration: routine.tasks[taskIndex].estimatedDuration,
        actualDuration,
        date: new Date(),
        reason: feedback?.reason || null
      });
    }

    await routineRef.update({
      tasks: routine.tasks,
      analytics: routine.analytics,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Log completion history
    await db.collection('users').doc(userId).collection('routineHistory').add({
      routineId,
      taskId,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      actualDuration: actualDuration || routine.tasks[taskIndex].estimatedDuration,
      feedback: feedback || null,
      mood: mood || null,
      energyLevel: energyLevel || null
    });

    res.status(200).json({ message: 'Task completed successfully' });
  } catch (error) {
    console.error('Error completing task:', error);
    res.status(500).json({ message: 'Failed to complete task', error: error.message });
  }
});

// Skip routine task with reason
app.post('/api/routines/:id/tasks/:taskId/skip', verifyToken, async (req, res) => {
  try {
    const { id: routineId, taskId } = req.params;
    const userId = req.user.uid;
    const { reason, comment } = req.body;

    const routineRef = db.collection('users').doc(userId).collection('routines').doc(routineId);
    const routineDoc = await routineRef.get();

    if (!routineDoc.exists) {
      return res.status(404).json({ message: 'Routine not found' });
    }

    const routine = routineDoc.data();

    // Add skip reason to analytics
    if (reason && !routine.analytics.skipReasons.includes(reason)) {
      routine.analytics.skipReasons.push(reason);
    }

    await routineRef.update({
      analytics: routine.analytics,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Log skip history
    await db.collection('users').doc(userId).collection('routineHistory').add({
      routineId,
      taskId,
      skippedAt: admin.firestore.FieldValue.serverTimestamp(),
      skipReason: reason || 'No reason provided',
      comment: comment || null
    });

    res.status(200).json({ message: 'Task skipped successfully' });
  } catch (error) {
    console.error('Error skipping task:', error);
    res.status(500).json({ message: 'Failed to skip task', error: error.message });
  }
});

// --- Routine Templates API Endpoints ---

// Get all routine templates (global and user-specific)
app.get('/api/routine-templates', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { category, includeUserTemplates = 'true' } = req.query;

    let templates = [];

    // Get global templates
    let globalQuery = db.collection('globalTemplates');
    if (category) {
      globalQuery = globalQuery.where('templateCategory', '==', category);
    }

    const globalTemplatesSnapshot = await globalQuery.get();
    const globalTemplates = globalTemplatesSnapshot.docs.map(doc => ({
      ...doc.data(),
      id: doc.id,
      isGlobal: true,
      createdAt: doc.data().createdAt?.toDate(),
      updatedAt: doc.data().updatedAt?.toDate()
    }));

    templates = [...globalTemplates];

    // Get user-specific templates if requested
    if (includeUserTemplates === 'true') {
      let userQuery = db.collection('users').doc(userId).collection('routines').where('isTemplate', '==', true);
      if (category) {
        userQuery = userQuery.where('templateCategory', '==', category);
      }

      const userTemplatesSnapshot = await userQuery.get();
      const userTemplates = userTemplatesSnapshot.docs.map(doc => ({
        ...doc.data(),
        isGlobal: false,
        createdAt: doc.data().createdAt?.toDate(),
        updatedAt: doc.data().updatedAt?.toDate()
      }));

      templates = [...templates, ...userTemplates];
    }

    // Sort by category and title
    templates.sort((a, b) => {
      if (a.templateCategory !== b.templateCategory) {
        return a.templateCategory.localeCompare(b.templateCategory);
      }
      return a.title.localeCompare(b.title);
    });

    res.status(200).json(templates);
  } catch (error) {
    console.error('Error fetching routine templates:', error);
    res.status(500).json({ message: 'Failed to fetch routine templates', error: error.message });
  }
});

// Save routine as template
app.post('/api/routine-templates', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { routineId, templateName, templateCategory, isGlobal = false } = req.body;

    if (!routineId || !templateName || !templateCategory) {
      return res.status(400).json({ message: 'Routine ID, template name, and category are required.' });
    }

    // Get the original routine
    const routineDoc = await db.collection('users').doc(userId).collection('routines').doc(routineId).get();
    if (!routineDoc.exists) {
      return res.status(404).json({ message: 'Routine not found' });
    }

    const routine = routineDoc.data();

    // Create template data
    const templateData = {
      ...routine,
      title: templateName,
      isTemplate: true,
      templateCategory,
      originalRoutineId: routineId,
      createdBy: userId,
      // Reset analytics for template
      analytics: {
        completionRate: 0,
        averageDuration: 0,
        consistencyScore: 0,
        lastCompleted: null,
        totalCompletions: 0,
        skipReasons: [],
        timeAdjustments: []
      },
      // Reset task completion status
      tasks: routine.tasks.map(task => ({
        ...task,
        completed: false,
        completedAt: null
      })),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    let templateRef;
    if (isGlobal) {
      // Save as global template (requires admin privileges - simplified for now)
      templateRef = db.collection('globalTemplates').doc();
    } else {
      // Save as user template
      templateRef = db.collection('users').doc(userId).collection('routines').doc();
    }

    templateData.id = templateRef.id;
    await templateRef.set(templateData);

    res.status(201).json({
      message: 'Template saved successfully',
      templateId: templateRef.id,
      template: { ...templateData, createdAt: new Date(), updatedAt: new Date() }
    });
  } catch (error) {
    console.error('Error saving routine template:', error);
    res.status(500).json({ message: 'Failed to save routine template', error: error.message });
  }
});

// Create routine from template
app.post('/api/routine-templates/:templateId/create', verifyToken, async (req, res) => {
  try {
    const templateId = req.params.templateId;
    const userId = req.user.uid;
    const customizations = req.body;

    // Try to get template from global templates first
    let templateDoc = await db.collection('globalTemplates').doc(templateId).get();
    let isGlobalTemplate = true;

    // If not found in global, try user templates
    if (!templateDoc.exists) {
      templateDoc = await db.collection('users').doc(userId).collection('routines').doc(templateId).get();
      isGlobalTemplate = false;
    }

    if (!templateDoc.exists) {
      return res.status(404).json({ message: 'Template not found' });
    }

    const template = templateDoc.data();

    // Create new routine from template
    const newRoutineRef = db.collection('users').doc(userId).collection('routines').doc();
    const newRoutine = {
      ...template,
      id: newRoutineRef.id,
      userId,
      isTemplate: false,
      templateId: templateId,
      originalTemplateId: templateId,
      isFromGlobalTemplate: isGlobalTemplate,
      // Apply customizations
      ...customizations,
      // Reset analytics
      analytics: {
        completionRate: 0,
        averageDuration: 0,
        consistencyScore: 0,
        lastCompleted: null,
        totalCompletions: 0,
        skipReasons: [],
        timeAdjustments: []
      },
      // Reset task completion status
      tasks: (customizations.tasks || template.tasks).map(task => ({
        ...task,
        id: task.id || generateTaskId(),
        completed: false,
        completedAt: null
      })),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await newRoutineRef.set(newRoutine);

    res.status(201).json({
      message: 'Routine created from template successfully',
      routine: { ...newRoutine, createdAt: new Date(), updatedAt: new Date() }
    });
  } catch (error) {
    console.error('Error creating routine from template:', error);
    res.status(500).json({ message: 'Failed to create routine from template', error: error.message });
  }
});

// Delete routine template
app.delete('/api/routine-templates/:templateId', verifyToken, async (req, res) => {
  try {
    const templateId = req.params.templateId;
    const userId = req.user.uid;

    // Try user templates first
    const userTemplateDoc = await db.collection('users').doc(userId).collection('routines').doc(templateId).get();

    if (userTemplateDoc.exists) {
      const template = userTemplateDoc.data();
      if (template.isTemplate) {
        await db.collection('users').doc(userId).collection('routines').doc(templateId).delete();
        return res.status(200).json({ message: 'Template deleted successfully' });
      }
    }

    // Check global templates (only if user is the creator)
    const globalTemplateDoc = await db.collection('globalTemplates').doc(templateId).get();
    if (globalTemplateDoc.exists) {
      const template = globalTemplateDoc.data();
      if (template.createdBy === userId) {
        await db.collection('globalTemplates').doc(templateId).delete();
        return res.status(200).json({ message: 'Global template deleted successfully' });
      } else {
        return res.status(403).json({ message: 'Not authorized to delete this template' });
      }
    }

    res.status(404).json({ message: 'Template not found' });
  } catch (error) {
    console.error('Error deleting routine template:', error);
    res.status(500).json({ message: 'Failed to delete routine template', error: error.message });
  }
});

// --- Routine Analytics API Endpoints ---

// Get routine analytics for a specific routine
app.get('/api/routines/:id/analytics', verifyToken, async (req, res) => {
  try {
    const routineId = req.params.id;
    const userId = req.user.uid;
    const { startDate, endDate } = req.query;

    const routineDoc = await db.collection('users').doc(userId).collection('routines').doc(routineId).get();
    if (!routineDoc.exists) {
      return res.status(404).json({ message: 'Routine not found' });
    }

    const routine = routineDoc.data();

    // Get completion history
    let historyQuery = db.collection('users').doc(userId).collection('routineHistory')
      .where('routineId', '==', routineId);

    if (startDate) {
      historyQuery = historyQuery.where('completedAt', '>=', new Date(startDate));
    }
    if (endDate) {
      historyQuery = historyQuery.where('completedAt', '<=', new Date(endDate));
    }

    const historySnapshot = await historyQuery.orderBy('completedAt', 'desc').get();
    const history = historySnapshot.docs.map(doc => ({
      ...doc.data(),
      completedAt: doc.data().completedAt?.toDate(),
      skippedAt: doc.data().skippedAt?.toDate()
    }));

    // Calculate detailed analytics
    const analytics = calculateDetailedAnalytics(routine, history);

    res.status(200).json({
      routineId,
      analytics,
      history: history.slice(0, 50) // Limit history for performance
    });
  } catch (error) {
    console.error('Error fetching routine analytics:', error);
    res.status(500).json({ message: 'Failed to fetch routine analytics', error: error.message });
  }
});

// Get aggregated analytics for all user routines
app.get('/api/routines/analytics/summary', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { startDate, endDate, routineIds } = req.query;

    // Get routines
    let routinesQuery = db.collection('users').doc(userId).collection('routines');
    if (routineIds) {
      const ids = routineIds.split(',');
      routinesQuery = routinesQuery.where('id', 'in', ids);
    }

    const routinesSnapshot = await routinesQuery.get();
    const routines = routinesSnapshot.docs.map(doc => doc.data());

    // Get completion history for all routines
    let historyQuery = db.collection('users').doc(userId).collection('routineHistory');

    if (startDate) {
      historyQuery = historyQuery.where('completedAt', '>=', new Date(startDate));
    }
    if (endDate) {
      historyQuery = historyQuery.where('completedAt', '<=', new Date(endDate));
    }

    const historySnapshot = await historyQuery.get();
    const allHistory = historySnapshot.docs.map(doc => ({
      ...doc.data(),
      completedAt: doc.data().completedAt?.toDate(),
      skippedAt: doc.data().skippedAt?.toDate()
    }));

    // Calculate summary analytics
    const summary = calculateSummaryAnalytics(routines, allHistory);

    res.status(200).json(summary);
  } catch (error) {
    console.error('Error fetching routine analytics summary:', error);
    res.status(500).json({ message: 'Failed to fetch routine analytics summary', error: error.message });
  }
});

// Get routine insights and recommendations
app.get('/api/routines/analytics/insights', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;

    // Get user's routines and history
    const [routinesSnapshot, historySnapshot] = await Promise.all([
      db.collection('users').doc(userId).collection('routines').get(),
      db.collection('users').doc(userId).collection('routineHistory')
        .orderBy('completedAt', 'desc')
        .limit(100)
        .get()
    ]);

    const routines = routinesSnapshot.docs.map(doc => doc.data());
    const history = historySnapshot.docs.map(doc => ({
      ...doc.data(),
      completedAt: doc.data().completedAt?.toDate(),
      skippedAt: doc.data().skippedAt?.toDate()
    }));

    // Generate insights
    const insights = generateRoutineInsights(routines, history);

    res.status(200).json({ insights });
  } catch (error) {
    console.error('Error generating routine insights:', error);
    res.status(500).json({ message: 'Failed to generate routine insights', error: error.message });
  }
});

// --- Journal API Endpoints ---

// Create a new journal entry
app.post('/api/journal', verifyToken, async (req, res) => {
  try {
    const { mood, entry } = req.body;
    const userId = req.user.uid;

    if (!mood || !entry) {
      return res.status(400).json({ message: 'Mood and entry are required.' });
    }

    const newJournalRef = db.collection('users').doc(userId).collection('journal').doc();
    await newJournalRef.set({
      id: newJournalRef.id,
      mood,
      entry,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(201).json({ message: 'Journal entry created successfully', journalId: newJournalRef.id });
  } catch (error) {
    console.error('Error creating journal entry:', error);
    res.status(500).json({ message: 'Failed to create journal entry', error: error.message });
  }
});

// Get all journal entries for a user
app.get('/api/journal', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const journalSnapshot = await db.collection('users').doc(userId).collection('journal').orderBy('createdAt', 'desc').get();
    const journal = journalSnapshot.docs.map(doc => doc.data());
    res.status(200).json(journal);
  } catch (error) {
    console.error('Error fetching journal entries:', error);
    res.status(500).json({ message: 'Failed to fetch journal entries', error: error.message });
  }
});

// Update a journal entry
app.put('/api/journal/:id', verifyToken, async (req, res) => {
  try {
    const journalId = req.params.id;
    const userId = req.user.uid;
    const updates = req.body;

    await db.collection('users').doc(userId).collection('journal').doc(journalId).update(updates);
    res.status(200).json({ message: 'Journal entry updated successfully' });
  } catch (error) {
    console.error('Error updating journal entry:', error);
    res.status(500).json({ message: 'Failed to update journal entry', error: error.message });
  }
});

// Delete a journal entry
app.delete('/api/journal/:id', verifyToken, async (req, res) => {
  try {
    const journalId = req.params.id;
    const userId = req.user.uid;

    await db.collection('users').doc(userId).collection('journal').doc(journalId).delete();
    res.status(200).json({ message: 'Journal entry deleted successfully' });
  } catch (error) {
    console.error('Error deleting journal entry:', error);
    res.status(500).json({ message: 'Failed to delete journal entry', error: error.message });
  }
});

// --- Analytics API Endpoints ---

// Get analytics data for a specific date range
app.get('/api/analytics', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { startDate, endDate, type } = req.query;

    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: 30 days ago
    const end = endDate ? new Date(endDate) : new Date(); // Default: today

    let analytics = {};

    if (type === 'todos' || !type) {
      // Get todos analytics
      const todosSnapshot = await db.collection('users').doc(userId).collection('todos')
        .where('createdAt', '>=', start)
        .where('createdAt', '<=', end)
        .get();

      const todos = todosSnapshot.docs.map(doc => doc.data());

      analytics.todos = {
        total: todos.length,
        completed: todos.filter(t => t.completed).length,
        pending: todos.filter(t => !t.completed).length,
        completionRate: todos.length > 0 ? (todos.filter(t => t.completed).length / todos.length * 100).toFixed(1) : 0,
        byPriority: {
          high: todos.filter(t => t.priority === 'high').length,
          medium: todos.filter(t => t.priority === 'medium').length,
          low: todos.filter(t => t.priority === 'low').length,
        },
        dailyCompletions: getDailyCompletions(todos, start, end),
      };
    }

    if (type === 'routines' || !type) {
      // Get routines analytics
      const routinesSnapshot = await db.collection('users').doc(userId).collection('routines')
        .where('createdAt', '>=', start)
        .where('createdAt', '<=', end)
        .get();

      const routines = routinesSnapshot.docs.map(doc => doc.data());

      analytics.routines = {
        total: routines.length,
        completed: routines.filter(r => r.completed).length,
        pending: routines.filter(r => !r.completed).length,
        completionRate: routines.length > 0 ? (routines.filter(r => r.completed).length / routines.length * 100).toFixed(1) : 0,
        dailyCompletions: getDailyCompletions(routines, start, end),
      };
    }

    res.status(200).json(analytics);
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ message: 'Failed to fetch analytics', error: error.message });
  }
});

// Get monthly progress data
app.get('/api/analytics/monthly', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { year, month } = req.query;

    const targetYear = year ? parseInt(year) : new Date().getFullYear();
    const targetMonth = month ? parseInt(month) : new Date().getMonth();

    const startOfMonth = new Date(targetYear, targetMonth, 1);
    const endOfMonth = new Date(targetYear, targetMonth + 1, 0);

    // Get todos for the month
    const todosSnapshot = await db.collection('users').doc(userId).collection('todos')
      .where('completedAt', '>=', startOfMonth.toISOString())
      .where('completedAt', '<=', endOfMonth.toISOString())
      .get();

    // Get routines for the month
    const routinesSnapshot = await db.collection('users').doc(userId).collection('routines')
      .where('completedAt', '>=', startOfMonth.toISOString())
      .where('completedAt', '<=', endOfMonth.toISOString())
      .get();

    const todos = todosSnapshot.docs.map(doc => doc.data());
    const routines = routinesSnapshot.docs.map(doc => doc.data());

    const monthlyData = generateMonthlyProgress(todos, routines, startOfMonth, endOfMonth);

    res.status(200).json(monthlyData);
  } catch (error) {
    console.error('Error fetching monthly analytics:', error);
    res.status(500).json({ message: 'Failed to fetch monthly analytics', error: error.message });
  }
});

// Helper function to get daily completions
function getDailyCompletions(items, startDate, endDate) {
  const dailyData = {};
  const currentDate = new Date(startDate);

  // Initialize all dates with 0
  while (currentDate <= endDate) {
    const dateKey = currentDate.toISOString().split('T')[0];
    dailyData[dateKey] = 0;
    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Count completions by date
  items.forEach(item => {
    if (item.completedAt) {
      const completionDate = new Date(item.completedAt).toISOString().split('T')[0];
      if (dailyData.hasOwnProperty(completionDate)) {
        dailyData[completionDate]++;
      }
    }
  });

  return dailyData;
}

// Helper function to generate monthly progress data
function generateMonthlyProgress(todos, routines, startDate, endDate) {
  const daysInMonth = endDate.getDate();
  const dailyProgress = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const currentDate = new Date(startDate.getFullYear(), startDate.getMonth(), day);
    const dateKey = currentDate.toISOString().split('T')[0];

    const todosCompleted = todos.filter(t =>
      t.completedAt && new Date(t.completedAt).toDateString() === currentDate.toDateString()
    ).length;

    const routinesCompleted = routines.filter(r =>
      r.completedAt && new Date(r.completedAt).toDateString() === currentDate.toDateString()
    ).length;

    dailyProgress.push({
      date: dateKey,
      day: day,
      todos: todosCompleted,
      routines: routinesCompleted,
      total: todosCompleted + routinesCompleted,
    });
  }

  return {
    month: startDate.getMonth() + 1,
    year: startDate.getFullYear(),
    totalDays: daysInMonth,
    dailyProgress,
    summary: {
      totalTodos: todos.length,
      totalRoutines: routines.length,
      totalCompleted: todos.length + routines.length,
      averagePerDay: ((todos.length + routines.length) / daysInMonth).toFixed(1),
    }
  };
}

// --- Notification API Endpoints ---

// Register FCM token for user
app.post('/api/notifications/register-token', verifyToken, async (req, res) => {
  try {
    const { fcmToken } = req.body;
    const userId = req.user.uid;

    if (!fcmToken) {
      return res.status(400).json({ message: 'FCM token is required.' });
    }

    // Store FCM token in user document
    await db.collection('users').doc(userId).set({
      fcmToken,
      tokenUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    res.status(200).json({ message: 'FCM token registered successfully' });
  } catch (error) {
    console.error('Error registering FCM token:', error);
    res.status(500).json({ message: 'Failed to register FCM token', error: error.message });
  }
});

// Send push notification to user
app.post('/api/notifications/send', verifyToken, async (req, res) => {
  try {
    const { title, body, data, targetUserId } = req.body;
    const userId = targetUserId || req.user.uid;

    // Get user's FCM token
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    const fcmToken = userData.fcmToken;

    if (!fcmToken) {
      return res.status(400).json({ message: 'User has no registered FCM token' });
    }

    // Send notification
    const message = {
      token: fcmToken,
      notification: {
        title: title || 'FocusMate',
        body: body || '',
      },
      data: data || {},
      android: {
        notification: {
          channelId: 'focusmate-default',
          priority: 'default',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
          },
        },
      },
    };

    const response = await admin.messaging().send(message);

    // Log notification
    await db.collection('users').doc(userId).collection('notifications').add({
      title,
      body,
      data,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      messageId: response,
      status: 'sent',
    });

    res.status(200).json({
      message: 'Notification sent successfully',
      messageId: response
    });
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({ message: 'Failed to send notification', error: error.message });
  }
});

// Get notification history for user
app.get('/api/notifications/history', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { limit = 50 } = req.query;

    const notificationsSnapshot = await db.collection('users')
      .doc(userId)
      .collection('notifications')
      .orderBy('sentAt', 'desc')
      .limit(parseInt(limit))
      .get();

    const notifications = notificationsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.status(200).json(notifications);
  } catch (error) {
    console.error('Error fetching notification history:', error);
    res.status(500).json({ message: 'Failed to fetch notification history', error: error.message });
  }
});

// Update notification settings
app.put('/api/notifications/settings', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const settings = req.body;

    await db.collection('users').doc(userId).set({
      notificationSettings: settings,
      settingsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    res.status(200).json({ message: 'Notification settings updated successfully' });
  } catch (error) {
    console.error('Error updating notification settings:', error);
    res.status(500).json({ message: 'Failed to update notification settings', error: error.message });
  }
});

// Get notification settings
app.get('/api/notifications/settings', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;

    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    const settings = userData.notificationSettings || getDefaultNotificationSettings();

    res.status(200).json(settings);
  } catch (error) {
    console.error('Error fetching notification settings:', error);
    res.status(500).json({ message: 'Failed to fetch notification settings', error: error.message });
  }
});

// --- AI Coach API Endpoints ---

// Send message to AI coach
app.post('/api/coach/message', verifyToken, async (req, res) => {
  try {
    const { message } = req.body;
    const userId = req.user.uid;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Get or create conversation
    const conversation = await getOrCreateConversation(userId);

    // Get current user context
    const userContext = await aggregateUserContext(userId);

    // Generate AI response (simplified for now - would integrate with OpenAI)
    const aiResponse = await generateCoachResponse(message, userContext);

    // Add messages to conversation
    const userMessage = {
      id: generateId(),
      role: 'user',
      content: message,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      context: {
        taskCount: userContext.totalTasks,
        completedTasks: userContext.completedTasks,
        currentMood: userContext.recentMood,
        activeRoutines: userContext.activeRoutines
      }
    };

    const assistantMessage = {
      id: generateId(),
      role: 'assistant',
      content: aiResponse.message,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('coach_conversations').doc(conversation.id).update({
      messages: admin.firestore.FieldValue.arrayUnion(userMessage, assistantMessage),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      message: aiResponse.message,
      suggestions: aiResponse.suggestions,
      conversationId: conversation.id
    });
  } catch (error) {
    console.error('Error in coach message endpoint:', error);
    res.status(500).json({
      error: 'Failed to process message',
      message: 'I apologize, but I encountered an issue. Please try again in a moment.'
    });
  }
});

// Get conversation history
app.get('/api/coach/history', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const limit = parseInt(req.query.limit) || 50;

    const conversationQuery = await db
      .collection('coach_conversations')
      .where('userId', '==', userId)
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (conversationQuery.empty) {
      return res.json({ messages: [] });
    }

    const conversation = conversationQuery.docs[0].data();
    const messages = conversation.messages
      .slice(-limit)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    res.json({ messages });
  } catch (error) {
    console.error('Error getting conversation history:', error);
    res.status(500).json({ error: 'Failed to load conversation history' });
  }
});

// Update user preferences for coach
app.put('/api/coach/preferences', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { preferences } = req.body;

    if (!preferences) {
      return res.status(400).json({ error: 'Preferences are required' });
    }

    await db.collection('users').doc(userId).set({
      coachPreferences: preferences,
      preferencesUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating preferences:', error);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// Get user context summary for coach
app.get('/api/coach/context', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;

    const context = await aggregateUserContext(userId);

    res.json({
      context,
      summary: generateContextSummary(context)
    });
  } catch (error) {
    console.error('Error getting user context:', error);
    res.status(500).json({ error: 'Failed to load user context' });
  }
});

// Helper function for default notification settings
function getDefaultNotificationSettings() {
  return {
    taskReminders: {
      enabled: true,
      timings: [60], // 1 hour before
    },
    routineNotifications: {
      enabled: true,
      advanceWarning: 5, // 5 minutes before
    },
    inactivityReminders: {
      enabled: true,
      duration: 120, // 2 hours
      workHoursOnly: true,
      workHours: { start: '09:00', end: '17:00' },
    },
    celebrationNotifications: {
      enabled: true,
    },
    doNotDisturb: {
      enabled: false,
      schedules: [],
    },
  };
}

// --- AI Coach Helper Functions ---

// Generate unique ID
function generateId() {
  return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

// Get or create conversation for user
async function getOrCreateConversation(userId) {
  try {
    // Try to get active conversation
    const activeConversationQuery = await db
      .collection('coach_conversations')
      .where('userId', '==', userId)
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (!activeConversationQuery.empty) {
      const doc = activeConversationQuery.docs[0];
      return { id: doc.id, ...doc.data() };
    }

    // Create new conversation if none exists
    const newConversationRef = db.collection('coach_conversations').doc();
    const newConversation = {
      userId,
      messages: [],
      context: { userId },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      isActive: true
    };

    await newConversationRef.set(newConversation);
    return { id: newConversationRef.id, ...newConversation };
  } catch (error) {
    console.error('Error getting/creating conversation:', error);
    throw new Error('Failed to initialize conversation');
  }
}

// Aggregate user context from app data
async function aggregateUserContext(userId) {
  try {
    const [todosSnapshot, routinesSnapshot, journalSnapshot] = await Promise.all([
      db.collection('users').doc(userId).collection('todos').where('completed', '==', false).limit(20).get(),
      db.collection('users').doc(userId).collection('routines').limit(10).get(),
      db.collection('users').doc(userId).collection('journal').orderBy('createdAt', 'desc').limit(5).get()
    ]);

    const todos = todosSnapshot.docs.map(doc => doc.data());
    const routines = routinesSnapshot.docs.map(doc => doc.data());
    const journalEntries = journalSnapshot.docs.map(doc => doc.data());

    const completedTasks = todos.filter(todo => todo.completed).length;
    const totalTasks = todos.length;
    const activeRoutines = routines.filter(routine => !routine.completed).length;
    const recentMood = journalEntries.length > 0 ? journalEntries[0].mood : null;

    return {
      totalTasks,
      completedTasks,
      activeRoutines,
      recentMood,
      todos: todos.slice(0, 5), // Limit for context
      routines: routines.slice(0, 3),
      recentMoods: journalEntries.slice(0, 2)
    };
  } catch (error) {
    console.error('Error aggregating user context:', error);
    return {
      totalTasks: 0,
      completedTasks: 0,
      activeRoutines: 0,
      recentMood: null
    };
  }
}

// Generate context summary
function generateContextSummary(context) {
  const summaryParts = [];

  summaryParts.push(`${context.completedTasks}/${context.totalTasks} tasks completed`);

  if (context.recentMood) {
    summaryParts.push(`recent mood: ${context.recentMood}`);
  }

  if (context.activeRoutines > 0) {
    summaryParts.push(`${context.activeRoutines} active routines`);
  }

  return summaryParts.length > 0 ? summaryParts.join(', ') : 'Getting started';
}

// Generate AI coach response using OpenAI API
async function generateCoachResponse(userMessage, userContext) {
  try {
    // Check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
      return getFallbackResponse(userMessage, userContext);
    }

    const systemPrompt = generateSystemPrompt(userContext);
    const contextualMessage = formatUserMessage(userMessage, userContext);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Using the more cost-effective model
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: contextualMessage }
      ],
      max_tokens: 300,
      temperature: 0.7,
    });

    const response = completion.choices[0]?.message?.content || 'I apologize, but I encountered an issue generating a response. Please try again.';

    return {
      message: response,
      suggestions: generateQuickSuggestions(userContext)
    };
  } catch (error) {
    console.error('OpenAI API error:', error);
    return getFallbackResponse(userMessage, userContext);
  }
}

// Generate system prompt for OpenAI
function generateSystemPrompt(userContext) {
  return `You are an AI coach assistant specifically designed to help users with ADHD. Your role is to provide:

1. Personalized support and encouragement
2. Evidence-based ADHD coping strategies
3. Practical, actionable advice
4. Emotional support and understanding

User Context:
- Current tasks: ${userContext.totalTasks} total, ${userContext.completedTasks} completed
- Recent mood: ${userContext.recentMood || 'not specified'}
- Active routines: ${userContext.activeRoutines}

Guidelines:
- Be empathetic and understanding of ADHD challenges
- Provide specific, actionable advice rather than generic suggestions
- Reference the user's current context when relevant
- Keep responses concise but warm and supportive (2-3 sentences max)
- Avoid overwhelming the user with too much information at once
- Celebrate small wins and progress
- Offer practical strategies for common ADHD challenges like focus, organization, and emotional regulation

Remember: You're not just an AI, you're a supportive coach who understands ADHD and wants to help the user succeed.`;
}

// Format user message with context
function formatUserMessage(message, context) {
  const contextInfo = [];

  if (context.totalTasks > 0) {
    contextInfo.push(`Current tasks: ${context.completedTasks}/${context.totalTasks} completed`);
  }

  if (context.recentMood) {
    contextInfo.push(`Recent mood: ${context.recentMood}`);
  }

  if (context.activeRoutines > 0) {
    contextInfo.push(`Active routines: ${context.activeRoutines}`);
  }

  const contextString = contextInfo.length > 0 ? `\n\nContext: ${contextInfo.join(', ')}` : '';

  return `${message}${contextString}`;
}

// Get fallback response when AI is unavailable
function getFallbackResponse(userMessage, userContext) {
  const responses = [
    "I understand you're looking for support. While I'm having trouble connecting to my AI capabilities right now, I want you to know that you're doing great by reaching out.",
    "I'm here to help, even though my AI features aren't fully available at the moment. Remember that every small step counts, especially with ADHD.",
    "Thanks for sharing with me. While I'm experiencing some technical difficulties, I believe in your ability to tackle whatever you're facing.",
    "I appreciate you taking the time to connect. Even though my AI responses aren't working perfectly right now, your effort to stay organized and focused is commendable."
  ];

  const randomResponse = responses[Math.floor(Math.random() * responses.length)];

  return {
    message: randomResponse,
    suggestions: generateQuickSuggestions(userContext)
  };
}

// Generate quick suggestions based on context
function generateQuickSuggestions(context) {
  const suggestions = [];

  if (context.totalTasks > context.completedTasks) {
    suggestions.push("Review your current tasks");
    suggestions.push("Start with the smallest task");
  }

  if (context.activeRoutines > 0) {
    suggestions.push("Check your routine progress");
  }

  if (!context.recentMood) {
    suggestions.push("Log your current mood");
  }

  suggestions.push("Take a 5-minute break");
  suggestions.push("Practice deep breathing");

  return suggestions.slice(0, 3); // Limit to 3 suggestions
}

// --- Routine Helper Functions ---

// Generate unique task ID
function generateTaskId() {
  return 'task_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

// Calculate detailed analytics for a routine
function calculateDetailedAnalytics(routine, history) {
  const completions = history.filter(h => h.completedAt);
  const skips = history.filter(h => h.skippedAt);

  const totalAttempts = completions.length + skips.length;
  const completionRate = totalAttempts > 0 ? (completions.length / totalAttempts) * 100 : 0;

  // Calculate average duration
  const durationsWithActual = completions.filter(c => c.actualDuration);
  const averageDuration = durationsWithActual.length > 0
    ? durationsWithActual.reduce((sum, c) => sum + c.actualDuration, 0) / durationsWithActual.length
    : routine.tasks.reduce((sum, task) => sum + task.estimatedDuration, 0);

  // Calculate consistency score (based on regular completion)
  const consistencyScore = calculateConsistencyScore(completions);

  // Analyze skip reasons
  const skipReasons = skips.reduce((acc, skip) => {
    const reason = skip.skipReason || 'Unknown';
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});

  // Time analysis
  const timeAnalysis = analyzeCompletionTimes(completions);

  // Task-level analytics
  const taskAnalytics = routine.tasks.map(task => {
    const taskCompletions = completions.filter(c => c.taskId === task.id);
    const taskSkips = skips.filter(s => s.taskId === task.id);
    const taskAttempts = taskCompletions.length + taskSkips.length;

    return {
      taskId: task.id,
      title: task.title,
      completionRate: taskAttempts > 0 ? (taskCompletions.length / taskAttempts) * 100 : 0,
      averageDuration: taskCompletions.length > 0
        ? taskCompletions.reduce((sum, c) => sum + (c.actualDuration || task.estimatedDuration), 0) / taskCompletions.length
        : task.estimatedDuration,
      totalCompletions: taskCompletions.length,
      totalSkips: taskSkips.length
    };
  });

  return {
    ...routine.analytics,
    completionRate: Math.round(completionRate * 100) / 100,
    averageDuration: Math.round(averageDuration),
    consistencyScore: Math.round(consistencyScore * 100) / 100,
    totalAttempts,
    skipReasons,
    timeAnalysis,
    taskAnalytics,
    trends: calculateTrends(completions),
    recommendations: generateRecommendations(routine, completions, skips)
  };
}

// Calculate summary analytics for multiple routines
function calculateSummaryAnalytics(routines, history) {
  const totalRoutines = routines.length;
  const activeRoutines = routines.filter(r => !r.isTemplate).length;
  const templates = routines.filter(r => r.isTemplate).length;

  const completions = history.filter(h => h.completedAt);
  const skips = history.filter(h => h.skippedAt);
  const totalAttempts = completions.length + skips.length;

  const overallCompletionRate = totalAttempts > 0 ? (completions.length / totalAttempts) * 100 : 0;

  // Category breakdown
  const categoryBreakdown = routines.reduce((acc, routine) => {
    const category = routine.templateCategory || 'uncategorized';
    if (!acc[category]) {
      acc[category] = { count: 0, completions: 0, attempts: 0 };
    }
    acc[category].count++;

    const routineHistory = history.filter(h => h.routineId === routine.id);
    const routineCompletions = routineHistory.filter(h => h.completedAt);
    const routineAttempts = routineHistory.length;

    acc[category].completions += routineCompletions.length;
    acc[category].attempts += routineAttempts;

    return acc;
  }, {});

  // Calculate completion rates for each category
  Object.keys(categoryBreakdown).forEach(category => {
    const data = categoryBreakdown[category];
    data.completionRate = data.attempts > 0 ? (data.completions / data.attempts) * 100 : 0;
  });

  // Time-based analysis
  const last7Days = getDateRange(7);
  const last30Days = getDateRange(30);

  const recent7DaysCompletions = completions.filter(c => c.completedAt >= last7Days);
  const recent30DaysCompletions = completions.filter(c => c.completedAt >= last30Days);

  return {
    overview: {
      totalRoutines,
      activeRoutines,
      templates,
      overallCompletionRate: Math.round(overallCompletionRate * 100) / 100,
      totalCompletions: completions.length,
      totalAttempts
    },
    categoryBreakdown,
    timeAnalysis: {
      last7Days: {
        completions: recent7DaysCompletions.length,
        averagePerDay: Math.round((recent7DaysCompletions.length / 7) * 100) / 100
      },
      last30Days: {
        completions: recent30DaysCompletions.length,
        averagePerDay: Math.round((recent30DaysCompletions.length / 30) * 100) / 100
      }
    },
    topPerformingRoutines: getTopPerformingRoutines(routines, history),
    improvementAreas: getImprovementAreas(routines, history)
  };
}

// Generate routine insights and recommendations
function generateRoutineInsights(routines, history) {
  const insights = [];

  // Completion rate insights
  const completions = history.filter(h => h.completedAt);
  const totalAttempts = history.length;
  const overallRate = totalAttempts > 0 ? (completions.length / totalAttempts) * 100 : 0;

  if (overallRate > 80) {
    insights.push({
      type: 'success',
      title: 'Excellent Routine Adherence',
      message: `You're completing ${Math.round(overallRate)}% of your routine tasks. Keep up the great work!`,
      priority: 'high'
    });
  } else if (overallRate < 50) {
    insights.push({
      type: 'improvement',
      title: 'Routine Completion Opportunity',
      message: `Your completion rate is ${Math.round(overallRate)}%. Consider simplifying routines or adjusting time estimates.`,
      priority: 'high',
      suggestions: [
        'Break down complex tasks into smaller steps',
        'Add more buffer time between tasks',
        'Review and adjust unrealistic time estimates'
      ]
    });
  }

  // Time pattern insights
  const timePatterns = analyzeTimePatterns(completions);
  if (timePatterns.bestTime) {
    insights.push({
      type: 'pattern',
      title: 'Optimal Performance Time',
      message: `You complete routines most successfully around ${timePatterns.bestTime}. Consider scheduling important routines during this time.`,
      priority: 'medium'
    });
  }

  // Consistency insights
  const consistencyScore = calculateOverallConsistency(completions);
  if (consistencyScore < 60) {
    insights.push({
      type: 'consistency',
      title: 'Consistency Opportunity',
      message: 'Building more consistent routine habits could improve your overall productivity.',
      priority: 'medium',
      suggestions: [
        'Start with shorter, simpler routines',
        'Set up environmental cues and reminders',
        'Track your energy levels to find optimal times'
      ]
    });
  }

  // Skip reason analysis
  const skipReasons = history.filter(h => h.skippedAt).reduce((acc, skip) => {
    const reason = skip.skipReason || 'Unknown';
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});

  const topSkipReason = Object.keys(skipReasons).reduce((a, b) =>
    skipReasons[a] > skipReasons[b] ? a : b, Object.keys(skipReasons)[0]
  );

  if (topSkipReason && skipReasons[topSkipReason] > 3) {
    insights.push({
      type: 'pattern',
      title: 'Common Skip Reason Identified',
      message: `"${topSkipReason}" is your most common reason for skipping routines. Let's address this pattern.`,
      priority: 'medium',
      suggestions: getSkipReasonSuggestions(topSkipReason)
    });
  }

  return insights;
}

// Helper functions for analytics calculations

function calculateConsistencyScore(completions) {
  if (completions.length < 2) return 0;

  // Calculate based on regular intervals between completions
  const intervals = [];
  for (let i = 1; i < completions.length; i++) {
    const interval = completions[i].completedAt - completions[i - 1].completedAt;
    intervals.push(interval / (1000 * 60 * 60 * 24)); // Convert to days
  }

  if (intervals.length === 0) return 0;

  const averageInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
  const variance = intervals.reduce((sum, interval) => sum + Math.pow(interval - averageInterval, 2), 0) / intervals.length;
  const standardDeviation = Math.sqrt(variance);

  // Lower standard deviation = higher consistency
  const consistencyScore = Math.max(0, 100 - (standardDeviation * 10));
  return Math.min(100, consistencyScore);
}

function analyzeCompletionTimes(completions) {
  const timeSlots = {};

  completions.forEach(completion => {
    const hour = completion.completedAt.getHours();
    const timeSlot = getTimeSlot(hour);
    timeSlots[timeSlot] = (timeSlots[timeSlot] || 0) + 1;
  });

  const bestTimeSlot = Object.keys(timeSlots).reduce((a, b) =>
    timeSlots[a] > timeSlots[b] ? a : b, Object.keys(timeSlots)[0]
  );

  return {
    timeSlots,
    bestTimeSlot,
    distribution: Object.keys(timeSlots).map(slot => ({
      timeSlot: slot,
      count: timeSlots[slot],
      percentage: Math.round((timeSlots[slot] / completions.length) * 100)
    }))
  };
}

function calculateTrends(completions) {
  if (completions.length < 4) return { trend: 'insufficient_data' };

  // Calculate trend over last 4 weeks
  const fourWeeksAgo = new Date();
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

  const recentCompletions = completions.filter(c => c.completedAt >= fourWeeksAgo);
  const weeks = [0, 0, 0, 0]; // Last 4 weeks

  recentCompletions.forEach(completion => {
    const daysAgo = Math.floor((new Date() - completion.completedAt) / (1000 * 60 * 60 * 24));
    const weekIndex = Math.floor(daysAgo / 7);
    if (weekIndex < 4) {
      weeks[3 - weekIndex]++; // Reverse order (most recent first)
    }
  });

  // Simple trend calculation
  const firstHalf = (weeks[0] + weeks[1]) / 2;
  const secondHalf = (weeks[2] + weeks[3]) / 2;

  let trend = 'stable';
  if (secondHalf > firstHalf * 1.2) {
    trend = 'improving';
  } else if (secondHalf < firstHalf * 0.8) {
    trend = 'declining';
  }

  return { trend, weeklyData: weeks };
}

function generateRecommendations(routine, completions, skips) {
  const recommendations = [];

  // Time-based recommendations
  const avgDuration = completions.length > 0
    ? completions.reduce((sum, c) => sum + (c.actualDuration || 0), 0) / completions.length
    : 0;

  const estimatedDuration = routine.tasks.reduce((sum, task) => sum + task.estimatedDuration, 0);

  if (avgDuration > estimatedDuration * 1.3) {
    recommendations.push({
      type: 'time_adjustment',
      message: 'Consider increasing time estimates - you typically take longer than planned',
      priority: 'medium'
    });
  }

  // Skip-based recommendations
  const skipRate = (skips.length / (completions.length + skips.length)) * 100;
  if (skipRate > 30) {
    recommendations.push({
      type: 'simplification',
      message: 'High skip rate suggests this routine might be too ambitious. Consider simplifying.',
      priority: 'high'
    });
  }

  // Task-specific recommendations
  routine.tasks.forEach(task => {
    const taskSkips = skips.filter(s => s.taskId === task.id);
    const taskCompletions = completions.filter(c => c.taskId === task.id);
    const taskSkipRate = taskSkips.length / (taskSkips.length + taskCompletions.length) * 100;

    if (taskSkipRate > 50) {
      recommendations.push({
        type: 'task_adjustment',
        message: `Task "${task.title}" is skipped frequently. Consider breaking it down or adjusting timing.`,
        priority: 'medium',
        taskId: task.id
      });
    }
  });

  return recommendations;
}

function getTimeSlot(hour) {
  if (hour < 6) return 'early_morning';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

function getDateRange(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function getTopPerformingRoutines(routines, history) {
  return routines
    .filter(r => !r.isTemplate)
    .map(routine => {
      const routineHistory = history.filter(h => h.routineId === routine.id);
      const completions = routineHistory.filter(h => h.completedAt);
      const attempts = routineHistory.length;
      const completionRate = attempts > 0 ? (completions.length / attempts) * 100 : 0;

      return {
        id: routine.id,
        title: routine.title,
        completionRate: Math.round(completionRate * 100) / 100,
        totalCompletions: completions.length,
        totalAttempts: attempts
      };
    })
    .sort((a, b) => b.completionRate - a.completionRate)
    .slice(0, 5);
}

function getImprovementAreas(routines, history) {
  return routines
    .filter(r => !r.isTemplate)
    .map(routine => {
      const routineHistory = history.filter(h => h.routineId === routine.id);
      const completions = routineHistory.filter(h => h.completedAt);
      const skips = routineHistory.filter(h => h.skippedAt);
      const attempts = routineHistory.length;
      const completionRate = attempts > 0 ? (completions.length / attempts) * 100 : 0;

      return {
        id: routine.id,
        title: routine.title,
        completionRate: Math.round(completionRate * 100) / 100,
        totalSkips: skips.length,
        totalAttempts: attempts,
        improvementPotential: 100 - completionRate
      };
    })
    .filter(routine => routine.totalAttempts > 2 && routine.completionRate < 70)
    .sort((a, b) => b.improvementPotential - a.improvementPotential)
    .slice(0, 3);
}

function analyzeTimePatterns(completions) {
  const hourCounts = {};

  completions.forEach(completion => {
    const hour = completion.completedAt.getHours();
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
  });

  const bestHour = Object.keys(hourCounts).reduce((a, b) =>
    hourCounts[a] > hourCounts[b] ? a : b, Object.keys(hourCounts)[0]
  );

  const bestTime = bestHour ? `${bestHour}:00` : null;

  return { bestTime, hourDistribution: hourCounts };
}

function calculateOverallConsistency(completions) {
  if (completions.length < 3) return 0;

  // Group completions by day
  const dailyCompletions = {};
  completions.forEach(completion => {
    const dateKey = completion.completedAt.toISOString().split('T')[0];
    dailyCompletions[dateKey] = (dailyCompletions[dateKey] || 0) + 1;
  });

  const days = Object.keys(dailyCompletions);
  const totalDays = days.length;

  if (totalDays < 3) return 0;

  // Calculate consistency based on regular activity
  const avgCompletionsPerDay = completions.length / totalDays;
  const variance = days.reduce((sum, day) => {
    const diff = dailyCompletions[day] - avgCompletionsPerDay;
    return sum + (diff * diff);
  }, 0) / totalDays;

  const standardDeviation = Math.sqrt(variance);
  const consistencyScore = Math.max(0, 100 - (standardDeviation * 20));

  return Math.min(100, consistencyScore);
}

function getSkipReasonSuggestions(reason) {
  const suggestions = {
    'No time': [
      'Break tasks into smaller 5-10 minute chunks',
      'Schedule routines during naturally free periods',
      'Consider which tasks are truly essential'
    ],
    'Too tired': [
      'Schedule demanding routines during your peak energy times',
      'Add energizing activities like light exercise or music',
      'Ensure adequate sleep and nutrition'
    ],
    'Not in the mood': [
      'Create a pre-routine ritual to get in the right mindset',
      'Start with the easiest or most enjoyable task',
      'Use the 2-minute rule: commit to just 2 minutes'
    ],
    'Forgot': [
      'Set up multiple reminders and environmental cues',
      'Link routines to existing habits',
      'Use visual reminders in your environment'
    ],
    'Task too difficult': [
      'Break complex tasks into smaller, manageable steps',
      'Identify specific obstacles and address them',
      'Consider if the task belongs in this routine'
    ]
  };

  return suggestions[reason] || [
    'Reflect on what makes this routine challenging',
    'Consider adjusting timing or complexity',
    'Experiment with different approaches'
  ];
}

// --- AI Integration API Endpoints ---

// Generate routine using AI
app.post('/api/ai/generate-routine', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { prompt, preferences, includeCalendarContext = false } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ message: 'Prompt is required' });
    }

    // Aggregate user context for AI
    const userContext = await aggregateAIUserContext(userId, includeCalendarContext);

    // Generate routine using AI
    const aiResponse = await generateAIRoutine(prompt, userContext, preferences);

    // Store AI generation request for learning
    await db.collection('users').doc(userId).collection('aiRequests').add({
      type: 'routine_generation',
      prompt,
      response: aiResponse,
      context: userContext,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(200).json({
      routine: aiResponse.routine,
      confidence: aiResponse.confidence,
      reasoning: aiResponse.reasoning,
      alternatives: aiResponse.alternatives,
      warnings: aiResponse.warnings,
      contextUsed: {
        totalTasks: userContext.totalTasks,
        completedTasks: userContext.completedTasks,
        activeRoutines: userContext.activeRoutines,
        recentMood: userContext.recentMood,
        energyPatterns: userContext.energyPatterns.length,
        calendarEventsConsidered: userContext.calendarContext?.upcomingEvents?.length || 0
      }
    });
  } catch (error) {
    console.error('Error generating AI routine:', error);
    res.status(500).json({
      message: 'Failed to generate routine',
      error: error.message,
      fallback: getAIFallbackRoutine(req.body.prompt)
    });
  }
});

// Analyze calendar gaps and suggest routines
app.post('/api/ai/analyze-calendar-gaps', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { startDate, endDate, minGapDuration = 30 } = req.body;

    // Get user context
    const userContext = await aggregateAIUserContext(userId, true);

    if (!userContext.calendarContext || !userContext.calendarContext.freeTimeSlots) {
      return res.status(400).json({ message: 'Calendar context not available. Please ensure calendar sync is enabled.' });
    }

    // Analyze gaps and generate suggestions
    const suggestions = await analyzeCalendarGapsWithAI(
      userContext.calendarContext.freeTimeSlots,
      userContext,
      minGapDuration
    );

    res.status(200).json({
      freeTimeSlots: userContext.calendarContext.freeTimeSlots,
      suggestions,
      analysisContext: {
        totalGaps: userContext.calendarContext.freeTimeSlots.length,
        suggestionsGenerated: suggestions.length,
        userEnergyPatterns: userContext.energyPatterns.length
      }
    });
  } catch (error) {
    console.error('Error analyzing calendar gaps:', error);
    res.status(500).json({ message: 'Failed to analyze calendar gaps', error: error.message });
  }
});

// Adapt routine based on user feedback
app.post('/api/ai/adapt-routine', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { routineId, feedback, adaptationType = 'behavioral' } = req.body;

    if (!routineId || !feedback) {
      return res.status(400).json({ message: 'Routine ID and feedback are required' });
    }

    // Get the routine
    const routineDoc = await db.collection('users').doc(userId).collection('routines').doc(routineId).get();
    if (!routineDoc.exists) {
      return res.status(404).json({ message: 'Routine not found' });
    }

    const routine = routineDoc.data();

    // Get user context and routine history
    const userContext = await aggregateAIUserContext(userId, false);
    const routineHistory = await getRoutineHistory(userId, routineId);

    // Generate adaptations using AI
    const adaptations = await generateRoutineAdaptations(routine, feedback, userContext, routineHistory, adaptationType);

    // Store adaptation request for learning
    await db.collection('users').doc(userId).collection('aiRequests').add({
      type: 'routine_adaptation',
      routineId,
      feedback,
      adaptationType,
      adaptations,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(200).json({
      originalRoutine: routine,
      adaptations,
      reasoning: adaptations.reasoning,
      confidence: adaptations.confidence,
      suggestedChanges: adaptations.suggestedChanges
    });
  } catch (error) {
    console.error('Error adapting routine:', error);
    res.status(500).json({ message: 'Failed to adapt routine', error: error.message });
  }
});

// Generate proactive insights based on user behavior
app.get('/api/ai/insights', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { timeframe = '30d', insightTypes = 'all' } = req.query;

    // Get comprehensive user context
    const userContext = await aggregateAIUserContext(userId, false);

    // Get historical data based on timeframe
    const historicalData = await getHistoricalData(userId, timeframe);

    // Generate AI insights
    const insights = await generateProactiveInsights(userContext, historicalData, insightTypes);

    // Store insights generation for tracking
    await db.collection('users').doc(userId).collection('aiInsights').add({
      insights,
      timeframe,
      insightTypes,
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      contextSnapshot: {
        totalRoutines: userContext.totalRoutines,
        completionRate: userContext.overallCompletionRate,
        recentMood: userContext.recentMood
      }
    });

    res.status(200).json({
      insights,
      contextSummary: {
        dataPoints: historicalData.totalDataPoints,
        timeframe,
        analysisDate: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error generating AI insights:', error);
    res.status(500).json({ message: 'Failed to generate insights', error: error.message });
  }
});

// Get AI context summary for debugging/transparency
app.get('/api/ai/context', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { includeCalendar = false } = req.query;

    const context = await aggregateAIUserContext(userId, includeCalendar === 'true');

    res.status(200).json({
      context,
      summary: generateAIContextSummary(context),
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching AI context:', error);
    res.status(500).json({ message: 'Failed to fetch AI context', error: error.message });
  }
});

// Update user preferences for AI
app.put('/api/ai/preferences', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { preferences } = req.body;

    if (!preferences) {
      return res.status(400).json({ message: 'Preferences are required' });
    }

    // Validate preferences structure
    const validatedPreferences = validateAIPreferences(preferences);

    await db.collection('users').doc(userId).set({
      aiPreferences: validatedPreferences,
      aiPreferencesUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.status(200).json({
      message: 'AI preferences updated successfully',
      preferences: validatedPreferences
    });
  } catch (error) {
    console.error('Error updating AI preferences:', error);
    res.status(500).json({ message: 'Failed to update AI preferences', error: error.message });
  }
});

// --- AI Helper Functions ---

// Aggregate comprehensive user context for AI processing
async function aggregateAIUserContext(userId, includeCalendarContext = false) {
  try {
    const [
      userDoc,
      todosSnapshot,
      routinesSnapshot,
      journalSnapshot,
      routineHistorySnapshot
    ] = await Promise.all([
      db.collection('users').doc(userId).get(),
      db.collection('users').doc(userId).collection('todos').limit(20).get(),
      db.collection('users').doc(userId).collection('routines').limit(15).get(),
      db.collection('users').doc(userId).collection('journal').orderBy('createdAt', 'desc').limit(10).get(),
      db.collection('users').doc(userId).collection('routineHistory').orderBy('completedAt', 'desc').limit(50).get()
    ]);

    const userData = userDoc.exists ? userDoc.data() : {};
    const todos = todosSnapshot.docs.map(doc => doc.data());
    const routines = routinesSnapshot.docs.map(doc => doc.data());
    const journalEntries = journalSnapshot.docs.map(doc => doc.data());
    const routineHistory = routineHistorySnapshot.docs.map(doc => ({
      ...doc.data(),
      completedAt: doc.data().completedAt?.toDate(),
      skippedAt: doc.data().skippedAt?.toDate()
    }));

    // Calculate basic metrics
    const completedTasks = todos.filter(todo => todo.completed).length;
    const totalTasks = todos.length;
    const activeRoutines = routines.filter(routine => !routine.completed && !routine.isTemplate).length;
    const totalRoutines = routines.filter(routine => !routine.isTemplate).length;
    const recentMood = journalEntries.length > 0 ? journalEntries[0].mood : null;

    // Calculate energy patterns from routine history
    const energyPatterns = calculateEnergyPatterns(routineHistory, journalEntries);

    // Get user preferences
    const userPreferences = userData.aiPreferences || getDefaultAIPreferences();
    const adhdPreferences = userData.adhdPreferences || getDefaultADHDPreferences();

    // Calculate overall completion rate
    const completions = routineHistory.filter(h => h.completedAt);
    const totalAttempts = routineHistory.length;
    const overallCompletionRate = totalAttempts > 0 ? (completions.length / totalAttempts) * 100 : 0;

    const context = {
      userId,
      userPreferences,
      adhdPreferences,
      totalTasks,
      completedTasks,
      activeRoutines,
      totalRoutines,
      recentMood,
      energyPatterns,
      historicalData: routineHistory.slice(0, 20), // Limit for context size
      overallCompletionRate,
      recentJournalEntries: journalEntries.slice(0, 3),
      currentTodos: todos.slice(0, 10),
      activeRoutinesList: routines.filter(r => !r.completed && !r.isTemplate).slice(0, 5)
    };

    // Add calendar context if requested
    if (includeCalendarContext) {
      context.calendarContext = await getCalendarContext(userId);
    }

    return context;
  } catch (error) {
    console.error('Error aggregating AI user context:', error);
    return getMinimalAIContext(userId);
  }
}

// Generate AI routine using OpenAI
async function generateAIRoutine(prompt, userContext, preferences = {}) {
  try {
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
      return getAIFallbackRoutine(prompt);
    }

    const systemPrompt = generateAIRoutineSystemPrompt(userContext);
    const userPrompt = formatAIRoutinePrompt(prompt, userContext, preferences);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 1000,
      temperature: 0.7,
      response_format: { type: "json_object" }
    });

    const response = JSON.parse(completion.choices[0]?.message?.content || '{}');

    return {
      routine: response.routine || getAIFallbackRoutine(prompt).routine,
      confidence: response.confidence || 0.5,
      reasoning: response.reasoning || 'AI-generated routine based on your request',
      alternatives: response.alternatives || [],
      warnings: response.warnings || []
    };
  } catch (error) {
    console.error('OpenAI API error for routine generation:', error);
    return getAIFallbackRoutine(prompt);
  }
}

// Analyze calendar gaps with AI suggestions
async function analyzeCalendarGapsWithAI(freeTimeSlots, userContext, minGapDuration) {
  try {
    const suitableGaps = freeTimeSlots.filter(slot => slot.duration >= minGapDuration);
    const suggestions = [];

    for (const gap of suitableGaps.slice(0, 5)) { // Limit to 5 gaps
      const gapSuggestion = await generateGapSuggestion(gap, userContext);
      if (gapSuggestion) {
        suggestions.push(gapSuggestion);
      }
    }

    return suggestions;
  } catch (error) {
    console.error('Error analyzing calendar gaps with AI:', error);
    return [];
  }
}

// Generate routine adaptations based on feedback
async function generateRoutineAdaptations(routine, feedback, userContext, routineHistory, adaptationType) {
  try {
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
      return getAdaptationFallback(routine, feedback);
    }

    const systemPrompt = generateAdaptationSystemPrompt(userContext, adaptationType);
    const userPrompt = formatAdaptationPrompt(routine, feedback, routineHistory);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 800,
      temperature: 0.6,
      response_format: { type: "json_object" }
    });

    const response = JSON.parse(completion.choices[0]?.message?.content || '{}');

    return {
      suggestedChanges: response.suggestedChanges || [],
      reasoning: response.reasoning || 'Adaptations based on your feedback',
      confidence: response.confidence || 0.5,
      adaptationType: adaptationType
    };
  } catch (error) {
    console.error('Error generating routine adaptations:', error);
    return getAdaptationFallback(routine, feedback);
  }
}

// Generate proactive insights
async function generateProactiveInsights(userContext, historicalData, insightTypes) {
  try {
    const insights = [];

    // Pattern-based insights
    if (insightTypes === 'all' || insightTypes.includes('patterns')) {
      const patternInsights = analyzeUserPatterns(userContext, historicalData);
      insights.push(...patternInsights);
    }

    // Performance insights
    if (insightTypes === 'all' || insightTypes.includes('performance')) {
      const performanceInsights = analyzePerformanceInsights(userContext, historicalData);
      insights.push(...performanceInsights);
    }

    // Optimization insights
    if (insightTypes === 'all' || insightTypes.includes('optimization')) {
      const optimizationInsights = generateOptimizationInsights(userContext, historicalData);
      insights.push(...optimizationInsights);
    }

    // ADHD-specific insights
    if (userContext.adhdPreferences?.enabled && (insightTypes === 'all' || insightTypes.includes('adhd'))) {
      const adhdInsights = generateADHDInsights(userContext, historicalData);
      insights.push(...adhdInsights);
    }

    return insights.slice(0, 10); // Limit to 10 insights
  } catch (error) {
    console.error('Error generating proactive insights:', error);
    return [];
  }
}

// Helper functions for AI processing

function generateAIRoutineSystemPrompt(userContext) {
  return `You are an AI assistant specialized in creating personalized daily routines for users with ADHD and time management challenges. 

User Context:
- Total tasks: ${userContext.totalTasks}, completed: ${userContext.completedTasks}
- Active routines: ${userContext.activeRoutines}
- Recent mood: ${userContext.recentMood || 'not specified'}
- Overall completion rate: ${Math.round(userContext.overallCompletionRate)}%
- ADHD preferences enabled: ${userContext.adhdPreferences?.enabled || false}

Guidelines:
1. Create realistic, achievable routines with appropriate buffer time
2. Consider the user's energy patterns and completion history
3. If ADHD preferences are enabled, include extra buffer time and simpler task structures
4. Provide estimated durations based on typical completion patterns
5. Include specific, actionable tasks rather than vague goals
6. Consider the user's current workload and stress levels

Response format: JSON object with:
{
  "routine": {
    "title": "string",
    "description": "string", 
    "tasks": [{"title": "string", "description": "string", "estimatedDuration": number, "bufferTime": number}],
    "startTime": "HH:MM",
    "endTime": "HH:MM",
    "priority": "low|medium|high|urgent"
  },
  "confidence": number (0-1),
  "reasoning": "string explaining the routine design",
  "alternatives": [alternative routine objects],
  "warnings": ["string warnings about potential challenges"]
}`;
}

function formatAIRoutinePrompt(prompt, userContext, preferences) {
  let formattedPrompt = `Create a routine based on this request: "${prompt}"`;

  if (userContext.energyPatterns.length > 0) {
    const bestTime = userContext.energyPatterns[0];
    formattedPrompt += `\n\nUser typically performs best around ${bestTime.timeOfDay} with energy level ${bestTime.energyLevel}/10.`;
  }

  if (userContext.overallCompletionRate < 70) {
    formattedPrompt += `\n\nNote: User has a ${Math.round(userContext.overallCompletionRate)}% completion rate, so keep the routine simple and achievable.`;
  }

  if (preferences.maxDuration) {
    formattedPrompt += `\n\nPreferred maximum duration: ${preferences.maxDuration} minutes.`;
  }

  if (preferences.timeOfDay) {
    formattedPrompt += `\n\nPreferred time of day: ${preferences.timeOfDay}.`;
  }

  return formattedPrompt;
}

function getAIFallbackRoutine(prompt) {
  // Simple fallback routine generation based on keywords
  const routineTemplates = {
    morning: {
      title: "Morning Routine",
      tasks: [
        { title: "Wake up and stretch", estimatedDuration: 5, bufferTime: 2 },
        { title: "Personal hygiene", estimatedDuration: 15, bufferTime: 5 },
        { title: "Healthy breakfast", estimatedDuration: 20, bufferTime: 5 },
        { title: "Review daily goals", estimatedDuration: 10, bufferTime: 5 }
      ]
    },
    evening: {
      title: "Evening Routine",
      tasks: [
        { title: "Tidy up workspace", estimatedDuration: 10, bufferTime: 5 },
        { title: "Reflect on the day", estimatedDuration: 10, bufferTime: 0 },
        { title: "Prepare for tomorrow", estimatedDuration: 15, bufferTime: 5 },
        { title: "Relaxation time", estimatedDuration: 20, bufferTime: 10 }
      ]
    },
    work: {
      title: "Work Focus Routine",
      tasks: [
        { title: "Clear workspace", estimatedDuration: 5, bufferTime: 2 },
        { title: "Review priorities", estimatedDuration: 10, bufferTime: 5 },
        { title: "Deep work session", estimatedDuration: 45, bufferTime: 15 },
        { title: "Short break", estimatedDuration: 10, bufferTime: 5 }
      ]
    }
  };

  const promptLower = prompt.toLowerCase();
  let selectedTemplate = routineTemplates.work; // default

  if (promptLower.includes('morning')) {
    selectedTemplate = routineTemplates.morning;
  } else if (promptLower.includes('evening') || promptLower.includes('night')) {
    selectedTemplate = routineTemplates.evening;
  }

  return {
    routine: {
      ...selectedTemplate,
      description: `AI-generated routine based on: ${prompt}`,
      startTime: "09:00",
      endTime: "10:00",
      priority: "medium"
    },
    confidence: 0.6,
    reasoning: "Fallback routine generated when AI service is unavailable",
    alternatives: [],
    warnings: ["This is a basic template. Consider customizing based on your specific needs."]
  };
}

function getDefaultAIPreferences() {
  return {
    communicationStyle: 'encouraging',
    focusAreas: ['productivity', 'wellness'],
    preferredAdviceTypes: ['practical', 'motivational'],
    timeZone: 'UTC',
    workingHours: { start: '09:00', end: '17:00' },
    preferredBreakDuration: 15,
    energyPeakTimes: ['morning']
  };
}

function getDefaultADHDPreferences() {
  return {
    enabled: false,
    extraBufferTime: 5,
    simplifiedTasks: false,
    frequentBreaks: false,
    visualCues: true,
    gentleReminders: true
  };
}

function calculateEnergyPatterns(routineHistory, journalEntries) {
  const patterns = {};

  // Analyze completion times
  routineHistory.filter(h => h.completedAt).forEach(completion => {
    const hour = completion.completedAt.getHours();
    const timeSlot = getTimeSlot(hour);

    if (!patterns[timeSlot]) {
      patterns[timeSlot] = { completions: 0, totalEnergy: 0, count: 0 };
    }

    patterns[timeSlot].completions++;
    patterns[timeSlot].count++;
  });

  // Add journal mood data
  journalEntries.forEach(entry => {
    if (entry.createdAt && entry.mood) {
      const hour = entry.createdAt.toDate ? entry.createdAt.toDate().getHours() : new Date(entry.createdAt).getHours();
      const timeSlot = getTimeSlot(hour);
      const energyScore = getMoodEnergyScore(entry.mood);

      if (!patterns[timeSlot]) {
        patterns[timeSlot] = { completions: 0, totalEnergy: 0, count: 0 };
      }

      patterns[timeSlot].totalEnergy += energyScore;
      patterns[timeSlot].count++;
    }
  });

  // Convert to energy pattern array
  return Object.keys(patterns).map(timeSlot => ({
    timeOfDay: timeSlot,
    energyLevel: patterns[timeSlot].count > 0 ? Math.round(patterns[timeSlot].totalEnergy / patterns[timeSlot].count) : 5,
    productivityScore: patterns[timeSlot].completions,
    frequency: patterns[timeSlot].count
  })).sort((a, b) => b.productivityScore - a.productivityScore);
}

function getMoodEnergyScore(mood) {
  const moodScores = {
    'excellent': 9,
    'great': 8,
    'good': 7,
    'okay': 6,
    'neutral': 5,
    'tired': 3,
    'stressed': 4,
    'anxious': 3,
    'sad': 2,
    'frustrated': 3
  };

  return moodScores[mood.toLowerCase()] || 5;
}

function getMinimalAIContext(userId) {
  return {
    userId,
    userPreferences: getDefaultAIPreferences(),
    adhdPreferences: getDefaultADHDPreferences(),
    totalTasks: 0,
    completedTasks: 0,
    activeRoutines: 0,
    totalRoutines: 0,
    recentMood: null,
    energyPatterns: [],
    historicalData: [],
    overallCompletionRate: 0
  };
}

function generateAIContextSummary(context) {
  const summary = [];

  summary.push(`${context.completedTasks}/${context.totalTasks} tasks completed`);
  summary.push(`${context.activeRoutines} active routines`);

  if (context.overallCompletionRate > 0) {
    summary.push(`${Math.round(context.overallCompletionRate)}% completion rate`);
  }

  if (context.recentMood) {
    summary.push(`recent mood: ${context.recentMood}`);
  }

  if (context.energyPatterns.length > 0) {
    summary.push(`best time: ${context.energyPatterns[0].timeOfDay}`);
  }

  return summary.join(', ');
}

function validateAIPreferences(preferences) {
  const validStyles = ['encouraging', 'direct', 'gentle'];
  const validAdviceTypes = ['practical', 'motivational', 'analytical', 'creative'];

  return {
    communicationStyle: validStyles.includes(preferences.communicationStyle) ? preferences.communicationStyle : 'encouraging',
    focusAreas: Array.isArray(preferences.focusAreas) ? preferences.focusAreas : ['productivity'],
    preferredAdviceTypes: Array.isArray(preferences.preferredAdviceTypes) ? preferences.preferredAdviceTypes : ['practical'],
    timeZone: preferences.timeZone || 'UTC',
    workingHours: preferences.workingHours || { start: '09:00', end: '17:00' },
    preferredBreakDuration: Math.max(5, Math.min(60, preferences.preferredBreakDuration || 15)),
    energyPeakTimes: Array.isArray(preferences.energyPeakTimes) ? preferences.energyPeakTimes : ['morning']
  };
}

function formatUserMessage(message, userContext) {
  const contextInfo = [];

  if (userContext.totalTasks) {
    contextInfo.push(`Current tasks: ${userContext.completedTasks}/${userContext.totalTasks} completed`);
  }

  if (userContext.recentMood) {
    contextInfo.push(`Recent mood: ${userContext.recentMood}`);
  }

  if (userContext.activeRoutines) {
    contextInfo.push(`Active routines: ${userContext.activeRoutines}`);
  }

  const contextString = contextInfo.length > 0 ? `\n\nCurrent context: ${contextInfo.join(', ')}` : '';

  return `${message}${contextString}`;
}

// Generate quick suggestions based on context
function generateQuickSuggestions(userContext) {
  const suggestions = [];

  if (userContext.totalTasks && userContext.completedTasks < userContext.totalTasks) {
    suggestions.push('Help me prioritize my tasks');
  }

  if (userContext.recentMood === 'overwhelmed' || userContext.recentMood === 'stressed') {
    suggestions.push('I need calming strategies');
  }

  suggestions.push('Give me motivation');
  suggestions.push('Help with focus');
  suggestions.push('Celebrate my progress');

  return suggestions.slice(0, 3); // Limit to 3 suggestions
}

// Fallback response when OpenAI is not available
function getFallbackResponse(userMessage, userContext) {
  const responses = {
    greeting: [
      "Hello! I'm here to support you on your ADHD journey. How are you feeling today?",
      "Hi there! Ready to tackle the day together? What's on your mind?",
      "Hey! Great to see you. What would you like to work on today?"
    ],
    tasks: [
      `I see you have ${userContext.totalTasks} tasks with ${userContext.completedTasks} completed. That's great progress! Which task would you like to focus on next?`,
      "Let's break down your tasks into smaller, manageable steps. Which one feels most overwhelming right now?",
      "You're doing well with your tasks! Remember, progress over perfection. What's the next small step you can take?"
    ],
    motivation: [
      "You're doing amazing! Every small step counts, and you're building momentum. Keep going! 💪",
      "I believe in you! ADHD brains are incredibly creative and capable. You've got this! ✨",
      "Remember, your worth isn't measured by productivity. You're valuable just as you are. Let's celebrate what you've accomplished! 🎉"
    ],
    overwhelmed: [
      "I hear you. When things feel overwhelming, let's take it one breath at a time. What's one tiny thing you can do right now?",
      "Feeling overwhelmed is totally normal with ADHD. Let's break things down into smaller pieces. What feels most urgent?",
      "Take a deep breath. You don't have to do everything at once. What's one small win we can focus on?"
    ]
  };

  let responseType = 'greeting';
  const lowerMessage = userMessage.toLowerCase();

  if (lowerMessage.includes('task') || lowerMessage.includes('todo')) {
    responseType = 'tasks';
  } else if (lowerMessage.includes('motivat') || lowerMessage.includes('encourage')) {
    responseType = 'motivation';
  } else if (lowerMessage.includes('overwhelm') || lowerMessage.includes('stress') || lowerMessage.includes('anxious')) {
    responseType = 'overwhelmed';
  }

  const responseArray = responses[responseType];
  const message = responseArray[Math.floor(Math.random() * responseArray.length)];

  return {
    message,
    suggestions: generateQuickSuggestions(userContext)
  };
}

// Additional AI helper functions

async function getCalendarContext(userId) {
  // This would integrate with Google Calendar API
  // For now, return a placeholder structure
  return {
    upcomingEvents: [],
    freeTimeSlots: [],
    conflictingEvents: []
  };
}

async function getRoutineHistory(userId, routineId) {
  try {
    const historySnapshot = await db.collection('users')
      .doc(userId)
      .collection('routineHistory')
      .where('routineId', '==', routineId)
      .orderBy('completedAt', 'desc')
      .limit(20)
      .get();

    return historySnapshot.docs.map(doc => ({
      ...doc.data(),
      completedAt: doc.data().completedAt?.toDate(),
      skippedAt: doc.data().skippedAt?.toDate()
    }));
  } catch (error) {
    console.error('Error getting routine history:', error);
    return [];
  }
}

async function getHistoricalData(userId, timeframe) {
  try {
    const days = timeframe === '7d' ? 7 : timeframe === '30d' ? 30 : 90;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [routineHistorySnapshot, journalSnapshot, todosSnapshot] = await Promise.all([
      db.collection('users').doc(userId).collection('routineHistory')
        .where('completedAt', '>=', startDate)
        .get(),
      db.collection('users').doc(userId).collection('journal')
        .where('createdAt', '>=', startDate)
        .get(),
      db.collection('users').doc(userId).collection('todos')
        .where('completedAt', '>=', startDate.toISOString())
        .get()
    ]);

    const routineHistory = routineHistorySnapshot.docs.map(doc => ({
      ...doc.data(),
      completedAt: doc.data().completedAt?.toDate(),
      skippedAt: doc.data().skippedAt?.toDate()
    }));

    const journalEntries = journalSnapshot.docs.map(doc => doc.data());
    const todos = todosSnapshot.docs.map(doc => doc.data());

    return {
      routineHistory,
      journalEntries,
      todos,
      totalDataPoints: routineHistory.length + journalEntries.length + todos.length,
      timeframe
    };
  } catch (error) {
    console.error('Error getting historical data:', error);
    return { routineHistory: [], journalEntries: [], todos: [], totalDataPoints: 0, timeframe };
  }
}

async function generateGapSuggestion(gap, userContext) {
  try {
    const gapDuration = gap.duration;
    const gapTime = new Date(gap.startTime).getHours();
    const timeSlot = getTimeSlot(gapTime);

    // Find user's energy level for this time slot
    const energyPattern = userContext.energyPatterns.find(p => p.timeOfDay === timeSlot);
    const energyLevel = energyPattern ? energyPattern.energyLevel : 5;

    // Suggest appropriate activities based on duration and energy
    let suggestedActivities = [];

    if (gapDuration >= 60) {
      if (energyLevel >= 7) {
        suggestedActivities = ['Deep work session', 'Important project work', 'Learning new skill'];
      } else {
        suggestedActivities = ['Administrative tasks', 'Email processing', 'Planning session'];
      }
    } else if (gapDuration >= 30) {
      if (energyLevel >= 6) {
        suggestedActivities = ['Quick workout', 'Creative brainstorming', 'Problem solving'];
      } else {
        suggestedActivities = ['Organize workspace', 'Review notes', 'Light reading'];
      }
    } else {
      suggestedActivities = ['Quick break', 'Meditation', 'Stretch', 'Hydration break'];
    }

    return {
      timeSlot: gap,
      suggestedActivities,
      reasoning: `Based on your ${energyLevel}/10 energy level during ${timeSlot} and ${gapDuration} minutes available`,
      confidence: energyPattern ? 0.8 : 0.6
    };
  } catch (error) {
    console.error('Error generating gap suggestion:', error);
    return null;
  }
}

function generateAdaptationSystemPrompt(userContext, adaptationType) {
  return `You are an AI assistant specialized in adapting daily routines based on user feedback and behavioral patterns.

User Context:
- Overall completion rate: ${Math.round(userContext.overallCompletionRate)}%
- ADHD preferences: ${userContext.adhdPreferences?.enabled ? 'enabled' : 'disabled'}
- Recent mood: ${userContext.recentMood || 'not specified'}
- Active routines: ${userContext.activeRoutines}

Adaptation Type: ${adaptationType}

Guidelines:
1. Analyze the feedback to identify specific pain points
2. Suggest concrete, actionable changes
3. Consider the user's completion patterns and preferences
4. If ADHD preferences are enabled, prioritize simplification and buffer time
5. Provide reasoning for each suggested change
6. Be realistic about what changes are likely to improve adherence

Response format: JSON object with:
{
  "suggestedChanges": [
    {
      "type": "time_adjustment|task_modification|schedule_change|simplification",
      "description": "string describing the change",
      "rationale": "string explaining why this change helps",
      "impact": "low|medium|high"
    }
  ],
  "reasoning": "string explaining overall adaptation strategy",
  "confidence": number (0-1)
}`;
}

function formatAdaptationPrompt(routine, feedback, routineHistory) {
  let prompt = `Adapt this routine based on user feedback:

Routine: ${routine.title}
Tasks: ${routine.tasks.map(t => `- ${t.title} (${t.estimatedDuration}min)`).join('\n')}

User Feedback: ${JSON.stringify(feedback)}`;

  if (routineHistory.length > 0) {
    const completions = routineHistory.filter(h => h.completedAt).length;
    const skips = routineHistory.filter(h => h.skippedAt).length;
    const completionRate = ((completions / (completions + skips)) * 100).toFixed(1);

    prompt += `\n\nHistorical Performance:
- Completion rate: ${completionRate}%
- Total attempts: ${completions + skips}
- Recent skip reasons: ${routineHistory.filter(h => h.skipReason).map(h => h.skipReason).slice(0, 3).join(', ')}`;
  }

  return prompt;
}

function getAdaptationFallback(routine, feedback) {
  const changes = [];

  // Basic adaptations based on common feedback patterns
  if (feedback.feedbackType === 'skip' && feedback.comment?.includes('time')) {
    changes.push({
      type: 'time_adjustment',
      description: 'Reduce estimated time for tasks by 20%',
      rationale: 'User indicated time constraints as an issue',
      impact: 'medium'
    });
  }

  if (feedback.feedbackType === 'delay') {
    changes.push({
      type: 'schedule_change',
      description: 'Add 10 minutes buffer time between tasks',
      rationale: 'User experiences delays, more buffer time may help',
      impact: 'low'
    });
  }

  if (feedback.rating && feedback.rating < 3) {
    changes.push({
      type: 'simplification',
      description: 'Consider breaking down complex tasks into smaller steps',
      rationale: 'Low rating suggests routine may be too challenging',
      impact: 'high'
    });
  }

  return {
    suggestedChanges: changes,
    reasoning: 'Basic adaptations based on feedback patterns (AI service unavailable)',
    confidence: 0.4
  };
}

function analyzeUserPatterns(userContext, historicalData) {
  const insights = [];

  // Analyze completion patterns
  const completions = historicalData.routineHistory.filter(h => h.completedAt);
  if (completions.length > 5) {
    const timePattern = analyzeCompletionTimes(completions);
    if (timePattern.bestTimeSlot) {
      insights.push({
        type: 'pattern',
        title: 'Optimal Performance Window',
        message: `You complete routines most successfully during ${timePattern.bestTimeSlot}. Consider scheduling important routines during this time.`,
        confidence: 0.8,
        priority: 'medium'
      });
    }
  }

  // Analyze mood patterns
  const moodEntries = historicalData.journalEntries.filter(j => j.mood);
  if (moodEntries.length > 3) {
    const moodPattern = analyzeMoodPatterns(moodEntries);
    if (moodPattern.insight) {
      insights.push({
        type: 'pattern',
        title: 'Mood and Productivity Connection',
        message: moodPattern.insight,
        confidence: 0.7,
        priority: 'medium'
      });
    }
  }

  return insights;
}

function analyzePerformanceInsights(userContext, historicalData) {
  const insights = [];

  // Performance trend analysis
  const completions = historicalData.routineHistory.filter(h => h.completedAt);
  if (completions.length > 10) {
    const trend = calculateTrends(completions);

    if (trend.trend === 'improving') {
      insights.push({
        type: 'performance',
        title: 'Positive Trend Detected',
        message: 'Your routine completion rate has been improving over the past few weeks. Keep up the great work!',
        confidence: 0.8,
        priority: 'high'
      });
    } else if (trend.trend === 'declining') {
      insights.push({
        type: 'performance',
        title: 'Performance Dip Noticed',
        message: 'Your routine completion has decreased recently. Consider reviewing your current routines for potential adjustments.',
        confidence: 0.8,
        priority: 'high'
      });
    }
  }

  return insights;
}

function generateOptimizationInsights(userContext, historicalData) {
  const insights = [];

  // Time optimization insights
  const completions = historicalData.routineHistory.filter(h => h.actualDuration);
  if (completions.length > 5) {
    const avgActual = completions.reduce((sum, c) => sum + c.actualDuration, 0) / completions.length;
    const avgEstimated = completions.reduce((sum, c) => sum + (c.estimatedDuration || 30), 0) / completions.length;

    if (avgActual > avgEstimated * 1.3) {
      insights.push({
        type: 'optimization',
        title: 'Time Estimation Adjustment',
        message: `You typically take ${Math.round(((avgActual / avgEstimated) - 1) * 100)}% longer than estimated. Consider adjusting your time estimates.`,
        confidence: 0.8,
        priority: 'medium'
      });
    }
  }

  return insights;
}

function generateADHDInsights(userContext, historicalData) {
  const insights = [];

  if (!userContext.adhdPreferences?.enabled) {
    return insights;
  }

  // ADHD-specific pattern analysis
  const skips = historicalData.routineHistory.filter(h => h.skippedAt);
  const skipReasons = skips.reduce((acc, skip) => {
    const reason = skip.skipReason || 'Unknown';
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});

  // Common ADHD challenges
  if (skipReasons['Forgot'] > 2) {
    insights.push({
      type: 'adhd',
      title: 'Memory Support Needed',
      message: 'Forgetting routines is common with ADHD. Consider setting up multiple reminders and visual cues.',
      confidence: 0.9,
      priority: 'high',
      suggestions: [
        'Set up phone reminders 15 minutes before routine time',
        'Place visual cues in your environment',
        'Use habit stacking - link routines to existing habits'
      ]
    });
  }

  if (skipReasons['Not in the mood'] > 2) {
    insights.push({
      type: 'adhd',
      title: 'Motivation Strategies',
      message: 'ADHD can make it hard to start tasks when not feeling motivated. Try the 2-minute rule or reward systems.',
      confidence: 0.8,
      priority: 'medium',
      suggestions: [
        'Commit to just 2 minutes to get started',
        'Set up small rewards for completion',
        'Find an accountability partner'
      ]
    });
  }

  return insights;
}

function analyzeMoodPatterns(moodEntries) {
  const moodCounts = moodEntries.reduce((acc, entry) => {
    acc[entry.mood] = (acc[entry.mood] || 0) + 1;
    return acc;
  }, {});

  const dominantMood = Object.keys(moodCounts).reduce((a, b) =>
    moodCounts[a] > moodCounts[b] ? a : b
  );

  const positiveCount = moodEntries.filter(e =>
    ['excellent', 'great', 'good'].includes(e.mood.toLowerCase())
  ).length;

  const totalEntries = moodEntries.length;
  const positiveRatio = positiveCount / totalEntries;

  if (positiveRatio > 0.7) {
    return {
      insight: `Your mood has been predominantly positive (${Math.round(positiveRatio * 100)}% positive entries). This correlates with better routine adherence.`
    };
  } else if (positiveRatio < 0.3) {
    return {
      insight: `Your recent mood entries show some challenges. Consider incorporating mood-boosting activities into your routines.`
    };
  }

  return { insight: null };
}

// --- Calendar Sync Backend Support API Endpoints ---

// Store Google Calendar OAuth tokens
app.post('/api/calendar/oauth/tokens', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { accessToken, refreshToken, expiryDate, scope } = req.body;

    if (!accessToken || !refreshToken) {
      return res.status(400).json({ message: 'Access token and refresh token are required' });
    }

    // Store tokens securely
    await db.collection('users').doc(userId).set({
      calendarTokens: {
        accessToken: accessToken, // In production, encrypt this
        refreshToken: refreshToken, // In production, encrypt this
        expiryDate: expiryDate || null,
        scope: scope || 'https://www.googleapis.com/auth/calendar',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }
    }, { merge: true });

    res.status(200).json({ message: 'Calendar tokens stored successfully' });
  } catch (error) {
    console.error('Error storing calendar tokens:', error);
    res.status(500).json({ message: 'Failed to store calendar tokens', error: error.message });
  }
});

// Get calendar authentication status
app.get('/api/calendar/auth/status', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;

    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    const hasTokens = userData.calendarTokens && userData.calendarTokens.accessToken;
    const isExpired = hasTokens && userData.calendarTokens.expiryDate &&
      new Date(userData.calendarTokens.expiryDate) < new Date();

    res.status(200).json({
      isAuthenticated: hasTokens && !isExpired,
      hasTokens,
      isExpired,
      scope: userData.calendarTokens?.scope || null,
      lastUpdated: userData.calendarTokens?.updatedAt?.toDate() || null
    });
  } catch (error) {
    console.error('Error checking calendar auth status:', error);
    res.status(500).json({ message: 'Failed to check calendar auth status', error: error.message });
  }
});

// Refresh Google Calendar tokens
app.post('/api/calendar/oauth/refresh', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;

    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    const refreshToken = userData.calendarTokens?.refreshToken;

    if (!refreshToken) {
      return res.status(400).json({ message: 'No refresh token available. Re-authentication required.' });
    }

    // In a real implementation, you would use Google's OAuth2 client to refresh the token
    // For now, we'll simulate the process
    const newTokens = await refreshGoogleCalendarTokens(refreshToken);

    await db.collection('users').doc(userId).update({
      'calendarTokens.accessToken': newTokens.accessToken,
      'calendarTokens.expiryDate': newTokens.expiryDate,
      'calendarTokens.updatedAt': admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(200).json({
      message: 'Tokens refreshed successfully',
      expiryDate: newTokens.expiryDate
    });
  } catch (error) {
    console.error('Error refreshing calendar tokens:', error);
    res.status(500).json({ message: 'Failed to refresh calendar tokens', error: error.message });
  }
});

// Revoke calendar access
app.delete('/api/calendar/oauth/revoke', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;

    // Remove tokens from database
    await db.collection('users').doc(userId).update({
      calendarTokens: admin.firestore.FieldValue.delete()
    });

    res.status(200).json({ message: 'Calendar access revoked successfully' });
  } catch (error) {
    console.error('Error revoking calendar access:', error);
    res.status(500).json({ message: 'Failed to revoke calendar access', error: error.message });
  }
});

// Sync routine to Google Calendar
app.post('/api/calendar/sync/routine/:routineId', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const routineId = req.params.routineId;
    const { calendarId, privacyLevel = 'full' } = req.body;

    // Get routine
    const routineDoc = await db.collection('users').doc(userId).collection('routines').doc(routineId).get();
    if (!routineDoc.exists) {
      return res.status(404).json({ message: 'Routine not found' });
    }

    const routine = routineDoc.data();

    // Check calendar authentication
    const authStatus = await checkCalendarAuth(userId);
    if (!authStatus.isAuthenticated) {
      return res.status(401).json({ message: 'Calendar authentication required' });
    }

    // Create calendar events for routine tasks
    const eventIds = await createCalendarEventsForRoutine(routine, authStatus.tokens, calendarId, privacyLevel);

    // Update routine with calendar sync info
    await db.collection('users').doc(userId).collection('routines').doc(routineId).update({
      'calendarSync.enabled': true,
      'calendarSync.calendarId': calendarId || 'primary',
      'calendarSync.eventIds': eventIds,
      'calendarSync.privacyLevel': privacyLevel,
      'calendarSync.lastSyncAt': admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(200).json({
      message: 'Routine synced to calendar successfully',
      eventIds,
      syncedTasks: routine.tasks.length
    });
  } catch (error) {
    console.error('Error syncing routine to calendar:', error);
    res.status(500).json({ message: 'Failed to sync routine to calendar', error: error.message });
  }
});

// Update calendar events for routine
app.put('/api/calendar/sync/routine/:routineId', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const routineId = req.params.routineId;

    // Get routine
    const routineDoc = await db.collection('users').doc(userId).collection('routines').doc(routineId).get();
    if (!routineDoc.exists) {
      return res.status(404).json({ message: 'Routine not found' });
    }

    const routine = routineDoc.data();

    if (!routine.calendarSync?.enabled || !routine.calendarSync?.eventIds?.length) {
      return res.status(400).json({ message: 'Routine is not synced to calendar' });
    }

    // Check calendar authentication
    const authStatus = await checkCalendarAuth(userId);
    if (!authStatus.isAuthenticated) {
      return res.status(401).json({ message: 'Calendar authentication required' });
    }

    // Update calendar events
    const updatedEventIds = await updateCalendarEventsForRoutine(
      routine,
      authStatus.tokens,
      routine.calendarSync.calendarId,
      routine.calendarSync.privacyLevel
    );

    // Update routine with new event IDs
    await db.collection('users').doc(userId).collection('routines').doc(routineId).update({
      'calendarSync.eventIds': updatedEventIds,
      'calendarSync.lastSyncAt': admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(200).json({
      message: 'Calendar events updated successfully',
      eventIds: updatedEventIds
    });
  } catch (error) {
    console.error('Error updating calendar events:', error);
    res.status(500).json({ message: 'Failed to update calendar events', error: error.message });
  }
});

// Remove routine from calendar
app.delete('/api/calendar/sync/routine/:routineId', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const routineId = req.params.routineId;

    // Get routine
    const routineDoc = await db.collection('users').doc(userId).collection('routines').doc(routineId).get();
    if (!routineDoc.exists) {
      return res.status(404).json({ message: 'Routine not found' });
    }

    const routine = routineDoc.data();

    if (!routine.calendarSync?.enabled || !routine.calendarSync?.eventIds?.length) {
      return res.status(400).json({ message: 'Routine is not synced to calendar' });
    }

    // Check calendar authentication
    const authStatus = await checkCalendarAuth(userId);
    if (!authStatus.isAuthenticated) {
      return res.status(401).json({ message: 'Calendar authentication required' });
    }

    // Delete calendar events
    await deleteCalendarEvents(routine.calendarSync.eventIds, authStatus.tokens, routine.calendarSync.calendarId);

    // Update routine to disable calendar sync
    await db.collection('users').doc(userId).collection('routines').doc(routineId).update({
      'calendarSync.enabled': false,
      'calendarSync.eventIds': [],
      'calendarSync.lastSyncAt': admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(200).json({ message: 'Routine removed from calendar successfully' });
  } catch (error) {
    console.error('Error removing routine from calendar:', error);
    res.status(500).json({ message: 'Failed to remove routine from calendar', error: error.message });
  }
});

// Get calendar events for conflict detection
app.get('/api/calendar/events', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { startDate, endDate, calendarId = 'primary' } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'Start date and end date are required' });
    }

    // Check calendar authentication
    const authStatus = await checkCalendarAuth(userId);
    if (!authStatus.isAuthenticated) {
      return res.status(401).json({ message: 'Calendar authentication required' });
    }

    // Fetch calendar events
    const events = await fetchCalendarEvents(
      authStatus.tokens,
      calendarId,
      new Date(startDate),
      new Date(endDate)
    );

    res.status(200).json({
      events,
      calendarId,
      dateRange: { startDate, endDate }
    });
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    res.status(500).json({ message: 'Failed to fetch calendar events', error: error.message });
  }
});

// Detect conflicts for routine scheduling
app.post('/api/calendar/conflicts/detect', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { routineId, proposedStartTime, proposedEndTime, calendarId = 'primary' } = req.body;

    if (!routineId || !proposedStartTime || !proposedEndTime) {
      return res.status(400).json({ message: 'Routine ID, start time, and end time are required' });
    }

    // Check calendar authentication
    const authStatus = await checkCalendarAuth(userId);
    if (!authStatus.isAuthenticated) {
      return res.status(401).json({ message: 'Calendar authentication required' });
    }

    // Get routine
    const routineDoc = await db.collection('users').doc(userId).collection('routines').doc(routineId).get();
    if (!routineDoc.exists) {
      return res.status(404).json({ message: 'Routine not found' });
    }

    const routine = routineDoc.data();

    // Detect conflicts
    const conflicts = await detectCalendarConflicts(
      authStatus.tokens,
      calendarId,
      new Date(proposedStartTime),
      new Date(proposedEndTime),
      routine
    );

    // Generate alternative time slots if conflicts exist
    let alternatives = [];
    if (conflicts.length > 0) {
      alternatives = await generateAlternativeTimeSlots(
        authStatus.tokens,
        calendarId,
        new Date(proposedStartTime),
        routine
      );
    }

    res.status(200).json({
      hasConflicts: conflicts.length > 0,
      conflicts,
      alternatives,
      routine: {
        id: routine.id,
        title: routine.title,
        estimatedDuration: routine.tasks.reduce((sum, task) => sum + task.estimatedDuration + task.bufferTime, 0)
      }
    });
  } catch (error) {
    console.error('Error detecting calendar conflicts:', error);
    res.status(500).json({ message: 'Failed to detect calendar conflicts', error: error.message });
  }
});

// Get free time slots for routine scheduling
app.get('/api/calendar/free-slots', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { date, minDuration = 30, maxSlots = 10, calendarId = 'primary' } = req.query;

    if (!date) {
      return res.status(400).json({ message: 'Date is required' });
    }

    // Check calendar authentication
    const authStatus = await checkCalendarAuth(userId);
    if (!authStatus.isAuthenticated) {
      return res.status(401).json({ message: 'Calendar authentication required' });
    }

    // Find free time slots
    const freeSlots = await findFreeTimeSlots(
      authStatus.tokens,
      calendarId,
      new Date(date),
      parseInt(minDuration),
      parseInt(maxSlots)
    );

    res.status(200).json({
      date,
      freeSlots,
      criteria: {
        minDuration: parseInt(minDuration),
        maxSlots: parseInt(maxSlots)
      }
    });
  } catch (error) {
    console.error('Error finding free time slots:', error);
    res.status(500).json({ message: 'Failed to find free time slots', error: error.message });
  }
});

// --- Calendar Helper Functions ---

async function checkCalendarAuth(userId) {
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return { isAuthenticated: false };
    }

    const userData = userDoc.data();
    const tokens = userData.calendarTokens;

    if (!tokens || !tokens.accessToken) {
      return { isAuthenticated: false };
    }

    const isExpired = tokens.expiryDate && new Date(tokens.expiryDate) < new Date();

    return {
      isAuthenticated: !isExpired,
      tokens,
      isExpired
    };
  } catch (error) {
    console.error('Error checking calendar auth:', error);
    return { isAuthenticated: false };
  }
}

async function refreshGoogleCalendarTokens(refreshToken) {
  // In a real implementation, this would make a request to Google's OAuth2 token endpoint
  // For now, we'll simulate the response
  const newExpiryDate = new Date();
  newExpiryDate.setHours(newExpiryDate.getHours() + 1); // 1 hour from now

  return {
    accessToken: 'new_access_token_' + Date.now(),
    expiryDate: newExpiryDate.toISOString()
  };
}

async function createCalendarEventsForRoutine(routine, tokens, calendarId, privacyLevel) {
  // In a real implementation, this would use Google Calendar API
  // For now, we'll simulate creating events and return mock event IDs
  const eventIds = [];

  for (const task of routine.tasks) {
    const eventId = `event_${routine.id}_${task.id}_${Date.now()}`;
    eventIds.push(eventId);

    // Log the event creation for debugging
    console.log(`Created calendar event: ${eventId} for task: ${task.title}`);
  }

  return eventIds;
}

async function updateCalendarEventsForRoutine(routine, tokens, calendarId, privacyLevel) {
  // In a real implementation, this would update existing events via Google Calendar API
  // For now, we'll simulate by creating new event IDs
  const eventIds = [];

  for (const task of routine.tasks) {
    const eventId = `updated_event_${routine.id}_${task.id}_${Date.now()}`;
    eventIds.push(eventId);

    console.log(`Updated calendar event: ${eventId} for task: ${task.title}`);
  }

  return eventIds;
}

async function deleteCalendarEvents(eventIds, tokens, calendarId) {
  // In a real implementation, this would delete events via Google Calendar API
  for (const eventId of eventIds) {
    console.log(`Deleted calendar event: ${eventId}`);
  }
}

async function fetchCalendarEvents(tokens, calendarId, startDate, endDate) {
  // In a real implementation, this would fetch events from Google Calendar API
  // For now, return mock events
  return [
    {
      id: 'mock_event_1',
      title: 'Existing Meeting',
      startTime: new Date(startDate.getTime() + 2 * 60 * 60 * 1000), // 2 hours after start
      endTime: new Date(startDate.getTime() + 3 * 60 * 60 * 1000), // 3 hours after start
      description: 'Mock calendar event',
      isAllDay: false
    }
  ];
}

async function detectCalendarConflicts(tokens, calendarId, startTime, endTime, routine) {
  // In a real implementation, this would check for conflicts via Google Calendar API
  const events = await fetchCalendarEvents(tokens, calendarId, startTime, endTime);

  const conflicts = events.filter(event => {
    const eventStart = new Date(event.startTime);
    const eventEnd = new Date(event.endTime);

    // Check for time overlap
    return (startTime < eventEnd && endTime > eventStart);
  });

  return conflicts;
}

async function generateAlternativeTimeSlots(tokens, calendarId, originalStartTime, routine) {
  // In a real implementation, this would analyze the calendar and suggest alternatives
  const routineDuration = routine.tasks.reduce((sum, task) => sum + task.estimatedDuration + task.bufferTime, 0);

  const alternatives = [];
  const baseDate = new Date(originalStartTime);

  // Generate 3 alternative time slots
  for (let i = 1; i <= 3; i++) {
    const altStart = new Date(baseDate.getTime() + (i * 2 * 60 * 60 * 1000)); // 2 hours later each time
    const altEnd = new Date(altStart.getTime() + (routineDuration * 60 * 1000));

    alternatives.push({
      startTime: altStart.toISOString(),
      endTime: altEnd.toISOString(),
      duration: routineDuration,
      confidence: 0.8 - (i * 0.1) // Decreasing confidence for later slots
    });
  }

  return alternatives;
}

async function findFreeTimeSlots(tokens, calendarId, date, minDuration, maxSlots) {
  // In a real implementation, this would analyze the calendar for free slots
  const freeSlots = [];
  const startOfDay = new Date(date);
  startOfDay.setHours(9, 0, 0, 0); // Start at 9 AM

  const endOfDay = new Date(date);
  endOfDay.setHours(17, 0, 0, 0); // End at 5 PM

  // Generate mock free slots
  let currentTime = new Date(startOfDay);
  let slotCount = 0;

  while (currentTime < endOfDay && slotCount < maxSlots) {
    const slotEnd = new Date(currentTime.getTime() + (minDuration * 60 * 1000));

    if (slotEnd <= endOfDay) {
      freeSlots.push({
        startTime: new Date(currentTime).toISOString(),
        endTime: slotEnd.toISOString(),
        duration: minDuration
      });
      slotCount++;
    }

    // Move to next potential slot (add 1 hour)
    currentTime.setHours(currentTime.getHours() + 1);
  }

  return freeSlots;
}

// --- Log Retention and Data Management API Endpoints ---

// Request user log deletion (GDPR compliance)
app.post('/api/logs/delete-user-data', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { reason = 'user_request' } = req.body;

    logger.info('User log deletion requested', {
      userId,
      reason,
      correlationId: req.correlationId
    });

    const result = await logRetentionService.requestUserLogDeletion(userId, reason);

    if (result.success) {
      logger.info('User log deletion completed', {
        userId,
        requestId: result.requestId,
        deletedFiles: result.deletedFiles?.length || 0,
        correlationId: req.correlationId
      });

      res.status(200).json({
        message: 'User logs deleted successfully',
        requestId: result.requestId,
        deletedFiles: result.deletedFiles
      });
    } else {
      logger.error('User log deletion failed', new Error(result.error), {
        userId,
        requestId: result.requestId,
        correlationId: req.correlationId
      });

      res.status(500).json({
        message: 'Failed to delete user logs',
        requestId: result.requestId,
        error: result.error
      });
    }
  } catch (error) {
    logger.error('Error processing user log deletion request', error, {
      userId: req.user?.uid,
      correlationId: req.correlationId
    });
    res.status(500).json({
      message: 'Failed to process log deletion request',
      error: error.message
    });
  }
});

// Get user log deletion request status
app.get('/api/logs/deletion-requests/:requestId', verifyToken, async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user.uid;

    const request = logRetentionService.getDeletionRequestStatus(requestId);

    if (!request) {
      return res.status(404).json({ message: 'Deletion request not found' });
    }

    // Ensure user can only access their own deletion requests
    if (request.userId !== userId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.status(200).json({
      requestId,
      status: request.status,
      requestedAt: request.requestedAt,
      processedAt: request.processedAt,
      deletedFiles: request.deletedFiles,
      errors: request.errors
    });
  } catch (error) {
    logger.error('Error fetching deletion request status', error, {
      requestId: req.params.requestId,
      userId: req.user?.uid,
      correlationId: req.correlationId
    });
    res.status(500).json({
      message: 'Failed to fetch deletion request status',
      error: error.message
    });
  }
});

// Get all user deletion requests
app.get('/api/logs/deletion-requests', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;

    const requests = logRetentionService.getUserDeletionRequests(userId);

    res.status(200).json({
      requests: requests.map(request => ({
        id: request.id,
        status: request.status,
        reason: request.reason,
        requestedAt: request.requestedAt,
        processedAt: request.processedAt,
        deletedFiles: request.deletedFiles.length,
        errors: request.errors.length
      }))
    });
  } catch (error) {
    logger.error('Error fetching user deletion requests', error, {
      userId: req.user?.uid,
      correlationId: req.correlationId
    });
    res.status(500).json({
      message: 'Failed to fetch deletion requests',
      error: error.message
    });
  }
});

// Get log retention statistics (admin endpoint)
app.get('/api/logs/retention/stats', verifyToken, async (req, res) => {
  try {
    // Simple admin check - in production, implement proper role-based access
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    const userData = userDoc.data();
    
    if (!userData?.isAdmin) {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const stats = await logRetentionService.getRetentionStats();

    res.status(200).json({
      stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error fetching retention statistics', error, {
      userId: req.user?.uid,
      correlationId: req.correlationId
    });
    res.status(500).json({
      message: 'Failed to fetch retention statistics',
      error: error.message
    });
  }
});

// Manually trigger log purge (admin endpoint)
app.post('/api/logs/retention/purge', verifyToken, async (req, res) => {
  try {
    // Simple admin check - in production, implement proper role-based access
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    const userData = userDoc.data();
    
    if (!userData?.isAdmin) {
      return res.status(403).json({ message: 'Admin access required' });
    }

    logger.info('Manual log purge triggered', {
      userId: req.user.uid,
      correlationId: req.correlationId
    });

    const result = await logRetentionService.purgeOldLogs();

    if (result.success) {
      logger.info('Manual log purge completed', {
        purgedEntries: result.purgedEntries,
        processedFiles: result.processedFiles,
        deletedFiles: result.deletedFiles,
        correlationId: req.correlationId
      });

      res.status(200).json({
        message: 'Log purge completed successfully',
        purgedEntries: result.purgedEntries,
        processedFiles: result.processedFiles,
        deletedFiles: result.deletedFiles
      });
    } else {
      logger.error('Manual log purge failed', new Error(result.error), {
        correlationId: req.correlationId
      });

      res.status(500).json({
        message: 'Log purge failed',
        error: result.error
      });
    }
  } catch (error) {
    logger.error('Error triggering manual log purge', error, {
      userId: req.user?.uid,
      correlationId: req.correlationId
    });
    res.status(500).json({
      message: 'Failed to trigger log purge',
      error: error.message
    });
  }
});

// Update retention configuration (admin endpoint)
app.put('/api/logs/retention/config', verifyToken, async (req, res) => {
  try {
    // Simple admin check - in production, implement proper role-based access
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    const userData = userDoc.data();
    
    if (!userData?.isAdmin) {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { retentionDays, enableAutoPurge, purgeInterval } = req.body;

    const newConfig = {};
    if (retentionDays !== undefined) newConfig.retentionDays = parseInt(retentionDays);
    if (enableAutoPurge !== undefined) newConfig.enableAutoPurge = Boolean(enableAutoPurge);
    if (purgeInterval !== undefined) newConfig.purgeInterval = parseInt(purgeInterval);

    logRetentionService.updateConfig(newConfig);

    logger.info('Log retention configuration updated', {
      newConfig,
      userId: req.user.uid,
      correlationId: req.correlationId
    });

    res.status(200).json({
      message: 'Retention configuration updated successfully',
      config: newConfig
    });
  } catch (error) {
    logger.error('Error updating retention configuration', error, {
      userId: req.user?.uid,
      correlationId: req.correlationId
    });
    res.status(500).json({
      message: 'Failed to update retention configuration',
      error: error.message
    });
  }
});

// Add error handling middleware (must be last)
app.use(errorLoggingMiddleware);

// Global error handler
app.use((error, req, res, next) => {
  logger.error('Unhandled application error', error, {
    correlationId: req.correlationId,
    method: req.method,
    url: req.url,
    userId: req.user?.uid
  });
  
  res.status(500).json({
    message: 'Internal server error',
    correlationId: req.correlationId
  });
});

// Function to find available port
const findAvailablePort = (startPort) => {
  return new Promise((resolve, reject) => {
    const server = app.listen(startPort, () => {
      const actualPort = server.address().port;
      resolve({ server, port: actualPort });
    });
    
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`Port ${startPort} is busy, trying ${startPort + 1}...`);
        findAvailablePort(startPort + 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
  });
};

// Start server with port conflict resolution
findAvailablePort(PORT)
  .then(({ server, port }) => {
    logger.info('Server started successfully', {
      port: port,
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString()
    });
    console.log(`🚀 Server is running on port ${port}`);
    
    // Graceful shutdown handling
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully');
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });
    
    process.on('SIGINT', () => {
      console.log('SIGINT received, shutting down gracefully');
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });
  })
  .catch((err) => {
    logger.error('Failed to start server', {
      error: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString()
    });
    console.error('❌ Failed to start server:', err.message);
    process.exit(1);
  });

// Graceful shutdown handling
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  logRetentionService.shutdown();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  logRetentionService.shutdown();
  process.exit(0);
});