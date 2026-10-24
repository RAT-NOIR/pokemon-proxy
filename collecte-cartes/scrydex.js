// ============================================================
// EXTENSIONS « scx » (récolte RECOLTE2, 2026-10-24) — les pages d'extensions d'un site de cartes : un identifiant, un nom et une image par carte
// ============================================================
// Ordre du testeur (24/10) : « Récolte lente de pokipair et tcgcsv : OUI, selon la doctrine. Images seulement (aucun prix), robots.txt lu, 5 s ou plus par hôte, arrêt définitif au premier 401, 403, 410,
// 429 ou défi. Planche, essai à blanc, écriture, revérification. Scrydex et PackMagik ensuite, aux mêmes règles. »
// ⚠️ Cet ordre porte sur les PAGES du site (listes d'extensions) ET sur le serveur d'images. La décision du 2026-10-17 (« seuls les hôtes d'images ; jamais l'API ») reste vraie pour l'API : ce module
// ne lit JAMAIS `/pokemon/v1/…`, ni une page de carte, ni un prix (la table fermée des chemins ne les admet pas) ; il ne garde de la page que les tuiles, l'entête de l'extension et leur nom.
//
// CE QUE LA PAGE DONNE (relevé du 2026-10-24) : `/pokemon/expansions/<slug>/<id>` porte, par carte, une tuile de la grille (`data-id` = « mcd18-3 », une miniature `…/<id>/medium`, « Horsea #3 »)
// et une tuile de la liste (sans identifiant) ; l'entête porte l'objet JSON de l'extension (id, langue, total). L'original est `images.<hôte>/pokemon/<id>/large`. Une page de ≤ 30 cartes tient en une requête.
//   · Un kit Dresseur est DEUX extensions chez la source (une par moitié de deck), un seul set chez nous : le produit désigne sa moitié par un JETON de son slug (ou la lettre de son numéro), jamais devinée.
//   · Un identifiant inconnu du serveur d'images répond 200 avec le DOS d'une carte : `refuserOctets` le reconnaît (empreinte) et il n'est jamais une image.
//
// LA PREUVE (doctrine TPC) : le set (table FERMÉE, une garde d'identifiant, de langue et de total sur chaque page), la moitié, le numéro ET le nom — le nom de la tuile = le nom de NOTRE fiche (jointure.js
// `clesNom`) et, s'il se lit, celui du produit (son slug). Une tuile unique. Un doute est un trou, et son motif s'écrit. Jamais l'image d'un autre tirage, d'une autre langue, ni d'une variante non lue :
// deux produits pour une même (carte, numéro) sont des variantes que la source ne distingue pas. La source ne crée AUCUNE fiche.
//
// Code neutre : `scx` (source, lot, clé R2, mention) — le nom de la source n'apparaît jamais en public.
'use strict';
const T = require('./tpc');
const J = require('./jointure');
const RC = require('./recolte-commun');
const HOTE = require('./recolte-hote');
const H = require('./hotes-images-ptcgio');

const SOURCE = 'scx';
const LOT = 'scx-2026-10';
const LANGUE = 'en';
const LANGUE_PREUVE = 'scan de l\'impression anglaise (extension déclarée anglaise par la source, set, numéro et nom concordants avec la fiche), sous un set au tirage occidental';
const RACINE = 'scrydex.com';
const HOTE_PAGES = 'scrydex.com';
const HOTE_IMAGES = 'images.scrydex.com';
const SRC = RC.fabriquerSource({ SOURCE, LOT, LANGUE, LANGUE_PREUVE, TIRAGE: 'intl', CHAMP_BILAN: 'bilanLotScx', nomsInterdits: ['scrydex', 'scry'], refuserOctets: octets => (H.estDosDeCarte(octets) ? 'dos-de-carte' : null) });

