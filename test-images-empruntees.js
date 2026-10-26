// Banc de poser-images-empruntees.js (lot TAMPONNEES) : purs + faux client, aucune base réelle, aucune requête, aucun chemin du testeur. node test-images-empruntees.js
const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');
const E = require('./collecte-cartes/images-empruntees');
let n = 0, ko = 0;
const t = (nom, f) => { try { f(); n++; console.log('ok  ', nom); } catch (e) { ko++; console.log('FAIL', nom, '-', e.message); } };

const PP = 'Play-Pokemon-Prize-Pack-Series-Nine', BA = 'Battle-Academy-2024', TOT = 'Trick-or-Trade-2024';
const NOW = new Date('2026-10-18T10:00:00Z');
const sub = (o = {}) => ({ cleR2: 'tcgdex/Destined-Rivals/034-1.webp', source: 'tcgdex', set: 'Destined-Rivals', numero: '034', langue: 'en', w: 600, h: 825, mention: 'x', preuve: 'p', le: '2026-09-26', ...o });
const ligne = (idProduct, slugSet, o = {}) => ({ _id: `1|${idProduct}`, carteId: 1, idProduct, slugSet, idExpansion: 9, visuelSubstitut: sub(), ...o });
const origine = { set: 'Destined-Rivals', source: 'tcgdex', cleR2: 'tcgdex/Destined-Rivals/034-1.webp', numero: '034', w: 600, h: 825, vignette: { cleR2: 'vignettes/tcgdex/Destined-Rivals/034-1.webp', w: 200, h: 275 } };
const carte = (images = [origine], id = 1) => ({ _id: id, nomEn: 'X', sets: [PP, BA, TOT], images });
const etat = (lignes, cartes = [carte()]) => ({ lignes, cartes: new Map(cartes.map(c => [c._id, c])) });
const plan = (e) => E.planifier(e, { maintenant: NOW });

t('périmètre fermé : PP Five à Nine, Battle-Academy 2020/2022/2024, Trick-or-Trade-2024 — rien d\'autre', () => {
    assert.deepStrictEqual([...E.SETS_PRIZE_PACK], ['Five', 'Six', 'Seven', 'Eight', 'Nine'].map(x => `Play-Pokemon-Prize-Pack-Series-${x}`));
    assert.deepStrictEqual([...E.SETS_BATTLE_ACADEMY], ['Battle-Academy-2020', 'Battle-Academy-2022', 'Battle-Academy-2024']);
    assert.deepStrictEqual([...E.SETS_TRICK_OR_TRADE], ['Trick-or-Trade-2024']);
    assert.strictEqual(E.PERIMETRE.length, 9);
    for (const s of ['Play-Pokemon-Prize-Pack-Series-One', 'Play-Pokemon-Prize-Pack-Series-Four', 'Scarlet-Violet-Battle-Academy', 'Trick-or-Trade', 'Trick-or-Trade-2023', 'WCD-2009']) assert.strictEqual(E.dansLePerimetre(s), false, s);
    assert.throws(() => E.PERIMETRE.push('x'));
});
t('verifierPerimetre : un slug du périmètre absent de la base lève et le nomme', () => {
    assert.doesNotThrow(() => E.verifierPerimetre(E.PERIMETRE));
    assert.throws(() => E.verifierPerimetre(E.PERIMETRE.filter(s => s !== TOT)), /Trick-or-Trade-2024/);
    assert.throws(() => E.verifierPerimetre([]), /introuvable/);
});
t('WCD refusé explicitement : jamais d\'ajout, compté, quelle que soit la casse ou l\'espace', () => {
    for (const s of ['WCD-2009', 'wcd-2010', ' WCD-2012', 'WCD']) {
        assert.strictEqual(E.estWCD(s), true, s);
        const p = plan(etat([ligne(5, s)]));
        assert.strictEqual(p.ajouts.length, 0); assert.strictEqual(p.refusWCD.length, 1); assert.strictEqual(E.operationsVersMongo(p).length, 0);
    }
    assert.strictEqual(E.estWCD(PP), false);
    assert.strictEqual(E.dansLePerimetre('WCD-' + PP), false);
});
t('une ligne d\'un set hors périmètre est ignorée (comptée à part), jamais écrite', () => {
    const p = plan(etat([ligne(5, 'Play-Pokemon-Prize-Pack-Series-One'), ligne(6, 'Scarlet-Violet-Battle-Academy')]));
    assert.strictEqual(p.ajouts.length, 0); assert.strictEqual(p.horsPerimetre, 2);
});
t('cible : carteId > 0 ET visuelSubstitut.cleR2 ; sinon listée « sans substitut » / « sans carte »', () => {
    const p = plan(etat([ligne(1, PP, { visuelSubstitut: undefined }), ligne(2, PP, { carteId: 0 }), ligne(3, PP, { visuelSubstitut: { w: 1 } }), ligne(4, PP, { carteId: null })]));
    assert.strictEqual(p.ajouts.length, 0); assert.strictEqual(p.sansSubstitut.length, 2); assert.strictEqual(p.sansCarte.length, 2);
});
t('une ligne ajoutée : l\'entrée exacte (champs de la décision, rien d\'une source tierce)', () => {
    const p = plan(etat([ligne(10, PP)]));
    assert.strictEqual(p.ajouts.length, 1);
    const e = p.ajouts[0].entree;
    assert.deepStrictEqual(Object.keys(e).sort(), ['cleR2', 'collecteLe', 'h', 'imageEmprunteeTirage', 'jointeLe', 'langue', 'languePreuve', 'lot', 'numero', 'retirable', 'set', 'source', 'tamponNonRepresente', 'vignette', 'w'].sort());
    assert.strictEqual(e.set, PP); assert.strictEqual(e.numero, null); assert.strictEqual(e.cleR2, 'tcgdex/Destined-Rivals/034-1.webp');
    assert.strictEqual(e.w, 600); assert.strictEqual(e.h, 825); assert.strictEqual(e.langue, 'en');
    assert.strictEqual(e.languePreuve, 'image du tirage normal empruntée (tampon non représenté)');
    assert.strictEqual(e.source, 'emprunt'); assert.strictEqual(e.lot, 'emprunt-2026-10'); assert.strictEqual(e.imageEmprunteeTirage, true); assert.strictEqual(e.retirable, true);
    assert.strictEqual(e.collecteLe.getTime(), NOW.getTime()); assert.strictEqual(e.jointeLe.getTime(), NOW.getTime());
    for (const k of ['urlOriginal', 'attribution', 'sha256', 'preuve', 'urlFiche', 'mention', 'provenance']) assert(!(k in e), k);
});
t('tamponNonRepresente « Play! Pokémon » POUR LES PRIZE PACKS SEULEMENT : rien pour Battle Academy ni Trick or Trade', () => {
    const p = plan(etat([ligne(10, PP), ligne(11, BA, { _id: '1|11' }), ligne(12, TOT, { _id: '1|12' })]));
    const de = s => p.ajouts.find(a => a.entree.set === s).entree;
    assert.strictEqual(de(PP).tamponNonRepresente, 'Play! Pokémon');
    assert(!('tamponNonRepresente' in de(BA))); assert(!('tamponNonRepresente' in de(TOT)));
    for (const s of E.SETS_PRIZE_PACK) assert.strictEqual(E.tamponDuSet(s), 'Play! Pokémon');
    for (const s of [...E.SETS_BATTLE_ACADEMY, ...E.SETS_TRICK_OR_TRADE]) assert.strictEqual(E.tamponDuSet(s), null);
});
t('la vignette est reprise de l\'entrée d\'origine de la même carte ; inconnue : aucune clé vignette', () => {
    const avec = plan(etat([ligne(10, PP)])).ajouts[0].entree;
    assert.deepStrictEqual(avec.vignette, origine.vignette);
    const sans = plan(etat([ligne(10, PP)], [carte([{ ...origine, vignette: undefined }])])).ajouts[0].entree;
    assert(!('vignette' in sans));
    const absente = plan(etat([ligne(10, PP)], [carte([])])).ajouts[0].entree;
    assert(!('vignette' in absente));
    assert.notStrictEqual(avec.vignette, origine.vignette);   // copie, pas la même référence
});
t('entrée existante du set (vrai scan, basse définition, autre) : JAMAIS touchée, la ligne est « déjà »', () => {
    for (const ex of [{ set: PP, source: 'pokumon', cleR2: 'a.webp', numero: '12' }, { set: PP, source: 'tpc', cleR2: 'b.webp', numero: null, basseDefinition: true }, { set: PP, source: 'x', cleR2: 'c.webp', numero: '034', imageEmprunteeTirage: true }]) {
        const c = carte([origine, ex]); const avant = JSON.parse(JSON.stringify(c));
        const p = plan(etat([ligne(10, PP)], [c]));
        assert.strictEqual(p.ajouts.length, 0); assert.strictEqual(p.deja.length, 1);
        const ap = E.appliquer(etat([ligne(10, PP)], [c]), p);
        assert.deepStrictEqual(JSON.parse(JSON.stringify(ap.cartes.get(1))), avant);
    }
});
t('une entrée d\'un AUTRE set ne compte pas (l\'origine Destined-Rivals n\'empêche rien)', () => {
    assert.strictEqual(plan(etat([ligne(10, PP)], [carte([origine])])).ajouts.length, 1);
});
t('numéro respecté : ligne avec numeroFiche — seule une entrée du set au MÊME numéro (ou sans numéro) la couvre', () => {
    const l = ligne(10, PP, { numeroFiche: '034' });
    const ent = o => ({ set: PP, source: 's', cleR2: 'z.webp', numero: '190', ...o });
    assert.strictEqual(plan(etat([l], [carte([ent()])])).ajouts.length, 1);                              // autre numéro : on ajoute
    assert.strictEqual(plan(etat([l], [carte([ent({ numero: '034' })])])).ajouts.length, 0);             // même numéro
    assert.strictEqual(plan(etat([l], [carte([ent({ numero: '34' })])])).ajouts.length, 0);              // même clé de numéro (zéros)
    assert.strictEqual(plan(etat([l], [carte([ent({ numero: null })])])).ajouts.length, 0);              // numéro inconnu : prudence
    const e = plan(etat([l], [carte([ent()])])).ajouts[0].entree; assert.strictEqual(e.numero, '034');
});
t('sans numeroFiche : la moindre entrée du set, quel que soit son numéro, couvre la ligne', () => {
    assert.strictEqual(plan(etat([ligne(10, PP)], [carte([{ set: PP, source: 's', cleR2: 'z.webp', numero: '190' }])])).ajouts.length, 0);
});
t('deux produits, même carte, même set, même substitut : UNE seule entrée ; les deux produits sont nommés', () => {
    const p = plan(etat([ligne(10, PP), ligne(11, PP, { _id: '1|11' })]));
    assert.strictEqual(p.ajouts.length, 1); assert.deepStrictEqual([...p.ajouts[0].produits].sort(), [10, 11]);
});
t('deux produits, même carte, même set, substituts DIVERGENTS : refus, aucune entrée', () => {
    const p = plan(etat([ligne(10, PP), ligne(11, PP, { _id: '1|11', visuelSubstitut: sub({ cleR2: 'tcgdex/Destined-Rivals/190-1.webp', numero: '190' }) })]));
    assert.strictEqual(p.ajouts.length, 0); assert.strictEqual(p.refus.length, 1); assert(/diverge/.test(p.refus[0].raison));
});
t('substitut incomplet (largeur/hauteur absentes) : refus, rien posé', () => {
    const p = plan(etat([ligne(10, PP, { visuelSubstitut: sub({ w: undefined }) })]));
    assert.strictEqual(p.ajouts.length, 0); assert.strictEqual(p.refus.length, 1);
});
t('carte introuvable en base : refus', () => {
    const p = plan(etat([ligne(10, PP, { carteId: 77 })]));
    assert.strictEqual(p.ajouts.length, 0); assert.strictEqual(p.refus.length, 1);
});
t('idempotence : appliqué puis replanifié, plus rien à ajouter ; second appliquer identique', () => {
    const e = etat([ligne(10, PP), ligne(11, BA, { _id: '1|11' })]);
    const p = plan(e); assert.strictEqual(p.ajouts.length, 2);
    const ap = E.appliquer(e, p);
    const p2 = plan({ ...e, cartes: ap.cartes });
    assert.strictEqual(p2.ajouts.length, 0); assert.strictEqual(p2.deja.length, 2);
    assert.deepStrictEqual(E.appliquer({ ...e, cartes: ap.cartes }, p2).cartes.get(1), ap.cartes.get(1));
});
t('le plan par set compte cibles / ajoutées / déjà / sans substitut / WCD', () => {
    const p = plan(etat([ligne(10, PP), ligne(11, PP, { _id: '1|11', carteId: 2 }), ligne(12, BA, { _id: '1|12', visuelSubstitut: undefined }), ligne(13, 'WCD-2009')], [carte(), carte([origine, { set: PP, source: 's', cleR2: 'k', numero: '1' }], 2)]));
    assert.deepStrictEqual(p.parSet[PP], { lignes: 2, cibles: 1, ajouts: 1, deja: 1, sansSubstitut: 0, sansCarte: 0, refus: 0 });
    assert.strictEqual(p.parSet[BA].sansSubstitut, 1); assert.strictEqual(p.parSet['WCD'].refusWCD, 1);
});

