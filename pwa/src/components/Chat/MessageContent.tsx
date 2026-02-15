import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import FilePreviewModal from '../FilePreview/FilePreviewModal';
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

export default function MessageContent({ content }: MessageContentProps) {
  const [modal, setModal] = useState<{ url: string; filename: string; fileType: FileType } | null>(null);

  const openModal = useCallback((url: string, filename: string, fileType: FileType) => {
    setModal({ url, filename, fileType });
  }, []);

  return (
    <>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ src, alt }) => {
            if (!src) return null;
            const filename = alt || src.split('/').pop() || 'image';
            return (
              <span
                className="mc-media mc-media--image"
                onClick={() => openModal(src, filename, 'image')}
              >
                <img src={src} alt={alt || ''} loading="lazy" className="mc-image" />
              </span>
            );
          },
          a: ({ href, children }) => {
            if (!href) return <a>{children}</a>;
            const mediaType = isMediaLink(href);
            if (!mediaType) return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;

            const filename = String(children) || href.split('/').pop() || 'file';
            if (mediaType === 'video') {
              return (
                <span className="mc-media mc-media--video" onClick={() => openModal(href, filename, 'video')}>
                  <video src={href} controls className="mc-video" />
                </span>
              );
            }
            if (mediaType === 'audio') {
              return (
                <span className="mc-media mc-media--audio">
                  <audio src={href} controls className="mc-audio" />
                  <span className="mc-audio__name">{filename}</span>
                </span>
              );
            }
            if (mediaType === 'pdf') {
              return (
                <span className="mc-media mc-media--pdf" onClick={() => openModal(href, filename, 'pdf')}>
                  <span className="mc-pdf-badge">PDF</span>
                  <span className="mc-pdf-name">{filename}</span>
                </span>
              );
            }
            // image link
            return (
              <span className="mc-media mc-media--image" onClick={() => openModal(href, filename, 'image')}>
                <img src={href} alt={filename} loading="lazy" className="mc-image" />
              </span>
            );
          },
          table: ({ children }) => (
            <div className="mc-table-wrap">
              <table className="mc-table">{children}</table>
            </div>
          ),
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
