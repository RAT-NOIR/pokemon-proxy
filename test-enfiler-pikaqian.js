// node test-enfiler-pikaqian.js — l'enfilage des unités PIKAQIAN (enfiler-pikaqian.js) : mesure par défaut, set test d'abord, garde du commit du worker,
// source bloquée, queue de file, reprise des arrêts seulement. Base EN MÉMOIRE, aucune requête, aucune base réelle.
// PK_ENFILER (banc des mutants, rouge-pikaqian.js) : un fichier à tester à la place du vrai.
const path = require('path');
const fs = require('fs');
const E = require(process.env.PK_ENFILER ? path.resolve(process.env.PK_ENFILER) : './enfiler-pikaqian');
const { TABLE_PIKAQIAN, uniteDeLaLigne } = require('./collecte-cartes/pikaqian-sets');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
function fausseBase() {
    const cols = new Map();
    const col = n => cols.get(n) || cols.set(n, new Map()).get(n);
    const accepte = (d, f) => Object.entries(f || {}).every(([k, v]) => d[k] === v);
    const collection = n => ({
        async findOne(f) { return structuredClone([...col(n).values()].find(d => accepte(d, f)) ?? null); },
        find(f) { return { toArray: async () => structuredClone([...col(n).values()].filter(d => accepte(d, f))) }; },
        async updateOne(f, u, o = {}) {
            let d = [...col(n).values()].find(x => accepte(x, f)), cree = false;
            if (!d) { if (!o.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 }; d = { _id: f._id, ...(u.$setOnInsert || {}) }; col(n).set(d._id, d); cree = true; }
            for (const [k, v] of Object.entries(u.$set || {})) d[k] = v;
            for (const k of Object.keys(u.$unset || {})) delete d[k];
            return { matchedCount: 1, modifiedCount: cree ? 0 : 1, upsertedCount: cree ? 1 : 0 };
        }
    });
    return { cols, col, db: { collection } };
}
const BON = { bloque: false, phrase: 'worker à jour' }, MAUVAIS = { bloque: true, phrase: 'worker en retard' };
const bilanTest = (o = {}) => ({ concordance: true, garde: { ok: true }, prouves: 199, joints: 199, verifieLe: new Date(), ...o });
const SET = E.SET_TEST;

