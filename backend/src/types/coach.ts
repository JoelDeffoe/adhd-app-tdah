export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  context?: MessageContext;
}

export interface MessageContext {
  taskCount?: number;
  completedTasks?: number;
  currentMood?: string;
  activeRoutines?: number;
  referencedData?: string[];
}

export interface ConversationContext {
  conversationId: string;
  recentMessages: Message[];
  userPreferences: UserPreferences;
}

export interface UserContext {
  userId: string;
  preferences?: UserPreferences;
  currentStats?: UserStats;
  todos?: TodoItem[];
  routines?: RoutineItem[];
  recentMoods?: MoodEntry[];
  focusSessions?: FocusSession[];
}

export interface UserStats {
  totalTasks: number;
  completedTasks: number;
  recentMood?: string;
  activeRoutines: number;
  focusSessionsToday: number;
  streakDays: number;
}

export interface UserPreferences {
  communicationStyle: 'encouraging' | 'direct' | 'gentle';
  focusAreas: string[];
  preferredAdviceTypes: string[];
  notificationSettings: NotificationPreferences;
  personalityTraits?: string[];
}

export interface NotificationPreferences {
  proactiveMessages: boolean;
  motivationalReminders: boolean;
  celebrationMessages: boolean;
  checkInReminders: boolean;
  quietHours?: {
    start: string;
    end: string;
  };
}

export interface CoachResponse {
  message: string;
  suggestions?: string[];
  actions?: RecommendedAction[];
  conversationId?: string;
}

export interface RecommendedAction {
  type: 'navigate' | 'action' | 'reminder';
  label: string;
  target?: string;
  data?: any;
}

export interface ProactiveTrigger {
  type: 'overdue_tasks' | 'mood_check' | 'milestone' | 'routine_pattern' | 'focus_session';
  data: any;
  userId: string;
}

// Existing app types (simplified for coach integration)
export interface TodoItem {
  id: string;
  title: string;
  completed: boolean;
  dueDate?: Date;
  priority: 'low' | 'medium' | 'high';
}

export interface RoutineItem {
  id: string;
  name: string;
  completed: boolean;
  scheduledTime: string;
}

export interface MoodEntry {
  id: string;
  mood: string;
  energy: number;
  notes?: string;
  timestamp: Date;
}

export interface FocusSession {
  id: string;
  duration: number;
  completed: boolean;
  startTime: Date;
  endTime?: Date;
}

export interface ConversationEntry {
  id: string;
  userId: string;
  messages: Message[];
  context: UserContext;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
}