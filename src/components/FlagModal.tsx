interface FlagModalProps {
  onSelect: (reason: string) => void;
  onClose: () => void;
}

const reasons = [
  { label: 'Awkward Lyrics', code: 'awkward_lyrics' },
  { label: 'Sound Glitches', code: 'sound_glitches' },
  { label: "Doesn't Fit Brand", code: 'off_brand' },
  { label: 'Too Intense', code: 'too_intense' },
  { label: 'Too Boring', code: 'too_boring' },
  { label: 'Corny / Cliché', code: 'corny' },
];

export default function FlagModal({ onSelect, onClose }: FlagModalProps) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0c0f1a',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16, padding: 32,
          maxWidth: 360, width: '90%',
          position: 'relative',
        }}
      >
        {/* Close X */}
        <button
          type="button"
          onClick={onClose}
          style={{
            position: 'absolute', top: 16, right: 16,
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,0.25)', fontSize: 18,
            width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
            outline: 'none',
          }}
        >
          ✕
        </button>

        {/* Header */}
        <div style={{
          fontSize: 16, fontWeight: 300,
          color: 'rgba(255,255,255,0.5)',
          letterSpacing: 1, marginBottom: 24,
        }}>
          What's wrong with this song?
        </div>

        {/* Reason buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {reasons.map((r) => (
            <button
              key={r.code}
              type="button"
              onClick={() => onSelect(r.code)}
              style={{
                width: '100%', padding: 16,
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 12, background: 'rgba(255,255,255,0.03)',
                color: 'rgba(255,255,255,0.4)',
                fontFamily: "'Inter', sans-serif",
                fontSize: 14, fontWeight: 300, letterSpacing: 0.5,
                cursor: 'pointer', textAlign: 'left',
                transition: 'background 0.2s, border-color 0.2s',
                outline: 'none',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
                e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
                e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
