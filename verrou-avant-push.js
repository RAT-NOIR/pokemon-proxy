// ============================================================
// LE VERROU AVANT PUSH — « est-ce que le code tourne ? »
// ============================================================
// POURQUOI IL EXISTE. Deux déploiements consécutifs ont tué la production alors que TOUTES
// les vérifications étaient vertes :
//   - 83789c2 : le catalogue anglais interrogé avec un nom japonais ;
//   - le suivant : `memeCodeParConventionX is not a function`, parce qu'index.js passait à
//     `setCodeCompatibleVintage` un objet FABRIQUÉ À LA MAIN avec trois fonctions sur quatre.
//
// LE SECOND EST LE PLUS INSTRUCTIF, et il faut le nommer précisément : les 52 assertions de
// la table close et les 32 du chemin par le code PASSAIENT. Elles passaient parce qu'elles
// appelaient la même fonction avec le MODULE ENTIER, quand la production lui passait un
// extrait. Même fonction, même entrée, deuxième argument différent.
//
//   ⚠️ CE N'ÉTAIT PAS UN TROU DE COUVERTURE, C'ÉTAIT UNE COUVERTURE MENSONGÈRE.
//   Elle est PIRE que l'absence de test, parce qu'elle rassure. Un fichier sans test se
//   sait fragile ; un fichier à 52 assertions vertes se croit tenu.
//
//   C'est le DEUXIÈME PRINCIPE dans sa forme la plus bête, et sa portée s'élargit d'un cran :
//   UN STUB FABRIQUÉ À LA MAIN EST UNE SECONDE SOURCE DE VÉRITÉ, ET ÇA VAUT POUR LE
//   CONTENANT AUTANT QUE POUR LE CONTENU. La première fois, c'était `LANGUES_ASIATIQUES`
//   défini deux fois, plus large dans index.js : le contenu divergeait. Cette fois c'est
//   l'OBJET lui-même qui divergeait — il n'avait pas les mêmes clés que le vrai module, et
//   aucune des deux définitions n'était consultable depuis l'autre.
//   Corollaire, écrit pour qu'on bute dessus : ON PASSE LE MODULE, JAMAIS UN EXTRAIT. Et un
//   test qui construit son propre objet à la place de celui de la production ne teste pas
//   la production.
//
// CE QUE CE VERROU FAIT, ET RIEN DE PLUS : il démarre le VRAI serveur et POSTe sur
// /api/identifier des charges ENREGISTRÉES, sans appeler l'IA. Il échoue sur n'importe
// quelle exception — ReferenceError, TypeError, import manquant, appel réseau non prévu.
// Il ne juge AUCUNE identification. Il répond à « le code tourne-t-il », ce qui devrait
// être le minimum absolu avant un push.
//
// ⚠️ CE QU'IL N'ATTRAPE PAS, ET IL FAUT LE SAVOIR POUR NE PAS S'Y FIER :
//   - le kana : la lecture rejouée est figée, donc toujours dans le bon alphabet ;
//   - une identification fausse : il ne compare rien à une vérité ;
//   - une dérive du modèle : il ne l'appelle pas. C'est le rôle d'U4.
//
// GRATUIT, HORS LIGNE, ÉCRITURES CONFINÉES À test_scratch.
// USAGE :  node verrou-avant-push.js
// Prérequis : node verrou-charges.js --base=test  (une fois, puis à chaque dérive signalée)

require('dotenv').config();
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const net = require('net');
const fs = require('fs');
const { empreintePrompt } = require('./verrou/empreinte');

const BASE_SCRATCH = 'test_scratch';
const JETON = process.env.JETON_API || 'jeton-verrou';
const USER_VERROU = 'verrou-avant-push';   // identifiant réservé : jamais un vrai scan
const FICHIER_CHARGES = path.join(__dirname, 'verrou', 'charges.json');

let echecs = 0;
function verifier(libelle, ok, detail = '') {
    if (!ok) echecs++;
    console.log(`  ${ok ? '✅' : '❌'} ${libelle}${ok || !detail ? '' : ` — ${detail}`}`);
    return ok;
}

// LA SIGNATURE D'UNE EXCEPTION QUI A ÉTÉ AVALÉE. Le `catch` de la route répond 200 avec
// `success:false` : le code HTTP ne dit RIEN. C'est littéralement ce qui s'est passé —
// l'extension a affiché « memeCodeParConventionX is not a function » dans un 200.
const SIGNATURE_EXCEPTION = /is not a function|is not defined|Cannot read propert|undefined is not|of undefined|of null|\bReferenceError\b|\bTypeError\b/i;

