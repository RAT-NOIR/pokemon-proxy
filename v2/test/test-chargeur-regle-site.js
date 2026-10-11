'use strict';
// COTES-VISUELS — la copie EMBARQUÉE des règles du site (ruling 2). Pas de base. Quand `rat-market-site` est présent, un fichier du site qui diffère de son empreinte FAIT ÉCHOUER ce banc ;
// quand il est absent, le banc le DIT (jamais un vert muet). La copie est régénérée par l'outil et comparée octet pour octet.
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const H = require('./_harnais');
const C = require('../chargeur/copier-regle-site');

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
(async () => {
    const dossier = C.DOSSIER;
    const emp = JSON.parse(fs.readFileSync(path.join(dossier, 'empreintes.json'), 'utf8'));
    H.v('les six sources du site sont empreintées', Object.keys(emp.sources).sort(), ['cardmarket.ts', 'imageDeLImpression.ts', 'impressionsDuSet.ts', 'langueDuVisuel.ts', 'visuels-anglais-regardes.json', 'visuels-japonais-sur-sets-intl.json']);
    // la copie n'a pas été retouchée à la main : chaque fichier produit porte l'empreinte écrite
    for (const [nom, h] of Object.entries(emp.produits)) H.v(`   ${nom} : empreinte de la copie conforme au fichier`, sha(fs.readFileSync(path.join(dossier, nom))), h);
    H.v('   aucune copie ne cite encore un fichier .ts (imports réécrits en .mjs)', Object.keys(emp.produits).filter(n => n.endsWith('.mjs')).filter(n => /from\s+["'][^"']+\.ts["']/.test(fs.readFileSync(path.join(dossier, n), 'utf8'))), []);

    // le site, quand il est là
    const siteLib = C.SITE_LIB;
    const etat = C.verifier({ siteLib });
    if (etat.etat === 'site-absent') console.log(`⚠️ SITE ABSENT (${path.basename(path.dirname(siteLib))}) : la synchronisation avec le site n'est PAS vérifiée par ce banc — jamais un vert à lire comme « à jour »`);
    else H.v('le site présent : chaque fichier source porte l\'empreinte de la copie, et la régénération donne la copie octet pour octet', [etat.etat, etat.derives], ['ok', []]);

    // les cas fabriqués : la dérive est vue, et nommée
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'regle-site-'));
    try {
        for (const f of Object.keys(emp.sources)) fs.copyFileSync(path.join(siteLib, f), path.join(tmp, f));
        H.v('copie conforme du site : ok', C.verifier({ siteLib: tmp }).etat, 'ok');
        fs.appendFileSync(path.join(tmp, 'imageDeLImpression.ts'), '\n// dérive\n');
        const d = C.verifier({ siteLib: tmp });
        H.v('un fichier du site modifié : DÉRIVE, nommé', [d.etat, d.derives], ['derive', ['imageDeLImpression.ts']]);
        fs.copyFileSync(path.join(siteLib, 'imageDeLImpression.ts'), path.join(tmp, 'imageDeLImpression.ts'));
        fs.writeFileSync(path.join(tmp, 'visuels-anglais-regardes.json'), JSON.stringify({ cles: ['x'] }));
        H.v('un JSON du site modifié : DÉRIVE, nommé', C.verifier({ siteLib: tmp }).derives, ['visuels-anglais-regardes.json']);
        fs.rmSync(path.join(tmp, 'cardmarket.ts'));
        H.v('un fichier du site manquant (dossier présent) : DÉRIVE, pas « absent »', [C.verifier({ siteLib: tmp }).etat, C.verifier({ siteLib: tmp }).derives.includes('cardmarket.ts')], ['derive', true]);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    H.v('dossier du site absent : « site-absent », ni ok ni dérive', C.verifier({ siteLib: path.join(os.tmpdir(), 'nexiste-pas-' + process.pid) }).etat, 'site-absent');

    // la règle embarquée se charge, a ses six fonctions, et dit la même chose que celle du site (.ts) sur des cas fabriqués
    const R = require('../chargeur/regle-site');
    const regle = await R.regleEmbarquee();
    H.v('règle embarquée : les six fonctions', ['fichesDuDocument', 'setParImpression', 'produitsDeLaFiche', 'visuelAdmisPourLaRegion', 'normaliserNumero', 'cardmarketUrl'].map(k => typeof regle[k]), Array(6).fill('function'));
    let leve = null; try { await R.regleEmbarquee({ importer: async () => ({}) }); } catch (e) { leve = e.message; }
    H.vrai('   un module sans la fonction demandée LÈVE en la nommant (jamais un repli sur une règle vide)', /fichesDuDocument|cardmarketUrl|produitsDeLaFiche/.test(leve || ''));
    if (etat.etat !== 'site-absent') {
        const site = await require('../migrations/exporter-visuels').chargerRegle();
        const imps = [{ numero: '006', total: '100', rarete: 'Rare' }, { numero: '6' }, { numero: 'TG05', rarete: 'Ultra' }, { numero: null }];
        H.v('   fichesDuDocument : identique au site', regle.fichesDuDocument(imps), site.fichesDuDocument(imps));
        H.v('   normaliserNumero : identique au site', ['006', 6, ' tg05 ', null, '', undefined].map(regle.normaliserNumero), ['006', 6, ' tg05 ', null, '', undefined].map(site.normaliserNumero));
        const vis = [{ cleR2: 'a/1.webp' }, { cleR2: 'artofpkm/2.webp', langue: 'ja' }, { cleR2: 'b/3.webp', langue: 'en' }, { cleR2: 'c/4.webp', languePreuve: 'fichier source 734×1024' }, { cleR2: 'd/5.webp', languePreuve: 'fichier source 1×1' }];
        for (const reg of ['jp', 'intl', 'zh-hans', 'idth', 'ko']) H.v(`   visuelAdmisPourLaRegion(${reg}) : identique au site`, vis.map(v => regle.visuelAdmisPourLaRegion(v, reg)), vis.map(v => site.visuelAdmisPourLaRegion(v, reg)));
        const prod = [{ idProduct: 1, slug: 'Agatha-V1', slugSet: 'X' }, { idProduct: 2, slug: 'Agatha-V2', slugSet: 'X' }, { idProduct: 3, slug: 'Agatha-V3', slugSet: 'X' }];
        H.v('   produitsDeLaFiche : identique au site', [0, 1, 2].map(r => regle.produitsDeLaFiche(prod, r, ['210', '129', '186'], 'SV')), [0, 1, 2].map(r => site.produitsDeLaFiche(prod, r, ['210', '129', '186'], 'SV')));
        H.v('   cardmarketUrl : identique au site', regle.cardmarketUrl({ slug: 'Pikachu-V1-BS58', slugSet: 'Base-Set' }), site.cardmarketUrl({ slug: 'Pikachu-V1-BS58', slugSet: 'Base-Set' }));
    }
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
