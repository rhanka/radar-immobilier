<script lang="ts">
  import type { AuthState } from "$lib/auth/auth-store.js";

  export let authState: AuthState;

  interface AccountUser {
    id: string;
    sub: string;
    email: string | null;
    name: string | null;
    status: string;
    isAdmin: boolean;
    createdAt: string;
  }

  let pendingUsers: AccountUser[] = [];
  let allUsers: AccountUser[] = [];
  let loading = true;
  let error: string | null = null;
  let activeTab: "pending" | "all" = "pending";

  async function loadUsers(): Promise<void> {
    loading = true;
    error = null;
    try {
      const [pendingRes, allRes] = await Promise.all([
        fetch("/api/v1/admin/users/pending"),
        fetch("/api/v1/admin/users"),
      ]);
      if (!pendingRes.ok || !allRes.ok) {
        error = "Erreur lors du chargement des comptes";
        return;
      }
      const pendingData = await pendingRes.json();
      const allData = await allRes.json();
      pendingUsers = pendingData.users ?? [];
      allUsers = allData.users ?? [];
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  async function approveUser(sub: string): Promise<void> {
    const res = await fetch(`/api/v1/admin/users/${encodeURIComponent(sub)}/approve`, {
      method: "POST",
    });
    if (res.ok) {
      await loadUsers();
    }
  }

  async function rejectUser(sub: string): Promise<void> {
    const res = await fetch(`/api/v1/admin/users/${encodeURIComponent(sub)}/reject`, {
      method: "POST",
    });
    if (res.ok) {
      await loadUsers();
    }
  }

  // Load on mount
  import { onMount } from "svelte";
  onMount(loadUsers);

  $: displayedUsers = activeTab === "pending" ? pendingUsers : allUsers;
</script>

<div class="flex flex-1 flex-col overflow-hidden p-6">
  <div class="mb-6 flex items-center justify-between">
    <h1 class="text-xl font-semibold text-slate-900">Administration des comptes</h1>
    <button
      type="button"
      on:click={loadUsers}
      class="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
    >
      Actualiser
    </button>
  </div>

  <!-- Tabs -->
  <div class="mb-4 flex gap-2 border-b border-slate-200">
    <button
      type="button"
      class={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        activeTab === "pending"
          ? "border-teal-600 text-teal-700"
          : "border-transparent text-slate-600 hover:text-slate-900"
      }`}
      on:click={() => (activeTab = "pending")}
    >
      En attente
      {#if pendingUsers.length > 0}
        <span class="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
          {pendingUsers.length}
        </span>
      {/if}
    </button>
    <button
      type="button"
      class={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        activeTab === "all"
          ? "border-teal-600 text-teal-700"
          : "border-transparent text-slate-600 hover:text-slate-900"
      }`}
      on:click={() => (activeTab = "all")}
    >
      Tous les comptes
    </button>
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-12 text-sm text-slate-500">
      Chargement...
    </div>
  {:else if error}
    <div class="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      {error}
    </div>
  {:else if displayedUsers.length === 0}
    <div class="flex items-center justify-center py-12 text-sm text-slate-500">
      {activeTab === "pending" ? "Aucun compte en attente" : "Aucun compte"}
    </div>
  {:else}
    <div class="overflow-auto rounded-lg border border-slate-200">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left">
          <tr>
            <th class="px-4 py-3 font-medium text-slate-700">Nom</th>
            <th class="px-4 py-3 font-medium text-slate-700">Courriel</th>
            <th class="px-4 py-3 font-medium text-slate-700">Statut</th>
            <th class="px-4 py-3 font-medium text-slate-700">Créé le</th>
            {#if activeTab === "pending"}
              <th class="px-4 py-3 font-medium text-slate-700">Actions</th>
            {/if}
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          {#each displayedUsers as user}
            <tr class="hover:bg-slate-50">
              <td class="px-4 py-3 text-slate-900">{user.name ?? "—"}</td>
              <td class="px-4 py-3 text-slate-600">{user.email ?? "—"}</td>
              <td class="px-4 py-3">
                <span class={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  user.status === "approved"
                    ? "bg-teal-100 text-teal-700"
                    : user.status === "rejected"
                    ? "bg-red-100 text-red-700"
                    : "bg-amber-100 text-amber-700"
                }`}>
                  {user.status}
                </span>
                {#if user.isAdmin}
                  <span class="ml-1 inline-flex items-center rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-700">
                    admin
                  </span>
                {/if}
              </td>
              <td class="px-4 py-3 text-slate-500">
                {new Date(user.createdAt).toLocaleDateString("fr-CA")}
              </td>
              {#if activeTab === "pending"}
                <td class="px-4 py-3">
                  {#if user.status === "pending"}
                    <div class="flex gap-2">
                      <button
                        type="button"
                        on:click={() => approveUser(user.sub)}
                        class="rounded-md bg-teal-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-teal-700"
                      >
                        Approuver
                      </button>
                      <button
                        type="button"
                        on:click={() => rejectUser(user.sub)}
                        class="rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50"
                      >
                        Rejeter
                      </button>
                    </div>
                  {/if}
                </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
