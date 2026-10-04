local here = arg[0]:match("(.*/)") or "./"
package.path = here .. "rocks/share/lua/5.5/?.lua;" .. here .. "rocks/share/lua/5.5/?/init.lua;" .. package.path
package.cpath = here .. "bin/?.so;" .. package.cpath
local dkjson = require("dkjson")

local M = 0xFFFFFFFF
local COUNTRIES = { "US", "GB", "DE", "FR", "JP", "BR", "IN", "CN", "CA", "AU", "NO", "SE", "ZA", "NG", "MX", "ES", "IT", "KR", "NL", "PL" }
local LEVELS = { "INFO", "WARN", "ERROR", "DEBUG" }
local RESOURCES = { "users", "orders", "items", "auth", "search" }
local STATUSES = { 200, 200, 200, 201, 404, 500 }

local now_ns = require("clashclock")

local function emit(t)
  io.write(dkjson.encode(t), "\n")
  io.flush()
end

emit({ e = "hello", lang = "lua" })

local state
local function rng_next()
  local x = state
  x = x ~ ((x << 13) & M)
  x = x ~ (x >> 17)
  x = x ~ ((x << 5) & M)
  state = x
  return x
end
local function rng_int(n)
  return rng_next() % n
end

local function fold(h, v)
  return (h * 31 + v) & M
end
local function fnv1a(s)
  local h = 0x811C9DC5
  for i = 1, #s do
    h = ((h ~ s:byte(i)) * 0x01000193) & M
  end
  return h
end
local function fold_all(t)
  local h = 0
  for i = 1, #t do
    h = fold(h, t[i])
  end
  return h
end
local function identity(x)
  return x
end

local challenges = {}

