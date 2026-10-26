// ============================================================
// LA JOINTURE DU CATALOGUE COMPLET « tcs » (T4, 2026-10-26) — produit du marché -> produit Cardmarket, calibrée AVANT usage
// ============================================================
// Le marché publie TOUT son catalogue (catégories Pokémon et Pokémon Japon) : nom, numéro (« 006/163 », « XY01 », « 85/146 »), rareté, adresse d'image. Ce module lit ces produits et les nôtres, les JOINT, et mesure
// ce que la jointure vaut. Fonctions PURES : aucune requête, aucune base.
//
//   · LA CLÉ : (numéro, nom). Le numéro se lit sous deux formes — FORTE (cleNumero de la production : préfixe alphabétique gardé, « XY1 », « TG1 ») et FAIBLE (le préfixe retiré, « 1 ») ; la faible ne sert qu'à un groupe
//     dont la forte ne recouvre presque rien (un préfixe écrit d'un seul côté), jamais dans un groupe où la forte marche (sinon la Trainer Gallery « TG1 » se joindrait au « 1 » du set principal).
//   · LES MARQUEURS : (Staff), (Prerelease), (Jumbo), [Staff]… sont des produits DISTINCTS chez le marché. Un marqueur d'un seul côté = pas de jointure ; le même des deux côtés = joint.
//   · L'UNICITÉ, dans les DEUX sens, multiplicités comptées : un produit qui désigne plus d'un produit de l'autre côté ne désigne rien (ambigu, compté, jamais deviné).
//   · LA TABLE groupe -> expansion est MESURÉE (recouvrement des clés, dit des deux côtés), jamais devinée en silence ; un groupe non apparié est IMPRIMÉ. Un tirage ne se mélange pas : la catégorie anglaise ne s'apparie qu'à un
//     tirage occidental, la japonaise qu'à un tirage japonais.
//   · LE TÉMOIN : la fiche (nom et numéros imprimés de NOTRE carte) est une donnée que la clé n'a pas utilisée ; elle juge la jointure (calibrer) et la porte (uniteDe n'écrit rien sur une fiche ambiguë).
'use strict';
const J = require('./jointure');
const { urlPleine } = require('./tcgcsv');

const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Le nom normalisé : accents tombés des DEUX côtés, puis la normalisation de production (ponctuation, apostrophes, sexe). */
const cleNom = s => J.normaliserNom(fold(s));
const clesDeNom = nom => [...new Set([cleNom(nom), cleNom(String(nom).replace(/^Basic\s+/i, ''))])].filter(Boolean);
const normMarqueur = t => fold(String(t ?? '')).toLowerCase().replace(/\s+/g, ' ').trim();
const aUnChiffre = s => /\d/.test(String(s ?? ''));
const faibleDe = fort => (fort == null ? null : (String(fort).replace(/^[A-Z-]+(?=\d)/, '') || null));
/** Les seuils de la table (mesurés le 26/10 sur le relevé complet, voir RAPPORT-T4.md). */
const MIN_COMMUNS = 3, PART_GROUPE_MIN = 0.25, PART_UNION_MIN = 0.5, FAIBLE_SI_FORTE_SOUS = 0.25;
const LANGUE_DU_TIRAGE = Object.freeze({ intl: 'en', jp: 'ja' });

