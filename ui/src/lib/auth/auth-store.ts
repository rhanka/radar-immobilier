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

/**
 * Marqueur de RÉ-AUTH forcée. Posé par les flux SENSIBLES (logout explicite,
 * « changer de compte ») juste avant le rechargement, il est consommé au
 * prochain `redirectToLogin()` pour forcer `prompt=login` UNE fois. Stocké en
 * sessionStorage : il survit au reload du même onglet (où vit le flux) mais pas
 * à la fermeture. Sans lui, un re-login ordinaire (session expirée) part SANS
 * `prompt` → l'IdP réutilise sa session SSO + le consentement → reconnexion
 * silencieuse (plus d'écran « Autoriser l'application » à chaque fois).
 */
const FORCE_REAUTH_KEY = "radar_force_reauth";

function readLoginAttempt(): boolean {
  try {
    return globalThis.sessionStorage?.getItem(LOGIN_ATTEMPT_KEY) === "1";
  } catch {
    return false;
  }
}

/** Pose le marqueur de ré-auth forcée (flux sensibles : logout, switch-account). */
function markForceReauth(): void {
  try {
    globalThis.sessionStorage?.setItem(FORCE_REAUTH_KEY, "1");
  } catch {
    /* sessionStorage indisponible : on dégrade en re-login ordinaire. */
  }
}

/** Lit ET consomme le marqueur de ré-auth forcée (one-shot). */
function consumeForceReauth(): boolean {
  try {
    const forced = globalThis.sessionStorage?.getItem(FORCE_REAUTH_KEY) === "1";
    if (forced) globalThis.sessionStorage?.removeItem(FORCE_REAUTH_KEY);
    return forced;
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

  function redirectToLogin(options: { forceReauth?: boolean } = {}): void {
    // Pose le marqueur AVANT de partir : au retour, checkSession() saura
    // qu'une tentative a déjà eu lieu et activera le disjoncteur si besoin.
    markLoginAttempt();

    // `prompt=login` est désormais CONDITIONNEL. Il force l'IdP à RÉ-AFFICHER le
    // login (+ ré-octroyer le consentement) au lieu de réutiliser la session SSO
    // — comportement voulu UNIQUEMENT pour les flux sensibles, mais qui rendait
    // la session durable inopérante quand on le forçait à CHAQUE re-login.
    //   - Re-login ordinaire (session radar expirée) → SANS `prompt` : l'IdP
    //     réutilise sa session SSO + le consentement mémorisé → reconnexion
    //     silencieuse, plus d'écran « Autoriser l'application ».
    //   - Flux sensible (logout explicite, « changer de compte ») → AVEC
    //     `prompt=login` : signalé soit par `options.forceReauth`, soit par le
    //     marqueur sessionStorage posé avant le reload de déconnexion.
    // NB : l'entrée d'invitation `/enroll` force déjà `prompt=login` côté serveur
    // (redirige vers /login?prompt=login) — indépendamment d'ici : la correction
    // de la fuite « lien d'invitation → session résiduelle » reste préservée.
    //
    // `prompt=login` est la SEULE valeur `prompt` honorée par l'IdP sentropic
    // (son authorize-handler traite login/none/consent, IGNORE `select_account`).
    // LIMITE CONNUE : ré-afficher le login ne permet pas de CHANGER d'identité
    // tant que le cookie SSO `session` de l'IdP (7 j) vit ; l'IdP n'expose pas de
    // logout navigable cross-site → switch de compte = évolution IdP (rapport auth).
    const forceReauth = options.forceReauth === true || consumeForceReauth();
    window.location.href = forceReauth
      ? "/api/v1/auth/login?prompt=login"
      : "/api/v1/auth/login";
  }

  /** Réinitialise le disjoncteur (bouton "Réessayer" de la page bloquée). */
  function resetLoginAttempt(): void {
    clearLoginAttempt();
  }

  return {
    subscribe,
    checkSession,
    redirectToLogin,
    resetLoginAttempt,
    markForceReauth,
  };
}

export const authStore = createAuthStore();
