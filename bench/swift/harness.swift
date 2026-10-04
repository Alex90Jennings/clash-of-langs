import Foundation

setvbuf(stdout, nil, _IOLBF, 0)

let M: UInt64 = 0xFFFF_FFFF
let COUNTRIES = ["US", "GB", "DE", "FR", "JP", "BR", "IN", "CN", "CA", "AU", "NO", "SE", "ZA", "NG", "MX", "ES", "IT", "KR", "NL", "PL"]
let LEVELS = ["INFO", "WARN", "ERROR", "DEBUG"]
let RESOURCES = ["users", "orders", "items", "auth", "search"]
let STATUSES = [200, 200, 200, 201, 404, 500]

func emit(_ line: String) { print(line) }
func nowNs() -> UInt64 { DispatchTime.now().uptimeNanoseconds }
func hex8(_ h: UInt32) -> String { String(format: "%08x", h) }

struct Rng {
  var s: UInt32
  init(_ seed: UInt64) { s = UInt32(truncatingIfNeeded: seed) == 0 ? 0x9e37_79b9 : UInt32(truncatingIfNeeded: seed) }
  mutating func next() -> UInt32 {
    var x = s
    x ^= x << 13
    x ^= x >> 17
    x ^= x << 5
    s = x
    return x
  }
  mutating func int(_ n: Int) -> Int { Int(next() % UInt32(n)) }
}

@inline(__always) func fold(_ h: UInt32, _ v: UInt64) -> UInt32 { h &* 31 &+ UInt32(truncatingIfNeeded: v) }
func fnv1a(_ s: String) -> UInt32 {
  var h: UInt32 = 0x811c_9dc5
  for b in s.utf8 { h = (h ^ UInt32(b)) &* 0x0100_0193 }
  return h
}
func foldAll(_ v: [UInt64]) -> UInt32 { v.reduce(0, fold) }

struct Out {
  var check: UInt32 = 0
  var phases: [UInt64]? = nil
}

protocol Challenge {
  mutating func gen(_ n: Int, _ rng: inout Rng) -> (UInt32, Int)
  mutating func prepare()
  mutating func run(_ out: inout Out)
  func check(_ out: inout Out)
}
extension Challenge { mutating func prepare() {} }

struct SortChallenge: Challenge {
  var data: [Int32] = [], work: [Int32] = []
  mutating func gen(_ n: Int, _ rng: inout Rng) -> (UInt32, Int) {
    data = (0..<n).map { _ in Int32(bitPattern: rng.next() & 0x7fff_ffff) }
    return (data.reduce(0) { fold($0, UInt64($1)) }, n)
  }
  mutating func prepare() {
    work = data
    work.withUnsafeMutableBufferPointer { _ in }
  }
  mutating func run(_ out: inout Out) { work.sort() }
  func check(_ out: inout Out) { out.check = work.reduce(0) { fold($0, UInt64($1)) } }
}

struct JsonRecord: Decodable { let id: Int; let name: String; let country: String; let age: Int; let score: Int; let active: Bool; let tags: [String] }
struct JsonOut: Encodable { let country: String; let id: Int; let name: String; let score2: Int; let tagCount: Int }

struct JsonChallenge: Challenge {
  var text = Data(), result = Data()
  mutating func gen(_ n: Int, _ rng: inout Rng) -> (UInt32, Int) {
    var s = "["
    s.reserveCapacity(n * 110)
    for i in 0..<n {
      let country = COUNTRIES[rng.int(20)]
      let age = 10 + rng.int(80), score = rng.int(1000)
      let active = (rng.next() & 1) == 1
      let t1 = rng.int(10), t2 = rng.int(10)
      if i > 0 { s += "," }
      s += "{\"id\":\(i),\"name\":\"user_\(i)\",\"country\":\"\(country)\",\"age\":\(age),\"score\":\(score),\"active\":\(active),\"tags\":[\"t\(t1)\",\"t\(t2)\"]}"
    }
    s += "]"
    text = Data(s.utf8)
    return (fnv1a(s), n)
  }
  mutating func run(_ out: inout Out) {
    let records = try! JSONDecoder().decode([JsonRecord].self, from: text)
    let filtered = records.filter { $0.active && $0.score >= 500 }.map { JsonOut(country: $0.country, id: $0.id, name: $0.name.uppercased(), score2: $0.score * 2, tagCount: $0.tags.count) }
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    result = try! encoder.encode(filtered)
  }
  func check(_ out: inout Out) { out.check = fnv1a(String(decoding: result, as: UTF8.self)) }
}

