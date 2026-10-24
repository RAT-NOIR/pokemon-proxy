// node audit-catalogue/test-compteurs-abc.js — les compteurs A, B, C (brief S8/PHASE3A-SUITE). Fonctions PURES et écriture dans un dossier TEMPORAIRE : aucune base, aucun dossier du testeur.
const fs = require('fs');
const os = require('os');
const path = require('path');
const K = require('./compteurs-abc');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const leve = (nom, f, motif) => {
    try { f(); ko++; console.log(`❌ ${nom} : aurait dû lever`); } catch (e) {
        if (!motif || motif.test(e.message)) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom} : a levé autre chose : ${e.message}`); }
    }
};

// ── fixture : 10 produits dans 3 expansions de 2 familles
const P = (idProduct, idExpansion, fiche, visuel) => ({ idProduct, idExpansion, name: `p${idProduct}`, fiche: { motifs: [], ...fiche }, visuel: { motifs: [], entree: null, ...visuel } });
const SL = { classe: 'SANS_LIGNE' }, LSF = { classe: 'LIGNE_SANS_FICHE' }, OK = { classe: 'FICHE_OK' };
const DT = motifs => ({ classe: 'FICHE_DOUTEUSE', motifs });
const MQ = motifs => ({ classe: 'MANQUANT', motifs });
const VRAI = { classe: 'A_COMPARER', entree: { visuel: 'du-set', mention: null } };
const produits = [
    P(1, 10, SL, MQ(['sans-ligne'])),
    P(2, 10, SL, MQ(['sans-ligne'])),
    P(3, 10, OK, VRAI),
    P(4, 20, LSF, MQ(['sans-fiche-du-site'])),
    P(5, 20, DT(['sans-numero']), { classe: 'BASSE_DEFINITION', entree: { visuel: 'du-set', mention: null }, motifs: ['basse-definition'] }),
    P(6, 20, DT(['preuve-nom-seul', 'sans-numero']), { classe: 'EMPRUNTE', entree: { visuel: 'autre-tirage', mention: 'Image du tirage normal' }, motifs: ['autre-tirage'] }),
    P(7, 20, OK, { classe: 'EMPRUNTE', entree: { visuel: 'autre-tirage', mention: null }, motifs: ['autre-tirage'] }),
    P(8, 30, SL, MQ(['sans-ligne'])),
    P(9, 30, OK, MQ(['aucun-visuel'])),
    P(10, 30, OK, MQ(['emprunt-refuse-par-api', 'repli-refuse:wcd'])),
];
const lignesSet = [
    { idExpansion: 10, codeSet: 'AAA', nom: 'Alpha', famille: 'occidental' },
    { idExpansion: 20, codeSet: 'BBB', nom: 'Beta', famille: 'japonais' },
    { idExpansion: 30, codeSet: 'CCC', nom: 'Gamma', famille: 'occidental' },
];
const den = { catalogue: 12, cartesCode: 2 };
const R = K.calculerCompteurs({ produits, lignesSet, denominateur: den, rang: 20 });

verifier('dénominateur : catalogue, cartes-code, produits', R.denominateur, { catalogue: 12, cartesCode: 2, produits: 10 });
verifier('A : produits sans ligne et lignes sans fiche, comptés à côté', { s: R.A.sansLigne, l: R.A.ligneSansFiche }, { s: 3, l: 1 });
const tri = o => Object.fromEntries(Object.entries(o).sort());
verifier('A par famille', tri(R.A.parFamille), { japonais: { produits: 4, sansLigne: 0, ligneSansFiche: 1 }, occidental: { produits: 6, sansLigne: 3, ligneSansFiche: 0 } });
verifier('A par expansion : classées par produits sans ligne, les ex aequo par expansion', R.A.parExpansionSansLigne.map(e => [e.idExpansion, e.sansLigne]), [[10, 2], [30, 1]]);
verifier('A par expansion (lignes sans fiche) : seulement celles qui en ont', R.A.parExpansionLigneSansFiche.map(e => [e.idExpansion, e.ligneSansFiche]), [[20, 1]]);
verifier('A par expansion porte le code, le nom, la famille et le nombre de produits', R.A.parExpansionSansLigne[0], { idExpansion: 10, codeSet: 'AAA', nom: 'Alpha', famille: 'occidental', produits: 3, sansLigne: 2, ligneSansFiche: 0 });
verifier('B : fiches douteuses, motifs non exclusifs', { n: R.B.douteuses, m: tri(R.B.motifs) }, { n: 2, m: { 'preuve-nom-seul': 1, 'sans-numero': 2 } });
verifier('B : le marquage « à confirmer » n\'existe pas, et la sortie le dit', R.B.marquageAConfirmer, 'inexistant');
verifier('C : vrai scan, emprunté, basse définition, aucun visuel', { v: R.C.vraiScan, e: R.C.emprunte, b: R.C.basseDefinition, a: R.C.aucunVisuel }, { v: 1, e: 2, b: 1, a: 6 });
verifier('C : l\'emprunté se partage entre avec et sans mention', { m: R.C.empruntesAvecMention, s: R.C.empruntesSansMention }, { m: 1, s: 1 });
verifier('C : l\'aucun visuel se partage entre sans ligne (compté en A) et avec ligne', { s: R.C.aucunVisuelSansLigne, l: R.C.aucunVisuelAvecLigne }, { s: 3, l: 3 });
verifier('C : l\'emprunt que l\'API refuse de servir se compte à part (un visuel existe)', R.C.empruntRefuseParApi, 1);
verifier('C : motifs de l\'aucun visuel', tri(R.C.motifsAucun), { 'aucun-visuel': 1, 'emprunt-refuse-par-api': 1, 'repli-refuse:wcd': 1, 'sans-fiche-du-site': 1, 'sans-ligne': 3 });
verifier('contrôle : les classes de fiche et de visuel somment au dénominateur', R.controles, { sommeFiches: 10, sommeVisuels: 10 });
verifier('résumé plat pour l\'historique', R.resume, { produits: 10, sansLigne: 3, ligneSansFiche: 1, douteuses: 2, vraiScan: 1, emprunte: 2, basseDefinition: 1, aucunVisuel: 6 });

// ── le rang : les N premières seulement
const beaucoup = [];
for (let e = 1; e <= 25; e++) for (let i = 0; i < e; i++) beaucoup.push(P(e * 100 + i, e, SL, MQ(['sans-ligne'])));
const lsBeaucoup = Array.from({ length: 25 }, (_, k) => ({ idExpansion: k + 1, codeSet: `X${k + 1}`, nom: `x${k + 1}`, famille: 'occidental' }));
const R2 = K.calculerCompteurs({ produits: beaucoup, lignesSet: lsBeaucoup, denominateur: { catalogue: beaucoup.length, cartesCode: 0 }, rang: 20 });
verifier('les 20 premières expansions seulement, la plus grande d\'abord', { n: R2.A.parExpansionSansLigne.length, premiere: R2.A.parExpansionSansLigne[0].idExpansion, derniere: R2.A.parExpansionSansLigne[19].idExpansion, total: R2.A.expansionsConcernees }, { n: 20, premiere: 25, derniere: 6, total: 25 });

// ── les gardes : un repli sur le vide ne se voit pas (CLAUDE.md §41)
leve('population vide : lève', () => K.calculerCompteurs({ produits: [], lignesSet, denominateur: { catalogue: 0, cartesCode: 0 } }), /vide/);
leve('catalogue − cartes-code ≠ produits : lève', () => K.calculerCompteurs({ produits, lignesSet, denominateur: { catalogue: 99, cartesCode: 2 } }), /dénominateur/);
leve('classe de fiche inconnue : lève (jamais un repli silencieux)', () => K.calculerCompteurs({ produits: [P(1, 10, { classe: 'AUTRE' }, VRAI)], lignesSet, denominateur: { catalogue: 1, cartesCode: 0 } }), /classe de fiche/);
leve('classe de visuel inconnue : lève', () => K.calculerCompteurs({ produits: [P(1, 10, OK, { classe: 'CONFORME' })], lignesSet, denominateur: { catalogue: 1, cartesCode: 0 } }), /classe de visuel/);
leve('expansion absente de la mesure des sets : lève', () => K.calculerCompteurs({ produits: [P(1, 99, OK, VRAI)], lignesSet, denominateur: { catalogue: 1, cartesCode: 0 } }), /expansion/);
leve('aucun produit à seuil : une classe à seuil (CONFORME) dans un produit est refusée', () => K.calculerCompteurs({ produits: [P(1, 10, OK, { classe: 'PROBABLEMENT_FAUX' })], lignesSet, denominateur: { catalogue: 1, cartesCode: 0 } }), /classe de visuel/);

// ── l'écart : contre la première mesure du jour et contre la précédente
const ligne = (jour, heure, o) => ({ le: `${jour}T${heure}:00.000Z`, jour, denominateur: { catalogue: 12, cartesCode: 2, produits: 10 }, resume: { produits: 10, sansLigne: 5, ligneSansFiche: 1, douteuses: 3, vraiScan: 1, emprunte: 2, basseDefinition: 1, aucunVisuel: 6, ...o }, fichier: 'f' });
const H = [ligne('2026-10-23', '09:00', { sansLigne: 9 }), ligne('2026-10-24', '09:00', { sansLigne: 7 }), ligne('2026-10-24', '12:00', { sansLigne: 5 })];
const E = K.ecartHistorique({ jour: '2026-10-24', denominateur: { catalogue: 12, cartesCode: 2, produits: 10 }, resume: R.resume }, H);
verifier('écart contre la première mesure du JOUR (pas celle de la veille)', { f: E.premiereDuJour.fichier, a: E.premiereDuJour.ecarts.sansLigne }, { f: 'f', a: -4 });
verifier('écart contre la précédente (la dernière de l\'historique)', E.precedente.ecarts.sansLigne, -2);
verifier('un écart porte sur chaque compteur du résumé', Object.keys(E.precedente.ecarts), ['produits', 'sansLigne', 'ligneSansFiche', 'douteuses', 'vraiScan', 'emprunte', 'basseDefinition', 'aucunVisuel']);
verifier('même dénominateur : aucun avertissement', E.precedente.memeDenominateur, true);
const E2 = K.ecartHistorique({ jour: '2026-10-24', denominateur: { catalogue: 13, cartesCode: 2, produits: 11 }, resume: { ...R.resume, produits: 11 } }, H);
verifier('dénominateur différent : dit, jamais un écart présenté comme un progrès', E2.precedente.memeDenominateur, false);
verifier('historique vide : ni première du jour ni précédente, et on le dit', K.ecartHistorique({ jour: '2026-10-24', denominateur: den, resume: R.resume }, []), { premiereDuJour: null, precedente: null });
verifier('aucune mesure ce jour-là : la première du jour n\'existe pas, la précédente si', (() => { const r = K.ecartHistorique({ jour: '2026-10-25', denominateur: { catalogue: 12, cartesCode: 2, produits: 10 }, resume: R.resume }, H); return [r.premiereDuJour, r.precedente !== null]; })(), [null, true]);

// ── la lecture de l'historique : une ligne illisible lève (une ligne ignorée en silence fausserait « la précédente »)
leve('historique : une ligne illisible lève', () => K.lireHistorique('{"jour":"2026-10-24"}\n{pas du json\n'), /ligne 2/);
verifier('historique : lignes vides ignorées, ordre conservé', K.lireHistorique('{"a":1}\n\n{"a":2}\n').map(x => x.a), [1, 2]);

// ── la liste légère des produits (même forme que audit-produits.json pour les outils de la phase 3a : idProduct, idExpansion, classeFiche…)
const lsLangue = lignesSet.map(l => ({ ...l, langue: l.famille === 'japonais' ? 'jp' : 'intl', type: 'extension', tamponnee: l.idExpansion === 30 ? 'metacarte' : null }));
const L = K.listeLegere(produits, lsLangue);
verifier('liste légère : une entrée par produit, classes de fiche et de visuel, famille et langue de l\'expansion', { n: L.length, p1: L[0], p5: L[4] },
    { n: 10, p1: { idProduct: 1, idExpansion: 10, name: 'p1', famille: 'occidental', langue: 'intl', type: 'extension', tamponnee: null, classeFiche: 'SANS_LIGNE', motifsFiche: [], classeVisuel: 'MANQUANT', motifsVisuel: ['sans-ligne'] },
        p5: { idProduct: 5, idExpansion: 20, name: 'p5', famille: 'japonais', langue: 'jp', type: 'extension', tamponnee: null, classeFiche: 'FICHE_DOUTEUSE', motifsFiche: ['sans-numero'], classeVisuel: 'BASSE_DEFINITION', motifsVisuel: ['basse-definition'] } });
leve('liste légère : une expansion absente de la mesure des sets lève', () => K.listeLegere([P(1, 99, OK, VRAI)], lsLangue), /expansion/);

// ── l'écriture : un dossier temporaire, la garde sur la racine, l'ajout à l'historique
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'compteurs-abc-'));
try {
    const dossier = path.join(tmp, 'COMPTEURS');
    const now = new Date(2026, 9, 24, 14, 5);   // local : 24/10/2026 14:05
    const r1 = K.ecrireSorties({ dossier, resultat: { ...R, jour: '2026-10-24', le: now.toISOString() }, maintenant: now });
    verifier('le fichier porte la date et l\'heure locales', path.basename(r1.fichier), 'abc-2026-10-24-1405.json');
    verifier('le JSON écrit se relit', JSON.parse(fs.readFileSync(r1.fichier, 'utf8')).resume.sansLigne, 3);
    verifier('la liste légère n\'est écrite que si on la donne', r1.produits, null);
    const r3 = K.ecrireSorties({ dossier, resultat: { ...R, jour: '2026-10-24', le: now.toISOString() }, maintenant: now, produitsLegers: L });
    verifier('la liste légère s\'écrit à côté, même horodatage', [path.basename(r3.produits), JSON.parse(fs.readFileSync(r3.produits, 'utf8')).length], ['etat-abc-2026-10-24-1405.json', 10]);
    K.ecrireSorties({ dossier, resultat: { ...R, jour: '2026-10-24', le: now.toISOString() }, maintenant: new Date(2026, 9, 24, 15, 0) });
    const lignes = K.lireHistorique(fs.readFileSync(path.join(dossier, 'historique.jsonl'), 'utf8'));
    verifier('l\'historique AJOUTE (trois lignes après trois écritures)', lignes.length, 3);
    verifier('la ligne d\'historique nomme le fichier, le jour, le dénominateur et le résumé', Object.keys(lignes[0]), ['le', 'jour', 'denominateur', 'resume', 'fichier']);
    leve('la garde refuse tout chemin hors de la racine (un nom qui remonte)', () => K.sortieSure(dossier, '..\\ailleurs.json'), /hors des racines/);
    leve('la garde refuse un dossier d\'audit : la racine est COMPTEURS seul', () => K.sortieSure(path.join(tmp, 'AUDIT'), 'x.json', [dossier]), /hors des racines/);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
verifier('le dossier par défaut est COMPTEURS, jamais AUDIT', /S8\\COMPTEURS$/.test(K.DOSSIER_COMPTEURS) && !/AUDIT/.test(K.DOSSIER_COMPTEURS), true);

// ── l'explication de l'écart avec l'audit du matin : par produit
const matin = [{ idProduct: 1, classe: 'SANS_LIGNE' }, { idProduct: 2, classe: 'SANS_LIGNE' }, { idProduct: 3, classe: 'FICHE_OK' }, { idProduct: 4, classe: 'FICHE_OK' }, { idProduct: 8, classe: 'SANS_LIGNE' }];
const maintenant = [P(1, 10, OK, VRAI), P(2, 10, SL, MQ(['sans-ligne'])), P(3, 10, SL, MQ(['sans-ligne'])), P(4, 10, SL, MQ(['sans-ligne'])), P(9, 10, SL, MQ(['sans-ligne']))];
const X = K.expliquerEcartSansLigne({ matin, produits: maintenant, detaches: [3] });
verifier('écart : sortis (une ligne écrite), restés, entrés par détachement connu, entrés autrement, nouveaux au catalogue',
    { sortis: X.sortis.length, restes: X.restes, entresDetaches: X.entresDetaches, entresAutres: X.entresAutres.length, nouveaux: X.nouveauxAuCatalogue, disparus: X.disparusDuCatalogue },
    { sortis: 1, restes: 1, entresDetaches: 1, entresAutres: 1, nouveaux: 1, disparus: 1 });
verifier('écart : le compte retombe — avant − sortis + entrés = maintenant', X.bilan, { matin: 3, sortis: 1, disparus: 1, entres: 3, maintenant: 4 });
// ── les transitions par produit contre l'audit du matin : B et C bougent aussi quand on écrit des lignes
const matin2 = [
    { idProduct: 1, fiche: { classe: 'SANS_LIGNE', motifs: [] }, visuel: { classe: 'MANQUANT' } },
    { idProduct: 3, fiche: { classe: 'FICHE_OK', motifs: [] }, visuel: { classe: 'A_COMPARER' } },
    { idProduct: 4, fiche: { classe: 'FICHE_OK', motifs: [] }, visuel: { classe: 'EMPRUNTE' } },
    { idProduct: 5, fiche: { classe: 'FICHE_OK', motifs: [] }, visuel: { classe: 'BASSE_DEFINITION' } },
    { idProduct: 99, fiche: { classe: 'FICHE_OK', motifs: [] }, visuel: { classe: 'A_COMPARER' } },
];
const T = K.transitions({ matin: matin2, produits });
verifier('transitions de fiche : de la classe du matin à celle d\'aujourd\'hui', T.fiche, { 'FICHE_OK→FICHE_DOUTEUSE': 1, 'FICHE_OK→FICHE_OK': 1, 'FICHE_OK→LIGNE_SANS_FICHE': 1, 'SANS_LIGNE→SANS_LIGNE': 1 });
verifier('transitions de visuel', T.visuel, { 'A_COMPARER→A_COMPARER': 1, 'BASSE_DEFINITION→BASSE_DEFINITION': 1, 'EMPRUNTE→MANQUANT': 1, 'MANQUANT→MANQUANT': 1 });
verifier('les produits d\'aujourd\'hui absents du matin sont comptés à part (nouveaux), ceux du matin absents d\'aujourd\'hui aussi (disparus)', { nouveaux: T.nouveaux, disparus: T.disparus }, { nouveaux: 6, disparus: 1 });
verifier('entrées en FICHE_DOUTEUSE : d\'où elles viennent et pour quel motif', T.entreesDouteuses, { depuis: { 'FICHE_OK': 1 }, motifs: { 'sans-numero': 1 } });
// ── comparer deux états (avant/après un lot SIMULÉ) : ce que le lot change pour ses produits, et ce qu'il change AILLEURS (effets de bord)
const av = [
    { idProduct: 1, fiche: { classe: 'SANS_LIGNE', motifs: [] }, visuel: { classe: 'MANQUANT', motifs: ['sans-ligne'] } },
    { idProduct: 2, fiche: { classe: 'FICHE_OK', motifs: [] }, visuel: { classe: 'A_COMPARER', motifs: [] } },
    { idProduct: 3, fiche: { classe: 'FICHE_OK', motifs: [] }, visuel: { classe: 'A_COMPARER', motifs: [] } },
    { idProduct: 4, fiche: { classe: 'FICHE_OK', motifs: [] }, visuel: { classe: 'A_COMPARER', motifs: [] } }];
const ap = [
    { idProduct: 1, fiche: { classe: 'FICHE_OK', motifs: [] }, visuel: { classe: 'MANQUANT', motifs: ['aucun-visuel'] } },
    { idProduct: 2, fiche: { classe: 'FICHE_DOUTEUSE', motifs: ['sans-numero'] }, visuel: { classe: 'A_COMPARER', motifs: [] } },
    { idProduct: 3, fiche: { classe: 'FICHE_OK', motifs: [] }, visuel: { classe: 'A_COMPARER', motifs: [] } },
    { idProduct: 4, fiche: { classe: 'FICHE_OK', motifs: [] }, visuel: { classe: 'BASSE_DEFINITION', motifs: ['basse-definition'] } }];
const CE = K.comparerEtats({ avant: av, apres: ap, idsDuPlan: new Set([1]) });
verifier('comparer : les produits DU PLAN changent de classe (A) — le gain du lot', CE.duPlan.fiche, { 'SANS_LIGNE→FICHE_OK': 1 });
verifier('comparer : les effets de bord sont les produits HORS PLAN dont une classe a changé, nommés', CE.effetsDeBord, [{ idProduct: 2, fiche: 'FICHE_OK→FICHE_DOUTEUSE', visuel: null, motifsFiche: ['sans-numero'] }, { idProduct: 4, fiche: null, visuel: 'A_COMPARER→BASSE_DEFINITION', motifsFiche: [] }]);
verifier('comparer : le produit hors plan inchangé n\'est pas un effet de bord', CE.effetsDeBord.some(e => e.idProduct === 3), false);
leve('comparer : un produit du plan absent des états lève (le plan ne correspond pas à l\'état)', () => K.comparerEtats({ avant: av, apres: ap, idsDuPlan: new Set([99]) }), /plan/);
leve('comparer : deux états de populations différentes lèvent', () => K.comparerEtats({ avant: av, apres: ap.slice(1), idsDuPlan: new Set([2]) }), /population/);
// ── un lot qui rend FAUSSE une fiche existante est refusé : le témoin du nom contredit un produit HORS plan après le lot (ex. la moitié droite d'une carte coupée en deux reçoit une fiche simple
// au nom voisin, et la moitié gauche, déjà jointe à la vraie carte, est contredite). Les fiches « sans numéro » qui deviennent douteuses sont un effet de DÉFINITION, signalé mais pas refusé.
verifier('refus du lot : seuls les effets « contredite-par-le-nom » le refusent', K.refusDuLot([{ idProduct: 1, fiche: 'FICHE_OK→FICHE_DOUTEUSE', visuel: null, motifsFiche: ['sans-numero'] }, { idProduct: 2, fiche: 'FICHE_OK→FICHE_DOUTEUSE', visuel: null, motifsFiche: ['contredite-par-le-nom'] }]), [2]);
verifier('refus du lot : aucun effet → aucun refus', K.refusDuLot([]), []);
verifier('refus du lot : une fiche qui devient « plusieurs-cartes » refuse aussi (un produit joint à deux cartes n\'a plus de fiche)', K.refusDuLot([{ idProduct: 3, fiche: 'FICHE_OK→LIGNE_SANS_FICHE', visuel: null, motifsFiche: ['plusieurs-cartes'] }]), [3]);
verifier('refus du lot : un produit qui perd sa fiche (→ LIGNE_SANS_FICHE ou → SANS_LIGNE) refuse, quel que soit le motif', K.refusDuLot([{ idProduct: 4, fiche: 'FICHE_OK→LIGNE_SANS_FICHE', visuel: null, motifsFiche: [] }, { idProduct: 5, fiche: 'FICHE_DOUTEUSE→SANS_LIGNE', visuel: null, motifsFiche: [] }]), [4, 5]);
console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
