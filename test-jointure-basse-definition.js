// node test-jointure-basse-definition.js — BANC DE BOUT EN BOUT des trois jointures RÉELLES qui posent une entrée NON marquée dans `cartes.images`
// (artofpkm `joindreImages`, Bulbapedia `joindreImagesBulba`, TCGdex `joindreImagesTcgdex`) : chacune est EXÉCUTÉE telle que le worker l'exécute,
// sur des documents fabriqués. Aucune base réelle : des modèles EN MÉMOIRE (une fausse connexion, comme test-garde-worker.js / test-collecteur-tpc.js) —
// ni `test`, ni `test_scratch`, ni `cartes` ne sont ouvertes ; aucun réseau.
// Les quatre cas demandés, pour CHAQUE collecteur :
//   (a) une entrée marquée + une candidate non marquée ≥ 350 px, même set, même numéro, même langue → la candidate REMPLACE, le document marqué passe `remplace` ;
//   (b) une entrée NON marquée au même (set, numéro, langue) → rien ne bouge (son document reste `ok`) ;
//   (c) une autre langue, ou un autre numéro → la marque reste, le document reste `ok` ;
//   (d) REJEU de la jointure sur une image de basse définition, sans candidate meilleure → la marque de l'entrée RESTE (I1 : le $pull + $push d'une entrée
//       neuve l'effaçait, le site aurait agrandi l'image).
const fs = require('fs');
const os = require('os');
const path = require('path');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

// ── des modèles en mémoire : les seules formes de requête que les trois jointures emploient ─────────────────────────────
function fausseBase() {
    const cols = { cartes: new Map(), images: new Map(), restes: [], sets: new Map() };
    const lire = (o, k) => k.split('.').reduce((x, p) => x?.[p], o);
    const ecrire = (o, k, v) => { const ps = k.split('.'); let x = o; for (const p of ps.slice(0, -1)) x = x[p] ??= {}; x[ps.at(-1)] = v; };
    const accepte = (d, f) => Object.entries(f || {}).every(([k, v]) => {
        if (k === '$or') return v.some(s => accepte(d, s));
        const x = lire(d, k);
        if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
            if ('$in' in v) return Array.isArray(x) ? x.some(y => v.$in.includes(y)) : v.$in.includes(x);
            if ('$exists' in v) return (x !== undefined) === v.$exists;
            if ('$ne' in v) return x !== v.$ne;
            if ('$elemMatch' in v) return Array.isArray(x) && x.some(e => accepte(e, v.$elemMatch));
            return false;
        }
        if (v === null) return x == null;
        return Array.isArray(x) && !Array.isArray(v) ? x.includes(v) : x === v;
    });
    const appliquer = (d, u) => {
        for (const [k, v] of Object.entries(u.$set || {})) ecrire(d, k, v);
        for (const k of Object.keys(u.$unset || {})) delete d[k];
        for (const [k, v] of Object.entries(u.$pull || {})) d[k] = (d[k] || []).filter(e => !accepte(e, v));
        for (const [k, v] of Object.entries(u.$push || {})) (d[k] ??= []).push(...(v.$each || [v]));
    };
    const tous = (col, f) => [...col.values()].filter(d => accepte(d, f));
    const requete = (liste) => ({ lean: async () => structuredClone(liste), select() { return this; } });
    const modele = (col) => ({
        find: f => requete(tous(col, f)),
        findById: id => ({ select() { return this; }, lean: async () => structuredClone(col.get(id) ?? null) }),
        async updateOne(f, u, o = {}) {
            let d = tous(col, f)[0];
            if (!d) { if (!o.upsert) return { matchedCount: 0, modifiedCount: 0 }; d = { _id: f._id }; col.set(d._id, d); }
            appliquer(d, u); return { matchedCount: 1, modifiedCount: 1 };
        }
    });
    const M = {
        Carte: modele(cols.cartes), Image: modele(cols.images), Set: modele(cols.sets),
        Reste: { async deleteMany() { cols.restes.length = 0; }, async insertMany(l) { cols.restes.push(...l); } }
    };
    return { cols, M };
}

