package main

import (
	"cmp"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

var (
	countries = []string{"US", "GB", "DE", "FR", "JP", "BR", "IN", "CN", "CA", "AU", "NO", "SE", "ZA", "NG", "MX", "ES", "IT", "KR", "NL", "PL"}
	levels    = []string{"INFO", "WARN", "ERROR", "DEBUG"}
	resources = []string{"users", "orders", "items", "auth", "search"}
	statuses  = []int{200, 200, 200, 201, 404, 500}
)

func emit(line string) {
	os.Stdout.WriteString(line + "\n")
}

type rng struct{ s uint32 }

func newRng(seed uint64) *rng {
	s := uint32(seed)
	if s == 0 {
		s = 0x9e3779b9
	}
	return &rng{s}
}

func (r *rng) next() uint32 {
	x := r.s
	x ^= x << 13
	x ^= x >> 17
	x ^= x << 5
	r.s = x
	return x
}

func (r *rng) intn(n int) int { return int(r.next() % uint32(n)) }

func fold(h uint32, v uint64) uint32 { return h*31 + uint32(v) }

func fnv1a(s string) uint32 {
	h := uint32(0x811c9dc5)
	for i := 0; i < len(s); i++ {
		h ^= uint32(s[i])
		h *= 0x01000193
	}
	return h
}

func foldAll(values []uint64) uint32 {
	var h uint32
	for _, v := range values {
		h = fold(h, v)
	}
	return h
}

type output struct {
	value  any
	phases []int64
}

type challenge struct {
	gen     func(n int, r *rng) (input any, hash uint32, ops int)
	prepare func(input any) any
	run     func(work any) (output, error)
	check   func(out output) uint32
}

func identity(x any) any { return x }

var sortChallenge = challenge{
	gen: func(n int, r *rng) (any, uint32, int) {
		data := make([]int32, n)
		var h uint32
		for i := range data {
			data[i] = int32(r.next() & 0x7fffffff)
			h = fold(h, uint64(data[i]))
		}
		return data, h, n
	},
	prepare: func(input any) any { return slices.Clone(input.([]int32)) },
	run: func(work any) (output, error) {
		data := work.([]int32)
		slices.Sort(data)
		return output{value: data}, nil
	},
	check: func(out output) uint32 {
		var h uint32
		for _, v := range out.value.([]int32) {
			h = fold(h, uint64(v))
		}
		return h
	},
}

type jsonRecord struct {
	ID      int      `json:"id"`
	Name    string   `json:"name"`
	Country string   `json:"country"`
	Age     int      `json:"age"`
	Score   int      `json:"score"`
	Active  bool     `json:"active"`
	Tags    []string `json:"tags"`
}

type jsonOut struct {
	Country  string `json:"country"`
	ID       int    `json:"id"`
	Name     string `json:"name"`
	Score2   int    `json:"score2"`
	TagCount int    `json:"tagCount"`
}

var jsonChallenge = challenge{
	gen: func(n int, r *rng) (any, uint32, int) {
		var sb strings.Builder
		sb.Grow(n * 110)
		sb.WriteByte('[')
		for i := 0; i < n; i++ {
			country := countries[r.intn(20)]
			age := 10 + r.intn(80)
			score := r.intn(1000)
			active := r.next()&1 == 1
			t1 := r.intn(10)
			t2 := r.intn(10)
			if i > 0 {
				sb.WriteByte(',')
			}
			fmt.Fprintf(&sb, `{"id":%d,"name":"user_%d","country":"%s","age":%d,"score":%d,"active":%t,"tags":["t%d","t%d"]}`,
				i, i, country, age, score, active, t1, t2)
		}
		sb.WriteByte(']')
		text := sb.String()
		return text, fnv1a(text), n
	},
	prepare: identity,
	run: func(work any) (output, error) {
		var records []jsonRecord
		if err := json.Unmarshal([]byte(work.(string)), &records); err != nil {
			return output{}, err
		}
		out := make([]jsonOut, 0)
		for _, r := range records {
			if r.Active && r.Score >= 500 {
				out = append(out, jsonOut{ID: r.ID, Name: strings.ToUpper(r.Name), Country: r.Country, Score2: r.Score * 2, TagCount: len(r.Tags)})
			}
		}
		b, err := json.Marshal(out)
		if err != nil {
			return output{}, err
		}
		return output{value: string(b)}, nil
	},
	check: func(out output) uint32 { return fnv1a(out.value.(string)) },
}

var stringsChallenge = challenge{
	gen: func(n int, r *rng) (any, uint32, int) {
		var sb strings.Builder
		sb.Grow(n * 90)
		for i := 0; i < n; i++ {
			level := levels[r.intn(4)]
			user := r.intn(1000)
			res := resources[r.intn(5)]
			id := r.intn(10000)
			status := statuses[r.intn(6)]
			latency := r.intn(2000)
			if i > 0 {
				sb.WriteByte('\n')
			}
			fmt.Fprintf(&sb, "ts=%d level=%s user=u%d path=/api/%s/%d status=%d latency=%dms",
				1700000000+i, level, user, res, id, status, latency)
		}
		text := sb.String()
		return text, fnv1a(text), n
	},
	prepare: identity,
	run: func(work any) (output, error) {
		pattern := regexp.MustCompile(`status=(\d{3}) latency=(\d+)ms`)
		var lines, s5xx, errors, latency, tokens uint64
		for _, line := range strings.Split(work.(string), "\n") {
			lines++
			if m := pattern.FindStringSubmatch(line); m != nil {
				if status, _ := strconv.Atoi(m[1]); status >= 500 {
					s5xx++
				}
				l, _ := strconv.Atoi(m[2])
				latency += uint64(l)
			}
			if strings.Contains(line, "level=ERROR") {
				errors++
			}
			tokens += uint64(len(strings.Split(line, " ")))
		}
		return output{value: []uint64{lines, s5xx, errors, latency & 0xffffffff, tokens}}, nil
	},
	check: func(out output) uint32 { return foldAll(out.value.([]uint64)) },
}

var sieveChallenge = challenge{
	gen:     func(n int, _ *rng) (any, uint32, int) { return n, uint32(n), n },
	prepare: identity,
	run: func(work any) (output, error) {
		n := work.(int)
		composite := make([]bool, n+1)
		for i := 2; i*i <= n; i++ {
			if !composite[i] {
				for j := i * i; j <= n; j += i {
					composite[j] = true
				}
			}
		}
		var count, sum uint64
		for i := 2; i <= n; i++ {
			if !composite[i] {
				count++
				sum += uint64(i)
			}
		}
		return output{value: []uint64{count, sum & 0xffffffff}}, nil
	},
	check: func(out output) uint32 { return foldAll(out.value.([]uint64)) },
}

type record struct {
	ID        int
	Name      string
	Country   string
	Age       int
	Score     int
	CreatedAt int
}

type agg struct {
	Country     string
	Count, Sum  uint64
	Max, AgeSum uint64
}

var recordsChallenge = challenge{
	gen: func(n int, r *rng) (any, uint32, int) {
		records := make([]record, n)
		var h uint32
		for i := range records {
			c := r.intn(20)
			age := 10 + r.intn(80)
			score := r.intn(1000)
			createdAt := 1700000000 + r.intn(31536000)
			records[i] = record{ID: i, Name: "user_" + strconv.Itoa(i), Country: countries[c], Age: age, Score: score, CreatedAt: createdAt}
			h = fold(fold(fold(fold(h, uint64(c)), uint64(age)), uint64(score)), uint64(createdAt))
		}
		return records, h, n
	},
	prepare: identity,
	run: func(work any) (output, error) {
		const cutoff = 1700000000 + 15768000
		groups := map[string]*agg{}
		records := work.([]record)
		for i := range records {
			r := &records[i]
			if r.Age >= 18 && r.Score >= 100 && r.CreatedAt >= cutoff {
				g, ok := groups[r.Country]
				if !ok {
					g = &agg{Country: r.Country}
					groups[r.Country] = g
				}
				g.Count++
				g.Sum += uint64(r.Score)
				if uint64(r.Score) > g.Max {
					g.Max = uint64(r.Score)
				}
				g.AgeSum += uint64(r.Age)
			}
		}
		sorted := make([]*agg, 0, len(groups))
		for _, g := range groups {
			sorted = append(sorted, g)
		}
		slices.SortFunc(sorted, func(a, b *agg) int {
			if c := cmp.Compare(b.Sum, a.Sum); c != 0 {
				return c
			}
			return strings.Compare(a.Country, b.Country)
		})
		return output{value: sorted}, nil
	},
	check: func(out output) uint32 {
		var h uint32
		for _, g := range out.value.([]*agg) {
			h = fold(h, uint64(fnv1a(g.Country)))
			h = fold(h, g.Count)
			h = fold(h, g.Sum&0xffffffff)
			h = fold(h, g.Max)
			h = fold(h, g.AgeSum&0xffffffff)
		}
		return h
	},
}

type searchInput struct{ keys, queries []int32 }

var searchChallenge = challenge{
	gen: func(n int, r *rng) (any, uint32, int) {
		in := searchInput{make([]int32, n), make([]int32, n)}
		var h uint32
		for i := range in.keys {
			in.keys[i] = int32(r.next() & 0x7fffffff)
			h = fold(h, uint64(in.keys[i]))
		}
		for i := range in.queries {
			if i&1 == 0 {
				in.queries[i] = in.keys[r.intn(n)]
			} else {
				in.queries[i] = int32(r.next() & 0x7fffffff)
			}
			h = fold(h, uint64(in.queries[i]))
		}
		return in, h, 2 * n
	},
	prepare: identity,
	run: func(work any) (output, error) {
		in := work.(searchInput)
		phases := make([]int64, 0, 4)
		t := time.Now()
		lap := func() {
			now := time.Now()
			phases = append(phases, now.Sub(t).Nanoseconds())
			t = now
		}

		index := map[int32]int32{}
		for i, k := range in.keys {
			index[k] = int32(i)
		}
		lap()

		var hits, sum uint64
		for _, q := range in.queries {
			if v, ok := index[q]; ok {
				hits++
				sum += uint64(v)
			}
		}
		lap()

		sorted := slices.Clone(in.keys)
		slices.Sort(sorted)
		lap()

		var binHits uint64
		for _, q := range in.queries {
			if _, found := slices.BinarySearch(sorted, q); found {
				binHits++
			}
		}
		lap()

		return output{value: []uint64{hits, sum & 0xffffffff, binHits}, phases: phases}, nil
	},
	check: func(out output) uint32 { return foldAll(out.value.([]uint64)) },
}

var regions = []string{"NA", "EMEA", "APAC", "LATAM", "ANZ", "MEA", "NORDICS", "DACH"}

type csvKey struct {
	region string
	month  int
}

type csvGroup struct {
	region                 string
	month                  int
	orders, units, revenue uint64
}

var csvChallenge = challenge{
	gen: func(n int, r *rng) (any, uint32, int) {
		var sb strings.Builder
		sb.Grow(n * 48)
		sb.WriteString("order_id,date,region,sku,qty,unit_price_cents,discount_pct")
		for i := 0; i < n; i++ {
			month := 1 + r.intn(12)
			day := 1 + r.intn(28)
			region := regions[r.intn(8)]
			sku := r.intn(1000)
			qty := 1 + r.intn(20)
			price := 99 + r.intn(99901)
			discount := 5 * r.intn(5)
			fmt.Fprintf(&sb, "\n%d,2026-%02d-%02d,%s,SKU-%d,%d,%d,%d", i, month, day, region, sku, qty, price, discount)
		}
		text := sb.String()
		return text, fnv1a(text), n
	},
	prepare: identity,
	run: func(work any) (output, error) {
		lines := strings.Split(work.(string), "\n")
		groups := map[csvKey]*csvGroup{}
		for _, line := range lines[1:] {
			f := strings.Split(line, ",")
			month, _ := strconv.Atoi(f[1][5:7])
			qty, _ := strconv.Atoi(f[4])
			price, _ := strconv.Atoi(f[5])
			discount, _ := strconv.Atoi(f[6])
			revenue := qty * price * (100 - discount) / 100
			key := csvKey{f[2], month}
			g, ok := groups[key]
			if !ok {
				g = &csvGroup{region: f[2], month: month}
				groups[key] = g
			}
			g.orders++
			g.units += uint64(qty)
			g.revenue += uint64(revenue)
		}
		rows := make([]*csvGroup, 0, len(groups))
		for _, g := range groups {
			rows = append(rows, g)
		}
		slices.SortFunc(rows, func(a, b *csvGroup) int {
			return cmp.Or(strings.Compare(a.region, b.region), cmp.Compare(a.month, b.month))
		})
		var sb strings.Builder
		sb.WriteString("region,month,orders,units,revenue_cents")
		for _, g := range rows {
			fmt.Fprintf(&sb, "\n%s,2026-%02d,%d,%d,%d", g.region, g.month, g.orders, g.units, g.revenue)
		}
		return output{value: sb.String()}, nil
	},
	check: func(out output) uint32 { return fnv1a(out.value.(string)) },
}

var metricsChallenge = challenge{
	gen: func(n int, r *rng) (any, uint32, int) {
		values := make([]int32, n)
		var h uint32
		for i := range values {
			v := 20 + r.intn(80)
			if r.intn(100) < 3 {
				v += 200 + r.intn(800)
			}
			values[i] = int32(v)
			h = fold(h, uint64(v))
		}
		return values, h, n
	},
	prepare: identity,
	run: func(work any) (output, error) {
		values := work.([]int32)
		n := len(values)
		var window, slow, peak, total int64
		for i, v := range values {
			window += int64(v)
			total += int64(v)
			if i >= 60 {
				window -= int64(values[i-60])
			}
			if i >= 59 {
				if window > 7200 {
					slow++
				}
				peak = max(peak, window)
			}
		}
		var buckets uint32
		for start := 0; start < n; start += 60 {
			buckets = fold(buckets, uint64(slices.Max(values[start:min(start+60, n)])))
		}
		sorted := slices.Clone(values)
		slices.Sort(sorted)
		rank := func(p int) uint64 { return uint64(sorted[(p*n+99)/100-1]) }
		meanMilli := uint64(total*1000) / uint64(n)
		return output{value: []uint64{uint64(slow), uint64(peak), uint64(buckets), rank(50), rank(95), rank(99), uint64(sorted[n-1]), meanMilli & 0xffffffff}}, nil
	},
	check: func(out output) uint32 { return foldAll(out.value.([]uint64)) },
}

const (
	nnIn  = 64
	nnH   = 64
	nnOut = 10
)

type mlp struct {
	w1, b1, w2, b2, w3, b3, x []int32
	n                         int
}

func dense(w, b, input, out []int32) {
	inLen := len(input)
	for j := range out {
		a := b[j]
		row := w[j*inLen : (j+1)*inLen]
		for k, v := range input {
			a += row[k] * v
		}
		out[j] = a
	}
}

var inferChallenge = challenge{
	gen: func(n int, r *rng) (any, uint32, int) {
		var h uint32
		draw := func(count, k, offset int) []int32 {
			out := make([]int32, count)
			for i := range out {
				raw := r.intn(k)
				h = fold(h, uint64(raw))
				out[i] = int32(raw - offset)
			}
			return out
		}
		m := mlp{n: n}
		m.w1, m.b1 = draw(nnH*nnIn, 255, 127), draw(nnH, 2001, 1000)
		m.w2, m.b2 = draw(nnH*nnH, 255, 127), draw(nnH, 2001, 1000)
		m.w3, m.b3 = draw(nnOut*nnH, 255, 127), draw(nnOut, 2001, 1000)
		m.x = draw(n*nnIn, 256, 128)
		return m, h, n
	},
	prepare: identity,
	run: func(work any) (output, error) {
		m := work.(mlp)
		h1, h2, logits := make([]int32, nnH), make([]int32, nnH), make([]int32, nnOut)
		var preds, conf uint32
		for s := 0; s < m.n; s++ {
			dense(m.w1, m.b1, m.x[s*nnIn:(s+1)*nnIn], h1)
			for j := range h1 {
				h1[j] = min(127, max(0, h1[j])/1024)
			}
			dense(m.w2, m.b2, h1, h2)
			for j := range h2 {
				h2[j] = min(127, max(0, h2[j])/1024)
			}
			dense(m.w3, m.b3, h2, logits)
			pred := 0
			for o := 1; o < nnOut; o++ {
				if logits[o] > logits[pred] {
					pred = o
				}
			}
			preds = fold(preds, uint64(pred))
			conf += uint32(logits[pred] + 4194304)
		}
		return output{value: []uint64{uint64(preds), uint64(conf)}}, nil
	},
	check: func(out output) uint32 { return foldAll(out.value.([]uint64)) },
}

const (
	embD = 64
	embQ = 8
	embK = 10
)

type embedInput struct {
	docs, queries []int32
	n             int
}

type scored struct {
	score int32
	index int32
}

var embedChallenge = challenge{
	gen: func(n int, r *rng) (any, uint32, int) {
		var h uint32
		draw := func(count int) []int32 {
			out := make([]int32, count)
			for i := range out {
				raw := r.intn(256)
				h = fold(h, uint64(raw))
				out[i] = int32(raw - 128)
			}
			return out
		}
		docs := draw(n * embD)
		queries := draw(embQ * embD)
		return embedInput{docs, queries, n}, h, n * embQ
	},
	prepare: identity,
	run: func(work any) (output, error) {
		in := work.(embedInput)
		results := make([]uint64, 0, 2*embQ*embK)
		ranked := make([]scored, in.n)
		for q := 0; q < embQ; q++ {
			query := in.queries[q*embD : (q+1)*embD]
			for d := range ranked {
				doc := in.docs[d*embD : (d+1)*embD]
				var s int32
				for k, v := range query {
					s += doc[k] * v
				}
				ranked[d] = scored{s, int32(d)}
			}
			slices.SortFunc(ranked, func(a, b scored) int {
				return cmp.Or(cmp.Compare(b.score, a.score), cmp.Compare(a.index, b.index))
			})
			for _, r := range ranked[:embK] {
				results = append(results, uint64(r.index), uint64(r.score+2097152))
			}
		}
		return output{value: results}, nil
	},
	check: func(out output) uint32 { return foldAll(out.value.([]uint64)) },
}

type image struct {
	rgb []uint8
	n   int
}

var pixelChallenge = challenge{
	gen: func(n int, r *rng) (any, uint32, int) {
		rgb := make([]uint8, n*n*3)
		var h uint32
		for y := 0; y < n; y++ {
			for x := 0; x < n; x++ {
				p := (y*n + x) * 3
				rgb[p] = uint8((x + y + r.intn(64)) % 256)
				rgb[p+1] = uint8((2*x + r.intn(64)) % 256)
				rgb[p+2] = uint8((2*y + r.intn(64)) % 256)
				h = fold(fold(fold(h, uint64(rgb[p])), uint64(rgb[p+1])), uint64(rgb[p+2]))
			}
		}
		return image{rgb, n}, h, n * n
	},
	prepare: identity,
	run: func(work any) (output, error) {
		img := work.(image)
		n, rgb := img.n, img.rgb
		phases := make([]int64, 0, 4)
		t := time.Now()
		lap := func() {
			now := time.Now()
			phases = append(phases, now.Sub(t).Nanoseconds())
			t = now
		}
		cl := func(v int) int { return min(max(v, 0), n-1) }

		gray := make([]uint8, n*n)
		for i := range gray {
			gray[i] = uint8((77*int(rgb[i*3]) + 150*int(rgb[i*3+1]) + 29*int(rgb[i*3+2])) / 256)
		}
		lap()

		blur := make([]uint8, n*n)
		for y := 0; y < n; y++ {
			ru, r0, rd := cl(y-1)*n, y*n, cl(y+1)*n
			for x := 0; x < n; x++ {
				xl, xr := cl(x-1), cl(x+1)
				s := int(gray[ru+xl]) + 2*int(gray[ru+x]) + int(gray[ru+xr]) + 2*int(gray[r0+xl]) + 4*int(gray[r0+x]) + 2*int(gray[r0+xr]) + int(gray[rd+xl]) + 2*int(gray[rd+x]) + int(gray[rd+xr])
				blur[r0+x] = uint8(s / 16)
			}
		}
		lap()

		mag := make([]uint8, n*n)
		for y := 0; y < n; y++ {
			ru, r0, rd := cl(y-1)*n, y*n, cl(y+1)*n
			for x := 0; x < n; x++ {
				xl, xr := cl(x-1), cl(x+1)
				gx := int(blur[ru+xr]) + 2*int(blur[r0+xr]) + int(blur[rd+xr]) - (int(blur[ru+xl]) + 2*int(blur[r0+xl]) + int(blur[rd+xl]))
				gy := int(blur[rd+xl]) + 2*int(blur[rd+x]) + int(blur[rd+xr]) - (int(blur[ru+xl]) + 2*int(blur[ru+x]) + int(blur[ru+xr]))
				mag[r0+x] = uint8(min(255, abs(gx)+abs(gy)))
			}
		}
		lap()

		var hist [256]uint64
		var edges uint64
		for _, m := range mag {
			hist[m]++
			if m >= 128 {
				edges++
			}
		}
		lap()

		return output{value: append(hist[:], edges), phases: phases}, nil
	},
	check: func(out output) uint32 { return foldAll(out.value.([]uint64)) },
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

var challenges = map[string]challenge{
	"sort":    sortChallenge,
	"json":    jsonChallenge,
	"strings": stringsChallenge,
	"sieve":   sieveChallenge,
	"records": recordsChallenge,
	"search":  searchChallenge,
	"csv":     csvChallenge,
	"metrics": metricsChallenge,
	"infer":   inferChallenge,
	"embed":   embedChallenge,
	"pixel":   pixelChallenge,
}

func fail(err error) {
	msg, _ := json.Marshal(err.Error())
	emit(`{"e":"error","msg":` + string(msg) + `}`)
	os.Exit(1)
}

func main() {
	emit(`{"e":"hello","lang":"go"}`)
	if len(os.Args) < 6 {
		fail(fmt.Errorf("usage: harness <challenge> <size> <seed> <warmup> <runs>"))
	}
	c, ok := challenges[os.Args[1]]
	if !ok {
		fail(fmt.Errorf("unknown challenge: %s", os.Args[1]))
	}
	size, _ := strconv.Atoi(os.Args[2])
	seed, _ := strconv.ParseUint(os.Args[3], 10, 64)
	warmup, _ := strconv.Atoi(os.Args[4])
	runs, _ := strconv.Atoi(os.Args[5])

	g0 := time.Now()
	input, hash, ops := c.gen(size, newRng(seed))
	emit(fmt.Sprintf(`{"e":"ready","genNs":%d,"input":"%08x","ops":%d}`, time.Since(g0).Nanoseconds(), hash, ops))

	for i := 0; i < warmup+runs; i++ {
		work := c.prepare(input)
		t0 := time.Now()
		out, err := c.run(work)
		ns := time.Since(t0).Nanoseconds()
		if err != nil {
			fail(err)
		}
		kind, idx := "run", i-warmup
		if i < warmup {
			kind, idx = "warmup", i
		}
		line := fmt.Sprintf(`{"e":"%s","i":%d,"ns":%d,"check":"%08x"`, kind, idx, ns, c.check(out))
		if out.phases != nil {
			parts := make([]string, len(out.phases))
			for p, v := range out.phases {
				parts[p] = strconv.FormatInt(v, 10)
			}
			line += `,"phases":[` + strings.Join(parts, ",") + `]`
		}
		emit(line + "}")
	}
	emit(`{"e":"done"}`)
}
