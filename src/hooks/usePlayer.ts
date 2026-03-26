import { useRef, useState, useCallback, useEffect } from 'react';
import { playerApi } from '../lib/api.js';

interface Song {
  id: string;
  title: string | null;
  audio_url: string;
  duration_seconds: number;
}

interface PlayState {
  currentSong: Song | null;
  isPlaying: boolean;
  progress: number; // 0-1
  elapsed: number;  // seconds
}

export function usePlayer() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [queue, setQueue] = useState<Song[]>([]);
  const [playState, setPlayState] = useState<PlayState>({ currentSong: null, isPlaying: false, progress: 0, elapsed: 0 });
  const [loaded, setLoaded] = useState(false);

  const audioA = useRef<HTMLAudioElement | null>(null);
  const audioB = useRef<HTMLAudioElement | null>(null);
  const activeRef = useRef<'A' | 'B'>('A');
  const fadeTimer = useRef<number | null>(null);
  const progressTimer = useRef<number | null>(null);
  const currentEventId = useRef<string | null>(null);
  const crossfading = useRef(false);

  const getActive = () => activeRef.current === 'A' ? audioA.current : audioB.current;
  const getInactive = () => activeRef.current === 'A' ? audioB.current : audioA.current;

  // Shuffle array
  const shuffle = (arr: Song[]) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  // Load playlist
  const loadPlaylist = useCallback(async () => {
    try {
      const res = await playerApi<{ data: { songs: Song[] } }>('/api/player/playlist');
      const s = res.data.songs;
      setSongs(s);
      if (s.length > 0) {
        const shuffled = shuffle(s);
        setQueue(shuffled);
      }
      setLoaded(true);
    } catch (err) {
      console.error('Failed to load playlist:', err);
      setLoaded(true);
    }
  }, []);

  // Log play start
  const logPlayStart = async (songId: string) => {
    try {
      const res = await playerApi<{ data: { id: string } }>('/api/player/events/play', {
        method: 'POST',
        body: { song_id: songId, started_at: new Date().toISOString() },
      });
      currentEventId.current = res.data.id;
    } catch (err) {
      console.error('Failed to log play start:', err);
    }
  };

  // Log play end
  const logPlayEnd = async (durationPlayed: number) => {
    if (!currentEventId.current) return;
    try {
      await playerApi(`/api/player/events/play/${currentEventId.current}`, {
        method: 'PATCH',
        body: { ended_at: new Date().toISOString(), duration_played: Math.round(durationPlayed) },
      });
    } catch (err) {
      console.error('Failed to log play end:', err);
    }
    currentEventId.current = null;
  };

  // Start progress tracking
  const startProgress = () => {
    if (progressTimer.current) cancelAnimationFrame(progressTimer.current);
    const tick = () => {
      const el = getActive();
      if (el && el.duration && !isNaN(el.duration)) {
        setPlayState((prev) => ({
          ...prev,
          progress: el.currentTime / el.duration,
          elapsed: el.currentTime,
        }));
      }
      progressTimer.current = requestAnimationFrame(tick);
    };
    progressTimer.current = requestAnimationFrame(tick);
  };

  const stopProgress = () => {
    if (progressTimer.current) { cancelAnimationFrame(progressTimer.current); progressTimer.current = null; }
  };

  // Play a song on the active audio element
  const playSong = useCallback(async (song: Song) => {
    const el = getActive();
    if (!el) return;
    el.src = song.audio_url;
    el.volume = 1;
    el.load();
    try {
      await el.play();
    } catch (err) {
      console.error('Playback failed:', err);
    }
    setPlayState({ currentSong: song, isPlaying: true, progress: 0, elapsed: 0 });
    startProgress();
    await logPlayStart(song.id);
  }, []);

  // Crossfade to next song
  const crossfadeToNext = useCallback(async () => {
    if (crossfading.current || queue.length === 0) return;
    crossfading.current = true;

    const elapsed = getActive()?.currentTime || 0;
    await logPlayEnd(elapsed);

    // Get next song — rotate queue
    let nextQueue = [...queue];
    const nextSong = nextQueue.shift()!;
    if (nextQueue.length === 0) nextQueue = shuffle(songs); // re-shuffle when exhausted
    setQueue(nextQueue);

    // Prepare inactive element
    const fadeOut = getActive()!;
    const fadeIn = getInactive()!;
    fadeIn.src = nextSong.audio_url;
    fadeIn.volume = 0;
    fadeIn.load();

    try { await fadeIn.play(); } catch { /* ignore */ }

    // 3-second crossfade
    const steps = 30; // 30 steps over 3s = 100ms per step
    let step = 0;
    if (fadeTimer.current) clearInterval(fadeTimer.current);
    fadeTimer.current = window.setInterval(() => {
      step++;
      const ratio = step / steps;
      fadeOut.volume = Math.max(0, 1 - ratio);
      fadeIn.volume = Math.min(1, ratio);
      if (step >= steps) {
        clearInterval(fadeTimer.current!);
        fadeTimer.current = null;
        fadeOut.pause();
        fadeOut.src = '';
        activeRef.current = activeRef.current === 'A' ? 'B' : 'A';
        crossfading.current = false;
      }
    }, 100);

    setPlayState({ currentSong: nextSong, isPlaying: true, progress: 0, elapsed: 0 });
    startProgress();
    await logPlayStart(nextSong.id);
  }, [queue, songs]);

  // Toggle play/pause
  const togglePlayPause = useCallback(() => {
    const el = getActive();
    if (!el) return;
    if (el.paused) {
      el.play();
      setPlayState((p) => ({ ...p, isPlaying: true }));
      startProgress();
    } else {
      el.pause();
      setPlayState((p) => ({ ...p, isPlaying: false }));
      stopProgress();
    }
  }, []);

  // Skip
  const skip = useCallback(() => { crossfadeToNext(); }, [crossfadeToNext]);

  // Initialize audio elements
  useEffect(() => {
    audioA.current = new Audio();
    audioB.current = new Audio();
    audioA.current.preload = 'auto';
    audioB.current.preload = 'auto';

    // Auto-advance when song ends naturally
    const onEnded = () => { if (!crossfading.current) crossfadeToNext(); };
    audioA.current.addEventListener('ended', onEnded);
    audioB.current.addEventListener('ended', onEnded);

    return () => {
      audioA.current?.pause();
      audioB.current?.pause();
      stopProgress();
      if (fadeTimer.current) clearInterval(fadeTimer.current);
    };
  }, []);

  // Start playing when queue is ready
  useEffect(() => {
    if (queue.length > 0 && !playState.currentSong) {
      const first = queue[0];
      setQueue((q) => q.slice(1));
      playSong(first);
    }
  }, [queue, playState.currentSong]);

  return { playState, songs, loaded, loadPlaylist, togglePlayPause, skip, crossfadeToNext };
}
