/**
 * Tableau de combat spatial (Aux Confins de l'Empire, chapitre VII).
 *
 * - L'état de la rencontre (vaisseaux engagés, manœuvres du round, effets temporaires, portées) est un réglage « monde ».
 * - Toute modification (état ou acteurs) est exécutée par le MJ actif : les joueurs passent par le socket,
 *   et le MJ revérifie leurs droits avant d'exécuter.
 * - Les jets passent par la fenêtre de jet habituelle du système ; chaque jet lancé depuis le tableau porte
 *   un jeton unique, ce qui permet de reconnaître son résultat sans confusion possible avec un autre jet.
 */
import { DicePoolFFG } from "../dice/pool.js";
import DiceHelpers, { get_dice_pool } from "../helpers/dice-helpers.js";
import * as R from "./space-combat-rules.js";
import * as C from "./space-combat-crits.js";
import { GUIDE_HTML } from "./space-combat-guide.js";
import * as T from "./space-combat-tabs.js";

const SYS = "starwarsffg-v14";
const SETTING = "spaceCombatState";
const SOCKET = `system.${SYS}`;
const CRIT_PACK = `${SYS}.aoe-critiques`;
const CREW_TYPES = ["character", "nemesis", "rival", "minion"];
const FLAG = "spaceCombat";

const { ApplicationV2, DialogV2 } = foundry.applications.api;

/* -------------------------------------------------------------------------- */
/*  Outils                                                                    */
/* -------------------------------------------------------------------------- */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);

const DIE_TAGS = {
  AB: ["ability", "d", true, "dé d'aptitude"], PR: ["proficiency", "c", true, "dé de maîtrise"], BO: ["boost", "b", true, "dé de fortune"],
  DI: ["difficulty", "d", true, "dé de difficulté"], CH: ["challenge", "c", true, "dé de défi"], SE: ["setback", "b", true, "dé d'infortune"],
  SU: ["success", "s", false, "succès"], FA: ["failure", "f", false, "échec"], AD: ["advantage", "a", false, "avantage"], TH: ["threat", "t", false, "menace"],
  TR: ["triumph", "x", false, "triomphe"], DE: ["despair", "y", false, "désastre"], FO: ["force", "C", false, "dé de Force"], FP: ["forcepoint", "Y", false, "point de Force"],
};

/** Remplace les balises [DI], [AD]… par les symboles de dés du système, lisibles par un lecteur d'écran. */
function dice(text) {
  return String(text ?? "").replace(/\[(AB|PR|BO|DI|CH|SE|SU|FA|AD|TH|TR|DE|FO|FP)\]/g, (m, tag) => {
    const [cls, letter, sw, label] = DIE_TAGS[tag];
    const theme = sw ? "starwars" : (game.settings.get(SYS, "dicetheme") || "starwars");
    return `<span class="dietype ${theme} ${cls}" role="img" aria-label="${label}" title="${label}">${letter}</span>`;
  });
}

/** Texte brut (sans symboles) pour les infobulles et libellés accessibles. */
const plain = (text) => String(text ?? "").replace(/\[(AB|PR|BO|DI|CH|SE|SU|FA|AD|TH|TR|DE|FO|FP)\]/g, (m, tag) => ` ${DIE_TAGS[tag][3]} `).replace(/\s+/g, " ").trim();

const diffDice = (n) => (n > 0 ? "[DI]".repeat(n) : "—");
const diffLabel = (n) => `${R.DIFFICULTY_NAMES[Math.min(n, 5)] ?? n} (${diffDice(n)})`;
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const diffName = (n) => R.DIFFICULTY_NAMES[Math.min(Math.max(n, 0), 5)] ?? String(n);
const RANGE_FR = (i) => (R.RANGES[R.RANGE_ORDER[i]] ?? "?").toLowerCase();

function emptyState() {
  return {
    round: 1, ships: [], duels: {}, ranges: {}, arcs: {},
    rules: { dcPerSuccess: false, syncCombat: true, turnLock: true },
  };
}

function getState() {
  const s = foundry.utils.deepClone(game.settings.get(SYS, SETTING) ?? {});
  const state = foundry.utils.mergeObject(emptyState(), s, { inplace: false });
  for (const ship of state.ships) {
    ship.effects ??= {};
    ship.fired ??= [];
    ship.cooldown ??= {};
    ship.aims ??= {};
    ship.group ??= 1;
    ship.groupLost ??= 0;
  }
  return state;
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
    spaceShip: !!actor.system.spaceShip,
  };
}

function pilotLimit(sil) {
  return sil <= 4 ? 2 : 1;
}

/** Un effet posé au round r dure au plus jusqu'au round r + 1 (« jusqu'à la fin du prochain tour »). */
function isActive(round, current) {
  return round !== undefined && round !== null && round !== false && current - round <= 1;
}

const critItems = (actor) => actor.items.filter((i) => i.type === "criticaldamage");
const restrictions = (actor) => C.critRestrictions(critItems(actor).map((c) => c.name));
const juryRig = (actor) => actor.getFlag(SYS, `${FLAG}.juryRig`) ?? null;

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
  const arcKeys = Object.entries(sys.firingarc ?? {}).filter(([, v]) => v).map(([k]) => k);
  const arcs = arcKeys.map((k) => R.ARCS[k] ?? k);
  const rangeKey = sys.range?.adjusted || sys.range?.value || "";
  const q = R.parseQualities(quals);
  return {
    id: w.id,
    name: w.name,
    damage: Number(sys.damage?.adjusted || sys.damage?.value || 0),
    crit: Number(sys.crit?.adjusted || sys.crit?.value || 0),
    range: R.RANGES[rangeKey] ?? rangeKey,
    rangeIndex: R.RANGE_ORDER.indexOf(rangeKey),
    skill: sys.skill?.value || "Gunnery",
    arcKeys,
    arcs: arcs.length === 6 ? ["tous"] : arcs,
    special: quals.replace(/^[,\s]+|[,\s]+$/g, ""),
    q,
    ammoUsed: Number(w.getFlag(SYS, `${FLAG}.ammoUsed`) ?? 0),
  };
}

/** Une arme peut-elle tirer ce round ? (déjà tiré, cadence lente, munitions, armes coupées par une réparation d'urgence) */
function weaponBlock(ship, actor, w, round) {
  if (ship.fired.includes(w.id)) return "a déjà tiré ce round";
  const ready = ship.cooldown?.[w.id];
  if (ready && round < ready) return `Cadence lente : prête au round ${ready}`;
  if (w.q.limitedAmmo && w.ammoUsed >= w.q.limitedAmmo) return "plus de munitions";
  if (juryRig(actor)) return "armes hors service (réparation d'urgence)";
  return null;
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
  return `<button type="button" class="sc-op" data-op="${op}" data-args='${esc(JSON.stringify(args))}'><i class="${icon}" aria-hidden="true"></i> ${label}</button>`;
}

const pairKey = (a, b) => [a, b].sort().join("|");
const getRange = (state, a, b) => state.ranges?.[pairKey(a, b)];

/* -------------------------------------------------------------------------- */
/*  Équipage, postes et droits                                                */
/* -------------------------------------------------------------------------- */

/** Ce qu'un poste d'équipage permet de faire, d'après sa définition (compétence, armes, maniabilité) et son nom. */
function roleKinds(roleName) {
  const def = (game.settings.get(SYS, "arrayCrewRoles") ?? []).find((x) => x.role_name === roleName);
  const name = C.norm(roleName);
  const skill = String(def?.role_skill ?? "");
  const copilot = /co-?pilot/.test(name);
  return {
    pilot: !copilot && (/pilot|barreur|timonier|helm/.test(name) || /^Piloting|Pilotage/.test(skill) || (!!def?.use_handling && !def?.use_weapons)),
    gunner: !!def?.use_weapons || /gunner|artill|canon|mitrail|tireur|tourelle|torpill|missil/.test(name) || /Gunnery|Artillerie/.test(skill),
    engineer: /Mechanics|Mécanique/.test(skill) || /engineer|ingen|mecan|techni|mechanic/.test(name),
  };
}

/** Équipage enregistré sur la fiche du vaisseau, regroupé par personnage. */
function shipCrew(actor, user = game.user) {
  const byActor = new Map();
  for (const c of actor.getFlag(SYS, "crew") ?? []) {
    const a = game.actors.get(c.actor_id);
    if (!a) continue;
    const entry = byActor.get(c.actor_id) ?? { id: c.actor_id, name: a.name, roles: [], unknown: [], owned: a.testUserPermission(user, "OWNER"), kinds: { pilot: false, gunner: false, engineer: false } };
    entry.roles.push(c.role);
    const k = roleKinds(c.role);
    if (!k.pilot && !k.gunner && !k.engineer) entry.unknown.push(c.role);
    for (const key of Object.keys(k)) entry.kinds[key] ||= k[key];
    byActor.set(c.actor_id, entry);
  }
  return [...byActor.values()];
}

/** Acteur dont c'est le tour dans le suivi de combat (créneau revendiqué compris), ou null hors combat. */
function turnActorId() {
  const combat = game.combat;
  if (!combat?.started) return null;
  const slot = combat.turns?.[combat.turn];
  if (!slot) return null;
  const claimId = combat.getSlotClaims?.(combat.round, slot.id);
  const claimant = claimId ? combat.combatants.get(claimId) : null;
  return (claimant ?? slot)?.actorId ?? null;
}

/**
 * Ce qu'un utilisateur peut faire sur ce vaisseau. Le MJ peut tout faire ; un joueur seulement ce que
 * permettent les postes de ses personnages dans l'équipage — et, pendant un combat, seulement avec le
 * personnage dont c'est le tour. Sans équipage enregistré, le propriétaire du vaisseau garde l'accès complet.
 */
function userAccess(actor, user = game.user, state = null) {
  if (user.isGM) return { gm: true, pilot: true, gunner: true, crew: true, mine: [] };
  const rules = (state ?? getState()).rules;
  const turnId = rules.turnLock ? turnActorId() : null;
  const crew = shipCrew(actor, user);
  if (!crew.length) {
    const own = actor.testUserPermission(user, "OWNER");
    const ok = own && (!turnId || game.actors.get(turnId)?.testUserPermission(user, "OWNER"));
    return { gm: false, pilot: ok, gunner: ok, crew: ok, noCrew: true, mine: [], notMyTurn: own && !ok };
  }
  const owned = crew.filter((e) => e.owned);
  const mine = turnId ? owned.filter((e) => e.id === turnId) : owned;
  return {
    gm: false,
    pilot: mine.some((e) => e.kinds.pilot),
    gunner: mine.some((e) => e.kinds.gunner),
    crew: mine.length > 0,
    mine,
    notMyTurn: owned.length > 0 && mine.length === 0,
  };
}

/**
 * Personnages proposés pour un jet.
 * @param {string} preferRole poste à présélectionner (pilot, gunner, engineer)
 * @param {string} requireRole poste exigé pour un joueur (pilot, gunner) ; le MJ voit tout le monde
 */
function crewChoices(actor, preferRole, requireRole = null) {
  const crew = shipCrew(actor);
  const mine = game.user.character;
  let list;
  if (game.user.isGM) {
    list = crew.map((e) => ({ ...e, group: "Équipage" }));
    const others = game.actors.filter((a) => CREW_TYPES.includes(a.type) && !crew.some((e) => e.id === a.id));
    for (const a of others.sort((x, y) => (x === mine ? -1 : y === mine ? 1 : x.name.localeCompare(y.name)))) {
      list.push({ id: a.id, name: a.name, roles: [], kinds: {}, group: "Autres personnages" });
    }
  } else {
    const access = userAccess(actor);
    if (crew.length) {
      // Un joueur ne lance que pour ses propres personnages, au poste qu'ils occupent (et à leur tour).
      list = access.mine.filter((e) => !requireRole || e.kinds[requireRole]).map((e) => ({ ...e, group: "Vos personnages" }));
    } else {
      const turnId = getState().rules.turnLock ? turnActorId() : null;
      list = game.actors.filter((a) => CREW_TYPES.includes(a.type) && a.isOwner && (!turnId || a.id === turnId))
        .map((a) => ({ id: a.id, name: a.name, roles: [], kinds: {}, group: "Vos personnages" }));
    }
  }
  const preferred = list.find((e) => e.kinds?.[preferRole]) ?? list.find((e) => e.group === "Équipage") ?? (mine && list.find((e) => e.id === mine.id)) ?? list[0];
  return { list, selected: preferred?.id ?? "" };
}

const ROLE_LABELS = { pilot: "pilote", gunner: "artilleur" };

/** Vérifie qu'un joueur a bien un personnage pour ce poste (et que c'est son tour), sinon le prévient. */
function checkCrew(actor, requireRole) {
  if (game.user.isGM) return true;
  if (crewChoices(actor, requireRole, requireRole).list.length) return true;
  const access = userAccess(actor);
  if (access.notMyTurn) ui.notifications.warn(`Ce n'est pas le tour d'un de vos personnages à bord de ${actor.name}.`);
  else ui.notifications.warn(requireRole
    ? `Aucun de vos personnages n'est ${ROLE_LABELS[requireRole]} à bord de ${actor.name} (postes d'équipage sur la fiche du vaisseau).`
    : `Aucun de vos personnages ne fait partie de l'équipage de ${actor.name}.`);
  return false;
}

function crewSelectHTML(actor, preferRole, requireRole = null) {
  const { list, selected } = crewChoices(actor, preferRole, requireRole);
  const groups = {};
  for (const e of list) (groups[e.group] ??= []).push(e);
  let html = game.user.isGM ? `<option value="">— Aucun (réserve à compléter à la main) —</option>` : "";
  for (const [g, entries] of Object.entries(groups)) {
    html += `<optgroup label="${esc(g)}">${entries.map((e) => `<option value="${e.id}" ${e.id === selected ? "selected" : ""}>${esc(e.name)}${e.roles.length ? ` (${esc(e.roles.join(", "))})` : ""}</option>`).join("")}</optgroup>`;
  }
  return `<select name="crew" id="sc-crew">${html}</select>`;
}

/* -------------------------------------------------------------------------- */
/*  Critiques : effets mécaniques                                             */
/* -------------------------------------------------------------------------- */

function findShipByActor(state, actor) {
  return state.ships.find((s) => {
    const a = shipActor(s);
    return a === actor || (a && actor && a.uuid === actor.uuid);
  }) ?? null;
}

/**
 * Applique (sign = 1) ou annule (sign = -1) des modifications de caractéristiques. Les défenses suivent aussi
 * la valeur d'origine mémorisée pour la fin de la rencontre, pour ne pas effacer un critique en la restaurant.
 */
