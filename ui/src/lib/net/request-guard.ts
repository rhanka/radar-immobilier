/**
 * request-guard — garde « dernière requête gagne » (latest-wins) pour
 * sérialiser une séquence de chargements asynchrones d'UNE ressource
 * (ex. « les couches carte de la ville sélectionnée »).
 *
 * Motivation (bug vues carte) : au changement rapide de ville, plusieurs
 * chargements se chevauchent. Sans garde, la réponse EN RETARD d'une ville
 * précédente écrasait l'état de la ville courante (« peint la mauvaise ville »).
 *
 * Le garde combine DEUX mécanismes complémentaires :
 *  - un JETON monotone : chaque bail (`lease`) porte un `token` ; seul le bail
 *    le plus récent est « courant » (`isCurrent()`), donc seul lui a le droit de
 *    COMMITTER son résultat. Une réponse en retard est ignorée silencieusement.
 *  - un `AbortController` : émettre un nouveau bail AVORTE le précédent, ce qui
 *    libère la socket et fait rejeter le `fetch` en cours (via son `signal`).
 *
 * Le jeton seul suffit à la correction (ignore la réponse périmée) ; l'abort est
 * un bonus (annule le travail réseau inutile au plus tôt).
 */

/** Un bail de requête émis par le garde. */
export interface RequestLease {
  /** Identité monotone de ce bail. */
  readonly token: number;
  /** Signal à passer au `fetch` : avorté quand un bail plus récent est émis. */
  readonly signal: AbortSignal;
  /** `true` tant que ce bail reste le plus récent émis par le garde. */
  isCurrent(): boolean;
}

export class RequestGuard {
  private tokenCounter = 0;
  private controller: AbortController | null = null;

  /**
   * Émet un bail frais et SUPERSÈDE tout bail en cours (abort + invalidation).
   * À appeler au tout début d'un nouveau chargement (ex. clic ville).
   */
  lease(): RequestLease {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const token = ++this.tokenCounter;
    const isCurrent = (): boolean => token === this.tokenCounter;
    return { token, signal: controller.signal, isCurrent };
  }

  /**
   * Supersède tout bail en cours SANS en émettre de nouveau (ex. « fermer la
   * sélection » / retour province). Toute réponse en retard devient périmée.
   */
  cancel(): void {
    this.controller?.abort();
    this.controller = null;
    this.tokenCounter += 1;
  }
}
