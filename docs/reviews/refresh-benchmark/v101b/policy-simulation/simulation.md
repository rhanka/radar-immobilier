# Simulation avant / après — politique de production contre CP (100 documents du banc, référence oracle v3, stricte)

| Politique | P | R | F1 | VP | FP | FN |
|---|---:|---:|---:|---:|---:|---:|
| Avant : astra-low, repli gemini-low sur échec (production) | 0.372 | 0.490 | 0.423 | 330 | 558 | 344 |
| Après : CP (astra-medium → vérification gemini-low) | 0.483 | 0.531 | 0.506 | 358 | 383 | 316 |
| Après, avec le même repli gemini-low sur refus d'astra-medium | 0.483 | 0.531 | 0.506 | 358 | 383 | 316 |
| Borne : repli sur tous les documents (gemini-low seul) | 0.475 | 0.298 | 0.366 | 201 | 222 | 473 |

Écart après − avant : précision +11.2 pts, rappel +4.2 pts, F1 +8.3 pts.
Repli utilisé dans l'« avant » sur le banc : 0/100 documents.
Appels par document : avant 1 Astra + 0 Gemini ; après 1 Astra + 0.99 Gemini.

