// Extrait les textes anglais uniques des données SWA et les répartit en lots de traduction.
// Sortie : en/batch-NN.json  ({ id: texte anglais }), en/index.json (catégorie de chaque id).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const rd = (f) => JSON.parse(fs.readFileSync(path.join(DIR, "data", f), "utf8").replace(/^﻿/, ""));
export const strId = (cat, en) => `${cat}_${crypto.createHash("sha1").update(en).digest("hex").slice(0, 10)}`;

const units = new Map(); // id -> {cat, en}
const add = (cat, en) => {
  if (typeof en !== "string" || !en.trim()) return;
  const id = strId(cat, en);
  if (!units.has(id)) units.set(id, { cat, en });
};

const adversaries = fs.readdirSync(path.join(DIR, "data", "adversaries")).flatMap((f) => rd(`adversaries/${f}`));
for (const t of rd("talents/talents.json")) { add("talname", t.name); add("taldesc", t.description); }
for (const a of rd("talents/abilities.json")) { add("abname", a.name); add("abdesc", a.description); }
for (const q of [...rd("qualities/qualities.json"), ...rd("qualities/mods.json")]) { add("qualname", q.name); add("qualdesc", q.description); }
for (const w of rd("weapons.json")) add("wname", w.name);

for (const a of adversaries) {
  add("name", a.name);
  add("desc", a.description);
  for (const ab of a.abilities || []) {
    if (typeof ab === "object") { add("abname", ab.name); add("abdesc", ab.description); }
  }
  for (const t of a.talents || []) {
    if (typeof t === "object") { add("talname", t.name); add("taldesc", t.description); }
  }
  for (const w of a.weapons || []) add("wname", typeof w === "object" ? w.name : w);
  for (const g of [].concat(a.gear || [])) add("gear", g);
  for (const t of a.tags || []) if (!t.startsWith("book:")) add("tag", t);
}

// Lots : on regroupe par catégorie pour que chaque traducteur garde un contexte homogène.
const ORDER = ["talname", "taldesc", "qualname", "qualdesc", "wname", "gear", "tag", "abname", "abdesc", "name", "desc"];
const LIMIT = 60000;
const batches = [];
let cur = {}; let size = 0; let curCat = null;
for (const cat of ORDER) {
  const list = [...units].filter(([, u]) => u.cat === cat).sort((a, b) => a[1].en.localeCompare(b[1].en));
  for (const [id, u] of list) {
    // les petites catégories peuvent partager un lot, mais une description ne commence jamais un lot entamé par une autre catégorie lourde
    if (size + u.en.length > LIMIT || (curCat && curCat !== cat && ["abdesc", "name", "desc"].includes(cat) && size > 0 && !["abname"].includes(curCat))) {
      batches.push(cur); cur = {}; size = 0;
    }
    cur[id] = u.en; size += u.en.length; curCat = cat;
  }
}
if (Object.keys(cur).length) batches.push(cur);

fs.mkdirSync(path.join(DIR, "en"), { recursive: true });
for (const f of fs.readdirSync(path.join(DIR, "en"))) fs.rmSync(path.join(DIR, "en", f));
batches.forEach((b, i) => fs.writeFileSync(path.join(DIR, "en", `batch-${String(i + 1).padStart(2, "0")}.json`), JSON.stringify(b, null, 1)));
fs.writeFileSync(path.join(DIR, "en", "index.json"), JSON.stringify(Object.fromEntries([...units].map(([id, u]) => [id, u.cat]))));
console.log(`${units.size} textes uniques, ${batches.length} lots`);
batches.forEach((b, i) => {
  const cats = [...new Set(Object.keys(b).map((k) => k.split("_")[0]))];
  console.log(`batch-${String(i + 1).padStart(2, "0")}: ${Object.keys(b).length} textes, ${Object.values(b).join("").length} car., ${cats.join("+")}`);
});