async function applyMods(actor, ship, mods, sign = 1) {
  const update = {};
  for (const { path, delta } of mods) {
    const cur = Number(update[path] ?? foundry.utils.getProperty(actor, path) ?? 0);
    update[path] = Math.max(0, cur + sign * delta);
    if (path === "system.stats.armour.value") {
      // le blindage « ajusté » est stocké à part sur les véhicules : on le garde aligné
      const adj = Number(foundry.utils.getProperty(actor, "system.stats.armour.adjusted") ?? 0);
      update["system.stats.armour.adjusted"] = Math.max(0, adj + sign * delta);
    }
    const zone = path.match(/shields\.(\w+)$/)?.[1];
    if (zone && ship?.shieldsBase) ship.shieldsBase[zone] = Math.max(0, (ship.shieldsBase[zone] ?? 0) + sign * delta);
  }
  if (update["system.stats.speed.max"] !== undefined) {
    const speed = Number(actor.system.stats.speed?.value ?? 0);
    if (speed > update["system.stats.speed.max"] && sign > 0) {
      // Arrêt du moteur : le vaisseau garde son allure par inertie mais ne peut plus manœuvrer ; sinon on plafonne.
      if (update["system.stats.speed.max"] > 0) update["system.stats.speed.value"] = update["system.stats.speed.max"];
    }
  }
  if (Object.keys(update).length) await actor.update(update);
}

/** Une fois le critique tiré et ajouté à la fiche, applique ses effets et renvoie le texte à afficher. */
async function applyCrit(state, ship, actor, item, zone) {
  const st = stats(actor);
  const plan = C.critPlan(item.name, st, { zone, round: state.round });
  const lines = [];
  if (plan.mods.length) {
    await applyMods(actor, ship, plan.mods, 1);
    await item.setFlag(SYS, `${FLAG}.mods`, plan.mods);
  }
  if (plan.lock) await item.setFlag(SYS, `${FLAG}.lock`, true);
  if (plan.strain) {
    await actor.update({ "system.stats.systemStrain.value": st.strain + plan.strain });
    lines.push(`+${plan.strain} stress mécanique.`);
  }
  if (plan.crewStrain) {
    const names = [];
    for (const c of shipCrew(actor)) {
      const a = game.actors.get(c.id);
      if (!a?.system?.stats?.strain) continue;
      await a.update({ "system.stats.strain.value": Number(a.system.stats.strain.value ?? 0) + plan.crewStrain });
      names.push(a.name);
    }
    if (names.length) lines.push(`Stress de l'équipage +${plan.crewStrain} : ${names.join(", ")}.`);
  }
  if (ship) Object.assign(ship.effects, plan.effects);
  lines.push(...plan.notes);
  if (plan.destroyed) lines.push("<strong>Le vaisseau est détruit.</strong>");
  await checkThresholds(state, ship, actor, st, { noCrit: true });
  return lines;
}

