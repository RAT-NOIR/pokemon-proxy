// ============================================================
// LES SOURCES OFFICIELLES THE POKÉMON COMPANY — TPC Asie (asia.pokemon-card.com : tw, id, th) et pokemon-card.com (japonais)
// ============================================================
// 🔑 DÉCISION DE L'ÉDITEUR (2026-10-07, soir) : feu vert pour TPC Asie et pokemon-card.com, impression EXACTE seulement ; TPC Chine
// FERMÉ (pas de base publique). Règles non négociables, et chacune a sa ligne ici :
//   · rien de chiffré ni de protégé, robots.txt respecté, cadence lente     → `fabriquerClientTpc` (robots lu avant toute page, 10 s)
//   · si une source bloque, on s'arrête                                       → `bloque` : 403, 429, défi, captcha — plus AUCUNE requête
//   · preuve de correspondance pour chaque visuel (numéro + nom + set)        → `preuveDeCorrespondance` ; un doute est un TROU
//   · jamais d'« illustration sœur »                                          → `planifierTpc` : la fiche de SON numéro, ou rien
//   · chaque visuel porte sa source et la mention, retirable en UN lot        → `MENTION`, `LOT`, `planRetrait`
// ⚠️ Ce que ces sites disent d'eux-mêmes (lu les 2026-09-23 et 24, §54, §57) : leurs conditions réservent la copie et la diffusion.
// L'ouverture est une décision de l'éditeur, pas une lecture de ces conditions : c'est pourquoi tout ce qui vient d'ici doit pouvoir
// partir en un seul lot (`retirer-visuels-tpc.js`).
const { normaliserNom, cleNumero } = require('./jointure');

// Les sites autorisés, écrits par ce qu'ils AUTORISENT (§51) : un site absent d'ici lève à la construction du client.
const SITES = Object.freeze({
    'tpc-asie': { hote: 'https://asia.pokemon-card.com', verrou: 'tpc-asie/__collecteur__', langues: { id: 'id', th: 'th', tw: 'zh-hant' } },
    'pokemon-card-com': { hote: 'https://www.pokemon-card.com', verrou: 'pokemon-card-com/__collecteur__', langues: { ja: 'ja' } }
});
const SOURCES_TPC = Object.freeze(Object.keys(SITES));
const MENTION = '© Pokémon / The Pokémon Company';
const LOT = 'tpc-2026-10';
// « cadence lente » : 10 s entre deux requêtes, la cadence des mesures du 2026-10-07 (Bulbapedia : 5 s) ; un réessai, 30 s plus tard
const CADENCE_MS = 10000;
const REESSAI_MS = 30000;
const UA = 'rat-market-catalogue/1.0 (+https://rat-market.fr ; une requete / 10 s)';
const VERROU_GLOBAL_MS = 3 * 60 * 1000;
const CRAWL_DELAY_MAX_S = 60;      // au-delà, robots.txt nous demande en fait de ne pas venir : arrêt (seconde relecture)

