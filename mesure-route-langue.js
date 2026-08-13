// ============================================================================
// ⚠️⚠️ RÈGLE DE TOUT OUTIL QUI INTERROGE TCGdex — LIRE AVANT D'ÉCRIRE UNE MESURE
// ============================================================================
// TOUTE INTERROGATION DE TCGdex CHOISIT SA ROUTE D'APRÈS LA LANGUE DE LA CARTE.
// Interroger /v2/en pour une carte japonaise résout un identifiant qui désigne DEUX sets :
// 69 identifiants TCGdex sont portés par plusieurs expansions Cardmarket, et 66 d'entre eux
// apparient un set japonais à son jumeau occidental (mesuré le 2026-08-11).
//
// CE N'EST PAS UNE PRÉCAUTION THÉORIQUE — JE M'Y SUIS FAIT PIÉGER LE 2026-08-12, dans un
// outil de mesure, sur le défaut que j'avais moi-même mesuré la semaine d'avant :
//   `sv3-110` sur /v2/en  ->  Bonsly, set OBF, occidental
//   `sv3-110` côté japonais ->  Ninetales, set sv3, japonais
// J'ai comparé deux cartes qui n'ont rien à voir et j'ai appelé ça une « contradiction ».
// La conclusion — « une classe entière de reverses japonaises est hors d'atteinte » — était
// entièrement fausse, et elle a failli faire écrire un second pont de code inutile.
//
// LA DISCIPLINE DES INSTRUMENTS EST CELLE DU PRODUIT. Un outil de mesure qui se trompe
// coûte plus cher qu'un bug : il envoie corriger là où il n'y a rien, et il détourne du
// vrai défaut. Cette semaine, les instruments se sont trompés plus souvent que la
// production — le banc tirant sa vérité du système mesuré, les viviers reconstruits
// autrement que par la chaîne, l'objet de scoring fabriqué à la main, le « 3-0 » qui
// n'existait pas, et cette route. À chaque fois le produit allait mieux qu'on ne le
// croyait, ou le défaut était ailleurs.
//
// ============================================================================
// CE QUE CET OUTIL MESURE : la production tombe-t-elle dans le même piège ?
// ============================================================================
// USAGE : node mesure-route-langue.js --base=<nom>
require('dotenv').config();
const BASE = process.argv.find(a => a.startsWith('--base='))?.split('=')[1];
if (!BASE) { console.error('❌ --base=<nom> obligatoire'); process.exit(1); }
const mongoose = require('mongoose');
const axios = require('axios');
const S = require('./scoring');

// La route se dérive de la langue, JAMAIS d'un défaut.
const routeDe = langue => ({ JP: 'ja', ZH: 'zh-tw', KR: 'ko', FR: 'fr', DE: 'de', ES: 'es', IT: 'it', PT: 'pt' })[String(langue || '').toUpperCase()] || 'en';

async function carte(route, id) {
    try { return (await axios.get(`https://api.tcgdex.net/v2/${route}/cards/${id}`, { timeout: 10000 })).data; }
    catch (_) { return null; }
}

(async () => {
    const c = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: BASE }).asPromise();
    const lignes = await c.collection('journal_scans')
        .find({ route: 'identifier', idProduct: { $ne: null }, setTcgdex: { $type: 'string' } }).toArray();
    const jp = lignes.filter(l => ['JP', 'ZH', 'KR'].includes(String(l.langue || '').toUpperCase()));
    console.log(`lignes abouties avec setTcgdex : ${lignes.length}  ·  dont asiatiques : ${jp.length}\n`);

    const vus = new Set();
    let divergent = 0, memeCarte = 0, jaMuet = 0, testees = 0;
    for (const l of jp) {
        const num = String(l.numero ?? '').replace(/^0+/, '');
        if (!num) continue;
        const id = `${l.setTcgdex}-${num.padStart(3, '0')}`;
        if (vus.has(id)) continue; vus.add(id);
        if (vus.size > 14) break;
        testees++;
        const route = routeDe(l.langue);
        const [aLangue, aEn] = await Promise.all([carte(route, id), carte('en', id)]);
        const nomL = aLangue?.name ?? null, nomE = aEn?.name ?? null;
        if (!aLangue) jaMuet++;
        const meme = nomL && nomE && String(nomL) === String(nomE);
        if (aLangue && aEn && !meme) divergent++;
        if (meme) memeCarte++;
        console.log(`  ${id.padEnd(14)} [${route}] ${String(nomL ?? 'MUET').padEnd(18)} | [en] ${String(nomE ?? 'MUET').padEnd(18)}`
            + `${!aLangue && aEn ? '  ⚠️ la route de langue est MUETTE, /en répond' : ''}`
            + `${aLangue && aEn && !meme ? '  ⚠️ DEUX CARTES DIFFÉRENTES' : ''}`);
        // Les idProducts des variantes : c'est eux que la chaîne utiliserait.
        const vdL = aLangue?.variants_detailed, vdE = aEn?.variants_detailed;
        const ids = v => Array.isArray(v) ? v.map(x => x.pricing?.cardmarket?.idProduct).filter(Boolean) : [];
        if (ids(vdL).length || ids(vdE).length) {
            console.log(`        idProducts [${route}] ${JSON.stringify(ids(vdL))}  |  [en] ${JSON.stringify(ids(vdE))}`);
        }
    }

    console.log(`\n══ BILAN sur ${testees} carte(s) asiatiques distinctes ══`);
    console.log(`   la route de langue est MUETTE (donc /en prendrait le relais) : ${jaMuet}`);
    console.log(`   les deux routes rendent la MÊME carte                        : ${memeCarte}`);
    console.log(`   les deux routes rendent DEUX CARTES DIFFÉRENTES              : ${divergent}`);
    await c.close();
})().catch(e => { console.error(e.stack); process.exit(1); });
