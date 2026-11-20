/**
 * Tableau de combat spatial (Aux Confins de l'Empire, chapitre VII).
 *
 * - L'état de la rencontre (vaisseaux engagés, manœuvres du round, effets temporaires) est un réglage « monde ».
 * - Toute modification (état ou acteurs) est exécutée par le MJ actif : les joueurs passent par le socket.
 * - Les jets passent par la fenêtre de jet habituelle du système ; leur résultat est intercepté pour
 *   proposer l'étape suivante (dégâts, critique, réparation…) dans le chat.
 */
import { DicePoolFFG } from "../dice/pool.js";
import DiceHelpers, { get_dice_pool } from "../helpers/dice-helpers.js";
import * as R from "./space-combat-rules.js";
import { GUIDE_HTML } from "./space-combat-guide.js";

const SYS = "starwarsffg-v14";
const SETTING = "spaceCombatState";
const SOCKET = `system.${SYS}`;
const CRIT_PACK = `${SYS}.aoe-critiques`;
const CREW_TYPES = ["character", "nemesis", "rival", "minion"];

const { ApplicationV2, DialogV2 } = foundry.applications.api;

/* -------------------------------------------------------------------------- */
/*  Outils                                                                    */
/* -------------------------------------------------------------------------- */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);

const DIE_TAGS = {
  AB: ["ability", "d", true], PR: ["proficiency", "c", true], BO: ["boost", "b", true],
  DI: ["difficulty", "d", true], CH: ["challenge", "c", true], SE: ["setback", "b", true],
  SU: ["success", "s"], FA: ["failure", "f"], AD: ["advantage", "a"], TH: ["threat", "t"],
  TR: ["triumph", "x"], DE: ["despair", "y"], FO: ["force", "C"], FP: ["forcepoint", "Y"],
};

/** Remplace les balises [DI], [AD]… par les symboles de dés du système (version synchrone de l'enricher). */
function dice(text) {
  return String(text ?? "").replace(/\[(AB|PR|BO|DI|CH|SE|SU|FA|AD|TH|TR|DE|FO|FP)\]/g, (m, tag) => {
    const [cls, letter, sw] = DIE_TAGS[tag];
    return `<span class="dietype ${sw ? "starwars" : (game.settings.get(SYS, "dicetheme") || "starwars")} ${cls}">${letter}</span>`;
  });
}

const diffDice = (n) => (n > 0 ? "[DI]".repeat(n) : "—");
const diffLabel = (n) => `${R.DIFFICULTY_NAMES[Math.min(n, 5)] ?? n} (${diffDice(n)})`;
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

function emptyState() {
  return { round: 1, ships: [], duels: {} };
}

function getState() {
  const s = foundry.utils.deepClone(game.settings.get(SYS, SETTING) ?? {});
  return foundry.utils.mergeObject(emptyState(), s, { inplace: false });
}

async function saveState(state) {
  await game.settings.set(SYS, SETTING, state);
}

/** Acteur (éventuellement synthétique, pour un jeton non lié) d'un vaisseau engagé. */
function shipActor(ship) {
  let doc = null;
  try {
    doc = fromUuidSync(ship.uuid, { strict: false });
  } catch (e) {
    doc = null;
  }
  if (!doc) return null;
  return doc instanceof Actor ? doc : (doc.actor ?? null);
}

function stats(actor) {
  const s = actor.system.stats;
  return {
    sil: Number(s.silhouette?.value ?? 0),
    speed: Number(s.speed?.value ?? 0),
    maxSpeed: Number(s.speed?.max ?? 0),
    handling: Number(s.handling?.value ?? 0),
    armour: Number(s.armour?.adjusted ?? s.armour?.value ?? 0) || Number(s.armour?.value ?? 0),
    hull: Number(s.hullTrauma?.value ?? 0),
    hullMax: Number(s.hullTrauma?.max ?? 0),
    strain: Number(s.systemStrain?.value ?? 0),
    strainMax: Number(s.systemStrain?.max ?? 0),
    shields: {
      fore: Number(s.shields?.fore ?? 0),
      aft: Number(s.shields?.aft ?? 0),
      port: Number(s.shields?.port ?? 0),
      starboard: Number(s.shields?.starboard ?? 0),
    },
  };
}

function pilotLimit(sil) {
  return sil <= 4 ? 2 : 1;
}

/** Une manœuvre/un avantage posé au round r dure « jusqu'à la fin du prochain tour » : il expire au round r + 2. */
function isActive(round, current) {
  return round !== undefined && round !== null && current - round <= 1;
}

