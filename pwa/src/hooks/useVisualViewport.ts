import { useState, useEffect } from 'react';

interface VisualViewportState {
  keyboardHeight: number;
  isKeyboardVisible: boolean;
}

export function useVisualViewport(): VisualViewportState {
  const [state, setState] = useState<VisualViewportState>({
    keyboardHeight: 0,
    isKeyboardVisible: false,
  });

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const keyboardHeight = Math.max(0, window.innerHeight - vv.height);
      setState({
        keyboardHeight,
        isKeyboardVisible: keyboardHeight > 100,
      });
    };

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);

    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return state;
}
