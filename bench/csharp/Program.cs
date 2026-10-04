using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

static class H
{
    public const uint M = 0xFFFFFFFF;
    public static readonly string[] Countries = { "US", "GB", "DE", "FR", "JP", "BR", "IN", "CN", "CA", "AU", "NO", "SE", "ZA", "NG", "MX", "ES", "IT", "KR", "NL", "PL" };
    public static readonly string[] Levels = { "INFO", "WARN", "ERROR", "DEBUG" };
    public static readonly string[] Resources = { "users", "orders", "items", "auth", "search" };
    public static readonly int[] Statuses = { 200, 200, 200, 201, 404, 500 };
    public static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static void Emit(string line) => Console.Out.WriteLine(line);
    public static long NowNs() => (long)(Stopwatch.GetTimestamp() * (1e9 / Stopwatch.Frequency));
    public static uint Fold(uint h, ulong v) => unchecked(h * 31 + (uint)v);
    public static uint Fnv1a(string s)
    {
        uint h = 0x811c9dc5;
        foreach (char c in s) h = unchecked((h ^ c) * 0x01000193);
        return h;
    }
    public static uint FoldAll(IEnumerable<ulong> values)
    {
        uint h = 0;
        foreach (var v in values) h = Fold(h, v);
        return h;
    }
}

sealed class Rng(ulong seed)
{
    private uint _s = (uint)seed == 0 ? 0x9e3779b9 : (uint)seed;
    public uint Next()
    {
        uint x = _s;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        return _s = x;
    }
    public int Int(int n) => (int)(Next() % (uint)n);
}

record Out(object Value, long[]? Phases = null);

abstract class Challenge
{
    public abstract (object input, uint hash, long ops) Gen(int n, Rng rng);
    public virtual object Prepare(object input) => input;
    public abstract Out Run(object work);
    public abstract uint Check(Out o);
}

sealed class SortChallenge : Challenge
{
    public override (object, uint, long) Gen(int n, Rng rng)
    {
        var data = new int[n];
        uint h = 0;
        for (int i = 0; i < n; i++) h = H.Fold(h, (uint)(data[i] = (int)(rng.Next() & 0x7fffffff)));
        return (data, h, n);
    }
    public override object Prepare(object input) => ((int[])input).Clone();
    public override Out Run(object work)
    {
        var data = (int[])work;
        Array.Sort(data);
        return new Out(data);
    }
    public override uint Check(Out o)
    {
        uint h = 0;
        foreach (var v in (int[])o.Value) h = H.Fold(h, (uint)v);
        return h;
    }
}

sealed record JsonRecord(int Id, string Name, string Country, int Age, int Score, bool Active, List<string> Tags);
sealed record JsonOut(string Country, int Id, string Name, int Score2, int TagCount);

sealed class JsonChallenge : Challenge
{
    public override (object, uint, long) Gen(int n, Rng rng)
    {
        var sb = new StringBuilder(n * 110);
        sb.Append('[');
        for (int i = 0; i < n; i++)
        {
            var country = H.Countries[rng.Int(20)];
            int age = 10 + rng.Int(80), score = rng.Int(1000);
            bool active = (rng.Next() & 1) == 1;
            int t1 = rng.Int(10), t2 = rng.Int(10);
            if (i > 0) sb.Append(',');
            sb.Append($"{{\"id\":{i},\"name\":\"user_{i}\",\"country\":\"{country}\",\"age\":{age},\"score\":{score},\"active\":{(active ? "true" : "false")},\"tags\":[\"t{t1}\",\"t{t2}\"]}}");
        }
        sb.Append(']');
        var text = sb.ToString();
        return (text, H.Fnv1a(text), n);
    }
    public override Out Run(object work)
    {
        var records = JsonSerializer.Deserialize<List<JsonRecord>>((string)work, H.Json)!;
        var output = new List<JsonOut>();
        foreach (var r in records)
            if (r.Active && r.Score >= 500) output.Add(new JsonOut(r.Country, r.Id, r.Name.ToUpperInvariant(), r.Score * 2, r.Tags.Count));
        return new Out(JsonSerializer.Serialize(output, H.Json));
    }
    public override uint Check(Out o) => H.Fnv1a((string)o.Value);
}

