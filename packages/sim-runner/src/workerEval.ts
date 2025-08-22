import { parentPort } from "worker_threads";
import { runEpisodes } from "./runEpisodes";
import { loadBotModule } from "./loadBots";
import { RULES } from "@busters/shared";

// Match the Genome used across the runner
type Genome = { radarTurn:number; stunRange:number; releaseDist:number };

// Safe defaults if a task comes without a genome (shouldn't happen, but avoid crashes)
const DEFAULT_GENOME: Genome = { radarTurn: 23, stunRange: 1766, releaseDist: 1600 };
const BASE_SCORE_RADIUS = 1600; // must be strictly inside to score

function coerceGenome(g: any): Genome {
  if (!g || typeof g !== "object") return DEFAULT_GENOME;
  const r = {
    radarTurn: Number.isFinite(g.radarTurn) ? g.radarTurn : DEFAULT_GENOME.radarTurn,
    stunRange: Number.isFinite(g.stunRange) ? g.stunRange : DEFAULT_GENOME.stunRange,
    releaseDist: Number.isFinite(g.releaseDist) ? g.releaseDist : DEFAULT_GENOME.releaseDist,
  };
  return r as Genome;
}

export function genomeToBot(genome: Genome) {
  const g = coerceGenome(genome); // close over a validated genome
  const stunCd = new Map<number, number>();
  let lastTick = -1;
  return {
    meta: { name: "EvolvedBot", version: "ga" },
    act(ctx: any, obs: any) {
      if (obs.tick < lastTick) {
        stunCd.clear();
        lastTick = -1;
      }
      if (obs.tick !== lastTick) {
        lastTick = obs.tick;
        for (const [id, cd] of stunCd.entries()) {
          const n = cd - 1;
          if (n > 0) stunCd.set(id, n); else stunCd.delete(id);
        }
      }
      // Carrying → go home & RELEASE near base
      if (obs.self.carrying !== undefined) {
        const dHome = Math.hypot(obs.self.x - ctx.myBase.x, obs.self.y - ctx.myBase.y);
        if (dHome < Math.min(g.releaseDist, BASE_SCORE_RADIUS)) return { type: "RELEASE" };
        return { type: "MOVE", x: ctx.myBase.x, y: ctx.myBase.y };
      }
      // Opportunistic STUN
      const enemy = obs.enemies?.[0];
      const cdLeft = obs.self.stunCd ?? stunCd.get(obs.self.id) ?? 0;
      if (enemy && enemy.range <= g.stunRange && cdLeft <= 0) {
        stunCd.set(obs.self.id, RULES.STUN_COOLDOWN);
        return { type: "STUN", busterId: enemy.id };
      }
      // Ghost hunt
      const ghost = obs.ghostsVisible?.[0];
      if (ghost) {
        if (ghost.range >= 900 && ghost.range <= 1760) return { type: "BUST", ghostId: ghost.id };
        return { type: "MOVE", x: ghost.x, y: ghost.y };
      }
      // One-time RADAR
      if (!obs.self.radarUsed && obs.tick >= g.radarTurn) return { type: "RADAR" };
      // Fallback: drift to base
      return { type: "MOVE", x: ctx.myBase.x, y: ctx.myBase.y };
    }
  };
}

type OppSpec =
  | { type: "module"; spec: string }
  | { type: "genome"; genome: Genome; tag?: string };

type TaskMsg = {
  id: number;
  genome?: Genome;      // my genome (should be present)
  opponent: OppSpec;    // opponent descriptor
  seed: number;
  episodes: number;
  bpp: number;          // bustersPerPlayer
  ghosts: number;       // ghostCount
  role: "A" | "B";
};

async function resolveOpponent(spec: OppSpec) {
  if (spec.type === "module") {
    const mod = await loadBotModule(spec.spec);
    return mod; // expects { act(...) }
  } else {
    return genomeToBot(coerceGenome(spec.genome));
  }
}

if (parentPort) {
  parentPort.on("message", async (msg: TaskMsg) => {
    try {
      const meBot = genomeToBot(coerceGenome(msg.genome));
      const oppBot = await resolveOpponent(msg.opponent);

      const botA = msg.role === "A" ? meBot : oppBot;
      const botB = msg.role === "A" ? oppBot : meBot;

      const res = await runEpisodes({
        seed: msg.seed,
        episodes: msg.episodes,
        bustersPerPlayer: msg.bpp,
        ghostCount: msg.ghosts,
        botA,
        botB,
      });

      parentPort.postMessage({
        ok: true,
        id: msg.id,
        diff: res.scoreA - res.scoreB,
      });
    } catch (e: any) {
      parentPort.postMessage({
        ok: false,
        id: (msg as any)?.id ?? -1,
        error: (e && e.stack) ? e.stack : String(e),
      });
    }
  });
}
