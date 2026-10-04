# Harness contract

Every language implements **one executable** that runs any challenge:

```
<harness> <challenge> <size> <seed> <warmup> <runs>
```

All arguments are validated integers / whitelisted ids produced by `src/lib/config.ts`. No user text ever reaches a command line.

## Output protocol

One JSON object per line on stdout, flushed immediately:

| line | when | fields |
| --- | --- | --- |
| `{"e":"hello"}` | first statement of the program, before any work | `lang` |
| `{"e":"ready"}` | after input generation | `genNs` (untimed), `input` (8-hex input hash), `ops` |
| `{"e":"warmup"}` | after each warm-up run | `i`, `ns`, `check` |
| `{"e":"run"}` | after each measured run | `i`, `ns`, `check`, optional `phases` (ns per phase) |
| `{"e":"done"}` | end | |
| `{"e":"error"}` | on failure, then exit ≠ 0 | `msg` |

`ns` is measured with the language's monotonic clock (`process.hrtime.bigint`, `time.perf_counter_ns`, `time.Now`/`time.Since`, `Instant`, `System.nanoTime`) around **only** the challenge's `run` step. Generation, the per-run copy (`prepare`) and checksumming happen outside the timer.

## Shared primitives (must be bit-exact in every language)

```
xorshift32:   state = seed mod 2^32, or 0x9E3779B9 if that is 0
              x ^= x << 13; x ^= x >> 17 (logical); x ^= x << 5     (all mod 2^32)
int(n):       next() mod n
fold(h, v):   (h * 31 + v) mod 2^32
fnv1a32(s):   h = 0x811C9DC5; for each byte b: h = (h XOR b) * 0x01000193 mod 2^32
hex8(h):      8 lower-case hex digits, zero padded
```

## Challenges

Draw order from the RNG is part of the contract.

### `sort`
- input: `n` values `next() & 0x7FFFFFFF`; input hash = fold over values.
- prepare: copy. run: ascending sort with the standard library. check: fold over sorted values.

### `json`
- record *i*: `country = C[int(20)]`, `age = 10 + int(80)`, `score = int(1000)`, `active = (next() & 1) == 1`, `t1 = int(10)`, `t2 = int(10)`.
- text: `[` + records joined by `,` + `]`, each exactly
  `{"id":i,"name":"user_i","country":"XX","age":A,"score":S,"active":true|false,"tags":["tT1","tT2"]}`. Input hash = fnv1a(text).
- run: parse → keep `active && score >= 500` → `{"country","id","name": upper(name),"score2": score*2,"tagCount": len(tags)}`: keys in **ASCII-sorted** order (several serialisers, e.g. JSON::PP canonical, Swift `.sortedKeys`, nlohmann, sort keys and cannot preserve insertion order) → compact serialisation. check: fnv1a(output bytes).

### `strings`
- line *i*: draws `level = L[int(4)]`, `user = int(1000)`, `res = R[int(5)]`, `id = int(10000)`, `status = S[int(6)]`, `latency = int(2000)`;
  text `ts={1700000000+i} level={level} user=u{user} path=/api/{res}/{id} status={status} latency={latency}ms`, lines joined by `\n`.
- run: split on `\n`; regex `status=(\d{3}) latency=(\d+)ms` (compiled inside the run); count status ≥ 500, sum latency; count lines containing `level=ERROR`; add the number of fields from splitting on a single space.
- check: fold over `[lines, s5xx, errors, latencySum mod 2^32, tokens]`.

### `sieve`
- input: `n` (hash = n). run: Sieve of Eratosthenes over `0..n`; count primes and sum them mod 2^32. check: fold(count, sum).

### `records`
- record *i*: `c = int(20)`, `age = 10 + int(80)`, `score = int(1000)`, `createdAt = 1700000000 + int(31536000)`; also `id = i`, `name = "user_i"`, `country = C[c]`. Input hash folds `c, age, score, createdAt` per record.
- run: keep `age >= 18 && score >= 100 && createdAt >= 1700000000 + 15768000`; group by country → `count, sum(score), max(score), sum(age)`; sort by sum desc, then country asc.
- check: per group fold `fnv1a(country), count, sum mod 2^32, max, ageSum mod 2^32`.

### `search`
- keys: `n × (next() & 0x7FFFFFFF)`; then queries *i*: even → `keys[int(n)]`, odd → `next() & 0x7FFFFFFF`. Input hash folds keys then queries.
- run phases (each timed): build hash map key→index (later duplicates overwrite) · probe all queries (hits, sum of values) · copy + sort keys · binary-search all queries (hits).
- check: fold `[hits, sum mod 2^32, binaryHits]`.

