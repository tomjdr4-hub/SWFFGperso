/**
 * Effets mécaniques des dégâts critiques de vaisseau (table 7-9, p. 245). Fonctions pures.
 *
 * critPlan() décrit ce qu'un critique change :
 *  - strain       : stress mécanique subi immédiatement (définitif) ;
 *  - mods         : modifications de caractéristiques annulées à la réparation du critique [{ path, delta }] ;
 *  - effects      : effets temporaires du tableau { clé: valeur } ;
 *  - crewStrain   : stress subi par chaque membre d'équipage ;
 *  - lock         : réparation impossible avant la fin de la rencontre ;
 *  - destroyed    : le vaisseau est détruit ;
 *  - notes        : ce qui reste à gérer à la main.
 */

export const norm = (s) => String(s ?? "").toLowerCase().replace(/[’`]/g, "'").normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

const ZONES = ["fore", "aft", "port", "starboard"];
const ZONE_FR = { fore: "avant", aft: "arrière", port: "bâbord", starboard: "tribord" };

/**
 * @param {string} name nom du critique (tel que dans le compendium)
 * @param {object} st caractéristiques actuelles : { sil, speed, maxSpeed, armour, hullMax, shields: {fore,…}, spaceShip }
 * @param {object} ctx { zone: zone touchée, round: round courant }
 */
export function critPlan(name, st, ctx = {}) {
  const plan = { strain: 0, mods: [], effects: {}, crewStrain: 0, lock: false, destroyed: false, notes: [] };
  const zones = st.sil >= 5 ? ZONES : ["fore", "aft"];
  const hasDefense = zones.some((z) => (st.shields?.[z] ?? 0) > 0);
  const zone = zones.includes(ctx.zone) ? ctx.zone : "fore";
  const round = ctx.round ?? 1;
  const shield = (z, delta) => {
    const cur = st.shields?.[z] ?? 0;
    const d = Math.max(-cur, delta);
    if (d) plan.mods.push({ path: `system.stats.shields.${z}`, delta: d });
  };

  switch (norm(name)) {
    case norm("Stress mécanique"):
      plan.strain = 1;
      break;
    case norm("Bousculé"):
      plan.crewStrain = 1;
      plan.effects.jostled = round;
      plan.notes.push("Tout l'équipage est désorienté pendant un round ([SE] à ses tests) et subit 1 point de stress.");
      break;
    case norm("Perte d'alimentation dans les boucliers"):
      if (hasDefense) shield(zone, -1);
      else plan.strain = 1;
      if (hasDefense) plan.notes.push(`Défense ${ZONE_FR[zone]} −1 jusqu'à la réparation.`);
      break;
    case norm("Dévié"):
      plan.effects.deviated = round;
      plan.effects.needsControl = true;
      plan.notes.push("Le pilote ne peut pas manœuvrer à son prochain tour et doit réussir un test de Pilotage (difficulté selon la vitesse) pour reprendre le contrôle.");
      break;
    case norm("Culbuté"):
      plan.effects.tumbled = round;
      plan.notes.push("Les attaques du vaisseau subissent [SE][SE] et l'équipage est immobilisé jusqu'à la fin du prochain tour du pilote.");
      break;
    case norm("Composant touché"):
      plan.effects.component = round;
      plan.notes.push("Un composant choisi par l'attaquant est hors service jusqu'à la fin du prochain round (tables 7-10 / 7-11).");
      break;
    case norm("Défaillance des boucliers"):
      if (hasDefense) {
        for (const z of zones) shield(z, -1);
        plan.notes.push("Défense de toutes les zones −1 jusqu'à la réparation.");
      } else plan.strain = 2;
      break;
    case norm("Défaillance du naviordinateur"):
      plan.notes.push("Saut dans l'hyperespace impossible (ou navigation à l'aveugle) jusqu'à la réparation.");
      break;
    case norm("Fluctuations énergétiques"):
      plan.notes.push("Le pilote ne peut plus subir 2 stress mécanique pour une manœuvre supplémentaire tant que ce critique n'est pas réparé.");
      break;
    case norm("Boucliers désactivés"):
      if (hasDefense) {
        for (const z of zones) shield(z, z === zone ? -(st.shields?.[z] ?? 0) : -1);
        plan.notes.push(`Défense ${ZONE_FR[zone]} à 0 et −1 ailleurs jusqu'à la réparation.`);
      } else plan.strain = 4;
      break;
    case norm("Moteur endommagé"):
      if (st.maxSpeed > 0) plan.mods.push({ path: "system.stats.speed.max", delta: -1 });
      plan.notes.push("Vitesse maximale −1 jusqu'à la réparation.");
      break;
    case norm("Surcharge des boucliers"):
      plan.lock = true;
      if (hasDefense) {
        for (const z of zones) shield(z, -(st.shields?.[z] ?? 0));
        plan.strain = 2;
        plan.notes.push("Défense de toutes les zones à 0 ; réparation impossible avant la fin de la rencontre.");
      } else {
        if (st.armour > 0) plan.mods.push({ path: "system.stats.armour.value", delta: -1 });
        plan.notes.push("Pas de boucliers : blindage −1 à la place ; réparation impossible avant la fin de la rencontre.");
      }
      break;
    case norm("Arrêt du moteur"):
      if (st.maxSpeed > 0) plan.mods.push({ path: "system.stats.speed.max", delta: -st.maxSpeed });
      plan.notes.push("Vitesse maximale 0 et plus aucune manœuvre jusqu'à la réparation ; le vaisseau poursuit sa trajectoire par inertie.");
      break;
    case norm("Défaillance d'un système majeur"):
      plan.notes.push("Un composant choisi par l'attaquant ne fonctionne plus jusqu'à la réparation (tables 7-10 / 7-11).");
      break;
    case norm("Brèche majeure dans la coque"):
      if (st.spaceShip === false) {
        plan.mods.push({ path: "system.stats.hullTrauma.max", delta: -2 });
        plan.notes.push("Dans l'atmosphère : effets de « Déstabilisé » (seuil de coque −2).");
      } else {
        plan.notes.push(`Dépressurisation : le MJ choisit les zones touchées, qui se vident de leur air en ${st.sil} round(s).`);
      }
      break;
    case norm("Déstabilisé"):
      plan.mods.push({ path: "system.stats.hullTrauma.max", delta: -2 });
      plan.notes.push("Seuil de dégâts de coque −2 jusqu'à la réparation.");
      break;
    case norm("Au feu !"):
      plan.strain = 2;
      plan.effects.fire = Math.max(1, Math.ceil(st.sil / 2));
      plan.notes.push(`Incendie : dégâts de feu pour qui se fait brûler ; l'éteindre demande des tests (Vigilance et/ou Calme) puis ${Math.max(1, Math.ceil(st.sil / 2))} round(s).`);
      break;
    case norm("Dislocation"):
      plan.effects.dislocating = round;
      plan.notes.push("Le vaisseau sera détruit à la fin du prochain round : l'équipage a un round pour fuir.");
      break;
    case norm("Désintégré"):
      plan.destroyed = true;
      break;
    default:
      plan.notes.push("Effet à appliquer à la main.");
  }
  return plan;
}

/** Critiques qui interdisent toute manœuvre ou la manœuvre payée en stress, d'après les critiques en cours. */
export function critRestrictions(critNames) {
  const names = critNames.map(norm);
  return {
    noManeuver: names.includes(norm("Arrêt du moteur")),
    noStrainManeuver: names.includes(norm("Fluctuations énergétiques")),
  };
}