sealed class StringsChallenge : Challenge
{
    public override (object, uint, long) Gen(int n, Rng rng)
    {
        var sb = new StringBuilder(n * 90);
        for (int i = 0; i < n; i++)
        {
            var level = H.Levels[rng.Int(4)];
            int user = rng.Int(1000);
            var res = H.Resources[rng.Int(5)];
            int id = rng.Int(10000), status = H.Statuses[rng.Int(6)], latency = rng.Int(2000);
            if (i > 0) sb.Append('\n');
            sb.Append($"ts={1700000000 + i} level={level} user=u{user} path=/api/{res}/{id} status={status} latency={latency}ms");
        }
        var text = sb.ToString();
        return (text, H.Fnv1a(text), n);
    }
    public override Out Run(object work)
    {
        var pattern = new Regex(@"status=(\d{3}) latency=(\d+)ms");
        ulong lines = 0, s5xx = 0, errors = 0, latency = 0, tokens = 0;
        foreach (var line in ((string)work).Split('\n'))
        {
            lines++;
            var m = pattern.Match(line);
            if (m.Success)
            {
                if (int.Parse(m.Groups[1].ValueSpan) >= 500) s5xx++;
                latency += ulong.Parse(m.Groups[2].ValueSpan);
            }
            if (line.Contains("level=ERROR", StringComparison.Ordinal)) errors++;
            tokens += (ulong)line.Split(' ').Length;
        }
        return new Out(new ulong[] { lines, s5xx, errors, latency & H.M, tokens });
    }
    public override uint Check(Out o) => H.FoldAll((ulong[])o.Value);
}

sealed class SieveChallenge : Challenge
{
    public override (object, uint, long) Gen(int n, Rng rng) => (n, (uint)n, n);
    public override Out Run(object work)
    {
        int n = (int)work;
        var composite = new bool[n + 1];
        for (long i = 2; i * i <= n; i++)
            if (!composite[i])
                for (long j = i * i; j <= n; j += i) composite[j] = true;
        ulong count = 0, sum = 0;
        for (int i = 2; i <= n; i++)
            if (!composite[i]) { count++; sum += (ulong)i; }
        return new Out(new ulong[] { count, sum & H.M });
    }
    public override uint Check(Out o) => H.FoldAll((ulong[])o.Value);
}

sealed class Rec(int id, string name, string country, int age, int score, int createdAt)
{
    public readonly int Id = id, Age = age, Score = score, CreatedAt = createdAt;
    public readonly string Name = name, Country = country;
}
sealed class Agg(string country)
{
    public readonly string Country = country;
    public ulong Count, Sum, Max, AgeSum;
}

sealed class RecordsChallenge : Challenge
{
    public override (object, uint, long) Gen(int n, Rng rng)
    {
        var list = new List<Rec>(n);
        uint h = 0;
        for (int i = 0; i < n; i++)
        {
            int c = rng.Int(20), age = 10 + rng.Int(80), score = rng.Int(1000), created = 1700000000 + rng.Int(31536000);
            list.Add(new Rec(i, $"user_{i}", H.Countries[c], age, score, created));
            h = H.Fold(H.Fold(H.Fold(H.Fold(h, (uint)c), (uint)age), (uint)score), (uint)created);
        }
        return (list, h, n);
    }
    public override Out Run(object work)
    {
        const int cutoff = 1700000000 + 15768000;
        var groups = new Dictionary<string, Agg>();
        foreach (var r in (List<Rec>)work)
        {
            if (r.Age < 18 || r.Score < 100 || r.CreatedAt < cutoff) continue;
            if (!groups.TryGetValue(r.Country, out var g)) groups[r.Country] = g = new Agg(r.Country);
            g.Count++;
            g.Sum += (ulong)r.Score;
            if ((ulong)r.Score > g.Max) g.Max = (ulong)r.Score;
            g.AgeSum += (ulong)r.Age;
        }
        var sorted = groups.Values.ToList();
        sorted.Sort((a, b) => a.Sum != b.Sum ? b.Sum.CompareTo(a.Sum) : string.CompareOrdinal(a.Country, b.Country));
        return new Out(sorted);
    }
    public override uint Check(Out o)
    {
        uint h = 0;
        foreach (var g in (List<Agg>)o.Value)
        {
            h = H.Fold(h, H.Fnv1a(g.Country));
            h = H.Fold(h, g.Count);
            h = H.Fold(h, g.Sum & H.M);
            h = H.Fold(h, g.Max);
            h = H.Fold(h, g.AgeSum & H.M);
        }
        return h;
    }
}

