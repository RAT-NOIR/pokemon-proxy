'use strict';
// CONNEXION-ESSAI (JUGE EN UN CLIC, ordre n°30) — le chemin de connexion du COMPTE DE MESURE au service d'essai, en UN module importé par DEUX clients : v2/mesures/serie-essai.js (les séries) et
// outils/banc-200/lancer-juge.js (la page locale du juge des 200). Aucune recopie : une règle de connexion qui existerait en deux exemplaires divergerait (§21 bis).
// Écrit par ce qu'il AUTORISE :
//   · UN seul hôte : `rat-market-api-essai.onrender.com`, https, sans identifiant, sans port, sans chemin, sans suivre une redirection ;
//   · le chemin : POST /api/compte/connexion (cookie de session, en-têtes du site) → POST /api/installation AVEC la session (la limite « 2 installations par IP et par jour » ne s'efface que pour une session du compte
//     de mesure, v2/installations/exemption-banc.js) → POST /api/compte/code → POST /api/compte/lier (le jeton d'installation lié au compte) ;
//   · les identifiants se lisent par NOM, dans process.env puis dans le fichier d'environnement donné ; ils ne sont jamais imprimés, jamais écrits, jamais recopiés dans un message d'erreur.
const fs = require('fs'), crypto = require('crypto');

const HOTE_ESSAI = 'rat-market-api-essai.onrender.com';
const NOM_IDENTIFIANT = 'V2_ESSAI_BANC_IDENTIFIANT', NOM_MOT_DE_PASSE = 'V2_ESSAI_BANC_MOT_DE_PASSE';
const NOM_ORDINAIRE_IDENTIFIANT = 'V2_ESSAI_ORDINAIRE_IDENTIFIANT', NOM_ORDINAIRE_MOT_DE_PASSE = 'V2_ESSAI_ORDINAIRE_MOT_DE_PASSE';      // COMPTE-TEST : l'AUTRE couple, jamais mélangé avec celui du compte de mesure
const ORIGINE_SITE = 'https://rat-market.fr';                              // l'Origin exacte que la connexion du site exige (config.origines.site)
const DELAI_MS = 120000;

class Arret extends Error { constructor(raison) { super(raison); this.name = 'Arret'; this.raison = raison; } }

/** L'adresse de base, ou un Arret. UN SEUL chemin mène à une adresse : https, l'hôte d'essai exact, ni identifiant, ni port, ni chemin, ni requête. */
function baseAutorisee(brut) {
    let u;
    try { u = new URL(String(brut)); } catch { throw new Arret('adresse illisible'); }
    if (u.protocol !== 'https:' || u.hostname !== HOTE_ESSAI || u.port !== '' || u.username !== '' || u.password !== '' || (u.pathname !== '/' && u.pathname !== '') || u.search !== '' || u.hash !== '') throw new Arret(`hôte refusé : seul https://${HOTE_ESSAI} est visé`);
    return `https://${HOTE_ESSAI}`;
}

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
function lireIdentifiants(env, fichierEnv, lire, noms = { identifiant: NOM_IDENTIFIANT, motDePasse: NOM_MOT_DE_PASSE }) {
    const identifiant = lireVariable(noms.identifiant, env, fichierEnv, lire), motDePasse = lireVariable(noms.motDePasse, env, fichierEnv, lire);
    return identifiant && motDePasse ? { identifiant, motDePasse } : null;
}

/**
 * L'appel HTTP vers l'essai : `redirect: 'manual'` (une redirection est un Arret), délai, et le jeton Bearer posé par `definirJeton` (gardé dans cette fermeture, il n'en sort jamais).
 * @returns {{ appeler: (chemin, init, auth?) => Promise<{statut, corps, retryApres, cookie}>, definirJeton: (j) => void }}
 */
function creerAppelant({ base, fetchF, delaiMs = DELAI_MS }) {
    let jeton = null;
    const appeler = async (chemin, init, auth = 'bearer') => {
        const entetes = { ...(init.headers || {}), ...(auth === 'bearer' && jeton ? { Authorization: `Bearer ${jeton}` } : {}) };
        const rep = await fetchF(base + chemin, { redirect: 'manual', signal: AbortSignal.timeout(delaiMs), ...init, headers: entetes });
        if (rep.status >= 300 && rep.status < 400) throw new Arret(`redirection ${rep.status} refusée (le client ne suit rien)`);
        let corps = null; try { corps = await rep.json(); } catch { /* corps vide ou non JSON */ }
        const lire = n => (rep.headers && typeof rep.headers.get === 'function' ? rep.headers.get(n) : null);
        return { statut: rep.status, corps, retryApres: lire('retry-after'), cookie: lire('set-cookie') };
    };
    return { appeler, definirJeton: j => { jeton = j; } };
}

