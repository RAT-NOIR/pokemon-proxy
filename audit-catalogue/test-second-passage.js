// node audit-catalogue/test-second-passage.js — les règles du SECOND PASSAGE (seuils.md du coordinateur, 24/10, après lecture des 200 paires) :
// seuils CONFORME / INCERTAIN / PROBABLEMENT FAUX, exclusion de format, motif finition-ou-tampon-non-verifie, `sans-numero` resserrée, sous-motif emprunt-refuse-par-api.
const C = require('./classement');
const { lireJson } = require('./ecrire');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

// ── LES SEUILS : des constantes NOMMÉES, celles du coordinateur
verifier('SEUILS : conforme 0,55 et incertain 0,65', C.SEUILS, { conforme: 0.55, incertain: 0.65 });
const cmp = { comparable: true, motif: null };
const classe = (d, nom = 'Pikachu') => C.classerComparaison({ comparaison: cmp, distance: d, nom }).classe;
verifier('d = 0,5499 : CONFORME', classe(0.5499), 'CONFORME');
verifier('d = 0,55 : INCERTAIN (la borne basse de l\'incertain est incluse)', classe(0.55), 'INCERTAIN');
verifier('d = 0,6499 : INCERTAIN', classe(0.6499), 'INCERTAIN');
verifier('d = 0,65 : PROBABLEMENT FAUX (la borne est incluse)', classe(0.65), 'PROBABLEMENT_FAUX');
verifier('d = 1 : PROBABLEMENT FAUX', classe(1), 'PROBABLEMENT_FAUX');
verifier('d = 0 : CONFORME', classe(0), 'CONFORME');
// la planche de calibration est la RÉFÉRENCE des seuils : les 200 paires lues par le coordinateur (120 / 31 / 49)
const cal = lireJson('calibration-200.json').paires;
// ⚠️ seuils.md écrit « 120 / 31 / 49 » ; les constantes 0,55 et 0,65 appliquées aux 200 distances écrites rendent 121 / 22 / 57 (les rangs 144 à 151, de 0,654 à 0,674, sont ≥ 0,65). On teste donc
// ce que seuils.md NOMME, paire par paire, et on écrit le compte réel :
const parClasse = {}; for (const p of cal) { const k = classe(p.distance); parClasse[k] = (parClasse[k] || 0) + 1; }
verifier('la planche de 200 : les constantes rendent 121 CONFORME, 22 INCERTAIN, 57 PROBABLEMENT FAUX', parClasse, { CONFORME: 121, INCERTAIN: 22, PROBABLEMENT_FAUX: 57 });
const classeDe = id => classe(cal.find(p => p.idProduct === id).distance);
verifier('les 3 dessins différents de la bande 0,55-0,65 (605372, 700744, 371643) sont INCERTAIN', [605372, 700744, 371643].map(classeDe), ['INCERTAIN', 'INCERTAIN', 'INCERTAIN']);
verifier('les 13 dessins différents lus à d ≥ 0,65 sont tous PROBABLEMENT FAUX', [730130, 471694, 700771, 554185, 450308, 449138, 665136, 471684, 471679, 311404, 824940, 321171, 523095].map(classeDe).every(c => c === 'PROBABLEMENT_FAUX'), true);
verifier('Machamp National Championships 449903 (0,42) est CONFORME : l\'empreinte juge le dessin, pas le tampon', classeDe(449903), 'CONFORME');
verifier('Lucario ex Oversized 845430 (0,128) : CONFORME par la distance seule, INVÉRIFIABLE par le format', [classeDe(845430), C.classerComparaison({ comparaison: cmp, distance: cal.find(p => p.idProduct === 845430).distance, nom: 'Lucario ex [Oversized]' }).classe], ['CONFORME', 'INVERIFIABLE']);

// ── L'EXCLUSION DE FORMAT : LEGEND, V-UNION, BREAK, Oversized, QUELLE QUE SOIT LA DISTANCE ; le motif `format` est écrit
for (const nom of ['Ho-Oh LEGEND [Top]', 'Greninja V-UNION [Union Gain]', 'Chesnaught BREAK [Tough Hammer]', 'Pikachu V-UNION [Oversized]', 'Lucario ex [Oversized]'])
    verifier(`format : « ${nom} » ne se juge pas, même à d = 0,9`, C.classerComparaison({ comparaison: cmp, distance: 0.9, nom }), { classe: 'INVERIFIABLE', motif: 'format' });