sealed class SearchChallenge : Challenge
{
    public override (object, uint, long) Gen(int n, Rng rng)
    {
        var keys = new int[n];
        var queries = new int[n];
        uint h = 0;
        for (int i = 0; i < n; i++) h = H.Fold(h, (uint)(keys[i] = (int)(rng.Next() & 0x7fffffff)));
        for (int i = 0; i < n; i++)
        {
            queries[i] = (i & 1) == 0 ? keys[rng.Int(n)] : (int)(rng.Next() & 0x7fffffff);
            h = H.Fold(h, (uint)queries[i]);
        }
        return ((keys, queries), h, 2L * n);
    }
    public override Out Run(object work)
    {
        var (keys, queries) = ((int[], int[]))work;
        var phases = new long[4];
        long t = H.NowNs(), now;

        var index = new Dictionary<int, int>();
        for (int i = 0; i < keys.Length; i++) index[keys[i]] = i;
        phases[0] = (now = H.NowNs()) - t; t = now;

        ulong hits = 0, sum = 0;
        foreach (var q in queries)
            if (index.TryGetValue(q, out var v)) { hits++; sum += (ulong)v; }
        phases[1] = (now = H.NowNs()) - t; t = now;

        var sorted = (int[])keys.Clone();
        Array.Sort(sorted);
        phases[2] = (now = H.NowNs()) - t; t = now;

        ulong binHits = 0;
        foreach (var q in queries)
            if (Array.BinarySearch(sorted, q) >= 0) binHits++;
        phases[3] = H.NowNs() - t;
        return new Out(new ulong[] { hits, sum & H.M, binHits }, phases);
    }
    public override uint Check(Out o) => H.FoldAll((ulong[])o.Value);
}

sealed class CsvGroup(string region, int month)
{
    public readonly string Region = region;
    public readonly int Month = month;
    public ulong Orders, Units, Revenue;
}

sealed class CsvChallenge : Challenge
{
    static readonly string[] Regions = { "NA", "EMEA", "APAC", "LATAM", "ANZ", "MEA", "NORDICS", "DACH" };

    public override (object, uint, long) Gen(int n, Rng rng)
    {
        var sb = new StringBuilder(n * 48);
        sb.Append("order_id,date,region,sku,qty,unit_price_cents,discount_pct");
        for (int i = 0; i < n; i++)
        {
            int month = 1 + rng.Int(12), day = 1 + rng.Int(28);
            var region = Regions[rng.Int(8)];
            int sku = rng.Int(1000), qty = 1 + rng.Int(20), price = 99 + rng.Int(99901), discount = 5 * rng.Int(5);
            sb.Append($"\n{i},2026-{month:D2}-{day:D2},{region},SKU-{sku},{qty},{price},{discount}");
        }
        var text = sb.ToString();
        return (text, H.Fnv1a(text), n);
    }
    public override Out Run(object work)
    {
        var lines = ((string)work).Split('\n');
        var groups = new Dictionary<(string, int), CsvGroup>();
        for (int i = 1; i < lines.Length; i++)
        {
            var f = lines[i].Split(',');
            int month = int.Parse(f[1].AsSpan(5, 2));
            int qty = int.Parse(f[4]);
            ulong revenue = (ulong)qty * ulong.Parse(f[5]) * (ulong)(100 - int.Parse(f[6])) / 100;
            if (!groups.TryGetValue((f[2], month), out var g)) groups[(f[2], month)] = g = new CsvGroup(f[2], month);
            g.Orders++;
            g.Units += (ulong)qty;
            g.Revenue += revenue;
        }
        var rows = groups.Values.ToList();
        rows.Sort((a, b) => a.Region != b.Region ? string.CompareOrdinal(a.Region, b.Region) : a.Month.CompareTo(b.Month));
        var sb = new StringBuilder("region,month,orders,units,revenue_cents");
        foreach (var g in rows) sb.Append($"\n{g.Region},2026-{g.Month:D2},{g.Orders},{g.Units},{g.Revenue}");
        return new Out(sb.ToString());
    }
    public override uint Check(Out o) => H.Fnv1a((string)o.Value);
}

