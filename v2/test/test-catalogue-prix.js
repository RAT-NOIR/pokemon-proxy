'use strict';
// Lot F4-PRIX — ce que la lecture du catalogue (catalogue.js `lire`) apporte au prix : la moyenne 7 j du guide, la version Cardmarket (V1, V2…), le drapeau « prix mélangé »,
// pour le produit ET pour chacune de ses impressions. Base EN MÉMOIRE (H.ouvrirBac), aucun réseau. Les valeurs sont celles du cas réel du testeur (Arcanin [G] Lv.60, Supreme Victors 15/147,
// guide du 2026-10-12, lu en lecture seule dans rm_essai) ; le prix mélangé est celui d'une fiche réelle de la liste du catalogue (Dark Arbok, Team Rocket 19, idProduct 274072, tampon league).
const H = require('./_harnais'); const db = require('../db'); const { lireConfig } = require('../config');
const { creerCatalogue } = require('../identifier/catalogue'); const { construireProduit } = require('../identifier/produit');
const E = require('../chargeur/etat'); const VB = require('./_visuels-banc');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const CM = 'https://www.cardmarket.com/fr/Pokemon/Products/Singles';
const META = 216566, ID_V1 = 278706, ID_V2 = 371545, ID_PTS = 676455, ID_ARBOK = 274072;
const GARDER = ['tendance', 'de', 'deBase', 'moyenne7', 'moyenne30', 'fiable', 'reserves'];
const prix = g => g && Object.fromEntries(GARDER.map(k => [k, g[k]]));

