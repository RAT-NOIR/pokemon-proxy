// node test-provenance-bulba.js — la provenance PAR CHAMP des données d'origine Bulbapedia, et la marque « à reconfirmer » (décision du testeur, 2026-10-17 :
// « pour les cas sans aucun remplaçant, garde la valeur, marque-la à reconfirmer, et ne la sers pas comme seule preuve d'une identification »).
// Fonctions pures, faux objets. `suite(module)` est rejouée contre des mutants (test-mutants-bulba.js).
const { setsTouches } = require('./collecte-cartes/garde-lot');

function suite(M) {
    let ok = 0, ko = 0;
    const verifier = (nom, obtenu, attendu) => {
        const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
        if (a === b) { ok++; if (require.main === module) console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
    };
    const { planifierProvenance, appliquer } = M;
    const T0 = new Date('2026-10-18T00:00:00Z'), T1 = new Date('2026-10-19T00:00:00Z');
    const copie = o => structuredClone(o);

    // une carte, deux impressions (une intl appariée, une japonaise sans source)
    const carte = (o = {}) => ({ _id: 1, nomEn: 'Seadra', nomJa: 'シードラ', pv: 60, retraite: 1, categorie: 'pokemon', ndex: 117, secret: 'inchange',
        impressions: [{ tirage: 'intl', expansion: 'Fossil', numero: '42', total: '62', rarete: 'Uncommon', illustrateur: 'K' }, { tirage: 'jp', expansion: 'Mystery of the Fossils', numero: null, total: null, rarete: 'Uncommon' }], ...o });
    const lg = (champ, cle, bulba, parSource, statut, contexte = {}) => ({ champ, cle, bulba, statut, parSource, contexte: { carteId: 1, nomEn: 'Seadra', categorie: 'pokemon', ...contexte } });
    const S = (statut, valeur = null) => ({ statut, valeur });
    const lignesDe = () => [
        lg('carte.pv', 1, 60, { pkc: S('ok', 60), tdx: S('ok', 60) }, 'accord'),
        lg('carte.retraite', 1, 1, {}, 'sans'),
        lg('carte.ndex', 1, 117, { tdx: S('ok', 117) }, 'accord'),
        lg('impression.total', '1#0', '62', { pkc: S('ok', 62) }, 'accord', { tirage: 'intl' }),
        lg('impression.rarete', '1#0', 'Uncommon', { pkc: S('ok', 'Uncommon'), tdx: S('ok', 'Uncommon') }, 'accord', { tirage: 'intl' }),
    ];
    const appar = [{ carteId: 1, idx: 0, tirage: 'intl', src: 'pkc', nomOk: true }, { carteId: 1, idx: 0, tirage: 'intl', src: 'tdx', nomOk: true }];
    const plan = (o = {}) => planifierProvenance({ cartes: [carte()], sets: [], lignes: lignesDe(), appariements: appar, arbitrages: [], maintenant: T0, ...o });
    const ecr = (p, collection = 'cartes') => p.ecritures.find(e => e.collection === collection);

    // ── 1. CONFIRMÉ : au moins une source indépendante concorde → source, confirmePar, le ; PAS de marque
    let p = plan(); let e = ecr(p).champs;
    verifier('pv confirmé par deux sources : { source, confirmePar, le }, sans marque', e['provenance.pv'], { source: 'bulbapedia', confirmePar: ['pkmncards', 'tcgdex'], le: T0 });
    verifier('ndex confirmé par une source', e['provenance.ndex'].confirmePar, ['tcgdex']);
    // ── 2. SANS AUCUN REMPLAÇANT : la valeur reste, la marque est posée par champ
    verifier('retraite sans source : « à reconfirmer », confirmePar vide', e['provenance.retraite'], { source: 'bulbapedia', confirmePar: [], aReconfirmer: true, le: T0 });
    // ── 3. LE NOM ET LE NUMÉRO : confirmés par l'appariement (set, numéro) dont le nom concorde
    verifier('nomEn confirmé par les sources dont l’appariement (set, numéro) a un nom concordant', e['provenance.nomEn'].confirmePar, ['pkmncards', 'tcgdex']);
    verifier('nomJa sans appariement japonais : à reconfirmer', [e['provenance.nomJa'].aReconfirmer, e['provenance.nomJa'].confirmePar], [true, []]);
    const imp = e['provenance.impressions'];
    verifier('impression intl : clé tirage|expansion|numéro, numéro confirmé', [imp[0].k, imp[0].numero.confirmePar], ['intl|Fossil|42', ['pkmncards', 'tcgdex']]);
    verifier('impression intl : total et rareté confirmés', [imp[0].total.confirmePar, imp[0].rarete.confirmePar], [['pkmncards'], ['pkmncards', 'tcgdex']]);
    verifier('impression japonaise sans source : rareté à reconfirmer, numéro absent donc sans entrée, total non numérique ignoré', [imp[1].k, imp[1].rarete.aReconfirmer, 'numero' in imp[1], 'total' in imp[1]], ['jp|Mystery of the Fossils|', true, false, false]);
    p = plan({ appariements: [{ carteId: 1, idx: 0, tirage: 'intl', src: 'pkc', nomOk: false }] });
    verifier('nom divergent à l’appariement : ni le nom ni le numéro ne sont confirmés', [ecr(p).champs['provenance.nomEn'].aReconfirmer, ecr(p).champs['provenance.impressions'][0].numero.aReconfirmer], [true, true]);
    p = plan({ cartes: [carte({ nomEn: 'Seadra' })], appariements: [{ carteId: 1, idx: 1, tirage: 'jp', src: 'jp', nomOk: true }] });
    verifier('nomJa confirmé par pokemon-card.com (appariement japonais, nom concordant)', ecr(p).champs['provenance.nomJa'].confirmePar, ['pokemon-card.com']);

    // ── 4. DÉSACCORDS : l'arbitrage décide ; une valeur contestée n’est JAMAIS « confirmée » par défaut
    const desacc = (verdict, extra = {}) => ({ champ: 'carte.pv', cle: 1, verdict, temoins: [], ...extra });
    const lDes = () => [lg('carte.pv', 1, 60, { pkc: S('ko', 50) }, 'desaccord')];
    p = plan({ lignes: lDes(), arbitrages: [desacc('indecidable')] });
    verifier('désaccord indécidable : à reconfirmer + la source qui contredit', [ecr(p).champs['provenance.pv'].aReconfirmer, ecr(p).champs['provenance.pv'].contredit], [true, ['pkmncards']]);
    p = plan({ lignes: lDes(), arbitrages: [desacc('fausse', { correction: 50 })] });
    verifier('désaccord arbitré « fausse » : à reconfirmer (la valeur reste, la correction attend son lot)', [ecr(p).champs['provenance.pv'].aReconfirmer, ecr(p).champs['provenance.pv'].contredit], [true, ['pkmncards']]);
    p = plan({ lignes: lDes(), arbitrages: [desacc('juste', { raison: 'convention de nom', temoins: [{ source: 'tdx', valeur: 'x' }, { source: 'convention-calibree', valeur: {} }] })] });
    verifier('désaccord arbitré « juste » : confirmé par les sources témoins, pas par les tables', [ecr(p).champs['provenance.pv'].confirmePar, ecr(p).champs['provenance.pv'].aReconfirmer ?? false, ecr(p).champs['provenance.pv'].via], [['tcgdex'], false, 'convention de nom']);
    p = plan({ lignes: lDes(), arbitrages: [] });
    verifier('désaccord SANS arbitrage : jamais confirmé (la garde s’écrit par ce qu’elle autorise)', ecr(p).champs['provenance.pv'].aReconfirmer, true);
    p = plan({ lignes: [lg('carte.pv', 1, 60, { pkc: S('approx', 60) }, 'approx')] });
    verifier('inclusion (approx) : confirmé en partie', [ecr(p).champs['provenance.pv'].confirmePar, ecr(p).champs['provenance.pv'].partiel], [['pkmncards'], true]);

    // ── 5. ADDITIF : aucune valeur n’est modifiée, tout ce qui s’écrit est sous `provenance.`
    p = plan();
    verifier('tous les chemins écrits sont sous « provenance. »', Object.keys(ecr(p).champs).every(k => k.startsWith('provenance.')), true);
    const avant = carte(); const apres = appliquer(copie(avant), ecr(p).champs);
    const sansProv = o => { const c = copie(o); delete c.provenance; return c; };
    verifier('le document, hors provenance, est identique', sansProv(apres), avant);
    verifier('aucun nom de source dans un champ public (hors provenance)', JSON.stringify(sansProv(apres)).match(/pkmncards|tcgdex|pokemon-card|bulbapedia/i), null);
    // la garde de lot ne lit pas la provenance : aucun set revalidé, aucun compte du catalogue
    const touches = setsTouches({ avant: { cartes: [avant], cartesProduits: [], sets: [] }, apres: { cartes: [apres], cartesProduits: [], sets: [] } });
    verifier('la garde de lot ne voit pas la provenance : 0 set revalidé', [touches.sets, touches.catalogue, touches.especes], [[], false, false]);

    // ── 6. IDEMPOTENT : rejouer le plan sur le résultat n’écrit rien
    const rejeu = planifierProvenance({ cartes: [apres], sets: [], lignes: lignesDe(), appariements: appar, arbitrages: [], maintenant: T1 });
    verifier('idempotent : rejouer sur le résultat n’écrit rien (même avec une autre date)', [rejeu.ecritures.length, rejeu.compte.champsAEcrire], [0, 0]);
    verifier('le compte annonce les champs à écrire (attendu)', plan().compte.champsAEcrire, 9);

    // ── 7. MONOTONE : on améliore, on ne dégrade jamais
    const existant = (champs) => carte({ provenance: champs });
    p = plan({ cartes: [existant({ retraite: { source: 'bulbapedia', confirmePar: [], aReconfirmer: true, le: T0 }, pv: { source: 'bulbapedia', confirmePar: ['tcgdex'], le: T0 } })], lignes: [lg('carte.retraite', 1, 1, { tdx: S('ok', 1) }, 'accord'), lg('carte.pv', 1, 60, { pkc: S('ok', 60) }, 'accord')], maintenant: T1 });
    verifier('à reconfirmer + une source qui confirme désormais → confirmé', ecr(p).champs['provenance.retraite'], { source: 'bulbapedia', confirmePar: ['tcgdex'], le: T1 });
    verifier('confirmé par tcgdex + pkmncards confirme aussi → union', ecr(p).champs['provenance.pv'].confirmePar, ['pkmncards', 'tcgdex']);
    p = plan({ cartes: [existant({ pv: { source: 'bulbapedia', confirmePar: ['tcgdex'], le: T0 } })], lignes: [lg('carte.pv', 1, 60, {}, 'sans')] });
    verifier('confirmé hier, aucune source aujourd’hui : la confirmation reste (jamais de dégradation)', (ecr(p)?.champs['provenance.pv']) ?? 'inchangé', 'inchangé');

    // ── 8. SETS : seulement les champs dont l'origine est Bulbapedia
    const set = (o = {}) => ({ _id: 'Fossil', dateSortieEn: 'October 10, 1999', totalImprime: 62, dateSortieJa: 'x', type: 'extension', typeSource: 'bulbapedia:infobox', ...o });
    const lS = [lg('set.dateSortieEn', 'Fossil', '1999-10-10', { tdx: S('ok', '1999-10-10') }, 'accord', { setId: 'Fossil' }), lg('set.totalImprime', 'Fossil', 62, { pkc: S('ko', 61) }, 'desaccord', { setId: 'Fossil' })];
    p = planifierProvenance({ cartes: [], sets: [set()], lignes: lS, appariements: [], arbitrages: [{ champ: 'set.totalImprime', cle: 'Fossil', verdict: 'indecidable', temoins: [] }], maintenant: T0 });
    e = ecr(p, 'sets').champs;
    verifier('set : date confirmée, total contesté à reconfirmer, date japonaise et type sans remplaçant à reconfirmer', [e['provenance.dateSortieEn'].confirmePar, e['provenance.totalImprime'].aReconfirmer, e['provenance.dateSortieJa'].aReconfirmer, e['provenance.type'].aReconfirmer], [['tcgdex'], true, true, true]);
    p = planifierProvenance({ cartes: [], sets: [set({ dateSortieEnSource: 'tcgdex:me05:idExpansion+nom', dateSortieJa: '', typeSource: 'ptcg-assets' })], lignes: [], appariements: [], arbitrages: [], maintenant: T0 });
    verifier('set : une date dont la source écrite n’est pas Bulbapedia n’a pas de provenance Bulbapedia ; valeur vide ou type d’une autre source : rien', Object.keys(ecr(p, 'sets').champs), ['provenance.totalImprime']);
    verifier('cartes sans le marqueur Bulbapedia ignorées', planifierProvenance({ cartes: [], sets: [], lignes: [], appariements: [], arbitrages: [], maintenant: T0 }).ecritures, []);
    // ── 8 bis. DEUX impressions à la même clé (tirage|expansion|numéro — fréquent au japonais sans numéro) : chacune a SA provenance, la seconde sous « #2 »
    p = plan({ cartes: [carte({ impressions: [{ tirage: 'jp', expansion: 'X', numero: null, rarete: 'Rare' }, { tirage: 'jp', expansion: 'X', numero: null, rarete: 'Common' }] })], lignes: [], appariements: [] });
    verifier('clés en double : « jp|X| » puis « jp|X|#2 », compte des doublons à zéro (plus rien d’ignoré)', [ecr(p).champs['provenance.impressions'].map(x => x.k), p.compte.doublonsCle], [['jp|X|', 'jp|X|#2'], 0]);
    const rejeuD = planifierProvenance({ cartes: [appliquer(carte({ impressions: [{ tirage: 'jp', expansion: 'X', numero: null, rarete: 'Rare' }, { tirage: 'jp', expansion: 'X', numero: null, rarete: 'Common' }] }), ecr(p).champs)], sets: [], lignes: [], appariements: [], arbitrages: [], maintenant: T1 });
    verifier('clés en double : idempotent aussi', rejeuD.compte.champsAEcrire, 0);

    // ── 8 ter. LE CHARGEUR LIT TOUT CE QUE LE PLANIFICATEUR LIT (une projection trop étroite lisait « absent » : les sources de date n'étaient pas chargées)
    const { PROJ_CARTES, PROJ_SETS } = require('./collecte-cartes/charger-bulba');
    verifier('projection des sets ⊇ champs lus par le planificateur', M.CHAMPS_LUS.sets.filter(k => !(k in PROJ_SETS)), []);
    verifier('projection des cartes ⊇ champs lus par le planificateur', M.CHAMPS_LUS.cartes.filter(k => !(k in PROJ_CARTES)), []);

    // ── 9. LA LIGNE DE COMMANDE s'écrit par ce qu'elle AUTORISE ; --attendu est obligatoire avec --ecrire ; le plan doit retrouver ce nombre AVANT toute écriture
    const { analyserArguments, verifierPlan, verifierRelecture } = M;
    verifier('arguments : sans option = simulation', analyserArguments([]), { erreurs: [], ecrire: false, attendu: null, viaEcriture: false });
    verifier('arguments : --ecrire sans --attendu refusé', analyserArguments(['--ecrire']).erreurs.length, 1);
    verifier('arguments : --attendu sans --ecrire refusé', analyserArguments(['--attendu=3']).erreurs.length, 1);
    verifier('arguments : --attendu non entier refusé', analyserArguments(['--ecrire', '--attendu=abc']).erreurs.length, 1);
    verifier('arguments : inconnu refusé', analyserArguments(['--tout-effacer']).erreurs.length, 1);
    verifier('arguments : --ecrire --attendu=12 accepté', analyserArguments(['--ecrire', '--attendu=12']), { erreurs: [], ecrire: true, attendu: 12, viaEcriture: false });
    verifier('plan différent de l’attendu : refus avant toute écriture', [verifierPlan(9, 9), typeof verifierPlan(8, 9)], [null, 'string']);
    verifier('relecture : écrits ≠ attendus, ou restes après écriture, sont des discordances', [verifierRelecture({ ecrits: 9, attendu: 9, restants: 0 }), typeof verifierRelecture({ ecrits: 8, attendu: 9, restants: 0 }), typeof verifierRelecture({ ecrits: 9, attendu: 9, restants: 2 })], [null, 'string', 'string']);
    return { ok, ko };
}
module.exports = { suite };

if (require.main === module) {
    const { ok, ko } = suite(require('./collecte-cartes/provenance-bulba'));
    console.log(`\n${ok} passés, ${ko} en échec`);
    if (ko) process.exit(1);
}
