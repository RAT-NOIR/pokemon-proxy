'use strict';
// COTES-VISUELS, tour 1 — le FORMAT du fichier compact : UN module pour les deux voies (le calcul dans l'API ; le fichier précalculé hors de l'API, déposé puis chargé).
//   RMV1 | longueur de l'en-tête (u32) | en-tête JSON (format, date, comptes, sets→fiches, préfixe des liens, dénominateurs d'entrée, liste des sections) | colonnes alignées sur 4 octets | sha256 (32 o)
// Écrit par ce qu'il AUTORISE : un fichier n'est lu que si sa magie, son numéro de format, sa taille, son hachage ET sa STRUCTURE (colonnes de même longueur, identifiants strictement
// croissants, indices de chaînes dans la réserve, fins de fiches dans les produits, comptes de l'en-tête = comptes des colonnes) sont conformes. Un hachage refait sur un contenu incohérent
// (un fichier MENTEUR) est refusé par la structure. Tout refus est un FormatInvalide nommé ; rien d'autre ne s'échappe. Little-endian seulement (refus ailleurs).
const crypto = require('crypto'); const zlib = require('zlib'); const os = require('os');
const { depuisPaquet } = require('./version');

const MAGIE = Buffer.from('RMV1'), FORMAT = 1, FORMAT_MARQUES = 2;
const SECTIONS_BASE = Object.freeze([
    ...['id', 'vig', 'vw', 'vh', 'gra', 'gw', 'gh', 'men', 'meta', 'num', 'rar', 'tot', 'variante', 'set', 'lien'].map(n => ({ nom: n, t: 'i32' })),
    { nom: 'meta.cle', t: 'i32' }, { nom: 'meta.produit', t: 'i32' },
    ...['carte', 'num', 'debut', 'fin', 'produits'].map(n => ({ nom: `fiches.${n}`, t: 'i32' })),
    { nom: 'texte.off', t: 'u32' }, { nom: 'texte.octets', t: 'u8' }, { nom: 'liens.off', t: 'u32' }, { nom: 'liens.octets', t: 'u8' }
]);
// JUMEAU-V2 : la colonne des jumeaux est une extension FACULTATIVE (mêmes numéro de format et magie) : un fichier d'avant la colonne (SECTIONS_BASE seules) reste lisible, SANS la colonne ;
// toute autre liste de sections est refusée (voir LISTES plus bas). La liste complète est la base + la colonne, dans CET ordre.
const SECTIONS_JUM = Object.freeze(['meta', 'id', 'exp', 'num', 'tir', 'ordre'].map(n => ({ nom: `jum.${n}`, t: 'i32' })));
const SECTIONS = Object.freeze([...SECTIONS_BASE, ...SECTIONS_JUM]);
// REPLI-REIMPRESSIONS : la colonne des MARQUAGES est le FORMAT 2 (le numéro de format ne ment pas : un lecteur d'avant refuse ce fichier au lieu d'ignorer des marquages qu'il ne connaît pas).
// Les listes de sections permises sont énumérées, jamais déduites : format 1 = BASE ou BASE+JUM (les archives publiées jusqu'au 2026-10-17) ; format 2 = BASE+MAR ou BASE+JUM+MAR.
const SECTIONS_MAR = Object.freeze(['flags', 'tampon', 'pdeb', 'pfin', 'produits'].map(n => ({ nom: `mar.${n}`, t: 'i32' })));
// LOT TAMPONS (B) : la colonne des PRIX MÉLANGÉS (`mel.produits`, la liste triée des idProduct marqués) est facultative et ne vient qu'avec les marquages (format 2) ; une archive d'avant en reste lisible.
const SECTIONS_MEL = Object.freeze([{ nom: 'mel.produits', t: 'i32' }]);
const LISTES = Object.freeze([
    { format: 1, sections: SECTIONS_BASE, jum: false, mar: false, mel: false },
    { format: 1, sections: SECTIONS, jum: true, mar: false, mel: false },
    { format: 2, sections: Object.freeze([...SECTIONS_BASE, ...SECTIONS_MAR]), jum: false, mar: true, mel: false },
    { format: 2, sections: Object.freeze([...SECTIONS, ...SECTIONS_MAR]), jum: true, mar: true, mel: false },
    { format: 2, sections: Object.freeze([...SECTIONS_BASE, ...SECTIONS_MAR, ...SECTIONS_MEL]), jum: false, mar: true, mel: true },
    { format: 2, sections: Object.freeze([...SECTIONS, ...SECTIONS_MAR, ...SECTIONS_MEL]), jum: true, mar: true, mel: true }
]);
const TAILLE = { i32: 4, u32: 4, u8: 1 }, CLASSE = { i32: Int32Array, u32: Uint32Array, u8: Uint8Array };
// PLAFONDS, écrits par ce qu'ils protègent : la mémoire de l'instance (512 Mio dont ~110 à 150 Mo de base de serveur, offre gratuite, ~11 réveils par jour sans version en mémoire : un dépassement
// serait un redémarrage en boucle). L'archive réelle fait 2,8 Mo compressée et 11 Mo décompressée : 16 Mo (×5,7) et 48 Mo (×4,4). Dépassement = échec de chargement, jamais un redémarrage.
const ARCHIVE_MAX = 16 * 1048576, PLAT_MAX = 48 * 1048576, PLAFONDS = Object.freeze({ archive: ARCHIVE_MAX, decompresse: PLAT_MAX });
const ENTETE_MAX = 4 * 1048576, FICHIER_MAX = PLAT_MAX;

