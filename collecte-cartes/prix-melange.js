// ============================================================
// PRIX-MELANGE (2026-10-17) — LES FICHES CARDMARKET DONT LE PRIX MÉLANGE LA VERSION NORMALE ET UNE VERSION TAMPONNÉE
// ============================================================
// 🔑 LA DEMANDE DU TESTEUR : « Certaines promos existent en version Staff ou Prerelease, mais Cardmarket ne leur donne PAS de fiche séparée. Les vendeurs le précisent seulement dans leurs notes
// (« STAFF Promo Stamp Version » à 49,99 €…). Le guide des prix de ces fiches mélange donc les versions normales et tamponnées. » On repère ces fiches DEPUIS NOS SEULES SOURCES DE DONNÉES
// (aucune requête) et on pose sur leur ligne `cartes_produits` : `prixMelangeTampon: true`, `tamponsConnus: [...]`, `prixMelangeTamponPreuve: [...]`.
//
// ÉCRIT PAR CE QU'IL AUTORISE : une fiche n'est marquée que si TOUT est prouvé ; le reste est un SAUT NOMMÉ (jamais un silence) :
//   · la source nomme un tampon de la LISTE FERMÉE (staff, prerelease, staff-prerelease, play-pokemon, league) — un autre mot (set-logo, 1st-edition, un nom de joueur…) n'est jamais un tampon ici ;
//   · UN SEUL produit existe pour la carte chez Cardmarket (export : même expansion, même métacarte, sauf un produit frère dont le numéro connu diffère — une réimpression au numéro d'à côté) ;
//   · la fiche n'est pas déjà séparée (`variante` posée) ni l'une des 64 paires Black Star (autre lot) ;
//   · le NOM de la source est celui du produit Cardmarket (témoin indépendant du numéro) ; le rattachement par set + numéro (+ total imprimé) ne désigne qu'UN produit.
// Un tampon d'une variante qui a SON PROPRE produit chez Cardmarket (présent à l'export) n'est jamais attribué à la fiche de base : il ne mélange rien.
// Les Prize Packs : le scan tamponné « Play! Pokémon » y est un produit à part (autre expansion) — il ne mélange pas le prix de la carte d'origine : écarté, nommé.
// Sources LUES : le clone TCGdex local (variants.stamp, lu SANS évaluation) et l'index Pokumon en cache. PTCG-database (type-null) et les sitemaps pkmncards ne portent AUCUN champ de tampon (mesuré).
const fs = require('fs');
const path = require('path');
const { cleNumero, normaliserNom, decomposerNomCardmarket } = require('./jointure');
const V = require('./variantes-tcgdex');

// 'championship' et 'autre' (décision du testeur, relevé du 2026-10-18, DEMANDE-API-VISUELS.md « ~21:15 UTC ») : 'autre' n'est admis QUE pour une ligne du relevé où le testeur a vu un tampon sans le nommer —
// un fait constaté, pas une marque. Aucun autre lecteur n'en produit.
const TAMPONS_FERMES = Object.freeze(['staff', 'prerelease', 'staff-prerelease', 'play-pokemon', 'league', 'championship', 'autre']);
/** La colonne `stamp` du relevé du testeur -> jetons de `tamponsConnus`. Table FERMÉE : un autre libellé est écarté, nommé, jamais deviné. */
const TAMPONS_RELEVE = Object.freeze({ 'Staff': ['staff'], 'Prerelease': ['prerelease'], 'Staff + Prerelease': ['staff', 'prerelease'], 'League': ['league'], 'Championship': ['championship'],
    'Staff + Championship': ['staff', 'championship'], 'Staff + Autre': ['staff', 'autre'], 'Autre': ['autre'] });
const LIBELLE_RELEVE = 'relevé du testeur, 2026-10-18';
const CHAMPS = Object.freeze(['prixMelangeTampon', 'tamponsConnus', 'prixMelangeTamponPreuve']);
// Les promos Black Star que Pokumon numérote avec un préfixe (« SWSH036 », « SVP115 ») : le set Cardmarket est celui de la table (mesuré sur cartes_produits).
const PROMO_PAR_PREFIXE = Object.freeze({ SWSH: 'SWSH-Black-Star-Promos', SVP: 'SV-Black-Star-Promos', MEP: 'MEP-Black-Star-Promos', SM: 'SM-Black-Star-Promos', XY: 'XY-Black-Star-Promos', BW: 'BW-Black-Star-Promos', DP: 'DP-Black-Star-Promos', HGSS: 'HGSS-Black-Star-Promos' });

