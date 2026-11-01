'use strict';
// DECISION-SURS — BANC DE MUTATION de l'extinction automatique (serie-essai.js) : chaque condition est CASSÉE à tour de rôle (_mutation-precharge.js) et test-extinction-surs.js doit ÉCHOUER. Aucune base, aucun réseau.
const { spawnSync } = require('child_process');
const path = require('path');
const H = require('./_harnais');
const BANC = 'test-extinction-surs.js', PRECHARGE = path.join(__dirname, '_mutation-precharge.js'), F = 'v2/mesures/serie-essai.js';
const MUTATIONS = [
    { nom: 'décision : un sûr JUSTE éteint (comparaison inversée)', de: 'x.sur === true && x.produit !== verite', vers: 'x.sur === true && x.produit === verite' },
    { nom: 'décision : une question ou un probable éteint (le « sûr » n\'est plus exigé)', de: 'x.sur === true && x.produit !== verite', vers: 'x.produit !== verite' },
    { nom: 'décision : une vérité inconnue est jugée', de: 'if (!Number.isInteger(verite)) return non(', vers: 'if (false) return non(' },
    { nom: 'décision : n\'importe quelle variable est éteignable', de: 'if (!VARIABLES_EXTINCTION.includes(variable)) return non(', vers: 'if (false) return non(' },
    { nom: 'série : la décision n\'éteint plus (rien n\'est posé, rien ne s\'arrête)', de: 'if (d.eteindre) {', vers: 'if (false) {' },
    { nom: 'série : l\'arrêt n\'est plus dit (arret reste nul)', de: 'arret = `EXTINCTION AUTOMATIQUE', vers: 'void `EXTINCTION AUTOMATIQUE' },
    { nom: 'série : l\'extinction n\'est plus écrite au carnet', de: 'carnet.noter({ serie: serieId, rang, cle: l.cle, extinction });', vers: '' },
    { nom: 'série : l\'heure n\'est plus celle de l\'horloge injectée', de: 'new Date((deps.maintenant || Date.now)())', vers: 'new Date(0)' },
    { nom: 'série : le commit attendu n\'est pas transmis', de: 'commit: o.commitEssai });', vers: 'commit: null });' },
    { nom: 'série : une exception de l\'outil est propagée', de: "catch (x) { res = { ok: false, statut: null, erreur: (x && (x.code || x.name)) || 'erreur' }; }", vers: 'catch (x) { throw x; }' },
    { nom: 'série : le commit n\'est plus exigé avant la série', de: "if (!COMMIT_ESSAI.test(String(o.commitEssai))) throw new Arret('--eteindre-si-sur-faux exige", vers: "if (false) throw new Arret('--eteindre-si-sur-faux exige" },
    { nom: 'série : la variable n\'est plus contrôlée avant la série', de: 'if (!VARIABLES_EXTINCTION.includes(eteindre)) throw new Arret(', vers: 'if (false) throw new Arret(' },
    { nom: 'exécuteur : la valeur posée n\'est plus 0', de: "{ valeur: '0' }", vers: "{ valeur: '1' }" },
    { nom: 'exécuteur : --appliquer n\'est plus passé (essai à blanc seulement)', de: "spec, '--appliquer', `--attendu=${commit}`]", vers: "spec, `--attendu=${commit}`]" },
    { nom: 'exécuteur : la spécification temporaire n\'est plus retirée', de: 'try { fs.unlinkSync(spec); } catch { /* spécification déjà retirée */ }', vers: '' },
    { nom: 'exécuteur : le code de sortie de l\'outil n\'est plus lu', de: 'return { ok: r.status === 0, statut: r.status };', vers: 'return { ok: true, statut: r.status };' }
];
function lancer(m) {
    const env = { ...process.env }; delete env.LEVIERS_MUTATION;
    const args = [];
    if (m) { env.LEVIERS_MUTATION = JSON.stringify({ fichier: F, de: m.de, vers: m.vers }); args.push('--require', PRECHARGE); }
    args.push(path.join(__dirname, BANC));
    return spawnSync(process.execPath, args, { env, encoding: 'utf8', timeout: 120000, cwd: path.join(__dirname, '..', '..') }).status;
}
H.v('témoin : sans mutation, le banc réussit', lancer(null), 0);
let tues = 0; const surv = [];
for (const m of MUTATIONS) {
    const c = lancer(m);
    if (c === 99 || c === 98) { H.vrai(`mutation INVALIDE (ancre absente, ambiguë ou jamais chargée) : ${m.nom} [code ${c}]`, false); continue; }
    if (c !== 0) tues++; else surv.push(m.nom);
    H.vrai(`mutation tuée : ${m.nom}  [code ${c}]`, c !== 0);
}
console.log(`\n${tues} mutations tuées sur ${MUTATIONS.length} · survivantes ${surv.length}${surv.length ? ' : ' + JSON.stringify(surv) : ''}`);
H.bilan();
