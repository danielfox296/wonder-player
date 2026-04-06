import { useRef, useEffect } from 'react';

interface VisualizationProps {
  getAmplitude: () => number;
  connectAnalyser: (el: HTMLAudioElement | null) => void;
  getActiveElement: () => HTMLAudioElement | null;
}

// --- Chladni function ---
// f(x,y) = sin(n*pi*x)*sin(m*pi*y) +/- sin(m*pi*x)*sin(n*pi*y)
function chladni(x: number, y: number, n: number, m: number, mix: number): number {
  const PI = Math.PI;
  const a = Math.sin(n * PI * x) * Math.sin(m * PI * y);
  const b = Math.sin(m * PI * x) * Math.sin(n * PI * y);
  return a * mix + b * (1 - mix);
}

function chladniBlend(
  x: number, y: number,
  n1: number, m1: number,
  n2: number, m2: number,
  blend: number, mix: number,
): number {
  const v1 = chladni(x, y, n1, m1, mix);
  const v2 = chladni(x, y, n2, m2, mix);
  return v1 * (1 - blend) + v2 * blend;
}

// --- Marching squares ---
interface Pt { x: number; y: number }

function marchingSquares(field: Float32Array, cols: number, rows: number, threshold: number): Pt[] {
  const segments: Pt[] = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const tl = field[j * cols + i];
      const tr = field[j * cols + i + 1];
      const br = field[(j + 1) * cols + i + 1];
      const bl = field[(j + 1) * cols + i];

      let idx = 0;
      if (tl > threshold) idx |= 8;
      if (tr > threshold) idx |= 4;
      if (br > threshold) idx |= 2;
      if (bl > threshold) idx |= 1;
      if (idx === 0 || idx === 15) continue;

      const lerp = (v1: number, v2: number) => {
        if (Math.abs(v2 - v1) < 0.0001) return 0.5;
        return (threshold - v1) / (v2 - v1);
      };

      const top: Pt = { x: i + lerp(tl, tr), y: j };
      const right: Pt = { x: i + 1, y: j + lerp(tr, br) };
      const bottom: Pt = { x: i + lerp(bl, br), y: j + 1 };
      const left: Pt = { x: i, y: j + lerp(tl, bl) };

      switch (idx) {
        case 1: case 14: segments.push(left, bottom); break;
        case 2: case 13: segments.push(bottom, right); break;
        case 3: case 12: segments.push(left, right); break;
        case 4: case 11: segments.push(top, right); break;
        case 5: segments.push(top, left); segments.push(bottom, right); break;
        case 6: case 9: segments.push(top, bottom); break;
        case 7: case 8: segments.push(top, left); break;
        case 10: segments.push(top, right); segments.push(bottom, left); break;
      }
    }
  }
  return segments;
}

// Mode pairs — low complexity to high
const MODES: [number, number][] = [
  [1, 1], [1, 2], [2, 2], [2, 3], [3, 3], [3, 4],
  [4, 4], [4, 5], [5, 5], [5, 6], [6, 6], [6, 7],
  [7, 7], [7, 8], [8, 8], [8, 9], [9, 9], [9, 10],
  [10, 10], [10, 12], [12, 12], [12, 14], [14, 14],
  [14, 16], [16, 16], [16, 18], [18, 20], [20, 22],
  [22, 25], [25, 28],
];

const GRID = 240;
const ICE = 'rgba(212,225,229,';
const ICE_DIM = 'rgba(180,200,210,';

