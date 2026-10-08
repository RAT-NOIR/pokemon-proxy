// ============================================================
// TEST DU CHEMIN ARGENT — décompte et remboursement d'un scan
// ============================================================
// USAGE : node test-acces.js
//
// ⚠️ DEUX RÈGLES NON NÉGOCIABLES, et ce fichier les fait respecter par construction :
//
// 1. IL IMPORTE LE VRAI MODULE (./acces). Il n'en recopie AUCUNE logique. Une copie
//    conforme diverge du code réel sans que rien ne le signale, et le test reste vert
//    sur du code qui n'est plus en production — c'est exactement ce qui s'est produit
//    avec la règle "reverse -> V2".
//
// 2. IL ÉCRIT DANS `test_scratch`, JAMAIS EN PRODUCTION. Attention : la base de prod
//    de ce projet s'appelle littéralement `test` (nom par défaut de Mongoose quand
//    l'URI n'en précise pas). Un garde-fou en tête de main() refuse de démarrer si la
//    base connectée n'est pas `test_scratch` — parce qu'un $inc sur un document réel
//    ne laisse aucun résidu, juste un solde faux, et qu'aucune piste d'audit ne
//    permettrait de le constater après coup (ces schémas n'ont pas de timestamps).

// Valeurs FIXÉES avant le require : acces.js lit ces variables au chargement, et le
// test doit être déterministe quel que soit le contenu du .env.
process.env.SCANS_ACCUEIL = '25';
process.env.SCANS_GRATUITS_SEMAINE = '2';
process.env.REMBOURSEMENTS_MAX_JOUR = '5';
process.env.REMBOURSEMENTS_QUESTIONS_MAX_JOUR = '30';
// ⚠️ GARDÉE À 'false' EXPRÈS (bloc L) : la variable n'existe plus, et une valeur oubliée sur Render ne doit pas pouvoir rétablir
// la facturation des questions. Le bloc L prouve qu'elle est ignorée.
process.env.REMBOURSER_SI_INCERTAIN = 'false';
delete process.env.CODE_ILLIMITE;

require('dotenv').config();
const mongoose = require('mongoose');
mongoose.set('strictQuery', false);

const { connecterMongo } = require('./mongo-connexion');
const { viderBac, nomsDesModeles } = require('./verrou/bac');
const { ouvrirBanc } = require('./collecte-cartes/base-banc');
const {
    Credit, QuotaSemaine, Remboursement, RemboursementQuestion,
    exigerImage, verifierAcces, rembourserScan, signalerIncertain,
    semaineISO, SCANS_ACCUEIL, SCANS_GRATUITS_SEMAINE, REMBOURSEMENTS_MAX_JOUR, REMBOURSEMENTS_QUESTIONS_MAX_JOUR
} = require('./acces');

const BASE_TEST = 'test_scratch';

// ---- Harnais Express minimal : on exerce le VRAI middleware ----------------
// Renvoie ce qui compte : la requête (donc req.credit), si next() a été appelé,
// et le couple statut/corps si le middleware a répondu à la place.
async function appelerAcces(userId, corpsSup = {}) {
    const req = { body: { userId, ...corpsSup } };
    let statut = 200, corps = null, passe = false;
    const res = {
        status(c) { statut = c; return this; },
        json(o) { corps = o; return this; }
    };
    await verifierAcces(req, res, () => { passe = true; });
    return { req, passe, statut, corps };
}

async function appelerExigerImage(body) {
    const req = { body };
    let corps = null, passe = false;
    const res = { status() { return this; }, json(o) { corps = o; return this; } };
    exigerImage(req, res, () => { passe = true; });
    return { passe, corps };
}

