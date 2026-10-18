'use strict';
// Banc B1a.1 — le Produit du contrat 2 (CONTRAT-2 §3.2). Module PUR : aucune base, aucun réseau.
const { v, vrai, bilan } = require('./_harnais');
const { construireProduit, VARIANTES } = require('../identifier/produit');

const CLES_PRODUIT = ['idProduct', 'nom', 'nomCardmarket', 'set', 'numero', 'total', 'langue', 'variante', 'version', 'rarete', 'visuel', 'visuelMention', 'prixGuide', 'liens', 'impressions'];
const BON = 'https://pub-7d992e666c3d4a2b870b680a920045b6.r2.dev/v/357044.webp';
const base = (o = {}) => ({
    idProduct: 357044, nomCardmarket: 'Lapras', nomFr: 'Lokhlass',
    set: { slug: '30th-Celebration', nom: '30th Celebration', code: '30C', tirage: 'intl', annee: 2026 },
    numero: '017', total: '128', langue: 'EN', variante: 'normale', rarete: 'Common',
    prixGuide: { trend: 15.2, low: 12.4, avg30: 14, guideDu: new Date('2026-10-04T00:00:00Z') },
    lienCardmarket: 'https://www.cardmarket.com/fr/Pokemon/Products/Singles/30th-Celebration/Lapras-30C017',
    ...o
});
const P = (o, ctx = { langueInterface: 'fr' }) => construireProduit(base(o), ctx);
const leve = f => { try { f(); return false; } catch { return true; } };

// 1. nom par langue
v('nom fr + nomFr', P({}).nom, 'Lokhlass');
v('nom fr sans nomFr', P({ nomFr: undefined }).nom, 'Lapras');
v('nom en', P({}, { langueInterface: 'en' }).nom, 'Lapras');
v('nom de (langue inconnue) -> anglais', P({}, { langueInterface: 'de' }).nom, 'Lapras');
v('nom langue absente -> anglais', P({}, {}).nom, 'Lapras');
v('nomCardmarket toujours le nom Cardmarket', P({}).nomCardmarket, 'Lapras');

// 2. prixGuide
v('prixGuide complet, date du GUIDE (F4 : base du « De », moyenne 7 j, fiabilité)', P({}).prixGuide,
    { tendance: 15.2, de: 12.4, deBase: 'tous-etats', moyenne7: null, moyenne30: 14, date: '2026-10-04', fiable: true, reserves: [] });
v('prixGuide : jamais la date d\'import (majAt)', P({ majAt: new Date('2026-10-08T10:00:00Z') }).prixGuide.date, '2026-10-04');
v('valeur absente -> null (pas 0)', P({ prixGuide: { trend: 15.2, low: null, guideDu: new Date('2026-10-04') } }).prixGuide,
    { tendance: 15.2, de: null, deBase: 'tous-etats', moyenne7: null, moyenne30: null, date: '2026-10-04', fiable: false, reserves: ['ecart-non-mesurable'] });       // tour 1 (I1) : aucune moyenne, l'écart n'est pas mesuré : jamais fiable
v('F4 I1 : un guide qui n\'a que « low » (aucune tendance, aucune moyenne) : non mesurable', (({ fiable, reserves }) => ({ fiable, reserves }))(P({ prixGuide: { low: 1, guideDu: new Date('2026-10-04') } }).prixGuide), { fiable: false, reserves: ['ecart-non-mesurable'] });
v('F4 I1 : ligne produit NON LUE (nonLu === true) : non fiable même à écart nul', (({ fiable, reserves }) => ({ fiable, reserves }))(P({ nonLu: true, prixGuide: { trend: 5, low: 4, avg7: 5, avg30: 5, guideDu: new Date('2026-10-04') } }).prixGuide), { fiable: false, reserves: ['ecart-non-mesurable'] });
// F4 (e) : l'écart de la tendance aux moyennes. Valeurs du cas réel (Arcanin [G] Lv.60, guide du 2026-10-12 : 10,18 / 14,59 / 13,15)
v('F4 (e) cas réel : tendance 10,18 contre la moyenne 7 j 14,59 (−30,2 %) : non fiable, ecart-tendance',
    (({ fiable, reserves }) => ({ fiable, reserves }))(P({ prixGuide: { trend: 10.18, low: 1, avg7: 14.59, avg30: 13.15, guideDu: new Date('2026-10-12') } }).prixGuide), { fiable: false, reserves: ['ecart-tendance'] });
