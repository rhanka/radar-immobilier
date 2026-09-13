// French presentation of D4; the complete English repository dossier remains embedded.
export const presentation = [
`[FAIT · décision du propriétaire] L’exécution suit l’ordre engagé : **T1 refresh autonome avec Graphify 0.18.0 → T2 retrait de MinIO et sweep final des dépendances SCW → T3 consolidation sur un b3-8**. Le dossier accompagne ces transitions ; il ne remet pas leur ordre au vote. [Registre daté et critères](transitions.md).

[FAIT] Toute la chaîne PV → Signal reste Immo ; la préprod précède la production ; **TEM reste jusqu’au remplacement validé**. Graphify 0.18.0 est publié, mais l’intégration et la preuve Immo de bout en bout restent à obtenir.

La seule décision présentée en cartes est la **méthode d’allocation LLM** pour le 12 août–10 septembre. Aucun choix ni montant final n’est présélectionné. L’audit monétaire, l’inventaire prod, les credentials et la reprise restent incomplets.`,
`[FAIT · audits embarqués] En **préprod**, \`PP-API\` utilise encore \`PP-RAW\` et le lecteur dérivé \`PP-DOCS\` derrière **PP-MINIO**. Les CronJobs scrape/projection utilisent **un seul bucket OVH, PP-GRAPH** : corpus et graphe sont des préfixes, pas deux S3. **PP-DB est la même base** dans toutes les vues.

[FAIT] Le lecteur de PV mappés lit **GEO-S3 / raw/pv-index/cas/**, pas la copie Geo normalisée de préprod. La présence et l’exhaustivité des objets n’ont pas été testées. Scraper un nouveau PV ne prouve donc ni un Signal visible ni un PDF consultable.

[FAIT] Accès : **immo.sent-tech.ca / preprod.immo.sent-tech.ca** ; SSO : **auth.sent-tech.ca / preprod.auth.sent-tech.ca**. \`preprod.sent-tech.ca\` ne résolvait pas. L’inventaire Immo **prod sur OVH est refusé par RBAC** ; l’ancien cluster SCW n’est pas utilisé pour combler ce manque.

[FAIT · reprise i-cond] #678 fournit des candidats CAS, pas une publication. La cible récente est **Graphify bibliothèque + mesh en processus dans le pod Immo** ; un service mesh réseau séparé n’est pas requis. Graphify **0.18.0 est publié** ; son installation exacte et son acceptation de bout en bout par Immo restent à établir. [Sources et révisions](continuation-audit.md).`,
`[JUGEMENT] Le risque principal n’est pas seulement une panne visible : des Jobs peuvent être verts alors que les nouveaux PV ne produisent aucun Signal servi, ou que les preuves pointent vers un autre corpus.

[FAIT · architecture] **Immo** possède acquisition, interprétation, grounding, publication, projection SQL et service des Signaux. **Geo** possède les sources géographiques, les jointures et les produits OGC/documentaires. **Graphify** fournit sa bibliothèque réutilisable ; **poc-k8s** porte cluster, ingress, isolation et opérations d’infrastructure.

[JUGEMENT] Les contrats à protéger sont les identités des objets, les types \`Signal/DesignationEvent\`, l’unicité des writers, le renouvellement des credentials et un point de reprise cohérent graphe/SQL/PDF. Geo ne devient pas propriétaire du traitement PV Immo parce qu’il sert certaines preuves.`,
`[JUGEMENT] **Question : quelle méthode auditable doit allouer la dépense LLM à Immo/Geo pour le 12 août–10 septembre ?** Les trois méthodes sont des alternatives commerciales, pas des séquences d’architecture.

| ID | Méthode | Meilleur argument POUR | Meilleur argument CONTRE | Conséquence monétaire actuelle | Réversibilité |
| --- | --- | --- | --- | --- | --- |
| DIRECT | Dépense fournisseur attribuable | Plus proche de la dépense réelle | Les sièges ne donnent pas toujours une ligne par produit | Inconnue avant rapprochement | Rejouable ; le non-attribué reste séparé |
| USAGE | Usage audité pondéré | Reflète les appels de la fenêtre | Exige déduplication et ventilation input/cache/output exactes | Inconnue avant audit | Recalculable avec journal et formule versionnés |
| CAPACITY | Capacité historique de pointe | Continuité avec le calcul existant | Allocation de capacité, pas facture provider | **214,743159 CAD** historique Immo+Geo, non final | Remplaçable après audit |

L’infrastructure est déjà fixée à **un b3-8 BHS5 : 0,082 CAD/h × 720 h = 59,04 CAD**, avant allocation par produit et coûts non-nœud. Ce montant ne vient pas d’un total historique divisé par trois.`,
`[FAIT] T1, T2 et T3 sont engagés dans cet ordre. Les anciennes alternatives A/B/C restent historiques dans le dossier source ; elles ne sont plus proposées dans l’interface.

**Contre-arguments commerciaux :** DIRECT peut laisser trop de coûts partagés non attribués ; USAGE peut donner une fausse précision si cache et sessions sont mal réconciliés ; CAPACITY peut facturer une capacité historique sans correspondre à une dépense fournisseur de la période. Aucun ne gagne par défaut.

**Pré-mortem :** dans six mois, les Jobs sont verts mais les nouveaux PV n’arrivent toujours pas dans les Signaux, leurs PDF sont ailleurs et le renouvellement OAuth a été perdu au redémarrage. Nous avons accepté l’infrastructure au lieu de la preuve document → utilisateur.

**Intérêt du présentateur :** une formule rejouable est plus facile à expliquer ; ce n’est pas une justification de montant. **Ton intérêt :** rattacher toute somme à une dépense, une fenêtre, une règle et une preuve contrôlables.

[FAIT · revues] Codex a rendu **six findings**, repris dans D2 puis conservés dans D4. **Opus n’a produit aucun avis : limite hebdomadaire.** La revue Gemini antérieure concerne l’ancien schéma ; elle ne vaut pas revue post-build D4. [Avis réels et traitement individuel](decision-reviews.md).`,
`[JUGEMENT] **G0** — Inventorier contrats, ressources et **tous** les consommateurs ; inclure la prod dès qu’une ressource est partagée. Fixer les critères de reprise avant toute suppression.

**G1** — Un document / une ville / un chunk, candidats seulement, sans PG. **G1b** — Credentials opérés : propriétaire, stockage durable, writer unique, tests renouvellement/redémarrage/reprise. Le succès avec une copie éphémère ne qualifie pas l’autonomie.

**G2** — Préprod de bout en bout : publication gardée → projection → 3.4 → API → Signal visible + PDF exact ; rejeu/idempotence et échecs. **G3** — Parité des objets, clôture des writers, puis repoint des clients préprod. **G4** — Répétition de restauration et fenêtre de rétention. **G5** — Retrait des ressources **prouvées exclusives à la préprod**, seulement sans consommateur restant.

**G6** — Autorisation prod séparée, inventaire/backup/promotion et répétition des mêmes gates avant tout retrait prod. Les ressources partagées nécessitent l’acceptation de tous leurs consommateurs. **Stockage SCW et images exécutables/rollback** sont aussi inventoriés/remplacés/vérifiés ; supprimer MinIO ne suffit pas. **TEM est exclu.**

**Retour arrière :** clôturer les writers ; restaurer un ensemble cohérent hash du graphe + version/checkpoint SQL + objets de preuve + input-set du run. Empêcher ou journaliser/rejouer les écritures intervenues selon le RPO accepté. Aucun double writer ; aucune transaction S3/SQL magique. Volume, débit de restauration, downtime, RPO/RTO et rétention restent à fixer avant chiffrage.`,
`| Attendu | Origine | Preuve prévue ou obtenue | Manque |
| --- | --- | --- | --- |
| Effectif, pas legacy supposé | Ta demande | Audits main + K8s préprod | Inventaire OVH prod |
| Même DB/S3, chaîne Immo | Ta demande | Mapping Mermaid, groupes natifs et navigation croisée testés | Pas une certification de disponibilité des données |
| Nouveau PV → Signal frais + PDF exact | Refresh + contrat API | G1/G2 : hash document, type servi, rejeu et preuve lisible | Tests métier non exécutés dans cette branche documentaire |
| Upgrade Graphify sans perdre l’extraction | Ta demande + i-cond | Graphify 0.18.0 publié ; import ESM, tests routes/validation/annulation à reprendre côté Immo | Installation exacte et acceptation Immo |
| Credentials sans poste opérateur | Étude i-cond + revue | G1b : refresh, restart, récupération | Contrat d’exploitation |
| Retrait sans perte ni writers concurrents | Ta demande + règles | G3/G4 : parité, IAM/writers, restauration | Inventaire, volume, RPO/RTO |
| Préprod puis prod, TEM conservé | Ta décision | G0–G6 et exclusion explicite TEM | Aucune autorisation de release |
| Vrai dossier Focus, avis réels | Ta demande | SvelteFlow, sous-flows, sources embarquées, avis Codex/Gemini distincts | Opus indisponible ; pas de consensus |`,
`[JUGEMENT] La question restante est : **quelle méthode d’allocation LLM faut-il retenir ?** Vous pouvez sélectionner DIRECT, USAGE ou CAPACITY, commenter et copier le tout en JSON. Ce brouillon ne ratifie aucun montant et ne déclenche aucun travail.

L’audit doit encore borner exactement la fenêtre locale, dédupliquer appels et sessions repris, ventiler input/cache write/cache read/output, rattacher modèles et providers, puis séparer dépense réelle, allocation, marge et somme proposée. Le **214,743159 CAD** historique est une allocation de capacité de pointe, pas une facture provider.

L’inventaire prod OVH autorisé, les critères RPO/RTO et le second avis indépendant restent aussi à obtenir. **T1→T2→T3, TEM, la propriété Immo et la base un-nœud sont déjà actés.** Les transitions du 13 septembre sont postérieures à la période mensuelle.`
];