sealed class MetricsChallenge : Challenge
{
    public override (object, uint, long) Gen(int n, Rng rng)
    {
        var values = new int[n];
        uint h = 0;
        for (int i = 0; i < n; i++)
        {
            int v = 20 + rng.Int(80);
            if (rng.Int(100) < 3) v += 200 + rng.Int(800);
            values[i] = v;
            h = H.Fold(h, (uint)v);
        }
        return (values, h, n);
    }
    public override Out Run(object work)
    {
        var values = (int[])work;
        int n = values.Length;
        ulong window = 0, slow = 0, peak = 0, total = 0;
        for (int i = 0; i < n; i++)
        {
            window += (ulong)values[i];
            total += (ulong)values[i];
            if (i >= 60) window -= (ulong)values[i - 60];
            if (i >= 59)
            {
                if (window > 7200) slow++;
                if (window > peak) peak = window;
            }
        }
        uint buckets = 0;
        for (int start = 0; start < n; start += 60)
        {
            int max = 0;
            for (int i = start; i < Math.Min(start + 60, n); i++) max = Math.Max(max, values[i]);
            buckets = H.Fold(buckets, (uint)max);
        }
        var sorted = (int[])values.Clone();
        Array.Sort(sorted);
        ulong Rank(int p) => (ulong)sorted[(p * n + 99) / 100 - 1];
        ulong meanMilli = total * 1000 / (ulong)n;
        return new Out(new ulong[] { slow, peak, buckets, Rank(50), Rank(95), Rank(99), (ulong)sorted[n - 1], meanMilli & H.M });
    }
    public override uint Check(Out o) => H.FoldAll((ulong[])o.Value);
}

sealed record Mlp(int[] W1, int[] B1, int[] W2, int[] B2, int[] W3, int[] B3, int[] X, int N);

sealed class InferChallenge : Challenge
{
    const int In = 64, Hidden = 64, OutN = 10;

    public override (object, uint, long) Gen(int n, Rng rng)
    {
        uint h = 0;
        int[] Draw(int count, int k, int offset)
        {
            var arr = new int[count];
            for (int i = 0; i < count; i++)
            {
                int raw = rng.Int(k);
                h = H.Fold(h, (uint)raw);
                arr[i] = raw - offset;
            }
            return arr;
        }
        var w1 = Draw(Hidden * In, 255, 127);
        var b1 = Draw(Hidden, 2001, 1000);
        var w2 = Draw(Hidden * Hidden, 255, 127);
        var b2 = Draw(Hidden, 2001, 1000);
        var w3 = Draw(OutN * Hidden, 255, 127);
        var b3 = Draw(OutN, 2001, 1000);
        var x = Draw(n * In, 256, 128);
        return (new Mlp(w1, b1, w2, b2, w3, b3, x, n), h, n);
    }
    static void Dense(int[] w, int[] b, int[] input, int inOff, int inLen, int[] output)
    {
        for (int j = 0; j < output.Length; j++)
        {
            int a = b[j];
            int row = j * inLen;
            for (int k = 0; k < inLen; k++) a += w[row + k] * input[inOff + k];
            output[j] = a;
        }
    }
    public override Out Run(object work)
    {
        var m = (Mlp)work;
        int[] h1 = new int[Hidden], h2 = new int[Hidden], logits = new int[OutN];
        uint preds = 0;
        ulong conf = 0;
        for (int s = 0; s < m.N; s++)
        {
            Dense(m.W1, m.B1, m.X, s * In, In, h1);
            for (int j = 0; j < Hidden; j++) h1[j] = Math.Min(127, Math.Max(0, h1[j]) / 1024);
            Dense(m.W2, m.B2, h1, 0, Hidden, h2);
            for (int j = 0; j < Hidden; j++) h2[j] = Math.Min(127, Math.Max(0, h2[j]) / 1024);
            Dense(m.W3, m.B3, h2, 0, Hidden, logits);
            int pred = 0;
            for (int o = 1; o < OutN; o++) if (logits[o] > logits[pred]) pred = o;
            preds = H.Fold(preds, (uint)pred);
            conf = (conf + (ulong)(logits[pred] + 4194304)) & H.M;
        }
        return new Out(new ulong[] { preds, conf });
    }
    public override uint Check(Out o) => H.FoldAll((ulong[])o.Value);
}

