'use strict';
// SUR-PAR-IMAGE — la DÉCISION de la route (sur-par-image-route.js), sans base ni réseau : l'index d'empreintes est FABRIQUÉ (_empreinte-aide.js), l'archive est une FAUSSE version, la chaîne héritée et l'affirmation sont
// FABRIQUÉES. Ce que le banc tient : éteint (l'un des deux drapeaux), RIEN n'est lu ni appelé ; allumé, seule une QUESTION peut devenir l'affirmation du candidat le plus proche de la photo, et chaque condition de la règle
// l'empêche quand elle manque ; toute autre issue rend la réponse d'avant (null ou une trace « se tait »). Aucun appel payant, aucun fichier du testeur.
const H = require('./_harnais');
const A = require('./_empreinte-aide');
const { lireConfig } = require('../config');
const V = require('../identifier/voisins-empreinte');
const { consulterSurParImage } = require('../identifier/sur-par-image-route');
const { preparerVecteur } = V;
const etat = require('../identifier/etat-empreintes');

const cfgOn = lireConfig({ ...A.ENV_EMPREINTE, V2_SUR_PAR_IMAGE: '1' });
const cfgSansImage = lireConfig(A.ENV_EMPREINTE);
const cfgSansEmpreinte = lireConfig({ MONGODB_BASE: 'test_scratch', V2_SUR_PAR_IMAGE: '1' });
const CLE = { [A.ID_A]: 'banc/jeu-5.webp', [A.ID_X]: 'banc/jeu-4.webp', [A.ID_P]: 'banc/jeu-3.webp', [A.ID_B]: 'banc/jeu-10.webp' };
let appelsVersion = 0;
// une archive en mémoire : chaque produit a SA métacarte, sa vignette, sa grande image, et n'est pas en basse définition ; `ent` surcharge une entrée (basseDefinition, grande, vignette, idMetacard)
const version = ({ ent = {}, empr = {}, ...over } = {}) => ({
    entree: id => { appelsVersion++; return CLE[id] ? { grande: { cle: CLE[id] }, vignette: { cle: `v/${id}.webp` }, idMetacard: 5000 + id, basseDefinition: false, mention: null, ...(ent[id] || {}) } : null; },
    empruntDe: id => (empr[id] === undefined ? false : empr[id]),      // le point de branchement du lot MARQUE-EMPRUNT : version.empruntDe(id) -> true | false | null
    identifiants: () => Object.keys(CLE).map(Number), colonneMarquages: true, partagesDe: () => [], ...over });
const ligne = (id, numero) => ({ idProduct: id, numero, total: '064', set: { code: 'PBL' }, tirageSource: 'intl', marques: [] });
const produits = () => new Map([[A.ID_A, ligne(A.ID_A, '001')], [A.ID_X, ligne(A.ID_X, '002')], [A.ID_P, ligne(A.ID_P, '003')]]);
const question = ids => ({ issue: 'question', analyse: { cartes: [{ statut: 'a-trancher', candidats: ids.map(idProduct => ({ idProduct })) }] } });
const entreeAvec = (i, { redressee = true, modele = A.modeleAnnonce() } = {}) => {
    const corps = { modeleEmpreinte: modele, empreintes: [A.entree(0, i, redressee, false)] };
    return { empreintes: V.lireEnveloppe(corps, 1) };
};
let affirmes = [];
const affirmer = (id, _s, critere) => { affirmes.push([id, critere]); return { issue: 'affirmee', analyse: { cartes: [{ statut: 'identifiee', carte: { idProduct: id } }] }, critere }; };
const appel = (over = {}) => consulterSurParImage({
    cfg: cfgOn, entree: entreeAvec(5), resultat: question([A.ID_A, A.ID_X]), corpsChaine: { success: true, candidats: [{ idProduct: A.ID_A }, { idProduct: A.ID_X }], carte: { ambigu: true } }, produits: produits(), version: version(),
    jumeaux: () => ({ conclu: true, ids: [] }), affirmer, ...over
});

