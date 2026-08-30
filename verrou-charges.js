// ============================================================
// LES CHARGES DU VERROU — EXTRAITES DU JOURNAL, JAMAIS ÉCRITES À LA MAIN
// ============================================================
// LA RÈGLE, ET ELLE EST LE CŒUR DU DISPOSITIF. Une réponse d'IA rédigée à la main serait
// exactement le stub qu'on a payé deux fois : une SECONDE SOURCE DE VÉRITÉ, qui ressemble
// à la vraie et qui en diverge en silence. Le deuxième principe vaut pour le CONTENU comme
// pour le CONTENANT — l'objet « scoring » fabriqué à la main dans index.js avait trois
// fonctions sur quatre, et cinquante-deux assertions certifiaient un appel qui n'existait
// nulle part en production.
// Donc : tout ce que le verrou rejoue sort de scans RÉELS. Ce fichier ne fabrique rien.
// Il choisit, il copie, il trace d'où ça vient.
//
// ⚠️ DEUX RÈGLES DE SÉLECTION, ET LA PREMIÈRE M'AVAIT MANQUÉ AU PREMIER JET :
//   1. LA LIGNE DOIT AVOIR ABOUTI (`idProduct` non nul). Un scan qui a ÉCHOUÉ en production
//      ne peut pas traverser la route : il ressort à « carte introuvable » ligne 2769, très
//      loin du code à protéger. Mes deux premières charges étaient deux échecs, le verrou a
//      affiché huit ✅ et n'a rien vérifié du tout.
//   2. LA PLUS RÉCENTE de sa cellule, parce que c'est celle qui ressemble le plus à ce que
//      le modèle rend aujourd'hui.
//
// DEUX PHASES :
//   1. EXTRACTION — les lectures depuis `journal_scans`, plus une TRANCHE du catalogue de
//      production copiée dans test_scratch (sans elle, la chaîne sort par « aucun candidat »
//      avant d'avoir traversé quoi que ce soit).
//   2. ENREGISTREMENT — on rejoue les charges une fois AVEC le réseau ouvert et on capture
//      chaque réponse TCGdex. Le verrou les rejouera hors ligne.
//      ⚠️ POURQUOI. La première version rendait TCGdex muet, « limite assumée ». Mesuré
//      ensuite : muet, ZÉRO ligne du journal n'atteint le code à protéger. Ce n'était pas
//      une limite, c'était une impasse.
//
// ⚠️ CE QUI N'EST PAS DANS LE JOURNAL, mis à null EXPLICITEMENT plutôt que deviné :
// `motif`, `reverse`, `rareteElevee`, `etatEstime`, `etatConfiance`, et le titre de
// l'annonce. Conséquence à connaître : les branches qu'ils pilotent — le routage du motif
// de reverse en particulier — ne sont PAS exercées. Le correctif est W1 : journaliser la
// réponse IA brute, qui est la première jonction de la chaîne au même titre que `nomExact`.
//
// ════════════════════════════════════════════════════════════════════════════
// LE RETRAIT D'UNE CHARGE PÉRIMÉE — et pourquoi ce n'est pas de la triche
// ════════════════════════════════════════════════════════════════════════════
// UNE CHARGE ENCODE UN COMPORTEMENT CONSTATÉ AVANT LE CHANGEMENT qu'on est en train
// d'écrire. Sa `profondeurExigee` a été relevée sur une ligne de journal, donc sur du
// code plus ancien. Quand un correctif DÉLIBÉRÉ modifie ce comportement, la charge cesse
// de décrire ce qu'elle prétend décrire — et le verrou rougit pour une raison qui n'est
// pas une régression.
//
// TROIS ISSUES POSSIBLES, ET DEUX SONT MAUVAISES :
//   ✗ choisir une autre charge de la même cellule : c'est SÉLECTIONNER SUR LE RÉSULTAT.
//     On garde la charge qui passe et on jette celle qui échoue — le verrou devient un
//     miroir. C'est exactement ce qu'il existe pour interdire.
//   ✗ pousser avec le verrou rouge : on apprend à ignorer un verrou rouge, et le jour où
//     il désigne une vraie régression, personne ne le lit.
//   ✓ RETIRER LA CHARGE EXPLICITEMENT, en nommant le commit qui l'invalide et la date.
//     La cellule retombe en AVERTISSEMENT — nommée, manquante, datée — au même titre
//     qu'une cellule sans données. Rien n'est vert en silence.
//
// LA DIFFÉRENCE EST VÉRIFIABLE, pas déclarative : le commit nommé est dans l'historique,
// et on peut relire ce qu'il a changé. Un retrait dont le commit ne touche pas le chemin
// de la cellule se voit en trente secondes.
//
// ⚠️ CE QUE LE RETRAIT NE DIT PAS. Il ne dit pas que le chemin n'est plus couvert — il dit
// que cette ISSUE ne l'est plus. Vérifier ce qui reste couvert par les autres charges
// AVANT de retirer, et l'écrire : c'est la seule partie du raisonnement qui puisse être
// fausse, et elle se mesure au cliquet de couverture.
//
// ⚠️ LE RETRAIT EST DÉCLARÉ AVANT LA SÉLECTION (voir la boucle), pour qu'il ne puisse pas
// être décidé en voyant quelle charge sort.
//
// EMPLOI À CE JOUR — une fois, et refermé le même jour :
//   « réserve FAIBLE », retirée par fb49871 (union des viviers) le 2026-08-11, requalifiée
//   le 2026-08-11 après le lot « requalification-verrou » (4 scans, 2 lignes utilisables).
//   Couverture pendant le retrait : 37 fonctions, soit une DE PLUS qu'avec les 6 charges —
//   le chemin restait exercé, seule l'issue ne l'était plus. C'est la vérification qui
//   justifiait le retrait, et elle doit être refaite à chaque emploi.
//
// LECTURE SEULE sur la production. ÉCRITURE uniquement dans test_scratch.
// USAGE :  node verrou-charges.js --base=test

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const S = require('./scoring');
const { SETS_VINTAGE_JAPONAIS } = require('./sets-vintage-japonais');
// ⚠️ L'IDENTITÉ D'UNE CARTE VIENT D'ICI, jamais d'une clé refaite sur place. C'est la même
// notion que celle qui rattache les vérités au banc (`nom|numero|setCode|total`), et la
// règle de distinction ci-dessous en dépend entièrement.
const SEAUX = require('./banc-seaux');
const { empreintePrompt } = require('./verrou/empreinte');
const { demarrer, appeler } = require('./verrou/serveur');

