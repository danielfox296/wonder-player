import { useRef, useCallback } from 'react';

/**
 * Connects a Web Audio AnalyserNode to the active <audio> element.
 * Returns a stable `getAmplitude()` function that returns 0–1 smoothed RMS.
 *
 * Call `connectIfNeeded(audioElement)` each frame — it handles element swaps
 * (A/B crossfade) and lazy AudioContext creation (must be after user gesture).
 */
export function useAudioAnalyser() {
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const connectedElRef = useRef<HTMLAudioElement | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const smoothRef = useRef(0);

  const connectIfNeeded = useCallback((el: HTMLAudioElement | null) => {
    if (!el) return;
    // Already connected to this element
    if (el === connectedElRef.current && ctxRef.current) return;

    // Create AudioContext lazily (requires user gesture)
    if (!ctxRef.current) {
      try {
        ctxRef.current = new AudioContext();
      } catch {
        return;
      }
    }
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    // Create analyser once
    if (!analyserRef.current) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      analyser.connect(ctx.destination);
      analyserRef.current = analyser;
      dataRef.current = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
    }

    // Disconnect old source if element changed (A/B swap)
    if (sourceRef.current && connectedElRef.current !== el) {
      try { sourceRef.current.disconnect(); } catch { /* already disconnected */ }
      sourceRef.current = null;
    }

    // Connect new element — createMediaElementSource can only be called once per element,
    // so we guard with a marker property
    if (!sourceRef.current) {
      try {
        const source = ctx.createMediaElementSource(el);
        source.connect(analyserRef.current!);
        sourceRef.current = source;
        connectedElRef.current = el;
      } catch {
        // Element may already have a source from a previous context — just track it
        connectedElRef.current = el;
      }
    }
  }, []);

  const getAmplitude = useCallback((): number => {
    const analyser = analyserRef.current;
    const data = dataRef.current;
    if (!analyser || !data) return smoothRef.current;

    analyser.getByteTimeDomainData(data);

    // RMS amplitude
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);

    // Smooth — rise fast, fall slow
    const target = Math.min(rms * 2.5, 1); // scale up so typical music sits 0.3–0.7
    const prev = smoothRef.current;
    smoothRef.current = target > prev
      ? prev + (target - prev) * 0.3   // attack
      : prev + (target - prev) * 0.05; // release

    return smoothRef.current;
  }, []);

  return { connectIfNeeded, getAmplitude };
}
