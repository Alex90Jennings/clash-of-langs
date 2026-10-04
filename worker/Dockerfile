ARG DEBIAN=trixie

FROM golang:1.25-trixie AS go
WORKDIR /src
COPY bench/go/ .
RUN CGO_ENABLED=0 go build -trimpath -o /out/harness . && go version | awk '{print $3}' > /out/VERSION

FROM rust:1-trixie AS rust
WORKDIR /src
COPY bench/rust/Cargo.toml bench/rust/Cargo.lock ./
COPY bench/rust/src ./src
RUN cargo build --release --locked && mkdir /out && cp target/release/harness /out/ \
 && rustc --version | awk '{print $1" "$2}' > /out/VERSION

FROM swift:6.1-bookworm AS swift
WORKDIR /src
COPY bench/swift/harness.swift .
RUN mkdir /out && swiftc -O -static-stdlib harness.swift -o /out/harness \
 && swiftc --version 2>&1 | grep -o "Swift version [0-9.]*" > /out/VERSION

FROM dart:stable AS dart
WORKDIR /src
COPY bench/dart/harness.dart .
RUN mkdir /out && dart compile exe harness.dart -o /out/harness \
 && dart --version 2>&1 | grep -o "Dart SDK version: [0-9.]*" | sed 's/SDK version: //' > /out/VERSION