const moitie = o => Object.freeze({ ...o });
const ligne = o => Object.freeze({ ...o, moities: Object.freeze(o.moities.map(moitie)) });
/**
 * LA TABLE FERMÉE : une ligne par set de notre base (`slug`), ses extensions chez la source (`moities` : l'identifiant, le chemin de page, et pour un kit le signal qui désigne la moitié d'un produit).
 * Seuls les sets qui ont de quoi gagner sont listés (un trou au numéro, ou une basse définition) — mesuré le 2026-10-24 sur la base ; les kits dont les trous sont tous des « mêmes carte et numéro dans les
 * deux moitiés » (EX Trainer Kit, XY Latias & Latios, XY Pikachu Libre & Suicune) n'ont aucune unité prouvable et n'y sont pas.
 */
const TABLE = Object.freeze([
    ligne({ code: 'MCD14', slug: 'McDonalds-Collection-2014', moities: [{ id: 'mcd14', page: 'mcdonalds-collection-2014' }] }),
    ligne({ code: 'MCD15', slug: 'McDonalds-Collection-2015', moities: [{ id: 'mcd15', page: 'mcdonalds-collection-2015' }] }),
    ligne({ code: 'MCD17', slug: 'McDonalds-Collection-2017', moities: [{ id: 'mcd17', page: 'mcdonalds-collection-2017' }] }),
    ligne({ code: 'MCD18', slug: 'McDonald-s-Collection-2018-2', numeroSlug: /-MCD18(\d+)$/, moities: [{ id: 'mcd18', page: 'mcdonalds-collection-2018' }] }),
    ligne({ code: 'TK3', slug: 'DP-Trainer-Kit', numeroSlug: /-TK3(\d+)-(?:Gold|Blue)$/, moities: [
        { id: 'tk3a', page: 'dp-trainer-kit-manaphy', prefixe: 'M', jeton: /-Blue$/ },
        { id: 'tk3b', page: 'dp-trainer-kit-lucario', prefixe: 'L', jeton: /-Gold$/ }] }),
    ligne({ code: 'TK4', slug: 'HS-Trainer-Kit', moities: [
        { id: 'tk4a', page: 'hgss-trainer-kit-raichu', jeton: /-TK4(?:yellow|R)/ },
        { id: 'tk4b', page: 'hgss-trainer-kit-gyarados', jeton: /-TK4(?:blue|G)/ }] }),
    ligne({ code: 'TK10', slug: 'SM-Trainer-Kit-Lycanroc-Alolan-Raichu', moities: [
        { id: 'tk10a', page: 'sm-trainer-kit-lycanroc', jeton: /-TK10L\d/ },
        { id: 'tk10b', page: 'sm-trainer-kit-alolan-raichu', jeton: /-TK10A\d/ }] })
]);
const ligneDe = code => TABLE.find(l => l.code === code) ?? null;
const ligneDuSet = slug => TABLE.find(l => l.slug === slug) ?? null;
const moitieDe = id => { for (const l of TABLE) { const m = l.moities.find(x => x.id === id); if (m) return { ligne: l, moitie: m }; } return null; };
const urlPage = id => {
    const x = moitieDe(id);
    if (!x) throw new Error(`scx : extension « ${id} » hors de la table fermée`);
    return `https://${HOTE_PAGES}/pokemon/expansions/${x.moitie.page}/${x.moitie.id}`;
};
// (écrit par ce qu'il autorise : seuls les identifiants d'extension de la table, suivis d'un numéro)
const IDS = TABLE.flatMap(l => l.moities.map(m => m.id));
const ID_IMAGE = new RegExp(`^(?:${IDS.join('|')})-[1-9]\\d{0,2}[a-z]?$`);
const CHEMIN_IMAGE = new RegExp(`^/pokemon/(?:${IDS.join('|')})-[1-9]\\d{0,2}[a-z]?/large$`);
const urlImageValide = url => { try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === HOTE_IMAGES && !u.search && !u.hash && !u.port && !u.username && !u.password && CHEMIN_IMAGE.test(u.pathname); } catch { return false; } };
const urlOriginalDe = id => `https://${HOTE_IMAGES}/pokemon/${id}/large`;

