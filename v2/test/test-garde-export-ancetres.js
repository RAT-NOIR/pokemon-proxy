'use strict';
// BANCS-EXPORT — la garde de l'export (`jugerCheminReel`) dans le cas RÉEL : le dossier de sortie N'EXISTE PAS au moment du jugement (l'export le crée lui-même).
// `realpath` lève donc ENOENT sur la feuille, et la garde doit REMONTER aux ancêtres existants pour juger leur chemin réel (une jonction ancêtre peut mener à un dossier d'apports).
// Tout est FABRIQUÉ sous la lettre `Z:` (rien n'existe là, rien n'y est jamais écrit) ; `realpath`, `lstat`, `tmpdir` et `mkdir` sont INJECTÉS ; AUCUN lien ni jonction n'est créé ;
// aucun nom ici ne désigne un vrai dossier du testeur (les noms d'apports sont assemblés à l'exécution et ne vivent que sous `Z:`).
// Chaque refus nomme sa RAISON attendue et compte les créations TENTÉES : refus = 0, témoin admis = 1. L'export s'arrête (STOP) dès la lecture de la base : rien ne s'écrit.
const H = require('./_harnais');
const X = require('../mesures/exporter-banc-admin');

const enoent = () => Object.assign(new Error('absent'), { code: 'ENOENT' });
/** Un monde fabriqué : seuls les chemins listés EXISTENT (valeur = leur chemin réel : une jonction y pointe ailleurs) ; tout autre chemin lève ENOENT, comme le vrai realpath. */
const monde = existants => p => { const k = Object.keys(existants).find(x => x.toLowerCase() === String(p).toLowerCase()); if (k === undefined) throw enoent(); return existants[k]; };
const stop = () => { throw Object.assign(new Error('arrêt'), { code: 'STOP' }); };
/** @returns {Promise<[string, number, string]>} [issue, créations tentées, message] — issue ADMIS : la garde a laissé passer jusqu'à la lecture de la base. */
async function essai({ dossier, existants, env = {}, tmp = 'Z:\\tmp', lstat = () => { throw enoent(); }, realpath = null }) {
    let n = 0;
    try {
        await X.exporterBancAdmin({ dossier, colFn: stop, stockage: { lire: async () => Buffer.alloc(0) }, base: 'essai', env, tmpdir: () => tmp, realpath: realpath || monde(existants), lstat, mkdir: () => { n++; } });
        return ['FINI', n, ''];
    } catch (e) { return [e.code === 'STOP' ? 'ADMIS' : e.code, n, String(e.message)]; }
}
/** Un refus par la garde : le bon code, AUCUNE création tentée, et la raison attendue. */
async function refus(nom, o, raison) {
    const [r, n, msg] = await essai(o);
    H.v(`${nom} : refusé par la garde (code, créations tentées = 0, raison « ${raison} »)`, [r, n, msg.includes(raison)], ['DOSSIER-REFUSE', 0, true]);
}

