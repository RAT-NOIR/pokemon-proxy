// node test-rejeu-set.js — le rejeu de joindre() pour une ligne de table : UNE copie (mesurer-sans-ligne.js et poser-lignes-rejeu.js la partagent). Fonctions pures, archive R2 injectée.
const { creerRejeu } = require('./collecte-cartes/rejeu-set');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

const cartes = [
    { _id: 1, nomEn: 'Pika', sets: ['SetA'], impressions: [{ tirage: 'jp', expansion: 'Exp A', numero: '5' }], attaques: [] },
    { _id: 2, nomEn: 'Raichu', sets: ['SetA'], impressions: [{ tirage: 'jp', expansion: 'Exp A', numero: '6' }], attaques: [] },
    { _id: 3, nomEn: 'Mew', sets: [], impressions: [{ tirage: 'jp', expansion: 'Exp B', numero: '1' }], attaques: [] }];
const prod = (idProduct, nom, numero) => ({ idProduct, idExpansion: 10, idMetacard: null, name: nom, nom, attaques: [], numero, slug: null, slugSet: 'SetA', variante: null });
const produits = [prod(101, 'Pika', '005'), prod(102, 'Raichu', '006'), prod(103, 'Inconnu', '007')];
const R = creerRejeu({ cartes, setParId: new Map(), etatPages: new Map(), lireTexte: async () => { throw new Error('l\'archive ne doit pas être lue sans cleR2'); } });
const L = { code: 'A', exp: 10, slugSet: 'SetA', bulba: { tirage: 'jp', expansion: 'Exp A' } };

(async () => {
    const r = await R.joindreLigne({ l: L, produits });
    verifier('le rejeu joint chaque produit à la carte de son numéro (set+numero)', r.Jr.lignes.map(l => [l.carteId, l.idProduct, l.preuve]).sort(), [[1, 101, 'set+numero'], [2, 102, 'set+numero']]);
    verifier('le produit sans carte est un reste nommé, pas une ligne', r.Jr.restes.filter(x => x.type === 'produit-sans-carte').map(x => x.idProduct), [103]);
    verifier('tirage et slug de la ligne sont rendus', [r.TIRAGE, r.slug, r.sx], ['jp', 'SetA', null]);
    const ri = await R.joindreLigne({ l: L, produits, lignesInterdites: new Set(['1|101']) });
    verifier('une ligne DÉTACHÉE (« carte|produit ») n\'est pas proposée', ri.Jr.lignes.map(l => l.idProduct).sort(), [102]);
    const sp = await R.joindreLigne({ l: { code: 'B', exp: 11, slugSet: 'SetB', bulba: { tirage: 'jp', expansion: 'Exp B', sansPage: true } }, produits: [prod(201, 'Mew', '001')] });
    verifier('une ligne « sans page » prend les cartes qui DÉCLARENT l\'impression, même hors cartes.sets', sp.Jr.lignes.map(l => [l.carteId, l.idProduct]), [[3, 201]]);
    const LSP = { code: 'B', exp: 11, slugSet: 'SetB', bulba: { tirage: 'jp', expansion: 'Exp B', sansPage: true } };
    const spi = await R.joindreLigne({ l: LSP, produits: [prod(201, 'Mew', '001')], lignesInterdites: new Set(['3|201']) });
    verifier('une ligne « sans page » DÉTACHÉE (« carte|produit ») n\'est pas proposée non plus (relecture 2, D3)', spi.Jr.lignes.map(l => [l.carteId, l.idProduct]), []);
    const spa = await R.joindreLigne({ l: LSP, produits: [prod(201, 'Mew', '001')], lignesInterdites: new Set(['9|999']) });
    verifier('… et une interdite d\'une autre carte ne retire rien', spa.Jr.lignes.map(l => [l.carteId, l.idProduct]), [[3, 201]]);
    verifier('setlistDe : une ligne sans cleR2 n\'a pas de Setlist (et l\'archive n\'est pas lue)', await R.setlistDe(L, 'SetA'), null);
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌', e); process.exit(1); });
