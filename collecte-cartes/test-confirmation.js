// node collecte-cartes/test-confirmation.js — le marqueur additif `confirmation` d'une ligne cartes_produits (B1, 2026-10-26). Fonctions PURES : aucune base, aucun fichier, aucune requête.
// Chaque cas nomme la règle qu'il fixe. La règle de production relue est collecte-cartes/deux-sources.js (rejouer) : ce module ne recopie rien.
const C = require(process.env.CONFIRMATION_MODULE || './confirmation');   // la variable ne sert qu'à test-mutation-confirmation.js (module muté, jamais en production)

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

const LE = new Date('2026-10-26T12:00:00Z');
const PRODUIT = { set: 'EX-Emerald', numero: '103', nom: 'Water Energy' };
const CONC = { source: 'tcgdex', ref: 'ex9-103', set: 'EX-Emerald', numero: '103', nom: 'Water Energy', par: 'nom' };
const LIGNE = { carteId: 7, idProduct: 11, numeroFiche: null, slugSet: 'EX-Emerald' };
const conf = (o = {}) => C.construire({ carteId: 7, produit: PRODUIT, concordantes: [CONC], le: LE, ...o });
const concorde = (c, o = {}) => C.confirmationConcorde(c, { ligne: LIGNE, produit: PRODUIT, ...o });

// ── la forme écrite
const c0 = conf();
verifier('construire : sources (Cardmarket + les indépendantes), valeurs, carteId, concordantes, date, instrument', { s: c0.sources, v: c0.valeurs, id: c0.carteId, n: c0.concordantes.length, le: c0.le.toISOString(), i: c0.instrument },
    { s: ['cardmarket', 'tcgdex'], v: { set: 'EX-Emerald', numero: '103', nom: 'Water Energy' }, id: 7, n: 1, le: '2026-10-26T12:00:00.000Z', i: C.INSTRUMENT });
verifier('construire : deux relevés de la MÊME source = une seule source indépendante', conf({ concordantes: [CONC, { ...CONC, ref: 'autre' }] }).sources, ['cardmarket', 'tcgdex']);
verifier('construire : deux sources distinctes sont nommées toutes les deux', conf({ concordantes: [CONC, { ...CONC, source: 'artofpkm', ref: 'images 1' }] }).sources, ['cardmarket', 'tcgdex', 'artofpkm']);

// ── la confirmation concorde avec la ligne ACTUELLE
verifier('une confirmation intacte sur sa ligne : valide', concorde(c0), { ok: true, motifs: [] });
verifier('le numéro Cardmarket du produit a changé depuis : ignorée', concorde(c0, { produit: { ...PRODUIT, numero: '104' } }).ok, false);
verifier('le nom du produit a changé depuis : ignorée', concorde(c0, { produit: { ...PRODUIT, nom: 'Fire Energy' } }).ok, false);
verifier('le set du produit a changé depuis : ignorée', concorde(c0, { produit: { ...PRODUIT, set: 'EX-Dragon' } }).ok, false);
verifier('la ligne désigne maintenant une AUTRE carte : ignorée', concorde(c0, { ligne: { ...LIGNE, carteId: 8 } }).ok, false);
verifier('la ligne porte un autre numeroFiche : ignorée', concorde(c0, { ligne: { ...LIGNE, numeroFiche: '104' } }).ok, false);
verifier('la ligne porte le MÊME numeroFiche (zéros de tête près) : valide', concorde(c0, { ligne: { ...LIGNE, numeroFiche: '0103' } }).ok, true);
verifier('la ligne est rattachée à un autre set : ignorée', concorde(c0, { ligne: { ...LIGNE, slugSet: 'EX-Dragon' } }).ok, false);
verifier('la fiche servie porte un autre numéro que celui confirmé : ignorée', concorde(c0, { ficheNumero: '104' }).ok, false);
verifier('la fiche servie porte le numéro confirmé : valide', concorde(c0, { ficheNumero: '103' }).ok, true);
verifier('la fiche servie sans numéro : la confirmation ne dit rien de plus, elle reste valide (le motif sans-numero, lui, reste)', concorde(c0, { ficheNumero: null }).ok, true);
// la valeur écrite dans la confirmation elle-même
verifier('valeurs.numero altéré dans la confirmation : ignorée', concorde({ ...c0, valeurs: { ...c0.valeurs, numero: '999' } }).ok, false);
verifier('valeurs.nom altéré dans la confirmation : ignorée', concorde({ ...c0, valeurs: { ...c0.valeurs, nom: 'Fire Energy' } }).ok, false);

