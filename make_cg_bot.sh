#!/usr/bin/env bash
set -euo pipefail

# =========================
# make_cg_bot.sh
# Train with CEM, read best genome, emit a Codingame-ready single-file bot.
# Usage (defaults shown):
#   POP=24 GENS=12 SEEDS_PER=5 EPS_PER_SEED=2 SEED=42 OUT_JS=codingame_bot.js ./make_cg_bot.sh
# =========================

# --- Config (override via env) ---
POP="${POP:-24}"
GENS="${GENS:-12}"
SEEDS_PER="${SEEDS_PER:-5}"
EPS_PER_SEED="${EPS_PER_SEED:-2}"
SEED="${SEED:-42}"
HOF="${HOF:-5}"
OPP_POOL="${OPP_POOL:-greedy,random}"
ALGO="${ALGO:-cem}"
ALGO_UPPER="$(printf '%s' "$ALGO" | tr '[:lower:]' '[:upper:]')"
OUT_JS="${OUT_JS:-codingame_bot.js}"

# --- Paths ---
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIM_RUNNER="$ROOT/packages/sim-runner"
ART="$SIM_RUNNER/artifacts/simrunner_best_genome.json"

echo "==> Step 1/3: Train $ALGO_UPPER (pop=$POP gens=$GENS seedsPer=$SEEDS_PER epsPerSeed=$EPS_PER_SEED seed=$SEED)"
pnpm -C "$SIM_RUNNER" start train \
  --algo "$ALGO" \
  --pop "$POP" \
  --gens "$GENS" \
  --seeds-per "$SEEDS_PER" \
  --eps-per-seed "$EPS_PER_SEED" \
  --seed "$SEED" \
  --opp-pool "$OPP_POOL" \
  --hof "$HOF"

echo "==> Step 2/3: Read best genome -> $ART"
if [ ! -f "$ART" ]; then
  echo "!! Artifact not found: $ART"
  exit 1
fi

# Extract and clamp to legal game bounds
read RADAR STUN RELEASE < <(node -e '
const fs=require("fs");
const g=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,Math.round(n||0)));
const radar=clamp(g.radarTurn??15, 1, 40);
const stun =clamp(g.stunRange??1700, 900, 1760);   // stun usable range cap
const rel  =clamp(g.releaseDist??1500, 800, 1600); // base score radius cap
process.stdout.write(`${radar} ${stun} ${rel}`);
' "$ART")

echo "Genome: radarTurn=$RADAR, stunRange=$STUN, releaseDist=$RELEASE"

echo "==> Step 3/3: Emit Codingame bot -> $OUT_JS"
cat > "$OUT_JS" <<'EOF'
/**
 * Auto-generated Codingame bot (Busters) from evolved genome.
 * Paste this whole file into the Codingame editor.
 *
 * GENOME is applied to behaviors:
 *  - radarTurn: use RADAR once after this turn if no targets seen
 *  - stunRange: opportunistic STUN within this distance
 *  - releaseDist: release when within this distance to own base
 */

const BUST_MIN = 900, BUST_MAX = 1760, STUN_CD_TURNS = 20;
const WIDTH = 16001, HEIGHT = 9001;
const BASE0 = { x: 0, y: 0 }, BASE1 = { x: 16000, y: 9000 };

// ---- GENOME (replaced by script) ----
const GENOME = { radarTurn: __RADAR__, stunRange: __STUN__, releaseDist: __RELEASE__ };
// -------------------------------------

const bustersPerPlayer = parseInt(readline(), 10);
const ghostCount = parseInt(readline(), 10);
const myTeamId = parseInt(readline(), 10);
const MY_BASE = (myTeamId === 0) ? BASE0 : BASE1;

let tick = 0;
const stunCd = Object.create(null);
const radarUsed = Object.create(null);

function dist(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return Math.hypot(dx, dy); }

while (true) {
  tick++;
  for (const k in stunCd) { if (stunCd[k] > 0) stunCd[k]--; }

  const entities = parseInt(readline(), 10);
  const my = [], enemies = [], ghosts = [];
  for (let i = 0; i < entities; i++) {
    const p = readline().split(' ');
    const id = +p[0], x = +p[1], y = +p[2], type = +p[3], state = +p[4], value = +p[5];
    const e = { id, x, y, type, state, value };
    if (type === -1) ghosts.push(e);
    else if (type === myTeamId) my.push(e);
    else enemies.push(e);
  }
  my.sort((a, b) => a.id - b.id);

  const actions = [];
  for (const me of my) {
    if (stunCd[me.id] === undefined) stunCd[me.id] = 0;
    if (radarUsed[me.id] === undefined) radarUsed[me.id] = false;

    const dBase = dist(me.x, me.y, MY_BASE.x, MY_BASE.y);

    // Find nearest enemy & ghost
    let ne = null, bestEd = Infinity;
    for (const e of enemies) {
      const d = dist(me.x, me.y, e.x, e.y);
      if (d < bestEd) { bestEd = d; ne = e; }
    }
    let ng = null, bestGd = Infinity;
    for (const g of ghosts) {
      const d = dist(me.x, me.y, g.x, g.y);
      if (d < bestGd) { bestGd = d; ng = g; }
    }

    // If carrying, go home & release
    if (me.state === 1) {
      if (dBase <= GENOME.releaseDist) { actions.push('RELEASE'); continue; }
      actions.push(`MOVE ${MY_BASE.x} ${MY_BASE.y}`); continue;
    }

    // Opportunistic stun if in range and off cooldown
    if (ne && bestEd <= GENOME.stunRange && stunCd[me.id] <= 0) {
      actions.push(`STUN ${ne.id}`); stunCd[me.id] = STUN_CD_TURNS; continue;
    }

    // Bust if in window; else chase nearest ghost
    if (ng) {
      if (bestGd >= BUST_MIN && bestGd <= BUST_MAX) { actions.push(`BUST ${ng.id}`); continue; }
      actions.push(`MOVE ${ng.x} ${ng.y}`); continue;
    }

    // Radar once after chosen turn when nothing seen
    if (!radarUsed[me.id] && tick >= GENOME.radarTurn) {
      actions.push('RADAR'); radarUsed[me.id] = true; continue;
    }

    // Fallback: regroup to base
    actions.push(`MOVE ${MY_BASE.x} ${MY_BASE.y}`);
  }

  for (const a of actions) console.log(a);
}
EOF

# Substitute placeholders safely
tmp="$OUT_JS.tmp"
sed -e "s/__RADAR__/$RADAR/g" \
    -e "s/__STUN__/$STUN/g" \
    -e "s/__RELEASE__/$RELEASE/g" \
    "$OUT_JS" > "$tmp" && mv "$tmp" "$OUT_JS"

echo "✅ Done. Codingame bot written to: $OUT_JS"

