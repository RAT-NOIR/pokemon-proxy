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
//   · le dossier : absolu, ni la racine d'un disque, ni DANS un dossier d'apports (Logo FR, apport-manuel, LOGO, Logo JP, Logo ZH) ou de photos du verrou ; vide ou déjà un export de ce format ;
//   · chaque écriture passe par `ecrireDans`, qui résout le chemin et le refuse s'il sort du dossier ; un nom de photo ne vient que d'une clé de la forme du banc (jamais d'un texte libre) ;
//   · la base et le bucket ne reçoivent AUCUNE écriture : cet outil n'appelle que find et lire.
// Aucune valeur de variable, d'URI ni de clé n'est jamais journalisée.
const fs = require('fs');
const path = require('path');

const FORMAT = 'banc-admin-v1';
const CLE_BANC = /^banc-reel\/v2\/[0-9a-f]{32}\.webp$/;
const APPORTS = Object.freeze(['logo fr', 'logo jp', 'logo zh', 'logo', 'apport-manuel', 'apports-manuels']);   // segments de chemin (casse ignorée) : des dossiers que le testeur remplit lui-même
const erreur = (code, message) => Object.assign(new Error(message || code), { code });

/** Le dossier est-il admis ? Pure. @returns {string|null} la raison du refus, ou null. */
function refusDeDossier(dossier) {
    if (typeof dossier !== 'string' || !dossier.trim()) return 'dossier absent';
    if (!path.isAbsolute(dossier) && !/^[A-Za-z]:[\\/]/.test(dossier)) return 'dossier non absolu';
    const norm = dossier.replace(/\//g, '\\').replace(/\\+$/, '');
    const segments = norm.split('\\').filter(Boolean).map(s => s.toLowerCase());
    if (segments.length < 2) return 'racine d\'un disque';
    if (segments.some(s => APPORTS.includes(s))) return 'dossier d\'apports manuels';
    for (let i = 0; i < segments.length - 1; i++) if (segments[i] === 'verrou' && segments[i + 1] === 'photos') return 'dossier de photos du verrou';
    return null;
}

/** Écrit `contenu` à `relatif` DANS `racine`, ou lève HORS-DOSSIER. Le seul point d'écriture de l'outil. */
function ecrireDans(racine, relatif, contenu) {
    if (typeof relatif !== 'string' || !relatif || path.isAbsolute(relatif) || /^[A-Za-z]:/.test(relatif)) throw erreur('HORS-DOSSIER');
    const base = path.resolve(racine), cible = path.resolve(base, relatif);
    const rel = path.relative(base, cible);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw erreur('HORS-DOSSIER');
    fs.mkdirSync(path.dirname(cible), { recursive: true });
    fs.writeFileSync(cible, contenu);
    return cible;
}

const statutDe = s => ({ identifiee: 'affirmee', 'a-trancher': 'question', introuvable: 'introuvable' })[s] || 'autre';

/** Un dossier déjà rempli n'est admis que s'il est un export de ce format (le manifeste le dit) ; vide ou inexistant : admis. */
function verifierDossierLibre(dossier) {
    if (!fs.existsSync(dossier)) return;
    if (!fs.statSync(dossier).isDirectory()) throw erreur('DOSSIER-REFUSE', 'ce n\'est pas un dossier');
    const contenu = fs.readdirSync(dossier);
    if (!contenu.length) return;
    let ok = false;
    try { ok = JSON.parse(fs.readFileSync(path.join(dossier, 'manifeste.json'), 'utf8')).format === FORMAT; } catch { ok = false; }
    if (!ok) throw erreur('DOSSIER-REFUSE', 'dossier non vide qui n\'est pas un export précédent');
}

/**
 * @param {{dossier:string, colFn:(n:string)=>any, stockage:{lire:(cle:string)=>Promise<Buffer>}, base:string}} o
 * @returns {Promise<{lignes:number, photos:number, sansPhoto:number}>}
 */
async function exporterBancAdmin({ dossier, colFn, stockage, base }) {
    if (typeof base !== 'string' || !base.trim() || base.trim().toLowerCase() === 'test') throw erreur('BASE-REFUSEE', 'base absente ou de production');
    const raison = refusDeDossier(dossier);
    if (raison) throw erreur('DOSSIER-REFUSE', raison);
    verifierDossierLibre(dossier);
    if (typeof colFn !== 'function' || !stockage || typeof stockage.lire !== 'function') throw erreur('ENTREE', 'lecture de la base et du bucket requise');
    const brutes = await colFn('banc_lignes').find({ source: 'etiquette-admin', etat: 'confirmee' }).sort({ _id: 1 }).toArray();
    const lues = new Map();        // clé -> true (écrite) | false (illisible)
    const lignes = [];
    let sansPhoto = 0;
    for (const l of brutes) {
        let photo = null;
        const cle = l.cleR2;
        if (typeof cle === 'string' && CLE_BANC.test(cle)) {
            const nom = path.basename(cle);
            if (!lues.has(nom)) {
                try { const b = await stockage.lire(cle); if (!Buffer.isBuffer(b) || !b.length) throw new Error('vide'); ecrireDans(dossier, `photos/${nom}`, b); lues.set(nom, true); }
                catch (e) { if (e && e.code === 'HORS-DOSSIER') throw e; lues.set(nom, false); }
            }
            if (lues.get(nom)) photo = `photos/${nom}`;
        }
        if (!photo) sansPhoto++;
        const r = l.reponse && typeof l.reponse === 'object' ? l.reponse : {};
        lignes.push({
            id: String(l._id), photo, verite: Number.isSafeInteger(l.verite) ? l.verite : null, aucune: typeof l.aucune === 'string' ? l.aucune : null,
            statut: statutDe(r.statut), reponse: { statut: r.statut ?? null, idProduct: Number.isSafeInteger(r.idProduct) ? r.idProduct : null, candidats: Array.isArray(r.candidats) ? r.candidats.filter(Number.isSafeInteger) : [], questionCode: r.questionCode ?? null },
            versionModele: l.versionModele ?? null, versionChaine: l.versionChaine ?? null, rev: Number.isSafeInteger(l.rev) ? l.rev : null, anonyme: l.anonyme === true
        });
    }
    fs.mkdirSync(path.join(dossier, 'photos'), { recursive: true });
    const photos = [...lues.values()].filter(Boolean).length;
    ecrireDans(dossier, 'lignes.json', JSON.stringify(lignes, null, 1));
    ecrireDans(dossier, 'manifeste.json', JSON.stringify({ format: FORMAT, base, lignes: lignes.length, photos, sansPhoto, source: 'etiquette-admin', exporteLe: new Date().toISOString().slice(0, 10) }, null, 1));
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
async function connecterLecture(env, base) {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(env.MONGODB_ESSAI_LECTURE_URI, { readPreference: 'secondaryPreferred', appName: 'export-banc-admin' });
    await client.connect();
    const d = client.db(base);
    if (d.databaseName !== base) throw erreur('BASE-REFUSEE', 'la connexion ne désigne pas la base demandée');
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
        const b = await exporterBancAdmin({ dossier: a.sortie, colFn: c.colFn, stockage: st, base: a.base });
        journal(`export du banc de l'administrateur : ${b.lignes} ligne(s), ${b.photos} photo(s), ${b.sansPhoto} ligne(s) sans photo → ${a.sortie}`);
        return 0;
    } catch (e) { console.error(`❌ ARRÊT : ${(e && e.code) || (e && e.name) || 'erreur'}`); return 1; }
    finally { try { if (c && c.fermer) await c.fermer(); } catch { /* rien */ } }
}

module.exports = { exporterBancAdmin, ecrireDans, refusDeDossier, analyserArgs, lancerCLI, FORMAT };

if (require.main === module) {
    require('dotenv').config();
    lancerCLI(process.argv.slice(2)).then(code => process.exit(code));
}
