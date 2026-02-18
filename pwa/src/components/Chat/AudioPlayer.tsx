import { useState, useRef, useCallback, useEffect } from 'react';
import { getToken } from '../../services/auth';
import { useAudioStore } from '../../stores/audioStore';
import './AudioPlayer.css';

interface AudioPlayerProps {
  /** Relative audio URL (e.g. "audio/tts-123.mp3") */
  audioUrl: string;
  /** Conversation ID for URL rewriting */
  conversationId: string;
  /** Optional title displayed above the player */
  title?: string;
  /** Callback when playback finishes — used for auto-advance */
  onEnded?: () => void;
  /** Ref setter for external play control (auto-advance) */
  playRef?: (play: () => void) => void;
}

const NUM_BARS = 40;

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Extract RMS amplitudes from an audio buffer, normalized to 0-1 */
function extractWaveform(audioBuffer: AudioBuffer, bars: number): number[] {
  const rawData = audioBuffer.getChannelData(0);
  const samplesPerBar = Math.floor(rawData.length / bars);
  const amplitudes: number[] = [];

  for (let i = 0; i < bars; i++) {
    let sum = 0;
    const start = i * samplesPerBar;
    for (let j = start; j < start + samplesPerBar && j < rawData.length; j++) {
      sum += rawData[j]! * rawData[j]!;
    }
    amplitudes.push(Math.sqrt(sum / samplesPerBar));
  }

  // Normalize to 0-1
  const max = Math.max(...amplitudes, 0.001);
  return amplitudes.map((a) => a / max);
}

/** Generate a simple static waveform for blob URLs or decode failures */
function generateFallbackWaveform(bars: number): number[] {
  return Array.from({ length: bars }, (_, i) => {
    return 0.2 + Math.sin(i * 0.8) * 0.4 + Math.sin(i * 1.7) * 0.2;
  });
}

export default function AudioPlayer({ audioUrl, conversationId, title, onEnded, playRef }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [waveformData, setWaveformData] = useState<number[]>(() => generateFallbackWaveform(NUM_BARS));

  // Global playback rate + exclusive playback from store
  const playbackRate = useAudioStore((s) => s.playbackRate);
  const setPlaybackRate = useAudioStore((s) => s.setPlaybackRate);
  const claimPlayback = useAudioStore((s) => s.claimPlayback);
  const releasePlayback = useAudioStore((s) => s.releasePlayback);

  const token = getToken();
  const fullUrl = audioUrl.startsWith('blob:') || audioUrl.startsWith('/api/') || audioUrl.startsWith('http')
    ? audioUrl
    : `/api/conversations/${conversationId}/files/${audioUrl}${token ? `?token=${encodeURIComponent(token)}` : ''}`;

  // Sync playback rate from store to audio element
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // Decode audio for real waveform
  useEffect(() => {
    if (audioUrl.startsWith('blob:')) return; // Skip blob URLs — can't fetch them cross-origin

    let cancelled = false;
    const audioCtx = new AudioContext();

    fetch(fullUrl)
      .then((res) => {
        if (!res.ok) throw new Error('fetch failed');
        return res.arrayBuffer();
      })
      .then((buf) => audioCtx.decodeAudioData(buf))
      .then((decoded) => {
        if (!cancelled) {
          setWaveformData(extractWaveform(decoded, NUM_BARS));
        }
      })
      .catch(() => {
        // Keep fallback waveform
      })
      .finally(() => {
        audioCtx.close();
      });

    return () => { cancelled = true; };
  }, [fullUrl, audioUrl]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
  }, [isPlaying]);

  // Expose play function for auto-advance
  useEffect(() => {
    if (playRef) {
      playRef(() => {
        audioRef.current?.play();
      });
    }
  }, [playRef]);

  const handleTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
    // webm: duration may become finite during playback
    if (isFinite(audio.duration) && audio.duration > 0) {
      setDuration(audio.duration);
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isFinite(audio.duration) && audio.duration > 0) {
      setDuration(audio.duration);
    } else {
      // webm files often report Infinity — force browser to compute duration
      // by seeking to a very large time, then seeking back to 0
      const onSeeked = () => {
        if (isFinite(audio.duration) && audio.duration > 0) {
          setDuration(audio.duration);
        }
        audio.currentTime = 0;
        audio.removeEventListener('seeked', onSeeked);
      };
      audio.addEventListener('seeked', onSeeked);
      audio.currentTime = 1e10; // Triggers seek to end → browser computes duration
    }
  }, []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    // When a webm finishes, duration is known — capture it
    if (audioRef.current && isFinite(audioRef.current.duration)) {
      setDuration(audioRef.current.duration);
    }
    onEnded?.();
  }, [onEnded]);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
  }, [duration]);

  const cycleSpeed = useCallback(() => {
    const speeds = [1, 1.5, 2];
    const idx = (speeds.indexOf(playbackRate) + 1) % speeds.length;
    setPlaybackRate(speeds[idx] ?? 1);
  }, [playbackRate, setPlaybackRate]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="audio-player">
      {title && <div className="audio-player__title">{title}</div>}
      <audio
        ref={audioRef}
        src={fullUrl}
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={() => { setIsPlaying(true); claimPlayback(audioRef.current!); }}
        onPause={() => { setIsPlaying(false); releasePlayback(audioRef.current!); }}
        onEnded={handleEnded}
      />
      <div className="audio-player__controls">
        <button className="audio-player__play" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6,4 20,12 6,20" />
            </svg>
          )}
        </button>
        <div className="audio-player__track" onClick={handleSeek}>
          <div className="audio-player__waveform">
            {waveformData.map((amplitude, i) => {
              const barProgress = (i / waveformData.length) * 100;
              const height = 15 + amplitude * 85; // 15% min, up to 100%
              return (
                <div
                  key={i}
                  className={`audio-player__bar ${barProgress <= progress ? 'audio-player__bar--played' : ''}`}
                  style={{ height: `${height}%` }}
                />
              );
            })}
          </div>
        </div>
        <div className="audio-player__time">
          {formatTime(isPlaying ? currentTime : duration)}
        </div>
        <button className="audio-player__speed" onClick={cycleSpeed}>
          {playbackRate}x
        </button>
      </div>
    </div>
  );
}
