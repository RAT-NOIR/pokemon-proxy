// ============================================================
// pokemon.com — IMPORT des visuels des relevés PASSIFS du testeur (lot PKMCOM-IMPORT, 2026-10-17)
// ============================================================
// 🔑 DÉCISION DU TESTEUR (2026-10-17) : « OUI pour télécharger les images depuis l'hôte d'images de pokemon.com, à ces conditions : robots.txt lu et respecté
// d'abord, cadence lente, uniquement les adresses relevées par mes clics, arrêt définitif au premier 403/429/défi anti-robot (aucun contournement, aucun en-tête
// maquillé), appariement prouvé par deux éléments avant écriture, sous lot-additif. »
//
// Ce module est PUR : aucune requête, aucune base, aucune écriture. Il lit les relevés (pokemoncom-passif/page--*.json, schéma 2), apparie des trous à des
// cartes RELEVÉES, et dit pourquoi il refuse. Chaque règle s'écrit par ce qu'elle AUTORISE :
//   · la table des cases est FERMÉE (10 cases -> 9 sets) ; une case hors table ne sert à rien ;
//   · une adresse n'est valable que sur l'hôte d'images, en https, sans port ni identifiants ni paramètres, sous le chemin des cartes ;
//   · DEUX ÉLÉMENTS : (a) la case et le numéro, (b) le nom — ou, pour une fiche sans numéro : (a) la case et le numéro d'origine du slug Cardmarket, (b) le nom ;
//     sans numéro exploitable : (a) la case, (b) un nom UNIQUE dans le relevé ET chez nous. Un doute est un trou, avec son motif.
//   · le doute du userscript 1.1 (numeroDoute) ne se lève que par DEUX lectures du HTML gardé qui s'accordent (le lien ET le nom du fichier), selon des équivalences FERMÉES.
// Le numéro de la fiche suit la production : `cleNumero` (jointure.js) — les préfixes (« SWSH284 », « TG01 ») et les lettres (Unown « A ») sont gardés.
const fs = require('fs');
const path = require('path');
const { cleNumero, normaliserNom } = require('./jointure');
const T = require('./tpc');

const SOURCE = 'pokemon.com';
const LOT = 'pokemoncom-2026-10';
const MENTION = T.MENTION;
const HOTE_IMAGES = 'assets.pokemon.com';
const PREFIXE_CHEMIN = '/static-assets/content-assets/cms2/img/cards/';
const UA = 'pokemon-proxy-catalogue/1.0 (mesure, cadence lente)';
const CADENCE_MS = 5000;
const DOSSIER_RELEVES = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\pokemoncom-passif';
const DOSSIER_CACHE = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\pokemoncom-cache';
const DOSSIER_LOT = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S7\\PKMCOM-IMPORT';

// La table des cases (le code du lien /series/<case>/<n>/) -> le slug Cardmarket du set. FERMÉE : une case hors table est ignorée.
const CASES = Object.freeze({ '30th': '30th-Celebration', '30th-c': '30th-Celebration', svp: 'SV-Black-Star-Promos', mep: 'MEP-Black-Star-Promos', swsh11tg: 'Lost-Origin',
    swshp: 'SWSH-Black-Star-Promos', sm35: 'Shining-Legends', sm6: 'Forbidden-Light', ex10: 'EX-Unseen-Forces', hgss1: 'HeartGold-SoulSilver' });
const CASES_RELEVEES = CASES;
// Le dossier d'image d'une case quand il diffère du code (équivalence FERMÉE, vue sur le relevé réel) : le dossier d'image de la Trainer Gallery est celui de l'extension.
const DOSSIER_IMAGE = Object.freeze({ swsh11tg: 'swsh11' });
// Les sets dont le numéro d'origine du slug Cardmarket n'est PAS celui de pokemon.com (la Classic Collection y est numérotée 1…N dans son ordre propre).
const SETS_SANS_NUMERO_DE_SLUG = Object.freeze(['30th-Celebration']);
// 🔑 « numéro non comparable » se déclare par CASE pokemon.com (jamais par set à nous) : la case 30th-c numérote la Classic Collection 1…N dans son ordre propre. Une fiche
// numérotée appariée à la case 30th (n°N) est comparée au numéro ; une fiche appariée à 30th-c ne l'est jamais.
const CASES_SANS_NUMERO_COMPARABLE = Object.freeze(['30th-c']);
// La règle par défaut quand le site n'est pas injecté : un scan japonais ne sert pas un set occidental (le plan de production injecte refusDuVisuel du site, comme la simulation).
const REFUS_PAR_DEFAUT = e => (String(e?.langue ?? '').trim().toLowerCase() === 'ja' ? 'langue:ja' : null);
// Les sets dont chaque image doit être REGARDÉE avant l'écriture (la marque « 30 » de la Classic Collection).
const SETS_A_REGARDER = Object.freeze(['30th-Celebration']);

