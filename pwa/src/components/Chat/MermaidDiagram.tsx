import { useState, useEffect, useRef } from 'react';
import './MermaidDiagram.css';

interface MermaidDiagramProps {
  code: string;
}

export default function MermaidDiagram({ code }: MermaidDiagramProps) {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const containerRef = useRef<HTMLDivElement>(null);

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
        // Strip background from the SVG so it blends with the bubble
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
    <div
      ref={containerRef}
      className="mermaid-diagram"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
