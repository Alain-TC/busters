# --- fix_busters_workspace.sh ---
set -euo pipefail

# 0) Ensure pnpm is available (Volta users)
command -v pnpm >/dev/null 2>&1 || { echo "Installing pnpm via Volta..."; volta install pnpm || npm i -g pnpm; }

# 1) Workspace file for pnpm
[ -f pnpm-workspace.yaml ] || printf 'packages:\n  - "packages/*"\n' > pnpm-workspace.yaml
echo "✔ pnpm-workspace.yaml ready"

# 2) Patch package.json files to use workspace protocol
apply_pkg () { dest="$1"; shift; cat > "$dest" <<'JSON'
{
  "name": "@busters/engine",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@busters/shared": "workspace:*"
  }
}
JSON
}

# engine
cat > packages/engine/package.json <<'JSON'
{
  "name": "@busters/engine",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@busters/shared": "workspace:*"
  }
}
JSON

# viewer
cat > packages/viewer/package.json <<'JSON'
{
  "name": "@busters/viewer",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@busters/engine": "workspace:*",
    "@busters/shared": "workspace:*",
    "@busters/agents": "workspace:*"
  },
  "devDependencies": {
    "vite": "^5.4.2",
    "@vitejs/plugin-react": "^4.3.1",
    "@types/react": "^18.2.66",
    "@types/react-dom": "^18.2.22"
  },
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
JSON

# sim-runner
cat > packages/sim-runner/package.json <<'JSON'
{
  "name": "@busters/sim-runner",
  "version": "0.1.0",
  "type": "module",
  "main": "src/cli.ts",
  "bin": { "busters-sim": "src/cli.ts" },
  "dependencies": {
    "@busters/engine": "workspace:*",
    "@busters/shared": "workspace:*"
  },
  "devDependencies": {
    "tsx": "^4.16.2"
  },
  "scripts": {
    "start": "tsx src/cli.ts"
  }
}
JSON

# evolve
cat > packages/evolve/package.json <<'JSON'
{
  "name": "@busters/evolve",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "@busters/sim-runner": "workspace:*",
    "@busters/shared": "workspace:*"
  },
  "devDependencies": {
    "tsx": "^4.16.2"
  },
  "scripts": {
    "start": "tsx src/train.ts"
  }
}
JSON

# agents (no internal deps to fix)
cat > packages/agents/package.json <<'JSON'
{
  "name": "@busters/agents",
  "version": "0.1.0",
  "type": "module",
  "main": "random-bot.js",
  "exports": {
    "./random": "./random-bot.js",
    "./greedy": "./greedy-buster.js"
  }
}
JSON

echo "✔ Patched package.json files to use workspace:*"

# 3) Clean and install
rm -rf node_modules packages/*/node_modules pnpm-lock.yaml
pnpm install

# 4) (re)ensure plugin present (noop if already there)
pnpm -C packages/viewer add -D @vitejs/plugin-react@^4.3.1

# 5) Done. Helpful commands:
echo
echo "Now run:"
echo "  pnpm dev   # launch the React viewer"
echo "  pnpm sim   # headless match"
echo "  pnpm train # toy GA"

