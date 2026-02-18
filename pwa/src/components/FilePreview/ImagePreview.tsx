import './ImagePreview.css';

interface ImagePreviewProps {
  url: string;
  alt: string;
  fullSize?: boolean;
}

export default function ImagePreview({ url, alt, fullSize }: ImagePreviewProps) {
  return (
    <img
      src={url}
      alt={alt}
      className={`image-preview ${fullSize ? 'image-preview--full' : ''}`}
      loading="lazy"
    />
  );
}
