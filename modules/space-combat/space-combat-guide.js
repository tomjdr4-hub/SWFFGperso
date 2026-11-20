/**
 * Onglet « Déroulement » du tableau de combat spatial : explication pas à pas d'un combat spatial
 * (Aux Confins de l'Empire, chapitre VII, p. 223-246) et de l'usage de l'outil.
 * Les balises [DI], [AD]… sont converties en symboles de dés à l'affichage.
 */
export const GUIDE_HTML = `
<nav class="sc-guide-toc">
  <a data-action="scJump" data-target="scg-idee">1. L'idée</a>
  <a data-action="scJump" data-target="scg-prepa">2. Préparer</a>
  <a data-action="scJump" data-target="scg-round">3. Le round</a>
  <a data-action="scJump" data-target="scg-tour">4. Le tour à bord</a>
  <a data-action="scJump" data-target="scg-pilote">5. Piloter</a>
  <a data-action="scJump" data-target="scg-tir">6. Tirer</a>
  <a data-action="scJump" data-target="scg-degats">7. Encaisser</a>
  <a data-action="scJump" data-target="scg-equipage">8. L'équipage</a>
  <a data-action="scJump" data-target="scg-exemple">9. Exemple</a>
  <a data-action="scJump" data-target="scg-outil">10. Avec l'outil</a>
</nav>

<section id="scg-idee">
  <h2>1. L'idée générale</h2>
  <p>Un combat spatial se joue <strong>avec les mêmes règles qu'un combat normal</strong> : initiative, tours, une action et une manœuvre par personnage, tests de compétence avec les dés narratifs. Les vaisseaux ajoutent seulement quelques règles en plus.</p>
  <ul>
    <li><strong>Pas de plan de bataille.</strong> On ne déplace pas de figurines : le MJ et les joueurs <em>décrivent</em> la poursuite, les esquives et les passes de tir. Les distances sont des <strong>niveaux de portée</strong> (proche, courte, moyenne, longue, extrême).</li>
    <li><strong>Ce sont les personnages qui agissent</strong>, pas les vaisseaux. Le pilote pilote, l'artilleur tire, le mécanicien répare. Chacun joue dans son propre créneau d'initiative.</li>
    <li><strong>Tout est à l'échelle planétaire</strong> : 1 point de dégâts, de blindage ou de coque d'un vaisseau vaut 10 points à l'échelle d'un personnage. Un blaster doit infliger 10 dégâts pour faire 1 point de dégâts de coque, et un canon laser de vaisseau qui touche un humain le met presque toujours hors de combat.</li>
  </ul>
  <div class="sc-callout"><strong>À retenir :</strong> un vaisseau, c'est une « fiche » partagée par plusieurs personnages. Sa vitesse, sa défense et son état changent au fil du combat selon ce que fait chacun à bord.</div>
</section>

<section id="scg-prepa">
  <h2>2. Préparer la rencontre</h2>
  <ol>
    <li><strong>Les vaisseaux en présence.</strong> Pour chacun, on regarde son <em>gabarit</em> (taille : 3-4 pour un chasseur ou un cargo léger, 5 et plus pour un gros vaisseau), sa <em>vitesse</em> maximale, sa <em>maniabilité</em>, sa <em>défense</em> par zone, son <em>blindage</em>, et ses seuils de <em>coque</em> et de <em>stress mécanique</em>.</li>
    <li><strong>Qui est à quel poste ?</strong> Un seul pilote par vaisseau, en général. Les autres personnages se répartissent les armes et les systèmes.</li>
    <li><strong>La situation de départ.</strong> Le MJ décrit la distance entre les belligérants (« deux TIE surgissent à portée courte ») et l'allure des vaisseaux (à quai, en croisière, déjà lancés à pleine vitesse).</li>
    <li><strong>Les PNJ peu importants</strong> peuvent être regroupés : 2 à 4 chasseurs identiques forment un groupe de sbires qui agit, tire et encaisse comme un seul vaisseau.</li>
  </ol>
</section>

<section id="scg-round">
  <h2>3. Le déroulement d'un round</h2>
  <ol>
    <li><strong>Initiative</strong> (au premier round seulement) : chaque personnage, PJ comme PNJ, fait un test Simple de <em>Calme</em> (s'il s'attendait au combat) ou de <em>Vigilance</em> (s'il est pris par surprise). On classe les résultats ; cela donne une suite de <strong>créneaux PJ</strong> et de <strong>créneaux PNJ</strong>.</li>
    <li><strong>Les tours</strong> : quand vient un créneau PJ, les joueurs choisissent ensemble lequel de leurs personnages joue (n'importe lequel qui n'a pas encore agi). Même chose côté PNJ pour le MJ. Les membres d'équipage d'un même vaisseau peuvent donc jouer à des moments très différents du round.</li>
    <li><strong>Fin du round</strong> : quand tout le monde a joué, les effets « jusqu'à la fin du round » cessent et on recommence au point 2 avec le même ordre d'initiative.</li>
    <li><strong>Fin de la rencontre</strong> : quand le combat est réglé (destruction, fuite, saut dans l'hyperespace…). Les capacités « une fois par rencontre » redeviennent disponibles.</li>
  </ol>
  <div class="sc-callout">Pour les gros vaisseaux qui ont des centaines d'hommes d'équipage, on ne s'occupe que des personnages dont les actions comptent vraiment : le capitaine, le pilote, quelques groupes d'artilleurs.</div>
</section>

<section id="scg-tour">
  <h2>4. Le tour d'un personnage à bord</h2>
  <p>Comme d'habitude : <strong>une action et une manœuvre</strong>. On peut faire une deuxième manœuvre au lieu de l'action, ou en subissant 2 points de stress (personnel), mais jamais plus de deux manœuvres par tour.</p>
  <p>Deux règles propres aux vaisseaux limitent ce que l'équipage peut faire :</p>
  <ul>
    <li><strong>Les manœuvres de pilote sont limitées par vaisseau, pas par personnage.</strong> Un vaisseau de gabarit 1 à 4 ne fait qu'<strong>une manœuvre de pilote par round</strong> ; il peut en faire une deuxième si le vaisseau subit <strong>2 points de stress mécanique</strong>. Un vaisseau de gabarit 5 ou plus n'en fait jamais qu'une.</li>
    <li><strong>Chaque arme ne tire qu'une seule fois par round</strong>, quel que soit le nombre de personnages à bord.</li>
  </ul>
  <p>Les manœuvres ordinaires restent possibles (viser, se mettre à couvert dans la coursive, dégainer…), dans la limite du bon sens : un artilleur peut <em>viser</em> avec son quad-laser comme avec un blaster.</p>
</section>

<section id="scg-pilote">
  <h2>5. Piloter : vitesse, manœuvres et avantage</h2>
  <p>La <strong>vitesse actuelle</strong> d'un vaisseau change pendant le combat ; elle va de 0 (arrêt) à sa vitesse maximale. C'est elle qui détermine quelles manœuvres sont possibles et à quelle allure on change de portée.</p>
  <table class="sc-table"><tbody>
    <tr><th>Accélérer / Décélérer</th><td>Vitesse ±1. Tous les vaisseaux.</td></tr>
    <tr><th>Voler</th><td>Changer de distance avec une cible, à la vitesse actuelle. Vitesse 1 : 2 manœuvres pour passer de proche à courte. Vitesse 2-4 : 1 manœuvre pour proche ↔ courte, 2 pour proche ↔ moyenne. Vitesse 5-6 : 1 manœuvre pour proche ↔ moyenne, 2 pour proche ↔ longue.</td></tr>
    <tr><th>Manœuvre d'évasion</th><td>Gabarit 1-4, vitesse 3+. Jusqu'à la fin du prochain tour du pilote, il est plus dur de toucher le vaisseau (1 [DI] amélioré)… mais <em>ses propres tirs</em> sont aussi plus durs.</td></tr>
    <tr><th>Coller à la cible</th><td>Gabarit 1-4, vitesse 3+. Les tirs du vaisseau sont plus précis (1 [AB] amélioré)… mais les tirs <em>contre lui</em> aussi.</td></tr>
    <tr><th>Mettre la gomme</th><td>Gabarit 1-4. Passe tout de suite à la vitesse maximale, contre 1 point de stress mécanique par niveau de vitesse gagné.</td></tr>
    <tr><th>Réorienter les boucliers</th><td>Pas une manœuvre de pilote : n'importe qui aux commandes des boucliers transfère 1 point de défense d'une zone à une autre (par exemple de l'avant vers l'arrière quand on est pris en chasse).</td></tr>
  </table>
  <p><strong>Prendre l'avantage</strong> (action du pilote, gabarit 1-4, vitesse 4+) : c'est le duel de chasseurs. Test de Pilotage dont la difficulté dépend de l'écart de vitesse (plus rapide que l'adversaire : Facile ; même vitesse : Moyenne ; plus lent de 1 : Difficile ; de 2 ou plus : Intimidante). En cas de réussite, jusqu'à la fin du round suivant, le pilote <strong>ignore les manœuvres d'évasion</strong> de sa cible et <strong>choisit la zone</strong> qu'il touche. L'adversaire peut reprendre l'avantage, avec +1 [DI] à chaque fois que l'un ou l'autre l'a déjà pris.</p>
  <p><strong>Le terrain</strong> (astéroïdes, nébuleuse, canyon) impose un test de Pilotage : la plus grande valeur entre la vitesse et la moitié du gabarit donne le nombre de [DI], la plus petite le nombre de ces dés améliorés en [CH]. Le danger du lieu ajoute de 0 à 3 [SE]. Rater ne veut pas dire s'écraser : le pilote doit ralentir ou n'arrive pas où il voulait.</p>
  <p>La <strong>maniabilité</strong> du vaisseau s'ajoute à <em>tous</em> les tests de Pilotage : autant de [BO] si elle est positive, de [SE] si elle est négative.</p>
</section>

<section id="scg-tir">
  <h2>6. Tirer, pas à pas</h2>
  <ol>
    <li><strong>Choisir l'arme et la cible.</strong> L'arme doit pouvoir viser la cible : elle doit être à <em>portée</em> et dans l'<em>arc de tir</em> de l'arme (avant, arrière, bâbord, tribord, dorsal, ventral, ou toutes directions pour une tourelle). L'arme ne doit pas avoir déjà tiré ce round.</li>
    <li><strong>Constituer la réserve.</strong> Compétence <em>Artillerie</em> (ou Distance (armes lourdes) sur certains véhicules) et Agilité, comme d'habitude.</li>
    <li><strong>La difficulté vient de la taille, pas de la distance.</strong> On compare les gabarits : écart de 1 ou moins = Moyenne ([DI][DI]) ; tireur plus petit de 2 ou plus = Facile ; plus grand de 2 = Difficile ; de 3 = Intimidante ; de 4 ou plus = Exceptionnelle. Un chasseur touche facilement un destroyer ; un destroyer a du mal à toucher un chasseur.</li>
    <li><strong>Ajouter les modificateurs.</strong> La <strong>défense</strong> de la zone visée ajoute autant de [SE]. Un petit vaisseau (gabarit 4 ou moins) présente toujours sa zone la mieux défendue, sauf si le tireur a pris l'avantage ; contre un gros vaisseau, c'est la position du tireur qui décide. Puis l'évasion et Coller à la cible (des deux côtés), l'attribut Précis, etc.</li>
    <li><strong>Lancer.</strong> Au moins autant de [SU] que de [FA] : touché. Dégâts = dégâts de l'arme <strong>+ 1 par succès</strong>.</li>
    <li><strong>Retirer le blindage.</strong> Dégâts − blindage de la cible (moins l'attribut Brèche) = <strong>dégâts de coque</strong>. Une arme <em>Ionique</em> inflige du <strong>stress mécanique</strong> à la place.</li>
    <li><strong>Dépenser les symboles.</strong> Si l'attaque a percé le blindage, on peut déclencher un <strong>dégât critique</strong> en dépensant autant de [AD] que la valeur de Critique de l'arme, ou un [TR]. Les autres [AD], [TR], [TH] et [DE] se dépensent avec les tables 7-5 et 7-6 (voir l'Aide-mémoire) : donner [BO] à un allié, manœuvre gratuite, endommager un composant… ou, côté menaces, perdre de la vitesse, subir du stress, collision.</li>
  </ol>
  <div class="sc-callout"><strong>Pourquoi les petites armes ne font rien aux gros vaisseaux :</strong> un critique n'est possible que si les dégâts dépassent le blindage. Contre un blindage de 6, des canons de dégâts 5 ne feront jamais de critique sans beaucoup de succès.</div>
</section>

<section id="scg-degats">
  <h2>7. Encaisser : coque, stress et critiques</h2>
  <ul>
    <li><strong>Stress mécanique</strong> : la fatigue du vaisseau (surchauffe, moteurs poussés à bout, tirs ioniques, [TH] dépensées contre lui). On <strong>ne peut pas</strong> le retirer avec des [AD]. Au-delà du seuil, les systèmes lâchent : le vaisseau devient impuissant jusqu'à ce qu'on le répare. Il disparaît de lui-même à raison de 1 point par jour sans incident.</li>
    <li><strong>Dégâts de coque</strong> : les vraies avaries. Au-delà du seuil, un vaisseau de gabarit 3 ou moins (ou sans importance) <strong>est détruit</strong> ; un plus gros vaisseau (ou celui des PJ) subit un dégât critique et <strong>part à la dérive</strong>. Une réparation d'urgence (Mécanique Difficile) le remet en état de fuir : vitesse 1, maniabilité −3, armes hors service, et tout critique suivant reçoit +30.</li>
    <li><strong>Dégâts critiques</strong> : on lance <strong>1d100</strong> sur la table 7-9, avec <strong>+10 par critique déjà subi et pas encore réparé</strong> (et +10 par critique supplémentaire « acheté » avec des [AD]). De « Stress mécanique » (1-9) à « Désintégré » (154+). Chaque critique a une difficulté de réparation.</li>
    <li><strong>Collisions</strong> : une collision inflige un critique, réduit de 10 × la défense de la zone percutée (collision mineure) ou de 5 × (collision majeure). Annulé si le total tombe à 0 ou moins.</li>
  </ul>
  <p><strong>Réparer en plein combat</strong> : action <em>Contrôle des dégâts</em> (Mécanique). Difficulté selon l'état : Facile sous la moitié du seuil, Moyenne à partir de la moitié, Difficile au-delà. Elle retire du stress mécanique, répare un critique (à sa propre difficulté), ou des dégâts de coque, mais ces derniers <strong>une seule fois par rencontre</strong>. Le MJ peut interdire une réparation impossible (on ne sort pas d'un cockpit de chasseur pour recoller une aile).</p>
</section>

<section id="scg-equipage">
  <h2>8. Que font les autres membres d'équipage ?</h2>
  <p>Ceux qui ne pilotent ni ne tirent ont des actions utiles (table 7-7, détaillée dans l'Aide-mémoire) :</p>
  <ul>
    <li><strong>Copilote</strong> : <em>Assister le pilotage</em> (Pilotage Moyen) pour faciliter le prochain test du pilote.</li>
    <li><strong>Mécanicien</strong> : <em>Contrôle des dégâts</em>, <em>Intensifier le bouclier</em> (+1 défense sur une zone contre 1 stress mécanique), <em>Réparations manuelles</em>.</li>
    <li><strong>Officier des systèmes</strong> : <em>Brouillage</em>, <em>Pirater les systèmes ennemis</em> (baisser la défense d'une zone adverse), <em>Contre-mesures</em> contre les missiles et torpilles.</li>
    <li><strong>Officier senseurs</strong> : <em>Scanner l'ennemi</em> pour connaître ses armes, ses seuils et son état.</li>
    <li><strong>Navigateur</strong> : <em>Tracer l'itinéraire</em> (Astrogation) pour annuler les pénalités du terrain, ou préparer le saut dans l'hyperespace.</li>
    <li><strong>Capitaine</strong> : <em>Discipline de tir</em> (Sang-froid ou Commandement) pour donner [BO] aux artilleurs.</li>
  </ul>
</section>

<section id="scg-exemple">
  <h2>9. Exemple de round</h2>
  <p><em>Le cargo YT-1300 des PJ (gabarit 4, vitesse 3, maniabilité −1, défense avant 1 / arrière 1, blindage 3) est surpris par un chasseur TIE (gabarit 3, vitesse 5, maniabilité +3, défense 0, blindage 2) à portée courte.</em></p>
  <ol>
    <li><strong>Initiative</strong> : Kira (pilote PJ), Dov (artilleur PJ), le pilote du TIE. Ordre obtenu : PNJ, PJ, PJ.</li>
    <li><strong>Créneau PNJ — le pilote du TIE.</strong> Manœuvre : <em>Mettre la gomme</em> (vitesse 0 → 5, +5 stress mécanique au TIE). Action : il tire ses canons laser (dégâts 6, Critique 3). Gabarit 3 contre 4 : écart de 1, difficulté Moyenne ([DI][DI]) ; le cargo présente sa zone la mieux défendue, qui ajoute [SE]. Il obtient 2 [SU] et 1 [AD] : 6 + 2 = 8 dégâts − blindage 3 = <strong>5 dégâts de coque</strong>. Pas assez de [AD] pour un critique ; le MJ dépense l'[AD] pour donner [BO] au prochain PNJ.</li>
    <li><strong>Créneau PJ — Kira, la pilote.</strong> Elle voudrait une <em>Manœuvre d'évasion</em>, mais il faut une vitesse de 3. Manœuvre : <em>Accélérer</em> (vitesse 0 → 1). Elle sacrifie son action pour une deuxième manœuvre de pilote, ce qui coûte 2 points de stress mécanique au cargo, et accélère encore (vitesse 2). Au round suivant, une seule accélération lui suffira pour pouvoir esquiver.</li>
    <li><strong>Créneau PJ — Dov, l'artilleur.</strong> Il tire avec la tourelle (dégâts 6, Critique 3). Gabarit 4 contre 3 : écart de 1, difficulté Moyenne ; le TIE n'a pas de défense. Il obtient 3 [SU] : 6 + 3 = 9 − blindage 2 = <strong>7 dégâts de coque</strong>. Le TIE a un seuil de 6 et un gabarit de 3 : il explose.</li>
    <li><strong>Fin du round.</strong> Les effets « jusqu'au prochain round » s'arrêtent ; le compteur de manœuvres de pilote de chaque vaisseau repart à zéro.</li>
  </ol>
</section>

<section id="scg-outil">
  <h2>10. Faire tout ça avec l'outil</h2>
  <ol>
    <li><strong>Ajouter les vaisseaux</strong> : placez les jetons sur la scène, sélectionnez-les, puis « Jetons sélectionnés → alliés » ou « → ennemis » (ou glissez un véhicule du répertoire dans une colonne). Réglez la vitesse de départ avec les boutons − / +.</li>
    <li><strong>L'initiative</strong> se gère dans le suivi de combat habituel du système, avec les personnages (pas les vaisseaux).</li>
    <li><strong>Quand un pilote joue</strong> : cliquez sa manœuvre sur la carte du vaisseau. Les boutons impossibles (gabarit, vitesse, limite atteinte) sont grisés ; la 2ᵉ manœuvre et « Mettre la gomme » demandent confirmation et ajoutent le stress mécanique. Les pastilles jaunes montrent les manœuvres déjà faites ce round. « Prendre l'avantage » et « Terrain » ouvrent le jet de Pilotage avec la bonne difficulté et la maniabilité.</li>
    <li><strong>Quand un artilleur tire</strong> : « Attaquer », choisissez le tireur, l'arme et la cible. Le résumé indique la difficulté et tout ce qui la modifie ; la fenêtre de jet habituelle s'ouvre avec la réserve prête. Après le jet, une carte dans le chat donne le calcul des dégâts avec les boutons <em>Appliquer</em> et <em>Jet de critique</em>.</li>
    <li><strong>Les autres postes</strong> : « Contrôle des dégâts », « Action d'équipage » (toute la table 7-7), « Réorienter ».</li>
    <li><strong>Les symboles</strong> : l'onglet <em>Aide-mémoire</em> liste ce qu'on peut acheter avec [AD], [TR], [TH] et [DE]. Appliquez les effets à la main (boutons − / + de vitesse, coque, stress ; bouton « Critique » ; « Collision »).</li>
    <li><strong>Fin du round</strong> : « Nouveau round » remet les compteurs à zéro et fait expirer les effets.</li>
    <li><strong>Fin du combat</strong> : « Fin de la rencontre » restaure les boucliers réorientés et efface les effets temporaires ; les dégâts et le stress restent sur les fiches.</li>
  </ol>
  <div class="sc-callout">Les cartes de chat et les jauges restent modifiables : en cas de désaccord ou de règle maison, le MJ corrige avec les boutons − / + et le jeu continue.</div>
</section>
`;
