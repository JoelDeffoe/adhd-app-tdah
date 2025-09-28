import OpenAI from 'openai';
import { UserContext, ConversationContext, CoachResponse } from '../types/coach';

export class OpenAIService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async generateResponse(
    userMessage: string, 
    conversationContext: ConversationContext,
    userContext: UserContext
  ): Promise<CoachResponse> {
    try {
      const systemPrompt = this.generateSystemPrompt(userContext);
      const contextualMessage = this.formatUserMessage(userMessage, userContext);

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          ...conversationContext.recentMessages.map(msg => ({
            role: msg.role as 'user' | 'assistant',
            content: msg.content
          })),
          { role: 'user', content: contextualMessage }
        ],
        max_tokens: 500,
        temperature: 0.7,
      });

      const response = completion.choices[0]?.message?.content || 'I apologize, but I encountered an issue generating a response. Please try again.';
      
      return {
        message: response,
        suggestions: this.generateQuickSuggestions(userContext),
        actions: this.generateRecommendedActions(userContext)
      };
    } catch (error) {
      console.error('OpenAI API error:', error);
      return {
        message: this.getFallbackResponse(userMessage),
        suggestions: ['Tell me about your day', 'Help with tasks', 'Motivation boost'],
        actions: []
      };
    }
  }

  generateSystemPrompt(userContext: UserContext): string {
    const { preferences, currentStats } = userContext;
    
    return `You are an AI coach assistant specifically designed to help users with ADHD. Your role is to provide:
    
    1. Personalized support and encouragement
    2. Evidence-based ADHD coping strategies
    3. Practical, actionable advice
    4. Emotional support and understanding
    
    User Context:
    - Communication style preference: ${preferences?.communicationStyle || 'encouraging'}
    - Current tasks: ${currentStats?.totalTasks || 0} total, ${currentStats?.completedTasks || 0} completed
    - Recent mood: ${currentStats?.recentMood || 'not specified'}
    - Active routines: ${currentStats?.activeRoutines || 0}
    
    Guidelines:
    - Be empathetic and understanding of ADHD challenges
    - Provide specific, actionable advice rather than generic suggestions
    - Reference the user's current context when relevant
    - Keep responses concise but warm and supportive
    - Avoid overwhelming the user with too much information at once
    - Celebrate small wins and progress
    - Offer practical strategies for common ADHD challenges like focus, organization, and emotional regulation
    
    Remember: You're not just an AI, you're a supportive coach who understands ADHD and wants to help the user succeed.`;
  }  
formatUserMessage(message: string, userContext: UserContext): string {
    const contextInfo = [];
    
    if (userContext.currentStats?.totalTasks) {
      contextInfo.push(`Current tasks: ${userContext.currentStats.completedTasks}/${userContext.currentStats.totalTasks} completed`);
    }
    
    if (userContext.currentStats?.recentMood) {
      contextInfo.push(`Recent mood: ${userContext.currentStats.recentMood}`);
    }
    
    if (userContext.currentStats?.activeRoutines) {
      contextInfo.push(`Active routines: ${userContext.currentStats.activeRoutines}`);
    }

    const contextString = contextInfo.length > 0 ? `\n\nCurrent context: ${contextInfo.join(', ')}` : '';
    
    return `${message}${contextString}`;
  }

  generateQuickSuggestions(userContext: UserContext): string[] {
    const suggestions = [];
    
    if (userContext.currentStats?.totalTasks && userContext.currentStats.completedTasks < userContext.currentStats.totalTasks) {
      suggestions.push('Help me prioritize my tasks');
    }
    
    if (userContext.currentStats?.recentMood === 'overwhelmed' || userContext.currentStats?.recentMood === 'stressed') {
      suggestions.push('I need calming strategies');
    }
    
    suggestions.push('Give me motivation');
    suggestions.push('Help with focus');
    suggestions.push('Celebrate my progress');
    
    return suggestions.slice(0, 3); // Limit to 3 suggestions
  }

  generateRecommendedActions(userContext: UserContext): any[] {
    const actions = [];
    
    if (userContext.currentStats?.totalTasks && userContext.currentStats.completedTasks < userContext.currentStats.totalTasks) {
      actions.push({
        type: 'navigate',
        label: 'View Tasks',
        target: 'TodoList'
      });
    }
    
    if (!userContext.currentStats?.recentMood) {
      actions.push({
        type: 'navigate',
        label: 'Log Mood',
        target: 'Journal'
      });
    }
    
    return actions;
  }

  getFallbackResponse(userMessage: string): string {
    const fallbackResponses = [
      "I understand you're reaching out for support. While I'm having trouble connecting right now, remember that you're doing great by seeking help. Can you tell me more about what's on your mind?",
      "I'm here to help, even though I'm experiencing some technical difficulties. What's the most important thing you'd like support with right now?",
      "Thank you for sharing with me. I'm having some connection issues, but I want you to know that reaching out shows real strength. What would be most helpful for you today?",
      "I appreciate you taking the time to connect. While I work through some technical challenges, remember that every small step forward counts. What's one thing you'd like to focus on?"
    ];
    
    return fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
  }

  async generateProactiveMessage(trigger: string, userContext: UserContext): Promise<string> {
    try {
      const systemPrompt = `You are an AI coach for users with ADHD. Generate a brief, supportive proactive message based on the trigger: "${trigger}". 
      
      User context: ${JSON.stringify(userContext.currentStats)}
      
      Keep the message:
      - Brief (1-2 sentences)
      - Encouraging and supportive
      - Actionable when appropriate
      - Respectful of the user's autonomy`;

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'system', content: systemPrompt }],
        max_tokens: 150,
        temperature: 0.8,
      });

      return completion.choices[0]?.message?.content || 'Hey there! Just checking in - you\'re doing great! 💪';
    } catch (error) {
      console.error('Error generating proactive message:', error);
      return 'Hey there! Just checking in - you\'re doing great! 💪';
    }
  }
}