// node test-scrydex-decks-lignes.js — les lignes TABLE_PTCGIO des trois decks TCG Classic (clb, clv, clc), INACTIVES tant que les témoins ne sont pas regardés (`lu: null`),
// et le plan de TÉMOINS de la sonde (3 par set : n° 1, milieu, n° 34 ; 9 adresses). Une ligne inactive ne prouve rien : verdict « non-apparie », aucun plan, aucune adresse autorisée.
const fs = require('fs');
const P = require('./collecte-cartes/ptcgio');
const S = require('./sonde-scrydex-decks');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const HOTE = P.HOTE_SCRYDEX_NOM;
const DECKS = [['Pokemon-Trading-Card-Game-Classic-Blastoise-Suicune-ex-Deck', 'clb'], ['Pokemon-Trading-Card-Game-Classic-Venusaur-Lugia-ex-Deck', 'clv'], ['Pokemon-Trading-Card-Game-Classic-Charizard-Ho-Oh-ex-Deck', 'clc']];
const brutes = DECKS.map(([slug, id]) => [slug, id, P.TABLE_PTCGIO.find(l => l.slug === slug)]);

// ── les lignes : ACTIVES depuis le 2026-10-17 (12 témoins REGARDÉS par le coordinateur : 9 de la sonde des témoins + les 3 de la première sonde) ──────────────────────────────────
const TEMOINS_VUS = {
    clb: [[1, 'Squirtle', '001/034'], [10, 'Suicune ex', '010/034'], [17, 'Kangaskhan', '017/034'], [34, 'Psychic Energy', '034/034']],
    clv: [[1, 'Bulbasaur', '001/034'], [16, 'Snorlax', '016/034'], [17, 'Lugia ex', '017/034'], [34, 'Fighting Energy', '034/034']],
    clc: [[1, 'Charmander', '001/034'], [7, 'Ho-Oh ex', '007/034'], [17, 'Miltank Lv.32', '017/034'], [34, 'Lightning Energy', '034/034']]
};
verifier('une ligne par deck, sur l\'hôte d\'images, serveur clb / clv / clc, segment [[1, 34]]', brutes.map(([, id, l]) => [l?.id, l?.hote, l?.idServeur, JSON.stringify(l?.segments)]), DECKS.map(([, id]) => [id, HOTE, id, '[[1,34]]']));
verifier('ACTIVES : lu = 2026-10-17', brutes.map(([, , l]) => (l ? l.lu : 'ligne absente')), ['2026-10-17', '2026-10-17', '2026-10-17']);
verifier('les 12 témoins regardés (4 par deck : n°, nom, numéro imprimé /034), dont n° 1 et n° 34', brutes.map(([, id, l]) => (l ? l.temoins.map(w => [w.n, w.nom, w.imprime]) : null)), DECKS.map(([, id]) => TEMOINS_VUS[id]));
verifier('prouvées : verdictDuSet « prouve », une ligne servie par deck', DECKS.map(([s, id]) => [P.verdictDuSet(s).verdict, P.lignesDe(s).map(l => l.id).join()]), DECKS.map(([, id]) => ['prouve', id]));
verifier('SETS_SCRYDEX porte les quatre serveurs', [[...P.SETS_SCRYDEX], P.urlScrydex('clb-10')], [['me55c', 'clb', 'clv', 'clc'], `https://${HOTE}/pokemon/clb-10/large`]);
// 🔑 la garde `lu` exige une DATE AAAA-MM-JJ réelle, pas toute chaîne non vide
verifier('ligneActive : une date ISO oui ; null, vide, « oui », « 17/10/2026 », « 2026-13-40 », un nombre non', [P.ligneActive({ lu: '2026-10-17' }), P.ligneActive({ lu: null }), P.ligneActive({ lu: '' }), P.ligneActive({ lu: 'oui' }), P.ligneActive({ lu: '17/10/2026' }), P.ligneActive({ lu: '2026-13-40' }), P.ligneActive({ lu: 20261017 }), P.ligneActive({})], [true, false, false, false, false, false, false, false]);
verifier('une ligne à lu non daté est écartée par lignesDe (jamais « prouvée »)', P.TABLE_PTCGIO.filter(l => !P.ligneActive(l)).every(l => !P.lignesDe(l.slug).includes(l)), true);
const trou = (slug, nom, numeroCm, idProduct) => ({ slug, trous: [{ carte: { _id: idProduct + 1000, nomEn: nom, images: [] }, numeroFiche: null, numeroCm, idProduct }] });
{
    const r = P.planifierPtcgio(trou(DECKS[0][0], 'Suicune ex', '010', 745736));
    verifier('Suicune ex n°010 → /pokemon/clb-10/large du serveur d\'images', [r.plan.length, r.plan[0]?.url, r.plan[0]?.n], [1, `https://${HOTE}/pokemon/clb-10/large`, 10]);
    verifier('la preuve nomme l\'hôte d\'images et la marque, pas l\'autre hôte', [/images\.scrydex\.com set clb/.test(r.plan[0]?.preuve || ''), /pokemontcg/.test(r.plan[0]?.preuve || '')], [true, false]);
    const r35 = P.planifierPtcgio(trou(DECKS[0][0], 'Basic Water Energy', '035', 1));
    verifier('le n° 35 (hors du segment [1, 34]) reste un trou nommé', [r35.plan.length, r35.restes[0]?.motif], [0, 'non-couvert-par-un-temoin']);
    const r34 = P.planifierPtcgio(trou(DECKS[1][0], 'Basic Fighting Energy', '034', 745692));
    verifier('le n° 34 (Venusaur) → /pokemon/clv-34/large', r34.plan[0]?.url, `https://${HOTE}/pokemon/clv-34/large`);
}
// ── le plan de TÉMOINS ─────────────────────────────────────────────────────────────────────────────────────────────────
const tem = S.construirePlan('temoins');
const parSlug = new Map();
for (const s of tem.sondes) { if (!parSlug.has(s.slug)) parSlug.set(s.slug, []); parSlug.get(s.slug).push(s); }
verifier('témoins : mode « temoins », 9 adresses, 3 par deck, aucun My First Battle', [tem.mode, tem.sondes.length, [...parSlug.values()].map(l => l.length), parSlug.has('My-First-Battle')], ['temoins', 9, [3, 3, 3], false]);
verifier('témoins : n° 1, un milieu, n° 34 pour chaque deck', DECKS.map(([s]) => { const l = parSlug.get(s).map(x => x.n); return [l[0], l[1] > 1 && l[1] < 34, l[2]]; }), DECKS.map(() => [1, true, 34]));
verifier('témoins : chaque adresse est l\'identifiant du deck, son numéro, et la carte attendue (nom, idProduct, numéro Cardmarket) est connue', tem.sondes.every(s => s.url === `https://${HOTE}/pokemon/${s.id}-${s.n}/large` && DECKS.some(([sl, id]) => sl === s.slug && id === s.id) && s.carteAttendue && s.carteAttendue.nom && s.carteAttendue.idProduct && Number(s.carteAttendue.numeroCm) === s.n), true);
verifier('témoins : le plan passe la validation', (() => { try { return S.validerPlan(tem); } catch (e) { return e.message; } })(), true);
verifier('témoins : le fichier sonde-temoins-plan.json EST le plan construit', JSON.parse(fs.readFileSync('C:/Users/Yung/rat-market-travail/catalogue/couverture/S7/SCRYDEX-DECKS/sonde-temoins-plan.json', 'utf8')), JSON.parse(JSON.stringify(tem)));
const refus = (nom, muter) => { const p = JSON.parse(JSON.stringify(tem)); muter(p); let m = null; try { S.validerPlan(p); } catch (e) { m = e.message; } verifier(`témoins, validation : ${nom}`, m !== null, true); };
refus('un 4e numéro pour un deck', p => p.sondes.push({ ...p.sondes[0], n: 5, url: `https://${HOTE}/pokemon/${p.sondes[0].id}-5/large` }));
refus('un identifiant qui n\'est pas celui du deck', p => { p.sondes[0].id = 'clv'; p.sondes[0].url = `https://${HOTE}/pokemon/clv-${p.sondes[0].n}/large`; });
refus('un numéro hors 1–34', p => { p.sondes[0].n = 35; p.sondes[0].url = `https://${HOTE}/pokemon/${p.sondes[0].id}-35/large`; });
refus('deux fois la même adresse', p => { p.sondes[1] = { ...p.sondes[0] }; });
refus('My First Battle n\'a pas de témoins numérotés', p => { p.sondes[0].slug = 'My-First-Battle'; });
refus('un mode inconnu', p => { p.mode = 'tout'; });

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
