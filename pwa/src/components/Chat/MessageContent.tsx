import { useState, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { getToken } from '../../services/auth';
import FilePreviewModal from '../FilePreview/FilePreviewModal';
import MermaidDiagram from './MermaidDiagram';
import './MessageContent.css';

interface MessageContentProps {
  content: string;
  conversationId: string;
}

type FileType = 'image' | 'video' | 'pdf' | 'code' | 'audio' | 'other';

function getFileType(src: string): FileType {
  const ext = src.split('.').pop()?.split('?')[0]?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'aac', 'm4a'].includes(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  return 'other';
}

function isMediaLink(href: string): FileType | null {
  const type = getFileType(href);
  return type !== 'other' ? type : null;
}

/**
 * Rewrite container workspace paths to the files API endpoint.
 * Agent writes paths like /workspace/group/photo.jpg — these need to become
 * /api/conversations/{id}/files/photo.jpg?token=xxx
 */
function rewriteUrl(src: string, conversationId: string, token: string | null): string {
  // Already an API URL or external URL — leave as-is
  if (src.startsWith('/api/') || src.startsWith('http://') || src.startsWith('https://')) {
    return src;
  }

  let relativePath: string;

  if (src.startsWith('/workspace/group/')) {
    relativePath = src.slice('/workspace/group/'.length);
  } else if (src.startsWith('./')) {
    relativePath = src.slice(2);
  } else if (!src.startsWith('/')) {
    // Relative path like "photo.jpg"
    relativePath = src;
  } else {
    // Other absolute paths (e.g. /workspace/global/) — can't serve these
    return src;
  }

  const apiUrl = `/api/conversations/${conversationId}/files/${relativePath}`;
  return token ? `${apiUrl}?token=${encodeURIComponent(token)}` : apiUrl;
}

export default function MessageContent({ content, conversationId }: MessageContentProps) {
  const [modal, setModal] = useState<{ url: string; filename: string; fileType: FileType } | null>(null);
  const token = useMemo(() => getToken(), []);

  const openModal = useCallback((url: string, filename: string, fileType: FileType) => {
    setModal({ url, filename, fileType });
  }, []);

  const rewrite = useCallback(
    (src: string) => rewriteUrl(src, conversationId, token),
    [conversationId, token],
  );

  return (
    <>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          img: ({ src, alt }) => {
            if (!src) return null;
            const url = rewrite(src);
            const filename = alt || src.split('/').pop() || 'image';
            return (
              <span
                className="mc-media mc-media--image"
                onClick={() => openModal(url, filename, 'image')}
              >
                <img src={url} alt={alt || ''} loading="lazy" className="mc-image" />
              </span>
            );
          },
          a: ({ href, children }) => {
            if (!href) return <a>{children}</a>;
            const mediaType = isMediaLink(href);
            if (!mediaType) return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;

            const url = rewrite(href);
            const filename = String(children) || href.split('/').pop() || 'file';
            if (mediaType === 'video') {
              return (
                <span className="mc-media mc-media--video" onClick={() => openModal(url, filename, 'video')}>
                  <video src={url} controls className="mc-video" />
                </span>
              );
            }
            if (mediaType === 'audio') {
              return (
                <span className="mc-media mc-media--audio">
                  <audio src={url} controls className="mc-audio" />
                  <span className="mc-audio__name">{filename}</span>
                </span>
              );
            }
            if (mediaType === 'pdf') {
              return (
                <span className="mc-media mc-media--pdf" onClick={() => openModal(url, filename, 'pdf')}>
                  <span className="mc-pdf-badge">PDF</span>
                  <span className="mc-pdf-name">{filename}</span>
                </span>
              );
            }
            // image link
            return (
              <span className="mc-media mc-media--image" onClick={() => openModal(url, filename, 'image')}>
                <img src={url} alt={filename} loading="lazy" className="mc-image" />
              </span>
            );
          },
          blockquote: ({ children }) => (
            <blockquote className="mc-blockquote">{children}</blockquote>
          ),
          table: ({ children }) => (
            <div className="mc-table-wrap">
              <table className="mc-table">{children}</table>
            </div>
          ),
          code: ({ className, children }) => {
            const match = /language-(\w+)/.exec(className || '');
            const lang = match?.[1];

            if (lang === 'mermaid') {
              const code = String(children).replace(/\n$/, '');
              return <MermaidDiagram code={code} />;
            }

            // Fenced code block
            if (className) {
              return <pre><code className={className}>{children}</code></pre>;
            }

            // Inline code
            return <code>{children}</code>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
      {modal && (
        <FilePreviewModal
          url={modal.url}
          filename={modal.filename}
          fileType={modal.fileType}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
