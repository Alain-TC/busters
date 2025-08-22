# EVOL2 — Hybrid Strategy for Busters

Heuristics + Fog-of-War Estimation + Multi-Agent Assignment + Local Lookahead, with Offline Evolutionary Tuning

Version: 1.0 • Generated: 2025-08-17 20:47 UTC

## Purpose
Deliver a top-performing Busters bot that operates under 100 ms per turn by combining strong domain heuristics, a light probabilistic model for fog-of-war, multi-agent task assignment, and a tiny local lookahead. Weights and thresholds (≈20–40 coefficients) are optimized offline via CMA-ES / Genetic Algorithms against a diverse opponent pool with self-play and Hall-of-Fame (HOF).

## Milestones at a Glance
ID | Name | Outcome / Artifacts
-- | ---- | -------------------
M0 | Baseline & State Parser | game state, cooldowns, base coords, basic sim hooks
M1 | Heuristic Core v1 | Explore/Chase/Carry heuristics; ring BUST; anti-collision; planned RADAR
M2 | STUN & Base Block | Stun priorities, base blocker behavior
M3 | Fog Estimator | Ghost heatmap + frontiers (coverage planner)
M4 | Roles & Tasks | Scout/Chaser/Carrier/Interceptor/Blocker/Support + task definitions
M5 | Auction + Assignment | Score functions + cost matrix + Hungarian/greedy; spacing penalty
M6 | Action Candidates | MOVE targets (rings, intercept arcs, frontiers) + tactical actions
M7 | Local Lookahead | 1–2 ply micro-sim for contested captures, stun duels, release blocks
M8 | Evol Tuning | CMA-ES/GA optimize weights; HOF; PFSP/Elo reports
M9 | Export & Docs | Bot export for Codingame + comprehensive documentation (this PDF)

## Assumptions & Constraints
- Simultaneous turns, fog-of-war, continuous coordinates, and time/CPU budget (~100 ms/turn).
- Actions: `MOVE(x,y)`, `BUST(ghostId)`, `RELEASE`, `STUN(busterId)`, `RADAR`, `EJECT`.
- Effective BUST ring: 900–1760; RADAR radius ~2200; typical stun range ≤1760.
- Map free of obstacles (no heavy pathfinding), just clamp to bounds.
- 2–3 allies per side typical; adapt to league specifics if different.

## M0 — Baseline State & Engine Hooks
### Game State
Maintain a central state updated each tick:
- **Self/Allies**: `(id,x,y)`, role, carrying, `stunCd`, `radarUsed`, `lastSeenTick`, `assignedTask`.
- **Enemies (tracked)**: last known `(x,y)`, carrying?, stun cooldown estimate, `lastSeenTick`, velocity guess.
- **Ghosts**: visible list with `(id,x,y,stamina,range)`, otherwise estimated in heatmap.
- **Bases**: `myBase(x,y)`, `enemyBase(x,y)`, discovered via symmetry or from engine context.
- **Global** tick and RNG seed (for reproducibility).
- **Cached geometry**: ring targets (900–1760), intercept arcs, frontier waypoints.

### Update Cycle
1. Parse observations → update self/allies, visible enemies/ghosts; update cooldowns.
2. Update fog beliefs (ghost heatmap) and enemy trackers (decay/propagation).
3. Build candidate tasks from current world (explore, chase, carry, intercept, block, support).

### Performance Guardrails
- Precompute target rings and frontier routes once; reuse.
- Avoid \(O(n^2)\) where possible; small fixed lists, sorting by value.
- Limit micro-sim only to situations flagged as contested/critical.

## M3 — Fog-of-War Estimation
### Ghost Heatmap
Represent ghost belief as a scalar field `H(x,y)` over a coarse grid (e.g., 30×30 or 40×40). Initialize `H` uniformly or from known spawns. Each tick:
- Observation update: if a ghost is seen at `(gx,gy)`, set `H` near that cell high; elsewhere decay.
- Negative evidence: cells within radar/vision of scouts drop probability.
- Diffusion/decay: `H ← (1−α)·H + α·blur(H)` to avoid brittle peaks.
- Normalize to keep `∑H ≈ constant`.

### Frontiers
Maintain a visitation map `V(x,y)` with timestamps of last coverage. Frontier score `F = wF1·(age) + wF2·(distanceFactor) + wF3·(heatmap)`. For coverage, use offset lawnmower/Hilbert curves per buster, desynchronized to maximize area gain.

### Enemy Tracking
For each enemy: store last seen position/time, estimated velocity (from deltas or heading), and stun cooldown estimate. If carrying, estimate intercept points on path to base; propagate a belief corridor using max-speed envelope.

## M4 — Roles & Tasks
### Roles
- **Scout** (explore + schedule RADAR)
- **Chaser** (contest ghosts / BUST ring positioning)
- **Carrier** (bring ghost home, path safety)
- **Interceptor** (cut enemy carriers)
- **Base Blocker** (anti-release, stun threat near enemy base)
- **Support-Stun** (assist contested busts, chain stuns)

