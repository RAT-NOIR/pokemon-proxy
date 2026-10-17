// BANC-ABSENTS-2 (2026-10-17) : Palkia Lv.67 (698733) du Palkia LV.X Constructed Standard Deck (DP3p).
// artofpkm 158/4 et 158/5 se nomment toutes deux « Palkia » : le nom seul les poserait toutes les deux sur la carte Lv.67 (32017).
// Lues à l'œil : 158/4 = Lv.67 (Spacial Rend / Transback, DPBP#523, Illus. Daisuke Ito) ; 158/5 = LV.X (Hydro Reflect, Illus. Ryo Ueda).
const { correctionDe, CORRECTIONS } = require('./collecte-cartes/corrections-images');
let ko = 0;
const ok = (nom, cond) => { if (!cond) { ko++; console.error('ECHEC :', nom); } else console.log('ok :', nom); };
const a = correctionDe('artofpkm/158/4.webp'), b = correctionDe('artofpkm/158/5.webp');
ok('158/4 -> carte 32017 (Palkia Lv.67)', !!a && a.carteId === 32017 && a.nomEn === 'Palkia' && /LV\.67/.test(a.lu) && a.le === '2026-10-17');
ok('158/5 -> carte 36174 (Palkia LV.X)', !!b && b.carteId === 36174 && b.nomEn === 'Palkia LV.X' && /LV\.X/.test(b.lu) && b.le === '2026-10-17');
ok('une seule correction par fichier', new Set(CORRECTIONS.map(c => c.cleR2)).size === CORRECTIONS.length);
process.exit(ko ? 1 : 0);
