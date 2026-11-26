/**
 * Onglets de référence du tableau de combat spatial : Pilote, Artilleur, Autres postes, Avantages / Menaces.
 * Règles d'Aux Confins de l'Empire, chapitre VII (p. 223-246) et attributs d'armes du chapitre V.
 * Les balises [DI], [AD]… sont converties en symboles de dés à l'affichage.
 */
import * as R from "./space-combat-rules.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
const diff = (n) => `${R.DIFFICULTY_NAMES[n]} (${"[DI]".repeat(n)})`;
const rows = (list) => list.map(([th, td]) => `<tr><th>${th}</th><td>${td}</td></tr>`).join("");
const table = (list, caption = "") => `<table class="sc-table">${caption ? `<caption>${caption}</caption>` : ""}<tbody>${rows(list)}</tbody></table>`;
const toc = (items) => `<nav class="sc-guide-toc">${items.map(([id, label]) => `<a data-action="scJump" data-target="${id}">${label}</a>`).join("")}</nav>`;

/* -------------------------------------------------------------------------- */
/*  Pilote                                                                    */
/* -------------------------------------------------------------------------- */

export function pilotHTML() {
  const man = Object.values(R.MANEUVERS).map((m) => [m.label,
    `${m.hint}<br><small>Gabarit ${m.maxSil < 10 ? `1 à ${m.maxSil}` : "tous"} · vitesse ${m.minSpeed ? `${m.minSpeed} ou plus` : "toutes"}</small>`]);
  return `${toc([["scp-role", "Le rôle"], ["scp-limites", "Limites"], ["scp-man", "Manœuvres"], ["scp-voler", "Voler"], ["scp-avantage", "Prendre l'avantage"], ["scp-terrain", "Terrain"], ["scp-outil", "Dans l'outil"]])}
  <section id="scp-role">
    <h2>Le rôle du pilote</h2>
    <p>Le pilote contrôle l'allure et la trajectoire du vaisseau. Il décide de la distance avec l'ennemi, rend le vaisseau difficile à toucher (ou ses tirs plus précis) et peut prendre l'avantage dans un duel. Ses tests utilisent <strong>Pilotage (espace)</strong> ou <strong>Pilotage (planétaire)</strong> selon que le vaisseau est dans l'espace ou dans l'atmosphère.</p>
    <p>La <strong>maniabilité</strong> du vaisseau s'ajoute à <em>tous</em> ses tests de Pilotage : autant de [BO] si elle est positive, de [SE] si elle est négative.</p>
  </section>
  <section id="scp-limites">
    <h2>Limites des manœuvres de pilote</h2>
    <ul>
      <li>Un vaisseau de <strong>gabarit 1 à 4</strong> fait <strong>une manœuvre de pilote par round</strong>. Il peut en faire <strong>une deuxième</strong> si le vaisseau subit <strong>2 points de stress mécanique</strong> (ou si le pilote sacrifie son action).</li>
      <li>Un vaisseau de <strong>gabarit 5 ou plus</strong> ne fait jamais plus d'<strong>une</strong> manœuvre de pilote par round.</li>
      <li>La limite est <strong>par vaisseau</strong> : s'il y a plusieurs pilotes, ils se partagent ces manœuvres.</li>
      <li>Personne ne fait plus de deux manœuvres par tour, toutes manœuvres confondues.</li>
      <li>La <strong>vitesse actuelle</strong> va de 0 (arrêt) à la vitesse maximale : on ne peut pas manœuvrer avant d'avoir pris de la vitesse.</li>
    </ul>
  </section>
  <section id="scp-man">
    <h2>Manœuvres de pilote</h2>
    ${table(man)}
    <p class="sc-hint">Réorienter les boucliers n'est pas une manœuvre de pilote : n'importe quel membre d'équipage peut le faire (voir « Autres postes »).</p>
  </section>
  <section id="scp-voler">
    <h2>Voler : changer de distance</h2>
    ${table([
      ["Vitesse 0", "À l'arrêt : il faut d'abord accélérer."],
      ["Vitesse 1", "1 manœuvre pour se déplacer à portée proche ; 2 manœuvres pour passer de proche à courte (et inversement)."],
      ["Vitesse 2 à 4", "1 manœuvre pour passer de proche à courte ; 2 manœuvres pour passer de proche à moyenne."],
      ["Vitesse 5 et 6", "1 manœuvre pour passer de proche à moyenne ; 2 manœuvres pour passer de proche à longue."],
    ])}
    <p class="sc-hint">La portée se mesure depuis le vaisseau en mouvement ; ce n'est pas une distance précise. Les niveaux : proche (les duels de chasseurs), courte, moyenne (là où se battent les vaisseaux amiraux), longue, extrême (presque aucune arme n'y porte).</p>
  </section>
  <section id="scp-avantage">
    <h2>Prendre l'avantage <small>(action, gabarit 1 à 4, vitesse 4 ou plus)</small></h2>
    <p>Le pilote se place en position de tir idéale derrière son adversaire. Test de Pilotage dont la difficulté dépend de la vitesse relative (table 7-3) :</p>
    ${table([
      ["Même vitesse", diff(2)],
      ["Plus rapide que la cible", diff(1)],
      ["Plus lent de 1", diff(3)],
      ["Plus lent de 2 ou plus", diff(4)],
    ])}
    <p><strong>Réussite :</strong> jusqu'à la fin du round suivant, le pilote <strong>ignore les manœuvres d'évasion</strong> de sa cible et <strong>choisit la zone</strong> que ses tirs touchent. <strong>Échec :</strong> il continue de subir les effets de l'évasion adverse.</p>
    <p>L'adversaire peut reprendre l'avantage avec le même test, mais <strong>+1 [DI] à chaque fois</strong> que l'un ou l'autre l'a déjà pris dans ce duel.</p>
  </section>
  <section id="scp-terrain">
    <h2>Terrain et phénomènes célestes</h2>
    <p>Traverser un champ d'astéroïdes, une nébuleuse ou un canyon demande un test de Pilotage. On compare la <strong>vitesse actuelle</strong> et la <strong>moitié du gabarit</strong> (arrondie au supérieur) : la plus grande donne le nombre de [DI], la plus petite le nombre de ces dés améliorés en [CH]. Le danger du lieu ajoute des [SE] (table 7-8) :</p>
    ${table([
      ["—", "Situation simple : vaste champ d'astéroïdes peu dense, nébuleuse calme."],
      ["[SE]", "Obstacles délicats : survol de montagnes, champ d'astéroïdes un peu plus dense."],
      ["[SE][SE]", "Phénomène dangereux : comète fracturée, champ d'astéroïdes très dense et turbulent."],
      ["[SE][SE][SE] +", "Situation extrêmement périlleuse : naviguer dans la Gueule, près d'un pulsar, dans les tunnels d'un astéroïde."],
    ])}
    <p><strong>Exemple du livre :</strong> un chasseur TIE (gabarit 3) à pleine vitesse (5) dans un champ d'astéroïdes : 5 dés de difficulté, dont 2 améliorés ([DI][DI][DI][CH][CH]).</p>
    <p>Rater ne veut pas dire s'écraser : le pilote doit ralentir ou n'atteint pas le point visé. Un [DE] peut provoquer une collision.</p>
  </section>
  <section id="scp-outil">
    <h2>Dans l'outil</h2>
    <ul>
      <li>Les boutons de manœuvre de la carte du vaisseau appliquent les règles : boutons grisés avec la raison écrite dessous (gabarit, vitesse, limite atteinte, vaisseau dévié ou culbuté, moteur à l'arrêt, rayon tracteur), pastilles jaunes pour les manœuvres déjà faites ce round.</li>
      <li>La 2ᵉ manœuvre se paie au choix en 2 stress mécanique ou en sacrifiant l'action du pilote (le stress n'est plus possible avec le critique « Fluctuations énergétiques »).</li>
      <li>« Annuler » défait la dernière manœuvre du round (vitesse, stress, effets, distance).</li>
      <li>« Voler » demande par rapport à quel vaisseau et la nouvelle distance, qui est mémorisée pour les tirs.</li>
      <li>« Prendre l'avantage », « Terrain », « Reprendre le contrôle » (critique « Dévié ») et « Se libérer du rayon » ouvrent le jet de Pilotage avec la difficulté et la maniabilité déjà comptées.</li>
      <li>Ces boutons ne s'affichent que pour le joueur dont le personnage a le poste de pilote à bord.</li>
    </ul>
  </section>`;
}