/** La liste FERMÉE des hôtes et des chemins du client poli : les pages de la table et la forme de l'original, rien d'autre. */
function hotes() {
    const echapper = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pages = TABLE.flatMap(l => l.moities.map(m => echapper(`/pokemon/expansions/${m.page}/${m.id}`)));
    return {
        [HOTE_PAGES]: { chemin: new RegExp(`^(/robots\\.txt|${pages.join('|')})$`) },
        [HOTE_IMAGES]: { chemin: new RegExp(`^(/robots\\.txt|${CHEMIN_IMAGE.source.replace(/^\^/, '').replace(/\$$/, '')})$`) }
    };
}
function fabriquerClient(o) { return HOTE.fabriquerClient({ racine: RACINE, hotes: hotes(), ...o }); }
const refuserOctets = SRC.refuserOctets;

// ── LA LECTURE D'UNE PAGE D'EXTENSION ───────────────────────────────────────────────────────────────────────────────────────
const ANCRE = /<a\b([^>]*)href="(\/pokemon\/cards\/[^"?]+)(?:\?variant=([A-Za-z0-9_-]*))?"([^>]*)>([\s\S]*?)<\/a>/g;
const attrib = (s, k) => { const m = new RegExp(`(?:^|\\s)${k}="([^"]*)"`).exec(s); return m ? T.entites(m[1]) : null; };
/** L'objet JSON de l'entête de l'extension (id, nom, langue, total) : null s'il ne se lit pas. */
function lireEntete(html) {
    const m = /data-terminal-trigger-json-value="([^"]*)"/.exec(html);
    if (!m) return null;
    try { const o = JSON.parse(T.entites(m[1])); return { id: o.id ?? null, name: o.name ?? null, total: Number.isInteger(o.total) ? o.total : null, printed_total: Number.isInteger(o.printed_total) ? o.printed_total : null, language_code: o.language_code ?? null, release_date: o.release_date ?? null }; } catch { return null; }
}
/**
 * Les tuiles de la GRILLE (celles qui portent un `data-id`), dans l'ordre. Une tuile illisible n'est PAS écartée en silence : elle est rendue avec `illisible` (le motif), pour être comptée.
 * @returns {{id, n, nom, variante, url, illisible?}[]}
 */
