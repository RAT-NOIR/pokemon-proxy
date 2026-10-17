// Banc de poser-energies-sp.js (lot ENERGIES-SP) : purs, aucune base. node test-energies-sp.js
const assert = require('assert');
const E = require('./collecte-cartes/energies-sp');
let n = 0, ko = 0;
const t = (nom, f) => { try { f(); n++; console.log('ok  ', nom); } catch (e) { ko++; console.log('FAIL', nom, '-', e.message); } };

const SET = 'Sword-Shield-Promos', EXP = 'S-P Promotional cards';
const CARTE = 60754;                                  // une carte de la liste fermée (Grass)
const ligne = (idProduct, slug, o = {}) => ({ _id: `${CARTE}|${idProduct}`, carteId: CARTE, idProduct, slugSet: SET, idExpansion: 3214, slug, ...o });
const nc = (idProduct, numero, slug) => ({ idProduct, numero, slug });
const carte = (o = {}) => ({ _id: CARTE, nomEn: 'Basic Grass Energy', sets: [SET], impressions: [], images: [], ...o });
const base = (o = {}) => ({
    cartes: new Map([[CARTE, carte()]]),
    lignes: [ligne(1, 'Grass-Energy-V2-S-P9'), ligne(2, null), ligne(3, 'Grass-Energy-V1-S-P')],
    nc: new Map([[1, nc(1, '9', 'Grass-Energy-V2-S-P9')], [2, nc(2, '60', 'Grass-Energy-V3-S-P60')], [3, nc(3, null, 'Grass-Energy-V1-S-P')]]),
    imagesDocs: new Map(), cat: new Map(), images: [], ...o,
});

