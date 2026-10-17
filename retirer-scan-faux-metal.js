// ============================================================
// RETIRER LE SCAN FAUX DES PRODUITS EN MATIÈRE SPÉCIALE — lot METAL (2026-10-17) — À BLANC PAR DÉFAUT
// ============================================================
//   node retirer-scan-faux-metal.js [--annonce=<fichier.json>]                       (à blanc : lit, écrit le plan et l'annonce sous S7\METAL, RIEN en base)
//   node lot-additif.js --quoi="METAL : N lignes détachées" --collections=cartes_produits,cartes,restes --annonce=<fichier.json> -- node retirer-scan-faux-metal.js --ecrire --attendu=N
//
// DÉCISION DU TESTEUR (2026-10-17 soir) : « un trou, pas un badge ». Un produit de la table fermée (collecte-cartes/matiere-speciale.js) perd sa ligne `cartes_produits` : il redevient un trou
// (sans fiche, sans visuel) tant qu'on n'a pas le scan de la carte en métal elle-même. Ce que cet outil FAIT, et seulement cela :
//   · détache chaque ligne `cartes_produits` des produits de la table (la carte normale, elle, ne bouge pas) ;
//   · retire l'idProduct de `cartes.liens.idProduct` des cartes concernées ($pull — l'idMetacard reste : la carte normale le porte) ;
//   · écrit un reste « produit-sans-carte » qui dit la raison, pour chaque produit resté sans aucune ligne ;
//   · SAUVEGARDE d'abord les anciennes lignes ENTIÈRES dans un fichier (rien n'est supprimé avant que ce fichier soit écrit).
// La JOINTURE ne les refera pas : `joindre()`, `ecrireJointure` et les poseurs par métacarte lisent la même table (voir matiere-speciale.js).
// ÉCRIT PAR CE QU'IL AUTORISE : `--ecrire` exige `--attendu=N` (le compte lu à blanc) ; un compte qui diffère REFUSE avant toute écriture. Idempotent : rejoué, 0 ligne, `--attendu=0`.
// L'annonce de lot est calculée par LA FONCTION de la garde (compterEtat + comparer), jamais à la main.
// Une référence restante (`cartes.images[].produitsPartages` d'une paire Staff/Jumbo/holo) est SIGNALÉE par le rapport, jamais modifiée ici.
'use strict';
const fs = require('fs');
const path = require('path');
const { EJSON } = require('mongodb').BSON;
const { compterEtat, comparer, validerAnnonces } = require('./collecte-cartes/garde-lot');
const { PRODUITS_MATIERE_SPECIALE } = require('./collecte-cartes/matiere-speciale');
const { autoriser } = require('./collecte-cartes/garde-ecriture');

const RACINE_METAL = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S7\\METAL';
const TABLE_REELLE = PRODUITS_MATIERE_SPECIALE;

/** PUR. Les lignes à détacher (celles des produits de la table), les liens de cartes à nettoyer, et les produits de la table qui n'ont déjà aucune ligne (déjà un trou). */
function planRetrait(table, lignes) {
    const ids = new Set(Object.keys(table).map(Number));
    const aDetacher = lignes.filter(l => ids.has(Number(l.idProduct)));
    const avecLigne = new Set(aDetacher.map(l => Number(l.idProduct)));
    return {
        aDetacher,
        liens: aDetacher.map(l => ({ carteId: l.carteId, idProduct: l.idProduct })),
        sansLigne: [...ids].filter(i => !avecLigne.has(i)).sort((a, b) => a - b),
    };
}

/** PUR. L'annonce de lot : les baisses que la garde verrait, comptées par SA fonction sur les lignes des expansions touchées, avant et après le retrait. */
function annonceDuRetrait(lignesDesExpansions, plan) {
    const retirees = new Set(plan.aDetacher.map(l => l._id));
    const cmp = comparer(compterEtat({ cartesProduits: lignesDesExpansions }), compterEtat({ cartesProduits: lignesDesExpansions.filter(l => !retirees.has(l._id)) }));
    const annonces = Object.fromEntries(cmp.baisses.map(b => [b.cle, b.baisse]));
    validerAnnonces(annonces);
    return annonces;
}

/** `--ecrire` exige `--attendu=N` ; un compte qui diffère refuse. */
function verifierAttendu(attendu, n, ecrire = false) {
    if (ecrire && !Number.isInteger(attendu)) throw new Error('--ecrire exige --attendu=<N> (le nombre de lignes à détacher lu à blanc) : rien n\'est écrit');
    if (attendu !== undefined && attendu !== null && attendu !== n) throw new Error(`--attendu=${attendu} mais ${n} ligne(s) à détacher : rien n'est écrit`);
}

/**
 * L'exécution, sur collections INJECTÉES (L = cartes_produits, C = cartes, R = restes). `ecrireFichier(nom, contenu)` : 'plan' et 'annonce' à blanc ; 'sauvegarde' avant toute suppression.
 * @returns {{aDetacher: number, sansLigne: number[], annonce: object, detachees?: number}}
 */
