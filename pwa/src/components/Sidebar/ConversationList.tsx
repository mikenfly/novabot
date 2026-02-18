import { useConversationStore } from '../../stores/conversationStore';
import ConversationItem from './ConversationItem';

export default function ConversationList() {
  const conversations = useConversationStore((s) => s.conversations);

  if (conversations.length === 0) {
    return (
      <div className="conversation-list__empty">
        <p>Pas encore de conversations</p>
      </div>
    );
  }

  return (
    <div className="conversation-list">
      {conversations.map((conv) => (
        <ConversationItem key={conv.jid} conversation={conv} />
      ))}
    </div>
  );
}
