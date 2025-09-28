import { db } from '../config/firebase';
import { UserContext, UserStats, TodoItem, RoutineItem, MoodEntry, FocusSession } from '../types/coach';

export class ContextAggregator {
  async aggregateUserContext(userId: string): Promise<UserContext> {
    try {
      const [todos, routines, moods, focusSessions, preferences] = await Promise.all([
        this.getUserTodos(userId),
        this.getUserRoutines(userId),
        this.getRecentMoods(userId),
        this.getRecentFocusSessions(userId),
        this.getUserPreferences(userId)
      ]);

      const currentStats = this.calculateUserStats(todos, routines, moods, focusSessions);

      return {
        userId,
        preferences,
        currentStats,
        todos: todos.slice(0, 10), // Limit for context
        routines: routines.slice(0, 5),
        recentMoods: moods.slice(0, 3),
        focusSessions: focusSessions.slice(0, 5)
      };
    } catch (error) {
      console.error('Error aggregating user context:', error);
      return {
        userId,
        currentStats: {
          totalTasks: 0,
          completedTasks: 0,
          activeRoutines: 0,
          focusSessionsToday: 0,
          streakDays: 0
        }
      };
    }
  }

  private async getUserTodos(userId: string): Promise<TodoItem[]> {
    try {
      const todosSnapshot = await db
        .collection('todos')
        .where('userId', '==', userId)
        .where('completed', '==', false)
        .orderBy('dueDate', 'asc')
        .limit(20)
        .get();

      return todosSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as TodoItem[];
    } catch (error) {
      console.error('Error fetching todos:', error);
      return [];
    }
  }

  private async getUserRoutines(userId: string): Promise<RoutineItem[]> {
    try {
      const today = new Date().toISOString().split('T')[0];
      const routinesSnapshot = await db
        .collection('routines')
        .where('userId', '==', userId)
        .where('date', '==', today)
        .get();

      return routinesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as RoutineItem[];
    } catch (error) {
      console.error('Error fetching routines:', error);
      return [];
    }
  }

  private async getRecentMoods(userId: string): Promise<MoodEntry[]> {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const moodsSnapshot = await db
        .collection('journal_entries')
        .where('userId', '==', userId)
        .where('timestamp', '>=', sevenDaysAgo)
        .orderBy('timestamp', 'desc')
        .limit(10)
        .get();

      return moodsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as MoodEntry[];
    } catch (error) {
      console.error('Error fetching moods:', error);
      return [];
    }
  }

  private async getRecentFocusSessions(userId: string): Promise<FocusSession[]> {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const focusSnapshot = await db
        .collection('focus_sessions')
        .where('userId', '==', userId)
        .where('startTime', '>=', sevenDaysAgo)
        .orderBy('startTime', 'desc')
        .limit(10)
        .get();

      return focusSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as FocusSession[];
    } catch (error) {
      console.error('Error fetching focus sessions:', error);
      return [];
    }
  }

  private async getUserPreferences(userId: string): Promise<any> {
    try {
      const preferencesDoc = await db
        .collection('user_preferences')
        .doc(userId)
        .get();

      if (preferencesDoc.exists) {
        return preferencesDoc.data();
      }

      return null;
    } catch (error) {
      console.error('Error fetching user preferences:', error);
      return null;
    }
  }

  private calculateUserStats(
    todos: TodoItem[], 
    routines: RoutineItem[], 
    moods: MoodEntry[], 
    focusSessions: FocusSession[]
  ): UserStats {
    const completedTasks = todos.filter(todo => todo.completed).length;
    const totalTasks = todos.length;
    const activeRoutines = routines.filter(routine => !routine.completed).length;
    
    // Get today's focus sessions
    const today = new Date().toISOString().split('T')[0];
    const focusSessionsToday = focusSessions.filter(session => 
      session.startTime && new Date(session.startTime).toISOString().split('T')[0] === today
    ).length;

    // Calculate streak (simplified - could be more sophisticated)
    const streakDays = this.calculateStreakDays(todos, routines);

    // Get most recent mood
    const recentMood = moods.length > 0 ? moods[0].mood : undefined;

    return {
      totalTasks,
      completedTasks,
      recentMood,
      activeRoutines,
      focusSessionsToday,
      streakDays
    };
  }

  private calculateStreakDays(todos: TodoItem[], routines: RoutineItem[]): number {
    // Simplified streak calculation
    // In a real implementation, this would check daily completion patterns
    const recentCompletions = todos.filter(todo => todo.completed).length + 
                             routines.filter(routine => routine.completed).length;
    
    return Math.min(recentCompletions, 7); // Cap at 7 days for simplicity
  }

  async getContextSummary(userId: string): Promise<string> {
    const context = await this.aggregateUserContext(userId);
    const stats = context.currentStats;

    const summaryParts = [];
    
    if (stats) {
      summaryParts.push(`${stats.completedTasks}/${stats.totalTasks} tasks completed`);
      
      if (stats.recentMood) {
        summaryParts.push(`recent mood: ${stats.recentMood}`);
      }
      
      if (stats.activeRoutines > 0) {
        summaryParts.push(`${stats.activeRoutines} active routines`);
      }
      
      if (stats.focusSessionsToday > 0) {
        summaryParts.push(`${stats.focusSessionsToday} focus sessions today`);
      }
    }

    return summaryParts.length > 0 ? summaryParts.join(', ') : 'Getting started';
  }
}