async function executer({ L, C, R, table = TABLE_REELLE, ecrire = false, attendu, ecrireFichier, log = console.log }) {
    const ids = Object.keys(table).map(Number);
    const lignes = await L.find({ idProduct: { $in: ids } }).toArray();
    const plan = planRetrait(table, lignes);
    const exps = [...new Set(plan.aDetacher.map(l => l.idExpansion))];
    const dEx = exps.length ? await L.find({ idExpansion: { $in: exps } }).toArray() : [];
    const annonce = annonceDuRetrait(dEx, plan);
    log(`   ${ids.length} produit(s) en matière spéciale · ${plan.aDetacher.length} ligne(s) à détacher · ${plan.sansLigne.length} déjà sans ligne (${plan.sansLigne.join(', ') || '—'})`);
    log(`   annonce de la garde : ${JSON.stringify(annonce)}`);
    verifierAttendu(attendu, plan.aDetacher.length, ecrire);
    const sortie = { aDetacher: plan.aDetacher.length, sansLigne: plan.sansLigne, annonce };
    if (!ecrire) {
        ecrireFichier('plan', EJSON.stringify({ date: '2026-10-17', table: ids, aDetacher: plan.aDetacher, liens: plan.liens, sansLigne: plan.sansLigne }, null, 1));
        ecrireFichier('annonce', JSON.stringify(annonce, null, 1));
        log('   (à blanc — rien n\'est écrit en base)');
        return sortie;
    }
    if (!plan.aDetacher.length) { log('   rien à détacher (déjà des trous)'); return { ...sortie, detachees: 0 }; }
    // la sauvegarde d'abord : les anciennes lignes ENTIÈRES (restaurables par un insertMany et un $addToSet de liens.idProduct)
    ecrireFichier('sauvegarde', EJSON.stringify({ date: '2026-10-17', lignes: plan.aDetacher, liens: plan.liens }, null, 1));
    const r = await L.deleteMany({ _id: { $in: plan.aDetacher.map(l => l._id) } });
    for (const x of plan.liens) await C.updateOne({ _id: x.carteId }, { $pull: { 'liens.idProduct': x.idProduct } });
    const gardent = new Set(); // un produit qui garde une autre ligne (hors table : impossible, la table est entière) ne reçoit pas de reste
    for (const l of plan.aDetacher) {
        if (gardent.has(l.idProduct)) continue; gardent.add(l.idProduct);
        await R.updateOne({ set: l.slugSet, type: 'produit-sans-carte', idProduct: l.idProduct },
            { $set: { detail: `${l.idProduct} « ${table[l.idProduct]?.nom ?? ''} » : matière spéciale (table fermée) — ${table[l.idProduct]?.motif ?? ''} ; ligne ${l._id} détachée par retirer-scan-faux-metal.js (décision du testeur, 2026-10-17)`, le: new Date() } }, { upsert: true });
    }
    const encore = await L.countDocuments({ _id: { $in: plan.aDetacher.map(l => l._id) } });
    log(`   ✅ détachées : ${r.deletedCount} (attendu ${plan.aDetacher.length}) · encore présentes : ${encore}`);
    if (r.deletedCount !== plan.aDetacher.length || encore) process.exitCode = 1;
    return { ...sortie, detachees: r.deletedCount };
}

async function main() {
    const AUTORISES = [/^--ecrire$/, /^--attendu=\d+$/, /^--annonce=.+\.json$/];
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — usage : [--annonce=<fichier.json>] | --ecrire --attendu=<N>`); process.exit(2); }
    const ecrire = process.argv.includes('--ecrire');
    const attendu = process.argv.find(a => a.startsWith('--attendu='))?.slice(10);
    const annonce = process.argv.find(a => a.startsWith('--annonce='))?.slice(10);
    // à blanc : l'utilisateur de LECTURE seule (aucune écriture possible) ; --ecrire : la connexion de la garde (lot-additif.js a sauvegardé avant)
    let cx, fermer;
    if (ecrire) { const { ouvrirConnexions } = require('./collecte-cartes/garde'); const o = await ouvrirConnexions({ production: false, buckets: [] }); cx = o.cartes; fermer = o.fermer; }
    else { const { ouvrir } = require('C:\\Users\\Yung\\rat-market-travail\\catalogue\\scratch\\lecture.js'); const o = await ouvrir(); cx = { db: o.db }; fermer = () => o.client.close(); }
    const chemins = { plan: path.join(RACINE_METAL, 'plan-retrait.json'), annonce: annonce ? path.resolve(annonce) : path.join(RACINE_METAL, 'annonce-retrait.json'), sauvegarde: path.join(RACINE_METAL, `sauvegarde-retrait-${new Date().toISOString().replace(/[:.]/g, '-')}.json`) };
    const ecrireFichier = (nom, contenu) => fs.writeFileSync(autoriser(chemins[nom], [RACINE_METAL]), contenu);
    try {
        await executer({ L: cx.db.collection('cartes_produits'), C: cx.db.collection('cartes'), R: cx.db.collection('restes'), ecrire, attendu: attendu === undefined ? undefined : Number(attendu), ecrireFichier });
    } finally { await fermer(); }
}
module.exports = { planRetrait, annonceDuRetrait, verifierAttendu, executer, TABLE_REELLE, RACINE_METAL };
if (require.main === module) main().catch(e => { console.error('❌', e.message); process.exitCode = 1; });
