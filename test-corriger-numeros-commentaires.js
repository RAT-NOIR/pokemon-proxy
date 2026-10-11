// TEST — corriger-numeros-commentaires.js : planification pure et écritures sur une FAUSSE base. Aucun réseau, aucune base.
const { CIBLES, planifier, appliquer } = require('./corriger-numeros-commentaires');
const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) ok++; else { ko++; console.log(`  ✗ ${nom}\n     obtenu  ${a}\n     attendu ${b}`); }
};
const [ODDISH, PARADISE] = CIBLES;
const page = (cible, noteJp) => `{{PokémoncardInfobox\n|cardname=${cible.nomEn}\n|evostage=Basic\n}}\n{{PokémoncardInfobox/Expansion\n|type=Grass\n|expansion={{TCG|${cible.expansion}}}\n|cardno=${cible.corrompu}${noteJp}\n}}`;
const PAGE_O = page(ODDISH, '\n|jpexpansion={{TCG|SV-P Promotional cards}}\n|jpcardno=???/SV-P-->');
const PAGE_P = page(PARADISE, '\n|jpexpansion={{TCG|M-P Promotional cards}}-->');
const carteO = () => ({
    _id: 295618, nomEn: 'Oddish', sets: [ODDISH.set],
    impressions: [{ tirage: 'intl', expansion: ODDISH.expansion, numero: '102<!--', total: null, illustrateurPreuve: 'aucune carte n° 102<!--' },
        { tirage: 'jp', expansion: 'SV-P Promotional cards', numero: '???', total: 'SV-P-->' }],
    images: [{ set: ODDISH.set, cleR2: 'a.webp', numero: '102<!--', vignette: { cleR2: 'v.webp' } }]
});
const imgsO = () => [{ _id: 'bulbapedia/SV-Black-Star-Promos/295618/102', carteId: 295618, set: ODDISH.set, numero: '102<!--' }];

// 1. cas nominal : la carte corrigée, rien d'autre ne bouge, le fantôme est listé et gardé
const p1 = planifier(ODDISH, { carte: carteO(), images: imgsO(), texte: PAGE_O });
verifier('Oddish : pas de refus', p1.refus, null);
verifier('Oddish : numéro neuf', p1.neuf, '102');
verifier('Oddish : impression intl corrigée', p1.carteApres.impressions[0].numero, '102');
verifier('Oddish : illustrateurPreuve intact', p1.carteApres.impressions[0].illustrateurPreuve, 'aucune carte n° 102<!--');
verifier('Oddish : le fantôme n\'est PAS retiré', p1.carteApres.impressions.length, 2);
verifier('Oddish : fantôme jp listé', p1.fantomes.map(f => f.expansion), ['SV-P Promotional cards']);
verifier('Oddish : image corrigée, vignette gardée', [p1.carteApres.images[0].numero, p1.carteApres.images[0].vignette.cleR2], ['102', 'v.webp']);
verifier('Oddish : la garde ne voit aucune baisse', comparer(compterEtat({ cartes: [carteO()] }), compterEtat({ cartes: [p1.carteApres] })).baisses, []);

// 2. Paradise Resort : zéro initial gardé (092)
const carteP = () => ({ _id: 294172, nomEn: 'Paradise Resort', sets: [PARADISE.set],
    impressions: [{ tirage: 'intl', expansion: PARADISE.expansion, numero: '092<!--' }, { tirage: 'intl', expansion: 'SVP Black Star Promos', numero: '045' }],
    images: [{ set: PARADISE.set, numero: '092<!--' }, { set: 'SV-Black-Star-Promos', numero: '045' }] });
const p2 = planifier(PARADISE, { carte: carteP(), images: [{ carteId: 294172, set: PARADISE.set, numero: '092<!--' }], texte: PAGE_P });
verifier('Paradise : numéro neuf', p2.neuf, '092');
verifier('Paradise : l\'autre set intact', p2.carteApres.images[1].numero, '045');

// 3. refus : tout état qui n'est pas exactement l'attendu
const refus = (nom, etat, cible = ODDISH) => verifier(nom, !!planifier(cible, etat).refus, true);
refus('refus : carte absente', { carte: null, images: imgsO(), texte: PAGE_O });
refus('refus : mauvais nom', { carte: { ...carteO(), nomEn: 'Autre' }, images: imgsO(), texte: PAGE_O });
refus('refus : numéro déjà propre en base', { carte: { ...carteO(), impressions: [{ tirage: 'intl', expansion: ODDISH.expansion, numero: '102' }] }, images: imgsO(), texte: PAGE_O });
refus('refus : deux impressions corrompues', { carte: { ...carteO(), impressions: [...carteO().impressions, { tirage: 'intl', expansion: ODDISH.expansion, numero: '102<!--' }] }, images: imgsO(), texte: PAGE_O });
refus('refus : image corrompue absente', { carte: { ...carteO(), images: [] }, images: imgsO(), texte: PAGE_O });
refus('refus : document images absent', { carte: carteO(), images: [], texte: PAGE_O });
refus('refus : page illisible', { carte: carteO(), images: imgsO(), texte: null });
refus('refus : le parseur ne lit pas l\'expansion', { carte: carteO(), images: imgsO(), texte: '{{PokémoncardInfobox\n|cardname=Oddish\n}}' });
refus('refus : valeur lue pas propre (page sans cardno)', { carte: carteO(), images: imgsO(), texte: PAGE_O.replace(/\|cardno=102<!--[\s\S]*?-->/, '|cardno=') });
refus('refus : valeur lue sans rapport avec la corrompue', { carte: carteO(), images: imgsO(), texte: PAGE_O.replace('cardno=102', 'cardno=777') });

// 4. la liste est fermée : deux cartes, Unown « ! » n'y est pas
verifier('liste fermée', CIBLES.map(c => c.id), [295618, 294172]);

// 5. écritures sur une fausse base : filtres bornés à la valeur corrompue
const appels = [];
const fausse = { collection: nom => ({
    updateOne: async (f, u, o) => { appels.push([nom, 'updateOne', f, u, o]); return { modifiedCount: 1 }; },
    updateMany: async (f, u) => { appels.push([nom, 'updateMany', f, u]); return { modifiedCount: 1 }; } }) };
(async () => {
    const r = await appliquer(fausse, ODDISH, '102');
    verifier('écritures : compte', r, { cartes: 1, images: 1 });
    verifier('écritures : seulement cartes puis images', appels.map(a => a[0]), ['cartes', 'images']);
    verifier('écritures : filtre cartes par _id', appels[0][2], { _id: 295618 });
    verifier('écritures : seuls des champs numero', Object.keys(appels[0][3].$set), ['impressions.$[i].numero', 'images.$[m].numero']);
    verifier('écritures : arrayFilters bornés à la valeur corrompue', appels[0][4].arrayFilters.map(f => Object.values(f).includes('102<!--')), [true, true]);
    verifier('écritures : images filtré par la valeur corrompue', appels[1][2], { carteId: 295618, set: ODDISH.set, numero: '102<!--' });
    console.log(`${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
