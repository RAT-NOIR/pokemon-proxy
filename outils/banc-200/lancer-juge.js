'use strict';
// JUGE EN UN CLIC (ordre n°30) — le lanceur de la page locale du juge des 200. L'éditeur double-clique « Juge Rat-Market » (raccourci du Bureau → lancer-juge.vbs → ce fichier, sans fenêtre de console) : il ne tape ni commande ni jeton.
//   node outils/banc-200/lancer-juge.js [--port=4747] [--env=<fichier .env>]        (--env : C:\Users\Yung\Desktop\pokemon-proxy-api-v2\.env par défaut)
// Ce que le lanceur fait, dans l'ordre, et ce qu'il s'interdit (écrit par ce qu'il AUTORISE) :
//   · il sonde le port : « notre » serveur y tourne (GET /_etat dit `appli: rm-juge-banc200`) → il ouvre la page et sort ; libre → il écoute sur 127.0.0.1 ; pris par AUTRE CHOSE → message clair, code 1, rien d'autre ;
//   · il lit les deux identifiants du compte de mesure dans le .env donné (connexion-essai.js::lireIdentifiants — la même lecture que serie-essai) et se connecte à l'ESSAI SEUL par connexion-essai.js (le même chemin que serie-essai, aucune recopie) ;
//   · le jeton d'installation lié reste EN MÉMOIRE du serveur (creerServeur(...).poserJeton) : ni disque, ni journal, ni sortie, ni page, ni /_etat ;
//   · le serveur démarre et la page s'ouvre AVANT la connexion : un réveil à froid de l'essai (≈ 1 minute) se réessaie (/ping : 10 essais espacés de 10 s ; la chaîne de connexion : 3 essais sur une erreur réseau ou 5xx, jamais sur un refus 4xx) ;
//   · connexion impossible (identifiants absents, 401, réseau, essai endormi, hôte refusé) : le serveur reste, la PAGE dit en français pourquoi — jamais un champ « jeton » — puis le processus s'arrête de lui-même après 60 s (une relance repart de zéro) ;
//   · journal SANS secret : %LOCALAPPDATA%\rat-market-juge\juge.log (phrases fixes, statuts HTTP, raisons courtes ; aucune valeur lue du .env, aucun jeton, aucun cookie).
const fs = require('fs'), path = require('path'), os = require('os');
const CN = require('../../v2/mesures/connexion-essai');
const { creerServeur, ESSAI, IDENTITE } = require('./serveur');

const PORT_DEFAUT = 4747;
const ENV_DEFAUT = 'C:\\Users\\Yung\\Desktop\\pokemon-proxy-api-v2\\.env';
const PING_ESSAIS = 10, PING_PAUSE_MS = 10000, CHAINE_ESSAIS = 3, CHAINE_PAUSE_MS = 5000, DELAI_REQUETE_MS = 30000, SORTIE_APRES_ECHEC_MS = 60000;
const PHRASE = raison => `Connexion à l'essai impossible (${raison}) — fermez la fenêtre, attendez une minute et relancez ; si ça persiste, prévenez l'agent API`;

const dossierJournalDefaut = env => path.join((env && env.LOCALAPPDATA) || os.tmpdir(), 'rat-market-juge');
/** Le journal : une phrase par ligne, datée. N'écrit que ce qu'on lui donne ; l'appelant ne lui donne JAMAIS une valeur secrète. Un journal indisponible ne fait jamais échouer le lanceur. */
function ouvrirJournal(dossier) {
    let ok = true;
    try { fs.mkdirSync(dossier, { recursive: true }); } catch { ok = false; }
    const fichier = path.join(dossier, 'juge.log');
    return { fichier, ecrire(texte) { if (!ok) return; try { fs.appendFileSync(fichier, `${new Date().toISOString()} ${texte}\n`); } catch { /* journal indisponible */ } } };
}

/** Qui répond sur ce port ? 'nous' (notre serveur, reconnu à son /_etat), 'libre' (connexion refusée), 'autre' (tout le reste : un autre programme, ou un silence). */
async function sonder(port, fetchLocal) {
    try {
        const r = await fetchLocal(`http://127.0.0.1:${port}/_etat`, { signal: AbortSignal.timeout(2000), redirect: 'manual' });
        let j = null; try { j = await r.json(); } catch { /* pas du JSON : pas nous */ }
        return j && j.appli === IDENTITE ? 'nous' : 'autre';
    } catch (e) {
        return e && e.cause && e.cause.code === 'ECONNREFUSED' ? 'libre' : 'autre';
    }
}

