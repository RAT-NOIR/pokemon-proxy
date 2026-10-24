// node audit-catalogue/test-classement.js — les définitions de l'audit (brief S8/AUDIT) : classe du visuel, état de la comparaison, classe de la fiche.
// Fonctions PURES : aucune base, aucun fichier. Chaque cas nomme la règle qu'il fixe.
const C = require('./classement');

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

// ── DEUXIÈME PASSAGE (après les seuils du coordinateur) : la zone entre les deux seuils ne conclut pas
const S = { conforme: 0.2, faux: 0.5 };
verifier('distance sous le seuil conforme : CONFORME', C.classerFinal({ classe: 'A_COMPARER', comparaison: { comparable: true }, distance: 0.1, seuils: S }), 'CONFORME');
verifier('distance au seuil conforme (inclus) : CONFORME', C.classerFinal({ classe: 'A_COMPARER', comparaison: { comparable: true }, distance: 0.2, seuils: S }), 'CONFORME');
verifier('distance au seuil faux (inclus) : PROBABLEMENT FAUX', C.classerFinal({ classe: 'A_COMPARER', comparaison: { comparable: true }, distance: 0.5, seuils: S }), 'PROBABLEMENT_FAUX');
verifier('entre les deux : INVÉRIFIABLE, l\'empreinte ne conclut pas', C.classerFinal({ classe: 'A_COMPARER', comparaison: { comparable: true }, distance: 0.3, seuils: S }), 'INVERIFIABLE');
verifier('non comparable : INVÉRIFIABLE', C.classerFinal({ classe: 'A_COMPARER', comparaison: { comparable: false, motif: 'pas-de-copie-locale' }, distance: null, seuils: S }), 'INVERIFIABLE');
verifier('la classe principale EMPRUNTÉ ne change pas (la comparaison s\'affiche à côté)', C.classerFinal({ classe: 'EMPRUNTE', comparaison: { comparable: true }, distance: 0.9, seuils: S }), 'EMPRUNTE');
verifier('MANQUANT reste MANQUANT', C.classerFinal({ classe: 'MANQUANT', comparaison: { comparable: false }, distance: null, seuils: S }), 'MANQUANT');
let leve = null; try { C.classerFinal({ classe: 'A_COMPARER', comparaison: { comparable: true }, distance: 0.1, seuils: { conforme: 0.6, faux: 0.5 } }); } catch (e) { leve = /seuils/.test(e.message); }
verifier('des seuils incohérents (conforme > faux) LÈVENT', leve, true);
leve = null; try { C.classerFinal({ classe: 'A_COMPARER', comparaison: { comparable: true }, distance: 0.1 }); } catch (e) { leve = /seuils/.test(e.message); }
verifier('sans seuils, rien ne se classe : LÈVE (les seuils ne se règlent pas à la main)', leve, true);

// ── FICHE
const f = (o = {}) => ({ lignes: [{ carteId: 1, preuve: 'set+numero', numeroFiche: '12' }], ficheSite: { carteId: 1, numero: '12' }, temoinContredit: false, setANumeros: true, ...o });
verifier('aucune ligne : SANS_LIGNE', C.classerFiche({ lignes: [], ficheSite: null }), { classe: 'SANS_LIGNE', motifs: [] });
verifier('une ligne, pas de fiche du site : LIGNE_SANS_FICHE', C.classerFiche(f({ ficheSite: null })), { classe: 'LIGNE_SANS_FICHE', motifs: [] });
verifier('deux lignes sur deux cartes ET aucune fiche du site (la règle ne sert pas un produit à deux fiches) : LIGNE_SANS_FICHE, mais « plusieurs-cartes » reste écrit',
    C.classerFiche(f({ ficheSite: null, lignes: [{ carteId: 1, preuve: 'set+numero' }, { carteId: 2, preuve: 'set+numero' }] })), { classe: 'LIGNE_SANS_FICHE', motifs: ['plusieurs-cartes'] });
verifier('une ligne par le numéro, fiche du site : FICHE_OK', C.classerFiche(f()), { classe: 'FICHE_OK', motifs: [] });
verifier('deux cartes distinctes pour un produit : douteuse', C.classerFiche(f({ lignes: [{ carteId: 1, preuve: 'set+numero' }, { carteId: 2, preuve: 'set+numero' }] })), { classe: 'FICHE_DOUTEUSE', motifs: ['plusieurs-cartes'] });
verifier('deux lignes de la MÊME carte : pas « plusieurs cartes »', C.classerFiche(f({ lignes: [{ carteId: 1, preuve: 'set+numero' }, { carteId: 1, preuve: 'setlist+numero' }] })), { classe: 'FICHE_OK', motifs: [] });
verifier('preuve par le nom seul (set+nom) : douteuse', C.classerFiche(f({ lignes: [{ carteId: 1, preuve: 'set+nom' }] })), { classe: 'FICHE_DOUTEUSE', motifs: ['preuve-nom-seul'] });
verifier('preuve par le nom seul (setlist+nom) : douteuse', C.classerFiche(f({ lignes: [{ carteId: 1, preuve: 'setlist+nom' }] })), { classe: 'FICHE_DOUTEUSE', motifs: ['preuve-nom-seul'] });
verifier('nom + attaques : PAS un nom seul', C.classerFiche(f({ lignes: [{ carteId: 1, preuve: 'set+nom+attaques' }] })), { classe: 'FICHE_OK', motifs: [] });
verifier('un nom seul ET une preuve par le numéro sur la même carte : la meilleure preuve compte', C.classerFiche(f({ lignes: [{ carteId: 1, preuve: 'set+nom' }, { carteId: 1, preuve: 'set+numero' }] })), { classe: 'FICHE_OK', motifs: [] });
verifier('fiche sans numéro dans un set qui en a : douteuse', C.classerFiche(f({ ficheSite: { carteId: 1, numero: null } })), { classe: 'FICHE_DOUTEUSE', motifs: ['sans-numero-set-numerote'] });
verifier('fiche sans numéro dans un set qui n\'en a aucun : pas douteuse', C.classerFiche(f({ ficheSite: { carteId: 1, numero: null }, setANumeros: false })), { classe: 'FICHE_OK', motifs: [] });
verifier('contredite par le témoin du nom : douteuse', C.classerFiche(f({ temoinContredit: true })), { classe: 'FICHE_DOUTEUSE', motifs: ['contredite-par-le-nom'] });
verifier('les motifs se cumulent, dans l\'ordre fixe', C.classerFiche(f({ lignes: [{ carteId: 1, preuve: 'set+nom' }, { carteId: 2, preuve: 'set+nom' }], ficheSite: { carteId: 1, numero: null }, temoinContredit: true })),
    { classe: 'FICHE_DOUTEUSE', motifs: ['plusieurs-cartes', 'preuve-nom-seul', 'sans-numero-set-numerote', 'contredite-par-le-nom'] });
verifier('une ligne sans preuve écrite : la preuve est INCONNUE, pas un nom seul', C.classerFiche(f({ lignes: [{ carteId: 1 }] })), { classe: 'FICHE_OK', motifs: [] });

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
