'use strict';
// B6.4 — l'effacement du banc réel : par jeton (la promesse publique « sous 30 jours » est tenue tout de suite), la purge à 24 mois, et le filet des orphelins.
// LA PURGE EST LE SEUL EFFACEUR (v2/modeles.js n'a plus de TTL sur banc_lignes) : toujours les OBJETS d'abord, les LIGNES ensuite. Un objet dont la suppression
// échoue GARDE sa ligne (on ne perd jamais la trace d'un objet qui existe encore) ; une ligne dont la suppression échoue après son objet sera reprise (R2 supprime
// sans erreur ce qui n'existe plus).
// Ce module n'a pas besoin du sel V2_BANC_SEL : effacer n'est jamais conserver, et le droit d'effacement ne dépend pas de la bonne marche de l'écriture.
// Le stockage est celui de V2_BANC_BUCKET après `verifierBucket()` (endpoint UE) ; un échec n'est PAS mémorisé (une panne passagère ne doit pas fermer
// l'effacement pour la durée du processus) — chaque appel retente.
// CLI : node v2/banc/purge.js --base=test_scratch   (refuse --base=test sans --confirmer-production ; aucun banc ne le lance contre une base réelle).
const crypto = require('crypto');
const db = require('../db');
const S = require('./stockage');
const { FORME_JETON } = require('./consentement');
const { codeDe, creerBorner, lignesEchues, supprimerObjetPuisLigne } = require('./commun');
const { creerAnonymisation } = require('./anonymisation');

const ORPHELIN_MS = 48 * 3600e3, DELAI_MS = 10000;

