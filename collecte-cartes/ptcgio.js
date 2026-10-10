// ============================================================
// LE SERVEUR D'IMAGES PUBLIC DE POKEMONTCG.IO (images.pokemontcg.io) — visuels MANQUANTS, tirage exact (2026-10-10)
// ============================================================
// 🔑 DÉCISION DU TESTEUR (2026-10-08) : « serveur d'images public (images.pokemontcg.io) seulement, jamais l'API Scrydex, aucune clé, aucun
// compte. Collecte de nos trous uniquement, preuve set + numéro + variante. Mention « © Pokémon / The Pokémon Company », source interne
// images.source = pokemontcg.io, retirable en un lot. Occidental d'abord. » Rien d'autre n'entre ici : ni l'API, ni le dépôt de données
// (sans licence), ni aucun autre hôte.
//
// CE QUE LA SOURCE EST, MESURÉ le 2026-10-10 (MESURE-PTCGIO.md) : Cloudflare en simple CDN, aucun défi, robots.txt sans Disallow, AUCUNE
// condition publiée (/terms : 404, accueil : un renvoi vers Scrydex) — « aucune condition trouvée » n'est pas « autorisé ». Le serveur répond
// 404 avec l'image d'une carte « introuvable » pour une adresse absente : seul le STATUT dit l'absence.
//
// 🔑 L'APPARIEMENT SE PROUVE PAR L'IMAGE, JAMAIS PAR L'ADRESSE (ruling du coordinateur, 2026-10-08) : une adresse qui répond ne prouve rien.
// Chaque ligne de TABLE_PTCGIO porte ses `temoins` — des images OUVERTES à l'œil, à des numéros dispersés, dont le numéro imprimé et le NOM
// désignent notre produit au même numéro, 3 sur 3 au moins — et sa `marque` (ce qui montre que le set EST le tirage de notre set). Un set
// qui ne s'est pas prouvé n'a pas de ligne et reste un trou. Les Prize Packs, Battle Academy et WCD sont des réimpressions MARQUÉES : sans set
// dédié montrant la marque, une image serait un SUBSTITUT (§19) — `verdictDuSet` les refuse par leur nom, énumérés.
// ⚠️ La source ne livre ni nom ni donnée : le NOM d'un produit ne se vérifie donc pas carte par carte à la collecte. Ce qui le garantit est la
// numérotation du set (plage prouvée `max`, suffixe/préfixe du kit) ; un numéro hors plage reste un trou.
const { cleNumero } = require('./jointure');
const T = require('./tpc');

const SOURCE = 'pokemontcg.io';
const HOTE = 'https://images.pokemontcg.io';
const HOTE_NOM = 'images.pokemontcg.io';
const LOT = 'ptcgio-2026-10';
const MENTION = T.MENTION;                                  // une seule mention pour toutes nos sources de scans (§75)
const CADENCE_MS = 3000;
const CADENCE_MIN_MS = 2000;                                // consigne du coordinateur : jamais moins de 2 s
const REESSAI_MS = 30000;
const UA = 'pokemon-proxy-catalogue/1.0 (mesure, cadence lente)';
const VERROU_GLOBAL = 'pokemontcg-io/__collecteur__';
const VERROU_GLOBAL_MS = 3 * 60 * 1000;
const ID_ALERTE = 'alerte/source-bloquee/pokemontcg-io';
const CRAWL_DELAY_MAX_S = 60;

