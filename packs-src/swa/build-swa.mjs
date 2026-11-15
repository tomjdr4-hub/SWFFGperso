// Construit le compendium « Adversaires (Star Wars Adversaries) » à partir des données SWA traduites.
// Usage : node packs-src/swa/build-swa.mjs   (aucun monde de ce système ouvert dans Foundry)
// Les textes sans traduction (fr/batch-*.json) restent en anglais.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const FOUNDRY = process.env.FOUNDRY_APP || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const { ClassicLevel } = await import(pathToFileURL(path.join(FOUNDRY, "node_modules/classic-level/index.js")).href);

const SYS = "starwarsffg-v14";
const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, "..", "..");
const PACK = "swa-adversaires";
const NOW = Date.now();
const STATS = { coreVersion: "14.364", systemId: SYS, systemVersion: "2.0.4", createdTime: NOW, modifiedTime: NOW, lastModifiedBy: null, compendiumSource: null, duplicateSource: null, exportSource: null };

const rd = (f) => JSON.parse(fs.readFileSync(path.join(DIR, "data", f), "utf8").replace(/^\uFEFF/, ""));
const strId = (cat, en) => `${cat}_${crypto.createHash("sha1").update(en).digest("hex").slice(0, 10)}`;
const id = (key) => {
  const h = crypto.createHash("sha256").update(key).digest();
  const a = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from(h.subarray(0, 16), (b) => a[b % a.length]).join("");
};

// ---------------------------------------------------------------- traductions
const FR = {};
for (const f of fs.readdirSync(path.join(DIR, "fr")).filter((f) => /^batch-\d+\.json$/.test(f))) {
  Object.assign(FR, JSON.parse(fs.readFileSync(path.join(DIR, "fr", f), "utf8")));
}
let missing = 0;
const tr = (cat, en) => {
  if (typeof en !== "string" || !en.trim()) return en ?? "";
  const v = FR[strId(cat, en)];
  if (v === undefined) { missing++; if (process.env.SHOW_MISSING) console.log("MANQUE", cat, JSON.stringify(en)); }
  return v ?? en;
};
/** Markdown léger → HTML. */
const DIFF = { easy: 1, average: 2, hard: 3, daunting: 4, formidable: 5 };
/** Jetons de dés non gérés par le système : difficulté améliorée N fois, variantes de casse. */
function fixDice(text) {
  return text
    .replace(/:(easy|average|hard|daunting|formidable)-(\d+):/gi, (_, d, n) => {
      const base = DIFF[d.toLowerCase()]; const up = Math.min(+n, base);
      return ":challenge:".repeat(up) + ":difficulty:".repeat(base - up);
    })
    .replace(/:simple:/gi, "(Simple)")
    .replace(/\b(BOOST|SETBACK|ADVANTAGE|THREAT|SUCCESS|FAILURE|TRIUMPH|DESPAIR)\b/g, (_, t) => `:${t.toLowerCase()}:`)
    .replace(/:(forcepip|boost|setback|advantage|threat|success|failure|triumph|despair):(?=:(?![a-z]))/gi, ":$1:")
    .replace(/(:[a-z]+:):(?![a-z])/gi, "$1")
    .replace(/:([A-Za-z]+):/g, (all, t) => `:${t.toLowerCase()}:`);
}
function html(text) {
  if (!text) return "";
  text = fixDice(text);
  const t = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');
  if (t.trim().startsWith("<")) return t;
  return t.split(/\n\s*\n|\n/).filter((p) => p.trim()).map((p) => `<p>${p.trim()}</p>`).join("");
}

