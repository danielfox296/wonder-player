import { useRef, useCallback } from 'react';

/**
 * Provides amplitude data for the Chladni visualization.
 *
 * On desktop/Chrome: uses Web Audio AnalyserNode for real frequency data.
 * On iOS/iPadOS:     returns a simulated gentle pulse — NO Web Audio routing.
 *
 * Why: `createMediaElementSource()` hijacks the <audio> element's output and
 * routes it exclusively through an AudioContext graph. On iOS Safari this causes:
 *   1. Audio silence on lock screen (AudioContext suspends, pipeline breaks)
 *   2. Pitch/speed shift on minimize (AudioContext sample rate desyncs from hardware)
 *   3. Bluetooth disconnect kills audio (same AudioContext suspension)
 *
 * For a retail player on iPad + Bluetooth, reliable audio >>> pretty visualizations.
 * The simulated pulse still drives the Chladni pattern naturally.
 */

// Detect iOS/iPadOS — iPadOS 13+ reports as Mac but has touch
const isIOS = typeof navigator !== 'undefined' && (
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
);

export function useAudioAnalyser() {
  // ── iOS: simulated amplitude (no Web Audio) ──────────────────────────
  const iosPhaseRef = useRef(Math.random() * Math.PI * 2);

  // ── Desktop: real Web Audio analyser ─────────────────────────────────
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourcesRef = useRef<WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>>(new WeakMap());
  const connectedElRef = useRef<HTMLAudioElement | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const smoothRef = useRef(0);
  const failedRef = useRef(false);

  const connectIfNeeded = useCallback((el: HTMLAudioElement | null) => {
    // On iOS, never create a MediaElementSource — let audio play directly
    if (isIOS || !el || failedRef.current) return;

    // Resume if suspended (desktop browsers can suspend too)
    if (ctxRef.current && ctxRef.current.state !== 'running') {
      ctxRef.current.resume().catch(() => {});
    }

    // Element already wired — nothing else to do
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
    if (ctx.state !== 'running') ctx.resume().catch(() => {});

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
    if (isIOS) {
      // Gentle organic pulse: layered sine waves at different frequencies
      // so the Chladni pattern breathes naturally without real audio data.
      iosPhaseRef.current += 0.016; // ~60fps
      const t = iosPhaseRef.current;
      const raw = 0.35
        + 0.15 * Math.sin(t * 0.7)    // slow breath (~0.11 Hz)
        + 0.08 * Math.sin(t * 1.9)    // medium drift
        + 0.04 * Math.sin(t * 4.3);   // subtle shimmer
      const prev = smoothRef.current;
      smoothRef.current = prev + (raw - prev) * 0.06;
      return smoothRef.current;
    }

    // Desktop: real frequency data
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
