// ============================================================
// SETS CHINOIS « pmk » (récolte RECOLTE2, 2026-10-24) — les pages de sets d'un site de suivi de cartes : une tuile, un nom et un original par carte
// ============================================================
// Ordre du testeur (24/10) : « Récolte lente de pokipair et tcgcsv : OUI, selon la doctrine. Images seulement (aucun prix), robots.txt lu, 5 s ou plus par hôte, arrêt définitif au premier 401, 403, 410,
// 429 ou défi. Planche, essai à blanc, écriture, revérification. Scrydex et PackMagik ensuite, aux mêmes règles. »
//
// CE QUE LA PAGE DONNE (relevé du 2026-10-24) : `/sets/pkmn-<code>-cn` liste les 48 PREMIÈRES cartes du set (les suivantes, dont le nom n'est pas traduit — « 打空保险 » —, ne sont pas listées et leur
// page de carte porte un nom chinois : aucune preuve de nom possible, elles ne sont pas lues). Chaque tuile : l'adresse de la carte (`/cards/pkmn-<code>-cn-<n°>`), la miniature, le nom, « <set> · <n°> ».
// L'original est le fichier que la page déclare dans ses données structurées : `…/card-images/pokemon/<code>/<n°>.png` — 300 × 419 (le dossier « w768 » des miniatures est trompeur : mesuré 300 × 419 aussi).
// La page porte aussi des PRIX : rien n'en est lu ni gardé (la page est réduite aux tuiles avant d'être mise en cache), et aucune page de prix, de carte, de boutique, de combat ni d'API n'est dans la table fermée.
//
// LA PREUVE (doctrine TPC) : le set (table FERMÉE, une garde de titre et de numéros contigus), le numéro ET le nom — le nom de la tuile = le nom de NOTRE fiche (jointure.js `clesNom`) et, s'il se lit, celui
// du produit (son slug). Une tuile unique. Un doute est un trou, et son motif s'écrit. Jamais l'image d'un autre tirage, d'une autre langue, ni d'une variante non lue. La source ne crée AUCUNE fiche.
//
// ⚠️ LE SEUIL : 300 px < 350 px (seuil de la source) et la source n'est PAS dans la liste fermée du plancher de 200 px (seuils-images.js) : tant que le testeur ne l'y a pas nommée, toute image est
// `trop-petit` et rien ne s'écrit. Ce module ne change pas la règle.
//
// Code neutre : `pmk` (source, lot, clé R2, mention) — le nom de la source n'apparaît jamais en public.
'use strict';
const T = require('./tpc');
const J = require('./jointure');
const RC = require('./recolte-commun');
const HOTE = require('./recolte-hote');

const SOURCE = 'pmk';
const LOT = 'pmk-2026-10';
const LANGUE = 'zh-hans';
const LANGUE_PREUVE = 'scan de la carte chinoise imprimée (sinogrammes simplifiés), sous un set au tirage zh-hans ; set, numéro et nom concordants avec la fiche';
const RACINE = 'packmagik.com';
const HOTE_PAGES = 'www.packmagik.com';
const HOTE_IMAGES = 'cxjurdeoweovcukmmplp.supabase.co';
const SRC = RC.fabriquerSource({ SOURCE, LOT, LANGUE, LANGUE_PREUVE, TIRAGE: 'zh-hans', CHAMP_BILAN: 'bilanLotPmk', nomsInterdits: ['packmagik', 'pack magik', 'magik', 'supabase'] });

