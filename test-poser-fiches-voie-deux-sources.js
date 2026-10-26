// BANC — poser-fiches-voie-deux-sources.js : les arguments, la lecture, le plan, les gardes d'écriture. Des FAUX bases (aucune connexion, aucune écriture).
//   node test-poser-fiches-voie-deux-sources.js
const T = require('./poser-fiches-voie-deux-sources');
let ok = 0, ko = 0;
const verifier = (quoi, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`  ✅ ${quoi}`); } else { ko++; console.log(`  ❌ ${quoi}\n     obtenu  ${a}\n     attendu ${b}`); }
};
const SET = 'Set-Zh', EXPANSION = 'Zh Promo (ATCG)';
const gengar = { _id: 10, nomEn: 'Gengar ex', niveau: null, attaques: [{ nom: 'Shadowy Claw' }], impressions: [], sets: [SET], liens: { idProduct: [1], idMetacards: [500] } };
const colls = {
    cartes: [gengar],
    sets: [{ _id: SET, tirage: 'zh-hans', idExpansion: [9], bulba: { expansion: EXPANSION } }],
    cartes_produits: [{ _id: '10|1', carteId: 10, idProduct: 1, slugSet: 'Autre' }],
    numeros_cartes: [{ idProduct: 20, numero: '214', slug: 'Gengar-ex-Z214', slugSet: SET, codeSet: 'ZH/CS' }],
    catalogue_produits: [{ idProduct: 20, idExpansion: 9, idMetacard: 500, name: 'Gengar ex [Shadowy Claw]' }]
};
const dbFausse = (c = colls) => ({
    collection: nom => ({
        find: (f = {}) => ({ toArray: async () => (c[nom] || []).filter(d => (f.idExpansion === undefined || d.idExpansion === f.idExpansion) && (!f.idProduct?.$in || f.idProduct.$in.includes(d.idProduct))) }),
        countDocuments: async () => 0
    })
});
const cx = () => ({ cartes: { db: dbFausse() }, prod: { db: dbFausse() }, fermer: async () => {} });
const liste = { 20: { exp: 9, set: SET, numero: '214', nom: 'Gengar ex', ok: true, concordantes: [{ source: 'pikaqian', ref: 'pikaqian/x/1', set: SET, numero: '214', nom: 'Gengar ex', par: 'nom' }], refusees: [] }, 21: { exp: 9, set: SET, numero: '215', nom: 'X', ok: false, raison: 'aucune seconde source ne porte ce produit', concordantes: [], refusees: [] } };
const sorties = {};
const base = (argv, extra = {}) => ({ argv, ouvrirLecture: async () => cx(), ouvrirEcriture: async () => cx(), lireListe: f => (f.endsWith('liste.json') ? liste : f.endsWith('pret.json') ? [20] : f.endsWith('autre.json') ? [20, 99] : (() => { throw new Error('absent'); })()), ecrireFichier: (f, t) => { sorties[f] = t; }, log: () => {}, err: () => {}, env: {}, ppid: 1, ...extra });

