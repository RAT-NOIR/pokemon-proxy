// AC2 — Sur les 8 lignes de la classe « sans total, sans setCode, numéro de Pokédex » :
// la vérité et ses concurrents appartiennent-ils à des CLASSES DE SYMBOLE différentes ?
// Si oui sur les 8, le symbole résout la classe entière. Si une ligne oppose deux sets du
// MÊME symbole, c'est la part que le symbole ne sauvera pas — et il faut la connaître.
// LECTURE SEULE. MESURE SEULEMENT, aucune écriture, aucun correctif.
require('dotenv').config();
const mongoose = require('mongoose');
const S = require('./scoring');
const { SETS_VINTAGE_JAPONAIS, EXPANSIONS_VINTAGE } = require('./sets-vintage-japonais');
const { trouverProduitsLocaux, scorerCandidatsLocal, lireCodeSets } = require('./index');
const { numeroEstUnDexId } = require('./pokedex');
const { numeroter, identiteDe, rattacherVerites } = require('./banc-seaux');
const SAISIES = require('./banc-verites.json').verites;

// Le symbole DÉCLARÉ dans la table close, par code de set.
const symboleDe = new Map();
for (const s of SETS_VINTAGE_JAPONAIS) {
    symboleDe.set(S.normaliserCodeSet(s.code), { symbole: s.symbole, fiable: s.symboleFiable, nom: s.nom, annee: s.annee });
}