/** Une raison COURTE et sans secret : le texte d'un Arret (phrases fixes de connexion-essai.js), sinon le code de l'erreur réseau. */
function raisonCourte(e) {
    if (e instanceof CN.Arret) return e.raison.replace(/^connexion du compte de mesure : /, '');
    const code = e && ((e.cause && e.cause.code) || e.code || e.name);
    return `réseau (${String(code || 'erreur').replace(/[^A-Za-z0-9_ -]/g, '').slice(0, 40)})`;
}
/** Une panne qui peut passer toute seule : une erreur réseau, un délai, un 5xx. Un refus 4xx (401, 429), une redirection, un hôte refusé : jamais. */
const transitoire = e => !(e instanceof CN.Arret) || /\(5\d\d\)/.test(e.raison);

/** La connexion au compte de mesure sur l'essai. Rend le jeton d'installation lié (texte) ou lève. `base` est jugée par connexion-essai.js::baseAutorisee AVANT toute requête. */
async function connecter({ base, ids, fetchF, pause, journal, delaiMs = DELAI_REQUETE_MS }) {
    const baseOk = CN.baseAutorisee(base);
    const { appeler, definirJeton } = CN.creerAppelant({ base: baseOk, fetchF, delaiMs });
    let ping = null;
    for (let i = 1; i <= PING_ESSAIS && !ping; i++) {
        try {
            const p = await appeler('/ping', { method: 'GET' }, null);
            if (p.statut === 200 && p.corps && typeof p.corps.versionMinExtension === 'string') { ping = p; break; }
            journal(`ping : statut ${p.statut} (essai ${i}/${PING_ESSAIS})`);
            if (p.statut < 500) throw new CN.Arret(`/ping inattendu (${p.statut})`);
        } catch (e) {
            if (e instanceof CN.Arret) throw e;
            journal(`ping : ${raisonCourte(e)} (essai ${i}/${PING_ESSAIS})`);
        }
        if (i < PING_ESSAIS) await pause(PING_PAUSE_MS);
    }
    if (!ping) throw new CN.Arret(`le service d'essai ne répond pas (${PING_ESSAIS} essais)`);
    let lie = null;
    for (let i = 1; i <= CHAINE_ESSAIS; i++) {
        try { lie = await CN.connexionNormale({ appeler, definirJeton, ids, versionExtension: ping.corps.versionMinExtension, libelle: 'juge-un-clic' }); break; }
        catch (e) {
            if (!transitoire(e) || i === CHAINE_ESSAIS) throw e;
            journal(`connexion : ${raisonCourte(e)} (essai ${i}/${CHAINE_ESSAIS})`);
            await pause(CHAINE_PAUSE_MS);
        }
    }
    if (!(lie.corps.compte && lie.corps.compte.administrateur === true)) throw new CN.Arret('le compte lié n\'est pas administrateur : le juge ne pourrait lire aucun scan');
    return lie.corps.jetonInstallation;
}

/** Ouvre la page dans le navigateur par défaut, sans fenêtre de console (explorer.exe <url>). */
function ouvrirNavigateur(url) {
    const e = require('child_process').spawn('explorer.exe', [url], { detached: true, stdio: 'ignore', windowsHide: true });
    e.on('error', () => { /* le navigateur ne s'ouvre pas : l'adresse est dans le journal */ });
    e.unref();
}

/**
 * Le lanceur. Toutes les coutures sont injectables (un banc n'ouvre ni réseau réel ni navigateur) :
 *   o.port · o.envFile · o.env (défaut process.env) · o.fetchFn (vers l'ESSAI) · o.fetchLocal (la sonde du port, boucle locale) · o.ouvrir(url) · o.pause(ms) · o.quitter(code) · o.sortie(texte) · o.dossierJournal · o.base (défaut l'essai) · o.delaiSortieMs
 * @returns {Promise<{resultat: 'lance'|'deja-lance'|'port-pris', code: number, port, url, message?, connexionFinie?, fermer?, journal}>}
 */
