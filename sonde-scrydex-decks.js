// ============================================================
// LA SONDE BORNÉE DU SERVEUR D'IMAGES — decks TCG Classic ×3 et My First Battle (SCRYDEX-DECKS, 2026-10-17)
// ============================================================
// 🔑 DÉCISION DU TESTEUR (2026-10-17) : le serveur d'images est OUVERT « pour tout autre trou couvert », aux conditions de pokemontcg.io — serveur d'IMAGES seulement, JAMAIS d'API,
// cadence lente, robots.txt lu, arrêt au premier 403/429/défi. Cette sonde répond à UNE question par identifiant candidat : « ce serveur répond-il à cette adresse ? ». Elle ne prouve RIEN
// d'autre : une adresse qui répond n'est pas un set prouvé (l'appariement se prouve à l'œil, sur trois témoins par set, APRÈS la sonde — voir ptcgio.js).
//
// Elle s'écrit par ce qu'elle AUTORISE : le plan est une liste FERMÉE (≤ 12 sondes, ≤ 3 identifiants par set, UNE adresse par identifiant) ; `validerPlan` refuse tout ce qui n'est pas
// exactement `https://<hôte d'images>/pokemon/<id>-<n>/large`, et `sonder` ne demande QUE les adresses du plan (plus robots.txt, d'abord). Le transport par défaut est celui du client
// gardé (collecte-cartes/ptcgio.js) : sa garde d'hôte joue au dernier mètre. Redirections jamais suivies ; cadence jamais sous 5 s ; arrêt DÉFINITIF au premier 403/429/défi.
//
//   node sonde-scrydex-decks.js --ecrire-plan=<fichier.json>                       # écrit le plan, AUCUNE requête
//   node sonde-scrydex-decks.js --lancer --plan=<fichier.json> --sortie=<dossier>   # LA SONDE (réseau) : lancée par le coordinateur seul
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = require('./collecte-cartes/ptcgio');
const T = require('./collecte-cartes/tpc');
const H = require('./collecte-cartes/hotes-images-ptcgio');

const HOTE = P.HOTE_SCRYDEX_NOM;
const UA = P.UA;
const TRANSPORT_PAR_DEFAUT = P.transportFetch;
const CADENCE_MIN_MS = 5000;                  // consigne du lot : jamais sous 5 s
const MAX_SONDES = 12, MAX_IDS_PAR_SET = 3, CRAWL_DELAY_MAX_S = 60;
const ID_VALIDE = /^[a-z][a-z0-9]{1,11}$/;
const DEFI = /Just a moment|cf-chl|challenge-platform|g-recaptcha|h-captcha|hcaptcha|captcha|Attention Required/i;

const BLASTOISE = 'Pokemon-Trading-Card-Game-Classic-Blastoise-Suicune-ex-Deck';
const VENUSAUR = 'Pokemon-Trading-Card-Game-Classic-Venusaur-Lugia-ex-Deck';
const CHARIZARD = 'Pokemon-Trading-Card-Game-Classic-Charizard-Ho-Oh-ex-Deck';
const MFB = 'My-First-Battle';
const SLUGS = Object.freeze([BLASTOISE, VENUSAUR, CHARIZARD, MFB]);

