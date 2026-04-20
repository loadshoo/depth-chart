import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const typesDir = path.resolve("dist/types");
const cssImportPattern = /^import\s+["'][^"']+\.css["'];?\s*$/gm;

async function stripCssImports() {
  const entries = await readdir(typesDir, { withFileTypes: true });

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".d.ts"))
      .map(async (entry) => {
        const filePath = path.join(typesDir, entry.name);
        const original = await readFile(filePath, "utf8");
        const next = original.replace(cssImportPattern, "").trimStart();

        if (next !== original) {
          await writeFile(filePath, next);
        }
      }),
  );
}

await stripCssImports();