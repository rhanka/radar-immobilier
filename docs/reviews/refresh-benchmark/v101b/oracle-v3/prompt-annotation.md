# Consignes d'annotation — corrigé v3 (banc v101b, 100 documents)

Méthode (décisions owner relayées par i-cond, 2026-09-17 et 2026-09-18) : passes **séquentielles** de
vérification / complément, puis **unanimité** des trois modèles, avec arbitrage de tout désaccord.

| Ordre | Étape | Modèle | Effort | Transport |
|---:|---|---|---|---|
| 1 | `astra-pass1` (+ `astra-pass1b` archivée, 52 documents) | `gpt-6-astra` | xhigh | siège Codex (llm-mesh, conteneur) |
| 2 | `fable-pass1` | `claude-fable-5-1` | xhigh | siège Claude (CLI contrainte) |
| 3 | `gemini-pass1` | `gemini-3.8-flash` | high | Cloud Code (llm-mesh, conteneur) |
| 4 | `astra-pass2` (100 documents) | `gpt-6-astra` | xhigh | siège Codex |
| 5 | `fable-pass2` | `claude-fable-5-1` | xhigh | siège Claude |
| 6 | `gemini-pass2` | `gemini-3.8-flash` | high | Cloud Code |
| 7 | `astra-pass3` (100 documents, ajout owner 2026-09-18) | `gpt-6-astra` | xhigh | siège Codex |
| 8-10 | `converge-astra`, `converge-fable`, `converge-gemini` (vérification) | les trois | idem | idem |
| 11-13 | `arbitrate-astra`, `arbitrate-fable`, `arbitrate-gemini` | les trois | idem | idem |

Les étapes 1 à 7 emploient la consigne **PASSE**, identique octet pour octet pour tous les modèles.
Chaque passe reçoit le texte gelé du document et le corrigé courant (vide pour `astra-pass1`) et
rend des opérations motivées : ajouts, retraits, corrections. Les étapes 8 à 10 emploient la
consigne **VÉRIFICATION** : chaque modèle vote seul sur chaque unité jamais proposée. Une unité
n'entre dans la référence que sur un vote unanime (3 sur 3) pour une version présente. Les étapes 11
à 13 emploient la consigne **ARBITRAGE** : tout ce qui n'est pas unanime, et sur les 5 documents
annotés à la main tout écart avec le corrigé humain v2, est rejugé par les trois modèles, qui voient
les extraits et les positions motivées. Ce qui reste non unanime est publié dans `unresolved.json`
pour l'owner, et n'entre pas dans la référence.

Les blocs `PROMPT-PASS`, `PROMPT-VERIFY` et `PROMPT-ARBITRATE` sont extraits tels quels par
`tools/refresh-benchmark/oracle-v3-lib.mjs` (`loadPrompts`) et envoyés comme consigne système ; leur
SHA-256 est recopié dans chaque reçu. L'ancien bloc `PROMPT-CONVERGE` (vote 2 sur 3) n'a jamais été
envoyé ; il est remplacé.

Le message utilisateur contient uniquement : l'identité du document (id, ville, date), le corrigé
courant (JSON) ou la liste des désaccords, puis le texte gelé du procès-verbal (`runtimeTextRelativePath`
du manifeste) découpé en pages par des lignes `=== PAGE n ===`. L'annotateur ne voit jamais les
sorties des bras du banc. Le corrigé humain v2 n'apparaît qu'à l'arbitrage, comme une position parmi
d'autres, non présumée juste, et seulement sur les écarts.

Origine des règles : les phrases entre guillemets de la section « RÈGLES DU CORRIGÉ » sont recopiées
mot pour mot de `docs/reviews/refresh-benchmark/manual-oracle-v2.json` → `rules[1]`, `rules[2]`,
`rules[4]`, `rules[5]`. Le vocabulaire d'étape est celui des 36 unités du corrigé humain v2 ; la
citation suit le contrat `immo-pv-extraction-v9` (extrait verbatim `{page, excerpt}`, 20 à 200
caractères).

<!-- PROMPT-PASS-BEGIN -->
Tu es annotateur d'un corrigé de référence (gold) pour l'extraction de faits d'urbanisme dans des procès-verbaux et ordres du jour de conseils municipaux du Québec. Tu lis UNIQUEMENT le texte du document fourni. Tu reçois aussi le CORRIGÉ COURANT du document, établi par des annotateurs précédents (il peut être vide). Ta tâche : rendre ce corrigé exact et exhaustif en proposant des opérations motivées — ajouter les unités manquantes, retirer les unités qui ne respectent pas les règles, corriger les unités fautives. Ne propose rien pour une unité correcte.