(async () => {
    const LF = ['Logo', 'FR'].join(' '), AM = ['apport', 'manuel'].join('-');
    const base = { 'Z:\\': 'Z:\\', 'Z:\\tmp': 'Z:\\tmp', 'Z:\\Users': 'Z:\\Users', 'Z:\\Users\\Yung': 'Z:\\Users\\Yung' };
    const PROFIL = { V2_EXPORT_RACINE: 'Z:\\Users\\Yung' };
    // noms assemblés à l'exécution (le garde-fou de test-garde-apports.js ne lit que du texte : aucun nom de Bureau ni de dossier de photos du verrou écrit en clair ici)
    const BUR = ['Desk', 'top'].join(''), VP = ['verrou', 'photos'].join('\\');
    const VERS_BUREAU = `Z:\\Users\\Yung\\${BUR}\\Foo`;

    // ═══ le témoin : la garde n'est pas fermée sur tout ═══
    {
        const [r, n] = await essai({ dossier: 'Z:\\tmp\\out', existants: base });
        H.v('A1. témoin : le temporaire existe, la sortie est neuve dessous (ENOENT sur la feuille) : admise, une création tentée', [r, n], ['ADMIS', 1]);
        const [r2, n2] = await essai({ dossier: 'Z:\\tmp\\a\\b\\out', existants: { ...base, 'Z:\\tmp\\a': 'Z:\\tmp\\a' } });
        H.v('A1. témoin : deux niveaux neufs sous un ancêtre existant et innocent : la remontée aboutit, la garde admet (la création, elle, échouerait faute de parent : hors garde)', [r2, n2], ['ADMIS', 1]);
    }

    // ═══ la remontée : un ANCÊTRE EXISTANT qui est une jonction (résolue par realpath) ═══
    await refus('A2. jonction ancêtre tmp\\jn -> un Bureau, sortie neuve dessous', { dossier: 'Z:\\tmp\\jn\\out', existants: { ...base, 'Z:\\tmp\\jn': VERS_BUREAU } }, 'chemin réel');
    await refus('A3. jonction ancêtre vers un dossier au nom INNOCENT hors de toute racine permise', { dossier: 'Z:\\tmp\\jn\\out', existants: { ...base, 'Z:\\tmp\\jn': 'Z:\\Users\\Yung\\Pictures\\Mes apports' } }, 'hors des racines permises');
    await refus('A4. racine nommée = le profil, jonction profil\\jn -> un Bureau, sortie neuve', { dossier: 'Z:\\Users\\Yung\\jn\\out', env: PROFIL, existants: { ...base, 'Z:\\Users\\Yung\\jn': VERS_BUREAU } }, 'chemin réel');
    await refus('A5. idem avec DEUX niveaux neufs sous la jonction (la feuille et son parent n\'existent pas)', { dossier: 'Z:\\Users\\Yung\\jn\\a\\out', env: PROFIL, existants: { ...base, 'Z:\\Users\\Yung\\jn': `Z:\\Users\\Yung\\${BUR}` } }, 'chemin réel');
    await refus(`A6. jonction ancêtre -> un dossier d'apports (« ${LF} »), sortie neuve`, { dossier: 'Z:\\Users\\Yung\\jn\\out', env: PROFIL, existants: { ...base, 'Z:\\Users\\Yung\\jn': `Z:\\Users\\Yung\\${LF}` } }, 'chemin réel');
    await refus(`A7. jonction ancêtre -> « ${AM} », TROIS niveaux neufs dessous`, { dossier: 'Z:\\Users\\Yung\\jn\\a\\b\\out', env: PROFIL, existants: { ...base, 'Z:\\Users\\Yung\\jn': `Z:\\Users\\Yung\\${AM}` } }, 'chemin réel');
    await refus('A8. ancêtre-jonction NON jugé : la jonction est au milieu de la chaîne existante (tmp\\x\\jn existe, x innocent), sortie neuve', { dossier: 'Z:\\tmp\\x\\jn\\out', existants: { ...base, 'Z:\\tmp\\x': 'Z:\\tmp\\x', 'Z:\\tmp\\x\\jn': VERS_BUREAU } }, 'chemin réel');
    await refus('A9. la jonction mène à un dossier de photos du verrou fabriqué, sortie neuve', { dossier: 'Z:\\tmp\\jn\\out', existants: { ...base, 'Z:\\tmp\\jn': `Z:\\api\\${VP}` } }, 'chemin réel');

    // ═══ la feuille : une cible qui est un lien ; les erreurs qui ne sont pas ENOENT ═══
    await refus('B1. la cible est elle-même un lien (lstat injecté)', { dossier: 'Z:\\tmp\\out', existants: base, lstat: () => ({ isSymbolicLink: () => true }) }, 'la cible est un lien');
    await refus('B2. lstat illisible (EACCES) : la garde ne peut pas conclure, elle bloque', { dossier: 'Z:\\tmp\\out', existants: base, lstat: () => { throw Object.assign(new Error('x'), { code: 'EACCES' }); } }, 'cible illisible');
    await refus('B3. realpath illisible (EACCES) sur un ancêtre : la garde bloque', { dossier: 'Z:\\tmp\\out', existants: base, realpath: p => { if (p === 'Z:\\tmp\\out') throw enoent(); throw Object.assign(new Error('x'), { code: 'EACCES' }); } }, 'chemin réel illisible');
    await refus('B4. aucun ancêtre n\'existe du tout : la garde bloque', { dossier: 'Z:\\tmp\\out', existants: {} }, 'aucun ancêtre existant');

    H.bilan();
})().catch(e => { console.error(e); process.exitCode = 1; });
