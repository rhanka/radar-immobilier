<script lang="ts">
  /**
   * ÉV10 : Vue Coordination (h2a réel).
   *
   * Affiche le journal de coordination RÉEL signé et chaîné par
   * `@sentropic/h2a` côté API (`GET /api/h2a/journal`). Chaque décision
   * (qualifier / surveiller / approcher) prise ici est journalisée comme une
   * paire d'entrées h2a : une proposition PRINCIPAL (humain) signée ed25519,
   * puis un acquittement CONDUCTOR (IA), liées par hash (prevHash/contentHash).
   * La POLICY radar est portée comme artefacts `POLICY` h2a réels.
   *
   * Anti-invention : si l'API h2a est injoignable, la vue affiche un état
   * explicite « h2a non connecté » et ne fabrique aucune entrée.
   *
   * Remplace le stub découplé d'ÉV5 (la coordination réelle visée par §10/§11
   * de SPEC_EVOL_DEMO_RECADRAGE).
   */
  import { onMount } from "svelte";
  import {
    Shield,
    BookOpen,
    User,
    Music2,
    Bot,
    CheckCircle2,
    Link2,
    ShieldCheck,
    ShieldAlert,
    CloudOff,
    RefreshCw,
  } from "@lucide/svelte";
  import { Badge, Button, Card, Alert } from "@sentropic/design-system-svelte";
  import ViewLayout from "$lib/components/ViewLayout.svelte";
  import {
    fetchJournal,
    fetchPolicy,
    recordDecision,
    type DecisionKind,
    type JournalSnapshot,
    type PolicyArtifact,
    type H2ARoleLabel,
  } from "$lib/h2a/h2a-client.js";

  // ── État ──────────────────────────────────────────────────────────────────
  /** Instantané du journal vérifié, ou null tant que non chargé / hors ligne. */
  let snapshot: JournalSnapshot | null = null;
  /** Artefacts POLICY radar (réels). */
  let policies: PolicyArtifact[] = [];
  /** true tant que l'API n'a pas répondu (chargement initial). */
  let loading = true;
  /** true si l'API h2a est injoignable : état « non connecté » explicite. */
  let disconnected = false;

  // Composer une décision
  let decisionKind: DecisionKind = "qualifier";
  let entity = "";
  let rationale = "";
  let submitting = false;
  let formError: string | null = null;

  const ROLE_LABELS_FR: Record<H2ARoleLabel, string> = {
    PRINCIPAL: "Principal (humain)",
    CONDUCTOR: "Chef d'orchestre (IA)",
    AGENTS: "Agents (IA)",
    EXECUTIF: "Exécutif",
    CONTROL: "Contrôle",
    MANDATAIRE: "Mandataire",
  };

  const KIND_LABELS_FR: Record<DecisionKind, string> = {
    qualifier: "Qualifier",
    surveiller: "Surveiller",
    approcher: "Approcher",
  };

  // ── Chargement : journal + POLICY réels ────────────────────────────────────
  async function reload(): Promise<void> {
    loading = true;
    try {
      const [snap, pol] = await Promise.all([fetchJournal(), fetchPolicy()]);
      snapshot = snap;
      policies = pol.policies;
      disconnected = false;
    } catch {
      // API hors ligne : état explicite, aucune donnée fabriquée.
      snapshot = null;
      policies = [];
      disconnected = true;
    } finally {
      loading = false;
    }
  }

  onMount(reload);

  // ── Composer une décision (journalisée + signée côté serveur) ──────────────
  async function submitDecision(): Promise<void> {
    const trimmed = entity.trim();
    if (!trimmed) {
      formError = "L'entité (ex. lot / signal) est requise.";
      return;
    }
    submitting = true;
    formError = null;
    try {
      snapshot = await recordDecision({
        kind: decisionKind,
        entity: trimmed,
        ...(rationale.trim() ? { rationale: rationale.trim() } : {}),
      });
      disconnected = false;
      entity = "";
      rationale = "";
    } catch (error) {
      formError =
        error instanceof Error ? error.message : "Impossible de journaliser la décision.";
    } finally {
      submitting = false;
    }
  }

  // ── Aides d'affichage ──────────────────────────────────────────────────────
  function roleIcon(role: H2ARoleLabel): typeof User {
    if (role === "PRINCIPAL") return User;
    if (role === "CONDUCTOR") return Music2;
    return Bot;
  }

  function roleTone(role: H2ARoleLabel): "neutral" | "info" | "success" {
    if (role === "PRINCIPAL") return "success";
    if (role === "CONDUCTOR") return "info";
    return "neutral";
  }

  function shortHash(hash: string | undefined): string {
    if (!hash) return "n/d";
    return hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
  }

  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleString("fr-CA", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return iso;
    }
  }

  function decisionLabel(body: Record<string, unknown>): string {
    const kind = typeof body.kind === "string" ? body.kind : undefined;
    const ent = typeof body.entity === "string" ? body.entity : undefined;
    const ack = typeof body.acknowledges === "string" ? body.acknowledges : undefined;
    const note = typeof body.note === "string" ? body.note : undefined;
    if (kind && ent) {
      const label = (KIND_LABELS_FR as Record<string, string>)[kind] ?? kind;
      return `${label} : ${ent}`;
    }
    if (ack && note) return note;
    return JSON.stringify(body);
  }
