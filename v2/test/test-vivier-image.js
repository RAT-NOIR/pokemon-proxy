'use strict';
// VIVIER-IMAGE — la règle SUR-PAR-IMAGE relue sur un VIVIER ÉLARGI (sur-par-image-route.js, derrière V2_VIVIER_IMAGE, en plus de V2_SUR_PAR_IMAGE et V2_EMPREINTE_EXTENSION). Sans base ni réseau : l'index d'empreintes est FABRIQUÉ ici
// (géométrie connue : le cosinus de chaque ligne avec la photo est écrit dans le banc), l'archive est une FAUSSE version, le catalogue (`charger`) et l'affirmation sont FABRIQUÉS. Aucun fichier du testeur, aucun appel payant.
// 🔑 Ce que le banc tient : la forme est un REPLI — la règle d'avant décide d'abord et rien d'autre n'est lu quand elle tranche ; seulement si elle se TAIT (ou n'a qu'un candidat), le vivier est élargi aux produits des 5 visuels les
// plus proches de la photo dans l'index ENTIER (dédoublonnés, jamais plus de 5), leurs lignes sont lues au catalogue, et les MÊMES conditions de la règle (aucune n'est assouplie) jugent l'ensemble. Éteint : la réponse est celle d'avant.
const H = require('./_harnais');
const A = require('./_empreinte-aide');
const { lireConfig } = require('../config');
const VE = require('../identifier/voisins-empreinte');
const E = require('../identifier/empreinte-vecteur');
const X = require('../identifier/index-empreintes');
const etat = require('../identifier/etat-empreintes');
const { consulterSurParImage } = require('../identifier/sur-par-image-route');

const ON = { ...A.ENV_EMPREINTE, V2_SUR_PAR_IMAGE: '1', V2_VIVIER_IMAGE: '1' };
const cfgViv = lireConfig(ON);
const cfgSansViv = lireConfig({ ...A.ENV_EMPREINTE, V2_SUR_PAR_IMAGE: '1' });
const cfgVivSeul = lireConfig({ ...A.ENV_EMPREINTE, V2_VIVIER_IMAGE: '1' });                       // le vivier sans la règle d'image
const cfgSansEmpreinte = lireConfig({ MONGODB_BASE: 'test_scratch', V2_SUR_PAR_IMAGE: '1', V2_VIVIER_IMAGE: '1' });

// ── l'index fabriqué : la photo est P = ½(e_0+e_1+e_2+e_3) (aucune composante au-delà de 0,5, comme l'exige le vecteur de l'extension) ; la ligne i a le cosinus COS[i] avec elle (a·P + √(1−a²)·e_{4+i}) ; les 5 premières sont les 5 visuels les plus proches
const COS = [0.95, 0.60, 0.55, 0.50, 0.45, 0.40, 0.35, 0.30, 0.10, 0.05];
const cles = COS.map((_, i) => `vivier/k${i}.webp`);
const matrice = new Float32Array(COS.length * E.DIM);
const ligneDeCos = (m, i, a) => { for (let j = 0; j < 4; j++) m[i * E.DIM + j] = a * 0.5; m[i * E.DIM + 4 + i] = Math.sqrt(1 - a * a); };
COS.forEach((a, i) => ligneDeCos(matrice, i, a));
// produits par visuel : k0 -> 100 · k1 -> 101 · k2 -> 102 · k3 -> 101 (un doublon) et 103 · k4 -> 104 · k5 (le SIXIÈME) -> 105 · k6 -> 106 · k8 -> 200 · k9 -> 201
const PRODUITS = { 0: [100], 1: [101], 2: [102], 3: [101, 103], 4: [104], 5: [105], 6: [106], 7: [107], 8: [200], 9: [201] };
const CLE = { 100: 0, 101: 1, 102: 2, 103: 3, 104: 4, 105: 5, 106: 6, 107: 7, 200: 8, 201: 9 };
const contexte = (groupe = {}, PROD = PRODUITS) => ({ groupe, carte: Object.fromEntries(cles.map((c, i) => [c, [3000 + i]])), invisibles: {}, produits: Object.fromEntries(cles.map((c, i) => [c, (PROD[i] || []).map(id => [id, 1.0])])) });
const installer = (groupe, prod) => { const o = X.ouvrir(X.sceller({ cles, matrice, contexte: contexte(groupe, prod), modele: A.MODELE, chargeLe: '2026-10-26T10:00:00.000Z' }, A.SECRET), A.SECRET, { modeleAttendu: A.MODELE }); etat.installer(Object.freeze({ index: o.index, meta: o.meta })); };
const entreeAvec = ({ redressee = true } = {}) => { const p = new Float32Array(E.DIM); for (let j = 0; j < 4; j++) p[j] = 0.5; return { empreintes: VE.lireEnveloppe({ modeleEmpreinte: A.modeleAnnonce(), empreintes: [{ photo: 0, vecteur: E.encoderVecteur(p), redressee }] }, 1) }; };

