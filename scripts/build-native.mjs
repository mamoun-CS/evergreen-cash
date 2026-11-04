import { spawnSync } from "node:child_process";
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const routeFiles = [
  resolve(projectRoot, "src/app/api/sync/route.ts"),
  resolve(projectRoot, "src/app/api/health/route.ts"),
];
const movedRoutes = [];
const segmentFiles = [
  resolve(projectRoot, "src/app/page.tsx"),
  resolve(projectRoot, "src/app/settings/page.tsx"),
];
const originalSegments = new Map();
const tsconfigPath = resolve(projectRoot, "tsconfig.json");
let originalTsconfig;

async function addViewportFit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await addViewportFit(path);
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      const html = await readFile(path, "utf8");
      let found = false;
      const updated = html.replace(/<meta\b(?=[^>]*\bname="viewport")(?=[^>]*\bcontent="([^"]*)")[^>]*>/gi, (tag, content) => {
        found = true;
        if (/viewport-fit\s*=/.test(content)) return tag;
        return tag.replace(/\bcontent="[^"]*"/, `content="${content}, viewport-fit=cover"`);
      });
      if (!found) throw new Error(`لم يتم العثور على viewport meta في ${path}`);
      if (updated !== html) await writeFile(path, updated);
    }
  }
}

try {
  originalTsconfig = await readFile(tsconfigPath, "utf8");
  const tsconfig = JSON.parse(originalTsconfig);
  tsconfig.include = tsconfig.include.filter((pattern) => pattern !== ".next/dev/types/**/*.ts");
  tsconfig.exclude = [...new Set([...(tsconfig.exclude ?? []), "src/test", ".next/dev"] )];
  await writeFile(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);

  for (const path of segmentFiles) {
    const source = await readFile(path, "utf8");
    if (source.includes("export const instant = false;")) {
      originalSegments.set(path, source);
      await writeFile(path, source.replace(/^export const instant = false;\r?\n/m, ""));
    }
  }

  for (const source of routeFiles) {
    const hidden = `${source}.native-build-disabled`;
    await rename(source, hidden);
    movedRoutes.push([hidden, source]);
  }

  const nextCli = resolve(projectRoot, "node_modules/next/dist/bin/next");
  const result = spawnSync(process.execPath, [nextCli, "build", "--webpack"], {
    cwd: projectRoot,
    env: { ...process.env, BUILD_TARGET: "native" },
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  else await addViewportFit(resolve(projectRoot, "out"));
} finally {
  for (const [hidden, original] of movedRoutes.reverse()) await rename(hidden, original);
  for (const [path, source] of originalSegments) await writeFile(path, source);
  if (originalTsconfig !== undefined) await writeFile(tsconfigPath, originalTsconfig);
}
