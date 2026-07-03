<script lang="ts">
  import { ThemeProvider } from "@sentropic/design-system-svelte";
  import { sentTechTheme } from "@sentropic/design-system-themes";
  import TopNav from "./lib/components/TopNav.svelte";
  import type { AuthState } from "./lib/auth/auth-store";
  import type { DemoView } from "./lib/demo/views";

  let activeView: DemoView = "signaux";
  const authState: AuthState = {
    loading: false,
    authenticated: true,
    authDisabled: false,
    loginBlocked: false,
    user: {
      sub: "preview",
      name: "Fabien Antoine",
      email: "fabien@sent-tech.ca",
      isAdmin: true,
    },
  };
</script>

<ThemeProvider theme={sentTechTheme}>
  <TopNav
    {activeView}
    onSelect={(v) => (activeView = v)}
    {authState}
    onLogout={() => {}}
  />
  <div style="padding:2rem;max-width:720px;font-size:0.95rem;line-height:1.5;">
    <p>
      <strong>Aperçu header — police system-ui (parité référence DS).</strong>
    </p>
    <p>
      Survole les liens de nav (Signaux / Évaluation / Sources) : le hover ne
      change que la couleur (comportement DS attendu). Compare cette police au
      header du site <code>design-system.sent-tech.ca</code> — elle doit être
      identique (aucune fonte Inter chargée, rendu system-ui).
    </p>
  </div>
</ThemeProvider>
