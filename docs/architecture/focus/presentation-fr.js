// French owner-facing D5 presentation; English repository sources remain embedded.
export const presentation = [
`[CIBLE · PROPOSED / NOT DEPLOYED] Le schéma affiché par défaut est l’architecture finale complète. **Un seul b3-8 OVH existant** héberge les tenants Immo et Geo après preuve de capacité/sécurité; il ne s’agit ni d’un nœud par tenant ni d’un état observé aujourd’hui.

Immo conserve, en préproduction puis en production, **front, API, MCP OAuth, PostgreSQL et CronJob refresh**. Ses rôles objets sont le graphe/corpus OVH ainsi que les nouveaux rôles raw/documents OVH. Les IDs **PP-RAW-OVH / PP-DOCS-OVH** ne réutilisent jamais les identités physiques **PP-RAW / PP-DOCS** de MinIO. Les bindings privés de production restent **TBD / UNVERIFIED today**.

Geo conserve son API, son rôle de base géographique à dépendance API incertaine, son corpus/normalized OVH, les sources PV/zonage/règlements/lots/environnement et les jointures **en processus**. Aucun lien SQL spatial n’est inventé. Les URL Immo et les deux issuers SSO sont visibles. Après T1 le poste sert seulement à l’enrollment/administration optionnels. Dans la cible finale, **TEM est le seul service Scaleway retenu**; MinIO et les autres dépendances SCW n’y sont pas actifs. MatchID est hors périmètre. [Source cible](transitions-target.md).`,
`[CHEMIN FIXE] Utilisez la barre **Existant → T1 refresh → T2 objets OVH → T3 cible 1 nœud**. Chaque vue est un graphe plateforme complet en SvelteFlow natif et en Mermaid rendu; les quatre zooms as-is restent disponibles dans le sélecteur détaillé.

**Existant** est qualifié par les vérifications du 13 septembre : stockage préprod à 12:33–12:37 UTC, puis workloads/CronJobs relus avec le principal Immo dédié à **15:38 UTC**. API sur MinIO, refresh sur **PP-GRAPH**, même **PP-DB**, corpus PDF Geo séparé. L’accès prod est observé mais ses internals privés ne sont pas inventoriés.

Chaque transition expose cinq cartes : changements, éléments conservés, retraits, gates et preuves. T1, T2 et T3 sont **proposés / non déployés** jusqu’à leurs preuves propres; une flèche de séquence ne vaut ni promotion ni suppression. [État courant](architecture.md) · [registre](transitions.md).`,
`[T1 · REFRESH AUTONOME] Immo possède toute la chaîne : acquisition/parse → extraction profilée + grounding → **candidat frais préservé** → enrichissement déterministe 3.4 **sur ce candidat frais** → publication gardée du graphe complet → projection PG atomique → Signal typé + PDF exact.

Graphify reste épinglé à **exactement 0.18.0**. **immo-pv-extraction-v3** est le nom du contrat PDF interne, pas une version 0.18.3. À HEAD **ac3a7150**, les suites ciblées passent **8/8 + 7/7**, avec typecheck complet et gates scope/branch au vert. Ce n’est ni un Signal de fournisseur réel ni une acceptation Kubernetes; l’analyse amont du `UND_ERR_SOCKET` imbriqué reste ouverte. Le keyring opéré et le lock durable restent aussi ouverts. T1 garde les rôles API MinIO existants jusqu’à T2; Geo fournit les données/preuves géographiques sans posséder le traitement PV Immo.

Acceptation : package installé, tests consumer/intégration, un vrai Signal/PDF et rejeu idempotent, puis Job créé par le CronJob après remplacement de pod et vrai refresh de credentials. Un bump, un Job manuel vert ou un graphe non vide ne remplace pas ces preuves. Les runs manuels et planifiés partagent le même lock exclusif. [Pipeline causal](proposal.md).`,
`[T2 · STOCKAGE OBJET] Créer les nouveaux rôles logiques OVH **PP-RAW-OVH / PP-DOCS-OVH**, migrer lecteurs et writers, comparer clés/tailles/hashes et décodages, clôturer les anciens writers, puis basculer **préprod avant prod**. Les rôles prod sont spécifiés mais leurs bindings physiques restent TBD jusqu’à inventaire autorisé.

**PP-RAW / PP-DOCS** restent les identités physiques de l’ancien MinIO; elles ne sont jamais renommées en nouvelles ressources. Après cutover, l’ancien store reste en reprise lecture seule jusqu’à répétition de restauration, fenêtre de rétention et gate de suppression. MinIO ne part qu’à zéro consommateur.

Le sweep Immo final couvre images, anciens digests, Jobs/CronJobs suspendus ou manuels, CI, backup/rollback/bootstrap, références exécutables et références de secrets. **TEM est l’unique exception.** Le retrait du StatefulSet/PVC n’efface ni les fixtures locales ni l’historique. [Audit sweep](storage-audit.md).`,
`[T3 · UN NŒUD] La cible consolide les deux tenants Immo/Geo sur **un b3-8 existant**, mais aucune faisabilité n’est revendiquée avant mesures. L’observation courante est trois nœuds; la mémoire instantanée totale est d’environ **9 454 Mi**, supérieure aux **5 907,82 Mi** allouables d’un nœud. MinIO ne représente qu’environ **347 Mi** : sa suppression ne rend pas seule le drain possible.

Le gate exige le pic complet partagé incluant Immo prod et le nouveau refresh, des requests réalistes, les choix de veille/hibernation, l’anti-affinity, les PDB, le placement/rattachement PVC, le batch/wake peak et les probes de santé. Le service plan est testé en préprod puis promu séparément. La cible assume un domaine de panne unique et doit préserver reprise et capacité de maintenance.`,
`[GATES] T1 : contrat installé → consumer tests → vrai Signal/PDF → schedule autonome. T2 : matrice clients → destinations → copie/parité → fence writers → repoint réel → schedule observé → restauration isolée → révocation/suppression. T3 : budget de pic complet → contraintes de placement → drain contrôlé → santé préprod puis prod.

**Retour arrière T2 :** arrêter/fencer les writers, restaurer l’ensemble apparié graphe + checkpoint/version SQL + objets de preuve + input-set; journaliser/rejouer les écritures intervenues selon le RPO accepté. Aucune transaction S3/SQL implicite et aucun double writer. Le store ancien reste récupération, pas chemin live.

**Promotion :** chaque transition est acceptée en préproduction avant une autorisation production séparée. Les internals prod non vérifiés, le RPO/RTO, la rétention, le débit de restauration et les bindings IAM empêchent toute déclaration de déploiement ou suppression dans ce dossier.`,
`[PREUVES ET LIMITES] Les sources Mermaid commitées produisent les mêmes nœuds, sous-flows **parentId** et relations dans SvelteFlow et dans les SVG Mermaid hors ligne. Chaque leaf et boîte parent porte une icône, un service, un repo/rôle et une référence; l’absence de mapping échoue fermé. Les IDs de stores restent stables entre vues.

La provenance D4 est conservée telle quelle : commentaire capturé **2026-09-13T15:10:18.423Z**, dossier **b001ce…**, input **92b872…**, option **null**. Ce null signifie **aucun vote de méthode**, pas une ratification silencieuse. D5 applique la correction directe du propriétaire.

Les limites restent : production privée non inventoriée, T1/T2/T3 non déployés, cutoff des données du 13 non gelé et facturation non calculée. Les avis antérieurs ne sont pas présentés comme revalidation D5; aucun agent supplémentaire n’a été lancé pour ce build.`,
`[ANNEXE FACTURATION · EN DERNIER] La période commence à la vraie frontière de la facture/du rapport précédent, **encore non vérifiée**, et se termine le 13 septembre inclus, soit **2026-09-14T00:00:00-04:00 exclusif**. Le cutoff réel de collecte doit être enregistré séparément car le 13 est incomplet. Les transitions du 13 sont dans la période demandée, avec statut observé ou planifié.

Infrastructure : une projection b3-8 BHS5 au tarif **0,082 CAD/h**; heures et montant de la période restent inconnus jusqu’au début vérifié. **720 h / 59,04 CAD** est seulement l’ancienne illustration de 30 jours, jamais le montant courant.

LLM : compter plus tard les tokens avec les **mêmes tarifs unitaires que la facture réelle du mois précédent**. Il faut d’abord identifier cette facture et ses tarifs; la note Wave 250804-028 et les anciens rapports ne prouvent pas qu’ils sont les derniers. Aucun choix DIRECT/USAGE/CAPACITY, aucun parsing des tokens et aucun montant ne sont créés ici.`
];
