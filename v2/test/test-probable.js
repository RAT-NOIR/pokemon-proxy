'use strict';
// PROBABLE — la règle (identifier/probable.js, signal A) sur des états fabriqués, y compris ceux qui doivent dire NON.
const H = require('./_harnais'); const P = require('../identifier/probable'); const GC = require('../identifier/garde-contradiction');
const ligne = (o = {}) => ({ numero: '12', total: '102', set: { code: 'BS' }, tirageSource: 'intl', setTcgdex: 'base1', nomCardmarket: 'Machop', ...o });
const lu = (o = {}) => GC.lectureDe({ success: true, carte: {}, lectureGarde: { numero: '12', total: '102', langue: 'EN', carteTcgdexId: 'base1-12', ...o } });
const mapDe = o => new Map(Object.entries(o).map(([k, v]) => [+k, v]));
// TOUR 3 : `decider` est FERMÉ par défaut (vecteur exigé, cosinus 0,38). Ces bancs de la règle de lecture le veulent OUVERT : D() le dit explicitement ; les gardes fermées par défaut ont leur propre bloc plus bas (P.decider sans options).
const D = o => P.decider({ vecteurExige: false, cosinusMin: 0, ...o });
(async () => {
    // numéro et total : 1 concorde (ok), les autres contredits (ko)
    const A = mapDe({ 1: ligne(), 2: ligne({ numero: '13' }), 3: ligne({ numero: '14', total: '64' }) });
    const d = D({ ids: [1, 2, 3], produits: A, lu: lu() });
    H.v('un candidat concorde, les deux autres sont contredits : probable', d && d.idProduct, 1);
    H.v('   signal A, les contredits nommés', [d.signal, d.contredits], ['A', [2, 3]]);
    H.v('   l\'ordre des ids n\'y change rien', D({ ids: [3, 2, 1], produits: A, lu: lu() }).idProduct, 1);
    // NON : un rival non contredit
    H.v('un rival non contredit (même numéro, total) : rien', D({ ids: [1, 2], produits: mapDe({ 1: ligne(), 2: ligne({ set: { code: 'B2' } }) }), lu: lu() }), null);
    H.v('un seul des deux rivaux contredit : rien', D({ ids: [1, 2, 3], produits: mapDe({ 1: ligne(), 2: ligne({ numero: '13' }), 3: ligne() }), lu: lu() }), null);
    // NON : le premier n'est pas concordant, ou est contredit
    H.v('le 1er n\'a aucun champ concordant (lecture sans numéro ni total) : rien', D({ ids: [1, 2], produits: A, lu: lu({ numero: null, total: null, langue: null, carteTcgdexId: null }) }), null);
    H.v('tous contredits : rien', D({ ids: [1, 2], produits: mapDe({ 1: ligne({ numero: '99' }), 2: ligne({ numero: '98' }) }), lu: lu() }), null);
    // l'image décide du premier ; la lecture doit le confirmer
    const cos = m => id => (m[id] ?? null);
    H.v('l\'image met en tête un candidat que la lecture contredit : rien', D({ ids: [1, 2], produits: mapDe({ 1: ligne(), 2: ligne({ numero: '13' }) }), lu: lu(), cosinus: cos({ 1: 0.5, 2: 0.9 }) }), null);
    H.v('l\'image et la lecture désignent le même : probable', (D({ ids: [1, 2], produits: mapDe({ 1: ligne(), 2: ligne({ numero: '13' }) }), lu: lu(), cosinus: cos({ 1: 0.9, 2: 0.5 }) }) || {}).idProduct, 1);
    // GROUPE : l'image ne tranche jamais ; la lecture seule, si elle contredit l'autre version
    H.v('groupe : l\'image seule (cosinus) ne rend rien quand la lecture ne sépare pas', D({ ids: [1, 2], produits: mapDe({ 1: ligne(), 2: ligne() }), lu: lu(), cosinus: cos({ 1: 0.9, 2: 0.2 }), groupe: true }), null);
    H.v('groupe : la lecture contredit l\'autre version : probable', (D({ ids: [1, 2], produits: mapDe({ 1: ligne(), 2: ligne({ numero: '13' }) }), lu: lu(), cosinus: cos({ 1: 0.2, 2: 0.9 }), groupe: true }) || {}).idProduct, 1);
    // ex aequo exact (même cosinus, même lecture) : rien
    H.v('ex aequo exact : rien', D({ ids: [1, 2], produits: mapDe({ 1: ligne(), 2: ligne({ numero: '13' }) }), lu: lu({ numero: null }), cosinus: cos({ 1: 0.7, 2: 0.7 }) }), null);
    // formes : une ligne absente, un id en double, 1 ou 4 candidats, pas de lecture, produits pas une Map
    H.v('candidat sans ligne de catalogue : rien', D({ ids: [1, 2], produits: mapDe({ 1: ligne() }), lu: lu() }), null);
    H.v('un seul candidat (confirmation) : rien', D({ ids: [1], produits: A, lu: lu() }), null);
    H.v('quatre candidats : rien', D({ ids: [1, 2, 3, 4], produits: A, lu: lu() }), null);
    H.v('doublon : rien', D({ ids: [1, 1], produits: A, lu: lu() }), null);
    H.v('pas de lecture : rien', D({ ids: [1, 2], produits: A, lu: null }), null);
    H.v('produits pas une Map : rien', D({ ids: [1, 2], produits: {}, lu: lu() }), null);
    H.v('une fonction de cosinus qui lève : rien, sans exception', D({ ids: [1, 2], produits: A, lu: lu(), cosinus: () => { throw new Error('x'); } }), null);
    // versions
    H.v('2.0.1 sert', P.versionAuMoins('2.0.1'), true);
    H.v('2.0.0 ne sert pas', P.versionAuMoins('2.0.0'), false);
    H.v('2.1.0 et 10.0.0 servent', [P.versionAuMoins('2.1.0'), P.versionAuMoins('10.0.0')], [true, true]);
    H.v('illisible, absent, nombre : pas servi', [P.versionAuMoins('abc'), P.versionAuMoins(undefined), P.versionAuMoins(2.1), P.versionAuMoins('2.0.1-beta')], [false, false, false, false]);
    // cosinusDes
    const sim = cles => cles.map(c => ({ a: 0.9, b: 0.4 })[c]);
    const f = P.cosinusDes({ ids: [1, 2], cles: new Map([[1, 'a'], [2, 'b']]), similarites: sim, redressee: true });
    H.v('cosinusDes : redressée', [f(1), f(2), f(3)], [0.9, 0.4, null]);
    H.v('cosinusDes : non redressée : aucun', [P.cosinusDes({ ids: [1], cles: new Map([[1, 'a']]), similarites: sim, redressee: false })(1)], [null]);
    // ── TOUR 1 (relecture 1) : I2 le prix, I3 le groupe lu dans les DONNÉES, détail pour la mesure
    const { consulterProbable, groupeParLesDonnees } = (() => { const m = require('../identifier/probable-route'); return { consulterProbable: m.consulterProbable, groupeParLesDonnees: m.groupeParLesDonnees }; })();
    const { creerConstructeur } = require('../chargeur/version'); const VB = require('./_visuels-banc');
    const dd = d => d && d.detail;
    H.v('détail pour la mesure : nCand, ok, ko, cosPremier, cosSecond', dd(D({ ids: [1, 2], produits: mapDe({ 1: ligne(), 2: ligne({ numero: '13' }) }), lu: lu(), cosinus: id => ({ 1: 0.9, 2: 0.5 })[id] })), { nCand: 2, ok: 4, ko: 0, cosPremier: 0.9, cosSecond: 0.5 });
    const MODELE = { id: 'm', sha256: 'a'.repeat(64) };
    const cfg = { probable: true, versionMinProbable: '2.0.1', empreinteExtension: true, modeleEmpreinte: MODELE, probableVecteurExige: false, probableCosinusMin: 0 };      // gardes du cosinus OUVERTES : ces cas testent le prix et le groupe
    let courante = 0;
    const etat = { courante: () => { courante++; return null; } };      // si l'image est consultée, preparerVecteur arrive ici
    const entree = { versionExtension: '2.0.1', empreintes: { modele: MODELE, rejet: null, entrees: [{ photo: 0, vecteur: 'x', redressee: true, carte: null }] } };
    const guide = { date: '2026-10-04', tendance: 1.2 };
    const resultat = (ids, guides = {}) => ({ issue: 'question', analyse: { cartes: [{ statut: 'a-trancher', candidats: ids.map(i => ({ idProduct: i, prixGuide: i in guides ? guides[i] : guide })) }] } });
    const corps = { success: true, carte: {}, lectureGarde: { numero: '12', total: '102', langue: 'EN', carteTcgdexId: 'base1-12' } };
    const version = (docs) => { const b = creerConstructeur({ marquages: true }); for (const d of docs) b.entree(VB.doc(d.id, { idMetacard: d.meta, numero: '12', variante: d.v, total: '102', vignette: { cle: `banc/${d.cle}.webp`, w: 300, h: 420 } })); return b.finir(); };
    const P2 = mapDe({ 1: ligne(), 2: ligne({ numero: '13' }) });
    const vDistinct = version([{ id: 1, meta: 501, cle: 'a', v: 'normale' }, { id: 2, meta: 502, cle: 'b', v: 'normale' }]);
    const vGroupe = version([{ id: 1, meta: 501, cle: 'g', v: 'normale' }, { id: 2, meta: 501, cle: 'g', v: 'jumbo' }]);
    H.v('I2 : le candidat désigné SANS prix servi : pas de probable (la question reste réservée)', consulterProbable({ cfg, entree: { versionExtension: '2.0.1' }, resultat: resultat([1, 2], { 1: null }), corpsChaine: corps, produits: P2, version: vDistinct }), null);
    H.v('   un guide sans date ou sans prix n\'est pas un prix servi', [consulterProbable({ cfg, entree: { versionExtension: '2.0.1' }, resultat: resultat([1, 2], { 1: { tendance: 1 } }), corpsChaine: corps, produits: P2, version: vDistinct }), consulterProbable({ cfg, entree: { versionExtension: '2.0.1' }, resultat: resultat([1, 2], { 1: { date: '2026-10-04' } }), corpsChaine: corps, produits: P2, version: vDistinct })], [null, null]);
    H.v('   le même cas AVEC un guide servi : probable', (consulterProbable({ cfg, entree: { versionExtension: '2.0.1' }, resultat: resultat([1, 2]), corpsChaine: corps, produits: P2, version: vDistinct }) || {}).idProduct, 1);
    H.v('   le prix du RIVAL ne compte pas : seul le candidat désigné doit en porter un', (consulterProbable({ cfg, entree: { versionExtension: '2.0.1' }, resultat: resultat([1, 2], { 2: null }), corpsChaine: corps, produits: P2, version: vDistinct }) || {}).idProduct, 1);
    H.v('I3 : le groupe se lit dans les DONNÉES (même visuel, même fiche), SANS trace de marqueurs : vrai pour une paire jumbo/normale, faux pour deux dessins distincts', [groupeParLesDonnees(vGroupe, [1, 2]), groupeParLesDonnees(vDistinct, [1, 2]), groupeParLesDonnees(null, [1, 2])], [true, false, true]);
    courante = 0; consulterProbable({ cfg, entree, resultat: resultat([1, 2]), corpsChaine: corps, produits: P2, version: vGroupe, traceMarqueurs: null, etat });
    H.v('I3 : une paire jumbo/normale, marqueurs ÉTEINTS (aucune trace) : l\'image n\'est JAMAIS consultée', courante, 0);
    courante = 0; consulterProbable({ cfg, entree, resultat: resultat([1, 2]), corpsChaine: corps, produits: P2, version: vDistinct, traceMarqueurs: null, etat });
    H.v('   témoin : deux dessins distincts : l\'image est consultée (le détecteur sait dire NON)', courante, 1);
    // TOUR 3 : I3 INCONDITIONNEL — un probable est interdit dans un groupe de même dessin, QUEL QUE SOIT l'état des drapeaux (ici les gardes du cosinus sont OUVERTES : ni vecteur exigé ni cosinus minimal), même si la lecture contredit l'autre version
    H.v('   TOUR 3 : groupe + lecture qui contredit l\'autre version, gardes du cosinus ouvertes : RIEN (le groupe est interdit, sans condition sur aucun drapeau)', consulterProbable({ cfg, entree, resultat: resultat([1, 2]), corpsChaine: corps, produits: P2, version: vGroupe, etat }), null);
    H.v('   le détecteur sait dire NON : les mêmes cas sur deux dessins distincts donnent un probable', (consulterProbable({ cfg, entree, resultat: resultat([1, 2]), corpsChaine: corps, produits: P2, version: vDistinct, etat }) || {}).idProduct, 1);
    H.v('   groupe INCONNU (la version ne sait pas le dire) : défaut fermé = groupe : rien', consulterProbable({ cfg, entree: { versionExtension: '2.0.1' }, resultat: resultat([1, 2]), corpsChaine: corps, produits: P2, version: null }), null);
    const vTrois = version([{ id: 1, meta: 501, cle: 'a', v: 'normale' }, { id: 2, meta: 502, cle: 'g', v: 'normale' }, { id: 3, meta: 502, cle: 'g', v: 'jumbo' }]);
    const P3 = mapDe({ 1: ligne(), 2: ligne({ numero: '13' }), 3: ligne({ numero: '14' }) });
    H.v('   le groupe ne touche que le PREMIER candidat : un groupe entre deux RIVAUX n\'empêche pas un probable désigné par la lecture', (consulterProbable({ cfg, entree: { versionExtension: '2.0.1' }, resultat: resultat([1, 2, 3]), corpsChaine: corps, produits: P3, version: vTrois }) || {}).idProduct, 1);
    H.v('   groupe + lecture qui ne sépare pas : rien', consulterProbable({ cfg, entree, resultat: resultat([1, 2]), corpsChaine: corps, produits: mapDe({ 1: ligne(), 2: ligne() }), version: vGroupe, etat }), null);
    // le COSINUS MINIMAL du 1er candidat (V2_PROBABLE_COSINUS_MIN) : sous le seuil (cosinus CONNU) pas de probable ; au-dessus oui ; sans cosinus la garde se tait ; 0 = éteinte
    const dc = (cosinus, cosinusMin) => D({ ids: [1, 2], produits: P2, lu: lu(), cosinus, cosinusMin });
    const c9 = { 1: 0.4, 2: 0.2 };
    H.v('cosinus minimal : 1er à 0,40 sous un seuil de 0,50 : rien ; au seuil de 0,40 ou 0,30 : probable ; éteint (0) : probable', [dc(id => c9[id], 0.5), (dc(id => c9[id], 0.4) || {}).idProduct, (dc(id => c9[id], 0.3) || {}).idProduct, (dc(id => c9[id], 0) || {}).idProduct], [null, 1, 1, 1]);
    H.v('   sans cosinus (aucun vecteur) la garde se tait : probable', (dc(null, 0.9) || {}).idProduct, 1);
    H.v('   la config : V2_PROBABLE_COSINUS_MIN par défaut 0,38 (la garde retenue), 0 l\'éteint, refuse « abc », « 1,5 », « -1 »', [require('../config').lireConfig({ MONGODB_BASE: 'test_scratch' }).probableCosinusMin, require('../config').lireConfig({ MONGODB_BASE: 'test_scratch', V2_PROBABLE_COSINUS_MIN: '0' }).probableCosinusMin, ...['abc', '1.5', '-1'].map(v => { try { require('../config').lireConfig({ MONGODB_BASE: 'test_scratch', V2_PROBABLE_COSINUS_MIN: v }); return 'accepté'; } catch { return 'refusé'; } })], [0.38, 0, 'refusé', 'refusé', 'refusé']);
    // VECTEUR EXIGÉ : un probable demande un cosinus mesuré pour le 1er candidat
    const dv = (cosinus, vecteurExige) => D({ ids: [1, 2], produits: P2, lu: lu(), cosinus, vecteurExige });
    H.v('vecteur exigé : sans cosinus (aucun vecteur) : rien ; avec un cosinus mesuré : probable ; non exigé : probable sans cosinus', [dv(null, true), (dv(id => ({ 1: 0.9, 2: 0.2 })[id], true) || {}).idProduct, (dv(null, false) || {}).idProduct], [null, 1, 1]);
    H.v('   le 1er sans cosinus alors que le rival en a un : exigé = rien', dv(id => ({ 2: 0.9 })[id] ?? null, true), null);
    H.v('   la config : V2_PROBABLE_VECTEUR_EXIGE par défaut vrai, « 0 » l\'éteint, « 2 » invalide', [require('../config').lireConfig({ MONGODB_BASE: 'test_scratch' }).probableVecteurExige, require('../config').lireConfig({ MONGODB_BASE: 'test_scratch', V2_PROBABLE_VECTEUR_EXIGE: '0' }).probableVecteurExige, (() => { try { require('../config').lireConfig({ MONGODB_BASE: 'test_scratch', V2_PROBABLE_VECTEUR_EXIGE: '2' }); return 'accepté'; } catch { return 'refusé'; } })()], [true, false, 'refusé']);
    // ── TOUR 3 : GARDES FERMÉES PAR DÉFAUT (une garde s'écrit par ce qu'elle AUTORISE) : sans option, vecteur exigé et cosinus minimal 0,38 ; 0 explicite seul éteint le seuil ; `false` explicite seul lève l'exigence
    const nu = o => P.decider({ ids: [1, 2], produits: P2, lu: lu(), ...o });
    H.v('défauts fermés : decider SANS options ni cosinus : rien (candidat sans vecteur)', nu({}), null);
    H.v('   cosinus 0,90 : probable ; cosinus 0,20 (sous 0,38) : rien', [(nu({ cosinus: id => ({ 1: 0.9, 2: 0.1 })[id] }) || {}).idProduct, nu({ cosinus: id => ({ 1: 0.2, 2: 0.1 })[id] })], [1, null]);
    H.v('   seuil absent / NaN / null / texte = 0,38 (jamais éteint) ; 0 explicite l\'éteint', [NaN, null, undefined, 'x'].map(m => nu({ cosinus: id => ({ 1: 0.2, 2: 0.1 })[id], cosinusMin: m })), [null, null, null, null]);
    H.v('   0 explicite éteint le seuil (vecteur toujours exigé) ; vecteurExige false explicite lève l\'exigence ; undefined / null / 0 / "non" ne la lèvent PAS', [(nu({ cosinus: id => ({ 1: 0.2, 2: 0.1 })[id], cosinusMin: 0 }) || {}).idProduct, (nu({ vecteurExige: false }) || {}).idProduct, ...[undefined, null, 0, 'non'].map(v => nu({ vecteurExige: v }))], [1, 1, null, null, null, null]);
    const cfgSans = { probable: true, versionMinProbable: '2.0.1', empreinteExtension: true, modeleEmpreinte: MODELE };      // les champs de garde MANQUENT
    H.v('   la route avec une config SANS ces champs : un candidat sans vecteur est bloqué (vecteur exigé, jamais ouvert par un champ absent)', consulterProbable({ cfg: cfgSans, entree: { versionExtension: '2.0.1' }, resultat: resultat([1, 2]), corpsChaine: corps, produits: P2, version: vDistinct }), null);
    H.v('   et la même route avec la garde explicitement OUVERTE donne un probable (le témoin)', (consulterProbable({ cfg: { ...cfgSans, probableVecteurExige: false, probableCosinusMin: 0 }, entree: { versionExtension: '2.0.1' }, resultat: resultat([1, 2]), corpsChaine: corps, produits: P2, version: vDistinct }) || {}).idProduct, 1);
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
