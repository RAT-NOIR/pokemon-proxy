// node test-importer-pikaqian-passif.js — l'IMPORT des images reçues du navigateur du testeur (importer-pikaqian-passif.js), de BOUT EN BOUT sur un dossier FABRIQUÉ PAR LE RÉCEPTEUR LUI-MÊME
// (recepteur-pikaqian.js : une page apprise, des lots d'images, deux visites), une base EN MÉMOIRE, un R2 et des vignettes SIMULÉS. Aucune requête, aucune base réelle, aucun dépôt R2.
// PK_IMPORT (rouge-importer-pikaqian.js) : un importeur MUTANT à tester à la place du vrai — chaque preuve retirée, seule, doit faire échouer ce banc.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const sharp = require('sharp');
const { spawnSync } = require('child_process');
const P = require('./collecte-cartes/pikaqian');
const R = require('./recepteur-pikaqian');
const { lignePikaqian } = require('./collecte-cartes/pikaqian-sets');
const { retirerLot } = require('./retirer-visuels-pikaqian');
const I = require(process.env.PK_IMPORT ? path.resolve(process.env.PK_IMPORT) : './importer-pikaqian-passif');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const silencieux = () => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => { }; return () => { console.log = l; console.warn = w; console.error = e; }; };

// ── une base en mémoire : les seules formes de requête que le collecteur et l'import emploient (la même que test-collecteur-pikaqian.js) ──
function fausseBase({ dataSize = 1000, indexSize = 100 } = {}) {
    const cols = new Map();
    const col = n => cols.get(n) || cols.set(n, new Map()).get(n);
    const lire = (o, k) => k.split('.').reduce((x, p) => Array.isArray(x) ? x.map(y => y?.[p]) : x?.[p], o);
    const ecrireChamp = (o, k, v) => { const ps = k.split('.'); let x = o; for (const p of ps.slice(0, -1)) x = x[p] ??= {}; x[ps.at(-1)] = v; };
    const accepte = (d, f) => Object.entries(f || {}).every(([k, v]) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
        ? ('$in' in v ? v.$in.includes(lire(d, k)) : '$ne' in v ? lire(d, k) !== v.$ne : '$exists' in v ? (lire(d, k) !== undefined) === v.$exists : false)
        : (Array.isArray(lire(d, k)) && !Array.isArray(v) ? lire(d, k).includes(v) : lire(d, k) === v));
    const appliquer = (d, u) => {
        for (const [k, v] of Object.entries(u.$set || {})) ecrireChamp(d, k, v);
        for (const k of Object.keys(u.$unset || {})) delete d[k];
        for (const [k, v] of Object.entries(u.$pull || {})) d[k] = (d[k] || []).filter(e => !accepte(e, v));
        for (const [k, v] of Object.entries(u.$push || {})) (d[k] ??= []).push(...(v.$each || [v]));
    };
    const tous = (n, f) => [...col(n).values()].filter(d => accepte(d, f));
    const collection = n => ({
        async findOne(f) { return structuredClone(tous(n, f)[0] ?? null); },
        find(f) { return { toArray: async () => structuredClone(tous(n, f)) }; },
        async countDocuments(f) { return tous(n, f).length; },
        async updateOne(f, u, o = {}) {
            let d = tous(n, f)[0];
            if (!d) { if (!o.upsert) return { matchedCount: 0, modifiedCount: 0 }; d = { _id: f._id, ...(u.$setOnInsert || {}) }; col(n).set(d._id, d); }
            appliquer(d, u); return { matchedCount: 1, modifiedCount: 1 };
        }
    });
    const db = { collection, async command(c) { if (c.dbStats) return { dataSize, indexSize }; throw new Error(`commande inattendue ${JSON.stringify(c)}`); } };
    const modele = n => ({
        db: { db },
        findById: id => ({ select: () => ({ lean: async () => structuredClone(col(n).get(id) ?? null) }) }),
        find: f => ({ lean: async () => structuredClone(tous(n, f)) }),
        updateOne: (f, u, o) => collection(n).updateOne(f, u, o)
    });
    return { cols, col, db, M: { Carte: modele('cartes'), Image: modele('images'), Set: modele('sets'), EtatImages: modele('collecte_images_etat') } };
}

