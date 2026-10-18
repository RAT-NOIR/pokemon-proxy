'use strict';
// F1-TAMPON puis LOT TAMPONS — la décision PURE : le déclenchement (une paire SÉPARÉE marque(s)/normale, prouvée par l'archive), la lecture d'un ENSEMBLE de marques dans la liste fermée, le consensus de deux
// essais à l'identique, le fournisseur d'essais. Aucune base, aucun réseau, aucun appel payant : le recadrage et le lecteur sont FABRIQUÉS dans ce fichier.
const H = require('./_harnais');
const LT = require('../identifier/lecture-tampon');

const e = (o = {}) => ({ partageeHoloNonHolo: null, partageeTamponNonSepare: false, produitsPartages: [11, 12], tamponNonRepresente: 'Staff', variante: 'normale', ...o });
const ARCHIVE = { 11: e({ variante: 'normale' }), 12: e({ variante: 'staff' }) };
const type = (ids, a = ARCHIVE) => { const r = LT.paireSeparee({ ids, entree: id => a[id] || null }); return r.ok ? [r.type, r.special, r.normale] : r.motif; };
const MF = 'les variantes ne sont pas une paire marque/normale';

(async () => {
    // ── 1. LE DÉCLENCHEMENT : écrit par ce qu'il autorise (un seul chemin mène à une paire)
    H.v('1a. la paire staff/normale séparée, prouvée par l\'archive : staff = 12, normale = 11 (quel que soit l\'ordre des candidats)', [type([11, 12]), type([12, 11])], [['staff', 12, 11], ['staff', 12, 11]]);
    const J = { 21: e({ variante: 'normale', produitsPartages: [21, 22], tamponNonRepresente: null }), 22: e({ variante: 'jumbo', produitsPartages: [21, 22], tamponNonRepresente: null }) };
    H.v('1b. la paire jumbo/normale séparée : RIEN (un jumbo reste une question ; la règle « jumbo par le titre » est retirée)', type([21, 22], J), MF);
    const nonSepare = { 11: e({ partageeTamponNonSepare: true }), 12: e({ variante: 'staff', partageeTamponNonSepare: true }) };
    H.v('1c. une paire NON séparée (true) ne déclenche rien', type([11, 12], nonSepare), 'la paire n\'est pas marquée séparée');
    H.v('1d. un candidat sans entrée d\'archive, ou une archive sans marquage (null) : rien', [type([11, 99]), type([11, 12], { 11: e({ partageeTamponNonSepare: null }), 12: e({ partageeTamponNonSepare: null, variante: 'staff' }) })], ['un candidat n\'a pas d\'entrée d\'archive', 'la paire n\'est pas marquée séparée']);
    H.v('1e. deux normales (ou deux marques), ou une variante inconnue / hors liste : rien — jamais deviné', [type([11, 12], { 11: e({ variante: 'normale' }), 12: e({ variante: 'normale' }) }), type([11, 12], { 11: e({ variante: 'staff' }), 12: e({ variante: 'staff' }) }), type([11, 12], { 11: e({ variante: null }), 12: e({ variante: 'staff' }) }),
        type([11, 12], { 11: e({ variante: 'league' }), 12: e({ variante: 'staff' }) }), type([11, 12], { 11: e({ variante: 'normale' }), 12: e({ variante: 'inconnu' }) }), type([11, 12], { 11: e({ variante: 'normale' }), 12: e({ variante: 'prerelease+staff' }) })],
        Array(6).fill(MF));
    H.v('1f. la liste de partage ne nomme pas exactement la paire : rien', [type([11, 12], { 11: e({ produitsPartages: [11, 12, 13] }), 12: e({ variante: 'staff', produitsPartages: [11, 12, 13] }) }), type([11, 12], { 11: e({ produitsPartages: null }), 12: e({ variante: 'staff' }) }), type([11, 12], { 11: e({ produitsPartages: [11, 12] }), 12: e({ variante: 'staff', produitsPartages: [12, 13] }) })],
        ['la liste de partage ne nomme pas exactement la paire', 'la liste de partage ne nomme pas exactement la paire', 'la liste de partage ne nomme pas exactement la paire']);
    H.v('1g. une question à 3 (la paire et un tiers), à 1, ou des doublons : rien (un tiers pourrait être la vérité)', [type([11, 12, 13]), type([11]), type([11, 11]), type([]), type(null)], Array(5).fill('la question n\'est pas exactement la paire'));
    H.v('1h. aucune ligne ne dit qu\'un tampon n\'est pas représenté (tamponNonRepresente absent, vide, ou pas un texte) : rien', [type([11, 12], { 11: e({ tamponNonRepresente: null }), 12: e({ variante: 'staff', tamponNonRepresente: null }) }), type([11, 12], { 11: e({ tamponNonRepresente: '  ' }), 12: e({ variante: 'staff', tamponNonRepresente: '' }) }), type([11, 12], { 11: e({ tamponNonRepresente: 5 }), 12: e({ variante: 'staff', tamponNonRepresente: true }) })],
        Array(3).fill('l\'archive ne dit pas quel tampon n\'est pas représenté'));
    H.v('1i. un partage holo/non-holo en plus : rien', type([11, 12], { 11: e({ partageeHoloNonHolo: true }), 12: e({ variante: 'staff' }) }), 'un partage holo / non-holo se mêle à la paire');
    H.v('1j. une entrée qui lève, ou un fournisseur absent : rien (ne lève jamais)', [LT.paireSeparee({ ids: [11, 12], entree: () => { throw new Error('boum'); } }).ok, LT.paireSeparee({ ids: [11, 12] }).ok], [false, false]);
    // LOT TAMPONS : toute marque de la liste fermée, et tout ensemble, avec la normale
    const marque = v => { const a = { 11: e({ variante: 'normale', tamponNonRepresente: 'Tampon' }), 12: e({ variante: v, tamponNonRepresente: 'Tampon' }) }; const r = LT.paireSeparee({ ids: [11, 12], entree: id => a[id] }); return r.ok ? [r.type, r.variante, r.marques, r.special, r.normale] : r.motif; };
    H.v('1k. une marque de la liste (league, kfc, place-2, play-pokemon…) ou un ensemble canonique (staff+prerelease, league+place-2) avec la normale : paire, la variante et les marques du produit spécial sont rendues',
        [marque('league'), marque('kfc'), marque('staff+prerelease'), marque('league+place-2')], [['league', 'league', ['league'], 12, 11], ['kfc', 'kfc', ['kfc'], 12, 11], ['staff+prerelease', 'staff+prerelease', ['staff', 'prerelease'], 12, 11], ['league+place-2', 'league+place-2', ['league', 'place-2'], 12, 11]]);
    H.v('1l. un jumbo reste une question même en ensemble de la liste', marque('jumbo'), MF);

    // ── 2. LA RÈGLE « JUMBO PAR LE TITRE » EST RETIRÉE DU CODE : plus aucune fonction ne lit un titre
    H.v('2. le module n\'exporte plus aucune règle de titre (ni titreJumbo, ni liste de mots)', Object.keys(LT).filter(k => /titre|jumbo|MOTS|NEGATION/i.test(k)), []);

    // ── 3. UN ESSAI : la réponse du lecteur -> { marques } | { autre } | 'incertain'
    const L = (marques, o = {}) => ({ marques, autre: false, incertain: false, ...o });
    const essai = r => LT.essaiDe(r);
    H.v('3a. des marques de la liste (casse et espaces normalisés, dédoublonnées, dans l\'ordre de la liste)', [essai(L(['staff'])), essai(L([' STAFF '])), essai(L(['prerelease', 'staff', 'staff'])), essai(L([]))], [{ marques: ['staff'] }, { marques: ['staff'] }, { marques: ['staff', 'prerelease'] }, { marques: [] }]);
    H.v('3b. une marque HORS liste, `autre`, ou deux places à la fois : { autre } — une question, jamais un sûr', [essai(L(['staff', 'inconnue'])), essai(L(['staff'], { autre: true })), essai(L(['place-1', 'place-2'])), essai(L([], { autre: true })), essai(L(['jumbo'])), essai(L(['normale']))], Array(6).fill({ autre: true }));
    H.v('3c. illisible, `incertain`, forme fausse (marques pas un tableau, élément pas une chaîne, `autre` pas un booléen), pas un objet : incertain', [essai({ illisible: true }), essai(L(['staff'], { incertain: true })), essai({ marques: 'staff', autre: false, incertain: false }), essai({ marques: [1], autre: false, incertain: false }), essai({ marques: ['staff'], autre: 'non', incertain: false }), essai({ marques: ['staff'], autre: false }), essai(null), essai('staff'), essai(undefined)], Array(9).fill('incertain'));
    H.v('3d. trop de marques (plus de 4) : { autre }', essai(L(['staff', 'prerelease', 'league', 'championship', 'cosmo'])), { autre: true });

    // ── 4. LE CONSENSUS : DEUX essais à l'identique, rien d'autre
    const d = essais => { const r = LT.decider({ essais }); return [r.sur, r.lecture, r.marques]; };
    const S = { marques: ['staff'] }, SP = { marques: ['staff', 'prerelease'] }, AUCUNE = { marques: [] }, AUTRE = { autre: true };
    H.v('4a. deux fois le même ensemble non vide : sûr (lecture « marques »), les marques rendues', [d([S, S]), d([SP, SP]), d([{ marques: ['league', 'place-2'] }, { marques: ['league', 'place-2'] }])], [[true, 'marques', ['staff']], [true, 'marques', ['staff', 'prerelease']], [true, 'marques', ['league', 'place-2']]]);
    H.v('4b. deux ensembles différents (staff / staff+prerelease, staff / league), ou un ensemble et rien : désaccord, jamais sûr', [d([S, SP]), d([S, { marques: ['league'] }]), d([S, AUCUNE]), d([AUCUNE, S])], Array(4).fill([false, 'desaccord', []]));
    H.v('4c. deux fois « aucune marque » : lecture « aucune » — et ce n\'est JAMAIS la version normale affirmée (rien de sûr, aucune marque rendue)', d([AUCUNE, AUCUNE]), [false, 'aucune', []]);
    H.v('4d. `autre` : jamais sûr, même avec un ensemble qui concorde de l\'autre côté', [d([AUTRE, AUTRE]), d([S, AUTRE]), d([AUTRE, S])], [[false, 'autre', []], [false, 'desaccord', []], [false, 'desaccord', []]]);
    H.v('4e. incertain + incertain, un seul essai, aucun, une forme inconnue : pas de lecture', [d(['incertain', 'incertain']), d([S]), d([]), d([S, 'oui']), d([S, null]), d(null), d([S, { marques: 'staff' }]), d([S, { marques: ['inconnue'] }])], [[false, 'incertain', []], [false, 'incertain', []], [false, 'incertain', []], [false, 'incertain', []], [false, 'incertain', []], [false, 'incertain', []], [false, 'incertain', []], [false, 'incertain', []]]);
    H.v('4f. incertain d\'un côté, marques de l\'autre : désaccord ; trois essais dont un qui contredit : désaccord (tous doivent concorder)', [d([S, 'incertain']), d(['incertain', S]), d([S, S, AUCUNE]), d([S, S, S])], [[false, 'desaccord', []], [false, 'desaccord', []], [false, 'desaccord', []], [true, 'marques', ['staff']]]);
    H.v('4g. l\'ordre des marques lues ne compte pas (l\'ensemble est canonique)', d([{ marques: ['prerelease', 'staff'] }, { marques: ['staff', 'prerelease'] }]), [true, 'marques', ['staff', 'prerelease']]);

    // ── 5. LE JETON LU : l'ensemble de marques -> le jeton de variante, et seulement lui
    H.v('5. jetonLu : le jeton canonique de l\'ensemble ; aucun ensemble sûr, aucun jeton', [LT.jetonLu({ sur: true, marques: ['staff', 'prerelease'] }), LT.jetonLu({ sur: false, marques: ['staff'] }), LT.jetonLu({ sur: true, marques: [] }), LT.jetonLu(null)], ['staff+prerelease', null, null, null]);

    // ── 6. LE FOURNISSEUR D'ESSAIS : deux appels, un par préparation de l'image ; ne lève JAMAIS
    const IMG = Buffer.from([1, 2, 3, 4]);
    const lecteurDe = reponses => { const vus = []; const f = async (bande, o) => { vus.push({ bande, signal: o && o.signal }); const r = reponses.shift(); if (r instanceof Error) throw r; return r; }; f.vus = vus; return f; };
    const prep = async () => [Buffer.from('a'), Buffer.from('b')];
    const run = async (reponses, extra = {}) => { const lecteur = lecteurDe(reponses), compteur = { appels: 0 }; const r = await LT.creerFournisseur({ preparer: extra.preparer || prep, lecteur })({ image: extra.image === undefined ? IMG : extra.image, corps: {}, compteur, signal: extra.signal }); return { r, compteur, lecteur }; };
    {
        const { r, compteur, lecteur } = await run([L(['staff']), L(['staff'])]);
        H.v('6a. deux fois [staff] : lecture « marques », marques [staff], 2 appels comptés, chacune des deux préparations a sa bande', [r.lecture, r.marques, r.echec, compteur.appels, lecteur.vus.map(v => v.bande.toString())], ['marques', ['staff'], false, 2, ['a', 'b']]);
    }
    {
        const a = await run([L(['prerelease', 'staff']), L(['staff', 'prerelease'])]), b = await run([L(['staff']), L(['staff', 'prerelease'])]);
        H.v('6b. le même ensemble dans un autre ordre : sûr ; [staff] puis [staff, prerelease] : désaccord, 2 appels', [a.r.lecture, a.r.marques, b.r.lecture, b.r.marques, b.compteur.appels], ['marques', ['staff', 'prerelease'], 'desaccord', [], 2]);
    }
    {
        const a = await run([L([]), L(['staff'])]), b = await run([L(['staff'], { autre: true }), L(['staff'])]), c = await run([{ illisible: true }, L(['staff'])]);
        H.v('6c. un premier essai SANS marque, avec `autre` ou illisible ne peut plus mener à un sûr : UN seul appel (le second n\'est pas demandé), lecture aucune / autre / incertain', [a, b, c].map(x => [x.r.lecture, x.compteur.appels, x.lecteur.vus.length, x.r.marques]), [['aucune', 1, 1, []], ['autre', 1, 1, []], ['incertain', 1, 1, []]]);
    }
    {
        const { r, compteur } = await run([L(['staff']), L([])]);
        H.v('6d. oui puis rien : désaccord (2 appels comptés)', [r.lecture, compteur.appels], ['desaccord', 2]);
    }
    {
        const compteur = { appels: 0 };
        const r = await LT.creerFournisseur({ preparer: prep, lecteur: lecteurDe([]) })({ image: undefined, corps: {}, compteur });
        const r2 = await LT.creerFournisseur({ preparer: prep, lecteur: lecteurDe([]) })({ image: 'https://images1.vinted.net/p.jpg', corps: {}, compteur });
        H.v('6e. sans octets (absents, ou une URL) : sansImage, aucun appel — jamais un téléchargement', [r.sansImage, r2.sansImage, compteur.appels], [true, true, 0]);
    }
    {
        const { r, compteur } = await run([], { preparer: async () => [] });
        H.v('6f. aucune préparation possible : 0 appel, pas de lecture, pas un échec', [r.lecture, r.echec, compteur.appels, r.essais], ['incertain', false, 0, []]);
    }
    {
        const { r, compteur } = await run([Object.assign(new Error('secret'), { code: 'APPEL_MODELE' })]);
        H.v('6g. le modèle tombe au premier appel : échec (jamais une exception), l\'appel tenté est compté, la raison ne cite que le code', [r.echec, r.lecture, compteur.appels, /APPEL_MODELE/.test(r.raison), /secret/.test(r.raison)], [true, 'incertain', 1, true, false]);
        const r2 = await run([], { preparer: async () => { throw new Error('image illisible'); } });
        H.v('6h. une préparation qui lève : échec, 0 appel', [r2.r.echec, r2.r.lecture, r2.compteur.appels], [true, 'incertain', 0]);
        const ctl = new AbortController(); ctl.abort();
        const r3 = await run([L(['staff']), L(['staff'])], { signal: ctl.signal });
        H.v('6i. le signal d\'abandon est déjà tombé : aucun appel ne part (échec « interrompue »)', [r3.r.echec, r3.compteur.appels, r3.lecteur.vus.length], [true, 0, 0]);
    }
    {
        const { r } = await run([L(['staff']), L(['staff'])]);
        H.v('6j. le fournisseur rend ses essais NORMALISÉS (la route refait la décision dessus : un fournisseur ne décide jamais à la place du module)', [r.essais, LT.decider({ essais: r.essais }).sur], [[{ marques: ['staff'] }, { marques: ['staff'] }], true]);
    }

    // ── 7. UNE FOIS PAR SCAN, et les compteurs
    LT.reinitialiser();
    H.v('7a. premiereFois : vrai une fois, faux ensuite ; sans identifiant : faux', [LT.premiereFois('s1'), LT.premiereFois('s1'), LT.premiereFois(''), LT.premiereFois(7)], [true, false, false, false]);
    H.v('7b. les compteurs nomment ce qui est compté (declenchees, affirmees, nonConfirmees, echecs, appels, dejaTentees, nonFaisables, marquesSansProduit)', Object.keys(LT.compteurs()), ['declenchees', 'affirmees', 'nonConfirmees', 'echecs', 'appels', 'dejaTentees', 'nonFaisables', 'marquesSansProduit']);
    H.bilan();
})().catch(x => { console.error(x); process.exitCode = 1; });