// ── 1. LA LECTURE DES PRODUITS ───────────────────────────────────────────────────────────────────────────────────────────────
/** Un produit du marché { productId, name, number, groupId, imageUrl, rarity } -> ce que la jointure lit. */
function lireTcg(p) {
    let s = String(p?.name ?? '');
    const marqueurs = []; let desamb = null;
    s = s.replace(/\[([^\]]*)\]/g, (_, t) => { const m = normMarqueur(t); if (m) marqueurs.push(m); return ' '; });
    s = s.replace(/\(([^)]*)\)/g, (_, t) => {
        const m = /^(\d{1,3})(?:\s+(.+))?$/.exec(String(t).trim());
        if (m) { desamb = Number(m[1]); if (m[2]) marqueurs.push(normMarqueur(m[2])); } else { const x = normMarqueur(t); if (x) marqueurs.push(x); }
        return ' ';
    });
    s = s.replace(/\s+/g, ' ').trim();
    const brut = p?.number == null ? null : (String(p.number).trim() || null);
    const [partie, tot] = brut ? brut.split('/') : [null, null];
    if (partie) { const m = /^(.*?)\s+-\s+(\S+)\s*$/.exec(s); if (m && J.cleNumero(m[2].split('/')[0]) === J.cleNumero(partie)) s = m[1].trim(); }
    const fort = partie && aUnChiffre(partie) ? J.cleNumero(partie) : null;
    return { productId: p?.productId ?? null, groupId: p?.groupId ?? null, nomBrut: String(p?.name ?? ''), nomBase: s, nomCles: clesDeNom(s), numeroBrut: brut, fort, faible: faibleDe(fort), total: tot && /^\d+$/.test(tot) ? Number(tot) : null,
        desamb, marqueurs: [...new Set(marqueurs)].sort(), url: p?.imageUrl ?? null, rarete: p?.rarity ?? null };
}
/** Un produit Cardmarket { idProduct, name (catalogue), numero, slug, slugSet, codeSet, idExpansion } -> ce que la jointure lit. Le numéro de la base d'abord ; à défaut celui du slug, MARQUÉ « slug » (moins sûr). */
function lireCm(p) {
    const nomCat = String(p?.name ?? '');
    const marqueurs = [...nomCat.matchAll(/\(([^)]*)\)/g)].map(m => normMarqueur(m[1])).filter(x => x && !/^\d+$/.test(x));
    const d = J.decomposerNomCardmarket(nomCat.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim());
    let fort = null, numeroSource = null;
    if (p?.numero != null && aUnChiffre(p.numero)) { fort = J.cleNumero(p.numero); numeroSource = 'numero'; }
    else {
        const dernier = String(p?.slug ?? '').split('-').filter(Boolean).at(-1) ?? '';
        if (/^[A-Za-z]{0,6}\d{1,4}[A-Za-z]?$/.test(dernier)) { fort = J.cleNumero(dernier); numeroSource = 'slug'; }
    }
    return { idProduct: p?.idProduct ?? null, idExpansion: p?.idExpansion ?? null, slugSet: p?.slugSet ?? null, nomBase: d.nom, nomCles: clesDeNom(d.nom), fort, faible: faibleDe(fort), numeroSource, marqueurs: [...new Set(marqueurs)].sort() };
}

// ── 2. LA JOINTURE ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const memesMarqueurs = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
function motifMarqueurs(c, ts) {
    if (ts.every(t => !t.marqueurs.length) && c.marqueurs.length) return 'marqueur-cm-seul';
    if (ts.every(t => t.marqueurs.length) && !c.marqueurs.length) return 'marqueur-tcg-seul';
    if (ts.some(t => t.marqueurs.length) && !c.marqueurs.length) return 'marqueur-tcg-seul';
    return 'marqueurs-differents';
}
/**
 * @param {{tcg: object[], cm: object[], accepterSlug?: boolean, faible?: 'auto'|boolean}} o  produits LUS (lireTcg / lireCm) d'UN groupe et des expansions qui lui sont appariées
 * @returns {{joints: {idProduct, productId, niveau}[], non: {idProduct, motif}[], faiblePermis: boolean}}
 */
