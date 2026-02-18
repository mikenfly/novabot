import { useState, useEffect, useRef, useCallback } from 'react';
import './MermaidDiagram.css';

interface MermaidDiagramProps {
  code: string;
}

export default function MermaidDiagram({ code }: MermaidDiagramProps) {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          securityLevel: 'strict',
          themeVariables: {
            darkMode: true,
            background: 'transparent',
            mainBkg: 'transparent',
            nodeBorder: '#6b7280',
            lineColor: '#9ca3af',
            textColor: '#e5e7eb',
            primaryColor: 'rgba(99, 102, 241, 0.25)',
            primaryTextColor: '#e5e7eb',
            primaryBorderColor: '#6366f1',
            secondaryColor: 'rgba(107, 114, 128, 0.2)',
            tertiaryColor: 'rgba(107, 114, 128, 0.1)',
          },
        });
        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        const { svg: rendered } = await mermaid.render(id, code);
        const clean = rendered
          .replace(/style="[^"]*background[^"]*"/gi, '')
          .replace(/<rect[^>]*class="[^"]*background[^"]*"[^>]*\/?>(<\/rect>)?/gi, '');
        if (!cancelled) setSvg(clean);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Invalid diagram');
      }
    })();

    return () => { cancelled = true; };
  }, [code]);

  if (error) {
    return (
      <div className="mermaid-error">
        <span className="mermaid-error__label">Diagram error</span>
        <pre className="mermaid-error__code">{code}</pre>
      </div>
    );
  }

  if (!svg) {
    return <div className="mermaid-loading">Loading diagram...</div>;
  }

  return (
    <>
      <div
        className="mermaid-diagram"
        onClick={() => setFullscreen(true)}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {fullscreen && (
        <DiagramViewer code={code} onClose={() => setFullscreen(false)} />
      )}
    </>
  );
}

// ─── Fullscreen viewer with pinch-zoom and pan ───

/**
 * Prepare an SVG string for fullscreen display:
 * - Strip inline max-width / width / height styles so it can scale freely
 * - Ensure viewBox is present (mermaid always sets it)
 * - Set width="100%" so it fills whatever container it's in
 */
function makeSvgScalable(raw: string): string {
  return raw
    // Remove background-related styles
    .replace(/style="[^"]*background[^"]*"/gi, '')
    .replace(/<rect[^>]*class="[^"]*background[^"]*"[^>]*\/?>(<\/rect>)?/gi, '')
    // Remove inline max-width from the <svg> tag
    .replace(/(<svg[^>]*?)style="[^"]*"/i, '$1')
    // Remove explicit width/height attributes (keep viewBox for scaling)
    .replace(/(<svg[^>]*?)\s+width="[^"]*"/i, '$1')
    .replace(/(<svg[^>]*?)\s+height="[^"]*"/i, '$1');
}

interface DiagramViewerProps {
  code: string;
  onClose: () => void;
}