/** Les tampons de la liste fermée que nomme UNE liste de `stamp` TCGdex (une variante). Staff et pre-release ensemble : « staff-prerelease ». */
function tamponsDesStamps(stamps) {
    const s = (Array.isArray(stamps) ? stamps : []).map(x => String(x).toLowerCase());
    const staff = s.includes('staff'), pre = s.some(x => x === 'pre-release' || x === 'prerelease');
    const league = s.some(x => /(^|-)league$/.test(x)), play = s.some(x => /^play-?pokemon/.test(x));
    const out = [];
    if (staff && pre) out.push('staff-prerelease'); else if (staff) out.push('staff'); else if (pre) out.push('prerelease');
    if (play) out.push('play-pokemon');
    if (league) out.push('league');
    return out;
}

/**
 * Les tampons d'une carte TCGdex qui MÉLANGENT le prix de la fiche de base : ceux des variantes SANS produit propre (ou dont le produit propre n'est pas à l'export).
 * @returns {{tampons: string[], hors: object, avecProduitPropre: number}}
 */
function tamponsDeCarteTcgdex(variantes, idsExport) {
    const tampons = new Set(), hors = {}; let propres = 0;
    for (const v of variantes || []) {
        if (!v?.stamp?.length) continue;
        if (v.cardmarket != null && idsExport.has(v.cardmarket)) { propres++; continue; }
        const t = tamponsDesStamps(v.stamp);
        for (const x of t) tampons.add(x);
        if (!t.length) for (const x of v.stamp) hors[x] = (hors[x] || 0) + 1;
    }
    return { tampons: [...tampons].sort(), hors, avecProduitPropre: propres };
}

