// Banc de collecter-logos-officiels.js + retirer-logos-officiels : faux réseau, base EN MÉMOIRE (base-banc.js), faux stockage R2. Aucune requête,
// aucune écriture en production. Chaque garde doit savoir dire NON (§41) : états FABRIQUÉS.
//   node test-collecter-logos-officiels.js
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const mongoose = require('mongoose');
const { ouvrirBanc } = require('./collecte-cartes/base-banc');
const r2 = require('./collecte-cartes/r2');
const M = require('./collecter-logos-officiels');
const { lireListe } = require('./collecte-cartes/lire-liste-logos');
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };
const URL_B = 'https://billsarchive.com/assets/logos/japanese/jp-undone-seal.webp';
const URL_T = 'https://assets.tcgdex.net/fr/sv/sv01/logo.png';
const L = (o = {}) => ({ part: 'JP', fichier: 'Logo JP/ADV5.png', verdict: 'OFFICIEL', set: 'Undone-Seal', setSur: true, cible: 'ja', langue: 'ja', urls: [URL_B], urlChoisie: URL_B, source: 'billsarchive', bulbapediaSeule: false, cache: null, pokecardexSha256: 'p'.repeat(64), ...o });
const sets = new Map([['Undone-Seal', { _id: 'Undone-Seal', tirage: 'jp', region: 'jp' }], ['Scarlet-Violet', { _id: 'Scarlet-Violet', tirage: 'intl', region: 'intl' }]]);
const action = (l, s = sets) => M.planifier(l, s).action;

// ── un faux réseau : table url → réponse ; horloge fausse (attendre avance le temps)
const rep = (status, corps = Buffer.alloc(0), h = {}) => ({ status, headers: { get: k => h[k.toLowerCase()] ?? null }, arrayBuffer: async () => { const b = Buffer.from(corps); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }, text: async () => Buffer.from(corps).toString('utf8') });
function reseau(table) {
    const appels = []; let t = 0;
    return { appels, horloge: { maintenant: () => t, attendre: async ms => { t += ms; } },
        fetch: async (url, opts) => { appels.push({ url, t, opts }); const r = table[url]; if (!r) return rep(404); return typeof r === 'function' ? r() : r; } };
}
const png = (w, h, couleur) => sharp({ create: { width: w, height: h, channels: 4, background: couleur } }).png().toBuffer();
const logoA = async () => sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><rect width="300" height="80" fill="none"/><text x="10" y="60" font-size="60" fill="#d22" font-family="Arial">ABCD</text></svg>')).png().toBuffer();
const logoB = async () => sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><circle cx="40" cy="40" r="35" fill="#22d"/><rect x="100" y="10" width="190" height="20" fill="#2a2"/></svg>')).png().toBuffer();

