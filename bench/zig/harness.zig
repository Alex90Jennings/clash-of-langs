const std = @import("std");
const Io = std.Io;

const M: u64 = 0xFFFFFFFF;
const COUNTRIES = [_][]const u8{ "US", "GB", "DE", "FR", "JP", "BR", "IN", "CN", "CA", "AU", "NO", "SE", "ZA", "NG", "MX", "ES", "IT", "KR", "NL", "PL" };
const LEVELS = [_][]const u8{ "INFO", "WARN", "ERROR", "DEBUG" };
const RESOURCES = [_][]const u8{ "users", "orders", "items", "auth", "search" };
const STATUSES = [_]u32{ 200, 200, 200, 201, 404, 500 };

const gpa = std.heap.smp_allocator;
var io_g: Io = undefined;
var out_w: *Io.Writer = undefined;

fn nowNs() u64 {
    return @intCast(Io.Clock.awake.now(io_g).nanoseconds);
}

fn emit(comptime fmt: []const u8, args: anytype) void {
    out_w.print(fmt ++ "\n", args) catch {};
    out_w.flush() catch {};
}

const Rng = struct {
    s: u32,
    fn init(seed: u64) Rng {
        const s: u32 = @truncate(seed);
        return .{ .s = if (s == 0) 0x9e3779b9 else s };
    }
    fn next(r: *Rng) u32 {
        var x = r.s;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        r.s = x;
        return x;
    }
    fn int(r: *Rng, n: u32) u32 {
        return r.next() % n;
    }
};

fn fold(h: u32, v: u64) u32 {
    return h *% 31 +% @as(u32, @truncate(v));
}
fn fnv1a(s: []const u8) u32 {
    var h: u32 = 0x811c9dc5;
    for (s) |b| h = (h ^ b) *% 0x01000193;
    return h;
}
fn foldAll(v: []const u64) u32 {
    var h: u32 = 0;
    for (v) |x| h = fold(h, x);
    return h;
}

const Out = struct { check: u32 = 0, phases: ?[4]u64 = null };

var sort_data: []i32 = &.{};
var sort_work: []i32 = &.{};
var text: []u8 = &.{};
var json_result: []u8 = &.{};
var counters: [5]u64 = .{ 0, 0, 0, 0, 0 };
var sieve_n: usize = 0;

const Record = struct { id: u32, name: []const u8, country: []const u8, age: u32, score: u32, created_at: u32 };
const Agg = struct { country: []const u8, count: u64 = 0, sum: u64 = 0, max: u64 = 0, age_sum: u64 = 0 };
var records: []Record = &.{};
var groups_sorted: std.ArrayList(Agg) = .empty;

var keys: []i32 = &.{};
var queries: []i32 = &.{};

fn sortGen(n: usize, r: *Rng) !u32 {
    sort_data = try gpa.alloc(i32, n);
    sort_work = try gpa.alloc(i32, n);
    var h: u32 = 0;
    for (sort_data) |*v| {
        v.* = @intCast(r.next() & 0x7fffffff);
        h = fold(h, @intCast(v.*));
    }
    return h;
}
fn sortPrepare() void {
    @memcpy(sort_work, sort_data);
}
fn sortRun(_: *Out) !void {
    std.mem.sort(i32, sort_work, {}, std.sort.asc(i32));
}
fn sortCheck(o: *Out) void {
    var h: u32 = 0;
    for (sort_work) |v| h = fold(h, @intCast(v));
    o.check = h;
}

const JsonRecord = struct { id: u32, name: []const u8, country: []const u8, age: u32, score: u32, active: bool, tags: []const []const u8 };
const JsonOut = struct { country: []const u8, id: u32, name: []const u8, score2: u32, tagCount: usize };

