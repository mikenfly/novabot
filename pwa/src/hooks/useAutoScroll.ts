import { useRef, useCallback, useState, useEffect } from 'react';

const BOTTOM_THRESHOLD = 100;

interface UseAutoScrollResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  showNewMessageBadge: boolean;
  scrollToBottom: () => void;
}

/**
 * Auto-scroll with burst protection.
 * deps must be [messages.length, pendingMessages.length].
 *
 * - Initial load / conversation switch → scroll to bottom, no flag
 * - User sends a message (pending++) → scroll to bottom, reset flag
 * - First incoming WebSocket message → auto-scroll, set flag
 * - Subsequent incoming messages while flag set → badge, no scroll
 * - User scrolls to bottom or clicks badge → reset flag
 */
export function useAutoScroll(deps: unknown[]): UseAutoScrollResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [showNewMessageBadge, setShowNewMessageBadge] = useState(false);
  const isNearBottomRef = useRef(true);
  const hasAutoScrolledRef = useRef(false);
  const prevDepsRef = useRef<number[] | null>(null);

  const checkNearBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < BOTTOM_THRESHOLD;
    if (isNearBottomRef.current) {
      setShowNewMessageBadge(false);
      hasAutoScrolledRef.current = false;
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setShowNewMessageBadge(false);
    hasAutoScrolledRef.current = false;
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkNearBottom, { passive: true });
    return () => el.removeEventListener('scroll', checkNearBottom);
  }, [checkNearBottom]);

  const depsKey = JSON.stringify(deps);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const curr = deps as number[];
    const prev = prevDepsRef.current;
    prevDepsRef.current = [curr[0] ?? 0, curr[1] ?? 0];

    const currMsg = curr[0] ?? 0;
    const currPending = curr[1] ?? 0;
    const prevMsg = prev?.[0] ?? 0;
    const prevPending = prev?.[1] ?? 0;

    const scrollDown = () => {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    };

    // First render
    if (!prev) {
      scrollDown();
      return;
    }

    // Conversation switch (msg count dropped) or initial load (0 → N)
    if (currMsg < prevMsg || (prevMsg === 0 && currMsg > 0)) {
      hasAutoScrolledRef.current = false;
      setShowNewMessageBadge(false);
      scrollDown();
      return;
    }

    // User sent a message (pending count increased)
    if (currPending > prevPending) {
      hasAutoScrolledRef.current = false;
      scrollDown();
      return;
    }

    // Pending message confirmed (pending decreased)
    if (currPending < prevPending) {
      scrollDown();
      return;
    }

    // New incoming message (from WebSocket)
    if (currMsg > prevMsg) {
      if (!isNearBottomRef.current || hasAutoScrolledRef.current) {
        setShowNewMessageBadge(true);
        return;
      }
      scrollDown();
      hasAutoScrolledRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey]);

  return { containerRef, showNewMessageBadge, scrollToBottom };
}
