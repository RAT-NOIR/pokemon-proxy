// node test-publication-sans-trou.js — « un set ne se publie JAMAIS à moitié créé » (EX-TRAINER-KIT-2, 2026-10-08), SUR LA BASE EN MÉMOIRE (base-banc.js).
// Deux moitiés :
//   A. LE CONTRÔLE (collecte-cartes/controle-publication.js, la fonction que lit aussi controler-publication.js sur la vraie base) dit NON sur des
//      états FABRIQUÉS — set publié + fiche sans nom, set sans nom avec cartes, ligne vers une carte sans nom / absente — et OUI sur un état sain ;
//      et il LÈVE (ne conclut pas) quand il ne lit rien ou quand le site a changé la forme de ses prédicats.
//   B. LA NAISSANCE (collecte-cartes/set-nomme.js) : un set neuf naît nommé par la règle de nom-affichage.js, ou il ne naît pas et l'outil le dit ;
//      aucun créateur de set ne contourne `insererSetNeuf`.
// Lancer : MONGOMS_DOWNLOAD_DIR=<dépôt principal>/.banc-local/cache-mongod node test-publication-sans-trou.js
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const { ouvrirBanc } = require('./collecte-cartes/base-banc');
const P = require('./collecte-cartes/controle-publication');
const N = require('./collecte-cartes/set-nomme');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const leve = async (nom, f, motif) => {
    try { await f(); ko++; console.log(`❌ ${nom} : aurait dû LEVER`); }
    catch (e) { if (motif.test(e.message)) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom} : a levé autre chose : ${e.message.slice(0, 160)}`); } }
};

// (fragments recollés : ce fichier est lui-même balayé et prouvé — ses textes fabriqués ne doivent pas ressembler à une connexion réelle)
const frag = (...p) => p.join('');
const carte = (id, nomEn, sets) => ({ _id: id, nomEn, sets });
const ligne = (carteId, idProduct, slugSet) => ({ _id: `${carteId}|${idProduct}`, carteId, idProduct, slugSet });

async function remplir(db, { sets, cartes, lignes }) {
    for (const c of ['sets', 'cartes', 'cartes_produits']) await db.collection(c).deleteMany({});
    if (sets.length) await db.collection('sets').insertMany(sets);
    if (cartes.length) await db.collection('cartes').insertMany(cartes);
    if (lignes.length) await db.collection('cartes_produits').insertMany(lignes);
}
const SAIN = () => ({
    sets: [{ _id: 'Set-A', nomAffichage: 'Set A' }, { _id: 'Set-B', nomAffichage: 'Set B' }, { _id: 'Set-Vide' }],   // Set-Vide : sans nom ET sans carte — rien à publier, pas un trou
    cartes: [carte(1, 'Alpha', ['Set-A']), carte(2, 'Bravo', ['Set-A', 'Set-B']), carte(3, 'Charlie', ['Set-B'])],
    lignes: [ligne(1, 101, 'Set-A'), ligne(2, 102, 'Set-A'), ligne(2, 103, 'Set-B'), ligne(3, 104, 'Set-B')]
});

async function main() {
    const banc = await ouvrirBanc(); banc.appliquer();
    const cx = await mongoose.createConnection(banc.uri, { dbName: 'banc_publication' }).asPromise();
    try {
        const db = cx.db;
        const site = await P.chargerSite();
        verifier('le site : un set est publié par une chaîne nomAffichage (prédicat lu en texte, forme vérifiée)', site.filtreSet, { nomAffichage: { $type: 'string' } });
        verifier('le site : une fiche affichable a un nomEn chaîne non vide (prédicat IMPORTÉ de entreesDuSet.ts)', site.filtreCarte, { nomEn: { $type: 'string', $ne: '' } });

        // ── A. LE CONTRÔLE
        await remplir(db, SAIN());
        const sain = await P.controlerPublication(db, site);
        verifier('état sain → OK', [sain.ok, sain.fichesSansNom, sain.lignesSansFiche, sain.setsSansNomAvecCartes], [true, [], [], []]);
        verifier('état sain → dénominateurs imprimés (3 sets, 2 publiés, 4 fiches, 4 lignes)', [sain.denominateurs.sets, sain.denominateurs.setsPublies, sain.denominateurs.fichesDansSetsPublies, sain.denominateurs.lignesDansSetsPublies], [3, 2, 4, 4]);

        let e = SAIN(); e.cartes.push(carte(4, '', ['Set-A'])); e.lignes.push(ligne(4, 105, 'Set-A'));
        await remplir(db, e);
        let r = await P.controlerPublication(db, site);
        verifier('set NOMMÉ + fiche au nomEn vide → NON, la fiche est nommée', [r.ok, r.fichesSansNom, r.lignesSansFiche.map(l => [l.set, l.carteId, l.raison])], [false, [{ set: 'Set-A', carteId: 4 }], [['Set-A', 4, 'carte sans nom']]]);

        e = SAIN(); e.cartes.push({ _id: 5, sets: ['Set-B'] });   // nomEn ABSENT
        await remplir(db, e);
        r = await P.controlerPublication(db, site);
        verifier('set nommé + fiche au nomEn ABSENT → NON', [r.ok, r.fichesSansNom], [false, [{ set: 'Set-B', carteId: 5 }]]);

        e = SAIN(); e.cartes.push(carte(6, null, ['Set-A']));   // nomEn null
        await remplir(db, e);
        r = await P.controlerPublication(db, site);
        verifier('set nommé + fiche au nomEn null → NON', [r.ok, r.fichesSansNom], [false, [{ set: 'Set-A', carteId: 6 }]]);

        e = SAIN(); e.sets.push({ _id: 'EX-Trainer-Kit-2' }); e.cartes.push(carte(7, 'Plusle', ['EX-Trainer-Kit-2'])); e.lignes.push(ligne(7, 201, 'EX-Trainer-Kit-2'));
        await remplir(db, e);
        r = await P.controlerPublication(db, site);
        verifier('SET SANS NOM qui porte une carte et une ligne (le cas TK2) → NON, listé avec ses comptes', [r.ok, r.setsSansNomAvecCartes], [false, [{ set: 'EX-Trainer-Kit-2', cartes: 1, lignes: 1 }]]);

        e = SAIN(); e.sets.push({ _id: 'Set-Nom-Vide', nomAffichage: null }); e.cartes.push(carte(8, 'Delta', ['Set-Nom-Vide']));
        await remplir(db, e);
        r = await P.controlerPublication(db, site);
        verifier('nomAffichage null n\'est pas un nom (le site ne publie que les chaînes) → NON', [r.ok, r.setsSansNomAvecCartes.map(x => x.set)], [false, ['Set-Nom-Vide']]);

        e = SAIN(); e.lignes.push(ligne(999, 301, 'Set-B'));   // la carte 999 n'existe pas
        await remplir(db, e);
        r = await P.controlerPublication(db, site);
        verifier('ligne d\'un set publié vers une carte ABSENTE → NON', [r.ok, r.lignesSansFiche.map(l => [l.carteId, l.raison])], [false, [[999, 'carte absente']]]);

        e = SAIN(); e.cartes.push(carte(9, '', ['Set-Vide']));   // une fiche sans nom dans un set sans nom : le set sans nom est le trou, nommé
        await remplir(db, e);
        r = await P.controlerPublication(db, site);
        verifier('set sans nom avec une carte (même sans nom) → NON par le set', [r.ok, r.setsSansNomAvecCartes.map(x => x.set)], [false, ['Set-Vide']]);

        await remplir(db, { sets: [], cartes: [], lignes: [] });
        await leve('base vide → LÈVE (jamais « 0 problème » sur 0 set)', () => P.controlerPublication(db, site), /aucun set lu/);
        await remplir(db, { sets: [{ _id: 'X' }], cartes: [carte(1, 'A', ['X'])], lignes: [] });
        await leve('des sets mais aucun publié → LÈVE (un prédicat qui ne mord sur rien ne conclut pas)', () => P.controlerPublication(db, site), /AUCUN publié/);
        await remplir(db, { sets: [{ _id: 'X', nomAffichage: 'X' }], cartes: [], lignes: [] });
        await leve('un set publié mais aucune fiche → LÈVE', () => P.controlerPublication(db, site), /aucune fiche affichable/);

        // le site change ses prédicats : le contrôle ne devine pas
        const faux = fs.mkdtempSync(path.join(os.tmpdir(), 'site-faux-'));
        for (const f of fs.readdirSync(P.SITE_LIB, { withFileTypes: true })) if (f.isFile() && !f.name.endsWith('.test.ts') && f.name !== 'cartes.ts') fs.copyFileSync(path.join(P.SITE_LIB, f.name), path.join(faux, f.name));
        const cartesTs = fs.readFileSync(path.join(P.SITE_LIB, 'cartes.ts'), 'utf8');
        fs.writeFileSync(path.join(faux, 'cartes.ts'), cartesTs.replace(/const FILTRE_SET_PUBLIABLE = [^;]*;/, 'const FILTRE_SET_PUBLIABLE = { nomAffichage: { $exists: true }, publie: true };'));
        await leve('le site change la forme de FILTRE_SET_PUBLIABLE → LÈVE', () => P.chargerSite(faux), /FILTRE_SET_PUBLIABLE absent ou changé/);
        fs.writeFileSync(path.join(faux, 'cartes.ts'), cartesTs.replace(/const FILTRE_SET_PUBLIABLE = [^;]*;/, ''));
        await leve('le site retire FILTRE_SET_PUBLIABLE → LÈVE', () => P.chargerSite(faux), /FILTRE_SET_PUBLIABLE absent ou changé/);
        fs.rmSync(faux, { recursive: true, force: true });

        // ── B. LA NAISSANCE
        const existants = [{ _id: 'Set-A', nomAffichage: 'Set A', region: 'intl', code: 'A' }, { _id: 'EX-Trainer-Kit', nomAffichage: 'EX Trainer Kit', region: 'intl', code: 'TK1' }];
        const tk2 = { _id: 'EX-Trainer-Kit-2', code: 'TK2', idExpansion: [1627], nomEn: null, nomJa: null, nomJaTraduit: null, region: 'intl', tirage: 'intl' };
        const slugMaj = new Map([[1627, 'EX-Trainer-Kit-2']]);
        const noms = N.nommerPur({ neufs: [tk2], existants, slugMajoritaire: slugMaj, parSlug: new Map() });
        verifier('naissance : TK2 prend le nom Cardmarket de son expansion (règle de nom-affichage.js, occidental)', [noms.refuses, noms.noms.get('EX-Trainer-Kit-2')?.nomAffichage, noms.noms.get('EX-Trainer-Kit-2')?.nomAffichageSource], [[], 'EX Trainer Kit 2', 'cardmarket']);
        verifier('naissance : les champs écrits sont ceux de rapatrier-noms-sets.js', Object.keys(noms.noms.get('EX-Trainer-Kit-2')).sort(), ['nomAffichage', 'nomAffichagePreuve', 'nomAffichageSource', 'nomCardmarket', 'nomsLe']);
        const pris = N.nommerPur({ neufs: [tk2], existants: [...existants, { _id: 'Autre', nomAffichage: 'EX trainer kit 2', region: 'intl' }], slugMajoritaire: slugMaj, parSlug: new Map() });
        verifier('naissance : un nom déjà porté à l\'écran (casse, ponctuation) est refusé s\'il n\'y a pas de départage — le set NE NAÎT PAS', [pris.noms.size, pris.refuses.map(x => x.s._id)], [0, ['EX-Trainer-Kit-2']]);
        const deux = N.nommerPur({ neufs: [tk2, { ...tk2, _id: 'EX-Trainer-Kit-2-Bis', code: 'TK2B' }], existants, slugMajoritaire: new Map([[1627, 'EX-Trainer-Kit-2']]), parSlug: new Map() });
        verifier('naissance : deux sets neufs au même nom ne le partagent pas — l\'un se départage par son slug, l\'autre NE NAÎT PAS (la règle de nom-affichage.js, inchangée)', [[...deux.noms.values()].map(c => c.nomAffichage), deux.refuses.map(x => x.s._id)], [['EX Trainer Kit 2 Bis'], ['EX-Trainer-Kit-2']]);
        verifier('naissance : un set neuf ne retient pas le nom d\'un set déjà existant sans nom (il ne nomme que les siens)', N.nommerPur({ neufs: [tk2], existants: [...existants, { _id: 'Ancien', region: 'intl' }], slugMajoritaire: slugMaj, parSlug: new Map() }).noms.has('Ancien'), false);

        // le chemin complet sur la base du banc : nommerLesNouveaux lit `sets` et `numeros_cartes`, insererSetNeuf écrit nom compris
        await remplir(db, { sets: existants, cartes: [], lignes: [] });
        await db.collection('numeros_cartes').deleteMany({});
        await db.collection('numeros_cartes').insertMany([{ _id: 1, idExpansion: 1627, slugSet: 'EX-Trainer-Kit-2' }, { _id: 2, idExpansion: 1627, slugSet: 'EX-Trainer-Kit-2' }]);
        const lu = await N.nommerLesNouveaux(db, db, [tk2]);
        const { _id, ...corps } = tk2;
        verifier('insererSetNeuf : le set naît NOMMÉ (relu en base)', [await N.insererSetNeuf(db.collection('sets'), tk2, lu), (await db.collection('sets').findOne({ _id })).nomAffichage], [1, 'EX Trainer Kit 2']);
        await leve('insererSetNeuf : sans les noms, il LÈVE — aucun set n\'est inséré sans nom', () => N.insererSetNeuf(db.collection('sets'), { ...tk2, _id: 'Set-Sans-Nom' }, { champsDe: new Map(), existants: new Set() }), /SET SANS NOM/);
        verifier('insererSetNeuf : rien n\'a été inséré par le refus', await db.collection('sets').countDocuments({ _id: 'Set-Sans-Nom' }), 0);
        verifier('un set déjà en base n\'est ni renommé ni refusé (additif)', [(await N.nommerLesNouveaux(db, db, [tk2])).existants.has('EX-Trainer-Kit-2'), (await N.nommerLesNouveaux(db, db, [tk2])).champsDe.size], [true, 0]);
        await leve('nommerLesNouveaux : un set sans aucun nom possible → LÈVE avant toute écriture', async () => {
            await db.collection('sets').insertOne({ _id: 'Occupe', nomAffichage: 'Pris', region: 'intl' });
            await N.nommerLesNouveaux(db, db, [{ _id: 'Pris', code: 'P', idExpansion: [], nomEn: 'Pris', region: 'intl', tirage: 'intl' }]);
        }, /SET SANS NOM REFUSÉ/);

        // ── B bis. aucun créateur ne contourne le point d'entrée : tout `sets` + `$setOnInsert` + upsert passe par insererSetNeuf
        // ── C. L'ÉCRITURE DU NOM (rapatrier-noms-sets.js) est alignée sur la définition du contrôle : « sans nom » = nomAffichage NON-CHAÎNE (absent OU null),
        //      et un nom posé n'est jamais réécrit (§57).
        const ND = require('./collecte-cartes/nom-affichage');
        await remplir(db, { sets: [{ _id: 'Absent' }, { _id: 'Nul', nomAffichage: null }, { _id: 'Pose', nomAffichage: 'Déjà posé' }, { _id: 'Vide', nomAffichage: '' }], cartes: [], lignes: [] });
        const propose = id => ({ s: { _id: id }, a: { nom: `Nom ${id}`, source: 'cardmarket' }, preuve: 'p', nomCardmarket: `Nom ${id}` });
        const refuse = id => ({ s: { _id: id }, raison: 'collision' });
        const ecrits = await ND.ecrireNoms(db.collection('sets'), { proposes: ['Absent', 'Nul', 'Pose', 'Vide'].map(propose), refuses: [] });
        const lus = Object.fromEntries((await db.collection('sets').find({}).toArray()).map(s => [s._id, s.nomAffichage]));
        verifier('écriture du nom : un set à nomAffichage ABSENT est nommé', lus.Absent, 'Nom Absent');
        verifier('écriture du nom : un set à nomAffichage NULL est nommé (le contrôle le compte non publié)', lus.Nul, 'Nom Nul');
        verifier('écriture du nom : une chaîne posée (même vide : c\'est une chaîne pour le site) n\'est JAMAIS réécrite', [lus.Pose, lus.Vide], ['Déjà posé', '']);
        verifier('écriture du nom : compte des sets nommés par l\'écriture', ecrits, 2);
        await ND.ecrireNoms(db.collection('sets'), { proposes: [], refuses: [refuse('Nul')] });
        verifier('écriture du nom : un refus ne pose que nomAffichageRefus', [(await db.collection('sets').findOne({ _id: 'Nul' })).nomAffichage, (await db.collection('sets').findOne({ _id: 'Nul' })).nomAffichageRefus.raison], ['Nom Nul', 'collision']);
        verifier('rapatrier-noms-sets.js écrit par ecrireNoms (pas par un updateOne à lui)', /ecrireNoms\(/.test(fs.readFileSync(path.join(__dirname, 'rapatrier-noms-sets.js'), 'utf8')) && !/nomAffichage: \{ \$exists: false \}/.test(fs.readFileSync(path.join(__dirname, 'rapatrier-noms-sets.js'), 'utf8')), true);

        // Le balayage (collecte-cartes/ecritures-de-sets.js) : TOUS les .js/.mjs de la racine et de collecte-cartes/ ; une écriture de `sets` capable d'insérer
        // passe par le point d'entrée ou figure dans une liste FERMÉE et prouvée (copieurs, bancs) ; tout le reste fait échouer.
        const E = require('./collecte-cartes/ecritures-de-sets');
        const b = E.balayer(__dirname);
        verifier(`balayage : aucun fichier n'écrit un set capable d'insérer hors du point d'entrée et des listes fermées (${b.balayes} fichiers balayés)`, b.fautifs, []);
        verifier('balayage : les listes fermées sont vraies (chaque fichier listé existe ET écrit encore un set)', b.listeObsolete, []);
        verifier('balayage : la liste fermée des copieurs est exactement renommer-set.js et reparer-identite-nulle.js', b.copieurs.sort(), ['renommer-set.js', 'reparer-identite-nulle.js']);
        verifier('balayage : les cinq créateurs appellent le point d\'entrée', ['poser-par-metacarte.js', 'creer-sets-par-pages-de-cartes.js', 'creer-sets-sans-page.js', 'creer-sets-reimpressions.js', 'collecteur-texte.js'].filter(f => E.POINTS_D_ENTREE.test(fs.readFileSync(path.join(__dirname, f), 'utf8'))).length, 5);
        // le balayage dit NON sur des états fabriqués : copieurs non listés, fichier de liste disparu, écritures de toutes formes
        const sansListe = E.balayer(__dirname, { copieurs: {}, bancs: E.BANCS });
        verifier('balayage : sans la liste fermée, les deux copieurs sont des fautifs (renommer-set, reparer-identite-nulle)', sansListe.fautifs.map(x => x.split(' ')[0]).sort(), ['renommer-set.js', 'reparer-identite-nulle.js']);
        const { 'test-historique-valeur.js': _h, ...bancsSansHisto } = E.BANCS;
        verifier('balayage : un banc d\'une autre branche non listé (test-historique-valeur.js) est un fautif', E.balayer(__dirname, { bancs: bancsSansHisto }).fautifs.map(x => x.split(' ')[0]), ['test-historique-valeur.js']);
        verifier('balayage : les bancs listés sont exactement ceux qu\'on a prouvés', Object.keys(E.BANCS).sort(), ['test-collecter-logos-officiels.js', 'test-historique-valeur.js', 'test-lot-garde-scratch.js', 'test-publication-sans-trou.js', 'test-regle-r-fiches.js']);
        // la preuve d'isolation d'un banc listé : harnais en mémoire OBLIGATOIRE, aucune connexion ailleurs
        const OK = "const { ouvrirBanc } = require('./collecte-cartes/base-banc'); const banc = await ouvrirBanc(); mongoose.createConnection(banc.uri, { dbName: 'x' });";
        verifier('preuve de banc : harnais en mémoire + createConnection(banc.uri) → prouvé', E.preuveDeBanc(OK), []);
        verifier('preuve de banc : process.env.MONGODB_URI accepté SEULEMENT après appliquer()', [E.preuveDeBanc(OK.replace('banc.uri', 'process.env.MONGODB_URI')).length, E.preuveDeBanc(OK.replace('banc.uri', 'process.env.MONGODB_URI') + ' banc.appliquer();').length], [1, 0]);
        verifier('preuve de banc : sans ouvrirBanc → non prouvé', E.preuveDeBanc("mongoose.createConnection(banc.uri, {});").length, 1);
        verifier('preuve de banc : une connexion vers une autre cible → non prouvée', E.preuveDeBanc(OK + frag(' mongoose.create', 'Connection(uriDeProd, {});')).length, 1);
        verifier('preuve de banc : un client Mongo ouvert à la main ou une connexion mongoose par défaut → non prouvé', [E.preuveDeBanc(OK + frag(' new Mongo', 'Client(x);')).length, E.preuveDeBanc(OK + frag(' mongoose.con', 'nect(x);')).length], [1, 1]);
        const bancFaux = E.balayer(__dirname, { bancs: { ...E.BANCS, 'test-publication-sans-trou.js': 'x' }, lire: f => /test-publication-sans-trou\.js$/.test(f) ? frag("db.collection('sets').insertMany([]); mongoose.create", 'Connection(process.env.PROD, {});') : fs.readFileSync(f, 'utf8') });
        verifier('balayage : un banc listé sans preuve d\'isolation fait échouer', bancFaux.listeObsolete.some(x => /test-publication-sans-trou\.js : banc sans preuve d'isolation/.test(x)), true);
        const avecFantome = E.balayer(__dirname, { copieurs: { ...E.COPIEURS_PROUVES, 'fantome.js': 'n\'existe pas' }, bancs: E.BANCS });
        verifier('balayage : un fichier de la liste fermée qui n\'existe plus fait échouer', avecFantome.listeObsolete, ['fantome.js : le fichier n\'existe plus']);
        const avecPerime = E.balayer(__dirname, { copieurs: { ...E.COPIEURS_PROUVES, 'poser-par-metacarte.js': 'x' }, bancs: E.BANCS });
        verifier('balayage : un fichier listé qui n\'écrit plus de set (poser-par-metacarte passe par le point d\'entrée) fait échouer', avecPerime.listeObsolete.map(x => x.split(' ')[0]), ['poser-par-metacarte.js']);
        const formes = {
            'S.bulkWrite': "const S = cx.db.collection('sets'); await S.bulkWrite([{ updateOne: {} }]);",
            'insertOne': "await cx.db.collection('sets').insertOne({ _id: 'X' });",
            'insertMany': "await db.collection(\"sets\").insertMany(docs);",
            'M.Set.create': "await M.Set.create({ _id: 'X' });",
            'upsert (appel long, parenthèses et gabarits)': "await cx.db.collection('sets').updateOne({ _id: f(x.slug) }, { $set: { a: `texte (avec parenthèses) ${g(1)}` } }, { upsert: true });",
            '$setOnInsert': "await M.Set.updateOne({ _id: slug }, { $setOnInsert: { version: 1 } });",
            'alias au nom libre': "const lesSets = db.collection('sets'); await lesSets.insertOne(d);"
        };
        for (const [nom, texte] of Object.entries(formes)) verifier(`détecteur : voit « ${nom} »`, E.ecrituresDInsertion(texte).length, 1);
        verifier('détecteur : ne voit PAS un update sans upsert ni $setOnInsert (un $set seul n\'insère rien)', E.ecrituresDInsertion("await cx.db.collection('sets').updateOne({ _id: 'X' }, { $set: { logo: 1 } });").length, 0);
        verifier('détecteur : ne voit pas une écriture sur une autre collection', E.ecrituresDInsertion("await cx.db.collection('cartes').insertOne({ _id: 1 }); await cx.db.collection('restes').updateOne({}, {}, { upsert: true });").length, 0);
    } finally { await cx.close(); await banc.arreter(); }
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
