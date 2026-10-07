// Banc des deux défauts trouvés par la relecture du 2026-10-07 (aucune base, aucun réseau) :
//   · poser-noms-fr-sets-clone.js — le témoin `fr` se lit DANS le `{{Langtable}}`, jamais dans un gabarit plus bas ;
//   · exporter-donnees-logos-site.js — le visuel d'une vedette est celui de SON numéro ; une carte à plusieurs visuels dans le set, sans
//     numéro qui en désigne un seul, n'a pas de visuel (jamais `ims[0]`) ; un prix nul n'est pas un prix.
const { frDuLangtable } = require('./poser-noms-fr-sets-clone');
const { visuelDuProduit, prixDe, tamponProbable, visuelAutreTirage } = require('./exporter-donnees-logos-site');
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
// relecture du 2026-10-07 (soir) : balises et entités ne font pas partie du nom
egal('10d <ref/>, <br> et entité retirés', fr("{{Langtable|fr=L&#39;Éveil des Légendes<ref name=\"a\"/><br>|de=x}}"), ["L'Éveil des Légendes"]);

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

// --- le tampon (décision de l'éditeur, 2026-10-07 : aucune illustration à texte ou tampon) — écarter à tort ne coûte qu'un rang ---
egal('24 avant-première', tamponProbable('Pikachu [Prerelease]', 'Pikachu-Prerelease'), true);
egal('25 Worlds dans le slug', tamponProbable('Charizard', 'Charizard-Worlds-2023'), true);
egal('26 Pokémon Center', tamponProbable('Pikachu (Pokémon Center)', null), true);
egal('27 Staff', tamponProbable('Mew', 'Mew-Staff'), true);
egal('28 carte ordinaire', tamponProbable('Charizard ex [Burning Darkness | Infernal Reign]', 'Charizard-ex-SVP056'), false);
egal('29 « Lumiose City » n\'est pas un tampon de ville', tamponProbable('Lumiose City', 'Lumiose-City'), false);

// --- le visuel d'un autre tirage (sets sans visuel de leur tirage : la même carte, ailleurs, en le disant) ---
const sets = new Map([['A', { _id: 'A', tirage: 'intl', region: 'intl' }], ['B', { _id: 'B', tirage: 'jp', region: 'jp' }], ['C', { _id: 'C', tirage: 'intl', region: 'intl' }], ['S', { _id: 'S', tirage: 'intl', region: 'intl' }]]);
egal('30 même tirage d\'abord', visuelAutreTirage([{ set: 'B', cleR2: 'jp', langue: 'ja' }, { set: 'C', cleR2: 'c' }], sets.get('S'), sets)?.cleR2, 'c');
egal('31 jamais un scan japonais pour un set non japonais', visuelAutreTirage([{ set: 'B', cleR2: 'jp', langue: 'ja' }], sets.get('S'), sets), null);
egal('32 jamais le set lui-même', visuelAutreTirage([{ set: 'S', cleR2: 's' }], sets.get('S'), sets), null);
egal('33 source préférée à tirage égal', visuelAutreTirage([{ set: 'A', cleR2: 'a', source: 'bulbapedia' }, { set: 'C', cleR2: 'c', source: 'tcgdex' }], sets.get('S'), sets)?.cleR2, 'c');

// --- la fiche du set (règle du SITE, importée) et le classement de secours (2026-10-07, nuit) ---
const { regleDuSite, fichesDesProduits, ordreDeSecours } = require('./exporter-donnees-logos-site');
(async () => {
    const regle = await regleDuSite();
    const set = { _id: 'S', tirage: 'jp', region: 'jp', code: 'XY', bulba: { expansion: 'Exp' } };
    const imp = numero => ({ tirage: 'jp', expansion: 'Exp', numero });
    const prod = (idProduct, carteId, slug, numeroFiche = null) => ({ idProduct, carteId, slug, numeroFiche });
    const f = (docs, produits) => Object.fromEntries([...fichesDesProduits(regle, set, docs, produits).fiche].map(([k, v]) => [k, v.numero]));
    // le cas signalé par le site : une impression du set SANS numéro (Expansion Pack) — sa fiche « n° ? » garde ses produits
    egal('34 impression sans numéro : le produit reste sur la fiche n° ?', f([{ _id: 1, impressions: [imp(null)] }], [prod(10, 1, 'Charizard', '4')]), { 10: null });
    egal('35 aucune impression du set : fiche sans numéro, produit gardé', f([{ _id: 1, impressions: [] }], [prod(10, 1, 'Charizard')]), { 10: null });
    egal('36 un numéro lu après le code qui CONTREDIT la fiche : détaché', f([{ _id: 1, impressions: [imp('4')] }], [prod(10, 1, 'Pikachu-XY104')]), {});
    egal('37 deux impressions : chaque produit sur la sienne', f([{ _id: 1, impressions: [imp('4'), imp('104')] }], [prod(10, 1, 'Pikachu-XY4'), prod(11, 1, 'Pikachu-XY104')]), { 10: '4', 11: '104' });
    egal('38 le produit d\'une carte hors des documents du set : aucune fiche', f([{ _id: 1, impressions: [imp(null)] }], [prod(10, 2, 'Charizard')]), {});
    const e = (rarete, numero, idProduct) => ({ rarete, numero, idProduct });
    egal('39 secours : rareté décroissante, puis numéro', [e(null, '2', 1), e('SR', '9', 2), e('HR', '50', 3), e('SR', '3', 4), e(null, '10', 5)].sort(ordreDeSecours).map(x => x.idProduct), [3, 4, 2, 1, 5]);
    egal('40 une rareté hors table se range avec « sans rareté »', [e('XYZ', '5', 1), e(null, '3', 2), e('RR', '9', 3)].sort(ordreDeSecours).map(x => x.idProduct), [3, 2, 1]);
    egal('41 sans numéro après les numérotées', [e(null, null, 1), e(null, '7', 2)].sort(ordreDeSecours).map(x => x.idProduct), [2, 1]);
    // (relecture) la garde de langue du SITE avant le choix du visuel : un scan artofpkm (japonais) ne sert jamais un set intl
    const admisIntl = m => regle.visuelAdmisPourLaRegion(m, 'intl');
    egal('42 un scan japonais d\'artofpkm sur un set intl : aucun visuel', visuelDuProduit([{ set: 'S', cleR2: 'artofpkm/6/15.webp', numero: '12', w: 600, h: 825 }], 'S', '12', { admis: admisIntl }), null);
    egal('43 le même visuel sur un set jp : admis', visuelDuProduit([{ set: 'S', cleR2: 'artofpkm/6/15.webp', numero: '12', w: 600, h: 825 }], 'S', '12', { admis: m => regle.visuelAdmisPourLaRegion(m, 'jp') })?.cleR2, 'artofpkm/6/15.webp');
    egal('44 « TG05 » et « TG5 » ne sont pas le même numéro pour le site', visuelDuProduit([im('TG5', 'a'), im('TG05', 'b')], 'S', 'TG05', { normaliser: regle.normaliserNumero })?.cleR2, 'b');
    console.log(`${ko ? '🔴' : '✅'} ${ok}/${ok + ko}`);
    process.exitCode = ko ? 1 : 0;
})().catch(err => { console.error(err); process.exitCode = 1; });