struct StringsChallenge: Challenge {
  var text = "", counters: [UInt64] = []
  mutating func gen(_ n: Int, _ rng: inout Rng) -> (UInt32, Int) {
    var lines: [String] = []
    lines.reserveCapacity(n)
    for i in 0..<n {
      let level = LEVELS[rng.int(4)]
      let user = rng.int(1000)
      let res = RESOURCES[rng.int(5)]
      let id = rng.int(10000)
      let status = STATUSES[rng.int(6)]
      let latency = rng.int(2000)
      lines.append("ts=\(1_700_000_000 + i) level=\(level) user=u\(user) path=/api/\(res)/\(id) status=\(status) latency=\(latency)ms")
    }
    text = lines.joined(separator: "\n")
    return (fnv1a(text), n)
  }
  mutating func run(_ out: inout Out) {
    let pattern = try! Regex(#"status=(\d{3}) latency=(\d+)ms"#)
    var lines: UInt64 = 0, s5xx: UInt64 = 0, errors: UInt64 = 0, latency: UInt64 = 0, tokens: UInt64 = 0
    for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
      lines += 1
      if let m = try? pattern.firstMatch(in: line) {
        if let status = Int(m.output[1].substring ?? ""), status >= 500 { s5xx += 1 }
        latency += UInt64(m.output[2].substring ?? "") ?? 0
      }
      if line.contains("level=ERROR") { errors += 1 }
      tokens += UInt64(line.split(separator: " ", omittingEmptySubsequences: false).count)
    }
    counters = [lines, s5xx, errors, latency & M, tokens]
  }
  func check(_ out: inout Out) { out.check = foldAll(counters) }
}

struct SieveChallenge: Challenge {
  var n = 0, counters: [UInt64] = []
  mutating func gen(_ n: Int, _ rng: inout Rng) -> (UInt32, Int) {
    self.n = n
    return (UInt32(truncatingIfNeeded: n), n)
  }
  mutating func run(_ out: inout Out) {
    var composite = [Bool](repeating: false, count: n + 1)
    var i = 2
    while i * i <= n {
      if !composite[i] { for j in stride(from: i * i, through: n, by: i) { composite[j] = true } }
      i += 1
    }
    var count: UInt64 = 0, sum: UInt64 = 0
    if n >= 2 { for k in 2...n where !composite[k] { count += 1; sum += UInt64(k) } }
    counters = [count, sum & M]
  }
  func check(_ out: inout Out) { out.check = foldAll(counters) }
}

struct Record { let id: Int; let name: String; let country: String; let age: Int; let score: Int; let createdAt: Int }
struct Agg {
  let country: String
  var count: UInt64 = 0, sum: UInt64 = 0, max: UInt64 = 0, ageSum: UInt64 = 0
  mutating func add(_ r: Record) {
    count += 1
    sum += UInt64(r.score)
    max = Swift.max(max, UInt64(r.score))
    ageSum += UInt64(r.age)
  }
}

struct RecordsChallenge: Challenge {
  var records: [Record] = [], groups: [Agg] = []
  mutating func gen(_ n: Int, _ rng: inout Rng) -> (UInt32, Int) {
    var h: UInt32 = 0
    records.reserveCapacity(n)
    for i in 0..<n {
      let c = rng.int(20), age = 10 + rng.int(80), score = rng.int(1000), createdAt = 1_700_000_000 + rng.int(31_536_000)
      records.append(Record(id: i, name: "user_\(i)", country: COUNTRIES[c], age: age, score: score, createdAt: createdAt))
      h = fold(fold(fold(fold(h, UInt64(c)), UInt64(age)), UInt64(score)), UInt64(createdAt))
    }
    return (h, n)
  }
  mutating func run(_ out: inout Out) {
    let cutoff = 1_700_000_000 + 15_768_000
    var byCountry: [String: Agg] = [:]
    for r in records where r.age >= 18 && r.score >= 100 && r.createdAt >= cutoff {
      byCountry[r.country, default: Agg(country: r.country)].add(r)
    }
    groups = byCountry.values.sorted { $0.sum != $1.sum ? $0.sum > $1.sum : $0.country < $1.country }
  }
  func check(_ out: inout Out) {
    out.check = groups.reduce(0) { h, g in
      fold(fold(fold(fold(fold(h, UInt64(fnv1a(g.country))), g.count), g.sum & M), g.max), g.ageSum & M)
    }
  }
}

