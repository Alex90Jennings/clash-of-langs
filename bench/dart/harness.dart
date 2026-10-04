import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

const int M = 0xFFFFFFFF;
const countries = ['US', 'GB', 'DE', 'FR', 'JP', 'BR', 'IN', 'CN', 'CA', 'AU', 'NO', 'SE', 'ZA', 'NG', 'MX', 'ES', 'IT', 'KR', 'NL', 'PL'];
const levels = ['INFO', 'WARN', 'ERROR', 'DEBUG'];
const resources = ['users', 'orders', 'items', 'auth', 'search'];
const statuses = [200, 200, 200, 201, 404, 500];

final Stopwatch _clock = Stopwatch()..start();
final int _freq = _clock.frequency;
int nowNs() => _clock.elapsedTicks * 1000000000 ~/ _freq;
void emit(Map<String, Object?> e) => stdout.writeln(jsonEncode(e));

class Rng {
  int _s;
  Rng(int seed) : _s = (seed & M) == 0 ? 0x9E3779B9 : (seed & M);
  int next() {
    var x = _s;
    x ^= (x << 13) & M;
    x ^= x >> 17;
    x ^= (x << 5) & M;
    return _s = x;
  }

  int intN(int n) => next() % n;
}

int fold(int h, int v) => (h * 31 + v) & M;
int fnv1a(String s) {
  var h = 0x811C9DC5;
  for (final b in utf8.encode(s)) {
    h = ((h ^ b) * 0x01000193) & M;
  }
  return h;
}

int foldAll(Iterable<int> v) => v.fold(0, fold);
String hex8(int h) => h.toRadixString(16).padLeft(8, '0');

class Out {
  final Object value;
  final List<int>? phases;
  Out(this.value, [this.phases]);
}

abstract class Challenge {
  (Object, int, int) gen(int n, Rng rng);
  Object prepare(Object input) => input;
  Out run(Object work);
  int check(Out out);
}

class SortChallenge extends Challenge {
  @override
  (Object, int, int) gen(int n, Rng rng) {
    final data = List<int>.generate(n, (_) => rng.next() & 0x7FFFFFFF);
    return (data, foldAll(data), n);
  }

  @override
  Object prepare(Object input) => List<int>.of(input as List<int>);
  @override
  Out run(Object work) => Out((work as List<int>)..sort());
  @override
  int check(Out out) => foldAll(out.value as List<int>);
}

class JsonChallenge extends Challenge {
  @override
  (Object, int, int) gen(int n, Rng rng) {
    final sb = StringBuffer('[');
    for (var i = 0; i < n; i++) {
      final country = countries[rng.intN(20)];
      final age = 10 + rng.intN(80);
      final score = rng.intN(1000);
      final active = (rng.next() & 1) == 1;
      final t1 = rng.intN(10), t2 = rng.intN(10);
      if (i > 0) sb.write(',');
      sb.write('{"id":$i,"name":"user_$i","country":"$country","age":$age,"score":$score,"active":$active,"tags":["t$t1","t$t2"]}');
    }
    sb.write(']');
    final text = sb.toString();
    return (text, fnv1a(text), n);
  }

  @override
  Out run(Object work) {
    final records = jsonDecode(work as String) as List<dynamic>;
    final out = [
      for (final r in records)
        if (r['active'] == true && (r['score'] as int) >= 500)
          {'country': r['country'], 'id': r['id'], 'name': (r['name'] as String).toUpperCase(), 'score2': (r['score'] as int) * 2, 'tagCount': (r['tags'] as List).length},
    ];
    return Out(jsonEncode(out));
  }

  @override
  int check(Out out) => fnv1a(out.value as String);
}

class StringsChallenge extends Challenge {
  @override
  (Object, int, int) gen(int n, Rng rng) {
    final lines = <String>[];
    for (var i = 0; i < n; i++) {
      final level = levels[rng.intN(4)];
      final user = rng.intN(1000);
      final res = resources[rng.intN(5)];
      final id = rng.intN(10000);
      final status = statuses[rng.intN(6)];
      final latency = rng.intN(2000);
      lines.add('ts=${1700000000 + i} level=$level user=u$user path=/api/$res/$id status=$status latency=${latency}ms');
    }
    final text = lines.join('\n');
    return (text, fnv1a(text), n);
  }

