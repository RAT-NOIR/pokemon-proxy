'use strict';
// Banc MODELE-VISUEL-API (8) — l'outil qui scelle l'index (outils/sceller-index-empreintes.js) : du dossier du producteur d'index (empreintes.npy float32, cles.json, index.json, contexte.json) au conteneur RMEI.
// Tout est FABRIQUÉ dans le dossier temporaire (un .npy écrit à la main au format 1.0) ; l'outil n'ouvre aucun réseau et n'écrit que dans le chemin donné.
const H = require('./_harnais');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const A = require('./_empreinte-aide');
const X = require('../identifier/index-empreintes');
const T = require('../../outils/sceller-index-empreintes');

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'sceller-banc-'));
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function npy(data, n, d) {
    let entete = `{'descr': '<f4', 'fortran_order': False, 'shape': (${n}, ${d}), }`;
    const total = 10 + entete.length + 1; entete += ' '.repeat((64 - (total % 64)) % 64) + '\n';
    const e = Buffer.alloc(10); e.write('\x93NUMPY', 0, 'latin1'); e[6] = 1; e[7] = 0; e.writeUInt16LE(entete.length, 8);
    return Buffer.concat([e, Buffer.from(entete, 'latin1'), Buffer.from(data.buffer, data.byteOffset, data.byteLength)]);
}
const ecrire = (nom, contenu) => { fs.writeFileSync(path.join(dossier, nom), contenu); return path.join(dossier, nom); };

(async () => {
    ecrire('empreintes.npy', npy(A.matrice, A.N, 256));
    ecrire('cles.json', JSON.stringify(A.cles));
    const meta = { version: '2026-10-17T14:14:00.000Z', chargeLe: '2026-10-17T14:14:00.000Z', n: A.N, dim: 256, sha256Empreintes: sha(path.join(dossier, 'empreintes.npy')), sha256Cles: sha(path.join(dossier, 'cles.json')), poidsSha256: A.MODELE.sha256 };
    ecrire('index.json', JSON.stringify(meta));
    const contexte = ecrire('contexte.json', JSON.stringify(A.contexte));
    const r = T.construire({ dossierIndex: dossier, fichierContexte: contexte, modele: A.MODELE, secret: A.SECRET });
    H.v('1a. le dossier du producteur devient un conteneur : n et taille de la matrice fp16', [r.n, r.octetsMatrice], [A.N, A.N * 512]);
    const o = X.ouvrir(r.scelle, A.SECRET, { modeleAttendu: A.MODELE });
    H.v('1b. le conteneur s\'ouvre pour le modèle de la configuration ; date et nombre de lignes de l\'index.json', [o.meta.n, o.meta.chargeLe.toISOString()], [A.N, '2026-10-17T14:14:00.000Z']);
    const q = A.ligneDe(11);
    H.v('1c. une recherche sur l\'index issu du .npy donne le même rang 1 que l\'index fabriqué directement', o.index.voisins(q, 3).top[0][0], A.installerIndex().voisins(q, 3).top[0][0]);
    // le .npy lu à la main
    const lu = T.lireNpy(npy(A.matrice, A.N, 256));
    H.vrai('2a. lireNpy rend n, d et les flottants à l\'identique', lu.n === A.N && lu.d === 256 && lu.donnees.every((x, i) => x === A.matrice[i]));
    const mauvais = (nom, buf, motif) => { let m; try { T.lireNpy(buf); m = 'lu'; } catch (e) { m = e.message; } H.vrai(`2. ${nom} -> refus (${motif})`, m.includes(motif)); };
    mauvais('magie fausse', Buffer.from('pas un npy du tout'), 'magie');
    mauvais('float64', Buffer.from(npy(A.matrice, A.N, 256).toString('latin1').replace('<f4', '<f8'), 'latin1'), 'float32');
    mauvais('corps tronqué', npy(A.matrice, A.N, 256).subarray(0, 500), 'taille');
    // les hachages du producteur sont REVÉRIFIÉS
    fs.writeFileSync(path.join(dossier, 'cles.json'), JSON.stringify([...A.cles].reverse()));
    let m3; try { T.construire({ dossierIndex: dossier, fichierContexte: contexte, modele: A.MODELE, secret: A.SECRET }); m3 = 'ok'; } catch (e) { m3 = e.message; }
    H.vrai('3. des clés modifiées après le producteur (hachage de cles.json faux) : refus', /hachage des clés faux/.test(m3));
    // les arguments : écrits par ce qu'ils autorisent
    const bad = a => { try { T.arguments_(a); return 'ok'; } catch (e) { return e.message; } };
    H.vrai('4a. un argument inconnu est refusé (le secret ne passe jamais en argument)', /argument inconnu/.test(bad(['--secret', 'x'])));
    H.vrai('4b. un argument manquant est nommé', /argument manquant : --sortie/.test(bad(['--index', 'a', '--contexte', 'b', '--modele-id', 'c', '--poids-sha256', 'd'])));
    H.v('4c. tous les arguments : lus', Object.keys(T.arguments_(['--index', 'a', '--contexte', 'b', '--modele-id', 'c', '--poids-sha256', 'd', '--sortie', 'e'])).sort(), ['contexte', 'index', 'modele-id', 'poids-sha256', 'sortie']);
    H.vrai('5. l\'outil n\'ouvre aucun réseau et n\'écrit qu\'avec le drapeau « wx » (jamais d\'écrasement)', !/require\('(http|https|net|child_process)'\)|fetch\(|axios/.test(fs.readFileSync(path.join(__dirname, '..', '..', 'outils', 'sceller-index-empreintes.js'), 'utf8')) && /flag: 'wx'/.test(fs.readFileSync(path.join(__dirname, '..', '..', 'outils', 'sceller-index-empreintes.js'), 'utf8')));
    A.etat.vider();
    fs.rmSync(dossier, { recursive: true, force: true });
    H.bilan();
})().catch(e => { console.error(e); process.exit(1); });
