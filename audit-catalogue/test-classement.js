// node audit-catalogue/test-classement.js — les définitions de l'audit (brief S8/AUDIT) : classe du visuel, état de la comparaison, classe de la fiche.
// Fonctions PURES : aucune base, aucun fichier. Chaque cas nomme la règle qu'il fixe.
const C = require(process.env.CLASSEMENT_MODULE || './classement');   // la variable ne sert qu'à collecte-cartes/test-mutation-confirmation.js (module muté, jamais en production)

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

// ── VISUEL : l'ordre MANQUANT > EMPRUNTÉ > BASSE DÉFINITION > à comparer
verifier('aucune entrée servie : MANQUANT, avec son motif', C.classerVisuel({ servi: null, motifManquant: 'sans-ligne' }), { classe: 'MANQUANT', motifs: ['sans-ligne'] });
verifier('MANQUANT sans motif donné : « inconnu », jamais un vide', C.classerVisuel({ servi: null }), { classe: 'MANQUANT', motifs: ['inconnu'] });
verifier('substitut : EMPRUNTÉ', C.classerVisuel({ servi: { visuel: 'substitut', basseDefinition: false } }), { classe: 'EMPRUNTE', motifs: ['substitut'] });
verifier('autre-tirage : EMPRUNTÉ', C.classerVisuel({ servi: { visuel: 'autre-tirage', basseDefinition: null } }), { classe: 'EMPRUNTE', motifs: ['autre-tirage'] });
verifier('image portant imageEmprunteeTirage : EMPRUNTÉ, même « du-set »', C.classerVisuel({ servi: { visuel: 'du-set', imageEmprunteeTirage: true } }), { classe: 'EMPRUNTE', motifs: ['image-empruntee-tirage'] });
verifier('basseDefinition true : BASSE DÉFINITION', C.classerVisuel({ servi: { visuel: 'du-set', basseDefinition: true } }), { classe: 'BASSE_DEFINITION', motifs: ['basse-definition'] });
verifier('EMPRUNTÉ ET basse définition : la classe suit l\'ordre, le second motif reste écrit', C.classerVisuel({ servi: { visuel: 'substitut', basseDefinition: true } }), { classe: 'EMPRUNTE', motifs: ['substitut', 'basse-definition'] });
verifier('basseDefinition absent ou false : pas de basse définition (un absent n\'est pas un vrai)', C.classerVisuel({ servi: { visuel: 'du-set', basseDefinition: null } }), { classe: 'A_COMPARER', motifs: [] });
verifier('du-set sans marque : à comparer', C.classerVisuel({ servi: { visuel: 'du-set', basseDefinition: false, imageEmprunteeTirage: false } }), { classe: 'A_COMPARER', motifs: [] });

// ── COMPARAISON : INVÉRIFIABLE tant qu'une des deux copies manque ou ne dit rien
const bon = { copieLocale: true, placeholderCm: false, empreinteNous: true, empreinteCm: true, distance: 0.1 };
verifier('tout présent : comparable', C.etatComparaison(bon), { comparable: true, motif: null });
verifier('pas de copie locale Cardmarket', C.etatComparaison({ ...bon, copieLocale: false }), { comparable: false, motif: 'pas-de-copie-locale' });
verifier('copie Cardmarket « non disponible »', C.etatComparaison({ ...bon, placeholderCm: true }), { comparable: false, motif: 'copie-cardmarket-non-disponible' });
verifier('notre visuel illisible', C.etatComparaison({ ...bon, empreinteNous: false }), { comparable: false, motif: 'visuel-nous-illisible' });
verifier('empreinte Cardmarket sans contraste : ne peut pas conclure', C.etatComparaison({ ...bon, empreinteCm: false }), { comparable: false, motif: 'empreinte-cardmarket-inexploitable' });
verifier('distance non finie : ne peut pas conclure', C.etatComparaison({ ...bon, distance: NaN }), { comparable: false, motif: 'distance-non-finie' });
verifier('l\'ordre des motifs : la copie absente passe avant tout', C.etatComparaison({ copieLocale: false, placeholderCm: true, empreinteNous: false, empreinteCm: false, distance: NaN }), { comparable: false, motif: 'pas-de-copie-locale' });

