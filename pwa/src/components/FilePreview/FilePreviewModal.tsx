import { useEffect } from 'react';
import ImagePreview from './ImagePreview';
import VideoPreview from './VideoPreview';
import CodePreview from './CodePreview';
import './FilePreviewModal.css';

interface FilePreviewModalProps {
  url: string;
  filename: string;
  fileType: 'image' | 'video' | 'pdf' | 'code' | 'audio' | 'other';
  onClose: () => void;
}

export default function FilePreviewModal({ url, filename, fileType, onClose }: FilePreviewModalProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="file-modal__backdrop" onClick={onClose}>
      <div className="file-modal" onClick={(e) => e.stopPropagation()}>
        <div className="file-modal__header">
          <span className="file-modal__filename">{filename}</span>
          <button className="file-modal__close" onClick={onClose}>&#x2715;</button>
        </div>
        <div className="file-modal__content">
          {fileType === 'image' && <ImagePreview url={url} alt={filename} fullSize />}
          {fileType === 'video' && <VideoPreview url={url} fullSize />}
          {fileType === 'code' && <CodePreview url={url} filename={filename} fullSize />}
          {fileType === 'pdf' && (
            <iframe src={url} className="file-modal__iframe" title={filename} />
          )}
          {fileType === 'other' && (
            <div className="file-modal__fallback">
              <a href={url} download={filename}>Telecharger {filename}</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
