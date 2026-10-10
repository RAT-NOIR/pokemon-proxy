'use strict';
// B1b.4b (tour 1) — la SORTIE de exporter-donnees-logos-site.js ne change pas d'un octet quand son bloc de décision de visuel devient une fonction
// exportée (choisirVisuel, partagée avec l'export v2). Le script RÉEL tourne dans un processus enfant, sur DEUX bases EN MÉMOIRE fabriquées (`cartes` et
// `test` sur deux serveurs distincts : la garde du collecteur refuse un cluster qui porte `test`), et sa sortie complète est comparée à la sortie
// « AVANT extraction » GELÉE dans v2/test/fixtures/logos-sortie-avant.json (produite par le fichier d'avant, avec `--generer`).
//   node v2/test/test-logos-sortie-identique.js              compare
//   node v2/test/test-logos-sortie-identique.js --generer    (re)produit la référence — à ne faire QUE sur le fichier d'avant l'extraction
// Les fichiers de logos du dépôt principal (Logo FR/, apport-manuel/) ne sont pas dans le worktree : jonctions temporaires, retirées en sortie.
const fs = require('fs'); const path = require('path'); const { spawn } = require('child_process');
const H = require('./_harnais');
const mongoose = require('mongoose');
const RACINE = path.join(__dirname, '..', '..');
const PRINCIPAL = path.join(RACINE, '..', 'pokemon-proxy');
const REF = path.join(__dirname, 'fixtures', 'logos-sortie-avant.json');
const SORTIE = path.join(RACINE, 'donnees-site', 'logos-composes-donnees.json');

// Les fins de ligne sont normalisées des DEUX côtés : avec core.autocrlf=true, git réécrit en CRLF un fichier texte sans attribut à l'extraction
// (mesuré : la même référence faisait 139 633 octets en LF et 144 400 en CRLF selon l'arbre) ; la sortie du script, elle, est toujours en LF.
// (v2/test/fixtures est aussi figé en LF par .gitattributes ; cette normalisation protège le test même si l'attribut est perdu.)
const LF = s => s.replace(/\r\n/g, '\n');
const comparer = (texte, chemin) => LF(texte) === LF(fs.readFileSync(chemin, 'utf8'));

