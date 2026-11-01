// Banc de collecte-cartes/wikidata-especes.js et de recolter-wikidata-especes.js. Aucun réseau, aucune base.
// Les JSON d'entité de fixtures-wikidata/ sont de VRAIES réponses de https://www.wikidata.org/wiki/Special:EntityData/<Q>.json lues le 2026-10-31 (5 requêtes de développement),
// réduites par reduireEntite (cinq entités consécutives de la chaîne nationale : Ekans 23, Arbok 24, Pikachu 25, Raichu 26, Sandshrew 27). Les cas de défaut sont des MUTATIONS de ces réponses réelles.
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const W = require('./collecte-cartes/wikidata-especes');
const TZ = require('./collecte-cartes/table-zh');
let ok = 0, ko = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log('  ok  ' + nom); } catch (e) { ko++; console.log('  ECHEC ' + nom + '\n        ' + String(e.stack || e.message).split('\n').slice(0, 3).join('\n        ')); } };
const FX = path.join(__dirname, 'fixtures-wikidata');
const fx = q => JSON.parse(fs.readFileSync(path.join(FX, q + '.json'), 'utf8'));
const clone = o => JSON.parse(JSON.stringify(o));
const NAT = W.NATIONAL;
const DEX = { pikachu: [25], raichu: [26], arbok: [24], ekans: [23], sandshrew: [27], heracross: [214] };
const CHAINE = { Q1266064: 23, Q1289969: 24, Q9351: 25, Q1647331: 26, Q2002398: 27 };
const stmtNat = e => Object.values(e.entities)[0].claims.P1685.find(s => s.qualifiers.P972.some(x => x.datavalue.value.id === NAT));

// un faux client qui sert les fixtures (ou une version mutée) et compte les lectures
function fauxLire(mutes = {}, { arret = null } = {}) {
    const lectures = [];
    const lire = async q => {
        lectures.push(q);
        if (arret && lectures.length === arret.apres + 1) throw Object.assign(new Error('www.wikidata.org BLOQUÉ (HTTP 429)'), { bloque: true, hote: 'www.wikidata.org' });
        if (mutes[q]) return { json: mutes[q] };
        if (CHAINE[q]) return { json: fx(q) };
        return { absente: true };
    };
    return { lire, lectures };
}
const dossierTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wd-'));

