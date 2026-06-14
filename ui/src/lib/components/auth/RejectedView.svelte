<script lang="ts">
  // Écran affiché quand le compte a été refusé par un admin.
  import { EmptyState } from "@sentropic/design-system-svelte";
</script>

<div class="flex h-screen flex-col items-center justify-center bg-slate-50">
  <div class="w-full max-w-md">
    <EmptyState
      title="Accès refusé"
      message="Votre demande d'accès à Radar Immobilier a été refusée par un administrateur. Pour toute question, contactez l'équipe Sentropic."
    >
      {#snippet action()}
        <a
          href="/api/v1/auth/logout"
          class="inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Se déconnecter
        </a>
      {/snippet}
    </EmptyState>
  </div>
</div>