(async () => {
    const generer = process.argv.includes('--generer');
    const banc = await H.ouvrirBancV2();
    const { ouvrirBanc } = require('../../collecte-cartes/base-banc');
    const envSans = { ...process.env }; delete envSans.MONGODB_TEST_URI;   // appliquer() l'a posée à l'URI du 1er banc : jugerUri la prendrait pour la production
    const banc2 = await ouvrirBanc({ env: envSans });                                 // 2e serveur en mémoire : « la production » (lecture) du script
    const jonctions = [];
    let sortieExistait = fs.existsSync(SORTIE);
    try {
        const cx = await mongoose.createConnection(banc.uri, { dbName: 'cartes' }).asPromise();
        const cp = await mongoose.createConnection(banc2.uri, { dbName: 'test' }).asPromise();
        const vig = n => ({ cleR2: `vignettes/${n}.webp`, w: 200, h: 279 });
        const im = (set, numero, n, o = {}) => ({ set, numero, cleR2: `cartes/${n}.webp`, w: 600, h: 838, vignette: vig(n), langue: 'en', source: 'tcgdex', ...o });
        const imp = (numero, o = {}) => ({ tirage: 'intl', expansion: 'SV Black Star Promos', numero, total: '100', rarete: 'Rare', ...o });
        const carte = (id, impressions, images, categorie = 'pokemon') => ({ _id: id, nomEn: `Carte ${id}`, categorie, sets: ['SV-Black-Star-Promos'], impressions, images });
        const ligne = (id, carteId, numeroFiche, o = {}) => ({ idProduct: id, carteId, idExpansion: 100, numeroFiche, slug: `P${id}-SVP${numeroFiche}`, slugSet: 'SV-Black-Star-Promos', ...o });
        const subst = o => ({ cleR2: 'cartes/orig.webp', w: 600, h: 838, vignette: vig('orig'), set: 'Set-B', source: 'tcgdex', langue: 'en', ...o });
        await cx.db.collection('sets').insertMany([
            { _id: 'SV-Black-Star-Promos', idExpansion: 100, code: 'SVP', nomAffichage: 'SV Black Star Promos', tirage: 'intl', region: 'intl', bulba: { expansion: 'SV Black Star Promos' } },
            { _id: 'Set-B', idExpansion: 200, code: 'SB', nomAffichage: 'Set B', tirage: 'intl', region: 'intl', bulba: { expansion: 'Set B' } },
            { _id: 'JP-Promos', idExpansion: 300, code: 'JPP', nomAffichage: 'JP Promos', tirage: 'jp', region: 'jp', bulba: { expansion: 'JP Promos' } },
            { _id: 'POP-Series-1', idExpansion: 400, code: 'POP1', nomAffichage: 'POP Series 1', tirage: 'intl', region: 'intl', bulba: { expansion: 'POP Series 1' } }]);
        await cx.db.collection('cartes').insertMany([
            carte(1, [imp('001')], [im('SV-Black-Star-Promos', '001', 'c1')]),                              // du set, prix
            carte(2, [imp('002', { rarete: 'SR' })], [im('SV-Black-Star-Promos', '002', 'c2')]),            // du set, sans prix (classement de secours)
            carte(3, [imp('003')], []),                                                                     // substitut AVEC mention
            carte(4, [imp('004')], []),                                                                     // substitut SANS mention (repli des logos)
            carte(5, [imp('005')], [im('Set-B', '005', 'c5b')]),                                            // autre tirage
            carte(6, [imp('006')], []),                                                                     // aucun visuel
            carte(7, [imp('007')], [im('SV-Black-Star-Promos', '007', 'c7')], 'dresseur'),                  // dresseur : exclu
            carte(8, [imp('008')], [im('SV-Black-Star-Promos', '008', 'c8')]),                              // tampon dans le nom : exclu
            carte(9, [imp('009')], [im('SV-Black-Star-Promos', '009', 'c9')]),                              // produit sans fiche du site (numéro contredit)
            carte(11, [imp('011')], [im('SV-Black-Star-Promos', '011', 'c11ja', { langue: 'ja' }), im('Set-B', '011', 'c11b')]),   // scan japonais refusé -> autre tirage
            { _id: 12, nomEn: 'Carte 12', categorie: 'pokemon', sets: ['JP-Promos'], impressions: [{ tirage: 'jp', expansion: 'JP Promos', numero: '001', total: '10', rarete: null }],
                images: [{ set: 'JP-Promos', numero: '001', cleR2: 'artofpkm/jp12.webp', w: 593, h: 834, vignette: vig('jp12'), langue: 'ja', source: 'artofpkm' }] },
            { _id: 13, nomEn: 'Carte 13', categorie: 'pokemon', sets: ['POP-Series-1'], impressions: [{ tirage: 'intl', expansion: 'POP Series 1', numero: '001', total: '17', rarete: 'Rare' }],
                images: [im('POP-Series-1', '001', 'c13')] },
            { _id: 14, nomEn: 'Carte 14', categorie: 'pokemon', sets: ['POP-Series-1'], impressions: [{ tirage: 'intl', expansion: 'POP Series 1', numero: '002', total: '17', rarete: 'Rare' }], images: [] }]);
        await cx.db.collection('cartes_produits').insertMany([
            ligne(1001, 1, '001'), ligne(1002, 2, '002'),
            ligne(1003, 3, '003', { visuelSubstitut: subst({ mention: 'Visuel de la carte d\'origine (Set B) — pas celui de ce produit' }) }),
            ligne(1004, 4, '004', { visuelSubstitut: subst({}) }), ligne(1005, 5, '005'), ligne(1006, 6, '006'), ligne(1007, 7, '007'), ligne(1008, 8, '008'),
            ligne(1009, 9, '999'), ligne(1011, 11, '011'),
            { idProduct: 2012, carteId: 12, idExpansion: 300, numeroFiche: '001', slug: 'P2012-JPP001', slugSet: 'JP-Promos' },
            { idProduct: 3013, carteId: 13, idExpansion: 400, numeroFiche: '001', slug: 'P3013-POP1001', slugSet: 'POP-Series-1' },
            { idProduct: 3014, carteId: 14, idExpansion: 400, numeroFiche: '002', slug: 'P3014-POP1002', slugSet: 'POP-Series-1' }]);
        await cp.db.collection('guide_prix_meta').insertOne({ _id: 'dernier', fichier: 'guide-test.json', guideDu: '2026-10-01' });
        const prix = { 1001: [10, 9], 1003: [5, 5], 1004: [4, 4], 1005: [3, 3], 1006: [2, 2], 1008: [8, 8], 1009: [7, 7], 1011: [1.5, 1.5], 2012: [6, 6], 3013: [2.5, 2.5] };
        await cp.db.collection('guide_prix').insertMany(Object.entries(prix).map(([id, [trend, avg]]) => ({ idProduct: Number(id), trend, avg, guideDu: '2026-10-01' })));
        await cp.db.collection('catalogue_produits').insertMany([1001, 1002, 1003, 1004, 1005, 1006, 1007, 1009, 1011, 2012, 3013, 3014].map(idProduct => ({ idProduct, name: `Produit ${idProduct}` }))
            .concat([{ idProduct: 1008, name: 'Pikachu Pre-release Promo' }]));
        await cx.close(); await cp.close();

        // jonctions vers les fichiers du dépôt principal (jamais copiés, jamais écrits)
        for (const d of ['Logo FR', 'apport-manuel']) {
            const lien = path.join(RACINE, d);
            if (!fs.existsSync(lien)) { fs.symlinkSync(path.join(PRINCIPAL, d), lien, 'junction'); jonctions.push(lien); }
        }
        const dossierSortie = path.join(RACINE, 'donnees-site');
        const sortieAvant = sortieExistait ? fs.readFileSync(SORTIE) : null;
        const lancer = () => new Promise(resolve => {
            const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP,
                MONGODB_CARTES_URI: banc.uri, MONGODB_CARTES_BASE: 'cartes', MONGODB_URI: banc2.uri, R2_ACCOUNT_ID: 'x', R2_ACCESS_KEY_ID: 'x', R2_SECRET_ACCESS_KEY: 'x',
                BANC_ISOLE: '1', BANC_HOTES: process.env.BANC_HOTES };
            const e = spawn(process.execPath, [path.join(RACINE, 'exporter-donnees-logos-site.js')], { cwd: RACINE, env, stdio: ['ignore', 'pipe', 'pipe'] });
            let out = '', err = ''; e.stdout.on('data', d => { out += d; }); e.stderr.on('data', d => { err += d; });
            const k = setTimeout(() => e.kill(), 120000);
            e.on('close', status => { clearTimeout(k); resolve({ status, out, err }); });
        });
        const r = await lancer();
        if (r.status !== 0) console.log(r.out + r.err);
        H.v('le script des logos tourne sur la base fabriquée (code 0)', r.status, 0);
        const brut = JSON.parse(fs.readFileSync(SORTIE, 'utf8'));
        delete brut.genere;                                                          // seule valeur non déterministe
        const texte = JSON.stringify(brut, null, 1).split(RACINE.replace(/\\/g, '\\\\')).join('<RACINE>').split(RACINE.replace(/\\/g, '/')).join('<RACINE>');
        // la sortie exerce bien les chemins qu'on veut comparer (sinon l'égalité ne prouverait rien)
        const cl = brut.vedettes['SV-Black-Star-Promos'].classement;
        H.v('la sortie porte du-set, substitut, autre-tirage et sans-prix (la comparaison n\'est pas vide)',
            [...new Set(cl.map(x => x.visuel))].sort().concat(cl.some(x => x.classementSansPrix) ? ['sans-prix'] : []), ['autre-tirage', 'du-set', 'substitut', 'sans-prix']);
        H.v('   la mention de repli (substitut sans mention) figure dans la sortie', cl.some(x => x.idProduct === 1004 && /^Visuel de la carte d'origine \(Set B\)/.test(x.mention || '')), true);
        H.v('   le produit sans fiche, le tampon et le dresseur sont exclus', cl.filter(x => [1009, 1008, 1007].includes(x.idProduct)).length, 0);
        if (generer) { fs.mkdirSync(path.dirname(REF), { recursive: true }); fs.writeFileSync(REF, texte); console.log(`→ référence écrite : ${REF} (${texte.length} octets)`); }
        else {
            const ref = fs.readFileSync(REF, 'utf8');
            H.v('sortie complète IDENTIQUE à la référence d\'avant l\'extraction (octets)', [texte.length, comparer(texte, REF)], [ref.replace(/\r\n/g, '\n').length, true]);
            // la référence réécrite en CRLF (core.autocrlf=true à l'extraction) ne change pas le verdict ; une vraie différence le change encore
            const crlf = path.join(require('os').tmpdir(), `logos-ref-crlf-${process.pid}.json`);
            fs.writeFileSync(crlf, ref.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'));
            try {
                H.v('la référence en CRLF donne le même verdict (fins de ligne ignorées des deux côtés)', comparer(texte, crlf), true);
                H.v('   et une sortie différente d\'un caractère reste refusée', comparer(texte + ' ', crlf), false);
            } finally { fs.rmSync(crlf, { force: true }); }
        }
        // l'export des logos n'a laissé que ce qu'il laisse toujours ; on rend le worktree comme on l'a trouvé
        if (sortieAvant) fs.writeFileSync(SORTIE, sortieAvant); else { fs.rmSync(SORTIE, { force: true }); try { fs.rmdirSync(dossierSortie); } catch { /* non vide : on n'y touche pas */ } }
    } finally {
        for (const j of jonctions) { try { fs.rmdirSync(j); } catch (e) { console.error('jonction non retirée :', j, e.message); } }
        await banc2.arreter(); await H.arreterBanc();
    }
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
