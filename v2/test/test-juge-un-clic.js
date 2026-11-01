'use strict';
// JUGE EN UN CLIC (ordre n°30) — le lanceur de la page locale du juge (outils/banc-200/lancer-juge.js), le chemin de connexion partagé (v2/mesures/connexion-essai.js) et le comportement de la page quand le lanceur a posé le jeton.
// AUCUN réseau réel : l'ESSAI est un faux `fetch` injecté (il note chaque requête) ; la boucle locale (127.0.0.1) est le seul réseau, et le navigateur est une fonction espion.
// Ce que le banc juge : (1) lancement normal : jeton posé EN MÉMOIRE, relais en Bearer, page sans champ « jeton » ; (2) identifiants absents : ZÉRO requête, la page dit pourquoi ; (3) 401 : message, pas de réessai ; (4) essai endormi : réessais, puis abandon ;
// (5) port déjà pris par NOTRE serveur : ouverture seule ; (6) port pris par autre chose : erreur ; (7) hôte autre que l'essai : refus avant toute requête ; (8) BALAYAGE DE SECRET ; (9) une seule définition du chemin de connexion ; (10) le contrôleur de la page.
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const H = require('./_harnais');
const { lancer } = require('../../outils/banc-200/lancer-juge');
const { creerServeur } = require('../../outils/banc-200/serveur');
const CN = require('../mesures/connexion-essai');
const RMControleur = require('../../outils/banc-200/controleur');

const MOT_DE_PASSE = 'mot-de-passe-de-banc-NE-JAMAIS-AFFICHER-0123456789', IDENTIFIANT = 'banc-mesure@rat-market.invalid';
const JETON_INST = 'jeton-installation-SECRET-aaaa1111', JETON_LIE = 'jeton-lie-SECRET-bbbb2222', COOKIE = 'cookie-session-SECRET-cccc3333', CODE = 'ABC123';
const SECRETS = [MOT_DE_PASSE, JETON_INST, JETON_LIE, COOKIE, IDENTIFIANT];
const ESSAI = 'rat-market-api-essai.onrender.com';
const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'juge-un-clic-'));
let n = 0;
const nouveauDossier = () => { const d = path.join(racine, `d${++n}`); fs.mkdirSync(d); return d; };
const ecrireEnv = (contenu) => { const f = path.join(nouveauDossier(), '.env'); fs.writeFileSync(f, contenu); return f; };
const ENV_BON = `AUTRE=1\nV2_ESSAI_BANC_IDENTIFIANT=${IDENTIFIANT}\nV2_ESSAI_BANC_MOT_DE_PASSE=${MOT_DE_PASSE}\n`;
const corpus = [];                                                         // tout ce que le lanceur a écrit, dit ou servi : le balayage de secret le lit en fin de banc
const essayer = async (nom, f) => { try { await f(); } catch (e) { H.v(`${nom} (exception)`, String(e && (e.stack || e.message)), 'aucune'); } };