const nomNorm = normaliserNom;
const slugDeLaCase = c => (typeof c === 'string' && Object.hasOwn(CASES, c.toLowerCase()) ? CASES[c.toLowerCase()] : null);

/** Une adresse d'image valable : https, hôte d'images seul, sans port/identifiants/paramètres/ancre, sous le chemin des cartes, fichier image sans remontée. */
function urlImageValide(url) {
    if (typeof url !== 'string' || !url || /\.\.|%|\\/.test(url)) return false;     // (l'URL normalise « .. » avant qu'on la lise : la chaîne brute se juge d'abord)
    let u; try { u = new URL(url); } catch { return false; }
    if (u.protocol !== 'https:' || u.hostname !== HOTE_IMAGES || u.port || u.username || u.password || u.search || u.hash) return false;
    if (!u.pathname.startsWith(PREFIXE_CHEMIN) || /(^|\/)\.\.?(\/|$)/.test(u.pathname) || /\/\//.test(u.pathname)) return false;
    return /^[A-Za-z0-9_\-/]+\.(png|jpg|webp)$/.test(u.pathname.slice(PREFIXE_CHEMIN.length));
}

// ── les relevés ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const decoder = s => String(s ?? '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
/** Les (lien, image, alt) du HTML gardé d'un relevé : un bloc <li> = une carte. */
function lireLiensDuHtml(html) {
    return [...String(html ?? '').matchAll(/<li>[\s\S]*?<\/li>/g)].map(m => m[0]).map(b => ({ href: decoder((/href="([^"]*)"/.exec(b) || [])[1] ?? ''), src: decoder((/src="([^"]*)"/.exec(b) || [])[1] ?? ''), alt: decoder((/alt="([^"]*)"/.exec(b) || [])[1] ?? '') })).filter(x => x.href && x.src);
}
const RE_LIEN = /^\/us\/pokemon-tcg\/pokemon-cards\/series\/([A-Za-z0-9-]+)\/([A-Za-z0-9]+)\/?$/;
const RE_FICHIER = /^([A-Za-z0-9-]+)_EN_([A-Za-z0-9_]+)\.png$/;
const alnum = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Lève le doute du userscript 1.1 par DEUX lectures du HTML gardé qui s'accordent : le lien /series/<case>/<n>/ ET le nom du fichier <DOSSIER>_EN_<jeton>.png.
 * Équivalences FERMÉES (vues sur les relevés réels) : le code de la case = le dossier à la ponctuation près (« 30th-c » = « 30TH-C ») ou la table DOSSIER_IMAGE
 * (« swsh11tg » = « SWSH11 ») ; le jeton = le numéro, ou « <nom>_<lettre> » pour un numéro d'une lettre (« Unown_A »). Tout le reste garde son doute.
 */
function relireDouteux(releve) {
    const parSrc = new Map(lireLiensDuHtml(releve.html).map(l => [l.src, l]));
    const cartes = (releve.cartes || []).map(c => {
        if (c.numeroDoute !== true) return c;
        const l = parSrc.get(c.img);
        const lien = l && RE_LIEN.exec(l.href);
        const fichier = lien && RE_FICHIER.exec(String(c.img).split('?')[0].split('/').pop());
        if (!lien || !fichier) return c;
        const [, cas, num] = lien, [, dossier, jeton] = fichier;
        const dossierOk = alnum(dossier) === alnum(cas) || DOSSIER_IMAGE[cas.toLowerCase()] === dossier.toLowerCase();
        const jetonOk = jeton.toLowerCase() === num.toLowerCase() || (/^[A-Za-z]$/.test(num) && new RegExp(`^[A-Za-z]+_${num}$`, 'i').test(jeton));
        return dossierOk && jetonOk ? { ...c, numero: num, set: cas, numeroDoute: false, relu: true } : c;
    });
    return { ...releve, cartes };
}

const releveComplet = r => r.diagnostic?.complet === true && (r.diagnostic?.pagesTotal == null || r.diagnostic.pagesTotal === 1);
/** Les cartes de plusieurs relevés, doutes relus, dédoublonnées par ADRESSE D'IMAGE (une carte relevée deux fois ne compte qu'une fois ; une lecture sans doute l'emporte). */
function cartesDesReleves(releves) {
    const parImg = new Map();
    for (const r0 of releves) {
        const r = relireDouteux(r0);
        for (const c of r.cartes) {
            const carte = { ...c, fichier: r._fichier ?? null, releveComplet: releveComplet(r) };
            const k = c.img;
            const deja = parImg.get(k);
            if (!deja || (deja.numeroDoute && !carte.numeroDoute)) parImg.set(k, carte);
        }
    }
    return { cartes: [...parImg.values()] };
}
/** Lit les page--*.json d'un dossier : le schéma 2 seul (le 1 est ignoré ET dit), jamais d'écriture. */
function lireReleves(dossier = DOSSIER_RELEVES) {
    const releves = [], ignores = [];
    for (const f of fs.readdirSync(dossier).filter(x => /^page--.*\.json$/.test(x)).sort()) {
        let o; try { o = JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf8')); } catch { ignores.push({ fichier: f, motif: 'illisible' }); continue; }
        if (o?.schema !== 2) { ignores.push({ fichier: f, motif: `schema ${o?.schema ?? '?'} ignoré (userscript 1.0, avant la 1.1) : sans numéro ni case` }); continue; }
        if (!Array.isArray(o.cartes)) { ignores.push({ fichier: f, motif: 'sans cartes' }); continue; }
        releves.push({ ...o, _fichier: f });
    }
    return { ...cartesDesReleves(releves), ignores, fichiers: releves.length };
}

// ── l'appariement ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Le nom d'un produit lu dans son slug : les segments avant le premier segment « V<n> » ou qui porte un chiffre. */
function nomDuSlug(slug) {
    if (typeof slug !== 'string' || !slug) return null;
    const segs = slug.split('-'), i = segs.findIndex(s => /\d/.test(s) || /^V\d+$/.test(s));
    const nom = (i < 0 ? segs : segs.slice(0, i)).join(' ');
    return nom || null;
}
/** Le numéro d'origine porté par le slug (« …-HS121 » -> 121, « …-30CPLB-97 » -> 97), ou null. */
function numeroDuSlug(slug) {
    if (typeof slug !== 'string') return null;
    const dernier = slug.split('-').pop();
    if (/^\d+$/.test(dernier) && slug.split('-').length > 1) return dernier;
    const m = /^[A-Za-z]+(\d+)$/.exec(dernier);
    return m ? m[1] : null;
}
function nomOk(c, t) {
    const miens = new Set([t.carte.nomEn, nomDuSlug(t.slugProduit)].filter(Boolean).map(nomNorm));
    const lettre = /^[A-Za-z]$/.test(c.numero) ? c.numero : null;
    const lus = [c.nom, c.alt].filter(Boolean).flatMap(n => [n, ...(lettre ? [String(n).replace(new RegExp(`\\s+${lettre}$`, 'i'), '')] : [])]);
    return lus.some(n => miens.has(nomNorm(n)));
}
const nomApprox = (c, t) => { const miens = new Set([t.carte.nomEn, nomDuSlug(t.slugProduit)].filter(Boolean).map(nomNorm)); return [c.nom, c.alt].filter(Boolean).flatMap(n => [n, String(n).replace(/\s+[A-Za-z]$/, '')]).some(n => miens.has(nomNorm(n))); };

/**
 * @param {{trous: object[], cartes: object[], noms: Map}} o  trous : { idProduct, carteId, slugSet, numeroFiche, slugProduit, carte:{_id,nomEn,images} } ;
 *   cartes : cartesDesReleves().cartes ; noms : Map(slugSet -> Map(nomNormalisé -> Set(carteId))) = les fiches du set chez nous.
 * @returns {{plan: object[], restes: object[]}}
 */
function apparier({ trous, cartes, noms = new Map(), refus = REFUS_PAR_DEFAUT }) {
    const restes = [];
    const resolus = [];                                                    // { t, card, voie, preuve, refusees }
    const reste = (t, motif, detail) => restes.push({ idProduct: t.idProduct, carteId: t.carte._id, nomEn: t.carte.nomEn ?? null, numero: t.numeroFiche ?? null, motif, ...(detail ? { detail } : {}) });
    for (const t of trous) {
        // 🔑 « DÉJÀ SERVI » = une entrée que la règle du site ADMET au même numéro (refus injecté : refusDuVisuel du site). Une entrée refusée (scan japonais sous un set
        // occidental…) ne sert pas la fiche : le produit reste un trou, et son remplacement est une MODIFICATION (feu vert du testeur) — jamais silencieusement « déjà servi ».
        const auNumero = (t.carte.images || []).filter(e => e && e.set === t.slugSet && (e.numero == null || cleNumero(e.numero) === cleNumero(t.numeroFiche ?? null)));
        const jugees = auNumero.map(e => ({ e, motif: refus(e, t.slugSet) }));
        if (jugees.some(x => x.motif === null)) { reste(t, 'deja-servi'); continue; }
        const refusees = jugees.map(x => ({ cleR2: x.e.cleR2 ?? null, source: x.e.source ?? null, numero: x.e.numero ?? null, langue: x.e.langue ?? null, motif: x.motif }));
        const duSet = cartes.filter(c => !c.numeroDoute && slugDeLaCase(c.set) === t.slugSet);
        const douteuxNomme = cartes.some(c => c.numeroDoute && nomApprox(c, t));
        const distinctes = l => new Set(l.map(c => c.img)).size;
        const avecNom = duSet.filter(c => nomOk(c, t));
        let choisie = null, voie = null, preuve = null;
        const numFiche = t.numeroFiche != null && String(t.numeroFiche).trim() !== '' ? t.numeroFiche : null;
        const numSlug = numFiche == null && !SETS_SANS_NUMERO_DE_SLUG.includes(t.slugSet) ? numeroDuSlug(t.slugProduit) : null;
        const numeroRef = numFiche ?? numSlug;
        if (numeroRef != null) {
            // un numéro ne se compare JAMAIS à une carte d'une case à numérotation propre (30th-c : 1…N) ; il se compare aux autres cases du même set (30th)
            const parNum = duSet.filter(c => !CASES_SANS_NUMERO_COMPARABLE.includes(String(c.set).toLowerCase()) && cleNumero(c.numero) === cleNumero(numeroRef));
            if (!parNum.length) {
                if (numFiche == null && avecNom.length) { reste(t, 'numero-du-slug-contredit', `slug ${numSlug}, relevé ${[...new Set(avecNom.map(c => `${c.set} n°${c.numero}`))].join(', ')}`); continue; }
                reste(t, douteuxNomme && !duSet.length ? 'numero-douteux' : (duSet.length || cartes.some(c => slugDeLaCase(c.set) === t.slugSet) ? 'numero-absent-du-releve' : (douteuxNomme ? 'numero-douteux' : 'set-non-releve'))); continue;
            }
            if (distinctes(parNum) > 1) { reste(t, 'releve-contradictoire', `${distinctes(parNum)} images pour ${parNum[0].set} n°${numeroRef}`); continue; }
            const c = parNum[0];
            if (!nomOk(c, t)) { reste(t, 'nom-contredit', `relevé « ${c.nom} », fiche « ${t.carte.nomEn} »`); continue; }
            choisie = c;
            voie = numFiche != null ? 'set+numero+nom' : 'set+numero-du-slug+nom';
            preuve = `case ${c.set} n°${c.numero} = ${numFiche != null ? 'le numéro de la fiche' : `le numéro d'origine du slug (${numSlug})`} ; nom relevé « ${c.nom} » = « ${t.carte.nomEn} »${c.relu ? ' ; doute du userscript levé par le lien ET le nom de fichier' : ''}`;
        } else {
            if (!cartes.some(c => slugDeLaCase(c.set) === t.slugSet) && !douteuxNomme) { reste(t, 'set-non-releve'); continue; }
            if (!avecNom.length) { reste(t, douteuxNomme ? 'numero-douteux' : 'absent-du-releve'); continue; }
            if (avecNom.some(c => !c.releveComplet)) { reste(t, 'releve-incomplet', 'le relevé couvre plusieurs pages ou est incomplet : l\'unicité du nom ne se prouve pas'); continue; }
            const chezNous = noms.get(t.slugSet)?.get(nomNorm(t.carte.nomEn));
            if (distinctes(avecNom) > 1 || !chezNous || chezNous.size !== 1 || !chezNous.has(t.carte._id)) { reste(t, 'nom-non-unique', `${distinctes(avecNom)} carte(s) relevée(s), ${chezNous?.size ?? '?'} fiche(s) chez nous`); continue; }
            choisie = avecNom[0]; voie = 'set+nom-unique';
            preuve = `case ${choisie.set} : le nom « ${choisie.nom} » est unique dans le relevé ET chez nous (une seule fiche au set) ; pas de numéro comparable${CASES_SANS_NUMERO_COMPARABLE.includes(String(choisie.set).toLowerCase()) ? ' (la case numérote ses cartes 1…N dans son ordre propre)' : ''}`;
        }
        if (!urlImageValide(choisie.img)) { reste(t, 'adresse-hors-regle', 'adresse du relevé hors des règles'); continue; }
        resolus.push({ t, card: choisie, voie, preuve, refusees });
    }
    // ── les groupes : une FICHE = (carte, numéro) ; une seule image par fiche ; une image pour une seule fiche ─────────────
    const cleGroupe = t => `${t.carte._id}|${t.numeroFiche == null ? '∅' : cleNumero(t.numeroFiche)}`;
    const groupes = new Map();
    for (const r of resolus) { const k = cleGroupe(r.t); (groupes.get(k) || groupes.set(k, []).get(k)).push(r); }
    for (const [k, g] of [...groupes]) {
        if (new Set(g.map(r => r.card.img)).size > 1) { for (const r of g) reste(r.t, 'deux-images-une-fiche'); groupes.delete(k); }
    }
    const parImg = new Map();
    for (const [k, g] of groupes) { const i = g[0].card.img; (parImg.get(i) || parImg.set(i, new Set()).get(i)).add(k); }
    for (const [, ks] of parImg) if (ks.size > 1) for (const k of ks) { for (const r of groupes.get(k) || []) reste(r.t, 'carte-pour-deux-fiches'); groupes.delete(k); }
    const plan = [], remplacements = [];
    for (const g of groupes.values()) {
        const { t, card, voie, preuve } = g[0];
        const refusees = [...new Map(g.flatMap(r => r.refusees).map(e => [e.cleR2, e])).values()];
        const unite = { carteId: t.carte._id, nomEn: t.carte.nomEn ?? null, slugSet: t.slugSet, numero: t.numeroFiche ?? null, produits: g.map(r => r.t.idProduct), ligne: card.set, numeroReleve: card.numero, url: card.img,
            voie, preuve, aRegarder: SETS_A_REGARDER.includes(t.slugSet), releve: card.fichier ?? null };
        if (!refusees.length) { plan.push(unite); continue; }
        const detail = `entrée(s) refusée(s) par la règle du site au même numéro (${refusees.map(e => `${e.cleR2} [${e.source}, ${e.motif}]`).join(' ; ')}) ; image pokemon.com prête : ${card.img} ; remplacement = modification, feu vert du testeur requis`;
        remplacements.push({ ...unite, refusees, motif: 'entree-refusee-au-numero' });
        for (const r of g) reste(r.t, 'entree-refusee-au-numero', detail);
    }
    return { plan, restes, remplacements };
}

// ── identifiants, langue, retrait ───────────────────────────────────────────────────────────────────────────────────────
const idImagePokemoncom = (slug, carteId, numero) => `${SOURCE}/${slug}/${carteId}/${String(numero ?? '').replace(/[^0-9A-Za-z]/g, '') || 'sans-numero'}/en`;
const cleNum = n => String(n ?? '').replace(/[^0-9A-Za-z]/g, '') || 'sans-numero';
/** La langue : déclarée par le NOM DU FICHIER servi (« …_EN_… »), par ce qu'elle autorise ; sinon null. */
function langueDe(url) {
    if (!urlImageValide(url)) return { langue: null, preuve: 'adresse d\'origine hors des règles : sans règle de langue' };
    return /_EN_[A-Za-z0-9_]+\.png$/.test(url.split('/').pop())
        ? { langue: 'en', preuve: 'pokemon.com (éditeur) : le nom du fichier servi déclare la langue anglaise (_EN_), carte du site américain' }
        : { langue: null, preuve: 'pokemon.com : le nom du fichier ne déclare pas la langue' };
}
/** Ce qu'un retrait en un lot retire : les entrées `cartes.images` de CETTE source ET de CE lot, et leurs clés R2 (vignettes comprises). */
function planRetrait(cartes) {
    const touchees = [], cles = [];
    let entrees = 0;
    for (const c of cartes) {
        const es = (c.images || []).filter(e => e?.source === SOURCE && e.lot === LOT);
        if (!es.length) continue;
        touchees.push(c._id); entrees += es.length; cles.push(...es.flatMap(e => [e.cleR2, e.vignette?.cleR2].filter(Boolean)));
    }
    return { cartes: touchees, entrees, cles };
}

module.exports = { SOURCE, LOT, MENTION, HOTE_IMAGES, PREFIXE_CHEMIN, UA, CADENCE_MS, DOSSIER_RELEVES, DOSSIER_CACHE, DOSSIER_LOT, CASES, CASES_RELEVEES, DOSSIER_IMAGE, SETS_SANS_NUMERO_DE_SLUG, CASES_SANS_NUMERO_COMPARABLE, REFUS_PAR_DEFAUT, SETS_A_REGARDER,
    slugDeLaCase, urlImageValide, lireLiensDuHtml, relireDouteux, cartesDesReleves, lireReleves, nomDuSlug, numeroDuSlug, apparier, nomNorm, idImagePokemoncom, cleNum, langueDe, planRetrait };
