import { useState, useCallback } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { useConversationStore } from '../../stores/conversationStore';
import ConversationList from './ConversationList';
import NewConversationButton from './NewConversationButton';
import ConfirmDialog from '../Common/ConfirmDialog';
import { Link } from 'react-router-dom';
import './Sidebar.css';

export default function Sidebar() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const isMobile = useUIStore((s) => s.isMobile);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const selecting = useConversationStore((s) => s.selecting);
  const selectedIds = useConversationStore((s) => s.selectedIds);
  const toggleSelecting = useConversationStore((s) => s.toggleSelecting);
  const selectAll = useConversationStore((s) => s.selectAll);
  const deleteSelected = useConversationStore((s) => s.deleteSelected);
  const conversations = useConversationStore((s) => s.conversations);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleDelete = useCallback(async () => {
    setShowConfirm(false);
    await deleteSelected();
  }, [deleteSelected]);

  const allSelected = conversations.length > 0 && selectedIds.size === conversations.length;

  return (
    <>
      {isMobile && sidebarOpen && (
        <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
      )}
      <aside className={`sidebar ${!sidebarOpen && isMobile ? 'sidebar--closed' : ''}`}>
        <div className="sidebar__header">
          {selecting ? (
            <>
              <button className="sidebar__select-all" onClick={selectAll}>
                {allSelected ? 'Desélectionner' : 'Tout'}
              </button>
              <span className="sidebar__selection-count">
                {selectedIds.size} sélectionnée{selectedIds.size !== 1 ? 's' : ''}
              </span>
              <button className="sidebar__cancel" onClick={toggleSelecting}>
                Annuler
              </button>
            </>
          ) : (
            <>
              <h3>Conversations</h3>
              <div className="sidebar__header-actions">
                {conversations.length > 0 && (
                  <button className="sidebar__select-btn" onClick={toggleSelecting} aria-label="Sélectionner">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 11 12 14 22 4" />
                      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                    </svg>
                  </button>
                )}
                {isMobile && (
                  <button className="sidebar__close" onClick={() => setSidebarOpen(false)}>
                    &#x2715;
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        <div className="sidebar__body">
          <ConversationList />
        </div>
        <div className="sidebar__footer">
          {selecting ? (
            <button
              className="sidebar__delete-btn"
              disabled={selectedIds.size === 0}
              onClick={() => setShowConfirm(true)}
            >
              Supprimer ({selectedIds.size})
            </button>
          ) : (
            <>
              <NewConversationButton />
              <Link to="/settings" className="sidebar__settings-link">
                Parametres
              </Link>
            </>
          )}
        </div>
      </aside>
      {showConfirm && (
        <ConfirmDialog
          title="Supprimer les conversations"
          message={`Supprimer ${selectedIds.size} conversation${selectedIds.size !== 1 ? 's' : ''} ? Cette action est irréversible.`}
          confirmLabel="Supprimer"
          destructive
          onConfirm={handleDelete}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </>
  );
}
