import { useRef, useEffect } from 'react';

interface VisualizationProps {
  getAmplitude: () => number;
  connectAnalyser: (el: HTMLAudioElement | null) => void;
  getActiveElement: () => HTMLAudioElement | null;
  songId: string | null;
}

// --- Chladni function ---
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

const GRID = 200;
const MAX_MODE = 20; // cap mode index to avoid overly dense high-frequency patterns

// Color combinations: [line primary, line secondary, background]
const COLOR_COMBOS: [number[], number[], number[]][] = [
  [[212, 225, 229], [170, 200, 225], [18, 18, 32]],   // ice / steel / midnight navy
  [[190, 220, 205], [160, 200, 195], [14, 22, 26]],   // sage / sea glass / abyss
  [[200, 195, 220], [175, 170, 210], [22, 18, 28]],   // lavender / violet / plum black
  [[220, 210, 195], [200, 185, 170], [24, 20, 18]],   // warm sand / clay / warm black
  [[180, 210, 230], [155, 190, 215], [12, 18, 28]],   // sky / cerulean / deep ocean
  [[195, 225, 210], [170, 210, 190], [16, 24, 22]],   // mint / eucalyptus / forest black
  [[215, 200, 220], [190, 180, 210], [20, 16, 26]],   // thistle / heather / indigo black
  [[225, 215, 200], [210, 195, 180], [22, 18, 16]],   // linen / driftwood / espresso
];

function lerpColor3(a: number[], b: number[], t: number): number[] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

