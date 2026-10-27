'use strict';
// MARQUEURS — le module pur (v2/identifier/marqueurs.js) : la table du contrat lue DANS LE FICHIER et comparée au module, les 40 caractères de TOUS les libellés avec les paramètres les plus longs, les refus hors liste,
// la dérivation depuis le seul prouvé, la fusion (le dérivé l'emporte, les écarts sont comptés), `[]` contre `null`. Aucune base, aucun réseau.
const fs = require('fs'), path = require('path');
const H = require('./_harnais');
const MQ = require('../identifier/marqueurs');
const MT = require('../identifier/marques-tampon');

// ── 1. LA TABLE DU CONTRAT, lue dans le fichier
const contrat = fs.readFileSync(path.join(__dirname, '..', '..', 'CONTRAT-MARQUEURS.md'), 'utf8');
const section3 = contrat.split(/^## 3\./m)[1].split(/^## 4\./m)[0];
const lignes = section3.split(/\r?\n/).filter(l => /^\| `[A-Z0-9_]+` \|/.test(l)).map(l => l.split('|').slice(1, -1).map(c => c.trim()));
const types = lignes.map(c => c[0].replace(/`/g, ''));
H.v('1a. la table du §3 du contrat et le module disent les MÊMES types, dans le MÊME ordre (ordre d\'affichage)', types, [...MQ.NOMS_TYPES]);
H.v('1b. 24 types (la liste fermée du contrat)', types.length, 24);
const sansParam = lignes.filter(c => c[1] === '—');
H.v('1c. chaque type sans paramètre : le libellé FR et EN du contrat est EXACTEMENT celui du module',
    sansParam.map(c => [c[0].replace(/`/g, ''), c[2], c[3]]), MQ.TYPES.filter(t => t.params.length === 0).map(t => [t.type, t.libelle.fr, t.libelle.en]));
H.v('1d. les types à paramètres (WCD, PLACE) sont ceux du contrat, avec les mêmes paramètres', lignes.filter(c => c[1] !== '—').map(c => [c[0].replace(/`/g, ''), c[1].replace(/`/g, '')]),
    MQ.TYPES.filter(t => t.params.length).map(t => [t.type, t.params.map(p => (t.obligatoires.includes(p) ? p : p + '?')).join(', ')]));
const wcd = lignes.find(c => c[0] === '`WCD`');
H.v('1e. WCD : les trois gabarits FR et EN du contrat sont ceux du module', [wcd[2].includes(MQ.WCD_GABARITS.fr[0]), wcd[2].includes('courte : ' + MQ.WCD_GABARITS.fr[1]), wcd[2].includes('sans joueur : ' + MQ.WCD_GABARITS.fr[2]),
    wcd[3].includes(MQ.WCD_GABARITS.en[0]), wcd[3].includes('courte : ' + MQ.WCD_GABARITS.en[1]), wcd[3].includes('sans joueur : ' + MQ.WCD_GABARITS.en[2])], Array(6).fill(true));
const place = lignes.find(c => c[0] === '`PLACE`');
H.v('1f. PLACE : « re place » pour 1, « e place » pour 2 à 4, st / nd / rd / th en anglais — comme le contrat', [place[2].includes('Tampon {rang}re place (1)'), place[2].includes('Tampon {rang}e place (2–4)'), place[3].includes('st / nd / rd / th Place stamp'),
    MQ.rendre('PLACE', { rang: 1 }), MQ.rendre('PLACE', { rang: 2 }), MQ.rendre('PLACE', { rang: 3 }), MQ.rendre('PLACE', { rang: 4 })],
    [true, true, true, { fr: 'Tampon 1re place', en: '1st Place stamp' }, { fr: 'Tampon 2e place', en: '2nd Place stamp' }, { fr: 'Tampon 3e place', en: '3rd Place stamp' }, { fr: 'Tampon 4e place', en: '4th Place stamp' }]);
H.v('1g. le contrat dit 40 caractères et 0 à 4 éléments : le module aussi', [MQ.LIBELLE_MAX, MQ.MARQUEURS_MAX, /40 caractères au plus/.test(contrat), /0 à 4 éléments/.test(contrat)], [40, 4, true, true]);

