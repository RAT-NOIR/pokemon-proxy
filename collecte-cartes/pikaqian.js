// ============================================================
// PIKAQIAN (pikaqian.com, images.pikaqian.com) — visuels zh-hans MANQUANTS, tirage exact (2026-10-11)
// ============================================================
// 🔑 DÉCISION DU TESTEUR (2026-10-11) : « PikaQian : FEU VERT, en basse priorité. Mêmes conditions que les bases TPC (à mes risques, retrait
// possible en un seul lot) : provenance enregistrée, seuil de 300 px pour cette source officielle (usage : vignette de 157 px), arrêt au
// premier défi ou à la première erreur répétée. » Pages publiques seulement, jamais `/api/`, aucun compte, robots.txt respecté, rien de payant.
//
// CE QUE LA SOURCE EST, MESURÉ le 2026-10-10 (MESURE-PIKAQIAN.md) : un site de prix d'un tiers, sans condition publiée (« aucune condition
// trouvée » n'est pas « autorisé » : c'est pour cela que tout part en un lot), Cloudflare en simple CDN, aucun défi. Une page de SET
// (`/sets/<code minuscule>`) est du HTML rendu serveur qui porte toutes les tuiles : nom, code de set, numéro, adresse de l'image
// (`images.pikaqian.com/<code>/<uuid>.webp`, WebP 300 × 419). Les images sont des COPIES des visuels officiels de pokemon.cn (champ
// `native_image_url` = cdn.pokemon-tcg.cn) : c'est la réserve que le §78 range sous des conditions « copie interdite sans accord écrit »,
// et c'est la raison de la PROVENANCE écrite sur chaque visuel et du retrait en un geste.
//
// 🔑 L'APPARIEMENT SE PROUVE PAR PRODUIT : code de set (les tuiles de la page sont toutes au code du set) + numéro + la tuile SANS suffixe de
// foil, UNIQUE à ce numéro + nom anglais concordant (la normalisation de la production, `nomCompare`). Une variante de foil du même
// numéro est un AUTRE produit ; deux tuiles sans foil au même numéro ne désignent rien ; un nom qui diverge est un trou. Un doute est un trou.
const T = require('./tpc');
const { cleNumero } = require('./jointure');
const { estPassive, motifPassif } = require('./source-passive');

const SOURCE = 'pikaqian';
const HOTE_PAGES = 'pikaqian.com';
const HOTE_IMAGES = 'images.pikaqian.com';
const LOT = 'pikaqian-2026-10';
const MENTION = T.MENTION;                                  // une seule mention pour toutes nos sources de scans (§75)
const CADENCE_MS = 10000;                                   // la cadence des sources officielles (tpc.js) : jamais en dessous
const UA = T.UA;                                            // l'agent du dépôt
const VERROU_GLOBAL = 'pikaqian/__collecteur__';
const VERROU_GLOBAL_MS = 3 * 60 * 1000;
const ID_ALERTE = 'alerte/source-bloquee/pikaqian';
const ID_SUITE = 'etat/echecs-de-suite/pikaqian';          // le compteur d'échecs de suite, persisté entre deux unités (collecte_images_etat)
const CRAWL_DELAY_MAX_S = 60;
const LANGUE = 'zh-hans';
const ECHECS_DE_SUITE_MAX = 2;                              // « deux échecs de suite » : la première erreur RÉPÉTÉE arrête
const PROVENANCE_PAR_DEFAUT = 'origine non déclarée par la page (la mesure du 2026-10-10 relève que pikaqian reprend le canal officiel chinois)';
const PAGE_MAX_OCTETS = 8 * 1024 * 1024, IMAGE_MAX_OCTETS = 2 * 1024 * 1024;   // une page de 700 tuiles pèse 1,5 Mo, une image 35 Ko

