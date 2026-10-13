/**
 * QU'EST-CE QU'UNE IMPRESSION DE CE SET ? — la règle, écrite UNE fois (2026-10-12, DEMANDE-FILTRE-DECK.md).
 *
 * Plusieurs sets Cardmarket partagent un seul nom d'expansion Bulbapedia (`sets.bulba.expansion`) : trois
 * « Pokémon Card Game Classic », deux Half Decks sans expansion… Seul le DECK les sépare. Le catalogue écrit
 * `sets.deck` sur le set et `cartes.impressions[].deck` sur chaque impression. Sans ce filtre, la fiche d'un set
 * reprenait les impressions des autres decks : 27 fiches fantômes sur les trois Classic (une carte au numéro
 * qu'elle porte dans un AUTRE deck, sans produit).
 *
 * Une impression appartient à un set quand :
 *   son TIRAGE est celui du set, ET son EXPANSION est une des siennes, ET (le set n'a pas de deck, OU le deck de
 *   l'impression égale celui du set à `nd` près).
 * Écrite par ce qu'elle AUTORISE : une impression sans `deck`, sous un set qui en a un, n'appartient pas à ce set.
 * Un set sans `deck` ne change pas.
 *
 * ⛔ TOUTE lecture « les impressions de ce set » passe par ici : `impressionDuSet` en TypeScript,
 * `conditionImpressionMongo` dans une agrégation (qui ne peut pas faire de NFKC : elle reçoit la liste LITTÉRALE
 * des valeurs brutes de `impressions.deck` que `nd` rend égales au deck du set — `decksAcceptes`, lues par
 * `distinct` de lib/decksDuSet.ts, jamais une approximation). Ce module est PUR : aucun import, ni Next ni base ni lecteur —
 * les contrôles Node l'importent, et la COPIE de l'agent API (vérifiée par empreinte) l'embarque telle quelle.
 */

/**
 * La normalisation du SERVEUR, recopiée de `pokemon-proxy/collecte-cartes/numero-fiche.js` (`numerosDuSet`, 2026-10-12) :
 *   const nd = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
 * Le serveur applique déjà ce filtre à ses propres numéros de fiche ; les deux côtés doivent dire la même chose.
 */
export const nd = (s         )         => String(s ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** Ce qui définit un set pour ses impressions : le tirage, les expansions et, quand le set en porte un, le deck. */
                             
                 
                                                     
                                                                                                 
                       
 

                                    
                         
                            
                       
 

/**
 * Le deck d'un set tel que la règle le lit : `null` quand il est absent, nul, vide ou fait d'espaces (tour 2 du lot 2-A) — un
 * deck vide divisait la règle (TypeScript : une impression sans deck acceptée ; Mongo : refusée). UNE normalisation, lue partout.
 */
export function deckDuSet(deck                           )                {
  return typeof deck === "string" && nd(deck) !== "" ? deck : null;
}

/** La règle, en TypeScript. */
export function impressionDuSet(imp                   , cible            )          {
  if (imp.tirage !== cible.tirage) return false;
  if (!cible.expansions.includes(imp.expansion)) return false;
  const deck = deckDuSet(cible.deck);
  return deck === null || nd(imp.deck) === nd(deck);
}

/**
 * Les valeurs BRUTES de `impressions.deck` qui valent le deck du set pour `nd`, parmi `toutes` (le `distinct` de la
 * base). `null` : le set n'a pas de deck, aucune contrainte. `[]` : un deck que personne ne porte, donc aucune
 * impression (jamais « tout »).
 */
export function decksAcceptes(deckDuSetBrut                           , toutes                                        )                  {
  if (deckDuSet(deckDuSetBrut) === null) return null;
  const cible = nd(deckDuSetBrut);
  return [...new Set(toutes.filter((v)              => typeof v === "string" && nd(v) === cible))];
}

/**
 * La règle, en EXPRESSION MONGO sur l'impression `imp` (« $$i » dans un $filter, « $impressions » après un $unwind).
 * `region`, `expansions` et `decks` sont des expressions (les tableaux parallèles s'y expriment par
 * `$arrayElemAt`) ; `decks` vaut `null` (JavaScript) quand aucun set de l'appel n'a de deck : la condition est alors
 * exactement celle d'avant. Sinon, `$cond` sur `$isArray` : un set sans deck passe (son entrée vaut null), un set
 * à deck exige une valeur brute acceptée — une impression sans `deck` n'y est dans aucune liste.
 */
export function conditionImpressionMongo(imp        , region         , expansions         , decks                )                      {
  const clauses            = [{ $eq: [`${imp}.tirage`, region] }, { $in: [`${imp}.expansion`, expansions] }];
  if (decks !== null) clauses.push({ $cond: [{ $isArray: decks }, { $in: [`${imp}.deck`, decks] }, true] });
  return { $and: clauses };
}
