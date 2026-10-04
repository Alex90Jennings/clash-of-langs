import com.fasterxml.jackson.annotation.JsonPropertyOrder;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class Harness {
    static final String[] COUNTRIES = {"US", "GB", "DE", "FR", "JP", "BR", "IN", "CN", "CA", "AU", "NO", "SE", "ZA", "NG", "MX", "ES", "IT", "KR", "NL", "PL"};
    static final String[] LEVELS = {"INFO", "WARN", "ERROR", "DEBUG"};
    static final String[] RESOURCES = {"users", "orders", "items", "auth", "search"};
    static final int[] STATUSES = {200, 200, 200, 201, 404, 500};
    static final ObjectMapper MAPPER = new ObjectMapper();

    static void emit(String json) {
        System.out.println(json);
        System.out.flush();
    }

    static final class Rng {
        private int s;

        Rng(long seed) {
            s = (int) seed;
            if (s == 0) s = 0x9e3779b9;
        }

        long next() {
            int x = s;
            x ^= x << 13;
            x ^= x >>> 17;
            x ^= x << 5;
            s = x;
            return x & 0xFFFFFFFFL;
        }

        int nextInt(int n) {
            return (int) (next() % n);
        }
    }

    static int fold(int h, long v) {
        return h * 31 + (int) v;
    }

    static int fnv1a(String s) {
        int h = 0x811c9dc5;
        for (int i = 0; i < s.length(); i++) {
            h ^= s.charAt(i);
            h *= 0x01000193;
        }
        return h;
    }

    static String hex8(int h) {
        return String.format("%08x", h);
    }

    static int foldAll(long[] values) {
        int h = 0;
        for (long v : values) h = fold(h, v);
        return h;
    }

    static final class Out {
        final Object value;
        final long[] phases;

        Out(Object value, long[] phases) {
            this.value = value;
            this.phases = phases;
        }
    }

    interface Challenge {
        Object[] gen(int n, Rng rng);

        Object prepare(Object input);

        Out run(Object work) throws Exception;

        int check(Out out);
    }

    static final class SortChallenge implements Challenge {
        public Object[] gen(int n, Rng rng) {
            int[] data = new int[n];
            int h = 0;
            for (int i = 0; i < n; i++) {
                data[i] = (int) (rng.next() & 0x7FFFFFFF);
                h = fold(h, data[i]);
            }
            return new Object[]{data, h, (long) n};
        }

        public Object prepare(Object input) {
            return ((int[]) input).clone();
        }

        public Out run(Object work) {
            int[] data = (int[]) work;
            Arrays.sort(data);
            return new Out(data, null);
        }

        public int check(Out out) {
            int h = 0;
            for (int v : (int[]) out.value) h = fold(h, v);
            return h;
        }
    }

    public static final class JsonRecord {
        public int id;
        public String name;
        public String country;
        public int age;
        public int score;
        public boolean active;
        public List<String> tags;
    }

    @JsonPropertyOrder({"country", "id", "name", "score2", "tagCount"})
    public static final class JsonOut {
        public int id;
        public String name;
        public String country;
        public int score2;
        public int tagCount;

        JsonOut(int id, String name, String country, int score2, int tagCount) {
            this.id = id;
            this.name = name;
            this.country = country;
            this.score2 = score2;
            this.tagCount = tagCount;
        }
    }

    static final class JsonChallenge implements Challenge {
        private static final TypeReference<List<JsonRecord>> LIST_OF_RECORDS = new TypeReference<List<JsonRecord>>() {};

        public Object[] gen(int n, Rng rng) {
            StringBuilder sb = new StringBuilder(n * 110);
            sb.append('[');
            for (int i = 0; i < n; i++) {
                String country = COUNTRIES[rng.nextInt(20)];
                int age = 10 + rng.nextInt(80);
                int score = rng.nextInt(1000);
                boolean active = (rng.next() & 1) == 1;
                int t1 = rng.nextInt(10);
                int t2 = rng.nextInt(10);
                if (i > 0) sb.append(',');
                sb.append("{\"id\":").append(i)
                  .append(",\"name\":\"user_").append(i)
                  .append("\",\"country\":\"").append(country)
                  .append("\",\"age\":").append(age)
                  .append(",\"score\":").append(score)
                  .append(",\"active\":").append(active)
                  .append(",\"tags\":[\"t").append(t1).append("\",\"t").append(t2).append("\"]}");
            }
            sb.append(']');
            String text = sb.toString();
            return new Object[]{text, fnv1a(text), (long) n};
        }

        public Object prepare(Object input) {
            return input;
        }

        public Out run(Object work) throws Exception {
            List<JsonRecord> records = MAPPER.readValue((String) work, LIST_OF_RECORDS);
            List<JsonOut> out = new ArrayList<>();
            for (JsonRecord r : records) {
                if (r.active && r.score >= 500) {
                    out.add(new JsonOut(r.id, r.name.toUpperCase(Locale.ROOT), r.country, r.score * 2, r.tags.size()));
                }
            }
            return new Out(MAPPER.writeValueAsString(out), null);
        }

        public int check(Out out) {
            return fnv1a((String) out.value);
        }
    }

    static final class StringsChallenge implements Challenge {
        public Object[] gen(int n, Rng rng) {
            StringBuilder sb = new StringBuilder(n * 90);
            for (int i = 0; i < n; i++) {
                String level = LEVELS[rng.nextInt(4)];
                int user = rng.nextInt(1000);
                String res = RESOURCES[rng.nextInt(5)];
                int id = rng.nextInt(10000);
                int status = STATUSES[rng.nextInt(6)];
                int latency = rng.nextInt(2000);
                if (i > 0) sb.append('\n');
                sb.append("ts=").append(1700000000 + i)
                  .append(" level=").append(level)
                  .append(" user=u").append(user)
                  .append(" path=/api/").append(res).append('/').append(id)
                  .append(" status=").append(status)
                  .append(" latency=").append(latency).append("ms");
            }
            String text = sb.toString();
            return new Object[]{text, fnv1a(text), (long) n};
        }

        public Object prepare(Object input) {
            return input;
        }

        public Out run(Object work) {
            Pattern pattern = Pattern.compile("status=(\\d{3}) latency=(\\d+)ms");
            long lines = 0, s5xx = 0, errors = 0, latency = 0, tokens = 0;
            for (String line : ((String) work).split("\n")) {
                lines++;
                Matcher m = pattern.matcher(line);
                if (m.find()) {
                    if (Integer.parseInt(m.group(1)) >= 500) s5xx++;
                    latency += Integer.parseInt(m.group(2));
                }
                if (line.contains("level=ERROR")) errors++;
                tokens += line.split(" ").length;
            }
            return new Out(new long[]{lines, s5xx, errors, latency & 0xFFFFFFFFL, tokens}, null);
        }

        public int check(Out out) {
            return foldAll((long[]) out.value);
        }
    }

    static final class SieveChallenge implements Challenge {
        public Object[] gen(int n, Rng rng) {
            return new Object[]{n, n, (long) n};
        }

        public Object prepare(Object input) {
            return input;
        }

        public Out run(Object work) {
            int n = (Integer) work;
            boolean[] composite = new boolean[n + 1];
            for (int i = 2; (long) i * i <= n; i++) {
                if (!composite[i]) {
                    for (int j = i * i; j <= n; j += i) composite[j] = true;
                }
            }
            long count = 0, sum = 0;
            for (int i = 2; i <= n; i++) {
                if (!composite[i]) {
                    count++;
                    sum += i;
                }
            }
            return new Out(new long[]{count, sum & 0xFFFFFFFFL}, null);
        }

        public int check(Out out) {
            return foldAll((long[]) out.value);
        }
    }

    static final class Rec {
        final int id;
        final String name;
        final String country;
        final int age;
        final int score;
        final int createdAt;

        Rec(int id, String name, String country, int age, int score, int createdAt) {
            this.id = id;
            this.name = name;
            this.country = country;
            this.age = age;
            this.score = score;
            this.createdAt = createdAt;
        }
    }

    static final class Agg {
        final String country;
        long count, sum, ageSum;
        int max;

        Agg(String country) {
            this.country = country;
        }
    }

    static final class RecordsChallenge implements Challenge {
        public Object[] gen(int n, Rng rng) {
            List<Rec> records = new ArrayList<>(n);
            int h = 0;
            for (int i = 0; i < n; i++) {
                int c = rng.nextInt(20);
                int age = 10 + rng.nextInt(80);
                int score = rng.nextInt(1000);
                int createdAt = 1700000000 + rng.nextInt(31536000);
                records.add(new Rec(i, "user_" + i, COUNTRIES[c], age, score, createdAt));
                h = fold(fold(fold(fold(h, c), age), score), createdAt);
            }
            return new Object[]{records, h, (long) n};
        }

        public Object prepare(Object input) {
            return input;
        }

        @SuppressWarnings("unchecked")
        public Out run(Object work) {
            final int cutoff = 1700000000 + 15768000;
            Map<String, Agg> groups = new HashMap<>();
            for (Rec r : (List<Rec>) work) {
                if (r.age >= 18 && r.score >= 100 && r.createdAt >= cutoff) {
                    Agg g = groups.computeIfAbsent(r.country, Agg::new);
                    g.count++;
                    g.sum += r.score;
                    if (r.score > g.max) g.max = r.score;
                    g.ageSum += r.age;
                }
            }
            List<Agg> sorted = new ArrayList<>(groups.values());
            sorted.sort((a, b) -> a.sum != b.sum ? Long.compare(b.sum, a.sum) : a.country.compareTo(b.country));
            return new Out(sorted, null);
        }

        @SuppressWarnings("unchecked")
        public int check(Out out) {
            int h = 0;
            for (Agg g : (List<Agg>) out.value) {
                h = fold(h, fnv1a(g.country) & 0xFFFFFFFFL);
                h = fold(h, g.count);
                h = fold(h, g.sum & 0xFFFFFFFFL);
                h = fold(h, g.max);
                h = fold(h, g.ageSum & 0xFFFFFFFFL);
            }
            return h;
        }
    }

    static final class SearchChallenge implements Challenge {
        public Object[] gen(int n, Rng rng) {
            int[] keys = new int[n];
            int[] queries = new int[n];
            int h = 0;
            for (int i = 0; i < n; i++) {
                keys[i] = (int) (rng.next() & 0x7FFFFFFF);
                h = fold(h, keys[i]);
            }
            for (int i = 0; i < n; i++) {
                queries[i] = (i & 1) == 0 ? keys[rng.nextInt(n)] : (int) (rng.next() & 0x7FFFFFFF);
                h = fold(h, queries[i]);
            }
            return new Object[]{new int[][]{keys, queries}, h, 2L * n};
        }

        public Object prepare(Object input) {
            return input;
        }

        public Out run(Object work) {
            int[] keys = ((int[][]) work)[0];
            int[] queries = ((int[][]) work)[1];
            long[] phases = new long[4];
            long t = System.nanoTime();

            Map<Integer, Integer> index = new HashMap<>();
            for (int i = 0; i < keys.length; i++) index.put(keys[i], i);
            long now = System.nanoTime();
            phases[0] = now - t;
            t = now;

            long hits = 0, sum = 0;
            for (int q : queries) {
                Integer v = index.get(q);
                if (v != null) {
                    hits++;
                    sum += v;
                }
            }
            now = System.nanoTime();
            phases[1] = now - t;
            t = now;

            int[] sorted = keys.clone();
            Arrays.sort(sorted);
            now = System.nanoTime();
            phases[2] = now - t;
            t = now;

            long binHits = 0;
            for (int q : queries) {
                if (Arrays.binarySearch(sorted, q) >= 0) binHits++;
            }
            now = System.nanoTime();
            phases[3] = now - t;

            return new Out(new long[]{hits, sum & 0xFFFFFFFFL, binHits}, phases);
        }

        public int check(Out out) {
            return foldAll((long[]) out.value);
        }
    }

    static final String[] REGIONS = {"NA", "EMEA", "APAC", "LATAM", "ANZ", "MEA", "NORDICS", "DACH"};

    static String pad2(int v) {
        return v < 10 ? "0" + v : String.valueOf(v);
    }

    static final class CsvGroup {
        final String region;
        final int month;
        long orders, units, revenue;

        CsvGroup(String region, int month) {
            this.region = region;
            this.month = month;
        }
    }

    static final class CsvChallenge implements Challenge {
        public Object[] gen(int n, Rng rng) {
            StringBuilder sb = new StringBuilder(n * 48);
            sb.append("order_id,date,region,sku,qty,unit_price_cents,discount_pct");
            for (int i = 0; i < n; i++) {
                int month = 1 + rng.nextInt(12);
                int day = 1 + rng.nextInt(28);
                String region = REGIONS[rng.nextInt(8)];
                int sku = rng.nextInt(1000);
                int qty = 1 + rng.nextInt(20);
                int price = 99 + rng.nextInt(99901);
                int discount = 5 * rng.nextInt(5);
                sb.append('\n').append(i)
                  .append(",2026-").append(pad2(month)).append('-').append(pad2(day))
                  .append(',').append(region)
                  .append(",SKU-").append(sku)
                  .append(',').append(qty)
                  .append(',').append(price)
                  .append(',').append(discount);
            }
            String text = sb.toString();
            return new Object[]{text, fnv1a(text), (long) n};
        }

        public Object prepare(Object input) {
            return input;
        }

        public Out run(Object work) {
            String[] lines = ((String) work).split("\n");
            Map<String, CsvGroup> groups = new HashMap<>();
            for (int i = 1; i < lines.length; i++) {
                String[] f = lines[i].split(",");
                int month = Integer.parseInt(f[1].substring(5, 7));
                int qty = Integer.parseInt(f[4]);
                long revenue = (long) qty * Integer.parseInt(f[5]) * (100 - Integer.parseInt(f[6])) / 100;
                CsvGroup g = groups.computeIfAbsent(f[2] + "|" + month, k -> new CsvGroup(f[2], month));
                g.orders++;
                g.units += qty;
                g.revenue += revenue;
            }
            List<CsvGroup> rows = new ArrayList<>(groups.values());
            rows.sort(Comparator.comparing((CsvGroup g) -> g.region).thenComparingInt(g -> g.month));
            StringBuilder sb = new StringBuilder("region,month,orders,units,revenue_cents");
            for (CsvGroup g : rows) {
                sb.append('\n').append(g.region)
                  .append(",2026-").append(pad2(g.month))
                  .append(',').append(g.orders)
                  .append(',').append(g.units)
                  .append(',').append(g.revenue);
            }
            return new Out(sb.toString(), null);
        }

        public int check(Out out) {
            return fnv1a((String) out.value);
        }
    }

    static final class MetricsChallenge implements Challenge {
        public Object[] gen(int n, Rng rng) {
            int[] values = new int[n];
            int h = 0;
            for (int i = 0; i < n; i++) {
                int v = 20 + rng.nextInt(80);
                if (rng.nextInt(100) < 3) v += 200 + rng.nextInt(800);
                values[i] = v;
                h = fold(h, v);
            }
            return new Object[]{values, h, (long) n};
        }

        public Object prepare(Object input) {
            return input;
        }

        public Out run(Object work) {
            int[] values = (int[]) work;
            int n = values.length;
            long window = 0, slow = 0, peak = 0, total = 0;
            for (int i = 0; i < n; i++) {
                window += values[i];
                total += values[i];
                if (i >= 60) window -= values[i - 60];
                if (i >= 59) {
                    if (window > 7200) slow++;
                    if (window > peak) peak = window;
                }
            }
            int buckets = 0;
            for (int start = 0; start < n; start += 60) {
                int max = 0;
                for (int i = start; i < Math.min(start + 60, n); i++) max = Math.max(max, values[i]);
                buckets = fold(buckets, max);
            }
            int[] sorted = values.clone();
            Arrays.sort(sorted);
            long meanMilli = total * 1000 / n;
            return new Out(new long[]{slow, peak, buckets & 0xFFFFFFFFL, sorted[(50 * n + 99) / 100 - 1], sorted[(95 * n + 99) / 100 - 1], sorted[(99 * n + 99) / 100 - 1], sorted[n - 1], meanMilli & 0xFFFFFFFFL}, null);
        }

        public int check(Out out) {
            return foldAll((long[]) out.value);
        }
    }

    static final int NN_IN = 64, NN_H = 64, NN_OUT = 10;

    static final class Mlp {
        int[] w1, b1, w2, b2, w3, b3, x;
        int n;
    }

    static final class InferChallenge implements Challenge {
        private int h;

        private int[] draw(Rng rng, int count, int k, int offset) {
            int[] out = new int[count];
            for (int i = 0; i < count; i++) {
                int raw = rng.nextInt(k);
                h = fold(h, raw);
                out[i] = raw - offset;
            }
            return out;
        }

        public Object[] gen(int n, Rng rng) {
            h = 0;
            Mlp m = new Mlp();
            m.w1 = draw(rng, NN_H * NN_IN, 255, 127);
            m.b1 = draw(rng, NN_H, 2001, 1000);
            m.w2 = draw(rng, NN_H * NN_H, 255, 127);
            m.b2 = draw(rng, NN_H, 2001, 1000);
            m.w3 = draw(rng, NN_OUT * NN_H, 255, 127);
            m.b3 = draw(rng, NN_OUT, 2001, 1000);
            m.x = draw(rng, n * NN_IN, 256, 128);
            m.n = n;
            return new Object[]{m, h, (long) n};
        }

        public Object prepare(Object input) {
            return input;
        }

        private static void dense(int[] w, int[] b, int[] input, int inOff, int inLen, int[] out) {
            for (int j = 0; j < out.length; j++) {
                int a = b[j];
                int row = j * inLen;
                for (int k = 0; k < inLen; k++) a += w[row + k] * input[inOff + k];
                out[j] = a;
            }
        }

        public Out run(Object work) {
            Mlp m = (Mlp) work;
            int[] h1 = new int[NN_H], h2 = new int[NN_H], logits = new int[NN_OUT];
            int preds = 0;
            long conf = 0;
            for (int s = 0; s < m.n; s++) {
                dense(m.w1, m.b1, m.x, s * NN_IN, NN_IN, h1);
                for (int j = 0; j < NN_H; j++) h1[j] = Math.min(127, Math.max(0, h1[j]) / 1024);
                dense(m.w2, m.b2, h1, 0, NN_H, h2);
                for (int j = 0; j < NN_H; j++) h2[j] = Math.min(127, Math.max(0, h2[j]) / 1024);
                dense(m.w3, m.b3, h2, 0, NN_H, logits);
                int pred = 0;
                for (int o = 1; o < NN_OUT; o++) if (logits[o] > logits[pred]) pred = o;
                preds = fold(preds, pred);
                conf = (conf + logits[pred] + 4194304) & 0xFFFFFFFFL;
            }
            return new Out(new long[]{preds & 0xFFFFFFFFL, conf}, null);
        }

        public int check(Out out) {
            return foldAll((long[]) out.value);
        }
    }

    static final int EMB_D = 64, EMB_Q = 8, EMB_K = 10;

    static final class EmbedChallenge implements Challenge {
        public Object[] gen(int n, Rng rng) {
            int[] docs = new int[n * EMB_D];
            int[] queries = new int[EMB_Q * EMB_D];
            int h = 0;
            for (int i = 0; i < docs.length; i++) {
                int raw = rng.nextInt(256);
                h = fold(h, raw);
                docs[i] = raw - 128;
            }
            for (int i = 0; i < queries.length; i++) {
                int raw = rng.nextInt(256);
                h = fold(h, raw);
                queries[i] = raw - 128;
            }
            return new Object[]{new int[][]{docs, queries}, h, (long) n * EMB_Q};
        }

        public Object prepare(Object input) {
            return input;
        }

        public Out run(Object work) {
            int[] docs = ((int[][]) work)[0];
            int[] queries = ((int[][]) work)[1];
            int n = docs.length / EMB_D;
            long[] results = new long[EMB_Q * EMB_K * 2];
            int[] scores = new int[n];
            Integer[] order = new Integer[n];
            int r = 0;
            for (int q = 0; q < EMB_Q; q++) {
                int qo = q * EMB_D;
                for (int d = 0; d < n; d++) {
                    int dOff = d * EMB_D;
                    int s = 0;
                    for (int k = 0; k < EMB_D; k++) s += docs[dOff + k] * queries[qo + k];
                    scores[d] = s;
                    order[d] = d;
                }
                Arrays.sort(order, (a, b) -> scores[a] != scores[b] ? Integer.compare(scores[b], scores[a]) : Integer.compare(a, b));
                for (int k = 0; k < EMB_K; k++) {
                    results[r++] = order[k];
                    results[r++] = scores[order[k]] + 2097152;
                }
            }
            return new Out(results, null);
        }

        public int check(Out out) {
            return foldAll((long[]) out.value);
        }
    }

    static final class PixelChallenge implements Challenge {
        public Object[] gen(int n, Rng rng) {
            int[] rgb = new int[n * n * 3];
            int h = 0;
            for (int y = 0; y < n; y++) {
                for (int x = 0; x < n; x++) {
                    int p = (y * n + x) * 3;
                    rgb[p] = (x + y + rng.nextInt(64)) % 256;
                    rgb[p + 1] = (2 * x + rng.nextInt(64)) % 256;
                    rgb[p + 2] = (2 * y + rng.nextInt(64)) % 256;
                    h = fold(fold(fold(h, rgb[p]), rgb[p + 1]), rgb[p + 2]);
                }
            }
            return new Object[]{new Object[]{rgb, n}, h, (long) n * n};
        }

        public Object prepare(Object input) {
            return input;
        }

        public Out run(Object work) {
            int[] rgb = (int[]) ((Object[]) work)[0];
            int n = (Integer) ((Object[]) work)[1];
            long[] phases = new long[4];
            long t = System.nanoTime();

            int[] gray = new int[n * n];
            for (int i = 0; i < n * n; i++) gray[i] = (77 * rgb[i * 3] + 150 * rgb[i * 3 + 1] + 29 * rgb[i * 3 + 2]) / 256;
            long now = System.nanoTime();
            phases[0] = now - t;
            t = now;

            int[] blur = new int[n * n];
            for (int y = 0; y < n; y++) {
                int ru = Math.max(y - 1, 0) * n, r0 = y * n, rd = Math.min(y + 1, n - 1) * n;
                for (int x = 0; x < n; x++) {
                    int xl = Math.max(x - 1, 0), xr = Math.min(x + 1, n - 1);
                    int s = gray[ru + xl] + 2 * gray[ru + x] + gray[ru + xr] + 2 * gray[r0 + xl] + 4 * gray[r0 + x] + 2 * gray[r0 + xr] + gray[rd + xl] + 2 * gray[rd + x] + gray[rd + xr];
                    blur[r0 + x] = s / 16;
                }
            }
            now = System.nanoTime();
            phases[1] = now - t;
            t = now;

            int[] mag = new int[n * n];
            for (int y = 0; y < n; y++) {
                int ru = Math.max(y - 1, 0) * n, r0 = y * n, rd = Math.min(y + 1, n - 1) * n;
                for (int x = 0; x < n; x++) {
                    int xl = Math.max(x - 1, 0), xr = Math.min(x + 1, n - 1);
                    int gx = blur[ru + xr] + 2 * blur[r0 + xr] + blur[rd + xr] - (blur[ru + xl] + 2 * blur[r0 + xl] + blur[rd + xl]);
                    int gy = blur[rd + xl] + 2 * blur[rd + x] + blur[rd + xr] - (blur[ru + xl] + 2 * blur[ru + x] + blur[ru + xr]);
                    mag[r0 + x] = Math.min(255, Math.abs(gx) + Math.abs(gy));
                }
            }
            now = System.nanoTime();
            phases[2] = now - t;
            t = now;

            long[] result = new long[257];
            long edges = 0;
            for (int i = 0; i < n * n; i++) {
                result[mag[i]]++;
                if (mag[i] >= 128) edges++;
            }
            result[256] = edges;
            now = System.nanoTime();
            phases[3] = now - t;

            return new Out(result, phases);
        }

        public int check(Out out) {
            return foldAll((long[]) out.value);
        }
    }

    static Challenge lookup(String name) {
        switch (name) {
            case "sort": return new SortChallenge();
            case "json": return new JsonChallenge();
            case "strings": return new StringsChallenge();
            case "sieve": return new SieveChallenge();
            case "records": return new RecordsChallenge();
            case "search": return new SearchChallenge();
            case "csv": return new CsvChallenge();
            case "metrics": return new MetricsChallenge();
            case "infer": return new InferChallenge();
            case "embed": return new EmbedChallenge();
            case "pixel": return new PixelChallenge();
            default: throw new IllegalArgumentException("unknown challenge: " + name);
        }
    }

    public static void main(String[] args) {
        emit("{\"e\":\"hello\",\"lang\":\"java\"}");
        try {
            Challenge c = lookup(args[0]);
            int size = Integer.parseInt(args[1]);
            long seed = Long.parseLong(args[2]);
            int warmup = Integer.parseInt(args[3]);
            int runs = Integer.parseInt(args[4]);

            long g0 = System.nanoTime();
            Object[] generated = c.gen(size, new Rng(seed));
            long genNs = System.nanoTime() - g0;
            emit("{\"e\":\"ready\",\"genNs\":" + genNs + ",\"input\":\"" + hex8((Integer) generated[1]) + "\",\"ops\":" + generated[2] + "}");

            for (int i = 0; i < warmup + runs; i++) {
                Object work = c.prepare(generated[0]);
                long t0 = System.nanoTime();
                Out out = c.run(work);
                long ns = System.nanoTime() - t0;
                boolean warm = i < warmup;
                StringBuilder ev = new StringBuilder();
                ev.append("{\"e\":\"").append(warm ? "warmup" : "run")
                  .append("\",\"i\":").append(warm ? i : i - warmup)
                  .append(",\"ns\":").append(ns)
                  .append(",\"check\":\"").append(hex8(c.check(out))).append('"');
                if (out.phases != null) {
                    ev.append(",\"phases\":[");
                    for (int p = 0; p < out.phases.length; p++) {
                        if (p > 0) ev.append(',');
                        ev.append(out.phases[p]);
                    }
                    ev.append(']');
                }
                ev.append('}');
                emit(ev.toString());
            }
            emit("{\"e\":\"done\"}");
        } catch (Exception e) {
            String msg = String.valueOf(e.getMessage()).replace("\\", "\\\\").replace("\"", "\\\"");
            emit("{\"e\":\"error\",\"msg\":\"" + msg + "\"}");
            System.exit(1);
        }
    }
}
