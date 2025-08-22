/* CodinGame adapter for Busters -> wraps @busters/agents/hybrid act(ctx, obs)
   Assumptions (standard Busters):
   - First line: bustersPerPlayer ghostCount myTeamId
   - Each turn: entityCount, then {id x y type state value} per entity
   - type: -1=GHOST, 0/1=team ids
   - Our act() expects: { self, ghostsVisible[], enemies[], tick } and ctx with bases.
   - We track radarUsed locally (CG doesn’t give it).
*/

declare function readline(): string;
declare function print(s: string): void;

import { createBot } from "./hybrid-bot";
const { act } = createBot();

type Pt = { x: number; y: number };

const W = 16000, H = 9000;
let tick = 0;

// Track which of our busters already used RADAR (simple local memory)
const radarUsed = new Set<number>();

const bustersPerPlayer = parseInt(readline(), 10);
const ghostCount = parseInt(readline(), 10); // value may remain unused
const myTeamId = parseInt(readline(), 10);

const myBase: Pt = myTeamId === 0 ? { x: 0, y: 0 } : { x: W, y: H };
const enemyBase: Pt = myTeamId === 0 ? { x: W, y: H } : { x: 0, y: 0 };
const ctx = { myBase, enemyBase, bounds: { w: W, h: H } };

function d(a: Pt, b: Pt) { return Math.hypot(a.x - b.x, a.y - b.y); }

while (true) {
  const n = Number(readline());
  if (Number.isNaN(n)) break;

  const my: any[] = [];
  const opp: any[] = [];
  const ghosts: any[] = [];

  for (let i = 0; i < n; i++) {
    const [idS, xS, yS, tS, sS, vS] = readline().split(" ");
    const id = +idS, x = +xS, y = +yS, type = +tS, state = +sS, value = +vS;
    if (type === myTeamId) my.push({ id, x, y, state, value });
    else if (type === 1 - myTeamId) opp.push({ id, x, y, state, value });
    else ghosts.push({ id, x, y, stamina: state, value });
  }

  // For stability, act in ascending id order
  my.sort((a, b) => a.id - b.id);

  const lines: string[] = [];

  for (const me of my) {
    const self = {
      id: me.id,
      x: me.x, y: me.y,
      stunCd: me.value,                // CG uses `value` for stun cooldown / stun time; good enough for gating STUN
      radarUsed: radarUsed.has(me.id), // we maintain locally
      carrying: me.state === 1 ? {} : undefined
    };

    const enemies = opp.map((e) => ({
      id: e.id, x: e.x, y: e.y,
      carrying: e.state === 1 ? {} : undefined,
      range: d(self, e)
    }));

    const ghostsVisible = ghosts.map((g) => ({
      id: g.id, x: g.x, y: g.y,
      stamina: g.stamina,
      range: d(self, g)
    }));

    const obs = { self, enemies, ghostsVisible, tick };

    const a = act(ctx, obs) || { type: "MOVE", x: myBase.x, y: myBase.y };
    switch (a.type) {
      case "MOVE": {
        const x = Math.max(0, Math.min(W, Math.round(a.x)));
        const y = Math.max(0, Math.min(H, Math.round(a.y)));
        lines.push(`MOVE ${x} ${y}`);
        break;
      }
      case "BUST":
        lines.push(`BUST ${a.ghostId}`);
        break;
      case "RELEASE":
        lines.push(`RELEASE`);
        break;
      case "STUN":
        lines.push(`STUN ${a.busterId}`);
        break;
      case "RADAR":
        radarUsed.add(me.id);
        lines.push(`RADAR`);
        break;
      case "EJECT":       // Some leagues support EJECT; if not, MOVE fallback is harmless
        if (typeof a.x === "number" && typeof a.y === "number") {
          lines.push(`EJECT ${Math.round(a.x)} ${Math.round(a.y)}`);
        } else {
          lines.push(`MOVE ${myBase.x} ${myBase.y}`);
        }
        break;
      default:
        lines.push(`MOVE ${myBase.x} ${myBase.y}`);
        break;
    }
  }

  // Exactly bustersPerPlayer lines must be printed
  for (let i = 0; i < bustersPerPlayer; i++) print(lines[i] || `MOVE ${myBase.x} ${myBase.y}`);

  tick++;
}

