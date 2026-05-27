J'ai lu les 4 fichiers et recalculé l'arithmétique. Voici la critique.

---

# Relecture critique — ÉV1 Socle (states + scoring)

## 1. CALIBRATION — l'arithmétique est juste, mais l'honnêteté est sur-vendue

**Recalcul (poids renormalisés /0.85 : pot 0.3529 · risque 0.2353 · timing 0.2353 · fais 0.1765) :**
- **H-609-4** (4/3/3/2) = 1.4118+0.7059+0.7059+0.3529 = **3.176 → 3.18 ✓**
- **U-521** (4/2/4/3) = 1.4118+0.4706+0.9412+0.5294 = **3.353 → 3.35 ✓**
- **H-143** (3/1/4/2) = 1.0588+0.2353+0.9412+0.3529 = **2.588 → 2.59 ✓**

Les trois tombent exactement. J'ai aussi revérifié le naïf 5-axes (marché=3) : 3.15 / 3.30 / 2.65 — conforme au `scoreGlobal` du fichier pilotes (l.293/569/835). **Arithmétique : RAS.**

**Mais deux problèmes de fond :**

**(a) La renormalisation n'est PAS conservatrice — c'est une imputation par la moyenne.** Renormaliser sur les axes disponibles revient mathématiquement à imputer à l'axe manquant *la moyenne pondérée des axes connus*. Conséquence factuelle ici : retirer marché=3 fait **monter** 2 scores sur 3 (3.15→3.18, 3.30→3.35) et baisser le 3ᵉ (2.65→2.59). La note §5 (l.292-295) dit benoîtement « happened to be near the mean » mais masque la direction : pour H-609-4/U-521, le score *partiel honnête* est **supérieur** au naïf. Cela contredit frontalement le récit §3.1/l.118-119 (« usually more modest once constraints integrated »). Le cap bloque l'engagement, donc la conséquence opérationnelle est saine — mais **le NOMBRE affiché est gonflé**, pas « plus modeste ». À assumer noir sur blanc.

**(b) Le biais d'exclure tout l'axe marché est réel et incohérent avec le traitement du risque.** Le marché a des proxies **factuels** (MRC +22 %, vacance 0,1 %, Vivaxcès 284 u. — l.233/520) qui crient « marché tendu » (niveau 4-5 régional). On les jette en « contexte/confiance » et on impute marché ≈ 3.18 par renormalisation. **Or pour le risque, la spec fait l'inverse** : H-609-4 a BDZI=0 (fait) + GRHQ ras (fait) + CPTAQ A-939 *non confirmé* (hypothèse) → scoré **risque=3 available, confidence:low**. Même structure de preuve (du factuel macro + une pièce précise manquante), **deux traitements opposés** : risque = available/low-conf, marché = non-disponible/exclu. Cette asymétrie est exactement ce qui propulse les scores via renormalisation. **Préco : marché « available, confidence:low » niveau 3 (sur proxies macro) serait plus honnête que l'exclusion** — et utiliserait l'enveloppe de confiance (§3.5) construite pour ça. À défaut, justifier explicitement pourquoi le marché mérite l'exclusion binaire et pas le risque.

## 2. ALGORITHME non-disponible (§3.4) — sain en intention, fragile en code

