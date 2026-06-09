import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { transform } from "esbuild";

const sourcePath = resolve("public/mia-agent-widget.js");
const outputPath = resolve("public/mia-agent-widget.min.js");
const source = await readFile(sourcePath, "utf8");
const result = await transform(source, {
  charset: "utf8",
  legalComments: "none",
  loader: "js",
  minify: true,
  target: "es2019"
});

await writeFile(outputPath, `${result.code}\n`);
console.log(`Generated ${outputPath}`);
