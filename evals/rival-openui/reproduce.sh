#!/usr/bin/env bash
#
# Verifies OpenUI Lang's published token-efficiency benchmark, then re-runs it with
# exactly ONE change: the competitor (Thesys C1 JSON) is minified instead of
# pretty-printed with a 2-space indent.
#
#   Table A — as published : reproduces benchmarks/README.md verbatim
#   Table B — fair fight   : identical, minus the competitor's 2-space indent
#
# No model API key. No network beyond the git clone. OpenUI's own harness, own
# token counter (tiktoken, encoding_for_model("gpt-5")), own committed samples.
#
# Usage: ./reproduce.sh [workdir]
#
set -euo pipefail

REPO_URL="https://github.com/thesysdev/openui.git"
COMMIT="69c8aae73be0129eb776cfa9016d790e2ba77ded"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKDIR="${1:-${TMPDIR:-/tmp}/openui-verify}"
REPO="$WORKDIR/openui"

# ---------------------------------------------------------------------------
# 1. Fetch their repo at a pinned commit.
# ---------------------------------------------------------------------------
if [ ! -d "$REPO/.git" ]; then
  echo "==> Fetching $REPO_URL @ ${COMMIT:0:12}"
  mkdir -p "$REPO"
  git -C "$REPO" init -q
  git -C "$REPO" remote add origin "$REPO_URL"
  git -C "$REPO" fetch -q --depth 1 origin "$COMMIT"
  git -C "$REPO" checkout -q FETCH_HEAD
else
  echo "==> Reusing $REPO"
  git -C "$REPO" checkout -q -- .
fi

# ---------------------------------------------------------------------------
# 2. Make their benchmark runnable.
#
#    Their published instructions (`cd benchmarks && pnpm install && pnpm bench`)
#    DO NOT WORK at this commit: benchmarks/ declares `workspace:*` dependencies
#    but is not matched by any glob in pnpm-workspace.yaml, so pnpm either skips it
#    or errors with ERR_PNPM_WORKSPACE_PKG_NOT_FOUND. Adding it to the workspace is
#    a packaging fix and changes no benchmark semantics.
# ---------------------------------------------------------------------------
if ! grep -q '"benchmarks"' "$REPO/pnpm-workspace.yaml"; then
  echo "==> Patching pnpm-workspace.yaml so benchmarks/ installs (packaging fix, not a benchmark change)"
  sed -i.bak 's|^packages:|packages:\n  - "benchmarks"|' "$REPO/pnpm-workspace.yaml"
fi

echo "==> pnpm install (this is the slow step; ~1-2 min cold, seconds warm)"
(cd "$REPO" && pnpm install --prefer-offline >/dev/null 2>&1)

# ---------------------------------------------------------------------------
# 3. Regenerate the three DERIVED arms from the committed *.oui model output.
#
#    Why: `pnpm bench` reads the *committed* sample files, but those were passed
#    through `prettier --write .` (benchmarks/package.json "format:fix") after they
#    were generated. Prettier collapses short arrays onto one line, so the committed
#    files are slightly SMALLER than what the converters actually emit -- and the
#    published README table counts the raw converter output. Regenerating reproduces
#    the published table exactly. The *.oui files (the only model-generated artifact)
#    are never touched.
# ---------------------------------------------------------------------------
cat > "$REPO/benchmarks/regen-samples.ts" <<'TS'
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
// generate-samples.ts imports "../packages/react-lang/src/parser/parser.js", which no
// longer exists at this commit -- PR #347 extracted the parser to @openuidev/lang-core --
// so their own `pnpm generate` is dead. This is that same file at its new path: the
// import is repointed, the parser is byte-for-byte theirs.
import { createParser } from "../packages/lang-core/src/parser/parser.js";
import { astToThesysC1Json } from "./thesys-c1-converter.js";
import { astToVercelJsonl } from "./vercel-jsonl-converter.js";
import { astToYaml } from "./yaml-converter.js";

const SCENARIOS = [
  "simple-table", "chart-with-data", "contact-form", "dashboard",
  "pricing-page", "settings-panel", "e-commerce-product",
] as const;

const schema = JSON.parse(readFileSync(join(process.cwd(), "schema.json"), "utf-8"));
const parser = createParser(schema);

for (const scenario of SCENARIOS) {
  const ast = parser.parse(readFileSync(join("samples", `${scenario}.oui`), "utf-8")).root;
  writeFileSync(join("samples", `${scenario}.c1.json`), astToThesysC1Json(ast));
  writeFileSync(join("samples", `${scenario}.vercel.jsonl`), astToVercelJsonl(ast));
  writeFileSync(join("samples", `${scenario}.yaml`), astToYaml(ast));
}
TS

cd "$REPO/benchmarks"

echo
echo "============================================================================"
echo " TABLE A - AS PUBLISHED (competitor C1 JSON pretty-printed, 2-space indent)"
echo "============================================================================"
pnpm exec tsx regen-samples.ts >/dev/null
pnpm bench 2>/dev/null | sed -n '/^| Scenario | YAML (Tokens)/,/TOTAL/p'

# ---------------------------------------------------------------------------
# 4. THE ONE CHANGE: minify the competitor's JSON. Drop `null, 2` from the
#    C1 converter's JSON.stringify. Nothing else in the harness is touched.
#
#    benchmarks/thesys-c1-converter.ts:39-46
#      -  return JSON.stringify({ component, error: null }, null, 2);
#      +  return JSON.stringify({ component, error: null });
# ---------------------------------------------------------------------------
python3 - <<'PY'
import re, pathlib
p = pathlib.Path("thesys-c1-converter.ts")
src = p.read_text()
pretty = """  return JSON.stringify(
    {
      component,
      error: null,
    },
    null,
    2,
  );"""
minified = """  return JSON.stringify({
    component,
    error: null,
  });"""
assert pretty in src, "converter source did not match the expected pretty-print block"
p.write_text(src.replace(pretty, minified))
PY

echo
echo "==> THE ONE CHANGE (benchmarks/thesys-c1-converter.ts):"
git -C "$REPO" --no-pager diff -- benchmarks/thesys-c1-converter.ts | sed -n '/^@@/,$p' | sed 's/^/    /'

echo
echo "============================================================================"
echo " TABLE B - FAIR FIGHT (competitor C1 JSON minified; nothing else changed)"
echo "============================================================================"
pnpm exec tsx regen-samples.ts >/dev/null
pnpm bench 2>/dev/null | sed -n '/^| Scenario | YAML (Tokens)/,/TOTAL/p'

echo
echo "NOTE: their report template hardcodes a minus sign (run-benchmark.ts:55), so a"
echo "      NEGATIVE saving renders as '--1.8%'. On 'dashboard' that means OpenUI Lang"
echo "      is 1.8% LARGER than minified C1 JSON -- i.e. OpenUI loses."
echo
echo "Raw numbers: $HERE/results.json"
echo "Provenance : $HERE/PROVENANCE.txt"