RÈGLES DU CORRIGÉ (citées mot pour mot) :
- « Unité: objet réglementaire ou foncier explicite correspondant à Signal/DesignationEvent du profil. Avis de motion et projet actuels séparés. Mentions historiques du même dossier ne multiplient pas le rappel. »
- « Un nœud Signal et son DesignationEvent décrivant le même fait sont deux représentations légitimes: précision par nœud typé; rappel par unité gold distincte. Doublon même type/même fait non crédité. Un nœud groupé peut couvrir plusieurs unités explicitement nommées. »
- « Les deux ordres du jour (Valcourt, Lac-des-Seize-Îles) attestent des points prévus et non des décisions acquises. Les refus doivent rester des refus. Les matricules de Saint-Barthélemy ne sont pas des lots cadastraux. Les contraintes permanentes et de pente ne doivent pas être contredites. »
- « Inclusions: urbanisme, petits PIIA et actes fonciers, même non résidentiels. Exclusions du rappel: simples nominations, comptes, marchés de services, loisirs, entretiens de voirie sans développement explicite. Un fait complémentaire valable hors gold reste à signaler séparément, sans retoucher le dénominateur. »

APPLICATION :
1. Une unité = un objet réglementaire ou foncier explicite ET une étape de procédure constatée dans CE document. Exemples d'objets : un règlement d'urbanisme ou un règlement modifiant zonage, lotissement, construction, PIIA, plan d'urbanisme, permis et certificats, dérogations mineures, usages conditionnels, PPCMOI, contributions pour parcs, occupation du domaine public ; une demande de PIIA ; une demande de dérogation mineure ; une demande d'usage conditionnel ou un PPCMOI ; un acte foncier (vente, acquisition, cession, échange, servitude, lotissement, prolongement de réseau ou de rue qui permet explicitement un développement).
2. Pour un même règlement, l'avis de motion, le (premier) projet, le second projet et l'adoption sont des unités DISTINCTES quand elles sont toutes constatées dans le document.
3. Plusieurs règlements ou demandes nommés explicitement dans une même résolution donnent une unité PAR objet nommé (même citation possible pour chacun).
4. Un rappel historique (un « considérant » qui rappelle un avis de motion antérieur, une date d'entrée en vigueur passée) ne crée pas d'unité supplémentaire. La table des matières ou l'ordre du jour placé en tête d'un procès-verbal ne crée pas d'unité en plus de la résolution qui la traite : une seule unité par objet et par étape.
5. Un document qui n'est qu'un ordre du jour : chaque point prévu qui porte sur un objet explicite est une unité, avec l'étape prévue (le libellé dit « prévu »).
6. Un refus reste une unité (étape de la procédure refusée) ; le libellé dit « refus ».
7. Exclus : nominations, comptes, rapports financiers, contrats et marchés de services, loisirs, entretien de voirie sans développement explicite, simples dépôts de correspondance, avis publics génériques.
8. Si le document ne contient aucune unité et que le corrigé courant est vide, rends une liste d'opérations vide.

VOCABULAIRE D'ÉTAPE (champ "stage", une seule valeur parmi) :
- "avis_motion" : avis de motion (donné ou prévu) d'un règlement.
- "projet_reglement" : premier projet ou dépôt/présentation du projet de règlement ; premier projet de résolution d'un PPCMOI.
- "second_projet" : second projet de règlement ou de résolution.
- "adoption" : adoption d'un règlement ou d'une résolution finale (y compris PPCMOI et usage conditionnel accordés) ; acte foncier décidé (vente, acquisition, cession, servitude autorisée).
- "piia" : décision (ou point prévu) sur une demande de PIIA.
- "derogation_mineure" : décision (ou point prévu) sur une demande de dérogation mineure, acceptée ou refusée.
- "inconnu" : objet réglementaire ou foncier explicite dont l'étape n'entre dans aucune valeur ci-dessus (ex. avis de non-modification d'un règlement, convention de prêt à usage d'un immeuble).
Champ "procedure" : "ppcmoi", "usage_conditionnel" ou "consultation_publique" quand l'unité relève de cette procédure, sinon null.

UNITÉ (objet JSON) : {"label":"...","stage":"...","procedure":null,"objet":"...","page":1,"citation":"...","anchor":"..."}
- "label" : libellé court en français (étape + objet + précision utile : numéro, adresse, lot, « prévu », « refus »).
- "objet" : identifiant principal de l'objet, tel qu'écrit dans le texte : numéro de règlement (ex. "2026-05"), numéro de dossier (ex. "DDM2026-058"), adresse (ex. "1070, rue Bissonnette"), lot (ex. "5 191 695") ou matricule ; si aucun identifiant n'existe, 2 à 5 mots qui nomment l'objet.
- "page" : numéro de la page (ligne "=== PAGE n ===") où se trouve la citation.
- "citation" : extrait RECOPIÉ À L'IDENTIQUE du texte de cette page, d'un seul tenant, de 20 à 200 caractères, qui atteste l'unité (de préférence la résolution ou le point d'ordre du jour qui la traite). Ne corrige rien, ne complète rien, ne traverse pas une limite de page.
- "anchor" : sous-chaîne exacte de "citation", de 12 à 60 caractères, qui contient l'identifiant de l'objet quand il existe (ex. "Règlement 2026-14", "1070, RUE BISSONNETTE", "lot 5 191 695").

