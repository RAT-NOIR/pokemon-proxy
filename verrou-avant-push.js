// ============================================================
// LE VERROU AVANT PUSH — « est-ce que le code tourne ? »
// ============================================================
// POURQUOI IL EXISTE. Deux déploiements consécutifs ont tué la production alors que TOUTES
// les vérifications étaient vertes :
//   - 83789c2 : le catalogue anglais interrogé avec un nom japonais ;
//   - le suivant : `memeCodeParConventionX is not a function`, parce qu'index.js passait à
//     `setCodeCompatibleVintage` un objet FABRIQUÉ À LA MAIN avec trois fonctions sur quatre.
//
// LE SECOND EST LE PLUS INSTRUCTIF : les 52 assertions de la table close et les 32 du chemin
// par le code PASSAIENT. Elles passaient parce qu'elles appelaient la même fonction avec le
// MODULE ENTIER, quand la production lui passait un extrait.
//
//   ⚠️ CE N'ÉTAIT PAS UN TROU DE COUVERTURE, C'ÉTAIT UNE COUVERTURE MENSONGÈRE.
//   Elle est PIRE que l'absence de test, parce qu'elle rassure. Un fichier sans test se
//   sait fragile ; un fichier à 52 assertions vertes se croit tenu.
//   C'est le DEUXIÈME PRINCIPE, avec sa portée élargie d'un cran : UN STUB FABRIQUÉ À LA
//   MAIN EST UNE SECONDE SOURCE DE VÉRITÉ, ET ÇA VAUT POUR LE CONTENANT AUTANT QUE POUR LE
//   CONTENU. Corollaire : ON PASSE LE MODULE, JAMAIS UN EXTRAIT — et un test qui construit
//   son propre objet à la place de celui de la production ne teste pas la production.
//
// ⚠️ ET CE VERROU S'EST FAIT PRENDRE PAR LA MÊME FAMILLE D'ILLUSION À SON PREMIER JET.
// Il affichait huit ✅ sur deux charges qui sortaient de la route ligne 2769, alors que le
// code à protéger est ligne 2971. « Aucune exception » sur une route qui s'arrête après
// trois pas ne prouve rien. D'où les JALONS : chaque charge déclare la profondeur qu'elle
// doit atteindre, et ne pas y arriver est un ÉCHEC. Voir verrou/jalons.js.
//
// CE QU'IL FAIT : il démarre le VRAI serveur et POSTe sur /api/identifier des charges
// ENREGISTRÉES, sans appeler l'IA. Il échoue sur toute exception, et sur toute charge qui
// n'atteint pas sa profondeur. Il ne juge AUCUNE identification.
//
// ⚠️ CE QU'IL N'ATTRAPE PAS :
//   - le kana : la lecture rejouée est figée, donc toujours dans le bon alphabet ;
//   - une identification fausse : il ne compare rien à une vérité ;
//   - une dérive du modèle : il ne l'appelle pas. C'est le rôle d'U4.
//
// GRATUIT, HORS LIGNE, ÉCRITURES CONFINÉES À test_scratch.
//
// CE QU'IL VIDE EN SORTANT, dans test_scratch et pour le seul `verrou-avant-push` :
//   · credits            — la poche du faux utilisateur
//   · journal_scans      — les lignes des 7 charges
//   · remboursements     ← AJOUTÉE LE 2026-08-19, ET SON ABSENCE FAISAIT MENTIR UNE
//     ASSERTION. Le compteur anti-abus de `rembourserScan` est par (userId, JOUR) et
//     plafonné à 5. Il survivait au nettoyage : relevé en base, il était à 5/5 les 04,
//     10, 11, 12, 18 et 19 août. À partir de la 6e exécution du verrou dans une même
//     journée, le remboursement était donc refusé PAR LE PLAFOND, et la 7e cellule
//     annonçait « le crédit n'est pas rendu » — un défaut du dispositif, présenté comme
//     un défaut de la production. Le pire genre : il n'apparaît qu'après plusieurs
//     passages, donc jamais quand on le cherche.
//   ⚠️ TOUTE COLLECTION QU'UNE CHARGE FAIT ÉCRIRE DOIT ÊTRE DANS CETTE LISTE. Une
//   collection oubliée ne salit pas seulement le bac : elle rend le verrou NON
//   REPRODUCTIBLE, et un verrou dont le résultat dépend du nombre de fois qu'on l'a
//   lancé ne vaut pas mieux que pas de verrou.
//
// USAGE :  node verrou-avant-push.js
// Prérequis : node verrou-charges.js --base=test