async function lancer(o = {}) {
    const port = o.port === undefined ? PORT_DEFAUT : o.port;
    const env = o.env || process.env, envFile = o.envFile || ENV_DEFAUT;
    const fetchFn = o.fetchFn || globalThis.fetch, fetchLocal = o.fetchLocal || globalThis.fetch;
    const ouvrir = o.ouvrir || ouvrirNavigateur, pause = o.pause || (ms => new Promise(r => setTimeout(r, ms)));
    const quitter = o.quitter || (code => process.exit(code)), sortie = o.sortie || (() => { });
    const delaiSortieMs = o.delaiSortieMs === undefined ? SORTIE_APRES_ECHEC_MS : o.delaiSortieMs;
    const J = ouvrirJournal(o.dossierJournal || dossierJournalDefaut(env)), journal = t => J.ecrire(t);
    const ouvrirPage = url => { try { ouvrir(url); journal('navigateur ouvert'); } catch (e) { journal(`navigateur : ouverture impossible (${raisonCourte(e)}) ; page à ouvrir à la main : ${url}`); } };
    journal('démarrage du lanceur');

    const refusPort = () => {
        const message = `Le port ${port} est déjà utilisé par un autre programme que le juge Rat-Market : fermez-le (ou libérez ce port), puis relancez.`;
        journal(`port ${port} : pris par autre chose ; arrêt`); sortie(message);
        return { resultat: 'port-pris', code: 1, port, url: null, message, journal: J.fichier };
    };
    if (port !== 0) {
        const qui = await sonder(port, fetchLocal);
        if (qui === 'nous') { const url = `http://127.0.0.1:${port}/`; journal(`port ${port} : le juge tourne déjà ; ouverture de la page seule`); ouvrirPage(url); return { resultat: 'deja-lance', code: 0, port, url, journal: J.fichier }; }
        if (qui === 'autre') return refusPort();
    }

    let sortieAuto = null, etatFinal = 'en-cours';
    const lanceur = { surRefusJeton: () => { if (etatFinal === 'ok') echec('jeton refusé (401)'); } };
    const S = creerServeur({ apiBase: ESSAI, fetchFn, lanceur });
    let ecoute;
    try { ecoute = await S.ecouter(port); }
    catch (e) { if (e && e.code === 'EADDRINUSE') return refusPort(); journal(`écoute impossible (${raisonCourte(e)})`); sortie(`Le juge n'a pas pu démarrer (${raisonCourte(e)}). Voir ${J.fichier}`); return { resultat: 'port-pris', code: 1, port, url: null, message: raisonCourte(e), journal: J.fichier }; }
    journal(`serveur à l'écoute sur ${ecoute.url}`);
    ouvrirPage(ecoute.url);

    function echec(raison) {
        etatFinal = 'echec';
        S.poserConnexion({ etat: 'echec', message: PHRASE(raison) });
        journal(`connexion : échec — ${raison}`);
        if (!sortieAuto) sortieAuto = setTimeout(() => { journal('arrêt automatique après l\'échec de connexion'); S.fermer().then(() => quitter(0), () => quitter(0)); }, delaiSortieMs);
    }
    const connexionFinie = (async () => {
        const ids = CN.lireIdentifiants(env, envFile);
        const presents = Boolean(ids);
        journal(`identifiants du compte de mesure : ${presents ? 'présents' : 'absents'} (fichier ${envFile})`);
        if (!ids) return echec('identifiants du compte de mesure absents');
        try {
            const jeton = await connecter({ base: o.base || ESSAI, ids, fetchF: fetchFn, pause, journal });
            S.poserJeton(jeton); etatFinal = 'ok';            journal('connexion : ok (compte de mesure, administrateur ; jeton gardé en mémoire)');
        } catch (e) { echec(raisonCourte(e)); }
    })();
    return { resultat: 'lance', code: 0, port: ecoute.port, url: ecoute.url, connexionFinie, journal: J.fichier, fermer: async () => { if (sortieAuto) clearTimeout(sortieAuto); await S.fermer(); } };
}

module.exports = { lancer, connecter, sonder, ouvrirJournal, raisonCourte, transitoire, PORT_DEFAUT, ENV_DEFAUT, PHRASE };

if (require.main === module) {
    const arg = process.argv.slice(2);
    const inconnu = arg.find(a => !/^--(port=\d{2,5}|env=.+)$/.test(a));
    if (inconnu) { console.error('ARRÊT : argument non reconnu. usage : node outils/banc-200/lancer-juge.js [--port=4747] [--env=<fichier .env>]'); process.exit(1); }
    const lire = n => { const a = arg.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : undefined; };
    lancer({ port: lire('port') ? Number(lire('port')) : undefined, envFile: lire('env'), sortie: m => console.error(m) })
        .then(r => { if (r.resultat !== 'lance') process.exit(r.code); })           // 'lance' : le serveur garde le processus en vie
        .catch(() => process.exit(1));
}
