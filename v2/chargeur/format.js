'use strict';
// COTES-VISUELS, tour 1 — le FORMAT du fichier compact : UN module pour les deux voies (le calcul dans l'API ; le fichier précalculé hors de l'API, déposé puis chargé).
//   RMV1 | longueur de l'en-tête (u32) | en-tête JSON (format, date, comptes, sets→fiches, préfixe des liens, dénominateurs d'entrée, liste des sections) | colonnes alignées sur 4 octets | sha256 (32 o)
// Écrit par ce qu'il AUTORISE : un fichier n'est lu que si sa magie, son numéro de format, sa taille, son hachage ET sa STRUCTURE (colonnes de même longueur, identifiants strictement
// croissants, indices de chaînes dans la réserve, fins de fiches dans les produits, comptes de l'en-tête = comptes des colonnes) sont conformes. Un hachage refait sur un contenu incohérent
// (un fichier MENTEUR) est refusé par la structure. Tout refus est un FormatInvalide nommé ; rien d'autre ne s'échappe. Little-endian seulement (refus ailleurs).
const crypto = require('crypto'); const zlib = require('zlib'); const os = require('os');
const { depuisPaquet } = require('./version');

const MAGIE = Buffer.from('RMV1'), FORMAT = 1;
const SECTIONS = Object.freeze([
    ...['id', 'vig', 'vw', 'vh', 'gra', 'gw', 'gh', 'men', 'meta', 'num', 'rar', 'tot', 'variante', 'set', 'lien'].map(n => ({ nom: n, t: 'i32' })),
    { nom: 'meta.cle', t: 'i32' }, { nom: 'meta.produit', t: 'i32' },
    ...['carte', 'num', 'debut', 'fin', 'produits'].map(n => ({ nom: `fiches.${n}`, t: 'i32' })),
    { nom: 'texte.off', t: 'u32' }, { nom: 'texte.octets', t: 'u8' }, { nom: 'liens.off', t: 'u32' }, { nom: 'liens.octets', t: 'u8' }
]);
const TAILLE = { i32: 4, u32: 4, u8: 1 }, CLASSE = { i32: Int32Array, u32: Uint32Array, u8: Uint8Array };
const ENTETE_MAX = 4 * 1048576, FICHIER_MAX = 256 * 1048576;

class FormatInvalide extends Error { constructor(motif) { super(motif); this.name = 'FormatInvalide'; this.motif = motif; } }
const refuser = m => { throw new FormatInvalide(m); };
const aligner = n => (n + 3) & ~3;
const hache = b => crypto.createHash('sha256').update(b).digest();

