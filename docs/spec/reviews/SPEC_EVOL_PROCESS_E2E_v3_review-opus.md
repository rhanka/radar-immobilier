Lecture faite (SPEC v3 §1–§11, OPERATING_MODEL §1–§7, VISION, PROCESS, DATA_MODEL). Voici le challenge, sans complaisance, par question.

---

## 1. Mapping rôles radar ↔ h2a (§11) — partiellement juste, deux abus de vocabulaire nets

**Ce qui tient.** PRINCIPAL = humain qui pilote sa mini-org, CONDUCTOR = superviseur d'une meute d'agents : appliquer ces deux rôles à « Sentropic pilote la plateforme **et** mandate ses agents dev/ops » est correct et c'est même le cas d'usage canonique de h2a. Le profil **ABC** (§11 dernier paragraphe) est défendable : tu *consommes* du C government-citizen (données municipales/CPTAQ/StatCan), tu *vends* en A enterprise B2B, tu opères dans un B ecosystem (pros immo, JLR). Bon usage.

**Abus n°1 — « recours `public-authority`/`consortium` en dernier ressort » (§11, OPERATING_MODEL §2).** C'est une erreur de catégorie. `public-authority` et `consortium` sont des **modes multi-humains** (structure de collaboration entre plusieurs humains/orgs), pas des **niveaux d'escalade**. Tu confonds « comment plusieurs PRINCIPALs se coordonnent » avec « qui est le backstop ». Et sur le fond : Sentropic, vendeur SaaS, **n'est pas une `public-authority`**. Dans un contexte C, la *vraie* autorité de recours, c'est la municipalité, la CPTAQ, l'OACIQ, les tribunaux — pas toi. Présenter Sentropic comme l'autorité publique terminale est à la fois faux au sens h2a et juridiquement bancal.

**Abus n°2 — « `federation` entre plateforme et client » (§11).** Une relation SaaS B2B n'est pas une fédération de pairs autonomes. C'est un **`CONTRACT`** (ton propre profil A enterprise le dit) avec autorité **`delegated`**. `federated` suppose des domaines d'autorité souverains qui coopèrent d'égal à égal ; ce n'est pas ton client tenant. Tu listes d'ailleurs en « à confirmer » le mapping des modes — bien — mais le corps du texte affirme déjà `federation`, ce qui contredit la prudence affichée.

**Problème de fond plus grave — l'invention d'une topologie B2B2C.** VISION et PROCESS décrivent un **radar mono-opérateur** (un développeur/investisseur qui détecte la densification). Nulle part on ne parle de « responsable produit » ayant des « clients finaux » ni de plateforme multi-tenant. La hiérarchie à 3 niveaux (§11) + 4 tiers de support (OPERATING_MODEL §4) est **plaquée par-dessus** la vision, pas dérivée d'elle. C'est peut-être ton business plan réel (vendre le radar à des firmes immo qui ont des analystes/clients), mais ce n'est pas dans les inputs : à expliciter et valider comme hypothèse, et **surtout pas à construire en V1** où l'utilisateur est… toi, en démo.

Enfin, **tu mélanges dev-time et run-time** sous le même appareillage de rôles. « Sentropic mandate ses agents dev » (gouvernance de fabrication) et « qui décide go/no-go sur une opportunité » (gouvernance produit) sont deux usages h2a légitimes mais distincts. Les fusionner crée du flou conceptuel — à séparer explicitement.

## 2. Provenance signée + journalisée (§6) — sur-ingénierie pour V1/démo

Le problème que résout réellement la règle anti-triche est : *« ne pas présenter un `simulé`/`hypothèse` comme un `fait` »*. Or **ce problème est déjà résolu** par l'enum de provenance par item (§3 : `fait · hypothèse · non-disponible · simulé`) + l'étiquetage UI « instruit/validé par `<rôle>` ». La signature **ed25519 + chaîne vérifiable** n'ajoute de la valeur que face à un **adversaire** ou un **litige multipartite** sur *qui a attesté quoi*. En V1 mono-opérateur/démo, il n'y a pas d'adversaire — tu ne vas pas forger des signatures contre toi-même. La crypto est donc **YAGNI**.