fn jsonGen(n: usize, r: *Rng) !u32 {
    var buf: std.ArrayList(u8) = .empty;
    try buf.ensureTotalCapacity(gpa, n * 110);
    try buf.append(gpa, '[');
    for (0..n) |i| {
        const country = COUNTRIES[r.int(20)];
        const age = 10 + r.int(80);
        const score = r.int(1000);
        const active = (r.next() & 1) == 1;
        const t1 = r.int(10);
        const t2 = r.int(10);
        if (i > 0) try buf.append(gpa, ',');
        try buf.print(gpa, "{{\"id\":{d},\"name\":\"user_{d}\",\"country\":\"{s}\",\"age\":{d},\"score\":{d},\"active\":{},\"tags\":[\"t{d}\",\"t{d}\"]}}", .{ i, i, country, age, score, active, t1, t2 });
    }
    try buf.append(gpa, ']');
    text = try buf.toOwnedSlice(gpa);
    return fnv1a(text);
}
fn jsonRun(_: *Out) !void {
    const parsed = try std.json.parseFromSlice([]JsonRecord, gpa, text, .{});
    defer parsed.deinit();
    var arena = std.heap.ArenaAllocator.init(gpa);
    defer arena.deinit();
    const a = arena.allocator();
    var out: std.ArrayList(JsonOut) = .empty;
    for (parsed.value) |rec| {
        if (!rec.active or rec.score < 500) continue;
        try out.append(a, .{ .country = rec.country, .id = rec.id, .name = try std.ascii.allocUpperString(a, rec.name), .score2 = rec.score * 2, .tagCount = rec.tags.len });
    }
    json_result = try std.json.Stringify.valueAlloc(gpa, out.items, .{});
}
fn jsonCheck(o: *Out) void {
    o.check = fnv1a(json_result);
    gpa.free(json_result);
}

fn stringsGen(n: usize, r: *Rng) !u32 {
    var buf: std.ArrayList(u8) = .empty;
    try buf.ensureTotalCapacity(gpa, n * 90);
    for (0..n) |i| {
        const level = LEVELS[r.int(4)];
        const user = r.int(1000);
        const res = RESOURCES[r.int(5)];
        const id = r.int(10000);
        const status = STATUSES[r.int(6)];
        const latency = r.int(2000);
        if (i > 0) try buf.append(gpa, '\n');
        try buf.print(gpa, "ts={d} level={s} user=u{d} path=/api/{s}/{d} status={d} latency={d}ms", .{ 1700000000 + i, level, user, res, id, status, latency });
    }
    text = try buf.toOwnedSlice(gpa);
    return fnv1a(text);
}

fn matchStatusLatency(line: []const u8) ?struct { status: u32, latency: u64 } {
    var pos: usize = 0;
    while (std.mem.findPos(u8, line, pos, "status=")) |at| : (pos = at + 1) {
        var i = at + 7;
        if (i + 3 > line.len) return null;
        const d = line[i .. i + 3];
        if (!std.ascii.isDigit(d[0]) or !std.ascii.isDigit(d[1]) or !std.ascii.isDigit(d[2])) continue;
        i += 3;
        if (!std.mem.startsWith(u8, line[i..], " latency=")) continue;
        i += 9;
        const start = i;
        while (i < line.len and std.ascii.isDigit(line[i])) i += 1;
        if (i == start or !std.mem.startsWith(u8, line[i..], "ms")) continue;
        return .{ .status = std.fmt.parseInt(u32, d, 10) catch continue, .latency = std.fmt.parseInt(u64, line[start..i], 10) catch continue };
    }
    return null;
}

fn stringsRun(_: *Out) !void {
    var lines: u64 = 0;
    var s5xx: u64 = 0;
    var errors: u64 = 0;
    var latency: u64 = 0;
    var tokens: u64 = 0;
    var it = std.mem.splitScalar(u8, text, '\n');
    while (it.next()) |line| {
        lines += 1;
        if (matchStatusLatency(line)) |m| {
            if (m.status >= 500) s5xx += 1;
            latency += m.latency;
        }
        if (std.mem.find(u8, line, "level=ERROR") != null) errors += 1;
        var fields = std.mem.splitScalar(u8, line, ' ');
        while (fields.next()) |_| tokens += 1;
    }
    counters = .{ lines, s5xx, errors, latency & M, tokens };
}
fn stringsCheck(o: *Out) void {
    o.check = foldAll(&counters);
}

