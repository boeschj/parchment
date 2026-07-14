// The three reference documents for the markup dialect: a live dashboard, an
// interactive form, and a prose+code report. They are the golden inputs for
// goldens.test.ts and the worked examples the skill reference teaches from —
// one source, so the docs can never drift from what the compiler actually does.

export const DASHBOARD_MARKUP = `<state>{
  "ci": [
    {"day": "Mon", "minutes": 41, "failures": 2},
    {"day": "Tue", "minutes": 36, "failures": 0},
    {"day": "Wed", "minutes": 52, "failures": 5},
    {"day": "Thu", "minutes": 33, "failures": 1},
    {"day": "Fri", "minutes": 29, "failures": 0}
  ]
}</state>

<section>
  <h1>CI health — last 5 days</h1>

  <div>
    <Metric label="p99 build" value="412ms" delta="-38%" trend="down" tone="success"/>
    <Metric label="Pipeline minutes" value="191" delta="+12%" trend="up" tone="warning"/>
    <Metric label="Failures" value="8" detail="3 flaky, 5 real"/>
  </div>

  <Chart kind="bar" data="$state.ci" x="day" y="minutes" title="Pipeline minutes per day" height="280"/>

  <Callout tone="warning" title="Wednesday regression">
    The cache step missed on Wednesday and added 19 minutes.
    Re-run the pipeline with \`--no-cache\` to reproduce.
  </Callout>

  <table>
    <caption>Slowest jobs</caption>
    <thead>
      <tr><th>Job</th><th>p99 ms</th><th>Calls</th></tr>
    </thead>
    <tbody>
      <tr><td>bundle</td><td>1240</td><td>842</td></tr>
      <tr><td>typecheck</td><td>980</td><td>510</td></tr>
      <tr><td>unit tests</td><td>612</td><td>320</td></tr>
    </tbody>
  </table>

  <button intent="rerun-pipeline" intent-params='{"pipeline":"ci","cache":false}'>Re-run without cache</button>
</section>`;

export const SIGNUP_FORM_MARKUP = `<state>{"form": {"name": "", "email": "", "password": "", "plan": "Starter"}}</state>

<form title="Create your account" description="Takes about a minute.">
  <input label="Name" name="name" bind="/form/name" required/>
  <input label="Email" name="email" type="email" bind="/form/email" required/>
  <input label="Password" name="password" type="password" bind="/form/password" required minlength="8"/>

  <select label="Plan" name="plan" bind="/form/plan">
    <option>Starter</option>
    <option>Team</option>
    <option>Enterprise</option>
  </select>

  <p>By signing up you agree to the <a href="https://example.com/terms">terms of service</a>.</p>

  <button submit="signup" variant="primary">Sign up</button>
</form>`;

// The ladder's whole argument in one document. Every heavy element here NAMES a
// file instead of pasting it: the diff, the excerpt, the benchmark table, the
// chart, and the log tail together cost a few dozen output tokens, where pasting
// their contents would cost tens of thousands. This is the shape the dialect
// exists to make reachable.
export const REFERENCE_REVIEW_MARKUP = `<section>
  <h1>Cache fix — review</h1>

  <p>The TTL now tracks the sync interval. One file changed.</p>

  <GitDiff file="src/api/cache.ts" base="HEAD~1"/>

  <h2>The hot path it touches</h2>

  <CodeBlock file="src/api/cache.ts" lines="40-80"/>

  <h2>Benchmark</h2>

  <DataTable src="bench/results.csv"/>

  <Chart src="bench/results.csv" kind="line" x="run" y="p99_ms" title="p99 across runs" height="260"/>

  <h2>Live</h2>

  <LogStream file="logs/app.log" watch/>

  <button intent="merge-pr" intent-params='{"pr":412}'>Merge</button>
</section>`;

export const MIXED_REPORT_MARKUP = `<article>
  <h1>Why the invoice cache kept missing</h1>

  <p>
    The TTL was <strong>30 seconds</strong> while the upstream sync runs every
    <strong>5 minutes</strong>, so the cache was cold for most of every window.
    The fix lives in <code>src/api/cache.ts</code>.
  </p>

  <h2>What happens today</h2>

  <ul>
    <li>The first request after a sync repopulates the key.</li>
    <li>Every request 30s later misses again and hits Postgres.</li>
    <li>Postgres sees ~8x the read volume it should.</li>
  </ul>

  <CodeBlock language="typescript" title="src/api/cache.ts" highlightLines="[2]">
    export async function getCached(key: string): Promise&lt;string | null&gt; {
      const hit = await redis.get(key, { ttl: THIRTY_SECONDS });
      if (hit !== null) return hit;
      return fetchAndCache(key);
    }
  </CodeBlock>

  <Callout tone="tip" title="The one-line fix">
    Set the TTL to the sync interval, not to a guess: \`ttl: FIVE_MINUTES\`.
  </Callout>

  <h2>Verification</h2>

  <Terminal command="bun test src/api" cwd="~/parchment" exitCode="0">
    ✓ cache.test.ts (12 tests) 84ms
    ✓ routes.test.ts (9 tests) 112ms

    21 pass, 0 fail (196ms)
  </Terminal>

  <hr>

  <p>Full write-up and the PR are linked below.</p>

  <a href="https://example.com/pr/412">Open PR #412</a>
</article>`;