// ── les deux sources, rejouées par la règle de production
verifier('une concordante Bulbapedia : ignorée (la règle de production la refuse)', concorde(conf({ concordantes: [{ ...CONC, source: 'bulbapedia' }] })).ok, false);
verifier('une source hors de la liste admise : ignorée', concorde(conf({ concordantes: [{ ...CONC, source: 'inconnue' }] })).ok, false);
verifier('une concordante sans nom lisible ni Pokédex : ignorée', concorde(conf({ concordantes: [{ ...CONC, nom: null }] })).ok, false);
verifier('une seule concordante fautive parmi deux refuse tout', concorde(conf({ concordantes: [CONC, { ...CONC, source: 'artofpkm', numero: '104' }] })).ok, false);
verifier('aucune concordante : ignorée', concorde({ ...c0, concordantes: [] }).ok, false);
verifier('sources déclare une source que les concordantes ne portent pas : ignorée', concorde({ ...c0, sources: ['cardmarket', 'tcgdex', 'pikaqian'] }).ok, false);
verifier('sources sans Cardmarket : ignorée', concorde({ ...c0, sources: ['tcgdex'] }).ok, false);
verifier('Cardmarket seul (aucune source indépendante) : ignorée', concorde({ ...c0, sources: ['cardmarket'], concordantes: [] }).ok, false);

// ── jamais d'exception sur un champ mal formé (une garde qui lève sur un cas inattendu n'est pas lue : elle refuse)
for (const [nom, v] of [['null', null], ['chaîne', 'oui'], ['nombre', 1], ['objet vide', {}], ['tableau', []]])
    verifier(`confirmation mal formée (${nom}) : ignorée, sans exception`, concorde(v).ok, false);

// ── une contradiction lisible entre sources
const refus = (source, X, Y) => ({ source, ref: 'r', raison: `nom discordant (« ${X} » / « ${Y} »)` });
verifier('contradictions : un relevé LISIBLE qui dit un autre nom au même set et numéro', C.contradictions([refus('artofpkm', 'Fire Energy', 'Water Energy')]).length, 1);
verifier('contradictions : une finition en plus (« Water Energy Pokeball Holo ») n\'est pas un autre nom', C.contradictions([refus('pikaqian', 'Water Energy Pokeball Holo', 'Water Energy')]).length, 0);
verifier('contradictions : un nom illisible (japonais) ne contredit rien', C.contradictions([refus('tpc-asie', '基本水エネルギー', 'Water Energy')]).length, 0);
verifier('contradictions : un refus d\'une autre nature (numéro, set) n\'est pas une contradiction', C.contradictions([{ source: 'tcgdex', raison: 'numéro différent (104 / 103)' }]).length, 0);
verifier('contradictions : absent ou vide', [C.contradictions(undefined).length, C.contradictions([]).length], [0, 0]);

// ── ce que le classement de la fiche reçoit (audit-catalogue/etat-api.js l'appelle sur la ligne de la fiche servie)
const L2 = { ...LIGNE, confirmation: c0 };
verifier('pourClasser : une ligne sans champ confirmation : null (rien à lire, rien à compter)', [C.pourClasser(LIGNE, { produit: PRODUIT }), C.pourClasser(undefined, { produit: PRODUIT }), C.pourClasser({ ...LIGNE, confirmation: null }, { produit: PRODUIT })], [null, null, null]);
verifier('pourClasser : une confirmation qui concorde', C.pourClasser(L2, { produit: PRODUIT, ficheNumero: '103' }), { concorde: true });
verifier('pourClasser : une confirmation qui ne concorde plus', C.pourClasser({ ...L2, numeroFiche: '9' }, { produit: PRODUIT }), { concorde: false });
verifier('pourClasser : un produit illisible (set absent) : ne concorde pas, sans exception', C.pourClasser(L2, { produit: { set: null, numero: '103', nom: 'Water Energy' } }), { concorde: false });

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
