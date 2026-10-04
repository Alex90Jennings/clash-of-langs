use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt::Write as _;
use std::io::Write;
use std::time::Instant;

const COUNTRIES: [&str; 20] = [
    "US", "GB", "DE", "FR", "JP", "BR", "IN", "CN", "CA", "AU", "NO", "SE", "ZA", "NG", "MX", "ES", "IT", "KR", "NL", "PL",
];
const LEVELS: [&str; 4] = ["INFO", "WARN", "ERROR", "DEBUG"];
const RESOURCES: [&str; 5] = ["users", "orders", "items", "auth", "search"];
const STATUSES: [u32; 6] = [200, 200, 200, 201, 404, 500];

fn emit(line: &str) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{line}");
    let _ = out.flush();
}

struct Rng {
    s: u32,
}

impl Rng {
    fn new(seed: u64) -> Self {
        let s = seed as u32;
        Rng { s: if s == 0 { 0x9e37_79b9 } else { s } }
    }

    fn next(&mut self) -> u32 {
        let mut x = self.s;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.s = x;
        x
    }

    fn int(&mut self, n: u32) -> u32 {
        self.next() % n
    }
}

fn fold(h: u32, v: u64) -> u32 {
    h.wrapping_mul(31).wrapping_add(v as u32)
}

fn fnv1a(s: &str) -> u32 {
    s.bytes().fold(0x811c_9dc5u32, |h, b| (h ^ b as u32).wrapping_mul(0x0100_0193))
}

fn fold_all(values: &[u64]) -> u32 {
    values.iter().fold(0, |h, &v| fold(h, v))
}

struct Output<T> {
    value: T,
    phases: Option<Vec<u128>>,
}

impl<T> Output<T> {
    fn plain(value: T) -> Self {
        Output { value, phases: None }
    }
}

