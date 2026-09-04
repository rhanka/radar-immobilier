<script lang="ts">
  /**
   * SignalAnnotations — CONTAINER : câble le client `annotations-client` au
   * composant présentiel `EntityAnnotations`. Charge les notes de la cible
   * (signal|lot), et **refetch** après chaque mutation (canonise sur la forme
   * GET : ordre, attribution team-partagée, soft-delete masqué).
   *
   * Réutilisable pour un signal (SignauxSelPanel) OU un lot (LotFichePanel).
   * L'auteur est résolu serveur (session) ; l'édition/suppression est author-only
   * (403 côté serveur), et l'UI ne propose ces contrôles que sur ses propres notes.
   */
  import EntityAnnotations from "./EntityAnnotations.svelte";
  import type { AnnotationTarget, EntityAnnotation } from "$lib/collab/annotation.js";
  import {
    listAnnotations,
    createAnnotation,
    editAnnotation,
    deleteAnnotation,
  } from "$lib/collab/annotations-client.js";
  import { authStore } from "$lib/auth/auth-store.js";

  export let target: AnnotationTarget;
  /** Utilisateur courant (pour gater édition/suppression sur ses propres notes).
   *  Non fourni → dérivé de la session (`authStore`). */
  export let currentUserId: string | null | undefined = undefined;
  export let canAnnotate = true;

  $: effectiveUserId = currentUserId ?? $authStore.user?.sub ?? null;
  /** Notifie le parent du nombre de notes (pour un badge ambiant). */
  export let onCount: (n: number) => void = () => {};

  let notes: EntityAnnotation[] = [];
  let busy = false;
  let error: string | null = null;

  async function reload(t: AnnotationTarget): Promise<void> {
    error = null;
    try {
      notes = await listAnnotations(t);
      onCount(notes.length);
    } catch {
      error = "Chargement des notes impossible.";
      notes = [];
      onCount(0);
    }
  }

  // Recharge quand la cible change (type/id/ville).
  let loadedKey = "";
  $: {
    const key = `${target.type}:${target.id}:${target.citySlug}`;
    if (key !== loadedKey) {
      loadedKey = key;
      void reload(target);
    }
  }

  async function mutate(fn: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    error = null;
    try {
      await fn();
      await reload(target);
    } catch {
      error = "Action impossible (droits insuffisants ou réseau).";
    } finally {
      busy = false;
    }
  }

  const onAdd = (body: string): Promise<void> => mutate(() => createAnnotation(target, body));
  const onEdit = (id: string, body: string): Promise<void> => mutate(() => editAnnotation(id, body));
  const onDelete = (id: string): Promise<void> => mutate(() => deleteAnnotation(id));
</script>

<EntityAnnotations {notes} currentUserId={effectiveUserId} {canAnnotate} {busy} {error} {onAdd} {onEdit} {onDelete} />