- **Cap binaire indifférent au poids/à l'axe.** Le code l.238 (`cap = partial ? "qualifier-avec-expert" : ...`) déclenche sur *n'importe quel* axe non-disponible. Marché (15 %, le plus faible) bloque tout l'engagement comme le ferait potentiel (30 %). La justification §3.4/l.221-224 (« a key proof is missing → surveillance ») est un raisonnement **spécifique au marché** appliqué en règle aveugle. Défendable pour V1, mais à expliciter : aujourd'hui un axe périphérique manquant = même blocage qu'un axe structurant.
- **Le plancher §9/l.341-342 (0.50) est au bon endroit** (« dossier scoreable ou pas ») **mais n'est PAS câblé dans `aggregate()`** — il reste « open question ». Comme marché est toujours non-disponible (départ à 0.85), il faut perdre 0.35 de plus pour l'atteindre : 0.50 est atteignable (perte potentiel+un axe à 20). Valeur OK mais **à porter dans le code**, pas en note.
- **« Inconnu ≠ favorable » : garanti seulement si la classification est correcte.** Le code filtre les non-disponible *avant* le `reduce` (l.234-236), donc un `level: null` n'entre jamais dans l'arithmétique — bien. **Mais aucun invariant** : si un axe est mal classé `available` avec `level:null`, `null * poids` = 0 en JS → l'axe pénalise (0, pas favorable) **ET** `partial=false` → **pas de cap** : score dégonflé silencieusement et engagement débloqué à tort. Aucune assertion `available ⇔ level≠null`. **Et `wSum=0` (tous non-disponible) → `score = 0/0 = NaN`** : pas de garde. Ce sont des bugs latents, pas du style.

## 3. MODÈLE D'ÉTATS (§2) — un trou de fondation : l'entité Signal

**Le manque qu'on regrettera :** la spec titre « 1 signal → N opportunités » (§2.1/l.40) mais **ne définit jamais le shape `Signal`** ni le **back-reference `signalId` sur le dossier**. Le §7/l.311-313 ne migre que « `Signal` status enum » — l'**enum de statut, pas l'entité** (id, type, valeur /10, confidence, sourceRefs, detectedAt, status). ÉV2 (Radar T1) *rend et trie les signaux* : sans le type Signal ni le lien 1→N posés en ÉV1, la « fondation partagée » n'en est pas une. **C'est le point « on le regrettera » n°1.**

Autres manques mineurs : pas d'**état courant d'opportunité** (la dernière action de la taxonomie — dérivé du journal ou stocké ? ÉV3 funnel en aura besoin) ; le **cluster d'assemblage** (§2.1/l.52) n'a pas d'identité reliant ses lots (seulement `assemblyCandidate` par lot).

**Gold-plating :** le **journal append-only au niveau rôle Postgres** (no UPDATE/DELETE + `supersedes`, §2.4/l.88-92) est de la dureté DB en ÉV1 alors qu'**aucun writer n'existe encore** (UI mémoire = ÉV3). Le *shape* journal/timeline a sa place en ÉV1 ; le **durcissement des grants peut glisser**. De même le **masquage PII (§6/l.304-308) est un no-op en ÉV1** : la seule vue livrée est Grilles, aucun propriétaire affiché, et les pilotes excluent déjà les noms. À reporter quand une vue affiche du propriétaire (ÉV3).

## 4. COHÉRENCE AVEC LE SOCLE PARENT — deux divergences non signalées

- **Cap : régression de wording vs parent.** Parent §4.4/l.110-111 + §4.3/l.106 + §11/l.224 disent partout « **plafonner à surveillance** ». La spec §3.4/l.222 plafonne à **`qualifier-avec-expert`** (un cran au-dessus dans la taxonomie). La justification (qualifier = l'escalade qui *lève* le gap) est **bonne**, mais le parent n'est pas mis à jour → un relecteur voit une contradiction. **À réconcilier** (noter la supersession explicite).
- **Enum provenance : §2.6 ment sur le code.** §2.6/l.104-105 dit « The existing enum `fait · hypothese · non-disponible · simulé` stays ». **Le code `Verification` (opportunity.ts l.12) n'a que 3 valeurs — pas `simulé`.** Donc ÉV1 *ajoute* `simulé` (ce n'est pas « stays »), et le §7 ne le liste pas dans la migration. Trancher : `simulé` entre en ÉV1 ou ÉV3 (réel/sim) ?
- **Contradiction interne grille risque ↔ calibration.** §3.3/l.169 pose en règle : « *Non-intersected / indeterminate* → mark the axis **non-disponible**. Unknown ≠ favourable. » Or §5 score H-609-4 **risque=3 available** alors que l'intersection CPTAQ A-939 est précisément « unconfirmed hypothesis » (fichier pilotes l.221). Le tableau qui **« locks the grids »** contredit la règle de sa propre grille. La distinction *réelle* (non-disponible = aucune preuve ne place un niveau ; available/low-conf = du factuel place un niveau, une sous-pièce reste hypothèse) est défendable **mais n'est écrite nulle part**. À expliciter, sinon la calibration verrouille une incohérence.

