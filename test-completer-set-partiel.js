// node test-completer-set-partiel.js — collecte-cartes/completer-set-partiel.js sur une FAUSSE BASE en memoire (aucun reseau, aucune vraie base).
// Monde = l'etat reel releve le 2026-10-13 : le set Promos existe (53/93), Rainbow-Energy-TR17 (275578) n'a pas de ligne, sa carte 60335
// (Rainbow Energy) porte 43 liens dont 274070 en 3e position et 585160 en tete (le repere d'adresse du site).
// TOOL_DIR=<dossier> rejoue le banc contre une copie MUTEE du module (le rouge se voit en cassant le code).
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const CS = require(path.join(DIR, 'collecte-cartes', 'completer-set-partiel.js'));
let ok = 0, ko = 0;
// copie qui GARDE un ObjectId comme un ObjectId, et lui donne une NOUVELLE identité d'objet à chaque lecture (comme le pilote Mongo) ;
// structuredClone en ferait un objet nu {} : un banc qui ne sait pas copier un _id ne vaut rien pour les restes (ceux de la base ont des ObjectId).
const copie = v => {
    if (v === null || typeof v !== 'object') return v;
    if (typeof v.toHexString === 'function') return new v.constructor(v.toHexString());
    if (v instanceof Date) return new Date(v);
    if (Array.isArray(v)) return v.map(copie);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copie(x)]));
};
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