const SLUG = 'Set-Banc';
const TPC = (o = {}) => ({ set: SLUG, source: 'tpc-asie', numero: '001', cleR2: 'tpc-asie/Set-Banc/001-1-id.webp', w: 300, langue: 'id', basseDefinition: true, ...o });
const DOC_TPC = (cleR2 = 'tpc-asie/Set-Banc/001-1-id.webp') => ({ _id: `doc:${cleR2}`, source: 'tpc-asie', set: SLUG, cleR2, etat: 'ok', wOriginal: 300, w: 300, basseDefinition: true, langue: 'id' });
const imagesDe = B => B.cols.cartes.get(1).images.map(e => `${e.source}:${e.numero}:${e.langue}${e.basseDefinition ? ':basse' : ''}`);
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'jointure-bd-'));
const silencieux = async f => { const l = console.log, w = console.warn; console.log = console.warn = () => { }; try { return await f(); } finally { console.log = l; console.warn = w; } };

(async () => {
    // ════════════════ BULBAPEDIA ════════════════
    const { joindreImagesBulba } = require('./collecteur-images-bulba');
    const bulba = (o = {}) => ({ _id: 'bulba:1', source: 'bulbapedia', set: SLUG, carteId: 1, numero: '001', cleR2: 'bulbapedia/Set-Banc/001.webp', sha256: 'h', w: 600, h: 840, fmt: 'webp', wOriginal: 600, hOriginal: 840, urlOriginal: 'u', preuve: 'p', page: 'P', etat: 'ok', langue: 'id', languePreuve: 'banc', ...o });
    const semerBulba = (B, entrees, docsExtra = [], doc = bulba()) => {
        B.cols.cartes.set(1, { _id: 1, nomEn: 'Spidops', images: structuredClone(entrees) });
        for (const d of [doc, ...docsExtra]) B.cols.images.set(d._id, structuredClone(d));
        return [structuredClone(doc)];
    };
    {
        const B = fausseBase(); const ims = semerBulba(B, [TPC()], [DOC_TPC()]);
        await joindreImagesBulba(B.M, SLUG, ims);
        verifier('BULBAPEDIA (a) une entrée marquée + une candidate ≥ 350 de même set, numéro, langue → la candidate remplace', imagesDe(B), ['bulbapedia:001:id']);
        verifier('   le document marqué passe `remplace`, avec par quoi', [B.cols.images.get('doc:tpc-asie/Set-Banc/001-1-id.webp').etat, B.cols.images.get('doc:tpc-asie/Set-Banc/001-1-id.webp').remplacePar], ['remplace', { source: 'bulbapedia', cleR2: 'bulbapedia/Set-Banc/001.webp' }]);
        verifier('   la remplaçante n\'est PAS marquée (600 px)', B.cols.cartes.get(1).images[0].basseDefinition, undefined);
    }
    {
        const B = fausseBase(); const ims = semerBulba(B, [TPC({ basseDefinition: undefined })], [{ ...DOC_TPC(), basseDefinition: undefined }]);
        delete B.cols.cartes.get(1).images[0].basseDefinition; B.cols.cartes.get(1).images[0].w = 600;   // (une image saine, 600 px : face à une équivalente (600 px) elle ne bouge pas — doctrine 2026-10-17, article 4)
        await joindreImagesBulba(B.M, SLUG, ims);
        verifier('BULBAPEDIA (b) une entrée NON marquée au même (set, numéro, langue) → rien ne bouge, son document reste `ok`', [imagesDe(B), B.cols.images.get('doc:tpc-asie/Set-Banc/001-1-id.webp').etat], [['tpc-asie:001:id', 'bulbapedia:001:id'], 'ok']);
    }
    {
        const B = fausseBase(); const ims = semerBulba(B, [TPC({ langue: 'th' }), TPC({ numero: '002', cleR2: 'k2.webp' })], [{ ...DOC_TPC(), langue: 'th' }, DOC_TPC('k2.webp')]);
        await joindreImagesBulba(B.M, SLUG, ims);
        verifier('BULBAPEDIA (c) autre langue ou autre numéro → les marques restent, les documents restent `ok`',
            [imagesDe(B), B.cols.images.get('doc:tpc-asie/Set-Banc/001-1-id.webp').etat, B.cols.images.get('doc:k2.webp').etat], [['tpc-asie:001:th:basse', 'tpc-asie:002:id:basse', 'bulbapedia:001:id'], 'ok', 'ok']);
    }
    {
        // (d) le document Bulbapedia est LUI-MÊME de basse définition (300 px) : le rejeu pull+push son entrée — la marque doit survivre
        const B = fausseBase(); const doc = bulba({ wOriginal: 300, w: 300 });
        const ims = semerBulba(B, [{ set: SLUG, source: 'bulbapedia', numero: '001', cleR2: doc.cleR2, w: 300, langue: 'id', basseDefinition: true }], [], doc);
        await joindreImagesBulba(B.M, SLUG, ims);
        verifier('BULBAPEDIA (d) rejeu de la jointure sur une image de basse définition → la marque de l\'entrée RESTE', imagesDe(B), ['bulbapedia:001:id:basse']);
    }
    {
        const B = fausseBase(); const doc = bulba({ wOriginal: 300, w: 300, basseDefinition: true });   // le rattrapage a marqué le DOCUMENT
        const ims = semerBulba(B, [{ set: SLUG, source: 'bulbapedia', numero: '001', cleR2: doc.cleR2, w: 300, langue: 'id', basseDefinition: true }], [], doc);
        await joindreImagesBulba(B.M, SLUG, ims);
        verifier('   la marque posée sur le DOCUMENT par le rattrapage passe aussi à l\'entrée rejouée', imagesDe(B), ['bulbapedia:001:id:basse']);
    }
    {
        const B = fausseBase(); const ims = semerBulba(B, [], [], bulba({ wOriginal: 1000, w: 700 }));
        await joindreImagesBulba(B.M, SLUG, ims);
        verifier('   un document plafonné à 700 (original 1000) n\'est jamais marqué', imagesDe(B), ['bulbapedia:001:id']);
    }

    // ════════════════ TCGDEX ════════════════
    const { joindreImagesTcgdex } = require('./collecteur-images-tcgdex');
    const tcg = (o = {}) => ({ _id: 'tcg:1', source: 'tcgdex', set: SLUG, carteId: 1, numero: '001', cleR2: 'tcgdex/Set-Banc/001-1.webp', sha256: 'h', w: 600, h: 840, fmt: 'webp', wOriginal: 600, urlOriginal: 'u', preuve: 'p', etat: 'ok', langue: 'id', languePreuve: 'banc', ...o });
    const LANG = { langue: 'id' };
    const semerTcg = (B, entrees, docsExtra = [], doc = tcg()) => {
        B.cols.cartes.set(1, { _id: 1, nomEn: 'Spidops', images: structuredClone(entrees) });
        for (const d of [doc, ...docsExtra]) B.cols.images.set(d._id, structuredClone(d));
        return [structuredClone(doc)];
    };
    {
        const B = fausseBase(); const ims = semerTcg(B, [TPC()], [DOC_TPC()]);
        const r = await joindreImagesTcgdex(B.M, SLUG, ims, { langue: 'id', LANGUE: LANG });
        verifier('TCGDEX (a) une entrée marquée + une candidate ≥ 350 de même set, numéro, langue → la candidate remplace', imagesDe(B), ['tcgdex:001:id']);
        verifier('   le document marqué passe `remplace`, avec par quoi ; le compte remonte', [B.cols.images.get('doc:tpc-asie/Set-Banc/001-1-id.webp').etat, B.cols.images.get('doc:tpc-asie/Set-Banc/001-1-id.webp').remplacePar, r.basseDefRemplacees], ['remplace', { source: 'tcgdex', cleR2: 'tcgdex/Set-Banc/001-1.webp' }, 1]);
    }
    {
        const B = fausseBase(); const ims = semerTcg(B, [TPC()], [{ ...DOC_TPC(), basseDefinition: undefined }]);
        delete B.cols.cartes.get(1).images[0].basseDefinition; B.cols.cartes.get(1).images[0].w = 600;   // (une image saine, 600 px : face à une équivalente (600 px) elle ne bouge pas — doctrine 2026-10-17, article 4)
        await joindreImagesTcgdex(B.M, SLUG, ims, { langue: 'id', LANGUE: LANG });
        verifier('TCGDEX (b) une entrée NON marquée au même (set, numéro, langue) → rien ne bouge, son document reste `ok`', [imagesDe(B), B.cols.images.get('doc:tpc-asie/Set-Banc/001-1-id.webp').etat], [['tpc-asie:001:id', 'tcgdex:001:id'], 'ok']);
    }
    {
        const B = fausseBase(); const ims = semerTcg(B, [TPC({ langue: 'th' }), TPC({ numero: '002', cleR2: 'k2.webp' })], [{ ...DOC_TPC(), langue: 'th' }, DOC_TPC('k2.webp')]);
        await joindreImagesTcgdex(B.M, SLUG, ims, { langue: 'id', LANGUE: LANG });
        verifier('TCGDEX (c) autre langue ou autre numéro → les marques restent, les documents restent `ok`',
            [imagesDe(B), B.cols.images.get('doc:tpc-asie/Set-Banc/001-1-id.webp').etat, B.cols.images.get('doc:k2.webp').etat], [['tpc-asie:001:th:basse', 'tpc-asie:002:id:basse', 'tcgdex:001:id'], 'ok', 'ok']);
    }
    {
        const B = fausseBase(); const doc = tcg({ wOriginal: 300, w: 300 });
        const ims = semerTcg(B, [{ set: SLUG, source: 'tcgdex', numero: '001', cleR2: doc.cleR2, w: 300, langue: 'id', basseDefinition: true }], [], doc);
        await joindreImagesTcgdex(B.M, SLUG, ims, { langue: 'id', LANGUE: LANG });
        verifier('TCGDEX (d) rejeu de la jointure sur une image de basse définition → la marque de l\'entrée RESTE', imagesDe(B), ['tcgdex:001:id:basse']);
    }
    {
        const B = fausseBase(); const doc = tcg({ wOriginal: 300, w: 300, basseDefinition: true });
        const ims = semerTcg(B, [], [], doc);
        await joindreImagesTcgdex(B.M, SLUG, ims, { langue: 'id', LANGUE: LANG });
        verifier('   la marque posée sur le DOCUMENT passe à l\'entrée', imagesDe(B), ['tcgdex:001:id:basse']);
    }

    // ════════════════ ARTOFPKM ════════════════
    const { joindreImages } = require('./collecteur-images');
    const L = { code: 'TST', slugSet: SLUG, bulba: { expansion: 'Set Banc', tirage: 'jp' } };
    const S = { ids: ['x'] };
    const aop = (o = {}) => ({ _id: 'aop:1', source: 'artofpkm', set: SLUG, numero: '001', cleR2: 'artofpkm/x/1.webp', sha256: 'h', w: 600, h: 840, fmt: 'webp', wOriginal: 600, urlOriginal: 'u', titre: 'Spidops', nomEn: 'Spidops', etat: 'ok', ...o });
    const TPCJA = (o = {}) => TPC({ langue: 'ja', cleR2: 'pokemon-card-com/Set-Banc/001-1-ja.webp', source: 'pokemon-card-com', ...o });
    const DOC_TPCJA = (cleR2 = 'pokemon-card-com/Set-Banc/001-1-ja.webp') => ({ ...DOC_TPC(cleR2), source: 'pokemon-card-com', langue: 'ja' });
    const semerAop = (B, entrees, docsExtra = [], doc = aop()) => {
        B.cols.cartes.set(1, { _id: 1, nomEn: 'Spidops', sets: [SLUG], impressions: [{ tirage: 'jp', expansion: 'Set Banc', numero: '001' }], images: structuredClone(entrees) });
        for (const d of [doc, ...docsExtra]) B.cols.images.set(d._id, structuredClone(d));
    };
    const joindre = (B) => silencieux(() => joindreImages(B.M, L, SLUG, S, { x: [{}] }, {}, dossier, { silencieux: true }));
    {
        const B = fausseBase(); semerAop(B, [TPCJA()], [DOC_TPCJA()]);
        await joindre(B);
        verifier('ARTOFPKM (a) une entrée marquée + une candidate ≥ 350 de même set, numéro, langue (ja) → la candidate remplace', imagesDe(B), ['artofpkm:001:ja']);
        verifier('   le document marqué passe `remplace`, avec par quoi', [B.cols.images.get('doc:pokemon-card-com/Set-Banc/001-1-ja.webp').etat, B.cols.images.get('doc:pokemon-card-com/Set-Banc/001-1-ja.webp').remplacePar], ['remplace', { source: 'artofpkm', cleR2: 'artofpkm/x/1.webp' }]);
    }
    {
        const B = fausseBase(); semerAop(B, [TPCJA({ basseDefinition: undefined })], [{ ...DOC_TPCJA(), basseDefinition: undefined }]);
        delete B.cols.cartes.get(1).images[0].basseDefinition; B.cols.cartes.get(1).images[0].w = 600;   // (une image saine, 600 px : face à une équivalente (600 px) elle ne bouge pas — doctrine 2026-10-17, article 4)
        await joindre(B);
        verifier('ARTOFPKM (b) une entrée NON marquée au même (set, numéro, langue) → son DOCUMENT reste `ok` (le $pull {set, numero} d\'artofpkm retire l\'entrée, geste d\'AVANT, inchangé)',
            [B.cols.images.get('doc:pokemon-card-com/Set-Banc/001-1-ja.webp').etat], ['ok']);
    }
    {
        const B = fausseBase(); semerAop(B, [TPCJA({ langue: 'id' }), TPCJA({ numero: '002', cleR2: 'k2.webp' })], [{ ...DOC_TPCJA(), langue: 'id' }, DOC_TPCJA('k2.webp')]);
        await joindre(B);
        verifier('ARTOFPKM (c) autre numéro → l\'entrée marquée reste ; autre langue → son document reste `ok` (rien n\'est marqué remplacé)',
            [imagesDe(B).includes('pokemon-card-com:002:ja:basse'), B.cols.images.get('doc:pokemon-card-com/Set-Banc/001-1-ja.webp').etat, B.cols.images.get('doc:k2.webp').etat], [true, 'ok', 'ok']);
    }
    {
        const B = fausseBase(); const doc = aop({ wOriginal: 300, w: 300 });
        semerAop(B, [{ set: SLUG, source: 'artofpkm', numero: '001', cleR2: doc.cleR2, w: 300, langue: 'ja', basseDefinition: true }], [], doc);
        await joindre(B);
        verifier('ARTOFPKM (d) rejeu de la jointure sur une image de basse définition → la marque de l\'entrée RESTE', imagesDe(B), ['artofpkm:001:ja:basse']);
    }
    {
        const B = fausseBase(); const doc = aop({ wOriginal: 300, w: 300, basseDefinition: true });
        semerAop(B, [], [], doc);
        await joindre(B);
        verifier('   la marque posée sur le DOCUMENT passe à l\'entrée', imagesDe(B), ['artofpkm:001:ja:basse']);
    }
    {
        const B = fausseBase(); semerAop(B, [], [], aop({ wOriginal: 1000, w: 700 }));
        await joindre(B);
        verifier('   un document plafonné à 700 (original 1000) n\'est jamais marqué', imagesDe(B), ['artofpkm:001:ja']);
    }
    // le témoin : la jointure a bien joint (le banc ne tourne pas à vide, §41)
    {
        const B = fausseBase(); semerAop(B, [], [], aop());
        const r = await joindre(B);
        verifier('le banc ne tourne pas à vide : une image jointe, une carte couverte, concordance', [r.rattachements, r.cartesCouvertes, r.concordance], [1, 1, true]);
    }

    // ════════════════ ➕ DOCTRINE DE COLLECTE (2026-10-17) : traçabilité commune + remplacement « nettement plus grande » / « empruntée », par la MÊME fonction ════════════════
    const trace = e => [e.retirable, typeof e.urlOriginal === 'string' && e.urlOriginal.length > 0, e.collecteLe instanceof Date];
    const SAIN = (o = {}) => ({ set: SLUG, source: 'tpc-asie', numero: '001', cleR2: 'tpc-asie/Set-Banc/001-1-id.webp', w: 400, wOriginal: 400, langue: 'id', ...o });
    const DOC_SAIN = (o = {}) => ({ ...DOC_TPC(), basseDefinition: undefined, wOriginal: 400, w: 400, ...o });
    {
        const B = fausseBase(); const ims = semerBulba(B, [], [], bulba());
        await joindreImagesBulba(B.M, SLUG, ims);
        verifier('TRAÇABILITÉ Bulbapedia : l\'entrée porte retirable, urlOriginal, collecteLe', trace(B.cols.cartes.get(1).images[0]), [true, true, true]);
        const B2 = fausseBase(); const ims2 = semerBulba(B2, [], [], bulba({ urlOriginal: undefined }));
        let err = null, r2 = null; try { r2 = await joindreImagesBulba(B2.M, SLUG, ims2); } catch (e) { err = e.message; }
        verifier('   REJEU d\'un document ancien SANS adresse d\'origine : la jointure ne s\'arrête pas, l\'entrée est posée SANS urlOriginal inventée, et le bilan le compte', [err, (B2.cols.cartes.get(1).images || []).length, B2.cols.cartes.get(1).images[0]?.urlOriginal ?? null, r2?.sansUrlOriginal], [null, 1, null, 1]);
    }
    {
        const B = fausseBase(); const ims = semerTcg(B, [], [], tcg());
        await joindreImagesTcgdex(B.M, SLUG, ims, { langue: 'id', LANGUE: LANG });
        verifier('TRAÇABILITÉ TCGdex : l\'entrée porte retirable, urlOriginal, collecteLe', trace(B.cols.cartes.get(1).images[0]), [true, true, true]);
        let err = null; const B2 = fausseBase(); const ims2 = semerTcg(B2, [], [], tcg({ urlOriginal: undefined }));
        let r2 = null; try { r2 = await joindreImagesTcgdex(B2.M, SLUG, ims2, { langue: 'id', LANGUE: LANG }); } catch (e) { err = e.message; }
        verifier('   REJEU d\'un document ancien SANS adresse d\'origine : pas d\'arrêt, entrée posée sans urlOriginal inventée, bilan : 1 document sans adresse', [err, B2.cols.cartes.get(1).images[0]?.urlOriginal ?? null, r2?.sansUrlOriginal], [null, null, 1]);
        // nettement plus grande : 400 → 600 (1,5 ×) remplace ; 400 → 599 non ; une saine face à une équivalente (600 / 600) ne bouge pas
        const essai = async (wOrig, wDoc) => { const Bx = fausseBase(); const imsx = semerTcg(Bx, [SAIN()], [DOC_SAIN()], tcg({ wOriginal: wDoc, w: Math.min(wDoc, 700) })); await joindreImagesTcgdex(Bx.M, SLUG, imsx, { langue: 'id', LANGUE: LANG }); return [imagesDe(Bx), Bx.cols.images.get('doc:tpc-asie/Set-Banc/001-1-id.webp').etat]; };
        verifier('TCGDEX remplacement : 1,5 × (400 → 600) remplace l\'image saine ; 1,49 × (400 → 596) la laisse (l\'ancienne reste `ok`, la nouvelle est écartée comme avant)',
            [(await essai(400, 600))[1], (await essai(400, 596))[1]], ['remplace', 'ok']);
        const Be = fausseBase(); const imse = semerTcg(Be, [SAIN({ w: 600, wOriginal: 600, imageEmprunteeTirage: true })], [DOC_SAIN({ wOriginal: 600, w: 600 })], tcg());
        await joindreImagesTcgdex(Be.M, SLUG, imse, { langue: 'id', LANGUE: LANG });
        verifier('TCGDEX (correction 4) : une entrée EMPRUNTÉE n\'est PAS remplacée par une image simple (aucun marqueur positif de tampon)', [imagesDe(Be), Be.cols.images.get('doc:tpc-asie/Set-Banc/001-1-id.webp').etat], [['tpc-asie:001:id', 'tcgdex:001:id'], 'ok']);
    }
    {
        const B = fausseBase(); semerAop(B, [], [], aop());
        await joindre(B);
        verifier('TRAÇABILITÉ artofpkm : l\'entrée porte retirable, urlOriginal, collecteLe', trace(B.cols.cartes.get(1).images[0]), [true, true, true]);
        const Bx = fausseBase(); semerAop(Bx, [SAIN({ source: 'pokemon-card-com', langue: 'ja', cleR2: 'pokemon-card-com/x.webp' })], [{ ...DOC_SAIN(), source: 'pokemon-card-com', langue: 'ja', cleR2: 'pokemon-card-com/x.webp', _id: 'doc:x' }], aop({ wOriginal: 600, w: 600 }));
        await joindre(Bx);
        verifier('ARTOFPKM remplacement : 400 → 600 (1,5 ×) remplace l\'image saine d\'une autre source (même set, numéro, langue)', [Bx.cols.images.get('doc:x').etat, imagesDe(Bx)], ['remplace', ['artofpkm:001:ja']]);
    }

    console.log(`\n${ok} passés, ${ko} en échec (sur ${ok + ko})`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ ERREUR DU BANC', e); process.exit(1); });
