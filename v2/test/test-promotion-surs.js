'use strict';
// DECISION-SURS (01/11/2026) — la PROMOTION d'un probable en SÛR : S2 ∪ S3 ∪ I(0,2), derrière V2_PROMOTION_SURS (éteint par défaut), la règle pure (identifier/promotion-surs.js), son raccordement dans l'étape
// des leviers (leviers-abde.js::appliquerLeviers), la décision de la route (identifier/promotion-surs-route.js), la configuration et le jeton /ping. Aucune base, aucun réseau, aucun appel payant.
// Chaque condition a son cas ROUGE (le banc de mutation, test-promotion-surs-mutation.js, casse chaque garde et exige qu'un cas ici échoue).
//   S2 : le critère A de la production sur le désigné et SES VRAIS jumeaux (toute sa métacarte) ; l'attaque lue ne bloque plus ; le numéro d'un jumeau peut être inconnu tant qu'aucun ne concorde.
//   S3 : le désigné SANS jumeau : numéro exact, code exact, aucun autre champ lu ne contredit (l'attaque exceptée), nom.
//   I  : le désigné est le voisin n°1 de l'index entier, écart de cosinus au second >= 0,2 (la marge de SUR-PAR-IMAGE), aucun champ lu ne le contredit, tous ses jumeaux (lignes connues) sont au pool.
//   Les trois exigent I2 (prix de guide) et I3 (pas de même dessin) ; la promotion ne s'applique JAMAIS qu'à un PROBABLE.
const H = require('./_harnais');
const { lireConfig } = require('../config');
const { encoderVecteur } = require('../identifier/empreinte-vecteur');
const { questionParLaRoute, affirmerParLaRoute } = require('../identifier/adaptateur');
const GM = require('../identifier/garde-marqueurs');
const CA = require('../identifier/critere-a');
const L = require('../identifier/leviers-abde');
const PS = require('../identifier/promotion-surs');
const PSR = require('../identifier/promotion-surs-route');
const { MARGE } = require('../identifier/sur-par-image');
const { capacitesServies } = require('../capacites');

// ── le monde pur : un désigné (1), des jumeaux, une lecture « 86 / 115, UF »
const ligne = (id, o = {}) => ({ idProduct: id, nomCardmarket: o.nom ?? 'Mary\'s Request', nomFr: null, set: { slug: 'ufo', nom: 'Unseen Forces', code: o.code === undefined ? 'UF' : o.code }, numero: o.numero === undefined ? '86' : o.numero, total: o.total === undefined ? '115' : o.total,
    langue: 'FR', variante: null, rarete: 'Rare', setTcgdex: null, tirageSource: 'intl', prixGuide: o.sansPrix ? null : { trend: 5, low: 4, avg30: 4.5, guideDu: new Date('2026-10-04') }, visuel: { url: `https://pub.example/${id}.webp`, w: 255, h: 356 } });
const lecture = (o = {}) => {
    const v = k => (o[k] === undefined ? { numero: '86', total: '115', setCode: 'UF', attaque: null, attaqueConfiance: null, nom: 'Mary\'s Request' }[k] : o[k]);
    return { success: true, carte: { idProduct: 1, ambigu: true, nom: v('nom'), nomBrut: v('nom'), nomConfiance: 'haute', numero: v('numero'), total: v('total'), setCode: v('setCode'), langue: 'FR' },
        lectureGarde: { numero: v('numero'), total: v('total'), setCode: v('setCode'), symboleSet: null, attaque: v('attaque'), attaqueConfiance: v('attaqueConfiance'), vivierIds: o.vivierIds || [] },
        candidats: [{ idProduct: 1 }], classement: [] };
};
const ATT = { attaque: 'Headbutt', attaqueConfiance: 'haute' };                       // l'attaque lue ; la ligne du désigné porte d'AUTRES attaques => 'ko'
const NOM_ATT = 'Mary\'s Request [Gather Snow | Gnaw]';
const POOL_PLAT = [{ id: 1, cos: 0.60 }, { id: 2, cos: 0.55 }];                       // écart de cosinus 0,05 : l'image seule ne tranche pas
const POOL_NET = [{ id: 1, cos: 0.70 }, { id: 2, cos: 0.45 }];                        // écart 0,25
const lignes = (...ls) => new Map(ls.map(l => [l.idProduct, l]));
const promo = (o = {}) => PS.promouvoirEnSur({ corps: lecture(), id: 1, produits: lignes(ligne(1)), jumeaux: [], pool: POOL_PLAT, second: 2, cleDe: id => `k${id}`, top1Cle: 'k2', i2i3: true, ...o });
const regle = o => { const r = promo(o); return r.promu ? r.regle : null; };

