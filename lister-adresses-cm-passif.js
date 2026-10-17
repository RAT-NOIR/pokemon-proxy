// node lister-adresses-cm-passif.js [--plan=<sim-plan.json>] [--sortie=<dossier>] — LECTURE SEULE de la base `test` (MONGODB_LECTURE_URI, jamais imprimée), AUCUN réseau vers Cardmarket.
// Génère la liste des 128 adresses (64 paires Black Star) : collecte-cartes/cm-passif-liste.json (embarquée par le userscript et le récepteur) + ADRESSES-64-PAIRES.json/.md.
const fs = require('fs');
const path = require('path');
const { construireListe } = require('./collecte-cartes/cm-passif');

const PLAN = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S7\\BS-HOLO\\sim-plan.json';
const SORTIE = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S7\\CM-PASSIF';
const arg = (nom, defaut) => (process.argv.find(a => a.startsWith(`--${nom}=`)) || '').slice(nom.length + 3) || defaut;

function markdown(liste) {
    const l = ['# Adresses Cardmarket des 64 paires Black Star (128 fiches)', '',
        'Forme : `https://www.cardmarket.com/en/Pokemon/Products/Singles/<slugSet>/<slug>` (slugSet et slug lus dans `numeros_cartes`). Tri : set, puis numéro ; V1 (la plus ancienne) puis V2.',
        'Tampon attendu = celui que Pokumon donne à la 2e entrée du couple (une des deux versions le porte, c\'est ce que tu cherches).', '',
        '| # | set | numéro | nom | V1 | V2 | tampon Pokumon attendu |', '|---|---|---|---|---|---|---|'];
    for (const p of liste) l.push(`| ${p.n} | ${p.set} | ${p.numero} | ${p.nom.replace(/\|/g, '\\|')} | ${p.versions[0].url} | ${p.versions[1].url} | ${p.tampon} |`);
    return l.join('\n') + '\n';
}

const cleJs = s => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`;
/** Remplace le bloc `var LISTE = {…};` du userscript (entre LISTE:DEBUT et LISTE:FIN) par la liste : une ligne par adresse « set/slug » → { n, v, t, s, o }. */
function injecterListe(src, liste) {
    const lignes = [];
    for (const p of liste) for (const v of p.versions) lignes.push(`        ${cleJs(`${v.slugSet}/${v.slug}`)}: { n: ${p.n}, v: ${cleJs(v.v)}, i: ${v.idProduct}, t: ${cleJs(p.tampon)}, s: ${cleJs(p.set)}, o: ${cleJs(p.numero)} }`);
    const bloc = `    var LISTE = {\n${lignes.join(',\n')}\n    };`;
    const re = /(\/\/ LISTE:DEBUT[^\n]*\n)    var LISTE = \{[\s\S]*?\n    \};(\n    \/\/ LISTE:FIN)/;
    if (!re.test(src)) throw new Error('marqueurs LISTE:DEBUT / LISTE:FIN absents du userscript');
    return src.replace(re, (_, a, b) => a + bloc + b);
}

async function main() {
    require('dotenv').config({ path: 'C:\\Users\\Yung\\Desktop\\pokemon-proxy\\.env', quiet: true });
    if (!process.env.MONGODB_LECTURE_URI) { console.error('❌ MONGODB_LECTURE_URI absente'); process.exit(2); }
    const { MongoClient } = require('mongodb');
    const exclus = JSON.parse(fs.readFileSync(arg('plan', PLAN), 'utf8')).exclus;
    const ids = exclus.flatMap(e => e.idProduct);
    const c = new MongoClient(process.env.MONGODB_LECTURE_URI);
    await c.connect();
    try {
        const lignes = await c.db('test').collection('numeros_cartes').find({ idProduct: { $in: ids } }, { projection: { idProduct: 1, slug: 1, slugSet: 1 } }).toArray();
        const numeros = new Map(lignes.map(x => [x.idProduct, x]));
        console.log(`plan : ${exclus.length} paires, ${ids.length} idProduct ; base : ${lignes.length} lignes numeros_cartes trouvées`);
        const liste = construireListe(exclus, numeros);
        const sortie = arg('sortie', SORTIE);
        fs.mkdirSync(sortie, { recursive: true });
        const json = JSON.stringify(liste, null, 1) + '\n';
        fs.writeFileSync(path.join(__dirname, 'collecte-cartes', 'cm-passif-liste.json'), json);
        fs.writeFileSync(path.join(sortie, 'ADRESSES-64-PAIRES.json'), json);
        fs.writeFileSync(path.join(sortie, 'ADRESSES-64-PAIRES.md'), markdown(liste));
        const us = path.join(__dirname, 'userscript-cardmarket-fiche.js');
        fs.writeFileSync(us, injecterListe(fs.readFileSync(us, 'utf8'), liste));
        console.log(`✅ ${liste.length} paires, ${new Set(liste.flatMap(p => p.versions.map(v => v.url))).size} adresses distinctes → ${sortie}`);
    } finally { await c.close(); }
}
if (require.main === module) main().catch(e => { console.error('❌', e.message); process.exit(1); });
module.exports = { markdown, injecterListe };
