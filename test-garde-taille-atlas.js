// node test-garde-taille-atlas.js — GARDE-ATLAS : à 90 % de 512 Mo, toute écriture non essentielle s'arrête ; les imports Cardmarket passent toujours.
// Faux `dbStats` / `listDatabases` : AUCUNE base, AUCUNE grappe. GARDE_ATLAS_MODULE sert au banc de mutants (test-mutants-garde-atlas.js).
'use strict';
const fs = require('fs');
const path = require('path');
const M = require(process.env.GARDE_ATLAS_MODULE || './collecte-cartes/garde-taille-atlas');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const MO = 1048576;

// un faux client Mongo : bases = { nom: { data, index, stockage } } en Mo
function faux(bases, { refuseListe = false, refuseStats = false } = {}) {
    return {
        db: nom => ({
            admin: () => ({ listDatabases: async () => { if (refuseListe) throw new Error('not authorized on admin to execute command { listDatabases: 1 }'); return { databases: [{ name: 'admin' }, { name: 'local' }, { name: 'config' }, ...Object.keys(bases).map(name => ({ name }))] }; } }),
            command: async () => {
                if (refuseStats) throw new Error('not authorized');
                const b = bases[nom];
                if (!b) return { ok: 1, dataSize: 9999 * MO, indexSize: 9999 * MO, storageSize: 9999 * MO };   // admin/local/config : s'ils étaient comptés, tout exploserait
                return { ok: 1, dataSize: b.data * MO, indexSize: b.index * MO, storageSize: (b.stockage ?? b.data) * MO };
            }
        })
    };
}
// une grappe à p % de 512 Mo, en deux bases
const grappeA = p => faux({ test: { data: p * 5.12 * 0.9, index: p * 5.12 * 0.1 }, test_scratch: { data: 0, index: 0 } });

