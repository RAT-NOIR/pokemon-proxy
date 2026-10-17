// node test-recepteur-pokemoncom.js — le RÉCEPTEUR passif de pokemon.com (recepteur-pokemoncom.js). Aucun réseau extérieur : un serveur sur un port ÉPHÉMÈRE de 127.0.0.1,
// des relevés fabriqués, un dossier temporaire HORS du dépôt (jamais un dossier du testeur).
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');
const R = require(process.env.PM_RECEPTEUR ? path.resolve(process.env.PM_RECEPTEUR) : './recepteur-pokemoncom');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

const URL_BONNE = 'https://www.pokemon.com/us/pokemon-tcg/pokemon-cards/?cardName=&cardText=&evolvesFrom=&simpleSubmit=&format=unlimited&hitPointsMin=0&hitPointsMax=340&retreatCostMin=0&retreatCostMax=5&totalAttackCostMin=0&totalAttackCostMax=5&particularArtist=&advancedSubmit=&expansion=guardians-rising';
const carte = (n, extra = {}) => ({ nom: `Carte ${n}`, numero: String(n), numeroDoute: false, set: 'sm2', img: `https://assets.pokemon.com/assets/cms2/img/cards/web/SM2/SM2_EN_${n}.png`, alt: `Carte ${n}`, ...extra });
const EXTENSIONS = [{ case: 'sm2', libelle: 'Guardians Rising', cochee: true }, { case: 'sm1', libelle: 'Sun & Moon', cochee: false }];
const SELECTS = [{ nom: 'sort', options: ['Card Number', 'Card Name'] }];
const releve = (extra = {}) => ({ schema: 2, url: URL_BONNE, titre: 'Pokémon Cards | Pokemon.com', filtre: ['Guardians Rising'], compteur: '3 cards', pagination: 'Page 1 of 1', cartes: [carte(1), carte(2), carte(3)], extensions: EXTENSIONS, selects: SELECTS, html: '<div class="results"><img alt="Carte 1"></div>', htmlTronque: false, zoneRepli: false, ...extra });
const cartesN = n => Array.from({ length: n }, (_, i) => carte(i + 1));

const dossierTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recepteur-pm-'));

function envoyer(port, { methode = 'POST', chemin = '/releve', entetes = {}, corps = null, brut = null } = {}) {
    return new Promise(resolve => {
        const donnees = brut ?? (corps == null ? null : JSON.stringify(corps));
        const h = { ...entetes };
        if (donnees != null) h['Content-Length'] = Buffer.byteLength(donnees);
        const req = http.request({ host: '127.0.0.1', port, method: methode, path: chemin, headers: h }, res => {
            const m = [];
            res.on('data', c => m.push(c));
            res.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(m).toString('utf8')); } catch { } resolve({ status: res.statusCode, json: j, entetes: res.headers }); });
        });
        req.on('error', e => resolve({ status: 0, erreur: e.code || e.message }));
        if (donnees != null) req.write(donnees);
        req.end();
    });
}
const BON = { 'Content-Type': 'application/json', 'X-Rat-Market': R.VALEUR_MARQUE };
const sans = (h, cle) => { const c = { ...h }; delete c[cle]; return c; };
const fichiers = () => fs.readdirSync(dossierTmp).sort();

