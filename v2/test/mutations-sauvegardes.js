'use strict';
// SAUVEGARDES — les MUTATIONS des gardes : chaque garde est cassée à tour de rôle, dans le fichier de production, et le banc test-sauvegardes.js DOIT devenir rouge. Un banc qui reste vert
// sur une garde cassée ne la garde pas. Le fichier est rétabli (octet pour octet) quoi qu'il arrive ; le dépôt n'est jamais laissé muté.
// Lancement : node v2/test/mutations-sauvegardes.js   (dure quelques minutes : le banc est rejoué une fois par mutation)
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const D = path.join(__dirname, '..', 'sauvegardes');
const MUTATIONS = [
    ['garde du bucket : un bucket de variable inconnue (public) est admis', 'config.js', 'if (inconnus.length) return', 'if (false) return'],
    ['garde du bucket : l\'adresse publique déclarée est admise', 'config.js', "if (texte(env.V2_SAUVEGARDE_R2_URL_PUBLIQUE)) return", 'if (false) return'],
    ['garde du bucket : n\'importe quel hôte est admis', 'config.js', "if (!/^[a-z0-9-]{8,64}(\\.(eu|fedramp))?\\.r2\\.cloudflarestorage\\.com$/.test(u.hostname)) return null;", ''],
    ['garde du nom de restauration : toute base est admise', 'restaurer.js', 'const FORME_RESTAURATION = /^rm_essai_restau_[a-z0-9_]{1,40}$/;', 'const FORME_RESTAURATION = /^[A-Za-z0-9_]+$/;'],
    ['garde du nom de restauration : le préfixe sans le souligné final', 'restaurer.js', 'rm_essai_restau_[a-z0-9_]{1,40}$/;', 'rm_essai_restau[a-z0-9_]{0,40}$/;'],
    ['rétention : plus aucune sauvegarde gardée', 'retention.js', 'verifiables.slice(garder)', 'verifiables.slice(0)'],
    ['rétention : un objet hors de la forme du mécanisme est concerné', 'chemins.js', '|| !FORME_OBJET.test(reste[1])', ''],
    ['rétention : une sauvegarde non vérifiable est retirée comme les autres', 'retention.js', 'if (await verifier({ stockage, cle, base, id, objets })) verifiables.push(id); else inverifiables.push(id);', 'verifiables.push(id);'],
    ['bail : un autre peut libérer', 'bail.js', "const r = await col.updateOne({ _id: ID, detenteur: jeton }, { $set: { detenteur: null, expireLe: new Date(0) } });", "const r = await col.updateOne({ _id: ID }, { $set: { detenteur: null, expireLe: new Date(0) } });"],
    ['bail : un autre peut battre', 'bail.js', "const r = await col.updateOne({ _id: ID, detenteur: jeton }, { $set: { expireLe", "const r = await col.updateOne({ _id: ID }, { $set: { expireLe"],
    ['bail : la prise ignore l\'expiration et le détenteur', 'bail.js', '$or: [{ detenteur: null }, { expireLe: { $lte: now } }]', '$or: [{ detenteur: null }, { expireLe: { $lte: now } }, { _id: ID }]'],
    ['chiffrement : l\'étiquette n\'est pas vérifiée (fichier)', 'chiffrement.js', 'try { const fin = decipher.final();', 'try { const fin = Buffer.alloc(0);'],
    ['chiffrement : l\'étiquette n\'est pas vérifiée (manifeste)', 'chiffrement.js', 'try { return Buffer.concat([d.update(tout.subarray(EN_TETE, tout.length - ETIQUETTE)), d.final()]); }', 'try { return Buffer.concat([d.update(tout.subarray(EN_TETE, tout.length - ETIQUETTE))]); }'],
    ['chiffrement : le contexte (aad) n\'est pas lié', 'chiffrement.js', "decipher.setAAD(aad);", ''],
    ['chiffrement : le nonce est fixe', 'chiffrement.js', 'const nonce = crypto.randomBytes(NONCE);', 'const nonce = Buffer.alloc(NONCE);'],
    ['stockage : une clé hors du préfixe est admise', 'stockage-r2.js', '!cle.startsWith(PREFIXE) || ', ''],
    ['stockage : une clé qui remonte est admise', 'stockage-r2.js', "|| cle.includes('..')", ''],
    ['export : le bail n\'est pas du périmètre exclu (il est exporté)', 'export.js', ' && c.name !== NOM_BAIL', ''],
    ['export : les collections système et les vues sont exportées', 'export.js', "(c.type === undefined || c.type === 'collection') && !c.name.startsWith('system.')", 'true'],
    ['export : l\'ordre n\'est plus déterministe (pas de tri par _id)', 'export.js', 'sort: { _id: 1 }, ', ''],
    ['export : un envoi échoué laisse ses objets et le bail perdu est ignoré', 'export.js', "if ((await battement()) === false) refuser('bail-perdu');", ''],
    ['planificateur : on exporte même si la dernière a moins de 23 h', 'planificateur.js', 'const SEUIL_MS = 23 * 3600e3', 'const SEUIL_MS = 0'],
    ['planificateur : le bail n\'est pas pris', 'planificateur.js', 'if (!(await bail.prendre())) { bail = null; return \'occupe\'; }', ''],
    ['planificateur : la base connectée n\'est pas vérifiée', 'planificateur.js', "if (!db || db.databaseName !== cfg.base) {", "if (!db) {"],
    ['planificateur : l\'échec lève (le service meurt)', 'planificateur.js', "        return 'echec';\n    } finally", "        throw e;\n    } finally"],
    ['planificateur : le journal d\'échec porte le message de l\'erreur', 'planificateur.js', "sauvegarde échouée (${code(e)})", "sauvegarde échouée (${e.message})"],
    ['planificateur : le marqueur du bucket n\'est pas exigé', 'planificateur.js', 'await stockage.verifierMarqueur();', ''],
    ['restauration : le contenu n\'est pas confronté au manifeste avant d\'écrire', 'restaurer.js', "if (n !== c.documents || hash.digest('hex') !== c.sha256Clair) refuser('contenu-different-du-manifeste');", ''],
    ['restauration : une base non vide est admise', 'restaurer.js', "refuser('base-non-vide');", ''],
];
const lancer = () => new Promise(res => {
    const e = spawn(process.execPath, [path.join(__dirname, 'test-sauvegardes.js')], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    let sortie = ''; e.stdout.on('data', d => { sortie += d; }); e.stderr.on('data', d => { sortie += d; });
    const k = setTimeout(() => e.kill(), 300000);
    e.on('close', status => { clearTimeout(k); res({ status, sortie }); });
});
(async () => {
    let rouges = 0, verts = [];
    const filtre = process.argv[2] || '';                                  // un fragment du nom : ne rejouer que celles-là
    for (const [nom, fichier, de, vers] of MUTATIONS.filter(m => m[0].includes(filtre))) {
        const chemin = path.join(D, fichier), original = fs.readFileSync(chemin);
        const texte = original.toString('utf8');
        const n = texte.split(de).length - 1;
        if (n !== 1) { console.log(`⚠️ ${nom} : le motif apparaît ${n} fois (attendu 1) — mutation non jouée`); verts.push(nom); continue; }
        try {
            fs.writeFileSync(chemin, texte.replace(de, () => vers));
            const { status, sortie } = await lancer();
            const bilan = (sortie.match(/(\d+) réussis, (\d+) échoués/) || [])[0] || 'pas de bilan';
            if (status !== 0) { rouges++; console.log(`🔴 rouge  : ${nom}  [${bilan}]`); } else { verts.push(nom); console.log(`🟢 VERT (la garde n'est pas gardée) : ${nom}  [${bilan}]`); }
        } finally { fs.writeFileSync(chemin, original); }
    }
    console.log(`\n${rouges} rouges sur ${MUTATIONS.length} mutations${verts.length ? `, ${verts.length} restée(s) verte(s) : ${verts.join(' | ')}` : ''}`);
    process.exitCode = verts.length ? 1 : 0;
})();