struct SearchChallenge: Challenge {
  var keys: [Int32] = [], queries: [Int32] = [], counters: [UInt64] = []
  mutating func gen(_ n: Int, _ rng: inout Rng) -> (UInt32, Int) {
    keys = (0..<n).map { _ in Int32(bitPattern: rng.next() & 0x7fff_ffff) }
    queries = (0..<n).map { i in i & 1 == 0 ? keys[rng.int(n)] : Int32(bitPattern: rng.next() & 0x7fff_ffff) }
    let h = (keys + queries).reduce(UInt32(0)) { fold($0, UInt64($1)) }
    return (h, 2 * n)
  }
  mutating func run(_ out: inout Out) {
    var phases: [UInt64] = []
    var t = nowNs()
    func lap() {
      let now = nowNs()
      phases.append(now - t)
      t = now
    }
    var index: [Int32: Int32] = [:]
    for (i, k) in keys.enumerated() { index[k] = Int32(i) }
    lap()
    var hits: UInt64 = 0, sum: UInt64 = 0
    for q in queries { if let v = index[q] { hits += 1; sum += UInt64(v) } }
    lap()
    let sorted = keys.sorted()
    lap()
    var binHits: UInt64 = 0
    for q in queries {
      var lo = 0, hi = sorted.count
      while lo < hi {
        let mid = (lo + hi) >> 1
        if sorted[mid] < q { lo = mid + 1 } else { hi = mid }
      }
      if lo < sorted.count && sorted[lo] == q { binHits += 1 }
    }
    lap()
    counters = [hits, sum & M, binHits]
    out.phases = phases
  }
  func check(_ out: inout Out) { out.check = foldAll(counters) }
}

let REGIONS = ["NA", "EMEA", "APAC", "LATAM", "ANZ", "MEA", "NORDICS", "DACH"]
func pad2(_ v: Int) -> String { v < 10 ? "0\(v)" : String(v) }

struct CsvKey: Hashable { let region: String; let month: Int }
struct CsvGroup {
  let region: String, month: Int
  var orders = 0, units = 0, revenue = 0
  mutating func add(_ qty: Int, _ rev: Int) {
    orders += 1
    units += qty
    revenue += rev
  }
}

struct CsvChallenge: Challenge {
  var text = "", report = ""
  mutating func gen(_ n: Int, _ rng: inout Rng) -> (UInt32, Int) {
    var lines = ["order_id,date,region,sku,qty,unit_price_cents,discount_pct"]
    lines.reserveCapacity(n + 1)
    for i in 0..<n {
      let month = 1 + rng.int(12), day = 1 + rng.int(28)
      let region = REGIONS[rng.int(8)]
      let sku = rng.int(1000), qty = 1 + rng.int(20), price = 99 + rng.int(99901), discount = 5 * rng.int(5)
      lines.append("\(i),2026-\(pad2(month))-\(pad2(day)),\(region),SKU-\(sku),\(qty),\(price),\(discount)")
    }
    text = lines.joined(separator: "\n")
    return (fnv1a(text), n)
  }
  mutating func run(_ out: inout Out) {
    var groups: [CsvKey: CsvGroup] = [:]
    for line in text.split(separator: "\n", omittingEmptySubsequences: false).dropFirst() {
      let f = line.split(separator: ",", omittingEmptySubsequences: false)
      let month = Int(f[1].dropFirst(5).prefix(2))!
      let qty = Int(f[4])!, price = Int(f[5])!, discount = Int(f[6])!
      let region = String(f[2])
      groups[CsvKey(region: region, month: month), default: CsvGroup(region: region, month: month)].add(qty, qty * price * (100 - discount) / 100)
    }
    let rows = groups.values.sorted { $0.region != $1.region ? $0.region < $1.region : $0.month < $1.month }
    var out = ["region,month,orders,units,revenue_cents"]
    for g in rows { out.append("\(g.region),2026-\(pad2(g.month)),\(g.orders),\(g.units),\(g.revenue)") }
    report = out.joined(separator: "\n")
  }
  func check(_ out: inout Out) { out.check = fnv1a(report) }
}

