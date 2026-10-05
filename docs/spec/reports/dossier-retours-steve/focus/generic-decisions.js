// Generic decisions G1 to G8: the eight owner decisions of the sentropic + engram
// convergence (SYNTHESE.md §8), brought into this dossier with a G prefix so that they never
// collide with the immo decisions D1 to D16. Decider: Fabien (owner). §6.7 summarises the
// convergence; each decision says which immo decisions it conditions.
const opt = (key, title, description, pros, cons) => ({ key, title, description, pros, cons });

export const GENERIC = [
  {
    key: 'G1', question: 'G1 — Terminologie et provenance du jeu de référence', recommended: 'c', dependsOn: [],
    intro: 'Le mot « oracle » désigne, en génie logiciel, le mécanisme qui rend le verdict d’un test, pas un jeu de réponses ; les quatre sièges de la convergence le rejettent comme nom d’objet (§6.7). '
      + 'Il faut un terme commun à immo, BPMN et aux paquets génériques avant d’écrire les contrats, et une façon de dire d’où viennent les étiquettes. '
      + 'Ce dossier applique déjà la recommandation : « jeu de référence » partout, avec l’attribut label_provenance (E = machine, « silver » ; C = un seul annotateur humain, Steve, « gold » en construction). '
      + 'Le renommage ne change aucune empreinte.',
    recommendation: '(c) : seul terme exact pour E comme pour C, aligné sur les usages établis (HF evaluate, spaCy, VIM) ; la provenance devient un attribut au lieu d’un mot dans le nom.',
    options: [
      opt('a', '(a) Garder « oracle » avec une définition locale', 'On garde le mot partout (glossaire, tables, scripts) et on le définit dans chaque dossier comme « jeu de réponses de référence ».',
        ['Aucun renommage de tables, de scripts ni de textes.', 'Terme déjà connu de l’équipe immo.'],
        ['Contredit le sens établi (verdict d’un test) : malentendus avec sentropic, engram et la littérature.', 'Ne dit rien de la provenance (machine ou humain).']),
      opt('b', '(b) « Gold standard » / « vérité terrain »', 'On nomme le jeu « gold standard » (EN) et « vérité terrain » (FR), pour E comme pour C.',
        ['Termes usuels en évaluation.', 'Faciles à comprendre.'],
        ['Faux pour E, construit par consensus de modèles (silver), et pour C pilote, un seul annotateur.', '« Vérité » unique critiquée (Aroyo et Welty 2015 ; IEEE 7014-2024).']),
      opt('c', '(c) « Jeu de référence » (ReferenceSet) + label_provenance', 'Objet ReferenceSet, versions figées ReferenceSetVersion, éléments ReferenceItem ; un attribut label_provenance ∈ {human_single, human_adjudicated, model_consensus, mixed}, d’où les libellés « référence validée (gold) » et « référence machine (silver) ».',
        ['Exact pour E (model_consensus) et pour C (human_single, puis human_adjudicated).', 'Aligné sur HF evaluate (references), spaCy (Example.reference) et le VIM.', 'La provenance sert directement à la règle de promotion (G6).'],
        ['Renommage dans le glossaire, les tables proposées et quelques scripts (oracle_eval.py, oracle_versions).', 'Nouveau vocabulaire à expliquer à l’équipe.']),
    ],
  },
  {
    key: 'G2', question: 'G2 — Porteurs et forme de l’annotation', recommended: 'b', dependsOn: ['G1'],
    intro: 'Les retours de Steve, ses annotations futures et les validations de l’équipe doivent vivre quelque part ; la même boucle existe déjà trois fois dans les domaines (immo E, brouillon C, BPMN d2d). '
      + 'Le module comments de sentropic ne convient pas à la validation : il édite en place et supprime physiquement (§6.0, §6.7). '
      + 'Il faut décider qui porte l’annotation et sous quelle forme, avant que D2 (modèle immo) puisse être tranchée. '
      + 'Concrètement : soit immo écrit ses tables, soit un paquet générique les fournit, avec ses tables dans le Postgres d’immo.',
    recommendation: '(b) : réemploi des cibles et des auteurs de comments et de l’IdP sentropic, sans casser la sémantique du commentaire ; les données restent dans la base de l’hôte. L’évaluation reste un module d’engram, indépendant du producteur.',
    options: [
      opt('a', '(a) Le domaine (six tables immo)', 'Chaque domaine écrit ses tables d’annotation : pour immo, les six tables de la version précédente du dossier.',
        ['Livrable vite, sans attendre un paquet.', 'Modèle sur mesure pour Steve.'],
        ['Réimplémentation : chaque domaine refait la boucle (« prevent each new app … from inventing a private model »).', 'Pas de mise en commun avec BPMN ni avec sentropic.']),
      opt('b', '(b) Paquet frère @sentropic/annotations', 'Un nouveau paquet sentropic porte annotations, révisions, validations, adjudications et cibles, avec un adaptateur Postgres (./pg) installé dans la base de l’hôte et un port vers son stockage objet ; comments reçoit seulement deux évolutions (tombstone, types ouverts déplacés vers le port hôte, sans changement d’UI).',
        ['Une seule implémentation pour immo, BPMN et sentropic.', 'Réemploi de CommentTarget, CommentAuthor et de l’IdP partagé.', 'Données dans la base de l’hôte (résidence des données respectée).'],
        ['Paquet à créer, avec une consommation réelle dans sentropic exigée dès L2.', 'Immo dépend de son calendrier (G7).']),
      opt('c', '(c) Étendre comments', 'On ajoute révisions, validations et statuts au module comments existant : un commentaire devient aussi une annotation validable.',
        ['Un seul module à connaître.', 'Pas de nouveau paquet.'],
        ['Casse la sémantique du commentaire : « résolu » n’est pas « validé ».', 'Les quatre sièges rejettent cette voie.']),
      opt('d', '(d) h2a ou track', 'Les annotations sont portées par h2a ou par track, à côté des décisions, dans leurs propres journaux.',
        ['Proche des outils de décision existants.', 'Pas de nouveau paquet à publier.'],
        ['Hors de leur rôle : track porte des décisions, pas des données métier.', 'Pas d’écran ni de cible métier dans ces outils.']),
      opt('e', '(e) Tout dans engram, en fichiers', 'Annotations et validations sont des fichiers versionnés dans le dépôt, lus par engram.',
        ['Simple pour un jeu figé.', 'Versionnage par git.'],
        ['Pas de saisie dans l’application ni de boucle de validation pour Steve.', 'Données personnelles dans un dépôt.']),
    ],
  },
  {
    key: 'G3', question: 'G3 — Sémantique de version et effacement', recommended: 'a', dependsOn: ['G2'],
    intro: 'Une annotation change : Steve corrige, l’équipe conteste, un retour est retiré. '
      + 'Il faut décider comment une modification est gardée, sur quoi porte une validation et comment on efface une donnée personnelle (Loi 25, décision O1 du dossier COLLAB : tombstone et rétention). '
      + 'Ce choix fixe ce que le jeu de référence peut citer : une révision précise, désignée par son empreinte. '
      + 'Il remplace, pour les annotations, la question posée par D4 sur la suppression (§6.7).',
    recommendation: '(a) : l’absence d’écrasement est garantie par construction, une validation reste attachée à ce qu’elle a validé, et l’effacement purge le corps en gardant l’empreinte.',
    options: [
      opt('a', '(a) Révisions immuables chaînées, validation liée au hash, tombstone', 'Chaque modification crée une révision immuable (content_hash, prev_content_hash) ; une validation porte sur une révision désignée par son hash ; le statut courant est calculé ; un effacement laisse un tombstone (corps purgé, hash gardé).',
        ['Aucune modification ne se perd ; l’historique se relit.', 'Une validation ne « glisse » jamais sur une version qu’elle n’a pas vue.', 'Compatible Loi 25 et décision O1.'],
        ['Plus de lignes stockées.', 'Calcul du statut à chaque lecture (ou vue matérialisée).']),
      opt('b', '(b) État modifiable + journal d’audit', 'L’annotation est modifiée en place ; un journal à part garde les changements, sans lien avec les validations.',
        ['Simple à lire : une ligne par annotation.', 'Proche des tables existantes (prospect_notes).'],
        ['Une validation peut porter sur un état qui a changé depuis.', 'Le journal et l’état peuvent diverger.']),
      opt('c', '(c) Journal pur (événements)', 'Seuls des événements sont stockés ; tout état se reconstruit en rejouant le journal.',
        ['Historique complet par construction.', 'Rejouable pour reconstruire un état passé.'],
        ['Lecture coûteuse pour l’application.', 'Effacement Loi 25 difficile dans un journal immuable.']),
    ],
  },
  {
    key: 'G4', question: 'G4 — Autorité de validation et rôles', recommended: 'a', dependsOn: ['G2'],
    intro: 'La boucle de validation demandée par l’owner (Steve annote, l’équipe ou le PO valide ou conteste, §6.3) suppose de dire qui a le droit de faire quoi. '
      + 'Sentropic ne connaît aujourd’hui aucun rôle de revue : seulement des rôles de workspace, de tenant et globaux (§6.7). '
      + 'Il faut décider comment ces rôles s’attribuent, ce que peut faire un agent (modèle, MCP) et qui décide d’un gel ou d’une promotion. '
      + 'D5 (compte de Steve) et D8 (cas contradictoires) en dépendent.',
    recommendation: '(a) : la compétence est liée au profil (Steve sur le ciblage, pas sur BPMN), les agents ne font que proposer, et seul un humain décide d’un gel ou d’une promotion ; une promotion exige une référence human_adjudicated.',
    options: [
      opt('a', '(a) Attributions par (workspace, profil), agents en proposition seulement', 'Chaque rôle (annotateur, validateur, adjudicateur, curateur, décideur) s’attribue pour un workspace et un profil ; un agent ou un connecteur MCP lit et propose, sans valider ; gel et promotion sont des actes humains.',
        ['Steve peut valider le ciblage sans droit sur d’autres domaines.', 'Les agents ne signent jamais (B2B2B).', 'Une promotion repose sur une référence humaine adjugée.'],
        ['Gestion d’attributions à construire dans sentropic.', 'Rôles à désigner par l’owner (voir §6.7).']),
      opt('b', '(b) Dérivées des rôles de workspace', 'Les rôles de workspace existants suffisent : un éditeur peut valider, un administrateur peut geler un jeu.',
        ['Aucune nouvelle notion de rôle.', 'Rien à construire dans sentropic.'],
        ['Mélange droit d’édition et compétence métier.', 'Un éditeur quelconque pourrait valider le ciblage de Steve.']),
      opt('c', '(c) Validation par la machine seule', 'Un modèle ou une règle valide automatiquement les annotations, sans intervention de l’équipe ni du PO.',
        ['Rapide, sans charge humaine.', 'Aucune attente de validation.'],
        ['Circularité : le jeu de référence noterait des modèles avec des étiquettes de modèles.', 'Contraire à la vision owner (validation par l’équipe ou le PO).']),
    ],
  },
  {
    key: 'G5', question: 'G5 — Scellement et stockage des jeux de référence', recommended: 'a', dependsOn: ['G1'],
    intro: 'Un jeu de référence n’a de valeur que si sa partie test n’a jamais servi à optimiser un prompt ; le pilote C l’a montré : son test aveugle est consommé et partiellement contaminé (§9.7). '
      + 'Il faut décider comment la partie test est protégée et où les jeux sont stockés, sachant que le dépôt radar est public et qu’un agent en ligne de commande peut lire les fichiers. '
      + 'D10 (jeu de référence #783) et D13 (seuil de bascule) en dépendent.',
    recommendation: '(a) en v1 (garde, sceau inscrit dans track avant tout appel de modèle, journal d’exposition, stockage privé) ; (b) ou (c) obligatoire pour tout jeu qui fonde une bascule (D13). Stockage : objet privé de l’hôte, derrière un port du paquet ; manifestes publics.',
    options: [
      opt('a', '(a) Procédural : garde, sceau track, journal d’exposition', 'Le runner refuse de passer deux fois sur le test ; l’engagement de contenu est inscrit dans track avant tout appel de modèle ; chaque exposition est journalisée ; les éléments sont dans un stockage objet privé, seuls manifestes et empreintes sont publics.',
        ['Couvre les défauts observés sur le pilote C.', 'Réalisable tout de suite.'],
        ['Repose sur la discipline : un agent peut encore lire un fichier local.', 'Insuffisant seul pour une bascule (D13).']),
      opt('b', '(b) Chiffrement, clé chez un gardien', 'La partie test est chiffrée ; la clé est détenue par un gardien qui ne l’ouvre que pour la passe unique.',
        ['Protection technique réelle.', 'Résiste à la lecture des fichiers par un agent.'],
        ['Gestion de clés et de rôles à mettre en place.', 'Passe de notation plus lourde.']),
      opt('c', '(c) Service de notation', 'Le test ne quitte jamais un service qui reçoit les prédictions et ne rend que les scores.',
        ['Aucune exposition des attendus.', 'Une seule passe par candidat, garantie par le service.'],
        ['Service à construire et à exploiter.', 'Diagnostic d’erreurs plus difficile.']),
    ],
  },
  {
    key: 'G6', question: 'G6 — Règle et porteur de la promotion', recommended: 'a', dependsOn: ['G4', 'G5'],
    intro: 'Promouvoir un candidat (prompt, modèle, effort) en production doit reposer sur une preuve mesurée sur le jeu figé, pas sur une impression. '
      + 'Il faut décider si la règle est commune aux domaines, qui la décide et qui l’applique. '
      + 'La règle immo de bascule B → C (D13) en est une instance, et D11 (benchmark #782) en fournit les preuves (§6.7).',
    recommendation: '(a) : gabarit générique préenregistré, instancié par domaine ; décision dans track, attestée par h2a et jamais par l’API sentropic ; signataire humain authentifié par l’IdP ; garde de production dans engram sur l’empreinte exacte.',
    options: [
      opt('a', '(a) Gabarit générique préenregistré, décision track, garde engram', 'Critères écrits avant la passe test (contraintes critiques, non-infériorité avec marge, pas de régression par classe, coût) ; décision track à au moins deux options dont « garder la production » ; la production refuse toute empreinte sans « go ».',
        ['Comparabilité entre domaines.', 'Preuve liée au tuple exact promu.', 'Retour arrière par une nouvelle décision.'],
        ['Demandes à track (preuve d’évaluation) et à h2a (voie de signature).', 'Discipline de préenregistrement.']),
      opt('b', '(b) Règle libre par domaine', 'Chaque domaine écrit sa règle de promotion et son circuit de décision, sans gabarit commun.',
        ['Souplesse.', 'Aucun gabarit commun à négocier.'],
        ['Pas de comparabilité ; règles réécrites après coup.', 'Pas de garde commune en production.']),
      opt('c', '(c) Recette seule', 'La promotion se décide sur une recette humaine, sans mesure chiffrée sur le jeu de référence.',
        ['Rapide.', 'Aucun outillage de preuve.'],
        ['Aucune garantie de non-régression.', 'Le jeu de référence ne sert plus à décider.']),
      opt('d', '(d) Seuil automatique', 'Un candidat qui dépasse un seuil fixé à l’avance est promu automatiquement, sans décision humaine.',
        ['Aucune attente.', 'Aucune charge de décision.'],
        ['Aucun humain responsable de la mise en production.', 'Risque de promouvoir sur un test exposé.']),
    ],
  },
  {
    key: 'G7', question: 'G7 — Séquencement, tables immo et pilote C', recommended: 'b', dependsOn: ['G2'],
    intro: 'Immo pourrait construire ses six tables tout de suite, puis migrer ; ou attendre les paquets génériques et en être le premier adoptant. '
      + 'La convergence recommande de ne pas construire les tables immo et d’ordonner le travail en lots L0 à L4 : contrats, parité des évaluateurs (avec un diagramme BPMN en recette), @sentropic/annotations avec une consommation réelle dans sentropic, jeu de référence C v2, boucle BPMN. '
      + 'Le pilote C actuel devient une version v0 exploratoire, jamais rescellée ; C v2 prend les 51 villes déjà vues en développement et les 52 suivantes en test aveugle. '
      + 'D2 (modèle immo) et D15 (séquencement immo) en dépendent (§6.7).',
    recommendation: '(b) : pas de double travail, les besoins de Steve deviennent la recette du générique, et le délai est borné par les lots.',
    options: [
      opt('a', '(a) Immo construit ses tables, puis migre', 'Immo livre ses six tables (lot L1 immo), puis les migre vers les paquets génériques quand ils existent.',
        ['Valeur immédiate pour Steve.', 'Aucune dépendance aux autres dépôts.'],
        ['Double travail et migration de données.', 'Deux modèles pendant la transition.']),
      opt('b', '(b) Générique d’abord, immo premier adoptant, délai borné', 'L0 contrats ; L1 parité des évaluateurs (renotation sans appel de modèle) + un diagramme BPMN en recette ; L2 @sentropic/annotations et import, consommé dans sentropic ; L3 jeu de référence C v2 (52 villes en test) ; L4 boucle BPMN.',
        ['Une seule implémentation.', 'Les besoins de Steve servent de recette.', 'Pilote C reclassé en v0 exploratoire, sans être rescellé.'],
        ['Steve attend L2 pour annoter dans l’application.', 'Dépend de la coordination entre trois dépôts.']),
      opt('c', '(c) Attendre sans borne', 'Immo n’engage rien tant que les paquets génériques ne sont pas livrés, sans date convenue.',
        ['Aucun travail immédiat.', 'Aucune dette de transition.'],
        ['Aucun calendrier pour Steve.', 'La boucle reste refaite à la main dans les domaines.']),
    ],
  },
  {
    key: 'G8', question: 'G8 — BPMN : producteur, code d2d, constructeur silver', recommended: 'a', dependsOn: ['G6'],
    intro: 'BPMN est le second domaine qui doit valider le contrat générique : des diagrammes de processus produits par un outil et comparés à des diagrammes validés. '
      + 'Il faut décider si l’on garde le producteur actuel en n’adoptant que l’évaluation, et si le constructeur de références machine (silver) devient générique. '
      + 'Cette décision n’a pas d’effet direct sur immo ; elle conditionne la recette « deux profils sur la même implémentation » de G7 (§6.7).',
    recommendation: '(a) maintenant, (b) sur mesure sur le même jeu ; constructeur silver générique seulement si BPMN le confirme comme second cas. La propriété du code d2d est à clarifier avant tout réemploi.',
    options: [
      opt('a', '(a) Garder le producteur actuel, adopter l’évaluation', 'Le producteur BPMN actuel (d2d ou F0) reste ; engram apporte seulement l’évaluateur de graphe et le protocole.',
        ['Évaluation indépendante du producteur.', 'Peu de changement côté BPMN.'],
        ['Propriété du code d2d non vérifiée (dépôt Airbus).', 'Le script Python oracle_eval.py est à réécrire en Node/TS.']),
      opt('b', '(b) Extraction BPMN par engram', 'Engram produit lui-même les diagrammes BPMN à partir des textes source, puis les évalue.',
        ['Une seule chaîne de production et d’évaluation.', 'Producteur sous contrôle d’engram.'],
        ['Paires texte → BPMN encore à constituer.', 'Gros chantier avant toute mesure.']),
      opt('c', '(c) Reporter BPMN', 'Le contrat générique est qualifié sur immo seul ; BPMN viendra plus tard, sans recette commune.',
        ['Moins de coordination.', 'Livraison immo plus directe.'],
        ['Pas de preuve que le contrat est générique.', 'Risque de modèle taillé pour immo.']),
    ],
  },
];
