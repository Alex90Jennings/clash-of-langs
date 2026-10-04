# Benchmark methodology

The product principle: fun enough for "just one more battle", credible enough that a sceptical developer doesn't dismiss the numbers. This document describes what is measured, how, and what is deliberately left out.

## Prior art this follows

- **The Computer Language Benchmarks Game** shows the same algorithm implemented per language, with full source visible and measurements reported per program (CPU time, elapsed time, peak memory), not per language.
- **hyperfine** popularised warm-up runs, multiple runs, and flagging statistical outliers rather than silently dropping them.
- **JMH / pyperf / criterion** stress that JIT and adaptive runtimes need warm-up, that process-to-process variance matters, and that reporting a single fastest run is misleading.

## What a battle measures

| Metric | Source | Notes |
| --- | --- | --- |
| Run time (WARM) | in-process monotonic clock around the `run` step | after `warmup` discarded runs, `runs` measured runs, one process |
| Run time (COLD) | spawn → `hello` (OS clock in the engine) + first unwarmed run (in-process) | one fresh process per sample |
| Startup | spawn → first stdout line, median over every launch (≥ 3 dedicated probes) | includes runtime boot and module loading |
| Peak memory | `wait4` rusage max RSS via `/usr/bin/time` (`-l` on macOS, GNU `-f %M` on Linux) | same OS mechanism for every language; includes the runtime |
| Baseline memory | peak RSS of a minimum-size probe run | shows how much of the peak is the runtime itself |
| CPU time | user + sys from the same rusage | covers the whole process including generation, so it's context, not a score |
| Throughput | `ops / median` | |

## Fairness rules

1. **Deterministic, proven-identical input.** Each harness regenerates the input from a shared xorshift32 seed (see `bench/SPEC.md`) and reports an input hash. If the hashes differ, the battle is **invalid**: no winner.
2. **Proven-identical output.** Each measured run emits a checksum of its result. Every run must agree within a fighter, and the two fighters must agree with each other. This is what stops a "fast" implementation that does less work.
3. **Generation is untimed.** Only the challenge's `run` step is inside the timer. Per-run copies (e.g. the array a sort mutates) are made before the timer starts.
4. **Compilation is always ahead of time and excluded for everyone.** Go, Rust, Java (`javac`) and TypeScript (`tsc`) are compiled when the worker image is built. JIT compilation at run time (V8, HotSpot) is *not* excluded, because it is part of how those runtimes execute. That is exactly what COLD vs WARM exposes.
5. **COLD vs WARM are never mixed.** WARM excludes startup from the performance number and reports it separately. COLD includes startup in every sample. Both are labelled everywhere a number appears.
6. **One battle at a time, fighters sequentially.** Two benchmarks sharing CPUs measure each other. The engine holds an exclusive lock per worker, runs fighters one after the other, and **randomises the order** so neither side systematically gets the warmer (or more thermally throttled) slot.
7. **Medians, not minimums.** The headline is the median of all measured samples. Min, max, mean, standard deviation, coefficient of variation and MAD are all reported. Nothing is cherry-picked.
8. **Outliers are flagged, not removed.** Modified z-score > 3.5 (Iglewicz & Hoaglin) marks a sample as an outlier in RAW RESULTS. It still counts towards the median.
9. **A winner needs statistical significance.** Two-sided Mann–Whitney U (non-parametric, because timings have long right tails), with tie and continuity correction. If p ≥ 0.05 the battle is a **DRAW**. With fewer than 5 samples per side significance is unreachable by design.
10. **Idiomatic standard library, same algorithm.** Each implementation uses what an experienced developer would reach for first (`list.sort`, `slices.Sort`, `sort_unstable`, `Arrays.sort`, `JSON.parse`, `serde_json`, Jackson, …). No hand-tuned tricks, no native accelerators like numpy. Where the idiom differs (typed structs vs dynamic objects), that difference is part of what is measured and is explained in WHY?.
11. **Environment is always shown.** CPU model, core count, OS, container status, exact runtime versions and exact command lines are attached to every result.

