// ============================================================
// LES FICHES AU NUMÉRO FAUX — un numéro qu'une page de carte déclare à tort, mesuré sur tout le catalogue (2026-10-06)
// ============================================================
//   node mesurer-numeros-faux.js [--json=<fichier>]        (lecture seule)
// LE SYMPTÔME : deux cartes réclament le MÊME numéro dans un set (Nihil Zero 103 : Poké Pad et Wondrous Patch). L'une des deux pages
// Bulbapedia déclare un numéro faux ; ni la fiche ni l'image ne se joignent bien (collecteur-images.js, le départage par le nom).
// DÉCISION DU TESTEUR : « corrige quand deux sources concordent, liste le reste ». Les deux sources, indépendantes de la page :
//   · CARDMARKET — le numéro du produit dont le nom (avant « [ ») est celui de la carte, dans l'expansion du set (catalogue_produits +
//     numeros_cartes) ;
//   · TCGdex — le numéro (localId) de la carte du même nom dans le set TCGdex de l'expansion (cache `tcgdex_sets`, relié par le
//     `setTcgdex` que portent nos produits Cardmarket ; aucune requête).
// Une carte est CORRIGEABLE si les deux sources donnent, pour son nom, UN SEUL numéro, le même, différent du numéro réclamé, et que ce
// numéro n'est réclamé par aucune autre carte du set. La correction s'écrit dans collecte-cartes/corrections-impressions.js (le parseur
// la rejoue : une correction en base serait défaite par la recollecte suivante, §52) — cet outil ne fait que la PROPOSER.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { cleNumero } = require('./collecte-cartes/jointure');
const AUTORISES = [/^--json=.+$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
const JSON_SORTIE = (process.argv.find(a => a.startsWith('--json=')) || '').slice(7) || null;
const plat = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\[.*$/, '').replace(/[^a-z0-9]/g, '');
const k = n => cleNumero(String(n ?? ''));

(async () => {
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ buckets: [] });
    const sets = await cx.db.collection('sets').find({ 'bulba.expansion': { $ne: null } }, { projection: { tirage: 1, region: 1, idExpansion: 1, 'bulba.expansion': 1, nomAffichage: 1 } }).toArray();
    const cartes = await cx.db.collection('cartes').find({ 'impressions.0': { $exists: true } }, { projection: { nomEn: 1, impressions: 1, 'bulba.titre': 1 } }).toArray();
    console.log(`\n════ DÉNOMINATEUR : ${cartes.length} cartes à impressions · ${sets.length} sets à nom d'expansion ════`);
    // les numéros réclamés : (tirage, expansion, numéro) → cartes
    const reclame = new Map();
    for (const c of cartes) for (const i of c.impressions) {
        if (!i || !i.expansion || !k(i.numero)) continue;
        const cle = `${i.tirage}|${i.expansion}|${k(i.numero)}`;
        (reclame.get(cle) || reclame.set(cle, new Map()).get(cle)).set(c._id, { carte: c, numero: i.numero, titre: c.bulba?.titre });
    }
    const collisions = [...reclame].filter(([, m]) => m.size > 1);
    console.log(`numéros réclamés : ${reclame.size} · par 2 cartes ou plus : ${collisions.length}`);
    const setsDe = new Map();
    for (const s of sets) for (const e of [].concat(s.bulba.expansion)) { const cle = `${s.tirage ?? s.region}|${e}`; (setsDe.get(cle) || setsDe.set(cle, []).get(cle)).push(s); }
    const exps = [...new Set(collisions.flatMap(([cle]) => (setsDe.get(cle.split('|').slice(0, 2).join('|')) || []).flatMap(s => [].concat(s.idExpansion ?? []))))];
    const cat = await prod.db.collection('catalogue_produits').find({ idExpansion: { $in: exps } }, { projection: { idProduct: 1, idExpansion: 1, name: 1 } }).toArray();
    const nc = new Map((await prod.db.collection('numeros_cartes').find({ idProduct: { $in: cat.map(c => c.idProduct) } }, { projection: { idProduct: 1, numero: 1, setTcgdex: 1 } }).toArray()).map(n => [n.idProduct, n]));
    const tcgCache = new Map((await cx.db.collection('tcgdex_sets').find({}, { projection: { cartes: 1 } }).toArray()).map(d => [d._id, d.cartes || []]));
    const lignes = [];
    for (const [cle, m] of collisions) {
        const [tirage, expansion, num] = cle.split('|');
        const S = setsDe.get(`${tirage}|${expansion}`) || [];
        const idsExp = new Set(S.flatMap(s => [].concat(s.idExpansion ?? [])));
        const produits = cat.filter(p => idsExp.has(p.idExpansion)).map(p => ({ ...p, n: nc.get(p.idProduct) }));
        const tcgIds = [...new Set(produits.map(p => p.n?.setTcgdex).filter(Boolean))];
        const langue = tirage === 'jp' ? 'ja' : tirage === 'id' || tirage === 'idth' ? 'id' : tirage === 'th' ? 'th' : 'en';
        const tcg = tcgIds.flatMap(t => tcgCache.get(`${langue}/${t}`) || []);
        const cas = [];
        for (const [id, x] of m) {
            const nomP = plat(x.carte.nomEn);
            const cm = [...new Set(produits.filter(p => plat(p.name) === nomP && p.n?.numero).map(p => k(p.n.numero)))];
            const td = [...new Set(tcg.filter(t => plat(t.name) === nomP).map(t => k(t.localId)))];
            cas.push({ carteId: id, nomEn: x.carte.nomEn, titre: x.titre, numero: x.numero, cardmarket: cm, tcgdex: td });
        }
        // une carte est corrigeable si les deux sources donnent UN numéro, le même, autre que le réclamé, et libre
        for (const c of cas) {
            const ok = c.cardmarket.length === 1 && c.tcgdex.length === 1 && c.cardmarket[0] === c.tcgdex[0] && c.cardmarket[0] !== num;
            const libre = ok && !(reclame.get(`${tirage}|${expansion}|${c.cardmarket[0]}`)?.size);
            c.verdict = ok && libre ? `CORRIGEABLE → ${c.cardmarket[0]}` : ok ? `deux sources → ${c.cardmarket[0]}, mais ce numéro est déjà réclamé` :
                c.cardmarket.length === 1 && c.cardmarket[0] === num ? 'son numéro est le bon (Cardmarket)' :
                `sources insuffisantes (Cardmarket [${c.cardmarket.join(', ')}], TCGdex [${c.tcgdex.join(', ')}]${tcg.length ? '' : ', set TCGdex inconnu'})`;
        }
        lignes.push({ tirage, expansion, numero: num, sets: S.map(s => s._id), tcg: tcgIds, cas });
    }
    const corr = lignes.flatMap(l => l.cas.filter(c => c.verdict.startsWith('CORRIGEABLE')).map(c => ({ ...c, expansion: l.expansion, tirage: l.tirage })));
    const parVerdict = {}; for (const l of lignes) for (const c of l.cas) { const v = c.verdict.replace(/\d+/g, '#').replace(/\[.*\]/, '[…]'); parVerdict[v] = (parVerdict[v] || 0) + 1; }
    console.log(`\n   verdicts, carte par carte (${lignes.reduce((s, l) => s + l.cas.length, 0)} cartes dans ${lignes.length} collisions) :`);
    for (const [v, n] of Object.entries(parVerdict).sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(5)} · ${v}`);
    console.log(`\n   🔑 CORRIGEABLES (deux sources d'accord) : ${corr.length}`);
    for (const c of corr) console.log(`      ${c.tirage}|${c.expansion} · ${c.carteId} « ${c.nomEn} » (${c.titre}) : ${c.numero} → ${c.cardmarket[0]}`);
    console.log('\n   exemples de collisions non tranchées :');
    for (const l of lignes.filter(l => !l.cas.some(c => c.verdict.startsWith('CORRIGEABLE'))).slice(0, 8)) console.log(`      ${l.tirage}|${l.expansion} n°${l.numero} : ${l.cas.map(c => `${c.carteId} « ${c.nomEn} » (${c.verdict})`).join(' / ')}`);
    if (JSON_SORTIE) require('fs').writeFileSync(JSON_SORTIE, JSON.stringify(lignes, null, 1));
    await fermer();
})().catch(e => { console.error('❌', e.message); process.exit(1); });
