// Banc du CLI poser-noms-fr-379.js avec --niveaux=cles,espece (lot des 210) : le chemin --ecrire de bout en bout, fausse connexion de la VRAIE forme
// { cartes: <Connection>, prod, fermer } (la base native est cartes.db). Aucune base, aucun reseau.
const fs = require('fs');
const os = require('os');
const path = require('path');
let ok = 0, ko = 0;
const egal = (n, a, b) => { const sa = JSON.stringify(a), sb = JSON.stringify(b); if (sa === sb) ok++; else { ko++; console.log(`❌ ${n} : ${sa} ≠ ${sb}`); } };
const { principal } = require('./poser-noms-fr-379');
const M = require('./collecte-cartes/plan-noms-fr-379');

(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'noms-fr-210-banc-'));
    const pages = path.join(tmp, 'pages'), sortie = path.join(tmp, 'sortie');
    fs.mkdirSync(pages);
    fs.writeFileSync(path.join(pages, M.fichierPage('Passerouge')), 'Passerouge — Poképédia\n\nNom anglais Fletchling\n', 'utf8');
    fs.writeFileSync(path.join(pages, M.fichierPage('Medhyena')), 'Medhyena — Poképédia\n\nNom anglais Poochyena\n', 'utf8');
    const lecteur = path.join(tmp, 'lecteur-faux.js');
    fs.writeFileSync(lecteur, `module.exports = { CLONE: 'faux', lireClone: () => ({
        sets: [{ famille: 'data', id: 'ex13', noms: { en: 'Holon Phantoms' }, cardmarket: 1551 }, { famille: 'data', id: 'sv9', noms: { en: 'Autre' }, cardmarket: 9 }],
        cartes: [
            { famille: 'data', setId: 'ex13', localId: '80', noms: { en: 'Poochyena', fr: 'Medhyena' }, dex: [], cardmarket: [] },
            { famille: 'data', setId: 'sv9', localId: '1', noms: { en: 'Fletchling', fr: 'Passerouge' }, dex: [], cardmarket: [] },
        ] }) };`, 'utf8');
    const base = [`--lecteur-clone=${lecteur}`, `--pages=${pages}`, `--sortie=${sortie}`];
    // 10 : Poochyena, id absent du clone, cle B ; 11 : un autre Fletchling sans ligne (espece) ; 12 : un Dresseur
    const docs = [{ _id: 10, nomEn: 'Poochyena', categorie: 'pokemon', impressions: [] }, { _id: 11, nomEn: 'Fletchling', categorie: 'pokemon', impressions: [] }, { _id: 12, nomEn: 'Potion', categorie: 'dresseur', impressions: [] }];
    const lignes = [{ carteId: 10, idProduct: 5001, idExpansion: 1551, numeroFiche: '80' }, { carteId: 12, idProduct: 5002 }];
    const projections = [];
    const ouvrirLecture = async () => ({
        cartes: { collection: nom => ({ find: (_f, o) => { projections.push([nom, Object.keys((o && o.projection) || {}).sort()]); return { toArray: async () => nom === 'cartes' ? docs : lignes }; } }) },
        fermer: async () => {},
    });
    const faux = (o = {}) => {
        const j = { ouvertures: 0, ecritures: [], fermetures: 0, logs: [], errs: [] };
        j.deps = {
            env: o.env || { LOT_ADDITIF_PID: '1' }, ouvrirLecture, log: m => j.logs.push(m), err: (...m) => j.errs.push(m.join(' ')),
            ouvrirConnexions: async opts => {
                j.ouvertures++; j.opts = opts;
                const b = { collection: () => ({ bulkWrite: async ops => { j.ecritures.push(ops); return { modifiedCount: ops.length }; } }) };
                return { cartes: { db: b }, prod: null, fermer: async () => { j.fermetures++; } };
            },
        };
        return j;
    };

    let j = faux();
    egal('A1 niveau inconnu : code 2, aucune connexion', [await principal([...base, '--niveaux=bidule'], j.deps), j.ouvertures], [2, 0]);
    j = faux();
    egal('A2 sans --niveaux, comportement du lot 379 : rien de nomme (ni lien par cle, ni espece)', [await principal(base, j.deps), j.ouvertures], [0, 0]);
    egal('A2b ... plan vide', JSON.parse(fs.readFileSync(path.join(sortie, 'PLAN-379.json'), 'utf8')).nommer.length, 0);

    j = faux();
    egal('M1 mesure avec les deux niveaux : code 0, aucune connexion d\'ecriture', [await principal([...base, '--niveaux=cles,espece'], j.deps), j.ouvertures], [0, 0]);
    const plan = JSON.parse(fs.readFileSync(path.join(sortie, 'PLAN-379.json'), 'utf8'));
    egal('M2 le plan nomme 10 (cles:B) et 11 (espece), pas le Dresseur', plan.nommer.map(d => [d.carteId, d.nomFr, d.lien]), [[10, 'Medhyena', 'cles:B'], [11, 'Passerouge', 'espece']]);
    egal('M3 la lecture projette categorie, impressions et slugSet (sinon les niveaux ne voient rien)',
        [projections.find(p => p[0] === 'cartes')[1].includes('categorie'), projections.find(p => p[0] === 'cartes')[1].includes('impressions'), projections.find(p => p[0] === 'cartes_produits')[1].includes('slugSet')], [true, true, true]);

    j = faux();
    egal('E1 ecriture : code 0', await principal([...base, '--niveaux=cles,espece', '--ecrire', '--attendu=2'], j.deps), 0);
    egal('E2 les $set portent nomFrLien', j.ecritures.map(o => o.map(x => [x.updateOne.filter, Object.keys(x.updateOne.update.$set), x.updateOne.update.$set.nomFrLien])),
        [[[{ _id: 10, nomFr: { $exists: false } }, ['nomFr', 'nomFrSource', 'nomFrLe', 'nomFrLien'], 'cles:B'], [{ _id: 11, nomFr: { $exists: false } }, ['nomFr', 'nomFrSource', 'nomFrLe', 'nomFrLien'], 'espece']]]);
    egal('E3 connexion fermee, hors production', [j.fermetures, j.opts], [1, { production: false }]);
    j = faux();
    egal('E4 compte different : code 3, rien d\'ecrit', [await principal([...base, '--niveaux=cles,espece', '--ecrire', '--attendu=3'], j.deps), j.ouvertures], [3, 0]);
    j = faux();
    egal('E5 --niveaux=cles seul : le compte attendu suit les niveaux (1), 2 refuse', [await principal([...base, '--niveaux=cles', '--ecrire', '--attendu=2'], j.deps), await principal([...base, '--niveaux=cles', '--ecrire', '--attendu=1'], faux().deps)], [3, 0]);

    console.log(`${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