const ligne = o => Object.freeze({ ...o });
/** LA TABLE FERMÉE des pages de sets : une ligne par set de notre base. `titre` est une garde de LECTURE : une page qui ne dit pas ce qu'on attend n'est pas lue. */
const TABLE = Object.freeze([
    // `noms` : les quatre Pokémon qui nomment le set chez nous (la source l'appelle « Happy Set » ou « Happy Deck » selon le volume, et range les noms dans un autre ordre pour le volume 5) : tous doivent figurer dans le titre
    ligne({ code: 'CSVH1C', slug: 'Happy-Set-Pikachu-Clefairy-Turtwig-Gimmighoul', page: 'pkmn-csvh1c-cn', dossier: 'csvh1c', noms: ['Pikachu', 'Clefairy', 'Turtwig', 'Gimmighoul'] }),
    ligne({ code: 'CSVH2C', slug: 'Happy-Set-Lucario-Greninja-Zamazenta-Mabosstiff', page: 'pkmn-csvh2c-cn', dossier: 'csvh2c', noms: ['Lucario', 'Greninja', 'Zamazenta', 'Mabosstiff'] }),
    ligne({ code: 'CSVH3C', slug: 'Happy-Set-Altaria-Latios-Infernape-Maushold', page: 'pkmn-csvh3c-cn', dossier: 'csvh3c', noms: ['Altaria', 'Latios', 'Infernape', 'Maushold'] }),
    ligne({ code: 'CSVH4C', slug: 'Happy-Set-Decidueye-Melmetal-Koraidon-Miraidon', page: 'pkmn-csvh4c-cn', dossier: 'csvh4c', noms: ['Decidueye', 'Melmetal', 'Koraidon', 'Miraidon'] }),
    ligne({ code: 'CSVH5C', slug: 'Happy-Set-Mewtwo-Dragonite-Camerupt-Sinistcha', page: 'pkmn-csvh5c-cn', dossier: 'csvh5c', noms: ['Mewtwo', 'Dragonite', 'Camerupt', 'Sinistcha'] })
]);
const ligneDe = code => TABLE.find(l => l.code === code) ?? null;
const ligneDuSet = slug => TABLE.find(l => l.slug === slug) ?? null;
const urlPage = code => {
    const l = ligneDe(code);
    if (!l) throw new Error(`pmk : set « ${code} » hors de la table fermée`);
    return `https://${HOTE_PAGES}/sets/${l.page}`;
};
const DOSSIERS = TABLE.map(l => l.dossier).join('|');
const CHEMIN_IMAGE = new RegExp(`^/storage/v1/object/public/card-images/pokemon/(?:${DOSSIERS})/\\d{3}\\.png$`);
const urlImageValide = url => { try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === HOTE_IMAGES && !u.search && !u.hash && !u.port && !u.username && !u.password && CHEMIN_IMAGE.test(u.pathname); } catch { return false; } };
const urlOriginalDe = (dossier, n3) => `https://${HOTE_IMAGES}/storage/v1/object/public/card-images/pokemon/${dossier}/${n3}.png`;

/** La liste FERMÉE des hôtes et des chemins du client poli : la page de chaque set de la table et la forme de l'original, rien d'autre. */
function hotes() {
    const pages = TABLE.map(l => `/sets/${l.page}`);
    return {
        [HOTE_PAGES]: { chemin: new RegExp(`^(/robots\\.txt|${pages.join('|')})$`) },
        [HOTE_IMAGES]: { chemin: new RegExp(`^(/robots\\.txt|${CHEMIN_IMAGE.source.replace(/^\^/, '').replace(/\$$/, '')})$`) }
    };
}
function fabriquerClient(o) { return HOTE.fabriquerClient({ racine: RACINE, hotes: hotes(), ...o }); }

