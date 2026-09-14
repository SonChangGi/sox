import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--update")) {
  throw new Error("Usage: verify-platform-snapshot.mjs [--update]");
}
const update = args[0] === "--update";
const manifestUrl = new URL("../platform-snapshot.json", import.meta.url);

const manifest = JSON.parse(
  await readFile(manifestUrl, "utf8")
);

if (
  manifest.schemaVersion !== 1 ||
  manifest.sharedVersion !== "quant-platform-frontend/0.1.0"
) {
  throw new Error("Unsupported shared platform snapshot manifest.");
}

const entries = Object.entries(manifest.files).sort(([left], [right]) =>
  left.localeCompare(right)
);
const fingerprintLines = [];

for (const [path, expected] of entries) {
  const bytes = await readFile(new URL(`../${path}`, import.meta.url));
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (!update && actual !== expected) {
    throw new Error(
      `Shared platform snapshot drift: ${path} expected ${expected}, received ${actual}`
    );
  }
  manifest.files[path] = actual;
  fingerprintLines.push(`${actual}  ${path}`);
}

const aggregate = createHash("sha256")
  .update(`${fingerprintLines.join("\n")}\n`)
  .digest("hex");
if (!update && aggregate !== manifest.aggregateFingerprint) {
  throw new Error(
    `Shared platform aggregate drift: expected ${manifest.aggregateFingerprint}, received ${aggregate}`
  );
}

if (update) {
  const now = new Date();
  manifest.snapshotDate = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
  manifest.aggregateFingerprint = aggregate;
  await writeFile(manifestUrl, `${JSON.stringify(manifest, null, 2)}\n`);
}

console.log(
  `${update ? "Updated" : "Verified"} ${entries.length} vendored platform files (${manifest.sharedVersion}, ${aggregate.slice(0, 12)}).`
);
