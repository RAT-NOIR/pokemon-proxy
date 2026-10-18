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
    assert.deepStrictEqual(r, { reelle: null, siCorrectif: 'tampon non représenté' });
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
t('le script ne contient aucun vrai chemin du testeur dans ce banc et n\'ouvre aucun réseau', () => {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(__dirname, 'poser-images-empruntees.js'), 'utf8') + fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'images-empruntees.js'), 'utf8');
    assert(!/Logo FR|apport-manuel|Desktop[\\/]LOGO/.test(src));
    assert(!/require\(['"](axios|https?|node-fetch|undici)['"]\)|\bfetch\(/.test(src));
});

console.log(`\n${n} ok, ${ko} échec(s)`); process.exit(ko ? 1 : 0);