function creerPurge({ cfg, env = process.env, stockage = null, colFn = n => db.col(n), horloge = () => new Date(), delaiMs = DELAI_MS, parPasseMax } = {}) {
    const col = () => colFn('banc_lignes');
    let pretS = null, dit = false;
    // Le journal ne porte JAMAIS de contenu : le code de l'erreur, pas son message (il peut citer une clé ou une URL).
    const echec = (quoi, e) => console.error(`❌ [v2 banc-purge] ${quoi} (${codeDe(e)})`);
    const dire = raison => { if (!dit) { dit = true; console.error(`⚠️ [v2 banc-purge] stockage indisponible : ${raison}`); } };
    const borner = creerBorner(delaiMs);

    async function pret() {
        if (pretS) return pretS;
        if (typeof env.V2_BANC_BUCKET !== 'string' || !env.V2_BANC_BUCKET) { dire('V2_BANC_BUCKET absente'); return null; }
        try {
            const s = stockage || S.creerStockageReel(env);
            if (!s || typeof s.verifierBucket !== 'function') throw new Error('verifierBucket absent');
            await borner(s.verifierBucket());
            pretS = s;
            return s;
        } catch (e) { dire(`bucket ou endpoint non vérifié (${codeDe(e)})`); return null; }
    }

    const anonymisation = creerAnonymisation({ cfg, colFn, borner, ...(parPasseMax ? { parPasseMax } : {}) });

    return {
        /**
         * BANC-12 — la passe d'anonymisation à bancLienMois (12 mois) : voir anonymisation.js. Sans stockage prêt, les lignes ne peuvent pas être re-clefées (comptées en échec, gardées),
         * mais les mouvements, questions et analyses sont traités quand même : le lien ne doit pas survivre à une panne de R2. Ne lève pas pour R2.
         */
        async anonymiserLiens(maintenant = horloge()) { return anonymisation.anonymiser(await pret(), new Date(maintenant)); },

        /** DELETE /api/banc/contributions : TOUTES les lignes du jeton et leurs objets. La forme du jeton est vérifiée ici aussi (jamais une requête avec autre chose). */
        async effacerParJeton(jeton) {
            if (typeof jeton !== 'string' || !FORME_JETON.test(jeton)) throw Object.assign(new Error('jeton invalide'), { code: 'ENTREE' });
            const jetonEmpreinte = crypto.createHash('sha256').update(jeton).digest('hex');
            const lignes = await borner(col().find({ jetonEmpreinte }).toArray());
            const bilan = { supprimees: 0, echecs: 0 };
            if (!lignes.length) return bilan;                                           // jeton inconnu : 0, sans toucher au stockage
            const s = await pret();
            if (!s) { bilan.echecs = lignes.length; return bilan; }                     // on ne peut pas effacer les objets : toutes les lignes sont gardées
            // une ligne devenue autre entre la lecture et la suppression ('changee') n'est pas effacée : elle reste une ligne de ce jeton, l'effacement le DIT (echecs)
            for (const l of lignes) {
                // BANC-12 (tour 1, I-4) : une ligne PRISE par l'anonymisation (coupure entre la copie et la suppression de l'ancienne) porte l'identifiant et la clé de sa COPIE anonyme : la copie part
                // D'ABORD (objet puis ligne) ; si elle ne part pas, l'ancienne ligne reste pour une nouvelle tentative et la réponse ne la compte PAS comme supprimée.
                if (l.anonId || l.anonCle) {
                    try {
                        if (l.anonCle) await borner(s.supprimer(l.anonCle));
                        if (l.anonId) await borner(col().deleteOne({ _id: l.anonId, anonyme: true }));
                    } catch (e) { echec('copie anonyme non effacée, ligne gardée pour une nouvelle tentative', e); bilan.echecs++; continue; }
                }
                if (await supprimerObjetPuisLigne(s, l, col, borner) === 'supprimee') bilan.supprimees++; else bilan.echecs++;
            }
            return bilan;
        },

        /** La purge quotidienne : `expireLe <= maintenant` (24 mois) et les lignes en attente de plus de 24 h ; puis le filet des orphelins. Ne lève pas pour R2. */
        async purgerBanc(maintenant = horloge()) {
            const bilan = { lignes: 0, objets: 0, echecs: 0, orphelins: 0, echecsOrphelins: 0 };
            const s = await pret();
            if (!s) return bilan;
            const now = new Date(maintenant);
            let echues = [];
            try { echues = await lignesEchues(col, now, borner); }                       // la définition PARTAGÉE de « échue »
            catch (e) { echec('lecture des lignes échues', e); bilan.echecs++; }
            for (const l of echues) {
                const r = await supprimerObjetPuisLigne(s, l, col, borner);
                if (r === 'supprimee') { bilan.lignes++; bilan.objets++; } else if (r === 'echec') bilan.echecs++;     // 'changee' : confirmée entre-temps, laissée telle quelle
            }

            // LE FILET : un objet du préfixe du banc qu'AUCUNE ligne ne référence et dont la date a plus de 48 h (une écriture en cours n'a pas encore sa ligne : les 48 h la
            // protègent). Jamais un objet référencé ; jamais hors du préfixe ni d'une forme de clé du banc (le stockage ne rend que celles-là) ; si l'on ne sait pas
            // si une ligne le référence (Mongo en échec), on ne supprime pas.
            let objets;
            try { objets = await borner(s.lister()); }
            catch (e) { echec('liste des objets du banc', e); bilan.echecsOrphelins++; return bilan; }
            const limite = now.getTime() - ORPHELIN_MS;
            const vieux = objets.filter(o => +o.modifieLe < limite);
            if (!vieux.length) return bilan;
            // UNE requête à projection lit l'ensemble des cleR2 référencées (pas une requête par objet) ; si elle échoue, on ne sait pas : AUCUNE suppression.
            let references;
            try { references = new Set((await borner(col().find({}, { projection: { _id: 0, cleR2: 1 } }).toArray())).map(l => l.cleR2)); }
            catch (e) { echec('références des lignes non lisibles, aucun orphelin supprimé', e); bilan.echecsOrphelins++; return bilan; }
            // ETIQUETAGE-B : la photo d'un scan de l'administrateur existe AVANT sa ligne (la ligne naît à l'étiquetage) : tant que l'analyse la nomme (`photoBanc.cle`), elle n'est pas orpheline.
            // Si l'on ne sait pas lire les analyses, aucun orphelin n'est supprimé (une garde qui ne peut pas conclure bloque).
            try { for (const a of await borner(colFn('analyses').find({ 'photoBanc.cle': { $type: 'string' } }, { projection: { _id: 0, 'photoBanc.cle': 1 } }).toArray())) if (a.photoBanc && a.photoBanc.cle) references.add(a.photoBanc.cle); }
            catch (e) { echec('photos des analyses non lisibles, aucun orphelin supprimé', e); bilan.echecsOrphelins++; return bilan; }
            for (const o of vieux) {
                if (references.has(o.cle)) continue;
                try { await borner(s.supprimer(o.cle)); bilan.orphelins++; }
                catch (e) { echec('orphelin non supprimé', e); bilan.echecsOrphelins++; }
            }
            return bilan;
        },
    };
}

