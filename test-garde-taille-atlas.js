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
    verifier('mesure de référence : données+index 436,2 (85,2 %), stockage+index 444,6 (86,8 %) -> la garde retient 86,8 %', [Math.round(m.donneesIndexMo ?? m.detail.donneesIndexMo), Math.round(m.mo * 10) / 10, Math.round(m.pourcent * 10) / 10], [436, 444.6, 86.8]);
    // le MAXIMUM de (données+index) et (stockage+index)
    m = await M.mesurerGrappe(faux({ test: { data: 400, index: 20, stockage: 450 } }));
    verifier('maximum de données+index et stockage+index (470 Mo, pas 420)', Math.round(m.mo), 470);
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

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌', e); process.exit(1); });
