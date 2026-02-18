import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  TextInput,
  Pressable,
  Text,
  StyleSheet,
  Animated,
  Alert,
  Platform,
} from 'react-native';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import { useMessageStore, useConversationStore } from '@nanoclaw/shared';
import { colors, radius, spacing } from '../../theme';

interface MessageInputProps {
  conversationId: string;
}

const WAVEFORM_BARS = 30;

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

export function MessageInput({ conversationId }: MessageInputProps) {
  const draft = useConversationStore((s) => s.drafts[conversationId] ?? '');
  const setDraft = useConversationStore((s) => s.setDraft);
  const sendMessage = useMessageStore((s) => s.sendMessage);
  const sendAudio = useMessageStore((s) => s.sendAudio);

  const [content, setContent] = useState(draft);
  const [inputHeight, setInputHeight] = useState(40);
  const textInputRef = useRef<TextInput>(null);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [liveWaveform, setLiveWaveform] = useState<number[]>(() => new Array(WAVEFORM_BARS).fill(0));
  const recorderRef = useRef(new AudioRecorderPlayer());
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const cancelledRef = useRef(false);
  const recordingPathRef = useRef('');

  // Animated dot for recording indicator
  const dotOpacity = useRef(new Animated.Value(1)).current;

  // Restore draft when switching conversations
  useEffect(() => {
    const storedDraft = useConversationStore.getState().drafts[conversationId] ?? '';
    setContent(storedDraft);
  }, [conversationId]);

  // Persist draft
  useEffect(() => {
    setDraft(conversationId, content);
  }, [content, conversationId, setDraft]);

  // Recording dot animation
  useEffect(() => {
    if (isRecording && !isPaused) {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(dotOpacity, { toValue: 0.3, duration: 600, useNativeDriver: true }),
          Animated.timing(dotOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
        ]),
      );
      animation.start();
      return () => animation.stop();
    } else {
      dotOpacity.setValue(1);
    }
  }, [isRecording, isPaused, dotOpacity]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recorderRef.current.stopRecorder().catch(() => {});
      recorderRef.current.removeRecordBackListener();
    };
  }, []);

  const handleSend = useCallback(() => {
    const text = content.trim();
    if (!text) return;
    setContent('');
    setDraft(conversationId, '');
    sendMessage(conversationId, text);
  }, [content, conversationId, sendMessage, setDraft]);

  const handleContentSizeChange = useCallback(
    (e: { nativeEvent: { contentSize: { height: number } } }) => {
      const newHeight = Math.min(Math.max(e.nativeEvent.contentSize.height, 40), 150);
      setInputHeight(newHeight);
    },
    [],
  );

  const startRecording = useCallback(async () => {
    try {
      cancelledRef.current = false;
      const recorder = recorderRef.current;

      const path = Platform.select({
        ios: `recording-${Date.now()}.m4a`,
        default: `recording-${Date.now()}.mp4`,
      });

      const result = await recorder.startRecorder(path, {
        SampleRate: 44100,
        Channels: 1,
        AudioEncoderAndroid: 3, // AAC
        AudioSourceAndroid: 6, // VOICE_RECOGNITION
      }, true); // meteringEnabled

      recordingPathRef.current = result;
      setIsRecording(true);
      setIsPaused(false);
      setRecordingDuration(0);

      // Timer for duration display
      timerRef.current = setInterval(() => {
        setRecordingDuration((d) => d + 1);
      }, 1000);

      // Metering callback for live waveform
      recorder.addRecordBackListener((e) => {
        if (e.currentMetering != null) {
          // currentMetering is in dB (typically -60 to 0)
          // Map to 0-1 range
          const db = e.currentMetering;
          const normalized = Math.max(0, Math.min(1, (db + 60) / 60));

          setLiveWaveform((prev) => {
            const next = [...prev.slice(1), normalized];
            return next;
          });
        }
      });
    } catch (err) {
      Alert.alert('Erreur', "Impossible de démarrer l'enregistrement. Vérifiez les permissions micro.");
    }
  }, []);

  const stopRecording = useCallback(async () => {
    try {
      const recorder = recorderRef.current;
      const result = await recorder.stopRecorder();
      recorder.removeRecordBackListener();

      if (timerRef.current) clearInterval(timerRef.current);
      setIsRecording(false);
      setIsPaused(false);
      setRecordingDuration(0);
      setLiveWaveform(new Array(WAVEFORM_BARS).fill(0));

      if (cancelledRef.current) return;

      // Read the recorded file and send as blob
      if (result) {
        const response = await fetch(Platform.OS === 'ios' ? result : `file://${result}`);
        const blob = await response.blob();
        if (blob.size > 0) {
          await sendAudio(conversationId, blob);
        }
      }
    } catch (err) {
      console.error('Stop recording failed:', err);
    }
  }, [conversationId, sendAudio]);

  const cancelRecording = useCallback(async () => {
    cancelledRef.current = true;
    try {
      await recorderRef.current.stopRecorder();
      recorderRef.current.removeRecordBackListener();
    } catch {
      // ignore
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);
    setIsPaused(false);
    setRecordingDuration(0);
    setLiveWaveform(new Array(WAVEFORM_BARS).fill(0));
  }, []);

  const togglePause = useCallback(async () => {
    const recorder = recorderRef.current;
    if (isPaused) {
      await recorder.resumeRecorder();
      setIsPaused(false);
      timerRef.current = setInterval(() => {
        setRecordingDuration((d) => d + 1);
      }, 1000);
    } else {
      await recorder.pauseRecorder();
      setIsPaused(true);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [isPaused]);

  const hasContent = content.trim().length > 0;

  // ─── Recording mode ───
  if (isRecording) {
    return (
      <View style={styles.container}>
        <View style={[styles.inputWrapper, styles.recordingWrapper]}>
          {/* Cancel button */}
          <Pressable style={styles.cancelButton} onPress={cancelRecording}>
            <Text style={styles.cancelIcon}>✕</Text>
          </Pressable>

          {/* Recording indicator */}
          <View style={styles.recordingIndicator}>
            <Animated.View style={[styles.recordingDot, { opacity: dotOpacity }]} />
            <Text style={styles.recordingTime}>{formatDuration(recordingDuration)}</Text>

            {/* Live waveform */}
            <View style={styles.liveWaveform}>
              {liveWaveform.map((v, i) => (
                <View
                  key={i}
                  style={[
                    styles.liveBar,
                    { height: Math.max(3, v * 24) },
                  ]}
                />
              ))}
            </View>
          </View>

          {/* Pause/Resume button */}
          <Pressable style={styles.pauseButton} onPress={togglePause}>
            <Text style={styles.pauseIcon}>{isPaused ? '▶' : '⏸'}</Text>
          </Pressable>

          {/* Stop and send button */}
          <Pressable style={styles.sendButton} onPress={stopRecording}>
            <Text style={styles.sendIcon}>↑</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ─── Text mode ───
  return (
    <View style={styles.container}>
      <View style={styles.inputWrapper}>
        <TextInput
          ref={textInputRef}
          style={[styles.input, { height: inputHeight }]}
          value={content}
          onChangeText={setContent}
          placeholder="Message..."
          placeholderTextColor={colors.textTertiary}
          multiline
          returnKeyType="default"
          onContentSizeChange={handleContentSizeChange}
          blurOnSubmit={false}
        />

        {hasContent ? (
          <Pressable style={styles.sendButton} onPress={handleSend}>
            <Text style={styles.sendIcon}>↑</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.micButton} onPress={startRecording}>
            <Text style={styles.micIcon}>🎤</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bgSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  recordingWrapper: {
    borderColor: colors.error,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 15,
    paddingVertical: spacing.sm,
    maxHeight: 150,
  },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: spacing.sm,
  },
  sendIcon: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  micButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: spacing.sm,
  },
  micIcon: {
    fontSize: 20,
  },
  cancelButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelIcon: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '600',
  },
  recordingIndicator: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.sm,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.error,
  },
  recordingTime: {
    color: colors.textPrimary,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
    minWidth: 36,
  },
  liveWaveform: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 28,
    gap: 1.5,
  },
  liveBar: {
    flex: 1,
    backgroundColor: colors.error,
    opacity: 0.7,
    borderRadius: 1,
    minHeight: 3,
  },
  pauseButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pauseIcon: {
    color: colors.textPrimary,
    fontSize: 14,
  },
});