// ---------------------------------------------------------------- références
const TALENTS = Object.fromEntries(rd("talents/talents.json").map((t) => [t.name.toLowerCase(), t]));
const ABILITIES = Object.fromEntries(rd("talents/abilities.json").map((a) => [a.name.toLowerCase(), a]));
const WEAPONS = Object.fromEntries(rd("weapons.json").map((w) => [w.name.toLowerCase(), w]));
const SWA_QUAL = Object.fromEntries([...rd("qualities/qualities.json"), ...rd("qualities/mods.json")].map((q) => [q.name.toLowerCase(), q]));
const AOE_QUAL = JSON.parse(fs.readFileSync(path.join(ROOT, "packs-src", "aoe", "qualities.json"), "utf8"));
const QFR = {
  accurate: "Précis", "auto-fire": "Automatique", autofire: "Automatique", blast: "Souffle", breach: "Brèche", burn: "Incendiaire",
  concussive: "Choc", cortosis: "Cortosis", cumbersome: "Encombrant", defensive: "Parade", deflection: "Déflexion",
  disorient: "Désorientation", ensnare: "Enchevêtrement", guided: "Projectile guidé", inaccurate: "Imprécis", innacurate: "Imprécis",
  inferior: "Mauvaise qualité", ion: "Ionique", knockdown: "Renversement", "limited ammo": "Munitions limitées", linked: "Jumelé",
  pierce: "Perforant", prepare: "Déploiement", "slow-firing": "Cadence lente", "slow firing": "Cadence lente", stun: "Étourdissement",
  "stun damage": "Dégâts étourdissants", "stun setting": "Réglage étourdissant", sunder: "Briseur", superior: "Bonne qualité",
  tractor: "Tracteur", unwieldy: "Peu maniable", vicious: "Sanguinaire", "quick draw": "Arme en main", "sniper shot": "Tireur d'élite",
};
const QALIAS = { "Réglage étourdissant": "Dégâts étourdissants" };

// ---------------------------------------------------------------- compétences
const CANON = ["Astrogation", "Athletics", "Brawl", "Charm", "Coercion", "Computers", "Cool", "Coordination", "Deception", "Discipline",
  "Gunnery", "Knowledge: Core Worlds", "Knowledge: Education", "Knowledge: Lore", "Knowledge: Outer Rim", "Knowledge: Underworld",
  "Knowledge: Warfare", "Knowledge: Xenology", "Leadership", "Lightsaber", "Mechanics", "Medicine", "Melee", "Negotiation",
  "Perception", "Piloting: Planetary", "Piloting: Space", "Ranged: Heavy", "Ranged: Light", "Resilience", "Skulduggery", "Stealth",
  "Streetwise", "Survival", "Vigilance"];
const SKILL_FIX = {
  education: "Knowledge: Education", lore: "Knowledge: Lore", negotiate: "Negotiation", perceptio: "Perception", piloting: "Piloting: Planetary",
  "pilot: planetary": "Piloting: Planetary", "pilot: space": "Piloting: Space", "piloting: pleanetary": "Piloting: Planetary",
  "ranged (heavy)": "Ranged: Heavy", "ranged (light)": "Ranged: Light", "ranged :light": "Ranged: Light", "ranged,light": "Ranged: Light",
  "ranged: hleavy": "Ranged: Heavy", "ranged:light": "Ranged: Light", resillience: "Resilience", "knowledge: underrworld": "Knowledge: Underworld",
  "knowledge: xenlology": "Knowledge: Xenology", bralw: "Brawl", surveillance: "Perception",
};
const CHAR = { agility: "Agility", brawn: "Brawn", intellect: "Intellect", cunning: "Cunning", willpower: "Willpower", presence: "Presence" };
function parseSkill(raw) {
  let s = raw.trim().replace(/[.,:]+$/, "").trim();
  let override = null;
  const m = s.match(/^(.*?)\s*\((\w+)\)$/);
  if (m && CHAR[m[2].toLowerCase()]) { s = m[1].trim(); override = CHAR[m[2].toLowerCase()]; }
  const low = s.toLowerCase();
  const key = CANON.find((c) => c.toLowerCase() === low) || SKILL_FIX[low];
  return key ? { key, override } : null;
}

