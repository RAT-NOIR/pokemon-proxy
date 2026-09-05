// ============================================================================
// ⚠️⚠️ DISCIPLINE DES OUTILS DE MESURE — LIRE AVANT D'AJOUTER UNE LIGNE
// ============================================================================
// Septième principe (scoring.js) : le catalogue des erreurs d'instrument y vit, et on ne
// le compte pas ici — un nombre recopié redevient faux au prochain ajout. Deux familles :
// FABRIQUER une entrée que le système n'a jamais produite, et LIRE UNE ABSENCE COMME UNE
// VALEUR CONTRAIRE. Règles appliquées ici :
//   1. On ne reconstruit AUCUNE clé : `idProduct` du journal est joint à
//      catalogue_produits, et c'est `idExpansion` qui décide de l'appartenance aux 24 sets.
//      Pas de rapprochement par nom, pas de compte de cartes, pas d'identifiant fabriqué.
//   2. Une image « accessible » est une requête HEAD qui rend 200 AVEC un content-type
//      d'image. La présence d'une URL au journal ne prouve rien : les CDN expirent.
//   3. Une URL absente n'est pas une image morte : les deux sont comptées SÉPARÉMENT.
// LECTURE SEULE. Aucune écriture, AUCUN TÉLÉCHARGEMENT — HEAD ne rapatrie pas le corps.
//
// ============================================================================
// CE QUE CET OUTIL MESURE : le journal est-il une source d'images exploitable ?
// ============================================================================
// Chaque scan est une photo réelle d'annonce. Combien de cartes DISTINCTES des 24 sets
// vintage japonais y figurent déjà, et combien ont une image encore servie aujourd'hui ?
// USAGE : node mesure-sourcing-images.js --base=<nom>
require('dotenv').config();
const BASE = process.argv.find(a => a.startsWith('--base='))?.split('=')[1];
if (!BASE) { console.error('❌ --base=<nom> obligatoire.'); process.exit(1); }
const mongoose = require('mongoose');
const axios = require('axios');
const { SETS_VINTAGE_JAPONAIS, EXPANSIONS_VINTAGE } = require('./sets-vintage-japonais');

const CONCURRENCE = 10;
const pc = (n, d) => d ? `${(100 * n / d).toFixed(1)} %` : '—';

async function enParallele(items, n, travail) {
    const out = new Array(items.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
        while (true) { const k = i++; if (k >= items.length) return; out[k] = await travail(items[k]); }
    }));
    return out;
}

// ⚠️ HEAD, PAS GET. On veut savoir si l'octet serait servi, pas le rapatrier.
async function imageVivante(url) {
    if (!url) return { etat: 'sans-url' };
    try {
        const r = await axios.head(url, { timeout: 12000, maxRedirects: 3 });
        const ct = String(r.headers['content-type'] || '');
        const taille = Number(r.headers['content-length']);
        if (r.status === 200 && ct.startsWith('image/')) {
            return { etat: 'vivante', ct, taille: Number.isFinite(taille) ? taille : null };
        }
        return { etat: 'reponse-non-image', ct };
    } catch (e) {
        return { etat: 'morte', code: e.response?.status || e.code || 'ERR' };
    }
}