  @override
  Out run(Object work) {
    final pattern = RegExp(r'status=(\d{3}) latency=(\d+)ms');
    var lines = 0, s5xx = 0, errors = 0, latency = 0, tokens = 0;
    for (final line in (work as String).split('\n')) {
      lines++;
      final m = pattern.firstMatch(line);
      if (m != null) {
        if (int.parse(m.group(1)!) >= 500) s5xx++;
        latency += int.parse(m.group(2)!);
      }
      if (line.contains('level=ERROR')) errors++;
      tokens += line.split(' ').length;
    }
    return Out([lines, s5xx, errors, latency & M, tokens]);
  }

  @override
  int check(Out out) => foldAll(out.value as List<int>);
}

class SieveChallenge extends Challenge {
  @override
  (Object, int, int) gen(int n, Rng rng) => (n, n & M, n);
  @override
  Out run(Object work) {
    final n = work as int;
    final composite = List<bool>.filled(n + 1, false);
    for (var i = 2; i * i <= n; i++) {
      if (!composite[i]) {
        for (var j = i * i; j <= n; j += i) {
          composite[j] = true;
        }
      }
    }
    var count = 0, sum = 0;
    for (var k = 2; k <= n; k++) {
      if (!composite[k]) {
        count++;
        sum += k;
      }
    }
    return Out([count, sum & M]);
  }

  @override
  int check(Out out) => foldAll(out.value as List<int>);
}

class Rec {
  final int id, age, score, createdAt;
  final String name, country;
  Rec(this.id, this.name, this.country, this.age, this.score, this.createdAt);
}

class Agg {
  final String country;
  int count = 0, sum = 0, max = 0, ageSum = 0;
  Agg(this.country);
}

class RecordsChallenge extends Challenge {
  @override
  (Object, int, int) gen(int n, Rng rng) {
    var h = 0;
    final recs = <Rec>[];
    for (var i = 0; i < n; i++) {
      final c = rng.intN(20), age = 10 + rng.intN(80), score = rng.intN(1000), createdAt = 1700000000 + rng.intN(31536000);
      recs.add(Rec(i, 'user_$i', countries[c], age, score, createdAt));
      h = fold(fold(fold(fold(h, c), age), score), createdAt);
    }
    return (recs, h, n);
  }

  @override
  Out run(Object work) {
    const cutoff = 1700000000 + 15768000;
    final groups = <String, Agg>{};
    for (final r in work as List<Rec>) {
      if (r.age < 18 || r.score < 100 || r.createdAt < cutoff) continue;
      final g = groups.putIfAbsent(r.country, () => Agg(r.country));
      g.count++;
      g.sum += r.score;
      if (r.score > g.max) g.max = r.score;
      g.ageSum += r.age;
    }
    final sorted = groups.values.toList()..sort((a, b) => a.sum != b.sum ? b.sum.compareTo(a.sum) : a.country.compareTo(b.country));
    return Out(sorted);
  }

  @override
  int check(Out out) {
    var h = 0;
    for (final g in out.value as List<Agg>) {
      h = fold(h, fnv1a(g.country));
      h = fold(h, g.count);
      h = fold(h, g.sum & M);
      h = fold(h, g.max);
      h = fold(h, g.ageSum & M);
    }
    return h;
  }
}

class SearchChallenge extends Challenge {
  @override
  (Object, int, int) gen(int n, Rng rng) {
    final keys = List<int>.generate(n, (_) => rng.next() & 0x7FFFFFFF);
    final queries = List<int>.generate(n, (i) => i.isEven ? keys[rng.intN(n)] : rng.next() & 0x7FFFFFFF);
    return ((keys, queries), foldAll([...keys, ...queries]), 2 * n);
  }

  @override
  Out run(Object work) {
    final (keys, queries) = work as (List<int>, List<int>);
    final phases = <int>[];
    var t = nowNs();
    void lap() {
      final now = nowNs();
      phases.add(now - t);
      t = now;
    }

    final index = <int, int>{};
    for (var i = 0; i < keys.length; i++) {
      index[keys[i]] = i;
    }
    lap();
    var hits = 0, sum = 0;
    for (final q in queries) {
      final v = index[q];
      if (v != null) {
        hits++;
        sum += v;
      }
    }
    lap();
    final sorted = List<int>.of(keys)..sort();
    lap();
    var binHits = 0;
    for (final q in queries) {
      var lo = 0, hi = sorted.length;
      while (lo < hi) {
        final mid = (lo + hi) >> 1;
        if (sorted[mid] < q) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }
      if (lo < sorted.length && sorted[lo] == q) binHits++;
    }
    lap();
    return Out([hits, sum & M, binHits], phases);
  }

