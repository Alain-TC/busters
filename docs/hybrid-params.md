# Hybrid Parameter Tuning

The bot's tactical thresholds and task weights live in [`packages/agents/hybrid-params.ts`](../packages/agents/hybrid-params.ts). These numbers are not hand-picked; they are evolved offline with **CMA-ES** (Covariance Matrix Adaptation Evolution Strategy).

## How CMA-ES updates the values
1. The trainer samples a population of parameter sets around the current mean.
2. Each set is evaluated by running batches of games against a pool of opponents.
3. Scores from these games update the CMA-ES mean and covariance, biasing future samples toward better-performing regions.
4. After each generation, the best set is written back to `hybrid-params.ts`, overwriting the previous constants.

The file can thus be considered a snapshot of the latest successful evolution run. Training scripts may overwrite it, but the field names and structure remain stable so imports elsewhere continue to compile.
