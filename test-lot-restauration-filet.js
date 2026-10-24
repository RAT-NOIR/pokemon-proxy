// node test-lot-restauration-filet.js — LA RESTAURATION DE lot-additif.js N'EST JAMAIS BLOQUÉE PAR LE FILET DES LIGNES DÉTACHÉES (tour de correction 1, point 1).
// Un vrai lot (lot-additif.js, sauvegarde, commande, garde, restauration, relecture, journal) sur une base mongod LOCALE (base-banc.js), jamais la production.
// Le lot DÉTACHE une ligne (la supprime de cartes_produits) et pose le reste « fiche-contredite-par-la-vue » qui l'interdit — comme detacher-lignes-prouvees.js —, sans l'annoncer : la garde ARRÊTE le lot.
// La restauration doit remettre l'état EXACT d'avant le lot : la ligne (interdite par le reste que le lot a posé, tant que ce reste existe) ET le reste (absent de la sauvegarde → retiré).
// Avant le correctif, le filet (installé sur la connexion du lot, comme en production) refusait la réinsertion de la ligne : restauration à moitié faite, exit 1, aucun journal.
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const mongoose = require('mongoose');
const { ouvrirBanc } = require('./collecte-cartes/base-banc');

const COLLS = ['cartes', 'cartes_produits', 'sets', 'collecte_images_etat', 'restes'];
const effacer = process.argv.find(a => a.startsWith('--effacer='))?.slice(10);
const TYPE = 'fiche-contredite-par-la-vue';
const JOUR = new Date('2026-09-20T10:00:00Z');

async function ouvrir() {
    const cx = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: 'test_scratch' }).asPromise();
    if (cx.db.databaseName !== 'test_scratch') { await cx.close(); throw new Error(`base « ${cx.db.databaseName} » : je n'écris que dans test_scratch`); }
    return cx;
}
const semer = async db => {
    await db.collection('cartes').insertMany([
        { _id: 1, nomEn: 'Blastoise', sets: ['Set-A'], collecteLe: JOUR, impressions: [{ tirage: 'intl', expansion: 'Set A', numero: '2' }] },
        { _id: 2, nomEn: 'Pikachu', sets: ['Set-A'], collecteLe: JOUR, impressions: [{ tirage: 'intl', expansion: 'Set A', numero: '58' }] }]);
    await db.collection('cartes_produits').insertMany([
        { _id: '1|100', idProduct: 100, idExpansion: 11, carteId: 1, verifieLe: JOUR },
        { _id: '2|101', idProduct: 101, idExpansion: 11, carteId: 2, verifieLe: JOUR }]);
    await db.collection('sets').insertMany([{ _id: 'Set-A', nomAffichage: 'Set A', collecteLe: JOUR }]);
    await db.collection('collecte_images_etat').insertOne({ _id: 'tcgdex/Set-Z', debute: JOUR, fini: JOUR });
    await db.collection('restes').insertOne({ _id: 'reste-autre', set: 'Set-A', type: 'autre', idProduct: 999 });
};

// ── LA COMMANDE DU LOT
async function jouer(cas) {
    const cx = await ouvrir(), db = cx.db;
    if (cas === 'detacher') {            // comme detacher-lignes-prouvees.js : la ligne part, le reste qui l'interdit arrive
        await db.collection('cartes_produits').deleteOne({ _id: '1|100' });
        await db.collection('restes').insertOne({ _id: 'reste-vu-1-100', set: 'Set-A', type: TYPE, carteId: 1, idProduct: 100 });
    } else if (cas === 'env') {          // la restauration ne doit pas lever le filet par une VARIABLE D'ENVIRONNEMENT héritée par la commande
        console.log(`ENV-ENFANT LIGNES_DETACHEES_RETABLIR=${process.env.LIGNES_DETACHEES_RETABLIR === undefined ? 'absente' : (process.env.LIGNES_DETACHEES_RETABLIR === '' ? 'vide' : 'POSEE')}`);
        await db.collection('cartes_produits').deleteOne({ _id: '1|100' });   // + une baisse non annoncée : le lot s'arrête
    } else throw new Error(`cas inconnu : ${cas}`);
    await cx.close();
}
if (effacer) { jouer(effacer).then(() => process.exit(0), e => { console.error(e); process.exit(1); }); return; }

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