class FormatInvalide extends Error { constructor(motif) { super(motif); this.name = 'FormatInvalide'; this.motif = motif; } }
const refuser = m => { throw new FormatInvalide(m); };
const aligner = n => (n + 3) & ~3;
const hache = b => crypto.createHash('sha256').update(b).digest();

function cible(d, nom) { const [a, b] = nom.split('.'); return b === undefined ? d.cols[a] : d[a][b]; }
function sceller(corps) { return Buffer.concat([corps, hache(corps)]); }

function assemblerFichier(entete, regions) {
    const json = Buffer.from(JSON.stringify(entete), 'utf8');
    const t = Buffer.alloc(8); MAGIE.copy(t, 0); t.writeUInt32LE(json.length, 4);
    const tete = Buffer.concat([t, json]); const pad = Buffer.alloc(aligner(tete.length) - tete.length);
    return sceller(Buffer.concat([tete, pad, regions]));
}
/** @param entree { sets, cartes, produits, catalogue } les dénominateurs de la lecture (informatifs, rendus par lireEntete) */
function serialiser(version, { entree = null } = {}) {
    if (os.endianness() !== 'LE') refuser('plate-forme big-endian non prise en charge');
    const { donnees } = version.paquet();
    const regions = [], descr = [];
    const liste = LISTES.find(l => l.jum === Boolean(donnees.jum) && l.mar === Boolean(donnees.mar) && l.mel === Boolean(donnees.mel));
    for (const s of liste.sections) {
        const a = cible(donnees, s.nom), oct = Buffer.from(a.buffer, a.byteOffset, a.byteLength);
        descr.push({ nom: s.nom, t: s.t, n: a.length }); regions.push(oct); const pad = aligner(oct.length) - oct.length; if (pad) regions.push(Buffer.alloc(pad));
    }
    const entete = { format: liste.format, chargeLe: donnees.chargeLe.toISOString(), comptes: donnees.comptes, sets: donnees.fiches.sets, prefixe: donnees.liens.prefixe, entree, sections: descr };
    return assemblerFichier(entete, Buffer.concat(regions));
}

function ouvrirEntete(buf) {
    if (!Buffer.isBuffer(buf)) refuser('ce n\'est pas un tampon');
    if (buf.length < 8 + 2 + 32 || buf.length > FICHIER_MAX) refuser('taille de fichier hors bornes');
    if (!buf.subarray(0, 4).equals(MAGIE)) refuser('magie fausse');
    const len = buf.readUInt32LE(4);
    if (len < 2 || len > ENTETE_MAX || 8 + len > buf.length - 32) refuser('longueur d\'en-tête hors bornes');
    let e; try { e = JSON.parse(buf.subarray(8, 8 + len).toString('utf8')); } catch { refuser('en-tête illisible'); }
    if (!e || typeof e !== 'object' || Array.isArray(e)) refuser('en-tête illisible');
    return { entete: e, debut: aligner(8 + len) };
}
function lireEntete(buf) { return ouvrirEntete(buf).entete; }
/** Pour les bancs : le même fichier avec un en-tête différent (les régions de colonnes restent celles du fichier d'origine), rescellé. */
function reecrireEntete(buf, entete) { const o = ouvrirEntete(buf); return assemblerFichier(entete, buf.subarray(o.debut, buf.length - 32)); }
/** Les sections et leur position absolue dans le fichier (d'après l'en-tête). */
function sections(buf) {
    const { entete, debut } = ouvrirEntete(buf); let o = debut; const out = [];
    for (const s of entete.sections) { out.push({ nom: s.nom, debut: o, n: s.n }); o += aligner(s.n * (TAILLE[s.t] || 1)); }
    return out;
}