sealed class EmbedChallenge : Challenge
{
    const int D = 64, Q = 8, K = 10;

    public override (object, uint, long) Gen(int n, Rng rng)
    {
        uint h = 0;
        int[] Draw(int count)
        {
            var arr = new int[count];
            for (int i = 0; i < count; i++)
            {
                int raw = rng.Int(256);
                h = H.Fold(h, (uint)raw);
                arr[i] = raw - 128;
            }
            return arr;
        }
        var docs = Draw(n * D);
        var queries = Draw(Q * D);
        return ((docs, queries), h, (long)n * Q);
    }
    public override Out Run(object work)
    {
        var (docs, queries) = ((int[], int[]))work;
        int n = docs.Length / D;
        var results = new List<ulong>(Q * K * 2);
        var scores = new int[n];
        var order = new int[n];
        for (int q = 0; q < Q; q++)
        {
            int qo = q * D;
            for (int d = 0; d < n; d++)
            {
                int dOff = d * D, s = 0;
                for (int k = 0; k < D; k++) s += docs[dOff + k] * queries[qo + k];
                scores[d] = s;
                order[d] = d;
            }
            Array.Sort(order, (a, b) => scores[a] != scores[b] ? scores[b].CompareTo(scores[a]) : a.CompareTo(b));
            for (int r = 0; r < K; r++)
            {
                results.Add((ulong)order[r]);
                results.Add((ulong)(scores[order[r]] + 2097152));
            }
        }
        return new Out(results.ToArray());
    }
    public override uint Check(Out o) => H.FoldAll((ulong[])o.Value);
}