/** Annule les modifications d'un critique réparé (ou supprimé de la fiche). */
async function revertCrit(item) {
  const actor = item.parent;
  const mods = item.getFlag(SYS, `${FLAG}.mods`);
  if (!actor || !mods?.length) return;
  const state = getState();
  const ship = findShipByActor(state, actor);
  await applyMods(actor, ship, mods, -1);
  if (ship) await saveState(state);
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

/** Appareils restants d'une escadrille. */
function squadronLeft(ship, st) {
  if ((ship?.group ?? 1) <= 1) return 1;
  return Math.max(0, ship.group - Math.floor(st.hull / Math.max(1, st.hullMax)) - (ship.groupLost ?? 0));
}

/**
 * Seuils dépassés : escadrille (un appareil abattu par seuil), petit vaisseau détruit, gros vaisseau à la dérive
 * avec un dégât critique automatique, ou systèmes hors service.
 */
async function checkThresholds(state, ship, actor, before, { noCrit = false } = {}) {
  const st = stats(actor);
  if ((ship?.group ?? 1) > 1) {
    const lostBefore = Math.floor(before.hull / Math.max(1, st.hullMax));
    const lostNow = Math.floor(st.hull / Math.max(1, st.hullMax));
    if (lostNow > lostBefore) {
      const left = squadronLeft(ship, st);
      await chat(left > 0
        ? `<h3>💥 ${esc(actor.name)} : ${lostNow - lostBefore} appareil(s) abattu(s)</h3><p>Il reste ${left} appareil(s) dans l'escadrille.</p>`
        : `<h3>💥 ${esc(actor.name)} : escadrille détruite</h3>`, actor);
    }
  } else if (st.hull > st.hullMax && before.hull <= st.hullMax) {
    if (st.sil <= 3) {
      await chat(`<h3>💥 ${esc(actor.name)} est détruit</h3><p>Seuil de dégâts de coque dépassé (${st.hull}/${st.hullMax}) : un appareil de gabarit 3 ou moins explose (p. 243).</p>`, actor);
    } else {
      if (ship) ship.effects.adrift = true;
      await chat(`<h3>⚠ ${esc(actor.name)} : seuil de coque dépassé</h3>
        <p>Les systèmes défaillent, le moteur subluminique flanche : le vaisseau part à la dérive et subit un dégât critique (p. 243-244).</p>
        <p>Réparation d'urgence possible : « Contrôle des dégâts » → « Réparation d'urgence » (Mécanique Difficile).</p>`, actor);
      if (!noCrit && ship) await OPS.rollCrit({ key: ship.key, auto: true }, state);
    }
  }
  if (st.strain > st.strainMax && before.strain <= st.strainMax) {
    await chat(`<h3>⚠ ${esc(actor.name)} : systèmes hors service</h3><p>Seuil de stress mécanique dépassé (${st.strain}/${st.strainMax}) : le vaisseau est impuissant jusqu'à ce que l'équipage le répare (contrôle des dégâts).</p>`, actor);
  }
}

const blankShip = (uuid, side) => ({
  key: foundry.utils.randomID(), uuid, side, pm: 0, fired: [], cooldown: {}, effects: {}, advantage: null,
  repaired: false, shieldsBase: null, boost: null, aims: {}, group: 1, groupLost: 0, last: null,
});

/** Effets qui durent « jusqu'à la fin du prochain tour du pilote ». */
const PILOT_TURN_EFFECTS = ["evasive", "stick", "deviated", "tumbled"];

const OPS = {
  async addShips({ uuids, side }) {
    const state = getState();
    let added = 0;
    for (const uuid of uuids) {
      if (state.ships.some((s) => s.uuid === uuid)) continue;
      state.ships.push(blankShip(uuid, side));
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
    for (const k of Object.keys(state.ranges)) if (k.split("|").includes(key)) delete state.ranges[k];
    await saveState(state);
  },

  async setSide({ key, side }) {
    const state = getState();
    findShip(state, key).ship.side = side;
    await saveState(state);
  },

  async setGroup({ key, delta }) {
    const state = getState();
    const { ship } = findShip(state, key);
    ship.group = Math.min(4, Math.max(1, (ship.group ?? 1) + delta));
    if (ship.group === 1) ship.groupLost = 0;
    await saveState(state);
  },

  async setRules(rules) {
    const state = getState();
    state.rules = { ...state.rules, ...rules };
    await saveState(state);
  },

  async setRange({ a, b, range }) {
    const state = getState();
    findShip(state, a);
    findShip(state, b);
    state.ranges[pairKey(a, b)] = Math.min(4, Math.max(0, Number(range)));
    await saveState(state);
  },

  async setArc({ from, to, arc }) {
    const state = getState();
    state.arcs[`${from}>${to}`] = arc;
    await saveState(state);
  },

  async maneuver({ key, kind, paid = "strain", target = null, range = null }, _state, user = game.user) {
    const state = getState();
    const { ship, actor } = findShip(state, key);
    const m = R.MANEUVERS[kind];
    const st = stats(actor);
    const limit = pilotLimit(st.sil);
    const lim = restrictions(actor);
    if (lim.noManeuver) throw new Error("Moteur à l'arrêt : plus aucune manœuvre possible jusqu'à la réparation.");
    if (isActive(ship.effects.deviated, state.round) || ship.effects.needsControl) throw new Error("Le vaisseau est dévié : le pilote doit d'abord reprendre le contrôle.");
    if (isActive(ship.effects.tumbled, state.round)) throw new Error("Le vaisseau est culbuté : l'équipage est immobilisé.");
    if (ship.effects.tractor) throw new Error("Le vaisseau est pris dans un rayon tracteur.");
    if (m.pilot && ship.pm >= limit) throw new Error(`${actor.name} a déjà fait ${limit} manœuvre(s) de pilote ce round.`);
    if (st.sil > m.maxSil) throw new Error(`${m.label} : gabarit ${m.maxSil} maximum.`);
    if (st.speed < m.minSpeed) throw new Error(`${m.label} : vitesse ${m.minSpeed} minimum.`);
    if (m.pilot && ship.pm === 1 && paid === "strain" && lim.noStrainManeuver) throw new Error("Fluctuations énergétiques : la manœuvre supplémentaire ne peut pas être payée en stress mécanique.");

    const before = { speed: st.speed, strain: st.strain, pm: ship.pm, effects: { ...ship.effects }, range: target ? getRange(state, key, target) : undefined, target };
    const update = {};
    let strain = 0;
    const notes = [];
    if (m.pilot && ship.pm === 1) {
      if (paid === "action") notes.push("2ᵉ manœuvre de pilote à la place de son action");
      else {
        strain += 2;
        notes.push("2ᵉ manœuvre de pilote : +2 stress mécanique");
      }
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
      case "fly": {
        if (target && range !== null && range !== undefined) {
          const tActor = shipActor(state.ships.find((s) => s.key === target));
          const old = getRange(state, key, target);
          state.ranges[pairKey(key, target)] = Math.min(4, Math.max(0, Number(range)));
          notes.push(`distance avec ${tActor?.name ?? "?"} : ${old === undefined ? "?" : RANGE_FR(old)} → ${RANGE_FR(Number(range))}`);
        } else notes.push(R.flyText(st.speed));
        break;
      }
    }
    if (strain) update["system.stats.systemStrain.value"] = st.strain + strain;
    if (m.pilot) ship.pm += 1;
    ship.last = { kind, label: m.label, user: user.id, round: state.round, before };
    if (Object.keys(update).length) await actor.update(update);
    await saveState(state);
    await chat(`<p><strong>${esc(actor.name)}</strong> — ${m.label}${notes.length ? ` : ${esc(notes.join(" ; "))}` : ""}.</p>`, actor);
    if (strain) {
      const s2 = getState();
      const sh = s2.ships.find((s) => s.key === key);
      await checkThresholds(s2, sh, actor, st);
      await saveState(s2);
    }
  },

  /** Annule la dernière manœuvre de pilote du round (clic de trop). */
  async undoManeuver({ key }, _state, user = game.user) {
    const state = getState();
    const { ship, actor } = findShip(state, key);
    const last = ship.last;
    if (!last || last.round !== state.round) throw new Error("Aucune manœuvre à annuler ce round.");
    if (!user.isGM && last.user !== user.id) throw new Error("Seul celui qui a fait la manœuvre (ou le MJ) peut l'annuler.");
    await actor.update({ "system.stats.speed.value": last.before.speed, "system.stats.systemStrain.value": last.before.strain });
    ship.pm = last.before.pm;
    ship.effects = last.before.effects;
    if (last.before.target) {
      if (last.before.range === undefined) delete state.ranges[pairKey(key, last.before.target)];
      else state.ranges[pairKey(key, last.before.target)] = last.before.range;
    }
    ship.last = null;
    await saveState(state);
    await chat(`<p><strong>${esc(actor.name)}</strong> — manœuvre annulée : ${esc(last.label)}.</p>`, actor);
  },

  async adjust({ key, field, delta }) {
    const state = getState();
    const { ship, actor } = findShip(state, key);
    const st = stats(actor);
    const path = { speed: "speed.value", hull: "hullTrauma.value", strain: "systemStrain.value" }[field];
    if (!path) return;
    let value = { speed: st.speed, hull: st.hull, strain: st.strain }[field] + delta;
    value = Math.max(0, value);
    if (field === "speed") value = Math.min(value, st.maxSpeed);
    await actor.update({ [`system.stats.${path}`]: value });
    if (delta > 0) {
      await checkThresholds(state, ship, actor, st);
      await saveState(state);
    }
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

  async intensify({ key, zone, rounds = 1 }) {
    const state = getState();
    const { ship, actor } = findShip(state, key);
    const st = stats(actor);
    if (!ship.shieldsBase) ship.shieldsBase = { ...st.shields };
    if (ship.boost) throw new Error("Un bouclier est déjà intensifié sur ce vaisseau.");
    // « jusqu'au début de son prochain tour », prolongé d'un round par succès supplémentaire
    ship.boost = { zone, until: state.round + Math.max(1, rounds) - 1 };
    await actor.update({
      [`system.stats.shields.${zone}`]: st.shields[zone] + 1,
      "system.stats.systemStrain.value": st.strain + 1,
    });
    await saveState(state);
    await chat(`<p><strong>${esc(actor.name)}</strong> — Bouclier intensifié : ${R.ZONES[zone]} +1 jusqu'au round ${ship.boost.until + 1}, +1 stress mécanique.</p>`, actor);
    await checkThresholds(state, ship, actor, st);
    await saveState(state);
  },

  async clearEffect({ key, effect }) {
    const state = getState();
    const { ship } = findShip(state, key);
    if (effect === "advantage") ship.advantage = null;
    else delete ship.effects[effect];
    await saveState(state);
  },

  async setAim({ key, actorId, boost }) {
    const state = getState();
    const { ship, actor } = findShip(state, key);
    ship.aims[actorId] = { round: state.round, boost: Math.min(2, Math.max(1, Number(boost))) };
    await saveState(state);
    await chat(`<p><strong>${esc(game.actors.get(actorId)?.name ?? "?")}</strong> vise depuis ${esc(actor.name)} : +${ship.aims[actorId].boost} [BO] à sa prochaine attaque ce round.</p>`.replace(/\[BO\]/, dice("[BO]")), actor);
  },

  /** Une arme a tiré : elle ne retire pas ce round, Cadence lente et Munitions limitées sont décomptées. */
  async markFired({ key, weaponId, aimActor = null }) {
    const state = getState();
    const { ship, actor } = findShip(state, key);
    if (!ship.fired.includes(weaponId)) ship.fired.push(weaponId);
    if (aimActor) delete ship.aims[aimActor];
    const weapon = actor.items.get(weaponId);
    if (weapon) {
      const w = weaponStats(weapon);
      if (w.q.slowFiring) ship.cooldown[weaponId] = state.round + w.q.slowFiring + 1;
      if (w.q.limitedAmmo) await weapon.setFlag(SYS, `${FLAG}.ammoUsed`, w.ammoUsed + 1);
    }
    await saveState(state);
  },

  async reload({ key, weaponId }) {
    const state = getState();
    const { actor } = findShip(state, key);
    const weapon = actor.items.get(weaponId);
    if (weapon) await weapon.setFlag(SYS, `${FLAG}.ammoUsed`, 0);
    await chat(`<p><strong>${esc(actor.name)}</strong> — ${esc(weapon?.name ?? "arme")} réapprovisionnée.</p>`, actor);
  },

  async applyDamage({ key, amount, ion }) {
    const state = getState();
    const { ship, actor } = findShip(state, key);
    const st = stats(actor);
    if (ion) await actor.update({ "system.stats.systemStrain.value": st.strain + amount });
    else await actor.update({ "system.stats.hullTrauma.value": st.hull + amount });
    await chat(`<p><strong>${esc(actor.name)}</strong> subit ${amount} ${ion ? "point(s) de stress mécanique (arme ionique)" : "point(s) de dégâts de coque"}.</p>`, actor);
    await checkThresholds(state, ship, actor, st);
    await saveState(state);
  },

  async tractor({ key, rating, by }) {
    const state = getState();
    const { ship, actor } = findShip(state, key);
    ship.effects.tractor = { rating, by };
    await saveState(state);
    await chat(`<p><strong>${esc(actor.name)}</strong> est immobilisé par un rayon tracteur : son pilote doit réussir un test de Pilotage ${dice(diffLabel(rating))} pour se libérer.</p>`, actor);
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

  /** Réparation d'urgence d'un vaisseau à la dérive (p. 244). */
  async emergencyRepair({ key }) {
    const state = getState();
    const { ship, actor } = findShip(state, key);
    const st = stats(actor);
    const rig = { speedMax: st.maxSpeed - Math.min(1, st.maxSpeed), handling: 3 };
    await actor.update({
      "system.stats.hullTrauma.value": Math.max(0, st.hullMax - 1),
      "system.stats.speed.max": Math.min(1, st.maxSpeed),
      "system.stats.speed.value": Math.min(st.speed, Math.min(1, st.maxSpeed)),
      "system.stats.handling.value": st.handling - 3,
    });
    await actor.setFlag(SYS, `${FLAG}.juryRig`, rig);
    delete ship.effects.adrift;
    await saveState(state);
    await chat(`<h3>${esc(actor.name)} : réparation d'urgence</h3><p>Coque ${st.hullMax - 1}/${st.hullMax}, vitesse maximale 1, maniabilité −3, armes hors service. Tout dégât critique reçoit +30. Ces effets durent jusqu'à une réparation en cale sèche.</p>`, actor);
  },

  /** Réparation complète en cale sèche : annule les effets de la réparation d'urgence. */
  async drydock({ key }) {
    const state = getState();
    const { actor } = findShip(state, key);
    const rig = juryRig(actor);
    if (!rig) return;
    const st = stats(actor);
    await actor.update({
      "system.stats.speed.max": st.maxSpeed + Number(rig.speedMax ?? 0),
      "system.stats.handling.value": st.handling + Number(rig.handling ?? 0),
    });
    await actor.unsetFlag(SYS, `${FLAG}.juryRig`);
    await chat(`<p><strong>${esc(actor.name)}</strong> — réparé en cale sèche : vitesse, maniabilité et armes rétablies.</p>`, actor);
  },

  async rollCrit({ key, bonus = 0, collision = null, zone = null, auto = false }, given = null) {
    const state = given ?? getState();
    const { ship, actor } = findShip(state, key);
    if ((ship.group ?? 1) > 1) {
      ship.groupLost = (ship.groupLost ?? 0) + 1;
      if (!given) await saveState(state);
      await chat(`<h3>💥 ${esc(actor.name)} : un appareil de l'escadrille est abattu</h3><p>Règle des sbires : un dégât critique met un appareil hors de combat. Il en reste ${squadronLeft(ship, stats(actor))}.</p>`, actor);
      return;
    }
    const existing = critItems(actor).length;
    const rig = juryRig(actor) ? 30 : 0;
    const roll = await new Roll("1d100").evaluate();
    let total = roll.total + existing * 10 + Number(bonus || 0) + rig;
    const parts = [`d100 = ${roll.total}`];
    if (existing) parts.push(`+${existing * 10} (${existing} critique(s) non réparé(s))`);
    if (bonus) parts.push(`${signed(Number(bonus))} (bonus)`);
    if (rig) parts.push("+30 (réparation d'urgence)");
    if (collision) {
      const minus = collision.defense * (collision.major ? 5 : 10);
      total -= minus;
      parts.push(`−${minus} (collision ${collision.major ? "majeure" : "mineure"}, défense ${collision.defense})`);
    }
    const title = `${collision ? `Collision ${collision.major ? "majeure" : "mineure"}` : auto ? "Dégât critique (seuil de coque dépassé)" : "Dégât critique"} — ${esc(actor.name)}`;
    if (collision && total <= 0) {
      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor: `<div class="starwarsffg-v14 sc-card"><h3>${title}</h3><p>${esc(parts.join(" "))} = <strong>${total}</strong></p><p>Les boucliers absorbent le choc : aucun dégât critique.</p></div>`,
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
      foundry.utils.setProperty(data, `flags.${SYS}.${FLAG}.total`, total);
      const [item] = await actor.createEmbeddedDocuments("Item", [data]);
      const sev = entry.system.severity;
      const effects = await applyCrit(state, ship, actor, item, zone ?? ship.lastZone);
      body = `<h4>${esc(entry.name)} <small>(${sev >= 5 || sev === 0 ? "irréparable" : `réparation : ${diffLabel(sev)}`})</small></h4>${await foundry.applications.ux.TextEditor.enrichHTML(entry.system.description ?? "")}`
        + (effects.length ? `<p class="sc-applied"><strong>Appliqué :</strong> ${effects.join(" ")}</p>` : "");
    } else {
      body = `<p>Compendium des critiques introuvable : consultez la table 7-9 (p. 245) pour le résultat ${total}.</p>`;
    }
    if (!given) await saveState(state);
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `<div class="starwarsffg-v14 sc-card"><h3>${title}</h3><p>${esc(parts.join(" "))} = <strong>${total}</strong></p>${dice(body)}</div>`,
    });
  },

  async repairCrit({ key, itemId }) {
    const state = getState();
    const { actor } = findShip(state, key);
    const item = actor.items.get(itemId);
    if (!item) return;
    if (item.getFlag(SYS, `${FLAG}.lock`)) throw new Error(`${item.name} ne peut pas être réparé avant la fin de la rencontre.`);
    await item.delete(); // les effets sont annulés par le hook deleteItem
    await chat(`<p><strong>${esc(actor.name)}</strong> — dégât critique réparé : ${esc(item.name)}.</p>`, actor);
  },

  async regainControl({ key }) {
    const state = getState();
    const { ship, actor } = findShip(state, key);
    delete ship.effects.needsControl;
    await saveState(state);
    await chat(`<p><strong>${esc(actor.name)}</strong> — le pilote reprend le contrôle du vaisseau.</p>`, actor);
  },

  async escapeTractor({ key }) {
    const state = getState();
    const { ship, actor } = findShip(state, key);
    delete ship.effects.tractor;
    await saveState(state);
    await chat(`<p><strong>${esc(actor.name)}</strong> se libère du rayon tracteur.</p>`, actor);
  },

  async setAdvantage({ key, target }) {
    const state = getState();
    const { ship, actor } = findShip(state, key);
    const { actor: tActor } = findShip(state, target);
    ship.advantage = { target, round: state.round };
    const tShip = state.ships.find((s) => s.key === target);
    if (tShip?.advantage?.target === key) tShip.advantage = null;
    const duel = pairKey(key, target);
    state.duels[duel] = (state.duels[duel] ?? 0) + 1;
    await saveState(state);
    await chat(`<p><strong>${esc(actor.name)}</strong> prend l'avantage sur <strong>${esc(tActor.name)}</strong> : il ignore ses manœuvres d'évasion et choisit la zone touchée jusqu'à la fin du prochain round.</p>`, actor);
  },

  async nextRound({ to = null } = {}) {
    const state = getState();
    const target = to ?? state.round + 1;
    while (state.round < target) {
      state.round += 1;
      for (const ship of state.ships) {
        ship.pm = 0;
        ship.fired = [];
        ship.last = null;
        ship.aims = {};
        const actor = shipActor(ship);
        for (const k of [...PILOT_TURN_EFFECTS, "jostled", "component"]) {
          if (ship.effects[k] !== undefined && !isActive(ship.effects[k], state.round)) delete ship.effects[k];
        }
        if (ship.advantage && !isActive(ship.advantage.round, state.round)) ship.advantage = null;
        if (ship.boost && state.round > ship.boost.until) {
          if (actor) {
            const cur = stats(actor).shields[ship.boost.zone];
            await actor.update({ [`system.stats.shields.${ship.boost.zone}`]: Math.max(0, cur - 1) });
          }
          ship.boost = null;
        }
        if (ship.effects.dislocating && state.round > ship.effects.dislocating + 1 && actor) {
          delete ship.effects.dislocating;
          await chat(`<h3>💥 ${esc(actor.name)} se disloque</h3><p>Le vaisseau est détruit, laissant une traînée de débris.</p>`, actor);
        }
      }
    }
    await saveState(state);
  },

  /** Fin du tour d'un pilote dans le suivi de combat : ses effets « jusqu'à la fin de son prochain tour » expirent. */
  async pilotTurnEnded({ actorId, round }) {
    const state = getState();
    let changed = false;
    for (const ship of state.ships) {
      const actor = shipActor(ship);
      if (!actor) continue;
      const isPilot = shipCrew(actor).some((e) => e.id === actorId && e.kinds.pilot);
      if (!isPilot) continue;
      for (const k of PILOT_TURN_EFFECTS) {
        if (typeof ship.effects[k] === "number" && ship.effects[k] < round) {
          delete ship.effects[k];
          changed = true;
        }
      }
    }
    if (changed) await saveState(state);
  },

  async endEncounter({ clear }) {
    const state = getState();
    for (const ship of state.ships) {
      const actor = shipActor(ship);
      if (actor && ship.shieldsBase) await actor.update({ "system.stats.shields": ship.shieldsBase });
      if (actor) for (const c of critItems(actor)) if (c.getFlag(SYS, `${FLAG}.lock`)) await c.unsetFlag(SYS, `${FLAG}.lock`);
      const keep = ship.effects.adrift ? { adrift: true } : {};
      Object.assign(ship, { pm: 0, fired: [], cooldown: {}, effects: keep, advantage: null, repaired: false, shieldsBase: null, boost: null, aims: {}, last: null });
    }
    state.round = 1;
    state.duels = {};
    state.ranges = {};
    state.arcs = {};
    if (clear) state.ships = [];
    await saveState(state);
  },
};

/** Ce que chaque opération exige d'un joueur (le MJ revérifie les demandes reçues par le socket). */
const OP_RIGHTS = {
  addShips: "owner", maneuver: "pilot", undoManeuver: "pilot", regainControl: "pilot", escapeTractor: "pilot", setAdvantage: "pilot",
  shift: "crew", setAim: "gunner", markFired: "gunner", setRange: "crew", setArc: "crew",
};

function authorize(op, args, user) {
  if (user.isGM) return;
  const need = OP_RIGHTS[op];
  if (!need) throw new Error("Seul le MJ peut faire cela.");
  if (need === "owner") {
    for (const uuid of args.uuids ?? []) {
      const d = fromUuidSync(uuid, { strict: false });
      const a = d instanceof Actor ? d : d?.actor;
      if (!a?.testUserPermission(user, "OWNER")) throw new Error("Vous ne pouvez ajouter que vos propres vaisseaux.");
    }
    return;
  }
  const state = getState();
  const key = args.by ?? args.key ?? args.a ?? args.from;
  const { actor } = findShip(state, key);
  const access = userAccess(actor, user, state);
  if (!access[need]) throw new Error(access.notMyTurn ? "Ce n'est pas le tour de votre personnage." : "Votre personnage n'occupe pas ce poste à bord.");
}

/** Exécute une opération : directement pour le MJ, sinon via le socket. */
async function exec(op, args = {}) {
  if (game.user.isGM) {
    try {
      return await OPS[op](args, null, game.user);
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
  const user = game.users.get(data.userId);
  const fail = (err) => game.socket.emit(SOCKET, { eventType: "spaceCombat-error", userId: data.userId, message: err.message });
  try {
    if (!user) throw new Error("Utilisateur inconnu.");
    authorize(data.op, data.args ?? {}, user);
  } catch (err) {
    fail(err);
    return;
  }
  OPS[data.op](data.args ?? {}, null, user).catch(fail);
}

/* -------------------------------------------------------------------------- */
/*  Jets                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Jets lancés depuis le tableau, en attente de leur résultat. Chaque jet porte un jeton unique dans les
 * données de la fenêtre de jet ; seul le message qui le contient déclenche la suite.
 */
const pendings = new Map();

/**
 * Ouvre la fenêtre de jet du système avec une réserve préparée.
 * @param {object} o
 */
async function openRoll({ actor, crewId, skill, difficulty = 2, upDifficulty = 0, upAbility = 0, boost = 0, setback = 0, ability = 0, proficiency = 0, item = null, title, next, minion = 0 }) {
  let pool = new DicePoolFFG({ difficulty, boost, setback, ability, proficiency });
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
  } else if (minion > 1) {
    // Escadrille ou batterie sans personnage : rangs de compétence = taille du groupe − 1.
    const mp = R.minionPool(minion);
    pool.ability += mp.ability;
    pool.proficiency += mp.proficiency;
  }
  if (upDifficulty > 0) pool.upgradeDifficulty(upDifficulty);
  if (upAbility > 0) pool.upgrade(upAbility);
  if (item) pool = new DicePoolFFG(await DiceHelpers.getModifiers(pool, item));
  const token = foundry.utils.randomID();
  if (next) pendings.set(token, { ...next, userId: game.user.id, time: Date.now() });
  // Copie de l'arme (et non l'arme elle-même) pour y attacher le jeton ; la carte de jet retrouve l'arme par son uuid.
  const rollItem = item
    ? { _id: item.id, id: item.id, name: item.name, type: item.type, img: item.img, uuid: item.uuid, system: item.toObject().system, flags: { [SYS]: { uuid: item.uuid } }, scToken: token }
    : { crew: { name: actor.name, img: actor.img, crew_card: true, role: title, scToken: token } };
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
  const spendHint = (adv || tri || threat || des) ? `<p class="sc-hint">Avantages et menaces : voir l'onglet <em>Règles › Avantages / Menaces</em> du tableau (tables 7-5 et 7-6).</p>` : "";

  switch (p.type) {
    case "attack": {
      if (!p.guided) await exec("markFired", { key: p.key, weaponId: p.weaponId, aimActor: p.aimActor ?? null });
      const tShip = state.ships.find((s) => s.key === p.target);
      const tActor = tShip ? shipActor(tShip) : null;
      const weapon = actor.items.get(p.weaponId);
      if (!tActor || !weapon) return;
      const w = weaponStats(weapon);
      if (!ok) {
        let html = `<h3>${esc(weapon.name)}${p.guided ? " (projectile guidé)" : ""} : raté</h3><p>${esc(actor.name)} manque ${esc(tActor.name)}. ${symbols}</p>`;
        const buttons = [];
        if (w.q.guided && (adv >= 3 || tri)) {
          html += `<p>Projectile guidé ${w.q.guided} : [AD][AD][AD] (ou [TR]) pour une nouvelle attaque à la fin du round, avec ${w.q.guided} [AB].</p>`;
          buttons.push(`<button type="button" class="sc-guided" data-key="${p.key}" data-target="${p.target}" data-weapon="${p.weaponId}" data-zone="${p.zone ?? ""}"><i class="fa-solid fa-rocket" aria-hidden="true"></i> Relancer le projectile guidé</button>`);
        }
        if (des) html += `<p>[DE] : l'arme principale peut subir un dégât critique de composant, ou collision mineure (table 7-6).</p>`;
        await chat(dice(html + spendHint + (buttons.length ? `<div class="sc-buttons">${buttons.join("")}</div>` : "")), actor);
        return;
      }
      const tst = stats(tActor);
      const zone = R.ZONES[p.zone] ?? "";
      if (tShip) {
        // mémorise la zone touchée pour les critiques qui en dépendent
        const s2 = getState();
        const t2 = s2.ships.find((s) => s.key === p.target);
        if (t2 && game.user.isGM) {
          t2.lastZone = p.zone;
          await saveState(s2);
        }
      }
      if (w.q.tractor) {
        await chat(dice(`<h3>${esc(weapon.name)} : touché !</h3><p>${esc(actor.name)} → <strong>${esc(tActor.name)}</strong>. ${symbols}</p><p>Rayon tracteur ${w.q.tractor} : la cible est immobilisée jusqu'à ce que son pilote réussisse un test de Pilotage ${diffLabel(w.q.tractor)}.</p><div class="sc-buttons">${opButton(`Immobiliser ${esc(tActor.name)}`, "tractor", { key: p.target, rating: w.q.tractor, by: p.key }, "fa-solid fa-magnet")}</div>`), actor);
        return;
      }
      const out = R.attackOutcome({ weaponDamage: w.damage, successes: success, armour: tst.armour, breach: w.q.breach, critRating: w.crit, advantages: adv, triumphs: tri });
      let html = `<h3>${esc(weapon.name)}${p.guided ? " (projectile guidé)" : ""} : touché !</h3>
        <p>${esc(actor.name)} → <strong>${esc(tActor.name)}</strong>${zone ? ` (zone ${zone})` : ""}. ${symbols}</p>
        <p>Dégâts ${w.damage} + ${success} succès = <strong>${out.damage}</strong> − blindage ${out.armour}${w.q.breach ? ` (Brèche ${w.q.breach})` : ""} = <strong>${out.hull}</strong> ${w.q.ion ? "stress mécanique (Ionique)" : "dégâts de coque"}.</p>`;
      const buttons = [];
      if (out.hull > 0) buttons.push(opButton(`Appliquer ${out.hull} ${w.q.ion ? "stress" : "coque"} à ${esc(tActor.name)}`, "applyDamage", { key: p.target, amount: out.hull, ion: w.q.ion }, "fa-solid fa-burst"));
      // Coups supplémentaires : Jumelé N (au plus N) et rafale Automatique, [AD][AD] chacun (ou [TR]).
      const activations = Math.floor(adv / 2) + tri;
      const extra = p.autofire ? activations : Math.min(w.q.linked, activations);
      if ((w.q.linked || p.autofire) && out.hull > 0) {
        html += p.autofire
          ? `<p>Rafale (Automatique) : [AD][AD] par coup supplémentaire (mêmes dégâts), sur cette cible ou une autre à portée.</p>`
          : `<p>Jumelé ${w.q.linked} : [AD][AD] par coup supplémentaire sur la même cible (mêmes dégâts), jusqu'à ${w.q.linked}.</p>`;
        for (let i = 1; i <= extra; i++) buttons.push(opButton(`Coup supplémentaire ${i}/${extra} (+${out.hull})`, "applyDamage", { key: p.target, amount: out.hull, ion: w.q.ion }, "fa-solid fa-plus"));
        if (!extra) html += `<p class="sc-hint">Pas assez d'avantages pour un coup supplémentaire.</p>`;
      }
      if (out.hull > 0) {
        html += out.crit
          ? `<p><strong>Dégât critique déclenché</strong> (${tri ? "[TR]" : `${w.crit} [AD]`}). Chaque critique supplémentaire acheté : +10 au jet.</p>`
          : `<p>Critique : ${w.crit ? `${w.crit} [AD]` : "—"} ou [TR] nécessaires.</p>`;
        buttons.push(`<button type="button" class="sc-crit" data-key="${p.target}" data-zone="${p.zone ?? ""}"><i class="fa-solid fa-explosion" aria-hidden="true"></i> Jet de critique</button>`);
      } else {
        html += `<p>Le blindage absorbe tout : pas de dégât de coque, donc pas de critique possible.</p>`;
      }
      if (w.q.slowFiring) html += `<p>Cadence lente ${w.q.slowFiring} : l'arme pourra retirer au round ${state.round + w.q.slowFiring + 1}.</p>`;
      if (w.q.limitedAmmo) html += `<p>Munitions : ${Math.max(0, w.q.limitedAmmo - w.ammoUsed - (p.guided ? 0 : 1))}/${w.q.limitedAmmo} restantes.</p>`;
      if (w.q.blast) html += `<p>Souffle ${w.q.blast} : dans l'espace, l'explosion ne touche pas d'autres vaisseaux.</p>`;
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
    case "control": {
      if (ok) await exec("regainControl", { key: p.key });
      else await chat(dice(`<p>${esc(actor.name)} : le pilote ne parvient pas à reprendre le contrôle. ${symbols}</p>`), actor);
      return;
    }
    case "tractorEscape": {
      if (ok) await exec("escapeTractor", { key: p.key });
      else await chat(dice(`<p>${esc(actor.name)} reste prisonnier du rayon tracteur. ${symbols}</p>`), actor);
      return;
    }
    case "repair": {
      if (!ok) {
        await chat(dice(`<p>${esc(actor.name)} — ${p.label} : échec. ${symbols}</p>${spendHint}`), actor);
        return;
      }
      const perSuccess = state.rules.dcPerSuccess;
      let buttons = "";
      if (p.what === "strain") {
        const amount = perSuccess ? success : 1;
        buttons = opButton(`Retirer ${amount} stress`, "repair", { key: p.key, what: "strain", amount }, "fa-solid fa-wrench");
      } else if (p.what === "hull") {
        const amount = perSuccess ? success : 1;
        buttons = opButton(`Retirer ${amount} coque`, "repair", { key: p.key, what: "hull", amount, encounter: true }, "fa-solid fa-wrench");
      } else if (p.what === "crit") {
        buttons = opButton(`Réparer : ${esc(p.critName)}`, "repairCrit", { key: p.key, itemId: p.itemId }, "fa-solid fa-screwdriver-wrench");
      } else if (p.what === "emergency") {
        buttons = opButton("Appliquer la réparation d'urgence", "emergencyRepair", { key: p.key }, "fa-solid fa-screwdriver-wrench");
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
        buttons = R.zonesFor(stats(actor).sil).map((z) => opButton(`+1 défense ${R.ZONES[z]} (${success} round(s))`, "intensify", { key: p.key, zone: z, rounds: success }, "fa-solid fa-shield-halved")).join("");
      }
      if (ok && a.key === "manual") {
        const amount = 1 + Math.floor((success - 1) / 2);
        buttons = opButton(`Retirer ${amount} coque`, "repair", { key: p.key, what: "hull", amount, encounter: true }, "fa-solid fa-wrench");
      }
      await chat(dice(`<h3>${esc(actor.name)} — ${esc(a.label)} : ${ok ? "réussi" : "échec"}</h3><p>${symbols}</p>${ok ? `<p>${a.result}</p>` : ""}${spendHint}${buttons ? `<div class="sc-buttons">${buttons}</div>` : ""}`), actor);
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
    position: { width: 480 },
    content,
    rejectClose: false,
    render: renderCb,
    buttons: [
      { action: "ok", label, icon: "fa-solid fa-dice-d20", default: true, callback: (ev, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
      { action: "cancel", label: "Annuler" },
    ],
  }).then((r) => (r && typeof r === "object" ? r : null));
}

const confirm = (title, html) => DialogV2.confirm({ window: { title }, content: html, rejectClose: false });

/** Bonus ou malus qui pèsent sur tous les jets d'un vaisseau (Bousculé : équipage désorienté). */
function shipSetback(ship, state) {
  return isActive(ship.effects.jostled, state.round) ? 1 : 0;
}

async function attackDialog(state, key) {
  const { ship, actor } = findShip(state, key);
  if (!checkCrew(actor, "gunner")) return;
  const weapons = actor.items.filter((i) => i.type === "shipweapon").map(weaponStats);
  if (!weapons.length) return ui.notifications.warn(`${actor.name} n'a aucune arme de vaisseau.`);
  const targets = state.ships.filter((s) => s.key !== key && shipActor(s));
  if (!targets.length) return ui.notifications.warn("Aucune cible dans la rencontre.");
  const defaultTarget = targets.find((s) => s.side !== ship.side) ?? targets[0];
  const ready = weapons.find((w) => !weaponBlock(ship, actor, w, state.round)) ?? weapons[0];
  const ast = stats(actor);
  const sameName = (w) => weapons.filter((x) => x.name === w.name);

  const content = `
    <div class="form-group"><label for="sc-crew">Tireur</label>${crewSelectHTML(actor, "gunner", "gunner")}</div>
    <div class="form-group"><label for="sc-weapon">Arme</label><select name="weapon" id="sc-weapon">${weapons.map((w) => {
      const block = weaponBlock(ship, actor, w, state.round);
      return `<option value="${w.id}" ${w.id === ready.id ? "selected" : ""}>${esc(w.name)}${block ? ` (${esc(block)})` : ""}${w.q.limitedAmmo ? ` — munitions ${Math.max(0, w.q.limitedAmmo - w.ammoUsed)}/${w.q.limitedAmmo}` : ""}</option>`;
    }).join("")}</select></div>
    <div class="form-group"><label for="sc-target">Cible</label><select name="target" id="sc-target">${targets.map((s) => `<option value="${s.key}" ${s.key === defaultTarget.key ? "selected" : ""}>${esc(shipActor(s).name)}</option>`).join("")}</select></div>
    <div class="form-group"><label for="sc-range">Portée de la cible</label><select name="range" id="sc-range">${R.RANGE_ORDER.map((k, i) => `<option value="${i}">${R.RANGES[k]}</option>`).join("")}</select></div>
    <div class="form-group"><label for="sc-arc">La cible est dans l'arc</label><select name="arc" id="sc-arc">${Object.entries(R.ARCS).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></div>
    <div class="form-group"><label for="sc-zone">Zone visée</label><select name="zone" id="sc-zone"></select></div>
    <div class="form-group sc-autofire-row"><label for="sc-autofire">Tir en rafale (Automatique)</label><input type="checkbox" name="autofire" id="sc-autofire" checked></div>
    ${game.user.isGM && ast.sil >= 5 ? `<div class="form-group sc-battery-row"><label for="sc-battery">Tir en batterie (armes identiques)</label><select name="battery" id="sc-battery"></select></div>` : ""}
    <div class="form-group"><label>Dés en plus</label>
      <span class="sc-inline"><label for="sc-boost">[BO]</label> <input type="number" name="boost" id="sc-boost" value="0" min="0" max="9"> <label for="sc-setback">[SE]</label> <input type="number" name="setback" id="sc-setback" value="0" min="0" max="9"></span></div>
    <div class="sc-summary" aria-live="polite"></div>`;

  const compute = (fd) => {
    const w = weapons.find((x) => x.id === fd.weapon) ?? weapons[0];
    const t = state.ships.find((s) => s.key === fd.target);
    const ta = shipActor(t);
    const tst = stats(ta);
    const hasAdv = ship.advantage?.target === t.key && isActive(ship.advantage.round, state.round);
    const notes = [];
    const warnings = [];
    const difficulty = R.silhouetteDifficulty(ast.sil, tst.sil);
    notes.push(`Gabarit ${ast.sil} contre ${tst.sil} : ${diffLabel(difficulty)}`);
    let upD = 0;
    let upA = 0;
    let setback = 0;
    let boost = 0;
    if (isActive(ship.effects.evasive, state.round)) { upD++; notes.push("le tireur est en évasion : +1 amélioration de difficulté"); }
    if (isActive(t.effects.evasive, state.round)) {
      if (hasAdv) notes.push("la cible est en évasion, mais l'avantage pris l'annule");
      else { upD++; notes.push("la cible est en évasion : +1 amélioration de difficulté"); }
    }
    if (isActive(ship.effects.stick, state.round)) { upA++; notes.push("le tireur colle à sa cible : +1 amélioration d'aptitude"); }
    if (isActive(t.effects.stick, state.round)) { upA++; notes.push("la cible colle à quelqu'un : +1 amélioration d'aptitude"); }
    if (isActive(ship.effects.tumbled, state.round)) { setback += 2; notes.push("vaisseau culbuté : +2 [SE]"); }
    if (shipSetback(ship, state)) { setback += 1; notes.push("équipage désorienté (Bousculé) : +1 [SE]"); }
    const zones = R.zonesFor(tst.sil);
    let zone = fd.zone && zones.includes(fd.zone) ? fd.zone : null;
    if (!zone) {
      const sorted = [...zones].sort((x, y) => tst.shields[x] - tst.shields[y]);
      // Gabarit ≤ 4 : la cible présente sa zone la mieux défendue, sauf si le tireur a pris l'avantage.
      // Gabarit 5+ : la position du tireur décide (dernière zone connue).
      if (tst.sil <= 4) zone = hasAdv ? sorted[0] : sorted.at(-1);
      else zone = state.arcs[`${t.key}>${key}`] && zones.includes(state.arcs[`${t.key}>${key}`]) ? state.arcs[`${t.key}>${key}`] : "fore";
    }
    const def = tst.shields[zone] ?? 0;
    if (def) notes.push(`défense ${R.ZONES[zone]} ${def} : +${def} [SE]`);
    if (w.q.accurate) { boost += w.q.accurate; notes.push(`Précis ${w.q.accurate} : +${w.q.accurate} [BO]`); }
    const aim = fd.crew ? ship.aims[fd.crew] : null;
    if (aim && aim.round === state.round) { boost += aim.boost; notes.push(`visée : +${aim.boost} [BO]`); }
    const autofire = w.q.autofire && !!fd.autofire;
    if (autofire) { upD += 0; notes.push("tir en rafale : +1 [DI]"); }
    const battery = Math.max(1, Number(fd.battery || 1));
    if (battery > 1) notes.push(`tir en batterie de ${battery} armes : une seule attaque, rangs de compétence = ${battery - 1} (règle des sbires), toutes ces armes comptent comme ayant tiré`);
    if ((ship.group ?? 1) > 1) notes.push(`escadrille de ${squadronLeft(ship, ast)} : une seule attaque ; sans personnage choisi, rangs de compétence = taille − 1`);
    // Portée et arc (narratifs : choisis par le joueur ou le MJ)
    const range = Number(fd.range ?? getRange(state, key, t.key) ?? 0);
    if (w.rangeIndex >= 0 && range > w.rangeIndex) warnings.push(`hors de portée : l'arme porte jusqu'à ${w.range.toLowerCase()}`);
    const arcOk = !w.arcKeys.length || w.arcKeys.includes(fd.arc);
    if (!arcOk) warnings.push(`la cible n'est pas dans l'arc de tir de l'arme (${w.arcs.join("/")})`);
    const block = weaponBlock(ship, actor, w, state.round);
    if (block) warnings.push(`arme indisponible : ${block}`);
    notes.push(`Arme : dégâts ${w.damage}, critique ${w.crit}, portée ${w.range}, arc ${w.arcs.join("/") || "?"}${w.special ? `, ${w.special}` : ""}`);
    if (tst.sil <= 4) notes.push(hasAdv ? "avantage pris : le tireur choisit la zone" : "la cible présente sa zone la mieux défendue");
    else notes.push("gros vaisseau : la zone visée dépend de la position du tireur");
    return { w, t, ta, tst, difficulty: difficulty + (autofire ? 1 : 0), upD, upA, setback, boost, zone, zones, def, notes, warnings, hasAdv, autofire, battery, range, block };
  };

  const refresh = (dialog, changed) => {
    const formEl = dialog.element.querySelector("form");
    const els = formEl.elements;
    // valeurs par défaut quand la cible ou l'arme change : portée et arc mémorisés
    if (!changed || changed === "target") {
      const tKey = els.target.value;
      const r = getRange(state, key, tKey);
      if (r !== undefined) els.range.value = String(r);
      const arc = state.arcs[`${key}>${tKey}`];
      const w = weapons.find((x) => x.id === els.weapon.value) ?? weapons[0];
      els.arc.value = arc ?? w.arcKeys[0] ?? "fore";
    }
    const fd = new foundry.applications.ux.FormDataExtended(formEl).object;
    const c = compute(fd);
    const zoneSel = els.zone;
    const cur = zoneSel.value;
    zoneSel.innerHTML = c.zones.map((z) => `<option value="${z}" ${z === (c.zones.includes(cur) ? cur : c.zone) ? "selected" : ""}>${R.ZONES[z]} (défense ${c.tst.shields[z]})</option>`).join("");
    if (!c.zones.includes(cur)) zoneSel.value = c.zone;
    const locked = c.tst.sil <= 4 && !c.hasAdv;
    zoneSel.disabled = locked;
    zoneSel.title = locked ? "Un vaisseau de gabarit 4 ou moins présente sa zone la mieux défendue, sauf si le tireur a pris l'avantage." : "";
    formEl.querySelector(".sc-autofire-row").hidden = !c.w.q.autofire;
    const bat = els.battery;
    if (bat) {
      const n = sameName(c.w).length;
      const prev = Number(bat.value || 1);
      bat.innerHTML = Array.from({ length: n }, (_, i) => `<option value="${i + 1}" ${i + 1 === Math.min(prev, n) ? "selected" : ""}>${i === 0 ? "Non (une seule arme)" : `${i + 1} armes`}</option>`).join("");
      formEl.querySelector(".sc-battery-row").hidden = n < 2;
    }
    formEl.querySelector(".sc-summary").innerHTML = `<ul>${c.notes.map((n) => `<li>${dice(esc(n))}</li>`).join("")}${c.warnings.map((n) => `<li class="sc-warn">⚠ ${dice(esc(n))}</li>`).join("")}</ul>${locked ? `<p class="sc-hint">Zone imposée : la cible présente sa zone la mieux défendue (prenez l'avantage pour choisir).</p>` : ""}`;
  };

  const fd = await form(`Attaque — ${actor.name}`, dice(content), "Lancer l'attaque", (ev, dialog) => {
    refresh(dialog);
    dialog.element.querySelector("form").addEventListener("change", (e) => {
      if (e.target.name === "target" || e.target.name === "weapon") dialog.element.querySelector("select[name=zone]").value = "";
      refresh(dialog, e.target.name);
    });
  });
  if (!fd) return;
  const c = compute(fd);
  if (c.block && !game.user.isGM) return ui.notifications.warn(`${c.w.name} : ${c.block}.`);
  if (c.warnings.length && !(await confirm("Tirer quand même ?", `<ul>${c.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul><p>Tirer quand même ?</p>`))) return;
  // mémorise la portée et l'arc pour les prochains tirs
  exec("setRange", { a: key, b: c.t.key, range: c.range });
  exec("setArc", { from: key, to: c.t.key, arc: fd.arc, by: key });
  if (c.tst.sil >= 5 && fd.zone) exec("setArc", { from: c.t.key, to: key, arc: fd.zone, by: key });
  const weapon = actor.items.get(c.w.id);
  const battery = c.battery > 1 ? sameName(c.w).slice(0, c.battery) : [];
  for (const bw of battery.slice(1)) exec("markFired", { key, weaponId: bw.id });
  await openRoll({
    actor, crewId: fd.crew, skill: c.w.skill, difficulty: c.difficulty, upDifficulty: c.upD, upAbility: c.upA,
    boost: Number(fd.boost || 0) + c.boost, setback: Number(fd.setback || 0) + c.def + c.setback,
    item: weapon, title: `Attaque : ${weapon.name}`,
    minion: !fd.crew ? Math.max(c.battery, squadronLeft(ship, ast)) : 0,
    next: { type: "attack", key, target: c.t.key, weaponId: weapon.id, zone: c.zone, autofire: c.autofire, aimActor: fd.crew || null },
  });
}

/** Nouvelle attaque d'un projectile guidé (attribut Projectile guidé), lancée par le MJ. */
async function guidedRoll(key, target, weaponId, zone) {
  const state = getState();
  const { actor } = findShip(state, key);
  const { ship: tShip, actor: tActor } = findShip(state, target);
  const weapon = actor.items.get(weaponId);
  if (!weapon) return;
  const w = weaponStats(weapon);
  const tst = stats(tActor);
  const z = zone || R.zonesFor(tst.sil).sort((x, y) => tst.shields[y] - tst.shields[x])[0];
  const evasive = isActive(tShip.effects.evasive, state.round) ? 1 : 0;
  await openRoll({
    actor, crewId: null, skill: w.skill, ability: w.q.guided,
    difficulty: R.silhouetteDifficulty(0, tst.sil), upDifficulty: evasive, setback: tst.shields[z] ?? 0,
    item: weapon, title: `Projectile guidé : ${weapon.name}`,
    next: { type: "attack", key, target, weaponId, zone: z, guided: true },
  });
}

async function aimDialog(state, key) {
  const { actor } = findShip(state, key);
  if (!checkCrew(actor, "gunner")) return;
  const content = `
    <p>Manœuvre ordinaire : viser donne [BO] à la prochaine attaque de ce personnage ce round (+2 [BO] en y consacrant deux manœuvres).</p>
    <div class="form-group"><label for="sc-crew">Artilleur</label>${crewSelectHTML(actor, "gunner", "gunner")}</div>
    <div class="form-group"><label for="sc-aim">Manœuvres</label><select name="boost" id="sc-aim"><option value="1">1 manœuvre : +1 [BO]</option><option value="2">2 manœuvres : +2 [BO]</option></select></div>`;
  const fd = await form(`Viser — ${actor.name}`, dice(content), "Viser");
  if (!fd?.crew) return;
  await exec("setAim", { key, actorId: fd.crew, boost: Number(fd.boost) });
}

async function advantageDialog(state, key) {
  const { ship, actor } = findShip(state, key);
  if (!checkCrew(actor, "pilot")) return;
  const st = stats(actor);
  if (st.sil > 4) return ui.notifications.warn("Prendre l'avantage : gabarit 4 maximum.");
  if (st.speed < 4) return ui.notifications.warn("Prendre l'avantage : vitesse 4 minimum.");
  const targets = state.ships.filter((s) => s.key !== key && shipActor(s));
  if (!targets.length) return ui.notifications.warn("Aucun adversaire dans la rencontre.");
  const def = targets.find((s) => s.side !== ship.side) ?? targets[0];
  const diffFor = (tKey) => {
    const t = state.ships.find((s) => s.key === tKey);
    const base = R.speedDifficulty(st.speed, stats(shipActor(t)).speed);
    const prev = state.duels[pairKey(key, tKey)] ?? 0;
    return { base, prev, total: base + prev };
  };
  const content = `
    <div class="form-group"><label for="sc-crew">Pilote</label>${crewSelectHTML(actor, "pilot", "pilot")}</div>
    <div class="form-group"><label for="sc-target">Adversaire</label><select name="target" id="sc-target">${targets.map((s) => `<option value="${s.key}" ${s.key === def.key ? "selected" : ""}>${esc(shipActor(s).name)} (vitesse ${stats(shipActor(s)).speed})</option>`).join("")}</select></div>
    <div class="sc-summary" aria-live="polite"></div>`;
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
    boost: Math.max(0, st.handling), setback: Math.max(0, -st.handling) + shipSetback(ship, state),
    title: "Prendre l'avantage", next: { type: "advantage", key, target: fd.target },
  });
}

/** Test de Pilotage générique d'un pilote (reprendre le contrôle, se libérer d'un rayon tracteur). */
async function pilotCheckDialog(state, key, { title, difficulty, type, hint }) {
  const { ship, actor } = findShip(state, key);
  if (!checkCrew(actor, "pilot")) return;
  const st = stats(actor);
  const content = `<p>${hint}</p><div class="form-group"><label for="sc-crew">Pilote</label>${crewSelectHTML(actor, "pilot", "pilot")}</div>`;
  const fd = await form(`${title} — ${actor.name}`, dice(content), "Lancer");
  if (!fd) return;
  await openRoll({
    actor, crewId: fd.crew, skill: "Piloting", difficulty,
    boost: Math.max(0, st.handling), setback: Math.max(0, -st.handling) + shipSetback(ship, state),
    title, next: { type, key },
  });
}

async function repairDialog(state, key) {
  const { ship, actor } = findShip(state, key);
  if (!checkCrew(actor, null)) return;
  const st = stats(actor);
  const crits = critItems(actor);
  const adrift = !!ship.effects.adrift || st.hull > st.hullMax;
  const options = [
    `<option value="strain">Stress mécanique (${st.strain}/${st.strainMax}) — ${diffName(R.damageControlDifficulty(st.strain, st.strainMax))}</option>`,
    `<option value="hull" ${ship.repaired ? "disabled" : ""}>Dégâts de coque (${st.hull}/${st.hullMax}) — ${diffName(R.damageControlDifficulty(st.hull, st.hullMax))}${ship.repaired ? " — déjà fait cette rencontre" : ""}</option>`,
    ...(adrift ? [`<option value="emergency" selected>Réparation d'urgence (vaisseau à la dérive) — Difficile</option>`] : []),
    ...crits.map((c) => {
      const locked = c.getFlag(SYS, `${FLAG}.lock`);
      const sev = c.system.severity;
      return `<option value="crit:${c.id}" ${locked || sev >= 5 || sev === 0 ? "disabled" : ""}>Critique : ${esc(c.name)} — ${sev >= 5 || sev === 0 ? "irréparable" : diffName(sev)}${locked ? " — pas avant la fin de la rencontre" : ""}</option>`;
    }),
  ];
  const rule = state.rules.dcPerSuccess ? "1 point par succès (règle VO)" : "1 point par test réussi (livre FR)";
  const content = `
    <div class="form-group"><label for="sc-crew">Mécanicien</label>${crewSelectHTML(actor, "engineer")}</div>
    <div class="form-group"><label for="sc-what">Réparer</label><select name="what" id="sc-what">${options.join("")}</select></div>
    <p class="sc-hint">Contrôle des dégâts (p. 234) : une action par personnage et par tour ; ${rule}. La coque ne peut être réparée qu'une fois par rencontre.</p>`;
  const fd = await form(`Contrôle des dégâts — ${actor.name}`, content, "Lancer");
  if (!fd) return;
  let difficulty;
  let next;
  if (fd.what === "strain") {
    difficulty = R.damageControlDifficulty(st.strain, st.strainMax);
    next = { type: "repair", key, what: "strain", label: "Contrôle des dégâts (stress)" };
  } else if (fd.what === "hull") {
    difficulty = R.damageControlDifficulty(st.hull, st.hullMax);
    next = { type: "repair", key, what: "hull", label: "Contrôle des dégâts (coque)" };
  } else if (fd.what === "emergency") {
    difficulty = 3;
    next = { type: "repair", key, what: "emergency", label: "Réparation d'urgence" };
  } else {
    const crit = actor.items.get(fd.what.split(":")[1]);
    if (!crit) return;
    difficulty = crit.system.severity;
    next = { type: "repair", key, what: "crit", itemId: crit.id, critName: crit.name, label: `Réparer ${crit.name}` };
  }
  await openRoll({ actor, crewId: fd.crew, skill: "Mechanics", difficulty, setback: shipSetback(ship, state), title: next.label, next });
}

async function terrainDialog(state, key) {
  const { ship, actor } = findShip(state, key);
  if (!checkCrew(actor, "pilot")) return;
  const st = stats(actor);
  const t = R.terrainCheck(st.speed, st.sil);
  const content = `
    <div class="form-group"><label for="sc-crew">Pilote</label>${crewSelectHTML(actor, "pilot", "pilot")}</div>
    <div class="form-group"><label for="sc-danger">Danger (table 7-8)</label><select name="danger" id="sc-danger">
      <option value="0">Simple : terrain dégagé, champ d'astéroïdes peu dense</option>
      <option value="1">+1 dé d'infortune : terrain ardu, astéroïdes, survol de montagnes</option>
      <option value="2">+2 dés d'infortune : terrain dangereux, comète fracturée, astéroïdes très denses</option>
      <option value="3">+3 dés d'infortune : extrêmement périlleux (la Gueule, tunnels d'astéroïde…)</option>
    </select></div>
    <p class="sc-hint">Vitesse ${st.speed} et gabarit ${st.sil} (moitié : ${Math.ceil(st.sil / 2)}) : ${t.difficulty} [DI] dont ${t.upgrades} amélioré(s) en [CH]. Maniabilité ${signed(st.handling)}.</p>`;
  const fd = await form(`Terrain — ${actor.name}`, dice(content), "Lancer");
  if (!fd) return;
  await openRoll({
    actor, crewId: fd.crew, skill: "Piloting", difficulty: t.difficulty, upDifficulty: t.upgrades,
    boost: Math.max(0, st.handling), setback: Math.max(0, -st.handling) + Number(fd.danger || 0) + shipSetback(ship, state),
    title: "Pilotage (terrain)", next: { type: "terrain", key },
  });
}

async function crewActionDialog(state, key, preset) {
  const { ship, actor } = findShip(state, key);
  if (!checkCrew(actor, null)) return;
  const content = `
    <div class="form-group"><label for="sc-crew">Personnage</label>${crewSelectHTML(actor)}</div>
    <div class="form-group"><label for="sc-action">Action</label><select name="action" id="sc-action">${R.CREW_ACTIONS.map((a) => {
      const opts = [`<option value="${a.key}" ${a.key === preset ? "selected" : ""}>${esc(a.label)} — ${skillLabel(skillKey(a.skill, actor))} ${R.DIFFICULTY_NAMES[a.difficulty]}</option>`];
      if (a.alt) opts.push(`<option value="${a.key}|alt">${esc(a.label)} — ${skillLabel(a.alt.skill)} ${R.DIFFICULTY_NAMES[a.alt.difficulty]}</option>`);
      return opts.join("");
    }).join("")}</select></div>
    <div class="sc-summary" aria-live="polite"></div>`;
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
    boost: piloting ? Math.max(0, st.handling) : 0, setback: (piloting ? Math.max(0, -st.handling) : 0) + shipSetback(ship, state),
    title: a.label, next: { type: "crewAction", key, action: a.key },
  });
}

async function critDialog(state, key, zone = null) {
  if (!game.user.isGM) return ui.notifications.warn("Seul le MJ lance les dégâts critiques.");
  const { ship, actor } = findShip(state, key);
  if ((ship.group ?? 1) > 1) {
    if (!(await confirm("Escadrille", `<p>Règle des sbires : un dégât critique abat un appareil de l'escadrille ${esc(actor.name)}. Continuer ?</p>`))) return;
    return exec("rollCrit", { key });
  }
  const existing = critItems(actor).length;
  const rig = juryRig(actor);
  const content = `
    <p>Jet sur la table 7-9 (p. 245) : d100 + 10 par critique non réparé (${existing} actuellement : +${existing * 10})${rig ? ", +30 (réparation d'urgence)" : ""}. Les effets sont appliqués automatiquement.</p>
    <div class="form-group"><label for="sc-extra">Critiques supplémentaires achetés</label><input type="number" name="extra" id="sc-extra" value="0" min="0" max="9"></div>
    <div class="form-group"><label for="sc-bonus">Autre bonus (talents, arme…)</label><input type="number" name="bonus" id="sc-bonus" value="0" step="5"></div>
    <div class="form-group"><label for="sc-zone">Zone touchée</label><select name="zone" id="sc-zone">${R.zonesFor(stats(actor).sil).map((z) => `<option value="${z}" ${z === (zone || ship.lastZone) ? "selected" : ""}>${R.ZONES[z]}</option>`).join("")}</select></div>`;
  const fd = await form(`Dégât critique — ${actor.name}`, content, "Lancer le d100");
  if (!fd) return;
  await exec("rollCrit", { key, bonus: Number(fd.extra || 0) * 10 + Number(fd.bonus || 0), zone: fd.zone });
}

async function collisionDialog(state, key) {
  if (!game.user.isGM) return ui.notifications.warn("Seul le MJ gère les collisions.");
  const { actor } = findShip(state, key);
  const st = stats(actor);
  const zones = R.zonesFor(st.sil);
  const content = `
    <div class="form-group"><label for="sc-major">Type</label><select name="major" id="sc-major"><option value="0">Collision mineure (− défense × 10)</option><option value="1">Collision majeure (− défense × 5)</option></select></div>
    <div class="form-group"><label for="sc-zone">Zone percutée</label><select name="zone" id="sc-zone">${zones.map((z) => `<option value="${z}">${R.ZONES[z]} (défense ${st.shields[z]})</option>`).join("")}</select></div>
    <p class="sc-hint">Une collision inflige toujours un dégât critique, réduit par la défense de la zone ; il est annulé si le résultat final est de 0 ou moins (p. 243).</p>`;
  const fd = await form(`Collision — ${actor.name}`, content, "Lancer le d100");
  if (!fd) return;
  await exec("rollCrit", { key, zone: fd.zone, collision: { major: fd.major === "1", defense: st.shields[fd.zone] ?? 0 } });
}

async function shiftDialog(state, key) {
  const { actor } = findShip(state, key);
  if (!checkCrew(actor, null)) return;
  const st = stats(actor);
  const zones = R.zonesFor(st.sil);
  const opts = (sel) => zones.map((z) => `<option value="${z}" ${z === sel ? "selected" : ""}>${R.ZONES[z]} (${st.shields[z]})</option>`).join("");
  const from = zones.find((z) => st.shields[z] > 0) ?? zones[0];
  const content = `
    <p>Manœuvre (pas de pilote) : transférer 1 point de défense d'une zone à une autre (p. 234). Les valeurs d'origine sont restaurées à la fin de la rencontre.</p>
    <div class="form-group"><label for="sc-from">Depuis</label><select name="from" id="sc-from">${opts(from)}</select></div>
    <div class="form-group"><label for="sc-to">Vers</label><select name="to" id="sc-to">${opts(zones.find((z) => z !== from))}</select></div>`;
  const fd = await form(`Réorienter les boucliers — ${actor.name}`, content, "Transférer");
  if (!fd) return;
  await exec("shift", { key, from: fd.from, to: fd.to });
}

/** Pourquoi une manœuvre de pilote est impossible (texte affiché sous les boutons et dans les infobulles). */
function maneuverBlock(ship, actor, st, m, state) {
  const lim = restrictions(actor);
  if (lim.noManeuver) return "moteur à l'arrêt";
  if (ship.effects.tractor) return "rayon tracteur";
  if (isActive(ship.effects.deviated, state.round) || ship.effects.needsControl) return "vaisseau dévié";
  if (isActive(ship.effects.tumbled, state.round)) return "équipage immobilisé";
  if (m.pilot && ship.pm >= pilotLimit(st.sil)) return "limite de manœuvres atteinte";
  if (st.sil > m.maxSil) return `gabarit 1 à ${m.maxSil}`;
  if (st.speed < m.minSpeed) return `vitesse ${m.minSpeed} minimum`;
  return null;
}

async function maneuverClick(state, key, kind) {
  const { ship, actor } = findShip(state, key);
  if (!checkCrew(actor, "pilot")) return;
  const m = R.MANEUVERS[kind];
  const st = stats(actor);
  const block = maneuverBlock(ship, actor, st, m, state);
  if (block) return ui.notifications.warn(`${m.label} : ${block}.`);
  let paid = "strain";
  if (m.pilot && ship.pm === 1) {
    const lim = restrictions(actor);
    const buttons = [];
    if (!lim.noStrainManeuver) buttons.push({ action: "strain", label: `Subir 2 stress mécanique (${st.strain} → ${st.strain + 2} / ${st.strainMax})`, default: true });
    buttons.push({ action: "action", label: "Sacrifier l'action du pilote", default: lim.noStrainManeuver });
    buttons.push({ action: "cancel", label: "Annuler" });
    paid = await DialogV2.wait({
      window: { title: "Deuxième manœuvre de pilote" },
      content: `<p>${esc(actor.name)} a déjà fait une manœuvre de pilote ce round. Une deuxième se paie soit en <strong>2 points de stress mécanique</strong>, soit en renonçant à l'action du pilote.${lim.noStrainManeuver ? " <em>Fluctuations énergétiques : le stress n'est pas possible.</em>" : ""}</p>`,
      buttons,
      rejectClose: false,
    });
    if (paid !== "strain" && paid !== "action") return;
  }
  if (kind === "punch") {
    const gain = st.maxSpeed - st.speed;
    if (!(await confirm("Mettre la gomme", `<p>Vitesse ${st.speed} → ${st.maxSpeed} : <strong>+${gain} stress mécanique</strong>.</p><p>Continuer ?</p>`))) return;
  }
  let target = null;
  let range = null;
  if (kind === "fly") {
    const others = state.ships.filter((s) => s.key !== key && shipActor(s));
    if (others.length) {
      const def = others.find((s) => s.side !== ship.side) ?? others[0];
      const content = `
        <p>${esc(R.flyText(st.speed))}</p>
        <div class="form-group"><label for="sc-target">Par rapport à</label><select name="target" id="sc-target">${others.map((s) => `<option value="${s.key}" ${s.key === def.key ? "selected" : ""}>${esc(shipActor(s).name)}${getRange(state, key, s.key) !== undefined ? ` (actuellement ${RANGE_FR(getRange(state, key, s.key))})` : ""}</option>`).join("")}</select></div>
        <div class="form-group"><label for="sc-range">Nouvelle distance</label><select name="range" id="sc-range">${R.RANGE_ORDER.map((k, i) => `<option value="${i}" ${i === (getRange(state, key, def.key) ?? 1) ? "selected" : ""}>${R.RANGES[k]}</option>`).join("")}</select></div>`;
      const fd = await form(`Voler — ${actor.name}`, content, "Manœuvrer");
      if (!fd) return;
      target = fd.target;
      range = Number(fd.range);
    }
  }
  await exec("maneuver", { key, kind, paid, target, range });
}

async function settingsDialog(state) {
  const r = state.rules;
  const content = `
    <div class="form-group"><label for="sc-dc">Contrôle des dégâts</label><select name="dcPerSuccess" id="sc-dc">
      <option value="0" ${!r.dcPerSuccess ? "selected" : ""}>1 point par test réussi (livre français)</option>
      <option value="1" ${r.dcPerSuccess ? "selected" : ""}>1 point par succès (version originale)</option></select></div>
    <div class="form-group"><label for="sc-sync">Rounds</label><select name="syncCombat" id="sc-sync">
      <option value="1" ${r.syncCombat ? "selected" : ""}>Suivre le suivi de combat de Foundry</option>
      <option value="0" ${!r.syncCombat ? "selected" : ""}>Bouton « Nouveau round » seulement</option></select></div>
    <div class="form-group"><label for="sc-turn">Tour des joueurs</label><select name="turnLock" id="sc-turn">
      <option value="1" ${r.turnLock ? "selected" : ""}>Pendant un combat, un joueur n'agit qu'au tour de son personnage</option>
      <option value="0" ${!r.turnLock ? "selected" : ""}>Les joueurs peuvent agir à tout moment</option></select></div>`;
  const fd = await form("Réglages du combat spatial", content, "Enregistrer");
  if (!fd) return;
  await exec("setRules", { dcPerSuccess: fd.dcPerSuccess === "1", syncCombat: fd.syncCombat === "1", turnLock: fd.turnLock === "1" });
}

/* -------------------------------------------------------------------------- */
/*  Application                                                               */
/* -------------------------------------------------------------------------- */

const RULE_TABS = [
  ["guide", "Déroulement", "fa-graduation-cap"],
  ["pilot", "Pilote", "fa-gamepad"],
  ["gunner", "Artilleur", "fa-crosshairs"],
  ["crew", "Autres postes", "fa-users"],
  ["symbols", "Avantages / Menaces", "fa-scale-balanced"],
  ["help", "Aide-mémoire", "fa-book"],
];

export class SpaceCombatApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "space-combat",
    classes: ["starwarsffg-v14", "space-combat"],
    window: { title: "Combat spatial", icon: "fa-solid fa-jet-fighter", resizable: true },
    position: { width: 1000, height: 780 },
    actions: {
      scTab: SpaceCombatApp.#onTab,
      scJump: SpaceCombatApp.#onJump,
      addSelected: SpaceCombatApp.#onAddSelected,
      nextRound: SpaceCombatApp.#onNextRound,
      endEncounter: SpaceCombatApp.#onEndEncounter,
      settings: SpaceCombatApp.#onSettings,
      ship: SpaceCombatApp.#onShipAction,
    },
  };

  tab = "combat";
  ruleTab = "guide";

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
    const access = userAccess(actor, game.user, state);
    const chips = [];
    const effects = { push: (c) => chips.push(c) };
    const pilotTurn = "jusqu'à la fin du prochain tour du pilote";
    if (isActive(ship.effects.evasive, state.round)) effects.push({ key: "evasive", label: `Évasion (R${ship.effects.evasive})`, hint: `${R.MANEUVERS.evasive.hint}` });
    if (isActive(ship.effects.stick, state.round)) effects.push({ key: "stick", label: `Collé à la cible (R${ship.effects.stick})`, hint: R.MANEUVERS.stick.hint });
    if (ship.advantage && isActive(ship.advantage.round, state.round)) {
      const t = state.ships.find((x) => x.key === ship.advantage.target);
      effects.push({ key: "advantage", label: `Avantage sur ${t ? shipActor(t)?.name : "?"} (R${ship.advantage.round})`, hint: "Ignore les manœuvres d'évasion de la cible et choisit la zone touchée." });
    }
    if (isActive(ship.effects.deviated, state.round) || ship.effects.needsControl) effects.push({ key: "deviated", label: "Dévié", hint: `Aucune manœuvre ${pilotTurn} ; le pilote doit réussir un test de Pilotage pour reprendre le contrôle.`, warn: true });
    if (isActive(ship.effects.tumbled, state.round)) effects.push({ key: "tumbled", label: "Culbuté", hint: `Attaques du vaisseau : +2 [SE] ; équipage immobilisé ${pilotTurn}.`, warn: true });
    if (isActive(ship.effects.jostled, state.round)) effects.push({ key: "jostled", label: "Équipage désorienté", hint: "Bousculé : [SE] à tous les tests de l'équipage pendant un round.", warn: true });
    if (isActive(ship.effects.component, state.round)) effects.push({ key: "component", label: "Composant hors service", hint: "Un composant choisi par l'attaquant est inutilisable jusqu'à la fin du prochain round.", warn: true });
    if (ship.effects.fire) effects.push({ key: "fire", label: `Au feu ! (${ship.effects.fire} round(s) pour éteindre)`, hint: "Dégâts de feu pour qui se fait brûler ; tests de Vigilance et/ou Calme pour étouffer l'incendie.", warn: true });
    if (ship.effects.dislocating) effects.push({ key: "dislocating", label: "Dislocation", hint: "Détruit à la fin du prochain round : l'équipage doit fuir.", warn: true });
    if (ship.effects.adrift) effects.push({ key: "adrift", label: "À la dérive", hint: "Seuil de coque dépassé : réparation d'urgence nécessaire (Contrôle des dégâts).", warn: true });
    if (ship.effects.tractor) effects.push({ key: "tractor", label: `Rayon tracteur (${ship.effects.tractor.rating})`, hint: `Immobilisé : test de Pilotage ${diffName(ship.effects.tractor.rating)} pour se libérer.`, warn: true });
    if (juryRig(actor)) effects.push({ key: null, label: "Réparation d'urgence", hint: "Vitesse max 1, maniabilité −3, armes hors service, +30 aux critiques, jusqu'à une réparation en cale sèche.", warn: true });
    if (ship.boost) effects.push({ key: null, label: `Bouclier ${R.ZONES[ship.boost.zone]} intensifié (jusqu'au R${ship.boost.until + 1})`, hint: "+1 défense." });
    for (const [aid, aim] of Object.entries(ship.aims ?? {})) if (aim.round === state.round) effects.push({ key: null, label: `${game.actors.get(aid)?.name ?? "?"} vise (+${aim.boost})`, hint: "Bonus à sa prochaine attaque ce round." });
    if (ship.repaired) effects.push({ key: null, label: "Coque déjà réparée", hint: "Le contrôle des dégâts sur la coque n'est possible qu'une fois par rencontre." });
    const ranges = state.ships.filter((o) => o.key !== ship.key && shipActor(o) && getRange(state, ship.key, o.key) !== undefined)
      .map((o) => ({ key: o.key, name: shipActor(o).name, range: getRange(state, ship.key, o.key) }));
    return {
      ...ship, actor, st, canSee, canAct, access,
      name: actor.name, img: actor.img,
      limit: pilotLimit(st.sil),
      pips: Array.from({ length: pilotLimit(st.sil) }, (_, i) => i < ship.pm),
      zones: R.zonesFor(st.sil).map((z) => ({ key: z, label: R.ZONES[z], value: st.shields[z] })),
      crits: critItems(actor).map((c) => ({ id: c.id, name: c.name, sev: c.system.severity, locked: !!c.getFlag(SYS, `${FLAG}.lock`) })),
      weapons: actor.items.filter((i) => i.type === "shipweapon").map((w) => {
        const ws = weaponStats(w);
        return { ...ws, block: weaponBlock(ship, actor, ws, state.round) };
      }),
      crew: shipCrew(actor),
      chips,
      ranges,
      left: squadronLeft(ship, st),
      lim: restrictions(actor),
    };
  }

  async _renderHTML(context) {
    const top = `<nav class="sc-tabs" role="tablist" aria-label="Combat spatial">
      ${[["combat", "Combat", "fa-jet-fighter"], ["rules", "Règles", "fa-book-open"]].map(([k, l, i]) => `<button type="button" role="tab" aria-selected="${this.tab === k}" class="sc-tab ${this.tab === k ? "active" : ""}" data-action="scTab" data-tab="${k}"><i class="fa-solid ${i}" aria-hidden="true"></i> ${l}</button>`).join("")}
    </nav>`;
    if (this.tab !== "rules") return top + this.#renderCombat(context);
    const sub = `<nav class="sc-subtabs" role="tablist" aria-label="Règles">
      ${RULE_TABS.map(([k, l, i]) => `<button type="button" role="tab" aria-selected="${this.ruleTab === k}" class="sc-tab ${this.ruleTab === k ? "active" : ""}" data-action="scTab" data-rule="${k}"><i class="fa-solid ${i}" aria-hidden="true"></i> ${l}</button>`).join("")}
    </nav>`;
    const page = (html) => `<div class="sc-body sc-help sc-guide" role="tabpanel">${dice(html)}</div>`;
    switch (this.ruleTab) {
      case "pilot": return top + sub + page(T.pilotHTML());
      case "gunner": return top + sub + page(T.gunnerHTML());
      case "crew": return top + sub + page(T.crewHTML(skillLabel));
      case "symbols": return top + sub + page(T.symbolsHTML());
      case "help": return top + sub + this.#renderHelp();
      default: return top + sub + page(GUIDE_HTML);
    }
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
    // listes de portée modifiables (MJ) directement sur la carte du vaisseau
    for (const sel of el.querySelectorAll("select.sc-range-edit")) {
      sel.addEventListener("change", () => exec("setRange", { a: sel.dataset.a, b: sel.dataset.b, range: Number(sel.value) }));
    }
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
    const sync = ctx.state.rules.syncCombat && game.combat?.started;
    const header = `<header class="sc-header">
      <div class="sc-round" aria-live="polite">Round <strong>${ctx.state.round}</strong>${sync ? ` <small>(suit le suivi de combat)</small>` : ""}</div>
      ${ctx.isGM ? `<button type="button" data-action="nextRound"><i class="fa-solid fa-forward-step" aria-hidden="true"></i> Nouveau round</button>` : ""}
      <button type="button" data-action="addSelected" data-side="ally"><i class="fa-solid fa-plus" aria-hidden="true"></i> Jetons sélectionnés → alliés</button>
      <button type="button" data-action="addSelected" data-side="enemy"><i class="fa-solid fa-plus" aria-hidden="true"></i> → ennemis</button>
      ${ctx.isGM ? `<button type="button" data-action="endEncounter"><i class="fa-solid fa-flag-checkered" aria-hidden="true"></i> Fin de la rencontre</button>
      <button type="button" data-action="settings" aria-label="Réglages" data-tooltip="Réglages"><i class="fa-solid fa-gear" aria-hidden="true"></i></button>` : ""}
    </header>`;
    const col = (title, side, list) => `<section class="sc-side sc-${side}" data-side="${side}" aria-label="${title}">
      <h2><i class="fa-solid ${side === "enemy" ? "fa-skull" : "fa-shield-halved"}" aria-hidden="true"></i> ${title}</h2>
      ${list.length ? list.map((s) => this.#renderShip(s, ctx)).join("") : `<p class="sc-empty">Sélectionnez des jetons de véhicules puis utilisez les boutons ci-dessus, ou glissez un véhicule ici.<br>Première fois ? Lisez <button type="button" class="sc-link" data-action="scTab" data-tab="rules" data-rule="guide">Règles › Déroulement</button>.</p>`}
    </section>`;
    return `${header}<div class="sc-body">${col("Alliés", "ally", ctx.allies)}${col("Ennemis", "enemy", ctx.enemies)}</div>`;
  }

  #renderShip(s, ctx) {
    if (s.missing) {
      return `<article class="sc-ship missing"><p>Vaisseau introuvable (jeton supprimé ?)</p>${ctx.isGM ? `<button type="button" data-action="ship" data-op="remove" data-key="${s.key}">Retirer</button>` : ""}</article>`;
    }
    const st = s.st;
    const btn = (op, label, icon, { disabled = false, title = "", extra = "" } = {}) =>
      `<button type="button" data-action="ship" data-op="${op}" data-key="${s.key}" ${extra} ${disabled ? "disabled aria-disabled=\"true\"" : ""} ${title ? `title="${esc(plain(title))}"` : ""}><i class="${icon}" aria-hidden="true"></i> ${label}</button>`;
    const mini = (op, icon, label, extra = "") => `<button type="button" class="sc-mini" data-action="ship" data-op="${op}" data-key="${s.key}" ${extra} aria-label="${esc(label)}" title="${esc(label)}"><i class="fa-solid ${icon}" aria-hidden="true"></i></button>`;
    const bar = (label, value, max, field) => {
      const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
      const over = value > max ? "over" : value * 2 >= max ? "half" : "";
      const ctrl = ctx.isGM ? mini("adjust", "fa-minus", `${label} −1`, `data-field="${field}" data-delta="-1"`) + mini("adjust", "fa-plus", `${label} +1`, `data-field="${field}" data-delta="1"`) : "";
      return `<div class="sc-bar ${over}"><span class="sc-bar-label">${label}</span><span class="sc-bar-track" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${s.canSee ? value : 0}"><span style="width:${s.canSee ? pct : 0}%"></span></span><span class="sc-bar-value">${s.canSee ? `${value}/${max}` : "?"}</span>${ctrl}</div>`;
    };
    // Manœuvres : boutons et raisons d'indisponibilité visibles sous les boutons
    const reasons = {};
    const maneuvers = Object.entries(R.MANEUVERS).map(([k, m]) => {
      const why = maneuverBlock(s, s.actor, st, m, ctx.state);
      if (why) (reasons[why] ??= []).push(m.label);
      return btn(`man-${k}`, m.label, m.icon, { disabled: !!why, title: `${m.hint}${why ? ` — indisponible : ${why}` : ""}` });
    }).join("");
    const why = Object.entries(reasons).map(([r, list]) => `${list.join(", ")} : ${r}`).join(" · ");
    const actions = [];
    const allWeaponsBlocked = s.weapons.length && s.weapons.every((w) => w.block);
    if (s.access.gunner) {
      actions.push(btn("attack", "Attaquer", "fa-solid fa-crosshairs", { title: allWeaponsBlocked ? "Aucune arme disponible ce round" : "" }));
      actions.push(btn("aim", "Viser", "fa-solid fa-bullseye", { title: "Manœuvre : +1 [BO] (ou +2 en deux manœuvres) à la prochaine attaque" }));
    }
    if (s.access.pilot) {
      const advWhy = st.sil > 4 ? "gabarit 1 à 4" : st.speed < 4 ? "vitesse 4 minimum" : null;
      actions.push(btn("advantage", "Prendre l'avantage", "fa-solid fa-arrows-turn-to-dots", { disabled: !!advWhy, title: `Test de Pilotage selon l'écart de vitesse${advWhy ? ` — indisponible : ${advWhy}` : ""}` }));
      actions.push(btn("terrain", "Terrain", "fa-solid fa-meteor"));
      if (s.effects.needsControl) actions.push(btn("control", "Reprendre le contrôle", "fa-solid fa-life-ring", { title: "Test de Pilotage (difficulté selon la vitesse) après un critique « Dévié »" }));
      if (s.effects.tractor) actions.push(btn("escape", "Se libérer du rayon", "fa-solid fa-magnet"));
    }
    if (s.access.crew) actions.push(btn("repair", "Contrôle des dégâts", "fa-solid fa-screwdriver-wrench"), btn("crew", "Action d'équipage", "fa-solid fa-users"));
    if (ctx.isGM) actions.push(btn("crit", "Critique", "fa-solid fa-explosion"), btn("collision", "Collision", "fa-solid fa-car-burst"));
    const undo = s.last && s.last.round === ctx.state.round && (ctx.isGM || s.last.user === game.user.id)
      ? btn("undo", `Annuler : ${esc(s.last.label)}`, "fa-solid fa-rotate-left", { title: "Annule la dernière manœuvre de pilote (vitesse, stress et effets rétablis)" }) : "";
    const sideBadge = s.side === "enemy"
      ? `<span class="sc-side-badge enemy"><i class="fa-solid fa-skull" aria-hidden="true"></i> Ennemi</span>`
      : `<span class="sc-side-badge ally"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i> Allié</span>`;
    const crewLine = s.crew.length
      ? `<div class="sc-crewline"><span class="sc-group-label">Équipage</span> ${s.crew.map((e) => `<span class="sc-crew-chip ${e.owned ? "mine" : ""}">${esc(e.name)} <small>${esc(e.roles.join(", "))}${e.unknown.length ? ` <span class="sc-warn" title="Poste non reconnu : il compte comme membre d'équipage (contrôle des dégâts, actions d'équipage), sans pilotage ni tir. Cochez « utilise les armes » ou choisissez la compétence Pilotage dans la configuration des postes.">(poste non reconnu)</span>` : ""}</small></span>`).join(" ")}</div>`
      : (ctx.isGM ? `<p class="sc-hint">Aucun équipage enregistré : glissez les personnages sur la fiche du vaisseau pour leur donner un poste.</p>` : "");
    const rangeLine = s.ranges.length || ctx.isGM ? `<div class="sc-ranges"><span class="sc-group-label">Portées</span> ${ctx.state.ships.filter((o) => o.key !== s.key && shipActor(o)).map((o) => {
      const r = getRange(ctx.state, s.key, o.key);
      const name = esc(shipActor(o).name);
      if (ctx.isGM) return `<label class="sc-range">${name} <select class="sc-range-edit" data-a="${s.key}" data-b="${o.key}" aria-label="Portée entre ${esc(s.name)} et ${name}"><option value="" ${r === undefined ? "selected" : ""}>?</option>${R.RANGE_ORDER.map((k, i) => `<option value="${i}" ${r === i ? "selected" : ""}>${R.RANGES[k]}</option>`).join("")}</select></label>`;
      return r === undefined ? "" : `<span class="sc-range">${name} : ${RANGE_FR(r)}</span>`;
    }).join(" ")}</div>` : "";
    const group = (s.group ?? 1) > 1 || ctx.isGM ? `<div class="sc-squad"><span class="sc-group-label">Escadrille</span> ${(s.group ?? 1) > 1 ? `<strong>${s.left}/${s.group}</strong> appareils` : "appareil seul"}
      ${ctx.isGM ? mini("group", "fa-minus", "Retirer un appareil de l'escadrille", `data-delta="-1"`) + mini("group", "fa-plus", "Ajouter un appareil à l'escadrille (2 à 4 appareils identiques, règle des sbires)", `data-delta="1"`) : ""}</div>` : "";
    return `<article class="sc-ship ${s.side}" aria-label="${esc(s.name)} (${s.side === "enemy" ? "ennemi" : "allié"})">
      <header>
        <img src="${esc(s.img)}" alt="">
        <div class="sc-title">
          <h3><button type="button" class="sc-link" data-action="ship" data-op="sheet" data-key="${s.key}">${esc(s.name)}</button> ${sideBadge}</h3>
          <span class="sc-tags">Gabarit ${st.sil} · Maniabilité ${signed(st.handling)} · Blindage ${s.canSee ? st.armour : "?"}</span>
        </div>
        <div class="sc-head-btns">
          ${ctx.isGM ? mini("side", "fa-right-left", "Changer de camp") + mini("remove", "fa-xmark", "Retirer du combat") : ""}
        </div>
      </header>
      <div class="sc-stats">
        <div class="sc-speed">
          <span class="sc-bar-label">Vitesse</span>
          ${ctx.isGM ? mini("adjust", "fa-minus", "Vitesse −1", `data-field="speed" data-delta="-1"`) : ""}
          <strong>${st.speed}</strong>/${st.maxSpeed}
          ${ctx.isGM ? mini("adjust", "fa-plus", "Vitesse +1", `data-field="speed" data-delta="1"`) : ""}
          <span class="sc-pips" title="Manœuvres de pilote ce round : ${s.pm}/${s.limit}${s.limit === 2 ? " (la 2ᵉ coûte 2 stress ou l'action du pilote)" : ""}" aria-label="Manœuvres de pilote ce round : ${s.pm} sur ${s.limit}">${s.pips.map((p) => `<i class="fa-${p ? "solid" : "regular"} fa-circle" aria-hidden="true"></i>`).join("")}</span>
        </div>
        ${bar("Coque", st.hull, st.hullMax, "hull")}
        ${bar("Stress", st.strain, st.strainMax, "strain")}
        <div class="sc-zones">
          <span class="sc-bar-label">Défense</span>
          ${s.zones.map((z) => `<span class="sc-zone"><small>${z.label}</small><strong>${z.value}</strong></span>`).join("")}
          ${s.access.crew ? btn("shift", "Réorienter", "fa-solid fa-shield-halved", { title: "Transférer 1 point de défense d'une zone à une autre" }) : ""}
        </div>
      </div>
      ${group}
      ${s.chips.length ? `<ul class="sc-effects">${s.chips.map((e) => `<li class="sc-chip ${e.warn ? "warn" : ""}"><strong>${esc(e.label)}</strong>${e.key && ctx.isGM ? ` <button type="button" class="sc-mini" data-action="ship" data-op="clear" data-effect="${e.key}" data-key="${s.key}" aria-label="Retirer l'effet ${esc(e.label)}" title="Retirer l'effet"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>` : ""} <span class="sc-chip-hint">${dice(esc(e.hint))}</span></li>`).join("")}</ul>` : ""}
      ${s.access.notMyTurn ? `<p class="sc-hint sc-turn"><i class="fa-solid fa-hourglass-half" aria-hidden="true"></i> Ce n'est pas le tour d'un de vos personnages à bord.</p>` : ""}
      ${s.access.pilot ? `<div class="sc-group"><span class="sc-group-label">Manœuvres de pilote</span><div class="sc-btns">${maneuvers}</div>${why ? `<p class="sc-why">Indisponible — ${esc(why)}.</p>` : ""}${undo}</div>` : ""}
      ${actions.length ? `<div class="sc-group"><span class="sc-group-label">Actions</span><div class="sc-btns">${actions.join("")}</div></div>` : ""}
      ${!ctx.isGM && !s.access.pilot && !actions.length && s.canAct && !s.access.notMyTurn ? `<p class="sc-hint">Aucun de vos personnages n'occupe de poste à bord : le MJ ou le propriétaire du vaisseau doit glisser votre personnage sur la fiche du vaisseau et lui choisir un poste (pilote, artilleur…).</p>` : ""}
      ${crewLine}
      ${rangeLine}
      ${s.canSee && s.weapons.length ? `<ul class="sc-weapons">${s.weapons.map((w) => `<li class="${w.block ? "fired" : ""}"><strong>${esc(w.name)}</strong> <span>Dég ${w.damage} · Crit ${w.crit} · ${esc(w.range)} · ${esc(w.arcs.join("/"))}</span>${w.q.limitedAmmo ? ` <span class="sc-ammo">munitions ${Math.max(0, w.q.limitedAmmo - w.ammoUsed)}/${w.q.limitedAmmo}</span>${ctx.isGM && w.ammoUsed ? ` <button type="button" class="sc-link" data-action="ship" data-op="reload" data-weapon="${w.id}" data-key="${s.key}">réapprovisionner</button>` : ""}` : ""}${w.special ? `<small>${esc(w.special)}</small>` : ""}${w.block ? `<em>${esc(w.block)}</em>` : ""}</li>`).join("")}</ul>` : ""}
      ${ctx.isGM && juryRig(s.actor) ? `<div class="sc-btns">${btn("drydock", "Réparé en cale sèche", "fa-solid fa-warehouse", { title: "Annule les effets de la réparation d'urgence" })}</div>` : ""}
      ${s.canSee && s.crits.length ? `<ul class="sc-crits">${s.crits.map((c) => `<li><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ${esc(c.name)} <small>${c.sev >= 5 || c.sev === 0 ? "irréparable" : dice(diffDice(c.sev))}${c.locked ? " · pas avant la fin de la rencontre" : ""}</small>${ctx.isGM && !c.locked ? ` <button type="button" class="sc-mini" data-action="ship" data-op="repairCrit" data-item="${c.id}" data-key="${s.key}" aria-label="Marquer ${esc(c.name)} comme réparé" title="Marquer comme réparé"><i class="fa-solid fa-check" aria-hidden="true"></i></button>` : ""}</li>`).join("")}</ul>` : ""}
    </article>`;
  }

  #renderHelp() {
    const intro = `<p class="sc-hint">Résumé des chiffres à avoir sous la main. Le détail est dans les onglets Pilote, Artilleur, Autres postes et Avantages / Menaces.</p>`;
    const damage = `<h3>Dégâts</h3><table class="sc-table"><tbody>
      <tr><th>Échelle</th><td>1 point de dégâts, de blindage ou de coque d'un vaisseau = 10 à l'échelle d'un personnage.</td></tr>
      <tr><th>Coque</th><td>Dégâts + [SU] − blindage. Au-delà du seuil : gabarit 3 ou moins détruit ; plus gros (ou vaisseau des PJ) : dégât critique et dérive. Réparation d'urgence (Mécanique Difficile) : coque = seuil − 1, vitesse 1, maniabilité −3, armes hors service, +30 aux critiques suivants.</td></tr>
      <tr><th>Stress mécanique</th><td>Au-delà du seuil, systèmes hors service. Ne se retire pas avec des [AD] ; −1 par jour sans incident.</td></tr>
      <tr><th>Critique</th><td>1d100 sur la table 7-9, +10 par critique non réparé et par critique supplémentaire acheté. Gravité : 1-54 Facile, 55-81 Moyenne, 82-126 Difficile, 127-153 Intimidante, 154+ désintégré.</td></tr>
      <tr><th>Collision</th><td>Critique − 10 × défense de la zone (mineure) ou − 5 × défense (majeure) ; annulé si le total est 0 ou moins.</td></tr>
      <tr><th>Escadrille</th><td>2 à 4 appareils identiques agissent comme un groupe de sbires : une seule attaque, rangs de compétence = taille − 1 ; un appareil abattu par seuil de coque atteint ou par dégât critique.</td></tr>
      </tbody></table>`;
    const limits = `<h3>Limites par round</h3><table class="sc-table"><tbody>
      <tr><th>Manœuvres de pilote</th><td>Gabarit 1-4 : 1 par vaisseau, 2 en subissant 2 stress mécanique (ou en sacrifiant l'action du pilote). Gabarit 5+ : 1 seule.</td></tr>
      <tr><th>Armes</th><td>Chaque arme ne tire qu'une fois par round ; Cadence lente N : N rounds d'attente ; Munitions limitées N : N tirs.</td></tr>
      <tr><th>Personnage</th><td>1 action et 1 manœuvre ; jamais plus de 2 manœuvres.</td></tr>
      </tbody></table>`;
    const diffs = `<h3>Difficultés</h3><table class="sc-table"><tbody>
      <tr><th>Attaque (table 7-4)</th><td>Écart de gabarit ≤ 1 : Moyenne · tireur plus petit de 2+ : Facile · plus grand de 2 : Difficile · de 3 : Intimidante · de 4+ : Exceptionnelle. Défense de la zone = [SE].</td></tr>
      <tr><th>Prendre l'avantage (7-3)</th><td>Même vitesse : Moyenne · plus rapide : Facile · plus lent de 1 : Difficile · de 2+ : Intimidante. +1 [DI] à chaque reprise dans le même duel.</td></tr>
      <tr><th>Contrôle des dégâts (7-2)</th><td>Moins de la moitié du seuil : Facile · moitié ou plus : Moyenne · au-delà du seuil : Difficile.</td></tr>
      <tr><th>Terrain (p. 241)</th><td>Max(vitesse, gabarit/2) [DI], dont min(…) améliorés ; danger 0 à 3 [SE] (table 7-8).</td></tr>
      </tbody></table>`;
    const comps = `<h3>Composants (tables 7-10 / 7-11)</h3><div class="sc-cols"><table class="sc-table"><caption>Gabarit 1-4</caption><tbody>${R.COMPONENTS_SMALL.map(([n, d]) => `<tr><th>${n}</th><td>${d}</td></tr>`).join("")}</tbody></table>
      <table class="sc-table"><caption>Gabarit 5+</caption><tbody>${R.COMPONENTS_LARGE.map(([n, d]) => `<tr><th>${n}</th><td>${d}</td></tr>`).join("")}</tbody></table></div>`;
    return `<div class="sc-body sc-help" role="tabpanel">${intro}${dice(diffs)}${dice(limits)}${dice(damage)}${comps}</div>`;
  }

  static #onTab(event, target) {
    const before = `${this.tab}/${this.ruleTab}`;
    if (target.dataset.tab) this.tab = target.dataset.tab;
    if (target.dataset.rule) {
      this.tab = "rules";
      this.ruleTab = target.dataset.rule;
    }
    this._tabChanged = before !== `${this.tab}/${this.ruleTab}`;
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

  static async #onSettings() {
    await settingsDialog(getState());
  }

  static #onJump(event, target) {
    this.element.querySelector(`#${target.dataset.target}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  static async #onEndEncounter() {
    const choice = await DialogV2.wait({
      window: { title: "Fin de la rencontre" },
      content: "<p>Les défenses réorientées sont restaurées, les portées et les effets temporaires effacés. Le stress, les dégâts et les critiques restent (le stress mécanique baisse de 1 par jour sans incident).</p>",
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
        case "group": return await exec("setGroup", { key, delta: Number(target.dataset.delta) });
        case "adjust": return await exec("adjust", { key, field: target.dataset.field, delta: Number(target.dataset.delta) });
        case "clear": return await exec("clearEffect", { key, effect: target.dataset.effect });
        case "repairCrit": return await exec("repairCrit", { key, itemId: target.dataset.item });
        case "reload": return await exec("reload", { key, weaponId: target.dataset.weapon });
        case "drydock": return await exec("drydock", { key });
        case "undo": return await exec("undoManeuver", { key });
        case "shift": return await shiftDialog(state, key);
        case "attack": return await attackDialog(state, key);
        case "aim": return await aimDialog(state, key);
        case "advantage": return await advantageDialog(state, key);
        case "control": {
          const st = stats(findShip(state, key).actor);
          return await pilotCheckDialog(state, key, { title: "Reprendre le contrôle", difficulty: Math.min(5, Math.max(1, st.speed)), type: "control", hint: `Vaisseau dévié : test de Pilotage dont la difficulté dépend de la vitesse actuelle (${st.speed}).` });
        }
        case "escape": {
          const rating = findShip(state, key).ship.effects.tractor?.rating ?? 2;
          return await pilotCheckDialog(state, key, { title: "Se libérer du rayon tracteur", difficulty: rating, type: "tractorEscape", hint: `Rayon tracteur ${rating} : test de Pilotage ${diffLabel(rating)}.` });
        }
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
const isActiveGM = () => game.user.id === game.users.activeGM?.id;

function involves(actor) {
  if (!actor) return false;
  if (actor.type !== "vehicle") return CREW_TYPES.includes(actor.type);
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
  if (game.ffg) {
    game.ffg.SpaceCombat = SpaceCombatApp;
    // Interface pour les macros du MJ (et les tests) : opérations, état, application d'un critique choisi.
    game.ffg.SpaceCombatAPI = { ops: OPS, getState, applyCrit, exec };
  }
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

/** Un critique réparé ou supprimé de la fiche : ses effets sont annulés (une seule fois, par le MJ actif). */
Hooks.on("deleteItem", (item) => {
  if (item.type !== "criticaldamage" || !isActiveGM()) return;
  revertCrit(item).catch((err) => console.error("Combat spatial :", err));
});

/** Suivi de combat : rounds synchronisés et effets qui expirent à la fin du tour du pilote. */
Hooks.on("updateCombat", (combat, changes) => {
  refreshSoon();
  if (!isActiveGM() || !combat.started) return;
  const state = getState();
  if (!state.ships.length || !state.rules.syncCombat) return;
  const prev = combat.previous;
  if (("turn" in changes || "round" in changes) && prev?.combatantId) {
    const slot = combat.combatants.get(prev.combatantId);
    const claimId = combat.getSlotClaims?.(prev.round, prev.combatantId);
    const who = (claimId ? combat.combatants.get(claimId) : slot)?.actorId;
    if (who) OPS.pilotTurnEnded({ actorId: who, round: prev.round }).catch((err) => console.error(err));
  }
  if ("round" in changes && combat.round > state.round) OPS.nextRound({ to: combat.round }).catch((err) => console.error(err));
});
Hooks.on("deleteCombat", () => refreshSoon());

/** Résultat d'un jet lancé depuis le tableau : reconnu par son jeton, sur le poste de celui qui a lancé. */
Hooks.on("createChatMessage", (message) => {
  if (message.author?.id !== game.user.id) return;
  for (const roll of message.rolls ?? []) {
    const token = roll?.data?.scToken ?? roll?.data?.crew?.scToken;
    if (!token || !pendings.has(token) || !roll.ffg) continue;
    const p = pendings.get(token);
    pendings.delete(token);
    onRollResult(p, roll.ffg).catch((err) => console.error("Combat spatial :", err));
  }
});

/**
 * Boutons des cartes de chat du tableau. Écoute déléguée au niveau du document : le système réécrit le HTML
 * des messages dans un autre hook de rendu, ce qui ferait perdre des écouteurs posés sur les boutons.
 */
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest?.(".sc-card button.sc-op, .sc-card button.sc-crit, .sc-card button.sc-guided");
  if (!b || b.disabled) return;
  ev.preventDefault();
  ev.stopPropagation();
  if (!game.user.isGM) {
    ui.notifications.info("C'est le MJ qui applique les résultats du combat spatial.");
    return;
  }
  try {
    if (b.classList.contains("sc-crit")) return await critDialog(getState(), b.dataset.key, b.dataset.zone || null);
    if (b.classList.contains("sc-guided")) {
      b.disabled = true;
      return await guidedRoll(b.dataset.key, b.dataset.target, b.dataset.weapon, b.dataset.zone || null);
    }
    b.disabled = true;
    await exec(b.dataset.op, JSON.parse(b.dataset.args));
  } catch (err) {
    ui.notifications.warn(err.message);
  }
}, true);

/** Les boutons des cartes de chat (appliquer, critique…) ne s'affichent que pour le MJ. */
Hooks.on("renderChatMessageHTML", (message, html) => {
  if (game.user.isGM) return;
  for (const el of html.querySelectorAll(".sc-card .sc-buttons")) el.remove();
});
