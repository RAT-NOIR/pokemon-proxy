'use strict';
// PHOTO-ADMIN-BANC (25/10) — le compte de mesure (`banc: true`) ne fait JAMAIS conserver ses photos dans le banc d'étiquetage : ce sont des photos de banc déjà connues, qui pollueraient la file du testeur.
// La condition s'écrit par ce qu'elle AUTORISE : administrateur ET `banc` différent de true, relu en base à l'instant (les deux chemins : photos reçues, et repli par téléchargement).
// Base EN MÉMOIRE, banc factice qui compte ses écritures, aucun réseau.
const H = require('./_harnais');
const mongoose = require('mongoose');
const db = require('../db');
const registre = require('../registre');
const CP = require('../banc/photo-admin');
const { lireConfig } = require('../config');

const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_PHOTO_ADMIN_DELAI_S: '0', V2_PHOTO_ADMIN_INTERVALLE_S: '0', V2_PHOTO_ADMIN_MAX_JOUR: '100000' });
const oid = () => new mongoose.Types.ObjectId();
const URL_PHOTO = 'https://images1.vinted.net/t/01_00000_abcdef/f800/1700000000.jpeg';

(async () => {
    await H.ouvrirBac('test-photo-admin-banc.js');
    const ecritures = [];
    registre.fournir('banc', { conserverPhoto: async o => { ecritures.push(o.scanId); return 'ecrit'; } });
    const compte = async extra => { const _id = oid(); await db.col('comptes').insertOne({ _id, role: 'administrateur', ...extra }); return { type: 'compte', id: _id, administrateur: true }; };
    const recues = () => ({ entree: { imageUrls: [URL_PHOTO], photoIds: [{ index: 0, photoId: 'a'.repeat(32) }], photosRecues: [{ index: 0, octets: Buffer.from('photo') }], photosRecuesPourCeScan: true } });
    const telecharge = () => ({ entree: { imageUrls: [URL_PHOTO] } });
    const lancer = (porteur, req, scanId) => CP.apresIdentifierAdmin({ cfg, deps: { telechargerPhoto: async () => Buffer.from('photo') }, req, scanId, porteur });

    for (const [chemin, fabrique] of [['photos reçues', recues], ['repli par téléchargement', telecharge]]) {
        ecritures.length = 0;
        const banc = await compte({ banc: true }), ordinaire = await compte({}), faux = await compte({ banc: false });
        H.v(`${chemin} : le compte de mesure (banc: true) ⇒ 'ignore', AUCUNE écriture`, [await lancer(banc, fabrique(), String(oid())), ecritures.length], ['ignore', 0]);
        H.v(`   un administrateur ordinaire ⇒ 'ecrit' (inchangé)`, [await lancer(ordinaire, fabrique(), String(oid())), ecritures.length], ['ecrit', 1]);
        H.v(`   banc: false ⇒ 'ecrit' (seul \`true\` exclut)`, [await lancer(faux, fabrique(), String(oid())), ecritures.length], ['ecrit', 2]);
    }
    { ecritures.length = 0; const p = { type: 'compte', id: oid(), administrateur: true };
      H.v('   un porteur dont le compte n\'existe pas en base ⇒ \'ignore\'', [await lancer(p, recues(), String(oid())), ecritures.length], ['ignore', 0]); }
    await H.fermerBac();
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
