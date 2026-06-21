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

  interface Invitation {
    id: string;
    email: string;
    status: string;
    invitedBy: string;
    invitedAt: string;
    acceptedAt: string | null;
    note: string | null;
  }

  let pendingUsers: AccountUser[] = [];
  let allUsers: AccountUser[] = [];
  let invitations: Invitation[] = [];
  let loading = true;
  let error: string | null = null;
  let actionError: string | null = null;
  let activeTab: "pending" | "all" | "invitations" = "pending";
  let actingSub: string | null = null;

  // Invitation form state
  let inviteEmail = "";
  let inviteNote = "";
  let inviting = false;
  let inviteSuccess: string | null = null;
  let inviteError: string | null = null;
  // Lien d'enrôlement à copier-coller — affiché quand l'email n'est pas parti
  // (mode dégradé sans SMTP). Indépendant de la délivrabilité du courriel :
  // l'admin transmet ce lien lui-même (utile p.ex. quand un utilisateur n'a
  // que sa passkey sur ordi et doit s'enrôler depuis son mobile).
  let inviteLink: string | null = null;
  let inviteLinkCopied = false;

  async function copyInviteLink(): Promise<void> {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      inviteLinkCopied = true;
      setTimeout(() => (inviteLinkCopied = false), 2000);
    } catch {
      // clipboard indisponible (http, permissions) : l'utilisateur sélectionne
      // le lien affiché à la main — pas d'erreur bloquante.
    }
  }

  const STATUS_LABELS: Record<string, string> = {
    pending: "En attente",
    approved: "Validé",
    rejected: "Rejeté",
    suspended: "Suspendu",
    invited: "Invité",
  };

  const INVITATION_STATUS_LABELS: Record<string, string> = {
    pending: "En attente",
    accepted: "Acceptée",
    expired: "Expirée",
    revoked: "Révoquée",
  };

  function statusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
  }

  function statusTone(status: string): "success" | "info" | "neutral" | "warning" | "error" {
    if (status === "approved") return "success";
    if (status === "pending") return "warning";
    if (status === "rejected") return "error";
    if (status === "suspended") return "neutral";
    if (status === "invited") return "info";
    return "neutral";
  }

  function invitationStatusTone(status: string): "success" | "info" | "neutral" | "warning" | "error" {
    if (status === "accepted") return "success";
    if (status === "pending") return "warning";
    if (status === "expired") return "neutral";
    if (status === "revoked") return "error";
    return "neutral";
  }

  $: pendingCount = allUsers.filter((user) => user.status === "pending").length;
  $: approvedCount = allUsers.filter((user) => user.status === "approved").length;
  $: suspendedCount = allUsers.filter((user) => user.status === "suspended").length;
  $: pendingInvitationsCount = invitations.filter((inv) => inv.status === "pending").length;

  async function loadUsers(): Promise<void> {
    loading = true;
    error = null;
    actionError = null;
    try {
      const [pendingRes, allRes, invRes] = await Promise.all([
        fetch("/api/v1/admin/users/pending"),
        fetch("/api/v1/admin/users"),
        fetch("/api/v1/admin/invitations"),
      ]);
      if (!pendingRes.ok || !allRes.ok) {
        error = "Erreur lors du chargement des comptes";
        return;
      }
      const pendingData = await pendingRes.json();
      const allData = await allRes.json();
      pendingUsers = pendingData.users ?? [];
      allUsers = allData.users ?? [];
      if (invRes.ok) {
        const invData = await invRes.json();
        invitations = invData.invitations ?? [];
      }
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  async function sendInvitation(): Promise<void> {
    const emailTrimmed = inviteEmail.trim();
    if (!emailTrimmed) return;

    inviting = true;
    inviteSuccess = null;
    inviteError = null;
    inviteLink = null;
    inviteLinkCopied = false;

    try {
      const res = await fetch("/api/v1/admin/invitations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: emailTrimmed,
          ...(inviteNote.trim() ? { note: inviteNote.trim() } : {}),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.email?.sent) {
          inviteSuccess = `Invitation envoyée à ${emailTrimmed} par courriel.`;
        } else {
          // Mode dégradé (pas de SMTP) : l'API renvoie le lien d'enrôlement.
          // On l'affiche pour copie-collé plutôt que de le laisser uniquement
          // dans les logs serveur.
          inviteSuccess = `Invitation créée pour ${emailTrimmed}. L'envoi par courriel est désactivé : copiez le lien ci-dessous et transmettez-le à la personne invitée.`;
          inviteLink = data.email?.link ?? null;
        }
        inviteEmail = "";
        inviteNote = "";
        // Recharge les invitations
        await loadUsers();
      } else {
        const errData = await res.json().catch(() => null);
        inviteError = errData?.error === "validation_failed"
          ? "Adresse courriel invalide."
          : `Erreur lors de l'envoi de l'invitation (${res.status}).`;
      }
    } catch (e) {
      inviteError = String(e);
    } finally {
      inviting = false;
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
        {#if pendingInvitationsCount > 0}
          <Badge tone="info">{pendingInvitationsCount} invitation{pendingInvitationsCount > 1 ? "s" : ""} en attente</Badge>
        {/if}
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
    <Button
      type="button"
      variant={activeTab === "invitations" ? "primary" : "ghost"}
      size="sm"
      onclick={() => (activeTab = "invitations")}
    >
      Invitations
      {#if pendingInvitationsCount > 0}
        <Badge tone="info">{pendingInvitationsCount}</Badge>
      {/if}
    </Button>
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-12 text-sm text-slate-500">
      Chargement...
    </div>
  {:else if error}
    <Alert tone="error" title="Chargement impossible" message={error} />
  {:else if activeTab === "invitations"}
    <!-- Formulaire d'invitation -->
    <div class="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h2 class="mb-3 text-sm font-semibold text-slate-800">Inviter un utilisateur</h2>
      {#if inviteSuccess}
        <div class="mb-3">
          <Alert tone="success" title="Invitation créée" message={inviteSuccess} />
        </div>
      {/if}
      {#if inviteLink}
        <div class="mb-3 rounded-md border border-slate-300 bg-white p-3">
          <span class="mb-1 block text-xs font-medium text-slate-600">
            Lien d'enrôlement à transmettre
          </span>
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              readonly
              value={inviteLink}
              onclick={(e) => (e.currentTarget as HTMLInputElement).select()}
              class="flex-1 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 font-mono
                     text-xs text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-1
                     focus:ring-blue-500"
            />
            <Button type="button" variant="secondary" size="sm" onclick={copyInviteLink}>
              {inviteLinkCopied ? "Copié !" : "Copier le lien"}
            </Button>
          </div>
        </div>
      {/if}
      {#if inviteError}
        <div class="mb-3">
          <Alert tone="error" title="Erreur" message={inviteError} />
        </div>
      {/if}
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div class="flex-1">
          <label class="mb-1 block text-xs font-medium text-slate-600" for="invite-email">
            Adresse courriel
          </label>
          <input
            id="invite-email"
            type="email"
            bind:value={inviteEmail}
            placeholder="steve@example.com"
            disabled={inviting}
            class="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900
                   placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1
                   focus:ring-blue-500 disabled:opacity-50"
          />
        </div>
        <div class="flex-1">
          <label class="mb-1 block text-xs font-medium text-slate-600" for="invite-note">
            Note (optionnel)
          </label>
          <input
            id="invite-note"
            type="text"
            bind:value={inviteNote}
            placeholder="Bienvenue dans l'équipe !"
            disabled={inviting}
            maxlength="500"
            class="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900
                   placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1
                   focus:ring-blue-500 disabled:opacity-50"
          />
        </div>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={inviting || !inviteEmail.trim()}
          onclick={sendInvitation}
        >
          {inviting ? "Envoi en cours..." : "Envoyer l'invitation"}
        </Button>
      </div>
    </div>

    <!-- Liste des invitations -->
    {#if invitations.length === 0}
      <EmptyState
        title="Aucune invitation"
        message="Les invitations envoyées par l'admin apparaissent ici."
      />
    {:else}
      <div class="overflow-auto rounded-lg border border-slate-200">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-left">
            <tr>
              <th class="px-4 py-3 font-medium text-slate-700">Courriel invité</th>
              <th class="px-4 py-3 font-medium text-slate-700">Statut</th>
              <th class="px-4 py-3 font-medium text-slate-700">Note</th>
              <th class="px-4 py-3 font-medium text-slate-700">Envoyée le</th>
              <th class="px-4 py-3 font-medium text-slate-700">Acceptée le</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            {#each invitations as inv}
              <tr class="hover:bg-slate-50">
                <td class="px-4 py-3 font-mono text-xs text-slate-900">{inv.email}</td>
                <td class="px-4 py-3">
                  <Badge tone={invitationStatusTone(inv.status)}>
                    {INVITATION_STATUS_LABELS[inv.status] ?? inv.status}
                  </Badge>
                </td>
                <td class="px-4 py-3 text-slate-500 text-xs">{inv.note ?? "—"}</td>
                <td class="px-4 py-3 text-slate-500">
                  {new Date(inv.invitedAt).toLocaleDateString("fr-CA")}
                </td>
                <td class="px-4 py-3 text-slate-500">
                  {inv.acceptedAt ? new Date(inv.acceptedAt).toLocaleDateString("fr-CA") : "—"}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
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
