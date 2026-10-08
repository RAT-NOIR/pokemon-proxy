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
        t.insNouvelle.push((await mesure('/api/compte/inscription', { email: `neuf${i}@exemple.fr`, motDePasse: MDP, turnstile: 't' })).ms);
        t.insExistante.push((await mesure('/api/compte/inscription', { email: 'existe@exemple.fr', motDePasse: MDP, turnstile: 't' })).ms);
        t.oubliConnu.push((await mesure('/api/compte/mot-de-passe-oublie', { email: 'existe@exemple.fr' })).ms);
        t.oubliInconnu.push((await mesure('/api/compte/mot-de-passe-oublie', { email: `inconnu${i}@exemple.fr` })).ms);
    }
    const ecart = (a, b) => Math.abs(moy(a) - moy(b));
    H.vrai(`inscription : adresse nouvelle ${moy(t.insNouvelle).toFixed(0)} ms / existante ${moy(t.insExistante).toFixed(0)} ms, écart ${ecart(t.insNouvelle, t.insExistante).toFixed(1)} ms < 30 (${ESSAIS} essais par branche)`, ecart(t.insNouvelle, t.insExistante) < 30);
    H.vrai(`mot de passe oublié : connue ${moy(t.oubliConnu).toFixed(0)} ms / inconnue ${moy(t.oubliInconnu).toFixed(0)} ms, écart ${ecart(t.oubliConnu, t.oubliInconnu).toFixed(1)} ms < 30 (${ESSAIS} essais par branche)`, ecart(t.oubliConnu, t.oubliInconnu) < 30);
    H.vrai(`le courrier lent n'est jamais attendu : toutes les branches < 120 ms de moyenne`, [t.insNouvelle, t.oubliConnu].every(l => moy(l) < 120));
    H.v('et le courrier part bel et bien (travail détaché terminé : 20 nouvelles inscriptions + 21 oublis connus)', [envoyes.filter(e => e[0] === 'v').length, envoyes.filter(e => e[0] === 'r').length], [ESSAIS, ESSAIS + 1]);
    // une panne du pilote est journalisée sans adresse ni message brut
    const trace = []; const orig = console.error; console.error = (...a) => trace.push(a.join(' '));
    A.registre.fournir('courrier', { envoyerVerification: async () => { throw new Error('Brevo 401 pour secret@exemple.fr'); }, envoyerReinitialisation: async () => { throw new Error('Brevo 401 pour existe@exemple.fr'); } });
    await mesure('/api/compte/inscription', { email: 'secret@exemple.fr', motDePasse: MDP, turnstile: 't' });
    await mesure('/api/compte/mot-de-passe-oublie', { email: 'existe@exemple.fr' });
    console.error = orig;
    H.vrai(`échec du courrier journalisé (${trace.length} lignes) sans adresse ni message brut`, trace.length >= 2 && !trace.join('\n').includes('exemple.fr') && !trace.join('\n').includes('Brevo 401'));
    await srv.fermer(); await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
