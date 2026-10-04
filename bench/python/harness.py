import sys
import json
import re
from bisect import bisect_left
from itertools import compress
from math import isqrt
from time import perf_counter_ns


def emit(obj):
    sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
    sys.stdout.flush()


emit({"e": "hello", "lang": "python"})

M = 0xFFFFFFFF
COUNTRIES = ["US", "GB", "DE", "FR", "JP", "BR", "IN", "CN", "CA", "AU", "NO", "SE", "ZA", "NG", "MX", "ES", "IT", "KR", "NL", "PL"]
LEVELS = ["INFO", "WARN", "ERROR", "DEBUG"]
RESOURCES = ["users", "orders", "items", "auth", "search"]
STATUSES = [200, 200, 200, 201, 404, 500]


class Rng:
    __slots__ = ("s",)

    def __init__(self, seed):
        self.s = (seed & M) or 0x9E3779B9

    def next(self):
        x = self.s
        x ^= (x << 13) & M
        x ^= x >> 17
        x ^= (x << 5) & M
        self.s = x
        return x

    def int(self, n):
        return self.next() % n


def fold(h, v):
    return (h * 31 + v) & M


def fnv1a(s):
    h = 0x811C9DC5
    for b in s.encode("ascii"):
        h = ((h ^ b) * 0x01000193) & M
    return h


def hex8(h):
    return f"{h & M:08x}"


def sort_gen(n, rng):
    data = [rng.next() & 0x7FFFFFFF for _ in range(n)]
    h = 0
    for v in data:
        h = fold(h, v)
    return data, h, n


def sort_run(work):
    work.sort()
    return work


def sort_check(sorted_data):
    h = 0
    for v in sorted_data:
        h = fold(h, v)
    return h


def json_gen(n, rng):
    parts = []
    for i in range(n):
        country = COUNTRIES[rng.int(20)]
        age = 10 + rng.int(80)
        score = rng.int(1000)
        active = "true" if (rng.next() & 1) == 1 else "false"
        t1 = rng.int(10)
        t2 = rng.int(10)
        parts.append(
            f'{{"id":{i},"name":"user_{i}","country":"{country}","age":{age},"score":{score},'
            f'"active":{active},"tags":["t{t1}","t{t2}"]}}'
        )
    text = "[" + ",".join(parts) + "]"
    return text, fnv1a(text), n


def json_run(text):
    records = json.loads(text)
    out = [
        {"country": r["country"], "id": r["id"], "name": r["name"].upper(), "score2": r["score"] * 2, "tagCount": len(r["tags"])}
        for r in records
        if r["active"] and r["score"] >= 500
    ]
    return json.dumps(out, separators=(",", ":"))


def strings_gen(n, rng):
    lines = []
    for i in range(n):
        level = LEVELS[rng.int(4)]
        user = rng.int(1000)
        res = RESOURCES[rng.int(5)]
        rid = rng.int(10000)
        status = STATUSES[rng.int(6)]
        latency = rng.int(2000)
        lines.append(f"ts={1700000000 + i} level={level} user=u{user} path=/api/{res}/{rid} status={status} latency={latency}ms")
    text = "\n".join(lines)
    return text, fnv1a(text), n


def strings_run(text):
    pattern = re.compile(r"status=(\d{3}) latency=(\d+)ms")
    lines = s5xx = errors = latency = tokens = 0
    for line in text.split("\n"):
        lines += 1
        m = pattern.search(line)
        if m is not None:
            if int(m.group(1)) >= 500:
                s5xx += 1
            latency += int(m.group(2))
        if "level=ERROR" in line:
            errors += 1
        tokens += len(line.split(" "))
    return [lines, s5xx, errors, latency & M, tokens]


def fold_list(values):
    h = 0
    for v in values:
        h = fold(h, v)
    return h


