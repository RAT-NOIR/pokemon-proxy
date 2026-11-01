'use strict';
// MUTATIONS de la garde « essai, jamais production » (--tamponnees-empruntees, tour 4) : UNE mutation par garde ; chacune doit faire ÉCHOUER v2/test/test-tamponnees-empruntees-liste.js. Le fichier est restauré (octet pour octet) dans tous les cas.
//   node v2/mesures/mutations-cible-essai.js        code 0 : toutes les mutations sont ROUGES ; code 1 : une mutation survit (nommée)
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const RACINE = path.join(__dirname, '..', '..');
const f = (...p) => path.join(RACINE, ...p);
const TE = f('v2', 'chargeur', 'tamponnees-empruntees.js'), CO = f('v2', 'migrations', 'construire-fichier-visuels.js'), SO = f('v2', 'chargeur', 'source.js');
const MUTATIONS = [
    ['V2_CIBLE exactement « essai »', TE, "env.V2_CIBLE !== 'essai'", 'false'],
    ['bucket visé == bucket d\'essai (avec dépôt)', TE, 'vise !== essai', 'false'],
    ['R2_BUCKET_IMAGES obligatoire', TE, "['R2_BUCKET_IMAGES', texteEnv(env.R2_BUCKET_IMAGES)], ", ''],
    ['V2_VISUELS_PROD_BUCKET obligatoire', TE, ", ['V2_VISUELS_PROD_BUCKET', texteEnv(env.V2_VISUELS_PROD_BUCKET)]", ''],
    ['R2_BUCKET_BANC comparé', TE, "['R2_BUCKET_BANC', texteEnv(env.R2_BUCKET_BANC)]", "['R2_BUCKET_BANC', '']"],
    ['essai != chaque bucket de production', TE, 'v === essai', 'false'],
    ['base exactement rm_essai', TE, "baseConnectee !== 'rm_essai'", 'false'],
    ['base vide/illisible refuse (commande)', CO, "typeof nom === 'string' ? nom : ''", "typeof nom === 'string' ? nom : null"],
    ['base vide/illisible refuse (source réelle)', SO, "typeof o.nomBase === 'string' ? o.nomBase : ''", "typeof o.nomBase === 'string' ? o.nomBase : null"],
    ['le refus du contrôle est appliqué (source réelle)', SO, 'if (!r || r.ok !== true)', 'if (false)'],
    ['un contrôle jamais exécuté refuse (commande)', CO, 's && s.ok && !controleFait', 'false'],
    ['le catalogue vient d\'un fichier', CO, 'catalogueJson === null && !deps.catalogue', 'false']
];
const survivantes = [];
for (const [nom, fichier, ancien, nouveau] of MUTATIONS) {
    const original = fs.readFileSync(fichier);
    try {
        const t = original.toString('utf8');
        if (!t.includes(ancien)) { console.log(`❓ ${nom} : motif introuvable (la mutation ne s'applique pas)`); survivantes.push(nom + ' (motif introuvable)'); continue; }
        fs.writeFileSync(fichier, t.replace(ancien, nouveau));
        const r = spawnSync(process.execPath, [f('v2', 'test', 'test-tamponnees-empruntees-liste.js')], { encoding: 'utf8', timeout: 120000 });
        const rouge = r.status !== 0;
        console.log(`${rouge ? '🔴 rouge' : '🟢 SURVIT'} : ${nom}`);
        if (!rouge) survivantes.push(nom);
    } finally { fs.writeFileSync(fichier, original); }
}
const verifie = spawnSync(process.execPath, [f('v2', 'test', 'test-tamponnees-empruntees-liste.js')], { encoding: 'utf8', timeout: 120000 });
console.log(`après restauration : banc ${verifie.status === 0 ? 'vert' : 'ROUGE (restauration à vérifier)'}`);
console.log(survivantes.length ? `MUTATIONS SURVIVANTES : ${survivantes.join(' ; ')}` : `${MUTATIONS.length} mutations, toutes ROUGES`);
process.exit(survivantes.length || verifie.status !== 0 ? 1 : 0);
