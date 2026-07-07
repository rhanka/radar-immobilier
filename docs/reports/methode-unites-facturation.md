# Méthode — unités de coût normalisées pour refacturation

Cette note socle la méthode utilisée pour transformer des ressources hétérogènes en une quantité facturable unique, afin qu'une ligne `quantité × prix unitaire` conserve les ratios économiques réels.

## Principe général

Période de facturation Farid alignée pour la facture Wave 250804-028 : **2026-06-08 → 2026-07-05**. Les indicateurs et montants de refacturation présentés sur la facture sont exprimés sur cette période client, même lorsque des mesures sources intermédiaires proviennent de fenêtres de contrôle plus courtes.

Ne jamais additionner directement des unités physiques hétérogènes (`mCPU·h + GiB·jour`, ou tokens de modèles différents) pour calculer un taux moyen. La quantité facturable doit être exprimée dans une **unité de coût normalisée**.

Pour Wave, si le prix unitaire exact nécessite plus de décimales que l'interface ne conserve, utiliser des **k-unités facturées** et choisir un couple `quantité` / `prix unitaire` à deux décimales dont le produit donne exactement le montant de ligne.

## Infra / IaaS

Unité canonique : **mCPU·h équivalent coût**.

Formule :

```text
coût_compute = montant_total × coût_source_compute / (coût_source_compute + coût_source_stockage)
coût_stockage = montant_total × coût_source_stockage / (coût_source_compute + coût_source_stockage)

taux_cpu = coût_compute / mCPUh
taux_stockage = coût_stockage / GiBjour
coefficient_stockage = taux_stockage / taux_cpu

unités_cpu = mCPUh
unités_stockage = GiBjour × coefficient_stockage
unités_total = unités_cpu + unités_stockage
```

Pour la facture 250804-028 :

```text
montant_total = 15,86 CAD
mCPUh = 11 040,663
GiBjour = 328,591
coût_source_compute = 6,05 EUR
coût_source_stockage = 0,71 EUR

coût_compute = 14,194 CAD
coût_stockage = 1,666 CAD
coefficient_stockage = 3,943 mCPU·h équiv. / GiB·jour
unités_cpu = 11 040,663
unités_stockage = 1 295,681
unités_total = 12 336,344 mCPU·h équiv.
taux_exact = 15,86 / 12 336,344 = 0,00128563 CAD / unité
```

Présentation Wave retenue à deux décimales :

```text
Quantité = 12,20 k-unités
Prix unitaire = 1,30 CAD / k-unité
Montant = 15,86 CAD
```

Description facture :

```text
Usage cloud/k8s facturé : CPU 11 040,663 mCPU·h (11 040,663 unités mCPU·h équiv.) ; stockage 328,591 GiB·jour (1 295,681 unités mCPU·h équiv., coefficient 3,943). Total réel : 12 336,344 unités mCPU·h équivalent coût. Facturation arrondie : 12,20 k-unités × 1,30 CAD.
```

## IA / LLM

Unité canonique : **M output-token équivalent coût**.

Formule par modèle :

```text
coefficient_input = prix_input_par_M / prix_output_par_M
unités_modèle = output_M + input_M × coefficient_input
unités_total = somme(unités_modèle)
taux_exact = montant_total / unités_total
```

Ratios utilisés :

```text
Claude opus / sonnet / fable : input/output = 0,2
Codex gpt-5.5 : input/output = 125/750 = 0,166667
auto-review : input/output = 18,75/113 = 0,165929
```

Pour la facture 250804-028 :

```text
montant_total = 87,04 CAD

Claude opus-4.8 : I 12 943,721 M / O 45,239 M => 2 633,983 unités => 77,97 CAD
sonnet-4.6 : I 429,667 M / O 33,372 M => 119,306 unités => 3,53 CAD
fable-5 : I 204,055 M / O 0,576 M => 41,387 unités => 1,23 CAD
Codex gpt-5.5 : I 833,079 M / O 3,626 M => 142,473 unités => 4,22 CAD
auto-review : I 18,853 M / O 0,059 M => 3,187 unités => 0,09 CAD

unités_total = 2 940,335 M output-token équiv.
taux_exact = 87,04 / 2 940,335 = 0,029602 CAD / unité
```

Présentation Wave retenue à deux décimales :

```text
Quantité = 2,72 k-unités
Prix unitaire = 32,00 CAD / k-unité
Montant = 87,04 CAD
```

Description facture :

```text
Refacturation IA / LLM Claude & Codex : 2 940,335 unités M output-token équivalent coût. Facturation arrondie : 2,72 k-unités × 32,00 CAD. Détail : Claude opus-4.8 I 12 943,721 M / O 45,239 M (2 633,983 unités ; 77,97 CAD) ; sonnet-4.6 I 429,667 M / O 33,372 M (119,306 unités ; 3,53 CAD) ; fable-5 I 204,055 M / O 0,576 M (41,387 unités ; 1,23 CAD) ; Codex gpt-5.5 I 833,079 M / O 3,626 M (142,473 unités ; 4,22 CAD) ; auto-review I 18,853 M / O 0,059 M (3,187 unités ; 0,09 CAD).
```

## Règle pour la prochaine facture immo

1. Recalculer les volumes physiques réels/projetés de la période.
2. Calculer les coûts sources par ressource ou par modèle.
3. Convertir vers l'unité canonique de coût normalisée.
4. Conserver dans le rapport : volumes physiques, coefficients, unités calculées, taux exact.
5. Dans Wave : utiliser un couple `quantité` / `prix unitaire` à deux décimales qui reproduit exactement le montant de ligne, en documentant l'arrondi dans la description.
