import { useRef, useCallback } from 'react';

/**
 * Connects a Web Audio AnalyserNode to the active <audio> element.
 * Returns a stable `getAmplitude()` function that returns 0–1 smoothed RMS.
 *
 * If connection fails (e.g. CORS), falls back gracefully — audio keeps playing
 * and getAmplitude returns 0.
 */
export function useAudioAnalyser() {
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourcesRef = useRef<WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>>(new WeakMap());
  const connectedElRef = useRef<HTMLAudioElement | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const smoothRef = useRef(0);
  const failedRef = useRef(false);

  const connectIfNeeded = useCallback((el: HTMLAudioElement | null) => {
    if (!el || failedRef.current) return;
    if (el === connectedElRef.current && ctxRef.current) return;

    // Create AudioContext lazily (requires user gesture)
    if (!ctxRef.current) {
      try {
        ctxRef.current = new AudioContext();
      } catch {
        failedRef.current = true;
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

    // createMediaElementSource can only be called once per element ever,
    // so we cache sources in a WeakMap keyed by element
    let source = sourcesRef.current.get(el);
    if (!source) {
      try {
        source = ctx.createMediaElementSource(el);
        sourcesRef.current.set(el, source);
      } catch {
        // Element already owned by another context, or other error — give up
        connectedElRef.current = el;
        return;
      }
    }

    // Wire: source -> analyser -> destination
    try {
      source.disconnect();
    } catch { /* not connected */ }
    source.connect(analyserRef.current!);
    connectedElRef.current = el;
  }, []);

  const getAmplitude = useCallback((): number => {
    const analyser = analyserRef.current;
    const data = dataRef.current;
    if (!analyser || !data) return smoothRef.current;

    analyser.getByteTimeDomainData(data);

    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);

    const target = Math.min(rms * 2.5, 1);
    const prev = smoothRef.current;
    smoothRef.current = target > prev
      ? prev + (target - prev) * 0.3
      : prev + (target - prev) * 0.05;

    return smoothRef.current;
  }, []);

  return { connectIfNeeded, getAmplitude };
}
