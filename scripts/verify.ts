import { execFileSync } from "node:child_process";
import { CHALLENGES } from "../src/lib/challenges";
import { EXECUTABLE_LANGUAGES } from "../src/lib/languages";
import { ADAPTERS, BENCH_DIR, probeRuntime } from "../src/engine/runtimes";

const SEEDS = [1, 48291, 2147483647];

async function main() {
  const only = process.argv.slice(2);
  const challengeFilter = only.filter((x) => CHALLENGES.some((c) => c.id === x));
  const langFilter = only.filter((x) => !challengeFilter.includes(x));
  const langs = langFilter.length ? EXECUTABLE_LANGUAGES.filter((l) => l === "javascript" || langFilter.includes(l)) : EXECUTABLE_LANGUAGES;
  const challenges = challengeFilter.length ? CHALLENGES.filter((c) => challengeFilter.includes(c.id)) : CHALLENGES;
  const online: string[] = [];
  for (const l of langs) {
    const rt = await probeRuntime(l);
    if (rt.available) online.push(l);
    else console.log(`  – ${l.padEnd(11)} skipped (${rt.reason})`);
  }
  let failures = 0;
  for (const c of challenges) {
    for (const seed of SEEDS) {
      for (const size of c.verifySizes) {
        const results = online.map((l) => {
          const a = ADAPTERS[l];
          const out = execFileSync(a.cmd, [...a.args, c.id, String(size), String(seed), "0", "2"], { cwd: BENCH_DIR, encoding: "utf8", env: { ...process.env, ...a.env } });
          const lines = out.trim().split("\n").map((x) => JSON.parse(x));
          const ready = lines.find((x) => x.e === "ready");
          const checks = new Set(lines.filter((x) => x.e === "run").map((x) => x.check));
          return { l, input: ready?.input, check: checks.size === 1 ? [...checks][0] : `unstable:${[...checks]}` };
        });
        const ok = results.every((r) => r.input === results[0].input && r.check === results[0].check);
        if (!ok) failures++;
        console.log(`${ok ? "  ✓" : "  ✕"} ${c.id.padEnd(8)} seed=${String(seed).padEnd(10)} size=${String(size).padEnd(7)} ${ok ? `${results[0].input} → ${results[0].check}` : results.map((r) => `${r.l}:${r.input}/${r.check}`).join(" ")}`);
      }
    }
  }
  console.log(failures ? `\n${failures} mismatches` : `\nall ${online.length} runtimes agree on every challenge`);
  process.exit(failures ? 1 : 0);
}

void main();
