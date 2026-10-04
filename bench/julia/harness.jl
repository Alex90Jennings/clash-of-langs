using JSON3

const M = 0xFFFFFFFF
const COUNTRIES = ["US", "GB", "DE", "FR", "JP", "BR", "IN", "CN", "CA", "AU", "NO", "SE", "ZA", "NG", "MX", "ES", "IT", "KR", "NL", "PL"]
const LEVELS = ["INFO", "WARN", "ERROR", "DEBUG"]
const RESOURCES = ["users", "orders", "items", "auth", "search"]
const STATUSES = [200, 200, 200, 201, 404, 500]

emit(s::AbstractString) = (println(stdout, s); flush(stdout))
hex8(h) = string(UInt32(h & M), base=16, pad=8)

mutable struct Rng
    s::UInt32
end
Rng(seed::Integer) = Rng(UInt32(seed & M) == 0 ? 0x9e3779b9 : UInt32(seed & M))
function next!(r::Rng)
    x = r.s
    x ⊻= x << 13
    x ⊻= x >> 17
    x ⊻= x << 5
    r.s = x
    return x
end
rint(r::Rng, n) = Int(next!(r) % UInt32(n))

fold(h::UInt32, v::Integer) = h * UInt32(31) + (v % UInt32)
fold_all(vs) = foldl(fold, vs; init=UInt32(0))
function fnv1a(s::AbstractString)
    h = 0x811c9dc5
    for b in codeunits(s)
        h = (h ⊻ b) * 0x01000193
    end
    return h
end

sort_gen(n, r) = (d = Int32[next!(r) & 0x7fffffff for _ in 1:n]; (d, fold_all(d), n))
sort_prepare(d) = copy(d)
sort_run(w) = (sort!(w); (w, nothing))
sort_check(w) = fold_all(w)

function json_gen(n, r)
    io = IOBuffer()
    write(io, '[')
    for i in 0:n-1
        country = COUNTRIES[rint(r, 20)+1]
        age = 10 + rint(r, 80)
        score = rint(r, 1000)
        active = (next!(r) & 1) == 1
        t1 = rint(r, 10)
        t2 = rint(r, 10)
        i > 0 && write(io, ',')
        print(io, "{\"id\":$i,\"name\":\"user_$i\",\"country\":\"$country\",\"age\":$age,\"score\":$score,\"active\":$active,\"tags\":[\"t$t1\",\"t$t2\"]}")
    end
    write(io, ']')
    text = String(take!(io))
    return (text, fnv1a(text), n)
end
function json_run(text)
    records = JSON3.read(text)
    out = [(country=r.country, id=r.id, name=uppercase(r.name), score2=r.score * 2, tagCount=length(r.tags)) for r in records if r.active && r.score >= 500]
    return (JSON3.write(out), nothing)
end

function strings_gen(n, r)
    lines = Vector{String}(undef, n)
    for i in 0:n-1
        level = LEVELS[rint(r, 4)+1]
        user = rint(r, 1000)
        res = RESOURCES[rint(r, 5)+1]
        id = rint(r, 10000)
        status = STATUSES[rint(r, 6)+1]
        latency = rint(r, 2000)
        lines[i+1] = "ts=$(1700000000 + i) level=$level user=u$user path=/api/$res/$id status=$status latency=$(latency)ms"
    end
    text = join(lines, '\n')
    return (text, fnv1a(text), n)
end
function strings_run(text)
    pattern = r"status=(\d{3}) latency=(\d+)ms"
    lines = s5xx = errors = latency = tokens = 0
    for line in eachsplit(text, '\n')
        lines += 1
        m = match(pattern, line)
        if m !== nothing
            parse(Int, m.captures[1]) >= 500 && (s5xx += 1)
            latency += parse(Int, m.captures[2])
        end
        occursin("level=ERROR", line) && (errors += 1)
        tokens += count(_ -> true, eachsplit(line, ' '))
    end
    return ([lines, s5xx, errors, latency & M, tokens], nothing)
end

