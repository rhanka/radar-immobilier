<script lang="ts">
  // Page de connexion STATIQUE. Affichée quand l'utilisateur n'est pas
  // authentifié. Aucune redirection automatique ici : c'est un clic explicite
  // de l'utilisateur qui lance le flux OIDC, ce qui casse définitivement le
  // ping-pong login <-> app observé sur mobile (cookie de session non reçu).
  import { EmptyState, Button } from "@sentropic/design-system-svelte";

  export let blocked = false;
  export let onLogin: () => void = () => {};
</script>

<div class="flex h-screen flex-col items-center justify-center bg-slate-50">
  <div class="w-full max-w-md px-4">
    {#if blocked}
      <!-- Disjoncteur : une tentative de login a déjà eu lieu mais la session
           n'a pas été établie (cookies bloqués / navigation privée stricte). -->
      <EmptyState
        title="Connexion impossible"
        message="Nous n'avons pas pu établir votre session après la connexion. Cela arrive généralement quand le navigateur bloque les cookies (mode privé strict, ou réglages de confidentialité sur mobile). Vérifiez que les cookies sont autorisés pour ce site, puis réessayez."
      >
        {#snippet action()}
          <Button type="button" variant="primary" size="md" onclick={onLogin}>
            Réessayer la connexion
          </Button>
        {/snippet}
      </EmptyState>
    {:else}
      <EmptyState
        title="Radar Immobilier"
        message="Connectez-vous avec votre identité Sentropic pour accéder à l'application."
      >
        {#snippet action()}
          <Button type="button" variant="primary" size="md" onclick={onLogin}>
            Se connecter
          </Button>
        {/snippet}
      </EmptyState>
    {/if}
  </div>
</div>