### Task Catalog
Define a pool of tasks `T` each tick with structured fields:
- `Explore(zone Z)`
- `Chase(ghost G)`
- `Carry(ghost G → base)`
- `Intercept(enemy E)`
- `BlockBase(enemyBase)`
- `SupportStun(target vicinity)`

Tasks include waypoints, time windows, and criticality flags.

## M5 — Task Scoring & Assignment
### Scoring Features (to be tuned offline)
For buster `i` and task `j`, define `Score(i,j)` as a weighted sum:
- **Chase**: `+gainExpected(G) − η₁·ηTimeToRing(i,G) − η₂·riskStun(i) + η₃·localSupremacy`
- **Carry**: `+k₁·proximityToBase − k₂·interceptionRisk − k₃·oppStunWindow`
- **Intercept**: `+m₁·probStopCarrier − m₂·distanceIntercept − m₃·counterStunRisk`
- **Explore**: `+n₁·infoGain(frontier×heatmap) − n₂·travelCost`
Typical coefficients count: ~20–40. Apply squashing (`tanh`/clip) to stabilize.

### Assignment
Build cost matrix `C(i,j) = −Score(i,j)`.
- If \(|T| ≤ 12\) use Hungarian.
- Else use greedy-improved:
  1. Rank tasks by max `Score`.
  2. Iteratively assign best available buster to best-ranked task with spacing penalty.
  3. Apply tie-breaks with role priors and diversity terms.

### Spacing / Anti-Collision
Add penalty `P = λ·∑` over ally pairs `max(0, rSafe − distance)`. `rSafe` typically ~400–600. During candidate selection, nudge targets with small jitter along tangents to reduce clustering.

## M6 — Action Candidate Generation
Per assigned task, generate 5–10 candidates:
- **MOVE**: ring placements (900–1760) around target ghost; intercept arcs; frontier waypoints; base approach.
- **BUST**: if range in [900, 1760].
- **RELEASE**: if base distance ≤1600 (tunable) and carrying.
- **STUN**: if an enemy carrier or high-threat enemy within ≈1760 and `stunCd=0`.
- **RADAR**: at planned turns (early T2–T3 for a central scout; a second mid-game by another scout).

### Candidate Scoring
`Value(c) = myopicHeuristic(c) + lookaheadBonus(c) − spacingPenalty − timePenalty`.
- `myopicHeuristic` includes distance/time-to-effect, ring alignment quality, and risk metrics.

## M7 — Local Lookahead (1–2 Ply)
Trigger micro-sims only when flagged critical: contested BUST, stun duel, or release under threat.
- Sim horizon 1–2 actions per side with deterministic heuristics.
- Evaluate differential outcomes: capture success, expected delay, stun trade value.

## Micro-Tactics
### BUST Ring Discipline
Avoid <900. Prefer positions that both keep [900–1760] and push the ghost toward our base (herding). If multiple allies, maintain spacing on the ring to reduce mutual obstruction.

### STUN Priorities
1. Enemy carrier within stun range.
2. Enemy that can break our contested capture.
3. Chain setup near reset: if my `stunCd ≈ 0` and ally’s soon, time sequence to maximize lockout.

### RADAR Scheduling
- First radar T2–T3 by central scout.
- Second radar mid-game by a different buster.
- Never all in the same turn; ensure coverage complements current frontiers.

### EJECT Use-Cases
- Defensive knockback from a gank.
- Situational handoff to a better-positioned ally (no direct score but improves tempo).

### Anti-Release Block
Station a blocker just outside enemy base radius (~1600). Maintain stun threat; kite to avoid counter-stun.

## M8 — Offline Optimization (CMA-ES / GA)
### Parameters to Optimize
- Task scoring weights: `{eta*, k*, m*, n*}`.
- Tactical thresholds: ring radii preferences, stun priority margins, release distance, radar timing.
- Spacing penalty `λ` and safe radius `rSafe`.

### Objective Function
`J(θ) = w₁·WinRate + w₂·AvgScoreDiff − w₃·TimePenalty − w₄·Instability`.
Evaluate against a mixed pool: scripted (greedy, random, camper, stunner), prior snapshots, and mirror self-play. Track Pareto frontier variants (aggressive/control/safe).

### Training Protocol
- Seeds & CRN: fix RNG seeds per episode for stable comparisons; rotate seed sets across generations.
- PFSP sampling: prioritize opponents that currently exploit us.
- HOF: keep top N genomes across generations and always include them in the pool.

### Reporting
- Elo/PFSP tables per pool member; confidence intervals.
- Best genome snapshot (JSON) and compiled single-file bot.
- Replays for selected pairings (contested matches).

## Architecture & Files
### Repo Layout (proposed)
```
packages/agents/              # baseline & evolved adapters
packages/sim-runner/          # training + tournaments (CEM, PFSP/Elo, workers, artifacts)
agents/                       # compiled single-file exports
scripts/                      # export helpers & reports
```

### Coding Notes
- Keep pure functions for scoring and candidate generation; pass state explicitly.
- Use small data classes/structs for `Buster`, `Ghost`, `EnemyTrack`, `Task`.
- Deterministic orderings for tie-breaks → reproducibility.

