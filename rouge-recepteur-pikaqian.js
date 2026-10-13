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
// LOT PQ-PROMO (2026-10-13) : les gardes des déclarations d'une ligne vivent dans collecte-cartes/pikaqian.js (verdictDePage, imageAcceptee), lues par TOUS les lecteurs. Leurs marques « GARDE:pk-* »
// sont retirées aussi, une à une : le récepteur MUTANT est alors relié à un pikaqian.js MUTANT, et PK_MODULE donne ce même mutant au banc pur.
const SRC_P = fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'pikaqian.js'), 'utf8').split(/\r?\n/);
const nomsP = [...new Set(SRC_P.map(l => /GARDE:([a-z-]+)/.exec(l)?.[1]).filter(Boolean))];
const mutants = [...nomsDesGardes.map(n => ({ nom: n, gardes: [n], fichier: 'recepteur' })), { nom: 'taille (déclaration + flux ensemble)', gardes: ['taille-declaree', 'taille-flux'], fichier: 'recepteur' },
    ...nomsP.map(n => ({ nom: n, gardes: [n], fichier: 'pikaqian' }))];

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'rouge-recepteur-'));
const absolu = rel => JSON.stringify(path.join(__dirname, rel).replace(/\\/g, '/'));
let anormaux = 0;
// 2026-10-13 : QUATRE bancs (les pages, les images de /images, les pages promo du récepteur, le module pur des déclarations) ; un mutant « échoue » si l'un d'eux échoue
const BANCS = ['test-recepteur-pikaqian.js', 'test-recepteur-images-pikaqian.js', 'test-recepteur-pikaqian-promo.js', 'test-pikaqian-promo.js', 'test-pikaqian-promo2.js'];
const lance = (fichier, fichierP = null) => {
    const rs = BANCS.map(b => spawnSync(process.execPath, [path.join(__dirname, b)], { encoding: 'utf8', timeout: 180000, env: { ...process.env, PK_RECEPTEUR: fichier, ...(fichierP ? { PK_MODULE: fichierP } : {}) } }));
    const rate = rs.find(r => r.status !== 0);
    return { status: rate ? rate.status || 1 : 0, stdout: rs.map(r => r.stdout).join('\n') };
};
/** Le récepteur (intact ou mutant), relié au pikaqian.js donné (`modulePk`, chemin absolu) : toutes ses dépendances locales en chemins absolus. */
const relier = (lignes, modulePk) => lignes.map(l => l.replace("require('./collecte-cartes/pikaqian')", `require(${modulePk ? JSON.stringify(modulePk.replace(/\\/g, '/')) : absolu('collecte-cartes/pikaqian')})`).replace("require('./collecte-cartes/pikaqian-sets')", `require(${absolu('collecte-cartes/pikaqian-sets')})`).replace("require('sharp')", `require(${absolu('node_modules/sharp')})`));

const temoin = lance(path.join(__dirname, 'recepteur-pikaqian.js'));
console.log(`témoin (récepteur intact) : ${temoin.status === 0 ? '✅ passe' : '❌ ÉCHOUE — le rouge ne prouve rien'}`);
if (temoin.status !== 0) anormaux++;
for (const m of mutants) {
    let touchees = 0;
    const source = m.fichier === 'pikaqian' ? SRC_P : SRC;
    const lignes = source.map(l => {
        const g = /GARDE:([a-z-]+)/.exec(l)?.[1];
        if (!g || !m.gardes.includes(g)) return l;
        touchees++;
        return neutraliser(l);
    });
    const base = m.nom.replace(/\W+/g, '-');
    let r;
    if (m.fichier === 'pikaqian') {
        const mp = path.join(dossier, `mutant-pikaqian-${base}.js`);
        fs.writeFileSync(mp, lignes.map(l => l.replace(/require\('\.\/(tpc|jointure|source-passive|pikaqian-sets)'\)/g, (_, n) => `require(${absolu(`collecte-cartes/${n}`)})`)).join('\n'));
        const fr = path.join(dossier, `recepteur-sur-${base}.js`);
        fs.writeFileSync(fr, relier(SRC, mp).join('\n'));
        r = lance(fr, mp);
    } else {
        const fichier = path.join(dossier, `mutant-${base}.js`);
        fs.writeFileSync(fichier, relier(lignes).join('\n'));
        r = lance(fichier);
    }
    const echoue = r.status !== 0;
    const attendu = m.gardes.length === 1 && DOUBLEES[m.gardes[0]] && m.fichier === 'recepteur' ? false : true;      // les gardes doublées, seules, ne sont pas discriminables
    const bon = touchees === m.gardes.length && echoue === attendu;
    if (!bon) anormaux++;
    const premier = (r.stdout.match(/❌ [^\n]*/) || [''])[0].slice(0, 110);
    console.log(`${bon ? '✅' : '❌'} garde « ${m.nom} »${m.fichier === 'pikaqian' ? ' (pikaqian.js)' : ''} retirée : le banc ${echoue ? 'ÉCHOUE (rouge vu)' : 'PASSE'}${attendu ? '' : ` — attendu : ${DOUBLEES[m.gardes[0]]}`}${premier ? ` — ${premier}` : ''}${touchees !== m.gardes.length ? ` — ⚠️ ${touchees} ligne(s) marquée(s) trouvée(s)` : ''}`);
}
fs.rmSync(dossier, { recursive: true, force: true });
console.log(`\n${mutants.length} mutants, ${anormaux} anormal(aux)`);
process.exit(anormaux ? 1 : 0);
