/**
 * Règles du combat spatial (Aux Confins de l'Empire, chapitre VII « Vaisseaux et véhicules », p. 223-246).
 * Ce fichier ne contient que des données et des fonctions pures : aucune dépendance à Foundry.
 */

export const ZONES = {
  fore: "Avant",
  aft: "Arrière",
  port: "Bâbord",
  starboard: "Tribord",
};

export const ARCS = {
  fore: "avant",
  aft: "arrière",
  port: "bâbord",
  starboard: "tribord",
  dorsal: "dorsal",
  ventral: "ventral",
};

export const RANGES = {
  Close: "Proche",
  Short: "Courte",
  Medium: "Moyenne",
  Long: "Longue",
  Extreme: "Extrême",
};

export const DIFFICULTY_NAMES = ["Simple", "Facile", "Moyenne", "Difficile", "Intimidante", "Exceptionnelle"];

/** Zones de défense d'un appareil selon son gabarit (p. 226). */
export function zonesFor(silhouette) {
  return silhouette >= 5 ? ["fore", "aft", "port", "starboard"] : ["fore", "aft"];
}

/** Table 7-4 : difficulté d'une attaque selon la comparaison des gabarits. */
export function silhouetteDifficulty(attackerSil, targetSil) {
  const diff = attackerSil - targetSil;
  if (Math.abs(diff) <= 1) return 2;
  if (diff <= -2) return 1;
  if (diff === 2) return 3;
  if (diff === 3) return 4;
  return 5;
}

/** Table 7-3 : difficulté de « Prendre l'avantage » selon le différentiel de vitesse. */
export function speedDifficulty(ownSpeed, targetSpeed) {
  if (ownSpeed === targetSpeed) return 2;
  if (ownSpeed > targetSpeed) return 1;
  if (targetSpeed - ownSpeed === 1) return 3;
  return 4;
}

/** Table 7-2 : difficulté du contrôle des dégâts (même règle pour le stress et la coque). */
export function damageControlDifficulty(value, max) {
  if (value > max) return 3;
  if (value * 2 >= max) return 2;
  return 1;
}

/**
 * Terrain et phénomènes célestes (p. 241) : la vitesse et la moitié du gabarit (arrondie au supérieur)
 * donnent respectivement les dés de difficulté (la plus grande) et les améliorations (la plus petite).
 */
export function terrainCheck(speed, silhouette) {
  const half = Math.ceil(silhouette / 2);
  return { difficulty: Math.max(speed, half), upgrades: Math.min(speed, half) };
}

/** Manœuvre Voler/conduire : ce que permet une manœuvre selon la vitesse actuelle (p. 233). */
export function flyText(speed) {
  if (speed <= 0) return "À l'arrêt : il faut d'abord accélérer.";
  if (speed === 1) return "1 manœuvre : se déplacer à portée proche · 2 manœuvres : proche ↔ courte.";
  if (speed <= 4) return "1 manœuvre : proche ↔ courte · 2 manœuvres : proche ↔ moyenne.";
  return "1 manœuvre : proche ↔ moyenne · 2 manœuvres : proche ↔ longue.";
}

