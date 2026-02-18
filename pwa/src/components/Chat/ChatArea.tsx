import { useConversationStore } from '../../stores/conversationStore';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import TypingIndicator from './TypingIndicator';
import EmptyState from '../Common/EmptyState';
import ChatHeader from './ChatHeader';
import './ChatArea.css';

export default function ChatArea() {
  const activeId = useConversationStore((s) => s.activeId);

  return (
    <>
      <ChatHeader />
      {activeId ? (
        <div className="chat-area">
          <MessageList conversationId={activeId} />
          <TypingIndicator conversationId={activeId} />
          <MessageInput conversationId={activeId} />
        </div>
      ) : (
        <EmptyState
          title="Selectionnez une conversation"
          subtitle="Ou creez-en une nouvelle depuis la barre laterale"
        />
      )}
    </>
  );
}
