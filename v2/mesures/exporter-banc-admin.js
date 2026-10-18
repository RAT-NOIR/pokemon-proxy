'use strict';
// ETIQUETAGE-B — l'EXPORT en LECTURE SEULE du banc de l'administrateur vers l'outil de mesure (mesurer-identification.js : lireExportBancAdmin, mesurerGeminiSeul).
//   node v2/mesures/exporter-banc-admin.js --base=<nom de la base de LECTURE> --sortie=<dossier local absolu>
// Il lit `banc_lignes` (source `etiquette-admin`, état confirmé) par l'URI de LECTURE MONGODB_ESSAI_LECTURE_URI (jamais MONGODB_URI) et les photos du bucket de V2_BANC_BUCKET (méthode `lire` seule),
// puis écrit, dans LE dossier donné et nulle part ailleurs :
//   manifeste.json  { format: 'banc-admin-v1', base, lignes, photos, sansPhoto, ... }   (des dénominateurs, aucun identifiant)
//   lignes.json     [{ id, photo: 'photos/<clé>.webp' | null, verite, aucune, statut: 'affirmee'|'question'|'introuvable'|'autre', reponse: {statut, idProduct, candidats, questionCode}, versionModele, versionChaine, rev, anonyme }]
//   photos/<32 hexadécimaux>.webp
// Écrit par ce qu'il AUTORISE :
//   · la base : un nom de TEXTE non vide, différent de `test` (la production), que la connexion confirme ;
//   · le dossier : absolu, ni la racine d'un disque, ni DANS un dossier d'apports (Logo FR, apport-manuel, LOGO, Logo JP, Logo ZH) ou de photos du verrou, ni sous un Bureau, JUGÉ SUR SON CHEMIN RÉEL COMPLET (ancêtres compris ; un lien vers un tel dossier est refusé, une cible qui est un lien aussi) ; la racine temporaire est jugée par les mêmes règles ;
//     le dossier de sortie N'EXISTE PAS : l'export le crée lui-même (création exclusive, le parent doit exister) et n'écrit que dedans ;
//   · chaque écriture passe par `ecrireDans`, qui résout le chemin et le refuse s'il sort du dossier ; un nom de photo ne vient que d'une clé de la forme du banc (jamais d'un texte libre) ;
//   · la base et le bucket ne reçoivent AUCUNE écriture : cet outil n'appelle que find et lire.
// Aucune valeur de variable, d'URI ni de clé n'est jamais journalisée.
const fs = require('fs');
const os = require('os');
const path = require('path');

const FORMAT = 'banc-admin-v1';
const CLE_BANC = /^banc-reel\/v2\/[0-9a-f]{32}\.webp$/;
const APPORTS = Object.freeze(['logo fr', 'logo jp', 'logo zh', 'logo', 'apport-manuel', 'apports-manuels']);   // SECONDE couche : des dossiers que le testeur remplit lui-même (la première est la liste des racines permises)
const erreur = (code, message) => Object.assign(new Error(message || code), { code });
/** Un segment de chemin comparé comme Windows le lit : casse ignorée, points et espaces FINAUX ignorés (« Logo FR. » et « Logo FR  » désignent « Logo FR »). */
const segmentNorm = s => String(s).replace(/[. ]+$/, '').toLowerCase();

/**
 * Le chemin est-il refusé par le NOM ? Pure. @returns {string|null} la raison du refus, ou null.
 * C'est la SECONDE couche : la première est « sous une racine permise » (racinesPermises / jugerSortie) ; celle-ci refuse en plus, SOUS une racine permise, ce qui ressemble à un dossier d'apports,
 * à `verrou/photos`, à un Bureau, à la racine d'un disque, ou à un nom court 8.3 (non développé : on ne sait pas ce qu'il désigne).
 */