// (les seuils, l'INCERTAIN, le format et la finition : test-second-passage.js — le premier passage posait 0,2/0,5 en paramètre, remplacé par les constantes SEUILS du coordinateur)
verifier('classerFinal : MANQUANT reste MANQUANT', C.classerFinal({ classe: 'MANQUANT', comparaison: { comparable: false }, distance: null }), 'MANQUANT');
verifier('classerFinal : BASSE DÉFINITION reste BASSE DÉFINITION', C.classerFinal({ classe: 'BASSE_DEFINITION', comparaison: { comparable: true }, distance: 0.9 }), 'BASSE_DEFINITION');

// ── FICHE (les `infos` et `sans-numero` : test-second-passage.js ; ici classe et motifs)
const brut = C.classerFiche;
const CF = a => { const r = brut(a); return { classe: r.classe, motifs: r.motifs }; };
const f = (o = {}) => ({ lignes: [{ carteId: 1, preuve: 'set+numero', numeroFiche: '12' }], ficheSite: { carteId: 1, numero: '12' }, temoinContredit: false, setANumeros: true, ...o });
verifier('aucune ligne : SANS_LIGNE', CF({ lignes: [], ficheSite: null }), { classe: 'SANS_LIGNE', motifs: [] });
verifier('une ligne, pas de fiche du site : LIGNE_SANS_FICHE', CF(f({ ficheSite: null })), { classe: 'LIGNE_SANS_FICHE', motifs: [] });
verifier('deux lignes sur deux cartes ET aucune fiche du site (la règle ne sert pas un produit à deux fiches) : LIGNE_SANS_FICHE, mais « plusieurs-cartes » reste écrit',
    CF(f({ ficheSite: null, lignes: [{ carteId: 1, preuve: 'set+numero' }, { carteId: 2, preuve: 'set+numero' }] })), { classe: 'LIGNE_SANS_FICHE', motifs: ['plusieurs-cartes'] });
verifier('une ligne par le numéro, fiche du site : FICHE_OK', CF(f()), { classe: 'FICHE_OK', motifs: [] });
verifier('deux cartes distinctes pour un produit : douteuse', CF(f({ lignes: [{ carteId: 1, preuve: 'set+numero' }, { carteId: 2, preuve: 'set+numero' }] })), { classe: 'FICHE_DOUTEUSE', motifs: ['plusieurs-cartes'] });
verifier('deux lignes de la MÊME carte : pas « plusieurs cartes »', CF(f({ lignes: [{ carteId: 1, preuve: 'set+numero' }, { carteId: 1, preuve: 'setlist+numero' }] })), { classe: 'FICHE_OK', motifs: [] });
verifier('preuve par le nom seul (set+nom) : douteuse', CF(f({ lignes: [{ carteId: 1, preuve: 'set+nom' }] })), { classe: 'FICHE_DOUTEUSE', motifs: ['preuve-nom-seul'] });
verifier('preuve par le nom seul (setlist+nom) : douteuse', CF(f({ lignes: [{ carteId: 1, preuve: 'setlist+nom' }] })), { classe: 'FICHE_DOUTEUSE', motifs: ['preuve-nom-seul'] });
verifier('nom + attaques : PAS un nom seul', CF(f({ lignes: [{ carteId: 1, preuve: 'set+nom+attaques' }] })), { classe: 'FICHE_OK', motifs: [] });
verifier('un nom seul ET une preuve par le numéro sur la même carte : la meilleure preuve compte', CF(f({ lignes: [{ carteId: 1, preuve: 'set+nom' }, { carteId: 1, preuve: 'set+numero' }] })), { classe: 'FICHE_OK', motifs: [] });
verifier('fiche sans numéro dont le numéro du produit est connu : douteuse', CF(f({ ficheSite: { carteId: 1, numero: null }, numeroConnu: true })), { classe: 'FICHE_DOUTEUSE', motifs: ['sans-numero'] });
verifier('fiche sans numéro, numéro du produit inconnu : pas douteuse (la fiche « n° ? » du site)', CF(f({ ficheSite: { carteId: 1, numero: null }, setANumeros: false })), { classe: 'FICHE_OK', motifs: [] });
verifier('contredite par le témoin du nom : douteuse', CF(f({ temoinContredit: true })), { classe: 'FICHE_DOUTEUSE', motifs: ['contredite-par-le-nom'] });
verifier('les motifs se cumulent, dans l\'ordre fixe', CF(f({ lignes: [{ carteId: 1, preuve: 'set+nom' }, { carteId: 2, preuve: 'set+nom' }], ficheSite: { carteId: 1, numero: null }, temoinContredit: true, numeroConnu: true })),
    { classe: 'FICHE_DOUTEUSE', motifs: ['plusieurs-cartes', 'preuve-nom-seul', 'sans-numero', 'contredite-par-le-nom'] });
