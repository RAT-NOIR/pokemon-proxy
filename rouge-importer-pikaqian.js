// node rouge-importer-pikaqian.js — le ROUGE, preuve par preuve, de l'import passif de PikaQian (importer-pikaqian-passif.js).
// Pour chaque ligne de MUTANTS, un importeur où UNE preuve est retirée (un morceau de condition remplacé) est écrit hors du dépôt, et test-importer-pikaqian-passif.js (PK_IMPORT) doit ÉCHOUER dessus.
// Un mutant qui passe = une preuve que le banc ne discrimine pas. Celui dont la raison est écrite (`inerte`) est vide PAR CONSTRUCTION et doit PASSER — c'est dit, pas caché.
// L'importeur de production n'est ni modifié ni lancé : on ne lance que ses copies, dans le banc.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SRC = fs.readFileSync(path.join(__dirname, 'importer-pikaqian-passif.js'), 'utf8');
const MUTANTS = [
    { nom: 'plusieurs empreintes pour une tuile (versions-divergentes)', de: "new Set(entrees.map(e => e.sha256)).size > 1", vers: 'false' },
    { nom: 'tuile changée entre deux visites (tuile-changee)', de: "!memeTuile(v.tuiles.find(x => x.id === t.id), t)", vers: 'false' },
    { nom: 'empreinte du fichier relu (fichier-corrompu)', de: 'sha256(octets) !== e.sha256', vers: 'false' },
    { nom: 'fichier de forme inconnue (fichier-hors-forme)', de: '!m || m[1] !== t.id || path.basename(e.fichier) !== e.fichier', vers: 'false' },
    { nom: 'tuile désignée par deux produits (tuile-partagee)', de: 'parTuile.get(p.tuile.id) > 1', vers: 'false' },
    { nom: 'seuil de largeur 300 px (trop-petit)', de: 'o.w < largeurMinDe(P.SOURCE)', vers: 'false' },
    { nom: 'visuel retiré jamais repris', de: "deja?.etat === 'retire'", vers: 'false' },
    { nom: 'déjà là (même adresse, document ok)', de: "deja?.sha256 && deja.urlOriginal === p.url && deja.etat === 'ok'", vers: 'false' },
    { nom: 'complétude de la page contre la mesure du set', de: 'voulu && tuiles.length < voulu', vers: 'false' },
    { nom: 'gardes du collecteur : tirage et produits joints', de: '[C.gardeTirage(set, ligne, slug), C.gardeProduits(produitsJoints, slug)].find(g => !g.ok)', vers: 'undefined' },
    { nom: 'à l\'attendu juste', de: 'aEcrireDe(j) !== attendus[j.code]', vers: 'false' },
    { nom: 'source retirée par décision', de: 'if (retrait) throw', vers: 'if (false) throw' },
    { nom: 'plafond de 400 Mo', de: 'st.dataSize + st.indexSize > stopOctets', vers: 'false' },
    { nom: 'seuls les « a-ecrire » s\'écrivent', de: "if (e.statut !== 'a-ecrire') continue;", vers: '' },
    { nom: 'octets identiques sur deux tuiles (octets-partages)', de: 'if (ids.length > 1) for', vers: 'if (false) for' },
    { nom: 'bilan réécrit à « 0 écrite » quand tout est déjà là', de: 'if (ecrites === 0 && S.aEcrire === 0 && bilanExistant) {', vers: 'if (false) {' },
    { nom: 'premier import sans rien à écrire : aucun bilan écrit', de: 'if (ecrites === 0 && S.aEcrire === 0 && bilanExistant) {', vers: 'if (ecrites === 0 && S.aEcrire === 0) {' },
    { nom: 'le dossier est lu hors de la racine autorisée', de: "if (!R.dansRacineAutorisee(dossierPassif, racine) || R.dansApportsManuels(dossierPassif)) return", vers: "if (false) return" },
    { nom: 'la racine ne se juge plus que par les 3 noms (garde par refus)', de: "if (!R.dansRacineAutorisee(dossierPassif, racine) || R.dansApportsManuels(dossierPassif)) return", vers: "if (R.dansApportsManuels(dossierPassif)) return" },
    { nom: 'mêmes octets sur deux PAGES : empreintes entre codes non comparées', de: ".filter(([, codes]) => codes.size > 1)", vers: ".filter(([, codes]) => codes.size > 99)" },
    { nom: 'mêmes octets sur deux PAGES : l\'ensemble partagé n\'est pas appliqué', de: "o.ok && partagesEntreCodes.has(o.sha256) ?", vers: "false ?" },
    { nom: 'octets déjà en base non vérifiés', de: "if (memes.some(", vers: "if (false && memes.some(" },
    { nom: 'octets déjà en base : la même carte dans le même set devient un trou', de: "(d.carteId !== p.carteId || d.set !== slug)", vers: "true" },
    { nom: 'octets déjà en base : le sha256 du WebP servi n\'est plus cherché', de: "find({ sha256: webpSha })", vers: "find({ sha256: 'rien' })" },
    { nom: 'octets déjà en base : le sha256 des octets reçus n\'est plus cherché', de: "find({ sha256Octets: o.sha256 })", vers: "find({ sha256Octets: 'rien' })" }
];
// (la garde `cle-partagee` est RETIRÉE de l'import : vide par construction, elle ne pouvait pas échouer — relecture C)

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'rouge-import-'));
const absolu = rel => JSON.stringify(path.join(__dirname, rel).replace(/\\/g, '/'));
const lance = fichier => spawnSync(process.execPath, [path.join(__dirname, 'test-importer-pikaqian-passif.js')], { encoding: 'utf8', timeout: 240000, env: { ...process.env, PK_IMPORT: fichier } });
let anormaux = 0;
const temoin = lance(path.join(__dirname, 'importer-pikaqian-passif.js'));
console.log(`témoin (importeur intact) : ${temoin.status === 0 ? '✅ passe' : '❌ ÉCHOUE — le rouge ne prouve rien'}`);
if (temoin.status !== 0) anormaux++;
for (const m of MUTANTS) {
    const n = SRC.split(m.de).length - 1;
    // les `require('./x')` du mutant, qui vit ailleurs, deviennent absolus ; sharp et dotenv se résolvent depuis le dépôt
    const src = SRC.split(m.de).join(m.vers).replace(/require\('\.\/([^']+)'\)/g, (_, p) => `require(${absolu(p)})`).replace("require('sharp')", `require(${absolu('node_modules/sharp')})`).replace("require('dotenv')", `require(${absolu('node_modules/dotenv')})`);
    const fichier = path.join(dossier, `mutant-${MUTANTS.indexOf(m)}.js`);
    fs.writeFileSync(fichier, src);
    const r = lance(fichier);
    const echoue = r.status !== 0;
    const bon = n === 1 && echoue === !m.inerte;
    if (!bon) anormaux++;
    const premier = (r.stdout.match(/❌ [^\n]*/) || [''])[0].slice(0, 100);
    console.log(`${bon ? '✅' : '❌'} ${m.nom} : le banc ${echoue ? 'ÉCHOUE (rouge vu)' : 'PASSE'}${m.inerte ? ' — attendu : inerte' : ''}${n !== 1 ? ` — ⚠️ ${n} occurrence(s) du motif` : ''}${premier ? ` — ${premier}` : ''}`);
}
fs.rmSync(dossier, { recursive: true, force: true });
console.log(`\n${MUTANTS.length} mutants, ${anormaux} anormal(aux)`);
process.exit(anormaux ? 1 : 0);
