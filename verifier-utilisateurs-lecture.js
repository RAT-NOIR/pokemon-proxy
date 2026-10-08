// Contrôle des utilisateurs Atlas EN LECTURE SEULE — à lancer UNE fois, par le coordinateur, le jour où le testeur les aura créés, AVANT tout banc :
//   node verifier-utilisateurs-lecture.js
// Il se connecte avec chacune des deux variables de lecture (MONGODB_LECTURE_URI -> base « test », MONGODB_CARTES_LECTURE_URI -> base « cartes »), appelle la MÊME
// verifierPrivilegesLecture que les bancs (connectionStatus avec showPrivileges : aucune écriture, aucune lecture de données), et imprime pour chacune « OK » ou la liste
// COMPLÈTE des ressources et actions qui la font refuser. Variable absente ou jugée dangereuse (= URI d'écriture, même utilisateur, autre grappe) : refus avec LE MÊME
// message que les bancs (jugerLecture), sans connexion. Pourquoi : la forme réelle de connectionStatus pour un utilisateur Atlas « Only read any database » n'est vérifiable
// nulle part aujourd'hui ; une action de lecture légitime absente de ACTIONS_LECTURE ferait échouer les bancs le jour J — ce contrôle la nomme avant eux.
// Sortie 0 seulement si les DEUX utilisateurs sont OK. Aucune valeur de variable n'est imprimée.
const { LECTURES, jugerLecture, verifierPrivilegesLecture } = require('./collecte-cartes/base-banc');

/** Contrôle chaque utilisateur de lecture. `mongoose` est injectable (faux client dans les bancs). Rend [{ quoi, variable, base, ok, raison }]. */
async function verifierUtilisateurs(env, mongoose) {
    const resultats = [];
    for (const [quoi, d] of Object.entries(LECTURES)) {
        const j = jugerLecture(env, quoi);
        if (!j.ok) { resultats.push({ quoi, variable: d.variable, base: d.grappe, ok: false, raison: j.raison }); continue; }
        let cx = null, r;
        try {
            // autoIndex/autoCreate à false : même précaution que les bancs ; rien ne se crée avant le constat
            cx = await mongoose.createConnection(j.uri, { dbName: d.grappe, autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 }).asPromise();
            r = await verifierPrivilegesLecture(cx.db, d.grappe);
        } catch (e) {
            r = { ok: false, raison: `🔴 connexion ou constat impossible (${e?.codeName || e?.name || 'erreur'}) : doute = refus.` };
        } finally {
            try { if (cx) await cx.close(); } catch (_) { /* rien à ajouter au résultat */ }
        }
        resultats.push({ quoi, variable: d.variable, base: d.grappe, ok: !!r.ok, raison: r.ok ? null : r.raison });
    }
    return resultats;
}

module.exports = { verifierUtilisateurs };

if (require.main === module) {
    require('dotenv').config();
    (async () => {
        const res = await verifierUtilisateurs(process.env, require('mongoose'));
        for (const r of res) console.log(r.ok ? `✅ OK : ${r.variable} (base « ${r.base} ») ne porte que des droits de lecture.` : `❌ ${r.variable} (base « ${r.base} ») :\n   ${r.raison}`);
        console.log(`\n${res.filter(r => r.ok).length}/${res.length} utilisateurs de lecture OK`);
        process.exit(res.every(r => r.ok) ? 0 : 1);
    })().catch(e => { console.error(e?.message || e); process.exit(1); });
}