Les **2 mesures (T1 /10 vs T2 0-5)** sont, elles, **bien tenues** : §3.1-3.2 n'éveillent aucune recontamination du récit « un seul score ». RAS de ce côté.

## 5. PÉRIMÈTRE ÉV1 — à RENTRER : Signal ; à SORTIR : durcissement journal + PII

- **RENTRER (sinon fondation incomplète) :** le **shape `Signal` + `signalId` sur le dossier** (cf. §3). Le reste du modèle d'états est complet pour une fondation.
- **SORTIR / conditionner :** le **grant-level append-only** (garder le shape, différer le durcissement DB quand un writer existe) et le **masquage PII** (no-op en ÉV1). Le §7/l.321-322 admet déjà la migration en « conditional path » — bon réflexe, à étendre au reste.
- **Journal + migration drizzle :** le *shape* journal/timeline est **à sa place en ÉV1** (substrat mémoire + redevabilité, calibration). La migration drizzle additive est OK **si** elle se limite aux colonnes d'enveloppe + table journal, sans le câblage rôle prématuré.

Le périmètre est globalement **bien calibré** ; la `radar-scoring` (aggregate + renorm + cap + versioning + pré-filtres) est le bon cœur réutilisable.

## 6. BLOQUANTS vs nettoyages

**Bloquants (à régler avant writing-plans) :**
1. **Doctrine de classification `available` vs `non-disponible`** : écrire la frontière (§3.3/§3.4), réconcilier la règle « non-intersected → non-disponible » avec risque=3 de §5, et **trancher le marché** (low-conf vs exclu). Ça pilote les nombres « verrouillés » et l'AC #3.
2. **Entité `Signal` + lien `signalId`** : définir le shape minimal en ÉV1 *ou* déclarer explicitement que c'est ÉV2 et cesser de présenter ÉV1 comme la fondation complète des états.

**Nettoyages (intégrables sans re-cycle) :**
- `aggregate()` : garde `wSum>0` (NaN), invariant `available ⇔ level≠null`, câbler le plancher §9 (0.50) dans le code.
- Réconcilier le cap `surveillance` → `qualifier-avec-expert` avec le parent (§4.3/4.4/11).
- Clarifier l'ajout de `simulé` à `Verification` + l'inscrire au §7.
- Préciser la propriété « renormalisation = imputation par la moyenne » et adoucir §3.1 « usually more modest » (2/3 montent vs naïf).
- Grille marché (§3.3) ne définit que 0/3/5 — combler 1/2/4 ou assumer la grille grossière.
- Reporter durcissement journal + PII (§5).

---

## Verdict : **NO-GO** (conditionnel — proche du GO)

La conception est cohérente et l'arithmétique est **exacte** (3.18 / 3.35 / 2.59 tombent, naïf 3.15/3.30/2.65 confirmé). Mais **deux corrections touchent le cœur de la fondation**, pas le vernis : la **doctrine de disponibilité** (sans elle la calibration « verrouillée » contredit sa propre grille risque, AC #3) et l'**entité Signal** (sans elle la « fondation partagée des états » est amputée du lien 1→N qu'elle revendique). Ni l'une ni l'autre n'exige un re-cycle de brainstorming — **une seule révision de spec suffit**. Une fois ces deux points écrits + les nettoyages absorbés : **GO franc.**
