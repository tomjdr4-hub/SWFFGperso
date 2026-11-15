// Construit les compendiums « Aux Confins de l'Empire » (LevelDB) à partir des JSON de packs-src/aoe.
// Usage : node packs-src/build-aoe.mjs   (Foundry ne doit pas avoir de monde ouvert avec ce système)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const FOUNDRY = process.env.FOUNDRY_APP || "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const { ClassicLevel } = await import(pathToFileURL(path.join(FOUNDRY, "node_modules/classic-level/index.js")).href);

const SYS = "starwarsffg-v14";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "packs-src", "aoe");
const OUT = path.join(ROOT, "packs");
const SOURCE = "Aux Confins de l'Empire - Livre de règles";
const NOW = Date.now();
const STATS = { coreVersion: "14.364", systemId: SYS, systemVersion: "2.0.4", createdTime: NOW, modifiedTime: NOW, lastModifiedBy: null, compendiumSource: null, duplicateSource: null, exportSource: null };

const read = (f) => JSON.parse(fs.readFileSync(path.join(SRC, f), "utf8"));
const readAll = (prefix) => fs.readdirSync(SRC).filter((f) => f.startsWith(prefix)).sort().flatMap(read);

/** Identifiant stable de 16 caractères, dérivé d'une clé. */
function id(key) {
  const h = crypto.createHash("sha256").update(key).digest();
  const a = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from(h.subarray(0, 16), (b) => a[b % a.length]).join("");
}
const html = (t) => (t ? (t.startsWith("<") ? t : `<p>${t}</p>`) : "");

