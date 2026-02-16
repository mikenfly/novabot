export interface WsMessageData {
  chat_jid: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
  audio_url?: string;
  audio_segments?: Array<{ url: string; title?: string }>;
}

export interface AgentStatusData {
  conversation_id: string;
  status: string;
  timestamp: string;
}

export interface ConversationCreatedData {
  jid: string;
  name: string;
  lastActivity: string;
  type: 'pwa';
}

export interface ConversationRenamedData {
  jid: string;
  name: string;
}

export interface ConversationDeletedData {
  jid: string;
}

export type WsMessage =
  | { type: 'connected'; data: { timestamp: string } }
  | { type: 'pong' }
  | { type: 'message'; data: WsMessageData }
  | { type: 'agent_status'; data: AgentStatusData }
  | { type: 'conversation_created'; data: ConversationCreatedData }
  | { type: 'conversation_renamed'; data: ConversationRenamedData }
  | { type: 'conversation_deleted'; data: ConversationDeletedData };