function portLibre() {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
        s.on('error', reject);
    });
}
function attendreServeur(port, timeoutMs = 30000) {
    const debut = Date.now();
    return new Promise((resolve, reject) => {
        const essai = () => {
            const s = net.connect(port, '127.0.0.1');
            s.on('connect', () => { s.destroy(); resolve(); });
            s.on('error', () => {
                s.destroy();
                if (Date.now() - debut > timeoutMs) reject(new Error('le serveur n\'a pas démarré à temps'));
                else setTimeout(essai, 250);
            });
        };
        essai();
    });
}
function appeler(port, methode, chemin, corps) {
    return new Promise(resolve => {
        const donnees = corps == null ? null : Buffer.from(JSON.stringify(corps));
        const req = require('http').request({
            host: '127.0.0.1', port, path: chemin, method: methode,
            headers: {
                'x-jeton': JETON,
                ...(donnees ? { 'content-type': 'application/json', 'content-length': donnees.length } : {})
            }
        }, res => {
            let b = '';
            res.on('data', d => b += d);
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(b); } catch (_) { }
                resolve({ status: res.statusCode, json, brut: b });
            });
        });
        req.on('error', e => resolve({ status: 0, json: null, brut: e.message }));
        if (donnees) req.write(donnees);
        req.end();
    });
}

