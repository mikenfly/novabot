import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import { useAudioStore, getBaseUrl, getToken } from '@nanoclaw/shared';
import type { PlayableAudio } from '@nanoclaw/shared';
import { colors, radius, spacing } from '../../theme';

interface AudioPlayerProps {
  audioUrl: string;
  conversationId: string;
  title?: string;
  onEnded?: () => void;
  playRef?: (play: () => void) => void;
}

const NUM_BARS = 30;

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function generateFallbackWaveform(bars: number): number[] {
  return Array.from({ length: bars }, (_, i) => {
    return 0.2 + Math.sin(i * 0.8) * 0.4 + Math.sin(i * 1.7) * 0.2;
  });
}

export function AudioPlayer({ audioUrl, conversationId, title, onEnded, playRef }: AudioPlayerProps) {
  const playerRef = useRef(new AudioRecorderPlayer());
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [waveformData] = useState<number[]>(() => generateFallbackWaveform(NUM_BARS));

  const playbackRate = useAudioStore((s) => s.playbackRate);
  const setPlaybackRate = useAudioStore((s) => s.setPlaybackRate);
  const claimPlayback = useAudioStore((s) => s.claimPlayback);
  const releasePlayback = useAudioStore((s) => s.releasePlayback);

  const [fullUrl, setFullUrl] = useState('');

  // Build the full audio URL
  useEffect(() => {
    async function buildUrl() {
      if (audioUrl.startsWith('http') || audioUrl.startsWith('file://')) {
        setFullUrl(audioUrl);
        return;
      }
      const baseUrl = getBaseUrl();
      const token = await getToken();
      const url = `${baseUrl}/api/conversations/${conversationId}/files/${audioUrl}`;
      setFullUrl(token ? `${url}?token=${encodeURIComponent(token)}` : url);
    }
    buildUrl();
  }, [audioUrl, conversationId]);

  // Pausable handle for audioStore
  const pausableRef = useRef<PlayableAudio>({
    pause: () => {
      playerRef.current.stopPlayer();
      setIsPlaying(false);
    },
  });

  const play = useCallback(async () => {
    if (!fullUrl) return;
    const player = playerRef.current;

    claimPlayback(pausableRef.current);
    setIsPlaying(true);

    await player.startPlayer(fullUrl);
    player.addPlayBackListener((e) => {
      setCurrentTime(e.currentPosition / 1000);
      setDuration(e.duration / 1000);

      if (e.currentPosition >= e.duration - 100 && e.duration > 0) {
        player.stopPlayer();
        player.removePlayBackListener();
        setIsPlaying(false);
        setCurrentTime(0);
        releasePlayback(pausableRef.current);
        onEnded?.();
      }
    });
  }, [fullUrl, claimPlayback, releasePlayback, onEnded]);

  const pause = useCallback(async () => {
    await playerRef.current.pausePlayer();
    setIsPlaying(false);
    releasePlayback(pausableRef.current);
  }, [releasePlayback]);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, play, pause]);

  // Expose play function for auto-advance
  useEffect(() => {
    if (playRef) {
      playRef(() => { play(); });
    }
  }, [playRef, play]);

  // Cleanup
  useEffect(() => {
    return () => {
      playerRef.current.stopPlayer();
      playerRef.current.removePlayBackListener();
    };
  }, []);

  const cycleSpeed = useCallback(() => {
    const speeds = [1, 1.5, 2];
    const idx = (speeds.indexOf(playbackRate) + 1) % speeds.length;
    setPlaybackRate(speeds[idx] ?? 1);
  }, [playbackRate, setPlaybackRate]);

  const progress = duration > 0 ? currentTime / duration : 0;

  const handleSeek = useCallback(
    async (barIndex: number) => {
      if (!duration) return;
      const ratio = barIndex / NUM_BARS;
      const seekMs = ratio * duration * 1000;
      await playerRef.current.seekToPlayer(Math.floor(seekMs));
    },
    [duration],
  );

  return (
    <View style={styles.container}>
      {title ? <Text style={styles.title}>{title}</Text> : null}

      <View style={styles.controls}>
        {/* Play/Pause button */}
        <Pressable style={styles.playButton} onPress={togglePlay}>
          <Text style={styles.playIcon}>{isPlaying ? '⏸' : '▶'}</Text>
        </Pressable>

        {/* Waveform */}
        <Pressable
          style={styles.track}
          onPress={(e) => {
            const { locationX, } = e.nativeEvent;
            const barWidth = 240 / NUM_BARS; // approximate
            const barIndex = Math.floor(locationX / barWidth);
            handleSeek(Math.max(0, Math.min(barIndex, NUM_BARS - 1)));
          }}
        >
          <View style={styles.waveform}>
            {waveformData.map((amplitude, i) => {
              const barProgress = i / waveformData.length;
              const heightPct = 15 + amplitude * 85;
              const played = barProgress <= progress;
              return (
                <View
                  key={i}
                  style={[
                    styles.bar,
                    {
                      height: `${heightPct}%`,
                      backgroundColor: played ? colors.accent : colors.border,
                    },
                  ]}
                />
              );
            })}
          </View>
        </Pressable>

        {/* Time */}
        <Text style={styles.time}>
          {formatTime(isPlaying ? currentTime : duration)}
        </Text>

        {/* Speed */}
        <Pressable style={styles.speedButton} onPress={cycleSpeed}>
          <Text style={styles.speedText}>{playbackRate}x</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: spacing.xs,
  },
  title: {
    color: colors.textSecondary,
    fontSize: 12,
    marginBottom: spacing.xs,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  playButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playIcon: {
    color: '#fff',
    fontSize: 14,
  },
  track: {
    flex: 1,
    height: 32,
    justifyContent: 'center',
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 28,
    gap: 1.5,
  },
  bar: {
    flex: 1,
    borderRadius: 1,
    minHeight: 3,
  },
  time: {
    color: colors.textSecondary,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    minWidth: 32,
    textAlign: 'right',
  },
  speedButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  speedText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
});
