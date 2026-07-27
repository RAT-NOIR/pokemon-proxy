// ============================================================
// MODULE ACCÈS — décompte et remboursement d'un scan
// ============================================================
// Tout le CHEMIN ARGENT vit ici : les deux bourses de scans, l'allocation hebdo, le
// décompte atomique, et le remboursement quand une requête n'a rien pu livrer.
//
// POURQUOI UN MODULE : ce code doit être exécuté À L'IDENTIQUE par le serveur et par
// ses tests. Tant qu'un test en recopiait la logique, la copie divergeait du vrai code
// sans que rien ne le signale — et le test restait vert sur du code qui n'était plus en
// production. Ici il n'existe qu'UNE implémentation ; test-acces.js l'importe.
//
// Ce module ne connaît ni Express ni les routes : il n'expose que des middlewares et
// des fonctions. Il n'ouvre PAS la connexion Mongo — il utilise celle que l'appelant a
// établie, ce qui permet au test de pointer une base `test_scratch` sans rien changer.

const mongoose = require('mongoose');

// --- Accès aux scans : crédits d'accueil, allocation hebdo, crédits achetés ---
// SCANS_ACCUEIL         : scans offerts UNE SEULE FOIS à la création du compte (sans expiration).
// SCANS_GRATUITS_SEMAINE: allocation hebdomadaire, NON cumulable (repart à zéro chaque semaine ISO).
// CODE_ILLIMITE : code maître secret (variable d'env sur Render). Une requête qui le
// présente n'est PAS limitée et ne décrémente RIEN — c'est ainsi que l'admin se débride,
// sans jamais mettre le code dans l'extension distribuée. Chaque install envoie un userId anonyme.
const SCANS_ACCUEIL = parseInt(process.env.SCANS_ACCUEIL || '25', 10);
const SCANS_GRATUITS_SEMAINE = parseInt(process.env.SCANS_GRATUITS_SEMAINE || '2', 10);
const CODE_ILLIMITE = process.env.CODE_ILLIMITE || null;

// --- Remboursement d'un scan quand RIEN n'a été livré ---
// Plafond anti-abus, par utilisateur et par jour. 5 = large pour un usage honnête
// (les échecs durs sont rares) et serré face à un script qui enverrait des photos
// illisibles en boucle : au-delà, on log et on ne rembourse plus, mais le scan reste
// débité, donc l'attaque coûte des crédits à celui qui la mène.
const REMBOURSEMENTS_MAX_JOUR = parseInt(process.env.REMBOURSEMENTS_MAX_JOUR || '5', 10);
// Politique élargissable SANS redéploiement de code : rembourser aussi les résultats
// livrés « avec réserve ». Défaut FALSE, et volontairement : un résultat incertain
// reste un résultat, et rembourser dessus offrirait des scans gratuits illimités à qui
// envoie des photos volontairement illisibles — chacune brûlant un appel IA payant.
// Le log [scan-incertain] sert précisément à mesurer le taux réel avant d'y toucher.
const REMBOURSER_SI_INCERTAIN = String(process.env.REMBOURSER_SI_INCERTAIN || 'false').toLowerCase() === 'true';

// ============================================================
// MODÈLES
// ============================================================

// Compte d'un utilisateur : ses deux bourses de scans. Créé au 1er scan par upsert.
// soldeGratuit et soldeScans sont volontairement SÉPARÉS : on doit pouvoir consommer
// l'offert en priorité, et un remboursement ne doit toucher que l'acheté.
const creditSchema = new mongoose.Schema({
    userId:       { type: String, required: true, unique: true },
    soldeGratuit: { type: Number, default: 0 },   // scans d'accueil, one-shot, sans expiration
    soldeScans:   { type: Number, default: 0 },   // scans ACHETÉS (crédités par le webhook Stripe)
    email:        { type: String, default: null } // renseigné par Stripe à l'achat, jamais par le client
});
// default: 0 (et non SCANS_ACCUEIL) : la dotation d'accueil est posée explicitement par
// le $setOnInsert de verifierAcces. Un default à SCANS_ACCUEIL créerait un SECOND chemin
// d'attribution — toute écriture Mongoose créant le doc offrirait 25 scans en silence.
const Credit = mongoose.models.Credit || mongoose.model('Credit', creditSchema, 'credits');

// Compteur de scans par utilisateur et par semaine ISO (allocation gratuite hebdo).
// Même forme que l'ancien quota quotidien, mais la clé porte la semaine : changer de
// semaine crée un nouveau document, donc le reset est implicite et sans race condition.
const quotaSemaineSchema = new mongoose.Schema({
    userId:  { type: String, required: true },
    semaine: { type: String, required: true },   // AAAA-Www (ISO 8601)
    count:   { type: Number, default: 0 }
});
quotaSemaineSchema.index({ userId: 1, semaine: 1 }, { unique: true });
const QuotaSemaine = mongoose.models.QuotaSemaine || mongoose.model('QuotaSemaine', quotaSemaineSchema, 'quotas_semaine');

