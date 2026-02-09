import { useRef, useCallback, useState, useEffect } from 'react';

const BOTTOM_THRESHOLD = 100;

interface UseAutoScrollResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  showNewMessageBadge: boolean;
  scrollToBottom: () => void;
}

export function useAutoScroll(deps: unknown[]): UseAutoScrollResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [showNewMessageBadge, setShowNewMessageBadge] = useState(false);
  const isNearBottomRef = useRef(true);

  const checkNearBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < BOTTOM_THRESHOLD;
    if (isNearBottomRef.current) {
      setShowNewMessageBadge(false);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setShowNewMessageBadge(false);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.addEventListener('scroll', checkNearBottom, { passive: true });
    return () => el.removeEventListener('scroll', checkNearBottom);
  }, [checkNearBottom]);

  // On dependency change (new messages), auto-scroll if near bottom
  // Convert deps array to stable string to avoid infinite loop (React #185)
  const depsKey = JSON.stringify(deps);
  useEffect(() => {
    if (isNearBottomRef.current) {
      const el = containerRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    } else {
      setShowNewMessageBadge(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey]);

  return { containerRef, showNewMessageBadge, scrollToBottom };
}
