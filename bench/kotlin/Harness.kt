import com.fasterxml.jackson.annotation.JsonPropertyOrder
import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.databind.ObjectMapper

private const val M = 0xFFFFFFFFL
private val COUNTRIES = arrayOf("US", "GB", "DE", "FR", "JP", "BR", "IN", "CN", "CA", "AU", "NO", "SE", "ZA", "NG", "MX", "ES", "IT", "KR", "NL", "PL")
private val LEVELS = arrayOf("INFO", "WARN", "ERROR", "DEBUG")
private val RESOURCES = arrayOf("users", "orders", "items", "auth", "search")
private val STATUSES = intArrayOf(200, 200, 200, 201, 404, 500)
private val MAPPER = ObjectMapper().configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)

private fun emit(line: String) {
    println(line)
    System.out.flush()
}

private class Rng(seed: Long) {
    private var s: Int = seed.toInt().let { if (it == 0) 0x9e3779b9.toInt() else it }
    fun next(): Long {
        var x = s
        x = x xor (x shl 13)
        x = x xor (x ushr 17)
        x = x xor (x shl 5)
        s = x
        return x.toLong() and M
    }
    fun int(n: Int): Int = (next() % n).toInt()
}

private fun fold(h: Int, v: Long): Int = h * 31 + v.toInt()
private fun fnv1a(s: String): Int {
    var h = 0x811c9dc5.toInt()
    for (c in s) h = (h xor c.code) * 0x01000193
    return h
}
private fun foldAll(values: LongArray): Int = values.fold(0) { h, v -> fold(h, v) }
private fun hex8(h: Int) = "%08x".format(h)

private class Out(val value: Any, val phases: LongArray? = null)

private interface Challenge {
    fun gen(n: Int, rng: Rng): Triple<Any, Int, Long>
    fun prepare(input: Any): Any = input
    fun run(work: Any): Out
    fun check(out: Out): Int
}

private object SortChallenge : Challenge {
    override fun gen(n: Int, rng: Rng): Triple<Any, Int, Long> {
        val data = IntArray(n) { (rng.next() and 0x7fffffff).toInt() }
        return Triple(data, data.fold(0) { h, v -> fold(h, v.toLong()) }, n.toLong())
    }
    override fun prepare(input: Any): Any = (input as IntArray).copyOf()
    override fun run(work: Any): Out = Out((work as IntArray).also { it.sort() })
    override fun check(out: Out): Int = (out.value as IntArray).fold(0) { h, v -> fold(h, v.toLong()) }
}

class JsonRecord {
    var id: Int = 0
    var name: String = ""
    var country: String = ""
    var age: Int = 0
    var score: Int = 0
    var active: Boolean = false
    var tags: List<String> = emptyList()
}

@JsonPropertyOrder("country", "id", "name", "score2", "tagCount")
class JsonOut(val country: String, val id: Int, val name: String, val score2: Int, val tagCount: Int)

private object JsonChallenge : Challenge {
    private val listOfRecords = object : TypeReference<List<JsonRecord>>() {}
    override fun gen(n: Int, rng: Rng): Triple<Any, Int, Long> {
        val text = buildString(n * 110) {
            append('[')
            for (i in 0 until n) {
                val country = COUNTRIES[rng.int(20)]
                val age = 10 + rng.int(80)
                val score = rng.int(1000)
                val active = (rng.next() and 1L) == 1L
                val t1 = rng.int(10)
                val t2 = rng.int(10)
                if (i > 0) append(',')
                append("""{"id":$i,"name":"user_$i","country":"$country","age":$age,"score":$score,"active":$active,"tags":["t$t1","t$t2"]}""")
            }
            append(']')
        }
        return Triple(text, fnv1a(text), n.toLong())
    }
    override fun run(work: Any): Out {
        val records: List<JsonRecord> = MAPPER.readValue(work as String, listOfRecords)
        val out = records.filter { it.active && it.score >= 500 }.map { JsonOut(it.country, it.id, it.name.uppercase(), it.score * 2, it.tags.size) }
        return Out(MAPPER.writeValueAsString(out))
    }
    override fun check(out: Out): Int = fnv1a(out.value as String)
}