Pire, en mode **Simulation** (§6) : signer cryptographiquement une donnée simulée avec de vraies clés produit une « signature d'autorité » sur de la fiction. Si l'UI ne ramène pas l'enum de provenance au premier plan, la signature donne une **fausse impression d'autorité** au simulé — l'inverse de l'objectif anti-triche. Le théâtre cryptographique peut empirer la lisibilité.

**Surface h2a minimale réellement utile en V1 :**
1. **`POLICY`** : encoder la règle anti-triche + le périmètre comme objet vérifiable (un score plafonné à « surveillance » quand une preuve clé manque, §4.4). C'est la primitive h2a qui *paie* tout de suite.
2. **Label de rôle** sur la provenance (chaîne `validé par <rôle>`), **pas** de clé.
3. **Journal append-only simple** (table d'événements horodatés) — tu en as **déjà besoin** pour la « mémoire multi-séances » (§3) et la timeline ; inutile de le crypto-chaîner pour ça.

Tout le reste (ed25519, chaîne, `SIGNATURE`/`AUTHORITY`) attend une vraie matrice d'autorité avec des **porteurs de clés distincts** (ex. prouver à un investisseur en due diligence qu'une contrainte a été *validée par un professionnel agréé*) — besoin futur réel, pas V1.

## 3. Modèle opérationnel — la thèse « coût marginal » ne tient pas dans CE domaine

**Le point qui casse le modèle.** OPERATING_MODEL §1/§5 pose « agents absorbent le volume, l'humain n'est qu'un recours rare → coût marginal ». Mais ton propre socle dit le contraire : les axes décisifs sont **structurellement non-disponibles sans étape humaine/payante** — propriétaire caviardé LFM 72 (DATA_MODEL §2.2), comparables marché Tier C (§2.3), polygones de zonage absents → zone = hypothèse (§1.3), registre foncier à 1,50 $/doc. PROCESS §5 l'assume : « garder une étape humaine pour les décisions lourdes ». Donc l'étape humaine/experte n'est **pas un edge case rare** : elle est sur le **chemin critique de quasiment chaque opportunité qualifiée**. La courbe de coût marginal n'est pas plate — chaque dossier sérieux déclenche une escalade coûteuse récurrente. La thèse économique est à réécrire honnêtement.

**Responsabilité.** Un radar qui recommande `approcher-propriétaire`/`monter-dossier-acquisition` (§3) sur des données majoritairement hypothèse/non-disponible engage ta responsabilité si le client agit sur une reco fausse. Le journal signé est **à double tranchant** : preuve que tu as divulgué la provenance, mais aussi preuve que tu as recommandé une action sur données partielles. Il faut une **`POLICY` de disclaimer** : décision-support, pas conseil ; le plafond « surveillance » (§4.4) aide déjà.

**RGPD → en fait Loi 25 (QC).** Juridiction = Québec : c'est la **Loi 25** qui s'applique (équivalent RGPD). Dès que tu enrichis le propriétaire via Registre foncier (donnée personnelle), tu déclenches finalité/base légale/rétention/droits d'accès **et de rectification/effacement**. Or **un journal append-only ed25519 est en contradiction frontale avec le droit à l'effacement/rectification** : une chaîne immuable ne se purge pas. C'est une **contradiction juridique réelle** de §6. Solution : garder les renseignements personnels **hors chaîne** (ne signer que des hash/références), ségréguer le PII.

