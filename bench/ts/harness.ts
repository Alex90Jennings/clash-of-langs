import { argv, hrtime, stdout } from "node:process";

type LanguageEvent = Record<string, unknown>;

interface Generated<T> {
  input: T;
  hash: number;
  ops: number;
}

interface Challenge<I, W, O> {
  gen(n: number, rng: Rng): Generated<I>;
  prepare(input: I): W;
  run(work: W): O;
  check(out: O): number;
}

interface JsonRecord {
  id: number;
  name: string;
  country: string;
  age: number;
  score: number;
  active: boolean;
  tags: string[];
}

interface JsonOut {
  country: string;
  id: number;
  name: string;
  score2: number;
  tagCount: number;
}

interface UserRecord {
  id: number;
  name: string;
  country: string;
  age: number;
  score: number;
  createdAt: number;
}

interface Group {
  country: string;
  count: number;
  sum: number;
  max: number;
  ageSum: number;
}

interface SearchInput {
  keys: number[];
  queries: number[];
}

interface Phased {
  result: number[];
  phases: number[];
}

const COUNTRIES = ["US", "GB", "DE", "FR", "JP", "BR", "IN", "CN", "CA", "AU", "NO", "SE", "ZA", "NG", "MX", "ES", "IT", "KR", "NL", "PL"] as const;
const LEVELS = ["INFO", "WARN", "ERROR", "DEBUG"] as const;
const RESOURCES = ["users", "orders", "items", "auth", "search"] as const;
const STATUSES = [200, 200, 200, 201, 404, 500] as const;
const TWO32 = 4294967296;

const emit = (event: LanguageEvent): void => {
  stdout.write(JSON.stringify(event) + "\n");
};
emit({ e: "hello", lang: "typescript" });

class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s;
  }

  int(n: number): number {
    return this.next() % n;
  }
}

const fold = (h: number, v: number): number => (Math.imul(h, 31) + v) >>> 0;

const fnv1a = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
};

const hex8 = (h: number): string => (h >>> 0).toString(16).padStart(8, "0");

const foldAll = (values: readonly number[]): number => values.reduce((h, v) => fold(h, v), 0);

const sort: Challenge<number[], number[], number[]> = {
  gen(n, rng) {
    const data = new Array<number>(n);
    let h = 0;
    for (let i = 0; i < n; i++) {
      data[i] = rng.next() & 0x7fffffff;
      h = fold(h, data[i]);
    }
    return { input: data, hash: h, ops: n };
  },
  prepare: (data) => data.slice(),
  run(work) {
    work.sort((a, b) => a - b);
    return work;
  },
  check: foldAll,
};

const json: Challenge<string, string, string> = {
  gen(n, rng) {
    const parts = new Array<string>(n);
    for (let i = 0; i < n; i++) {
      const country = COUNTRIES[rng.int(20)];
      const age = 10 + rng.int(80);
      const score = rng.int(1000);
      const active = (rng.next() & 1) === 1;
      const t1 = rng.int(10);
      const t2 = rng.int(10);
      parts[i] = `{"id":${i},"name":"user_${i}","country":"${country}","age":${age},"score":${score},"active":${active},"tags":["t${t1}","t${t2}"]}`;
    }
    const text = "[" + parts.join(",") + "]";
    return { input: text, hash: fnv1a(text), ops: n };
  },
  prepare: (text) => text,
  run(text) {
    const records = JSON.parse(text) as JsonRecord[];
    const out: JsonOut[] = [];
    for (const r of records) {
      if (r.active && r.score >= 500) {
        out.push({ country: r.country, id: r.id, name: r.name.toUpperCase(), score2: r.score * 2, tagCount: r.tags.length });
      }
    }
    return JSON.stringify(out);
  },
  check: fnv1a,
};