  @override
  int check(Out out) => foldAll(out.value as List<int>);
}

const regions = ['NA', 'EMEA', 'APAC', 'LATAM', 'ANZ', 'MEA', 'NORDICS', 'DACH'];
String pad2(int v) => v.toString().padLeft(2, '0');

class CsvGroup {
  final String region;
  final int month;
  int orders = 0, units = 0, revenue = 0;
  CsvGroup(this.region, this.month);
}

class CsvChallenge extends Challenge {
  @override
  (Object, int, int) gen(int n, Rng rng) {
    final lines = <String>['order_id,date,region,sku,qty,unit_price_cents,discount_pct'];
    for (var i = 0; i < n; i++) {
      final month = 1 + rng.intN(12);
      final day = 1 + rng.intN(28);
      final region = regions[rng.intN(8)];
      final sku = rng.intN(1000);
      final qty = 1 + rng.intN(20);
      final price = 99 + rng.intN(99901);
      final discount = 5 * rng.intN(5);
      lines.add('$i,2026-${pad2(month)}-${pad2(day)},$region,SKU-$sku,$qty,$price,$discount');
    }
    final text = lines.join('\n');
    return (text, fnv1a(text), n);
  }

  @override
  Out run(Object work) {
    final lines = (work as String).split('\n');
    final groups = <(String, int), CsvGroup>{};
    for (var i = 1; i < lines.length; i++) {
      final f = lines[i].split(',');
      final month = int.parse(f[1].substring(5, 7));
      final qty = int.parse(f[4]);
      final revenue = qty * int.parse(f[5]) * (100 - int.parse(f[6])) ~/ 100;
      final g = groups.putIfAbsent((f[2], month), () => CsvGroup(f[2], month));
      g.orders++;
      g.units += qty;
      g.revenue += revenue;
    }
    final rows = groups.values.toList()..sort((a, b) => a.region != b.region ? a.region.compareTo(b.region) : a.month - b.month);
    final out = ['region,month,orders,units,revenue_cents'];
    for (final g in rows) {
      out.add('${g.region},2026-${pad2(g.month)},${g.orders},${g.units},${g.revenue}');
    }
    return Out(out.join('\n'));
  }

  @override
  int check(Out out) => fnv1a(out.value as String);
}

class MetricsChallenge extends Challenge {
  @override
  (Object, int, int) gen(int n, Rng rng) {
    final values = Int32List(n);
    for (var i = 0; i < n; i++) {
      var v = 20 + rng.intN(80);
      if (rng.intN(100) < 3) v += 200 + rng.intN(800);
      values[i] = v;
    }
    return (values, foldAll(values), n);
  }

  @override
  Out run(Object work) {
    final values = work as Int32List;
    final n = values.length;
    var window = 0, slow = 0, peak = 0, total = 0;
    for (var i = 0; i < n; i++) {
      window += values[i];
      total += values[i];
      if (i >= 60) window -= values[i - 60];
      if (i >= 59) {
        if (window > 7200) slow++;
        if (window > peak) peak = window;
      }
    }
    var buckets = 0;
    for (var start = 0; start < n; start += 60) {
      var max = 0;
      for (var i = start; i < start + 60 && i < n; i++) {
        if (values[i] > max) max = values[i];
      }
      buckets = fold(buckets, max);
    }
    final sorted = Int32List.fromList(values)..sort();
    int rank(int p) => sorted[(p * n + 99) ~/ 100 - 1];
    final meanMilli = total * 1000 ~/ n;
    return Out([slow, peak, buckets, rank(50), rank(95), rank(99), sorted[n - 1], meanMilli & M]);
  }

  @override
  int check(Out out) => foldAll(out.value as List<int>);
}

const nnIn = 64, nnH = 64, nnOut = 10;

