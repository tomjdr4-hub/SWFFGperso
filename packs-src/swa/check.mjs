// Vérifie une traduction : node check.mjs 07   (compare en/batch-07.json et fr/batch-07.json)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const n = String(process.argv[2]).padStart(2, "0");
const en = JSON.parse(fs.readFileSync(path.join(DIR, "en", `batch-${n}.json`), "utf8"));
let fr;
try {
  fr = JSON.parse(fs.readFileSync(path.join(DIR, "fr", `batch-${n}.json`), "utf8"));
} catch (e) {
  console.log(`ERREUR : fr/batch-${n}.json illisible ou JSON invalide : ${e.message}`);
  process.exit(1);
}
const problems = [];
for (const k of Object.keys(en)) {
  if (!(k in fr)) { problems.push(`clé manquante : ${k}`); continue; }
  if (typeof fr[k] !== "string") { problems.push(`valeur non textuelle : ${k}`); continue; }
  const tokens = (s) => (s.match(/:[a-z-]+:|\{[^}]*\}/g) || []).sort().join(" ");
  if (tokens(en[k]) !== tokens(fr[k])) problems.push(`jetons différents pour ${k} : EN [${tokens(en[k])}] / FR [${tokens(fr[k])}]`);
  if (en[k].length > 40 && fr[k] === en[k]) problems.push(`non traduit ? ${k}`);
}
for (const k of Object.keys(fr)) if (!(k in en)) problems.push(`clé en trop : ${k}`);
if (problems.length) {
  console.log(`${problems.length} problème(s) :\n` + problems.slice(0, 60).join("\n"));
  process.exit(1);
}
console.log(`OK : ${Object.keys(en).length} textes traduits dans fr/batch-${n}.json`);