function sieve_run(n)
    composite = falses(n + 1)
    i = 2
    while i * i <= n
        if !composite[i+1]
            for j in i*i:i:n
                composite[j+1] = true
            end
        end
        i += 1
    end
    count = 0
    total = 0
    for k in 2:n
        if !composite[k+1]
            count += 1
            total += k
        end
    end
    return ([count, total & M], nothing)
end

struct Rec
    id::Int
    name::String
    country::String
    age::Int
    score::Int
    created_at::Int
end
mutable struct Agg
    country::String
    count::Int
    sum::Int
    max::Int
    age_sum::Int
end
function records_gen(n, r)
    h = UInt32(0)
    recs = Vector{Rec}(undef, n)
    for i in 0:n-1
        c = rint(r, 20)
        age = 10 + rint(r, 80)
        score = rint(r, 1000)
        created = 1700000000 + rint(r, 31536000)
        recs[i+1] = Rec(i, "user_$i", COUNTRIES[c+1], age, score, created)
        h = fold(fold(fold(fold(h, c), age), score), created)
    end
    return (recs, h, n)
end
function records_run(recs)
    cutoff = 1700000000 + 15768000
    groups = Dict{String,Agg}()
    for r in recs
        (r.age >= 18 && r.score >= 100 && r.created_at >= cutoff) || continue
        g = get!(() -> Agg(r.country, 0, 0, 0, 0), groups, r.country)
        g.count += 1
        g.sum += r.score
        g.max = max(g.max, r.score)
        g.age_sum += r.age
    end
    return (sort!(collect(values(groups)); by=g -> (-g.sum, g.country)), nothing)
end
function records_check(groups)
    h = UInt32(0)
    for g in groups
        h = fold(h, fnv1a(g.country))
        h = fold(h, g.count)
        h = fold(h, g.sum & M)
        h = fold(h, g.max)
        h = fold(h, g.age_sum & M)
    end
    return h
end

function search_gen(n, r)
    keys = Int32[next!(r) & 0x7fffffff for _ in 1:n]
    queries = Int32[iseven(i) ? keys[rint(r, n)+1] : Int32(next!(r) & 0x7fffffff) for i in 0:n-1]
    return ((keys, queries), fold_all(vcat(keys, queries)), 2n)
end
function search_run((keys, queries))
    phases = Int[]
    t = time_ns()
    lap() = (now = time_ns(); push!(phases, Int(now - t)); t = now)
    index = Dict{Int32,Int}()
    for (i, k) in enumerate(keys)
        index[k] = i - 1
    end
    lap()
    hits = 0
    total = 0
    for q in queries
        v = get(index, q, -1)
        if v >= 0
            hits += 1
            total += v
        end
    end
    lap()
    sorted = sort(keys)
    lap()
    bin_hits = 0
    for q in queries
        k = searchsortedfirst(sorted, q)
        (k <= length(sorted) && sorted[k] == q) && (bin_hits += 1)
    end
    lap()
    return ([hits, total & M, bin_hits], phases)
end

const REGIONS = ["NA", "EMEA", "APAC", "LATAM", "ANZ", "MEA", "NORDICS", "DACH"]
pad2(v) = lpad(v, 2, '0')

mutable struct CsvGroup
    orders::Int
    units::Int
    revenue::Int
end
function csv_gen(n, r)
    io = IOBuffer()
    print(io, "order_id,date,region,sku,qty,unit_price_cents,discount_pct")
    for i in 0:n-1
        month = 1 + rint(r, 12)
        day = 1 + rint(r, 28)
        region = REGIONS[rint(r, 8)+1]
        sku = rint(r, 1000)
        qty = 1 + rint(r, 20)
        price = 99 + rint(r, 99901)
        discount = 5 * rint(r, 5)
        print(io, "\n$i,2026-$(pad2(month))-$(pad2(day)),$region,SKU-$sku,$qty,$price,$discount")
    end
    text = String(take!(io))
    return (text, fnv1a(text), n)
