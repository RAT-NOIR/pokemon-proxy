'use strict';
// TAMPONNÉES-EMPRUNTÉES, la LISTE FERMÉE et l'option `--tamponnees-empruntees=<fichier>` de la construction de l'archive (GUICHET, passage 8, ordre n°19) :
//   · la garde du fichier (forme exacte, empreinte épinglée) ; · l'option : empreinte OBLIGATOIRE, cible = l'ESSAI seulement (écrite par ce qu'elle autorise) ; · la liste arrive jusqu'à la décision.
// Pas de réseau, pas de base : la source et le décideur sont des moyens de banc (deps).
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const H = require('./_harnais');
const T = require('../chargeur/tamponnees-empruntees');
const { principal } = require('../migrations/construire-fichier-visuels');

(async () => {
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'tamp-'));
    const sha = b => crypto.createHash('sha256').update(b).digest('hex');
    const ecrire = (o, nom = 'liste.json') => { const p = path.join(dossier, nom); fs.writeFileSync(p, typeof o === 'string' ? o : JSON.stringify(o)); return p; };
    const ok = (extra = {}, produits = [{ idProduct: 101, preuve: 'tous les scans (3) concordent' }, { idProduct: 202, preuve: 'tous les scans (2) concordent' }]) => ({ decision: 'GUICHET : preuve stricte', le: '2026-11-01', produits, ...extra });
    const pin = p => sha(fs.readFileSync(p));

    // ── la garde du fichier ─────────────────────────────────────────────────────────────────
    const bonne = ecrire(ok());
    const r = T.lireFichierTamponnees(bonne, { sha256Attendu: pin(bonne) });
    H.v('F1. une liste bien formée avec son empreinte : lue, Set d\'idProduct, empreinte rendue', [r.ok, r.produits instanceof Set, [...r.produits], r.sha256 === pin(bonne)], [true, true, [101, 202], true]);
    H.v('F2. SANS empreinte attendue : refusée (une liste dont on ne connaît pas l\'empreinte n\'est pas reconnue)', T.lireFichierTamponnees(bonne, {}).ok, false);
    H.v('F3. une empreinte qui n\'est pas celle des octets lus : refusée', T.lireFichierTamponnees(bonne, { sha256Attendu: '0'.repeat(64) }).ok, false);
    H.v('F3b. une empreinte mal formée (majuscules, courte) : refusée', [T.lireFichierTamponnees(bonne, { sha256Attendu: pin(bonne).toUpperCase() }).ok, T.lireFichierTamponnees(bonne, { sha256Attendu: 'abc' }).ok], [false, false]);
    const mauvaises = {
        'fichier absent': path.join(dossier, 'nexiste-pas.json'), 'pas du JSON': ecrire('pas du json', 'm1.json'), 'un tableau': ecrire('[]', 'm2.json'),
        'clé en trop': ecrire(ok({ extra: 1 }), 'm3.json'), 'decision absente': ecrire({ le: '2026-11-01', produits: [] }, 'm4.json'), 'date invalide': ecrire(ok({ le: '2026-02-30' }), 'm5.json'),
        'produits vide': ecrire(ok({}, []), 'm6.json'), 'idProduct en chaîne': ecrire(ok({}, [{ idProduct: '101', preuve: 'x' }]), 'm7.json'), 'idProduct négatif': ecrire(ok({}, [{ idProduct: -1, preuve: 'x' }]), 'm8.json'),
        'preuve vide': ecrire(ok({}, [{ idProduct: 101, preuve: '  ' }]), 'm9.json'), 'preuve absente': ecrire(ok({}, [{ idProduct: 101 }]), 'm10.json'), 'clé en trop sur une ligne': ecrire(ok({}, [{ idProduct: 101, preuve: 'x', verdict: 'juste' }]), 'm11.json'),
        'doublon': ecrire(ok({}, [{ idProduct: 101, preuve: 'x' }, { idProduct: 101, preuve: 'y' }]), 'm12.json'), 'trop de lignes': ecrire(ok({}, Array.from({ length: 5001 }, (_, i) => ({ idProduct: i + 1, preuve: 'x' }))), 'm13.json')
    };
    const refus = Object.fromEntries(Object.entries(mauvaises).map(([k, p]) => [k, (() => { let e; try { e = pin(p); } catch { e = '0'.repeat(64); } return T.lireFichierTamponnees(p, { sha256Attendu: e }).ok; })()]));
    H.v('F4. toute autre forme est refusée, même avec la bonne empreinte', Object.values(refus).every(x => x === false), true);
    H.v('F4b. chaque refus porte sa raison (jamais vide)', Object.values(mauvaises).every(p => { let e; try { e = pin(p); } catch { e = '0'.repeat(64); } const x = T.lireFichierTamponnees(p, { sha256Attendu: e }); return typeof x.raison === 'string' && x.raison.length > 5; }), true);

    // ── l'option de la construction ─────────────────────────────────────────────────────────
    const lancer = async (argv, env, deps = {}) => {
        const sortie = [], lo = console.log, le = console.error; console.log = (...a) => sortie.push(a.join(' ')); console.error = (...a) => sortie.push(a.join(' '));
        try { const code = await principal(['node', 'script', ...argv], env, deps); return { code, texte: sortie.join('\n') }; } finally { console.log = lo; console.error = le; }
    };
    const SECRET = 'x'.repeat(40), vers = path.join(dossier, 'sortie.rmv');
    const pasDeSource = { source: async () => { throw new Error('la source ne doit pas être lue'); }, catalogue: new Map() };
    const epingle = [`--tamponnees-empruntees=${bonne}`, `--tamponnees-empruntees-sha256=${pin(bonne)}`];
    const essai = { V2_VISUELS_HMAC: SECRET, V2_CIBLE: 'essai' };
    const sansPin = await lancer([`--vers=${vers}`, `--tamponnees-empruntees=${bonne}`], essai, pasDeSource);
    H.v('O1. sans empreinte épinglée : refus, code 1, avant toute lecture de la source', [sansPin.code, /empreinte/.test(sansPin.texte)], [1, true]);
    const mauvaisPin = await lancer([`--vers=${vers}`, `--tamponnees-empruntees=${bonne}`, `--tamponnees-empruntees-sha256=${'0'.repeat(64)}`], essai, pasDeSource);
    H.v('O2. une empreinte fausse : refus, code 1', [mauvaisPin.code, /refus/i.test(mauvaisPin.texte)], [1, true]);
    const pinSeul = await lancer([`--vers=${vers}`, `--tamponnees-empruntees-sha256=${pin(bonne)}`], essai, pasDeSource);
    H.v('O3. une empreinte sans liste : refus (aucune liste à épingler)', pinSeul.code, 1);
    const sansForme = await lancer([`--vers=${vers}`, '--tamponnees-empruntees'], essai, pasDeSource);
    H.v('O3b. l\'option sans « = fichier » : refus', sansForme.code, 1);
    // la CIBLE : écrite par ce qu'elle autorise — seul V2_CIBLE === 'essai' passe
    const cibles = {};
    for (const [nom, valeur] of [['absente', undefined], ['production', 'production'], ['vide', ''], ['Essai', 'Essai'], ['essai ', 'essai '], ['test', 'test']]) {
        const env = { V2_VISUELS_HMAC: SECRET, ...(valeur === undefined ? {} : { V2_CIBLE: valeur }) };
        const x = await lancer([`--vers=${vers}`, ...epingle], env, pasDeSource);
        cibles[nom] = [x.code, /essai/i.test(x.texte)];
    }
    H.v('O4. cible absente, « production », vide, « Essai », « essai  », « test » : TOUT est refusé, en nommant l\'essai (la garde n\'énumère pas ses refus)', Object.values(cibles).every(v => v[0] === 1 && v[1] === true), true);
    const depot = await lancer(['--deposer', ...epingle], { ...essai, V2_VISUELS_R2_BUCKET: 'bucket-prod' }, pasDeSource);
    H.v('O5. avec --deposer : le bucket visé doit être celui que V2_VISUELS_ESSAI_BUCKET nomme ; absent ou différent : refus', [depot.code, /V2_VISUELS_ESSAI_BUCKET|bucket/i.test(depot.texte)], [1, true]);
    const depot2 = await lancer(['--deposer', ...epingle], { ...essai, V2_VISUELS_R2_BUCKET: 'bucket-prod', V2_VISUELS_ESSAI_BUCKET: 'autre-bucket' }, pasDeSource);
    H.v('O5b. un bucket d\'essai différent du bucket visé : refus', depot2.code, 1);
    // la liste arrive jusqu'à la décision
    let recu = null;
    const decider = async (args) => { recu = args.tamponneesEmpruntees; throw Object.assign(new Error('arrêt du banc'), { motif: 'arrêt du banc après la décision' }); };
    // la source de banc rejoue ce que fait la vraie (sourceCartes) : elle lit le nom de la base SUR sa connexion et le passe à `controleBase` AVANT de lire quoi que ce soit
    let baseDuBanc = 'rm_essai', controleAppele = 0;
    const source = async ({ controleBase } = {}) => {
        if (controleBase) { controleAppele++; const r = controleBase(baseDuBanc); if (r && r.ok === false) return r; }
        return { ok: true, sets: [], docs: [], lignes: [], fermer: async () => { } };
    };
    const sourceSansControle = async () => ({ ok: true, sets: [], docs: [], lignes: [], fermer: async () => { } });
    const passe = await lancer([`--vers=${vers}`, ...epingle], essai, { source, catalogue: new Map([[1, 1]]), decider });
    H.v('O6. cible essai + empreinte exacte : la construction démarre et la décision REÇOIT un Set de la liste (101, 202)', [recu instanceof Set, recu && [...recu].sort()], [true, [101, 202]]);
    recu = 'inchangé';
    await lancer([`--vers=${vers}`], essai, { source, catalogue: new Map([[1, 1]]), decider });
    H.v('O7. SANS l\'option : la décision ne reçoit rien (l\'archive est celle d\'avant, octet pour octet)', recu, undefined);
    // ── tour 2 (relecture p8, I2) : la cible est PROUVÉE différente de la production, pas déclarée ──────────
    const CE = T.cibleEstEssai;
    const prod = { R2_BUCKET_IMAGES: 'images-prod', V2_VISUELS_PROD_BUCKET: 'visuels-prod' };
    const dep = { V2_CIBLE: 'essai', V2_VISUELS_R2_BUCKET: 'visuels-essai', V2_VISUELS_ESSAI_BUCKET: 'visuels-essai', ...prod };
    H.v('C1. chemin POSITIF : essai déclaré, bucket visé = bucket d\'essai, tous deux différents des buckets de la production connus', CE(dep, { deposer: true }).ok, true);
    H.v('C2. essai == R2_BUCKET_IMAGES (le bucket d\'images de la production) : refus', CE({ ...dep, V2_VISUELS_R2_BUCKET: 'images-prod', V2_VISUELS_ESSAI_BUCKET: 'images-prod' }, { deposer: true }).ok, false);
    H.v('C3. essai == le bucket des visuels de la production : refus', CE({ ...dep, V2_VISUELS_R2_BUCKET: 'visuels-prod', V2_VISUELS_ESSAI_BUCKET: 'visuels-prod' }, { deposer: true }).ok, false);
    H.v('C3b. l\'égalité est jugée après trim (« visuels-prod  » == « visuels-prod »)', CE({ ...dep, V2_VISUELS_R2_BUCKET: ' visuels-prod ', V2_VISUELS_ESSAI_BUCKET: 'visuels-prod' }, { deposer: true }).ok, false);
    H.v('C4. aucune référence de la production connue : « je ne sais pas » = refus (une garde qui ne peut pas conclure refuse)', CE({ V2_CIBLE: 'essai', V2_VISUELS_R2_BUCKET: 'x', V2_VISUELS_ESSAI_BUCKET: 'x' }, { deposer: true }).ok, false);
    // tour 4 (relecture p8 re-relecture, I2) : CHAQUE bucket de production connu doit être NOMMÉ et posé ; une seule variable ne suffit plus ; la cause du refus est NOMMÉE
    const sansImages = CE({ ...dep, R2_BUCKET_IMAGES: undefined }, { deposer: true }), sansVisuels = CE({ ...dep, V2_VISUELS_PROD_BUCKET: undefined }, { deposer: true });
    H.v('C4b. (tour 4) R2_BUCKET_IMAGES seul posé : refus, la cause nomme V2_VISUELS_PROD_BUCKET ; V2_VISUELS_PROD_BUCKET seul : refus, la cause nomme R2_BUCKET_IMAGES', [sansVisuels.ok, /V2_VISUELS_PROD_BUCKET/.test(sansVisuels.raison || ''), sansImages.ok, /R2_BUCKET_IMAGES/.test(sansImages.raison || '')], [false, true, false, true]);
    H.v('C4c. une variable posée mais VIDE (ou d\'espaces) vaut non posée : refus', [CE({ ...dep, R2_BUCKET_IMAGES: '  ' }, { deposer: true }).ok, CE({ ...dep, V2_VISUELS_PROD_BUCKET: '' }, { deposer: true }).ok], [false, false]);
    const banc = e => CE({ ...dep, ...e }, { deposer: true });
    H.v('C4d. R2_BUCKET_BANC, s\'il est posé, est un bucket de production de plus : essai == banc refuse (cause nommée), essai != banc passe, absent passe', [banc({ R2_BUCKET_BANC: 'visuels-essai' }).ok, /R2_BUCKET_BANC/.test(banc({ R2_BUCKET_BANC: 'visuels-essai' }).raison || ''), banc({ R2_BUCKET_BANC: 'banc-prod' }).ok, banc({}).ok], [false, true, true, true]);
    H.v('C4f. le bucket VISÉ doit être celui de l\'essai : visé != essai (tous deux posés, ni l\'un ni l\'autre en production) refuse', [CE({ ...dep, V2_VISUELS_R2_BUCKET: 'autre-bucket' }, { deposer: true }).ok, /V2_VISUELS_R2_BUCKET/.test(CE({ ...dep, V2_VISUELS_R2_BUCKET: 'autre-bucket' }, { deposer: true }).raison || '')], [false, true]);
    H.v('C4e. sans dépôt, les buckets de production ne sont pas exigés (rien n\'est écrit sur R2)', CE({ V2_CIBLE: 'essai' }, { deposer: false }).ok, true);
    H.v('C5. la base connectée, lue sur la connexion réelle : seule « rm_essai » passe (« test » = la production, « cartes », vide, absente de la lecture = refus)', ['rm_essai', 'test', 'cartes', '', 'rm_essai2'].map(b => CE(dep, { deposer: true, baseConnectee: b }).ok), [true, false, false, false, false]);
    H.v('C5b. sans connexion (aucune base ouverte) : rien à refuser sur ce point', CE(dep, { deposer: true, baseConnectee: null }).ok, true);
    H.v('C6. sans dépôt, seul V2_CIBLE compte ; sans rien : refus', [CE({ V2_CIBLE: 'essai' }).ok, CE({}).ok], [true, false]);
    // le chemin --deposer de la commande, avec des buckets ÉGAUX (M7) : le positif atteint la décision (le banc s'arrête là, rien n'est déposé), l'égalité essai == production est refusée avant
    const envDepot = { ...dep, V2_VISUELS_HMAC: SECRET, V2_VISUELS_R2_COMPTE: 'compte-banc', V2_VISUELS_R2_ECR_CLE_ID: 'cle-banc', V2_VISUELS_R2_ECR_SECRET: 'secret-banc', V2_VISUELS_R2_OBJET: 'objet-banc.rmv' };
    recu = null;
    const dPos = await lancer(['--deposer', ...epingle, '--catalogue=' + bonne], envDepot, { source, catalogue: new Map([[1, 1]]), decider });
    H.v('O8. (M7) --deposer, buckets égaux et différents de la production : la décision REÇOIT la liste (le banc s\'arrête avant tout dépôt)', [recu instanceof Set, dPos.code], [true, 1]);
    recu = null;
    const dEgal = await lancer(['--deposer', ...epingle, '--catalogue=' + bonne], { ...envDepot, V2_VISUELS_R2_BUCKET: 'images-prod', V2_VISUELS_ESSAI_BUCKET: 'images-prod' }, { source, catalogue: new Map([[1, 1]]), decider });
    H.v('O8b. (M7) --deposer avec essai == production : refus, la décision n\'est PAS atteinte, rien n\'est déposé', [recu, dEgal.code, /production|essai/i.test(dEgal.texte)], [null, 1, true]);
    // le catalogue vient d'un FICHIER : jamais une connexion à la base de production
    const sansCatalogue = await lancer([`--vers=${vers}`, ...epingle], essai, { source });
    H.v('O9. avec la liste, le catalogue vient de --catalogue=<fichier> : sans lui (donc par la connexion à la base `test`), refus', [sansCatalogue.code, /doit venir de --catalogue.*la production/.test(sansCatalogue.texte)], [1, true]);
    // ── tour 4 : « base connectée = rm_essai » est RÉELLEMENT câblé, par le chemin de la commande ──────────────
    const refusBase = async nom => { baseDuBanc = nom; recu = null; const x = await lancer([`--vers=${vers}`, ...epingle], essai, { source, catalogue: new Map([[1, 1]]), decider }); return { recu, code: x.code, texte: x.texte }; };
    const bCartes = await refusBase('cartes'), bTest = await refusBase('test'), bVide = await refusBase(''), bAbsent = await refusBase(undefined), bRm2 = await refusBase('rm_essai2'), bRm = await refusBase('rm_essai');
    H.v('O10. la base lue sur la connexion réelle passe par la commande : « cartes », « test », « rm_essai2 » refusées (la décision n\'est PAS atteinte, la raison nomme rm_essai)', [bCartes, bTest, bRm2].map(x => [x.recu, x.code, /rm_essai/.test(x.texte)]), [[null, 1, true], [null, 1, true], [null, 1, true]]);
    H.v('O11. une base VIDE ou ILLISIBLE (undefined) refuse aussi : une base réelle n\'est jamais vide', [bVide, bAbsent].map(x => [x.recu, x.code]), [[null, 1], [null, 1]]);
    H.v('O12. « rm_essai » exactement : la décision reçoit la liste', [bRm.recu instanceof Set, bRm.code], [true, 1]);
    baseDuBanc = 'rm_essai'; recu = null; controleAppele = 0;
    const sansCtl = await lancer([`--vers=${vers}`, ...epingle], essai, { source: sourceSansControle, catalogue: new Map([[1, 1]]), decider });
    H.v('O13. une source qui n\'exécute JAMAIS le contrôle de la base : la garde ne peut pas conclure, REFUS (jamais un passage par défaut)', [recu, sansCtl.code, /base/i.test(sansCtl.texte)], [null, 1, true]);
    recu = 'inchangé'; controleAppele = 0;
    await lancer([`--vers=${vers}`], essai, { source, catalogue: new Map([[1, 1]]), decider });
    H.v('O14. SANS l\'option : le contrôle de la base n\'est pas demandé (la construction d\'avant est inchangée)', [controleAppele, recu], [0, undefined]);
    // la vraie source (sourceCartes) : le nom de la base est lu sur la connexion ouverte et jugé AVANT toute lecture
    const { sourceCartes } = require('../chargeur/source');
    const lectures = []; const colonne = nom => ({ find: () => ({ [Symbol.asyncIterator]: async function* () { lectures.push(nom); } }) });
    const fausseOuverture = nomBase => async () => ({ ok: true, nomBase, cartes: { collection: n => ({ ...colonne(n), find: () => { lectures.push(n); return (async function* () { })(); } }), fermer: async () => { } } });
    const refusReel = [];
    for (const nom of ['cartes', '', undefined, 'rm_essai']) { lectures.length = 0; const r = await sourceCartes({ env: {}, ouvrir: fausseOuverture(nom), controleBase: n => T.cibleEstEssai({ V2_CIBLE: 'essai' }, { baseConnectee: n }) }); refusReel.push([r.ok === true, lectures.length > 0]); }
    H.v('O15. sourceCartes : le nom de la base lu sur la connexion est jugé AVANT la première lecture ; « cartes », vide, illisible : refus sans lecture ; « rm_essai » : lue', refusReel, [[false, false], [false, false], [false, false], [true, true]]);
    fs.rmSync(dossier, { recursive: true, force: true });
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
