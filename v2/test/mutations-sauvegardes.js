'use strict';
// SAUVEGARDES — les MUTATIONS des gardes : chaque garde est cassée à tour de rôle, dans le fichier de production, et les bancs test-sauvegardes.js ET test-sauvegardes-tour1.js (lancés en parallèle) DOIVENT devenir
// rouges. Un banc qui reste vert sur une garde cassée ne la garde pas. Le fichier est rétabli (octet pour octet) quoi qu'il arrive ; le dépôt n'est jamais laissé muté.
// Lancement : node v2/test/mutations-sauvegardes.js [fragment du nom]   (dure longtemps : les bancs sont rejoués une fois par mutation)
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const D = path.join(__dirname, '..', 'sauvegardes');
const MUTATIONS = [
    ['garde du bucket : un bucket de variable inconnue (public) est admis', 'config.js', 'if (inconnus.length) return', 'if (false) return'],
    ['garde du bucket : l\'adresse publique déclarée est admise', 'config.js', "if (texte(env.V2_SAUVEGARDE_R2_URL_PUBLIQUE)) return", 'if (false) return'],
    ['garde du bucket : n\'importe quel hôte est admis', 'config.js', "if (!/^[a-z0-9-]{8,64}(\\.(eu|fedramp))?\\.r2\\.cloudflarestorage\\.com$/.test(u.hostname)) return null;", ''],
    ['garde du nom de restauration : toute base est admise', 'restaurer.js', 'const FORME_RESTAURATION = /^rm_essai_restau_[a-z0-9_]{1,40}$/;', 'const FORME_RESTAURATION = /^[A-Za-z0-9_]+$/;'],
    ['garde du nom de restauration : le préfixe sans le souligné final', 'restaurer.js', 'rm_essai_restau_[a-z0-9_]{1,40}$/;', 'rm_essai_restau[a-z0-9_]{0,40}$/;'],
    ['garde de la grappe de restauration : la même grappe sous un autre compte est admise', 'restaurer.js', "if (!h.length || h.some(x => miennes.has(cleDeGrappe(x)))) refuser('grappe-refusee');", ''],
    ['garde de la grappe de restauration : une URI illisible est admise', 'restaurer.js', "if (!hotes.length) refuser('grappe-refusee');", ''],
    ['rétention : plus aucune sauvegarde gardée', 'retention.js', 'verifiables.slice(garder)', 'verifiables.slice(0)'],
    ['rétention : un objet hors de la forme du mécanisme est concerné', 'chemins.js', '|| !FORME_OBJET.test(reste[1])', ''],
    ['rétention : une sauvegarde non vérifiable est retirée comme les autres', 'retention.js', 'if (await verifier({ stockage, cle, base, id, objets })) verifiables.push(id); else inverifiables.push(id);', 'verifiables.push(id);'],
    ['vide : une sauvegarde sans collection est valide (le every sur la liste vide)', 'manifeste.js', [['|| m.collections.length === 0', ''], ["const COLLECTIONS_EXIGEES = Object.freeze(['comptes']);", 'const COLLECTIONS_EXIGEES = Object.freeze([]);']]],
    ['vide : `comptes` vide est admise', 'manifeste.js', "if (c.documents === 0) return { ok: false, raison: 'collection-exigee-vide' };", ''],
    ['vide : `comptes` absente est admise', 'manifeste.js', "if (!c) return { ok: false, raison: `collection-exigee-absente` }; ", 'if (!c) continue; '],
    ['vide : l\'export d\'une base sans collection est admis', 'export.js', "if (!infos.length) refuser('base-vide');", ''],
    ['vide : l\'export vérifie `comptes` après avoir écrit, pas avant', 'export.js', "if (!(await db.collection(nom).findOne({}, { projection: { _id: 1 } }))) refuser('collection-exigee-vide');", ''],
    ['dernière : un identifiant daté de plus d\'1 h dans le futur est admis', 'manifeste.js', ' && +dateDeId(id) <= +maintenant + FUTUR_MAX_MS', ''],
    ['dernière : décidée sur le nom, sans déchiffrer le manifeste', 'manifeste.js', 'const manifeste = await verifier({ stockage, cle, base, id: c.id, objets: c.objets });', 'const manifeste = { collections: [] };'],
    ['liste : une liste tronquée sans jeton est rendue comme complète', 'stockage-r2.js', [["if (!r.NextContinuationToken) refuser('liste-tronquee');", 'if (!r.NextContinuationToken) break;'], ["if (!complete) refuser('liste-tronquee');", '']]],
    ['liste : le plafond de pages rend une liste incomplète comme complète', 'stockage-r2.js', "if (!complete) refuser('liste-tronquee');", ''],
    ['bail : un autre peut libérer', 'bail.js', "const r = await col.updateOne({ _id: ID, detenteur: jeton }, { $set: { detenteur: null, expireLe: new Date(0) } });", "const r = await col.updateOne({ _id: ID }, { $set: { detenteur: null, expireLe: new Date(0) } });"],
    ['bail : un autre peut battre', 'bail.js', "const r = await col.updateOne({ _id: ID, detenteur: jeton }, { $set: { expireLe", "const r = await col.updateOne({ _id: ID }, { $set: { expireLe"],
    ['bail : la prise ignore l\'expiration et le détenteur', 'bail.js', '$or: [{ detenteur: null }, { expireLe: { $lte: now } }]', '$or: [{ detenteur: null }, { expireLe: { $lte: now } }, { _id: ID }]'],
    ['bail : perdu sur la moindre coupure', 'planificateur.js', 'catch { if (horloge() - dernierOk > TTL_MS) perdu = true; }', 'catch { perdu = true; }'],
    ['bail : un refus explicite est ignoré', 'planificateur.js', 'if (ok === false) perdu = true; else dernierOk = horloge();', 'dernierOk = horloge();'],
    ['bail : le silence de plus que le TTL n\'est pas vu', 'planificateur.js', 'if (!perdu && horloge() - dernierOk > TTL_MS) perdu = true; return !perdu;', 'return !perdu;'],
    ['chiffrement : l\'étiquette n\'est pas vérifiée (fichier)', 'chiffrement.js', 'try { const fin = decipher.final();', 'try { const fin = Buffer.alloc(0);'],
    ['chiffrement : l\'étiquette n\'est pas vérifiée (manifeste)', 'chiffrement.js', 'try { return Buffer.concat([d.update(tout.subarray(EN_TETE, tout.length - ETIQUETTE)), d.final()]); }', 'try { return Buffer.concat([d.update(tout.subarray(EN_TETE, tout.length - ETIQUETTE))]); }'],
    ['chiffrement : le contexte (aad) n\'est pas lié', 'chiffrement.js', "decipher.setAAD(aad);", ''],
    ['chiffrement : le nonce est fixe', 'chiffrement.js', 'const nonce = crypto.randomBytes(NONCE);', 'const nonce = Buffer.alloc(NONCE);'],
    ['chiffrement : une clé d\'un seul octet répété est admise', 'chiffrement.js', "if (cle.every(o => o === cle[0])) refuser('cle-invalide');", ''],
    ['aad : l\'identifiant de la sauvegarde n\'y est plus (rejeu sous un autre identifiant)', 'chemins.js', '|${id}|${objet}`', '|${objet}`'],
    ['aad : le nom de l\'objet n\'y est plus (échange de deux objets)', 'chemins.js', '|${id}|${objet}`', '|${id}`'],
    ['stockage : une clé hors du préfixe est admise', 'stockage-r2.js', '!cle.startsWith(PREFIXE) || ', ''],
    ['stockage : une clé qui remonte est admise', 'stockage-r2.js', "|| cle.includes('..')", ''],
    ['export : le bail n\'est pas du périmètre exclu (il est exporté)', 'export.js', ' && c.name !== NOM_BAIL', ''],
    ['export : les collections système et les vues sont exportées', 'export.js', "(c.type === undefined || c.type === 'collection') && !c.name.startsWith('system.')", 'true'],
    ['export : les vues et séries temporelles écartées ne sont pas listées', 'export.js', 'const ecartees = toutes.filter(', 'const ecartees = [].filter('],
    ['export : l\'ordre n\'est plus déterministe (pas de tri par _id)', 'export.js', 'sort: { _id: 1 }, ', ''],
    ['export : un envoi échoué laisse ses objets et le bail perdu est ignoré', 'export.js', "if ((await battement()) === false) refuser('bail-perdu');", ''],
    ['planificateur : on exporte même si la dernière a moins de 23 h', 'planificateur.js', 'const SEUIL_MS = 23 * 3600e3', 'const SEUIL_MS = 0'],
    ['planificateur : le bail n\'est pas pris', 'planificateur.js', "if (!(await bail.prendre())) { bail = null; return (issue = 'occupe'); }", ''],
    ['planificateur : la base connectée n\'est pas vérifiée', 'planificateur.js', "if (!db || db.databaseName !== cfg.base) {", "if (!db) {"],
    ['planificateur : l\'échec lève (le service meurt)', 'planificateur.js', "        return (issue = 'echec');\n    } finally", "        throw e;\n    } finally"],
    ['planificateur : le journal d\'échec porte le message de l\'erreur', 'planificateur.js', "journal(`❌ [v2 sauvegardes] sauvegarde échouée (${code(e)})`); } catch { /* le journal lui-même", "journal(`❌ [v2 sauvegardes] sauvegarde échouée (${e.message})`); } catch { /* le journal lui-même"],
    ['planificateur : le marqueur du bucket n\'est pas exigé', 'planificateur.js', 'await stockage.verifierMarqueur();', ''],
    ['frein : plafonné à une heure au lieu de croître', 'planificateur.js', '3600e3 * 2 ** Math.max(0, n - 1)', '3600e3'],
    ['frein : sans plafond de 12 h', 'planificateur.js', 'FREIN_MAX_MS = 12 * 3600e3', 'FREIN_MAX_MS = 1e15'],
    ['frein : l\'échec n\'est pas persisté en base', 'planificateur.js', "await enregistrer(col(), { echecs: echecsBase + 1, enCours: false, dernierEchecLe: maintenant() }, journal);", ''],
    ['frein : le succès ne remet pas le compteur à zéro', 'planificateur.js', "await enregistrer(col(), { echecs: 0, enCours: false, dernierSuccesLe: maintenant() }, journal);", ''],
    ['crash : la tentative n\'est pas écrite avant l\'export', 'planificateur.js', "if (!(await enregistrer(col(), { echecs: echecsBase, enCours: true, debutLe: maintenant(), ...(dernierEchecBase ? { dernierEchecLe: dernierEchecBase } : {}) }, journal))) return (issue = 'echec');", ''],
    ['crash : une tentative jamais conclue n\'est pas comptée comme un échec', 'planificateur.js', '+ (etat && etat.enCours ? 1 : 0);', '+ 0;'],
    ['crash : l\'heure de la tentative morte n\'est pas celle du frein', 'planificateur.js', 'dernierEchecBase = etat ? (etat.enCours ? etat.debutLe : etat.dernierEchecLe) : undefined;', 'dernierEchecBase = etat ? etat.dernierEchecLe : undefined;'],
    ['exclusion : un nom hors de la liste fermée est admis dans la configuration', 'config.js', 'if (exclure.some(n => !EXCLUSIONS_PERMISES.includes(n))) return', 'if (false) return'],
    ['exclusion : un nom hors de la liste fermée est admis à l\'export', 'export.js', "if (!Array.isArray(exclure) || exclure.some(n => !EXCLUSIONS_PERMISES.includes(n))) refuser('exclusion-refusee');", ''],
    ['exclusion : la liste fermée contient aussi `comptes`', 'manifeste.js', "Object.freeze(['references_image'])", "Object.freeze(['references_image', 'comptes'])"],
    ['exclusion : un manifeste qui exclut `comptes` est valide', 'manifeste.js', "if (m.exclues !== undefined && (!Array.isArray(m.exclues) || m.exclues.some(n => !EXCLUSIONS_PERMISES.includes(n)))) return { ok: false, raison: 'manifeste-incoherent' };", ''],
    ['exclusion : les collections exclues ne sont pas listées dans le manifeste', 'export.js', 'const exclues = infosToutes.filter(c => exclure.includes(c.name))', 'const exclues = [].filter(c => exclure.includes(c.name))'],
    ['exclusion : le planificateur ne transmet pas l\'exclusion', 'planificateur.js', ', exclure: cfg.exclure || [] });', ' });'],
    ['SIGTERM : aucun écouteur pendant l\'export', 'planificateur.js', "processus.once('SIGTERM', ecouteur);", ''],
    ['SIGTERM : un arrêt demandé est compté comme un échec', 'planificateur.js', "if (arretDemande) { await enregistrer(col(), { echecs: echecsBase, enCours: false }, journal); return (issue = 'arret'); }", ''],
    ['orphelines : pas retirées après un échec', 'planificateur.js', "try { await retention({ stockage, cle: cfg.cle, base: cfg.base, maintenant: maintenant(), orphelinesHeures: 1 }); }", 'try { }'],
    ['restauration : le contenu n\'est pas confronté au manifeste avant d\'écrire', 'restaurer.js', "if (n !== c.documents || hash.digest('hex') !== c.sha256Clair) refuser('contenu-different-du-manifeste');", ''],
    ['restauration : une base non vide est admise', 'restaurer.js', "refuser('base-non-vide');", ''],
    ['restauration : la base créée n\'est pas supprimée après un échec', 'restaurer.js', 'await client.db(nomBase).dropDatabase();', ''],
    ['restauration : les index TTL sont posés avant les insertions', 'restaurer.js', 'const sansTtl = (c.index || []).filter(x => !estTtl(x));', 'const sansTtl = (c.index || []);'],
    ['restauration : le validateur est posé à la création', 'restaurer.js', "const OPTIONS_APRES = ['validator', 'validationLevel', 'validationAction'];", 'const OPTIONS_APRES = [];'],
    ['restauration : les index se comparent par le nom seul', 'restaurer.js', 'return JSON.stringify(Object.fromEntries(Object.keys(e).sort().map(k => [k, e[k]])));', 'return JSON.stringify(e.name);'],
];
const lancerUn = (fichier) => new Promise(res => {
    const e = spawn(process.execPath, [path.join(__dirname, fichier)], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    let sortie = ''; e.stdout.on('data', d => { sortie += d; }); e.stderr.on('data', d => { sortie += d; });
    const k = setTimeout(() => e.kill(), 300000);
    e.on('close', status => { clearTimeout(k); res({ status, sortie }); });
});
const lancer = async () => {
    const r = await Promise.all(['test-sauvegardes.js', 'test-sauvegardes-tour1.js'].map(lancerUn));
    return { status: r.some(x => x.status !== 0) ? 1 : 0, bilans: r.map(x => (x.sortie.match(/(\d+) réussis, (\d+) échoués/) || ['pas de bilan'])[0]).join(' | ') };
};
(async () => {
    let rouges = 0, verts = [];
    const filtre = process.argv[2] || '';                                  // un fragment du nom : ne rejouer que celles-là
    const choisies = MUTATIONS.filter(m => m[0].includes(filtre));
    for (const [nom, fichier, de, vers] of choisies) {
        const chemin = path.join(D, fichier), original = fs.readFileSync(chemin);
        const texte = original.toString('utf8').replace(/\r\n/g, '\n');
        const paires = Array.isArray(de) ? de : [[de, vers]];            // une mutation peut casser PLUSIEURS lignes d'une même garde écrite en double (défense en profondeur)
        const mauvais = paires.map(([d]) => texte.split(d).length - 1).find(n => n !== 1);
        if (mauvais !== undefined) { console.log(`⚠️ ${nom} : un motif apparaît ${mauvais} fois (attendu 1) — mutation non jouée`); verts.push(nom); continue; }
        try {
            fs.writeFileSync(chemin, paires.reduce((t, [d, v]) => t.replace(d, () => v), texte));
            const { status, bilans } = await lancer();
            if (status !== 0) { rouges++; console.log(`🔴 rouge  : ${nom}  [${bilans}]`); } else { verts.push(nom); console.log(`🟢 VERT (la garde n'est pas gardée) : ${nom}  [${bilans}]`); }
        } finally { fs.writeFileSync(chemin, original); }
    }
    console.log(`\n${rouges} rouges sur ${choisies.length} mutations${verts.length ? `, ${verts.length} restée(s) verte(s) : ${verts.join(' | ')}` : ''}`);
    process.exitCode = verts.length ? 1 : 0;
})();
