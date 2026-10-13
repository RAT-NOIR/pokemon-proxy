// Banc (2026-10-13) : l'export des logos SAUTE nommément les fichiers absents d'apport-manuel (décision 7 du testeur) et reprend l'entrée de
// l'export précédent. Aucune base, aucun R2, aucun réseau : un FAUX DISQUE (dossier créé ici, laissé en place) et un lecteur de fichier injecté.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { lirePartages } = require('./collecte-cartes/logos-partages-saut');
let ok = 0, ko = 0;
const egal = (n, a, b) => { const sa = JSON.stringify(a), sb = JSON.stringify(b); if (sa === sb) { ok++; } else { ko++; console.log(`❌ ${n} : ${sa} ≠ ${sb}`); } };
const sha1 = b => crypto.createHash('sha1').update(b).digest('hex');
const leve = async f => { try { await f(); return null; } catch (e) { return e; } };

const RACINE = path.join('C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S4\\EXPORT-SAUT', 'faux-disque');
const DECK = path.join(RACINE, 'apport-manuel', 'Deck JP');
fs.rmSync(path.join(RACINE, 'apport-manuel'), { recursive: true, force: true }); // dossier que CE banc a créé : jamais une jonction
fs.mkdirSync(DECK, { recursive: true });
const OCT = { AAA: Buffer.from('logo-aaa'), BBB: Buffer.from('logo-bbb'), CCC: Buffer.from('logo-ccc') };
const PARTAGES = { 'Set-A': 'AAA', 'Set-B': 'BBB', 'Set-C': 'CCC' };
const lus = new Map(Object.entries(OCT).map(([c, b]) => [c, { fichier: `${c}.png`, sha1: sha1(b), lu: `lu ${c}` }]));
// le lecteur injecté : lit sur le faux disque, sans sharp (dimensions fixes)
const fichier = async rel => { const b = fs.readFileSync(path.join(RACINE, rel)); return { fichier: rel, cheminAbsolu: path.join(RACINE, rel), sha1: sha1(b), w: 10, h: 20 }; };
const poser = c => fs.writeFileSync(path.join(DECK, `${c}.png`), OCT[c]);
const precedent = (set, extra = {}) => ({ set, fichier: `apport-manuel/Deck JP/${PARTAGES[set] === 'AAA' ? 'AAA' : PARTAGES[set]}.png`, sha1: 'ancien-' + set, w: 1, h: 2, lu: 'lu ancien', partageAvec: [], ...extra });
const appel = (precedents = []) => lirePartages({ racine: RACINE, partages: PARTAGES, lus, fichier, precedents });

(async () => {
    // 1. tout présent : trois entrées normales, rien de sauté
    for (const c of Object.keys(OCT)) poser(c);
    let r = await appel();
    egal('1 trois entrées', r.partages.map(p => p.set), ['Set-A', 'Set-B', 'Set-C']);
    egal('1b aucun absent', r.fichiersAbsents, []);
    egal('1c entrée normale sans marque de reprise', r.partages.some(p => 'reprisDeLExportPrecedent' in p || 'fichierAbsent' in p), false);
    egal('1d sha1 de la table', r.partages[0].sha1, sha1(OCT.AAA));

    // 2. un fichier absent, l'export précédent a son entrée : reprise telle quelle, marquée, et NOMMÉE dans fichiersAbsents
    fs.rmSync(path.join(DECK, 'BBB.png'));
    const prec = [precedent('Set-A'), precedent('Set-B', { partageAvec: ['Set-X'] })];
    r = await appel(prec);
    egal('2 le set reste présent', r.partages.map(p => p.set), ['Set-A', 'Set-B', 'Set-C']);
    const b = r.partages.find(p => p.set === 'Set-B');
    egal('2b reprise marquée', [b.reprisDeLExportPrecedent, b.fichierAbsent], [true, 'apport-manuel/Deck JP/BBB.png']);
    egal('2c le reste de l\'entrée est celui de l\'export précédent', { ...b, reprisDeLExportPrecedent: undefined, fichierAbsent: undefined }, { ...prec[1], reprisDeLExportPrecedent: undefined, fichierAbsent: undefined });
    egal('2d fichiersAbsents nomme fichier, set, rubrique, action', r.fichiersAbsents, [{ fichier: 'apport-manuel/Deck JP/BBB.png', cheminAbsolu: path.join(RACINE, 'apport-manuel/Deck JP/BBB.png'), sets: ['Set-B'], rubrique: 'partagés', action: 'repris de l\'export précédent' }]);
    egal('2e les présents ne sont pas touchés', r.partages.find(p => p.set === 'Set-A').sha1, sha1(OCT.AAA));
    egal('2f l\'objet précédent n\'est pas muté', 'reprisDeLExportPrecedent' in prec[1], false);

    // 3. un fichier absent SANS entrée précédente : rien n'est inventé, le set est listé « sans logo repris »
    r = await appel([precedent('Set-A')]);
    egal('3 pas d\'entrée inventée', r.partages.map(p => p.set), ['Set-A', 'Set-C']);
    egal('3b listé sans logo repris', r.fichiersAbsents.map(a => [a.sets, a.action]), [[['Set-B'], 'sans logo repris']]);

    // 4. une entrée précédente qui était DÉJÀ une reprise reste une reprise (fichier absent toujours)
    r = await appel([precedent('Set-B', { reprisDeLExportPrecedent: true, fichierAbsent: 'ancien-chemin' })]);
    egal('4 reprise d\'une reprise : chemin remis à jour', r.partages.find(p => p.set === 'Set-B').fichierAbsent, 'apport-manuel/Deck JP/BBB.png');

    // 5. LE RETOUR DU FICHIER : présent, sha1 = table → l'entrée normale remplace la reprise sans geste
    poser('BBB');
    r = await appel([precedent('Set-A'), precedent('Set-B', { reprisDeLExportPrecedent: true, fichierAbsent: 'apport-manuel/Deck JP/BBB.png' })]);
    const b2 = r.partages.find(p => p.set === 'Set-B');
    egal('5 entrée normale', [b2.sha1, 'reprisDeLExportPrecedent' in b2, 'fichierAbsent' in b2, r.fichiersAbsents.length], [sha1(OCT.BBB), false, false, 0]);

    // 6. ce qui LÈVE toujours : sha1 qui diffère, ligne absente de la table, erreur de lecture d'un autre type, dossier absent
    fs.writeFileSync(path.join(DECK, 'AAA.png'), Buffer.from('autre-contenu'));
    let e = await leve(appel);
    egal('6 sha1 différent : lève', /AAA.*sha1/.test(e?.message || ''), true);
    poser('AAA');
    e = await leve(() => lirePartages({ racine: RACINE, partages: { ...PARTAGES, 'Set-Z': 'ZZZ' }, lus, fichier, precedents: [] }));
    egal('6b code absent de la table des lus : lève', /ZZZ/.test(e?.message || ''), true);
    e = await leve(() => lirePartages({ racine: RACINE, partages: PARTAGES, lus, precedents: [], fichier: async rel => { if (/BBB/.test(rel)) { const x = new Error('EACCES: permission denied'); x.code = 'EACCES'; throw x; } return fichier(rel); } }));
    egal('6c erreur de lecture non ENOENT : lève', e?.code, 'EACCES');
    e = await leve(() => lirePartages({ racine: path.join(RACINE, 'racine-fausse'), partages: PARTAGES, lus, fichier, precedents: [] }));
    egal('6d dossier apport-manuel/Deck JP absent (racine fausse) : lève, ne saute pas tout', /Deck JP/.test(e?.message || ''), true);

    console.log(`${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
