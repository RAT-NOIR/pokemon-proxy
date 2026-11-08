'use strict';
// VÉRIFIER-ABSENCE-PARCOURS — la condition de l'éditeur, lue STRICTEMENT : « l'exemption et la route d'administration des parcours du site sont ABSENTES du code servi en production ».
//   node outils/verifier-absence-parcours.js <dossier>     (le dossier = la racine d'un arbre, par exemple le commit de production à la bascule)
// Écrite par ce qu'elle AUTORISE : l'arbre passe seulement si TOUT ceci est vrai — `<dossier>/v2` existe et se lit, `<dossier>/v2/essai-parcours` n'existe pas (ni fichier, ni dossier, ni lien),
// et AUCUN fichier JavaScript sous `<dossier>/v2` (hors `v2/test`) ne contient « essai-parcours ». Tout le reste échoue, y compris ce qu'on ne sait pas lire : « je ne sais pas » n'est jamais « tout va bien ».
// Sortie : les CHEMINS fautifs, jamais un contenu de fichier. Code de sortie 0 (absent) ou 1 (présent, ou illisible). Lecture seule ; aucun lien suivi.
const fs = require('fs'), path = require('path');
const MOTIF = 'essai-parcours';

/** → { ok: boolean, fautes: string[] } */
function verifier(dossier) {
    const fautes = [];
    if (typeof dossier !== 'string' || !dossier) return { ok: false, fautes: ['dossier non donné'] };
    const v2 = path.join(dossier, 'v2');
    try { if (!fs.statSync(v2).isDirectory()) return { ok: false, fautes: ['v2 n\'est pas un dossier'] }; } catch { return { ok: false, fautes: ['v2 introuvable ou illisible : arbre non vérifiable'] }; }
    try { fs.lstatSync(path.join(v2, MOTIF)); fautes.push(`v2/${MOTIF} existe`); } catch (e) { if (!e || e.code !== 'ENOENT') fautes.push(`v2/${MOTIF} illisible`); }
    (function parcourir(d, rel) {
        let entrees; try { entrees = fs.readdirSync(d, { withFileTypes: true }); } catch { fautes.push(`${rel || 'v2'} illisible`); return; }
        for (const e of entrees) {
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isSymbolicLink()) continue;                                     // jamais un lien suivi
            if (e.isDirectory()) { if (r === 'test' || e.name === 'node_modules' || e.name === MOTIF) continue; parcourir(path.join(d, e.name), r); }
            else if (/\.(?:js|cjs|mjs)$/.test(e.name)) {
                try { if (fs.readFileSync(path.join(d, e.name), 'utf8').includes(MOTIF)) fautes.push(`v2/${r} fait référence à ${MOTIF}`); } catch { fautes.push(`v2/${r} illisible`); }
            }
        }
    })(v2, '');
    return { ok: fautes.length === 0, fautes };
}
module.exports = { verifier, MOTIF };

if (require.main === module) {
    const r = verifier(process.argv[2]);
    if (r.ok) { console.log('OUI : aucune trace de essai-parcours sous v2/ (dossier absent, aucune référence hors v2/test).'); process.exit(0); }
    console.log(`NON : ${r.fautes.length} faute(s)`); for (const f of r.fautes) console.log(`  - ${f}`);
    process.exit(1);
}