t('la liste fermée : 8 cartes, 8 images sans numéro, chacune avec sa preuve regardée', () => {
    assert.strictEqual(E.CARTES.length, 8);
    assert.strictEqual(E.IMAGES_SANS_NUMERO.length, 8);
    assert.strictEqual(new Set(E.IMAGES_SANS_NUMERO.map(i => i.cleR2)).size, 8);
    for (const i of E.IMAGES_SANS_NUMERO) { assert(i.vu && /\/S-P/.test(i.vu)); assert(i.numero && i.carteId); }
    assert(E.SOURCES_POSEES_APRES_OK);
});
t('numeroDuSlug : le numéro final après -S-P, sur trois chiffres ; V1 nu et slug nul : aucun', () => {
    assert.strictEqual(E.numeroDuSlug('Grass-Energy-V2-S-P9'), '009');
    assert.strictEqual(E.numeroDuSlug('Fire-Energy-V6-S-P330'), '330');
    assert.strictEqual(E.numeroDuSlug('Grass-Energy-V1-S-P'), null);
    assert.strictEqual(E.numeroDuSlug(null), null);
});
t('deux éléments concordants (slug et numeros_cartes) : une impression numérotée et un numeroFiche', () => {
    const p = E.planifier(base());
    const imp = p.impressions.find(x => x.impression.numero === '009');
    assert(imp); assert.strictEqual(imp.impression.tirage, 'jp'); assert.strictEqual(imp.impression.expansion, EXP);
    assert.strictEqual(imp.impression.total, 'S-P'); assert.strictEqual(imp.impression.source, 'numero-cardmarket');
    assert(/^ENERGIES-SP/.test(imp.impression.preuveNumero));
    assert(p.numerosFiche.some(x => x.idProduct === 1 && x.numero === '009'));
});
t('un seul élément : le slug seul (numeros_cartes muet) ne pose rien', () => {
    const b = base({ nc: new Map([[1, nc(1, null, 'Grass-Energy-V2-S-P9')]]), lignes: [ligne(1, 'Grass-Energy-V2-S-P9')] });
    const p = E.planifier(b);
    assert.strictEqual(p.impressions.length, 0); assert.strictEqual(p.numerosFiche.length, 0); assert(p.refus.length >= 1);
});
t('un seul élément : numeros_cartes seul (ligne sans slug, nc sans slug) ne pose rien', () => {
    const b = base({ nc: new Map([[2, nc(2, '60', null)]]), lignes: [ligne(2, null)] });
    const p = E.planifier(b);
    assert.strictEqual(p.impressions.length, 0); assert.strictEqual(p.numerosFiche.length, 0);
});
t('ligne sans slug : le slug de numeros_cartes compte, avec son numéro', () => {
    const p = E.planifier(base());
    assert(p.numerosFiche.some(x => x.idProduct === 2 && x.numero === '060'));
});
t('le slug et numeros_cartes se contredisent : refus, rien posé', () => {
    const b = base({ nc: new Map([[1, nc(1, '10', 'Grass-Energy-V2-S-P9')]]), lignes: [ligne(1, 'Grass-Energy-V2-S-P9')] });
    const p = E.planifier(b);
    assert.strictEqual(p.impressions.length, 0); assert.strictEqual(p.numerosFiche.length, 0);
    assert(p.refus.some(r => r.idProduct === 1 && /contredi/.test(r.raison)));
});
t('V1 nu (aucun numéro) : ni impression ni numeroFiche, listé « sans numéro »', () => {
    const p = E.planifier(base());
    assert(!p.numerosFiche.some(x => x.idProduct === 3)); assert(p.sansNumero.includes(3));
});
t('une carte hors liste n\'est jamais touchée', () => {
    const b = base();
    b.lignes.push({ _id: '999|9', carteId: 999, idProduct: 9, slugSet: SET, idExpansion: 3214, slug: 'Pikachu-S-P7' });
    b.nc.set(9, nc(9, '7', 'Pikachu-S-P7'));
    const p = E.planifier(b);
    assert(!p.numerosFiche.some(x => x.carteId === 999) && !p.impressions.some(x => x.carteId === 999));
});
t('une ligne d\'un autre set que Sword-Shield-Promos est ignorée', () => {
    const b = base(); b.lignes.push(ligne(8, 'Grass-Energy-S-P5', { slugSet: 'Autre', _id: 'x' })); b.nc.set(8, nc(8, '5', 'Grass-Energy-S-P5'));
    const p = E.planifier(b);
    assert(!p.numerosFiche.some(x => x.idProduct === 8));
});
t('idempotence : appliqué puis replanifié, plus rien à poser', () => {
    const b = base(); const p = E.planifier(b);
    const etat = E.appliquer(b, p); const p2 = E.planifier({ ...b, ...etat });
    assert.strictEqual(p2.impressions.length, 0); assert.strictEqual(p2.numerosFiche.length, 0); assert.strictEqual(p2.images.length, 0);
    assert(p2.deja.length > 0);
});
t('appliquer ne modifie pas l\'état d\'entrée', () => {
    const b = base(); const avant = JSON.stringify([b.cartes.get(CARTE), b.lignes]);
    E.appliquer(b, E.planifier(b));
    assert.strictEqual(JSON.stringify([b.cartes.get(CARTE), b.lignes]), avant);
});
t('un numeroFiche déjà posé et différent : refus, jamais écrasé', () => {
    const b = base(); b.lignes[0].numeroFiche = '010';
    const p = E.planifier(b);
    assert(!p.numerosFiche.some(x => x.idProduct === 1)); assert(p.refus.some(r => r.idProduct === 1));
});
t('une impression déjà là (010 = 10) n\'est pas reposée', () => {
    const b = base({ cartes: new Map([[CARTE, carte({ impressions: [{ tirage: 'jp', expansion: EXP, numero: '9', total: 'S-P', source: 'x' }] })]]) });
    const p = E.planifier(b);
    assert(!p.impressions.some(x => x.impression.numero === '009')); assert(p.deja.length >= 1);
});

