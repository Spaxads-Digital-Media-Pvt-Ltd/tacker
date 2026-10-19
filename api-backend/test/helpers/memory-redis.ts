/**
 * A tiny in-memory Redis for limiter unit tests — the commands the limiters use (GET, SET with EX / NX,
 * INCR, EXPIRE, TTL, DEL, MGET and a pipeline of them), with expiry on the real (or faked) clock, so a
 * test checks what is actually counted instead of replaying canned pipeline results.
 */
type Value = { v: string; exp: number | null };

export function memoryRedis() {
  const store = new Map<string, Value>();
  const now = () => Date.now();
  const live = (k: string): Value | undefined => {
    const e = store.get(k);
    if (e && e.exp !== null && e.exp <= now()) { store.delete(k); return undefined; }
    return e;
  };
  const cmd = {
    async get(k: string) { return live(k)?.v ?? null; },
    async mget(...keys: string[]) { return keys.flat().map((k) => live(k)?.v ?? null); },
    async set(k: string, v: string, ...args: (string | number)[]) {
      const flags = args.map((a) => String(a).toUpperCase());
      if (flags.includes('NX') && live(k)) return null;
      const ex = flags.indexOf('EX');
      store.set(k, { v: String(v), exp: ex >= 0 ? now() + Number(args[ex + 1]) * 1000 : null });
      return 'OK';
    },
    async incr(k: string) {
      const e = live(k);
      const n = Number(e?.v ?? 0) + 1;
      store.set(k, { v: String(n), exp: e?.exp ?? null });
      return n;
    },
    async expire(k: string, seconds: number) {
      const e = live(k);
      if (!e) return 0;
      e.exp = now() + seconds * 1000;
      return 1;
    },
    async ttl(k: string) {
      const e = live(k);
      if (!e) return -2;
      return e.exp === null ? -1 : Math.ceil((e.exp - now()) / 1000);
    },
    async del(...keys: string[]) {
      let n = 0;
      for (const k of keys.flat()) if (store.delete(k)) n++;
      return n;
    },
  };
  const pipeline = () => {
    const queued: (() => Promise<unknown>)[] = [];
    const p = {
      get: (k: string) => { queued.push(() => cmd.get(k)); return p; },
      set: (k: string, v: string, ...a: (string | number)[]) => { queued.push(() => cmd.set(k, v, ...a)); return p; },
      incr: (k: string) => { queued.push(() => cmd.incr(k)); return p; },
      expire: (k: string, s: number) => { queued.push(() => cmd.expire(k, s)); return p; },
      del: (...k: string[]) => { queued.push(() => cmd.del(...k)); return p; },
      exec: async () => { const out: [Error | null, unknown][] = []; for (const q of queued) out.push([null, await q()]); return out; },
    };
    return p;
  };
  return { ...cmd, pipeline, keys: () => [...store.keys()].filter((k) => live(k)), store };
}

export type MemoryRedis = ReturnType<typeof memoryRedis>;
