import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const documentId = process.argv[2]?.trim();
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(documentId ?? "")) {
  console.error("Usage: node prepare-dataset.mjs <knowledge-document-uuid>");
  process.exit(1);
}

const root = dirname(fileURLToPath(import.meta.url));
const source = join(root, "dataset", "evaluation-cases.template.jsonl");
const target = join(root, "dataset", "evaluation-cases.ready.jsonl");
const placeholder = "00000000-0000-4000-8000-000000000001";
const content = await readFile(source, "utf8");
await writeFile(target, content.replaceAll(placeholder, documentId), "utf8");
console.log(`Generated ${target}`);