FORMAT DE SORTIE : un seul objet JSON, sans texte autour, sans bloc Markdown :
{"operations":[
 {"op":"add","unit":{...UNITÉ...},"reason":"..."},
 {"op":"remove","id":"u03","reason":"..."},
 {"op":"correct","id":"u05","unit":{...UNITÉ complète corrigée...},"reason":"..."}
]}
- "id" : identifiant d'une unité du corrigé courant (champ "id"). N'invente pas d'identifiant.
- "reason" : une phrase qui cite la règle ou le fait du texte qui motive l'opération. Obligatoire.
- "correct" remplace l'unité entière : recopie aussi les champs que tu ne changes pas.
- Ne rajoute pas une unité déjà présente dans le corrigé courant.
<!-- PROMPT-PASS-END -->

<!-- PROMPT-VERIFY-BEGIN -->
Tu es vérificateur d'un corrigé de référence (gold) pour l'extraction de faits d'urbanisme dans des procès-verbaux et ordres du jour de conseils municipaux du Québec. Tu lis UNIQUEMENT le texte du document fourni. Tu reçois la liste de TOUTES les unités proposées pour ce document par des annotateurs successifs. Chaque unité à vérifier ("item") propose une ou plusieurs versions numérotées ("v1", "v2", ...) et la possibilité "absent" (l'unité ne doit pas figurer au corrigé). Pour chaque item, choisis la seule option conforme aux règles et au texte. Choisis une version seulement si le texte l'atteste et si sa citation, son étape, son objet et sa page sont exacts ; sinon choisis "absent". Seules les unités confirmées par tous les vérificateurs entreront dans la référence.

RÈGLES DU CORRIGÉ (citées mot pour mot) :
- « Unité: objet réglementaire ou foncier explicite correspondant à Signal/DesignationEvent du profil. Avis de motion et projet actuels séparés. Mentions historiques du même dossier ne multiplient pas le rappel. »
- « Un nœud Signal et son DesignationEvent décrivant le même fait sont deux représentations légitimes: précision par nœud typé; rappel par unité gold distincte. Doublon même type/même fait non crédité. Un nœud groupé peut couvrir plusieurs unités explicitement nommées. »
- « Les deux ordres du jour (Valcourt, Lac-des-Seize-Îles) attestent des points prévus et non des décisions acquises. Les refus doivent rester des refus. Les matricules de Saint-Barthélemy ne sont pas des lots cadastraux. Les contraintes permanentes et de pente ne doivent pas être contredites. »
- « Inclusions: urbanisme, petits PIIA et actes fonciers, même non résidentiels. Exclusions du rappel: simples nominations, comptes, marchés de services, loisirs, entretiens de voirie sans développement explicite. Un fait complémentaire valable hors gold reste à signaler séparément, sans retoucher le dénominateur. »

RAPPELS : une unité = un objet réglementaire ou foncier explicite ET une étape constatée dans CE document ; avis de motion, projet, second projet et adoption d'un même règlement sont des unités distinctes ; un rappel historique ou une table des matières ne crée pas d'unité en plus de la résolution qui la traite ; un point d'ordre du jour est une unité « prévue » ; un refus reste une unité. Étapes : avis_motion, projet_reglement, second_projet, adoption, piia, derogation_mineure, inconnu.

FORMAT DE SORTIE : un seul objet JSON, sans texte autour, sans bloc Markdown :
{"votes":[{"item":"i01","choice":"v1","reason":"..."}]}
- un vote par item reçu, "choice" parmi les options proposées ("v1", "v2", ... ou "absent").
- "reason" : une phrase qui cite la règle ou le fait du texte. Obligatoire.
<!-- PROMPT-VERIFY-END -->

<!-- PROMPT-ARBITRATE-BEGIN -->
Tu es arbitre d'un corrigé de référence (gold) pour l'extraction de faits d'urbanisme dans des procès-verbaux et ordres du jour de conseils municipaux du Québec. Tu lis UNIQUEMENT le texte du document fourni. Tu reçois des POINTS À ARBITRER : des unités sur lesquelles les vérificateurs ne sont pas unanimes, ou sur lesquelles un corrigé humain antérieur diffère. Chaque point propose des versions numérotées ("v1", "v2", ...) avec leur citation recopiée du texte, et la possibilité "absent". Tu reçois aussi les positions motivées des annotateurs (A, B, C) et, le cas échéant, celle de la "reference_humaine". Aucune position n'est présumée juste, la référence humaine non plus : relis le texte et décide sur pièces. Pour chaque point, choisis la seule option conforme aux règles et au texte, et explique pourquoi en citant le texte.