v('F4 (e) la moyenne 7 j est servie', P({ prixGuide: { trend: 10.18, low: 1, avg7: 14.59, avg30: 13.15, guideDu: new Date('2026-10-12') } }).prixGuide.moyenne7, 14.59);
v('F4 (e) sans moyenne 7 j, l\'écart au 30 j suffit', P({ prixGuide: { trend: 5, low: 1, avg30: 10, guideDu: new Date('2026-10-12') } }).prixGuide.reserves, ['ecart-tendance']);
v('F4 (e) moyenne 7 j nulle ou négative -> null (un zéro n\'est pas un prix)', [P({ prixGuide: { trend: 5, low: 1, avg7: 0, avg30: 5, guideDu: new Date('2026-10-12') } }).prixGuide.moyenne7, P({ prixGuide: { trend: 5, low: 1, avg7: -2, avg30: 5, guideDu: new Date('2026-10-12') } }).prixGuide.moyenne7], [null, null]);
// F4 prix mélangés : la fiche mélange la version normale et une version tamponnée (Dark Arbok, Team Rocket 19, idProduct 274072, tampon league : liste du catalogue)
const MEL = { idProduct: 274072, nomCardmarket: 'Dark Arbok [Stare | Poison Vapor]', set: { slug: 'Team-Rocket', nom: 'Team Rocket', code: 'TR' }, numero: '19', prixGuide: { trend: 3, low: 1, avg7: 3, avg30: 3, guideDu: new Date('2026-10-12') } };
v('F4 prixMelangeTampon : le prix n\'est jamais fiable, les deux mentions fermées', (({ fiable, reserves }) => ({ fiable, reserves }))(construireProduit({ ...MEL, prixMelangeTampon: true }, { langueInterface: 'fr' }).prixGuide), { fiable: false, reserves: ['prix-indicatif-tampons-melanges', 'peut-etre-gonfle-par-tampons'] });
v('F4 sans prixMelangeTampon : fiable', construireProduit(MEL, { langueInterface: 'fr' }).prixGuide.fiable, true);
v('F4 prixMelangeTampon texte « true » : ne marque rien', construireProduit({ ...MEL, prixMelangeTampon: 'true' }, { langueInterface: 'fr' }).prixGuide.fiable, true);
v('F4 prixMelangeTampon sans prix du guide : pas de prixGuide (rien à marquer, rien d\'inventé)', construireProduit({ ...MEL, prixMelangeTampon: true, prixGuide: null }, { langueInterface: 'fr' }).prixGuide, null);
v('F4 le champ interne prixMelangeTampon ne fuit pas (seules les mentions sortent)', Object.keys(construireProduit({ ...MEL, prixMelangeTampon: true, tamponsConnus: ['league'] }, { langueInterface: 'fr' })).filter(k => /tampon/i.test(k)), []);
v('source sans guide -> null', P({ prixGuide: null }).prixGuide, null);
v('prixGuide undefined -> null', P({ prixGuide: undefined }).prixGuide, null);
v('trend 0 -> null (un zéro n\'est pas un prix)', P({ prixGuide: { trend: 0, low: 1, avg30: 2, guideDu: new Date('2026-10-04') } }).prixGuide.tendance, null);
v('trend négatif -> null', P({ prixGuide: { trend: -3, low: 1, avg30: 2, guideDu: new Date('2026-10-04') } }).prixGuide.tendance, null);
v('trend NaN -> null', P({ prixGuide: { trend: NaN, low: 1, avg30: 2, guideDu: new Date('2026-10-04') } }).prixGuide.tendance, null);
v('aucun prix valide -> prixGuide null', P({ prixGuide: { trend: 0, low: 0, avg30: null, guideDu: new Date('2026-10-04') } }).prixGuide, null);
v('prix sans date du guide -> null (un prix non daté ne se sert pas)', P({ prixGuide: { trend: 5, low: 4, avg30: 4 } }).prixGuide, null);
v('guideDu en chaîne AAAA-MM-JJ accepté', P({ prixGuide: { trend: 5, low: 4, avg30: 4, guideDu: '2026-10-03' } }).prixGuide.date, '2026-10-03');
v('guideDu illisible -> null', P({ prixGuide: { trend: 5, low: 4, avg30: 4, guideDu: 'hier' } }).prixGuide, null);

