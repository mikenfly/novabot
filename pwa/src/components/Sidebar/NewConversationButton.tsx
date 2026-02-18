import { useCallback, useState } from 'react';
import { useConversationStore } from '../../stores/conversationStore';
import { useUIStore } from '../../stores/uiStore';
import './NewConversationButton.css';

export default function NewConversationButton() {
  const createConversation = useConversationStore((s) => s.createConversation);
  const isMobile = useUIStore((s) => s.isMobile);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const [isCreating, setIsCreating] = useState(false);

  const handleClick = useCallback(async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      await createConversation();
      if (isMobile) {
        setSidebarOpen(false);
      }
    } finally {
      setIsCreating(false);
    }
  }, [createConversation, isCreating, isMobile, setSidebarOpen]);

  return (
    <button className="new-conversation-btn" onClick={handleClick} disabled={isCreating}>
      {isCreating ? 'Creation...' : '+ Nouvelle conversation'}
    </button>
  );
}
