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
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0c0f1a',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 20, padding: 32,
          maxWidth: 420, width: '90%',
        }}
      >
        <div style={{
          fontSize: 12, fontWeight: 300,
          color: 'rgba(255,255,255,0.35)',
          letterSpacing: 2, textTransform: 'uppercase',
          marginBottom: 24,
        }}>
          Outcome Mode
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {modes.map((m) => {
            const isActive = activeMode === m.key;
            const isQueued = queued === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => {
                  if (isActive || queued) return;
                  setQueued(m.key);
                }}
                style={{
                  padding: '20px 16px',
                  border: `1px solid ${isActive || isQueued ? 'rgba(74,144,164,0.4)' : 'rgba(255,255,255,0.06)'}`,
                  borderRadius: 14,
                  background: isActive ? 'rgba(74,144,164,0.12)' : isQueued ? 'rgba(74,144,164,0.08)' : 'rgba(255,255,255,0.02)',
                  cursor: isActive || queued ? 'default' : 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.25s',
                  outline: 'none',
                  fontFamily: "'Inter', sans-serif",
                }}
              >
                <div style={{
                  fontSize: 15, fontWeight: 300, letterSpacing: 1,
                  color: isActive || isQueued ? 'rgba(74,144,164,0.9)' : 'rgba(255,255,255,0.55)',
                  marginBottom: 6,
                }}>
                  {m.label}
                </div>
                <div style={{
                  fontSize: 11, fontWeight: 300,
                  color: isActive || isQueued ? 'rgba(74,144,164,0.5)' : 'rgba(255,255,255,0.2)',
                  lineHeight: 1.4,
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