// Une ligne par set pokemontcg.io PROUVÉ. `suffixe` / `prefixe` : la moitié d'un kit (EX Trainer Kit : A = Latias = tk1a, O = Latios = tk1b).
// `max` : le dénominateur imprimé sur les cartes — au-delà, le numéro n'est pas dans ce que l'image a prouvé.
const t = (n, nom, imprime) => ({ n, nom, imprime });
const TABLE_PTCGIO = Object.freeze([
    { slug: 'EX-Trainer-Kit', id: 'tk1a', suffixe: 'A', max: 10, marque: 'symbole du EX Trainer Kit (Latias), dénominateur /10', temoins: [t(1, 'Bagon', '1/10'), t(4, 'Latias', '4/10'), t(10, 'Fire Energy', '10/10')] },
    { slug: 'EX-Trainer-Kit', id: 'tk1b', suffixe: 'O', max: 10, marque: 'symbole du EX Trainer Kit (Latios), dénominateur /10', temoins: [t(1, 'Electrike', '1/10'), t(2, 'Latios', '2/10'), t(10, 'Lightning Energy', '10/10')] },
    { slug: 'EX-Trainer-Kit-2', id: 'tk2a', prefixe: 'P', max: 12, marque: 'symbole du EX Trainer Kit 2 (Plusle), dénominateur /12', temoins: [t(1, 'Beldum', '1/12'), t(6, 'Plusle', '6/12'), t(12, 'Psychic Energy', '12/12')] },
    { slug: 'EX-Trainer-Kit-2', id: 'tk2b', prefixe: 'M', max: 12, marque: 'symbole du EX Trainer Kit 2 (Minun), dénominateur /12', temoins: [t(1, 'Arcanine', '1/12'), t(6, 'Minun', '6/12'), t(12, 'Lightning Energy', '12/12')] },
    { slug: 'McDonalds-Collection-2011', id: 'mcd11', max: 12, marque: 'collection de 12 cartes ©2011, symbole d\'extension propre ; PAS d\'arches sur l\'illustration (marque faible, dite)', temoins: [t(1, 'Snivy', '1/12'), t(6, 'Blitzle', '6/12'), t(12, 'Audino', '12/12')] },
    { slug: 'McDonalds-Collection-2012', id: 'mcd12', max: 12, marque: 'arches McDonald\'s dans l\'illustration (Servine, Emolga, Axew en haute définition)', temoins: [t(1, 'Servine', '1/12'), t(6, 'Emolga', '6/12'), t(12, 'Axew', '12/12')] },
    { slug: 'McDonalds-Collection-2016', id: 'mcd16', max: 12, marque: 'collection de 12 cartes ©2015, symbole d\'extension propre ; pas d\'arches lisibles à 245 px (marque faible, dite)', temoins: [t(1, 'Vulpix', '1/12'), t(6, 'Pikachu', '6/12'), t(12, 'Eevee', '12/12')] },
    { slug: 'McDonalds-Collection-2019', id: 'mcd19', max: 12, marque: 'collection de 12 cartes ©2019, symbole d\'extension propre ; pas d\'arches lisibles à 245 px (marque faible, dite)', temoins: [t(1, 'Caterpie', '1/12'), t(6, 'Pikachu', '6/12'), t(12, 'Eevee', '12/12')] },
    { slug: 'McDonalds-Collection-2022', id: 'mcd22', max: 15, marque: 'collection de 15 cartes ©2022, symbole d\'extension propre ; pas d\'arches lisibles à 245 px (marque faible, dite)', temoins: [t(1, 'Ledyba', '1/15'), t(8, 'Chinchou', '8/15'), t(15, 'Smeargle', '15/15')] },
    { slug: 'Celebrations', id: 'cel25', max: 25, marque: 'logo « 25 » de la célébration imprimé sur chaque carte', temoins: [t(1, 'Ho-Oh', '001/025'), t(5, 'Pikachu', '005/025'), t(11, 'Mew', '011/025'), t(24, 'Professor\'s Research', '024/025'), t(25, 'Mew', '025/025')] },
    { slug: 'Shining-Legends', id: 'sm35', max: 73, marque: 'symbole Shining Legends, ©2017, dénominateur /73', temoins: [t(1, 'Bulbasaur', '1/73'), t(4, 'Shroomish', '4/73'), t(29, 'Raichu-GX', '29/73'), t(55, 'Hoopa', '55/73')] },
    { slug: 'Dragon-Majesty', id: 'sm75', max: 70, marque: 'symbole Dragon Majesty, ©2018, dénominateur /70', temoins: [t(1, 'Charmander', '1/70'), t(2, 'Charmeleon', '2/70'), t(30, 'Phione', '30/70'), t(63, 'Wela Volcano Park', '63/70')] },
    { slug: 'POP-Series-5', id: 'pop5', max: 17, marque: 'symbole POP Series 5, ©2007, dénominateur /17', temoins: [t(1, 'Ho-Oh', '1/17'), t(9, 'δ Rainbow Energy', '9/17'), t(16, 'Espeon ☆', '16/17')] }
].map(l => Object.freeze({ ...l, lu: '2026-10-10' })));

const lignesDe = slug => TABLE_PTCGIO.filter(l => l.slug === slug);

