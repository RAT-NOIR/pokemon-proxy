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
    const source = async () => ({ ok: true, sets: [], docs: [], lignes: [], fermer: async () => { } });
    const passe = await lancer([`--vers=${vers}`, ...epingle], essai, { source, catalogue: new Map([[1, 1]]), decider });
    H.v('O6. cible essai + empreinte exacte : la construction démarre et la décision REÇOIT un Set de la liste (101, 202)', [recu instanceof Set, recu && [...recu].sort()], [true, [101, 202]]);
    recu = 'inchangé';
    await lancer([`--vers=${vers}`], essai, { source, catalogue: new Map([[1, 1]]), decider });
    H.v('O7. SANS l\'option : la décision ne reçoit rien (l\'archive est celle d\'avant, octet pour octet)', recu, undefined);
    fs.rmSync(dossier, { recursive: true, force: true });
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