function cible(d, nom) { const [a, b] = nom.split('.'); return b === undefined ? d.cols[a] : d[a === 'meta' ? 'meta' : a][b]; }
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
    for (const s of SECTIONS) {
        const a = cible(donnees, s.nom), oct = Buffer.from(a.buffer, a.byteOffset, a.byteLength);
        descr.push({ nom: s.nom, t: s.t, n: a.length }); regions.push(oct); const pad = aligner(oct.length) - oct.length; if (pad) regions.push(Buffer.alloc(pad));
    }
    const entete = { format: FORMAT, chargeLe: donnees.chargeLe.toISOString(), comptes: donnees.comptes, sets: donnees.fiches.sets, prefixe: donnees.liens.prefixe, entree, sections: descr };
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
    if (entete.format !== FORMAT) refuser(`numéro de format inconnu (${String(entete.format).slice(0, 10)})`);
    if (!Array.isArray(entete.sections) || entete.sections.length !== SECTIONS.length) refuser('liste de sections incomplète');
    let o = debut; const d = { cols: {}, texte: {}, liens: {}, meta: {}, fiches: {} };
    SECTIONS.forEach((s, i) => {
        const x = entete.sections[i];
        if (!x || x.nom !== s.nom || x.t !== s.t || !Number.isInteger(x.n) || x.n < 0) refuser(`section « ${s.nom} » absente ou mal décrite`);
        const octets = x.n * TAILLE[s.t];
        if (o + octets > buf.length - 32) refuser(`section « ${s.nom} » plus longue que le fichier`);
        const copie = buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + octets);           // COPIE alignée : le tampon du fichier est libéré ensuite
        const a = new CLASSE[s.t](copie);
        const [p, q] = s.nom.split('.');
        if (q === undefined) d.cols[p] = a; else if (p === 'meta') d.meta[q] = a; else if (p === 'fiches') d.fiches[q] = a; else d[p][q === 'off' ? 'off' : 'octets'] = a;
        o += aligner(octets);
    });
    if (o !== buf.length - 32) refuser('octets en trop entre la dernière section et le hachage');
    // ── la STRUCTURE (un fichier menteur a un hachage juste)
    const n = d.cols.id.length; if (n === 0) refuser('aucune entrée');
    for (const k of Object.keys(d.cols)) if (d.cols[k].length !== n) refuser(`colonne « ${k} » de longueur différente`);
    for (let i = 1; i < n; i++) if (d.cols.id[i] <= d.cols.id[i - 1]) refuser('identifiants de produit non strictement croissants');
    for (const r of [d.texte, d.liens]) {
        if (r.off.length < 1 || r.off[0] !== 0 || r.off[r.off.length - 1] !== r.octets.length) refuser('réserve de chaînes incohérente');
        for (let i = 1; i < r.off.length; i++) if (r.off[i] < r.off[i - 1]) refuser('réserve de chaînes : décalages décroissants');
    }
    const nT = d.texte.off.length - 1, nL = d.liens.off.length - 1;
    const dansT = (a, min) => { for (let i = 0; i < a.length; i++) if (a[i] < min || a[i] >= nT) return false; return true; };
    for (const k of ['vig']) if (!dansT(d.cols[k], 0)) refuser(`indice de chaîne hors de la réserve (${k})`);
    for (const k of ['gra', 'men', 'num', 'rar', 'tot', 'variante', 'set']) if (!dansT(d.cols[k], -1)) refuser(`indice de chaîne hors de la réserve (${k})`);
    for (let i = 0; i < n; i++) if (d.cols.lien[i] < -1 || d.cols.lien[i] >= nL) refuser('indice de lien hors de la réserve');
    if (d.meta.cle.length !== d.meta.produit.length) refuser('métacartes : colonnes de longueur différente');
    for (let i = 1; i < d.meta.cle.length; i++) if (d.meta.cle[i] < d.meta.cle[i - 1]) refuser('métacartes non triées');
    const m = d.fiches.carte.length;
    for (const k of ['num', 'debut', 'fin']) if (d.fiches[k].length !== m) refuser(`fiches : colonne « ${k} » de longueur différente`);
    if (!dansT(d.fiches.num, 0)) refuser('fiches : indice de numéro hors de la réserve');
    for (let i = 0; i < m; i++) if (d.fiches.debut[i] < 0 || d.fiches.debut[i] > d.fiches.fin[i] || d.fiches.fin[i] > d.fiches.produits.length) refuser('fiches : bornes de produits hors des produits');
    if (!Array.isArray(entete.sets)) refuser('sets illisibles');
    for (const s of entete.sets) if (!Array.isArray(s) || typeof s[0] !== 'string' || !Array.isArray(s[1]) || !(s[1][0] >= 0 && s[1][0] <= s[1][1] && s[1][1] <= m)) refuser('sets : bornes hors des fiches');
    const c = entete.comptes;
    if (!c || typeof c !== 'object' || c.visuels !== n || c.fichesLiees !== m || c.produitsLies !== d.fiches.produits.length) refuser('comptes de l\'en-tête différents de ceux des colonnes');
    if (typeof entete.prefixe !== 'string' || entete.prefixe.length > 300) refuser('préfixe de lien illisible');
    const quand = new Date(entete.chargeLe); if (Number.isNaN(quand.getTime())) refuser('date illisible');
    return depuisPaquet({ ...d, comptes: Object.freeze({ ...c }), chargeLe: quand, liens: { ...d.liens, prefixe: entete.prefixe }, fiches: { ...d.fiches, sets: entete.sets } });
}

const gzip = b => new Promise((ok, ko) => zlib.gzip(b, { level: 9 }, (e, r) => (e ? ko(e) : ok(r))));
async function compresser(buf) { return gzip(buf); }
async function decompresser(buf, { max = FICHIER_MAX } = {}) {
    return new Promise((ok, ko) => zlib.gunzip(buf, { maxOutputLength: max }, (e, r) => (e ? ko(new FormatInvalide(e.code === 'ERR_BUFFER_TOO_LARGE' ? 'archive plus grande que la taille permise' : 'archive gzip illisible')) : ok(r))));
}

module.exports = { serialiser, deserialiser, lireEntete, reecrireEntete, sections, sceller, compresser, decompresser, FormatInvalide, FORMAT, SECTIONS };