const SCRATCH = 'test_scratch';
const SORTIE = path.join(__dirname, 'verrou', 'charges.json');
const SORTIE_TCGDEX = path.join(__dirname, 'verrou', 'tcgdex.json');
const JETON = process.env.JETON_API || 'jeton-verrou';
const USER_VERROU = 'verrou-avant-push';

// ⚠️ NOMMER LA BASE OU REFUSER. La base de production s'appelle « test » : une commande
// lancée sans réfléchir ne doit jamais pouvoir y écrire par défaut.
const arg = process.argv.find(a => a.startsWith('--base='));
if (!arg) {
    console.error('❌ Base non nommée. Usage : node verrou-charges.js --base=test');
    console.error('   (lecture seule sur cette base ; les écritures vont dans test_scratch)');
    process.exit(1);
}
const BASE = arg.slice('--base='.length);
const codesTable = SETS_VINTAGE_JAPONAIS.map(s => S.normaliserCodeSet(s.code));

// LES TROIS CELLULES, définies par le CHEMIN DE CODE qu'elles empruntent — pas par l'ère
// ni par le goût. Chacune DÉCLARE LA PROFONDEUR qu'elle doit atteindre : sans ça, une
// charge qui sort au bout de trois lignes ressemble à une charge qui a tout traversé.
// ⚠️ DEUX ESPÈCES DE CELLULES, ET UNE SEULE EST SOLIDE DANS LE TEMPS.
//   - Celles dont la profondeur exigée est un JALON (`perimetre-vintage`) encodent un
//     CHEMIN : « la chaîne est passée par là ». Un correctif d'identification ne les
//     invalide pas — le chemin reste emprunté. Elles sont robustes.
//   - Celles dont la profondeur est `verdict`, ou qui attendent un ÉCHEC, encodent une
//     ISSUE : « cette carte-là sort avec ce résultat-là ». Toute amélioration de
//     l'identification peut légitimement les périmer.
// AUJOURD'HUI : 3 du premier type (les trois `perimetre-vintage`), 3 du second
// (« égalité départagée par le symbole », « réserve FAIBLE », « aucun prix »).
//
// ⚠️ ET LES TROIS FRAGILES SONT MENACÉES PAR LE MÊME CHANTIER — celui qui fera du NOM un
// critère de scoring. Elles reposent toutes sur une ÉGALITÉ : Vileplume sur une égalité
// que le symbole départage, Mew sur une égalité qu'on refuse, « réserve FAIBLE » sur une
// suggestion de périmètre. Si le nom sépare les candidats, ces égalités disparaissent et
// les trois cellules cessent d'exercer ce pour quoi elles existent — sans qu'aucune
// régression ait eu lieu. Le mécanisme de retrait ci-dessus servira donc encore.
const CELLULES = [
    {
        nom: 'asiatique · setCode HORS table close',
        pourquoi: 'le chemin exact du plantage memeCodeParConventionX du 4 août',
        profondeurExigee: 'perimetre-vintage',
        test: d => S.LANGUES_ASIATIQUES.includes(String(d.langue || '').toUpperCase())
            && !!S.normaliserCodeSet(d.setCode)
            && !codesTable.includes(S.ALIAS_CODES_LUS.get(S.normaliserCodeSet(d.setCode)) || S.normaliserCodeSet(d.setCode))
    },
    {
        nom: 'asiatique · aucun setCode lu',
        pourquoi: 'sortie anticipée de la table close : la branche qui NE plantait pas',
        profondeurExigee: 'perimetre-vintage',
        test: d => S.LANGUES_ASIATIQUES.includes(String(d.langue || '').toUpperCase()) && !S.normaliserCodeSet(d.setCode)
    },
    {
        nom: 'occidentale',
        pourquoi: 'toutes les gardes du chantier sont conditionnées à LANGUES_ASIATIQUES : sans elle, une régression occidentale est invisible',
        profondeurExigee: 'perimetre-vintage',
        test: d => !S.LANGUES_ASIATIQUES.includes(String(d.langue || '').toUpperCase())
    },
    {
        // ⚠️ ELLE SERA VIDE AU DÉBUT, ET C'EST NORMAL — comme la cellule occidentale l'a
        // été. Le départage par le symbole a été écrit avec 24 assertions unitaires et
        // ZÉRO passage en conditions réelles. Tant qu'aucun scan ne produit une égalité
        // parfaite tranchée par le symbole, cette branche reste inconnue : elle marche
        // en test et personne ne peut dire ce qu'elle fait en production.
        // La cellule existe pour que le jour où ça arrive, la ligne devienne
        // AUTOMATIQUEMENT une charge du verrou — et la branche passe du côté couvert
        // sans qu'on ait à y penser.
        nom: 'égalité parfaite départagée par le symbole',
        pourquoi: 'la seule branche du chantier écrite sans jamais avoir tourné sur une vraie carte',
        profondeurExigee: 'verdict',
        test: d => d.raisonReserve === 'symbole-departage'
    },
    {
        // ⚠️ LE CHEMIN QUI REÇOIT TOUT LE SOIN DE LA REFONTE D'AFFICHAGE, et qu'aucune
        // charge n'exerçait. La réserve FAIBLE est la plus fréquente (51 % des réserves,
        // mesuré) et c'est elle que l'extension traitera le plus. Valider les trois autres
        // cellules en laissant celle-là sans réponse réelle serait couvrir le facile.
        nom: 'réserve FAIBLE',
        pourquoi: 'le cas le plus fréquent côté utilisateur — 51 % des réserves — et le plus travaillé à l\'affichage',
        profondeurExigee: 'verdict',
        // ⚠️ CELLULE REQUALIFIÉE LE 2026-08-11 — le bloc `invalidee` qui la retirait a été
        // supprimé ici même. Historique : retirée par fb49871 (l'union des viviers avait
        // périmé sa charge, Dark Ursaring passant du prix-avec-réserve au refus remboursé),
        // puis rouverte par le lot « requalification-verrou » de banc-lots.json — 4 scans,
        // dont 2 lignes `perimetre-vintage-suggestion` produites SOUS le nouveau code.
        // Le retrait aura donc duré le temps d'une fenêtre de cinq minutes, ce qui est
        // exactement la durée qu'il devait avoir.
        test: d => d.raisonReserve === 'perimetre-vintage-suggestion'
    },
    {
        // ⚠️ CELLULE QUI ACCEPTE UN ÉCHEC. Les trois issues de l'extension sont : verdict
        // ferme, prix avec réserve, AUCUN prix. La troisième n'était exercée par aucune
        // charge — or c'est celle où l'utilisateur est remboursé et ne voit rien, donc
        // celle dont un plantage passerait le plus inaperçu.
        // La profondeur exigée est `perimetre-vintage` et non `verdict` : par construction
        // un refus ne rend pas de verdict, c'est le jalon juste avant qui prouve que la
        // chaîne est allée jusqu'à la décision de refuser.
        nom: 'aucun prix (refus remboursé)',
        pourquoi: 'la troisième issue vue par l\'utilisateur, jamais exercée jusqu\'ici',
        profondeurExigee: 'perimetre-vintage',
        accepteEchec: true,
        test: d => d.resultat === 'echec' && d.motifEchec === 'egalite-parfaite'
    },
    {
        // ⚠️ ELLE SERA VIDE AU DÉBUT — comme la 4ᵉ (symbole) et l'occidentale avant elle,
        // et pour une raison encore plus nette : `references_image` est VIDE, donc la garde
        // ne passe jamais et aucun scan ne peut produire cette raison. C'est voulu et c'est
        // la propriété qui rend le déploiement sûr — le code part inerte.
        //
        // 🔑 CE QU'ELLE ATTRAPERA, ET QUI N'EST PAS CE QU'ON CROIT. Le jour où les
        // descripteurs seront écrits, cette cellule passera de vide à pleine SANS QUE
        // PERSONNE NE TOUCHE AU CODE. C'est exactement le signal qu'on veut : il rend
        // visible, dans le verrou, une bascule qui n'aura eu lieu qu'en BASE. La 7ᵉ cellule
        // avait rendu le même service pour la panne Mongo — une défaillance hors du code,
        // qu'aucun test unitaire ne pouvait voir.
        //
        // ⚠️ ET LE JOUR OÙ ELLE SE REMPLIT, LA CHARGE DOIT ÊTRE RELUE À LA MAIN. Le
        // départage par l'image est la seule décision de la chaîne qui dépende d'un ÉTAT
        // EXTERNE volumineux (69 016 vecteurs). Une charge qui passe aujourd'hui peut
        // échouer demain parce qu'un vecteur a changé, sans qu'aucune ligne de code ait
        // bougé — c'est un verrou sur une cible mouvante, et il faut le savoir.
        nom: 'départage par l\'image',
        pourquoi: 'la décision du 2026-08-29 : la seule branche de production dont aucune charge n\'avait traversé le chemin',
        profondeurExigee: 'verdict',
        // 🔴 PAS `d.raisonReserve === 'image-departage'`, ET C'EST LA CORRECTION DU
        // 2026-08-30. Ce champ n'existait pas quand les lignes du journal ont été scannées :
        // aucune ne le portera JAMAIS. Sélectionner dessus rendait la cellule vide par
        // construction, et « elle se remplira après le déploiement » revenait à déployer
        // d'abord et à exercer ensuite — l'inverse de ce que le verrou fait.
        // `__imageDepartage` est posé par la pré-passe, qui REJOUE le départage sur le
        // vivier journalisé et retient les lignes qui empruntent le chemin AUJOURD'HUI.
        // On sélectionne sur ce que la chaîne FAIT, jamais sur une étiquette d'époque.
        test: d => d.__imageDepartage === true
    }
];

