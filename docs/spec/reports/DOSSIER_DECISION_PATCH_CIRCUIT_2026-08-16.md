# Dossier de décision — Circuit de patch / hotfix (cross-repo)

> Ajout à la sûreté de release (§1). La spec release-safety a preprod + gate prod + break-glass,
> mais **pas de voie standing de patch/hotfix**. Besoin owner : atteindre la prod **vite sans casser
> le NO-GO S00**. Décisions owner 2026-08-16.

## 1. Décisions owner ratifiées (2026-08-16)
- **Modèle de gate** : **vérif preprod CIBLÉE + gate prod humain**. Un patch passe par une vérification
  preprod ciblée (preuve de rendu du fix précis, pas toute l'acceptation), puis la promotion prod
  **gated-humain** (le même gate S00, **jamais auto-deploy**).
- **Qualification d'un patch** : **fix de régression borné, SANS migration de schéma, diff limité**.
  Au-delà (migration, changement de modèle, gros diff) = **vague feature normale** via le pipeline complet.
- **1er cas / pilote** : **régression drawer droit (preuve signal) = P01 `fix/signal-evidence-pane`**
  (§3.1 Steve). Fix + preuve de rendu authentifiée + promotion gated → sert de pilote au circuit.

## 2. Dimension CROSS-REPO — geo aussi (owner 2026-08-16)
Un patch n'est **pas seulement du code immo** : geo peut être impliqué via un **PATCH DE DONNÉES
ISO-MODÈLE** — correction de données servies (ex. un `reglement_numero` faux, une zone erronée) **sans
changement de schéma/modèle**. Le circuit est donc **cross-repo, deux natures de patch** :
1. **Patch code immo** (ex. P01 régression UI).
2. **Patch données geo iso-modèle** (correction de la donnée servie, modèle inchangé).

**Mêmes invariants pour les deux** : vérif preprod ciblée → gate humain → prod ; **sens unique**
(jamais d'auto-deploy / pas d'écriture prod non gatée) ; **iso-modèle** (aucune migration/évolution de
schéma dans un patch — sinon c'est une vague). Pour geo, le patch données doit rester **dans le contrat
servi figé** (SPEC_GEO_SERVED_CONTRACT) et repasser par le cycle de service (manifeste versionné + haché),
pas une écriture ad-hoc.

## 3. Relation au break-glass
- **Patch** = voie **standing** rapide et gated (régressions courantes).
- **Break-glass** = **urgence** exceptionnelle (incident), procédure tracée distincte.

## 4. Suite
- **Spec de cadrage du circuit patch** (passe 5.6 Sol au retour du gateway) : flux immo-code / geo-data,
  SLA, preuve de rendu ciblée, promotion gated, garde iso-modèle, articulation avec break-glass et avec le
  tier preprod joint. Co-design **geo** (patch données servies) + **poc-k8s** (promotion) → double revue.
- **P01** cadré comme pilote dès que le circuit est spec'd ; preuve de rendu authentifiée obligatoire.
