import type { LanguageId } from "./types";

export type ExecutionModel = "JIT" | "AOT native" | "Bytecode VM" | "Interpreter" | "Bytecode VM + JIT" | "Interpreter + JIT";

export interface LanguageMeta {
  id: LanguageId;
  name: string;
  glyph: string;
  color: string;
  runtime: string;
  execution: ExecutionModel;
  typing: string;
  memory: string;
  year: number;
  tagline: string;
}

export const SUPPORTED_LANGUAGES: LanguageMeta[] = [
  { id: "javascript", name: "JavaScript", glyph: "JS", color: "#f7df1e", runtime: "Node.js · V8", execution: "JIT", typing: "dynamic", memory: "generational GC", year: 1995, tagline: "Tiered JIT, ships everywhere" },
  { id: "typescript", name: "TypeScript", glyph: "TS", color: "#3b8eea", runtime: "tsc → Node.js · V8", execution: "JIT", typing: "static (erased)", memory: "generational GC", year: 2012, tagline: "Types at build time, JavaScript at run time" },
  { id: "python", name: "Python", glyph: "PY", color: "#4b8bbe", runtime: "CPython", execution: "Interpreter", typing: "dynamic", memory: "refcount + cycle GC", year: 1991, tagline: "Batteries included, C under the hood" },
  { id: "go", name: "Go", glyph: "GO", color: "#00add8", runtime: "gc toolchain", execution: "AOT native", typing: "static", memory: "concurrent GC", year: 2009, tagline: "Simple, fast compile, goroutines" },
  { id: "rust", name: "Rust", glyph: "RS", color: "#f74c00", runtime: "rustc · LLVM", execution: "AOT native", typing: "static", memory: "ownership, no GC", year: 2015, tagline: "Zero-cost abstractions, no GC" },
  { id: "java", name: "Java", glyph: "JV", color: "#e76f00", runtime: "HotSpot JVM", execution: "Bytecode VM + JIT", typing: "static", memory: "generational GC", year: 1995, tagline: "Decades of JIT engineering" },
  { id: "c", name: "C", glyph: "C", color: "#c3d2e3", runtime: "clang -O2", execution: "AOT native", typing: "static", memory: "manual", year: 1972, tagline: "Portable assembly" },
  { id: "cpp", name: "C++", glyph: "C++", color: "#659ad2", runtime: "clang++ -O2", execution: "AOT native", typing: "static", memory: "RAII", year: 1985, tagline: "Abstractions without (much) overhead" },
  { id: "csharp", name: "C#", glyph: "C#", color: "#c977c2", runtime: ".NET CoreCLR", execution: "Bytecode VM + JIT", typing: "static", memory: "generational GC", year: 2000, tagline: "RyuJIT and value types" },
  { id: "kotlin", name: "Kotlin", glyph: "KT", color: "#a97bff", runtime: "Kotlin/JVM · HotSpot", execution: "Bytecode VM + JIT", typing: "static", memory: "generational GC", year: 2011, tagline: "Modern syntax on the JVM" },
  { id: "swift", name: "Swift", glyph: "SW", color: "#f05138", runtime: "swiftc · LLVM", execution: "AOT native", typing: "static", memory: "ARC", year: 2014, tagline: "Native with reference counting" },
  { id: "php", name: "PHP", glyph: "PHP", color: "#a3a7e6", runtime: "Zend Engine (JIT off)", execution: "Interpreter", typing: "dynamic", memory: "refcount + cycle GC", year: 1995, tagline: "Powers a large slice of the web" },
  { id: "ruby", name: "Ruby", glyph: "RB", color: "#cc342d", runtime: "CRuby · YJIT", execution: "Interpreter + JIT", typing: "dynamic", memory: "generational GC", year: 1995, tagline: "Optimised for developer happiness" },
  { id: "dart", name: "Dart", glyph: "DT", color: "#33a9f2", runtime: "Dart AOT", execution: "AOT native", typing: "static", memory: "generational GC", year: 2011, tagline: "Flutter's engine room" },
  { id: "scala", name: "Scala", glyph: "SC", color: "#dc322f", runtime: "Scala 3 · HotSpot", execution: "Bytecode VM + JIT", typing: "static", memory: "generational GC", year: 2004, tagline: "Functional meets JVM" },
  { id: "lua", name: "Lua", glyph: "LUA", color: "#7f95ff", runtime: "PUC-Rio Lua 5.5", execution: "Interpreter", typing: "dynamic", memory: "incremental GC", year: 1993, tagline: "Tiny, embeddable, quick" },
  { id: "perl", name: "Perl", glyph: "PL", color: "#8c9be8", runtime: "perl5", execution: "Interpreter", typing: "dynamic", memory: "refcount", year: 1987, tagline: "The original text cruncher" },
  { id: "r", name: "R", glyph: "R", color: "#4fa3f0", runtime: "GNU R", execution: "Interpreter", typing: "dynamic", memory: "GC", year: 1993, tagline: "Vectorised statistics" },
  { id: "elixir", name: "Elixir", glyph: "EX", color: "#b585d6", runtime: "BEAM", execution: "Bytecode VM + JIT", typing: "dynamic", memory: "per-process GC", year: 2012, tagline: "Fault-tolerant concurrency" },
  { id: "erlang", name: "Erlang", glyph: "ERL", color: "#ef4a6c", runtime: "BEAM", execution: "Bytecode VM + JIT", typing: "dynamic", memory: "per-process GC", year: 1986, tagline: "Let it crash" },
  { id: "haskell", name: "Haskell", glyph: "HS", color: "#cf86ca", runtime: "GHC", execution: "AOT native", typing: "static", memory: "generational GC", year: 1990, tagline: "Lazy, pure, compiled" },
  { id: "ocaml", name: "OCaml", glyph: "ML", color: "#ee6a1a", runtime: "ocamlopt", execution: "AOT native", typing: "static", memory: "generational GC", year: 1996, tagline: "Fast functional native code" },
  { id: "zig", name: "Zig", glyph: "ZIG", color: "#f7a41d", runtime: "zig · LLVM", execution: "AOT native", typing: "static", memory: "manual (allocators)", year: 2016, tagline: "No hidden control flow" },
  { id: "julia", name: "Julia", glyph: "JL", color: "#9558b2", runtime: "Julia · LLVM", execution: "JIT", typing: "dynamic", memory: "generational GC", year: 2012, tagline: "JIT-compiled numerics" },
];

export const EXECUTABLE_LANGUAGES: readonly LanguageId[] = SUPPORTED_LANGUAGES.map((l) => l.id);

const byId = new Map(SUPPORTED_LANGUAGES.map((l) => [l.id, l]));

export function getLanguage(id: string): LanguageMeta | undefined {
  return byId.get(id as LanguageId);
}

export function isExecutable(id: string): id is LanguageId {
  return (EXECUTABLE_LANGUAGES as readonly string[]).includes(id);
}
