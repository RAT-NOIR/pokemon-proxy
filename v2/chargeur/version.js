'use strict';
// COTES-VISUELS, tour 1 — la forme gardée en mémoire est COLONNAIRE : des tableaux typés (une colonne par champ, triés par idProduct, recherche dichotomique) et deux réserves de chaînes en
// octets UTF-8 (déduplication ; les liens Cardmarket partagent leur préfixe commun). Rien n'est un objet par produit : la version pèse quelques dizaines de Mo d'octets, hors du tas de V8,
// et se transmet d'un fil de travail à l'autre SANS copie (tampons transférables).
//   entree(idProduct)            → le document que lireEntree a validé (même clés, même ordre), reconstruit à la demande ; null si absent
//   produitsDeMetacarte(m)       → [idProduct…] triés
//   fichesDuSet(slug)            → [{ cle: 'idInterne|numero', produits: [idProduct…] }] ; produitsDeLaFiche(slug, cle) → [idProduct…]
//   comptes, octets              → les dénominateurs ; la taille mesurée des colonnes et des chaînes
// Le constructeur reçoit les résultats UN À UN (sink de decider) : il ne tient jamais le tableau des entrées.
const { lireEntree } = require('../identifier/visuels');

const COLS = ['id', 'vig', 'vw', 'vh', 'gra', 'gw', 'gh', 'men', 'meta', 'num', 'rar', 'tot', 'variante', 'set', 'lien'];

function colonne() {
    let a = new Int32Array(1024), n = 0;
    return { push(v) { if (n === a.length) { const b = new Int32Array(a.length * 2); b.set(a); a = b; } a[n++] = v; }, set(i, v) { a[i] = v; }, get n() { return n; }, get(i) { return a[i]; }, vue: () => a.subarray(0, n) };
}
function reserve() {
    const index = new Map(), liste = [];
    return { id(s) { if (s === null || s === undefined) return -1; let i = index.get(s); if (i === undefined) { i = liste.length; index.set(s, i); liste.push(s); } return i; }, liste };
}
const encodeur = new TextEncoder(), decodeur = new TextDecoder('utf-8');
/** Range des chaînes dans UN tampon d'octets : { off: Uint32Array(n+1), octets: Uint8Array }. `transformer` s'applique à chaque chaîne (le préfixe retiré des liens). */
function encoder(liste, transformer = s => s) {
    const morceaux = liste.map(s => encodeur.encode(transformer(s)));
    const off = new Uint32Array(morceaux.length + 1);
    let t = 0; for (let i = 0; i < morceaux.length; i++) { off[i] = t; t += morceaux[i].length; } off[morceaux.length] = t;
    const octets = new Uint8Array(t);
    for (let i = 0; i < morceaux.length; i++) octets.set(morceaux[i], off[i]);
    return { off, octets };
}
const lire = (r, i) => (i < 0 ? null : decodeur.decode(r.octets.subarray(r.off[i], r.off[i + 1])));
function chercher(tab, v) {                                                     // dichotomie sur un Int32Array trié ; -1 si absent
    let lo = 0, hi = tab.length - 1;
    while (lo <= hi) { const m = (lo + hi) >>> 1, x = tab[m]; if (x === v) return m; if (x < v) lo = m + 1; else hi = m - 1; }
    return -1;
}
function borne(tab, v, haut) {                                                  // première position où tab[i] > v (haut) ou >= v
    let lo = 0, hi = tab.length;
    while (lo < hi) { const m = (lo + hi) >>> 1; if (haut ? tab[m] <= v : tab[m] < v) lo = m + 1; else hi = m; }
    return lo;
}
const plusLongPrefixe = liste => {
    if (!liste.length) return '';
    let p = liste[0];
    for (const s of liste) { let i = 0; const m = Math.min(p.length, s.length); while (i < m && p.charCodeAt(i) === s.charCodeAt(i)) i++; p = p.slice(0, i); if (!p) break; }
    const cut = p.lastIndexOf('/'); return cut >= 0 ? p.slice(0, cut + 1) : '';        // on coupe à une frontière de segment
};

