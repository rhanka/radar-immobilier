export type Role = "principal" | "conductor" | "agent";
export const ROLE_LABELS_FR: Record<Role, string> = {
  principal: "Principal (humain)",
  conductor: "Chef d'orchestre (IA)",
  agent: "Agent (IA)",
};

export interface Policy { id: string; title: string; rules: string[] }
export const radarPolicy: Policy = {
  id: "radar-v1",
  title: "POLICY — radar immobilier (V1)",
  rules: [
    "Aide à la décision, pas un conseil : toute sortie reste indicative.",
    "Anti-triche : aucune donnée fabriquée ; un axe non-disponible n'est jamais traité comme favorable.",
    "Courtage (OACIQ) : approcher un propriétaire ou monter une acquisition relève d'un courtier agréé.",
    "Loi 25 : renseignements personnels (propriétaire) masqués par défaut, accès journalisé.",
    "Le PRINCIPAL est un humain ; l'IA n'est jamais PRINCIPAL.",
  ],
};

export interface CoordinationJournalEntry {
  id: string; who: string; role: Role; action: string; at: string; note?: string;
}
export interface CoordinationJournal {
  readonly entries: readonly CoordinationJournalEntry[];
  append(entry: Omit<CoordinationJournalEntry, "id" | "at">): CoordinationJournalEntry;
}

export function createJournal(seed?: CoordinationJournalEntry[]): CoordinationJournal {
  const list: CoordinationJournalEntry[] = seed ? [...seed] : [];
  return {
    get entries(): readonly CoordinationJournalEntry[] {
      return Object.freeze([...list]);
    },
    append(entry) {
      const full: CoordinationJournalEntry = {
        ...entry,
        id: `j-${list.length + 1}`,
        at: new Date().toISOString(),
      };
      list.push(full);
      return full;
    },
  };
}

export function appendDecision(
  journal: CoordinationJournal,
  d: { who: string; role: Role; action: string; note?: string },
): CoordinationJournalEntry {
  return journal.append(d);
}

export function summarizePolicy(policy: Policy): string {
  return `${policy.rules.length} règles`;
}
