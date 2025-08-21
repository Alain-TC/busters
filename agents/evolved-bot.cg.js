(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // hybrid-params.ts
  var TUNE = {
    RELEASE_DIST: 1600,
    STUN_RANGE: 1760,
    RADAR1_TURN: 2,
    RADAR2_TURN: 55,
    SPACING: 900,
    SPACING_PUSH: 280,
    BLOCK_RING: 1750,
    DEFEND_RADIUS: 3200,
    EXPLORE_STEP_REWARD: 1
  };
  var WEIGHTS = {
    BUST_BASE: 12,
    BUST_RING_BONUS: 5,
    BUST_ENEMY_NEAR_PEN: 3,
    INTERCEPT_BASE: 14,
    INTERCEPT_DIST_PEN: 4e-3,
    DEFEND_BASE: 10,
    DEFEND_NEAR_BONUS: 6,
    BLOCK_BASE: 6,
    EXPLORE_BASE: 4,
    DIST_PEN: 3e-3
  };

  // fog.ts
  var W = 16e3;
  var H = 9e3;
  var CELL = 400;
  var GX = Math.ceil(W / CELL);
  var GY = Math.ceil(H / CELL);
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function dist(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
  }
  var Fog = class {
    constructor() {
      __publicField(this, "tick", 0);
      // last visited tick, -1 means never
      __publicField(this, "last");
      // belief heat (0..+inf, small decay)
      __publicField(this, "heat");
      this.last = new Int32Array(GX * GY);
      this.heat = new Float32Array(GX * GY);
      for (let i = 0; i < this.last.length; i++) this.last[i] = -1;
    }
    reset() {
      this.tick = 0;
      this.last.fill(-1);
      this.heat.fill(0);
    }
    beginTick(t) {
      if (t === this.tick) return;
      this.tick = t;
      for (let i = 0; i < this.heat.length; i++) {
        this.heat[i] *= 0.97;
        if (this.heat[i] < 0.02) this.heat[i] = 0;
      }
    }
    idxOf(x, y) {
      const gx = clamp(Math.floor(x / CELL), 0, GX - 1);
      const gy = clamp(Math.floor(y / CELL), 0, GY - 1);
      return gy * GX + gx;
    }
    markVisited(p) {
      const i = this.idxOf(p.x, p.y);
      this.last[i] = this.tick;
    }
    /** Clear vision circle (approx) by setting heat low & refresh visited in the disk */
    clearCircle(p, r) {
      const gx0 = clamp(Math.floor((p.x - r) / CELL), 0, GX - 1);
      const gx1 = clamp(Math.floor((p.x + r) / CELL), 0, GX - 1);
      const gy0 = clamp(Math.floor((p.y - r) / CELL), 0, GY - 1);
      const gy1 = clamp(Math.floor((p.y + r) / CELL), 0, GY - 1);
      const r2 = r * r;
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const cx = gx * CELL + CELL / 2;
          const cy = gy * CELL + CELL / 2;
          if ((cx - p.x) * (cx - p.x) + (cy - p.y) * (cy - p.y) <= r2) {
            const i = gy * GX + gx;
            this.last[i] = this.tick;
            this.heat[i] *= 0.2;
          }
        }
      }
    }
    /** Positive evidence: increase belief near a ghost sighting */
    bumpGhost(x, y) {
      const gx0 = clamp(Math.floor((x - 800) / CELL), 0, GX - 1);
      const gx1 = clamp(Math.floor((x + 800) / CELL), 0, GX - 1);
      const gy0 = clamp(Math.floor((y - 800) / CELL), 0, GY - 1);
      const gy1 = clamp(Math.floor((y + 800) / CELL), 0, GY - 1);
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const cx = gx * CELL + CELL / 2;
          const cy = gy * CELL + CELL / 2;
          const d2 = dist(cx, cy, x, y);
          const w = Math.max(0, 1 - d2 / 900);
          const i = gy * GX + gx;
          this.heat[i] += 0.8 * w;
        }
      }
    }
    /** Return a good frontier cell center from `from`, balancing info gain & distance */
    pickFrontierTarget(from) {
      let bestI = 0;
      let bestS = -1e9;
      for (let gy = 0; gy < GY; gy++) {
        for (let gx = 0; gx < GX; gx++) {
          const i = gy * GX + gx;
          const cx = gx * CELL + CELL / 2;
          const cy = gy * CELL + CELL / 2;
          const lv = this.last[i];
          const age = lv < 0 ? 200 : this.tick - lv;
          const belief = this.heat[i] * 30;
          const d2 = dist(from.x, from.y, cx, cy);
          const s = age + belief - 32e-4 * d2;
          if (s > bestS) {
            bestS = s;
            bestI = i;
          }
        }
      }
      const bx = bestI % GX * CELL + CELL / 2;
      const by = Math.floor(bestI / GX) * CELL + CELL / 2;
      return { x: clamp(bx, 0, W), y: clamp(by, 0, H) };
    }
  };

  // lib/state.ts
  var MAP_W = 16e3;
  var MAP_H = 9e3;
  var DEFAULT_ENEMY_MAX_AGE = 40;
  function clamp2(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function centerOfCell(cx, cy, cellW, cellH) {
    return { x: cx * cellW + cellW / 2, y: cy * cellH + cellH / 2 };
  }
  var HybridState = class {
    constructor(bounds, cols = 8, rows = 5, enemyMaxAge = DEFAULT_ENEMY_MAX_AGE) {
      // Coarse grid (defaults 8x5) for coverage; counts visits
      __publicField(this, "cols");
      __publicField(this, "rows");
      __publicField(this, "visits");
      __publicField(this, "cellW");
      __publicField(this, "cellH");
      // Enemy last-seen
      __publicField(this, "enemies", /* @__PURE__ */ new Map());
      __publicField(this, "enemyMaxAge");
      var _a, _b;
      const W4 = (_a = bounds == null ? void 0 : bounds.w) != null ? _a : MAP_W;
      const H4 = (_b = bounds == null ? void 0 : bounds.h) != null ? _b : MAP_H;
      this.cols = cols;
      this.rows = rows;
      this.cellW = W4 / cols;
      this.cellH = H4 / rows;
      this.visits = Array(cols * rows).fill(0);
      this.enemyMaxAge = enemyMaxAge;
    }
    idxFromPoint(p) {
      const cx = clamp2(Math.floor(p.x / this.cellW), 0, this.cols - 1);
      const cy = clamp2(Math.floor(p.y / this.cellH), 0, this.rows - 1);
      return cy * this.cols + cx;
    }
    touchVisit(p) {
      this.visits[this.idxFromPoint(p)]++;
    }
    /** Return center of least-visited cell (simple frontier heuristic) */
    bestFrontier() {
      let bestI = 0, bestV = this.visits[0];
      for (let i = 1; i < this.visits.length; i++) {
        if (this.visits[i] < bestV) {
          bestV = this.visits[i];
          bestI = i;
        }
      }
      const cy = Math.floor(bestI / this.cols);
      const cx = bestI % this.cols;
      return centerOfCell(cx, cy, this.cellW, this.cellH);
    }
    pruneEnemies(currentTick, maxAge = this.enemyMaxAge) {
      for (const [id, e] of this.enemies) {
        if (currentTick - e.lastTick > maxAge) this.enemies.delete(id);
      }
    }
    trackEnemies(enemies, tick2) {
      if (!enemies) return;
      for (const e of enemies) {
        if ((e == null ? void 0 : e.x) === void 0 || (e == null ? void 0 : e.y) === void 0) continue;
        this.enemies.set(e.id, {
          id: e.id,
          last: { x: e.x, y: e.y },
          lastTick: tick2 != null ? tick2 : 0,
          carrying: e.carrying !== void 0,
          stunCd: e.stunCd
        });
      }
      if (tick2 !== void 0) this.pruneEnemies(tick2);
    }
  };
  var G = globalThis.__HYBRID_STATE__ || (globalThis.__HYBRID_STATE__ = {});
  function getState(ctx2, obs) {
    const key = "team";
    if (!G[key] || (obs == null ? void 0 : obs.tick) <= 1) {
      G[key] = new HybridState(ctx2 == null ? void 0 : ctx2.bounds);
    }
    return G[key];
  }

  // micro.ts
  var SPEED = 800;
  function dist2(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
  }
  function estimateInterceptPoint(me, enemy, myBase2) {
    const ex = enemy.x, ey = enemy.y;
    const bx = myBase2.x, by = myBase2.y;
    const dx = bx - ex, dy = by - ey;
    const L = Math.hypot(dx, dy) || 1;
    const ts = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9];
    let best = { x: ex + dx * 0.6, y: ey + dy * 0.6 };
    for (const t of ts) {
      const px = ex + dx * t, py = ey + dy * t;
      const tMe = dist2(me.x, me.y, px, py) / SPEED;
      const tEn = L * t / SPEED;
      if (tMe <= tEn) {
        best = { x: Math.round(px), y: Math.round(py) };
        break;
      }
    }
    return best;
  }
  function duelStunDelta(opts) {
    var _a;
    const { me, enemy, canStunMe, canStunEnemy, stunRange } = opts;
    const r = (_a = enemy.range) != null ? _a : dist2(me.x, me.y, enemy.x, enemy.y);
    if (r > stunRange) return 0;
    if (canStunMe && !canStunEnemy) return 1;
    if (!canStunMe && canStunEnemy) return -1;
    if (canStunMe && canStunEnemy) return 0.15;
    return 0;
  }
  function contestedBustDelta(opts) {
    const { me, ghost, enemies, bustMin, bustMax, stunRange, canStunMe } = opts;
    const r = dist2(me.x, me.y, ghost.x, ghost.y);
    const near = enemies.filter((e) => dist2(e.x, e.y, ghost.x, ghost.y) <= 2200);
    if (near.length === 0) return 0;
    let delta = 0;
    if (r >= bustMin && r <= bustMax) delta += 0.25;
    delta += -0.35 * near.length;
    const enemyInStun = near.some((e) => {
      var _a;
      return ((_a = e.range) != null ? _a : dist2(me.x, me.y, e.x, e.y)) <= stunRange;
    });
    if (enemyInStun && !canStunMe) delta -= 0.3;
    return delta;
  }
  function releaseBlockDelta(opts) {
    const { blocker, carrier, myBase: myBase2, stunRange } = opts;
    const dCarrierToBase = dist2(carrier.x, carrier.y, myBase2.x, myBase2.y);
    const RELEASE_DIST = 1600;
    const need = Math.max(0, dCarrierToBase - (RELEASE_DIST + 150));
    const ux = myBase2.x - carrier.x, uy = myBase2.y - carrier.y;
    const L = Math.hypot(ux, uy) || 1;
    const px = carrier.x + ux / L * need, py = carrier.y + uy / L * need;
    const tMe = dist2(blocker.x, blocker.y, px, py) / SPEED;
    const tEn = need / SPEED;
    const lead = tEn - tMe;
    let delta = 0;
    if (lead < -1) delta -= 0.6;
    else if (lead > 0.5) delta += 0.6;
    const dr = dist2(blocker.x, blocker.y, px, py);
    if (dr <= stunRange + 200) delta += 0.25;
    return delta;
  }

  // hybrid-bot.ts
  var fog = new Fog();
  var TUNE2 = TUNE;
  var WEIGHTS2 = WEIGHTS;
  var W2 = 16e3;
  var H2 = 9e3;
  var BUST_MIN = 900;
  var BUST_MAX = 1760;
  var STUN_CD = 20;
  function clamp3(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function dist3(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
  }
  function norm(dx, dy) {
    const d2 = Math.hypot(dx, dy) || 1;
    return { x: dx / d2, y: dy / d2 };
  }
  function dbg(act2, tag, reason, extra) {
    act2.__dbg = { tag, reason, extra };
    return act2;
  }
  var mem = /* @__PURE__ */ new Map();
  function M(id) {
    if (!mem.has(id)) mem.set(id, { stunReadyAt: 0, radarUsed: false, wp: 0 });
    return mem.get(id);
  }
  var lastTick = Infinity;
  var PATROLS = [
    [{ x: 2500, y: 2500 }, { x: 12e3, y: 2e3 }, { x: 15e3, y: 8e3 }, { x: 2e3, y: 8e3 }, { x: 8e3, y: 4500 }],
    [{ x: 13500, y: 6500 }, { x: 8e3, y: 1200 }, { x: 1200, y: 1200 }, { x: 8e3, y: 7800 }, { x: 8e3, y: 4500 }],
    [{ x: 8e3, y: 4500 }, { x: 14e3, y: 4500 }, { x: 8e3, y: 8e3 }, { x: 1e3, y: 4500 }, { x: 8e3, y: 1e3 }],
    [{ x: 2e3, y: 7e3 }, { x: 14e3, y: 7e3 }, { x: 14e3, y: 2e3 }, { x: 2e3, y: 2e3 }, { x: 8e3, y: 4500 }]
  ];
  function resolveBases(ctx2) {
    var _a, _b;
    const my = (_a = ctx2.myBase) != null ? _a : { x: 0, y: 0 };
    const enemy = (_b = ctx2.enemyBase) != null ? _b : { x: W2 - my.x, y: H2 - my.y };
    return { my, enemy };
  }
  function spacedTarget(me, raw, friends) {
    if (!friends || friends.length <= 1) {
      const phase = (me.id * 9301 ^ 40503) & 1 ? 1 : -1;
      const dir = norm(raw.x - me.x, raw.y - me.y);
      const px = -dir.y, py = dir.x;
      return { x: clamp3(raw.x + phase * 220 * px, 0, W2), y: clamp3(raw.y + phase * 220 * py, 0, H2) };
    }
    let nearest, best = Infinity;
    for (const f of friends) {
      if (f.id === me.id) continue;
      const d2 = dist3(me.x, me.y, f.x, f.y);
      if (d2 < best) {
        best = d2;
        nearest = f;
      }
    }
    if (!nearest || best >= TUNE2.SPACING) return raw;
    const away = norm(me.x - nearest.x, me.y - nearest.y);
    return { x: clamp3(raw.x + away.x * TUNE2.SPACING_PUSH, 0, W2), y: clamp3(raw.y + away.y * TUNE2.SPACING_PUSH, 0, H2) };
  }
  function blockerRing(myBase2, enemyBase2) {
    const v = norm(enemyBase2.x - myBase2.x, enemyBase2.y - myBase2.y);
    return { x: clamp3(enemyBase2.x - v.x * TUNE2.BLOCK_RING, 0, W2), y: clamp3(enemyBase2.y - v.y * TUNE2.BLOCK_RING, 0, H2) };
  }
  var planTick = -1;
  var planAssign = /* @__PURE__ */ new Map();
  function uniqTeam(self, friends) {
    const map = /* @__PURE__ */ new Map();
    map.set(self.id, self);
    (friends != null ? friends : []).forEach((f) => map.set(f.id, f));
    return Array.from(map.values());
  }
  function buildTasks(ctx2, meObs, state, MY, EN) {
    var _a, _b, _c, _d, _e, _f;
    const tasks = [];
    const enemies = (_a = meObs.enemies) != null ? _a : [];
    const ghosts = (_b = meObs.ghostsVisible) != null ? _b : [];
    for (const e of enemies) {
      if (e.state === 1) {
        const tx = Math.round((e.x + MY.x) / 2);
        const ty = Math.round((e.y + MY.y) / 2);
        tasks.push({ type: "INTERCEPT", target: { x: tx, y: ty }, payload: { enemyId: e.id }, baseScore: WEIGHTS2.INTERCEPT_BASE });
      }
    }
    for (const e of state.enemies.values()) {
      if (e.carrying && !enemies.some((v) => v.id === e.id)) {
        const tx = Math.round((e.last.x + MY.x) / 2);
        const ty = Math.round((e.last.y + MY.y) / 2);
        tasks.push({ type: "INTERCEPT", target: { x: tx, y: ty }, payload: { enemyId: e.id }, baseScore: WEIGHTS2.INTERCEPT_BASE });
      }
    }
    let nearThreat = enemies.find((e) => dist3(e.x, e.y, MY.x, MY.y) <= TUNE2.DEFEND_RADIUS);
    if (!nearThreat) {
      for (const e of state.enemies.values()) {
        if (dist3(e.last.x, e.last.y, MY.x, MY.y) <= TUNE2.DEFEND_RADIUS) {
          nearThreat = { id: e.id, x: e.last.x, y: e.last.y };
          break;
        }
      }
    }
    if (nearThreat) {
      const tx = Math.round((nearThreat.x + MY.x) / 2);
      const ty = Math.round((nearThreat.y + MY.y) / 2);
      tasks.push({ type: "DEFEND", target: { x: tx, y: ty }, payload: { enemyId: nearThreat.id }, baseScore: WEIGHTS2.DEFEND_BASE + WEIGHTS2.DEFEND_NEAR_BONUS });
    }
    for (const g of ghosts) {
      const r = (_c = g.range) != null ? _c : dist3(meObs.self.x, meObs.self.y, g.x, g.y);
      const onRingBonus = r >= BUST_MIN && r <= BUST_MAX ? WEIGHTS2.BUST_RING_BONUS : 0;
      const risk = enemies.filter((e) => dist3(e.x, e.y, g.x, g.y) <= 2200).length * WEIGHTS2.BUST_ENEMY_NEAR_PEN;
      tasks.push({ type: "BUST", target: { x: g.x, y: g.y }, payload: { ghostId: g.id }, baseScore: WEIGHTS2.BUST_BASE + onRingBonus - risk });
    }
    if (!enemies.some((e) => e.state === 1) && !Array.from(state.enemies.values()).some((e) => e.carrying)) {
      tasks.push({ type: "BLOCK", target: blockerRing(MY, EN), baseScore: WEIGHTS2.BLOCK_BASE });
    }
    const team = uniqTeam(meObs.self, meObs.friends);
    const early = ((_e = (_d = ctx2.tick) != null ? _d : meObs.tick) != null ? _e : 0) < 5;
    for (const mate of team) {
      let target;
      const payload = { id: mate.id };
      if (!early) target = state.bestFrontier();
      if (!target) {
        const idx = ((_f = mate.localIndex) != null ? _f : 0) % PATROLS.length;
        const Mx = MPatrol(mate.id);
        const path = PATROLS[idx];
        const wp = Mx.wp % path.length;
        target = path[wp];
        payload.wp = wp;
      }
      tasks.push({ type: "EXPLORE", target, payload, baseScore: WEIGHTS2.EXPLORE_BASE + TUNE2.EXPLORE_STEP_REWARD });
    }
    return tasks;
  }
  var pMem = /* @__PURE__ */ new Map();
  function MPatrol(id) {
    if (!pMem.has(id)) pMem.set(id, { wp: 0 });
    return pMem.get(id);
  }
  function scoreAssign(b, t, enemies, MY, tick2) {
    var _a;
    const baseD = dist3(b.x, b.y, t.target.x, t.target.y);
    let s = t.baseScore - baseD * WEIGHTS2.DIST_PEN;
    const canStunMe = M(b.id).stunReadyAt <= tick2;
    if (t.type === "INTERCEPT") {
      const enemy = enemies.find((e) => {
        var _a2;
        return e.id === ((_a2 = t.payload) == null ? void 0 : _a2.enemyId);
      });
      if (enemy) {
        const P = estimateInterceptPoint(b, enemy, MY);
        const d2 = dist3(b.x, b.y, P.x, P.y);
        s = t.baseScore - d2 * WEIGHTS2.DIST_PEN - d2 * WEIGHTS2.INTERCEPT_DIST_PEN;
        s += duelStunDelta({ me: b, enemy, canStunMe, canStunEnemy: enemy.state !== 2, stunRange: TUNE2.STUN_RANGE });
        s += releaseBlockDelta({ blocker: b, carrier: enemy, myBase: MY, stunRange: TUNE2.STUN_RANGE });
      } else {
        s -= baseD * WEIGHTS2.INTERCEPT_DIST_PEN;
      }
    }
    if (t.type === "BUST") {
      const r = dist3(b.x, b.y, t.target.x, t.target.y);
      if (r >= BUST_MIN && r <= BUST_MAX) s += WEIGHTS2.BUST_RING_BONUS * 0.5;
      s += contestedBustDelta({
        me: b,
        ghost: { x: t.target.x, y: t.target.y, id: (_a = t.payload) == null ? void 0 : _a.ghostId },
        enemies,
        bustMin: BUST_MIN,
        bustMax: BUST_MAX,
        stunRange: TUNE2.STUN_RANGE,
        canStunMe
      });
    }
    if (t.type === "BLOCK") {
      const carrier = enemies.find((e) => e.state === 1);
      if (carrier) {
        s += releaseBlockDelta({ blocker: b, carrier, myBase: MY, stunRange: TUNE2.STUN_RANGE });
      }
    }
    if (t.type === "DEFEND") {
      const near = enemies.filter((e) => dist3(e.x, e.y, MY.x, MY.y) <= TUNE2.DEFEND_RADIUS).length;
      s += near * 1.5;
    }
    return s;
  }
  function runAuction(team, tasks, enemies, MY, tick2) {
    const assigned = /* @__PURE__ */ new Map();
    const freeB = new Set(team.map((b) => b.id));
    const freeT = new Set(tasks.map((_, i) => i));
    const S = [];
    for (let bi = 0; bi < team.length; bi++) {
      for (let ti = 0; ti < tasks.length; ti++) {
        S.push({ b: bi, t: ti, s: scoreAssign(team[bi], tasks[ti], enemies, MY, tick2) });
      }
    }
    S.sort((a, b) => b.s - a.s);
    for (const { b, t } of S) {
      const bId = team[b].id;
      if (!freeB.has(bId) || !freeT.has(t)) continue;
      assigned.set(bId, tasks[t]);
      freeB.delete(bId);
      freeT.delete(t);
      if (freeB.size === 0) break;
    }
    return assigned;
  }
  function act(ctx2, obs) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n;
    const tick2 = ((_b = (_a = ctx2.tick) != null ? _a : obs.tick) != null ? _b : 0) | 0;
    if (tick2 <= 1 && tick2 < lastTick) {
      mem.clear();
      fog.reset();
    }
    lastTick = tick2;
    const me = obs.self;
    const m = M(me.id);
    const state = getState(ctx2, obs);
    state.trackEnemies(obs.enemies, tick2);
    fog.beginTick(tick2);
    const friends = uniqTeam(me, obs.friends);
    for (const f of friends) {
      fog.markVisited(f);
      state.touchVisit(f);
    }
    const { my: MY, enemy: EN } = resolveBases(ctx2);
    const enemiesObs = ((_c = obs.enemies) != null ? _c : []).slice().sort((a, b) => {
      var _a2, _b2;
      return ((_a2 = a.range) != null ? _a2 : dist3(me.x, me.y, a.x, a.y)) - ((_b2 = b.range) != null ? _b2 : dist3(me.x, me.y, b.x, b.y));
    });
    const ghosts = ((_d = obs.ghostsVisible) != null ? _d : []).slice().sort((a, b) => {
      var _a2, _b2;
      return ((_a2 = a.range) != null ? _a2 : dist3(me.x, me.y, a.x, a.y)) - ((_b2 = b.range) != null ? _b2 : dist3(me.x, me.y, b.x, b.y));
    });
    const remembered = Array.from(state.enemies.values()).map((e) => ({ id: e.id, x: e.last.x, y: e.last.y, state: e.carrying ? 1 : 0 }));
    const enemyMap = /* @__PURE__ */ new Map();
    for (const e of enemiesObs) enemyMap.set(e.id, e);
    for (const e of remembered) if (!enemyMap.has(e.id)) enemyMap.set(e.id, e);
    const enemiesAll = Array.from(enemyMap.values()).sort((a, b) => {
      var _a2, _b2;
      return ((_a2 = a.range) != null ? _a2 : dist3(me.x, me.y, a.x, a.y)) - ((_b2 = b.range) != null ? _b2 : dist3(me.x, me.y, b.x, b.y));
    });
    const enemies = enemiesObs;
    if (enemies.length || ghosts.length) fog.clearCircle(me, 2200);
    for (const g of ghosts) fog.bumpGhost(g.x, g.y);
    const bpp = (_e = ctx2.bustersPerPlayer) != null ? _e : Math.max(3, friends.length || 3);
    me.localIndex = (_f = me.localIndex) != null ? _f : me.id % bpp;
    const localIdx = me.localIndex;
    const carrying = me.carrying !== void 0 ? true : me.state === 1;
    const stunned = me.state === 2;
    const stunCdLeft = (_g = me.stunCd) != null ? _g : Math.max(0, m.stunReadyAt - tick2);
    const canStun = !stunned && stunCdLeft <= 0;
    if (carrying) {
      const dHome = dist3(me.x, me.y, MY.x, MY.y);
      if (dHome <= TUNE2.RELEASE_DIST) {
        return dbg({ type: "RELEASE" }, "RELEASE", "at_base");
      }
      const home = spacedTarget(me, MY, friends);
      return dbg({ type: "MOVE", x: home.x, y: home.y }, "CARRY_HOME", "carrying");
    }
    let targetEnemy = enemies.find((e) => {
      var _a2;
      return e.state === 1 && ((_a2 = e.range) != null ? _a2 : dist3(me.x, me.y, e.x, e.y)) <= TUNE2.STUN_RANGE;
    });
    if (!targetEnemy && enemies.length && ((_h = enemies[0].range) != null ? _h : dist3(me.x, me.y, enemies[0].x, enemies[0].y)) <= BUST_MAX) {
      targetEnemy = enemies[0];
    }
    if (canStun && targetEnemy) {
      const duel = duelStunDelta({
        me,
        enemy: targetEnemy,
        canStunMe: true,
        canStunEnemy: targetEnemy.state !== 2,
        stunRange: TUNE2.STUN_RANGE
      });
      if (duel >= 0) {
        mem.get(me.id).stunReadyAt = tick2 + STUN_CD;
        return dbg({ type: "STUN", busterId: targetEnemy.id }, "STUN", targetEnemy.state === 1 ? "enemy_carrier" : "threat");
      }
    }
    if (!m.radarUsed && !stunned) {
      if (localIdx === 0 && tick2 === TUNE2.RADAR1_TURN) {
        m.radarUsed = true;
        fog.clearCircle(me, 4e3);
        return dbg({ type: "RADAR" }, "RADAR", "RADAR1_TURN");
      }
      if (localIdx === 1 && tick2 === TUNE2.RADAR2_TURN) {
        m.radarUsed = true;
        fog.clearCircle(me, 4e3);
        return dbg({ type: "RADAR" }, "RADAR", "RADAR2_TURN");
      }
    }
    if (ghosts.length) {
      const g = ghosts[0];
      const r = (_i = g.range) != null ? _i : dist3(me.x, me.y, g.x, g.y);
      if (r >= BUST_MIN && r <= BUST_MAX) return dbg({ type: "BUST", ghostId: g.id }, "BUST_RING", "in_ring");
    }
    if (planTick !== tick2) {
      const team = friends;
      const tasks = buildTasks(ctx2, obs, state, MY, EN);
      planAssign = runAuction(team, tasks, enemiesAll, MY, tick2);
      planTick = tick2;
    }
    const myTask = planAssign.get(me.id);
    if (myTask) {
      if (myTask.type === "BUST" && ghosts.length) {
        const g = (_j = ghosts.find((gg) => {
          var _a2;
          return gg.id === ((_a2 = myTask.payload) == null ? void 0 : _a2.ghostId);
        })) != null ? _j : ghosts[0];
        const r = dist3(me.x, me.y, g.x, g.y);
        if (r >= BUST_MIN && r <= BUST_MAX) return dbg({ type: "BUST", ghostId: g.id }, "BUST_RING", "task_bust");
        const chase = spacedTarget(me, { x: g.x, y: g.y }, friends);
        return dbg({ type: "MOVE", x: chase.x, y: chase.y }, "TASK_BUST_CHASE", "to_ghost");
      }
      if (myTask.type === "INTERCEPT") {
        const enemy = enemiesAll.find((e) => {
          var _a2;
          return e.id === ((_a2 = myTask.payload) == null ? void 0 : _a2.enemyId);
        });
        if (enemy) {
          const P = estimateInterceptPoint(me, enemy, MY);
          const tgt2 = spacedTarget(me, P, friends);
          return dbg({ type: "MOVE", x: tgt2.x, y: tgt2.y }, "INTERCEPT", "est_int");
        }
        const tgt = spacedTarget(me, myTask.target, friends);
        return dbg({ type: "MOVE", x: tgt.x, y: tgt.y }, "INTERCEPT", "midpoint");
      }
      if (myTask.type === "DEFEND") {
        const tgt = spacedTarget(me, myTask.target, friends);
        return dbg({ type: "MOVE", x: tgt.x, y: tgt.y }, "DEFEND", "near_base");
      }
      if (myTask.type === "BLOCK") {
        const hold = spacedTarget(me, myTask.target, friends);
        return dbg({ type: "MOVE", x: hold.x, y: hold.y }, "BLOCK", "enemy_ring");
      }
      if (myTask.type === "EXPLORE") {
        if (((_k = myTask.payload) == null ? void 0 : _k.wp) !== void 0) {
          const mateId = (_m = (_l = myTask.payload) == null ? void 0 : _l.id) != null ? _m : me.id;
          const Mx = MPatrol(mateId);
          const path = PATROLS[((_n = me.localIndex) != null ? _n : 0) % PATROLS.length];
          const cur = path[Mx.wp % path.length];
          if (dist3(me.x, me.y, cur.x, cur.y) < 800) Mx.wp = (Mx.wp + 1) % path.length;
          const next = path[Mx.wp % path.length];
          const P2 = spacedTarget(me, next, friends);
          return dbg({ type: "MOVE", x: P2.x, y: P2.y }, "TASK_EXPLORE", `wp_${Mx.wp}`);
        }
        const P = spacedTarget(me, myTask.target, friends);
        return dbg({ type: "MOVE", x: P.x, y: P.y }, "TASK_EXPLORE", "frontier");
      }
    }
    if (ghosts.length) {
      const g = ghosts[0];
      const chase = spacedTarget(me, { x: g.x, y: g.y }, friends);
      return dbg({ type: "MOVE", x: chase.x, y: chase.y }, "CHASE", "nearest_ghost");
    }
    const back = spacedTarget(me, MY, friends);
    return dbg({ type: "MOVE", x: back.x, y: back.y }, "IDLE_BACK", "no_task");
  }

  // cg-adapter.ts
  var W3 = 16e3;
  var H3 = 9e3;
  var tick = 0;
  var radarUsed = /* @__PURE__ */ new Set();
  var bustersPerPlayer = parseInt(readline(), 10);
  var ghostCount = parseInt(readline(), 10);
  var myTeamId = parseInt(readline(), 10);
  var myBase = myTeamId === 0 ? { x: 0, y: 0 } : { x: W3, y: H3 };
  var enemyBase = myTeamId === 0 ? { x: W3, y: H3 } : { x: 0, y: 0 };
  var ctx = { myBase, enemyBase, bounds: { w: W3, h: H3 } };
  function d(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  while (true) {
    const n = Number(readline());
    if (Number.isNaN(n)) break;
    const my = [];
    const opp = [];
    const ghosts = [];
    for (let i = 0; i < n; i++) {
      const [idS, xS, yS, tS, sS, vS] = readline().split(" ");
      const id = +idS, x = +xS, y = +yS, type = +tS, state = +sS, value = +vS;
      if (type === 1) my.push({ id, x, y, state, value });
      else if (type === 2) opp.push({ id, x, y, state, value });
      else ghosts.push({ id, x, y, stamina: state, value });
    }
    my.sort((a, b) => a.id - b.id);
    const lines = [];
    for (const me of my) {
      const self = {
        id: me.id,
        x: me.x,
        y: me.y,
        stunCd: me.value,
        // CG uses `value` for stun cooldown / stun time; good enough for gating STUN
        radarUsed: radarUsed.has(me.id),
        // we maintain locally
        carrying: me.state === 1 ? {} : void 0
      };
      const enemies = opp.map((e) => ({
        id: e.id,
        x: e.x,
        y: e.y,
        carrying: e.state === 1 ? {} : void 0,
        range: d(self, e)
      }));
      const ghostsVisible = ghosts.map((g) => ({
        id: g.id,
        x: g.x,
        y: g.y,
        stamina: g.stamina,
        range: d(self, g)
      }));
      const obs = { self, enemies, ghostsVisible, tick };
      const a = act(ctx, obs) || { type: "MOVE", x: myBase.x, y: myBase.y };
      switch (a.type) {
        case "MOVE": {
          const x = Math.max(0, Math.min(W3, Math.round(a.x)));
          const y = Math.max(0, Math.min(H3, Math.round(a.y)));
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
        case "EJECT":
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
    for (let i = 0; i < bustersPerPlayer; i++) print(lines[i] || `MOVE ${myBase.x} ${myBase.y}`);
    tick++;
  }
})();