/* -------------------------------------------------------------------------- */
/*  Artilleur                                                                 */
/* -------------------------------------------------------------------------- */

const WEAPONS_7_1 = [
  ["Autoblaster", "Proche", 3, 5, "Automatique"],
  ["Canon blaster (léger)", "Proche", 4, 4, "—"],
  ["Canon blaster (lourd)", "Proche", 5, 4, "—"],
  ["Canon ionique (léger)", "Proche", 5, 4, "Ionique"],
  ["Canon ionique (moyen)", "Courte", 6, 4, "Ionique"],
  ["Canon ionique (lourd)", "Moyenne", 7, 4, "Cadence lente 1, Ionique"],
  ["Canon laser (léger)", "Proche", 5, 3, "—"],
  ["Canon laser (moyen)", "Proche", 6, 3, "—"],
  ["Canon laser (lourd)", "Courte", 6, 3, "—"],
  ["Lance-missiles à concussion", "Courte", 6, 3, "Brèche 4, Cadence lente 1, Munitions limitées 3, Projectile guidé 3, Souffle 4"],
  ["Lance-torpille à protons", "Courte", 8, 2, "Brèche 6, Cadence lente 1, Munitions limitées 3, Projectile guidé 2, Souffle 6"],
  ["Quad-laser", "Proche", 5, 3, "Jumelé 3, Précis"],
  ["Rayon tracteur (léger)", "Proche", "—", "—", "Tracteur 2"],
  ["Rayon tracteur (moyen)", "Courte", "—", "—", "Tracteur 4"],
  ["Rayon tracteur (lourd)", "Courte", "—", "—", "Tracteur 6"],
  ["Turbolaser (léger)", "Moyenne", 9, 3, "Brèche 2, Cadence lente 1"],
  ["Turbolaser (moyen)", "Longue", 10, 3, "Brèche 3, Cadence lente 1"],
  ["Turbolaser (lourd)", "Longue", 11, 3, "Brèche 4, Cadence lente 2"],
];

