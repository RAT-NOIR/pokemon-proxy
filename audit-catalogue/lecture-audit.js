'use strict';
// ============================================================
// AUDIT DU CATALOGUE — LECTURE SEULE (brief S8/AUDIT, 2026-10-24)
// ============================================================
// Deux connexions, et seulement elles : la production `test` par MONGODB_LECTURE_URI, la base `cartes` par MONGODB_CARTES_LECTURE_URI
// (les utilisateurs Atlas de lecture, comme scratch/lecture.js). JAMAIS MONGODB_URI ni MONGODB_CARTES_URI. Aucune URI n'est imprimée :
// toute erreur passe par `masquer`. Un `cartes` ou un `test` sans collection est une grappe fausse (§50), jamais « une base vide ».
const RACINE_PRINCIPALE = 'C:/Users/Yung/Desktop/pokemon-proxy';
require('dotenv').config({ path: `${RACINE_PRINCIPALE}/.env`, quiet: true });
const { MongoClient } = require('mongodb');

const masquer = s => String(s && s.message ? s.message : s).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>');
const VARIABLES = Object.freeze({ prod: 'MONGODB_LECTURE_URI', cartes: 'MONGODB_CARTES_LECTURE_URI' });
const BASES = Object.freeze({ prod: 'test', cartes: 'cartes' });

/** Ouvre les deux bases en lecture. Rend { prod, cartes, fermer } (prod, cartes : des `Db`). Lève, sans URI, si une variable manque ou si une base est vide. */
async function ouvrirLecture() {
    const clients = [];
    try {
        const sortie = {};
        for (const [cle, variable] of Object.entries(VARIABLES)) {
            const uri = process.env[variable];
            if (!uri) throw new Error(`${variable} absente : lecture impossible (jamais un repli sur une variable d'écriture)`);
            const client = new MongoClient(uri);
            clients.push(client);
            await client.connect();
            const db = client.db(BASES[cle]);
            const n = (await db.listCollections({}, { nameOnly: true }).toArray()).length;
            if (!n) throw new Error(`base « ${BASES[cle]} » sans collection : grappe fausse ?`);
            sortie[cle] = db;
        }
        return { ...sortie, fermer: async () => { for (const c of clients) { try { await c.close(); } catch { /* déjà fermé */ } } } };
    } catch (e) {
        for (const c of clients) { try { await c.close(); } catch { /* ignoré */ } }
        throw new Error(masquer(e));
    }
}

module.exports = { ouvrirLecture, masquer, RACINE_PRINCIPALE, VARIABLES, BASES };
