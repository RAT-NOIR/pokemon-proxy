// ============================================================
// PHASE 3a — ce que le CLONE TCGdex dit des produits SANS LIGNE (lecture seule, 0 requête : clone local)
// ============================================================
//   node mesurer-tcgdex-sans-ligne.js --clone=<clone tcgdex/cards-database> --diag=<diag-produits.json> --sortie=<fichier.json>
// `lireClone` est celui de la production (poser-cartes-tcgdex.js). Pour chaque produit SANS_LIGNE : une carte TCGdex porte-t-elle son idProduct
// (`variants[].thirdParty.cardmarket`) ? son nom anglais a-t-il une clé commune avec celui du produit (témoin : clesNom, la règle de la jointure) ?
const fs = require('fs');
const path = require('path');
const { lireClone } = require('./poser-cartes-tcgdex');
const { decomposerNomCardmarket, clesNom } = require('./collecte-cartes/jointure');
const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || null;
const CLONE = arg('clone'), DIAG = arg('diag'), SORTIE = arg('sortie');
if (!CLONE || !DIAG || !SORTIE) { console.error('usage : --clone= --diag= --sortie='); process.exit(2); }
const clone = lireClone(CLONE);
console.log(`DÉNOMINATEUR : clone ${clone.cartes.length} cartes / ${clone.sets.size} sets · racines ${[...new Set([...clone.sets.values()].map(s => s.racine))].join(',')}`);
if (!clone.cartes.length) throw new Error('clone vide');
const parId = new Map();
for (const c of clone.cartes) for (const id of c.ids) (parId.get(id) || parId.set(id, []).get(id)).push(c);
const d = JSON.parse(fs.readFileSync(DIAG, 'utf8'));
const res = {}; let nomme = 0, nommeTemoin = 0, total = 0, parExp = {};
for (const e of d) for (const p of e.produits) {
    total++;
    const cs = parId.get(p.idProduct) || [];
    if (!cs.length) { res[p.idProduct] = { nomme: false }; continue; }
    nomme++;
    const dn = decomposerNomCardmarket(p.name).nom;
    const kp = clesNom(dn);
    const ok = cs.filter(c => c.en && clesNom(c.en).some(k => kp.includes(k)));
    if (ok.length) { nommeTemoin++; parExp[e.exp] = (parExp[e.exp] || 0) + 1; }
    res[p.idProduct] = { nomme: true, cartes: cs.slice(0, 3).map(c => `${c.tcgdexId}«${c.en}»`), temoinNom: ok.length > 0, uneSeule: cs.length === 1 };
}
console.log(`SANS_LIGNE : ${total} · nommés par le clone TCGdex (idProduct) : ${nomme} · dont le nom anglais TCGdex a une clé commune avec le produit : ${nommeTemoin}`);
console.log('par expansion (nom concordant) :', JSON.stringify(Object.entries(parExp).sort((a, b) => b[1] - a[1]).slice(0, 25)));
fs.writeFileSync(SORTIE, JSON.stringify(res));