const strings: Challenge<string, string, number[]> = {
  gen(n, rng) {
    const lines = new Array<string>(n);
    for (let i = 0; i < n; i++) {
      const level = LEVELS[rng.int(4)];
      const user = rng.int(1000);
      const res = RESOURCES[rng.int(5)];
      const id = rng.int(10000);
      const status = STATUSES[rng.int(6)];
      const latency = rng.int(2000);
      lines[i] = `ts=${1700000000 + i} level=${level} user=u${user} path=/api/${res}/${id} status=${status} latency=${latency}ms`;
    }
    const text = lines.join("\n");
    return { input: text, hash: fnv1a(text), ops: n };
  },
  prepare: (text) => text,
  run(text) {
    const re = /status=(\d{3}) latency=(\d+)ms/;
    let lines = 0;
    let s5xx = 0;
    let errors = 0;
    let latency = 0;
    let tokens = 0;
    for (const line of text.split("\n")) {
      lines++;
      const m = re.exec(line);
      if (m !== null) {
        if (parseInt(m[1], 10) >= 500) s5xx++;
        latency += parseInt(m[2], 10);
      }
      if (line.includes("level=ERROR")) errors++;
      tokens += line.split(" ").length;
    }
    return [lines, s5xx, errors, latency % TWO32, tokens];
  },
  check: foldAll,
};

const sieve: Challenge<number, number, number[]> = {
  gen: (n) => ({ input: n, hash: n >>> 0, ops: n }),
  prepare: (n) => n,
  run(n) {
    const composite = new Uint8Array(n + 1);
    for (let i = 2; i * i <= n; i++) {
      if (composite[i] === 0) {
        for (let j = i * i; j <= n; j += i) composite[j] = 1;
      }
    }
    let count = 0;
    let sum = 0;
    for (let i = 2; i <= n; i++) {
      if (composite[i] === 0) {
        count++;
        sum = (sum + i) % TWO32;
      }
    }
    return [count, sum];
  },
  check: foldAll,
};

const records: Challenge<UserRecord[], UserRecord[], Group[]> = {
  gen(n, rng) {
    const data = new Array<UserRecord>(n);
    let h = 0;
    for (let i = 0; i < n; i++) {
      const c = rng.int(20);
      const age = 10 + rng.int(80);
      const score = rng.int(1000);
      const createdAt = 1700000000 + rng.int(31536000);
      data[i] = { id: i, name: "user_" + i, country: COUNTRIES[c], age, score, createdAt };
      h = fold(fold(fold(fold(h, c), age), score), createdAt);
    }
    return { input: data, hash: h, ops: n };
  },
  prepare: (data) => data,
  run(data) {
    const cutoff = 1700000000 + 15768000;
    const groups = new Map<string, Group>();
    for (const r of data) {
      if (r.age >= 18 && r.score >= 100 && r.createdAt >= cutoff) {
        let g = groups.get(r.country);
        if (g === undefined) {
          g = { country: r.country, count: 0, sum: 0, max: 0, ageSum: 0 };
          groups.set(r.country, g);
        }
        g.count++;
        g.sum += r.score;
        if (r.score > g.max) g.max = r.score;
        g.ageSum += r.age;
      }
    }
    return [...groups.values()].sort((a, b) => b.sum - a.sum || (a.country < b.country ? -1 : a.country > b.country ? 1 : 0));
  },
  check(groups) {
    let h = 0;
    for (const g of groups) {
      h = fold(h, fnv1a(g.country));
      h = fold(h, g.count);
      h = fold(h, g.sum % TWO32);
      h = fold(h, g.max);
      h = fold(h, g.ageSum % TWO32);
    }
    return h;
  },
};

const search: Challenge<SearchInput, SearchInput, Phased> = {
  gen(n, rng) {
    const keys = new Array<number>(n);
    const queries = new Array<number>(n);
    let h = 0;
    for (let i = 0; i < n; i++) {
      keys[i] = rng.next() & 0x7fffffff;
      h = fold(h, keys[i]);
    }
    for (let i = 0; i < n; i++) {
      queries[i] = (i & 1) === 0 ? keys[rng.int(n)] : rng.next() & 0x7fffffff;
      h = fold(h, queries[i]);
    }
    return { input: { keys, queries }, hash: h, ops: 2 * n };
  },
  prepare: (input) => input,
  run({ keys, queries }) {
    const phases: number[] = [];
    let t = hrtime.bigint();
    const lap = (): void => {
      const now = hrtime.bigint();
      phases.push(Number(now - t));
      t = now;
    };

    const index = new Map<number, number>();
    for (let i = 0; i < keys.length; i++) index.set(keys[i], i);
    lap();

    let hits = 0;
    let sum = 0;
    for (const q of queries) {
      const v = index.get(q);
      if (v !== undefined) {
        hits++;
        sum += v;
      }
    }
    lap();

    const sorted = keys.slice().sort((a, b) => a - b);
    lap();

    let binHits = 0;
    for (const q of queries) {
      let lo = 0;
      let hi = sorted.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (sorted[mid] < q) lo = mid + 1;
        else hi = mid;
      }
      if (lo < sorted.length && sorted[lo] === q) binHits++;
    }
    lap();

    return { result: [hits, sum % TWO32, binHits], phases };
  },
  check: (r) => foldAll(r.result),
};

