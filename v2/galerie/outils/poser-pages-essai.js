'use strict';
// GALERIE — OUTIL D'EXPLOITATION (pas une route : la liste fermée reste fermée) : pose des pages d'essai dans le fil de la Communauté, pour que l'essai ne montre pas un fil vide.
// Écrit pour l'ADMINISTRATEUR, lancé à la main :
//     node v2/galerie/outils/poser-pages-essai.js --confirmer-essai --donnees=<fichier.json> --auteur=<pseudo>
// Le fichier JSON est celui de l'opérateur ({ "pages": [ { titre, categories, n, cartes, attributs?, pages?, pagesSuite?, arts? } ] }) : AUCUNE donnée inventée ne vit dans le dépôt.
// La garde s'écrit par ce qu'elle AUTORISE : la cible n'est pas la production ; la base est la base dédiée (grappe déclarée, marqueur, liste fermée de collections) ; l'auteur a un pseudo ;
// et toutes les pages sont validées AVANT la première écriture (un fichier à moitié faux ne pose rien). Les arts cités doivent exister et être publics (service.publierPourExploitation).
const fs = require('fs');
const G = require('../base');
const F = require('../forme');
const svc = require('../service');
const { verifierContenu } = require('../grappe');

const MAX_PAGES = 50, MAX_OCTETS = 1024 * 1024;
/** Production : NODE_ENV=production ou V2_CIBLE=prod ; V2_CIBLE=essai désigne l'essai hébergé en mode production (même règle que config.js). */
const cibleProduction = env => ((env && env.NODE_ENV) === 'production' || (env && env.V2_CIBLE) === 'prod') && (env && env.V2_CIBLE) !== 'essai';
const refus = (cause, detail) => ({ ok: false, cause, detail });

/** Lit le fichier de l'opérateur : borné, JSON strict. Lève si illisible. */
function lireDonnees(fichier) {
    const st = fs.statSync(fichier);
    if (!st.isFile() || st.size > MAX_OCTETS) throw new Error('fichier-invalide');
    return JSON.parse(fs.readFileSync(fichier, 'utf8'));
}

/** Une page d'essai prête pour publierPourExploitation, ou une raison de refus. */
function preparer(x, auteurId) {
    if (!F.objet(x)) return { raison: 'page' };
    const pages = x.pages === undefined ? 1 : x.pages;
    if (F.problemeTexte(x.titre, { min: 1, max: 80 })) return { raison: 'titre' };
    if (!Array.isArray(x.categories) || x.categories.some(c => !F.CATEGORIES.includes(c))) return { raison: 'categories' };
    if (![3, 4].includes(x.n)) return { raison: 'n' };
    if (!Number.isInteger(pages) || pages < 1 || pages > 100) return { raison: 'pages' };
    const suite = x.pagesSuite === undefined ? [] : x.pagesSuite;
    if (!Array.isArray(suite) || suite.length !== pages - 1) return { raison: 'pagesSuite' };
    return { p: { auteurId, titre: x.titre, categories: x.categories, n: x.n, pages, arts: x.arts || [], cartes: x.cartes || [], pagesSuite: suite.map(s => ({ ...s, arts: (s && s.arts) || [], cartes: (s && s.cartes) || [] })),
        attributs: x.attributs, etat: 'public', certification: { cgu: 'essai' } } };
}

/** Pose les pages. Rend { ok:true, ids } | { ok:false, cause, detail } — jamais d'exception pour un refus attendu. */
async function poserPages({ donnees, pseudo, env = process.env }) {
    if (cibleProduction(env)) return refus('cible-production');
    const contenu = await verifierContenu(G.base()).then(() => null, e => e);
    if (contenu) return refus((contenu && contenu.cause) || 'base-illisible', contenu && contenu.detail);
    if (!F.objet(donnees) || !Array.isArray(donnees.pages) || donnees.pages.length > MAX_PAGES) return refus('donnees-invalides', 'pages');
    const profil = typeof pseudo === 'string' && pseudo ? await G.col('profils').findOne({ pseudoCle: pseudo }, { projection: { _id: 1 } }) : null;
    if (!profil) return refus('auteur-inconnu');
    const pretes = [];
    for (const [i, x] of donnees.pages.entries()) { const r = preparer(x, profil._id); if (r.raison) return refus('donnees-invalides', `page ${i + 1} : ${r.raison}`); pretes.push(r.p); }
    const ids = [];
    for (const [i, p] of pretes.entries()) {
        try { ids.push(await svc.publierPourExploitation(p)); }
        catch (e) { return { ...refus('donnees-invalides', `page ${i + 1}`), ids }; }
    }
    return { ok: true, ids };
}

/** La ligne de commande. Rend le code de sortie. `env` : les variables (injectables). */
async function main(argv, env = process.env) {
    const args = new Map(); const extra = [];
    for (const a of argv) { const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a); if (m && ['confirmer-essai', 'donnees', 'auteur'].includes(m[1])) args.set(m[1], m[2] === undefined ? true : m[2]); else extra.push(a); }
    if (extra.length || args.get('confirmer-essai') !== true || typeof args.get('donnees') !== 'string' || typeof args.get('auteur') !== 'string' || !args.get('donnees') || !args.get('auteur')) {
        console.error('usage : poser-pages-essai.js --confirmer-essai --donnees=<fichier.json> --auteur=<pseudo>');
        return 1;
    }
    if (cibleProduction(env)) { console.error('🔴 cible production : refusé'); return 1; }
    let donnees; try { donnees = lireDonnees(args.get('donnees')); } catch (e) { console.error('🔴 fichier de données illisible ou trop gros'); return 1; }
    let ouverte = null;
    try {
        ouverte = await require('../grappe').ouvrir({ env });
        G.brancher(ouverte.db, ouverte.fermer);
        const r = await poserPages({ donnees, pseudo: args.get('auteur'), env });
        if (!r.ok) { console.error(`🔴 refusé : ${r.cause}${r.detail ? ` (${r.detail})` : ''}`); return 1; }
        console.log(`✅ ${r.ids.length} page(s) d'essai posée(s)`);
        return 0;
    } catch (e) { console.error(`🔴 refusé : ${(e && e.cause) || (e && e.name) || 'erreur'}`); return 1; }
    finally { await G.debrancher(); }
}

module.exports = { poserPages, lireDonnees, main, cibleProduction };
if (require.main === module) main(process.argv.slice(2)).then(c => process.exit(c));
