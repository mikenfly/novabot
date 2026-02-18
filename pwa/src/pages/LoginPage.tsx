import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { ApiRequestError } from '../services/api';
import './LoginPage.css';

export default function LoginPage() {
  const [tokenInput, setTokenInput] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const login = useAuthStore((s) => s.login);
  const loginWithPermanentToken = useAuthStore((s) => s.loginWithPermanentToken);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (token: string) => {
    if (!token.trim() || isSubmitting) return;
    setIsSubmitting(true);
    setError('');
    try {
      // Try permanent token first, then temporary
      try {
        const ok = await loginWithPermanentToken(token.trim());
        if (ok) {
          navigate('/', { replace: true });
          return;
        }
      } catch {
        // Fall back to temporary token exchange
      }
      const deviceName = navigator.userAgent.slice(0, 50);
      const success = await login(token.trim(), deviceName);
      if (success) {
        navigate('/', { replace: true });
      } else {
        setError('Token invalide ou expiré');
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
      } else {
        setError('Erreur de connexion');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>NovaBot</h1>
        <p className="login-card__subtitle">Assistant personnel Claude</p>
        <form
          className="login-card__form"
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit(tokenInput);
          }}
        >
          <div className="login-card__input-group">
            <input
              type="text"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Entrez votre token"
              disabled={isSubmitting}
              autoFocus
            />
          </div>
          <button type="submit" className="login-card__btn" disabled={isSubmitting || !tokenInput.trim()}>
            {isSubmitting ? 'Connexion...' : 'Se connecter'}
          </button>
          {error && <p className="login-card__error">{error}</p>}
        </form>
        <p className="login-card__help">
          Generez un token avec <code>novabot token</code> ou scannez le QR code.
        </p>
      </div>
    </div>
  );
}
