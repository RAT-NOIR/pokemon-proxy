'use strict';
// I2 : le temps de réponse ne dit pas si l'adresse existe (courrier simulé à 120 ms, comme un appel HTTP réel).
const H = require('./_harnais'); const A = require('./_b2-aide'); const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config'); const P = require('../comptes/mots-de-passe');
const attente = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    await H.ouvrirBac('test-comptes-temps.js'); await M.creerIndex();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
    const envoyes = []; const lent = { envoyerVerification: async (e, l) => { await attente(120); envoyes.push(['v', e]); }, envoyerReinitialisation: async (e, l) => { await attente(120); envoyes.push(['r', e]); } };
    A.registre.fournir('courrier', lent); A.registre.fournir('turnstile', { verifier: async () => true });
    const srv = await A.demarrer(cfg); let n = 0; const MDP = 'un-mot-de-passe-solide';
    const c = M.nouveauCompte({ email: 'existe@exemple.fr', emailCle: 'existe@exemple.fr', motDePasse: await P.hacher(MDP) }); await db.col('comptes').insertOne(c);
    const mesure = async (chemin, corps) => { const t = process.hrtime.bigint(); const r = await H.appel(srv.url, chemin, { methode: 'POST', corps, entetes: { ...A.SITE, ...A.ip(++n) } }); const ms = Number(process.hrtime.bigint() - t) / 1e6; await A.attendre(); return { ms, statut: r.statut }; };
    const moy = l => l.reduce((a, b) => a + b, 0) / l.length;
    const ESSAIS = 20; const t = { insNouvelle: [], insExistante: [], oubliConnu: [], oubliInconnu: [], renvoiConnu: [], renvoiInconnu: [] };
    await mesure('/api/compte/mot-de-passe-oublie', { email: 'existe@exemple.fr' });   // chauffe
    for (let i = 0; i < ESSAIS; i++) {
        t.insNouvelle.push((await mesure('/api/compte/inscription', { email: `neuf${i}@exemple.fr`, turnstile: 't' })).ms);
        t.insExistante.push((await mesure('/api/compte/inscription', { email: 'existe@exemple.fr', turnstile: 't' })).ms);
        t.oubliConnu.push((await mesure('/api/compte/mot-de-passe-oublie', { email: 'existe@exemple.fr' })).ms);
        t.oubliInconnu.push((await mesure('/api/compte/mot-de-passe-oublie', { email: `inconnu${i}@exemple.fr` })).ms);
        // O3 (tour 1, I-4) : le renvoi — adresse EN ATTENTE dont le courriel est libre (la limite est vidée : le courrier lent PART à chaque essai) contre adresse inconnue
        await db.col('limites').deleteMany({ cle: /^confirmation:/ });
        t.renvoiConnu.push((await mesure('/api/compte/renvoyer-verification', { email: 'existe@exemple.fr' })).ms);
        t.renvoiInconnu.push((await mesure('/api/compte/renvoyer-verification', { email: `inconnu${i}@exemple.fr` })).ms);
    }
    const ecart = (a, b) => Math.abs(moy(a) - moy(b));
    H.vrai(`inscription : adresse nouvelle ${moy(t.insNouvelle).toFixed(0)} ms / existante ${moy(t.insExistante).toFixed(0)} ms, écart ${ecart(t.insNouvelle, t.insExistante).toFixed(1)} ms < 30 (${ESSAIS} essais par branche)`, ecart(t.insNouvelle, t.insExistante) < 30);
    H.vrai(`mot de passe oublié : connue ${moy(t.oubliConnu).toFixed(0)} ms / inconnue ${moy(t.oubliInconnu).toFixed(0)} ms, écart ${ecart(t.oubliConnu, t.oubliInconnu).toFixed(1)} ms < 30 (${ESSAIS} essais par branche)`, ecart(t.oubliConnu, t.oubliInconnu) < 30);
    H.vrai(`le courrier lent n'est jamais attendu : toutes les branches < 120 ms de moyenne`, [t.insNouvelle, t.oubliConnu].every(l => moy(l) < 120));
    H.vrai(`renvoi de vérification : en attente (courrier lent, ${ESSAIS} envois) ${moy(t.renvoiConnu).toFixed(0)} ms / inconnue ${moy(t.renvoiInconnu).toFixed(0)} ms, écart ${ecart(t.renvoiConnu, t.renvoiInconnu).toFixed(1)} ms < 30, moyenne < 120 ms`, ecart(t.renvoiConnu, t.renvoiInconnu) < 30 && moy(t.renvoiConnu) < 120);
    // B8 (O1) : ce banc est un banc de TEMPS ; son « 21 courriers » était un incident de sa construction (une IP neuve à chaque appel neutralise la limite par IP, 21 demandes pour UNE adresse),
    // pas une spécification. Depuis la limite par adresse (renvoiParCompteHeure par heure, comme le renvoi de vérification), l'assertion dit ce qu'elle voulait dire : le courrier part bel et bien
    // (au moins un, jamais plus que la borne), les 20 inscriptions neuves envoient toutes leur lien. Les durées (lignes ci-dessus) sont inchangées : la limite est jugée DANS le travail détaché.
    // O3 : « existe@ » est un compte NON confirmé (nouveauCompte) : sa 1re réinscription envoie UN courrier (ruling 5 : le premier inscrit reçoit un courriel si la limite d'un par adresse et par 24 h le permet), les 19 suivantes rien.
    H.v('et le courrier part bel et bien (travail détaché terminé : 20 nouvelles inscriptions + 1 pour l\'adresse en attente, UN seul en 24 h ; oublis connus : au moins 1 et au plus la borne par adresse)', [envoyes.filter(e => e[0] === 'v').length, envoyes.filter(e => e[0] === 'r').length >= 1 && envoyes.filter(e => e[0] === 'r').length <= cfg.limites.renvoiParCompteHeure], [2 * ESSAIS + 1, true]);   // + les 20 renvois mesurés ci-dessus (limite vidée à chaque essai)
    // une panne du pilote est journalisée sans adresse ni message brut
    const trace = []; const orig = console.error; console.error = (...a) => trace.push(a.join(' '));
    A.registre.fournir('courrier', { envoyerVerification: async () => { throw new Error('Brevo 401 pour secret@exemple.fr'); }, envoyerReinitialisation: async () => { throw new Error('Brevo 401 pour autre@exemple.fr'); } });
    await mesure('/api/compte/inscription', { email: 'secret@exemple.fr', turnstile: 't' });
    // B8 (O1) : la première adresse a épuisé sa borne par heure ; la panne du pilote se prouve sur une AUTRE adresse connue (même pilote, même chemin), qui a encore son droit à un courrier
    await db.col('comptes').insertOne(M.nouveauCompte({ email: 'autre@exemple.fr', emailCle: 'autre@exemple.fr', motDePasse: await P.hacher(MDP) }));
    await mesure('/api/compte/mot-de-passe-oublie', { email: 'autre@exemple.fr' });
    console.error = orig;
    H.vrai(`échec du courrier journalisé (${trace.length} lignes) sans adresse ni message brut`, trace.length >= 2 && !trace.join('\n').includes('exemple.fr') && !trace.join('\n').includes('Brevo 401'));
    await srv.fermer(); await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