sealed class PixelChallenge : Challenge
{
    public override (object, uint, long) Gen(int n, Rng rng)
    {
        var rgb = new int[n * n * 3];
        uint h = 0;
        for (int y = 0; y < n; y++)
            for (int x = 0; x < n; x++)
            {
                int p = (y * n + x) * 3;
                rgb[p] = (x + y + rng.Int(64)) % 256;
                rgb[p + 1] = (2 * x + rng.Int(64)) % 256;
                rgb[p + 2] = (2 * y + rng.Int(64)) % 256;
                h = H.Fold(H.Fold(H.Fold(h, (uint)rgb[p]), (uint)rgb[p + 1]), (uint)rgb[p + 2]);
            }
        return ((rgb, n), h, (long)n * n);
    }
    public override Out Run(object work)
    {
        var (rgb, n) = ((int[], int))work;
        var phases = new long[4];
        long t = H.NowNs(), now;
        int Cl(int v) => Math.Clamp(v, 0, n - 1);

        var gray = new int[n * n];
        for (int i = 0; i < n * n; i++) gray[i] = (77 * rgb[i * 3] + 150 * rgb[i * 3 + 1] + 29 * rgb[i * 3 + 2]) / 256;
        phases[0] = (now = H.NowNs()) - t; t = now;

        var blur = new int[n * n];
        for (int y = 0; y < n; y++)
        {
            int ru = Cl(y - 1) * n, r0 = y * n, rd = Cl(y + 1) * n;
            for (int x = 0; x < n; x++)
            {
                int xl = Cl(x - 1), xr = Cl(x + 1);
                int s = gray[ru + xl] + 2 * gray[ru + x] + gray[ru + xr] + 2 * gray[r0 + xl] + 4 * gray[r0 + x] + 2 * gray[r0 + xr] + gray[rd + xl] + 2 * gray[rd + x] + gray[rd + xr];
                blur[r0 + x] = s / 16;
            }
        }
        phases[1] = (now = H.NowNs()) - t; t = now;

        var mag = new int[n * n];
        for (int y = 0; y < n; y++)
        {
            int ru = Cl(y - 1) * n, r0 = y * n, rd = Cl(y + 1) * n;
            for (int x = 0; x < n; x++)
            {
                int xl = Cl(x - 1), xr = Cl(x + 1);
                int gx = blur[ru + xr] + 2 * blur[r0 + xr] + blur[rd + xr] - (blur[ru + xl] + 2 * blur[r0 + xl] + blur[rd + xl]);
                int gy = blur[rd + xl] + 2 * blur[rd + x] + blur[rd + xr] - (blur[ru + xl] + 2 * blur[ru + x] + blur[ru + xr]);
                mag[r0 + x] = Math.Min(255, Math.Abs(gx) + Math.Abs(gy));
            }
        }
        phases[2] = (now = H.NowNs()) - t; t = now;

        var result = new ulong[257];
        foreach (var m in mag)
        {
            result[m]++;
            if (m >= 128) result[256]++;
        }
        phases[3] = H.NowNs() - t;

        return new Out(result, phases);
    }
    public override uint Check(Out o) => H.FoldAll((ulong[])o.Value);
}

static class Program
{
    static int Main(string[] args)
    {
        H.Emit("{\"e\":\"hello\",\"lang\":\"csharp\"}");
        try
        {
            Challenge c = args[0] switch
            {
                "sort" => new SortChallenge(),
                "json" => new JsonChallenge(),
                "strings" => new StringsChallenge(),
                "sieve" => new SieveChallenge(),
                "records" => new RecordsChallenge(),
                "search" => new SearchChallenge(),
                "csv" => new CsvChallenge(),
                "metrics" => new MetricsChallenge(),
                "infer" => new InferChallenge(),
                "embed" => new EmbedChallenge(),
                "pixel" => new PixelChallenge(),
                _ => throw new ArgumentException($"unknown challenge: {args[0]}"),
            };
            int size = int.Parse(args[1]), warmup = int.Parse(args[3]), runs = int.Parse(args[4]);
            var rng = new Rng(ulong.Parse(args[2]));
            long g0 = H.NowNs();
            var (input, hash, ops) = c.Gen(size, rng);
            H.Emit($"{{\"e\":\"ready\",\"genNs\":{H.NowNs() - g0},\"input\":\"{hash:x8}\",\"ops\":{ops}}}");
            for (int i = 0; i < warmup + runs; i++)
            {
                var work = c.Prepare(input);
                long t0 = H.NowNs();
                var o = c.Run(work);
                long ns = H.NowNs() - t0;
                bool warm = i < warmup;
                var line = $"{{\"e\":\"{(warm ? "warmup" : "run")}\",\"i\":{(warm ? i : i - warmup)},\"ns\":{ns},\"check\":\"{c.Check(o):x8}\"";
                if (o.Phases is not null) line += $",\"phases\":[{string.Join(",", o.Phases)}]";
                H.Emit(line + "}");
            }
            H.Emit("{\"e\":\"done\"}");
            return 0;
        }
        catch (Exception e)
        {
            H.Emit($"{{\"e\":\"error\",\"msg\":{JsonSerializer.Serialize(e.Message)}}}");
            return 1;
        }
    }
}
