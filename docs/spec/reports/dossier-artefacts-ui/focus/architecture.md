# Architecture du dossier #861 — scènes Focus

Révision v11 du 14 octobre 2026 : cible retenue, cluster-mesh dans Immo, cinq vues seulement. La vue « Aujourd’hui » reconstitue l’existant depuis les sources datées, sans nouvelle observation du cluster. Les vues de cible décrivent ce qui est à construire ; leurs mécanismes restent proposés. Zones logiques, orientation gauche → droite, cartes et moteur Focus inchangés. Le service de contenu est déployé par Immo sur un domaine séparé ; le service d’identité reste dans la préproduction Sentropic, hors du nœud Immo. L’ancienne alternative centralisée est conservée dans les archives, hors du pilote, et n’apparaît plus ici. Les parcours d’ouverture, de publication, de maquette locale et les briques déjà présentes sont décrits en prose dans l’annexe technique (section K).

Trait plein : relation décrite ; pointillé : conditionnel / non vérifié. L’ordre temporel se lit dans le déroulé « source → cible », sous chaque vue.

### `avant-existant` — AVANT : l’UI préprod existante et ses API

```mermaid
flowchart LR
  CHAT["Chat hébergé · claude.ai<br/>Consommateur prévu du MCP Immo préprod par la PR #837 fusionnée le 9 octobre<br/>Connexion effective à vérifier ; distinct du navigateur de l’UI"]
  VIEW["Navigateur utilisateur<br/>Parcours du précédent dossier"]
  PP_URL["Route préprod existante<br/>preprod.immo.sent-tech.ca<br/>Sources seulement, accès actuel non testé"]
  GHCR["Registre GHCR existant<br/>Image radar-ui:<sha> construite par la CI<br/>Mise à jour du Deployment par kubectl set image"]
  subgraph CURRENT["OVHcloud BHS · cluster poc-ca"]
    NET["Entrée réseau du précédent<br/>Load balancer → Traefik<br/>accès réseau non constaté ici"]
    subgraph APIS["radar-immobilier-preprod"]
      UI["UI radar-ui existante : Svelte 5 + Vite<br/>nginx non privilégié : bundle statique, index.html, proxy /api<br/>Signaux, Sources, Évaluation et écrans admin"]
      RADAR["API Radar existante<br/>Bearer accepté, /me lit le cookie<br/>profil artefacts absent du périmètre observé"]
      DB["Base préprod existante<br/>radar-postgres<br/>Données réelles présumées, SQL depuis radar-api"]
      PP_MCP["MCP Radar existant dans les manifestes<br/>radar-immo-mcp<br/>PR #837 : /mcp exposé comme en production ; OAuth claude.ai prévu, accès effectif non vérifié"]
    end
    subgraph SSO_ZONE["sentropic-preprod"]
      IDP["Identité préprod existante<br/>auth-idp à preprod.auth.sent-tech.ca<br/>Redirection OIDC navigateur, discovery / JWKS pour Radar"]
    end
    subgraph GEO_ZONE["geo-preprod"]
      GEO["API géographique existante<br/>geo-api · geo-preprod<br/>/api/geo/collections via nginx, sans auth Radar"]
    end
  end
  VIEW --> PP_URL
  CHAT --> PP_URL
  PP_URL --> NET
  NET --> UI
  UI --> RADAR
  RADAR --> IDP
  UI --> GEO
  VIEW --> IDP
  RADAR --> DB
  NET --> PP_MCP
  GHCR --> UI
```

### `06-radar` — CIBLE RETENUE : cluster-mesh dans Immo

