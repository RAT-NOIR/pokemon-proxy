'use strict';
// BANC-200 (tour 1, relecture 1 I2) — ÉCRIT l'ANCRE d'un seau scellé : `v2/bancs/ancres/<seauId>.json`, que le coordinateur commit. Lecture seule de la base ; la seule écriture est ce fichier.
//   node v2/mesures/ancrer-seau.js --base=<base de LECTURE> --seau=<id> [--dossier=<dossier d'ancres>]       (variable : MONGODB_ESSAI_LECTURE_URI ; jamais la base `test`)
// Écrit par ce qu'il AUTORISE : un seau SCELLÉ dont la chaîne est intacte ; un fichier absent est créé, un fichier IDENTIQUE est laissé, un fichier qui DIFFÈRE de la base n'est JAMAIS remplacé (ANCRE_DIFFERENTE : c'est
// exactement le cas que l'ancre existe pour signaler). Le dossier est celui du dépôt par défaut ; les bancs en donnent un temporaire.
const fs = require('fs');
const path = require('path');
const { verifierChaineSeau, COLLECTIONS } = require('../banc/seau');
const { DOSSIER, CHAMPS, lireAncre } = require('../banc/ancre');
const B = require('./exporter-banc-admin');

const erreur = (code, message) => Object.assign(new Error(message || code), { code });

/** @returns {Promise<object>} l'ancre (écrite ou déjà présente et identique). */
async function ecrireAncre({ seauId, colFn, dossier = DOSSIER }) {
    const seau = await colFn(COLLECTIONS.seaux).findOne({ _id: String(seauId) });
    if (!seau) throw erreur('SEAU_INCONNU', 'seau inconnu');
    if (seau.etat !== 'scelle') throw erreur('SEAU_OUVERT', 'on n\'ancre qu\'un seau scellé');
    const chaine = await verifierChaineSeau(colFn, seau._id, { exigerAncre: false });          // la chaîne doit être intacte ; l'ancre est justement ce qu'on est en train d'écrire
    if (!chaine.ok) throw erreur('CHAINE_ROMPUE', 'la chaîne est rompue : rien n\'est ancré');
    const a = {};
    for (const k of CHAMPS) if (k === 'seauId') a.seauId = seau._id; else if (seau[k] !== undefined) a[k] = seau[k] instanceof Date ? seau[k].toISOString() : seau[k];
    // l'ancre porte AUSSI la chaîne des errata : sa tête et leur nombre
    const errata = await colFn(COLLECTIONS.errata).find({ seauId: seau._id }).sort({ n: 1 }).toArray();
    a.errata = errata.length; a.erratumTete = errata.length ? errata[errata.length - 1].empreinte : null;
    const existante = lireAncre(seau._id, dossier);
    const ecrire = (drapeau) => { fs.mkdirSync(dossier, { recursive: true }); fs.writeFileSync(path.join(dossier, `${seau._id}.json`), JSON.stringify({ ...a, ancreLe: new Date().toISOString().slice(0, 10) }, null, 1) + '\n', { flag: drapeau }); };
    if (existante) {
        const meme = CHAMPS.every(k => JSON.stringify(existante[k] ?? null) === JSON.stringify(a[k] ?? null));
        if (!meme) throw erreur('ANCRE_DIFFERENTE', 'une ancre existe et diffère de la base : elle n\'est jamais remplacée');
        const [ee, te] = [existante.errata ?? 0, existante.erratumTete ?? null];
        if (ee === a.errata && te === a.erratumTete) return existante;
        // seule évolution permise : la chaîne des errata s'est ALLONGÉE à partir de la tête déjà ancrée (ré-ancrage) ; une chaîne raccourcie ou refaite n'est jamais ancrée
        const prolonge = ee < a.errata && (ee === 0 || errata[ee - 1].empreinte === te);
        if (!prolonge) throw erreur('ANCRE_DIFFERENTE', 'la chaîne des errata ne prolonge pas celle de l\'ancre : elle n\'est jamais remplacée');
        ecrire('w');
        return a;
    }
    ecrire('wx');
    return a;
}

async function lancerCLI(argv, { env = process.env, connecter = B.connecterLecture, journal = l => console.log(l) } = {}) {
    const v = { base: null, seau: null, dossier: null };
    for (const a of argv) {
        const m = /^--(base|seau|dossier)=(.+)$/s.exec(String(a));
        if (!m || v[m[1]] !== null) { console.error('❌ ARRÊT : argument non reconnu ou répété. usage : node v2/mesures/ancrer-seau.js --base=<base de lecture> --seau=<id> [--dossier=<dossier>]'); return 1; }
        v[m[1]] = m[2];
    }
    if (!v.base || v.base.toLowerCase() === 'test' || !v.seau) { console.error('❌ ARRÊT : --base (jamais `test`) et --seau sont requis'); return 1; }
    if (typeof env.MONGODB_ESSAI_LECTURE_URI !== 'string' || !env.MONGODB_ESSAI_LECTURE_URI) { console.error('❌ ARRÊT : MONGODB_ESSAI_LECTURE_URI absente'); return 1; }
    let c = null;
    try {
        c = await connecter(env, v.base);
        const a = await ecrireAncre({ seauId: v.seau, colFn: c.colFn, ...(v.dossier ? { dossier: v.dossier } : {}) });
        journal(`ancre du seau ${a.seauId} : tête ${a.tete} (à committer)`);
        return 0;
    } catch (e) { console.error(`❌ ARRÊT : ${(e && e.code) || (e && e.name) || 'erreur'}`); return 1; }
    finally { try { if (c && c.fermer) await c.fermer(); } catch { /* rien */ } }
}

module.exports = { ecrireAncre, lancerCLI };
if (require.main === module) { require('dotenv').config(); lancerCLI(process.argv.slice(2)).then(code => process.exit(code)); }