require('dotenv').config();
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { empreintePrompt } = require('./verrou/empreinte');
const { profondeurAtteinte, profondeurSuffisante, decrire } = require('./verrou/jalons');
const { demarrer, appeler } = require('./verrou/serveur');

const JETON = process.env.JETON_API || 'jeton-verrou';
const USER_VERROU = 'verrou-avant-push';
const FICHIER_CHARGES = path.join(__dirname, 'verrou', 'charges.json');
// Dossier stable plutôt que temporaire : il est inspectable, et `--poser-plancher` peut
// s'en servir après coup sans relancer le verrou.
const DOSSIER_COUVERTURE = path.join(__dirname, 'verrou', 'couverture');

let echecs = 0, avertissements = 0;
function verifier(libelle, ok, detail = '') {
    if (!ok) echecs++;
    console.log(`  ${ok ? '✅' : '❌'} ${libelle}${ok || !detail ? '' : ` — ${detail}`}`);
    return ok;
}
function avertir(libelle, detail = '') {
    avertissements++;
    console.log(`  ⚠️  ${libelle}${detail ? ` — ${detail}` : ''}`);
}

// LA SIGNATURE D'UNE EXCEPTION AVALÉE, pour les messages qui ne passent pas par le catch
// de la route. Le catch, lui, se reconnaît à son texte générique — voir plus bas.
const SIGNATURE_EXCEPTION = /is not a function|is not defined|Cannot read propert|undefined is not|of undefined|of null|\bReferenceError\b|\bTypeError\b/i;