// Compteur de remboursements par utilisateur et par JOUR (UTC). Même forme et même
// mécanique que QuotaSemaine : la clé porte la date, donc le reset est implicite et
// sans course. Sert uniquement de plafond anti-abus.
const remboursementSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    jour:   { type: String, required: true },   // AAAA-MM-JJ (UTC)
    count:  { type: Number, default: 0 }
});
remboursementSchema.index({ userId: 1, jour: 1 }, { unique: true });
const Remboursement = mongoose.models.Remboursement || mongoose.model('Remboursement', remboursementSchema, 'remboursements');

// ============================================================
// OUTILS
// ============================================================

// Semaine ISO 8601 au format 'AAAA-Www' (la semaine commence le lundi, et la semaine 1
// est celle qui contient le premier jeudi de l'année). Sert de clé de reset hebdo : une
// nouvelle semaine = une nouvelle clé = un nouveau document, donc plus rien à remettre
// à zéro (pas de "lire puis reset", donc pas de course entre deux scans simultanés).
function semaineISO(date = new Date()) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    // Jeudi de la semaine courante : c'est lui qui détermine l'année ISO.
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const debutAnnee = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const numero = Math.ceil((((d - debutAnnee) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(numero).padStart(2, '0')}`;
}

// Garde-fou EN AMONT du décompte : une requête sans image ne peut rien produire, elle
// ne doit donc rien coûter. Placé AVANT verifierAcces dans la chaîne de middlewares —
// ne rien débiter vaut toujours mieux que débiter puis rembourser.
// Le corps de réponse est identique à celui que les routes renvoyaient déjà pour ce
// cas (200 + {success:false,error}) : l'extension déployée n'y voit aucun changement.
function exigerImage(req, res, next) {
    const { imageUrl, imageUrls } = req.body || {};
    const photos = (Array.isArray(imageUrls) ? imageUrls : []).concat(imageUrl ? [imageUrl] : []).filter(Boolean);
    if (photos.length === 0) {
        console.warn("⚠️ Requête sans image -> refusée AVANT tout décompte de scan.");
        return res.json({ success: false, error: "Aucune image reçue" });
    }
    return next();
}

// Ordre de consommation d'un scan :
//   0) code maître        -> passe, ne décrémente rien
//   1) crédits d'accueil  -> décrément atomique conditionnel
//   2) allocation hebdo   -> incrément + rollback si dépassement
//   3) crédits ACHETÉS    -> décrément atomique conditionnel
//   4) sinon              -> 429
// Les gratuits passent AVANT le payant : on ne consomme jamais du crédit acheté tant
// qu'il reste de l'offert (sinon on facture l'utilisateur pour un scan qui lui était dû).
async function verifierAcces(req, res, next) {
    // 0) Code maître -> illimité (l'admin), aucun décrément, aucun accès base.
    if (CODE_ILLIMITE && req.body && req.body.codeIllimite === CODE_ILLIMITE) return next();

    // 1) userId obligatoire, vérifié AVANT tout accès Mongo. Sans identifiant on ne
    // peut rien décompter : laisser passer offrirait des scans illimités à qui
    // omettrait simplement le champ.
    const userId = req.body && req.body.userId ? String(req.body.userId).slice(0, 80) : null;
    if (!userId) {
        return res.status(400).json({ success: false, error: "Identifiant utilisateur manquant" });
    }

    // 2) Base indisponible -> 503, fail-CLOSED (et non fail-open comme l'ancien quota).
    // L'identification a besoin de Mongo (catalogue, mapping, guide de prix) : sans base,
    // trouverProduitsLocaux renvoie [] et la route répondrait un classement VIDE... après
    // avoir payé l'appel IA. Couper ici évite de brûler des crédits OpenRouter pour une
    // réponse inexploitable, et rend une erreur honnête au client.
    if (mongoose.connection.readyState !== 1) {
        console.warn("🚫 [acces] Mongo indisponible -> 503 (scan refusé avant l'appel IA)");
        return res.status(503).json({ success: false, error: "Service momentanément indisponible, réessaie dans un instant." });
    }

    try {
        // 3) Création du compte au premier scan. $setOnInsert : c'est l'UNIQUE endroit
        // où la dotation d'accueil est posée — jamais réattribuée sur un doc existant.
        try {
            await Credit.updateOne(
                { userId },
                { $setOnInsert: { userId, soldeGratuit: SCANS_ACCUEIL, soldeScans: 0, email: null } },
                { upsert: true }
            );
        } catch (e) {
            // 11000 = deux scans simultanés d'un compte tout neuf ont tenté de le créer
            // en même temps ; l'autre a gagné, le doc existe, on continue.
            if (e.code !== 11000) throw e;
        }

        // 4) Crédits d'accueil. Décrément ATOMIQUE conditionnel : le filtre soldeGratuit > 0
        // et le $inc sont évalués dans la même opération Mongo, donc deux scans simultanés
        // ne peuvent pas consommer le même crédit.
        const accueil = await Credit.findOneAndUpdate(
            { userId, soldeGratuit: { $gt: 0 } },
            { $inc: { soldeGratuit: -1 } },
            { new: true }
        );
        // req.credit = la POCHE réellement débitée. C'est la seule information dont
        // rembourserScan a besoin pour annuler ce débit précis. Le décompte lui-même ne
        // bouge pas d'un pouce : il reste atomique et EN AMONT de tout traitement — le
        // déplacer après l'identification rouvrirait la course concurrente (N scans
        // simultanés sur 1 crédit) et un crash après l'appel OpenRouter donnerait un
        // scan gratuit ET brûlé. On rembourse après coup, on ne déplace rien.
        if (accueil) { req.credit = { userId, poche: 'accueil' }; return next(); }

        // 5) Allocation hebdomadaire. Incrément atomique puis vérification, avec
        // rollback si dépassement (même mécanique que l'ancien quota quotidien).
        if (SCANS_GRATUITS_SEMAINE > 0) {
            const semaine = semaineISO();
            const doc = await QuotaSemaine.findOneAndUpdate(
                { userId, semaine },
                { $inc: { count: 1 } },
                { upsert: true, new: true }
            );
            // La semaine ISO est mémorisée : un remboursement hebdo n'est légitime que
            // DANS LA MÊME semaine (sinon il offrirait un scan supplémentaire sur la
            // semaine suivante, exactement la cumulation que le test 30/30 interdit).
            if (doc.count <= SCANS_GRATUITS_SEMAINE) { req.credit = { userId, poche: 'hebdo', semaineIso: semaine }; return next(); }
            // Dépassement : on rend le jeton pris, sinon le compteur dériverait à chaque
            // tentative refusée et fausserait le "restantSemaine" renvoyé par /api/solde.
            await QuotaSemaine.updateOne({ userId, semaine }, { $inc: { count: -1 } });
        }

        // 6) Crédits ACHETÉS. Même décrément atomique conditionnel : c'est ce qui
        // empêche le double-décompte (donc la perte d'argent client) sur scans parallèles.
        const paye = await Credit.findOneAndUpdate(
            { userId, soldeScans: { $gt: 0 } },
            { $inc: { soldeScans: -1 } },
            { new: true }
        );
        if (paye) { req.credit = { userId, poche: 'payant' }; return next(); }

        // 7) Plus rien nulle part.
        return res.status(429).json({
            success: false,
            quotaAtteint: true,          // conservé : c'est ce que lit l'extension déjà déployée
            erreur: 'quota_epuise',
            error: `Tes scans gratuits sont épuisés (${SCANS_GRATUITS_SEMAINE}/semaine). Recharge pour continuer 🐀`
        });
    } catch (e) {
        // Fail-CLOSED aussi sur erreur inattendue : on ne sait pas si le décompte a eu
        // lieu, donc on ne laisse surtout pas passer un scan non métré vers l'IA payante.
        console.error("❌ [acces]", e.message);
        return res.status(503).json({ success: false, error: "Service momentanément indisponible, réessaie dans un instant." });
    }
}

/**
 * Rembourse le scan débité par verifierAcces, quand la requête n'a RIEN pu livrer.
 * ROLLBACK, pas déplacement du décompte : le débit reste atomique et en amont.
 *
 * @param {object} req     porte req.credit (la poche débitée), posé par verifierAcces
 * @param {string} motif   cause courte et stable, pour le log ('ia-echec', 'aucun-prix'...)
 * @returns {Promise<boolean>} true si un crédit a réellement été rendu
 *
 * Appelé AU PLUS UNE FOIS par requête (verrou `req.scanRembourse`). Un remboursement
 * ne doit jamais rendre plus que ce qui a été pris — d'où un plafond par poche :
 *   - payant  : +1 sans plafond (c'est de l'argent, il est dû)
 *   - accueil : +1 mais JAMAIS au-dessus de la dotation initiale (filtre $lt atomique)
 *   - hebdo   : décrément du compteur, uniquement DANS LA MÊME semaine ISO et sans
 *               passer sous zéro. Hors de la semaine d'origine on ne rembourse pas :
 *               ça offrirait un scan de plus sur la semaine suivante, c'est-à-dire la
 *               cumulation « W29 épuisée -> W30 = 3 » que le test 30/30 interdit.
 */
async function rembourserScan(req, motif) {
    const credit = req && req.credit;
    if (!credit) return false;              // code maître, ou aucun débit à annuler
    if (req.scanRembourse) return false;    // au plus un remboursement par requête
    req.scanRembourse = true;

    if (mongoose.connection.readyState !== 1) {
        console.error(`❌ [scan-rembourse] impossible (Mongo indisponible) userId=${credit.userId} poche=${credit.poche} motif=${motif}`);
        return false;
    }

    const { userId, poche } = credit;
    const jour = new Date().toISOString().slice(0, 10);
    let plafondPris = false;
    try {
        // Plafond anti-abus : incrément atomique PUIS vérification, avec rollback en cas
        // de dépassement (même mécanique que le quota hebdo, donc pas de course).
        const compteur = await Remboursement.findOneAndUpdate(
            { userId, jour }, { $inc: { count: 1 } }, { upsert: true, new: true }
        );
        plafondPris = true;
        if (compteur.count > REMBOURSEMENTS_MAX_JOUR) {
            await Remboursement.updateOne({ userId, jour }, { $inc: { count: -1 } });
            console.warn(`🚫 [remboursement-plafond] userId=${userId} poche=${poche} motif=${motif} plafond=${REMBOURSEMENTS_MAX_JOUR} -> scan NON rembourse`);
            return false;
        }

        let rendu = false;
        if (poche === 'payant') {
            const r = await Credit.updateOne({ userId }, { $inc: { soldeScans: 1 } });
            rendu = (r.modifiedCount ?? r.nModified ?? 0) > 0;
        } else if (poche === 'accueil') {
            // Le filtre porte le plafond : impossible de dépasser la dotation initiale,
            // même si deux remboursements se croisaient.
            const r = await Credit.updateOne(
                { userId, soldeGratuit: { $lt: SCANS_ACCUEIL } }, { $inc: { soldeGratuit: 1 } }
            );
            rendu = (r.modifiedCount ?? r.nModified ?? 0) > 0;
            if (!rendu) console.warn(`ℹ️ [scan-rembourse] userId=${userId} poche=accueil deja au plafond (${SCANS_ACCUEIL}) -> rien a rendre`);
        } else if (poche === 'hebdo') {
            if (semaineISO() !== credit.semaineIso) {
                console.warn(`ℹ️ [scan-rembourse] userId=${userId} poche=hebdo semaine changee (${credit.semaineIso} -> ${semaineISO()}) -> NON rembourse`);
            } else {
                const r = await QuotaSemaine.updateOne(
                    { userId, semaine: credit.semaineIso, count: { $gt: 0 } }, { $inc: { count: -1 } }
                );
                rendu = (r.modifiedCount ?? r.nModified ?? 0) > 0;
            }
        }

        if (!rendu) {
            // Rien n'a été rendu : on libère le jeton du plafond, sinon un non-
            // remboursement consommerait quand même le quota de remboursements.
            await Remboursement.updateOne({ userId, jour }, { $inc: { count: -1 } });
            return false;
        }
        console.log(`💸 [scan-rembourse] userId=${userId} poche=${poche} motif=${motif}`);
        return true;
    } catch (e) {
        if (plafondPris) { try { await Remboursement.updateOne({ userId, jour }, { $inc: { count: -1 } }); } catch (_) { } }
        console.error(`❌ [scan-rembourse] echec userId=${userId} poche=${poche} motif=${motif} : ${e.message}`);
        return false;
    }
}

// Trace des résultats livrés AVEC RÉSERVE. Ne rembourse rien par défaut : sert à
// mesurer le taux réel de carteIncertaine avant de décider d'élargir la politique
// (voir REMBOURSER_SI_INCERTAIN).
async function signalerIncertain(req, raison) {
    const userId = (req.credit && req.credit.userId) || (req.body && req.body.userId) || '?';
    console.warn(`⚠️ [scan-incertain] userId=${userId} raison=${raison}`);
    if (REMBOURSER_SI_INCERTAIN) await rembourserScan(req, `incertain:${raison}`);
}

module.exports = {
    // Modèles — index.js les réutilise pour /api/solde et le webhook Stripe
    Credit, QuotaSemaine, Remboursement,
    // Middlewares et fonctions
    exigerImage, verifierAcces, rembourserScan, signalerIncertain,
    // Outils et constantes
    semaineISO,
    SCANS_ACCUEIL, SCANS_GRATUITS_SEMAINE, REMBOURSEMENTS_MAX_JOUR, REMBOURSER_SI_INCERTAIN
};