fn sieveGen(n: usize, _: *Rng) !u32 {
    sieve_n = n;
    return @truncate(n);
}
fn sieveRun(_: *Out) !void {
    const n = sieve_n;
    const composite = try gpa.alloc(bool, n + 1);
    defer gpa.free(composite);
    @memset(composite, false);
    var i: usize = 2;
    while (i * i <= n) : (i += 1) {
        if (composite[i]) continue;
        var j = i * i;
        while (j <= n) : (j += i) composite[j] = true;
    }
    var count: u64 = 0;
    var sum: u64 = 0;
    var k: usize = 2;
    while (k <= n) : (k += 1) {
        if (!composite[k]) {
            count += 1;
            sum += k;
        }
    }
    counters = .{ count, sum & M, 0, 0, 0 };
}
fn sieveCheck(o: *Out) void {
    o.check = foldAll(counters[0..2]);
}

fn recordsGen(n: usize, r: *Rng) !u32 {
    records = try gpa.alloc(Record, n);
    var h: u32 = 0;
    for (records, 0..) |*rec, i| {
        const c = r.int(20);
        const age = 10 + r.int(80);
        const score = r.int(1000);
        const created = 1700000000 + r.int(31536000);
        rec.* = .{ .id = @intCast(i), .name = try std.fmt.allocPrint(gpa, "user_{d}", .{i}), .country = COUNTRIES[c], .age = age, .score = score, .created_at = created };
        h = fold(fold(fold(fold(h, c), age), score), created);
    }
    return h;
}
fn aggLess(_: void, a: Agg, b: Agg) bool {
    if (a.sum != b.sum) return a.sum > b.sum;
    return std.mem.order(u8, a.country, b.country) == .lt;
}
fn recordsRun(_: *Out) !void {
    const cutoff: u32 = 1700000000 + 15768000;
    var groups = std.StringHashMap(Agg).init(gpa);
    defer groups.deinit();
    for (records) |rec| {
        if (rec.age < 18 or rec.score < 100 or rec.created_at < cutoff) continue;
        const e = try groups.getOrPut(rec.country);
        if (!e.found_existing) e.value_ptr.* = .{ .country = rec.country };
        const g = e.value_ptr;
        g.count += 1;
        g.sum += rec.score;
        g.max = @max(g.max, rec.score);
        g.age_sum += rec.age;
    }
    groups_sorted.clearRetainingCapacity();
    var vit = groups.valueIterator();
    while (vit.next()) |g| try groups_sorted.append(gpa, g.*);
    std.mem.sort(Agg, groups_sorted.items, {}, aggLess);
}
fn recordsCheck(o: *Out) void {
    var h: u32 = 0;
    for (groups_sorted.items) |g| {
        h = fold(h, fnv1a(g.country));
        h = fold(h, g.count);
        h = fold(h, g.sum & M);
        h = fold(h, g.max);
        h = fold(h, g.age_sum & M);
    }
    o.check = h;
}

