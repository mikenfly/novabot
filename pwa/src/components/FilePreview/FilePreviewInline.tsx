import { useState } from 'react';
import ImagePreview from './ImagePreview';
import VideoPreview from './VideoPreview';
import CodePreview from './CodePreview';
import FilePreviewModal from './FilePreviewModal';
import './FilePreviewInline.css';

interface FilePreviewInlineProps {
  url: string;
  filename: string;
}

function getFileType(filename: string): 'image' | 'video' | 'pdf' | 'code' | 'other' {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video';
  if (ext === 'pdf') return 'pdf';
  if (['js', 'ts', 'tsx', 'jsx', 'py', 'sh', 'css', 'html', 'json', 'yaml', 'yml', 'md', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'sql'].includes(ext)) return 'code';
  return 'other';
}

export default function FilePreviewInline({ url, filename }: FilePreviewInlineProps) {
  const [showModal, setShowModal] = useState(false);
  const fileType = getFileType(filename);

  return (
    <>
      <div className="file-preview-inline" onClick={() => setShowModal(true)}>
        {fileType === 'image' && <ImagePreview url={url} alt={filename} />}
        {fileType === 'video' && <VideoPreview url={url} />}
        {fileType === 'code' && <CodePreview url={url} filename={filename} />}
        {fileType === 'pdf' && (
          <div className="file-preview-inline__pdf">
            <span className="file-preview-inline__icon">PDF</span>
            <span className="file-preview-inline__name">{filename}</span>
          </div>
        )}
        {fileType === 'other' && (
          <a href={url} download={filename} className="file-preview-inline__download" onClick={(e) => e.stopPropagation()}>
            {filename}
          </a>
        )}
      </div>
      {showModal && (
        <FilePreviewModal url={url} filename={filename} fileType={fileType} onClose={() => setShowModal(false)} />
      )}
    </>
  );
}
