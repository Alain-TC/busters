// packages/sim-runner/scripts/replay-report.ts
// Summarize replay JSON. If actionsA/B contain __dbg tags, use them;
// otherwise infer a few key events (STUN, BUST_RING, RELEASE) from state deltas.

import fs from "fs";
import path from "path";

/* ---------- Types ---------- */

type Ent = {
  id: number;
  x: number;
  y: number;
  state?: number; // buster: 0 idle, 1 carrying, 2 stunned
  value?: number; // buster: stun counter (some engines) | ghost: #busters trapping
  team?: number;
  owner?: number;
};

type Frame = {
  tick?: number;
  width?: number;
  height?: number;
  busters?: Ent[];
  ghosts?: Ent[];
  scores?: Record<string, number> | number[];
  actionsA?: any[] | null;
  actionsB?: any[] | null;
};

type Totals = {
  STUN: number;
  BUST_RING: number;
  RADAR: number;
  INTERCEPT: number;
  BLOCK: number;
  DEFEND: number;
  RELEASE: number;
  CARRY_HOME: number;
};

function zeroTotals(): Totals {
  return {
    STUN: 0,
    BUST_RING: 0,
    RADAR: 0,
    INTERCEPT: 0,
    BLOCK: 0,
    DEFEND: 0,
    RELEASE: 0,
    CARRY_HOME: 0,
  };
}

/* ---------- Helpers ---------- */

const BUST_MIN = 900;
const BUST_MAX = 1760;

function readJSON(p: string) {
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(ax - bx, ay - by);
}

// Map score keys to A/B labels for printing.
function labelScores(scores: Frame["scores"]) {
  if (!scores) return { map: new Map<string, string>(), order: [] as string[] };
  if (Array.isArray(scores)) {
    const m = new Map<string, string>();
    m.set("0", "A");
    m.set("1", "B");
    return { map: m, order: ["0", "1"] };
  }
  const keys = Object.keys(scores);
  const m = new Map<string, string>();
  if (keys[0]) m.set(keys[0], "A");
  if (keys[1]) m.set(keys[1], "B");
  return { map: m, order: keys.slice(0, 2) };
}

function printTop(title: string, m: Map<string, number>, topN: number) {
  console.log(title);
  const list = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
  if (list.length === 0) {
    console.log("  (no tags captured)\n");
    return;
  }
  for (const [k, v] of list) {
    console.log(`  ${k.padEnd(14)} : ${v}`);
  }
  console.log();
}

function fmtPad(n: number, w = 3) {
  return String(n).padStart(w);
}

/* ---------- Main ---------- */

