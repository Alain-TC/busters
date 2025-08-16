set -euo pipefail
ROOT="$(pwd)"

# 1) Patch the viewer worker to support "loadReplay"
cat > packages/viewer/src/worker.ts <<'TS'
type Frame = {
  tick: number;
  width: number; height: number;
  scores?: Record<number, number>;
  busters: any[]; ghosts: any[];
};

let playing = false;
let timer: any = null;

self.onmessage = async (e: MessageEvent) => {
  const { kind, url, run } = (e.data || {}) as any;

  if (kind === 'loadReplay' && url) {
    try {
      const res = await fetch(url);
      const data = await res.json();
      const frames: Frame[] =
        Array.isArray(data) ? data :
        (data.frames ?? data.payload?.frames ?? []);

      if (!frames?.length) {
        postMessage({ kind: 'error', message: 'Replay has no frames' });
        return;
      }

      clearInterval(timer);
      playing = true;
      let i = 0;

      // ~30 FPS playback
      timer = setInterval(() => {
        if (!playing) return;
        if (i >= frames.length) { clearInterval(timer); playing = false; return; }

        const f = frames[i++];
        // Fill safe defaults if missing
        (f as any).width  ??= 16001;
        (f as any).height ??= 9001;
        f.scores ??= { 0: 0, 1: 0 };

        postMessage({ kind: 'frame', payload: f });
      }, 33);
    } catch (err: any) {
      postMessage({ kind: 'error', message: String(err?.message ?? err) });
    }
  } else if (kind === 'toggle') {
    playing = run ?? !playing;
  } else if (kind === 'reset') {
    clearInterval(timer);
    playing = false;
  }
};
export {};
TS

# 2) Patch the main React file to send the worker a replay URL from ?replay=
#    (keeps your existing UI, just injects the loader)
#    We won’t rewrite your whole file; we add a small bootstrap after worker creation.
perl -0777 -pe '
  s|(const w = new Worker\(new URL\('\''\./worker\.ts'\'', import\.meta\.url\), \{ type: '\''module'\'' \}\);\s*workerRef\.current = w;)|$1\n\n    // Auto-load replay from ?replay=/replays/xxx.json\n    try {\n      const qp = new URLSearchParams(window.location.search);\n      const replayUrl = qp.get(\"replay\");\n      if (replayUrl) {\n        w.postMessage({ kind: \"loadReplay\", url: replayUrl });\n      }\n    } catch {}\n|s
' -i packages/viewer/src/main.tsx

echo '✅ Replay support enabled. Use: http://localhost:5173/?replay=/replays/<file>.json'
