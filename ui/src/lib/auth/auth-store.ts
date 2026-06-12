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
  user: AuthUser | null;
}

function createAuthStore() {
  const { subscribe, set } = writable<AuthState>({
    loading: true,
    authenticated: false,
    authDisabled: false,
    user: null,
  });

  async function checkSession(): Promise<void> {
    try {
      const res = await fetch("/api/v1/auth/me");
      const data = await res.json();
      set({
        loading: false,
        authenticated: data.authenticated === true,
        authDisabled: data.authDisabled === true,
        user: data.user ?? null,
      });
    } catch {
      set({ loading: false, authenticated: false, authDisabled: false, user: null });
    }
  }

  function redirectToLogin(): void {
    window.location.href = "/api/v1/auth/login";
  }

  return { subscribe, checkSession, redirectToLogin };
}

export const authStore = createAuthStore();
