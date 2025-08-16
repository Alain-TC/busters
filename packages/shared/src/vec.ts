export function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
export function dist2(ax: number, ay: number, bx: number, by: number) { const dx = ax - bx, dy = ay - by; return dx*dx + dy*dy; }
export function dist(ax: number, ay: number, bx: number, by: number) { return Math.hypot(ax - bx, ay - by); }
export function norm(dx: number, dy: number) { const d = Math.hypot(dx, dy) || 1; return [dx / d, dy / d] as const; }
export function roundi(n: number) { return Math.round(n); }