// ---------------------------------------------------------------- compétences
const SKILLS = {
  "athlétisme": "Athletics", "distance (armes lourdes)": "Ranged: Heavy", "distance (armes légères)": "Ranged: Light",
  "perception": "Perception", "pilotage (planétaire)": "Piloting: Planetary", "pilotage (espace)": "Piloting: Space",
  "pugilat": "Brawl", "système d": "Streetwise", "vigilance": "Vigilance", "corps à corps": "Melee", "discrétion": "Stealth",
  "magouilles": "Skulduggery", "coercition": "Coercion", "mécanique": "Mechanics", "connaissance (xénologie)": "Knowledge: Xenology",
  "résistance": "Resilience", "survie": "Survival", "charme": "Charm", "commandement": "Leadership",
  "connaissance (culture)": "Knowledge: Lore", "connaissance (éducation)": "Knowledge: Education",
  "connaissance (mondes du noyau)": "Knowledge: Core Worlds", "négociation": "Negotiation", "tromperie": "Deception",
  "calme": "Cool", "médecine": "Medicine", "connaissance (bordure extérieure)": "Knowledge: Outer Rim",
  "connaissance (pègre)": "Knowledge: Underworld", "astrogation": "Astrogation", "coordination": "Coordination",
  "artillerie": "Gunnery", "sang-froid": "Discipline", "informatique": "Computers", "sabre laser": "Lightsaber",
  "connaissance (stratégie)": "Knowledge: Warfare",
};
const KNOWLEDGE = ["Knowledge: Core Worlds", "Knowledge: Education", "Knowledge: Lore", "Knowledge: Outer Rim", "Knowledge: Underworld", "Knowledge: Warfare", "Knowledge: Xenology"];
function skillKey(fr) {
  const k = SKILLS[fr.trim().toLowerCase().replace(/\s+/g, " ")];
  if (!k) throw new Error(`Compétence inconnue : ${fr}`);
  return k;
}
/** Découpe « A, B (x, y), C » au niveau supérieur. */
function splitTop(s) {
  const out = []; let depth = 0; let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const skillList = (s) => splitTop(s.replace(/\s+et\s+/g, ", ")).filter(Boolean).map(skillKey);

// ---------------------------------------------------------------- active effects
function getModKeyPath(modType, mod) {
  if (["Wounds", "Strain", "EncumbranceMax", "Speed", "Hulltrauma", "Systemstrain"].includes(mod)) modType = "Threshold";
  if (modType === "Characteristic") return `system.characteristics.${mod}.value`;
  if (modType === "Stat") {
    if (mod === "ForcePool") return "system.stats.forcePool.max";
    if (mod === "Defence.Melee") return "system.stats.defence.melee";
    if (mod === "Defence.Ranged") return "system.stats.defence.ranged";
    return `system.stats.${mod.toLocaleLowerCase()}.value`;
  }
  if (modType === "Threshold") {
    if (mod === "EncumbranceMax") return "system.stats.encumbrance.max";
    return `system.stats.${mod.toLocaleLowerCase()}.max`;
  }
  const skillPaths = { "Skill Rank": "rank", "Career Skill": "careerskill", "Skill Boost": "boost", "Skill Setback": "setback", "Skill Remove Setback": "remsetback" };
  if (skillPaths[modType]) return `system.skills.${mod}.${skillPaths[modType]}`;
  return undefined;
}
function explodeMod(modType, mod) {
  const m = mod.toLocaleLowerCase();
  if (["defence-melee", "defense-melee"].includes(m)) return [{ modType: "Stat", mod: "Defence.Melee" }];
  if (["defence-ranged", "defense-ranged"].includes(m)) return [{ modType: "Stat", mod: "Defence.Ranged" }];
  if (["defence", "defense"].includes(m)) return [{ modType: "Stat", mod: "Defence.Melee" }, { modType: "Stat", mod: "Defence.Ranged" }];
  if (mod === "Brawn") return [{ modType, mod: "Brawn" }, { modType, mod: "EncumbranceMax" }, { modType: "Stat", mod: "Soak" }];
  return [{ modType, mod }];
}
function effect(parentKey, name, changes, { img = "icons/svg/aura.svg", disabled = false } = {}) {
  return {
    _id: id(`${parentKey}|effect|${name}`), name, img, type: "base",
    system: { changes: changes.map((c) => ({ key: c.key, type: "add", value: c.value, phase: "initial", priority: null })) },
    disabled, transfer: true, origin: null, description: "", tint: "#ffffff", statuses: [], showIcon: 1,
    duration: { value: null, units: "seconds", expiry: null, expired: false }, start: null,
    flags: {}, sort: 0, folder: null, _stats: STATS,
  };
}
/** Un effet par attribut « attr… » (comme ImportHelpers.applyActiveEffectOnUpdate). */
function attrEffects(parentKey, attributes, opts) {
  const out = [];
  for (const [k, a] of Object.entries(attributes)) {
    if (!k.startsWith("attr")) continue;
    const changes = explodeMod(a.modtype, a.mod).map((c) => ({ key: getModKeyPath(c.modType, c.mod), value: a.value })).filter((c) => c.key);
    if (changes.length) out.push(effect(parentKey, k, changes, opts));
  }
  return out;
}
function attrsFrom(parentKey, list = []) {
  const out = {};
  list.forEach((a, i) => { out[`attr${id(`${parentKey}|attr|${i}`).slice(0, 10)}`] = { mod: a.mod, modtype: a.modtype, value: a.value, isCheckbox: false }; });
  return out;
}

// ---------------------------------------------------------------- documents
function item(pack, type, name, system, { img, effects = [], folder = null, flags = {} } = {}) {
  const key = `${pack}|${type}|${name}`;
  return {
    _id: id(key), _key: key, name, type, img: img || "icons/svg/item-bag.svg",
    system: { ...system, metadata: { tags: [type], sources: [SOURCE], ...(system.metadata || {}) } },
    effects, folder, sort: 0, ownership: { default: 0 },
    flags: { [SYS]: { ffgimportid: `aoe-${type}-${id(key).slice(0, 8)}` }, ...flags }, _stats: STATS,
  };
}
const ACT = {
  P: ["Passive", "SWFFG.TalentActivationsPassive"], A: ["Active (Action)", "SWFFG.TalentActivationsActiveAction"],
  M: ["Active (Maneuver)", "SWFFG.TalentActivationsActiveManeuver"], I: ["Active (Incidental)", "SWFFG.TalentActivationsActiveIncidental"],
  IO: ["Active (Incidental, Out of Turn)", "SWFFG.TalentActivationsActiveIncidentalOutofTurn"],
};

// qualités d'armes
const QUALITIES = read("qualities.json");
const QALIAS = { "Réglage étourdissant": "Dégâts étourdissants", "Défensif": "Parade", "Déviation": "Déflexion", "Guidage": "Projectile guidé" };
function qualityDoc(q) {
  return item("aoe-qualites", "itemmodifier", q.name, {
    description: html(q.desc), type: "all", rank: 1, rank_current: 1, active: false,
    attributes: attrsFrom(`q|${q.name}`, q.attrs),
  }, { img: `systems/${SYS}/images/mod-all.png` });
}
const qualityDocs = QUALITIES.map(qualityDoc);
function parseQualities(list = [], ownerKey) {
  return list.map((raw, i) => {
    const m = raw.match(/^(.*?)(?:\s+(\d+))?$/);
    const name = m[1].trim();
    const rank = m[2] ? parseInt(m[2], 10) : 1;
    const base = QUALITIES.find((q) => q.name === (QALIAS[name] || name));
    const qid = id(`${ownerKey}|quality|${i}|${name}`);
    return {
      _id: qid, id: qid, name, type: "itemmodifier", img: `systems/${SYS}/images/mod-all.png`,
      system: {
        description: base ? html(base.desc) : "", type: "all", rank, rank_current: rank, active: false,
        attributes: base ? attrsFrom(`q|${base.name}`, base.attrs) : {}, metadata: { tags: [], sources: [SOURCE] },
      },
      flags: {},
    };
  });
}

// ---------------------------------------------------------------- talents
const TALENTS = readAll("talents-");
const talentDocs = TALENTS.map((t) => {
  const [value, label] = ACT[t.act];
  const attributes = attrsFrom(`talent|${t.name}`, t.attrs);
  const key = `aoe-talents|talent|${t.name}`;
  return item("aoe-talents", "talent", t.name, {
    description: html(t.desc) + `<p><em>Arborescences : ${t.trees}</em></p>`, longDesc: "",
    activation: { value, label }, ranks: { ranked: !!t.ranked, current: 1, min: 0 },
    isForceTalent: !!t.force, isConflictTalent: false, attributes,
  }, { img: "icons/svg/upgrade.svg", effects: attrEffects(key, attributes) });
});
const talentByName = (n) => {
  const norm = (s) => s.toLocaleLowerCase("fr").replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
  const t = talentDocs.find((d) => norm(d.name) === norm(n));
  if (!t) throw new Error(`Talent introuvable : ${n}`);
  return t;
};
const uuid = (pack, doc, kind = "Item") => `Compendium.${SYS}.${pack}.${kind}.${doc._id}`;

// ---------------------------------------------------------------- armes / armures / kits / matériel
const folderDocs = {};
function folder(pack, type, name) {
  folderDocs[pack] ??= {};
  folderDocs[pack][name] ??= { _id: id(`${pack}|folder|${name}`), name, type, folder: null, sorting: "a", sort: Object.keys(folderDocs[pack]).length * 100000, color: null, description: "", flags: {}, _stats: STATS };
  return folderDocs[pack][name]._id;
}

const weaponDocs = readAll("weapons-").map((w) => {
  const key = `aoe-armes|weapon|${w.name}`;
  const encChange = [{ key: "system.stats.encumbrance.value", value: w.enc }];
  return item("aoe-armes", "weapon", w.name, {
    description: html(w.desc), damage: { value: w.dmg, adjusted: w.dmg }, crit: { value: w.crit, adjusted: w.crit },
    range: { value: w.range, adjusted: w.range }, skill: { value: w.skill, useBrawn: !!w.brawn },
    characteristic: { value: w.brawn ? "Brawn" : "" }, special: { value: w.special || w.q.join(", ") },
    encumbrance: { value: w.enc, adjusted: w.enc }, price: { value: w.price, adjusted: w.price },
    rarity: { value: w.rarity, adjusted: w.rarity, isrestricted: !!w.restricted }, hardpoints: { value: w.hp, adjusted: w.hp },
    itemmodifier: parseQualities(w.q, key), itemattachment: [], attributes: {},
  }, { img: `systems/${SYS}/images/defaults/items/weapon.png`, folder: folder("aoe-armes", "Item", w.cat), effects: [effect(key, "(inherent)", encChange, { img: `systems/${SYS}/images/defaults/items/weapon.png` })] });
});

const armourDocs = read("armour.json").map((a) => {
  const key = `aoe-armures|armour|${a.name}`;
  const changes = [{ key: "system.stats.encumbrance.value", value: a.enc }, { key: "system.stats.defence.melee", value: a.def }, { key: "system.stats.defence.ranged", value: a.def }, { key: "system.stats.soak.value", value: a.soak }];
  return item("aoe-armures", "armour", a.name, {
    description: html(a.desc), defence: { value: a.def, adjusted: a.def }, soak: { value: a.soak, adjusted: a.soak },
    encumbrance: { value: a.enc, adjusted: a.enc }, price: { value: a.price, adjusted: a.price },
    rarity: { value: a.rarity, adjusted: a.rarity, isrestricted: !!a.restricted }, hardpoints: { value: a.hp, adjusted: a.hp },
    itemmodifier: [], itemattachment: [], attributes: {},
  }, { img: `systems/${SYS}/images/defaults/items/armor.png`, effects: [effect(key, "(inherent)", changes, { img: `systems/${SYS}/images/defaults/items/armor.png` })] });
});

const attachmentDocs = read("attachments.json").map((a) => {
  const key = `aoe-kits|itemattachment|${a.name}`;
  return item("aoe-kits", "itemattachment", a.name, {
    description: html(a.desc), type: a.type, active: false, price: { value: a.price, adjusted: a.price },
    rarity: { value: a.rarity, adjusted: a.rarity, isrestricted: !!a.restricted }, hardpoints: { value: a.hp, adjusted: a.hp },
    encumbrance: { value: 0, adjusted: 0 }, itemmodifier: parseQualities(a.q, key), itemattachment: [],
    attributes: attrsFrom(key, a.attrs),
  }, { img: `systems/${SYS}/images/defaults/items/attachment.png`, folder: folder("aoe-kits", "Item", a.type === "weapon" ? "Armes" : "Armures") });
});

const gearDocs = readAll("gear-").map((g) => {
  const key = `aoe-materiel|gear|${g.name}`;
  const attributes = attrsFrom(key, g.attrs);
  return item("aoe-materiel", "gear", g.name, {
    description: html(g.desc), encumbrance: { value: g.enc, adjusted: g.enc }, price: { value: g.price, adjusted: g.price },
    rarity: { value: g.rarity, adjusted: g.rarity, isrestricted: !!g.restricted }, quantity: { value: 1 },
    itemmodifier: [], itemattachment: [], attributes,
  }, {
    img: `systems/${SYS}/images/defaults/items/gear.png`, folder: folder("aoe-materiel", "Item", g.cat),
    effects: [effect(key, "(inherent)", [{ key: "system.stats.encumbrance.value", value: g.enc }], { img: `systems/${SYS}/images/defaults/items/gear.png` }), ...attrEffects(key, attributes)],
  });
});

// ---------------------------------------------------------------- espèces
const speciesDocs = read("species.json").map((s) => {
  const key = `aoe-especes|species|${s.name}`;
  const attributes = {};
  for (const [c, v] of Object.entries(s.chars)) attributes[c] = { mod: c, modtype: "Characteristic", value: v, exclude: true };
  attributes.Wounds = { mod: "Wounds", modtype: "Stat", value: s.wounds, exclude: true };
  attributes.Strain = { mod: "Strain", modtype: "Stat", value: s.strain, exclude: true };
  for (const [sk, r] of s.skills) attributes[sk] = { mod: sk, modtype: "Skill Rank", value: r, exclude: false };
  const changes = [];
  for (const [k, a] of Object.entries(attributes)) {
    for (const c of explodeMod(a.modtype, k)) {
      const p = getModKeyPath(c.modType, c.mod);
      let value = a.value;
      if (p === "system.stats.wounds.max") value = s.wounds + s.chars.Brawn;
      else if (p === "system.stats.strain.max") value = s.strain + s.chars.Willpower;
      else if (p === "system.stats.encumbrance.max") value = s.chars.Brawn + 5;
      changes.push({ key: p, value });
    }
  }
  const talents = {};
  for (const tn of s.talents) { const t = talentByName(tn); talents[t._id] = { name: t.name, source: uuid("aoe-talents", t), id: t._id }; }
  const abilities = {};
  s.abilities.forEach((a, i) => { abilities[id(`${key}|ab|${i}`)] = { name: a.name, type: "ability", system: { description: html(a.desc) } }; });
  return item("aoe-especes", "species", s.name, { description: html(s.desc), attributes, talents, abilities, startingXP: s.xp },
    { img: "icons/svg/mystery-man.svg", effects: [effect(key, "(inherent)", changes, { img: "icons/svg/mystery-man.svg" })] });
});

// ---------------------------------------------------------------- spécialisations / carrières
const TREES = read("trees.json");
const CAREERS = read("careers.json");
const titleCase = (s) => s.toLocaleLowerCase("fr").replace(/^./, (c) => c.toLocaleUpperCase("fr"));
const specDocs = TREES.map((t) => {
  const key = `aoe-specialisations|specialization|${t.spec}`;
  const talents = {}; const effects = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 4; c++) {
      const raw = t.grid[r][c].replace(/\s+".*$/, "").replace(/’/g, "'");
      const tal = talentByName(titleCase(raw));
      const attributes = {};
      for (const [k, a] of Object.entries(tal.system.attributes)) attributes[`attr${id(`${key}|${r}|${c}|${k}`).slice(0, 10)}`] = a;
      const entry = {
        name: tal.name, description: tal.system.description, activation: tal.system.activation.value, activationLabel: tal.system.activation.label,
        isForceTalent: tal.system.isForceTalent, isConflictTalent: false, isRanked: tal.system.ranks.ranked, size: "single",
        canLinkTop: true, canLinkRight: true, itemId: tal._id, pack: `${SYS}.aoe-talents`, attributes, longDesc: "",
      };
      if (t.up[r][c]) entry["links-top-1"] = true;
      if (c < 3 && t.right[r][c]) entry["links-right"] = true;
      talents[`talent${r * 4 + c}`] = entry;
      effects.push(...attrEffects(`${key}|${r}|${c}`, attributes, { disabled: true }));
    }
  }
  const bonus = t.bonusSkills ? skillList(t.bonusSkills) : [];
  const careerSkills = {}; for (let i = 0; i < 5; i++) careerSkills[`careerSkill${i}`] = bonus[i] || "(none)";
  const inherent = effect(key, "(inherent)", Array.from({ length: 5 }, (_, i) => ({ key: bonus[i] ? `system.skills.${bonus[i]}.careerskill` : "(none)", value: true })), { img: "icons/svg/target.svg" });
  let desc = CAREERS.specs[t.spec] || "";
  if (t.page === 288) desc = "<p><strong>Arborescence universelle.</strong> Gagnez une Valeur de Force de 1. Cette spécialité n'est liée à aucune carrière et n'apporte aucune compétence de carrière supplémentaire.</p>";
  return item("aoe-specialisations", "specialization", t.spec, {
    description: desc, talents, careerSkills, universal: t.page === 288, isReadOnly: true,
    attributes: t.page === 288 ? attrsFrom(key, [{ mod: "ForcePool", modtype: "Stat", value: 1 }]) : {},
  }, { img: "icons/svg/target.svg", folder: folder("aoe-specialisations", "Item", t.career), effects: [inherent, ...effects, ...(t.page === 288 ? attrEffects(key, attrsFrom(key, [{ mod: "ForcePool", modtype: "Stat", value: 1 }])) : [])] });
});