/** Le numéro d'URL (entier) que cette ligne sert pour ce numéro de fiche, ou null : écrit par ce qu'il AUTORISE. */
function adresseDe(ligne, numeroFiche) {
    if (!ligne || numeroFiche == null) return null;
    const s = String(numeroFiche).trim();
    const m = ligne.suffixe ? new RegExp(`^(\\d{1,3})${ligne.suffixe}$`).exec(s) : ligne.prefixe ? new RegExp(`^${ligne.prefixe}(\\d{1,3})$`).exec(s) : /^0*(\d{1,3})$/.exec(s);
    if (!m) return null;
    const n = Number(m[1]);
    return n >= 1 && n <= ligne.max ? n : null;
}
const urlHires = (id, n) => `${HOTE}/${id}/${n}_hires.png`;

// Les réimpressions MARQUÉES (tampon) : sans set dédié qui montre la marque, ce serait un substitut. ÉNUMÉRÉ, par le nom Cardmarket du set.
const SUBSTITUTS = [/Prize-Pack/i, /^Battle-Academy/i, /^WCD-/i];
function verdictDuSet(slug) {
    if (SUBSTITUTS.some(r => r.test(String(slug)))) return { verdict: 'substitut-interdit', motif: `${slug} : réimpression marquée sans set dédié prouvé chez pokemontcg.io — une image serait celle d'un autre tirage (§19)` };
    if (lignesDe(slug).length) return { verdict: 'prouve', motif: `${slug} : ${lignesDe(slug).map(l => l.id).join(', ')}` };
    return { verdict: 'non-apparie', motif: `${slug} : aucun set pokemontcg.io prouvé par l'image` };
}

/**
 * LE PLAN, pur : chaque trou (carte, numéro) reçoit l'adresse de SON numéro dans la ligne prouvée, ou un MOTIF. Un trou déjà servi (au
 * même numéro, ou sans numéro dans le set) n'y figure jamais — additif.
 * @param {{slug: string, trous: Array<{carte: object, numeroFiche: string|null, idProduct: number}>}} o
 */
function planifierPtcgio({ slug, trous }) {
    const V = verdictDuSet(slug), lignes = lignesDe(slug);
    const vus = new Set(), plan = [], restes = [];
    for (const x of trous) {
        // 🔴 LE NUMÉRO QUI FAIT L'ADRESSE EST CELUI DU PRODUIT CARDMARKET (`numeroCm`), pas `numeroFiche` : une réimpression porte en fiche le
        // numéro de la carte d'ORIGINE (Celebrations, classic collection : « 15 Venusaur » = n° 15 de Base Set, et le n° 15 de cel25 est Lunala).
        // `numeroFiche` ne sert qu'à CONTREDIRE : s'il porte un numéro, ses chiffres doivent être ceux de l'adresse.
        const numero = x.numeroFiche ?? x.numeroCm ?? null;       // celui que l'entrée `cartes.images` portera (comme les autres sources)
        const base = { carteId: x.carte._id, nomEn: x.carte.nomEn ?? null, numero, idProduct: x.idProduct };
        if (V.verdict !== 'prouve') { restes.push({ ...base, motif: V.verdict }); continue; }
        if (T.dejaServi(x.carte, slug, numero)) continue;
        if (x.numeroCm == null || !cleNumero(x.numeroCm)) { restes.push({ ...base, motif: 'sans-numero' }); continue; }
        let hit = null;
        for (const l of lignes) { const n = adresseDe(l, x.numeroCm); if (n != null) { hit = { l, n }; break; } }
        if (!hit) { restes.push({ ...base, motif: 'numero-hors-set' }); continue; }
        if (x.numeroFiche != null) {
            const chiffres = /\d+/.exec(String(x.numeroFiche));
            if (!chiffres || Number(chiffres[0]) !== hit.n) { restes.push({ ...base, motif: 'numero-contradictoire' }); continue; }
        }
        const cle = `${x.carte._id}|${hit.l.id}|${hit.n}`;
        if (vus.has(cle)) continue;
        vus.add(cle);
        plan.push({ ...base, ligneId: hit.l.id, n: hit.n, url: urlHires(hit.l.id, hit.n), voie: 'set-prouve+numero',
            preuve: `images.pokemontcg.io set ${hit.l.id} n°${hit.n} ; numéro identique au nôtre (Cardmarket ${x.numeroCm}${x.numeroFiche != null ? `, fiche ${x.numeroFiche}` : ''}) ; set prouvé à l'œil le ${hit.l.lu} sur ${hit.l.temoins.map(w => `n°${w.n} ${w.nom} ${w.imprime}`).join(', ')} ; marque : ${hit.l.marque}` });
    }
    return { plan, restes };
}