const PREFIXE_STAFF = /^(?:[A-Za-z' ]*Championships\s+)?Staff\s+\S/i;
/** Les tampons que dit une entrée Pokumon (nom, titre, set d'événement). `motif` quand l'entrée est écartée pour une raison nommée. */
function tamponsPokumon(e) {
    const nom = String(e?.nom ?? ''), set = String(e?.set ?? '');
    if (/prize pack/i.test(set)) return { tampons: [], motif: 'prize-pack-produit-distinct' };
    if (/\bjumbo\b/i.test(nom)) return { tampons: [], motif: 'jumbo' };
    if (/^(first|second|third|fourth)\s+place\b|^winner\b/i.test(nom)) return { tampons: [], motif: 'place-de-league' };
    const staff = PREFIXE_STAFF.test(nom);
    const pre = /pre-?release/i.test(set) && !/\bkit\b|theme deck/i.test(set);
    const league = /\bpok[eé]mon league\b/i.test(set);
    const t = [];
    if (staff && pre) t.push('staff-prerelease'); else if (staff) t.push('staff'); else if (pre) t.push('prerelease');
    if (league) t.push('league');
    return { tampons: t };
}

const nomSansTampon = nom => {
    let n = String(nom ?? '').trim();
    n = n.replace(/^(?:[A-Za-z' ]*Championships\s+)?Staff\s+/i, '');
    for (let i = 0; i < 4; i++) n = n.replace(/^(?:non-?holo|holofoil|reverse holo|cosmos holofoil|starlight holofoil|cracked ice|pokemon league|stamped)\s+/i, '');
    return n.trim();
};

/**
 * Le relevé du testeur (CSV `annonce_vinted;idProduct;stamp;fiche_cardmarket_propre`, vérifié par lui carte en main) : un témoin par ligne « fiche propre = non » dont le `stamp` est dans TAMPONS_RELEVE.
 * Le témoin est l'idProduct du testeur ; la preuve est sa vérification. Les lignes « oui » ne sont pas des prix mélangés (la partie B les traite). Un stamp hors table est écarté et nommé.
 */
function temoinsReleve(texte) {
    const lignes = String(texte ?? '').split(/\r?\n/).filter(l => l.trim() !== '');
    const entete = (lignes[0] || '').trim().replace(/^﻿/, '');
    if (entete !== 'annonce_vinted;idProduct;stamp;fiche_cardmarket_propre') throw new Error(`relevé : entête inattendue « ${entete} » — le fichier n'est pas celui du testeur`);
    const temoins = [], ecartes = []; let non = 0;
    for (const l of lignes.slice(1)) {
        const c = l.split(';').map(x => x.trim().replace(/^"|"$/g, ''));
        const id = Number(c[1]), stamp = c[2], propre = c[3];
        if (!Number.isInteger(id) || c.length < 4) throw new Error(`relevé : ligne illisible « ${l.slice(0, 80)} »`);
        if (propre !== 'non') continue;
        non++;
        const tampons = TAMPONS_RELEVE[stamp];
        const base = { source: 'releve-testeur', enregistrement: `releve:${id}`, idProduct: id };
        if (!tampons) { ecartes.push({ ...base, motif: 'stamp-hors-table', stamp }); continue; }
        temoins.push({ ...base, nom: null, numero: null, tampons: [...tampons], libelle: `${LIBELLE_RELEVE} (idProduct ${id}, « ${stamp} »)` });
    }
    return { temoins, ecartes, lues: lignes.length - 1, non };
}

/** Les témoins Pokumon : une entrée anglaise qui nomme un tampon de la liste fermée. @returns {{temoins: object[], ecartes: object[]}} */
function temoinsPokumon(entrees) {
    const temoins = [], ecartes = [];
    for (const e of entrees || []) {
        const r = tamponsPokumon(e);
        const base = { source: 'pokumon', enregistrement: `pokumon:${e.id}` };
        if (r.motif) { ecartes.push({ ...base, motif: r.motif, nom: e.nom ?? null }); continue; }
        if (!r.tampons.length) continue;
        if (!e.anglais) { ecartes.push({ ...base, motif: 'pas-anglais', nom: e.nom ?? null }); continue; }
        const brut = String(e.numero ?? '').trim();
        const m = /^([A-Za-z]+)0*(\d+)$/.exec(brut), promo = m ? PROMO_PAR_PREFIXE[m[1].toUpperCase()] : null;
        const t = { ...base, nom: nomSansTampon(e.nom), tampons: r.tampons, total: e.total ?? null, idProduct: null };
        if (promo && e.total == null) { t.numero = String(parseInt(m[2], 10)); t.slugSets = [promo]; } else t.numero = brut;
        temoins.push(t);
    }
    return { temoins, ecartes };
}

/**
 * Le clone TCGdex local, lu SANS évaluation (variantes-tcgdex.js, la lecture de la production) : un témoin par carte dont une variante SANS produit propre porte un tampon de la liste fermée.
 * @param {string} dossierData …/cards-database/data  @param {Set<number>} idsExport les idProduct de l'export
 */
function lireTemoinsClone(dossierData, idsExport) {
    if (!fs.existsSync(dossierData) || !fs.statSync(dossierData).isDirectory()) throw new Error(`${dossierData} : le dossier du clone TCGdex n'existe pas`);
    const temoins = [], hors = {}; let nSets = 0, nCartes = 0, sansNom = 0, avecProduitPropre = 0;
    for (const serie of fs.readdirSync(dossierData)) {
        const ds = path.join(dossierData, serie);
        if (!fs.statSync(ds).isDirectory()) continue;
        for (const f of fs.readdirSync(ds)) {
            if (!f.endsWith('.ts')) continue;
            const src = fs.readFileSync(path.join(ds, f), 'utf8');
            const setId = /^\tid:\s*["']([^"']+)["']/m.exec(src)?.[1];
            if (!setId) continue;
            nSets++;
            const exp = /^\tthirdParty:\s*\{[^}]*?cardmarket:\s*(\d+)/m.exec(src)?.[1];
            const dc = path.join(ds, f.replace(/\.ts$/, ''));
            if (!fs.existsSync(dc)) continue;
            for (const g of fs.readdirSync(dc)) {
                if (!g.endsWith('.ts')) continue;
                const txt = fs.readFileSync(path.join(dc, g), 'utf8');
                let a;
                try { a = V.analyserCarte(txt); } catch (e) { throw new Error(`${path.join(serie, f.replace(/\.ts$/, ''), g)} : ${e.message}`); }
                nCartes++;
                const r = tamponsDeCarteTcgdex(a.variantes, idsExport);
                avecProduitPropre += r.avecProduitPropre;
                for (const [k, n] of Object.entries(r.hors)) hors[k] = (hors[k] || 0) + n;
                if (!r.tampons.length) continue;
                const mn = /^\tname:\s*\{([^}]*)\}/m.exec(txt);
                const en = mn && /\ben:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/.exec(mn[1]);
                const nom = en ? (en[1] ?? en[2]) : null;
                if (!nom) { sansNom++; continue; }
                temoins.push({ source: 'tcgdex-clone', enregistrement: `${serie}/${f.replace(/\.ts$/, '')}/${g}`, setId, setNom: f.replace(/\.ts$/, ''), nom, numero: g.replace(/\.ts$/, ''), total: null, tampons: r.tampons,
                    expansions: exp ? [Number(exp)] : null, idProduct: a.cardmarket });
            }
        }
    }
    if (!nSets || !nCartes) throw new Error(`${dossierData} : ${nSets} set(s) et ${nCartes} carte(s) lus — un zéro sur un clone non vide est une lecture fausse (mauvais dossier ?), pas un résultat`);
    return { temoins, nSets, nCartes, hors, sansNom, avecProduitPropre };
}

const chiffres = n => { const m = String(n ?? '').match(/\d+/); return m ? String(parseInt(m[0], 10)) : null; };
const triees = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

/**
 * LE PLAN : chaque témoin (une source qui nomme un tampon pour une carte) est rattaché à UN produit Cardmarket, ou SAUTÉ avec son motif. Rien n'est écrit.
 * @param {{temoins: object[], produits: Array<{idProduct, name, idExpansion, idMetacard}>, lignes: object[], exclus?: Set<number>, ecartes?: object[]}} o
 *   `produits` : l'export Cardmarket ; `lignes` : les lignes cartes_produits (lireLignes) ; `exclus` : les idProduct des 64 paires ; `ecartes` : les entrées déjà écartées par les lecteurs (reprises dans les sautés).
 */
function construirePlan({ temoins, produits, lignes, exclus = new Set(), ecartes = [] }) {
    const parId = new Map(produits.map(p => [p.idProduct, p]));
    const rangs = new Map();
    for (const l of lignes) (rangs.get(l.idProduct) || rangs.set(l.idProduct, []).get(l.idProduct)).push(l);
    const parMeta = new Map();
    for (const p of produits) { if (!p.idMetacard) continue; const k = `${p.idExpansion}|${p.idMetacard}`; (parMeta.get(k) || parMeta.set(k, []).get(k)).push(p); }
    const numerosDe = id => new Set((rangs.get(id) || []).map(l => l.numeroFiche ?? l.impNumero).filter(n => n != null && String(n).trim() !== '').map(n => cleNumero(n)));
    // « 121 » et « 121A » : même carte, même expansion, une lettre en plus = une VERSION qui a SON produit chez Cardmarket (l'impression spéciale), à côté de la fiche du numéro normal. Ce n'est pas une réimpression au numéro
    // d'à côté : la fiche « A » est propre (elle ne mélange pas la version normale, qui a la sienne) — et la fiche normale ne mélange pas non plus. Le frère reste un frère : on saute.
    const sansLettre = n => String(n).replace(/(\d)[A-Z]+$/, '$1');
    // le nom comparé : celui de Cardmarket sans ses crochets, sans la mention « Delta Species » que seule Cardmarket écrit à la suite du δ
    const comparable = s => normaliserNom(String(s ?? '').replace(/\s+delta species$/i, ''));
    const nomCm = p => comparable(decomposerNomCardmarket(p.name).nom);

    const sautes = ecartes.map(e => ({ ...e })), fiches = new Map(), sansLigne = new Map();
    const sauter = (t, motif, plus = {}) => sautes.push({ source: t.source, enregistrement: t.enregistrement, nom: t.nom, numero: t.numero, motif, ...plus });

    for (const t0 of temoins) {
        if (!t0.tampons?.length) continue;
        let t = t0, ids, mode;
        if (t.source === 'releve-testeur') {
            // Le testeur a désigné le produit et vérifié que sa fiche mélange les versions : ni le test des frères ni celui du nom ne s'appliquent (il n'y a pas de nom à comparer). Restent les gardes sur NOTRE ligne.
            const p = parId.get(t.idProduct), rows = rangs.get(t.idProduct) || [];
            if (!p) { sauter(t, 'produit-absent-de-l-export', { idProduct: t.idProduct }); continue; }
            if (exclus.has(t.idProduct)) { sauter(t, 'paire-black-star-exclue', { produits: [t.idProduct] }); continue; }
            if (!rows.length) { sauter(t, 'ligne-absente', { idProduct: t.idProduct }); continue; }
            if (rows.some(l => l.variante)) { sauter(t, 'deja-separee-par-variante', { idProduct: t.idProduct }); continue; }
            // déjà marquée par une AUTRE source : on n'y touche pas ; déjà marquée PAR LE RELEVÉ (sa phrase figure dans la preuve) : le plan la garde, `appliquer` la voit « déjà faite » (la revérification ne perd rien)
            if (rows.some(l => l.prixMelangeTampon === true && !(l.marquagePreuve || []).includes(t.libelle))) { sauter(t, 'deja-marquee', { idProduct: t.idProduct }); continue; }
            const preuve = { source: t.source, enregistrement: t.enregistrement, tampons: [...t.tampons].sort(), mode: 'releve-testeur', libelle: t.libelle };
            const f = fiches.get(p.idProduct) || fiches.set(p.idProduct, { idProduct: p.idProduct, nom: p.name, idExpansion: p.idExpansion, set: rows[0]?.slugSet ?? null, numero: rows[0]?.numeroFiche ?? rows[0]?.impNumero ?? null,
                rows: rows.map(l => l._id), tampons: new Set(), preuves: [] }).get(p.idProduct);
            for (const x of t.tampons) f.tampons.add(x);
            if (!f.preuves.some(q => q.source === preuve.source && q.enregistrement === preuve.enregistrement)) f.preuves.push(preuve);
            continue;
        }
        // un témoin du clone TCGdex dont le set n'a pas d'expansion Cardmarket : le NOM EXACT du set (dossier du clone), avec ses espaces en tirets, doit être un slugSet que nos lignes portent déjà
        if (!t.expansions?.length && !t.slugSets?.length && t.total == null && t.idProduct == null && t.setNom) {
            const sl = String(t.setNom).trim().replace(/\s+/g, '-');
            if (lignes.some(l => l.slugSet === sl)) t = { ...t, slugSets: [sl] };
        }
        if (t.idProduct != null) {
            const p = parId.get(t.idProduct);
            if (!p) { sauter(t, 'produit-absent-de-l-export', { idProduct: t.idProduct }); continue; }
            if (t.expansions?.length && !t.expansions.includes(p.idExpansion)) { sauter(t, 'expansion-differente', { idProduct: t.idProduct }); continue; }
            ids = [p.idProduct]; mode = 'idProduct';
        } else {
            if (!(t.expansions?.length || t.slugSets?.length || t.total != null)) { sauter(t, 'temoin-sans-ancrage'); continue; }
            const digits = !!t.slugSets?.length, kT = digits ? chiffres(t.numero) : cleNumero(t.numero);
            const rows = lignes.filter(l => {
                if (!parId.has(l.idProduct)) return false;
                if (t.expansions?.length && !t.expansions.includes(l.idExpansion)) return false;
                if (t.slugSets?.length && !t.slugSets.includes(l.slugSet)) return false;
                if (t.total != null && String(l.impTotal ?? '') !== String(t.total)) return false;
                const n = l.numeroFiche ?? l.impNumero;
                return n != null && kT != null && (digits ? chiffres(n) : cleNumero(n)) === kT;
            });
            ids = [...new Set(rows.map(l => l.idProduct))]; mode = 'set+numero+nom';
            if (!ids.length) { sauter(t, 'aucune-fiche'); continue; }
        }
        if (ids.some(id => exclus.has(id))) { sauter(t, 'paire-black-star-exclue', { produits: ids }); continue; }
        const nomT = comparable(t.nom);
        const bons = ids.filter(id => nomCm(parId.get(id)) === nomT);
        if (!bons.length) { sauter(t, 'nom-different', { produits: ids, nomCardmarket: parId.get(ids[0]).name }); continue; }
        if (bons.length > 1) { sauter(t, 'plusieurs-produits-pour-la-carte', { produits: bons }); continue; }
        const id = bons[0], p = parId.get(id), rows = rangs.get(id) || [];
        if (rows.some(l => l.variante)) { sauter(t, 'deja-separee-par-variante', { idProduct: id }); continue; }
        const numsP = numerosDe(id);
        const freres = (p.idMetacard ? parMeta.get(`${p.idExpansion}|${p.idMetacard}`) || [] : []).filter(q => q.idProduct !== id).filter(q => {
            const nq = numerosDe(q.idProduct);
            if (!(numsP.size && nq.size)) return true;
            if ([...numsP].some(n => nq.has(n))) return true;
            return [...numsP].some(n => [...nq].some(m => sansLettre(m) === sansLettre(n)));   // deux numéros connus et disjoints : une réimpression, pas une version de la même carte — SAUF s'ils ne diffèrent que par une lettre (version à produit dédié : frère)
        });
        if (!p.idMetacard) { sauter(t, 'metacarte-inconnue', { idProduct: id }); continue; }
        if (freres.length) { sauter(t, 'plusieurs-produits-pour-la-carte', { produits: [id, ...freres.map(q => q.idProduct)] }); continue; }
        const preuve = { source: t.source, enregistrement: t.enregistrement, tampons: [...t.tampons].sort(), mode };
        const cible = rows.length ? fiches : sansLigne;
        const f = cible.get(id) || cible.set(id, { idProduct: id, nom: p.name, idExpansion: p.idExpansion, set: rows[0]?.slugSet ?? null, numero: rows[0]?.numeroFiche ?? rows[0]?.impNumero ?? null,
            rows: rows.map(l => l._id), tampons: new Set(), preuves: [] }).get(id);
        for (const x of t.tampons) f.tampons.add(x);
        if (!f.preuves.some(q => q.source === preuve.source && q.enregistrement === preuve.enregistrement)) f.preuves.push(preuve);
    }
    const fin = m => [...m.values()].map(f => ({ ...f, tampons: [...f.tampons].sort(), preuveTexte: f.preuves.map(q => q.libelle ?? `${q.source} ${q.enregistrement} : ${q.tampons.join('+')} (${q.mode})`) })).sort((a, b) => a.idProduct - b.idProduct);
    const F = fin(fiches), S = fin(sansLigne);
    const compter = (liste, cles) => { const o = {}; for (const f of liste) for (const k of cles(f)) o[k] = (o[k] || 0) + 1; return triees(o); };
    const parMotif = {}; for (const s of sautes) parMotif[s.motif] = (parMotif[s.motif] || 0) + 1;
    return { fiches: F, sansLigne: S, sautes, comptes: { temoins: temoins.length, fiches: F.length, sansLigne: S.length, sautes: sautes.length,
        parTampon: compter(F, f => f.tampons), parSource: compter(F, f => [...new Set(f.preuves.map(q => q.source))]), parMotif: triees(parMotif),
        sansLigneParTampon: compter(S, f => f.tampons) } };
}

/** Les lignes cartes_produits, avec le nom de leur carte et le numéro/total imprimés dans leur set (lecture seule). */
async function lireLignes(cartesDb) {
    const rows = await cartesDb.collection('cartes_produits').find({}, { projection: { carteId: 1, idProduct: 1, idExpansion: 1, slugSet: 1, numeroFiche: 1, tirage: 1, variante: 1, prixMelangeTampon: 1, prixMelangeTamponPreuve: 1 } }).toArray();
    const cartes = await cartesDb.collection('cartes').find({}, { projection: { nomEn: 1, 'impressions.tirage': 1, 'impressions.expansion': 1, 'impressions.numero': 1, 'impressions.total': 1 } }).toArray();
    const sets = await cartesDb.collection('sets').find({}, { projection: { nomEn: 1, nomAffichage: 1, 'bulba.expansion': 1 } }).toArray();
    const cMap = new Map(cartes.map(c => [c._id, c])), sMap = new Map(sets.map(s => [s._id, s]));
    return rows.map(r => {
        const c = cMap.get(r.carteId), s = sMap.get(r.slugSet);
        const noms = new Set([s?.nomEn, s?.nomAffichage, s?.bulba?.expansion].filter(Boolean));
        const imps = (c?.impressions || []).filter(i => i && noms.has(i.expansion) && (!r.tirage || !i.tirage || i.tirage === r.tirage) && i.numero != null);
        let imp = null;
        if (imps.length === 1) imp = imps[0];
        else if (imps.length > 1 && r.numeroFiche != null) { const m = imps.filter(i => cleNumero(i.numero) === cleNumero(r.numeroFiche)); if (m.length === 1) imp = m[0]; }
        return { _id: r._id, carteId: r.carteId, idProduct: r.idProduct, idExpansion: r.idExpansion, slugSet: r.slugSet ?? null, numeroFiche: r.numeroFiche ?? null, tirage: r.tirage ?? null,
            variante: r.variante ?? null, prixMelangeTampon: r.prixMelangeTampon ?? null, marquagePreuve: Array.isArray(r.prixMelangeTamponPreuve) ? r.prixMelangeTamponPreuve : null, nomCarte: c?.nomEn ?? null, impNumero: imp?.numero ?? null, impTotal: imp?.total ?? null };
    });
}

const memes = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/**
 * Pose les trois champs, et seulement eux, sur chaque ligne des fiches du plan. `ecrire: false` (défaut) : l'à blanc rend les comptes. `attendu` est OBLIGATOIRE à l'écriture et refuse AVANT toute écriture.
 * Additif et idempotent : ce qui est déjà posé n'est pas réécrit ; une ligne devenue « séparée » (variante) entre la simulation et l'écriture n'est jamais touchée.
 */
async function appliquer(cartesDb, plan, { ecrire = false, attendu } = {}) {
    if (ecrire && !Number.isInteger(attendu)) throw new Error('--ecrire exige --attendu=<N> (le nombre de fiches lu à la simulation) : rien n\'est écrit');
    if (attendu !== undefined && attendu !== null && attendu !== plan.fiches.length) throw new Error(`--attendu=${attendu} mais ${plan.fiches.length} fiche(s) à marquer : rien n'est écrit`);
    const courantes = new Map((await cartesDb.collection('cartes_produits').find({ idProduct: { $in: plan.fiches.map(f => f.idProduct) } }).toArray()).map(l => [l._id, l]));
    const aEcrire = []; let deja = 0, sautees = 0, manquantes = 0;
    for (const f of plan.fiches) for (const id of f.rows) {
        const cur = courantes.get(id);
        if (!cur) { manquantes++; if (ecrire) throw new Error(`ligne cartes_produits introuvable : ${id} (produit ${f.idProduct}) — arrêt (rejouer : idempotent)`); continue; }
        if (cur.variante) { sautees++; continue; }
        // additif : un marquage qui contient déjà tout le plan (tampons ET preuves) n'est pas réécrit, même s'il est plus riche (une source lue plus tôt, le relevé du testeur…) — jamais de retour en arrière
        const inclus = (a, b) => Array.isArray(a) && b.every(x => a.includes(x));
        if (cur.prixMelangeTampon === true && inclus(cur.tamponsConnus, f.tampons) && inclus(cur.prixMelangeTamponPreuve, f.preuveTexte)) { deja++; continue; }
        aEcrire.push({ id, f });
    }
    const r = { fiches: plan.fiches.length, aEcrire: aEcrire.length, deja, sautees, manquantes, ecrit: 0, dejaFait: !aEcrire.length };
    if (!ecrire) return r;
    for (const { id, f } of aEcrire) {
        const res = await cartesDb.collection('cartes_produits').updateOne({ _id: id }, { $set: { prixMelangeTampon: true, tamponsConnus: f.tampons, prixMelangeTamponPreuve: f.preuveTexte } });
        if (!res.matchedCount || !res.modifiedCount) throw new Error(`ligne cartes_produits introuvable ou inchangée : ${id} — arrêt (rejouer : idempotent)`);
        r.ecrit++;
    }
    return r;
}

module.exports = { TAMPONS_FERMES, TAMPONS_RELEVE, temoinsReleve, CHAMPS, PROMO_PAR_PREFIXE, tamponsDesStamps, tamponsDeCarteTcgdex, tamponsPokumon, temoinsPokumon, lireTemoinsClone, construirePlan, lireLignes, appliquer };
