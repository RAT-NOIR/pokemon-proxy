// LA LECTURE de l'état par la PHASE 2 (utilisateur de lecture seule, l'URI est donnée par l'appelant, jamais imprimée).
// Extraite de corriger-visuels-phase2.js pour être testée sur un mongod local (test-phase2-lecture.js).
// 🔴 Le défaut du 24/10/2026 (écriture réelle du lot A) : `imagesRetirees` était une FERMETURE qui lisait avec le client que le `finally` venait de
// fermer — « MongoNotConnectedError ». Toute lecture se fait maintenant AVANT la fermeture ; la fonction rendue ne touche plus la base.
'use strict';
const { MongoClient } = require('mongodb');

/**
 * L1 (relecture v2) : `images[].imageEmprunteeLot`, la marque du lot B, n'est lue ni par le site ni par l'API : elle n'est dans AUCUNE projection d'état. La relecture d'un lot B et celle de
 * `--annuler` la LISENT donc par cette projection-ci : on ajoute la marque aux projections de l'appelant, sauf si elles portent déjà « images » entier (Mongo refuse un chemin et son parent).
 */
const avecMarqueDeLot = p => (p && p.images === 1 ? p : { ...p, 'images.imageEmprunteeLot': 1 });

/**
 * @param clesImages les clés de fichier dont on veut l'état dans la collection `images` (lues ICI, client ouvert).
 * @returns {Promise<{sets, cartes, cartesProduits, imagesRetirees: (cles: string[]) => Promise<{cleR2, etat}[]>}>}
 */
async function lireEtat({ uri, dbName = 'cartes', projectionsCartes, projectionsLignes, clesImages = [] }) {
    const client = new MongoClient(uri);
    await client.connect();
    try {
        const db = client.db(dbName);
        const [sets, cartes, cartesProduits] = await Promise.all([db.collection('sets').find({}).toArray(),
            db.collection('cartes').find({}).project(avecMarqueDeLot(projectionsCartes)).toArray(), db.collection('cartes_produits').find({}).project({ ...projectionsLignes }).toArray()]);
        for (const [n, l] of [['sets', sets], ['cartes', cartes], ['cartes_produits', cartesProduits]]) if (!l.length) throw new Error(`« ${n} » est VIDE : base fausse`);
        const annoncees = new Set(clesImages);
        const docs = annoncees.size ? await db.collection('images').find({ cleR2: { $in: [...annoncees] } }).project({ cleR2: 1, etat: 1 }).toArray() : [];
        const imagesRetirees = async cles => {
            const inconnues = cles.filter(c => !annoncees.has(c));
            if (inconnues.length) throw new Error(`imagesRetirees : clé(s) non annoncée(s) à la lecture (clesImages) : ${inconnues.join(', ')} — la connexion est fermée, aucune relecture n'est possible`);
            return docs.filter(d => cles.includes(d.cleR2));
        };
        return { sets, cartes, cartesProduits, imagesRetirees };
    } finally { await client.close(); }
}
module.exports = { lireEtat, avecMarqueDeLot };