```mermaid
flowchart LR
  CHAT["Chat hébergé · claude.ai<br/>Publication via le MCP Immo préprod<br/>Connexion effective et nouvelles permissions à qualifier"]
  VIEW["Farid ou Steve · compte approuvé<br/>Vue privée ou partage nominatif<br/>Usages métier et écritures sous les droits du lecteur"]
  subgraph REGISTRY_CODE["Registre Sentropic"]
    CFG_REG["Outils approuvés<br/>Liste et règles approuvées pour Immo<br/>Écrites dans le code Immo au pilote ; aucun fichier de vue central"]
  end
  subgraph RADAR_HOST["Immo · nœud cluster-mesh"]
    PP_MCP["Même point d’entrée MCP Immo<br/>Même adresse, connexion et comptes<br/>Aucune reconnexion ni reconfiguration imposée"]
    MCP["Socle MCP composé par cluster-mesh dans Immo<br/>Outils actuels : mêmes noms, paramètres et réponses<br/>Publication et cycle de vie ajoutés au même montage"]
    REG["Bibliothèque des vues (Sentropic) dans Immo<br/>Modèle en base, écriture des données et interfaces<br/>Identité de l’appel vérifiée sur place ; une seule autorité d’écriture"]
    BROKER["Connexion et activation de version<br/>Origine de confiance Immo, distincte du contenu<br/>Connexion existante de préproduction à qualifier"]
  end
  subgraph APIS["API partagées"]
    RADAR["API Radar préprod partagée<br/>Usages métier, lecture et écritures sous les droits du lecteur<br/>Administration exclue, attribution vérifiée"]
  end
  subgraph CONTENT["Contenu des vues"]
    EDGE["Service de contenu déployé par Immo<br/>Une adresse par vue<br/>Fichiers privés et appels sous les droits du lecteur"]
  end
  subgraph STORAGE["Immo · stockage privé"]
    CTRL_DB["Base des vues dédiée à Immo<br/>Schéma et migrations de la bibliothèque<br/>Identifiants, versions, accès et références aux fichiers"]
    S3["Stockage privé dédié à Immo<br/>Même organisation par UUID et version<br/>Aucun accès public direct"]
  end
  CHAT --> PP_MCP
  CFG_REG -.-> MCP
  PP_MCP --> MCP
  MCP --> REG
  MCP --> RADAR
  REG --> CTRL_DB
  REG --> S3
  VIEW --> EDGE
  EDGE --> BROKER
  BROKER --> REG
  EDGE --> REG
  EDGE --> S3
  EDGE --> RADAR
```

### `01-vues` — CIBLE RETENUE : plusieurs UI, une même API préprod

```mermaid
flowchart LR
  AUTHOR["Auteur ou agent autorisé<br/>Petit HTML ou bundle via MCP / HTTP<br/>Publication indépendante du CI/CD"]
  subgraph UIS["UI · navigateur"]
    UI["UI standard préprod conservée<br/>radar-ui à preprod.immo.sent-tech.ca<br/>Parcours officiel existant"]
    UI_A["A : carte de Farid, fork privé de l’UI standard<br/>API privée : auteur seul ; sources en S3, pas dans le dépôt<br/>artifactId : 550e8400-e29b-41d4-a716-446655440000<br/>Adresse : identifiant de la vue.<domaine des vues>"]
    UI_B["B : liste de Farid, autre fork de l’UI standard, partagé à Steve<br/>Steve : ses propres droits, activation par version à prouver<br/>artifactId : 6ba7b810-9dad-41d1-80b4-00c04fd430c8<br/>Adresse : identifiant de la vue.<domaine des vues>"]
    UI_C["C : preview de branche<br/>API privée : auteur seul ; build du worktree Radar<br/>artifactId : 7d444840-9dc0-4f2b-8d53-1d09b9a26711<br/>Adresse : identifiant de la vue.<domaine des vues>"]
  end
  subgraph PREPROD["Préprod restreinte"]
    subgraph CONTENT["Service des variantes"]
      EDGE["Service de contenu déployé par Immo<br/>Sert les fichiers de chaque vue<br/>Relaie les appels vers Radar et Geo ; droits par vue, version et lecteur"]
    end
    subgraph REGISTRY_CODE["Registre Sentropic"]
      CFG_REG["Outils approuvés<br/>Outils Immo actuels et fonctions des vues<br/>Écrits dans le code Immo au pilote ; aucun appel pendant le fonctionnement"]
    end
    subgraph IMMO_ZONE["Immo · nœud cluster-mesh"]
      PP_MCP["Même point d’entrée MCP Immo<br/>Même adresse, connexion et comptes<br/>Sans reconnexion ni réglage côté utilisateur"]
      MCP["Socle MCP composé par cluster-mesh dans Immo<br/>Outils actuels : mêmes noms, paramètres et réponses<br/>Outils de publication et cycle de vie ajoutés dès le pilote"]
      REG["Bibliothèque des vues (Sentropic) dans Immo<br/>Modèle en base, écriture des données, interfaces, identifiants et droits<br/>Une autorité locale, ressources dédiées fournies par Immo"]
    end
    subgraph APIS["API partagées"]
      RADAR["Une même instance radar-api préprod<br/>UI standard et variantes A, B, C<br/>Lecture et écritures métier sous les droits du lecteur ; administration exclue"]
      GEO["Une même API geo préprod<br/>Collections OGC<br/>Satellite exclu des variantes initiales"]
    end
  end
  subgraph STORAGE["Immo · stockage privé"]
    CTRL_DB["Base des vues dédiée à Immo<br/>Schéma et migrations de la bibliothèque<br/>Identifiants, versions, droits, adresses et références aux fichiers"]
    S3["Manifestes par portée, vue et version<br/>Fichiers par empreinte dans une portée opaque, pilote dans une organisation<br/>Le service de contenu sert les fichiers ; aucun accès public direct"]
  end
  CFG_REG -.-> MCP
  AUTHOR --> PP_MCP
  PP_MCP --> MCP
  MCP --> RADAR
  MCP --> REG
  REG --> CTRL_DB
  REG --> S3
  UI --> UI_A
  UI --> UI_B
  UI --> RADAR
  UI --> GEO
  UI_A --> EDGE
  UI_B --> EDGE
  UI_C --> EDGE
  EDGE --> RADAR
  EDGE --> GEO
  EDGE --> S3
```

