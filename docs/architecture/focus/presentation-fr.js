// French presentation of D2; the complete English repository dossier remains embedded.
export const presentation = [
`[JUGEMENT] **Aujourd’hui : examiner le dossier et noter votre choix en brouillon, sans démarrer les travaux.** L’arbitrage porte sur l’ordre des travaux : **A** refresh Graphify dans le pod, puis bascule du stockage ; **B** DAG E1–E5 complet avant bascule ; **C** stockage d’abord, poste LLM conservé temporairement. La section **Trois options** propose les cartes sélectionnables, le commentaire et la copie JSON.

[FAIT · demande du propriétaire] Le périmètre est déjà fixé : **toute la chaîne PV → Signal reste Immo**, les travaux i-cond/Graphify doivent être repris, la préprod précède la production, MinIO et les dépendances stockage/images SCW doivent disparaître. **TEM reste jusqu’au remplacement validé.** Aucun de ces points n’est remis au vote.

Le dossier est **incomplet** : inventaire effectif prod, exploitation des credentials, critères de reprise et revue Opus manquent encore. Lire ou annoter cette page n’autorise aucun travail.`,
`[FAIT · audits embarqués] En **préprod**, \`PP-API\` utilise encore \`PP-RAW\` et le lecteur dérivé \`PP-DOCS\` derrière **PP-MINIO**. Les CronJobs scrape/projection utilisent **un seul bucket OVH, PP-GRAPH** : corpus et graphe sont des préfixes, pas deux S3. **PP-DB est la même base** dans toutes les vues.

[FAIT] Le lecteur de PV mappés lit **GEO-S3 / raw/pv-index/cas/**, pas la copie Geo normalisée de préprod. La présence et l’exhaustivité des objets n’ont pas été testées. Scraper un nouveau PV ne prouve donc ni un Signal visible ni un PDF consultable.

[FAIT] Accès : **immo.sent-tech.ca / preprod.immo.sent-tech.ca** ; SSO : **auth.sent-tech.ca / preprod.auth.sent-tech.ca**. \`preprod.sent-tech.ca\` ne résolvait pas. L’inventaire Immo **prod sur OVH est refusé par RBAC** ; l’ancien cluster SCW n’est pas utilisé pour combler ce manque.

[FAIT · reprise i-cond] #678 fournit des candidats CAS, pas une publication. La cible récente est **Graphify bibliothèque + mesh en processus dans le pod Immo** ; un service mesh réseau séparé n’est pas requis. La release finale et son acceptation par Immo restent à établir. [Sources et révisions](continuation-audit.md).`,
`[JUGEMENT] Le risque principal n’est pas seulement une panne visible : des Jobs peuvent être verts alors que les nouveaux PV ne produisent aucun Signal servi, ou que les preuves pointent vers un autre corpus.

[FAIT · architecture] **Immo** possède acquisition, interprétation, grounding, publication, projection SQL et service des Signaux. **Geo** possède les sources géographiques, les jointures et les produits OGC/documentaires. **Graphify** fournit sa bibliothèque réutilisable ; **poc-k8s** porte cluster, ingress, isolation et opérations d’infrastructure.

[JUGEMENT] Les contrats à protéger sont les identités des objets, les types \`Signal/DesignationEvent\`, l’unicité des writers, le renouvellement des credentials et un point de reprise cohérent graphe/SQL/PDF. Geo ne devient pas propriétaire du traitement PV Immo parce qu’il sert certaines preuves.`,
`Les appréciations ci-dessous sont des **[JUGEMENTS]**. Aucune estimation de charge n’est validée.

| ID | Parcours | Meilleur argument POUR | Meilleur argument CONTRE | Coût | Réversibilité | Gagne si… |
| --- | --- | --- | --- | --- | --- | --- |
| A | Refresh checkpointé dans le pod, puis stockage | Réutilise CAS/Graphify ; prouve tôt le résultat utilisateur | Risque d’un orchestrateur jetable ou d’un writer de trop | Intégration + migration, non chiffrées | Bonne avant écriture ; checkpoints nécessaires après | Gates et writer existants réellement réutilisables |
| B | DAG E1–E5 complet d’abord | Frontières de recalcul durables ; merge/projection uniques dès le départ | Plus de contrats changent avant la première preuve utilisateur | Périmètre initial présumé le plus large, à confirmer | Plus difficile avec des contrats/outputs mixtes | A ne peut garantir reprise et writers exclusifs, ou B est presque prêt |
| C | Stockage d’abord, LLM sur poste temporairement | Isole la migration de l’extraction ; teste les lecteurs/writers existants | Ne livre pas le refresh autonome et migre des publishers bientôt modifiés | Moins de code initial, coordination supplémentaire | Code plus simple à revenir ; données toujours à restaurer | Une urgence stockage vérifiée prime sur l’autonomie |

**Même barre de comparaison** : Signal frais servi, PDF exact, writers exclusifs, credentials durables et reprise démontrée. Le dry-run CAS ne prouve pas que A est moins coûteux au total.`,
`[JUGEMENT] **Préférence provisoire A ; exécution différée.** Valider une petite tranche verticale avec une version Graphify publiée, sans contourner le writer canonique ni abandonner silencieusement les invariants E4/E5.

**Meilleur contre-argument :** A peut créer un deuxième orchestrateur à jeter, dupliquer l’exploitation des credentials et repousser la vraie frontière de publication. **B gagne** si son reste-à-faire testé est comparable ou si A ne prouve pas l’exclusivité/reprise. **C gagne** si un risque stockage urgent est établi.

**Pré-mortem :** dans six mois, les Jobs sont verts mais les nouveaux PV n’arrivent toujours pas dans les Signaux, leurs PDF sont ailleurs et le renouvellement OAuth a été perdu au redémarrage. Nous avons accepté l’infrastructure au lieu de la preuve document → utilisateur.

**Intérêt du présentateur :** A est plus facile pour moi à borner ; ce n’est pas une preuve d’économie pour toi. **Ton intérêt :** fraîcheur utile, preuves fiables, dépendances réduites, retour arrière maîtrisé et pas de rework Graphify inutile.

[FAIT · revues] Codex a rendu **six findings**, repris dans D2 : périmètre des suppressions, credentials durables, checkpoint cohérent, périmètre SCW, comparaison des coûts et absence d’approbation implicite. **Opus n’a produit aucun avis : limite hebdomadaire.** La revue Gemini antérieure concerne l’ancien schéma, pas D2. [Avis réels et traitement individuel](decision-reviews.md).`,
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
| Upgrade Graphify sans perdre l’extraction | Ta demande + i-cond | Package publié, import ESM, tests routes/validation/annulation | Release finale et acceptation Immo |
| Credentials sans poste opérateur | Étude i-cond + revue | G1b : refresh, restart, récupération | Contrat d’exploitation |
| Retrait sans perte ni writers concurrents | Ta demande + règles | G3/G4 : parité, IAM/writers, restauration | Inventaire, volume, RPO/RTO |
| Préprod puis prod, TEM conservé | Ta décision | G0–G6 et exclusion explicite TEM | Aucune autorisation de release |
| Vrai dossier Focus, avis réels | Ta demande | SvelteFlow, sous-flows, sources embarquées, avis Codex/Gemini distincts | Opus indisponible ; pas de consensus |`,
`[JUGEMENT] **Pas de demande d’approbation à ce stade.** Vous pouvez sélectionner un parcours dans **Trois options**, le commenter et copier les trois options avec votre choix en JSON. Ce brouillon complète le dossier ; il ne ratifie rien et ne déclenche aucun travail.

Le premier critère propriétaire manquant est l’**enveloppe de reprise acceptable** : indisponibilité, perte de données tolérée (RPO), délai de restauration (RTO), durée de rétention. Il faut également clarifier priorité refresh/retrait, durée tolérable du poste LLM, plafond d’effort, fraîcheur/couverture attendues et responsable d’acceptation de chaque contrat.

L’inventaire prod OVH autorisé, le contrat final Graphify et le second avis indépendant restent des éléments à obtenir. **TEM et la propriété Immo sont déjà actés.** Tu peux lire, annoter et exporter ce dossier sans signer quoi que ce soit.`
];