### `csv` (size = rows n)
- row *i* (draw order): `month = 1 + int(12)`, `day = 1 + int(28)`, `region = G[int(8)]`, `sku = int(1000)`, `qty = 1 + int(20)`, `price = 99 + int(99901)`, `discount = 5 * int(5)`.
- text: the header `order_id,date,region,sku,qty,unit_price_cents,discount_pct`, then one line per row, all joined by `\n` (no trailing newline). Each row is exactly
  `{i},2026-{MM}-{DD},{region},SKU-{sku},{qty},{price},{discount}` with `MM`/`DD` zero-padded to 2 digits. Input hash = fnv1a(text).
- run: split into lines, skip the header, split each line on `,`. `month` = the 2 digits at offset 5 of the date. `revenue = qty * price * (100 − discount) div 100` (integer division; every factor is positive). Group by `(region, month)` → `orders` (count), `units` (Σ qty), `revenue` (Σ revenue; needs 64-bit, never print in scientific notation).
- report: the header `region,month,orders,units,revenue_cents`, then one line per group `{region},2026-{MM},{orders},{units},{revenue}`, sorted by region (ASCII) then month, joined by `\n` (no trailing newline). check: fnv1a(report).

### `metrics` (size = samples n, n ≥ 60)
- sample *i*: `v = 20 + int(80)`; then `r = int(100)`; if `r < 3` draw `extra = int(800)` and `v += 200 + extra`. Input hash = fold over all `v`.
- run:
  - rolling window of W = 60: for every window ending at *i* ≥ 59, `sum = Σ v[i−59..i]`. `slow` = number of windows with `sum > 7200` (mean above 120 ms); `peak` = the largest window sum.
  - buckets: consecutive blocks of 60 samples (the last may be shorter); `buckets` = fold over each block's max, in order.
  - percentiles: sort a copy ascending (inside the timed run). Nearest rank: `P(p) = sorted[(p·n + 99) div 100 − 1]` for p = 50, 95, 99; `max = sorted[n−1]`.
  - `meanMilli = (Σ v · 1000) div n` (needs 64-bit).
- check: fold `[slow, peak, buckets, P(50), P(95), P(99), max, meanMilli mod 2^32]`.

### `infer` (size = batch n)
- a fixed int8 MLP: IN = 64, H = 64, OUT = 10. Draw order: `W1[H][IN]`, `b1[H]`, `W2[H][H]`, `b2[H]`, `W3[OUT][H]`, `b3[OUT]` (row-major), then the inputs `X[n][IN]`. Weights are `int(255) − 127`, biases `int(2001) − 1000`, inputs `int(256) − 128`. Input hash = fold over every **raw draw** (before the offset is subtracted), in draw order.
- run, per sample: `h1[j] = min(127, max(0, b1[j] + Σk W1[j][k]·x[k]) div 1024)`; `h2` the same from `h1` with `W2, b2`; `logits[o] = b3[o] + Σj W3[o][j]·h2[j]`; `pred` = index of the largest logit (lowest index on ties).
- check: `preds` = fold over every sample's `pred`, in order; `conf = Σ (logits[pred] + 4194304) mod 2^32`; check = fold(preds, conf).

### `embed` (size = corpus N, N ≥ 10)
- D = 64 dimensions, Q = 8 queries, K = 10. Draw order: the documents `doc[N][D]`, then the queries `query[Q][D]`, each component `int(256) − 128`. Input hash = fold over every raw draw, in draw order.
- run: for each query, score every document by dot product, then take the top K by score descending, then document index ascending.
- check: for each query in order, for each of its K results in rank order: fold(index), then fold(score + 2097152).

### `pixel` (size = side n)
- image n×n, pixel *p* = y·n + x, row-major. Per pixel draw `a = int(64)`, `b = int(64)`, `c = int(64)`; then `R = (x + y + a) mod 256`, `G = (2x + b) mod 256`, `B = (2y + c) mod 256`. Input hash = fold over R, G, B per pixel.
- run phases (each timed, like `search`); every neighbourhood read clamps coordinates to `0..n−1`:
  - gray: `(77R + 150G + 29B) div 256`
  - blur: 3×3 kernel `1 2 1 / 2 4 2 / 1 2 1` on gray, sum `div 16`
  - sobel on blur: `gx = (p[x+1,y−1] + 2p[x+1,y] + p[x+1,y+1]) − (p[x−1,y−1] + 2p[x−1,y] + p[x−1,y+1])`, `gy = (p[x−1,y+1] + 2p[x,y+1] + p[x+1,y+1]) − (p[x−1,y−1] + 2p[x,y−1] + p[x+1,y−1])`, `mag = min(255, |gx| + |gy|)`
  - histogram: 256 bins of `mag`; `edges` = number of pixels with `mag ≥ 128`
- check: fold over the 256 bins in order, then fold(edges).

## Constants

```
C = US GB DE FR JP BR IN CN CA AU NO SE ZA NG MX ES IT KR NL PL
G = NA EMEA APAC LATAM ANZ MEA NORDICS DACH
L = INFO WARN ERROR DEBUG
R = users orders items auth search
S = 200 200 200 201 404 500
```

`npm run bench:verify` runs every available harness over several seeds and sizes and fails on any mismatch.
