import { useEffect, useRef } from 'react';
import { playerApi } from '../lib/api.js';

/**
 * Periodically samples ambient volume via microphone.
 * Captures 3 seconds of audio every `intervalMs`, computes RMS → dB,
 * and sends the reading to the server.
 * Silently does nothing if microphone permission is denied.
 *
 * AudioContext creation is deferred until after a user gesture
 * (click/touch/keydown) to avoid browser suspension issues.
 */
export function useAmbientMonitor(intervalMs = 300000) {
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const initedRef = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    let mounted = true;

    async function startMonitoring() {
      if (initedRef.current) return;
      initedRef.current = true;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (!mounted) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;

        // AudioContext is created after user gesture, so it starts in 'running' state
        const ctx = new AudioContext();
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }
        if (!mounted) { ctx.close(); stream.getTracks().forEach(t => t.stop()); return; }
        contextRef.current = ctx;

        // Take first reading immediately, then on interval
        sample();
        timer = setInterval(sample, intervalMs);
      } catch {
        // Permission denied or no microphone — silently continue
        console.log('[ambient] Microphone not available');
      }
    }

    async function sample() {
      const stream = streamRef.current;
      const ctx = contextRef.current;
      if (!stream || !ctx || ctx.state === 'closed') return;

      try {
        if (ctx.state === 'suspended') await ctx.resume();

        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);

        const buffer = new Float32Array(analyser.fftSize);

        // Sample for 3 seconds, take 10 readings
        const readings: number[] = [];
        for (let i = 0; i < 10; i++) {
          await new Promise(r => setTimeout(r, 300));
          analyser.getFloatTimeDomainData(buffer);
          let sum = 0;
          for (let j = 0; j < buffer.length; j++) sum += buffer[j] * buffer[j];
          const rms = Math.sqrt(sum / buffer.length);
          readings.push(rms);
        }

        source.disconnect();

        const avgRms = readings.reduce((a, b) => a + b, 0) / readings.length;
        const peakRms = Math.max(...readings);
        // Convert to dB (reference: full scale = 1.0)
        const avgDb = avgRms > 0 ? 20 * Math.log10(avgRms) : -100;
        const peakDb = peakRms > 0 ? 20 * Math.log10(peakRms) : -100;

        await playerApi('/api/player/events/ambient', {
          method: 'POST',
          body: { avg_db: Math.round(avgDb * 10) / 10, peak_db: Math.round(peakDb * 10) / 10 },
        });
      } catch (err) {
        console.error('[ambient] Sample error:', err);
      }
    }

    // Defer initialization until a user gesture occurs, which ensures
    // AudioContext can start in 'running' state on all browsers
    const gestureEvents = ['click', 'touchstart', 'keydown'] as const;
    const onGesture = () => {
      gestureEvents.forEach(e => document.removeEventListener(e, onGesture));
      startMonitoring();
    };
    gestureEvents.forEach(e => document.addEventListener(e, onGesture, { once: false }));

    // If the document already has had interaction (e.g., user navigated here via button),
    // check if AudioContext would be allowed by testing with a throwaway context
    try {
      const test = new AudioContext();
      if (test.state === 'running') {
        test.close();
        gestureEvents.forEach(e => document.removeEventListener(e, onGesture));
        startMonitoring();
      } else {
        test.close();
      }
    } catch {
      // Will wait for gesture
    }

    return () => {
      mounted = false;
      gestureEvents.forEach(e => document.removeEventListener(e, onGesture));
      if (timer) clearInterval(timer);
      streamRef.current?.getTracks().forEach(t => t.stop());
      contextRef.current?.close().catch(() => {});
    };
  }, [intervalMs]);
}
