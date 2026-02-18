import type { Conversation, Message } from './conversation';
import type { Device } from './device';

export interface ApiError {
  error: string;
}

export interface LoginRequest {
  token: string;
  deviceName: string;
}

export interface LoginResponse {
  token: string;
}

export interface ConversationsResponse {
  conversations: Conversation[];
}

export interface CreateConversationRequest {
  name?: string;
}

export interface MessagesResponse {
  messages: Message[];
}

export interface SendMessageRequest {
  content: string;
}

export interface SendMessageResponse {
  success: true;
  messageId: string;
}

export interface SuccessResponse {
  success: true;
}

export interface RenameConversationRequest {
  name: string;
}

export interface DevicesResponse {
  devices: Device[];
}

export interface GenerateTokenRequest {
  deviceName?: string;
}

export interface GenerateTokenResponse {
  token: string;
  expiresAt: string;
}

export interface PushSubscribeRequest {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface PushUnsubscribeRequest {
  endpoint: string;
}

export interface HealthResponse {
  status: 'ok';
}
