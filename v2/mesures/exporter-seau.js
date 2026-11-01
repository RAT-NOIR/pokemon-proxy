'use strict';
// BANC-200 — l'EXPORT REJOUABLE d'un seau, en LECTURE SEULE (la base et le bucket ne reçoivent aucune écriture) :
//   node v2/mesures/exporter-seau.js --base=<base de LECTURE> --seau=<id> --usage=mesure|entrainement --sortie=<dossier absolu neuf>
//   (variables : MONGODB_ESSAI_LECTURE_URI, V2_BANC_BUCKET ; jamais la base `test`.)
// Écrit, dans LE dossier donné et nulle part ailleurs (les règles de dossier sont celles de exporter-banc-admin.js : jamais sous un dossier d'apports, un Bureau, un lien ; le dossier est créé par l'export) :
//   manifeste.json  { format: 'banc-seau-v1', usage, seau, lignes, photos, exclusFuiteJuge, chaineOk, ... }
//   lignes.json     [{ rang, scanId, posteLe, scanCreeLe, empreinte, annonce, doublonDe, photos:[{index,fichier,sha256,octets,type}], mesures, analyse, verite }]
//   photos/<sha256>.<jpg|png|webp>   mesures/<sha256>.json     (les OCTETS d'origine, re-hachés à la lecture : un objet altéré arrête l'export)
// 🔑 LE JUGE NE SERT JAMAIS À L'ENTRAÎNEMENT. `usage` est OBLIGATOIRE et le TYPE du seau est lu EN BASE, jamais fourni par l'appelant : un export d'entraînement d'un juge (scellé ou non) lève JUGE_INTERDIT AVANT toute écriture.
// Et un export d'entraînement d'un autre seau EXCLUT tout scan dont une photo (sha256) ou l'annonce se retrouve dans le juge : la fuite par une re-photo ou une copie ne passe pas non plus.
// Un export de MESURE d'un juge exige qu'il soit SCELLÉ (on ne mesure pas un juge qui bouge). Dans tous les cas la chaîne d'empreintes est relue d'abord : rompue, rien n'est exporté.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const B = require('./exporter-banc-admin');
const { verifierChaineSeau, COLLECTIONS } = require('../banc/seau');

const FORMAT = 'banc-seau-v1';
const USAGES = Object.freeze(['mesure', 'entrainement']);
const erreur = (code, message) => Object.assign(new Error(message || code), { code });
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const extDe = cle => String(cle).slice(String(cle).lastIndexOf('.') + 1);

/**
 * @param {{seauId:string, usage:'mesure'|'entrainement', dossier:string, colFn:(n:string)=>any, stockage:{lire:(cle:string)=>Promise<Buffer>}, base:string, sansJuge?:string, journal?:(l:string)=>void}} o
 * @returns {Promise<{lignes:number, photos:number, exclusFuiteJuge:number, sansPhoto:number}>}
 * Le dossier temporaire du système n'est PLUS une racine permise par défaut : la racine est NOMMÉE (V2_EXPORT_RACINE) ; `V2_EXPORT_TEMP=1` rétablit l'ancien comportement (bancs, essais jetables).
 */