### `04-stockage` — UUID, releases et fichiers dans S3 privé

```mermaid
flowchart LR
  subgraph CONTROL["Modèle DB · fournisseur artefacts"]
    ART_INDEX["Registre des vues en base<br/>Identifiant attribué par le serveur et nom stable<br/>Adresses à étendre, publication sans doublon<br/>Distinct de la liste des outils"]
    ART_A["Artefact A : vue carte<br/>artifactId A, currentReleaseId A2<br/>Fiche stable, adresse par vue"]
    ART_B["Artefact B : vue liste de Farid<br/>artifactId B, currentReleaseId B1<br/>Autre fork de l’UI standard, partagé explicitement à Steve<br/>Steve : droits propres et autorisation par version proposés"]
  end
  subgraph STORAGE["Un stockage S3 privé · préfixes logiques"]
    subgraph RELEASES["Manifestes par UUID"]
      MAN_A1["artifacts/<storageScopeId>/<artifactId A>/releases/<releaseId A1>/manifest.json<br/>Première release immuable conservée<br/>files : chemin → SHA-256"]
      MAN_A2["artifacts/<storageScopeId>/<artifactId A>/releases/<releaseId A2>/manifest.json<br/>Nouvelle release immuable de A<br/>files : chemin → SHA-256"]
      MAN_B1["artifacts/<storageScopeId>/<artifactId B>/releases/<releaseId B1>/manifest.json<br/>Release immuable de la liste de Farid partagée à Steve<br/>files : chemin → SHA-256"]
    end
    BLOBS["artifacts/<storageScopeId>/blobs/sha256/<digest><br/>index.html, JS, CSS, images : octets immuables<br/>Fichiers partagés dans la même portée ; références pour l’effacement"]
    SOURCES["artifacts/<storageScopeId>/<artifactId>/sources/<sourceDigest>/...<br/>Snapshot source et provenance pour éditer<br/>Accès source distinct du droit de lecture"]
    TEMP["artifacts/<storageScopeId>/uploads/<uploadId>/...<br/>Zone temporaire à durée bornée<br/>Le serveur valide puis écrit les clés finales"]
  end
  ART_INDEX --> ART_A
  ART_INDEX --> ART_B
  ART_A --> MAN_A1
  ART_A --> MAN_A2
  ART_B --> MAN_B1
  MAN_A1 -->|"SHA-256"| BLOBS
  MAN_A2 --> BLOBS
  MAN_B1 --> BLOBS
  ART_A --> SOURCES
  ART_INDEX -->|"référence upload"| TEMP
```

### `05-librairies` — Bibliothèques : ce que le pilote compose dans Immo

```mermaid
flowchart LR
  subgraph IMMO_CODE["Immo · pilote"]
    IMMO_HOST["MCP Immo actuel<br/>Même adresse, même connexion, mêmes comptes<br/>Outils actuels conservés, outils des vues ajoutés"]
  end
  subgraph LIB_MESH["Bibliothèques Sentropic · composition"]
    LIB_PLUGIN["Composition cluster-mesh<br/>Assemble les bibliothèques dans Immo<br/>Aucun service central au pilote"]
    MCP_BASE["Socle MCP commun<br/>Protocole et autorisation<br/>À qualifier avec Immo"]
    REG["Gestion des vues<br/>Modèle en base, fichiers, droits et versions<br/>Bibliothèque à créer, ressources fournies par Immo"]
    TOOL_REG["Outils approuvés<br/>Liste et règles des outils<br/>Écrites dans le code Immo au pilote"]
  end
  subgraph PRODUCT_CODE["Réemploi futur"]
    API_HOST["Autre produit<br/>Pourra composer les mêmes bibliothèques<br/>Aucune dépendance du pilote Immo"]
  end
  IMMO_HOST --> LIB_PLUGIN
  LIB_PLUGIN --> MCP_BASE
  LIB_PLUGIN --> REG
  TOOL_REG -.-> IMMO_HOST
  API_HOST -.-> LIB_PLUGIN
```