/** Assemble la VERSION (gelée) autour de colonnes déjà construites — par le constructeur ou reçues d'un autre fil. */
function assembler(d) {
    const { cols, texte, liens, meta, fiches, comptes, chargeLe } = d;
    const ids = cols.id;
    const octets = { colonnes: 0, chaines: texte.octets.byteLength + liens.octets.byteLength + texte.off.byteLength + liens.off.byteLength };
    for (const k of [...Object.values(cols), meta.cle, meta.produit, fiches.carte, fiches.num, fiches.debut, fiches.fin, fiches.produits]) octets.colonnes += k.byteLength;
    octets.total = octets.colonnes + octets.chaines;
    const parSet = new Map(fiches.sets);                                        // slug → [premier, dernier+1] dans les colonnes de fiches
    const V = {
        chargeLe, comptes, octets,
        /** Les identifiants de produit, triés (une vue de la colonne : à ne pas modifier). */
        identifiants: () => ids,
        entree(id) {
            if (!Number.isInteger(id)) return null;
            const r = chercher(ids, id);
            if (r < 0) return null;
            const g = cols.gra[r], l = cols.lien[r];
            return { idProduct: id, vignette: { cle: lire(texte, cols.vig[r]), w: cols.vw[r], h: cols.vh[r] },
                grande: g < 0 ? null : { cle: lire(texte, g), w: cols.gw[r], h: cols.gh[r] }, mention: lire(texte, cols.men[r]),
                idMetacard: cols.meta[r] < 0 ? null : cols.meta[r], numero: lire(texte, cols.num[r]), rarete: lire(texte, cols.rar[r]), total: lire(texte, cols.tot[r]),
                variante: lire(texte, cols.variante[r]), setNom: lire(texte, cols.set[r]), lien: l < 0 ? null : liens.prefixe + lire(liens, l) };
        },
        produitsDeMetacarte(m) {
            if (!Number.isInteger(m)) return [];
            const a = borne(meta.cle, m, false), b = borne(meta.cle, m, true), out = [];
            for (let i = a; i < b; i++) out.push(meta.produit[i]);
            return out;
        },
        fichesDuSet(slug) {
            const p = typeof slug === 'string' ? parSet.get(slug) : undefined;
            if (!p) return [];
            const out = [];
            for (let i = p[0]; i < p[1]; i++) out.push({ cle: `${fiches.carte[i]}|${lire(texte, fiches.num[i])}`, produits: Array.from(fiches.produits.subarray(fiches.debut[i], fiches.fin[i])) });
            return out;
        },
        produitsDeLaFiche(slug, cle) { const f = V.fichesDuSet(slug).find(x => x.cle === cle); return f ? f.produits : []; },
        /** Le paquet à transmettre à un autre fil : des tampons à TRANSFÉRER (aucune copie) et le reste en données simples. */
        paquet() {
            const tous = [...Object.values(cols), meta.cle, meta.produit, fiches.carte, fiches.num, fiches.debut, fiches.fin, fiches.produits, texte.off, texte.octets, liens.off, liens.octets];
            return { donnees: { cols, texte, liens, meta, fiches: { ...fiches, sets: [...parSet] }, comptes, chargeLe }, tampons: [...new Set(tous.map(t => t.buffer))] };
        }
    };
    return Object.freeze(V);
}

