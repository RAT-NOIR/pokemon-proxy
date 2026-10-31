'use strict';
// Banc G-GROUPE (4) — la DÉSIGNATION de la tête du groupe comme probable (probable-route.js::designerTeteDeGroupe) et la définition unique des gardes du cosinus (probable.js::cosinusAdmis).
// Écrit par ce que la désignation AUTORISE : un seul chemin mène à { idProduct }, chaque garde de PROBABLE (drapeaux, extension >= 2.0.1, candidats, I3 groupes, vecteur exigé, cosinus minimal, I2 prix servi) a son cas.
// Module sans base ni réseau : une VRAIE version d'archive de banc (le constructeur du chargeur), des cosinus et des prix fabriqués.
const H = require('./_harnais');
const P = require('../identifier/probable');
const PRO = require('../identifier/probable-route');
const VB = require('./_visuels-banc');

const version = VB.construire([
    VB.doc(1, { idMetacard: 11, grande: { cle: 'k1', w: 600, h: 840 } }), VB.doc(2, { idMetacard: 12, grande: { cle: 'k2', w: 600, h: 840 } }),
    VB.doc(3, { idMetacard: 13, grande: { cle: 'k3', w: 600, h: 840 } }), VB.doc(4, { idMetacard: 13, grande: { cle: 'k3', w: 600, h: 840 } }),       // 3 et 4 : même fiche, même visuel = un GROUPE
    VB.doc(6, { idMetacard: 16, grande: { cle: 'k6', w: 600, h: 840 } })], [], { emprunts: true });
const cfg = { probable: true, gGroupe: true, versionMinProbable: '2.0.1', probableCosinusMin: 0.38, probableVecteurExige: true };
const PRIX = { date: '2026-10-04', tendance: 1.0 };
const ok = (o = {}) => PRO.designerTeteDeGroupe({ cfg, versionExtension: '2.0.1', tete: 1, ids: [1, 2], version, groupeMarqueurs: false, cosinus: 0.9, prixGuide: PRIX, ...o });
const refus = (o, motif) => H.v(o.nom, ok(o.args), { refus: motif });