/** Les fichiers d'un set doivent partager dimensions : la MAJORITÉ STRICTE fait la règle, l'écart est refusé et nommé ; sans majorité, rien. */
function dimensionsAdmises(fichiers) {
    const compte = new Map();
    for (const f of fichiers) { const k = `${f.w}×${f.h}`; compte.set(k, (compte.get(k) || 0) + 1); }
    const top = [...compte].sort((a, b) => b[1] - a[1])[0];
    if (!top || top[1] * 2 <= fichiers.length) return { admis: [], refuses: fichiers.map(f => ({ cle: f.cle, motif: `aucune dimension majoritaire (${[...compte].map(([k, n]) => `${k}×${n}`).join(', ')})` })) };
    return {
        reference: top[0],
        admis: fichiers.filter(f => `${f.w}×${f.h}` === top[0]).map(f => f.cle),
        refuses: fichiers.filter(f => `${f.w}×${f.h}` !== top[0]).map(f => ({ cle: f.cle, motif: `${f.w}×${f.h} contre ${top[0]} pour la majorité du set` }))
    };
}

// ── LE CLIENT ───────────────────────────────────────────────────────────────────────────────────────────────────────
const transportFetch = {
    async get(url, { binaire = false } = {}) {
        let r;
        // `manual` : une redirection n'est JAMAIS suivie
        try { r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(45000) }); }
        catch (e) { throw Object.assign(new Error(`${e.name === 'TimeoutError' ? 'ETIMEDOUT' : e.cause?.code || 'ERR_NETWORK'} ${url}`), { reseau: true }); }
        const cfMitigated = r.headers.get('cf-mitigated');
        if (r.status >= 300 && r.status < 400) return { status: r.status, location: r.headers.get('location'), cfMitigated };
        const type = r.headers.get('content-type') || '';
        if (r.status === 404 || r.status === 410) return { status: r.status, type, cfMitigated };   // le corps est l'image « introuvable » : on ne le lit pas
        if (binaire && r.ok && /^image\//.test(type)) return { status: r.status, type, octets: Buffer.from(await r.arrayBuffer()), cfMitigated };
        return { status: r.status, type, texte: await r.text(), cfMitigated };
    }
};
const DEFI = /Just a moment|cf-chl|challenge-platform|g-recaptcha|h-captcha|hcaptcha|captcha|Attention Required/i;
const CHEMIN_AUTORISE = /^\/(robots\.txt|[a-z0-9-]{2,24}\/\d{1,3}_hires\.png)$/;

/**
 * Le SEUL chemin vers images.pokemontcg.io. Garde FERMÉE : aucune requête sans verrou global lié et tenu ; hôte unique, chemins ÉNUMÉRÉS
 * (robots.txt, /<id>/<n>_hires.png) ; robots.txt lu avant la première image et respecté ; cadence tenue dans une file (jamais sous 2 s) ;
 * un réessai sur une coupure ou un 5xx, puis l'échec LÈVE ; 403, 429, `cf-mitigated`, défi : BLOQUÉ, plus aucune requête.
 */
