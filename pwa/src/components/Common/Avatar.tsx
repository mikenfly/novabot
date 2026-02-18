import './Avatar.css';

interface AvatarProps {
  name: string;
  isUser?: boolean;
}

export default function Avatar({ name, isUser }: AvatarProps) {
  const initial = name.charAt(0).toUpperCase();
  return (
    <div className={`avatar ${isUser ? 'avatar--user' : 'avatar--assistant'}`}>
      {initial}
    </div>
  );
}