private object StringsChallenge : Challenge {
    override fun gen(n: Int, rng: Rng): Triple<Any, Int, Long> {
        val text = buildString(n * 90) {
            for (i in 0 until n) {
                val level = LEVELS[rng.int(4)]
                val user = rng.int(1000)
                val res = RESOURCES[rng.int(5)]
                val id = rng.int(10000)
                val status = STATUSES[rng.int(6)]
                val latency = rng.int(2000)
                if (i > 0) append('\n')
                append("ts=${1700000000 + i} level=$level user=u$user path=/api/$res/$id status=$status latency=${latency}ms")
            }
        }
        return Triple(text, fnv1a(text), n.toLong())
    }
    override fun run(work: Any): Out {
        val pattern = Regex("""status=(\d{3}) latency=(\d+)ms""")
        var lines = 0L
        var s5xx = 0L
        var errors = 0L
        var latency = 0L
        var tokens = 0L
        for (line in (work as String).split('\n')) {
            lines++
            pattern.find(line)?.let { m ->
                if (m.groupValues[1].toInt() >= 500) s5xx++
                latency += m.groupValues[2].toLong()
            }
            if ("level=ERROR" in line) errors++
            tokens += line.split(' ').size
        }
        return Out(longArrayOf(lines, s5xx, errors, latency and M, tokens))
    }
    override fun check(out: Out): Int = foldAll(out.value as LongArray)
}

private object SieveChallenge : Challenge {
    override fun gen(n: Int, rng: Rng): Triple<Any, Int, Long> = Triple(n, n, n.toLong())
    override fun run(work: Any): Out {
        val n = work as Int
        val composite = BooleanArray(n + 1)
        var i = 2L
        while (i * i <= n) {
            if (!composite[i.toInt()]) {
                var j = i * i
                while (j <= n) {
                    composite[j.toInt()] = true
                    j += i
                }
            }
            i++
        }
        var count = 0L
        var sum = 0L
        for (k in 2..n) if (!composite[k]) {
            count++
            sum += k
        }
        return Out(longArrayOf(count, sum and M))
    }
    override fun check(out: Out): Int = foldAll(out.value as LongArray)
}

private class Rec(val id: Int, val name: String, val country: String, val age: Int, val score: Int, val createdAt: Int)
private class Agg(val country: String) {
    var count = 0L
    var sum = 0L
    var max = 0L
    var ageSum = 0L
}

private object RecordsChallenge : Challenge {
    override fun gen(n: Int, rng: Rng): Triple<Any, Int, Long> {
        var h = 0
        val list = ArrayList<Rec>(n)
        for (i in 0 until n) {
            val c = rng.int(20)
            val age = 10 + rng.int(80)
            val score = rng.int(1000)
            val createdAt = 1700000000 + rng.int(31536000)
            list += Rec(i, "user_$i", COUNTRIES[c], age, score, createdAt)
            h = fold(fold(fold(fold(h, c.toLong()), age.toLong()), score.toLong()), createdAt.toLong())
        }
        return Triple(list, h, n.toLong())
    }
    @Suppress("UNCHECKED_CAST")
    override fun run(work: Any): Out {
        val cutoff = 1700000000 + 15768000
        val groups = HashMap<String, Agg>()
        for (r in work as List<Rec>) {
            if (r.age < 18 || r.score < 100 || r.createdAt < cutoff) continue
            val g = groups.getOrPut(r.country) { Agg(r.country) }
            g.count++
            g.sum += r.score
            if (r.score > g.max) g.max = r.score.toLong()
            g.ageSum += r.age
        }
        return Out(groups.values.sortedWith(compareByDescending<Agg> { it.sum }.thenBy { it.country }))
    }
    @Suppress("UNCHECKED_CAST")
    override fun check(out: Out): Int = (out.value as List<Agg>).fold(0) { acc, g ->
        var h = fold(acc, fnv1a(g.country).toLong() and M)
        h = fold(h, g.count)
        h = fold(h, g.sum and M)
        h = fold(h, g.max)
        fold(h, g.ageSum and M)
    }
}

