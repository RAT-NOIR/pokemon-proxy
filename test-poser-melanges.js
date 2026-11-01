// node test-poser-melanges.js — l'outil poser-melanges.js de bout en bout sur une FAUSSE connexion de la forme ouvrirConnexions() : { cartes: { db }, prod: { db }, fermer }.
// Aucune base réelle, aucun réseau. La fausse base sait filtrer comme les requêtes de l'outil : égalité (null = absent), $in, $exists, $not/$elemMatch.
const E = require('./poser-melanges');
const MM = require('./collecte-cartes/melanges');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

// ── la fausse base
const clone = v => JSON.parse(JSON.stringify(v), (k, x) => x);
function match(doc, f) {
    return Object.entries(f).every(([k, c]) => {
        const v = doc[k];
        if (c && typeof c === 'object' && !Array.isArray(c) && !(c instanceof Date)) {
            if ('$in' in c) return c.$in.some(x => (x === null ? v == null : v === x));
            if ('$exists' in c) return (v !== undefined) === c.$exists;
            if ('$not' in c) return !(Array.isArray(v) ? v : []).some(el => match(el, c.$not.$elemMatch));
            throw new Error('opérateur non géré : ' + JSON.stringify(c));
        }
        return c === null ? v == null : v === c;
    });
}
function fausseBase(donnees) {
    const col = n => (donnees[n] ||= []);
    const api = n => ({
        find: f => ({ toArray: async () => col(n).filter(d => match(d, f)).map(clone) }),
        updateOne: async (f, u) => {
            const d = col(n).find(x => match(x, f)); if (!d) return { modifiedCount: 0 };
            if (u.$set) Object.assign(d, clone(u.$set));
            if (u.$push) for (const [k, v] of Object.entries(u.$push)) (d[k] ||= []).push(clone(v));
            return { modifiedCount: 1 };
        },
    });
    return { collection: api };
}
const connexion = donnees => ({ cartes: { db: fausseBase(donnees) }, prod: { db: fausseBase(donnees.prod) }, fermer: async () => {} });

// ── les données : formes lues en base le 2026-11-01
const orig = (set, numero, cleR2) => ({ set, numero, cleR2, source: 'tcgdex', langue: 'en', w: 600, h: 825, vignette: { cleR2: 'v/' + cleR2 } });
const donnees = () => ({
    cartes_produits: [
        { _id: '223420|449623', carteId: 223420, idProduct: 449623, slugSet: 'Burning-Shadows', numeroFiche: null, preuve: 'metacarte+freres', prixMelangeTampon: true, tamponsConnus: ['championship', 'staff'], prixMelangeTamponPreuve: ['relevé du testeur, 2026-10-18 (idProduct 449623, « Staff + Championship »)'] },
        { _id: '223420|1', carteId: 223420, idProduct: 1, slugSet: 'Burning-Shadows', numeroFiche: '143' },
        { _id: '108512|868202', carteId: 108512, idProduct: 868202, slugSet: 'WCD-2011', preuve: 'wcd+origine+numero' },
        { _id: '108512|868203', carteId: 108512, idProduct: 868203, slugSet: 'WCD-2011', preuve: 'wcd+origine+numero' },
        { _id: '25184|869299', carteId: 25184, idProduct: 869299, slugSet: 'WCD-2008' },
        { _id: '25184|869300', carteId: 25184, idProduct: 869300, slugSet: 'WCD-2008' },
        { _id: '25184|869301', carteId: 25184, idProduct: 869301, slugSet: 'WCD-2008' },
        { _id: '25184|869302', carteId: 25184, idProduct: 869302, slugSet: 'WCD-2008' },
        { _id: '225372|449878', carteId: 225372, idProduct: 449878, slugSet: 'Ultra-Prism', numeroFiche: '153a', marqueurs: [{ type: 'LEAGUE', params: {} }, { type: 'PLACE', params: { rang: 2 } }] },
        { _id: '225372|449883', carteId: 225372, idProduct: 449883, slugSet: 'Ultra-Prism', numeroFiche: '153a', marqueurs: [{ type: 'LEAGUE', params: {} }, { type: 'PLACE', params: { rang: 3 } }] },
    ],
    cartes: [
        { _id: 223420, images: [orig('Burning-Shadows', '115', 'tcgdex/Burning-Shadows/115-223420.webp'), orig('Burning-Shadows', '143', 'tcgdex/Burning-Shadows/143-223420.webp')] },
        { _id: 108512, images: [orig('Triumphant', '89', 'tcgdex/Triumphant/89-108512.webp')] },
        { _id: 25184, images: [orig('EX-Crystal-Guardians', '73', 'tcgdex/EX-Crystal-Guardians/73-25184.webp')] },
        { _id: 225372, images: [orig('Ultra-Prism', '153', 'tcgdex/Ultra-Prism/153-225372.webp')] },
    ],
    prod: {
        catalogue_produits: [449623, 868202, 868203, 869299, 869300, 869301, 869302].map(idProduct => ({ idProduct })),
        numeros_cartes: [{ idProduct: 449623, slug: 'Guzma-V4-BUS115a', numero: '115a' }],
    },
});

