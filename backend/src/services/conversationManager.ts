import { db } from '../config/firebase';
import { 
  ConversationEntry, 
  Message, 
  UserContext, 
  ConversationContext,
  UserPreferences 
} from '../types/coach';
import { v4 as uuidv4 } from 'uuid';

export class ConversationManager {
  private readonly COLLECTION_NAME = 'coach_conversations';
  private readonly MAX_CONTEXT_MESSAGES = 10;

  async getOrCreateConversation(userId: string): Promise<ConversationEntry> {
    try {
      // Try to get active conversation
      const activeConversationQuery = await db
        .collection(this.COLLECTION_NAME)
        .where('userId', '==', userId)
        .where('isActive', '==', true)
        .limit(1)
        .get();

      if (!activeConversationQuery.empty) {
        const doc = activeConversationQuery.docs[0];
        return { id: doc.id, ...doc.data() } as ConversationEntry;
      }

      // Create new conversation if none exists
      const newConversation: Omit<ConversationEntry, 'id'> = {
        userId,
        messages: [],
        context: { userId },
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: true
      };

      const docRef = await db.collection(this.COLLECTION_NAME).add(newConversation);
      return { id: docRef.id, ...newConversation };
    } catch (error) {
      console.error('Error getting/creating conversation:', error);
      throw new Error('Failed to initialize conversation');
    }
  }

  async addMessage(conversationId: string, message: Omit<Message, 'id'>): Promise<Message> {
    try {
      const messageWithId: Message = {
        ...message,
        id: uuidv4(),
        timestamp: new Date()
      };

      await db.collection(this.COLLECTION_NAME).doc(conversationId).update({
        messages: db.FieldValue.arrayUnion(messageWithId),
        updatedAt: new Date()
      });

      return messageWithId;
    } catch (error) {
      console.error('Error adding message:', error);
      throw new Error('Failed to save message');
    }
  }

  async getConversationContext(conversationId: string): Promise<ConversationContext> {
    try {
      const doc = await db.collection(this.COLLECTION_NAME).doc(conversationId).get();
      
      if (!doc.exists) {
        throw new Error('Conversation not found');
      }

      const conversation = doc.data() as ConversationEntry;
      const recentMessages = conversation.messages
        .slice(-this.MAX_CONTEXT_MESSAGES)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      return {
        conversationId,
        recentMessages,
        userPreferences: conversation.context.preferences || this.getDefaultPreferences()
      };
    } catch (error) {
      console.error('Error getting conversation context:', error);
      throw new Error('Failed to load conversation context');
    }
  }

  async updateUserContext(conversationId: string, userContext: UserContext): Promise<void> {
    try {
      await db.collection(this.COLLECTION_NAME).doc(conversationId).update({
        context: userContext,
        updatedAt: new Date()
      });
    } catch (error) {
      console.error('Error updating user context:', error);
      throw new Error('Failed to update user context');
    }
  }

  async getConversationHistory(userId: string, limit: number = 50): Promise<Message[]> {
    try {
      const conversationQuery = await db
        .collection(this.COLLECTION_NAME)
        .where('userId', '==', userId)
        .where('isActive', '==', true)
        .limit(1)
        .get();

      if (conversationQuery.empty) {
        return [];
      }

      const conversation = conversationQuery.docs[0].data() as ConversationEntry;
      return conversation.messages
        .slice(-limit)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    } catch (error) {
      console.error('Error getting conversation history:', error);
      return [];
    }
  }

  async archiveConversation(conversationId: string): Promise<void> {
    try {
      await db.collection(this.COLLECTION_NAME).doc(conversationId).update({
        isActive: false,
        updatedAt: new Date()
      });
    } catch (error) {
      console.error('Error archiving conversation:', error);
      throw new Error('Failed to archive conversation');
    }
  }

  private getDefaultPreferences(): UserPreferences {
    return {
      communicationStyle: 'encouraging',
      focusAreas: ['task_management', 'emotional_support'],
      preferredAdviceTypes: ['practical', 'motivational'],
      notificationSettings: {
        proactiveMessages: true,
        motivationalReminders: true,
        celebrationMessages: true,
        checkInReminders: true
      }
    };
  }

  async updateUserPreferences(userId: string, preferences: Partial<UserPreferences>): Promise<void> {
    try {
      const conversationQuery = await db
        .collection(this.COLLECTION_NAME)
        .where('userId', '==', userId)
        .where('isActive', '==', true)
        .limit(1)
        .get();

      if (!conversationQuery.empty) {
        const doc = conversationQuery.docs[0];
        const conversation = doc.data() as ConversationEntry;
        
        const updatedPreferences = {
          ...conversation.context.preferences,
          ...preferences
        };

        await doc.ref.update({
          'context.preferences': updatedPreferences,
          updatedAt: new Date()
        });
      }
    } catch (error) {
      console.error('Error updating user preferences:', error);
      throw new Error('Failed to update user preferences');
    }
  }
}