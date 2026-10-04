//> using scala 3.9.0
//> using dep com.lihaoyi::ujson:4.4.3

import scala.collection.mutable

object Harness:
  private val M = 0xFFFFFFFFL
  private val Countries = Array("US", "GB", "DE", "FR", "JP", "BR", "IN", "CN", "CA", "AU", "NO", "SE", "ZA", "NG", "MX", "ES", "IT", "KR", "NL", "PL")
  private val Levels = Array("INFO", "WARN", "ERROR", "DEBUG")
  private val Resources = Array("users", "orders", "items", "auth", "search")
  private val Statuses = Array(200, 200, 200, 201, 404, 500)

  private def emit(line: String): Unit =
    println(line)
    System.out.flush()

  final class Rng(seed: Long):
    private var s: Int = if seed.toInt == 0 then 0x9e3779b9 else seed.toInt
    def next(): Long =
      var x = s
      x ^= x << 13
      x ^= x >>> 17
      x ^= x << 5
      s = x
      x.toLong & M
    def int(n: Int): Int = (next() % n).toInt

  private def fold(h: Int, v: Long): Int = h * 31 + v.toInt
  private def fnv1a(s: String): Int =
    var h = 0x811c9dc5
    var i = 0
    while i < s.length do
      h = (h ^ s.charAt(i)) * 0x01000193
      i += 1
    h
  private def foldAll(values: Iterable[Long]): Int = values.foldLeft(0)(fold)
  private def hex8(h: Int) = f"$h%08x"

  final case class Out(value: Any, phases: Option[Array[Long]] = None)

  trait Challenge:
    def gen(n: Int, rng: Rng): (Any, Int, Long)
    def prepare(input: Any): Any = input
    def run(work: Any): Out
    def check(out: Out): Int

  object SortC extends Challenge:
    def gen(n: Int, rng: Rng) =
      val data = Array.fill(n)((rng.next() & 0x7fffffff).toInt)
      (data, data.foldLeft(0)((h, v) => fold(h, v.toLong)), n.toLong)
    override def prepare(input: Any) = input.asInstanceOf[Array[Int]].clone()
    def run(work: Any) =
      val a = work.asInstanceOf[Array[Int]]
      a.sortInPlace()
      Out(a)
    def check(out: Out) = out.value.asInstanceOf[Array[Int]].foldLeft(0)((h, v) => fold(h, v.toLong))

  object JsonC extends Challenge:
    def gen(n: Int, rng: Rng) =
      val sb = new StringBuilder(n * 110)
      sb.append('[')
      for i <- 0 until n do
        val country = Countries(rng.int(20))
        val age = 10 + rng.int(80)
        val score = rng.int(1000)
        val active = (rng.next() & 1L) == 1L
        val t1 = rng.int(10)
        val t2 = rng.int(10)
        if i > 0 then sb.append(',')
        sb.append(s"""{"id":$i,"name":"user_$i","country":"$country","age":$age,"score":$score,"active":$active,"tags":["t$t1","t$t2"]}""")
      sb.append(']')
      val text = sb.toString
      (text, fnv1a(text), n.toLong)
    def run(work: Any) =
      val records = ujson.read(work.asInstanceOf[String]).arr
      val out = records.iterator
        .filter(r => r("active").bool && r("score").num >= 500)
        .map(r => ujson.Obj("country" -> r("country"), "id" -> r("id"), "name" -> r("name").str.toUpperCase, "score2" -> r("score").num.toInt * 2, "tagCount" -> r("tags").arr.length))
        .toSeq
      Out(ujson.write(ujson.Arr.from(out)))
    def check(out: Out) = fnv1a(out.value.asInstanceOf[String])

  object StringsC extends Challenge:
    def gen(n: Int, rng: Rng) =
      val sb = new StringBuilder(n * 90)
      for i <- 0 until n do
        val level = Levels(rng.int(4))
        val user = rng.int(1000)
        val res = Resources(rng.int(5))
        val id = rng.int(10000)
        val status = Statuses(rng.int(6))
        val latency = rng.int(2000)
        if i > 0 then sb.append('\n')
        sb.append(s"ts=${1700000000 + i} level=$level user=u$user path=/api/$res/$id status=$status latency=${latency}ms")
      val text = sb.toString
      (text, fnv1a(text), n.toLong)
    def run(work: Any) =
      val pattern = """status=(\d{3}) latency=(\d+)ms""".r
      var lines, s5xx, errors, latency, tokens = 0L
      for line <- work.asInstanceOf[String].split('\n') do
        lines += 1
        pattern.findFirstMatchIn(line).foreach { m =>
          if m.group(1).toInt >= 500 then s5xx += 1
          latency += m.group(2).toLong
        }
        if line.contains("level=ERROR") then errors += 1
        tokens += line.split(' ').length
      Out(Array(lines, s5xx, errors, latency & M, tokens))
    def check(out: Out) = foldAll(out.value.asInstanceOf[Array[Long]])

  object SieveC extends Challenge:
    def gen(n: Int, rng: Rng) = (n, n, n.toLong)
    def run(work: Any) =
      val n = work.asInstanceOf[Int]
      val composite = new Array[Boolean](n + 1)
      var i = 2L
      while i * i <= n do
        if !composite(i.toInt) then
          var j = i * i
          while j <= n do
            composite(j.toInt) = true
            j += i
        i += 1
      var count, sum = 0L
      var k = 2
      while k <= n do
        if !composite(k) then
          count += 1
          sum += k
        k += 1
      Out(Array(count, sum & M))
    def check(out: Out) = foldAll(out.value.asInstanceOf[Array[Long]])

  final case class Rec(id: Int, name: String, country: String, age: Int, score: Int, createdAt: Int)
  final class Agg(val country: String):
    var count, sum, max, ageSum = 0L

  object RecordsC extends Challenge:
    def gen(n: Int, rng: Rng) =
      var h = 0
      val recs = Vector.newBuilder[Rec]
      for i <- 0 until n do
        val c = rng.int(20)
        val age = 10 + rng.int(80)
        val score = rng.int(1000)
        val createdAt = 1700000000 + rng.int(31536000)
        recs += Rec(i, s"user_$i", Countries(c), age, score, createdAt)
        h = fold(fold(fold(fold(h, c), age), score), createdAt)
      (recs.result(), h, n.toLong)
    def run(work: Any) =
      val cutoff = 1700000000 + 15768000
      val groups = mutable.HashMap.empty[String, Agg]
      for r <- work.asInstanceOf[Vector[Rec]] if r.age >= 18 && r.score >= 100 && r.createdAt >= cutoff do
        val g = groups.getOrElseUpdate(r.country, Agg(r.country))
        g.count += 1
        g.sum += r.score
        if r.score > g.max then g.max = r.score
        g.ageSum += r.age
      Out(groups.values.toVector.sortBy(g => (-g.sum, g.country)))
    def check(out: Out) =
      out.value.asInstanceOf[Vector[Agg]].foldLeft(0) { (acc, g) =>
        val a = fold(fold(acc, fnv1a(g.country).toLong & M), g.count)
        fold(fold(fold(a, g.sum & M), g.max), g.ageSum & M)
      }

  object SearchC extends Challenge:
    def gen(n: Int, rng: Rng) =
      val keys = Array.fill(n)((rng.next() & 0x7fffffff).toInt)
      val queries = Array.tabulate(n)(i => if (i & 1) == 0 then keys(rng.int(n)) else (rng.next() & 0x7fffffff).toInt)
      val h = queries.foldLeft(keys.foldLeft(0)((h, v) => fold(h, v.toLong)))((h, v) => fold(h, v.toLong))
      ((keys, queries), h, 2L * n)
    def run(work: Any) =
      val (keys, queries) = work.asInstanceOf[(Array[Int], Array[Int])]
      val phases = new Array[Long](4)
      var t = System.nanoTime()
      def lap(i: Int): Unit =
        val now = System.nanoTime()
        phases(i) = now - t
        t = now
      val index = mutable.HashMap.empty[Int, Int]
      var i = 0
      while i < keys.length do
        index(keys(i)) = i
        i += 1
      lap(0)
      var hits, sum = 0L
      for q <- queries do
        index.get(q) match
          case Some(v) =>
            hits += 1
            sum += v
          case None => ()
      lap(1)
      val sorted = keys.clone()
      java.util.Arrays.sort(sorted)
      lap(2)
      val binHits = queries.count(q => java.util.Arrays.binarySearch(sorted, q) >= 0).toLong
      lap(3)
      Out(Array(hits, sum & M, binHits), Some(phases))
    def check(out: Out) = foldAll(out.value.asInstanceOf[Array[Long]])

  private val Regions = Array("NA", "EMEA", "APAC", "LATAM", "ANZ", "MEA", "NORDICS", "DACH")

  final class CsvGroup(val region: String, val month: Int):
    var orders, units, revenue = 0L

  object CsvC extends Challenge:
    def gen(n: Int, rng: Rng) =
      val sb = new StringBuilder(n * 48)
      sb.append("order_id,date,region,sku,qty,unit_price_cents,discount_pct")
      for i <- 0 until n do
        val month = 1 + rng.int(12)
        val day = 1 + rng.int(28)
        val region = Regions(rng.int(8))
        val sku = rng.int(1000)
        val qty = 1 + rng.int(20)
        val price = 99 + rng.int(99901)
        val discount = 5 * rng.int(5)
        sb.append(f"\n$i,2026-$month%02d-$day%02d,$region,SKU-$sku,$qty,$price,$discount")
      val text = sb.toString
      (text, fnv1a(text), n.toLong)
    def run(work: Any) =
      val groups = mutable.HashMap.empty[(String, Int), CsvGroup]
      for line <- work.asInstanceOf[String].split('\n').iterator.drop(1) do
        val f = line.split(',')
        val month = f(1).substring(5, 7).toInt
        val qty = f(4).toInt
        val revenue = qty.toLong * f(5).toInt * (100 - f(6).toInt) / 100
        val g = groups.getOrElseUpdate((f(2), month), CsvGroup(f(2), month))
        g.orders += 1
        g.units += qty
        g.revenue += revenue
      val rows = groups.values.toVector.sortBy(g => (g.region, g.month))
      val report = rows.map(g => f"${g.region},2026-${g.month}%02d,${g.orders},${g.units},${g.revenue}").prepended("region,month,orders,units,revenue_cents").mkString("\n")
      Out(report)
    def check(out: Out) = fnv1a(out.value.asInstanceOf[String])

  object MetricsC extends Challenge:
    def gen(n: Int, rng: Rng) =
      val values = Array.fill(n) {
        val v = 20 + rng.int(80)
        if rng.int(100) < 3 then v + 200 + rng.int(800) else v
      }
      (values, values.foldLeft(0)((h, v) => fold(h, v.toLong)), n.toLong)
    def run(work: Any) =
      val values = work.asInstanceOf[Array[Int]]
      val n = values.length
      var window, slow, peak, total = 0L
      var i = 0
      while i < n do
        window += values(i)
        total += values(i)
        if i >= 60 then window -= values(i - 60)
        if i >= 59 then
          if window > 7200 then slow += 1
          if window > peak then peak = window
        i += 1
      var buckets = 0
      var start = 0
      while start < n do
        var max = 0
        var j = start
        while j < math.min(start + 60, n) do
          max = math.max(max, values(j))
          j += 1
        buckets = fold(buckets, max)
        start += 60
      val sorted = values.clone()
      sorted.sortInPlace()
      def rank(p: Int) = sorted((p * n + 99) / 100 - 1).toLong
      val meanMilli = total * 1000 / n
      Out(Array(slow, peak, buckets.toLong & M, rank(50), rank(95), rank(99), sorted(n - 1).toLong, meanMilli & M))
    def check(out: Out) = foldAll(out.value.asInstanceOf[Array[Long]])

  private val NnIn = 64
  private val NnH = 64
  private val NnOut = 10

  final case class Mlp(w1: Array[Int], b1: Array[Int], w2: Array[Int], b2: Array[Int], w3: Array[Int], b3: Array[Int], x: Array[Int], n: Int)

  object InferC extends Challenge:
    def gen(n: Int, rng: Rng) =
      var h = 0
      def draw(count: Int, k: Int, offset: Int) = Array.fill(count) {
        val raw = rng.int(k)
        h = fold(h, raw)
        raw - offset
      }
      val w1 = draw(NnH * NnIn, 255, 127)
      val b1 = draw(NnH, 2001, 1000)
      val w2 = draw(NnH * NnH, 255, 127)
      val b2 = draw(NnH, 2001, 1000)
      val w3 = draw(NnOut * NnH, 255, 127)
      val b3 = draw(NnOut, 2001, 1000)
      val x = draw(n * NnIn, 256, 128)
      (Mlp(w1, b1, w2, b2, w3, b3, x, n), h, n.toLong)
    private def dense(w: Array[Int], b: Array[Int], input: Array[Int], inOff: Int, inLen: Int, out: Array[Int]): Unit =
      var j = 0
      while j < out.length do
        var a = b(j)
        val row = j * inLen
        var k = 0
        while k < inLen do
          a += w(row + k) * input(inOff + k)
          k += 1
        out(j) = a
        j += 1
    def run(work: Any) =
      val m = work.asInstanceOf[Mlp]
      val h1 = new Array[Int](NnH)
      val h2 = new Array[Int](NnH)
      val logits = new Array[Int](NnOut)
      var preds = 0
      var conf = 0L
      var s = 0
      while s < m.n do
        dense(m.w1, m.b1, m.x, s * NnIn, NnIn, h1)
        var j = 0
        while j < NnH do
          h1(j) = math.min(127, math.max(0, h1(j)) / 1024)
          j += 1
        dense(m.w2, m.b2, h1, 0, NnH, h2)
        j = 0
        while j < NnH do
          h2(j) = math.min(127, math.max(0, h2(j)) / 1024)
          j += 1
        dense(m.w3, m.b3, h2, 0, NnH, logits)
        var pred = 0
        var o = 1
        while o < NnOut do
          if logits(o) > logits(pred) then pred = o
          o += 1
        preds = fold(preds, pred)
        conf = (conf + logits(pred) + 4194304) & M
        s += 1
      Out(Array(preds.toLong & M, conf))
    def check(out: Out) = foldAll(out.value.asInstanceOf[Array[Long]])

  private val EmbD = 64
  private val EmbQ = 8
  private val EmbK = 10

  object EmbedC extends Challenge:
    def gen(n: Int, rng: Rng) =
      var h = 0
      def draw(count: Int) = Array.fill(count) {
        val raw = rng.int(256)
        h = fold(h, raw)
        raw - 128
      }
      val docs = draw(n * EmbD)
      val queries = draw(EmbQ * EmbD)
      ((docs, queries), h, n.toLong * EmbQ)
    def run(work: Any) =
      val (docs, queries) = work.asInstanceOf[(Array[Int], Array[Int])]
      val n = docs.length / EmbD
      val results = mutable.ArrayBuffer.empty[Long]
      val scores = new Array[Int](n)
      for q <- 0 until EmbQ do
        val qo = q * EmbD
        var d = 0
        while d < n do
          val dOff = d * EmbD
          var s = 0
          var k = 0
          while k < EmbD do
            s += docs(dOff + k) * queries(qo + k)
            k += 1
          scores(d) = s
          d += 1
        val order = Array.range(0, n).sortBy(i => (-scores(i), i))
        for r <- 0 until EmbK do
          results += order(r).toLong
          results += scores(order(r)) + 2097152L
      Out(results.toArray)
    def check(out: Out) = foldAll(out.value.asInstanceOf[Array[Long]])

  object PixelC extends Challenge:
    def gen(n: Int, rng: Rng) =
      val rgb = new Array[Int](n * n * 3)
      var h = 0
      for y <- 0 until n; x <- 0 until n do
        val p = (y * n + x) * 3
        rgb(p) = (x + y + rng.int(64)) % 256
        rgb(p + 1) = (2 * x + rng.int(64)) % 256
        rgb(p + 2) = (2 * y + rng.int(64)) % 256
        h = fold(fold(fold(h, rgb(p)), rgb(p + 1)), rgb(p + 2))
      ((rgb, n), h, n.toLong * n)
    def run(work: Any) =
      val (rgb, n) = work.asInstanceOf[(Array[Int], Int)]
      val phases = new Array[Long](4)
      var t = System.nanoTime()
      def lap(i: Int): Unit =
        val now = System.nanoTime()
        phases(i) = now - t
        t = now
      def cl(v: Int) = if v < 0 then 0 else if v >= n then n - 1 else v

      val gray = Array.tabulate(n * n)(i => (77 * rgb(i * 3) + 150 * rgb(i * 3 + 1) + 29 * rgb(i * 3 + 2)) / 256)
      lap(0)

      val blur = new Array[Int](n * n)
      var y = 0
      while y < n do
        val ru = cl(y - 1) * n
        val r0 = y * n
        val rd = cl(y + 1) * n
        var x = 0
        while x < n do
          val xl = cl(x - 1)
          val xr = cl(x + 1)
          val s = gray(ru + xl) + 2 * gray(ru + x) + gray(ru + xr) + 2 * gray(r0 + xl) + 4 * gray(r0 + x) + 2 * gray(r0 + xr) + gray(rd + xl) + 2 * gray(rd + x) + gray(rd + xr)
          blur(r0 + x) = s / 16
          x += 1
        y += 1
      lap(1)

      val mag = new Array[Int](n * n)
      y = 0
      while y < n do
        val ru = cl(y - 1) * n
        val r0 = y * n
        val rd = cl(y + 1) * n
        var x = 0
        while x < n do
          val xl = cl(x - 1)
          val xr = cl(x + 1)
          val gx = blur(ru + xr) + 2 * blur(r0 + xr) + blur(rd + xr) - (blur(ru + xl) + 2 * blur(r0 + xl) + blur(rd + xl))
          val gy = blur(rd + xl) + 2 * blur(rd + x) + blur(rd + xr) - (blur(ru + xl) + 2 * blur(ru + x) + blur(ru + xr))
          mag(r0 + x) = math.min(255, math.abs(gx) + math.abs(gy))
          x += 1
        y += 1
      lap(2)

      val result = new Array[Long](257)
      for m <- mag do
        result(m) += 1
        if m >= 128 then result(256) += 1
      lap(3)

      Out(result, Some(phases))
    def check(out: Out) = foldAll(out.value.asInstanceOf[Array[Long]])

  def main(args: Array[String]): Unit =
    emit("""{"e":"hello","lang":"scala"}""")
    try
      val c: Challenge = args(0) match
        case "sort"    => SortC
        case "json"    => JsonC
        case "strings" => StringsC
        case "sieve"   => SieveC
        case "records" => RecordsC
        case "search"  => SearchC
        case "csv"     => CsvC
        case "metrics" => MetricsC
        case "infer"   => InferC
        case "embed"   => EmbedC
        case "pixel"   => PixelC
        case other     => throw IllegalArgumentException(s"unknown challenge: $other")
      val size = args(1).toInt
      val rng = Rng(args(2).toLong)
      val warmup = args(3).toInt
      val runs = args(4).toInt
      val g0 = System.nanoTime()
      val (input, hash, ops) = c.gen(size, rng)
      emit(s"""{"e":"ready","genNs":${System.nanoTime() - g0},"input":"${hex8(hash)}","ops":$ops}""")
      for i <- 0 until warmup + runs do
        val work = c.prepare(input)
        val t0 = System.nanoTime()
        val out = c.run(work)
        val ns = System.nanoTime() - t0
        val warm = i < warmup
        val phases = out.phases.map(p => s""","phases":[${p.mkString(",")}]""").getOrElse("")
        emit(s"""{"e":"${if warm then "warmup" else "run"}","i":${if warm then i else i - warmup},"ns":$ns,"check":"${hex8(c.check(out))}"$phases}""")
      emit("""{"e":"done"}""")
    catch
      case e: Exception =>
        emit(s"""{"e":"error","msg":${ujson.write(ujson.Str(String.valueOf(e.getMessage)))}}""")
        sys.exit(1)