fn searchGen(n: usize, r: *Rng) !u32 {
    keys = try gpa.alloc(i32, n);
    queries = try gpa.alloc(i32, n);
    var h: u32 = 0;
    for (keys) |*k| {
        k.* = @intCast(r.next() & 0x7fffffff);
        h = fold(h, @intCast(k.*));
    }
    for (queries, 0..) |*q, i| {
        q.* = if (i & 1 == 0) keys[r.int(@intCast(n))] else @intCast(r.next() & 0x7fffffff);
        h = fold(h, @intCast(q.*));
    }
    return h;
}
fn orderI32(target: i32, item: i32) std.math.Order {
    return std.math.order(target, item);
}
fn searchRun(o: *Out) !void {
    var phases: [4]u64 = undefined;
    var t = nowNs();
    var index = std.AutoHashMap(i32, u32).init(gpa);
    defer index.deinit();
    for (keys, 0..) |k, i| try index.put(k, @intCast(i));
    var now = nowNs();
    phases[0] = now - t;
    t = now;

    var hits: u64 = 0;
    var sum: u64 = 0;
    for (queries) |q| {
        if (index.get(q)) |v| {
            hits += 1;
            sum += v;
        }
    }
    now = nowNs();
    phases[1] = now - t;
    t = now;

    const sorted = try gpa.dupe(i32, keys);
    defer gpa.free(sorted);
    std.mem.sort(i32, sorted, {}, std.sort.asc(i32));
    now = nowNs();
    phases[2] = now - t;
    t = now;

    var bin_hits: u64 = 0;
    for (queries) |q| {
        if (std.sort.binarySearch(i32, sorted, q, orderI32) != null) bin_hits += 1;
    }
    phases[3] = nowNs() - t;
    counters = .{ hits, sum & M, bin_hits, 0, 0 };
    o.phases = phases;
}
fn searchCheck(o: *Out) void {
    o.check = foldAll(counters[0..3]);
}

const REGIONS = [_][]const u8{ "NA", "EMEA", "APAC", "LATAM", "ANZ", "MEA", "NORDICS", "DACH" };

fn csvGen(n: usize, r: *Rng) !u32 {
    var buf: std.ArrayList(u8) = .empty;
    try buf.ensureTotalCapacity(gpa, n * 48);
    try buf.appendSlice(gpa, "order_id,date,region,sku,qty,unit_price_cents,discount_pct");
    for (0..n) |i| {
        const month = 1 + r.int(12);
        const day = 1 + r.int(28);
        const region = REGIONS[r.int(8)];
        const sku = r.int(1000);
        const qty = 1 + r.int(20);
        const price = 99 + r.int(99901);
        const discount = 5 * r.int(5);
        try buf.print(gpa, "\n{d},2026-{d:0>2}-{d:0>2},{s},SKU-{d},{d},{d},{d}", .{ i, month, day, region, sku, qty, price, discount });
    }
    text = try buf.toOwnedSlice(gpa);
    return fnv1a(text);
}

const CsvKey = struct { region: []const u8, month: u8 };
const CsvKeyContext = struct {
    pub fn hash(_: CsvKeyContext, k: CsvKey) u64 {
        var h = std.hash.Wyhash.init(k.month);
        h.update(k.region);
        return h.final();
    }
    pub fn eql(_: CsvKeyContext, a: CsvKey, b: CsvKey) bool {
        return a.month == b.month and std.mem.eql(u8, a.region, b.region);
    }
};
const CsvGroup = struct { region: []const u8, month: u8, orders: u64 = 0, units: u64 = 0, revenue: u64 = 0 };
var csv_report: []u8 = &.{};

fn csvGroupLess(_: void, a: CsvGroup, b: CsvGroup) bool {
    return switch (std.mem.order(u8, a.region, b.region)) {
        .lt => true,
        .gt => false,
        .eq => a.month < b.month,
    };
}
fn csvRun(_: *Out) !void {
    var groups = std.HashMap(CsvKey, CsvGroup, CsvKeyContext, std.hash_map.default_max_load_percentage).init(gpa);
    defer groups.deinit();
    var lines = std.mem.splitScalar(u8, text, '\n');
    _ = lines.next();
    while (lines.next()) |line| {
        var f: [7][]const u8 = undefined;
        var it = std.mem.splitScalar(u8, line, ',');
        for (&f) |*field| field.* = it.next() orelse return error.BadRow;
        const month = try std.fmt.parseInt(u8, f[1][5..7], 10);
        const qty = try std.fmt.parseInt(u64, f[4], 10);
        const price = try std.fmt.parseInt(u64, f[5], 10);
        const discount = try std.fmt.parseInt(u64, f[6], 10);
        const e = try groups.getOrPut(.{ .region = f[2], .month = month });
        if (!e.found_existing) e.value_ptr.* = .{ .region = f[2], .month = month };
        const g = e.value_ptr;
        g.orders += 1;
        g.units += qty;
        g.revenue += qty * price * (100 - discount) / 100;
    }
    var rows: std.ArrayList(CsvGroup) = .empty;
    defer rows.deinit(gpa);
    var vit = groups.valueIterator();
    while (vit.next()) |g| try rows.append(gpa, g.*);
    std.mem.sort(CsvGroup, rows.items, {}, csvGroupLess);
    var out: std.ArrayList(u8) = .empty;
    try out.appendSlice(gpa, "region,month,orders,units,revenue_cents");
    for (rows.items) |g| try out.print(gpa, "\n{s},2026-{d:0>2},{d},{d},{d}", .{ g.region, g.month, g.orders, g.units, g.revenue });
    csv_report = try out.toOwnedSlice(gpa);
}
fn csvCheck(o: *Out) void {
    o.check = fnv1a(csv_report);
    gpa.free(csv_report);
}