let appelsVersion = 0;
const version = ({ ent = {}, ...over } = {}) => ({
    entree: id => { appelsVersion++; return id in CLE ? { grande: { cle: cles[CLE[id]] }, vignette: { cle: `v/${id}.webp` }, idMetacard: 5000 + id, basseDefinition: false, mention: null, ...(ent[id] || {}) } : null; },
    empruntDe: () => false, identifiants: () => Object.keys(CLE).map(Number), colonneMarquages: true, partagesDe: () => [], ...over });
const ligne = (id, numero = '001') => ({ idProduct: id, numero, total: '064', set: { code: 'PBL' }, tirageSource: 'intl', marques: [] });
const produits = (...ids) => new Map(ids.map(id => [id, ligne(id)]));
const question = ids => ({ issue: 'question', analyse: { cartes: [{ statut: 'a-trancher', candidats: ids.map(idProduct => ({ idProduct })) }] } });
const corpsDe = (ids, extra = {}) => ({ success: true, candidats: ids.map(idProduct => ({ idProduct })), carte: { ambigu: true }, ...extra });
let affirmes = [], chargements = [], journaux = [];
const affirmer = (id, surcharge, critere) => { affirmes.push({ id, critere, avait: surcharge instanceof Map && surcharge.has(id) }); return { issue: 'affirmee', analyse: { cartes: [{ statut: 'identifiee', carte: { idProduct: id } }] }, critere }; };
const charger = async ids => { chargements.push([...ids]); return new Map(ids.map(id => [id, ligne(id)])); };
const remise = () => { affirmes = []; chargements = []; journaux = []; appelsVersion = 0; };
const appel = (ids, over = {}) => consulterSurParImage({
    cfg: cfgViv, entree: entreeAvec(), resultat: question(ids), corpsChaine: corpsDe(ids), produits: produits(...ids), version: version(),
    jumeaux: () => ({ conclu: true, ids: [] }), affirmer, charger, journal: (q, e) => journaux.push([q, String(e && e.message)]), ...over
});

