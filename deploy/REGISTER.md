# Procédure d'enregistrement — radar-immobilier comme app sentropic

**App** : `radar-immobilier`
**URL publique** : <https://immo.sent-tech.ca>
**IdP auth** : <https://auth.sent-tech.ca>
**Owner** : fabien.antoine@m4x.org

> Cf. `deploy/sentropic-app.yaml` pour le descriptor déclaratif, `deploy/k8s/60-ingress.yaml`
> pour l'ingress Traefik + TLS, `deploy/k8s/80-auth.yaml` pour la délégation OIDC.

---

## (a) Action owner (Fabien) — créer le workspace sentropic

Se connecter à <https://sentropic.sent-tech.ca>, puis :

1. **Créer le workspace** via l'UI ou l'API :
   - Nom : `radar-immobilier`
   - Type : `code`
   - (La route `POST /api/workspaces` avec body `{"name":"radar-immobilier","type":"code"}` est l'équivalent API — cf. `sentropic/api/src/routes/api/workspaces.ts`, `createWorkspaceSchema`.)
   - Le créateur devient automatiquement `ownerUserId` **et** membre `admin` du workspace
     (cf. workspaces.ts : transaction `tx.insert workspaces` + `tx.insert workspaceMemberships role='admin'`).
2. **Récupérer le `client_secret` OIDC** produit lors de l'enregistrement du client OAuth
   `radar-immobilier` auprès de l'IdP (`auth.sent-tech.ca`), puis le déposer dans le Secret k8s
   `radar-sentropic-auth` (champ `SENTROPIC_OAUTH_CLIENT_SECRET`).
   - Le `client_id` attendu est `radar-immobilier`, le `redirect_uri` est
     `https://immo.sent-tech.ca/api/v1/auth/oauth/callback`
     (cf. `deploy/k8s/80-auth.yaml`).
3. Générer un `SESSION_SECRET` (aléatoire, ≥ 32 octets) et l'ajouter au même Secret k8s.

**Résultat :** workspace `code` créé dans sentropic, Fabien owner+admin,
client OAuth `radar-immobilier` enregistré auprès de `auth.sent-tech.ca`.

---

## (b) Action plateforme / architecte — provisionnement DNS + cluster

### 1. DNS Cloudflare

Créer un enregistrement **A** dans la zone `sent-tech.ca` :

```
immo.sent-tech.ca  →  <IP publique du LB Traefik>
```

Même LB que `sentropic.sent-tech.ca` et `auth.sent-tech.ca`.
Sans ce record, le solver DNS-01 de cert-manager ne peut pas émettre le certificat
TLS (`radar-immo-tls`) déclaré dans `deploy/k8s/60-ingress.yaml`.

### 2. ClusterIssuer cert-manager

S'assurer que le `ClusterIssuer` nommé `letsencrypt-prod` est présent sur le cluster
(ACME DNS-01, solver Cloudflare sur la zone `sent-tech.ca`).
C'est la référence de `deploy/k8s/60-ingress.yaml` :

```yaml
cert-manager.io/cluster-issuer: letsencrypt-prod
```

### 3. Secrets k8s (ne jamais committer de secrets réels)

Remplir une copie privée de `deploy/k8s/secrets.example.yaml` avec les vraies valeurs
(DB, S3, LLM, OIDC `client_secret`, `SESSION_SECRET`, registry pull), puis l'appliquer :

```bash
kubectl -n radar-immobilier apply -f <private-secrets.yaml>
```

### 4. Appliquer les manifests k8s

```bash
# Valider hors cluster (déjà fait en CI) :
make k8s-validate

# Appliquer avec les creds cluster (action humaine explicite) :
KUBECONFIG=<path> make deploy-k8s K8S_DEPLOY_CONFIRM=1 ENV=poc
# équivalent : KUBECONFIG=<path> kubectl apply -k deploy/k8s
```

Les manifests sont dans `deploy/k8s/` (namespace `radar-immobilier`, labels
`app.kubernetes.io/part-of: sentropic` + `sentropic.dev/workspace: radar-immobilier`
sur toutes les ressources, cf. `deploy/k8s/kustomization.yaml`).

---

## (c) Validation `make k8s-validate`

Commande de validation offline (sans cluster, disponible en CI) :

```bash
make k8s-validate
# sortie attendue :
# [k8s-validate] rendering deploy/k8s with kustomize…
# [k8s-validate] structural check (every doc has apiVersion + kind)…
# [k8s-validate] offline render ok; set K8S_VALIDATE_WITH_CLUSTER=1 for a server dry-run
```

Avec un cluster (server-side dry-run) :

```bash
make k8s-validate K8S_VALIDATE_WITH_CLUSTER=1 KUBECONFIG=<path>
```

### Smoke post-deploy

```bash
kubectl -n radar-immobilier get pods
curl https://immo.sent-tech.ca/health
```

---

## Récapitulatif des responsabilités

| Qui | Quoi | Référence |
|---|---|---|
| **Owner (Fabien)** | Créer workspace `code` nommé `radar-immobilier` sur sentropic | `deploy/sentropic-app.yaml`, workspaces.ts |
| **Owner (Fabien)** | Récupérer + déposer `SENTROPIC_OAUTH_CLIENT_SECRET` et `SESSION_SECRET` dans le Secret k8s | `deploy/k8s/80-auth.yaml`, `secrets.example.yaml` |
| **Architecte/plateforme** | A record `immo.sent-tech.ca` → LB Traefik (même LB que `sentropic.sent-tech.ca` / `auth.sent-tech.ca`) | `deploy/k8s/60-ingress.yaml` |
| **Architecte/plateforme** | ClusterIssuer `letsencrypt-prod` (cert-manager DNS-01 Cloudflare, zone `sent-tech.ca`) | `deploy/k8s/60-ingress.yaml` |
| **Architecte/plateforme** | `kubectl apply -k deploy/k8s` avec creds cluster | `deploy/k8s/README.md` |
| **CI (automatique)** | `make k8s-validate` — render kustomize + structural check, sans cluster | `.github/workflows/ci.yml` |