// ── 605830 / 605831 : slug décalé d'un cran, trois éléments cherchés
const idsLot = [605824, 605825, 605826, 605827, 605828, 605829, 605830, 605831];
const types = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal'];
const carteDe = i => 1000 + i;
function lotDouteux(o = {}) {
    const lignes = [], ncs = new Map(), cat = new Map(), cartes = new Map(), docs = new Map();
    idsLot.forEach((id, i) => {
        const num = 246 + i, T = types[i];
        const slugNum = id === 605830 ? 251 : id === 605831 ? 252 : num;        // le décalage de Cardmarket
        lignes.push({ _id: `${carteDe(i)}|${id}`, carteId: carteDe(i), idProduct: id, slugSet: SET, idExpansion: 3214, slug: null });
        ncs.set(id, nc(id, o.sansNumero && id === 605830 ? null : String(num), `${T}-Energy-S-P${slugNum}`));
        cat.set(id, { idProduct: id, dateAdded: (o.dateAutre && id === 605826 ? '2022-01-08T09:00:00.000Z' : '2022-01-07T09:37:05.000Z') });
        cartes.set(carteDe(i), { _id: carteDe(i), nomEn: `Basic ${T} Energy`, sets: [SET], impressions: [], images: [{ set: SET, cleR2: `artofpkm/397/${220 + i}.webp`, numero: String(num) }] });
        docs.set(`artofpkm/397/${220 + i}.webp`, { _id: `artofpkm/397/${220 + i}.webp`, carteId: carteDe(i), numero: String(num) });
    });
    return { cartes, lignes: o.sansLot ? lignes.filter(l => l.idProduct >= 605830) : lignes, nc: ncs, cat, imagesDocs: docs, images: [] };
}
const DOUTEUX_TEST = { 605830: { carteId: carteDe(6), lot: idsLot }, 605831: { carteId: carteDe(7), lot: idsLot } };
const planD = (o = {}, douteux = true) => E.planifier(lotDouteux(o), { carteIds: idsLot.map((_, i) => carteDe(i)), douteuxDef: DOUTEUX_TEST, douteux });
t('605830 : nc.numero 252 + rang dans le lot de même jour (six frères prouvés 246…251) : numeroFiche 252 posé, slug contredit noté', () => {
    const p = planD();
    const d = p.numerosFiche.find(x => x.idProduct === 605830);
    assert(d && d.numero === '252' && d.douteux === true);
    assert(/251/.test(d.preuve) && /rang/.test(d.preuve));
    assert(p.numerosFiche.find(x => x.idProduct === 605831).numero === '253');
});
t('605830 sans deuxième élément (numeros_cartes muet) : pas de numeroFiche', () => {
    const p = planD({ sansNumero: true });
    assert(!p.numerosFiche.some(x => x.idProduct === 605830)); assert(p.douteuxRefuses.some(r => r.idProduct === 605830));
});
t('605830 : le lot n\'est pas du même jour : le rang ne prouve rien, pas de numeroFiche', () => {
    const p = planD({ dateAutre: true });
    assert(!p.numerosFiche.some(x => x.idProduct === 605830));
});
t('605830 : les frères prouvés manquent (lot absent des lignes) : pas de numeroFiche', () => {
    const p = planD({ sansLot: true });
    assert(!p.numerosFiche.some(x => x.idProduct === 605830));
});
t('--sans-douteux : 605830 et 605831 ne reçoivent rien, nommés', () => {
    const p = planD({}, false);
    assert(!p.numerosFiche.some(x => x.idProduct === 605830 || x.idProduct === 605831));
    assert(p.douteuxRefuses.length === 2);
});

