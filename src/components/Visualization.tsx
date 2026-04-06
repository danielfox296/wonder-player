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

const GRID = 240;
const BG_GRID = 160; // coarser grid for background layer (perf)

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
  const songIdRef = useRef<string | null>(null);
  const currentComboRef = useRef(0);
  const targetComboRef = useRef(0);
  const fadeRef = useRef(1); // 0 = old combo, 1 = target combo

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const field = new Float32Array(GRID * GRID);
    const bgField = new Float32Array(BG_GRID * BG_GRID);
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
      for (let i = 0; i < segs.length; i += 2) {
        const a = project(offX + segs[i].x * cellW, offY + segs[i].y * cellH, cx, cy, cosX, sinX, cosY, sinY, cosZ, sinZ, scale, persp);
        const b = project(offX + segs[i + 1].x * cellW, offY + segs[i + 1].y * cellH, cx, cy, cosX, sinX, cosY, sinY, cosZ, sinZ, scale, persp);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    };

    const draw = () => {
      time += 0.016;

      connectAnalyser(getActiveElement());
      const rawAmp = getAmplitude();
      smoothAmp += (rawAmp - smoothAmp) * 0.06;

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

      // --- Mode complexity: dramatic amplitude response ---
      const timeModeBase = (Math.sin(time * 0.018) * 0.5 + 0.5) * 8;
      const ampBoost = smoothAmp * (MODES.length - 1) * 0.85;
      const modeProgress = Math.min(timeModeBase + ampBoost, MODES.length - 1.01);
      const modeIdx = Math.min(Math.floor(modeProgress), MODES.length - 2);
      const modeFrac = modeProgress - modeIdx;

      const [n1, m1] = MODES[modeIdx];
      const [n2, m2] = MODES[modeIdx + 1];

      const mix = 0.35 + Math.sin(time * 0.07) * 0.15;
      const timeDrift = Math.sin(time * 0.12) * 0.015;

      // --- 3D rotation (in-canvas projection) — fast, all directions ---
      const radX = Math.sin(time * 0.15) * 0.7 + Math.sin(time * 0.067) * 0.3;
      const radY = Math.sin(time * 0.12) * 0.65 + Math.cos(time * 0.053) * 0.25;
      const radZ = Math.sin(time * 0.09) * 0.3 + Math.sin(time * 0.041) * 0.15;
      const cosX = Math.cos(radX), sinX = Math.sin(radX);
      const cosY = Math.cos(radY), sinY = Math.sin(radY);
      const cosZ = Math.cos(radZ), sinZ = Math.sin(radZ);

      // --- Dramatic zoom ---
      const zoomBase = 1.5 + Math.sin(time * 0.019) * 0.15;
      const zoomAmp = 1.0 + smoothAmp * 0.25;
      const scale = zoomBase * zoomAmp;
      const persp = 800;

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

          if (dist > 0.85) {
            const edge = (dist - 0.85) / 0.15;
            val *= (1 - edge * edge);
          }
          field[j * GRID + i] = val;
        }
      }

      // --- Clear with shifting bg ---
      ctx.fillStyle = `rgb(${Math.round(bgColor[0])},${Math.round(bgColor[1])},${Math.round(bgColor[2])})`;
      ctx.fillRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2;

      // ============================================================
      // BACKGROUND LAYER — 3x larger, 50% dimmer, different rotation
      // ============================================================
      {
        // Different mode — slower drift, offset pattern
        const bgModeBase = (Math.sin(time * 0.011 + 2.0) * 0.5 + 0.5) * 6;
        const bgModeProgress = Math.min(bgModeBase + smoothAmp * (MODES.length - 1) * 0.4, MODES.length - 1.01);
        const bgModeIdx = Math.min(Math.floor(bgModeProgress), MODES.length - 2);
        const bgModeFrac = bgModeProgress - bgModeIdx;
        const [bgN1, bgM1] = MODES[bgModeIdx];
        const [bgN2, bgM2] = MODES[bgModeIdx + 1];
        const bgMix = 0.45 + Math.sin(time * 0.04) * 0.2;
        const bgTimeDrift = Math.sin(time * 0.08) * 0.01;

        // Compute background field
        for (let j = 0; j < BG_GRID; j++) {
          for (let i = 0; i < BG_GRID; i++) {
            const x = (i / (BG_GRID - 1)) * 2 - 1;
            const y = (j / (BG_GRID - 1)) * 2 - 1;
            const dist = Math.sqrt(x * x + y * y);
            if (dist > 1.0) { bgField[j * BG_GRID + i] = 999; continue; }
            let val = chladniBlend(x, y, bgN1 + bgTimeDrift, bgM1, bgN2 + bgTimeDrift, bgM2, bgModeFrac, bgMix);
            if (dist > 0.85) { const edge = (dist - 0.85) / 0.15; val *= (1 - edge * edge); }
            bgField[j * BG_GRID + i] = val;
          }
        }

        // Independent rotation — slower, different phase, wandering
        const bgRadX = Math.sin(time * 0.037) * 0.5 + Math.cos(time * 0.019) * 0.35;
        const bgRadY = Math.cos(time * 0.029) * 0.45 + Math.sin(time * 0.013) * 0.3;
        const bgRadZ = Math.sin(time * 0.023) * 0.2 + Math.cos(time * 0.011) * 0.15;
        const bgCosX = Math.cos(bgRadX), bgSinX = Math.sin(bgRadX);
        const bgCosY = Math.cos(bgRadY), bgSinY = Math.sin(bgRadY);
        const bgCosZ = Math.cos(bgRadZ), bgSinZ = Math.sin(bgRadZ);

        // 3x the foreground plate size
        const bgPlateSize = Math.min(W, H) * 1.25 * 3;
        const bgOffX = (W - bgPlateSize) / 2;
        const bgOffY = (H - bgPlateSize) / 2;
        const bgCellW = bgPlateSize / (BG_GRID - 1);
        const bgCellH = bgPlateSize / (BG_GRID - 1);
        const bgScale = scale * 0.9; // slightly less zoom than foreground
        const bgPersp = 1200; // deeper perspective for more subtle distortion

        const bgAlpha = (0.5 + smoothAmp * 0.4) * 0.5; // 50% of foreground intensity

        const bgSegs0 = marchingSquares(bgField, BG_GRID, BG_GRID, 0);
        drawSegments3D(bgSegs0, primary, 0.35 * bgAlpha, 0.8, bgOffX, bgOffY, bgCellW, bgCellH, cx, cy, bgCosX, bgSinX, bgCosY, bgSinY, bgCosZ, bgSinZ, bgScale, bgPersp);

        const bgSegs1 = marchingSquares(bgField, BG_GRID, BG_GRID, 0.12);
        drawSegments3D(bgSegs1, secondary, 0.12 * bgAlpha, 0.4, bgOffX, bgOffY, bgCellW, bgCellH, cx, cy, bgCosX, bgSinX, bgCosY, bgSinY, bgCosZ, bgSinZ, bgScale, bgPersp);
        const bgSegs2 = marchingSquares(bgField, BG_GRID, BG_GRID, -0.12);
        drawSegments3D(bgSegs2, secondary, 0.12 * bgAlpha, 0.4, bgOffX, bgOffY, bgCellW, bgCellH, cx, cy, bgCosX, bgSinX, bgCosY, bgSinY, bgCosZ, bgSinZ, bgScale, bgPersp);
      }

      // ============================================================
      // FOREGROUND LAYER — original
      // ============================================================
      const plateSize = Math.min(W, H) * 1.25;
      const offX = (W - plateSize) / 2;
      const offY = (H - plateSize) / 2;
      const cellW = plateSize / (GRID - 1);
      const cellH = plateSize / (GRID - 1);

      const ampAlpha = 0.5 + smoothAmp * 0.4;

      // Primary nodal lines
      const segs0 = marchingSquares(field, GRID, GRID, 0);
      drawSegments3D(segs0, primary, 0.35 * ampAlpha, 1.0, offX, offY, cellW, cellH, cx, cy, cosX, sinX, cosY, sinY, cosZ, sinZ, scale, persp);

      // Secondary
      const segs1 = marchingSquares(field, GRID, GRID, 0.12);
      drawSegments3D(segs1, secondary, 0.12 * ampAlpha, 0.5, offX, offY, cellW, cellH, cx, cy, cosX, sinX, cosY, sinY, cosZ, sinZ, scale, persp);
      const segs2 = marchingSquares(field, GRID, GRID, -0.12);
      drawSegments3D(segs2, secondary, 0.12 * ampAlpha, 0.5, offX, offY, cellW, cellH, cx, cy, cosX, sinX, cosY, sinY, cosZ, sinZ, scale, persp);

      // Faint tertiary
      const segs3 = marchingSquares(field, GRID, GRID, 0.3);
      drawSegments3D(segs3, secondary, 0.04 * ampAlpha, 0.3, offX, offY, cellW, cellH, cx, cy, cosX, sinX, cosY, sinY, cosZ, sinZ, scale, persp);
      const segs4 = marchingSquares(field, GRID, GRID, -0.3);
      drawSegments3D(segs4, secondary, 0.04 * ampAlpha, 0.3, offX, offY, cellW, cellH, cx, cy, cosX, sinX, cosY, sinY, cosZ, sinZ, scale, persp);

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
    </>
  );
}