var metric_values: []u32 = &.{};
var metric_result: [8]u64 = undefined;

fn metricsGen(n: usize, r: *Rng) !u32 {
    metric_values = try gpa.alloc(u32, n);
    var h: u32 = 0;
    for (metric_values) |*v| {
        v.* = 20 + r.int(80);
        if (r.int(100) < 3) v.* += 200 + r.int(800);
        h = fold(h, v.*);
    }
    return h;
}
fn metricsRun(_: *Out) !void {
    const values = metric_values;
    const n = values.len;
    var window: u64 = 0;
    var slow: u64 = 0;
    var peak: u64 = 0;
    var total: u64 = 0;
    for (values, 0..) |v, i| {
        window += v;
        total += v;
        if (i >= 60) window -= values[i - 60];
        if (i >= 59) {
            if (window > 7200) slow += 1;
            peak = @max(peak, window);
        }
    }
    var buckets: u32 = 0;
    var start: usize = 0;
    while (start < n) : (start += 60) {
        buckets = fold(buckets, std.mem.max(u32, values[start..@min(start + 60, n)]));
    }
    const sorted = try gpa.dupe(u32, values);
    defer gpa.free(sorted);
    std.mem.sort(u32, sorted, {}, std.sort.asc(u32));
    const rank = struct {
        fn at(s: []const u32, p: usize) u64 {
            return s[(p * s.len + 99) / 100 - 1];
        }
    }.at;
    const mean_milli = total * 1000 / n;
    metric_result = .{ slow, peak, buckets, rank(sorted, 50), rank(sorted, 95), rank(sorted, 99), sorted[n - 1], mean_milli & M };
}
fn metricsCheck(o: *Out) void {
    o.check = foldAll(&metric_result);
}

const NN_IN = 64;
const NN_H = 64;
const NN_OUT = 10;
const Mlp = struct { w1: []i32, b1: []i32, w2: []i32, b2: []i32, w3: []i32, b3: []i32, x: []i32, n: usize };
var mlp: Mlp = undefined;
var infer_result: [2]u64 = undefined;

