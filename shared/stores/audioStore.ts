import { create } from 'zustand';

/** Platform-agnostic interface for anything that can be paused. */
export interface PlayableAudio {
  pause(): void;
}

interface AudioState {
  playbackRate: number;
  setPlaybackRate: (rate: number) => void;
  /** Currently playing audio — only one at a time */
  currentAudio: PlayableAudio | null;
  /** Claim exclusive playback: pauses any other playing audio */
  claimPlayback: (audio: PlayableAudio) => void;
  releasePlayback: (audio: PlayableAudio) => void;
}

export const useAudioStore = create<AudioState>((set, get) => ({
  playbackRate: 1,
  setPlaybackRate: (rate) => set({ playbackRate: rate }),
  currentAudio: null,
  claimPlayback: (audio) => {
    const { currentAudio } = get();
    if (currentAudio && currentAudio !== audio) {
      currentAudio.pause();
    }
    set({ currentAudio: audio });
  },
  releasePlayback: (audio) => {
    const { currentAudio } = get();
    if (currentAudio === audio) {
      set({ currentAudio: null });
    }
  },
}));
