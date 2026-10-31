'use strict';
// BREVO — le pilote d'envoi (courrier-brevo.js) joué contre un FAUX serveur local : aucune requête ne part vers Brevo.
// Ce qu'il prouve : la forme exacte de la requête (clé en en-tête, expéditeur, Reply-To, sujet / texte / HTML du gabarit du site), le délai borné, UN réessai sur 5xx / réseau / délai et jamais sur 4xx,
// aucune adresse ni contenu ni clé dans les journaux, la clé lue UNE fois, les adresses refusées avant toute requête, le plafond du jour.
const http = require('http');
const H = require('./_harnais');
const { creerCourrierBrevo } = require('../comptes/courrier');
const CLE = 'xkeysib-CLE-DE-BANC-0123456789';
const MAIL = 'tiers.secret@exemple.fr';
const LIEN = 'https://rat-market.fr/fr/verification?jeton=JETON-SECRET-123';

function fauxServeur(reponses) {   // reponses : fonction (n, req) → { statut, corps } | 'silence' | 'coupure'
    const vus = [];
    const srv = http.createServer((req, res) => {
        const morceaux = [];
        req.on('data', c => morceaux.push(c));
        req.on('end', () => {
            const brut = Buffer.concat(morceaux).toString('utf8'); let corps = null; try { corps = JSON.parse(brut); } catch { /* corps non JSON */ }
            vus.push({ methode: req.method, chemin: req.url, entetes: req.headers, corps });
            const r = reponses(vus.length, req);
            if (r === 'silence') return;                              // ne répond jamais
            if (r === 'coupure') return req.socket.destroy();
            if (r === 'corps-sans-fin' || r === 'corps-sans-fin-503') { res.writeHead(r === 'corps-sans-fin' ? 201 : 503, { 'content-type': 'application/json' }); return res.write('{"message":'); }   // l'en-tête part, le corps ne finit jamais
            res.writeHead(r.statut, { 'content-type': 'application/json' }); res.end(JSON.stringify(r.corps || {}));
        });
    });
    return new Promise(ok => srv.listen(0, '127.0.0.1', () => ok({ vus, url: `http://127.0.0.1:${srv.address().port}/v3/smtp/email`, fermer: () => new Promise(f => { srv.closeAllConnections?.(); srv.close(f); }) })));
}
const n = s => String(s).replace(/[  ]/g, ' ');   // le gabarit du site écrit des espaces insécables françaises
const lever = async f => { try { await f(); return null; } catch (e) { return e; } };
(async () => {
    const journaux = []; const garde = {};
    // `log` reste libre : c'est la sortie du harnais
    for (const k of ['warn', 'error', 'info']) { garde[k] = console[k]; console[k] = (...a) => journaux.push(a.join(' ')); }
    const rendre = () => { for (const k of Object.keys(garde)) console[k] = garde[k]; };
    try {
        // ---- construction ----
        let e = await lever(() => creerCourrierBrevo({ cle: undefined, env: {} }));
        H.v('sans clé : la construction LÈVE (code seul, jamais de valeur)', [e && e.name, e && /xkeysib/.test(e.message)], ['BrevoCleAbsente', false]);
        e = await lever(() => creerCourrierBrevo({ cle: '   ', env: {} }));
        H.v('une clé faite d\'espaces n\'est pas une clé', e && e.name, 'BrevoCleAbsente');
        process.env.BANC_ISOLE = '1';
        e = await lever(() => creerCourrierBrevo({ cle: CLE }));
        H.v('banc isolé + adresse de Brevo par défaut : REFUSÉ à la construction (un banc n\'envoie jamais un vrai courriel)', e && e.name, 'BrevoBancInterdit');

        // ---- succès : la forme de la requête ----
        const s1 = await fauxServeur(() => ({ statut: 201, corps: { messageId: '<x@y>' } }));
        const p = creerCourrierBrevo({ cle: CLE, url: s1.url, reessaiMs: 0 });
        await p.envoyerVerification(MAIL, LIEN, { purgeHeures: 48 });
        const r = s1.vus[0];
        H.v('une seule requête POST vers /v3/smtp/email', [s1.vus.length, r.methode, r.chemin], [1, 'POST', '/v3/smtp/email']);
        H.v('   la clé voyage dans l\'en-tête api-key, en JSON', [r.entetes['api-key'], /application\/json/.test(r.entetes['content-type'])], [CLE, true]);
        H.v('   expéditeur Rat-Market <no-reply@rat-market.fr> (décision de l\'éditeur du 31/10), Reply-To de contact, un seul destinataire', [r.corps.sender, r.corps.replyTo.email, r.corps.to], [{ name: 'Rat-Market', email: 'no-reply@rat-market.fr' }, 'ratmarket.contact@gmail.com', [{ email: MAIL }]]);
        {   // l'expéditeur et le Reply-To viennent de la configuration (options du pilote), pas des gabarits
            const sc = await fauxServeur(() => ({ statut: 201 }));
            const pc = creerCourrierBrevo({ cle: CLE, url: sc.url, reessaiMs: 0, de: 'autre@rat-market.fr', repondreA: 'aide@rat-market.fr' });
            await pc.envoyerVerification(MAIL, LIEN, {});
            H.v('   expéditeur et Reply-To configurés : repris tels quels dans la requête', [sc.vus[0].corps.sender, sc.vus[0].corps.replyTo], [{ name: 'Rat-Market', email: 'autre@rat-market.fr' }, { email: 'aide@rat-market.fr' }]);
            H.vrai('   une adresse d\'expéditeur illisible : la construction LÈVE', (await lever(() => creerCourrierBrevo({ cle: CLE, url: sc.url, de: 'pas une adresse' }))).name === 'BrevoExpediteur');
            await sc.fermer();
        }
        H.v('   sujet du gabarit du site', r.corps.subject, 'Confirmez votre adresse pour activer votre compte Rat-Market');
        H.vrai('   texte ET HTML portent le lien, et le HTML est celui du gabarit (document complet)', r.corps.textContent.includes(LIEN) && r.corps.htmlContent.includes('<html') && r.corps.htmlContent.includes('JETON-SECRET-123'));
        H.vrai('   la phrase d\'ignorance du tiers est dite', /Si vous n.êtes pas à l.origine/.test(r.corps.textContent));
        await p.envoyerReinitialisation(MAIL, 'https://rat-market.fr/fr/reinitialisation?jeton=ZZZ', { validiteHeures: 24 });
        H.v('réinitialisation : sujet du site, durée de validité fournie par l\'API', [s1.vus[1].corps.subject, /valable 24 heures/.test(n(s1.vus[1].corps.textContent))], ['Choisissez un nouveau mot de passe Rat-Market', true]);
        await p.envoyerAvertissement(MAIL, { derniereConnexionLe: new Date('2023-11-20T10:00:00Z'), suppressionLe: new Date('2026-11-27T10:00:00Z') });
        const av = s1.vus[2].corps;
        H.vrai('avertissement : objet, date de suppression, date de dernière connexion, lien de connexion', /sera supprimé le 27 novembre 2026/.test(n(av.subject)) && /20 novembre 2023/.test(n(av.textContent)) && av.textContent.includes('https://rat-market.fr/fr/connexion'));
        e = await lever(() => p.envoyerAvertissement(MAIL, { derniereConnexionLe: new Date('2023-11-20T10:00:00Z'), suppressionLe: new Date('pas une date') }));
        H.v('avertissement sans date de suppression lisible : refusé, aucune requête de plus', [e && e.name, s1.vus.length], ['RangeError', 3]);
        e = await lever(() => p.envoyerVerification(MAIL, 'http://evil.example/x'));
        H.v('lien hors des hôtes attendus : REFUSÉ par le gabarit, aucune requête', [e && e.name, s1.vus.length], ['LienCourrielInvalide', 3]);

        // ---- la clé est lue une seule fois ----
        process.env.BREVO_API_KEY = CLE;
        const s2 = await fauxServeur(() => ({ statut: 201 }));
        const p2 = creerCourrierBrevo({ url: s2.url, reessaiMs: 0 });
        process.env.BREVO_API_KEY = 'AUTRE-CLE-CHANGEE-APRES'; await p2.envoyerReinitialisation(MAIL, 'https://rat-market.fr/fr/reinitialisation?jeton=A');
        delete process.env.BREVO_API_KEY; await p2.envoyerReinitialisation(MAIL, 'https://rat-market.fr/fr/reinitialisation?jeton=B');
        H.v('la clé est lue à la construction : changée puis retirée de l\'environnement, les envois portent la première', s2.vus.map(v => v.entetes['api-key']), [CLE, CLE]);
        await s2.fermer();

        // ---- réessai : 5xx une fois, jamais sur 4xx ----
        const s3 = await fauxServeur(n => (n === 1 ? { statut: 503, corps: { message: `boîte ${MAIL}` } } : { statut: 201 }));
        const p3 = creerCourrierBrevo({ cle: CLE, url: s3.url, reessaiMs: 0 });
        await p3.envoyerVerification(MAIL, LIEN);
        H.v('5xx puis 201 : UN réessai, l\'envoi aboutit', s3.vus.length, 2); await s3.fermer();
        const s4 = await fauxServeur(() => ({ statut: 500, corps: { message: `boîte ${MAIL} ${CLE}` } }));
        const p4 = creerCourrierBrevo({ cle: CLE, url: s4.url, reessaiMs: 0 });
        e = await lever(() => p4.envoyerVerification(MAIL, LIEN));
        H.v('5xx deux fois : UN seul réessai au plus (2 requêtes), puis l\'erreur porte le code', [s4.vus.length, e && e.name, e && e.message], [2, 'BrevoStatut500', 'BrevoStatut500']); await s4.fermer();
        for (const statut of [400, 401, 403, 429]) {
            const s = await fauxServeur(() => ({ statut, corps: { message: `boîte ${MAIL}` } }));
            const pp = creerCourrierBrevo({ cle: CLE, url: s.url, reessaiMs: 0 });
            e = await lever(() => pp.envoyerVerification(MAIL, LIEN));
            H.v(`${statut} : JAMAIS de réessai (1 requête), erreur nommée par le code seul`, [s.vus.length, e && e.name], [1, `BrevoStatut${statut}`]); await s.fermer();
        }
        // réseau coupé / délai
        const s5 = await fauxServeur(() => 'coupure');
        const p5 = creerCourrierBrevo({ cle: CLE, url: s5.url, reessaiMs: 0 });
        e = await lever(() => p5.envoyerVerification(MAIL, LIEN));
        H.v('connexion coupée : un réessai (2 requêtes) puis BrevoReseau', [s5.vus.length, e && e.name], [2, 'BrevoReseau']); await s5.fermer();
        const s6 = await fauxServeur(() => 'silence');
        const p6 = creerCourrierBrevo({ cle: CLE, url: s6.url, reessaiMs: 0, delaiMs: 150 });
        const t0 = Date.now(); e = await lever(() => p6.envoyerVerification(MAIL, LIEN)); const ms = Date.now() - t0;
        H.v('serveur muet : le délai BORNE l\'attente (2 essais de 150 ms), puis BrevoDelai', [s6.vus.length, e && e.name, ms >= 280 && ms < 2500], [2, 'BrevoDelai', true]); await s6.fermer();
        // TOUR 1 (R3) : le délai couvre aussi la LECTURE du corps ; un corps qui ne finit jamais fait échouer l'envoi par délai, sans bloquer (et sans réessai : l'envoi a pu être accepté)
        const s6b = await fauxServeur(() => 'corps-sans-fin');
        const p6b = creerCourrierBrevo({ cle: CLE, url: s6b.url, reessaiMs: 0, delaiMs: 150 });
        const t1 = Date.now(); e = await lever(() => p6b.envoyerVerification(MAIL, LIEN)); const ms2 = Date.now() - t1;
        H.v('R3 : corps de réponse sans fin : BrevoDelai, borné (< 2,5 s), UNE requête (pas de doublon après un 2xx)', [e && e.name, ms2 < 2500, s6b.vus.length], ['BrevoDelai', true, 1]); await s6b.fermer();
        const s6c = await fauxServeur(() => 'corps-sans-fin-503');
        const p6c = creerCourrierBrevo({ cle: CLE, url: s6c.url, reessaiMs: 0, delaiMs: 150 });
        const t2 = Date.now(); e = await lever(() => p6c.envoyerVerification(MAIL, LIEN)); const ms3 = Date.now() - t2;
        H.v('   un 503 au corps sans fin : le statut gagne (BrevoStatut503), un réessai, borné', [e && e.name, s6c.vus.length, ms3 < 2500], ['BrevoStatut503', 2, true]); await s6c.fermer();
        const mort = await fauxServeur(() => ({ statut: 201 })); const urlMorte = mort.url; await mort.fermer();
        const p7 = creerCourrierBrevo({ cle: CLE, url: urlMorte, reessaiMs: 0 });
        e = await lever(() => p7.envoyerVerification(MAIL, LIEN));
        H.v('rien n\'écoute : BrevoReseau', e && e.name, 'BrevoReseau');

        // ---- adresses refusées avant toute requête ----
        const s8 = await fauxServeur(() => ({ statut: 201 }));
        const p8 = creerCourrierBrevo({ cle: CLE, url: s8.url, reessaiMs: 0 });
        const mauvaises = [undefined, null, '', ' ', 'a', 'a@b', 'a b@exemple.fr', 'a@exemple.fr\r\nBcc: autre@exemple.fr', 'a@exemple.fr,b@exemple.fr', '<a@exemple.fr>', '"a"@exemple.fr', 'a@@exemple.fr', 42, {}, `${'x'.repeat(250)}@exemple.fr`, 'banc@banc.invalid', 'banc@BANC.INVALID'];
        const refus = [];
        for (const m of mauvaises) refus.push((await lever(() => p8.envoyerVerification(m, LIEN)))?.name || 'ACCEPTÉE');
        H.v(`${mauvaises.length} adresses invalides : toutes refusées (BrevoAdresse), 0 requête`, [refus.every(x => x === 'BrevoAdresse'), s8.vus.length], [true, 0]);
        await p8.envoyerVerification('prenom.nom+tag@sous.exemple.fr', LIEN);
        H.v('une adresse valide passe', s8.vus.length, 1); await s8.fermer();

        // ---- plafond du jour ----
        const classes = [];
        const plafondPlein = { reserver: async classe => { classes.push(classe); return false; } };
        const s9 = await fauxServeur(() => ({ statut: 201 }));
        const p9 = creerCourrierBrevo({ cle: CLE, url: s9.url, reessaiMs: 0, plafond: plafondPlein });
        const avant = journaux.length;
        const e1 = await lever(() => p9.envoyerVerification(MAIL, LIEN)); const e2 = await lever(() => p9.envoyerReinitialisation(MAIL, 'https://rat-market.fr/fr/reinitialisation?jeton=Q')); const e3 = await lever(() => p9.envoyerAvertissement(MAIL, { derniereConnexionLe: new Date('2023-11-20T10:00:00Z'), suppressionLe: new Date('2026-11-27T10:00:00Z') }));
        H.v('plafond atteint : BrevoPlafond, 0 requête, classes demandées (sécurité, sécurité, avertissement)', [e1 && e1.name, e2 && e2.name, e3 && e3.name, s9.vus.length, classes], ['BrevoPlafond', 'BrevoPlafond', 'BrevoPlafond', 0, ['securite', 'securite', 'avertissement']]);
        const dits = journaux.slice(avant).filter(l => /plafond/i.test(l));
        H.v('   un plafond atteint est DIT au journal (une ligne par classe, pas par courriel)', dits.length, 2);
        await s9.fermer();

        // ---- journaux : ni adresse, ni lien, ni clé, ni corps de réponse ----
        const tout = journaux.join('\n');
        H.vrai(`aucun journal (${journaux.length} lignes) ne contient l'adresse, le jeton, la clé ou un corps de réponse`, !tout.includes('exemple.fr') && !tout.includes('JETON-SECRET') && !tout.includes(CLE) && !/boîte/.test(tout));
        await s1.fermer();
    } finally { rendre(); }
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
