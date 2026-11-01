'use strict';
// GUICHET (tour 2, I3b) — la preuve DURCIE (cosinus non contraire) rejouée sur les mesures déjà prises (t8-preuve.json : fenêtre ORB + cosinus de chaque paire) avec le module du dépôt. Aucune image relue.
// Sorties : la liste fermée durcie (tamponnees-empruntees-2026-11-01d.json), le détail des produits qui SORTENT, les totaux par famille.
const fs = require('fs'), path = require('path');
const P = require('C:\\Users\\Yung\\rat-market-travail\\api\\v2-guichet\\v2\\mesures\\preuve-emprunt');
const ARCH = 'C:\\Users\\Yung\\rat-market-travail\\api\\archives\\';
const t8 = JSON.parse(fs.readFileSync(path.join(__dirname, 't8-preuve.json'), 'utf8'));
const t1 = new Map(JSON.parse(fs.readFileSync(path.join(__dirname, 't1-refuses.json'), 'utf8')).map(r => [r.idProduct, r]));
const avant = t8.filter(r => r.classe === 'meme'), res = t8.map(r => ({ ...r, nouveau: P.classerAvecTroisieme(r.mesures.map(m => ({ ...m }))) }));
const apres = res.filter(r => r.nouveau.classe === 'meme');
const fam = r => r.refus + (/^Trick/.test(r.set) ? ' (ToT)' : '');
const T = {}; for (const r of res) { const k = fam(r) + ' | ' + r.nouveau.classe + ' / ' + r.nouveau.detail; T[k] = (T[k] || 0) + 1; }
console.log('avant (preuve du passage 8)', avant.length, '| après (durcie)', apres.length);
const F0 = {}, F1 = {}; for (const r of avant) F0[fam(r)] = (F0[fam(r)] || 0) + 1; for (const r of apres) F1[fam(r)] = (F1[fam(r)] || 0) + 1; console.log('par famille avant', JSON.stringify(F0), '| après', JSON.stringify(F1));
const sortent = avant.filter(r => !apres.some(a => a.idProduct === r.idProduct));
console.log('produits qui SORTENT (' + sortent.length + ') :');
for (const r of sortent) { const rf = t1.get(r.idProduct); const contraires = r.mesures.filter(m => m.cos !== null && m.cos < 0.7).map(m => `fen ${m.fen} cos ${m.cos}`); console.log(`  ${r.idProduct} · ${r.set} · n° ${rf && rf.numeroFiche} · ${fam(r)} · refs ${r.mesures.length} · au cosinus contraire : ${contraires.slice(0, 3).join(' ; ')}${contraires.length > 3 ? ' (+' + (contraires.length - 3) + ')' : ''}`); }
const nouveaux = apres.filter(r => !avant.some(a => a.idProduct === r.idProduct)); console.log('produits ENTRÉS par le durcissement (devrait être 0) :', nouveaux.length);
// variante « cosinus inconnu refuse » (la lecture la plus sévère), pour information : combien des admis ne tiennent que par des références SANS cosinus
const sansCos = apres.filter(r => r.mesures.some(m => m.cos === null)); console.log('parmi les admis durcis, produits dont au moins une référence n\'a pas de cosinus (scan absent de l\'index) :', sansCos.length, '| ids', sansCos.map(r => r.idProduct).join(','));
console.log('ventilation', JSON.stringify(Object.entries(T).sort(), null, 0));
const liste = apres.map(r => ({ idProduct: r.idProduct, preuve: `${r.nouveau.sous} (fenêtre >= 30 inliers ou cosinus >= 0,9, ET aucun cosinus < 0,7 ; preuve-emprunt.js)` })).sort((a, b) => a.idProduct - b.idProduct);
fs.writeFileSync(ARCH + 'tamponnees-empruntees-2026-11-01d.json', JSON.stringify({ decision: 'GUICHET 01/11 tour 2 : tamponnées empruntées, preuve DURCIE (cosinus non contraire)', le: '2026-11-01', produits: liste }, null, 1));
fs.writeFileSync(path.join(__dirname, 't14-sortants.json'), JSON.stringify(sortent.map(r => ({ idProduct: r.idProduct, set: r.set, famille: fam(r) }))));
console.log('liste fermée durcie :', liste.length);
