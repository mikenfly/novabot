import { type ReactNode, useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

interface AuthGuardProps {
  children: ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const initialize = useAuthStore((s) => s.initialize);
  const login = useAuthStore((s) => s.login);
  const loginWithPermanentToken = useAuthStore((s) => s.loginWithPermanentToken);
  const [searchParams] = useSearchParams();
  const [tryingToken, setTryingToken] = useState(false);
  const [tokenFailed, setTokenFailed] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    initialize();
    setInitialized(true);
  }, [initialize]);

  // If URL has a token, try to login directly (no redirect to /login)
  useEffect(() => {
    const token = searchParams.get('token');
    if (!token || isAuthenticated || tryingToken || tokenFailed) return;

    setTryingToken(true);
    (async () => {
      try {
        // Try as permanent token first, then as temporary
        const ok = await loginWithPermanentToken(token);
        if (!ok) {
          const deviceName = navigator.userAgent.slice(0, 50);
          await login(token, deviceName);
        }
      } catch {
        setTokenFailed(true);
      } finally {
        setTryingToken(false);
      }
    })();
  }, [searchParams, isAuthenticated, tryingToken, tokenFailed, login, loginWithPermanentToken]);

  // Don't redirect while initializing, trying a token, or if there's
  // a token in the URL we haven't attempted yet.
  // This prevents <Navigate to="/login"> from firing before the
  // useEffect has a chance to process the URL token.
  const urlToken = searchParams.get('token');
  const pendingTokenAttempt = !!urlToken && !tokenFailed && !isAuthenticated;

  if (!initialized || tryingToken || pendingTokenAttempt) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
