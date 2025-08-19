# Writing a JS Bot
Export two things:
- `act(ctx, obs)` → returns an Action object.
- `meta` → { name, version }.

Use `pnpm dev` to run the viewer and load your bot modules for each team.

### Enemy memory pruning

`HybridState` remembers where enemies were last seen. To avoid stale data, entries
older than `enemyMaxAge` ticks (default **40**) are discarded. The threshold can
be tuned by passing a different value when constructing `HybridState` or by
calling `state.pruneEnemies(currentTick, maxAge)` manually.