const SLUG = 'Dynamax-Clash-Flame';
const UUID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const URL_IMG = n => `https://images.pikaqian.com/cs1bc/${UUID(n)}.webp`;
const tuile = (n, num, nom) => `<a class="w-full group" data-discover="true" href="/cards/${UUID(n)}"><div><img alt="${nom}" src="${URL_IMG(n)}"/></div><h2>${nom}</h2><p class="font-mono">cs1bc<!-- --> · ${num}</p></a>`;
// (id de tuile, numéro, nom) — voir le commentaire de chaque cas
const TUILES = [[1, '001', 'Pikachu'], [2, '001', 'Pikachu Reverse Holo'], [3, '002', 'Raichu'], [4, '003', 'Eevee Plus'], [5, '004', 'Vaporeon'], [6, '005', 'Jolteon'], [7, '006', 'Flareon'],
    [8, '007', 'Espeon'], [9, '008', 'Umbreon'], [10, '010', 'Glaceon'], [11, '011', 'Sylveon'], [12, '012', 'Gible'], [13, '013', 'Bidoof'], [14, '014', 'Leafeon']];
const pageHtml = (renomme = {}) => `<html><body>${TUILES.map(([n, num, nom]) => tuile(n, num, renomme[n] ?? nom)).join('')}</body></html>`;
function semer(B) {
    B.col('sets').set(SLUG, { _id: SLUG, tirage: 'zh-hans', region: 'intl' });
    const cartes = { 1: 'Pikachu', 2: 'Raichu', 3: 'Eevee', 4: 'Vaporeon', 5: 'Jolteon', 6: 'Flareon', 7: 'Espeon', 8: 'Umbreon', 10: 'Glaceon', 11: 'Glaceon', 12: 'Sylveon', 13: 'Gible', 14: 'Bidoof', 15: 'Leafeon' };
    const numeros = { 1: '001', 2: '002', 3: '003', 4: '004', 5: '005', 6: '006', 7: '007', 8: '008', 10: '010', 11: '010', 12: '011', 13: '012', 14: '013', 15: '014' };
    for (const [id, nom] of Object.entries(cartes)) {
        const c = Number(id);
        B.col('cartes').set(c, { _id: c, nomEn: nom, images: c === 2 ? [{ set: SLUG, source: 'tcgdex', numero: '002', cleR2: 'tcgdex/y.webp' }] : c === 1 ? [{ set: 'Autre-Set', source: 'tcgdex', numero: '5', cleR2: 'tcgdex/x.webp' }] : [] });
        B.col('cartes_produits').set(`${c}|${100 + c}`, { _id: `${c}|${100 + c}`, carteId: c, idProduct: 100 + c, numeroFiche: numeros[id], slugSet: SLUG });
    }
    B.col('cartes_produits').set('1|11', { _id: '1|11', carteId: 1, idProduct: 11, numeroFiche: '001', slugSet: SLUG });
    // Gible : un document `images` « ok » à la même adresse (déjà là) ; Bidoof : un visuel RETIRÉ (jamais repris)
    B.col('images').set(P.idImagePikaqian(SLUG, 13, '012'), { _id: P.idImagePikaqian(SLUG, 13, '012'), etat: 'ok', sha256: 'deja', urlOriginal: URL_IMG(12), source: 'pikaqian', lot: P.LOT, set: SLUG, carteId: 13, numero: '012', cleR2: `pikaqian/${SLUG}/012-13-zh-hans.webp`, w: 300, h: 419, fmt: 'webp', preuve: 'p' });
    B.col('images').set(P.idImagePikaqian(SLUG, 14, '013'), { _id: P.idImagePikaqian(SLUG, 14, '013'), etat: 'retire' });
}