verifier('une ligne sans preuve écrite : la preuve est INCONNUE, pas un nom seul', CF(f({ lignes: [{ carteId: 1 }] })), { classe: 'FICHE_OK', motifs: [] });

// ── B1 : la confirmation par deux sources LÈVE le seul motif « preuve-nom-seul » (jamais les autres), et seulement si elle concorde avec la ligne actuelle
const nomSeul = { lignes: [{ carteId: 1, preuve: 'set+nom' }] };
const CFI = a => { const r = brut(a); return { classe: r.classe, motifs: r.motifs, infos: r.infos }; };
verifier('B1 : nom seul + confirmation concordante : FICHE_OK, nommée', CFI(f({ ...nomSeul, confirmation: { concorde: true } })), { classe: 'FICHE_OK', motifs: [], infos: ['confirmee-deux-sources'] });
verifier('B1 : nom seul + confirmation qui ne concorde plus : douteuse comme avant, la confirmation ignorée est nommée', CFI(f({ ...nomSeul, confirmation: { concorde: false } })), { classe: 'FICHE_DOUTEUSE', motifs: ['preuve-nom-seul'], infos: ['confirmation-ignoree'] });
verifier('B1 : nom seul sans confirmation : inchangé', CFI(f({ ...nomSeul })), { classe: 'FICHE_DOUTEUSE', motifs: ['preuve-nom-seul'], infos: [] });
verifier('B1 : nom seul + confirmation null : inchangé', CFI(f({ ...nomSeul, confirmation: null })), { classe: 'FICHE_DOUTEUSE', motifs: ['preuve-nom-seul'], infos: [] });
verifier('B1 : confirmée mais sans numéro (numéro du produit connu) : reste douteuse par « sans-numero » seul — la confirmation ne numérote pas la fiche', CFI(f({ ...nomSeul, ficheSite: { carteId: 1, numero: null }, numeroConnu: true, confirmation: { concorde: true } })), { classe: 'FICHE_DOUTEUSE', motifs: ['sans-numero'], infos: ['sans-numero-set-numerote', 'confirmee-deux-sources'] });
verifier('B1 : confirmée mais contredite par le témoin du nom : reste douteuse', CFI(f({ ...nomSeul, temoinContredit: true, confirmation: { concorde: true } })), { classe: 'FICHE_DOUTEUSE', motifs: ['contredite-par-le-nom'], infos: ['confirmee-deux-sources'] });
verifier('B1 : confirmée mais produit joint à deux cartes : reste douteuse', CFI(f({ lignes: [{ carteId: 1, preuve: 'set+nom' }, { carteId: 2, preuve: 'set+nom' }], confirmation: { concorde: true } })), { classe: 'FICHE_DOUTEUSE', motifs: ['plusieurs-cartes'], infos: ['confirmee-deux-sources'] });
verifier('B1 : une preuve par le numéro n\'a rien à lever : la confirmation n\'est pas annoncée', CFI(f({ confirmation: { concorde: true } })), { classe: 'FICHE_OK', motifs: [], infos: [] });
verifier('B1 : une confirmation qui ne concorde plus sur une fiche sûre est quand même comptée comme ignorée', CFI(f({ confirmation: { concorde: false } })), { classe: 'FICHE_OK', motifs: [], infos: ['confirmation-ignoree'] });
verifier('B1 : sans fiche du site, la confirmation ne change rien', CFI(f({ ...nomSeul, ficheSite: null, confirmation: { concorde: true } })), { classe: 'LIGNE_SANS_FICHE', motifs: [], infos: [] });
verifier('B1 : sans ligne, la confirmation ne change rien', CFI({ lignes: [], ficheSite: null, confirmation: { concorde: true } }), { classe: 'SANS_LIGNE', motifs: [], infos: [] });
verifier('B1 : « concorde » doit être EXACTEMENT true (une valeur truthy quelconque ne lève rien)', CFI(f({ ...nomSeul, confirmation: { concorde: 'oui' } })), { classe: 'FICHE_DOUTEUSE', motifs: ['preuve-nom-seul'], infos: ['confirmation-ignoree'] });

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
