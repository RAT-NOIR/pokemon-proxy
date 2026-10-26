'use strict';
// ADMISSION-CATALOGUE (testeur, 27/10) — deux entrées du catalogue que le repli des familles fermées refusait, admises par une règle FERMÉE (v2/chargeur/decision.js) :
//   (A) Battle Academy : un visuel `prv` (preuve lue sur le scan) du SET, désigné par la POSITION du deck que porte le slug Cardmarket (« Potion-V2-BA20C37 » ↔ numero « C37 » lu) — servi comme scan DU TIRAGE ;
//   (B) WCD : l'emprunt du catalogue (source « emprunt », imageEmprunteeTirage, differenceEmprunt « autre-tirage ») au numéro de la fiche — servi pour l'AFFICHAGE, marqué EMPRUNTÉ (exclu des règles d'image).
// Tout le reste garde le refus d'avant. Pas de base, pas de réseau : decider reçoit des tableaux fabriqués ; la règle du site est la règle EMBARQUÉE.
const H = require('./_harnais');
const { decider } = require('../chargeur/decision');
const { regleEmbarquee } = require('../chargeur/regle-site');
const { lireEntree } = require('../identifier/visuels');

(async () => {
    const regle = await regleEmbarquee();
    const set = (id, exp) => ({ _id: id, idExpansion: exp, code: id.slice(0, 4), nomAffichage: id.replace(/-/g, ' '), tirage: 'intl', region: 'intl', bulba: { expansion: id.replace(/-/g, ' ') } });
    const exps = { 'Battle-Academy-2024': 5890, 'Battle-Academy-2020': 4100, 'WCD-2024': 5992, 'Set-A': 100, 'Set-B': 200 };
    const sets = Object.entries(exps).map(([id, e]) => set(id, e));
    const imp = (setId, numero) => ({ tirage: 'intl', expansion: setId.replace(/-/g, ' '), numero, total: '100', rarete: 'Rare' });
    const vig = n => ({ cleR2: `vignettes/${n}.webp`, w: 200, h: 279 });
    const im = (setId, numero, n, o = {}) => ({ set: setId, numero, cleR2: `cartes/${n}.webp`, w: 700, h: 980, vignette: vig(n), langue: 'en', source: 'tcgdex', ...o });
    const prv = (setId, pos, n, o = {}) => im(setId, pos, n, { source: 'prv', preuveLueRegle: 'preuve-lue', ...o });
    const emp = (setId, numero, n, o = {}) => im(setId, numero, n, { source: 'emprunt', imageEmprunteeTirage: true, differenceEmprunt: 'autre-tirage', ...o });
    const carte = (id, setId, numero, images, extraSets = []) => ({ _id: id, nomEn: `Carte ${id}`, sets: [setId, ...extraSets], impressions: [imp(setId, numero)], images });
    const SUBST = { cleR2: 'cartes/orig.webp', w: 600, h: 838, set: 'Set-B', mention: 'Visuel de la carte d\'origine (Set B) — pas celui de ce produit' };
    const docs = [
        carte(10, 'Set-B', '001', [im('Set-B', '001', 'orig')]),
        // (A) Battle Academy 2024 : la fiche n'a pas de numéro, la carte a QUATRE scans du set (un par position) — choisirVisuel ne peut rien désigner
        carte(50, 'Battle-Academy-2024', null, [prv('Battle-Academy-2024', 'A34', 'a34'), prv('Battle-Academy-2024', 'P26', 'p26'), prv('Battle-Academy-2024', 'A47', 'a47', { preuveLueRegle: null }),
            prv('Battle-Academy-2024', 'P46', 'p46', { imageEmprunteeTirage: true })]),
        carte(51, 'Battle-Academy-2024', null, [prv('Battle-Academy-2024', 'A10', 'a10'), prv('Battle-Academy-2024', 'A10', 'a10bis'), prv('Battle-Academy-2024', 'A11', 'a11')]),
        carte(52, 'Battle-Academy-2024', null, [prv('Battle-Academy-2024', 'A20', 'a20', { langue: 'ja' }), prv('Battle-Academy-2024', 'A21', 'a21')]),
        carte(53, 'Battle-Academy-2020', null, [prv('Battle-Academy-2020', 'C37', 'c37'), prv('Battle-Academy-2020', 'MWT', 'mwt')]),
        carte(54, 'Set-A', null, [prv('Set-A', 'A01', 's1'), prv('Set-A', 'A02', 's2')]),
        carte(55, 'Battle-Academy-2020', null, [prv('Battle-Academy-2020', 'C05', 'c05')]),            // UN seul scan du set : choisirVisuel le donnerait à tous les produits sans numéro
        // (B) WCD 2024 : l'emprunt du catalogue au numéro de la fiche
        carte(60, 'WCD-2024', '006', [emp('WCD-2024', '006', 'w6')]),
        carte(61, 'WCD-2024', '007', [emp('WCD-2024', '007', 'w7', { differenceEmprunt: null })]),
        carte(62, 'WCD-2024', '008', [emp('WCD-2024', '009', 'w9')]),
        carte(63, 'WCD-2024', '010', [emp('WCD-2024', '010', 'w10', { source: 'tcgdex' })]),
        carte(64, 'WCD-2024', '011', [emp('WCD-2024', '011', 'w11', { langue: 'ja' })]),
        carte(65, 'Set-A', '012', [emp('Set-A', '012', 'sa12')]),
        carte(66, 'WCD-2024', null, [emp('WCD-2024', null, 'w66')]),                                     // la forme réelle : ni la fiche ni l'entrée n'ont de numéro (variantes V1…Vn d'un deck)
        carte(67, 'WCD-2024', null, [emp('WCD-2024', null, 'w67'), im('WCD-2024', null, 'w67b')])        // une AUTRE image de la carte dans le set : l'emprunt n'est plus seul, refusé
    ];
    const ligne = (id, carteId, setId, numeroFiche, slug, o = {}) => ({ idProduct: id, carteId, idExpansion: exps[setId], numeroFiche, slug, slugSet: setId, ...o });
    const lignes = [
        ligne(5001, 50, 'Battle-Academy-2024', null, 'Picnicker-BA24A34', { visuelSubstitut: SUBST }),
        ligne(5002, 50, 'Battle-Academy-2024', null, 'Picnicker-BA24P26'),
        ligne(5003, 50, 'Battle-Academy-2024', null, 'Picnicker-BA24DAR'),
        ligne(5004, 50, 'Battle-Academy-2024', null, 'Picnicker-V1-SVI114', { visuelSubstitut: SUBST }),
        ligne(5005, 50, 'Battle-Academy-2024', null, 'Picnicker-BA24A47'),
        ligne(5006, 50, 'Battle-Academy-2024', null, 'Picnicker-BA24P46'),
        ligne(5007, 50, 'Battle-Academy-2024', null, 'Picnicker-BA22A34'),
        ligne(5101, 51, 'Battle-Academy-2024', null, 'Hop-BA24A10'),
        ligne(5102, 51, 'Battle-Academy-2024', null, 'Hop-V1-BA24A11'), ligne(5103, 51, 'Battle-Academy-2024', null, 'Hop-V2-BA24A11'),
        ligne(5201, 52, 'Battle-Academy-2024', null, 'Iono-BA24A20'), ligne(5202, 52, 'Battle-Academy-2024', null, 'Iono-BA24A21'),
        ligne(5301, 53, 'Battle-Academy-2020', null, 'Potion-V2-BA20C37'), ligne(5302, 53, 'Battle-Academy-2020', null, 'Potion-V5-BA20MWT'),
        ligne(5401, 54, 'Set-A', null, 'Foo-BA24A01'),
        ligne(5501, 55, 'Battle-Academy-2020', null, 'Bar-V1-SUM001'), ligne(5502, 55, 'Battle-Academy-2020', null, 'Bar-V2-BA20C05'), ligne(5503, 55, 'Battle-Academy-2020', null, 'Bar-V3-BA20P07'),
        ligne(6001, 60, 'WCD-2024', '006', 'Zapdos-WCD24PGO-006'), ligne(6101, 61, 'WCD-2024', '007', 'X-WCD24PGO-007'), ligne(6201, 62, 'WCD-2024', '008', 'X-WCD24PGO-008'),
        ligne(6301, 63, 'WCD-2024', '010', 'X-WCD24PGO-010'), ligne(6401, 64, 'WCD-2024', '011', 'X-WCD24PGO-011'), ligne(6501, 65, 'Set-A', '012', 'X-SA-012'),
        ligne(6601, 66, 'WCD-2024', null, 'Rare-Candy-V1-WCD24HP-090', { visuelSubstitut: SUBST }), ligne(6602, 66, 'WCD-2024', null, 'Rare-Candy-V2-WCD24HP-090'),
        ligne(6701, 67, 'WCD-2024', null, 'Y-WCD24HP-091')
    ];
    const metacarte = new Map(lignes.map((l, i) => [l.idProduct, 9000 + i]));
    const r = await decider({ sets, docs, lignes, metacarte, regle });
    const e = id => r.entrees.find(x => x.idProduct === id);
    const cle = id => (e(id) ? e(id).grande?.cle ?? e(id).vignette?.cle ?? null : undefined);
    const d = r.denominateurs;

    // ── (A) Battle Academy
    H.v('A1. la position du slug (BA24A34) désigne le scan prv lu « A34 » : servi DU SET, malgré le substitut de la ligne', [e(5001)?.visuel, cle(5001), e(5001)?.mention], ['du-set', 'cartes/a34.webp', null]);
    H.v('A2. une autre position (BA24P26) désigne SON scan', [e(5002)?.visuel, cle(5002)], ['du-set', 'cartes/p26.webp']);
    H.v('A3. une position sans scan (DAR) : aucune entrée', e(5003), undefined);
    H.v('A4. un slug sans position (V1-SVI114) : le refus d\'avant (le substitut d\'un autre set reste refusé)', e(5004), undefined);
    H.v('A5. un scan prv SANS preuveLue.regle n\'est pas admis', e(5005), undefined);
    H.v('A6. un scan prv marqué imageEmprunteeTirage n\'est pas admis', e(5006), undefined);
    H.v('A7. l\'année du slug (BA22) n\'est pas celle du set (2024) : pas admis', e(5007), undefined);
    H.v('A8. deux scans prv à la même position : aucun (rien ne les sépare)', e(5101), undefined);
    H.v('A9. deux produits à la même position : aucun des deux', [e(5102), e(5103)], [undefined, undefined]);
    H.v('A10. un scan que la règle de langue du site refuse (ja sur un set intl) n\'est pas admis ; le voisin admis l\'est', [e(5201), e(5202)?.visuel], [undefined, 'du-set']);
    H.v('A11. Battle Academy 2020 : C37 et MWT (deck sans numéro) désignés', [cle(5301), cle(5302)], ['cartes/c37.webp', 'cartes/mwt.webp']);
    H.v('A12. hors famille (Set-A) : la règle ne s\'applique pas', e(5401), undefined);
    H.v('A13. un scan admis par la position n\'est PAS un emprunt', [r.emprunts.includes(5001), r.emprunts.includes(5301)], [false, false]);
    H.v('A14. le SEUL scan prv du set (C05) ne va qu\'au produit de SA position : pas au slug sans position, pas à une autre position', [e(5501), cle(5502), e(5503)], [undefined, 'cartes/c05.webp', undefined]);
    H.v('A15. compteur nommé : les scans de position servis à un autre produit sont retirés (5201 A21, 5501 et 5503 C05)', d.positionContredite, 3);

    // ── (B) WCD
    H.v('B1. WCD : l\'emprunt du catalogue au numéro de la fiche est servi, en AUTRE TIRAGE, avec sa mention', [e(6001)?.visuel, cle(6001), /autre tirage/i.test(e(6001)?.mention || '')], ['autre-tirage', 'cartes/w6.webp', true]);
    H.v('B2. et il est MARQUÉ emprunté (les règles d\'image ne le lisent pas)', r.emprunts.includes(6001), true);
    H.v('B3. sans differenceEmprunt « autre-tirage » : refusé comme avant', e(6101), undefined);
    H.v('B4. l\'emprunt ne porte pas le numéro de la fiche : refusé', e(6201), undefined);
    H.v('B5. une source autre que « emprunt » : refusé', e(6301), undefined);
    H.v('B6. un emprunt japonais sur un set occidental : refusé', e(6401), undefined);
    H.v('B7. un emprunt hors WCD (Set-A) : refusé comme avant (image-empruntee)', e(6501), undefined);
    H.v('B8. fiche et entrée sans numéro, entrée seule : servie aux DEUX variantes, en autre tirage, marquées empruntées', [e(6601)?.visuel, cle(6602), r.emprunts.includes(6601), r.emprunts.includes(6602)], ['autre-tirage', 'cartes/w66.webp', true, true]);
    H.v('B9. sans numéro, mais la carte a une autre image dans le set : l\'emprunt n\'est pas désigné', e(6701)?.grande?.cle === 'cartes/w67.webp', false);

    // ── comptes
    H.v('C1. compteurs nommés : 4 admis par la position (A34, P26, C37, MWT ; A21 et C05 sont choisis par choisirVisuel lui-même), 3 emprunts WCD', d.admisCatalogue, { 'prv-position': 4, 'wcd-emprunt': 3 });
    H.v('C2. la somme tient : avecLigne = écrites + aucun + sans fiche + refus + partage incohérent + position contredite', d.avecLigne, d.ecrites + d.aucun + d.sansFicheDuSite + d.repliRefuse.total + d.partageIncoherent + d.basseDefinitionExclue + d.positionContredite);
    const lues = r.entrees.map(x => lireEntree(JSON.parse(JSON.stringify(x))));
    const motifs = {}; for (const x of lues) if (!x.ok) motifs[x.motif] = (motifs[x.motif] || 0) + 1;
    H.v('C3. toutes les entrées émises passent la validation d\'entrée', motifs, {});

    // ── la lecture de `cartes` porte les deux champs
    const S = require('../chargeur/source');
    const c = S.compacterCarte({ _id: 1, nomEn: 'x', sets: ['A'], impressions: [], images: [{ set: 'A', cleR2: 'k', w: 1, h: 2, source: 'prv', preuveLue: { regle: 'preuve-lue', lu: { nom: 'n' } }, differenceEmprunt: 'autre-tirage' }] }, S.interneur());
    H.v('D1. compacterCarte réduit preuveLue à sa règle et garde differenceEmprunt', [c.images[0].preuveLueRegle, c.images[0].differenceEmprunt, c.images[0].preuveLue], ['preuve-lue', 'autre-tirage', undefined]);
    H.v('D2. la projection de `cartes` nomme les deux champs', [S.PROJECTIONS.cartes['images.preuveLue.regle'], S.PROJECTIONS.cartes['images.differenceEmprunt']], [1, 1]);
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