function weaponStats(w) {
  const sys = w.system;
  // Les attributs peuvent figurer à la fois dans « special » et dans les modificateurs : on dédoublonne.
  const parts = [sys.special?.value ?? "", ...(sys.itemmodifier ?? []).map((m) => `${m.name} ${m.system?.rank ?? ""}`)]
    .join(",").split(",").map((q) => q.trim()).filter(Boolean);
  const seen = new Set();
  const quals = parts.filter((q) => {
    const k = q.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).join(", ");
  const arcs = Object.entries(sys.firingarc ?? {}).filter(([, v]) => v).map(([k]) => R.ARCS[k] ?? k);
  return {
    id: w.id,
    name: w.name,
    damage: Number(sys.damage?.adjusted || sys.damage?.value || 0),
    crit: Number(sys.crit?.adjusted || sys.crit?.value || 0),
    range: R.RANGES[sys.range?.adjusted || sys.range?.value] ?? (sys.range?.value || ""),
    skill: sys.skill?.value || "Gunnery",
    arcs: arcs.length === 6 ? ["tous"] : arcs,
    special: quals.replace(/^[,\s]+|[,\s]+$/g, ""),
    q: R.parseQualities(quals),
  };
}

function skillKey(skill, actor) {
  if (skill !== "Piloting") return skill;
  const skills = CONFIG.FFG.skills ?? {};
  if (actor?.system?.spaceShip) return skills["Piloting: Space"] ? "Piloting: Space" : "Piloting";
  return skills["Piloting: Planetary"] ? "Piloting: Planetary" : "Driving";
}

function skillLabel(key) {
  const s = CONFIG.FFG.skills?.[key];
  return s?.label ? game.i18n.localize(s.label) : key;
}

async function chat(content, actor) {
  return ChatMessage.create({
    content: `<div class="starwarsffg-v14 sc-card">${content}</div>`,
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : ChatMessage.getSpeaker(),
  });
}

/** Bouton de carte de chat qui déclenche une opération (exécutée par le MJ). */
function opButton(label, op, args, icon = "fa-solid fa-check") {
  return `<button type="button" class="sc-op" data-op="${op}" data-args='${esc(JSON.stringify(args))}'><i class="${icon}"></i> ${label}</button>`;
}

/* -------------------------------------------------------------------------- */
/*  Opérations (toujours exécutées par le MJ actif)                           */
/* -------------------------------------------------------------------------- */

function findShip(state, key) {
  const ship = state.ships.find((s) => s.key === key);
  if (!ship) throw new Error("Vaisseau introuvable dans la rencontre.");
  const actor = shipActor(ship);
  if (!actor) throw new Error("L'acteur de ce vaisseau n'existe plus.");
  return { ship, actor };
}

async function checkThresholds(actor, before) {
  const st = stats(actor);
  if (st.hull > st.hullMax && before.hull <= st.hullMax) {
    if (st.sil <= 3) {
      await chat(`<h3>💥 ${esc(actor.name)} est détruit</h3><p>Seuil de dégâts de coque dépassé (${st.hull}/${st.hullMax}) : un appareil de gabarit 3 ou moins explose (p. 243).</p>`, actor);
    } else {
      await chat(`<h3>⚠ ${esc(actor.name)} : seuil de coque dépassé</h3>
        <p>Le vaisseau subit un dégât critique et part à la dérive (p. 243-244).</p>
        <p>Réparation d'urgence : test de Mécanique Difficile (${dice("[DI][DI][DI]")}) → coque = seuil − 1, vitesse 1, maniabilité −3, armes hors service ; tout critique ultérieur reçoit +30.</p>`, actor);
    }
  }
  if (st.strain > st.strainMax && before.strain <= st.strainMax) {
    await chat(`<h3>⚠ ${esc(actor.name)} : systèmes hors service</h3><p>Seuil de stress mécanique dépassé (${st.strain}/${st.strainMax}) : le vaisseau est impuissant jusqu'à ce que l'équipage le répare (contrôle des dégâts).</p>`, actor);
  }
}

const OPS = {
  async addShips({ uuids, side }) {
    const state = getState();
    let added = 0;
    for (const uuid of uuids) {
      if (state.ships.some((s) => s.uuid === uuid)) continue;
      state.ships.push({ key: foundry.utils.randomID(), uuid, side, pm: 0, fired: [], effects: {}, advantage: null, repaired: false, shieldsBase: null, boost: null });
      added++;
    }
    await saveState(state);
    return added;
  },

  async removeShip({ key }) {
    const state = getState();
    const ship = state.ships.find((s) => s.key === key);
    if (ship?.shieldsBase) {
      const actor = shipActor(ship);
      if (actor) await actor.update({ "system.stats.shields": ship.shieldsBase });
    }
    state.ships = state.ships.filter((s) => s.key !== key);
    for (const s of state.ships) if (s.advantage?.target === key) s.advantage = null;
    await saveState(state);
  },

  async setSide({ key, side }) {
    const state = getState();
    const { ship } = findShip(state, key);
    ship.side = side;
    await saveState(state);
  },

  async maneuver({ key, kind }) {
    const state = getState();
    const { ship, actor } = findShip(state, key);
    const m = R.MANEUVERS[kind];
    const st = stats(actor);
    const limit = pilotLimit(st.sil);
    if (m.pilot && ship.pm >= limit) throw new Error(`${actor.name} a déjà fait ${limit} manœuvre(s) de pilote ce round.`);
    if (st.sil > m.maxSil) throw new Error(`${m.label} : gabarit ${m.maxSil} maximum.`);
    if (st.speed < m.minSpeed) throw new Error(`${m.label} : vitesse ${m.minSpeed} minimum.`);

    const update = {};
    let strain = 0;
    const notes = [];
    if (m.pilot && ship.pm === 1) {
      strain += 2;
      notes.push("2ᵉ manœuvre de pilote : +2 stress mécanique");
    }
    switch (kind) {
      case "accelerate":
        if (st.speed >= st.maxSpeed) throw new Error("Vitesse déjà au maximum.");
        update["system.stats.speed.value"] = st.speed + 1;
        notes.push(`vitesse ${st.speed} → ${st.speed + 1}`);
        break;
      case "decelerate":
        if (st.speed <= 0) throw new Error("Le vaisseau est déjà à l'arrêt.");
        update["system.stats.speed.value"] = st.speed - 1;
        notes.push(`vitesse ${st.speed} → ${st.speed - 1}`);
        break;
      case "punch": {
        const gain = st.maxSpeed - st.speed;
        if (gain <= 0) throw new Error("Vitesse déjà au maximum.");
        update["system.stats.speed.value"] = st.maxSpeed;
        strain += gain;
        notes.push(`vitesse ${st.speed} → ${st.maxSpeed}, +${gain} stress mécanique`);
        break;
      }
      case "evasive":
        ship.effects.evasive = state.round;
        notes.push("attaques contre lui et ses propres attaques : +1 amélioration de difficulté");
        break;
      case "stick":
        ship.effects.stick = state.round;
        notes.push("ses attaques et celles contre lui : +1 amélioration d'aptitude");
        break;
      case "fly":
        notes.push(R.flyText(st.speed));
        break;
    }
    if (strain) update["system.stats.systemStrain.value"] = st.strain + strain;
    if (m.pilot) ship.pm += 1;
    if (Object.keys(update).length) await actor.update(update);
    await saveState(state);
    await chat(`<p><strong>${esc(actor.name)}</strong> — ${m.label}${notes.length ? ` : ${esc(notes.join(" ; "))}` : ""}.</p>`, actor);
    if (strain) await checkThresholds(actor, st);
  },

  async adjust({ key, field, delta }) {
    const state = getState();
    const { actor } = findShip(state, key);
    const st = stats(actor);
    const path = { speed: "speed.value", hull: "hullTrauma.value", strain: "systemStrain.value" }[field];
    if (!path) return;
    let value = { speed: st.speed, hull: st.hull, strain: st.strain }[field] + delta;
    value = Math.max(0, value);
    if (field === "speed") value = Math.min(value, st.maxSpeed);
    await actor.update({ [`system.stats.${path}`]: value });
    if (delta > 0) await checkThresholds(actor, st);
  },

  async shift({ key, from, to }) {
    const state = getState();
    const { ship, actor } = findShip(state, key);
    const st = stats(actor);
    if (from === to) return;
    if (st.shields[from] <= 0) throw new Error(`La zone ${R.ZONES[from]} n'a plus de défense à transférer.`);
    if (!ship.shieldsBase) ship.shieldsBase = { ...st.shields };
    await actor.update({
      [`system.stats.shields.${from}`]: st.shields[from] - 1,
      [`system.stats.shields.${to}`]: st.shields[to] + 1,
    });
    await saveState(state);
    await chat(`<p><strong>${esc(actor.name)}</strong> — Réorienter les boucliers : ${R.ZONES[from]} ${st.shields[from]} → ${st.shields[from] - 1}, ${R.ZONES[to]} ${st.shields[to]} → ${st.shields[to] + 1}.</p>`, actor);
  },

  async intensify({ key, zone }) {
    const state = getState();
    const { ship, actor } = findShip(state, key);
    const st = stats(actor);
    if (!ship.shieldsBase) ship.shieldsBase = { ...st.shields };
    if (ship.boost) throw new Error("Un bouclier est déjà intensifié sur ce vaisseau.");
    ship.boost = { zone, round: state.round };
    await actor.update({
      [`system.stats.shields.${zone}`]: st.shields[zone] + 1,
      "system.stats.systemStrain.value": st.strain + 1,
    });
    await saveState(state);
    await chat(`<p><strong>${esc(actor.name)}</strong> — Bouclier intensifié : ${R.ZONES[zone]} +1 jusqu'au prochain round, +1 stress mécanique.</p>`, actor);
    await checkThresholds(actor, st);
  },

  async clearEffect({ key, effect }) {
    const state = getState();
    const { ship } = findShip(state, key);
    if (effect === "advantage") ship.advantage = null;
    else delete ship.effects[effect];
    await saveState(state);
  },

  async markFired({ key, weaponId }) {
    const state = getState();
    const { ship } = findShip(state, key);
    if (!ship.fired.includes(weaponId)) ship.fired.push(weaponId);
    await saveState(state);
  },

  async applyDamage({ key, amount, ion }) {
    const state = getState();
    const { actor } = findShip(state, key);
    const st = stats(actor);
    if (ion) await actor.update({ "system.stats.systemStrain.value": st.strain + amount });
    else await actor.update({ "system.stats.hullTrauma.value": st.hull + amount });
    await chat(`<p><strong>${esc(actor.name)}</strong> subit ${amount} ${ion ? "point(s) de stress mécanique (arme ionique)" : "point(s) de dégâts de coque"}.</p>`, actor);
    await checkThresholds(actor, st);
  },

  async repair({ key, what, amount, encounter }) {
    const state = getState();
    const { ship, actor } = findShip(state, key);
    const st = stats(actor);
    if (what === "hull") {
      if (encounter && ship.repaired) throw new Error("La coque a déjà été réparée pendant cette rencontre.");
      await actor.update({ "system.stats.hullTrauma.value": Math.max(0, st.hull - amount) });
      if (encounter) {
        ship.repaired = true;
        await saveState(state);
      }
    } else {
      await actor.update({ "system.stats.systemStrain.value": Math.max(0, st.strain - amount) });
    }
    await chat(`<p><strong>${esc(actor.name)}</strong> — réparation : −${amount} ${what === "hull" ? "dégâts de coque" : "stress mécanique"}.</p>`, actor);
  },

  async rollCrit({ key, bonus = 0, collision = null }) {
    const state = getState();
    const { actor } = findShip(state, key);
    const existing = actor.items.filter((i) => i.type === "criticaldamage").length;
    const roll = await new Roll("1d100").evaluate();
    let total = roll.total + existing * 10 + Number(bonus || 0);
    const parts = [`d100 = ${roll.total}`];
    if (existing) parts.push(`+${existing * 10} (${existing} critique(s) non réparé(s))`);
    if (bonus) parts.push(`${signed(Number(bonus))} (bonus)`);
    if (collision) {
      const minus = collision.defense * (collision.major ? 5 : 10);
      total -= minus;
      parts.push(`−${minus} (collision ${collision.major ? "majeure" : "mineure"}, défense ${collision.defense})`);
    }
    if (collision && total <= 0) {
      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor: `<div class="starwarsffg-v14 sc-card"><h3>Collision ${collision.major ? "majeure" : "mineure"} — ${esc(actor.name)}</h3><p>${esc(parts.join(" "))} = <strong>${total}</strong></p><p>Les boucliers absorbent le choc : aucun dégât critique.</p></div>`,
      });
      return;
    }
    const pack = game.packs.get(CRIT_PACK);
    let entry = null;
    if (pack) {
      const docs = (await pack.getDocuments()).filter((d) => d.type === "criticaldamage").sort((a, b) => a.system.min - b.system.min);
      entry = docs.find((d) => total >= d.system.min && total <= d.system.max) ?? (total > (docs.at(-1)?.system.max ?? 0) ? docs.at(-1) : docs[0]);
    }
    let body;
    if (entry) {
      const data = entry.toObject();
      delete data._id;
      foundry.utils.setProperty(data, `flags.${SYS}.spaceCombat.total`, total);
      await actor.createEmbeddedDocuments("Item", [data]);
      const sev = entry.system.severity;
      body = `<h4>${esc(entry.name)} <small>(${sev >= 5 ? "irréparable" : `réparation : ${diffLabel(sev)}`})</small></h4>${await foundry.applications.ux.TextEditor.enrichHTML(entry.system.description ?? "")}`;
    } else {
      body = `<p>Compendium des critiques introuvable : consultez la table 7-9 (p. 245) pour le résultat ${total}.</p>`;
    }
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `<div class="starwarsffg-v14 sc-card"><h3>Dégât critique — ${esc(actor.name)}</h3><p>${esc(parts.join(" "))} = <strong>${total}</strong></p>${dice(body)}</div>`,
    });
  },

  async repairCrit({ key, itemId }) {
    const state = getState();
    const { actor } = findShip(state, key);
    const item = actor.items.get(itemId);
    if (!item) return;
    await item.delete();
    await chat(`<p><strong>${esc(actor.name)}</strong> — dégât critique réparé : ${esc(item.name)}.</p>`, actor);
  },

  async setAdvantage({ key, target }) {
    const state = getState();
    const { ship, actor } = findShip(state, key);
    const { actor: tActor } = findShip(state, target);
    ship.advantage = { target, round: state.round };
    const tShip = state.ships.find((s) => s.key === target);
    if (tShip?.advantage?.target === key) tShip.advantage = null;
    const duel = [key, target].sort().join("|");
    state.duels[duel] = (state.duels[duel] ?? 0) + 1;
    await saveState(state);
    await chat(`<p><strong>${esc(actor.name)}</strong> prend l'avantage sur <strong>${esc(tActor.name)}</strong> : il ignore ses manœuvres d'évasion et choisit la zone touchée jusqu'à la fin du prochain round.</p>`, actor);
  },

  async nextRound() {
    const state = getState();
    state.round += 1;
    for (const ship of state.ships) {
      ship.pm = 0;
      ship.fired = [];
      for (const [k, r] of Object.entries(ship.effects)) if (!isActive(r, state.round)) delete ship.effects[k];
      if (ship.advantage && !isActive(ship.advantage.round, state.round)) ship.advantage = null;
      if (ship.boost && ship.boost.round < state.round) {
        const actor = shipActor(ship);
        if (actor) {
          const cur = stats(actor).shields[ship.boost.zone];
          await actor.update({ [`system.stats.shields.${ship.boost.zone}`]: Math.max(0, cur - 1) });
        }
        ship.boost = null;
      }
    }
    await saveState(state);
  },

  async endEncounter({ clear }) {
    const state = getState();
    for (const ship of state.ships) {
      const actor = shipActor(ship);
      if (actor && ship.shieldsBase) await actor.update({ "system.stats.shields": ship.shieldsBase });
      Object.assign(ship, { pm: 0, fired: [], effects: {}, advantage: null, repaired: false, shieldsBase: null, boost: null });
    }
    state.round = 1;
    state.duels = {};
    if (clear) state.ships = [];
    await saveState(state);
  },
};

