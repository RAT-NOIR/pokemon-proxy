'use strict';
// F1-TAMPON — la décision PURE : le déclenchement (une paire SÉPARÉE staff/normale ou jumbo/normale, prouvée par l'archive), le titre « jumbo », le consensus de deux essais « oui », le fournisseur d'essais.
// Aucune base, aucun réseau, aucun appel payant : le recadrage et le lecteur sont FABRIQUÉS dans ce fichier.
const H = require('./_harnais');
const LT = require('../identifier/lecture-tampon');

const e = (o = {}) => ({ partageeHoloNonHolo: null, partageeTamponNonSepare: false, produitsPartages: [11, 12], tamponNonRepresente: 'Staff', variante: 'normale', ...o });
const ARCHIVE = { 11: e({ variante: 'normale' }), 12: e({ variante: 'staff' }) };
const entree = id => ARCHIVE[id] || null;
const type = (ids, a = ARCHIVE) => { const r = LT.paireSeparee({ ids, entree: id => a[id] || null }); return r.ok ? [r.type, r.special, r.normale] : r.motif; };

(async () => {
    // ── 1. LE DÉCLENCHEMENT : écrit par ce qu'il autorise (un seul chemin mène à une paire)
    H.v('1a. la paire staff/normale séparée, prouvée par l\'archive : staff = 12, normale = 11 (quel que soit l\'ordre des candidats)', [type([11, 12]), type([12, 11])], [['staff', 12, 11], ['staff', 12, 11]]);
    const J = { 21: e({ variante: 'normale', produitsPartages: [21, 22], tamponNonRepresente: null }), 22: e({ variante: 'jumbo', produitsPartages: [21, 22], tamponNonRepresente: null }) };
    H.v('1b. la paire jumbo/normale séparée : type jumbo', type([21, 22], J), ['jumbo', 22, 21]);
    const nonSepare = { 11: e({ partageeTamponNonSepare: true }), 12: e({ variante: 'staff', partageeTamponNonSepare: true }) };
    H.v('1c. une paire NON séparée (true) ne déclenche rien', type([11, 12], nonSepare), 'la paire n\'est pas marquée séparée');
    H.v('1d. un candidat sans entrée d\'archive, ou une archive sans marquage (null) : rien', [type([11, 99]), type([11, 12], { 11: e({ partageeTamponNonSepare: null }), 12: e({ partageeTamponNonSepare: null, variante: 'staff' }) })], ['un candidat n\'a pas d\'entrée d\'archive', 'la paire n\'est pas marquée séparée']);
    H.v('1e. deux normales (ou deux staff), ou une variante inconnue : rien — jamais deviné', [type([11, 12], { 11: e({ variante: 'normale' }), 12: e({ variante: 'normale' }) }), type([11, 12], { 11: e({ variante: 'staff' }), 12: e({ variante: 'staff' }) }), type([11, 12], { 11: e({ variante: null }), 12: e({ variante: 'staff' }) })],
        ['les variantes ne sont pas une paire staff/normale ou jumbo/normale', 'les variantes ne sont pas une paire staff/normale ou jumbo/normale', 'les variantes ne sont pas une paire staff/normale ou jumbo/normale']);
    H.v('1f. la liste de partage ne nomme pas exactement les deux : rien', [type([11, 12], { 11: e({ produitsPartages: [11, 12, 13] }), 12: e({ variante: 'staff', produitsPartages: [11, 12, 13] }) }), type([11, 12], { 11: e({ produitsPartages: null }), 12: e({ variante: 'staff' }) }), type([11, 12], { 11: e({ produitsPartages: [11, 12] }), 12: e({ variante: 'staff', produitsPartages: [12, 13] }) })],
        ['la liste de partage ne nomme pas exactement la paire', 'la liste de partage ne nomme pas exactement la paire', 'la liste de partage ne nomme pas exactement la paire']);
    H.v('1g. une question à 3 (la paire et un tiers), à 1, ou des doublons : rien (un tiers pourrait être la vérité)', [type([11, 12, 13]), type([11]), type([11, 11]), type([]), type(null)], ['la question n\'est pas exactement la paire', 'la question n\'est pas exactement la paire', 'la question n\'est pas exactement la paire', 'la question n\'est pas exactement la paire', 'la question n\'est pas exactement la paire']);
    H.v('1h. staff sans « tamponNonRepresente: Staff » sur aucune des deux lignes : rien (rien ne prouve que le scan ne montre pas le tampon)', type([11, 12], { 11: e({ tamponNonRepresente: null }), 12: e({ variante: 'staff', tamponNonRepresente: null }) }), 'l\'archive ne dit pas que le tampon Staff n\'est pas représenté');
    H.v('1i. un partage holo/non-holo en plus : rien', type([11, 12], { 11: e({ partageeHoloNonHolo: true }), 12: e({ variante: 'staff' }) }), 'un partage holo / non-holo se mêle à la paire');
    H.v('1j. une entrée qui lève, ou un fournisseur absent : rien (ne lève jamais)', [LT.paireSeparee({ ids: [11, 12], entree: () => { throw new Error('boum'); } }).ok, LT.paireSeparee({ ids: [11, 12] }).ok], [false, false]);

    // ── 2. LE TITRE « JUMBO » : liste fermée, minuscules, mots entiers, jamais une négation
    const t = x => LT.titreJumbo(x);
    H.v('2a. jumbo, oversize, géante — en mots entiers, casse ignorée', [t('Pikachu JUMBO promo'), t('carte oversize pokemon'), t('Dracaufeu Géante'), t('jumbo')], [true, true, true, true]);
    H.v('2b. pas un mot entier, pas dans la liste : non', [t('jumbos'), t('oversized'), t('Pikachu géantes'), t('superjumbo'), t('carte normale'), t('geante')], [false, false, false, false, false, false]);
    H.v('2c. une négation juste avant : non (pas, non, not, no, sans, without, ni)', [t('pas jumbo'), t('Non Jumbo'), t('not jumbo'), t('sans oversize'), t('no jumbo'), t('without jumbo'), t('ni jumbo ni autre')], [false, false, false, false, false, false, false]);
    H.v('2d. null, vide, pas un texte : non', [t(null), t(''), t(undefined), t(12), t({})], [false, false, false, false, false]);

    // ── 3. LE CONSENSUS : DEUX essais « oui » à l'identique, rien d'autre
    const d = essais => { const r = LT.decider({ essais }); return [r.staff, r.lecture]; };
    H.v('3a. oui + oui : STAFF lu', d(['oui', 'oui']), [true, 'oui']);
    H.v('3b. oui + non, oui + incertain, non + oui : jamais sûr (désaccord)', [d(['oui', 'non']), d(['oui', 'incertain']), d(['non', 'oui'])], [[false, 'desaccord'], [false, 'desaccord'], [false, 'desaccord']]);
    H.v('3c. non + non : « non » — et ce n\'est JAMAIS la version normale affirmée (staff reste faux, rien d\'autre n\'est rendu)', d(['non', 'non']), [false, 'non']);
    H.v('3d. incertain + incertain, un seul essai, aucun, une valeur inconnue : pas de lecture', [d(['incertain', 'incertain']), d(['oui']), d([]), d(['oui', 'OUI']), d(['oui', null]), d(null)], [[false, 'incertain'], [false, 'incertain'], [false, 'incertain'], [false, 'incertain'], [false, 'incertain'], [false, 'incertain']]);
    H.v('3e. trois essais : seuls les deux premiers comptent, mais un troisième qui contredit empêche aussi', [d(['oui', 'oui', 'non']), d(['oui', 'oui', 'oui'])], [[false, 'desaccord'], [true, 'oui']]);

    // ── 4. LE FOURNISSEUR D'ESSAIS : deux appels, un par préparation de l'image ; ne lève JAMAIS
    const IMG = Buffer.from([1, 2, 3, 4]);
    const lecteurDe = reponses => { const vus = []; const f = async (bande, o) => { vus.push({ bande, signal: o && o.signal }); const r = reponses.shift(); if (r instanceof Error) throw r; return r; }; f.vus = vus; return f; };
    const prep = async () => [Buffer.from('a'), Buffer.from('b')];
    {
        const lecteur = lecteurDe([{ staff: 'oui' }, { staff: 'oui' }]); const compteur = { appels: 0 };
        const r = await LT.creerFournisseur({ preparer: prep, lecteur })({ image: IMG, corps: {}, compteur, signal: undefined });
        H.v('4a. deux « oui » : lecture « oui », 2 appels comptés, les deux préparations ont chacune une bande', [r.lecture, r.echec, compteur.appels, lecteur.vus.map(v => v.bande.toString())], ['oui', false, 2, ['a', 'b']]);
    }
    {
        const lecteur = lecteurDe([{ staff: 'oui' }, { staff: 'non' }]); const compteur = { appels: 0 };
        const r = await LT.creerFournisseur({ preparer: prep, lecteur })({ image: IMG, corps: {}, compteur });
        H.v('4b. oui puis non : désaccord, 2 appels comptés', [r.lecture, compteur.appels], ['desaccord', 2]);
    }
    {
        const lecteur = lecteurDe([{ illisible: true }, { staff: 'oui' }]); const compteur = { appels: 0 };
        const r = await LT.creerFournisseur({ preparer: prep, lecteur })({ image: IMG, corps: {}, compteur });
        H.v('4c. une réponse illisible vaut « incertain » (jamais un oui) : pas de lecture', [r.lecture, r.echec], ['desaccord', false]);
    }
    {
        const compteur = { appels: 0 };
        const r = await LT.creerFournisseur({ preparer: prep, lecteur: lecteurDe([]) })({ image: undefined, corps: {}, compteur });
        const r2 = await LT.creerFournisseur({ preparer: prep, lecteur: lecteurDe([]) })({ image: 'https://images1.vinted.net/p.jpg', corps: {}, compteur });
        H.v('4d. sans octets (absents, ou une URL) : sansImage, aucun appel — jamais un téléchargement', [r.sansImage, r2.sansImage, compteur.appels], [true, true, 0]);
    }
    {
        const compteur = { appels: 0 };
        const r = await LT.creerFournisseur({ preparer: async () => [], lecteur: lecteurDe([]) })({ image: IMG, corps: {}, compteur });
        H.v('4e. aucune préparation possible : 0 appel, pas de lecture, pas un échec', [r.lecture, r.echec, compteur.appels, r.essais], ['incertain', false, 0, []]);
    }
    {
        const compteur = { appels: 0 };
        const r = await LT.creerFournisseur({ preparer: prep, lecteur: lecteurDe([Object.assign(new Error('secret'), { code: 'APPEL_MODELE' })]) })({ image: IMG, corps: {}, compteur });
        H.v('4f. le modèle tombe au premier appel : échec (jamais une exception), l\'appel tenté est compté, la raison ne cite que le code', [r.echec, r.lecture, compteur.appels, /APPEL_MODELE/.test(r.raison), /secret/.test(r.raison)], [true, 'incertain', 1, true, false]);
        const r2 = await LT.creerFournisseur({ preparer: async () => { throw new Error('image illisible'); }, lecteur: lecteurDe([]) })({ image: IMG, corps: {}, compteur: { appels: 0 } });
        H.v('4g. une préparation qui lève : échec, 0 appel', [r2.echec, r2.lecture], [true, 'incertain']);
        const ctl = new AbortController(); ctl.abort();
        const lecteur = lecteurDe([{ staff: 'oui' }, { staff: 'oui' }]); const c3 = { appels: 0 };
        const r3 = await LT.creerFournisseur({ preparer: prep, lecteur })({ image: IMG, corps: {}, compteur: c3, signal: ctl.signal });
        H.v('4h. le signal d\'abandon est déjà tombé : aucun appel ne part (échec « interrompue »)', [r3.echec, c3.appels, lecteur.vus.length], [true, 0, 0]);
    }

    // ── 5. UNE FOIS PAR SCAN, et les compteurs
    LT.reinitialiser();
    H.v('5a. premiereFois : vrai une fois, faux ensuite ; sans identifiant : faux', [LT.premiereFois('s1'), LT.premiereFois('s1'), LT.premiereFois(''), LT.premiereFois(7)], [true, false, false, false]);
    H.v('5b. les compteurs nomment ce qui est compté (declenchees, affirmees, jumbo, nonConfirmees, echecs, appels, dejaTentees, nonFaisables)', Object.keys(LT.compteurs()), ['declenchees', 'affirmees', 'jumbo', 'nonConfirmees', 'echecs', 'appels', 'dejaTentees', 'nonFaisables']);
    H.bilan();
})().catch(x => { console.error(x); process.exitCode = 1; });
