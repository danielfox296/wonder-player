export default function Visualization() {
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
      {/* Center glow */}
      <div style={{
        position: 'absolute', top: '48%', left: '50%',
        width: 400, height: 400, marginLeft: -200, marginTop: -200,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(74,144,164,0.04) 0%, transparent 65%)',
        animation: 'glow 8s ease-in-out infinite',
      }} />

      {/* Pulsing ellipses */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <ellipse cx="50%" cy="50%" rx="180" ry="60" fill="none" stroke="rgba(74,144,164,0.05)" strokeWidth="0.5" style={{ animation: 'p1 7s ease-in-out infinite' }} />
        <ellipse cx="50%" cy="50%" rx="250" ry="90" fill="none" stroke="rgba(127,119,221,0.035)" strokeWidth="0.5" style={{ animation: 'p2 9.5s ease-in-out infinite' }} />
        <ellipse cx="50%" cy="50%" rx="320" ry="120" fill="none" stroke="rgba(93,202,165,0.025)" strokeWidth="0.5" style={{ animation: 'p3 12s ease-in-out infinite' }} />
        <ellipse cx="50%" cy="50%" rx="390" ry="150" fill="none" stroke="rgba(74,144,164,0.015)" strokeWidth="0.5" style={{ animation: 'p4 16s ease-in-out infinite reverse' }} />
      </svg>

      {/* Orbital dots */}
      {/* Orbit 1: 520x190, 55s, teal dots */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        width: 520, height: 190, marginLeft: -260, marginTop: -95,
        animation: 'orbit 55s linear infinite',
      }}>
        <div style={{ position: 'absolute', top: 0, left: '50%', width: 4, height: 4, marginLeft: -2, borderRadius: '50%', background: 'rgba(74,144,164,0.35)', boxShadow: '0 0 6px rgba(74,144,164,0.2)' }} />
        <div style={{ position: 'absolute', bottom: 0, left: '50%', width: 2, height: 2, marginLeft: -1, borderRadius: '50%', background: 'rgba(74,144,164,0.25)' }} />
      </div>

      {/* Orbit 2: 420x155, 70s reverse, purple dots */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        width: 420, height: 155, marginLeft: -210, marginTop: -77,
        animation: 'orbitReverse 70s linear infinite',
      }}>
        <div style={{ position: 'absolute', top: 0, left: '25%', width: 3, height: 3, borderRadius: '50%', background: 'rgba(127,119,221,0.3)', boxShadow: '0 0 5px rgba(127,119,221,0.15)' }} />
        <div style={{ position: 'absolute', bottom: 0, right: '25%', width: 2, height: 2, borderRadius: '50%', background: 'rgba(127,119,221,0.2)' }} />
      </div>

      {/* Orbit 3: 600x220, 90s, green dots */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        width: 600, height: 220, marginLeft: -300, marginTop: -110,
        animation: 'orbit 90s linear infinite',
      }}>
        <div style={{ position: 'absolute', top: 0, right: '30%', width: 2.5, height: 2.5, borderRadius: '50%', background: 'rgba(93,202,165,0.3)', boxShadow: '0 0 4px rgba(93,202,165,0.15)' }} />
        <div style={{ position: 'absolute', bottom: 0, left: '30%', width: 1.5, height: 1.5, borderRadius: '50%', background: 'rgba(93,202,165,0.2)' }} />
      </div>

      {/* Wave paths */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <path d="M-100 320 C60 285,180 360,340 315 S520 265,680 310 S840 345,960 320" fill="none" stroke="rgba(74,144,164,0.08)" strokeWidth="1.2" style={{ animation: 'f1 14s ease-in-out infinite' }} />
        <path d="M-100 360 C80 330,200 390,360 350 S540 300,700 345 S860 375,960 360" fill="none" stroke="rgba(127,119,221,0.055)" strokeWidth="0.8" style={{ animation: 'f2 19s ease-in-out infinite' }} />
        <path d="M-100 400 C100 370,220 420,380 385 S560 340,720 380 S880 410,960 400" fill="none" stroke="rgba(93,202,165,0.045)" strokeWidth="0.7" style={{ animation: 'f3 24s ease-in-out infinite' }} />
        <path d="M-100 440 C70 415,190 460,350 425 S530 380,690 420 S850 450,960 440" fill="none" stroke="rgba(74,144,164,0.035)" strokeWidth="0.6" style={{ animation: 'f4 28s ease-in-out infinite' }} />
        <path d="M-100 480 C90 455,210 500,370 465 S550 420,710 460 S870 490,960 480" fill="none" stroke="rgba(127,119,221,0.025)" strokeWidth="0.5" style={{ animation: 'f5 34s ease-in-out infinite' }} />
        <path d="M-100 520 C60 495,180 540,340 505 S520 460,680 500 S840 530,960 520" fill="none" stroke="rgba(93,202,165,0.02)" strokeWidth="0.5" style={{ animation: 'f1 40s ease-in-out infinite reverse' }} />
      </svg>

      <style>{`
        @keyframes glow { 0%,100% { opacity: .03; } 50% { opacity: .08; } }
        @keyframes p1 { 0%,100% { opacity: .05; } 50% { opacity: .12; } }
        @keyframes p2 { 0%,100% { opacity: .03; } 50% { opacity: .08; } }
        @keyframes p3 { 0%,100% { opacity: .04; } 50% { opacity: .1; } }
        @keyframes p4 { 0%,100% { opacity: .02; } 50% { opacity: .06; } }
        @keyframes orbit { to { transform: rotate(360deg); } }
        @keyframes orbitReverse { to { transform: rotate(-360deg); } }
        @keyframes dp { 0%,100% { opacity: .3; } 50% { opacity: .85; } }
        @keyframes f1 { 0%,100% { transform: translateY(0) scaleX(1); } 25% { transform: translateY(-12px) scaleX(1.04); } 50% { transform: translateY(5px) scaleX(.96); } 75% { transform: translateY(-7px) scaleX(1.02); } }
        @keyframes f2 { 0%,100% { transform: translateY(0) scaleX(1); } 30% { transform: translateY(9px) scaleX(.95); } 60% { transform: translateY(-14px) scaleX(1.05); } 85% { transform: translateY(4px) scaleX(1); } }
        @keyframes f3 { 0%,100% { transform: translateY(0); } 40% { transform: translateY(-16px); } 70% { transform: translateY(7px); } }
        @keyframes f4 { 0%,100% { transform: translateX(0) translateY(0); } 35% { transform: translateX(12px) translateY(-10px); } 65% { transform: translateX(-10px) translateY(6px); } }
        @keyframes f5 { 0%,100% { transform: translateY(0) scaleX(1); } 20% { transform: translateY(6px) scaleX(1.02); } 55% { transform: translateY(-11px) scaleX(.97); } 80% { transform: translateY(3px) scaleX(1.01); } }
      `}</style>
    </div>
  );
}