function creerConstructeur() {
    const c = {}; for (const k of COLS) c[k] = colonne();
    const texte = reserve(), liensR = reserve();
    const fSet = [], fCarte = colonne(), fNum = colonne(), fDebut = colonne(), fFin = colonne(), prods = colonne();
    const motifs = {}; let lues = 0, refusees = 0, doublons = 0;
    const rang = new Map();                                                          // idProduct → rang dans les colonnes : un produit n'a qu'UNE entrée
    return {
        etat: () => ({ lues, admises: c.id.n, refusees, doublons, motifs, fiches: fSet.length }),
        entree(e) {
            lues++;
            const r = lireEntree(e);                                                // la validation d'entrée s'applique à CHAQUE entrée chargée
            if (!r.ok) { refusees++; motifs[r.motif] = (motifs[r.motif] || 0) + 1; return false; }
            const d = r.doc;
            // les valeurs, dans l'ordre de COLS
            const v = [d.idProduct, texte.id(d.vignette.cle), d.vignette.w, d.vignette.h, d.grande ? texte.id(d.grande.cle) : -1, d.grande ? d.grande.w : 0, d.grande ? d.grande.h : 0,
                texte.id(d.mention), d.idMetacard === null ? -1 : d.idMetacard, texte.id(d.numero), texte.id(d.rarete), texte.id(d.total), texte.id(d.variante), texte.id(d.setNom), liensR.id(d.lien)];
            // UN produit, UNE entrée — la règle de l'ancien import (v2/migrations/importer-visuels.js::preparer, retiré au tour 1) : « un doublon d'idProduct dans le lot : le dernier gagne »
            // (`parId.set(r.doc.idProduct, r.doc)`). Un produit rattaché à deux cartes (CLAUDE.md §32) émet deux entrées ; le consommateur refuse des identifiants non strictement croissants.
            const r0 = rang.get(d.idProduct);
            if (r0 !== undefined) { doublons++; COLS.forEach((k, i) => c[k].set(r0, v[i])); return true; }
            rang.set(d.idProduct, c.id.n);
            COLS.forEach((k, i) => c[k].push(v[i]));
            return true;
        },
        lien(setId, cle, idProducts) {
            const s = String(cle), i = s.indexOf('|'), carte = Number(s.slice(0, i));
            if (i < 1 || !Number.isInteger(carte)) throw new Error('clé de fiche illisible (idInterne|numero attendu)');
            fSet.push(setId); fCarte.push(carte); fNum.push(texte.id(s.slice(i + 1)));
            fDebut.push(prods.n); for (const p of idProducts) prods.push(p); fFin.push(prods.n);
        },
        finir(chargeLe = new Date()) {
            const n = c.id.n;
            if (n === 0) throw new Error('aucune entrée admise : jamais une version vide');
            // tri par idProduct : une permutation, puis chaque colonne est réécrite dans l'ordre
            const ordre = new Int32Array(n); for (let i = 0; i < n; i++) ordre[i] = i;
            const idsBruts = c.id.vue(); ordre.sort((a, b) => idsBruts[a] - idsBruts[b]);
            const cols = {};
            for (const k of COLS) { const src = c[k].vue(), dst = new Int32Array(n); for (let i = 0; i < n; i++) dst[i] = src[ordre[i]]; cols[k] = dst; }
            // métacartes : paires (métacarte, produit) triées
            const paires = []; for (let i = 0; i < n; i++) if (cols.meta[i] >= 0) paires.push(i);
            paires.sort((a, b) => cols.meta[a] - cols.meta[b] || cols.id[a] - cols.id[b]);
            const meta = { cle: new Int32Array(paires.length), produit: new Int32Array(paires.length) };
            paires.forEach((i, k) => { meta.cle[k] = cols.meta[i]; meta.produit[k] = cols.id[i]; });
            // fiches : regroupées par set (ordre d'arrivée conservé dans un set)
            const groupes = new Map(); fSet.forEach((s, i) => { if (!groupes.has(s)) groupes.set(s, []); groupes.get(s).push(i); });
            const m = fSet.length, fiches = { carte: new Int32Array(m), num: new Int32Array(m), debut: new Int32Array(m), fin: new Int32Array(m), produits: Int32Array.from(prods.vue()), sets: [] };
            let k = 0;
            for (const [slug, lignes] of groupes) { const a = k; for (const i of lignes) { fiches.carte[k] = fCarte.get(i); fiches.num[k] = fNum.get(i); fiches.debut[k] = fDebut.get(i); fiches.fin[k] = fFin.get(i); k++; } fiches.sets.push([slug, [a, k]]); }
            const prefixe = plusLongPrefixe(liensR.liste);
            const liens = { ...encoder(liensR.liste, s => s.slice(prefixe.length)), prefixe };
            const t = encoder(texte.liste);
            const comptes = Object.freeze({ lues, visuels: n, refusees, doublons, motifs, setsAvecLiens: groupes.size, fichesLiees: m, produitsLies: fiches.produits.length });
            return assembler({ cols, texte: t, liens, meta, fiches, comptes, chargeLe });
        }
    };
}

class StructureInvalide extends Error { constructor(motif) { super(motif); this.name = 'StructureInvalide'; this.motif = motif; } }
/**
 * La STRUCTURE d'une version reçue (d'un fichier ou d'un autre fil) : écrite par ce qu'elle AUTORISE. Colonnes de même longueur, identifiants strictement croissants, indices de chaînes
 * dans la réserve, bornes des fiches et des sets dans leurs colonnes, comptes annoncés = comptes des colonnes. UNE seule définition pour les deux voies (§21 bis).
 */
