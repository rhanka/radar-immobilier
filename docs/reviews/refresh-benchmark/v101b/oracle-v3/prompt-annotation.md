# Consignes d'annotation — corrigé v3 (banc v101b, 100 documents)

Méthode (décision owner relayée par i-cond, 2026-09-17) : consensus **séquentiel**, pas un vote.

| Ordre | Étape | Modèle | Effort | Transport |
|---:|---|---|---|---|
| 1 | `astra-pass1` | `gpt-6-astra` | xhigh | siège Codex (llm-mesh, conteneur) |
| 2 | `astra-pass2` | `gpt-6-astra` | xhigh | siège Codex |
| 3 | `fable-pass1` | `claude-fable-5-1` | xhigh | siège Claude (CLI contrainte) |
| 4 | `fable-pass2` | `claude-fable-5-1` | xhigh | siège Claude |
| 5 | `gemini-pass1` | `gemini-3.8-flash` | high | Cloud Code (llm-mesh, conteneur) |
| 6 | `gemini-pass2` | `gemini-3.8-flash` | high | Cloud Code |
| 7-9 | `converge-astra`, `converge-fable`, `converge-gemini` | les trois | idem | idem |

Les étapes 1 à 6 emploient la consigne **PASSE**, identique octet pour octet pour tous les modèles.
Chaque passe reçoit le texte gelé du document et le corrigé courant (vide pour `astra-pass1`) et
rend des opérations motivées : ajouts, retraits, corrections. Les étapes 7 à 9 emploient la
consigne **CONVERGENCE** : chaque modèle relit le corrigé final et vote, indépendamment des deux
autres, sur chaque désaccord ; la majorité (2 sur 3) tranche.

Les blocs entre `PROMPT-PASS-BEGIN`/`PROMPT-PASS-END` et `PROMPT-CONVERGE-BEGIN`/`PROMPT-CONVERGE-END`
sont extraits tels quels par `tools/refresh-benchmark/oracle-v3-lib.mjs` (`loadPrompts`) et envoyés
comme consigne système ; leur SHA-256 est recopié dans chaque reçu.

Le message utilisateur contient uniquement : l'identité du document (id, ville, date), le corrigé
courant (JSON) ou la liste des désaccords, puis le texte gelé du procès-verbal (`runtimeTextRelativePath`
du manifeste) découpé en pages par des lignes `=== PAGE n ===`. L'annotateur ne voit jamais les
sorties des bras du banc ni le corrigé humain v2 (sinon le corrigé serait circulaire).

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

<!-- PROMPT-CONVERGE-BEGIN -->
Tu es arbitre d'un corrigé de référence (gold) pour l'extraction de faits d'urbanisme dans des procès-verbaux et ordres du jour de conseils municipaux du Québec. Tu lis UNIQUEMENT le texte du document fourni. Tu reçois une liste de DÉSACCORDS entre annotateurs successifs. Chaque désaccord propose des versions numérotées d'une unité ("v1", "v2", ...) et la possibilité "absent" (l'unité ne doit pas figurer au corrigé). Pour chaque désaccord, choisis la seule option conforme aux règles et au texte.

RÈGLES DU CORRIGÉ (citées mot pour mot) :
- « Unité: objet réglementaire ou foncier explicite correspondant à Signal/DesignationEvent du profil. Avis de motion et projet actuels séparés. Mentions historiques du même dossier ne multiplient pas le rappel. »
- « Un nœud Signal et son DesignationEvent décrivant le même fait sont deux représentations légitimes: précision par nœud typé; rappel par unité gold distincte. Doublon même type/même fait non crédité. Un nœud groupé peut couvrir plusieurs unités explicitement nommées. »
- « Les deux ordres du jour (Valcourt, Lac-des-Seize-Îles) attestent des points prévus et non des décisions acquises. Les refus doivent rester des refus. Les matricules de Saint-Barthélemy ne sont pas des lots cadastraux. Les contraintes permanentes et de pente ne doivent pas être contredites. »
- « Inclusions: urbanisme, petits PIIA et actes fonciers, même non résidentiels. Exclusions du rappel: simples nominations, comptes, marchés de services, loisirs, entretiens de voirie sans développement explicite. Un fait complémentaire valable hors gold reste à signaler séparément, sans retoucher le dénominateur. »

RAPPELS : une unité = un objet réglementaire ou foncier explicite ET une étape constatée dans CE document ; avis de motion, projet, second projet et adoption d'un même règlement sont des unités distinctes ; un rappel historique ou une table des matières ne crée pas d'unité en plus de la résolution qui la traite ; un point d'ordre du jour est une unité « prévue » ; un refus reste une unité. Étapes : avis_motion, projet_reglement, second_projet, adoption, piia, derogation_mineure, inconnu.

FORMAT DE SORTIE : un seul objet JSON, sans texte autour, sans bloc Markdown :
{"votes":[{"dispute":"d01","choice":"v1","reason":"..."}]}
- un vote par désaccord reçu, "choice" parmi les options proposées ("v1", "v2", ... ou "absent").
- "reason" : une phrase qui cite la règle ou le fait du texte. Obligatoire.
<!-- PROMPT-CONVERGE-END -->

## Règles de traitement (hors consigne, appliquées par l'outillage)

- **Ancrage** : chaque citation proposée (ajout ou correction) est cherchée dans le texte gelé
  (normalisation NFKC, casse, diacritiques et ponctuation retirées, comme `provenanceViolations` du
  contrat v9). Page déclarée d'abord, puis les autres pages du même document (page corrigée et
  comptée). Moins de 20 points de code ou de 12 normalisés : rejet. Plus de 200 : coupé aux 200
  premiers. Opération non ancrée, sans motif, visant un identifiant inconnu ou ajout doublon d'une
  unité présente : rejetée et journalisée dans `grounding-rejects.json` (compteur par étape).
- **Désaccord** : une unité est en désaccord si une passe l'a retirée ou corrigée après qu'une autre
  l'a posée. Options : chaque version distincte qu'elle a eue, plus `absent`. Une unité jamais
  contestée par les passes suivantes est acceptée tacitement (chaque passe a vu le corrigé courant).
- **Convergence** : 3 votes indépendants ; l'option qui en recueille au moins 2 l'emporte. Sans
  majorité (3 choix différents) ou vote manquant empêchant la majorité, l'état après `gemini-pass2`
  est gardé et le désaccord est publié `unresolved` dans `disputed.json`.
- **Champ `procedure`** : ce n'est pas une étape ; le scoreur (règle R4 d'oracle v3) l'accepte comme
  alias d'étape, pour ne pas compter en faux positif un bras dont le contrat émet `ppcmoi`,
  `usage_conditionnel` ou `consultation_publique` comme valeur d'étape.