// ── LA LECTURE D'UNE PAGE DE SET ────────────────────────────────────────────────────────────────────────────────────────────
const MARQUE = '<a class="pm-interactive-surface-link"';
const texte = s => T.entites(String(s ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
/** Les blocs de tuiles : de chaque ancre de carte jusqu'à la suivante (6000 caractères au plus). */
function blocs(html) {
    const h = String(html ?? ''), debuts = [];
    for (let i = h.indexOf(MARQUE); i >= 0; i = h.indexOf(MARQUE, i + 1)) debuts.push(i);
    return debuts.map((d, k) => h.slice(d, Math.min(debuts[k + 1] ?? h.length, d + 6000)));
}
/**
 * Les tuiles d'un set (celles dont l'adresse de carte porte le code du set), dans l'ordre, une par numéro. Une tuile illisible n'est PAS écartée en silence : elle est rendue avec `illisible` (le motif).
 * @returns {{tuiles: object[], horsSet: number}}
 */
function lireTuiles(html, dossier) {
    const tuiles = [], vus = new Set();
    let horsSet = 0;
    for (const b of blocs(html)) {
        const href = /href="(\/cards\/pkmn-[a-z0-9]+-cn-\d{1,3})"/.exec(b)?.[1];
        if (!href) continue;
        const q = new RegExp(`^/cards/pkmn-${dossier}-cn-(\\d{3})$`).exec(href);
        if (!q) { horsSet++; continue; }
        if (vus.has(q[1])) continue;
        vus.add(q[1]);
        const alt = (() => { const a = /<img[^>]*\salt="([^"]*)"/.exec(b)?.[1]; return a == null ? null : T.entites(a); })();
        const src = /<img[^>]*\ssrc="([^"]*)"/.exec(b)?.[1] ?? null;
        const nomP = (() => { const m = /<p[^>]*font-bold[^>]*>([\s\S]*?)<\/p>/.exec(b)?.[1]; return m == null ? null : texte(m); })();
        const meta = (() => { const m = /<p[^>]*pm-card-meta[^>]*>([\s\S]*?)<\/p>/.exec(b)?.[1]; return m == null ? null : texte(m.replace(/<!--[\s\S]*?-->/g, ' ')); })();
        const numeroTexte = /·\s*(\d{3})\s*$/.exec(meta ?? '')?.[1] ?? null;
        const t = { id: `${dossier}-${q[1]}`, n: J.cleNumero(q[1]), nom: nomP ?? alt, numeroTexte, url: urlOriginalDe(dossier, q[1]) };
        const manque = !nomP ? 'nom' : !alt ? 'libellé de l\'image' : !numeroTexte ? 'numéro (« <set> · 001 »)' : !src ? 'image' : null;
        let incoherent = null;
        if (!manque) {
            if (numeroTexte !== q[1]) incoherent = 'le numéro du libellé et l\'adresse de la carte se contredisent';
            else if (alt !== nomP) incoherent = 'le nom du libellé et celui de l\'image se contredisent';
            else if (src !== `https://${HOTE_IMAGES}/storage/v1/object/public/thumbs/w768/card-images/pokemon/${dossier}/${q[1]}.png.webp`) incoherent = 'l\'image de la tuile n\'est pas celle de son numéro';
        }
        if (manque || incoherent) t.illisible = manque ? `tuile sans ${manque}` : incoherent;
        tuiles.push(t);
    }
    return { tuiles, horsSet };
}
/** @param {string} html @param {string} dossier le dossier d'images du set (« csvh1c ») — il sert à reconnaître les cartes DU set */
function lirePage(html, dossier = 'csvh1c') {
    const h = String(html ?? '');
    const titre = T.entites(/<title>([^<]*)<\/title>/i.exec(h)?.[1] ?? '') || null;
    const h1 = T.entites((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(h)?.[1] ?? '').replace(/<[^>]+>/g, '').trim()) || null;
    return { titre, h1, ...lireTuiles(h, dossier) };
}
/** La page réduite à ce qu'on lit (la page entière pèse 400 Ko et porte les PRIX) : `lirePage(reduirePage(h))` donne les mêmes tuiles. Aucun prix n'est gardé. */
function reduirePage(html, dossier = 'csvh1c') {
    const h = String(html ?? '');
    const titre = /<title>[^<]*<\/title>/i.exec(h)?.[0] ?? '<title></title>';
    const h1 = (m => (m ? `<h1>${m[1]}</h1>` : ''))(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(h));
    const lis = [];
    for (const b of blocs(h)) {
        const href = /href="(\/cards\/pkmn-[a-z0-9]+-cn-\d{1,3})"/.exec(b)?.[1];
        if (!href) continue;                // (les tuiles d'un autre set sont gardées : la lecture les COMPTE, `horsSet`)
        const alt = /<img[^>]*\salt="([^"]*)"/.exec(b)?.[1] ?? '', src = /<img[^>]*\ssrc="([^"]*)"/.exec(b)?.[1] ?? '';
        const nomP = /<p[^>]*font-bold[^>]*>([\s\S]*?)<\/p>/.exec(b)?.[1] ?? '', meta = /<p[^>]*pm-card-meta[^>]*>([\s\S]*?)<\/p>/.exec(b)?.[1] ?? '';
        lis.push(`<a class="pm-interactive-surface-link" href="${href}"><img alt="${alt}" src="${src}"><p class="font-bold">${nomP}</p><p class="pm-card-meta">${meta}</p></a>`);
    }
    return `<!doctype html><html><head>${titre}</head><body>${h1}<div class="grid">${lis.join('')}</div></body></html>`;
}

