// node test-appliquer-plan.js — appliquer des PLANS de lot (les fichiers que les outils de pose écrivent avec `--plan=`) à un état lu, EN MÉMOIRE : fonction pure, aucune base.
// Une seule définition de « l'état après un lot » (§21 bis) : simuler-lot-api.js (la chaîne de l'API) et simuler-abc.js (les compteurs A, B, C) s'en servent.
const { appliquerPlans } = require('./collecte-cartes/appliquer-plan');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

const cartes = [{ _id: 10, nomEn: 'Pikachu', sets: ['A'], impressions: [{ tirage: 'intl', expansion: 'Set A', numero: '007' }] }, { _id: 11, nomEn: 'Mew', sets: [], impressions: [] }];
const lignes = [{ _id: '10|1', carteId: 10, idProduct: 1, idExpansion: 100 }];
const avant = JSON.stringify({ cartes, lignes });

const plan = {
    cartes: [{ _id: -5, nomEn: 'Eevee', sets: ['B'], attaques: [{ nom: 'Tackle' }], impressions: [{ tirage: 'jp', expansion: 'Set B', numero: '12' }] }],
    lignes: [
        { _id: '-5|5', carteId: -5, idProduct: 5, idExpansion: 200, numeroFiche: '12', slugSet: 'B', slug: null },
        { _id: '10|1', carteId: 10, idProduct: 1, idExpansion: 100 },                  // déjà là : non touchée
        { _id: '11|2', carteId: 11, idProduct: 2, idExpansion: 300, slugSet: 'C' }
    ],
    cartesSets: [{ carteId: 11, set: 'C' }, { carteId: 11, set: 'C' }, { carteId: 10, set: 'A' }],
    impressions: [{ carteId: 11, imp: { tirage: 'intl', expansion: 'Set C', numero: '9' } }, { carteId: 10, imp: { tirage: 'intl', expansion: 'Set A', numero: '7' } }]
};
const R = appliquerPlans({ cartes, cartesProduits: lignes }, [plan]);
verifier('une fiche simple du plan entre comme carte (nom, sets, attaques, impressions) et sans image', R.cartes.find(c => c._id === -5), { _id: -5, nomEn: 'Eevee', sets: ['B'], attaques: [{ nom: 'Tackle' }], impressions: [{ tirage: 'jp', expansion: 'Set B', numero: '12', total: null, deck: null, rarete: null }], images: [] });
verifier('lignes ajoutées : seulement celles dont l\'_id est nouveau', R.ajoutees.map(l => l._id), ['-5|5', '11|2']);
verifier('une ligne déjà présente est comptée à part, non touchée', R.dejaLa.map(l => l._id), ['10|1']);
verifier('la ligne ajoutée porte les champs que l\'API lit (numeroFiche, slugSet, idExpansion)', R.ajoutees[0], { _id: '-5|5', carteId: -5, idProduct: 5, idExpansion: 200, numeroFiche: '12', slugSet: 'B' });
verifier('cartesSets : le set est ajouté UNE fois (doublon du plan et set déjà membre ignorés)', [R.cartes.find(c => c._id === 11).sets, R.cartes.find(c => c._id === 10).sets], [['C'], ['A']]);
verifier('impression : ajoutée si absente, ignorée si le numéro est le même sous une autre écriture (007 = 7)', [R.cartes.find(c => c._id === 11).impressions.length, R.cartes.find(c => c._id === 10).impressions.length], [1, 1]);
verifier('l\'état lu n\'est JAMAIS modifié (copie à l\'écriture)', JSON.stringify({ cartes, lignes }), avant);
verifier('aucune carte absente', R.carteAbsente, 0);
verifier('la preuve et le tirage de la ligne du plan sont portés (les compteurs lisent la preuve ; l\'API les projette ou les ignore)', appliquerPlans({ cartes, cartesProduits: lignes }, [{ lignes: [{ _id: '11|7', carteId: 11, idProduct: 7, idExpansion: 5, preuve: 'fiche-simple', tirage: 'zh-hans' }] }]).ajoutees[0], { _id: '11|7', carteId: 11, idProduct: 7, idExpansion: 5, preuve: 'fiche-simple', tirage: 'zh-hans' });
const R2 = appliquerPlans({ cartes, cartesProduits: lignes }, [{ lignes: [{ _id: '99|9', carteId: 99, idProduct: 9, idExpansion: 1 }] }]);
verifier('une ligne qui vise une carte absente de la base est COMPTÉE (le plan ne correspond pas à l\'état lu)', R2.carteAbsente, 1);
verifier('deux plans : le second voit les lignes du premier (pas de doublon entre plans)', appliquerPlans({ cartes, cartesProduits: lignes }, [plan, plan]).ajoutees.length, 2);
console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