// ── 2. LES 40 CARACTÈRES : TOUS les libellés de tous les types, avec les paramètres les plus longs admis
const LONG = 'Abcdefghi Klmnopqr Stuvwx'.slice(0, 24);                                    // 24 caractères
const cas = [];
for (const t of MQ.TYPES) {
    if (t.type === 'WCD') { for (const annee of [1996, 2018, 2099]) for (const joueur of [undefined, 'Al', 'Magnus Pedersen', LONG, 'Jean-Pierre O\'Neil Jr.']) cas.push(['WCD', joueur === undefined ? { annee } : { annee, joueur }]); }
    else if (t.type === 'PLACE') for (const rang of [1, 2, 3, 4]) cas.push(['PLACE', { rang }]);
    else cas.push([t.type, {}]);
}
const rendus = cas.map(([t, p]) => ({ t, p, r: MQ.rendre(t, p) }));
H.v('2a. ' + cas.length + ' combinaisons (tous les types, joueur de 24 caractères, années 1996 / 2099, rangs 1 à 4) : TOUS les libellés FR et EN tiennent en 40', rendus.filter(x => x.r.fr.length > 40 || x.r.en.length > 40 || !x.r.fr || !x.r.en).length, 0);
H.v('2b. le joueur de 24 caractères fait retomber WCD à la forme suivante (jamais tronqué)', [MQ.rendre('WCD', { annee: 2018, joueur: LONG }), MQ.rendre('WCD', { annee: 2018, joueur: 'Magnus Pedersen' })],
    [{ fr: 'Deck Championnats du monde 2018', en: 'World Championships Deck 2018' }, { fr: 'Deck Mondiaux 2018 · Magnus Pedersen', en: 'Worlds Deck 2018 · Magnus Pedersen' }]);
H.v('2c. un joueur court garde la forme COMPLÈTE', MQ.rendre('WCD', { annee: 2018, joueur: 'Al' }), { fr: 'Deck Championnats du monde 2018 · Al', en: 'World Championships Deck 2018 · Al' });
H.v('2d. rendre LÈVE sur un type hors liste, un paramètre inconnu, une année hors plage', [() => MQ.rendre('INCONNU', {}), () => MQ.rendre('JUMBO', { x: 1 }), () => MQ.rendre('WCD', { annee: 1995 }), () => MQ.rendre('WCD', {})]
    .map(f => { try { f(); return 'ne lève pas'; } catch { return 'lève'; } }), Array(4).fill('lève'));

// ── 3. valider : écrit par ce qu'il autorise
const ok = (e) => { const v = MQ.valider(e); return v === null ? null : [v.type, v.params, v.libelle.fr]; };
H.v('3a. un élément du contrat est canonique (le libelle reçu est re-rendu, jamais repris)', [ok({ type: 'WCD', params: { annee: 2018, joueur: 'Magnus Pedersen' } }), ok({ type: 'JUMBO', libelle: { fr: 'FAUX', en: 'FAUX' } }), ok({ type: 'JUMBO' })],
    [['WCD', { annee: 2018, joueur: 'Magnus Pedersen' }, 'Deck Mondiaux 2018 · Magnus Pedersen'], ['JUMBO', {}, 'Carte Jumbo'], ['JUMBO', {}, 'Carte Jumbo']]);
const refus = [
    [{ type: 'JUMBOS' }, 'type hors liste'], [{ type: 'jumbo' }, 'casse'], [{}, 'sans type'], [null, 'null'], ['JUMBO', 'chaîne'], [[], 'tableau'],
    [{ type: 'JUMBO', params: { annee: 2018 } }, 'paramètre en trop'], [{ type: 'WCD', params: { annee: 2018, equipe: 'x' } }, 'paramètre inconnu'], [{ type: 'WCD', params: {} }, 'année absente'],
    [{ type: 'WCD', params: { annee: '2018' } }, 'année chaîne'], [{ type: 'WCD', params: { annee: 1995 } }, 'année < 1996'], [{ type: 'WCD', params: { annee: 2100 } }, 'année > 2099'], [{ type: 'WCD', params: { annee: 2018.5 } }, 'année non entière'],
    [{ type: 'WCD', params: { annee: 2018, joueur: '' } }, 'joueur vide'], [{ type: 'WCD', params: { annee: 2018, joueur: 'A'.repeat(25) } }, 'joueur de 25'], [{ type: 'WCD', params: { annee: 2018, joueur: 'Bob2' } }, 'joueur avec chiffre'],
    [{ type: 'WCD', params: { annee: 2018, joueur: ' Bob' } }, 'joueur non rogné'], [{ type: 'WCD', params: { annee: 2018, joueur: null } }, 'joueur null'], [{ type: 'WCD', params: { annee: 2018, joueur: '<b>' } }, 'joueur avec balise'],
    [{ type: 'PLACE', params: {} }, 'rang absent'], [{ type: 'PLACE', params: { rang: 5 } }, 'rang 5'], [{ type: 'PLACE', params: { rang: 0 } }, 'rang 0'], [{ type: 'PLACE', params: { rang: '1' } }, 'rang chaîne'],
    [{ type: 'STAFF', params: { rang: 1 } }, 'rang sur un type sans'], [{ type: 'STAFF', extra: 1 }, 'champ en plus'], [{ type: 'STAFF', params: [] }, 'params tableau'], [{ type: 'STAFF', params: null }, 'params null']];