challenges.sort = {
  gen = function(n)
    local data = {}
    for i = 1, n do
      data[i] = rng_next() & 0x7FFFFFFF
    end
    return data, fold_all(data), n
  end,
  prepare = function(data)
    return table.move(data, 1, #data, 1, {})
  end,
  run = function(work)
    table.sort(work)
    return work
  end,
  check = fold_all,
}

local KEY_ORDER = { keyorder = { "country", "id", "name", "score2", "tagCount" } }
challenges.json = {
  gen = function(n)
    local parts = {}
    for i = 0, n - 1 do
      local country = COUNTRIES[rng_int(20) + 1]
      local age = 10 + rng_int(80)
      local score = rng_int(1000)
      local active = (rng_next() & 1) == 1 and "true" or "false"
      local t1, t2 = rng_int(10), rng_int(10)
      parts[#parts + 1] = string.format('{"id":%d,"name":"user_%d","country":"%s","age":%d,"score":%d,"active":%s,"tags":["t%d","t%d"]}', i, i, country, age, score, active, t1, t2)
    end
    local text = "[" .. table.concat(parts, ",") .. "]"
    return text, fnv1a(text), n
  end,
  prepare = identity,
  run = function(text)
    local records = dkjson.decode(text)
    local out = {}
    for _, r in ipairs(records) do
      if r.active and r.score >= 500 then
        out[#out + 1] = { country = r.country, id = r.id, name = r.name:upper(), score2 = r.score * 2, tagCount = #r.tags }
      end
    end
    return dkjson.encode(out, KEY_ORDER)
  end,
  check = fnv1a,
}

challenges.strings = {
  gen = function(n)
    local lines = {}
    for i = 0, n - 1 do
      local level = LEVELS[rng_int(4) + 1]
      local user = rng_int(1000)
      local res = RESOURCES[rng_int(5) + 1]
      local id = rng_int(10000)
      local status = STATUSES[rng_int(6) + 1]
      local latency = rng_int(2000)
      lines[#lines + 1] = string.format("ts=%d level=%s user=u%d path=/api/%s/%d status=%d latency=%dms", 1700000000 + i, level, user, res, id, status, latency)
    end
    local text = table.concat(lines, "\n")
    return text, fnv1a(text), n
  end,
  prepare = identity,
  run = function(text)
    local lines, s5xx, errors, latency, tokens = 0, 0, 0, 0, 0
    for line in (text .. "\n"):gmatch("(.-)\n") do
      lines = lines + 1
      local status, lat = line:match("status=(%d%d%d) latency=(%d+)ms")
      if status then
        if tonumber(status) >= 500 then
          s5xx = s5xx + 1
        end
        latency = latency + tonumber(lat)
      end
      if line:find("level=ERROR", 1, true) then
        errors = errors + 1
      end
      local _, spaces = line:gsub(" ", " ")
      tokens = tokens + spaces + 1
    end
    return { lines, s5xx, errors, latency & M, tokens }
  end,
  check = fold_all,
}

challenges.sieve = {
  gen = function(n)
    return n, n & M, n
  end,
  prepare = identity,
  run = function(n)
    local composite = {}
    for i = 0, n do
      composite[i] = false
    end
    local i = 2
    while i * i <= n do
      if not composite[i] then
        for j = i * i, n, i do
          composite[j] = true
        end
      end
      i = i + 1
    end
    local count, sum = 0, 0
    for k = 2, n do
      if not composite[k] then
        count = count + 1
        sum = sum + k
      end
    end
    return { count, sum & M }
  end,
  check = fold_all,
}

challenges.records = {
  gen = function(n)
    local records, h = {}, 0
    for i = 0, n - 1 do
      local c = rng_int(20)
      local age = 10 + rng_int(80)
      local score = rng_int(1000)
      local created_at = 1700000000 + rng_int(31536000)
      records[#records + 1] = { id = i, name = "user_" .. i, country = COUNTRIES[c + 1], age = age, score = score, created_at = created_at }
      h = fold(fold(fold(fold(h, c), age), score), created_at)
    end
    return records, h, n
  end,
  prepare = identity,
  run = function(records)
    local cutoff = 1700000000 + 15768000
    local groups, list = {}, {}
    for _, r in ipairs(records) do
      if r.age >= 18 and r.score >= 100 and r.created_at >= cutoff then
        local g = groups[r.country]
        if not g then
          g = { country = r.country, count = 0, sum = 0, max = 0, age_sum = 0 }
          groups[r.country] = g
          list[#list + 1] = g
        end
        g.count = g.count + 1
        g.sum = g.sum + r.score
        if r.score > g.max then
          g.max = r.score
        end
        g.age_sum = g.age_sum + r.age
      end
    end
    table.sort(list, function(a, b)
      if a.sum ~= b.sum then
        return a.sum > b.sum
      end
      return a.country < b.country
    end)
    return list
  end,
  check = function(groups)
    local h = 0
    for _, g in ipairs(groups) do
      h = fold(h, fnv1a(g.country))
      h = fold(h, g.count)
      h = fold(h, g.sum & M)
      h = fold(h, g.max)
      h = fold(h, g.age_sum & M)
    end
    return h
  end,
}

challenges.search = {
  gen = function(n)
    local keys, queries, all = {}, {}, {}
    for i = 1, n do
      keys[i] = rng_next() & 0x7FFFFFFF
      all[i] = keys[i]
    end
    for i = 0, n - 1 do
      queries[i + 1] = (i & 1) == 0 and keys[rng_int(n) + 1] or (rng_next() & 0x7FFFFFFF)
      all[n + i + 1] = queries[i + 1]
    end
    return { keys, queries }, fold_all(all), 2 * n
  end,
  prepare = identity,
  run = function(input)
    local keys, queries = input[1], input[2]
    local phases = {}
    local t = now_ns()
    local function lap()
      local now = now_ns()
      phases[#phases + 1] = now - t
      t = now
    end
    local index = {}
    for i = 1, #keys do
      index[keys[i]] = i - 1
    end
    lap()
    local hits, sum = 0, 0
    for _, q in ipairs(queries) do
      local v = index[q]
      if v then
        hits = hits + 1
        sum = sum + v
      end
    end
    lap()
    local sorted = table.move(keys, 1, #keys, 1, {})
    table.sort(sorted)
    lap()
    local bin_hits, size = 0, #sorted
    for _, q in ipairs(queries) do
      local lo, hi = 1, size + 1
      while lo < hi do
        local mid = (lo + hi) // 2
        if sorted[mid] < q then
          lo = mid + 1
        else
          hi = mid
        end
      end
      if lo <= size and sorted[lo] == q then
        bin_hits = bin_hits + 1
      end
    end
    lap()
    return { result = { hits, sum & M, bin_hits }, phases = phases }
  end,
  check = function(r)
    return fold_all(r.result)
  end,
}

local REGIONS = { "NA", "EMEA", "APAC", "LATAM", "ANZ", "MEA", "NORDICS", "DACH" }

challenges.csv = {
  gen = function(n)
    local lines = { "order_id,date,region,sku,qty,unit_price_cents,discount_pct" }
    for i = 0, n - 1 do
      local month = 1 + rng_int(12)
      local day = 1 + rng_int(28)
      local region = REGIONS[rng_int(8) + 1]
      local sku = rng_int(1000)
      local qty = 1 + rng_int(20)
      local price = 99 + rng_int(99901)
      local discount = 5 * rng_int(5)
      lines[#lines + 1] = string.format("%d,2026-%02d-%02d,%s,SKU-%d,%d,%d,%d", i, month, day, region, sku, qty, price, discount)
    end
    local text = table.concat(lines, "\n")
    return text, fnv1a(text), n
  end,
  prepare = identity,
  run = function(text)
    local groups, list = {}, {}
    local header = true
    for line in (text .. "\n"):gmatch("(.-)\n") do
      if header then
        header = false
      else
        local f, k = {}, 0
        for field in line:gmatch("[^,]+") do
          k = k + 1
          f[k] = field
        end
        local month = tonumber(f[2]:sub(6, 7))
        local qty = tonumber(f[5])
        local revenue = qty * tonumber(f[6]) * (100 - tonumber(f[7])) // 100
        local key = f[3] .. "|" .. month
        local g = groups[key]
        if not g then
          g = { region = f[3], month = month, orders = 0, units = 0, revenue = 0 }
          groups[key] = g
          list[#list + 1] = g
        end
        g.orders = g.orders + 1
        g.units = g.units + qty
        g.revenue = g.revenue + revenue
      end
    end
    table.sort(list, function(a, b)
      if a.region ~= b.region then
        return a.region < b.region
      end
      return a.month < b.month
    end)
    local out = { "region,month,orders,units,revenue_cents" }
    for _, g in ipairs(list) do
      out[#out + 1] = string.format("%s,2026-%02d,%d,%d,%d", g.region, g.month, g.orders, g.units, g.revenue)
    end
    return table.concat(out, "\n")
  end,
  check = fnv1a,
}

challenges.metrics = {
  gen = function(n)
    local values = {}
    for i = 1, n do
      local v = 20 + rng_int(80)
      if rng_int(100) < 3 then
        v = v + 200 + rng_int(800)
      end
      values[i] = v
    end
    return values, fold_all(values), n
  end,
  prepare = identity,
  run = function(values)
    local n = #values
    local window, slow, peak, total = 0, 0, 0, 0
    for i = 1, n do
      window = window + values[i]
      total = total + values[i]
      if i > 60 then
        window = window - values[i - 60]
      end
      if i >= 60 then
        if window > 7200 then
          slow = slow + 1
        end
        if window > peak then
          peak = window
        end
      end
    end
    local buckets = 0
    for start = 1, n, 60 do
      local max = 0
      for i = start, math.min(start + 59, n) do
        if values[i] > max then
          max = values[i]
        end
      end
      buckets = fold(buckets, max)
    end
    local sorted = table.move(values, 1, n, 1, {})
    table.sort(sorted)
    local function rank(p)
      return sorted[(p * n + 99) // 100]
    end
    local mean_milli = total * 1000 // n
    return { slow, peak, buckets, rank(50), rank(95), rank(99), sorted[n], mean_milli & M }
  end,
  check = fold_all,
}

local NN_IN, NN_H, NN_OUT = 64, 64, 10

local function draw_ints(count, k, offset, h)
  local out = {}
  for i = 1, count do
    local raw = rng_int(k)
    h = fold(h, raw)
    out[i] = raw - offset
  end
  return out, h
end

challenges.infer = {
  gen = function(n)
    local h = 0
    local m = { n = n }
    m.w1, h = draw_ints(NN_H * NN_IN, 255, 127, h)
    m.b1, h = draw_ints(NN_H, 2001, 1000, h)
    m.w2, h = draw_ints(NN_H * NN_H, 255, 127, h)
    m.b2, h = draw_ints(NN_H, 2001, 1000, h)
    m.w3, h = draw_ints(NN_OUT * NN_H, 255, 127, h)
    m.b3, h = draw_ints(NN_OUT, 2001, 1000, h)
    m.x, h = draw_ints(n * NN_IN, 256, 128, h)
    return m, h, n
  end,
  prepare = identity,
  run = function(m)
    local h1, h2, logits = {}, {}, {}
    local function dense(w, b, input, in_off, in_len, out, out_len)
      for j = 1, out_len do
        local a = b[j]
        local row = (j - 1) * in_len
        for k = 1, in_len do
          a = a + w[row + k] * input[in_off + k]
        end
        out[j] = a
      end
    end
    local preds, conf = 0, 0
    for s = 0, m.n - 1 do
      dense(m.w1, m.b1, m.x, s * NN_IN, NN_IN, h1, NN_H)
      for j = 1, NN_H do
        h1[j] = math.min(127, math.max(0, h1[j]) // 1024)
      end
      dense(m.w2, m.b2, h1, 0, NN_H, h2, NN_H)
      for j = 1, NN_H do
        h2[j] = math.min(127, math.max(0, h2[j]) // 1024)
      end
      dense(m.w3, m.b3, h2, 0, NN_H, logits, NN_OUT)
      local pred = 1
      for o = 2, NN_OUT do
        if logits[o] > logits[pred] then
          pred = o
        end
      end
      preds = fold(preds, pred - 1)
      conf = (conf + logits[pred] + 4194304) & M
    end
    return { preds, conf }
  end,
  check = fold_all,
}

local EMB_D, EMB_Q, EMB_K = 64, 8, 10

challenges.embed = {
  gen = function(n)
    local h = 0
    local docs, queries
    docs, h = draw_ints(n * EMB_D, 256, 128, h)
    queries, h = draw_ints(EMB_Q * EMB_D, 256, 128, h)
    return { docs = docs, queries = queries, n = n }, h, n * EMB_Q
  end,
  prepare = identity,
  run = function(input)
    local docs, queries, n = input.docs, input.queries, input.n
    local results, scores, order = {}, {}, {}
    local function by_score(a, b)
      if scores[a] ~= scores[b] then
        return scores[a] > scores[b]
      end
      return a < b
    end
    for q = 0, EMB_Q - 1 do
      local qo = q * EMB_D
      for d = 1, n do
        local d_off = (d - 1) * EMB_D
        local s = 0
        for k = 1, EMB_D do
          s = s + docs[d_off + k] * queries[qo + k]
        end
        scores[d] = s
        order[d] = d
      end
      table.sort(order, by_score)
      for r = 1, EMB_K do
        results[#results + 1] = order[r] - 1
        results[#results + 1] = scores[order[r]] + 2097152
      end
    end
    return results
  end,
  check = fold_all,
}

challenges.pixel = {
  gen = function(n)
    local rgb, h = {}, 0
    for y = 0, n - 1 do
      for x = 0, n - 1 do
        local p = (y * n + x) * 3
        rgb[p + 1] = (x + y + rng_int(64)) % 256
        rgb[p + 2] = (2 * x + rng_int(64)) % 256
        rgb[p + 3] = (2 * y + rng_int(64)) % 256
        h = fold(fold(fold(h, rgb[p + 1]), rgb[p + 2]), rgb[p + 3])
      end
    end
    return { rgb = rgb, n = n }, h, n * n
  end,
  prepare = identity,
  run = function(input)
    local rgb, n = input.rgb, input.n
    local phases = {}
    local t = now_ns()
    local function lap()
      local now = now_ns()
      phases[#phases + 1] = now - t
      t = now
    end
    local function cl(v)
      if v < 0 then
        return 0
      elseif v >= n then
        return n - 1
      end
      return v
    end

    local gray = {}
    for i = 0, n * n - 1 do
      gray[i] = (77 * rgb[i * 3 + 1] + 150 * rgb[i * 3 + 2] + 29 * rgb[i * 3 + 3]) >> 8
    end
    lap()

    local blur = {}
    for y = 0, n - 1 do
      local ru, r0, rd = cl(y - 1) * n, y * n, cl(y + 1) * n
      for x = 0, n - 1 do
        local xl, xr = cl(x - 1), cl(x + 1)
        local s = gray[ru + xl] + 2 * gray[ru + x] + gray[ru + xr] + 2 * gray[r0 + xl] + 4 * gray[r0 + x] + 2 * gray[r0 + xr] + gray[rd + xl] + 2 * gray[rd + x] + gray[rd + xr]
        blur[r0 + x] = s >> 4
      end
    end
    lap()

    local mag = {}
    for y = 0, n - 1 do
      local ru, r0, rd = cl(y - 1) * n, y * n, cl(y + 1) * n
      for x = 0, n - 1 do
        local xl, xr = cl(x - 1), cl(x + 1)
        local gx = blur[ru + xr] + 2 * blur[r0 + xr] + blur[rd + xr] - (blur[ru + xl] + 2 * blur[r0 + xl] + blur[rd + xl])
        local gy = blur[rd + xl] + 2 * blur[rd + x] + blur[rd + xr] - (blur[ru + xl] + 2 * blur[ru + x] + blur[ru + xr])
        mag[r0 + x] = math.min(255, math.abs(gx) + math.abs(gy))
      end
    end
    lap()

    local hist, edges = {}, 0
    for b = 1, 256 do
      hist[b] = 0
    end
    for i = 0, n * n - 1 do
      local m = mag[i]
      hist[m + 1] = hist[m + 1] + 1
      if m >= 128 then
        edges = edges + 1
      end
    end
    lap()

    hist[257] = edges
    return { result = hist, phases = phases }
  end,
  check = function(r)
    return fold_all(r.result)
  end,
}

local ok, err = pcall(function()
  local name, size, seed, warmup, runs = arg[1], math.tointeger(tonumber(arg[2])), math.tointeger(tonumber(arg[3])), math.tointeger(tonumber(arg[4])), math.tointeger(tonumber(arg[5]))
  local c = challenges[name] or error("unknown challenge: " .. tostring(name), 0)
  state = (seed & M) ~= 0 and (seed & M) or 0x9E3779B9
  local g0 = now_ns()
  local input, hash, ops = c.gen(size)
  emit({ e = "ready", genNs = now_ns() - g0, input = string.format("%08x", hash), ops = ops })
  for i = 0, warmup + runs - 1 do
    local work = c.prepare(input)
    local t0 = now_ns()
    local out = c.run(work)
    local ns = now_ns() - t0
    local warm = i < warmup
    local event = { e = warm and "warmup" or "run", i = warm and i or i - warmup, ns = ns, check = string.format("%08x", c.check(out)) }
    if type(out) == "table" and out.phases then
      event.phases = out.phases
    end
    emit(event)
  end
  emit({ e = "done" })
end)
if not ok then
  emit({ e = "error", msg = tostring(err) })
  os.exit(1)
end