// Simple hash to pick a combo index from song ID
function hashStr(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export default function Visualization({ getAmplitude, connectAnalyser, getActiveElement, songId }: VisualizationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const gradRef = useRef<HTMLDivElement>(null);
  const songIdRef = useRef<string | null>(null);
  const currentComboRef = useRef(0);
  const targetComboRef = useRef(0);
  const fadeRef = useRef(1); // 0 = old combo, 1 = target combo

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

    // 3D projection: rotate point around center, then perspective divide
    const project = (
      px: number, py: number, cx: number, cy: number,
      cosX: number, sinX: number, cosY: number, sinY: number,
      cosZ: number, sinZ: number, scale: number, persp: number,
    ): { x: number; y: number } => {
      let x = (px - cx) * scale;
      let y = (py - cy) * scale;
      const z = 0;

      // Rotate Z
      const xz = x * cosZ - y * sinZ;
      const yz = x * sinZ + y * cosZ;

      // Rotate X
      const yx = yz * cosX - z * sinX;
      const zx = yz * sinX + z * cosX;

      // Rotate Y
      const xy = xz * cosY + zx * sinY;
      const zy = -xz * sinY + zx * cosY;

      // Perspective
      const d = persp / (persp + zy);
      return { x: cx + xy * d, y: cy + yx * d };
    };

    const drawSegments3D = (
      segs: Pt[], colorStr: string, alpha: number, lineWidth: number,
      offX: number, offY: number, cellW: number, cellH: number,
      cx: number, cy: number,
      cosX: number, sinX: number, cosY: number, sinY: number,
      cosZ: number, sinZ: number, scale: number, persp: number,
    ) => {
      if (segs.length < 2) return;
      ctx.strokeStyle = colorStr + alpha + ')';
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.beginPath();
      const minLen = 1.5; // skip segments shorter than this (pixel space) — reduces noise
      for (let i = 0; i < segs.length; i += 2) {
        const a = project(offX + segs[i].x * cellW, offY + segs[i].y * cellH, cx, cy, cosX, sinX, cosY, sinY, cosZ, sinZ, scale, persp);
        const b = project(offX + segs[i + 1].x * cellW, offY + segs[i + 1].y * cellH, cx, cy, cosX, sinX, cosY, sinY, cosZ, sinZ, scale, persp);
        // Filter out tiny projected segments that appear as noise dots
        const dx = b.x - a.x, dy = b.y - a.y;
        if (dx * dx + dy * dy < minLen * minLen) continue;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    };

    const draw = () => {
      time += 0.016;

      connectAnalyser(getActiveElement());
      const rawAmp = getAmplitude();
      // Slower smoothing to prevent rapid mode jumping that causes glitchy lines
      const ampRate = rawAmp > smoothAmp ? 0.04 : 0.02;
      smoothAmp += (rawAmp - smoothAmp) * ampRate;

      // --- Song-change color fade ---
      // Fade toward target combo (~3s transition)
      if (fadeRef.current < 1) {
        fadeRef.current = Math.min(1, fadeRef.current + 0.005);
      }
      const fade = fadeRef.current;
      const oldCombo = COLOR_COMBOS[currentComboRef.current];
      const newCombo = COLOR_COMBOS[targetComboRef.current];
      const lineColor = lerpColor3(oldCombo[0], newCombo[0], fade);
      const dimColor = lerpColor3(oldCombo[1], newCombo[1], fade);
      const bgColor = lerpColor3(oldCombo[2], newCombo[2], fade);

      // Once fade is done, update current to target
      if (fade >= 1) {
        currentComboRef.current = targetComboRef.current;
      }

      const primary = `rgba(${Math.round(lineColor[0])},${Math.round(lineColor[1])},${Math.round(lineColor[2])},`;
      const secondary = `rgba(${Math.round(dimColor[0])},${Math.round(dimColor[1])},${Math.round(dimColor[2])},`;

      // Update background div to match
      if (bgRef.current) {
        bgRef.current.style.backgroundColor = `rgb(${Math.round(bgColor[0])},${Math.round(bgColor[1])},${Math.round(bgColor[2])})`;
      }

      // --- Mode complexity: amplitude + drift ---
      const modeBase = (Math.sin(time * 0.011 + 2.0) * 0.5 + 0.5) * 8;
      const modeProgress = Math.min(modeBase + smoothAmp * MAX_MODE * 0.85, MAX_MODE - 0.01);
      const modeIdx = Math.min(Math.floor(modeProgress), MAX_MODE - 1);
      const modeFrac = modeProgress - modeIdx;
      const [n1, m1] = MODES[modeIdx];
      const [n2, m2] = MODES[Math.min(modeIdx + 1, MODES.length - 1)];
      const mix = 0.45 + Math.sin(time * 0.04) * 0.2;

      // --- Compute field ---
      for (let j = 0; j < GRID; j++) {
        for (let i = 0; i < GRID; i++) {
          const x = (i / (GRID - 1)) * 2 - 1;
          const y = (j / (GRID - 1)) * 2 - 1;
          const dist = Math.sqrt(x * x + y * y);
          if (dist > 1.0) { field[j * GRID + i] = 999; continue; }
          let val = chladniBlend(x, y, n1, m1, n2, m2, modeFrac, mix);
          // Smooth edge falloff — start earlier, wider transition
          if (dist > 0.75) { const edge = (dist - 0.75) / 0.25; val *= (1 - edge * edge); }
          field[j * GRID + i] = val;
        }
      }

      // --- 3D rotation — wandering, organic ---
      const radX = Math.sin(time * 0.037) * 0.5 + Math.cos(time * 0.019) * 0.35;
      const radY = Math.cos(time * 0.029) * 0.45 + Math.sin(time * 0.013) * 0.3;
      const radZ = Math.sin(time * 0.023) * 0.2 + Math.cos(time * 0.011) * 0.15;
      const cosX = Math.cos(radX), sinX = Math.sin(radX);
      const cosY = Math.cos(radY), sinY = Math.sin(radY);
      const cosZ = Math.cos(radZ), sinZ = Math.sin(radZ);

      // --- Zoom ---
      const zoomBase = 1.5 + Math.sin(time * 0.019) * 0.15;
      const zoomAmp = 1.0 + smoothAmp * 0.25;
      const scale = zoomBase * zoomAmp;
      const persp = 1200;

      // --- Clear with shifting bg ---
      ctx.fillStyle = `rgb(${Math.round(bgColor[0])},${Math.round(bgColor[1])},${Math.round(bgColor[2])})`;
      ctx.fillRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2;

      // --- Draw cymatics (large plate, 3x viewport) ---
      const plateSize = Math.min(W, H) * 3.75;
      const offX = (W - plateSize) / 2;
      const offY = (H - plateSize) / 2;
      const cellW = plateSize / (GRID - 1);
      const cellH = plateSize / (GRID - 1);

      const ampAlpha = 0.5 + smoothAmp * 0.4;
      const brightness = 0.75; // 50% brighter than the old 0.5

      // Primary nodal lines only (no secondary/tertiary — they cause glitchy artifacts)
      const segs0 = marchingSquares(field, GRID, GRID, 0);
      drawSegments3D(segs0, primary, 0.35 * ampAlpha * brightness, 0.8, offX, offY, cellW, cellH, cx, cy, cosX, sinX, cosY, sinY, cosZ, sinZ, scale, persp);

      // --- Rotating gradient overlay ---
      // Subtle hue-shifting gradient that rotates over the whole scene
      const gradAngle = time * 12; // ~30s full rotation
      const gradR = Math.max(W, H) * 0.9;
      // Use the song's line color shifted slightly for the gradient tints
      const tintA = `rgba(${Math.round(lineColor[0])},${Math.round(lineColor[1])},${Math.round(lineColor[2])},0.4)`;
      const tintB = `rgba(${Math.round(dimColor[0])},${Math.round(dimColor[1])},${Math.round(dimColor[2])},0.3)`;

      if (gradRef.current) {
        gradRef.current.style.background = `
          conic-gradient(
            from ${gradAngle}deg at 50% 50%,
            ${tintA} 0deg,
            transparent 90deg,
            ${tintB} 180deg,
            transparent 270deg,
            ${tintA} 360deg
          )
        `;
      }

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, [getAmplitude, connectAnalyser, getActiveElement]);

  // Trigger color fade when songId changes
  useEffect(() => {
    if (songId && songId !== songIdRef.current) {
      songIdRef.current = songId;
      const newIdx = hashStr(songId) % COLOR_COMBOS.length;
      if (newIdx !== targetComboRef.current) {
        currentComboRef.current = targetComboRef.current;
        targetComboRef.current = newIdx;
        fadeRef.current = 0; // start fade
      }
    }
  }, [songId]);

  return (
    <>
      {/* Background div matches canvas bg — no black gaps */}
      <div
        ref={bgRef}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: -1,
          backgroundColor: 'rgb(18,18,32)',
        }}
      />
      <div
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
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
      {/* Rotating gradient overlay — subtle hue tint */}
      <div
        ref={gradRef}
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
          mixBlendMode: 'overlay',
        }}
      />
    </>
  );
}
