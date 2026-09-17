# Retry-proof Gemini v101b

Statut : **mesuré partiel**. Les reçus existants et les rejeux produits sont comptés ; les workers ont été arrêtés avant fermeture complète, donc les documents sans reçu de tentative supplémentaire sont N-A.

| Bras | Refus origine | Cumul après 1 | Cumul après 2 | Cumul après 3 | Récupération à 3 | Appels mesurés |
|---|---:|---:|---:|---:|---:|---:|
| gemini-low | 15 | 3 | 3 | 3 | 20.0% | 20 |
| gemini-medium | 21 | 1 | 1 | 1 | 4.8% | 18 |

Les latences, tokens et coûts par tentative sont dans le JSON. Les causes persistantes reprennent les extraits anonymisés d’origine. Quota 429 : aucun événement mesuré dans `limits/`; capacité siège : source observée existante, projection cascade non-vérifiée.
