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
const { verifierComptes: verifierComptesExclusions } = require('./exclusions');         // ARCHIVE-EXCLUSIONS : UNE définition des compteurs d'exclusion, pour l'écriture et la lecture

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
// MARQUE-EMPRUNT (format 3) — la COLONNE DES EMPRUNTS : la liste TRIÉE des idProduct qui ONT une entrée d'archive et dont le visuel est EMPRUNTÉ à un autre tirage (la décision `choisirVisuel` : 'autre-tirage', ou un substitut d'un autre
// set). Elle vient de la décision, jamais du texte de la mention. « Aucun emprunt » s'écrit par une colonne VIDE ; une archive d'avant n'a pas la colonne : empruntDe rend null (inconnu), jamais false.
const EMP_COLS = Object.freeze(['produits']);
// ARCHIVE-4 (format 4) — la COLONNE DES MARQUEURS ÉCRITS : ce que le catalogue a écrit dans cartes_produits.marqueurs, validé par la table du contrat (marqueurs.js) et accompagné de sa preuve. Une valeur par ligne
// de visuel (alignée sur cols.id) pour les bornes et la preuve ; les éléments sont à plat (un type et ses params, en JSON canonique, dans la réserve de textes). « Aucun marqueur écrit » s'écrit par une colonne
// VIDE (bornes égales) ; une archive d'avant n'a pas la colonne : entree().marqueurs vaut null, jamais « aucun ».
//   deb, fin  les bornes des éléments de la ligne dans type/params ; preuve  l'indice du texte de la preuve (-1 = aucun marqueur) ; type, params  les indices de texte de chaque élément.
const ECR_COLS = Object.freeze(['deb', 'fin', 'preuve', 'type', 'params']);
const MQ = require('../identifier/marqueurs');
const memeElements = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Les comptes des marqueurs écrits, calculés sur les colonnes (le constructeur les écrit, la structure les revérifie) : { entrees, elements, parType } — parType dans l'ORDRE de la table. */
function compterEcrits(ecr, lireTexte) {
    const n = ecr.deb.length, parTexte = new Map();
    let entrees = 0;
    for (let i = 0; i < n; i++) {
        if (ecr.fin[i] > ecr.deb[i]) entrees++;
        for (let k = ecr.deb[i]; k < ecr.fin[i]; k++) { const t = lireTexte(ecr.type[k]); parTexte.set(t, (parTexte.get(t) || 0) + 1); }
    }
    const parType = {};
    for (const t of MQ.NOMS_TYPES) if (parTexte.has(t)) parType[t] = parTexte.get(t);
    return { entrees, elements: ecr.type.length, parType };
}
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
    const { cols, texte, liens, meta, fiches, comptes, chargeLe, jum, mar, mel, emp, ecr } = d;
    const ids = cols.id;
    const octets = { colonnes: 0, chaines: texte.octets.byteLength + liens.octets.byteLength + texte.off.byteLength + liens.off.byteLength };
    for (const k of [...Object.values(cols), meta.cle, meta.produit, fiches.carte, fiches.num, fiches.debut, fiches.fin, fiches.produits, ...(jum ? JUM_COLS.map(k => jum[k]) : []), ...(mar ? MAR_COLS.map(k => mar[k]) : []), ...(mel ? MEL_COLS.map(k => mel[k]) : []), ...(emp ? EMP_COLS.map(k => emp[k]) : []), ...(ecr ? ECR_COLS.map(k => ecr[k]) : [])]) octets.colonnes += k.byteLength;
    octets.total = octets.colonnes + octets.chaines;
    const parSet = new Map(fiches.sets);                                        // slug → [premier, dernier+1] dans les colonnes de fiches
    const marquagesDe = r => {                                                  // les cinq champs d'une ligne ; null partout sans colonne (le même jeu de clés dans les deux cas)
        if (!mar) return { partageeHoloNonHolo: null, partageeTamponNonSepare: null, produitsPartages: null, tamponNonRepresente: null, basseDefinition: null };
        const f = mar.flags[r];
        return { partageeHoloNonHolo: boolDeCode(champDe(f, 0)), partageeTamponNonSepare: boolDeCode(champDe(f, 2)),
            produitsPartages: mar.pfin[r] > mar.pdeb[r] ? Array.from(mar.produits.subarray(mar.pdeb[r], mar.pfin[r])) : null,
            tamponNonRepresente: lire(texte, mar.tampon[r]), basseDefinition: boolDeCode(champDe(f, 4)) };
    };
    // ARCHIVE-4 : les marqueurs ÉCRITS d'une ligne ({ type, params } et leur preuve), ou null/null (aucun, ou archive d'avant la colonne)
    const ecritsDe = r => {
        if (!ecr || ecr.fin[r] <= ecr.deb[r]) return { marqueurs: null, marqueursPreuve: null };
        const liste = [];
        for (let k = ecr.deb[r]; k < ecr.fin[r]; k++) liste.push({ type: lire(texte, ecr.type[k]), params: JSON.parse(lire(texte, ecr.params[k])) });
        return { marqueurs: liste, marqueursPreuve: lire(texte, ecr.preuve[r]) };
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
    // PERF-SCAN P2 — le PARTAGE DE FICHIERS entre métacartes, lu sur les COLONNES (SUR-PAR-IMAGE, sur-par-image-route.js::signauxDe). Avant : un index fichier → [[id, métacarte]] bâti au premier scan par
    // 67 000 reconstructions d'entrée et 134 000 petits tableaux (+27,6 Mo vivants). Maintenant : seuls les fichiers portés par PLUSIEURS produits sont gardés, en rangs de colonne (Int32Array de quelques ko).
    // L'identité d'un fichier est celle de ses OCTETS, pas de son indice dans la réserve : une réserve qui porterait deux fois la même chaîne (un fichier étranger au constructeur, qui déduplique) ne cache aucun partage.
    // Construit une fois, à la demande (la version est gelée) ; la table transitoire (un nombre par fichier distinct) est libérée à la sortie.
    let fichiersPartages = null;
    const construireFichiersPartages = () => {
        const nTexte = texte.off.length - 1, n = ids.length;
        const canon = new Int32Array(nTexte).fill(-1);                                // indice de chaîne → indice de la première chaîne aux mêmes octets (−1 : pas un fichier utilisé)
        const octetsEgaux = (a, b) => {
            const da = texte.off[a], db = texte.off[b], la = texte.off[a + 1] - da;
            if (la !== texte.off[b + 1] - db) return false;
            for (let k = 0; k < la; k++) if (texte.octets[da + k] !== texte.octets[db + k]) return false;
            return true;
        };
        const parHachage = new Map();                                                // hachage 53 bits → indice (ou liste d'indices, en cas de collision réelle)
        const empreinte = i => {
            let h1 = 0x811c9dc5, h2 = 5381;
            for (let k = texte.off[i], f = texte.off[i + 1]; k < f; k++) { const o = texte.octets[k]; h1 = Math.imul(h1 ^ o, 16777619); h2 = (Math.imul(h2, 33) + o) | 0; }
            return (h1 >>> 0) * 2097152 + ((h2 >>> 0) & 0x1fffff);
        };
        const reconnaitre = i => {                                                   // l'indice canonique de la chaîne i (−1 : chaîne vide ou absente, qui n'est pas un fichier : « if (!f) continue » d'avant)
            if (i < 0 || texte.off[i + 1] === texte.off[i]) return -1;
            if (canon[i] >= 0) return canon[i];
            const h = empreinte(i), vu = parHachage.get(h);
            let c = i;
            if (vu === undefined) parHachage.set(h, i);
            else if (typeof vu === 'number') { if (octetsEgaux(vu, i)) c = vu; else parHachage.set(h, [vu, i]); }
            else { const t = vu.find(j => octetsEgaux(j, i)); if (t !== undefined) c = t; else vu.push(i); }
            canon[i] = c;
            return c;
        };
        const nb = new Int32Array(nTexte);                                           // nombre de produits DISTINCTS par fichier canonique
        const fichiersDuRang = new Int32Array(2 * n);
        for (let r = 0; r < n; r++) {
            const a = reconnaitre(cols.vig[r]), b = reconnaitre(cols.gra[r]);
            fichiersDuRang[2 * r] = a; fichiersDuRang[2 * r + 1] = b;
            if (a >= 0) nb[a]++;
            if (b >= 0 && b !== a) nb[b]++;
        }
        const partages = new Map();                                                  // fichier canonique → les rangs qui le portent, en ordre croissant (l'ordre d'insertion d'avant)
        for (let r = 0; r < n; r++) {
            const a = fichiersDuRang[2 * r], b = fichiersDuRang[2 * r + 1];
            for (const c of (b >= 0 && b !== a ? [a, b] : [a])) {
                if (c < 0 || nb[c] < 2) continue;
                const l = partages.get(c); if (l) l.push(r); else partages.set(c, [r]);
            }
        }
        return { partages, fichiersDuRang };
    };
    const V = {
        chargeLe, comptes, octets,
        /** Les identifiants de produit, triés (une vue de la colonne : à ne pas modifier). */
        identifiants: () => ids,
        /**
         * PERF-SCAN P2 — un AUTRE produit de l'archive porte-t-il le même fichier (vignette ou grande) avec une AUTRE métacarte ? true : oui, une autre carte est un autre dessin ; false : aucun produit à métacarte connue
         * ne diffère ; null : on ne peut pas conclure (une métacarte inconnue d'un côté ou de l'autre, tant qu'aucun partage prouvé n'existe). null aussi pour un produit sans entrée.
         * Le MÊME verdict que la boucle d'avant (index fichier → [[id, métacarte]], parcours dans l'ordre des identifiants) — prouvé produit par produit sur l'archive entière (v2/mesures/rejouer-identite-perf-scan.js).
         */
        partageAutreDessin(id) {
            if (!Number.isInteger(id)) return null;
            const r = chercher(ids, id);
            if (r < 0) return null;
            if (!fichiersPartages) fichiersPartages = construireFichiersPartages();
            const mc = cols.meta[r] < 0 ? null : cols.meta[r];
            let partage = false;
            const { partages, fichiersDuRang } = fichiersPartages;
            const a = fichiersDuRang[2 * r], b = fichiersDuRang[2 * r + 1];
            for (const c of (b >= 0 && b !== a ? [a, b] : [a])) {
                const l = c >= 0 ? partages.get(c) : undefined;
                if (!l) continue;
                for (const rk of l) {
                    if (rk === r) continue;
                    const autre = cols.meta[rk] < 0 ? null : cols.meta[rk];
                    if (mc === null || autre === null) { if (partage === false) partage = null; }
                    else if (autre !== mc) { partage = true; break; }
                }
                if (partage === true) break;
            }
            return partage;
        },
        entree(id) {
            if (!Number.isInteger(id)) return null;
            const r = chercher(ids, id);
            if (r < 0) return null;
            const g = cols.gra[r], l = cols.lien[r];
            return { idProduct: id, vignette: { cle: lire(texte, cols.vig[r]), w: cols.vw[r], h: cols.vh[r] },
                grande: g < 0 ? null : { cle: lire(texte, g), w: cols.gw[r], h: cols.gh[r] }, mention: lire(texte, cols.men[r]),
                idMetacard: cols.meta[r] < 0 ? null : cols.meta[r], numero: lire(texte, cols.num[r]), rarete: lire(texte, cols.rar[r]), total: lire(texte, cols.tot[r]),
                variante: lire(texte, cols.variante[r]), setNom: lire(texte, cols.set[r]), lien: l < 0 ? null : liens.prefixe + lire(liens, l), ...marquagesDe(r), ...ecritsDe(r) };
        },
        /** ARCHIVE-4 : la colonne des marqueurs écrits est-elle chargée ? (une archive d'avant le format 4 : non — entree().marqueurs vaut alors null, « on ne sait pas ».) */
        colonneEcrits: Boolean(ecr),
        /** La colonne des marquages est-elle chargée ? (une archive d'avant : non — aucun partage ne peut alors être conclu.) */
        colonneMarquages: Boolean(mar),
        /** La colonne des prix mélangés est-elle chargée ? (une archive d'avant : non — rien ne peut alors être conclu.) */
        colonneMelange: Boolean(mel),
        /** MARQUE-EMPRUNT : la colonne des emprunts est-elle chargée ? (une archive d'avant le format 3 : non — aucun emprunt ne peut alors être exclu.) */
        colonneEmprunts: Boolean(emp),
        /**
         * Le visuel de ce produit est-il EMPRUNTÉ à un autre tirage (la décision `choisirVisuel`) ? true / false d'après la colonne pour un produit qui a une entrée ;
         * null sans colonne (archive d'avant), pour un produit SANS entrée (aucun visuel servi) ou pour un identifiant non entier : on ne sait pas — jamais « non emprunté » en silence. Les règles d'image lisent null comme emprunté (identifier/emprunt.js).
         */
        empruntDe(id) {
            if (!emp || !Number.isInteger(id) || chercher(ids, id) < 0) return null;       // pas de colonne, ou produit SANS entrée (aucun visuel servi) : inconnu
            return chercher(emp.produits, id) >= 0;
        },
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
            const tous = [...Object.values(cols), meta.cle, meta.produit, fiches.carte, fiches.num, fiches.debut, fiches.fin, fiches.produits, texte.off, texte.octets, liens.off, liens.octets, ...(jum ? JUM_COLS.map(k => jum[k]) : []), ...(mar ? MAR_COLS.map(k => mar[k]) : []), ...(mel ? MEL_COLS.map(k => mel[k]) : []), ...(emp ? EMP_COLS.map(k => emp[k]) : []), ...(ecr ? ECR_COLS.map(k => ecr[k]) : [])];
            return { donnees: { cols, texte, liens, meta, fiches: { ...fiches, sets: [...parSet] }, comptes, chargeLe, ...(jum ? { jum } : {}), ...(mar ? { mar } : {}), ...(mel ? { mel } : {}), ...(emp ? { emp } : {}), ...(ecr ? { ecr } : {}) }, tampons: [...new Set(tous.map(t => t.buffer))] };
        }
    };
    return Object.freeze(V);
}

