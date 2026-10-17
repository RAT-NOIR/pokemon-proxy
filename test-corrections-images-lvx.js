// VIGN-AUDIT (2026-10-17) : huit fichiers artofpkm « LV.X » étaient aussi joints à la carte de BASE du même nom (le nom seul ne les distingue pas).
// Chaque fichier doit être attribué à SA carte LV.X par une correction lue à l'œil (illustrateur du fichier = celui de l'impression LV.X, image lue « LV.X »).
const { correctionDe, CORRECTIONS } = require('./collecte-cartes/corrections-images');
let ko = 0;
const ok = (nom, cond) => { if (!cond) { ko++; console.error('ECHEC :', nom); } else console.log('ok :', nom); };
const ATTENDU = {
    'artofpkm/171/43.webp': 50326, 'artofpkm/171/42.webp': 50859, 'artofpkm/150/23.webp': 26230, 'artofpkm/166/38.webp': 28217,
    'artofpkm/166/19.webp': 41644, 'artofpkm/166/5.webp': 41758, 'artofpkm/172/34.webp': 50209, 'artofpkm/164/39.webp': 36172
};
for (const [cle, id] of Object.entries(ATTENDU)) {
    const c = correctionDe(cle);
    ok(`${cle} -> carte ${id}`, !!c && c.carteId === id && /LV\.X$/.test(c.nomEn) && typeof c.lu === 'string' && c.lu.length > 5 && /^2026-10-17$/.test(c.le));
}
ok('une seule correction par fichier', new Set(CORRECTIONS.map(c => c.cleR2)).size === CORRECTIONS.length);
process.exit(ko ? 1 : 0);