/** Exécute une opération : directement pour le MJ, sinon via le socket. */
async function exec(op, args = {}) {
  if (game.user.isGM) {
    try {
      return await OPS[op](args);
    } catch (err) {
      ui.notifications.warn(err.message);
      return null;
    }
  }
  if (!game.users.activeGM) {
    ui.notifications.warn("Aucun MJ connecté : l'action ne peut pas être appliquée.");
    return null;
  }
  game.socket.emit(SOCKET, { eventType: "spaceCombat", op, args, userId: game.user.id });
  return null;
}

function onSocket(data) {
  if (data?.eventType === "spaceCombat-error" && data.userId === game.user.id) {
    ui.notifications.warn(data.message);
    return;
  }
  if (data?.eventType !== "spaceCombat" || game.user.id !== game.users.activeGM?.id) return;
  if (!OPS[data.op]) return;
  OPS[data.op](data.args ?? {}).catch((err) => {
    game.socket.emit(SOCKET, { eventType: "spaceCombat-error", userId: data.userId, message: err.message });
  });
}

/* -------------------------------------------------------------------------- */
/*  Jets                                                                      */
/* -------------------------------------------------------------------------- */

/** Jet en attente : son résultat (prochain message de jet de cet utilisateur) déclenche la suite. */
let pending = null;

function crewChoices(actor, preferRole) {
  const crew = actor.getFlag(SYS, "crew") ?? [];
  const roles = game.settings.get(SYS, "arrayCrewRoles") ?? [];
  const byActor = new Map();
  for (const c of crew) {
    if (!game.actors.get(c.actor_id)) continue;
    const entry = byActor.get(c.actor_id) ?? { id: c.actor_id, name: c.actor_name, roles: [] };
    entry.roles.push(c.role);
    byActor.set(c.actor_id, entry);
  }
  const list = [...byActor.values()].map((e) => ({ ...e, group: "Équipage" }));
  const others = game.actors.filter((a) => CREW_TYPES.includes(a.type) && !byActor.has(a.id) && (game.user.isGM || a.isOwner));
  const mine = game.user.character;
  for (const a of others.sort((x, y) => (x === mine ? -1 : y === mine ? 1 : x.name.localeCompare(y.name)))) {
    list.push({ id: a.id, name: a.name, roles: [], group: "Autres personnages" });
  }

  const matches = (e) => e.roles.some((r) => {
    const def = roles.find((x) => x.role_name === r);
    if (preferRole === "gunner") return def?.use_weapons || /gunner|artill|canon/i.test(r);
    if (preferRole === "pilot") return /pilot/i.test(r);
    if (preferRole === "engineer") return def?.role_skill === "Mechanics" || /engineer|ing[ée]n|m[ée]can/i.test(r);
    return false;
  });
  const preferred = list.find(matches) ?? list.find((e) => e.group === "Équipage") ?? (mine && list.find((e) => e.id === mine.id));
  return { list, selected: preferred?.id ?? "" };
}

function crewSelectHTML(actor, preferRole) {
  const { list, selected } = crewChoices(actor, preferRole);
  const groups = {};
  for (const e of list) (groups[e.group] ??= []).push(e);
  let html = `<option value="">— Aucun (réserve à compléter à la main) —</option>`;
  for (const [g, entries] of Object.entries(groups)) {
    html += `<optgroup label="${esc(g)}">${entries.map((e) => `<option value="${e.id}" ${e.id === selected ? "selected" : ""}>${esc(e.name)}${e.roles.length ? ` (${esc(e.roles.join(", "))})` : ""}</option>`).join("")}</optgroup>`;
  }
  return `<select name="crew">${html}</select>`;
}

/**
 * Ouvre la fenêtre de jet du système avec une réserve préparée.
 * @param {object} o
 */
async function openRoll({ actor, crewId, skill, difficulty = 2, upDifficulty = 0, upAbility = 0, boost = 0, setback = 0, item = null, title, next }) {
  let pool = new DicePoolFFG({ difficulty, boost, setback });
  let rollData = { actor: { _id: null }, token: { name: actor.name } };
  const key = skillKey(skill, actor);
  if (crewId) {
    const crew = game.actors.get(crewId);
    try {
      pool = get_dice_pool(crewId, key, pool);
      rollData = crew.sheet;
    } catch (err) {
      ui.notifications.warn(`${crew?.name ?? "Ce personnage"} n'a pas la compétence ${skillLabel(key)} : réserve à compléter à la main.`);
    }
  }
  if (upDifficulty > 0) pool.upgradeDifficulty(upDifficulty);
  if (upAbility > 0) pool.upgrade(upAbility);
  if (item) pool = new DicePoolFFG(await DiceHelpers.getModifiers(pool, item));
  pending = next ? { ...next, userId: game.user.id, time: Date.now() } : null;
  const rollItem = item ?? { crew: { name: actor.name, img: actor.img, crew_card: true, role: title } };
  await DiceHelpers.displayRollDialog(rollData, pool, `${title} — ${skillLabel(key)}`, skillLabel(key), rollItem);
}