// ---------------------------------------------------------------- tri en dossiers
const FOLDERS = {
  "a-and-a.json": "Allies and Adversaries", "beyond-the-rim.json": "Beyond the Rim", "blacksunrising.json": "Black Sun Rising",
  "characters.json": "Personnages célèbres", "chronicles-of-the-gatekeeper.json": "Chronicles of the Gatekeeper", "civilians.json": "Civils",
  "collapse-of-the-republic.json": "Collapse of the Republic", "crate-of-krayts.json": "Crate of Krayts", "creatures.json": "Créatures",
  "cyphers-and-masks.json": "Cyphers and Masks", "d20radio.json": "D20Radio (non officiel)", "dawn-of-rebellion.json": "Dawn of Rebellion",
  "dawnofdefiance.json": "Dawn of Defiance", "dead-in-the-water.json": "Dead in the Water", "debts-to-pay.json": "Debts to Pay",
  "discovery-on-jakku.json": "Discovery on Jakku", "doh.json": "Disciples of Harmony", "droids.json": "Droïdes",
  "entertheunknown.json": "Enter the Unknown", "escapemosshuuta.json": "Escape from Mos Shuuta", "force-sensitives.json": "Sensibles à la Force",
  "friends-like-these.json": "Friends Like These", "fullyoperational.json": "Fully Operational", "ghosts-of-dathomir.json": "Ghosts of Dathomir",
  "hidden-depths.json": "Hidden Depths", "hobs.json": "Heroes of the Rebellion (HoBs)", "imperial-bureaucracy.json": "Bureaucratie impériale",
  "imperial-military.json": "Armée impériale", "jewelofyavin.json": "Jewel of Yavin", "jfo.json": "Jedi : Fallen Order",
  "knightsoffate.json": "Knights of Fate", "light-and-life.json": "Light and Life", "lost-knowledge.json": "Lost Knowledge",
  "mask-of-the-pirate-queen.json": "Mask of the Pirate Queen", "mine.json": "Mines (divers)", "mountaintoprescue.json": "Mountaintop Rescue",
  "never-tell-me-the-odds.json": "Never Tell Me the Odds", "nexus-of-power.json": "Nexus of Power", "oddities.json": "Bizarreries",
  "onslaught-at-arda.json": "Onslaught at Arda", "operation-shadowpoint.json": "Operation Shadowpoint", "rebel-alliance.json": "Alliance Rebelle",
  "rise-of-the-separatists.json": "Rise of the Separatists", "savage-spirits.json": "Savage Spirits", "suns-of-fortune.json": "Suns of Fortune",
  "tatooinemanhunt.json": "Tatooine Manhunt", "underworld.json": "Pègre", "whisper-base.json": "Whisper Base",
};
const BOOKS = {
  aaa: "Allies and Adversaries", aor: "L'Ère de la Rébellion", eote: "Aux Confins de l'Empire", fad: "Force et Destinée", sof: "Suns of Fortune",
  btr: "Beyond the Rim", dor: "Dawn of Rebellion", rots: "Rise of the Separatists", cotr: "Collapse of the Republic", nop: "Nexus of Power",
  motpq: "Mask of the Pirate Queen", god: "Ghosts of Dathomir", ss: "Savage Spirits", sot: "Stay on Target", lonh: "Lords of Nal Hutta",
  joy: "Jewel of Yavin", oaa: "Onslaught at Arda", cotgk: "Chronicles of the Gatekeeper", doh: "Disciples of Harmony",
};
// PNJ du livre de base déjà présents dans le compendium « Adversaires » (aoe-adversaires)
const KEEP_EOTE = new Set(["Bandin Dobah", "Bandin Dobah Pirate Mate", "Daro Blunt", "Godon Netakka", "Gut-Guro", "R4-W9", "Spir Fraxis", "Sentry Droid"]);

// ---------------------------------------------------------------- construction
const icon = (img) => img;
function embedded(ownerKey, type, name, system, img, i) {
  return {
    _id: id(`${ownerKey}|${type}|${name}|${i}`), name, type, img, system: { ...system, metadata: { tags: [type], sources: ["Star Wars Adversaries"] } },
    effects: [], folder: null, sort: i * 100, ownership: { default: 0 }, flags: {}, _stats: STATS,
  };
}
function qualities(list = [], ownerKey) {
  return list.filter((q) => q && q.trim()).map((raw, i) => {
    const m = raw.trim().match(/^(.*?)(?:\s+(\d+))?$/);
    const en = m[1].trim(); const rank = m[2] ? parseInt(m[2], 10) : 1;
    const name = QFR[en.toLowerCase()] || tr("qualname", SWA_QUAL[en.toLowerCase()]?.name ?? en);
    const aoe = AOE_QUAL.find((q) => q.name === (QALIAS[name] || name));
    const swa = SWA_QUAL[en.toLowerCase()];
    const desc = aoe ? html(aoe.desc) : swa ? html(tr("qualdesc", swa.description)) : "";
    const qid = id(`${ownerKey}|q|${i}|${en}`);
    return { _id: qid, id: qid, name, type: "itemmodifier", img: `systems/${SYS}/images/mod-all.png`,
      system: { description: desc, type: "all", rank, rank_current: rank, active: false, attributes: {}, metadata: { tags: [], sources: [] } }, flags: {} };
  });
}
const RANGE = { engages: "Engaged", close: "Engaged" };

