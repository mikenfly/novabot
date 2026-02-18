import './VideoPreview.css';

interface VideoPreviewProps {
  url: string;
  fullSize?: boolean;
}

export default function VideoPreview({ url, fullSize }: VideoPreviewProps) {
  return (
    <video
      src={url}
      controls
      className={`video-preview ${fullSize ? 'video-preview--full' : ''}`}
    />
  );
}