**Juridique QC spécifique.** `approcher-propriétaire`/montage d'acquisition frôle le **courtage immobilier (OACIQ)** ; les contraintes/servitudes relèvent de l'**arpenteur-géomètre**, le registre foncier du **notaire**. L'action `qualifier-avec-expert` est juste ; mais le périmètre « plateforme qui suggère des actes » doit être borné par POLICY.

**Deadlock.** L'escalade (OPERATING_MODEL §4) **se termine sur Sentropic** (Tier 3 = recours), qui est aussi le PRINCIPAL plateforme **et** le CONDUCTOR des agents dev. Pour un litige *client ↔ plateforme* (« le radar m'a mal conseillé »), la route `ENFORCEMENT_PLAN` résout vers l'arbitre = la partie mise en cause → **juge et partie**, conflit d'intérêt, deadlock de fait. Il faut un **nœud terminal externe** (médiation/OACIQ/tribunaux) pour ce type de dispute — ce que l'invocation creuse de `public-authority` ne fournit pas.

## 4. Cohérence avec le socle — pas de contradiction logique, mais deux frictions

**Aligné.** h2a ne casse ni le scoring deux-mesures (§4.1–4.2), ni le traitement non-disponible (§4.4 « jamais de valeur neutre fabriquée »), que la provenance *renforce*. La taxonomie d'actions (§3) mappe proprement sur `ENGAGEMENT`/`MANDATE`. Le séquencement §9 est **correct** : h2a en étape 5, socle découplé — bonne discipline.

**Friction n°1 — explosion combinatoire.** « 1 signal → N opportunités » (§3) = des centaines de lots pour un rezonage. Si chaque dossier voit ses décisions devenir des artefacts **signés**, le volume d'enveloppes explose avec N (malgré les pré-filtres). Règle à poser : **signer les décisions, jamais chaque item de donnée**.

**Friction n°2 — contradiction « package à adopter » vs incertitude.** §5 affirme : h2a est « **package publié à adopter (pas un spike-à-créer)** ». Mais §11 et OPERATING_MODEL §7 listent en « à confirmer » : mapping des modes, instanciation ABC, **surface d'intégration**, *quels tiers d'abord*. Si même le mapping des rôles de base est incertain, l'adoption n'est pas validée — elle est **aspirationnelle**. Incohérence flagrante avec le traitement de `@sentropic/flow` (§5), pourtant moins incertain, qui lui exige « spike de validation d'abord ». **Applique à h2a la même règle qu'à flow.**

## 5. YAGNI — ce qui doit attendre