function fabriquerClientPtcgio({ transport = transportFetch, cadenceMs = CADENCE_MS, reessaiMs = REESSAI_MS, verrou = null, pause = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
    let lie = verrou, file = Promise.resolve(), dernier = 0, compte = 0, bloque = null, robots;   // robots : undefined = pas encore lu
    let cadenceEff = Math.max(CADENCE_MIN_MS, Number(cadenceMs) || 0);
    function garde() {
        if (bloque) throw bloque;
        if (!lie) throw new Error(`${SOURCE} : aucun verrou global lié (${VERROU_GLOBAL}) — pas de requête sans verrou`);
        if (lie.perdu || !lie.tenu) throw new Error(`${SOURCE} : verrou global ${lie.perdu ? 'PERDU' : 'non tenu'} — pas de requête sans verrou`);
    }
    function chemin(url) {
        let u; try { u = new URL(url); } catch { throw new Error(`${SOURCE} : adresse illisible`); }
        if (u.origin !== HOTE || u.username || u.password || u.search || u.hash || !CHEMIN_AUTORISE.test(u.pathname)) throw new Error(`${SOURCE} : « ${u.origin}${u.pathname} » hors de ce que le client autorise (${HOTE_NOM}, robots.txt et /<set>/<n>_hires.png)`);
        return { url: u.href, chemin: u.pathname };
    }
    async function une(url, o) {
        garde();
        const attente = dernier + cadenceEff - Date.now();
        if (attente > 0) await pause(attente);
        garde();
        dernier = Date.now(); compte++;
        return transport.get(url, o);
    }
    const bloquer = (r, url) => { bloque = Object.assign(new Error(`${SOURCE} BLOQUÉ (HTTP ${r.status}${r.cfMitigated ? `, cf-mitigated ${r.cfMitigated}` : ''}) sur ${url} — on s'arrête, plus aucune requête`), { bloque: true, status: r.status }); throw bloque; };
    const defi = r => r.status === 403 || r.status === 429 || !!r.cfMitigated || (typeof r.texte === 'string' && DEFI.test(r.texte.slice(0, 5000)));
    async function assurerRobots() {
        if (robots !== undefined) return;
        const r = await une(`${HOTE}/robots.txt`, {});
        if (defi(r)) bloquer(r, `${HOTE}/robots.txt`);
        if (r.status === 404 || r.status === 410) { robots = null; return; }
        if (r.status !== 200) throw Object.assign(new Error(`${r.status} ${HOTE}/robots.txt : robots.txt illisible — on ne peut pas conclure, aucune image`), { robots: true, status: r.status });
        robots = r.texte ?? '';
        const d = T.delaiDesRobots(robots, UA);
        if (d && d > CRAWL_DELAY_MAX_S) { bloque = Object.assign(new Error(`${SOURCE} : robots.txt demande un Crawl-delay de ${d} s — on s'arrête`), { bloque: true, robots: true }); throw bloque; }
        if (d) cadenceEff = Math.max(cadenceEff, d * 1000);
    }
    const enFile = fn => { const p = file.then(fn); file = p.catch(() => { }); return p; };
    async function image(url) {
        garde();
        const c = chemin(url);
        return enFile(async () => {
            await assurerRobots();
            if (!T.autoriseParRobots(robots, c.chemin, UA)) throw Object.assign(new Error(`${SOURCE} : robots.txt interdit ${c.chemin} — aucune requête`), { robots: true });
            let r;
            try { r = await une(c.url, { binaire: true }); }
            catch (e) { if (!e.reseau) throw e; await pause(reessaiMs); r = await une(c.url, { binaire: true }); }
            if (r.status >= 500) { await pause(reessaiMs); r = await une(c.url, { binaire: true }); }
            if (defi(r)) bloquer(r, c.url);
            if (r.status >= 300 && r.status < 400) throw new Error(`${SOURCE} : redirection ${r.status} non suivie sur ${c.url}`);
            if (r.status === 404 || r.status === 410) return null;
            if (r.status >= 400) throw Object.assign(new Error(`${r.status} ${c.url}`), { status: r.status });
            if (!r.octets) throw new Error(`${SOURCE} : « ${r.type} » n'est pas une image (${c.url})`);
            return r.octets;
        });
    }
    return { image, lier(v) { lie = v; }, compteRequetes: () => compte, requetesParHote: () => ({ [HOTE_NOM]: compte }), cadence: () => cadenceEff, bloque: () => bloque };
}

// ── L'IDENTIFIANT ET LE RETRAIT EN UN LOT ───────────────────────────────────────────────────────────────────────────────
const idImagePtcgio = (slug, carteId, numero) => `${SOURCE}/${slug}/${carteId}/${String(numero ?? '').replace(/[^0-9A-Za-z]/g, '') || 'sans-numero'}/en`;
/** Ce qu'un retrait en un lot retire : les entrées `cartes.images` de CETTE source ET de CE lot — rien d'autre — et leurs clés R2 (vignette comprise). */
function planRetraitPtcgio(cartes) {
    const touchees = [], cles = [];
    let entrees = 0;
    for (const c of cartes) {
        const es = (c.images || []).filter(e => e.source === SOURCE && e.lot === LOT);
        if (!es.length) continue;
        touchees.push(c._id); entrees += es.length; cles.push(...es.flatMap(e => [e.cleR2, e.vignette?.cleR2].filter(Boolean)));
    }
    return { cartes: touchees, entrees, cles };
}

module.exports = {
    SOURCE, HOTE, HOTE_NOM, LOT, MENTION, CADENCE_MS, CADENCE_MIN_MS, VERROU_GLOBAL, VERROU_GLOBAL_MS, ID_ALERTE, UA,
    TABLE_PTCGIO, lignesDe, adresseDe, urlHires, verdictDuSet, planifierPtcgio, dimensionsAdmises,
    fabriquerClientPtcgio, idImagePtcgio, planRetraitPtcgio
};