H.v('3b. ' + refus.length + ' formes hors liste : tout est null (rien n\'est corrigé en silence)', refus.filter(([e]) => MQ.valider(e) !== null).map(([, n]) => n), []);

// ── 4. deriver : de ce qui est PROUVÉ seulement ; [] contre null
const d = p => { const r = MQ.deriver(p); return r === null ? null : r.map(e => e.type + (e.params.rang ? e.params.rang : '') + (e.params.annee ? e.params.annee : '')); };
H.v('4a. [] (prouvé sans marqueur) : la variante normale prouvée (marques []) hors famille de set', d({ variante: 'normale', marques: [], set: { slug: 'Base-Set' } }), []);
H.v('4b. null (on ne sait pas) : aucune marque prouvée, aucune règle de set — jamais [] à la place', [d({ variante: null, marques: null, set: { slug: 'Base-Set' } }), d({}), d(null), d({ variante: 'reverse', marques: null, set: { slug: 'Base-Set' } })], [null, null, null, null]);
H.v('4c. une marque prouvée → son bandeau ; un ensemble → ses bandeaux dans l\'ORDRE de la table', [d({ marques: ['staff'], set: { slug: 'X' } }), d({ marques: ['staff', 'prerelease'], set: { slug: 'X' } }), d({ marques: ['league', 'place-2'], set: { slug: 'X' } })],
    [['STAFF'], ['STAFF', 'PRERELEASE'], ['LEAGUE', 'PLACE2']]);
H.v('4d. CHAQUE marque de marques-tampon.js a son bandeau (une seule définition des marques)', MT.MARQUES.map(m => d({ marques: [m], set: { slug: 'X' } })).filter(x => !x || x.length !== 1).length, 0);
H.v('4e. jumbo prouvé → JUMBO + NON_LEGAL ; première édition prouvée → EDITION_1', [d({ variante: 'jumbo', marques: null, set: { slug: 'X' } }), d({ variante: 'premiere-edition', marques: null, set: { slug: 'X' } })], [['JUMBO', 'NON_LEGAL'], ['EDITION_1']]);
H.v('4f. les familles de set : WCD-2018 → WCD + NON_LEGAL (année du slug) ; Prize Pack → PLAY_POKEMON ; Trick or Trade (avec ou sans année) ; Battle Academy ; McDonalds', [
    d({ set: { slug: 'WCD-2018' } }), d({ set: { slug: 'Play-Pokemon-Prize-Pack-Series-Three' } }), d({ set: { slug: 'Trick-or-Trade' } }), d({ set: { slug: 'Trick-or-Trade-2024' } }), d({ set: { slug: 'Battle-Academy-2022' } }), d({ set: { slug: 'McDonalds-Collection-2011' } })],
    [['WCD2018', 'NON_LEGAL'], ['PLAY_POKEMON'], ['TRICK_OR_TRADE'], ['TRICK_OR_TRADE'], ['BATTLE_ACADEMY'], ['MCDONALDS']]);
H.v('4g. des slugs qui RESSEMBLENT à une famille sans y figurer : null (jamais deviné)', [d({ set: { slug: 'WCD-20188' } }), d({ set: { slug: 'WCD-1995' } }), d({ set: { slug: 'WCD' } }), d({ set: { slug: 'Trick-or-Trade-24' } }), d({ set: { slug: 'Battle-Academy' } }), d({ set: { slug: 'McDonald' } }), d({ set: { slug: 'XWCD-2018' } })], Array(7).fill(null));
H.v('4h. marque + famille de set : la réunion, sans doublon de type, dans l\'ordre (Prize Pack ET marque play-pokemon : un seul PLAY_POKEMON)',
    [d({ marques: ['staff'], set: { slug: 'WCD-2018' } }), d({ marques: ['play-pokemon'], set: { slug: 'Play-Pokemon-Prize-Pack-Series-One' } })], [['WCD2018', 'NON_LEGAL', 'STAFF'], ['PLAY_POKEMON']]);
