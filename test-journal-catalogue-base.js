// node test-journal-catalogue-base.js — banc : `apprendre-journal.js --catalogue=base` (tour 1, constat 3).
// CE QUE LE CHEMIN GARANTIT (et rien de plus) : en simulation il ne fait que des LECTURES (find / countDocuments / findOne) sur des
// collections de production, il n'ouvre ni mongoose ni mongo-connexion (les seuls chemins d'écriture du script), et `--catalogue=base`
// REFUSE `--ecrire` avant toute connexion. `lectureSeule: true` ne rend PAS la connexion non écrivante (il saute la garde de taille Atlas) :
// la garantie vient du refus de --ecrire et de ce banc, qui espionne chaque appel de collection.
// Sans base, sans réseau : le script tourne en ENFANT avec garde.js, dotenv, mongoose et mongo-connexion remplacés par des espions.
const fs = require('fs'), os = require('os'), path = require('path');

if (process.env.BANC_ENFANT === '1') {
    // ── MODE ENFANT : préchargé par `node -r`, installe les espions puis laisse apprendre-journal.js tourner
    const Module = require('module');
    const log = { optionsConnexion: null, connexionsOuvertes: 0, lectures: {}, ecritures: [], requis: [] };
    const LECTURES = new Set(['find', 'countDocuments', 'findOne', 'distinct']);
    const DONNEES = JSON.parse(fs.readFileSync(process.env.BANC_DONNEES, 'utf8'));
    const collection = nom => new Proxy({ collectionName: nom }, {
        get: (cible, prop) => {
            if (prop === 'collectionName') return nom;
            if (typeof prop === 'symbol' || prop === 'then') return undefined;
            if (!LECTURES.has(prop)) { log.ecritures.push(`${nom}.${prop}`); return () => { throw new Error(`écriture interdite : ${nom}.${prop}`); }; }
            log.lectures[`${nom}.${prop}`] = (log.lectures[`${nom}.${prop}`] || 0) + 1;
            if (prop === 'find') return () => ({ toArray: async () => DONNEES[nom] || [] });
            if (prop === 'countDocuments') return async () => (DONNEES[nom] || []).length;
            if (prop === 'findOne') return async () => (DONNEES[nom] || [])[0] || null;
            return async () => [];
        }
    });
    const faux = {
        './collecte-cartes/garde': { ouvrirConnexions: async options => { log.optionsConnexion = options; log.connexionsOuvertes++; return { prod: { db: { collection } }, fermer: async () => {} }; } },
        dotenv: { config: () => ({}) }
    };
    const charger = Module._load;
    Module._load = function (request, parent, ...reste) {
        if (request in faux) return faux[request];
        if (request === 'mongoose' || request === './mongo-connexion') { log.requis.push(request); throw new Error(`chemin d'écriture interdit en simulation : require(${request})`); }
        return charger.call(this, request, parent, ...reste);
    };
    process.on('exit', () => fs.writeFileSync(process.env.BANC_LOG, JSON.stringify(log)));
    return;
}

// ── MODE BANC
const { spawnSync } = require('child_process');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'banc-journal-base-'));
const SS = 'Dragon-Light-Rising';
const journal = { journal: [{ url: '/en/Pokemon/Products/Singles?idCategory=51&idExpansion=6704', detailSansImage: [
    { href: `/en/Pokemon/Products/Singles/${SS}/Pidgey-DLR1`, titre: 'Roucool (DLR 1)' }, { href: `/en/Pokemon/Products/Singles/${SS}/Rattata-DLR2`, titre: 'Rattata (DLR 2)' }] }] };
const donnees = {
    numeros_cartes: [{ idProduct: 1, idExpansion: 1, slug: 'Autre-X1', slugSet: 'Autre-Set', numero: '1', source: 'cardmarket', codeSet: 'X' }],
    catalogue_produits: [{ idProduct: 1, name: 'Autre', idExpansion: 1 }, { idProduct: 11, name: 'Pidgey', idExpansion: 6704 }, { idProduct: 12, name: 'Rattata', idExpansion: 6704 }]
};
const fJournal = path.join(dossier, 'journal.json'), fDonnees = path.join(dossier, 'donnees.json');
fs.writeFileSync(fJournal, JSON.stringify(journal)); fs.writeFileSync(fDonnees, JSON.stringify(donnees));
const lancer = args => {
    const fLog = path.join(dossier, `log-${Math.random().toString(36).slice(2)}.json`);
    const r = spawnSync(process.execPath, ['-r', __filename, path.join(__dirname, 'apprendre-journal.js'), `--journal=${fJournal}`, ...args], { cwd: __dirname, encoding: 'utf8', env: { ...process.env, BANC_ENFANT: '1', BANC_DONNEES: fDonnees, BANC_LOG: fLog } });
    return { code: r.status, out: r.stdout, err: r.stderr, log: fs.existsSync(fLog) ? JSON.parse(fs.readFileSync(fLog, 'utf8')) : null };
};

// A. la simulation : des lectures, rien d'autre
const A = lancer(['--catalogue=base']);
verifier('A. simulation --catalogue=base : sortie 0', A.code, 0);
verifier('A1. …2 déductions annoncées (cas 6704)', /À APPRENDRE : 2 /.test(A.out), true);
verifier('A2. …aucune écriture appelée sur aucune collection', A.log?.ecritures, []);
verifier('A3. …ni mongoose ni mongo-connexion chargés (les seuls chemins d\'écriture du script)', A.log?.requis, []);
verifier('A4. …les deux collections ont bien été LUES (find)', [A.log?.lectures['numeros_cartes.find'] > 0, A.log?.lectures['catalogue_produits.find'] > 0], [true, true]);
verifier('A5. …une seule connexion de production, ouverte avec lectureSeule: true', [A.log?.connexionsOuvertes, A.log?.optionsConnexion?.production, A.log?.optionsConnexion?.lectureSeule], [1, true, true]);

// B. --catalogue=base refuse --ecrire, AVANT toute connexion
const B = lancer(['--catalogue=base', '--base=test', '--attendu=2', '--ecrire']);
verifier('B. --catalogue=base --ecrire : refusé (sortie 2)', B.code, 2);
verifier('B1. …aucune connexion ouverte, aucun chemin d\'écriture chargé', [B.log?.connexionsOuvertes, B.log?.requis, B.log?.ecritures], [0, [], []]);
verifier('B2. …le message dit pourquoi', /--catalogue=base.*--ecrire|--ecrire.*--catalogue=base/.test(B.err), true);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