async function main() {
  const args = process.argv.slice(2);
  if (!args[0]) {
    console.log("Usage: tsx scripts/replay-report.ts <replay.json> [--top N] [--team A|B]");
    process.exit(1);
  }

  const replayArg = args[0];
  const topN = (() => {
    const i = args.indexOf("--top");
    return i >= 0 ? Number(args[i + 1] ?? 10) : 10;
  })();
  const teamFilter = (() => {
    const i = args.indexOf("--team");
    if (i >= 0 && args[i + 1]) {
      const t = String(args[i + 1]).toUpperCase();
      if (t === "A" || t === "B") return t as "A" | "B";
    }
    return null as "A" | "B" | null;
  })();

  const abs = path.isAbsolute(replayArg) ? replayArg : path.resolve(process.cwd(), replayArg);
  const json = readJSON(abs);
  const frames: Frame[] = Array.isArray(json) ? json : (json.frames || json);

  console.log(`Replay: ${abs}\n`);
  if (!frames || frames.length === 0) {
    console.log("(no frames)\n");
    return;
  }

  // If any action contains a debug tag, we'll use tag-based mode. Otherwise,
  // fall back to inferring events from state changes.
  const actionsExist = frames.some((f) =>
    (f as any).actionsA?.some((a: any) => a?.__dbg?.tag || a?.tag) ||
    (f as any).actionsB?.some((a: any) => a?.__dbg?.tag || a?.tag)
  );

  const tagCountCombined = new Map<string, number>();
  const tagCountA = new Map<string, number>();
  const tagCountB = new Map<string, number>();

  const totalsCombined = zeroTotals();
  const totalsA = zeroTotals();
  const totalsB = zeroTotals();

  let eventsRaw = 0;
  let eventsDedup = 0;
  const seenTickTag = new Set<string>(); // dedup by tick+tag

  // Score key → A/B for printing & release attribution.
  const { map: scoreKeyToAB_initial } = labelScores(frames[0]?.scores);

  if (actionsExist) {
    // ------------- Tag-based mode -------------
    for (const f of frames) {
      const tick = Number(f.tick ?? 0);
      const A = (f.actionsA || []) as any[];
      const B = (f.actionsB || []) as any[];

      const take = (acts: any[], side: "A" | "B") => {
        for (const a of acts) {
          const tag = a?.__dbg?.tag || a?.tag || null;
          if (!tag) continue;

          eventsRaw++;
          const key = `${tick}:${tag}`;
          if (!seenTickTag.has(key)) {
            seenTickTag.add(key);
            eventsDedup++;
          }

          // Counts
          tagCountCombined.set(tag, (tagCountCombined.get(tag) || 0) + 1);
          if (side === "A") tagCountA.set(tag, (tagCountA.get(tag) || 0) + 1);
          else tagCountB.set(tag, (tagCountB.get(tag) || 0) + 1);

          const bump = (t: Totals) => ((t as any)[tag] = ((t as any)[tag] || 0) + 1);
          switch (String(tag)) {
            case "STUN":
            case "BUST_RING":
            case "RADAR":
            case "INTERCEPT":
            case "BLOCK":
            case "DEFEND":
            case "RELEASE":
            case "CARRY_HOME":
              bump(totalsCombined);
              bump(side === "A" ? totalsA : totalsB);
              break;
          }
        }
      };

      take(A, "A");
      take(B, "B");
    }

    if (!teamFilter || teamFilter === "A" || teamFilter === "B")
      printTop("Top tags (combined):", tagCountCombined, topN);
    if (!teamFilter || teamFilter === "A")
      printTop("Top tags (A):", tagCountA, topN);
    if (!teamFilter || teamFilter === "B")
      printTop("Top tags (B):", tagCountB, topN);
  } else {
    // ------------- Inference mode -------------
    // We infer RELEASE (score increases), STUN (state change to 2), BUST_RING (in ring & trapping/disappearing).
    let prev: Frame | null = null;

    // Keep last scores for RELEASE detection.
    const lastScores: Record<string, number> = {};
    if (frames[0]?.scores) {
      if (Array.isArray(frames[0].scores)) {
        lastScores["0"] = Number((frames[0].scores as any)[0] || 0);
        lastScores["1"] = Number((frames[0].scores as any)[1] || 0);
      } else {
        for (const k of Object.keys(frames[0].scores)) lastScores[k] = Number((frames[0].scores as any)[k] || 0);
      }
    }

    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const tick = Number(f.tick ?? i);

      // RELEASE: any score increase per team.
      if (f.scores) {
        if (Array.isArray(f.scores)) {
          const s0 = Number((f.scores as any)[0] || 0), p0 = Number(lastScores["0"] || 0);
          const s1 = Number((f.scores as any)[1] || 0), p1 = Number(lastScores["1"] || 0);
          const d0 = Math.max(0, s0 - p0);
          const d1 = Math.max(0, s1 - p1);
          if (d0 > 0) {
            totalsCombined.RELEASE += d0; totalsA.RELEASE += d0;
            eventsRaw += d0; const key = `${tick}:RELEASE`; if (!seenTickTag.has(key)) { seenTickTag.add(key); eventsDedup++; }
          }
          if (d1 > 0) {
            totalsCombined.RELEASE += d1; totalsB.RELEASE += d1;
            eventsRaw += d1; const key = `${tick}:RELEASE`; if (!seenTickTag.has(key)) { seenTickTag.add(key); eventsDedup++; }
          }
          lastScores["0"] = s0; lastScores["1"] = s1;
        } else {
          for (const k of Object.keys(f.scores)) {
            const cur = Number((f.scores as any)[k] || 0);
            const prevS = Number(lastScores[k] || 0);
            const inc = Math.max(0, cur - prevS);
            if (inc > 0) {
              totalsCombined.RELEASE += inc;
              const ab = scoreKeyToAB_initial.get(k) || "A";
              (ab === "A" ? totalsA : totalsB).RELEASE += inc;
              eventsRaw += inc; const key = `${tick}:RELEASE`; if (!seenTickTag.has(key)) { seenTickTag.add(key); eventsDedup++; }
            }
            lastScores[k] = cur;
          }
        }
      }

      if (!prev) {
        prev = f;
        continue;
      }

      // STUN: buster becomes state=2 or stun counter increases.
      const prevB = new Map<number, Ent>();
      for (const b of prev.busters || []) prevB.set(b.id, b);
      for (const b of f.busters || []) {
        const pb = prevB.get(b.id);
        if (!pb) continue;
        const was = Number(pb.state ?? -99);
        const now = Number(b.state ?? -99);
        const vNow = Number(b.value ?? 0);
        const vPrev = Number(pb.value ?? 0);
        if ((was !== 2 && now === 2) || (now === 2 && vNow > vPrev)) {
          totalsCombined.STUN += 1;
          eventsRaw += 1; const key = `${tick}:STUN`; if (!seenTickTag.has(key)) { seenTickTag.add(key); eventsDedup++; }
        }
      }

      // BUST_RING: any buster within ring of a ghost AND (ghost.value>0 OR ghost disappears next frame).
      const next = frames[i + 1] || null;
      const nextGhostIds = new Set<number>((next?.ghosts || []).map((g) => g.id));

      for (const g of f.ghosts || []) {
        const inRing = (f.busters || []).some((b) => {
          const d = dist(b.x, b.y, g.x, g.y);
          return d >= BUST_MIN && d <= BUST_MAX;
        });
        if (!inRing) continue;
        const trappers = Number(g.value ?? 0);
        const goneNext = !nextGhostIds.has(g.id);
        if (trappers > 0 || goneNext) {
          totalsCombined.BUST_RING += 1;
          eventsRaw += 1; const key = `${tick}:BUST_RING`; if (!seenTickTag.has(key)) { seenTickTag.add(key); eventsDedup++; }
        }
      }

      prev = f;
    }

    // Print empty top lists (no tag names available)
    console.log("Top tags (combined):");
    console.log("  (no tags captured)\n");
    console.log("Top tags (A):");
    console.log("  (no tags captured)\n");
    console.log("Top tags (B):");
    console.log("  (no tags captured)\n");
  }

  // Final scores rendering (map to A/B labels)
  const last = frames[frames.length - 1];
  const { map: scoreKeyToAB_final } = labelScores(last.scores);
  const printable: Record<string, number> = {};
  if (last.scores) {
    if (Array.isArray(last.scores)) {
      printable["A"] = Number((last.scores as any)[0] || 0);
      printable["B"] = Number((last.scores as any)[1] || 0);
    } else {
      for (const k of Object.keys(last.scores)) {
        const ab = scoreKeyToAB_final.get(k) || k;
        printable[ab] = Number((last.scores as any)[k] || 0);
      }
    }
  }

  // Totals summary
  console.log("Key totals:");
  console.log(
    `  STUN           : A=${fmtPad((totalsA as any).STUN || 0)}   B=${fmtPad(
      (totalsB as any).STUN || 0
    )}   Σ=${(totalsCombined as any).STUN}`
  );
  console.log(
    `  BUST_RING      : A=${fmtPad((totalsA as any).BUST_RING || 0)}   B=${fmtPad(
      (totalsB as any).BUST_RING || 0
    )}   Σ=${(totalsCombined as any).BUST_RING}`
  );
  console.log(
    `  RADAR          : A=${fmtPad((totalsA as any).RADAR || 0)}   B=${fmtPad(
      (totalsB as any).RADAR || 0
    )}   Σ=${(totalsCombined as any).RADAR}`
  );
  console.log(
    `  INTERCEPT      : A=${fmtPad((totalsA as any).INTERCEPT || 0)}   B=${fmtPad(
      (totalsB as any).INTERCEPT || 0
    )}   Σ=${(totalsCombined as any).INTERCEPT}`
  );
  console.log(
    `  BLOCK          : A=${fmtPad((totalsA as any).BLOCK || 0)}   B=${fmtPad(
      (totalsB as any).BLOCK || 0
    )}   Σ=${(totalsCombined as any).BLOCK}`
  );
  console.log(
    `  DEFEND         : A=${fmtPad((totalsA as any).DEFEND || 0)}   B=${fmtPad(
      (totalsB as any).DEFEND || 0
    )}   Σ=${(totalsCombined as any).DEFEND}`
  );
  console.log(
    `  RELEASE        : A=${fmtPad((totalsA as any).RELEASE || 0)}   B=${fmtPad(
      (totalsB as any).RELEASE || 0
    )}   Σ=${(totalsCombined as any).RELEASE}`
  );
  console.log(
    `  CARRY_HOME     : A=${fmtPad((totalsA as any).CARRY_HOME || 0)}   B=${fmtPad(
      (totalsB as any).CARRY_HOME || 0
    )}   Σ=${(totalsCombined as any).CARRY_HOME}\n`
  );

  console.log(`Final scores: ${JSON.stringify(printable)}\n`);
  console.log(`Frames=${frames.length}  events(raw)=${eventsRaw}  events(dedup)=${eventsDedup}`);
}

main();