// ── LES CANDIDATS : liste FERMÉE, écrite avec leur raison. Aucun n'est un fait : ce sont des hypothèses que la sonde éprouve (une adresse). ──────────────────────────────────────
// Les noms de produits et les numéros viennent de `numeros_cartes` (lecture du 2026-10-17, scripts/produits-decks.js) : les trois Classic portent le CODE IMPRIMÉ CLB / CLV / CLC et des
// numéros 001–034 ; My First Battle porte le code MFB et AUCUN numéro (48 produits, V1…V4 pour les doubles) — la sonde y est une sonde d'EXISTENCE (le numéro 1 est une hypothèse).
// La forme est celle de me55c (`<identifiant>-<n>`) : en minuscules, sans tiret, comme cel25c, tk1a, mcd21 — la Classic Collection de 30th Celebration est me55c, celle de Celebrations cel25c.
const CIBLES = Object.freeze([
    { slug: BLASTOISE, n: 10, carteAttendue: { nom: 'Suicune ex', idProduct: 745736, numeroCm: '010' },
      candidats: [
          { id: 'clb', raison: 'code imprimé CLB (numeros_cartes.codeSet du deck Blastoise & Suicune ex), mis en minuscules comme me55c, cel25c, tk1a' },
          { id: 'clk', raison: 'code CLK de NOTRE table pour ce deck (table-sets.js, exp 5529, port japonais « Pokémon Card Game Classic ») : si le serveur a repris le code japonais' }] },
    { slug: VENUSAUR, n: 17, carteAttendue: { nom: 'Lugia ex', idProduct: 745675, numeroCm: '017' },
      candidats: [
          { id: 'clv', raison: 'code imprimé CLV (numeros_cartes.codeSet du deck Venusaur & Lugia ex), en minuscules comme me55c' },
          { id: 'clf', raison: 'code CLF de NOTRE table pour ce deck (table-sets.js, exp 5527, port japonais « Pokémon Card Game Classic »)' }] },
    { slug: CHARIZARD, n: 7, carteAttendue: { nom: 'Ho-Oh ex', idProduct: 745699, numeroCm: '007' },
      candidats: [
          { id: 'clc', raison: 'code imprimé CLC (numeros_cartes.codeSet du deck Charizard & Ho-Oh ex), en minuscules comme me55c' },
          { id: 'cll', raison: 'code CLL de NOTRE table pour ce deck (table-sets.js, exp 5528, port japonais « Pokémon Card Game Classic »)' }] },
    { slug: MFB, n: 1, carteAttendue: null,
      candidats: [
          { id: 'mfb', raison: 'code imprimé MFB (numeros_cartes.codeSet, 48 produits sans numéro) en minuscules ; sonde d\'EXISTENCE : Cardmarket ne numérote pas ces produits, le numéro 1 est une hypothèse' },
          { id: 'mfba', raison: 'deux versions du produit (Pikachu & Bulbasaur / Charmander & Squirtle) : la forme a/b des demi-kits du serveur (tk1a, tk1b, tk2a, tk2b), version a' },
          { id: 'mfbb', raison: 'idem, version b (la forme a/b de tk1a/tk1b)' }] }
]);

const urlSonde = (id, n) => `https://${HOTE}/pokemon/${id}-${n}/large`;

// ── LES TÉMOINS (2026-10-17, après la sonde : clb, clv, clc RÉPONDENT) : 3 par deck, n° 1, milieu, n° 34 ; la carte attendue est celle de NOS produits (numeros_cartes, lecture du 2026-10-17). ──
// Le coordinateur les REGARDE (nom, numéro imprimé /034, code, dos de carte refusé) ; tant qu'ils ne le sont pas, la ligne TABLE_PTCGIO du deck reste inactive (`lu: null`).
const ID_DECK = Object.freeze({ [BLASTOISE]: 'clb', [VENUSAUR]: 'clv', [CHARIZARD]: 'clc' });
const tm = (n, nom, idProduct) => ({ n, carteAttendue: { nom, idProduct, numeroCm: String(n).padStart(3, '0') } });
const TEMOINS = Object.freeze([
    { slug: BLASTOISE, temoins: [tm(1, 'Squirtle', 745727), tm(17, 'Kangaskhan', 745743), tm(34, 'Basic Psychic Energy', 745760)] },
    { slug: VENUSAUR, temoins: [tm(1, 'Bulbasaur', 745659), tm(16, 'Snorlax', 745674), tm(34, 'Basic Fighting Energy', 745692)] },   // 17 (Lugia ex) est déjà vu : le milieu est le 16
    { slug: CHARIZARD, temoins: [tm(1, 'Charmander', 745693), tm(17, 'Miltank Lv32', 745709), tm(34, 'Basic Lightning Energy', 745726)] }
]);
const MODES = Object.freeze(['candidats', 'temoins']);