// ── images sans numéro
const IMG = E.IMAGES_SANS_NUMERO[0];                 // { carteId, cleR2, numero, vu }
const baseImg = (o = {}) => {
    const c = IMG.carteId, N = IMG.numero.replace(/^0+/, '');
    return {
        cartes: new Map([[c, { _id: c, nomEn: 'x', sets: [SET], impressions: [], images: [{ set: SET, cleR2: IMG.cleR2, numero: null }, ...(o.autres || [])] }]]),
        lignes: [{ _id: `${c}|55`, carteId: c, idProduct: 55, slugSet: SET, idExpansion: 3214, slug: `X-V6-S-P${N}` }],
        nc: new Map([[55, { idProduct: 55, numero: N, slug: `X-V6-S-P${N}` }]]),
        imagesDocs: new Map([[IMG.cleR2, { _id: IMG.cleR2, carteId: c, numero: null }]]), cat: new Map(), images: [],
    };
};
t('image sans numéro : numéro posé quand l\'image est regardée ET qu\'un produit prouvé porte ce numéro', () => {
    const p = E.planifier(baseImg());
    const o = p.images.find(x => x.cleR2 === IMG.cleR2); assert(o && o.numero === IMG.numero); assert(o.vu);
});
t('image sans numéro : aucun produit prouvé à ce numéro → rien', () => {
    const b = baseImg(); b.nc = new Map([[55, { idProduct: 55, numero: '1', slug: 'X-V6-S-P1' }]]); b.lignes[0].slug = 'X-V6-S-P1';
    assert.strictEqual(E.planifier(b).images.length, 0);
});
t('image sans numéro : le numéro est déjà porté par une autre image de la carte → refus', () => {
    const b = baseImg({ autres: [{ set: SET, cleR2: 'autre.webp', numero: IMG.numero }] });
    const p = E.planifier(b); assert.strictEqual(p.images.length, 0); assert(p.refus.some(r => r.cleR2 === IMG.cleR2));
});
t('image sans numéro : hors liste regardée → jamais touchée', () => {
    const b = baseImg(); b.cartes.get(IMG.carteId).images.push({ set: SET, cleR2: 'inconnue.webp', numero: null });
    assert(!E.planifier(b).images.some(x => x.cleR2 === 'inconnue.webp'));
});
t('appliquer : le numéro d\'image se pose sur cartes.images ET sur le document images', () => {
    const b = baseImg(); const e = E.appliquer(b, E.planifier(b));
    assert.strictEqual(e.cartes.get(IMG.carteId).images[0].numero, IMG.numero);
    assert.strictEqual(e.imagesDocs.get(IMG.cleR2).numero, IMG.numero);
});