/** Résout les gabarits SWA ({ranks|times}, {Cunning}, {Leadership}…) avec les valeurs du PNJ. */
const WORDS = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix"];
function resolveTpl(text, rank, ctx) {
  if (!text) return text;
  return text.replace(/\{([^}]+)\}/g, (all, inner) => {
    const [a, b] = inner.split("|").map((s) => s.trim());
    const val = (name) => {
      if (/^ranks?$/i.test(name)) return rank;
      if (/^force rating$/i.test(name)) return ctx.force;
      const c = CHAR[name.toLowerCase()]; if (c) return ctx.chars[c] ?? 0;
      const s = parseSkill(name); if (s) return ctx.skills[s.key] ?? 0;
      return null;
    };
    const v = val(a);
    if (v === null) return all;
    if (!b) return String(v);
    if (b === "times") return v === 1 ? "une fois" : v === 2 ? "deux fois" : `${v} fois`;
    if (b === "words") return WORDS[v] ?? String(v);
    let m;
    if ((m = b.match(/^multiply-(\d+)$/))) return String(v * +m[1]);
    if ((m = b.match(/^plus-(\d+)$/))) return String(v + +m[1]);
    if (["boost", "setback", "failure", "success", "force", "advantage", "threat"].includes(b)) return `:${b}:`.repeat(Math.max(v, 0));
    const other = val(b); if (other !== null) return String(other);
    return String(v);
  });
}

