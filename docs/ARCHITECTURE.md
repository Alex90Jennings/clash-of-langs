# Architecture

```
Browser (Next.js app, Canvas visualisers)
   │  POST /api/battle  → text/event-stream of BattleEvent
   ▼
Next.js route handler (Vercel or local)
   │  BENCH_WORKER_URL set?  ── yes ─▶ proxy the stream to the worker (x-clashoflangs-token)
   │                          └ no, local dev ─▶ run the engine in-process
   ▼
Benchmark worker (worker/server.ts, Docker image worker/Dockerfile, dedicated host)
   │  engine: src/engine/battle.ts — exclusive lock, randomised order, startup probes, measurement
   ▼
Harness processes (bench/<lang>) — predefined code only, fixed argv, scrubbed env, timeout, own process group
   └─ wrapped by /usr/bin/time for peak RSS + CPU
```

## Why not Vercel alone?

Vercel functions can run Node, but not a JVM, a CPython with our harness, or arbitrary native binaries. Shared, multi-tenant serverless hardware with variable CPU allocation is also the wrong place for benchmarks. Vercel hosts the UI and the thin API. Execution happens on a worker we control. With no worker configured on Vercel, the API returns `503` and the UI says **ARENA OFFLINE**. It never substitutes canned numbers.

## Options considered for execution

| Option | Verdict |
| --- | --- |
| Browser / WebAssembly | Only measures each language's WASM build inside a JS engine, not its real runtime. Python-in-WASM (Pyodide) and Java-in-WASM tell you little about CPython or HotSpot. Rejected for credibility. |
| WASI runtimes | Same issue; also no JVM. |
| Serverless functions per language | Cold-start dominated, noisy neighbours, and the hardware differs per runtime. Rejected. |
| **One container image with every runtime, on a dedicated VM** | Same hardware and kernel for both fighters, pinned versions, simple. **Chosen.** |
| Firecracker / gVisor sandbox per battle | Best isolation; needed if user-submitted code is ever accepted. |

Recommended hosting: a small dedicated-CPU VM (Hetzner dedicated vCPU, Fly.io `performance` machines, AWS `c7g`/`c7i` on-demand) running `docker compose up -d worker`, with `cpuset` pinned to otherwise idle cores. Scale out by adding workers behind a queue. The engine already serialises battles per worker.

## Security model

- **No user code.** Only harnesses baked into the image execute. Requests carry a challenge id, two language ids and five integers. `parseConfig` whitelists and clamps all of them, and they become argv entries only. Nothing goes through a shell.
- **Process limits.** 180 s hard timeout per process; kill by process group (SIGKILL); 4 MB stdout cap; scrubbed environment (PATH, HOME=/tmp, LANG only).
- **Bounded work.** Size/run limits per challenge cap the worst case (e.g. sieve ≤ 100M, ≤ 30 runs). One battle at a time per worker; queue depth 3, then `arena busy`.
- **Container hardening** (`docker-compose.yml`): non-root user, read-only root FS, tmpfs `/tmp`, all capabilities dropped, `no-new-privileges`, PID and memory limits.
- **Worker auth.** Shared secret header (`CLASHOFLANGS_WORKER_TOKEN`), constant-time compare. The Next.js API is the only public entry point.
- **Still to add for public launch:** per-IP rate limiting at the edge (e.g. Vercel firewall / Upstash), egress firewall on the worker (harnesses never need network), and gVisor/Firecracker before accepting any user-provided code.

## Code map

| Path | Role |
| --- | --- |
| `src/lib/types.ts` | Isomorphic types: config, events, results |
| `src/lib/languages.ts` | `SUPPORTED_LANGUAGES` / `EXECUTABLE_LANGUAGES` (all 24 have harnesses; a worker must still report each runtime online) |
| `src/lib/implementations.ts` | Per-language implementation notes for the WHY? panel |
| `src/lib/challenges.ts` | The challenge contract + per-language implementation notes |
| `src/lib/config.ts` | Validation/clamping; URL ⇄ config |
| `src/lib/stats.ts`, `analysis.ts` | Descriptive stats, Mann–Whitney U, verification, scores |
| `src/lib/insights.ts` | Measurement → scoped prose (PERFORMANCE / MEMORY / STARTUP / WHY?) |
| `src/engine/*` | Server-only: runtime adapters, process measurement, orchestration |
| `src/server/backend.ts` | Chooses remote / local / offline |
| `src/visualizers/*` | Code-split canvas renderers, one per challenge |
| `bench/*` | 24 harnesses + `SPEC.md` + `build.sh` |
| `worker/*` | Standalone worker server + Dockerfile |

