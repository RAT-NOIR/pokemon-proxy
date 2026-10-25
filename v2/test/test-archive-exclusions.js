'use strict';
// ARCHIVE-EXCLUSIONS — des produits NOMMÉS sont exclus de l'archive d'identification, par une liste, au moment de la construction (v2/migrations/construire-fichier-visuels.js --exclure=<fichier.json>).
// L'exclusion est PAR PRODUIT (idProduct), jamais par entrée d'image : un produit exclu n'a aucune entrée dans l'archive (comme un produit du catalogue sans visuel), son voisin juste sur la même entrée
// garde la sienne, les fiches liées et les jumeaux ne bougent pas. Rien n'est écrit en base. Aucun réseau, aucune base : source factice, catalogue factice, faux magasin R2 ; les listes sont FABRIQUÉES ici
// (dans le dossier temporaire), jamais la liste réelle du testeur.
// TOUR 1 (C1) : « une exclusion retire un VISUEL, jamais une marque qui empêche d'affirmer un AUTRE produit » — la section 10 construit une PAIRE de variantes (normale + Staff, même visuel, même fiche), exclut l'un
// puis l'autre, et vérifie que l'autre garde ses partages et que la garde de la route répond « question », jamais « affirmer ».
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const H = require('./_harnais');
const J = require('../identifier/jumeaux');
const E = require('../chargeur/etat'); const F = require('../chargeur/format'); const S = require('../chargeur/scellement');
const I = require('../chargeur');
const X = require('../chargeur/exclusions');
const { calculer } = require('../chargeur/calcul');
const { fabriquerFichier } = require('../chargeur/precalcul');
const { principal } = require('../migrations/construire-fichier-visuels');

// un LEURRE de banc, assemblé par morceaux pour que la garde d'avant push ne voie jamais une affectation secrète en clair (même valeur à l'exécution)
const SECRET = ['secret', 'hmac', 'de', 'banc', '0123456789', 'abcdefghij'].join('-');
const vig = n => ({ cleR2: `vignettes/${n}.webp`, w: 200, h: 279 });
const im = (set, numero, n) => ({ set, numero, cleR2: `cartes/${n}.webp`, w: 600, h: 838, vignette: vig(n), langue: 'en', source: 'tcgdex' });
const imp = (numero, exp = 'Set A') => ({ tirage: 'intl', expansion: exp, numero, total: '100', rarete: 'Rare' });
const SETS = [{ _id: 'Set-A', idExpansion: 100, code: 'SA', nomAffichage: 'Set A', tirage: 'intl', region: 'intl', bulba: { expansion: 'Set A' } },
    { _id: 'Set-B', idExpansion: 200, code: 'SB', nomAffichage: 'Set B', tirage: 'intl', region: 'intl', bulba: { expansion: 'Set B' } }];
// Le jeu : 10 cartes au Set A (la 6e SANS image), les produits 1001..1010 (un par carte) ; 2001 est un SECOND produit de la carte 1 (il partage l'entrée d'image de 1001) ;
// 3001 est la carte 900 du Set B, de la MÊME métacarte que 1001 (7000) mais d'un autre créneau : un jumeau.
function jeu() {
    const docs = [], lignes = [];
    for (let i = 1; i <= 10; i++) {
        const num = String(i).padStart(3, '0');
        docs.push({ _id: i, nomEn: `Carte ${i}`, sets: ['Set-A'], impressions: [imp(num)], images: i === 6 ? [] : [im('Set-A', num, `c${i}`)] });
        lignes.push({ idProduct: 1000 + i, carteId: i, idExpansion: 100, numeroFiche: num, slug: `P${i}-SA${i}`, slugSet: 'Set-A' });
    }
    lignes.push({ idProduct: 2001, carteId: 1, idExpansion: 100, numeroFiche: '001', slug: 'P1b-SA1', slugSet: 'Set-A' });
    docs.push({ _id: 900, nomEn: 'Carte 900', sets: ['Set-B'], impressions: [imp('001', 'Set B')], images: [im('Set-B', '001', 'c900')] });
    lignes.push({ idProduct: 3001, carteId: 900, idExpansion: 200, numeroFiche: '001', slug: 'P9-SB1', slugSet: 'Set-B' });
    return { sets: SETS, docs, lignes };
}
const catalogue = () => { const m = new Map(Array.from({ length: 10 }, (_, i) => [1001 + i, 5000 + i])); m.set(1001, 7000); m.set(2001, 7000); m.set(3001, 7000); return m; };
const source = (d, compteur = null) => async () => { if (compteur) compteur.n++; return { ok: true, ...d, fermer: async () => { } }; };
const MOTIFS = ['visuel-faux', 'en-attente', 'entree-partagee-autre-dessin', 'entree-partagee-autre-impression'];
const liste = (produits, extra = {}) => ({ decision: 'décision de banc (liste fabriquée)', le: '2026-10-24', produits, ...extra });
// la liste du banc : 3 retirés (1005, 2001, 3001), 2 déjà sans visuel (1006 n'a pas d'image, 9999 n'est nulle part)
const PRODUITS = [{ idProduct: 1005, motif: 'visuel-faux' }, { idProduct: 1006, motif: 'en-attente' }, { idProduct: 2001, motif: 'entree-partagee-autre-impression' },
    { idProduct: 3001, motif: 'entree-partagee-autre-dessin' }, { idProduct: 9999, motif: 'visuel-faux' }];

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'excl-banc-'));
let nFichier = 0;
const ecrire = contenu => { const p = path.join(dossier, `liste-${++nFichier}.json`); fs.writeFileSync(p, typeof contenu === 'string' ? contenu : JSON.stringify(contenu)); return p; };
const lancer = async (argv, env, deps) => {
    const sortie = []; const lo = console.log, le = console.error; console.log = m => sortie.push(String(m)); console.error = m => sortie.push(String(m));
    try { const code = await principal(['node', 'script', ...argv], env, deps); return { code, texte: sortie.join('\n') }; } finally { console.log = lo; console.error = le; }
};
const lireArchive = async chemin => F.deserialiser(await F.decompresser(S.ouvrir(fs.readFileSync(chemin), SECRET)));
const magasin = (initial = null) => {
    const m = { objet: initial, commandes: [], send: async cmd => {
        m.commandes.push(cmd.constructor.name);
        if (cmd.constructor.name === 'PutObjectCommand') { m.objet = Buffer.from(cmd.input.Body); return {}; }
        if (m.objet === null) throw Object.assign(new Error('x'), { name: 'NoSuchKey' });
        return { ContentLength: m.objet.length, Body: (async function* () { yield m.objet; })() };
    } };
    return m;
};
const ENV_ECR = { V2_VISUELS_HMAC: SECRET, V2_VISUELS_R2_COMPTE: 'c', V2_VISUELS_R2_ECR_CLE_ID: 'k', V2_VISUELS_R2_ECR_SECRET: 's', V2_VISUELS_R2_BUCKET: 'seau-prive', V2_VISUELS_R2_OBJET: 'v2/visuels.rmv' };