const unionBool = (a, b) => (a === true || b === true ? true : a === false || b === false ? false : null);
const AVEC_MARQUES = d => d.partageeHoloNonHolo !== null || d.partageeTamponNonSepare !== null || d.produitsPartages !== null || d.tamponNonRepresente !== null || d.basseDefinition !== null;
/** @param opts.marquages  vrai : le constructeur écrit la colonne des marquages (format 2). Faux (défaut) : une entrée qui porte un marquage LÈVE — jamais perdu en silence. */
function creerConstructeur({ marquages = false, emprunts = false, ecrits = false } = {}) {
    const c = {}; for (const k of COLS) c[k] = colonne();
    const ecritsParRang = [];                                                        // ARCHIVE-4 : par rang { marqueurs, preuve } ou null — seulement si `ecrits`
    const ecritsAbandonnes = new Set();                                              // les rangs dont les marqueurs écrits se contredisent
    let ecritsContradictoires = 0;                                                 // deux entrées du MÊME produit au même visuel dont les marqueurs écrits diffèrent : aucun marqueur écrit pour lui
    const marques = [];                                                              // par rang : { holo, tampon, basse, tn (indice de texte), liste } — seulement si `marquages`
    const texte = reserve(), liensR = reserve();
    const fSet = [], fCarte = colonne(), fNum = colonne(), fDebut = colonne(), fFin = colonne(), prods = colonne();
    const motifs = {}; let lues = 0, refusees = 0, doublons = 0;
    const rang = new Map();                                                          // idProduct → rang dans les colonnes : un produit n'a qu'UNE entrée
    const contradictoires = new Set();                                               // idProduct dont deux entrées portent des visuels DIFFÉRENTS : aucun visuel n'est servi pour eux
    const VISUEL = [1, 2, 3, 4, 5, 6].map(i => COLS[i]);                             // vig, vw, vh, gra, gw, gh : ce qui est AFFICHÉ (le reste de l'entrée n'est pas un visuel)
    const jumeaux = new Map();                                                       // idProduct → { meta, exp, num, tir } (-1 = inconnu) : UNE ligne par produit du catalogue
    const melanges = new Set();                                                      // LOT TAMPONS (B) : les idProduct marqués prixMelangeTampon (indépendants de tout visuel)
    const empruntes = new Set();                                                     // MARQUE-EMPRUNT : les idProduct dont le visuel est emprunté (seuls ceux qui ont une entrée gardée entrent dans la colonne)
    let exclusions = null;                                                           // ARCHIVE-EXCLUSIONS : { exclus, exclusParMotif } posés par calculer ; null = aucune liste (aucun champ dans les comptes)
    return {
        /** ARCHIVE-EXCLUSIONS : les compteurs de l'exclusion, écrits dans les comptes de la version. Jugés ici par la définition du format (exclusions.js) : des compteurs incohérents ne s'écrivent pas. */
        exclusions(x) {
            const refus = verifierComptesExclusions(x);
            if (refus || !x || x.exclus === undefined) throw new Error(refus || 'exclusions : compteurs absents');
            exclusions = { exclus: x.exclus, exclusParMotif: { ...x.exclusParMotif }, partagesPerdus: x.partagesPerdus };
        },
        /**
         * ARCHIVE-EXCLUSIONS (tour 1, C1) : « une exclusion retire un VISUEL, jamais une marque qui empêche d'affirmer un AUTRE produit ». Le partenaire de partage `idX` d'un produit `idN` (calculé sur l'ensemble
         * COMPLET) vient d'être exclu : il n'a plus d'entrée, donc la paire séparée par la variante (reconstruite depuis les ENTRÉES des deux produits) ne le nomme plus. `idN` le garde en l'inscrivant dans sa propre
         * liste de partage (forme déjà valide : 2 à 6 identifiants, contient le produit) : `partagesDe(idN)` le retrouve par la voie des listes. Possible seulement si l'entrée de `idN` porte déjà un marquage de
         * partage (la structure refuse une liste sans drapeau) et si la liste tient dans la borne ; sinon FAUX, et la comparaison des marques (exclusions.js) le comptera : la construction refuse.
         */
        partageAvec(idN, idX) {
            if (!marquages) throw new Error('constructeur sans colonne de marquages : un partage ne peut pas être conservé (jamais perdu en silence)');
            const r = rang.get(idN);            if (r === undefined || contradictoires.has(idN) || !Number.isInteger(idX) || idX <= 0 || idX === idN) return false;
            const m = marques[r];
            if (!(m.holo === true || m.tampon !== null)) return false;
            const liste = [...new Set([...(m.liste || [idN]), idX])].sort((a, b) => a - b);
            if (liste.length > PARTAGES_MAX) return false;
            marques[r] = { ...m, liste };
            return true;
        },
        /**
         * MARQUE-EMPRUNT : le visuel de ce produit est emprunté à un autre tirage (décision `choisirVisuel`). Seulement avec l'option `emprunts` (format 3). Un produit sans entrée gardée (refusée, exclue,
         * doublon contradictoire) n'entre pas dans la colonne : la marque suit le VISUEL servi. Deux appels pour le même produit : une seule marque.
         */
        emprunt(idProduct) {
            if (!emprunts) throw new Error('constructeur sans colonne des emprunts : un emprunt ne peut pas être écrit (jamais perdu en silence)');
            if (!Number.isInteger(idProduct) || idProduct <= 0) throw new Error('emprunt : idProduct entier positif attendu');
            empruntes.add(idProduct);
        },
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
        etat: () => ({ lues, admises: c.id.n - contradictoires.size, refusees, doublons, doublonsContradictoires: contradictoires.size, motifs, fiches: fSet.length, ecritsContradictoires }),
        entree(e) {
            lues++;
            const r = lireEntree(e);                                                // la validation d'entrée s'applique à CHAQUE entrée chargée
            if (!r.ok) { refusees++; motifs[r.motif] = (motifs[r.motif] || 0) + 1; return false; }
            const d = r.doc;
            if (!marquages && AVEC_MARQUES(d)) throw new Error('constructeur sans colonne de marquages : une entrée porte un marquage (jamais perdu en silence)');
            if (!ecrits && d.marqueurs !== null) throw new Error('constructeur sans colonne des marqueurs écrits : une entrée porte des marqueurs (jamais perdu en silence)');
            const ec = d.marqueurs === null ? null : { marqueurs: d.marqueurs, preuve: d.marqueursPreuve };
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
                if (ecrits) {                                                       // les marqueurs écrits ne s'additionnent pas : identiques -> gardés ; différents -> AUCUN (jamais « le dernier gagne »), compté
                    const p = ecritsParRang[r0];
                    if (ecritsAbandonnes.has(r0)) { /* déjà contradictoire : rien ne revient */ }
                    else if (!memeElements(p && p.marqueurs, ec && ec.marqueurs)) { ecritsContradictoires++; ecritsAbandonnes.add(r0); ecritsParRang[r0] = null; }
                }
                return true;
            }
            rang.set(d.idProduct, c.id.n);
            if (ecrits) ecritsParRang[c.id.n] = ec;
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
            // la colonne des marqueurs écrits (ARCHIVE-4), réécrite dans l'ordre trié ; ses textes entrent dans la réserve AVANT son encodage ; écrite même vide (« aucun » est une réponse)
            let ecr;
            if (ecrits) {
                const deb = new Int32Array(n), fin = new Int32Array(n), preuve = new Int32Array(n), types = [], params = [];
                for (let i = 0; i < n; i++) {
                    const x = ecritsParRang[ordre[i]];
                    deb[i] = types.length;
                    if (x) { preuve[i] = texte.id(x.preuve); for (const el of x.marqueurs) { types.push(texte.id(el.type)); params.push(texte.id(JSON.stringify(el.params))); } } else preuve[i] = -1;
                    fin[i] = types.length;
                }
                ecr = { deb, fin, preuve, type: Int32Array.from(types), params: Int32Array.from(params) };
            }
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
            // la colonne des emprunts : les produits marqués QUI ONT une entrée gardée (cols.id est trié), triés ; écrite même vide (« aucun » est une réponse)
            const emp = emprunts ? { produits: Int32Array.from([...empruntes].filter(p => chercher(cols.id, p) >= 0).sort((a, b) => a - b)) } : undefined;
            const comptes = Object.freeze({ lues, visuels: n, refusees, doublons, doublonsContradictoires: contradictoires.size, motifs, setsAvecLiens: groupes.size, fichesLiees: m, produitsLies: fiches.produits.length, ...(jumeaux.size ? { jumeaux: jumeaux.size } : {}), ...(mar ? { marquees: compterMarquees(mar) } : {}), ...(mel ? { melange: mel.produits.length } : {}), ...(emp ? { emprunts: emp.produits.length } : {}), ...(ecr ? { ecrits: compterEcrits(ecr, i => texte.liste[i]) } : {}), ...(exclusions ? { exclus: exclusions.exclus, exclusParMotif: exclusions.exclusParMotif, partagesPerdus: exclusions.partagesPerdus } : {}) });
            // la colonne des jumeaux : paires (métacarte, produit) triées, plus la permutation triée par produit (recherche d'un produit seul)
            let jum;
            if (jumeaux.size) {
                const lignes = [...jumeaux].map(([id, p]) => ({ id, ...p })).sort((a, b) => a.meta - b.meta || a.id - b.id), k2 = lignes.length;
                jum = { meta: new Int32Array(k2), id: new Int32Array(k2), exp: new Int32Array(k2), num: new Int32Array(k2), tir: new Int32Array(k2), ordre: new Int32Array(k2) };
                lignes.forEach((l, i) => { jum.meta[i] = l.meta; jum.id[i] = l.id; jum.exp[i] = l.exp; jum.num[i] = l.num; jum.tir[i] = l.tir; jum.ordre[i] = i; });
                jum.ordre.sort((a, b) => jum.id[a] - jum.id[b]);
            }
            return assembler({ cols, texte: t, liens, meta, fiches, comptes, chargeLe, jum, mar, mel, emp, ecr });
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
    if (d.emp !== undefined) {                                                  // MARQUE-EMPRUNT : la colonne des emprunts (facultative : une archive d'avant n'en a pas) : triée, stricte, positive, chaque produit a une entrée, comptée
        const x = d.emp;
        if (!x || typeof x !== 'object' || !(x.produits instanceof Int32Array)) refuser('emprunts : colonne illisible');
        for (let i = 0; i < x.produits.length; i++) {
            if (x.produits[i] <= 0 || (i > 0 && x.produits[i] <= x.produits[i - 1])) refuser('emprunts : identifiants non strictement croissants ou non positifs');
            if (chercher(d.cols.id, x.produits[i]) < 0) refuser('emprunts : un produit marqué n\'a pas d\'entrée dans l\'archive');
        }
        if (!d.comptes || d.comptes.emprunts !== x.produits.length) refuser('emprunts : compte de l\'en-tête différent de celui de la colonne');
    } else if (d.comptes && d.comptes.emprunts !== undefined) refuser('emprunts : un compte sans colonne');
    if (d.ecr !== undefined) {                                                  // ARCHIVE-4 : la colonne des marqueurs écrits (format 4) : bornes contiguës, textes dans la réserve, chaque élément ACCEPTÉ PAR LA TABLE du contrat, forme canonique, comptée
        const x = d.ecr;
        if (!x || typeof x !== 'object') refuser('marqueurs écrits : colonne illisible');
        for (const nom of ECR_COLS) if (!(x[nom] instanceof Int32Array)) refuser(`marqueurs écrits : colonne « ${nom} » absente ou mal typée`);
        for (const nom of ['deb', 'fin', 'preuve']) if (x[nom].length !== n) refuser(`marqueurs écrits : colonne « ${nom} » de longueur différente de celle des entrées`);
        const k = x.type.length;
        if (x.params.length !== k) refuser('marqueurs écrits : colonnes « type » et « params » de longueur différente');
        const texteDe = i => lire(d.texte, i), jugés = new Map();
        let curseur = 0;
        for (let i = 0; i < n; i++) {
            if (x.deb[i] !== curseur || x.fin[i] < x.deb[i] || x.fin[i] > k) refuser('marqueurs écrits : bornes des éléments hors de la liste ou non contiguës');
            const taille = x.fin[i] - x.deb[i];
            curseur = x.fin[i];
            if (taille === 0) { if (x.preuve[i] !== -1) refuser('marqueurs écrits : une preuve sans marqueurs'); continue; }
            if (taille > MQ.MARQUEURS_MAX) refuser(`marqueurs écrits : plus de ${MQ.MARQUEURS_MAX} éléments pour une ligne`);
            if (x.preuve[i] < 0 || x.preuve[i] >= nT) refuser('marqueurs écrits : indice de preuve hors de la réserve');
            const preuve = texteDe(x.preuve[i]);
            if (!preuve.trim() || preuve.trim() !== preuve || preuve.length > MQ.PREUVE_MAX) refuser('marqueurs écrits : une preuve (phrase non vide, bornée) est exigée');
            let rang = -1;
            for (let j = x.deb[i]; j < x.fin[i]; j++) {
                if (x.type[j] < 0 || x.type[j] >= nT || x.params[j] < 0 || x.params[j] >= nT) refuser('marqueurs écrits : indice de texte hors de la réserve');
                const cle = `${x.type[j]}|${x.params[j]}`;
                let v = jugés.get(cle);
                if (v === undefined) {
                    let params; try { params = JSON.parse(texteDe(x.params[j])); } catch { params = undefined; }
                    const valide = params === undefined ? null : MQ.valider({ type: texteDe(x.type[j]), params });
                    v = valide && JSON.stringify(valide.params) === texteDe(x.params[j]) ? MQ.NOMS_TYPES.indexOf(valide.type) : null;
                    jugés.set(cle, v);
                }
                if (v === null) refuser('marqueurs écrits : un élément que la table refuse');
                if (v <= rang) refuser('marqueurs écrits : un type en double ou hors de l\'ordre de la table');
                rang = v;
            }
        }
        if (curseur !== k) refuser('marqueurs écrits : des éléments hors de toute ligne');
        const calc = compterEcrits(x, texteDe), dit = d.comptes && d.comptes.ecrits;
        if (!dit || typeof dit !== 'object' || JSON.stringify(dit) !== JSON.stringify(calc)) refuser('marqueurs écrits : compte de l\'en-tête différent de celui de la colonne');
    } else if (d.comptes && d.comptes.ecrits !== undefined) refuser('marqueurs écrits : un compte sans colonne');
    const refusExclusions = verifierComptesExclusions(d.comptes);               // ARCHIVE-EXCLUSIONS : les compteurs d'exclusion, absents ou cohérents (la définition est celle d'exclusions.js)
    if (refusExclusions) refuser(refusExclusions);
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
