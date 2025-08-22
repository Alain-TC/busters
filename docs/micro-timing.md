# Micro timing

Instrumentation was added to `twoTurnContestDelta` and callers in `hybrid-bot` to measure micro-simulation cost.

- `MICRO_BUDGET_MS` (0.5 ms) caps time spent per `act` on two-turn lookahead.
- When the budget is exceeded, further low-impact micro calls are skipped via `microOverBudget()` checks.
- Set `MICRO_TIMING=1` to log per-call timings during matches.

## Sample results
Running a representative match:

```bash
MICRO_TIMING=1 pnpm sim sim @busters/agents/hybrid @busters/agents/stunner --episodes 1 --seed 3
```

Produced average `twoTurnContestDelta` time of ~0.013 ms per invocation with a maximum of 0.063 ms. No calls exceeded the 0.5 ms budget, so skipping was not triggered in this run.