### Key Pseudocode
```ts
function act_all(state, obs) {
  state.update(obs);
  update_fog_heatmap(state);
  build_task_pool(state);            // explore, chase, carry, intercept, block, support
  const scores = compute_task_scores(state); // per buster × task
  const assignment = assign_tasks(scores);   // Hungarian or greedy-improved w/ spacing
  const actions = [];
  for (const buster of state.allies) {
    const cand = generate_candidates(buster, assignment[buster], state);
    const best = select_with_lookahead(cand, state); // 1–2 ply only if critical
    actions.push(best);
  }
  return actions;
}
```

### Task Score Example (Chase)
```ts
def score_chase(buster, ghost, state, theta) {
  const t_arrive = time_to_ring(buster.pos, ghost.pos, { ring: [900, 1760] });
  const risk = estimate_stun_risk(buster, state.enemies);
  const sup = local_supremacy(buster.pos, state); // allies - enemies nearby
  const gain = expected_ghost_value(ghost, state); // stamina, distance to base, contest level
  return (
    + theta.eta_gain * gain
    - theta.eta_t * t_arrive
    - theta.eta_r * risk
    + theta.eta_s * sup
  );
}
```

### Greedy-Improved Assignment
```ts
def assign_greedy_improved(scores, spacing_penalty) {
  const tasks = rank_tasks_by_max_score(scores);
  const assigned = new Map();
  const used_busters = new Set();
  for (const t of tasks) {
    const cand = scores
      .filter((_, i) => !used_busters.has(i))
      .map((row, i) => [i, row[t]]);
    if (cand.length === 0) continue;
    const [i_best, val] = cand.reduce((a, b) =>
      (b[1] - spacing_penalty(i: b[0], t)) > (a[1] - spacing_penalty(i: a[0], t)) ? b : a
    );
    assigned.set(i_best, t);
    used_busters.add(i_best);
  }
  return assigned;
}
```

## Training Flow (`packages/sim-runner`)
The `sim-runner` package drives evolutionary training and evaluation.

### CEM Training
```bash
pnpm -C packages/sim-runner start train \
  --algo cem --pop 24 --gens 12 \
  --seeds-per 7 --seed 42 \
  --opp-pool greedy,random,base-camper,aggressive-stunner,hof --hof 6
```
Outputs are written to `packages/sim-runner/artifacts/`:
- `simrunner_best_genome.json`
- `pfsp_log.jsonl`
- `tournament_standings.json` (when running tournaments)

### GA / CMA-ES Training
```bash
pnpm -C packages/sim-runner start train \
  --algo cma --pop 32 --gens 20 \
  --seeds-per 7 --eps-per-seed 2 \
  --opp-pool greedy,random,camper,stunner,base-camper,aggressive-stunner,hof --hof 8 --seed 42
```

### Sample CMA-ES Run
```
pnpm -C packages/sim-runner start train --subject hybrid --algo cma \
  --pop 4 --gens 2 --seeds-per 1 --eps-per-seed 1 \
  --opp-pool greedy,random,camper,stunner,base-camper,aggressive-stunner --seed 42
```
This quick run yielded a best fitness of 37.25 (≈37.5% win rate) and produced the
parameters committed in `packages/agents/hybrid-params.ts`.

## Export & Deployment
After training, export a CodinGame-ready bot.

- `scripts/export-codingame.ts` – bundle the best genome into `agents/codingame-bot.js`.
- `scripts/export-cg-bot.ts` – helper for exporting champions or baseline hybrids.

Typical workflow:
```bash
# build single-file bot from best genome
pnpm cg:export:genome

# export champion from latest tournament
pnpm cg:export:champ
```
Copy the resulting `agents/codingame-bot.js` into the CodinGame IDE to deploy.

## Testing, Evaluation & Robustness
- Unit-test scoring, candidate generation, and micro-sim with synthetic states.
- Deterministic seeds; CRN per matchup; regression tests on fixed episodes.
- Overfit checks: rotate opponent mixtures and map symmetries; track HOF performance.
- Performance: benchmark on target hardware; assert <100 ms at 95th percentile.

## Risks & Mitigations
- Overfitting to seed/opponent set → PFSP + HOF + mirror self-play.
- Thrash in assignment near ties → add hysteresis/inertia to task selection.
- Microlookahead blowup → strict gating and horizon cap; cache simple outcomes.
- RADAR misuse → schedule by role and forbid simultaneous all-radar turns.

## Implementation Checklist by Milestone
- **M0**: State structs, cooldown trackers, bases, cached geometry.
- **M1**: Explore/Chase/Carry heuristics; ring BUST; anti-collision; radar plan.
- **M2**: Stun priorities + base blocker behavior.
- **M3**: Heatmap + frontier planner; enemy trackers.
- **M4**: Roles & task builder.
- **M5**: Score functions and assignment (Hungarian/greedy).
- **M6**: Candidate action generation and selection.
- **M7**: Local 1–2 ply micro-sim on critical events.
- **M8**: CMA-ES/GA tuning pipeline + PFSP/Elo reports + HOF.
- **M9**: Export single-file bot + documentation.

