import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { api } from '../services/api';
import ConfirmDialog from '../components/Common/ConfirmDialog';
import Spinner from '../components/Common/Spinner';
import type { Device } from '../types/device';
import type { DevicesResponse, GenerateTokenResponse } from '../types/api';
import './SettingsPage.css';

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

interface MemoryLimits {
  user: number;
  goals: number;
  projects: number;
  people: number;
  facts: number;
  preferences: number;
  timeline_days: number;
  relation_depth: number;
}

const LIMIT_LABELS: { key: keyof MemoryLimits; label: string; min?: number; max?: number }[] = [
  { key: 'user', label: 'Profil utilisateur' },
  { key: 'goals', label: 'Objectifs' },
  { key: 'projects', label: 'Projets' },
  { key: 'people', label: 'Personnes' },
  { key: 'facts', label: 'Faits' },
  { key: 'preferences', label: 'Preferences' },
  { key: 'timeline_days', label: 'Timeline (jours)' },
  { key: 'relation_depth', label: 'Profondeur des relations', min: 0, max: 5 },
];

export default function SettingsPage() {
  const logout = useAuthStore((s) => s.logout);
  const [devices, setDevices] = useState<Device[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [devOpen, setDevOpen] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [limits, setLimits] = useState<MemoryLimits | null>(null);
  const [limitsSaved, setLimitsSaved] = useState(false);
  const [contextContent, setContextContent] = useState<string | null>(null);
  const [contextOpen, setContextOpen] = useState(false);

  const fetchDevices = useCallback(async () => {
    setIsLoading(true);
    try {
      const { devices } = await api.get<DevicesResponse>('/api/devices');
      setDevices(devices);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  const handleRevoke = useCallback(async () => {
    if (!revokeTarget) return;
    await api.delete(`/api/devices/${revokeTarget}`);
    setDevices((prev) => prev.filter((d) => d.token !== revokeTarget));
    setRevokeTarget(null);
  }, [revokeTarget]);

  const handleGenerateToken = useCallback(async () => {
    const { token } = await api.post<GenerateTokenResponse>('/api/devices/generate', {
      deviceName: 'Generated from settings',
    });
    setGeneratedToken(token);
  }, []);

  const handleToggleDev = useCallback(() => {
    setDevOpen((v) => !v);
  }, []);

  const handleToggleLimits = useCallback(async () => {
    const opening = !limitsOpen;
    setLimitsOpen(opening);
    if (opening && !limits) {
      const { limits: l } = await api.get<{ limits: MemoryLimits }>('/api/memory/settings');
      setLimits(l);
    }
  }, [limitsOpen, limits]);

  const handleSaveLimits = useCallback(async () => {
    if (!limits) return;
    const { limits: saved } = await api.put<{ ok: boolean; limits: MemoryLimits }>('/api/memory/settings', { limits });
    setLimits(saved);
    setLimitsSaved(true);
    setTimeout(() => setLimitsSaved(false), 2000);
  }, [limits]);

  const handleViewContext = useCallback(async () => {
    setContextOpen(true);
    const { content } = await api.get<{ content: string }>('/api/memory/context');
    setContextContent(content);
  }, []);

  return (
    <div className="settings-page">
      <div className="settings-page__header">
        <Link to="/" className="settings-page__back">&#8592; Retour</Link>
        <h1>Parametres</h1>
      </div>

      <section className="settings-section">
        <h2>Appareils</h2>
        {isLoading ? (
          <div className="settings-section__loading"><Spinner /></div>
        ) : (
          <div className="device-list">
            {devices.map((device) => (
              <div key={device.token} className="device-item">
                <div className="device-item__info">
                  <span className="device-item__name">{device.device_name}</span>
                  <span className="device-item__meta">
                    Cree {formatRelativeTime(device.created_at)} &middot; Utilise {formatRelativeTime(device.last_used)}
                  </span>
                </div>
                <button
                  className="device-item__revoke"
                  onClick={() => setRevokeTarget(device.token)}
                >
                  Revoquer
                </button>
              </div>
            ))}
          </div>
        )}
        <button className="settings-section__btn" onClick={handleGenerateToken}>
          Generer un token
        </button>
        {generatedToken && (
          <div className="settings-section__token">
            <code>{generatedToken}</code>
            <p>Ce token expire dans 5 minutes.</p>
          </div>
        )}
      </section>

      <section className="settings-section">
        <h2>Compte</h2>
        <button className="settings-section__btn settings-section__btn--danger" onClick={logout}>
          Se deconnecter
        </button>
      </section>

      <section className="settings-section">
        <button className="settings-section__toggle" onClick={handleToggleDev}>
          {devOpen ? '▾' : '▸'} Developpeur
        </button>
        {devOpen && (
          <div className="memory-limits">
            <p className="memory-limits__desc">
              Le systeme de memoire extrait automatiquement des informations de tes conversations
              (profil, objectifs, projets, contacts...) et les reinjecte comme contexte dans chaque echange.
              Tu peux ajuster combien d'entrees par categorie sont injectees.
            </p>
            <button className="settings-section__btn" onClick={handleViewContext}>
              Voir le contexte injecte
            </button>
            <button className="memory-limits__subtitle" onClick={handleToggleLimits}>
              {limitsOpen ? '▾' : '▸'} Limites d'injection par categorie
            </button>
            {limitsOpen && (
              limits ? (
                <>
                  {LIMIT_LABELS.map(({ key, label, min: minVal, max: maxVal }) => {
                    const mn = minVal ?? 1;
                    const mx = maxVal ?? 50;
                    return (
                      <div key={key} className="memory-limits__row">
                        <label>{label}</label>
                        <input
                          type="number"
                          min={mn}
                          max={mx}
                          value={limits[key]}
                          onChange={(e) =>
                            setLimits({ ...limits, [key]: Math.max(mn, Math.min(mx, parseInt(e.target.value) || mn)) })
                          }
                        />
                      </div>
                    );
                  })}
                  <button className="settings-section__btn" onClick={handleSaveLimits}>
                    Enregistrer
                  </button>
                  {limitsSaved && <p className="memory-limits__saved">Enregistre</p>}
                </>
              ) : (
                <div className="settings-section__loading"><Spinner /></div>
              )
            )}
          </div>
        )}
      </section>

      {contextOpen && (
        <div className="context-viewer" onClick={() => { setContextOpen(false); setContextContent(null); }}>
          <div className="context-viewer__panel" onClick={(e) => e.stopPropagation()}>
            <div className="context-viewer__header">
              <h2>Contexte memoire injecte</h2>
              <button className="context-viewer__close" onClick={() => { setContextOpen(false); setContextContent(null); }}>
                &#10005;
              </button>
            </div>
            <div className="context-viewer__body">
              {contextContent !== null ? (
                <pre>{contextContent || '(aucun contexte genere pour le moment)'}</pre>
              ) : (
                <div className="settings-section__loading"><Spinner /></div>
              )}
            </div>
          </div>
        </div>
      )}

      {revokeTarget && (
        <ConfirmDialog
          title="Revoquer l'appareil"
          message="Cet appareil ne pourra plus acceder a NanoClaw."
          confirmLabel="Revoquer"
          destructive
          onConfirm={handleRevoke}
          onCancel={() => setRevokeTarget(null)}
        />
      )}
    </div>
  );
}