export function gunnerHTML() {
  return `${toc([["sca-role", "Le rôle"], ["sca-tir", "Tirer pas à pas"], ["sca-diff", "Difficulté"], ["sca-degats", "Dégâts et critiques"], ["sca-attr", "Attributs d'armes"], ["sca-armes", "Table des armes"], ["sca-outil", "Dans l'outil"]])}
  <section id="sca-role">
    <h2>Le rôle de l'artilleur</h2>
    <p>L'artilleur sert une arme du vaisseau : tourelle, canons fixes, lance-missiles. Ses tests utilisent <strong>Artillerie</strong> (Agilité), ou parfois <strong>Distance (armes lourdes)</strong> sur certains véhicules.</p>
    <ul>
      <li><strong>Chaque arme ne tire qu'une seule fois par round</strong>, quel que soit le nombre de personnages à bord.</li>
      <li>L'arme doit avoir la cible dans son <strong>arc de tir</strong> : avant, arrière, bâbord, tribord, dorsal (dessus) ou ventral (dessous). Une arme fixe n'a qu'un arc ; une tourelle peut en couvrir plusieurs, voire tous.</li>
      <li>La cible doit être à <strong>portée</strong> de l'arme.</li>
      <li>Les manœuvres ordinaires restent possibles : <em>viser</em> avec un quad-laser donne [BO] comme avec un blaster.</li>
    </ul>
  </section>
  <section id="sca-tir">
    <h2>Tirer pas à pas</h2>
    <ol>
      <li><strong>Choisir l'arme et la cible</strong> (arc de tir, portée, arme qui n'a pas encore tiré ce round).</li>
      <li><strong>Constituer la réserve</strong> : Artillerie et Agilité, comme pour tout test.</li>
      <li><strong>Difficulté</strong> : comparaison des gabarits (ci-dessous), puis la <strong>défense</strong> de la zone visée ajoute autant de [SE].</li>
      <li><strong>Modificateurs</strong> : évasion (+1 [DI] amélioré, pour la cible <em>et</em> pour le tireur qui l'a faite), Coller à la cible (+1 [AB] amélioré, des deux côtés), Précis, talents, critiques subis…</li>
      <li><strong>Lancer.</strong> Au moins autant de [SU] que de [FA] : touché.</li>
      <li><strong>Dégâts</strong> = dégâts de l'arme + 1 par [SU] net, moins le blindage de la cible.</li>
      <li><strong>Dépenser les symboles</strong> : critique, attributs de l'arme, puis les tables de l'onglet « Avantages / Menaces ».</li>
    </ol>
  </section>
  <section id="sca-diff">
    <h2>Difficulté : la taille, pas la distance</h2>
    ${table([
      ["Gabarits égaux ou écart de 1", diff(2)],
      ["Tireur plus petit de 2 ou plus", diff(1)],
      ["Tireur plus grand de 2", diff(3)],
      ["Tireur plus grand de 3", diff(4)],
      ["Tireur plus grand de 4 ou plus", diff(5)],
    ], "Table 7-4 : comparaison des gabarits")}
    <p>Un chasseur touche facilement un destroyer ; un destroyer a du mal à toucher un chasseur. Grâce aux systèmes de visée, la distance ne change pas la difficulté tant que la cible est à portée.</p>
    <p><strong>Quelle zone est visée ?</strong> Un petit vaisseau (gabarit 4 ou moins) présente toujours sa zone <strong>la mieux défendue</strong>, sauf si le tireur a <strong>pris l'avantage</strong> sur lui : c'est alors le tireur qui choisit. Contre un gros vaisseau (gabarit 5 ou plus), c'est la <strong>position du tireur</strong> qui décide.</p>
  </section>
  <section id="sca-degats">
    <h2>Dégâts et critiques</h2>
    <ul>
      <li>Les armes de vaisseau sont à l'<strong>échelle planétaire</strong> : 1 point de dégâts vaut 10 à l'échelle d'un personnage.</li>
      <li>Dégâts restant après le blindage = <strong>dégâts de coque</strong>. Les armes <strong>Ionique</strong> infligent du <strong>stress mécanique</strong> à la place.</li>
      <li><strong>Critique</strong> : si l'attaque a percé le blindage, dépensez autant de [AD] que la valeur de Critique de l'arme, ou un [TR]. Jet de 1d100 sur la table 7-9, <strong>+10 par critique déjà subi et non réparé</strong>.</li>
      <li>Un seul critique par attaque et par cible, mais chaque critique supplémentaire « acheté » avec des [AD] donne <strong>+10</strong> au jet.</li>
      <li>Les talents et attributs qui ne visent que les blessures critiques des personnages (comme Sanguinaire) n'ont aucun effet sur les dégâts critiques des vaisseaux.</li>
    </ul>
    <div class="sc-callout">Une arme dont les dégâts ne dépassent pas le blindage ne peut pas faire de critique. Contre un blindage de 6, des canons de dégâts 5 ont besoin de beaucoup de succès.</div>
  </section>
  <section id="sca-attr">
    <h2>Attributs d'armes utiles en combat spatial</h2>
    ${table([
      ["Automatique", "+1 [DI] au test si l'on tire en rafale. Une fois la cible touchée, [AD][AD] : un coup supplémentaire (dégâts de base + [SU] nets), répétable, sur la même cible ou d'autres à portée."],
      ["Brèche N", "Ignore N points de blindage (soit 10 × N points d'encaissement)."],
      ["Cadence lente N", "Après un tir, l'arme doit attendre N rounds avant de tirer de nouveau."],
      ["Ionique", "Les dégâts s'appliquent au seuil de stress mécanique au lieu de la coque ; le blindage les réduit quand même."],
      ["Jumelé N", "Une fois la cible touchée, [AD][AD] : un coup supplémentaire sur la même cible (dégâts de base + [SU]), jusqu'à N coups supplémentaires."],
      ["Munitions limitées N", "N tirs avant de recharger. Les chasseurs ne peuvent pas recharger leurs missiles et torpilles en vol : il faut revenir à la base ou à un vaisseau de transport."],
      ["Précis N", "+N [BO] au test d'attaque."],
      ["Projectile guidé N", "Si l'attaque a raté, [AD][AD][AD] : nouveau test à la fin du round, avec N [AB] et une difficulté selon le gabarit de la cible (le projectile compte comme gabarit 0). Peut être activé plusieurs fois. Les contre-mesures et leurres augmentent la défense contre ces armes."],
      ["Souffle N", "Dans l'espace, le rayon de l'explosion ne permet pas de toucher plusieurs vaisseaux. Contre des cibles au sol, chaque personnage au contact (voire à portée courte, à l'échelle planétaire) subit les dégâts de Souffle."],
      ["Tracteur N", "Pas de dégâts : la cible touchée est immobilisée jusqu'à ce que son pilote réussisse un test de Pilotage de difficulté N."],
    ])}
  </section>
  <section id="sca-armes">
    <h2>Armes des vaisseaux et véhicules <small>(table 7-1)</small></h2>
    <table class="sc-table sc-weapons-table"><thead><tr><th>Arme</th><th>Portée</th><th>Dégâts</th><th>Critique</th><th>Attributs</th></tr></thead><tbody>
      ${WEAPONS_7_1.map((w) => `<tr><td>${esc(w[0])}</td><td>${w[1]}</td><td>${w[2]}</td><td>${w[3]}</td><td>${esc(w[4])}</td></tr>`).join("")}
    </tbody></table>
    <p class="sc-hint">Missiles à concussion supplémentaires : 500 crédits pièce (I). Torpilles à protons supplémentaires : 750 crédits pièce (I).</p>
  </section>
  <section id="sca-outil">
    <h2>Dans l'outil</h2>
    <ul>
      <li>« Viser » (manœuvre) donne +1 [BO], ou +2 [BO] avec deux manœuvres, à la prochaine attaque de ce personnage ce round.</li>
      <li>« Attaquer » ouvre un résumé : difficulté par les gabarits, défense de la zone, évasion, Coller à la cible, avantage, Précis, visée, vaisseau culbuté, rafale. On y indique aussi la portée de la cible et l'arc où elle se trouve : l'outil prévient si l'arme ne porte pas ou ne couvre pas cet arc.</li>
      <li>Les armes à Cadence lente attendent leurs rounds ; les Munitions limitées se décomptent (le MJ réapprovisionne depuis la carte du vaisseau).</li>
      <li>Après le jet, une carte de chat donne le calcul (dégâts + succès − blindage, Brèche, Ionique), un bouton par coup supplémentaire possible (Jumelé, rafale), le jet de critique, la relance d'un projectile guidé raté ou l'immobilisation par un rayon tracteur. Le MJ applique.</li>
      <li>Sur un gros vaisseau, le MJ peut faire tirer une batterie d'armes identiques en une seule attaque (règle des sbires).</li>
      <li>Ce bouton ne s'affiche que pour le joueur dont le personnage a un poste d'artilleur à bord.</li>
    </ul>
  </section>`;
}

