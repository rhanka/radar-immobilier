import { writable } from "svelte/store";

export type AccountStatus = "pending" | "approved" | "rejected";

export interface AuthUser {
  sub: string;
  name?: string;
  email?: string;
  status?: AccountStatus;
  isAdmin?: boolean;
}

export interface AuthState {
  loading: boolean;
  authenticated: boolean;
  authDisabled: boolean;
  /**
   * Disjoncteur anti-boucle : passe à `true` quand on revient d'une tentative
   * de login (le navigateur a été renvoyé vers l'IdP) ET que /me répond
   * toujours `authenticated:false`. Dans ce cas le cookie de session n'a pas
   * été reçu (typiquement Safari mobile / cookies bloqués) : on N'AUTO-REDIRIGE
   * PLUS — on affiche une page de connexion statique pour casser le ping-pong.
   */
  loginBlocked: boolean;
  user: AuthUser | null;
}

/**
 * Marqueur de tentative de login posé juste avant de partir vers l'IdP.
 * Stocké en sessionStorage (pas localStorage) : nettoyé à la fermeture de
 * l'onglet, et propre à l'onglet courant. Sert au disjoncteur ci-dessous.
 */
const LOGIN_ATTEMPT_KEY = "radar_login_attempt";

function readLoginAttempt(): boolean {
  try {
    return globalThis.sessionStorage?.getItem(LOGIN_ATTEMPT_KEY) === "1";
  } catch {
    return false;
  }
}

function markLoginAttempt(): void {
  try {
    globalThis.sessionStorage?.setItem(LOGIN_ATTEMPT_KEY, "1");
  } catch {
    /* sessionStorage indisponible (mode privé strict) : on tente quand même
       le login une fois, le disjoncteur se dégrade proprement. */
  }
}

function clearLoginAttempt(): void {
  try {
    globalThis.sessionStorage?.removeItem(LOGIN_ATTEMPT_KEY);
  } catch {
    /* no-op */
  }
}

function createAuthStore() {
  const { subscribe, set } = writable<AuthState>({
    loading: true,
    authenticated: false,
    authDisabled: false,
    loginBlocked: false,
    user: null,
  });

  async function checkSession(): Promise<void> {
    try {
      // `cache: "no-store"` est CRITIQUE : sans lui, le navigateur (cache HTTP
      // ou bfcache) peut resservir une ancienne réponse `/me` et ré-afficher le
      // DERNIER user après une déconnexion/reconnexion — exactement le symptôme
      // « reconnect = compte précédent ». On force un aller-retour réseau frais.
      const res = await fetch("/api/v1/auth/me", { cache: "no-store" });
      const data = await res.json();
      const authenticated = data.authenticated === true;
      const authDisabled = data.authDisabled === true;

      // Disjoncteur : si on revient d'une tentative de login et que la session
      // est toujours absente, c'est une boucle (cookie non reçu). On bloque.
      const loginBlocked =
        !authenticated && !authDisabled && readLoginAttempt();

      // Session établie (ou auth désactivée) : la tentative a réussi, on purge
      // le marqueur pour permettre un futur cycle de login propre.
      if (authenticated || authDisabled) {
        clearLoginAttempt();
      }

      set({
        loading: false,
        authenticated,
        authDisabled,
        loginBlocked,
        user: data.user ?? null,
      });
    } catch {
      // /me injoignable : on ne boucle pas vers le login (le réseau, pas l'auth,
      // est en cause). On laisse l'App afficher l'état non-authentifié sans
      // redirection automatique en passant loginBlocked si on revient d'un essai.
      set({
        loading: false,
        authenticated: false,
        authDisabled: false,
        loginBlocked: readLoginAttempt(),
        user: null,
      });
    }
  }

  function redirectToLogin(): void {
    // Pose le marqueur AVANT de partir : au retour, checkSession() saura
    // qu'une tentative a déjà eu lieu et activera le disjoncteur si besoin.
    markLoginAttempt();
    // `prompt=login` : un clic EXPLICITE sur « Se connecter » force l'IdP à
    // RÉ-AFFICHER le login au lieu de réémettre silencieusement un token pour la
    // session SSO en cours. C'est le SEUL levier `prompt` réellement honoré par
    // l'IdP sentropic : son authorize-handler ne traite que `login`/`none`/
    // `consent` (packages/auth-hono/src/oauth/authorize-handler.ts) et IGNORE
    // `select_account` (absent du code, aucun écran de sélection de compte). Un
    // ancien fix envoyait `select_account` — silencieusement ignoré, d'où la
    // régression « reconnect = compte précédent » qui persistait.
    //
    // LIMITE CONNUE (dépend de l'IdP) : `prompt=login` ré-affiche le login mais
    // ne propose pas de CHANGER d'identité tant que le cookie SSO `session` de
    // l'IdP (host-only sur auth.sent-tech.ca, 7 j) n'est pas détruit. L'IdP
    // n'expose ni `end_session_endpoint` ni page de logout navigable cross-site,
    // donc radar ne peut pas le détruire depuis immo.sent-tech.ca. Le switch de
    // compte complet requiert une évolution IdP (cf. rapport auth).
    window.location.href = "/api/v1/auth/login?prompt=login";
  }

  /** Réinitialise le disjoncteur (bouton "Réessayer" de la page bloquée). */
  function resetLoginAttempt(): void {
    clearLoginAttempt();
  }

  return { subscribe, checkSession, redirectToLogin, resetLoginAttempt };
}

export const authStore = createAuthStore();