function DiagramViewer({ code, onClose }: DiagramViewerProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [viewerSvg, setViewerSvg] = useState<string>('');
  const scaleRef = useRef(1);
  const posRef = useRef({ x: 0, y: 0 });
  const [transform, setTransform] = useState('');

  // Re-render mermaid specifically for fullscreen — fresh SVG at full resolution
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          securityLevel: 'strict',
          themeVariables: {
            darkMode: true,
            background: 'transparent',
            mainBkg: 'transparent',
            nodeBorder: '#6b7280',
            lineColor: '#9ca3af',
            textColor: '#e5e7eb',
            primaryColor: 'rgba(99, 102, 241, 0.25)',
            primaryTextColor: '#e5e7eb',
            primaryBorderColor: '#6366f1',
            secondaryColor: 'rgba(107, 114, 128, 0.2)',
            tertiaryColor: 'rgba(107, 114, 128, 0.1)',
          },
        });
        const id = `mermaid-fs-${Math.random().toString(36).slice(2)}`;
        const { svg: rendered } = await mermaid.render(id, code);
        if (!cancelled) setViewerSvg(makeSvgScalable(rendered));
      } catch {
        // Fallback: shouldn't fail since inline already rendered
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  // Touch state for pinch-zoom
  const touchRef = useRef<{
    initialDistance: number;
    initialScale: number;
    initialPos: { x: number; y: number };
    lastCenter: { x: number; y: number };
  } | null>(null);

  // Drag state for pan (mouse and single touch)
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startPosX: number;
    startPosY: number;
  } | null>(null);

  const applyTransform = useCallback(() => {
    const s = scaleRef.current;
    const { x, y } = posRef.current;
    setTransform(`translate(${x}px, ${y}px) scale(${s})`);
  }, []);

  const clampScale = (s: number) => Math.min(Math.max(s, 0.5), 8);

  // ── Mouse wheel / trackpad zoom ──
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    // Scale the zoom factor by how far the user scrolled — trackpads send
    // small deltas (~1-4px) while mouse wheels send large ones (~100px).
    const intensity = Math.min(Math.abs(e.deltaY) / 300, 0.15);
    const factor = e.deltaY > 0 ? 1 - intensity : 1 + intensity;
    scaleRef.current = clampScale(scaleRef.current * factor);
    applyTransform();
  }, [applyTransform]);

  // ── Touch handlers (pinch + pan) ──
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[1]!.clientX - e.touches[0]!.clientX;
      const dy = e.touches[1]!.clientY - e.touches[0]!.clientY;
      touchRef.current = {
        initialDistance: Math.hypot(dx, dy),
        initialScale: scaleRef.current,
        initialPos: { ...posRef.current },
        lastCenter: {
          x: (e.touches[0]!.clientX + e.touches[1]!.clientX) / 2,
          y: (e.touches[0]!.clientY + e.touches[1]!.clientY) / 2,
        },
      };
      dragRef.current = null;
    } else if (e.touches.length === 1) {
      dragRef.current = {
        startX: e.touches[0]!.clientX,
        startY: e.touches[0]!.clientY,
        startPosX: posRef.current.x,
        startPosY: posRef.current.y,
      };
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchRef.current) {
      e.preventDefault();
      const dx = e.touches[1]!.clientX - e.touches[0]!.clientX;
      const dy = e.touches[1]!.clientY - e.touches[0]!.clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / touchRef.current.initialDistance;
      scaleRef.current = clampScale(touchRef.current.initialScale * ratio);

      const center = {
        x: (e.touches[0]!.clientX + e.touches[1]!.clientX) / 2,
        y: (e.touches[0]!.clientY + e.touches[1]!.clientY) / 2,
      };
      posRef.current = {
        x: touchRef.current.initialPos.x + (center.x - touchRef.current.lastCenter.x),
        y: touchRef.current.initialPos.y + (center.y - touchRef.current.lastCenter.y),
      };
      applyTransform();
    } else if (e.touches.length === 1 && dragRef.current) {
      const dx = e.touches[0]!.clientX - dragRef.current.startX;
      const dy = e.touches[0]!.clientY - dragRef.current.startY;
      posRef.current = {
        x: dragRef.current.startPosX + dx,
        y: dragRef.current.startPosY + dy,
      };
      applyTransform();
    }
  }, [applyTransform]);

  const handleTouchEnd = useCallback(() => {
    touchRef.current = null;
    dragRef.current = null;
  }, []);

  // ── Mouse drag for desktop pan ──
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: posRef.current.x,
      startPosY: posRef.current.y,
    };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    posRef.current = {
      x: dragRef.current.startPosX + dx,
      y: dragRef.current.startPosY + dy,
    };
    applyTransform();
  }, [applyTransform]);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // ── Double-tap / double-click to reset ──
  const lastTapRef = useRef(0);
  const handleDoubleAction = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      scaleRef.current = 1;
      posRef.current = { x: 0, y: 0 };
      applyTransform();
    }
    lastTapRef.current = now;
  }, [applyTransform]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Prevent body scroll while viewer is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div className="diagram-viewer" onClick={onClose}>
      <button className="diagram-viewer__close" onClick={onClose}>
        &times;
      </button>
      <div
        className="diagram-viewer__viewport"
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {viewerSvg ? (
          <div
            ref={contentRef}
            className="diagram-viewer__content"
            style={{ transform }}
            onClick={handleDoubleAction}
            dangerouslySetInnerHTML={{ __html: viewerSvg }}
          />
        ) : (
          <div className="mermaid-loading">Loading diagram...</div>
        )}
      </div>
    </div>
  );
}
