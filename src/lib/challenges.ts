import { MORE_IMPLEMENTATIONS } from "./implementations";
import type { ChallengeId, LanguageId } from "./types";

export interface BenchmarkImplementation {
  source: string;
  api: string;
  notes: string;
}

export type ChallengeCategory = "data" | "ai" | "core";

export const CATEGORIES: { id: ChallengeCategory; label: string }[] = [
  { id: "data", label: "DATA" },
  { id: "ai", label: "AI & GRAPHICS" },
  { id: "core", label: "CORE" },
];

export interface BenchmarkChallenge {
  id: ChallengeId;
  category: ChallengeCategory;
  name: string;
  codename: string;
  tagline: string;
  description: string;
  stages: string[];
  phases?: string[];
  unit: string;
  sizeLabel: (size: number) => string;
  defaultSize: number;
  presets: number[];
  minSize: number;
  maxSize: number;
  implementations: Partial<Record<LanguageId, BenchmarkImplementation>>;
  verifySizes: [number, number];
  factors?: string[];
}

const fmt = (n: number) => n.toLocaleString("en-US");

export const CHALLENGES: BenchmarkChallenge[] = [
  {
    id: "sort",
    category: "core",
    verifySizes: [1_000, 37_011],
    name: "Sorting Battle",
    codename: "SORT",
    tagline: "Same integers. Same order. Who gets there first?",
    description:
      "Every fighter generates the identical array of 31-bit integers from the shared seed, copies it (untimed), then sorts the copy ascending with its standard library. The sorted output is checksummed and must match across fighters.",
    stages: ["COPY", "SORT", "VERIFY"],
    unit: "elements",
    sizeLabel: (n) => `SORT ${fmt(n)} INTEGERS`,
    defaultSize: 1_000_000,
    presets: [100_000, 1_000_000, 3_000_000],
    minSize: 1_000,
    maxSize: 5_000_000,
    implementations: {
      javascript: { source: "bench/js/harness.mjs", api: "Array.prototype.sort((a, b) => a - b)", notes: "V8 sorts plain arrays with TimSort and calls the JavaScript comparator for every comparison; the JIT can inline it, but it remains a call per comparison. Integers stay as small-integer (Smi) tagged values." },
      typescript: { source: "bench/ts/harness.ts", api: "Array.prototype.sort((a, b) => a - b)", notes: "Compiled by tsc to essentially the same JavaScript as the JS fighter and executed by the same V8 — any gap should be within noise." },
      python: { source: "bench/python/harness.py", api: "list.sort()", notes: "TimSort implemented in C. CPython pre-scans the list and, when every element is a small int, switches to a specialised comparison that skips generic type dispatch — but each element is still a pointer to a heap-allocated int object, which costs cache locality." },
      go: { source: "bench/go/main.go", api: "slices.Sort([]int32)", notes: "Generic pattern-defeating quicksort over a contiguous []int32. Generics are stenciled per shape, so comparisons are direct integer compares." },
      rust: { source: "bench/rust/src/main.rs", api: "Vec<i32>::sort_unstable()", notes: "Unstable pattern-defeating sort over contiguous i32s, monomorphised and optimised by LLVM; no comparator indirection and no bounds checks in the hot loop." },
      java: { source: "bench/java/Harness.java", api: "Arrays.sort(int[])", notes: "Dual-Pivot Quicksort over a primitive int[] (no boxing). The hot loop is compiled by the C2 JIT after warm-up; cold runs execute partly interpreted." },
    },
  },
  {
    id: "json",
    category: "data",
    verifySizes: [100, 3_711],
    name: "JSON Battle",
    codename: "JSON",
    tagline: "Parse it. Filter it. Reshape it. Ship it.",
    description:
      "A byte-identical JSON array of user records is built from the seed. Each run parses the whole payload, keeps active records with score ≥ 500, reshapes them (uppercased name, doubled score, tag count) and serialises the result compactly. The output bytes are hashed and must match.",
    stages: ["PARSE", "FILTER", "TRANSFORM", "SERIALISE"],
    unit: "records",
    sizeLabel: (n) => `PARSE ${fmt(n)} JSON RECORDS`,
    defaultSize: 100_000,
    presets: [20_000, 100_000, 300_000],
    minSize: 100,
    maxSize: 500_000,
    implementations: {
      javascript: { source: "bench/js/harness.mjs", api: "JSON.parse / JSON.stringify", notes: "JSON.parse and JSON.stringify are native C++ inside V8 with years of tuning, producing dynamic objects that share hidden classes." },
      typescript: { source: "bench/ts/harness.ts", api: "JSON.parse / JSON.stringify", notes: "Type annotations (JsonRecord) are erased; the runtime work is identical to the JavaScript fighter." },
      python: { source: "bench/python/harness.py", api: "json.loads / json.dumps", notes: "The json module uses a C accelerator for scanning and encoding, but every value becomes a Python object (dict, str, int) that has to be allocated and reference-counted." },
      go: { source: "bench/go/main.go", api: "encoding/json (struct tags)", notes: "encoding/json maps into typed structs via reflection — safe and flexible, but known for comparatively slow decoding. Faster third-party decoders exist; this battle uses the standard library." },
      rust: { source: "bench/rust/src/main.rs", api: "serde_json + #[derive(Deserialize)]", notes: "serde generates a specialised deserializer at compile time, so there is no runtime reflection. Each record still allocates owned Strings." },
      java: { source: "bench/java/Harness.java", api: "Jackson databind (POJOs)", notes: "Jackson is the de facto JSON library on the JVM. Binding to POJOs is fast once JIT-compiled; its class-introspection cost is paid once and warm-up absorbs it." },
    },
  },
  {
    id: "strings",
    category: "data",
    verifySizes: [100, 3_711],
    name: "String Processing",
    codename: "GREP",
    tagline: "Logs in. Regex out. Every line counts.",
    description:
      "A synthetic access log is generated line by line. Each run splits it into lines, extracts status and latency with the same regular expression, searches for ERROR levels, tokenises each line on spaces and aggregates counters.",
    stages: ["SPLIT", "REGEX", "SEARCH", "TOKENISE", "COUNT"],
    unit: "lines",
    sizeLabel: (n) => `GREP ${fmt(n)} LOG LINES`,
    defaultSize: 300_000,
    presets: [50_000, 300_000, 1_000_000],
    minSize: 100,
    maxSize: 2_000_000,
    implementations: {
      javascript: { source: "bench/js/harness.mjs", api: "RegExp.exec, String.split, String.includes", notes: "Irregexp compiles regular expressions to native machine code. Splitting can produce cheap 'sliced' strings that point into the original buffer." },
      typescript: { source: "bench/ts/harness.ts", api: "RegExp.exec, String.split, String.includes", notes: "Same engine, same regex compiler as JavaScript." },
      python: { source: "bench/python/harness.py", api: "re.search, str.split, in", notes: "The re engine is a backtracking matcher written in C; the per-line loop, match objects and int() conversions run through the bytecode interpreter." },
      go: { source: "bench/go/main.go", api: "regexp.FindStringSubmatch, strings.Split", notes: "Go's regexp is RE2-style: guaranteed linear time with no catastrophic backtracking, at the cost of higher constant factors. Submatch extraction allocates a slice per line." },
      rust: { source: "bench/rust/src/main.rs", api: "regex crate captures, str::split", notes: "The regex crate uses finite automata plus SIMD-accelerated literal search, giving linear-time matching with very low overhead. Splits borrow from the input without copying." },
      java: { source: "bench/java/Harness.java", api: "java.util.regex, String.split", notes: "java.util.regex is a backtracking engine; String.split has a fast path for single-character separators. Every split allocates new String objects." },
    },
  },
  {
    id: "sieve",
    category: "core",
    verifySizes: [1_000, 37_011],
    name: "Number Crunch",
    codename: "PRIME",
    tagline: "Raw CPU. Tight loops. Prime numbers.",
    description:
      "A Sieve of Eratosthenes up to N, then a count and modular sum of every prime found. Pure integer arithmetic over a flat byte/boolean array — the closest thing here to a CPU drag race.",
    stages: ["ALLOCATE", "MARK", "SWEEP"],
    unit: "integers",
    sizeLabel: (n) => `SIEVE PRIMES TO ${fmt(n)}`,
    defaultSize: 10_000_000,
    presets: [1_000_000, 10_000_000, 50_000_000],
    minSize: 1_000,
    maxSize: 100_000_000,
    implementations: {
      javascript: { source: "bench/js/harness.mjs", api: "Uint8Array loops", notes: "A typed array plus monomorphic integer loops is the best case for V8's TurboFan JIT, which emits near-native machine code once the function is hot." },
      typescript: { source: "bench/ts/harness.ts", api: "Uint8Array loops", notes: "Identical emitted JavaScript to the JS fighter." },
      python: { source: "bench/python/harness.py", api: "bytearray slice assignment, itertools.compress", notes: "Idiomatic Python pushes the marking into C via slice assignment, but the outer loop and the final summation are still interpreted, and sum() works on boxed ints." },
      go: { source: "bench/go/main.go", api: "[]bool loops", notes: "Compiled ahead of time. Bounds checks remain in some loops, and Go's compiler optimises less aggressively than LLVM in exchange for fast builds." },
      rust: { source: "bench/rust/src/main.rs", api: "Vec<bool> loops", notes: "LLVM optimises the loops heavily and can often eliminate bounds checks; there is no runtime or GC in the way." },
      java: { source: "bench/java/Harness.java", api: "boolean[] loops", notes: "After warm-up, C2 compiles the loops to optimised native code. Cold runs show the cost of starting in the interpreter." },
    },
  },
  {
    id: "records",
    category: "data",
    verifySizes: [100, 3_711],
    name: "Data Processing",
    codename: "PIPE",
    tagline: "FILTER → GROUP → SORT → AGGREGATE",
    description:
      "An in-memory table of user records (id, name, country, age, score, createdAt) is generated natively. Each run filters adults with a qualifying score and recent creation date, groups by country, aggregates count/sum/max/age, then sorts groups by total score.",
    stages: ["FILTER", "GROUP", "SORT", "AGGREGATE"],
    unit: "records",
    sizeLabel: (n) => `PROCESS ${fmt(n)} RECORDS`,
    defaultSize: 500_000,
    presets: [100_000, 500_000, 1_000_000],
    minSize: 100,
    maxSize: 2_000_000,
    implementations: {
      javascript: { source: "bench/js/harness.mjs", api: "for…of, Map<string, Group>", notes: "Records that share a shape share a hidden class, so property reads become fixed-offset loads in JIT-compiled code." },
      typescript: { source: "bench/ts/harness.ts", api: "for…of, Map<string, Group>", notes: "Interfaces are erased — same objects, same hidden classes as JavaScript." },
      python: { source: "bench/python/harness.py", api: "dict records, dict groups, sorted(key=…)", notes: "Each record is a dict, so every field read is a hash lookup and every number is a boxed object; the loop runs in the interpreter." },
      go: { source: "bench/go/main.go", api: "[]record structs, map[string]*agg", notes: "A slice of structs is laid out contiguously in memory, which is friendly to CPU caches; field access is a fixed offset." },
      rust: { source: "bench/rust/src/main.rs", api: "Vec<Record>, HashMap<&str, Agg>", notes: "Contiguous structs and zero-cost iterators. The standard HashMap uses SipHash, which resists hash-flooding but is slower than non-cryptographic hashes." },
      java: { source: "bench/java/Harness.java", api: "ArrayList<Rec>, HashMap<String, Agg>", notes: "An ArrayList holds references, so iterating means following a pointer to each object. String keys cache their hashCode after the first call." },
    },
  },
  {
    id: "search",
    category: "core",
    verifySizes: [100, 3_711],
    name: "Search Battle",
    codename: "SEEK",
    tagline: "Hash it or halve it — two strategies, one target.",
    description:
      "N keys and N queries (half guaranteed hits, half random). Each run builds a hash index and probes it, then builds a sorted index and answers the same queries by binary search. Both strategies must agree on the hit count; phase timings are reported separately.",
    stages: ["HASH BUILD", "HASH PROBE", "SORT INDEX", "BINARY SEARCH"],
    phases: ["hash build", "hash probe", "sort index", "binary search"],
    unit: "probes",
    sizeLabel: (n) => `SEARCH ${fmt(n)} KEYS`,
    defaultSize: 300_000,
    presets: [50_000, 300_000, 1_000_000],
    minSize: 100,
    maxSize: 2_000_000,
    implementations: {
      javascript: { source: "bench/js/harness.mjs", api: "Map<number, number>, hand-written binary search", notes: "Map is an ordered hash table. JavaScript has no standard binary search, so a straightforward lower-bound loop is used." },
      typescript: { source: "bench/ts/harness.ts", api: "Map<number, number>, hand-written binary search", notes: "Same as JavaScript." },
      python: { source: "bench/python/harness.py", api: "dict, bisect.bisect_left", notes: "dict is one of CPython's most optimised structures and bisect runs in C, but each probe still starts from interpreted Python code." },
      go: { source: "bench/go/main.go", api: "map[int32]int32, slices.BinarySearch", notes: "Go's built-in map hashes primitive keys with an AES-accelerated hash where the CPU supports it; values are stored inline." },
      rust: { source: "bench/rust/src/main.rs", api: "HashMap<i32, u32>, slice::binary_search", notes: "HashMap is a SwissTable (hashbrown) with SipHash by default. binary_search over a contiguous slice is branch-light and cache friendly." },
      java: { source: "bench/java/Harness.java", api: "HashMap<Integer, Integer>, Arrays.binarySearch", notes: "Generic collections box keys and values as Integer objects, adding allocations and pointer chasing; Arrays.binarySearch works on the primitive int[]." },
    },
  },
  {
    id: "csv",
    category: "data",
    verifySizes: [1_000, 20_011],
    name: "CSV Report",
    codename: "CSV",
    tagline: "A sales export in, a revenue report out.",
    description:
      "A seeded sales export (order id, date, region, SKU, quantity, unit price, discount) is generated as CSV text. Each run parses every row, applies the discount, groups revenue by region and month, and writes a sorted CSV report. The report bytes must match across fighters.",
    stages: ["SPLIT", "PARSE", "AGGREGATE", "WRITE REPORT"],
    unit: "rows",
    sizeLabel: (n) => `CSV ${fmt(n)} ORDERS`,
    defaultSize: 300_000,
    presets: [100_000, 300_000, 1_000_000],
    minSize: 1_000,
    maxSize: 2_000_000,
    implementations: {},
    factors: [
      "This is string work: splitting lines and fields, then turning digits into integers. Languages that can slice without copying (Rust, Go, Zig, C) avoid allocating a new string per field.",
      "Dynamic languages allocate a small string object for every field and a list for every row, so the garbage collector does real work here.",
      "Revenue totals exceed 32 bits on large inputs, so every language uses 64-bit (or arbitrary-precision) integers for the sums.",
    ],
  },
  {
    id: "metrics",
    category: "data",
    verifySizes: [1_000, 20_011],
    name: "Latency Analytics",
    codename: "METRICS",
    tagline: "Rolling windows, p99s and per-minute peaks.",
    description:
      "A seeded stream of request latencies (with occasional spikes) is analysed like an observability pipeline: a 60-sample rolling window flags slow periods, per-minute buckets record peaks, and a sorted copy yields the p50, p95 and p99. Every statistic must match.",
    stages: ["WINDOW", "BUCKETS", "SORT", "PERCENTILES"],
    unit: "samples",
    sizeLabel: (n) => `METRICS ${fmt(n)} SAMPLES`,
    defaultSize: 1_000_000,
    presets: [300_000, 1_000_000, 3_000_000],
    minSize: 1_000,
    maxSize: 5_000_000,
    implementations: {},
    factors: [
      "Two streaming passes over a flat array plus one sort. Compact, unboxed arrays keep the passes cache-friendly; boxed numbers make every read a pointer chase.",
      "The percentile step is a full standard-library sort, so the sort battle's winners tend to do well here too.",
      "R and Julia express the rolling window as a cumulative sum, which is the idiomatic vectorised approach.",
    ],
  },
  {
    id: "infer",
    category: "ai",
    verifySizes: [10, 137],
    name: "Neural Net Inference",
    codename: "INFER",
    tagline: "Same int8 model, same batch. Who classifies faster?",
    description:
      "A seeded int8-quantised neural network (64 → 64 → 64 → 10, ReLU, requantised between layers) classifies a batch of inputs, the way an edge device runs a small model. Every prediction and its logit must match exactly, so integer arithmetic is used throughout.",
    stages: ["LOAD WEIGHTS", "DENSE + RELU", "DENSE + RELU", "ARGMAX"],
    unit: "inferences",
    sizeLabel: (n) => `INFER ${fmt(n)} SAMPLES`,
    defaultSize: 500,
    presets: [200, 500, 2_000],
    minSize: 10,
    maxSize: 50_000,
    implementations: {},
    factors: [
      "Almost all the time goes into multiply-accumulate loops. Compilers that vectorise them (C, C++, Rust, Zig, Julia) process many lanes per instruction.",
      "Interpreters pay a dispatch cost for every multiply. This is the gap that libraries like numpy exist to close, and they are deliberately not used here.",
      "R expresses each layer as a matrix product (%*%), which hands the work to optimised BLAS. That is idiomatic R, and the results stay exact because every value fits in a double.",
    ],
  },
  {
    id: "embed",
    category: "ai",
    verifySizes: [100, 1_013],
    name: "Vector Search",
    codename: "EMBED",
    tagline: "RAG retrieval: the top 10 matches for every query.",
    description:
      "A corpus of seeded 64-dimensional embeddings is searched the way a retrieval-augmented generation (RAG) pipeline finds context: every query is scored against every document by dot product, and the top 10 results are ranked. The ranked ids and scores must match.",
    stages: ["EMBED", "SCORE", "RANK", "TOP 10"],
    unit: "comparisons",
    sizeLabel: (n) => `EMBED ${fmt(n)} DOCUMENTS`,
    defaultSize: 5_000,
    presets: [2_000, 5_000, 20_000],
    minSize: 100,
    maxSize: 200_000,
    implementations: {},
    factors: [
      "Brute-force similarity search is dot products over flat arrays: a SIMD-friendly inner loop for compiled languages and a long interpreted loop for the rest.",
      "Ranking sorts or partially sorts N scores per query, so allocation and comparator cost matter as the corpus grows.",
      "Production vector databases add approximate indexes (HNSW, IVF); exact search is the baseline they are measured against.",
    ],
  },
  {
    id: "pixel",
    category: "ai",
    verifySizes: [8, 97],
    name: "Image Processing",
    codename: "PIXEL",
    tagline: "Grayscale, blur, edge-detect. Same pixels out.",
    description:
      "A seeded RGB image goes through a classic image pipeline: grayscale conversion, a 3×3 Gaussian blur, Sobel edge detection and a histogram of edge strength. Each stage is timed separately, and the histogram must match bin for bin.",
    stages: ["GRAYSCALE", "BLUR", "SOBEL", "HISTOGRAM"],
    phases: ["grayscale", "blur", "sobel", "histogram"],
    unit: "pixels",
    sizeLabel: (n) => `PIXEL ${n}×${n} IMAGE`,
    defaultSize: 512,
    presets: [256, 512, 1_024],
    minSize: 8,
    maxSize: 4_096,
    implementations: {},
    factors: [
      "Stencil loops over byte arrays: each output pixel reads its 3×3 neighbourhood. Bounds-check elimination and tight indexing decide the compiled languages; interpreters pay per pixel.",
      "R works on whole matrices at once (shifted copies for each neighbour), which moves the loops into C.",
      "The phase timings show where each language spends its time. Blur and Sobel dominate, because they read nine pixels per output.",
    ],
  },
];

for (const c of CHALLENGES) Object.assign(c.implementations, MORE_IMPLEMENTATIONS[c.id] ?? {});

const byId = new Map(CHALLENGES.map((c) => [c.id, c]));

export function getChallenge(id: string): BenchmarkChallenge | undefined {
  return byId.get(id as ChallengeId);
}
