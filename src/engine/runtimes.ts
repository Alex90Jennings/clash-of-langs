import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LanguageId, RuntimeInfo } from "../lib/types";

export const BENCH_DIR = process.env.CLASHOFLANGS_BENCH_DIR ?? path.resolve(/*turbopackIgnore: true*/ process.cwd(), "bench");

const pick = (envVar: string, candidates: string[], fallback: string) => process.env[envVar] ?? candidates.find((c) => existsSync(c)) ?? fallback;

const NODE = pick("CLASHOFLANGS_NODE", [], "node");
const PYTHON = pick("CLASHOFLANGS_PYTHON", [], "python3");
const JAVA = pick("CLASHOFLANGS_JAVA", ["/opt/homebrew/opt/openjdk/bin/java", "/opt/java/openjdk/bin/java"], "java");
const RUBY = pick("CLASHOFLANGS_RUBY", ["/opt/homebrew/opt/ruby/bin/ruby"], "ruby");

export interface RuntimeAdapter {
  lang: LanguageId;
  engine: string;
  cmd: string;
  args: string[];
  requires: string[];
  build: string | null;
  env?: Record<string, string>;
  version(): Promise<string | null>;
}

const bench = (...p: string[]) => path.join(/*turbopackIgnore: true*/ BENCH_DIR, ...p);

function run(cmd: string, args: string[], pickLine: (lines: string[]) => string | undefined = (l) => l[0]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15_000 }, (err, stdout, stderr) => {
      if (err) return resolve(null);
      const lines = `${stdout}\n${stderr}`.split("\n").map((l) => l.trim()).filter(Boolean);
      resolve(pickLine(lines) ?? null);
    });
  });
}

const versionFile = (...p: string[]) => async () => {
  try {
    return readFileSync(bench(...p), "utf8").trim() || null;
  } catch {
    return null;
  }
};

const nodeVersion = () => run(NODE, ["--version"]).then((v) => (v ? `Node.js ${v}` : null));
const javaVersion = () => run(JAVA, ["-version"], (l) => l.find((x) => / version /.test(x) && !/warning/i.test(x)));
const jvmClasspath = (...entries: string[]) => entries.join(path.delimiter);

const native = (lang: LanguageId, engine: string, dir: string, build: string): RuntimeAdapter => ({
  lang,
  engine,
  cmd: bench(dir, "bin", "harness"),
  args: [],
  requires: [bench(dir, "bin", "harness")],
  build: `${build} (ahead of time, excluded from timing)`,
  version: async () => (await versionFile(dir, "bin", "VERSION")()) ?? `${dir} (version unknown)`,
});

