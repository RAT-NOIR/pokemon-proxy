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
            'manque de données au journal, pas un défaut du code');
        for (const m of donnees.cellulesManquantes ?? []) console.log(`      manquante : ${m}`);
    } else {
        verifier(`${voulues} cellules sur ${voulues}`, true);
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

    console.log('\n=== 2. Serveur réel, réseau rejoué ===');
    let srv;
    try {
        srv = await demarrer(path.join(__dirname, 'verrou', 'faux-reseau.js'), {
            VERROU_CHARGES: FICHIER_CHARGES,
            JETON_API: JETON,
            OPENROUTER_API_KEY: ''
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
    srv.enfant.kill();

    // ---- Nettoyage du bac à sable ----
    try {
        const mongoose = require('mongoose');
        const bac = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: 'test_scratch' }).asPromise();
        if (bac.db.databaseName === 'test_scratch') {
            const n = await bac.collection('credits').deleteMany({ userId: USER_VERROU });
            const j = await bac.collection('journal_scans').deleteMany({ userId: USER_VERROU });
            console.log(`\n🧹 test_scratch : ${n.deletedCount} crédit(s), ${j.deletedCount} ligne(s) de journal supprimées.`);
        }
        await bac.close();
    } catch (e) { console.log(`\n⚠️ nettoyage impossible : ${e.message}`); }

    console.log('\n=== 4. Cliquet de couverture ===');
    try {
        execFileSync(process.execPath, ['couverture-index.js', '--cliquet'], { cwd: __dirname, stdio: 'inherit' });
    } catch (e) {
        echecs++;
        console.log('  ❌ le cliquet a reculé (voir ci-dessus)');
    }

    console.log('');
    if (echecs === 0) {
        console.log(`Ce qui a tourné : le serveur démarre, ${donnees.charges.length} charge(s) traversent la route jusqu'à leur profondeur exigée, aucune exception, le cliquet tient.`);
        if (avertissements) console.log(`${avertissements} avertissement(s) ci-dessus — à lire, ils ne bloquent pas.`);
        console.log(`Ce qui n'a PAS tourné : aucun appel réel au modèle, aucune vérification d'identification. C'est U4.`);
    } else {
        console.log(`❌ ${echecs} échec(s). NE PAS DÉPLOYER.`);
    }
    process.exit(echecs === 0 ? 0 : 1);
})();
