// ============================================================
// INVARIANT DE LA TABLE CLOSE — une seule source marque des points
// ============================================================
// LA RÈGLE QU'IL FAIT RESPECTER. La table close (sets-vintage-japonais.js) déclare une
// région pour chacune de ses lignes, mais le SCORING ne la lit pas : il lit
// `codes_set.region` (voir lireRegions dans index.js). Deux sources de vérité, donc, et
// c'est la famille de défauts déjà rencontrée avec LANGUES_ASIATIQUES.
//
// LE CAS QUI L'A MOTIVÉ, MESURÉ. Le Raichu du testeur (654243, Intro-Pack-Bulbasaur) était
// dans le périmètre fermé et perdait quand même : sa ligne de table le déclarait japonais,
// mais `codes_set.region` valait INCONNUE, donc le scoring lui donnait 0 point de région
// pendant que ses huit concurrents en touchaient 45. La table savait, le classement
// l'ignorait — et l'écart valait exactement les 45 points qui l'éliminaient.
//
// L'INVARIANT : toute expansion admise dans la table close DOIT avoir sa région écrite
// dans codes_set. La table ne marque pas de points ; codes_set en marque. Ce test échoue
// tant qu'une ligne fait exception, et le message dit laquelle.
//
// LECTURE SEULE. USAGE : node test-table-vintage.js

require('dotenv').config();
const mongoose = require('mongoose');
const { SETS_VINTAGE_JAPONAIS, SETS_NON_PROUVES, EXPANSIONS_VINTAGE } = require('./sets-vintage-japonais');
mongoose.set('strictQuery', false);
const CS = mongoose.model('CSv', new mongoose.Schema({}, { strict: false }), 'codes_set');
const Num = mongoose.model('Nv', new mongoose.Schema({}, { strict: false }), 'numeros_cartes');

let ok = 0, ko = 0;
function verifier(libelle, bon, detail = '') {
    console.log(`  ${bon ? '✅' : '❌'} ${libelle}${detail ? ` — ${detail}` : ''}`);
    bon ? ok++ : ko++;
}

(async () => {
    await mongoose.connect(process.env.MONGODB_URI, { dbName: 'test' });
    console.log(`\nbase : ${mongoose.connection.db.databaseName} (lecture seule)\n`);
    const lignes = await CS.find({}).lean();
    const parExp = new Map(lignes.map(l => [Number(l.idExpansion), l]));

    console.log(`=== ${SETS_VINTAGE_JAPONAIS.length} lignes admises ===`);
    let sansRegion = 0;
    for (const s of SETS_VINTAGE_JAPONAIS) {
        const cs = parExp.get(Number(s.exp));
        if (!cs) { verifier(`${s.code} — ligne codes_set présente`, false, `expansion ${s.exp} absente`); continue; }
        const bon = cs.region === 'japonais';
        if (!bon) sansRegion++;
        verifier(`${String(s.code).padEnd(9)} région écrite dans codes_set`, bon,
            bon ? `source: ${cs.regionSource}` : `région « ${cs.region ?? 'INCONNUE'} » — le scoring lui donnera 0 point au lieu de +45`);
    }

    // Le slug doit toujours désigner CETTE expansion, et une seule.
    console.log(`\n=== Les slugs désignent-ils toujours une expansion unique ? ===`);
    for (const s of SETS_VINTAGE_JAPONAIS) {
        const exps = [...new Set((await Num.find({ slugSet: s.slug }, { idExpansion: 1 }).lean()).map(d => Number(d.idExpansion)))];
        verifier(`${String(s.code).padEnd(9)} ${s.slug}`, exps.length === 1 && exps[0] === Number(s.exp),
            exps.length === 0 ? 'slug ABSENT' : exps.length > 1 ? `${exps.length} expansions` : (exps[0] !== Number(s.exp) ? `pointe sur ${exps[0]}, pas ${s.exp}` : ''));
    }

    console.log(`\n=== Cohérence interne ===`);
    verifier('aucune ligne sans expansion', SETS_VINTAGE_JAPONAIS.every(s => s.exp != null));
    verifier('aucun doublon d\'expansion', new Set(SETS_VINTAGE_JAPONAIS.map(s => s.exp)).size === SETS_VINTAGE_JAPONAIS.length);
    verifier('EXPANSIONS_VINTAGE couvre toutes les lignes', EXPANSIONS_VINTAGE.size === SETS_VINTAGE_JAPONAIS.length);
    verifier('chaque non-prouvée porte son motif', SETS_NON_PROUVES.every(s => s.preuveManquante));

    console.log(`\n${ko === 0 ? '🎉' : '💥'} ${ok}/${ok + ko} assertions passées.${sansRegion ? `  ⚠️ ${sansRegion} ligne(s) sans région en base.` : ''}`);
    await mongoose.disconnect();
    process.exit(ko === 0 ? 0 : 1);
})().catch(async e => { console.error('❌ ERREUR', e.message); try { await mongoose.disconnect(); } catch (_) { } process.exit(1); });
