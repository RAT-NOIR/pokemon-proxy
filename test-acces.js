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
process.env.REMBOURSER_SI_INCERTAIN = 'false';
delete process.env.CODE_ILLIMITE;

require('dotenv').config();
const mongoose = require('mongoose');
mongoose.set('strictQuery', false);

const { connecterMongo } = require('./mongo-connexion');
const {
    Credit, QuotaSemaine, Remboursement,
    exigerImage, verifierAcces, rembourserScan,
    semaineISO, SCANS_ACCUEIL, SCANS_GRATUITS_SEMAINE, REMBOURSEMENTS_MAX_JOUR
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

    // ---------- Nettoyage ----------
    console.log('\n--- Nettoyage ---');
    const f = { userId: { $in: ids } };
    const d1 = await Credit.deleteMany(f), d2 = await QuotaSemaine.deleteMany(f), d3 = await Remboursement.deleteMany(f);
    console.log(`   supprimés : ${d1.deletedCount} credits, ${d2.deletedCount} quotas, ${d3.deletedCount} remboursements`);
    v('aucun document de test résiduel', await Credit.countDocuments({ userId: /^TEST-/ }), 0);

    console.log(`\n${ko === 0 ? '🎉' : '⚠️'} ${ok}/${ok + ko} assertions passées.`);
    await mongoose.disconnect();
    process.exit(ko === 0 ? 0 : 1);
}

main().catch(async e => {
    console.error('❌ Erreur :', e);
    try { await mongoose.disconnect(); } catch (_) { }
    process.exit(1);
});
