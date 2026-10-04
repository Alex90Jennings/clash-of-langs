import { CHALLENGES } from "@/lib/challenges";
import { EXECUTABLE_LANGUAGES, getLanguage } from "@/lib/languages";

export function MethodologyContent() {
  return (
    <article className="prose">
      <h1 className="display glow" style={{ fontSize: 48 }}>
        HOW THE FIGHTS ARE JUDGED
      </h1>
      <p className="muted">Fun first, but nothing on this site is simulated. Here is exactly what happens when you press INITIATE BATTLE.</p>

      <h2>1 · identical inputs, proven</h2>
      <p>
        Every fighter regenerates its input from the same seed using the same xorshift32 generator, then reports a hash of what it built. If the two hashes differ, the battle is void. Data generation happens before the clock starts.
      </p>

      <h2>2 · identical work, proven</h2>
      <p>Every measured run checksums its output. All runs must agree, and both fighters must agree with each other. An implementation that skips work cannot win, because it cannot produce the right checksum.</p>

      <h2>3 · cold start vs warm runtime</h2>
      <ul>
        <li>
          <strong className="glow">WARM</strong>: one process, discarded warm-up runs so JITs (V8, HotSpot) can optimise, then timed runs. Startup is reported but excluded.
        </li>
        <li>
          <strong className="glow">COLD</strong>: a fresh process per sample, timing runtime boot plus the first unwarmed run. Interpreters and AOT binaries often shine here.
        </li>
        <li>Compilation (go build, cargo build, javac, tsc) always happens ahead of time and is excluded for everyone.</li>
      </ul>

      <h2>4 · no shared CPUs, no favourites</h2>
      <p>One battle runs per worker at a time. Fighters run one after the other, never together, in a random order each battle.</p>

      <h2>5 · statistics, not anecdotes</h2>
      <ul>
        <li>The headline is the median of every measured run. Never the fastest.</li>
        <li>min, max, mean, σ, coefficient of variation and MAD are in RAW RESULTS.</li>
        <li>Outliers (modified z-score &gt; 3.5) are flagged and kept.</li>
        <li>A winner is only declared when a two-sided Mann–Whitney U test gives p &lt; 0.05. Otherwise it is a draw.</li>
      </ul>

      <h2>6 · memory &amp; cpu</h2>
      <p>
        Peak RSS and CPU time come from the operating system (wait4 rusage via /usr/bin/time), the same way for every language. Peak RSS includes the runtime itself, so a minimum-size probe reports each runtime&apos;s baseline alongside it.
      </p>

      <h2>7 · scoped conclusions</h2>
      <p>
        Every result applies to one workload, one implementation, one runtime version, one machine and one run. Nowhere does the site say a language is &ldquo;better&rdquo;. It shows what happened here, and why that might be.
      </p>

      <h2>the battlegrounds</h2>
      <p>
        Every battleground is a job real software does: parsing JSON and CSV, crunching logs and metrics, running a quantised neural network, ranking embeddings for retrieval, and filtering images. AI and graphics workloads use integer arithmetic throughout, so every fighter&apos;s predictions, rankings and histograms can be checked bit for bit, not just &ldquo;close enough&rdquo;.
      </p>

      <h2>implementations</h2>
      <p className="muted">Idiomatic standard library, same algorithm, no native accelerators. Source lives in /bench, and the contract is in bench/SPEC.md.</p>
      <div className="table-wrap">
        <table className="raw-table">
          <thead>
            <tr>
              <th>fighter</th>
              {CHALLENGES.map((c) => (
                <th key={c.id}>{c.codename}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {EXECUTABLE_LANGUAGES.map((l) => (
              <tr key={l}>
                <td style={{ color: getLanguage(l)?.color }}>{getLanguage(l)?.name}</td>
                {CHALLENGES.map((c) => (
                  <td key={c.id} style={{ whiteSpace: "normal", textAlign: "left", fontSize: 10, minWidth: 110 }}>
                    {c.implementations[l]?.api}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