H.v('4i. des marques non canoniques (hors liste, autre ordre, doublon) ne PROUVENT rien : null', [d({ marques: ['inconnue'], set: { slug: 'X' } }), d({ marques: ['prerelease', 'staff'], set: { slug: 'X' } }), d({ marques: ['staff', 'staff'], set: { slug: 'X' } })], [null, null, null]);
H.v('4j. plus de 4 éléments (WCD + NON_LEGAL + 3 marques) : null — le contrat n\'en admet que 4, rien n\'est tronqué', d({ marques: ['staff', 'prerelease', 'league'], set: { slug: 'WCD-2018' } }), null);
H.v('4k. la dérivation ne lit que les champs prouvés : un élément du produit ressemblant (nom, mention, visuel) ne pose rien', d({ nom: 'Jumbo Pikachu', visuelMention: 'jumbo', set: { slug: 'X' } }), null);
H.v('4l. slugSet seul (sans set.slug) est lu aussi ; le slug d\'un lien d\'impression se lit par slugSetDuLien', [d({ slugSet: 'WCD-2018' }), MQ.slugSetDuLien('https://www.cardmarket.com/fr/Pokemon/Products/Singles/WCD-2018/Pikachu-V1'), MQ.slugSetDuLien('n\'importe quoi'), MQ.slugSetDuLien(null)], [['WCD2018', 'NON_LEGAL'], 'WCD-2018', null, null]);
H.v('4m. les éléments dérivés portent leur libellé rendu (FR et EN) et le tableau est gelé', (() => { const r = MQ.deriver({ set: { slug: 'WCD-2018' } }); return [r[0].libelle, Object.isFrozen(r)]; })(),
    [{ fr: 'Deck Championnats du monde 2018', en: 'World Championships Deck 2018' }, true]);

// ── 5. fusionner : le dérivé l'emporte, tout écart est COMPTÉ
const derWcd = MQ.deriver({ set: { slug: 'WCD-2018' } });
const f = (derives, ecrits) => { const r = MQ.fusionner(derives, ecrits); return [r.marqueurs === null ? null : r.marqueurs.map(e => e.type + (e.params.annee || '')), r.contradictions, r.invalides, r.doublons, r.trop]; };
H.v('5a. rien de dérivé, rien d\'écrit : null (on ne sait pas) ; un écrit seul est servi (le catalogue l\'a prouvé) ; une liste écrite VIDE ne prouve rien', [f(null, undefined), f(null, null), f(null, []), f(null, [{ type: 'SHADOWLESS' }])],
    [[null, 0, 0, 0, 0], [null, 0, 0, 0, 0], [null, 0, 0, 0, 0], [['SHADOWLESS'], 0, 0, 0, 0]]);
H.v('5b. dérivé [] et rien d\'écrit : [] (prouvé sans marqueur)', f([], undefined), [[], 0, 0, 0, 0]);
H.v('5c. un écrit d\'un autre type s\'ajoute dans l\'ORDRE de la table (SHADOWLESS après NON_LEGAL)', f(derWcd, [{ type: 'SHADOWLESS' }]), [['WCD2018', 'NON_LEGAL', 'SHADOWLESS'], 0, 0, 0, 0]);
H.v('5d. un écrit du même type, même paramètre : rien à signaler ; un écrit qui CONTREDIT (autre année) : le dérivé l\'emporte, contradiction comptée', [f(derWcd, [{ type: 'WCD', params: { annee: 2018 } }]), f(derWcd, [{ type: 'WCD', params: { annee: 2019 } }])],
    [[['WCD2018', 'NON_LEGAL'], 0, 0, 0, 0], [['WCD2018', 'NON_LEGAL'], 1, 0, 0, 0]]);
