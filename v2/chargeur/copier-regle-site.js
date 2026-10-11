'use strict';
// COTES-VISUELS — l'OUTIL qui refait la copie EMBARQUÉE des règles du site (rat-market-site/lib), et la vérifie.
//   node v2/chargeur/copier-regle-site.js              refait v2/chargeur/regle-site/ depuis le site (Node 24+ : stripTypeScriptTypes)
//   node v2/chargeur/copier-regle-site.js --verifier   code 0 : la copie est conforme au site ; 1 : DÉRIVE (fichiers nommés) ; 2 : site absent (non vérifié, dit)
// Pourquoi une copie : le dossier du site N'EXISTE PAS sur Render, et le serveur y tourne en Node 22.x, qui n'exécute pas le TypeScript. On embarque donc des `.mjs` PRODUITS par
// retrait des types (la source du site n'est jamais modifiée), avec l'empreinte sha256 de chaque fichier source. Le banc test-chargeur-regle-site.js échoue quand le site diffère
// de son empreinte (jamais de dérive silencieuse) et dit « site absent » quand il n'est pas là. Une seule copie de choisirVisuel : celle de exporter-donnees-logos-site.js.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');

const DOSSIER = path.join(__dirname, 'regle-site');
const SITE_LIB = path.join(__dirname, '..', '..', '..', 'rat-market-site', 'lib');
// la fermeture TRANSITIVE des imports des quatre modules dont la décision a besoin (fichesDuDocument/setParImpression, produitsDeLaFiche/cardmarketUrl, visuelAdmisPourLaRegion, normaliserNumero)
const TS = Object.freeze(['imageDeLImpression.ts', 'impressionsDuSet.ts', 'cardmarket.ts', 'langueDuVisuel.ts']);
const JSONS = Object.freeze(['visuels-japonais-sur-sets-intl.json', 'visuels-anglais-regardes.json']);
const SOURCES = Object.freeze([...TS, ...JSONS]);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const sortie = nom => nom.replace(/\.ts$/, '.mjs');

/** Produit la copie en mémoire : { sources: {nom: sha}, fichiers: {nomSortie: Buffer} }. Lève si une source manque ou si le retrait des types n'existe pas. */
function produire(siteLib = SITE_LIB) {
    const { stripTypeScriptTypes } = require('node:module');
    if (typeof stripTypeScriptTypes !== 'function') throw new Error('node:module.stripTypeScriptTypes absent (Node 23.2+ requis pour REFAIRE la copie ; l\'exécution de la copie n\'en a pas besoin)');
    const sources = {}, fichiers = {};
    for (const nom of SOURCES) {
        const brut = fs.readFileSync(path.join(siteLib, nom));
        sources[nom] = sha(brut);
        if (nom.endsWith('.json')) { fichiers[nom] = brut; continue; }
        const code = stripTypeScriptTypes(brut.toString('utf8'), { mode: 'strip' }).replace(/(from\s+["']\.\/[^"']+)\.ts(["'])/g, '$1.mjs$2');
        fichiers[sortie(nom)] = Buffer.from(code, 'utf8');
    }
    return { sources, fichiers };
}

function ecrire(siteLib = SITE_LIB, dossier = DOSSIER) {
    const { sources, fichiers } = produire(siteLib);
    fs.mkdirSync(dossier, { recursive: true });
    const produits = {};
    for (const [nom, buf] of Object.entries(fichiers)) { fs.writeFileSync(path.join(dossier, nom), buf); produits[nom] = sha(buf); }
    fs.writeFileSync(path.join(dossier, 'empreintes.json'), JSON.stringify({ commentaire: 'sha256 des fichiers SOURCE du site (rat-market-site/lib) et des fichiers produits ici ; refait par v2/chargeur/copier-regle-site.js', sources, produits }, null, 2) + '\n');
    return { sources, produits };
}

/** @returns {{ etat: 'ok'|'derive'|'site-absent', derives: string[], regenerationSautee?: boolean }} */
function verifier({ siteLib = SITE_LIB, dossier = DOSSIER } = {}) {
    if (!fs.existsSync(siteLib)) return { etat: 'site-absent', derives: [] };
    const emp = JSON.parse(fs.readFileSync(path.join(dossier, 'empreintes.json'), 'utf8'));
    const derives = [];
    for (const nom of SOURCES) {
        let h = null; try { h = sha(fs.readFileSync(path.join(siteLib, nom))); } catch { /* manquant : dérive */ }
        if (h !== emp.sources[nom]) derives.push(nom);
    }
    if (derives.length) return { etat: 'derive', derives };
    // les sources sont celles de l'empreinte : la copie embarquée doit être EXACTEMENT ce que l'outil en produit
    try {
        const { fichiers } = produire(siteLib);
        for (const [nom, buf] of Object.entries(fichiers)) { let h = null; try { h = sha(fs.readFileSync(path.join(dossier, nom))); } catch { /* manquant */ } if (h !== sha(buf)) derives.push(nom); }
    } catch (e) { return { etat: 'ok', derives: [], regenerationSautee: true }; }
    return derives.length ? { etat: 'derive', derives } : { etat: 'ok', derives: [] };
}

module.exports = { produire, ecrire, verifier, DOSSIER, SITE_LIB, SOURCES };

if (require.main === module) {
    if (process.argv.includes('--verifier')) {
        const r = verifier();
        if (r.etat === 'site-absent') { console.log(`⚠️ site absent (${SITE_LIB}) : copie NON vérifiée`); process.exit(2); }
        if (r.etat === 'derive') { console.error(`🔴 DÉRIVE : ${r.derives.join(', ')} — relancer node v2/chargeur/copier-regle-site.js`); process.exit(1); }
        console.log(`✅ copie conforme au site (${SOURCES.length} sources)${r.regenerationSautee ? ' — régénération sautée (Node sans stripTypeScriptTypes)' : ''}`); process.exit(0);
    }
    const r = ecrire();
    console.log(`copie refaite : ${Object.keys(r.produits).length} fichiers, ${SOURCES.length} sources empreintées`);
}
