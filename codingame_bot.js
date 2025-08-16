// Auto-generated Codingame bot using an evolved genome (no deps).
const GENOME={radarTurn:1,stunRange:,releaseDist:};
const WIDTH=16001, HEIGHT=9001, BASE0={x:0,y:0}, BASE1={x:16000,y:9000};
const BUST_MIN=900, BUST_MAX=1760, STUN_CD_TURNS=20;
const bustersPerPlayer=parseInt(readline(),10);
const ghostCount=parseInt(readline(),10);
const myTeamId=parseInt(readline(),10);
const MY_BASE=myTeamId===0?BASE0:BASE1;
let tick=0; const stunCd=new Map(), radarUsed=new Map();
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
while(true){
  tick++; for(const[k,v]of stunCd) if(v>0) stunCd.set(k,v-1);
  const entities=parseInt(readline(),10);
  const my=[], enemies=[], ghosts=[];
  for(let i=0;i<entities;i++){
    const p=readline().split(' ');
    const obj={id:+p[0],x:+p[1],y:+p[2],entityType:+p[3],state:+p[4],value:+p[5]};
    if(obj.entityType===-1) ghosts.push({id:obj.id,x:obj.x,y:obj.y,stamina:obj.state,attackers:obj.value});
    else if(obj.entityType===myTeamId) my.push(obj); else enemies.push(obj);
  }
  my.sort((a,b)=>a.id-b.id);
  const actions=[];
  for(const me of my){
    if(!stunCd.has(me.id)) stunCd.set(me.id,0);
    if(!radarUsed.has(me.id)) radarUsed.set(me.id,false);
    const dBase=dist(me,MY_BASE);
    const ne=enemies.map(e=>({e,d:dist(me,e)})).sort((a,b)=>a.d-b.d)[0];
    const ng=ghosts.map(g=>({g,d:dist(me,g)})).sort((a,b)=>a.d-b.d)[0];
    if(me.state===1){
      if(dBase<=GENOME.releaseDist){ actions.push('RELEASE'); continue; }
      actions.push(`MOVE ${MY_BASE.x} ${MY_BASE.y}`); continue;
    }
    if(ne && ne.d<=GENOME.stunRange && stunCd.get(me.id)<=0){
      actions.push(`STUN ${ne.e.id}`); stunCd.set(me.id,STUN_CD_TURNS); continue;
    }
    if(ng){
      if(ng.d>=BUST_MIN && ng.d<=BUST_MAX){ actions.push(`BUST ${ng.g.id}`); continue; }
      actions.push(`MOVE ${ng.g.x} ${ng.g.y}`); continue;
    }
    if(!radarUsed.get(me.id) && tick>=GENOME.radarTurn){ actions.push('RADAR'); radarUsed.set(me.id,true); continue; }
    actions.push(`MOVE ${MY_BASE.x} ${MY_BASE.y}`);
  }
  for(const a of actions) console.log(a);
}
