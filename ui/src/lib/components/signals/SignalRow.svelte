<script lang="ts">
  import { ChevronDown, ChevronRight, BookOpen, ExternalLink } from "@lucide/svelte";
  import { Badge, Button, Card } from "@sentropic/design-system-svelte";
  import type { SignalT } from "@radar/domain";
  import { valleyfieldDossiers } from "@radar/domain";
  import Acronym from "$lib/components/Acronym.svelte";

  export let signal: SignalT;
  export let onApprofondir: (s: SignalT) => void;

  let expanded = false;
  function toggle() { expanded = !expanded; }

  // Étiquettes françaises pour les types de signaux (S1.3 : types VISION + §4.1 uniquement)
  const TYPE_LABELS: Record<string, string> = {
    "residential-rezoning": "Rezonage résidentiel",
    "cptaq": "CPTAQ",
    "ppcmoi": "PPCMOI",
    "public-consultation": "Consultation publique",
    "plan-urbanisme": "Plan d'urbanisme",
    "grid-cos-modification": "Modification grille/COS",
    "derogation-relevant": "Dérogation pertinente",
    "derogation-irrelevant": "Dérogation non pertinente",
  };

  const CONFIDENCE_LABELS: Record<string, string> = {
    high: "Haute",
    medium: "Moyenne",
    low: "Faible",
  };

  const STATUS_LABELS: Record<string, string> = {
    "nouveau": "Nouveau",
    "à-approfondir": "À approfondir",
    "écarté": "Écarté",
    "surveillance": "Surveillance",
  };

  /**
   * Map des sourceRef connus -> {label, url} pour affichage dans l'accordéon.
   * Dérivé des preuves des dossiers Valleyfield (anti-invention : sourceIds réels).
   */
  const SOURCE_META: Record<string, { label: string; url: string }> = {
    "avis-consultation-150-49": {
      label: "Avis public :assemblée de consultation règl. 150-49/150-50",
      url: "https://dua3m7xvptjbw.cloudfront.net/documents/avis/AP_150-49_150-50_assemblee_consultation.pdf",
    },
    "avis-approbation-referendaire-150-51": {
      label: "Avis public :approbation référendaire 150-51 (2e projet)",
      url: "https://dua3m7xvptjbw.cloudfront.net/documents/avis/Avis-public-Approbation-referendaire-150-51.pdf",
    },
    "avis-referendum-150-51": {
      label: "Avis public :approbation référendaire 150-51 (2e projet)",
      url: "https://dua3m7xvptjbw.cloudfront.net/documents/avis/Avis-public-Approbation-referendaire-150-51.pdf",
    },
    "avis-consultation-150-49-1": {
      label: "Avis public :procédure de demande de scrutin référendaire :règl. 150-49-1",
      url: "https://dua3m7xvptjbw.cloudfront.net/documents/avis/AP_Avis-Registre-150-49-1.pdf",
    },
    "avis-registre-150-49-1": {
      label: "Avis public :procédure de demande de scrutin référendaire :règl. 150-49-1",
      url: "https://dua3m7xvptjbw.cloudfront.net/documents/avis/AP_Avis-Registre-150-49-1.pdf",
    },
  };

  /**
   * Explication du score /10 par type de signal (VISION §6).
   * Pourquoi ce type a cette valeur selon la grille VISION.
   */
  const SCORE_EXPLANATION: Record<string, string> = {
    "residential-rezoning": "Rezonage résidentiel = Priorité 1 VISION (§6) : signal le plus fort :création d'une nouvelle zone de densification autorisée par règlement adopté. Valeur 10/10 : impact direct sur le potentiel constructible.",
    "cptaq": "CPTAQ = Priorité 4 VISION (§6) mais valeur 8/10 : levée ou modification d'une restriction agricole provinciale (LPTA). Valeur élevée car le passage en zone constructible est un changement réglementaire majeur.",
    "ppcmoi": "PPCMOI = Priorité 2 VISION (§6), valeur 7/10 : Plan de prévention de catastrophes et mesures d'ordre public ou mixtes implique un processus structuré qui peut débloquer des zones. Signal fort mais moins direct que le rezonage.",
    "public-consultation": "Consultation publique = valeur 6/10 : indicateur précoce d'un changement réglementaire en gestation. Signal utile pour anticiper, mais sans certitude d'aboutir à un rezonage.",
    "plan-urbanisme": "Plan d'urbanisme = Priorité 3 VISION (§6), valeur 7/10 : révision du cadre directeur municipal. Impact structurel sur plusieurs zones simultanément.",
    "grid-cos-modification": "Modification grille/COS = valeur 6/10 : ajustement des paramètres constructifs (coefficients d'occupation du sol, marges, hauteurs) sans nécessairement changer la vocation de zone.",
    "derogation-relevant": "Dérogation pertinente = filtre pur VISION (§6) : pas de score /10. Les dérogations sont traitées comme filtre de contexte, pas comme signal de priorité.",
    "derogation-irrelevant": "Dérogation non pertinente = filtre pur VISION : dérogation sans impact sur le potentiel foncier visé.",
  };

  /**
   * Explication de la confiance par niveau.
   */
  const CONFIDENCE_EXPLANATION: Record<string, string> = {
    high: "Confiance haute : source primaire officielle vérifiée (avis public ou règlement adopté en PDF). L'information est directement traçable au document officiel.",
    medium: "Confiance moyenne : source secondaire ou vérification partielle. L'information est plausible mais une vérification complémentaire est recommandée avant décision.",
    low: "Confiance faible : source non obtenue ou transcription indisponible. Traiter comme hypothèse à confirmer.",
  };

  function confidenceTone(confidence: string): "success" | "warning" | "neutral" {
    if (confidence === "high") return "success";
    if (confidence === "medium") return "warning";
    return "neutral";
  }

  function statusTone(status: string): "success" | "info" | "neutral" | "warning" | "error" {
    if (status === "nouveau") return "success";
    if (status === "à-approfondir") return "info";
    if (status === "écarté") return "neutral";
    if (status === "surveillance") return "warning";
    return "neutral";
  }

  function formatDate(iso: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    const [y, m, d] = iso.split("-");
    const months = ["janv.", "févr.", "mars", "avr.", "mai", "juin",
                    "juil.", "août", "sept.", "oct.", "nov.", "déc."];
    return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
  }

  $: typeLabel = TYPE_LABELS[signal.type] ?? signal.type;
  $: isEcarte = signal.status === "écarté";
  $: isSimulation = signal.mode === "simulation";
  $: isDerogation = signal.type === "derogation-relevant" || signal.type === "derogation-irrelevant";

  // Nombre d'opportunités attachées (compte les dossiers dont signalId = signal.id)
  $: nbOpportunites = valleyfieldDossiers.filter((d) => d.signalId === signal.id).length;

  // Sources résolubles (sourceRefs -> meta)
  $: resolvedSources = signal.sourceRefs
    .map((ref) => ({ ref, meta: SOURCE_META[ref] }))
    .filter((s) => s.meta !== undefined) as Array<{ ref: string; meta: { label: string; url: string } }>;