interface SalesGroup {
  region: string;
  month: number;
  orders: number;
  units: number;
  revenue: number;
}

const REGIONS = ["NA", "EMEA", "APAC", "LATAM", "ANZ", "MEA", "NORDICS", "DACH"] as const;
const pad2 = (v: number): string => (v < 10 ? "0" + v : String(v));

const csv: Challenge<string, string, string> = {
  gen(n, rng) {
    const lines = new Array<string>(n + 1);
    lines[0] = "order_id,date,region,sku,qty,unit_price_cents,discount_pct";
    for (let i = 0; i < n; i++) {
      const month = 1 + rng.int(12);
      const day = 1 + rng.int(28);
      const region = REGIONS[rng.int(8)];
      const sku = rng.int(1000);
      const qty = 1 + rng.int(20);
      const price = 99 + rng.int(99901);
      const discount = 5 * rng.int(5);
      lines[i + 1] = `${i},2026-${pad2(month)}-${pad2(day)},${region},SKU-${sku},${qty},${price},${discount}`;
    }
    const text = lines.join("\n");
    return { input: text, hash: fnv1a(text), ops: n };
  },
  prepare: (text) => text,
  run(text) {
    const lines = text.split("\n");
    const groups = new Map<string, SalesGroup>();
    for (let i = 1; i < lines.length; i++) {
      const f = lines[i].split(",");
      const month = parseInt(f[1].slice(5, 7), 10);
      const qty = parseInt(f[4], 10);
      const revenue = Math.floor((qty * parseInt(f[5], 10) * (100 - parseInt(f[6], 10))) / 100);
      const key = f[2] + "|" + month;
      let g = groups.get(key);
      if (g === undefined) {
        g = { region: f[2], month, orders: 0, units: 0, revenue: 0 };
        groups.set(key, g);
      }
      g.orders++;
      g.units += qty;
      g.revenue += revenue;
    }
    const rows = [...groups.values()].sort((a, b) => (a.region < b.region ? -1 : a.region > b.region ? 1 : a.month - b.month));
    const out = ["region,month,orders,units,revenue_cents"];
    for (const g of rows) out.push(`${g.region},2026-${pad2(g.month)},${g.orders},${g.units},${g.revenue}`);
    return out.join("\n");
  },
  check: fnv1a,
};

const metrics: Challenge<number[], number[], number[]> = {
  gen(n, rng) {
    const values = new Array<number>(n);
    let h = 0;
    for (let i = 0; i < n; i++) {
      let v = 20 + rng.int(80);
      if (rng.int(100) < 3) v += 200 + rng.int(800);
      values[i] = v;
      h = fold(h, v);
    }
    return { input: values, hash: h, ops: n };
  },
  prepare: (values) => values,
  run(values) {
    const n = values.length;
    let window = 0;
    let slow = 0;
    let peak = 0;
    let total = 0;
    for (let i = 0; i < n; i++) {
      window += values[i];
      total += values[i];
      if (i >= 60) window -= values[i - 60];
      if (i >= 59) {
        if (window > 7200) slow++;
        if (window > peak) peak = window;
      }
    }
    let buckets = 0;
    for (let start = 0; start < n; start += 60) {
      let max = 0;
      for (let i = start; i < Math.min(start + 60, n); i++) if (values[i] > max) max = values[i];
      buckets = fold(buckets, max);
    }
    const sorted = values.slice().sort((a, b) => a - b);
    const rank = (p: number): number => sorted[Math.floor((p * n + 99) / 100) - 1];
    const meanMilli = Math.floor((total * 1000) / n);
    return [slow, peak, buckets, rank(50), rank(95), rank(99), sorted[n - 1], meanMilli % TWO32];
  },
  check: foldAll,
};

