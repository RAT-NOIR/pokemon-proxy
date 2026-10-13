'use strict';
// Lot O3-RESIDU, tour 1 (relecture 2, I1 et I2) : les schémas de REQUÊTE de l'inscription et de la vérification sont jugés contre la route RÉELLE, et les exemples du contrat
// contre les schémas ET contre la route. Avant ce banc, `test-contrat-reel` ne jugeait que les réponses : un schéma de requête (ou un exemple recopié par le site) pouvait mentir sans qu'un banc échoue.
//   - l'exemple du contrat est joué tel quel sur la vraie route (inscription : 202 ; vérification : 404 CODE_INVALIDE, donc forme acceptée ; connexion : 401) ;
//   - `required` de chaque schéma = exactement l'ensemble des champs dont le retrait CHANGE la réponse de la route (mesuré, pas recopié) ;
//   - `minLength` du mot de passe de la vérification = le plus court mot de passe que la route accepte ;
//   - un champ que le schéma ne déclare pas (`motDePasse` à l'inscription) est refusé par la route.
const fs = require('fs'), path = require('path');
const H = require('./_harnais'); const A = require('./_b2-aide'); const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config'); const J = require('../comptes/jetons'); const { creerCourrierMemoire } = require('../comptes/courrier');
const { valider } = require('../openapi/valider');
(async () => {
    const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'openapi', 'openapi.v2.json'), 'utf8'));
    const texte = fs.readFileSync(path.join(__dirname, '..', '..', 'CONTRAT-API-V2.md'), 'utf8');
    const blocs = [...texte.matchAll(/```json schema=([A-Za-z]+)\r?\n([\s\S]*?)```/g)].map(m => ({ schema: m[1], valeur: JSON.parse(m[2]) }));
    const exemples = nom => blocs.filter(b => b.schema === nom).map(b => b.valeur);
    const ref = n => ({ $ref: `#/components/schemas/${n}` });
    const S = doc.components.schemas;

    await H.ouvrirBac('test-comptes-schemas-requete.js'); await M.creerIndex();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
    const courrier = creerCourrierMemoire(); A.registre.fournir('courrier', courrier); A.registre.fournir('turnstile', { verifier: async () => true });
    const srv = await A.demarrer(cfg); let n = 0;
    const post = (chemin, corps) => H.appel(srv.url, chemin, { methode: 'POST', corps, entetes: { ...A.SITE, ...A.ip(++n) } });
    const sans = (o, champ) => { const c = JSON.parse(JSON.stringify(o)); delete c[champ]; return c; };

    // ---- 1 : les exemples du contrat existent, valident contre leur schéma ----
    for (const nom of ['RequeteInscription', 'RequeteVerification', 'RequeteConnexion']) {
        H.v(`${nom} : UN exemple dans CONTRAT-API-V2.md`, exemples(nom).length, 1);
        H.vrai(`${nom} : l'exemple du contrat valide contre le schéma`, exemples(nom).length === 1 && valider(exemples(nom)[0], ref(nom), doc).ok);
    }
    const exIns = exemples('RequeteInscription')[0], exVer = exemples('RequeteVerification')[0], exCon = exemples('RequeteConnexion')[0];

    // ---- 2 : les exemples du contrat JOUÉS tels quels sur la route réelle ----
    const rIns = await post('/api/compte/inscription', exIns); await A.attendre();
    H.v('l\'exemple d\'inscription du contrat, joué tel quel : 202 { success: true } (un champ que le serveur refuse le ferait échouer en 422)', [rIns.statut, rIns.json], [202, { success: true }]);
    const rVer = await post('/api/compte/verification', exVer);
    H.v('l\'exemple de vérification du contrat, joué tel quel : forme acceptée (404 CODE_INVALIDE pour un lien fictif, ni 400 ni 422)', [rVer.statut, rVer.json && rVer.json.erreur && rVer.json.erreur.code], [404, 'CODE_INVALIDE']);
    const rCon = await post('/api/compte/connexion', exCon);
    H.v('l\'exemple de connexion du contrat, joué tel quel : forme acceptée (401 IDENTIFIANTS pour un compte inconnu)', [rCon.statut, rCon.json && rCon.json.erreur && rCon.json.erreur.code], [401, 'IDENTIFIANTS']);

    // ---- 3 : `required` = l'ensemble MESURÉ des champs dont le retrait change la réponse ----
    const unique = () => `schema${++n}@exemple.fr`;
    const corpsIns = () => ({ ...exIns, email: unique() });
    const corpsVer = async () => {
        const c = M.nouveauCompte({ email: unique(), emailCle: unique(), motDePasse: null }); c.emailCle = c.email; await db.col('comptes').insertOne(c);
        const jeton = J.genererJeton(); await db.col('liens_email').insertOne({ empreinte: J.empreinte(jeton), type: 'verification', compteId: c._id, creeLe: new Date(), expireLe: new Date(Date.now() + 864e5), utiliseLe: null });
        return { ...exVer, jeton, motDePasse: 'mot-de-passe-du-banc-schema' };
    };
    const signature = r => `${r.statut}|${r.json && r.json.erreur ? r.json.erreur.code + '/' + (r.json.erreur.detail || '') : (r.json && r.json.success)}`;
    async function mesurer(nomSchema, chemin, fabrique) {
        const base = await post(chemin, await fabrique()); await A.attendre();
        const champs = Object.keys(S[nomSchema].properties), requis = [];
        for (const champ of champs) { const r = await post(chemin, sans(await fabrique(), champ)); await A.attendre(); if (signature(r) !== signature(base)) requis.push(champ); }
        return { base: signature(base), requis: requis.sort() };
    }
    const mIns = await mesurer('RequeteInscription', '/api/compte/inscription', corpsIns);
    H.v('inscription : le corps complet de l\'exemple est accepté (202)', mIns.base, '202|true');
    H.v('RequeteInscription.required = les champs dont le retrait change la réponse de la route', [[...S.RequeteInscription.required].sort(), mIns.requis], [mIns.requis, mIns.requis]);
    H.v('RequeteInscription.required est exactement [email, turnstile]', [...S.RequeteInscription.required].sort(), ['email', 'turnstile']);
    const mVer = await mesurer('RequeteVerification', '/api/compte/verification', corpsVer);
    H.v('vérification : un lien vivant et un mot de passe valable donnent 200', mVer.base, '200|true');
    H.v('RequeteVerification.required = les champs dont le retrait change la réponse de la route', [[...S.RequeteVerification.required].sort(), mVer.requis], [mVer.requis, mVer.requis]);
    H.v('RequeteVerification.required est exactement [jeton, motDePasse]', [...S.RequeteVerification.required].sort(), ['jeton', 'motDePasse']);

    // ---- 4 : minLength du mot de passe de la vérification = le plus court mot de passe accepté ----
    const court = await post('/api/compte/verification', { ...(await corpsVer()), motDePasse: 'x'.repeat(S.RequeteVerification.properties.motDePasse.minLength - 1) });
    const juste = await post('/api/compte/verification', { ...(await corpsVer()), motDePasse: 'x'.repeat(S.RequeteVerification.properties.motDePasse.minLength) });
    H.v('RequeteVerification.motDePasse.minLength : un caractère de moins est refusé (422 trop-court), la longueur exacte est acceptée (200)', [signature(court), signature(juste)], ['422|MOT_DE_PASSE_FAIBLE/trop-court', '200|true']);

    // ---- 5 : l'inscription ne déclare pas de mot de passe ET la route le refuse ----
    H.v('RequeteInscription ne déclare aucun motDePasse', Object.keys(S.RequeteInscription.properties).includes('motDePasse'), false);
    const avecMdp = await post('/api/compte/inscription', { ...corpsIns(), motDePasse: 'un mot de passe long' });
    H.v('un champ non déclaré qui est un mot de passe est refusé par la route (422 mot-de-passe-non-attendu)', signature(avecMdp), '422|ENTREE/mot-de-passe-non-attendu');
    // le contrôle sait dire NON : un exemple qui porterait motDePasse serait refusé par la route
    const rMauvais = await post('/api/compte/inscription', { ...exIns, email: unique(), motDePasse: 'un mot de passe long' });
    H.v('(témoin) l\'ancien exemple du contrat, avec motDePasse, serait refusé en 422', rMauvais.statut, 422);

    await srv.fermer(); await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