/* -------------------------------------------------------------------------- */
/*  Autres postes                                                             */
/* -------------------------------------------------------------------------- */

export function crewHTML(skillLabel) {
  const byKey = Object.fromEntries(R.CREW_ACTIONS.map((a) => [a.key, a]));
  const skill = (s) => (s === "Piloting" ? "Pilotage" : skillLabel(s));
  const action = (k) => {
    const a = byKey[k];
    return [a.label, `<em>${skill(a.skill)} ${diff(a.difficulty)}${a.alt ? ` ou ${skill(a.alt.skill)} ${diff(a.alt.difficulty)}` : ""}</em><br>${a.result}`];
  };
  return `${toc([["sco-tous", "Tout l'équipage"], ["sco-meca", "Mécanicien"], ["sco-copilote", "Copilote"], ["sco-systemes", "Systèmes"], ["sco-senseurs", "Senseurs"], ["sco-nav", "Navigateur"], ["sco-capitaine", "Capitaine"], ["sco-outil", "Dans l'outil"]])}
  <section id="sco-tous">
    <h2>Ce que tout membre d'équipage peut faire</h2>
    <p>Chaque personnage a, à son tour, <strong>une action et une manœuvre</strong>. Ceux qui ne pilotent ni ne tirent ont des actions utiles (table 7-7). Le MJ peut en autoriser d'autres : elles ne sont limitées que par l'imagination des joueurs.</p>
    ${table([
      ["Réorienter les boucliers", "<em>Manœuvre</em>, tous gabarits, si le vaisseau a des boucliers déflecteurs : 1 point de défense passe d'une zone à une autre (par exemple de l'avant vers l'arrière quand on est pris en chasse)."],
      ["Contrôle des dégâts", `<em>Action, test de Mécanique.</em> Difficulté selon l'état du vaisseau (table 7-2) : ${diff(1)} sous la moitié du seuil, ${diff(2)} à partir de la moitié, ${diff(3)} au-delà du seuil. Retire du stress mécanique, ou répare un dégât critique (à la difficulté de ce critique). Les dégâts de coque ne se réparent ainsi qu'<strong>une fois par rencontre</strong>. Une action par personnage et par tour.`],
    ])}
  </section>
  <section id="sco-meca">
    <h2>Mécanicien</h2>
    ${table([action("boost"), action("manual")])}
    <p class="sc-hint">Le MJ peut refuser une réparation impossible : le pilote d'un chasseur ne peut pas sortir de son cockpit pour recoller une aile en plein combat.</p>
  </section>
  <section id="sco-copilote">
    <h2>Copilote</h2>
    ${table([action("copilot")])}
  </section>
  <section id="sco-systemes">
    <h2>Officier des systèmes</h2>
    ${table([action("jam"), action("slice"), action("counter")])}
  </section>
  <section id="sco-senseurs">
    <h2>Officier senseurs</h2>
    ${table([action("scan")])}
    <p class="sc-hint">Les senseurs passifs détectent tout ce qui est proche sans test. Les passer en mode actif (test d'Informatique Facile) augmente leur portée d'un niveau, mais restreint leur champ à un seul arc.</p>
  </section>
  <section id="sco-nav">
    <h2>Navigateur</h2>
    ${table([action("plot")])}
  </section>
  <section id="sco-capitaine">
    <h2>Capitaine</h2>
    ${table([action("fire")])}
  </section>
  <section id="sco-outil">
    <h2>Dans l'outil</h2>
    <ul>
      <li>« Action d'équipage » propose toute la table 7-7 avec la compétence et la difficulté ; « Contrôle des dégâts » choisit la difficulté selon le stress, la coque ou le critique à réparer ; « Réorienter » déplace 1 point de défense.</li>
      <li>Le résultat arrive dans le chat ; le MJ applique les effets (+1 défense, coque ou stress retirés…).</li>
      <li>Pour qu'un joueur voie ces boutons, son personnage doit avoir un poste dans l'équipage du vaisseau (glissez-le sur la fiche du vaisseau).</li>
    </ul>
  </section>`;
}

