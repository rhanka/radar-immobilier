<script lang="ts">
  // Écran affiché quand le compte a été refusé par un admin.
</script>

<div class="flex h-screen flex-col items-center justify-center bg-slate-50">
  <div class="max-w-md rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm">
    <div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
      <svg class="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" />
      </svg>
    </div>
    <h1 class="mb-2 text-lg font-semibold text-slate-900">Accès refusé</h1>
    <p class="text-sm text-slate-600">
      Votre demande d'accès à Radar Immobilier a été refusée par un administrateur.
    </p>
    <p class="mt-4 text-sm text-slate-500">
      Pour toute question, contactez l'équipe Sentropic.
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