const careerDocs = Object.entries(CAREERS.careers).map(([name, desc]) => {
  const key = `aoe-carrieres|career|${name}`;
  const trees = TREES.filter((t) => t.career === name);
  const skills = skillList(trees[0].careerSkills);
  const careerSkills = {}; for (let i = 0; i < 8; i++) careerSkills[`careerSkill${i}`] = skills[i] || "(none)";
  const specializations = {};
  for (const t of trees) { const s = specDocs.find((d) => d.name === t.spec); specializations[s._id] = { name: s.name, source: uuid("aoe-specialisations", s), id: s._id }; }
  const inherent = effect(key, "(inherent)", Array.from({ length: 8 }, (_, i) => ({ key: skills[i] ? `system.skills.${skills[i]}.careerskill` : "(none)", value: true })), { img: "icons/svg/book.svg" });
  return item("aoe-carrieres", "career", name, { description: desc, careerSkills, specializations, signatureabilities: {}, attributes: {} },
    { img: "icons/svg/book.svg", effects: [inherent] });
});

// ---------------------------------------------------------------- pouvoirs de la Force
const forceDocs = read("forcepowers.json").map((fp) => {
  const upgrades = {};
  fp.rows.forEach((row, r) => row.forEach((u, c) => {
    const k = `upgrade${r * 4 + c}`;
    if (!u) { upgrades[k] = { visible: false, size: "single", attributes: {} }; return; }
    const e = { name: u.name, description: html(u.desc), cost: u.cost, visible: true, size: u.size || "single", attributes: {} };
    if (u.up) e["links-top-1"] = true;
    if (u.size === "double" && u.up) e["links-top-2"] = true;
    if (u.size === "triple" && u.up) { e["links-top-2"] = true; e["links-top-3"] = true; }
    if (u.right) e["links-right"] = true;
    upgrades[k] = e;
  }));
  return item("aoe-pouvoirs-force", "forcepower", fp.name, {
    description: fp.base + fp.desc, upgrades, required_force_rating: fp.minForce, base_cost: fp.baseCost, attributes: {},
  }, { img: "icons/svg/lightning.svg" });
});