// ── écritures sur un faux client : le filtre est évalué comme MongoDB le ferait pour ces deux formes
const fauxClient = cartes => {
    const corresp = (e, cond) => Object.entries(cond).every(([k, v]) => v && v.$in ? v.$in.some(x => (e[k] ?? null) === x) : (e[k] ?? null) === v);
    const ok = (c, filter) => c._id === filter._id && (!filter.images || (filter.images.$not ? !(c.images || []).some(e => corresp(e, filter.images.$not.$elemMatch)) : false));
    return { executer(ops) {
        let touches = 0;
        for (const o of ops) {
            assert.strictEqual(o.coll, 'cartes');
            const c = cartes.get(o.filter._id); if (!c || !ok(c, o.filter)) continue;
            if (o.update.$push) { c.images = [...(c.images || []), JSON.parse(JSON.stringify(o.update.$push.images))]; touches++; }
            else if (o.update.$pull) { const av = (c.images || []).length; c.images = c.images.filter(e => !corresp(e, o.update.$pull.images)); if (c.images.length !== av) touches++; }
            else assert.fail('opération inconnue');
        }
        return touches;
    } };
};
t('écritures : un $push gardé par $not/$elemMatch ; rejouées deux fois, la seconde n\'ajoute rien ; jamais un $set de tableau', () => {
    const e = etat([ligne(10, PP), ligne(11, BA, { _id: '1|11' }), ligne(12, PP, { _id: '2|12', carteId: 2, numeroFiche: '034' })], [carte(), carte([origine], 2)]);
    const ops = E.operationsVersMongo(plan(e));
    assert.strictEqual(ops.length, 3);
    for (const o of ops) { assert(o.update.$push && o.update.$push.images && !o.update.$set); assert(o.filter.images.$not.$elemMatch.set); }
    const cx = fauxClient(new Map([...e.cartes].map(([k, c]) => [k, JSON.parse(JSON.stringify(c))])));
    assert.strictEqual(cx.executer(ops), 3); assert.strictEqual(cx.executer(ops), 0);
});
t('écritures : sur le faux client, une entrée du set posée entre-temps bloque le push (garde réelle)', () => {
    const e = etat([ligne(10, PP)]);
    const ops = E.operationsVersMongo(plan(e));
    const c = JSON.parse(JSON.stringify(carte())); c.images.push({ set: PP, source: 'autre', cleR2: 'v.webp', numero: '5' });
    assert.strictEqual(fauxClient(new Map([[1, c]])).executer(ops), 0);
    assert.strictEqual(c.images.length, 2);
});
t('retrait exact : le manifeste appliqué puis retiré rend l\'état d\'origine ; un vrai scan posé depuis reste ; une entrée modifiée aussi', () => {
    const e = etat([ligne(10, PP), ligne(11, BA, { _id: '1|11' })]);
    const p = plan(e), m = E.manifeste(p);
    assert.strictEqual(E.totalManifeste(m), 2);
    const ap = E.appliquer(e, p);
    assert.deepStrictEqual(E.retirer({ cartes: ap.cartes }, m).cartes.get(1), e.cartes.get(1));
    const avecScan = new Map([[1, { ...ap.cartes.get(1), images: [...ap.cartes.get(1).images, { set: PP, source: 'pokumon', cleR2: 'vrai.webp', numero: '034' }] }]]);
    const r = E.retirer({ cartes: avecScan }, m).cartes.get(1);
    assert(r.images.some(x => x.cleR2 === 'vrai.webp')); assert(!r.images.some(x => x.source === 'emprunt'));
});
t('retrait exact en écritures : $pull borné par set + cleR2 + source + lot ; n\'ôte pas une entrée « emprunt » d\'un autre lot', () => {
    const e = etat([ligne(10, PP)]); const p = plan(e), m = E.manifeste(p);
    const ops = E.operationsDeRetrait(m); assert.strictEqual(ops.length, 1);
    const pull = ops[0].update.$pull.images;
    assert.strictEqual(pull.source, 'emprunt'); assert.strictEqual(pull.lot, 'emprunt-2026-10'); assert.strictEqual(pull.set, PP); assert.strictEqual(pull.cleR2, 'tcgdex/Destined-Rivals/034-1.webp'); assert.strictEqual(pull.imageEmprunteeTirage, true);
    const c = JSON.parse(JSON.stringify(carte()));
    const cx = fauxClient(new Map([[1, c]]));
    cx.executer(E.operationsVersMongo(p)); assert.strictEqual(c.images.length, 2);
    c.images.push({ set: PP, source: 'emprunt', lot: 'autre-lot', cleR2: 'tcgdex/Destined-Rivals/034-1.webp', numero: null, imageEmprunteeTirage: true });
    assert.strictEqual(cx.executer(ops), 1);
    assert.strictEqual(c.images.length, 2); assert(c.images.some(x => x.lot === 'autre-lot'));
});
t('retrait en mémoire : une entrée de même set et même clé mais d\'une autre source ou d\'un autre lot reste', () => {
    const e = etat([ligne(10, PP)]); const p = plan(e), m = E.manifeste(p);
    const autres = [{ set: PP, source: 'pokumon', cleR2: 'tcgdex/Destined-Rivals/034-1.webp', numero: null }, { set: PP, source: 'emprunt', lot: 'autre-lot', cleR2: 'tcgdex/Destined-Rivals/034-1.webp', numero: null, imageEmprunteeTirage: true }];
    const ap = E.appliquer(e, p); const c = ap.cartes.get(1); c.images.push(...autres);
    const r = E.retirer({ cartes: ap.cartes }, m).cartes.get(1);
    assert.strictEqual(r.images.length, 3); assert(!r.images.some(x => x.lot === 'emprunt-2026-10'));
});
// ── Correction 2 : Trick or Trade 2024 sans visuelSubstitut — l'image est l'entrée de LA MÊME carte, dans le set d'ORIGINE, au numéro d'origine
const ORI = 'Paldean-Fates';
const entreeOri = (o = {}) => ({ set: ORI, source: 'tcgdex', cleR2: 'tcgdex/Paldean-Fates/057-1.webp', numero: '057', langue: 'en', w: 600, h: 825, vignette: { cleR2: 'vignettes/tcgdex/Paldean-Fates/057-1.webp', w: 200, h: 275 }, ...o });
const ligneToT = (idProduct, o = {}) => ({ _id: `1|${idProduct}`, carteId: 1, idProduct, slugSet: TOT, preuve: 'reimpression+origine+numero', origine: { code: 'PAF', numero: '057' },
    detail: 'slug Gengar-BOO24PAF-057 → tirage d\'origine PAF n°057 → produit(s) 751595/794904 → une seule carte', ...o });
const ligneMeta = (idProduct, o = {}) => ({ _id: `1|${idProduct}`, carteId: 1, idProduct, slugSet: TOT, preuve: 'metacarte+nom+attaques', numeroFiche: null,
    detail: 'BOO24 n°— « Sinistcha [Cursed Drop | Spill the Tea] » → « Sinistcha (Twilight Masquerade 22) » : métacarte Cardmarket 433704 (une seule carte chez nous)', ...o });