/* -------------------------------------------------------------------------- */
/*  Avantages / Menaces                                                       */
/* -------------------------------------------------------------------------- */

export function symbolsHTML() {
  const spend = (list) => `<table class="sc-table"><tbody>${list.map((r) => `<tr><th>${r.cost}</th><td><ul>${r.options.map((o) => `<li>${esc(o)}</li>`).join("")}</ul></td></tr>`).join("")}</tbody></table>`;
  return `${toc([["scs-qui", "Qui dépense"], ["scs-ad", "Avantages et triomphes"], ["scs-arme", "Avec une arme"], ["scs-th", "Menaces et désastres"], ["scs-stress", "Stress"]])}
  <section id="scs-qui">
    <h2>Qui dépense quoi ?</h2>
    <ul>
      <li>Le <strong>joueur</strong> dont le personnage a fait le test choisit comment dépenser ses [AD] et ses [TR], sauf si le MJ a une raison précise de l'imposer.</li>
      <li>Le <strong>MJ</strong> choisit comment dépenser les [TH] et les [DE] (il peut demander l'avis du joueur quand c'est un PNJ qui a lancé).</li>
      <li>Un [TR] compte aussi comme un [SU], et un [DE] comme un [FA] : ils pèsent sur la réussite du test en plus de leurs effets.</li>
      <li>Ces tables ne sont pas exhaustives : le MJ et les joueurs peuvent inventer d'autres effets adaptés à la situation.</li>
    </ul>
  </section>
  <section id="scs-ad">
    <h2>Dépenser [AD] et [TR] <small>(table 7-5)</small></h2>
    ${spend(R.SPEND_ADVANTAGE)}
  </section>
  <section id="scs-arme">
    <h2>Avec une attaque réussie</h2>
    ${table([
      ["Critique", "Autant de [AD] que la valeur de Critique de l'arme, ou un [TR], si l'attaque a percé le blindage. Chaque critique supplémentaire acheté donne +10 au jet."],
      ["Jumelé N", "[AD][AD] : un coup supplémentaire sur la même cible, jusqu'à N."],
      ["Automatique", "[AD][AD] : un coup supplémentaire, répétable."],
      ["Projectile guidé N", "Si l'attaque a raté : [AD][AD][AD] pour un nouveau test à la fin du round."],
      ["Activer un attribut", "Un [TR] active n'importe quel attribut d'arme, quel que soit son coût en [AD]."],
    ])}
  </section>
  <section id="scs-th">
    <h2>Dépenser [TH] et [DE] <small>(table 7-6)</small></h2>
    ${spend(R.SPEND_THREAT)}
  </section>
  <section id="scs-stress">
    <h2>Rappel : le stress mécanique</h2>
    <p>Contrairement au stress d'un personnage, le <strong>stress mécanique ne peut pas être retiré en dépensant des [AD]</strong>. Il faut le contrôle des dégâts (Mécanique), ou un jour entier sans nouveau stress (−1 point par jour).</p>
  </section>`;
}
