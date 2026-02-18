import { useEffect, type ReactNode } from 'react';
import { useUIStore } from '../../stores/uiStore';
import './AppLayout.css';

interface AppLayoutProps {
  sidebar: ReactNode;
  children: ReactNode;
}

export default function AppLayout({ sidebar, children }: AppLayoutProps) {
  const isMobile = useUIStore((s) => s.isMobile);
  const setIsMobile = useUIStore((s) => s.setIsMobile);

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)');
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches);
    };
    handleChange(mql);
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, [setIsMobile]);

  return (
    <div className={`app-layout ${isMobile ? 'app-layout--mobile' : ''}`}>
      {sidebar}
      <main className="app-layout__main">{children}</main>
    </div>
  );
}