/** Manœuvres de pilote (p. 233-234). `pilot: false` = ne compte pas dans la limite de manœuvres de pilote. */
export const MANEUVERS = {
  accelerate: { label: "Accélérer", icon: "fa-solid fa-angles-up", pilot: true, maxSil: 10, minSpeed: 0,
    hint: "Vitesse actuelle +1 (jusqu'au maximum)." },
  decelerate: { label: "Décélérer", icon: "fa-solid fa-angles-down", pilot: true, maxSil: 10, minSpeed: 0,
    hint: "Vitesse actuelle −1." },
  fly: { label: "Voler", icon: "fa-solid fa-route", pilot: true, maxSil: 10, minSpeed: 1,
    hint: "Se rapprocher ou s'éloigner d'une cible à la vitesse actuelle." },
  evasive: { label: "Évasion", icon: "fa-solid fa-shuffle", pilot: true, maxSil: 4, minSpeed: 3,
    hint: "Jusqu'à la fin du prochain tour du pilote : améliore 1 [DI] des attaques contre le vaisseau ET de ses propres attaques." },
  stick: { label: "Coller à la cible", icon: "fa-solid fa-crosshairs", pilot: true, maxSil: 4, minSpeed: 3,
    hint: "Jusqu'à la fin du prochain tour du pilote : améliore 1 [AB] de ses attaques ET des attaques contre lui." },
  punch: { label: "Mettre la gomme", icon: "fa-solid fa-gauge-high", pilot: true, maxSil: 4, minSpeed: 0,
    hint: "Passe immédiatement à la vitesse maximale : 1 point de stress mécanique par niveau de vitesse gagné." },
};

/** Table 7-5 : dépenser les avantages et les triomphes dans les combats spatiaux. */
export const SPEND_ADVANTAGE = [
  { cost: "[AD] ou [TR]", options: [
    "Ajouter [BO] au prochain test de Pilotage, d'Artillerie, d'Informatique ou de Mécanique du prochain personnage allié actif.",
    "Découvrir un détail important de la bataille (vulnérabilité dans une trajectoire, point faible dans une tactique…).",
    "Infliger un dégât critique avec une attaque réussie ayant percé le blindage (coût en [AD] variable selon l'arme).",
  ] },
  { cost: "[AD][AD] ou [TR]", options: [
    "Exécuter une manœuvre gratuite immédiate (sauf si le personnage en a déjà accompli deux ce tour).",
    "Ajouter [SE] au prochain test d'un personnage visé.",
    "Ajouter [BO] au prochain test de Pilotage, d'Artillerie, d'Informatique ou de Mécanique de n'importe quel allié, y compris soi-même.",
  ] },
  { cost: "[AD][AD][AD] ou [TR]", options: [
    "Endommager temporairement un composant choisi par l'attaquant au lieu d'infliger des dégâts ou du stress (tables 7-10 et 7-11).",
    "Ignorer les pénalités du terrain ou des phénomènes célestes jusqu'à la fin du prochain tour.",
    "Exécuter une manœuvre gratuite de pilote (il faut être aux commandes, maximum 2 manœuvres par tour).",
    "Forcer un vaisseau à changer de cap, ce qui annule ses manœuvres Viser et Coller à la cible.",
  ] },
  { cost: "[TR]", options: [
    "Améliorer 1 [DI] du prochain test de Pilotage ou d'Artillerie du personnage visé.",
    "Améliorer 1 [AB] du prochain test de Pilotage, d'Artillerie, de Mécanique ou d'Informatique d'un allié.",
    "Réussir un coup d'éclat qui renverse le cours de la bataille (détruire les générateurs de boucliers d'un vaisseau amiral, semer un poursuivant dans un champ d'astéroïdes…).",
  ] },
  { cost: "[TR][TR]", options: [
    "Au lieu d'infliger des dégâts ou du stress, détruire pour de bon un composant choisi par l'attaquant (désactivé jusqu'à réparation).",
  ] },
];