(async () => {
    A.installerIndex();
    // ── (1) EN PREMIER : éteint, rien n'est lu ni appelé
    appelsVersion = 0; affirmes = [];
    H.v('1a. V2_SUR_PAR_IMAGE éteint : null, la version n\'est pas lue, rien n\'est affirmé', [await appel({ cfg: cfgSansImage }), appelsVersion, affirmes.length], [null, 0, 0]);
    H.v('1b. V2_EMPREINTE_EXTENSION éteint (le seul V2_SUR_PAR_IMAGE allumé) : null, rien n\'est lu', [await appel({ cfg: cfgSansEmpreinte }), appelsVersion, affirmes.length], [null, 0, 0]);
    H.v('1b2. … même avec la version du modèle encore en configuration : seul le drapeau compte', [await appel({ cfg: { ...cfgOn, empreinteExtension: false } }), appelsVersion, affirmes.length], [null, 0, 0]);
    let refuse = false; try { lireConfig({ MONGODB_BASE: 'test_scratch', V2_SUR_PAR_IMAGE: 'oui' }); } catch { refuse = true; }
    H.v('1c. la configuration livrée n\'allume pas la règle ; « 1 » l\'allume ; toute autre valeur est refusée (comme les autres drapeaux)', [lireConfig({ MONGODB_BASE: 'test_scratch' }).surParImage, lireConfig({ MONGODB_BASE: 'test_scratch', V2_SUR_PAR_IMAGE: '1' }).surParImage, refuse], [false, true, true]);
    // ── (2) le cas vert : une question devient l'affirmation du candidat le plus proche
    {
        const r = await appel();
        H.v('2a. question [A, X], vecteur de la photo = visuel de A : A est affirmé', [r.resultat && r.resultat.issue, r.resultat && r.resultat.analyse.cartes[0].carte.idProduct, r.trace.issue], ['affirmee', A.ID_A, 'sur']);
        H.vrai('2b. le critère journalisé NOMME le périmètre de la règle', affirmes.length === 1 && /sur par l'image : seul candidat de la question/.test(affirmes[0][1]));
        H.vrai('2c. la trace nomme l\'écart, le cosinus et les candidats jugés', r.trace.ecart >= 0.2 && r.trace.cosinus > 0.9 && r.trace.candidats.join() === [A.ID_A, A.ID_X].join());
    }
    // ── (3) seule une QUESTION est relue
    const cands = [{ idProduct: A.ID_A }, { idProduct: A.ID_X }];       // même avec deux candidats lisibles, seule l'ISSUE « question » compte
    for (const [nom, res] of [['un sûr', { issue: 'affirmee', analyse: { cartes: [{ carte: { idProduct: A.ID_A }, candidats: cands }] } }], ['un introuvable', { issue: 'introuvable', analyse: { cartes: [{ candidats: cands }] } }], ['une panne', { issue: 'panne', analyse: { cartes: [{ candidats: cands }] } }],
        ['une question de la garde des jumeaux (motif)', { ...question([A.ID_A, A.ID_X]), motif: 'impression-indeterminee' }], ['une question par contradiction de champ', { ...question([A.ID_A, A.ID_X]), contradiction: 'numéro' }]]) {
        affirmes = []; appelsVersion = 0;
        H.v(`3. ${nom} : null, rien lu, rien affirmé`, [await appel({ resultat: res }), appelsVersion, affirmes.length], [null, 0, 0]);
    }
    {
        affirmes = [];
        const lot = { issue: 'question', analyse: { cartes: [question([A.ID_A, A.ID_X]).analyse.cartes[0], question([A.ID_A, A.ID_X]).analyse.cartes[0]] } };
        H.v('3b. un lot (deux cartes) : null', [await appel({ resultat: lot }), affirmes.length], [null, 0]);
        H.v('3c. une question à un seul candidat : null', await appel({ resultat: question([A.ID_A]), corpsChaine: { success: true, candidats: [{ idProduct: A.ID_A }] } }), null);
    }
    // ── (4) chaque condition de la règle l'empêche, à travers la route
    const se_tait = async (nom, over, motif) => { affirmes = []; const r = await appel(over); H.v(`4. ${nom}`, [r && !r.resultat, r && r.trace && r.trace.motif, affirmes.length], [true, motif, 0]); };
    await se_tait('(0) vecteur de la photo non redressée : se tait', { entree: entreeAvec(5, { redressee: false }) }, 'photo-non-redressee');
    await se_tait('(1) un candidat sans entrée d\'archive : se tait', { version: version({ entree: id => (id === A.ID_X ? null : { grande: { cle: CLE[id] } }) }) }, 'donnee-manquante');
    await se_tait('(1) un candidat CACHÉ de la chaîne (hors des 3 choix) sans archive : se tait', { corpsChaine: { success: true, candidats: [{ idProduct: A.ID_A }, { idProduct: A.ID_X }, { idProduct: 777001 }], carte: { ambigu: true } } }, 'donnee-manquante');
    await se_tait('(3) le voisin n°1 de la photo n\'est pas le candidat (vecteur de jeu-3, candidats A et X) : se tait', { entree: entreeAvec(3) }, 'pas-voisin-n1');
    await se_tait('(5) écart insuffisant (deux candidats au même vecteur : jeu-10 et son jumeau jeu-11 ne sont pas dans un groupe pour ces clés) : se tait', { entree: entreeAvec(10), resultat: question([A.ID_B, A.ID_X]), corpsChaine: { success: true, candidats: [{ idProduct: A.ID_B }, { idProduct: A.ID_X }] },
        version: version({ ent: { [A.ID_X]: { grande: { cle: 'banc/jeu-11.webp' } } } }), produits: new Map([[A.ID_B, ligne(A.ID_B, '001')], [A.ID_X, ligne(A.ID_X, '002')]]) }, 'meme-dessin');
    // (7) les signaux d'un visuel suspect, lus dans l'archive en mémoire
    await se_tait('(7) le MEILLEUR (A) est en basse définition dans l\'archive : se tait', { version: version({ ent: { [A.ID_A]: { basseDefinition: true } } }) }, 'visuel-suspect');
    await se_tait('(7) 🔴 la version n\'a PAS la marque d\'emprunt (`empruntDe` absente : archive d\'aujourd\'hui) : la règle se tait sur toute la question', { version: version({ empruntDe: undefined }) }, 'emprunt-inconnu');
    await se_tait('(7) la marque dit « emprunté » pour A : se tait', { version: version({ empr: { [A.ID_A]: true } }) }, 'visuel-suspect');
    await se_tait('(7) la marque dit « emprunté » pour le RIVAL X : se tait', { version: version({ empr: { [A.ID_X]: true } }) }, 'visuel-suspect');
    await se_tait('(7) la marque est inconnue (null) pour A : se tait', { version: version({ empr: { [A.ID_A]: null } }) }, 'visuel-suspect');
    await se_tait('(7) la marque dit « propre » mais la mention du texte dit le contraire (deux sources en conflit) : se tait', { version: version({ ent: { [A.ID_A]: { mention: 'Visuel de la même carte dans un autre tirage (X) — pas celui de ce set' } } }) }, 'visuel-suspect');
    await se_tait('(7) A porte la mention « visuel de la même carte dans un autre tirage » (cas Classic) : se tait', { version: version({ ent: { [A.ID_A]: { mention: 'Visuel de la même carte dans un autre tirage (Base Set n°97) — pas celui de ce set' } } }) }, 'visuel-suspect');
    await se_tait('(7) … ou le RIVAL (X) la porte : se tait', { version: version({ ent: { [A.ID_X]: { mention: 'Visuel de la même carte dans un autre tirage (X) — pas celui de ce set' } } }) }, 'visuel-suspect');
    await se_tait('(7) … toute autre mention aussi (défaut fermé, quel qu\'en soit le texte)', { version: version({ ent: { [A.ID_A]: { mention: 'autre' } } }) }, 'visuel-suspect');
    await se_tait('(7) champ `mention` absent de l\'entrée (undefined) : inconnu, défaut fermé', { version: version({ ent: { [A.ID_A]: { mention: undefined } } }) }, 'visuel-suspect');
    await se_tait('(7) un RIVAL (X) est en basse définition : se tait', { version: version({ ent: { [A.ID_X]: { basseDefinition: true } } }) }, 'visuel-suspect');
    await se_tait('(7) archive SANS la colonne des marquages (champ basseDefinition inexistant) : inconnu, défaut fermé', { version: version({ colonneMarquages: false, ent: { [A.ID_A]: { basseDefinition: null }, [A.ID_X]: { basseDefinition: null } } }) }, 'visuel-suspect');
    {
        affirmes = [];
        const r = await appel({ version: version({ ent: { [A.ID_A]: { basseDefinition: null }, [A.ID_X]: { basseDefinition: null } } }) });
        H.v('(7) archive avec la colonne, basseDefinition null (le producteur n\'écrit jamais false : « non signalé ») : le sûr tient', [r.resultat && r.resultat.issue], ['affirmee']);
    }
    await se_tait('(7) cas Masaki : le fichier de A est AUSSI celui d\'un produit d\'une autre métacarte (P) : se tait', { version: version({ ent: { [A.ID_P]: { vignette: { cle: `v/${A.ID_A}.webp` } } } }) }, 'visuel-suspect');
    await se_tait('(7) … ou sa grande image', { version: version({ ent: { [A.ID_P]: { grande: { cle: 'banc/jeu-5.webp' } } } }) }, 'visuel-suspect');
    await se_tait('(7) un RIVAL (X) partage son fichier avec une autre métacarte : se tait', { version: version({ ent: { [A.ID_P]: { vignette: { cle: `v/${A.ID_X}.webp` } } } }) }, 'visuel-suspect');
    await se_tait('(7) métacarte inconnue du côté du partage : défaut fermé', { version: version({ ent: { [A.ID_P]: { vignette: { cle: `v/${A.ID_A}.webp` }, idMetacard: null } } }) }, 'visuel-suspect');
    await se_tait('(7) métacarte du candidat inconnue ET fichier partagé : défaut fermé', { version: version({ ent: { [A.ID_A]: { idMetacard: null }, [A.ID_P]: { vignette: { cle: `v/${A.ID_A}.webp` } } } }) }, 'visuel-suspect');
    await se_tait('(7) archive sans index des produits (pas de `identifiants`) : défaut fermé', { version: version({ identifiants: undefined }) }, 'visuel-suspect');
    {
        affirmes = [];
        const r = await appel({ version: version({ ent: { [A.ID_P]: { vignette: { cle: `v/${A.ID_A}.webp` }, idMetacard: 5000 + A.ID_A } } }) });
        H.v('(7) un produit de la MÊME métacarte au même fichier n\'est pas « un autre dessin » (c\'est le domaine des partages de l\'archive) : le sûr tient', [r.resultat && r.resultat.issue], ['affirmee']);
        // l'EXCLUSION simulée : un produit exclu n'a AUCUNE entrée d'archive (calcul.js) ; un visuel emprunté est refusé à la construction (decision.js) : même chose, la condition (1)
        const r2 = await appel({ version: version({ entree: id => (id === A.ID_X ? null : version().entree(id)) }) });
        H.v('(7) un produit exclu / au visuel refusé (aucune entrée) : se tait (donnee-manquante)', r2.trace.motif, 'donnee-manquante');
    }
    await se_tait('(+) partages de l\'archive : se tait', { version: version({ partagesDe: () => [A.ID_P] }) }, 'visuel-partage');
    await se_tait('(+) colonne des partages absente : se tait', { version: version({ colonneMarquages: false }) }, 'visuel-partage');
    await se_tait('(6) un champ lu contredit le désigné (numéro lu 002, A porte 001) : se tait',
        { corpsChaine: { success: true, candidats: [{ idProduct: A.ID_A }, { idProduct: A.ID_X }], carte: { ambigu: true, numero: '002' }, lectureGarde: { numero: '002' } } }, 'contredit');
    await se_tait('(6) marques lues sur la photo alors que A n\'en porte aucune : se tait', { marquesLues: ['staff'] }, 'marques');
    await se_tait('(+) un jumeau de A hors de la question : se tait', { jumeaux: () => ({ conclu: true, ids: [A.ID_A, 777002] }) }, 'jumeaux');
    await se_tait('(+) jumeaux non conclus : se tait', { jumeaux: () => ({ conclu: false, ids: [] }) }, 'jumeaux');
    await se_tait('(+) A absent du catalogue de l\'API : se tait', { produits: new Map([[A.ID_X, ligne(A.ID_X, '002')]]) }, 'donnee-manquante');
    // ── (5) le vecteur : même vérification que la règle G
    for (const [nom, e] of [['modèle inconnu', entreeAvec(5, { modele: { id: 'autre', sha256: '1'.repeat(64) } })], ['sans enveloppe', {}], ['enveloppe rejetée', { empreintes: { rejet: 'enveloppe', modele: A.modeleAnnonce(), entrees: [] } }]]) {
        affirmes = [];
        H.v(`5. ${nom} : null, rien affirmé`, [await appel({ entree: e }), affirmes.length], [null, 0]);
    }
    {   // pas d'index en place
        const sauve = etat.courante(); etat.vider();
        affirmes = [];
        H.v('5b. aucun index en place : null', [await appel(), affirmes.length], [null, 0]);
        etat.installer(sauve);
    }
    // ── (6) l'affirmation elle-même
    {
        let r = await appel({ affirmer: () => { throw new Error('produit absent'); } });
        H.v('6a. l\'affirmation lève : la question reste (trace non-construite)', [r.resultat, r.trace.issue], [undefined, 'non-construite']);
        r = await appel({ affirmer: id => ({ issue: 'affirmee', analyse: { cartes: [{ carte: { idProduct: id + 1 } }] } }) });
        H.v('6b. l\'affirmation porte un AUTRE produit : refusée', [r.resultat, r.trace.issue], [undefined, 'non-construite']);
        r = await appel({ affirmer: id => ({ issue: 'question', analyse: { cartes: [{ carte: { idProduct: id } }] } }) });
        H.v('6c. l\'affirmation rend autre chose qu\'une affirmation : refusée', [r.resultat, r.trace.issue], [undefined, 'non-construite']);
        H.v('6d. une exception dans le journal ou la version ne sort jamais : null', await appel({ version: { entree: () => { throw new Error('x'); } } }), null);
    }
    // ── (7) preparerVecteur : la vérification unique du vecteur, partagée avec la règle G
    {
        const voulu = { id: A.MODELE.id, sha256: A.MODELE.sha256 };
        const p = preparerVecteur({ entree: entreeAvec(5), voulu, etat });
        H.v('7a. un vecteur valide rend le vecteur, ses 10 voisins (le premier est jeu-5) et l\'index', [p.ok, p.trouve.top.length, p.trouve.top[0][0], p.v.vecteur.length], [true, 10, 'banc/jeu-5.webp', 256]);
        H.v('7b. sans version attendue : modele-inconnu', preparerVecteur({ entree: entreeAvec(5), voulu: null, etat }).code, 'modele-inconnu');
        H.v('7c. un vecteur de bruit : invalide', preparerVecteur({ entree: { empreintes: V.lireEnveloppe({ modeleEmpreinte: A.modeleAnnonce(), empreintes: [{ photo: 0, vecteur: 'A'.repeat(683) + '=', redressee: true }] }, 1) }, voulu, etat }).code, 'invalide');
    }
    // ── (8) IndexEmpreintes.similarites : le même cosinus que la recherche, null pour une clé inconnue
    {
        const idx = etat.courante().index, q = A.ligneDe(5);
        const [s5, s4, sx, sn] = idx.similarites(q, ['banc/jeu-5.webp', 'banc/jeu-4.webp', 'cle/inconnue.webp', 42]);
        const v = idx.voisins(q, 1);
        H.v('8a. la similarité de la ligne 5 avec elle-même est le meilleur cosinus de la recherche (arrondi 4 décimales)', Math.round(s5 * 1e4) / 1e4, v.top[0][1]);
        H.vrai('8b. une autre ligne est loin (< 0,3) ; une clé inconnue ou non textuelle rend null', s4 < 0.3 && sx === null && sn === null);
        let leve = false; try { idx.similarites(new Float32Array(3), ['a']); } catch { leve = true; }
        H.v('8c. un vecteur de mauvaise taille lève (ENTREE_INDEX), jamais un nombre', leve, true);
    }
    H.bilan();
})().catch(e => { console.error(e); process.exit(1); });
