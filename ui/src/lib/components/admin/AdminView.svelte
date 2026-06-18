<script lang="ts">
  import { onMount } from "svelte";
  import { Alert, Badge, Button, EmptyState } from "@sentropic/design-system-svelte";

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
  let actionError: string | null = null;
  let activeTab: "pending" | "all" = "pending";
  let actingSub: string | null = null;

  const STATUS_LABELS: Record<string, string> = {
    pending: "En attente",
    approved: "Validé",
    rejected: "Rejeté",
    suspended: "Suspendu",
  };

  function statusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
  }

  function statusTone(status: string): "success" | "info" | "neutral" | "warning" | "error" {
    if (status === "approved") return "success";
    if (status === "pending") return "warning";
    if (status === "rejected") return "error";
    if (status === "suspended") return "neutral";
    return "neutral";
  }

  $: pendingCount = allUsers.filter((user) => user.status === "pending").length;
  $: approvedCount = allUsers.filter((user) => user.status === "approved").length;
  $: suspendedCount = allUsers.filter((user) => user.status === "suspended").length;

  async function loadUsers(): Promise<void> {
    loading = true;
    error = null;
    actionError = null;
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
    actingSub = sub;
    actionError = null;
    const res = await fetch(`/api/v1/admin/users/${encodeURIComponent(sub)}/approve`, {
      method: "POST",
    });
    if (res.ok) {
      await loadUsers();
    } else {
      actionError = `Validation impossible (${res.status})`;
    }
    actingSub = null;
  }

  async function rejectUser(sub: string): Promise<void> {
    actingSub = sub;
    actionError = null;
    const res = await fetch(`/api/v1/admin/users/${encodeURIComponent(sub)}/reject`, {
      method: "POST",
    });
    if (res.ok) {
      await loadUsers();
    } else {
      actionError = `Rejet impossible (${res.status})`;
    }
    actingSub = null;
  }

  async function suspendUser(sub: string): Promise<void> {
    actingSub = sub;
    actionError = null;
    const res = await fetch(`/api/v1/admin/users/${encodeURIComponent(sub)}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        status: "suspended",
        reason: "Suspended from the admin validation view",
      }),
    });
    if (res.ok) {
      await loadUsers();
    } else {
      actionError = `Suspension impossible (${res.status})`;
    }
    actingSub = null;
  }

  onMount(loadUsers);

  $: displayedUsers = activeTab === "pending" ? pendingUsers : allUsers;
</script>

<div class="flex flex-1 flex-col overflow-hidden p-6">
  <div class="mb-6 flex items-center justify-between">
    <div>
      <h1 class="text-xl font-semibold text-slate-900">Administration des comptes</h1>
      <div class="mt-2 flex flex-wrap gap-1.5">
        <Badge tone="warning">{pendingCount} en attente</Badge>
        <Badge tone="success">{approvedCount} validé{approvedCount > 1 ? "s" : ""}</Badge>
        <Badge tone="neutral">{suspendedCount} suspendu{suspendedCount > 1 ? "s" : ""}</Badge>
      </div>
    </div>
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onclick={loadUsers}
    >
      Actualiser
    </Button>
  </div>

  <!-- Tabs -->
  <div class="mb-4 flex gap-2 border-b border-slate-200">
    <Button
      type="button"
      variant={activeTab === "pending" ? "primary" : "ghost"}
      size="sm"
      onclick={() => (activeTab = "pending")}
    >
      En attente
      {#if pendingUsers.length > 0}
        <Badge tone="warning">{pendingUsers.length}</Badge>
      {/if}
    </Button>
    <Button
      type="button"
      variant={activeTab === "all" ? "primary" : "ghost"}
      size="sm"
      onclick={() => (activeTab = "all")}
    >
      Tous les comptes
    </Button>
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-12 text-sm text-slate-500">
      Chargement...
    </div>
  {:else if error}
    <Alert tone="error" title="Chargement impossible" message={error} />
  {:else if displayedUsers.length === 0}
    <EmptyState
      title={activeTab === "pending" ? "Aucun compte en attente" : "Aucun compte"}
      message="Les comptes apparaissent ici après authentification par le fournisseur d'identité."
    />
  {:else}
    {#if actionError}
      <div class="mb-3">
        <Alert tone="warning" title="Action non appliquée" message={actionError} />
      </div>
    {/if}
    <div class="overflow-auto rounded-lg border border-slate-200">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left">
          <tr>
            <th class="px-4 py-3 font-medium text-slate-700">Nom</th>
            <th class="px-4 py-3 font-medium text-slate-700">Courriel</th>
            <th class="px-4 py-3 font-medium text-slate-700">Statut</th>
            <th class="px-4 py-3 font-medium text-slate-700">Créé le</th>
            <th class="px-4 py-3 font-medium text-slate-700">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          {#each displayedUsers as user}
            <tr class="hover:bg-slate-50">
              <td class="px-4 py-3 text-slate-900">{user.name ?? "—"}</td>
              <td class="px-4 py-3 text-slate-600">{user.email ?? "—"}</td>
              <td class="px-4 py-3">
                <Badge tone={statusTone(user.status)}>
                  {statusLabel(user.status)}
                </Badge>
                {#if user.isAdmin}
                  <Badge tone="info">Administrateur</Badge>
                {/if}
              </td>
              <td class="px-4 py-3 text-slate-500">
                {new Date(user.createdAt).toLocaleDateString("fr-CA")}
              </td>
              <td class="px-4 py-3">
                <div class="flex flex-wrap gap-2">
                  {#if user.status === "pending"}
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      disabled={actingSub === user.sub}
                      onclick={() => approveUser(user.sub)}
                    >
                      Approuver
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={actingSub === user.sub}
                      onclick={() => rejectUser(user.sub)}
                    >
                      Rejeter
                    </Button>
                  {:else if user.status === "approved" && !user.isAdmin}
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={actingSub === user.sub}
                      onclick={() => suspendUser(user.sub)}
                    >
                      Suspendre
                    </Button>
                  {:else if user.status === "rejected" || user.status === "suspended"}
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      disabled={actingSub === user.sub}
                      onclick={() => approveUser(user.sub)}
                    >
                      Réactiver
                    </Button>
                  {:else}
                    <span class="text-xs text-slate-400">Aucune action</span>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