class Mlp {
  final Int32List w1, b1, w2, b2, w3, b3, x;
  final int n;
  Mlp(this.w1, this.b1, this.w2, this.b2, this.w3, this.b3, this.x, this.n);
}

class InferChallenge extends Challenge {
  @override
  (Object, int, int) gen(int n, Rng rng) {
    var h = 0;
    Int32List draw(int count, int k, int offset) {
      final out = Int32List(count);
      for (var i = 0; i < count; i++) {
        final raw = rng.intN(k);
        h = fold(h, raw);
        out[i] = raw - offset;
      }
      return out;
    }

    final w1 = draw(nnH * nnIn, 255, 127), b1 = draw(nnH, 2001, 1000);
    final w2 = draw(nnH * nnH, 255, 127), b2 = draw(nnH, 2001, 1000);
    final w3 = draw(nnOut * nnH, 255, 127), b3 = draw(nnOut, 2001, 1000);
    final x = draw(n * nnIn, 256, 128);
    return (Mlp(w1, b1, w2, b2, w3, b3, x, n), h, n);
  }

  @override
  Out run(Object work) {
    final m = work as Mlp;
    final h1 = Int32List(nnH), h2 = Int32List(nnH), logits = Int32List(nnOut);
    void dense(Int32List w, Int32List b, Int32List input, int inOff, int inLen, Int32List out) {
      for (var j = 0; j < out.length; j++) {
        var a = b[j];
        final row = j * inLen;
        for (var k = 0; k < inLen; k++) {
          a += w[row + k] * input[inOff + k];
        }
        out[j] = a;
      }
    }

    var preds = 0, conf = 0;
    for (var s = 0; s < m.n; s++) {
      dense(m.w1, m.b1, m.x, s * nnIn, nnIn, h1);
      for (var j = 0; j < nnH; j++) {
        h1[j] = min(127, max(0, h1[j]) ~/ 1024);
      }
      dense(m.w2, m.b2, h1, 0, nnH, h2);
      for (var j = 0; j < nnH; j++) {
        h2[j] = min(127, max(0, h2[j]) ~/ 1024);
      }
      dense(m.w3, m.b3, h2, 0, nnH, logits);
      var pred = 0;
      for (var o = 1; o < nnOut; o++) {
        if (logits[o] > logits[pred]) pred = o;
      }
      preds = fold(preds, pred);
      conf = (conf + logits[pred] + 4194304) & M;
    }
    return Out([preds, conf]);
  }

  @override
  int check(Out out) => foldAll(out.value as List<int>);
}

const embD = 64, embQ = 8, embK = 10;

class EmbedChallenge extends Challenge {
  @override
  (Object, int, int) gen(int n, Rng rng) {
    var h = 0;
    Int32List draw(int count) {
      final out = Int32List(count);
      for (var i = 0; i < count; i++) {
        final raw = rng.intN(256);
        h = fold(h, raw);
        out[i] = raw - 128;
      }
      return out;
    }

    final docs = draw(n * embD);
    final queries = draw(embQ * embD);
    return ((docs, queries, n), h, n * embQ);
  }

  @override
  Out run(Object work) {
    final (docs, queries, n) = work as (Int32List, Int32List, int);
    final results = <int>[];
    final scores = Int32List(n);
    for (var q = 0; q < embQ; q++) {
      final qo = q * embD;
      for (var d = 0; d < n; d++) {
        final dOff = d * embD;
        var s = 0;
        for (var k = 0; k < embD; k++) {
          s += docs[dOff + k] * queries[qo + k];
        }
        scores[d] = s;
      }
      final order = List<int>.generate(n, (i) => i)..sort((a, b) => scores[a] != scores[b] ? scores[b] - scores[a] : a - b);
      for (var r = 0; r < embK; r++) {
        results.add(order[r]);
        results.add(scores[order[r]] + 2097152);
      }
    }
    return Out(results);
  }

  @override
  int check(Out out) => foldAll(out.value as List<int>);
}

