# Politique modèle de rafraîchissement validée

Décision owner : 2026-09-17 04:40Z ; Refs #703 et #697.

- D1 : Astra low via Codex est primaire ; Gemini 3.8 Flash low via Cloud Code est l’unique repli applicatif. Le routage exact interdit les substitutions mesh silencieuses. Conserver mesh-refresh 0.19.2 pour l’omission du plafond Codex.
- D2 : Intercepter erreurs de transport et texte vide avant validation qualité. Marquer explicitement les erreurs validateur. Une tentative de route mesh interdit ses retries qualité internes. Les échecs de persistance fichier/état arrêtent le run.
- D3 : Chaque tentative modèle reçoit son propre signal de délai. L’annulation parente arrête la politique. Kubernetes borne le Job entier à 2100 secondes.
- D4 : Sélectionner le repli une fois par document et le conserver pour les fragments restants. Compter une fois chaque document quota consécutif ; réinitialiser seulement après un document primaire entièrement réussi. Ouvrir le circuit à trois.
- D5 : Réserver deux tentatives par fragment avant tout appel. Persister des reçus de tentative sûrs même après erreur transport/qualité. Conserver tous les modèles des documents mixtes ; inclure les deux modèles et le mode forcé dans l’identité de run.
- D6 : Les deux transports partagent principal/owner scope runtime, avec comptes enrôlés séparément dans le keyring inscriptible. Aucune nouvelle clé Secret n’est requise.

Deux angles de conception indépendants : transport et état/reprise. Les constats acceptés couvrent distinction document/fragment, isolation des délais, budget repli, identité forcée, suppression du retry qualité et remise à zéro seulement à la fin du document. La revue locale finale d’état de `5f26f219` n’a identifié aucun blocage ; les artefacts de revue publique externe conservent leurs propres résultats.