/** Table 7-6 : dépenser les menaces et les désastres dans les combats spatiaux. */
export const SPEND_THREAT = [
  { cost: "[TH] ou [DE]", options: [
    "Le pilote doit réduire sa vitesse de 1.",
    "Le personnage actif perd le bénéfice d'une manœuvre (évasion, viser…) jusqu'à ce qu'il l'effectue à nouveau.",
    "Le vaisseau du personnage actif subit 1 point de stress mécanique (cumulable).",
  ] },
  { cost: "[TH][TH] ou [DE]", options: [
    "Un adversaire peut immédiatement effectuer une manœuvre gratuite.",
    "Ajouter [BO] au prochain test de Pilotage ou d'Artillerie de la cible.",
    "Le personnage actif ou un allié ajoute [SE] à sa prochaine action.",
  ] },
  { cost: "[TH][TH][TH] ou [DE]", options: [
    "Le créneau du personnage actif devient le dernier de l'ordre d'initiative.",
    "Le personnage actif confère un avantage majeur à l'ennemi (il se place dans son champ de tir : tous les tests contre lui sont facilités jusqu'à son prochain tour).",
  ] },
  { cost: "[DE]", options: [
    "L'arme principale du personnage actif subit un dégât critique de composant (non compté dans le total des critiques).",
    "Améliorer 1 [DI] du prochain test d'Artillerie, de Pilotage, d'Informatique ou de Mécanique d'un allié.",
    "Le personnage actif subit une collision mineure (adversaire à portée proche, terrain ou objet flottant).",
  ] },
  { cost: "Test raté + [DE]", options: [
    "Le personnage actif subit une collision majeure (adversaire à portée proche, terrain ou objet flottant).",
  ] },
];

/** Table 7-7 : actions supplémentaires des vaisseaux et véhicules (skill = clé de compétence du système). */
export const CREW_ACTIONS = [
  { key: "plot", label: "Tracer l'itinéraire", skill: "Astrogation", difficulty: 2,
    alt: { skill: "Perception", difficulty: 3 },
    result: "Chaque succès retire 1 [SE] imposé par les terrains difficiles." },
  { key: "copilot", label: "Assister le pilotage", skill: "Piloting", difficulty: 2,
    result: "Chaque succès dégrade 1 [DI] du prochain test de Pilotage du pilote principal." },
  { key: "jam", label: "Brouillage", skill: "Computers", difficulty: 2,
    result: "L'adversaire doit réussir un test d'Informatique Moyen ([DI][DI]) pour communiquer, +1 [DI] par tranche de deux succès. [AD] : brouille une cible supplémentaire." },
  { key: "boost", label: "Intensifier le bouclier", skill: "Mechanics", difficulty: 3,
    result: "Le vaisseau subit 1 stress mécanique et gagne +1 défense sur une zone jusqu'au début du prochain tour. Chaque succès supplémentaire prolonge d'un round." },
  { key: "manual", label: "Réparations manuelles", skill: "Athletics", difficulty: 3,
    result: "Comme le contrôle des dégâts : retire 1 point de coque, +1 par tranche de deux succès supplémentaires. Une fois par rencontre." },
  { key: "fire", label: "Discipline de tir", skill: "Discipline", difficulty: 3,
    alt: { skill: "Leadership", difficulty: 3 },
    result: "Le prochain artilleur gagne [BO] ; chaque tranche de deux succès supplémentaires en fait profiter un autre. [AD][AD][AD] : toutes les armes du vaisseau infligent +1 stress mécanique jusqu'au prochain tour." },
  { key: "scan", label: "Scanner l'ennemi", skill: "Perception", difficulty: 3,
    result: "Révèle les armes et modifications de la cible, ses seuils de coque et de stress. [AD][AD] : révèle aussi ses dégâts et son stress actuels." },
  { key: "slice", label: "Pirater les systèmes ennemis", skill: "Computers", difficulty: 3,
    result: "Réduit de 1 par succès la défense d'une zone de la cible pendant un round. [TR] : désactive une arme pendant un round. [AD][AD] : 1 stress mécanique à la cible." },
  { key: "counter", label: "Contre-mesures", skill: "Computers", difficulty: 2,
    alt: { skill: "Vigilance", difficulty: 3 },
    result: "Améliore 1 [DI] des attaques d'armes à Projectile guidé contre le vaisseau jusqu'au début du prochain tour (+1 par tranche de deux [AD])." },
];