/** Le plan, pur : mode « candidats » = une sonde par identifiant candidat, une adresse chacune ; mode « temoins » = 3 adresses par deck sur l'identifiant qui a répondu. */
function construirePlan(mode = 'candidats') {
    if (!MODES.includes(mode)) throw new Error(`mode de plan inconnu « ${mode} »`);
    if (mode === 'temoins') {
        const sondes = [];
        for (const c of TEMOINS) for (const w of c.temoins) {
            const id = ID_DECK[c.slug];
            sondes.push({ slug: c.slug, id, n: w.n, url: urlSonde(id, w.n), carteAttendue: w.carteAttendue, raison: `témoin n°${w.n} du deck (${id}) : notre produit ${w.carteAttendue.idProduct} « ${w.carteAttendue.nom} » au numéro Cardmarket ${w.carteAttendue.numeroCm} ; à regarder : nom, numéro imprimé /034, code ${id.toUpperCase()}, pas le dos de carte` });
        }
        return {
            mode: 'temoins', objet: 'SCRYDEX-DECKS : 9 témoins (n° 1, milieu, 34) des trois decks TCG Classic sur le serveur d\'images (jamais d\'API)',
            hote: HOTE, robots: `https://${HOTE}/robots.txt`, cadenceMinMs: CADENCE_MIN_MS, agent: UA,
            regles: 'robots.txt d\'abord et respecté ; ≥ 5 s entre deux requêtes ; redirections non suivies ; arrêt définitif au 1er 403/429/défi ; le dos de carte est refusé par empreinte ; seules les adresses ci-dessous',
            sondes
        };
    }
    const sondes = [];
    for (const c of CIBLES) for (const k of c.candidats) {
        sondes.push({ slug: c.slug, id: k.id, n: c.n, url: urlSonde(k.id, c.n), carteAttendue: c.carteAttendue, raison: k.raison });
    }
    return {
        objet: 'SCRYDEX-DECKS : sonde bornée du serveur d\'images (jamais d\'API), decks TCG Classic ×3 et My First Battle',
        hote: HOTE, robots: `https://${HOTE}/robots.txt`, cadenceMinMs: CADENCE_MIN_MS, agent: UA,
        regles: 'robots.txt d\'abord et respecté ; ≥ 5 s entre deux requêtes ; redirections non suivies ; arrêt définitif au 1er 403/429/défi ; seules les adresses ci-dessous',
        sondes
    };
}

/** Écrite par ce qu'elle AUTORISE : tout ce qui n'est pas exactement une adresse du plan fermé LÈVE. */
function validerPlan(plan) {
    const faute = m => { throw new Error(`plan de sonde refusé : ${m}`); };
    if (!plan || typeof plan !== 'object') faute('pas un plan');
    const mode = plan.mode ?? 'candidats';
    if (!MODES.includes(mode)) faute(`mode « ${mode} » inconnu`);
    if (plan.robots !== `https://${HOTE}/robots.txt`) faute('robots.txt doit être celui de l\'hôte d\'images, et lui seul');
    if (!Array.isArray(plan.sondes) || !plan.sondes.length) faute('aucune sonde');
    if (plan.sondes.length > MAX_SONDES) faute(`${plan.sondes.length} sondes (au plus ${MAX_SONDES})`);
    const ids = new Set(), urls = new Set(), parSet = new Map();
    for (const s of plan.sondes) {
        if (!SLUGS.includes(s.slug)) faute(`set « ${s.slug} » hors de la liste fermée`);
        if (typeof s.id !== 'string' || !ID_VALIDE.test(s.id)) faute(`identifiant « ${s.id} » : minuscules et chiffres seulement`);
        if (!Number.isInteger(s.n) || s.n < 1 || s.n > 999) faute(`numéro « ${s.n} » illisible`);
        if (s.url !== urlSonde(s.id, s.n)) faute(`l'adresse « ${s.url} » n'est pas exactement /pokemon/${s.id}-${s.n}/large de l'hôte d'images`);
        if (!H.hoteDeLUrl(s.url)) faute(`l'adresse « ${s.url} » n'est pas un hôte d'images permis (https, sans identifiants ni port)`);
        if (mode === 'candidats' && ids.has(s.id)) faute(`identifiant « ${s.id} » sondé deux fois (UNE adresse par identifiant)`);
        if (mode === 'temoins') {
            if (ID_DECK[s.slug] !== s.id) faute(`témoins : l'identifiant de ${s.slug} est « ${ID_DECK[s.slug]} », pas « ${s.id} » (My First Battle n'a pas de témoins numérotés)`);
            if (s.n > 34) faute(`témoins : numéro ${s.n} hors de 1–34`);
        }
        if (urls.has(s.url)) faute(`adresse en double « ${s.url} »`);
        ids.add(s.id); urls.add(s.url);
        parSet.set(s.slug, (parSet.get(s.slug) || 0) + 1);
    }
    if (mode === 'candidats') for (const [slug, n] of parSet) if (n > MAX_IDS_PAR_SET) faute(`${n} identifiants pour ${slug} (au plus ${MAX_IDS_PAR_SET})`);
    if (mode === 'temoins') for (const [slug, n] of parSet) if (n > 3) faute(`${n} témoins pour ${slug} (au plus 3)`);
    return true;
}

