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
const PV = require('../identifier/partage-variante');                              // PARTAGES-VARIANTE : la paire séparée par la variante, une seule définition
const { separeeParVariante } = PV;

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

// JUMEAU-V2 — la COLONNE DES JUMEAUX. Un jumeau de P est un AUTRE produit de même métacarte, de même langue de tirage et d'un AUTRE créneau (expansion, numéro) : la seule lecture du code et du
// numéro le sépare de P, et c'est précisément la lecture qui se trompe (IMG_3237). Elle porte TOUT le catalogue, pas seulement les produits qui ont un visuel (mesuré : 27,6 % des jumeaux n'en ont pas).
// Un champ INCONNU (créneau, langue) compte comme « même » : le produit voisin reste un jumeau. Sans colonne (fichier plus ancien), jumeauxDe rend null : on ne peut pas conclure.
const JUM_COLS = Object.freeze(['meta', 'id', 'exp', 'num', 'tir', 'ordre']);
function plusPetitOrdre(jum, id) {                                              // dichotomie sur la permutation triée par identifiant ; -1 si absent
    let lo = 0, hi = jum.ordre.length - 1;
    while (lo <= hi) { const m = (lo + hi) >>> 1, x = jum.id[jum.ordre[m]]; if (x === id) return jum.ordre[m]; if (x < id) lo = m + 1; else hi = m - 1; }
    return -1;
}
function sontJumeaux(jum, a, b) {
    if (jum.exp[a] >= 0 && jum.num[a] >= 0 && jum.exp[b] >= 0 && jum.num[b] >= 0 && jum.exp[a] === jum.exp[b] && jum.num[a] === jum.num[b]) return false;     // même créneau : une variante, pas un jumeau
    if (jum.tir[a] >= 0 && jum.tir[b] >= 0 && jum.tir[a] !== jum.tir[b]) return false;                                                                      // une autre langue de tirage
    return true;
}

// REPLI-REIMPRESSIONS — la COLONNE DES MARQUAGES (format 2) : une valeur par ligne de visuel (alignée sur cols.id), jamais un objet par produit.
//   flags    trois champs de 2 bits : holo (partageeHoloNonHolo), tampon (partageeTamponNonSepare), basse (basseDefinition) ; 0 = null, 1 = true, 2 = false ;
//   tampon   l'indice dans la réserve de textes de tamponNonRepresente (-1 = aucun) ; pdeb/pfin les bornes de produitsPartages dans la liste plate `produits`.
// Une version SANS cette colonne (archive d'avant) ne conclut rien : partagesDe rend null, jamais « aucun partage ».
const MAR_COLS = Object.freeze(['flags', 'tampon', 'pdeb', 'pfin', 'produits']);
const CHAMPS_FLAGS = Object.freeze([['holo', 0], ['tampon', 2], ['basse', 4]]);
const codeBool = b => (b === true ? 1 : b === false ? 2 : 0);
const boolDeCode = c => (c === 1 ? true : c === 2 ? false : null);
const champDe = (flags, decalage) => (flags >> decalage) & 3;
const fabriquerFlags = ({ partageeHoloNonHolo: h, partageeTamponNonSepare: t, basseDefinition: b }) => codeBool(h) | (codeBool(t) << 2) | (codeBool(b) << 4);
const FLAGS_MASQUE = 0b111111, PARTAGES_MAX = 6;
// LOT TAMPONS (B, tour 1) — la COLONNE DES PRIX MÉLANGÉS : la liste TRIÉE des idProduct que cartes_produits marque `prixMelangeTampon`, émise pour CHAQUE ligne marquée AVANT tout écartement (comme la colonne
// des jumeaux) : la marque ne dépend d'AUCUN visuel (un produit sans entrée d'archive la porte aussi). Sans cette colonne (archive d'avant), prixMelange rend null (« inconnu »), jamais « faux ».
const MEL_COLS = Object.freeze(['produits']);
/** Les comptes de marquage, calculés sur les colonnes (le constructeur les écrit, la structure les revérifie). */
function compterMarquees(mar) {
    const c = { holo: 0, tampon: 0, partages: 0, basse: 0 };
    for (let i = 0; i < mar.flags.length; i++) {
        if (champDe(mar.flags[i], 0) === 1) c.holo++;
        if (champDe(mar.flags[i], 2) !== 0) c.tampon++;
        if (champDe(mar.flags[i], 4) === 1) c.basse++;
        if (mar.pfin[i] > mar.pdeb[i]) c.partages++;
    }
    return c;
}

