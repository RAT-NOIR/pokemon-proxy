'use strict';
// BREVO — la copie EMBARQUÉE des gabarits de courriel du site (lib/courriels.ts et sa fermeture), comme la règle du site (test-chargeur-regle-site.js) : sans base.
// Verdict DÉTERMINISTE : la copie = ce que produit le commit ÉPINGLÉ (git show), `main` du site n'y entre pas (sa dérive est un avertissement imprimé, cf. test-courriels-auto.js).
// Site ou commit épinglé absent : DIT en tête (« NON VÉRIFIÉ »), jamais un vert muet ; une copie retouchée échoue dans tous les cas.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const H = require('./_harnais');
const C = require('../comptes/copier-courriels-site');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
(async () => {
    const emp = JSON.parse(fs.readFileSync(path.join(C.DOSSIER, 'empreintes.json'), 'utf8'));
    H.v('les sept sources du site sont empreintées (offre.ts depuis le commit 67d259e)', Object.keys(emp.sources).sort(), ['courriels.ts', 'courrielsGabarit.ts', 'extension.ts', 'montants.ts', 'offre.ts', 'site.ts', 'tarifs.ts']);
    H.v('le commit NOMMÉ est écrit dans les empreintes (forme complète) et correspond à C.COMMIT', [/^[0-9a-f]{40}$/.test(emp.commit || ''), emp.commit.startsWith(C.COMMIT)], [true, true]);
    for (const [nom, h] of Object.entries(emp.produits)) H.v(`   ${nom} : la copie n'a pas été retouchée à la main`, sha(fs.readFileSync(path.join(C.DOSSIER, nom))), h);
    H.v('   aucune copie ne cite encore un fichier .ts', Object.keys(emp.produits).filter(n => /from\s+["'][^"']+\.ts["']/.test(fs.readFileSync(path.join(C.DOSSIER, n), 'utf8'))), []);
    // VERDICT DÉTERMINISTE : la copie = ce que produit le commit ÉPINGLÉ (git show), rien d'autre. `main` du site n'entre PAS dans le verdict.
    const etat = C.verifier();
    if (etat.etat === 'non-verifie') console.log(`⚠️ NON VÉRIFIÉ (${etat.raison}) : l'égalité de la copie avec le commit épinglé ${C.COMMIT} n'est PAS contrôlée par ce banc (seule la copie non retouchée l'est) — jamais un vert à lire comme « conforme à l'épingle »`);
    else H.v(`copie régénérée depuis le commit épinglé ${C.COMMIT} : identique`, [etat.etat, etat.derives], ['ok', []]);
    // AVERTISSEMENT, jamais un échec : le site a-t-il avancé ?
    console.log(C.avertissement(C.deriveDuSite()));
    // la fermeture est gardée par ce qu'elle autorise
    let msg = null; try { C.fermeture('x.ts', 'import { a } from "./inconnu.ts";', C.SOURCES); } catch (e) { msg = e.message; }
    H.vrai('une importation hors de la liste fait LEVER la fermeture, en nommant le fichier', /inconnu\.ts/.test(msg || ''));
    // la copie fonctionne : les onze gabarits du site se chargent et rendent objet / texte / HTML
    const m = await import(require('url').pathToFileURL(path.join(C.DOSSIER, 'courriels.mjs')).href);
    const c = m.COURRIELS.creationCompte({ adresse: 'a@exemple.fr', lienConfirmation: 'https://rat-market.fr/fr/verification?jeton=abc' });
    H.v('la copie rend un courriel de création de compte complet', [typeof c.objet, c.html.includes('<html'), c.texte.includes('https://rat-market.fr/fr/verification?jeton=abc')], ['string', true, true]);
    H.v('   onze gabarits exposés', Object.keys(m.COURRIELS).length, 11);
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
