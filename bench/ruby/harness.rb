require "json"

$stdout.sync = true

def emit(obj)
  $stdout.write(JSON.generate(obj) + "\n")
end

emit({ e: "hello", lang: "ruby" })

M = 0xFFFFFFFF
COUNTRIES = %w[US GB DE FR JP BR IN CN CA AU NO SE ZA NG MX ES IT KR NL PL].freeze
LEVELS = %w[INFO WARN ERROR DEBUG].freeze
RESOURCES = %w[users orders items auth search].freeze
STATUSES = [200, 200, 200, 201, 404, 500].freeze

class Rng
  def initialize(seed)
    @s = (seed & M).zero? ? 0x9E3779B9 : (seed & M)
  end

  def next_u32
    x = @s
    x ^= (x << 13) & M
    x ^= x >> 17
    x ^= (x << 5) & M
    @s = x
  end

  def int(n)
    next_u32 % n
  end
end

def fold(h, v) = (h * 31 + v) & M

def fnv1a(s)
  h = 0x811C9DC5
  s.each_byte { |b| h = ((h ^ b) * 0x01000193) & M }
  h
end

def fold_all(values) = values.reduce(0) { |h, v| fold(h, v) }

def now_ns = Process.clock_gettime(Process::CLOCK_MONOTONIC, :nanosecond)

Challenge = Struct.new(:gen, :prepare, :run, :check)

REGIONS = %w[NA EMEA APAC LATAM ANZ MEA NORDICS DACH].freeze
NN_IN = 64
NN_H = 64
NN_OUT = 10
EMB_D = 64
EMB_Q = 8
EMB_K = 10

def dense(w, b, v) = w.zip(b).map { |row, bias| bias + row.zip(v).sum { |wk, vk| wk * vk } }

IDENTITY = ->(x) { x }

