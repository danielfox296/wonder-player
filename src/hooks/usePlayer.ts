import { useRef, useState, useCallback, useEffect } from 'react';
import { playerApi } from '../lib/api.js';

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
  };

  const logPlayStart = async (songId: string) => {
    try {
      const res = await playerApi<{ data: { id: string } }>('/api/player/events/play', {
        method: 'POST',
        body: { song_id: songId, started_at: new Date().toISOString() },
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

  // Stable crossfade — [] deps because it reads refs only, never closes over state
  const crossfadeToNext = useCallback(async () => {
    if (crossfadingRef.current) return;

    // Replenish queue if empty
    if (queueRef.current.length === 0) {
      if (allSongsRef.current.length === 0) return;
      queueRef.current = shuffle(allSongsRef.current);
    }

    crossfadingRef.current = true;

    const fadeOut = getActive()!;
    await logPlayEnd(fadeOut.currentTime);

    const nextSong = queueRef.current.shift()!;
    // Pre-emptively reshuffle so queue is never empty when needed
    if (queueRef.current.length === 0) {
      queueRef.current = shuffle(allSongsRef.current);
    }

    const fadeIn = getInactive()!;
    fadeIn.src = nextSong.audio_url;
    fadeIn.volume = 0;
    fadeIn.load();

    try { await fadeIn.play(); } catch { /* autoplay policy — will play once user interacts */ }

    // Swap active ref so getAudioInfo() tracks the new song immediately
    activeRef.current = activeRef.current === 'A' ? 'B' : 'A';
    setCurrent(nextSong);
    setIsPlaying(true);

    logPlayStart(nextSong.id);

    // 3-second crossfade: 30 steps × 100ms
    let step = 0;
    if (fadeTimerRef.current) clearInterval(fadeTimerRef.current);
    fadeTimerRef.current = window.setInterval(() => {
      step++;
      const ratio = step / 30;
      fadeOut.volume = Math.max(0, 1 - ratio);
      fadeIn.volume = Math.min(1, ratio);
      if (step >= 30) {
        clearInterval(fadeTimerRef.current!);
        fadeTimerRef.current = null;
        fadeOut.pause();
        fadeOut.src = '';
        crossfadingRef.current = false;
      }
    }, 100);
  }, []); // stable — safe to use in event listeners without re-registration

  const loadPlaylist = useCallback(async () => {
    try {
      const res = await playerApi<{ data: { songs: Song[] } }>('/api/player/playlist');
      const s = res.data.songs;
      allSongsRef.current = s;
      setSongs(s);
      if (s.length > 0) {
        queueRef.current = shuffle(s);
        const first = queueRef.current.shift()!;
        const el = getActive()!;
        el.src = first.audio_url;
        el.volume = 1;
        el.load();
        try {
          await el.play();
          setCurrent(first);
          setIsPlaying(true);
          logPlayStart(first.id);
        } catch {
          // Autoplay blocked — show title and play button so user can start manually
          setCurrent(first);
          setIsPlaying(false);
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
      el.pause();
      setIsPlaying(false);
    }
  }, []);

  const skip = useCallback(() => { crossfadeToNext(); }, [crossfadeToNext]);

  // Set up audio elements and ended listeners once — crossfadeToNext is stable so no re-registration needed
  useEffect(() => {
    audioA.current = new Audio();
    audioB.current = new Audio();
    audioA.current.preload = 'auto';
    audioB.current.preload = 'auto';

    const onEnded = () => crossfadeToNext();
    audioA.current.addEventListener('ended', onEnded);
    audioB.current.addEventListener('ended', onEnded);

    return () => {
      audioA.current?.removeEventListener('ended', onEnded);
      audioB.current?.removeEventListener('ended', onEnded);
      audioA.current?.pause();
      audioB.current?.pause();
      if (fadeTimerRef.current) clearInterval(fadeTimerRef.current);
    };
  }, []);

  return { currentSong, isPlaying, songs, loaded, loadPlaylist, togglePlayPause, skip, getAudioInfo };
}