verifier('format : même à d = 0,1 (« quelle que soit la distance »)', C.classerComparaison({ comparaison: cmp, distance: 0.1, nom: 'Lugia LEGEND [Bottom]' }).motif, 'format');
verifier('une attaque « Tea Break » ou « Break Ground » n\'est PAS le format BREAK (casse et mot)', [C.formatConcerne('Polteageist [Tea Break | Mad Party]'), C.formatConcerne('Groudon [Rock Smash | Break Ground]'), C.formatConcerne('Bronzong [Legend Ceremony | Reflect Energy]')], [false, false, false]);
verifier('un nom ordinaire n\'est pas un format', C.formatConcerne('Charizard ex'), false);
verifier('format prioritaire sur le motif de comparaison (une copie absente reste dite « format »)', C.classerComparaison({ comparaison: { comparable: false, motif: 'pas-de-copie-locale' }, distance: null, nom: 'Greninja V-UNION [Oversized]' }), { classe: 'INVERIFIABLE', motif: 'format' });
verifier('non comparable (pas de copie) : INVÉRIFIABLE avec son motif', C.classerComparaison({ comparaison: { comparable: false, motif: 'pas-de-copie-locale' }, distance: null, nom: 'Pikachu' }), { classe: 'INVERIFIABLE', motif: 'pas-de-copie-locale' });
verifier('classerFinal : un A_COMPARER à d = 0,3 est CONFORME', C.classerFinal({ classe: 'A_COMPARER', comparaison: cmp, distance: 0.3, nom: 'Pikachu' }), 'CONFORME');
verifier('classerFinal : un A_COMPARER à d = 0,6 est INCERTAIN', C.classerFinal({ classe: 'A_COMPARER', comparaison: cmp, distance: 0.6, nom: 'Pikachu' }), 'INCERTAIN');
verifier('classerFinal : un A_COMPARER format LEGEND à d = 0,9 est INVÉRIFIABLE', C.classerFinal({ classe: 'A_COMPARER', comparaison: cmp, distance: 0.9, nom: 'Ho-Oh LEGEND [Top]' }), 'INVERIFIABLE');
verifier('classerFinal : la classe principale EMPRUNTÉ ne bouge pas', C.classerFinal({ classe: 'EMPRUNTE', comparaison: cmp, distance: 0.9, nom: 'Pikachu' }), 'EMPRUNTE');
let leve = false; try { C.classerComparaison({ comparaison: cmp, distance: 0.5, nom: 'x', seuils: { conforme: 0.7, incertain: 0.6 } }); } catch (e) { leve = /seuils/.test(e.message); }
verifier('des seuils incohérents LÈVENT', leve, true);

// ── FINITION OU TAMPON : ce que l'empreinte du centre de l'illustration ne voit pas, lu dans ce qu'on a déjà
const tamponProbable = (nom, slug) => /\b(staff|league|pre-?release|worlds?)\b/i.test(`${nom} ${String(slug || '').replace(/-/g, ' ')}`);
const F = (o = {}) => C.finitionOuTampon({ nom: 'Pikachu', slug: 'Pikachu-V1-XYZ', variante: null, tamponNonRepresente: null, partageeHoloNonHolo: null, setTamponnee: null, tamponProbable, ...o });
verifier('un produit ordinaire : aucune réserve', F(), { concerne: false, raisons: [] });
verifier('finition dans le nom (hors crochets) : « Reverse »', F({ nom: 'Pikachu Reverse Holo' }), { concerne: true, raisons: ['nom-finition'] });
verifier('« Non-Holo » dans le nom', F({ nom: 'Charizard Non-Holo' }).raisons, ['nom-finition']);
verifier('« Cosmos », « Pattern », « Version » dans le nom', [F({ nom: 'Mew Cosmos' }).concerne, F({ nom: 'Spinda Pattern A' }).concerne, F({ nom: 'Porygon Version 2' }).concerne], [true, true, true]);
verifier('un mot de finition DANS LES CROCHETS est une attaque (« Hyper Reverse », « Intimidating Pattern »), pas une finition', [F({ nom: 'Butterfree [Magic Dust | Hyper Reverse]' }).concerne, F({ nom: 'Masquerain [Intimidating Pattern | Stun Spore]' }).concerne], [false, false]);
verifier('tampon lu dans le slug (League, Staff)', F({ slug: 'Ultra-Ball-League-Staff-V1' }).raisons, ['nom-tampon']);
verifier('tampon lu dans le nom hors crochets', F({ nom: 'Pikachu Worlds 2019' }).raisons, ['nom-tampon']);
verifier('un mot de tampon DANS LES CROCHETS n\'en est pas un (attaque « Stamp »)', F({ nom: 'Pikachu [League Stamp | Thunder]' }).concerne, false);
verifier('set tamponné (réimpressions : wcd, pps, ba…)', F({ setTamponnee: 'pps' }).raisons, ['set-tamponnee']);
verifier('variante d\'une marque (staff+prerelease, jumbo)', F({ variante: 'staff+prerelease' }).raisons, ['variante']);
verifier('la variante « normale » n\'est pas une réserve', F({ variante: 'normale' }).concerne, false);
verifier('tampon non représenté sur l\'image servie', F({ tamponNonRepresente: 'Toys R Us' }).raisons, ['tampon-non-represente']);
verifier('image partagée holo / non-holo', F({ partageeHoloNonHolo: true }).raisons, ['holo-partage']);
verifier('partageeHoloNonHolo false : pas une réserve', F({ partageeHoloNonHolo: false }).concerne, false);
verifier('les raisons se cumulent dans l\'ordre fixe', F({ nom: 'Slowpoke Reverse', setTamponnee: 'pps', variante: 'jumbo', tamponNonRepresente: 'x', partageeHoloNonHolo: true }).raisons,
    ['nom-finition', 'set-tamponnee', 'variante', 'tampon-non-represente', 'holo-partage']);