function lireTuiles(html) {
    const tuiles = [];
    for (const m of String(html ?? '').matchAll(ANCRE)) {
        const corps = m[5], id = attrib(corps, 'data-id');
        if (id == null) continue;                                    // la tuile de la liste n'en porte pas
        const src = /<img[^>]*\ssrc="([^"]*)"/.exec(corps)?.[1] ?? null;
        const texte = T.entites(/<span class="text-body-12 text-white text-center">([^<]*)<\/span>/.exec(corps)?.[1] ?? '').trim();
        const q = /^(.*\S)\s+#(\d{1,3}[a-z]?)$/.exec(texte);
        const suffixe = ID_IMAGE.test(id) ? id.slice(id.indexOf('-') + 1) : null;
        const t = { id, n: suffixe ? J.cleNumero(suffixe) : null, nom: q?.[1] ?? null, variante: m[3] ?? null, url: ID_IMAGE.test(id) ? urlOriginalDe(id) : null };
        const manque = !ID_IMAGE.test(id) ? 'identifiant hors de la forme' : !q ? 'nom ou numéro (« Nom #N »)' : !src ? 'image' : null;
        const incoherent = manque ? null : (q[2] !== suffixe ? 'le numéro du libellé et l\'identifiant se contredisent' : !(src === `https://${HOTE_IMAGES}/pokemon/${id}/medium`) ? 'l\'image de la tuile n\'est pas celle de son identifiant' : null);
        if (manque || incoherent) t.illisible = manque ? `tuile sans ${manque}` : incoherent;
        tuiles.push(t);
    }
    // l'identifiant d'une même carte peut revenir (grille répétée) : une tuile par identifiant, la première lue
    const vus = new Set();
    return tuiles.filter(t => (vus.has(t.id) ? false : (vus.add(t.id), true)));
}
function lirePage(html) {
    const h = String(html ?? '');
    const titre = T.entites(/<title>([^<]*)<\/title>/i.exec(h)?.[1] ?? '') || null;
    const h1 = T.entites((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(h)?.[1] ?? '').replace(/<[^>]+>/g, '').trim()) || null;
    return { titre, h1, entete: lireEntete(h), tuiles: lireTuiles(h) };
}
/** La page réduite à ce qu'on lit (la page entière pèse 170 à 230 Ko et porte les PRIX) : `lirePage(reduirePage(h))` donne les mêmes tuiles. Aucun prix n'est gardé. */
function reduirePage(html) {
    const h = String(html ?? '');
    const titre = /<title>[^<]*<\/title>/i.exec(h)?.[0] ?? '<title></title>';
    const h1 = (m => (m ? `<h1>${m[1]}</h1>` : ''))(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(h));
    const json = /data-terminal-trigger-json-value="[^"]*"/.exec(h)?.[0] ?? '';
    const tuiles = [];
    for (const m of h.matchAll(ANCRE)) {
        const corps = m[5], id = attrib(corps, 'data-id');
        if (id == null) continue;
        const src = /<img[^>]*\ssrc="([^"]*)"/.exec(corps)?.[1] ?? '';
        const nom = /<span class="text-body-12 text-white text-center">[^<]*<\/span>/.exec(corps)?.[0] ?? '';
        tuiles.push(`<a href="${m[2]}${m[3] != null ? `?variant=${m[3]}` : ''}"><div data-id="${id}"></div><img src="${src}">${nom}</a>`);
    }
    return `<!doctype html><html><head>${titre}</head><body>${h1}<div ${json}></div><div data-view-mode-target="grid">${tuiles.join('')}</div></body></html>`;
}

/** La garde de LECTURE d'une page : son identifiant, sa langue et son total disent l'extension attendue, et toutes les tuiles du total ont été lues. Écrite par ce qu'elle autorise. */
function verdictDePage(page, m) {
    if (!m) return { ok: false, motif: 'extension absente de la table' };
    if (!page.tuiles.length) return { ok: false, motif: 'aucune tuile lue (la page n\'a pas la forme attendue)' };
    if (page.entete?.id !== m.id) return { ok: false, motif: `identifiant « ${page.entete?.id ?? 'illisible'} » dans l'entête, « ${m.id} » attendu` };
    if (page.entete.language_code !== 'EN') return { ok: false, motif: `langue « ${page.entete.language_code ?? 'illisible'} » : la source ne sert ici que l'anglais (EN)` };
    const sans = page.tuiles.filter(t => t.illisible).length;
    if (sans > page.tuiles.length * 0.05) return { ok: false, motif: `${sans} tuile(s) illisible(s) sur ${page.tuiles.length} (plus de 5 %)` };
    if (page.entete.total !== page.tuiles.length) return { ok: false, motif: `${page.tuiles.length} tuile(s) lue(s), total annoncé ${page.entete.total} : liste incomplète` };
    return { ok: true, tuiles: page.tuiles.length, illisibles: sans };
}

