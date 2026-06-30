# BLOCKED - WPB-E2E opportunity proof report

The reproducible audit script has been added at:

```bash
api/src/scripts/report-opportunity-proof.ts
```

I could not generate the live 33-opportunity report in this workspace because
the local shell cannot run the project compose wrapper:

```bash
make ps ENV=wpb-e2e-proof
```

failed with:

```text
unknown shorthand flag: 'f' in -f
```

and the fallback:

```bash
make ps DOCKER_COMPOSE=docker-compose ENV=wpb-e2e-proof
```

failed because `docker-compose` is not installed.

Once a compose-capable environment has the graph/geo Postgres projection loaded,
run the exact report command:

```bash
make exec-api CMD="npx tsx src/scripts/report-opportunity-proof.ts --limit 33" ENV=wpb-e2e-proof
```

For a partial diagnostic instead of a hard fail when fewer than 33 `z|m|p`
priority candidates are present:

```bash
make exec-api CMD="npx tsx src/scripts/report-opportunity-proof.ts --limit 33 --allow-partial" ENV=wpb-e2e-proof
```