// ── LA LECTURE DES PAGES ────────────────────────────────────────────────────────────────────────────────────────────
const entites = s => String(s ?? '').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
const texte = s => entites(String(s ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const nombre = s => { const n = Number(String(s ?? '').replace(/[,\s]/g, '')); return s != null && String(s).trim() !== '' && Number.isFinite(n) ? n : null; };
const coupe = num => { const m = /^\s*([^/\s]+)\s*\/\s*([^/\s]+)\s*$/.exec(String(num ?? '')); return m ? [m[1], m[2]] : [String(num ?? '').trim() || null, null]; };

/** Une fiche TPC Asie (`/<l>/card-search/detail/<id>/`) : ce que la page PORTE, rien de déduit sauf la catégorie (une carte à PV est un Pokémon). */
function lireFicheAsie(html) {
    const h = String(html ?? '');
    const h1 = /<h1 class="pageHeader cardDetail">([\s\S]*?)<\/h1>/.exec(h)?.[1] ?? null;
    const marqueEvolution = h1 ? (texte(/<span class="evolveMarker">([\s\S]*?)<\/span>/.exec(h1)?.[1]) || null) : null;
    const nom = h1 ? (texte(h1.replace(/<span class="evolveMarker">[\s\S]*?<\/span>/, '')) || null) : null;
    const [numero, denominateur] = coupe(texte(/<span class="collectorNumber">([\s\S]*?)<\/span>/.exec(h)?.[1]));
    const pv = nombre(/<span class="hitPoint">HP<\/span>\s*<span class="number">\s*(\d+)\s*<\/span>/.exec(h)?.[1]);
    return {
        nom, marqueEvolution, numero, denominateur, pv,
        dex: nombre(/<div class="extraInformation">\s*<h3>\s*No\.\s*(\d+)/.exec(h)?.[1]),
        image: /<div class="cardImage">\s*<img src="([^"]+)"/.exec(h)?.[1] ?? null,
        symbole: /<span class="expansionSymbol">\s*<img src="([^"]+)"/.exec(h)?.[1] ?? null,
        degats: [...h.matchAll(/<span class="skillDamage">([\s\S]*?)<\/span>/g)].map(m => texte(m[1])),
        regulation: texte(/<span class="alpha">([\s\S]*?)<\/span>/.exec(h)?.[1]) || null,
        categorie: pv ? 'pokemon' : null
    };
}

/** Une liste TPC Asie filtrée (`?expansionCodes=X&pageNo=N`) : le nombre de cartes, de pages, et les fiches dans l'ordre de la page. */
function lireListeAsie(html) {
    const h = String(html ?? '');
    return {
        total: nombre(/class="resultNumber">\s*([\d,]+)/.exec(h)?.[1]),
        pages: nombre(/class="resultTotalPages">[^<]*?(\d+)/.exec(h)?.[1]),
        ids: [...new Set([...h.matchAll(/card-search\/detail\/(\d+)\//g)].map(m => Number(m[1])))]
    };
}

/** La réponse JSON de pokemon-card.com (`/card-search/resultAPI.php?…&pg=X&page=N`) : la page elle-même l'appelle ainsi. */
function lireApiPcc(j) {
    return { total: Number(j?.hitCnt ?? 0), pages: Number(j?.maxPage ?? 0), cartes: (j?.cardList || []).map(c => ({ id: String(c.cardID), image: c.cardThumbFile ?? null, nom: c.cardNameAltText ?? null })) };
}

/** Une fiche pokemon-card.com (`/card-search/details.php/card/<id>/regu/all`). `marque` : la marque d'extension imprimée (alt du logo). */
function lireFichePcc(html) {
    const h = String(html ?? '');
    const sub = /<div class="subtext[^"]*">([\s\S]*?)<\/div>/.exec(h)?.[1] ?? '';
    const [numero, denominateur] = coupe(texte(sub.replace(/<img[^>]*>/g, ' ')));
    const pv = nombre(/<span class="hp-num">\s*(\d+)/.exec(h)?.[1]);
    return {
        nom: texte(/<h1 class="Heading1[^"]*">([\s\S]*?)<\/h1>/.exec(h)?.[1]) || null,
        numero, denominateur, pv,
        marque: /class="img-regulation" alt="([^"]*)"/.exec(sub)?.[1] || null,
        image: /<img class="fit" src="([^"]+)"/.exec(h)?.[1] ?? null,
        illustrateur: texte(/<div class="author">[\s\S]*?<a [^>]*>([\s\S]*?)<\/a>/.exec(h)?.[1]) || null,
        categorie: pv ? 'pokemon' : null
    };
}