// ── LA LECTURE DE LA PAGE DE SET ─────────────────────────────────────────────────────────────────────────────────────
// Une tuile : `<a … href="/cards/<uuid>"> … <img alt="Nom" src="https://images.pikaqian.com/<code>/<uuid>.webp"> … <h2>Nom</h2><p>csv10c<!-- --> · 007</p>`.
// La page est découpée aux ancres de cartes : chaque corps est borné (aucun retour arrière quadratique sur 1,5 Mo), et une ancre sans
// image, sans titre ou sans « code · numéro » n'est pas une tuile (elle ne sert à rien : comptée par l'appelant).
const CORPS_MAX = 6000;
function lireTuiles(html) {
    const h = String(html ?? '');
    const parts = h.split(/<a\s[^>]*?href="\/cards\//);
    const tuiles = [];
    for (const part of parts.slice(1)) {
        const id = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/.exec(part)?.[1];
        if (!id) continue;
        const fin = part.indexOf('</a>');
        const corps = part.slice(0, fin < 0 || fin > CORPS_MAX ? CORPS_MAX : fin);
        const img = /<img\s[^>]*?src="([^"]+)"/.exec(corps)?.[1] ?? null;
        const titre = /<h2[^>]*>([^<]*)<\/h2>/.exec(corps)?.[1] ?? null;
        const ref = /<p[^>]*>\s*([^<·]*?)\s*(?:<!--\s*-->)?\s*·\s*([^<]*?)\s*<\/p>/.exec(corps);
        if (!img || titre == null || !ref || !ref[1] || !ref[2]) continue;
        const nom = T.entites(titre).replace(/\s+/g, ' ').trim();
        if (!nom) continue;
        tuiles.push({ id, nom, code: ref[1].trim().toLowerCase(), numero: T.entites(ref[2]).trim(), img: T.entites(img) });
    }
    return tuiles;
}
/**
 * Les adresses d'ORIGINE que la page DÉCLARE, pour les cartes dont elle embarque les données : Map(uuid → { native, officielle }). Vide sinon.
 * 🔑 MESURÉ le 2026-10-11 sur /sets/cs1bc : la page de set n'embarque (dans son flux Remix) les données que d'UNE carte sur 315, et pour elle
 * `native_image_url` pointe pokipair.com (un site tiers), PAS cdn.pokemon-tcg.cn ; l'adresse officielle est `we_chat_image_url`
 * (cdn.pokemon-tcg.cn/cards/…). `officielle` ne vaut donc que si elle est chez cdn.pokemon-tcg.cn ; `native` est rapportée telle que déclarée.
 * Le flux est du JSON échappé dans un <script> : on le lit à plat, par blocs « "id","<uuid>" … » (jamais deviné pour une carte absente).
 */