export default function Visualization({ getAmplitude, connectAnalyser, getActiveElement }: VisualizationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const field = new Float32Array(GRID * GRID);
    let time = 0;
    let smoothAmp = 0;
    let rafId: number;

    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    let W: number, H: number;

    const resize = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W * DPR;
      canvas.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const drawSegments = (
      segs: Pt[], colorStr: string, alpha: number, lineWidth: number,
      offX: number, offY: number, cellW: number, cellH: number,
    ) => {
      if (segs.length < 2) return;
      ctx.strokeStyle = colorStr + alpha + ')';
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < segs.length; i += 2) {
        const a = segs[i], b = segs[i + 1];
        ctx.moveTo(offX + a.x * cellW, offY + a.y * cellH);
        ctx.lineTo(offX + b.x * cellW, offY + b.y * cellH);
      }
      ctx.stroke();
    };

    const draw = () => {
      time += 0.016;

      // Try to keep analyser connected to the active element
      connectAnalyser(getActiveElement());
      const rawAmp = getAmplitude();
      // Extra smoothing for the mode progression
      smoothAmp += (rawAmp - smoothAmp) * 0.04;

      // --- Mode complexity: amplitude + slow time drift ---
      // Base drift so pattern always moves, amplitude pushes it further
      const timeModeBase = (Math.sin(time * 0.018) * 0.5 + 0.5) * 6; // slowly crawl through first 6 modes
      const ampBoost = smoothAmp * (MODES.length - 1) * 0.5;
      const modeProgress = Math.min(timeModeBase + ampBoost, MODES.length - 1.01);
      const modeIdx = Math.min(Math.floor(modeProgress), MODES.length - 2);
      const modeFrac = modeProgress - modeIdx;

      const [n1, m1] = MODES[modeIdx];
      const [n2, m2] = MODES[modeIdx + 1];

      // Mix parameter — slow drift so patterns breathe
      const mix = 0.35 + Math.sin(time * 0.07) * 0.15;

      // Slight time-based drift for life
      const timeDrift = Math.sin(time * 0.12) * 0.015;

      // --- 3D orientation: slow independent rotations on prime-ish periods ---
      const rotX = Math.sin(time * 0.0139) * 8;   // ~45s period, +-8deg
      const rotY = Math.sin(time * 0.0094) * 6;   // ~67s period, +-6deg
      const rotZ = Math.sin(time * 0.0071) * 3;   // ~89s period, +-3deg

      // --- Zoom: slow breathing + gentle amplitude coupling ---
      const zoomBase = 1.0 + Math.sin(time * 0.025) * 0.03;  // 0.97–1.03 slow breathe
      const zoomAmp = 1.0 + smoothAmp * 0.06;                 // up to +6% on loud
      const zoom = zoomBase * zoomAmp;

      // Apply 3D transform to wrapper
      if (wrapRef.current) {
        wrapRef.current.style.transform =
          `perspective(1200px) rotateX(${rotX}deg) rotateY(${rotY}deg) rotateZ(${rotZ}deg) scale(${zoom})`;
      }

      // --- Compute field ---
      for (let j = 0; j < GRID; j++) {
        for (let i = 0; i < GRID; i++) {
          const x = (i / (GRID - 1)) * 2 - 1;
          const y = (j / (GRID - 1)) * 2 - 1;
          const dist = Math.sqrt(x * x + y * y);

          if (dist > 1.0) {
            field[j * GRID + i] = 999;
            continue;
          }

          let val = chladniBlend(x, y, n1 + timeDrift, m1, n2 + timeDrift, m2, modeFrac, mix);

          // Soft edge falloff
          if (dist > 0.85) {
            const edge = (dist - 0.85) / 0.15;
            val *= (1 - edge * edge);
          }
          field[j * GRID + i] = val;
        }
      }

      // --- Clear ---
      ctx.clearRect(0, 0, W, H);

      // --- Draw ---
      const plateSize = Math.min(W, H) * 1.25;
      const offX = (W - plateSize) / 2;
      const offY = (H - plateSize) / 2;
      const cellW = plateSize / (GRID - 1);
      const cellH = plateSize / (GRID - 1);

      // Subtle plate boundary
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, plateSize * 0.47, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(212,225,229,0.04)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Alpha scales gently with amplitude — louder = slightly brighter lines
      const ampAlpha = 0.5 + smoothAmp * 0.4;

      // Primary nodal lines (ice)
      const segs0 = marchingSquares(field, GRID, GRID, 0);
      drawSegments(segs0, ICE, 0.35 * ampAlpha, 1.0, offX, offY, cellW, cellH);

      // Secondary contour lines (dimmer ice)
      const segs1 = marchingSquares(field, GRID, GRID, 0.12);
      drawSegments(segs1, ICE_DIM, 0.12 * ampAlpha, 0.5, offX, offY, cellW, cellH);
      const segs2 = marchingSquares(field, GRID, GRID, -0.12);
      drawSegments(segs2, ICE_DIM, 0.12 * ampAlpha, 0.5, offX, offY, cellW, cellH);

      // Faint tertiary
      const segs3 = marchingSquares(field, GRID, GRID, 0.3);
      drawSegments(segs3, ICE_DIM, 0.04 * ampAlpha, 0.3, offX, offY, cellW, cellH);
      const segs4 = marchingSquares(field, GRID, GRID, -0.3);
      drawSegments(segs4, ICE_DIM, 0.04 * ampAlpha, 0.3, offX, offY, cellW, cellH);

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, [getAmplitude, connectAnalyser, getActiveElement]);

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
        willChange: 'transform',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
        }}
      />
    </div>
  );
}
