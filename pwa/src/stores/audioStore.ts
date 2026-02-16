import { create } from 'zustand';

interface AudioState {
  playbackRate: number;
  setPlaybackRate: (rate: number) => void;
  /** Currently playing audio element — only one at a time */
  currentAudio: HTMLAudioElement | null;
  /** Claim exclusive playback: pauses any other playing audio */
  claimPlayback: (audio: HTMLAudioElement) => void;
  releasePlayback: (audio: HTMLAudioElement) => void;
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