function joindre({ tcg, cm, accepterSlug = false, faible = 'auto' }) {
    const fortIdx = new Map(), faibleIdx = new Map();
    const ajoute = (idx, k, t) => { const l = idx.get(k) || idx.set(k, []).get(k); if (!l.includes(t)) l.push(t); };
    const lus = tcg.filter(t => t.fort != null);
    for (const t of lus) for (const n of t.nomCles) { ajoute(fortIdx, `${t.fort}|${n}`, t); if (t.faible) ajoute(faibleIdx, `${t.faible}|${n}`, t); }
    const cherche = (idx, cle, c) => { const r = []; for (const n of c.nomCles) for (const t of idx.get(`${cle}|${n}`) || []) if (!r.includes(t)) r.push(t); return r; };
    // la clé faible : seulement si la forte ne recouvre presque rien de ce groupe (un préfixe écrit d'un seul côté)
    const avecForte = lus.filter(t => cm.some(c => c.fort != null && t.nomCles.some(n => c.nomCles.includes(n)) && c.fort === t.fort)).length;
    const faiblePermis = faible === 'auto' ? (lus.length > 0 && avecForte / lus.length < FAIBLE_SI_FORTE_SOUS) : Boolean(faible);
    const non = [], provisoire = [];
    for (const c of cm) {
        if (c.fort == null) { non.push({ idProduct: c.idProduct, motif: 'sans-numero' }); continue; }
        if (c.numeroSource === 'slug' && !accepterSlug) { non.push({ idProduct: c.idProduct, motif: 'numero-du-slug-non-admis' }); continue; }
        let cands = cherche(fortIdx, c.fort, c), niveau = 'fort';
        if (!cands.length && faiblePermis && c.faible) { cands = cherche(faibleIdx, c.faible, c); niveau = 'faible'; }
        if (!cands.length) { non.push({ idProduct: c.idProduct, motif: 'absent-de-la-source' }); continue; }
        const egaux = cands.filter(t => memesMarqueurs(t.marqueurs, c.marqueurs));
        if (!egaux.length) { non.push({ idProduct: c.idProduct, motif: motifMarqueurs(c, cands) }); continue; }
        if (egaux.length > 1) { non.push({ idProduct: c.idProduct, motif: 'ambigu-tcg', detail: egaux.map(t => t.productId) }); continue; }
        const t = egaux[0];
        if (t.desamb != null && t.fort != null && String(t.desamb) !== String(t.fort).replace(/^\D+/, '').replace(/\D+$/, '')) { non.push({ idProduct: c.idProduct, motif: 'desambiguisation-contredit' }); continue; }
        provisoire.push({ idProduct: c.idProduct, productId: t.productId, niveau });
    }
    // l'unicité dans l'AUTRE sens, multiplicités comptées : un produit du marché réclamé par plusieurs des nôtres n'en désigne aucun
    const reclames = new Map();
    for (const j of provisoire) (reclames.get(j.productId) || reclames.set(j.productId, []).get(j.productId)).push(j);
    const joints = [];
    for (const j of provisoire) {
        if (reclames.get(j.productId).length > 1) non.push({ idProduct: j.idProduct, motif: 'ambigu-cm', detail: reclames.get(j.productId).map(x => x.idProduct) });
        else joints.push(j);
    }
    return { joints, non, faiblePermis };
}

// ── 3. LA TABLE groupe -> expansion, MESURÉE ───────────────────────────────────────────────────────────────────────────────
const clesDe = x => { const r = []; if (x.fort == null) return r; for (const n of x.nomCles) { r.push(`${x.fort}|${n}`); if (x.faible && x.faible !== x.fort) r.push(`${x.faible}|${n}`); } return r; };
/**
 * @param {{groupes: {groupId, name, categoryId, produits}[], expansions: {idExpansion, slugSet, codeSet, tirage, produits: object[]}[], langueDeCategorie: object}} o  `produits` des expansions : lireCm ; des groupes : produits du relevé
 * Statuts : apparie · non-apparie (aucune expansion ne porte assez de ses clés) · tirage-incompatible (la seule expansion qui les porte est d'un autre tirage) · sans-numero.
 */