(async () => {
    verifier('le set test est CS1bC (199 produits) et figure dans la table', [SET, TABLE_PIKAQIAN.find(l => l.slug === SET)?.code], ['Dynamax-Clash-Flame', 'CS1bC']);
    verifier('la table : 91 lignes, une seule par slug et par codePk, chacune au tirage zh-hans', [TABLE_PIKAQIAN.length, new Set(TABLE_PIKAQIAN.map(l => l.slug)).size, new Set(TABLE_PIKAQIAN.map(l => l.codePk)).size, TABLE_PIKAQIAN.every(l => l.tirage === 'zh-hans' && l.langue === 'zh-hans')], [91, 91, 91, true]);
    verifier('les 4 sets sans page chez pikaqian n\'ont pas de ligne', ['CSMPC', 'CSVM1C', 'CSVM2', '30thDC'].map(c => TABLE_PIKAQIAN.some(l => l.code === c)), [false, false, false, false]);
    verifier('codes pikaqian : minuscules, promos sous promo-*', [TABLE_PIKAQIAN.find(l => l.code === 'CSV10C').codePk, TABLE_PIKAQIAN.find(l => l.code === 'CSM2.5C').codePk, TABLE_PIKAQIAN.find(l => l.code === 'SV-P/CS').codePk, TABLE_PIKAQIAN.find(l => l.code === '30th-P').codePk, TABLE_PIKAQIAN.find(l => l.code === '151C').codePk],
        ['csv10c', 'csm2.5c', 'promo-sv-p', 'promo-30th-p', '151c']);

    // 2026-10-13 : PikaQian est PASSIVE (le défaut refuse tout enfilage — test-source-passive.js). Ce banc garde la MÉCANIQUE de l'enfilage testée, source « rouverte » par le banc seul.
    const enf = (db, o) => E.enfiler(db, { passive: false, ...o });
    // ── la mesure par défaut n'écrit rien ───────────────────────────────────────────────────────────────────────────
    let B = fausseBase();
    let r = await enf(B.db, { worker: BON });
    verifier('défaut = mesure : 91 à insérer, rien écrit', [r.inserer.length, r.ecrit, B.col('file_images').size], [91, false, 0]);

    // ── --ecrire sans le set test passé : REFUS (sauf le set test lui-même) ────────────────────────────────────────────
    r = await enf(B.db, { ecrire: true, voulus: null, worker: BON });
    verifier('--tous sans bilan du set test → refusé, rien écrit', [!!r.refus, /set test/.test(r.refus), B.col('file_images').size], [true, true, 0]);
    r = await enf(B.db, { ecrire: true, voulus: ['Collect-151'], worker: BON });
    verifier('un autre set sans bilan du set test → refusé', [!!r.refus, B.col('file_images').size], [true, 0]);
    for (const [nom, bilan] of [['non concordant', bilanTest({ concordance: false })], ['garde rouge', bilanTest({ garde: { ok: false } })], ['0 prouvé', bilanTest({ prouves: 0 })], ['concordance « true » en chaîne', bilanTest({ concordance: 'true' })]]) {
        B = fausseBase(); B.col('sets').set(SET, { _id: SET, visuelsPikaqian: bilan });
        r = await enf(B.db, { ecrire: true, voulus: ['Collect-151'], worker: BON });
        verifier(`bilan du set test ${nom} → refusé`, [!!r.refus, B.col('file_images').size], [true, 0]);
    }
    B = fausseBase(); B.col('sets').set(SET, { _id: SET, visuelsPikaqian: bilanTest() });
    r = await enf(B.db, { ecrire: true, voulus: ['Collect-151'], worker: MAUVAIS });
    verifier('la garde du commit du worker bloque → refusé, rien écrit', [!!r.refus, /worker/.test(r.refus), B.col('file_images').size], [true, true, 0]);

    // ── l'écriture : en QUEUE, la forme exacte de l'unité, idempotente ───────────────────────────────────────────────────
    B = fausseBase(); B.col('sets').set(SET, { _id: SET, visuelsPikaqian: bilanTest() });
    B.col('file_images').set('tpc-asie/X', { _id: 'tpc-asie/X', source: 'tpc-asie', etat: 'attente', ordre: 40 });
    const maintenant = new Date('2026-10-11T12:00:00Z');
    r = await enf(B.db, { ecrire: true, voulus: null, worker: BON, maintenant });
    const unites = [...B.col('file_images').values()].filter(u => u.source === 'pikaqian');
    verifier('--tous : 91 unités insérées, état « attente »', [r.ecrit, r.inseres, unites.length, unites.every(u => u.etat === 'attente')], [true, 91, 91, true]);
    verifier('   en QUEUE de file (ordre > 40, distincts, plus gros d\'abord)', [unites.every(u => u.ordre > 40), new Set(unites.map(u => u.ordre)).size, unites.sort((a, b) => a.ordre - b.ordre)[0]._id, unites.sort((a, b) => a.ordre - b.ordre)[0].trous >= unites[90].trous], [true, 91, 'pikaqian/Shining-Synergy-GX-Starter-Deck', true]);
    const L = TABLE_PIKAQIAN.find(l => l.slug === SET);
    const u = B.col('file_images').get(`pikaqian/${SET}`);
    verifier('   la forme de l\'unité = uniteDeLaLigne (celle que la garde du collecteur accepte mot pour mot) + ordre, état, date, motif', [{ ...u, ordre: undefined, etat: undefined, ajouteLe: undefined, motif: undefined }, !!u.motif, u.ajouteLe.toISOString()],
        [{ ...uniteDeLaLigne(L), ordre: undefined, etat: undefined, ajouteLe: undefined, motif: undefined }, true, '2026-10-11T12:00:00.000Z']);
    verifier('   l\'unité d\'une autre source n\'a pas bougé', B.col('file_images').get('tpc-asie/X'), { _id: 'tpc-asie/X', source: 'tpc-asie', etat: 'attente', ordre: 40 });
    r = await enf(B.db, { ecrire: true, voulus: null, worker: BON, maintenant });
    verifier('   un second --tous : rien à écrire (déjà en file), 91 unités toujours', [r.inserer.length, !!r.refus, [...B.col('file_images').values()].filter(x => x.source === 'pikaqian').length], [0, true, 91]);
    // une unité déjà passée ne revient pas d'elle-même
    B.col('file_images').get(`pikaqian/${SET}`).etat = 'fait';
    r = await enf(B.db, { ecrire: true, voulus: [SET], worker: BON });
    verifier('   une unité « fait » n\'est pas remise en file', [B.col('file_images').get(`pikaqian/${SET}`).etat, r.ecartes[0]?.slug], ['fait', SET]);

    // ── le set test seul s'enfile sans bilan (pour un worker qui le ferait) ──────────────────────────────────────────────
    B = fausseBase();
    r = await enf(B.db, { ecrire: true, voulus: [SET], worker: BON });
    verifier('le set test lui-même : pas de bilan exigé, une unité insérée', [r.ecrit, r.inseres, B.col('file_images').size], [true, 1, 1]);
    r = await enf(B.db, { ecrire: true, voulus: ['Set-Inexistant'], worker: BON });
    verifier('un set absent de la table : écarté, rien écrit', [r.ecartes[0]?.slug, !!r.refus], ['Set-Inexistant', true]);

    // ── la source BLOQUÉE ou retirée : plus aucune unité ──────────────────────────────────────────────────────────────────
    B = fausseBase(); B.col('sets').set(SET, { _id: SET, visuelsPikaqian: bilanTest() });
    B.col('collecte_images_etat').set('alerte/source-bloquee/pikaqian', { _id: 'alerte/source-bloquee/pikaqian', active: true });
    r = await enf(B.db, { ecrire: true, voulus: null, worker: BON });
    verifier('alerte « source bloquée » active → 0 unité, refusé', [r.inserer.length, !!r.refus, B.col('file_images').size], [0, true, 0]);
    B.col('collecte_images_etat').set('alerte/source-bloquee/pikaqian', { _id: 'alerte/source-bloquee/pikaqian', active: false });
    r = await enf(B.db, { voulus: null, worker: BON });
    verifier('alerte désactivée (décision) → l\'enfilage redevient possible', r.inserer.length, 91);

    // ── la reprise : les ARRÊTS seulement, par décision ───────────────────────────────────────────────────────────────────
    B = fausseBase(); B.col('sets').set(SET, { _id: SET, visuelsPikaqian: bilanTest() });
    const f = B.col('file_images');
    f.set('pikaqian/Collect-151', { _id: 'pikaqian/Collect-151', source: 'pikaqian', etat: 'refuse', resultat: 'refuse-source-bloquee', ordre: 1, erreur: 'x' });
    f.set('pikaqian/Stellar-Crystal', { _id: 'pikaqian/Stellar-Crystal', source: 'pikaqian', etat: 'refuse', resultat: 'refuse-liste', ordre: 2 });
    f.set('pikaqian/Chasing-Glory-Together', { _id: 'pikaqian/Chasing-Glory-Together', source: 'pikaqian', etat: 'refuse', resultat: 'incomplet-transitoire', ordre: 3 });
    f.set('pikaqian/Terastal-Gathering', { _id: 'pikaqian/Terastal-Gathering', source: 'pikaqian', etat: 'fait', resultat: 'verifie', ordre: 4 });
    r = await enf(B.db, { ecrire: true, reprendre: true, voulus: ['Collect-151', 'Stellar-Crystal', 'Chasing-Glory-Together', 'Terastal-Gathering'], worker: BON });
    verifier('reprise : source bloquée et transitoire épuisé reviennent ; un refus de page (refuse-liste) et un « fait » non', [r.remises, f.get('pikaqian/Collect-151').etat, f.get('pikaqian/Chasing-Glory-Together').etat, f.get('pikaqian/Stellar-Crystal').etat, f.get('pikaqian/Terastal-Gathering').etat],
        [2, 'attente', 'attente', 'refuse', 'fait']);
    verifier('   la reprise écrit son motif, passe en queue, et retire l\'erreur', [!!f.get('pikaqian/Collect-151').remisEnFileMotif, f.get('pikaqian/Collect-151').ordre > 4, f.get('pikaqian/Collect-151').erreur ?? null], [true, true, null]);

    // ── le code source : les gardes sont câblées, pas seulement citées ────────────────────────────────────────────────────
    const src = fs.readFileSync(path.join(__dirname, 'enfiler-pikaqian.js'), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    verifier('la ligne de commande garde la garde du commit du worker (etatDuWorker de remettre-en-file.js)', /require\('\.\/remettre-en-file'\)/.test(src) && /etatDuWorker\(cx\)/.test(src), true);

    // le worker charge le collecteur pikaqian DANS un try : une erreur de chargement ne tue pas la boucle
    const workerSrc = fs.readFileSync(path.join(__dirname, 'collecteur-images.js'), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    verifier('collecteur-images.js : require(\'./collecteur-images-pikaqian\') dans un try, l\'erreur est retenue', /try \{ pkImg = require\('\.\/collecteur-images-pikaqian'\); \} catch \(e\) \{ erreurChargement = e; \}/.test(workerSrc) && !/const pkImg = require/.test(workerSrc), true);
    // l'ALIMENTATEUR n'enfile PAS pikaqian (zh-hans reste « sans source légale » pour lui) : aucune ligne pikaqian dans ses tables, aucune mention dans son code
    const sansCommentaires = t => t.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    verifier('alimentateur.js ne mentionne pas pikaqian, et TABLE_TPC n\'a aucune ligne pikaqian', [/pikaqian/i.test(sansCommentaires(fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'alimentateur.js'), 'utf8'))), require('./collecte-cartes/tpc-sets').TABLE_TPC.some(l => /pikaqian/i.test(`${l.site}${l.slug}`))], [false, false]);

    console.log(`\n${ok} passés, ${ko} en échec (sur ${ok + ko})`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