function verifierStructure(d) {
    const refuser = m => { throw new StructureInvalide(m); };
    const n = d.cols.id.length; if (n === 0) refuser('aucune entrée');
    for (const k of Object.keys(d.cols)) if (d.cols[k].length !== n) refuser(`colonne « ${k} » de longueur différente`);
    for (let i = 1; i < n; i++) if (d.cols.id[i] <= d.cols.id[i - 1]) refuser('identifiants de produit non strictement croissants');
    for (const r of [d.texte, d.liens]) {
        if (r.off.length < 1 || r.off[0] !== 0 || r.off[r.off.length - 1] !== r.octets.length) refuser('réserve de chaînes incohérente');
        for (let i = 1; i < r.off.length; i++) if (r.off[i] < r.off[i - 1]) refuser('réserve de chaînes : décalages décroissants');
    }
    const nT = d.texte.off.length - 1, nL = d.liens.off.length - 1;
    const dansT = (a, min) => { for (let i = 0; i < a.length; i++) if (a[i] < min || a[i] >= nT) return false; return true; };
    if (!dansT(d.cols.vig, 0)) refuser('indice de chaîne hors de la réserve (vig)');
    for (const k of ['gra', 'men', 'num', 'rar', 'tot', 'variante', 'set']) if (!dansT(d.cols[k], -1)) refuser(`indice de chaîne hors de la réserve (${k})`);
    for (let i = 0; i < n; i++) if (d.cols.lien[i] < -1 || d.cols.lien[i] >= nL) refuser('indice de lien hors de la réserve');
    if (d.meta.cle.length !== d.meta.produit.length) refuser('métacartes : colonnes de longueur différente');
    for (let i = 1; i < d.meta.cle.length; i++) if (d.meta.cle[i] < d.meta.cle[i - 1]) refuser('métacartes non triées');
    const m = d.fiches.carte.length;
    for (const k of ['num', 'debut', 'fin']) if (d.fiches[k].length !== m) refuser(`fiches : colonne « ${k} » de longueur différente`);
    if (!dansT(d.fiches.num, 0)) refuser('fiches : indice de numéro hors de la réserve');
    for (let i = 0; i < m; i++) if (d.fiches.debut[i] < 0 || d.fiches.debut[i] > d.fiches.fin[i] || d.fiches.fin[i] > d.fiches.produits.length) refuser('fiches : bornes de produits hors des produits');
    if (!Array.isArray(d.fiches.sets)) refuser('sets illisibles');
    for (const s of d.fiches.sets) if (!Array.isArray(s) || typeof s[0] !== 'string' || !Array.isArray(s[1]) || !(s[1][0] >= 0 && s[1][0] <= s[1][1] && s[1][1] <= m)) refuser('sets : bornes hors des fiches');
    const c = d.comptes;
    if (!c || typeof c !== 'object' || c.visuels !== n || c.fichesLiees !== m || c.produitsLies !== d.fiches.produits.length) refuser('comptes de l\'en-tête différents de ceux des colonnes');
    if (typeof d.liens.prefixe !== 'string' || d.liens.prefixe.length > 300) refuser('préfixe de lien illisible');
}

/** Reçoit le paquet d'un autre fil (ses tampons sont devenus les nôtres) et rend la version, après avoir jugé sa STRUCTURE comme pour un fichier. */
function depuisPaquet(donnees) { verifierStructure(donnees); return assembler(donnees); }

/**
 * Rejoue lireEntree (la validation d'entrée de visuels.js : cleMotif, lien Cardmarket, substitut avec mention, forme des champs) sur CHAQUE produit d'une version reçue : le hachage d'un fichier
 * prouve son intégrité, pas qu'il est honnête (CLAUDE.md « 0 faux affirmé »). @returns {{ ok: boolean, refusees: number, motifs: object }}
 */
function rejugerEntrees(version) {
    const motifs = {}; let refusees = 0;
    for (const id of version.identifiants()) { const r = lireEntree(version.entree(id)); if (!r.ok) { refusees++; motifs[r.motif] = (motifs[r.motif] || 0) + 1; } }
    return { ok: refusees === 0, refusees, motifs };
}

module.exports = { creerConstructeur, depuisPaquet, verifierStructure, rejugerEntrees, StructureInvalide };
