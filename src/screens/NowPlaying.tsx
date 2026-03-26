import { useEffect, useState, useCallback } from 'react';
import { usePlayer } from '../hooks/usePlayer.js';
import Visualization from '../components/Visualization.js';
import FlagModal from '../components/FlagModal.js';

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export default function NowPlaying() {
  const { playState, loaded, loadPlaylist, togglePlayPause, skip, songs } = usePlayer();
  const [showFlag, setShowFlag] = useState(false);
  const [reportPulse, setReportPulse] = useState(false);
  const [lovePulse, setLovePulse] = useState(false);
  const [online, setOnline] = useState(true);
  const clientName = localStorage.getItem('client_name') || '';
  const storeName = localStorage.getItem('store_name') || '';

  useEffect(() => { loadPlaylist(); }, [loadPlaylist]);

  // Connection check every 30s
  useEffect(() => {
    const check = async () => {
      try {
        await fetch(
          (import.meta.env.VITE_API_URL || 'http://localhost:3000') + '/api/auth/verify',
          { method: 'GET', signal: AbortSignal.timeout(3000) }
        );
        setOnline(true);
      } catch { setOnline(false); }
    };
    check();
    const iv = setInterval(check, 30000);
    return () => clearInterval(iv);
  }, []);

  const handleReport = useCallback(() => { setShowFlag(true); }, []);
  const handleFlagDone = useCallback(() => { setShowFlag(false); skip(); }, [skip]);
  const handleFlagClose = useCallback(() => { setShowFlag(false); }, []);

  const handleLove = useCallback(() => {
    setLovePulse(true);
    setTimeout(() => setLovePulse(false), 1000);
  }, []);

  const handleReportClick = useCallback(() => {
    setReportPulse(true);
    setTimeout(() => setReportPulse(false), 700);
    handleReport();
  }, [handleReport]);

  const song = playState.currentSong;
  const duration = song?.duration_seconds || 0;

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <Visualization />

      {/* UI layer */}
      <div style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 28px' }}>
          <img src="/logo.png" alt="Entuned" style={{ height: 20, opacity: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20, fontWeight: 200, color: 'rgba(255,255,255,0.11)', letterSpacing: 0.5, textTransform: 'uppercase' }}>
              {clientName}{clientName && storeName ? ' — ' : ''}{storeName}
            </span>
            <div style={{
              width: 4, height: 4, borderRadius: '50%',
              background: online ? '#27ae60' : '#e74c3c',
              animation: 'dp 3s ease-in-out infinite',
            }} />
          </div>
        </div>

        {/* Center content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', paddingBottom: 40 }}>

          {/* Song title */}
          {loaded && songs.length === 0 ? (
            <div style={{ fontSize: 14, fontWeight: 300, color: 'rgba(255,255,255,0.25)', letterSpacing: 2 }}>
              NO SONGS AVAILABLE
            </div>
          ) : (
            <div style={{
              fontSize: 24, fontWeight: 300,
              color: 'rgba(255,255,255,0.55)', letterSpacing: 8, lineHeight: 1.7,
              textTransform: 'uppercase', textAlign: 'center',
              padding: '0 40px', marginBottom: 64,
            }}>
              {song?.title || ''}
            </div>
          )}

          {/* Progress bar */}
          {song && (
            <div style={{ width: '88%', maxWidth: 540 }}>
              <div style={{ position: 'relative', height: 6, background: 'rgba(255,255,255,0.04)', borderRadius: 3 }}>
                <div style={{
                  height: 6, borderRadius: 3,
                  background: 'rgba(74,144,164,0.4)',
                  width: `${playState.progress * 100}%`,
                  transition: 'width 0.2s linear',
                }} />
                <div style={{
                  position: 'absolute', top: -5,
                  left: `calc(${playState.progress * 100}% - 8px)`,
                  width: 16, height: 16, borderRadius: '50%',
                  background: 'rgba(255,255,255,0.65)',
                  border: '2px solid rgba(74,144,164,0.45)',
                  transition: 'left 0.2s linear',
                }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
                <span style={{ fontSize: 10, fontWeight: 200, color: 'rgba(255,255,255,0.08)', letterSpacing: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {formatTime(playState.elapsed)}
                </span>
                <span style={{ fontSize: 10, fontWeight: 200, color: 'rgba(255,255,255,0.08)', letterSpacing: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {formatTime(duration)}
                </span>
              </div>
            </div>
          )}

          {/* Play + Skip buttons */}
          {song && (
            <div style={{ display: 'flex', gap: 48, marginTop: 60 }}>
              <CircleButton onClick={togglePlayPause}>
                {playState.isPlaying ? (
                  <svg width="28" height="28" viewBox="0 0 28 28">
                    <rect x="7" y="5" width="5" height="18" rx="1.5" fill="rgba(255,255,255,0.65)" />
                    <rect x="16" y="5" width="5" height="18" rx="1.5" fill="rgba(255,255,255,0.65)" />
                  </svg>
                ) : (
                  <svg width="28" height="28" viewBox="0 0 28 28">
                    <path d="M9 4l12 8-12 8z" fill="rgba(255,255,255,0.65)" />
                  </svg>
                )}
              </CircleButton>
              <CircleButton onClick={skip}>
                <svg width="26" height="26" viewBox="0 0 24 24">
                  <path d="M4.5 5l10 7-10 7zm12.5 0v14h2.5V5z" fill="rgba(255,255,255,0.65)" />
                </svg>
              </CircleButton>
            </div>
          )}
        </div>

        {/* Bottom edge icons */}
        {song && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 36px' }}>
            <EdgeButton onClick={handleReportClick} pulse={reportPulse} pulseColor="240,153,123">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke={reportPulse ? 'rgba(240,153,123,0.7)' : 'rgba(240,153,123,0.35)'} strokeWidth="1.2" />
                <line x1="12" y1="8" x2="12" y2="13" stroke={reportPulse ? 'rgba(240,153,123,0.7)' : 'rgba(240,153,123,0.35)'} strokeWidth="1.2" strokeLinecap="round" />
                <circle cx="12" cy="16" r="0.5" fill={reportPulse ? 'rgba(240,153,123,0.7)' : 'rgba(240,153,123,0.35)'} />
              </svg>
            </EdgeButton>
            <EdgeButton onClick={handleLove} pulse={lovePulse} pulseColor="93,202,165">
              <svg width="26" height="26" viewBox="0 0 24 24">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
                  fill={lovePulse ? 'rgba(93,202,165,0.8)' : 'rgba(93,202,165,0.3)'} />
              </svg>
            </EdgeButton>
          </div>
        )}
      </div>

      {showFlag && <FlagModal onSelect={handleFlagDone} onClose={handleFlagClose} />}
    </div>
  );
}

function CircleButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => { setPressed(false); setHovered(false); }}
      onPointerEnter={() => setHovered(true)}
      style={{
        width: 80, height: 80, borderRadius: '50%',
        border: `1px solid ${hovered || pressed ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.09)'}`,
        background: pressed ? 'rgba(255,255,255,0.1)' : hovered ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)',
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'transform 0.12s, border-color 0.3s, background 0.3s',
        transform: pressed ? 'scale(0.86)' : 'scale(1)',
        userSelect: 'none',
        outline: 'none',
      }}
    >
      {children}
    </button>
  );
}

function EdgeButton({ onClick, children, pulse, pulseColor }: { onClick: () => void; children: React.ReactNode; pulse: boolean; pulseColor: string }) {
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => { setPressed(false); setHovered(false); }}
      onPointerEnter={() => setHovered(true)}
      style={{
        width: 52, height: 52, borderRadius: '50%',
        border: `1px solid ${pulse ? `rgba(${pulseColor},0.2)` : hovered ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.0)'}`,
        background: pulse ? `rgba(${pulseColor},0.08)` : pressed ? 'rgba(255,255,255,0.08)' : hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'transform 0.15s, border-color 0.3s, background 0.3s',
        transform: pulse ? 'scale(1.15)' : pressed ? 'scale(0.85)' : 'scale(1)',
        outline: 'none',
      }}
    >
      {children}
    </button>
  );
}
