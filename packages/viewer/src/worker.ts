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