function construireTable({ groupes, expansions, langueDeCategorie }) {
    const E = expansions.map(e => ({ ...e, cles: new Set(e.produits.filter(p => p.numeroSource === 'numero').flatMap(clesDe)), langue: LANGUE_DU_TIRAGE[e.tirage] ?? null }));
    const lignes = [];
    for (const g of groupes) {
        const langueG = langueDeCategorie?.[g.categoryId] ?? null;
        const tcg = g.produits.map(lireTcg).filter(t => t.fort != null);
        const base = { groupId: g.groupId, name: g.name, categoryId: g.categoryId, produits: g.produits.length, avecNumero: tcg.length };
        if (!tcg.length) { lignes.push({ ...base, statut: 'sans-numero', expansions: [] }); continue; }
        const mesure = e => { const communs = tcg.filter(t => clesDe(t).some(k => e.cles.has(k))); return { e, communs }; };
        const toutes = E.map(mesure).filter(m => m.communs.length >= MIN_COMMUNS).sort((a, b) => b.communs.length - a.communs.length);
        const compat = toutes.filter(m => m.e.langue && m.e.langue === langueG);
        const retenues = compat.filter(m => m.communs.length / tcg.length >= PART_GROUPE_MIN);
        const union = new Set(retenues.flatMap(m => m.communs.map(t => t.productId)));
        const detail = ms => ms.map(m => ({ idExpansion: m.e.idExpansion, slugSet: m.e.slugSet, codeSet: m.e.codeSet, communs: m.communs.length, partGroupe: m.communs.length / tcg.length, partExpansion: m.e.cles.size ? m.communs.length / m.e.produits.filter(p => p.numeroSource === 'numero').length : 0 }));
        if (retenues.length && union.size / tcg.length >= PART_UNION_MIN) lignes.push({ ...base, statut: 'apparie', expansions: detail(retenues), unionPartGroupe: union.size / tcg.length });
        else {
            const incompat = toutes.filter(m => !compat.includes(m) && m.communs.length / tcg.length >= PART_UNION_MIN);
            lignes.push({ ...base, statut: !compat.length && incompat.length ? 'tirage-incompatible' : 'non-apparie', expansions: [], meilleur: detail(toutes.slice(0, 2)) });
        }
    }
    const par = {};
    for (const l of lignes) par[l.statut] = (par[l.statut] || 0) + 1;
    return { lignes, resume: { groupes: lignes.length, parStatut: par, appariees: lignes.filter(l => l.statut === 'apparie').length, nonAppariees: lignes.filter(l => l.statut !== 'apparie').map(l => ({ groupId: l.groupId, name: l.name, statut: l.statut, produits: l.produits, avecNumero: l.avecNumero, meilleur: l.meilleur ?? [] })) } };
}

// ── 4. LE TÉMOIN DE LA FICHE ET LA CALIBRATION ─────────────────────────────────────────────────────────────────────────────
/**
 * La fiche (nom et numéros imprimés de NOTRE carte) est une donnée que la clé n'a PAS utilisée : elle juge. `faux` = le nom, un numéro ou le total imprimé contredit le produit du marché ; `non-jugeable` = la fiche ne dit rien
 * de numéroté (jamais compté juste).
 */
function temoinFiche(t, fiche) {
    if (!fiche?.nomEn || !t) return { verdict: 'non-jugeable', cause: 'aucune fiche' };
    const nomOk = clesDeNom(fiche.nomEn).some(k => t.nomCles.includes(k));
    if (!nomOk) return { verdict: 'faux', cause: `nom : fiche « ${fiche.nomEn} », marché « ${t.nomBase} »` };
    const imps = (fiche.impressions || []).filter(i => i && i.numero != null && String(i.numero).trim() !== '' && aUnChiffre(i.numero));
    if (!imps.length || t.fort == null) return { verdict: 'non-jugeable', cause: 'la fiche ne porte aucun numéro imprimé' };
    const memeNumero = imps.filter(i => { const k = J.cleNumero(i.numero); return k === t.fort || k === t.faible || faibleDe(k) === t.faible; });
    if (!memeNumero.length) return { verdict: 'faux', cause: `numéro : fiche ${imps.map(i => i.numero).join('/')}, marché ${t.numeroBrut}` };
    const totaux = memeNumero.map(i => i.total).filter(x => x != null && /^\d+$/.test(String(x))).map(Number);
    if (t.total != null && totaux.length && !totaux.includes(t.total)) return { verdict: 'faux', cause: `total : fiche ${totaux.join('/')}, marché ${t.total}` };
    return { verdict: 'juste', cause: null };
}
/**
 * La calibration : la jointure rejouée sur des produits dont la carte est CONNUE (la fiche n'entre pas dans la clé), comptée en justes / faux / muets / non jugeables, avec le détail des faux. Retenue seulement à 0 faux
 * ET au moins un juste (un échantillon vide ne retient rien : un zéro sur rien n'est pas une mesure, §41).
 */