(async () => {
    const prod = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: BASE }).asPromise();
    console.log(`lecture  : ${prod.db.databaseName} (aucune écriture)`);
    if (prod.db.databaseName === SCRATCH) {
        console.error('❌ La base de lecture ne peut pas être le bac à sable.');
        process.exit(1);
    }

    const journal = await prod.collection('journal_scans').find({}).sort({ le: -1 }).toArray();
    // ⚠️ LA CONDITION QUI MANQUAIT : `idProduct` non nul. Voir l'en-tête.
    // ⚠️ SAUF POUR LES CELLULES `accepteEchec`. Un refus n'a PAS d'idProduct — c'est sa
    // définition. Leur imposer la même condition rendrait la troisième issue de
    // l'utilisateur (aucun prix) inexerçable par construction.
    const avecPhoto = journal.filter(d => d.imageUrl && d.nom);
    const abouties = avecPhoto.filter(d => d.idProduct != null);
    console.log(`${journal.length} lignes au journal · ${abouties.length} ont abouti ET portent une photo\n`);

    // ════════════════════════════════════════════════════════════════════════
    // PRÉ-PASSE — SÉLECTIONNER SUR CE QUE LA CHAÎNE FAIT, PAS SUR UNE ÉTIQUETTE
    // ════════════════════════════════════════════════════════════════════════
    // 🔴 LA CELLULE DU DÉPARTAGE PAR L'IMAGE NE PEUT PAS SE SÉLECTIONNER SUR
    // `raisonReserve === 'image-departage'` : le champ n'existait pas quand ces lignes ont
    // été scannées, et AUCUNE ligne du journal ne le portera jamais. Attendre le
    // déploiement pour remplir la cellule reviendrait à déployer d'abord et à exercer
    // ensuite — exactement ce que ce fichier existe pour empêcher.
    //
    // ON REJOUE DONC LE DÉPARTAGE MAINTENANT, et on retient les lignes où il TRANCHE
    // aujourd'hui. C'est déjà ce que font les autres cellules : elles sélectionnent sur des
    // propriétés de l'ENTRÉE (langue, setCode) et vérifient la profondeur ATTEINTE, elles
    // ne lisent pas une étiquette de sortie. La seule différence ici est que la propriété
    // se calcule au lieu de se lire.
    //
    // ⚠️ CE N'EST PAS UNE SÉLECTION SUR LE RÉSULTAT DE LA CHARGE. On retient les lignes qui
    // EMPRUNTENT le chemin, pas celles qui donnent une bonne réponse : la justesse du
    // départage ne rentre nulle part dans ce choix, et elle n'est pas mesurée ici.
    // ⚠️ Restreinte aux lignes qui portent `vivierIds` — sans le vivier, il n'y a pas de
    // groupe à départager, et le rejeu porterait sur un ensemble inventé.
    // ⚠️ `raisonVide` est déclarée ICI et non plus après « phase 1 » : la pré-passe peut
    // échouer et doit pouvoir y écrire. Une cellule vide « parce que la pré-passe n'a pas
    // tourné » et une cellule vide « parce qu'aucune ligne ne convient » ne se lisent pas
    // de la même façon, et c'est cette carte-là que `raisonVide` porte.
    const raisonVide = new Map();
    let imageDispo = 0;
    try {
        const IMG = require('./departage-image');
        // 🔴 IL FAUT LA CONNEXION mongoose PAR DÉFAUT, ET C'EST LE PIÈGE QUI A FAIT RENDRE
        // « 0 ligne » AU PREMIER ESSAI. Ce fichier travaille avec `createConnection` pour
        // garder la production en lecture seule et nommée ; `departage-image.js`, lui, lit
        // via un modèle mongoose, donc via `mongoose.connection` — la connexion PAR DÉFAUT,
        // que rien n'ouvrait ici. `chargerVecteurs` teste `readyState !== 1` et rend une
        // Map VIDE : la garde s'abstenait sur toutes les lignes, et la pré-passe annonçait
        // sereinement « 0 ligne n'emprunte le chemin ».
        // C'est encore une absence lue comme une valeur — et le contrôle qui devait la voir
        // rendait un nombre parfaitement plausible.
        await mongoose.connect(process.env.MONGODB_URI, { dbName: BASE });
        // ⚠️ ET ON VÉRIFIE QUE LA LECTURE MARCHE AVANT DE COMPTER. Sans ce garde-fou, un
        // « 0 » resterait indiscernable entre « aucune ligne ne convient » et « je n'ai
        // rien pu lire ». Le premier est une mesure, le second une panne.
        const dispo = await IMG.ReferenceImage.countDocuments({ etat: 'indexee', pts: IMG.N_POINTS });
        if (dispo === 0) throw new Error(`aucun vecteur lisible en base "${BASE}" — la pré-passe ne mesurerait rien`);
        console.log(`   pré-passe : ${dispo} vecteurs lisibles dans "${BASE}"`);
        for (const d of abouties) {
            if (!Array.isArray(d.vivierIds) || d.vivierIds.length < 2) continue;
            const avis = await IMG.departager({
                imageUrl: d.imageUrl, langue: d.langue, total: d.total,
                classement: d.vivierIds.map(id => ({ idProduct: id, score: 0 }))
            });
            if (avis.departage) { d.__imageDepartage = true; imageDispo++; }
        }
        console.log(`   pré-passe départage par l'image : ${imageDispo} ligne(s) empruntent le chemin aujourd'hui`);
    } catch (e) {
        // Une pré-passe impossible ne doit pas faire croire à une cellule vide « parce
        // qu'aucune ligne ne convient ». La distinction est écrite dans `raisonVide`.
        console.log(`   ⚠️ pré-passe départage par l'image IMPOSSIBLE : ${e.message}`);
        raisonVide.set('départage par l\'image', `PRÉ-PASSE IMPOSSIBLE : ${e.message}`);
    }

    console.log('── phase 1 : les charges ──');
    const charges = [];
    const invalidees = [];
    // Pourquoi chaque cellule est restée vide, s'il y en a. TROIS raisons distinctes, et
    // elles ne se lisent pas de la même façon — voir `cellulesManquantes` plus bas.
    // (déclarée plus haut : la pré-passe du départage par l'image doit pouvoir y écrire)

    // ════════════════════════════════════════════════════════════════════════
    // ÉTAPE 1 — LES RETRAITS, AVANT TOUTE SÉLECTION
    // ════════════════════════════════════════════════════════════════════════
    // Si on sélectionnait d'abord, on saurait quelle charge sort et le retrait deviendrait
    // une décision prise EN CONNAISSANCE DU RÉSULTAT. Déclaré ici, il ne peut pas l'être.
    const servables = [];
    for (const c of CELLULES) {
        if (c.invalidee) {
            invalidees.push(`${c.nom} — charge invalidée par ${c.invalidee.par} (${c.invalidee.le}) : ${c.invalidee.charge}`);
            console.log(`⊘ ${c.nom} : RETIRÉE — invalidée par ${c.invalidee.par} le ${c.invalidee.le}`);
            console.log(`     charge : ${c.invalidee.charge}`);
            console.log(`     motif  : ${c.invalidee.pourquoi}`);
            console.log(`     suite  : ${c.invalidee.attendu}`);
            raisonVide.set(c.nom, `INVALIDÉE par ${c.invalidee.par} (${c.invalidee.le}) : ${c.invalidee.charge}`);
            continue;
        }
        servables.push({ c, vivier: (c.accepteEchec ? avecPhoto : abouties).filter(c.test) });
    }

    // ════════════════════════════════════════════════════════════════════════
    // ÉTAPE 2 — L'ORDRE DE SERVICE : LA PLUS CONTRAINTE D'ABORD
    // ════════════════════════════════════════════════════════════════════════
    // POURQUOI UN ORDRE EXPLICITE. La règle de distinction ci-dessous fait dépendre le
    // choix d'une cellule de ce que les précédentes ont déjà pris. Sans ordre DÉCLARÉ,
    // « qui garde la carte disputée » serait tranché par un détail d'itération que
    // personne n'a écrit — et ça bougerait au premier ajout de cellule, en silence.
    //
    // L'ORDRE EST : vivier le plus PETIT d'abord. Une cellule qui n'a que deux lignes
    // éligibles doit servir avant celle qui en a dix-sept, sinon elle se retrouve sans
    // charge alors que l'autre avait le choix. C'est la règle du plus contraint, et elle
    // maximise le nombre de cellules servies — pas le résultat de l'une d'elles.
    //
    // ⚠️ ÉGALITÉ DE TAILLE : l'ordre de DÉCLARATION dans CELLULES tranche. Il faut une
    // clause explicite, sinon `sort` n'est pas déterministe entre égaux selon le moteur,
    // et deux exécutions pourraient rendre deux jeux de charges différents.
    //
    // ⚠️ CET ORDRE NE REGARDE PAS CE QUE LA CHARGE PRODUIT — seulement combien de lignes
    // sont éligibles. C'est ce qui le distingue d'une sélection sur le résultat, et c'est
    // vérifiable : la taille des viviers est imprimée ci-dessous.
    const rang = new Map(CELLULES.map((c, i) => [c.nom, i]));
    servables.sort((a, b) => (a.vivier.length - b.vivier.length) || (rang.get(a.c.nom) - rang.get(b.c.nom)));
    console.log('   ordre de service (vivier le plus petit d\'abord) : '
        + servables.map(s => `${s.c.nom} (${s.vivier.length})`).join(' · ') + '\n');

    // ════════════════════════════════════════════════════════════════════════
    // ÉTAPE 3 — LA RÈGLE DE DISTINCTION : la plus récente PAS DÉJÀ PRISE
    // ════════════════════════════════════════════════════════════════════════
    // SIX CELLULES QUI REJOUENT CINQ CARTES ANNONCENT UNE COUVERTURE QU'ELLES N'ONT PAS.
    // Constaté le 2026-08-11 : « Hitmontop #237 » était à la fois la plus récente sans
    // setCode et la plus récente en `perimetre-vintage-suggestion`, donc la charge de DEUX
    // cellules. Deux conséquences, toutes deux mauvaises : un changement de comportement
    // sur cette carte faisait tomber deux cellules d'un coup — une régression deux fois
    // plus large qu'elle n'est — et le rapport annonçait six situations pour cinq.
    //
    // ⚠️ CE N'EST PAS SÉLECTIONNER SUR LE RÉSULTAT. La règle ne regarde jamais ce que la
    // charge produit ; elle regarde si une AUTRE cellule tient déjà cette carte. Elle se
    // vérifie en lisant les clés des six charges : elles doivent être six identités
    // différentes.
    //
    // L'IDENTITÉ VIENT DE banc-seaux.js, la source unique — pas d'une clé refaite ici.
    // Deux lignes de journal de la même carte sont la MÊME carte : dédoublonner par `_id`
    // laisserait passer deux scans du même Hitmontop et ne réglerait rien.
    const prises = new Set();
    for (const { c, vivier } of servables) {
        const d = vivier.find(x => !prises.has(SEAUX.identiteDe(x)));
        if (!d) {
            // Une cellule vide n'est pas une panne du code : c'est un manque de données.
            // Le verrou le dira en AVERTISSEMENT, jamais en échec — un verrou rouge en
            // permanence est un verrou qu'on apprend à ignorer.
            const cause = vivier.length
                ? `ses ${vivier.length} ligne(s) éligibles sont déjà prises par des cellules plus contraintes`
                : 'aucune ligne au journal';
            console.log(`⚠️ ${c.nom} : ${cause} — cellule vide`);
            raisonVide.set(c.nom, cause);
            continue;
        }
        prises.add(SEAUX.identiteDe(d));
        charges.push({
            cellule: c.nom,
            pourquoi: c.pourquoi,
            profondeurExigee: c.profondeurExigee,
            source: { _id: String(d._id), le: d.le, version: d.version ?? null, idProduct: d.idProduct },
            imageUrl: d.imageUrl,
            lecture: {
                name: d.nom,
                number: d.numero ?? null,
                total: d.total ?? null,
                setCode: d.setCode ?? null,
                language: d.langue ?? 'EN',
                rarete: d.rarete ?? null,
                nomBrut: d.nomBrut ?? null,
                nomConfiance: d.nomConfiance ?? null,
                symboleSet: d.symboleSet ?? null,
                // ⚠️ ABSENTS DU JOURNAL — null EXPLICITE, jamais une valeur inventée.
                motif: null, reverse: null, rareteElevee: null,
                etatEstime: null, etatConfiance: null
            },
            champsAbsentsDuJournal: ['motif', 'reverse', 'rareteElevee', 'etatEstime', 'etatConfiance', 'title']
        });
        console.log(`✅ ${c.nom}`);
        console.log(`     "${d.nom}" n°${d.numero ?? '—'} setCode=${d.setCode ?? '—'} ${d.langue} -> ${d.idProduct}  (${d.le?.toISOString?.().slice(0, 16)})`);
        console.log(`     profondeur exigée : ${c.profondeurExigee}`);
    }
    if (!charges.length) {
        console.error('\n❌ Aucune charge extractible. Scanne quelques cartes, puis relance.');
        process.exit(1);
    }

    // ── LA TRANCHE DE CATALOGUE ──────────────────────────────────────────────
    // Copiée depuis la production, jamais fabriquée : vrais produits, vrais numéros,
    // vrais codes. Élargie au GAGNANT de chaque charge et à toute son expansion — sans
    // ça, le produit que la production avait retenu peut manquer du vivier.
    console.log('\n── tranche de catalogue -> test_scratch ──');
    const noms = [...new Set(charges.map(c => c.lecture.name).filter(Boolean))];
    const gagnants = charges.map(c => c.source.idProduct).filter(v => v != null);
    const numGagnants = await prod.collection('numeros_cartes')
        .find({ idProduct: { $in: gagnants } }, { projection: { idExpansion: 1 } }).toArray();
    const expansions = [...new Set(numGagnants.map(n => n.idExpansion).filter(v => v != null))];
    const idsExpansion = (await prod.collection('numeros_cartes')
        .find({ idExpansion: { $in: expansions } }, { projection: { idProduct: 1 } }).toArray())
        .map(n => n.idProduct);

    const produits = await prod.collection('catalogue_produits').find({
        $or: [
            ...noms.map(n => ({ name: new RegExp(echapper(n), 'i') })),
            { idProduct: { $in: [...gagnants, ...idsExpansion] } }
        ]
    }).limit(6000).toArray();
    const ids = produits.map(p => p.idProduct);
    const numeros = await prod.collection('numeros_cartes').find({ idProduct: { $in: ids } }).toArray();
    const prix = await prod.collection('guide_prix').find({ idProduct: { $in: ids } }).toArray();
    // TOUS les codes de set : 747 lignes minuscules, et `lireTousLesCodesSet` les lit tous
    // pour distinguer une contradiction d'un bruit d'OCR (quatrième principe). En donner
    // une partie fausserait précisément cette distinction.
    const codes = await prod.collection('codes_set').find({}).toArray();

    const bac = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: SCRATCH }).asPromise();
    if (bac.db.databaseName !== SCRATCH) {
        console.error(`❌ ARRÊT : écriture visée sur "${bac.db.databaseName}" au lieu de ${SCRATCH}.`);
        process.exit(1);
    }
    // ⚠️ LES VECTEURS D'IMAGE FONT PARTIE DE LA TRANCHE — ajoutés le 2026-08-30.
    // Sans eux, la garde du départage par l'image s'abstient TOUJOURS dans le bac, et la
    // cellule sortirait rouge sans que rien ne soit cassé — ou, pire, ferait conclure que
    // le départage ne marche pas.
    // 🔑 ON COPIE LES VECTEURS DU VIVIER ENTIER DE CHAQUE CHARGE, pas seulement ceux des
    // produits de la tranche : la garde exige un vecteur pour TOUS les candidats du groupe,
    // et il suffit d'un manquant pour qu'elle se taise. Copier « à peu près » le vivier
    // produirait une abstention que personne ne saurait expliquer.
    const idsVivier = [...new Set(charges.flatMap(c => c.source?.vivierIds ?? []))].filter(v => v != null);
    const vecteurs = await prod.collection('references_image')
        .find({ idProduct: { $in: [...new Set([...ids, ...idsVivier])] } }).toArray();

    // ⚠️ ET `references_image` ENTRE DANS LA BOUCLE DE VIDAGE, dans le même geste.
    // La règle est en tête de ce fichier et elle ne souffre pas d'exception : tout outil
    // qui fait écrire une collection la vide en sortant. Une collection copiée mais jamais
    // vidée rendrait le verrou non reproductible — son résultat dépendrait du nombre de
    // fois qu'on l'a lancé, ce qui ne vaut pas mieux que pas de verrou du tout.
    for (const [nom, docs] of [['catalogue_produits', produits], ['numeros_cartes', numeros],
    ['guide_prix', prix], ['codes_set', codes], ['references_image', vecteurs]]) {
        await bac.collection(nom).deleteMany({});
        if (docs.length) await bac.collection(nom).insertMany(docs);
        console.log(`   ${nom.padEnd(20)} ${docs.length}`);
    }
    // La garde est-elle franchissable dans le bac ? Si un candidat manque, la cellule
    // s'abstiendra — et il vaut mieux le savoir ici que dans un verrou rouge sans cause.
    for (const c of charges) {
        if (!Array.isArray(c.source?.vivierIds) || !c.source.vivierIds.length) continue;
        const n = await bac.collection('references_image')
            .countDocuments({ idProduct: { $in: c.source.vivierIds }, etat: 'indexee' });
        if (n < c.source.vivierIds.length) {
            console.log(`   ⚠️ ${c.lecture.name} : ${n}/${c.source.vivierIds.length} vecteurs dans le bac` +
                ` -> la garde s'abstiendra sur cette charge.`);
        }
    }
    // Chaque gagnant est-il bien dans la tranche ? Si non, la charge ne pourra pas aboutir
    // et il vaut mieux le savoir ici que dans un verrou rouge sans explication.
    for (const c of charges) {
        // Une charge d'ÉCHEC n'a pas de gagnant : il n'y a rien à vérifier, et annoncer
        // « ABSENT » y serait faux.
        if (c.source.idProduct == null) {
            console.log(`   ${c.lecture.name} : charge d'ÉCHEC, aucun gagnant attendu`);
            continue;
        }
        const present = ids.includes(c.source.idProduct);
        console.log(`   gagnant ${c.source.idProduct} (${c.lecture.name}) : ${present ? 'présent' : '⚠️ ABSENT de la tranche'}`);
    }

    const empreinte = empreintePrompt();
    fs.writeFileSync(SORTIE, JSON.stringify({
        extraitLe: new Date().toISOString(),
        extraitDe: prod.db.databaseName,
        // ⚠️ DE QUOI DIRE SI DEUX EXÉCUTIONS SONT COMPARABLES, sans avoir à le déduire.
        // Une réextraction sur un journal plus long rend des charges DIFFÉRENTES : le
        // 2026-08-11, passer de 131 à 142 lignes a changé quatre charges sur six. Deux
        // sorties du verrou séparées par une réextraction ne se comparent donc pas ligne
        // à ligne, et rien ne le disait. Ces deux nombres le disent.
        lignesAuJournal: journal.length,
        lignesEligibles: { avecPhoto: avecPhoto.length, abouties: abouties.length },
        // Le nombre de cellules VOULUES, pour que le verrou sache combien manquent sans
        // avoir à connaître la liste. Un nombre en dur des deux côtés divergerait.
        cellulesVoulues: CELLULES.length,
        // ⚠️ TROIS RAISONS D'ÊTRE MANQUANTE, ET ELLES NE SE VALENT PAS.
        //   « aucune ligne au journal »      -> manque de DONNÉES, se comble en scannant.
        //   « déjà prises par des cellules plus contraintes » -> manque de DIVERSITÉ : les
        //      lignes existent mais décrivent des cartes qu'une autre cellule rejoue déjà.
        //      Se comble aussi en scannant, mais en scannant AUTRE CHOSE.
        //   « INVALIDÉE par <commit> »       -> choix TRAÇABLE : un changement délibéré a
        //      modifié le comportement que la charge encodait, et on le déclare au lieu
        //      d'aller chercher une charge qui passe — ce qui serait sélectionner sur le
        //      résultat.
        cellulesManquantes: CELLULES
            .filter(c => !charges.some(ch => ch.cellule === c.nom))
            .map(c => `${c.nom} — ${raisonVide.get(c.nom) ?? 'raison inconnue'}`),
        // ⚠️ LE CHIFFRE QUI DÉCRIT LA COUVERTURE RÉELLE. Le nombre de cellules dit combien
        // de situations on VOULAIT couvrir ; celui-ci dit combien de cartes différentes
        // traversent réellement la route. Quand les deux divergent, c'est le second qui a
        // raison — et c'est arrivé : six cellules pour cinq cartes, le 2026-08-11.
        cartesDistinctes: new Set(charges.map(ch => SEAUX.identiteDe({
            nom: ch.lecture.name, numero: ch.lecture.number,
            setCode: ch.lecture.setCode, total: ch.lecture.total
        }))).size,
        empreintePrompt: empreinte,
        commentRafraichir: 'node verrou-charges.js --base=test',
        charges
    }, null, 2), 'utf8');
    console.log(`\n📝 ${SORTIE} — ${charges.length}/${CELLULES.length} cellules · empreinte ${empreinte.hash}`);
    await prod.close();

    // ── PHASE 2 : ENREGISTREMENT DE TCGdex ───────────────────────────────────
    console.log('\n── phase 2 : enregistrement des réponses TCGdex (réseau OUVERT) ──');
    const srv = await demarrer(path.join(__dirname, 'verrou', 'enregistreur.js'), {
        VERROU_CHARGES: SORTIE,
        VERROU_ENREGISTRER: SORTIE_TCGDEX,
        JETON_API: JETON,
        OPENROUTER_API_KEY: ''   // l'IA est rejouée ; aucune clé ne doit servir
    });
    if (!await srv.attendreMongo()) {
        console.error('❌ Mongo non connecté côté serveur d\'enregistrement.');
        srv.enfant.kill(); process.exit(1);
    }
    for (const c of charges) {
        const r = await appeler(srv.port, 'POST', '/api/identifier', {
            userId: USER_VERROU, imageUrls: [c.imageUrl], title: null, vintedEtat: null
        }, JETON);
        console.log(`   ${c.lecture.name.padEnd(18)} -> ${r.json?.success ? 'succès' : `échec : ${r.json?.error ?? r.status}`}`);
    }
    // Vidage explicite : sur Windows, SIGTERM n'est pas toujours délivré au processus Node.
    await new Promise(resolve => {
        srv.enfant.once('message', m => { if (m === 'vide') resolve(); });
        srv.enfant.send('vider');
        setTimeout(resolve, 5000);
    });
    srv.enfant.kill();

    if (fs.existsSync(SORTIE_TCGDEX)) {
        const t = JSON.parse(fs.readFileSync(SORTIE_TCGDEX, 'utf8'));
        console.log(`\n📝 ${SORTIE_TCGDEX} — ${t.nb} réponse(s) TCGdex enregistrées`);
    } else {
        console.log(`\n⚠️ ${SORTIE_TCGDEX} non écrit — le verrou tournera sans réponses TCGdex.`);
    }

    // Nettoyage du bac : les lignes de journal et le crédit créés par l'enregistrement.
    const nj = await bac.collection('journal_scans').deleteMany({ userId: USER_VERROU });
    const nc = await bac.collection('credits').deleteMany({ userId: USER_VERROU });
    console.log(`🧹 test_scratch : ${nj.deletedCount} ligne(s) de journal, ${nc.deletedCount} crédit(s) supprimés.`);
    await bac.close();
    process.exit(0);
})();

function echapper(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