/** Le faux ESSAI : un `fetch` qui note tout. comportement : { ping503: n fois, lier503: n fois, pasAdmin, porte: Promise (la connexion attend) }. */
function fauxEssai(comportement = {}) {
    const appels = []; let ping503 = comportement.ping503 || 0, lier503 = comportement.lier503 || 0;
    const rep = (statut, corps, entetes = {}) => ({ status: statut, json: async () => corps, arrayBuffer: async () => Buffer.from(JSON.stringify(corps)), headers: { get: k => entetes[String(k).toLowerCase()] ?? (String(k).toLowerCase() === 'content-type' ? 'application/json' : null) } });
    const fetch = async (url, init = {}) => {
        const u = new URL(url), corps = init.body, h = init.headers || {};
        appels.push({ url, hote: u.hostname, protocole: u.protocol, chemin: u.pathname, methode: init.method || 'GET', entetes: h, corps, redirect: init.redirect });
        if (u.pathname === '/ping') { if (ping503 > 0) { ping503--; return rep(503, { success: false }); } return rep(200, { ok: true, versionMinExtension: '2.5.0', capacites: [] }); }
        if (u.pathname === '/api/compte/connexion') {
            if (comportement.porte) await comportement.porte;
            const b = JSON.parse(corps);
            if (b.email !== IDENTIFIANT || b.motDePasse !== MOT_DE_PASSE) return rep(401, { success: false });
            return rep(200, { success: true }, { 'set-cookie': `rm_session=${COOKIE}; HttpOnly; Secure; SameSite=Lax; Path=/` });
        }
        if (u.pathname === '/api/installation') return h.Cookie === `rm_session=${COOKIE}` ? rep(201, { success: true, jetonInstallation: JETON_INST }) : rep(401, { success: false });
        if (u.pathname === '/api/compte/code') return h.Cookie === `rm_session=${COOKIE}` ? rep(200, { success: true, code: CODE }) : rep(401, { success: false });
        if (u.pathname === '/api/compte/lier') {
            if (lier503 > 0) { lier503--; return rep(503, { success: false }); }
            return h.Authorization === `Bearer ${JETON_INST}` && JSON.parse(corps).code === CODE ? rep(200, { success: true, compte: { verifie: true, administrateur: !comportement.pasAdmin }, jetonInstallation: JETON_LIE }) : rep(401, { success: false });
        }
        if (u.pathname === '/api/banc/seau/courant') return h.authorization === `Bearer ${JETON_LIE}` ? rep(200, { success: true, seau: { id: 's1', nom: 'juge-200', type: 'juge', n: 37, cible: 200 } }) : rep(401, { success: false });
        return rep(404, { success: false });
    };
    return { fetch, appels, de: chemin => appels.filter(a => a.chemin === chemin) };
}

/** Un lancement de banc : tout est injecté. Rend { r, faux, ouverts, quittes, sorties, dossier, pauses }. */
async function lancerBanc({ envFile, port = 0, comportement, env = {}, attendreFin = true, base, fetchLocal } = {}) {
    const faux = fauxEssai(comportement), ouverts = [], quittes = [], sorties = [], pauses = [], dossier = nouveauDossier();
    const r = await lancer({ port, envFile: envFile || ecrireEnv(ENV_BON), env, fetchFn: faux.fetch, ouvrir: u => ouverts.push(u), pause: async ms => { pauses.push(ms); }, quitter: c => quittes.push(c), delaiSortieMs: 400, dossierJournal: dossier, sortie: s => sorties.push(s), ...(base ? { base } : {}), ...(fetchLocal ? { fetchLocal } : {}) });
    if (attendreFin && r.connexionFinie) await r.connexionFinie;
    return { r, faux, ouverts, quittes, sorties, dossier, pauses };
}
const etatDe = async r => (await H.appel(r.url.replace(/\/$/, ''), '/_etat')).json;
const noter = async (x, r) => { const j = r.journal ? fs.readFileSync(r.journal, 'utf8') : ''; corpus.push({ nom: 'journal', texte: j }, { nom: 'sorties', texte: x.sorties.join('\n') }, { nom: 'résultat', texte: JSON.stringify({ ...r, connexionFinie: undefined, fermer: undefined }) }); if (r.url && r.resultat === 'lance') { const p = await H.appel(r.url.replace(/\/$/, ''), '/'), e = await H.appel(r.url.replace(/\/$/, ''), '/_etat'); corpus.push({ nom: 'page', texte: p.texte }, { nom: '/_etat', texte: e.texte }); } };