CHALLENGES = {
  "sort" => Challenge.new(
    lambda { |n, rng|
      data = Array.new(n) { rng.next_u32 & 0x7FFFFFFF }
      [data, fold_all(data), n]
    },
    ->(data) { data.dup },
    ->(work) { work.sort! },
    ->(sorted) { fold_all(sorted) },
  ),

  "json" => Challenge.new(
    lambda { |n, rng|
      parts = Array.new(n) do |i|
        country = COUNTRIES[rng.int(20)]
        age = 10 + rng.int(80)
        score = rng.int(1000)
        active = (rng.next_u32 & 1) == 1
        t1 = rng.int(10)
        t2 = rng.int(10)
        %({"id":#{i},"name":"user_#{i}","country":"#{country}","age":#{age},"score":#{score},"active":#{active},"tags":["t#{t1}","t#{t2}"]})
      end
      text = "[#{parts.join(",")}]"
      [text, fnv1a(text), n]
    },
    IDENTITY,
    lambda { |text|
      out = JSON.parse(text).filter_map do |r|
        next unless r["active"] && r["score"] >= 500

        { "country" => r["country"], "id" => r["id"], "name" => r["name"].upcase, "score2" => r["score"] * 2, "tagCount" => r["tags"].length }
      end
      JSON.generate(out)
    },
    ->(json) { fnv1a(json) },
  ),

  "strings" => Challenge.new(
    lambda { |n, rng|
      lines = Array.new(n) do |i|
        level = LEVELS[rng.int(4)]
        user = rng.int(1000)
        res = RESOURCES[rng.int(5)]
        id = rng.int(10_000)
        status = STATUSES[rng.int(6)]
        latency = rng.int(2000)
        "ts=#{1_700_000_000 + i} level=#{level} user=u#{user} path=/api/#{res}/#{id} status=#{status} latency=#{latency}ms"
      end
      text = lines.join("\n")
      [text, fnv1a(text), n]
    },
    IDENTITY,
    lambda { |text|
      pattern = /status=(\d{3}) latency=(\d+)ms/
      lines = s5xx = errors = latency = tokens = 0
      text.split("\n", -1).each do |line|
        lines += 1
        if (m = pattern.match(line))
          s5xx += 1 if m[1].to_i >= 500
          latency += m[2].to_i
        end
        errors += 1 if line.include?("level=ERROR")
        tokens += line.split(" ", -1).length
      end
      [lines, s5xx, errors, latency & M, tokens]
    },
    ->(r) { fold_all(r) },
  ),

  "sieve" => Challenge.new(
    ->(n, _rng) { [n, n & M, n] },
    IDENTITY,
    lambda { |n|
      composite = Array.new(n + 1, false)
      i = 2
      while i * i <= n
        unless composite[i]
          (i * i).step(n, i) { |j| composite[j] = true }
        end
        i += 1
      end
      count = 0
      sum = 0
      (2..n).each do |k|
        next if composite[k]

        count += 1
        sum += k
      end
      [count, sum & M]
    },
    ->(r) { fold_all(r) },
  ),

  "records" => Challenge.new(
    lambda { |n, rng|
      h = 0
      records = Array.new(n) do |i|
        c = rng.int(20)
        age = 10 + rng.int(80)
        score = rng.int(1000)
        created_at = 1_700_000_000 + rng.int(31_536_000)
        h = fold(fold(fold(fold(h, c), age), score), created_at)
        { id: i, name: "user_#{i}", country: COUNTRIES[c], age: age, score: score, created_at: created_at }
      end
      [records, h, n]
    },
    IDENTITY,
    lambda { |records|
      cutoff = 1_700_000_000 + 15_768_000
      groups = {}
      records.each do |r|
        next unless r[:age] >= 18 && r[:score] >= 100 && r[:created_at] >= cutoff

        g = (groups[r[:country]] ||= { country: r[:country], count: 0, sum: 0, max: 0, age_sum: 0 })
        g[:count] += 1
        g[:sum] += r[:score]
        g[:max] = r[:score] if r[:score] > g[:max]
        g[:age_sum] += r[:age]
      end
      groups.values.sort_by { |g| [-g[:sum], g[:country]] }
    },
    lambda { |groups|
      groups.reduce(0) do |h, g|
        h = fold(h, fnv1a(g[:country]))
        h = fold(h, g[:count])
        h = fold(h, g[:sum] & M)
        h = fold(h, g[:max])
        fold(h, g[:age_sum] & M)
      end
    },
  ),

  "search" => Challenge.new(
    lambda { |n, rng|
      keys = Array.new(n) { rng.next_u32 & 0x7FFFFFFF }
      queries = Array.new(n) { |i| i.even? ? keys[rng.int(n)] : rng.next_u32 & 0x7FFFFFFF }
      [[keys, queries], fold_all(keys + queries), 2 * n]
    },
    IDENTITY,
    lambda { |(keys, queries)|
      phases = []
      t = now_ns
      lap = lambda {
        now = now_ns
        phases << now - t
        t = now
      }
      index = {}
      keys.each_with_index { |k, i| index[k] = i }
      lap.call
      hits = 0
      sum = 0
      queries.each do |q|
        v = index[q]
        next if v.nil?

        hits += 1
        sum += v
      end
      lap.call
      sorted = keys.sort
      lap.call
      bin_hits = queries.count { |q| sorted.bsearch { |x| x >= q } == q }
      lap.call
      { result: [hits, sum & M, bin_hits], phases: phases }
    },
    ->(r) { fold_all(r[:result]) },
  ),

  "csv" => Challenge.new(
    lambda { |n, rng|
      lines = ["order_id,date,region,sku,qty,unit_price_cents,discount_pct"]
      n.times do |i|
        month = 1 + rng.int(12)
        day = 1 + rng.int(28)
        region = REGIONS[rng.int(8)]
        sku = rng.int(1000)
        qty = 1 + rng.int(20)
        price = 99 + rng.int(99_901)
        discount = 5 * rng.int(5)
        lines << format("%d,2026-%02d-%02d,%s,SKU-%d,%d,%d,%d", i, month, day, region, sku, qty, price, discount)
      end
      text = lines.join("\n")
      [text, fnv1a(text), n]
    },
    IDENTITY,
    lambda { |text|
      groups = Hash.new { |hash, key| hash[key] = [0, 0, 0] }
      text.split("\n").drop(1).each do |line|
        f = line.split(",")
        qty = f[4].to_i
        g = groups[[f[2], f[1][5, 2].to_i]]
        g[0] += 1
        g[1] += qty
        g[2] += qty * f[5].to_i * (100 - f[6].to_i) / 100
      end
      out = ["region,month,orders,units,revenue_cents"]
      groups.sort.each do |(region, month), (orders, units, revenue)|
        out << format("%s,2026-%02d,%d,%d,%d", region, month, orders, units, revenue)
      end
      out.join("\n")
    },
    ->(report) { fnv1a(report) },
  ),

  "metrics" => Challenge.new(
    lambda { |n, rng|
      values = Array.new(n) do
        v = 20 + rng.int(80)
        v += 200 + rng.int(800) if rng.int(100) < 3
        v
      end
      [values, fold_all(values), n]
    },
    IDENTITY,
    lambda { |values|
      n = values.length
      window = slow = peak = 0
      values.each_with_index do |v, i|
        window += v
        window -= values[i - 60] if i >= 60
        next if i < 59

        slow += 1 if window > 7200
        peak = window if window > peak
      end
      buckets = values.each_slice(60).reduce(0) { |h, block| fold(h, block.max) }
      sorted = values.sort
      rank = ->(p) { sorted[(p * n + 99) / 100 - 1] }
      mean_milli = values.sum * 1000 / n
      [slow, peak, buckets, rank.(50), rank.(95), rank.(99), sorted.last, mean_milli & M]
    },
    ->(r) { fold_all(r) },
  ),

  "infer" => Challenge.new(
    lambda { |n, rng|
      h = 0
      draw = lambda { |count, k, offset|
        Array.new(count) do
          raw = rng.int(k)
          h = fold(h, raw)
          raw - offset
        end
      }
      matrix = ->(rows, cols, k, offset) { Array.new(rows) { draw.(cols, k, offset) } }
      w1 = matrix.(NN_H, NN_IN, 255, 127)
      b1 = draw.(NN_H, 2001, 1000)
      w2 = matrix.(NN_H, NN_H, 255, 127)
      b2 = draw.(NN_H, 2001, 1000)
      w3 = matrix.(NN_OUT, NN_H, 255, 127)
      b3 = draw.(NN_OUT, 2001, 1000)
      x = matrix.(n, NN_IN, 256, 128)
      [[w1, b1, w2, b2, w3, b3, x], h, n]
    },
    IDENTITY,
    lambda { |(w1, b1, w2, b2, w3, b3, x)|
      preds = conf = 0
      x.each do |sample|
        h1 = dense(w1, b1, sample).map { |a| [[a, 0].max / 1024, 127].min }
        h2 = dense(w2, b2, h1).map { |a| [[a, 0].max / 1024, 127].min }
        logits = dense(w3, b3, h2)
        pred = logits.index(logits.max)
        preds = fold(preds, pred)
        conf = (conf + logits[pred] + 4_194_304) & M
      end
      [preds, conf]
    },
    ->(r) { fold_all(r) },
  ),

  "embed" => Challenge.new(
    lambda { |n, rng|
      h = 0
      vectors = lambda { |count|
        Array.new(count) do
          Array.new(EMB_D) do
            raw = rng.int(256)
            h = fold(h, raw)
            raw - 128
          end
        end
      }
      docs = vectors.(n)
      queries = vectors.(EMB_Q)
      [[docs, queries], h, n * EMB_Q]
    },
    IDENTITY,
    lambda { |(docs, queries)|
      queries.flat_map do |query|
        scores = docs.map { |doc| doc.zip(query).sum { |a, b| a * b } }
        top = (0...docs.length).sort_by { |d| [-scores[d], d] }.first(EMB_K)
        top.flat_map { |d| [d, scores[d] + 2_097_152] }
      end
    },
    ->(r) { fold_all(r) },
  ),

  "pixel" => Challenge.new(
    lambda { |n, rng|
      rgb = Array.new(n * n * 3)
      h = 0
      n.times do |y|
        n.times do |x|
          p = (y * n + x) * 3
          rgb[p] = (x + y + rng.int(64)) % 256
          rgb[p + 1] = (2 * x + rng.int(64)) % 256
          rgb[p + 2] = (2 * y + rng.int(64)) % 256
          h = fold(fold(fold(h, rgb[p]), rgb[p + 1]), rgb[p + 2])
        end
      end
      [[rgb, n], h, n * n]
    },
    IDENTITY,
    lambda { |(rgb, n)|
      phases = []
      t = now_ns
      lap = lambda {
        now = now_ns
        phases << now - t
        t = now
      }
      last = n - 1

      gray = Array.new(n * n) { |i| (77 * rgb[i * 3] + 150 * rgb[i * 3 + 1] + 29 * rgb[i * 3 + 2]) >> 8 }
      lap.call

      blur = Array.new(n * n)
      n.times do |y|
        ru = (y - 1).clamp(0, last) * n
        r0 = y * n
        rd = (y + 1).clamp(0, last) * n
        n.times do |x|
          xl = (x - 1).clamp(0, last)
          xr = (x + 1).clamp(0, last)
          s = gray[ru + xl] + 2 * gray[ru + x] + gray[ru + xr] +
              2 * gray[r0 + xl] + 4 * gray[r0 + x] + 2 * gray[r0 + xr] +
              gray[rd + xl] + 2 * gray[rd + x] + gray[rd + xr]
          blur[r0 + x] = s >> 4
        end
      end
      lap.call

      mag = Array.new(n * n)
      n.times do |y|
        ru = (y - 1).clamp(0, last) * n
        r0 = y * n
        rd = (y + 1).clamp(0, last) * n
        n.times do |x|
          xl = (x - 1).clamp(0, last)
          xr = (x + 1).clamp(0, last)
          gx = blur[ru + xr] + 2 * blur[r0 + xr] + blur[rd + xr] - (blur[ru + xl] + 2 * blur[r0 + xl] + blur[rd + xl])
          gy = blur[rd + xl] + 2 * blur[rd + x] + blur[rd + xr] - (blur[ru + xl] + 2 * blur[ru + x] + blur[ru + xr])
          mag[r0 + x] = [gx.abs + gy.abs, 255].min
        end
      end
      lap.call

      hist = Array.new(256, 0)
      edges = 0
      mag.each do |m|
        hist[m] += 1
        edges += 1 if m >= 128
      end
      lap.call

      { result: hist + [edges], phases: phases }
    },
    ->(r) { fold_all(r[:result]) },
  ),
}.freeze

begin
  name, size, seed, warmup, runs = ARGV[0], ARGV[1].to_i, ARGV[2].to_i, ARGV[3].to_i, ARGV[4].to_i
  c = CHALLENGES[name] or raise "unknown challenge: #{name}"
  g0 = now_ns
  input, hash, ops = c.gen.call(size, Rng.new(seed))
  emit({ e: "ready", genNs: now_ns - g0, input: format("%08x", hash), ops: ops })
  (warmup + runs).times do |i|
    work = c.prepare.call(input)
    t0 = now_ns
    out = c.run.call(work)
    ns = now_ns - t0
    warm = i < warmup
    event = { e: warm ? "warmup" : "run", i: warm ? i : i - warmup, ns: ns, check: format("%08x", c.check.call(out)) }
    event[:phases] = out[:phases] if out.is_a?(Hash) && out[:phases]
    emit(event)
  end
  emit({ e: "done" })
rescue StandardError => e
  emit({ e: "error", msg: e.message })
  exit 1
end