async function lancer(d, argv, { sousLot = true } = {}) {
    const sortie = [], erreurs = [];
    const code = await E.executer({ argv, ouvrirLecture: async () => connexion(d), ouvrirEcriture: async () => connexion(d),
        log: m => sortie.push(m), err: m => erreurs.push(m), garde: () => { if (!sousLot) throw new Error('--ecrire refusé hors de lot-additif.js'); } });
    return { code, sortie: sortie.join('\n'), erreurs: erreurs.join('\n') };
}

(async () => {
    // ── arguments : une garde écrite par ce qu'elle autorise
    let d = donnees(), r;
    r = await lancer(d, ['--simuler', '--famille=emprunts', '--tout']);
    verifier('argument inconnu → refus (2), rien lu', r.code, 2);
    r = await lancer(d, ['--simuler']);
    verifier('sans --famille → refus (2)', r.code, 2);
    r = await lancer(d, ['--ecrire', '--famille=emprunts']);
    verifier('--ecrire sans --attendu → arrêt (1)', [r.code, /attendu=N obligatoire/.test(r.erreurs)], [1, true]);
    verifier('--ecrire hors de lot-additif.js → lève avant toute connexion', await lancer(d, ['--ecrire', '--famille=emprunts', '--attendu=1'], { sousLot: false }).then(() => 'a passé', e => e.message.slice(0, 20)), '--ecrire refusé hors');
    r = await lancer(d, ['--ecrire', '--famille=marqueurs-tampons', '--attendu=1']);
    verifier('mélanges de tampons : --produits obligatoire pour écrire', [r.code, /--produits/.test(r.erreurs)], [1, true]);
    r = await lancer(d, ['--ecrire', '--famille=emprunts', '--attendu=1', '--apres-numero-fiche']);
    verifier('--apres-numero-fiche refusé à l\'écriture', r.code, 2);

    // ── numéro de fiche
    r = await lancer(d, ['--simuler', '--famille=numero-fiche']);
    verifier('numero-fiche : simulation, 1 à poser, rien écrit', [r.code, /1 à poser/.test(r.sortie), d.cartes_produits[0].numeroFiche], [0, true, null]);
    r = await lancer(d, ['--ecrire', '--famille=numero-fiche', '--attendu=2']);
    verifier('numero-fiche : mauvais --attendu → arrêt, rien écrit', [r.code, d.cartes_produits[0].numeroFiche], [1, null]);
    r = await lancer(d, ['--ecrire', '--famille=numero-fiche', '--attendu=1']);
    verifier('numero-fiche : écrit 115a, relu, rien d\'autre ne bouge', [r.code, d.cartes_produits[0].numeroFiche, d.cartes_produits[0].preuve, /posées 1\/1/.test(r.sortie)], [0, '115a', 'metacarte+freres', true]);
    r = await lancer(d, ['--simuler', '--famille=numero-fiche']);
    verifier('numero-fiche : rejoué après écriture → rien à poser (jamais d\'écrasement)', /0 à poser/.test(r.sortie), true);

    // ── emprunts
    d = donnees();
    r = await lancer(d, ['--simuler', '--famille=emprunts']);
    verifier('emprunts : AVANT la correction du numéro, Guzma est refusé (numéro de fiche)', [/numero-fiche-different-de-la-liste/.test(r.sortie), d.cartes[0].images.length], [true, 2]);
    r = await lancer(d, ['--simuler', '--famille=emprunts', '--apres-numero-fiche']);
    verifier('emprunts : simulation « après » → 4 entrées (Guzma, Lusamine, 2 WCD) pour 7 produits, rien écrit', [r.code, /4 entrée\(s\) pour 9 produit/.test(r.sortie), d.cartes.map(c => c.images.length)], [0, true, [2, 1, 1, 1]]);
    r = await lancer(d, ['--ecrire', '--famille=emprunts', '--attendu=3']);
    verifier('emprunts : Guzma refusé au plan (numéro non corrigé) → refus non annoncé, rien écrit', [r.code, /refus d'écriture au plan, non annoncés/.test(r.erreurs), d.cartes.map(c => c.images.length)], [1, true, [2, 1, 1, 1]]);
    await lancer(d, ['--ecrire', '--famille=numero-fiche', '--attendu=1']);
    r = await lancer(d, ['--ecrire', '--famille=emprunts', '--attendu=4']);
    verifier('emprunts : écrit 4 entrées, relues', [r.code, /posées 4\/4/.test(r.sortie), d.cartes.map(c => c.images.length)], [0, true, [3, 2, 2, 2]]);
    const g = d.cartes[0].images.find(i => i.lot === MM.LOT);
    verifier('emprunts : l\'entrée de Guzma (115a) est empruntée, tampon non représenté, fichier de base', [g.set, g.numero, g.cleR2, g.imageEmprunteeTirage, g.tamponNonRepresente, g.source], ['Burning-Shadows', '115a', 'tcgdex/Burning-Shadows/115-223420.webp', true, 'Staff ou Championship', 'emprunt']);
    verifier('emprunts : l\'entrée d\'origine (115) n\'a pas bougé', d.cartes[0].images[0], orig('Burning-Shadows', '115', 'tcgdex/Burning-Shadows/115-223420.webp'));
    r = await lancer(d, ['--ecrire', '--famille=emprunts', '--attendu=0']);
    verifier('emprunts : rejoué → rien à écrire (déjà couvertes), 0 attendu passe, aucune entrée de plus', [r.code, d.cartes.map(c => c.images.length)], [0, [3, 2, 2, 2]]);

    // ── marqueurs WCD
    r = await lancer(d, ['--simuler', '--famille=marqueurs-wcd']);
    verifier('marqueurs-wcd : simulation, 4 lignes au plan', [r.code, /PLAN : 6 ligne/.test(r.sortie)], [0, true]);
    r = await lancer(d, ['--ecrire', '--famille=marqueurs-wcd', '--attendu=6']);
    const w = d.cartes_produits.find(l => l.idProduct === 868202);
    verifier('marqueurs-wcd : écrit WCD{2011} + NON_LEGAL + FINITION_NON_VISIBLE avec sa preuve, sans nom de source', [r.code, w.marqueurs.map(m => m.type), /^année 2011/.test(w.marqueursPreuve), /cardmarket|tcgdex|tcgplayer/i.test(w.marqueursPreuve)], [0, ['WCD', 'NON_LEGAL', 'FINITION_NON_VISIBLE'], true, false]);
    r = await lancer(d, ['--ecrire', '--famille=marqueurs-wcd', '--attendu=0']);
    verifier('marqueurs-wcd : rejoué → marqueurs identiques = déjà, rien n\'est réécrit', [r.code, /6 déjà/.test(r.sortie)], [0, true]);

    // ── marqueurs de tampons : Guzma seul, par --produits
    r = await lancer(d, ['--simuler', '--famille=marqueurs-tampons', '--produits=449623']);
    verifier('marqueurs-tampons : simulation, Guzma → STAFF + CHAMPIONSHIP et son libellé', [r.code, /\["STAFF","CHAMPIONSHIP"\]/.test(r.sortie), /Staff ou Championship selon l'exemplaire/.test(r.sortie)], [0, true, true]);
    r = await lancer(d, ['--ecrire', '--famille=marqueurs-tampons', '--produits=449623', '--attendu=1']);
    const gz = d.cartes_produits.find(l => l.idProduct === 449623);
    verifier('marqueurs-tampons : écrit STAFF + CHAMPIONSHIP, libellé voulu dans la preuve', [r.code, gz.marqueurs.map(m => m.type), /Staff ou Championship selon l'exemplaire/.test(gz.marqueursPreuve)], [0, ['STAFF', 'CHAMPIONSHIP'], true]);
    d = donnees();
    r = await lancer(d, ['--simuler', '--famille=marqueurs-tampons', '--produits=999']);
    verifier('marqueurs-tampons : un produit hors famille est un refus nommé, jamais écrit', [r.code, /produit-hors-de-la-famille/.test(r.sortie)], [0, true]);
    const l878 = d.cartes_produits.find(l => l.idProduct === 449878).marqueurs;
    r = await lancer(d, ['--ecrire', '--famille=marqueurs-wcd', '--attendu=6']);
    verifier('Lusamine : ses marqueurs LEAGUE + PLACE, déjà prouvés, ne sont ni lus ni touchés par cet outil', d.cartes_produits.find(l => l.idProduct === 449878).marqueurs, l878);

    console.log(`\n${ok} réussi(s), ${ko} échec(s)`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR', e.stack); process.exit(1); });
