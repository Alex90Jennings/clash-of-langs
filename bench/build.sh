#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"
JACKSON_VERSION=2.18.2

ok()   { printf '  \033[32m✓\033[0m %-11s %s\n' "$1" "$2"; }
skip() { printf '  \033[33m–\033[0m %-11s %s\n' "$1" "$2"; }
fail() { printf '  \033[31m✕\033[0m %-11s %s\n' "$1" "$2"; }
have() { command -v "$1" >/dev/null 2>&1; }

if [ "$(uname)" = "Darwin" ]; then
  export PATH="/usr/bin:$PATH"
  SDK="$(xcrun --show-sdk-path 2>/dev/null || true)"
fi
JAVA_HOME_COL="${CLASHOFLANGS_JAVA_HOME:-$( [ -d /opt/homebrew/opt/openjdk ] && echo /opt/homebrew/opt/openjdk || echo "${JAVA_HOME:-}")}"
JAVAC="${JAVA_HOME_COL:+$JAVA_HOME_COL/bin/}javac"

build() {
  local name=$1 tool=$2 fn=$3
  if ! have "$tool"; then skip "$name" "($tool not found)"; return; fi
  if out=$($fn 2>&1); then ok "$name" "$out"; else fail "$name" "$(echo "$out" | tail -3)"; fi
}