fn drive<I, W, O>(
    size: usize,
    seed: u64,
    warmup: usize,
    runs: usize,
    gen: impl Fn(usize, &mut Rng) -> (I, u32, usize),
    prepare: impl Fn(&I) -> W,
    run: impl Fn(&I, W) -> Output<O>,
    check: impl Fn(&O) -> u32,
) {
    let g0 = Instant::now();
    let (input, hash, ops) = gen(size, &mut Rng::new(seed));
    emit(&format!(r#"{{"e":"ready","genNs":{},"input":"{:08x}","ops":{}}}"#, g0.elapsed().as_nanos(), hash, ops));

    for i in 0..warmup + runs {
        let work = prepare(&input);
        let t0 = Instant::now();
        let out = run(&input, work);
        let ns = t0.elapsed().as_nanos();
        let (kind, idx) = if i < warmup { ("warmup", i) } else { ("run", i - warmup) };
        let mut line = format!(r#"{{"e":"{}","i":{},"ns":{},"check":"{:08x}""#, kind, idx, ns, check(&out.value));
        if let Some(phases) = &out.phases {
            let parts: Vec<String> = phases.iter().map(|p| p.to_string()).collect();
            line.push_str(&format!(r#","phases":[{}]"#, parts.join(",")));
        }
        line.push('}');
        emit(&line);
    }
}

fn sort_gen(n: usize, rng: &mut Rng) -> (Vec<i32>, u32, usize) {
    let data: Vec<i32> = (0..n).map(|_| (rng.next() & 0x7fff_ffff) as i32).collect();
    let h = data.iter().fold(0, |h, &v| fold(h, v as u64));
    (data, h, n)
}

fn sort_run(mut work: Vec<i32>) -> Output<Vec<i32>> {
    work.sort_unstable();
    Output::plain(work)
}

#[derive(Deserialize)]
struct JsonRecord {
    id: u32,
    name: String,
    country: String,
    #[allow(dead_code)]
    age: u32,
    score: u32,
    active: bool,
    tags: Vec<String>,
}

#[derive(Serialize)]
struct JsonOut {
    country: String,
    id: u32,
    name: String,
    score2: u32,
    #[serde(rename = "tagCount")]
    tag_count: usize,
}

fn json_gen(n: usize, rng: &mut Rng) -> (String, u32, usize) {
    let mut text = String::with_capacity(n * 110);
    text.push('[');
    for i in 0..n {
        let country = COUNTRIES[rng.int(20) as usize];
        let age = 10 + rng.int(80);
        let score = rng.int(1000);
        let active = rng.next() & 1 == 1;
        let t1 = rng.int(10);
        let t2 = rng.int(10);
        if i > 0 {
            text.push(',');
        }
        text.push_str(&format!(
            r#"{{"id":{i},"name":"user_{i}","country":"{country}","age":{age},"score":{score},"active":{active},"tags":["t{t1}","t{t2}"]}}"#
        ));
    }
    text.push(']');
    let h = fnv1a(&text);
    (text, h, n)
}

fn json_run(text: &str) -> Output<String> {
    let records: Vec<JsonRecord> = serde_json::from_str(text).expect("valid json");
    let out: Vec<JsonOut> = records
        .into_iter()
        .filter(|r| r.active && r.score >= 500)
        .map(|r| JsonOut { id: r.id, name: r.name.to_uppercase(), country: r.country, score2: r.score * 2, tag_count: r.tags.len() })
        .collect();
    Output::plain(serde_json::to_string(&out).expect("serialisable"))
}

fn strings_gen(n: usize, rng: &mut Rng) -> (String, u32, usize) {
    let mut text = String::with_capacity(n * 90);
    for i in 0..n {
        let level = LEVELS[rng.int(4) as usize];
        let user = rng.int(1000);
        let res = RESOURCES[rng.int(5) as usize];
        let id = rng.int(10000);
        let status = STATUSES[rng.int(6) as usize];
        let latency = rng.int(2000);
        if i > 0 {
            text.push('\n');
        }
        text.push_str(&format!(
            "ts={} level={level} user=u{user} path=/api/{res}/{id} status={status} latency={latency}ms",
            1_700_000_000 + i
        ));
    }
    let h = fnv1a(&text);
    (text, h, n)
}

fn strings_run(text: &str) -> Output<Vec<u64>> {
    let pattern = Regex::new(r"status=(\d{3}) latency=(\d+)ms").expect("valid regex");
    let (mut lines, mut s5xx, mut errors, mut latency, mut tokens) = (0u64, 0u64, 0u64, 0u64, 0u64);
    for line in text.split('\n') {
        lines += 1;
        if let Some(caps) = pattern.captures(line) {
            if caps[1].parse::<u32>().unwrap_or(0) >= 500 {
                s5xx += 1;
            }
            latency += caps[2].parse::<u64>().unwrap_or(0);
        }
        if line.contains("level=ERROR") {
            errors += 1;
        }
        tokens += line.split(' ').count() as u64;
    }
    Output::plain(vec![lines, s5xx, errors, latency & 0xffff_ffff, tokens])
}

fn sieve_run(n: usize) -> Output<Vec<u64>> {
    let mut composite = vec![false; n + 1];
    let mut i = 2;
    while i * i <= n {
        if !composite[i] {
            let mut j = i * i;
            while j <= n {
                composite[j] = true;
                j += i;
            }
        }
        i += 1;
    }
    let (mut count, mut sum) = (0u64, 0u64);
    for (i, &c) in composite.iter().enumerate().skip(2) {
        if !c {
            count += 1;
            sum += i as u64;
        }
    }
    Output::plain(vec![count, sum & 0xffff_ffff])
}

#[allow(dead_code)]
struct Record {
    id: u32,
    name: String,
    country: &'static str,
    age: u32,
    score: u32,
    created_at: u32,
}

struct Agg {
    country: &'static str,
    count: u64,
    sum: u64,
    max: u64,
    age_sum: u64,
}

fn records_gen(n: usize, rng: &mut Rng) -> (Vec<Record>, u32, usize) {
    let mut h = 0u32;
    let records = (0..n)
        .map(|i| {
            let c = rng.int(20);
            let age = 10 + rng.int(80);
            let score = rng.int(1000);
            let created_at = 1_700_000_000 + rng.int(31_536_000);
            h = fold(fold(fold(fold(h, c as u64), age as u64), score as u64), created_at as u64);
            Record { id: i as u32, name: format!("user_{i}"), country: COUNTRIES[c as usize], age, score, created_at }
        })
        .collect();
    (records, h, n)
}

fn records_run(records: &[Record]) -> Output<Vec<Agg>> {
    const CUTOFF: u32 = 1_700_000_000 + 15_768_000;
    let mut groups: HashMap<&'static str, Agg> = HashMap::new();
    for r in records.iter().filter(|r| r.age >= 18 && r.score >= 100 && r.created_at >= CUTOFF) {
        let g = groups.entry(r.country).or_insert_with(|| Agg { country: r.country, count: 0, sum: 0, max: 0, age_sum: 0 });
        g.count += 1;
        g.sum += r.score as u64;
        g.max = g.max.max(r.score as u64);
        g.age_sum += r.age as u64;
    }
    let mut sorted: Vec<Agg> = groups.into_values().collect();
    sorted.sort_by(|a, b| b.sum.cmp(&a.sum).then_with(|| a.country.cmp(b.country)));
    Output::plain(sorted)
}

fn records_check(groups: &Vec<Agg>) -> u32 {
    groups.iter().fold(0, |mut h, g| {
        h = fold(h, fnv1a(g.country) as u64);
        h = fold(h, g.count);
        h = fold(h, g.sum & 0xffff_ffff);
        h = fold(h, g.max);
        fold(h, g.age_sum & 0xffff_ffff)
    })
}

fn search_gen(n: usize, rng: &mut Rng) -> ((Vec<i32>, Vec<i32>), u32, usize) {
    let keys: Vec<i32> = (0..n).map(|_| (rng.next() & 0x7fff_ffff) as i32).collect();
    let queries: Vec<i32> = (0..n)
        .map(|i| if i & 1 == 0 { keys[rng.int(n as u32) as usize] } else { (rng.next() & 0x7fff_ffff) as i32 })
        .collect();
    let h = keys.iter().chain(queries.iter()).fold(0, |h, &v| fold(h, v as u64));
    ((keys, queries), h, 2 * n)
}

fn search_run(input: &(Vec<i32>, Vec<i32>)) -> Output<Vec<u64>> {
    let (keys, queries) = input;
    let mut phases = Vec::with_capacity(4);
    let mut t = Instant::now();
    let mut lap = |phases: &mut Vec<u128>| {
        let now = Instant::now();
        phases.push((now - t).as_nanos());
        t = now;
    };

    let mut index: HashMap<i32, u32> = HashMap::new();
    for (i, &k) in keys.iter().enumerate() {
        index.insert(k, i as u32);
    }
    lap(&mut phases);

    let (mut hits, mut sum) = (0u64, 0u64);
    for q in queries {
        if let Some(&v) = index.get(q) {
            hits += 1;
            sum += v as u64;
        }
    }
    lap(&mut phases);

    let mut sorted = keys.clone();
    sorted.sort_unstable();
    lap(&mut phases);

    let bin_hits = queries.iter().filter(|q| sorted.binary_search(q).is_ok()).count() as u64;
    lap(&mut phases);

    Output { value: vec![hits, sum & 0xffff_ffff, bin_hits], phases: Some(phases) }
}

const REGIONS: [&str; 8] = ["NA", "EMEA", "APAC", "LATAM", "ANZ", "MEA", "NORDICS", "DACH"];

struct CsvGroup<'a> {
    region: &'a str,
    month: u32,
    orders: u64,
    units: u64,
    revenue: u64,
}

fn csv_gen(n: usize, rng: &mut Rng) -> (String, u32, usize) {
    let mut text = String::with_capacity(n * 48 + 64);
    text.push_str("order_id,date,region,sku,qty,unit_price_cents,discount_pct");
    for i in 0..n {
        let month = 1 + rng.int(12);
        let day = 1 + rng.int(28);
        let region = REGIONS[rng.int(8) as usize];
        let sku = rng.int(1000);
        let qty = 1 + rng.int(20);
        let price = 99 + rng.int(99_901);
        let discount = 5 * rng.int(5);
        let _ = write!(text, "\n{i},2026-{month:02}-{day:02},{region},SKU-{sku},{qty},{price},{discount}");
    }
    let h = fnv1a(&text);
    (text, h, n)
}

fn csv_run(text: &str) -> Output<String> {
    let mut groups: HashMap<(&str, u32), CsvGroup> = HashMap::new();
    for line in text.split('\n').skip(1) {
        let f: Vec<&str> = line.split(',').collect();
        let month: u32 = f[1][5..7].parse().unwrap_or(0);
        let qty: u64 = f[4].parse().unwrap_or(0);
        let price: u64 = f[5].parse().unwrap_or(0);
        let discount: u64 = f[6].parse().unwrap_or(0);
        let revenue = qty * price * (100 - discount) / 100;
        let g = groups.entry((f[2], month)).or_insert_with(|| CsvGroup { region: f[2], month, orders: 0, units: 0, revenue: 0 });
        g.orders += 1;
        g.units += qty;
        g.revenue += revenue;
    }
    let mut rows: Vec<CsvGroup> = groups.into_values().collect();
    rows.sort_by(|a, b| a.region.cmp(b.region).then(a.month.cmp(&b.month)));
    let mut out = String::from("region,month,orders,units,revenue_cents");
    for g in &rows {
        let _ = write!(out, "\n{},2026-{:02},{},{},{}", g.region, g.month, g.orders, g.units, g.revenue);
    }
    Output::plain(out)
}

fn metrics_gen(n: usize, rng: &mut Rng) -> (Vec<u32>, u32, usize) {
    let mut h = 0u32;
    let values = (0..n)
        .map(|_| {
            let mut v = 20 + rng.int(80);
            if rng.int(100) < 3 {
                v += 200 + rng.int(800);
            }
            h = fold(h, v as u64);
            v
        })
        .collect();
    (values, h, n)
}

fn metrics_run(values: &[u32]) -> Output<Vec<u64>> {
    let n = values.len();
    let (mut window, mut slow, mut peak, mut total) = (0u64, 0u64, 0u64, 0u64);
    for (i, &v) in values.iter().enumerate() {
        window += v as u64;
        total += v as u64;
        if i >= 60 {
            window -= values[i - 60] as u64;
        }
        if i >= 59 {
            if window > 7200 {
                slow += 1;
            }
            peak = peak.max(window);
        }
    }
    let buckets = values.chunks(60).fold(0, |h, block| fold(h, *block.iter().max().unwrap() as u64));
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    let rank = |p: usize| sorted[(p * n + 99) / 100 - 1] as u64;
    let mean_milli = total * 1000 / n as u64;
    Output::plain(vec![slow, peak, buckets as u64, rank(50), rank(95), rank(99), sorted[n - 1] as u64, mean_milli & 0xffff_ffff])
}

const NN_IN: usize = 64;
const NN_H: usize = 64;
const NN_OUT: usize = 10;

struct Mlp {
    w1: Vec<i32>,
    b1: Vec<i32>,
    w2: Vec<i32>,
    b2: Vec<i32>,
    w3: Vec<i32>,
    b3: Vec<i32>,
    x: Vec<i32>,
}

fn infer_gen(n: usize, rng: &mut Rng) -> (Mlp, u32, usize) {
    let mut h = 0u32;
    let mut draw = |count: usize, k: u32, offset: i32| -> Vec<i32> {
        (0..count)
            .map(|_| {
                let raw = rng.int(k);
                h = fold(h, raw as u64);
                raw as i32 - offset
            })
            .collect()
    };
    let w1 = draw(NN_H * NN_IN, 255, 127);
    let b1 = draw(NN_H, 2001, 1000);
    let w2 = draw(NN_H * NN_H, 255, 127);
    let b2 = draw(NN_H, 2001, 1000);
    let w3 = draw(NN_OUT * NN_H, 255, 127);
    let b3 = draw(NN_OUT, 2001, 1000);
    let x = draw(n * NN_IN, 256, 128);
    (Mlp { w1, b1, w2, b2, w3, b3, x }, h, n)
}

fn dense(w: &[i32], b: &[i32], input: &[i32], out: &mut [i32]) {
    for (j, (o, row)) in out.iter_mut().zip(w.chunks_exact(input.len())).enumerate() {
        *o = b[j] + row.iter().zip(input).map(|(a, x)| a * x).sum::<i32>();
    }
}

fn infer_run(m: &Mlp) -> Output<Vec<u64>> {
    let (mut h1, mut h2, mut logits) = ([0i32; NN_H], [0i32; NN_H], [0i32; NN_OUT]);
    let (mut preds, mut conf) = (0u32, 0u32);
    for x in m.x.chunks_exact(NN_IN) {
        dense(&m.w1, &m.b1, x, &mut h1);
        for v in h1.iter_mut() {
            *v = ((*v).max(0) / 1024).min(127);
        }
        dense(&m.w2, &m.b2, &h1, &mut h2);
        for v in h2.iter_mut() {
            *v = ((*v).max(0) / 1024).min(127);
        }
        dense(&m.w3, &m.b3, &h2, &mut logits);
        let mut pred = 0;
        for o in 1..NN_OUT {
            if logits[o] > logits[pred] {
                pred = o;
            }
        }
        preds = fold(preds, pred as u64);
        conf = conf.wrapping_add((logits[pred] + 4_194_304) as u32);
    }
    Output::plain(vec![preds as u64, conf as u64])
}

const EMB_D: usize = 64;
const EMB_Q: usize = 8;
const EMB_K: usize = 10;

fn embed_gen(n: usize, rng: &mut Rng) -> ((Vec<i32>, Vec<i32>), u32, usize) {
    let mut h = 0u32;
    let mut draw = |count: usize| -> Vec<i32> {
        (0..count)
            .map(|_| {
                let raw = rng.int(256);
                h = fold(h, raw as u64);
                raw as i32 - 128
            })
            .collect()
    };
    let docs = draw(n * EMB_D);
    let queries = draw(EMB_Q * EMB_D);
    ((docs, queries), h, n * EMB_Q)
}

fn embed_run(input: &(Vec<i32>, Vec<i32>)) -> Output<Vec<u64>> {
    let (docs, queries) = input;
    let mut results = Vec::with_capacity(2 * EMB_Q * EMB_K);
    for query in queries.chunks_exact(EMB_D) {
        let mut ranked: Vec<(i32, usize)> =
            docs.chunks_exact(EMB_D).enumerate().map(|(d, doc)| (doc.iter().zip(query).map(|(a, b)| a * b).sum::<i32>(), d)).collect();
        ranked.sort_unstable_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
        for &(score, d) in &ranked[..EMB_K] {
            results.push(d as u64);
            results.push((score + 2_097_152) as u64);
        }
    }
    Output::plain(results)
}

fn pixel_gen(n: usize, rng: &mut Rng) -> ((Vec<u8>, usize), u32, usize) {
    let mut rgb = vec![0u8; n * n * 3];
    let mut h = 0u32;
    for y in 0..n {
        for x in 0..n {
            let p = (y * n + x) * 3;
            rgb[p] = ((x + y + rng.int(64) as usize) % 256) as u8;
            rgb[p + 1] = ((2 * x + rng.int(64) as usize) % 256) as u8;
            rgb[p + 2] = ((2 * y + rng.int(64) as usize) % 256) as u8;
            h = fold(fold(fold(h, rgb[p] as u64), rgb[p + 1] as u64), rgb[p + 2] as u64);
        }
    }
    ((rgb, n), h, n * n)
}

fn pixel_run(input: &(Vec<u8>, usize)) -> Output<Vec<u64>> {
    let (rgb, n) = (&input.0, input.1);
    let mut phases = Vec::with_capacity(4);
    let mut t = Instant::now();
    let mut lap = |phases: &mut Vec<u128>| {
        let now = Instant::now();
        phases.push((now - t).as_nanos());
        t = now;
    };
    let cl = |v: isize| v.clamp(0, n as isize - 1) as usize;

    let gray: Vec<u8> = rgb.chunks_exact(3).map(|p| ((77 * p[0] as u32 + 150 * p[1] as u32 + 29 * p[2] as u32) / 256) as u8).collect();
    lap(&mut phases);

    let mut blur = vec![0u8; n * n];
    for y in 0..n {
        let (ru, r0, rd) = (cl(y as isize - 1) * n, y * n, cl(y as isize + 1) * n);
        for x in 0..n {
            let (xl, xr) = (cl(x as isize - 1), cl(x as isize + 1));
            let g = |i: usize| gray[i] as u32;
            let s = g(ru + xl) + 2 * g(ru + x) + g(ru + xr) + 2 * g(r0 + xl) + 4 * g(r0 + x) + 2 * g(r0 + xr) + g(rd + xl) + 2 * g(rd + x) + g(rd + xr);
            blur[r0 + x] = (s / 16) as u8;
        }
    }
    lap(&mut phases);

    let mut mag = vec![0u8; n * n];
    for y in 0..n {
        let (ru, r0, rd) = (cl(y as isize - 1) * n, y * n, cl(y as isize + 1) * n);
        for x in 0..n {
            let (xl, xr) = (cl(x as isize - 1), cl(x as isize + 1));
            let b = |i: usize| blur[i] as i32;
            let gx = b(ru + xr) + 2 * b(r0 + xr) + b(rd + xr) - (b(ru + xl) + 2 * b(r0 + xl) + b(rd + xl));
            let gy = b(rd + xl) + 2 * b(rd + x) + b(rd + xr) - (b(ru + xl) + 2 * b(ru + x) + b(ru + xr));
            mag[r0 + x] = (gx.abs() + gy.abs()).min(255) as u8;
        }
    }
    lap(&mut phases);

    let mut hist = vec![0u64; 256];
    let mut edges = 0u64;
    for &m in &mag {
        hist[m as usize] += 1;
        if m >= 128 {
            edges += 1;
        }
    }
    lap(&mut phases);
    hist.push(edges);

    Output { value: hist, phases: Some(phases) }
}

fn main() {
    emit(r#"{"e":"hello","lang":"rust"}"#);
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 6 {
        emit(r#"{"e":"error","msg":"usage: harness <challenge> <size> <seed> <warmup> <runs>"}"#);
        std::process::exit(1);
    }
    let size: usize = args[2].parse().unwrap_or(0);
    let seed: u64 = args[3].parse().unwrap_or(0);
    let warmup: usize = args[4].parse().unwrap_or(0);
    let runs: usize = args[5].parse().unwrap_or(0);

    match args[1].as_str() {
        "sort" => drive(size, seed, warmup, runs, sort_gen, |d| d.clone(), |_, work| sort_run(work), |v| v.iter().fold(0, |h, &x| fold(h, x as u64))),
        "json" => drive(size, seed, warmup, runs, json_gen, |_| (), |t, ()| json_run(t), |s| fnv1a(s)),
        "strings" => drive(size, seed, warmup, runs, strings_gen, |_| (), |t, ()| strings_run(t), |v| fold_all(v)),
        "sieve" => drive(size, seed, warmup, runs, |n, _| (n, n as u32, n), |_| (), |&n, ()| sieve_run(n), |v| fold_all(v)),
        "records" => drive(size, seed, warmup, runs, records_gen, |_| (), |r, ()| records_run(r), records_check),
        "search" => drive(size, seed, warmup, runs, search_gen, |_| (), |i, ()| search_run(i), |v| fold_all(v)),
        "csv" => drive(size, seed, warmup, runs, csv_gen, |_| (), |t, ()| csv_run(t), |s| fnv1a(s)),
        "metrics" => drive(size, seed, warmup, runs, metrics_gen, |_| (), |v, ()| metrics_run(v), |v| fold_all(v)),
        "infer" => drive(size, seed, warmup, runs, infer_gen, |_| (), |m, ()| infer_run(m), |v| fold_all(v)),
        "embed" => drive(size, seed, warmup, runs, embed_gen, |_| (), |e, ()| embed_run(e), |v| fold_all(v)),
        "pixel" => drive(size, seed, warmup, runs, pixel_gen, |_| (), |p, ()| pixel_run(p), |v| fold_all(v)),
        other => {
            emit(&format!(r#"{{"e":"error","msg":"unknown challenge: {other}"}}"#));
            std::process::exit(1);
        }
    }
    emit(r#"{"e":"done"}"#);
}
