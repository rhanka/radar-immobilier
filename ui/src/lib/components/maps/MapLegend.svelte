<script lang="ts">
  /**
   * MapLegend — Légende de la carte Steve (lots cadastraux CS-L6).
   *
   * Composant local extrait de EvaluationMapView pour préparer
   * la future migration vers le composant Legend DS (backlog).
   * NE crée PAS de dépendance au composant Legend DS non encore disponible.
   *
   * Affiche les 4 catégories de lots carte Steve :
   * - Orange (priorité max) : 4+ logements ∩ TOD
   * - Vert : Zone 4+ logements
   * - Bleu : Périmètre TOD
   * - Gris : Autres lots
   */
</script>

<div class="border-t border-slate-100 px-4 py-3" aria-label="Légende carte Steve">
  <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Légende</p>
  <ul class="flex flex-wrap gap-x-4 gap-y-1.5">
    <li class="flex items-center gap-1.5 text-xs text-slate-600">
      <span class="inline-block h-3 w-5 rounded-sm" style="background:#e67e22; opacity:0.7;"></span>
      4+ logements ∩ TOD (priorité max)
    </li>
    <li class="flex items-center gap-1.5 text-xs text-slate-600">
      <span class="inline-block h-3 w-5 rounded-sm" style="background:#27ae60; opacity:0.65;"></span>
      Zone 4+ logements
    </li>
    <li class="flex items-center gap-1.5 text-xs text-slate-600">
      <span class="inline-block h-3 w-5 rounded-sm" style="background:#2980b9; opacity:0.35;"></span>
      Périmètre TOD
    </li>
    <li class="flex items-center gap-1.5 text-xs text-slate-600">
      <span class="inline-block h-3 w-5 rounded-sm" style="background:#bdc3c7; opacity:0.45;"></span>
      Autres lots
    </li>
  </ul>
</div>
