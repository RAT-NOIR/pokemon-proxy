'use strict';
const DONNEES = 'C:\\Users\\Yung\\rat-market-travail\\api\\archives\\essais-repli';      // dossier des données de mesure (hors dépôt)
// GUICHET (tour 3) — la liste fermée FINALE : t8-preuve.json (fenêtre ORB + cosinus de l'index) + t16-cosinus.json (les cosinus MANQUANTS, calculés avec le modèle de l'index) classés par le module du dépôt, règle : un cosinus
// inconnu REFUSE, un cosinus < 0,7 refuse, l'une des deux jambes (fenêtre >= 30 ou cosinus >= 0,9) doit tenir contre CHAQUE autre scan. Sorties : tamponnees-empruntees-2026-11-01e.json, t17-sortants.json (tous les produits sortis depuis la
// preuve du passage 8, avec la raison et les cosinus contraires), les totaux par famille.
const fs = require('fs'), path = require('path');
const P = require('C:\\Users\\Yung\\rat-market-travail\\api\\v2-guichet\\v2\\mesures\\preuve-emprunt');
const ARCH = 'C:\\Users\\Yung\\rat-market-travail\\api\\archives\\';
const t8 = JSON.parse(fs.readFileSync(path.join(DONNEES, 't8-preuve.json'), 'utf8'));
const t1 = new Map(JSON.parse(fs.readFileSync(path.join(DONNEES, 't1-refuses.json'), 'utf8')).map(r => [r.idProduct, r]));
const t16 = JSON.parse(fs.readFileSync(path.join(DONNEES, 't16-cosinus.json'), 'utf8'));
const fam = r => r.refus + (/^Trick/.test(r.set) ? ' (ToT)' : '');
const remplis = t8.map(r => {
    const f = t16.res[r.idProduct]; if (!f || !f.refs) return r;
    const parCle = new Map(f.refs.map(x => [x.cle, x.cos]));
    return { ...r, mesures: r.mesures.map(m => (m.cos === null && parCle.get(m.cle) != null ? { ...m, cos: parCle.get(m.cle), cosCalcule: true } : m)) };
});
const res = remplis.map(r => ({ ...r, nouveau: P.classerAvecTroisieme(r.mesures.map(m => ({ ...m }))) }));
const passage8 = t8.filter(r => r.classe === 'meme'), finale = res.filter(r => r.nouveau.classe === 'meme');
const F8 = {}, FF = {}; for (const r of passage8) F8[fam(r)] = (F8[fam(r)] || 0) + 1; for (const r of finale) FF[fam(r)] = (FF[fam(r)] || 0) + 1;
console.log('prouvés au passage 8 :', passage8.length, JSON.stringify(F8)); console.log('prouvés (finale) :', finale.length, JSON.stringify(FF));
const entres = finale.filter(r => !passage8.some(a => a.idProduct === r.idProduct)); console.log('entrés (devrait être 0) :', entres.length);
const sortis = passage8.filter(r => !finale.some(a => a.idProduct === r.idProduct)).map(r => {
    const apres = res.find(x => x.idProduct === r.idProduct), rf = t1.get(r.idProduct);
    const contraires = apres.mesures.filter(m => m.cos !== null && m.cos < 0.7).map(m => ({ cle: m.cle, fen: m.fen, cos: m.cos, calcule: Boolean(m.cosCalcule) }));
    const inconnus = apres.mesures.filter(m => m.cos === null).length;
    return { idProduct: r.idProduct, set: r.set, numeroFiche: rf ? rf.numeroFiche : null, famille: fam(r), imageRefusee: rf && rf.im.cleR2, contraires, cosinusInconnus: inconnus, raison: contraires.length ? 'cosinus contraire' : inconnus ? 'cosinus inconnu non calculable' : apres.nouveau.sous };
});
console.log('sortis depuis le passage 8 :', sortis.length); for (const s of sortis) console.log(`  ${s.idProduct} · ${s.set} · n° ${s.numeroFiche} · ${s.famille} · ${s.raison}${s.contraires.length ? ' ' + s.contraires.slice(0, 2).map(c => `(fen ${c.fen}, cos ${c.cos}${c.calcule ? ' calculé' : ''})`).join(' ') : ''}`);
const sansCos = finale.filter(r => r.mesures.some(m => m.cos === null)); console.log('prouvés dont une référence est sans cosinus (devrait être 0) :', sansCos.length);
const calcules = finale.filter(r => r.mesures.some(m => m.cosCalcule)).map(r => r.idProduct); console.log('prouvés grâce à un cosinus CALCULÉ :', calcules.length, calcules.join(','));
const liste = finale.map(r => ({ idProduct: r.idProduct, preuve: `${r.nouveau.sous} (cosinus connu et >= 0,7 contre chaque scan, fenêtre >= 30 inliers ou cosinus >= 0,9 ; preuve-emprunt.js${r.mesures.some(m => m.cosCalcule) ? ' ; cosinus manquant calculé avec le modèle de l\'index' : ''})` })).sort((a, b) => a.idProduct - b.idProduct);
fs.writeFileSync(ARCH + 'tamponnees-empruntees-2026-11-01e.json', JSON.stringify({ decision: 'GUICHET 01/11 tour 3 : tamponnées empruntées, un cosinus inconnu refuse', le: '2026-11-01', produits: liste }, null, 1));
fs.writeFileSync(path.join(DONNEES, 't17-sortants.json'), JSON.stringify(sortis));
console.log('liste fermée finale :', liste.length);
