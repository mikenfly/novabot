import './Spinner.css';

interface SpinnerProps {
  size?: 'small' | 'medium' | 'large';
}

const sizeMap = { small: 16, medium: 24, large: 40 };

export default function Spinner({ size = 'medium' }: SpinnerProps) {
  const px = sizeMap[size];
  return (
    <div
      className="spinner"
      style={{ width: px, height: px }}
      role="status"
      aria-label="Loading"
    />
  );
}