interface Mlp {
  w1: Int32Array;
  b1: Int32Array;
  w2: Int32Array;
  b2: Int32Array;
  w3: Int32Array;
  b3: Int32Array;
  x: Int32Array;
  n: number;
}

const NN_IN = 64;
const NN_H = 64;
const NN_OUT = 10;

const infer: Challenge<Mlp, Mlp, number[]> = {
  gen(n, rng) {
    let h = 0;
    const draw = (count: number, k: number, offset: number): Int32Array => {
      const out = new Int32Array(count);
      for (let i = 0; i < count; i++) {
        const raw = rng.int(k);
        h = fold(h, raw);
        out[i] = raw - offset;
      }
      return out;
    };
    const w1 = draw(NN_H * NN_IN, 255, 127);
    const b1 = draw(NN_H, 2001, 1000);
    const w2 = draw(NN_H * NN_H, 255, 127);
    const b2 = draw(NN_H, 2001, 1000);
    const w3 = draw(NN_OUT * NN_H, 255, 127);
    const b3 = draw(NN_OUT, 2001, 1000);
    const x = draw(n * NN_IN, 256, 128);
    return { input: { w1, b1, w2, b2, w3, b3, x, n }, hash: h, ops: n };
  },
  prepare: (m) => m,
  run({ w1, b1, w2, b2, w3, b3, x, n }) {
    const h1 = new Int32Array(NN_H);
    const h2 = new Int32Array(NN_H);
    const logits = new Int32Array(NN_OUT);
    const dense = (w: Int32Array, b: Int32Array, input: Int32Array, inOff: number, inLen: number, out: Int32Array): void => {
      for (let j = 0; j < out.length; j++) {
        let a = b[j];
        const row = j * inLen;
        for (let k = 0; k < inLen; k++) a += w[row + k] * input[inOff + k];
        out[j] = a;
      }
    };
    let preds = 0;
    let conf = 0;
    for (let s = 0; s < n; s++) {
      dense(w1, b1, x, s * NN_IN, NN_IN, h1);
      for (let j = 0; j < NN_H; j++) h1[j] = Math.min(127, Math.max(0, h1[j]) >> 10);
      dense(w2, b2, h1, 0, NN_H, h2);
      for (let j = 0; j < NN_H; j++) h2[j] = Math.min(127, Math.max(0, h2[j]) >> 10);
      dense(w3, b3, h2, 0, NN_H, logits);
      let pred = 0;
      for (let o = 1; o < NN_OUT; o++) if (logits[o] > logits[pred]) pred = o;
      preds = fold(preds, pred);
      conf = (conf + logits[pred] + 4194304) % TWO32;
    }
    return [preds, conf];
  },
  check: foldAll,
};

interface Corpus {
  docs: Int32Array;
  queries: Int32Array;
  n: number;
}

const EMB_D = 64;
const EMB_Q = 8;
const EMB_K = 10;

const embed: Challenge<Corpus, Corpus, number[]> = {
  gen(n, rng) {
    let h = 0;
    const draw = (count: number): Int32Array => {
      const out = new Int32Array(count);
      for (let i = 0; i < count; i++) {
        const raw = rng.int(256);
        h = fold(h, raw);
        out[i] = raw - 128;
      }
      return out;
    };
    const docs = draw(n * EMB_D);
    const queries = draw(EMB_Q * EMB_D);
    return { input: { docs, queries, n }, hash: h, ops: n * EMB_Q };
  },
  prepare: (x) => x,
  run({ docs, queries, n }) {
    const results: number[] = [];
    const scores = new Int32Array(n);
    const order = new Array<number>(n);
    for (let q = 0; q < EMB_Q; q++) {
      const qo = q * EMB_D;
      for (let d = 0; d < n; d++) {
        const dOff = d * EMB_D;
        let s = 0;
        for (let k = 0; k < EMB_D; k++) s += docs[dOff + k] * queries[qo + k];
        scores[d] = s;
        order[d] = d;
      }
      order.sort((a, b) => scores[b] - scores[a] || a - b);
      for (let r = 0; r < EMB_K; r++) results.push(order[r], scores[order[r]] + 2097152);
    }
    return results;
  },
  check: foldAll,
};

