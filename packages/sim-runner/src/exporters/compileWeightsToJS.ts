import { vecToWeights } from "../genomes/weightsGenome";

/** Create a Codingame-compatible single-file bot from hybrid-bot + best weights. */
export function compileWeightsToSingleFile(bestVec: number[], jsOutPath: string){
  const w = vecToWeights(bestVec);
  const src = `/** Auto-generated hybrid CG bot (EVOL2) */
export const meta = { name: "HybridEvol2", version: "ga" };
const W = ${JSON.stringify(w)};
function D(ax,ay,bx,by){return Math.hypot(ax-bx,ay-by)}
function R(self, ghost){
  const dx=ghost.x-self.x, dy=ghost.y-self.y;
  const d=Math.hypot(dx,dy)||1e-6;
  const target=Math.max(W.bustMin, Math.min(d, W.bustMax));
  const ratio=(d-(d-target))/d;
  return { type:"MOVE", x: self.x + dx*ratio, y: self.y + dy*ratio };
}
export function act(ctx, obs){
  const me=obs.self;
  if (me.carrying !== undefined){
    const d=D(me.x,me.y,ctx.myBase.x,ctx.myBase.y);
    if (d <= W.releaseDist) return { type:"RELEASE" };
    return { type:"MOVE", x: ctx.myBase.x, y: ctx.myBase.y };
  }
  const e0 = (obs.enemies&&obs.enemies.find(e=> e.carrying !== undefined)) || (obs.enemies && obs.enemies[0]);
  if (e0 && e0.range <= W.stunRange && me.stunCd <= 0) return { type:"STUN", busterId:e0.id };
  const g0 = obs.ghostsVisible && obs.ghostsVisible[0];
  if (g0){
    if (g0.range >= W.bustMin && g0.range <= W.bustMax) return { type:"BUST", ghostId:g0.id };
    return R(me, g0);
  }
  if (!me.radarUsed && obs.tick >= W.radarEarlyTurn && obs.tick < W.radarMidTurn) return { type:"RADAR" };
  if (!me.radarUsed && obs.tick >= W.radarMidTurn) return { type:"RADAR" };
  const tx=(ctx.myBase.x+ctx.enemyBase.x)/2, ty=(ctx.myBase.y+ctx.enemyBase.y)/2;
  return { type:"MOVE", x:tx, y:ty };
}
`;
  require("fs").writeFileSync(jsOutPath, src, "utf8");
}