function refusDeDossier(dossier) {
    if (typeof dossier !== 'string' || !dossier.trim()) return 'dossier absent';
    if (!path.isAbsolute(dossier) && !/^[A-Za-z]:[\\/]/.test(dossier)) return 'dossier non absolu';
    const norm = dossier.replace(/\//g, '\\').replace(/\\+$/, '');
    const segments = norm.split('\\').filter(Boolean).map(segmentNorm);
    if (segments.length < 2) return 'racine d\'un disque';
    if (segments.some(s => APPORTS.includes(s))) return 'dossier d\'apports manuels';
    if (segments.some(s => s === 'desktop' || s === 'bureau' || s.startsWith('onedrive'))) return 'sous un Bureau (ou un dossier synchronisé)';
    if (segments.some(s => /~\d+(\..*)?$/.test(s))) return 'nom court 8.3 (non développé)';
    for (let i = 0; i < segments.length - 1; i++) if (segments[i] === 'verrou' && segments[i + 1] === 'photos') return 'dossier de photos du verrou';
    return null;
}

/** Écrit `contenu` à `relatif` DANS `racine`, ou lève HORS-DOSSIER. Le seul point d'écriture de l'outil. `juge` (facultatif) est rappelé JUSTE AVANT l'écriture : il relève le chemin réel du dossier de sortie. */
function ecrireDans(racine, relatif, contenu, juge = null) {
    if (typeof relatif !== 'string' || !relatif || path.isAbsolute(relatif) || /^[A-Za-z]:/.test(relatif)) throw erreur('HORS-DOSSIER');
    const base = path.resolve(racine), cible = path.resolve(base, relatif);
    const rel = path.relative(base, cible);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw erreur('HORS-DOSSIER');
    if (typeof juge === 'function') juge();
    fs.mkdirSync(path.dirname(cible), { recursive: true });
    fs.writeFileSync(cible, contenu);
    return cible;
}

const statutDe = s => ({ identifiee: 'affirmee', 'a-trancher': 'question', introuvable: 'introuvable' })[s] || 'autre';

/**
 * I1 — le chemin RÉEL de la cible (ou de son plus proche ancêtre existant, complété du reste) est jugé par les MÊMES règles que le chemin donné : un lien (jonction, lien symbolique) vers un dossier
 * d'apports, vers `verrou/photos` ou vers la racine d'un disque est refusé même si son nom est innocent. Une cible qui est elle-même un lien est refusée. `realpath` et `lstat` sont injectables :
 * les bancs prouvent le refus SANS créer de lien. Toute erreur autre que « n'existe pas » refuse (une garde qui ne peut pas conclure bloque).
 */
function jugerCheminReel(dossier, realpath, lstat) {
    try {
        const st = lstat(dossier);
        if (st && typeof st.isSymbolicLink === 'function' && st.isSymbolicLink()) throw erreur('DOSSIER-REFUSE', 'la cible est un lien');
    } catch (e) { if (e && e.code === 'DOSSIER-REFUSE') throw e; if (!e || e.code !== 'ENOENT') throw erreur('DOSSIER-REFUSE', 'cible illisible'); }
    let p = path.resolve(dossier);
    const reste = [];
    for (;;) {
        let reel = null;
        try { reel = realpath(p); } catch (e) { if (!e || e.code !== 'ENOENT') throw erreur('DOSSIER-REFUSE', 'chemin réel illisible'); }
        if (typeof reel === 'string' && reel) {
            const complet = reste.length ? path.join(reel, ...reste.reverse()) : reel;
            const raison = refusDeDossier(complet.replace(/^\\\\\?\\/, ''));
            if (raison) throw erreur('DOSSIER-REFUSE', `chemin réel : ${raison}`);
            return complet;
        }
        const parent = path.dirname(p);
        if (parent === p) throw erreur('DOSSIER-REFUSE', 'aucun ancêtre existant');
        reste.push(path.basename(p)); p = parent;
    }
}

const comparable = p => path.resolve(String(p).replace(/^\\\\\?\\/, '')).replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
const sous = (p, base) => p === base || p.startsWith(`${base}/`);

/**
 * M1 — LA LISTE DE CE QUI EST PERMIS (une garde s'écrit par ce qu'elle autorise) : l'export n'écrit que SOUS une racine permise —
 *   · le dossier temporaire du système (`tmpdir()`), toujours ;
 *   · la racine NOMMÉE par `V2_EXPORT_RACINE` : absolue, existante, et jamais un dossier d'apports, `verrou/photos`, un Bureau (`Desktop`) ni la racine d'un disque.
 * Une `V2_EXPORT_RACINE` posée mais invalide REFUSE tout l'export (une garde qui ne peut pas conclure bloque). Les racines sont jugées sur leur chemin RÉEL.
 */
function racinesPermises({ env, realpath, tmpdir }) {
    const racines = [];
    // N2 : la racine temporaire est jugée par les MÊMES règles que la racine nommée (un TEMP trop large — un Bureau, la racine d'un disque, un dossier d'apports — n'est PAS une racine permise)
    try { const t = String(realpath(tmpdir())).replace(/^\\\\\?\\/, ''); if (!refusDeDossier(t)) racines.push(comparable(t)); } catch { /* pas de temporaire lisible : pas de racine temporaire */ }
    const v = env && env.V2_EXPORT_RACINE;
    if (v !== undefined && v !== '') {
        if (typeof v !== 'string' || !v.trim() || (!path.isAbsolute(v) && !/^[A-Za-z]:[\\/]/.test(v))) throw erreur('DOSSIER-REFUSE', 'racine nommée absente ou relative');
        let reel;
        try { reel = realpath(v); } catch { throw erreur('DOSSIER-REFUSE', 'racine nommée inexistante ou illisible'); }
        const raison = refusDeDossier(String(reel).replace(/^\\\\\?\\/, ''));
        if (raison) throw erreur('DOSSIER-REFUSE', `racine nommée : ${raison}`);
        if (String(reel).split(/[\\/]+/).filter(Boolean).map(segmentNorm).some(s => s === 'desktop' || s === 'bureau')) throw erreur('DOSSIER-REFUSE', 'racine nommée : sous un Bureau');
        racines.push(comparable(reel));
    }
    return racines;
}

/** Le jugement COMPLET du dossier de sortie : le nom (seconde couche), le chemin réel (liens), puis « sous une racine permise ». Rend le chemin réel jugé. */
function jugerSortie(dossier, { realpath, lstat, env, tmpdir }) {
    const raison = refusDeDossier(dossier);
    if (raison) throw erreur('DOSSIER-REFUSE', raison);
    const reel = jugerCheminReel(dossier, realpath, lstat);
    const racines = racinesPermises({ env, realpath, tmpdir });
    if (!racines.some(r => sous(comparable(reel), r))) throw erreur('DOSSIER-REFUSE', 'hors des racines permises (le temporaire du système, ou la racine nommée par V2_EXPORT_RACINE)');
    return reel;
}

/**
 * N2 — l'export CRÉE LUI-MÊME son dossier de sortie : création exclusive, non récursive. Un dossier qui existe déjà (même vide), un parent absent ou toute autre erreur REFUSE :
 * l'export n'ajoute jamais un fichier dans un dossier existant du testeur, et n'écrit que dans ce qu'il vient de créer.
 */
function creerDossierNeuf(dossier, mkdir = fs.mkdirSync) {
    try { mkdir(dossier); }
    catch (e) { throw erreur('DOSSIER-REFUSE', e && e.code === 'EEXIST' ? 'le dossier de sortie existe déjà : un export crée un dossier neuf' : 'dossier de sortie non créable (le dossier parent doit exister)'); }
}

/**
 * @param {{dossier:string, colFn:(n:string)=>any, stockage:{lire:(cle:string)=>Promise<Buffer>}, base:string}} o
 * @returns {Promise<{lignes:number, photos:number, sansPhoto:number}>}
 */
async function exporterBancAdmin({ dossier, colFn, stockage, base, realpath = fs.realpathSync.native, lstat = fs.lstatSync, env = process.env, tmpdir = os.tmpdir, mkdir = fs.mkdirSync }) {
    if (typeof base !== 'string' || !base.trim() || base.trim().toLowerCase() === 'test') throw erreur('BASE-REFUSEE', 'base absente ou de production');
    // le dossier de sortie est jugé ICI, puis JUSTE AVANT chaque écriture (la course : un dossier vide au premier jugement qui devient un lien pendant l'export)
    const juge = () => jugerSortie(dossier, { realpath, lstat, env, tmpdir });
    if (typeof colFn !== 'function' || !stockage || typeof stockage.lire !== 'function') throw erreur('ENTREE', 'lecture de la base et du bucket requise');
    juge();
    creerDossierNeuf(dossier, mkdir);
    juge();
    const brutes = await colFn('banc_lignes').find({ source: 'etiquette-admin', etat: 'confirmee' }).sort({ _id: 1 }).toArray();
    const lues = new Map();        // clé -> true (écrite) | false (illisible)
    const lignes = [];
    let sansPhoto = 0;
    let exclues = 0;
    for (const l of brutes) {
        // MODELE-VISUEL-API (tour 2, M6) : une ligne qui porte le marqueur du vecteur de l'extension n'est jamais exportée (aucun écrivain actuel n'en pose : la règle est là pour le prochain)
        if (l.empreinteExtension) { exclues++; continue; }
        let photo = null;
        const cle = l.cleR2;
        if (typeof cle === 'string' && CLE_BANC.test(cle)) {
            const nom = path.basename(cle);
            if (!lues.has(nom)) {
                try { const b = await stockage.lire(cle); if (!Buffer.isBuffer(b) || !b.length) throw new Error('vide'); ecrireDans(dossier, `photos/${nom}`, b, juge); lues.set(nom, true); }
                catch (e) { if (e && (e.code === 'HORS-DOSSIER' || e.code === 'DOSSIER-REFUSE')) throw e; lues.set(nom, false); }
            }
            if (lues.get(nom)) photo = `photos/${nom}`;
        }
        if (!photo) sansPhoto++;
        const r = l.reponse && typeof l.reponse === 'object' ? l.reponse : {};
        lignes.push({
            id: String(l._id), photo, verite: Number.isSafeInteger(l.verite) ? l.verite : null, aucune: typeof l.aucune === 'string' ? l.aucune : null,
            statut: statutDe(r.statut), reponse: { statut: r.statut ?? null, idProduct: Number.isSafeInteger(r.idProduct) ? r.idProduct : null, candidats: Array.isArray(r.candidats) ? r.candidats.filter(Number.isSafeInteger) : [], questionCode: r.questionCode ?? null },
            versionModele: l.versionModele ?? null, versionChaine: l.versionChaine ?? null, rev: Number.isSafeInteger(l.rev) ? l.rev : null, anonyme: l.anonyme === true,
            sha256: typeof l.sha256 === 'string' && /^[0-9a-f]{64}$/.test(l.sha256) ? l.sha256 : null      // l'empreinte de la photo STOCKÉE (elle peut différer de celle que la chaîne a analysée)
        });
    }
    // I2 — des étiquettes que le banc n'a pas encore reflétées (panne, reprise à venir) : le NOMBRE est dit dans le manifeste, jamais tu. `null` : la base n'a pas répondu (inconnu, pas « zéro »).
    let enAttente = null;
    try { enAttente = await colFn('analyses').countDocuments({ bancAttente: true }); } catch { enAttente = null; }
    juge();
    fs.mkdirSync(path.join(dossier, 'photos'), { recursive: true });
    const photos = [...lues.values()].filter(Boolean).length;
    ecrireDans(dossier, 'lignes.json', JSON.stringify(lignes, null, 1), juge);
    ecrireDans(dossier, 'manifeste.json', JSON.stringify({ format: FORMAT, base, lignes: lignes.length, photos, sansPhoto, exclues, etiquettesEnAttente: enAttente, source: 'etiquette-admin', exporteLe: new Date().toISOString().slice(0, 10) }, null, 1), juge);
    return { lignes: lignes.length, photos, sansPhoto };
}

// ── la ligne de commande : écrite par ce qu'elle AUTORISE (deux arguments, chacun une fois ; tout le reste est refusé AVANT toute connexion)
const USAGE = 'usage : node v2/mesures/exporter-banc-admin.js --base=<base de lecture> --sortie=<dossier absolu>   (variables : MONGODB_ESSAI_LECTURE_URI, V2_BANC_BUCKET ; jamais la base `test`)';
function analyserArgs(argv) {
    if (!Array.isArray(argv)) return { erreur: 'arguments illisibles' };
    let base = null, sortie = null;
    for (const a of argv) {
        if (typeof a === 'string' && a.startsWith('--base=')) { if (base !== null) return { erreur: '--base donné deux fois' }; base = a.slice(7).trim(); }
        else if (typeof a === 'string' && a.startsWith('--sortie=')) { if (sortie !== null) return { erreur: '--sortie donné deux fois' }; sortie = a.slice(9); }
        else return { erreur: `argument non reconnu « ${String(a).slice(0, 30)} »` };
    }
    if (!base) return { erreur: 'aucune base précisée, et je ne devine pas' };
    if (base.toLowerCase() === 'test') return { erreur: 'la base `test` est la production : refusée' };
    if (!sortie) return { erreur: 'aucun dossier de sortie' };
    return { base, sortie };
}
/** M4 — le contrôle de la base porte sur ce que la base redoutée n'a PAS : la base nommée doit porter la collection `banc_lignes` (le nom de la base, lui, se lit sur la connexion et ne prouve rien). */
async function connecterLecture(env, base, { MongoClient = require('mongodb').MongoClient } = {}) {
    const client = new MongoClient(env.MONGODB_ESSAI_LECTURE_URI, { readPreference: 'secondaryPreferred', appName: 'export-banc-admin' });
    await client.connect();
    const d = client.db(base);
    let cols = [];
    try { cols = await d.listCollections({ name: 'banc_lignes' }, { nameOnly: true }).toArray(); }
    catch { try { await client.close(); } catch { /* rien */ } throw erreur('BASE-REFUSEE', 'la base ne répond pas à la liste de ses collections'); }
    if (!Array.isArray(cols) || !cols.length) { try { await client.close(); } catch { /* rien */ } throw erreur('BASE-REFUSEE', 'la base nommée ne porte pas de collection banc_lignes'); }
    return { colFn: n => d.collection(n), base, fermer: () => client.close() };
}
/** @returns {Promise<number>} 0 : exporté ; 1 : refusé ou impossible. Ne quitte jamais le processus. */
async function lancerCLI(argv, { env = process.env, connecter = connecterLecture, stockage = null, journal = l => console.log(l) } = {}) {
    const a = analyserArgs(argv);
    if (a.erreur) { console.error(`❌ ARRÊT : ${a.erreur}\n   ${USAGE}`); return 1; }
    const raison = refusDeDossier(a.sortie);
    if (raison) { console.error(`❌ ARRÊT : dossier refusé (${raison})`); return 1; }
    if (typeof env.MONGODB_ESSAI_LECTURE_URI !== 'string' || !env.MONGODB_ESSAI_LECTURE_URI) { console.error('❌ ARRÊT : MONGODB_ESSAI_LECTURE_URI absente (l\'URI de lecture est la seule admise)'); return 1; }
    if (!stockage && (typeof env.V2_BANC_BUCKET !== 'string' || !env.V2_BANC_BUCKET)) { console.error('❌ ARRÊT : V2_BANC_BUCKET absente'); return 1; }
    let c = null;
    try {
        c = await connecter(env, a.base);
        let st = stockage;
        if (!st) { const reel = require('../banc/stockage').creerStockageReel(env); st = { lire: k => reel.lire(k) }; }   // l'objet rendu n'expose que `lire`
        const b = await exporterBancAdmin({ dossier: a.sortie, colFn: c.colFn, stockage: st, base: a.base, env });
        journal(`export du banc de l'administrateur : ${b.lignes} ligne(s), ${b.photos} photo(s), ${b.sansPhoto} ligne(s) sans photo → ${a.sortie}`);
        return 0;
    } catch (e) { console.error(`❌ ARRÊT : ${(e && e.code) || (e && e.name) || 'erreur'}`); return 1; }
    finally { try { if (c && c.fermer) await c.fermer(); } catch { /* rien */ } }
}

module.exports = { exporterBancAdmin, ecrireDans, refusDeDossier, jugerCheminReel, connecterLecture, analyserArgs, lancerCLI, FORMAT };

if (require.main === module) {
    require('dotenv').config();
    lancerCLI(process.argv.slice(2)).then(code => process.exit(code));
}
