// node test-poser-impressions-setlist.js — la planification des impressions « setlist » (URL Cardmarket ET Setlist concordantes), la restriction à une liste de produits CONFIRMÉS par deux sources
// non-Bulbapedia, et le plan que simuler-abc.js rejoue. FAUSSE BASE : aucune connexion. TOOL_DIR=<dossier> rejoue le banc contre une copie MUTÉE de l'outil (le rouge se voit en cassant le code).
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const M = require(path.join(DIR, 'poser-impressions-setlist.js'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

const LIGNE_DE_SET = new Map([['SetZ', { code: 'CSZ', slugSet: 'SetZ', bulba: { expansion: 'Exp Z', tirage: 'zh-hans' } }]]);
const ligne = (idProduct, carteId, numsSetlist, over = {}) => ({ _id: `${carteId}|${idProduct}`, carteId, idProduct, slugSet: 'SetZ', tirage: 'zh-hans', preuve: 'setlist+numero', slug: `Truc-CSZ${String(numsSetlist[0]).padStart(3, '0')}`, detail: `n°${numsSetlist.join(', ')} dans l'expansion 1`, ...over });
const nc = (idProduct, numero, numeroUrl) => [idProduct, { idProduct, numero, numeroUrl, slug: null, codeSet: 'CSZ' }];
const carte = (id, impressions = []) => [id, { _id: id, nomEn: `C${id}`, impressions, sets: ['SetZ'] }];

// 1. une impression à poser ; 2. l'URL qui contredit la Setlist ; 3. déjà sur la carte ; 4. deux produits au même numéro de la même carte : UNE impression, DEUX produits
const lignes = [ligne(1, 10, [5]), ligne(2, 11, [90]), ligne(3, 12, [7]), ligne(4, 13, [8]), ligne(5, 13, [8])];
const NC = new Map([nc(1, '005', '5'), nc(2, '090', '089'), nc(3, '7', '7'), nc(4, '008', '8'), nc(5, '008', '8')]);
const cartes = new Map([carte(10), carte(11), carte(12, [{ tirage: 'zh-hans', expansion: 'Exp Z', numero: '7' }]), carte(13)]);
const P = M.planifier({ lignes, NC, cartes, ligneDeSet: LIGNE_DE_SET });
verifier('une impression par (carte, numéro) à poser : cartes 10 et 13', [...P.aPoser.keys()].sort((a, b) => a - b), [10, 13]);
verifier('l\'impression posée porte tirage, expansion, numéro (tel que Cardmarket l\'imprime) et la marque « setlist »', P.aPoser.get(10), [{ tirage: 'zh-hans', expansion: 'Exp Z', numero: '005', total: null, deck: null, rarete: null, source: 'setlist' }]);
verifier('l\'URL qui contredit la Setlist n\'écrit rien (produit 2)', P.aPoser.has(11), false);
verifier('une impression déjà sur la carte n\'est pas reposée', P.aPoser.has(12), false);
verifier('deux produits au même numéro de la même carte : UNE impression', P.aPoser.get(13).length, 1);
verifier('… et les DEUX produits sont rattachés à cette impression', [...P.produits.values()].map(s => [...s].sort()), [[1], [4, 5]]);

// la restriction : une impression ne s'écrit que si TOUS ses produits sont confirmés
const R1 = M.restreindre(P, new Set([1, 4]));
verifier('restreindre : l\'impression dont un produit n\'est pas confirmé est ÉCARTÉE (13 : 4 oui, 5 non)', [[...R1.aPoser.keys()], R1.ecartees.length], [[10], 1]);
verifier('restreindre : le motif de l\'écart est nommé', /pas tous les produits/.test(R1.ecartees[0].motif), true);
const R2 = M.restreindre(P, new Set([1, 4, 5]));
verifier('restreindre : tous confirmés, tout passe', [[...R2.aPoser.keys()], R2.ecartees.length], [[10, 13], 0]);
verifier('restreindre sans liste : rien n\'est filtré', [...M.restreindre(P, null).aPoser.keys()], [10, 13]);
verifier('horsPlan : un idProduct de la liste qu\'aucune impression à poser ne porte', M.horsPlan(P, new Set([1, 999])), [999]);

// le plan : une ligne par produit (le scanner la juge), les impressions pour simuler-abc
const plan = M.construirePlan(R2, LIGNE_DE_SET, new Map(lignes.map(l => [l.idProduct, l])));
verifier('le plan porte une ligne par produit retenu, avec le code, le set et le numéro écrit', plan.lignes.map(l => [l.idProduct, l.code, l.slugSet, l.numeroFiche]), [[1, 'CSZ', 'SetZ', '005'], [4, 'CSZ', 'SetZ', '008'], [5, 'CSZ', 'SetZ', '008']]);
verifier('le plan porte les impressions à poser (carteId, imp)', plan.impressions.map(x => x.carteId), [10, 13]);
verifier('les lignes du plan ont l\'_id des lignes existantes (elles ne sont PAS ajoutées)', plan.lignes.map(l => l._id), ['10|1', '13|4', '13|5']);

// ── LE CHEMIN D'ÉCRITURE, sur une FAUSSE base en mémoire (jamais une vraie grappe) — relecture 2, D5
function fakeDb(docs, { perdre = false } = {}) {
    const m = new Map(docs.map(d => [d._id, structuredClone(d)]));
    return {
        collection: () => ({
            find: f => ({ toArray: async () => [...m.values()].filter(d => (f._id.$in || [f._id]).includes(d._id)).map(d => structuredClone(d)) }),
            updateOne: async (f, u) => {
                const d = m.get(f._id); if (!d) return { modifiedCount: 0 };
                const em = f.impressions?.$not?.$elemMatch; if (em && (d.impressions || []).some(i => Object.entries(em).every(([a, b]) => i[a] === b))) return { modifiedCount: 0 };
                if (perdre) return { modifiedCount: 1 };
                d.impressions = [...(d.impressions || []), ...u.$push.impressions.$each]; return { modifiedCount: 1 };
            }
        }),
        brut: () => [...m.values()].map(d => structuredClone(d))
    };
}
(async () => {
    const R = M.restreindre(P, null), sortie = [], erreurs = [];
    let db = fakeDb([{ _id: 10, impressions: [] }, { _id: 13, impressions: [{ tirage: 'jp', expansion: 'X', numero: '1', source: 'tcgdex' }] }, { _id: 77, impressions: [] }]);
    let code = await M.ecrireImpressions({ db, aPoser: R.aPoser, log: s => sortie.push(s), err: s => erreurs.push(s) });
    verifier('écriture : exit 0, relue ; les impressions posées portent la marque « setlist », la carte hors plan (77) est intacte, l\'existante est gardée', [code, db.brut().find(c => c._id === 10).impressions.map(i => i.source), db.brut().find(c => c._id === 13).impressions.length, db.brut().find(c => c._id === 77).impressions.length], [0, ['setlist'], 2, 0]);
    const apres = JSON.stringify(db.brut());
    code = await M.ecrireImpressions({ db, aPoser: R.aPoser, log: () => { }, err: s => erreurs.push(s) });
    verifier('relance : aucune impression en double (le filtre la refuse), le code est 1 et RIEN ne bouge', [code, JSON.stringify(db.brut()) === apres], [1, true]);
    db = fakeDb([{ _id: 10, impressions: [] }, { _id: 13, impressions: [] }], { perdre: true }); erreurs.length = 0;
    code = await M.ecrireImpressions({ db, aPoser: R.aPoser, log: () => { }, err: s => erreurs.push(s) });
    verifier('une impression annoncée écrite mais perdue SANS erreur → code 1 et le dit', [code, erreurs.join('').includes('relecture')], [1, true]);
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