async function exporterSeau({ seauId, usage, dossier, colFn, stockage, base, sansJuge = null, journal = l => console.log(l), ancresDir = undefined, realpath = fs.realpathSync.native, lstat = fs.lstatSync, env = process.env, tmpdir = null, mkdir = fs.mkdirSync }) {
    if (!USAGES.includes(usage)) throw erreur('USAGE', 'usage absent ou inconnu : « mesure » ou « entrainement », sans valeur par défaut');
    if (typeof base !== 'string' || !base.trim() || base.trim().toLowerCase() === 'test') throw erreur('BASE-REFUSEE', 'base absente ou de production');
    if (typeof colFn !== 'function' || !stockage || typeof stockage.lire !== 'function') throw erreur('ENTREE', 'lecture de la base et du bucket requise');
    if (!tmpdir) tmpdir = env && env.V2_EXPORT_TEMP === '1' ? os.tmpdir : () => { throw erreur('TEMP_REFUSE', 'le dossier temporaire n\'est pas une racine permise'); };
    const seau = await colFn(COLLECTIONS.seaux).findOne({ _id: String(seauId) });
    if (!seau) throw erreur('SEAU_INCONNU', 'seau inconnu');
    // 🔑 la garde : le type vient de la BASE
    if (usage === 'entrainement' && seau.type === 'juge') throw erreur('JUGE_INTERDIT', 'le juge ne sert jamais à l\'entraînement');
    if (usage === 'mesure' && seau.type === 'juge' && seau.etat !== 'scelle') throw erreur('SEAU_OUVERT', 'un juge ne se mesure qu\'une fois scellé');
    // 🔑 un export d'ENTRAÎNEMENT sans juge ne peut pas exclure ce qui fuit du juge : il REFUSE, sauf une phrase de raison explicite (imprimée, gardée au manifeste). Une base muette refuse aussi.
    let juges;
    try { juges = await colFn(COLLECTIONS.seaux).find({ type: 'juge' }).toArray(); } catch { throw erreur('JUGE_ILLISIBLE', 'l\'état du juge ne se lit pas'); }
    if (usage === 'entrainement' && !juges.length) {
        if (typeof sansJuge !== 'string' || sansJuge.trim().length < 20) throw erreur('JUGE_ABSENT', 'aucun juge n\'existe : l\'export d\'entraînement ne peut pas exclure sa fuite (option --sans-juge="<raison de 20 caractères au moins>")');
        journal(`⚠️ export d'entraînement SANS JUGE, sur la raison : ${sansJuge.trim()}`);
    }
    const ancre = id => require('../banc/ancre').lireAncre(id, ancresDir);
    const chaine = await verifierChaineSeau(colFn, seau._id, { ancre });
    // 🔑 la mesure d'un JUGE exige son ANCRE (tête de la chaîne principale ET de celle des errata, versionnée hors de la base) : sans elle, rien ne prouve que la chaîne n'a pas été refaite
    if (usage === 'mesure' && seau.type === 'juge' && chaine.ancre !== 'ok' && chaine.problemes.every(p => ['non-ancre', 'ancre-errata'].includes(p.cause))) throw erreur('NON_ANCRE', `le juge n'est pas (ou plus) ancré : ${chaine.ancre} — node v2/mesures/ancrer-seau.js, puis committer l'ancre`);
    if (!chaine.ok) throw erreur('CHAINE_ROMPUE', `la chaîne d'empreintes est rompue (${chaine.problemes.length} problème(s))`);

    const juge = () => B.jugerSortie(dossier, { realpath, lstat, env, tmpdir });
    juge(); B.creerDossierNeuf(dossier, mkdir); juge();

    const lignes = await colFn(COLLECTIONS.scans).find({ seauId: seau._id }).sort({ rang: 1 }).toArray();
    const photosDocs = await colFn(COLLECTIONS.photos).find({ seauId: seau._id }).sort({ scanId: 1, index: 1 }).toArray();
    const verites = await colFn(COLLECTIONS.verites).find({ seauId: seau._id }).toArray();
    const errata = await colFn(COLLECTIONS.errata).find({ seauId: seau._id }).sort({ n: 1 }).toArray();
    const mesuresDocs = await colFn(COLLECTIONS.mesures).find({ seauId: seau._id }).toArray();
    const parScan = (liste, f = x => x.scanId) => { const m = new Map(); for (const x of liste) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
    const photosDe = parScan(photosDocs), veritesDe = parScan(verites), errataDe = parScan(errata), mesuresDe = new Map(mesuresDocs.map(m => [m.scanId, m]));

    // la fuite du juge, pour un export d'entraînement : les sha256, les annonces ET les dHash (à ≤ 8 bits : la re-photo d'une carte du juge) de ses photos
    const dh = require('../banc/dhash');
    const dhashDe = async p => { if (typeof p.dhash === 'string' && dh.FORME.test(p.dhash)) return p.dhash; return dh.dhash(await stockage.lire(p.cle)); };       // sans dHash noté : recalculé depuis l'objet (ou l'export lève)
    let shaJuge = new Set(), annoncesJuge = new Set(), dhashJuge = [];
    if (usage === 'entrainement' && juges.length) {
        const ids = juges.map(s => s._id);
        const pj = await colFn(COLLECTIONS.photos).find({ seauId: { $in: ids } }).toArray();
        shaJuge = new Set(pj.map(p => p.sha256));
        for (const p of pj) dhashJuge.push(await dhashDe(p));
        annoncesJuge = new Set((await colFn(COLLECTIONS.scans).find({ seauId: { $in: ids }, annonce: { $type: 'string' } }, { projection: { annonce: 1 } }).toArray()).map(l => l.annonce));
    }
    const oidDe = id => new (require('mongoose').Types.ObjectId)(String(id));
    const lus = new Map();       // chemin relatif -> true (écrit)
    const sortie = [];
    let sansPhoto = 0;
    const exclusParCause = { sha256: 0, annonce: 0, dhash: 0 };
    const ecrire = async (cle, sha, relatif) => {
        if (lus.has(relatif)) return;
        const b = await stockage.lire(cle);
        if (!Buffer.isBuffer(b) || sha256(b) !== sha) throw erreur('OBJET_ALTERE', 'un objet du bucket ne correspond plus à son sha256');
        B.ecrireDans(dossier, relatif, b, juge); lus.set(relatif, true);
    };
    for (const l of lignes) {
        const ph = photosDe.get(l.scanId) || [];
        // une ligne SANS photo (l'objet n'a pas pu s'écrire) : marquée, jamais exportée
        if (!ph.length) { sansPhoto++; continue; }
        if (usage === 'entrainement') {
            let cause = null;
            if (l.fuiteJuge || (l.annonce && annoncesJuge.has(l.annonce))) cause = 'annonce';
            else if (ph.some(p => shaJuge.has(p.sha256))) cause = 'sha256';
            else if (dhashJuge.length) { for (const p of ph) { const d = await dhashDe(p); if (dhashJuge.some(j => dh.distance(d, j) <= dh.SEUIL_RE_PHOTO)) { cause = 'dhash'; break; } } }
            if (cause) { exclusParCause[cause]++; continue; }
        }
        const photos = [];
        for (const p of ph) {
            const fichier = `photos/${p.sha256}.${extDe(p.cle)}`;
            await ecrire(p.cle, p.sha256, fichier);
            photos.push({ index: p.index, fichier, sha256: p.sha256, octets: p.octets, type: p.type });
        }
        const m = mesuresDe.get(l.scanId);
        let mesures = null;
        if (m) { const fichier = `mesures/${m.sha256}.json`; await ecrire(m.cle, m.sha256, fichier); mesures = { fichier, sha256: m.sha256, octets: m.octets }; }
        const an = await colFn('analyses').findOne({ _id: oidDe(l.scanId) }, { projection: { cartes: 1, produits: 1, statut: 1, versionChaine: 1, versionModele: 1, empreinteExtension: 1, complementMesures: 1, secondeLecture: 1, lectureTampon: 1, creeLe: 1 } });
        const vs = (veritesDe.get(l.scanId) || []).sort((a, b) => a.carte - b.carte);
        const er = errataDe.get(l.scanId) || [];
        const verite = vs.length ? (vs.length === 1 && vs[0].carte === 0 ? veriteDe(vs[0], er.filter(e => e.carte === 0)) : { cartes: vs.map(v => ({ carte: v.carte, ...veriteDe(v, er.filter(e => e.carte === v.carte)) })) }) : null;
        sortie.push({ rang: l.rang, scanId: l.scanId, posteLe: l.posteLe, scanCreeLe: l.scanCreeLe, empreinte: l.empreinte, annonce: l.annonce ?? null, doublonDe: l.doublonDe ?? null,
            photos, mesures, analyse: an ? { statut: an.statut ?? null, cartes: an.cartes ?? [], produits: (an.produits || []).map(p => p && p.idProduct).filter(Number.isSafeInteger), versionChaine: an.versionChaine ?? null, versionModele: an.versionModele ?? null,
                empreinteExtension: an.empreinteExtension ?? null, complementMesures: an.complementMesures ?? null, creeLe: an.creeLe ?? null } : null,
            verite });
    }
    juge();
    fs.mkdirSync(path.join(dossier, 'photos'), { recursive: true });
    const nPhotos = [...lus.keys()].filter(k => k.startsWith('photos/')).length;
    const exclus = exclusParCause.sha256 + exclusParCause.annonce + exclusParCause.dhash;
    B.ecrireDans(dossier, 'lignes.json', JSON.stringify(sortie, null, 1), juge);
    B.ecrireDans(dossier, 'manifeste.json', JSON.stringify({
        format: FORMAT, usage, base, lignes: sortie.length, photos: nPhotos, sansPhoto, exclusFuiteJuge: exclus, exclusParCause, errata: errata.length, chaineOk: true, tete: chaine.tete, ancre: chaine.ancre,
        sansJuge: usage === 'entrainement' && !juges.length ? sansJuge.trim() : null,
        seau: { id: seau._id, nom: seau.nom, type: seau.type, cible: seau.cible, etat: seau.etat, note: seau.note ?? null, declareLe: seau.declareLe, empreinte: seau.empreinte, scelleLe: seau.scelleLe ?? null, empreinteScellee: seau.empreinteScellee ?? null },
        exporteLe: new Date().toISOString().slice(0, 10)
    }, null, 1), juge);
    return { lignes: sortie.length, photos: nPhotos, exclusFuiteJuge: exclus, sansPhoto };
}
// la vérité EFFECTIVE : la valeur du dernier erratum s'il y en a (la vérité d'origine, intacte en base, est rendue sous `origine`), sinon la saisie
const veriteDe = (v, errata = []) => {
    const base = { idProduct: v.idProduct ?? null, aucune: v.aucune ?? null, via: v.via, candidatsVus: v.candidatsVus === true, aveugle: v.candidatsVus !== true, rev: v.rev, saisieLe: v.saisieLe, corrections: Array.isArray(v.historique) ? v.historique.length : 0 };
    if (!errata.length) return { ...base, errata: [] };
    const dernier = errata[errata.length - 1];
    return { ...base, idProduct: dernier.nouveau.idProduct ?? null, aucune: dernier.nouveau.aucune ?? null, origine: { idProduct: v.idProduct ?? null, aucune: v.aucune ?? null },
        errata: errata.map(e => ({ n: e.n, ancien: e.ancien, nouveau: e.nouveau, motif: e.motif, le: e.le, via: e.via, candidatsVus: e.candidatsVus === true })) };
};

// ── la ligne de commande : écrite par ce qu'elle AUTORISE (quatre arguments, chacun une fois ; tout le reste est refusé AVANT toute connexion)
const USAGE_CLI = 'usage : node v2/mesures/exporter-seau.js --base=<base de lecture> --seau=<id> --usage=mesure|entrainement --sortie=<dossier absolu> [--sans-juge="<raison>"]   (variables : V2_EXPORT_RACINE (la racine d\'export, requise), MONGODB_ESSAI_LECTURE_URI, V2_BANC_BUCKET ; jamais la base `test`)';
function analyserArgs(argv) {
    if (!Array.isArray(argv)) return { erreur: 'arguments illisibles' };
    const v = { base: null, seau: null, usage: null, sortie: null, 'sans-juge': null };
    for (const a of argv) {
        const m = typeof a === 'string' && /^--(base|seau|usage|sortie|sans-juge)=(.*)$/s.exec(a);
        if (!m) return { erreur: `argument non reconnu « ${String(a).slice(0, 30)} »` };
        if (v[m[1]] !== null) return { erreur: `--${m[1]} donné deux fois` };
        v[m[1]] = m[1] === 'sortie' || m[1] === 'sans-juge' ? m[2] : m[2].trim();
    }
    if (!v.base) return { erreur: 'aucune base précisée, et je ne devine pas' };
    if (v.base.toLowerCase() === 'test') return { erreur: 'la base `test` est la production : refusée' };
    if (!v.seau) return { erreur: 'aucun seau' };
    if (!USAGES.includes(v.usage)) return { erreur: 'usage absent ou inconnu (mesure | entrainement)' };
    if (!v.sortie) return { erreur: 'aucun dossier de sortie' };
    return v;
}
async function lancerCLI(argv, { env = process.env, connecter = B.connecterLecture, stockage = null, journal = l => console.log(l) } = {}) {
    const a = analyserArgs(argv);
    if (a.erreur) { console.error(`❌ ARRÊT : ${a.erreur}\n   ${USAGE_CLI}`); return 1; }
    const raison = B.refusDeDossier(a.sortie);
    if (raison) { console.error(`❌ ARRÊT : dossier refusé (${raison})`); return 1; }
    if (typeof env.MONGODB_ESSAI_LECTURE_URI !== 'string' || !env.MONGODB_ESSAI_LECTURE_URI) { console.error('❌ ARRÊT : MONGODB_ESSAI_LECTURE_URI absente (l\'URI de lecture est la seule admise)'); return 1; }
    if (!stockage && (typeof env.V2_BANC_BUCKET !== 'string' || !env.V2_BANC_BUCKET)) { console.error('❌ ARRÊT : V2_BANC_BUCKET absente'); return 1; }
    let c = null;
    try {
        c = await connecter(env, a.base);
        let st = stockage;
        if (!st) { const reel = require('../banc/stockage').creerStockageSeauReel(env); st = { lire: k => reel.lire(k) }; }       // l'objet rendu n'expose que `lire`
        const r = await exporterSeau({ seauId: a.seau, usage: a.usage, dossier: a.sortie, colFn: c.colFn, stockage: st, base: a.base, env, sansJuge: a['sans-juge'], journal });
        journal(`export du seau ${a.seau} (${a.usage}) : ${r.lignes} ligne(s), ${r.photos} photo(s), ${r.exclusFuiteJuge} exclue(s) pour fuite du juge → ${a.sortie}`);
        return 0;
    } catch (e) { console.error(`❌ ARRÊT : ${(e && e.code) || (e && e.name) || 'erreur'}`); return 1; }
    finally { try { if (c && c.fermer) await c.fermer(); } catch { /* rien */ } }
}

module.exports = { exporterSeau, analyserArgs, lancerCLI, FORMAT, USAGES };

if (require.main === module) {
    require('dotenv').config();
    lancerCLI(process.argv.slice(2)).then(code => process.exit(code));
}