// ── LA PREUVE DE CORRESPONDANCE : numéro + nom + set — un doute est un trou ─────────────────────────────────────────────
// Le NOM se compare dans la même écriture seulement : le nom indonésien d'un Pokémon est son nom anglais (« Spidops »), le japonais
// de pokemon-card.com se compare à notre `nomJa`. Quand le nom est TRADUIT (thaï, chinois), il ne se compare à rien chez nous : la
// seule identité qui ne se traduit pas est celle du Pokémon — son numéro de Pokédex ET ses PV, que la fiche porte en chiffres, et la
// RÈGLE de la carte (ex, V, VMAX…) qui s'écrit en lettres latines dans toutes les langues. Un dresseur au nom traduit : un trou.
const nomCompare = s => normaliserNom(String(s ?? '').normalize('NFKC')).replace(/[・･·]/g, '');
const latin = s => /^[\x20-\x7EÀ-ɏ♂♀'’é]+$/.test(String(s ?? '').normalize('NFKC'));
// la lettre de FORME d'un Méga (« Mega Charizard X ex », « 超級噴火龍Xex ») est une règle : X et Y ne se confondent pas. Elle se lit et
// se RETIRE avant « ex » : collée à lui (« Xex »), elle cacherait le « ex » (calibration du 2026-10-07, 029/M-P).
const REGLES = [['VMAX', /VMAX/], ['VSTAR', /VSTAR/], ['V-UNION', /V-?UNION/], ['GX', /GX/], ['BREAK', /BREAK/], ['LV.X', /LV\.?X/i],
    ['forme X', /(^|[^A-Za-z])X(?=$|[^A-Za-z]|ex|EX)/], ['forme Y', /(^|[^A-Za-z])Y(?=$|[^A-Za-z]|ex|EX)/],
    ['EX', /(^|[^A-Za-z])EX($|[^A-Za-z])/], ['ex', /(^|[^A-Za-z])ex($|[^A-Za-z])/], ['V', /(^|[^A-Za-z])V($|[^A-Za-z])/],
    ['Méga', /(^|[^A-Za-z])Mega($|[^A-Za-z])|超級|เมก้า/]];
// LE POKÉDEX DE NOTRE NOM : quand notre carte n'a pas de `ndex` (fiche simple, infobox incomplète), le numéro se lit dans son nom anglais par
// la table versionnée du dépôt (pokedex-dexids.json : le nom COMPLET d'une carte TCGdex → numéro(s), construire-table-pokedex.js), avec
// la normalisation qui l'a construite (scoring.js) — la sonde lit la même chose que la production.
let TABLE_POKEDEX = null;
function dexDuNom(nom) {
    if (!nom) return null;
    if (!TABLE_POKEDEX) TABLE_POKEDEX = require('../pokedex-dexids.json');
    const { normaliserNomPourComparaison } = require('../scoring');
    const v = TABLE_POKEDEX[normaliserNomPourComparaison(String(nom).split('[')[0])];
    return Array.isArray(v) && v.length ? v : null;
}
// LES ÉNERGIES DE BASE CHINOISES (TPC Asie tw) : « 基本【火】能量 » — le caractère entre crochets EST le type, celui que les cartes
// asiatiques impriment (calibration du 2026-10-07 : 032 火, 033 超, 034 惡 /M-P). Une autre écriture ne se traduit pas : un trou.
const TYPES_ENERGIE = { '草': 'Grass', '火': 'Fire', '水': 'Water', '雷': 'Lightning', '超': 'Psychic', '鬥': 'Fighting', '惡': 'Darkness', '鋼': 'Metal' };
const energieDeBase = nom => { const m = /^基本【(.)】能量$/.exec(String(nom ?? '').trim()); return m && TYPES_ENERGIE[m[1]] ? `Basic ${TYPES_ENERGIE[m[1]]} Energy` : null; };
function reglesDuNom(nom) {
    let s = String(nom ?? '').normalize('NFKC');
    const t = [];
    for (const [k, re] of REGLES) if (re.test(s)) { t.push(k); s = s.replace(re, ' '); }
    return t.sort().join('+');
}

/**
 * @param {object} o.attendu  (TPC Asie) ce que porte la MAJORITÉ de la liste : `denominateur` numérique et `symbole` d'extension. Un
 *                            dénominateur numérique (« 165/164 ») ne nomme pas le set : sans cette comparaison, une fiche d'un autre set
 *                            au même numéro passerait si la source ignorait son propre filtre (relecture du 2026-10-07).
 */
function preuveDeCorrespondance({ fiche, carte, numeroFiche, code, site, attendu = {} }) {
    const refus = (motif, detail) => ({ ok: false, motif, detail });
    if (!SITES[site]) return refus('site', `site « ${site} » hors de la liste des sources officielles`);
    if (!fiche?.numero || !numeroFiche || cleNumero(fiche.numero) !== cleNumero(numeroFiche)) return refus('numero', `n° ${fiche?.numero ?? '—'} à la source, n° ${numeroFiche ?? '—'} chez nous`);
    // LE SET : la liste filtrée par la source elle-même (l'appelant ne lit que celle-là) ; et quand le numéro imprimé porte un code
    // (« 001/SV-P »), ou que pokemon-card.com imprime la marque d'extension (« SD »), ce code doit être celui de l'unité
    if (site === 'pokemon-card-com') { if (!fiche.marque || fiche.marque.toUpperCase() !== String(code).toUpperCase()) return refus('set', `marque « ${fiche.marque ?? '—'} » pour le code ${code}`); }
    else {
        if (fiche.denominateur && /[A-Za-z]/.test(fiche.denominateur) && fiche.denominateur.toUpperCase() !== String(code).toUpperCase()) return refus('set', `n° ${fiche.numero}/${fiche.denominateur} pour le code ${code}`);
        if (/^\d+$/.test(fiche.denominateur || '') && attendu.denominateur && fiche.denominateur !== attendu.denominateur) return refus('set', `n° ${fiche.numero}/${fiche.denominateur} dans une liste à /${attendu.denominateur}`);
        if (fiche.symbole && attendu.symbole && fiche.symbole !== attendu.symbole) return refus('set', `symbole « ${fiche.symbole} » dans une liste au symbole « ${attendu.symbole} »`);
    }
    const dexNotre = Number(carte?.ndex) || null, pvNotre = Number(carte?.pv) || null;
    if (fiche.dex && dexNotre && fiche.dex !== dexNotre) return refus('contradiction-pokedex', `Pokédex ${fiche.dex} à la source, ${dexNotre} chez nous`);
    if (fiche.pv && pvNotre && fiche.pv !== pvNotre) return refus('contradiction-pv', `PV ${fiche.pv} à la source, ${pvNotre} chez nous`);
    const nomNotre = site === 'pokemon-card-com' ? carte?.nomJa : carte?.nomEn;
    const ici = `${site} fiche ${fiche.idFiche ?? '?'} : n° ${fiche.numero}${fiche.denominateur ? `/${fiche.denominateur}` : ''}, nom « ${fiche.nom} »`;
    const ok = (voie, plus = '') => ({ ok: true, voie, preuve: `${ici}${plus} ; set ${code} (liste filtrée par la source)` });
    if (nomNotre && fiche.nom && nomCompare(nomNotre) === nomCompare(fiche.nom)) return ok('nom', ` = « ${nomNotre} »${fiche.dex && dexNotre ? `, Pokédex ${fiche.dex}` : ''}${fiche.pv && pvNotre ? `, PV ${fiche.pv}` : ''}`);
    if (site === 'tpc-asie') {
        // l'énergie de base au nom chinois : son type, et rien d'autre
        const e = energieDeBase(fiche.nom);
        if (e) return carte?.nomEn && nomCompare(e) === nomCompare(carte.nomEn) ? ok('energie-de-base', ` = « ${carte.nomEn} » (le type entre crochets)`) : refus('nom-different', `« ${fiche.nom} » est « ${e} », « ${carte?.nomEn ?? '—'} » chez nous`);
        // un Pokémon au nom traduit : son Pokédex (le nôtre, ou celui de NOTRE nom anglais) et sa règle ; ses PV quand nous les avons
        const dexNom = dexDuNom(carte?.nomEn);
        if (fiche.dex && dexNom && !dexNom.includes(fiche.dex)) return refus('contradiction-pokedex', `Pokédex ${fiche.dex} à la source ; notre nom « ${carte.nomEn} » est le n° ${dexNom.join('/')}`);
        const dexRef = dexNotre ?? (dexNom?.length === 1 ? dexNom[0] : null);
        if (fiche.categorie === 'pokemon' && (carte?.categorie === 'pokemon' || carte?.categorie == null) && fiche.dex && dexRef === fiche.dex) {
            if (reglesDuNom(fiche.nom) !== reglesDuNom(carte.nomEn)) return refus('suffixe', `règle « ${reglesDuNom(fiche.nom) || '—'} » à la source, « ${reglesDuNom(carte.nomEn) || '—'} » pour « ${carte.nomEn} »`);
            if (fiche.pv && pvNotre) return ok('pokedex+pv', ` (nom traduit) — Pokédex ${fiche.dex} et PV ${fiche.pv} = « ${carte.nomEn} »${dexNotre ? '' : ' (n° lu dans notre nom, pokedex-dexids.json)'}`);
            return ok(dexNotre ? 'pokedex' : 'pokedex-du-nom', ` (nom traduit) — Pokédex ${fiche.dex} = « ${carte.nomEn} »${dexNotre ? '' : ' (n° lu dans notre nom, pokedex-dexids.json)'}, règle « ${reglesDuNom(carte.nomEn) || 'aucune'} »`);
        }
    }
    const memeEcriture = site === 'pokemon-card-com' ? !!nomNotre : latin(fiche.nom) && !!nomNotre;
    return refus(memeEcriture ? 'nom-different' : 'nom-non-comparable', `« ${fiche.nom ?? '—'} » à la source, « ${nomNotre ?? carte?.nomEn ?? '—'} » chez nous`);
}

/**
 * LE PLAN, pur : chaque trou (carte, numéro) reçoit la fiche de SON numéro — une seule, prouvée — ou un MOTIF. Deux produits au même
 * (carte, numéro) ne font qu'un visuel ; deux fiches au même numéro à la source ne désignent rien.
 * @param {{trous: Array<{carte: object, numeroFiche: string|null, idProduct: number}>, fiches: object[], code: string, site: string}} o
 */
function planifierTpc({ trous, fiches, code, site }) {
    // ce que porte la majorité de la liste (preuveDeCorrespondance, `attendu`) ; une égalité de voix n'élit personne
    const majorite = xs => { const m = new Map(); for (const x of xs) if (x != null) m.set(x, (m.get(x) || 0) + 1); const t = [...m].sort((a, b) => b[1] - a[1]); return t.length && (t.length === 1 || t[0][1] > t[1][1]) ? t[0][0] : null; };
    const attendu = { denominateur: majorite(fiches.map(f => /^\d+$/.test(f.denominateur || '') ? f.denominateur : null)), symbole: majorite(fiches.map(f => f.symbole ?? null)) };
    const parNumero = new Map();
    for (const f of fiches) { const k = cleNumero(f.numero); if (!f.numero || !k) continue; (parNumero.get(k) || parNumero.set(k, []).get(k)).push(f); }
    const vus = new Set(), plan = [], restes = [];
    for (const t of trous) {
        const k = t.numeroFiche ? cleNumero(t.numeroFiche) : null;
        const cle = `${t.carte._id}|${k ?? `sans-numero:${t.idProduct}`}`;
        if (vus.has(cle)) continue;
        vus.add(cle);
        const base = { carteId: t.carte._id, nomEn: t.carte.nomEn ?? null, numero: t.numeroFiche ?? null, idProduct: t.idProduct };
        if (!k) { restes.push({ ...base, motif: 'sans-numero' }); continue; }
        const c = parNumero.get(k) || [];
        if (!c.length) { restes.push({ ...base, motif: 'absente-de-la-source' }); continue; }
        if (c.length > 1) { restes.push({ ...base, motif: 'numero-ambigu-a-la-source', detail: c.map(f => f.idFiche).join(', ') }); continue; }
        const p = preuveDeCorrespondance({ fiche: c[0], carte: t.carte, numeroFiche: t.numeroFiche, code, site, attendu });
        if (!p.ok) { restes.push({ ...base, motif: p.motif, detail: p.detail }); continue; }
        plan.push({ ...base, fiche: c[0], voie: p.voie, preuve: p.preuve });
    }
    return { plan, restes };
}

/** ADDITIF : un (carte, set, numéro) qui a déjà un visuel — au même numéro, ou sans numéro dans le set — n'est jamais touché. */
const dejaServi = (carte, set, numero) => (carte?.images || []).some(e => e.set === set && (e.numero == null || cleNumero(e.numero) === cleNumero(numero)));

// ── ROBOTS.TXT ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Le groupe de notre agent s'il existe, sinon celui de « * » ; la règle la plus LONGUE qui correspond décide, Allow à égalité.
// `null` (pas de robots.txt : 404) n'interdit rien. Un robots.txt illisible, lui, ne se lit pas comme vide : le client s'arrête.
/** Le groupe de robots.txt qui s'applique à notre agent (le sien, sinon « * ») : ses règles et son Crawl-delay. */
function groupeDesRobots(texteRobots, agent = UA) {
    if (texteRobots == null) return { regles: [], delai: null };
    const groupes = [];
    let courant = null, dansAgents = false;
    for (const brut of String(texteRobots).split(/\r?\n/)) {
        const l = brut.replace(/#.*$/, '').trim();
        const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(l);
        if (!m) continue;
        const cle = m[1].toLowerCase(), val = m[2].trim();
        if (cle === 'user-agent') { if (!courant || !dansAgents) { courant = { agents: [], regles: [], delai: null }; groupes.push(courant); } courant.agents.push(val.toLowerCase()); dansAgents = true; }
        else {
            dansAgents = false;
            if (courant && (cle === 'allow' || cle === 'disallow')) courant.regles.push({ allow: cle === 'allow', motif: val });
            if (courant && cle === 'crawl-delay' && Number(val) > 0) courant.delai = Number(val);
        }
    }
    const a = String(agent).toLowerCase();
    const propres = groupes.filter(g => g.agents.some(x => x !== '*' && a.includes(x)));
    const choisis = propres.length ? propres : groupes.filter(g => g.agents.includes('*'));
    const delais = choisis.map(g => g.delai).filter(Boolean);
    return { regles: choisis.flatMap(g => g.regles), delai: delais.length ? Math.max(...delais) : null };
}
/** Le Crawl-delay (en secondes) que robots.txt demande à notre agent, ou null. */
const delaiDesRobots = (texteRobots, agent = UA) => groupeDesRobots(texteRobots, agent).delai;
function autoriseParRobots(texteRobots, chemin, agent = UA) {
    if (texteRobots == null) return true;
    const { regles } = groupeDesRobots(texteRobots, agent);
    const correspond = motif => new RegExp('^' + motif.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*').replace(/\\\$$/, '$')).test(chemin);
    let meilleur = null;
    for (const r of regles) if (r.motif && correspond(r.motif) && (!meilleur || r.motif.length > meilleur.motif.length || (r.motif.length === meilleur.motif.length && r.allow))) meilleur = r;
    return !meilleur || meilleur.allow;
}

// ── LE CLIENT ───────────────────────────────────────────────────────────────────────────────────────────────────────
const transportFetch = {
    async get(url, { binaire = false } = {}) {
        let r;
        const entetes = { 'User-Agent': UA, ...(url.startsWith('https://www.pokemon-card.com/card-search/') ? { Referer: 'https://www.pokemon-card.com/card-search/' } : {}) };
        // `manual` : une redirection n'est JAMAIS suivie par fetch — le client la juge (même site, robots.txt, trois sauts au plus)
        try { r = await fetch(url, { headers: entetes, redirect: 'manual', signal: AbortSignal.timeout(45000) }); }
        catch (e) { throw Object.assign(new Error(`${e.name === 'TimeoutError' ? 'ETIMEDOUT' : e.cause?.code || 'ERR_NETWORK'} ${url}`), { reseau: true }); }
        if (r.status >= 300 && r.status < 400) return { status: r.status, location: r.headers.get('location') };
        const type = r.headers.get('content-type') || '';
        if (binaire && r.ok && /^image\//.test(type)) return { status: r.status, type, octets: Buffer.from(await r.arrayBuffer()) };
        return { status: r.status, type, texte: await r.text() };
    }
};
const DEFI = /Just a moment|cf-chl|challenge-platform|g-recaptcha|h-captcha|hcaptcha|captcha/i;

/**
 * Le SEUL chemin vers un site TPC. Garde FERMÉE : aucune requête sans verrou global lié, tenu et non perdu ; robots.txt lu avant la
 * première page et respecté ; cadence tenue dans une FILE (deux appelants concurrents attendent leur tour) ; un réessai sur une coupure
 * ou un 5xx, puis l'échec LÈVE ; 403, 429, défi ou captcha : BLOQUÉ — l'erreur est retenue et plus aucune requête ne part.
 */
function fabriquerClientTpc({ site, transport = transportFetch, cadenceMs = CADENCE_MS, reessaiMs = REESSAI_MS, verrou = null, agent = UA } = {}) {
    const S = SITES[site];
    if (!S) throw new Error(`TPC : site « ${site} » hors de la liste (${SOURCES_TPC.join(', ')})`);
    let lie = verrou, file = Promise.resolve(), dernier = 0, compte = 0, bloque = null, robots;   // robots : undefined = pas encore lu
    let cadenceEff = cadenceMs;                                     // relevée par un Crawl-delay plus lent, jamais abaissée
    const pause = ms => new Promise(r => setTimeout(r, ms));
    function garde() {
        if (bloque) throw bloque;
        if (!lie) throw new Error(`${site} : aucun verrou global lié (${S.verrou}) — pas de requête sans verrou`);
        if (lie.perdu || !lie.tenu) throw new Error(`${site} : verrou global ${lie.perdu ? 'PERDU' : 'non tenu'} — pas de requête sans verrou`);
    }
    async function une(url, o) {
        garde();
        const attente = dernier + cadenceEff - Date.now();
        if (attente > 0) await pause(attente);
        garde();                                                     // le verrou a pu être perdu pendant l'attente
        dernier = Date.now(); compte++;
        return transport.get(url, o);
    }
    const bloquer = (r, url) => { bloque = Object.assign(new Error(`${site} BLOQUÉ (HTTP ${r.status}) sur ${url} — on s'arrête, plus aucune requête`), { bloque: true, status: r.status }); throw bloque; };
    async function requete(url, o = {}) {
        let courant = url;
        for (let saut = 0; ; saut++) {
            let r;
            try { r = await une(courant, o); }
            catch (e) { if (!e.reseau) throw e; await pause(reessaiMs); r = await une(courant, o); }
            if (r.status >= 500) { await pause(reessaiMs); r = await une(courant, o); }
            if (r.status === 403 || r.status === 429 || (typeof r.texte === 'string' && DEFI.test(r.texte.slice(0, 5000)))) bloquer(r, courant);
            // une REDIRECTION (relecture du 2026-10-07) : suivie seulement sur le même site, le chemin d'arrivée relu par robots.txt
            if (r.status >= 300 && r.status < 400) {
                if (saut >= 3) throw new Error(`${site} : plus de 3 redirections depuis ${url} — on ne suit pas une boucle`);
                if (!r.location) throw new Error(`${site} : redirection ${r.status} sans adresse sur ${courant}`);
                const c = chemin(new URL(r.location, courant).href);       // lève si l'hôte n'est pas celui du site
                if (!autoriseParRobots(robots, c.chemin, agent)) throw Object.assign(new Error(`${site} : robots.txt interdit ${c.chemin} (redirection depuis ${url})`), { robots: true });
                courant = c.url;
                continue;
            }
            if (r.status === 404 || r.status === 410) return null;
            if (r.status >= 400) throw Object.assign(new Error(`${r.status} ${courant}`), { status: r.status });
            return r;
        }
    }
    async function assurerRobots() {
        if (robots !== undefined) return;
        // robots.txt redirigé SUR LE MÊME SITE se suit (trois sauts) ; ailleurs, ou illisible, on ne peut pas conclure : AUCUNE page, mais
        // une erreur passagère, jamais un blocage durable de la source (seconde relecture du 2026-10-07 : l'alerte ne se lève qu'à la main)
        let url = `${S.hote}/robots.txt`, r;
        for (let saut = 0; ; saut++) {
            r = await une(url, {});
            if (!(r.status >= 300 && r.status < 400 && r.location && saut < 3)) break;
            const u = new URL(r.location, url);
            if (u.origin !== S.hote) break;
            url = u.href;
        }
        if (r.status === 404 || r.status === 410) { robots = null; return; }
        if (r.status !== 200) throw Object.assign(new Error(`${r.status} ${url} : robots.txt illisible — on ne peut pas conclure, aucune page`), { robots: true, status: r.status });
        robots = r.texte ?? '';
        const d = delaiDesRobots(robots, agent);
        // un Crawl-delay au-delà d'une minute : le site demande qu'on ne vienne pas à une cadence utile — on s'arrête, c'est une décision
        if (d && d > CRAWL_DELAY_MAX_S) { bloque = Object.assign(new Error(`${site} : robots.txt demande un Crawl-delay de ${d} s (au-delà de ${CRAWL_DELAY_MAX_S} s) — on s'arrête`), { bloque: true, robots: true }); throw bloque; }
        if (d) cadenceEff = Math.max(cadenceEff, d * 1000);
    }
    const enFile = fn => { const p = file.then(fn); file = p.catch(() => { }); return p; };
    const chemin = url => { const u = new URL(url, S.hote); if (u.origin !== S.hote) throw new Error(`${site} : hôte « ${u.origin} » hors du site (${S.hote})`); return { url: u.href, chemin: u.pathname + u.search }; };
    async function obtenir(url, o) {
        return enFile(async () => {
            const c = chemin(url);
            await assurerRobots();
            if (!autoriseParRobots(robots, c.chemin, agent)) throw Object.assign(new Error(`${site} : robots.txt interdit ${c.chemin} — aucune requête`), { robots: true });
            return requete(c.url, o);
        });
    }
    return {
        site, hote: S.hote,
        lier(v) { lie = v; },
        page: async url => (await obtenir(url))?.texte ?? null,
        json: async url => { const r = await obtenir(url); if (r == null) return null; try { return JSON.parse(r.texte); } catch { throw new Error(`${site} : réponse non JSON sur ${url}`); } },
        image: async url => { const r = await obtenir(url, { binaire: true }); if (r == null) return null; if (!r.octets) throw new Error(`${site} : « ${r.type} » n'est pas une image (${url})`); return r.octets; },
        compteRequetes: () => compte,
        cadence: () => cadenceEff,
        bloque: () => bloque
    };
}

// ── L'IDENTIFIANT, L'ALERTE, ET LE RETRAIT EN UN LOT ────────────────────────────────────────────────────────────────────
// Une source qui a bloqué porte une alerte active dans `collecte_images_etat` : le collecteur ne lui demande plus rien, l'alimentateur
// ne l'enfile plus — elle ne se rouvre que par une décision (l'alerte désactivée à la main).
const idAlerteBloquee = site => `alerte/source-bloquee/${site}`;
const idImageTpc = (site, slug, carteId, numero, langue) => `${site}/${slug}/${carteId}/${String(numero ?? '').replace(/[^0-9A-Za-z]/g, '') || 'sans-numero'}/${langue}`;
/** Ce qu'un retrait en un lot retirerait : les entrées de `cartes.images` dont la source est TPC, carte par carte, et leurs clés R2. */
function planRetrait(cartes) {
    const touchees = [], cles = [];
    let entrees = 0;
    for (const c of cartes) {
        const es = (c.images || []).filter(e => SOURCES_TPC.includes(e.source));
        if (!es.length) continue;
        // la vignette de l'entrée (collecte-cartes/vignette.js, `vignettes/…`) part avec elle (relecture du 2026-10-07)
        touchees.push(c._id); entrees += es.length; cles.push(...es.flatMap(e => [e.cleR2, e.vignette?.cleR2].filter(Boolean)));
    }
    return { cartes: touchees, entrees, cles };
}

module.exports = {
    SITES, SOURCES_TPC, MENTION, LOT, CADENCE_MS, VERROU_GLOBAL_MS, UA,
    lireFicheAsie, lireListeAsie, lireApiPcc, lireFichePcc,
    preuveDeCorrespondance, planifierTpc, dejaServi, reglesDuNom, nomCompare,
    autoriseParRobots, delaiDesRobots, fabriquerClientTpc, idImageTpc, idAlerteBloquee, planRetrait
};
