'use strict';
// JUMBO-VISUEL (27/10) — plus aucun visuel d'un AUTRE tirage affiché sans le dire.
//   · la liste du catalogue (JUMBO lus contre le scan de leur fiche) entre par UN fichier de l'API, jugé par une garde écrite par ce qu'elle AUTORISE (v2/chargeur/jumbos-visuel.js) ;
//   · un JUMBO identique à sa carte est un EMPRUNT (colonne des emprunts) servi avec le bandeau JUMBO, SANS mention ; un JUMBO différent ou illisible reste CANDIDAT (marqueurs, partages, groupe)
//     mais AUCUN visuel ne lui est servi (colonne des masqués, format 5) ; jamais d'exclusion de l'archive ;
//   · les 69 fiches Pokémon de Base Set (scans « Édition 1 ») portent la mention « Visuel d'un autre tirage », sauf un produit PROUVÉ 1re édition ; l'identification ne change pas.
// Pas de base, pas de réseau : sources factices, listes FABRIQUÉES dans le dossier temporaire.
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const H = require('./_harnais');
const J = require('../chargeur/jumbos-visuel');

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'jumbo-visuel-'));
let n = 0;
const ecrire = c => { const p = path.join(dossier, `liste-${++n}.json`); fs.writeFileSync(p, typeof c === 'string' ? c : JSON.stringify(c)); return p; };
const SHA = 'a'.repeat(64);
const PRODUITS = [{ idProduct: 101, verdict: 'identique' }, { idProduct: 102, verdict: 'identique' }, { idProduct: 201, verdict: 'different' }, { idProduct: 202, verdict: 'illisible' }, { idProduct: 203, verdict: 'fiche-fausse' }];
const liste = (extra = {}, produits = PRODUITS) => ({ decision: 'décision de banc (liste fabriquée)', le: '2026-10-27', source: 'chemin de documentation', listeLe: '2026-10-27T07:24:27.126Z', sha256Source: SHA, produits, ...extra });
const refus = f => { const r = J.lireFichierJumbos(typeof f === 'string' ? f : ecrire(f)); return r.ok ? null : r.raison; };