def sieve_run(n):
    is_prime = bytearray([1]) * (n + 1)
    is_prime[0] = is_prime[1] = 0
    for i in range(2, isqrt(n) + 1):
        if is_prime[i]:
            is_prime[i * i :: i] = bytes(len(range(i * i, n + 1, i)))
    primes = list(compress(range(n + 1), is_prime))
    return [len(primes), sum(primes) & M]


def records_gen(n, rng):
    records = []
    h = 0
    for i in range(n):
        c = rng.int(20)
        age = 10 + rng.int(80)
        score = rng.int(1000)
        created_at = 1700000000 + rng.int(31536000)
        records.append({"id": i, "name": f"user_{i}", "country": COUNTRIES[c], "age": age, "score": score, "createdAt": created_at})
        h = fold(fold(fold(fold(h, c), age), score), created_at)
    return records, h, n


def records_run(records):
    cutoff = 1700000000 + 15768000
    groups = {}
    for r in records:
        if r["age"] >= 18 and r["score"] >= 100 and r["createdAt"] >= cutoff:
            g = groups.get(r["country"])
            if g is None:
                g = groups[r["country"]] = {"country": r["country"], "count": 0, "sum": 0, "max": 0, "ageSum": 0}
            g["count"] += 1
            g["sum"] += r["score"]
            if r["score"] > g["max"]:
                g["max"] = r["score"]
            g["ageSum"] += r["age"]
    return sorted(groups.values(), key=lambda g: (-g["sum"], g["country"]))


def records_check(groups):
    h = 0
    for g in groups:
        h = fold(h, fnv1a(g["country"]))
        h = fold(h, g["count"])
        h = fold(h, g["sum"] & M)
        h = fold(h, g["max"])
        h = fold(h, g["ageSum"] & M)
    return h


def search_gen(n, rng):
    keys = [rng.next() & 0x7FFFFFFF for _ in range(n)]
    queries = [keys[rng.int(n)] if (i & 1) == 0 else rng.next() & 0x7FFFFFFF for i in range(n)]
    return (keys, queries), fold_list(keys + queries), 2 * n


def search_run(data):
    keys, queries = data
    phases = []
    t = perf_counter_ns()

    def lap():
        nonlocal t
        now = perf_counter_ns()
        phases.append(now - t)
        t = now

    index = {}
    for i, k in enumerate(keys):
        index[k] = i
    lap()

    hits = total = 0
    for q in queries:
        v = index.get(q)
        if v is not None:
            hits += 1
            total += v
    lap()

    sorted_keys = sorted(keys)
    lap()

    bin_hits = 0
    size = len(sorted_keys)
    for q in queries:
        i = bisect_left(sorted_keys, q)
        if i < size and sorted_keys[i] == q:
            bin_hits += 1
    lap()

    return {"result": [hits, total & M, bin_hits], "phases": phases}


REGIONS = ["NA", "EMEA", "APAC", "LATAM", "ANZ", "MEA", "NORDICS", "DACH"]


def csv_gen(n, rng):
    lines = ["order_id,date,region,sku,qty,unit_price_cents,discount_pct"]
    for i in range(n):
        month = 1 + rng.int(12)
        day = 1 + rng.int(28)
        region = REGIONS[rng.int(8)]
        sku = rng.int(1000)
        qty = 1 + rng.int(20)
        price = 99 + rng.int(99901)
        discount = 5 * rng.int(5)
        lines.append(f"{i},2026-{month:02d}-{day:02d},{region},SKU-{sku},{qty},{price},{discount}")
    text = "\n".join(lines)
    return text, fnv1a(text), n


def csv_run(text):
    groups = {}
    for line in text.split("\n")[1:]:
        f = line.split(",")
        month = int(f[1][5:7])
        qty = int(f[4])
        revenue = qty * int(f[5]) * (100 - int(f[6])) // 100
        key = (f[2], month)
        g = groups.get(key)
        if g is None:
            g = groups[key] = [0, 0, 0]
        g[0] += 1
        g[1] += qty
        g[2] += revenue
    out = ["region,month,orders,units,revenue_cents"]
    for (region, month), (orders, units, revenue) in sorted(groups.items()):
        out.append(f"{region},2026-{month:02d},{orders},{units},{revenue}")
    return "\n".join(out)


