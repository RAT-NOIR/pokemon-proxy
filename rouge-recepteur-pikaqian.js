// node rouge-recepteur-pikaqian.js — le ROUGE, garde par garde, du récepteur passif de PikaQian (recepteur-pikaqian.js).
// Pour chaque ligne marquée « GARDE:<nom> », un récepteur MUTANT où cette garde seule est retirée (son `if (` devient `if (false && `) est écrit hors du dépôt,
// et test-recepteur-pikaqian.js (PK_RECEPTEUR) doit ÉCHOUER dessus. Un mutant qui passe = une garde que le banc ne discrimine pas.
// Deux gardes de taille se doublent par construction (la déclaration, puis le flux) : retirées seules, le banc passe — c'est écrit ; retirées ensemble (« taille »), il doit échouer.
// Le récepteur de production n'est ni modifié ni lancé : on ne lance que ses copies, dans le banc.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SRC = fs.readFileSync(path.join(__dirname, 'recepteur-pikaqian.js'), 'utf8').split(/\r?\n/);
const nomsDesGardes = [...new Set(SRC.map(l => /GARDE:([a-z-]+)/.exec(l)?.[1]).filter(Boolean))];
const DOUBLEES = { 'taille-declaree': 'couverte par taille-flux (la déclaration évite seulement de lire le corps)' };
/** `if (COND) …` -> `if (false && (COND)) …` : les parenthèses de la condition sont appariées (un `&&` ajouté sans elles changerait la précédence d'un `||`). */
function neutraliser(ligne) {
    const i = ligne.indexOf('if (');
    if (i < 0) return ligne;
    let prof = 0, fin = -1;
    for (let k = i + 3; k < ligne.length; k++) { if (ligne[k] === '(') prof++; else if (ligne[k] === ')' && --prof === 0) { fin = k; break; } }
    return ligne.slice(0, i + 4) + 'false && (' + ligne.slice(i + 4, fin) + ')' + ligne.slice(fin);
}
const mutants = [...nomsDesGardes.map(n => ({ nom: n, gardes: [n] })), { nom: 'taille (déclaration + flux ensemble)', gardes: ['taille-declaree', 'taille-flux'] }];

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'rouge-recepteur-'));
const absolu = rel => JSON.stringify(path.join(__dirname, rel).replace(/\\/g, '/'));
let anormaux = 0;
// 2026-10-13 : DEUX bancs (les pages, puis les images de /images) ; un mutant « échoue » si l'un des deux échoue
const BANCS = ['test-recepteur-pikaqian.js', 'test-recepteur-images-pikaqian.js'];
const lance = fichier => {
    const rs = BANCS.map(b => spawnSync(process.execPath, [path.join(__dirname, b)], { encoding: 'utf8', timeout: 180000, env: { ...process.env, PK_RECEPTEUR: fichier } }));
    const rate = rs.find(r => r.status !== 0);
    return { status: rate ? rate.status || 1 : 0, stdout: rs.map(r => r.stdout).join('\n') };
};

const temoin = lance(path.join(__dirname, 'recepteur-pikaqian.js'));
console.log(`témoin (récepteur intact) : ${temoin.status === 0 ? '✅ passe' : '❌ ÉCHOUE — le rouge ne prouve rien'}`);
if (temoin.status !== 0) anormaux++;
for (const m of mutants) {
    let touchees = 0;
    const lignes = SRC.map(l => {
        const g = /GARDE:([a-z-]+)/.exec(l)?.[1];
        if (!g || !m.gardes.includes(g)) return l;
        touchees++;
        return neutraliser(l);
    }).map(l => l.replace("require('./collecte-cartes/pikaqian')", `require(${absolu('collecte-cartes/pikaqian')})`).replace("require('./collecte-cartes/pikaqian-sets')", `require(${absolu('collecte-cartes/pikaqian-sets')})`).replace("require('sharp')", `require(${absolu('node_modules/sharp')})`));
    const fichier = path.join(dossier, `mutant-${m.nom.replace(/\W+/g, '-')}.js`);
    fs.writeFileSync(fichier, lignes.join('\n'));
    const r = lance(fichier);
    const echoue = r.status !== 0;
    const attendu = m.gardes.length === 1 && DOUBLEES[m.gardes[0]] ? false : true;      // les gardes doublées, seules, ne sont pas discriminables
    const bon = touchees === m.gardes.length && echoue === attendu;
    if (!bon) anormaux++;
    const premier = (r.stdout.match(/❌ [^\n]*/) || [''])[0].slice(0, 110);
    console.log(`${bon ? '✅' : '❌'} garde « ${m.nom} » retirée : le banc ${echoue ? 'ÉCHOUE (rouge vu)' : 'PASSE'}${attendu ? '' : ` — attendu : ${DOUBLEES[m.gardes[0]]}`}${premier ? ` — ${premier}` : ''}${touchees !== m.gardes.length ? ` — ⚠️ ${touchees} ligne(s) marquée(s) trouvée(s)` : ''}`);
}
fs.rmSync(dossier, { recursive: true, force: true });
console.log(`\n${mutants.length} mutants, ${anormaux} anormal(aux)`);
process.exit(anormaux ? 1 : 0);
