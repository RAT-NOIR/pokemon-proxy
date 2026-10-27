'use strict';
// EDITION-LOCALE (27/10 nuit) — `sets.editionLocale` branchée dans la décision des visuels, comme le site (lib/langueDuVisuel.ts, lib/entreesDuSet.ts::editionLocaleDuSet).
// Pas de base, pas de réseau : données SYNTHÉTIQUES ; la règle du site est la copie EMBARQUÉE, jugée aussi contre le site au commit nommé.
//   · la projection de source.js lit `sets.editionLocale`, la normalise (trim, minuscules, liste fermée du SITE) et COMPTE ce qu'elle rejette ;
//   · decider() : tous les appels de la garde de langue (choisirVisuel, admission BA, admission WCD) reçoivent l'édition locale du set ;
//   · la LISTE FERMÉE de l'API est la même que celle du site (lue au commit nommé, jamais devinée).
const H = require('./_harnais');
const C = require('../chargeur/copier-regle-site');
const S = require('../chargeur/source');
const { decider, admissionDuCatalogue } = require('../chargeur/decision');
const { regleEmbarquee } = require('../chargeur/regle-site');

(async () => {
    const regle = await regleEmbarquee();
    const EL = require('../chargeur/edition-locale');

    // --- la liste fermée : celle du site, au commit nommé ---
    let siteListe = null, siteDit = '';
    try {
        const src = C.lecteurGit(C.REPO_SITE, C.COMMIT)('entreesDuSet.ts').toString('utf8');
        const m = /export function editionLocaleDuSet[\s\S]*?\[([^\]]*)\]\.includes\(e\)/.exec(src);
        siteListe = m ? m[1].split(',').map(x => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : null;
        siteDit = m ? '' : 'forme de editionLocaleDuSet non reconnue au commit nommé';
    } catch (e) { siteDit = `site absent (${String(e.message).split('\n')[0]})`; }
    if (siteListe) H.v('la liste fermée de l\'API est celle du site (editionLocaleDuSet au commit nommé)', [...EL.LANGUES_DES_EDITIONS_LOCALES], siteListe);
    else console.log(`⚠️  liste du site NON comparée : ${siteDit}`);
    H.v('la liste fermée n\'ouvre jamais ja ni une langue d\'Asie', ['ja', 'zh-hans', 'zh-hant', 'th', 'id', 'ko', 'en'].map(l => EL.editionLocaleDuSet(l)), Array(7).fill(null));
    H.v('editionLocaleDuSet : trim, minuscules, sinon null (identique au site pour ces vecteurs)',
        [' FR ', 'fr', 'De', 'zz', '', '   ', null, undefined, 12, {}].map(x => EL.editionLocaleDuSet(x)), ['fr', 'fr', 'de', null, null, null, null, null, null, null]);

    // --- la projection ---
    H.v('PROJECTIONS.sets lit editionLocale', S.PROJECTIONS.sets.editionLocale, 1);
    const I = S.interneur();
    H.v('compacterSet : « fr » est gardé', S.compacterSet({ _id: 'M', editionLocale: 'fr' }, I).editionLocale, 'fr');
    H.v('compacterSet : « " FR " » est normalisé', S.compacterSet({ _id: 'M', editionLocale: ' FR ' }, I).editionLocale, 'fr');
    H.v('compacterSet : absent → null', S.compacterSet({ _id: 'M' }, I).editionLocale, null);
    const compte = { horsListe: 0, valeurs: {} };
    H.v('compacterSet : « ja » (hors liste) → null', S.compacterSet({ _id: 'M', editionLocale: 'ja' }, I, compte).editionLocale, null);
    S.compacterSet({ _id: 'M2', editionLocale: 'zz' }, I, compte); S.compacterSet({ _id: 'M3', editionLocale: 'fr' }, I, compte); S.compacterSet({ _id: 'M4' }, I, compte);
    H.v('   … et COMPTÉ (ja, zz) ; fr, absent : non comptés', [compte.horsListe, compte.valeurs], [2, { ja: 1, zz: 1 }]);
    const vus = {};
    const docsSets = [{ _id: 'A', editionLocale: 'fr' }, { _id: 'B', editionLocale: 'ja' }, { _id: 'C' }];
    const ouvrir = async () => ({ ok: true, cartes: { fermer: async () => { }, collection: nom => ({ find: (f, o) => { vus[nom] = o.projection; return (async function* () { if (nom === 'sets') yield* docsSets; })(); } }) } });
    const src = await S.sourceCartes({ ouvrir });
    H.v('sourceCartes : la projection envoyée à la base porte editionLocale (sets)', vus.sets?.editionLocale, 1);
    H.v('sourceCartes : les sets compactés portent l\'édition locale normalisée', src.sets.map(s => s.editionLocale), ['fr', null, null]);
    H.v('sourceCartes : le rejet est compté et rendu', src.comptes?.editionLocale, { horsListe: 1, valeurs: { ja: 1 } });

    // --- la décision : un set occidental, un scan, un produit ---
    const monde = (setO, langue, o = {}) => {
        const set = { _id: 'McD', idExpansion: 100, code: 'McD', nomAffichage: 'McD', tirage: 'intl', region: 'intl', bulba: { expansion: 'McD' }, ...setO };
        const doc = { _id: 1, nomEn: 'Carte', sets: ['McD'], impressions: [{ tirage: set.tirage, expansion: 'McD', numero: '001', total: '12', rarete: 'Rare' }],
            images: [{ set: 'McD', numero: '001', cleR2: 'cartes/mcd1.webp', w: 700, h: 980, vignette: { cleR2: 'vignettes/mcd1.webp', w: 200, h: 279 }, langue, source: 'tcgdex', ...o }] };
        const ligne = { idProduct: 1, carteId: 1, idExpansion: 100, numeroFiche: '001', slug: 'Carte-V1-MCD001', slugSet: 'McD' };
        return { sets: [set], docs: [doc], lignes: [ligne], metacarte: new Map([[1, 9001]]), regle };
    };
    const sert = async (setO, langue, o) => { const r = await decider(monde(setO, langue, o)); return r.entrees.length === 1 ? r.entrees[0].visuel : (r.entrees.length === 0 ? 'aucun' : '?'); };
    H.v('A. set intl editionLocale « fr » + scan « fr » → servi (du-set)', await sert({ editionLocale: 'fr' }, 'fr'), 'du-set');
    H.v('B. le même set SANS editionLocale → refusé', await sert({}, 'fr'), 'aucun');
    H.v('C. editionLocale « ja » (hors liste) + scan « ja » → refusé', await sert({ editionLocale: 'ja' }, 'ja'), 'aucun');
    H.v('C2. editionLocale « zz » (hors liste) + scan « zz » → refusé', await sert({ editionLocale: 'zz' }, 'zz'), 'aucun');
    H.v('D. editionLocale « fr » + scan « en » → toujours servi', await sert({ editionLocale: 'fr' }, 'en'), 'du-set');
    H.v('E. editionLocale « fr » + scan « de » (une autre langue d\'Europe) → refusé', await sert({ editionLocale: 'fr' }, 'de'), 'aucun');
    H.v('F. editionLocale « " FR " » (brut, non normalisé) + scan « fr » → servi (decider normalise lui-même)', await sert({ editionLocale: ' FR ' }, 'fr'), 'du-set');
    // set japonais : la règle du site décide (rejouée, pas devinée)
    const siteJp = ['fr', 'ja', 'en', null].map(l => regle.visuelAdmisPourLaRegion({ cleR2: 'cartes/x.webp', langue: l }, 'jp', 'fr'));
    H.v('G0. la règle du site (embarquée) sur un set jp avec editionLocale « fr » : fr refusé, ja admis, en refusé, null admis', siteJp, [false, true, false, true]);
    const jp = { tirage: 'jp', region: 'jp', editionLocale: 'fr' };
    H.v('G1. set jp editionLocale « fr » + scan « fr » → refusé (la règle du site)', await sert(jp, 'fr'), 'aucun');
    H.v('G2. set jp editionLocale « fr » + scan « ja » → servi', await sert(jp, 'ja'), 'du-set');

    // --- les voies d'admission du catalogue (BA, WCD) passent aussi l'édition locale ---
    const mk = (id, o = {}) => ({ _id: id, idExpansion: 5890, code: 'BA', nomAffichage: id, tirage: 'intl', region: 'intl', bulba: { expansion: id }, ...o });
    const prv = (setId, pos, langue) => ({ set: setId, numero: pos, cleR2: 'cartes/p.webp', w: 700, h: 980, langue, source: 'prv', preuveLueRegle: 'preuve-lue' });
    const ba = (o, langue) => {
        const set = mk('Battle-Academy-2024', o), carte = { _id: 50, images: [prv('Battle-Academy-2024', 'A34', langue)] };
        const ligne = { carteId: 50, slug: 'Picnicker-BA24A34', slugSet: set._id };
        return admissionDuCatalogue({ ligne, set, carte, regle, positions: new Map([['50|Battle-Academy-2024|A34', 1]]) })?.nature ?? null;
    };
    H.v('H1. admission BA : scan « fr » refusé sans editionLocale', ba({}, 'fr'), null);
    H.v('H2. admission BA : scan « fr » admis avec editionLocale « fr »', ba({ editionLocale: 'fr' }, 'fr'), 'prv-position');
    H.v('H3. admission BA : editionLocale « ja » (hors liste) → toujours refusé', ba({ editionLocale: 'ja' }, 'ja'), null);
    const wcd = (o, langue) => {
        const set = mk('WCD-2024', { idExpansion: 5992, ...o });
        const carte = { _id: 60, images: [{ set: set._id, numero: '006', cleR2: 'cartes/w.webp', w: 700, h: 980, langue, source: 'emprunt', imageEmprunteeTirage: true, differenceEmprunt: 'autre-tirage' }] };
        return admissionDuCatalogue({ ligne: { carteId: 60, numeroFiche: '006', slug: 'Zapdos-WCD24PGO-006', slugSet: set._id }, set, carte, regle, positions: new Map() })?.nature ?? null;
    };
    H.v('H4. admission WCD : scan « fr » refusé sans editionLocale', wcd({}, 'fr'), null);
    H.v('H5. admission WCD : scan « fr » admis avec editionLocale « fr »', wcd({ editionLocale: 'fr' }, 'fr'), 'wcd-emprunt');

    // --- la voie des logos (exporter-donnees-logos-site.js::choisirVisuel) est LA MÊME : decider l'appelle, il n'y a qu'un exemplaire ---
    const Lg = require('../../exporter-donnees-logos-site');
    const s = { _id: 'McD', tirage: 'intl', region: 'intl', editionLocale: 'fr' };
    const c = { images: [{ set: 'McD', numero: '001', cleR2: 'cartes/a.webp', langue: 'fr' }] };
    const ch = (set) => Lg.choisirVisuel({ ligne: { carteId: 1 }, carte: c, set, fiche: { carteId: 1, numero: '001' }, regle, setsBase: new Map(), substitutSansMention: 'refus' });
    H.v('I1. choisirVisuel : set « fr » + scan « fr » → le scan est choisi', ch(s).im?.cleR2, 'cartes/a.webp');
    H.v('I2. choisirVisuel : le même set sans editionLocale → pas de visuel du set', [ch({ ...s, editionLocale: null }).im, ch({ ...s, editionLocale: null }).duSetNonDesigne], [null, false]);
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