(async () => {
    // ── 1. lancement normal
    await essayer('1. lancement normal', async () => {
        let ouvrirPorte; const porte = new Promise(res => { ouvrirPorte = res; });
        const x = await lancerBanc({ comportement: { porte }, attendreFin: false });
        const { r, faux } = x, url = r.url.replace(/\/$/, '');
        H.v('1. le lanceur écoute (127.0.0.1) et ouvre la page AVANT que la connexion soit finie', [r.resultat, r.code, x.ouverts.length, x.ouverts[0] === r.url, /^http:\/\/127\.0\.0\.1:\d+\/$/.test(r.url)], ['lance', 0, 1, true, true]);
        const avant = await etatDe(r);
        H.v('1. pendant la connexion : /_etat dit « en cours », aucun jeton', [avant.lanceur, avant.connexion.etat, avant.jeton], [true, 'en-cours', false]);
        ouvrirPorte(); await r.connexionFinie;
        const apres = await etatDe(r);
        H.v('1. connexion finie : « ok », un jeton est posé — et /_etat ne le rend pas', [apres.connexion.etat, apres.jeton, JSON.stringify(apres).includes(JETON_LIE)], ['ok', true, false]);
        H.v('1. le chemin de connexion : connexion → installation (avec la session) → code → liaison, UNE installation', [faux.appels.filter(a => a.chemin !== '/ping').map(a => a.chemin)], [['/api/compte/connexion', '/api/installation', '/api/compte/code', '/api/compte/lier']]);
        H.v('1. UN SEUL hôte (l\'essai), https, sans suivre une redirection', [faux.appels.every(a => a.hote === ESSAI && a.protocole === 'https:' && a.redirect === 'manual')], [true]);
        const pg = await H.appel(url, '/');
        H.v('1. la page ne porte AUCUN champ « jeton » (retiré du HTML servi) mais garde le compteur', [pg.texte.includes('id="jeton"'), pg.texte.includes('id="poser"'), pg.texte.includes('id="session"'), pg.texte.includes('id="compteur"'), /<!--SESSION/.test(pg.texte)], [false, false, false, true, false]);
        const rel = await H.appel(url, '/api/banc/seau/courant');
        H.v('1. le relais envoie le jeton lié en Bearer à l\'essai (et la page reçoit le seau n/200)', [rel.statut, faux.de('/api/banc/seau/courant')[0].entetes.authorization === `Bearer ${JETON_LIE}`, rel.json.seau.n, rel.json.seau.cible], [200, true, 37, 200]);
        const s = await H.appel(url, '/_session', { methode: 'POST', corps: { jeton: 'un-jeton-saisi-0123456789' }, entetes: { 'x-rm-csrf': (/name="rm-csrf" content="([0-9a-f]+)"/.exec(pg.texte) || [])[1] } });
        H.v('1. poser un jeton à la main est REFUSÉ (403 LANCEUR) : le jeton ne se saisit jamais', [s.statut, s.json && s.json.erreur && s.json.erreur.code], [403, 'LANCEUR']);
        const log = fs.readFileSync(r.journal, 'utf8');
        H.v('1. le journal existe et dit les étapes (balayage non vide)', [log.includes('démarrage du lanceur'), log.includes('connexion : ok'), log.includes('identifiants du compte de mesure : présents')], [true, true, true]);
        await noter(x, r); await r.fermer();
    });

    // ── 2. identifiants absents
    await essayer('2. identifiants absents', async () => {
        const x = await lancerBanc({ envFile: ecrireEnv('AUTRE=1\nV2_ESSAI_BANC_IDENTIFIANT=quelqu-un@exemple.invalid\n') });
        const { r, faux } = x, e = await etatDe(r), pg = await H.appel(r.url.replace(/\/$/, ''), '/');
        H.v('2. identifiants absents : ZÉRO requête vers l\'essai', faux.appels.length, 0);
        H.v('2. la page dit pourquoi, en français, sans jeton à remplir', [e.connexion.etat, e.jeton, /^Connexion à l'essai impossible \(identifiants du compte de mesure absents\) — fermez la fenêtre, attendez une minute et relancez ; si ça persiste, prévenez l'agent API$/.test(e.connexion.message), pg.texte.includes('id="jeton"')], ['echec', false, true, false]);
        H.v('2. le navigateur est quand même ouvert (la page porte le message) ; le relais refuse (401), rien n\'est appelé', [x.ouverts.length, (await H.appel(r.url.replace(/\/$/, ''), '/api/banc/seau/courant')).statut, faux.appels.length], [1, 401, 0]);
        await noter(x, r);
        await new Promise(res => setTimeout(res, 700));
        H.v('2. le processus s\'arrête de lui-même après l\'échec (une relance repart de zéro)', x.quittes, [0]);
        await r.fermer();
        const sans = await lancerBanc({ envFile: path.join(racine, 'inexistant', '.env') });
        H.v('2. fichier .env absent : même chose, aucune requête', [sans.faux.appels.length, (await etatDe(sans.r)).connexion.etat], [0, 'echec']);
        await noter(sans, sans.r); await sans.r.fermer();
    });

    // ── 3. 401
    await essayer('3. 401', async () => {
        const x = await lancerBanc({ envFile: ecrireEnv(`V2_ESSAI_BANC_IDENTIFIANT=${IDENTIFIANT}\nV2_ESSAI_BANC_MOT_DE_PASSE=un-autre-mot-de-passe-0000\n`) });
        const e = await etatDe(x.r);
        H.v('3. identifiants refusés (401) : message avec la raison, jeton absent', [e.connexion.etat, e.jeton, /connexion refusée \(401\)/.test(e.connexion.message), /prévenez l'agent API/.test(e.connexion.message)], ['echec', false, true, true]);
        H.v('3. un refus 4xx n\'est JAMAIS réessayé (une connexion, pas d\'installation)', [x.faux.de('/api/compte/connexion').length, x.faux.de('/api/installation').length, x.pauses.length], [1, 0, 0]);
        await noter(x, x.r); await x.r.fermer();
        const pa = await lancerBanc({ comportement: { pasAdmin: true } });
        const e2 = await etatDe(pa.r);
        H.v('3. compte non administrateur : message, pas de jeton posé', [e2.connexion.etat, e2.jeton, /administrateur/.test(e2.connexion.message)], ['echec', false, true]);
        await noter(pa, pa.r); await pa.r.fermer();
    });

    // ── 4. essai endormi
    await essayer('4. essai endormi', async () => {
        const x = await lancerBanc({ comportement: { ping503: 3 } });
        H.v('4. l\'essai dort (3 × 503 sur /ping) : 3 réessais espacés, puis la connexion réussit', [x.faux.de('/ping').length, x.pauses.length, (await etatDe(x.r)).connexion.etat], [4, 3, 'ok']);
        await noter(x, x.r); await x.r.fermer();
        const l = await lancerBanc({ comportement: { lier503: 1 } });
        H.v('4. une panne 5xx au milieu de la chaîne est réessayée UNE fois (3 essais au plus)', [l.faux.de('/api/compte/lier').length, (await etatDe(l.r)).connexion.etat], [2, 'ok']);
        await noter(l, l.r); await l.r.fermer();
        const m = await lancerBanc({ comportement: { ping503: 99 } });
        const e = await etatDe(m.r);
        H.v('4. l\'essai ne se réveille pas : abandon après 10 essais, message clair, aucune connexion tentée', [m.faux.de('/ping').length, m.faux.de('/api/compte/connexion').length, e.connexion.etat, /le service d'essai ne répond pas \(10 essais\)/.test(e.connexion.message)], [10, 0, 'echec', true]);
        await noter(m, m.r); await m.r.fermer();
    });

    // ── 5. déjà lancé
    await essayer('5. déjà lancé', async () => {
        const un = await lancerBanc();
        const deux = await lancerBanc({ port: un.r.port });
        H.v('5. port pris par NOTRE serveur (reconnu à /_etat) : il ouvre la page seulement et sort (code 0)', [deux.r.resultat, deux.r.code, deux.ouverts, deux.faux.appels.length, deux.quittes], ['deja-lance', 0, [un.r.url], 0, []]);
        H.v('5. aucun second serveur, aucune connexion de plus : une seule installation en tout', [un.faux.de('/api/installation').length], [1]);
        await noter(deux, deux.r); await un.r.fermer();
    });

    // ── 6. port pris par autre chose
    await essayer('6. port pris par autre chose', async () => {
        for (const [nom, corps] of [['un serveur muet qui répond du texte', 'bonjour'], ['un serveur JSON qui n\'est pas le juge', JSON.stringify({ appli: 'autre-chose', jeton: true })]]) {
            const etranger = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(corps); });
            await new Promise(res => etranger.listen(0, '127.0.0.1', res));
            const p = etranger.address().port;
            const x = await lancerBanc({ port: p });
            H.v(`6. port pris par ${nom} : erreur claire, code 1, rien d'ouvert, aucune requête`, [x.r.resultat, x.r.code, x.ouverts.length, x.faux.appels.length, x.sorties.length === 1 && x.sorties[0].includes(String(p)) && /autre programme/.test(x.sorties[0])], ['port-pris', 1, 0, 0, true]);
            H.v('6. l\'autre serveur n\'est pas dérangé', (await fetch(`http://127.0.0.1:${p}/`)).status, 200);
            await noter(x, x.r); await new Promise(res => etranger.close(res));
        }
    });

    // ── 7. l'hôte
    await essayer('7. hôte', async () => {
        for (const mauvais of ['https://evil.example', 'https://rat-market-api-essai.onrender.com.evil.fr', 'http://rat-market-api-essai.onrender.com', 'https://api-v2.rat-market.fr', 'https://user:pw@rat-market-api-essai.onrender.com']) {
            const x = await lancerBanc({ base: mauvais });
            H.v(`7. hôte refusé AVANT toute requête : ${mauvais}`, [x.faux.appels.length, (await etatDe(x.r)).connexion.etat, (await etatDe(x.r)).jeton], [0, 'echec', false]);
            await noter(x, x.r); await x.r.fermer();
        }
        let refus = null; try { CN.baseAutorisee('https://evil.example'); } catch (e) { refus = e.name; }
        H.v('7. le module partagé refuse un autre hôte (la même garde que serie-essai)', refus, 'Arret');
    });

    // ── 8. jeton expiré en cours de route
    await essayer('8. jeton refusé en cours de route', async () => {
        // le jeton du relais est refusé par l'API (périmé) : le lanceur le sait et le dit
        const y = await (async () => {
            const faux = fauxEssai(), r2 = await lancer({ port: 0, envFile: ecrireEnv(ENV_BON), env: {}, fetchFn: async (u, i) => (new URL(u).pathname === '/api/banc/seau/courant' ? { status: 401, headers: { get: () => 'application/json' }, arrayBuffer: async () => Buffer.from('{"success":false}'), json: async () => ({}) } : faux.fetch(u, i)), ouvrir: () => { }, pause: async () => { }, quitter: () => { }, delaiSortieMs: 5000, dossierJournal: nouveauDossier(), sortie: () => { } });
            await r2.connexionFinie; return r2;
        })();
        H.v('8. avant le refus : connecté', (await etatDe(y)).connexion.etat, 'ok');
        const rel = await H.appel(y.url.replace(/\/$/, ''), '/api/banc/seau/courant');
        const apres = await etatDe(y);
        H.v('8. un 401 de l\'API (jeton périmé) : relayé tel quel, la connexion passe à « echec » avec la phrase de relance', [rel.statut, apres.connexion.etat, /jeton refusé \(401\)/.test(apres.connexion.message), apres.jeton], [401, 'echec', true, false]);
        await y.fermer();
    });

    // ── 9. une seule définition du chemin de connexion
    await essayer('9. pas de recopie', async () => {
        const lire = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
        const lanceur = lire('outils/banc-200/lancer-juge.js'), serie = lire('v2/mesures/serie-essai.js'), partage = lire('v2/mesures/connexion-essai.js');
        const CHEMIN = '\'/api/compte/connexion\'';
        H.v('9. le chemin de connexion n\'est écrit QUE dans connexion-essai.js (ni serie-essai, ni le lanceur)', [partage.includes(CHEMIN), serie.includes(CHEMIN), lanceur.includes(CHEMIN)], [true, false, false]);
        H.v('9. serie-essai et le lanceur importent le MÊME module', [/require\('\.\/connexion-essai'\)/.test(serie), /require\('\.\.\/\.\.\/v2\/mesures\/connexion-essai'\)/.test(lanceur)], [true, true]);
        H.v('9. le lanceur n\'interpole jamais le jeton ni les identifiants dans une phrase de journal, et n\'écrit aucun fichier hors du journal', [/journal\([^)]*\$\{\s*(jeton|ids)/.test(lanceur), /writeFile/.test(lanceur)], [false, false]);
        const app = lire('outils/banc-200/app.js');
        H.v('9. la page affiche le compteur n/cible du seau et « connecté à l\'essai »', [/compteur'\)\.textContent = p\.seau \? p\.seau\.n \+ '\/' \+ p\.seau\.cible/.test(app), app.includes('connecté à l\\\'essai')], [true, true]);
    });

    // ── 10. la page sans lanceur garde le comportement d'avant ; la page avec lanceur n'a pas de champ
    await essayer('10. page avec / sans lanceur', async () => {
        const sans = creerServeur({ apiBase: 'http://127.0.0.1:1', jeton: null }), avec = creerServeur({ apiBase: 'http://127.0.0.1:1', jeton: null, lanceur: {} });
        const a = await sans.ecouter(0), b = await avec.ecouter(0);
        const pa = await H.appel(a.url.replace(/\/$/, ''), '/'), pb = await H.appel(b.url.replace(/\/$/, ''), '/');
        H.v('10. sans lanceur : le champ « jeton » est là (comportement d\'avant), sans les balises internes', [pa.texte.includes('id="jeton"'), pa.texte.includes('id="poser"'), /<!--SESSION/.test(pa.texte)], [true, true, false]);
        H.v('10. avec lanceur : le champ « jeton » n\'existe pas', [pb.texte.includes('id="jeton"'), pb.texte.includes('id="poser"')], [false, false]);
        const ea = (await H.appel(a.url.replace(/\/$/, ''), '/_etat')).json;
        H.v('10. /_etat sans lanceur : lanceur=false, connexion=null, identité du serveur du juge', [ea.lanceur, ea.connexion, ea.appli, ea.jeton], [false, null, 'rm-juge-banc200', false]);
        const csrfA = (/name="rm-csrf" content="([0-9a-f]+)"/.exec(pa.texte) || [])[1];
        H.v('10. sans lanceur : poser un jeton à la main marche encore', (await H.appel(a.url.replace(/\/$/, ''), '/_session', { methode: 'POST', corps: { jeton: 'jeton-saisi-0123456789' }, entetes: { 'x-rm-csrf': csrfA } })).statut, 200);
        await sans.fermer(); await avec.fermer();
    });

    // ── 11. le contrôleur de la page
    await essayer('11. contrôleur', async () => {
        const fabrique = (scenarioEtat, { courant = { statut: 200, json: { seau: { id: 's1', nom: 'juge-200', type: 'juge', n: 37, cible: 200 } } } } = {}) => {
            const appels = [], ui = { sessions: [], connexions: [], progres: [], vides: 0, dires: [] };
            let i = 0;
            const api = async (m, c) => {
                appels.push(`${m} ${c}`);
                if (c === '/_etat') return { statut: 200, json: scenarioEtat[Math.min(i++, scenarioEtat.length - 1)] };
                if (c === '/api/banc/seau/courant') return courant;
                if (c.startsWith('/api/banc/seau/a-etiqueter')) return { statut: 200, json: { scans: [], prochain: null } };
                return { statut: 404, json: null };
            };
            Object.assign(ui, { montrerSession: v => ui.sessions.push(v), montrerConnexion: c => ui.connexions.push(c), montrerProgres: p => ui.progres.push(p), montrerVide: () => { ui.vides++; }, montrerScan: () => { }, montrerAttente: () => { }, montrerCandidats: () => { }, dire: (t, k) => ui.dires.push([t, k]) });
            let attentes = 0;
            return { appels, ui, ctrl: RMControleur.creer({ api, ui, attendre: f => { attentes++; f(); } }), attentes: () => attentes };
        };
        let f = fabrique([{ lanceur: true, jeton: true, connexion: { etat: 'ok' } }]); await f.ctrl.demarrer();
        H.v('11. lanceur connecté : jamais de champ « jeton », « connecté » dit, le compteur 37/200 est transmis', [f.ui.sessions, f.ui.connexions.map(c => c.etat), f.ui.progres.map(p => `${p.seau.n}/${p.seau.cible}`)], [[], ['ok'], ['37/200']]);
        f = fabrique([{ lanceur: true, jeton: false, connexion: { etat: 'en-cours' } }, { lanceur: true, jeton: false, connexion: { etat: 'en-cours' } }, { lanceur: true, jeton: true, connexion: { etat: 'ok' } }]); await f.ctrl.demarrer();
        H.v('11. connexion en cours : la page suit l\'état (2 attentes) puis charge, sans jamais demander de jeton', [f.ui.sessions, f.ui.connexions.map(c => c.etat), f.attentes(), f.appels.includes('GET /api/banc/seau/courant')], [[], ['en-cours', 'en-cours', 'ok'], 2, true]);
        f = fabrique([{ lanceur: true, jeton: false, connexion: { etat: 'echec', message: 'Connexion à l\'essai impossible (401)…' } }]); await f.ctrl.demarrer();
        H.v('11. connexion en échec : la phrase du lanceur est montrée, aucun appel au banc, aucun champ « jeton »', [f.ui.sessions, f.ui.connexions[0].message, f.appels.filter(a => a.includes('/api/banc')).length], [[], 'Connexion à l\'essai impossible (401)…', 0]);
        f = fabrique([{ lanceur: true, jeton: true, connexion: { etat: 'ok' } }], { courant: { statut: 401, json: null } }); await f.ctrl.demarrer();
        H.v('11. lanceur : un 401 du banc (jeton périmé) montre la phrase de relance, JAMAIS le champ « jeton »', [f.ui.sessions, f.ui.connexions.map(c => c.etat), /prévenez l'agent API/.test(f.ui.connexions[1].message)], [[], ['ok', 'echec'], true]);
        f = fabrique([{ jeton: false }]); await f.ctrl.demarrer();
        H.v('11. sans lanceur et sans jeton : le champ « jeton » est demandé (comportement d\'avant)', [f.ui.sessions, f.ui.connexions.length], [[true], 0]);
        f = fabrique([{ jeton: true }], { courant: { statut: 401, json: null } }); await f.ctrl.demarrer();
        H.v('11. sans lanceur, un 401 : le champ « jeton » est demandé (comportement d\'avant)', f.ui.sessions, [true]);
    });

    // ── BALAYAGE DE SECRET : ni le mot de passe, ni le jeton, ni le cookie, ni l'identifiant, dans rien de ce que le lanceur a écrit, dit ou servi
    await essayer('balayage de secret', async () => {
        H.v('S. le balayage n\'est pas vide : journaux, sorties, résultats, pages et /_etat ont été lus', [corpus.length > 20, corpus.filter(c => c.nom === 'journal' && c.texte.length > 0).length > 8, corpus.filter(c => c.nom === 'page').length > 3], [true, true, true]);
        const fuites = [];
        for (const c of corpus) for (const s of SECRETS) if (c.texte.includes(s)) fuites.push(`${c.nom}:${s.slice(0, 12)}`);
        H.v('S. aucun secret (mot de passe, jetons, cookie, identifiant) dans le journal, la sortie, la page, /_etat ni le résultat', fuites, []);
        const fichiers = []; const parcourir = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) parcourir(p); else if (!p.endsWith('.env')) fichiers.push(p); } };
        parcourir(racine);
        const dans = fichiers.filter(p => SECRETS.some(s => fs.readFileSync(p, 'utf8').includes(s)));
        H.v('S. aucun fichier écrit par le lanceur (hors le .env de banc, qui en est la source) ne contient un secret', [fichiers.length > 8, dans], [true, []]);
    });

    try { fs.rmSync(racine, { recursive: true, force: true }); } catch { /* dossier temporaire du banc */ }
    H.bilan();
})();