struct MetricsChallenge: Challenge {
  var values: [Int] = [], counters: [UInt64] = []
  mutating func gen(_ n: Int, _ rng: inout Rng) -> (UInt32, Int) {
    var h: UInt32 = 0
    values.reserveCapacity(n)
    for _ in 0..<n {
      var v = 20 + rng.int(80)
      if rng.int(100) < 3 { v += 200 + rng.int(800) }
      values.append(v)
      h = fold(h, UInt64(v))
    }
    return (h, n)
  }
  mutating func run(_ out: inout Out) {
    let n = values.count
    var window = 0, slow = 0, peak = 0, total = 0
    for i in 0..<n {
      window += values[i]
      total += values[i]
      if i >= 60 { window -= values[i - 60] }
      if i >= 59 {
        if window > 7200 { slow += 1 }
        if window > peak { peak = window }
      }
    }
    var buckets: UInt32 = 0
    for start in stride(from: 0, to: n, by: 60) {
      buckets = fold(buckets, UInt64(values[start..<min(start + 60, n)].max()!))
    }
    let sorted = values.sorted()
    func rank(_ p: Int) -> UInt64 { UInt64(sorted[(p * n + 99) / 100 - 1]) }
    let meanMilli = total * 1000 / n
    counters = [UInt64(slow), UInt64(peak), UInt64(buckets), rank(50), rank(95), rank(99), UInt64(sorted[n - 1]), UInt64(meanMilli) & M]
  }
  func check(_ out: inout Out) { out.check = foldAll(counters) }
}

let NN_IN = 64, NN_H = 64, NN_OUT = 10

struct InferChallenge: Challenge {
  var w1: [Int32] = [], b1: [Int32] = [], w2: [Int32] = [], b2: [Int32] = [], w3: [Int32] = [], b3: [Int32] = [], x: [Int32] = []
  var n = 0, counters: [UInt64] = []
  mutating func gen(_ n: Int, _ rng: inout Rng) -> (UInt32, Int) {
    self.n = n
    var h: UInt32 = 0
    func draw(_ count: Int, _ k: Int, _ offset: Int32) -> [Int32] {
      (0..<count).map { _ in
        let raw = rng.int(k)
        h = fold(h, UInt64(raw))
        return Int32(raw) - offset
      }
    }
    w1 = draw(NN_H * NN_IN, 255, 127); b1 = draw(NN_H, 2001, 1000)
    w2 = draw(NN_H * NN_H, 255, 127); b2 = draw(NN_H, 2001, 1000)
    w3 = draw(NN_OUT * NN_H, 255, 127); b3 = draw(NN_OUT, 2001, 1000)
    x = draw(n * NN_IN, 256, 128)
    return (h, n)
  }
  mutating func run(_ out: inout Out) {
    var h1 = [Int32](repeating: 0, count: NN_H), h2 = [Int32](repeating: 0, count: NN_H), logits = [Int32](repeating: 0, count: NN_OUT)
    func dense(_ w: [Int32], _ b: [Int32], _ input: [Int32], _ inOff: Int, _ inLen: Int, _ out: inout [Int32]) {
      for j in 0..<out.count {
        var a = b[j]
        let row = j * inLen
        for k in 0..<inLen { a += w[row + k] * input[inOff + k] }
        out[j] = a
      }
    }
    var preds: UInt32 = 0, conf: UInt64 = 0
    for s in 0..<n {
      dense(w1, b1, x, s * NN_IN, NN_IN, &h1)
      for j in 0..<NN_H { h1[j] = min(127, max(0, h1[j]) / 1024) }
      dense(w2, b2, h1, 0, NN_H, &h2)
      for j in 0..<NN_H { h2[j] = min(127, max(0, h2[j]) / 1024) }
      dense(w3, b3, h2, 0, NN_H, &logits)
      var pred = 0
      for o in 1..<NN_OUT where logits[o] > logits[pred] { pred = o }
      preds = fold(preds, UInt64(pred))
      conf = (conf + UInt64(logits[pred] + 4_194_304)) & M
    }
    counters = [UInt64(preds), conf]
  }
  func check(_ out: inout Out) { out.check = foldAll(counters) }
}