(async () => {
    installer();
    // ── (1) EN PREMIER : la configuration — éteint par défaut, « 1 » allume, toute autre valeur est refusée ; et sans l'un des TROIS drapeaux, rien n'est lu
    {
        let refuse = false; try { lireConfig({ MONGODB_BASE: 'test_scratch', V2_VIVIER_IMAGE: 'oui' }); } catch { refuse = true; }
        H.v('1a. la configuration livrée n\'allume pas le vivier ; « 1 » l\'allume ; toute autre valeur est refusée', [lireConfig({ MONGODB_BASE: 'test_scratch' }).vivierImage, lireConfig({ MONGODB_BASE: 'test_scratch', V2_VIVIER_IMAGE: '1' }).vivierImage, refuse], [false, true, true]);
        remise();
        H.v('1b. V2_VIVIER_IMAGE éteint (la règle d\'image seule), question à UN candidat : null (comme avant), ni archive lue, ni catalogue, ni affirmation', [await appel([100], { cfg: cfgSansViv }), appelsVersion, chargements.length, affirmes.length], [null, 0, 0, 0]);
        remise();
        H.v('1c. … et sur une question à deux candidats que la règle ne tranche pas : la trace d\'avant, sans le moindre champ « vivier », aucun catalogue', [await appel([200, 201], { cfg: cfgSansViv }), chargements.length, affirmes.length], [{ trace: { issue: 'se-tait', motif: 'pas-voisin-n1' } }, 0, 0]);
        remise();
        H.v('1d. le vivier SANS V2_SUR_PAR_IMAGE : null, rien n\'est lu', [await appel([100], { cfg: cfgVivSeul }), appelsVersion, chargements.length, affirmes.length], [null, 0, 0, 0]);
        remise();
        H.v('1e. le vivier SANS V2_EMPREINTE_EXTENSION : null, rien n\'est lu', [await appel([100], { cfg: cfgSansEmpreinte }), appelsVersion, chargements.length, affirmes.length], [null, 0, 0, 0]);
    }
    // ── (2) le REPLI : une question à UN candidat, que la règle d'avant ne regardait pas, relue sur le vivier élargi
    {
        remise();
        const r = await appel([100]);
        H.v('2a. question [A=100], photo = son visuel : A est affirmé', [r && r.resultat && r.resultat.analyse.cartes[0].carte.idProduct, r && r.trace.issue], [100, 'sur']);
        H.v('2b. 🔑 les produits des 5 visuels les plus proches, dédoublonnés (101 vu sur deux visuels), hors le candidat : le catalogue est lu pour ces quatre-là et pour eux seuls', chargements, [[101, 102, 103, 104]]);
        H.v('2c. le sixième visuel (105) et les suivants n\'entrent pas dans le vivier', [chargements[0].includes(105), chargements[0].includes(106)], [false, false]);
        H.v('2d. la trace dit les candidats jugés (la question puis les ajoutés) et ce que le vivier a fait', [r.trace.candidats, r.trace.vivier], [[100, 101, 102, 103, 104], { k: 5, extras: 4, motifAvant: 'candidats', charge: true }]);
        H.vrai('2e. le critère journalisé NOMME le périmètre élargi (jamais « seul candidat de la question » tout court)', affirmes.length === 1 && /sur par l'image : seul candidat de la question/.test(affirmes[0].critere) && /vivier élargi/.test(affirmes[0].critere) && /5 visuels/.test(affirmes[0].critere));
    }
    // ── (3) le REPLI : une question à deux candidats que la règle ne tranche pas (aucun n'est le voisin n°1) ; le gagnant est un produit AJOUTÉ
    {
        remise();
        const r = await appel([200, 201]);
        H.v('3a. question [200, 201] (visuels lointains), photo = visuel de A : A (un produit AJOUTÉ) est affirmé, avec sa ligne de catalogue passée à l\'affirmation', [r && r.resultat && r.resultat.analyse.cartes[0].carte.idProduct, affirmes.map(a => [a.id, a.avait])], [100, [[100, true]]]);
        H.v('3b. le catalogue est lu pour les ajoutés (A compris), jamais pour les candidats de la question', chargements, [[100, 101, 102, 103, 104]]);
        H.v('3c. la trace garde le motif d\'AVANT (pas-voisin-n1) et la liste jugée', [r.trace.vivier.motifAvant, r.trace.candidats], ['pas-voisin-n1', [200, 201, 100, 101, 102, 103, 104]]);
    }
    // ── (4) la règle d'avant décide d'abord : quand elle tranche, le vivier n'est ni calculé ni lu
    {
        remise();
        const r = await appel([100, 200]);
        H.v('4a. question [A, 200] : la règle d\'avant affirme A — la trace est celle d\'avant (aucun champ « vivier »), le catalogue n\'est PAS lu', [r.resultat.analyse.cartes[0].carte.idProduct, 'vivier' in r.trace, chargements.length], [100, false, 0]);
        H.vrai('4b. … et le critère est celui d\'avant (sans « vivier élargi »)', affirmes.length === 1 && !/vivier/.test(affirmes[0].critere));
    }
    // ── (5) les conditions de la règle s'appliquent TELLES QUELLES au vivier élargi : une seule suffit à se taire (défaut fermé)
    const se_tait = async (nom, ids, over, motif, vivierAttendu = true) => { remise(); const r = await appel(ids, over); H.v(`5. ${nom}`, [r && !r.resultat, r && r.trace && r.trace.motif, r && r.trace && 'vivier' in r.trace, affirmes.length], [true, motif, vivierAttendu, 0]); return r; };
    await se_tait('un produit AJOUTÉ (101) en basse définition : la question reste (visuel-suspect)', [100], { version: version({ ent: { 101: { basseDefinition: true } } }) }, 'visuel-suspect');
    await se_tait('un produit AJOUTÉ (102) au visuel d\'emprunt : la question reste', [100], { version: version({ empruntDe: id => (id === 102 ? true : false) }) }, 'visuel-suspect');
    await se_tait('un produit AJOUTÉ (103) sans entrée d\'archive (exclu) : la question reste (donnee-manquante)', [100], { version: version({ entree: id => (id === 103 ? null : version().entree(id)) }) }, 'donnee-manquante');
    await se_tait('un ajouté (101) partage son fichier avec une autre métacarte : la question reste', [100], { version: version({ ent: { 104: { vignette: { cle: 'v/101.webp' } } } }) }, 'visuel-suspect');
    await se_tait('le numéro lu (002) contredit le désigné (A porte 001) : la question reste (contredit)', [100], { corpsChaine: corpsDe([100], { lectureGarde: { numero: '002' } }) }, 'contredit');
    await se_tait('un jumeau du désigné hors du vivier jugé : la question reste (jumeaux)', [100], { jumeaux: () => ({ conclu: true, ids: [100, 777002] }) }, 'jumeaux');
    await se_tait('jumeaux non conclus : la question reste', [100], { jumeaux: () => ({ conclu: false, ids: [] }) }, 'jumeaux');
    await se_tait('des marques lues sur la photo alors que A n\'en porte aucune : la question reste (marques)', [100], { marquesLues: ['staff'] }, 'marques');
    await se_tait('l\'archive sans la marque d\'emprunt (empruntDe absente) : la question reste (emprunt-inconnu)', [100], { version: version({ empruntDe: undefined }) }, 'emprunt-inconnu');
    await se_tait('la photo n\'est pas redressée : la question reste (photo-non-redressee)', [100], { entree: entreeAvec({ redressee: false }) }, 'photo-non-redressee', false);
    {   // l'écart de cosinus : A (0,95) contre un ajouté trop proche — l'index est remplacé par un où le 2e visuel est à 0,85
        remise();
        const cosProche = [0.95, 0.85]; const cl = ['vivier/p0.webp', 'vivier/p1.webp'];
        const m = new Float32Array(2 * E.DIM); cosProche.forEach((a, i) => ligneDeCos(m, i, a));
        const ctx = { groupe: {}, carte: { 'vivier/p0.webp': [1], 'vivier/p1.webp': [2] }, invisibles: {}, produits: { 'vivier/p0.webp': [[100, 1]], 'vivier/p1.webp': [[101, 1]] } };
        const o = X.ouvrir(X.sceller({ cles: cl, matrice: m, contexte: ctx, modele: A.MODELE, chargeLe: '2026-10-26T10:00:00.000Z' }, A.SECRET), A.SECRET, { modeleAttendu: A.MODELE });
        etat.installer(Object.freeze({ index: o.index, meta: o.meta }));
        const v = version({ entree: id => (id === 100 ? { grande: { cle: cl[0] }, vignette: { cle: 'v/100' }, idMetacard: 5100, basseDefinition: false, mention: null } : id === 101 ? { grande: { cle: cl[1] }, vignette: { cle: 'v/101' }, idMetacard: 5101, basseDefinition: false, mention: null } : null), identifiants: () => [100, 101] });
        const r = await appel([100], { version: v });
        H.v('5. (5) l\'écart au second (0,95 − 0,85 = 0,10 < 0,2) : la question reste (ecart), le vivier a été essayé', [!r.resultat, r.trace.motif, r.trace.vivier.extras, affirmes.length], [true, 'ecart', 1, 0]);
        installer();
    }
    // ── (6) des pannes ne cassent rien et ne fabriquent rien
    {
        remise();
        let r = await appel([100], { charger: async () => { throw new Error('catalogue en panne'); } });
        H.v('6a. le catalogue lève : la question reste, la trace dit que le vivier n\'a pas été chargé, l\'erreur est journalisée, rien n\'est affirmé', [r && !r.resultat, r.trace.issue, r.trace.motif, r.trace.vivier.charge, journaux.length, affirmes.length], [true, 'se-tait', 'vivier-indisponible', false, 1, 0]);
        remise();
        r = await appel([100], { charger: undefined });
        H.v('6b. aucun lecteur de catalogue fourni : la question reste (vivier-indisponible), jamais d\'exception', [r && !r.resultat, r.trace.motif, affirmes.length], [true, 'vivier-indisponible', 0]);
        remise();
        r = await appel([200, 201], { charger: async ids => new Map() });
        H.v('6c. le catalogue ne rend AUCUNE ligne : le désigné (A) n\'a pas de ligne — la question reste (donnee-manquante)', [r && !r.resultat, r.trace.motif, affirmes.length], [true, 'donnee-manquante', 0]);
        remise();
        r = await appel([100], { affirmer: () => { throw new Error('produit absent'); } });
        H.v('6d. l\'affirmation lève : la question reste (non-construite), trace du vivier gardée', [r && !r.resultat, r.trace.issue, !!r.trace.vivier], [true, 'non-construite', true]);
        remise();
        r = await appel([100], { version: { entree: () => { throw new Error('x'); } } });
        H.v('6e. une exception dans la version ne sort jamais : null', r, null);
    }
    // ── (7) ce qui n'est pas une question simple n'est jamais relu, même allumé
    {
        for (const [nom, res] of [['un sûr', { issue: 'affirmee', analyse: { cartes: [{ carte: { idProduct: 100 }, candidats: [{ idProduct: 100 }] }] } }], ['un introuvable', { issue: 'introuvable', analyse: { cartes: [{ candidats: [{ idProduct: 100 }] }] } }], ['une panne', { issue: 'panne', analyse: { cartes: [] } }],
            ['une question de la garde des jumeaux (motif)', { ...question([100]), motif: 'impression-indeterminee' }], ['une question par contradiction de champ', { ...question([100]), contradiction: 'numéro' }]]) {
            remise(); H.v(`7. ${nom} : null, rien lu, rien chargé`, [await appel([100], { resultat: res }), appelsVersion, chargements.length], [null, 0, 0]);
        }
        remise();
        const lot = { issue: 'question', analyse: { cartes: [question([100]).analyse.cartes[0], question([100]).analyse.cartes[0]] } };
        H.v('7b. un lot (deux cartes) : null', [await appel([100], { resultat: lot }), chargements.length], [null, 0]);
    }
    // ── (8) les candidats cachés de la chaîne (hors des choix montrés) restent des rivaux et ne sont jamais ajoutés deux fois
    {
        remise();
        const r = await appel([200], { corpsChaine: corpsDe([200, 101]) });      // la chaîne a aussi lu 101 : il est un candidat (caché), pas un ajouté
        H.v('8a. 101 est déjà candidat : il n\'est pas relu au catalogue comme un ajouté, et la liste jugée ne le porte qu\'une fois', [chargements, r && r.trace.candidats], [[[100, 102, 103, 104]], [200, 101, 100, 102, 103, 104]]);
        H.v('8b. … A (un ajouté) est affirmé, les deux candidats de la chaîne étant des rivaux', r.resultat.analyse.cartes[0].carte.idProduct, 100);
    }
    // ── (9) aucun produit à ajouter : le vivier ne change rien
    {
        remise();
        const r = await appel([100, 101, 102, 103, 104], { produits: produits(100, 101, 102, 103, 104), resultat: question([100, 101, 102, 103, 104]), corpsChaine: corpsDe([100, 101, 102, 103, 104]), entree: entreeAvec() });
        H.v('9a. les produits des 5 visuels sont déjà tous candidats : le catalogue n\'est pas lu', chargements.length, 0);
        H.v('9b. … et la règle d\'avant (A est le voisin n°1, écart 0,35) a déjà affirmé : trace d\'avant', [r.resultat.analyse.cartes[0].carte.idProduct, 'vivier' in r.trace], [100, false]);
    }
    // ── (10) 🔴 MÊME DESSIN dans le vivier : un ajouté du groupe de dessin du meilleur — l'index est remplacé (k0 et k1 forment un groupe)
    {
        installer({ [cles[0]]: 7, [cles[1]]: 7 });
        remise();
        const r = await appel([100]);
        H.v('10. 🔴 [A] puis l\'ajouté 101 (même dessin que A à l\'index) : la question reste (meme-dessin), rien n\'est affirmé', [r && !r.resultat, r.trace.motif, affirmes.length], [true, 'meme-dessin', 0]);
        installer();
    }
    // ── (11) 🔴 GARDE DU GROUPE DE DESSIN : un membre du groupe du désigné hors de la liste jugée (ici k9 -> 201, invisible : ni candidat ni dans le top 5) — le désigné ne s'affirme PAS
    {
        installer({ [cles[0]]: 7, [cles[9]]: 7 });
        remise();
        const r = await appel([100]);
        H.v('11a. 🔴 [A] élargi ; k9 (produit 201) est du groupe de dessin de A mais hors de la liste : silence (groupe-incomplet), rien affirmé, catalogue lu', [r && !r.resultat, r.trace.motif, affirmes.length], [true, 'groupe-incomplet', 0]);
        installer({ [cles[0]]: 7, [cles[1]]: 7, [cles[9]]: 7 });
        installer({ [cles[0]]: 7 });
        remise();
        const r2 = await appel([100]);
        H.v('11b. … un groupe dont TOUS les membres sont dans la liste (ici le seul k0) : A est affirmé', r2.resultat && r2.resultat.analyse.cartes[0].carte.idProduct, 100);
        installer();
    }
    // ── (12) 🔴 L'ÉCART TIENT AUSSI CONTRE top[1] : le 2e visuel de l'index (0,85) n'a AUCUN produit au contexte, donc invisible de la liste — l'écart réel (0,10) < 0,2 : silence
    {
        installer({}, { ...PRODUITS, 1: [] });
        remise();
        const r = await appel([100]);
        H.v('12a. 🔴 top[1] sans produit (cosinus 0,60 -> écart 0,35 : tient) : A est affirmé', r && r.resultat && r.resultat.analyse.cartes[0].carte.idProduct, 100);
        const cl = ['vivier/q0.webp', 'vivier/q1.webp', 'vivier/q2.webp'], m = new Float32Array(3 * E.DIM);
        [0.95, 0.85, 0.2].forEach((a, i) => ligneDeCos(m, i, a));
        const ctx = { groupe: {}, carte: { [cl[0]]: [1], [cl[1]]: [2], [cl[2]]: [3] }, invisibles: {}, produits: { [cl[0]]: [[100, 1]], [cl[1]]: [], [cl[2]]: [[201, 1]] } };
        const o = X.ouvrir(X.sceller({ cles: cl, matrice: m, contexte: ctx, modele: A.MODELE, chargeLe: '2026-10-26T10:00:00.000Z' }, A.SECRET), A.SECRET, { modeleAttendu: A.MODELE });
        etat.installer(Object.freeze({ index: o.index, meta: o.meta }));
        const v = version({ entree: id => (id === 100 ? { grande: { cle: cl[0] }, vignette: { cle: 'v/100' }, idMetacard: 5100, basseDefinition: false, mention: null } : id === 201 ? { grande: { cle: cl[2] }, vignette: { cle: 'v/201' }, idMetacard: 5201, basseDefinition: false, mention: null } : null), identifiants: () => [100, 201] });
        remise();
        const r2 = await appel([100], { version: v });
        H.v('12b. 🔴 top[1] (0,85, aucun produit) à 0,10 du désigné : silence (ecart-index), rien affirmé', [r2 && !r2.resultat, r2.trace.motif, affirmes.length], [true, 'ecart-index', 0]);
        installer();
    }
    // ── (13) MINEUR 3 : charger rend autre chose qu'une Map (ou lève) : silence
    {
        remise();
        const r = await appel([100], { charger: async () => [] });
        H.v('13. le lecteur rend un tableau, pas une Map : silence (vivier-indisponible)', [r && !r.resultat, r.trace.motif, affirmes.length], [true, 'vivier-indisponible', 0]);
    }
    // ── (14) IMPORTANT 1 : le VRAI fournisseur de jumeaux (fournisseurParDefaut), pas l'injection. Il ne conclut que pour le produit affirmé / le candidat UNIQUE : un désigné AJOUTÉ par le top 5 reste rejeté (jumeaux).
    //    Les verdicts ne sont PAS élargis aux ajoutés (sans la péremption plusRecentDansMetacarte, ce serait un chemin vers un faux) : en production la règle n'agit que sur les questions à un candidat.
    {
        const { fournisseurParDefaut } = require('../identifier/jumeaux');
        const vJ = version({ colonneJumeaux: true, jumeauxDe: () => [], empreinteJumeaux: () => ({ n: 1, max: 999999 }), metacarteJumeaux: id => 5000 + id });
        const catJ = { plusRecentDansMetacarte: async () => false };
        remise();
        let jum = await fournisseurParDefaut(catJ, vJ, [100]);          // la question n'a qu'UN candidat (100) : c'est lui le « candidat unique », seul vérifié
        let r = await appel([100], { jumeaux: jum, version: vJ });
        H.v('14a. vrai fournisseur, candidat unique A désigné : A est affirmé (le fournisseur conclut pour lui)', r && r.resultat && r.resultat.analyse.cartes[0].carte.idProduct, 100);
        remise();
        jum = await fournisseurParDefaut(catJ, vJ, [200]);              // candidat unique 200 ; le désigné de l'image (A=100) est un AJOUTÉ
        r = await appel([200], { jumeaux: jum, version: vJ });
        H.v('14b. 🔴 vrai fournisseur, le désigné A est un AJOUTÉ par le top 5 : rejeté (jumeaux), rien affirmé', [r && !r.resultat, r.trace.motif, affirmes.length], [true, 'jumeaux', 0]);
    }
    H.bilan();
})().catch(e => { console.error(e); process.exit(1); });