fn drawInts(r: *Rng, h: *u32, count: usize, k: u32, offset: i32) ![]i32 {
    const out = try gpa.alloc(i32, count);
    for (out) |*v| {
        const raw = r.int(k);
        h.* = fold(h.*, raw);
        v.* = @as(i32, @intCast(raw)) - offset;
    }
    return out;
}
fn inferGen(n: usize, r: *Rng) !u32 {
    var h: u32 = 0;
    mlp.w1 = try drawInts(r, &h, NN_H * NN_IN, 255, 127);
    mlp.b1 = try drawInts(r, &h, NN_H, 2001, 1000);
    mlp.w2 = try drawInts(r, &h, NN_H * NN_H, 255, 127);
    mlp.b2 = try drawInts(r, &h, NN_H, 2001, 1000);
    mlp.w3 = try drawInts(r, &h, NN_OUT * NN_H, 255, 127);
    mlp.b3 = try drawInts(r, &h, NN_OUT, 2001, 1000);
    mlp.x = try drawInts(r, &h, n * NN_IN, 256, 128);
    mlp.n = n;
    return h;
}
fn dense(w: []const i32, b: []const i32, input: []const i32, out: []i32) void {
    for (out, 0..) |*o, j| {
        var a = b[j];
        const row = w[j * input.len ..][0..input.len];
        for (row, input) |wk, xk| a += wk * xk;
        o.* = a;
    }
}
fn inferRun(_: *Out) !void {
    var h1: [NN_H]i32 = undefined;
    var h2: [NN_H]i32 = undefined;
    var logits: [NN_OUT]i32 = undefined;
    var preds: u32 = 0;
    var conf: u64 = 0;
    for (0..mlp.n) |s| {
        dense(mlp.w1, mlp.b1, mlp.x[s * NN_IN ..][0..NN_IN], &h1);
        for (&h1) |*v| v.* = @min(127, @divTrunc(@max(0, v.*), 1024));
        dense(mlp.w2, mlp.b2, &h1, &h2);
        for (&h2) |*v| v.* = @min(127, @divTrunc(@max(0, v.*), 1024));
        dense(mlp.w3, mlp.b3, &h2, &logits);
        var pred: usize = 0;
        for (logits, 0..) |l, o| {
            if (l > logits[pred]) pred = o;
        }
        preds = fold(preds, pred);
        conf = (conf + @as(u64, @intCast(logits[pred] + 4194304))) & M;
    }
    infer_result = .{ preds, conf };
}
fn inferCheck(o: *Out) void {
    o.check = foldAll(&infer_result);
}

const EMB_D = 64;
const EMB_Q = 8;
const EMB_K = 10;
var emb_docs: []i32 = &.{};
var emb_queries: []i32 = &.{};
var emb_n: usize = 0;
var embed_result: [EMB_Q * EMB_K * 2]u64 = undefined;

fn embedGen(n: usize, r: *Rng) !u32 {
    var h: u32 = 0;
    emb_docs = try drawInts(r, &h, n * EMB_D, 256, 128);
    emb_queries = try drawInts(r, &h, EMB_Q * EMB_D, 256, 128);
    emb_n = n;
    return h;
}
fn rankLess(scores: []const i32, a: u32, b: u32) bool {
    if (scores[a] != scores[b]) return scores[a] > scores[b];
    return a < b;
}
fn embedRun(_: *Out) !void {
    const n = emb_n;
    const scores = try gpa.alloc(i32, n);
    defer gpa.free(scores);
    const order = try gpa.alloc(u32, n);
    defer gpa.free(order);
    var out: usize = 0;
    for (0..EMB_Q) |q| {
        const query = emb_queries[q * EMB_D ..][0..EMB_D];
        for (scores, 0..) |*s, d| {
            const doc = emb_docs[d * EMB_D ..][0..EMB_D];
            var acc: i32 = 0;
            for (doc, query) |a, b| acc += a * b;
            s.* = acc;
            order[d] = @intCast(d);
        }
        std.mem.sort(u32, order, @as([]const i32, scores), rankLess);
        for (order[0..EMB_K]) |d| {
            embed_result[out] = d;
            embed_result[out + 1] = @intCast(scores[d] + 2097152);
            out += 2;
        }
    }
}
fn embedCheck(o: *Out) void {
    o.check = foldAll(&embed_result);
}

var pix_rgb: []u8 = &.{};
var pix_n: usize = 0;
var pix_result: [257]u64 = undefined;