// 3. variante
v('variante de la liste gardée', P({ variante: 'reverse' }).variante, 'reverse');
for (const x of VARIANTES) v(`variante ${x} gardée`, P({ variante: x }).variante, x);
v('variante V2 -> null (pas de sémantique stable)', P({ variante: 'V2' }).variante, null);
v('variante absente -> null (jamais normale devinée)', P({ variante: undefined }).variante, null);
v('variante hors liste -> null', P({ variante: 'secrete' }).variante, null);
v('la liste fermée des variantes', [...VARIANTES], ['normale', 'reverse', 'holo', 'premiere-edition', 'tampon', 'jumbo']);

// 4. rareté, numéro, total
v('rareté telle quelle', P({ rarete: 'Holo Rare' }).rarete, 'Holo Rare');
v('rareté absente -> null', P({ rarete: undefined }).rarete, null);
v('numero chaîne', P({}).numero, '017');
v('numero absent -> null', P({ numero: undefined }).numero, null);
v('total absent -> null', P({ total: null }).total, null);
v('numero numérique -> chaîne', P({ numero: 4 }).numero, '4');

// 5. liens
v('lien Cardmarket si le numéro est connu', P({}).liens.cardmarket, base().lienCardmarket);
v('pas de rareté, numéro connu -> lien vers la page exacte (la rareté n\'est plus exigée)', P({ rarete: null }).liens.cardmarket, base().lienCardmarket);
v('lien de recherche refusé (jamais une recherche)', P({ lienCardmarket: 'https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=Lapras' }).liens.cardmarket, null);
v('pas de numéro -> pas de lien', P({ numero: null }).liens.cardmarket, null);
v('lien non https refusé', P({ lienCardmarket: 'http://www.cardmarket.com/x' }).liens.cardmarket, null);
v('lien hors Cardmarket refusé', P({ lienCardmarket: 'https://evil.example/x' }).liens.cardmarket, null);
v('fiche non servie -> null', P({}).liens.fiche, null);
v('fiche servie', P({}, { langueInterface: 'fr', ficheServie: true }).liens.fiche, 'https://rat-market.fr/fr/p/357044');

// 6. visuel
const vis = { url: BON, w: 255, h: 356, grande: { url: BON, w: 600, h: 825 } };
v('visuel sur notre hôte', P({ visuel: vis }).visuel, vis);
v('visuel sans grande -> grande null', P({ visuel: { url: BON, w: 255, h: 356 } }).visuel, { url: BON, w: 255, h: 356, grande: null });
v('pas de visuel -> null', P({}).visuel, null);
v('visuel Cardmarket REFUSÉ', P({ visuel: { url: 'https://www.cardmarket.com/img/x.jpg', w: 255, h: 356 } }).visuel, null);
v('visuel hôte étranger REFUSÉ', P({ visuel: { url: 'https://evil.example/x.png', w: 255, h: 356 } }).visuel, null);
v('visuel http REFUSÉ', P({ visuel: { url: 'http://rat-market.fr/x.png', w: 255, h: 356 } }).visuel, null);
v('visuel rat-market.fr accepté', P({ visuel: { url: 'https://rat-market.fr/x.png', w: 255, h: 356 } }).visuel.url, 'https://rat-market.fr/x.png');
v('astuce userinfo REFUSÉE', P({ visuel: { url: 'https://rat-market.fr@evil.example/x.png', w: 255, h: 356 } }).visuel, null);
v('sous-domaine voisin REFUSÉ', P({ visuel: { url: 'https://rat-market.fr.evil.example/x.png', w: 255, h: 356 } }).visuel, null);
v('url illisible -> null', P({ visuel: { url: 'pas une url', w: 255, h: 356 } }).visuel, null);
v('dimensions absentes -> null', P({ visuel: { url: BON } }).visuel, null);
v('grande hôte étranger -> grande null, visuel gardé', P({ visuel: { url: BON, w: 255, h: 356, grande: { url: 'https://evil.example/g.png', w: 600, h: 825 } } }).visuel.grande, null);
v('visuelMention avec un visuel', P({ visuel: vis, visuelMention: 'Visuel de la version japonaise' }).visuelMention, 'Visuel de la version japonaise');
v('visuelMention SANS visuel -> null', P({ visuelMention: 'Visuel de la version japonaise' }).visuelMention, null);
v('visuelMention avec visuel refusé -> null', P({ visuel: { url: 'https://evil.example/x.png', w: 1, h: 1 }, visuelMention: 'x' }).visuelMention, null);
v('visuelMention {fr,en} suit la langue', P({ visuel: vis, visuelMention: { fr: 'Autre tirage', en: 'Other print' } }, { langueInterface: 'en' }).visuelMention, 'Other print');

