// ============================================================
// POKELLECTOR — visuels 570×792 pour ce qui MANQUE encore après pkmncards et pokedata (lot POKELLECTOR, 2026-10-17)
// ============================================================
// 🔑 DÉCISION DU TESTEUR (2026-10-17) : « Pokéllector ne sert qu'aux cartes que pokedata n'a pas » ; les identifiants internes (le dossier du set, l'identifiant de la carte)
// « obligent à relever l'adresse depuis la page du set ou de la carte. On n'en construit aucune au hasard. »
//
// CE QUE LA SONDE DU 2026-10-17 A PROUVÉ (fixtures/pokellector/, 9 requêtes dont 3 images, ≥ 6,5 s, aucun blocage) :
//   · la page de SET ne porte que des VIGNETTES (« …<n°>.<id>.thumb.png ») : aucune adresse pleine taille ;
//   · la page de CARTE porte la pleine taille, relevée mot pour mot (og:image = image principale) : « …<Nom>.<CODE>.<n°>.<id>.png » = 570×792 (deux cartes mesurées) ;
//   · une VARIANTE (Reverse Holo, Trick or Trade) n'a, sur la page de sa carte, qu'une vignette ; son PANNEAU DE DÉTAIL (/ajax/views/card-overlay?cardid=<id>, relevé sur les
//     pages du set) porte « …<id>.mobile.jpg » = 570×797. La page de la COLLECTION « Trick or Trade 2024 » liste les 30 cartes tamponnées avec leur propre identifiant.
// Ce module est PUR : aucune requête, aucune base. Chaque règle s'écrit par ce qu'elle AUTORISE :
//   · une adresse d'image n'est valable que sur l'hôte d'images, en https, sous la forme pleine taille (.png) ou « .mobile.jpg » ; une vignette est refusée ;
//   · une page n'est demandée que sur l'hôte des pages, sous quatre formes fermées ; AUCUNE adresse n'est construite : seules celles qui figurent dans une page déjà lue ;
//   · DEUX ÉLÉMENTS au moins (set + numéro, puis nom ; ou, pour une collection, code d'origine + numéro du slug, puis nom) ; un doute est un trou, avec son motif.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { cleNumero, normaliserNom } = require('./jointure');
const T = require('./tpc');
const { estDosDeCarte } = require('./hotes-images-ptcgio');

const SOURCE = 'pokellector';
const LOT = 'pokellector-2026-10';
const MENTION = T.MENTION;
const HOTE_PAGES = 'www.pokellector.com';
const HOTE_IMAGES = 'den-cards.pokellector.com';
const HOTES = Object.freeze([HOTE_PAGES, HOTE_IMAGES]);
const UA = 'pokemon-proxy-catalogue/1.0 (mesure, cadence lente)';
const CADENCE_MS = 6000;
const LARGEUR_PLEINE_TAILLE = 570;
const DOSSIER_CACHE = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\pokellector-cache';
const DOSSIER_PAGES = path.join(DOSSIER_CACHE, 'pages');
const DOSSIER_IMAGES = path.join(DOSSIER_CACHE, 'images');
const DOSSIER_LOT = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S7\\POKELLECTOR';
const REFUS_PAR_DEFAUT = e => (String(e?.langue ?? '').trim().toLowerCase() === 'ja' ? 'langue:ja' : null);
const nomNorm = normaliserNom;
const estPleineTaille = w => Number.isFinite(w) && w >= LARGEUR_PLEINE_TAILLE;
const estUnDos = estDosDeCarte;