(async () => {
    const journal = [];
    const srv = await R.demarrer({ racine: os.tmpdir(), port: 0, dossier: dossierTmp, journal: m => journal.push(m) });
    const port = srv.port;
    try {
        verifier('le serveur écoute 127.0.0.1 et nulle autre adresse', srv.adresse, '127.0.0.1');

        // ── ce que la garde AUTORISE
        let r = await envoyer(port, { entetes: BON, corps: releve() });
        verifier('relevé valide, SANS Origin : 200, ok, 3 cartes, complet', [r.status, r.json?.ok, r.json?.diagnostic?.cartes, r.json?.diagnostic?.complet], [200, true, 3, true]);
        verifier('deux fichiers écrits : la page et son diagnostic, horodatés, dans le seul dossier prévu', [fichiers().length, fichiers().filter(n => /^page--[a-z0-9-]+--\d{8}T\d{6}Z\.json$/.test(n)).length, fichiers().filter(n => /^diag--[a-z0-9-]+--\d{8}T\d{6}Z\.json$/.test(n)).length], [2, 1, 1]);
        const pageNom = fichiers().find(n => n.startsWith('page--'));
        const f = JSON.parse(fs.readFileSync(path.join(dossierTmp, pageNom), 'utf8'));
        verifier('la page écrite porte le relevé tel que reçu (url, titre, filtre, cartes, html)', [f.url, f.titre, f.filtre, f.cartes.length, f.html], [URL_BONNE, 'Pokémon Cards | Pokemon.com', ['Guardians Rising'], 3, releve().html]);
        const diag = JSON.parse(fs.readFileSync(path.join(dossierTmp, fichiers().find(n => n.startsWith('diag--'))), 'utf8'));
        verifier('le diagnostic : cartes, annonce lue du compteur, complétude, sans numéro, sans image', [diag.cartes, diag.annonce, diag.complet, diag.sansNumero, diag.sansImage], [3, 3, true, 0, 0]);
        verifier('aucun en-tête d\'accès croisé dans la réponse', r.entetes['access-control-allow-origin'], undefined);
        verifier('chaque relevé est imprimé', journal.some(l => /3 carte/.test(l)), true);
        for (const [nom, origine] of [['Origin https://www.pokemon.com', 'https://www.pokemon.com'], ['Origin d\'extension Chrome', 'chrome-extension://abcdefghijklmnop'], ['Origin d\'extension Firefox', 'moz-extension://1234-abcd']]) {
            const x = await envoyer(port, { entetes: { ...BON, Origin: origine }, corps: releve() });
            verifier(`${nom} : acceptée (200)`, x.status, 200);
        }

        // ── page incomplète : le compteur annonce plus de cartes que la page n'en montre → écrite quand même (relevé brut), mais dite incomplète
        const inc = await envoyer(port, { entetes: BON, corps: releve({ compteur: '197 cards', pagination: '' }) });
        verifier('compteur 197, 3 cartes vues, AUCUNE pagination : 200 mais complet=false, etat « incomplet »', [inc.status, inc.json?.diagnostic?.complet, inc.json?.diagnostic?.annonce, inc.json?.diagnostic?.etat], [200, false, 197, 'incomplet']);
        const pagine = await envoyer(port, { entetes: BON, corps: releve({ compteur: '197 cards', pagination: 'Previous Results Next Results' }) });
        verifier('compteur 197, 3 cartes vues, pagination VISIBLE mais sans « N of M » : le compteur est le total, ce n\'est PAS « incomplet » (complet null, etat « pagine », paginationLisible false)', [pagine.status, pagine.json?.diagnostic?.complet, pagine.json?.diagnostic?.etat, pagine.json?.diagnostic?.pagine, pagine.json?.diagnostic?.paginationLisible], [200, null, 'pagine', true, false]);
        const egal = await envoyer(port, { entetes: BON, corps: releve({ compteur: '3 cards', pagination: 'Page 1 of 1' }) });
        verifier('compteur = cartes vues, même paginé : complet true, etat « complet »', [egal.json?.diagnostic?.complet, egal.json?.diagnostic?.etat], [true, 'complet']);
        const illisible = await envoyer(port, { entetes: BON, corps: releve({ compteur: 'rien', pagination: '' }) });
        verifier('compteur illisible : annonce null, complet null, etat « compteur-non-lu »', [illisible.json?.diagnostic?.annonce, illisible.json?.diagnostic?.complet, illisible.json?.diagnostic?.etat], [null, null, 'compteur-non-lu']);
        const repli = await envoyer(port, { entetes: BON, corps: releve({ zoneRepli: true }) });
        verifier('zone de repli (document.body) : marquée dans le diagnostic ET dans la page écrite', [repli.json?.diagnostic?.zoneRepli, JSON.parse(fs.readFileSync(path.join(dossierTmp, repli.json.fichier), 'utf8')).zoneRepli], [true, true]);

        // ── LA PAGINATION RÉELLE (« N of M » dans #cards-load-more) : le texte tel qu'affiché, lu par le récepteur
        const diagP = (pagination, n, extra = {}) => R.diagnostiquer(releve({ pagination, compteur: '', cartes: cartesN(n), ...extra }));
        const pReel = diagP('Previous Results 1 of 15 Next Results', 12);
        verifier('« 1 of 15 » + 12 cartes (le vrai relevé) : page 1 sur 15, complète', [pReel.pageCourante, pReel.pagesTotal, pReel.etat, pReel.complet, pReel.paginationLisible], [1, 15, 'complet', true, true]);
        const pDer = diagP('Previous Results 15 of 15 Next Results', 1);
        verifier('« 15 of 15 » + 1 carte : dernière page, complète', [pDer.pageCourante, pDer.pagesTotal, pDer.etat, pDer.complet], [15, 15, 'complet', true]);
        const pInc = diagP('Previous Results 3 of 15 Next Results', 7);
        verifier('« 3 of 15 » + 7 cartes : incomplète', [pInc.pageCourante, pInc.etat, pInc.complet], [3, 'incomplet', false]);
        verifier('dernière page avec 13 cartes (plus que la taille observée) : incomplète ; avec 0 carte : incomplète', [diagP('15 of 15', 13).complet, diagP('15 of 15', 0).complet], [false, false]);
        verifier('page 2 sur 15 avec 12 cartes : complète ; avec 11 : incomplète', [diagP('2 of 15', 12).complet, diagP('2 of 15', 11).complet], [true, false]);
        for (const [nom, texte] of [['aucun motif', 'Previous Results Next Results'], ['N > M', '16 of 15'], ['N = 0', '0 of 15'], ['M absurde (5 chiffres)', '1 of 99999'], ['M au-delà de la borne saine (6000)', '1 of 6000'], ['vide', ''], ['sans le mot of', '1 / 15']]) {
            const x = R.diagnostiquer(releve({ pagination: texte, compteur: '', cartes: cartesN(12) }));
            verifier(`pagination illisible (${nom}) : pageCourante et pagesTotal null, paginationLisible false`, [x.pageCourante, x.pagesTotal, x.paginationLisible], [null, null, false]);
        }
        const sansPage = R.diagnostiquer(releve({ pagination: '', compteur: '12 cards', cartes: cartesN(12) }));
        verifier('pas de pagination lisible : comme avant (compteur = cartes -> complet)', [sansPage.etat, sansPage.complet, sansPage.pageCourante], ['complet', true, null]);
        const rP = await envoyer(port, { entetes: BON, corps: releve({ pagination: 'Previous Results 1 of 15 Next Results', compteur: '', cartes: cartesN(12) }) });
        verifier('par HTTP : « 1 of 15 » + 12 cartes -> page 1/15, complète, 2 extensions, 1 select', [rP.status, rP.json?.diagnostic?.pageCourante, rP.json?.diagnostic?.pagesTotal, rP.json?.diagnostic?.complet, rP.json?.diagnostic?.extensions, rP.json?.diagnostic?.selects], [200, 1, 15, true, 2, 1]);

        const bornes = await envoyer(port, { entetes: BON, corps: releve({ extensions: Array.from({ length: 500 }, (_, i) => ({ case: `c${i}`, libelle: 'x'.repeat(200), cochee: i % 2 === 0 })), selects: Array.from({ length: 30 }, () => ({ nom: 's'.repeat(100), options: Array.from({ length: 100 }, () => 'o'.repeat(200)) })) }) });
        verifier('exactement aux bornes (500 extensions de 200 car., 30 select de 100 options de 200 car.) : accepté', bornes.status, 200);

        // ── NUMÉRO DE CARTE : « 124a » et « SV001 » passent tels quels ; un doute exige numero et set vides
        const lettres = await envoyer(port, { entetes: BON, corps: releve({ cartes: [carte(1, { numero: '124a', set: 'sm2' }), carte(2, { numero: 'SV001', set: 'sv1' }), carte(3, { numero: 'TG01', set: 'swsh9' })] }) });
        verifier('numéros « 124a », « SV001 », « TG01 » acceptés tels quels', [lettres.status, lettres.json?.diagnostic?.numerosDoutes, lettres.json?.diagnostic?.sansNumero], [200, 0, 0]);
        const doute = await envoyer(port, { entetes: BON, corps: releve({ cartes: [carte(1, { numero: '', set: '', numeroDoute: true }), carte(2)] }) });
        verifier('une carte numeroDoute (numero et set vides) : acceptée, comptée', [doute.status, doute.json?.diagnostic?.numerosDoutes, doute.json?.diagnostic?.sansNumero], [200, 1, 1]);

        // ── LE NOM DE FICHIER : le slug vient de l'adresse reçue ; chaque cas hostile donne un nom sûr, strictement dans le dossier d'écriture
        const BASE = 'https://www.pokemon.com/us/pokemon-tcg/pokemon-cards/?expansion=';
        const hostiles = [['..\\..\\x', '..%5C..%5Cx'], ['../x', '..%2Fx'], ['chemin absolu', '%2Fetc%2Fpasswd'], ['lecteur absolu', 'C%3A%5CWindows%5Cx'], ['octet NUL', 'a%00b'], ['seulement des points', '..'], ['vide', ''], ['très long', 'a'.repeat(500)], ['majuscules et espaces', 'Guardians%20Rising%21']];
        const dejaH = new Set(fichiers());
        for (const [nom, valeur] of hostiles) {
            const slug = R.slugDe(BASE + valeur);
            verifier(`slug (${nom}) : [a-z0-9-] seulement, 1 à 40 caractères, ni point ni séparateur`, /^[a-z0-9-]{1,40}$/.test(slug), true);
            const x = await envoyer(port, { entetes: BON, corps: releve({ url: BASE + valeur }) });
            verifier(`écriture (${nom}) : 200`, x.status, 200);
        }
        const nouveauxH = fichiers().filter(n => !dejaH.has(n));
        verifier('… deux fichiers par cas hostile, tous nommés page--/diag--<slug sûr>--<date>.json, tous DIRECTEMENT dans le dossier', [nouveauxH.length, nouveauxH.every(n => /^(page|diag)--[a-z0-9-]{1,40}--\d{8}T\d{6}Z(-\d+)?\.json$/.test(n)), nouveauxH.every(n => path.dirname(path.resolve(dossierTmp, n)) === path.resolve(dossierTmp))], [hostiles.length * 2, true, true]);
        verifier('… et rien n\'a été écrit au-dessus du dossier (aucun fichier voisin créé)', fs.readdirSync(path.dirname(dossierTmp)).filter(n => /^(page|diag)--/.test(n)).length, 0);
        const sn = await envoyer(port, { entetes: BON, corps: releve({ cartes: [carte(1, { numero: '' }), carte(2, { img: '' })], compteur: '2 results' }) });
        verifier('cartes sans numéro / sans image comptées', [sn.json?.diagnostic?.sansNumero, sn.json?.diagnostic?.sansImage], [1, 1]);

        // ── ce qu'elle REFUSE, chaque refus pris SEUL : rien d'écrit
        const avant = fichiers().length;
        const refus = async (nom, o, statut, motif = null) => {
            const x = await envoyer(port, o);
            verifier(`${nom} : refusé (${statut}${motif ? `, motif ${motif}` : ''}), rien d'écrit`, [x.status, motif ? motif.test(x.json?.motif || '') : true, fichiers().length === avant], [statut, true, true]);
            return x;
        };
        await refus('une autre Origin web', { entetes: { ...BON, Origin: 'https://exemple.test' }, corps: releve() }, 403, /Origin/);
        await refus('l\'origine sans www (pokemon.com)', { entetes: { ...BON, Origin: 'https://pokemon.com' }, corps: releve() }, 403, /Origin/);
        await refus('Origin « null »', { entetes: { ...BON, Origin: 'null' }, corps: releve() }, 403, /Origin/);
        await refus('Origin avec suffixe (www.pokemon.com.evil.test)', { entetes: { ...BON, Origin: 'https://www.pokemon.com.evil.test' }, corps: releve() }, 403, /Origin/);
        await refus('Origin en http', { entetes: { ...BON, Origin: 'http://www.pokemon.com' }, corps: releve() }, 403, /Origin/);
        await refus('en-tête X-Rat-Market absent', { entetes: sans(BON, 'X-Rat-Market'), corps: releve() }, 403, /x-rat-market/);
        await refus('Host étranger (DNS rebinding)', { entetes: { ...BON, Host: 'evil.test' }, corps: releve() }, 403, /Host/);
        await refus('Content-Type absent', { entetes: sans(BON, 'Content-Type'), corps: releve() }, 415);
        await refus('Content-Type text/plain', { entetes: { ...BON, 'Content-Type': 'text/plain' }, corps: releve() }, 415);
        await refus('méthode GET', { methode: 'GET', entetes: BON }, 405);
        const opt = await refus('méthode OPTIONS (prévol)', { methode: 'OPTIONS', entetes: { Origin: 'https://exemple.test', 'Access-Control-Request-Method': 'POST' } }, 405);
        verifier('… sans en-tête CORS dans la réponse', [opt.entetes['access-control-allow-origin'], opt.entetes['access-control-allow-private-network']], [undefined, undefined]);
        await refus('chemin /autre', { chemin: '/autre', entetes: BON, corps: releve() }, 404);
        await refus('chemin /releve?x=1', { chemin: '/releve?x=1', entetes: BON, corps: releve() }, 404);
        await refus('chemin /releve/', { chemin: '/releve/', entetes: BON, corps: releve() }, 404);
        // schéma
        await refus('JSON illisible', { entetes: BON, brut: '{pas du json' }, 400);
        await refus('corps tableau', { entetes: BON, brut: '[1]' }, 400, /objet/);
        await refus('clé en trop (cookie)', { entetes: BON, corps: { ...releve(), cookie: 'a=b' } }, 400, /clés/);
        await refus('clé manquante (html)', { entetes: BON, corps: (() => { const o = releve(); delete o.html; return o; })() }, 400, /clés/);
        await refus('schema 1 (userscript 1.0) : motif clair qui dit de réinstaller', { entetes: BON, corps: (() => { const o = releve({ schema: 1 }); delete o.extensions; delete o.selects; o.cartes = o.cartes.map(c => { const d = { ...c }; delete d.numeroDoute; return d; }); return o; })() }, 400, /schema 1 refusé.*réinstalle/);
        await refus('schema 1 même avec les clés du schema 2', { entetes: BON, corps: releve({ schema: 1 }) }, 400, /schema 1 refusé/);
        await refus('schema 3 (inconnu)', { entetes: BON, corps: releve({ schema: 3 }) }, 400, /schema inconnu/);
        await refus('schema absent', { entetes: BON, corps: (() => { const o = releve(); delete o.schema; return o; })() }, 400, /schema/);
        await refus('carte sans numeroDoute', { entetes: BON, corps: releve({ cartes: [(() => { const c = carte(1); delete c.numeroDoute; return c; })()] }) }, 400, /carte/);
        await refus('numeroDoute pas un booléen', { entetes: BON, corps: releve({ cartes: [carte(1, { numeroDoute: 'oui' })] }) }, 400, /numeroDoute/);
        await refus('numeroDoute vrai MAIS un numéro posé (une devinette)', { entetes: BON, corps: releve({ cartes: [carte(1, { numeroDoute: true })] }) }, 400, /douteux/);
        await refus('extensions absentes', { entetes: BON, corps: (() => { const o = releve(); delete o.extensions; return o; })() }, 400, /clés/);
        await refus('extensions pas un tableau', { entetes: BON, corps: releve({ extensions: 'x' }) }, 400, /extensions/);
        await refus('plus de 500 extensions', { entetes: BON, corps: releve({ extensions: Array.from({ length: 501 }, (_, i) => ({ case: `c${i}`, libelle: 'x', cochee: false })) }) }, 400, /extensions/);
        await refus('extension avec une clé en plus', { entetes: BON, corps: releve({ extensions: [{ case: 'a', libelle: 'b', cochee: true, value: 'x' }] }) }, 400, /extension 0/);
        await refus('libellé d\'extension de 201 caractères', { entetes: BON, corps: releve({ extensions: [{ case: 'a', libelle: 'b'.repeat(201), cochee: true }] }) }, 400, /extension 0/);
        await refus('cochee pas un booléen', { entetes: BON, corps: releve({ extensions: [{ case: 'a', libelle: 'b', cochee: 'oui' }] }) }, 400, /extension 0/);
        await refus('plus de 30 select', { entetes: BON, corps: releve({ selects: Array.from({ length: 31 }, () => ({ nom: 's', options: [] })) }) }, 400, /selects/);
        await refus('plus de 100 options dans un select', { entetes: BON, corps: releve({ selects: [{ nom: 's', options: Array.from({ length: 101 }, () => 'o') }] }) }, 400, /select 0/);
        await refus('option de 201 caractères', { entetes: BON, corps: releve({ selects: [{ nom: 's', options: ['o'.repeat(201)] }] }) }, 400, /select 0/);
        await refus('select avec une clé en plus', { entetes: BON, corps: releve({ selects: [{ nom: 's', options: [], valeur: 'x' }] }) }, 400, /select 0/);
        await refus('url d\'un autre site', { entetes: BON, corps: releve({ url: 'https://exemple.test/us/pokemon-tcg/pokemon-cards' }) }, 422, /adresse/);
        await refus('url pokemon.com hors de la base de cartes', { entetes: BON, corps: releve({ url: 'https://www.pokemon.com/us/pokemon-tcg/' }) }, 422, /adresse/);
        await refus('url en http', { entetes: BON, corps: releve({ url: 'http://www.pokemon.com/us/pokemon-tcg/pokemon-cards/' }) }, 422, /adresse/);
        await refus('url avec identifiants', { entetes: BON, corps: releve({ url: 'https://u:p@www.pokemon.com/us/pokemon-tcg/pokemon-cards/' }) }, 422, /adresse/);
        await refus('url sur un hôte à suffixe', { entetes: BON, corps: releve({ url: 'https://www.pokemon.com.evil.test/us/pokemon-tcg/pokemon-cards/' }) }, 422, /adresse/);
        await refus('titre pas une chaîne', { entetes: BON, corps: releve({ titre: 4 }) }, 400, /titre/);
        await refus('filtre pas un tableau de chaînes', { entetes: BON, corps: releve({ filtre: [1] }) }, 400, /filtre/);
        await refus('cartes pas un tableau', { entetes: BON, corps: releve({ cartes: 'x' }) }, 400, /cartes/);
        await refus('carte avec une clé en plus', { entetes: BON, corps: releve({ cartes: [carte(1, { cookie: 'x' })] }) }, 400, /carte/);
        await refus('carte dont l\'image n\'est pas en https', { entetes: BON, corps: releve({ cartes: [carte(1, { img: 'javascript:alert(1)' })] }) }, 400, /image/);
        await refus('plus de 1000 cartes', { entetes: BON, corps: releve({ cartes: Array.from({ length: 1001 }, (_, i) => carte(i)) }) }, 400, /cartes/);
        await refus('html trop long (> HTML_MAX)', { entetes: BON, corps: releve({ html: 'x'.repeat(R.HTML_MAX + 1) }) }, 400, /html/);
        await refus('htmlTronque pas un booléen', { entetes: BON, corps: releve({ htmlTronque: 'oui' }) }, 400, /htmlTronque/);
        await refus('zoneRepli pas un booléen', { entetes: BON, corps: releve({ zoneRepli: 'oui' }) }, 400, /zoneRepli/);

        // ── un corps trop gros
        const nAvantGros = fichiers().length;
        const vivant = async () => (await envoyer(port, { methode: 'GET', entetes: BON })).status === 405;
        const gros = await envoyer(port, { entetes: BON, brut: 'x'.repeat(R.CORPS_MAX_OCTETS + 1) });
        verifier('corps de CORPS_MAX_OCTETS + 1 : 413 exact, ou coupure avec rien d\'écrit ET le récepteur répond encore', [gros.status === 413 || (gros.status === 0 && fichiers().length === nAvantGros && await vivant()), fichiers().length === nAvantGros], [true, true]);

        // ── un second relevé de la même page : deux fichiers de plus, les premiers intacts
        const n2 = fichiers().length;
        await new Promise(res => setTimeout(res, 1100));
        await envoyer(port, { entetes: BON, corps: releve() });
        verifier('le même relevé une seconde fois : deux fichiers de plus', fichiers().length, n2 + 2);
    } finally { await srv.fermer(); }

    // ── le plafond est une option, compté sur la déclaration ET sur le flux
    const petit = await R.demarrer({ racine: os.tmpdir(), port: 0, dossier: dossierTmp, maxOctets: 300, journal: () => { } });
    const nPetit = fichiers().length;
    const p = await envoyer(petit.port, { entetes: BON, corps: releve() });
    verifier('plafond abaissé à 300 octets : 413 (Content-Length déclaré), rien d\'écrit', [p.status, fichiers().length === nPetit], [413, true]);
    const chunk = await new Promise(resolve => {
        const req = http.request({ host: '127.0.0.1', port: petit.port, method: 'POST', path: '/releve', headers: { ...BON } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
        req.on('error', e => resolve(e.code || 0));
        req.write(JSON.stringify(releve())); req.end();
    });
    verifier('corps en morceaux au-dessus du plafond : 413 ou coupure, rien d\'écrit', [chunk === 413 || chunk === 0 || chunk === 'ECONNRESET', fichiers().length === nPetit], [true, true]);
    await petit.fermer();

    // ── l'hôte d'écoute n'est pas réglable
    verifier('demarrer ignore une option « hote » (jamais 0.0.0.0)', await (async () => { const s = await R.demarrer({ racine: os.tmpdir(), port: 0, dossier: dossierTmp, hote: '0.0.0.0', journal: () => { } }); const a = s.adresse; await s.fermer(); return a; })(), '127.0.0.1');

    // ── ÉCRITURE DANS LE SEUL DOSSIER PRÉVU : un dossier dans le dépôt, hors racine, ou d'apports manuels refuse le démarrage
    let leve = null; try { await R.demarrer({ racine: os.tmpdir(), port: 0, dossier: path.join(__dirname, 'pm-test'), journal: () => { } }); } catch (e) { leve = e.message; }
    verifier('un dossier DANS le dépôt : démarrage refusé, rien créé', [/dépôt/.test(leve || ''), fs.existsSync(path.join(__dirname, 'pm-test'))], [true, false]);
    leve = null; try { await R.demarrer({ racine: dossierTmp, port: 0, dossier: path.join(os.tmpdir(), 'pm-hors-racine-' + process.pid), journal: () => { } }); } catch (e) { leve = e.message; }
    verifier('un dossier HORS de la racine autorisée : démarrage refusé', /racine autorisée/.test(leve || ''), true);
    leve = null; const apports = path.join(dossierTmp, 'Logo FR'); try { await R.demarrer({ racine: dossierTmp, port: 0, dossier: apports, journal: () => { } }); } catch (e) { leve = e.message; }
    verifier('un dossier nommé comme un dossier d\'apports manuels : refusé, rien créé', [/apports manuels/.test(leve || ''), fs.existsSync(apports)], [true, false]);
    verifier('le dossier par défaut est sous la racine du chantier et n\'est pas un dossier d\'apports', [R.dansRacineAutorisee(R.DOSSIER_DEFAUT), R.dansApportsManuels(R.DOSSIER_DEFAUT), path.basename(R.DOSSIER_DEFAUT)], [true, false, 'pokemoncom-passif']);

    // ── la ligne de commande : un argument inconnu refuse avant tout (code 2)
    const cli = args => spawnSync(process.execPath, [path.join(__dirname, 'recepteur-pokemoncom.js'), ...args], { encoding: 'utf8', timeout: 15000 });
    for (const a of [['--hote=0.0.0.0'], ['--port=abc'], ['--port=80'], ['--inconnu'], ['--dossier=']]) verifier(`CLI ${a.join(' ')} : refusé, code 2`, cli(a).status, 2);

    fs.rmSync(dossierTmp, { recursive: true, force: true });
    console.log(`\n${ok} réussis, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ banc interrompu :', e); process.exit(1); });