export const ADAPTERS: Record<string, RuntimeAdapter> = {
  javascript: { lang: "javascript", engine: "Node.js (V8)", cmd: NODE, args: [bench("js", "harness.mjs")], requires: [bench("js", "harness.mjs")], build: null, version: nodeVersion },
  typescript: {
    lang: "typescript",
    engine: "Node.js (V8), compiled by tsc",
    cmd: NODE,
    args: [bench("ts", "dist", "harness.js")],
    requires: [bench("ts", "dist", "harness.js")],
    build: "tsc -p bench/ts (ahead of time, excluded from timing)",
    async version() {
      const node = await nodeVersion();
      const tsc = await versionFile("ts", "dist", "VERSION")();
      return node ? `${tsc ?? "tsc"} → ${node}` : null;
    },
  },
  python: { lang: "python", engine: "CPython", cmd: PYTHON, args: [bench("python", "harness.py")], requires: [bench("python", "harness.py")], build: null, version: () => run(PYTHON, ["--version"]) },
  go: native("go", "Go (gc), native binary", "go", "go build"),
  rust: native("rust", "rustc / LLVM, native binary", "rust", "cargo build --release"),
  java: {
    lang: "java",
    engine: "HotSpot JVM",
    cmd: JAVA,
    args: ["-cp", jvmClasspath(bench("java", "out"), bench("java", "lib", "*")), "Harness"],
    requires: [bench("java", "out", "Harness.class")],
    build: "javac (ahead of time, excluded from timing); JVM startup + JIT are included where the mode says so",
    version: javaVersion,
  },
  c: native("c", "clang -O2, native binary", "c", "cc -O2"),
  cpp: native("cpp", "clang++ -O2, native binary", "cpp", "clang++ -O2 -std=c++20"),
  csharp: {
    lang: "csharp",
    engine: ".NET CoreCLR (RyuJIT, tiered)",
    cmd: "dotnet",
    args: [bench("csharp", "dist", "Harness.dll")],
    requires: [bench("csharp", "dist", "Harness.dll")],
    build: "dotnet publish -c Release (IL ahead of time; JIT at run time)",
    env: { DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" },
    version: () => run("dotnet", ["--list-runtimes"], (l) => l.filter((x) => x.startsWith("Microsoft.NETCore.App")).pop()?.split(" [")[0]?.replace("Microsoft.NETCore.App", ".NET")),
  },
  kotlin: {
    lang: "kotlin",
    engine: "HotSpot JVM",
    cmd: JAVA,
    args: ["-cp", jvmClasspath(bench("kotlin", "bin", "harness.jar"), bench("java", "lib", "*")), "HarnessKt"],
    requires: [bench("kotlin", "bin", "harness.jar")],
    build: "kotlinc (ahead of time, excluded from timing)",
    async version() {
      const k = await versionFile("kotlin", "bin", "VERSION")();
      const j = await javaVersion();
      return j ? `${k ?? "kotlinc"} → ${j}` : null;
    },
  },
  swift: native("swift", "swiftc -O, native binary", "swift", "swiftc -O"),
  php: { lang: "php", engine: "Zend Engine (CLI, JIT off)", cmd: "php", args: ["-d", "memory_limit=-1", bench("php", "harness.php")], requires: [bench("php", "harness.php")], build: null, version: () => run("php", ["-v"], (l) => l[0]?.replace(/\s*\(.*$/, "")) },
  ruby: { lang: "ruby", engine: "CRuby + YJIT", cmd: RUBY, args: ["--yjit", bench("ruby", "harness.rb")], requires: [bench("ruby", "harness.rb")], build: null, version: () => run(RUBY, ["--yjit", "-v"]) },
  dart: native("dart", "Dart AOT, native binary", "dart", "dart compile exe"),
  scala: {
    lang: "scala",
    engine: "HotSpot JVM",
    cmd: JAVA,
    args: ["-jar", bench("scala", "bin", "harness.jar")],
    requires: [bench("scala", "bin", "harness.jar")],
    build: "scala-cli package --assembly (ahead of time, excluded from timing)",
    async version() {
      const s = await versionFile("scala", "bin", "VERSION")();
      const j = await javaVersion();
      return j ? `${s ?? "scala"} → ${j}` : null;
    },
  },
  lua: { lang: "lua", engine: "PUC-Rio Lua interpreter", cmd: "lua", args: [bench("lua", "harness.lua")], requires: [bench("lua", "bin", "clashclock.so")], build: "cc clashclock.c (monotonic clock module only)", version: () => run("lua", ["-v"], (l) => l[0]?.split("  ")[0]) },
  perl: { lang: "perl", engine: "perl5 interpreter", cmd: "perl", args: [bench("perl", "harness.pl")], requires: [bench("perl", "harness.pl")], build: null, version: () => run("perl", ["-e", "print qq{Perl $^V}"]) },
  r: {
    lang: "r",
    engine: "GNU R (bytecode interpreter)",
    cmd: "Rscript",
    args: [bench("r", "harness.R")],
    requires: [bench("r", "clashhelpers.so")],
    build: "R CMD SHLIB clashhelpers.c (untimed RNG/clock helpers) + jsonlite",
    version: () => run("Rscript", ["--version"], (l) => l[0]?.replace(/^Rscript \(R\) version /, "R ").replace(/\s*\(.*$/, "")),
  },
  elixir: {
    lang: "elixir",
    engine: "BEAM (JIT)",
    cmd: "elixir",
    args: ["-pa", bench("elixir", "ebin"), "-e", "Harness.main(System.argv())"],
    requires: [bench("elixir", "ebin", "Elixir.Harness.beam")],
    build: "elixirc (ahead of time, excluded from timing)",
    version: () => run("elixir", ["--version"], (l) => l.find((x) => x.startsWith("Elixir"))),
  },
  erlang: {
    lang: "erlang",
    engine: "BEAM (JIT)",
    cmd: "erl",
    args: ["-noshell", "-pa", bench("erlang", "ebin"), "-run", "harness", "main"],
    requires: [bench("erlang", "ebin", "harness.beam")],
    build: "erlc (ahead of time, excluded from timing)",
    version: () => run("erl", ["-noshell", "-eval", 'io:format("Erlang/OTP ~s (erts ~s)~n", [erlang:system_info(otp_release), erlang:system_info(version)]), halt().']),
  },
  haskell: native("haskell", "GHC -O2, native binary", "haskell", "cabal build (ghc -O2 -fno-full-laziness)"),
  ocaml: native("ocaml", "ocamlopt, native binary", "ocaml", "ocamlfind ocamlopt"),
  zig: native("zig", "Zig ReleaseFast, native binary", "zig", "zig build-exe -O ReleaseFast"),
  julia: {
    lang: "julia",
    engine: "Julia (LLVM JIT)",
    cmd: "julia",
    args: [`--project=${bench("julia")}`, "--startup-file=no", bench("julia", "harness.jl")],
    requires: [bench("julia", "Manifest.toml")],
    build: "Pkg.instantiate (JSON3); methods JIT-compile at first call, inside the process",
    env: { JULIA_DEPOT_PATH: process.env.JULIA_DEPOT_PATH ?? path.join(os.homedir(), ".julia") },
    version: () => run("julia", ["--version"], (l) => l[0]?.replace("julia version", "Julia")),
  },
};

export async function probeRuntime(lang: LanguageId): Promise<RuntimeInfo> {
  const a = ADAPTERS[lang];
  if (!a) return { available: false, version: null, engine: "—", command: "—", build: null, reason: "no runtime adapter" };
  const command = [a.cmd, ...a.args].map((p) => p.replaceAll(BENCH_DIR, "bench")).join(" ");
  const missing = a.requires.find((f) => !existsSync(f));
  if (missing) {
    return { available: false, version: null, engine: a.engine, command, build: a.build, reason: `not built: ${path.relative(BENCH_DIR, missing)} (run npm run bench:build)` };
  }
  const version = await a.version();
  if (!version) return { available: false, version: null, engine: a.engine, command, build: a.build, reason: `runtime not found: ${a.cmd}` };
  return { available: true, version, engine: a.engine, command, build: a.build };
}
