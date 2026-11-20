/**
 * Géométrie et dessin du radar du combat spatial. Fonctions pures : aucune dépendance à Foundry.
 *
 * Repère : coordonnées d'écran (x vers la droite, y vers le bas), distances en cases.
 * Un vaisseau = { key, name, side, sil, x, y, heading } où heading est l'angle (radians, sens écran)
 * vers lequel pointe son nez.
 */

export const RANGE_NAMES = ["Proche", "Courte", "Moyenne", "Longue", "Extrême"];
export const RANGE_KEYS = ["Close", "Short", "Medium", "Long", "Extreme"];
export const ARC_LABELS = { fore: "avant", aft: "arrière", port: "bâbord", starboard: "tribord" };

/** Direction du nez dans l'image du jeton à rotation 0. */
export const NOSE = {
  down: [0, 1],
  up: [0, -1],
  right: [1, 0],
  left: [-1, 0],
};

const DEG = Math.PI / 180;

/** Cap (radians) d'un jeton à partir de sa rotation Foundry (degrés, sens horaire à l'écran). */
export function headingFromRotation(rotationDeg, nose = "down") {
  const [bx, by] = NOSE[nose] ?? NOSE.down;
  const r = (rotationDeg || 0) * DEG;
  const nx = bx * Math.cos(r) - by * Math.sin(r);
  const ny = bx * Math.sin(r) + by * Math.cos(r);
  return Math.atan2(ny, nx);
}

/** Angle relatif (degrés, ]-180, 180]) de la cible vu depuis le vaisseau : > 0 = sur sa droite (tribord). */
export function relativeBearing(from, to) {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  let d = (a - from.heading) / DEG;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

/** Quadrant (arc de tir / zone de défense à 4 secteurs) d'un angle relatif. */
export function quadrant(rel) {
  const a = Math.abs(rel);
  if (a <= 45) return "fore";
  if (a >= 135) return "aft";
  return rel > 0 ? "starboard" : "port";
}

/** Zone de défense exposée selon le gabarit : 4 zones à partir du gabarit 5, sinon avant/arrière. */
export function zoneFacing(rel, sil) {
  if (sil >= 5) return quadrant(rel);
  return Math.abs(rel) <= 90 ? "fore" : "aft";
}

export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Niveau de portée (0 = proche … 4 = extrême) : chaque niveau couvre `scale` cases de plus. */
export function rangeBand(dist, scale) {
  const s = Math.max(0.1, scale || 5);
  for (let i = 0; i < 4; i++) if (dist <= s * (i + 1)) return i;
  return 4;
}

/**
 * Une arme peut-elle viser cette cible ? Les arcs dorsal et ventral n'ont pas de sens sur un plan :
 * on les considère comme couvrant tout l'horizon.
 * @param {string[]} arcs clés d'arcs de l'arme (fore, aft, port, starboard, dorsal, ventral)
 */
export function weaponCovers(arcs, rel) {
  if (!arcs?.length) return { ok: true, flat: false };
  if (arcs.includes("dorsal") || arcs.includes("ventral")) return { ok: true, flat: true };
  return { ok: arcs.includes(quadrant(rel)), flat: false };
}

/** Relations entre deux vaisseaux, pour les infobulles, la liste et le dialogue d'attaque. */
export function relation(a, b, scale) {
  const dist = distance(a, b);
  const relAB = relativeBearing(a, b);
  const relBA = relativeBearing(b, a);
  return {
    dist,
    band: rangeBand(dist, scale),
    arc: quadrant(relAB), // où se trouve b par rapport au nez de a
    exposed: zoneFacing(relBA, b.sil), // zone de b tournée vers a
    relAB,
    relBA,
  };
}

/* -------------------------------------------------------------------------- */
/*  Dessin SVG                                                                */
/* -------------------------------------------------------------------------- */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
const f = (n) => Math.round(n * 100) / 100;

function wedge(cx, cy, r, from, to) {
  const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x1, y1] = p(from);
  const [x2, y2] = p(to);
  const large = to - from > Math.PI ? 1 : 0;
  return `M${f(cx)},${f(cy)} L${f(x1)},${f(y1)} A${f(r)},${f(r)} 0 ${large} 1 ${f(x2)},${f(y2)} Z`;
}