## Adding a language

1. Implement `bench/<lang>/…` following `bench/SPEC.md`.
2. Add a build step to `bench/build.sh` and `worker/Dockerfile`.
3. Add a `RuntimeAdapter` in `src/engine/runtimes.ts`.
4. Add the id to `EXECUTABLE_LANGUAGES` and implementation notes to each challenge in `src/lib/challenges.ts`.
5. `npm run bench:verify` must pass. The roster shows the language as READY as soon as a worker reports its runtime.

## Adding a challenge

Add it to `ChallengeId`, `CHALLENGES`, every harness, `bench/SPEC.md`, and a visualiser in `src/visualizers/`. The engine, stats, scoring, results UI and URLs need no changes.

## Shareable results

URLs already reproduce a battle exactly (`/battle/javascript-vs-go/csv?seed=…`). Persisting a `BattleResult` (KV/Postgres keyed by `result.id`) would give permalinks. `toCardData()` + `ResultCard` are pure, so an `opengraph-image.tsx` route can render the same card with `next/og`.

## Per-language notes (all 24 fighters)

| Language | How it runs | Non-stdlib dependency | Notes |
| --- | --- | --- | --- |
| C | `cc -O2` binary | cJSON | POSIX regex; open-addressing table for search (C has no hash map) |
| C++ | `clang++ -O2 -std=c++20` | nlohmann/json | `std::regex`, `std::unordered_map` |
| C# | `dotnet Harness.dll` (.NET 10, tiered JIT) | — | System.Text.Json |
| Kotlin / Scala / Java | one OpenJDK for all three | Jackson (Java, Kotlin), ujson (Scala) | |
| Swift | `swiftc -O` | — | Codable `.sortedKeys`, Swift Regex |
| PHP | `php` CLI (OPcache/JIT off — the CLI default) | — | |
| Ruby | Homebrew Ruby `--yjit` | — | |
| Dart | `dart compile exe` (AOT) | — | |
| Lua | PUC-Rio Lua 5.5 | dkjson | 10-line C module for a monotonic clock |
| Perl | system perl5 | — (JSON::PP is core) | |
| R | `Rscript` | jsonlite | Untimed xorshift/checksums/clock in a C helper (R lacks unsigned 32-bit ints) |
| Erlang / Elixir | `erl` / `elixir` on OTP 28 | — (stdlib `json` / `JSON`) | `:atomics` for the sieve |
| Haskell | `cabal build`, GHC `-O2 -fno-full-laziness` | aeson, regex-tdfa, vector(-algorithms) | timed results forced with `evaluate`/`deepseq` |
| OCaml | `ocamlfind ocamlopt` | yojson, mtime | Str for regex |
| Zig | `zig build-exe -O ReleaseFast` | — | no stdlib regex: hand-written matcher |
| Julia | `julia --project` | JSON3 | first-call JIT is visible in COLD mode |

JSON output keys are ASCII-sorted in every language because several serialisers (JSON::PP canonical, Swift `.sortedKeys`, nlohmann, BEAM maps) sort keys and cannot preserve insertion order.

`worker/Dockerfile` packages all 24 runtimes. Compilers live only in build stages (Go, Rust, Swift with a statically linked stdlib, Dart AOT, Zig, .NET, one JDK for Java/Kotlin/Scala, clang for C/C++, Debian's GHC and OCaml packages, Julia with a precompiled JSON3 depot). The runtime image holds interpreters and VMs from Debian trixie plus the prebuilt artefacts. Versions inside the container differ from a developer Mac (e.g. OpenJDK 21, GHC 9.6, OCaml 5.3, Lua 5.4, OTP 27). Every result records the exact version it ran on.