class PixelChallenge extends Challenge {
  @override
  (Object, int, int) gen(int n, Rng rng) {
    final rgb = Uint8List(n * n * 3);
    var h = 0;
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        final p = (y * n + x) * 3;
        rgb[p] = (x + y + rng.intN(64)) % 256;
        rgb[p + 1] = (2 * x + rng.intN(64)) % 256;
        rgb[p + 2] = (2 * y + rng.intN(64)) % 256;
        h = fold(fold(fold(h, rgb[p]), rgb[p + 1]), rgb[p + 2]);
      }
    }
    return ((rgb, n), h, n * n);
  }

  @override
  Out run(Object work) {
    final (rgb, n) = work as (Uint8List, int);
    final phases = <int>[];
    var t = nowNs();
    void lap() {
      final now = nowNs();
      phases.add(now - t);
      t = now;
    }

    int cl(int v) => v < 0 ? 0 : (v >= n ? n - 1 : v);

    final gray = Uint8List(n * n);
    for (var i = 0; i < n * n; i++) {
      gray[i] = (77 * rgb[i * 3] + 150 * rgb[i * 3 + 1] + 29 * rgb[i * 3 + 2]) >> 8;
    }
    lap();

    final blur = Uint8List(n * n);
    for (var y = 0; y < n; y++) {
      final ru = cl(y - 1) * n, r0 = y * n, rd = cl(y + 1) * n;
      for (var x = 0; x < n; x++) {
        final xl = cl(x - 1), xr = cl(x + 1);
        final s = gray[ru + xl] + 2 * gray[ru + x] + gray[ru + xr] + 2 * gray[r0 + xl] + 4 * gray[r0 + x] + 2 * gray[r0 + xr] + gray[rd + xl] + 2 * gray[rd + x] + gray[rd + xr];
        blur[r0 + x] = s >> 4;
      }
    }
    lap();

    final mag = Uint8List(n * n);
    for (var y = 0; y < n; y++) {
      final ru = cl(y - 1) * n, r0 = y * n, rd = cl(y + 1) * n;
      for (var x = 0; x < n; x++) {
        final xl = cl(x - 1), xr = cl(x + 1);
        final gx = blur[ru + xr] + 2 * blur[r0 + xr] + blur[rd + xr] - (blur[ru + xl] + 2 * blur[r0 + xl] + blur[rd + xl]);
        final gy = blur[rd + xl] + 2 * blur[rd + x] + blur[rd + xr] - (blur[ru + xl] + 2 * blur[ru + x] + blur[ru + xr]);
        mag[r0 + x] = min(255, gx.abs() + gy.abs());
      }
    }
    lap();

    final hist = List<int>.filled(256, 0);
    var edges = 0;
    for (final m in mag) {
      hist[m]++;
      if (m >= 128) edges++;
    }
    lap();

    return Out([...hist, edges], phases);
  }

  @override
  int check(Out out) => foldAll(out.value as List<int>);
}

void main(List<String> args) {
  emit({'e': 'hello', 'lang': 'dart'});
  try {
    final Challenge c = switch (args[0]) {
      'sort' => SortChallenge(),
      'json' => JsonChallenge(),
      'strings' => StringsChallenge(),
      'sieve' => SieveChallenge(),
      'records' => RecordsChallenge(),
      'search' => SearchChallenge(),
      'csv' => CsvChallenge(),
      'metrics' => MetricsChallenge(),
      'infer' => InferChallenge(),
      'embed' => EmbedChallenge(),
      'pixel' => PixelChallenge(),
      _ => throw ArgumentError('unknown challenge: ${args[0]}'),
    };
    final size = int.parse(args[1]), seed = int.parse(args[2]), warmup = int.parse(args[3]), runs = int.parse(args[4]);
    final g0 = nowNs();
    final (input, hash, ops) = c.gen(size, Rng(seed));
    emit({'e': 'ready', 'genNs': nowNs() - g0, 'input': hex8(hash), 'ops': ops});
    for (var i = 0; i < warmup + runs; i++) {
      final work = c.prepare(input);
      final t0 = nowNs();
      final out = c.run(work);
      final ns = nowNs() - t0;
      final warm = i < warmup;
      emit({'e': warm ? 'warmup' : 'run', 'i': warm ? i : i - warmup, 'ns': ns, 'check': hex8(c.check(out)), if (out.phases != null) 'phases': out.phases});
    }
    emit({'e': 'done'});
  } catch (e) {
    emit({'e': 'error', 'msg': e.toString()});
    exit(1);
  }
}
