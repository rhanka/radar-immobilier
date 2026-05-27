Lecture faite (v4 §1–§11 + OPERATING_MODEL + les deux relectures v3). Verdict ci-dessous, tranchant.

## 1. Corrections v3 → appliquées ? (une par une)

| # | Correction attendue | État v4 | Preuve |
|---|---|---|---|
| (a) | h2a V1 = POLICY + label + journal simple, crypto/modes/ABC différés | ✅ OK | §5 (l.138-142), §6 « V1 (sans crypto) », §11 « V1 minimale » 1-2-3 + « Différé » |
| (b) | spike-d'abord-découplé comme flow | ✅ OK | §5 « Même traitement que flow : spike d'abord, découplé », §11 (l.210), §9 étape 5. La contradiction v3 « package à adopter, pas spike » est **supprimée** |
| (c) | PRINCIPAL=humain, IA jamais PRINCIPAL | ✅ OK | §11 « PRINCIPAL = un humain/org… L'IA n'est jamais PRINCIPAL » ; CONDUCTOR = flow ; OPM §2 « Jamais l'IA » |
| (d) | retrait public-authority/consortium comme recours + nœud OACIQ | ✅ OK | §11 (l.243-248) : modes reclassés en « hypothèse à valider », recours = « nœud externe (médiation/OACIQ/tribunaux), jamais juge-et-partie » ; OPM §3 |
| (e) | federation → CONTRACT/delegated | ✅ OK | OPM §2 « CONTRACT / delegated… **pas federation** (suppose des pairs souverains) » |
| (f) | B2B2C + tiers = hypothèse hors V1 | ✅ OK | OPM titre + §0 ; §11 encadré « Hors V1 — hypothèse business… non construite en V1 » |
| (g) | coût marginal réécrit honnêtement | ✅ OK | OPM §4 « ne tient pas telle quelle… escalade sur le **chemin critique de presque chaque opportunité** » |
| (h) | Loi 25 PII hors-chaîne | ✅ OK | §6, §11 (l.231-233), OPM §5 |
| (i) | signer décisions pas items | ✅ OK | §3 (l.48-50), §6 (l.157-158), §11 (l.224) |

**9/9 appliquées.** Aucune n'est seulement partielle. C'est un right-sizing sérieux, pas cosmétique.

## 2. Nouvelle contradiction / régression introduite ?

**Une seule, réelle mais mineure** : §5, l.144 — « Chat UI… **canal h2a (enveloppes signées)** ». Le mot « signées » réintroduit la crypto que §6/§11 viennent justement de **différer** (« V1 sans crypto », « pas de signature ed25519 »). Résidu non nettoyé de la v3. À corriger.

Sous-quibble : §9 étape 5 classe « Crypto signée » sous « hypothèse business (OPERATING_MODEL) » — or c'est un **report technique** (porteurs de clés distincts), conceptuellement distinct de l'hypothèse B2B2C. Mauvais rangement, sans gravité.

Aucune régression sur le scoring (§4 intact : deux mesures, 0-5, non-disponible) ni sur le séquencement.

## 3. Périmètre V1 — juste ?

**Oui, désormais calibré.** Le h2a V1 est ramené à POLICY + label + journal, et le journal est de toute façon requis pour la mémoire multi-séances (§3) — donc inclure l'étape 5 est justifié, pas du gras. La topologie multi-tenant/tiers/ABC est sortie proprement. Ni trop maigre (POLICY anti-triche paie tout de suite), ni trop gras. RAS sur l'ordre §9 (pilotes réels → Radar/Opp testables sans T0 d'abord).

## 4. Point bloquant avant replanif ?

**Non.** L'incohérence « enveloppes signées » (§5) est un mot à retirer, pas un blocage conceptuel. Tout le reste tient.

## 5. Verdict : **GO** ✅

Corrections résiduelles (à passer en nettoyage, pas en re-cycle) :
1. **§5 l.144** — retirer « (enveloppes signées) » du canal chat, ou le marquer « signature différée » : aligner sur V1-sans-crypto.
2. **§9 étape 5** — sortir « crypto signée » du sac « hypothèse business » et la nommer report **technique** (porteurs de clés distincts), comme en §11.
3. **§11 l.243 vs OPM §2** — `delegated` apparaît dans les « modes différés » alors qu'OPM l'adopte comme cible : préciser que c'est l'**encodage formel du mode** qui est différé, la relation conceptuelle restant `CONTRACT/delegated`.

Aucune ne conditionne la replanification du `PLAN.md` — elles peuvent être intégrées dans le même commit que la replanif.