function lireOrigines(html) {
    const plat = String(html ?? '').replace(/\\+"/g, '"');
    const sorties = new Map();
    const ids = [...plat.matchAll(/"id","([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/g)];
    for (const [i, m] of ids.entries()) {
        const fin = Math.min(ids[i + 1]?.index ?? Infinity, m.index + 6000);
        const bloc = plat.slice(m.index, fin);
        const native = /"native_image_url","(https?:\/\/[^"]+)"/.exec(bloc)?.[1] ?? null;
        const weChat = /"we_chat_image_url","(https?:\/\/[^"]+)"/.exec(bloc)?.[1] ?? null;
        if (!native && !weChat) continue;
        sorties.set(m[1], { native, officielle: weChat && /^https:\/\/cdn\.pokemon-tcg\.cn\//.test(weChat) ? weChat : null });
    }
    return sorties;
}
/** Le nombre d'ANCRES de cartes que la page porte (`<a … href="/cards/<uuid>">`), tuiles lisibles ou non : le dénominateur de `lireTuiles` (même découpage). */
function compterAncresCartes(html) {
    return String(html ?? '').split(/<a\s[^>]*?href="\/cards\//).slice(1).filter(p => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/.test(p)).length;
}
/** Une tuile de VARIANTE de foil (le même numéro, un autre produit) : le nom se termine par « … Holo » (Reverse Holo, Pokeball Holo, Master Ball Holo…). */
const estFoil = nom => /\sHolo$/i.test(String(nom ?? '').trim());

/** Cette page désigne-t-elle ce set ? La MAJORITÉ STRICTE des tuiles porte le code du set — sinon la page n'est pas celle qu'on croit. */
function verdictDePage({ tuiles, code }) {
    const n = (tuiles || []).length, bonnes = (tuiles || []).filter(t => t.code === code).length;
    if (!n) return { ok: false, motif: `aucune tuile lisible sur la page de ${code} : la page n'a plus la forme mesurée le 2026-10-10`, tuiles: 0, bonnes: 0 };
    if (bonnes * 2 <= n) return { ok: false, motif: `${bonnes} tuiles sur ${n} portent le code ${code} : la page ne désigne pas ce set`, tuiles: n, bonnes };
    return { ok: true, tuiles: n, bonnes };
}

// ── LA PREUVE ET LE PLAN : numéro + tuile sans foil unique + nom — un doute est un trou ──────────────────────────────────
/**
 * @param {{trous: Array<{carte: object, numeroFiche: string|null, idProduct: number}>, tuiles: object[], code: string, slug: string}} o
 * Un trou déjà servi (au même numéro, ou sans numéro dans le set) n'y figure jamais — ADDITIF.
 */
function planifierPikaqian({ trous, tuiles, code, slug }) {
    const parNumero = new Map();
    for (const t of tuiles || []) { if (t.code !== code) continue; const k = cleNumero(t.numero); if (!k) continue; (parNumero.get(k) || parNumero.set(k, []).get(k)).push(t); }
    const vus = new Set(), plan = [], restes = [], suffixesInconnus = new Map();
    for (const x of trous) {
        const numero = x.numeroFiche ?? null;
        if (T.dejaServi(x.carte, slug, numero)) continue;
        const k = numero ? cleNumero(numero) : null;
        const cle = `${x.carte._id}|${k ?? `sans-numero:${x.idProduct}`}`;
        if (vus.has(cle)) continue;
        vus.add(cle);
        const base = { carteId: x.carte._id, nomEn: x.carte.nomEn ?? null, numero, idProduct: x.idProduct };
        if (!k) { restes.push({ ...base, motif: 'sans-numero' }); continue; }
        if (!x.carte.nomEn) { restes.push({ ...base, motif: 'sans-nom' }); continue; }
        const c = parNumero.get(k) || [];
        if (!c.length) { restes.push({ ...base, motif: 'absente-de-la-source' }); continue; }
        // 🔑 LA TUILE DE BASE SE DÉFINIT PAR CE QU'ELLE AUTORISE : son nom, comparé au nom du produit par la normalisation de production, ne laisse AUCUN
        // suffixe — connu (« Holo ») ou inconnu (« Rainbow Foil »). Toute tuile dont le nom prolonge le nôtre est une variante, pas la base ; les suffixes que
        // `estFoil` ne connaît pas sont COMPTÉS (suffixesInconnus) pour qu'un set non mesuré le dise à sa première lecture.
        const nomNotre = T.nomCompare(x.carte.nomEn);
        const prolonge = t => { const n = T.nomCompare(t.nom); return n.length > nomNotre.length && n.startsWith(nomNotre); };
        for (const t of c) if (prolonge(t) && !estFoil(t.nom)) suffixesInconnus.set(t.id, t.nom);
        const exactes = c.filter(t => T.nomCompare(t.nom) === nomNotre);
        if (exactes.length > 1) { restes.push({ ...base, motif: 'tuile-ambigue', detail: exactes.map(t => t.id).join(', ') }); continue; }
        if (!exactes.length) { restes.push({ ...base, motif: c.some(prolonge) ? 'tuile-a-suffixe' : 'nom-different', detail: `${c.map(t => `« ${t.nom} »`).join(' | ')} à la source, « ${x.carte.nomEn} » chez nous` }); continue; }
        const t = exactes[0];
        // l'adresse de l'image est celle DE CETTE tuile, dans le dossier de CE set : sinon la page se contredit
        if (t.img !== urlImage(code, t.id)) { restes.push({ ...base, motif: 'image-incoherente', detail: `${t.img} pour la tuile ${t.id} du set ${code}` }); continue; }
        plan.push({ ...base, tuile: t, url: t.img, voie: 'set+numero+tuile-sans-foil+nom',
            preuve: `pikaqian.com set ${code} : tuile ${t.id} n° ${t.numero}, nom « ${t.nom} » = « ${x.carte.nomEn} » ; numéro identique au nôtre (fiche ${numero}) ; seule tuile dont le nom ne laisse aucun suffixe à ce numéro (${c.length} tuile${c.length > 1 ? 's' : ''} au numéro)` });
    }
    return { plan, restes, suffixesInconnus: [...suffixesInconnus].map(([id, nom]) => ({ id, nom })) };
}

// ── LES ADRESSES ─────────────────────────────────────────────────────────────────────────────────────────────────────
const CODE_PK = /^[a-z0-9][a-z0-9.-]{0,30}$/;
const urlSet = code => { if (!CODE_PK.test(String(code))) throw new Error(`${SOURCE} : code de set « ${code} » hors du motif autorisé`); return `https://${HOTE_PAGES}/sets/${code}`; };
const urlImage = (code, id) => `https://${HOTE_IMAGES}/${code}/${id}.webp`;
const INTERDITS = /^\/(api|admin|auth|login|logout|currency)(\/|$)/i;
const CHEMINS = {
    [HOTE_PAGES]: /^\/(robots\.txt|sets\/[a-z0-9][a-z0-9.-]{0,30})$/,
    [HOTE_IMAGES]: /^\/(robots\.txt|[a-z0-9][a-z0-9.-]{0,30}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp)$/
};

// ── LE CLIENT ───────────────────────────────────────────────────────────────────────────────────────────────────────
const transportFetch = {
    async get(url, { binaire = false } = {}) {
        // ➖ 2026-10-13 : le SEUL appel réseau réel vers PikaQian est fermé — la source est passive (source-passive.js). Les bancs injectent leur propre transport.
        if (estPassive(SOURCE)) throw Object.assign(new Error(`${SOURCE} : ${motifPassif(SOURCE)} — aucune requête partie (${url})`), { passive: true, arret: true });
        let r;
        // `manual` : une redirection n'est JAMAIS suivie par fetch — le client la juge (même hôte, robots.txt, trois sauts au plus)
        try { r = await fetch(url, { headers: { 'User-Agent': UA, Accept: binaire ? 'image/webp,image/*;q=0.8' : 'text/html,*/*;q=0.5' }, redirect: 'manual', signal: AbortSignal.timeout(45000) }); }
        catch (e) { throw Object.assign(new Error(`${e.name === 'TimeoutError' ? 'ETIMEDOUT' : e.cause?.code || 'ERR_NETWORK'} ${url}`), { reseau: true }); }
        const entetes = { cfMitigated: r.headers.get('cf-mitigated'), server: r.headers.get('server'), via: r.headers.get('via') };
        if (r.status >= 300 && r.status < 400) return { status: r.status, location: r.headers.get('location'), ...entetes };
        const type = r.headers.get('content-type') || '';
        // le type exigé est celui que la mesure a vu (image/webp) ; le corps est lu BORNÉ, avec ou sans content-length
        if (binaire && r.ok && /^image\/webp\b/i.test(type)) return { status: r.status, type, octets: await lireBorne(r, IMAGE_MAX_OCTETS, url), ...entetes };
        return { status: r.status, type, texte: (await lireBorne(r, PAGE_MAX_OCTETS, url)).toString('utf8'), ...entetes };
    }
};
/** Le corps d'une réponse, lu par morceaux et ARRÊTÉ au plafond (un content-length absent ou menteur ne protège de rien). Un dépassement compte comme un échec. */
async function lireBorne(reponse, max, url = '') {
    const depasse = () => Object.assign(new Error(`ERR_CORPS_TROP_GROS plus de ${max} octets ${url}`), { reseau: true });
    if (Number(reponse.headers?.get?.('content-length')) > max) throw depasse();
    const lecteur = reponse.body?.getReader?.();
    if (!lecteur) { const b = Buffer.from(await reponse.arrayBuffer()); if (b.length > max) throw depasse(); return b; }
    const morceaux = []; let total = 0;
    for (;;) {
        const { done, value } = await lecteur.read();
        if (done) break;
        total += value.length;
        if (total > max) { await lecteur.cancel().catch(() => { }); throw depasse(); }
        morceaux.push(Buffer.from(value));
    }
    return Buffer.concat(morceaux);
}
const DEFI = /Just a moment|cf-chl|challenge-platform|g-recaptcha|h-captcha|hcaptcha|Attention Required/i;
/** Une réponse est-elle un BLOCAGE (403, 429, `cf-mitigated`, page de défi) ? `r` = { status, cfMitigated, texte }. Définition unique : le client ET le réessai espacé. */
const defi = r => r.status === 403 || r.status === 429 || !!r.cfMitigated || (typeof r.texte === 'string' && DEFI.test(r.texte.slice(0, 5000)));
// robots.txt d'un hôte de fichiers (S3) : « AccessDenied » d'un S3 sans cette clé veut dire « pas de robots.txt » — pas un défi (aucune marque Cloudflare)
const robotsAbsentS3 = r => r.status === 403 && !r.cfMitigated && !/cloudflare/i.test(`${r.server ?? ''} ${r.via ?? ''}`) && /AmazonS3|CloudFront/i.test(`${r.server ?? ''} ${r.via ?? ''}`) && /<Code>AccessDenied<\/Code>/.test(String(r.texte ?? '').slice(0, 2000));

/**
 * Le SEUL chemin vers pikaqian.com / images.pikaqian.com. Garde FERMÉE : aucune requête sans verrou global lié, tenu et non perdu ; hôtes
 * ÉNUMÉRÉS, https, chemins ÉNUMÉRÉS (robots.txt, /sets/<code>, /<code>/<uuid>.webp — jamais /api/, /admin/, /auth/…) ; le robots.txt de CHAQUE
 * hôte lu avant sa première page et respecté (illisible : aucune page) ; cadence ≥ 10 s tenue dans une FILE, hôtes confondus (un Crawl-delay plus
 * lent la relève) ; redirections suivies dans l'hôte seulement, trois sauts, robots relu ; 403, 429, `cf-mitigated`, page de défi : BLOQUÉ ;
 * DEUX échecs de suite (5xx, coupure, réponse illisible) : ARRÊT — un arrêt, dans les deux cas, ne se lève pas tout seul.
 */
function fabriquerClientPikaqian({ transport = transportFetch, cadenceMs = CADENCE_MS, verrou = null, pause = ms => new Promise(r => setTimeout(r, ms)), horloge = Date.now, agent = UA } = {}) {
    let lie = verrou, file = Promise.resolve(), dernier = -Infinity, compte = 0, bloque = null, arret = null, suite = 0, plafond = Infinity;
    const parHote = {}, robots = new Map();
    let cadenceEff = Math.max(CADENCE_MS, Number(cadenceMs) || 0);        // relevée par un Crawl-delay plus lent, jamais abaissée sous 10 s
    function garde() {
        if (arret) throw arret;
        if (!lie) throw new Error(`${SOURCE} : aucun verrou global lié (${VERROU_GLOBAL}) — pas de requête sans verrou`);
        if (lie.perdu || !lie.tenu) throw new Error(`${SOURCE} : verrou global ${lie.perdu ? 'PERDU' : 'non tenu'} — pas de requête sans verrou`);
    }
    /** L'adresse, jugée AVANT toute file : hôte énuméré, https, rien d'autre que le chemin. Rend { url, hote, chemin }. */
    function cible(url, hoteVoulu) {
        let u; try { u = new URL(url); } catch { throw new Error(`${SOURCE} : adresse illisible`); }
        if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash || !CHEMINS[u.hostname]) throw new Error(`${SOURCE} : « ${u.origin}${u.pathname} » hors de ce que le client autorise (https, ${HOTE_PAGES} et ${HOTE_IMAGES}, sans identifiant, port ni requête)`);
        if (INTERDITS.test(u.pathname)) throw new Error(`${SOURCE} : « ${u.pathname} » est interdit (api, admin, auth, login, logout, currency)`);
        if (!CHEMINS[u.hostname].test(u.pathname)) throw new Error(`${SOURCE} : « ${u.hostname}${u.pathname} » hors des chemins autorisés (robots.txt, /sets/<code>, /<code>/<uuid>.webp)`);
        if (hoteVoulu && u.hostname !== hoteVoulu) throw new Error(`${SOURCE} : « ${u.pathname} » demandé sur ${u.hostname} au lieu de ${hoteVoulu}`);
        return { url: u.href, hote: u.hostname, chemin: u.pathname };
    }
    function echec(erreur) {
        suite++;
        if (suite >= ECHECS_DE_SUITE_MAX) {
            arret = Object.assign(new Error(`${SOURCE} : ${suite} échecs de suite (dernier : ${erreur.message}) — erreur répétée, on s'arrête, plus aucune requête`), { arret: true, repetee: true, status: erreur.status });
            throw arret;
        }
        throw erreur;
    }
    const bloquer = (r, url) => {
        bloque = arret = Object.assign(new Error(`${SOURCE} BLOQUÉ (HTTP ${r.status}${r.cfMitigated ? `, cf-mitigated ${r.cfMitigated}` : ''}) sur ${url} — on s'arrête, plus aucune requête`), { bloque: true, arret: true, status: r.status });
        throw arret;
    };
    /** Une requête de la FILE : cadence, comptes, transport. Une coupure réseau compte comme un échec. */
    async function une(url, o) {
        garde();
        const attente = dernier + cadenceEff - horloge();
        if (attente > 0) await pause(attente);
        garde();
        // le PLAFOND de requêtes de l'unité (taille du plan + marge) : une boucle ou une page démesurée ne peut pas frapper la source sans fin
        if (compte >= plafond) throw Object.assign(new Error(`${SOURCE} : plafond de ${plafond} requêtes atteint pour cette unité — aucune requête de plus`), { arret: true, plafond: true });
        dernier = horloge(); compte++;
        const h = new URL(url).hostname; parHote[h] = (parHote[h] || 0) + 1;
        try { return await transport.get(url, o); }
        catch (e) { if (!e.reseau) throw e; return echec(e); }
    }
    async function assurerRobots(hote) {
        if (robots.has(hote)) return;
        let url = `https://${hote}/robots.txt`, r;
        for (let saut = 0; ; saut++) {
            r = await une(url, {});
            if (!(r.status >= 300 && r.status < 400 && r.location && saut < 3)) break;
            const u = new URL(r.location, url);
            if (u.hostname !== hote || u.pathname !== '/robots.txt') break;      // un robots.txt redirigé ailleurs : on ne peut pas conclure
            url = u.href;
        }
        if (r.status === 404 || r.status === 410 || robotsAbsentS3(r)) { robots.set(hote, null); return; }   // (robots.txt réussi ne remet PAS le compteur d'échecs à zéro : seul un contenu le fait)
        if (defi(r)) bloquer(r, url);
        if (r.status !== 200) { try { echec(Object.assign(new Error(`${r.status} ${url} : robots.txt illisible — on ne peut pas conclure, aucune page`), { robots: true, status: r.status })); } catch (e) { e.robots = true; throw e; } }
        const texte = r.texte ?? '';
        const d = T.delaiDesRobots(texte, agent);
        if (d && d > CRAWL_DELAY_MAX_S) { bloque = arret = Object.assign(new Error(`${SOURCE} : robots.txt de ${hote} demande un Crawl-delay de ${d} s (au-delà de ${CRAWL_DELAY_MAX_S} s) — on s'arrête`), { bloque: true, arret: true, robots: true }); throw arret; }
        if (d) cadenceEff = Math.max(cadenceEff, d * 1000);
        robots.set(hote, texte);
    }
    const enFile = fn => { const p = file.then(fn); file = p.catch(() => { }); return p; };
    async function obtenir(c, o) {
        return enFile(async () => {
            let courant = c;
            for (let saut = 0; ; saut++) {
                await assurerRobots(courant.hote);
                if (!T.autoriseParRobots(robots.get(courant.hote), courant.chemin, agent)) throw Object.assign(new Error(`${SOURCE} : robots.txt de ${courant.hote} interdit ${courant.chemin} — aucune requête`), { robots: true });
                const r = await une(courant.url, o);
                if (defi(r)) bloquer(r, courant.url);
                if (r.status >= 300 && r.status < 400) {
                    suite = 0;
                    if (saut >= 3) throw new Error(`${SOURCE} : plus de 3 redirections depuis ${c.url} — on ne suit pas une boucle`);
                    if (!r.location) throw new Error(`${SOURCE} : redirection ${r.status} sans adresse sur ${courant.url}`);
                    courant = cible(new URL(r.location, courant.url).href, c.hote);          // lève hors de l'hôte de départ, hors des chemins autorisés, sur /api/
                    continue;
                }
                if (r.status === 404 || r.status === 410) { suite = 0; return null; }
                if (r.status >= 400) return echec(Object.assign(new Error(`${r.status} ${courant.url}`), { status: r.status }));
                if (o?.binaire && !r.octets) return echec(new Error(`${SOURCE} : « ${r.type} » n'est pas une image webp (${courant.url})`));
                // un fichier que l'appelant ne sait pas lire (sharp) est un échec, pas un succès : il compte dans les « deux de suite »
                if (o?.verifier) { try { await o.verifier(r.octets); } catch (e) { return echec(Object.assign(new Error(`${SOURCE} : image illisible (${e.message}) ${courant.url}`), { illisible: true })); } }
                suite = 0;
                return r;
            }
        });
    }
    return {
        lier(v) { lie = v; },
        page: async url => { const c = cible(url, HOTE_PAGES); if (!/^\/sets\//.test(c.chemin)) throw new Error(`${SOURCE} : une page se demande sous /sets/ (${c.chemin})`); garde(); return (await obtenir(c))?.texte ?? null; },
        image: async (url, verifier = null) => { const c = cible(url, HOTE_IMAGES); if (c.chemin === '/robots.txt') throw new Error(`${SOURCE} : une image se demande sous /<code>/<uuid>.webp`); garde(); return (await obtenir(c, { binaire: true, verifier }))?.octets ?? null; },
        /** Le compteur d'échecs de suite, PERSISTÉ par l'appelant entre deux unités (le client est neuf à chaque unité) : relu ici, écrit à la fin. */
        fixerSuite(n) { suite = Math.max(0, Number(n) || 0); },
        suiteEchecs: () => suite,
        plafonner(n) { plafond = compte + n; },
        compteRequetes: () => compte,
        requetesParHote: () => ({ ...parHote }),
        cadence: () => cadenceEff,
        bloque: () => bloque,
        arret: () => arret
    };
}

// ── L'IDENTIFIANT ET LE RETRAIT EN UN LOT ───────────────────────────────────────────────────────────────────────────────
const idImagePikaqian = (slug, carteId, numero) => `${SOURCE}/${slug}/${carteId}/${String(numero ?? '').replace(/[^0-9A-Za-z]/g, '') || 'sans-numero'}/${LANGUE}`;
/** Ce qu'un retrait en un lot retire : les entrées `cartes.images` de CETTE source ET de CE lot — rien d'autre — et leurs clés R2 (vignette comprise). */
function planRetraitPikaqian(cartes) {
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
    SOURCE, HOTE_PAGES, HOTE_IMAGES, LOT, MENTION, CADENCE_MS, UA, VERROU_GLOBAL, VERROU_GLOBAL_MS, ID_ALERTE, LANGUE, PROVENANCE_PAR_DEFAUT, ECHECS_DE_SUITE_MAX, ID_SUITE, lireBorne, PAGE_MAX_OCTETS, IMAGE_MAX_OCTETS, CODE_PK, compterAncresCartes,
    lireTuiles, lireOrigines, estFoil, verdictDePage, planifierPikaqian, urlSet, urlImage, fabriquerClientPikaqian, idImagePikaqian, planRetraitPikaqian,
    // le jugement « défi / blocage » d'une réponse : UNE définition, relue par le réessai espacé (collecte-cartes/reessai-pikaqian.js), jamais recopiée
    defi, DEFI
};