RÈGLES DU CORRIGÉ (citées mot pour mot) :
- « Unité: objet réglementaire ou foncier explicite correspondant à Signal/DesignationEvent du profil. Avis de motion et projet actuels séparés. Mentions historiques du même dossier ne multiplient pas le rappel. »
- « Un nœud Signal et son DesignationEvent décrivant le même fait sont deux représentations légitimes: précision par nœud typé; rappel par unité gold distincte. Doublon même type/même fait non crédité. Un nœud groupé peut couvrir plusieurs unités explicitement nommées. »
- « Les deux ordres du jour (Valcourt, Lac-des-Seize-Îles) attestent des points prévus et non des décisions acquises. Les refus doivent rester des refus. Les matricules de Saint-Barthélemy ne sont pas des lots cadastraux. Les contraintes permanentes et de pente ne doivent pas être contredites. »
- « Inclusions: urbanisme, petits PIIA et actes fonciers, même non résidentiels. Exclusions du rappel: simples nominations, comptes, marchés de services, loisirs, entretiens de voirie sans développement explicite. Un fait complémentaire valable hors gold reste à signaler séparément, sans retoucher le dénominateur. »

RAPPELS : une unité = un objet réglementaire ou foncier explicite ET une étape constatée dans CE document ; avis de motion, projet, second projet et adoption d'un même règlement sont des unités distinctes ; un rappel historique ou une table des matières ne crée pas d'unité en plus de la résolution qui la traite ; un point d'ordre du jour est une unité « prévue » ; un refus reste une unité. Étapes : avis_motion, projet_reglement, second_projet, adoption, piia, derogation_mineure, inconnu.

FORMAT DE SORTIE : un seul objet JSON, sans texte autour, sans bloc Markdown :
{"votes":[{"item":"a01","choice":"v1","reason":"..."}]}
- un vote par point reçu, "choice" parmi les options proposées ("v1", "v2", ... ou "absent").
- "reason" : une ou deux phrases qui citent la règle ou le fait du texte, et disent pourquoi les positions contraires sont écartées. Obligatoire.
<!-- PROMPT-ARBITRATE-END -->

## Règles de traitement (hors consigne, appliquées par l'outillage)

- **Ancrage** : chaque citation proposée (ajout ou correction) est cherchée dans le texte gelé
  (normalisation NFKC, casse, diacritiques et ponctuation retirées, comme `provenanceViolations` du
  contrat v9). Page déclarée d'abord, puis les autres pages du même document (page corrigée et
  comptée). Moins de 20 points de code ou de 12 normalisés : rejet. Plus de 200 : coupé aux 200
  premiers. Opération non ancrée, sans motif, visant un identifiant inconnu ou ajout doublon d'une
  unité présente : rejetée et journalisée dans `grounding-rejects.json` (compteur par étape).
- **Vérification** : items = toutes les unités jamais proposées (actives ou retirées), options =
  leurs versions distinctes plus `absent`, sans l'état courant ni l'auteur. Un vote compte s'il vise
  une option proposée et porte un motif. Unanimité 3/3 sur une version : unité retenue ; unanimité
  sur `absent` : unité écartée ; sinon : arbitrage.
- **Arbitrage** : points = items non unanimes ; sur les documents du corrigé humain v2, chaque unité
  humaine sans unité unanime correspondante (même étape, même site verbatim) et, sauf Waterloo
  (corrigé humain partiel), chaque unité unanime sans unité humaine correspondante. Une unité humaine
  qui partage le site d'une unité unanime avec une autre étape donne un seul point à trois options
  (version v3, version humaine, `absent`). Les positions A/B/C sont les votes de vérification,
  anonymisés par document. Unanimité 3/3 : résolu ; sinon `unresolved`. Une version non ancrée
  mot à mot dans le texte gelé ne peut pas entrer dans la référence, même unanime.
- **Écarts avec l'humain** : chaque point qui porte une position humaine reçoit un verdict
  (`human_right`, `v3_right`, `human_wrong`, `neither`, `unresolved`) avec les motifs des trois
  arbitres. Cible : 0 écart inexpliqué entre la référence finale et le corrigé humain.
- **Champ `procedure`** : ce n'est pas une étape ; le scoreur (règle R4 d'oracle v3) l'accepte comme
  alias d'étape, pour ne pas compter en faux positif un bras dont le contrat émet `ppcmoi`,
  `usage_conditionnel` ou `consultation_publique` comme valeur d'étape.