const etatToT = (lignes, images = [entreeOri()], o = {}) => ({ ...etat(lignes, [carte(images)]), produits: new Map([[751595, { slugSet: ORI }], [794904, { slugSet: 'Autre' }]]), setsParNom: new Map([['Twilight Masquerade', ['Twilight-Masquerade']]]), ...o });
t('ToT 2024 « réimpression » : l\'image est l\'entrée de la même carte dans le set d\'origine (slugSet du PREMIER produit cité) au numéro d\'origine ; pas de tamponNonRepresente', () => {
    const p = plan(etatToT([ligneToT(20)]));
    assert.strictEqual(p.ajouts.length, 1); assert.strictEqual(p.refus.length, 0); assert.strictEqual(p.sansSubstitut.length, 0);
    const e = p.ajouts[0].entree;
    assert.strictEqual(e.set, TOT); assert.strictEqual(e.numero, null); assert.strictEqual(e.cleR2, 'tcgdex/Paldean-Fates/057-1.webp'); assert.strictEqual(e.w, 600); assert.strictEqual(e.h, 825);
    assert(!('tamponNonRepresente' in e)); assert.strictEqual(e.imageEmprunteeTirage, true); assert.strictEqual(e.source, 'emprunt'); assert.strictEqual(e.langue, 'en');
    assert.deepStrictEqual(e.vignette, entreeOri().vignette);
    assert.strictEqual(p.parSet[TOT].ajouts, 1);
});
t('ToT 2024 « réimpression » : un autre numéro d\'origine dans le set, ou une langue autre que « en », ne conviennent pas', () => {
    assert.strictEqual(plan(etatToT([ligneToT(20)], [entreeOri({ numero: '131' })])).ajouts.length, 0);
    assert.strictEqual(plan(etatToT([ligneToT(20)], [entreeOri({ langue: 'ja' })])).ajouts.length, 0);
    assert.strictEqual(plan(etatToT([ligneToT(20)], [entreeOri({ set: 'Autre' })])).ajouts.length, 0);
    assert.strictEqual(plan(etatToT([ligneToT(20)], [entreeOri({ numero: '57' })])).ajouts.length, 1);   // même clé de numéro (zéros)
});
t('ToT 2024 : zéro, deux entrées ou un substitut sans taille → refus nommé, aucune entrée', () => {
    for (const images of [[], [entreeOri(), entreeOri({ cleR2: 'tcgdex/Paldean-Fates/057b-1.webp' })], [entreeOri({ w: undefined })]]) {
        const p = plan(etatToT([ligneToT(20)], images));
        assert.strictEqual(p.ajouts.length, 0); assert.strictEqual(p.refus.length, 1); assert(/Trick|origine|entrée|image/.test(p.refus[0].raison), p.refus[0].raison);
    }
});
t('ToT 2024 : produit d\'origine inconnu ou detail illisible → refus nommé', () => {
    assert.strictEqual(plan(etatToT([ligneToT(20)], undefined, { produits: new Map() })).refus.length, 1);
    assert.strictEqual(plan(etatToT([ligneToT(20, { detail: 'rien', origine: undefined })])).refus.length, 1);
});
t('ToT 2024 « métacarte » : le set vient du nom entre parenthèses, égalité exacte avec nomAffichage/nomEn, une seule correspondance', () => {
    const img = [entreeOri({ set: 'Twilight-Masquerade', cleR2: 'tcgdex/Twilight-Masquerade/022-1.webp', numero: '022' })];
    const p = plan(etatToT([ligneMeta(21)], img));
    assert.strictEqual(p.ajouts.length, 1); assert.strictEqual(p.ajouts[0].entree.cleR2, 'tcgdex/Twilight-Masquerade/022-1.webp'); assert(!('tamponNonRepresente' in p.ajouts[0].entree));
    assert.strictEqual(plan(etatToT([ligneMeta(21, { detail: 'x → « Sinistcha (twilight masquerade 22) » : y' })], img)).ajouts.length, 0);   // casse différente : pas d'égalité exacte
    assert.strictEqual(plan(etatToT([ligneMeta(21)], img, { setsParNom: new Map() })).refus.length, 1);
    assert.strictEqual(plan(etatToT([ligneMeta(21)], img, { setsParNom: new Map([['Twilight Masquerade', ['Twilight-Masquerade', 'Twilight-Masquerade-Additionals']]]) })).refus.length, 1);
});
t('ToT 2024 « métacarte » : un set dont le nomAffichage est exactement le nom l\'emporte sur un jumeau qui ne l\'a que comme nomEn', () => {
    const img = [entreeOri({ set: 'Twilight-Masquerade', cleR2: 'tcgdex/Twilight-Masquerade/022-1.webp', numero: '022' })];
    const union = new Map([['Twilight Masquerade', ['Mask-of-Change', 'Twilight-Masquerade']]]);
    assert.strictEqual(plan(etatToT([ligneMeta(21)], img, { setsParNom: union })).refus.length, 1);   // sans priorité : ambigu
    const p = plan(etatToT([ligneMeta(21)], img, { setsParNom: union, setsParNomAffichage: new Map([['Twilight Masquerade', ['Twilight-Masquerade']]]) }));
    assert.strictEqual(p.ajouts.length, 1); assert.strictEqual(p.ajouts[0].entree.cleR2, 'tcgdex/Twilight-Masquerade/022-1.webp');
    assert.strictEqual(plan(etatToT([ligneMeta(21)], img, { setsParNom: union, setsParNomAffichage: new Map([['Twilight Masquerade', ['A', 'B']]]) })).refus.length, 1);   // deux nomAffichage égaux : toujours ambigu
});
t('ToT 2024 : une ligne déjà couverte par une entrée du set est sautée (« déjà »), sans dériver ; PP/BA sans substitut restent « sans substitut »', () => {
    const p = plan(etatToT([ligneToT(20)], [entreeOri(), { set: TOT, source: 'pokumon', cleR2: 'v.webp', numero: null }]));
    assert.strictEqual(p.ajouts.length, 0); assert.strictEqual(p.deja.length, 1);
    const q = plan(etatToT([ligne(30, PP, { visuelSubstitut: undefined }), ligne(31, BA, { _id: '1|31', visuelSubstitut: undefined })]));
    assert.strictEqual(q.sansSubstitut.length, 2); assert.strictEqual(q.ajouts.length, 0);
});
t('ToT 2024 : deux produits de la même carte, même origine → UNE entrée', () => {
    const p = plan(etatToT([ligneToT(20), ligneToT(22, { _id: '1|22' })]));
    assert.strictEqual(p.ajouts.length, 1); assert.deepStrictEqual([...p.ajouts[0].produits].sort(), [20, 22]);
});
t('chaîne de la mention : la vraie sélection par suffixe de cleR2 sans le set prend l\'entrée d\'origine (aucune mention) ; avec le set, l\'empruntée', () => {
    const imageServieDe = (images, url) => { let c = null, l = 0; for (const i of images || []) { const k = i?.cleR2; if (typeof k !== 'string' || !k || !url.endsWith(`/${k}`)) continue; if (k.length > l) { c = i; l = k.length; } } return c; };
    const mention = v => (v && v.imageEmprunteeTirage === true ? 'tampon non représenté' : null);
    const p = plan(etatToT([ligneToT(20)])); const cartes = E.appliquer(etatToT([ligneToT(20)]), p).cartes;
    const imgs = cartes.get(1).images;
    const r = E.mentionServie({ images: imgs, cleR2: p.ajouts[0].entree.cleR2, set: TOT, imageServieDe, mentionDuVisuelEmprunte: mention });
    assert.deepStrictEqual(r, { reelle: null, sansSet: null, siCorrectif: 'tampon non représenté' });   // (ce faux `imageServieDe` est l'ANCIEN : il ignore le set ; le site actuel le prend, voir D4.1 plus bas)
});

