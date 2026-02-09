import { type ReactNode, useEffect } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

interface AuthGuardProps {
  children: ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const initialize = useAuthStore((s) => s.initialize);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    initialize();
  }, [initialize]);

  if (!isAuthenticated) {
    // Pass token via location.state for security (not visible in URL bar)
    const token = searchParams.get('token');
    return <Navigate to="/login" state={{ token }} replace />;
  }

  return <>{children}</>;
}
