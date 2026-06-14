<script lang="ts">
  // Écran affiché quand le compte est en attente de validation admin.
  import { EmptyState } from "@sentropic/design-system-svelte";
</script>

<div class="flex h-screen flex-col items-center justify-center bg-slate-50">
  <div class="w-full max-w-md">
    <EmptyState
      title="Compte en attente de validation"
      message="Votre compte a été créé avec succès. Un administrateur doit valider votre accès avant que vous puissiez utiliser l'application. Vous serez notifié par courriel une fois votre accès approuvé."
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
