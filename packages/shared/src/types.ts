export type TeamId = 0 | 1;

export enum BusterState {
  Idle = 0,
  Carrying = 1,
  Stunned = 2,
  Busting = 3,
}

export type Action =
  | { type: 'MOVE'; x: number; y: number }
  | { type: 'BUST'; ghostId: number }
  | { type: 'RELEASE' }
  | { type: 'STUN'; busterId: number }
  | { type: 'RADAR' }
  | { type: 'EJECT'; x: number; y: number }
  | { type: 'WAIT' };

export type BusterPublicState = {
  id: number;
  teamId: TeamId;
  x: number;
  y: number;
  state: BusterState;
  value: number; // ghostId if carrying, or stun ticks remaining if stunned, or target ghost id when busting
  stunCd: number; // cooldown until can stun again
  radarUsed: boolean;
};

export type GhostState = {
  id: number;
  x: number;
  y: number;
  endurance: number; // state for ghosts
  engagedBy: number; // number of busters attempting to capture this tick (for UI)
};

export type GameState = {
  seed: number;
  tick: number;
  width: number;
  height: number;
  bustersPerPlayer: number;
  ghostCount: number;
  scores: Record<TeamId, number>;
  busters: BusterPublicState[]; // both teams
  ghosts: GhostState[]; // ghosts still on map (not scored)
  radarNextVision: Record<number, boolean>; // busterId -> true if radar effect active for next turn
  lastSeenTickForGhost: Record<number, number>; // ghostId -> last tick any buster detected (for flee timing)
  lastSeenByGhost: Record<number, Array<{ x: number; y: number }>>; // ghostId -> positions of busters that last spotted it
};

export type Observation = {
  tick: number;
  self: {
    id: number;
    x: number;
    y: number;
    stunnedFor: number;
    carrying?: number;
    stunCd: number;
    radarUsed: boolean;
  };
  myBase: { x: number; y: number };
  ghostsVisible: Array<{ id: number; x: number; y: number; range: number; endurance: number }>;
  allies: Array<{ id: number; x: number; y: number; range: number; stunnedFor: number; carrying?: number }>;
  enemies: Array<{ id: number; x: number; y: number; range: number; stunnedFor: number; carrying?: number }>;
};

export type AgentContext = { teamId: TeamId; mapW: number; mapH: number; myBase: { x: number; y: number }; rng?: () => number };
