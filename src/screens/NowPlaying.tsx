import { useEffect, useState, useCallback, useRef } from 'react';
import { usePlayer } from '../hooks/usePlayer.js';
import { useAmbientMonitor } from '../hooks/useAmbientMonitor.js';
import { useAudioAnalyser } from '../hooks/useAudioAnalyser.js';
import Visualization from '../components/Visualization.js';
import FlagModal from '../components/FlagModal.js';
import OutcomeModal from '../components/OutcomeModal.js';
import { sendFeedback } from '../lib/api.js';

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}



export default function NowPlaying() {
  const { currentSong, isPlaying, loaded, loadPlaylist, togglePlayPause, skip, songs, getAudioInfo, getActiveElement, lovedIds, markLoved, activeMode, changeMode } = usePlayer();
  useAmbientMonitor(300000);
  const { connectIfNeeded, getAmplitude } = useAudioAnalyser();
  const [showFlag, setShowFlag] = useState(false);
  const [showOutcome, setShowOutcome] = useState(false);
  const [reportPulse, setReportPulse] = useState(false);
  const [lovePulse, setLovePulse] = useState(false);
  const [online, setOnline] = useState(true);
  const [showLogout, setShowLogout] = useState(false);
  const clientName = localStorage.getItem('client_name') || '';
  const storeName = localStorage.getItem('store_name') || '';

  const isLoved = currentSong ? lovedIds.has(currentSong.id) : false;

  const fillRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const elapsedRef = useRef<HTMLSpanElement>(null);
  const durationRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let rafId: number;
    const tick = () => {
      const info = getAudioInfo();
      if (info) {
        const pct = info.progress * 100;
        if (fillRef.current) fillRef.current.style.width = `${pct}%`;
        if (knobRef.current) knobRef.current.style.left = `calc(${pct}% - 8px)`;
        if (elapsedRef.current) elapsedRef.current.textContent = formatTime(info.elapsed);
        if (durationRef.current) durationRef.current.textContent = formatTime(info.duration);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [getAudioInfo]);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('device_token');
    localStorage.removeItem('store_id');
    localStorage.removeItem('store_name');
    localStorage.removeItem('client_name');
    window.location.href = '/setup';
  }, []);

  useEffect(() => { loadPlaylist(); }, [loadPlaylist]);

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
  const handleFlagDone = useCallback((reason: string) => {
    setShowFlag(false);
    if (currentSong) sendFeedback(currentSong.id, 'report', reason).catch(() => {});
    skip();
  }, [skip, currentSong]);
  const handleFlagClose = useCallback(() => { setShowFlag(false); }, []);

  const handleLove = useCallback(() => {
    setLovePulse(true);
    setTimeout(() => setLovePulse(false), 1000);
    if (currentSong) {
      markLoved(currentSong.id);
      sendFeedback(currentSong.id, 'love').catch(() => {});
    }
  }, [currentSong, markLoved]);

  const handleReportClick = useCallback(() => {
    setReportPulse(true);
    setTimeout(() => setReportPulse(false), 700);
    handleReport();
  }, [handleReport]);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <Visualization getAmplitude={getAmplitude} connectAnalyser={connectIfNeeded} getActiveElement={getActiveElement} songId={currentSong?.id || null} />

      <div style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>

        {/* Header gradient overlay — black at top fading to transparent */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 140,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.5) 50%, rgba(0,0,0,0) 100%)',
          pointerEvents: 'none', zIndex: 0,
        }} />

        {/* Header */}
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '20px 28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <img
              src="/logo.svg" alt="Entuned"
              style={{ height: 40, opacity: 1, cursor: 'pointer' }}
              onClick={() => setShowLogout(v => !v)}
            />
            {showLogout && (
              <button
                type="button"
                onClick={handleLogout}
                style={{
                  fontSize: 10, fontWeight: 300, letterSpacing: 1,
                  color: 'rgba(240,153,123,0.5)', background: 'none', border: '1px solid rgba(240,153,123,0.2)',
                  borderRadius: 12, padding: '4px 12px', cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'rgba(240,153,123,0.8)'; e.currentTarget.style.borderColor = 'rgba(240,153,123,0.4)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(240,153,123,0.5)'; e.currentTarget.style.borderColor = 'rgba(240,153,123,0.2)'; }}
              >
                DISCONNECT
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              type="button"
              onClick={() => setShowOutcome(true)}
              style={{
                background: 'rgba(212,225,229,0.08)', border: '1px solid rgba(212,225,229,0.25)',
                borderRadius: 20, padding: '4px 12px', cursor: 'pointer',
                fontSize: 10, fontWeight: 400, letterSpacing: 1.5, textTransform: 'uppercase',
                color: 'rgba(212,225,229,0.8)', transition: 'all 0.2s', outline: 'none',
                fontFamily: "'Inter', sans-serif",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(212,225,229,0.45)'; e.currentTarget.style.color = 'rgba(212,225,229,1)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(212,225,229,0.25)'; e.currentTarget.style.color = 'rgba(212,225,229,0.8)'; }}
            >
              {activeMode}
            </button>
            {/* Client (eyebrow) + Store (name) stacked */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
              {clientName && (
                <span style={{
                  fontSize: 9, fontWeight: 500, letterSpacing: 2.5,
                  color: 'rgba(212,225,229,0.45)', textTransform: 'uppercase',
                }}>
                  {clientName}
                </span>
              )}
              {storeName && (
                <span style={{
                  fontSize: 10, fontWeight: 300, letterSpacing: 0.5,
                  color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase',
                }}>
                  {storeName}
                </span>
              )}
            </div>
            <div style={{
              width: 5, height: 5, borderRadius: '50%',
              background: online ? '#27ae60' : '#e74c3c',
              animation: 'dp 3s ease-in-out infinite',
            }} />
          </div>
        </div>

        {/* Center content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', paddingBottom: 40 }}>

          {/* Song title with dark halo */}
          {loaded && songs.length === 0 ? (
            <DarkHalo>
              <div style={{ fontSize: 14, fontWeight: 300, color: 'rgba(255,255,255,0.35)', letterSpacing: 2 }}>
                NO SONGS AVAILABLE
              </div>
            </DarkHalo>
          ) : (
            <DarkHalo>
              <div style={{
                fontSize: 24, fontWeight: 300,
                color: 'rgba(255,255,255,0.85)', letterSpacing: 8, lineHeight: 1.7,
                textTransform: 'uppercase', textAlign: 'center',
                padding: '0 40px', marginBottom: 64,
              }}>
                {currentSong?.title || ''}
              </div>
            </DarkHalo>
          )}

          {/* Progress bar with dark halo */}
          {currentSong && (
            <DarkHalo style={{ width: '88%', maxWidth: 540 }}>
              <div style={{ position: 'relative', height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3 }}>
                <div
                  ref={fillRef}
                  style={{
                    height: 6, borderRadius: 3,
                    background: 'rgba(212,225,229,0.5)',
                    width: '0%',
                  }}
                />
                <div
                  ref={knobRef}
                  style={{
                    position: 'absolute', top: -5,
                    left: 'calc(0% - 8px)',
                    width: 16, height: 16, borderRadius: '50%',
                    background: 'rgba(255,255,255,0.85)',
                    border: '2px solid rgba(212,225,229,0.6)',
                  }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
                <span ref={elapsedRef} style={{ fontSize: 10, fontWeight: 200, color: 'rgba(255,255,255,0.3)', letterSpacing: 1, fontVariantNumeric: 'tabular-nums' }}>0:00</span>
                <span ref={durationRef} style={{ fontSize: 10, fontWeight: 200, color: 'rgba(255,255,255,0.3)', letterSpacing: 1, fontVariantNumeric: 'tabular-nums' }}>{formatTime(currentSong.duration_seconds || 0)}</span>
              </div>
            </DarkHalo>
          )}

          {/* Transport: Play + Skip with dark halo */}
          {currentSong && (
            <DarkHalo style={{ display: 'flex', gap: 48, marginTop: 60 }}>
              <CircleButton onClick={togglePlayPause}>
                {isPlaying ? (
                  <svg width="36" height="36" viewBox="0 0 28 28">
                    <rect x="7" y="5" width="5" height="18" rx="1.5" fill="rgba(255,255,255,0.9)" />
                    <rect x="16" y="5" width="5" height="18" rx="1.5" fill="rgba(255,255,255,0.9)" />
                  </svg>
                ) : (
                  <svg width="36" height="36" viewBox="0 0 28 28">
                    <path d="M9 4l12 8-12 8z" fill="rgba(255,255,255,0.9)" />
                  </svg>
                )}
              </CircleButton>
              <CircleButton onClick={skip}>
                <svg width="34" height="34" viewBox="0 0 24 24">
                  <path d="M4.5 5l10 7-10 7zm12.5 0v14h2.5V5z" fill="rgba(255,255,255,0.9)" />
                </svg>
              </CircleButton>
            </DarkHalo>
          )}

          {/* Feedback: Report + Love with dark halo */}
          {currentSong && (
            <DarkHalo style={{ display: 'flex', gap: 56, marginTop: 48 }}>
              <FeedbackButton onClick={handleReportClick} pulse={reportPulse} pulseColor="240,153,123">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke={reportPulse ? 'rgba(240,153,123,0.9)' : 'rgba(240,153,123,0.6)'} strokeWidth="1.5" />
                  <line x1="12" y1="8" x2="12" y2="13" stroke={reportPulse ? 'rgba(240,153,123,0.9)' : 'rgba(240,153,123,0.6)'} strokeWidth="1.5" strokeLinecap="round" />
                  <circle cx="12" cy="16" r="0.8" fill={reportPulse ? 'rgba(240,153,123,0.9)' : 'rgba(240,153,123,0.6)'} />
                </svg>
              </FeedbackButton>
              <FeedbackButton onClick={handleLove} pulse={lovePulse} pulseColor="93,202,165">
                <svg width="36" height="36" viewBox="0 0 24 24">
                  {isLoved || lovePulse ? (
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
                      fill={lovePulse ? 'rgba(93,202,165,0.95)' : 'rgba(93,202,165,0.7)'} />
                  ) : (
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
                      fill="none" stroke="rgba(93,202,165,0.6)" strokeWidth="1.5" />
                  )}
                </svg>
              </FeedbackButton>
            </DarkHalo>
          )}
        </div>
      </div>

      {showFlag && <FlagModal onSelect={handleFlagDone} onClose={handleFlagClose} />}
      {showOutcome && <OutcomeModal activeMode={activeMode} onSelectMode={changeMode} onClose={() => setShowOutcome(false)} />}
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
        width: 104, height: 104, borderRadius: '50%',
        border: `2px solid ${hovered || pressed ? 'rgba(212,225,229,0.4)' : 'rgba(212,225,229,0.2)'}`,
        background: pressed ? 'rgba(212,225,229,0.14)' : hovered ? 'rgba(212,225,229,0.1)' : 'rgba(212,225,229,0.05)',
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

function FeedbackButton({ onClick, children, pulse, pulseColor }: { onClick: () => void; children: React.ReactNode; pulse: boolean; pulseColor: string }) {
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
        width: 72, height: 72, borderRadius: '50%',
        border: `1px solid ${pulse ? `rgba(${pulseColor},0.35)` : hovered ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)'}`,
        background: pulse ? `rgba(${pulseColor},0.12)` : hovered ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.15)',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'transform 0.15s, border-color 0.3s, background 0.3s',
        transform: pulse ? 'scale(1.15)' : pressed ? 'scale(0.88)' : 'scale(1)',
        outline: 'none',
      }}
    >
      {children}
    </button>
  );
}

function DarkHalo({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ position: 'relative', ...style }}>
      {/* Dark glow layer behind content */}
      <div style={{
        position: 'absolute',
        inset: -80,
        borderRadius: '50%',
        background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.6) 35%, rgba(0,0,0,0.2) 55%, transparent 75%)',
        pointerEvents: 'none',
        zIndex: -1,
      }} />
      {children}
    </div>
  );
}
