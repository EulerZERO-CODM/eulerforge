'use client';

/**
 * Playback clock for Motion Studio.
 *
 * The component owns the playhead; the evaluator never does. That separation is what makes export
 * deterministic: exporting asks the evaluator for specific times, while playing asks it for the
 * times the clock produces. The clock uses `requestAnimationFrame` and the frame's own timestamp,
 * so playback follows the display, and it advances by elapsed time rather than by a fixed step
 * (which would play at the wrong speed on a 120 Hz screen).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type MotionPlayback = {
  readonly time: number;
  readonly playing: boolean;
  readonly duration: number;
  readonly play: () => void;
  readonly pause: () => void;
  readonly toggle: () => void;
  /** Seeks and pauses: scrubbing is a deliberate inspection, not playback. */
  readonly seek: (time: number) => void;
  /** Steps exactly one frame, in either direction, from the current time. */
  readonly step: (direction: 1 | -1) => void;
};

export function useMotionPlayback(options: {
  readonly duration: number;
  readonly fps: number;
  /** Playhead changes caused by the user, e.g. a keyframe drag, rather than by the clock. */
  readonly onSeek?: (time: number) => void;
}): MotionPlayback {
  const { duration, fps } = options;
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timeRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const startedAt = useRef(0);
  const startFrom = useRef(0);
  const onSeekRef = useRef(options.onSeek);
  useEffect(() => {
    onSeekRef.current = options.onSeek;
  }, [options.onSeek]);

  const clamp = useCallback(
    (value: number): number => Math.min(duration, Math.max(0, value)),
    [duration],
  );

  useEffect(() => {
    // Shortening a composition must not leave the playhead past its end.
    if (timeRef.current > duration) {
      timeRef.current = duration;
      setTime(duration);
    }
  }, [duration]);

  useEffect(() => {
    if (!playing) return;
    const tick = (now: number): void => {
      const elapsed = (now - startedAt.current) / 1000;
      const next = startFrom.current + elapsed;
      if (next >= duration) {
        timeRef.current = duration;
        setTime(duration);
        setPlaying(false);
        return;
      }
      timeRef.current = next;
      setTime(next);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [playing, duration]);

  const play = useCallback(() => {
    if (timeRef.current >= duration) {
      timeRef.current = 0;
      setTime(0);
    }
    startedAt.current = performance.now();
    startFrom.current = timeRef.current;
    setPlaying(true);
  }, [duration]);

  const pause = useCallback(() => {
    setPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    if (playing) pause();
    else play();
  }, [pause, play, playing]);

  const seek = useCallback(
    (value: number) => {
      if (playing) setPlaying(false);
      const next = clamp(value);
      timeRef.current = next;
      setTime(next);
      onSeekRef.current?.(next);
    },
    [clamp, playing],
  );

  const step = useCallback(
    (direction: 1 | -1) => {
      if (playing) setPlaying(false);
      const next = clamp(Math.round(timeRef.current * fps + direction) / fps);
      timeRef.current = next;
      setTime(next);
      onSeekRef.current?.(next);
    },
    [clamp, fps, playing],
  );

  return { time, playing, duration, play, pause, toggle, seek, step };
}