// ── LA PREUVE ET LE PLAN : set + moitié + numéro + nom + tuile unique — un doute est un trou ────────────────────────────────────
const echapper = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Le nom du produit Cardmarket lu sur son slug « Alolan-Raichu-V1-TK10A17 », « Lucario-Lv30-TK33-Gold » : avant le jeton du code du set, sans variante, niveau ni numéro intercalé ; null si le slug n'a pas ce jeton. */
function nomDuProduit(slug, code) {
    const t = String(slug ?? '').split('-').filter(Boolean), i = t.findIndex(x => new RegExp(`^${echapper(code)}`, 'i').test(x));
    if (i <= 0) return null;
    const noms = t.slice(0, i).filter(x => !/^V\d+$/i.test(x) && !/^Lv\d+$/i.test(x) && !/^\d+$/.test(x));
    return noms.length ? noms.join(' ') : null;
}
const memeNom = (a, b) => { const ka = J.clesNom(a), kb = J.clesNom(b); return ka.some(k => kb.includes(k)); };
/** Le slug d'un produit est en ASCII (« Poke-Ball ») : pour ce seul témoin, les accents ne comptent pas (« Poké Ball » = « Poke Ball »). Le nom de la fiche, lui, se compare tel que la production le compare. */
const sansAccents = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const memeNomSlug = (a, b) => memeNom(sansAccents(a), sansAccents(b));
/** LES EXCLUSIONS MOTIVÉES : une liste FERMÉE de couples (carte, tuile) qu'aucune preuve ne protège d'une image déformée ou fausse ; la carte ET la tuile doivent concorder. Vide à ce jour. */
const EXCLUSIONS = Object.freeze([]);

/** Le numéro d'un produit : celui de sa fiche (lettres de tête = la moitié des kits DP), sinon celui du slug si la ligne en donne la forme. @returns {{n, prefixe, source}|null} */
function numeroDe(l, p) {
    const f = String(p.numeroFiche ?? '').trim();
    if (f) { const m = /^([A-Za-z]*)0*(\d+)$/.exec(f); return m ? { n: m[2], prefixe: m[1].toUpperCase(), source: 'fiche' } : null; }
    const m = l.numeroSlug?.exec(String(p.slug ?? ''));
    return m ? { n: String(Number(m[1])), prefixe: '', source: 'slug' } : null;
}
/** La moitié d'un produit : par la lettre de son numéro et/ou le jeton de son slug ; deux signaux qui se contredisent, ou aucun, = pas de moitié. @returns {{moitie?, motif?}} */
function moitieDuProduit(l, p, num) {
    if (l.moities.length === 1) return { moitie: l.moities[0] };
    const parPrefixe = num?.prefixe ? l.moities.filter(m => m.prefixe && m.prefixe === num.prefixe) : [];
    const parJeton = l.moities.filter(m => m.jeton && m.jeton.test(String(p.slug ?? '')));
    if (parPrefixe.length > 1 || parJeton.length > 1) return { motif: 'moitie-illisible' };
    if (parPrefixe.length === 1 && parJeton.length === 1 && parPrefixe[0] !== parJeton[0]) return { motif: 'moitie-contradictoire' };
    const m = parPrefixe[0] ?? parJeton[0];
    return m ? { moitie: m } : { motif: 'moitie-illisible' };
}

/**
 * @param {{ligne: object, pages: Object<string, object>, produits: Array<{carteId:number, idProduct:number, numeroFiche:string|null, slug:string|null, carteNom:string|null, carte?:object}>, temoin?: Function}} o
 *   `pages` : id d'extension -> page lue ET admise par la garde de lecture (une extension absente de `pages` est « page-absente »). `produits` : les produits JOINTS du set (cartes_produits).
 * @returns {{unites: object[], restes: object[], parMotif: object, base: object}}
 */
