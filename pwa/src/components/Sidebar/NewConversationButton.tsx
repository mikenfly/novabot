import { useCallback, useState } from 'react';
import { useConversationStore } from '../../stores/conversationStore';
import './NewConversationButton.css';

export default function NewConversationButton() {
  const createConversation = useConversationStore((s) => s.createConversation);
  const [isCreating, setIsCreating] = useState(false);

  const handleClick = useCallback(async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      await createConversation();
    } finally {
      setIsCreating(false);
    }
  }, [createConversation, isCreating]);

  return (
    <button className="new-conversation-btn" onClick={handleClick} disabled={isCreating}>
      {isCreating ? 'Creation...' : '+ Nouvelle conversation'}
    </button>
  );
}
