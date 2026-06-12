<script lang="ts">
  // Écran affiché quand le compte est en attente de validation admin.
</script>

<div class="flex h-screen flex-col items-center justify-center bg-slate-50">
  <div class="max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
    <div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
      <svg class="h-6 w-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    </div>
    <h1 class="mb-2 text-lg font-semibold text-slate-900">Compte en attente de validation</h1>
    <p class="text-sm text-slate-600">
      Votre compte a été créé avec succès. Un administrateur doit valider votre accès
      avant que vous puissiez utiliser l'application.
    </p>
    <p class="mt-4 text-sm text-slate-500">
      Vous serez notifié par courriel une fois votre accès approuvé.
    </p>
    <div class="mt-6">
      <a
        href="/api/v1/auth/logout"
        class="inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
      >
        Se déconnecter
      </a>
    </div>
  </div>
</div>
