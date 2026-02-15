import { useEffect, useState, useCallback, useRef } from 'react';
import { useConversationStore } from '../../stores/conversationStore';
import ConfirmDialog from '../Common/ConfirmDialog';
import './ContextMenu.css';

interface ContextMenuProps {
  conversationId: string;
  conversationName: string;
  x: number;
  y: number;
  onClose: () => void;
}

export default function ContextMenu({ conversationId, conversationName, x, y, onClose }: ContextMenuProps) {
  const renameConversation = useConversationStore((s) => s.renameConversation);
  const deleteConversation = useConversationStore((s) => s.deleteConversation);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(conversationName);
  const inputRef = useRef<HTMLInputElement>(null);

  const showDeleteConfirmRef = useRef(false);
  showDeleteConfirmRef.current = showDeleteConfirm;

  useEffect(() => {
    const handleClickOutside = () => {
      // Don't close if the confirm dialog is showing
      if (showDeleteConfirmRef.current) return;
      onClose();
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (showDeleteConfirmRef.current) return;
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  const handleRename = useCallback(() => {
    setIsRenaming(true);
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== conversationName) {
      await renameConversation(conversationId, trimmed);
    }
    onClose();
  }, [renameValue, conversationName, conversationId, renameConversation, onClose]);

  const handleDelete = useCallback(async () => {
    await deleteConversation(conversationId);
    onClose();
  }, [conversationId, deleteConversation, onClose]);

  if (showDeleteConfirm) {
    return (
      <ConfirmDialog
        title="Supprimer la conversation"
        message={`Supprimer "${conversationName}" ? Cette action est irreversible.`}
        confirmLabel="Supprimer"
        destructive
        onConfirm={handleDelete}
        onCancel={onClose}
      />
    );
  }

  return (
    <div className="context-menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      {isRenaming ? (
        <div className="context-menu__rename">
          <input
            ref={inputRef}
            className="context-menu__rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
              if (e.key === 'Escape') onClose();
            }}
            onBlur={handleRenameSubmit}
          />
        </div>
      ) : (
        <>
          <button className="context-menu__item" onClick={handleRename}>
            Renommer
          </button>
          <button className="context-menu__item context-menu__item--danger" onClick={() => setShowDeleteConfirm(true)}>
            Supprimer
          </button>
        </>
      )}
    </div>
  );
}