(async () => {
    console.log('=== VERROU AVANT PUSH ===');

    if (!fs.existsSync(FICHIER_CHARGES)) {
        console.log(`\n❌ ${FICHIER_CHARGES} absent.`);
        console.log('   Extrais les charges du journal (elles ne s\'écrivent PAS à la main) :');
        console.log('   node verrou-charges.js --base=test');
        process.exit(1);
    }
    const donnees = JSON.parse(fs.readFileSync(FICHIER_CHARGES, 'utf8'));

    console.log(`\n=== 1. Charges (extraites de ${donnees.extraitDe} le ${String(donnees.extraitLe).slice(0, 16)}) ===`);
    // ⚠️ UNE CELLULE VIDE EST UN AVERTISSEMENT, PAS UN ÉCHEC. Elle traduit un manque de
    // DONNÉES (aucun scan de ce type au journal), pas un défaut du code : aucune ligne
    // écrite ici ne peut la remplir. La faire échouer rendrait le verrou rouge en
    // permanence, et un verrou toujours rouge est un verrou qu'on apprend à ignorer —
    // exactement le raisonnement appliqué à la dérive du prompt.
    // Le nombre voulu vient des charges elles-mêmes : le mettre en dur ici en ferait une
    // seconde source qui divergerait au premier ajout de cellule (ce qui vient d'arriver).
    const voulues = donnees.cellulesVoulues ?? 3;
    if (donnees.cellulesVoulues == null) {
        // Sans ce champ, on ne peut PAS savoir combien de cellules sont attendues
        // aujourd'hui : les charges sont plus vieilles que la liste actuelle. Afficher
        // « 3 sur 3 » serait rassurant et faux.
        avertir('charges extraites avant la liste de cellules actuelle',
            'le compte de cellules ci-dessous peut être périmé -> node verrou-charges.js --base=test');
    }
    if (donnees.charges.length < voulues) {
        avertir(`${donnees.charges.length} cellule(s) sur ${voulues}`,
            'manque de données ou retrait déclaré, pas un défaut du code');
        for (const m of donnees.cellulesManquantes ?? []) console.log(`      manquante : ${m}`);
    } else {
        verifier(`${voulues} cellules sur ${voulues}`, true);
    }
    // ⚠️ LE CHIFFRE QUI DÉCRIT LA COUVERTURE RÉELLE, à côté du nombre de cellules et
    // jamais à sa place. Six cellules qui rejouent cinq cartes annoncent une couverture
    // qu'elles n'ont pas : un changement sur la carte partagée fait tomber deux cellules
    // d'un coup, et le rapport laisse croire à deux situations distinctes.
    // La règle de distinction (verrou-charges.js) doit rendre les deux nombres ÉGAUX ;
    // s'ils divergent, c'est elle qui a échoué, et il faut le voir sans creuser.
    const distinctes = donnees.cartesDistinctes;
    if (distinctes == null) {
        avertir('charges extraites avant le comptage des cartes distinctes',
            'la couverture réelle est inconnue -> node verrou-charges.js --base=test');
    } else if (distinctes < donnees.charges.length) {
        avertir(`${distinctes} carte(s) distincte(s) pour ${donnees.charges.length} charge(s)`,
            'des cellules rejouent la MÊME carte : la couverture annoncée est surévaluée');
    } else {
        verifier(`${distinctes} cartes distinctes pour ${donnees.charges.length} charge(s)`, true);
    }
    for (const c of donnees.charges) {
        console.log(`     ${c.cellule}`);
        console.log(`       "${c.lecture.name}" n°${c.lecture.number ?? '—'} setCode=${c.lecture.setCode ?? '—'} ${c.lecture.language}` +
            `  ->  doit atteindre « ${c.profondeurExigee ?? '(non déclarée — charge périmée)'} »`);
    }

    // La dérive du prompt : signalée, JAMAIS bloquante (même raisonnement).
    const actuelle = empreintePrompt();
    const enregistree = donnees.empreintePrompt || {};
    if (actuelle.hash !== enregistree.hash) {
        avertir('LE PROMPT A CHANGÉ DEPUIS L\'EXTRACTION DES CHARGES');
        console.log(`      enregistrée : ${enregistree.hash} (${enregistree.modele})`);
        console.log(`      actuelle    : ${actuelle.hash} (${actuelle.modele})`);
        console.log(`      Rafraîchis : node verrou-charges.js --base=test`);
    } else {
        verifier(`empreinte du prompt inchangée (${actuelle.hash})`, true);
    }

    // ════════════════════════════════════════════════════════════════════════
    // LA PROVENANCE DES CHARGES — de quoi comparer deux sorties dans six semaines
    // ════════════════════════════════════════════════════════════════════════
    // ⚠️ DEUX EXÉCUTIONS SÉPARÉES PAR UNE RÉEXTRACTION NE SE COMPARENT PAS LIGNE À LIGNE.
    // Les charges sont choisies dans le journal : un journal plus long en rend d'autres.
    // Mesuré le 2026-08-11 — passer de 131 à 142 lignes a changé QUATRE charges sur six,
    // sans qu'aucun code ait bougé. Une sortie relue plus tard doit permettre de dire si
    // elle est comparable à une autre, et non de le deviner.
    // Ces trois nombres sont là pour ça, à côté de l'empreinte du prompt qui joue le même
    // rôle pour la lecture de l'IA.
    console.log(`  ⓘ provenance des charges : base « ${donnees.extraitDe ?? '?'} »`
        + ` · extraites le ${String(donnees.extraitLe ?? '?').slice(0, 19).replace('T', ' ')}`);
    if (donnees.lignesAuJournal == null) {
        avertir('charges extraites avant l\'enregistrement de la taille du journal',
            'impossible de dire si une autre sortie leur est comparable -> node verrou-charges.js --base=test');
    } else {
        const e = donnees.lignesEligibles ?? {};
        console.log(`     journal au moment de l'extraction : ${donnees.lignesAuJournal} ligne(s)`
            + (e.avecPhoto != null ? ` · ${e.avecPhoto} avec photo · ${e.abouties} abouties` : ''));
        console.log(`     -> deux sorties ne se comparent ligne à ligne que si CES nombres sont identiques.`);
    }

    console.log('\n=== 2. Serveur réel, réseau rejoué ===');
    // ⚠️ LE SERVEUR ENFANT EST INSTRUMENTÉ. NODE_V8_COVERAGE est hérité par les processus
    // fils : la couverture d'index.js par les charges est donc capturée telle quelle, sans
    // une ligne d'instrumentation dans le code de production. C'est ce dossier que le
    // cliquet fusionnera — sans lui, il annonçait « jamais exécutées » des fonctions qui
    // venaient de tourner quatre fois.
    // Vidé à chaque exécution : une couverture d'hier ferait passer pour couvert ce qui ne
    // l'est plus.
    fs.rmSync(DOSSIER_COUVERTURE, { recursive: true, force: true });
    fs.mkdirSync(DOSSIER_COUVERTURE, { recursive: true });
    let srv;
    try {
        srv = await demarrer(path.join(__dirname, 'verrou', 'faux-reseau.js'), {
            VERROU_CHARGES: FICHIER_CHARGES,
            JETON_API: JETON,
            OPENROUTER_API_KEY: '',
            NODE_V8_COVERAGE: DOSSIER_COUVERTURE
        });
    } catch (e) {
        verifier('le serveur démarre', false, e.message);
        process.exit(1);
    }
    verifier('le serveur démarre', true);
    verifier('faux réseau armé', /\[faux-reseau\] armé/.test(srv.lire()));
    verifier('Mongo connecté sur test_scratch', await srv.attendreMongo());

    // ════════════════════════════════════════════════════════════════════════
    // L'ÉTAT DE L'ENREGISTREMENT TCGdex — trois cas, trois messages
    // ════════════════════════════════════════════════════════════════════════
    // ⚠️ UN FICHIER VIDE NE DOIT PAS PASSER POUR UN CACHE LÉGITIME. Avant cette
    // distinction, « absent » et « vide » produisaient la même sortie : toutes les URL
    // manquantes, donc le verdict « la chaîne demande autre chose à TCGdex » — un
    // diagnostic FAUX, qui aurait envoyé chercher une régression inexistante.
    // On lit donc l'état sur la ligne d'armement, et on décide AVANT de regarder les URL.
    const etatTcgdex = (srv.lire().match(/TCGDEX-(\w+)/) || [])[1] ?? 'INCONNU';
    let couvertes = [];
    try { couvertes = JSON.parse((srv.lire().match(/CHARGES-COUVERTES (\[.*\])/) || [])[1] ?? '[]'); } catch (_) { }

    let enregistrementUtilisable = false;
    if (etatTcgdex === 'PRESENT') {
        // PARTIEL : le fichier existe et contient des réponses, mais pas pour toutes les
        // charges présentes. C'est distinct d'un changement de comportement.
        const attendues = donnees.charges.map(c => c.source?._id).filter(Boolean);
        const manquantes = attendues.filter(id => !couvertes.includes(id));
        if (manquantes.length) {
            verifier(`enregistrement TCGdex complet`, false,
                `PARTIEL : ${manquantes.length} charge(s) sur ${attendues.length} jamais enregistrée(s) -> node verrou-charges.js --base=test`);
        } else {
            verifier(`enregistrement TCGdex présent et complet (${couvertes.length} charge(s))`, true);
            enregistrementUtilisable = true;
        }
    } else if (etatTcgdex === 'VIDE') {
        verifier('enregistrement TCGdex non vide', false,
            'le fichier EXISTE mais ne contient AUCUNE réponse — la phase 2 a échoué (vidage IPC ?). Ce n\'est PAS un cache légitime.');
    } else if (etatTcgdex === 'ILLISIBLE') {
        verifier('enregistrement TCGdex lisible', false, 'verrou/tcgdex.json est corrompu -> réenregistre');
    } else if (etatTcgdex === 'ABSENT') {
        verifier('enregistrement TCGdex présent', false,
            'aucun fichier verrou/tcgdex.json -> node verrou-charges.js --base=test');
    } else {
        verifier('état de l\'enregistrement TCGdex lisible', false, `ligne d'armement non reconnue`);
    }

    console.log('\n=== 3. /api/identifier sur chaque charge ===');
    const urlsInconnues = new Set();
    // La garde du cliquet : si une charge n'atteint pas sa profondeur, elle n'a pas
    // traversé le code qu'elle devait traverser, et la couverture produite est AMPUTÉE.
    // La comparer au plancher annoncerait des régressions qui n'en sont pas.
    let profondeursAtteintes = true;
    for (const c of donnees.charges) {
        const avant = srv.lire().length;
        const r = await appeler(srv.port, 'POST', '/api/identifier', {
            userId: USER_VERROU, imageUrls: [c.imageUrl], title: null, vintedEtat: null
        }, JETON);
        const nouveau = srv.lire().slice(avant);
        const nom = c.lecture.name;

        verifier(`[${nom}] réponse HTTP`, r.status === 200, `status ${r.status}`);

        // ⚠️ ATTENTION AU PIÈGE, il s'est présenté dans son propre lot : la version d'origine
        // de ce contrôle cherchait la signature d'exception DANS LE MESSAGE renvoyé, ce qui
        // marchait tant que la route renvoyait `e.message` brut. Le masquage de cette fuite,
        // écrit le même jour, l'aurait silencieusement DÉSARMÉ. On teste donc le texte
        // GÉNÉRIQUE, qui est la marque du catch.
        const messageErreur = r.json?.error ?? '';
        const sortieParCatch = messageErreur === 'Erreur serveur interne' || SIGNATURE_EXCEPTION.test(messageErreur);
        verifier(`[${nom}] la route n'est pas sortie par son catch`, !sortieParCatch, messageErreur);
        verifier(`[${nom}] aucune exception dans les logs serveur`,
            !nouveau.split('\n').some(l => SIGNATURE_EXCEPTION.test(l)));
        verifier(`[${nom}] lecture rejouée (aucun appel IA payant)`,
            /\[faux-reseau\] lecture rejouée/.test(nouveau));

        // ---- LA PROFONDEUR, le contrôle qui manquait ----
        const p = profondeurAtteinte(nouveau, r.json);
        const suffit = profondeurSuffisante(p.atteint, c.profondeurExigee);
        if (!suffit.ok) profondeursAtteintes = false;
        if (suffit.ok) {
            console.log(`  ✅ [${nom}] profondeur « ${p.atteint} » atteinte (exigée : ${c.profondeurExigee})`);
        } else if (suffit.raison) {
            // La charge ne déclare rien d'exploitable : elle vient d'une extraction
            // antérieure aux jalons. Ce n'est pas la chaîne qui est en cause, et le message
            // doit le dire — sinon on cherche un bug là où il n'y en a pas.
            echecs++;
            console.log(`  ❌ [${nom}] ${suffit.raison}`);
            console.log(`       charge extraite avant l'ajout des jalons -> node verrou-charges.js --base=test`);
            console.log(`       (elle est allée jusqu'à « ${p.atteint ?? 'nulle part'} »)`);
        } else {
            echecs++;
            console.log(`  ❌ [${nom}] PROFONDEUR NON ATTEINTE`);
            console.log(`       exigée  : ${c.profondeurExigee} — ${decrire(c.profondeurExigee)}`);
            console.log(`       atteinte: ${p.atteint ?? '(aucune)'}${p.atteint ? ` — ${decrire(p.atteint)}` : ''}`);
            console.log(`       franchis: ${p.franchis.join(' > ') || '—'}`);
            // Les deux lectures, toujours données : voir le couplage documenté dans jalons.js.
            console.log(`       => soit la chaîne s'est arrêtée avant, soit le log qui sert de jalon a changé.`);
        }

        // ---- LE DÉTECTEUR DE CHANGEMENT DE COMPORTEMENT ----
        for (const l of nouveau.split('\n')) {
            const m = l.match(/URL-TCGDEX-NON-ENREGISTREE (\S+)/);
            if (m) urlsInconnues.add(m[1]);
        }

        const issue = r.json?.success ? 'succès' : `échec applicatif : ${messageErreur || '?'}`;
        console.log(`       -> ${issue}`);
        // ⚠️ ON N'ASSERTE RIEN SUR LE RÉSULTAT. Ni idProduct, ni prix, ni score, ni chemin.
        // Figer une réponse ferait de ce verrou un second banc : il casserait à chaque
        // amélioration du scoring, et on le « réparerait » en baissant ses attentes.
    }

    // ════════════════════════════════════════════════════════════════════════
    // 7e CELLULE — UNE SOURCE TOMBÉE NE PRODUIT PAS UNE ABSENCE AFFIRMÉE
    // ════════════════════════════════════════════════════════════════════════
    // ⚠️ ET C'EST LA SEULE CELLULE QUI ASSERTE SUR LA RÉPONSE. Les six autres n'assertent
    // rien du résultat, et c'est délibéré : figer un idProduct ferait de ce verrou un
    // second banc, qui casserait à chaque amélioration du scoring et qu'on « réparerait »
    // en baissant ses attentes. Ici on n'asserte pas un RÉSULTAT, on asserte un CONTRAT :
    // « la chaîne n'affirme jamais une absence qu'elle n'a pas constatée ». Ce contrat ne
    // doit jamais s'assouplir, quel que soit le scoring.
    //
    // POURQUOI ELLE EXISTE. La parade de sources.js est couverte par 31 assertions qui
    // SIMULENT une source qui tombe. Aucune ne prouvait qu'une panne Mongo réelle
    // traverse la route jusqu'à la réponse rendue. C'est exactement l'écart qui existait
    // le 4 août entre huit suites vertes et une production morte.
    //
    // ELLE NE CONSOMME AUCUNE CHARGE NOUVELLE : elle rejoue la première, avec le
    // catalogue coupé. Ce qu'on mesure n'est pas la carte, c'est la sortie.
    console.log('\n=== 3 bis. 7e cellule : le catalogue tombe pendant un scan ===');
    if (!donnees.charges.length) {
        console.log('  ⛔ aucune charge disponible — cellule non exercée.');
    } else {
        const c7 = donnees.charges[0];
        const avant7 = srv.lire().length;
        srv.enfant.send('panne-catalogue');
        // L'IPC est asynchrone : sans cette attente, la requête pourrait partir avant que
        // le serveur ait armé la panne, et la cellule passerait au vert en n'exerçant rien.
        for (let i = 0; i < 40 && !/PANNE-CATALOGUE ARMEE/.test(srv.lire()); i++) {
            await new Promise(r => setTimeout(r, 50));
        }
        verifier('[7e] la panne est armée côté serveur', /PANNE-CATALOGUE ARMEE/.test(srv.lire()));

        const r7 = await appeler(srv.port, 'POST', '/api/identifier', {
            userId: USER_VERROU, imageUrls: [c7.imageUrl], title: null, vintedEtat: null
        }, JETON);
        srv.enfant.send('panne-catalogue-off');
        const logs7 = srv.lire().slice(avant7);

        verifier('[7e] réponse HTTP', r7.status === 200, `status ${r7.status}`);
        // ⚠️ PAS SORTIE PAR LE CATCH. Une panne de source doit produire un REFUS PROPRE,
        // pas une exception : si la route sortait par son catch, l'utilisateur verrait
        // « Erreur serveur interne » et la parade n'aurait servi à rien.
        const msg7 = r7.json?.error ?? '';
        const propre7 = msg7 !== 'Erreur serveur interne' && !SIGNATURE_EXCEPTION.test(msg7);
        verifier('[7e] la route n\'est pas sortie par son catch', propre7, msg7);
        if (!propre7) {
            // ⚠️ SORTIR PAR LE CATCH SUR UNE PANNE DE SOURCE VEUT DIRE UNE CHOSE PRÉCISE :
            // une requête catalogue n'est PAS enveloppée quelque part sur le chemin. La
            // cellule ne sert à rien si elle dit qu'il y a un trou sans dire lequel — on
            // recrache donc la trace du serveur, qui porte la pile complète.
            const pile = logs7.split('\n');
            const i = pile.findIndex(l => /Erreur \/api\/identifier/.test(l));
            console.log('       ── la requête non enveloppée est dans cette pile ──');
            for (const l of pile.slice(Math.max(0, i), i + 12)) console.log(`       ${l.trim().slice(0, 150)}`);
        }
        verifier('[7e] la source est bien tombée', /\[source-injoignable\] catalogue\//.test(logs7));
        // ⚠️ LE CONTRÔLE QUI VALIDE LE MIDDLEWARE DE CONTEXTE, en conditions réelles.
        // Si `dansUnScan` n'enveloppait pas tout le corps de la route, la panne serait
        // tombée hors contexte et cette ligne apparaîtrait. C'est la seule preuve qu'on
        // ait que le contexte couvre la requête entière.
        verifier('[7e] la panne est tombée DANS le contexte du scan',
            !/\[panne-hors-contexte\]/.test(logs7),
            'le contexte n\'enveloppe pas tout le corps de la route');
        verifier('[7e] le scan ne rend AUCUN prix', r7.json?.success === false, JSON.stringify(r7.json?.success));
        // Le cœur de la cellule.
        verifier('[7e] le refus sort en ÉCHEC TECHNIQUE, pas en refus délibéré',
            r7.json?.natureRefus === 'echec-technique',
            `natureRefus = ${r7.json?.natureRefus} (motif ${r7.json?.motifRefus})`);
        verifier('[7e] la requalification est tracée', /\[absence-non-constatee\]/.test(logs7));
        verifier('[7e] le crédit est rendu', r7.json?.rembourse === true, String(r7.json?.rembourse));

        // ---- ET LA LIGNE DE JOURNAL PORTE LE NOM DE LA SOURCE ----
        // Sans ça, on saurait qu'il y a eu une panne sans savoir laquelle — et on referait
        // l'enquête du 2026-08-15 à chaque fois.
        try {
            const mongoose7 = require('mongoose');
            const bac7 = await mongoose7.createConnection(process.env.MONGODB_URI, { dbName: 'test_scratch' }).asPromise();
            const ligne = await bac7.collection('journal_scans')
                .findOne({ userId: USER_VERROU }, { sort: { le: -1 } });
            verifier('[7e] la ligne de journal porte `sourcesEnPanne`',
                Array.isArray(ligne?.sourcesEnPanne) && ligne.sourcesEnPanne.length > 0,
                JSON.stringify(ligne?.sourcesEnPanne ?? null));
            console.log(`       -> motif ${r7.json?.motifRefus} · nature ${r7.json?.natureRefus}` +
                ` · sources ${JSON.stringify(ligne?.sourcesEnPanne ?? [])}`);
            // Sur un `erreur-serveur`, c'est cette ligne qui nomme la requête NON
            // enveloppée : sans elle, la cellule dit qu'il y a un trou sans dire où.
            if (ligne?.messageErreur) console.log(`       -> exception : ${ligne.messageErreur}`);
            await bac7.close();
        } catch (e) {
            echecs++;
            console.log(`  ❌ [7e] lecture du journal impossible : ${e.message}`);
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // LA CHAÎNE DEMANDE-T-ELLE AUTRE CHOSE À TCGdex QU'AU MOMENT DE L'ENREGISTREMENT ?
    // ════════════════════════════════════════════════════════════════════════
    // Ce n'est PAS un trou de cache. C'est un CHANGEMENT DE COMPORTEMENT : la chaîne
    // interroge une route, une langue ou un identifiant qu'elle n'interrogeait pas. Ça
    // n'arrive presque jamais volontairement — ça arrive en modifiant une fonction en
    // amont. Le message doit donc le dire, pas afficher une exception réseau.
    if (urlsInconnues.size && !enregistrementUtilisable) {
        // ⚠️ NE PAS ACCUSER LA CHAÎNE QUAND C'EST L'ENREGISTREMENT QUI MANQUE. Sans cette
        // garde, un tcgdex.json absent ou vide produisait le verdict « comportement
        // changé » et envoyait chercher une régression qui n'existe pas.
        console.log(`\nℹ️ ${urlsInconnues.size} URL TCGdex non enregistrée(s) — ATTENDU, l'enregistrement n'est pas`);
        console.log(`   utilisable (voir ci-dessus). Ce n'est pas un changement de comportement.`);
    } else if (urlsInconnues.size) {
        echecs++;
        console.log(`\n❌ LA CHAÎNE DEMANDE MAINTENANT AUTRE CHOSE À TCGdex (${urlsInconnues.size} URL non enregistrée(s))`);
        console.log(`   L'enregistrement est complet et à jour : ces URL sont donc NOUVELLES.`);
        for (const u of urlsInconnues) console.log(`     ${u}`);
        console.log(`   Deux lectures, et une seule est bénigne :`);
        console.log(`     - VOULU   : tu as ajouté un appel. Réenregistre : node verrou-charges.js --base=test`);
        console.log(`     - SUBI    : une modification en amont a changé ce qui est demandé sans que`);
        console.log(`                 personne le décide. C'est le cas à regarder de près.`);
    }

    verifier('le serveur est toujours en vie', srv.enfant.exitCode === null);
    // ⚠️ ON ATTEND SA SORTIE. Le préchargement le fait sortir proprement sur SIGTERM pour
    // que V8 dépose la couverture ; enchaîner sur le cliquet sans attendre la lirait avant
    // qu'elle soit écrite.
    await new Promise(resolve => {
        srv.enfant.once('exit', resolve);
        try { srv.enfant.send('arret'); } catch (_) { srv.enfant.kill(); }
        setTimeout(() => { try { srv.enfant.kill(); } catch (_) { } resolve(); }, 8000);
    });
    const fichiersCouv = fs.existsSync(DOSSIER_COUVERTURE) ? fs.readdirSync(DOSSIER_COUVERTURE).length : 0;
    verifier(`couverture du serveur écrite (${fichiersCouv} fichier(s))`, fichiersCouv > 0,
        'V8 n\'a rien déposé — le cliquet fusionnerait du vide');

    // ---- Nettoyage du bac à sable ----
    try {
        const mongoose = require('mongoose');
        const bac = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: 'test_scratch' }).asPromise();
        if (bac.db.databaseName === 'test_scratch') {
            const n = await bac.collection('credits').deleteMany({ userId: USER_VERROU });
            const j = await bac.collection('journal_scans').deleteMany({ userId: USER_VERROU });
            // ⚠️ `remboursements` MANQUAIT, ET ÇA A FAIT MENTIR UNE ASSERTION. Le compteur
            // anti-abus est par (userId, JOUR) et plafonné à 5 : il survivait au nettoyage,
            // donc à la sixième exécution du verrou dans la même journée, le remboursement
            // était refusé par le plafond et la 7e cellule annonçait « le crédit n'est pas
            // rendu ». Un défaut du dispositif, pas de la production — et le pire genre :
            // il n'apparaît qu'après plusieurs passages, donc jamais quand on le cherche.
            const rb = await bac.collection('remboursements').deleteMany({ userId: USER_VERROU });
            console.log(`\n🧹 test_scratch : ${n.deletedCount} crédit(s), ${j.deletedCount} ligne(s) de journal,` +
                ` ${rb.deletedCount} compteur(s) de remboursement supprimés.`);
        }
        await bac.close();
    } catch (e) { console.log(`\n⚠️ nettoyage impossible : ${e.message}`); }

    console.log('\n=== 4. Cliquet de couverture (suites + couverture du verrou) ===');
    if (!profondeursAtteintes) {
        // ⚠️ ABANDON, PAS ÉCHEC DU CLIQUET. La couverture est amputée pour une raison déjà
        // signalée plus haut ; la comparer produirait un second message d'erreur qui
        // accuserait le mauvais coupable.
        console.log('  ⛔ MESURE ABANDONNÉE — une charge n\'a pas atteint sa profondeur.');
        console.log('     La couverture produite est amputée : la comparer annoncerait des');
        console.log('     régressions qui n\'existent pas. Corrige la profondeur d\'abord.');
    } else {
        try {
            execFileSync(process.execPath, ['couverture-index.js', '--cliquet', `--avec=${DOSSIER_COUVERTURE}`],
                { cwd: __dirname, stdio: 'inherit' });
        } catch (e) {
            echecs++;
            console.log('  ❌ le cliquet a reculé (voir ci-dessus)');
        }
    }

    console.log('');
    if (echecs === 0) {
        console.log(`Ce qui a tourné : le serveur démarre, ${donnees.charges.length} charge(s) traversent la route jusqu'à leur profondeur exigée, aucune exception, le cliquet tient.`);
        console.log(`   + la 7e cellule : le catalogue tombe pendant un scan, et le refus sort en échec technique.`);
        if (avertissements) console.log(`${avertissements} avertissement(s) ci-dessus — à lire, ils ne bloquent pas.`);
        console.log(`Ce qui n'a PAS tourné : aucun appel réel au modèle, aucune vérification d'identification. C'est U4.`);
    } else {
        console.log(`❌ ${echecs} échec(s). NE PAS DÉPLOYER.`);
    }
    process.exit(echecs === 0 ? 0 : 1);
})();
