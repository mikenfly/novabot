import { useState, useEffect } from 'react';
import './CodePreview.css';

interface CodePreviewProps {
  url: string;
  filename: string;
  fullSize?: boolean;
}

export default function CodePreview({ url, filename, fullSize }: CodePreviewProps) {
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    fetch(url)
      .then((r) => r.text())
      .then(setCode)
      .catch(() => setCode('// Failed to load file'));
  }, [url]);

  const ext = filename.split('.').pop() ?? '';

  return (
    <div className={`code-preview ${fullSize ? 'code-preview--full' : ''}`}>
      <div className="code-preview__header">{filename}</div>
      <pre className="code-preview__content">
        <code className={`language-${ext}`}>{code ?? 'Loading...'}</code>
      </pre>
    </div>
  );
}