end
function csv_run(text)
    groups = Dict{Tuple{SubString{String},Int},CsvGroup}()
    for line in Iterators.drop(eachsplit(text, '\n'), 1)
        f = split(line, ',')
        month = parse(Int, f[2][6:7])
        qty = parse(Int, f[5])
        revenue = div(qty * parse(Int, f[6]) * (100 - parse(Int, f[7])), 100)
        g = get!(() -> CsvGroup(0, 0, 0), groups, (f[3], month))
        g.orders += 1
        g.units += qty
        g.revenue += revenue
    end
    io = IOBuffer()
    print(io, "region,month,orders,units,revenue_cents")
    for ((region, month), g) in sort!(collect(groups); by=first)
        print(io, "\n$region,2026-$(pad2(month)),$(g.orders),$(g.units),$(g.revenue)")
    end
    return (String(take!(io)), nothing)
end

function metrics_gen(n, r)
    values = Vector{Int}(undef, n)
    for i in 1:n
        v = 20 + rint(r, 80)
        rint(r, 100) < 3 && (v += 200 + rint(r, 800))
        values[i] = v
    end
    return (values, fold_all(values), n)
end
function metrics_run(values)
    n = length(values)
    window = slow = peak = 0
    for i in 1:n
        window += values[i]
        i > 60 && (window -= values[i-60])
        if i >= 60
            window > 7200 && (slow += 1)
            peak = max(peak, window)
        end
    end
    buckets = fold_all(maximum(@view values[s:min(s + 59, n)]) for s in 1:60:n)
    sorted = sort(values)
    rank(p) = sorted[div(p * n + 99, 100)]
    mean_milli = div(sum(values) * 1000, n)
    return ([slow, peak, buckets, rank(50), rank(95), rank(99), sorted[end], mean_milli & M], nothing)
end

const NN_IN, NN_H, NN_OUT = 64, 64, 10
struct Mlp
    w1::Matrix{Int}
    b1::Vector{Int}
    w2::Matrix{Int}
    b2::Vector{Int}
    w3::Matrix{Int}
    b3::Vector{Int}
    x::Matrix{Int}
end
function infer_gen(n, r)
    h = UInt32(0)
    draw(count, k, offset) = [(raw = rint(r, k); h = fold(h, raw); raw - offset) for _ in 1:count]
    weights(rows, cols) = permutedims(reshape(draw(rows * cols, 255, 127), cols, rows))
    w1 = weights(NN_H, NN_IN)
    b1 = draw(NN_H, 2001, 1000)
    w2 = weights(NN_H, NN_H)
    b2 = draw(NN_H, 2001, 1000)
    w3 = weights(NN_OUT, NN_H)
    b3 = draw(NN_OUT, 2001, 1000)
    x = reshape(draw(n * NN_IN, 256, 128), NN_IN, n)
    return (Mlp(w1, b1, w2, b2, w3, b3, x), h, n)
end
function infer_run(m::Mlp)
    relu(a) = clamp(div(a, 1024), 0, 127)
    h1 = relu.(m.w1 * m.x .+ m.b1)
    h2 = relu.(m.w2 * h1 .+ m.b2)
    logits = m.w3 * h2 .+ m.b3
    preds = UInt32(0)
    conf = 0
    for col in eachcol(logits)
        pred = argmax(col)
        preds = fold(preds, pred - 1)
        conf = (conf + col[pred] + 4194304) & M
    end
    return ([preds, conf], nothing)
end

const EMB_D, EMB_Q, EMB_K = 64, 8, 10
function embed_gen(n, r)
    h = UInt32(0)
    draw(count) = reshape([(raw = rint(r, 256); h = fold(h, raw); raw - 128) for _ in 1:count*EMB_D], EMB_D, count)
    docs = draw(n)
    queries = draw(EMB_Q)
    return ((docs, queries), h, n * EMB_Q)
end
function embed_run((docs, queries))
    scores = docs' * queries
    results = Int[]
    for s in eachcol(scores)
        for d in sortperm(s; rev=true)[1:EMB_K]
            push!(results, d - 1, s[d] + 2097152)
        end
    end
    return (results, nothing)
end

function pixel_gen(n, r)
    rgb = zeros(Int, 3, n, n)
    h = UInt32(0)
    for y in 0:n-1, x in 0:n-1
        rgb[1, x+1, y+1] = (x + y + rint(r, 64)) % 256
        rgb[2, x+1, y+1] = (2x + rint(r, 64)) % 256
        rgb[3, x+1, y+1] = (2y + rint(r, 64)) % 256
        h = fold(fold(fold(h, rgb[1, x+1, y+1]), rgb[2, x+1, y+1]), rgb[3, x+1, y+1])
    end
    return ((rgb, n), h, n * n)
