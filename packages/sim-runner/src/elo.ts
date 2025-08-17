// elo.ts — PFSP sur Elo avec tie-break déterministe et persistance simple

import fs from "fs";
import path from "path";

// === Types partagés avec ga.ts (on redéclare pour éviter les imports croisés)
export type Genome = {
  radarTurn: number;
  stunRange: number;
  releaseDist: number;
};

export type PFSPCandidate =
  | { type: "module"; spec: string; id?: string }
  | { type: "genome"; genome?: Genome; tag?: string; id?: string };

// === Elo utils
const DEFAULT_RATING = 1000;
const K = 32; // K-factor "raisonnable" pour s'adapter sans oscillations

function expectedScore(rA: number, rB: number) {
  // Elo classique
  const qA = Math.pow(10, rA / 400);
  const qB = Math.pow(10, rB / 400);
  return qA / (qA + qB);
}

function getId(c: PFSPCandidate): string {
  // Id stable et lisible pour logs/persist
  if (c.id) return c.id;
  if (c.type === "module") return c.spec;
  // genome
  if (c.tag) return c.tag;
  if (c.genome) {
    const g = c.genome;
    return `hof:${g.radarTurn},${g.stunRange},${g.releaseDist}`;
  }
  return "@busters/agents/greedy";
}

// Petit hash déterministe (FNV1a + xorshift) pour départager sans biais
function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  // xorshift pour "mixer"
  h ^= h << 13;
  h ^= h >>> 17;
  h ^= h << 5;
  // map sur [0,1)
  return ((h >>> 0) % 0x100000000) / 0x100000000;
}

// Désirabilité PFSP : on vise p≈0.5 (matchs serrés)
// score = 1 quand p=0.5 ; 0 quand p=0 ou 1
function pfspDesirability(pWin: number): number {
  // 1 - 2*|p-0.5|  =>  1 à 0.5  ;  0 aux extrêmes
  return Math.max(0, 1 - 2 * Math.abs(pWin - 0.5));
}

// === API persistée
export function loadElo(artifactsDir: string): Record<string, number> {
  const p = path.resolve(artifactsDir, "elo.json");
  try {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
      if (raw && typeof raw === "object") return raw as Record<string, number>;
    }
  } catch {}
  return {};
}

export function saveElo(artifactsDir: string, elo: Record<string, number>) {
  const p = path.resolve(artifactsDir, "elo.json");
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(elo, null, 2));
  } catch {}
}

// Met à jour la cote de l’adversaire (le "joueur" est un agent virtuel figé à 1000)
// - si won=true => l’adversaire a perdu
// - si won=false => l’adversaire a gagné
export function recordMatch(elo: Record<string, number>, oppId: string, won: boolean) {
  const rPlayer = DEFAULT_RATING;
  const rOpp = elo[oppId] ?? DEFAULT_RATING;

  // du point de vue de l'adversaire
  const expOpp = expectedScore(rOpp, rPlayer);
  const scoreOpp = won ? 0 : 1;

  const newOpp = rOpp + K * (scoreOpp - expOpp);
  elo[oppId] = Math.round(newOpp);
}

// Sélection PFSP avec tie-break déterministe (pas de biais "premier de liste")
// – On choisit le candidat dont la probabilité de victoire attendue (via Elo) est la plus proche de 0.5
// – En cas d’égalité parfaite, on départage sur un hash de l’id (stable).
export function pickOpponentPFSP(elo: Record<string, number>, cands: PFSPCandidate[]): PFSPCandidate {
  if (!cands.length) throw new Error("pickOpponentPFSP: empty candidates");

  const rPlayer = DEFAULT_RATING;

  // Évalue chaque candidat
  const scored = cands.map((c) => {
    const id = getId(c);
    const rOpp = elo[id] ?? DEFAULT_RATING;
    const pWin = expectedScore(rPlayer, rOpp); // proba que "nous" gagnions
    const desirability = pfspDesirability(pWin);
    const tie = hash01(id); // tie-break déterministe
    return { c, id, desirability, tie, rOpp };
  });

  // Argmax sur (desirability, tie) pour éviter le biais au premier
  scored.sort((a, b) => {
    if (b.desirability !== a.desirability) return b.desirability - a.desirability;
    if (b.tie !== a.tie) return b.tie - a.tie; // ordre stable mais "mélangé" par hash
    // fallback ultime : id lexicographique
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return scored[0].c;
}