function envoyer(port, chemin, corps) {
    return new Promise(resolve => {
        const donnees = JSON.stringify(corps);
        const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: chemin, headers: { 'Content-Type': 'application/json', 'X-Rat-Market': R.VALEUR_MARQUE, 'Content-Length': Buffer.byteLength(donnees) } }, res => {
            const m = []; res.on('data', c => m.push(c)); res.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(m).toString('utf8')); } catch { } resolve({ status: res.statusCode, json: j }); });
        });
        req.on('error', e => resolve({ status: 0, erreur: e.code })); req.write(donnees); req.end();
    });
}
const couleur = (r, g, b, w = 300) => ({ create: { width: w, height: Math.round(w * 1.397), channels: 3, background: { r, g, b } } });

(async () => {
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'import-pk-'));
    const dossierFiches = path.join(racine, 'fiches'), dossierPassif = path.join(racine, 'passif');
    const srv = await R.demarrer({ port: 0, dossier: dossierFiches, dossierImages: dossierPassif, attendu: () => null, journal: () => { } });
    const img = async (nom, ...a) => ({ webp: await sharp(couleur(...a)).webp().toBuffer(), png: await sharp(couleur(...a)).png().toBuffer() })[nom];
    const envoyerImages = async (fichier, liste, nomsHtml = {}) => {
        const images = [];
        for (const [n, octets] of liste) { const t = TUILES.find(x => x[0] === n); images.push({ id: UUID(n), src: URL_IMG(n), nom: nomsHtml[n] ?? t[2], numero: t[1], voie: 'canvas', b64: octets.toString('base64') }); }
        return envoyer(srv.port, '/images', { fichier, images, sansImage: 0 });
    };
    try {
        // ── LES DEUX VISITES, par le récepteur (vrai code de production)
        // visite A : Umbreon s'appelait « Umbreon Z » sur cette visite ; les images de presque toutes les tuiles
        const A = await envoyer(srv.port, '/apprendre', { url: 'https://pikaqian.com/sets/cs1bc', html: pageHtml({ 9: 'Umbreon Z' }) });
        const fA = A.json.fichier;
        const b1 = await img('webp', 200, 30, 30), b3 = await img('webp', 30, 200, 30), b5 = await img('webp', 100, 100, 30, 299), b7 = await img('webp', 30, 30, 200), b8 = await img('webp', 90, 90, 90), b9 = await img('webp', 5, 5, 5);
        const b10 = await img('webp', 200, 200, 30), b11 = await img('png', 30, 200, 200, 320), b12 = await img('webp', 11, 22, 33), b13 = await img('webp', 44, 55, 66);
        let r = await envoyerImages(fA, [[1, b1], [3, b3], [5, b5], [7, b7], [8, b8], [9, b9], [10, b10], [11, b11], [12, b12], [13, b13]], { 9: 'Umbreon Z' });
        verifier('la visite A : 10 images reçues par le récepteur', [A.status, r.status, r.json?.recues, r.json?.refusees], [200, 200, 10, []]);
        await new Promise(res => setTimeout(res, 1100));
        // visite B (la plus récente, la page telle qu'elle est maintenant) : Flareon revient avec d'AUTRES octets
        const B = await envoyer(srv.port, '/apprendre', { url: 'https://pikaqian.com/sets/cs1bc', html: pageHtml() });
        const fB = B.json.fichier;
        const b7bis = await img('webp', 31, 31, 201);
        r = await envoyerImages(fB, [[7, b7bis]]);
        verifier('la visite B : Flareon avec d\'autres octets, reçu', [B.status, r.json?.recues], [200, 1]);
        // Espeon : le fichier est corrompu APRÈS la réception (l'empreinte du fichier de page ne correspond plus)
        const rep = path.join(dossierPassif, 'cs1bc');
        const fichierEspeon = fs.readdirSync(rep).find(n => n.startsWith(UUID(8)));
        fs.writeFileSync(path.join(rep, fichierEspeon), Buffer.concat([fs.readFileSync(path.join(rep, fichierEspeon)), Buffer.from('x')]));
        // Jolteon : le fichier de page annonce un nom de fichier qui sort du dossier (édité, ancien) — jamais ouvert
        const pageB = path.join(rep, `page--${fB.replace(/\.json$/, '')}.json`);
        const lB = JSON.parse(fs.readFileSync(pageB, 'utf8'));
        lB.recues[UUID(6)] = [{ fichier: '..\\evil.png', sha256: '0'.repeat(64), octets: 1, w: 1, h: 1, fmt: 'png', voie: 'canvas', le: lB.le }];
        fs.writeFileSync(pageB, JSON.stringify(lB));
        // un fichier de page qui n'est pas du schéma 2 : nommé, jamais lu à moitié
        fs.writeFileSync(path.join(rep, 'page--cs1bc--00000000T000000Z.json'), '{"schema":1}');

        // ── 1. LA SIMULATION
        const base = fausseBase(); semer(base);
        const attendu = () => null;
        const juger = (o = {}) => I.jugerCode({ code: 'cs1bc', dossierPassif, db: base.db, M: base.M, attendu, ...o });
        const j = await juger();
        verifier('2 visites lues, 1 fichier de page illisible NOMMÉ (schéma 1)', [j.visites, j.illisibles.map(x => x.fichier), /schéma 2/.test(j.illisibles[0]?.motif || '')], [2, ['page--cs1bc--00000000T000000Z.json'], true]);
        verifier('la page est celle de la visite la plus récente : 14 tuiles, au code du set', [j.refus, j.tuiles, j.auCode, j.derniere.fiche], [undefined, 14, 14, fB]);
        const S = j.sets[0];
        verifier('une ligne de table, le set joint à CS1bC', [j.sets.length, S.slug, S.ligne.codePk], [1, SLUG, 'cs1bc']);
        verifier('PLAN de production : 12 appariés (numéro + tuile sans foil + nom), la tuile à suffixe « Eevee Plus » est un reste nommé par le collecteur', [S.plan, S.restes['tuile-a-suffixe']], [12, 1]);
        verifier('à ÉCRIRE : 2 (Pikachu webp, Sylveon png) ; déjà là 1 (Gible) ; retiré 1 (Bidoof) ; sous le seuil 1 (Vaporeon 299 px) ; trous 7', [S.aEcrire, S.dejaLa, S.retires, S.tropPetits, S.nTrous], [2, 1, 1, 1, 7]);
        verifier('trous NOMMÉS par motif : image-non-recue (Leafeon), fichier-hors-forme (Jolteon), versions-divergentes, fichier-corrompu, tuile-changee, tuile-partagee ×2', [S.restes['image-non-recue'], S.restes['fichier-hors-forme'], S.restes['versions-divergentes'], S.restes['fichier-corrompu'], S.restes['tuile-changee'], S.restes['tuile-partagee']], [1, 1, 1, 1, 1, 2]);
        verifier('les deux à écrire sont Pikachu (carte 1) et Sylveon (carte 12), lus par la voie du navigateur', S.entrees.filter(e => e.statut === 'a-ecrire').map(e => [e.p.carteId, e.p.numero, e.o.voie, e.o.w]), [[1, '001', 'canvas', 300], [12, '011', 'canvas', 320]]);
        verifier('le total à écrire par code : aEcrireDe = 2', I.aEcrireDe(j), 2);
        verifier('la simulation n\'a RIEN écrit (images, cartes, sets)', [base.col('images').size, base.col('cartes').get(1).images.length, base.col('sets').get(SLUG).visuelsPikaqianPassif], [2, 1, undefined]);
        const sortie = I.formater([j], { dossierPassif });
        verifier('la sortie nomme la commande exacte sous lot-additif.js (collections, --codes, --attendu=cs1bc:2)', [/node lot-additif\.js --quoi="import passif pikaqian cs1bc" --collections=cartes,images,sets,collecte_images_etat -- node importer-pikaqian-passif\.js --ecrire --codes=cs1bc --attendu=cs1bc:2/.test(sortie), /à ÉCRIRE 2/.test(sortie)], [true, true]);

        // ── les preuves rejouées, une par une (chacune seule)
        verifier('page incomplète contre la mesure du set (attendu 99 tuiles, 13 lues) : refus en bloc, rien à écrire', [(await juger({ attendu: () => 99 })).refus?.etat, I.aEcrireDe(await juger({ attendu: () => 99 }))], ['page-incomplete', 0]);
        verifier('code sans dossier : refus « aucune-visite »', (await I.jugerCode({ code: 'inconnu', dossierPassif, db: base.db, M: base.M, attendu })).refus?.etat, 'aucune-visite');
        const sansLigne = await I.jugerCode({ code: 'cs1bc', dossierPassif, db: base.db, M: base.M, attendu, table: [] });
        verifier('un code sans ligne de table : refus « refuse-table »', sansLigne.refus?.etat, 'refuse-table');
        const baseTirage = fausseBase(); semer(baseTirage); baseTirage.col('sets').set(SLUG, { _id: SLUG, tirage: 'jp', region: 'jp' });
        const jT = await I.jugerCode({ code: 'cs1bc', dossierPassif, db: baseTirage.db, M: baseTirage.M, attendu });
        verifier('le tirage du set en base n\'est pas celui de la table : le collecteur refuserait (gardeTirage), l\'import aussi', [jT.sets[0].refus?.etat, I.aEcrireDe(jT)], ['refuse-set', 0]);
        const baseSansProduits = fausseBase(); semer(baseSansProduits); for (const k of [...baseSansProduits.col('cartes_produits').keys()]) baseSansProduits.col('cartes_produits').delete(k);
        const jP = await I.jugerCode({ code: 'cs1bc', dossierPassif, db: baseSansProduits.db, M: baseSansProduits.M, attendu });
        verifier('aucun produit joint : refus du collecteur (gardeProduits), aucun « verifie » sur du vide', [jP.sets[0].refus?.etat, I.aEcrireDe(jP)], ['refuse-set', 0]);
        // une carte déjà servie par une autre source à ce numéro : additif, elle n'est pas un trou (planifier)
        verifier('Raichu, déjà servie à ce numéro par une autre source : ni plan ni trou (additif)', S.entrees.some(e => e.p.carteId === 2), false);

        // ── 2. L'ÉCRITURE
        const depots = [], vignetter = async () => ({ vg: { entrees: 2, fabriquees: 2, echecs: 0 }, sets: [] });
        const verrouSet = () => ({ prendre: async () => null, rendre: async () => { } });
        const ecrire = async (jug, o = {}) => { const fin = silencieux(); try { return await I.ecrireCode({ jugement: jug, M: base.M, db: base.db, deposer: async (...a) => depots.push(a), bucket: 'bucket-test', vignetter, fabriquerVerrouSet: verrouSet, journal: console, ...o }); } finally { fin(); } };
        verifier('« à l\'attendu juste » : un attendu différent (3 au lieu de 2) = un écart nommé ; l\'attendu juste = aucun', [I.ecartsAttendus([j], { cs1bc: 3 }).map(x => x.motif), I.ecartsAttendus([j], { cs1bc: 2 }), I.ecartsAttendus([j], {}).map(x => x.motif), I.ecartsAttendus([{ ...j, refus: { motif: 'm' } }], { cs1bc: 2 }).length], [['à écrire 2, attendu 3'], [], ['aucun attendu donné'], 1]);
        // les gardes d'avant l'écriture : source RETIRÉE par décision, base au-delà de 400 Mo, verrou de set tenu
        const baseR = fausseBase(); semer(baseR); baseR.col('collecte_images_etat').set(P.ID_ALERTE, { _id: P.ID_ALERTE, active: true, retrait: true });
        await ecrire(j, { M: baseR.M, db: baseR.db }).then(() => verifier('source retirée par décision : l\'écriture est refusée', 'écrit', 'refusé'), e => verifier('source retirée par décision : l\'écriture est refusée', /RETIRÉE/.test(e.message), true));
        await ecrire(j, { stopOctets: 500 }).then(() => verifier('base au-delà du plafond : refusée', 'écrit', 'refusé'), e => verifier('base au-delà du plafond : refusée', /au-delà de/.test(e.message), true));
        await ecrire(j, { fabriquerVerrouSet: () => ({ prendre: async () => ({ pid: 9, hote: 'ailleurs' }), rendre: async () => { } }) }).then(() => verifier('verrou de set tenu par un autre : refusée', 'écrit', 'refusé'), e => verifier('verrou de set tenu par un autre : refusée', /tenu par pid 9/.test(e.message), true));
        verifier('… et RIEN n\'a été écrit par ces trois refus', [depots.length, base.col('images').size], [0, 2]);

        const bilans = await ecrire(j);
        const bil = bilans[0].bilan;
        verifier('2 dépôts R2 (bucket, clé du set, WebP), AVANT les lignes', [depots.length, depots.map(d => [d[0], d[1], d[3]])], [2, [['bucket-test', `pikaqian/${SLUG}/001-1-zh-hans.webp`, 'image/webp'], ['bucket-test', `pikaqian/${SLUG}/011-12-zh-hans.webp`, 'image/webp']]]);
        const d1 = base.col('images').get(P.idImagePikaqian(SLUG, 1, '001')), d12 = base.col('images').get(P.idImagePikaqian(SLUG, 12, '011'));
        verifier('document `images` : source, lot, MENTION, état, langue, la voie et la visite', [d1.source, d1.lot, d1.mention, d1.etat, d1.langue, d1.voieCollecte, d1.voieLecture, d1.visiteLe === j.derniere.le], ['pikaqian', P.LOT, P.MENTION, 'ok', 'zh-hans', 'navigateur-du-testeur', 'canvas', true]);
        verifier('   la tuile, la preuve (set, numéro, nom), l\'adresse, les dimensions de l\'ORIGINAL reçu (300 ; 320 pour le png) et la marque 350 px', [d1.idTuile, /cs1bc/.test(d1.preuve) && /Pikachu/.test(d1.preuve), d1.urlOriginal, d1.wOriginal, d12.wOriginal, d1.basseDefinition, d12.basseDefinition], [UUID(1), true, URL_IMG(1), 300, 320, true, true]);
        verifier('cartes.images : Pikachu garde le visuel de l\'autre set et reçoit le sien ; Sylveon reçoit le sien ; les autres cartes n\'ont pas bougé', [
            base.col('cartes').get(1).images.map(e => `${e.source}:${e.set}:${e.numero}`), base.col('cartes').get(12).images.map(e => `${e.source}:${e.set}:${e.numero}:${e.lot}`), base.col('cartes').get(2).images.map(e => e.source),
            [4, 5, 6, 7, 8, 10, 11, 14, 15].every(c => base.col('cartes').get(c).images.length === 0)], [['tcgdex:Autre-Set:5', `pikaqian:${SLUG}:001`], [`pikaqian:${SLUG}:011:${P.LOT}`], ['tcgdex'], true]);
        verifier('le bilan du set (`visuelsPikaqianPassif`) : concordance, écrites 2, relu 2 documents et 2 entrées, garde verte, voies', [bil.concordance, bil.ecrites, bil.relu, bil.garde.ok, bil.voies, bil.aEcrire], [true, 2, { documents: 2, entrees: 2 }, true, { canvas: 2 }, 2]);
        verifier('… et la base le porte', base.col('sets').get(SLUG).visuelsPikaqianPassif?.concordance, true);
        verifier('les trous ne sont PAS écrits : aucun document `images` pour Vaporeon, Jolteon, Flareon, Espeon, Umbreon, Glaceon ×2, Leafeon', [[4, '004'], [5, '005'], [6, '006'], [7, '007'], [8, '008'], [10, '010'], [11, '010'], [15, '014']].map(([c, n]) => base.col('images').has(P.idImagePikaqian(SLUG, c, n))), Array(8).fill(false));
        verifier('Bidoof (retiré) et Gible (déjà là) n\'ont pas été touchés', [base.col('images').get(P.idImagePikaqian(SLUG, 14, '013')), base.col('images').get(P.idImagePikaqian(SLUG, 13, '012')).sha256], [{ _id: P.idImagePikaqian(SLUG, 14, '013'), etat: 'retire' }, 'deja']);

        // ── IDEMPOTENT : un second passage ne trouve plus rien à écrire (les 2 sont « déjà là »)
        const j2 = await juger();
        // (la jointure additive a aussi posé l'entrée de Gible, dont le document `images` « ok » existait déjà : comme le collecteur du worker l'aurait fait ; les trois cartes sont servies, donc plus des trous)
        verifier('second passage (simulation) : plus rien à écrire, Pikachu, Sylveon et Gible servis (plus de trous), Bidoof toujours retiré', [I.aEcrireDe(j2), j2.sets[0].dejaLa, j2.sets[0].plan, j2.sets[0].retires, base.col('cartes').get(13).images.map(e => e.source)], [0, 0, 9, 1, ['pikaqian']]);
        const nDepots = depots.length; await ecrire(j2);
        verifier('… et son écriture ne dépose rien et ne double aucune entrée', [depots.length - nDepots, base.col('cartes').get(1).images.filter(e => e.source === 'pikaqian').length], [0, 1]);

        // ── LE RETRAIT EN UN GESTE : retirer-visuels-pikaqian.js retire ce que l'import a posé (source + lot), et le bilan passif
        const plan = await retirerLot(base.db, { ecrire: false });
        verifier('retirer-visuels-pikaqian.js (simulation) voit les entrées de l\'import : Pikachu et Sylveon', [plan.entrees >= 2, plan.cartes.includes(1), plan.cartes.includes(12)], [true, true, true]);
        const ret = await retirerLot(base.db, { ecrire: true });
        verifier('retrait écrit : plus aucune entrée du lot, les documents `images` du lot sont « retire », le bilan passif est nettoyé, l\'entrée d\'une autre source reste', [ret.reste, base.col('images').get(P.idImagePikaqian(SLUG, 1, '001')).etat, base.col('sets').get(SLUG).visuelsPikaqianPassif, base.col('cartes').get(1).images.map(e => e.source)], [0, 'retire', undefined, ['tcgdex']]);

        // ── la ligne de commande : un argument inconnu, ou une écriture sans attendu, refuse AVANT toute connexion (code 2)
        const cli = a => spawnSync(process.execPath, [path.join(__dirname, 'importer-pikaqian-passif.js'), ...a], { encoding: 'utf8', timeout: 20000 });
        for (const a of [['--inconnu'], ['--ecrire'], ['--ecrire', '--codes=cs1bc'], ['--ecrire', '--codes=cs1bc', '--attendu=151c:3'], ['--ecrire', '--codes=cs1bc,151c', '--attendu=cs1bc:2'], ['--attendu=cs1bc:2'], ['--codes=CS1BC'], ['--dossier=' + path.join(__dirname, 'import-test')]])
            verifier(`CLI ${a.join(' ')} : refusé, code 2, avant toute connexion`, cli(a).status, 2);
        verifier('… et un dossier dans le dépôt n\'a rien créé', fs.existsSync(path.join(__dirname, 'import-test')), false);
        // aucun accès réseau dans le code de l'import : ni fetch, ni http, ni axios
        const src = fs.readFileSync(path.join(__dirname, 'importer-pikaqian-passif.js'), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
        verifier('l\'import n\'ouvre aucune connexion réseau (ni fetch, ni http, ni axios, ni https)', /\bfetch\s*\(|require\('(https?|axios|node-fetch|undici)'\)/.test(src), false);
        verifier('et il importe le collecteur de production (releve, gardeTirage, gardeProduits, planifier, poserOriginal, joindreAdditif), jamais une copie', [/C\.releve\(/.test(src), /C\.gardeTirage\(/.test(src), /C\.gardeProduits\(/.test(src), /C\.planifier\(/.test(src), /C\.poserOriginal\(/.test(src), /C\.joindreAdditif\(/.test(src), /largeurMinDe\(/.test(src), /clesPartagees\(/.test(src)], Array(8).fill(true));
    } finally { await srv.fermer(); fs.rmSync(racine, { recursive: true, force: true }); }
    console.log(`\n${ok} réussis, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ banc interrompu :', e); process.exit(1); });
