import { useState, useEffect } from 'react';

interface OutcomeModalProps {
  activeMode: string;
  onSelectMode: (mode: string) => void;
  onClose: () => void;
}

const modes = [
  { key: 'linger', label: 'Linger', sublabel: 'Stay longer, explore more' },
  { key: 'elevate', label: 'Elevate', sublabel: 'Spend more per item' },
  { key: 'energize', label: 'Energize', sublabel: 'More activity, more items' },
  { key: 'move', label: 'Move', sublabel: 'Increase turnover' },
];

export default function OutcomeModal({ activeMode, onSelectMode, onClose }: OutcomeModalProps) {
  const [queued, setQueued] = useState<string | null>(null);

  useEffect(() => {
    if (queued) {
      const timer = setTimeout(() => {
        onSelectMode(queued);
        onClose();
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [queued, onSelectMode, onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.88)',
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0a0d15',
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: 24, padding: 44,
          maxWidth: 540, width: '94%',
          boxShadow: '0 24px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04) inset',
        }}
      >
        <div style={{
          fontSize: 13, fontWeight: 500,
          color: 'rgba(255,255,255,0.75)',
          letterSpacing: 2.8, textTransform: 'uppercase',
          marginBottom: 32,
        }}>
          Outcome Mode
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {modes.map((m) => {
            const isActive = activeMode === m.key;
            const isQueued = queued === m.key;
            const highlighted = isActive || isQueued;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => {
                  if (isActive || queued) return;
                  setQueued(m.key);
                }}
                style={{
                  padding: '26px 22px',
                  border: `1.5px solid ${highlighted ? 'rgba(116,192,218,0.85)' : 'rgba(255,255,255,0.22)'}`,
                  borderRadius: 16,
                  background: isActive
                    ? 'rgba(116,192,218,0.22)'
                    : isQueued
                      ? 'rgba(116,192,218,0.15)'
                      : 'rgba(255,255,255,0.05)',
                  cursor: isActive || queued ? 'default' : 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.25s',
                  outline: 'none',
                  fontFamily: "'Inter', sans-serif",
                }}
              >
                <div style={{
                  fontSize: 19, fontWeight: 500, letterSpacing: 0.6,
                  color: highlighted ? 'rgba(190,230,245,1)' : 'rgba(255,255,255,0.98)',
                  marginBottom: 8,
                }}>
                  {m.label}
                </div>
                <div style={{
                  fontSize: 13, fontWeight: 400,
                  color: highlighted ? 'rgba(190,230,245,0.85)' : 'rgba(255,255,255,0.75)',
                  lineHeight: 1.5,
                }}>
                  {isQueued ? 'Queued' : m.sublabel}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
