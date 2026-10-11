'use strict';
// COTES-VISUELS, tour 1 — la voie « FICHIER PRÉCALCULÉ » de bout en bout : le script autonome, le téléchargement, le montage, et l'équivalence avec le calcul en ligne. Aucun réseau réel : fetch
// injecté, serveur enfant en banc (aucune connexion à cartes, prouvée par un écouteur local qui compte les connexions).
const net = require('net'); const fs = require('fs'); const os = require('os'); const path = require('path'); const zlib = require('zlib');
const H = require('./_harnais');
const E = require('../chargeur/etat'); const F = require('../chargeur/format');
const I = require('../chargeur');
const { fabriquerFichier } = require('../chargeur/precalcul');
const { telecharger } = require('../chargeur/telechargement');
const { demarrerPourConfig } = require('../chargeur/montage');
const { lireConfig } = require('../config');

const vig = n => ({ cleR2: `vignettes/${n}.webp`, w: 200, h: 279 });
const im = (set, numero, n) => ({ set, numero, cleR2: `cartes/${n}.webp`, w: 600, h: 838, vignette: vig(n), langue: 'en', source: 'tcgdex' });
const imp = (numero) => ({ tirage: 'intl', expansion: 'Set A', numero, total: '100', rarete: 'Rare' });
const SETS = [{ _id: 'Set-A', idExpansion: 100, code: 'SA', nomAffichage: 'Set A', tirage: 'intl', region: 'intl', bulba: { expansion: 'Set A' } }];
function donnees(n) {
    const docs = [], lignes = [];
    for (let i = 1; i <= n; i++) {
        const num = String(i).padStart(3, '0');
        docs.push({ _id: i, nomEn: `Carte ${i}`, sets: ['Set-A'], impressions: [imp(num)], images: [im('Set-A', num, `c${i}`)] });
        lignes.push({ idProduct: 1000 + i, carteId: i, idExpansion: 100, numeroFiche: num, slug: `P${i}-SA${i}`, slugSet: 'Set-A' });
    }
    return { sets: SETS, docs, lignes };
}
const catalogue = new Map(Array.from({ length: 30 }, (_, i) => [1001 + i, 5000 + (i % 4)]));
const source = d => async () => ({ ok: true, ...d, fermer: async () => { } });
const attendre = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    // ── 1. le fichier précalculé donne EXACTEMENT ce que le calcul en ligne donne
    const d = donnees(30);
    const enLigne = await I.executerEnLigne({ source: source(d) })({ catalogue });
    const f = await fabriquerFichier({ source: source(d), catalogue });
    const viaFichier = await I.executerDepuisFichier({ lireFichier: async () => f.gz })();
    H.v('fichier : ok, mêmes comptes que le calcul en ligne (30 visuels, 30 fiches)', [viaFichier.ok, viaFichier.comptes.visuels, viaFichier.comptes.fichesLiees, enLigne.comptes.visuels], [true, 30, 30, 30]);
    const ids = Array.from({ length: 30 }, (_, i) => 1001 + i);
    H.v('   chaque entrée identique (30), les métacartes et les fiches aussi', [ids.filter(id => JSON.stringify(viaFichier.version.entree(id)) === JSON.stringify(enLigne.version.entree(id))).length,
        JSON.stringify([5000, 5001, 5002, 5003].map(m => viaFichier.version.produitsDeMetacarte(m))) === JSON.stringify([5000, 5001, 5002, 5003].map(m => enLigne.version.produitsDeMetacarte(m))),
        JSON.stringify(viaFichier.version.fichesDuSet('Set-A')) === JSON.stringify(enLigne.version.fichesDuSet('Set-A'))], [30, true, true]);
    H.v('   les dénominateurs d\'entrée voyagent avec le fichier (sets, cartes, produits, catalogue)', [viaFichier.comptes.sets, viaFichier.comptes.cartes, viaFichier.comptes.produits, viaFichier.comptes.catalogue], [1, 30, 30, 30]);
    const sansImage = donnees(3); sansImage.docs.forEach(x => { x.images = []; });
    let vide = null; try { await fabriquerFichier({ source: source(sansImage), catalogue }); } catch (e) { vide = e.motif; }
    H.v('rien d\'admissible (aucune image) : AUCUN fichier produit, motif nommé', typeof vide === 'string' ? /0 visuel.*aucun fichier/.test(vide) : vide, true);

    // ── 2. le chargeur sur la voie fichier : bascule, refus d'un fichier abîmé, version gardée, AUCUNE reprise
    E.vider();
    const journal = [];
    const ch = lire => I.creerChargeur({ catalogue: async () => new Map(), executer: I.executerDepuisFichier({ lireFichier: lire }), journal: m => journal.push(m), pret: async () => true });
    const r1 = await ch(async () => f.gz).charger();
    H.v('chargeur sur fichier : ok, 30 visuels en place', [r1.ok, E.version().comptes.visuels], [true, 30]);
    const garde = E.version();
    for (const [nom, octets] of [['archive tronquée', f.gz.subarray(0, f.gz.length >> 1)], ['pas du gzip', Buffer.from('pas du gzip')], ['octet retourné', (() => { const b = Buffer.from(zlib.gunzipSync(f.gz)); b[b.length >> 1] ^= 1; return zlib.gzipSync(b); })()], ['vide', Buffer.alloc(0)]]) {
        const r = await ch(async () => octets).charger();
        H.v(`${nom} : refusé, version précédente gardée`, [r.ok, E.version() === garde], [false, true]);
    }
    const rPanne = await ch(async () => { throw new Error('panne'); }).charger();
    H.v('lecture du fichier qui échoue : échec, version gardée', [rPanne.ok, E.version() === garde], [false, true]);
    H.vrai('   le journal dit « fichier refusé » avec le motif de structure, sans texte de pilote', journal.some(m => /fichier refusé|fichier illisible/.test(m)));

    // ── 3. le téléchargement : seulement l'hôte public, https, sans redirection, borné
    const hotes = ['pub-abc.r2.dev', 'rat-market.fr'];
    const rep = (corps, o = {}) => async (url, opts) => { rep.dernier = { url, opts }; return { status: 200, headers: { get: () => null }, body: (async function* () { yield corps; })(), ...o }; };
    const ok = await telecharger('https://pub-abc.r2.dev/v2/visuels-api.rmv.gz', { hotes, fetchFn: rep(f.gz) });
    H.v('téléchargement : les octets, sans suivre de redirection', [ok.equals(f.gz), rep.dernier.opts.redirect], [true, 'error']);
    const refus = async (nom, url, fetchFn, o = {}) => { let m = null; try { await telecharger(url, { hotes, fetchFn, ...o }); } catch (e) { m = e.name === 'Telechargement' ? e.motif : `AUTRE:${e.name}`; } H.vrai(`   refusé : ${nom} (${m})`, typeof m === 'string' && !m.startsWith('AUTRE')); };
    await refus('http', 'http://pub-abc.r2.dev/x', rep(f.gz));
    await refus('hôte hors liste', 'https://evil.example/x', rep(f.gz));
    await refus('identifiant dans l\'adresse', 'https://u:p@pub-abc.r2.dev/x', rep(f.gz));
    await refus('port', 'https://pub-abc.r2.dev:8443/x', rep(f.gz));
    await refus('adresse illisible', 'pas une url', rep(f.gz));
    await refus('404', 'https://pub-abc.r2.dev/x', rep(f.gz, { status: 404 }));
    await refus('redirection (le fetch lève)', 'https://pub-abc.r2.dev/x', async () => { throw Object.assign(new Error('redirect'), { name: 'TypeError' }); });
    await refus('taille annoncée trop grande', 'https://pub-abc.r2.dev/x', rep(f.gz, { headers: { get: () => '999999999' } }));
    await refus('taille lue trop grande', 'https://pub-abc.r2.dev/x', rep(Buffer.alloc(5000)), { max: 1000 });
    await refus('fichier vide', 'https://pub-abc.r2.dev/x', rep(Buffer.alloc(0)));
    const veille = setTimeout(() => { }, 5000);            // AbortSignal.timeout est « unref » : sans cette veille, le banc sortirait avant l'échéance (un vrai fetch tient le processus par sa socket)
    await refus('délai dépassé', 'https://pub-abc.r2.dev/x', (url, o) => new Promise((_, ko) => o.signal.addEventListener('abort', () => ko(Object.assign(new Error('t'), { name: 'TimeoutError' })))), { delaiMs: 30 });
    clearTimeout(veille);

    // ── 4. le montage : banc = aucun réseau ; production = l'archive à la clé publique ; rien ne se lit au montage
    const cfgBanc = lireConfig({ MONGODB_BASE: 'test_scratch' });
    let appels = 0; const fetchCompte = async (...a) => { appels++; return rep(f.gz)(...a); };
    E.vider(); I.arreterChargeur();
    H.v('banc sans archive : aucun chargeur, aucun réseau', [demarrerPourConfig(cfgBanc, { env: { BANC_ISOLE: '1' }, fetchFn: fetchCompte }), appels], [null, 0]);
    const fichierBanc = path.join(os.tmpdir(), `archive-banc-${process.pid}.rmv.gz`); fs.writeFileSync(fichierBanc, f.gz);
    demarrerPourConfig({ ...cfgBanc, visuels: { ...cfgBanc.visuels, fichierBanc } }, { env: { BANC_ISOLE: '1' }, fetchFn: fetchCompte });
    H.v('banc avec archive locale : installée TOUT DE SUITE (30 visuels), aucun réseau', [E.version() && E.version().comptes.visuels, appels], [30, 0]);
    E.vider(); fs.writeFileSync(fichierBanc, 'abîmée');
    demarrerPourConfig({ ...cfgBanc, visuels: { ...cfgBanc.visuels, fichierBanc } }, { env: { BANC_ISOLE: '1' }, fetchFn: fetchCompte });
    H.v('banc avec archive abîmée : refusée, « sans visuel »', E.version(), null);
    fs.unlinkSync(fichierBanc);
    const cfgProd = lireConfig({ MONGODB_BASE: 'test' });
    const t0 = Date.now(); const c = demarrerPourConfig(cfgProd, { env: {}, fetchFn: fetchCompte });
    H.v('production, source fichier : le montage ne lit RIEN (aucun appel réseau), chargeur démarré', [appels, c !== null, Date.now() - t0 < 100], [0, true, true]);
    const rp = await I.chargeurCourant().charger();
    H.v('   le chargement télécharge l\'archive à la clé publique de la configuration et la charge', [rp.ok, rep.dernier.url, appels, E.version().comptes.visuels], [true, `https://${cfgProd.images.hotesPublics[0]}/${cfgProd.visuels.cle}`, 1, 30]);
    I.arreterChargeur();
    E.vider();
    const cc = demarrerPourConfig(lireConfig({ MONGODB_BASE: 'test', V2_VISUELS_SOURCE: 'calcul' }), { env: {}, fetchFn: fetchCompte });
    H.v('production, source calcul : un chargeur (fil), toujours rien de lu au montage', [cc !== null, appels], [true, 1]);
    I.arreterChargeur();

    // ── 5. le script autonome : refus avant toute connexion, aucun fichier
    const script = path.join(__dirname, '..', 'migrations', 'construire-fichier-visuels.js');
    const sortie = path.join(os.tmpdir(), `sortie-script-${process.pid}.rmv.gz`);
    // EN PROCESSUS, avec un environnement explicite : lancé comme enfant, le script chargerait le .env du dépôt (dotenv) et pourrait toucher une vraie base — un banc ne le fait jamais
    const { principal } = require('../migrations/construire-fichier-visuels');
    const erreurs = []; const ancienne = console.error; console.error = m => erreurs.push(String(m));
    let code1, code2, code3;
    try {
        code1 = await principal(['node', script, `--vers=${sortie}`], {});
        code2 = await principal(['node', script], { MONGODB_CARTES_LECTURE_URI: 'mongodb+srv://lecteur:x@h.exemple.net/cartes' });
        code3 = await principal(['node', script, `--vers=${sortie}`], { MONGODB_CARTES_LECTURE_URI: 'mongodb+srv://u:x@h.exemple.net/cartes', MONGODB_CARTES_URI: 'mongodb+srv://u:y@h.exemple.net/cartes' });
    } finally { console.error = ancienne; }
    H.v('script sans variable de lecture : code 1, refus nommé, AUCUN fichier', [code1, /MONGODB_CARTES_LECTURE_URI/.test(erreurs[0] || ''), fs.existsSync(sortie)], [1, true, false]);
    H.v('script sans --vers : code 1', code2, 1);
    H.v('script avec le même utilisateur en lecture et en écriture : code 1 AVANT toute connexion (aucune adresse n\'existe ici)', [code3, /utilisateur/.test(erreurs[2] || '')], [1, true]);

    // ── 6. serveur enfant : interrupteur éteint = aucune connexion à cartes ; allumé en banc = aucune non plus (écouteur local qui compte)
    await H.ouvrirBancV2();
    let connexions = 0; const ecouteur = net.createServer(sock => { connexions++; sock.destroy(); });
    await new Promise(r => ecouteur.listen(0, '127.0.0.1', r));
    const port = ecouteur.address().port;
    const { demarrer } = require('../../verrou/serveur');
    const base = { VERROU_CHARGES: path.join(__dirname, '..', '..', 'verrou', 'charges.json'), JETON_API: 'jeton-verrou', MONGODB_BASE: 'test_scratch', OPENROUTER_API_KEY: '',
        MONGODB_CARTES_LECTURE_URI: `mongodb://lecteur:x@127.0.0.1:${port}/cartes`, MONGODB_CARTES_URI: `mongodb://ecrivain:x@127.0.0.1:${port}/cartes` };
    for (const [nom, v2] of [['éteinte', ''], ['allumée (banc)', '1']]) {
        const srv = await demarrer(path.join(__dirname, 'faux-reseau-v2.js'), { ...base, RM_API_V2: v2 });
        try { if (!await srv.attendreMongo()) throw new Error('Mongo non connecté'); await attendre(2500); }
        finally { srv.enfant.kill(); }
        H.v(`serveur enfant, v2 ${nom} : aucune connexion à l'adresse de cartes (les deux URI pointent l'écouteur)`, connexions, 0);
    }
    ecouteur.close();
    await H.arreterBanc();
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