| À **différer** (V1 n'en a pas besoin) | Pourquoi |
|---|---|
| Chaîne signée ed25519 / `SIGNATURE`/`AUTHORITY` | Pas d'adversaire en démo mono-opérateur (§2) ; conflit Loi 25 (§3) |
| Modes multi-humains (`peer/delegated/shared-engagement/federated/consortium/public-authority`) | Mapper **zéro** mode en V1 ; un seul opérateur |
| Instanciation ABC complète (disclosure/recours/obligations récurrentes/juridiction/préséance) | Gouvernance lourde, pré-revenu |
| 4 tiers de support (OPERATING_MODEL §4) | **Zéro client** : design d'org pré-revenu pour un user = toi |
| `CONTRACT`/`ENFORCEMENT_PLAN`/`AMENDMENT` | Pas de contrepartie réelle à contractualiser |

**À garder (et qui peut rester « h2a-shaped » sans même importer le package)** : une `POLICY` anti-triche checkable, le label de rôle sur la provenance, un `ENGAGEMENT` pour les go/no-go humains alimentant la timeline.

## 6. Faisabilité d'intégration (h2a v0.3.1) dans SPA Svelte + API Hono

Je ne hallucine pas l'API du package (à vérifier au spike), mais les contraintes d'archi sont nettes :

- **Signature côté serveur uniquement.** Les clés privées ed25519 **ne descendent jamais dans la SPA Svelte**. Tout `SIGNATURE` se fait dans l'API Hono ; le navigateur ne fait que **vérifier** (WebCrypto supporte Ed25519 dans les navigateurs récents) et **afficher** les enveloppes.
- **Runtime à vérifier.** Hono tourne sur Node/Bun/Workers. Si h2a utilise le `crypto` de **Node**, OK sur Node/Bun mais **KO sur Cloudflare Workers/edge** (qui exigent WebCrypto). → **item de spike** : compat runtime de h2a v0.3.1.
- **Gestion de clés.** Où vivent les clés ? Au minimum stockage serveur sécurisé, idéalement un KMS. Non traité par les specs — à cadrer.
- **Stockage du journal.** Tu es déjà en Postgres + jsonb (DATA_MODEL §3). Un journal append-only = une table avec colonnes de hash-chaînage : trivial. (Mais voir §3 : **PII hors chaîne**.)
- **Risque de maturité.** `v0.3.1` = pré-1.0 → API probablement instable, breaking changes attendus. Pinner la version et **isoler derrière une interface** pour que le socle ne se couple pas à h2a (exactement comme tu le fais pour flow).

**Verdict faisabilité :** techniquement faisable en quelques jours *si* l'API du package est propre et le runtime compatible — mais c'est précisément ce qu'un **spike** doit prouver avant tout engagement de spec. Aujourd'hui la spec **présume** l'adoption.

## 7. Top 5 améliorations priorisées

1. **Recadrer V1 = mono-opérateur ; sortir la topologie B2B2C et les 4 tiers de la V1.** Séparer explicitement *dev-time governance* (toi + agents dev) et *run-time product governance* (go/no-go opportunités). Marquer « responsable produit / client final / fédération » comme **hypothèse business à valider**, hors périmètre V1. *(Impact : évite de construire une org pour 0 client.)*
2. **Downgrader la provenance V1** à : enum (déjà là) + label de rôle + journal append-only simple. **Reporter ed25519/chaîne signée.** Et traiter h2a **comme flow** : *spike d'abord, socle découplé derrière interface* — corriger l'incohérence §5. *(Impact : débloque le socle sans dette crypto.)*
3. **Résoudre la contradiction journal append-only ↔ Loi 25** (droit à l'effacement/rectification) : renseignements personnels (propriétaire issu du registre foncier) **hors chaîne signée** (hash/référence seulement) + POLICY de rétention. *(Impact : risque juridique bloquant.)*
4. **Corriger les abus de vocabulaire h2a (§11) :** retirer `public-authority`/`consortium` comme « recours Sentropic » (erreur de catégorie + faux juridiquement) ; requalifier `federation` → `CONTRACT`/`delegated` ; ajouter un **nœud d'escalade externe** (médiation/OACIQ) pour les litiges client↔plateforme afin d'éviter le juge-et-partie. *(Impact : crédibilité du modèle de gouvernance.)*
5. **Réécrire la thèse économique « coût marginal ».** Reconnaître que l'étape humaine/payante (registre foncier, marché Tier C, interprétation réglementaire) est **sur le chemin critique**, pas un recours rare ; modéliser le coût des escalades récurrentes + une **POLICY de disclaimer** (décision-support, pas conseil ; périmètre courtage OACIQ). *(Impact : honnêteté du modèle d'affaires et bornage de responsabilité.)*

---

**Synthèse en une phrase :** l'intuition h2a est juste (gouverner *qui décide/atteste* au-dessus de *qui exécute*), mais la v3 sur-instrumente (crypto, modes, tiers, ABC complet) un produit V1 qui n'a qu'un opérateur, abuse de deux termes h2a, et heurte Loi 25 sur l'append-only — la version saine de V1 est : **POLICY anti-triche + label de rôle + journal simple, h2a en spike découplé**, tout le reste différé.

Veux-tu que je transforme le Top 5 en patch concret des §5/§6/§9/§11 + OPERATING_MODEL (réécriture des passages fautifs) ?