(async () => {
    // ───── 1. la garde des URL et des hôtes (par ce qu'elle AUTORISE)
    verifier('URL de la ligne, hôte de la liste : passe', M.verifierUrl(L(), URL_B), null);
    verifier('une URL qui n\'est PAS sur la ligne : refus', typeof M.verifierUrl(L(), 'https://billsarchive.com/assets/logos/japanese/jp-autre.webp'), 'string');
    verifier('un hôte hors liste (même écrit sur la ligne) : refus', typeof M.verifierUrl(L({ urls: ['https://exemple.org/x.png'] }), 'https://exemple.org/x.png'), 'string');
    verifier('http au lieu de https : refus', typeof M.verifierUrl(L({ urls: ['http://billsarchive.com/a.webp'] }), 'http://billsarchive.com/a.webp'), 'string');
    verifier('un hôte qui ressemble (billsarchive.com.evil.org) : refus', typeof M.verifierUrl(L({ urls: ['https://billsarchive.com.evil.org/a.webp'] }), 'https://billsarchive.com.evil.org/a.webp'), 'string');
    verifier('des identifiants dans l\'URL : refus', typeof M.verifierUrl(L({ urls: ['https://u:p@billsarchive.com/a.webp'] }), 'https://u:p@billsarchive.com/a.webp'), 'string');
    verifier('web.archive.org (Bulbapedia) n\'est pas dans la liste', M.HOTES_COLLECTE.includes('web.archive.org') || M.HOTES_COLLECTE.includes('archives.bulbagarden.net'), false);
    verifier('la liste des hôtes est celle des lignes', [...M.HOTES_COLLECTE].sort(), ['assets.tcgdex.net', 'billsarchive.com']);

    // ───── 2. le plan d'une ligne
    verifier('ligne OFFICIEL, set sûr, tirage jp : collecter', action(L()), 'collecter');
    verifier('verdict À REGARDER : refus (la planche, pas la collecte)', action(L({ verdict: 'À REGARDER' })), 'refus');
    verifier('set marqué « ? » (par le code seulement) : écartée', action(L({ setSur: false })), 'ecartee');
    verifier('set non identifié : écartée', action(L({ set: null, setSur: false })), 'ecartee');
    verifier('Bulbapedia seule (archive.org) : reportée, pas collectée', action(L({ bulbapediaSeule: true, urlChoisie: null, urls: ['https://web.archive.org/web/2025im_/https://archives.bulbagarden.net/media/upload/7/74/BW2_Logo.png'] })), 'reportee');
    verifier('set absent de la base : écartée', action(L({ set: 'Fantome' })), 'ecartee');
    verifier('ligne japonaise sur un set intl : écartée (tirage)', action(L({ set: 'Scarlet-Violet' })), 'ecartee');
    verifier('ligne FR sur un set jp : écartée (tirage)', action(L({ part: 'FR', cible: 'fr', langue: 'fr', set: 'Undone-Seal', urls: [URL_T], urlChoisie: URL_T })), 'ecartee');
    verifier('ligne FR sur un set intl, TCGdex : collecter', action(L({ part: 'FR', cible: 'fr', langue: 'fr', set: 'Scarlet-Violet', urls: [URL_T], urlChoisie: URL_T, source: 'tcgdex' })), 'collecter');
    verifier('URL choisie absente de la ligne : refus', action(L({ urlChoisie: 'https://billsarchive.com/autre.webp' })), 'refus');

    // ───── 3. le fichier téléchargé : identique à la phase 1, sinon re-mesure
    const A = await logoA(), B = await logoB();
    verifier('fichier identique (sha256) à celui comparé : accepté sans re-mesure', (({ ok, via }) => ({ ok, via }))(await M.juger(L({ cache: { sha256: sha256(A) } }), A, { pokecardexBuf: B })), { ok: true, via: 'identique-phase-1' });
    verifier('fichier différent du cache, MÊME dessin que le Pokécardex : re-mesure, accepté', (({ ok, via }) => ({ ok, via }))(await M.juger(L({ cache: { sha256: 'f'.repeat(64) } }), A, { pokecardexBuf: await sharp(A).resize(600).png().toBuffer() })), { ok: true, via: 're-mesure' });
    const refusDifferent = await M.juger(L({ cache: { sha256: 'f'.repeat(64) } }), B, { pokecardexBuf: A });
    verifier('fichier différent du cache ET autre dessin : refus (sous le seuil)', [refusDifferent.ok, /re-mesure|seuil|corr/.test(refusDifferent.raison ?? '')], [false, true]);
    verifier('pas de cache connu et pas de Pokécardex lisible : refus (je ne sais pas)', (await M.juger(L(), A, { pokecardexBuf: null })).ok, false);
    verifier('pas d\'image du tout : refus', (await M.juger(L(), Buffer.from('<html>défi</html>'), { pokecardexBuf: A })).ok, false);
    verifier('une copie connue de Pokécardex (empreinte sha1 de LOGOS_COPIES) : refus', await (async () => {
        const { LOGOS_COPIES } = require('./collecte-cartes/langue-logo'); const sha1 = [...LOGOS_COPIES.keys()][0];
        return (await M.juger(L({ cache: { sha256: sha256(A) } }), A, { pokecardexBuf: B, sha1Force: sha1 })).ok;
    })(), false);
    verifier('les seuils sont ceux de la phase 1 (FR 0.99, JP 0.90)', [require('./collecte-cartes/mesure-logos').SEUIL_FR, require('./collecte-cartes/mesure-logos').SEUIL_JP], [0.99, 0.9]);

    // ───── 4. le client : robots.txt, cadence, redirections, défi
    {
        const R = reseau({ 'https://billsarchive.com/robots.txt': rep(200, 'User-agent: *\nAllow: /\n'), [URL_B]: rep(200, A, { 'content-type': 'image/webp' }), 'https://billsarchive.com/assets/logos/japanese/autre.webp': rep(200, A) });
        const c = M.creerClient({ fetch: R.fetch, ...R.horloge });
        await c.get(URL_B); await c.get('https://billsarchive.com/assets/logos/japanese/autre.webp');
        verifier('robots.txt lu AVANT la première requête de l\'hôte, une seule fois', R.appels.map(a => a.url), ['https://billsarchive.com/robots.txt', URL_B, 'https://billsarchive.com/assets/logos/japanese/autre.webp']);
        const ecarts = R.appels.slice(1).map((a, i) => a.t - R.appels[i].t);
        verifier('cadence : au moins 10 s entre deux requêtes', ecarts.every(e => e >= 10000), true);
        verifier('les requêtes ne suivent pas les redirections toutes seules (redirect: manual)', R.appels.every(a => a.opts.redirect === 'manual'), true);
    }
    {
        const R = reseau({ 'https://billsarchive.com/robots.txt': rep(200, 'User-agent: *\nDisallow: /assets/\n'), [URL_B]: rep(200, A) });
        const c = M.creerClient({ fetch: R.fetch, ...R.horloge });
        let msg = null; try { await c.get(URL_B); } catch (e) { msg = e.message; }
        verifier('robots.txt qui interdit le chemin : refus, l\'image n\'est pas demandée', [/robots/.test(msg ?? ''), R.appels.some(a => a.url === URL_B)], [true, false]);
    }
    {
        const R = reseau({ 'https://billsarchive.com/robots.txt': rep(404), [URL_B]: rep(302, '', { location: 'https://exemple.org/a.webp' }) });
        const c = M.creerClient({ fetch: R.fetch, ...R.horloge });
        let msg = null; try { await c.get(URL_B); } catch (e) { msg = e.message; }
        verifier('redirection hors de l\'hôte : refus, la cible n\'est pas demandée', [/redirection/.test(msg ?? ''), R.appels.some(a => /exemple\.org/.test(a.url))], [true, false]);
    }
    {
        const R = reseau({ 'https://billsarchive.com/robots.txt': rep(404), [URL_B]: rep(302, '', { location: '/assets/logos/japanese/b.webp' }), 'https://billsarchive.com/assets/logos/japanese/b.webp': rep(200, A) });
        const c = M.creerClient({ fetch: R.fetch, ...R.horloge });
        const r = await c.get(URL_B);
        verifier('redirection DANS l\'hôte : suivie (une requête de plus, même cadence)', [r.status, r.buf.length === A.length], [200, true]);
    }
    {
        const R = reseau({ 'https://billsarchive.com/robots.txt': rep(404), [URL_B]: rep(403, '<html>Just a moment...</html>', { server: 'cloudflare', 'cf-mitigated': 'challenge' }), 'https://billsarchive.com/a.webp': rep(200, A) });
        const c = M.creerClient({ fetch: R.fetch, ...R.horloge });
        let e1 = null, e2 = null; try { await c.get(URL_B); } catch (e) { e1 = e; }
        const n = R.appels.length;
        try { await c.get('https://billsarchive.com/a.webp'); } catch (e) { e2 = e; }
        verifier('défi anti-robot (403 Cloudflare) : arrêt, et PLUS AUCUNE requête ensuite', [e1?.arret === true, e2?.arret === true, R.appels.length === n], [true, true, true]);
    }
    {
        const R = reseau({ 'https://billsarchive.com/robots.txt': rep(503) });
        const c = M.creerClient({ fetch: R.fetch, ...R.horloge });
        let msg = null; try { await c.get(URL_B); } catch (e) { msg = e.message; }
        verifier('robots.txt illisible (503) : on ne sait pas, on ne demande pas l\'image', [/robots/.test(msg ?? ''), R.appels.some(a => a.url === URL_B)], [true, false]);
    }
    {
        const R = reseau({ 'https://exemple.org/robots.txt': rep(404), 'https://exemple.org/x.png': rep(200, A) });
        const c = M.creerClient({ fetch: R.fetch, ...R.horloge });
        let msg = null; try { await c.get('https://exemple.org/x.png'); } catch (e) { msg = e.message; }
        verifier('le client refuse un hôte hors liste avant toute requête', [typeof msg, R.appels.length], ['string', 0]);
    }

    // ───── 5. les doublons de set (Base-Expansion-Pack : CP6 et OR1)
    verifier('deux lignes pour un même set, MÊME fichier : une écriture, un doublon', M.reduireDoublons([{ ligne: L({ fichier: 'a' }), sha256: 'x' }, { ligne: L({ fichier: 'b' }), sha256: 'x' }]).map(p => p.action), ['ecrire', 'doublon']);
    verifier('deux lignes pour un même set, fichiers DIFFÉRENTS : refus des deux', M.reduireDoublons([{ ligne: L({ fichier: 'a' }), sha256: 'x' }, { ligne: L({ fichier: 'b' }), sha256: 'y' }]).map(p => p.action), ['refus', 'refus']);

    // ───── 6. la phase 1 lue : les comptes de la liste réelle
    const liste = path.resolve(__dirname, '..', 'pokemon-proxy', 'LISTE-LOGOS-A-CHERCHER.md');
    if (!fs.existsSync(liste)) throw new Error(`liste de la phase 1 introuvable : ${liste}`);
    const lu = lireListe(fs.readFileSync(liste, 'utf8'));
    const compte = v => lu.filter(x => x.verdict === v).length;
    verifier('la liste lue : 181 OFFICIEL, 37 DIFFÉRENT, 67 INTROUVABLE, 41 À REGARDER (326)', [compte('OFFICIEL'), compte('DIFFÉRENT'), compte('INTROUVABLE'), compte('À REGARDER'), lu.length], [181, 37, 67, 41, 326]);

    // ───── 6 bis. l'export au site : sous `logosOfficiels`, par set, par langue — seulement des entrées complètes
    {
        const { logosOfficielsDesSets } = require('./exporter-donnees-logos-site');
        const e = { cleR2: 'logos-officiels/ja/X-abc.png', vignette: { cleR2: 'vignettes/logos-officiels/ja/X-abc.webp', w: 400, h: 100 }, w: 800, h: 200, sha256: 'a', langue: 'ja', source: 'billsarchive', urlSource: 'https://billsarchive.com/x.webp', mention: '© Pokémon / The Pokémon Company', lot: 'l', le: new Date(), preuve: { secret: 1 }, octets: 5 };
        const sortie = typeof logosOfficielsDesSets === 'function' ? logosOfficielsDesSets([{ _id: 'B', logo: { cleR2: 'x' } }, { _id: 'A', logoOfficiel: { ja: e, fr: { lot: 'l' } } }]) : null;
        verifier('l\'export : un set sans logoOfficiel n\'y est pas ; une entrée incomplète (sans cleR2) est ignorée', Object.keys(sortie ?? {}).concat(Object.keys(sortie?.A ?? {})), ['A', 'ja']);
        verifier('l\'export : la forme exacte (clé, vignette, tailles, empreinte, langue, source, mention, lot) — ni preuve ni date', sortie?.A?.ja, { cleR2: e.cleR2, vignette: e.vignette, w: 800, h: 200, sha256: 'a', langue: 'ja', source: 'billsarchive', urlSource: e.urlSource, mention: e.mention, lot: 'l' });
    }

    // ───── 7. l'écriture et le retrait : base EN MÉMOIRE, faux R2
    const banc = await ouvrirBanc(); banc.appliquer();
    const cx = await mongoose.createConnection(process.env.MONGODB_CARTES_URI, { dbName: 'cartes' }).asPromise();
    const S = cx.db.collection('sets');
    const magasin = new Map();
    Object.assign(r2, {
        verifierBucket: async () => 'faux', existe: async (b, k) => magasin.has(k),
        deposerBinaire: async (b, k, buf) => { if (magasin.has(k)) return { ecrit: false, cle: k }; magasin.set(k, buf); return { ecrit: true, cle: k }; },
        supprimer: async (b, ks) => { ks.forEach(k => magasin.delete(k)); return ks.length; }
    });
    try {
        const existant = { _id: 'Undone-Seal', tirage: 'jp', region: 'jp', code: 'ADV5', nomAffichage: 'Undone Seal', logo: { cleR2: 'logos/x.png', w: 1, h: 1 }, logoFr: { cleR2: 'logos/fr.png' }, logoCompose: { cleR2: 'logos/c.png' }, logoOfficiel: { fr: { cleR2: 'logos-officiels/fr/autre.png', lot: 'autre-lot' } } };
        await S.insertOne({ ...existant });
        await S.insertOne({ _id: 'Scarlet-Violet', tirage: 'intl', region: 'intl', logo: { cleR2: 'logos/sv.png' } });
        const ligne = L({ cache: { sha256: sha256(A) } });
        const fichier = { buf: A, sha256: sha256(A), ext: 'png', url: URL_B, via: 'identique-phase-1', corr: null };
        const e = await M.ecrireLigne({ S, r2, bucket: 'b', ligne, set: 'Undone-Seal', fichier, le: new Date('2026-10-10') });
        const apres = await S.findOne({ _id: 'Undone-Seal' });
        const { logoOfficiel, ...reste } = apres, { logoOfficiel: _, ...resteAvant } = existant;
        verifier('l\'écriture pose logoOfficiel.ja', [e.action, apres.logoOfficiel?.ja?.lot, apres.logoOfficiel?.ja?.source, apres.logoOfficiel?.ja?.sha256], ['ecrit', M.LOT, 'billsarchive', sha256(A)]);
        verifier('l\'écriture n\'efface ni ne change AUCUN champ existant (logo, logoFr, logoCompose, nom…)', reste, resteAvant);
        verifier('… ni le logoOfficiel d\'une autre langue ou d\'un autre lot', apres.logoOfficiel.fr, existant.logoOfficiel.fr);
        verifier('la vignette accompagne le logo (clé vignettes/…, déposée)', [apres.logoOfficiel.ja.vignette?.cleR2?.startsWith('vignettes/logos-officiels/ja/'), magasin.has(apres.logoOfficiel.ja.vignette.cleR2), magasin.has(apres.logoOfficiel.ja.cleR2)], [true, true, true]);
        verifier('la clé R2 est sous logos-officiels/<langue>/<set>-<empreinte>', apres.logoOfficiel.ja.cleR2, `logos-officiels/ja/Undone-Seal-${sha256(A).slice(0, 10)}.png`);
        verifier('la mention et la preuve sont écrites', [apres.logoOfficiel.ja.mention, typeof apres.logoOfficiel.ja.preuve?.urlSource], ['© Pokémon / The Pokémon Company', 'string']);
        const e2 = await M.ecrireLigne({ S, r2, bucket: 'b', ligne, set: 'Undone-Seal', fichier, le: new Date() });
        verifier('rejouer le même lot : « deja », rien ne bouge', e2.action, 'deja');
        const B2 = await logoB();
        const e3 = await M.ecrireLigne({ S, r2, bucket: 'b', ligne, set: 'Undone-Seal', fichier: { ...fichier, buf: B2, sha256: sha256(B2) }, le: new Date() });
        verifier('un fichier DIFFÉRENT sur un logoOfficiel déjà posé : refus, rien n\'est remplacé', [e3.action, (await S.findOne({ _id: 'Undone-Seal' })).logoOfficiel.ja.sha256], ['refus', sha256(A)]);
        const eSv = await M.ecrireLigne({ S, r2, bucket: 'b', ligne: L({ part: 'FR', cible: 'fr', langue: 'fr', set: 'Scarlet-Violet' }), set: 'Scarlet-Violet', fichier: { ...fichier, url: URL_T }, le: new Date() });
        // le retrait : exactement ce lot
        const cles = [...magasin.keys()].filter(k => k.includes('Scarlet-Violet') || k.includes('Undone-Seal')).sort();
        const simul = await M.retirerLot({ S, r2, bucket: 'b', lot: M.LOT, ecrire: false });
        verifier('retrait en simulation : liste les sets et les clés, ne retire rien', [simul.sets.sort(), simul.cles.length, magasin.size], [['Scarlet-Violet', 'Undone-Seal'], 4, cles.length]);
        const retrait = await M.retirerLot({ S, r2, bucket: 'b', lot: M.LOT, ecrire: true });
        const u = await S.findOne({ _id: 'Undone-Seal' }), sv = await S.findOne({ _id: 'Scarlet-Violet' });
        verifier('le retrait retire EXACTEMENT ce lot : le logoOfficiel.fr d\'un autre lot et tous les autres champs restent', [u.logoOfficiel, { ...u, logoOfficiel: undefined }], [{ fr: existant.logoOfficiel.fr }, { ...resteAvant, logoOfficiel: undefined }]);
        verifier('… un set qui n\'avait que ce lot retrouve son état d\'avant (plus de logoOfficiel du tout)', [sv.logoOfficiel, Object.keys(sv).sort()], [undefined, ['_id', 'logo', 'region', 'tirage']]);
        verifier('… les 4 objets R2 (2 logos + 2 vignettes) sont retirés, rien d\'autre', [retrait.cles.length, magasin.size], [4, 0]);
        verifier('… et la bonne action : ecrit sur Scarlet-Violet avant le retrait', eSv.action, 'ecrit');
    } finally { await cx.close(); await banc.arreter(); }
    console.log(`\n${ok} passés, ${ko} en échec`);
    if (ko) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(1); });
