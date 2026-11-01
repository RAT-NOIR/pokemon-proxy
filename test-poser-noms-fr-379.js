// Banc du CLI de poser-noms-fr-379.js : le chemin --ecrire de bout en bout, avec une fausse connexion de la VRAIE forme de
// collecte-cartes/garde.js::ouvrirConnexions ({ cartes: <Connection>, prod, fermer } ; la base native est cartes.db). Aucune base, aucun réseau.
// (Un outil voisin a échoué en production exactement là : le banc ne couvrait que le module pur.)
const fs = require('fs');
const os = require('os');
const path = require('path');
let ok = 0, ko = 0;
const egal = (n, a, b) => { const sa = JSON.stringify(a), sb = JSON.stringify(b); if (sa === sb) ok++; else { ko++; console.log(`❌ ${n} : ${sa} ≠ ${sb}`); } };

const { principal } = require('./poser-noms-fr-379');
const M = require('./collecte-cartes/plan-noms-fr-379');

(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'noms-fr-379-banc-'));
    const pages = path.join(tmp, 'pages'), sortie = path.join(tmp, 'sortie');
    fs.mkdirSync(pages);
    fs.writeFileSync(path.join(pages, M.fichierPage('Écrapince')), 'Écrapince — Poképédia\n\nNom anglais Corphish\n', 'utf8');
    const lecteur = path.join(tmp, 'lecteur-faux.js');
    fs.writeFileSync(lecteur, `module.exports = { CLONE: 'faux', lireClone: () => ({ cartes: [{ famille: 'data', setId: 'ex6', localId: '10', noms: { fr: 'Ecrapince', en: 'Corphish' }, dex: [], cardmarket: [111] }], sets: [{ famille: 'data', id: 'ex6', cardmarket: 5 }] }) };`, 'utf8');
    const base = [`--lecteur-clone=${lecteur}`, `--pages=${pages}`, `--sortie=${sortie}`];

    const ouvrirLecture = async () => ({
        cartes: { collection: nom => ({ find: () => ({ toArray: async () => nom === 'cartes' ? [{ _id: 33758, nomEn: 'Corphish' }] : [{ carteId: 33758, idProduct: 111 }] }) }) },
        fermer: async () => {},
    });
    const faux = (o = {}) => {
        const j = { ouvertures: 0, ecritures: [], fermetures: 0, collections: [], logs: [], errs: [] };
        const mod = o.modifie;
        j.deps = {
            env: o.env || { LOT_ADDITIF_PID: '1' }, ouvrirLecture, log: m => j.logs.push(m), err: (...m) => j.errs.push(m.join(' ')),
            ouvrirConnexions: async opts => {
                j.ouvertures++; j.opts = opts;
                const base_ = { collection: nom => { j.collections.push(nom); return { bulkWrite: async ops => { j.ecritures.push(ops); return { modifiedCount: mod === undefined ? ops.length : mod }; } }; } };
                if (o.mauvaiseForme) return { db: base_, fermer: async () => { j.fermetures++; } };           // la mauvaise forme : { db } au lieu de { cartes: Connection }
                return { cartes: { db: base_ }, prod: null, fermer: async () => { j.fermetures++; } };
            },
        };
        return j;
    };

    // ---- arguments ----
    let j = faux();
    egal('A1 argument inconnu : code 2, aucune connexion', [await principal([...base, '--bidule'], j.deps), j.ouvertures], [2, 0]);
    j = faux({ env: {} });
    egal('A2 --ecrire sans LOT_ADDITIF_PID : code 2, aucune connexion', [await principal([...base, '--ecrire', '--attendu=1'], j.deps), j.ouvertures], [2, 0]);
    j = faux();
    egal('A3 --ecrire sans --attendu : code 2', [await principal([...base, '--ecrire'], j.deps), j.ouvertures], [2, 0]);
    egal('A4 --attendu sans --ecrire : code 2', await principal([...base, '--attendu=1'], j.deps), 2);

    // ---- mesure seule ----
    j = faux();
    egal('M1 mesure seule : code 0, jamais de connexion d\'écriture', [await principal(base, j.deps), j.ouvertures, j.ecritures.length], [0, 0, 0]);
    const plan = JSON.parse(fs.readFileSync(path.join(sortie, 'PLAN-379.json'), 'utf8'));
    egal('M2 le plan nomme la carte', plan.nommer.map(d => [d.carteId, d.nomFr, d.paire]), [[33758, 'Écrapince', 'tcgdex+pokepedia']]);

    // ---- écriture de bout en bout ----
    j = faux();
    egal('E1 écriture : code 0', await principal([...base, '--ecrire', '--attendu=1'], j.deps), 0);
    egal('E2 connexion demandée hors production', j.opts, { production: false });
    egal('E3 collection visée : cartes', j.collections, ['cartes']);
    egal('E4 bulkWrite avec le filtre $exists:false et le $set exact', j.ecritures.map(o => o.map(x => [x.updateOne.filter, Object.keys(x.updateOne.update.$set), x.updateOne.update.$set.nomFr, x.updateOne.update.$set.nomFrSource])),
        [[[{ _id: 33758, nomFr: { $exists: false } }, ['nomFr', 'nomFrSource', 'nomFrLe'], 'Écrapince', 'tcgdex+pokepedia']]]);
    egal('E5 la connexion est fermée', j.fermetures, 1);
    egal('E6 le plan écrit est distinct du plan de simulation', fs.existsSync(path.join(sortie, 'PLAN-379-ECRIT.json')), true);

    // ---- refus ----
    j = faux({ mauvaiseForme: true });
    egal('F1 la mauvaise forme { db } est refusée : code 1, rien d\'écrit, connexion fermée', [await principal([...base, '--ecrire', '--attendu=1'], j.deps), j.ecritures.length, j.fermetures], [1, 0, 1]);
    egal('F2 ... et le message le dit', j.errs.some(m => /forme/.test(m)), true);
    j = faux();
    egal('F3 compte différent : code 3, aucune connexion', [await principal([...base, '--ecrire', '--attendu=2'], j.deps), j.ouvertures, j.ecritures.length], [3, 0, 0]);
    j = faux({ modifie: 0 });
    egal('F4 écart plan / modifiés : code 4, connexion fermée', [await principal([...base, '--ecrire', '--attendu=1'], j.deps), j.fermetures], [4, 1]);

    console.log(`${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