(async () => {
    // ═════ S3 : le désigné sans jumeau
    H.v('S3 : numéro et code exacts, aucun jumeau => promu', regle(), 'S3');
    H.v('S3 : l\'attaque lue CONTREDIT le désigné (« Headbutt » contre « Gather Snow | Gnaw ») : elle ne bloque plus', regle({ corps: lecture(ATT), produits: lignes(ligne(1, { nom: NOM_ATT })) }), 'S3');
    H.v('   contraste : le critère A de la production (strict) refuse ce même cas à cause de l\'attaque', CA.conditions({ corps: lecture(ATT), gagnant: 1, autres: [], produits: lignes(ligne(1, { nom: NOM_ATT })) }).ok, false);
    H.v('S3 : le code n\'est pas lu => refusé (un code non lu ne concorde pas)', regle({ corps: lecture({ setCode: null }) }), null);
    H.v('S3 : le code lu est celui d\'un AUTRE set => refusé', regle({ corps: lecture({ setCode: 'XY' }) }), null);
    H.v('S3 : le numéro n\'est pas lu => refusé', regle({ corps: lecture({ numero: null }) }), null);
    H.v('S3 : le numéro lu est autre => refusé', regle({ corps: lecture({ numero: '12' }) }), null);
    H.v('S3 : le total lu contredit (ko) => refusé', regle({ corps: lecture({ total: '99' }) }), null);
    H.v('S3 : le nom lu (confiance haute) contredit le désigné => refusé', regle({ corps: lecture({ nom: 'Pikachu' }) }), null);
    H.v('S3 : les jumeaux INCONNUS (la colonne ne conclut pas : null) ne valent pas « aucun jumeau » => refusé', regle({ jumeaux: null }), null);
    H.v('S3 : I2 (pas de prix de guide) => refusé', regle({ i2i3: false }), null);
    H.v('S3 : la ligne du désigné est absente => refusé, sans lever', regle({ produits: new Map() }), null);

    // ═════ S2 : le désigné et ses vrais jumeaux
    const tw = (n, o = {}) => ligne(n, { numero: '12', total: '99', ...o });
    H.v('S2 : un jumeau au numéro CONTREDIT (12 contre 86) => promu', regle({ jumeaux: [2], produits: lignes(ligne(1), tw(2)) }), 'S2');
    H.v('S2 : un jumeau au numéro INCONNU => promu (nouveauté de S2)', regle({ jumeaux: [2], produits: lignes(ligne(1), tw(2, { numero: null })) }), 'S2');
    H.v('   contraste : le critère A de la production (strict) refuse le numéro inconnu d\'un jumeau', CA.conditions({ corps: lecture(), gagnant: 1, autres: [2], produits: lignes(ligne(1), tw(2, { numero: null })) }).ok, false);
    H.v('S2 : un jumeau qui CONCORDE avec le numéro lu (86) => refusé', regle({ jumeaux: [2], produits: lignes(ligne(1), tw(2, { numero: '86' })) }), null);
    H.v('S2 : l\'un des deux jumeaux concorde => refusé', regle({ jumeaux: [2, 3], produits: lignes(ligne(1), tw(2), tw(3, { numero: '86' })) }), null);
    H.v('S2 : la ligne d\'un jumeau manque => refusé (« une ligne de jumeau manque »)', regle({ jumeaux: [2, 3], produits: lignes(ligne(1), tw(2)) }), null);
    H.v('S2 : l\'attaque lue contredit le désigné, un jumeau inconnu => promu (les deux nouveautés ensemble)', regle({ corps: lecture(ATT), jumeaux: [2], produits: lignes(ligne(1, { nom: NOM_ATT }), tw(2, { numero: null })) }), 'S2');
    H.v('S2 : le code du désigné est autre => refusé', regle({ corps: lecture({ setCode: 'XY' }), jumeaux: [2], produits: lignes(ligne(1), tw(2)) }), null);
    H.v('S2 : le numéro du désigné ne concorde pas => refusé', regle({ corps: lecture({ numero: '12' }), jumeaux: [2], produits: lignes(ligne(1), tw(2, { numero: '86' })) }), null);
    H.v('S2 : I3 / I2 non tenus => refusé', regle({ i2i3: false, jumeaux: [2], produits: lignes(ligne(1), tw(2)) }), null);
    H.v('S2 : 101 jumeaux (au-delà du plafond de lecture) => refusé, jamais une lecture sans fin', regle({ jumeaux: Array.from({ length: PS.MAX_JUMEAUX + 1 }, (_, i) => 100 + i), produits: lignes(ligne(1), ...Array.from({ length: PS.MAX_JUMEAUX + 1 }, (_, i) => tw(100 + i))) }), null);
    H.v('   et le plafond lui-même (MAX_JUMEAUX) passe', regle({ jumeaux: Array.from({ length: PS.MAX_JUMEAUX }, (_, i) => 100 + i), produits: lignes(ligne(1), ...Array.from({ length: PS.MAX_JUMEAUX }, (_, i) => tw(100 + i))) }), 'S2');
    // les deux paramètres de critere-a.conditions : leur défaut est le critère d'avant
    H.v('critere-a.conditions : par défaut, l\'attaque bloque et le numéro d\'un jumeau inconnu bloque (le critère d\'avant, inchangé)', [
        CA.conditions({ corps: lecture(ATT), gagnant: 1, autres: [], produits: lignes(ligne(1, { nom: NOM_ATT })) }).ok,
        CA.conditions({ corps: lecture(), gagnant: 1, autres: [2], produits: lignes(ligne(1), tw(2, { numero: null })) }).ok], [false, false]);
    H.v('   champsIgnores: [\'attaque\'] seul l\'attaque se laisse ignorer ; jumeauxInconnusPermis: true seul permet l\'inconnu', [
        CA.conditions({ corps: lecture(ATT), gagnant: 1, autres: [], produits: lignes(ligne(1, { nom: NOM_ATT })), champsIgnores: ['attaque'] }).ok,
        CA.conditions({ corps: lecture(), gagnant: 1, autres: [2], produits: lignes(ligne(1), tw(2, { numero: null })), jumeauxInconnusPermis: true }).ok,
        CA.conditions({ corps: lecture(), gagnant: 1, autres: [2], produits: lignes(ligne(1), tw(2, { numero: null })), jumeauxInconnusPermis: 'oui' }).ok], [true, true, false]);
    H.v('   un champ qui n\'est PAS l\'attaque ne s\'ignore jamais (le total contredit => refusé même s\'il est « ignoré »)', CA.conditions({ corps: lecture({ total: '99' }), gagnant: 1, autres: [], produits: lignes(ligne(1)), champsIgnores: ['total'] }).ok, false);
    H.v('   la LANGUE lue (JP contre un tirage intl : ko, mais la garde se tait) ne s\'ignore pas non plus : seul l\'attaque est permise', (() => { const c = lecture(); c.carte.langue = 'JP'; return [CA.conditions({ corps: c, gagnant: 1, autres: [], produits: lignes(ligne(1)) }).ok, CA.conditions({ corps: c, gagnant: 1, autres: [], produits: lignes(ligne(1)), champsIgnores: ['langue'] }).ok]; })(), [false, false]);
    H.v('   le plafond de jumeaux est 100 (le plus grand groupe mesuré : 98)', PS.MAX_JUMEAUX, 100);
    H.v('   un numéro de jumeau qui CONCORDE bloque toujours, même avec jumeauxInconnusPermis', CA.conditions({ corps: lecture(), gagnant: 1, autres: [2], produits: lignes(ligne(1), tw(2, { numero: '86' })), jumeauxInconnusPermis: true }).ok, false);

    // ═════ I : le voisin n°1 de l'image, écart de cosinus >= 0,2, tous les jumeaux au pool
    const sansLecture = lecture({ numero: null, setCode: null, total: null });           // rien de lu : S ne peut rien, seule l'image parle
    const imageSeule = (o = {}) => regle({ corps: sansLecture, pool: POOL_NET, top1Cle: 'k1', ...o });
    H.v('I : voisin n°1, écart de cosinus 0,25 >= 0,2, aucun jumeau, rien ne contredit => promu', imageSeule(), 'I');
    H.v('I : la marge est celle de SUR-PAR-IMAGE (0,2)', MARGE, 0.2);
    H.v('I : écart de cosinus 0,19 < 0,2 => refusé ; 0,2 pile => promu (l\'arrondi flottant ne coupe pas)', [imageSeule({ pool: [{ id: 1, cos: 0.64 }, { id: 2, cos: 0.45 }] }), imageSeule({ pool: [{ id: 1, cos: 0.65 }, { id: 2, cos: 0.45 }] }), imageSeule({ pool: [{ id: 1, cos: 0.7 }, { id: 2, cos: 0.5 }] })], [null, 'I', 'I']);
    H.v('I : le désigné n\'est pas le voisin n°1 de l\'index entier => refusé', imageSeule({ top1Cle: 'k9' }), null);
    H.v('I : le désigné n\'a pas de visuel (clé absente) => refusé', imageSeule({ cleDe: () => null, top1Cle: null }), null);
    H.v('I : le cosinus du désigné ou du second est inconnu => refusé', [imageSeule({ pool: [{ id: 1, cos: null }, { id: 2, cos: 0.1 }] }), imageSeule({ pool: [{ id: 1, cos: 0.7 }, { id: 2, cos: null }] })], [null, null]);
    H.v('I : un jumeau est au pool et sa ligne est connue => promu', imageSeule({ jumeaux: [3], produits: lignes(ligne(1), tw(3)), pool: [...POOL_NET, { id: 3, cos: 0.4 }] }), 'I');
    H.v('I : un jumeau n\'est PAS au pool => refusé', imageSeule({ jumeaux: [3], produits: lignes(ligne(1), tw(3)) }), null);
    H.v('I : la ligne d\'un jumeau manque => refusé', imageSeule({ jumeaux: [3], produits: lignes(ligne(1)), pool: [...POOL_NET, { id: 3, cos: 0.4 }] }), null);
    H.v('I : les jumeaux ne sont pas connus (null) => refusé', imageSeule({ jumeaux: null }), null);
    H.v('I : un champ lu contredit le désigné (le total) => refusé', imageSeule({ corps: lecture({ numero: null, setCode: null, total: '99' }) }), null);
    H.v('I : l\'attaque lue contredit le désigné => refusé (contrairement à S, I ne laisse passer AUCUN champ contredit)', imageSeule({ corps: lecture({ numero: null, setCode: null, total: null, ...ATT }), produits: lignes(ligne(1, { nom: NOM_ATT })) }), null);
    H.v('I : le nom lu contredit le désigné => refusé', imageSeule({ corps: lecture({ numero: null, setCode: null, total: null, nom: 'Pikachu' }) }), null);
    H.v('I : I2 / I3 non tenus => refusé', imageSeule({ i2i3: false }), null);
    H.v('I : le code lu est autre (ko) => refusé même avec un grand écart', imageSeule({ corps: lecture({ numero: null, total: null, setCode: 'XY' }) }), null);
    H.v('la règle S passe avant I, et I rattrape ce que S refuse : S2 prime sur I quand les deux tiennent', regle({ jumeaux: [2], produits: lignes(ligne(1), tw(2)), pool: [...POOL_NET, { id: 2, cos: 0.2 }].slice(0, 2), top1Cle: 'k1' }), 'S2');
    H.v('une entrée illisible ne lève jamais et ne promeut jamais', [PS.promouvoirEnSur(), PS.promouvoirEnSur({}), PS.promouvoirEnSur({ corps: null, id: 'x', produits: [], jumeaux: 7, pool: 'a' })].map(r => r.promu), [false, false, false]);
    H.v('la sortie dit pourquoi : la raison du refus nomme S et I', (() => { const r = promo({ corps: lecture({ setCode: 'XY' }) }); return [r.promu, typeof r.raison, /S/.test(r.raison), /I/.test(r.raison)]; })(), [false, 'string', true, true]);
    H.v('une promotion porte son critère journalisé (nomme la règle) et ne commence pas par les préfixes que la garde des marqueurs interprète', (() => { const r = promo(); return [typeof r.critere, /S3/.test(r.critere), /^tampon \(/.test(r.critere), r.critere.startsWith('jumbo')]; })(), ['string', true, false, false]);

    // ═════ l'ÉTAPE de la route (appliquerLeviers) sur un monde fabriqué : index d'empreintes factice, archive factice avec jumeaux, catalogue factice
    const MODELE = { id: 'p8000-banc', sha256: 'b'.repeat(64) };
    const ab = (o, k = 'promotion') => (o && k in o ? 'présent' : 'absent');       // distingue ABSENT de nul (H.v compare en JSON : undefined et null s'y confondent)
    const cfgBase = { ...lireConfig({}), probable: true, leviersAbde: true, gardeMarqueurs: true, leviersEcart: 0.1, empreinteExtension: true, modeleEmpreinte: MODELE };
    const VEC = Float32Array.from({ length: 256 }, () => 1 / 16);
    function monde({ cos, lignes: lg, vivier = [], base = [], jum = {}, sansColonne = false, promotion = true, groupes = [], lecture: lec = {}, ext = '2.0.1', unCandidat = false, jumeauxEnQuestion = false, garde = true } = {}) {
        const ids = Object.keys(cos).map(Number);
        const cleDe = id => `k${(groupes.find(g => g.includes(id)) || [id])[0]}`;
        const entrees = new Map(ids.map(id => [id, { idProduct: id, grande: { cle: cleDe(id) }, vignette: { cle: cleDe(id) + 'v' }, idMetacard: groupes.some(g => g.includes(id)) ? 77 : id, numero: '86', setNom: 'Unseen Forces', mention: null }]));
        const version = { entree: id => entrees.get(id) || null, identifiants: () => [...entrees.keys()], ...(sansColonne ? {} : { colonneJumeaux: true, jumeauxDe: id => (jum[id] === undefined ? [] : jum[id]) }) };
        const parCle = {}; for (const id of ids) parCle[cleDe(id)] = Math.max(parCle[cleDe(id)] ?? -1, cos[id]);
        const index = { voisins: (q, n) => { const top = Object.entries(parCle).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => [k, c]); return { top, meilleur: top[0][1] }; }, similarites: (q, cles) => cles.map(k => parCle[k] ?? 0) };
        const etat = { courante: () => ({ index, meta: { modele: MODELE } }) };
        const produits = new Map(Object.entries(lg).map(([id, l]) => [Number(id), l]));
        const cfg = { ...cfgBase, ...(promotion ? { promotionSurs: true } : {}), ...(unCandidat ? { leviersUnCandidat: true } : {}), gardeMarqueurs: garde };
        const corps = { ...lecture(lec), carte: { ...lecture(lec).carte, idProduct: base[0] }, lectureGarde: { ...lecture(lec).lectureGarde, vivierIds: vivier }, candidats: base.map(idProduct => ({ idProduct })), etat: { estimeIA: 'EX', confianceIA: 'haute', defautsVus: [], declareVendeur: null, retenu: 'GD' }, reverse: { attendue: false, strategie: null }, codeLangue: 2 };
        const ctxQuestion = { langueInterface: 'fr', cfg, ficheServie: false, jumeaux: () => ({ conclu: true, ids: [] }) };
        const resultat = { ...questionParLaRoute(corps, base, { ...ctxQuestion, produits }), ...(jumeauxEnQuestion ? { jumeauxEnQuestion: true } : {}) };
        const entree = { versionExtension: ext, empreintes: { modele: MODELE, rejet: null, entrees: [{ photo: 0, vecteur: encoderVecteur(VEC), redressee: true, carte: null }] } };
        const lues = [];
        const catalogue = { lire: async idsL => { lues.push([...idsL]); return new Map(idsL.filter(i => lg[i]).map(i => [i, lg[i]])); }, indexAliasFrSansAttente: () => new Map() };
        return { cfg, corps, ctxQuestion, resultat, entree, version, etat, produits, catalogue, lues };
    }
    const lancer = async (m, plus = {}) => { const diag = {}; const r = await L.appliquerLeviers({ cfg: m.cfg, entree: m.entree, resultat: m.resultat, corpsChaine: m.corps, produits: m.produits, version: m.version, traceMarqueurs: null, catalogue: m.catalogue, ctxQuestion: m.ctxQuestion, etat: m.etat, diag, ...plus }); return { r, diag }; };
    // 1 = la vraie carte (n°86, UF), 2 et 3 = les candidats de la chaîne (autres numéros), 4 = un autre rival
    const LG = { 1: ligne(1), 2: ligne(2, { numero: '12', total: '99' }), 3: ligne(3, { numero: '14', total: '99' }), 4: ligne(4, { numero: '15', total: '99' }) };
    const COS = { 1: 0.40, 2: 0.60, 3: 0.35, 4: 0.30 };                                  // c3(1) = 0,50, c3(2) = 0,10 : écart 0,4 => probable
    const mondeS3 = (o = {}) => monde({ cos: COS, lignes: LG, base: [2, 3], vivier: [1], ...o });

    const eteint = await lancer(mondeS3({ promotion: false }));
    H.v('drapeau ÉTEINT : le probable est désigné comme avant, AUCUNE promotion (ni champ, ni ligne lue en plus)', [eteint.r.probable && eteint.r.probable.idProduct, ab(eteint.r), ab(eteint.r, 'lignes')], [1, 'absent', 'absent']);
    const allume = await lancer(mondeS3());
    H.v('drapeau ALLUMÉ : le même probable (1) est promu par S3 (aucun jumeau connu)', [allume.r.probable && allume.r.probable.idProduct, allume.r.promotion && allume.r.promotion.regle], [1, 'S3']);
    H.v('   la promotion porte les lignes à passer à l\'affirmation (le désigné y est) et son critère', [allume.r.promotion.lignes instanceof Map, allume.r.promotion.lignes.has(1), typeof allume.r.promotion.critere], [true, true, 'string']);
    H.v('   le probable, le classement et la question refaite sont ceux du drapeau éteint (la promotion s\'ajoute, ne remplace rien)', [allume.r.probable, allume.r.resultat && allume.r.resultat.analyse.cartes[0].candidats.map(c => c.idProduct).sort()], [eteint.r.probable, eteint.r.resultat && eteint.r.resultat.analyse.cartes[0].candidats.map(c => c.idProduct).sort()]);
    const att = await lancer(mondeS3({ lignes: { ...LG, 1: ligne(1, { nom: NOM_ATT }) }, lecture: ATT }));
    H.v('une attaque lue qui contredit le désigné : il reste probable et S3 le promeut', [att.r.probable && att.r.probable.idProduct, att.r.promotion && att.r.promotion.regle], [1, 'S3']);
    // seulement des PROBABLES : une question dont l'écart c3 est trop petit n'est pas un probable, donc jamais promue, même si la tête passe S3
    const serree = await lancer(monde({ cos: { 1: 0.50, 5: 0.55, 2: 0.30, 3: 0.20 }, lignes: { ...LG, 5: ligne(5) }, base: [2, 3], vivier: [1, 5] }));
    H.v('seulement des PROBABLES : écart c3 < 0,1 (question) => ni probable ni promotion, même si la tête passerait S3', [serree.r && serree.r.probable, ab(serree.r)], [null, 'absent']);
    H.v('   (témoin : la tête de ce classement passe bien la règle pure)', (() => { const m = monde({ cos: { 1: 0.50, 5: 0.55, 2: 0.30, 3: 0.20 }, lignes: { ...LG, 5: ligne(5) }, base: [2, 3], vivier: [1, 5] }); return PS.promouvoirEnSur({ corps: m.corps, id: 5, produits: m.produits, jumeaux: [], pool: [], second: 1, cleDe: () => null, top1Cle: null, i2i3: true }).regle; })(), 'S3');
    // les jumeaux RÉELS : lus dans l'archive, leurs lignes chargées au catalogue (une lecture)
    const mj = mondeS3({ jum: { 1: [7] } });
    mj.catalogue.lire = async idsL => { mj.lues.push([...idsL]); return new Map(idsL.map(i => [i, i === 7 ? ligne(7, { numero: null }) : LG[i]]).filter(([i, l]) => l)); };
    mj.version.identifiants = () => [...Object.keys(COS).map(Number), 7];
    const rj = await lancer(mj);
    H.v('un jumeau réel au numéro inconnu, sa ligne lue au catalogue (une lecture, celle qui manque) : S2', [rj.r.promotion && rj.r.promotion.regle, mj.lues.some(l => l.includes(7)), rj.r.promotion && rj.r.promotion.lignes.has(7)], ['S2', true, true]);
    const mj2 = mondeS3({ jum: { 1: [7] } }); mj2.catalogue.lire = async () => { throw new Error('base en panne'); };
    const av = L.echecs();
    const rj2 = await lancer(mj2);
    H.v('la lecture des jumeaux échoue : le probable reste, AUCUNE promotion, l\'échec est compté', [rj2.r.probable && rj2.r.probable.idProduct, ab(rj2.r), (L.echecs()['jumeaux-en-panne'] || 0) - (av['jumeaux-en-panne'] || 0)], [1, 'absent', 1]);
    const mj3 = mondeS3({ jum: { 1: Array.from({ length: PS.MAX_JUMEAUX + 1 }, (_, i) => 500 + i) } });
    const rj3 = await lancer(mj3);
    H.v('plus de MAX_JUMEAUX jumeaux : le probable reste, aucune promotion, AUCUNE ligne de jumeau n\'est lue', [rj3.r.probable && rj3.r.probable.idProduct, ab(rj3.r), mj3.lues.some(l => l.some(i => i >= 500))], [1, 'absent', false]);
    const msc = mondeS3({ sansColonne: true });
    const rsc = await lancer(msc);
    H.v('l\'archive ne sait pas dire les jumeaux (pas de colonne) : le probable reste, aucune promotion', [rsc.r.probable && rsc.r.probable.idProduct, ab(rsc.r)], [1, 'absent']);
    const mjx = mondeS3({ jum: { 1: [2] } });
    const rjx = await lancer(mjx);
    H.v('un jumeau (2) au numéro CONTREDIT, sa ligne déjà lue : S2 sans lecture de plus', [rjx.r.promotion && rjx.r.promotion.regle, mjx.lues.length], ['S2', 0]);
    // I dans l'étape : rien de lu (S ne peut rien), le visuel du désigné est le voisin n°1 à 0,25 du second
    const mi = monde({ cos: { 1: 0.70, 2: 0.45, 3: 0.40, 4: 0.30 }, lignes: LG, base: [2, 3], vivier: [1], lecture: { numero: null, setCode: null, total: null } });
    const ri = await lancer(mi);
    H.v('I dans l\'étape : voisin n°1 de l\'index, écart de cosinus 0,25 => promu par I', [ri.r.probable && ri.r.probable.idProduct, ri.r.promotion && ri.r.promotion.regle], [1, 'I']);
    const mi2 = monde({ cos: { 1: 0.70, 2: 0.60, 3: 0.40, 4: 0.30 }, lignes: LG, base: [2, 3], vivier: [1], lecture: { numero: null, setCode: null, total: null } });
    const ri2 = await lancer(mi2);
    H.v('I dans l\'étape : écart de cosinus 0,10 < 0,2 => probable (écart c3 >= 0,1) mais pas promu', [ri2.r.probable && ri2.r.probable.idProduct, ab(ri2.r)], [1, 'absent']);
    const mi3 = monde({ cos: { 1: 0.70, 2: 0.45, 3: 0.40, 4: 0.30, 9: 0.72 }, lignes: { ...LG, 9: ligne(9, { numero: '15', total: '99' }) }, base: [2, 3], vivier: [1], lecture: { numero: null, setCode: null, total: null } });
    const ri3 = await lancer(mi3);
    H.v('I dans l\'étape : le voisin n°1 de l\'index (9, hors pool classé en tête) n\'est pas le désigné => pas promu', [ab(ri3.r)], ['absent']);

    // C1 (relecture) : la promotion ne touche QUE les probables d'une question de la chaîne à AU MOINS DEUX candidats ; ni une question à UN candidat (V2_LEVIERS_UN_CANDIDAT), ni une question née du levier e (jumeauxEnQuestion)
    {
        const un = await lancer(monde({ cos: { 1: 0.4, 2: 0.6 }, lignes: LG, base: [2], vivier: [], unCandidat: true }));
        H.v('C1 : question à UN candidat (V2_LEVIERS_UN_CANDIDAT) : le probable est servi comme avant, JAMAIS promu en sûr', [un.r && un.r.probable && un.r.probable.idProduct, ab(un.r)], [1, 'absent']);
        const e = await lancer(monde({ cos: COS, lignes: LG, base: [2, 3], vivier: [1], jumeauxEnQuestion: true }));
        H.v('C1 : question née du levier e (jumeauxEnQuestion) : le probable reste, JAMAIS promu en sûr', [e.r && e.r.probable && e.r.probable.idProduct, ab(e.r)], [1, 'absent']);
        const deux = await lancer(monde({ cos: COS, lignes: LG, base: [2, 3], vivier: [1] }));
        H.v('   témoin : à deux candidats, sans e, le même monde est promu', ab(deux.r), 'présent');
        // M3 : sans la garde des marqueurs un rival de groupe passerait : aucune promotion
        const sg = await lancer(monde({ cos: COS, lignes: LG, base: [2, 3], vivier: [1], garde: false }));
        H.v('M3 : V2_GARDE_MARQUEURS éteint : le probable reste, aucune promotion (un rival de groupe ne serait pas vu)', [sg.r && sg.r.probable && sg.r.probable.idProduct, ab(sg.r)], [1, 'absent']);
    }
    // I4 (relecture) : la preuve EXÉCUTÉE que le drapeau éteint rend la réponse d'avant. La vraie fonction de route (etapeLeviers : l'étape + la décision de promotion + la garde des marqueurs) sur un jeu fabriqué, comparée
    // EN PROFONDEUR à ce que rendait la route d'avant (l'étape seule : `resultat = lv.resultat || resultat`, `probableDecide = lv.probable`), puis drapeau allumé.
    {
        const ouvrir = async (m, cfg, appliquer) => {
            let derniere = null;
            return PSR.etapeLeviers({ cfg, entree: m.entree, resultat: m.resultat, c: m.corps, produits: m.produits, version: m.version, traceMarqueurs: null, catalogue: m.catalogue, ctxQuestion: m.ctxQuestion, etat: m.etat, ...(appliquerSeule(appliquer)), noter: r => { if (r && r.issue === 'question') derniere = r; },
                affirmer: (id, surcharge, critere) => affirmerParLaRoute(m.corps, id, { produits: surcharge || m.produits, langueInterface: 'fr', cfg, ficheServie: false }, critere),
                marqueurs: (aff, lp) => GM.appliquerMarqueurs({ cfg, titre: null, resultat: aff, derniereQuestion: derniere, c: m.corps, desaccordG: null, empreinteInfo: null, produits: lp, version: m.version, langueInterface: 'fr', jumeaux: m.ctxQuestion.jumeaux, journal: () => { } }) });
        };
        const appliquerSeule = a => (a ? { appliquer: a } : {});
        // la route d'AVANT : l'étape seule, sans le module de promotion
        const avant = async (m, cfg) => { const lv = await L.appliquerLeviers({ cfg, entree: m.entree, resultat: m.resultat, corpsChaine: m.corps, produits: m.produits, version: m.version, traceMarqueurs: null, catalogue: m.catalogue, ctxQuestion: m.ctxQuestion, etat: m.etat, memo: undefined });
            return { resultat: lv && lv.resultat ? lv.resultat : m.resultat, probableDecide: lv ? lv.probable : null, traceMarqueurs: null, tracePromotion: null }; };
        const mondes = {
            'probable S3': () => mondeS3(), 'probable S2': () => mondeS3({ jum: { 1: [2] } }), 'question sans probable': () => monde({ cos: { 1: 0.50, 5: 0.55, 2: 0.30, 3: 0.20 }, lignes: { ...LG, 5: ligne(5) }, base: [2, 3], vivier: [1, 5] }),
            'un candidat': () => monde({ cos: { 1: 0.4, 2: 0.6 }, lignes: LG, base: [2], vivier: [], unCandidat: true }), 'levier e': () => monde({ cos: COS, lignes: LG, base: [2, 3], vivier: [1], jumeauxEnQuestion: true }),
            'probable I': () => monde({ cos: { 1: 0.70, 2: 0.45, 3: 0.40, 4: 0.30 }, lignes: LG, base: [2, 3], vivier: [1], lecture: { numero: null, setCode: null, total: null } }), 'sans colonne': () => mondeS3({ sansColonne: true }) };
        const diffs = [];
        for (const [nom, f] of Object.entries(mondes)) {
            const off = f(); off.cfg = { ...off.cfg, promotionSurs: false };
            const a = await avant(f(), { ...f().cfg, promotionSurs: false }), b = await ouvrir(off, off.cfg);
            if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(nom);
        }
        H.v('drapeau ÉTEINT : la route (etapeLeviers) rend, EN PROFONDEUR, ce que rendait la route d\'avant sur 7 mondes (probable S3, S2, I, question sans probable, un candidat, levier e, sans colonne)', diffs, []);
        const allumes = {};
        for (const nom of ['probable S3', 'probable S2', 'probable I']) { const m = mondes[nom](); allumes[nom] = await ouvrir(m, m.cfg); }
        H.v('drapeau ALLUMÉ : un probable prouvé devient un SÛR (affirmee), sans probable, avec sa trace', ['probable S3', 'probable S2', 'probable I'].map(n => [allumes[n].resultat.issue, allumes[n].resultat.analyse.cartes[0].carte.idProduct, allumes[n].probableDecide, allumes[n].tracePromotion.issue]), [['affirmee', 1, null, 'sur'], ['affirmee', 1, null, 'sur'], ['affirmee', 1, null, 'sur']]);
        H.v('drapeau ALLUMÉ, un candidat / levier e / sans colonne / question sans probable : la réponse d\'avant, octet pour octet', await (async () => { const d = []; for (const nom of ['un candidat', 'levier e', 'question sans probable', 'sans colonne']) { const m = mondes[nom](); const a = await avant(mondes[nom](), m.cfg), b = await ouvrir(m, m.cfg); if (JSON.stringify(a) !== JSON.stringify(b)) d.push(nom); } return d; })(), []);
        // la garde des marqueurs rend le sûr à la question (un rival de MÊME DESSIN aux marqueurs différents) : le probable reste
        const mg = mondeS3({ groupes: [[1, 4]] });
        const rg = await ouvrir(mg, mg.cfg, async args => { const r = await L.appliquerLeviers(args); return r; });
        H.v('rival de groupe : la garde relue sur le sûr le rend à la question, le probable de l\'étape reste (ou aucune promotion décidée)', [rg.resultat.issue !== 'affirmee'], [true]);
        // les traces (M2) : la trace de la première garde n'est écrasée que par un sûr CONFIRMÉ ; un sûr refusé garde la première et dit la seconde dans la trace de promotion
        const lignesF = lignes(ligne(1)), qAvant = { issue: 'question', analyse: { cartes: [{ statut: 'a-trancher', candidats: [{ idProduct: 1 }, { idProduct: 5 }] }] } };
        const faux2 = (gm) => PSR.etapeLeviers({ cfg: { promotionSurs: true }, resultat: qAvant, traceMarqueurs: { garde: { issue: 'premiere' } }, noter: () => { }, appliquer: async () => ({ resultat: null, probable: { idProduct: 1 }, promotion: { regle: 'S3', raison: 'x', critere: 'c', lignes: lignesF } }),
            affirmer: id => ({ issue: 'affirmee', analyse: { cartes: [{ statut: 'identifiee', carte: { idProduct: id } }] } }), marqueurs: () => gm });
        const conf2 = await faux2({ trace: { garde: { issue: 'sur-confirme' } } }), ref2 = await faux2({ resultat: qAvant, trace: { garde: { issue: 'question' } } });
        H.v('traces : un sûr confirmé remplace la trace des marqueurs ; un sûr refusé garde la première trace, le probable reste, la seconde est dans la trace de promotion', [conf2.resultat.issue, conf2.traceMarqueurs.garde.issue, ref2.resultat.issue, ref2.probableDecide && ref2.probableDecide.idProduct, ref2.traceMarqueurs.garde.issue, ref2.tracePromotion.marqueurs.garde.issue], ['affirmee', 'sur-confirme', 'question', 1, 'premiere', 'question']);
        const sansNote = []; await PSR.etapeLeviers({ cfg: { promotionSurs: true }, resultat: qAvant, noter: r => sansNote.push(r.issue), appliquer: async () => ({ resultat: null, probable: { idProduct: 1 }, promotion: { regle: 'S3', raison: 'x', critere: 'c', lignes: lignesF } }), affirmer: id => ({ issue: 'affirmee', analyse: { cartes: [{ statut: 'identifiee', carte: { idProduct: id } }] } }), marqueurs: () => null });
        H.v('la question d\'avant est notée AVANT l\'affirmation (la garde des marqueurs la rend si elle refuse)', sansNote, ['question']);
        const sansProm = []; await PSR.etapeLeviers({ cfg: { promotionSurs: true }, resultat: qAvant, noter: r => sansProm.push(r), appliquer: async () => ({ resultat: null, probable: { idProduct: 1 } }), affirmer: () => { throw new Error('jamais'); }, marqueurs: () => { throw new Error('jamais'); } });
        H.v('un probable sans promotion prouvée : ni note, ni affirmation, ni garde appelée', sansProm, []);
    }
    // ═════ la DÉCISION de la route (promotion-surs-route.js) : l'affirmation, la garde des marqueurs une seconde fois, le retour au probable
    {
        const promotion = { regle: 'S3', raison: 'x', critere: 'promotion en sûr (S3) : x', lignes: lignes(ligne(1)) };
        const probable = { idProduct: 1, signal: 'A', levier: 'abde', contredits: [2, 3], detail: {} };
        const affirmee = id => ({ issue: 'affirmee', analyse: { cartes: [{ statut: 'identifiee', carte: { idProduct: id } }] } });
        let affirmes = [], gardes = [];
        const appel = (o = {}) => { affirmes = []; gardes = []; return PSR.promouvoirDansLaRoute({ cfg: { promotionSurs: true }, lv: { probable, promotion }, affirmer: (id, surcharge, critere) => { affirmes.push([id, surcharge === promotion.lignes, critere]); return affirmee(id); },
            marqueurs: (aff, produits) => { gardes.push([aff.issue, produits === promotion.lignes]); return null; }, journal: () => { }, ...o }); };
        const p = appel();
        H.v('promue : l\'affirmation du désigné (ses lignes, le critère de la promotion), la garde des marqueurs relue sur ce SÛR', [p.resultat.issue, p.resultat.analyse.cartes[0].carte.idProduct, affirmes, gardes, p.trace.issue, p.trace.regle], ['affirmee', 1, [[1, true, 'promotion en sûr (S3) : x']], [['affirmee', true]], 'sur', 'S3']);
        H.v('drapeau éteint, ou aucune promotion décidée, ou pas de désigné : rien (null), rien d\'appelé', [appel({ cfg: { promotionSurs: false } }), appel({ cfg: {} }), appel({ lv: { probable, promotion: undefined } }), appel({ lv: { probable: null, promotion } }), appel({ lv: null }), affirmes.length], [null, null, null, null, null, 0]);
        const nc = appel({ affirmer: () => ({ issue: 'question', analyse: { cartes: [{ statut: 'a-trancher', candidats: [] }] } }) });
        H.v('l\'affirmation ne se construit pas (autre issue) : le probable reste (pas de résultat), la cause est dite', [nc.resultat, nc.trace.issue], [undefined, 'non-construite']);
        const nc2 = appel({ affirmer: () => affirmee(2) });
        H.v('l\'affirmation porte un AUTRE produit : refusée (le probable reste)', [nc2.resultat, nc2.trace.issue], [undefined, 'non-construite']);
        const ex = appel({ affirmer: () => { throw new Error('bug'); } });
        H.v('l\'affirmation lève : jamais propagé, le probable reste', [ex.resultat, ex.trace.issue], [undefined, 'non-construite']);
        const rev = appel({ marqueurs: () => ({ resultat: { issue: 'question', analyse: { cartes: [{ statut: 'a-trancher', candidats: [{ idProduct: 1 }, { idProduct: 5 }] }] } }, trace: { garde: { issue: 'question', rivaux: [5] } } }) });
        H.v('la garde des marqueurs rend le sûr à la QUESTION (rival de groupe) : pas de sûr, le probable reste, la trace de la garde est gardée', [rev.resultat, rev.trace.issue, rev.traceMarqueurs && rev.traceMarqueurs.garde.issue], [undefined, 'garde-marqueurs', 'question']);
        const conf = appel({ marqueurs: () => ({ trace: { garde: { issue: 'sur-confirme' } } }) });
        H.v('la garde confirme le sûr : promu, et sa trace est remontée', [conf.resultat.issue, conf.traceMarqueurs.garde.issue], ['affirmee', 'sur-confirme']);
        const exm = appel({ marqueurs: () => { throw new Error('bug'); } });
        H.v('la garde des marqueurs lève : AUCUN sûr (échec fermé), le probable reste', [exm.resultat, exm.trace.issue], [undefined, 'garde-marqueurs-en-erreur']);
    }

    // ═════ la configuration, le jeton /ping, le câblage de la route (lecture du code)
    {
        const c0 = lireConfig({}), c1 = lireConfig({ V2_PROMOTION_SURS: '1' }), c2 = lireConfig({ V2_PROMOTION_SURS: '0' });
        H.v('config : V2_PROMOTION_SURS éteint par défaut ; « 1 » l\'allume ; « 0 » l\'éteint', [c0.promotionSurs, c1.promotionSurs, c2.promotionSurs], [false, true, false]);
        let leve = false; try { lireConfig({ V2_PROMOTION_SURS: 'oui' }); } catch { leve = true; }
        H.v('config : une valeur autre que 0 ou 1 est une configuration invalide', leve, true);
        const servi = env => capacitesServies(lireConfig(env), undefined, null, null);
        H.v('/ping : le jeton promotion-surs, EN DERNIER, seulement avec les quatre drapeaux (V2_PROMOTION_SURS, V2_LEVIERS_ABDE, V2_PROBABLE, V2_GARDE_MARQUEURS)', [
            servi({ V2_PROMOTION_SURS: '1', V2_LEVIERS_ABDE: '1', V2_PROBABLE: '1', V2_GARDE_MARQUEURS: '1' }).slice(-2), servi({ V2_PROMOTION_SURS: '1', V2_LEVIERS_ABDE: '1', V2_GARDE_MARQUEURS: '1' }).includes('promotion-surs'), servi({ V2_PROMOTION_SURS: '1', V2_PROBABLE: '1', V2_GARDE_MARQUEURS: '1' }).includes('promotion-surs'),
            servi({ V2_LEVIERS_ABDE: '1', V2_PROBABLE: '1', V2_GARDE_MARQUEURS: '1' }).includes('promotion-surs'), servi({}).includes('promotion-surs'), servi({ V2_PROMOTION_SURS: '1', V2_LEVIERS_ABDE: '1', V2_PROBABLE: '1' }).includes('promotion-surs')], [['leviers-abde', 'promotion-surs'], false, false, false, false, false]);
        const fs = require('fs'), path = require('path');
        const lire = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
        const routes = lire('identifier/routes.js');
        const iEp = routes.indexOf('await etapeLeviers('), iCredit = routes.indexOf('// CRITERE-A (relecture r1, C1)');
        H.v('route : l\'étape et la promotion sont UNE fonction exécutée (etapeLeviers), appelée avant le règlement du crédit réservé', [iEp > 0, iCredit > iEp, /resultat = ep\.resultat; probableDecide = ep\.probableDecide; traceMarqueurs = ep\.traceMarqueurs; tracePromotion = ep\.tracePromotion;/.test(routes)], [true, true, true]);
        H.v('route : la garde des marqueurs est relue par la MÊME fonction (appliquerMarqueurs) sur les lignes de la promotion, avec la question d\'avant notée', [/marqueurs: \(aff, lignesPromo\) => appliquerMarqueurs\(\{[^}]*resultat: aff[^}]*derniereQuestion[^}]*produits: lignesPromo/.test(routes), /noter: r => \{ if \(r && r\.issue === 'question'\) derniereQuestion = r; \}/.test(routes)], [true, true]);
        H.v('route : le règlement du crédit réservé d\'une affirmation (branche du critère A) est celui qui sert la promotion', /if \(resultat\.issue === 'affirmee' && reqH\.questionId && !admin && credit\)/.test(routes), true);
        H.v('route : la trace de la promotion remonte de la décision à la sortie de la route', /\.\.\.\(tracePromotion \? \{ promotionSurs: tracePromotion \} : \{\}\)/.test(routes), true);
        H.v('route : la promotion est journalisée (analyses.promotionSurs), interne', /sortie\.promotionSurs \? \{ promotionSurs: sortie\.promotionSurs \}/.test(routes), true);
    }
    H.bilan();
})().catch(e => { console.log('ERREUR', e && e.stack || e); process.exit(1); });