fn pixelGen(n: usize, r: *Rng) !u32 {
    pix_rgb = try gpa.alloc(u8, n * n * 3);
    pix_n = n;
    var h: u32 = 0;
    for (0..n) |y| {
        for (0..n) |x| {
            const p = (y * n + x) * 3;
            pix_rgb[p] = @intCast((x + y + r.int(64)) % 256);
            pix_rgb[p + 1] = @intCast((2 * x + r.int(64)) % 256);
            pix_rgb[p + 2] = @intCast((2 * y + r.int(64)) % 256);
            h = fold(fold(fold(h, pix_rgb[p]), pix_rgb[p + 1]), pix_rgb[p + 2]);
        }
    }
    return h;
}
fn pixelRun(o: *Out) !void {
    const n = pix_n;
    const rgb = pix_rgb;
    var phases: [4]u64 = undefined;
    var t = nowNs();

    const gray = try gpa.alloc(u8, n * n);
    defer gpa.free(gray);
    for (gray, 0..) |*g, i| {
        const sum = 77 * @as(u32, rgb[i * 3]) + 150 * @as(u32, rgb[i * 3 + 1]) + 29 * @as(u32, rgb[i * 3 + 2]);
        g.* = @intCast(sum >> 8);
    }
    var now = nowNs();
    phases[0] = now - t;
    t = now;

    const blur = try gpa.alloc(u8, n * n);
    defer gpa.free(blur);
    for (0..n) |y| {
        const ru = (if (y == 0) 0 else y - 1) * n;
        const r0 = y * n;
        const rd = @min(y + 1, n - 1) * n;
        for (0..n) |x| {
            const xl = if (x == 0) 0 else x - 1;
            const xr = @min(x + 1, n - 1);
            const top = @as(u32, gray[ru + xl]) + 2 * @as(u32, gray[ru + x]) + @as(u32, gray[ru + xr]);
            const mid = 2 * @as(u32, gray[r0 + xl]) + 4 * @as(u32, gray[r0 + x]) + 2 * @as(u32, gray[r0 + xr]);
            const bottom = @as(u32, gray[rd + xl]) + 2 * @as(u32, gray[rd + x]) + @as(u32, gray[rd + xr]);
            blur[r0 + x] = @intCast((top + mid + bottom) >> 4);
        }
    }
    now = nowNs();
    phases[1] = now - t;
    t = now;

    const mag = try gpa.alloc(u8, n * n);
    defer gpa.free(mag);
    for (0..n) |y| {
        const ru = (if (y == 0) 0 else y - 1) * n;
        const r0 = y * n;
        const rd = @min(y + 1, n - 1) * n;
        for (0..n) |x| {
            const xl = if (x == 0) 0 else x - 1;
            const xr = @min(x + 1, n - 1);
            const right = @as(i32, blur[ru + xr]) + 2 * @as(i32, blur[r0 + xr]) + @as(i32, blur[rd + xr]);
            const left = @as(i32, blur[ru + xl]) + 2 * @as(i32, blur[r0 + xl]) + @as(i32, blur[rd + xl]);
            const down = @as(i32, blur[rd + xl]) + 2 * @as(i32, blur[rd + x]) + @as(i32, blur[rd + xr]);
            const up = @as(i32, blur[ru + xl]) + 2 * @as(i32, blur[ru + x]) + @as(i32, blur[ru + xr]);
            mag[r0 + x] = @intCast(@min(255, @abs(right - left) + @abs(down - up)));
        }
    }
    now = nowNs();
    phases[2] = now - t;
    t = now;

    var hist = [_]u64{0} ** 256;
    var edges: u64 = 0;
    for (mag) |m| {
        hist[m] += 1;
        if (m >= 128) edges += 1;
    }
    phases[3] = nowNs() - t;

    pix_result[0..256].* = hist;
    pix_result[256] = edges;
    o.phases = phases;
}
fn pixelCheck(o: *Out) void {
    o.check = foldAll(&pix_result);
}

fn noop() void {}