verifier('le motif écrit sur le produit', C.MOTIF_FINITION_OU_TAMPON, 'finition-ou-tampon-non-verifie');

// ── `sans-numero` RESSERRÉE : la fiche n'a pas de numéro ALORS QUE le numéro du produit est connu
const L1 = [{ carteId: 1, preuve: 'set+numero' }], fiche = (numero) => ({ carteId: 1, numero });
verifier('fiche sans numéro, produit au numéro connu : douteuse `sans-numero`', C.classerFiche({ lignes: L1, ficheSite: fiche(null), setANumeros: true, numeroConnu: true }), { classe: 'FICHE_DOUTEUSE', motifs: ['sans-numero'], infos: ['sans-numero-set-numerote'] });
verifier('fiche sans numéro, produit SANS numéro connu : plus douteuse (la fiche « n° ? » que le site veut) ; l\'ancienne définition reste en information', C.classerFiche({ lignes: L1, ficheSite: fiche(null), setANumeros: true, numeroConnu: false }), { classe: 'FICHE_OK', motifs: [], infos: ['sans-numero-set-numerote'] });
// M1 (décision du coordinateur, relecture indépendante) : la CONJONCTION « le set a au moins une fiche numérotée » ET « le numéro du produit est connu »
verifier('fiche sans numéro, produit au numéro connu, mais set SANS aucune fiche numérotée (Gem Packs, Half Decks) : PAS douteuse', C.classerFiche({ lignes: L1, ficheSite: fiche(null), setANumeros: false, numeroConnu: true }), { classe: 'FICHE_OK', motifs: [], infos: [] });
verifier('fiche numérotée : ni motif ni information', C.classerFiche({ lignes: L1, ficheSite: fiche('12'), setANumeros: true, numeroConnu: true }), { classe: 'FICHE_OK', motifs: [], infos: [] });
verifier('numeroConnu absent : traité comme inconnu (jamais un oui par défaut)', C.classerFiche({ lignes: L1, ficheSite: fiche(null), setANumeros: true }).classe, 'FICHE_OK');
verifier('l\'information ne s\'ajoute pas aux motifs (les classes et les compteurs ne bougent pas)', C.classerFiche({ lignes: [{ carteId: 1, preuve: 'set+nom' }], ficheSite: fiche(null), setANumeros: true, numeroConnu: false }), { classe: 'FICHE_DOUTEUSE', motifs: ['preuve-nom-seul'], infos: ['sans-numero-set-numerote'] });

// ── LE SOUS-MOTIF emprunt-refuse-par-api : un visuel emprunté que l'API refuse reste MANQUANT
verifier('MANQUANT par repli : le motif ET le sous-motif', C.classerVisuel({ servi: null, motifManquant: 'repli-refuse:wcd', refuse: { famille: 'wcd', nature: 'substitut' } }), { classe: 'MANQUANT', motifs: ['repli-refuse:wcd', 'emprunt-refuse-par-api'], refuse: { famille: 'wcd', nature: 'substitut' } });
verifier('MANQUANT sans repli : pas de sous-motif', C.classerVisuel({ servi: null, motifManquant: 'aucun-visuel' }), { classe: 'MANQUANT', motifs: ['aucun-visuel'] });
verifier('les 4 familles nommées', C.FAMILLES_EMPRUNT_REFUSE, ['wcd', 'prize-packs', 'tamponnees-nommees', '30th-celebration']);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