/** Assemble la VERSION (gelée) autour de colonnes déjà construites — par le constructeur ou reçues d'un autre fil. */
function assembler(d) {
    const { cols, texte, liens, meta, fiches, comptes, chargeLe, jum, mar, mel } = d;
    const ids = cols.id;
    const octets = { colonnes: 0, chaines: texte.octets.byteLength + liens.octets.byteLength + texte.off.byteLength + liens.off.byteLength };
    for (const k of [...Object.values(cols), meta.cle, meta.produit, fiches.carte, fiches.num, fiches.debut, fiches.fin, fiches.produits, ...(jum ? JUM_COLS.map(k => jum[k]) : []), ...(mar ? MAR_COLS.map(k => mar[k]) : []), ...(mel ? MEL_COLS.map(k => mel[k]) : [])]) octets.colonnes += k.byteLength;
    octets.total = octets.colonnes + octets.chaines;
    const parSet = new Map(fiches.sets);                                        // slug → [premier, dernier+1] dans les colonnes de fiches
    const marquagesDe = r => {                                                  // les cinq champs d'une ligne ; null partout sans colonne (le même jeu de clés dans les deux cas)
        if (!mar) return { partageeHoloNonHolo: null, partageeTamponNonSepare: null, produitsPartages: null, tamponNonRepresente: null, basseDefinition: null };
        const f = mar.flags[r];
        return { partageeHoloNonHolo: boolDeCode(champDe(f, 0)), partageeTamponNonSepare: boolDeCode(champDe(f, 2)),
            produitsPartages: mar.pfin[r] > mar.pdeb[r] ? Array.from(mar.produits.subarray(mar.pdeb[r], mar.pfin[r])) : null,
            tamponNonRepresente: lire(texte, mar.tampon[r]), basseDefinition: boolDeCode(champDe(f, 4)) };
    };
    // produit → les autres membres de son groupe de partage (l'union des listes qui le nomment), construit une fois, à la demande (quelques centaines de lignes marquées)
    let groupes = null;
    const groupesDePartage = () => {
        if (groupes) return groupes;
        groupes = new Map();
        for (let r = 0; r < ids.length; r++) {
            if (mar.pfin[r] <= mar.pdeb[r]) continue;
            const liste = Array.from(mar.produits.subarray(mar.pdeb[r], mar.pfin[r]));
            for (const p of liste) { if (!groupes.has(p)) groupes.set(p, new Set()); for (const q of liste) if (q !== p) groupes.get(p).add(q); }
        }
        return groupes;
    };
    // PARTAGES-VARIANTE : les paires SANS liste, séparées par la variante (false, ni holo, variante staff|jumbo|normale) — le partage ne se lit plus dans une liste mais dans le visuel ET la fiche communs.
    // Construit une fois, à la demande : les rangs candidats (quelques centaines), leurs fiches (une passe sur les fiches), puis les couples jugés par pairePar (la MÊME fonction que F1).
    let variantes = null;
    const pairesParVariante = () => {
        if (variantes) return variantes;
        variantes = { fiches: new Map(), partenaires: new Map() };
        if (!mar) return variantes;
        const candidats = [];
        for (let r = 0; r < ids.length; r++) {
            const f = mar.flags[r];
            if (champDe(f, 2) === 2 && champDe(f, 0) !== 1 && mar.pfin[r] <= mar.pdeb[r] && PV.estVariantePaire(lire(texte, cols.variante[r]))) candidats.push(r);
        }
        if (!candidats.length) return variantes;
        const choisis = new Set(candidats.map(r => ids[r]));
        for (let i = 0; i < fiches.debut.length; i++) for (let k = fiches.debut[i]; k < fiches.fin[i]; k++) {
            const p = fiches.produits[k];
            if (choisis.has(p)) { if (!variantes.fiches.has(p)) variantes.fiches.set(p, new Set()); variantes.fiches.get(p).add(`${i}`); }
        }
        const seaux = new Map();                                                    // le visuel (vignette + grande) → les produits candidats
        for (const r of candidats) { const cle = `${lire(texte, cols.vig[r])}|${cols.gra[r] < 0 ? '' : lire(texte, cols.gra[r])}`; if (!seaux.has(cle)) seaux.set(cle, []); seaux.get(cle).push(ids[r]); }
        const memeFiche = (a, b) => { const x = variantes.fiches.get(a), y = variantes.fiches.get(b); if (!x || !y) return false; for (const f of x) if (y.has(f)) return true; return false; };
        for (const liste of seaux.values()) for (let i = 0; i < liste.length; i++) for (let j = i + 1; j < liste.length; j++) {
            if (!PV.pairePar(V.entree(liste[i]), V.entree(liste[j]), memeFiche).ok) continue;
            for (const [p, q] of [[liste[i], liste[j]], [liste[j], liste[i]]]) { if (!variantes.partenaires.has(p)) variantes.partenaires.set(p, new Set()); variantes.partenaires.get(p).add(q); }
        }
        return variantes;
    };
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
                variante: lire(texte, cols.variante[r]), setNom: lire(texte, cols.set[r]), lien: l < 0 ? null : liens.prefixe + lire(liens, l), ...marquagesDe(r) };
        },
        /** La colonne des marquages est-elle chargée ? (une archive d'avant : non — aucun partage ne peut alors être conclu.) */
        colonneMarquages: Boolean(mar),
        /** La colonne des prix mélangés est-elle chargée ? (une archive d'avant : non — rien ne peut alors être conclu.) */
        colonneMelange: Boolean(mel),
        /** Ce produit est-il marqué `prixMelangeTampon` par cartes_produits ? true / false d'après la colonne (qu'il ait une entrée d'archive ou non) ; null sans colonne : on ne sait pas. */
        prixMelange(id) {
            if (!mel || !Number.isInteger(id)) return null;
            return chercher(mel.produits, id) >= 0;
        },
        /**
         * Les AUTRES produits qui partagent le visuel de `id` et que l'IMAGE ne sépare pas de lui (holo/non-holo, tampon non séparé, et une paire SÉPARÉE par l'étiquette : tant que la lecture du tampon sur la
         * photo n'existe pas, elle compte comme non séparée), triés. [] = conclu, aucun ; null = pas de colonne (on ne sait pas). Le partage se lit dans les deux sens : un produit nommé dans la liste d'un
         * AUTRE produit (qui n'a lui-même aucune entrée) est partagé avec lui.
         */
        partagesDe(id) {
            if (!mar || !Number.isInteger(id)) return null;
            const g = groupesDePartage().get(id), p = pairesParVariante().partenaires.get(id);
            return g || p ? [...new Set([...(g || []), ...(p || [])])].sort((a, b) => a - b) : [];
        },
        /** PARTAGES-VARIANTE : ces deux produits sont-ils de la même fiche ? Vrai seulement pour deux produits candidats à une paire séparée par la variante (les seuls dont la fiche est lue) ; faux sinon, sans colonne comprise. */
        memeFiche(a, b) {
            if (!mar || !Number.isInteger(a) || !Number.isInteger(b)) return false;
            const x = pairesParVariante().fiches.get(a), y = pairesParVariante().fiches.get(b);
            if (!x || !y) return false;
            for (const f of x) if (y.has(f)) return true;
            return false;
        },
        produitsDeMetacarte(m) {
            if (!Number.isInteger(m)) return [];
            const a = borne(meta.cle, m, false), b = borne(meta.cle, m, true), out = [];
            for (let i = a; i < b; i++) out.push(meta.produit[i]);
            return out;
        },
        /** La colonne des jumeaux est-elle chargée ? (un fichier d'avant la colonne : non — aucune affirmation ne peut alors être conclue.) */
        colonneJumeaux: Boolean(jum),
        /** Ce que la colonne couvre : { n: nombre de produits, max: le plus grand idProduct qu'elle connaît }. La route cherche, pour un produit qu'elle s'apprête à affirmer, un produit PLUS RÉCENT (> max) de sa métacarte. null sans colonne. */
        empreinteJumeaux() { return jum && jum.id.length ? { n: jum.id.length, max: jum.id[jum.ordre[jum.id.length - 1]] } : null; },
        /** La métacarte d'un produit selon la colonne, ou null (colonne absente, produit hors colonne, métacarte inconnue). */
        metacarteJumeaux(id) { if (!jum || !Number.isInteger(id)) return null; const r = plusPetitOrdre(jum, id); return r < 0 || jum.meta[r] < 0 ? null : jum.meta[r]; },
        /** GARDE-CONTRADICTION : la langue de TIRAGE d'un produit selon la colonne (« intl », « jp », « zh-hans »…), ou null (colonne absente, produit hors colonne, tirage inconnu). */
        tirageJumeaux(id) { if (!jum || !Number.isInteger(id)) return null; const r = plusPetitOrdre(jum, id); return r < 0 ? null : lire(texte, jum.tir[r]); },
        /** Les jumeaux d'un produit (idProduct triés), ou null quand on ne peut PAS conclure : colonne absente, produit hors colonne, métacarte inconnue. [] = conclu, aucun jumeau. */
        jumeauxDe(id) {
            if (!jum || !Number.isInteger(id)) return null;
            const r = plusPetitOrdre(jum, id);
            if (r < 0 || jum.meta[r] < 0) return null;
            const m = jum.meta[r], a = borne(jum.meta, m, false), b = borne(jum.meta, m, true), out = [];
            for (let i = a; i < b; i++) if (i !== r && sontJumeaux(jum, r, i)) out.push(jum.id[i]);
            return out.sort((x, y) => x - y);
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
            const tous = [...Object.values(cols), meta.cle, meta.produit, fiches.carte, fiches.num, fiches.debut, fiches.fin, fiches.produits, texte.off, texte.octets, liens.off, liens.octets, ...(jum ? JUM_COLS.map(k => jum[k]) : []), ...(mar ? MAR_COLS.map(k => mar[k]) : []), ...(mel ? MEL_COLS.map(k => mel[k]) : [])];
            return { donnees: { cols, texte, liens, meta, fiches: { ...fiches, sets: [...parSet] }, comptes, chargeLe, ...(jum ? { jum } : {}), ...(mar ? { mar } : {}), ...(mel ? { mel } : {}) }, tampons: [...new Set(tous.map(t => t.buffer))] };
        }
    };
    return Object.freeze(V);
}