let EMB_D = 64, EMB_Q = 8, EMB_K = 10

struct EmbedChallenge: Challenge {
  var docs: [Int32] = [], queries: [Int32] = [], n = 0, results: [UInt64] = []
  mutating func gen(_ n: Int, _ rng: inout Rng) -> (UInt32, Int) {
    self.n = n
    var h: UInt32 = 0
    func draw(_ count: Int) -> [Int32] {
      (0..<count).map { _ in
        let raw = rng.int(256)
        h = fold(h, UInt64(raw))
        return Int32(raw) - 128
      }
    }
    docs = draw(n * EMB_D)
    queries = draw(EMB_Q * EMB_D)
    return (h, n * EMB_Q)
  }
  mutating func run(_ out: inout Out) {
    var res: [UInt64] = []
    var scores = [Int32](repeating: 0, count: n)
    for q in 0..<EMB_Q {
      let qo = q * EMB_D
      for d in 0..<n {
        let dOff = d * EMB_D
        var s: Int32 = 0
        for k in 0..<EMB_D { s += docs[dOff + k] * queries[qo + k] }
        scores[d] = s
      }
      let order = (0..<n).sorted { scores[$0] != scores[$1] ? scores[$0] > scores[$1] : $0 < $1 }
      for r in 0..<EMB_K { res += [UInt64(order[r]), UInt64(scores[order[r]] + 2_097_152)] }
    }
    results = res
  }
  func check(_ out: inout Out) { out.check = foldAll(results) }
}

struct PixelChallenge: Challenge {
  var rgb: [UInt8] = [], n = 0, counters: [UInt64] = []
  mutating func gen(_ n: Int, _ rng: inout Rng) -> (UInt32, Int) {
    self.n = n
    rgb = [UInt8](repeating: 0, count: n * n * 3)
    var h: UInt32 = 0
    for y in 0..<n {
      for x in 0..<n {
        let p = (y * n + x) * 3
        rgb[p] = UInt8((x + y + rng.int(64)) % 256)
        rgb[p + 1] = UInt8((2 * x + rng.int(64)) % 256)
        rgb[p + 2] = UInt8((2 * y + rng.int(64)) % 256)
        h = fold(fold(fold(h, UInt64(rgb[p])), UInt64(rgb[p + 1])), UInt64(rgb[p + 2]))
      }
    }
    return (h, n * n)
  }
  mutating func run(_ out: inout Out) {
    var phases: [UInt64] = []
    var t = nowNs()
    func lap() {
      let now = nowNs()
      phases.append(now - t)
      t = now
    }
    let n = self.n
    func cl(_ v: Int) -> Int { v < 0 ? 0 : v >= n ? n - 1 : v }

    var gray = [UInt8](repeating: 0, count: n * n)
    for i in 0..<(n * n) {
      let r = 77 * Int(rgb[i * 3]), g = 150 * Int(rgb[i * 3 + 1]), b = 29 * Int(rgb[i * 3 + 2])
      gray[i] = UInt8((r + g + b) >> 8)
    }
    lap()

    var blur = [UInt8](repeating: 0, count: n * n)
    for y in 0..<n {
      let ru = cl(y - 1) * n, r0 = y * n, rd = cl(y + 1) * n
      for x in 0..<n {
        let xl = cl(x - 1), xr = cl(x + 1)
        let top = Int(gray[ru + xl]) + 2 * Int(gray[ru + x]) + Int(gray[ru + xr])
        let mid = 2 * Int(gray[r0 + xl]) + 4 * Int(gray[r0 + x]) + 2 * Int(gray[r0 + xr])
        let bottom = Int(gray[rd + xl]) + 2 * Int(gray[rd + x]) + Int(gray[rd + xr])
        blur[r0 + x] = UInt8((top + mid + bottom) >> 4)
      }
    }
    lap()

    var mag = [UInt8](repeating: 0, count: n * n)
    for y in 0..<n {
      let ru = cl(y - 1) * n, r0 = y * n, rd = cl(y + 1) * n
      for x in 0..<n {
        let xl = cl(x - 1), xr = cl(x + 1)
        let right = Int(blur[ru + xr]) + 2 * Int(blur[r0 + xr]) + Int(blur[rd + xr])
        let left = Int(blur[ru + xl]) + 2 * Int(blur[r0 + xl]) + Int(blur[rd + xl])
        let down = Int(blur[rd + xl]) + 2 * Int(blur[rd + x]) + Int(blur[rd + xr])
        let up = Int(blur[ru + xl]) + 2 * Int(blur[ru + x]) + Int(blur[ru + xr])
        let gx = right - left, gy = down - up
        mag[r0 + x] = UInt8(min(255, abs(gx) + abs(gy)))
      }
    }
    lap()

    var hist = [UInt64](repeating: 0, count: 256)
    var edges: UInt64 = 0
    for m in mag {
      hist[Int(m)] += 1
      if m >= 128 { edges += 1 }
    }
    lap()

    counters = hist + [edges]
    out.phases = phases
  }
  func check(_ out: inout Out) { out.check = foldAll(counters) }
}

