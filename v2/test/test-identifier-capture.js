'use strict';
// Banc B1b.2 — le double de `res` que la chaîne héritée (gererIdentifier) reçoit. `headersSent` doit être HONNÊTE :
// rembourserSiRienLivre (index.js:3463) le lit pour savoir qu'un résultat a été livré.
// Assertion (5) : le VRAI gererIdentifier, hors ligne (faux réseau du verrou préchargé), sur une charge de verrou/charges.json,
// dans un processus ENFANT (le faux réseau est un préchargement `-r`, jamais chargé dans le banc lui-même). Base : la base de banc EN MÉMOIRE,
// jamais la production. Le catalogue dont la charge a besoin y est fabriqué (tranche minimale, voir semer()).
const path = require('path'), fs = require('fs');
const MODE_ENFANT = process.argv.includes('--enfant');
const RACINE = path.join(__dirname, '..', '..');
const CHARGES = path.join(RACINE, 'verrou', 'charges.json');
// La charge « occidentale » : Tropius 001/064 PBL (français), vrai idProduct 895789 (voir charges.json).
const charge = () => JSON.parse(fs.readFileSync(CHARGES, 'utf8')).charges.find(c => c.cellule === 'occidentale');

if (MODE_ENFANT) {
    (async () => {
        const H = require('./_harnais');
        await H.ouvrirBancV2();                       // hérite de la base de banc du parent (loopback) ou refuse
        process.env.MONGODB_BASE = 'test_scratch';
        const mongoose = require('mongoose');
        const { fauxRes } = require('../identifier/captureres');
        const { gererIdentifier } = require(path.join(RACINE, 'index.js'));
        for (let i = 0; i < 200 && mongoose.connection.readyState !== 1; i++) await new Promise(r => setTimeout(r, 100));
        if (mongoose.connection.readyState !== 1) { console.log('SORTIE ' + JSON.stringify({ erreur: 'mongo' })); process.exit(0); }
        const c = charge(), db = mongoose.connection.db;
        const ID = c.source.idProduct, EXP = 990001;
        const avant = {};
        for (const n of ['catalogue_produits', 'numeros_cartes', 'codes_set', 'guide_prix']) avant[n] = await db.collection(n).countDocuments({});
        await semer(db, ID, EXP);
        const scanIdImpose = new mongoose.Types.ObjectId();
        const req = { body: { imageUrls: [c.imageUrl], title: null, vintedEtat: null, userId: 'capture-b1b2' }, scanIdImpose, headers: {} };
        const res = fauxRes();
        await gererIdentifier(req, res);
        console.log('SORTIE ' + JSON.stringify({ avant, corps: res.corps, statut: res.statut, headersSent: res.headersSent, doubles: res.doubles, scanIdImpose: String(scanIdImpose) }));
        process.exit(0);
    })().catch(e => { console.log('SORTIE ' + JSON.stringify({ erreur: String(e && e.stack || e) })); process.exit(0); });
} else {
    const { v, vrai, bilan, ouvrirBancV2, lancerNode, arreterBanc } = require('./_harnais');
    let fauxRes;
    try { ({ fauxRes } = require('../identifier/captureres')); } catch (e) { console.log(`❌ captureres.js illisible : ${e.message}`); process.exit(1); }

    // (1) avant json : headersSent === false ; après : true, corps et statut capturés (200 par défaut)
    {
        const r = fauxRes();
        v('avant json : headersSent', r.headersSent, false);
        v('avant json : statut et corps', [r.statut, r.corps], [null, null]);
        const retour = r.json({ success: true, a: 1 });
        v('après json : headersSent', r.headersSent, true);
        v('après json : corps', r.corps, { success: true, a: 1 });
        v('après json : statut 200 par défaut', [r.statut, r.statusCode], [200, 200]);
        v('doubles à 0', r.doubles, 0);
        vrai('json() rend res (chaînable, comme Express)', retour === r);
    }
    // (2) un second json() est ignoré et compté
    {
        const r = fauxRes(); r.json({ n: 1 }); r.json({ n: 2 }); r.status(500).json({ n: 3 });
        v('second json ignoré : corps du premier', r.corps, { n: 1 });
        v('second json ignoré : statut du premier', r.statut, 200);
        v('doubles compté (2 appels de trop)', r.doubles, 2);
        v('headersSent reste vrai', r.headersSent, true);
    }
    // (3) res.status(500).json(...) capture 500 ; status() seul ne livre rien
    {
        const r = fauxRes(); const s = r.status(500);
        vrai('status() rend res', s === r);
        v('status() seul : headersSent faux', r.headersSent, false);
        r.json({ success: false });
        v('status(500).json : statut', [r.statut, r.statusCode], [500, 500]);
        v('status(500).json : corps', r.corps, { success: false });
        v('status(500).json : headersSent', r.headersSent, true);
    }
    // (4) end() sans corps => corps null (panne pour l'adaptateur), mais headersSent vrai ; setHeader sans effet sur la livraison
    {
        const r = fauxRes(); r.setHeader('X-A', 'b');
        v('setHeader seul : headersSent faux', r.headersSent, false);
        r.end();
        v('end() : corps null', r.corps, null);
        v('end() : headersSent vrai (la réponse est partie)', r.headersSent, true);
        r.json({ tard: 1 });
        v('json après end : ignoré et compté', [r.corps, r.doubles], [null, 1]);
        const r2 = fauxRes(); r2.status(204).end();
        v('end() après status(204)', [r2.statut, r2.corps], [204, null]);
        const r3 = fauxRes();
        v('deux doubles sont indépendants', [r3.headersSent, r3.doubles], [false, 0]);
    }

    // (5) le VRAI gererIdentifier, hors ligne
    (async () => {
        const banc = await ouvrirBancV2();
        process.env.VERROU_CHARGES = CHARGES;
        process.env.MONGODB_BASE = 'test_scratch';
        process.env.STRIPE_SECRET_KEY = '';
        process.env.OPENROUTER_API_KEY = '';
        process.env.JETON_API = 'jeton-verrou';
        const r = await lancerNode(['-r', path.join(RACINE, 'verrou', 'faux-reseau.js'), __filename, '--enfant'], 90000);
        const ligne = (r.stdout.split('\n').find(l => l.startsWith('SORTIE ')) || '').slice(7);
        let s = null; try { s = JSON.parse(ligne); } catch { /* sortie illisible */ }
        if (!s || s.erreur) {
            console.log(`❌ (5) l'enfant n'a rien rendu d'exploitable : ${s ? s.erreur : 'pas de ligne SORTIE'} (code ${r.status})\n${r.stdout.slice(-1500)}\n${r.stderr.slice(-800)}`);
            v('(5) enfant exploitable', false, true);
        } else {
            v('(5) base de banc vide au départ (rien de la production)', s.avant, { catalogue_produits: 0, numeros_cartes: 0, codes_set: 0, guide_prix: 0 });
            v('(5) corps.success', s.corps && s.corps.success, true);
            v('(5) corps.scanId === req.scanIdImpose', s.corps && String(s.corps.scanId), s.scanIdImpose);
            v('(5) headersSent après la chaîne', s.headersSent, true);
            v('(5) statut 200', s.statut, 200);
            v('(5) aucun double json', s.doubles, 0);
            v('(5) le produit désigné est celui de la charge', s.corps && s.corps.carte && s.corps.carte.idProduct, charge().source.idProduct);
        }
        await arreterBanc();
        bilan();
    })().catch(e => { console.error('❌', e); process.exitCode = 1; });
}

// La tranche minimale que la charge exige (Tropius 001/064 PBL, français) : un set, son code, un numéro, un produit, un prix.
// FABRIQUÉE (la production ne se lit pas) : seul l'idProduct vient de la charge ; set, nom et prix sont des valeurs de banc.
async function semer(db, id, exp) {
    await db.collection('codes_set').insertOne({ idExpansion: exp, codeSet: 'PBL', apprisLe: new Date() });
    await db.collection('catalogue_produits').insertOne({ idProduct: id, name: 'Tropius (PBL 001)', idExpansion: exp, idMetacard: 990101 });
    await db.collection('numeros_cartes').insertOne({ idProduct: id, idExpansion: exp, numero: '001', numeroUrl: 'PBL001', codeSet: 'PBL', nomFr: 'Tropius',
        slug: 'Tropius-PBL001', slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte' });
    await db.collection('guide_prix').insertOne({ idProduct: id, avg: 1.1, low: 0.5, trend: 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
}