H.v('5e. un écrit invalide (type hors liste, paramètre en trop) est écarté et COMPTÉ, jamais réparé ; le reste passe', f(derWcd, [{ type: 'INVENTE' }, { type: 'JUMBO', params: { x: 1 } }, 'n\'importe quoi', { type: 'SHADOWLESS' }]), [['WCD2018', 'NON_LEGAL', 'SHADOWLESS'], 0, 3, 0, 0]);
H.v('5f. deux écrits du même type : le second est un doublon compté', f(null, [{ type: 'ORIGINS' }, { type: 'ORIGINS' }]), [['ORIGINS'], 0, 0, 1, 0]);
H.v('5g. des écrits qui ne sont pas une liste (objet, chaîne) sont ignorés', [f(null, { type: 'ORIGINS' }), f(null, 'ORIGINS')], [[null, 0, 0, 0, 0], [null, 0, 0, 0, 0]]);
H.v('5h. plus de 4 éléments après fusion : null et `trop` = 1', f(derWcd, [{ type: 'SHADOWLESS' }, { type: 'ORIGINS' }, { type: 'POKEMON_CENTER' }]), [null, 0, 0, 0, 1]);
H.v('5i. marqueursDe = le tableau fusionné seul', [MQ.marqueursDe({ set: { slug: 'WCD-2018' } }, [{ type: 'SHADOWLESS' }]).length, MQ.marqueursDe({}, undefined)], [3, null]);

// ── 5 bis. Un set WCD reconnu SUR UNE ENTRÉE (la seule exception de la validation d'entrée, CONTRAT-MARQUEURS §6)
{
    const L = 'https://www.cardmarket.com/fr/Pokemon/Products/Singles/';
    H.v('5j. anneeDuSetWcd : WCD-<aaaa> de 1996 à 2099 seulement', ['WCD-2018', 'WCD-1996', 'WCD-2099', 'WCD-1995', 'WCD-2100', 'WCD-20188', 'WCD-', 'wcd-2018', 'XWCD-2018', null, 5].map(MQ.anneeDuSetWcd), [2018, 1996, 2099, null, null, null, null, null, null, null, null]);
    H.v('5k. setWcdDeLEntree : par le lien Cardmarket (slugSet) OU par le nom affiché « WCD <aaaa> » ; rien d\'autre',
        [{ lien: L + 'WCD-2018/Pikachu-V1' }, { setNom: 'WCD 2018' }, { lien: L + 'Set-A/X', setNom: 'WCD 2018' }, { lien: L + 'Set-A/X', setNom: 'Set A' }, { setNom: 'WCD 1995' }, { setNom: 'WCD 20188' }, { setNom: 'wcd 2018' }, { setNom: ' WCD 2018' }, { setNom: 'World Championship Decks 2018' }, { lien: L + 'WCD-2018' }, { lien: 'WCD-2018' }, {}, null, 'WCD 2018'].map(MQ.setWcdDeLEntree),
        [true, true, true, false, false, false, false, false, false, false, false, false, false, false]);
}

// ── 6. LA LECTURE de ce que le catalogue écrit (cartes_produits.marqueurs, marqueursPreuve) par le chargeur
{
    const { PROJECTIONS, compacterLigne, interneur } = require('../chargeur/source');
    const I = interneur(), cl = x => compacterLigne({ carteId: 1, idProduct: 1, idExpansion: 1, ...x }, I);
    H.v('6a. la projection de cartes_produits lit marqueurs et marqueursPreuve', [PROJECTIONS.cartes_produits.marqueurs, PROJECTIONS.cartes_produits.marqueursPreuve], [1, 1]);
    H.v('6b. compacterLigne : la liste écrite et sa preuve sont gardées telles quelles (rien validé ni réparé) ; absent, pas une liste, preuve vide ou pas un texte : null', [
        cl({ marqueurs: [{ type: 'SHADOWLESS', params: {}, libelle: { fr: 'ignoré' } }, null, 'x'], marqueursPreuve: '  Bulbapedia  ' }).marqueurs, cl({ marqueurs: [{ type: 'SHADOWLESS' }], marqueursPreuve: ' Bulbapedia ' }).marqueursPreuve,
        cl({}).marqueurs, cl({ marqueurs: 'SHADOWLESS' }).marqueurs, cl({ marqueursPreuve: '  ' }).marqueursPreuve, cl({ marqueursPreuve: 5 }).marqueursPreuve],
        [[{ type: 'SHADOWLESS', params: {} }, null, null], 'Bulbapedia', null, null, null, null]);
    H.v('6c. les éléments mal formés lus ainsi sont ensuite COMPTÉS invalides par la fusion, jamais réparés', MQ.fusionner(null, cl({ marqueurs: [{ type: 'SHADOWLESS' }, null, 'x', { type: 'JUMBO', params: { a: 1 } }] }).marqueurs).invalides, 3);
}

H.bilan();
