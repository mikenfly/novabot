import { useRef } from 'react';
import Avatar from '../Common/Avatar';
import MessageContent from './MessageContent';
import AudioPlayer from './AudioPlayer';
import type { Message } from '../../types/conversation';
import './MessageBubble.css';

interface MessageBubbleProps {
  message: Message;
  isPending?: boolean;
  pendingStatus?: 'sending' | 'failed';
  onAudioEnded?: () => void;
  audioPlayRef?: (play: () => void) => void;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function stripAssistantPrefix(content: string): string {
  return content.replace(/^\w+:\s*/, '');
}

export default function MessageBubble({ message, isPending, pendingStatus, onAudioEnded, audioPlayRef }: MessageBubbleProps) {
  const isUser = message.is_from_me;
  const displayContent = isUser ? message.content : stripAssistantPrefix(message.content);
  const senderName = isUser ? 'Vous' : message.sender_name;
  const hasUserAudio = !!message.audio_url;
  const hasAudioSegments = !!message.audio_segments?.length;
  const hasText = displayContent.trim().length > 0;

  // Refs for intra-bubble segment chaining
  const segmentPlayFns = useRef<Map<number, () => void>>(new Map());

  return (
    <div className={`message-bubble ${isUser ? 'message-bubble--user' : 'message-bubble--assistant'} ${isPending ? 'message-bubble--pending' : ''}`}>
      <Avatar name={senderName} isUser={isUser} />
      <div className="message-bubble__content">
        <div className="message-bubble__header">
          <span className="message-bubble__sender">{senderName}</span>
          <span className="message-bubble__time">
            {isPending
              ? pendingStatus === 'failed' ? 'Echec' : 'Envoi...'
              : formatTime(message.timestamp)}
          </span>
        </div>
        {/* User's audio message (recording) — show player + transcript below */}
        {hasUserAudio && (
          <AudioPlayer
            audioUrl={message.audio_url!}
            conversationId={message.chat_jid}
            onEnded={onAudioEnded}
            playRef={audioPlayRef}
          />
        )}
        {/* Agent's audio segments — rendered above the text, auto-chained */}
        {hasAudioSegments && message.audio_segments!.map((seg, i) => {
          const isLast = i === message.audio_segments!.length - 1;
          return (
            <AudioPlayer
              key={`${message.id}-audio-${i}`}
              audioUrl={seg.url}
              conversationId={message.chat_jid}
              title={seg.title}
              onEnded={isLast ? onAudioEnded : () => {
                const playNext = segmentPlayFns.current.get(i + 1);
                if (playNext) playNext();
              }}
              playRef={(fn: () => void) => {
                segmentPlayFns.current.set(i, fn);
                if (i === 0 && audioPlayRef) audioPlayRef(fn);
              }}
            />
          );
        })}
        {/* Text content — always shown when present */}
        {hasText && (
          <div className="message-bubble__text">
            <MessageContent content={displayContent} conversationId={message.chat_jid} />
          </div>
        )}
      </div>
    </div>
  );
}
