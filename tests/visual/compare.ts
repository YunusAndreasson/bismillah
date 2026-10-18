import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { REPO } from "../driver.ts";

/**
 * Compares a screenshot with its baseline in tests/visual/baselines/. Set
 * UPDATE_BASELINES=1 to write new baselines after a deliberate visual change; look at
 * every changed baseline before committing it.
 *
 * Returns the share of pixels that differ (0 when the baseline was just written). A
 * missing baseline is an error, so a forgotten baseline never passes silently.
 * A diff image is written to target/visual/ whenever pixels differ.
 */
export function compareWithBaseline(name: string, base64Png: string): number {
  const baselinePath = resolve(REPO, "tests/visual/baselines", `${name}.png`);
  const actual = PNG.sync.read(Buffer.from(base64Png, "base64"));
  if (process.env.UPDATE_BASELINES === "1") {
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, PNG.sync.write(actual));
    return 0;
  }
  if (!existsSync(baselinePath)) {
    throw new Error(`No baseline for "${name}". Run with UPDATE_BASELINES=1 and inspect it.`);
  }
  const expected = PNG.sync.read(readFileSync(baselinePath));
  if (expected.width !== actual.width || expected.height !== actual.height) return 1;
  const diff = new PNG({ width: actual.width, height: actual.height });
  const changed = pixelmatch(expected.data, actual.data, diff.data, actual.width, actual.height, {
    threshold: 0.1,
  });
  if (changed > 0) {
    const out = resolve(REPO, "target/visual");
    mkdirSync(out, { recursive: true });
    writeFileSync(resolve(out, `${name}.actual.png`), PNG.sync.write(actual));
    writeFileSync(resolve(out, `${name}.diff.png`), PNG.sync.write(diff));
  }
  return changed / (actual.width * actual.height);
}