const reponseDefi = r => r.status === 403 || r.status === 429 || !!r.cfMitigated || (typeof r.texte === 'string' && DEFI.test(r.texte.slice(0, 5000)));
const cheminDe = url => new URL(url).pathname;

/**
 * L'exécution. Rend { resultats[], bloque, arret, requetes, cadenceMs }. `transport.get(url, { binaire })` rend { status, type, octets|texte, location, cfMitigated }.
 * Un plan invalide LÈVE avant toute requête. Une adresse = une requête (aucun réessai).
 */
async function sonder({ plan, transport = TRANSPORT_PAR_DEFAUT, pause = ms => new Promise(r => setTimeout(r, ms)), maintenant = Date.now, cadenceMs = CADENCE_MIN_MS, dossierImages = null }) {
    validerPlan(plan);
    let cadence = Math.max(CADENCE_MIN_MS, Number(cadenceMs) || 0), dernier = null, requetes = 0, bloque = null, arret = null;
    const resultats = plan.sondes.map(s => ({ slug: s.slug, id: s.id, n: s.n, url: s.url, etat: 'non-lancee' }));
    const demander = async (url, o) => {
        if (dernier != null) { const attente = dernier + cadence - maintenant(); if (attente > 0) await pause(attente); }
        dernier = maintenant(); requetes++;
        return transport.get(url, o);
    };
    const fin = () => ({ resultats, bloque, arret, requetes, cadenceMs: cadence });

    // 1. robots.txt, d'abord et respecté
    let robots = null;
    try {
        const r = await demander(plan.robots, {});
        if (reponseDefi(r)) { bloque = { status: r.status, url: plan.robots, cfMitigated: r.cfMitigated || null }; return fin(); }
        if (r.status === 404 || r.status === 410) robots = null;
        else if (r.status === 200) {
            robots = r.texte ?? '';
            const d = T.delaiDesRobots(robots, UA);
            if (d && d > CRAWL_DELAY_MAX_S) { arret = `robots.txt demande un Crawl-delay de ${d} s (> ${CRAWL_DELAY_MAX_S}) — on s'arrête`; return fin(); }
            if (d) cadence = Math.max(cadence, d * 1000);
        } else { arret = `robots.txt illisible (HTTP ${r.status}) — on ne peut pas conclure, aucune image`; return fin(); }
    } catch (e) { arret = `robots.txt injoignable (${e.message}) — aucune image`; return fin(); }

    // 2. les adresses du plan, dans l'ordre
    for (let i = 0; i < plan.sondes.length; i++) {
        const s = plan.sondes[i], x = resultats[i];
        if (!T.autoriseParRobots(robots, cheminDe(s.url), UA)) { x.etat = 'interdit-par-robots'; continue; }
        let r;
        try { r = await demander(s.url, { binaire: true }); }
        catch (e) { x.etat = 'erreur'; x.detail = String(e.message || e).slice(0, 200); continue; }
        x.status = r.status;
        if (reponseDefi(r)) { x.etat = 'bloque'; bloque = { status: r.status, url: s.url, cfMitigated: r.cfMitigated || null }; return fin(); }
        if (r.status >= 300 && r.status < 400) { x.etat = 'redirection'; x.location = r.location || null; continue; }
        if (r.status === 404 || r.status === 410) { x.etat = 'absent'; continue; }
        if (r.status >= 400) { x.etat = 'erreur'; x.detail = `HTTP ${r.status}`; continue; }
        // 2026-10-17 : l'« introuvable » de ce serveur est le DOS d'une carte en HTTP 200 (six adresses, un fichier) — refusé par empreinte, jamais « repond »
        if (r.status === 200 && r.octets && H.estDosDeCarte(r.octets)) { x.etat = 'dos-de-carte'; x.octets = r.octets.length; continue; }
        if (r.status === 200 && r.octets && /^image\//.test(r.type || '')) {
            x.etat = 'repond'; x.type = r.type; x.octets = r.octets.length; x.sha256 = crypto.createHash('sha256').update(r.octets).digest('hex');
            try { const m = await require('sharp')(r.octets).metadata(); x.w = m.width; x.h = m.height; x.fmt = m.format; } catch (e) { x.detail = `dimensions illisibles : ${e.message}`.slice(0, 200); }
            if (dossierImages) { fs.mkdirSync(dossierImages, { recursive: true }); x.fichier = path.join(dossierImages, `${s.id}-${s.n}.${/png/.test(r.type) ? 'png' : /webp/.test(r.type) ? 'webp' : 'jpg'}`); fs.writeFileSync(x.fichier, r.octets); }
            continue;
        }
        if (r.status >= 500) { x.etat = 'erreur'; x.detail = `HTTP ${r.status}`; continue; }
        x.etat = 'pas-une-image'; x.type = r.type || null;
    }
    return fin();
}