const Challenge = struct {
    name: []const u8,
    gen: *const fn (usize, *Rng) anyerror!u32,
    prepare: *const fn () void,
    run: *const fn (*Out) anyerror!void,
    check: *const fn (*Out) void,
};
const CHALLENGES = [_]Challenge{
    .{ .name = "sort", .gen = sortGen, .prepare = sortPrepare, .run = sortRun, .check = sortCheck },
    .{ .name = "json", .gen = jsonGen, .prepare = noop, .run = jsonRun, .check = jsonCheck },
    .{ .name = "strings", .gen = stringsGen, .prepare = noop, .run = stringsRun, .check = stringsCheck },
    .{ .name = "sieve", .gen = sieveGen, .prepare = noop, .run = sieveRun, .check = sieveCheck },
    .{ .name = "records", .gen = recordsGen, .prepare = noop, .run = recordsRun, .check = recordsCheck },
    .{ .name = "search", .gen = searchGen, .prepare = noop, .run = searchRun, .check = searchCheck },
    .{ .name = "csv", .gen = csvGen, .prepare = noop, .run = csvRun, .check = csvCheck },
    .{ .name = "metrics", .gen = metricsGen, .prepare = noop, .run = metricsRun, .check = metricsCheck },
    .{ .name = "infer", .gen = inferGen, .prepare = noop, .run = inferRun, .check = inferCheck },
    .{ .name = "embed", .gen = embedGen, .prepare = noop, .run = embedRun, .check = embedCheck },
    .{ .name = "pixel", .gen = pixelGen, .prepare = noop, .run = pixelRun, .check = pixelCheck },
};

pub fn main(init: std.process.Init) !void {
    io_g = init.io;
    var buffer: [4096]u8 = undefined;
    var file_writer: Io.File.Writer = .init(.stdout(), init.io, &buffer);
    out_w = &file_writer.interface;
    emit("{{\"e\":\"hello\",\"lang\":\"zig\"}}", .{});

    const args = try init.minimal.args.toSlice(init.arena.allocator());
    if (args.len < 6) {
        emit("{{\"e\":\"error\",\"msg\":\"usage: harness <challenge> <size> <seed> <warmup> <runs>\"}}", .{});
        std.process.exit(1);
    }
    var challenge: ?Challenge = null;
    for (CHALLENGES) |c| {
        if (std.mem.eql(u8, c.name, args[1])) challenge = c;
    }
    const c = challenge orelse {
        emit("{{\"e\":\"error\",\"msg\":\"unknown challenge: {s}\"}}", .{args[1]});
        std.process.exit(1);
    };
    const size = try std.fmt.parseInt(usize, args[2], 10);
    var rng = Rng.init(try std.fmt.parseInt(u64, args[3], 10));
    const warmup = try std.fmt.parseInt(usize, args[4], 10);
    const runs = try std.fmt.parseInt(usize, args[5], 10);

    const g0 = nowNs();
    const hash = try c.gen(size, &rng);
    const ops = if (std.mem.eql(u8, c.name, "search")) size * 2 else if (std.mem.eql(u8, c.name, "embed")) size * EMB_Q else if (std.mem.eql(u8, c.name, "pixel")) size * size else size;
    emit("{{\"e\":\"ready\",\"genNs\":{d},\"input\":\"{x:0>8}\",\"ops\":{d}}}", .{ nowNs() - g0, hash, ops });

    for (0..warmup + runs) |i| {
        var o: Out = .{};
        c.prepare();
        const t0 = nowNs();
        try c.run(&o);
        const ns = nowNs() - t0;
        c.check(&o);
        const warm = i < warmup;
        const kind: []const u8 = if (warm) "warmup" else "run";
        const idx = if (warm) i else i - warmup;
        if (o.phases) |p| {
            emit("{{\"e\":\"{s}\",\"i\":{d},\"ns\":{d},\"check\":\"{x:0>8}\",\"phases\":[{d},{d},{d},{d}]}}", .{ kind, idx, ns, o.check, p[0], p[1], p[2], p[3] });
        } else {
            emit("{{\"e\":\"{s}\",\"i\":{d},\"ns\":{d},\"check\":\"{x:0>8}\"}}", .{ kind, idx, ns, o.check });
        }
    }
    emit("{{\"e\":\"done\"}}", .{});
}