// 7. symbole du set
const sym = { url: 'https://rat-market.fr/s/30c.png', w: 40, h: 40 };
v('symbole sur notre hôte', P({ symbole: sym }).set.symbole, sym);
v('symbole hôte étranger -> null', P({ symbole: { url: 'https://evil.example/s.png', w: 40, h: 40 } }).set.symbole, null);
v('symbole absent -> null', P({}).set.symbole, null);
v('set : clés exactes (F4 (d) : badge et badgeSource)', Object.keys(P({}).set), ['slug', 'nom', 'code', 'tirage', 'annee', 'symbole', 'badge', 'badgeSource']);
v('F4 (d) badge : un code sans ambiguïté reste le code', [P({}).set.badge, P({}).set.badgeSource], ['30C', 'code']);
v('F4 (d) badge : SV (Supreme Victors) se donne par son nom, pas par un code qui ressemble à Scarlet & Violet', (({ code, badge, badgeSource }) => ({ code, badge, badgeSource }))(P({ set: { slug: 'Supreme-Victors', nom: 'Supreme Victors', code: 'SV' } }).set), { code: 'SV', badge: 'Supreme Victors', badgeSource: 'nom' });
v('F4 (d) badge : le code d\'origine n\'est jamais retiré de set.code', P({ set: { slug: 'Supreme-Victors', nom: 'Supreme Victors', code: 'SV' } }).set.code, 'SV');
v('F4 (d) badge : set sans code -> le nom', [P({ set: { slug: 'x', nom: 'Un Set' } }).set.badge, P({ set: { slug: 'x', nom: 'Un Set' } }).set.badgeSource], ['Un Set', 'nom']);

// F4 (c) la version Cardmarket (V1, V2…) : ce qui sépare deux produits au même set et au même numéro
v('F4 (c) version V2 servie sur le produit (variante reste null : pas de sémantique)', [P({ version: 'V2', variante: 'V2' }).version, P({ version: 'V2', variante: 'V2' }).variante], ['V2', null]);
v('F4 (c) version absente -> null (rien ne les sépare dans nos données : on ne devine pas)', P({}).version, null);
v('F4 (c) version hors forme (reverse, v2, V100) -> null', ['reverse', 'v2', 'V100', 12].map(x => P({ version: x }).version), [null, null, null, null]);

// 8. forme : exactement les clés du contrat, rien d'autre, gelé
const sortie = P({ champInterne: 'fuite', majAt: new Date(), _id: 'x', visuel: vis });
v('clés du Produit = CONTRAT-2 §3.2', Object.keys(sortie), CLES_PRODUIT);
vrai('aucun champ interne ne fuit', !('champInterne' in sortie) && !('majAt' in sortie) && !('_id' in sortie));
v('impressions par défaut', sortie.impressions, []);
vrai('sortie gelée', Object.isFrozen(sortie) && Object.isFrozen(sortie.set) && Object.isFrozen(sortie.liens));
{
    const g = P({ visuel: vis, symbole: sym });
    vrai('gel profond : visuel, visuel.grande, set.symbole, prixGuide', Object.isFrozen(g.visuel) && Object.isFrozen(g.visuel.grande) && Object.isFrozen(g.set.symbole) && Object.isFrozen(g.prixGuide));
}
vrai('entrée invalide : idProduct absent -> lève', leve(() => construireProduit({ nomCardmarket: 'X', set: { slug: 's', nom: 's' } }, { langueInterface: 'fr' })));
vrai('entrée invalide : set absent -> lève', leve(() => construireProduit({ idProduct: 1, nomCardmarket: 'X' }, { langueInterface: 'fr' })));

// 9. impressions
const LIEN_IMP = 'https://www.cardmarket.com/fr/Pokemon/Products/Singles/Base-Set/Charizard-BS4';
const imp = (o = {}) => ({ idProduct: 900002, numero: '4', total: '102', rarete: 'Holo Rare', variante: 'premiere-edition', set: { nom: 'Set de Base' },
    lien: LIEN_IMP, prixGuide: { trend: 1180, low: 950, avg30: 1000, guideDu: new Date('2026-10-05') }, ...o });
const avecImp = P({ impressions: [imp(), imp({ idProduct: 900004, rarete: null, numero: '3', variante: 'V3' })] });
v('impression complète', avecImp.impressions[0], { idProduct: 900002, numero: '4', total: '102', rarete: 'Holo Rare', variante: 'premiere-edition', version: null, langue: null, set: { nom: 'Set de Base' },
    lien: LIEN_IMP, prixGuide: { tendance: 1180, de: 950, deBase: 'tous-etats', moyenne7: null, moyenne30: 1000, date: '2026-10-05', fiable: true, reserves: [] } });