function deserialiser(buf) {
    if (os.endianness() !== 'LE') refuser('plate-forme big-endian non prise en charge');
    const { entete, debut } = ouvrirEntete(buf);
    if (!hache(buf.subarray(0, buf.length - 32)).equals(buf.subarray(buf.length - 32))) refuser('hachage faux : fichier abîmé ou tronqué');
    if (entete.format !== FORMAT && entete.format !== FORMAT_MARQUES) refuser(`numéro de format inconnu (${String(entete.format).slice(0, 10)})`);
    // le numéro de format DIT quelles sections suivent (1 : sans marquages, 2 : avec) ; une liste qui n'est pas l'une des quatre énumérées est refusée
    const candidates = LISTES.filter(l => l.format === entete.format);
    if (!Array.isArray(entete.sections)) refuser('liste de sections incomplète');
    const liste = candidates.find(l => l.sections.length === entete.sections.length && l.sections.every((s, i) => entete.sections[i] && entete.sections[i].nom === s.nom));
    if (!liste) refuser('liste de sections incomplète');
    const attendues = liste.sections;       // sans la colonne des jumeaux : un fichier d'avant elle ; sans celle des marquages : un fichier du format 1
    let o = debut; const d = { cols: {}, texte: {}, liens: {}, meta: {}, fiches: {}, ...(liste.jum ? { jum: {} } : {}), ...(liste.mar ? { mar: {} } : {}), ...(liste.mel ? { mel: {} } : {}) };
    attendues.forEach((s, i) => {
        const x = entete.sections[i];
        if (!x || x.nom !== s.nom || x.t !== s.t || !Number.isInteger(x.n) || x.n < 0) refuser(`section « ${s.nom} » absente ou mal décrite`);
        const octets = x.n * TAILLE[s.t];
        if (o + octets > buf.length - 32) refuser(`section « ${s.nom} » plus longue que le fichier`);
        const copie = buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + octets);           // COPIE alignée : le tampon du fichier est libéré ensuite
        const a = new CLASSE[s.t](copie);
        const [p, q] = s.nom.split('.');
        if (q === undefined) d.cols[p] = a; else if (p === 'meta') d.meta[q] = a; else if (p === 'fiches') d.fiches[q] = a; else if (p === 'jum') d.jum[q] = a; else if (p === 'mar') d.mar[q] = a; else if (p === 'mel') d.mel[q] = a; else d[p][q === 'off' ? 'off' : 'octets'] = a;
        o += aligner(octets);
    });
    if (o !== buf.length - 32) refuser('octets en trop entre la dernière section et le hachage');
    // ── la STRUCTURE (un fichier menteur a un hachage juste) : UNE définition, celle de version.js, aussi pour la voie « fil »
    const quand = new Date(entete.chargeLe); if (Number.isNaN(quand.getTime())) refuser('date illisible');
    const c = entete.comptes;
    if (!c || typeof c !== 'object' || Array.isArray(c)) refuser('comptes de l\'en-tête illisibles');
    try { return depuisPaquet({ ...d, comptes: Object.freeze({ ...c }), chargeLe: quand, liens: { ...d.liens, prefixe: entete.prefixe }, fiches: { ...d.fiches, sets: entete.sets } }); }
    catch (e) { if (e && e.name === 'StructureInvalide') refuser(e.motif); throw e; }
}

const gzip = b => new Promise((ok, ko) => zlib.gzip(b, { level: 9 }, (e, r) => (e ? ko(e) : ok(r))));
async function compresser(buf) { return gzip(buf); }
async function decompresser(buf, { max = PLAT_MAX, maxArchive = ARCHIVE_MAX } = {}) {
    if (!Buffer.isBuffer(buf)) throw new FormatInvalide('ce n\'est pas un tampon');
    if (buf.length > maxArchive) throw new FormatInvalide(`archive plus grande que la taille permise (${Math.round(maxArchive / 1048576)} Mo compressée)`);     // AVANT d'ouvrir
    return new Promise((ok, ko) => zlib.gunzip(buf, { maxOutputLength: max }, (e, r) => (e ? ko(new FormatInvalide(e.code === 'ERR_BUFFER_TOO_LARGE' ? 'archive plus grande que la taille permise' : 'archive gzip illisible')) : ok(r))));
}

module.exports = { serialiser, deserialiser, lireEntete, reecrireEntete, sections, sceller, compresser, decompresser, FormatInvalide, FORMAT, FORMAT_MARQUES, SECTIONS, PLAFONDS };