/** Tables 7-10 et 7-11 : composants touchés. */
export const COMPONENTS_SMALL = [
  ["Droïde de soutien", "Le droïde (astromech le plus souvent) est hors service jusqu'à réparation. S'il s'agit d'un PJ, il subit 10 points de stress."],
  ["Système d'éjection", "Le pilote et l'équipage ne peuvent plus évacuer l'appareil en urgence tant qu'il n'est pas réparé."],
  ["Armement", "L'attaquant choisit une arme mise hors service."],
  ["Senseurs", "La portée des senseurs baisse d'un niveau ; s'ils n'allaient qu'à portée proche, ils sont désactivés."],
  ["Comms", "Le vaisseau ne peut plus émettre ni recevoir."],
  ["Moteurs subluminiques", "Vitesse du vaisseau réduite de 1."],
  ["Hyperdrive", "L'hyperdrive ou le naviordinateur est endommagé : saut impossible."],
  ["Boucliers", "Toutes les zones perdent 1 point de défense."],
];

export const COMPONENTS_LARGE = [
  ["Train d'atterrissage", "Atterrissage dangereux : 2 points de coque et 2 de stress (gabarit 5) ; au-delà, impossible d'entrer dans l'atmosphère."],
  ["Armement", "L'attaquant choisit une arme mise hors service."],
  ["Senseurs", "Portée des senseurs réduite d'un niveau."],
  ["Comms", "Le vaisseau ne peut plus émettre ni recevoir."],
  ["Moteurs subluminiques", "Vitesse du vaisseau réduite de 1."],
  ["Hyperdrive", "Saut dans l'hyperespace impossible."],
  ["Boucliers", "Toutes les zones perdent 1 point de défense."],
  ["Baie d'accostage", "Une aire d'atterrissage devient inutilisable (gravité au choix du MJ)."],
  ["Soute", "La soute est percée : marchandises perdues ou détruites, personnes présentes touchées."],
  ["Passerelle", "Aucune manœuvre ni action de vaisseau possible ; il garde sa vitesse et son cap jusqu'à réparation."],
];

/**
 * Lit les attributs utiles au combat dans le champ « special » d'une arme de vaisseau (FR ou EN).
 * @returns {{accurate:number, breach:number, ion:boolean, linked:number, guided:number, slowFiring:number, limitedAmmo:number, blast:number, tractor:number}}
 */
export function parseQualities(text) {
  const t = String(text ?? "");
  const num = (re) => {
    const m = t.match(re);
    return m ? parseInt(m[1] ?? "1", 10) || 1 : 0;
  };
  return {
    accurate: num(/(?:pr[ée]cis|accurate)\s*(\d+)?/i),
    breach: num(/(?:br[èe]che|breach)\s*(\d+)?/i),
    ion: /ioni(?:que|c)/i.test(t),
    linked: num(/(?:jumel[ée]|linked)\s*(\d+)?/i),
    guided: num(/(?:projectile\s+guid[ée]|guided)\s*(\d+)?/i),
    slowFiring: num(/(?:cadence\s+lente|slow[- ]firing)\s*(\d+)?/i),
    limitedAmmo: num(/(?:munitions\s+limit[ée]es|limited\s+ammo)\s*(\d+)?/i),
    blast: num(/(?:souffle|blast)\s*(\d+)?/i),
    tractor: num(/(?:tracteur|tractor)\s*(\d+)?/i),
  };
}

/**
 * Résultat d'une attaque réussie : dégâts de base + 1 par succès net (comme la carte de jet du système),
 * blindage réduit par Brèche.
 * @returns {{damage:number, armour:number, hull:number, crit:boolean, critCost:number}}
 */
export function attackOutcome({ weaponDamage, successes, armour, breach, critRating, advantages, triumphs }) {
  const damage = weaponDamage + Math.max(0, successes);
  const effectiveArmour = Math.max(0, armour - breach);
  const hull = Math.max(0, damage - effectiveArmour);
  const critCost = critRating > 0 ? critRating : Infinity;
  const crit = hull > 0 && (triumphs > 0 || advantages >= critCost);
  return { damage, armour: effectiveArmour, hull, crit, critCost };
}