function lireArgs(argv) {
    const o = {};
    for (const a of argv) { const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a); if (!m) throw new Error(`argument inconnu « ${a} » — aucune requête`); o[m[1]] = m[2] ?? true; }
    return o;
}

if (require.main === module) (async () => {
    const o = lireArgs(process.argv.slice(2));
    const permis = new Set(['ecrire-plan', 'lancer', 'plan', 'sortie', 'mode']);
    for (const k of Object.keys(o)) if (!permis.has(k)) throw new Error(`argument inconnu « --${k} » — aucune requête`);
    if (o['ecrire-plan']) {
        const p = construirePlan(o.mode === undefined ? 'candidats' : o.mode); validerPlan(p);
        fs.writeFileSync(o['ecrire-plan'], JSON.stringify(p, null, 1) + '\n');
        console.log(`plan écrit : ${p.sondes.length} sondes + robots.txt, aucune requête`);
        return;
    }
    if (!o.lancer) { console.log('rien à faire : --ecrire-plan=<fichier> (sans réseau) ou --lancer --plan=<fichier> --sortie=<dossier> (la sonde)'); return; }
    if (typeof o.plan !== 'string' || typeof o.sortie !== 'string') throw new Error('--lancer exige --plan=<fichier> et --sortie=<dossier> — aucune requête');
    const plan = JSON.parse(fs.readFileSync(o.plan, 'utf8'));
    validerPlan(plan);
    if (JSON.stringify(plan) !== JSON.stringify(JSON.parse(JSON.stringify(construirePlan(plan.mode ?? 'candidats'))))) throw new Error('le plan lu n\'est pas celui que ce script construit — aucune requête');
    fs.mkdirSync(o.sortie, { recursive: true });
    console.log(`sonde : ${plan.sondes.length} adresses + robots.txt, ≥ ${CADENCE_MIN_MS / 1000} s entre deux requêtes`);
    const r = await sonder({ plan, dossierImages: path.join(o.sortie, 'img') });
    fs.writeFileSync(path.join(o.sortie, 'sonde-resultat.json'), JSON.stringify(r, null, 1) + '\n');
    for (const x of r.resultats) console.log(`${x.etat.padEnd(20)} ${x.slug.replace('Pokemon-Trading-Card-Game-', '')} ${x.id}-${x.n}${x.w ? ` ${x.w}×${x.h}` : ''}`);
    if (r.bloque) console.log(`BLOQUÉ : HTTP ${r.bloque.status} sur ${r.bloque.url} — plus aucune requête`);
    if (r.arret) console.log(`ARRÊT : ${r.arret}`);
    console.log(`${r.requetes} requêtes`);
    process.exit(r.bloque || r.arret ? 2 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });

module.exports = { construirePlan, validerPlan, sonder, CIBLES, SLUGS, UA, TRANSPORT_PAR_DEFAUT, CADENCE_MIN_MS };