// ---------------------------------------------------------------- blessures / dégâts critiques
const CRIT = read("criticals.json");
const critName = (r) => `${String(r[0]).padStart(2, "0")}-${r[1] >= 999 ? "+" : r[1]} ${r[3]}`;
const injuryDocs = CRIT.injuries.map((r) => item("aoe-critiques", "criticalinjury", r[3], { description: html(r[4]), min: r[0], max: r[1], severity: r[2], attributes: {} }, { img: "icons/svg/daze.svg", folder: folder("aoe-critiques", "Item", "Blessures critiques (personnages)") }));
const damageDocs = CRIT.damage.map((r) => item("aoe-critiques", "criticaldamage", r[3], { description: html(r[4]), min: r[0], max: r[1], severity: r[2], attributes: {} }, { img: "icons/svg/explosion.svg", folder: folder("aoe-critiques", "Item", "Dégâts critiques (véhicules)") }));
void critName;

// ---------------------------------------------------------------- acteurs
function actor(pack, type, name, system, items, { img, folder: fld = null, flags = {}, prototypeToken = {} } = {}) {
  const key = `${pack}|${type}|${name}`;
  return {
    _id: id(key), _key: key, name, type, img: img || "icons/svg/mystery-man.svg", system, items, effects: [], folder: fld, sort: 0,
    ownership: { default: 0 }, flags: { [SYS]: { ffgimportid: `aoe-${type}-${id(key).slice(0, 8)}` }, ...flags },
    prototypeToken: { name, actorLink: false, disposition: -1, displayName: 20, displayBars: 20, bar1: { attribute: "stats.wounds" }, bar2: { attribute: type === "vehicle" ? "stats.systemStrain" : "stats.strain" }, ...prototypeToken },
    _stats: STATS,
  };
}
const embedded = (ownerKey, type, name, system, img, i) => ({
  _id: id(`${ownerKey}|${type}|${name}|${i}`), name, type, img, system: { ...system, metadata: { tags: [type], sources: [SOURCE] } },
  effects: [], folder: null, sort: i * 100, ownership: { default: 0 }, flags: {}, _stats: STATS,
});

