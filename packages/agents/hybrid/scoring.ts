import {
  estimateInterceptPoint,
  duelStunDelta,
  contestedBustDelta,
  releaseBlockDelta,
  twoTurnContestDelta,
  ejectDelta,
  interceptDelta,
  twoTurnInterceptDelta,
  twoTurnEjectDelta,
  scoreCandidate,
  resetMicroPerf,
  microPerf,
  microOverBudget,
} from "../micro";

export {
  estimateInterceptPoint,
  duelStunDelta,
  contestedBustDelta,
  releaseBlockDelta,
  twoTurnContestDelta,
  ejectDelta,
  interceptDelta,
  twoTurnInterceptDelta,
  twoTurnEjectDelta,
  scoreCandidate,
  resetMicroPerf,
  microPerf,
  microOverBudget,
};

export const micro = (fn: () => number) => (microOverBudget() ? 0 : fn());
