import { useRef, useState, useCallback, useEffect } from 'react';
import { playerApi, getNextTrack, logModeChange } from '../lib/api.js';

interface Song {
  id: string;
  title: string | null;
  audio_url: string;
  duration_seconds: number;
}

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
  const crossfadingRef = useRef(false);
  const fadeTimerRef = useRef<number | null>(null);
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

  // Stable crossfade — [] deps because it reads refs only, never closes over state
  // quick=true: 1.5s fade (user skip), quick=false: 3s fade (natural ending)
  const crossfadeToNext = useCallback(async (quick = false) => {
    if (crossfadingRef.current) return;

    crossfadingRef.current = true;

    const fadeOut = getActive()!;
    await logPlayEnd(fadeOut.currentTime);

    const nextSong = await fetchNextSong();
    if (!nextSong) {
      crossfadingRef.current = false;
      return;
    }

    const fadeIn = getInactive()!;

    // Skip tracks with missing audio URLs
    if (!nextSong.audio_url) {
      console.warn('[player] Skipping track with no audio URL:', nextSong.title);
      crossfadingRef.current = false;
      crossfadeToNext(quick);
      return;
    }

    fadeIn.src = nextSong.audio_url;
    fadeIn.volume = 0;
    fadeIn.load();

    try {
      await new Promise<void>((resolve, reject) => {
        const onCanPlay = () => { fadeIn.removeEventListener('error', onError); resolve(); };
        const onError = () => { fadeIn.removeEventListener('canplay', onCanPlay); reject(new Error('load failed')); };
        fadeIn.addEventListener('canplay', onCanPlay, { once: true });
        fadeIn.addEventListener('error', onError, { once: true });
      });
      await fadeIn.play();
    } catch (err) {
      console.warn('[player] Failed to play track, skipping:', nextSong.title, err);
      fadeIn.src = '';
      crossfadingRef.current = false;
      // Auto-skip to next track on load/play failure
      crossfadeToNext(quick);
      return;
    }

    activeRef.current = activeRef.current === 'A' ? 'B' : 'A';
    setCurrent(nextSong);
    setIsPlaying(true);
    addToRecentlyPlayed(nextSong.id);

    logPlayStart(nextSong.id);

    const totalSteps = quick ? 6 : 30; // 0.6s skip or 3s natural ending
    let step = 0;
    if (fadeTimerRef.current) clearInterval(fadeTimerRef.current);
    fadeTimerRef.current = window.setInterval(() => {
      step++;
      const ratio = step / totalSteps;
      fadeOut.volume = Math.max(0, 1 - ratio);
      fadeIn.volume = Math.min(1, ratio);
      if (step >= totalSteps) {
        clearInterval(fadeTimerRef.current!);
        fadeTimerRef.current = null;
        intentionalPauseRef.current = true;
        fadeOut.pause();
        fadeOut.src = '';
        crossfadingRef.current = false;
      }
    }, 100);
  }, []);

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
            await new Promise<void>((resolve, reject) => {
              const onCanPlay = () => { el.removeEventListener('error', onError); resolve(); };
              const onError = () => { el.removeEventListener('canplay', onCanPlay); reject(new Error('load failed')); };
              el.addEventListener('canplay', onCanPlay, { once: true });
              el.addEventListener('error', onError, { once: true });
            });
            await el.play();
            setCurrent(candidate);
            setIsPlaying(true);
            logPlayStart(candidate.id);
            started = true;
          } catch {
            console.warn('[player] Failed to load/play, trying next:', candidate.title);
            // Don't clear el.src — the track is loaded, just autoplay-blocked.
            // Keeping the src lets togglePlayPause resume it on user tap.
            setCurrent(candidate);
            setIsPlaying(false);
            started = true;
          }
        }
      }
      setLoaded(true);
    } catch (err) {
      console.error('Failed to load playlist:', err);
      setLoaded(true);
    }
  }, []);

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
    if (fadeTimerRef.current) {
      clearInterval(fadeTimerRef.current);
      fadeTimerRef.current = null;
      const old = getInactive();
      if (old) { intentionalPauseRef.current = true; old.pause(); old.src = ''; }
      crossfadingRef.current = false;
    }
    crossfadeToNext(true); // quick 1.5s fade
  }, [crossfadeToNext]);

  // Set up audio elements, ended listeners, and lock screen controls
  useEffect(() => {
    audioA.current = new Audio();
    audioB.current = new Audio();
    audioA.current.preload = 'auto';
    audioB.current.preload = 'auto';

    // Crossfade 3s before song ends for seamless overlap
    const earlyFadeRef = { triggered: false };
    const checkEarlyFade = () => {
      const el = getActive();
      if (!el || !el.duration || isNaN(el.duration) || crossfadingRef.current || el.paused) return;
      if (el.duration - el.currentTime <= 3 && !earlyFadeRef.triggered) {
        earlyFadeRef.triggered = true;
        crossfadeToNext(false); // 3s natural crossfade
      }
      if (el.currentTime < el.duration - 5) earlyFadeRef.triggered = false;
    };
    const fadeCheckInterval = setInterval(checkEarlyFade, 500);

    // Fallback: if song ends without early fade (very short songs)
    const onEnded = () => { if (!crossfadingRef.current) crossfadeToNext(); };
    audioA.current.addEventListener('ended', onEnded);
    audioB.current.addEventListener('ended', onEnded);

    // Auto-resume after system interruptions (calls, alarms, Siri, permission dialogs).
    // If our code paused intentionally, intentionalPauseRef is true and we skip.
    // Otherwise the OS stole audio focus — wait 1s then try to resume.
    const onExternalPause = (e: Event) => {
      const el = e.target as HTMLAudioElement;
      if (intentionalPauseRef.current) {
        intentionalPauseRef.current = false;
        return;
      }
      // Only auto-resume the active element (not the one fading out)
      if (el !== getActive()) return;
      setTimeout(() => {
        if (el.paused && el.src && !crossfadingRef.current) {
          el.play().then(() => setIsPlaying(true)).catch(() => {});
        }
      }, 1000);
    };
    audioA.current.addEventListener('pause', onExternalPause);
    audioB.current.addEventListener('pause', onExternalPause);

    // Lock screen / notification controls (iOS Safari 15+, Chrome, etc.)
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => {
        const el = audioA.current?.paused === false ? audioA.current : audioB.current;
        if (el?.src) el.play().catch(() => {});
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        const el = audioA.current?.paused === false ? audioA.current : audioB.current;
        intentionalPauseRef.current = true;
        el?.pause();
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => skip());
    }

    return () => {
      audioA.current?.removeEventListener('ended', onEnded);
      audioB.current?.removeEventListener('ended', onEnded);
      audioA.current?.removeEventListener('pause', onExternalPause);
      audioB.current?.removeEventListener('pause', onExternalPause);
      intentionalPauseRef.current = true;
      audioA.current?.pause();
      audioB.current?.pause();
      if (fadeTimerRef.current) clearInterval(fadeTimerRef.current);
      clearInterval(fadeCheckInterval);
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
