import express from 'express';
import { OpenAIService } from '../services/openaiService';
import { ConversationManager } from '../services/conversationManager';
import { ContextAggregator } from '../services/contextAggregator';
import { authenticateToken } from '../middleware/auth';
import { Message, CoachResponse } from '../types/coach';

const router = express.Router();
const openaiService = new OpenAIService();
const conversationManager = new ConversationManager();
const contextAggregator = new ContextAggregator();

// Send message to AI coach
router.post('/message', authenticateToken, async (req, res) => {
  try {
    const { message } = req.body;
    const userId = req.user.uid;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Get or create conversation
    const conversation = await conversationManager.getOrCreateConversation(userId);
    
    // Get current user context
    const userContext = await contextAggregator.aggregateUserContext(userId);
    
    // Update conversation with latest context
    await conversationManager.updateUserContext(conversation.id, userContext);
    
    // Get conversation context for AI
    const conversationContext = await conversationManager.getConversationContext(conversation.id);
    
    // Add user message to conversation
    const userMessage: Omit<Message, 'id'> = {
      role: 'user',
      content: message,
      timestamp: new Date(),
      context: {
        taskCount: userContext.currentStats?.totalTasks,
        completedTasks: userContext.currentStats?.completedTasks,
        currentMood: userContext.currentStats?.recentMood,
        activeRoutines: userContext.currentStats?.activeRoutines
      }
    };
    
    await conversationManager.addMessage(conversation.id, userMessage);
    
    // Generate AI response
    const aiResponse = await openaiService.generateResponse(
      message,
      conversationContext,
      userContext
    );
    
    // Add AI response to conversation
    const assistantMessage: Omit<Message, 'id'> = {
      role: 'assistant',
      content: aiResponse.message,
      timestamp: new Date()
    };
    
    await conversationManager.addMessage(conversation.id, assistantMessage);
    
    // Return response with conversation ID
    const response: CoachResponse = {
      ...aiResponse,
      conversationId: conversation.id
    };
    
    res.json(response);
  } catch (error) {
    console.error('Error in coach message endpoint:', error);
    res.status(500).json({ 
      error: 'Failed to process message',
      message: 'I apologize, but I encountered an issue. Please try again in a moment.'
    });
  }
});

// Get conversation history
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const limit = parseInt(req.query.limit as string) || 50;
    
    const history = await conversationManager.getConversationHistory(userId, limit);
    
    res.json({ messages: history });
  } catch (error) {
    console.error('Error getting conversation history:', error);
    res.status(500).json({ error: 'Failed to load conversation history' });
  }
});

// Update user preferences
router.put('/preferences', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { preferences } = req.body;
    
    if (!preferences) {
      return res.status(400).json({ error: 'Preferences are required' });
    }
    
    await conversationManager.updateUserPreferences(userId, preferences);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating preferences:', error);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// Generate proactive message
router.post('/proactive', authenticateToken, async (req, res) => {
  try {
    const { trigger } = req.body;
    const userId = req.user.uid;
    
    if (!trigger) {
      return res.status(400).json({ error: 'Trigger is required' });
    }
    
    const userContext = await contextAggregator.aggregateUserContext(userId);
    const proactiveMessage = await openaiService.generateProactiveMessage(trigger, userContext);
    
    res.json({ message: proactiveMessage });
  } catch (error) {
    console.error('Error generating proactive message:', error);
    res.status(500).json({ error: 'Failed to generate proactive message' });
  }
});

// Get user context summary
router.get('/context', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    
    const context = await contextAggregator.aggregateUserContext(userId);
    const summary = await contextAggregator.getContextSummary(userId);
    
    res.json({ 
      context: context.currentStats,
      summary 
    });
  } catch (error) {
    console.error('Error getting user context:', error);
    res.status(500).json({ error: 'Failed to load user context' });
  }
});

// Archive current conversation
router.post('/archive', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    
    const conversation = await conversationManager.getOrCreateConversation(userId);
    await conversationManager.archiveConversation(conversation.id);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error archiving conversation:', error);
    res.status(500).json({ error: 'Failed to archive conversation' });
  }
});

export default router;