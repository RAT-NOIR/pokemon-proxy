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

// ── les lignes ─────────────────────────────────────────────────────────────────────────────────────────────────────────
verifier('une ligne par deck, sur l\'hôte d\'images, serveur clb / clv / clc, segment [[1, 34]]', brutes.map(([, id, l]) => [l?.id, l?.hote, l?.idServeur, JSON.stringify(l?.segments)]), DECKS.map(([, id]) => [id, HOTE, id, '[[1,34]]']));
verifier('INACTIVES : lu vaut null (aucun témoin regardé)', brutes.map(([, , l]) => (l ? l.lu : 'ligne absente')), [null, null, null]);
verifier('inactive = non prouvée : verdictDuSet « non-apparie », aucune ligne servie', DECKS.map(([s]) => [P.verdictDuSet(s).verdict, P.lignesDe(s).length]), DECKS.map(() => ['non-apparie', 0]));
verifier('SETS_SCRYDEX porte les quatre serveurs (une décision : le client PEUT les demander) mais aucune ligne active ne les adresse', [[...P.SETS_SCRYDEX], P.urlScrydex('clb-10')], [['me55c', 'clb', 'clv', 'clc'], `https://${HOTE}/pokemon/clb-10/large`]);
const trou = (slug, nom, numeroCm, idProduct) => ({ slug, trous: [{ carte: { _id: idProduct + 1000, nomEn: nom, images: [] }, numeroFiche: null, numeroCm, idProduct }] });
verifier('inactive : un trou n\'obtient aucune adresse (reste « non-apparie »)', (() => { const r = P.planifierPtcgio(trou(DECKS[0][0], 'Suicune ex', '010', 745736)); return [r.plan.length, r.restes[0]?.motif]; })(), [0, 'non-apparie']);

// ── ACTIVÉE (copie du banc : on pose lu, comme le coordinateur le fera après avoir REGARDÉ les témoins) : l'adresse est celle du serveur d'images, jamais celle de l'autre hôte ──────
{
    const activee = { ...brutes[0][2], lu: '2026-10-17' };
    const r = P.planifierPtcgio({ ...trou(DECKS[0][0], 'Suicune ex', '010', 745736), lignes: [activee] });
    verifier('activée : Suicune ex n°010 → /pokemon/clb-10/large du serveur d\'images', [r.plan.length, r.plan[0]?.url, r.plan[0]?.n], [1, `https://${HOTE}/pokemon/clb-10/large`, 10]);
    const r35 = P.planifierPtcgio({ ...trou(DECKS[0][0], 'Basic Water Energy', '035', 1), lignes: [activee] });
    verifier('activée : le n° 35 (hors du segment [1, 34]) reste un trou nommé', [r35.plan.length, r35.restes[0]?.motif], [0, 'non-couvert-par-un-temoin']);
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