// ── écritures et retrait
t('écritures : $push gardé (impressions), $set gardé (numeroFiche), arrayFilters sur numero nul (images) — jamais un $set de tableau', () => {
    const b = baseImg(); b.lignes.push({ _id: `${IMG.carteId}|56`, carteId: IMG.carteId, idProduct: 56, slugSet: SET, idExpansion: 3214, slug: null });
    const p = E.planifier(b); const ops = E.operationsVersMongo(p);
    const imp = ops.find(o => o.coll === 'cartes' && o.update.$push); assert(imp && imp.filter.impressions.$not.$elemMatch.numero);
    const nf = ops.find(o => o.coll === 'cartes_produits'); assert(nf && nf.filter.numeroFiche === null && nf.update.$set.numeroFiche);
    const im = ops.filter(o => o.update.$set && Object.keys(o.update.$set).some(k => k.startsWith('images.$[')));
    assert(im.length === 1 && im[0].options.arrayFilters[0]['e.numero'] === null);
    assert(ops.some(o => o.coll === 'images' && o.filter.numero === null && o.filter.cleR2 === IMG.cleR2 && !('_id' in o.filter)));   // l'_id d'un document images n'est pas sa cleR2 (sans « .webp »)
    for (const o of ops) assert(!(o.update.$set && 'impressions' in o.update.$set) && !(o.update.$set && 'images' in o.update.$set));
});
t('--retirer exact : le manifeste appliqué puis retiré rend l\'état d\'origine, sans toucher une impression préexistante', () => {
    const pre = { tirage: 'jp', expansion: EXP, numero: '500', total: 'S-P', source: 'tcgdex' };
    const b = base({ cartes: new Map([[CARTE, carte({ impressions: [pre] })]]) });
    const plan = E.planifier(b); const m = E.manifeste(plan);
    const apres = E.appliquer(b, plan);
    const retire = E.retirer({ ...b, ...apres }, m);
    assert.deepStrictEqual(retire.cartes.get(CARTE), b.cartes.get(CARTE));
    assert.deepStrictEqual(retire.lignes, b.lignes);
});
t('--retirer : un numeroFiche modifié depuis (valeur ≠ manifeste) n\'est pas retiré', () => {
    const b = base(); const plan = E.planifier(b); const m = E.manifeste(plan);
    const etat = E.appliquer(b, plan); etat.lignes.find(l => l.idProduct === 1).numeroFiche = '123';
    const retire = E.retirer({ ...b, ...etat }, m);
    assert.strictEqual(retire.lignes.find(l => l.idProduct === 1).numeroFiche, '123');
});
t('opérations de retrait : $pull borné par la marque, $unset par valeur, numero remis à nul par arrayFilters', () => {
    const b = baseImg(); const m = E.manifeste(E.planifier(b)); const ops = E.operationsDeRetrait(m);
    assert(ops.some(o => o.coll === 'images' && o.filter.numero === IMG.numero && o.update.$set.numero === null));
    assert(ops.some(o => o.coll === 'cartes' && o.update.$set && Object.keys(o.update.$set).some(k => k.startsWith('images.$['))));
});
t('annonce du retrait : les impressions retirées sont une baisse annoncée, et le nom du compteur est valide pour la garde de lot', () => {
    const b = base(); const m = E.manifeste(E.planifier(b));
    const a = E.annonceDeRetrait(m);
    assert.deepStrictEqual(a, { 'impressions imp:jp|S-P Promotional cards': m.impressions.length });
    require('./collecte-cartes/garde-lot').validerAnnonces(a);
    assert.deepStrictEqual(E.annonceDeRetrait({ impressions: [], numerosFiche: [], images: [] }), {});
});
t('diff.md : résume gagnés / perdus / visuels changés et nomme les douteux', () => {
    const sortie = { resume: { produitsRejoues: 10, differences: 2, natures: { 'visuel changé': 1 }, perdus: 0, horsDesHuitCartes: 0, gagnes: 0, visuelsChanges: 1, fichesChangeesVisuelIdentique: 1, produitsDesHuitCartes: 1 },
        plan: { impressions: [], numerosFiche: [{ idProduct: 605830, numero: '252', douteux: true, preuve: 'p' }], images: [], refus: [], douteuxRefuses: [{ idProduct: 605831, raison: 'r' }], sansNumero: [], deja: [] },
        produits: [{ idProduct: 5, carteId: 1, nom: 'X', slug: 'X-S-P9', nature: 'visuel changé', numeroFicheAvant: null, numeroFicheApres: '009', avant: { fiche: true, rang: 0, numeroAffiche: null, image: { cleR2: 'a', numeroImage: '010' } }, apres: { fiche: true, rang: 0, numeroAffiche: '009', image: { cleR2: 'b', numeroImage: '009' } } }] };
    const md = E.diffEnMarkdown(sortie, { annonce: {}, garde: { baisses: 0, nonAutorisees: 0, hausses: {} }, douteux: true });
    assert(/perdus : 0/.test(md) && /visuels changés : 1/.test(md) && /605830/.test(md) && /605831/.test(md) && /\| 5 \|/.test(md));
});

// ── la règle du SITE vient de la lib demandée (branche non fusionnée), pour la fiche ET pour l'image
(async () => {
    const fs = require('fs'), os = require('os'), path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'es-lib-'));
    const f = (nom, corps) => fs.writeFileSync(path.join(dir, nom), corps);
    f('impressionsDuSet.ts', 'export const fichesDuDocument = () => "F1"; export const setParImpression = () => "S1";');
    f('cardmarket.ts', 'export const produitsDeLaFiche = () => "P1";');
    f('langueDuVisuel.ts', 'export const visuelAdmisPourLaRegion = () => true; export const refusDuVisuel = () => null;');
    f('imageDeLImpression.ts', 'export const normaliserNumero = (x) => x; export const imageDeLImpression = () => "I1";');
    try {
        const H = require('./collecte-cartes/h-fix-site');
        const R = await H.chargerRegle({ racine: __dirname, siteLib: dir });
        assert.strictEqual(R.regle.fichesDuDocument(), 'F1'); assert.strictEqual(R.regle.produitsDeLaFiche(), 'P1'); assert.strictEqual(R.imageDeLImpression(), 'I1');
        n++; console.log('ok   chargerRegle({siteLib}) : la fiche et l\'image viennent de la même lib du site demandée');
    } catch (e) { ko++; console.log('FAIL chargerRegle({siteLib}) -', e.message.split('\n')[0]); }
    console.log(`\n${n} ok, ${ko} échec(s)`); process.exit(ko ? 1 : 0);
})();