## AI and graphics workloads

Machine-learning and image code usually runs on floating point, where different compilers and math libraries legitimately produce slightly different bits. To keep **bit-exact** verification, these battlegrounds use integer arithmetic throughout, the way quantised edge inference and classic image pipelines often do:
- **INFER:** an int8-quantised MLP with int32 accumulators, ReLU and requantisation by an integer shift. Every prediction and its winning logit are checked.
- **EMBED:** int8 embeddings scored by integer dot product. The top 10 ids and scores for every query are checked, with ties broken by document id.
- **PIXEL:** 8-bit grayscale conversion, a 3×3 Gaussian blur and Sobel edge detection, with edges clamped. The full 256-bin histogram is checked.

## Documented exceptions

Some languages need a small, disclosed deviation to take part honestly:

- **R:** the shared xorshift stream, checksums and the monotonic clock come from a C helper (`bench/r/clashhelpers.c`), because R has no unsigned 32-bit integers. None of it runs inside a timed region except the clock read. Every timed run is pure, vectorised R.
- **Lua:** the stdlib has no monotonic clock, so a 10-line C module provides one. JSON uses pure-Lua dkjson.
- **Zig:** the stdlib has no regex engine. The strings battle uses a hand-written matcher equivalent to the pattern, which is a structural advantage and is labelled as one in WHY?.
- **Erlang / Elixir:** BEAM data is immutable, so the sieve and the PIXEL histogram use `:atomics`, OTP's mutable integer array. Everything else is immutable lists, tuples, binaries and maps.
- **R (folds):** in METRICS and INFER the final `fold` over per-bucket maxima and per-sample predictions runs in the untimed check step, because `fold` lives in the C helper. Everything that produces those values is timed, pure R.
- **R and Julia (matrix form):** INFER and EMBED run as whole-batch matrix products (`%*%`/`crossprod` in R, `*` in Julia), the idiomatic form in both languages. The arithmetic is identical; R's BLAS works in doubles, which is exact because every value is far below 2^53.
- **C:** the standard library has no hash map, so CSV groups and the search index use a small open-addressed table.
- **Haskell:** compiled with `-fno-full-laziness` (standard for benchmarks: it stops GHC sharing a pure result across runs), and every timed result is forced with `evaluate`/`deepseq` inside the timer.
- **PHP:** `memory_limit` is lifted (`-d memory_limit=-1`). The php.ini default of 128 MB would OOM large inputs, and no other fighter has an artificial heap cap. OPcache/JIT stay off, which is the CLI default.
- **Ruby** runs with `--yjit`, Ruby's production JIT. **Java, Kotlin and Scala** share one OpenJDK.
- **JSON output keys are ASCII-sorted everywhere**, because several serialisers cannot preserve insertion order.

## Scores

Scores are relative and computed directly from measurements: the better fighter gets 10, the other gets `10 × best ÷ theirs`. Consistency uses the coefficient of variation with a 1% floor (below that is timer/scheduler noise). The battle winner is decided by performance plus the significance test only. Scores are context, never a verdict on a language.

## Known limitations

- **Peak RSS ≠ live data.** GC'd runtimes reserve heap ahead of need. The baseline probe helps, but per-allocation accounting would need language-specific tooling.
- **Single-threaded workloads only.** Concurrency would need per-language worker pools and pinned, dedicated cores to mean anything, so every battleground measures one thread.
- **In-memory data.** CSV and log text are generated in memory, so results reflect parsing and processing, not disk or page-cache behaviour.
- **One runtime version per worker.** The adapter layer supports multiple; the worker image currently pins one of each.
- **Noisy hosts produce noisy results.** On a laptop, background load and thermal throttling are real. The significance test and CV make this visible rather than hiding it. Production workers should run on dedicated cores (`cpuset`), with frequency scaling pinned where the host allows.
- **Default runtime flags.** No `-O`/`-Xmx`/`--max-old-space-size` tuning. This is "out of the box" performance.