const folders = {};
const actors = [];
const seen = new Map();
let skipped = 0;
for (const file of fs.readdirSync(path.join(DIR, "data", "adversaries")).sort()) {
  for (const a of rd(`adversaries/${file}`)) {
    if (a.devOnly) { skipped++; continue; }
    const tags = a.tags || [];
    if (tags.includes("book:eote") && !KEEP_EOTE.has(a.name)) { skipped++; continue; }
    const type = { minion: "minion", rival: "rival", nemesis: "nemesis" }[(a.type || "").toLowerCase()] || "rival";
    let key = `${PACK}|${file}|${a.name}|${type}`;
    const n = (seen.get(key) || 0) + 1; seen.set(key, n); if (n > 1) key += `|${n}`;
    const folderName = FOLDERS[file] || file.replace(/\.json$/, "");
    folders[folderName] ??= { _id: id(`${PACK}|folder|${folderName}`), name: folderName, type: "Actor", folder: null, sorting: "a", sort: 0, color: null, description: "", flags: {}, _stats: STATS };

    const characteristics = Object.fromEntries(Object.values(CHAR).map((c) => [c, { value: a.characteristics?.[c] ?? 0 }]));
    const skills = {}; const attributes = {};
    const list = Array.isArray(a.skills) ? a.skills.map((s) => [s, 0]) : Object.entries(a.skills || {});
    for (const [raw, rank] of list) {
      const p = parseSkill(raw); if (!p) continue;
      const entry = type === "minion" ? { groupskill: true } : { rank };
      if (p.override) entry.characteristic = p.override;
      skills[p.key] = entry;
      if (type !== "minion") attributes[p.key] = { key: p.key, mod: p.key, modtype: "Skill Rank", value: rank };
    }

    const items = []; let i = 0;
    const ctx = { chars: Object.fromEntries(Object.entries(characteristics).map(([k, v]) => [k, v.value])), skills: {}, force: 1 };
    for (const [raw, rank] of list) { const p = parseSkill(raw); if (p) ctx.skills[p.key] = rank; }
    for (const x of [...(a.talents || []), ...(a.abilities || [])]) {
      const m = (typeof x === "string" ? x : x?.name || "").match(/^Force Rating\s+(\d+)/i);
      if (m) ctx.force = +m[1];
    }
    for (const w0 of a.weapons || []) {
      const w = typeof w0 === "string" ? WEAPONS[w0.toLowerCase()] ?? { name: w0 } : w0;
      if (!w?.name) continue;
      const brawn = w.damage === undefined && w["plus-damage"] !== undefined;
      const dmg = parseInt(brawn ? w["plus-damage"] : w.damage, 10) || 0;
      const sk = parseSkill(w.skill || "Ranged: Light")?.key || "Ranged: Light";
      const range = RANGE[(w.range || "").toLowerCase()] || w.range || "Short";
      const q = (w.qualities || []).map((x) => x.trim()).filter(Boolean);
      items.push(embedded(key, "weapon", tr("wname", typeof w0 === "string" ? w0 : w.name), {
        description: "", damage: { value: dmg, adjusted: dmg }, crit: { value: parseInt(w.critical, 10) || 0, adjusted: parseInt(w.critical, 10) || 0 },
        range: { value: range, adjusted: range }, skill: { value: sk, useBrawn: brawn }, characteristic: { value: brawn ? "Brawn" : "" },
        special: { value: q.map((x) => { const m = x.match(/^(.*?)(\s+\d+)?$/); return (QFR[m[1].toLowerCase()] || m[1]) + (m[2] || ""); }).join(", ") },
        itemmodifier: qualities(q, `${key}|w${i}`), itemattachment: [], attributes: {}, equippable: { value: true, equipped: true },
      }, `systems/${SYS}/images/defaults/items/weapon.png`, i++));
    }
    for (const g of [].concat(a.gear || [])) {
      if (typeof g !== "string" || !g.trim()) continue;
      const soak = g.match(/\+(\d+)\s*soak/i); const def = g.match(/\+(\d+)\s*(?:ranged\s+|melee\s+)?defen[cs]e/i);
      const name = tr("gear", g);
      if (soak || def) {
        items.push(embedded(key, "armour", name, { description: "", soak: { value: soak ? +soak[1] : 0, adjusted: soak ? +soak[1] : 0 },
          defence: { value: def ? +def[1] : 0, adjusted: def ? +def[1] : 0 }, itemmodifier: [], itemattachment: [], attributes: {} }, `systems/${SYS}/images/defaults/items/armor.png`, i++));
      } else {
        items.push(embedded(key, "gear", name, { description: "", itemmodifier: [], itemattachment: [], attributes: {} }, `systems/${SYS}/images/defaults/items/gear.png`, i++));
      }
    }
    for (const t of a.talents || []) {
      let name; let desc = ""; let rank = 1; let ranked = false;
      if (typeof t === "string") {
        const m = t.trim().match(/^(.*?)(?:\s+(\d+))?$/);
        const ref = TALENTS[m[1].toLowerCase()];
        rank = m[2] ? parseInt(m[2], 10) : 1; ranked = ref ? !!ref.ranked : !!m[2];
        name = tr("talname", ref ? ref.name : m[1]);
        desc = ref ? resolveTpl(tr("taldesc", ref.description), rank, ctx) : "";
      } else { name = tr("talname", t.name); desc = resolveTpl(tr("taldesc", t.description), rank, ctx); }
      items.push(embedded(key, "talent", name, { description: html(desc), activation: { value: "Passive", label: "SWFFG.TalentActivationsPassive" }, ranks: { ranked, current: rank, min: 0 }, attributes: {} }, "icons/svg/upgrade.svg", i++));
    }
    for (const ab of a.abilities || []) {
      let name; let desc = "";
      if (typeof ab === "string") {
        const ref = ABILITIES[ab.toLowerCase()];
        const rk = +(ab.match(/\s(\d+)$/)?.[1] ?? 1);
        name = tr("abname", ref ? ref.name : ab); desc = ref ? resolveTpl(tr("abdesc", ref.description), rk, ctx) : "";
      } else { name = tr("abname", ab.name); desc = resolveTpl(tr("abdesc", ab.description), 1, ctx); }
      items.push(embedded(key, "ability", name, { description: html(desc), attributes: {} }, "icons/svg/aura.svg", i++));
    }

    const d = a.derived || {};
    const stats = { soak: { value: d.soak ?? 0 }, defence: { melee: d.defence?.[0] ?? 0, ranged: d.defence?.[1] ?? 0 } };
    const system = { characteristics, skills, attributes };
    if (type === "minion") { system.unit_wounds = { value: d.wounds ?? 0 }; system.quantity = { value: 1, max: 1 }; stats.wounds = { value: 0, min: 0, max: d.wounds ?? 0 }; }
    else { stats.wounds = { value: 0, min: 0, max: d.wounds ?? 0 }; stats.strain = { value: 0, min: 0, max: d.strain ?? d.wounds ?? 0 }; }
    system.stats = stats;
    const books = tags.filter((t) => t.startsWith("book:")).map((t) => BOOKS[t.slice(5)] || t.slice(5));
    let bio = html(tr("desc", a.description));
    if (a.notes) bio += `<h3>Notes</h3>${html(tr("note", a.notes))}`;
    if (books.length) bio += `<p><em>Source : ${books.join(", ")}</em></p>`;
    if (a.source?.url) bio += `<p><em>Profil communautaire : <a href="${a.source.url}">${a.source.owner || a.source.url}</a></em></p>`;
    system.biography = bio;
    const TAG_PREFIX = { location: "lieu", species: "espèce", adventure: "aventure", character: "personnage", source: "source" };
    const frTag = (t) => tr("tag", t).replace(/^\s*(location|species|adventure|character|source)\s*:\s*/i, (_, p) => `${TAG_PREFIX[p.toLowerCase()]}:`);
    system.metadata = { tags: [type, ...tags.filter((t) => !t.startsWith("book:")).map(frTag)], sources: books };

    const droid = tags.includes("droid") || file === "droids.json";
    const creature = file === "creatures.json" || tags.includes("creature") || tags.includes("beast");
    actors.push({
      _id: id(key), name: tr("name", a.name), type, img: droid ? "icons/svg/statue.svg" : creature ? "icons/svg/skull.svg" : "icons/svg/mystery-man.svg",
      system, items, effects: [], folder: folders[folderName]._id, sort: 0, ownership: { default: 0 },
      flags: { [SYS]: { ffgimportid: `swa-${id(key).slice(0, 10)}`, config: { enableAutoSoakCalculation: false, enableCriticalInjuries: type !== "minion" } } },
      prototypeToken: { name: tr("name", a.name), actorLink: false, disposition: -1, displayName: 20, displayBars: 20, bar1: { attribute: "stats.wounds" }, bar2: { attribute: "stats.strain" } },
      _stats: STATS,
    });
  }
}