b_typescript() { "$ROOT/../node_modules/.bin/tsc" -p ts && echo "tsc $("$ROOT/../node_modules/.bin/tsc" --version | awk '{print $2}')" | tee ts/dist/VERSION; }
b_java() {
  mkdir -p java/lib java/out
  for a in core/jackson-core core/jackson-databind core/jackson-annotations; do
    jar="java/lib/${a#*/}-$JACKSON_VERSION.jar"
    [ -f "$jar" ] || curl -sfL -o "$jar" "https://repo1.maven.org/maven2/com/fasterxml/jackson/$a/$JACKSON_VERSION/${a#*/}-$JACKSON_VERSION.jar"
  done
  "$JAVAC" -encoding UTF-8 -nowarn -cp "java/lib/*" -d java/out java/Harness.java && "$JAVAC" -version 2>&1
}
b_go() { (cd go && mkdir -p bin && CGO_ENABLED=0 go build -trimpath -o bin/harness . && go version | awk '{print $3}' | tee bin/VERSION); }
b_rust() { (cd rust && cargo build --release --quiet && mkdir -p bin && cp target/release/harness bin/harness && rustc --version | awk '{print $1" "$2}' | tee bin/VERSION); }
b_c() {
  local inc lib; inc=$(brew --prefix cjson 2>/dev/null)/include; lib=$(brew --prefix cjson 2>/dev/null)/lib
  mkdir -p c/bin && cc -O2 -std=c17 -I"$inc" -I/usr/include c/harness.c -L"$lib" -lcjson -o c/bin/harness && cc --version | head -1 | tee c/bin/VERSION
}
b_cpp() { mkdir -p cpp/bin && clang++ -O2 -std=c++20 -I"$(brew --prefix nlohmann-json 2>/dev/null)/include" cpp/harness.cpp -o cpp/bin/harness && clang++ --version | head -1 | tee cpp/bin/VERSION; }
b_csharp() { (cd csharp && DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 dotnet publish -c Release -o dist -v quiet >/dev/null && echo "dotnet $(dotnet --version)"); }
b_kotlin() {
  local cp; cp=$(ls java/lib/*.jar | tr '\n' ':')
  mkdir -p kotlin/bin && JAVA_HOME="$JAVA_HOME_COL" kotlinc kotlin/Harness.kt -cp "$cp" -include-runtime -d kotlin/bin/harness.jar -jvm-target 21 -nowarn 2>&1 | grep -v "^warning" ; kotlinc -version 2>&1 | awk '/kotlinc/{print "kotlinc "$3}' | tee kotlin/bin/VERSION
}
b_scala() { mkdir -p scala/bin && JAVA_HOME="$JAVA_HOME_COL" scala --power package scala/Harness.scala --assembly -o scala/bin/harness.jar -f -q >/dev/null 2>&1 && echo "scala 3.9.0" | tee scala/bin/VERSION; }
b_swift() { mkdir -p swift/bin && swiftc -O swift/harness.swift -o swift/bin/harness && swiftc --version 2>&1 | grep -o "Swift version [0-9.]*" | tee swift/bin/VERSION; }
b_dart() { mkdir -p dart/bin && dart compile exe dart/harness.dart -o dart/bin/harness >/dev/null && dart --version 2>&1 | grep -o "Dart SDK version: [0-9.]*" | sed 's/SDK version: //' | tee dart/bin/VERSION; }
b_zig() { mkdir -p zig/bin && zig build-exe zig/harness.zig -O ReleaseFast -femit-bin=zig/bin/harness --cache-dir zig/.zig-cache && echo "zig $(zig version)" | tee zig/bin/VERSION; }
b_lua() {
  [ -f lua/rocks/share/lua/5.5/dkjson.lua ] || luarocks --tree lua/rocks install dkjson >/dev/null
  mkdir -p lua/bin && cc -O2 -bundle -undefined dynamic_lookup -I"$(brew --prefix lua 2>/dev/null)/include/lua5.5" -I/usr/include/lua5.4 lua/clashclock.c -o lua/bin/clashclock.so && lua -v
}
b_r() {
  (cd r && R CMD SHLIB -o clashhelpers.so clashhelpers.c >/dev/null && rm -f clashhelpers.o) &&
  { [ -d r/lib/jsonlite ] || { mkdir -p r/lib && Rscript -e 'install.packages("jsonlite", lib="r/lib", repos="https://cloud.r-project.org", quiet=TRUE)' >/dev/null; }; } &&
  Rscript --version 2>&1 | head -1
}
b_erlang() { mkdir -p erlang/ebin && erlc -o erlang/ebin erlang/harness.erl && echo "OTP $(erl -noshell -eval 'io:put_chars(erlang:system_info(otp_release)), halt().')"; }
b_elixir() { mkdir -p elixir/ebin && elixirc -o elixir/ebin elixir/harness.ex >/dev/null && elixir --version | grep Elixir; }
b_julia() { julia --project=julia --startup-file=no -e 'using Pkg; Pkg.instantiate()' >/dev/null && julia --version; }
b_ocaml() {
  local env; env=$(opam env --switch=clashoflangs 2>/dev/null) || true; eval "$env"
  mkdir -p ocaml/bin && (cd ocaml && ocamlfind ocamlopt -package yojson,str,mtime.clock -linkpkg harness.ml -o bin/harness && rm -f harness.cm* harness.o) && ocamlopt -version | sed 's/^/ocaml /' | tee ocaml/bin/VERSION
}
b_haskell() {
  (cd haskell && C_INCLUDE_PATH="${SDK:+$SDK/usr/include/ffi}" cabal build -v0 && mkdir -p bin && cp "$(cabal list-bin harness)" bin/harness) && ghc --numeric-version | sed 's/^/ghc /' | tee haskell/bin/VERSION
}

echo "clash-of-langs: building benchmark harnesses"
build typescript node b_typescript
build java "$JAVAC" b_java
build go go b_go
build rust cargo b_rust
build c cc b_c
build cpp clang++ b_cpp
build csharp dotnet b_csharp
build kotlin kotlinc b_kotlin
build scala scala b_scala
build swift swiftc b_swift
build dart dart b_dart
build zig zig b_zig
build lua lua b_lua
build r Rscript b_r
build erlang erlc b_erlang
build elixir elixirc b_elixir
build julia julia b_julia
build ocaml opam b_ocaml
build haskell cabal b_haskell
for interp in "javascript node --version" "python python3 --version" "ruby ruby -v" "php php -v" "perl perl -v"; do
  set -- $interp
  if have "$2"; then ok "$1" "(no build step)"; else skip "$1" "($2 not found)"; fi
done
