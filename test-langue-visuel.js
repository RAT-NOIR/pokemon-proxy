// node test-langue-visuel.js — la LANGUE d'un visuel (2026-09-23).
// Bulbapedia publie le scan JAPONAIS sous le nom de fichier ANGLAIS tant que l'anglais n'est pas scanné (Evolving Skies
// montrait Eevee Heroes). Le format du fichier source PROUVE le japonais quand c'est un format du scanner japonais
// (celui des scans artofpkm) ; il ne prouve JAMAIS l'anglais — Marnie 733×1024 et Collapsed Stadium 400×558 sont des
// scans japonais dans des formats où vivent aussi des scans anglais. Cas réels, lus à l'œil sur nos copies R2.
const { langueDuVisuel, langueDeLEntree } = require('./collecte-cartes/langue-visuel');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const bulba = (w, h) => ({ source: 'bulbapedia', wOriginal: w, hOriginal: h });
const langue = im => langueDuVisuel(im).langue;

// 1. artofpkm ne sert que le japonais : par construction, sans regarder le fichier.
verifier('artofpkm → ja', langue({ source: 'artofpkm', w: 593, h: 834 }), 'ja');
// 2. Les trois formats du scanner japonais (Pinsir d'Evolving Skies = Eevee Heroes ; Guardians Rising 748×1045 4/4).
verifier('bulbapedia 868×1212 → ja', langue(bulba(868, 1212)), 'ja');
verifier('bulbapedia 748×1044 → ja', langue(bulba(748, 1044)), 'ja');
verifier('bulbapedia 748×1045 → ja', langue(bulba(748, 1045)), 'ja');
// 3. Un format anglais courant ne PROUVE pas l'anglais : null, jamais « en ».
verifier('bulbapedia 734×1024 → null (22 scans japonais artofpkm à ce format)', langue(bulba(734, 1024)), null);
verifier('bulbapedia 733×1024 → null (Marnie, scan japonais)', langue(bulba(733, 1024)), null);
verifier('bulbapedia 660×920 → null', langue(bulba(660, 920)), null);
// 4. Sans dimensions, rien ne se lit.
verifier('bulbapedia sans wOriginal → null', langue({ source: 'bulbapedia' }), null);
verifier('source inconnue → null', langue({ source: 'tcgdex', wOriginal: 868, hOriginal: 1212 }), null);
// 5. La preuve est toujours écrite, verdict ou pas.
verifier('la preuve du format nomme le format', langueDuVisuel(bulba(868, 1212)).preuve.includes('868×1212'), true);
verifier('un null porte aussi sa preuve', typeof langueDuVisuel(bulba(734, 1024)).preuve, 'string');
// 6. L'entrée de `cartes.images` reprend le verdict POSÉ sur le document `images` (un verdict lu à l'œil survit au
//    rejeu) ; sans verdict posé, elle le calcule.
verifier('entrée : verdict posé repris', langueDeLEntree({ ...bulba(733, 1024), langue: 'ja', languePreuve: 'lu à l\'œil' }), { langue: 'ja', languePreuve: 'lu à l\'œil' });
verifier('entrée : sans verdict posé, calculé', langueDeLEntree(bulba(748, 1044)).langue, 'ja');
verifier('entrée : null posé reste null', langueDeLEntree({ ...bulba(734, 1024), langue: null, languePreuve: 'x' }), { langue: null, languePreuve: 'x' });

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