(async () => {
    // seuils nommés
    verifier('seuils nommés', [M.ALERTE, M.REFUS, M.LIMITE_MO], [80, 90, 512]);

    // la référence du coordinateur : 415,2 + 21,0 = 436,2 Mo -> 85,2 %
    let m = await M.mesurerGrappe(faux({ test: { data: 415.2, index: 21.0, stockage: 423.6 }, test_scratch: { data: 0, index: 0, stockage: 0 } }));
    verifier('mesure de référence : la garde retient données+index 436,2 Mo = 85,2 % ; le stockage+index (444,6) n\'est qu\'affiché', [Math.round(m.mo * 10) / 10, Math.round(m.pourcent * 10) / 10, Math.round(m.detail.stockageIndexMo * 10) / 10], [436.2, 85.2, 444.6]);
    // I2 : le REFUS se décide sur données+index (ce qu'Atlas compte) ; le stockage ne baisse qu'au compactage
    m = await M.mesurerGrappe(faux({ test: { data: 400, index: 20, stockage: 450 } }));
    verifier('I2 : données+index (420) décide, stockage+index (470) seulement affiché', [Math.round(m.mo), Math.round(m.detail.stockageIndexMo)], [420, 470]);
    const jStock = M.juger({ mesure: await M.mesurerGrappe(faux({ test: { data: 400, index: 20, stockage: 500 } })) });
    verifier('I2 : stockage+index à 101 % mais données+index à 82 % : pas de refus', jStock.autorise, true);
    // admin/local/config ne comptent pas (le faux leur donne 9999 Mo)
    m = await M.mesurerGrappe(faux({ test: { data: 100, index: 0 } }));
    verifier('admin, local et config ne sont pas comptés', Math.round(m.mo), 100);

    // 1. 89 % passe, 90 % refuse
    let j = M.juger({ mesure: await M.mesurerGrappe(grappeA(89)) });
    verifier('89 % : passe', j.autorise, true);
    j = M.juger({ mesure: await M.mesurerGrappe(grappeA(90)) });
    verifier('90 % : refuse', [j.autorise, j.niveau], [false, 'refus']);
    j = M.juger({ mesure: await M.mesurerGrappe(grappeA(81)) });
    verifier('81 % : passe avec alerte', [j.autorise, j.niveau], [true, 'alerte']);

    // 2. une estimation qui franchit 90 % refuse
    j = M.juger({ mesure: await M.mesurerGrappe(grappeA(85)), estimationMo: 30 });   // 435,2 + 30 = 465,2 = 90,9 %
    verifier('85 % + 30 Mo (90,9 %) : refuse', [j.autorise, j.niveau], [false, 'refus']);
    j = M.juger({ mesure: await M.mesurerGrappe(grappeA(85)), estimationMo: 20 });   // 455,2 = 88,9 %
    verifier('85 % + 20 Mo (88,9 %) : passe', j.autorise, true);
    j = M.juger({ mesure: await M.mesurerGrappe(grappeA(50)), estimationMo: -5 });
    verifier('estimation négative : refusée (on ne sait pas)', j.autorise, false);
    j = M.juger({ mesure: await M.mesurerGrappe(grappeA(50)), estimationMo: NaN });
    verifier('estimation illisible : refusée', j.autorise, false);

    // 3. une mesure impossible refuse, et le dit
    let v = await M.verifierEcriture({ client: faux({ test: { data: 1, index: 1 } }, { refuseListe: true }) });
    verifier('listDatabases refusé : BLOQUE et le dit', [v.autorise, v.niveau, /mesurer/i.test(v.raison)], [false, 'inconnu', true]);
    v = await M.verifierEcriture({ client: faux({ test: { data: 1, index: 1 } }, { refuseStats: true }) });
    verifier('dbStats refusé : BLOQUE', [v.autorise, v.niveau], [false, 'inconnu']);
    v = await M.verifierEcriture({ client: faux({}) });
    verifier('aucune base mesurée : BLOQUE (un zéro fabriqué ne rassure pas)', v.autorise, false);
    v = await M.verifierEcriture({ client: null });
    verifier('pas de client : BLOQUE', v.autorise, false);
    v = await M.verifierEcriture({ client: grappeA(50) });
    verifier('grappe à 50 % : passe', v.autorise, true);

    // 4. un import Cardmarket passe à 95 % — drapeau explicite ET fichier de la liste fermée
    const fichierImport = path.join(__dirname, 'import-price-guide.js');
    v = await M.verifierEcriture({ client: grappeA(95), essentiel: 'import-cardmarket', fichier: fichierImport });
    verifier('import (import-price-guide.js, essentiel) à 95 % : PASSE', [v.autorise, v.niveau], [true, 'essentiel']);
    v = await M.verifierEcriture({ client: faux({}, { refuseListe: true }), essentiel: 'import-cardmarket', fichier: fichierImport });
    verifier('import : une mesure impossible ne le bloque pas', v.autorise, true);
    v = await M.verifierEcriture({ client: grappeA(95), essentiel: 'import-cardmarket', fichier: path.join(__dirname, 'collecteur-texte.js') });
    verifier('le drapeau depuis un fichier HORS liste fermée : refusé à 95 %', v.autorise, false);
    v = await M.verifierEcriture({ client: grappeA(95), essentiel: 'collecte', fichier: fichierImport });
    verifier('un autre drapeau que « import-cardmarket » : refusé à 95 %', v.autorise, false);
    v = await M.verifierEcriture({ client: grappeA(95), essentiel: true, fichier: fichierImport });
    verifier('essentiel: true (pas la valeur nommée) : refusé', v.autorise, false);
    v = await M.verifierEcriture({ client: grappeA(95), essentiel: 'import-cardmarket' });
    verifier('le drapeau sans fichier : refusé', v.autorise, false);

    // la liste fermée est RÉELLE : chaque fichier de la liste existe, et le littéral n'apparaît que dans eux (ou dans le module et ses bancs)
    verifier('liste fermée : 3 fichiers, tous présents', [M.FICHIERS_ESSENTIELS.length, M.FICHIERS_ESSENTIELS.every(f => fs.existsSync(path.join(__dirname, f)))], [3, true]);
    const porteurs = [];
    const parcourir = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) { if (!['node_modules', '.git', '.banc-local'].includes(e.name) && !e.name.startsWith('backup-')) parcourir(path.join(d, e.name)); continue; }
        if (!e.name.endsWith('.js') || /^test/.test(e.name) || e.name === 'garde-taille-atlas.js') continue;
        if (fs.readFileSync(path.join(d, e.name), 'utf8').includes("essentiel: 'import-cardmarket'")) porteurs.push(path.relative(__dirname, path.join(d, e.name)).split(path.sep).join('/'));
    } };
    parcourir(__dirname);
    verifier('le littéral essentiel: \'import-cardmarket\' n\'est écrit que dans la liste fermée', porteurs.sort(), [...M.FICHIERS_ESSENTIELS].sort());

    // 5. lot-additif imprime le pourcentage après écriture
    const l = M.ligneAtlasApres({ mo: 436.2, pourcent: 85.2 }, 'production');
    verifier('ligne « Atlas après »', l, 'Atlas après : 85,2 % (grappe production)');
    verifier('ligne « Atlas après » sans mesure', M.ligneAtlasApres(null, 'cartes'), 'Atlas après : mesure impossible (grappe cartes)');
    const src = fs.readFileSync(path.join(__dirname, 'lot-additif.js'), 'utf8');
    verifier('lot-additif.js : mesure AVANT la sauvegarde (verifierEcriture avant backup-collections)', src.indexOf('verifierEcriture') > 0 && src.indexOf('verifierEcriture') < src.indexOf("'backup-collections.js'"), true);
    verifier('lot-additif.js : --estimation-mo accepté', /--estimation-mo=/.test(src), true);
    verifier('lot-additif.js : imprime ligneAtlasApres et la met au journal', [/ligneAtlasApres\(/.test(src) && /console\.log\(`[^`]*\$\{atlasApres\}/.test(src), (src.match(/const combien = \[legacy, atlasApres,/g) || []).length], [true, 2]);
    const gc = fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'garde.js'), 'utf8');
    verifier('garde.js (ouvrirConnexions) : porte la garde', /verifierEcriture/.test(gc), true);
    const mc = fs.readFileSync(path.join(__dirname, 'mongo-connexion.js'), 'utf8');
    verifier('mongo-connexion.js (connecterMongo, ecrit) : porte la garde', /verifierEcriture/.test(mc), true);

    // ── CORRECTION 1
    // CORRECTION 2 : le chemin de dégagement est RETIRÉ. Au-dessus de 90 %, libérer de la place est une décision du testeur.
    const { spawnSync } = require('child_process');
    const r = spawnSync(process.execPath, ['lot-additif.js', '--quoi=x', '--collections=a', '--degagement', '--', 'node', '-v'], { cwd: __dirname, encoding: 'utf8', env: { ...process.env, MONGODB_URI: '', MONGODB_CARTES_URI: '' } });
    verifier('--degagement REFUSÉ par lot-additif (code 2, message du testeur), avant toute connexion', [r.status, /au-dessus de 90 %, libérer de la place est une décision du testeur ; outil dédié à venir/.test(r.stderr || '')], [2, true]);
    verifier('plus aucun code de dégagement (module, lot-additif)', [typeof M.validerDegagement, typeof M.autoriserDegagement, typeof M.degagementTenu, /autoriserDegagement|degagementTenu|MO_AVANT|compteur: 'atlas'/.test(src)], ['undefined', 'undefined', 'undefined', false]);
    verifier('le journal « Atlas après » est gardé', /ligneAtlasApres\(mesureApres/.test(src), true);
    // M-e : seuls les bancs test-*.js sont exclus du scan ; le champ fichier: est scanné
    const tmp2 = fs.mkdtempSync(path.join(require('os').tmpdir(), 'scan2-atlas-'));
    for (const [f, t] of [['testeur-x.js', "f({ essentiel: 'import-cardmarket' })"], ['test-banc.js', "f({ essentiel: 'import-cardmarket' })"], ['testing.js', 'f({ essentiel: ESSENTIEL })']]) fs.writeFileSync(path.join(tmp2, f), t);
    verifier('M-e : un fichier de production nommé test… est scanné ; test-*.js est exclu', M.porteursDuDrapeau(tmp2).sort(), ['testeur-x.js', 'testing.js']);
    fs.rmSync(tmp2, { recursive: true, force: true });
    verifier('M-e : fichier: désignant un fichier de la liste fermée est détecté', [M.contientDrapeauEssentiel("f({ fichier: path.join(__dirname, 'import-price-guide.js') })"), M.contientDrapeauEssentiel("f({ fichier : './imports-quotidiens-local.js' })"), M.contientDrapeauEssentiel('f({ fichier: __filename })')], [true, true, false]);

    // M1 : le scan attrape TOUTE forme de la valeur hors des fichiers admis
    const formes = { 'guillemets simples': "const x = { essentiel: 'import-cardmarket' };", 'guillemets doubles': 'const x = { essentiel: "import-cardmarket" };', 'gabarit': 'const x = { essentiel: `import-cardmarket` };',
        'espaces': "const x = { essentiel   :   'import-cardmarket' };", 'constante réexportée': 'const { ESSENTIEL } = require("./collecte-cartes/garde-taille-atlas"); f({ essentiel: ESSENTIEL })', 'accès T.ESSENTIEL': 'f({ essentiel: T.ESSENTIEL })' };
    for (const [nom, texte] of Object.entries(formes)) verifier(`M1 forme « ${nom} » : détectée`, M.contientDrapeauEssentiel(texte), true);
    verifier('M1 : un texte sans le drapeau n\'est pas détecté', M.contientDrapeauEssentiel("const imports = 'imports-cardmarket-ci.js'; // essentiel pour tous"), false);
    const os = require('os'); const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-atlas-'));
    fs.mkdirSync(path.join(tmp, 'sous'));
    for (const [f, t] of [['a.js', formes['gabarit']], ['b.mjs', formes['guillemets doubles']], ['c.cjs', formes['constante réexportée']], ['sous/d.js', formes['espaces']], ['propre.js', 'x'], ['test-z.js', formes['gabarit']]]) fs.writeFileSync(path.join(tmp, f), t);
    verifier('M1 : le scan voit .js, .mjs, .cjs et les sous-dossiers (les test-* exclus)', M.porteursDuDrapeau(tmp).sort(), ['a.js', 'b.mjs', 'c.cjs', 'sous/d.js']);
    fs.rmSync(tmp, { recursive: true, force: true });
    verifier('M1 : le dépôt réel : seuls les 3 fichiers admis', M.porteursDuDrapeau(__dirname).filter(f => !M.FICHIERS_ESSENTIELS.includes(f)), []);

    // M4 : cache de mesure 5 min par grappe ; la liste déjà lue est réutilisée
    let appels = 0;
    const compte = bases => { const c = faux(bases); const db0 = c.db; return { db: n => { const d = db0(n); const lister = d.admin; d.admin = () => { const a = lister(); const ld = a.listDatabases; a.listDatabases = async () => { appels++; return ld(); }; return a; }; return d; } }; };
    const horloge = { t: 1000000 };
    const cache = new Map();
    const opt = { cache, maintenant: () => horloge.t };
    await M.verifierEcriture({ client: compte({ test: { data: 100, index: 1 } }), grappe: 'g1', ...opt });
    horloge.t += 4 * 60000;
    const deux = await M.verifierEcriture({ client: compte({ test: { data: 100, index: 1 } }), grappe: 'g1', ...opt });
    verifier('M4 : deux ouvertures dans les 5 min = UNE mesure', [appels, deux.autorise], [1, true]);
    await M.verifierEcriture({ client: compte({ test: { data: 100, index: 1 } }), grappe: 'g2', ...opt });
    verifier('M4 : une autre grappe a sa propre mesure', appels, 2);
    horloge.t += 2 * 60000;
    await M.verifierEcriture({ client: compte({ test: { data: 100, index: 1 } }), grappe: 'g1', ...opt });
    verifier('M4 : après 5 min, on remesure', appels, 3);
    await M.verifierEcriture({ client: compte({ test: { data: 100, index: 1 } }), grappe: 'g1', sansCache: true, ...opt });
    verifier('M4 : sansCache (le lot) mesure toujours', appels, 4);
    const echec = faux({}, { refuseListe: true });
    await M.verifierEcriture({ client: echec, grappe: 'g3', ...opt });
    const encore = await M.verifierEcriture({ client: faux({ test: { data: 1, index: 1 } }), grappe: 'g3', ...opt });
    verifier('M4 : un échec de mesure n\'est jamais mis en cache', encore.autorise, true);
    appels = 0;
    await M.mesurerGrappe(compte({ test: { data: 100, index: 1 } }), { noms: ['admin', 'local', 'test'] });
    verifier('M4 : avec la liste déjà lue, aucun listDatabases de plus', appels, 0);
    verifier('M4 : garde.js ne refait plus son propre listDatabases pour la garde (liste transmise)', /noms: bases/.test(gc), true);

    // I1 : mesurer-atlas.js --connexion=ecriture
    const ma = require('./mesurer-atlas');
    verifier('I1 : --connexion=ecriture choisit les URI d\'écriture, le défaut celles de lecture', [ma.variablesDe('ecriture'), ma.variablesDe('lecture')], [[['production', 'MONGODB_URI'], ['cartes', 'MONGODB_CARTES_URI']], [['production', 'MONGODB_LECTURE_URI'], ['cartes', 'MONGODB_CARTES_LECTURE_URI']]]);
    verifier('I1 : argument inconnu refusé', [ma.lireArguments(['--connexion=ecriture']).erreur, typeof ma.lireArguments(['--x']).erreur], [undefined, 'string']);

    // CORRECTION 3 : une grappe LOCALE de banc (tous les hôtes en boucle locale, lus sur le client connecté) n'a pas de limite de 512 Mo
    const avecHotes = (hotes, extra = {}) => Object.assign(faux({}), { options: { hosts: hotes.map(host => ({ host, port: 27017 })), ...extra } });
    let loc = await M.verifierEcriture({ client: avecHotes(['127.0.0.1']) });
    verifier('C3 : grappe vide sur 127.0.0.1 : PASSE (grappe locale de banc)', [loc.autorise, loc.niveau, /grappe locale de banc/.test(loc.raison)], [true, 'locale', true]);
    verifier('C3 : ::1 et localhost aussi', [(await M.verifierEcriture({ client: avecHotes(['::1']) })).autorise, (await M.verifierEcriture({ client: avecHotes(['localhost']) })).autorise], [true, true]);
    loc = await M.verifierEcriture({ client: avecHotes(['cluster0-shard-00-00.abcde.mongodb.net']) });
    verifier('C3 : le même faux vide sur un hôte *.mongodb.net : BLOQUE', [loc.autorise, loc.niveau], [false, 'inconnu']);
    loc = await M.verifierEcriture({ client: avecHotes(['127.0.0.1', 'cluster0-shard-00-00.abcde.mongodb.net']) });
    verifier('C3 : un mélange (un local, un distant) : BLOQUE', loc.autorise, false);
    loc = await M.verifierEcriture({ client: avecHotes(['127.0.0.1'], { srvHost: 'cluster0.abcde.mongodb.net' }) });
    verifier('C3 : une URI srv n\'est jamais locale : BLOQUE', loc.autorise, false);
    loc = await M.verifierEcriture({ client: faux({}) });
    verifier('C3 : hôtes illisibles (aucune option) : BLOQUE', loc.autorise, false);
    loc = await M.verifierEcriture({ client: avecHotes([]) });
    verifier('C3 : liste d\'hôtes vide : BLOQUE', loc.autorise, false);
    loc = await M.verifierEcriture({ client: avecHotes(['127.0.0.2']) });
    verifier('C3 : 127.0.0.2 (hors liste fermée) : BLOQUE', loc.autorise, false);
    loc = await M.verifierEcriture({ client: Object.assign(grappeA(95), { options: { hosts: [{ host: '127.0.0.1' }] } }) });
    verifier('C3 : grappe locale PLEINE : passe aussi (pas de limite Atlas en local)', loc.autorise, true);

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌', e); process.exit(1); });