/** La garde de LECTURE d'une page : son titre dit le set attendu, les numéros sont contigus à partir de 1 (un trou au milieu est une lecture ratée), peu de tuiles illisibles. Écrite par ce qu'elle autorise. */
function verdictDePage(page, l) {
    if (!l) return { ok: false, motif: 'ligne de table absente' };
    if (!page.tuiles.length) return { ok: false, motif: `aucune tuile lue${page.horsSet ? ` (${page.horsSet} tuile(s) d'un AUTRE set)` : ''} (la page n'a pas la forme attendue)` };
    const sans = page.tuiles.filter(t => t.illisible).length;
    if (sans > page.tuiles.length * 0.05) return { ok: false, motif: `${sans} tuile(s) illisible(s) sur ${page.tuiles.length} (plus de 5 %)` };
    const entete = `${page.h1 ?? ''}`;
    const manquants = l.noms.filter(n => !entete.includes(n));
    if (!/Happy/.test(entete) || manquants.length) return { ok: false, motif: `titre « ${page.h1 ?? page.titre} » : ne porte pas « Happy » et les quatre noms du set${manquants.length ? ` (manque ${manquants.join(', ')})` : ''}` };
    const ns = page.tuiles.map(t => Number(t.n)).sort((a, b) => a - b);
    if (!ns.every((n, i) => n === i + 1)) return { ok: false, motif: `numéros non contigus à partir de 1 (${ns.slice(0, 6).join(', ')}…) : lecture incomplète` };
    return { ok: true, tuiles: page.tuiles.length, illisibles: sans, dernier: ns[ns.length - 1] };
}

// ── LA PREUVE ET LE PLAN : set + numéro + nom + tuile unique — un doute est un trou ──────────────────────────────────────────
const echapper = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Le nom du produit Cardmarket lu sur son slug « Shroomish-CSVH1C001 » : avant le code du set et son numéro ; null si le slug ne finit pas ainsi. */
function nomDuProduit(slug, code) {
    const t = String(slug ?? '').split('-').filter(Boolean);
    if (!t.length || !new RegExp(`^${echapper(code)}\\d+[A-Za-z]*$`, 'i').test(t[t.length - 1])) return null;
    t.pop();
    while (t.length && /^V\d+$/i.test(t[t.length - 1])) t.pop();
    return t.length ? t.join(' ') : null;
}
const sansAccents = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const memeNom = (a, b) => { const ka = J.clesNom(a), kb = J.clesNom(b); return ka.some(k => kb.includes(k)); };
const memeNomSlug = (a, b) => memeNom(sansAccents(a), sansAccents(b));
/** LES EXCLUSIONS MOTIVÉES : une liste FERMÉE de couples (carte, tuile) qu'aucune preuve ne protège d'une image déformée ou fausse ; la carte ET la tuile doivent concorder. Vide à ce jour. */
const EXCLUSIONS = Object.freeze([]);

/**
 * @param {{ligne: object, page: object|null, produits: Array<{carteId:number, idProduct:number, numeroFiche:string|null, slug:string|null, carteNom:string|null, carte?:object}>, temoin?: Function}} o
 *   `page` : la page lue ET admise par la garde de lecture (null = « page-absente »). `produits` : les produits JOINTS du set (cartes_produits).
 * @returns {{unites: object[], restes: object[], parMotif: object, base: object}}
 */
function planifier({ ligne: l, page, produits, temoin = null, exclusions = EXCLUSIONS }) {
    const restes = [], unites = [];
    const reste = (p, motif, detail) => restes.push({ carteId: p.carteId, idProduct: p.idProduct, numero: p.numeroFiche ?? null, motif, ...(detail ? { detail } : {}) });
    const parNumero = new Map();
    for (const t of page?.tuiles || []) { if (t.illisible || t.n == null) continue; (parNumero.get(t.n) || parNumero.set(t.n, []).get(t.n)).push(t); }
    const base = { tuiles: (page?.tuiles || []).length, illisibles: (page?.tuiles || []).filter(t => t.illisible).length, numeros: parNumero.size, tuilesAutresSets: page?.horsSet ?? 0 };
    const cle = p => `${p.carteId}|${p.numeroFiche == null ? '' : J.cleNumero(p.numeroFiche)}`;
    const effectifs = new Map();
    for (const p of produits || []) effectifs.set(cle(p), (effectifs.get(cle(p)) || 0) + 1);
    const lignesDuProduit = new Map();
    for (const p of produits || []) lignesDuProduit.set(p.idProduct, (lignesDuProduit.get(p.idProduct) || 0) + 1);
    const revendiquees = new Map();
    for (const p of produits || []) {
        if (lignesDuProduit.get(p.idProduct) > 1) { reste(p, 'produit-vers-plusieurs-cartes'); continue; }          // un produit joint à plusieurs cartes n'en désigne aucune
        if (p.numeroFiche == null || String(p.numeroFiche).trim() === '') { reste(p, 'sans-numero'); continue; }
        if (!p.carteNom) { reste(p, 'sans-nom'); continue; }
        if (effectifs.get(cle(p)) > 1) { reste(p, 'variantes', `${effectifs.get(cle(p))} produits au même numéro de la même carte`); continue; }
        if (!page) { reste(p, 'page-absente'); continue; }
        const tuiles = parNumero.get(J.cleNumero(p.numeroFiche));
        if (!tuiles) { reste(p, 'absente-de-la-source', /^\d+$/.test(String(p.numeroFiche).trim()) ? `n° ${p.numeroFiche} : la page ne liste que ${base.numeros} cartes (les suivantes, au nom chinois, ne sont pas lues)` : `n° « ${p.numeroFiche} » : hors de la numérotation de la page`); continue; }
        if (tuiles.length !== 1) { reste(p, 'tuile-ambigue', `${tuiles.length} tuiles au numéro`); continue; }
        const t = tuiles[0];
        const nomJoint = p.carte ? J.nomJointDe(p.carte) : p.carteNom;
        if (!memeNom(t.nom, nomJoint)) {
            const autres = temoin && p.carte ? temoin(p.carte, { nom: t.nom, attaques: [] }) : null;
            reste(p, autres ? 'nom-designe-une-autre-carte' : 'nom-different', `« ${t.nom} » à la source, « ${p.carteNom} » chez nous${autres ? ` (désigne ${autres.map(c => c.nomEn).slice(0, 3).join(', ')})` : ''}`);
            continue;
        }
        const nomProduit = nomDuProduit(p.slug, l.code);
        if (nomProduit && !memeNomSlug(t.nom, nomProduit)) { reste(p, 'nom-produit-different', `« ${t.nom} » à la source, « ${nomProduit} » sur le produit`); continue; }
        if (!urlImageValide(t.url)) { reste(p, 'adresse-hors-forme', t.url); continue; }
        const exclue = exclusions.find(e => e.carteId === p.carteId && String(e.idSource) === String(t.id) && (!e.code || e.code === l.code));
        if (exclue) { reste(p, 'exclusion-motivee', `${exclue.nom} (${exclue.le}) : ${exclue.motif}`); continue; }
        const u = { carteId: p.carteId, slugSet: l.slug, numero: String(p.numeroFiche).trim(), produits: [p.idProduct], slugProduit: p.slug ?? null, url: t.url, idSource: t.id, variante: null, groupe: l.code, famille: LANGUE,
            carteNom: p.carteNom, nomSource: t.nom, numeroSource: t.numeroTexte, rarete: null, nomProduit,
            preuve: `page du set ${l.code} : n° ${t.numeroTexte} = fiche ${p.numeroFiche}, nom « ${t.nom} » = fiche « ${p.carteNom} »${nomProduit ? ` = produit « ${nomProduit} »` : ' (nom du produit non lisible sur son slug)'}, tuile unique`,
            preuveNeutre: `set ${l.code}, n° ${t.numeroTexte} = fiche ${p.numeroFiche}, nom « ${t.nom} » = fiche « ${p.carteNom} »${nomProduit ? ` = produit « ${nomProduit} »` : ''}, tuile unique` };
        (revendiquees.get(t.url) || revendiquees.set(t.url, []).get(t.url)).push(u);
        unites.push(u);
    }
    // une même image pour deux produits : aucun des deux (une tuile ne désigne qu'une carte)
    const doubles = new Set([...revendiquees].filter(([, ul]) => ul.length > 1).map(([url]) => url));
    const gardees = unites.filter(u => !doubles.has(u.url));
    for (const u of unites) if (doubles.has(u.url)) restes.push({ carteId: u.carteId, idProduct: u.produits[0], numero: u.numero, motif: 'tuile-revendiquee-deux-fois', detail: u.url });
    const parMotif = {};
    for (const r of restes) parMotif[r.motif] = (parMotif[r.motif] || 0) + 1;
    return { unites: gardees, restes, parMotif, base };
}

module.exports = { SOURCE, LOT, LANGUE, LANGUE_PREUVE, RACINE, HOTE_PAGES, HOTE_IMAGES, SRC, TABLE, EXCLUSIONS, ligneDe, ligneDuSet, urlPage, urlOriginalDe, urlImageValide, CHEMIN_IMAGE, hotes, fabriquerClient,
    lireTuiles, lirePage, reduirePage, verdictDePage, nomDuProduit, memeNom, memeNomSlug, planifier };
