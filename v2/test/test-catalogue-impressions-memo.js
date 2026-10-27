'use strict';
// LOT PERF-SCAN, P3 — catalogue.lire(ids) lisait les impressions d'une métacarte (visuels.impressions : les entrées de l'archive puis UNE requête guide_prix sur tous les produits de la métacarte) une fois PAR PRODUIT demandé, alors que
// les produits d'une même question (V1, V2, reverse, promo : même métacarte) la partagent : mesuré sur la série C (50 scans), 150 requêtes guide_prix identiques à une autre du même scan, 3 par scan.
// Maintenant : UNE lecture par métacarte et par appel de lire(). Le critère est l'IDENTITÉ : la table rendue est la même qu'avec une lecture par produit, produit par produit, impression par impression.
const H = require('./_harnais'); const db = require('../db'); const { lireConfig } = require('../config');
const { creerCatalogue } = require('../identifier/catalogue'); const E = require('../chargeur/etat'); const VB = require('./_visuels-banc');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });

(async () => {
    await H.ouvrirBac('test-catalogue-impressions-memo.js');
    const CM = 'https://www.cardmarket.com/fr/Pokemon/Products/Singles';
    const META_A = 216566, META_B = 330001, META_C = 440002;
    const c = (id, nom, idMetacard, idExpansion = 1564) => ({ idProduct: id, name: nom, idExpansion, idMetacard });
    const ids = { A1: 1001, A2: 1002, A3: 1003, B1: 2001, B2: 2002, C1: 3001, SANS: 4001 };
    await db.col('catalogue_produits').insertMany([c(ids.A1, 'Arcanine [G]', META_A), c(ids.A2, 'Arcanine [G]', META_A), c(ids.A3, 'Arcanine [G]', META_A, 4284), c(ids.B1, 'Mew', META_B), c(ids.B2, 'Mew', META_B), c(ids.C1, 'Zapdos', META_C), c(ids.SANS, 'Sans metacarte', null)]);
    await db.col('numeros_cartes').insertMany(Object.values(ids).map((id, i) => ({ idProduct: id, idExpansion: 1564, numero: String(i + 1), numeroUrl: String(i + 1), codeSet: 'SV', nomFr: `Carte ${id}`, slug: `S-${id}`, slugSet: 'Supreme-Victors', source: 'cardmarket', variante: i % 2 ? 'V2' : 'V1' })));
    const g = new Date('2026-10-12T00:47:30.000Z');
    await db.col('guide_prix').insertMany(Object.values(ids).map((id, i) => ({ idProduct: id, trend: 3 + i, low: 1 + i, avg7: 3 + i, avg30: 3 + i, guideDu: g })));
    const e = (id, meta, o) => VB.doc(id, { idMetacard: meta, numero: String(id % 100), total: '147', rarete: 'Rare', variante: null, setNom: 'Supreme Victors', lien: `${CM}/Supreme-Victors/Carte-${id}`, ...o });
    E.installer(VB.construire([e(ids.A1, META_A), e(ids.A2, META_A), e(ids.A3, META_A), e(ids.B1, META_B), e(ids.B2, META_B), e(ids.C1, META_C)]));

    // le compteur : les lectures de guide_prix faites pendant lire()
    const colReelle = db.col; let lecturesGuide = 0;
    db.col = nom => { const x = colReelle(nom); if (nom !== 'guide_prix') return x; return new Proxy(x, { get(t, p) { if (p !== 'find') return typeof t[p] === 'function' ? t[p].bind(t) : t[p]; return (...a) => { lecturesGuide++; return t.find(...a); }; } }); };
    try {
        const cat = creerCatalogue({ cfg });
        const demandes = [ids.A1, ids.A2, ids.A3, ids.B1, ids.B2, ids.C1, ids.SANS];
        lecturesGuide = 0;
        const table = await cat.lire(demandes);
        const lues = lecturesGuide;
        // 3 métacartes -> 3 lectures d'impressions + 1 lecture du guide du produit lui-même (lire) = 4 ; avant : 6 produits à métacarte -> 6 + 1 = 7
        H.v('lire() de 7 produits (3 métacartes, un sans métacarte) : UNE lecture d\'impressions par métacarte, plus celle du guide de lire() lui-même', lues, 4);

        // l'identité : la même table qu'avec une lecture d'impressions PAR PRODUIT (la définition d'avant, recopiée : visuels.impressions de chaque produit, puis les versions de completerImpressions)
        const visuels = require('../identifier/visuels').creerVisuels({ cfg });
        const attendu = new Map();
        for (const id of demandes) {
            const meta = (await db.col('catalogue_produits').findOne({ idProduct: id })).idMetacard;
            attendu.set(id, Number.isInteger(meta) ? await visuels.impressions(meta) : []);
        }
        let diff = 0;
        for (const id of demandes) {
            const ligne = table.get(id); if (!ligne) { diff++; continue; }
            const a = attendu.get(id).map(i => i.idProduct), b = ligne.impressions.map(i => i.idProduct);
            if (JSON.stringify(a) !== JSON.stringify(b)) diff++;
            // les prix de guide et les liens de chaque impression : ceux de la lecture directe
            const pa = JSON.stringify(attendu.get(id).map(i => [i.idProduct, i.numero, i.total, i.rarete, i.lien, i.prixGuide])), pb = JSON.stringify(ligne.impressions.map(i => [i.idProduct, i.numero, i.total, i.rarete, i.lien, i.prixGuide]));
            if (pa !== pb) diff++;
        }
        H.v('chaque produit : mêmes impressions (identifiants, numéro, total, rareté, lien, prix du guide) qu\'avec une lecture par produit', diff, 0);
        H.v('…un produit sans métacarte : aucune impression', table.get(ids.SANS).impressions, []);
        // chaque ligne a SON tableau (le partager laisserait un appelant modifier celui d'un autre)
        H.v('…les produits d\'une même métacarte ont chacun leur propre tableau d\'impressions', [table.get(ids.A1).impressions === table.get(ids.A2).impressions, table.get(ids.A1).impressions.length, table.get(ids.A2).impressions.length], [false, 3, 3]);
        table.get(ids.A1).impressions.push('modifié');
        H.v('…modifier le tableau d\'un produit ne change pas celui de son voisin', table.get(ids.A2).impressions.length, 3);

        // une panne de la lecture d'impressions : chaque produit la subit comme avant (aucune n'est gardée comme une réussite)
        let appels = 0, mode = 'ok';
        const visPanne = { instantane: () => visPanne, entree: () => null, resoudre: async () => null, impressions: async () => { appels++; if (mode === 'leve') throw new Error('panne'); return []; } };
        const catP = creerCatalogue({ cfg, visuels: visPanne });
        mode = 'leve'; appels = 0;
        const l = await catP.lire([ids.A1, ids.A2]).then(t => t, er => er);
        H.v('une lecture d\'impressions qui lève : lire() lève comme avant (sans produit servi à moitié)', l instanceof Error, true);
        mode = 'ok'; appels = 0; await catP.lire([ids.A1, ids.A2, ids.A3]);
        H.v('trois produits de la même métacarte : UNE seule lecture d\'impressions', appels, 1);
    } finally { db.col = colReelle; }
    await H.fermerBac(); H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.fermerBac(); } catch { } process.exit(1); });