// ── le CLI : écrit par ce qu'il AUTORISE. Une seule base de banc (test_scratch) ou la production avec sa confirmation nommée ; tout le reste est refusé AVANT toute connexion.
const USAGE = 'usage : node v2/banc/purge.js --base=test_scratch   (la production : --base=test --confirmer-production)';
function analyserArgs(argv) {
    if (!Array.isArray(argv)) return { erreur: 'arguments illisibles' };
    let base = null, confirmer = false;
    for (const a of argv) {
        if (typeof a === 'string' && a.startsWith('--base=')) {
            if (base !== null) return { erreur: '--base donné deux fois' };
            base = a.slice('--base='.length).trim();
        } else if (a === '--confirmer-production') confirmer = true;
        else return { erreur: `argument non reconnu « ${String(a).slice(0, 40)} »` };
    }
    if (!base) return { erreur: 'aucune base précisée, et je ne devine pas' };
    if (base !== 'test_scratch' && base !== 'test') return { erreur: `base « ${base.slice(0, 40)} » non admise (test_scratch, ou test avec --confirmer-production)` };
    if (base === 'test' && !confirmer) return { erreur: '--base=test est la PRODUCTION ; relance avec --confirmer-production' };
    return { base, confirmer };
}
async function connecterReel() {
    const { connecterMongo } = require('../../mongo-connexion');
    const reelle = await connecterMongo({ script: 'v2/banc/purge.js', ecrit: true });
    db.brancher(require('mongoose').connection.db);
    return reelle;
}
/** @returns {Promise<number>} le code de sortie (0 : tout est fait ; 1 : refusé ou connexion impossible ; 2 : des suppressions ont échoué). Ne quitte jamais le processus. */
async function lancerCLI(argv, { connecter = connecterReel, stockage = null, horloge = () => new Date(), journal = l => console.log(l), env = process.env, cfg = null } = {}) {
    const a = analyserArgs(argv);
    if (a.erreur) { console.error(`❌ ARRÊT : ${a.erreur}\n   ${USAGE}`); return 1; }
    try { await connecter(a.base); }
    catch (e) { console.error(`❌ ARRÊT : connexion impossible (${codeDe(e)})`); return 1; }
    const purge = creerPurge({ cfg: cfg || require('../config').lireConfig(env), env, stockage, horloge });
    const b = await purge.purgerBanc(horloge());
    journal(`purge du banc réel : ${b.lignes} ligne(s) échue(s) supprimée(s), ${b.objets} objet(s) supprimé(s), ${b.echecs} échec(s) ; filet : ${b.orphelins} orphelin(s) supprimé(s), ${b.echecsOrphelins} échec(s)`);
    // BANC-12 : la même commande coupe aussi les liens échus (12 mois) — le worker peut la lancer à la main
    const an = await purge.anonymiserLiens(horloge());
    journal(`anonymisation du lien : ${an.lignes} ligne(s) anonymisée(s), ${an.attente} attente(s) supprimée(s), ${an.mouvements} mouvement(s), ${an.questions} question(s), ${an.analyses} analyse(s), ${an.forcees} ligne(s) supprimée(s) au-delà de la grâce, ${an.echecs} échec(s)`);
    return b.echecs || b.echecsOrphelins || an.echecs ? 2 : 0;
}

module.exports = { creerPurge, analyserArgs, lancerCLI, FORME_JETON, ORPHELIN_MS };

if (require.main === module) {
    require('dotenv').config();
    lancerCLI(process.argv.slice(2)).then(async code => { try { await require('mongoose').disconnect(); } catch { /* rien */ } process.exit(code); });
}