private object SearchChallenge : Challenge {
    override fun gen(n: Int, rng: Rng): Triple<Any, Int, Long> {
        val keys = IntArray(n) { (rng.next() and 0x7fffffff).toInt() }
        val queries = IntArray(n) { i -> if (i and 1 == 0) keys[rng.int(n)] else (rng.next() and 0x7fffffff).toInt() }
        var h = 0
        for (k in keys) h = fold(h, k.toLong())
        for (q in queries) h = fold(h, q.toLong())
        return Triple(Pair(keys, queries), h, 2L * n)
    }
    @Suppress("UNCHECKED_CAST")
    override fun run(work: Any): Out {
        val (keys, queries) = work as Pair<IntArray, IntArray>
        val phases = LongArray(4)
        var t = System.nanoTime()
        fun lap(i: Int) {
            val now = System.nanoTime()
            phases[i] = now - t
            t = now
        }
        val index = HashMap<Int, Int>()
        for (i in keys.indices) index[keys[i]] = i
        lap(0)
        var hits = 0L
        var sum = 0L
        for (q in queries) index[q]?.let {
            hits++
            sum += it
        }
        lap(1)
        val sorted = keys.copyOf().also { it.sort() }
        lap(2)
        val binHits = queries.count { sorted.binarySearch(it) >= 0 }.toLong()
        lap(3)
        return Out(longArrayOf(hits, sum and M, binHits), phases)
    }
    override fun check(out: Out): Int = foldAll(out.value as LongArray)
}

private val REGIONS = arrayOf("NA", "EMEA", "APAC", "LATAM", "ANZ", "MEA", "NORDICS", "DACH")
private fun pad2(v: Int) = v.toString().padStart(2, '0')

private class CsvGroup(val region: String, val month: Int) {
    var orders = 0L
    var units = 0L
    var revenue = 0L
}

private object CsvChallenge : Challenge {
    override fun gen(n: Int, rng: Rng): Triple<Any, Int, Long> {
        val text = buildString(n * 48) {
            append("order_id,date,region,sku,qty,unit_price_cents,discount_pct")
            for (i in 0 until n) {
                val month = 1 + rng.int(12)
                val day = 1 + rng.int(28)
                val region = REGIONS[rng.int(8)]
                val sku = rng.int(1000)
                val qty = 1 + rng.int(20)
                val price = 99 + rng.int(99901)
                val discount = 5 * rng.int(5)
                append("\n$i,2026-${pad2(month)}-${pad2(day)},$region,SKU-$sku,$qty,$price,$discount")
            }
        }
        return Triple(text, fnv1a(text), n.toLong())
    }
    override fun run(work: Any): Out {
        val lines = (work as String).split('\n')
        val groups = HashMap<Pair<String, Int>, CsvGroup>()
        for (line in lines.drop(1)) {
            val f = line.split(',')
            val month = f[1].substring(5, 7).toInt()
            val qty = f[4].toInt()
            val revenue = qty.toLong() * f[5].toInt() * (100 - f[6].toInt()) / 100
            val g = groups.getOrPut(Pair(f[2], month)) { CsvGroup(f[2], month) }
            g.orders++
            g.units += qty
            g.revenue += revenue
        }
        val rows = groups.values.sortedWith(compareBy<CsvGroup> { it.region }.thenBy { it.month })
        val report = buildString {
            append("region,month,orders,units,revenue_cents")
            for (g in rows) append("\n${g.region},2026-${pad2(g.month)},${g.orders},${g.units},${g.revenue}")
        }
        return Out(report)
    }
    override fun check(out: Out): Int = fnv1a(out.value as String)
}

private object MetricsChallenge : Challenge {
    override fun gen(n: Int, rng: Rng): Triple<Any, Int, Long> {
        val values = IntArray(n) {
            var v = 20 + rng.int(80)
            if (rng.int(100) < 3) v += 200 + rng.int(800)
            v
        }
        return Triple(values, values.fold(0) { h, v -> fold(h, v.toLong()) }, n.toLong())
    }
    override fun run(work: Any): Out {
        val values = work as IntArray
        val n = values.size
        var window = 0L
        var slow = 0L
        var peak = 0L
        var total = 0L
        for (i in 0 until n) {
            window += values[i]
            total += values[i]
            if (i >= 60) window -= values[i - 60]
            if (i >= 59) {
                if (window > 7200) slow++
                if (window > peak) peak = window
            }
        }
        var buckets = 0
        for (start in 0 until n step 60) {
            var max = 0
            for (i in start until minOf(start + 60, n)) max = maxOf(max, values[i])
            buckets = fold(buckets, max.toLong())
        }
        val sorted = values.copyOf().also { it.sort() }
        fun rank(p: Int) = sorted[(p * n + 99) / 100 - 1].toLong()
        val meanMilli = total * 1000 / n
        return Out(longArrayOf(slow, peak, buckets.toLong() and M, rank(50), rank(95), rank(99), sorted[n - 1].toLong(), meanMilli and M))
    }
    override fun check(out: Out): Int = foldAll(out.value as LongArray)
}

private const val NN_IN = 64
private const val NN_H = 64
private const val NN_OUT = 10

