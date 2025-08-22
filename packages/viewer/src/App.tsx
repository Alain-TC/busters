import React, { useEffect, useRef, useState } from 'react';
import { TEAM0_BASE, TEAM1_BASE, RULES, BusterState } from '@busters/shared';

type FogMode = 'god' | 'team0' | 'team1';

const palette = {
  bg: '#0b0e12',
  panel: '#1a1f24',
  text: '#e5e7eb',
  grid: '#26303a',
  base: '#6b7280',
  ghostFill: '#ffffff',
  ghostStroke: '#a3a3a3',
  t0: '#22c1ff',
  t1: '#ff6a33',
  carry: '#fde047',
  stunned: '#94a3b8',
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [running, setRunning] = useState(true);
  const [scores, setScores] = useState({ 0: 0, 1: 0 });
  const [tick, setTick] = useState(0);
  const [mapSize, setMapSize] = useState({ w: 16001, h: 9001 });
  const [overlays, setOverlays] = useState({
    grid: true,
    vision: true,
    ranges: true,
    ids: true,
  });
  const [fog, setFog] = useState<FogMode>('god');
  const workerRef = useRef<Worker | null>(null);
  const lastFrameRef = useRef<any>(null);

  // helpers
  function fitCanvas(canvas: HTMLCanvasElement) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const W = Math.max(1, Math.floor(rect.width * dpr));
    const H = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    return { dpr, W, H };
  }

  // fog filter (client-side preview)
  function filterByFog(busters: any[], ghosts: any[], mode: FogMode) {
    if (mode === 'god') return { busters, ghosts };
    const teamId = mode === 'team0' ? 0 : 1;
    const my = busters.filter(b => b.teamId === teamId);
    const enemies = busters.filter(b => b.teamId !== teamId);
    const vis = (x: number, y: number) => my.some(m => {
      const dx = x - m.x, dy = y - m.y;
      return (dx * dx + dy * dy) <= RULES.VISION * RULES.VISION;
    });
    const ghostsV = ghosts.filter(g => vis(g.x, g.y));
    const enemiesV = enemies.filter(e => vis(e.x, e.y));
    return { busters: [...my, ...enemiesV], ghosts: ghostsV };
  }

  // draw one frame (idempotent; uses lastFrameRef)
  function draw() {
    const frame = lastFrameRef.current;
    if (!frame) return;
    const { width: worldW, height: worldH } = frame;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const { W: pxW, H: pxH } = fitCanvas(canvas);

    // background
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pxW, pxH);
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, pxW, pxH);

    // world scale
    const s = Math.max(0.0001, Math.min(pxW / worldW, pxH / worldH));
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const hair = 1 / Math.max(s, 1);

    // fog-filtered entities
    const { busters, ghosts } = filterByFog(frame.busters, frame.ghosts, fog);

    // grid
    if (overlays.grid) {
      ctx.strokeStyle = palette.grid;
      ctx.lineWidth = 1 * hair;
      for (let x = 0; x <= worldW; x += 1000) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, worldH); ctx.stroke();
      }
      for (let y = 0; y <= worldH; y += 1000) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(worldW, y); ctx.stroke();
      }
    }

    // bases
    ctx.lineWidth = 3 * hair;
    ctx.strokeStyle = palette.base;
    ctx.beginPath(); ctx.arc(TEAM0_BASE.x, TEAM0_BASE.y, 1600, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(TEAM1_BASE.x, TEAM1_BASE.y, 1600, 0, Math.PI * 2); ctx.stroke();

    // vision & ranges
    if (overlays.vision || overlays.ranges) {
      for (const b of busters) {
        if (overlays.vision) {
          ctx.strokeStyle = 'rgba(148,163,184,0.25)'; // slate-300 @25%
          ctx.lineWidth = 2 * hair;
          ctx.beginPath(); ctx.arc(b.x, b.y, RULES.VISION, 0, Math.PI * 2); ctx.stroke();
        }
        if (overlays.ranges) {
          // Bust min/max ring
          ctx.strokeStyle = 'rgba(255,255,255,0.20)';
          ctx.lineWidth = 2 * hair;
          ctx.beginPath(); ctx.arc(b.x, b.y, 900, 0, Math.PI * 2); ctx.stroke();
          ctx.beginPath(); ctx.arc(b.x, b.y, 1760, 0, Math.PI * 2); ctx.stroke();
          // Stun range ring
          ctx.strokeStyle = 'rgba(255,215,0,0.25)';
          ctx.beginPath(); ctx.arc(b.x, b.y, 1760, 0, Math.PI * 2); ctx.stroke();
        }
      }
    }

    // ghosts
    ctx.lineWidth = 2 * hair;
    for (const g of ghosts) {
      ctx.fillStyle = palette.ghostFill;
      ctx.strokeStyle = palette.ghostStroke;
      ctx.beginPath(); ctx.arc(g.x, g.y, 18, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (overlays.ids) {
        ctx.fillStyle = '#111827';
        ctx.font = `${14 / Math.max(s, 1)}px ui-sans-serif, system-ui`;
        ctx.fillText(`${g.id} (${g.endurance})`, g.x + 22, g.y + 4);
      }
    }

    // busters
    for (const b of busters) {
      ctx.fillStyle = b.teamId === 0 ? palette.t0 : palette.t1;
      ctx.beginPath(); ctx.arc(b.x, b.y, 22, 0, Math.PI * 2); ctx.fill();

      if (b.state === BusterState.Carrying) { // carrying
        ctx.strokeStyle = palette.carry;
        ctx.lineWidth = 3 * hair;
        ctx.strokeRect(b.x - 26, b.y - 26, 52, 52);
      }
      if (b.state === BusterState.Stunned) { // stunned
        ctx.strokeStyle = palette.stunned;
        ctx.lineWidth = 3 * hair;
        ctx.beginPath(); ctx.moveTo(b.x - 18, b.y - 18); ctx.lineTo(b.x + 18, b.y + 18); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(b.x + 18, b.y - 18); ctx.lineTo(b.x - 18, b.y + 18); ctx.stroke();
      }
      if (overlays.ids) {
        ctx.fillStyle = '#e5e7eb';
        ctx.font = `${14 / Math.max(s, 1)}px ui-sans-serif, system-ui`;
        const status =
          b.state === BusterState.Stunned ? `stun:${b.value}` :
          b.state === BusterState.Carrying ? `carry:${b.value}` : '';
        const cd = b.stunCd > 0 ? ` cd:${b.stunCd}` : '';
        ctx.fillText(`B${b.id}${status?` ${status}`:''}${cd}`, b.x + 24, b.y - 10);
      }
    }

    // HUD (screen space)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = palette.text;
    ctx.font = '14px ui-sans-serif, system-ui';
    const gLeft = (frame.ghosts?.length ?? 0);
    const fogStr = fog === 'god' ? 'God' : fog === 'team0' ? 'Team 0' : 'Team 1';
    ctx.fillText(
      `Tick ${frame.tick}  |  Score T0:${frame.scores?.[0] ?? 0}  T1:${frame.scores?.[1] ?? 0}  |  Ghosts left: ${gLeft}  |  Fog: ${fogStr}`,
      12, 22
    );

    // legend
    ctx.fillText('Legend: ● Team0  ● Team1  ○ Ghost  ◻ Carry  ✕ Stunned', 12, 42);
    // dots with colors
    ctx.fillStyle = palette.t0; ctx.beginPath(); ctx.arc(150, 36, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = palette.t1; ctx.beginPath(); ctx.arc(210, 36, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = palette.ghostFill; ctx.beginPath(); ctx.arc(270, 36, 6, 0, Math.PI * 2); ctx.fill();
  }

  useEffect(() => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;

    const onMsg = (e: MessageEvent) => {
      const { kind, payload } = e.data || {};
      if (kind !== 'frame' || !payload) return;
      lastFrameRef.current = payload;
      setTick(payload.tick || 0);
      setMapSize({ w: payload.width, h: payload.height });
      setScores(payload.scores || { 0: 0, 1: 0 });
      draw();
    };

    w.addEventListener('message', onMsg);
    const onResize = () => draw();
    window.addEventListener('resize', onResize);

    return () => { w.terminate(); window.removeEventListener('resize', onResize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fog, overlays]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', height: '100vh', background: palette.bg }}>
      <div style={{ overflow: 'hidden' }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>
      <div style={{ padding: 12, color: palette.text, background: palette.panel, fontFamily: 'system-ui, ui-sans-serif' }}>
        <h2 style={{ marginTop: 0 }}>Busters</h2>
        <p style={{ margin: '6px 0' }}>
          Tick: <b>{tick}</b><br />
          Score — T0: <b>{scores[0]}</b> · T1: <b>{scores[1]}</b><br />
          Map: {mapSize.w}×{mapSize.h}
        </p>

        <fieldset style={{ border: '1px solid #2a3340', padding: 8, borderRadius: 8, marginBottom: 10 }}>
          <legend>Fog</legend>
          <label><input type="radio" name="fog" checked={fog==='god'} onChange={()=>setFog('god')} /> God</label><br/>
          <label><input type="radio" name="fog" checked={fog==='team0'} onChange={()=>setFog('team0')} /> Team 0 view</label><br/>
          <label><input type="radio" name="fog" checked={fog==='team1'} onChange={()=>setFog('team1')} /> Team 1 view</label>
        </fieldset>

        <fieldset style={{ border: '1px solid #2a3340', padding: 8, borderRadius: 8, marginBottom: 10 }}>
          <legend>Overlays</legend>
          <label><input type="checkbox" checked={overlays.grid} onChange={e=>setOverlays(o=>({...o, grid:e.target.checked}))}/> Grid (1000u)</label><br/>
          <label><input type="checkbox" checked={overlays.vision} onChange={e=>setOverlays(o=>({...o, vision:e.target.checked}))}/> Vision 2200</label><br/>
          <label><input type="checkbox" checked={overlays.ranges} onChange={e=>setOverlays(o=>({...o, ranges:e.target.checked}))}/> Bust/Stun ranges</label><br/>
          <label><input type="checkbox" checked={overlays.ids} onChange={e=>setOverlays(o=>({...o, ids:e.target.checked}))}/> IDs & timers</label>
        </fieldset>

        <button
          onClick={() => {
            const next = !running;
            setRunning(next);
            workerRef.current?.postMessage({ kind: 'toggle', run: next });
          }}
        >
          {running ? 'Pause' : 'Resume'}
        </button>{' '}
        <button onClick={() => { workerRef.current?.postMessage({ kind: 'reset' }); setRunning(true); }}>
          Reset
        </button>

        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.85 }}>
          Tips: Toggle Fog to check what each team can see; enable “Ranges” to validate the 900–1760 BUST and 1760 STUN rings.
        </div>
      </div>
    </div>
  );
}