const CHARS = ["Brawn", "Agility", "Intellect", "Cunning", "Willpower", "Presence"];
const advDocs = readAll("adversaries-").map((a) => {
  const key = `aoe-adversaires|${a.type}|${a.name}`;
  const characteristics = Object.fromEntries(CHARS.map((c, i) => [c, { value: a.c[i] }]));
  const skills = {};
  const attributes = {};
  for (const part of splitTop(a.skills)) {
    const m = part.match(/^(.*?)(?:\s+(\d+))?$/);
    const nm = m[1].trim(); const rank = m[2] ? parseInt(m[2], 10) : 0;
    const keys = /tous types/i.test(nm) ? KNOWLEDGE : [skillKey(nm)];
    for (const k of keys) {
      if (a.type === "minion") skills[k] = { groupskill: true };
      else { skills[k] = { rank }; attributes[k] = { key: k, mod: k, modtype: "Skill Rank", value: rank }; }
    }
  }
  const items = [];
  let i = 0;
  for (const w of a.weapons || []) {
    items.push(embedded(key, "weapon", w.name, {
      description: w.note ? html(w.note) : "", damage: { value: w.dmg, adjusted: w.dmg }, crit: { value: w.crit, adjusted: w.crit },
      range: { value: w.range, adjusted: w.range }, skill: { value: w.skill, useBrawn: false }, characteristic: { value: "" },
      special: { value: w.q.join(", ") }, itemmodifier: parseQualities(w.q, `${key}|w${i}`), itemattachment: [], attributes: {},
      equippable: { value: true, equipped: true },
    }, `systems/${SYS}/images/defaults/items/weapon.png`, i++));
  }
  for (const ar of a.armour || []) {
    items.push(embedded(key, "armour", ar.name, { description: "", soak: { value: ar.soak, adjusted: ar.soak }, defence: { value: ar.def, adjusted: ar.def }, itemmodifier: [], itemattachment: [], attributes: {} }, `systems/${SYS}/images/defaults/items/armor.png`, i++));
  }
  for (const g of a.gear || []) items.push(embedded(key, "gear", g, { description: "", itemmodifier: [], itemattachment: [], attributes: {} }, `systems/${SYS}/images/defaults/items/gear.png`, i++));
  if (a.talents && a.talents !== "aucun") {
    for (const part of splitTop(a.talents)) {
      const m = part.match(/^([^(]*?)(?:\s+(\d+))?\s*(?:\((.*)\))?$/s);
      const nm = m[1].trim(); const rank = m[2] ? parseInt(m[2], 10) : 1;
      let desc = m[3] ? html(m[3]) : "";
      let ranked = !!m[2];
      try { const t = talentByName(nm); desc = t.system.description; ranked = t.system.ranks.ranked; } catch { /* talent propre aux PNJ */ }
      items.push(embedded(key, "talent", nm, { description: desc, activation: { value: "Passive", label: "SWFFG.TalentActivationsPassive" }, ranks: { ranked, current: rank, min: 0 }, attributes: {} }, "icons/svg/upgrade.svg", i++));
    }
  }
  if (Array.isArray(a.abilities)) {
    for (const ab of a.abilities) items.push(embedded(key, "ability", ab.name, { description: html(ab.desc), attributes: {} }, "icons/svg/aura.svg", i++));
  }
  const stats = { soak: { value: a.soak }, defence: { melee: a.def[0], ranged: a.def[1] } };
  const system = { biography: html(a.desc), characteristics, skills, attributes, metadata: { tags: [a.type, a.group], sources: [SOURCE] } };
  if (a.type === "minion") { system.unit_wounds = { value: a.wounds }; system.quantity = { value: 1, max: 1 }; stats.wounds = { value: 0, min: 0, max: a.wounds }; }
  else { stats.wounds = { value: 0, min: 0, max: a.wounds }; stats.strain = { value: 0, min: 0, max: a.strain ?? a.wounds }; }
  if (a.force) stats.forcePool = { value: 0, max: a.force };
  system.stats = stats;
  const img = a.droid ? "icons/svg/statue.svg" : a.creature ? "icons/svg/skull.svg" : "icons/svg/mystery-man.svg";
  return actor("aoe-adversaires", a.type, a.name, system, items, {
    img, folder: folder("aoe-adversaires", "Actor", a.group),
    flags: { [SYS]: { ffgimportid: `aoe-adv-${id(key).slice(0, 8)}`, config: { enableAutoSoakCalculation: false, enableCriticalInjuries: a.type !== "minion" } } },
  });
});

const vehicleDocs = readAll("vehicles-").map((v) => {
  const key = `aoe-vehicules|vehicle|${v.name}`;
  const [fore, port, starboard, aft] = v.def.map((x) => x ?? 0);
  const consumables = (() => { const m = (v.consumables || "").match(/(\d+)\s*(.*)/); return m ? { value: parseInt(m[1], 10), duration: m[2] } : { value: 0, duration: "" }; })();
  const items = (v.weapons || []).map((w, i) => {
    const firingarc = { fore: false, aft: false, port: false, starboard: false, dorsal: false, ventral: false };
    for (const a of w.arcs) firingarc[a] = true;
    return embedded(key, "shipweapon", w.name, {
      description: w.note ? html(w.note) : "", damage: { value: w.dmg, adjusted: w.dmg }, crit: { value: w.crit, adjusted: w.crit },
      range: { value: w.range, adjusted: w.range }, skill: { value: "Gunnery" }, firingarc, special: { value: w.q.join(", ") },
      itemmodifier: parseQualities(w.q, `${key}|w${i}`), itemattachment: [], attributes: {}, equippable: { value: true, equipped: true },
    }, `systems/${SYS}/images/defaults/items/weapon.png`, i);
  });
  const extra = [`<p><strong>Type de véhicule/Modèle :</strong> ${v.model}</p>`, `<p><strong>Constructeur :</strong> ${v.maker}</p>`];
  if (v.alt) extra.push(`<p><strong>Altitude maximale :</strong> ${v.alt}</p>`);
  extra.push(`<p><strong>Équipage :</strong> ${v.crew}</p>`);
  if (v.space) extra.push(`<p><strong>Naviordinateur :</strong> ${v.navi}</p>`);
  const system = {
    biography: html(v.desc) + extra.join(""), spaceShip: !!v.space,
    stats: {
      silhouette: { value: v.sil }, speed: { value: 0, max: v.speed }, handling: { value: v.handling },
      hullTrauma: { value: 0, min: 0, max: v.hull }, systemStrain: { value: 0, min: 0, max: v.strain },
      shields: { fore, port, starboard, aft }, armour: { value: v.armour, adjusted: v.armour },
      sensorRange: { value: v.sensor }, passengerCapacity: { value: v.pass }, encumbrance: { value: 0, min: 0, max: v.enc, adjusted: 0 },
      cost: { value: v.price, adjusted: v.price }, rarity: { value: v.rarity, isrestricted: !!v.restricted, adjusted: v.rarity },
      customizationHardPoints: { value: v.hp, adjusted: v.hp },
      hyperdrive: { value: v.hyper ?? 0, backup: v.hyperBackup ?? 0 }, consumables,
      navicomputer: { value: v.navi === "oui" },
    },
    attributes: {}, itemmodifier: [], itemattachment: [], metadata: { tags: ["vehicle", v.cat], sources: [SOURCE] },
  };
  return actor("aoe-vehicules", "vehicle", v.name, system, items, { img: "icons/svg/combat.svg", folder: folder("aoe-vehicules", "Actor", v.cat), prototypeToken: { disposition: 0 } });
});

// ---------------------------------------------------------------- écriture LevelDB
const PACKS = [
  { name: "aoe-talents", label: "Talents", type: "Item", docs: talentDocs },
  { name: "aoe-armes", label: "Armes", type: "Item", docs: weaponDocs },
  { name: "aoe-armures", label: "Armures", type: "Item", docs: armourDocs },
  { name: "aoe-kits", label: "Kits d'armes et d'armures", type: "Item", docs: attachmentDocs },
  { name: "aoe-qualites", label: "Attributs d'armes", type: "Item", docs: qualityDocs },
  { name: "aoe-materiel", label: "Matériel", type: "Item", docs: gearDocs },
  { name: "aoe-especes", label: "Espèces", type: "Item", docs: speciesDocs },
  { name: "aoe-carrieres", label: "Carrières", type: "Item", docs: careerDocs },
  { name: "aoe-specialisations", label: "Spécialisations", type: "Item", docs: specDocs },
  { name: "aoe-pouvoirs-force", label: "Pouvoirs de la Force", type: "Item", docs: forceDocs },
  { name: "aoe-critiques", label: "Blessures et dégâts critiques", type: "Item", docs: [...injuryDocs, ...damageDocs] },
  { name: "aoe-vehicules", label: "Véhicules et vaisseaux", type: "Actor", docs: vehicleDocs },
  { name: "aoe-adversaires", label: "Adversaires", type: "Actor", docs: advDocs },
];

async function writePack(p) {
  const dir = path.join(OUT, p.name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const db = new ClassicLevel(dir, { keyEncoding: "utf8", valueEncoding: "json" });
  await db.open();
  const batch = db.batch();
  const coll = p.type === "Item" ? "items" : "actors";
  const seen = new Set();
  for (const f of Object.values(folderDocs[p.name] || {})) batch.put(`!folders!${f._id}`, f);
  p.docs.forEach((d, idx) => {
    if (seen.has(d._id)) throw new Error(`Identifiant en double dans ${p.name} : ${d.name}`);
    seen.add(d._id);
    const { _key, ...doc } = d;
    doc.sort = (idx + 1) * 100;
    const effects = doc.effects || [];
    doc.effects = effects.map((e) => e._id);
    if (p.type === "Actor") {
      const items = doc.items || [];
      doc.items = items.map((it) => it._id);
      for (const it of items) {
        const ie = it.effects || [];
        batch.put(`!actors.items!${doc._id}.${it._id}`, { ...it, effects: ie.map((e) => e._id) });
        for (const e of ie) batch.put(`!actors.items.effects!${doc._id}.${it._id}.${e._id}`, e);
      }
      for (const e of effects) batch.put(`!actors.effects!${doc._id}.${e._id}`, e);
    } else {
      for (const e of effects) batch.put(`!items.effects!${doc._id}.${e._id}`, e);
    }
    batch.put(`!${coll}!${doc._id}`, doc);
  });
  await batch.write();
  await db.close();
  return { name: p.name, count: p.docs.length };
}

const results = [];
for (const p of PACKS) results.push(await writePack(p));
fs.writeFileSync(path.join(SRC, "..", "packs-manifest.json"), JSON.stringify(PACKS.map((p) => ({ name: p.name, label: p.label, type: p.type, system: SYS, path: `packs/${p.name}`, ownership: { PLAYER: "OBSERVER", ASSISTANT: "OWNER" }, flags: {} })), null, 2));
console.table(results);
