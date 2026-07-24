import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";

const required = [
  "dist/index.html",
  "dist/data/sox-analysis.json",
  "dist/data/sox-history.json",
  "dist/data/summary.json"
];

await Promise.all(required.map((file) => access(file)));
const index = await readFile("dist/index.html", "utf8");
if (!index.includes("/sox/assets/")) {
  throw new Error("Vite base path was not applied to production assets.");
}
if (/https?:\/\/[^"']+\.(?:js|css)/.test(index)) {
  throw new Error(
    "Production HTML unexpectedly depends on a remote JS/CSS asset."
  );
}

const dataFiles = required.filter((file) => file.startsWith("dist/data/"));
for (const distPath of dataFiles) {
  const repositoryPath = `../${distPath.replace(/^dist\//, "")}`;
  const [repositoryBytes, distBytes] = await Promise.all([
    readFile(repositoryPath),
    readFile(distPath)
  ]);
  const digest = (bytes) =>
    createHash("sha256").update(bytes).digest("hex");
  if (digest(repositoryBytes) !== digest(distBytes)) {
    throw new Error(`${distPath} is not byte-identical to ${repositoryPath}.`);
  }
}

console.log(
  `Verified ${required.length} production artifacts, ${dataFiles.length} byte-identical JSON files, and the /sox/ base path.`
);