(async () => {
    await t('lireEntite : l\'entité vraie de Pikachu donne son n° NATIONAL (25), ses voisins P155/P156, son nom anglais et ses libellés zh (dont zh-mo)', () => {
        const r = W.lireEntite(fx('Q9351'), 'Q9351');
        assert.strictEqual(r.ok, true);
        assert.strictEqual(r.n, 25);
        assert.strictEqual(r.prev, 'Q1289969');
        assert.strictEqual(r.next, 'Q1647331');
        assert.strictEqual(r.en, 'Pikachu');
        assert.strictEqual(r.labels['zh-mo'], '比卡超');
        assert.strictEqual(r.labels['zh-hant'], '皮卡丘');
    });
    await t('lireEntite : les numéros régionaux (R-023, 156, 022…) ne sont JAMAIS pris pour le national — il faut le catalogue P972 national', () => {
        const j = clone(fx('Q9351')); const s = stmtNat(j);
        s.qualifiers.P972 = [{ datavalue: { value: { id: 'Q18086661' } } }];   // le même « 025 », mais d'un autre Pokédex
        const r = W.lireEntite(j, 'Q9351');
        assert.strictEqual(r.ok, false);
        assert.match(r.raison, /national/i);
    });
    await t('lireEntite : deux numéros nationaux contradictoires sur une entité = refus (jamais arbitré)', () => {
        const j = clone(fx('Q9351')); const e = Object.values(j.entities)[0]; const s2 = clone(stmtNat(j)); s2.mainsnak.datavalue.value = '099'; e.claims.P1685.push(s2);
        const r = W.lireEntite(j, 'Q9351');
        assert.strictEqual(r.ok, false);
        assert.match(r.raison, /plusieurs|2 /);
    });
    await t('lireEntite : une réponse dont la clé n\'est pas l\'entité demandée (redirection fusionnée) est refusée, pas suivie', () => {
        const j = fx('Q9351');
        const r = W.lireEntite(j, 'Q1');
        assert.strictEqual(r.ok, false);
        assert.match(r.raison, /Q1|redirig|absente/);
    });
    await t('reduireEntite : garde l\'essentiel (national, labels zh/en), jette le reste ; lireEntite rend la même chose sur la réponse brute et réduite', () => {
        const brut = fs.readFileSync(path.join(FX, 'brut-Q1289969.json'), 'utf8');
        const red = W.reduireEntite(brut, 'Q1289969');
        assert.ok(red.length < brut.length / 3, `réduite ${red.length} contre brute ${brut.length}`);
        assert.deepStrictEqual(W.lireEntite(red, 'Q1289969'), W.lireEntite(brut, 'Q1289969'));
        assert.strictEqual(W.lireEntite(red, 'Q1289969').n, 24);
        assert.ok(!/"P373"|"P646"/.test(red));
    });
    await t('verifierGraine : Pikachu vérifié PAR LUI-MÊME (n° national lu + nom anglais qui donne le même n° dans pokedex-dexids) ; un nom qui donne un autre n° ou aucun n° REFUSE la graine', () => {
        const e = W.lireEntite(fx('Q9351'), 'Q9351');
        assert.strictEqual(W.verifierGraine(e, DEX).ok, true);
        assert.strictEqual(W.verifierGraine(e, { pikachu: [26] }).ok, false);
        assert.strictEqual(W.verifierGraine(e, {}).ok, false);
        assert.match(W.verifierGraine(e, {}).raison, /graine/i);
    });
    await t('controlerPas : le voisin P156 de Pikachu doit être le n° 26 ; un autre numéro, ou un nom anglais qui contredit le n°, ne passe pas', () => {
        const rai = W.lireEntite(fx('Q1647331'), 'Q1647331');
        assert.strictEqual(W.controlerPas(rai, { attendu: 26, dexids: DEX }).ok, true);
        const faux = W.controlerPas(rai, { attendu: 27, dexids: DEX });
        assert.strictEqual(faux.ok, false);
        assert.match(faux.raison, /ne colle pas/);
        assert.strictEqual(W.controlerPas(rai, { attendu: 26, dexids: { raichu: [99] } }).ok, false);   // nom connu mais contredit
        assert.strictEqual(W.controlerPas(rai, { attendu: 26, dexids: {} }).labelControle, 'inconnu');  // nom inconnu : le chaînage seul répond, et c'est écrit
        assert.strictEqual(W.controlerPas(rai, { attendu: 26, dexids: DEX }).labelControle, 'oui');
    });
    await t('marcher : de la graine vraie, les deux sens, 5 entités vraies lues (23 à 27), chaque pas vérifié ; les entités hors fixtures sont des RUPTURES nommées, pas des devinettes', async () => {
        const { lire, lectures } = fauxLire();
        const r = await W.marcher({ lire, graine: 'Q9351', dexids: DEX, maxDex: 27 });
        assert.deepStrictEqual(Object.keys(r.etat.lus).map(Number).sort((a, b) => a - b), [23, 24, 25, 26, 27]);
        assert.strictEqual(lectures.length, 5 + 2);   // 5 vraies + les deux voisins extrêmes (22 et 28) qui répondent « absente »
        assert.ok(r.etat.ruptures.length >= 2);
        assert.ok(r.etat.ruptures.every(x => x.raison));
        assert.notStrictEqual(r.code, 0);   // la chaîne n'a pas atteint ses extrémités (1 et maxDex) : ce n'est PAS un succès
        assert.match(r.message, /rupture/i);
    });
    await t('marcher : une entité dont le numéro ne colle pas n\'entre PAS dans la table et le dit (mutation : Raichu avec le n° 99)', async () => {
        const m = clone(fx('Q1647331')); stmtNat(m).mainsnak.datavalue.value = '099';
        const { lire } = fauxLire({ Q1647331: m });
        const r = await W.marcher({ lire, graine: 'Q9351', dexids: DEX, maxDex: 27 });
        assert.strictEqual(r.etat.lus[26], undefined);
        assert.strictEqual(r.etat.lus[27], undefined);   // on ne passe pas par-dessus
        assert.ok(r.etat.rejets.some(x => x.q === 'Q1647331' && /ne colle pas/.test(x.raison)));
    });
    await t('marcher : un pointeur absent n\'est PAS une extrémité tant que n n\'est ni 1 ni maxDex : rupture nommée, et la marche continue par l\'autre sens', async () => {
        const m = clone(fx('Q1647331')); delete stmtNat(m).qualifiers.P156;
        const { lire } = fauxLire({ Q1647331: m });
        const r = await W.marcher({ lire, graine: 'Q9351', dexids: DEX, maxDex: 1025 });
        assert.ok(r.etat.lus[26]);
        assert.strictEqual(r.etat.lus[27], undefined);
        assert.ok(r.etat.lus[24] && r.etat.lus[23]);   // l'autre sens a été fait
        assert.ok(r.etat.ruptures.some(x => x.n === 27 && /aucun suivant/.test(x.raison)));
    });
    await t('marcher : ORDRE — une priorité en dessous de la graine fait descendre d\'abord ; une priorité au-dessus fait monter d\'abord', async () => {
        let f = fauxLire();
        await W.marcher({ lire: f.lire, graine: 'Q9351', dexids: DEX, maxDex: 27, priorites: [{ dex: 23 }] });
        assert.deepStrictEqual(f.lectures.slice(0, 3), ['Q9351', 'Q1289969', 'Q1266064']);
        f = fauxLire();
        await W.marcher({ lire: f.lire, graine: 'Q9351', dexids: DEX, maxDex: 27, priorites: [{ dex: 27 }] });
        assert.deepStrictEqual(f.lectures.slice(0, 3), ['Q9351', 'Q1647331', 'Q2002398']);
    });
    await t('marcher : le JALON est signalé dès que TOUTES les priorités sont lues (et pas avant), avec le libellé de la source comparé aux libellés Wikidata', async () => {
        const jalons = [];
        const { lire } = fauxLire();
        const r = await W.marcher({ lire, graine: 'Q9351', dexids: DEX, maxDex: 27, priorites: [{ dex: 25, noms: ['比卡超'], sets: ['Gem Pack Vol. 5'] }, { dex: 27, noms: ['穿山鼠'], sets: ['x'] }, { dex: 24, noms: ['不存在'], sets: ['y'] }], jalon: j => jalons.push(j) });
        assert.strictEqual(jalons.length, 1);
        const j = jalons[0];
        assert.deepStrictEqual(j.especes.map(e => e.dex), [24, 25, 27]);
        const par = Object.fromEntries(j.especes.map(e => [e.dex, e]));
        assert.strictEqual(par[25].concordance, 'oui');   // 比卡超 est le zh-mo de Pikachu
        assert.strictEqual(par[27].concordance, 'oui');
        assert.strictEqual(par[24].concordance, 'non');   // « 不存在 » n'est pas un libellé d'Arbok : écrit, pas masqué
        assert.ok(r.etat.lus[25]);
    });
    await t('marcher : REPRISE — une entité déjà lue ne se redemande pas (état relu depuis le fichier)', async () => {
        const dir = dossierTmp(); const fichier = path.join(dir, 'etat.json');
        const f1 = fauxLire();
        await W.marcher({ lire: f1.lire, graine: 'Q9351', dexids: DEX, maxDex: 27, ecrire: etat => fs.writeFileSync(fichier, JSON.stringify(etat)) });
        const f2 = fauxLire();
        const r2 = await W.marcher({ lire: f2.lire, graine: 'Q9351', dexids: DEX, maxDex: 27, etatInitial: JSON.parse(fs.readFileSync(fichier, 'utf8')) });
        assert.strictEqual(f2.lectures.length, 0, 'lectures à la reprise : ' + f2.lectures.join(','));
        assert.strictEqual(Object.keys(r2.etat.lus).length, 5);
    });
    await t('marcher : le premier arrêt d\'hôte (403/429/défi) arrête TOUT avec un code non nul et un message clair ; ce qui est déjà lu reste écrit', async () => {
        const ecrits = [];
        const f = fauxLire({}, { arret: { apres: 2 } });
        const r = await W.marcher({ lire: f.lire, graine: 'Q9351', dexids: DEX, maxDex: 27, ecrire: e => ecrits.push(Object.keys(e.lus).length) });
        assert.strictEqual(r.code, 3);
        assert.match(r.message, /ARRÊT.*HÔTE|BLOQUÉ/i);
        assert.strictEqual(f.lectures.length, 3);   // aucune requête de plus après le refus
        assert.ok(ecrits.length >= 2);
        assert.ok(Object.keys(r.etat.lus).length >= 2);
    });
    await t('marcher : une graine qui ne se vérifie pas ARRÊTE avant toute marche (code 5), rien n\'entre dans la table', async () => {
        const f = fauxLire();
        const r = await W.marcher({ lire: f.lire, graine: 'Q9351', dexids: { pikachu: [99] }, maxDex: 27 });
        assert.strictEqual(r.code, 5);
        assert.strictEqual(f.lectures.length, 1);
        assert.deepStrictEqual(r.etat.lus, {});
    });
    await t('sortie : le fichier est lisible par lireEspecesWikidata (libellés zh-hk/hant/hans/mo…, licence CC0, date) et fusionnable avec PokeAPI sans contradiction sur ces 5 espèces', async () => {
        const { lire } = fauxLire();
        const r = await W.marcher({ lire, graine: 'Q9351', dexids: DEX, maxDex: 27 });
        const sortie = W.construireSortie(r.etat, { luLe: '2026-10-31' });
        const w = TZ.lireEspecesWikidata(sortie, { licence: 'CC0', luLe: '2026-10-31' });
        assert.strictEqual(w.table['比卡超'], 'D25');
        assert.strictEqual(w.table['皮卡丘'], 'D25');
        assert.strictEqual(w.table['雷丘'], 'D26');
        assert.strictEqual(w.table['阿柏怪'], 'D24');
        const csv = 'pokemon_species_id,local_language_id,name,genus\n25,4,皮卡丘,x\n26,4,雷丘,x\n';
        assert.strictEqual(TZ.fusionnerEspeces(TZ.lireEspecesPokeApi(csv).table, w.table).stats.contradictions, 0);
        assert.strictEqual(sortie.meta.licence, 'CC0');
    });
    await t('le script autonome : garde de l\'hôte consultée (arrêt écrit = aucune requête), robots lu, hôte unique www.wikidata.org, aucun sparql / api.php / wikipedia dans la table d\'hôtes', () => {
        const src = fs.readFileSync(path.join(__dirname, 'recolter-wikidata-especes.js'), 'utf8');
        assert.ok(/garderHote/.test(src) && /initialiserRobots/.test(src));
        assert.ok(/'www\.wikidata\.org'/.test(src));
        const hotes = /hotes:\s*\{[^}]*\}[^}]*\}/.exec(src);
        assert.ok(hotes, 'table d\'hôtes lisible');
        assert.ok(!/sparql|api\.php|wikipedia/i.test(hotes[0]));
        const re = W.CHEMIN_AUTORISE;
        assert.ok(re.test('/wiki/Special:EntityData/Q9351.json') && re.test('/robots.txt'));
        for (const mauvais of ['/w/api.php', '/sparql', '/wiki/Special:EntityData/Q9351', '/wiki/Q9351', '/wiki/Special:Search']) assert.ok(!re.test(mauvais), mauvais);
        assert.ok(!/@[a-z0-9-]+\.[a-z]/i.test(require('./collecte-cartes/recolte-hote').UA), 'pas d\'adresse e-mail dans le User-Agent');
    });
    // ---- le script de bout en bout, avec le VRAI client poli du dépôt et un transport factice (aucun réseau) ----
    const ROBOTS = JSON.parse(fs.readFileSync(path.join(FX, 'robots-www.wikidata.org.json'), 'utf8')).texte;
    const { main } = require('./recolter-wikidata-especes');
    const rep = (status, texte, type = 'application/json; charset=UTF-8') => ({ status, type, texte });
    function transportFactice(f) { const urls = []; return { urls, get: async url => { urls.push(url); return f(url, urls.length); } }; }
    const cli = async (extra, transport, dirs = { sortie: dossierTmp(), pauses: dossierTmp() }) => {
        const garde = console.error; console.error = () => {};   // le bandeau d'arrêt est volontairement bruyant
        const loguer = console.log; console.log = () => {};
        try { const code = await main([`--sortie=${dirs.sortie}`, ...extra], { transport, dossierPauses: dirs.pauses, pause: async () => {} }); return { code, ...dirs }; }
        finally { console.error = garde; console.log = loguer; }
    };
    const servir = (reponseEntite) => (url, n) => /robots\.txt$/.test(url) ? rep(200, ROBOTS, 'text/plain; charset=utf-8') : reponseEntite(url.match(/(Q\d+)\.json/)[1], n);

    await t('script : le premier 403 écrit l\'ARRÊT DÉFINITIF de l\'hôte (RH.arretHote), code 3, ce qui est lu reste écrit ; un second lancement ne fait AUCUNE requête', async () => {
        const tr = transportFactice(servir((q, n) => (q === 'Q9351' ? rep(200, fs.readFileSync(path.join(FX, 'Q9351.json'), 'utf8')) : rep(403, '<html>forbidden</html>', 'text/html'))));
        const r1 = await cli(['--plafond=50'], tr);
        assert.strictEqual(r1.code, 3);
        assert.ok(fs.existsSync(path.join(r1.pauses, 'ARRET-HOTE-wikidata.org.json')), 'arrêt durable écrit');
        for (const u of tr.urls) assert.ok(/^https:\/\/www\.wikidata\.org\/(robots\.txt|wiki\/Special:EntityData\/Q\d+\.json)$/.test(u), u);
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(r1.sortie, 'especes-zh.json'), 'utf8')).results.bindings.length, 1);
        const avant = tr.urls.length;
        const r2 = await cli(['--plafond=50'], tr, r1);
        assert.strictEqual(r2.code, 3);
        assert.strictEqual(tr.urls.length, avant, 'aucune requête après un arrêt');
    });
    await t('script : un robots.txt qui interdit le chemin d\'entité = code 2 et AUCUNE requête d\'entité', async () => {
        const tr = transportFactice(servir(() => { throw new Error('requête d\'entité interdite'); }));
        const mauvais = (url, n) => (/robots\.txt$/.test(url) ? rep(200, 'User-agent: *\nDisallow: /wiki/\n', 'text/plain') : tr.get(url));
        const t2 = { urls: [], get: async url => { t2.urls.push(url); return mauvais(url); } };
        const r = await cli([], t2);
        assert.strictEqual(r.code, 2);
        assert.strictEqual(t2.urls.length, 1);
    });
    await t('script : une ligne de commande inconnue (--sparql=…) est refusée avant toute requête', async () => {
        const tr = transportFactice(servir(() => rep(200, '{}')));
        const r = await cli(['--sparql=1'], tr);
        assert.strictEqual(r.code, 2);
        assert.strictEqual(tr.urls.length, 0);
    });
    await t('script : une erreur serveur passagère est retentée 2 fois puis ARRÊTE (code 4) — jamais une boucle, jamais un arrêt d\'hôte', async () => {
        const tr = transportFactice(servir(() => rep(503, 'indisponible', 'text/plain')));
        const r = await cli([], tr);
        assert.strictEqual(r.code, 4);
        assert.strictEqual(tr.urls.length, 1 + 3);   // robots + 3 essais de la graine
        assert.ok(!fs.existsSync(path.join(r.pauses, 'ARRET-HOTE-wikidata.org.json')));
    });
    await t('script : la marche réelle (client poli) lit la chaîne servie, reprend sans requête, et écrit un fichier lisible par lireEspecesWikidata', async () => {
        const tr = transportFactice(servir(q => (CHAINE[q] ? rep(200, fs.readFileSync(path.join(FX, q + '.json'), 'utf8')) : rep(404, '{"error":{"code":"no-such-entity"}}'))));
        const r1 = await cli([], tr);
        assert.strictEqual(r1.code, 6);   // 22 et 28 sont des 404 : rupture nommée
        const n1 = tr.urls.length;
        assert.strictEqual(n1, 1 + 7);
        const r2 = await cli([], tr, r1);
        assert.strictEqual(tr.urls.length, n1, 'la reprise ne redemande rien');
        const w = TZ.lireEspecesWikidata(JSON.parse(fs.readFileSync(path.join(r1.sortie, 'especes-zh.json'), 'utf8')), { licence: 'CC0', luLe: fs.readFileSync(path.join(r1.sortie, 'LU-LE.txt'), 'utf8').slice(0, 10) });
        assert.strictEqual(w.table['比卡超'], 'D25');
    });
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