interface Image {
  rgb: Uint8Array;
  n: number;
}

const pixel: Challenge<Image, Image, Phased> = {
  gen(n, rng) {
    const rgb = new Uint8Array(n * n * 3);
    let h = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const p = (y * n + x) * 3;
        rgb[p] = (x + y + rng.int(64)) % 256;
        rgb[p + 1] = (2 * x + rng.int(64)) % 256;
        rgb[p + 2] = (2 * y + rng.int(64)) % 256;
        h = fold(fold(fold(h, rgb[p]), rgb[p + 1]), rgb[p + 2]);
      }
    }
    return { input: { rgb, n }, hash: h, ops: n * n };
  },
  prepare: (x) => x,
  run({ rgb, n }) {
    const phases: number[] = [];
    let t = hrtime.bigint();
    const lap = (): void => {
      const now = hrtime.bigint();
      phases.push(Number(now - t));
      t = now;
    };
    const cl = (v: number): number => (v < 0 ? 0 : v >= n ? n - 1 : v);

    const gray = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) gray[i] = (77 * rgb[i * 3] + 150 * rgb[i * 3 + 1] + 29 * rgb[i * 3 + 2]) >> 8;
    lap();

    const blur = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) {
      const ru = cl(y - 1) * n;
      const r0 = y * n;
      const rd = cl(y + 1) * n;
      for (let x = 0; x < n; x++) {
        const xl = cl(x - 1);
        const xr = cl(x + 1);
        const s = gray[ru + xl] + 2 * gray[ru + x] + gray[ru + xr] + 2 * gray[r0 + xl] + 4 * gray[r0 + x] + 2 * gray[r0 + xr] + gray[rd + xl] + 2 * gray[rd + x] + gray[rd + xr];
        blur[r0 + x] = s >> 4;
      }
    }
    lap();

    const mag = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) {
      const ru = cl(y - 1) * n;
      const r0 = y * n;
      const rd = cl(y + 1) * n;
      for (let x = 0; x < n; x++) {
        const xl = cl(x - 1);
        const xr = cl(x + 1);
        const gx = blur[ru + xr] + 2 * blur[r0 + xr] + blur[rd + xr] - (blur[ru + xl] + 2 * blur[r0 + xl] + blur[rd + xl]);
        const gy = blur[rd + xl] + 2 * blur[rd + x] + blur[rd + xr] - (blur[ru + xl] + 2 * blur[ru + x] + blur[ru + xr]);
        const m = Math.abs(gx) + Math.abs(gy);
        mag[r0 + x] = m > 255 ? 255 : m;
      }
    }
    lap();

    const hist = new Array<number>(256).fill(0);
    let edges = 0;
    for (let i = 0; i < n * n; i++) {
      hist[mag[i]]++;
      if (mag[i] >= 128) edges++;
    }
    lap();

    return { result: [...hist, edges], phases };
  },
  check: (r) => foldAll(r.result),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const challenges: Record<string, Challenge<any, any, any>> = { sort, json, strings, sieve, records, search, csv, metrics, infer, embed, pixel };

function main(): void {
  const [, , name, sizeArg, seedArg, warmupArg, runsArg] = argv;
  const c = challenges[name];
  if (!c) throw new Error(`unknown challenge: ${name}`);
  const size = parseInt(sizeArg, 10);
  const warmup = parseInt(warmupArg, 10);
  const runs = parseInt(runsArg, 10);

  const g0 = hrtime.bigint();
  const { input, hash, ops } = c.gen(size, new Rng(parseInt(seedArg, 10)));
  emit({ e: "ready", genNs: Number(hrtime.bigint() - g0), input: hex8(hash), ops });

  for (let i = 0; i < warmup + runs; i++) {
    const work = c.prepare(input);
    const t0 = hrtime.bigint();
    const out = c.run(work);
    const ns = Number(hrtime.bigint() - t0);
    const warm = i < warmup;
    const event: LanguageEvent = { e: warm ? "warmup" : "run", i: warm ? i : i - warmup, ns, check: hex8(c.check(out)) };
    if (out && typeof out === "object" && "phases" in out) event.phases = (out as Phased).phases;
    emit(event);
  }
  emit({ e: "done" });
}

try {
  main();
} catch (err) {
  emit({ e: "error", msg: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
}