</script>

<ViewLayout>
  <!-- ── Bande latérale gauche : composer une décision ─────────────────────── -->
  <svelte:fragment slot="controls">
    <div class="space-y-5 p-4">
      <div>
        <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Composer une décision
        </p>
        <p class="mb-3 text-xs leading-5 text-slate-500">
          Vous êtes <span class="font-semibold text-teal-700">PRINCIPAL</span> (humain).
          Votre décision est journalisée et signée (h2a réel) ; le chef d'orchestre (IA)
          l'acquitte.
        </p>

        <label class="mb-1 block text-xs font-medium text-slate-600" for="decision-kind">Type</label>
        <select
          id="decision-kind"
          bind:value={decisionKind}
          disabled={disconnected || submitting}
          class="mb-3 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-300 disabled:opacity-50"
        >
          <option value="qualifier">Qualifier</option>
          <option value="surveiller">Surveiller</option>
          <option value="approcher">Approcher</option>
        </select>

        <label class="mb-1 block text-xs font-medium text-slate-600" for="decision-entity">Entité (lot / signal)</label>
        <input
          id="decision-entity"
          type="text"
          bind:value={entity}
          disabled={disconnected || submitting}
          placeholder="ex. H-609-4"
          class="mb-3 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-300 disabled:opacity-50"
        />

        <label class="mb-1 block text-xs font-medium text-slate-600" for="decision-rationale">Motif (optionnel)</label>
        <textarea
          id="decision-rationale"
          bind:value={rationale}
          disabled={disconnected || submitting}
          rows="2"
          placeholder="ex. potentiel de densification confirmé"
          class="mb-3 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-300 disabled:opacity-50"
        ></textarea>

        {#if formError}
          <p class="mb-2 text-xs text-rose-600">{formError}</p>
        {/if}

        <Button
          variant="primary"
          size="sm"
          type="button"
          onclick={submitDecision}
          disabled={disconnected || submitting || !entity.trim()}
        >
          {submitting ? "Journalisation…" : "Journaliser la décision"}
        </Button>
      </div>

      <div class="rounded-md border border-slate-200 bg-slate-50 p-3">
        <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Acteurs</p>
        <ul class="mt-2 space-y-1.5 text-xs text-slate-600">
          <li class="flex items-center gap-2">
            <User class="h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden="true" />
            PRINCIPAL : un humain (jamais l'IA).
          </li>
          <li class="flex items-center gap-2">
            <Music2 class="h-3.5 w-3.5 shrink-0 text-sky-600" aria-hidden="true" />
            CONDUCTOR : l'IA, orchestre sous la POLICY.
          </li>
        </ul>
      </div>
    </div>
  </svelte:fragment>

  <!-- ── Contenu principal ─────────────────────────────────────────────────── -->
  <div class="space-y-6 p-6">
    <header>
      <p class="text-xs font-medium uppercase tracking-normal text-teal-700">
        Socle ÉV10 : coordination h2a réelle
      </p>
      <div class="mt-1 flex flex-wrap items-center gap-3">
        <h1 class="text-2xl font-semibold tracking-normal text-slate-950">
          Coordination humain ↔ agents
        </h1>
        <Badge tone="success">Principal (humain)</Badge>
      </div>
      <p class="mt-2 text-sm leading-6 text-slate-500">
        Journal signé (ed25519) et chaîné par hash via <span class="font-medium">@sentropic/h2a</span>.
        L'IA n'est jamais <span class="font-semibold text-slate-700">PRINCIPAL</span> : elle orchestre
        (chef d'orchestre / agents) sous une <span class="font-medium text-sky-700">POLICY</span>.
      </p>
    </header>

    {#if loading}
      <Card>
        <div class="flex items-center gap-2 p-6 text-sm text-slate-500">
          <RefreshCw class="h-4 w-4 animate-spin" aria-hidden="true" />
          Chargement du journal h2a…
        </div>
      </Card>
    {:else if disconnected}
      <!-- État explicite : aucune donnée fabriquée. -->
      <Alert tone="warning" title="h2a non connecté">
        <div class="flex items-start gap-2">
          <CloudOff class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <div class="space-y-2 text-sm">
            <p>
              L'API h2a est injoignable. Le journal signé n'est pas disponible et
              aucune entrée n'est affichée (pas de simulation).
            </p>
            <Button variant="secondary" size="sm" type="button" onclick={reload}>
              Réessayer
            </Button>
          </div>
        </div>
      </Alert>
    {:else if snapshot}
      <!-- ── Statut de la chaîne ──────────────────────────────────────────── -->
      <div class="flex flex-wrap items-center gap-3">
        {#if snapshot.chainValid}
          <Badge tone="success">
            <ShieldCheck class="mr-1 inline h-3.5 w-3.5 -mt-0.5" aria-hidden="true" />
            Chaîne vérifiée
          </Badge>
        {:else}
          <Badge tone="error">
            <ShieldAlert class="mr-1 inline h-3.5 w-3.5 -mt-0.5" aria-hidden="true" />
            Chaîne invalide{snapshot.chainReason ? ` : ${snapshot.chainReason}` : ""}
          </Badge>
        {/if}
        <span class="text-xs text-slate-500">
          {snapshot.protocol} v{snapshot.version} · {snapshot.scope} ·
          {snapshot.entries.length} entrée{snapshot.entries.length !== 1 ? "s" : ""}
        </span>
      </div>

      <!-- ── POLICY (artefacts h2a réels) ─────────────────────────────────── -->
      <Card>
        <div class="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3">
          <Shield class="h-4 w-4 shrink-0 text-sky-600" aria-hidden="true" />
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-slate-950">POLICY radar</p>
            <p class="text-xs text-slate-500">
              {policies.length} artefact{policies.length !== 1 ? "s" : ""} POLICY h2a (référencés par chaque décision)
            </p>
          </div>
        </div>
        <ul class="divide-y divide-slate-100">
          {#each policies as policy (policy.id)}
            <li class="flex items-start gap-3 px-4 py-2.5">
              <CheckCircle2 class="mt-0.5 h-4 w-4 shrink-0 text-sky-500" aria-hidden="true" />
              <div class="min-w-0">
                <span class="text-sm leading-6 text-slate-700">{policy.rule}</span>
                <span class="ml-2 text-[11px] text-slate-400">{policy.id} · {policy.adoptionMode}</span>
              </div>
            </li>
          {/each}
        </ul>
      </Card>

      <!-- ── Journal signé ────────────────────────────────────────────────── -->
      <Card>
        <div class="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3">
          <BookOpen class="h-4 w-4 shrink-0 text-teal-600" aria-hidden="true" />
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-slate-950">Journal de coordination (signé, chaîné)</p>
            <p class="text-xs text-slate-500">Append-only : chaque entrée signée ed25519 et liée par hash</p>
          </div>
        </div>

        {#if snapshot.entries.length === 0}
          <p class="px-4 py-6 text-sm italic text-slate-400">
            Aucune décision journalisée. Composez une décision pour démarrer la chaîne.
          </p>
        {:else}
          <ul class="divide-y divide-slate-100">
            {#each snapshot.entries as view (view.entry.contentHash)}
              {@const role = view.entry.actor.role}
              {@const Icon = roleIcon(role)}
              <li class="flex items-start gap-3 px-4 py-3">
                <Icon class="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <Badge tone={roleTone(role)}>{ROLE_LABELS_FR[role]}</Badge>
                    <span class="text-[11px] font-medium uppercase text-slate-500">{view.entry.type}</span>
                    <span class="text-[11px] text-slate-400">{formatDate(view.entry.createdAt)}</span>
                    {#if view.signatureValid}
                      <Badge tone="success">signature ✓</Badge>
                    {:else}
                      <Badge tone="error">signature ✗</Badge>
                    {/if}
                  </div>
                  <p class="mt-0.5 text-sm leading-5 text-slate-700">{decisionLabel(view.entry.body)}</p>
                  <div class="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                    <span class="inline-flex items-center gap-1">
                      <Link2 class="h-3 w-3" aria-hidden="true" />
                      seq {view.entry.sequence} · hash {shortHash(view.entry.contentHash)}
                    </span>
                    {#if view.entry.prevHash}
                      <span>prev {shortHash(view.entry.prevHash)}</span>
                    {/if}
                    <span>par {view.entry.signatures?.[0]?.by ?? "n/d"}</span>
                  </div>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </Card>
    {/if}
  </div>
</ViewLayout>
