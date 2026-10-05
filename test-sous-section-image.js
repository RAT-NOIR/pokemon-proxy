// node test-sous-section-image.js — la garde de jointure des images d'une SOUS-SECTION artofpkm (collecte-cartes/sous-section-image.js).
// Le cas qui l'a fait écrire (2026-10-06) : le set 206 porte DEUX decks numérotés chacun depuis 1 ; la ligne LED ne déclare que le deck
// Leafeon. « Dual Ball n°008 » (deck Metagross, sous-section 643) désignait par le numéro seul la carte Good Rod n°008 du deck Leafeon.
const assert = require('assert');
const { jointureSousSection } = require('./collecte-cartes/sous-section-image');
let ok = 0, ko = 0;
const t = (nom, f) => { try { f(); ok++; console.log(`✅ ${nom}`); } catch (e) { ko++; console.log(`❌ ${nom} : ${e.message}`); } };
const nom = s => String(s).toLowerCase();
const goodRod = { _id: 1, nomEn: 'Good Rod' }, dualBall = { _id: 2, nomEn: 'Dual Ball' };

t('image de la liste elle-même (sourceSetId parmi les ids de la ligne) : rien ne change', () =>
    assert.deepStrictEqual(jointureSousSection({ sourceSetId: 206, nomEn: 'Dual Ball' }, [goodRod], 'numero', [206], nom), { cands: [goodRod], preuve: 'numero', raison: null }));
t('sous-section, le numéro désigne une carte d\'un AUTRE nom : refusée, la raison le dit', () =>
    assert.deepStrictEqual(jointureSousSection({ sourceSetId: 643, nomEn: 'Dual Ball' }, [goodRod], 'numero', [206], nom), { cands: [], preuve: 'numero', raison: 'le nom de l\'image n\'est pas celui de la carte (« Good Rod »)' }));
t('sous-section, numéro et nom concordent : jointe, la preuve le dit', () =>
    assert.deepStrictEqual(jointureSousSection({ sourceSetId: 643, nomEn: 'Dual Ball' }, [dualBall], 'numero', [206], nom), { cands: [dualBall], preuve: 'numero+nom (sous-section)', raison: null }));
t('sous-section, jointe par le NOM seul : refusée (le numéro écrit serait celui d\'un autre deck)', () =>
    assert.deepStrictEqual(jointureSousSection({ sourceSetId: 643, nomEn: 'Dual Ball' }, [dualBall], 'nom', [206], nom).raison, 'jointe par « nom », pas par le numéro'));
t('sous-section, le numéro désigne deux cartes : refusée, la raison le dit', () =>
    assert.deepStrictEqual(jointureSousSection({ sourceSetId: 643, nomEn: 'Dual Ball' }, [dualBall, goodRod], 'numero', [206], nom).raison, 'le numéro désigne 2 cartes'));
t('sous-section, image sans nom : refusée (pas de témoin)', () =>
    assert.deepStrictEqual(jointureSousSection({ sourceSetId: 643, nomEn: null }, [dualBall], 'numero', [206], nom).cands, []));
t('sous-section, correction lue à l\'œil : gardée telle quelle', () =>
    assert.deepStrictEqual(jointureSousSection({ sourceSetId: 643, nomEn: 'X' }, [goodRod], 'correction lue à l\'œil', [206], nom, { correction: true }), { cands: [goodRod], preuve: 'correction lue à l\'œil', raison: null }));
t('ids comparés en nombres (« 206 » de la table, 206 du document)', () =>
    assert.deepStrictEqual(jointureSousSection({ sourceSetId: 206, nomEn: 'Dual Ball' }, [goodRod], 'numero', ['206'], nom).cands, [goodRod]));
console.log(`\n${ko ? `⚠️ ${ko}/${ok + ko} en échec` : `🎉 ${ok}/${ok + ko} passés`}`);
process.exit(ko ? 1 : 0);