function calibrer({ tcg, cm, accepterSlug = false, faible = 'auto' }) {
    const r = joindre({ tcg, cm: cm.map(x => x.cm), accepterSlug, faible });
    const parTcg = new Map(tcg.map(t => [t.productId, t])), ficheDe = new Map(cm.map(x => [x.cm.idProduct, x.fiche]));
    let justes = 0, faux = 0, nonJugeables = 0; const fauxDetail = [], muetsParMotif = {};
    for (const j of r.joints) {
        const v = temoinFiche(parTcg.get(j.productId), ficheDe.get(j.idProduct));
        if (v.verdict === 'juste') justes++; else if (v.verdict === 'faux') { faux++; fauxDetail.push({ idProduct: j.idProduct, productId: j.productId, niveau: j.niveau, cause: v.cause }); } else nonJugeables++;
    }
    for (const n of r.non) muetsParMotif[n.motif] = (muetsParMotif[n.motif] || 0) + 1;
    return { total: cm.length, justes, faux, muets: r.non.length, nonJugeables, fauxDetail, muetsParMotif, faiblePermis: r.faiblePermis, retenue: cm.length > 0 && justes > 0 && faux === 0 };
}

// ── 5. L'UNITÉ DU FORMAT COMMUN ───────────────────────────────────────────────────────────────────────────────────────────
/**
 * Un produit joint -> l'unité du format commun des fournisseurs (recolte-commun.js : carteId, slugSet, numero, produits, url, idSource, groupe, carteNom, nomSource, numeroSource, preuveNeutre) + la langue (celle de la
 * CATEGORIE du marché) et `ecrivable` (seul l'anglais l'est : la langue du visuel japonais n'est pas ouverte à l'écriture pour cette source). `ligne` : { idProduct, lignes: [{carteId, slugSet, numeroFiche}], carteNom }.
 * Une adresse d'image absente ou hors forme, ou un produit joint à PLUSIEURS cartes : aucune unité (null).
 */
function uniteDe({ joint, tcg, ligne, cm, categoryId, langueDeCategorie, groupe, nomGroupe }) {
    void cm; void nomGroupe;
    const url = urlPleine(tcg?.url);
    if (!url || !ligne || !Array.isArray(ligne.lignes) || ligne.lignes.length !== 1) return null;
    const l = ligne.lignes[0], langue = langueDeCategorie?.[categoryId] ?? null;
    if (!langue) return null;
    return { carteId: l.carteId, slugSet: l.slugSet, numero: l.numeroFiche ?? null, produits: [joint.idProduct], slugProduit: ligne.slug ?? null, url, idSource: String(tcg.productId), groupe, langue, ecrivable: langue === 'en',
        carteNom: ligne.carteNom ?? null, nomSource: tcg.nomBrut, numeroSource: tcg.total != null ? `${tcg.fort}/${tcg.total}` : String(tcg.fort), niveau: joint.niveau ?? null,
        preuveNeutre: `jointure par numéro ${tcg.fort}${tcg.total != null ? `/${tcg.total}` : ''} (clé ${joint.niveau ?? 'fort'}) et nom « ${tcg.nomBase} » = fiche « ${ligne.carteNom ?? '?'} », un seul produit de chaque côté, aucun marqueur de variante` };
}

module.exports = { MIN_COMMUNS, PART_GROUPE_MIN, PART_UNION_MIN, FAIBLE_SI_FORTE_SOUS, LANGUE_DU_TIRAGE, fold, cleNom, clesDeNom, faibleDe, lireTcg, lireCm, joindre, construireTable, temoinFiche, calibrer, uniteDe };