func drive<C: Challenge>(_ c: inout C, size: Int, seed: UInt64, warmup: Int, runs: Int) {
  var rng = Rng(seed)
  let g0 = nowNs()
  let (hash, ops) = c.gen(size, &rng)
  emit("{\"e\":\"ready\",\"genNs\":\(nowNs() - g0),\"input\":\"\(hex8(hash))\",\"ops\":\(ops)}")
  for i in 0..<(warmup + runs) {
    var out = Out()
    c.prepare()
    let t0 = nowNs()
    c.run(&out)
    let ns = nowNs() - t0
    c.check(&out)
    let warm = i < warmup
    var line = "{\"e\":\"\(warm ? "warmup" : "run")\",\"i\":\(warm ? i : i - warmup),\"ns\":\(ns),\"check\":\"\(hex8(out.check))\""
    if let p = out.phases { line += ",\"phases\":[\(p.map(String.init).joined(separator: ","))]" }
    emit(line + "}")
  }
}

emit("{\"e\":\"hello\",\"lang\":\"swift\"}")
let args = CommandLine.arguments
guard args.count >= 6, let size = Int(args[2]), let seed = UInt64(args[3]), let warmup = Int(args[4]), let runs = Int(args[5]) else {
  emit("{\"e\":\"error\",\"msg\":\"usage: harness <challenge> <size> <seed> <warmup> <runs>\"}")
  exit(1)
}
switch args[1] {
case "sort": var c = SortChallenge(); drive(&c, size: size, seed: seed, warmup: warmup, runs: runs)
case "json": var c = JsonChallenge(); drive(&c, size: size, seed: seed, warmup: warmup, runs: runs)
case "strings": var c = StringsChallenge(); drive(&c, size: size, seed: seed, warmup: warmup, runs: runs)
case "sieve": var c = SieveChallenge(); drive(&c, size: size, seed: seed, warmup: warmup, runs: runs)
case "records": var c = RecordsChallenge(); drive(&c, size: size, seed: seed, warmup: warmup, runs: runs)
case "search": var c = SearchChallenge(); drive(&c, size: size, seed: seed, warmup: warmup, runs: runs)
case "csv": var c = CsvChallenge(); drive(&c, size: size, seed: seed, warmup: warmup, runs: runs)
case "metrics": var c = MetricsChallenge(); drive(&c, size: size, seed: seed, warmup: warmup, runs: runs)
case "infer": var c = InferChallenge(); drive(&c, size: size, seed: seed, warmup: warmup, runs: runs)
case "embed": var c = EmbedChallenge(); drive(&c, size: size, seed: seed, warmup: warmup, runs: runs)
case "pixel": var c = PixelChallenge(); drive(&c, size: size, seed: seed, warmup: warmup, runs: runs)
default:
  emit("{\"e\":\"error\",\"msg\":\"unknown challenge: \(args[1])\"}")
  exit(1)
}
emit("{\"e\":\"done\"}")
