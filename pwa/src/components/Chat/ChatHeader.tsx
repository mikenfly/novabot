import { useConversationStore } from '../../stores/conversationStore';
import { useUIStore } from '../../stores/uiStore';
import ConnectionStatus from './ConnectionStatus';
import './ChatHeader.css';

export default function ChatHeader() {
  const activeId = useConversationStore((s) => s.activeId);
  const conversations = useConversationStore((s) => s.conversations);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const isMobile = useUIStore((s) => s.isMobile);

  const active = conversations.find((c) => c.jid === activeId);

  return (
    <header className="chat-header">
      {isMobile && (
        <button className="chat-header__menu" onClick={toggleSidebar}>
          &#9776;
        </button>
      )}
      <div className="chat-header__info">
        <ConnectionStatus />
        <h2 className="chat-header__title">{active?.name ?? 'NanoClaw'}</h2>
      </div>
    </header>
  );
}
