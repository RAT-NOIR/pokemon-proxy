'use strict';
// BREVO — la copie EMBARQUÉE des gabarits de courriel du site (lib/courriels.ts et sa fermeture), comme la règle du site (test-chargeur-regle-site.js) : sans base.
// Le site absent est DIT (jamais un vert muet) ; présent, un fichier source qui diffère de son empreinte, ou une copie retouchée, fait échouer ce banc.
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const H = require('./_harnais');
const C = require('../comptes/copier-courriels-site');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
(async () => {
    const emp = JSON.parse(fs.readFileSync(path.join(C.DOSSIER, 'empreintes.json'), 'utf8'));
    H.v('les six sources du site sont empreintées', Object.keys(emp.sources).sort(), ['courriels.ts', 'courrielsGabarit.ts', 'extension.ts', 'montants.ts', 'site.ts', 'tarifs.ts']);
    H.v('le commit NOMMÉ est écrit dans les empreintes (forme complète) et correspond à C.COMMIT', [/^[0-9a-f]{40}$/.test(emp.commit || ''), emp.commit.startsWith(C.COMMIT)], [true, true]);
    for (const [nom, h] of Object.entries(emp.produits)) H.v(`   ${nom} : la copie n'a pas été retouchée à la main`, sha(fs.readFileSync(path.join(C.DOSSIER, nom))), h);
    H.v('   aucune copie ne cite encore un fichier .ts', Object.keys(emp.produits).filter(n => /from\s+["'][^"']+\.ts["']/.test(fs.readFileSync(path.join(C.DOSSIER, n), 'utf8'))), []);
    const etat = C.verifier();
    if (etat.etat === 'site-absent') console.log('⚠️ SITE ABSENT : la synchronisation des gabarits avec le site n\'est PAS vérifiée par ce banc — jamais un vert à lire comme « à jour »');
    else H.v('le site présent : sources conformes aux empreintes (au commit nommé ET au main) et copie régénérée identique', [etat.etat, etat.derives], ['ok', []]);
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
