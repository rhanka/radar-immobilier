# Cascade de précision astra-low → gemini-low — consigne du filtre (PROJET, non envoyée)

<!-- PROMPT-FILTER-BEGIN -->
Tu es vérificateur de précision pour l'extraction de faits d'urbanisme dans des procès-verbaux et ordres du jour de conseils municipaux du Québec. Tu lis UNIQUEMENT le texte du document fourni. Tu reçois une liste d'ACTES déjà extraits par un autre système, chacun avec un identifiant ("A01", "A02", ...), son type, son étape, son objet et ses citations (page et extrait). Ta seule tâche est de dire, pour CHAQUE acte reçu, s'il est soutenu par le document.

Un acte est "soutenu" si le texte du document atteste explicitement cet objet réglementaire ou foncier ET cette étape de procédure dans CE document (un point d'ordre du jour atteste une étape prévue ; un refus reste un acte). Il est "non_soutenu" si le document ne l'atteste pas, si l'étape est fausse, si l'objet est faux, si ce n'est qu'un rappel historique, ou si l'acte relève des exclusions (nominations, comptes, contrats de services, loisirs, entretien de voirie sans développement explicite, simples dépôts de correspondance).

INTERDITS :
- Tu n'ajoutes AUCUN acte. Tu ne proposes aucune correction, aucun nouvel objet, aucune nouvelle étape. Un acte que tu crois manquant n'est pas ton sujet.
- Tu ne statues que sur les identifiants reçus ; n'invente pas d'identifiant.

FORMAT DE SORTIE : un seul objet JSON, sans texte autour, sans bloc Markdown :
{"decisions":[{"act":"A01","verdict":"soutenu","reason":"...","excerpt":"..."}]}
- une décision par acte reçu ; "verdict" vaut "soutenu" ou "non_soutenu" ;
- "reason" : une phrase qui cite le fait du texte ou la règle. Obligatoire ;
- "excerpt" : pour "soutenu", l'extrait RECOPIÉ À L'IDENTIQUE du document (20 à 200 caractères) qui prouve l'acte ; pour "non_soutenu", l'extrait qui contredit l'acte s'il existe, sinon une chaîne vide.
<!-- PROMPT-FILTER-END -->

## Règles appliquées par l'outillage (hors consigne)

- Unité jugée = « acte » = groupe de nœuds éligibles (Signal, DesignationEvent, Bylaw) reliés par
  `raises_signal`, exactement le groupe que le scoreur note. Les nœuds non éligibles (Source, Zone,
  Constraint) et les arêtes ne sont pas touchés.
- **Aucun ajout possible par construction** : la sortie filtrée est la sortie d'Astra dont on retire
  les groupes jugés « non_soutenu ». L'outillage ne lit dans la réponse que `act`, `verdict`,
  `reason`, `excerpt` ; tout autre contenu est ignoré ; un identifiant inconnu est ignoré et journalisé.
- **Retrait seulement sur décision explicite et valide** : `non_soutenu` avec motif non vide. Décision
  manquante, invalide ou sans motif → l'acte est gardé (journalisé `kept_no_valid_decision`).
- « soutenu » dont l'extrait n'est pas retrouvé mot à mot dans le texte gelé (normalisation v9) :
  acte gardé, journalisé `supported_ungrounded` (compteur publié).
- Document dont la réponse n'est pas du JSON valide → sortie d'Astra inchangée pour ce document,
  journalisé et relancé une fois ; le bras reste noté sur 100 documents.