const unionBool = (a, b) => (a === true || b === true ? true : a === false || b === false ? false : null);
const AVEC_MARQUES = d => d.partageeHoloNonHolo !== null || d.partageeTamponNonSepare !== null || d.produitsPartages !== null || d.tamponNonRepresente !== null || d.basseDefinition !== null;
/** @param opts.marquages  vrai : le constructeur écrit la colonne des marquages (format 2). Faux (défaut) : une entrée qui porte un marquage LÈVE — jamais perdu en silence. */
function creerConstructeur({ marquages = false } = {}) {
    const c = {}; for (const k of COLS) c[k] = colonne();
    const marques = [];                                                              // par rang : { holo, tampon, basse, tn (indice de texte), liste } — seulement si `marquages`
    const texte = reserve(), liensR = reserve();
    const fSet = [], fCarte = colonne(), fNum = colonne(), fDebut = colonne(), fFin = colonne(), prods = colonne();
    const motifs = {}; let lues = 0, refusees = 0, doublons = 0;
    const rang = new Map();                                                          // idProduct → rang dans les colonnes : un produit n'a qu'UNE entrée
    const contradictoires = new Set();                                               // idProduct dont deux entrées portent des visuels DIFFÉRENTS : aucun visuel n'est servi pour eux
    const VISUEL = [1, 2, 3, 4, 5, 6].map(i => COLS[i]);                             // vig, vw, vh, gra, gw, gh : ce qui est AFFICHÉ (le reste de l'entrée n'est pas un visuel)
    const jumeaux = new Map();                                                       // idProduct → { meta, exp, num, tir } (-1 = inconnu) : UNE ligne par produit du catalogue
    const melanges = new Set();                                                      // LOT TAMPONS (B) : les idProduct marqués prixMelangeTampon (indépendants de tout visuel)
    return {
        /** LOT TAMPONS (B) : un produit que cartes_produits marque `prixMelangeTampon`, avec ou sans entrée d'archive. Seulement avec la colonne des marquages (format 2). */
        melange(idProduct) {
            if (!marquages) throw new Error('constructeur sans colonne de marquages : un prix mélangé ne peut pas être écrit (jamais perdu en silence)');
            if (!Number.isInteger(idProduct) || idProduct <= 0) throw new Error('melange : idProduct entier positif attendu');
            melanges.add(idProduct);
        },
        /**
         * JUMEAU-V2 : le créneau (expansion, numéro) et la langue de tirage d'UN produit du catalogue, avec sa métacarte. null / absent = inconnu (et un inconnu reste un jumeau).
         * Deux appels pour le même produit qui se CONTREDISENT rendent le champ inconnu : jamais « le dernier gagne ».
         */
        jumeau({ idProduct, idMetacard = null, idExpansion = null, numero = null, tirage = null }) {
            if (!Number.isInteger(idProduct)) throw new Error('jumeau : idProduct non entier');
            const exp = Number.isInteger(idExpansion) && idExpansion >= 0 ? idExpansion : -1;
            const num = typeof numero === 'string' && numero.trim() ? texte.id(numero.trim()) : -1;
            const tir = typeof tirage === 'string' && tirage.trim() ? texte.id(tirage.trim()) : -1;
            const meta = Number.isInteger(idMetacard) && idMetacard >= 0 ? idMetacard : -1;
            const p = jumeaux.get(idProduct);
            if (!p) { jumeaux.set(idProduct, { meta, exp, num, tir }); return; }
            if (p.meta !== meta) p.meta = -1;                                        // deux métacartes pour un produit : on ne sait pas
            if (p.exp !== exp || p.num !== num) { p.exp = -1; p.num = -1; }          // le créneau est un COUPLE : il devient inconnu en entier
            if (p.tir !== tir) p.tir = -1;
        },
        etat: () => ({ lues, admises: c.id.n - contradictoires.size, refusees, doublons, doublonsContradictoires: contradictoires.size, motifs, fiches: fSet.length }),
        entree(e) {
            lues++;
            const r = lireEntree(e);                                                // la validation d'entrée s'applique à CHAQUE entrée chargée
            if (!r.ok) { refusees++; motifs[r.motif] = (motifs[r.motif] || 0) + 1; return false; }
            const d = r.doc;
            if (!marquages && AVEC_MARQUES(d)) throw new Error('constructeur sans colonne de marquages : une entrée porte un marquage (jamais perdu en silence)');
            const m = { holo: d.partageeHoloNonHolo, tampon: d.partageeTamponNonSepare, basse: d.basseDefinition, tn: d.tamponNonRepresente === null ? -1 : texte.id(d.tamponNonRepresente), liste: d.produitsPartages };
            // les valeurs, dans l'ordre de COLS
            const v = [d.idProduct, texte.id(d.vignette.cle), d.vignette.w, d.vignette.h, d.grande ? texte.id(d.grande.cle) : -1, d.grande ? d.grande.w : 0, d.grande ? d.grande.h : 0,
                texte.id(d.mention), d.idMetacard === null ? -1 : d.idMetacard, texte.id(d.numero), texte.id(d.rarete), texte.id(d.total), texte.id(d.variante), texte.id(d.setNom), liensR.id(d.lien)];
            // UN produit, UNE entrée. Un produit rattaché à deux cartes (CLAUDE.md §32) émet deux entrées ; le consommateur refuse des identifiants non strictement croissants.
            // RÈGLE DU TOUR 3 (le coordinateur remplace « le dernier gagne » de l'ancien import, dont l'ordre de lecture était arbitraire) : deux entrées aux visuels IDENTIQUES ⇒ une seule (la dernière,
            // pour le reste) ; deux entrées aux visuels DIFFÉRENTS ⇒ AUCUN visuel pour ce produit — un visuel absent est honnête, celui d'un autre tirage ne l'est pas. Compté dans les deux cas.
            if (contradictoires.has(d.idProduct)) return true;
            const r0 = rang.get(d.idProduct);
            if (r0 !== undefined) {
                if (!VISUEL.every((k, j) => c[k].get(r0) === v[j + 1])) { contradictoires.add(d.idProduct); return true; }
                doublons++; COLS.forEach((k, i) => c[k].set(r0, v[i]));
                if (marquages) {                                                     // deux entrées au même visuel : les marquages s'ADDITIONNENT (un partage dit par l'une vaut), jamais « le dernier gagne »
                    const p = marques[r0];
                    marques[r0] = { holo: unionBool(p.holo, m.holo), tampon: unionBool(p.tampon, m.tampon), basse: unionBool(p.basse, m.basse), tn: m.tn >= 0 ? m.tn : p.tn,
                        liste: p.liste || m.liste ? [...new Set([...(p.liste || []), ...(m.liste || [])])].sort((a, b) => a - b) : null };
                }
                return true;
            }
            rang.set(d.idProduct, c.id.n);
            if (marquages) marques[c.id.n] = m;
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
            // tri par idProduct : une permutation (sans les produits contradictoires), puis chaque colonne est réécrite dans l'ordre
            const idsBruts = c.id.vue(); const gardes = [];
            for (let i = 0; i < idsBruts.length; i++) if (!contradictoires.has(idsBruts[i])) gardes.push(i);
            const n = gardes.length;
            if (n === 0) throw new Error('aucune entrée admise : jamais une version vide');
            const ordre = Int32Array.from(gardes); ordre.sort((a, b) => idsBruts[a] - idsBruts[b]);
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
            // la colonne des marquages, réécrite dans l'ordre trié (comme les autres colonnes) ; ses comptes sont calculés SUR les colonnes
            let mar;
            if (marquages) {
                const flags = new Int32Array(n), tampon = new Int32Array(n), pdeb = new Int32Array(n), pfin = new Int32Array(n), plat = [];
                for (let i = 0; i < n; i++) {
                    const x = marques[ordre[i]];
                    flags[i] = fabriquerFlags({ partageeHoloNonHolo: x.holo, partageeTamponNonSepare: x.tampon, basseDefinition: x.basse }); tampon[i] = x.tn;
                    pdeb[i] = plat.length; if (x.liste) for (const p of x.liste) plat.push(p); pfin[i] = plat.length;
                }
                mar = { flags, tampon, pdeb, pfin, produits: Int32Array.from(plat) };
            }
            // la colonne des prix mélangés : la liste triée des idProduct marqués (écrite avec la colonne des marquages, même vide : « aucun » est une réponse)
            const mel = marquages ? { produits: Int32Array.from([...melanges].sort((a, b) => a - b)) } : undefined;
            const comptes = Object.freeze({ lues, visuels: n, refusees, doublons, doublonsContradictoires: contradictoires.size, motifs, setsAvecLiens: groupes.size, fichesLiees: m, produitsLies: fiches.produits.length, ...(jumeaux.size ? { jumeaux: jumeaux.size } : {}), ...(mar ? { marquees: compterMarquees(mar) } : {}), ...(mel ? { melange: mel.produits.length } : {}) });
            // la colonne des jumeaux : paires (métacarte, produit) triées, plus la permutation triée par produit (recherche d'un produit seul)
            let jum;
            if (jumeaux.size) {
                const lignes = [...jumeaux].map(([id, p]) => ({ id, ...p })).sort((a, b) => a.meta - b.meta || a.id - b.id), k2 = lignes.length;
                jum = { meta: new Int32Array(k2), id: new Int32Array(k2), exp: new Int32Array(k2), num: new Int32Array(k2), tir: new Int32Array(k2), ordre: new Int32Array(k2) };
                lignes.forEach((l, i) => { jum.meta[i] = l.meta; jum.id[i] = l.id; jum.exp[i] = l.exp; jum.num[i] = l.num; jum.tir[i] = l.tir; jum.ordre[i] = i; });
                jum.ordre.sort((a, b) => jum.id[a] - jum.id[b]);
            }
            return assembler({ cols, texte: t, liens, meta, fiches, comptes, chargeLe, jum, mar, mel });
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
    if (d.jum !== undefined) {                                                  // la colonne des jumeaux (optionnelle : un fichier plus ancien n'en a pas), jugée comme les autres
        const j = d.jum;
        if (!j || typeof j !== 'object') refuser('jumeaux : colonne illisible');
        const k = j.id && j.id.length;
        for (const nom of JUM_COLS) if (!(j[nom] instanceof Int32Array) || j[nom].length !== k) refuser(`jumeaux : colonne « ${nom} » de longueur différente`);
        if (!k) refuser('jumeaux : colonne vide');
        for (let i = 0; i < k; i++) {
            if (j.meta[i] < -1 || j.exp[i] < -1 || j.num[i] < -1 || j.num[i] >= nT || j.tir[i] < -1 || j.tir[i] >= nT) refuser('jumeaux : valeur hors bornes');
            if (i > 0 && (j.meta[i] < j.meta[i - 1] || (j.meta[i] === j.meta[i - 1] && j.id[i] <= j.id[i - 1]))) refuser('jumeaux : paires (métacarte, produit) non triées ou en double');
            if (j.ordre[i] < 0 || j.ordre[i] >= k) refuser('jumeaux : permutation hors bornes');
            if (i > 0 && j.id[j.ordre[i]] <= j.id[j.ordre[i - 1]]) refuser('jumeaux : permutation non triée par produit');
        }
    }
    if (d.mar !== undefined) {                                                  // la colonne des marquages (optionnelle : une archive d'avant n'en a pas), jugée comme les autres
        const x = d.mar;
        if (!x || typeof x !== 'object') refuser('marquages : colonne illisible');
        for (const nom of MAR_COLS) if (!(x[nom] instanceof Int32Array)) refuser(`marquages : colonne « ${nom} » absente ou mal typée`);
        for (const nom of ['flags', 'tampon', 'pdeb', 'pfin']) if (x[nom].length !== n) refuser(`marquages : colonne « ${nom} » de longueur différente de celle des entrées`);
        for (let i = 0; i < n; i++) {
            const f = x.flags[i];
            if (f < 0 || (f & ~FLAGS_MASQUE) !== 0) refuser('marquages : bit de drapeau inconnu');
            for (const [, dec] of CHAMPS_FLAGS) if (champDe(f, dec) === 3) refuser('marquages : état de drapeau inconnu');
            if (x.tampon[i] < -1 || x.tampon[i] >= nT) refuser('marquages : indice de texte hors de la réserve');
            if (x.pdeb[i] < 0 || x.pdeb[i] > x.pfin[i] || x.pfin[i] > x.produits.length) refuser('marquages : bornes de produits partagés hors de la liste');
            const taille = x.pfin[i] - x.pdeb[i], partage = champDe(f, 0) === 1 || champDe(f, 2) !== 0;
            // PARTAGES-VARIANTE : la seule forme de partage SANS liste — false, ni holo, variante staff|jumbo|normale (partage-variante.js : la définition de la validation d'entrée et de la décision)
            const parVariante = partage && taille === 0 && separeeParVariante({ partageeHoloNonHolo: boolDeCode(champDe(f, 0)), partageeTamponNonSepare: boolDeCode(champDe(f, 2)), produitsPartages: null }, lire(d.texte, d.cols.variante[i]));
            if (partage && !parVariante && (taille < 2 || taille > PARTAGES_MAX)) refuser('marquages : un drapeau de partage sans liste de 2 à 6 produits');
            if (!partage && taille > 0) refuser('marquages : une liste de produits sans drapeau de partage');
            if (taille > 0) {
                const l = Array.from(x.produits.subarray(x.pdeb[i], x.pfin[i]));
                if (!l.every(p => p > 0) || new Set(l).size !== l.length || !l.includes(d.cols.id[i])) refuser('marquages : la liste des produits partagés ne contient pas le produit de la ligne (ou n\'est pas faite d\'identifiants distincts)');
            }
        }
        const calc = compterMarquees(x), dit = d.comptes && d.comptes.marquees;
        if (!dit || typeof dit !== 'object' || ['holo', 'tampon', 'partages', 'basse'].some(k => dit[k] !== calc[k])) refuser('marquages : comptes de l\'en-tête différents de ceux des colonnes');
    } else if (d.comptes && d.comptes.marquees !== undefined) refuser('marquages : des comptes de marquage sans colonne');
    if (d.mel !== undefined) {                                                  // la colonne des prix mélangés (LOT TAMPONS B : optionnelle, une archive d'avant n'en a pas) : triée, stricte, positive, comptée
        const x = d.mel;
        if (d.mar === undefined) refuser('prix mélangés : colonne sans colonne de marquages');
        if (!x || typeof x !== 'object' || !(x.produits instanceof Int32Array)) refuser('prix mélangés : colonne illisible');
        for (let i = 0; i < x.produits.length; i++) if (x.produits[i] <= 0 || (i > 0 && x.produits[i] <= x.produits[i - 1])) refuser('prix mélangés : identifiants non strictement croissants ou non positifs');
        if (!d.comptes || d.comptes.melange !== x.produits.length) refuser('prix mélangés : compte de l\'en-tête différent de celui de la colonne');
    } else if (d.comptes && d.comptes.melange !== undefined) refuser('prix mélangés : un compte sans colonne');
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
    const acc = { refusees: 0, motifs: {} }, ids = version.identifiants();
    rejugerPlage(version, ids, 0, ids.length, acc);
    return { ok: acc.refusees === 0, refusees: acc.refusees, motifs: acc.motifs };
}
/** Le geste unique : lireEntree (la validation d'entrée de visuels.js, PAS une copie) sur les rangs [de, a) — partagé par la version synchrone et la version par paquets. */
function rejugerPlage(version, ids, de, a, acc) {
    for (let i = de; i < a; i++) { const r = lireEntree(version.entree(ids[i])); if (!r.ok) { acc.refusees++; acc.motifs[r.motif] = (acc.motifs[r.motif] || 0) + 1; } }
}
const PAQUET_REJUGEMENT = 4000;
const cederLaBoucle = () => new Promise(ok => setImmediate(ok));
/**
 * Le même rejugement, qui rend la main à la boucle d'événements tous les PAQUET_REJUGEMENT entrées (mesuré : 67 590 entrées bloquaient la boucle ~200 ms d'un coup ; la requête qui réveille
 * l'instance attendait en plus). Même verdict que rejugerEntrees. `rendre` est injectable (les bancs comptent les reprises).
 */
async function rejugerEntreesParPaquets(version, { taille = PAQUET_REJUGEMENT, rendre = cederLaBoucle } = {}) {
    const acc = { refusees: 0, motifs: {} }, ids = version.identifiants();
    for (let de = 0; de < ids.length; de += taille) {
        rejugerPlage(version, ids, de, Math.min(de + taille, ids.length), acc);
        if (de + taille < ids.length) await rendre();
    }
    return { ok: acc.refusees === 0, refusees: acc.refusees, motifs: acc.motifs };
}

module.exports = { creerConstructeur, depuisPaquet, verifierStructure, rejugerEntrees, rejugerEntreesParPaquets, PAQUET_REJUGEMENT, StructureInvalide };