private class Mlp(val w1: IntArray, val b1: IntArray, val w2: IntArray, val b2: IntArray, val w3: IntArray, val b3: IntArray, val x: IntArray, val n: Int)

private object InferChallenge : Challenge {
    override fun gen(n: Int, rng: Rng): Triple<Any, Int, Long> {
        var h = 0
        fun draw(count: Int, k: Int, offset: Int) = IntArray(count) {
            val raw = rng.int(k)
            h = fold(h, raw.toLong())
            raw - offset
        }
        val w1 = draw(NN_H * NN_IN, 255, 127)
        val b1 = draw(NN_H, 2001, 1000)
        val w2 = draw(NN_H * NN_H, 255, 127)
        val b2 = draw(NN_H, 2001, 1000)
        val w3 = draw(NN_OUT * NN_H, 255, 127)
        val b3 = draw(NN_OUT, 2001, 1000)
        val x = draw(n * NN_IN, 256, 128)
        return Triple(Mlp(w1, b1, w2, b2, w3, b3, x, n), h, n.toLong())
    }
    private fun dense(w: IntArray, b: IntArray, input: IntArray, inOff: Int, inLen: Int, out: IntArray) {
        for (j in out.indices) {
            var a = b[j]
            val row = j * inLen
            for (k in 0 until inLen) a += w[row + k] * input[inOff + k]
            out[j] = a
        }
    }
    override fun run(work: Any): Out {
        val m = work as Mlp
        val h1 = IntArray(NN_H)
        val h2 = IntArray(NN_H)
        val logits = IntArray(NN_OUT)
        var preds = 0
        var conf = 0L
        for (s in 0 until m.n) {
            dense(m.w1, m.b1, m.x, s * NN_IN, NN_IN, h1)
            for (j in 0 until NN_H) h1[j] = minOf(127, maxOf(0, h1[j]) / 1024)
            dense(m.w2, m.b2, h1, 0, NN_H, h2)
            for (j in 0 until NN_H) h2[j] = minOf(127, maxOf(0, h2[j]) / 1024)
            dense(m.w3, m.b3, h2, 0, NN_H, logits)
            var pred = 0
            for (o in 1 until NN_OUT) if (logits[o] > logits[pred]) pred = o
            preds = fold(preds, pred.toLong())
            conf = (conf + logits[pred] + 4194304) and M
        }
        return Out(longArrayOf(preds.toLong() and M, conf))
    }
    override fun check(out: Out): Int = foldAll(out.value as LongArray)
}

private const val EMB_D = 64
private const val EMB_Q = 8
private const val EMB_K = 10

private object EmbedChallenge : Challenge {
    override fun gen(n: Int, rng: Rng): Triple<Any, Int, Long> {
        var h = 0
        fun draw(count: Int) = IntArray(count) {
            val raw = rng.int(256)
            h = fold(h, raw.toLong())
            raw - 128
        }
        val docs = draw(n * EMB_D)
        val queries = draw(EMB_Q * EMB_D)
        return Triple(Pair(docs, queries), h, n.toLong() * EMB_Q)
    }
    @Suppress("UNCHECKED_CAST")
    override fun run(work: Any): Out {
        val (docs, queries) = work as Pair<IntArray, IntArray>
        val n = docs.size / EMB_D
        val results = ArrayList<Long>(EMB_Q * EMB_K * 2)
        val scores = IntArray(n)
        for (q in 0 until EMB_Q) {
            val qo = q * EMB_D
            for (d in 0 until n) {
                val dOff = d * EMB_D
                var s = 0
                for (k in 0 until EMB_D) s += docs[dOff + k] * queries[qo + k]
                scores[d] = s
            }
            val order = (0 until n).sortedWith(compareByDescending<Int> { scores[it] }.thenBy { it })
            for (r in 0 until EMB_K) {
                results += order[r].toLong()
                results += scores[order[r]] + 2097152L
            }
        }
        return Out(results.toLongArray())
    }
    override fun check(out: Out): Int = foldAll(out.value as LongArray)
}

private class Image(val rgb: IntArray, val n: Int)

