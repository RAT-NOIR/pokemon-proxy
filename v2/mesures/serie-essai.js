'use strict';
// SERIE-ESSAI (25/10) — rejoue une SÉRIE de scans des bancs sur le SERVICE D'ESSAI (POST /api/photo, puis POST /api/identifier avec photoIds, empreintes de nav-bancs.json et modeleEmpreinte), mesure la durée de chaque scan
// (n, p50, p95) et compare les « sûrs » rendus par l'essai à ceux de la mesure locale sur les MÊMES lignes.
// ⚠️ ÉCRIT POUR ÊTRE LANCÉ PAR LE TESTEUR OU L'AGENT API, JAMAIS PAR UN BANC : un banc n'importe que les fonctions pures et injecte un faux `fetch`. Chaque scan est un appel au modèle payant côté essai : d'où le carnet et le plafond.
// Ce que le client s'interdit, écrit par ce qu'il AUTORISE :
//   · UN seul hôte : `rat-market-api-essai.onrender.com`, en https, sans identifiant, sans port, sans suivre une redirection (un autre hôte, ou une redirection vers lui : refus, avant toute requête) ;
//   · le jeton Bearer vient de la CONNEXION NORMALE de l'API, avec le compte de mesure (v2/admin/compte-essai.js --banc) : V2_ESSAI_BANC_IDENTIFIANT et V2_ESSAI_BANC_MOT_DE_PASSE (process.env, sinon le fichier d'environnement
//     donné par --env=), jamais imprimés ni écrits ; si l'un manque, arrêt AVANT toute requête. Le chemin : POST /api/installation (jeton d'installation) → POST /api/compte/connexion (cookie de session, en-têtes du site) →
//     POST /api/compte/code → POST /api/compte/lier (le jeton d'installation lié au compte administrateur). Ses scans sont marqués « banc » au journal du service ;
//   · un plafond de dépense DUR (--plafond-usd=, obligatoire) tenu dans un carnet sur disque (--carnet=, une ligne JSON par scan, écrite avant le scan suivant) : le total déjà inscrit au carnet COMPTE (le plafond vaut pour la
//     somme de toutes les séries du même carnet) ; avant chaque scan, si total + coût estimé dépasse le plafond, la série s'ARRÊTE (jamais un scan « qui passe juste ») ;
//   · le corps de /api/identifier est celui du CONTRAT 2 : `contrat: 2` (sans lui l'aiguilleur renvoie vers la route héritée : 401), title, description, prixVinted, devise, langueInterface ; le banc le juge par `verifierEntree` de la production ;
//   · GARDE ANTI-VINTED : l'adresse d'image de l'annonce est factice (exigée par la forme) ; un scan ne compte que si `analyse.photoRecue === true`. Sinon (champ absent, faux, pas d'`analyse`) la série S'ARRÊTE à l'instant : le serveur a pu télécharger l'adresse chez Vinted ;
//   · le carnet porte, en plus de l'estimation, une ligne « résultat » par scan (statut HTTP, analyse présente, photo rattachée), sans coût ;
//   · une série se rejoue à l'identique : l'échantillon est tiré d'une graine écrite (--graine=) sur les lignes triées par clé, dans cet ordre-là.
// Usage : node v2/mesures/serie-essai.js --resultats=<resultats-*.json> --nav=<nav-bancs.json> --photos=<dossier des photos des bancs, <clé de photo>.jpg|png|webp> --n=<N> --graine=<entier> --plafond-usd=<USD> --carnet=<fichier.jsonl>
//         [--cartes=<dossier des cartes redressées, <clé de photo>.jpg>] [--env=<fichier .env>] [--pause-s=6] [--cout-estime-usd=0.0037] [--modele-id=… --modele-sha256=…] [--sortie=<rapport.json>] [--base=https://rat-market-api-essai.onrender.com]
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const HOTE_ESSAI = 'rat-market-api-essai.onrender.com';
const NOM_IDENTIFIANT = 'V2_ESSAI_BANC_IDENTIFIANT', NOM_MOT_DE_PASSE = 'V2_ESSAI_BANC_MOT_DE_PASSE';
const ORIGINE_SITE = 'https://rat-market.fr';                              // l'Origin exacte que la connexion du site exige (config.origines.site)
const MODELE_DEFAUT = Object.freeze({ id: 'p8000-poids8s-1', sha256: '857105e3eb0035c5e0b6eab88f898a134d171321eb00e90452f4d37f7df28ec2' });
const COUT_ESTIME_DEFAUT_USD = 0.0037;                                   // mesuré : une identification de production, 2 photos, médiane du journal (CLAUDE.md §73)
const IMAGE_ANNONCE = 'https://images1.vinted.net/t/serie-essai/f800/serie-essai.jpeg';   // exigée par la forme de la requête ; jamais téléchargée par le serveur quand un photoId est reçu
const TYPES = Object.freeze({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' });
const DELAI_MS = 120000, ERREURS_DE_SUITE_MAX = 3;

class Arret extends Error { constructor(raison) { super(raison); this.name = 'Arret'; this.raison = raison; } }

/** L'adresse de base, ou un Arret. UN SEUL chemin mène à une adresse : https, l'hôte d'essai exact, ni identifiant, ni port, ni chemin, ni requête. */
function baseAutorisee(brut) {
    let u;
    try { u = new URL(String(brut)); } catch { throw new Arret('adresse illisible'); }
    if (u.protocol !== 'https:' || u.hostname !== HOTE_ESSAI || u.port !== '' || u.username !== '' || u.password !== '' || (u.pathname !== '/' && u.pathname !== '') || u.search !== '' || u.hash !== '') throw new Arret(`hôte refusé : seul https://${HOTE_ESSAI} est visé`);
    return `https://${HOTE_ESSAI}`;
}

/** Un PRNG à graine (mulberry32) : la même graine rend la même suite. */
function aleatoire(graine) {
    let a = (graine >>> 0) || 1;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** L'échantillon : les lignes TRIÉES par clé, mélangées (Fisher-Yates) par la graine, les n premières. Mêmes lignes, même ordre, à chaque rejeu. */
function echantillon(lignes, n, graine) {
    if (!Number.isInteger(n) || n < 1) throw new Arret('--n doit être un entier >= 1');
    if (!Number.isInteger(graine)) throw new Arret('--graine doit être un entier (écrite dans le carnet)');
    const l = [...lignes].sort((a, b) => (a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0));
    const r = aleatoire(graine);
    for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; }
    return l.slice(0, n);
}

/** Rang nearest-rank : p50 / p95 d'une liste de durées (ms). null si la liste est vide. */
function quantile(valeurs, q) {
    if (!valeurs.length) return null;
    const s = [...valeurs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
}
const statistiques = durees => ({ n: durees.length, p50: quantile(durees, 0.5), p95: quantile(durees, 0.95) });

/** Une variable : process.env d'abord, puis le fichier d'environnement NOMMÉ. Ne lit que ce nom, ne l'imprime jamais. null si absente ou vide. */
function lireVariable(nom, env, fichierEnv, lire = f => fs.readFileSync(f, 'utf8')) {
    const direct = env && typeof env[nom] === 'string' ? env[nom].trim() : '';
    if (direct) return direct;
    if (!fichierEnv) return null;
    let texte; try { texte = lire(fichierEnv); } catch { return null; }
    const m = new RegExp(`^\\s*${nom}\\s*=\\s*(.*)$`, 'm').exec(texte);
    const v = m ? m[1].trim().replace(/^["']|["']$/g, '').trim() : '';
    return v || null;
}
/** Les deux identifiants du compte de mesure, ou null si l'un manque. */
function lireIdentifiants(env, fichierEnv, lire) {
    const identifiant = lireVariable(NOM_IDENTIFIANT, env, fichierEnv, lire), motDePasse = lireVariable(NOM_MOT_DE_PASSE, env, fichierEnv, lire);
    return identifiant && motDePasse ? { identifiant, motDePasse } : null;
}

/** Le carnet de dépense : une ligne JSON par scan, ajoutée AVANT le scan suivant. Le total déjà inscrit compte. */
function ouvrirCarnet(fichier, { plafondUsd, coutEstimeUsd }) {
    if (!(typeof plafondUsd === 'number' && Number.isFinite(plafondUsd) && plafondUsd > 0)) throw new Arret('--plafond-usd obligatoire (un nombre > 0) : pas de série sans plafond');
    if (!fichier) throw new Arret('--carnet obligatoire');
    let total = 0;
    if (fs.existsSync(fichier)) {
        for (const l of fs.readFileSync(fichier, 'utf8').split(/\r?\n/)) {
            if (!l.trim()) continue;
            let o; try { o = JSON.parse(l); } catch { throw new Arret('carnet illisible : une ligne n\'est pas du JSON (rien n\'est lancé)'); }
            if (o && typeof o.coutUsd === 'number' && Number.isFinite(o.coutUsd)) total += o.coutUsd;
        }
    }
    return {
        total: () => total,
        /** true seulement si le scan à venir tient SOUS le plafond. */
        peutDepenser: () => total + coutEstimeUsd <= plafondUsd + 1e-12,
        inscrire(entree) {
            const cout = coutEstimeUsd;
            fs.appendFileSync(fichier, JSON.stringify({ ...entree, coutUsd: cout, totalApresUsd: Math.round((total + cout) * 1e6) / 1e6, plafondUsd }) + '\n');
            total += cout;
        },
        /** Une ligne « résultat » (statut HTTP, analyse présente, photo rattachée) : sans coût, elle n'ajoute rien à la dépense. */
        noter(entree) { fs.appendFileSync(fichier, JSON.stringify(entree) + '\n'); }
    };
}

const produitDe = s => { const m = /^sûr (\d+)/.exec(String(s || '')); return m ? Number(m[1]) : null; };
/** Les lignes locales (résultats d'un banc) : { cle, verite, localSur, localProduit }, la variante LIVRÉ rejouée comme mesurer-sur-par-image.js. */
function lignesLocales(R) {
    const LIVRE = Object.keys(R.bancs || {}).find(k => /LIVRÉ/.test(k));
    const apres = new Map(((LIVRE && R.diffs && R.diffs[LIVRE]) || []).map(x => [x.cle, x.apres]));
    return (R.ref || []).filter(x => x.banc !== 'hors-banc').map(x => {
        const brut = apres.has(x.cle) ? apres.get(x.cle) : null;
        const sur = brut !== null ? produitDe(brut) !== null : (x.et && x.et.type === 'sur');
        const produit = brut !== null ? produitDe(brut) : (x.et && x.et.type === 'sur' ? (x.et.produit ?? x.et.idProduct ?? null) : null);
        return { cle: x.cle, verite: x.verite ?? null, localSur: sur, localProduit: produit };
    });
}

/** La réponse d'essai → { sur, produit }. « Sûr » = la première carte est `identifiee` (statut fermé du contrat), jamais une question ni un refus. */
function sureDe(reponse) {
    const c = reponse && reponse.analyse && Array.isArray(reponse.analyse.cartes) ? reponse.analyse.cartes[0] : null;
    const ok = Boolean(c && c.statut === 'identifiee' && c.carte && Number.isInteger(c.carte.idProduct));
    return { sur: ok, produit: ok ? c.carte.idProduct : null };
}

/** La comparaison essai / local sur les mêmes lignes (celles dont l'essai a rendu une réponse). */
function comparer(resultats) {
    const c = { lignes: resultats.length, essaiSur: 0, localSur: 0, lesDeux: 0, memeProduit: 0, essaiSeul: 0, localSeul: 0, fauxEssai: 0, fauxLocal: 0, sansVerite: 0 };
    for (const r of resultats) {
        if (r.essaiSur) c.essaiSur++;
        if (r.localSur) c.localSur++;
        if (r.essaiSur && r.localSur) { c.lesDeux++; if (r.essaiProduit === r.localProduit) c.memeProduit++; }
        else if (r.essaiSur) c.essaiSeul++;
        else if (r.localSur) c.localSeul++;
        if (r.verite === null || r.verite === undefined) { c.sansVerite++; continue; }
        if (r.essaiSur && r.essaiProduit !== r.verite) c.fauxEssai++;
        if (r.localSur && r.localProduit !== r.verite) c.fauxLocal++;
    }
    return c;
}

function trouverFichier(dossier, cle) {
    for (const ext of Object.keys(TYPES)) { const f = path.join(dossier, cle + ext); if (fs.existsSync(f)) return { fichier: f, type: TYPES[ext] }; }
    return null;
}
const clePhoto = cle => String(cle).split(':')[0];

/**
 * La série. `deps.fetch` : injectable (le banc passe un faux serveur) ; `deps.horloge` : () => ms ; `deps.pause` : ms => Promise ; `deps.log`. Ne lance rien tant que la configuration n'est pas jugée entièrement.
 * Rend { arret, resultats, durees, stats, comparaison, depenseUsd } — jamais le jeton.
 */
async function serie(o, deps = {}) {
    const fetchF = deps.fetch || globalThis.fetch, horloge = deps.horloge || (() => Number(process.hrtime.bigint() / 1000000n)), pause = deps.pause || (ms => new Promise(r => setTimeout(r, ms))), log = deps.log || console.log;
    // ── tout est jugé AVANT la première requête ──
    const base = baseAutorisee(o.base || `https://${HOTE_ESSAI}`);
    const ids = lireIdentifiants(o.env || process.env, o.fichierEnv, deps.lireFichier);
    if (!ids) throw new Arret(`${NOM_IDENTIFIANT} ou ${NOM_MOT_DE_PASSE} absent : aucune requête n'est envoyée`);
    const origineSite = o.origineSite || ORIGINE_SITE;
    const coutEstimeUsd = o.coutEstimeUsd === undefined ? COUT_ESTIME_DEFAUT_USD : o.coutEstimeUsd;
    if (!(typeof coutEstimeUsd === 'number' && Number.isFinite(coutEstimeUsd) && coutEstimeUsd > 0)) throw new Arret('--cout-estime-usd doit être un nombre > 0');
    const carnet = ouvrirCarnet(o.carnet, { plafondUsd: o.plafondUsd, coutEstimeUsd });
    const modele = o.modele || MODELE_DEFAUT;
    const nav = o.nav && o.nav.photos ? o.nav.photos : {};
    const EV = require('../identifier/empreinte-vecteur');
    const candidates = lignesLocales(o.resultats).filter(l => nav[clePhoto(l.cle)] && Array.isArray(nav[clePhoto(l.cle)].emb) && trouverFichier(o.photos, clePhoto(l.cle)));
    if (!candidates.length) throw new Arret('aucune ligne du banc n\'a à la fois un vecteur (nav-bancs.json) et une photo locale');
    const lignes = echantillon(candidates, Math.min(o.n, candidates.length), o.graine);
    log(`série : graine ${o.graine}, ${lignes.length} lignes sur ${candidates.length} possibles, plafond ${o.plafondUsd} USD (déjà au carnet : ${carnet.total().toFixed(4)}), coût estimé ${coutEstimeUsd} USD par scan, hôte ${HOTE_ESSAI}`);
    log(`lignes (ordre rejoué) : ${lignes.map(l => l.cle).join(' ')}`);

    let jeton = null;                                                  // le jeton d'installation LIÉ au compte de mesure (Bearer) ; il ne sort jamais de ce fichier
    const appeler = async (chemin, init, auth = 'bearer') => {
        const entetes = { ...(init.headers || {}), ...(auth === 'bearer' && jeton ? { Authorization: `Bearer ${jeton}` } : {}) };
        const rep = await fetchF(base + chemin, { redirect: 'manual', signal: AbortSignal.timeout(DELAI_MS), ...init, headers: entetes });
        if (rep.status >= 300 && rep.status < 400) throw new Arret(`redirection ${rep.status} refusée (le client ne suit rien)`);
        let corps = null; try { corps = await rep.json(); } catch { /* corps vide ou non JSON */ }
        const lire = n => (rep.headers && typeof rep.headers.get === 'function' ? rep.headers.get(n) : null);
        return { statut: rep.status, corps, retryApres: lire('retry-after'), cookie: lire('set-cookie') };
    };

    // le ping dit la version minimale de l'extension et si le jeton `empreinte` est annoncé
    const ping = await appeler('/ping', { method: 'GET' }, null);
    if (ping.statut !== 200 || !ping.corps || typeof ping.corps.versionMinExtension !== 'string') throw new Arret(`/ping inattendu (${ping.statut}) : la v2 n'est pas annoncée, rien n'est envoyé`);
    const capacites = Array.isArray(ping.corps.capacites) ? ping.corps.capacites : [];
    log(`/ping : versionMinExtension ${ping.corps.versionMinExtension} ; capacités ${capacites.join(', ') || '(aucune)'} ; jeton empreinte ${capacites.includes('empreinte') ? 'PRÉSENT' : 'ABSENT (le serveur ne se sert pas encore des vecteurs)'}`);

    // ── la CONNEXION NORMALE : installation → connexion (cookie) → code → liaison. Tout refus arrête la série AVANT le moindre scan payé ; aucun détail de réponse n'est recopié (ils pourraient porter un secret).
    const refus = (etape, r) => { throw new Arret(`connexion du compte de mesure : ${etape} refusée (${r.statut})${r.statut === 429 ? ` — réessayer dans ${r.retryApres ?? '?'} s` : ''}`); };
    const inst = await appeler('/api/installation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versionExtension: ping.corps.versionMinExtension, libelle: 'serie-essai' }) }, null);
    if (inst.statut !== 201 || !inst.corps || typeof inst.corps.jetonInstallation !== 'string') refus('création de l\'installation', inst);
    const entetesSite = { Origin: origineSite, 'X-Rat-Market': '1', 'Content-Type': 'application/json' };
    const cx = await appeler('/api/compte/connexion', { method: 'POST', headers: entetesSite, body: JSON.stringify({ email: ids.identifiant, motDePasse: ids.motDePasse }) }, null);
    const session = cx.cookie ? /(?:^|[\s,;])rm_session=([^;\s,]+)/.exec(String(cx.cookie)) : null;
    if (cx.statut !== 200 || !session) refus('connexion', cx);
    const cd = await appeler('/api/compte/code', { method: 'POST', headers: { ...entetesSite, Cookie: `rm_session=${session[1]}` }, body: '{}' }, null);
    if (cd.statut !== 200 || !cd.corps || typeof cd.corps.code !== 'string') refus('code de liaison', cd);
    jeton = inst.corps.jetonInstallation;
    const lie = await appeler('/api/compte/lier', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `serie-lier-${crypto.randomBytes(12).toString('hex')}` }, body: JSON.stringify({ code: cd.corps.code }) });
    if (lie.statut !== 200 || !lie.corps || typeof lie.corps.jetonInstallation !== 'string') refus('liaison', lie);
    if (!(lie.corps.compte && lie.corps.compte.administrateur === true)) throw new Arret('le compte lié n\'est pas administrateur : aucune photo ne peut être déposée');
    jeton = lie.corps.jetonInstallation;
    log('compte de mesure connecté (installation liée, administrateur)');

    const resultats = [], durees = [], erreurs = [];
    let arret = null, deSuite = 0, rang = 0;
    const serieId = crypto.createHash('sha1').update(`${o.graine}|${lignes.map(l => l.cle).join(',')}`).digest('hex').slice(0, 10);
    const stamp = (deps.maintenant || Date.now)().toString(36);
    for (const l of lignes) {
        rang++;
        if (!carnet.peutDepenser()) { arret = `plafond atteint (${carnet.total().toFixed(4)} USD déjà inscrits, plafond ${o.plafondUsd}) : arrêt avant le scan ${rang}`; break; }
        const cp = clePhoto(l.cle), ph = trouverFichier(o.photos, cp), debut = horloge();
        let issue = null;
        try {
            const octets = fs.readFileSync(ph.fichier);
            const up = await appeler('/api/photo', { method: 'POST', headers: { 'Content-Type': ph.type, 'Content-Length': String(octets.length) }, body: octets });
            if (up.statut === 429) throw new Arret(`429 sur /api/photo (reessayerDans ${up.retryApres ?? '?'}) : la série s'arrête, sans boucle`);
            if (up.statut !== 200 || !up.corps || typeof up.corps.photoId !== 'string') throw Object.assign(new Error('photo'), { code: `photo-${up.statut}` });
            const p = nav[cp];
            const entree = { photo: 0, vecteur: EV.encoderVecteur(Float32Array.from(p.emb)), redressee: p.redressee === true };
            if (o.cartes) { const cf = trouverFichier(o.cartes, cp); if (cf) entree.carte = fs.readFileSync(cf.fichier).toString('base64'); }
            // `contrat: 2` : sans lui l'aiguilleur (monter.js) renvoie vers la route HÉRITÉE, qui répond 401. Les autres champs sont ceux que la v2 attend (verifierEntree).
            const corps = { contrat: 2, versionExtension: ping.corps.versionMinExtension, marche: 'vinted.fr', title: '', description: '', prixVinted: null, devise: null, langueInterface: 'fr', imageUrls: [IMAGE_ANNONCE], photoIds: [{ index: 0, photoId: up.corps.photoId }], empreintes: [entree], modeleEmpreinte: { id: modele.id, sha256: modele.sha256 } };
            carnet.inscrire({ serie: serieId, rang, cle: l.cle, graine: o.graine });                 // inscrit AVANT l'appel payant : un arrêt brutal ne laisse pas un scan hors carnet
            const id = await appeler('/api/identifier', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `serie-${serieId}-${rang}-${stamp}` }, body: JSON.stringify(corps) });
            const analyse = id.corps && typeof id.corps === 'object' && id.corps.analyse && typeof id.corps.analyse === 'object' ? id.corps.analyse : null;
            carnet.noter({ serie: serieId, rang, cle: l.cle, resultat: { statutHttp: id.statut, analyse: analyse !== null, photoRecue: analyse !== null && analyse.photoRecue === true } });   // ce que la réponse permet de lire ; jamais un coût
            if (id.statut === 429) throw new Arret(`429 sur /api/identifier (reessayerDans ${id.retryApres ?? '?'}) : la série s'arrête, sans boucle`);
            if (id.statut !== 200 || !id.corps) throw Object.assign(new Error('identifier'), { code: `identifier-${id.statut}` });
            // GARDE ANTI-VINTED, écrite par ce qu'elle AUTORISE : un scan ne compte que si le serveur dit avoir REÇU la photo de ce scan. Sinon `imagesDeLaChaine` retombe sur l'adresse factice de l'annonce et la ferait télécharger chez Vinted : jamais.
            if (!(analyse && analyse.photoRecue === true)) throw new Arret('photo non rattachée : le serveur a pu retomber sur l\'adresse de l\'annonce ; série arrêtée');
            issue = id.corps;
        } catch (e) {
            if (e instanceof Arret) { arret = e.raison; break; }
            erreurs.push({ cle: l.cle, code: (e && (e.code || e.name)) || 'erreur' });
            deSuite++;
            if (deSuite >= ERREURS_DE_SUITE_MAX) { arret = `${ERREURS_DE_SUITE_MAX} erreurs de suite : arrêt (dernier code ${erreurs[erreurs.length - 1].code})`; break; }
            continue;
        }
        deSuite = 0;
        const ms = horloge() - debut; durees.push(ms);
        const s = sureDe(issue);
        resultats.push({ cle: l.cle, ms, essaiSur: s.sur, essaiProduit: s.produit, localSur: l.localSur, localProduit: l.localProduit, verite: l.verite });
        log(`  ${rang}/${lignes.length} ${l.cle} : ${ms} ms, essai ${s.sur ? `sûr ${s.produit}` : 'pas sûr'}, local ${l.localSur ? `sûr ${l.localProduit}` : 'pas sûr'}`);
        if (rang < lignes.length && o.pauseS > 0) await pause(o.pauseS * 1000);
    }
    const stats = statistiques(durees), comparaison = comparer(resultats);
    log(`durée par scan : n ${stats.n}, p50 ${stats.p50} ms, p95 ${stats.p95} ms`);
    log(`comparaison essai / local (mêmes lignes) : ${JSON.stringify(comparaison)}`);
    if (erreurs.length) log(`erreurs : ${JSON.stringify(erreurs)}`);
    log(arret ? `ARRÊT : ${arret}` : 'série terminée');
    log(`dépense inscrite au carnet : ${carnet.total().toFixed(4)} USD sur un plafond de ${o.plafondUsd}`);
    return { arret, resultats, durees, stats, comparaison, erreurs, capacites, jetonEmpreinteAnnonce: capacites.includes('empreinte'), depenseUsd: carnet.total(), serie: serieId, lignes: lignes.map(l => l.cle) };
}

module.exports = { serie, baseAutorisee, echantillon, aleatoire, quantile, statistiques, lireVariable, lireIdentifiants, ouvrirCarnet, lignesLocales, sureDe, comparer, Arret, HOTE_ESSAI, NOM_IDENTIFIANT, NOM_MOT_DE_PASSE, ORIGINE_SITE, MODELE_DEFAUT, COUT_ESTIME_DEFAUT_USD };

if (require.main === module) {
    const arg = n => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
    const num = (n, d) => { const v = arg(n); return v === null ? d : Number(v); };
    (async () => {
        const necessaire = n => { const v = arg(n); if (!v) throw new Arret(`argument --${n}= manquant`); return v; };
        const resultats = JSON.parse(fs.readFileSync(necessaire('resultats'), 'utf8')), nav = JSON.parse(fs.readFileSync(necessaire('nav'), 'utf8'));
        const modele = arg('modele-id') && arg('modele-sha256') ? { id: arg('modele-id'), sha256: arg('modele-sha256') } : MODELE_DEFAUT;
        const r = await serie({ base: arg('base') || undefined, resultats, nav, photos: necessaire('photos'), cartes: arg('cartes'), n: num('n', NaN), graine: num('graine', NaN), plafondUsd: num('plafond-usd', NaN), carnet: arg('carnet'),
            fichierEnv: arg('env') || process.env.V2_ESSAI_ENV || null, pauseS: num('pause-s', 6), coutEstimeUsd: arg('cout-estime-usd') === null ? undefined : num('cout-estime-usd', NaN), modele, env: process.env });
        if (arg('sortie')) fs.writeFileSync(arg('sortie'), JSON.stringify({ serie: r.serie, lignes: r.lignes, stats: r.stats, comparaison: r.comparaison, erreurs: r.erreurs, arret: r.arret, depenseUsd: r.depenseUsd, jetonEmpreinteAnnonce: r.jetonEmpreinteAnnonce, resultats: r.resultats }, null, 1));
        process.exit(r.arret ? 1 : 0);
    })().catch(e => { console.error(e instanceof Arret ? `ARRÊT : ${e.raison}` : `ERREUR ${e && (e.code || e.name)}`); process.exit(e instanceof Arret ? 2 : 1); });
}