/**
 * Dessine le radar.
 * @param {object[]} ships vaisseaux placés (voir en-tête)
 * @param {object} o { focus: clé du vaisseau au centre de l'attention, scale: cases par niveau, shields: {key: {fore,…}} }
 */
export function radarSVG(ships, { focus, scale = 5, shields = {} } = {}) {
  if (!ships.length) return "";
  const center = ships.find((s) => s.key === focus) ?? ships[0];
  const far = Math.max(scale * 2, ...ships.map((s) => distance(center, s) + scale * 0.6));
  const R = Math.min(far, scale * 5.2);
  const pad = R * 0.08;
  const vb = `${f(center.x - R - pad)} ${f(center.y - R - pad)} ${f(2 * (R + pad))} ${f(2 * (R + pad))}`;
  const unit = R / 30; // taille de référence pour les symboles et le texte
  const parts = [];

  // Anneaux de portée autour du vaisseau sélectionné
  for (let i = 0; i < 4; i++) {
    const r = scale * (i + 1);
    if (r > R + scale) break;
    parts.push(`<circle class="sc-ring" cx="${f(center.x)}" cy="${f(center.y)}" r="${f(r)}" />`);
    parts.push(`<text class="sc-ring-label" x="${f(center.x + 0.4 * unit)}" y="${f(center.y - r + 1.6 * unit)}" font-size="${f(1.3 * unit)}">${RANGE_NAMES[i]}</text>`);
  }

  // Zones de défense du vaisseau sélectionné
  const zr = Math.min(scale * 0.85, R * 0.3);
  const h = center.heading;
  const sh = shields[center.key] ?? {};
  const zones = center.sil >= 5
    ? [["fore", -45, 45], ["starboard", 45, 135], ["aft", 135, 225], ["port", 225, 315]]
    : [["fore", -90, 90], ["aft", 90, 270]];
  for (const [z, a, b] of zones) {
    parts.push(`<path class="sc-zone-wedge sc-zone-${z}" d="${wedge(center.x, center.y, zr, h + a * DEG, h + b * DEG)}"><title>Zone ${ARC_LABELS[z]} : défense ${sh[z] ?? 0}</title></path>`);
    const mid = h + ((a + b) / 2) * DEG;
    parts.push(`<text class="sc-zone-label" text-anchor="middle" dominant-baseline="middle" x="${f(center.x + Math.cos(mid) * zr * 0.68)}" y="${f(center.y + Math.sin(mid) * zr * 0.68)}" font-size="${f(1.4 * unit)}">${sh[z] ?? 0}</text>`);
  }

  // Lignes de visée depuis le vaisseau sélectionné
  for (const s of ships) {
    if (s.key === center.key) continue;
    const rel = relation(center, s, scale);
    parts.push(`<line class="sc-sight ${s.side}" x1="${f(center.x)}" y1="${f(center.y)}" x2="${f(s.x)}" y2="${f(s.y)}" />`);
    const mx = (center.x + s.x) / 2;
    const my = (center.y + s.y) / 2;
    parts.push(`<text class="sc-sight-label" text-anchor="middle" x="${f(mx)}" y="${f(my - 0.5 * unit)}" font-size="${f(1.2 * unit)}">${RANGE_NAMES[rel.band]}</text>`);
  }

  // Vaisseaux
  for (const s of ships) {
    const size = unit * (1.3 + Math.min(s.sil, 10) * 0.25);
    const c = Math.cos(s.heading);
    const si = Math.sin(s.heading);
    const pt = (fx, fy) => `${f(s.x + fx * c - fy * si)},${f(s.y + fx * si + fy * c)}`;
    const shape = `${pt(size * 1.3, 0)} ${pt(-size * 0.8, size * 0.8)} ${pt(-size * 0.35, 0)} ${pt(-size * 0.8, -size * 0.8)}`;
    const cls = `sc-blip ${s.side}${s.key === center.key ? " focus" : ""}`;
    parts.push(`<g class="${cls}" data-action="radarFocus" data-key="${esc(s.key)}"><title>${esc(s.name)}</title><polygon points="${shape}" /><text x="${f(s.x)}" y="${f(s.y + size * 1.4 + 1.2 * unit)}" text-anchor="middle" font-size="${f(1.35 * unit)}">${esc(s.name)}</text></g>`);
  }

  return `<svg class="sc-radar-svg" viewBox="${vb}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}