function fakeDb(init, opts = {}) {
    const cols = new Map(Object.entries(init).map(([n, docs]) => [n, new Map(docs.map(d => [d._id, copie(d)]))]));
    const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const correspond = (d, f) => Object.entries(f).every(([k, v]) => (k === '_id' && v && v.$in) ? v.$in.includes(d._id) : egal(d[k], v));
    const lire = (d, chemin) => chemin.split('.').reduce((x, k) => (x == null ? undefined : x[k]), d);
    const poser = (d, chemin, f) => { const ks = chemin.split('.'); let x = d; for (const k of ks.slice(0, -1)) x = x[k] = x[k] || {}; x[ks.at(-1)] = f(x[ks.at(-1)]); };
    const col = nom => { const m = cols.get(nom); return {
        find: f => ({ toArray: async () => [...m.values()].filter(d => correspond(d, f || {})).map(d => copie(d)) }),
        countDocuments: async f => [...m.values()].filter(d => correspond(d, f || {})).length,
        async updateOne(f, u, o = {}) {
            if (opts.ecrire) opts.ecrire(nom, f, u);
            let d = [...m.values()].find(x => correspond(x, f));
            if (!d) {
                if (!o.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
                d = { _id: f._id, ...copie(u.$setOnInsert || {}) }; m.set(d._id, d);
                return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
            }
            if (opts.perdre && opts.perdre(nom, u)) return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
            let change = false;
            for (const [k, v] of Object.entries(u.$addToSet || {})) {
                const vals = v && v.$each ? v.$each : [v];
                poser(d, k, cur => { const a = Array.isArray(cur) ? [...cur] : []; for (const x of vals) if (!a.some(y => egal(y, x))) { a.push(copie(x)); change = true; } return a; });
            }
            for (const [k, v] of Object.entries(u.$set || {})) { poser(d, k, () => v); change = true; }
            return { matchedCount: 1, modifiedCount: change ? 1 : 0, upsertedCount: 0 };
        } }; };
    return { collection: col, brut: nom => [...cols.get(nom).values()].map(d => copie(d)) };
}

const LIENS = [585160, 651994, 274070, 274133, 678696];
// le set partiel d'avant : 2 prouvés posés par la création, 3 restes, 1 déjà joint ailleurs, 0 contredit, 0 carte-code = 6 ; la pose doit donner 3 / 2 / 1 = 6
const SET = { _id: 'Promos', idExpansion: [2107], nomAffichage: 'Promos', partiel: { prouves: 2, total: 6, restes: 3, contredits: 0, dejaJoints: 1, horsDenominateur: 0, mention: 'avant', tirage: 'intl', tiragePreuve: 'avant' } };
const CLASSEMENT = (o = {}) => ({ prouves: [{}], restes: new Array(o.restes ?? 2).fill({}), contredits: [], deja: new Array(o.deja ?? 3).fill({}), horsDenominateur: [] });
const LIGNE = { _id: '60335|275578', carteId: 60335, idProduct: 275578, idExpansion: 2107, tirage: 'intl', preuve: 'reimpression+origine+numero', slug: 'Rainbow-Energy-TR17', slugSet: 'Promos', origine: { code: 'TR', numero: '17', source: 'slug-collee' }, detail: 'slug … → TR n°17', verifieLe: new Date('2026-10-13'), route: 'PR' };
const META = new Map([[275578, 211994]]);
function monde({ sans: sansSet = false, liens = LIENS, carteAvecSet = false, ligneExiste = null, metas = [211994], posees = 2 } = {}) {
    const posee = i => ({ _id: `${i}|${10 + i}`, carteId: i, idProduct: 10 + i, preuve: 'reimpression+origine+numero', route: 'PR', slugSet: 'Promos', slug: `X-PR${i}` });
    const lignes = [{ _id: '60335|274070', carteId: 60335, idProduct: 274070, preuve: 'set+numero', slug: 'Rainbow-Energy-V1-TR17', slugSet: 'Team-Rocket', numeroFiche: '17' }, { _id: '9|9', carteId: 9, idProduct: 9, preuve: 'x' }, ...Array.from({ length: posees }, (_, i) => posee(i + 1))];
    if (ligneExiste) lignes.push(ligneExiste);
    return fakeDb({
        sets: sansSet ? [] : [copie(SET)],
        cartes_produits: lignes,
        cartes: [{ _id: 60335, nomEn: 'Rainbow Energy', sets: ['Team-Rocket', ...(carteAvecSet ? ['Promos'] : [])], liens: liens === null ? undefined : { idProduct: [...liens], idMetacards: [...metas] } }, { _id: 9, nomEn: 'Autre', sets: [], liens: { idProduct: [9], idMetacards: [] } }],
        restes: [{ _id: 'r1', set: 'Promos', idProduct: 275578, type: 'partiel-sans-code-origine', detail: 'd1', le: 'avant' }, { _id: 'r2', set: 'Promos', idProduct: 111, type: 'partiel-sans-code-origine' }, { _id: 'r3', set: 'Autre', idProduct: 275578, type: 'produit-sans-carte' }]
    });
}
const etat = db => JSON.stringify(['sets', 'cartes_produits', 'cartes', 'restes'].map(n => db.brut(n)));
async function lancer(db, o = {}) {
    const sorties = [], erreurs = [];
    const code = await CS.completer({ db, slug: 'Promos', lignes: [copie(LIGNE)], metaDe: META, attendu: o.attendu === undefined ? 1 : o.attendu, ecrire: !!o.ecrire, classement: o.classement || CLASSEMENT(), code: 'PR', le: new Date('2026-10-13T12:00:00Z'), log: s => sorties.push(s), err: s => erreurs.push(s) }).catch(e => { erreurs.push(`EXCEPTION ${e.message}`); return 99; });
    return { code, sorties: sorties.join('\n'), erreurs: erreurs.join('\n') };
}
const carte = (db, id) => db.brut('cartes').find(c => c._id === id), ligneDe = (db, id) => db.brut('cartes_produits').find(l => l._id === id);

(async () => {
    // ── la simulation : exactement 1 ligne neuve, 0 modifiee, rien d'ecrit ──
    let db = monde(), av = etat(db);
    let r = await lancer(db);
    verifier('simulation : exit 0, rien d\'ecrit, "1 ligne neuve, 0 modifiee", la carte et ses liens sont nommes', [r.code, etat(db) === av, /1 ligne\(s\) NEUVE\(S\), 0 modifiée\(s\)/.test(r.sorties), /60335\|275578/.test(r.sorties)], [0, true, true, true]);
    verifier('simulation : annonce le compteur recalcule (prouves 2->3, restes 3->2, total 6->6) et le reste a marquer resolu (jamais supprime)', [/prouvés 2→3 · restes 3→2 · total 6→6 · dejaJoints 1→1/.test(r.sorties), /restes marqués RÉSOLUS.*275578 \(partiel-sans-code-origine\)/.test(r.sorties)], [true, true]);

    // ── l'ecriture : une ligne neuve, la carte ne fait que s'ajouter ──
    r = await lancer(db, { ecrire: true });
    verifier('ecriture : exit 0, relue', [r.code, /écrit et relu/.test(r.sorties)], [0, true]);
    verifier('   la ligne neuve existe, telle quelle ; les deux lignes existantes sont intactes', [ligneDe(db, '60335|275578').preuve, ligneDe(db, '60335|275578').slug, ligneDe(db, '60335|274070').numeroFiche, db.brut('cartes_produits').length], ['reimpression+origine+numero', 'Rainbow-Energy-TR17', '17', 5]);
    verifier('   🔑 liens.idProduct : les 5 premiers elements inchanges ET dans le meme ordre (le 1er est le repere d\'adresse du site), le nouveau est AJOUTE a la fin', [carte(db, 60335).liens.idProduct, carte(db, 60335).liens.idProduct[0]], [[...LIENS, 275578], 585160]);
    verifier('   la carte gagne le slug du set (ajout a la fin de sets, rien retire), ses metacartes inchangees (deja la)', [carte(db, 60335).sets, carte(db, 60335).liens.idMetacards], [['Team-Rocket', 'Promos'], [211994]]);
    const setApres = db.brut('sets')[0];
    verifier('   sets.partiel : les SEULS champs du compteur changent (3/6, restes 2, dejaJoints 1), recalcules par partielDe (mention et tiragePreuve disent 3) ; nomAffichage, tirage, idExpansion intacts', [setApres.partiel.prouves, setApres.partiel.total, setApres.partiel.restes, setApres.partiel.dejaJoints, /3 produits sur 6/.test(setApres.partiel.mention), /3 produits prouvés/.test(setApres.partiel.tiragePreuve), setApres.nomAffichage, setApres.partiel.tirage, setApres.idExpansion], [3, 6, 2, 1, true, true, 'Promos', 'intl', [2107]]);
    const restesApres = db.brut('restes');
    verifier('   🔑 le reste 275578 n\'est PAS supprime : marque resolu (4 champs), ses autres champs intacts ; 3 documents restent', [restesApres.length, restesApres.find(x => x._id === 'r1').resoluPar, restesApres.find(x => x._id === 'r1').resoluLigne, restesApres.find(x => x._id === 'r1').resoluCarteId, restesApres.find(x => x._id === 'r1').type, restesApres.find(x => x._id === 'r1').detail], [3, 'completer-set-partiel', '60335|275578', 60335, 'partiel-sans-code-origine', 'd1']);
    verifier('   les autres restes (autre produit, autre set) : intacts, non marques ; l\'autre carte intacte', [restesApres.find(x => x._id === 'r2').resoluPar, restesApres.find(x => x._id === 'r3').resoluPar, carte(db, 9).liens.idProduct], [undefined, undefined, [9]]);
    r = await lancer(db, { ecrire: true });
    verifier('rejeu apres ecriture : la ligne existe deja, identique -> rien a faire, exit 1, rien de plus ecrit', [r.code, /rien à faire/.test(r.erreurs)], [1, true]);

    // ── --attendu : refuse si le plan differe ──
    db = monde(); av = etat(db);
    r = await lancer(db, { ecrire: true, attendu: 2 });
    verifier('--attendu=2 alors que le plan a 1 ligne : exit 1, RIEN d\'ecrit', [r.code, etat(db) === av, /1 ligne.*2 attendue|attendu 2/.test(r.erreurs)], [1, true, true]);
    r = await lancer(db, { ecrire: true, attendu: null });
    verifier('ecrire sans --attendu : refuse (exit 2), rien d\'ecrit', [r.code, etat(db) === av], [2, true]);
    r = await lancer(db, { attendu: 2 });
    verifier('simulation avec un attendu qui ne colle pas : le dit (exit 1), rien d\'ecrit', [r.code, etat(db) === av], [1, true]);

    // ── gardes ──
    db = monde({ sans: true }); av = etat(db);
    r = await lancer(db, { ecrire: true });
    verifier('garde : le set n\'existe pas -> refuse (la creation est un autre outil), rien d\'ecrit', [r.code, etat(db) === av], [1, true]);
    db = monde({ liens: null }); av = etat(db);
    r = await lancer(db, { ecrire: true });
    verifier('garde : une carte sans liens.idProduct (le nouveau deviendrait le repere d\'adresse) -> refuse, rien d\'ecrit', [r.code, etat(db) === av, /repère d'adresse/.test(r.erreurs)], [1, true, true]);
    db = monde({ ligneExiste: { ...LIGNE, slug: 'Autre-Slug' } }); av = etat(db);
    r = await lancer(db, { ecrire: true });
    verifier('garde : une ligne de meme _id existe avec un AUTRE contenu -> jamais reecrite, exit 1, rien d\'ecrit', [r.code, etat(db) === av, /réécrite|diverge/.test(r.erreurs)], [1, true, true]);
    db = monde({ carteAvecSet: true });
    r = await lancer(db, { ecrire: true });
    verifier('la carte porte deja le slug du set : la ligne s\'ajoute, sets ne se duplique pas', [r.code, carte(db, 60335).sets], [0, ['Team-Rocket', 'Promos']]);

    // ── la relecture voit une ecriture qui ne fait rien sans erreur ──
    db = monde(); const dbPerd = fakeDb({ sets: db.brut('sets'), cartes_produits: db.brut('cartes_produits'), cartes: db.brut('cartes'), restes: db.brut('restes') }, { perdre: (nom) => nom === 'cartes' });
    r = await lancer(dbPerd, { ecrire: true });
    verifier('relecture : un $addToSet de la carte qui ne fait rien sans erreur -> exit 1, la relecture le dit', [r.code, /relecture ne retrouve pas/.test(r.erreurs)], [1, true]);

    db = monde(); const dbPerdSet = fakeDb({ sets: db.brut('sets'), cartes_produits: db.brut('cartes_produits'), cartes: db.brut('cartes'), restes: db.brut('restes') }, { perdre: (nom) => nom === 'sets' });
    r = await lancer(dbPerdSet, { ecrire: true });
    verifier('relecture : un $set du compteur qui ne fait rien sans erreur -> exit 1', [r.code, /champs du compteur/.test(r.sorties)], [1, true]);
    db = monde(); const dbPerdReste = fakeDb({ sets: db.brut('sets'), cartes_produits: db.brut('cartes_produits'), cartes: db.brut('cartes'), restes: db.brut('restes') }, { perdre: (nom) => nom === 'restes' });
    r = await lancer(dbPerdReste, { ecrire: true });
    verifier('relecture : un marquage de reste qui ne fait rien sans erreur -> exit 1, "non marque resolu"', [r.code, /non marqué résolu/.test(r.sorties)], [1, true]);

    // ── le compteur : le recalcul doit COLLER aux compteurs d'avant, sinon refus (rien d'ecrit) ──
    db = monde(); av = etat(db);
    r = await lancer(db, { ecrire: true, classement: CLASSEMENT({ restes: 3 }) });
    verifier('garde : le classement trouve 3 restes (au lieu de 2 apres la pose) -> le classement a bouge autrement que par la pose : refus, rien d\'ecrit', [r.code, etat(db) === av, /le recalcul donne/.test(r.erreurs)], [1, true, true]);
    r = await lancer(db, { ecrire: true, classement: CLASSEMENT({ deja: 4 }) });
    verifier('garde : un produit de plus "deja joint" ailleurs (total 7) -> refus, rien d\'ecrit', [r.code, etat(db) === av], [1, true]);
    db = monde({ posees: 1 }); av = etat(db);
    r = await lancer(db, { ecrire: true });
    verifier('garde : 1 ligne posee par la creation en base mais 2 au compteur -> le compteur ne decrit pas la base : refus, rien d\'ecrit', [r.code, etat(db) === av, /ne décrit pas la base/.test(r.erreurs)], [1, true, true]);
    db = monde({ ligneExiste: null }); const sansReste = fakeDb({ sets: db.brut('sets'), cartes_produits: db.brut('cartes_produits'), cartes: db.brut('cartes'), restes: [] });
    r = await lancer(sansReste, { ecrire: true });
    verifier('aucun reste pour le produit : rien a marquer, la pose se fait quand meme (exit 0, "aucun")', [r.code, /marqués RÉSOLUS.*: aucun/.test(r.sorties)], [0, true]);

    // ── le geste n'ecrit QUE ce qu'il annonce : jamais $unset / $pull / delete ni $push ──
    const gestes = [];
    db = fakeDb({ sets: [copie(SET)], cartes_produits: monde().brut('cartes_produits'), cartes: monde().brut('cartes'), restes: monde().brut('restes') }, { ecrire: (nom, f, u) => gestes.push(`${nom}:${Object.keys(u).join('+')}`) });
    await lancer(db, { ecrire: true });
    verifier('les seuls operateurs d\'ecriture utilises : $setOnInsert (ligne), $addToSet (carte), $set (compteur), $set (marque du reste)', gestes, ['cartes_produits:$setOnInsert', 'cartes:$addToSet', 'sets:$set', 'restes:$set']);

    // ── les _id des restes sont des ObjectId (le type réel en base) : la relecture les compare par VALEUR, jamais par identité d'objet ──
    {
        const { ObjectId } = require('mongodb');
        const oid = h => new ObjectId(h.padStart(24, '0'));
        const base = monde();
        const restesOid = [
            { _id: oid('a1'), set: 'Promos', idProduct: 275578, type: 'partiel-sans-code-origine', detail: 'd1', le: 'avant' },
            { _id: oid('a2'), set: 'Promos', idProduct: 111, type: 'partiel-sans-code-origine' },
            { _id: oid('a3'), set: 'Autre', idProduct: 275578, type: 'produit-sans-carte' }];
        const dbOid = fakeDb({ sets: base.brut('sets'), cartes_produits: base.brut('cartes_produits'), cartes: base.brut('cartes'), restes: restesOid });
        r = await lancer(dbOid, { ecrire: true });
        const ra = dbOid.brut('restes');
        verifier('restes à _id ObjectId : écriture juste -> relecture juste (exit 0, aucun « disparu », « écrit et relu », seul le reste du produit est marqué)',
            [r.code, /disparu|\[object Object\]/.test(r.erreurs + r.sorties), /écrit et relu/.test(r.sorties), ra.find(x => String(x._id) === String(oid('a1'))).resoluPar, ra.find(x => String(x._id) === String(oid('a2'))).resoluPar, ra.length],
            [0, false, true, 'completer-set-partiel', undefined, 3]);
    }

    console.log(`\n${ok} passes, ${ko} en echec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ ERREUR DU BANC', e); process.exit(1); });
