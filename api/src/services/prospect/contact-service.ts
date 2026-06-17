/**
 * Service couche contact PII — Loi 25 (Inc 2, stub).
 *
 * RÈGLE PII : tout accès en lecture à prospect_contacts DOIT écrire
 * une ligne dans prospect_contact_access_log.
 *
 * Ce service est le seul point d'entrée autorisé pour lire les contacts.
 * Il ne doit jamais être appelé depuis les routes de marquage / notes.
 *
 * Inc 2 livre l'endpoint GET /api/v1/prospects/contacts/:noLot/:citySlug
 * comme stub documenté (400 ou 501) ; l'implémentation complète est Inc 3
 * (couche UI / accès contrôlé).
 *
 * La journalisation d'accès est implémentée ici pour être prête dès Inc 2.
 */

import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import {
  prospectContacts,
  prospectContactAccessLog,
} from "../../db/schema.js";

export interface ContactAccessContext {
  /** IP du client (si disponible) */
  ip?: string;
  /** User-agent */
  userAgent?: string;
  /** Endpoint appelant */
  endpoint?: string;
}

/**
 * Lit le contact actif pour un lot ET journalise l'accès.
 *
 * Retourne null si aucun contact enregistré pour ce lot.
 * Toujours journalisé même si null (tentative d'accès = accès).
 *
 * INVARIANT : ne retourne JAMAIS les champs PII dans les routes de marquage.
 * Utiliser uniquement depuis les endpoints /contacts protégés.
 */
export async function getActiveContactWithLog(
  db: Database,
  noLot: string,
  citySlug: string,
  accessorId: string,
  action: string,
  context: ContactAccessContext,
) {
  // 1. Lire le contact actif
  const rows = await db
    .select()
    .from(prospectContacts)
    .where(
      and(
        eq(prospectContacts.noLot, noLot),
        eq(prospectContacts.citySlug, citySlug),
        isNull(prospectContacts.supersededBy),
      ),
    )
    .limit(1);

  const contact = rows[0] ?? null;

  // 2. Journaliser l'accès (même si contact null = tentative)
  if (contact) {
    await db.insert(prospectContactAccessLog).values({
      contactId: contact.id,
      accessorId,
      action,
      context: {
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
        endpoint: context.endpoint ?? null,
      },
    });
  }

  return contact;
}

/**
 * Journalise un accès à un contact identifié (pour batch / export).
 * À utiliser quand on a déjà le contactId (évite une re-lecture).
 */
export async function logContactAccess(
  db: Database,
  contactId: string,
  accessorId: string,
  action: string,
  context: ContactAccessContext,
) {
  await db.insert(prospectContactAccessLog).values({
    contactId,
    accessorId,
    action,
    context: {
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      endpoint: context.endpoint ?? null,
    },
  });
}
