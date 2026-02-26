export type MemoryCategory =
  | 'user'
  | 'preferences'
  | 'goals'
  | 'facts'
  | 'projects'
  | 'people'
  | 'timeline';

export type EntryStatus = 'active' | 'completed' | 'paused' | 'stale';

export type OriginType = 'user_statement' | 'conversation' | 'inferred';

export type RelationType =
  | 'involves'
  | 'part_of'
  | 'related_to'
  | 'depends_on';

export interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  key: string;
  content: string;
  status: EntryStatus;
  mention_count: number;
  last_mentioned: string; // ISO timestamp
  created_at: string;
  origin_type: OriginType;
  origin_summary: string | null;
  embedding: Buffer | null;
  embedding_text: string | null; // enriched text used for embedding (includes relations)
  embedding_dirty: number; // 0=clean, 1=needs re-embedding (relations changed)
}

export interface MemoryRelation {
  source_key: string;
  target_key: string;
  relation_type: RelationType;
}

export interface ExchangeMessage {
  channel: string; // "pwa", "whatsapp-main", "whatsapp-famille"
  conversation_name: string;
  conversationId?: string; // PWA conversation UUID (for urgent context targeting)
  user_message: string;
  assistant_response: string;
  timestamp: string;
  memory_summary?: string; // Summary from context agent Phase 4 (what was done)
}
