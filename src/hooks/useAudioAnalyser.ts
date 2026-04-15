import { useRef, useCallback, useEffect } from 'react';

/**
 * Connects a Web Audio AnalyserNode to the active <audio> element.
 * Returns a stable `getAmplitude()` function that returns 0–1 smoothed RMS.
 *
 * IMPORTANT — iOS audio routing:
 * `createMediaElementSource(el)` routes ALL audio from the element through
 * the AudioContext graph. If the AudioContext suspends (lock screen, background,
 * Bluetooth disconnect), audio goes silent even though the element thinks it's
 * playing. This hook aggressively resumes the AudioContext on every available
 * signal: visibility change, focus, statechange, and every connectIfNeeded call.
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

  // Resume the AudioContext if it's been suspended by the OS.
  // Safe to call frequently — it's a no-op when already running.
  const resumeContext = useCallback(() => {
    const ctx = ctxRef.current;
    if (ctx && ctx.state !== 'running') {
      console.log('[audio] resuming AudioContext, state was:', ctx.state);
      ctx.resume().catch(() => {});
    }
  }, []);

  const connectIfNeeded = useCallback((el: HTMLAudioElement | null) => {
    if (!el || failedRef.current) return;

    // ALWAYS check AudioContext state, even if the same element is connected.
    // iOS suspends the context on lock/background — we need to resume it every
    // time we get a chance (this runs on every rAF frame from Visualization).
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

  // Listen for OS-level signals that the AudioContext can run again.
  // This is independent of usePlayer's recovery — both systems need to recover.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') resumeContext();
    };
    const onFocus = () => resumeContext();

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
    };
  }, [resumeContext]);

  // Monitor AudioContext state changes — iOS fires 'interrupted' then
  // eventually allows resume. Auto-retry after a short delay.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;

    const onStateChange = () => {
      console.log('[audio] AudioContext state changed to:', ctx.state);
      if (ctx.state === 'suspended' || (ctx.state as string) === 'interrupted') {
        // Delay slightly — iOS may not allow immediate resume
        setTimeout(() => {
          if (ctx.state !== 'running') {
            ctx.resume().catch(() => {});
          }
        }, 200);
      }
    };
    ctx.addEventListener('statechange', onStateChange);
    return () => ctx.removeEventListener('statechange', onStateChange);
  });

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

  return { connectIfNeeded, getAmplitude, resumeContext };
}