FROM debian:${DEBIAN}-slim AS zig
ARG TARGETARCH
ARG ZIG=0.16.0
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils && rm -rf /var/lib/apt/lists/*
RUN arch=$([ "$TARGETARCH" = "arm64" ] && echo aarch64 || echo x86_64) \
 && curl -fsSL "https://ziglang.org/download/${ZIG}/zig-${arch}-linux-${ZIG}.tar.xz" | tar -xJ -C /opt \
 && ln -s /opt/zig-${arch}-linux-${ZIG}/zig /usr/local/bin/zig
WORKDIR /src
COPY bench/zig/harness.zig .
RUN mkdir /out && zig build-exe harness.zig -O ReleaseFast -femit-bin=/out/harness --cache-dir /tmp/zc \
 && echo "zig $(zig version)" > /out/VERSION

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS dotnet
WORKDIR /src
COPY bench/csharp/Harness.csproj bench/csharp/Program.cs ./
RUN DOTNET_CLI_TELEMETRY_OPTOUT=1 dotnet publish -c Release -o /out
FROM mcr.microsoft.com/dotnet/runtime:10.0 AS dotnet-runtime

FROM debian:${DEBIAN}-slim AS jvm
ARG TARGETARCH
ARG JACKSON=2.18.2
ARG KOTLIN=2.4.20
ARG SCALA_CLI=1.17.1
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-21-jdk-headless ca-certificates curl unzip gzip && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN mkdir -p java/lib && for a in jackson-core jackson-databind jackson-annotations; do \
      curl -fsSL -o java/lib/$a-${JACKSON}.jar "https://repo1.maven.org/maven2/com/fasterxml/jackson/core/$a/${JACKSON}/$a-${JACKSON}.jar"; done
COPY bench/java/Harness.java java/
RUN javac -encoding UTF-8 -nowarn -cp 'java/lib/*' -d java/out java/Harness.java
RUN curl -fsSL -o /tmp/kotlin.zip "https://github.com/JetBrains/kotlin/releases/download/v${KOTLIN}/kotlin-compiler-${KOTLIN}.zip" \
 && unzip -q /tmp/kotlin.zip -d /opt && rm /tmp/kotlin.zip
COPY bench/kotlin/Harness.kt kotlin/
RUN mkdir -p kotlin/bin && /opt/kotlinc/bin/kotlinc kotlin/Harness.kt -cp "$(ls java/lib/*.jar | tr '\n' ':')" -include-runtime -d kotlin/bin/harness.jar -jvm-target 21 -nowarn \
 && echo "kotlinc ${KOTLIN}" > kotlin/bin/VERSION
RUN arch=$([ "$TARGETARCH" = "arm64" ] && echo aarch64 || echo x86_64) \
 && curl -fsSL "https://github.com/VirtusLab/scala-cli/releases/download/v${SCALA_CLI}/scala-cli-${arch}-pc-linux.gz" | gunzip > /usr/local/bin/scala-cli \
 && chmod +x /usr/local/bin/scala-cli
COPY bench/scala/Harness.scala scala/
RUN mkdir -p scala/bin && scala-cli --power package scala/Harness.scala --assembly -o scala/bin/harness.jar -f --server=false \
 && echo "scala $(sed -n 's#^//> using scala ##p' scala/Harness.scala)" > scala/bin/VERSION

FROM debian:${DEBIAN}-slim AS native
RUN apt-get update && apt-get install -y --no-install-recommends clang libcjson-dev nlohmann-json3-dev liblua5.4-dev r-base-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY bench/c/harness.c c/
COPY bench/cpp/harness.cpp cpp/
COPY bench/lua/clashclock.c lua/
COPY bench/r/clashhelpers.c r/
RUN mkdir -p c/bin cpp/bin lua/bin \
 && clang -O2 -std=c17 c/harness.c -lcjson -o c/bin/harness && clang --version | head -1 > c/bin/VERSION \
 && clang++ -O2 -std=c++20 cpp/harness.cpp -o cpp/bin/harness && clang++ --version | head -1 > cpp/bin/VERSION \
 && clang -O2 -shared -fPIC -I/usr/include/lua5.4 lua/clashclock.c -o lua/bin/clashclock.so \
 && cd r && R CMD SHLIB -o clashhelpers.so clashhelpers.c

FROM debian:${DEBIAN}-slim AS haskell
RUN apt-get update && apt-get install -y --no-install-recommends ghc libghc-aeson-dev libghc-regex-tdfa-dev libghc-vector-dev libghc-vector-algorithms-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY bench/haskell/Main.hs .
RUN mkdir /out && ghc -O2 -fno-full-laziness -rtsopts Main.hs -o /out/harness -outputdir /tmp/hs \
 && echo "ghc $(ghc --numeric-version)" > /out/VERSION

FROM debian:${DEBIAN}-slim AS ocaml
RUN apt-get update && apt-get install -y --no-install-recommends ocaml ocaml-findlib libyojson-ocaml-dev libmtime-ocaml-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY bench/ocaml/harness.ml .
RUN mkdir /out && clock=$(ocamlfind list 2>/dev/null | awk '/^mtime.clock(.os)? /{print $1; exit}') \
 && ocamlfind ocamlopt -package "yojson,str,${clock}" -linkpkg harness.ml -o /out/harness \
 && echo "ocaml $(ocamlopt -version)" > /out/VERSION

FROM julia:1.12 AS julia
ENV JULIA_DEPOT_PATH=/opt/julia-depot
WORKDIR /bench/julia
COPY bench/julia/Project.toml bench/julia/Manifest.toml ./
RUN julia --project=. -e 'using Pkg; Pkg.instantiate(); Pkg.precompile(); using JSON3'

FROM ruby:3.4-slim-${DEBIAN} AS ruby

FROM node:22-bookworm-slim AS node
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY bench/ts bench/ts
COPY src src
COPY worker worker
COPY scripts scripts
RUN npx tsc -p bench/ts && echo "tsc $(npx tsc --version | awk '{print $2}')" > bench/ts/dist/VERSION \
 && npx esbuild worker/server.ts --bundle --platform=node --format=esm --target=node20 --outfile=dist/worker.mjs \
 && npx esbuild scripts/verify.ts --bundle --platform=node --format=esm --target=node20 --outfile=dist/verify.mjs

FROM debian:${DEBIAN}-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      time ca-certificates nodejs python3 php-cli perl lua5.4 lua-dkjson \
      r-base-core r-cran-jsonlite erlang-nox elixir openjdk-21-jre-headless \
      libcjson1 libgmp10 libffi8 libnuma1 \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home /tmp --shell /usr/sbin/nologin clashoflangs
COPY --from=ruby /usr/local/bin/ruby /usr/local/bin/ruby
COPY --from=ruby /usr/local/lib/libruby.so.3.4 /usr/local/lib/libruby.so.3.4.11 /usr/local/lib/
COPY --from=ruby /usr/local/lib/ruby /usr/local/lib/ruby
COPY --from=dotnet-runtime /usr/share/dotnet /usr/share/dotnet
COPY --from=julia /usr/local/julia /usr/local/julia
COPY --from=julia /opt/julia-depot /opt/julia-depot
RUN ln -s /usr/share/dotnet/dotnet /usr/local/bin/dotnet && ln -s /usr/local/julia/bin/julia /usr/local/bin/julia && ldconfig
ENV JULIA_DEPOT_PATH=/tmp/julia:/opt/julia-depot \
    CLASHOFLANGS_BENCH_DIR=/app/bench PORT=8787 NODE_ENV=production PYTHONDONTWRITEBYTECODE=1 \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1

WORKDIR /app
COPY --from=node /app/dist dist
COPY bench/js bench/js
COPY bench/python bench/python
COPY bench/php bench/php
COPY bench/ruby bench/ruby
COPY bench/perl bench/perl
COPY bench/lua/harness.lua bench/lua/
COPY bench/r/harness.R bench/r/
COPY bench/julia/harness.jl bench/julia/Project.toml bench/julia/Manifest.toml bench/julia/
COPY bench/erlang/harness.erl bench/erlang/
COPY bench/elixir/harness.ex bench/elixir/
COPY bench/ts/package.json bench/ts/package.json
COPY --from=node /app/bench/ts/dist bench/ts/dist
COPY --from=go /out bench/go/bin
COPY --from=rust /out bench/rust/bin
COPY --from=swift /out bench/swift/bin
COPY --from=dart /out bench/dart/bin
COPY --from=zig /out bench/zig/bin
COPY --from=dotnet /out bench/csharp/dist
COPY --from=jvm /src/java/out bench/java/out
COPY --from=jvm /src/java/lib bench/java/lib
COPY --from=jvm /src/kotlin/bin bench/kotlin/bin
COPY --from=jvm /src/scala/bin bench/scala/bin
COPY --from=native /src/c/bin bench/c/bin
COPY --from=native /src/cpp/bin bench/cpp/bin
COPY --from=native /src/lua/bin bench/lua/bin
COPY --from=native /src/r/clashhelpers.so bench/r/
COPY --from=haskell /out bench/haskell/bin
COPY --from=ocaml /out bench/ocaml/bin
RUN mkdir -p bench/erlang/ebin bench/elixir/ebin \
 && erlc -o bench/erlang/ebin bench/erlang/harness.erl \
 && elixirc -o bench/elixir/ebin bench/elixir/harness.ex >/dev/null

USER clashoflangs
EXPOSE 8787
CMD ["node", "dist/worker.mjs"]
