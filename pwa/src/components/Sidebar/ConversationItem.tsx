import { useState, useCallback } from 'react';
import { useConversationStore } from '../../stores/conversationStore';
import { useUIStore } from '../../stores/uiStore';
import ContextMenu from './ContextMenu';
import type { Conversation } from '../../types/conversation';
import './ConversationItem.css';

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "a l'instant";
  if (minutes < 60) return `il y a ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days}j`;
}

interface ConversationItemProps {
  conversation: Conversation;
}

export default function ConversationItem({ conversation }: ConversationItemProps) {
  const activeId = useConversationStore((s) => s.activeId);
  const setActive = useConversationStore((s) => s.setActive);
  const selecting = useConversationStore((s) => s.selecting);
  const selectedIds = useConversationStore((s) => s.selectedIds);
  const toggleSelected = useConversationStore((s) => s.toggleSelected);
  const isMobile = useUIStore((s) => s.isMobile);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const isSelected = selectedIds.has(conversation.jid);

  const handleClick = useCallback(() => {
    if (selecting) {
      toggleSelected(conversation.jid);
      return;
    }
    setActive(conversation.jid);
    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [conversation.jid, setActive, isMobile, setSidebarOpen, selecting, toggleSelected]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (selecting) return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, [selecting]);

  const handleMoreClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setContextMenu({ x: rect.right, y: rect.bottom });
  }, []);

  const isActive = activeId === conversation.jid;

  return (
    <>
      <div
        className={`conversation-item ${isActive && !selecting ? 'conversation-item--active' : ''} ${isSelected ? 'conversation-item--selected' : ''}`}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <div className="conversation-item__row">
          {selecting && (
            <span className={`conversation-item__checkbox ${isSelected ? 'conversation-item__checkbox--checked' : ''}`}>
              {isSelected && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </span>
          )}
          <h4 className="conversation-item__name">{conversation.name}</h4>
          {!selecting && (
            <button
              className="conversation-item__more"
              onClick={handleMoreClick}
              aria-label="Options"
            >
              &#x22EF;
            </button>
          )}
        </div>
        <p className="conversation-item__time">{formatRelativeTime(conversation.lastActivity)}</p>
      </div>
      {contextMenu && (
        <ContextMenu
          conversationId={conversation.jid}
          conversationName={conversation.name}
          autoRename={conversation.autoRename}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}