(async () => {
    const c = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: BASE }).asPromise();
    const lignes = await c.collection('journal_scans')
        .find({ route: 'identifier', idProduct: { $ne: null } }).sort({ le: 1 }).toArray();

    // Jointure par idProduct -> idExpansion. Aucune heuristique.
    const ids = [...new Set(lignes.map(l => Number(l.idProduct)).filter(Number.isFinite))];
    const prods = await c.collection('catalogue_produits')
        .find({ idProduct: { $in: ids } }, { projection: { idProduct: 1, idExpansion: 1, name: 1 } }).toArray();
    const parId = new Map(prods.map(p => [Number(p.idProduct), p]));
    const expToCode = new Map(SETS_VINTAGE_JAPONAIS.filter(s => s.exp != null).map(s => [s.exp, s]));

    const dansVintage = lignes.filter(l => {
        const p = parId.get(Number(l.idProduct));
        return p && EXPANSIONS_VINTAGE.has(Number(p.idExpansion));
    });

    console.log(`base : ${BASE}`);
    console.log(`lignes abouties du journal : ${lignes.length}`);
    console.log(`   dont un produit des 24 sets vintage japonais : ${dansVintage.length}\n`);

    // UNE ENTRÉE PAR CARTE DISTINCTE, en gardant la ligne la PLUS RÉCENTE : c'est celle
    // dont l'URL a le plus de chances d'être encore servie.
    const parCarte = new Map();
    for (const l of dansVintage) {
        const k = Number(l.idProduct);
        const prec = parCarte.get(k);
        if (!prec || l.le > prec.le) parCarte.set(k, l);
    }
    const distinctes = [...parCarte.values()];
    console.log(`cartes DISTINCTES des 24 sets présentes au journal : ${distinctes.length}`);
    const avecUrl = distinctes.filter(l => l.imageUrl);
    console.log(`   avec une URL d'image au journal : ${avecUrl.length}  (${pc(avecUrl.length, distinctes.length)})`);
    console.log(`   ⚠️ sans URL : ${distinctes.length - avecUrl.length} — ce n'est PAS « image morte », c'est « jamais journalisée ».\n`);

    console.log('── test HEAD sur chaque URL (aucun téléchargement) ──');
    const res = await enParallele(distinctes, CONCURRENCE, l => imageVivante(l.imageUrl));

    const parSet = new Map();
    for (let i = 0; i < distinctes.length; i++) {
        const l = distinctes[i], r = res[i];
        const p = parId.get(Number(l.idProduct));
        const s = expToCode.get(Number(p.idExpansion));
        const code = s?.code ?? `exp${p.idExpansion}`;
        if (!parSet.has(code)) parSet.set(code, { set: s, cartes: 0, vivantes: 0, mortes: 0, sansUrl: 0, tailles: [] });
        const e = parSet.get(code);
        e.cartes++;
        if (r.etat === 'vivante') { e.vivantes++; if (r.taille) e.tailles.push(r.taille); }
        else if (r.etat === 'sans-url') e.sansUrl++;
        else e.mortes++;
    }

    console.log('\n' + '═'.repeat(92));
    console.log('SOURCE 3 — LE JOURNAL, SET PAR SET');
    console.log('═'.repeat(92));
    console.log(`${'code'.padEnd(8)} ${'produits'.padStart(8)} ${'au journal'.padStart(10)} ${'VIVANTES'.padStart(9)} ${'mortes'.padStart(7)} ${'sans url'.padStart(8)} ${'couverture'.padStart(11)}   set`);
    console.log('─'.repeat(92));
    let tC = 0, tV = 0, tM = 0, tS = 0, tProd = 0;
    for (const s of SETS_VINTAGE_JAPONAIS) {
        const e = parSet.get(s.code);
        tProd += s.prod ?? 0;
        if (!e) {
            console.log(`${String(s.code).padEnd(8)} ${String(s.prod ?? '—').padStart(8)} ${'0'.padStart(10)} ${'0'.padStart(9)} ${'0'.padStart(7)} ${'0'.padStart(8)} ${'0.0 %'.padStart(11)}   ${s.nom}`);
            continue;
        }
        tC += e.cartes; tV += e.vivantes; tM += e.mortes; tS += e.sansUrl;
        console.log(`${String(s.code).padEnd(8)} ${String(s.prod ?? '—').padStart(8)} ${String(e.cartes).padStart(10)} ${String(e.vivantes).padStart(9)} ${String(e.mortes).padStart(7)} ${String(e.sansUrl).padStart(8)} ${pc(e.vivantes, s.prod).padStart(11)}   ${s.nom}`);
    }
    console.log('─'.repeat(92));
    console.log(`${'TOTAL'.padEnd(8)} ${String(tProd).padStart(8)} ${String(tC).padStart(10)} ${String(tV).padStart(9)} ${String(tM).padStart(7)} ${String(tS).padStart(8)} ${pc(tV, tProd).padStart(11)}`);

    const toutesTailles = [...parSet.values()].flatMap(e => e.tailles).sort((a, b) => a - b);
    if (toutesTailles.length) {
        const med = toutesTailles[toutesTailles.length >> 1];
        console.log(`\n   taille des images vivantes : médiane ${(med / 1024).toFixed(0)} Ko · min ${(toutesTailles[0] / 1024).toFixed(0)} Ko · max ${(toutesTailles[toutesTailles.length - 1] / 1024).toFixed(0)} Ko`);
    }
    const cts = new Map();
    for (let i = 0; i < res.length; i++) if (res[i].etat === 'vivante') cts.set(res[i].ct, (cts.get(res[i].ct) || 0) + 1);
    if (cts.size) console.log(`   formats : ${[...cts].map(([k, v]) => `${k} (${v})`).join(' · ')}`);
    const codesMorts = new Map();
    for (const r of res) if (r.etat === 'morte') codesMorts.set(r.code, (codesMorts.get(r.code) || 0) + 1);
    if (codesMorts.size) console.log(`   causes de mort : ${[...codesMorts].map(([k, v]) => `${k} (${v})`).join(' · ')}`);

    console.log('\n' + '═'.repeat(92));
    console.log('CE QUE ÇA VAUT COMME SOURCE');
    console.log('═'.repeat(92));
    console.log(`   couverture du périmètre : ${tV} images vivantes pour ${tProd} produits catalogue (${pc(tV, tProd)})`);
    console.log('   ⚠️ ET UNE IMAGE D\'ANNONCE N\'EST PAS UNE IMAGE DE RÉFÉRENCE : photo tenue à la');
    console.log('      main, cadrage libre, reflets, sleeve, parfois le dos. Elle sert à comparer');
    console.log('      une photo à une photo, pas à constituer un référentiel propre.');
    console.log('   ⚠️ Et elle appartient au VENDEUR : ce que le journal en conserve est une URL,');
    console.log('      pas un droit de rediffusion. À trancher avant tout usage, pas après.');
    await c.close();
})().catch(e => { console.error(e.stack); process.exit(1); });
