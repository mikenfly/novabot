import { useCallback } from 'react';
import { useAgentStatusStore } from '../../stores/agentStatusStore';
import { api } from '../../services/api';
import './TypingIndicator.css';

interface TypingIndicatorProps {
  conversationId: string;
}

export default function TypingIndicator({ conversationId }: TypingIndicatorProps) {
  const status = useAgentStatusStore((s) => s.status[conversationId]);

  const handleInterrupt = useCallback(async () => {
    try {
      await api.post(`/api/conversations/${conversationId}/interrupt`, {});
    } catch (err) {
      console.error('Failed to interrupt agent:', err);
    }
  }, [conversationId]);

  if (!status) return null;

  return (
    <div className="typing-indicator">
      <div className="typing-indicator__dots">
        <span className="typing-indicator__dot" />
        <span className="typing-indicator__dot" />
        <span className="typing-indicator__dot" />
      </div>
      <span className="typing-indicator__text">{status}</span>
      <button
        className="typing-indicator__stop"
        onClick={handleInterrupt}
        aria-label="Interrompre l'agent"
        title="Interrompre"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <rect x="4" y="4" width="16" height="16" rx="2" />
        </svg>
      </button>
    </div>
  );
}
