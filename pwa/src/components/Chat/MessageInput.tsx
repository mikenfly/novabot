import { useState, useCallback, useRef, useEffect } from 'react';
import { useMessageStore } from '../../stores/messageStore';
import { useConversationStore } from '../../stores/conversationStore';
import { useVisualViewport } from '../../hooks/useVisualViewport';
import './MessageInput.css';

interface MessageInputProps {
  conversationId: string;
}

const WAVEFORM_BARS = 30;

export default function MessageInput({ conversationId }: MessageInputProps) {
  const draft = useConversationStore((s) => s.drafts[conversationId] ?? '');
  const setDraft = useConversationStore((s) => s.setDraft);
  const [content, setContent] = useState(draft);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [liveWaveform, setLiveWaveform] = useState<number[]>(() => new Array(WAVEFORM_BARS).fill(0));
  const sendMessage = useMessageStore((s) => s.sendMessage);
  const sendAudio = useMessageStore((s) => s.sendAudio);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const recordingWrapperRef = useRef<HTMLDivElement>(null);
  const cancelledRef = useRef(false);
  const { keyboardHeight } = useVisualViewport();

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, []);

  // Restore draft when switching conversations
  useEffect(() => {
    setContent(useConversationStore.getState().drafts[conversationId] ?? '');
  }, [conversationId]);

  // Save draft to store on change
  useEffect(() => {
    setDraft(conversationId, content);
  }, [content, conversationId, setDraft]);

  useEffect(() => {
    adjustHeight();
  }, [content, adjustHeight]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Live waveform animation using frequency data (more visually responsive)
  const startWaveformAnimation = useCallback((analyser: AnalyserNode) => {
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const animate = () => {
      analyser.getByteFrequencyData(dataArray);

      // Map frequency bins to WAVEFORM_BARS, taking max amplitude per bar
      const step = Math.max(1, Math.floor(dataArray.length / WAVEFORM_BARS));
      const bars: number[] = [];
      for (let i = 0; i < WAVEFORM_BARS; i++) {
        let peak = 0;
        const start = i * step;
        for (let j = start; j < start + step && j < dataArray.length; j++) {
          if (dataArray[j]! > peak) peak = dataArray[j]!;
        }
        bars.push(peak / 255);
      }
      setLiveWaveform(bars);

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = content.trim();
    if (!trimmed) return;
    setContent('');
    setDraft(conversationId, '');
    await sendMessage(conversationId, trimmed);
  }, [content, conversationId, sendMessage, setDraft]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const startRecording = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        console.error('getUserMedia not available — HTTPS or localhost required');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up AnalyserNode for live waveform
      const audioCtx = new AudioContext();
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });

      chunksRef.current = [];
      cancelledRef.current = false;
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        clearInterval(timerRef.current);
        cancelAnimationFrame(animFrameRef.current);
        analyserRef.current = null;
        audioCtx.close();
        setRecordingDuration(0);
        setLiveWaveform(new Array(WAVEFORM_BARS).fill(0));

        // Don't send if recording was cancelled
        if (cancelledRef.current) return;

        const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType });
        if (blob.size > 0) {
          await sendAudio(conversationId, blob);
        }
      };

      mediaRecorder.start(250); // Collect data every 250ms
      setIsRecording(true);
      setIsPaused(false);
      setRecordingDuration(0);
      timerRef.current = setInterval(() => {
        setRecordingDuration((d) => d + 1);
      }, 1000);

      startWaveformAnimation(analyser);

      // Focus the wrapper so keyboard shortcuts work
      setTimeout(() => recordingWrapperRef.current?.focus(), 50);
    } catch (err) {
      console.error('Failed to start recording:', err);
    }
  }, [conversationId, sendAudio, startWaveformAnimation]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      if (mediaRecorderRef.current.state === 'paused') {
        mediaRecorderRef.current.resume();
      }
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setIsPaused(false);
  }, []);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      cancelledRef.current = true;
      if (mediaRecorderRef.current.state === 'paused') {
        mediaRecorderRef.current.resume();
      }
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setIsPaused(false);
    clearInterval(timerRef.current);
    cancelAnimationFrame(animFrameRef.current);
    setRecordingDuration(0);
    setLiveWaveform(new Array(WAVEFORM_BARS).fill(0));
  }, []);

  const togglePause = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

    if (recorder.state === 'recording') {
      recorder.pause();
      setIsPaused(true);
      clearInterval(timerRef.current);
      cancelAnimationFrame(animFrameRef.current);
    } else if (recorder.state === 'paused') {
      recorder.resume();
      setIsPaused(false);
      timerRef.current = setInterval(() => {
        setRecordingDuration((d) => d + 1);
      }, 1000);
      if (analyserRef.current) {
        startWaveformAnimation(analyserRef.current);
      }
    }
  }, [startWaveformAnimation]);

  const handleRecordingKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        stopRecording();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelRecording();
      }
    },
    [stopRecording, cancelRecording],
  );

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    return `${m}:${(s % 60).toString().padStart(2, '0')}`;
  };

  if (isRecording) {
    return (
      <div
        className="message-input-container"
        style={keyboardHeight > 0 ? { paddingBottom: `${keyboardHeight}px` } : undefined}
      >
        <div
          ref={recordingWrapperRef}
          className="message-input-wrapper message-input-wrapper--recording"
          tabIndex={0}
          onKeyDown={handleRecordingKeyDown}
        >
          <button className="message-input__cancel" onClick={cancelRecording} aria-label="Annuler">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <div className="message-input__recording-indicator">
            <span className={`message-input__recording-dot ${isPaused ? 'message-input__recording-dot--paused' : ''}`} />
            <span className="message-input__recording-time">{formatDuration(recordingDuration)}</span>
            <div className="message-input__live-waveform">
              {liveWaveform.map((v, i) => (
                <div
                  key={i}
                  className="message-input__live-bar"
                  style={{ height: `${Math.max(8, v * 100)}%` }}
                />
              ))}
            </div>
          </div>
          <button className="message-input__pause" onClick={togglePause} aria-label={isPaused ? 'Reprendre' : 'Pause'}>
            {isPaused ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6,4 20,12 6,20" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            )}
          </button>
          <button className="message-input__send message-input__send--stop" onClick={stopRecording} aria-label="Envoyer l'audio">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="message-input-container"
      style={keyboardHeight > 0 ? { paddingBottom: `${keyboardHeight}px` } : undefined}
    >
      <div className="message-input-wrapper">
        <textarea
          ref={textareaRef}
          className="message-input"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Envoyer un message..."
          rows={1}
        />
        {content.trim() ? (
          <button
            className="message-input__send"
            onClick={handleSend}
            aria-label="Envoyer"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        ) : (
          <button
            className="message-input__mic"
            onClick={startRecording}
            aria-label="Message vocal"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