(async () => {
    console.log('=== VERROU AVANT PUSH ===');

    // ---- 1. Les charges existent-elles, et sont-elles encore d'actualité ? ----
    if (!fs.existsSync(FICHIER_CHARGES)) {
        console.log(`\n❌ ${FICHIER_CHARGES} absent.`);
        console.log('   Extrais les charges du journal (elles ne s\'écrivent PAS à la main) :');
        console.log('   node verrou-charges.js --base=test');
        process.exit(1);
    }
    const donnees = JSON.parse(fs.readFileSync(FICHIER_CHARGES, 'utf8'));
    console.log(`\n=== 1. Charges (extraites de ${donnees.extraitDe} le ${String(donnees.extraitLe).slice(0, 16)}) ===`);
    verifier(`${donnees.charges.length} cellule(s) sur 3`, donnees.charges.length === 3,
        `cellules manquantes : le journal n'avait aucune ligne correspondante`);
    for (const c of donnees.charges) {
        console.log(`     ${c.cellule}`);
        console.log(`       "${c.lecture.name}" n°${c.lecture.number ?? '—'} setCode=${c.lecture.setCode ?? '—'} ${c.lecture.language}  (scan ${String(c.source.le).slice(0, 10)})`);
    }

    // ⚠️ LA DÉRIVE DU PROMPT — signalée, JAMAIS bloquante. Un prompt qui change n'est pas
    // une panne, et faire échouer le push pour ça pousserait à contourner le verrou, ce
    // qui coûterait bien plus cher que des charges un peu vieilles.
    const actuelle = empreintePrompt();
    const enregistree = donnees.empreintePrompt || {};
    if (actuelle.hash !== enregistree.hash) {
        console.log(`\n  ⚠️  LE PROMPT A CHANGÉ DEPUIS L'EXTRACTION DES CHARGES`);
        console.log(`      empreinte enregistrée : ${enregistree.hash} (${enregistree.modele})`);
        console.log(`      empreinte actuelle    : ${actuelle.hash} (${actuelle.modele})`);
        console.log(`      Les lectures rejouées peuvent avoir une forme que le modèle ne rend plus.`);
        console.log(`      Rafraîchis-les : node verrou-charges.js --base=test`);
    } else {
        verifier(`empreinte du prompt inchangée (${actuelle.hash})`, true);
    }

    // ---- 2. Le vrai serveur, avec le faux réseau ----
    console.log('\n=== 2. Serveur réel, réseau neutralisé ===');
    const port = await portLibre();
    const enfant = spawn(process.execPath, ['-r', path.join(__dirname, 'verrou', 'faux-reseau.js'), 'index.js'], {
        cwd: __dirname,
        env: {
            ...process.env,
            // index.js s'ARRÊTE de lui-même si la base connectée n'est pas celle-ci.
            MONGODB_BASE: BASE_SCRATCH,
            PORT: String(port),
            JETON_API: JETON,
            VERROU_CHARGES: FICHIER_CHARGES,
            // Aucune clé : si le faux réseau laissait passer un appel, il échouerait au
            // lieu de dépenser. Ceinture ET bretelles.
            OPENROUTER_API_KEY: '',
            STRIPE_SECRET_KEY: ''
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let sortie = '';
    enfant.stdout.on('data', d => { sortie += d.toString(); });
    enfant.stderr.on('data', d => { sortie += d.toString(); });

    let demarre = true;
    try { await attendreServeur(port); }
    catch (e) { demarre = false; verifier('le serveur démarre', false, e.message); }
    if (!demarre) {
        console.log('  --- sortie du serveur ---\n' + sortie.split('\n').map(l => '    ' + l).join('\n'));
        enfant.kill();
        process.exit(1);
    }
    verifier('le serveur démarre', true);
    verifier('faux réseau armé', /\[faux-reseau\] armé/.test(sortie));

    let mongoPret = false;
    for (let i = 0; i < 40 && !mongoPret; i++) {
        const p = await appeler(port, 'GET', '/ping', null);
        mongoPret = p.json?.mongo === true;
        if (!mongoPret) await new Promise(r => setTimeout(r, 250));
    }
    verifier('Mongo connecté sur test_scratch', mongoPret);

    // ---- 3. Les charges, une par une ----
    console.log('\n=== 3. /api/identifier sur chaque charge ===');
    for (const c of donnees.charges) {
        const avant = sortie.length;
        const r = await appeler(port, 'POST', '/api/identifier', {
            userId: USER_VERROU,
            imageUrls: [c.imageUrl],
            title: null,
            vintedEtat: null
        });
        const nouveau = sortie.slice(avant);
        const nom = c.lecture.name;

        // a) la route a répondu quelque chose d'HTTP-valide
        verifier(`[${nom}] réponse HTTP`, r.status === 200, `status ${r.status}`);

        // b) LA ROUTE N'EST PAS SORTIE PAR SON CATCH.
        //    ⚠️ ATTENTION AU PIÈGE, il s'est présenté dans ce lot même. La version d'origine
        //    de ce contrôle cherchait la signature d'exception DANS LE MESSAGE renvoyé —
        //    ce qui marchait tant que la route renvoyait `e.message` brut. Le masquage de
        //    cette fuite, écrit le même jour, aurait donc silencieusement DÉSARMÉ ce
        //    contrôle : la réponse dit désormais « Erreur serveur interne », qui ne
        //    ressemble à aucune exception. Deux correctifs justes qui s'annulent.
        //    On teste donc le texte GÉNÉRIQUE, qui est la marque du catch, et on garde la
        //    signature pour les messages qui ne passeraient pas par lui.
        const messageErreur = r.json?.error ?? '';
        const sortieParCatch = messageErreur === 'Erreur serveur interne' || SIGNATURE_EXCEPTION.test(messageErreur);
        verifier(`[${nom}] la route n'est pas sortie par son catch`, !sortieParCatch, messageErreur);

        // c) AUCUNE exception côté serveur non plus. Une branche peut avaler l'erreur et
        //    répondre proprement : les logs, eux, la portent toujours.
        const traceServeur = nouveau.split('\n').filter(l => SIGNATURE_EXCEPTION.test(l));
        verifier(`[${nom}] aucune exception dans les logs serveur`,
            traceServeur.length === 0, traceServeur.slice(0, 3).join(' | '));

        // d) la lecture a bien été rejouée -> on a vraiment traversé getCardIdFromAI
        verifier(`[${nom}] lecture rejouée (aucun appel IA payant)`,
            /\[faux-reseau\] lecture rejouée/.test(nouveau));

        // ⚠️ ON N'ASSERTE RIEN SUR LE RÉSULTAT. Ni idProduct, ni prix, ni score, ni chemin
        // emprunté. Figer une réponse ferait de ce verrou un second banc : il casserait à
        // chaque amélioration du scoring, et on le « réparerait » en baissant ses attentes.
        const issue = r.json?.success ? `succès` : `échec applicatif : ${messageErreur || '?'}`;
        console.log(`       -> ${issue}`);
    }

    // ---- 4. Le serveur a-t-il survécu ? ----
    verifier('le serveur est toujours en vie', enfant.exitCode === null);
    enfant.kill();

    // ---- 5. Nettoyage : le crédit d'accueil consommé dans le bac à sable ----
    try {
        const mongoose = require('mongoose');
        const bac = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: BASE_SCRATCH }).asPromise();
        if (bac.db.databaseName === BASE_SCRATCH) {
            const n = await bac.collection('credits').deleteMany({ userId: USER_VERROU });
            const j = await bac.collection('journal_scans').deleteMany({ userId: USER_VERROU });
            console.log(`\n🧹 test_scratch : ${n.deletedCount} crédit(s), ${j.deletedCount} ligne(s) de journal supprimées.`);
        }
        await bac.close();
    } catch (e) { console.log(`\n⚠️ nettoyage impossible : ${e.message}`); }

    // ---- 6. LE CLIQUET DE COUVERTURE ----
    console.log('\n=== 4. Cliquet de couverture ===');
    try {
        execFileSync(process.execPath, ['couverture-index.js', '--cliquet'], { cwd: __dirname, stdio: 'inherit' });
    } catch (e) {
        echecs++;
        console.log('  ❌ le cliquet a reculé (voir ci-dessus)');
    }

    console.log(echecs === 0 ? '\n🎉 Verrou au vert — le code tourne.' : `\n❌ ${echecs} échec(s). NE PAS DÉPLOYER.`);
    process.exit(echecs === 0 ? 0 : 1);
})();
