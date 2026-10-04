defmodule Harness do
  import Bitwise

  @m 0xFFFFFFFF
  @countries ~w(US GB DE FR JP BR IN CN CA AU NO SE ZA NG MX ES IT KR NL PL) |> List.to_tuple()
  @levels ~w(INFO WARN ERROR DEBUG) |> List.to_tuple()
  @resources ~w(users orders items auth search) |> List.to_tuple()
  @statuses {200, 200, 200, 201, 404, 500}
  @regions ~w(NA EMEA APAC LATAM ANZ MEA NORDICS DACH) |> List.to_tuple()
  @nn_in 64
  @nn_h 64
  @nn_out 10
  @emb_d 64
  @emb_q 8
  @emb_k 10

  defp emit(iodata), do: IO.puts(iodata)
  defp now_ns, do: System.monotonic_time(:nanosecond)
  defp hex8(h), do: h |> Integer.to_string(16) |> String.downcase() |> String.pad_leading(8, "0")

  defp rng_seed(seed), do: Process.put(:rng, if((seed &&& @m) == 0, do: 0x9E3779B9, else: seed &&& @m))

  defp rng_next do
    x = Process.get(:rng)
    x = bxor(x, x <<< 13 &&& @m)
    x = bxor(x, x >>> 17)
    x = bxor(x, x <<< 5 &&& @m)
    Process.put(:rng, x)
    x
  end

  defp rng_int(n), do: rem(rng_next(), n)

  defp fold(h, v), do: h * 31 + v &&& @m
  defp fold_all(list), do: Enum.reduce(list, 0, &fold(&2, &1))
  defp fnv1a(bin), do: for(<<b <- bin>>, reduce: 0x811C9DC5, do: (h -> (bxor(h, b) * 0x01000193) &&& @m))

  defp gen("sort", n) do
    data = for _ <- 1..n//1, do: rng_next() &&& 0x7FFFFFFF
    {data, fold_all(data), n}
  end

  defp gen("json", n) do
    parts =
      for i <- 0..(n - 1)//1 do
        country = elem(@countries, rng_int(20))
        age = 10 + rng_int(80)
        score = rng_int(1000)
        active = (rng_next() &&& 1) == 1
        t1 = rng_int(10)
        t2 = rng_int(10)
        ~s({"id":#{i},"name":"user_#{i}","country":"#{country}","age":#{age},"score":#{score},"active":#{active},"tags":["t#{t1}","t#{t2}"]})
      end

    text = IO.iodata_to_binary(["[", Enum.intersperse(parts, ","), "]"])
    {text, fnv1a(text), n}
  end

  defp gen("strings", n) do
    lines =
      for i <- 0..(n - 1)//1 do
        level = elem(@levels, rng_int(4))
        user = rng_int(1000)
        res = elem(@resources, rng_int(5))
        id = rng_int(10000)
        status = elem(@statuses, rng_int(6))
        latency = rng_int(2000)
        "ts=#{1_700_000_000 + i} level=#{level} user=u#{user} path=/api/#{res}/#{id} status=#{status} latency=#{latency}ms"
      end

    text = Enum.join(lines, "\n")
    {text, fnv1a(text), n}
  end

  defp gen("sieve", n), do: {n, n &&& @m, n}

  defp gen("records", n) do
    {records, h} =
      Enum.map_reduce(0..(n - 1)//1, 0, fn i, h ->
        c = rng_int(20)
        age = 10 + rng_int(80)
        score = rng_int(1000)
        created_at = 1_700_000_000 + rng_int(31_536_000)
        rec = %{id: i, name: "user_#{i}", country: elem(@countries, c), age: age, score: score, created_at: created_at}
        {rec, h |> fold(c) |> fold(age) |> fold(score) |> fold(created_at)}
      end)

    {records, h, n}
  end

  defp gen("search", n) do
    keys = for _ <- 1..n//1, do: rng_next() &&& 0x7FFFFFFF
    key_tuple = List.to_tuple(keys)

    queries =
      for i <- 0..(n - 1)//1 do
        if (i &&& 1) == 0, do: elem(key_tuple, rng_int(n)), else: rng_next() &&& 0x7FFFFFFF
      end

    {{keys, queries}, fold_all(keys ++ queries), 2 * n}
  end

  defp gen("csv", n) do
    rows =
      for i <- 0..(n - 1)//1 do
        month = 1 + rng_int(12)
        day = 1 + rng_int(28)
        region = elem(@regions, rng_int(8))
        sku = rng_int(1000)
        qty = 1 + rng_int(20)
        price = 99 + rng_int(99901)
        discount = 5 * rng_int(5)
        "#{i},2026-#{pad2(month)}-#{pad2(day)},#{region},SKU-#{sku},#{qty},#{price},#{discount}"
      end

    text = Enum.join(["order_id,date,region,sku,qty,unit_price_cents,discount_pct" | rows], "\n")
    {text, fnv1a(text), n}
  end

  defp gen("metrics", n) do
    {values, h} =
      Enum.map_reduce(1..n//1, 0, fn _, h ->
        v = 20 + rng_int(80)
        v = if rng_int(100) < 3, do: v + 200 + rng_int(800), else: v
        {v, fold(h, v)}
      end)

    {values, h, n}
  end

  defp gen("infer", n) do
    {w1, h} = draw(@nn_h * @nn_in, 255, 127, 0)
    {b1, h} = draw(@nn_h, 2001, 1000, h)
    {w2, h} = draw(@nn_h * @nn_h, 255, 127, h)
    {b2, h} = draw(@nn_h, 2001, 1000, h)
    {w3, h} = draw(@nn_out * @nn_h, 255, 127, h)
    {b3, h} = draw(@nn_out, 2001, 1000, h)
    {x, h} = draw(n * @nn_in, 256, 128, h)
    {{Enum.chunk_every(w1, @nn_in), b1, Enum.chunk_every(w2, @nn_h), b2, Enum.chunk_every(w3, @nn_h), b3, Enum.chunk_every(x, @nn_in)}, h, n}
  end

  defp gen("embed", n) do
    {docs, h} = draw(n * @emb_d, 256, 128, 0)
    {queries, h} = draw(@emb_q * @emb_d, 256, 128, h)
    {{Enum.chunk_every(docs, @emb_d), Enum.chunk_every(queries, @emb_d)}, h, n * @emb_q}
  end

  defp gen("pixel", n) do
    rgb =
      for y <- 0..(n - 1)//1, x <- 0..(n - 1)//1, into: <<>> do
        r = rem(x + y + rng_int(64), 256)
        g = rem(2 * x + rng_int(64), 256)
        b = rem(2 * y + rng_int(64), 256)
        <<r, g, b>>
      end

    {{rgb, n}, fold_bytes(rgb), n * n}
  end

  defp pad2(v), do: v |> Integer.to_string() |> String.pad_leading(2, "0")

  defp draw(count, k, offset, h) do
    Enum.map_reduce(1..count//1, h, fn _, h ->
      raw = rng_int(k)
      {raw - offset, fold(h, raw)}
    end)
  end

  defp fold_bytes(bin), do: for(<<b <- bin>>, reduce: 0, do: (h -> fold(h, b)))

  defp run("sort", data), do: {Enum.sort(data), nil}

  defp run("json", text) do
    out =
      text
      |> JSON.decode!()
      |> Enum.filter(&(&1["active"] and &1["score"] >= 500))
      |> Enum.map(&%{"country" => &1["country"], "id" => &1["id"], "name" => String.upcase(&1["name"]), "score2" => &1["score"] * 2, "tagCount" => length(&1["tags"])})

    {JSON.encode!(out), nil}
  end

  defp run("strings", text) do
    pattern = ~r/status=(\d{3}) latency=(\d+)ms/

    {lines, s5xx, errors, latency, tokens} =
      text
      |> String.split("\n")
      |> Enum.reduce({0, 0, 0, 0, 0}, fn line, {l, s, e, lat, t} ->
        {s, lat} =
          case Regex.run(pattern, line, capture: :all_but_first) do
            [status, la] -> {if(String.to_integer(status) >= 500, do: s + 1, else: s), lat + String.to_integer(la)}
            nil -> {s, lat}
          end

        e = if String.contains?(line, "level=ERROR"), do: e + 1, else: e
        {l + 1, s, e, lat, t + length(String.split(line, " "))}
      end)

    {[lines, s5xx, errors, latency &&& @m, tokens], nil}
  end

  defp run("sieve", n) do
    composite = :atomics.new(n + 1, signed: false)
    mark(2, n, composite)
    {count, sum} = sweep(2, n, composite, 0, 0)
    {[count, sum &&& @m], nil}
  end

  defp run("records", records) do
    cutoff = 1_700_000_000 + 15_768_000

    groups =
      records
      |> Enum.filter(&(&1.age >= 18 and &1.score >= 100 and &1.created_at >= cutoff))
      |> Enum.reduce(%{}, fn r, acc ->
        Map.update(acc, r.country, {1, r.score, r.score, r.age}, fn {c, s, mx, a} -> {c + 1, s + r.score, max(mx, r.score), a + r.age} end)
      end)
      |> Enum.sort_by(fn {country, {_, sum, _, _}} -> {-sum, country} end)

    {groups, nil}
  end

  defp run("search", {keys, queries}) do
    t0 = now_ns()
    index = keys |> Enum.with_index() |> Map.new()
    t1 = now_ns()

    {hits, sum} =
      Enum.reduce(queries, {0, 0}, fn q, {h, s} ->
        case index do
          %{^q => v} -> {h + 1, s + v}
          _ -> {h, s}
        end
      end)

    t2 = now_ns()
    sorted = keys |> Enum.sort() |> List.to_tuple()
    t3 = now_ns()
    size = tuple_size(sorted)
    bin_hits = Enum.count(queries, &bsearch(sorted, &1, 0, size))
    t4 = now_ns()
    {[hits, sum &&& @m, bin_hits], [t1 - t0, t2 - t1, t3 - t2, t4 - t3]}
  end

  defp run("csv", text) do
    [_header | lines] = String.split(text, "\n")

    groups =
      Enum.reduce(lines, %{}, fn line, acc ->
        [_id, date, region, _sku, qty, price, discount] = String.split(line, ",")
        qty = String.to_integer(qty)
        revenue = div(qty * String.to_integer(price) * (100 - String.to_integer(discount)), 100)
        key = {region, date |> binary_part(5, 2) |> String.to_integer()}
        Map.update(acc, key, {1, qty, revenue}, fn {o, u, r} -> {o + 1, u + qty, r + revenue} end)
      end)

    rows = for {{region, month}, {o, u, r}} <- Enum.sort(groups), do: "#{region},2026-#{pad2(month)},#{o},#{u},#{r}"
    {Enum.join(["region,month,orders,units,revenue_cents" | rows], "\n"), nil}
  end

  defp run("metrics", values) do
    n = length(values)
    {first, rest} = Enum.split(values, 60)
    w0 = Enum.sum(first)

    {_, slow, peak} =
      Enum.zip_reduce(rest, values, {w0, if(w0 > 7200, do: 1, else: 0), w0}, fn add, drop, {w, s, p} ->
        w = w + add - drop
        {w, if(w > 7200, do: s + 1, else: s), max(p, w)}
      end)

    buckets = values |> Enum.chunk_every(60) |> Enum.map(&Enum.max/1) |> fold_all()
    sorted = values |> Enum.sort() |> List.to_tuple()
    rank = fn p -> elem(sorted, div(p * n + 99, 100) - 1) end
    mean_milli = div(Enum.sum(values) * 1000, n)
    {[slow, peak, buckets, rank.(50), rank.(95), rank.(99), elem(sorted, n - 1), mean_milli &&& @m], nil}
  end

  defp run("infer", {w1, b1, w2, b2, w3, b3, xs}) do
    {preds, conf} =
      Enum.reduce(xs, {0, 0}, fn x, {p, c} ->
        h1 = w1 |> dense(b1, x) |> Enum.map(&min(127, div(max(0, &1), 1024)))
        h2 = w2 |> dense(b2, h1) |> Enum.map(&min(127, div(max(0, &1), 1024)))
        {best, pred} = w3 |> dense(b3, h2) |> Enum.with_index() |> Enum.max_by(&elem(&1, 0))
        {fold(p, pred), (c + best + 4_194_304) &&& @m}
      end)

    {[preds, conf], nil}
  end

  defp run("embed", {docs, queries}) do
    indexed = Enum.with_index(docs)

    results =
      Enum.flat_map(queries, fn q ->
        indexed
        |> Enum.map(fn {d, i} -> {dot(d, q), i} end)
        |> Enum.sort_by(fn {s, i} -> {-s, i} end)
        |> Enum.take(@emb_k)
        |> Enum.flat_map(fn {s, i} -> [i, s + 2_097_152] end)
      end)

    {results, nil}
  end

  defp run("pixel", {rgb, n}) do
    t0 = now_ns()
    gray = for <<r, g, b <- rgb>>, into: <<>>, do: <<bsr(77 * r + 150 * g + 29 * b, 8)>>
    t1 = now_ns()
    blur = for y <- 0..(n - 1)//1, into: <<>>, do: blur_row(gray, n, y)
    t2 = now_ns()
    mag = for y <- 0..(n - 1)//1, into: <<>>, do: sobel_row(blur, n, y)
    t3 = now_ns()
    hist = :atomics.new(256, signed: false)

    edges =
      for <<m <- mag>>, reduce: 0 do
        e ->
          :atomics.add(hist, m + 1, 1)
          if m >= 128, do: e + 1, else: e
      end

    bins = for i <- 1..256, do: :atomics.get(hist, i)
    t4 = now_ns()
    {bins ++ [edges], [t1 - t0, t2 - t1, t3 - t2, t4 - t3]}
  end

  defp dot(a, b), do: Enum.zip_reduce(a, b, 0, fn x, y, acc -> acc + x * y end)
  defp dense(w, b, x), do: Enum.zip_with(w, b, fn row, bias -> bias + dot(row, x) end)

  defp clamp(v, _n) when v < 0, do: 0
  defp clamp(v, n) when v >= n, do: n - 1
  defp clamp(v, _n), do: v

  defp blur_row(gray, n, y) do
    ru = clamp(y - 1, n) * n
    r0 = y * n
    rd = clamp(y + 1, n) * n
    at = &:binary.at(gray, &1)

    for x <- 0..(n - 1)//1, into: <<>> do
      xl = clamp(x - 1, n)
      xr = clamp(x + 1, n)
      s = at.(ru + xl) + 2 * at.(ru + x) + at.(ru + xr) + 2 * at.(r0 + xl) + 4 * at.(r0 + x) + 2 * at.(r0 + xr) + at.(rd + xl) + 2 * at.(rd + x) + at.(rd + xr)
      <<bsr(s, 4)>>
    end
  end

  defp sobel_row(blur, n, y) do
    ru = clamp(y - 1, n) * n
    r0 = y * n
    rd = clamp(y + 1, n) * n
    at = &:binary.at(blur, &1)

    for x <- 0..(n - 1)//1, into: <<>> do
      xl = clamp(x - 1, n)
      xr = clamp(x + 1, n)
      gx = at.(ru + xr) + 2 * at.(r0 + xr) + at.(rd + xr) - (at.(ru + xl) + 2 * at.(r0 + xl) + at.(rd + xl))
      gy = at.(rd + xl) + 2 * at.(rd + x) + at.(rd + xr) - (at.(ru + xl) + 2 * at.(ru + x) + at.(ru + xr))
      <<min(255, abs(gx) + abs(gy))>>
    end
  end

  defp mark(i, n, _a) when i * i > n, do: :ok

  defp mark(i, n, a) do
    if :atomics.get(a, i + 1) == 0, do: cross(i * i, i, n, a)
    mark(i + 1, n, a)
  end

  defp cross(j, _i, n, _a) when j > n, do: :ok
  defp cross(j, i, n, a), do: (:atomics.put(a, j + 1, 1); cross(j + i, i, n, a))

  defp sweep(k, n, _a, c, s) when k > n, do: {c, s}
  defp sweep(k, n, a, c, s), do: if(:atomics.get(a, k + 1) == 0, do: sweep(k + 1, n, a, c + 1, s + k), else: sweep(k + 1, n, a, c, s))

  defp bsearch(t, q, lo, hi) when lo < hi do
    mid = div(lo + hi, 2)
    if elem(t, mid) < q, do: bsearch(t, q, mid + 1, hi), else: bsearch(t, q, lo, mid)
  end

  defp bsearch(t, q, lo, _hi), do: lo < tuple_size(t) and elem(t, lo) == q

  defp check("sort", sorted), do: fold_all(sorted)
  defp check("json", json), do: fnv1a(json)
  defp check("csv", report), do: fnv1a(report)

  defp check("records", groups) do
    Enum.reduce(groups, 0, fn {country, {c, s, mx, a}}, h ->
      h |> fold(fnv1a(country)) |> fold(c) |> fold(s &&& @m) |> fold(mx) |> fold(a &&& @m)
    end)
  end

  defp check(_, counters), do: fold_all(counters)

  def main(args) do
    emit(~s({"e":"hello","lang":"elixir"}))

    try do
      [name, size, seed, warmup, runs | _] = args
      unless name in ~w(sort json strings sieve records search csv metrics infer embed pixel), do: raise("unknown challenge: #{name}")
      [size, seed, warmup, runs] = Enum.map([size, seed, warmup, runs], &String.to_integer/1)
      rng_seed(seed)
      g0 = now_ns()
      {input, hash, ops} = gen(name, size)
      emit(~s({"e":"ready","genNs":#{now_ns() - g0},"input":"#{hex8(hash)}","ops":#{ops}}))

      for i <- 0..(warmup + runs - 1)//1 do
        t0 = now_ns()
        {out, phases} = run(name, input)
        ns = now_ns() - t0
        warm = i < warmup
        phases_json = if phases, do: ~s(,"phases":[#{Enum.join(phases, ",")}]), else: ""
        emit(~s({"e":"#{if warm, do: "warmup", else: "run"}","i":#{if warm, do: i, else: i - warmup},"ns":#{ns},"check":"#{hex8(check(name, out))}"#{phases_json}}))
      end

      emit(~s({"e":"done"}))
    rescue
      e ->
        emit(~s({"e":"error","msg":#{JSON.encode!(Exception.message(e))}}))
        System.halt(1)
    end
  end
end
