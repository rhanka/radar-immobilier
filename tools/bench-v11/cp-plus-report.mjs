// Add measured CP+ evidence without changing the 42 historical global rows.
export function cpPlusRows(arm) {
  return [["Astra medium (rejeu v12)", arm.source], ["CP+", arm]].map(([label, value]) => ({
    label, accepted: value.accepted, p: value.strict.precision, r: value.strict.recall,
    f1: value.strict.f1, api: value.usdApiEquivPerDoc, seat: null,
  }));
}

export function cpPlusSection(arm) {
  const f = (value, digits = 3) => value == null ? "missing source" : value.toFixed(digits);
  const a = arm.source;
  const surface = arm.surface;
  const row = (label, value, judged = "—", removed = "—") => `| ${label} | ${value.accepted} | ${f(value.strict.precision)} | ${f(value.strict.recall)} | ${f(value.strict.f1)} | ${judged} | ${removed} | ${f(value.usdApiEquivPerDoc, 5)} | missing source |`;
  return [
    "## CP+ mesurée",
    "",
    "Mesure réelle du 13 novembre 2026 UTC. GPT-6 Astra medium extrait les 100 documents. Muse Spark 1.3 xhigh relit ensuite les sorties acceptées. Le filtre CP reste inchangé. Aucun acte ne peut être ajouté. Les 42 lignes du tableau global restent intactes.",
    "",
    "| Bras | Acceptés /100 | P | R | F1 strict | Actes jugés | Actes retirés | Équiv. API USD/doc | USD siège/doc |",
    "|---|---|---|---|---|---|---|---|---|",
    "| GPT-6 Astra medium (publié) | 99 | 0.371 | 0.534 | 0.438 | — | — | 0.4689 | 0.0207 |",
    row("GPT-6 Astra medium (rejeu v12)", a),
    "| CP publié (Astra medium → Gemini 3.8 Flash low) | 99 | 0.484 | 0.533 | 0.507 | 912 | 229 | 0.4813 | 0.0212 |",
    row("CP+ (Astra medium → Muse Spark 1.3 xhigh)", arm, arm.actsJudged, arm.actsRemoved),
    "",
    `Notation : oracle 676, 43 non résolus neutres, scoreur strict inchangé. Rejeu : TP ${a.strict.tp}, FP ${a.strict.fp}, FN ${a.strict.fn}. CP+ : TP ${arm.strict.tp}, FP ${arm.strict.fp}, FN ${arm.strict.fn}. Le gain du filtre se mesure contre le rejeu qui lui sert de source. Le bras publié reste une autre exécution.`,
    "",
    `Relecture : ${arm.calls} appels, ${arm.actsJudged} actes jugés, ${arm.actsRemoved} retirés. Décisions absentes ou invalides : ${arm.keptNoValidDecision} actes conservés. Extraits « soutenu » non retrouvés : ${arm.supportedUngrounded} actes conservés. Ces règles sont celles de CP. Le bloc de filtre garde le SHA-256 cf015e57c6e1cd1404efc7e22ddb014da0e4851aba9befea9ef39cae46094b68. Les 99 messages CP archivés ont été reproduits octet pour octet avant le lancement.`,
    "",
    "**Transport et surface d’accès.** Rejeu : `CodexRuntimeClient`, llm-mesh 0.19.3, siège Codex, `gpt-6-astra`, effort medium, messages système et utilisateur gelés, format JSON objet. Aucun plafond de sortie, comme dans le bras v10/v11alpha. Le validateur v9 et la provenance sont inchangés. Le SDK reçoit un seul appel de génération par tentative. Aucun outil, skill ou tour d’agent n’est fourni. Le cwd de l’orchestrateur est vide, hors dépôt. Concurrence 4.",
    "",
    `Relecteur : CLI Muse 1.4.18, siège, modèle public muse-spark-1.3, effort xhigh, --contributor-mode off, --json. Cwd vide hors dépôt. Concurrence 4. Aucun drapeau de restriction d’outils, de rappels ou de tours. Exécution dans un conteneur Node 24, avec le binaire Muse du siège. Le catalogue exact d’outils et la disponibilité effective des outils hôtes restent unverified. Observation sur ${surface.docs} flux : ${surface.docsWithToolCalls.length} document(s) avec outil ; ${surface.docsWithMoreThanOneModelResponse.length} avec plusieurs réponses modèle. Histogramme des réponses : ${JSON.stringify(surface.modelResponsesHistogram)}. Skills déclarées par la CLI : ${surface.skillsLines.filter(Boolean).join(" ; ") || "unverified"}. Les preuves détaillées sont dans surface.json.`,
    "",
    `**Quotas.** Codex hebdomadaire : ${a.quota.before.weeklyUsedPercent} % avant → ${a.quota.after.weeklyUsedPercent} % après ; ${a.quota.events} événement(s) quota. Muse hebdomadaire : ${arm.summary.weeklyBefore} % avant la relecture → ${arm.summary.weeklyAfter} % après. Lecture avant chaque document et toutes les 10 minutes. Arrêt à 85 %, y compris les appels en cours. Une interruption de quota empêche la publication d’un score complet ; elle ne devient jamais un refus modèle. Les compteurs sont partagés avec les autres sessions du compte. Aucun coût siège n’est attribuable : missing source.`,
    "",
    `**Coûts.** Jetons réels sur les deux étages. Dénominateur : 100 documents du corpus. Extraction : entrée ${a.tokens.input}, sortie rapportée ${a.tokens.output}. Relecture : entrée ${arm.tokens.input}, cache ${arm.tokens.cached}, sortie rapportée ${arm.tokens.output}, raisonnement ${arm.tokens.reasoning}. Tarifs Astra repris du calculateur v10 : 10 / 50 USD par million, entrée / sortie, sans réduction de cache. Tarif Spark confirmé sur la page primaire https://dev.meta.ai/models/muse-spark/ le 13 novembre 2026 : 1,25 / 0,15 / 4,25 USD par million, entrée / cache / sortie. Équivalent du second étage seul : ${f(arm.reviewerApiPerCorpusDoc, 5)} USD par document du corpus.`,
    "",
    `Hypothèse A : sortie rapportée, raisonnement probablement inclus. Le coût CP+ du tableau additionne les deux étages. Hypothèse B : ajout séparé du raisonnement Muse, soit ${f(arm.usdApiEquivWithExtraReasoning, 5)} USD par document pour CP+. La page Meta ne tranche pas ce point. Les entrées Muse incluent le contexte propre de la CLI. Ce coût ne représente donc pas un appel API limité au seul prompt du filtre.`,
    "",
    "**Incident et exclusion.** Un premier passage a reçu des écritures de plusieurs runners. Il contient 99 réponses distinctes, avec jusqu’à 16 fenêtres de tentative qui se chevauchent, attente d’acquisition comprise. La limite globale de quatre appels ne peut pas être attestée. Ce passage est archivé sous astra-medium-rejeu-overlap-20261113 et exclu des scores et coûts du tableau. Un lancement s’est terminé avec le code 137. Les conteneurs restants ont été arrêtés ou ont terminé. Les 100 documents ont ensuite été rejoués par un seul runner verrouillé. Le scoreur vérifie un maximum de quatre tentatives simultanées sur ce nouveau passage. Codex était à 61 % au premier contrôle de la lane, puis à 67 % avant ce nouveau rejeu. Ces variations de compteur partagé ne sont pas attribuées à un coût siège.",
    "",
    "Preuves locales : tools/bench-v11/full/arms/astra-medium-rejeu/ et cp-plus-muse13-xhigh/ ; scores-astra-rejeu.json et scores-cp-plus.json. Runners, filtre et scoreur sont versionnés dans le harnais. Les sorties brutes et reçus sont conservés localement, hors Git.",
    "",
  ].join("\n");
}