(async () => {
    await H.ouvrirBac('test-catalogue-prix.js');
    const c = (id, nom, idMetacard = META, idExpansion = 1564) => ({ idProduct: id, name: nom, idExpansion, idMetacard });
    await db.col('catalogue_produits').insertMany([
        c(ID_V1, 'Arcanine [G] Lv.60 [Extreme Speed | Overrun]'), c(ID_V2, 'Arcanine [G] Lv.60 [Extreme Speed | Overrun]'), c(ID_PTS, 'Arcanine [G] Lv.60 [Extreme Speed | Overrun]', META, 4284),
        c(ID_ARBOK, 'Dark Arbok [Stare | Poison Vapor]', 555001, 1528)]);
    await db.col('numeros_cartes').insertMany([
        { idProduct: ID_V1, idExpansion: 1564, numero: '15', numeroUrl: '15', codeSet: 'SV', nomFr: 'Arcanin [G] Lv.60', slug: 'Arcanine-G-Lv60-V1-SV15', slugSet: 'Supreme-Victors', source: 'cardmarket', variante: 'V1' },
        { idProduct: ID_V2, idExpansion: 1564, numero: '15', numeroUrl: '15', codeSet: 'SV', nomFr: 'Arcanin [G] Lv.60', slug: 'Arcanine-G-Lv60-V2-SV15', slugSet: 'Supreme-Victors', source: 'cardmarket', variante: 'V2' },
        { idProduct: ID_PTS, idExpansion: 4284, numero: '003', codeSet: 'PtC', nomFr: 'Arcanin [G] Lv.60', slug: 'Arcanine-G-Lv60-PtS003', slugSet: 'Charizard-SP-Half-Deck', source: 'cardmarket', variante: null },
        { idProduct: ID_ARBOK, idExpansion: 1528, numero: '19', codeSet: 'TR', nomFr: 'Dark Arbok', slug: 'Dark-Arbok-TR19', slugSet: 'Team-Rocket', source: 'cardmarket', variante: null, prixMelangeTampon: true, tamponsConnus: ['league'] }]);
    const g = new Date('2026-10-12T00:47:30.000Z');
    await db.col('guide_prix').insertMany([
        { idProduct: ID_V1, trend: 3.35, low: 0.47, avg: 3.4, avg1: 3.3, avg7: 3.3, avg30: 3.42, guideDu: g },
        { idProduct: ID_V2, trend: 10.18, low: 1, avg: 15.77, avg1: 7.5, avg7: 14.59, avg30: 13.15, guideDu: g },
        { idProduct: ID_PTS, trend: 3.66, low: 1.45, avg7: 3.5, avg30: 3.12, guideDu: g },
        { idProduct: ID_ARBOK, trend: 3, low: 1, avg7: 3, avg30: 3, guideDu: g }]);
    const e = (id, o) => VB.doc(id, { idMetacard: META, numero: '15', total: '147', rarete: 'Rare', variante: null, setNom: 'Supreme Victors', lien: `${CM}/Supreme-Victors/Arcanine-G-Lv60-V${id === ID_V1 ? 1 : 2}-SV15`, ...o });
    E.installer(VB.construire([e(ID_V1), e(ID_V2), e(ID_PTS, { numero: '003', total: '016', setNom: 'Charizard SP Half Deck', lien: `${CM}/Charizard-SP-Half-Deck/Arcanine-G-Lv60-PtS003` }),
        VB.doc(ID_ARBOK, { idMetacard: 555001, numero: '19', total: '82', rarete: 'Uncommon', variante: null, setNom: 'Team Rocket', lien: null })]));

    const cat = creerCatalogue({ cfg });
    const t = await cat.lire([ID_V2, ID_ARBOK]);
    const v2 = t.get(ID_V2), arbok = t.get(ID_ARBOK);

    // ── (e) la moyenne 7 j du guide arrive jusqu'à la ligne de catalogue
    H.v('ligne V2 : prixGuide porte la moyenne 7 j', [v2.prixGuide.avg7, v2.prixGuide.avg30, v2.prixGuide.trend], [14.59, 13.15, 10.18]);
    // ── (c) la version Cardmarket du produit et de chacune de ses impressions
    H.v('ligne V2 : version V2 (numeros_cartes.variante)', v2.version, 'V2');
    const imp = Object.fromEntries(v2.impressions.map(i => [i.idProduct, i]));
    H.v('impressions : les trois produits de la métacarte', Object.keys(imp).map(Number).sort((a, b) => a - b), [ID_V1, ID_V2, ID_PTS]);
    H.v('impressions : V1, V2 et « rien » (le Half Deck Charizard n\'a pas de version) — jamais devinée', [imp[ID_V1].version, imp[ID_V2].version, imp[ID_PTS].version], ['V1', 'V2', null]);
    H.v('impressions : la moyenne 7 j du guide de chaque impression', [imp[ID_V1].prixGuide.avg7, imp[ID_V2].prixGuide.avg7, imp[ID_PTS].prixGuide.avg7], [3.3, 14.59, 3.5]);
    // ── les prix mélangés : lus sur la ligne numeros_cartes du produit, par le chemin qui sert l'identification
    H.v('prixMelangeTampon : posé pour Dark Arbok, faux pour Arcanine (booléen strict)', [arbok.prixMelangeTampon, v2.prixMelangeTampon], [true, false]);
    H.v('   les tampons connus (champ interne du catalogue) ne sont pas repris', [Object.keys(arbok).filter(k => /tamponsConnus/i.test(k)), Object.keys(arbok.prixGuide)], [[], ['trend', 'low', 'avg7', 'avg30', 'guideDu']]);
    H.v('impressions : prixMelangeTampon booléen sur chacune (aucune ici)', Object.values(imp).map(i => i.prixMelangeTampon), [false, false, false]);

    // ── de bout en bout : ce que le client reçoit (cas réel du testeur)
    const p = construireProduit(v2, { langueInterface: 'fr', cfg });
    H.v('F4 cas réel : Arcanin V2 — tendance 10,18 contre la moyenne 7 j 14,59 : le prix n\'est pas sûr', prix(p.prixGuide), { tendance: 10.18, de: 1, deBase: 'tous-etats', moyenne7: 14.59, moyenne30: 13.15, fiable: false, reserves: ['ecart-tendance'] });
    H.v('F4 (c) les deux lignes « Supreme Victors n° 15/147 » se séparent par la version', p.impressions.filter(i => i.set.nom === 'Supreme Victors').map(i => [i.idProduct, i.numero, i.total, i.version]), [[ID_V1, '15', '147', 'V1'], [ID_V2, '15', '147', 'V2']]);
    H.v('F4 (b) tous les « De » des impressions se disent tous états', p.impressions.map(i => i.prixGuide.deBase), ['tous-etats', 'tous-etats', 'tous-etats']);
    H.v('F4 (d) le badge : SV ne passe plus pour un code, c\'est le nom', [p.set.code, p.set.badge, p.set.badgeSource], ['SV', 'Supreme Victors', 'nom']);
    H.v('F4 (c) le produit lui-même porte sa version', p.version, 'V2');
    const pa = construireProduit(arbok, { langueInterface: 'fr', cfg });
    H.v('F4 Dark Arbok (prix mélangé) : jamais présenté comme sûr, les deux mentions fermées', prix(pa.prixGuide), { tendance: 3, de: 1, deBase: 'tous-etats', moyenne7: 3, moyenne30: 3, fiable: false, reserves: ['prix-indicatif-tampons-melanges', 'peut-etre-gonfle-par-tampons'] });
    H.v('F4 une impression d\'un produit mélangé le dit aussi (lecture par les impressions de sa métacarte)', arbok.impressions.map(i => [i.idProduct, i.prixMelangeTampon, i.version]), [[ID_ARBOK, true, null]]);
    H.v('F4 …et son prix de l\'impression n\'est pas sûr non plus', pa.impressions.map(i => [i.idProduct, i.prixGuide.fiable, i.prixGuide.reserves]), [[ID_ARBOK, false, ['prix-indicatif-tampons-melanges', 'peut-etre-gonfle-par-tampons']]]);

    // ── la lecture des impressions n'ouvre AUCUNE collection hors de la liste fermée, et un produit sans impression ne lance pas de requête vide
    const aucun = await cat.lire([ID_V1, 999999]);
    H.v('un idProduct inconnu est absent (rien d\'inventé)', [aucun.has(ID_V1), aucun.has(999999)], [true, false]);
    H.v('liste vide : table vide', (await cat.lire([])).size, 0);
    // ── tour 1 (I1) : une impression ABSENTE de numeros_cartes est « non lue » : jamais fiable, ecart-non-mesurable (on ne prend jamais prixMelangeTampon: false par défaut pour une preuve)
    const ID_ORPH = 999001;
    await db.col('guide_prix').insertOne({ idProduct: ID_ORPH, trend: 5, low: 4, avg7: 5, avg30: 5, guideDu: g });
    E.installer(VB.construire([e(ID_V1), e(ID_V2), e(ID_ORPH, { numero: '16', lien: null })]));
    const tO = await creerCatalogue({ cfg }).lire([ID_V2]);
    const impO = Object.fromEntries(tO.get(ID_V2).impressions.map(i => [i.idProduct, i]));
    H.v('I1 : l\'impression absente de numeros_cartes est marquée non lue, les autres non', [impO[ID_ORPH].nonLu, impO[ID_V1].nonLu, impO[ID_V2].nonLu], [true, false, false]);
    const pO = construireProduit(tO.get(ID_V2), { langueInterface: 'fr', cfg });
    H.v('I1 : …donc son prix n\'est pas sûr, même avec un écart nul (5 / 5 / 5)', pO.impressions.filter(i => i.idProduct === ID_ORPH).map(i => [i.prixGuide.fiable, i.prixGuide.reserves]), [[false, ['ecart-non-mesurable']]]);
    H.v('I1 : …et les impressions lues gardent leur fiabilité (V1 mesurée dans la borne)', pO.impressions.filter(i => i.idProduct === ID_V1).map(i => [i.prixGuide.fiable, i.prixGuide.reserves]), [[true, []]]);

    // ── tour 1 (I2) : la requête ajoutée est BORNÉE et ISOLÉE. Sa panne ne casse pas l'identification : les impressions concernées sont « non lues ».
    const original = db.col;
    const appels = [];
    let mode = 'leve';
    db.col = nom => {
        const c = original(nom);
        if (nom !== 'numeros_cartes') return c;
        return new Proxy(c, { get(cible, p) {
            if (p !== 'find') return typeof cible[p] === 'function' ? cible[p].bind(cible) : cible[p];
            return (filtre, options) => {
                if (!options || !options.projection || !options.projection.variante) return cible.find(filtre, options);      // la première requête de lire() : intacte
                appels.push({ filtre, options });
                if (mode === 'leve') throw new Error('panne simulée de la requête des impressions');
                if (mode === 'rejette') return { toArray: async () => { throw new Error('panne simulée à la lecture'); } };
                if (mode === 'pend') return { toArray: () => new Promise(() => { }) };
                return cible.find(filtre, options);
            };
        } });
    };
    try {
        const log = console.warn; console.warn = () => { };
        const attendu = i => [i.idProduct, i.nonLu, i.prixMelangeTampon, i.version];
        for (const m of ['leve', 'rejette']) {
            mode = m;
            const tp = await creerCatalogue({ cfg }).lire([ID_V2]);
            H.v(`I2 : la requête des impressions ${m === 'leve' ? 'lève' : 'échoue à la lecture'} : lire() ne lève pas, le produit est servi`, [tp.has(ID_V2), tp.get(ID_V2).prixGuide.avg7], [true, 14.59]);
            H.v('I2 : …les impressions hors du produit sont non lues (version null, prix non mélangé NON pris pour une preuve)', tp.get(ID_V2).impressions.filter(i => i.idProduct !== ID_V2).map(attendu), [[ID_V1, true, false, null], [ID_ORPH, true, false, null]].sort((a, b) => a[0] - b[0]));
            const pp2 = construireProduit(tp.get(ID_V2), { langueInterface: 'fr', cfg });
            H.v('I2 : …donc aucune n\'est fiable (ecart-non-mesurable)', pp2.impressions.filter(i => i.idProduct !== ID_V2).map(i => [i.prixGuide.fiable, i.prixGuide.reserves]), [[false, ['ecart-non-mesurable']], [false, ['ecart-non-mesurable']]]);
            H.v('I2 : …le produit lui-même, lu par la première requête, garde son prix et sa version', [pp2.version, pp2.prixGuide.reserves], ['V2', ['ecart-tendance']]);
        }
        mode = 'pend';
        const t0 = Date.now();
        const tPend = await creerCatalogue({ cfg, delaiImpressionsMs: 80 }).lire([ID_V2]);
        H.v('I2 : une requête qui ne répond pas dans le délai nommé est abandonnée (identification continuée, impressions non lues)', [tPend.has(ID_V2), tPend.get(ID_V2).impressions.every(i => i.idProduct === ID_V2 || i.nonLu === true), Date.now() - t0 < 3000], [true, true, true]);
        mode = 'ok'; appels.length = 0;
        await creerCatalogue({ cfg }).lire([ID_V2]);
        const a = appels[0] && appels[0].options;
        H.v('I2 : la requête est BORNÉE : maxTimeMS nommé (IMPRESSIONS_MAX_TIME_MS) et limit égal au nombre d\'ids demandés', [appels.length, a && a.maxTimeMS, a && a.limit, appels[0] && appels[0].filtre.idProduct.$in.length], [1, require('../identifier/catalogue').IMPRESSIONS_MAX_TIME_MS, 2, 2]);
        console.warn = log;
    } finally { db.col = original; }

    E.vider();
    const sansVersion = await creerCatalogue({ cfg }).lire([ID_V2]);
    H.v('AUCUNE version de visuels chargée : plus d\'impressions, mais la version du produit et le prix restent (la ligne vient de numeros_cartes)', [sansVersion.get(ID_V2).impressions, sansVersion.get(ID_V2).version, sansVersion.get(ID_V2).prixGuide.avg7], [[], 'V2', 14.59]);
    await H.fermerBac(); H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.fermerBac(); } catch { } process.exit(1); });
