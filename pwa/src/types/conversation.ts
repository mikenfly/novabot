export interface Conversation {
  jid: string;
  name: string;
  folder: string;
  lastActivity: string;
  type: 'pwa';
}

export interface AudioSegment {
  url: string;
  title?: string;
}

export interface Message {
  id: string;
  chat_jid: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: boolean;
  audio_url?: string;
  audio_segments?: AudioSegment[];
}

export interface PendingMessage {
  tempId: string;
  conversationId: string;
  content: string;
  timestamp: string;
  status: 'sending' | 'failed';
  audio_url?: string;
}
