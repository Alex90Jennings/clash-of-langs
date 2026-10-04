# Contributing to Clash of Langs

Thanks for your interest! Clash of Langs only works if people trust its numbers, so contributions are judged first on **fairness** and **correctness**, then on everything else.

## Ways to help

- **Improve an implementation.** If a language loses because its harness isn't idiomatic, that's a bug. Open a PR with the better version and explain why it's what an experienced developer would write.
- **Add a language** (see below).
- **Add a challenge.** This is a bigger job, because it has to be implemented in all 24 languages.
- **Report bugs, polish the UI, improve the docs.**

For anything larger than a small fix, please [open an issue](https://github.com/Alex90Jennings/clash-of-langs/issues/new/choose) first so we can agree on the approach.

## Development setup

```bash
npm install
npm run bench:build    # builds harnesses for the toolchains you have
npm run bench:verify   # all available runtimes must agree
npm run dev
```

You don't need all 24 toolchains locally. To check every language, use the Docker worker:

```bash
docker compose run --rm worker node dist/verify.mjs
```

## Fairness rules (non-negotiable)

These are summarised from [`docs/BENCHMARKING.md`](docs/BENCHMARKING.md):

1. **Same algorithm, idiomatic standard library.** Use what an experienced developer would reach for first. No hand-tuned tricks in one language while the others stay naive, and no native accelerators like numpy.
2. **Identical input and output.** Every harness regenerates input from the shared xorshift32 seed and must produce the same checksum. `npm run bench:verify` enforces this.
3. **Only the `run` step is timed.** Input generation, per-run copies and checksumming happen outside the timer.
4. **Disclose deviations.** If a language needs an exception (as R and Lua do for their C helpers), document it in `docs/BENCHMARKING.md` under *Documented exceptions*.

## Adding a language

1. Implement `bench/<lang>/…` following the harness contract in [`bench/SPEC.md`](bench/SPEC.md).
2. Add a build step to `bench/build.sh` and to `worker/Dockerfile`, with a pinned version.
3. Add a `RuntimeAdapter` in `src/engine/runtimes.ts`.
4. Add the id to `EXECUTABLE_LANGUAGES` in `src/lib/languages.ts`, and implementation notes for each challenge in `src/lib/challenges.ts`.
5. Run `npm run bench:verify`. It must pass.

## Adding a challenge

Add it to `ChallengeId` and `CHALLENGES`, to **every** harness, to `bench/SPEC.md`, and add a visualiser in `src/visualizers/`. The engine, stats, scoring, results UI and URLs need no changes.

## Pull request checklist

- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] `npm run bench:verify` passes for every language you touched (CI doesn't run it, because CI has no toolchains)
- [ ] If you changed a harness, the PR says which runtimes you verified with and on what OS
- [ ] Any new fairness exception is documented in `docs/BENCHMARKING.md`

## Style

- TypeScript is strict. Keep `npm run typecheck` clean.
- Match the style of the surrounding code in each language's harness.
- Keep PRs focused: one language or one concern per PR makes review much faster.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