// F4 (b) le « ≈ 1,00 € » d'une impression est le « De » : l'offre la plus basse TOUS ÉTATS ; il le dit (deBase), jamais le prix de l'état retenu
v('F4 (b) chaque prix d\'impression dit sa base : tous états', avecImp.impressions.map(i => i.prixGuide.deBase), ['tous-etats', 'tous-etats']);
// F4 (c) les deux impressions du cas réel : Supreme Victors 15/147, V1 (278706) et V2 (371545) — rien d'autre ne les sépare
{
    const sv = P({ impressions: [imp({ idProduct: 278706, numero: '15', total: '147', rarete: 'Rare', variante: null, version: 'V1', set: { nom: 'Supreme Victors' }, prixGuide: { trend: 3.35, low: 0.47, avg30: 3.42, guideDu: new Date('2026-10-12') } }),
                                  imp({ idProduct: 371545, numero: '15', total: '147', rarete: 'Rare', variante: null, version: 'V2', set: { nom: 'Supreme Victors' }, prixGuide: { trend: 10.18, low: 1, avg7: 14.59, avg30: 13.15, guideDu: new Date('2026-10-12') } })] }).impressions;
    v('F4 (c) deux lignes « Supreme Victors n° 15/147 » : la version les sépare (V1, V2)', sv.map(i => [i.idProduct, i.version]), [[278706, 'V1'], [371545, 'V2']]);
    v('F4 (e) sur l\'impression V2 : tendance 10,18 contre la moyenne 7 j 14,59 -> non fiable', [sv[0].prixGuide.fiable, sv[1].prixGuide.fiable, sv[1].prixGuide.reserves], [true, false, ['ecart-tendance']]);
}
v('F4 impression : prixMelangeTampon -> les deux mentions, le champ interne ne sort pas', (i => [i.prixGuide.fiable, i.prixGuide.reserves, Object.keys(i).filter(k => /tampon/i.test(k))])(P({ impressions: [imp({ prixMelangeTampon: true })] }).impressions[0]), [false, ['prix-indicatif-tampons-melanges', 'peut-etre-gonfle-par-tampons'], []]);
v('F4 I1 impression non lue (absente de numeros_cartes) : jamais fiable, ecart-non-mesurable, le champ interne ne sort pas', (i => [i.prixGuide.fiable, i.prixGuide.reserves, Object.keys(i).filter(k => /nonLu/i.test(k))])(P({ impressions: [imp({ nonLu: true, prixGuide: { trend: 5, low: 4, avg7: 5, avg30: 5, guideDu: new Date('2026-10-05') } })] }).impressions[0]), [false, ['ecart-non-mesurable'], []]);
v('F4 (c) impression : version hors forme -> null', P({ impressions: [imp({ version: 'staff' })] }).impressions[0].version, null);
v('impression sans rareté, numéro connu -> lien (la rareté n\'est plus exigée)', avecImp.impressions[1].lien, LIEN_IMP);
v('impression sans numéro -> lien null', P({ impressions: [imp({ numero: null })] }).impressions[0].lien, null);
v('impression variante hors liste -> null', avecImp.impressions[1].variante, null);
v('impression : clés (LANGUE-DECISIVE : `langue` ajoutée, contrat 7a ; F4 : `version`)', Object.keys(avecImp.impressions[0]), ['idProduct', 'numero', 'total', 'rarete', 'variante', 'version', 'langue', 'set', 'lien', 'prixGuide']);
v('impression : langue en code fermé conservée (ja, zh-hans)', P({ impressions: [imp({ langue: 'ja' }), imp({ idProduct: 900003, langue: 'zh-hans' })] }).impressions.map(i => i.langue), ['ja', 'zh-hans']);
v('impression : langue hors liste (JP, EN, texte libre, nombre) -> null, jamais devinée', P({ impressions: [imp({ langue: 'JP' }), imp({ idProduct: 900003, langue: 'EN' }), imp({ idProduct: 900005, langue: 'japonais' }), imp({ idProduct: 900006, langue: 7 })] }).impressions.map(i => i.langue), [null, null, null, null]);
vrai('impressions gelées', Object.isFrozen(avecImp.impressions) && Object.isFrozen(avecImp.impressions[0]));

process.exitCode = 0;
bilan();