// ---- Harnais d'assertions --------------------------------------------------
let ok = 0, ko = 0;
const v = (nom, obtenu, attendu) => {
    const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
    console.log(`${bon ? '✅' : '❌'} ${nom} : ${JSON.stringify(obtenu)}${bon ? '' : ` (attendu ${JSON.stringify(attendu)})`}`);
    bon ? ok++ : ko++;
};
const solde = async u => {
    const c = await Credit.findOne({ userId: u }).lean();
    return { gratuit: c?.soldeGratuit ?? null, payant: c?.soldeScans ?? null };
};
const compteurHebdo = async u => (await QuotaSemaine.findOne({ userId: u, semaine: semaineISO() }).lean())?.count ?? 0;

const ids = [];
const neuf = n => { const u = `TEST-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 7)}`; ids.push(u); return u; };
// Met un compte dans un état connu, sans passer par le décompte.
const poser = async (u, soldeGratuit, soldeScans) => {
    await Credit.updateOne({ userId: u }, { $setOnInsert: { userId: u } }, { upsert: true });
    await Credit.updateOne({ userId: u }, { $set: { soldeGratuit, soldeScans } });
};

async function main() {
    // BASE DE BANC (2026-10-08) : ce banc n'ouvre plus la production. Base mémoire, ou MONGODB_TEST_URI hors production, sinon il REFUSE de
    // démarrer (collecte-cartes/base-banc.js). Les modèles de acces.js se connectent à l'ouverture de la connexion, donc après ce point.
    (await ouvrirBanc()).appliquer();
    if (!process.env.MONGODB_URI) { console.error('❌ MONGODB_URI absent du .env'); process.exit(1); }
    // Le test IMPOSE sa base : contrairement aux autres scripts, elle n'est pas
    // négociable en ligne de commande — un test ne doit jamais pouvoir viser la prod.
    process.env.MONGODB_BASE = BASE_TEST;
    const baseConnectee = await connecterMongo({ script: 'test-acces.js', ecrit: true });
    if (baseConnectee !== BASE_TEST) {   // ceinture : connecterMongo a déjà refusé
        console.error(`❌ ARRÊT : base "${baseConnectee}" au lieu de "${BASE_TEST}".`);
        await mongoose.disconnect();
        process.exit(1);
    }
    console.log(`   userId jetables, supprimés en fin de test.\n`);

    // ---------- A. Une requête sans image ne coûte rien ----------
    console.log('--- A. exigerImage, en amont de tout décompte ---');
    {
        v('sans image -> refusée', (await appelerExigerImage({ userId: 'x' })).passe, false);
        v('   corps inchangé pour l\'extension', (await appelerExigerImage({ userId: 'x' })).corps, { success: false, error: "Aucune image reçue" });
        v('imageUrl seule -> passe', (await appelerExigerImage({ imageUrl: 'http://a/1.jpg' })).passe, true);
        v('imageUrls seul -> passe', (await appelerExigerImage({ imageUrls: ['http://a/1.jpg'] })).passe, true);
        v('imageUrls vide -> refusée', (await appelerExigerImage({ imageUrls: [] })).passe, false);
    }

    // ---------- B. Garde-fous d'entrée ----------
    console.log('\n--- B. Garde-fous de verifierAcces ---');
    {
        const r = await appelerAcces(null);
        v('sans userId -> 400', r.statut, 400);
        v('   et aucun débit', r.passe, false);
    }

    // ---------- C. Ordre des poches (non-régression) ----------
    console.log('\n--- C. Ordre de consommation ---');
    {
        const u = neuf('ordre');
        const r1 = await appelerAcces(u);
        v('1er scan -> poche accueil', r1.req.credit.poche, 'accueil');
        v('   solde accueil 24', (await solde(u)).gratuit, 24);
        await poser(u, 0, 3);
        const r2 = await appelerAcces(u);
        v('accueil vide -> poche hebdo', r2.req.credit.poche, 'hebdo');
        v('   payant INTACT (gratuit avant payant)', (await solde(u)).payant, 3);
        await appelerAcces(u);                       // 2e hebdo
        const r4 = await appelerAcces(u);
        v('hebdo épuisé -> poche payant', r4.req.credit.poche, 'payant');
        v('   payant décrémenté', (await solde(u)).payant, 2);
        v('   compteur hebdo non dérivé (rollback)', await compteurHebdo(u), SCANS_GRATUITS_SEMAINE);
    }

    // ---------- D. Épuisement total ----------
    console.log('\n--- D. Plus rien nulle part ---');
    {
        const u = neuf('vide');
        await poser(u, 0, 0);
        await appelerAcces(u); await appelerAcces(u);   // consomme l'hebdo
        const r = await appelerAcces(u);
        v('scan refusé -> 429', r.statut, 429);
        v('   quotaAtteint conservé pour l\'extension', r.corps.quotaAtteint, true);
        v('   compteur hebdo non dérivé après refus', await compteurHebdo(u), SCANS_GRATUITS_SEMAINE);
    }

    // ---------- E. Remboursement par poche ----------
    console.log('\n--- E. Remboursement, poche par poche ---');
    {
        const u = neuf('remb-accueil');
        const r = await appelerAcces(u);
        v('débité accueil -> 24', (await solde(u)).gratuit, 24);
        v('remboursement effectué', await rembourserScan(r.req, 'ia-echec'), true);
        v('   solde accueil restauré à 25', (await solde(u)).gratuit, 25);
    }
    {
        const u = neuf('remb-payant');
        await poser(u, 0, 5);
        await appelerAcces(u); await appelerAcces(u);   // vide l'hebdo
        const r = await appelerAcces(u);
        v('débité payant -> 4', (await solde(u)).payant, 4);
        v('remboursement effectué', await rembourserScan(r.req, 'aucun-prix'), true);
        v('   solde payant restauré à 5', (await solde(u)).payant, 5);
    }
    {
        const u = neuf('remb-hebdo');
        await poser(u, 0, 0);
        const r = await appelerAcces(u);
        v('débité hebdo -> compteur 1', await compteurHebdo(u), 1);
        v('remboursement effectué', await rembourserScan(r.req, 'carte-introuvable'), true);
        v('   compteur hebdo revenu à 0', await compteurHebdo(u), 0);
    }

    // ---------- F. Le code maître ne rembourse rien (il n'a rien pris) ----------
    console.log('\n--- F. Code maître ---');
    {
        process.env.CODE_ILLIMITE = 'SECRET-TEST';
        delete require.cache[require.resolve('./acces')];
        const acces2 = require('./acces');
        const req = { body: { userId: 'peu-importe', codeIllimite: 'SECRET-TEST' } };
        let passe = false;
        await acces2.verifierAcces(req, { status() { return this; }, json() { return this; } }, () => { passe = true; });
        v('code maître -> passe', passe, true);
        v('   aucune poche débitée', req.credit, undefined);
        v('   remboursement sans objet', await acces2.rembourserScan(req, 'ia-echec'), false);

        // Un code FAUX n'ouvre aucun droit : il retombe dans le décompte normal, donc
        // une tentative coûte un scan à celui qui la fait. C'est ce qui rend le
        // brute-force auto-punitif, en plus du limiteur 60/h/IP sur les routes de scan.
        const u = neuf('code-faux');
        const reqFaux = { body: { userId: u, codeIllimite: 'PAS-LE-BON' }, ip: '203.0.113.7' };
        let passeFaux = false;
        await acces2.verifierAcces(reqFaux, { status() { return this; }, json() { return this; } }, () => { passeFaux = true; });
        v('code faux -> pas de passe-droit', reqFaux.credit.poche, 'accueil');
        v('   la tentative COÛTE un scan', (await solde(u)).gratuit, SCANS_ACCUEIL - 1);
        v('   accès quand même accordé (quota normal)', passeFaux, true);

        delete process.env.CODE_ILLIMITE;
        delete require.cache[require.resolve('./acces')];
    }

    // ---------- G. Plafonds : jamais rendre plus qu'on a pris ----------
    console.log('\n--- G. Plafonds ---');
    {
        const u = neuf('plafond-accueil');
        const r = await appelerAcces(u);
        await Credit.updateOne({ userId: u }, { $set: { soldeGratuit: SCANS_ACCUEIL } });
        v('accueil déjà au plafond -> refusé', await rembourserScan(r.req, 'ia-echec'), false);
        v('   solde reste à 25 (jamais 26)', (await solde(u)).gratuit, 25);
    }
    {
        const u = neuf('plafond-hebdo');
        await poser(u, 0, 0);
        const r = await appelerAcces(u);
        await QuotaSemaine.updateOne({ userId: u, semaine: semaineISO() }, { $set: { count: 0 } });
        v('compteur déjà à 0 -> pas de décrément négatif', await rembourserScan(r.req, 'ia-echec'), false);
        v('   compteur reste à 0 (jamais -1)', await compteurHebdo(u), 0);
    }

    // ---------- H. Passage de semaine : pas de cumulation ----------
    console.log('\n--- H. Passage de semaine ---');
    {
        const u = neuf('semaine');
        await poser(u, 0, 0);
        const r = await appelerAcces(u);
        r.req.credit.semaineIso = '1999-W01';   // simule un changement de semaine
        v('semaine différente -> NON remboursé', await rembourserScan(r.req, 'ia-echec'), false);
        v('   compteur de la semaine courante intact', await compteurHebdo(u), 1);
        v('   aucun crédit créé sur l\'ancienne semaine', await QuotaSemaine.findOne({ userId: u, semaine: '1999-W01' }).lean(), null);
    }

    // ---------- I. Double remboursement impossible ----------
    console.log('\n--- I. Un seul remboursement par requête ---');
    {
        const u = neuf('double');
        const r = await appelerAcces(u);
        v('1er appel rembourse', await rembourserScan(r.req, 'ia-echec'), true);
        v('2e appel refusé (verrou req)', await rembourserScan(r.req, 'aucun-prix'), false);
        v('   solde à 25, pas 26', (await solde(u)).gratuit, 25);
    }

    // ---------- J. Plafond anti-abus ----------
    console.log(`\n--- J. Plafond anti-abus (${REMBOURSEMENTS_MAX_JOUR}/jour) ---`);
    {
        const u = neuf('abus');
        let rembourses = 0;
        for (let i = 0; i < 8; i++) {
            const r = await appelerAcces(u);
            if (r.passe && await rembourserScan(r.req, 'ia-echec')) rembourses++;
        }
        v(`remboursements plafonnés à ${REMBOURSEMENTS_MAX_JOUR}`, rembourses, REMBOURSEMENTS_MAX_JOUR);
        const c = await Remboursement.findOne({ userId: u, jour: new Date().toISOString().slice(0, 10) }).lean();
        v('   compteur du jour non dérivé', c.count, REMBOURSEMENTS_MAX_JOUR);
        // Les 3 refusés ont bien COÛTÉ un scan : l'abus n'est pas gratuit.
        v('   les scans non remboursés restent débités', (await solde(u)).gratuit, SCANS_ACCUEIL - 3);
    }

    // ---------- K. Concurrence ----------
    console.log('\n--- K. Concurrence (8 scans simultanés sur 1 crédit) ---');
    {
        const u = neuf('concurrence');
        await poser(u, 1, 0);
        const res = await Promise.all(Array.from({ length: 8 }, () => appelerAcces(u)));
        v('un SEUL scan sur la poche accueil', res.filter(r => r.req.credit?.poche === 'accueil').length, 1);
        v('   solde accueil à 0, jamais négatif', (await solde(u)).gratuit, 0);
        v('   hebdo n\'a pas dépassé son plafond', await compteurHebdo(u), SCANS_GRATUITS_SEMAINE);
    }

    // ---------- L. Une QUESTION n'est pas facturée (décision du testeur, 2026-10-05) ----------
    // « Seule une identification AFFIRMÉE est facturée, quelle que soit sa preuve (image, titre ou Gemini). Une question ou une
    // panne est remboursée. » Une réponse livrée avec réserve (`carteAmbigue`) EST une question : signalerIncertain la rembourse,
    // quelle que soit REMBOURSER_SI_INCERTAIN (posée à 'false' en tête de fichier).
    console.log('\n--- L. Une question est remboursée ---');
    {
        const u = neuf('question-accueil');
        const r = await appelerAcces(u);
        v('débité accueil -> 24', (await solde(u)).gratuit, 24);
        v('une question est remboursée', await signalerIncertain(r.req, 'egalite-sans-enjeu'), true);
        v('   solde accueil restauré à 25', (await solde(u)).gratuit, 25);
    }
    {
        const u = neuf('question-payant');
        await poser(u, 0, 5);
        await appelerAcces(u); await appelerAcces(u);   // vide l'hebdo
        const r = await appelerAcces(u);
        v('débité payant -> 4', (await solde(u)).payant, 4);
        v('une lecture de secours (question) est remboursée', await signalerIncertain(r.req, 'lecture-de-secours'), true);
        v('   solde payant restauré à 5', (await solde(u)).payant, 5);
        v('   et jamais deux fois (verrou req)', await rembourserScan(r.req, 'ia-echec'), false);
    }
    {
        // 🔴 LES QUESTIONS NE MANGENT PAS LE PLAFOND DES PANNES (relecture du 2026-10-06 ; verrou-avant-push rouge en 7e cellule).
        // Un compteur partagé faisait passer le cas FRÉQUENT (une question, l'utilisateur a reçu des candidats) devant le cas GRAVE
        // (une panne, il n'a rien reçu) : au 6e remboursement du jour, la panne restait facturée.
        const u = neuf('question-puis-panne');
        let questions = 0;
        for (let i = 0; i < REMBOURSEMENTS_MAX_JOUR + 2; i++) {
            const r = await appelerAcces(u);
            if (r.passe && await signalerIncertain(r.req, 'perimetre-vintage-suggestion')) questions++;
        }
        v(`${REMBOURSEMENTS_MAX_JOUR + 2} questions dans la journée, toutes remboursées`, questions, REMBOURSEMENTS_MAX_JOUR + 2);
        const r = await appelerAcces(u);
        v('   puis une PANNE : remboursée quand même', await rembourserScan(r.req, 'ia-echec'), true);
    }
    {
        // Les questions ont leur PROPRE plafond (anti-abus : des photos ambiguës en boucle pour des candidats gratuits)
        // poche HEBDO : chaque question remboursée rend le jeton de la semaine, le scan suivant le reprend — aucune dotation à
        // dépasser (l'accueil plafonne ses remboursements à SCANS_ACCUEIL, il fausserait ce compte)
        const u = neuf('question-plafond');
        await poser(u, 0, 0);
        let rendues = 0;
        for (let i = 0; i < REMBOURSEMENTS_QUESTIONS_MAX_JOUR + 2; i++) {
            const r = await appelerAcces(u);
            if (r.passe && await signalerIncertain(r.req, 'perimetre-vintage-suggestion')) rendues++;
        }
        v(`questions remboursées plafonnées à ${REMBOURSEMENTS_QUESTIONS_MAX_JOUR}/jour`, rendues, REMBOURSEMENTS_QUESTIONS_MAX_JOUR);
    }

    // ---------- M. Une question RÉPONDUE est facturée une fois ; seule une question ABANDONNÉE est remboursée ----------
    // Décision du testeur (2026-10-05, seconde) : « une question remboursée ne doit pas devenir un résultat gratuit. Quand
    // l'utilisateur répond à la question, l'analyse est complète et facturée UNE fois. Seule une question abandonnée est
    // remboursée. » Abandonnée = sans réponse 24 h, ou « aucune de celles-ci ». Plafond : 30 questions remboursées par jour.
    console.log('\n--- M. Question en attente, répondue, abandonnée ---');
    const acces = require('./acces');
    const { Question, poserQuestion, repondreQuestion, rembourserQuestionsAbandonnees, QUESTION_DELAI_MS } = acces;
    v('le module expose le circuit des questions', [typeof poserQuestion, typeof repondreQuestion, typeof rembourserQuestionsAbandonnees, QUESTION_DELAI_MS], ['function', 'function', 'function', 24 * 3600 * 1000]);
    const oid = () => new mongoose.Types.ObjectId();
    const vieillir = async (scanId, heures) => Question.updateOne({ _id: scanId }, { $set: { poseeLe: new Date(Date.now() - heures * 3600 * 1000) } });
    const etatDe = async scanId => (await Question.findById(scanId).lean())?.etat ?? null;
    {
        const u = neuf('q-repondue');
        const r = await appelerAcces(u);
        const scanId = oid();
        const q = await poserQuestion(r.req, { scanId, raison: 'tcgdex-ambigu', candidats: [101, 102, 103] });
        v('une question posée reste EN ATTENTE, rien n\'est rendu', [q.etat, (await solde(u)).gratuit], ['en-attente', 24]);
        v('   la poche débitée est retenue', (await Question.findById(scanId).lean())?.credit?.poche, 'accueil');
        v('réponse par un autre utilisateur : 403', (await repondreQuestion({ scanId, userId: 'TEST-autre', idProduct: 101 })).statut, 403);
        v('réponse hors des candidats : 400', (await repondreQuestion({ scanId, userId: u, idProduct: 999 })).statut, 400);
        const rep = await repondreQuestion({ scanId, userId: u, idProduct: 102 });
        v('réponse par un candidat : 200, « répondue », facturée UNE fois', [rep.statut, rep.etat, (await solde(u)).gratuit], [200, 'repondue', 24]);
        v('   une seconde réponse : 409, rien ne bouge', [(await repondreQuestion({ scanId, userId: u, idProduct: 101 })).statut, (await solde(u)).gratuit], [409, 24]);
        await vieillir(scanId, 25);
        await rembourserQuestionsAbandonnees();
        v('   le balayage ne rembourse pas une question répondue', [await etatDe(scanId), (await solde(u)).gratuit], ['repondue', 24]);
        v('scanId inconnu : 404', (await repondreQuestion({ scanId: oid(), userId: u, idProduct: 101 })).statut, 404);
    }
    {
        const u = neuf('q-aucune');
        await poser(u, 0, 5);
        await appelerAcces(u); await appelerAcces(u);   // vide l'hebdo
        const r = await appelerAcces(u);
        const scanId = oid();
        await poserQuestion(r.req, { scanId, raison: 'perimetre-vintage-suggestion', candidats: [201, 202] });
        v('débité payant -> 4, question en attente', [(await solde(u)).payant, await etatDe(scanId)], [4, 'en-attente']);
        const rep = await repondreQuestion({ scanId, userId: u, aucune: true });
        v('« aucune de celles-ci » : abandon, remboursé tout de suite', [rep.statut, rep.etat, (await solde(u)).payant], [200, 'remboursee', 5]);
    }
    {
        const u = neuf('q-abandon');
        const r1 = await appelerAcces(u), r2 = await appelerAcces(u);
        const vieille = oid(), recente = oid();
        await poserQuestion(r1.req, { scanId: vieille, raison: 'tcgdex-ambigu', candidats: [301, 302] });
        await poserQuestion(r2.req, { scanId: recente, raison: 'tcgdex-ambigu', candidats: [301, 302] });
        await vieillir(vieille, 25);
        await vieillir(recente, 1);
        v('deux questions en attente -> accueil 23', (await solde(u)).gratuit, 23);
        const vus = [];
        await rembourserQuestionsAbandonnees({ apres: q => vus.push(String(q._id)) });
        v('le balayage rembourse la question de plus de 24 h, et elle seule', [await etatDe(vieille), await etatDe(recente), (await solde(u)).gratuit], ['remboursee', 'en-attente', 24]);
        v('   et rappelle `apres` pour elle (le journal)', vus.includes(String(vieille)) && !vus.includes(String(recente)), true);
        await rembourserQuestionsAbandonnees();
        v('   un second balayage ne rend rien de plus', (await solde(u)).gratuit, 24);
        v('répondre à une question abandonnée (remboursée) : 409', (await repondreQuestion({ scanId: vieille, userId: u, idProduct: 301 })).statut, 409);
        await vieillir(recente, 25);
        const tardive = await repondreQuestion({ scanId: recente, userId: u, idProduct: 301 });
        await rembourserQuestionsAbandonnees();
        v('répondre APRÈS 24 h, avant le balayage : 410, et le balayage la rembourse', [tardive.statut, await etatDe(recente), (await solde(u)).gratuit], [410, 'remboursee', 25]);
    }
    {
        // une PANNE dans la même requête, après la question (l'exception avant la réponse) : la panne rembourse et ANNULE la
        // question — sinon le balayage rendrait un second crédit 24 h plus tard
        // poche PAYANTE : sans plafond de dotation, c'est la seule où un second remboursement se VERRAIT (relecture du 2026-10-05 :
        // sur l'accueil, borné à 25, le test passait même sans annulation)
        const u = neuf('q-panne');
        await poser(u, 0, 5);
        await appelerAcces(u); await appelerAcces(u);   // vide l'hebdo
        const r = await appelerAcces(u);
        const scanId = oid();
        await poserQuestion(r.req, { scanId, raison: 'tcgdex-ambigu', candidats: [401, 402] });
        v('une panne après la question : remboursée (payant 4 -> 5)', [await rembourserScan(r.req, 'erreur-serveur'), (await solde(u)).payant], [true, 5]);
        await vieillir(scanId, 25);
        await rembourserQuestionsAbandonnees();
        v('   la question est annulée, jamais remboursée deux fois (payant reste 5)', [await etatDe(scanId), (await solde(u)).payant], ['annulee', 5]);
    }
    {
        // « aucune » puis le balayage : un seul crédit rendu (poche payante, pour qu'un double se voie)
        const u = neuf('q-aucune-balayage');
        await poser(u, 0, 5);
        await appelerAcces(u); await appelerAcces(u);
        const r = await appelerAcces(u);
        const scanId = oid();
        await poserQuestion(r.req, { scanId, raison: 'tcgdex-ambigu', candidats: [451, 452] });
        await repondreQuestion({ scanId, userId: u, aucune: true });
        await vieillir(scanId, 25);
        await rembourserQuestionsAbandonnees();
        v('« aucune » puis le balayage : payant 5, une seule fois', [await etatDe(scanId), (await solde(u)).payant], ['remboursee', 5]);
    }
    {
        // deux réponses SIMULTANÉES : une seule est prise
        const u = neuf('q-concurrence');
        const r = await appelerAcces(u);
        const scanId = oid();
        await poserQuestion(r.req, { scanId, raison: 'tcgdex-ambigu', candidats: [461, 462] });
        const rs = await Promise.all([repondreQuestion({ scanId, userId: u, idProduct: 461 }), repondreQuestion({ scanId, userId: u, idProduct: 462 }), repondreQuestion({ scanId, userId: u, aucune: true })]);
        v('trois réponses simultanées : une seule passe, les autres 409', rs.map(x => x.statut).sort(), [200, 409, 409]);
        v('   et le crédit n\'est rendu que si c\'est « aucune » qui a gagné', (await solde(u)).gratuit, (await etatDe(scanId)) === 'remboursee' ? 25 : 24);
    }
    {
        // une question restée « en-reglement » (processus tué entre la prise et l'état final) : JAMAIS reprise seule, mais comptée
        const u = neuf('q-bloquee');
        const r = await appelerAcces(u);
        const scanId = oid();
        await poserQuestion(r.req, { scanId, raison: 'tcgdex-ambigu', candidats: [471, 472] });
        await Question.updateOne({ _id: scanId }, { $set: { etat: 'en-reglement', priseLe: new Date(Date.now() - 3600 * 1000), poseeLe: new Date(Date.now() - 26 * 3600 * 1000) } });
        const bal = await rembourserQuestionsAbandonnees();
        v('une question bloquée « en-reglement » : comptée, jamais reprise (accueil reste 24)', [bal.bloquees >= 1, await etatDe(scanId), (await solde(u)).gratuit], [true, 'en-reglement', 24]);
    }
    {
        // sans identifiant de scan (le journal n'écrit pas : Mongo absent), la question ne peut pas attendre : remboursée tout de suite
        const u = neuf('q-sans-scan');
        const r = await appelerAcces(u);
        const q = await poserQuestion(r.req, { scanId: null, raison: 'tcgdex-ambigu', candidats: [501, 502] });
        v('sans scanId : remboursée tout de suite (repli)', [q.etat, (await solde(u)).gratuit], ['remboursee', 25]);
    }
    {
        // le plafond des questions (30/jour) vaut aussi pour le balayage : au-delà, la question reste facturée et la cause s'écrit
        const u = neuf('q-plafond');
        const r = await appelerAcces(u);
        const scanId = oid();
        await poserQuestion(r.req, { scanId, raison: 'tcgdex-ambigu', candidats: [601, 602] });
        await vieillir(scanId, 25);
        // le plafond compte au jour où la question a été POSÉE (« 30 questions par jour »), pas au jour du balayage
        const jourPose = (await Question.findById(scanId).lean()).poseeLe.toISOString().slice(0, 10);
        await RemboursementQuestion.updateOne({ userId: u, jour: jourPose }, { $set: { count: REMBOURSEMENTS_QUESTIONS_MAX_JOUR } }, { upsert: true });
        await rembourserQuestionsAbandonnees();
        const q = await Question.findById(scanId).lean();
        v('plafond du jour de POSE atteint : non remboursée, cause écrite', [q.etat, q.raisonNonRembourse, (await solde(u)).gratuit], ['non-remboursee', 'plafond-jour', 24]);
    }
    {
        const req = { body: { userId: 'peu-importe' } };   // code maître : aucun débit
        v('code maître : aucune question à régler', (await poserQuestion(req, { scanId: oid(), raison: 'x', candidats: [1, 2] })).etat, null);
    }

    // ---------- Nettoyage ----------
    console.log('\n--- Nettoyage ---');
    const f = { userId: { $in: ids } };
    const d1 = await Credit.deleteMany(f), d2 = await QuotaSemaine.deleteMany(f), d3 = await Remboursement.deleteMany(f);
    const d4 = RemboursementQuestion ? await RemboursementQuestion.deleteMany(f) : { deletedCount: 0 };
    const d5 = Question ? await Question.deleteMany({ userId: { $in: [...ids, 'peu-importe'] } }) : { deletedCount: 0 };
    console.log(`   supprimés : ${d1.deletedCount} credits, ${d2.deletedCount} quotas, ${d3.deletedCount} remboursements, ${d4.deletedCount} remboursements de questions, ${d5.deletedCount} questions`);
    v('aucun document de test résiduel', await Credit.countDocuments({ userId: /^TEST-/ }), 0);
    // `drop` des collections de tous les modèles chargés (FUITE-MAIN, 2026-10-08) : le deleteMany ci-dessus laissait credits, quotas_semaine,
    // remboursements, remboursements_questions, questions (fichier + index) sur la grappe de production ; mongoose les recrée à la connexion suivante
    await viderBac(mongoose.connection.db, { noms: nomsDesModeles(mongoose) });

    console.log(`\n${ko === 0 ? '🎉' : '⚠️'} ${ok}/${ok + ko} assertions passées.`);
    await mongoose.disconnect();
    process.exit(ko === 0 ? 0 : 1);
}

main().catch(async e => {
    console.error('❌ Erreur :', e);
    try { await mongoose.disconnect(); } catch (_) { }
    process.exit(1);
});