/** Traite le résultat d'un jet lancé depuis le tableau. */
async function onRollResult(p, r) {
  const state = getState();
  const ship = state.ships.find((s) => s.key === p.key);
  const actor = ship ? shipActor(ship) : null;
  if (!actor) return;
  const success = Number(r.success ?? 0);
  const adv = Number(r.advantage ?? 0);
  const tri = Number(r.triumph ?? 0);
  const des = Number(r.despair ?? 0);
  const threat = Number(r.threat ?? 0);
  const ok = success > 0;
  const symbols = `${success} [SU] · ${adv} [AD] · ${threat} [TH]${tri ? ` · ${tri} [TR]` : ""}${des ? ` · ${des} [DE]` : ""}`;
  const spendHint = (adv || tri || threat || des) ? `<p class="sc-hint">Avantages et menaces : voir l'onglet <em>Aide-mémoire</em> du tableau (tables 7-5 et 7-6).</p>` : "";

  switch (p.type) {
    case "attack": {
      await exec("markFired", { key: p.key, weaponId: p.weaponId });
      const tShip = state.ships.find((s) => s.key === p.target);
      const tActor = tShip ? shipActor(tShip) : null;
      const weapon = actor.items.get(p.weaponId);
      if (!tActor || !weapon) return;
      const w = weaponStats(weapon);
      if (!ok) {
        await chat(dice(`<h3>${esc(weapon.name)} : raté</h3><p>${esc(actor.name)} manque ${esc(tActor.name)}. ${symbols}</p>${spendHint}${des ? `<p>${dice("[DE]")} : l'arme principale peut subir un dégât critique de composant, ou collision mineure (table 7-6).</p>` : ""}`), actor);
        return;
      }
      const tst = stats(tActor);
      const out = R.attackOutcome({ weaponDamage: w.damage, successes: success, armour: tst.armour, breach: w.q.breach, critRating: w.crit, advantages: adv, triumphs: tri });
      const zone = R.ZONES[p.zone] ?? "";
      let html = `<h3>${esc(weapon.name)} : touché !</h3>
        <p>${esc(actor.name)} → <strong>${esc(tActor.name)}</strong>${zone ? ` (zone ${zone})` : ""}. ${symbols}</p>
        <p>Dégâts ${w.damage} + ${success} succès = <strong>${out.damage}</strong> − blindage ${out.armour}${w.q.breach ? ` (Brèche ${w.q.breach})` : ""} = <strong>${out.hull}</strong> ${w.q.ion ? "stress mécanique (Ionique)" : "dégâts de coque"}.</p>`;
      const buttons = [];
      if (out.hull > 0) buttons.push(opButton(`Appliquer ${out.hull} ${w.q.ion ? "stress" : "coque"} à ${esc(tActor.name)}`, "applyDamage", { key: p.target, amount: out.hull, ion: w.q.ion }, "fa-solid fa-burst"));
      if (w.q.linked && out.hull > 0) {
        html += `<p>Jumelé ${w.q.linked} : [AD][AD] par touche supplémentaire (même dégâts), jusqu'à ${w.q.linked}.</p>`;
        buttons.push(opButton(`Touche supplémentaire (+${out.hull})`, "applyDamage", { key: p.target, amount: out.hull, ion: w.q.ion }, "fa-solid fa-plus"));
      }
      if (out.hull > 0) {
        html += out.crit
          ? `<p><strong>Dégât critique déclenché</strong> (${tri ? "[TR]" : `${w.crit} [AD]`}). Chaque critique supplémentaire acheté : +10 au jet.</p>`
          : `<p>Critique : ${w.crit ? `${w.crit} [AD]` : "—"} ou [TR] nécessaires.</p>`;
        buttons.push(`<button type="button" class="sc-crit" data-key="${p.target}"><i class="fa-solid fa-explosion"></i> Jet de critique</button>`);
      } else {
        html += `<p>Le blindage absorbe tout : pas de dégât de coque, donc pas de critique possible.</p>`;
      }
      if (w.q.slowFiring) html += `<p>Cadence lente ${w.q.slowFiring} : l'arme doit attendre ${w.q.slowFiring} round(s) avant de retirer.</p>`;
      if (w.q.blast) html += `<p>Souffle ${w.q.blast} : [AD][AD] (ou selon l'arme) pour toucher les cibles proches.</p>`;
      await chat(dice(html + spendHint + `<div class="sc-buttons">${buttons.join("")}</div>`), actor);
      return;
    }
    case "advantage": {
      const tShip = state.ships.find((s) => s.key === p.target);
      const tActor = tShip ? shipActor(tShip) : null;
      if (ok) await exec("setAdvantage", { key: p.key, target: p.target });
      else await chat(dice(`<p>${esc(actor.name)} ne parvient pas à prendre l'avantage sur ${esc(tActor?.name ?? "sa cible")}. ${symbols}</p>${spendHint}`), actor);
      return;
    }
    case "repair": {
      if (!ok) {
        await chat(dice(`<p>${esc(actor.name)} — ${p.label} : échec. ${symbols}</p>${spendHint}`), actor);
        return;
      }
      let buttons = "";
      if (p.what === "strain") {
        buttons = opButton("Retirer 1 stress (livre FR)", "repair", { key: p.key, what: "strain", amount: 1 }, "fa-solid fa-wrench")
          + (success > 1 ? opButton(`Retirer ${success} stress (1 par succès, règle VO)`, "repair", { key: p.key, what: "strain", amount: success }, "fa-solid fa-wrench") : "");
      } else if (p.what === "hull") {
        const amount = p.manual ? 1 + Math.floor((success - 1) / 2) : 1;
        buttons = opButton(`Retirer ${amount} coque`, "repair", { key: p.key, what: "hull", amount, encounter: true }, "fa-solid fa-wrench")
          + (!p.manual && success > 1 ? opButton(`Retirer ${success} coque (1 par succès, règle VO)`, "repair", { key: p.key, what: "hull", amount: success, encounter: true }, "fa-solid fa-wrench") : "");
      } else if (p.what === "crit") {
        buttons = opButton(`Réparer : ${esc(p.critName)}`, "repairCrit", { key: p.key, itemId: p.itemId }, "fa-solid fa-screwdriver-wrench");
      }
      await chat(dice(`<h3>${esc(actor.name)} — ${esc(p.label)} : réussi</h3><p>${symbols}</p><div class="sc-buttons">${buttons}</div>`), actor);
      return;
    }
    case "terrain": {
      await chat(dice(ok
        ? `<p>${esc(actor.name)} négocie le terrain sans encombre. ${symbols}</p>${spendHint}`
        : `<h3>${esc(actor.name)} : manœuvre ratée</h3><p>${symbols}</p><p>Le pilote doit réduire sa vitesse ou n'atteint pas le point visé (p. 241).${des ? " Avec [DE], le MJ peut décider d'une collision." : ""}</p>${spendHint}`), actor);
      return;
    }
    case "crewAction": {
      const a = R.CREW_ACTIONS.find((x) => x.key === p.action);
      let buttons = "";
      if (ok && a.key === "boost") {
        buttons = R.zonesFor(stats(actor).sil).map((z) => opButton(`+1 défense ${R.ZONES[z]}`, "intensify", { key: p.key, zone: z }, "fa-solid fa-shield-halved")).join("");
      }
      if (ok && a.key === "manual") {
        const amount = 1 + Math.floor((success - 1) / 2);
        buttons = opButton(`Retirer ${amount} coque`, "repair", { key: p.key, what: "hull", amount, encounter: true }, "fa-solid fa-wrench");
      }
      await chat(dice(`<h3>${esc(actor.name)} — ${esc(a.label)} : ${ok ? "réussi" : "échec"}</h3><p>${symbols}</p>${ok ? `<p>${a.result}</p>` : ""}${spendHint}<div class="sc-buttons">${buttons}</div>`), actor);
      return;
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Dialogues                                                                 */
/* -------------------------------------------------------------------------- */

async function form(title, content, label = "Lancer", renderCb) {
  return DialogV2.wait({
    window: { title },
    classes: ["starwarsffg-v14", "sc-dialog"],
    position: { width: 460 },
    content,
    rejectClose: false,
    render: renderCb,
    buttons: [
      { action: "ok", label, icon: "fa-solid fa-dice-d20", default: true, callback: (ev, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
      { action: "cancel", label: "Annuler" },
    ],
  }).then((r) => (r && typeof r === "object" ? r : null));
}

async function attackDialog(state, key) {
  const { ship, actor } = findShip(state, key);
  const weapons = actor.items.filter((i) => i.type === "shipweapon").map(weaponStats);
  if (!weapons.length) return ui.notifications.warn(`${actor.name} n'a aucune arme de vaisseau.`);
  const targets = state.ships.filter((s) => s.key !== key && shipActor(s));
  if (!targets.length) return ui.notifications.warn("Aucune cible dans la rencontre.");
  const defaultTarget = targets.find((s) => s.side !== ship.side) ?? targets[0];
  const unfired = weapons.find((w) => !ship.fired.includes(w.id)) ?? weapons[0];

  const content = `
    <div class="form-group"><label>Tireur</label>${crewSelectHTML(actor, "gunner")}</div>
    <div class="form-group"><label>Arme</label><select name="weapon">${weapons.map((w) => `<option value="${w.id}" ${w.id === unfired.id ? "selected" : ""}>${esc(w.name)}${ship.fired.includes(w.id) ? " (a déjà tiré)" : ""}</option>`).join("")}</select></div>
    <div class="form-group"><label>Cible</label><select name="target">${targets.map((s) => `<option value="${s.key}" ${s.key === defaultTarget.key ? "selected" : ""}>${esc(shipActor(s).name)}</option>`).join("")}</select></div>
    <div class="form-group"><label>Zone visée</label><select name="zone"></select></div>
    <div class="form-group"><label>Dés en plus</label>
      <span class="sc-inline">[BO] <input type="number" name="boost" value="0" min="0" max="9"> [SE] <input type="number" name="setback" value="0" min="0" max="9"></span></div>
    <div class="sc-summary"></div>`;

  const compute = (fd) => {
    const w = weapons.find((x) => x.id === fd.weapon) ?? weapons[0];
    const t = state.ships.find((s) => s.key === fd.target);
    const ta = shipActor(t);
    const a = stats(actor);
    const tst = stats(ta);
    const hasAdv = ship.advantage?.target === t.key && isActive(ship.advantage.round, state.round);
    const notes = [];
    const difficulty = R.silhouetteDifficulty(a.sil, tst.sil);
    notes.push(`Gabarit ${a.sil} contre ${tst.sil} : ${diffLabel(difficulty)}`);
    let upD = 0;
    let upA = 0;
    if (isActive(ship.effects.evasive, state.round)) { upD++; notes.push("le tireur est en évasion : +1 amélioration de difficulté"); }
    if (isActive(t.effects.evasive, state.round)) {
      if (hasAdv) notes.push("la cible est en évasion, mais l'avantage pris l'annule");
      else { upD++; notes.push("la cible est en évasion : +1 amélioration de difficulté"); }
    }
    if (isActive(ship.effects.stick, state.round)) { upA++; notes.push("le tireur colle à sa cible : +1 amélioration d'aptitude"); }
    if (isActive(t.effects.stick, state.round)) { upA++; notes.push("la cible colle à quelqu'un : +1 amélioration d'aptitude"); }
    const zones = R.zonesFor(tst.sil);
    let zone = fd.zone && zones.includes(fd.zone) ? fd.zone : null;
    if (!zone) {
      const sorted = [...zones].sort((x, y) => tst.shields[x] - tst.shields[y]);
      // Gabarit ≤ 4 : la cible présente sa zone la mieux défendue, sauf si le tireur a pris l'avantage.
      zone = tst.sil <= 4 && !hasAdv ? sorted.at(-1) : (tst.sil <= 4 ? sorted[0] : "fore");
    }
    const def = tst.shields[zone] ?? 0;
    if (def) notes.push(`défense ${R.ZONES[zone]} ${def} : +${def} [SE]`);
    if (w.q.accurate) notes.push(`Précis ${w.q.accurate} : +${w.q.accurate} [BO]`);
    if (ship.fired.includes(w.id)) notes.push("⚠ cette arme a déjà tiré ce round (une seule fois par round)");
    notes.push(`Arme : dégâts ${w.damage}, critique ${w.crit}, portée ${w.range}, arc ${w.arcs.join("/") || "?"}${w.special ? `, ${w.special}` : ""}`);
    if (tst.sil <= 4) notes.push(hasAdv ? "avantage pris : le tireur choisit la zone" : "la cible présente sa zone la mieux défendue");
    return { w, t, ta, difficulty, upD, upA, zone, zones, def, notes, hasAdv };
  };

  const refresh = (dialog) => {
    const formEl = dialog.element.querySelector("form");
    const fd = new foundry.applications.ux.FormDataExtended(formEl).object;
    const c = compute(fd);
    const zoneSel = formEl.querySelector("select[name=zone]");
    const cur = zoneSel.value;
    zoneSel.innerHTML = c.zones.map((z) => `<option value="${z}" ${z === (c.zones.includes(cur) ? cur : c.zone) ? "selected" : ""}>${R.ZONES[z]} (défense ${stats(c.ta).shields[z]})</option>`).join("");
    if (!c.zones.includes(cur)) zoneSel.value = c.zone;
    zoneSel.disabled = c.t && stats(c.ta).sil <= 4 && !c.hasAdv;
    formEl.querySelector(".sc-summary").innerHTML = `<ul>${c.notes.map((n) => `<li>${dice(esc(n))}</li>`).join("")}</ul>`;
  };

  const fd = await form(`Attaque — ${actor.name}`, dice(content), "Lancer l'attaque", (ev, dialog) => {
    refresh(dialog);
    dialog.element.querySelector("form").addEventListener("change", (e) => {
      if (e.target.name !== "zone") dialog.element.querySelector("select[name=zone]").value = "";
      refresh(dialog);
    });
  });
  if (!fd) return;
  const c = compute(fd);
  const weapon = actor.items.get(c.w.id);
  await openRoll({
    actor, crewId: fd.crew, skill: c.w.skill, difficulty: c.difficulty, upDifficulty: c.upD, upAbility: c.upA,
    boost: Number(fd.boost || 0) + c.w.q.accurate, setback: Number(fd.setback || 0) + c.def,
    item: weapon, title: `Attaque : ${weapon.name}`,
    next: { type: "attack", key, target: c.t.key, weaponId: weapon.id, zone: c.zone },
  });
}

async function advantageDialog(state, key) {
  const { ship, actor } = findShip(state, key);
  const st = stats(actor);
  if (st.sil > 4) return ui.notifications.warn("Prendre l'avantage : gabarit 4 maximum.");
  if (st.speed < 4) return ui.notifications.warn("Prendre l'avantage : vitesse 4 minimum.");
  const targets = state.ships.filter((s) => s.key !== key && shipActor(s));
  if (!targets.length) return ui.notifications.warn("Aucun adversaire dans la rencontre.");
  const def = targets.find((s) => s.side !== ship.side) ?? targets[0];
  const diffFor = (tKey) => {
    const t = state.ships.find((s) => s.key === tKey);
    const base = R.speedDifficulty(st.speed, stats(shipActor(t)).speed);
    const prev = state.duels[[key, tKey].sort().join("|")] ?? 0;
    return { base, prev, total: base + prev };
  };
  const content = `
    <div class="form-group"><label>Pilote</label>${crewSelectHTML(actor, "pilot")}</div>
    <div class="form-group"><label>Adversaire</label><select name="target">${targets.map((s) => `<option value="${s.key}" ${s.key === def.key ? "selected" : ""}>${esc(shipActor(s).name)} (vitesse ${stats(shipActor(s)).speed})</option>`).join("")}</select></div>
    <div class="sc-summary"></div>`;
  const refresh = (dialog) => {
    const tKey = dialog.element.querySelector("select[name=target]").value;
    const d = diffFor(tKey);
    dialog.element.querySelector(".sc-summary").innerHTML = dice(`<ul><li>Vitesse ${st.speed} contre ${stats(shipActor(state.ships.find((s) => s.key === tKey))).speed} : ${diffLabel(d.base)} (table 7-3)</li>${d.prev ? `<li>Avantage déjà pris ${d.prev} fois dans ce duel : +${d.prev} [DI]</li>` : ""}<li>Maniabilité ${signed(st.handling)}</li></ul>`);
  };
  const fd = await form(`Prendre l'avantage — ${actor.name}`, content, "Lancer", (ev, dialog) => {
    refresh(dialog);
    dialog.element.querySelector("select[name=target]").addEventListener("change", () => refresh(dialog));
  });
  if (!fd) return;
  const d = diffFor(fd.target);
  await openRoll({
    actor, crewId: fd.crew, skill: "Piloting", difficulty: d.total,
    boost: Math.max(0, st.handling), setback: Math.max(0, -st.handling),
    title: "Prendre l'avantage", next: { type: "advantage", key, target: fd.target },
  });
}

async function repairDialog(state, key) {
  const { ship, actor } = findShip(state, key);
  const st = stats(actor);
  const crits = actor.items.filter((i) => i.type === "criticaldamage");
  const options = [
    `<option value="strain">Stress mécanique (${st.strain}/${st.strainMax}) — ${diffLabel(R.damageControlDifficulty(st.strain, st.strainMax))}</option>`,
    `<option value="hull" ${ship.repaired ? "disabled" : ""}>Dégâts de coque (${st.hull}/${st.hullMax}) — ${diffLabel(R.damageControlDifficulty(st.hull, st.hullMax))}${ship.repaired ? " — déjà fait cette rencontre" : ""}</option>`,
    ...crits.map((c) => `<option value="crit:${c.id}">Critique : ${esc(c.name)} — ${c.system.severity >= 5 ? "irréparable" : diffLabel(c.system.severity)}</option>`),
  ];
  const content = `
    <div class="form-group"><label>Mécanicien</label>${crewSelectHTML(actor, "engineer")}</div>
    <div class="form-group"><label>Réparer</label><select name="what">${options.join("")}</select></div>
    <p class="sc-hint">Contrôle des dégâts (p. 234) : une action par personnage et par tour. La coque ne peut être réparée qu'une fois par rencontre.</p>`;
  const fd = await form(`Contrôle des dégâts — ${actor.name}`, dice(content), "Lancer");
  if (!fd) return;
  let difficulty;
  let next;
  if (fd.what === "strain") {
    difficulty = R.damageControlDifficulty(st.strain, st.strainMax);
    next = { type: "repair", key, what: "strain", label: "Contrôle des dégâts (stress)" };
  } else if (fd.what === "hull") {
    difficulty = R.damageControlDifficulty(st.hull, st.hullMax);
    next = { type: "repair", key, what: "hull", label: "Contrôle des dégâts (coque)" };
  } else {
    const crit = actor.items.get(fd.what.split(":")[1]);
    if (!crit) return;
    if (crit.system.severity >= 5) return ui.notifications.warn("Ce dégât critique ne peut pas être réparé.");
    difficulty = crit.system.severity;
    next = { type: "repair", key, what: "crit", itemId: crit.id, critName: crit.name, label: `Réparer ${crit.name}` };
  }
  await openRoll({ actor, crewId: fd.crew, skill: "Mechanics", difficulty, title: next.label, next });
}

async function terrainDialog(state, key) {
  const { actor } = findShip(state, key);
  const st = stats(actor);
  const t = R.terrainCheck(st.speed, st.sil);
  const content = `
    <div class="form-group"><label>Pilote</label>${crewSelectHTML(actor, "pilot")}</div>
    <div class="form-group"><label>Danger (table 7-8)</label><select name="danger">
      <option value="0">Simple : terrain dégagé, champ d'astéroïdes peu dense</option>
      <option value="1">[SE] : terrain ardu, astéroïdes, survol de montagnes</option>
      <option value="2">[SE][SE] : terrain dangereux, comète fracturée, astéroïdes très denses</option>
      <option value="3">[SE][SE][SE] : extrêmement périlleux (la Gueule, tunnels d'astéroïde…)</option>
    </select></div>
    <p class="sc-hint">Vitesse ${st.speed} et gabarit ${st.sil} (moitié : ${Math.ceil(st.sil / 2)}) : ${t.difficulty} [DI] dont ${t.upgrades} amélioré(s) en [CH]. Maniabilité ${signed(st.handling)}.</p>`;
  const fd = await form(`Terrain — ${actor.name}`, dice(content), "Lancer");
  if (!fd) return;
  await openRoll({
    actor, crewId: fd.crew, skill: "Piloting", difficulty: t.difficulty, upDifficulty: t.upgrades,
    boost: Math.max(0, st.handling), setback: Math.max(0, -st.handling) + Number(fd.danger || 0),
    title: "Pilotage (terrain)", next: { type: "terrain", key },
  });
}

async function crewActionDialog(state, key, preset) {
  const { actor } = findShip(state, key);
  const content = `
    <div class="form-group"><label>Personnage</label>${crewSelectHTML(actor)}</div>
    <div class="form-group"><label>Action</label><select name="action">${R.CREW_ACTIONS.map((a) => {
      const opts = [`<option value="${a.key}" ${a.key === preset ? "selected" : ""}>${esc(a.label)} — ${skillLabel(skillKey(a.skill, actor))} ${R.DIFFICULTY_NAMES[a.difficulty]}</option>`];
      if (a.alt) opts.push(`<option value="${a.key}|alt">${esc(a.label)} — ${skillLabel(a.alt.skill)} ${R.DIFFICULTY_NAMES[a.alt.difficulty]}</option>`);
      return opts.join("");
    }).join("")}</select></div>
    <div class="sc-summary"></div>`;
  const refresh = (dialog) => {
    const k = dialog.element.querySelector("select[name=action]").value.split("|")[0];
    const a = R.CREW_ACTIONS.find((x) => x.key === k);
    dialog.element.querySelector(".sc-summary").innerHTML = dice(`<p>${a.result}</p>`);
  };
  const fd = await form(`Action d'équipage — ${actor.name}`, content, "Lancer", (ev, dialog) => {
    refresh(dialog);
    dialog.element.querySelector("select[name=action]").addEventListener("change", () => refresh(dialog));
  });
  if (!fd) return;
  const [k, alt] = fd.action.split("|");
  const a = R.CREW_ACTIONS.find((x) => x.key === k);
  const use = alt ? a.alt : a;
  const st = stats(actor);
  const piloting = use.skill === "Piloting";
  await openRoll({
    actor, crewId: fd.crew, skill: use.skill, difficulty: use.difficulty,
    boost: piloting ? Math.max(0, st.handling) : 0, setback: piloting ? Math.max(0, -st.handling) : 0,
    title: a.label, next: { type: "crewAction", key, action: a.key },
  });
}

async function critDialog(state, key) {
  const { actor } = findShip(state, key);
  const existing = actor.items.filter((i) => i.type === "criticaldamage").length;
  const content = `
    <p>Jet sur la table 7-9 (p. 245) : d100 + 10 par critique non réparé (${existing} actuellement : +${existing * 10}).</p>
    <div class="form-group"><label>Critiques supplémentaires achetés</label><input type="number" name="extra" value="0" min="0" max="9"></div>
    <div class="form-group"><label>Autre bonus (talents, arme, +30 après réparation d'urgence…)</label><input type="number" name="bonus" value="0" step="5"></div>`;
  const fd = await form(`Dégât critique — ${actor.name}`, content, "Lancer le d100");
  if (!fd) return;
  await exec("rollCrit", { key, bonus: Number(fd.extra || 0) * 10 + Number(fd.bonus || 0) });
}

async function collisionDialog(state, key) {
  const { actor } = findShip(state, key);
  const st = stats(actor);
  const zones = R.zonesFor(st.sil);
  const content = `
    <div class="form-group"><label>Type</label><select name="major"><option value="0">Collision mineure (− défense × 10)</option><option value="1">Collision majeure (− défense × 5)</option></select></div>
    <div class="form-group"><label>Zone percutée</label><select name="zone">${zones.map((z) => `<option value="${z}">${R.ZONES[z]} (défense ${st.shields[z]})</option>`).join("")}</select></div>
    <p class="sc-hint">Une collision inflige toujours un dégât critique, réduit par la défense de la zone ; il est annulé si le résultat final est de 0 ou moins (p. 243).</p>`;
  const fd = await form(`Collision — ${actor.name}`, content, "Lancer le d100");
  if (!fd) return;
  await exec("rollCrit", { key, collision: { major: fd.major === "1", defense: st.shields[fd.zone] ?? 0 } });
}

async function shiftDialog(state, key) {
  const { actor } = findShip(state, key);
  const st = stats(actor);
  const zones = R.zonesFor(st.sil);
  const opts = (sel) => zones.map((z) => `<option value="${z}" ${z === sel ? "selected" : ""}>${R.ZONES[z]} (${st.shields[z]})</option>`).join("");
  const from = zones.find((z) => st.shields[z] > 0) ?? zones[0];
  const content = `
    <p>Manœuvre (pas de pilote) : transférer 1 point de défense d'une zone à une autre (p. 234). Les valeurs d'origine sont restaurées à la fin de la rencontre.</p>
    <div class="form-group"><label>Depuis</label><select name="from">${opts(from)}</select></div>
    <div class="form-group"><label>Vers</label><select name="to">${opts(zones.find((z) => z !== from))}</select></div>`;
  const fd = await form(`Réorienter les boucliers — ${actor.name}`, content, "Transférer");
  if (!fd) return;
  await exec("shift", { key, from: fd.from, to: fd.to });
}

async function maneuverClick(state, key, kind) {
  const { ship, actor } = findShip(state, key);
  const m = R.MANEUVERS[kind];
  const st = stats(actor);
  const limit = pilotLimit(st.sil);
  if (m.pilot && ship.pm >= limit) return ui.notifications.warn(`${actor.name} a déjà fait ${limit} manœuvre(s) de pilote ce round.`);
  if (st.sil > m.maxSil) return ui.notifications.warn(`${m.label} : réservé aux gabarits ${m.maxSil} ou moins.`);
  if (st.speed < m.minSpeed) return ui.notifications.warn(`${m.label} : vitesse ${m.minSpeed} minimum.`);
  if (m.pilot && ship.pm === 1) {
    const ok = await DialogV2.confirm({
      window: { title: "Deuxième manœuvre de pilote" },
      content: `<p>${esc(actor.name)} a déjà fait une manœuvre de pilote ce round. Une deuxième coûte <strong>2 points de stress mécanique</strong> (${st.strain} → ${st.strain + 2} / ${st.strainMax}).</p><p>Continuer ?</p>`,
    });
    if (!ok) return;
  }
  if (kind === "punch") {
    const gain = st.maxSpeed - st.speed;
    const ok = await DialogV2.confirm({
      window: { title: "Mettre la gomme" },
      content: `<p>Vitesse ${st.speed} → ${st.maxSpeed} : <strong>+${gain} stress mécanique</strong>.</p><p>Continuer ?</p>`,
    });
    if (!ok) return;
  }
  await exec("maneuver", { key, kind });
}

/* -------------------------------------------------------------------------- */
/*  Application                                                               */
/* -------------------------------------------------------------------------- */

export class SpaceCombatApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "space-combat",
    classes: ["starwarsffg-v14", "space-combat"],
    window: { title: "Combat spatial", icon: "fa-solid fa-jet-fighter", resizable: true },
    position: { width: 980, height: 760 },
    actions: {
      scTab: SpaceCombatApp.#onTab,
      scJump: SpaceCombatApp.#onJump,
      addSelected: SpaceCombatApp.#onAddSelected,
      nextRound: SpaceCombatApp.#onNextRound,
      endEncounter: SpaceCombatApp.#onEndEncounter,
      ship: SpaceCombatApp.#onShipAction,
    },
  };

  tab = "combat";

  static open() {
    const existing = foundry.applications.instances.get("space-combat");
    if (existing) return existing.render({ force: true });
    return new SpaceCombatApp().render({ force: true });
  }

  static refresh() {
    const app = foundry.applications.instances.get("space-combat");
    if (app?.rendered) app.render();
  }

  async _prepareContext() {
    const state = getState();
    const ships = state.ships.map((s) => this.#shipView(s, state));
    return {
      state,
      isGM: game.user.isGM,
      allies: ships.filter((s) => s.side !== "enemy"),
      enemies: ships.filter((s) => s.side === "enemy"),
    };
  }

  #shipView(ship, state) {
    const actor = shipActor(ship);
    if (!actor) return { ...ship, missing: true, name: "Vaisseau introuvable" };
    const st = stats(actor);
    const canSee = game.user.isGM || actor.testUserPermission(game.user, "OBSERVER");
    const canAct = game.user.isGM || actor.isOwner;
    const effects = [];
    if (isActive(ship.effects.evasive, state.round)) effects.push({ key: "evasive", label: `Évasion (R${ship.effects.evasive})`, hint: R.MANEUVERS.evasive.hint });
    if (isActive(ship.effects.stick, state.round)) effects.push({ key: "stick", label: `Collé à la cible (R${ship.effects.stick})`, hint: R.MANEUVERS.stick.hint });
    if (ship.advantage && isActive(ship.advantage.round, state.round)) {
      const t = state.ships.find((x) => x.key === ship.advantage.target);
      effects.push({ key: "advantage", label: `Avantage sur ${t ? shipActor(t)?.name : "?"} (R${ship.advantage.round})`, hint: "Ignore les manœuvres d'évasion de la cible et choisit la zone touchée." });
    }
    if (ship.boost) effects.push({ key: null, label: `Bouclier ${R.ZONES[ship.boost.zone]} intensifié`, hint: "+1 défense jusqu'au prochain round." });
    if (ship.repaired) effects.push({ key: null, label: "Coque déjà réparée", hint: "Le contrôle des dégâts sur la coque n'est possible qu'une fois par rencontre." });
    return {
      ...ship, actor, st, canSee, canAct,
      name: actor.name, img: actor.img,
      limit: pilotLimit(st.sil),
      pips: Array.from({ length: pilotLimit(st.sil) }, (_, i) => i < ship.pm),
      zones: R.zonesFor(st.sil).map((z) => ({ key: z, label: R.ZONES[z], value: st.shields[z] })),
      crits: actor.items.filter((i) => i.type === "criticaldamage").map((c) => ({ id: c.id, name: c.name, sev: c.system.severity })),
      weapons: actor.items.filter((i) => i.type === "shipweapon").map((w) => ({ ...weaponStats(w), fired: ship.fired.includes(w.id) })),
      effects,
      fly: R.flyText(st.speed),
    };
  }

  async _renderHTML(context) {
    const tabs = `<nav class="sc-tabs">
      <a data-action="scTab" data-tab="combat" class="${this.tab === "combat" ? "active" : ""}"><i class="fa-solid fa-jet-fighter"></i> Combat</a>
      <a data-action="scTab" data-tab="guide" class="${this.tab === "guide" ? "active" : ""}"><i class="fa-solid fa-graduation-cap"></i> Déroulement</a>
      <a data-action="scTab" data-tab="help" class="${this.tab === "help" ? "active" : ""}"><i class="fa-solid fa-book"></i> Aide-mémoire</a>
    </nav>`;
    if (this.tab === "guide") return tabs + `<div class="sc-body sc-help sc-guide">${dice(GUIDE_HTML)}</div>`;
    return tabs + (this.tab === "combat" ? this.#renderCombat(context) : this.#renderHelp());
  }

  _replaceHTML(result, content) {
    const scroll = this._tabChanged ? 0 : (content.querySelector(".sc-body")?.scrollTop ?? 0);
    this._tabChanged = false;
    content.innerHTML = result;
    const body = content.querySelector(".sc-body");
    if (body) body.scrollTop = scroll;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;
    el.ondragover = (ev) => ev.preventDefault();
    el.ondrop = (ev) => this.#onDrop(ev);
  }

  async #onDrop(event) {
    event.preventDefault();
    const data = foundry.applications.ux.TextEditor.getDragEventData(event);
    if (data?.type !== "Actor" || !data.uuid) return;
    const doc = await fromUuid(data.uuid);
    if (!doc || doc.type !== "vehicle") return ui.notifications.warn("Seuls les véhicules peuvent être ajoutés au combat spatial.");
    if (doc.pack) return ui.notifications.warn("Importez d'abord ce vaisseau dans le monde (ou placez-le sur la scène).");
    const side = event.target.closest("[data-side]")?.dataset.side ?? "ally";
    await exec("addShips", { uuids: [doc.uuid], side });
  }

  #renderCombat(ctx) {
    const header = `<header class="sc-header">
      <div class="sc-round">Round <strong>${ctx.state.round}</strong></div>
      ${ctx.isGM ? `<button type="button" data-action="nextRound"><i class="fa-solid fa-forward-step"></i> Nouveau round</button>` : ""}
      <button type="button" data-action="addSelected" data-side="ally"><i class="fa-solid fa-plus"></i> Jetons sélectionnés → alliés</button>
      <button type="button" data-action="addSelected" data-side="enemy"><i class="fa-solid fa-plus"></i> → ennemis</button>
      ${ctx.isGM ? `<button type="button" data-action="endEncounter"><i class="fa-solid fa-flag-checkered"></i> Fin de la rencontre</button>` : ""}
    </header>`;
    const col = (title, side, list) => `<section class="sc-side sc-${side}" data-side="${side}">
      <h2>${title}</h2>
      ${list.length ? list.map((s) => this.#renderShip(s, ctx)).join("") : `<p class="sc-empty">Sélectionnez des jetons de véhicules puis utilisez les boutons ci-dessus, ou glissez un véhicule ici.<br>Première fois ? Lisez l'onglet <a data-action="scTab" data-tab="guide">Déroulement</a>.</p>`}
    </section>`;
    return `${header}<div class="sc-body">${col("Alliés", "ally", ctx.allies)}${col("Ennemis", "enemy", ctx.enemies)}</div>`;
  }

  #renderShip(s, ctx) {
    if (s.missing) {
      return `<article class="sc-ship missing"><p>Vaisseau introuvable (jeton supprimé ?)</p>${ctx.isGM ? `<button type="button" data-action="ship" data-op="remove" data-key="${s.key}">Retirer</button>` : ""}</article>`;
    }
    const st = s.st;
    const btn = (op, label, icon, extra = "", title = "") => `<button type="button" data-action="ship" data-op="${op}" data-key="${s.key}" ${extra} ${title ? `data-tooltip-html="${esc(title)}"` : ""}><i class="${icon}"></i> ${label}</button>`;
    const bar = (label, value, max, field) => {
      const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
      const over = value > max ? "over" : value * 2 >= max ? "half" : "";
      const ctrl = s.canAct ? `<a data-action="ship" data-op="adjust" data-field="${field}" data-delta="-1" data-key="${s.key}"><i class="fa-solid fa-minus"></i></a><a data-action="ship" data-op="adjust" data-field="${field}" data-delta="1" data-key="${s.key}"><i class="fa-solid fa-plus"></i></a>` : "";
      return `<div class="sc-bar ${over}"><span class="sc-bar-label">${label}</span><span class="sc-bar-track"><span style="width:${s.canSee ? pct : 0}%"></span></span><span class="sc-bar-value">${s.canSee ? `${value}/${max}` : "?"}</span>${ctrl}</div>`;
    };
    const maneuvers = Object.entries(R.MANEUVERS).map(([k, m]) => {
      const blocked = st.sil > m.maxSil || st.speed < m.minSpeed || (m.pilot && s.pm >= s.limit);
      return btn(`man-${k}`, m.label, m.icon, blocked ? "disabled" : "", dice(m.hint));
    }).join("");
    return `<article class="sc-ship ${s.side}">
      <header>
        <img src="${esc(s.img)}" alt="">
        <div class="sc-title">
          <h3><a data-action="ship" data-op="sheet" data-key="${s.key}">${esc(s.name)}</a></h3>
          <span class="sc-tags">Gabarit ${st.sil} · Maniabilité ${signed(st.handling)} · Blindage ${s.canSee ? st.armour : "?"}</span>
        </div>
        <div class="sc-head-btns">
          ${ctx.isGM ? `<a data-action="ship" data-op="side" data-key="${s.key}" data-tooltip="Changer de camp"><i class="fa-solid fa-right-left"></i></a>
          <a data-action="ship" data-op="remove" data-key="${s.key}" data-tooltip="Retirer du combat"><i class="fa-solid fa-xmark"></i></a>` : ""}
        </div>
      </header>
      <div class="sc-stats">
        <div class="sc-speed">
          <span class="sc-bar-label">Vitesse</span>
          ${s.canAct ? `<a data-action="ship" data-op="adjust" data-field="speed" data-delta="-1" data-key="${s.key}"><i class="fa-solid fa-minus"></i></a>` : ""}
          <strong>${st.speed}</strong>/${st.maxSpeed}
          ${s.canAct ? `<a data-action="ship" data-op="adjust" data-field="speed" data-delta="1" data-key="${s.key}"><i class="fa-solid fa-plus"></i></a>` : ""}
          <span class="sc-pips" data-tooltip="Manœuvres de pilote ce round (${s.limit} max${s.limit === 2 ? ", la 2ᵉ coûte 2 stress" : ""})">${s.pips.map((p) => `<i class="fa-${p ? "solid" : "regular"} fa-circle"></i>`).join("")}</span>
        </div>
        ${bar("Coque", st.hull, st.hullMax, "hull")}
        ${bar("Stress", st.strain, st.strainMax, "strain")}
        <div class="sc-zones">
          <span class="sc-bar-label">Défense</span>
          ${s.zones.map((z) => `<span class="sc-zone" data-tooltip="${z.label}"><small>${z.label}</small><strong>${z.value}</strong></span>`).join("")}
          ${s.canAct ? btn("shift", "Réorienter", "fa-solid fa-shield-halved", "", "Transférer 1 point de défense d'une zone à une autre") : ""}
        </div>
      </div>
      ${s.effects.length ? `<div class="sc-effects">${s.effects.map((e) => `<span class="sc-chip" data-tooltip-html="${esc(dice(e.hint))}">${esc(e.label)}${e.key && s.canAct ? ` <a data-action="ship" data-op="clear" data-effect="${e.key}" data-key="${s.key}"><i class="fa-solid fa-xmark"></i></a>` : ""}</span>`).join("")}</div>` : ""}
      ${s.canAct ? `
      <div class="sc-group"><span class="sc-group-label">Manœuvres de pilote</span><div class="sc-btns">${maneuvers}</div></div>
      <div class="sc-group"><span class="sc-group-label">Actions</span><div class="sc-btns">
        ${btn("attack", "Attaquer", "fa-solid fa-crosshairs")}
        ${btn("advantage", "Prendre l'avantage", "fa-solid fa-arrows-turn-to-dots", st.sil > 4 || st.speed < 4 ? "disabled" : "", "Gabarit 1-4, vitesse 4+ : test de Pilotage selon l'écart de vitesse")}
        ${btn("repair", "Contrôle des dégâts", "fa-solid fa-screwdriver-wrench")}
        ${btn("crew", "Action d'équipage", "fa-solid fa-users")}
        ${btn("terrain", "Terrain", "fa-solid fa-meteor")}
        ${btn("crit", "Critique", "fa-solid fa-explosion")}
        ${btn("collision", "Collision", "fa-solid fa-car-burst")}
      </div></div>` : ""}
      ${s.canSee && s.weapons.length ? `<ul class="sc-weapons">${s.weapons.map((w) => `<li class="${w.fired ? "fired" : ""}"><strong>${esc(w.name)}</strong> <span>Dég ${w.damage} · Crit ${w.crit} · ${esc(w.range)} · ${esc(w.arcs.join("/"))}</span>${w.special ? `<small>${esc(w.special)}</small>` : ""}${w.fired ? `<em>a tiré</em>` : ""}</li>`).join("")}</ul>` : ""}
      ${s.canSee && s.crits.length ? `<ul class="sc-crits">${s.crits.map((c) => `<li><i class="fa-solid fa-triangle-exclamation"></i> ${esc(c.name)} <small>${c.sev >= 5 ? "irréparable" : dice(diffDice(c.sev))}</small>${s.canAct ? ` <a data-action="ship" data-op="repairCrit" data-item="${c.id}" data-key="${s.key}" data-tooltip="Marquer comme réparé"><i class="fa-solid fa-check"></i></a>` : ""}</li>`).join("")}</ul>` : ""}
    </article>`;
  }

  #renderHelp() {
    const table = (title, rows) => `<h3>${dice(title)}</h3><table class="sc-table"><tbody>${rows.map((r) => `<tr><th>${dice(r.cost)}</th><td><ul>${r.options.map((o) => `<li>${dice(esc(o))}</li>`).join("")}</ul></td></tr>`).join("")}</tbody></table>`;
    const crew = `<h3>Actions d'équipage (table 7-7)</h3><table class="sc-table"><tbody>${R.CREW_ACTIONS.map((a) => `<tr><th>${esc(a.label)}</th><td><em>${a.skill === "Piloting" ? "Pilotage" : skillLabel(a.skill)} ${diffLabel(a.difficulty)}${a.alt ? ` ou ${skillLabel(a.alt.skill)} ${diffLabel(a.alt.difficulty)}` : ""}</em><br>${a.result}</td></tr>`).join("")}</tbody></table>`;
    const maneuvers = `<h3>Manœuvres de pilote</h3><table class="sc-table"><tbody>${Object.values(R.MANEUVERS).map((m) => `<tr><th>${m.label}</th><td>${m.hint}<br><small>Gabarit ${m.maxSil < 10 ? `1-${m.maxSil}` : "tous"} · vitesse ${m.minSpeed ? `${m.minSpeed}+` : "toutes"}</small></td></tr>`).join("")}
      <tr><th>Réorienter les boucliers</th><td>Manœuvre (pas de pilote), tous gabarits : 1 point de défense passe d'une zone à une autre.</td></tr></tbody></table>
      <p>Gabarit 1-4 : 1 manœuvre de pilote par round, 2 en subissant 2 stress mécanique. Gabarit 5+ : 1 seule. Chaque arme ne tire qu'une fois par round.</p>`;
    const diffs = `<h3>Difficultés</h3><table class="sc-table"><tbody>
      <tr><th>Attaque (table 7-4)</th><td>Écart de gabarit ≤ 1 : Moyenne · tireur plus petit de 2+ : Facile · plus grand de 2 : Difficile · de 3 : Intimidante · de 4+ : Exceptionnelle. Défense de la zone = [SE].</td></tr>
      <tr><th>Prendre l'avantage (7-3)</th><td>Même vitesse : Moyenne · plus rapide : Facile · plus lent de 1 : Difficile · de 2+ : Intimidante. +1 [DI] à chaque reprise dans le même duel.</td></tr>
      <tr><th>Contrôle des dégâts (7-2)</th><td>Moins de la moitié du seuil : Facile · moitié ou plus : Moyenne · au-delà du seuil : Difficile.</td></tr>
      <tr><th>Terrain (p. 241)</th><td>Max(vitesse, gabarit/2) [DI], dont min(…) améliorés ; danger 0 à 3 [SE] (table 7-8).</td></tr>
      </tbody></table>`;
    const comps = `<h3>Composants (tables 7-10 / 7-11)</h3><div class="sc-cols"><table class="sc-table"><caption>Gabarit 1-4</caption><tbody>${R.COMPONENTS_SMALL.map(([n, d]) => `<tr><th>${n}</th><td>${d}</td></tr>`).join("")}</tbody></table>
      <table class="sc-table"><caption>Gabarit 5+</caption><tbody>${R.COMPONENTS_LARGE.map(([n, d]) => `<tr><th>${n}</th><td>${d}</td></tr>`).join("")}</tbody></table></div>`;
    return `<div class="sc-body sc-help">${dice(maneuvers)}${dice(diffs)}${table("Dépenser [AD] et [TR] (table 7-5)", R.SPEND_ADVANTAGE)}${table("Dépenser [TH] et [DE] (table 7-6)", R.SPEND_THREAT)}${dice(crew)}${comps}</div>`;
  }

  static #onTab(event, target) {
    this._tabChanged = this.tab !== target.dataset.tab;
    this.tab = target.dataset.tab;
    this.render();
  }

  static async #onAddSelected(event, target) {
    const tokens = canvas.tokens?.controlled.filter((t) => t.actor?.type === "vehicle") ?? [];
    if (!tokens.length) return ui.notifications.warn("Sélectionnez d'abord des jetons de véhicules sur la scène.");
    await exec("addShips", { uuids: tokens.map((t) => t.document.uuid), side: target.dataset.side });
  }

  static async #onNextRound() {
    await exec("nextRound");
  }

  static #onJump(event, target) {
    this.element.querySelector(`#${target.dataset.target}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  static async #onEndEncounter() {
    const choice = await DialogV2.wait({
      window: { title: "Fin de la rencontre" },
      content: "<p>Les défenses réorientées sont restaurées et les effets temporaires effacés. Le stress et les dégâts restent (le stress mécanique baisse de 1 par jour sans incident).</p>",
      buttons: [
        { action: "keep", label: "Terminer (garder les vaisseaux)" },
        { action: "clear", label: "Terminer et vider le tableau" },
        { action: "cancel", label: "Annuler" },
      ],
      rejectClose: false,
    });
    if (choice === "keep" || choice === "clear") await exec("endEncounter", { clear: choice === "clear" });
  }

  static async #onShipAction(event, target) {
    if (target.disabled) return;
    const { op, key } = target.dataset;
    const state = getState();
    try {
      if (op.startsWith("man-")) return await maneuverClick(state, key, op.slice(4));
      switch (op) {
        case "sheet": return findShip(state, key).actor.sheet.render(true);
        case "remove": return await exec("removeShip", { key });
        case "side": {
          const ship = state.ships.find((s) => s.key === key);
          return await exec("setSide", { key, side: ship.side === "enemy" ? "ally" : "enemy" });
        }
        case "adjust": return await exec("adjust", { key, field: target.dataset.field, delta: Number(target.dataset.delta) });
        case "clear": return await exec("clearEffect", { key, effect: target.dataset.effect });
        case "repairCrit": return await exec("repairCrit", { key, itemId: target.dataset.item });
        case "shift": return await shiftDialog(state, key);
        case "attack": return await attackDialog(state, key);
        case "advantage": return await advantageDialog(state, key);
        case "repair": return await repairDialog(state, key);
        case "crew": return await crewActionDialog(state, key);
        case "terrain": return await terrainDialog(state, key);
        case "crit": return await critDialog(state, key);
        case "collision": return await collisionDialog(state, key);
      }
    } catch (err) {
      console.error(err);
      ui.notifications.warn(err.message);
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Enregistrement                                                            */
/* -------------------------------------------------------------------------- */

const refreshSoon = foundry.utils.debounce(() => SpaceCombatApp.refresh(), 100);

function involves(actor) {
  if (!actor || actor.type !== "vehicle") return false;
  return getState().ships.some((s) => shipActor(s) === actor || shipActor(s)?.id === actor.id);
}

Hooks.once("init", () => {
  game.settings.register(SYS, SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: emptyState(),
    onChange: () => refreshSoon(),
  });
});

Hooks.once("ready", () => {
  // game.ffg est créé par le hook « init » du système, enregistré après celui-ci.
  if (game.ffg) game.ffg.SpaceCombat = SpaceCombatApp;
  game.socket.on(SOCKET, onSocket);
});

Hooks.on("getSceneControlButtons", (controls) => {
  const tokens = controls.tokens;
  if (!tokens?.tools) return;
  tokens.tools.spaceCombat = {
    name: "spaceCombat",
    title: "Combat spatial",
    icon: "fa-solid fa-jet-fighter",
    order: Object.keys(tokens.tools).length,
    button: true,
    visible: true,
    onChange: () => SpaceCombatApp.open(),
  };
});

Hooks.on("updateActor", (actor) => { if (involves(actor)) refreshSoon(); });
for (const hook of ["createItem", "deleteItem", "updateItem"]) {
  Hooks.on(hook, (item) => { if (involves(item.parent)) refreshSoon(); });
}

/** Le premier jet de l'utilisateur après l'ouverture d'un jet du tableau en donne le résultat. */
Hooks.on("createChatMessage", (message) => {
  if (!pending || message.author?.id !== game.user.id) return;
  const roll = message.rolls?.[0];
  if (!roll?.ffg) return;
  const p = pending;
  pending = null;
  if (Date.now() - p.time > 10 * 60 * 1000) return;
  onRollResult(p, roll.ffg).catch((err) => console.error("Combat spatial :", err));
});

/**
 * Boutons des cartes de chat du tableau. Écoute déléguée au niveau du document : le système réécrit le HTML
 * des messages dans un autre hook de rendu, ce qui ferait perdre des écouteurs posés sur les boutons.
 */
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest?.(".sc-card button.sc-op, .sc-card button.sc-crit");
  if (!b || b.disabled) return;
  ev.preventDefault();
  ev.stopPropagation();
  try {
    if (b.classList.contains("sc-crit")) {
      await critDialog(getState(), b.dataset.key);
      return;
    }
    b.disabled = true;
    await exec(b.dataset.op, JSON.parse(b.dataset.args));
  } catch (err) {
    ui.notifications.warn(err.message);
  }
}, true);