private object PixelChallenge : Challenge {
    override fun gen(n: Int, rng: Rng): Triple<Any, Int, Long> {
        val rgb = IntArray(n * n * 3)
        var h = 0
        for (y in 0 until n) {
            for (x in 0 until n) {
                val p = (y * n + x) * 3
                rgb[p] = (x + y + rng.int(64)) % 256
                rgb[p + 1] = (2 * x + rng.int(64)) % 256
                rgb[p + 2] = (2 * y + rng.int(64)) % 256
                h = fold(fold(fold(h, rgb[p].toLong()), rgb[p + 1].toLong()), rgb[p + 2].toLong())
            }
        }
        return Triple(Image(rgb, n), h, n.toLong() * n)
    }
    override fun run(work: Any): Out {
        val img = work as Image
        val rgb = img.rgb
        val n = img.n
        val phases = LongArray(4)
        var t = System.nanoTime()
        fun lap(i: Int) {
            val now = System.nanoTime()
            phases[i] = now - t
            t = now
        }
        fun cl(v: Int) = v.coerceIn(0, n - 1)

        val gray = IntArray(n * n) { i -> (77 * rgb[i * 3] + 150 * rgb[i * 3 + 1] + 29 * rgb[i * 3 + 2]) / 256 }
        lap(0)

        val blur = IntArray(n * n)
        for (y in 0 until n) {
            val ru = cl(y - 1) * n
            val r0 = y * n
            val rd = cl(y + 1) * n
            for (x in 0 until n) {
                val xl = cl(x - 1)
                val xr = cl(x + 1)
                val s = gray[ru + xl] + 2 * gray[ru + x] + gray[ru + xr] + 2 * gray[r0 + xl] + 4 * gray[r0 + x] + 2 * gray[r0 + xr] + gray[rd + xl] + 2 * gray[rd + x] + gray[rd + xr]
                blur[r0 + x] = s / 16
            }
        }
        lap(1)

        val mag = IntArray(n * n)
        for (y in 0 until n) {
            val ru = cl(y - 1) * n
            val r0 = y * n
            val rd = cl(y + 1) * n
            for (x in 0 until n) {
                val xl = cl(x - 1)
                val xr = cl(x + 1)
                val gx = blur[ru + xr] + 2 * blur[r0 + xr] + blur[rd + xr] - (blur[ru + xl] + 2 * blur[r0 + xl] + blur[rd + xl])
                val gy = blur[rd + xl] + 2 * blur[rd + x] + blur[rd + xr] - (blur[ru + xl] + 2 * blur[ru + x] + blur[ru + xr])
                mag[r0 + x] = minOf(255, kotlin.math.abs(gx) + kotlin.math.abs(gy))
            }
        }
        lap(2)

        val result = LongArray(257)
        for (m in mag) {
            result[m]++
            if (m >= 128) result[256]++
        }
        lap(3)

        return Out(result, phases)
    }
    override fun check(out: Out): Int = foldAll(out.value as LongArray)
}

fun main(args: Array<String>) {
    emit("""{"e":"hello","lang":"kotlin"}""")
    try {
        val c: Challenge = when (args[0]) {
            "sort" -> SortChallenge
            "json" -> JsonChallenge
            "strings" -> StringsChallenge
            "sieve" -> SieveChallenge
            "records" -> RecordsChallenge
            "search" -> SearchChallenge
            "csv" -> CsvChallenge
            "metrics" -> MetricsChallenge
            "infer" -> InferChallenge
            "embed" -> EmbedChallenge
            "pixel" -> PixelChallenge
            else -> throw IllegalArgumentException("unknown challenge: ${args[0]}")
        }
        val size = args[1].toInt()
        val rng = Rng(args[2].toLong())
        val warmup = args[3].toInt()
        val runs = args[4].toInt()
        val g0 = System.nanoTime()
        val (input, hash, ops) = c.gen(size, rng)
        emit("""{"e":"ready","genNs":${System.nanoTime() - g0},"input":"${hex8(hash)}","ops":$ops}""")
        for (i in 0 until warmup + runs) {
            val work = c.prepare(input)
            val t0 = System.nanoTime()
            val out = c.run(work)
            val ns = System.nanoTime() - t0
            val warm = i < warmup
            val sb = StringBuilder("""{"e":"${if (warm) "warmup" else "run"}","i":${if (warm) i else i - warmup},"ns":$ns,"check":"${hex8(c.check(out))}"""")
            out.phases?.let { sb.append(",\"phases\":[").append(it.joinToString(",")).append(']') }
            emit(sb.append('}').toString())
        }
        emit("""{"e":"done"}""")
    } catch (e: Exception) {
        emit("""{"e":"error","msg":${MAPPER.writeValueAsString(e.message ?: e.toString())}}""")
        kotlin.system.exitProcess(1)
    }
}