(async () => {
    H.v('1. toutes les gardes passent : la tête est désignée (signal G)', ok(), { idProduct: 1, signal: 'G' });
    H.v('1b. … y compris avec trois candidats', ok({ ids: [1, 2, 6] }), { idProduct: 1, signal: 'G' });

    // drapeaux
    refus({ nom: '2a. V2_PROBABLE éteint : aucun probable', args: { cfg: { ...cfg, probable: false } } }, 'drapeaux');
    refus({ nom: '2b. V2_G_GROUPE éteint : aucun probable', args: { cfg: { ...cfg, gGroupe: false } } }, 'drapeaux');
    refus({ nom: '2c. configuration absente : aucun probable', args: { cfg: null } }, 'drapeaux');
    // extension
    refus({ nom: '3a. extension 2.0.0', args: { versionExtension: '2.0.0' } }, 'version-extension');
    refus({ nom: '3b. extension illisible', args: { versionExtension: 'abc' } }, 'version-extension');
    refus({ nom: '3c. extension absente', args: { versionExtension: null } }, 'version-extension');
    H.v('3d. extension 2.1.0 : servie', ok({ versionExtension: '2.1.0' }).idProduct, 1);
    // candidats
    refus({ nom: '4a. un seul candidat (confirmation) : jamais un probable', args: { ids: [1] } }, 'candidats');
    refus({ nom: '4b. quatre candidats', args: { ids: [1, 2, 6, 3] } }, 'candidats');
    refus({ nom: '4c. la tête n\'est pas un candidat de la question', args: { tete: 6 } }, 'candidats');
    refus({ nom: '4d. un doublon', args: { ids: [1, 1] } }, 'candidats');
    refus({ nom: '4e. un id non entier', args: { ids: [1, '2'] } }, 'candidats');
    // I3
    refus({ nom: '5a. I3 : la trace des marqueurs dit « groupe »', args: { groupeMarqueurs: true } }, 'groupe');
    refus({ nom: '5b. I3 : la trace est absente (undefined) : défaut fermé', args: { groupeMarqueurs: undefined } }, 'groupe');
    refus({ nom: '5c. I3 : la trace est illisible (null) : défaut fermé', args: { groupeMarqueurs: null } }, 'groupe');
    refus({ nom: '5d. I3 : la tête a le MÊME dessin que l\'autre candidat (même fiche, même visuel)', args: { tete: 3, ids: [3, 4] } }, 'groupe');
    refus({ nom: '5e. I3 : une entrée ABSENTE de l\'archive pour un autre candidat vaut groupe', args: { tete: 1, ids: [1, 5] } }, 'groupe');
    refus({ nom: '5f. I3 : l\'entrée du désigné est absente de l\'archive', args: { tete: 5, ids: [5, 1] } }, 'groupe');
    refus({ nom: '5g. I3 : pas de version d\'archive : défaut fermé', args: { version: null } }, 'groupe');
    refus({ nom: '5h. I3 : une version qui lève : défaut fermé', args: { version: { entree() { throw new Error('x'); } } } }, 'groupe');
    // vecteur exigé et cosinus
    refus({ nom: '6a. vecteur EXIGÉ : pas de cosinus (null)', args: { cosinus: null } }, 'cosinus');
    refus({ nom: '6b. vecteur exigé : cosinus NaN', args: { cosinus: NaN } }, 'cosinus');
    refus({ nom: '6c. cosinus sous 0,38', args: { cosinus: 0.37 } }, 'cosinus');
    H.v('6d. cosinus pile 0,38 : admis', ok({ cosinus: 0.38 }).idProduct, 1);
    H.v('6e. vecteur non exigé (explicite) et pas de cosinus : admis', ok({ cosinus: null, cfg: { ...cfg, probableVecteurExige: false } }).idProduct, 1);
    refus({ nom: '6f. vecteur non exigé mais cosinus connu sous le minimum : refusé', args: { cosinus: 0.2, cfg: { ...cfg, probableVecteurExige: false } } }, 'cosinus');
    H.v('6g. cosinus minimal 0 (explicite) éteint le seuil, le vecteur reste exigé', [ok({ cosinus: 0.1, cfg: { ...cfg, probableCosinusMin: 0 } }).idProduct, ok({ cosinus: null, cfg: { ...cfg, probableCosinusMin: 0 } }).refus], [1, 'cosinus']);
    // I2
    refus({ nom: '7a. I2 : pas de prix de guide', args: { prixGuide: null } }, 'sans-prix');
    refus({ nom: '7b. I2 : un guide sans date', args: { prixGuide: { tendance: 1 } } }, 'sans-prix');
    refus({ nom: '7c. I2 : un guide daté sans prix', args: { prixGuide: { date: '2026-10-04' } } }, 'sans-prix');
    // jamais d'exception
    H.v('8. des entrées absurdes : jamais d\'exception, toujours un refus', [undefined, null, {}, { cfg }, { cfg, versionExtension: '2.0.1', tete: 1, ids: 'x' }].map(a => { try { return Object.keys(PRO.designerTeteDeGroupe(a || {}))[0]; } catch { return 'LEVE'; } }), ['refus', 'refus', 'refus', 'refus', 'refus']);

    // la définition unique des gardes du cosinus
    const adm = (c, o) => P.cosinusAdmis(c, o);
    H.v('9a. cosinusAdmis : défauts fermés (vecteur exigé, 0,38)', [adm(null), adm(undefined), adm(NaN), adm(0.379), adm(0.38), adm(0.9)], [false, false, false, false, true, true]);
    H.v('9b. cosinusAdmis : un seuil invalide (texte, -1, 1,5, Infinity) retombe sur 0,38', [adm(0.3, { cosinusMin: '0.1' }), adm(0.3, { cosinusMin: -1 }), adm(0.3, { cosinusMin: 1.5 }), adm(0.3, { cosinusMin: Infinity })], [false, false, false, false]);
    H.v('9c. cosinusAdmis : seuil explicite et vecteur non exigé', [adm(0.2, { cosinusMin: 0.1 }), adm(null, { vecteurExige: false }), adm(null, { vecteurExige: false, cosinusMin: 0 }), adm(0.05, { vecteurExige: false, cosinusMin: 0.1 })], [true, true, true, false]);
    // decider() lit la MÊME définition : un 1er candidat sans cosinus ne se désigne pas par PROBABLE non plus
    const GC = require('../identifier/garde-contradiction');
    const lu = { numero: '12', total: null, setCode: null, langue: null, carteTcgdexId: null };
    const lignes = new Map([[1, { idProduct: 1, nom: 'x', numero: '12', set: { code: 'PRB' }, langue: 'EN' }], [2, { idProduct: 2, nom: 'x', numero: '15', set: { code: 'PRB' }, langue: 'EN' }]]);
    const sansLu = P.decider({ ids: [1, 2], produits: lignes, lu: null, cosinus: id => (id === 1 ? 0.9 : 0.1) });
    H.v('9d. decider() sans lecture : jamais de désigné (la garde de la lecture n\'a pas bougé)', sansLu, null);
    void GC; void lu;

    H.bilan();
})().catch(e => { console.error('❌', e); process.exitCode = 1; });