function planifier({ ligne: l, pages, produits, temoin = null, exclusions = EXCLUSIONS }) {
    const restes = [], unites = [];
    const reste = (p, motif, detail) => restes.push({ carteId: p.carteId, idProduct: p.idProduct, numero: p.numeroFiche ?? null, motif, ...(detail ? { detail } : {}) });
    const parPage = {}, base = { tuiles: 0, illisibles: 0, numeros: 0, pages: 0 };
    for (const m of l.moities) {
        const pg = pages?.[m.id];
        if (!pg) continue;
        const par = new Map();
        for (const t of pg.tuiles || []) { if (t.illisible || t.n == null) continue; (par.get(t.n) || par.set(t.n, []).get(t.n)).push(t); }
        parPage[m.id] = par;
        base.pages++; base.tuiles += (pg.tuiles || []).length; base.illisibles += (pg.tuiles || []).filter(t => t.illisible).length; base.numeros += par.size;
    }
    // le numéro et la moitié de chaque produit, d'abord : deux produits à la même (carte, moitié-indépendante, numéro) sont des variantes que la source ne distingue pas
    const lus = (produits || []).map(p => {
        const num = numeroDe(l, p), mo = moitieDuProduit(l, p, num);
        return { p, num, mo, label: num ? (num.source === 'fiche' ? String(p.numeroFiche).trim() : `${mo.moitie?.prefixe ?? ''}${num.n}`) : null };      // le libellé du numéro tel que la base le range (« L3 » pour un kit DP)
    });
    const cle = x => `${x.p.carteId}|${J.cleNumero(x.label)}`;
    const effectifs = new Map();
    for (const x of lus) if (x.num) effectifs.set(cle(x), (effectifs.get(cle(x)) || 0) + 1);
    const lignesDuProduit = new Map();
    for (const p of produits || []) lignesDuProduit.set(p.idProduct, (lignesDuProduit.get(p.idProduct) || 0) + 1);
    const revendiquees = new Map();
    for (const x of lus) {
        const { p, num, mo, label: numero } = x;
        if (lignesDuProduit.get(p.idProduct) > 1) { reste(p, 'produit-vers-plusieurs-cartes'); continue; }          // un produit joint à plusieurs cartes n'en désigne aucune
        if (!num) { reste(p, 'sans-numero'); continue; }
        if (!p.carteNom) { reste(p, 'sans-nom'); continue; }
        if (mo.motif) { reste(p, mo.motif, `slug « ${p.slug ?? '—'} », numéro « ${p.numeroFiche ?? '—'} »`); continue; }
        if (effectifs.get(cle(x)) > 1) { reste(p, 'variantes', `${effectifs.get(cle(x))} produits à la même carte et au même numéro`); continue; }
        const m = mo.moitie, par = parPage[m.id];
        if (!par) { reste(p, 'page-absente', m.id); continue; }
        const tuiles = par.get(J.cleNumero(num.n));
        if (!tuiles) { reste(p, 'absente-de-la-source', `${m.id} n° ${num.n}`); continue; }
        if (tuiles.length !== 1) { reste(p, 'tuile-ambigue', `${tuiles.length} tuiles au numéro ${num.n} de ${m.id}`); continue; }
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
        const u ={ carteId: p.carteId, slugSet: l.slug, numero, produits: [p.idProduct], slugProduit: p.slug ?? null, url: t.url, idSource: t.id, moitie: m.id, variante: t.variante, groupe: l.code, famille: LANGUE,
            carteNom: p.carteNom, nomSource: t.nom, numeroSource: String(t.n), sourceNumero: num.source, rarete: null, nomProduit,
            preuve: `extension ${m.id} : n° ${t.n} = fiche ${numero}${num.source === 'slug' ? ' (numéro lu sur le slug du produit)' : ''}, nom « ${t.nom} » = fiche « ${p.carteNom} »${nomProduit ? ` = produit « ${nomProduit} »` : ' (nom du produit non lisible sur son slug)'}, tuile unique`,
            preuveNeutre: `set ${l.code}${l.moities.length > 1 ? `, moitié ${m.id}` : ''}, n° ${t.n} = fiche ${numero}, nom « ${t.nom} » = fiche « ${p.carteNom} »${nomProduit ? ` = produit « ${nomProduit} »` : ''}, tuile unique` };
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

module.exports = { SOURCE, LOT, LANGUE, LANGUE_PREUVE, RACINE, HOTE_PAGES, HOTE_IMAGES, SRC, TABLE, EXCLUSIONS, ligneDe, ligneDuSet, moitieDe, urlPage, urlOriginalDe, urlImageValide, CHEMIN_IMAGE, hotes, fabriquerClient,
    refuserOctets, lireEntete, lireTuiles, lirePage, reduirePage, verdictDePage, nomDuProduit, memeNom, memeNomSlug, numeroDe, moitieDuProduit, planifier };