(async () => {
    verifier('un argument inconnu → 2', await T.executer(base(['--simuler', '--liste=liste.json', '--force'])), 2);
    verifier('aucun mode → 2', await T.executer(base(['--liste=liste.json'])), 2);
    verifier('les deux modes → 2, même avec tout ce que --ecrire exige (lot-additif, liste prête, attendu)', await (async () => { let ouvert = false; const c = await T.executer(base(['--simuler', '--ecrire', '--liste=liste.json', '--seulement=pret.json', '--attendu=1'], { env: { LOT_ADDITIF_PID: '1' }, ppid: 1, ouvrirEcriture: async () => { ouvert = true; return cx(); }, ouvrirLecture: async () => { ouvert = true; return cx(); } })); return [c, ouvert]; })(), [2, false]);
    verifier('sans --liste → 2', await T.executer(base(['--simuler'])), 2);
    verifier('une liste illisible → 2', await T.executer(base(['--simuler', '--liste=absente.json'])), 2);
    verifier('--ecrire hors de lot-additif.js → 2, AVANT toute connexion', await (async () => { let ouvert = false; const c = await T.executer(base(['--ecrire', '--liste=liste.json', '--seulement=pret.json', '--attendu=1'], { ouvrirEcriture: async () => { ouvert = true; return cx(); } })); return [c, ouvert]; })(), [2, false]);
    verifier('--ecrire sous lot-additif sans --seulement ni --attendu → 2', await T.executer(base(['--ecrire', '--liste=liste.json'], { env: { LOT_ADDITIF_PID: '1' }, ppid: 1 })), 2);
    verifier('--seulement qui nomme un idProduct absent de la liste → 1 (la liste ne correspond pas)', await T.executer(base(['--simuler', '--liste=liste.json', '--seulement=autre.json'])), 1);

    const sortie = []; const r = await T.executer(base(['--simuler', '--liste=liste.json', '--plan=plan.json', '--pret=pret-out.json', '--resume=resume.json'], { log: s => sortie.push(s) }));
    verifier('simulation : code 0', r, 0);
    const plan = JSON.parse(sorties['plan.json']);
    verifier('le plan (format simuler-abc) : une ligne, son code d\'origine, l\'impression à poser, aucune écriture', [plan.outil, plan.lignes.map(l => [l._id, l.numeroFiche, l.code]), plan.impressions.map(x => [x.carteId, x.imp.numero, x.imp.source]), plan.cartesSets], ['poser-fiches-voie-deux-sources', [['10|20', '214', 'ZH/CS']], [[10, '214', 'numero-cardmarket']], []]);
    verifier('la liste prête = les idProduct dont la ligne passe', JSON.parse(sorties['pret-out.json']), [20]);
    const resume = JSON.parse(sorties['resume.json']);
    verifier('le résumé nomme le refus du produit non confirmé, avec sa raison', resume.refus.map(x => [x.idProduct, /non confirmé par deux sources/.test(x.raison)]), [[21, true]]);
    verifier('le résumé nomme les sources de la ligne', resume.lignes.map(l => l.sources), [['cardmarket', 'pikaqian']]);
    verifier('la sortie imprime les dénominateurs (liste, cartes, sets, lignes)', sortie.some(s => /DÉNOMINATEURS : 2 produits dans la liste/.test(s) && /1 cartes/.test(s)), true);

    // écriture : sous lot-additif, avec la liste prête, l'attendu juste — les collections fausses n'ont ni updateOne ni bulkWrite, l'écriture LÈVE là : on prouve seulement qu'elle est ATTEINTE (gardes passées)
    let atteint = false;
    const cxEcr = () => ({ cartes: { db: { collection: nom => ({ ...dbFausse().collection(nom), updateOne: async () => { atteint = true; throw new Error('arrêt du banc : écriture atteinte'); }, bulkWrite: async () => ({ modifiedCount: 0 }) }) } }, prod: { db: dbFausse() }, fermer: async () => {} });
    let erreur = null;
    try { await T.executer(base(['--ecrire', '--liste=liste.json', '--seulement=pret.json', '--attendu=1'], { env: { LOT_ADDITIF_PID: '1' }, ppid: 1, ouvrirEcriture: async () => cxEcr() })); } catch (e) { erreur = e.message; }
    verifier('--ecrire sous lot-additif, liste prête, bon --attendu : l\'écriture est atteinte (jamais avant)', [atteint, /écriture atteinte|lignes|detach/i.test(erreur || '')], [true, true]);
    atteint = false;
    verifier('--ecrire avec un mauvais --attendu → 1 et AUCUNE écriture', [await T.executer(base(['--ecrire', '--liste=liste.json', '--seulement=pret.json', '--attendu=5'], { env: { LOT_ADDITIF_PID: '1' }, ppid: 1, ouvrirEcriture: async () => cxEcr() })), atteint], [1, false]);
    verifier('entreesDeLaListe : le non confirmé et l\'entrée sans set sont des refus d\'entrée', (() => { const e = T.entreesDeLaListe({ 1: { ok: true, exp: 9 }, 2: { ok: false, raison: 'x' }, 3: { ok: true, exp: 9, set: 'S', concordantes: [] } }, null); return [e.entrees.map(x => x.idProduct), e.refus.map(x => x.idProduct)]; })(), [[3], [1, 2]]);
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