(async () => {
    const t0 = Date.now();
    while (mongoose.connection.readyState !== 1 && Date.now() - t0 < 30000) await new Promise(r => setTimeout(r, 100));
    console.log(`base : ${mongoose.connection.db.databaseName} (LECTURE SEULE)\n`);
    const db = mongoose.connection.db;

    const docs = (await db.collection('journal_scans').find({}).sort({ le: 1 }).toArray())
        .map(d => ({ ...d, le: new Date(d.le) }));
    const { lignes } = numeroter(docs);
    const rat = rattacherVerites(lignes, SAISIES);

    const nums = await db.collection('numeros_cartes').find({}, { projection: { idProduct: 1, idExpansion: 1, numero: 1, numeroUrl: 1 } }).toArray();
    const expDe = new Map(nums.map(n => [n.idProduct, n.idExpansion]));
    const cs = await db.collection('codes_set').find({}, { projection: { idExpansion: 1, codeSet: 1 } }).toArray();
    const codeDe = new Map(cs.map(x => [Number(x.idExpansion), x.codeSet]));
    const codeDuProduit = id => codeDe.get(Number(expDe.get(id))) ?? '?';

    const classe = id => {
        const c = S.normaliserCodeSet(codeDuProduit(id));
        const s = symboleDe.get(c);
        return { code: codeDuProduit(id), symbole: s ? s.symbole : '(hors table close)', fiable: s ? s.fiable : null, set: s ? s.nom : null };
    };

    // Les 8 lignes de la classe, prises dans le seau LOT : dex déclenché, sans total, sans setCode.
    const cibles = lignes.filter(l => {
        const d = l.d;
        if (l.seau !== 'lot') return false;
        const avis = numeroEstUnDexId({ nom: d.nom, numero: d.numero, total: d.total, langue: d.langue });
        return avis.estDex && !d.total && !d.setCode;
    });
    console.log(`${cibles.length} ligne(s) de la classe « sans total · sans setCode · numéro de Pokédex »\n`);

    let toutesDistinctes = 0, collisions = [];
    for (const l of cibles) {
        const d = l.d;
        const v = rat.parIdentite.get(identiteDe(d));
        const attendu = v && v.idProduct !== 'inconnu' ? v.idProduct : null;
        const issue = attendu == null ? 'sans vérité' : (d.idProduct === attendu ? 'JUSTE' : (d.idProduct == null ? 'REFUS' : 'FAUX'));

        // Le vivier tel que le périmètre vintage le construit.
        const parNom = await trouverProduitsLocaux(d.nom);
        const dedans = parNom.filter(p => EXPANSIONS_VINTAGE.has(Number(p.idExpansion)));
        const codes = await lireCodeSets(dedans.map(p => p.idExpansion));
        const cardInfoNeutre = {
            name: d.nom, number: null, total: d.total, setCode: d.setCode, language: d.langue,
            rarete: d.rarete, nomBrut: d.nomBrut, nomConfiance: d.nomConfiance,
            motif: null, reverse: false, rareteElevee: false
        };
        const r = await scorerCandidatsLocal(dedans, cardInfoNeutre, null, [], codes, {});
        const meilleur = r.scores.length ? r.scores[0].score : null;
        const exaequo = r.scores.filter(s => s.score === meilleur);

        console.log(`${'─'.repeat(74)}`);
        console.log(`${l.cle}  "${d.nom}" n°${d.numero}  ->  ${issue}`);
        const cv = attendu != null ? classe(attendu) : null;
        console.log(`   VÉRITÉ      ${attendu ?? '—'}  ${cv ? `${cv.code.padEnd(6)} symbole « ${cv.symbole} »${cv.fiable === false ? ' (NON fiable)' : ''}  ${cv.set ?? ''}` : ''}`);
        if (d.idProduct != null) {
            const cr = classe(d.idProduct);
            console.log(`   RETENU      ${d.idProduct}  ${cr.code.padEnd(6)} symbole « ${cr.symbole} »${cr.fiable === false ? ' (NON fiable)' : ''}  ${cr.set ?? ''}`);
        } else {
            console.log(`   RETENU      (refus)`);
        }
        console.log(`   ${exaequo.length} candidat(s) au meilleur score (${meilleur}) sur ${r.scores.length} :`);
        const vus = [];
        for (const s of exaequo) {
            const id = s.candidat.idProduct;
            const c = classe(id);
            const marque = id === attendu ? ' <- VÉRITÉ' : (id === d.idProduct ? ' <- retenu' : '');
            console.log(`      ${String(id).padEnd(8)} ${c.code.padEnd(6)} symbole « ${String(c.symbole).padEnd(22)} »${c.fiable === false ? ' NON-FIABLE' : ''}${marque}`);
            vus.push({ id, ...c });
        }
        // ════════════════════════════════════════════════════════════════════
        // LA QUESTION EXACTE : LE SYMBOLE DE LA VÉRITÉ EST-IL UNIQUE PARMI SES CONCURRENTS ?
        // ════════════════════════════════════════════════════════════════════
        // Ce n'est PAS « tous les candidats ont-ils des symboles distincts ». Deux
        // concurrents qui partagent un symbole ne gênent pas : ce qu'il faut, c'est que la
        // BONNE carte soit désignée sans ambiguïté. Comparer les concurrents entre eux
        // répondrait à une question que personne ne pose.
        const dansLeVivier = dedans.some(p => p.idProduct === attendu);
        if (attendu == null) {
            console.log(`   (pas de vérité saisie — hors mesure)`);
        } else if (!dansLeVivier) {
            // LE CAS QUE LE SYMBOLE NE PEUT PAS SAUVER : la bonne carte n'est même pas
            // candidate. Le périmètre vintage ne peut que RESTREINDRE — s'il exclut la
            // vérité, aucun signal de départage n'y changera rien.
            collisions.push({ cle: l.cle, nom: d.nom, cause: 'vérité HORS du périmètre', detail: cv ? cv.code : '?' });
            console.log(`   ⛔ LA VÉRITÉ N'EST PAS DANS LE VIVIER : « ${cv?.code} » est hors de la table close.`);
            console.log(`      Aucun symbole ne peut désigner une carte qui n'est pas candidate.`);
        } else {
            const symVerite = String(classe(attendu).symbole);
            const concurrents = r.scores.map(s => s.candidat.idProduct).filter(id => id !== attendu);
            const memeSymbole = concurrents.filter(id => String(classe(id).symbole) === symVerite);
            if (memeSymbole.length) {
                collisions.push({
                    cle: l.cle, nom: d.nom, cause: `${memeSymbole.length} concurrent(s) au MÊME symbole « ${symVerite} »`,
                    detail: memeSymbole.map(id => `${id} ${classe(id).code}`).join(', ')
                });
                console.log(`   ⚠️ ${memeSymbole.length} concurrent(s) portent LE MÊME symbole que la vérité (« ${symVerite} ») :`);
                for (const id of memeSymbole) console.log(`        ${id} ${classe(id).code}`);
            } else {
                toutesDistinctes++;
                const fiable = classe(attendu).fiable;
                console.log(`   ✅ le symbole « ${symVerite} » de la vérité est UNIQUE parmi les ${r.scores.length} candidats` +
                    `${fiable === false ? '  ⚠️ mais il est marqué NON FIABLE' : ''}`);
            }
        }
    }

    console.log(`\n${'═'.repeat(74)}`);
    console.log(`${toutesDistinctes}/${cibles.length} lignes où le symbole de la VÉRITÉ est unique parmi ses concurrents`);
    if (collisions.length) {
        console.log(`\n⚠️ ${collisions.length} ligne(s) que le symbole NE SAUVERA PAS :`);
        for (const c of collisions) console.log(`   ${c.cle} "${c.nom}" — ${c.cause}  [${c.detail}]`);
    }
    process.exit(0);
})();
