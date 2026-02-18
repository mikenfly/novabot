import { useUIStore } from '../../stores/uiStore';
import './ConnectionStatus.css';

const statusLabels = {
  connected: 'Connecte',
  disconnected: 'Deconnecte',
  reconnecting: 'Reconnexion...',
} as const;

export default function ConnectionStatus() {
  const connectionStatus = useUIStore((s) => s.connectionStatus);

  return (
    <div
      className={`connection-status connection-status--${connectionStatus}`}
      title={statusLabels[connectionStatus]}
    />
  );
}