// ---------------------------------------------------------------- écriture
const dir = path.join(ROOT, "packs", PACK);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const db = new ClassicLevel(dir, { keyEncoding: "utf8", valueEncoding: "json" });
await db.open();
const batch = db.batch();
Object.values(folders).sort((x, y) => x.name.localeCompare(y.name, "fr")).forEach((f, n) => { f.sort = (n + 1) * 100; batch.put(`!folders!${f._id}`, f); });
actors.sort((x, y) => x.name.localeCompare(y.name, "fr")).forEach((a, n) => {
  a.sort = (n + 1) * 100;
  const items = a.items;
  a.items = items.map((it) => it._id);
  for (const it of items) batch.put(`!actors.items!${a._id}.${it._id}`, { ...it, effects: [] });
  batch.put(`!actors!${a._id}`, a);
});
await batch.write();
await db.close();

// déclaration dans system.json
const sysPath = path.join(ROOT, "system.json");
const sys = JSON.parse(fs.readFileSync(sysPath, "utf8"));
if (!sys.packs.some((p) => p.name === PACK)) {
  sys.packs.push({ name: PACK, label: "Adversaires (Star Wars Adversaries)", type: "Actor", system: SYS, path: `packs/${PACK}`, ownership: { PLAYER: "OBSERVER", ASSISTANT: "OWNER" }, flags: {} });
  sys.packFolders.push({ name: "Star Wars Adversaries", sorting: "m", color: "#1c4a8a", packs: [PACK] });
  fs.writeFileSync(sysPath, JSON.stringify(sys, null, 2) + "\n");
}
console.log(`${actors.length} adversaires, ${Object.keys(folders).length} dossiers, ${skipped} écartés (doublons du livre de base / brouillons), ${missing} textes encore en anglais`);