</script>

<!-- SI1 : simulation = légèrement atténuée (opacity-80) mais toujours visible -->
<div class={`rounded-lg border bg-white shadow-sm transition ${isEcarte ? "border-slate-100 opacity-60" : isSimulation ? "border-slate-200 opacity-80" : "border-slate-200"}`}>
  <!-- En-tête de la carte : toujours visible (collapsed) -->
  <button
    type="button"
    class="flex w-full items-center gap-4 px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-1 rounded-lg"
    aria-expanded={expanded}
    on:click={toggle}
  >
    <!-- Chevron -->
    <span class="shrink-0 text-slate-400" aria-hidden="true">
      {#if expanded}
        <ChevronDown class="h-4 w-4" />
      {:else}
        <ChevronRight class="h-4 w-4" />
      {/if}
    </span>

    <!-- Type + bylaw/zone -->
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-2">
        <p class="text-sm font-semibold text-slate-950">
          {#if signal.type === "cptaq" || signal.type === "ppcmoi"}
            <Acronym term={typeLabel} />
          {:else if signal.type === "grid-cos-modification"}
            Modification grille/<Acronym term="COS" />
          {:else}
            {typeLabel}
          {/if}
        </p>
        {#if isSimulation}
          <Badge tone="warning">Exemple (simulation)</Badge>
        {/if}
      </div>
      {#if signal.bylaw || signal.zone}
        <p class="mt-0.5 text-xs text-slate-500">
          {#if signal.bylaw}Règl. {signal.bylaw}{/if}{#if signal.bylaw && signal.zone}, {/if}{#if signal.zone}Zone {signal.zone}{/if}
        </p>
      {/if}
    </div>

    <!-- Valeur /10 -->
    <div class="flex shrink-0 flex-col items-center gap-0.5" title={isDerogation ? "Dérogation : filtre pur, pas de score /10 (VISION §6)" : "Valeur de triage /10 (priorité par type, VISION §6)"}>
      <span class="text-[10px] font-medium uppercase tracking-wide text-slate-400">Valeur</span>
      {#if isDerogation}
        <span class="text-[11px] font-semibold text-slate-400 italic">Filtre</span>
      {:else}
        <span class="text-base font-bold text-slate-900">
          {signal.value}<span class="text-[11px] font-normal text-slate-400">/10</span>
        </span>
        <div class="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
          <div
            class="h-full rounded-full bg-teal-500"
            style="width: {(signal.value / 10) * 100}%"
          ></div>
        </div>
      {/if}
    </div>

    <!-- Confiance -->
    <div class="flex shrink-0 flex-col items-center gap-0.5" title="Confiance (qualité de la détection)">
      <span class="text-[10px] font-medium uppercase tracking-wide text-slate-400">Confiance</span>
      <Badge tone={confidenceTone(signal.confidence)}>
        {CONFIDENCE_LABELS[signal.confidence] ?? signal.confidence}
      </Badge>
    </div>

    <!-- Statut -->
    <div class="shrink-0">
      <Badge tone={statusTone(signal.status)}>
        {STATUS_LABELS[signal.status] ?? signal.status}
      </Badge>
    </div>

    <!-- Date -->
    <div class="hidden shrink-0 text-xs text-slate-400 sm:block">
      {formatDate(signal.detectedAt)}
    </div>
  </button>

  <!-- Contenu déplié -->
  {#if expanded}
    <div class="border-t border-slate-100 px-4 pb-4 pt-3 space-y-4">

      <!-- Sources du signal -->
      <div>
        <p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Source{resolvedSources.length !== 1 ? "s" : ""} du signal
        </p>
        {#if resolvedSources.length === 0}
          <p class="text-sm text-slate-400 italic">
            {isSimulation ? "Signal synthétique :aucune source documentée (exemple de calibration)." : "Aucune source résolue pour ce signal."}
          </p>
        {:else}
          <ul class="space-y-1.5">
            {#each resolvedSources as src}
              <li>
                <a
                  href={src.meta.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1.5 text-sm text-teal-700 underline decoration-teal-300 hover:decoration-teal-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                >
                  {src.meta.label}
                  <ExternalLink class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </a>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <!-- Explication du scoring -->
      <div>
        <p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Explication du scoring
        </p>
        <div class="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 space-y-1.5">
          <p class="text-sm leading-5 text-slate-700">
            {SCORE_EXPLANATION[signal.type] ?? "Pas d'explication disponible pour ce type de signal."}
          </p>
          <p class="text-sm leading-5 text-slate-600">
            {CONFIDENCE_EXPLANATION[signal.confidence] ?? ""}
          </p>
        </div>
      </div>

      <!-- Opportunités attachées + Approfondir -->
      <div class="flex items-center justify-between">
        <p class="text-sm text-slate-600">
          <span class="font-semibold text-slate-900">{nbOpportunites}</span>
          {" "}opportunité{nbOpportunites !== 1 ? "s" : ""} attachée{nbOpportunites !== 1 ? "s" : ""}
        </p>

        {#if !isEcarte}
          <Button
            variant="primary"
            size="sm"
            type="button"
            onclick={() => onApprofondir(signal)}
          >
            <BookOpen class="h-3.5 w-3.5" aria-hidden="true" />
            Approfondir
          </Button>
        {:else}
          <span class="text-xs text-slate-400 italic">Signal écarté</span>
        {/if}
      </div>

    </div>
  {/if}
</div>
