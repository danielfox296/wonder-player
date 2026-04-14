import { useRef, useState, useCallback, useEffect } from 'react';
import { playerApi, getNextTrack, logModeChange } from '../lib/api.js';

interface Song {
  id: string;
  title: string | null;
  audio_url: string;
  duration_seconds: number;
}

interface Preloaded {
  song: Song;
  which: 'A' | 'B';
}

// Wait for an audio element to be ready to play (or error out)
const waitCanPlay = (el: HTMLAudioElement): Promise<void> =>
  new Promise((resolve, reject) => {
    const onCanPlay = () => { el.removeEventListener('error', onError); resolve(); };
    const onError = () => { el.removeEventListener('canplay', onCanPlay); reject(new Error('load failed')); };
    el.addEventListener('canplay', onCanPlay, { once: true });
    el.addEventListener('error', onError, { once: true });
  });

export function usePlayer() {
  // Only what the UI needs to re-render — kept minimal
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [songs, setSongs] = useState<Song[]>([]);
  const [activeMode, setActiveMode] = useState<string>(() => localStorage.getItem('default_mode') || 'linger');

  // All mutable playback state lives in refs — no stale closures, no 60fps re-renders
  const audioA = useRef<HTMLAudioElement | null>(null);
  const audioB = useRef<HTMLAudioElement | null>(null);
  const activeRef = useRef<'A' | 'B'>('A');
  const queueRef = useRef<Song[]>([]);
  const allSongsRef = useRef<Song[]>([]);
  const preloadedRef = useRef<Preloaded | null>(null);
  const crossfadingRef = useRef(false);
  const fadeRafRef = useRef<number | null>(null);
  const eventIdRef = useRef<string | null>(null);
  const currentSongRef = useRef<Song | null>(null);
  const activeModeRef = useRef<string>(localStorage.getItem('default_mode') || 'linger');
  const recentlyPlayedRef = useRef<string[]>([]);
  const intentionalPauseRef = useRef(false); // true when OUR code pauses (not system interruption)
  const MAX_RECENT = 20;

  const getActive = () => activeRef.current === 'A' ? audioA.current : audioB.current;
  const getInactive = () => activeRef.current === 'A' ? audioB.current : audioA.current;

  const shuffle = <T,>(arr: T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const setCurrent = (song: Song | null) => {
    currentSongRef.current = song;
    setCurrentSong(song);
    // Update document title + lock screen metadata
    document.title = song?.title ? `Playing ${song.title} - Entuned` : 'Entuned';
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song?.title || 'Untitled',
        artist: localStorage.getItem('store_name') || '',
        album: localStorage.getItem('client_name') || '',
      });
    }
  };

  const logPlayStart = async (songId: string) => {
    try {
      const res = await playerApi<{ data: { id: string } }>('/api/player/events/play', {
        method: 'POST',
        body: { song_id: songId, started_at: new Date().toISOString(), active_mode: activeModeRef.current },
      });
      eventIdRef.current = res.data.id;
    } catch (err) {
      console.error('Failed to log play start:', err);
    }
  };

  const logPlayEnd = async (durationPlayed: number) => {
    if (!eventIdRef.current) return;
    try {
      await playerApi(`/api/player/events/play/${eventIdRef.current}`, {
        method: 'PATCH',
        body: { ended_at: new Date().toISOString(), duration_played: Math.round(durationPlayed) },
      });
    } catch (err) {
      console.error('Failed to log play end:', err);
    }
    eventIdRef.current = null;
  };

  // Stable accessor for progress — reads audio refs directly, safe to call from rAF
  const getAudioInfo = useCallback(() => {
    const el = getActive();
    if (!el || !el.duration || isNaN(el.duration)) return null;
    return {
      progress: el.currentTime / el.duration,
      elapsed: el.currentTime,
      duration: el.duration,
    };
  }, []);

  // Expose active audio element for Web Audio analyser connection
  const getActiveElement = useCallback((): HTMLAudioElement | null => getActive(), []);

  // Fetch next song: try mode-aware API first, fall back to queue
  const fetchNextSong = async (): Promise<Song | null> => {
    try {
      const res = await getNextTrack(activeModeRef.current, recentlyPlayedRef.current);
      return res.data;
    } catch (err) {
      console.warn('[player] next-track API failed, falling back to queue:', err);
      // Fall back to shuffled queue from cached playlist
      if (queueRef.current.length === 0) {
        if (allSongsRef.current.length === 0) return null;
        queueRef.current = shuffle(allSongsRef.current);
      }
      return queueRef.current.shift() || null;
    }
  };

  const addToRecentlyPlayed = (songId: string) => {
    recentlyPlayedRef.current.push(songId);
    if (recentlyPlayedRef.current.length > MAX_RECENT) {
      recentlyPlayedRef.current = recentlyPlayedRef.current.slice(-MAX_RECENT);
    }
  };

  // Preload the next track into the inactive audio element.
  // Gives us a 1-track buffer so: (a) skips can show the new title and crossfade instantly,
  // and (b) playback survives brief internet drops.
  const preloadNext = useCallback(async () => {
    if (preloadedRef.current) return;
    if (crossfadingRef.current) return;
    try {
      const song = await fetchNextSong();
      if (!song || !song.audio_url) return;
      const el = getInactive();
      if (!el) return;
      const which: 'A' | 'B' = activeRef.current === 'A' ? 'B' : 'A';
      el.src = song.audio_url;
      el.volume = 0;
      el.load();
      await waitCanPlay(el);
      preloadedRef.current = { song, which };
    } catch (err) {
      console.warn('[player] preload failed:', err);
    }
  }, []);

  // Smooth rAF-based equal-power crossfade.
  // quick=true: 0.8s (user skip), quick=false: 3s (natural ending)
  //
  // Key behavior: the title/current song swaps IMMEDIATELY for instant visual feedback,
  // then the audio ramp runs underneath. Uses a preloaded track when available so skip
  // feels instant even on slow networks.
  const crossfadeToNext = useCallback(async (quick = false) => {
    if (crossfadingRef.current) return;
    crossfadingRef.current = true;

    const fadeOut = getActive();

    // Resolve next song. Preloaded path is instant; fallback does sync fetch+load.
    let nextSong: Song | null = null;
    let fadeIn: HTMLAudioElement | null = null;

    if (preloadedRef.current) {
      nextSong = preloadedRef.current.song;
      fadeIn = preloadedRef.current.which === 'A' ? audioA.current : audioB.current;
      preloadedRef.current = null;
    } else {
      nextSong = await fetchNextSong();
      if (!nextSong || !nextSong.audio_url) {
        crossfadingRef.current = false;
        return;
      }
      fadeIn = getInactive();
      if (!fadeIn) {
        crossfadingRef.current = false;
        return;
      }
      fadeIn.src = nextSong.audio_url;
      fadeIn.volume = 0;
      fadeIn.load();
      try {
        await waitCanPlay(fadeIn);
      } catch {
        console.warn('[player] Failed to load next track, skipping:', nextSong.title);
        crossfadingRef.current = false;
        crossfadeToNext(quick);
        return;
      }
    }

    if (!fadeIn || !nextSong) {
      crossfadingRef.current = false;
      return;
    }

    // Close out the previous play event (async, non-blocking)
    if (fadeOut) logPlayEnd(fadeOut.currentTime);

    // Swap active pointer first, then update UI immediately. This is what gives the user
    // instant visual feedback on skip — the title changes before the audio finishes ramping.
    activeRef.current = activeRef.current === 'A' ? 'B' : 'A';
    setCurrent(nextSong);
    setIsPlaying(true);
    addToRecentlyPlayed(nextSong.id);
    logPlayStart(nextSong.id);

    // Ensure volume is 0 before play (some browsers reset after load())
    fadeIn.volume = 0;
    try {
      await fadeIn.play();
    } catch (err) {
      console.warn('[player] Failed to play next track:', err);
      crossfadingRef.current = false;
      return;
    }

    // Capture fadeOut's starting volume so a mid-fade skip doesn't cause a volume jump
    const fadeOutStartVol = fadeOut ? fadeOut.volume : 0;

    // rAF-based equal-power crossfade (sin/cos keeps perceived loudness constant)
    const duration = quick ? 800 : 3000;
    const startT = performance.now();

    if (fadeRafRef.current != null) cancelAnimationFrame(fadeRafRef.current);

    const step = (now: number) => {
      const t = Math.min(1, (now - startT) / duration);
      const outGain = fadeOutStartVol * Math.cos(t * Math.PI / 2);
      const inGain = Math.sin(t * Math.PI / 2);
      if (fadeOut) fadeOut.volume = Math.max(0, Math.min(1, outGain));
      fadeIn!.volume = Math.max(0, Math.min(1, inGain));
      if (t >= 1) {
        if (fadeOut) {
          intentionalPauseRef.current = true;
          fadeOut.pause();
          fadeOut.src = '';
        }
        fadeRafRef.current = null;
        crossfadingRef.current = false;
        // Buffer the next track for smooth playback + internet tolerance
        preloadNext();
        return;
      }
      fadeRafRef.current = requestAnimationFrame(step);
    };
    fadeRafRef.current = requestAnimationFrame(step);
  }, [preloadNext]);

  const loadPlaylist = useCallback(async () => {
    try {
      const res = await playerApi<{ data: { songs: Song[] } }>('/api/player/playlist');
      const s = res.data.songs;
      allSongsRef.current = s;
      setSongs(s);
      if (s.length > 0) {
        queueRef.current = shuffle(s);

        // Find the first track that actually loads
        let started = false;
        while (queueRef.current.length > 0 && !started) {
          const candidate = queueRef.current.shift()!;
          if (!candidate.audio_url) {
            console.warn('[player] Skipping track with no audio URL:', candidate.title);
            continue;
          }
          const el = getActive()!;
          el.src = candidate.audio_url;
          el.volume = 1;
          el.load();
          try {
            await waitCanPlay(el);
            await el.play();
            setCurrent(candidate);
            setIsPlaying(true);
            addToRecentlyPlayed(candidate.id);
            logPlayStart(candidate.id);
            started = true;
          } catch {
            console.warn('[player] Failed to load/play, trying next:', candidate.title);
            // Don't clear el.src — the track is loaded, just autoplay-blocked.
            // Keeping the src lets togglePlayPause resume it on user tap.
            setCurrent(candidate);
            addToRecentlyPlayed(candidate.id);
            setIsPlaying(false);
            started = true;
          }
        }
        // Kick off buffering of the next track immediately
        preloadNext();
      }
      setLoaded(true);
    } catch (err) {
      console.error('Failed to load playlist:', err);
      setLoaded(true);
    }
  }, [preloadNext]);

  const togglePlayPause = useCallback(() => {
    const el = getActive();
    if (!el?.src) return;
    if (el.paused) {
      el.play().then(() => {
        setIsPlaying(true);
        if (!eventIdRef.current && currentSongRef.current) {
          logPlayStart(currentSongRef.current.id);
        }
      }).catch(() => {});
    } else {
      // Smooth 80ms fade-out to avoid audible click
      const originalVol = el.volume;
      let step = 0;
      const fadeSteps = 8;
      const iv = setInterval(() => {
        step++;
        el.volume = Math.max(0, originalVol * (1 - step / fadeSteps));
        if (step >= fadeSteps) {
          clearInterval(iv);
          intentionalPauseRef.current = true;
          el.pause();
          el.volume = originalVol;
          setIsPlaying(false);
        }
      }, 10);
    }
  }, []);

  const skip = useCallback(() => {
    // Cancel any in-progress crossfade so skip is always responsive
    if (fadeRafRef.current != null) {
      cancelAnimationFrame(fadeRafRef.current);
      fadeRafRef.current = null;
      // Mid-fade, getInactive() is the fading-out track; kill it so the next crossfade
      // can reuse that slot for the new preload-less load path.
      const dying = getInactive();
      if (dying) { intentionalPauseRef.current = true; dying.pause(); dying.src = ''; }
      crossfadingRef.current = false;
    }
    crossfadeToNext(true); // quick 0.8s fade
  }, [crossfadeToNext]);

  // Set up audio elements, ended listeners, and lock screen controls
  useEffect(() => {
    // Create audio elements AND append to DOM — iOS Safari requires elements
    // to be in the document for background/lock-screen audio playback.
    audioA.current = new Audio();
    audioB.current = new Audio();
    audioA.current.crossOrigin = 'anonymous';
    audioB.current.crossOrigin = 'anonymous';
    audioA.current.preload = 'auto';
    audioB.current.preload = 'auto';
    // Appending to DOM is what grants iOS background audio privileges.
    // Elements are inert (no controls, no layout) — purely for the audio session.
    document.body.appendChild(audioA.current);
    document.body.appendChild(audioB.current);

    // Use timeupdate to trigger early crossfade — unlike setInterval, timeupdate
    // fires reliably on iOS even when the page is backgrounded/locked.
    const earlyFadeRef = { triggered: false };
    const onTimeUpdate = (e: Event) => {
      const el = e.target as HTMLAudioElement;
      if (el !== getActive()) return;
      if (!el.duration || isNaN(el.duration) || crossfadingRef.current || el.paused) return;
      if (el.duration - el.currentTime <= 3 && !earlyFadeRef.triggered) {
        earlyFadeRef.triggered = true;
        crossfadeToNext(false); // 3s natural crossfade
      }
      if (el.currentTime < el.duration - 5) earlyFadeRef.triggered = false;
    };
    audioA.current.addEventListener('timeupdate', onTimeUpdate);
    audioB.current.addEventListener('timeupdate', onTimeUpdate);

    // Fallback: if song ends without early fade (very short songs)
    const onEnded = () => { if (!crossfadingRef.current) crossfadeToNext(); };
    audioA.current.addEventListener('ended', onEnded);
    audioB.current.addEventListener('ended', onEnded);

    // Auto-resume after system interruptions (calls, alarms, Siri, permission dialogs).
    // If our code paused intentionally, intentionalPauseRef is true and we skip.
    // Otherwise the OS stole audio focus — retry with backoff until we succeed.
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    const clearResumeTimer = () => { if (resumeTimer != null) { clearTimeout(resumeTimer); resumeTimer = null; } };

    const tryResume = (el: HTMLAudioElement, attempt = 0) => {
      clearResumeTimer();
      // Give up after ~30s of retrying (attempts at 1s, 2s, 4s, 8s, 15s)
      if (attempt > 4) return;
      // If user paused manually while we were retrying, stop
      if (el !== getActive() || !el.src || crossfadingRef.current) return;
      if (!el.paused) return; // already resumed (e.g. lock screen controls)

      el.play()
        .then(() => { setIsPlaying(true); clearResumeTimer(); })
        .catch(() => {
          // Still interrupted — wait longer and retry. Backoff: 1s, 2s, 4s, 8s, 15s
          const delay = Math.min(15000, 1000 * Math.pow(2, attempt));
          resumeTimer = setTimeout(() => tryResume(el, attempt + 1), delay);
        });
    };

    const onExternalPause = (e: Event) => {
      const el = e.target as HTMLAudioElement;
      if (intentionalPauseRef.current) {
        intentionalPauseRef.current = false;
        return;
      }
      // Only auto-resume the active element (not the one fading out)
      if (el !== getActive()) return;
      // Start retry loop after 1s
      resumeTimer = setTimeout(() => tryResume(el, 0), 1000);
    };
    audioA.current.addEventListener('pause', onExternalPause);
    audioB.current.addEventListener('pause', onExternalPause);

    // When iOS dismisses an alarm/call it returns focus to the app.
    // This is our best signal that the interruption ended — try to resume immediately.
    const onFocus = () => {
      const el = getActive();
      if (el?.src && el.paused && currentSongRef.current && !intentionalPauseRef.current) {
        clearResumeTimer();
        el.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    };
    window.addEventListener('focus', onFocus);

    // Resume playback when returning from lock screen / background tab.
    // iOS suspends the page on lock — when it wakes, the audio element is paused
    // and any in-progress rAF crossfade is frozen. This handler recovers both.
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      const el = getActive();
      if (!el?.src) return;

      // If a crossfade was in progress, finish it instantly (rAF was frozen)
      if (crossfadingRef.current) {
        if (fadeRafRef.current != null) {
          cancelAnimationFrame(fadeRafRef.current);
          fadeRafRef.current = null;
        }
        // Snap volumes: active to 1, inactive to 0 and stop
        el.volume = 1;
        const dying = getInactive();
        if (dying) {
          intentionalPauseRef.current = true;
          dying.pause();
          dying.src = '';
        }
        crossfadingRef.current = false;
        preloadNext();
      }

      // Resume playback if it was playing before lock
      if (el.paused && currentSongRef.current) {
        el.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Lock screen / notification controls (iOS Safari 15+, Chrome, etc.)
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => {
        const el = getActive();
        if (el?.src) el.play().then(() => setIsPlaying(true)).catch(() => {});
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        const el = getActive();
        if (el) {
          intentionalPauseRef.current = true;
          el.pause();
          setIsPlaying(false);
        }
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => skip());
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
      clearResumeTimer();
      audioA.current?.removeEventListener('timeupdate', onTimeUpdate);
      audioB.current?.removeEventListener('timeupdate', onTimeUpdate);
      audioA.current?.removeEventListener('ended', onEnded);
      audioB.current?.removeEventListener('ended', onEnded);
      audioA.current?.removeEventListener('pause', onExternalPause);
      audioB.current?.removeEventListener('pause', onExternalPause);
      intentionalPauseRef.current = true;
      audioA.current?.pause();
      audioB.current?.pause();
      // Remove from DOM
      if (audioA.current?.parentNode) audioA.current.parentNode.removeChild(audioA.current);
      if (audioB.current?.parentNode) audioB.current.parentNode.removeChild(audioB.current);
      if (fadeRafRef.current != null) cancelAnimationFrame(fadeRafRef.current);
    };
  }, []);

  // Track loved songs across session
  const [lovedIds, setLovedIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('loved_songs') || '[]')); } catch { return new Set(); }
  });
  const markLoved = useCallback((songId: string) => {
    setLovedIds(prev => {
      const next = new Set(prev).add(songId);
      localStorage.setItem('loved_songs', JSON.stringify([...next]));
      return next;
    });
  }, []);

  const changeMode = useCallback((newMode: string) => {
    const previousMode = activeModeRef.current;
    if (previousMode === newMode) return;
    activeModeRef.current = newMode;
    setActiveMode(newMode);
    logModeChange(previousMode, newMode).catch((err) => {
      console.error('Failed to log mode change:', err);
    });
  }, []);

  return { currentSong, isPlaying, songs, loaded, loadPlaylist, togglePlayPause, skip, getAudioInfo, getActiveElement, lovedIds, markLoved, activeMode, changeMode };
}