async function main() {
    (await ouvrirBanc()).appliquer();
    const cx = await ouvrir(), db = cx.db;
    const presentes = (await db.listCollections().toArray()).map(c => c.name).filter(n => COLLS.includes(n));
    if (presentes.length) { await cx.close(); throw new Error(`test_scratch porte déjà ${presentes.join(', ')} : je ne les écrase pas (ce ne sont pas les miennes)`); }
    const journal = path.join(os.tmpdir(), `journal-test-restauration-${Date.now()}.md`), dossiers = [];
    const lot = (cas, collections) => {
        const r = spawnSync(process.execPath, ['lot-additif.js', '--base=test_scratch', `--journal=${journal}`, '--confirmation=1', `--quoi=banc ${cas}`, `--collections=${collections}`, '--', 'node', 'test-lot-restauration-filet.js', `--effacer=${cas}`],
            { cwd: __dirname, encoding: 'utf8', env: { ...process.env, LIGNES_DETACHEES_RETABLIR: '' } });
        const ligne = fs.existsSync(journal) ? fs.readFileSync(journal, 'utf8').trim().split('\n').at(-1) : '';
        for (const m of (r.stdout || '').matchAll(/→ (backup-\d{4}-\d\d-\d\d-lot-\d{6}) \(base/g)) dossiers.push(m[1]);
        return { code: r.status, ligne, sortie: r.stdout + r.stderr };
    };
    const remettre = async () => { for (const n of COLLS) await db.collection(n).drop().catch(() => { }); await semer(db); await new Promise(r => setTimeout(r, 1100)); };
    const etat = async () => ({
        ligne: await db.collection('cartes_produits').countDocuments({ _id: '1|100' }),
        restes: (await db.collection('restes').find({}).sort({ _id: 1 }).toArray()).map(r => r._id)
    });
    try {
        // ── A. --collections dans l'ordre PIÈGE : cartes_produits AVANT restes (le reste que le lot a posé existe encore quand la ligne est réinsérée)
        await remettre();
        let r = lot('detacher', 'cartes_produits,restes');
        let e = await etat();
        verifier('A. le lot s\'arrête (code 3) : la ligne détachée sans annonce est une baisse', r.code, 3);
        verifier('A. la ligne détachée est REMISE (le filet ne bloque pas la restauration)', e.ligne, 1);
        verifier('A. le reste posé par le lot est RETIRÉ (état exact d\'avant le lot)', e.restes, ['reste-autre']);
        verifier('A. le journal est écrit : ARRÊT, relu ✅', [/🔴 ARRÊT/.test(r.ligne), /relu ✅/.test(r.ligne)], [true, true]);
        verifier('A. la sortie DIT que le filet est levé pour la restauration', /filet des lignes détachées LEVÉ pour la restauration/.test(r.sortie), true);
        verifier('A. restes est restauré AVANT cartes_produits (la sortie les liste dans cet ordre)', r.sortie.search(/\n\s+restes \d+ remplacé/) < r.sortie.search(/\n\s+cartes_produits \d+ remplacé/) && r.sortie.search(/\n\s+restes \d+ remplacé/) >= 0, true);
        if (r.code !== 3 || e.ligne !== 1) console.log(r.sortie);

        // ── B. --collections SANS restes : restes est tout de même sauvegardé et restauré (garanti)
        await remettre();
        r = lot('detacher', 'cartes');
        e = await etat();
        verifier('B. sans restes dans --collections : arrêt (3), ligne remise, reste retiré', [r.code, e.ligne, e.restes], [3, 1, ['reste-autre']]);
        if (r.code !== 3 || e.ligne !== 1) console.log(r.sortie);

        // ── C. la levée est LOCALE : la commande du lot n'hérite d'aucune variable d'environnement
        await remettre();
        r = lot('env', 'cartes');
        verifier('C. la commande du lot ne reçoit aucune LIGNES_DETACHEES_RETABLIR posée par lot-additif (levée locale, pas d\'environnement)', [r.sortie.includes('ENV-ENFANT LIGNES_DETACHEES_RETABLIR=vide'), r.sortie.includes('LIGNES_DETACHEES_RETABLIR posée')], [true, false]);
        verifier('C. (arrêt 3, ligne remise)', [r.code, (await etat()).ligne], [3, 1]);
    } finally {
        for (const n of COLLS) await db.collection(n).drop().catch(() => { });
        for (const d of dossiers) fs.rmSync(path.join(__dirname, d), { recursive: true, force: true });   // seulement les sauvegardes de CE banc (nommées dans la sortie de ses lots)
        fs.rmSync(journal, { force: true });
        await cx.close();
    }
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
}
main().catch(e => { console.error('❌', e.message); process.exit(1); });