def metrics_gen(n, rng):
    values = []
    for _ in range(n):
        v = 20 + rng.int(80)
        if rng.int(100) < 3:
            v += 200 + rng.int(800)
        values.append(v)
    return values, fold_list(values), n


def metrics_run(values):
    n = len(values)
    window = slow = peak = 0
    for i, v in enumerate(values):
        window += v
        if i >= 60:
            window -= values[i - 60]
        if i >= 59:
            if window > 7200:
                slow += 1
            if window > peak:
                peak = window
    buckets = 0
    for start in range(0, n, 60):
        buckets = fold(buckets, max(values[start : start + 60]))
    ranked = sorted(values)

    def rank(p):
        return ranked[(p * n + 99) // 100 - 1]

    mean_milli = sum(values) * 1000 // n
    return [slow, peak, buckets, rank(50), rank(95), rank(99), ranked[-1], mean_milli & M]


NN_IN, NN_H, NN_OUT = 64, 64, 10


def infer_gen(n, rng):
    h = 0

    def draw(count, k, offset):
        nonlocal h
        out = []
        for _ in range(count):
            raw = rng.int(k)
            h = fold(h, raw)
            out.append(raw - offset)
        return out

    def matrix(rows, cols, k, offset):
        return [draw(cols, k, offset) for _ in range(rows)]

    w1, b1 = matrix(NN_H, NN_IN, 255, 127), draw(NN_H, 2001, 1000)
    w2, b2 = matrix(NN_H, NN_H, 255, 127), draw(NN_H, 2001, 1000)
    w3, b3 = matrix(NN_OUT, NN_H, 255, 127), draw(NN_OUT, 2001, 1000)
    x = matrix(n, NN_IN, 256, 128)
    return (w1, b1, w2, b2, w3, b3, x), h, n


def dense(w, b, v):
    return [bias + sum(wk * vk for wk, vk in zip(row, v)) for row, bias in zip(w, b)]


def infer_run(model):
    w1, b1, w2, b2, w3, b3, x = model
    preds = conf = 0
    for sample in x:
        h1 = [min(127, max(0, a) // 1024) for a in dense(w1, b1, sample)]
        h2 = [min(127, max(0, a) // 1024) for a in dense(w2, b2, h1)]
        logits = dense(w3, b3, h2)
        pred = max(range(NN_OUT), key=logits.__getitem__)
        preds = fold(preds, pred)
        conf = (conf + logits[pred] + 4194304) & M
    return [preds, conf]


EMB_D, EMB_Q, EMB_K = 64, 8, 10


def embed_gen(n, rng):
    h = 0

    def vectors(count):
        nonlocal h
        out = []
        for _ in range(count):
            vec = []
            for _ in range(EMB_D):
                raw = rng.int(256)
                h = fold(h, raw)
                vec.append(raw - 128)
            out.append(vec)
        return out

    docs = vectors(n)
    queries = vectors(EMB_Q)
    return (docs, queries), h, n * EMB_Q


def embed_run(data):
    docs, queries = data
    results = []
    for query in queries:
        scores = [sum(a * b for a, b in zip(doc, query)) for doc in docs]
        order = sorted(range(len(docs)), key=lambda d: (-scores[d], d))
        for d in order[:EMB_K]:
            results += [d, scores[d] + 2097152]
    return results


def pixel_gen(n, rng):
    rgb = bytearray(n * n * 3)
    h = 0
    p = 0
    for y in range(n):
        for x in range(n):
            rgb[p] = (x + y + rng.int(64)) % 256
            rgb[p + 1] = (2 * x + rng.int(64)) % 256
            rgb[p + 2] = (2 * y + rng.int(64)) % 256
            h = fold(fold(fold(h, rgb[p]), rgb[p + 1]), rgb[p + 2])
            p += 3
    return (rgb, n), h, n * n


def pixel_run(data):
    rgb, n = data
    phases = []
    t = perf_counter_ns()

    def lap():
        nonlocal t
        now = perf_counter_ns()
        phases.append(now - t)
        t = now

    last = n - 1

    gray = bytearray((77 * rgb[i] + 150 * rgb[i + 1] + 29 * rgb[i + 2]) >> 8 for i in range(0, 3 * n * n, 3))
    lap()

    blur = bytearray(n * n)
    for y in range(n):
        ru, r0, rd = max(y - 1, 0) * n, y * n, min(y + 1, last) * n
        for x in range(n):
            xl, xr = max(x - 1, 0), min(x + 1, last)
            s = (
                gray[ru + xl] + 2 * gray[ru + x] + gray[ru + xr]
                + 2 * gray[r0 + xl] + 4 * gray[r0 + x] + 2 * gray[r0 + xr]
                + gray[rd + xl] + 2 * gray[rd + x] + gray[rd + xr]
            )
            blur[r0 + x] = s >> 4
    lap()

    mag = bytearray(n * n)
    for y in range(n):
        ru, r0, rd = max(y - 1, 0) * n, y * n, min(y + 1, last) * n
        for x in range(n):
            xl, xr = max(x - 1, 0), min(x + 1, last)
            gx = blur[ru + xr] + 2 * blur[r0 + xr] + blur[rd + xr] - (blur[ru + xl] + 2 * blur[r0 + xl] + blur[rd + xl])
            gy = blur[rd + xl] + 2 * blur[rd + x] + blur[rd + xr] - (blur[ru + xl] + 2 * blur[ru + x] + blur[ru + xr])
            mag[r0 + x] = min(255, abs(gx) + abs(gy))
    lap()

    hist = [0] * 256
    edges = 0
    for m in mag:
        hist[m] += 1
        if m >= 128:
            edges += 1
    lap()

    return {"result": hist + [edges], "phases": phases}


CHALLENGES = {
    "sort": (sort_gen, list.copy, sort_run, sort_check),
    "json": (json_gen, lambda x: x, json_run, fnv1a),
    "strings": (strings_gen, lambda x: x, strings_run, fold_list),
    "sieve": (lambda n, rng: (n, n & M, n), lambda x: x, sieve_run, fold_list),
    "records": (records_gen, lambda x: x, records_run, records_check),
    "search": (search_gen, lambda x: x, search_run, lambda r: fold_list(r["result"])),
    "csv": (csv_gen, lambda x: x, csv_run, fnv1a),
    "metrics": (metrics_gen, lambda x: x, metrics_run, fold_list),
    "infer": (infer_gen, lambda x: x, infer_run, fold_list),
    "embed": (embed_gen, lambda x: x, embed_run, fold_list),
    "pixel": (pixel_gen, lambda x: x, pixel_run, lambda r: fold_list(r["result"])),
}


def main():
    name, size, seed, warmup, runs = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
    if name not in CHALLENGES:
        raise ValueError(f"unknown challenge: {name}")
    gen, prepare, run, check = CHALLENGES[name]

    g0 = perf_counter_ns()
    data, h, ops = gen(size, Rng(seed))
    emit({"e": "ready", "genNs": perf_counter_ns() - g0, "input": hex8(h), "ops": ops})

    for i in range(warmup + runs):
        work = prepare(data)
        t0 = perf_counter_ns()
        out = run(work)
        ns = perf_counter_ns() - t0
        warm = i < warmup
        event = {"e": "warmup" if warm else "run", "i": i if warm else i - warmup, "ns": ns, "check": hex8(check(out))}
        if isinstance(out, dict) and "phases" in out:
            event["phases"] = out["phases"]
        emit(event)
    emit({"e": "done"})


try:
    main()
except Exception as err:  # noqa: BLE001
    emit({"e": "error", "msg": str(err)})
    sys.exit(1)