(async () => {
    // ── 1. la GARDE du fichier : écrite par ce qu'elle AUTORISE
    const bon = J.lireFichierJumbos(ecrire(liste()));
    H.v('1a. une liste conforme est lue : 5 produits, deux classes (2 emprunts, 3 sans visuel), la décision, la date, la date et l\'empreinte de la liste source',
        [bon.ok, bon.produits.length, bon.comptes, bon.decision, bon.le, bon.listeLe, bon.sha256Source], [true, 5, { emprunt: 2, sansVisuel: 3, parVerdict: { identique: 2, different: 1, illisible: 1, 'fiche-fausse': 1 } }, 'décision de banc (liste fabriquée)', '2026-10-27', '2026-10-27T07:24:27.126Z', SHA]);
    H.v('1b. la classe vient du verdict, et d\'eux seuls : identique -> emprunt ; différent, illisible, fiche-fausse -> sans-visuel (un doute n\'est jamais un emprunt)',
        [...bon.classes].sort((a, b) => a[0] - b[0]), [[101, 'emprunt'], [102, 'emprunt'], [201, 'sans-visuel'], [202, 'sans-visuel'], [203, 'sans-visuel']]);
    H.v('1c. l\'empreinte du fichier lu est celle de ses octets', bon.sha256, crypto.createHash('sha256').update(fs.readFileSync(ecrire(liste()))).digest('hex'));
    H.v('1d. les verdicts fermés sont exactement quatre', J.VERDICTS, ['identique', 'different', 'illisible', 'fiche-fausse']);
    const REFUS = [
        ['aucun fichier nommé', null], ['fichier introuvable', path.join(dossier, 'absent.json')], ['fichier vide', ecrire('')], ['JSON illisible', ecrire('{')],
        ['pas un objet', ecrire('[]')], ['clé inconnue à la racine', liste({ extra: 1 })], ['decision absente', (() => { const l = liste(); delete l.decision; return l; })()], ['decision vide', liste({ decision: '  ' })],
        ['date `le` invalide', liste({ le: '2026-13-40' })], ['date `le` mal formée', liste({ le: '27/10/2026' })], ['listeLe absente', (() => { const l = liste(); delete l.listeLe; return l; })()],
        ['listeLe pas une date', liste({ listeLe: 'hier' })], ['listeLe sans heure', liste({ listeLe: '2026-10-27' })], ['sha256Source absent', (() => { const l = liste(); delete l.sha256Source; return l; })()],
        ['sha256Source trop court', liste({ sha256Source: 'abc' })], ['sha256Source en majuscules', liste({ sha256Source: 'A'.repeat(64) })], ['source pas un texte', liste({ source: 4 })],
        ['produits absent', (() => { const l = liste(); delete l.produits; return l; })()], ['produits vide', liste({}, [])], ['produits pas un tableau', liste({ produits: {} })],
        ['produit pas un objet', liste({}, [7])], ['produit : clé inconnue', liste({}, [{ idProduct: 1, verdict: 'identique', x: 1 }])], ['idProduct non entier', liste({}, [{ idProduct: 1.5, verdict: 'identique' }])],
        ['idProduct nul', liste({}, [{ idProduct: 0, verdict: 'identique' }])], ['idProduct en texte', liste({}, [{ idProduct: '5', verdict: 'identique' }])],
        ['verdict hors liste', liste({}, [{ idProduct: 1, verdict: 'sans-doute' }])], ['verdict absent', liste({}, [{ idProduct: 1 }])], ['verdict null', liste({}, [{ idProduct: 1, verdict: null }])],
        ['idProduct en double (même verdict)', liste({}, [{ idProduct: 1, verdict: 'identique' }, { idProduct: 1, verdict: 'identique' }])],
        ['idProduct en double (deux verdicts)', liste({}, [{ idProduct: 1, verdict: 'identique' }, { idProduct: 1, verdict: 'different' }])],
        ['plus de 5000 produits', liste({}, Array.from({ length: 5001 }, (_, i) => ({ idProduct: i + 1, verdict: 'identique' })))]];
    const lesRefus = REFUS.map(([nom, f]) => [nom, typeof f === 'string' || f === null ? refus(f) : refus(f)]);
    H.v('1e. REFUSÉS, avec leur raison (aucun ne passe) : ' + REFUS.length + ' formes', lesRefus.filter(([, r]) => r === null).map(([nom]) => nom), []);
    H.vrai('1f. chaque refus porte une raison lisible', lesRefus.every(([, r]) => typeof r === 'string' && r.length > 8));
    // la garde de la Map reçue (celle qui entre dans la décision) : écrite par ce qu'elle autorise aussi
    H.v('1g. une Map valide est admise ; vide, mal typée, classe inconnue, id non entier : refusées',
        [J.jugerClasses(bon.classes), J.jugerClasses(new Map()), J.jugerClasses([[1, 'emprunt']]), J.jugerClasses(new Map([[1, 'autre']])), J.jugerClasses(new Map([[1.5, 'emprunt']])), J.jugerClasses(new Map([[0, 'emprunt']])), J.jugerClasses(null)].map(r => r === null),
        [true, false, false, false, false, false, false]);
    // la garde sœur des exclusions (même forme, copiée) lève sur une date impossible alors qu'elle promet de ne jamais lever : trouvé en écrivant 1e
    const X = require('../chargeur/exclusions');
    let leve = false, rX = null; try { rX = X.lireFichierExclusions(ecrire({ decision: 'd', le: '2026-13-40', produits: [{ idProduct: 5, motif: 'visuel-faux' }] })); } catch { leve = true; }
    H.v('1h. la garde des exclusions REFUSE une date impossible (2026-13-40) au lieu de lever', [leve, rX && rX.ok], [false, false]);

    H.bilan();
})().catch(x => { console.error('❌', x); process.exit(1); });
