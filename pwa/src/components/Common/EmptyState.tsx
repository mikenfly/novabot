import './EmptyState.css';

interface EmptyStateProps {
  title: string;
  subtitle?: string;
}

export default function EmptyState({ title, subtitle }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state__content">
        <div className="empty-state__icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <h3 className="empty-state__title">{title}</h3>
        {subtitle && <p className="empty-state__subtitle">{subtitle}</p>}
      </div>
    </div>
  );
}
