'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The transport clock.
 *
 * Playback is an observation of the composition, not part of it, so the playhead lives in component
 * state and never enters the document (ADR-0017). The clock is `performance.now()`-based rather than
 * a per-frame counter: a timer that assumes 60 fps runs slow on a busy machine, and a preview that
 * drifts from the audio is exactly the bug a transport must not have.
 *
 * The hook owns nothing but the time; keeping media elements in step is the stage's job, because
 * only the stage holds decoded elements.
 */
export type VideoPlayback = {
  readonly time: number;
  readonly playing: boolean;
  readonly duration: number;
  readonly fps: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (time: number) => void;
  step: (frames: number) => void;
};

export function useVideoPlayback(options: {
  readonly duration: number;
  readonly fps: number;
}): VideoPlayback {
  const { duration, fps } = options;
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const anchor = useRef<{ readonly at: number; readonly from: number }>({ at: 0, from: 0 });
  // The latest committed time, so `play` and `step` can read it without a state updater that has a
  // side effect (React may run an updater twice).
  const latestTime = useRef(0);
  useEffect(() => {
    latestTime.current = time;
  }, [time]);

  const clamp = useCallback(
    (value: number): number => Math.min(Math.max(duration, 1), Math.max(0, value)),
    [duration],
  );

  const seek = useCallback(
    (value: number): void => {
      const next = clamp(value);
      latestTime.current = next;
      anchor.current = { at: performance.now(), from: next };
      setTime(next);
    },
    [clamp],
  );

  const pause = useCallback((): void => {
    setPlaying(false);
  }, []);

  const play = useCallback((): void => {
    const from = latestTime.current >= clamp(duration) - 1e-6 ? 0 : latestTime.current;
    latestTime.current = from;
    anchor.current = { at: performance.now(), from };
    setTime(from);
    setPlaying(true);
  }, [clamp, duration]);

  const toggle = useCallback((): void => {
    if (playing) pause();
    else play();
  }, [pause, play, playing]);

  const step = useCallback(
    (frames: number): void => {
      setPlaying(false);
      // A pure updater, so a burst of key presses accumulates every step: reading a ref that is
      // synchronised in an effect would drop presses that arrive before the effect runs.
      setTime((current) => clamp(current + frames / fps));
    },
    [clamp, fps],
  );

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = (): void => {
      const elapsed = (performance.now() - anchor.current.at) / 1000;
      const next = anchor.current.from + elapsed;
      if (next >= clamp(duration)) {
        latestTime.current = clamp(duration);
        setTime(clamp(duration));
        setPlaying(false);
        return;
      }
      latestTime.current = next;
      setTime(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [clamp, duration, playing]);

  // A composition that gets shorter while the playhead is past the end must not leave the playhead
  // outside the document: derive the display value instead of writing state from an effect.
  const bounded = Math.min(time, Math.max(duration, 1));

  return { time: bounded, playing, duration, fps, play, pause, toggle, seek, step };
}
