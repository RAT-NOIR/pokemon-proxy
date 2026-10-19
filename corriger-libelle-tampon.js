// ============================================================
// CORRIGER LE LIBELLÉ DE TAMPON DE FROSMOTH (MODIFICATION, feu vert nommé du testeur, 2026-10-19)
// ============================================================
//   node corriger-libelle-tampon.js [--plan]                                (lecture seule, défaut)
//   node lot-additif.js ... -- node corriger-libelle-tampon.js --ecrire --attendu=<N>
// Lancé depuis C:\Users\Yung\Desktop\pokemon-proxy (le .env y vit). Collections écrites : `cartes` (images.$.tamponNonRepresente) et `images`.
// Table FERMÉE : une ligne. L'écriture est conditionnelle sur la valeur d'avant exacte ; la sauvegarde est écrite AVANT.
const fs = require('fs');
const path = require('path');

// pokemon-proxy-api-v2 v2/identifier/visuels.js:60 — TAMPON_MAX = 40 : l'API refuse tout tamponNonRepresente > 40 caractères après trim().
const TAMPON_MAX = 40;
const DOSSIER_SAUVEGARDE = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S7/FROSMOTH/';

const CORRECTIONS_LIBELLE = Object.freeze([Object.freeze({
    carteId: 245005, set: 'Sword-Shield', numero: '064', cleR2: 'tcgdex/Sword-Shield/064-245005.webp', docId: 'tcgdex/Sword-Shield/245005/064',
    avant: 'League + 1re place / League + 2e place / League + 3e place / League + 4e place',
    apres: 'League',
    decision: 'testeur 2026-10-19, feu vert nommé : « League » sur l’image partagée ; la place de chaque produit reste dans sa variante league+place-1…4',
})]);

const cle = l => [l.carteId, l.set, l.numero, l.cleR2].join('|');

function validerTable(table) {
    const vues = new Set();
    for (const l of table) {
        if (typeof l.apres !== 'string' || !l.apres.trim()) throw new Error(`${cle(l)} : apres doit être une chaîne non vide`);
        if (l.apres.trim().length > TAMPON_MAX) throw new Error(`${cle(l)} : apres fait ${l.apres.trim().length} caractères, plus que TAMPON_MAX (${TAMPON_MAX})`);
        if (l.apres === l.avant) throw new Error(`${cle(l)} : apres est identique à avant`);
        if (vues.has(cle(l))) throw new Error(`${cle(l)} : ligne en double`);
        vues.add(cle(l));
    }
}
validerTable(CORRECTIONS_LIBELLE);

function juger(valeur, ligne) {
    if (valeur === ligne.apres) return { action: 'deja' };
    if (valeur === ligne.avant) return { action: 'ecrire' };
    return { action: 'refus', motif: `valeur inattendue : ${JSON.stringify(valeur)}` };
}

/** Pure. carte = document `cartes`, doc = document `images`, ligne = une ligne de la table. */
function planifier(carte, doc, ligne) {
    const trouvees = ((carte && carte.images) || []).filter(e => e.set === ligne.set && e.numero === ligne.numero && e.cleR2 === ligne.cleR2);
    const entree = trouvees.length !== 1
        ? { action: 'refus', motif: `${trouvees.length} entrée(s) pour ${ligne.set}/${ligne.numero}/${ligne.cleR2} (une seule attendue)` }
        : juger(trouvees[0].tamponNonRepresente, ligne);
    let document;
    if (!doc || doc._id !== ligne.docId) document = { action: 'refus', motif: `document ${ligne.docId} absent` };
    else if (doc.cleR2 !== ligne.cleR2) document = { action: 'refus', motif: `document ${ligne.docId} : cleR2 ${doc.cleR2} différent` };
    else document = juger(doc.tamponNonRepresente, ligne);
    return { entree, document };
}

/** Pure. Liste AUTORISÉE ; tout le reste lève. */
function analyserArguments(argv) {
    const inconnus = argv.filter(a => !/^--(plan|ecrire|attendu=\d+)$/.test(a));
    if (inconnus.length) throw new Error(`argument inconnu : ${inconnus.join(' ')} — autorisés : --plan, --ecrire, --attendu=<N>`);
    const ecrire = argv.includes('--ecrire');
    const a = argv.find(x => x.startsWith('--attendu='));
    const attendu = a ? Number(a.slice(10)) : undefined;
    if (ecrire && attendu === undefined) throw new Error('--ecrire exige --attendu=<N> : rien n\'est écrit');
    return { ecrire, attendu };
}