const decoder = s => String(s ?? '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&eacute;/g, 'é').replace(/&nbsp;/g, ' ');

// ── les adresses ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Le nom d'un fichier d'image : <Nom>.<CODE>.<n°>.<identifiant>[.thumb|.mobile].(png|jpg). `forme` : plein (.png), thumb, mobile (.jpg). null si la forme n'est pas celle-là. */
function analyserNomImage(fichier) {
    const m = /^(.+)\.(png|jpg)$/.exec(String(fichier ?? ''));
    if (!m) return null;
    const parts = m[1].split('.');
    let forme = 'plein';
    if (parts.at(-1) === 'thumb' || parts.at(-1) === 'mobile') forme = parts.pop();
    if (parts.length < 4) return null;
    const cardId = parts.pop(), numero = parts.pop(), code = parts.pop();
    if (!/^\d+$/.test(cardId) || !/^[A-Za-z0-9]+$/.test(numero) || !/^[A-Za-z0-9]+$/.test(code)) return null;
    const nom = parts.join('.');
    if (!nom || !/^[A-Za-z0-9'_.\-]+$/.test(nom)) return null;
    if ((forme === 'mobile') !== (m[2] === 'jpg') && forme !== 'thumb') return null;     // plein = png ; mobile = jpg ; thumb = l'un ou l'autre (refusé plus loin)
    return { nom: nom.replace(/-/g, ' '), code, numero, cardId, forme };
}
/** Une adresse d'image valable : https, hôte d'images seul, sans port/identifiants/paramètres/ancre, /<dossier>/<fichier>, forme PLEINE TAILLE (png) ou MOBILE (jpg) — jamais une vignette. */
function urlImageValide(url) {
    if (typeof url !== 'string' || !url || /\.\.|%|\\/.test(url)) return false;
    let u; try { u = new URL(url); } catch { return false; }
    if (u.protocol !== 'https:' || u.hostname !== HOTE_IMAGES || u.port || u.username || u.password || u.search || u.hash) return false;
    const m = /^\/(\d+)\/([^/]+)$/.exec(u.pathname);
    if (!m) return false;
    const f = analyserNomImage(m[2]);
    return !!f && (f.forme === 'plein' || f.forme === 'mobile');
}
const RE_SEG = /^[A-Za-z0-9'._\-]+$/;
/** Une adresse de PAGE valable : https, hôte des pages seul, quatre formes fermées. Une page ne se construit pas : l'appelant la prend d'une page déjà lue (adressesDeLaPage). */
function urlPageValide(url) {
    if (typeof url !== 'string' || !url || /\.\.|%|\\/.test(url)) return false;
    let u; try { u = new URL(url); } catch { return false; }
    if (u.protocol !== 'https:' || u.hostname !== HOTE_PAGES || u.port || u.username || u.password || u.hash) return false;
    const p = u.pathname;
    if (p === '/ajax/views/card-overlay') return /^\?cardid=\d+$/.test(u.search);
    if (u.search) return false;
    if (p === '/sets') return true;
    const m = /^\/([^/]+)-(Expansion|Collection)\/(?:([^/]+)-Card-([A-Za-z0-9]+))?$/.exec(p);
    if (!m) return false;
    return RE_SEG.test(m[1]) && (m[3] === undefined || RE_SEG.test(m[3]));
}

// ── la lecture des pages ───────────────────────────────────────────────────────────────────────────────────────────────────
const base = h => new URL(h, `https://${HOTE_PAGES}/`);
/** Les adresses de pages présentes mot pour mot dans une page (liens, panneaux de détail), normalisées en https sur l'hôte des pages, et valables. */
function adressesDeLaPage(html) {
    const out = new Set();
    const h = String(html ?? '');
    const candidats = [...h.matchAll(/href="([^"#][^"]*)"/g)].map(m => decoder(m[1])).concat([...h.matchAll(/card-overlay\?cardid=(\d+)/g)].map(m => `/ajax/views/card-overlay?cardid=${m[1]}`));
    for (const c of candidats) {
        let u; try { u = base(c); } catch { continue; }
        if (u.hostname !== HOTE_PAGES || (u.protocol !== 'https:' && u.protocol !== 'http:')) continue;
        const abs = `https://${HOTE_PAGES}${u.pathname}${u.search}`;
        if (urlPageValide(abs)) out.add(abs);
    }
    return out;
}
/** La liste des sets (page /sets) : { code, href, titre, nom, collection }, hôte des pages seul (les liens du site japonais sont écartés). */
function lireListeSets(html) {
    const sets = [], vus = new Set();
    for (const m of String(html ?? '').matchAll(/<a class="button" name="([^"]*)" href="([^"]+)" title="([^"]*)"/g)) {
        const href = decoder(m[2]);
        if (!href.startsWith('/') || vus.has(href)) continue;
        if (!urlPageValide(`https://${HOTE_PAGES}${href}`) || href === '/sets') continue;
        vus.add(href);
        const titre = decoder(m[3]);
        sets.push({ code: m[1] || null, href, titre, nom: titre.replace(/\s+Set$/, ''), collection: /-Collection\/$/.test(href) });
    }
    return sets;
}
/** Une page de set ou de collection : les cartes (vignettes seulement), le total annoncé, le catalogue (anglais ?), la nature (collection de cartes d'autres sets ?). */
function lirePageSet(html) {
    const h = String(html ?? '');
    const total = (/<span>Cards<\/span>\s*<span>(\d+)<\/span>/.exec(h) || [])[1];
    const cartes = [];
    for (const bloc of h.split(/<div class="card ?">/).slice(1)) {
        const id = (/data-cardid="(\d+)"/.exec(bloc) || [])[1];
        const a = /<a href="([^"]+)" name="card(\d+)" title="([^"]*)"/.exec(bloc);
        const th = (/data-src="([^"]+)"/.exec(bloc) || /<img class="card[^"]*" src="([^"]+)"/.exec(bloc) || [])[1];
        const pl = /<div class="plaque">#(\S+) - ([^<]+)<\/div>/.exec(bloc);
        if (!id || !a || !pl || a[2] !== id) continue;
        const f = th && new URL(th).hostname === HOTE_IMAGES ? analyserNomImage(new URL(th).pathname.split('/').pop()) : null;
        const incoherent = !f || f.cardId !== id || f.numero.toLowerCase() !== pl[1].toLowerCase();
        const ov = (/card-overlay\?cardid=(\d+)/.exec(bloc) || [])[1];
        cartes.push({ cardId: id, numero: pl[1], nom: decoder(pl[2]).trim(), code: f?.code ?? null, pageCarte: decoder(a[1]), titre: decoder(a[3]), thumb: th ?? null, img: null, overlay: ov ? `/ajax/views/card-overlay?cardid=${ov}` : null, ...(incoherent ? { incoherent: true } : {}) });
    }
    return { cartes, total: total ? Number(total) : null, anglais: /English Sets/.test(h), collection: /collection of cards found in other sets/i.test(h) };
}
/** Une page de carte : l'image PRINCIPALE (pleine taille) si — et seulement si — og:image et l'image affichée sont la même adresse valable, de l'identifiant annoncé. Sinon null. */
function lirePageCarte(html) {
    const h = String(html ?? '');
    const og = (/<meta property="og:image"\s+content="([^"]+)"/.exec(h) || [])[1];
    const zone = h.slice(h.indexOf('class="content cardinfo"'));
    const principale = (/<div class="card">[\s\S]*?<img src="([^"]+)" title="([^"]*)">/.exec(zone) || []);
    const img = principale[1];
    if (!og || !img || og !== img || !urlImageValide(img) || /\.mobile\./.test(img)) return null;
    const f = analyserNomImage(new URL(img).pathname.split('/').pop());
    const balise = (/<!-- card id #(\d+) -->/.exec(h) || [])[1];
    if (!f || (balise && balise !== f.cardId)) return null;
    const nt = /<strong>Card:<\/strong>\s*<a [^>]*>([^<\/]+)\/([^<]+)<\/a>/.exec(h);
    const setHref = (() => { const s = (/<meta property="pokellector:set"\s+content="([^"]+)"/.exec(h) || [])[1]; try { return s ? new URL(s).pathname : null; } catch { return null; } })();
    const variantes = [];
    const apres = h.split('<a name="variants">')[1];
    if (apres) for (const m of apres.split(/<h1>More From/)[0].matchAll(/name="card(\d+)" title="([^"]+)"><img class="card" src="([^"]+)"/g)) variantes.push({ cardId: m[1], titre: decoder(m[2]), thumb: m[3] });
    return { img, cardId: f.cardId, titre: decoder(principale[2]), numero: nt ? nt[1].trim() : f.numero, total: nt ? nt[2].trim() : null, setHref, anglais: /English Sets/.test(h), variantes };
}
/** Le panneau de détail d'une carte : l'image de fond (« .mobile.jpg ») si elle est valable. */
function lireOverlay(html) {
    const h = String(html ?? '');
    const img = (/background-image:url\(([^)]+)\)/.exec(h) || [])[1];
    if (!img || !urlImageValide(img)) return null;
    const f = analyserNomImage(new URL(img).pathname.split('/').pop());
    const id = (/data-cardid="(\d+)"/.exec(h) || [])[1];
    if (!f || (id && id !== f.cardId)) return null;
    return { img, cardId: f.cardId, titre: decoder((/class="title"[^>]*>([^<]+)</.exec(h) || [])[1] ?? '').trim() };
}

// ── la table des sets (fermée) ────────────────────────────────────────────────────────────────────────────────────────────────
const cleNomSet = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
/** Le slug Cardmarket -> { href, collection } de la page de la source, par l'ÉGALITÉ du nom (ponctuation et casse ignorées) ; ambigu des deux côtés => absent. */
function tableDesSets(liste, slugs) {
    const parCle = new Map();
    for (const s of liste) { const k = cleNomSet(s.nom); (parCle.get(k) || parCle.set(k, []).get(k)).push(s); }
    const parSlugCle = new Map();
    for (const slug of slugs) { const k = cleNomSet(String(slug).replace(/-/g, ' ')); (parSlugCle.get(k) || parSlugCle.set(k, []).get(k)).push(slug); }
    const t = new Map();
    for (const [k, ss] of parSlugCle) {
        const l = parCle.get(k);
        if (ss.length === 1 && l?.length === 1) t.set(ss[0], { href: l[0].href, collection: l[0].collection });
    }
    return t;
}

/**
 * RÈGLE DU TESTEUR : « pour une même carte manquante, on prend l'image la plus grande » — pokedata (728 px) passe avant cette source (570 px ; 728/570 < 1,5 : une image écrite d'abord
 * ne serait jamais remplacée). Tant que le plan pokedata n'existe pas, les sets que LISTE pokedata (anglais seulement) sont réservés : égalité du nom, plus « McDonalds-Collection-<année> »
 * = « McDonald's Promos <année> » (forme vue sur la liste réelle). @param liste [{ nom, langue }] @returns {Set<string>} les slugs réservés
 */
function slugsReserves(slugs, liste) {
    // ALIAS FERMÉS, chacun vu sur la liste réelle : « & » ne compte pas (« Sun & Moon » = « Sun-Moon ») ; « Promos » = « Promo » (« Sun & Moon Black Star Promo ») ;
    // « McDonalds-Collection-<année> » = « McDonald's Promos <année> » ; les sets EX s'écrivent SANS « EX » chez pokedata (« Emerald », « Deoxys », « Unseen Forces »). Dans le doute : RÉSERVER.
    const cr = s => cleNomSet(String(s).replace(/&/g, ' ').replace(/\bPromos\b/gi, 'Promo'));
    const cles = new Set(liste.filter(s => String(s.langue).toUpperCase() === 'ENGLISH').map(s => cr(s.nom)));
    const out = new Set();
    for (const slug of slugs) {
        const m = /^McDonalds-Collection-(\d{4})$/.exec(slug);
        const nu = String(slug).replace(/-/g, ' ');
        const exSansPrefixe = /^EX /.test(nu) ? nu.slice(3) : null;
        if (cles.has(cr(nu)) || (m && cles.has(cr(`McDonald's Promos ${m[1]}`))) || (exSansPrefixe && cles.has(cr(exSansPrefixe)))) out.add(slug);
    }
    return out;
}

// ── l'appariement ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function nomDuSlug(slug) {
    if (typeof slug !== 'string' || !slug) return null;
    const segs = slug.split('-'), i = segs.findIndex(s => /\d/.test(s) || /^V\d+$/.test(s));
    const nom = (i < 0 ? segs : segs.slice(0, i)).join(' ');
    return nom || null;
}
function numeroDuSlug(slug) {
    if (typeof slug !== 'string') return null;
    const dernier = slug.split('-').pop();
    if (/^\d+$/.test(dernier) && slug.split('-').length > 1) return dernier;
    const m = /^[A-Za-z]+(\d+)$/.exec(dernier);
    return m ? m[1] : null;
}
/** L'origine d'un produit de collection : « Gengar-BOO24PAF-057 » -> { code: 'PAF', numero: '57' } (le code et le numéro du set d'où vient la carte). */
function origineDuSlug(slug) {
    if (typeof slug !== 'string') return null;
    const segs = slug.split('-');
    if (segs.length < 3) return null;
    const m = /^[A-Za-z]{2,4}\d{2}([A-Za-z0-9]+)$/.exec(segs.at(-2)), n = /^(\d+)$/.exec(segs.at(-1));
    return m && n ? { code: m[1].toUpperCase(), numero: String(parseInt(n[1], 10)) } : null;
}
function nomOk(c, t) {
    const miens = new Set([t.carte.nomEn, nomDuSlug(t.slugProduit)].filter(Boolean).map(nomNorm));
    return !!c.nom && miens.has(nomNorm(c.nom));
}

/**
 * @param {{trous: object[], cartes: object[], tableSets: Map, noms?: Map, couverts?: Set<number>, refus?: Function}} o
 *   trous : { idProduct, carteId, slugSet, numeroFiche, slugProduit, empruntee?, carte:{_id,nomEn,images} } ;
 *   cartes : le relevé (construireReleve) : { setHref, code, numero, nom, cardId, pageCarte, overlay, img|null, forme } ;
 *   tableSets : Map(href -> { slugSet, collection }) ; couverts : les idProduct déjà pris par une source plus grande (plans pkmncards / pokedata).
 * @returns {{plan: object[], restes: object[], remplacements: object[], aReleve: object[]}}
 */
function apparier({ trous, cartes, tableSets, noms = new Map(), couverts = new Set(), reserves = new Set(), refus = REFUS_PAR_DEFAUT }) {
    const restes = [], aReleve = [];
    const resolus = [];
    const reste = (t, motif, detail) => restes.push({ idProduct: t.idProduct, carteId: t.carte._id, slugSet: t.slugSet, nomEn: t.carte.nomEn ?? null, numero: t.numeroFiche ?? null, motif, ...(detail ? { detail } : {}) });
    const slugDe = c => tableSets.get(c.setHref) ?? null;
    for (const t of trous) {
        if (couverts.has(t.idProduct)) { reste(t, 'couvert-par-une-source-plus-grande'); continue; }
        const auNumero = (t.carte.images || []).filter(e => e && e.set === t.slugSet && (e.numero == null || cleNumero(e.numero) === cleNumero(t.numeroFiche ?? null)));
        const jugees = auNumero.map(e => ({ e, motif: refus(e, t.slugSet) }));
        if (!t.empruntee && jugees.some(x => x.motif === null)) { reste(t, 'deja-servi'); continue; }
        if (reserves.has(t.slugSet)) { reste(t, 'reserve-a-une-source-plus-grande-en-attente'); continue; }
        const refusees = jugees.filter(x => x.motif !== null).map(x => ({ cleR2: x.e.cleR2 ?? null, source: x.e.source ?? null, numero: x.e.numero ?? null, langue: x.e.langue ?? null, motif: x.motif }));
        const duSet = cartes.filter(c => slugDe(c)?.slugSet === t.slugSet);
        const collection = duSet.some(c => slugDe(c).collection) || (!duSet.length && [...tableSets.values()].some(v => v.slugSet === t.slugSet && v.collection));
        let choisie = null, voie = null, preuve = null;
        if (collection) {
            const o = origineDuSlug(t.slugProduit);
            if (!o) { reste(t, 'origine-introuvable', `slug ${t.slugProduit ?? '∅'}`); continue; }
            if (!duSet.length) { reste(t, 'set-non-releve'); continue; }
            const m = duSet.filter(c => String(c.code).toUpperCase() === o.code && cleNumero(c.numero) === cleNumero(o.numero));
            if (!m.length) { reste(t, 'absent-du-releve', `origine ${o.code} n°${o.numero}`); continue; }
            if (new Set(m.map(c => c.cardId)).size > 1) { reste(t, 'releve-contradictoire', `${new Set(m.map(c => c.cardId)).size} cartes pour ${o.code} n°${o.numero}`); continue; }
            if (!nomOk(m[0], t)) { reste(t, 'nom-contredit', `relevé « ${m[0].nom} », fiche « ${t.carte.nomEn} »`); continue; }
            choisie = m[0]; voie = 'collection+origine+numero+nom';
            preuve = `collection : origine ${o.code} n°${o.numero} = celle du slug ; nom relevé « ${m[0].nom} » = « ${t.carte.nomEn} » ; image du panneau de détail de la carte tamponnée`;
        } else {
            const numFiche = t.numeroFiche != null && String(t.numeroFiche).trim() !== '' ? t.numeroFiche : null;
            const numeroRef = numFiche ?? numeroDuSlug(t.slugProduit);
            if (!duSet.length) { reste(t, 'set-non-releve'); continue; }
            if (numeroRef == null) { reste(t, 'numero-introuvable'); continue; }
            const m = duSet.filter(c => cleNumero(c.numero) === cleNumero(numeroRef));
            if (!m.length) { reste(t, 'numero-absent-du-releve'); continue; }
            if (new Set(m.map(c => c.cardId)).size > 1) { reste(t, 'releve-contradictoire', `${new Set(m.map(c => c.cardId)).size} cartes pour le n°${numeroRef}`); continue; }
            if (!nomOk(m[0], t)) { reste(t, 'nom-contredit', `relevé « ${m[0].nom} », fiche « ${t.carte.nomEn} »`); continue; }
            choisie = m[0]; voie = numFiche != null ? 'set+numero+nom' : 'set+numero-du-slug+nom';
            preuve = `set ${choisie.setHref.replace(/^\/|-(Expansion|Collection)\/$/g, '')} n°${choisie.numero} = ${numFiche != null ? 'le numéro de la fiche' : 'le numéro d\'origine du slug'} ; nom relevé « ${choisie.nom} » = « ${t.carte.nomEn} »`;
        }
        if (choisie.img == null) {
            aReleve.push({ idProduct: t.idProduct, cardId: choisie.cardId, url: collection ? choisie.overlay : choisie.pageCarte });
            reste(t, 'page-de-carte-a-relever', collection ? 'panneau de détail à relever' : 'page de carte à relever'); continue;
        }
        if (!urlImageValide(choisie.img)) { reste(t, 'adresse-hors-regle', 'adresse relevée hors des règles (vignette, autre hôte…)'); continue; }
        resolus.push({ t, card: choisie, voie, preuve, refusees, collection });
    }
    // une FICHE = (carte, set, numéro) ; une seule image par fiche ; une image pour une seule fiche
    const cleGroupe = t => `${t.carte._id}|${t.slugSet}|${t.numeroFiche == null ? '∅' : cleNumero(t.numeroFiche)}`;
    const groupes = new Map();
    for (const r of resolus) { const k = cleGroupe(r.t); (groupes.get(k) || groupes.set(k, []).get(k)).push(r); }
    for (const [k, g] of [...groupes]) if (new Set(g.map(r => r.card.img)).size > 1) { for (const r of g) reste(r.t, 'deux-images-une-fiche'); groupes.delete(k); }
    const parImg = new Map();
    for (const [k, g] of groupes) { const i = g[0].card.img; (parImg.get(i) || parImg.set(i, new Set()).get(i)).add(k); }
    for (const [, ks] of parImg) if (ks.size > 1) for (const k of ks) { for (const r of groupes.get(k) || []) reste(r.t, 'carte-pour-deux-fiches'); groupes.delete(k); }
    const plan = [], remplacements = [];
    for (const g of groupes.values()) {
        const { t, card, voie, preuve, collection } = g[0];
        const refusees = [...new Map(g.flatMap(r => r.refusees).map(e => [e.cleR2, e])).values()];
        const unite = { carteId: t.carte._id, nomEn: t.carte.nomEn ?? null, slugSet: t.slugSet, numero: t.numeroFiche ?? null, produits: g.map(r => r.t.idProduct), ligne: card.setHref, numeroReleve: card.numero, cardId: card.cardId, url: card.img, forme: card.forme ?? null,
            voie, preuve, aRegarder: collection || g.some(r => r.t.empruntee === true), ...(g.some(r => r.t.empruntee === true) ? { empruntee: true } : {}), anglais: card.anglais !== false };
        if (!refusees.length) { plan.push(unite); continue; }
        remplacements.push({ ...unite, refusees, motif: 'entree-refusee-au-numero' });
        for (const r of g) reste(r.t, 'entree-refusee-au-numero', `entrée(s) refusée(s) par la règle du site au même numéro (${refusees.map(e => `${e.cleR2} [${e.source}, ${e.motif}]`).join(' ; ')}) ; remplacement = modification, feu vert du testeur requis`);
    }
    return { plan, restes, remplacements, aReleve };
}

// ── le relevé depuis le cache de pages ────────────────────────────────────────────────────────────────────────────────────────────
const fichierSet = href => `set--${href.replace(/^\/|\/$/g, '')}.html`;
const fichierCarte = id => `carte--${id}.html`;
const fichierOverlay = id => `overlay--${id}.html`;
const lireSiPresent = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
/**
 * Les cartes relevées par les pages du cache. Une carte de set standard reçoit sa pleine taille de SA page de carte (si lue et cohérente : même identifiant) ; une carte de
 * collection reçoit l'image de son panneau de détail. Sinon `img` reste null (« à relever »). @returns {{cartes: object[], ignorees: number, sets: string[]}}
 */
function construireReleve(dossierPages = DOSSIER_PAGES) {
    const cartes = []; let ignorees = 0; const sets = [];
    for (const f of fs.existsSync(dossierPages) ? fs.readdirSync(dossierPages).filter(x => /^set--.+\.html$/.test(x)).sort() : []) {
        const href = `/${f.slice(5, -5)}/`;
        const p = lirePageSet(fs.readFileSync(path.join(dossierPages, f), 'utf8'));
        sets.push(href);
        for (const c of p.cartes) {
            if (c.incoherent) { ignorees++; continue; }
            let img = null, forme = null;
            if (p.collection) {
                const o = lireOverlay(lireSiPresent(path.join(dossierPages, fichierOverlay(c.cardId))));
                if (o && o.cardId === c.cardId) { img = o.img; forme = 'mobile'; }
            } else {
                const pc = lirePageCarte(lireSiPresent(path.join(dossierPages, fichierCarte(c.cardId))));
                if (pc && pc.cardId === c.cardId) { img = pc.img; forme = 'plein'; }
            }
            cartes.push({ setHref: href, code: c.code, numero: c.numero, nom: c.nom, cardId: c.cardId, pageCarte: c.pageCarte, overlay: c.overlay, img, forme, anglais: p.anglais, collection: p.collection });
        }
    }
    return { cartes, ignorees, sets };
}

// ── jugement d'une réponse : l'arrêt est DÉFINITIF sur une preuve de la liste fermée ─────────────────────────────────────────────────────
const MARQUEUR_DE_DEFI = /just a moment|captcha|cf-chl|cf-browser-verification|challenge-platform|_incapsula|incapsula incident|attention required/i;
/** @returns {{etat: 'ok'|'absent'|'arret'|'interrompu', motif?: string}} — arret : 401/403/410/429, 3xx, cf-mitigated, Imperva/Incapsula, marqueur de défi ; une image attendue qui arrive en HTML. */
function jugerReponse(r, { image = false, forme = null } = {}) {
    const s = r?.status;
    if ([401, 403, 410, 429].includes(s)) return { etat: 'arret', motif: `HTTP ${s}` };
    if (s >= 300 && s < 400) return { etat: 'arret', motif: `HTTP ${s} (redirection non suivie)` };
    if (r?.cfMitigated) return { etat: 'arret', motif: `cf-mitigated ${r.cfMitigated}` };
    if (r?.imperva) return { etat: 'arret', motif: 'Imperva/Incapsula' };
    if (typeof r?.texte === 'string' && MARQUEUR_DE_DEFI.test(r.texte.slice(0, 3000))) return { etat: 'arret', motif: 'page de défi anti-robot' };
    if (s === 404) return { etat: 'absent', motif: 'HTTP 404' };
    if (typeof s !== 'number') return { etat: 'interrompu', motif: 'pas de statut' };
    if (s >= 500 && s < 600) return { etat: 'interrompu', motif: `HTTP ${s}`, cinq: true };      // le compte des 5xx RÉPÉTÉS se tient dans le flux (deux de suite => arrêt)
    // ⛔ L'ARRÊT S'ÉCRIT PAR CE QU'IL AUTORISE : seuls un 200 CONFORME et un 404 laissent continuer ; tout le reste (401, 403, 410, 429, 407, 451, 400…, mur de connexion) arrête.
    if (s !== 200) return { etat: 'arret', motif: `HTTP ${s} : ni 200 ni 404` };
    if (image) {
        if (/html/i.test(r.type || '')) return { etat: 'arret', motif: 'HTML au lieu d\'une image' };
        if (!Buffer.isBuffer(r.octets)) return { etat: 'arret', motif: '200 qui n\'est pas une image' };
        return { etat: 'ok' };
    }
    if (typeof r.texte !== 'string') return { etat: 'arret', motif: '200 sans texte : une page était attendue' };
    if (forme === 'robots') return /html/i.test(r.type || '') ? { etat: 'arret', motif: 'robots.txt servi en HTML' } : { etat: 'ok' };
    if (!/html/i.test(r.type || '')) return { etat: 'arret', motif: '200 non HTML : une page était attendue' };
    const st = STRUCTURES[forme];
    if (!st || !st.test(r.texte)) return { etat: 'arret', motif: `200 sans la structure attendue d'une page « ${forme ?? '?'} » (mur de connexion probable)` };
    return { etat: 'ok' };
}
/** Ce qu'une page conforme PORTE (relevé sur les fixtures de la sonde) ; sans elle, un 200 HTML est un mur. */
const STRUCTURES = Object.freeze({ liste: /<a class="button" name="[^"]*" href="\/[^"]+"/, set: /class="content cardlisting/, carte: /class="content cardinfo"/, overlay: /class="card-detail"/ });
/** La forme attendue d'une adresse : liste, set (ou collection), carte, overlay, robots ; null si elle n'est d'aucune. */
function formeDeLaPage(url) {
    let u; try { u = new URL(url); } catch { return null; }
    if (u.pathname === '/robots.txt') return 'robots';
    if (u.pathname === '/sets') return 'liste';
    if (u.pathname === '/ajax/views/card-overlay') return 'overlay';
    if (/-Card-[^/]+$/.test(u.pathname)) return 'carte';
    return /-(Expansion|Collection)\/$/.test(u.pathname) ? 'set' : null;
}
const MAGIE_PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const estUneImage = b => Buffer.isBuffer(b) && b.length > 8 && (b.subarray(0, 8).equals(MAGIE_PNG) || (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff));

// ── identifiants, langue, traçabilité, retrait ──────────────────────────────────────────────────────────────────────────────────────
const cleNum = n => String(n ?? '').replace(/[^0-9A-Za-z]/g, '') || 'sans-numero';
/** La clé R2 NEUTRE : aucun nom de source. */
const cleR2 = (slugSet, carteId, numero) => `pkl/${slugSet}/${cleNum(numero)}-${carteId}-en.webp`;
const idImage = (slugSet, carteId, numero) => `${SOURCE}/${slugSet}/${carteId}/${cleNum(numero)}/en`;
/** La langue : déclarée par le catalogue de la page (fil d'Ariane « English Sets »), pas par le nom de fichier. La preuve ne nomme pas la source. */
function langueDe({ anglais, img }) {
    if (!urlImageValide(img)) return { langue: null, preuve: 'adresse d\'origine hors des règles : sans règle de langue' };
    return anglais === true
        ? { langue: 'en', preuve: 'catalogue des cartes anglaises de la source (fil d\'Ariane « English Sets » de la page de la carte)' }
        : { langue: null, preuve: 'la page ne déclare pas le catalogue anglais' };
}
/** La traçabilité : UNE fonction locale (le module commun arrive par un autre lot ; bascule à la fusion). `urlOriginal` ne va que dans le document `images`, jamais sur la carte. */
function tracer({ url, collecteLe = new Date() }) { return { source: SOURCE, lot: LOT, retirable: true, urlOriginal: url, collecteLe }; }
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
const sha = (algo, buf) => crypto.createHash(algo).update(buf).digest('hex');

module.exports = { SOURCE, LOT, MENTION, HOTE_PAGES, HOTE_IMAGES, HOTES, UA, CADENCE_MS, LARGEUR_PLEINE_TAILLE, DOSSIER_CACHE, DOSSIER_PAGES, DOSSIER_IMAGES, DOSSIER_LOT, REFUS_PAR_DEFAUT,
    analyserNomImage, urlImageValide, urlPageValide, adressesDeLaPage, lireListeSets, lirePageSet, lirePageCarte, lireOverlay, tableDesSets, slugsReserves, nomNorm, nomDuSlug, numeroDuSlug, origineDuSlug, apparier,
    fichierSet, fichierCarte, fichierOverlay, construireReleve, jugerReponse, formeDeLaPage, STRUCTURES, MARQUEUR_DE_DEFI, estUneImage, estPleineTaille, estUnDos, cleNum, cleR2, idImage, langueDe, tracer, planRetrait, sha };