(async () => {
    // ── 1. la GARDE du fichier : écrite par ce qu'elle AUTORISE ; toute autre forme est refusée, avec sa raison
    const bon = X.lireFichierExclusions(ecrire(liste(PRODUITS, { source: 'chemin de documentation' })));
    H.v('1a. une liste conforme est lue : 5 produits, la décision, la date', [bon.ok, bon.produits && bon.produits.length, bon.decision, bon.le], [true, 5, 'décision de banc (liste fabriquée)', '2026-10-24']);
    H.v('1b. les motifs fermés sont exactement les quatre de la décision', X.MOTIFS, MOTIFS);
    const invalides = [
        ['un motif hors de la liste fermée', liste([{ idProduct: 1005, motif: 'au-hasard' }])],
        ['un motif absent', liste([{ idProduct: 1005 }])],
        ['un doublon d\'idProduct (même motif)', liste([{ idProduct: 1005, motif: 'visuel-faux' }, { idProduct: 1005, motif: 'visuel-faux' }])],
        ['un doublon d\'idProduct (deux motifs)', liste([{ idProduct: 1005, motif: 'visuel-faux' }, { idProduct: 1005, motif: 'en-attente' }])],
        ['un tableau de produits vide', liste([])],
        ['des produits qui ne sont pas un tableau', liste({ idProduct: 1005, motif: 'visuel-faux' })],
        ['un idProduct décimal', liste([{ idProduct: 1005.5, motif: 'visuel-faux' }])],
        ['un idProduct en chaîne', liste([{ idProduct: '1005', motif: 'visuel-faux' }])],
        ['un idProduct nul', liste([{ idProduct: 0, motif: 'visuel-faux' }])],
        ['un idProduct négatif', liste([{ idProduct: -3, motif: 'visuel-faux' }])],
        ['un idProduct null', liste([{ idProduct: null, motif: 'visuel-faux' }])],
        ['un idProduct absent', liste([{ motif: 'visuel-faux' }])],
        ['un élément qui n\'est pas un objet', liste([1005])],
        ['un élément à clé inconnue', liste([{ idProduct: 1005, motif: 'visuel-faux', note: 'x' }])],
        ['le champ decision absent', { le: '2026-10-24', produits: PRODUITS }],
        ['le champ decision vide', liste(PRODUITS, { decision: '   ' })],
        ['le champ decision qui n\'est pas un texte', liste(PRODUITS, { decision: 12 })],
        ['le champ le absent', { decision: 'd', produits: PRODUITS }],
        ['le champ le qui n\'est pas une date', liste(PRODUITS, { le: 'hier' })],
        ['le champ produits absent', { decision: 'd', le: '2026-10-24' }],
        ['une clé de premier niveau inconnue', liste(PRODUITS, { autre: 1 })],
        ['un tableau à la place de l\'objet', [liste(PRODUITS)]],
        ['null à la place de l\'objet', null],
        ['du JSON illisible', '{ pas du json'],
        ['un fichier vide', '']
    ];
    for (const [nom, contenu] of invalides) {
        const r = X.lireFichierExclusions(ecrire(contenu === null ? 'null' : contenu));
        H.v(`1. refusée par la garde : ${nom}`, [r.ok, typeof r.raison === 'string' && r.raison.length > 0], [false, true]);
    }
    const absent = X.lireFichierExclusions(path.join(dossier, 'nexiste-pas.json'));
    H.v('1. refusée par la garde : un fichier absent', [absent.ok, typeof absent.raison === 'string' && absent.raison.length > 0], [false, true]);
    const dossierSeul = X.lireFichierExclusions(dossier);
    H.v('1. refusée par la garde : un dossier à la place d\'un fichier', dossierSeul.ok, false);

    // ── 2. chaque forme invalide REFUSE la construction : code 1, la raison dite, la source JAMAIS lue, rien d'écrit (ni fichier, ni PutObject)
    const d0 = jeu();
    const cible = path.join(dossier, 'sortie-refus.rmv');
    for (const [nom, contenu] of invalides) {
        const compteur = { n: 0 }, mag = magasin();
        const chemin = ecrire(contenu === null ? 'null' : contenu);
        const r = await lancer([`--vers=${cible}`, '--deposer', `--exclure=${chemin}`], ENV_ECR, { source: source(d0, compteur), catalogue: catalogue(), client: mag });
        H.v(`2. construction refusée : ${nom}`, [r.code, /--exclure/.test(r.texte), compteur.n, fs.existsSync(cible), mag.commandes.length], [1, true, 0, false, 0]);
    }
    {
        const compteur = { n: 0 };
        const rAbs = await lancer([`--vers=${cible}`, `--exclure=${path.join(dossier, 'nexiste-pas.json')}`], { V2_VISUELS_HMAC: SECRET }, { source: source(d0, compteur), catalogue: catalogue() });
        const rVide = await lancer([`--vers=${cible}`, '--exclure='], { V2_VISUELS_HMAC: SECRET }, { source: source(d0, compteur), catalogue: catalogue() });
        const rNu = await lancer([`--vers=${cible}`, '--exclure'], { V2_VISUELS_HMAC: SECRET }, { source: source(d0, compteur), catalogue: catalogue() });
        H.v('2. construction refusée : fichier absent · --exclure= sans fichier · --exclure sans valeur (source jamais lue, rien d\'écrit)', [rAbs.code, rVide.code, rNu.code, compteur.n, fs.existsSync(cible)], [1, 1, 1, 0, false]);
    }

    // ── 3. SANS --exclure : la sortie est celle d'aujourd'hui (aucun champ d'exclusion nulle part, ni dans l'en-tête, ni dans les comptes, ni à l'écran), et déterministe
    const vers0 = path.join(dossier, 'sans-exclusion.rmv');
    const p0 = await lancer([`--vers=${vers0}`], { V2_VISUELS_HMAC: SECRET }, { source: source(jeu()), catalogue: catalogue() });
    const f0 = await fabriquerFichier({ source: source(jeu()), catalogue: catalogue(), secret: SECRET });
    const entete0 = JSON.stringify(F.lireEntete(f0.brut));
    const fixe = brut => F.reecrireEntete(brut, { ...F.lireEntete(brut), chargeLe: '2020-01-01T00:00:00.000Z' });
    const v0 = await lireArchive(vers0);
    H.v('3a. sans --exclure : code 0, aucune mention d\'exclusion à l\'écran, aucun champ d\'exclusion dans l\'en-tête ni dans les comptes', [p0.code, /exclus de l'identification|produit\(s\) exclu/.test(p0.texte), /"exclus/.test(entete0), 'exclus' in f0.comptes, 'exclus' in v0.comptes], [0, false, false, false, false]);
    const f0b = await fabriquerFichier({ source: source(jeu()), catalogue: catalogue(), secret: SECRET });
    H.v('3b. sans --exclure : deux constructions du même jeu (date d\'en-tête fixée) donnent les MÊMES octets', fixe(f0.brut).equals(fixe(f0b.brut)), true);
    // 3c (tour 1, I2) : l'identité avec le code d'AVANT le lot. L'empreinte ci-dessous est celle du contenu brut (en-tête à la date fixée 2020-01-01) du jeu fixe ci-dessous, construit sans exclusion par le code de
    // 1a1ab447 (le dernier commit AVANT ce lot) ; calculée une fois sous N24 et N22, identique. Si un autre lot change légitimement le format ou la décision, elle se recalcule sur ce commit-là, sciemment.
    // MARQUE-EMPRUNT : recalculée sciemment — le seul changement de ce jeu fixe est la colonne des emprunts (format 3, vide ici : aucun emprunt) et son compte emprunts: 0 dans l'en-tête ; les 31 visuels sont les mêmes.
    const EMPREINTE_AVANT_LE_LOT = '18bedb6934509365b88a239990cdcdb7deb242e5320fea0838bbbbf481e6dbcf';
    const fige = () => {
        const docs = [], lignes = [];
        for (let i = 1; i <= 30; i++) { const num = String(i).padStart(3, '0'); docs.push({ _id: i, nomEn: `Carte ${i}`, sets: ['Set-A'], impressions: [imp(num)], images: [im('Set-A', num, `c${i}`)] }); lignes.push({ idProduct: 1000 + i, carteId: i, idExpansion: 100, numeroFiche: num, slug: `P${i}-SA${i}`, slugSet: 'Set-A' }); }
        docs.push({ _id: 900, nomEn: 'Carte 900', sets: ['Set-B'], impressions: [imp('001', 'Set B')], images: [im('Set-B', '001', 'c900')] });
        lignes.push({ idProduct: 3001, carteId: 900, idExpansion: 200, numeroFiche: '001', slug: 'P9-SB1', slugSet: 'Set-B' });
        return { d: { sets: SETS, docs, lignes }, cat: new Map([...Array.from({ length: 30 }, (_, i) => [1001 + i, 5000 + (i % 4)]), [3001, 5000]]) };
    };
    const fg = fige();
    const ff = await fabriquerFichier({ source: source(fg.d), catalogue: fg.cat, secret: SECRET });
    H.v('3c. sans --exclure : le contenu brut du jeu fixe a l\'empreinte SHA-256 du code d\'AVANT le lot (1a1ab447)', [crypto.createHash('sha256').update(fixe(ff.brut)).digest('hex'), ff.comptes.visuels], [EMPREINTE_AVANT_LE_LOT, 31]);

    // ── 4. AVEC la liste : l'effet, produit par produit
    const versX = path.join(dossier, 'avec-exclusion.rmv');
    const chemin1 = ecrire(liste(PRODUITS, { source: 'chemin de documentation' }));
    const pX = await lancer([`--vers=${versX}`, `--exclure=${chemin1}`], { V2_VISUELS_HMAC: SECRET }, { source: source(jeu()), catalogue: catalogue() });
    const vX = await lireArchive(versX);
    H.v('4a. construction réussie (code 0, archive écrite et relue par le consommateur)', [pX.code, fs.existsSync(versX), vX.comptes.visuels], [0, true, 8]);
    H.v('4b. les produits exclus et PRÉSENTS n\'ont AUCUNE entrée (1005, 2001, 3001), comme un produit sans visuel (1006)', [vX.entree(1005), vX.entree(2001), vX.entree(3001), vX.entree(1006)], [null, null, null, null]);
    H.v('4c. le produit JUSTE qui partageait l\'entrée d\'image de 2001 (1001) garde la sienne ET ses marques (partages, jumeaux), identiques à la construction sans exclusion',
        [JSON.stringify(vX.entree(1001)) === JSON.stringify(v0.entree(1001)), vX.entree(1001) && vX.entree(1001).vignette.cle, JSON.stringify(vX.partagesDe(1001)) === JSON.stringify(v0.partagesDe(1001)), JSON.stringify(vX.jumeauxDe(1001)) === JSON.stringify(v0.jumeauxDe(1001))], [true, 'vignettes/c1.webp', true, true]);
    H.v('4c bis. les partages de TOUS les produits non exclus sont ceux de la construction sans exclusion',
        [1001, 1002, 1003, 1004, 1007, 1008, 1009, 1010].every(id => JSON.stringify(vX.partagesDe(id)) === JSON.stringify(v0.partagesDe(id))), true);
    const intacts = [1001, 1002, 1003, 1004, 1007, 1008, 1009, 1010].filter(id => JSON.stringify(vX.entree(id)) === JSON.stringify(v0.entree(id)));
    H.v('4d. tous les autres produits ont une entrée identique (8 sur 8)', intacts.length, 8);
    H.v('4e. les fiches liées ne changent PAS : mêmes fiches dans les deux sets, mêmes produits (les exclus y restent), mêmes comptes',
        [JSON.stringify(vX.fichesDuSet('Set-A')) === JSON.stringify(v0.fichesDuSet('Set-A')), JSON.stringify(vX.fichesDuSet('Set-B')) === JSON.stringify(v0.fichesDuSet('Set-B')),
            vX.comptes.fichesLiees === v0.comptes.fichesLiees, vX.comptes.produitsLies === v0.comptes.produitsLies, vX.comptes.setsAvecLiens === v0.comptes.setsAvecLiens,
            vX.fichesDuSet('Set-A').some(f => f.produits.includes(2001)), vX.fichesDuSet('Set-B').some(f => f.produits.includes(3001))], [true, true, true, true, true, true, true]);
    const ids = [1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010, 2001, 3001];
    H.v('4f. les exclus restent dans la carte catalogue : la colonne des jumeaux est identique, 3001 reste un jumeau de 1001 (et réciproquement), 2001 (même créneau) n\'en est pas un',
        [vX.colonneJumeaux, ids.every(id => JSON.stringify(vX.jumeauxDe(id)) === JSON.stringify(v0.jumeauxDe(id))), vX.jumeauxDe(1001).includes(3001), vX.jumeauxDe(3001).includes(1001), vX.jumeauxDe(1001).includes(2001), vX.metacarteJumeaux(2001)],
        [true, true, true, true, false, 7000]);
    H.v('4g. la liste des produits d\'une métacarte ne nomme plus les exclus (ils n\'ont plus de visuel), sans toucher aux autres', [v0.produitsDeMetacarte(7000), vX.produitsDeMetacarte(7000)], [[1001, 2001, 3001], [1001]]);
    H.v('4h. les dénominateurs d\'entrée ne bougent pas (sets, cartes, produits, catalogue)', JSON.stringify(F.lireEntete(zlibGunzip(S.ouvrir(fs.readFileSync(versX), SECRET))).entree),
        JSON.stringify(F.lireEntete(f0.brut).entree));

    // ── 5. les COMPTEURS : exacts, dans l'archive (comptes), à l'écran, et lus par le consommateur
    H.v('5a. comptes de l\'archive : 3 retirés, par motif (la somme y est), 0 partage perdu', [vX.comptes.exclus, vX.comptes.exclusParMotif, vX.comptes.partagesPerdus], [3, { 'visuel-faux': 1, 'en-attente': 0, 'entree-partagee-autre-dessin': 1, 'entree-partagee-autre-impression': 1 }, 0]);
    H.v('5a bis. à l\'écran : les partages perdus sont imprimés (0)', /partages perdus 0/.test(pX.texte), true);
    H.v('5b. à l\'écran : le nombre retiré, le détail par motif, et LES DÉJÀ SANS VISUEL listés par idProduct (une liste périmée se dit)',
        [/3 produit\(s\) exclu\(s\) retiré\(s\)/.test(pX.texte), /visuel-faux 1/.test(pX.texte), /en-attente 0/.test(pX.texte), /entree-partagee-autre-dessin 1/.test(pX.texte), /entree-partagee-autre-impression 1/.test(pX.texte),
            /déjà sans visuel[^\n]*1006/.test(pX.texte), /déjà sans visuel[^\n]*9999/.test(pX.texte), /déjà sans visuel[^\n]*1005/.test(pX.texte)], [true, true, true, true, true, true, true, false]);
    const dir = await fabriquerFichier({ source: source(jeu()), catalogue: catalogue(), secret: SECRET, exclusions: new Map(PRODUITS.map(p => [p.idProduct, p.motif])) });
    H.v('5c. fabriquerFichier rend les mêmes comptes, et la liste des déjà-sans-visuel avec sa raison', [dir.comptes.exclus, dir.comptes.exclusSansVisuel.map(x => x.idProduct), dir.comptes.exclusSansVisuel.map(x => typeof x.raison === 'string' && x.raison.length > 0)], [3, [1006, 9999], [true, true]]);
    const lu = await I.executerDepuisFichier({ lireFichier: async () => fs.readFileSync(versX), secret: SECRET })();
    H.v('5d. le chargeur de l\'API accepte une archive qui porte ces compteurs et les rend (lireEntree rejoue chaque entrée : aucune rejetée)', [lu.ok, lu.comptes.visuels, lu.comptes.exclus, lu.comptes.exclusParMotif['visuel-faux'], lu.comptes.refusees], [true, 8, 3, 1, 0]);
    E.vider();
    const journal = [];
    const ch = I.creerChargeur({ catalogue: async () => new Map(), executer: I.executerDepuisFichier({ lireFichier: async () => fs.readFileSync(versX), secret: SECRET }), journal: m => journal.push(m), pret: async () => true });
    const rc = await ch.charger();
    H.v('5e. le journal du chargeur nomme les exclus de l\'identification (et la version est installée)', [rc.ok, journal.some(m => /exclus de l'identification 3/.test(m)), E.version() && E.version().comptes.exclus], [true, true, 3]);
    E.vider();
    // une archive SANS ces compteurs (toutes les archives publiées à ce jour) : le chargeur la lit comme avant, sans rien inventer
    const luSans = await I.executerDepuisFichier({ lireFichier: async () => fs.readFileSync(vers0), secret: SECRET })();
    H.v('5f. une archive sans compteurs d\'exclusion se charge comme avant (aucun champ inventé)', [luSans.ok, 'exclus' in luSans.comptes], [true, false]);
    // le consommateur REFUSE des compteurs d'exclusion qui ne tiennent pas (écrit par ce qu'il autorise)
    const brutX = zlibGunzip(S.ouvrir(fs.readFileSync(versX), SECRET));
    const mentir = changement => { const e = F.lireEntete(brutX); return F.reecrireEntete(brutX, { ...e, comptes: { ...e.comptes, ...changement } }); };
    const refus = brut => { try { F.deserialiser(brut); return null; } catch (e) { return e && e.name === 'FormatInvalide' ? e.motif : 'autre'; } };
    H.v('5g bis. des partages perdus non nuls, ou un compteur qui manque, sont refusés par le format (l\'archive elle-même ne peut pas déclarer de partage perdu)',
        [/partagesPerdus/.test(refus(mentir({ partagesPerdus: 2 })) || ''), /partagesPerdus/.test(refus(mentir({ partagesPerdus: undefined })) || '')], [true, true]);
    H.v('5g. des compteurs d\'exclusion incohérents sont refusés par le format : la somme par motif ≠ le total · un motif inconnu · un total négatif',
        [/exclu/.test(refus(mentir({ exclus: 4 })) || ''), /exclu/.test(refus(mentir({ exclusParMotif: { 'visuel-faux': 1, 'en-attente': 0, 'entree-partagee-autre-dessin': 1, 'entree-partagee-autre-impression': 1, 'inconnu': 0 } })) || ''), /exclu/.test(refus(mentir({ exclus: -3, exclusParMotif: { 'visuel-faux': -3, 'en-attente': 0, 'entree-partagee-autre-dessin': 0, 'entree-partagee-autre-impression': 0 } })) || '')], [true, true, true]);

    // ── 6. un produit exclu qui a DEUX entrées de visuels différents (doublon contradictoire) n'avait déjà aucun visuel : il n'est pas compté comme retiré, il est listé
    const dc = jeu();
    dc.docs.push({ _id: 901, nomEn: 'Carte 901', sets: ['Set-B'], impressions: [imp('002', 'Set B')], images: [im('Set-B', '002', 'c901')] });
    dc.lignes.push({ idProduct: 1002, carteId: 901, idExpansion: 200, numeroFiche: '002', slug: 'P2-SB2', slugSet: 'Set-B' });       // 1002 est rattaché à deux cartes : deux entrées aux visuels différents
    const fc = await fabriquerFichier({ source: source(dc), catalogue: catalogue(), secret: SECRET });
    const fcx = await fabriquerFichier({ source: source(dc), catalogue: catalogue(), secret: SECRET, exclusions: new Map([[1002, 'visuel-faux']]) });
    H.v('6. un produit aux visuels contradictoires (déjà sans visuel) n\'est PAS compté parmi les retirés : il est listé avec sa raison', [fc.comptes.doublonsContradictoires, fcx.comptes.exclus, fcx.comptes.exclusSansVisuel.map(x => x.idProduct), fcx.comptes.visuels === fc.comptes.visuels], [1, 0, [1002], true]);

    // ── 7. calculer refuse une liste qui n'est pas une Map de motifs connus (l'endroit unique de l'exclusion ne se laisse pas appeler de travers)
    let m7 = null, m8 = null;
    try { await calculer({ ...jeu(), metacarte: catalogue(), regle: await require('../chargeur/regle-site').regleEmbarquee(), exclusions: [{ idProduct: 1005, motif: 'visuel-faux' }] }); } catch (e) { m7 = e.message; }
    try { await calculer({ ...jeu(), metacarte: catalogue(), regle: await require('../chargeur/regle-site').regleEmbarquee(), exclusions: new Map([[1005, 'au-hasard']]) }); } catch (e) { m8 = e.message; }
    H.v('7. calculer lève sur une liste qui n\'est pas une Map, et sur un motif hors de la liste fermée', [/exclusions/.test(m7 || ''), /motif/.test(m8 || '')], [true, true]);

    // ── 8. la garde des 10 % existe toujours et S'APPLIQUE avec l'exclusion (ne la contourne pas)
    const grand = () => { const docs = [], lignes = [], cat = new Map(); for (let i = 1; i <= 100; i++) { const num = String(i).padStart(3, '0'); docs.push({ _id: i, nomEn: `Carte ${i}`, sets: ['Set-A'], impressions: [imp(num)], images: [im('Set-A', num, `c${i}`)] }); lignes.push({ idProduct: 1000 + i, carteId: i, idExpansion: 100, numeroFiche: num, slug: `P${i}-SA${i}`, slugSet: 'Set-A' }); cat.set(1000 + i, 5000 + (i % 4)); } return { d: { sets: SETS, docs, lignes }, cat }; };
    const g = grand(); const mag = magasin();
    const q1 = await lancer(['--deposer'], ENV_ECR, { source: source(g.d), catalogue: g.cat, client: mag });
    const avant = mag.objet; mag.commandes.length = 0;
    const douze = ecrire(liste(Array.from({ length: 12 }, (_, i) => ({ idProduct: 1001 + i, motif: 'visuel-faux' }))));
    const q2 = await lancer(['--deposer', `--exclure=${douze}`], ENV_ECR, { source: source(g.d), catalogue: g.cat, client: mag });
    H.v('8a. 12 exclusions sur 100 visuels (100 → 88) : REFUSÉE par la garde des 10 %, code 1, AUCUN PutObject, l\'objet publié est inchangé', [q1.code, q2.code, /chute de plus de 10 % des visuels.*\(100 → 88\)/.test(q2.texte) || q2.texte.slice(0, 300), mag.commandes.includes('PutObjectCommand'), mag.objet.equals(avant)], [0, 1, true, false, true]);
    const cinq = ecrire(liste(Array.from({ length: 5 }, (_, i) => ({ idProduct: 1001 + i, motif: 'en-attente' }))));
    const q3 = await lancer(['--deposer', `--exclure=${cinq}`], ENV_ECR, { source: source(g.d), catalogue: g.cat, client: mag });
    const pub = await I.executerDepuisFichier({ lireFichier: async () => mag.objet, secret: SECRET })();
    H.v('8b. 5 exclusions (100 → 95) : publiée, la comparaison dite, l\'objet publié porte 95 visuels et 5 exclus', [q3.code, /chute ≤ 10 %/.test(q3.texte), pub.comptes.visuels, pub.comptes.exclus], [0, true, 95, 5]);

    // ── 9. --vers et --deposer ensemble : la même archive, les mêmes compteurs
    const mag9 = magasin(); const versD = path.join(dossier, 'les-deux.rmv');
    const q9 = await lancer([`--vers=${versD}`, '--deposer', `--exclure=${chemin1}`], ENV_ECR, { source: source(jeu()), catalogue: catalogue(), client: mag9 });
    H.v('9. --vers + --deposer + --exclure : le fichier local et l\'objet déposé sont identiques et portent les compteurs', [q9.code, fs.readFileSync(versD).equals(mag9.objet), (await lireArchive(versD)).comptes.exclus], [0, true, 3]);

    // ── 10. tour 1 (C1, I1) : la PAIRE de variantes. 1001 (normale) et 2001 (Staff) : même carte, même fiche, même visuel, image « séparée par l'étiquette » (partageeTamponNonSepare false, aucune liste), variantes
    //        PROUVÉES. Sans exclusion, chacune est le partenaire de l'autre (`partagesDe`) : la route en fait une QUESTION. Exclure l'une ne doit pas ouvrir l'affirmation de l'autre.
    const paire = () => {
        const d = jeu();
        d.docs[0].images = [{ ...im('Set-A', '001', 'c1'), partageeTamponNonSepare: false }];
        const l1 = d.lignes.find(l => l.idProduct === 1001), l2 = d.lignes.find(l => l.idProduct === 2001);
        Object.assign(l1, { variante: 'normale', variantePreuve: 'libellé Cardmarket' }); Object.assign(l2, { variante: 'staff', variantePreuve: 'libellé Cardmarket' });
        d.docs = d.docs.filter(x => x._id !== 900); d.lignes = d.lignes.filter(l => l.idProduct !== 3001);          // pas de jumeau d'un autre créneau : seule la paire peut bloquer 1001 et 2001
        return d;
    };
    const cat10 = (sans = []) => { const m = catalogue(); m.delete(3001); for (const id of sans) m.delete(id); return m; };
    const construire = async (d, ex, cat = cat10()) => { const f = await fabriquerFichier({ source: source(d), catalogue: cat, secret: SECRET, exclusions: ex ? new Map(ex) : null }); return { f, v: F.deserialiser(await F.decompresser(S.ouvrir(f.scelle, SECRET))) }; };
    const decision = (v, id, autre) => { const four = J.fournisseurDe(v); const r = J.garde({ jumeaux: four, produits: new Map([[id, {}], [autre, {}]]) }, id); return r.action + (r.ids ? ` ${r.ids.join(',')}` : ''); };
    const base10 = await construire(paire(), null);
    H.v('10a. (garde du banc) sans exclusion, la paire existe : chacun est le partenaire de l\'autre, et la garde en fait une QUESTION', [base10.v.partagesDe(1001), base10.v.partagesDe(2001), decision(base10.v, 1001, 2001), decision(base10.v, 2001, 1001)], [[2001], [1001], 'question 1001,2001', 'question 2001,1001']);
    const sansStaff = await construire(paire(), [[2001, 'entree-partagee-autre-impression']]);
    H.v('10b. le Staff exclu n\'a plus de visuel ; la normale GARDE le sien, identique', [sansStaff.v.entree(2001), JSON.stringify(sansStaff.v.entree(1001).vignette) === JSON.stringify(base10.v.entree(1001).vignette), sansStaff.v.entree(1001).grande.cle], [null, true, 'cartes/c1.webp']);
    H.v('10c. la normale garde ses PARTAGES, identiques à la construction sans exclusion (le Staff y reste nommé, sans visuel)', [sansStaff.v.partagesDe(1001), JSON.stringify(sansStaff.v.partagesDe(1001)) === JSON.stringify(base10.v.partagesDe(1001)), sansStaff.v.jumeauxDe(1001)], [[2001], true, []]);
    H.v('10d. la garde de la normale ne répond PAS « affirmer » : question avec le Staff', decision(sansStaff.v, 1001, 2001), 'question 1001,2001');
    H.v('10e. partagesPerdus vaut 0, publié dans les comptes, et le marquage de la normale est celui d\'avant (tampon non séparé false, variante normale)', [sansStaff.f.comptes.partagesPerdus, sansStaff.v.comptes.partagesPerdus, sansStaff.v.entree(1001).partageeTamponNonSepare, sansStaff.v.entree(1001).variante], [0, 0, false, 'normale']);
    const sansNormale = await construire(paire(), [[1001, 'visuel-faux']]);
    H.v('10f. à l\'inverse (la normale exclue, le Staff gardé) : le Staff garde son visuel et son partage, et la garde répond « question », jamais « affirmer »',
        [sansNormale.v.entree(1001), sansNormale.v.entree(2001) && sansNormale.v.entree(2001).vignette.cle, sansNormale.v.partagesDe(2001), decision(sansNormale.v, 2001, 1001), sansNormale.f.comptes.partagesPerdus], [null, 'vignettes/c1.webp', [1001], 'question 2001,1001', 0]);
    const lesDeux = await construire(paire(), [[1001, 'visuel-faux'], [2001, 'visuel-faux']]);
    H.v('10g. les deux exclus : plus aucun des deux n\'a de visuel, les autres produits sont intacts, 0 partage perdu', [lesDeux.v.entree(1001), lesDeux.v.entree(2001), lesDeux.v.entree(1002) !== null, lesDeux.f.comptes.exclus, lesDeux.f.comptes.partagesPerdus], [null, null, true, 2, 0]);
    // le garde-fou du banc : SANS la conservation du partage, la garde AFFIRMERAIT (c'est le défaut de f670be39) — la comparaison des marques le verrait
    const X10 = require('../chargeur/exclusions');
    {
        const brutes = await construire(paire(), null);
        const sansConservation = (await (async () => {
            // la même construction mais SANS inscrire le partenaire exclu dans la liste du voisin : on retire l'entrée du Staff d'une construction ordinaire de la même paire
            const d = paire(); d.lignes = d.lignes.filter(l => l.idProduct !== 2001);
            return construire(d, null, cat10([2001]));
        })());
        const cmp = X10.comparerMarques(brutes.v, sansConservation.v, new Map([[2001, 'visuel-faux']]));
        H.v('10h. la comparaison des marques CRIE sur un état fabriqué où le voisin a perdu son partenaire (partagesPerdus ≥ 1, la normale est nommée), et la garde de cet état affirmerait',
            [cmp.perdus >= 1, cmp.ids.includes(1001), decision(sansConservation.v, 1001, 2001).startsWith('affirmer')], [true, true, true]);
    }
    // 10i : l'état où la conservation est IMPOSSIBLE (la normale n'a aucun marquage ; seul le Staff, exclu, portait la liste) : la construction est REFUSÉE, code 1, partagesPerdus nommé, rien d'écrit
    const deciderPassif = async ({ sink }) => {
        const base = { visuel: 'du-set', mention: null, idMetacard: 7000, numero: '001', rarete: 'Rare', total: '100', variante: null, setNom: 'Set A', lien: null, grande: null, vignette: { cle: 'vignettes/p.webp', w: 200, h: 279 } };
        sink.entree({ ...base, idProduct: 2001, partageeHoloNonHolo: true, partageeTamponNonSepare: null, produitsPartages: [2001, 1001] });
        sink.entree({ ...base, idProduct: 1001 });
        sink.lien('Set-A', '1|001', [1001, 2001]);
        for (const id of [1001, 2001]) sink.jumeau({ idProduct: id, idMetacard: 7000, idExpansion: 100, numero: '001', tirage: 'intl' });
        return { denominateurs: { setsAvecLiens: 1, produitsLies: 2 } };
    };
    let m10 = null; try { await fabriquerFichier({ source: source(jeu()), catalogue: catalogue(), secret: SECRET, decider: deciderPassif, exclusions: new Map([[2001, 'visuel-faux']]) }); } catch (e) { m10 = e.motif || e.message; }
    H.v('10i. un état où le voisin ne peut pas garder le partage (aucun marquage de son côté) : la construction est REFUSÉE, partagesPerdus nommé', [/partagesPerdus 1/.test(m10 || ''), /1001/.test(m10 || ''), /aucune construction/.test(m10 || '')], [true, true, true]);
    const vPassifOk = (await fabriquerFichier({ source: source(jeu()), catalogue: catalogue(), secret: SECRET, decider: deciderPassif, exclusions: new Map([[1001, 'visuel-faux']]) }));
    H.v('10j. le même état avec l\'AUTRE produit exclu (le Staff garde sa liste [2001, 1001]) : rien n\'est perdu, la construction passe (cas « liste », vert)', [vPassifOk.comptes.partagesPerdus, vPassifOk.comptes.exclus], [0, 1]);
    const jamais = path.join(dossier, 'jamais.rmv');
    const refusCli = await lancer([`--vers=${jamais}`, `--exclure=${ecrire(liste([{ idProduct: 2001, motif: 'visuel-faux' }]))}`], { V2_VISUELS_HMAC: SECRET }, { source: source(jeu()), catalogue: catalogue(), decider: deciderPassif });
    H.v('10k. par la ligne de commande : code 1, partagesPerdus nommé à l\'écran, AUCUN fichier écrit', [refusCli.code, /partagesPerdus 1/.test(refusCli.texte), fs.existsSync(jamais)], [1, true, false]);

    for (const nom of fs.readdirSync(dossier)) fs.unlinkSync(path.join(dossier, nom));         // le dossier du banc ne contient que des fichiers : aucune suppression récursive
    fs.rmdirSync(dossier);
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });

function zlibGunzip(b) { return require('zlib').gunzipSync(b); }