/**
 * La CONNEXION NORMALE : connexion (cookie) → installation avec la session → code → liaison. Tout refus lève un Arret (aucun détail de réponse n'est recopié : ils pourraient porter un secret).
 * Le jeton d'installation sert de Bearer pour la seule liaison ; le jeton LIÉ (celui de `lie.corps.jetonInstallation`) est rendu à l'appelant, qui juge le compte (administrateur ou ordinaire) puis appelle `definirJeton`.
 * @returns {Promise<{statut, corps}>} la réponse de la liaison (statut 200, corps.jetonInstallation texte garantis)
 */
const refusDe = (etape, r) => { throw new Arret(`connexion du compte de mesure : ${etape} refusée (${r.statut})${r.statut === 429 ? ` — réessayer dans ${r.retryApres ?? '?'} s` : ''}`); };
const entetesDuSite = origineSite => ({ Origin: origineSite, 'X-Rat-Market': '1', 'Content-Type': 'application/json' });

/** La SESSION du compte de mesure : POST /api/compte/connexion → la valeur du cookie `rm_session` (texte). Lève un Arret sur tout refus. L'appelant la garde EN MÉMOIRE, jamais ailleurs. */
async function ouvrirSession({ appeler, ids, origineSite = ORIGINE_SITE }) {
    const cx = await appeler('/api/compte/connexion', { method: 'POST', headers: entetesDuSite(origineSite), body: JSON.stringify({ email: ids.identifiant, motDePasse: ids.motDePasse }) }, null);
    const session = cx.cookie ? /(?:^|[\s,;])rm_session=([^;\s,]+)/.exec(String(cx.cookie)) : null;
    if (cx.statut !== 200 || !session) refusDe('connexion', cx);
    return session[1];
}
/** Un code de liaison (6 caractères, 10 min, usage unique, 3 vivants au plus par compte) pour la session donnée : POST /api/compte/code. Rend la réponse brute { statut, corps, retryApres } : l'appelant juge (200 + code, 401 session expirée, 429 trop de codes). */
const demanderCode = ({ appeler, session, origineSite = ORIGINE_SITE }) => appeler('/api/compte/code', { method: 'POST', headers: { ...entetesDuSite(origineSite), Cookie: `rm_session=${session}` }, body: '{}' }, null);

async function connexionNormale({ appeler, definirJeton, ids, origineSite = ORIGINE_SITE, versionExtension, libelle = 'serie-essai', surSession }) {
    const refus = refusDe, entetesSite = entetesDuSite(origineSite);
    // INST-BANC : la connexion d'abord, puis l'installation AVEC la session — la limite « 2 installations par IP et par jour » ne s'efface que pour une session du compte de mesure (v2/installations/exemption-banc.js).
    const session = await ouvrirSession({ appeler, ids, origineSite });
    if (typeof surSession === 'function') surSession(session);                 // le lanceur du juge garde la session EN MÉMOIRE pour redemander un code ; serie-essai ne passe rien
    const inst = await appeler('/api/installation', { method: 'POST', headers: { ...entetesSite, Cookie: `rm_session=${session}` }, body: JSON.stringify({ versionExtension, libelle }) }, null);
    if (inst.statut !== 201 || !inst.corps || typeof inst.corps.jetonInstallation !== 'string') refus('création de l\'installation', inst);
    const cd = await demanderCode({ appeler, session, origineSite });
    if (cd.statut !== 200 || !cd.corps || typeof cd.corps.code !== 'string') refus('code de liaison', cd);
    definirJeton(inst.corps.jetonInstallation);
    const lie = await appeler('/api/compte/lier', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `serie-lier-${crypto.randomBytes(12).toString('hex')}` }, body: JSON.stringify({ code: cd.corps.code }) });
    if (lie.statut !== 200 || !lie.corps || typeof lie.corps.jetonInstallation !== 'string') refus('liaison', lie);
    return lie;
}

module.exports = { Arret, HOTE_ESSAI, ORIGINE_SITE, NOM_IDENTIFIANT, NOM_MOT_DE_PASSE, NOM_ORDINAIRE_IDENTIFIANT, NOM_ORDINAIRE_MOT_DE_PASSE, DELAI_MS, baseAutorisee, lireVariable, lireIdentifiants, creerAppelant, connexionNormale, ouvrirSession, demanderCode };