end
function pixel_run((rgb, n))
    phases = Int[]
    t = time_ns()
    lap() = (now = time_ns(); push!(phases, Int(now - t)); t = now)
    gray = [(77rgb[1, x, y] + 150rgb[2, x, y] + 29rgb[3, x, y]) >> 8 for x in 1:n, y in 1:n]
    lap()
    blur = similar(gray)
    for y in 1:n, x in 1:n
        yu, yd, xl, xr = max(y - 1, 1), min(y + 1, n), max(x - 1, 1), min(x + 1, n)
        blur[x, y] = (gray[xl, yu] + 2gray[x, yu] + gray[xr, yu] + 2gray[xl, y] + 4gray[x, y] + 2gray[xr, y] + gray[xl, yd] + 2gray[x, yd] + gray[xr, yd]) >> 4
    end
    lap()
    mag = similar(blur)
    for y in 1:n, x in 1:n
        yu, yd, xl, xr = max(y - 1, 1), min(y + 1, n), max(x - 1, 1), min(x + 1, n)
        gx = blur[xr, yu] + 2blur[xr, y] + blur[xr, yd] - (blur[xl, yu] + 2blur[xl, y] + blur[xl, yd])
        gy = blur[xl, yd] + 2blur[x, yd] + blur[xr, yd] - (blur[xl, yu] + 2blur[x, yu] + blur[xr, yu])
        mag[x, y] = min(255, abs(gx) + abs(gy))
    end
    lap()
    hist = zeros(Int, 256)
    for v in mag
        hist[v+1] += 1
    end
    edges = count(>=(128), mag)
    lap()
    return ([hist; edges], phases)
end

identity_prepare(x) = x
const CHALLENGES = Dict(
    "sort" => (sort_gen, sort_prepare, sort_run, sort_check),
    "json" => (json_gen, identity_prepare, json_run, fnv1a),
    "strings" => (strings_gen, identity_prepare, strings_run, fold_all),
    "sieve" => ((n, r) -> (n, UInt32(n & M), n), identity_prepare, sieve_run, fold_all),
    "records" => (records_gen, identity_prepare, records_run, records_check),
    "search" => (search_gen, identity_prepare, search_run, fold_all),
    "csv" => (csv_gen, identity_prepare, csv_run, fnv1a),
    "metrics" => (metrics_gen, identity_prepare, metrics_run, fold_all),
    "infer" => (infer_gen, identity_prepare, infer_run, fold_all),
    "embed" => (embed_gen, identity_prepare, embed_run, fold_all),
    "pixel" => (pixel_gen, identity_prepare, pixel_run, fold_all),
)

function main(args)
    emit("{\"e\":\"hello\",\"lang\":\"julia\"}")
    try
        name = args[1]
        haskey(CHALLENGES, name) || error("unknown challenge: $name")
        gen, prepare, run, check = CHALLENGES[name]
        size, seed, warmup, runs = parse.(Int, args[2:5])
        g0 = time_ns()
        input, hash, ops = gen(size, Rng(seed))
        emit("{\"e\":\"ready\",\"genNs\":$(Int(time_ns() - g0)),\"input\":\"$(hex8(hash))\",\"ops\":$ops}")
        for i in 0:warmup+runs-1
            work = prepare(input)
            t0 = time_ns()
            out, phases = run(work)
            ns = Int(time_ns() - t0)
            warm = i < warmup
            ph = phases === nothing ? "" : ",\"phases\":[$(join(phases, ","))]"
            emit("{\"e\":\"$(warm ? "warmup" : "run")\",\"i\":$(warm ? i : i - warmup),\"ns\":$ns,\"check\":\"$(hex8(check(out)))\"$ph}")
        end
        emit("{\"e\":\"done\"}")
    catch e
        emit("{\"e\":\"error\",\"msg\":$(JSON3.write(sprint(showerror, e)))}")
        exit(1)
    end
end

main(ARGS)