// ── Correction 1 : une empruntée SANS document `images` est remplaçable par un vrai scan tamponné (règle de basse-definition.js)
const BD = require('./collecte-cartes/basse-definition');
const empruntee = () => plan(etat([ligne(10, PP)])).ajouts[0].entree;
const vrai = (o = {}) => ({ set: PP, numero: null, langue: 'en', source: 'pokumon', cleR2: 'pokumon/x.webp', wOriginal: 700, tampon: 'Play! Pokémon', ...o });
t('correction 1 : sans document, un candidat au marqueur POSITIF de tampon égal remplace l\'empruntée', () => {
    assert.strictEqual(BD.entreesARemplacer([empruntee()], vrai(), { documents: new Map() }).length, 1);
    assert.strictEqual(BD.entreesARemplacer([empruntee()], vrai()).length, 1);   // documents omis
});
t('correction 1 : sans document, un candidat simple non tamponné (ou d\'un autre tampon) ne remplace pas l\'empruntée', () => {
    assert.strictEqual(BD.entreesARemplacer([empruntee()], vrai({ tampon: undefined }), { documents: new Map() }).length, 0);
    assert.strictEqual(BD.entreesARemplacer([empruntee()], vrai({ tampon: 'Staff' }), { documents: new Map() }).length, 0);
});
t('correction 1 : sans document, une entrée qui n\'est pas une « emprunt » (même marquée empruntée, ou basse définition) reste non remplaçable', () => {
    assert.strictEqual(BD.entreesARemplacer([{ ...empruntee(), source: 'autre' }], vrai(), { documents: new Map() }).length, 0);
    assert.strictEqual(BD.entreesARemplacer([{ ...empruntee(), imageEmprunteeTirage: false }], vrai({ wOriginal: 2000 }), { documents: new Map() }).length, 0);   // nettement plus grande : remplacerait si l'entrée était lisible
    assert.strictEqual(BD.entreesARemplacer([{ ...empruntee(), source: 'autre' }], vrai({ wOriginal: 2000 }), { documents: new Map() }).length, 0);
    assert.strictEqual(BD.entreesARemplacer([{ ...empruntee(), imageEmprunteeTirage: false, tamponNonRepresente: undefined, basseDefinition: true }], vrai({ tampon: undefined }), { documents: new Map() }).length, 0);   // source « emprunt » mais non marquée empruntée, en basse définition
    const basse = { set: PP, source: 'tpc', cleR2: 'b.webp', numero: null, langue: 'en', basseDefinition: true };
    assert.strictEqual(BD.entreesARemplacer([basse], { set: PP, numero: null, langue: 'en', source: 'pokumon', cleR2: 'n.webp', wOriginal: 700 }, { documents: new Map() }).length, 0);
});
t('motifDArret : refus au plan, --attendu absent ou différent ; le compte juste passe', () => {
    assert(E.motifDArret({ nbOperations: 3, nbRefus: 1, attendu: 3 }));
    assert(E.motifDArret({ nbOperations: 3, nbRefus: 0, attendu: NaN }));
    assert(E.motifDArret({ nbOperations: 3, nbRefus: 0, attendu: 0 }));
    assert(/attendu 4/.test(E.motifDArret({ nbOperations: 3, nbRefus: 0, attendu: 4 })));
    assert.strictEqual(E.motifDArret({ nbOperations: 3, nbRefus: 0, attendu: 3 }), null);
});
t('manifeste : une simulation relancée après l\'écriture (plan vide) n\'écrase jamais un manifeste qui porte des écritures', () => {
    const plein = E.manifeste(plan(etat([ligne(10, PP)]))), vide = E.manifeste({ ajouts: [] });
    assert.strictEqual(E.decisionManifeste(plein, vide).ecrire, false);
    assert.strictEqual(E.decisionManifeste(null, vide).ecrire, true);
    assert.strictEqual(E.decisionManifeste(plein, plein).ecrire, true);
});
t('manifeste : sans date ni horodatage (le lot écrit est exactement le lot simulé)', () => {
    const a = E.manifeste(plan(etat([ligne(10, PP)]))), b = E.manifeste(E.planifier(etat([ligne(10, PP)]), { maintenant: new Date('2030-01-01') }));
    assert.deepStrictEqual(a, b);
});
t('script : --ecrire sans --attendu refusé avant toute connexion ; argument inconnu refusé ; --attendu non numérique refusé', () => {
    const run = (...a) => spawnSync(process.execPath, [path.join(__dirname, 'poser-images-empruntees.js'), ...a], { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 30000 });
    const sousLot = { PATH: process.env.PATH, LOT_ADDITIF_PID: String(process.pid) };   // le parent du script est ce processus
    const runLot = (...a) => spawnSync(process.execPath, [path.join(__dirname, 'poser-images-empruntees.js'), ...a], { encoding: 'utf8', env: sousLot, timeout: 30000 });
    let r = runLot('--ecrire'); assert.strictEqual(r.status, 2); assert(/exige --attendu/.test(r.stderr));
    r = runLot('--ecrire', '--attendu=0'); assert.strictEqual(r.status, 2); assert(/exige --attendu/.test(r.stderr));
    r = run('--ecrire'); assert.strictEqual(r.status, 2);
    r = run('--bidon'); assert.strictEqual(r.status, 2); assert(/inconnu/.test(r.stderr));
    r = run('--retirer', '--ecrire'); assert.strictEqual(r.status, 2);
    r = run('--attendu=abc'); assert.strictEqual(r.status, 2);
    r = run('--ecrire', '--attendu=3'); assert.strictEqual(r.status, 2); assert(/lot-additif/.test(r.stderr));   // hors lot-additif : refus avant toute connexion
});
t('script : le motif d\'arrêt est vérifié (et arrête) AVANT la copie du manifeste figé et la première écriture', () => {
    const src = require('fs').readFileSync(path.join(__dirname, 'poser-images-empruntees.js'), 'utf8');
    const iArret = src.search(/const arret = E\.motifDArret\([^)]*\);\s*\n\s*if \(arret\) \{[^\n]*process\.exitCode = 1; return;/);
    const iFige = src.indexOf('fs.copyFileSync(fichier(\'manifeste.json\')'), iEcrit = src.lastIndexOf('.updateOne(');
    assert(iArret > 0 && iArret < iFige && iFige < iEcrit);
});
t('script : le retrait partiel n\'affiche pas ✅ et sort en erreur ; la lecture des WCD est insensible à la casse', () => {
    const src = require('fs').readFileSync(path.join(__dirname, 'poser-images-empruntees.js'), 'utf8');
    assert(/touches === ops\.length \? '✅' : '⚠️ retrait PARTIEL/.test(src)); assert(/touches !== ops\.length\) process\.exitCode = 1/.test(src));
    assert(/slugSet: \/\^wcd\/i/.test(src));
});
t('--ecrire refuse de tourner hors de lot-additif.js (pid du lot = pid du parent)', () => {
    assert.throws(() => E.garderSousLot({}, 4242), /lot-additif/);
    assert.throws(() => E.garderSousLot({ LOT_ADDITIF_PID: '1' }, 4242), /lot-additif/);
    assert.throws(() => E.garderSousLot(undefined, 4242));
    assert.doesNotThrow(() => E.garderSousLot({ LOT_ADDITIF_PID: '4242' }, 4242));
});
// ── PHASE 3b (T4, 2026-10-24) : Southeast-Asia-Promos, BORNÉ à 3 produits (901074 Glass Trumpet, 901104 Budew, 901109 Fan Rotom) — l'origine se lit sur la ligne de réimpression
const SEA = 'Southeast-Asia-Promos', LES_TROIS = [901074, 901104, 901109], SEPT = [901074, 901104, 901109, 850142, 833720, 855687, 819263];
const oriSCR = (o = {}) => ({ set: 'Stellar-Crown', source: 'tcgdex', cleR2: 'tcgdex/Stellar-Crown/135-1.webp', numero: '135', langue: 'en', w: 600, h: 825, vignette: { cleR2: 'vignettes/tcgdex/Stellar-Crown/135-1.webp', w: 200, h: 275 }, ...o });
const ligneSEA = (idProduct, o = {}) => ({ _id: `1|${idProduct}`, carteId: 1, idProduct, slugSet: SEA, preuve: 'reimpression+origine+numero', origine: { code: 'SCR', numero: '135' }, numeroFiche: null,
    detail: 'slug Glass-Trumpet-V2-SEASCR-135 → tirage d\'origine SCR n°135 → produit(s) 785989 → une seule carte', ...o });
const etatSEA = (lignes, images = [oriSCR(), { set: 'Ascended-Heroes', source: 'tcgdex', cleR2: 'tcgdex/Ascended-Heroes/189-1.webp', numero: '189', langue: 'en', w: 600, h: 825 }], o = {}) =>
    ({ ...etat(lignes, [carte(images)]), produits: new Map([[785989, { slugSet: 'Stellar-Crown' }]]), ...o });
t('SEA borné : la liste fermée est exactement les 3 produits ; le set n\'entre PAS dans le périmètre (9 sets, inchangé) mais dans ce que l\'outil lit', () => {
    assert.deepStrictEqual([...E.SETS_BORNES[SEA]], SEPT);   // décision du testeur du 24/10 : les 3 produits ET leurs 4 frères
    assert.deepStrictEqual(Object.keys(E.SETS_BORNES), [SEA]);
    assert.strictEqual(E.PERIMETRE.length, 9); assert(!E.PERIMETRE.includes(SEA)); assert.strictEqual(E.dansLePerimetre(SEA), false);
    assert.deepStrictEqual([...E.SETS_LUS], [...E.PERIMETRE, SEA, ...Object.keys(E.ORIGINES_EXPLICITES), ...Object.keys(E.ORIGINES_WCD)]);   // API-52 L1 : + les 2 sets Classic à origine explicite ; 27/10 : + les sets WCD de la liste fermée
    assert.throws(() => E.SETS_BORNES[SEA].push(1)); assert.throws(() => { 'use strict'; E.SETS_BORNES.autre = []; });
    for (const id of SEPT) { assert.strictEqual(E.estBorne(SEA, id), true); assert.strictEqual(E.dansLeChamp(SEA, id), true); assert.strictEqual(E.derivableDeLOrigine(SEA, id), true); }
    assert.strictEqual(E.estBorne(SEA, 901075), false); assert.strictEqual(E.dansLeChamp(SEA, 901075), false);
    assert.strictEqual(E.estBorne('WCD-2009', 901074), false); assert.strictEqual(E.dansLeChamp('WCD-2009', 901074), false);
});
t('verifierBornes : un set à liste fermée absent de la base lève et le nomme ; verifierPerimetre reste celui des 9 sets', () => {
    const expl = [...Object.keys(E.ORIGINES_EXPLICITES), ...Object.keys(E.ORIGINES_WCD)];
    assert.doesNotThrow(() => E.verifierBornes([...E.PERIMETRE, SEA, ...expl])); assert.throws(() => E.verifierBornes([...E.PERIMETRE, ...expl]), /Southeast-Asia-Promos/); assert.throws(() => E.verifierBornes([]), /introuvable/);
    assert.doesNotThrow(() => E.verifierPerimetre(E.PERIMETRE));
});
t('SEA : les 3 produits de la liste reçoivent une entrée dérivée de leur origine (set d\'origine, numéro d\'origine, « en »), imageEmprunteeTirage, SANS tamponNonRepresente, SANS champ nouveau', () => {
    const p = plan(etatSEA(LES_TROIS.map(id => ligneSEA(id))));
    assert.strictEqual(p.ajouts.length, 1); assert.deepStrictEqual([...p.ajouts[0].produits].sort(), LES_TROIS);   // même carte, même origine : UNE entrée pour les trois lignes
    assert.strictEqual(p.refus.length, 0); assert.strictEqual(p.horsListe, 0); assert.strictEqual(p.sansSubstitut.length, 0);
    const e = p.ajouts[0].entree;
    assert.strictEqual(e.set, SEA); assert.strictEqual(e.numero, null); assert.strictEqual(e.cleR2, 'tcgdex/Stellar-Crown/135-1.webp'); assert.strictEqual(e.w, 600); assert.strictEqual(e.h, 825);
    assert.strictEqual(e.imageEmprunteeTirage, true); assert.strictEqual(e.source, 'emprunt'); assert.strictEqual(e.lot, 'emprunt-2026-10'); assert.strictEqual(e.langue, 'en'); assert(!('tamponNonRepresente' in e));
    assert.deepStrictEqual(e.vignette, oriSCR().vignette);
    // les clés sont EXACTEMENT celles des entrées Trick or Trade : aucun champ inventé
    assert.deepStrictEqual(Object.keys(e).sort(), Object.keys(plan(etatToT([ligneToT(20)])).ajouts[0].entree).sort());
    assert.strictEqual(p.parSet[SEA].ajouts, 1); assert.strictEqual(p.parSet[SEA].cibles, 3);
    assert.strictEqual(E.operationsVersMongo(p).length, 1);
});
t('SEA : un 4e produit du set HORS liste (ou un autre produit réimprimé) → RIEN : ni entrée, ni refus, compté « hors liste »', () => {
    const p = plan(etatSEA([ligneSEA(901075), ligneSEA(901111, { _id: '1|901111' }), ligneSEA(1)]));
    assert.strictEqual(p.ajouts.length, 0); assert.strictEqual(p.refus.length, 0); assert.strictEqual(p.horsListe, 3); assert.strictEqual(p.horsPerimetre, 0); assert.strictEqual(E.operationsVersMongo(p).length, 0);
    const mix = plan(etatSEA([ligneSEA(901074), ligneSEA(901075, { carteId: 2, _id: '2|901075' })]));   // le 4e produit est sur UNE AUTRE carte : il ne partage pas l'entrée
    assert.strictEqual(mix.ajouts.length, 1); assert.deepStrictEqual(mix.ajouts[0].produits, [901074]); assert.strictEqual(mix.horsListe, 1); assert.strictEqual(mix.refus.length, 0);
});
t('SEA : un FRÈRE hors liste sur la même carte et le même set (l\'entrée est par carte et par set) → REFUS nommé, rien posé — le piège mesuré le 24/10 (4 frères V1/V2 des 3 produits)', () => {
    const p = plan(etatSEA([ligneSEA(901074), ligneSEA(901075, { _id: '1|901075' })]));
    assert.strictEqual(p.ajouts.length, 0); assert.strictEqual(p.refus.length, 1); assert.deepStrictEqual(p.refus[0].freres, [901075]); assert(/HORS de la liste fermée : 901075/.test(p.refus[0].raison), p.refus[0].raison);
    assert.deepStrictEqual(p.refus[0].produits, [901074]); assert.strictEqual(E.operationsVersMongo(p).length, 0);
    // deux cartes, chacune avec un frère hors liste : deux refus, aucune entrée
    const trois = plan({ ...etat([ligneSEA(901074), ligneSEA(901075, { _id: '1|901075' }), ligneSEA(901104, { carteId: 2, _id: '2|901104' }), ligneSEA(901111, { carteId: 2, _id: '2|901111' })], [carte([oriSCR()], 1), carte([oriSCR()], 2)]), produits: new Map([[785989, { slugSet: 'Stellar-Crown' }]]) });
    assert.strictEqual(trois.ajouts.length, 0); assert.strictEqual(trois.refus.length, 2);
    // si la liste COUVRE tous les produits de la carte dans le set, la même carte passe (preuve que le refus est celui du frère, pas de la carte)
    const couvert = plan(etatSEA([ligneSEA(901074), ligneSEA(901104, { _id: '1|901104' }), ligneSEA(901109, { _id: '1|901109' })]));
    assert.strictEqual(couvert.ajouts.length, 1); assert.strictEqual(couvert.refus.length, 0);
    // un frère d'un AUTRE set de la même carte ne compte pas
    assert.strictEqual(plan(etatSEA([ligneSEA(901074), ligneSEA(901075, { _id: '1|901075', slugSet: PP })])).ajouts.length, 1);
});
t('SEA : une cible de la liste sans origine lisible, ou dont l\'origine n\'a pas UNE entrée « en » → refus nommé, aucune entrée', () => {
    for (const [lignes, images, o] of [[[ligneSEA(901074, { detail: 'rien', origine: undefined })], undefined, {}], [[ligneSEA(901074)], [], {}], [[ligneSEA(901074)], [oriSCR(), oriSCR({ cleR2: 'tcgdex/Stellar-Crown/135b-1.webp' })], {}], [[ligneSEA(901074)], [oriSCR({ langue: 'ja' })], {}], [[ligneSEA(901074)], undefined, { produits: new Map() }]]) {
        const p = plan(etatSEA(lignes, images, o));
        assert.strictEqual(p.ajouts.length, 0); assert.strictEqual(p.refus.length, 1); assert(/Trick|origine|entrée|image/.test(p.refus[0].raison), p.refus[0].raison);
    }
});
t('SEA : une entrée déjà posée dans le set (empruntée ou vrai scan) couvre la ligne → « déjà », rien à réécrire', () => {
    const p = plan(etatSEA([ligneSEA(901074)], [oriSCR(), { set: SEA, source: 'pokumon', cleR2: 'v.webp', numero: null }]));
    assert.strictEqual(p.ajouts.length, 0); assert.strictEqual(p.deja.length, 1);
    const apres = E.appliquer(etatSEA(LES_TROIS.map(id => ligneSEA(id))), plan(etatSEA(LES_TROIS.map(id => ligneSEA(id)))));
    assert.strictEqual(E.planifier({ ...etatSEA(LES_TROIS.map(id => ligneSEA(id))), cartes: apres.cartes }).ajouts.length, 0);   // idempotent : le plan relu est vide
});
t('--sets : la sélection restreint le plan (aucune ligne des autres sets n\'est planifiée), les autres lignes sont COMPTÉES ; sans sélection : comportement d\'origine', () => {
    const lignes = [ligne(10, PP), ...LES_TROIS.map(id => ligneSEA(id, { _id: `1|${id}` }))];
    const tout = plan(etatSEA(lignes, [oriSCR(), origine]));
    assert.strictEqual(tout.ajouts.length, 2); assert.strictEqual(tout.horsSelection, 0);
    const seul = E.planifier(etatSEA(lignes, [oriSCR(), origine]), { maintenant: NOW, sets: [SEA] });
    assert.deepStrictEqual(seul.ajouts.map(a => a.set), [SEA]); assert.strictEqual(seul.horsSelection, 1); assert.strictEqual(E.operationsVersMongo(seul).length, 1); assert(!(PP in seul.parSet));
    const pp = E.planifier(etatSEA(lignes, [oriSCR(), origine]), { maintenant: NOW, sets: [PP] });
    assert.deepStrictEqual(pp.ajouts.map(a => a.set), [PP]); assert.strictEqual(pp.horsSelection, 3);
    // WCD : refusé et compté même hors sélection (jamais écrit)
    assert.strictEqual(E.planifier(etatSEA([ligneSEA(901074, { slugSet: 'WCD-2024' })]), { sets: [SEA] }).refusWCD.length, 1);
});
t('verifierSelection : vide, doublon ou set hors du champ de lecture → LÈVE (jamais « tout » par défaut)', () => {
    assert.doesNotThrow(() => E.verifierSelection([SEA])); assert.doesNotThrow(() => E.verifierSelection([SEA, PP]));
    assert.throws(() => E.verifierSelection([]), /vide/); assert.throws(() => E.verifierSelection([SEA, SEA]), /doublon/); assert.throws(() => E.verifierSelection(['Scarlet-Violet']), /hors du champ/); assert.throws(() => E.verifierSelection(['WCD-2009']), /hors du champ/);
    assert.throws(() => E.planifier(etatSEA([]), { sets: [] }), /vide/);
});
t('script : --sets est validé avant toute connexion (set hors champ → exit 2) et passé au plan ET à la relecture', () => {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'poser-images-empruntees.js'), '--sets=WCD-2009'], { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 30000 });
    assert.strictEqual(r.status, 2); assert(/hors du champ/.test(r.stderr));
    const r2 = spawnSync(process.execPath, [path.join(__dirname, 'poser-images-empruntees.js'), '--sets='], { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 30000 });
    assert.strictEqual(r2.status, 2);
    const src = require('fs').readFileSync(path.join(__dirname, 'poser-images-empruntees.js'), 'utf8');
    assert.strictEqual((src.match(/E\.planifier\(.*\{ sets: SELECTION \}\)/g) || []).length, 2);
});
t('SEA : WCD reste refusé, et un set homonyme (« Southeast-Asia-Promos-2 ») n\'est pas dans le champ', () => {
    assert.strictEqual(plan(etatSEA([ligneSEA(901074, { slugSet: 'WCD-2024' })])).refusWCD.length, 1);
    const p = plan(etatSEA([ligneSEA(901074, { slugSet: 'Southeast-Asia-Promos-2' })])); assert.strictEqual(p.ajouts.length, 0); assert.strictEqual(p.horsPerimetre, 1);
});
t('SEA : manifeste et retrait EXACTS — le retrait ne retire que l\'entrée posée par ce lot (même set, clé, source, lot, numéro)', () => {
    const e = etatSEA(LES_TROIS.map(id => ligneSEA(id))), p = plan(e), m = E.manifeste(p);
    assert.deepStrictEqual(m, { marque: 'emprunt-2026-10', sets: null, entrees: [{ carteId: 1, set: SEA, numero: null, cleR2: 'tcgdex/Stellar-Crown/135-1.webp', produits: LES_TROIS }] });
    const ap = E.appliquer(e, p); const c = ap.cartes.get(1);
    c.images.push({ set: SEA, source: 'pokumon', cleR2: 'tcgdex/Stellar-Crown/135-1.webp', numero: null }, { set: SEA, source: 'emprunt', lot: 'autre-lot', cleR2: 'tcgdex/Stellar-Crown/135-1.webp', numero: null, imageEmprunteeTirage: true });
    const r = E.retirer({ cartes: ap.cartes }, m).cartes.get(1);
    assert.strictEqual(r.images.length, 4); assert(!r.images.some(x => x.lot === 'emprunt-2026-10'));   // les 2 d'origine + les 2 autres du set : rien d'autre n'est retiré
    assert.deepStrictEqual(E.operationsDeRetrait(m)[0].update.$pull.images, { set: SEA, cleR2: 'tcgdex/Stellar-Crown/135-1.webp', source: 'emprunt', lot: 'emprunt-2026-10', imageEmprunteeTirage: true, numero: null });
});
t('produitsHorsChamp : un plan qui contiendrait un produit hors liste (ou un WCD) est nommé ; le plan réel de planifier() n\'en contient jamais', () => {
    assert.deepStrictEqual(E.produitsHorsChamp({ ajouts: [{ set: SEA, produits: [901074, 901075] }, { set: 'WCD-2009', produits: [1] }, { set: PP, produits: [2] }] }), [`${SEA}:901075`, 'WCD-2009:1']);
    assert.deepStrictEqual(E.produitsHorsChamp(plan(etatSEA([...LES_TROIS, 901075].map(id => ligneSEA(id))))), []);
    assert.deepStrictEqual(E.produitsHorsChamp({ ajouts: [] }), []);
});
t('verdictApi : les produits du plan peuvent sortir de l\'API (image empruntée = jamais servie à l\'identification), RIEN d\'autre', () => {
    const PV = require('./collecte-cartes/phase2-visuels');
    const sig = (id, o = {}) => ({ idProduct: id, visuel: 'autre-tirage', grande: { cle: `g/${id}` }, vignette: { cle: `v/${id}` }, ...o });
    const avant = [sig(1), sig(2), sig(3)], plan3 = [1, 2];
    const juge = (apres, contratNouveaux = 0) => E.verdictApi({ cmp: PV.compareEntrees(avant, apres, plan3), idsPlan: plan3, contratNouveaux });
    assert.strictEqual(juge([sig(3)]).ok, true);                                  // 1 et 2 sortent, 3 inchangé
    assert.strictEqual(juge([sig(2), sig(3)]).ok, true);                          // un seul du plan sort : permis
    assert.strictEqual(juge([sig(1), sig(2), sig(3)]).ok, true);                  // rien ne sort (déjà non servis) : permis
    assert(/HORS du plan : 3/.test(juge([]).raisons.join()));                     // 3 perdu : refusé
    assert(/changés : 3/.test(juge([sig(3, { visuel: 'du-set' })]).raisons.join()));
    assert(/gagnés : 9/.test(juge([sig(3), sig(9)]).raisons.join()));
    assert(/refus nouveau/.test(juge([sig(3)], 2).raisons.join()));
    assert.strictEqual(juge([sig(3)], 0).ok, true);
});
t('le script lit les sets à liste fermée et dérive de l\'origine ces seuls produits (aucune lecture ni écriture hors liste)', () => {
    const src = require('fs').readFileSync(path.join(__dirname, 'poser-images-empruntees.js'), 'utf8');
    assert(/collection\('sets'\)\.find\(\{ _id: \{ \$in: \[\.\.\.E\.SETS_LUS\] \}/.test(src) && /collection\('cartes'\)\.find\(\{ sets: \{ \$in: \[\.\.\.E\.SETS_LUS\] \}/.test(src) && /E\.verifierBornes\(/.test(src) && /E\.derivableDeLOrigine\(/.test(src));
    assert(/if \(!vApi\.ok\) \{[^\n]*process\.exitCode = 1; return;/.test(src) && /E\.verdictApi\(/.test(src));   // le verdict de l'API arrête avant toute écriture
    assert(/if \(horsChamp\.length\) \{[^\n]*process\.exitCode = 1; return;/.test(src));
});
// ── TOUR 1 (24/10) : D4.1 la mention SERVIE, D4.2 --ecrire exige --sets
const imageServieDeSite = (images, url, setSlug) => {   // la règle du site (lib/tamponNonRepresente.ts, avec le set de la fiche) : la plus longue clé, puis l'entrée du set de la fiche
    let cands = [], l = 0;
    for (const i of images || []) { const k = i?.cleR2; if (typeof k !== 'string' || !k || !url.endsWith(`/${k}`)) continue; if (k.length > l) { cands = [i]; l = k.length; } else if (k.length === l) cands.push(i); }
    return (setSlug && cands.find(i => i.set === setSlug)) || cands[0] || null;
};
const mentionSite = v => (v && v.imageEmprunteeTirage === true ? 'tampon non représenté' : null);
t('D4.1 mentionServie : la fiche du set de la réimpression sert l\'entrée EMPRUNTÉE (même clé que l\'origine, qui la précède) -> mention ; sans le set (ancienne chaîne) -> aucune ; l\'origine garde la sienne SANS mention', () => {
    const e = etatSEA(SEPT.map(id => ligneSEA(id, { _id: `1|${id}` }))); const p = plan(e); const imgs = E.appliquer(e, p).cartes.get(1).images;
    const cle = p.ajouts[0].entree.cleR2;
    const r = E.mentionServie({ images: imgs, cleR2: cle, set: SEA, imageServieDe: imageServieDeSite, mentionDuVisuelEmprunte: mentionSite });
    assert.strictEqual(r.reelle, 'tampon non représenté'); assert.strictEqual(r.siCorrectif, 'tampon non représenté'); assert.strictEqual(r.sansSet, null);
    const origineFiche = E.mentionServie({ images: imgs, cleR2: cle, set: 'Stellar-Crown', imageServieDe: imageServieDeSite, mentionDuVisuelEmprunte: mentionSite });
    assert.strictEqual(origineFiche.reelle, null);   // la vraie fiche Stellar Crown ne reçoit JAMAIS la mention
});
t('D4.1 produitsSansMention : un produit du plan dont la fiche ne sert pas l\'image avec sa mention est NOMMÉ ; tous servis avec mention -> liste vide', () => {
    const p = { ajouts: [{ carteId: 1, set: SEA, produits: [901074, 901104] }, { carteId: 2, set: SEA, produits: [901109] }] };
    assert.deepStrictEqual(E.produitsSansMention(p, () => 'tampon non représenté'), []);
    assert.deepStrictEqual(E.produitsSansMention(p, (c, s, id) => (id === 901104 ? null : 'x')), [901104]);
    assert.deepStrictEqual(E.produitsSansMention(p, () => undefined), [901074, 901104, 901109]);   // « ne sait pas » = pas de mention : fail-closed
    assert.deepStrictEqual(E.produitsSansMention({ ajouts: [] }, () => null), []);
});
t('D4.2 manifeste : porte la sélection ; memeSelection compare sans l\'ordre, refuse un manifeste sans sélection ou une autre', () => {
    const p = plan(etatSEA(SEPT.map(id => ligneSEA(id, { _id: `1|${id}` }))));
    assert.deepStrictEqual(E.manifeste(p, { sets: [SEA] }).sets, [SEA]); assert.strictEqual(E.manifeste(p).sets, null);
    assert.strictEqual(E.memeSelection(E.manifeste(p, { sets: [SEA, PP] }), [PP, SEA]), true);
    assert.strictEqual(E.memeSelection(E.manifeste(p, { sets: [SEA] }), [PP]), false);
    assert.strictEqual(E.memeSelection(E.manifeste(p), [SEA]), false);          // simulée sans sélection, écrite avec : refusé
    assert.strictEqual(E.memeSelection(E.manifeste(p, { sets: [SEA] }), null), false);
    assert.strictEqual(E.memeSelection(null, [SEA]), false);
});
t('D4.2 script : --ecrire sans --sets explicite -> exit 2 « exige --sets » AVANT toute connexion (sous lot-additif) ; --retirer --ecrire aussi', () => {
    const sousLot = { PATH: process.env.PATH, LOT_ADDITIF_PID: String(process.pid) };
    const runLot = (...a) => spawnSync(process.execPath, [path.join(__dirname, 'poser-images-empruntees.js'), ...a], { encoding: 'utf8', env: sousLot, timeout: 30000 });
    let r = runLot('--ecrire', '--attendu=3'); assert.strictEqual(r.status, 2, r.stderr); assert(/exige --sets/.test(r.stderr), r.stderr);
    r = runLot('--retirer', '--ecrire', '--attendu=3'); assert.strictEqual(r.status, 2, r.stderr); assert(/exige --sets/.test(r.stderr), r.stderr);
    const src = require('fs').readFileSync(path.join(__dirname, 'poser-images-empruntees.js'), 'utf8');
    assert(/E\.memeSelection\(/.test(src) && /E\.produitsSansMention\(/.test(src));
    assert(/if \(simule !== null && !E\.memeSelection\(JSON\.parse\(simule\), SELECTION\)\) \{[^\n]*process\.exitCode = 1; return;/.test(src));   // l'écriture compare la sélection du manifeste à celle du jour
    assert(/if \(ECRIRE && !E\.memeSelection\(m, SELECTION\)\) \{[^\n]*process\.exitCode = 1; return;/.test(src));   // le retrait aussi
    assert(/if \(sansMention\.length\) \{[^\n]*process\.exitCode = 1; return;/.test(src));                            // un produit sans mention arrête
    assert(/cleR2: b\.cleR2, set, imageServieDe: T\.imageServieDe, mentionDuVisuelEmprunte: T\.mentionDuVisuelEmprunte \}\)\.reelle/.test(src));   // la mention se rejoue AVEC le set de la fiche
});

// ── API-52 L1 (25/10) : Masaki CLK/CLF — liste FERMÉE de produits à ORIGINE EXPLICITE (jamais dérivée du detail de la ligne)
const CLK = 'Pokemon-Card-Game-Classic-Blastoise-Suicune-ex-Deck', CLF = 'Pokemon-Card-Game-Classic-Venusaur-Lugia-ex-Deck', CLL = 'Pokemon-Card-Game-Classic-Charizard-Ho-Oh-ex-Deck';
const oriCLL = (o = {}) => ({ set: CLL, source: 'artofpkm', cleR2: 'artofpkm/677/30.webp', numero: '030', langue: 'ja', w: 1432, h: 2000, vignette: { cleR2: 'vignettes/artofpkm/677/30.webp', w: 200, h: 279 }, ...o });
const ligneMasaki = (idProduct, slugSet, o = {}) => ({ _id: `12097|${idProduct}`, carteId: 12097, idProduct, slugSet, preuve: 'setlist+numero', numeroFiche: null, detail: 'slug Bill-CLK-030 → « Bill (Base Set 91) »', ...o });
const etatMasaki = (lignes, images = [oriCLL()], o = {}) => ({ ...etat(lignes, [carte(images, 12097)]), ...o });
t('L1 : la liste fermée à origine explicite est exactement 744655 (CLK) et 743194 (CLF), origine carte 12097 / CLL / n°030 / artofpkm/677/30.webp (produit 744621)', () => {
    assert.deepStrictEqual(Object.keys(E.ORIGINES_EXPLICITES).sort(), [CLF, CLK].sort());
    assert.strictEqual(Object.keys(E.ORIGINES_EXPLICITES[CLK]).length, 9); assert.strictEqual(Object.keys(E.ORIGINES_EXPLICITES[CLF]).length, 10); assert(E.ORIGINES_EXPLICITES[CLK][744655] && E.ORIGINES_EXPLICITES[CLF][743194]);   // L1b : 19 produits, dont les deux Masaki
    for (const o of [E.ORIGINES_EXPLICITES[CLK][744655], E.ORIGINES_EXPLICITES[CLF][743194]]) assert.deepStrictEqual({ ...o }, { carteId: 12097, setOrigine: CLL, numero: '030', cleR2: 'artofpkm/677/30.webp', produitOrigine: 744621 });
    assert.throws(() => { 'use strict'; E.ORIGINES_EXPLICITES[CLK][1] = {}; }); assert.throws(() => { 'use strict'; E.ORIGINES_EXPLICITES[CLK][744655].cleR2 = 'x'; });
    assert.strictEqual(E.PERIMETRE.length, 9); assert.deepStrictEqual(Object.keys(E.SETS_BORNES), [SEA]);
    assert(E.SETS_LUS.includes(CLK) && E.SETS_LUS.includes(CLF)); assert.strictEqual(E.setBorne(CLK), true);
    assert.strictEqual(E.estBorne(CLK, 744655), true); assert.strictEqual(E.estBorne(CLK, 743194), false); assert.strictEqual(E.estBorne(CLF, 743194), true); assert.strictEqual(E.estBorne(CLF, 744655), false);
    assert.strictEqual(E.dansLeChamp(CLK, 744655), true); assert.strictEqual(E.dansLeChamp(CLK, 1), false);
    assert.strictEqual(E.derivableDeLOrigine(CLK, 744655), false);   // jamais dérivée du detail
});
t('L1 : un produit de CLK/CLF reçoit UNE entrée empruntée, depuis l\'origine EXPLICITE (et non « Bill (Base Set 91) » du detail), langue de l\'origine, sans champ neuf', () => {
    const p = plan(etatMasaki([ligneMasaki(744655, CLK), ligneMasaki(743194, CLF)]));
    assert.strictEqual(p.refus.length, 0, JSON.stringify(p.refus)); assert.strictEqual(p.ajouts.length, 2);
    for (const a of p.ajouts) {
        const e = a.entree;
        assert.strictEqual(e.cleR2, 'artofpkm/677/30.webp'); assert.strictEqual(e.w, 1432); assert.strictEqual(e.h, 2000); assert.strictEqual(e.langue, 'ja');
        assert.strictEqual(e.imageEmprunteeTirage, true); assert.strictEqual(e.source, 'emprunt'); assert.strictEqual(e.lot, 'emprunt-2026-10'); assert(!('tamponNonRepresente' in e)); assert.strictEqual(e.numero, null);
        assert.deepStrictEqual(e.vignette, oriCLL().vignette);
        assert.deepStrictEqual(Object.keys(e).sort(), [...Object.keys(plan(etatSEA([ligneSEA(901074)])).ajouts[0].entree), 'differenceEmprunt'].sort());   // L1b : le seul champ de plus est le motif autre-tirage
    }
    assert.deepStrictEqual(p.ajouts.map(a => a.set).sort(), [CLF, CLK].sort());
    assert.strictEqual(E.operationsVersMongo(p).length, 2); assert.strictEqual(p.horsPerimetre, 0);
});
t('L1 : origine ABSENTE, DIFFÉRENTE (autre clé, autre set, autre numéro) ou entrée sans taille → refus nommé, aucune entrée', () => {
    for (const images of [[], [oriCLL({ cleR2: 'artofpkm/677/31.webp' })], [oriCLL({ set: 'Autre' })], [oriCLL({ numero: '031' })], [oriCLL({ w: undefined })], [oriCLL(), oriCLL()], [oriCLL({ langue: null })]]) {
        const p = plan(etatMasaki([ligneMasaki(744655, CLK)], images));
        assert.strictEqual(p.ajouts.length, 0, JSON.stringify(images)); assert.strictEqual(p.refus.length, 1); assert(/origine explicite/.test(p.refus[0].raison), p.refus[0].raison);
    }
});
t('L1 : la ligne doit porter la carte de l\'origine (12097) ; une autre carte → refus', () => {
    const p = plan({ ...etat([ligneMasaki(744655, CLK, { carteId: 5 })], [carte([oriCLL()], 5)]) });
    assert.strictEqual(p.ajouts.length, 0); assert.strictEqual(p.refus.length, 1); assert(/12097/.test(p.refus[0].raison), p.refus[0].raison);
});
t('L1 : tout autre produit de CLK/CLF est HORS LISTE (compté, jamais écrit) ; un frère de la même carte dans le set → refus (l\'entrée est par carte et par set)', () => {
    const p = plan(etatMasaki([ligneMasaki(111, CLK, { _id: 'x' }), ligneMasaki(743194, CLK, { _id: 'y' })]));
    assert.strictEqual(p.ajouts.length, 0); assert.strictEqual(p.refus.length, 0); assert.strictEqual(p.horsListe, 2);
    const f = plan(etatMasaki([ligneMasaki(744655, CLK), ligneMasaki(111, CLK, { _id: 'x' })]));
    assert.strictEqual(f.ajouts.length, 0); assert.strictEqual(f.refus.length, 1); assert.deepStrictEqual(f.refus[0].freres, [111]);
});
t('L1 : déjà couvert par une entrée du set → « déjà » ; idempotent ; retrait exact (manifeste) ; WCD toujours refusé', () => {
    const e = etatMasaki([ligneMasaki(744655, CLK)]); const p = plan(e);
    assert.strictEqual(p.ajouts.length, 1); const ap = E.appliquer(e, p);
    assert.strictEqual(E.planifier({ ...e, cartes: ap.cartes }).ajouts.length, 0); assert.strictEqual(E.planifier({ ...e, cartes: ap.cartes }).deja.length, 1);
    const m = E.manifeste(p); assert.deepStrictEqual(E.retirer({ cartes: ap.cartes }, m).cartes.get(12097), e.cartes.get(12097));
    assert.strictEqual(plan(etatMasaki([ligneMasaki(744655, 'WCD-2009')])).refusWCD.length, 1);
});
t('L1 : verifierBornes exige aussi les sets à origine explicite ; verifierSelection les accepte ; les autres sets de Classic restent hors champ', () => {
    const W = Object.keys(E.ORIGINES_WCD);   // 27/10 : les sets WCD de la liste fermée sont exigés aussi
    assert.doesNotThrow(() => E.verifierBornes([SEA, CLK, CLF, ...W])); assert.throws(() => E.verifierBornes([SEA, CLK, ...W]), /Pokemon-Card-Game-Classic-Venusaur/); assert.throws(() => E.verifierBornes([CLK, CLF, ...W]), /Southeast/);
    assert.throws(() => E.verifierBornes([SEA, CLK, CLF, ...W.slice(1)]), new RegExp(W[0]));
    assert.doesNotThrow(() => E.verifierSelection([CLK, CLF])); assert.throws(() => E.verifierSelection([CLL]), /hors du champ/);
});
t('L1 : produitsHorsChamp nomme un produit de CLK hors liste ; le plan réel n\'en contient jamais', () => {
    assert.deepStrictEqual(E.produitsHorsChamp({ ajouts: [{ set: CLK, produits: [744655, 5] }] }), [`${CLK}:5`]);
    assert.deepStrictEqual(E.produitsHorsChamp(plan(etatMasaki([ligneMasaki(744655, CLK), ligneMasaki(5, CLK, { _id: 'z' })]))), []);
});

// ── API-52 L1b (25/10, décision du testeur) : les 19 produits CLF/CLK, motif « autre tirage » (et non « tampon »), liste fermée à origine explicite PAR PRODUIT
const CLK_IDS = [744643, 744644, 744645, 744647, 744648, 744649, 744653, 744654, 744655], CLF_IDS = [743182, 743183, 743184, 743185, 743186, 743187, 743188, 743191, 743193, 743194];
const JUMEAUX = { 24167: ['019', 744610], 148517: ['020', 744611], 15638: ['021', 744612], 43839: ['022', 744613], 25165: ['023', 744614], 15381: ['024', 744615], 17965: ['025', 744616], 29870: ['028', 744619], 248285: ['029', 744620], 12097: ['030', 744621] };
const CARTE_DE = { 744643: 24167, 744644: 148517, 744645: 15638, 744647: 25165, 744648: 15381, 744649: 17965, 744653: 29870, 744654: 248285, 744655: 12097, 743182: 24167, 743183: 148517, 743184: 15638, 743185: 43839, 743186: 25165, 743187: 15381, 743188: 17965, 743191: 29870, 743193: 248285, 743194: 12097 };
t('L1b : la liste fermée est exactement les 19 produits (9 CLK, 10 CLF) ; chaque origine = carte du produit, CLL, numéro du jumeau CLL, artofpkm/677/<n>.webp, produit CLL jumeau ; 606901 EXP. ALL n\'en est pas', () => {
    assert.deepStrictEqual(Object.keys(E.ORIGINES_EXPLICITES[CLK]).map(Number).sort(), [...CLK_IDS].sort()); assert.deepStrictEqual(Object.keys(E.ORIGINES_EXPLICITES[CLF]).map(Number).sort(), [...CLF_IDS].sort());
    for (const [set, ids] of [[CLK, CLK_IDS], [CLF, CLF_IDS]]) for (const id of ids) {
        const [num, jumeau] = JUMEAUX[CARTE_DE[id]];
        assert.deepStrictEqual({ ...E.ORIGINES_EXPLICITES[set][id] }, { carteId: CARTE_DE[id], setOrigine: CLL, numero: num, cleR2: `artofpkm/677/${Number(num)}.webp`, produitOrigine: jumeau }, String(id));
    }
    assert.strictEqual(E.dansLeChamp(CLK, 606901), false); assert.strictEqual(E.dansLeChamp(CLF, 606901), false); assert.strictEqual(E.dansLeChamp(CLK, 744646), false);   // VS Seeker CLK a déjà son entrée : hors liste
});
t('L1b : chaque entrée porte differenceEmprunt « autre-tirage », PAS de tamponNonRepresente, et un languePreuve qui dit « autre tirage » sans « tampon »', () => {
    const p = plan(etatMasaki([ligneMasaki(744655, CLK), ligneMasaki(743194, CLF)]));
    assert.strictEqual(p.ajouts.length, 2);
    for (const a of p.ajouts) { const e = a.entree; assert.strictEqual(e.differenceEmprunt, 'autre-tirage'); assert(!('tamponNonRepresente' in e)); assert(/autre tirage/.test(e.languePreuve) && /code de deck différent/.test(e.languePreuve) && !/tampon/i.test(e.languePreuve), e.languePreuve); assert.strictEqual(e.imageEmprunteeTirage, true); assert.strictEqual(e.langue, 'ja'); }
    assert.strictEqual(E.MOTIF_AUTRE_TIRAGE, 'autre-tirage');
});
t('L1b : aucune entrée Prize Pack / Battle Academy / Trick or Trade / Southeast-Asia ne change (ni differenceEmprunt, ni languePreuve)', () => {
    const p = plan(etat([ligne(10, PP), ligne(11, BA, { _id: '1|11' })])); const s = plan(etatSEA(LES_TROIS.map(id => ligneSEA(id)))); const tt = plan(etatToT([ligneToT(20)]));
    for (const a of [...p.ajouts, ...s.ajouts, ...tt.ajouts]) { assert(!('differenceEmprunt' in a.entree), a.set); assert.strictEqual(a.entree.languePreuve, 'image du tirage normal empruntée (tampon non représenté)'); }
});
t('L1b : la garde de mention ne nomme PAS les entrées autre-tirage ; elle nomme toujours les autres emprunts sans mention ; produitsMentionEnAttente compte les premières', () => {
    const p = { ajouts: [{ carteId: 1, set: CLK, produits: [744655, 744654], entree: { differenceEmprunt: 'autre-tirage' } }, { carteId: 2, set: SEA, produits: [901074], entree: {} }] };
    assert.deepStrictEqual(E.produitsSansMention(p, () => null), [901074]);
    assert.deepStrictEqual(E.produitsSansMention(p, () => 'tampon non représenté'), []);
    assert.deepStrictEqual(E.produitsMentionEnAttente(p), [744655, 744654]);
    assert.deepStrictEqual(E.produitsMentionEnAttente({ ajouts: [] }), []);
});
t('L1b : le script imprime « mention en attente du site (autre tirage) : N produits » et garde l\'arrêt pour les autres emprunts', () => {
    const src = require('fs').readFileSync(path.join(__dirname, 'poser-images-empruntees.js'), 'utf8');
    assert(/mention en attente du site \(autre tirage\) : \$\{enAttente\.length\} produits/.test(src));
    assert(/if \(sansMention\.length\) \{[^\n]*process\.exitCode = 1; return;/.test(src));
});
t('le script ne contient aucun vrai chemin du testeur dans ce banc et n\'ouvre aucun réseau', () => {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(__dirname, 'poser-images-empruntees.js'), 'utf8') + fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'images-empruntees.js'), 'utf8');
    assert(!/Logo FR|apport-manuel|Desktop[\\/]LOGO/.test(src));
    assert(!/require\(['"](axios|https?|node-fetch|undici)['"]\)|\bfetch\(/.test(src));
});

// ── WCD (décision du testeur, 27/10) : un WCD dont la carte d'ORIGINE est prouvée (deux sources de données + concordance à l'image lue) reçoit le visuel d'origine, motif « autre tirage ».
// LISTE FERMÉE PAR PRODUIT (collecte-cartes/origines-wcd.json) ; tout autre WCD reste refusé.
const WS = 'WCD-2018', WID = 863158;   // Drampa-GX WCD 2018 → Guardians Rising n°115
const oriGRI = (o = {}) => ({ set: 'Guardians-Rising', source: 'tcgdex', cleR2: 'tcgdex/Guardians-Rising/115-220753.webp', numero: '115', langue: 'en', w: 600, h: 825, vignette: { cleR2: 'vignettes/tcgdex/Guardians-Rising/115-220753.webp', w: 200, h: 275 }, ...o });
const ligneWCD = (idProduct, o = {}) => ({ _id: `220753|${idProduct}`, carteId: 220753, idProduct, slugSet: WS, preuve: 'wcd+origine+numero', numeroFiche: null, detail: 'slug Drampa-GX-WCD18GRI-115 → tirage d\'origine GRI n°115 → produit(s) 297567 → une seule carte', ...o });
const etatWCD = (lignes, images = [oriGRI()]) => etat(lignes, [carte(images, 220753)]);
t('WCD : la liste fermée est gelée, non vide, ne porte QUE des sets « WCD… », et chaque origine a exactement ses 5 champs (set d\'origine jamais WCD)', () => {
    const sets = Object.keys(E.ORIGINES_WCD); assert(sets.length > 0); assert(sets.every(E.estWCD), sets.join());
    const n = sets.reduce((s, k) => s + Object.keys(E.ORIGINES_WCD[k]).length, 0); assert.strictEqual(n, 37);
    for (const k of sets) for (const [id, o] of Object.entries(E.ORIGINES_WCD[k])) {
        assert.deepStrictEqual(Object.keys(o).sort(), ['carteId', 'cleR2', 'numero', 'produitOrigine', 'setOrigine'], id);
        assert(Number.isInteger(o.carteId) && o.carteId > 0 && Number.isInteger(o.produitOrigine) && typeof o.cleR2 === 'string' && o.cleR2 && typeof o.numero === 'string' && !E.estWCD(o.setOrigine), id);
    }
    assert.deepStrictEqual({ ...E.ORIGINES_WCD[WS][WID] }, { carteId: 220753, setOrigine: 'Guardians-Rising', numero: '115', cleR2: 'tcgdex/Guardians-Rising/115-220753.webp', produitOrigine: 297567 });
    assert.throws(() => { 'use strict'; E.ORIGINES_WCD[WS][1] = {}; }); assert.throws(() => { 'use strict'; E.ORIGINES_WCD[WS][WID].cleR2 = 'x'; }); assert.throws(() => { 'use strict'; E.ORIGINES_WCD.autre = {}; });
});
t('WCD : seuls les produits listés entrent dans le champ ; le set reste « WCD » et hors périmètre ; jamais dérivé du detail', () => {
    assert.strictEqual(E.dansLeChamp(WS, WID), true); assert.strictEqual(E.dansLeChamp(WS, 1), false); assert.strictEqual(E.dansLeChamp('WCD-2009', WID), false);
    assert.strictEqual(E.estWCD(WS), true); assert.strictEqual(E.dansLePerimetre(WS), false); assert.strictEqual(E.derivableDeLOrigine(WS, WID), false);
    assert.strictEqual(E.estBorne(WS, WID), true); assert.strictEqual(E.setBorne(WS), true);
    assert(E.SETS_LUS.includes(WS)); assert.doesNotThrow(() => E.verifierSelection([WS]));
});
t('WCD : un produit listé reçoit UNE entrée = le visuel d\'origine, « autre tirage », languePreuve WCD (signature, dos, code non représentés), sans tampon', () => {
    const p = plan(etatWCD([ligneWCD(WID)]));
    assert.strictEqual(p.refus.length, 0, JSON.stringify(p.refus)); assert.strictEqual(p.refusWCD.length, 0); assert.strictEqual(p.ajouts.length, 1);
    const e = p.ajouts[0].entree;
    assert.strictEqual(e.set, WS); assert.strictEqual(e.numero, null); assert.strictEqual(e.cleR2, 'tcgdex/Guardians-Rising/115-220753.webp'); assert.strictEqual(e.langue, 'en'); assert.strictEqual(e.w, 600);
    assert.strictEqual(e.differenceEmprunt, 'autre-tirage'); assert.strictEqual(e.imageEmprunteeTirage, true); assert(!('tamponNonRepresente' in e));
    assert.strictEqual(e.languePreuve, E.LANGUE_PREUVE_WCD); assert(/autre tirage/.test(e.languePreuve) && /signature/.test(e.languePreuve) && !/tampon/i.test(e.languePreuve), e.languePreuve);
    assert.notStrictEqual(E.LANGUE_PREUVE_WCD, E.LANGUE_PREUVE_AUTRE_TIRAGE);
    assert.deepStrictEqual(e.vignette, oriGRI().vignette);
    assert.deepStrictEqual(E.produitsMentionEnAttente(p), [WID]);
});
t('WCD : un produit NON listé d\'un set WCD reste refusé (compté) ; un frère non listé de la même carte bloque le groupe', () => {
    const p = plan(etatWCD([ligneWCD(1, { _id: 'x' })]));
    assert.strictEqual(p.ajouts.length, 0); assert.strictEqual(p.refusWCD.length, 1);
    const f = plan(etatWCD([ligneWCD(WID), ligneWCD(1, { _id: 'x' })]));
    assert.strictEqual(f.ajouts.length, 0); assert.strictEqual(f.refusWCD.length, 1); assert.strictEqual(f.refus.length, 1); assert.deepStrictEqual(f.refus[0].freres, [1]);
});
t('WCD : origine absente, autre clé, autre set, autre numéro, sans langue, ou carte différente → refus nommé, rien posé', () => {
    for (const images of [[], [oriGRI({ cleR2: 'tcgdex/x.webp' })], [oriGRI({ set: 'Autre' })], [oriGRI({ numero: '116' })], [oriGRI({ langue: null })], [oriGRI({ w: undefined })]]) {
        const p = plan(etatWCD([ligneWCD(WID)], images)); assert.strictEqual(p.ajouts.length, 0, JSON.stringify(images)); assert.strictEqual(p.refus.length, 1);
    }
    const c = plan(etat([ligneWCD(WID, { carteId: 5 })], [carte([oriGRI()], 5)])); assert.strictEqual(c.ajouts.length, 0); assert.strictEqual(c.refus.length, 1);
});
t('WCD : un visuelSubstitut présent sur la ligne (même incomplet ou d\'une autre image) ne remplace JAMAIS l\'origine listée', () => {
    for (const vs of [{ cleR2: 'tcgdex/Autre/1.webp', w: 600, h: 825 }, { cleR2: 'tcgdex/Autre/1.webp' }]) {
        const p = plan(etatWCD([ligneWCD(WID, { visuelSubstitut: vs })]));
        assert.strictEqual(p.refus.length, 0, JSON.stringify(p.refus)); assert.strictEqual(p.ajouts.length, 1); assert.strictEqual(p.ajouts[0].entree.cleR2, 'tcgdex/Guardians-Rising/115-220753.webp');
    }
});
t('WCD : la garde de forme au chargement lève sur une entrée mal formée (set non WCD, origine WCD, champ manquant, id non numérique)', () => {
    const bon = { carteId: 1, setOrigine: 'X', numero: '1', cleR2: 'a', produitOrigine: 2 };
    assert.doesNotThrow(() => E.gelerOriginesWCD({ 'WCD-2018': { 5: bon } }));
    for (const mal of [{ 'Base-Set': { 5: bon } }, { 'WCD-2018': { 5: { ...bon, setOrigine: 'WCD-2017' } } }, { 'WCD-2018': { 5: { ...bon, cleR2: '' } } }, { 'WCD-2018': { 5: { ...bon, carteId: '1' } } }, { 'WCD-2018': { x: bon } }, { 'WCD-2018': { 5: { ...bon, produitOrigine: undefined } } }])
        assert.throws(() => E.gelerOriginesWCD(mal), /mal formée/, JSON.stringify(mal));
});
t('WCD : une entrée déjà présente dans le set WCD couvre la ligne (« déjà ») ; idempotent ; retrait exact', () => {
    const d = plan(etatWCD([ligneWCD(WID)], [oriGRI(), { set: WS, source: 'ctr', cleR2: 'ctr/WCD-2018/1.webp', numero: null, langue: 'en', w: 200, h: 280 }]));
    assert.strictEqual(d.ajouts.length, 0); assert.strictEqual(d.deja.length, 1);
    const e = etatWCD([ligneWCD(WID)]); const p = plan(e); const ap = E.appliquer(e, p);
    assert.strictEqual(E.planifier({ ...e, cartes: ap.cartes }).ajouts.length, 0);
    assert.deepStrictEqual(E.retirer({ cartes: ap.cartes }, E.manifeste(p)).cartes.get(220753), e.cartes.get(220753));
});

console.log(`\n${n} ok, ${ko} échec(s)`); process.exit(ko ? 1 : 0);
