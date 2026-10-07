// Banc des deux défauts trouvés par la relecture du 2026-10-07 (aucune base, aucun réseau) :
//   · poser-noms-fr-sets-clone.js — le témoin `fr` se lit DANS le `{{Langtable}}`, jamais dans un gabarit plus bas ;
//   · exporter-donnees-logos-site.js — le visuel d'une vedette est celui de SON numéro ; une carte à plusieurs visuels dans le set, sans
//     numéro qui en désigne un seul, n'a pas de visuel (jamais `ims[0]`) ; un prix nul n'est pas un prix.
const { frDuLangtable } = require('./poser-noms-fr-sets-clone');
const { visuelDuProduit, prixDe } = require('./exporter-donnees-logos-site');
let ok = 0, ko = 0;
const egal = (n, a, b) => { const sa = JSON.stringify(a), sb = JSON.stringify(b); if (sa === sb) ok++; else { ko++; console.log(`❌ ${n} : ${sa} ≠ ${sb}`); } };

// --- le témoin ---
const fr = w => frDuLangtable(w).map(v => v.reserve ? `${v.fr} [${v.reserve}]` : v.fr);
egal('1 simple', fr('{{Langtable|color=x|en=Base Set|fr=Set de Base|de=Grundset}}'), ['Set de Base']);
egal('2 fr d\'un AUTRE gabarit sous un Langtable sans fr', fr('{{Langtable|en=X|de=Y}}\n{{Autre|fr=Faux}}'), []);
egal('3 frname n\'est pas fr', fr('{{Langtable|frname=Faux|fr=Vrai}}'), ['Vrai']);
egal('4 lien et gras', fr("{{Langtable|fr='''[[Écarlate et Violet (JCC)|Écarlate et Violet]]'''|it=x}}"), ['Écarlate et Violet']);
egal('5 gabarit imbriqué avant fr', fr('{{Langtable|en={{tt|A|b|c}}|fr=Évolutions Célestes}}'), ['Évolutions Célestes']);
egal('6 deux Langtables qui divergent', fr('{{Langtable|fr=Un}} texte {{Langtable|fr=Deux}}'), ['Un', 'Deux']);
egal('7 deux Langtables d\'accord', fr('{{Langtable|fr=Un}} {{langtable|fr= Un }}'), ['Un']);
egal('8 aucun Langtable', fr('{{Infobox|fr=Faux}}'), []);
egal('9 commentaire retiré', fr('{{Langtable|fr=Tempête Argentée<!-- vérifié -->}}'), ['Tempête Argentée']);
egal('10 valeur encore gabaritée : illisible', fr('{{Langtable|fr={{tt|A|B}}}}'), []);
// Legendary Treasures (archive du 2026-10-07) : l'infobulle dit d'où vient le nom — elle se LIT, elle ne se jette pas
egal('10b réserve d\'infobulle', fr('{{Langtable|color=E6DC3F|fr=Trésors Légendaires {{tt|*|Pokémon Trading Card Game Online}}|de=x}}'), ['Trésors Légendaires [Pokémon Trading Card Game Online]']);
egal('10c deux infobulles : illisible', fr('{{Langtable|fr=A {{tt|*|X}} {{tt|*|Y}}}}'), []);

// --- le visuel d'une vedette ---
const im = (numero, cleR2) => ({ set: 'S', cleR2, numero });
egal('11 un seul visuel, sans numéro de fiche', visuelDuProduit([im('12', 'a')], 'S', null)?.cleR2, 'a');
egal('12 deux visuels, sans numéro de fiche : aucun', visuelDuProduit([im('12', 'a'), im('80', 'b')], 'S', null), null);
egal('13 deux visuels, numéro de fiche : le sien', visuelDuProduit([im('12', 'a'), im('80', 'b')], 'S', '080')?.cleR2, 'b');
egal('14 un visuel sans numéro + un au numéro : celui du numéro', visuelDuProduit([im(null, 'a'), im('80', 'b')], 'S', '80')?.cleR2, 'b');
egal('15 deux visuels dont un sans numéro, fiche à un autre numéro : aucun', visuelDuProduit([im(null, 'a'), im('80', 'b')], 'S', '12'), null);
egal('16 un seul visuel sans numéro, fiche numérotée : gardé', visuelDuProduit([im(null, 'a')], 'S', '12')?.cleR2, 'a');
egal('17 un seul visuel à un AUTRE numéro : aucun', visuelDuProduit([im('80', 'a')], 'S', '12'), null);
egal('18 visuel d\'un autre set : ignoré', visuelDuProduit([{ set: 'T', cleR2: 'x', numero: '12' }], 'S', '12'), null);
egal('19 SWSH061 et 061', visuelDuProduit([im('SWSH061', 'a'), im('SWSH062', 'b')], 'S', 'SWSH062')?.cleR2, 'b');

// --- le prix ---
egal('20 trend', prixDe({ trend: 4.5, avg: 3 }), { valeur: 4.5, champ: 'trend' });
egal('21 trend nul → avg', prixDe({ trend: 0, avg: 3 }), { valeur: 3, champ: 'avg' });
egal('22 rien de positif', prixDe({ trend: 0, avg: null }), null);
egal('23 aucun document', prixDe(undefined), null);

console.log(`${ko ? '🔴' : '✅'} ${ok}/${ok + ko}`);
process.exitCode = ko ? 1 : 0;