async function lirePlans(db) {
    const plans = [];
    for (const l of CORRECTIONS_LIBELLE) {
        const carte = await db.collection('cartes').findOne({ _id: l.carteId });
        const doc = await db.collection('images').findOne({ _id: l.docId });
        plans.push({ ligne: l, carte, doc, plan: planifier(carte, doc, l) });
    }
    return plans;
}
const nbEcrire = plans => plans.reduce((n, p) => n + (p.plan.entree.action === 'ecrire') + (p.plan.document.action === 'ecrire'), 0);

async function executer(db, { ecrire, attendu, log = console.log }) {
    const plans = await lirePlans(db);
    for (const p of plans) log(`${p.ligne.carteId} ${p.ligne.set} ${p.ligne.numero} : entrée ${p.plan.entree.action}${p.plan.entree.motif ? ` (${p.plan.entree.motif})` : ''} · document ${p.plan.document.action}${p.plan.document.motif ? ` (${p.plan.document.motif})` : ''}`);
    const N = nbEcrire(plans);
    log(`N = ${N} action(s) ecrire`);
    if (!ecrire) { log('(plan : rien n\'est écrit)'); return; }
    if (attendu !== N) { console.error(`❌ --attendu=${attendu} différent de N=${N} : rien n'est écrit`); process.exit(2); }
    const refus = plans.filter(p => p.plan.entree.action === 'refus' || p.plan.document.action === 'refus');
    if (refus.length) { console.error('❌ au moins un refus : rien n\'est écrit'); process.exit(1); }
    const f = `${DOSSIER_SAUVEGARDE}sauvegarde-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const obj = plans.map(p => ({ carteId: p.ligne.carteId, set: p.ligne.set, numero: p.ligne.numero, cleR2: p.ligne.cleR2, docId: p.ligne.docId,
        entreeAvant: p.carte.images.find(e => e.set === p.ligne.set && e.numero === p.ligne.numero && e.cleR2 === p.ligne.cleR2).tamponNonRepresente, documentAvant: p.doc.tamponNonRepresente }));
    fs.writeFileSync(f, JSON.stringify(obj, null, 1));
    if (JSON.stringify(JSON.parse(fs.readFileSync(f, 'utf8'))) !== JSON.stringify(obj)) throw new Error('sauvegarde relue différente : rien n\'est écrit');
    log(`sauvegarde → ${f}`);
    for (const { ligne: l, plan } of plans) {
        if (plan.entree.action === 'ecrire') {
            const r = await db.collection('cartes').updateOne({ _id: l.carteId, images: { $elemMatch: { set: l.set, numero: l.numero, cleR2: l.cleR2, tamponNonRepresente: l.avant } } }, { $set: { 'images.$.tamponNonRepresente': l.apres } });
            if (r.matchedCount !== 1) throw new Error(`cartes ${l.carteId} : matchedCount ${r.matchedCount} (1 attendu) — arrêt`);
        }
        if (plan.document.action === 'ecrire') {
            const r = await db.collection('images').updateOne({ _id: l.docId, cleR2: l.cleR2, tamponNonRepresente: l.avant }, { $set: { tamponNonRepresente: l.apres } });
            if (r.matchedCount !== 1) throw new Error(`images ${l.docId} : matchedCount ${r.matchedCount} (1 attendu) — arrêt`);
        }
    }
    const K = nbEcrire(await lirePlans(db));
    log(`relu : ${K} restent à écrire`);
    if (K !== 0) process.exitCode = 1;
}

module.exports = { CORRECTIONS_LIBELLE, TAMPON_MAX, validerTable, planifier, analyserArguments, executer };

if (require.main === module) {
    let args;
    try { args = analyserArguments(process.argv.slice(2)); } catch (e) { console.error(`❌ ${e.message}`); process.exit(2); }
    if (args.ecrire) {
        try { require('./collecte-cartes/images-empruntees').garderSousLot(process.env, process.ppid); } catch (e) { console.error(`❌ ${e.message}`); process.exit(2); }
    }
    (async () => {
        require('dotenv').config();
        const { ouvrirConnexions } = require('./collecte-cartes/garde');
        const { cartes, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
        try { await executer(cartes.db, args); } finally { await fermer(); }
    })().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
}
