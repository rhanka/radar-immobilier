// Mini-schémas par option (§7 du dossier) : ce que l'option change, sur un exemple réel.
// `bars` = comptes avant / après (source : rows.json et sim.json des preuves) ;
// `table` = lignes de graph_nodes et leur clé, pour bylaw-242 de gore et barkmere.
// mapping.test.mjs vérifie que chaque chiffre figure dans la description de l'option.
const bars = (title, unit, rows) => ({ type: 'bars', title, unit, rows });
const row = (label, value, tone = 'neutral', note = '') => ({ label, value, tone, note });
const table = (title, key, rows, note, tone) => ({ type: 'table', title, key, rows, note, tone });

export const miniDiagrams = {
  'D1-a': bars('acton-vale · nœuds', 'nœuds', [row('S3 avant', 37), row('PG avant', 473, 'alert', 'dont 436 vides'), row('S3 après', 37), row('PG après', 37, 'good')]),
  'D1-b': bars('acton-vale · nœuds', 'nœuds', [row('S3', 37), row('PG', 473, 'alert', 'inchangé, 436 vides')]),
  'D1-c': bars('acton-vale · nœuds', 'nœuds', [row('S3 avant', 37), row('S3 après', 473, 'alert', '436 vides copiés'), row('PG', 473, 'alert', 'inchangé')]),
  'D2-A': table('graph_nodes · clé id', 'id', [['gore:bylaw-242', 'gore', 'PV de gore'], ['barkmere:bylaw-242', 'barkmere', 'PV de barkmere']], 'deux lignes ; identifiants changés partout', 'warn'),
  'D2-B': table('graph_nodes · clé id', 'id', [['bylaw-242', 'gore', 'PV de gore'], ['barkmere--bylaw-242', 'barkmere', 'PV de barkmere']], 'S3 de barkmere dit bylaw-242 : écart', 'warn'),
  'D2-C': table('graph_nodes · clé (city_slug, id)', 'city_slug, id', [['bylaw-242', 'gore', 'PV de gore'], ['bylaw-242', 'barkmere', 'PV de barkmere']], 'deux lignes ; identifiants inchangés', 'good'),
  'D4-a': bars('dixville · signaux complets', 'signaux', [row('S3 avant', 5), row('PG', 10), row('S3 après', 10, 'good')]),
  'D4-b': bars('dixville · signaux complets', 'signaux', [row('S3', 5, 'alert'), row('PG', 10)]),
  'D5-a': bars('victoriaville · signaux complets', 'signaux', [row('S3 avant', 0, 'alert'), row('PG', 15), row('S3 après', 15, 'good')]),
  'D5-b': bars('victoriaville · signaux complets', 'signaux', [row('S3', 0, 'alert'), row('PG', 15)]),
  'D7-a': bars('brigham · signaux complets', 'signaux', [row('S3', 9), row('PG avant', 0, 'alert'), row('PG après', 9, 'good')]),
  'D7-b': bars('brigham · signaux complets', 'signaux', [row('S3', 9), row('PG', 0, 'alert', 'reste sur juin')]),
  'D7-c': bars('brigham · signaux complets', 'signaux', [row('S3 avant', 9), row('S3 après', 0, 'alert', 'juillet écrasé'), row('PG', 0, 'alert')]),
};
