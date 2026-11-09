// ============================================================
// CORRIGER LE NUMÉRO D'UNE IMPRESSION — une impression d'une carte, deux sources, sous lot
// ============================================================
//   node corriger-numero-impression.js --carte=217135 --expansion="Ultra Sun" --tirage=jp --avant=055 --apres=056 --preuve=<fichier.json> --attendu=1      (simulation)
//   node lot-additif.js --quoi="…" --collections=cartes -- node corriger-numero-impression.js … --attendu=1 --ecrire
// MODIFICATION (pas un ajout) : feu vert NOMMÉ requis avant `--ecrire`. LA GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE : la carte existe ; exactement UNE impression à ce
// (tirage, expansion) porte `avant` tel quel (055 n'est pas 55) ; `apres` n'est porté par AUCUNE autre impression de ce set sur la carte (clé de numéro de la jointure :
// 056 = 56) ; l'impression n'a jamais été corrigée (`numeroAvant` absent : l'ancienne valeur ne s'écrase pas) ; le fichier de preuve porte un motif et au moins DEUX
// sources d'hôtes https DISTINCTS ; `--attendu` (obligatoire) = le nombre d'écritures planifiées (1).
// Écriture : UN updateOne sur `impressions.$.numero`, avec `numeroAvant`, `numeroCorrigeLe`, `numeroCorrigeMotif` sur la même impression. Rien d'autre ne bouge (le total non plus).
// `--ecrire` ne tourne que SOUS lot-additif.js, enfant direct. Réversible : remettre `numeroAvant` dans `numero`.
const AUTORISES = [/^--carte=\d+$/, /^--expansion=.+$/, /^--tirage=[^\s,]+$/, /^--avant=\S+$/, /^--apres=\S+$/, /^--preuve=.+$/, /^--attendu=\d+$/, /^--ecrire$/];

function lireArguments(argv) {
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) return { erreur: `argument inconnu ou invalide : ${inconnus.join(' ')} — autorisés : --carte= --expansion= --tirage= --avant= --apres= --preuve=<fichier> --attendu=N [--ecrire]` };
    const un = n => argv.filter(a => a.startsWith(`--${n}=`));
    for (const n of ['carte', 'expansion', 'tirage', 'avant', 'apres', 'preuve', 'attendu']) {
        if (un(n).length > 1) return { erreur: `--${n} répété` };
        if (!un(n).length) return { erreur: `--${n} obligatoire` };
    }
    if (argv.filter(a => a === '--ecrire').length > 1) return { erreur: '--ecrire répété' };
    const v = n => un(n)[0].slice(n.length + 3);
    return { carte: Number(v('carte')), expansion: v('expansion'), tirage: v('tirage'), avant: v('avant'), apres: v('apres'), preuve: v('preuve'), attendu: Number(v('attendu')), ecrire: argv.includes('--ecrire') };
}

/** Domaine enregistrable (eTLD+1) : deux sous-domaines d'un même site ne sont pas deux sources. Liste fermée des suffixes à deux niveaux (co.uk…), sinon les deux derniers labels. */
const SUFFIXES_2 = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu']);
function domaineEnregistrable(h) {
    const l = String(h).toLowerCase().split('.').filter(Boolean);
    if (l.length <= 2) return l.join('.');
    return (l[l.length - 1].length === 2 && SUFFIXES_2.has(l[l.length - 2]) ? l.slice(-3) : l.slice(-2)).join('.');
}

/** Les hôtes https distincts des sources d'une preuve : { hotes: string[], motif }. */
function lirePreuve(preuve) {
    const hotes = new Set();
    for (const s of Array.isArray(preuve?.sources) ? preuve.sources : []) {
        try { const u = new URL(s?.url); if (u.protocol === 'https:') hotes.add(domaineEnregistrable(u.hostname)); } catch (_) { /* source illisible : ne compte pas */ }
    }
    return { hotes: [...hotes], motif: typeof preuve?.motif === 'string' ? preuve.motif.trim() : '' };
}

/** Le cœur, pur. a = { carte, expansion, tirage, avant, apres, attendu } ; monde = { carteDoc } ; preuve = le contenu du fichier. */
function planifier(a, { carteDoc, lignes }, preuve) {
    const { cleNumero } = require('./collecte-cartes/jointure');
    const refus = [];
    const R = m => { refus.push(m); };
    const p = preuve ? lirePreuve(preuve) : null;
    if (!p) R('preuve absente');
    else {
        if (p.hotes.length < 2) R(`preuve : deux sources d'hôtes https distincts exigées, ${p.hotes.length} lue(s)`);
        if (!p.motif) R('preuve : motif absent');
    }
    if (typeof a.apres !== 'string' || !a.apres.trim()) R('apres vide');
    else if (a.apres === a.avant) R('apres identique à avant');
    let motifImp = null;
    if (!carteDoc) R(`carte ${a.carte} absente de la base`);
    else {
        const duSet = (carteDoc.impressions || []).filter(i => i && i.tirage === a.tirage && i.expansion === a.expansion);
        if (!duSet.length) R(`aucune impression de la carte ${a.carte} au tirage « ${a.tirage} » et à l'expansion « ${a.expansion} »`);
        else {
            const cand = duSet.filter(i => i.numero === a.avant);
            if (!cand.length) R(`avant ne concorde pas : « ${a.avant} » absent (numéros du set sur la carte : ${JSON.stringify(duSet.map(i => i.numero ?? null))})`);
            else if (cand.length > 1) R(`l'impression n'est pas unique : ${cand.length} impressions « ${a.avant} » à ce tirage et cette expansion`);
            else {
                if (cand[0].numeroAvant != null) R(`impression déjà corrigée (numeroAvant ${JSON.stringify(cand[0].numeroAvant)}) : l'ancienne valeur ne s'écrase pas`);
                const cn = cleNumero(a.apres);
                if (!cn || !cleNumero(a.avant)) R(`numéro inexploitable par la clé de la jointure (avant ${JSON.stringify(a.avant)}, apres ${JSON.stringify(a.apres)})`);
                else if (duSet.some(i => i !== cand[0] && i.numero != null && cleNumero(i.numero) === cn)) R(`apres « ${a.apres} » déjà pris par une autre impression de ce set sur la carte`);
                motifImp = p?.motif ?? null;
            }
        }
    }
    // Les lignes cartes_produits de CETTE carte dont numeroFiche vaut vant : elles désigneraient l'ancien numéro. Aucune ne se réécrit ici (jamais une ligne existante) : refus nommé.
    const lignesAvant = (lignes || []).filter(l => l && l.carteId === a.carte && l.numeroFiche != null && cleNumero(l.numeroFiche) && cleNumero(l.numeroFiche) === cleNumero(a.avant));
    if (lignesAvant.length) R(` ligne(s) de la carte portent numeroFiche «  » () : à changer dans le même geste, jamais écrit ici — refus`);
    const operations = [];
    if (!refus.length) {
        operations.push({ filter: { _id: a.carte, impressions: { $elemMatch: { tirage: a.tirage, expansion: a.expansion, numero: a.avant, numeroAvant: { $exists: false } } } },
            update: { $set: { 'impressions.$.numero': a.apres, 'impressions.$.numeroAvant': a.avant, 'impressions.$.numeroCorrigeLe': new Date(), 'impressions.$.numeroCorrigeMotif': motifImp } } });
    }
    if (a.attendu === undefined || a.attendu === null) R('attendu absent');
    else if (!refus.length && a.attendu !== operations.length) R(`attendu ${a.attendu} différent des ${operations.length} écriture(s) planifiée(s)`);
    if (refus.length) operations.length = 0;
    return { ok: !refus.length, refus, operations, ecritures: operations.length, lignesAvant: lignesAvant.length };
}

/** `--ecrire` ne tourne que SOUS lot-additif.js : il pose LOT_ADDITIF_PID = son pid, et la commande en est l'enfant direct. */
function garderSousLot(env, ppid, commande = 'node lot-additif.js --quoi="…" --collections=cartes -- node corriger-numero-impression.js --carte=… --expansion=… --tirage=… --avant=… --apres=… --preuve=… --attendu=1 --ecrire') {
    if (!env || !env.LOT_ADDITIF_PID || env.LOT_ADDITIF_PID !== String(ppid)) throw new Error(`--ecrire refusé hors de lot-additif.js : ${commande} (rien n'est écrit)`);
}

/** Relecture : une impression du set porte `apres`, avec `numeroAvant` = avant, et plus aucune ne porte `avant`. */
function releve({ carteDoc }, a) {
    const duSet = (carteDoc?.impressions || []).filter(i => i && i.tirage === a.tirage && i.expansion === a.expansion);
    const ok = !!carteDoc && duSet.some(i => i.numero === a.apres && i.numeroAvant === a.avant) && !duSet.some(i => i.numero === a.avant);
    return { ok, detail: `carte ${carteDoc ? carteDoc._id : 'absente'} · numéros du set ${JSON.stringify(duSet.map(i => [i.numero ?? null, i.numeroAvant ?? null]))}` };
}

async function lireMonde(db, a) {
    return {
        carteDoc: await db.collection('cartes').findOne({ _id: a.carte }, { projection: { nomEn: 1, impressions: 1 } }),
        lignes: await db.collection('cartes_produits').find({ carteId: a.carte }).toArray(),
    };
}

/** Simulation ou écriture, sur une base injectée. Rend { ok, code, message?, modifiees, plan, lignes[] } ; n'imprime rien. */
async function executer(db, a, preuve) {
    const lignes = [];
    const m = await lireMonde(db, a);
    const plan = planifier(a, m, preuve);
    lignes.push(`carte ${a.carte}${m.carteDoc?.nomEn ? ` « ${m.carteDoc.nomEn} »` : ''} · ${a.tirage} « ${a.expansion} » : ${JSON.stringify(a.avant)} → ${JSON.stringify(a.apres)} · sources ${JSON.stringify(lirePreuve(preuve).hotes)}`);
    if (!plan.ok) return { ok: false, code: 1, modifiees: 0, plan, lignes, message: `REFUS : ${plan.refus.join(' ; ')} — rien n'est écrit` };
    lignes.push(`✓ ${plan.ecritures} écriture(s) planifiée(s) : impressions.$.numero ${JSON.stringify(a.avant)} → ${JSON.stringify(a.apres)} (numeroAvant, date et motif sur l'impression)`);
    if (!a.ecrire) return { ok: true, code: 0, modifiees: 0, plan, lignes };
    const o = plan.operations[0];
    const r = await db.collection('cartes').updateOne(o.filter, o.update);
    if (r.modifiedCount !== 1) return { ok: false, code: 1, modifiees: 0, plan, lignes, message: '🔴 ARRÊT : l\'écriture n\'a rien modifié' };
    const rl = releve(await lireMonde(db, a), a);
    lignes.push(`${rl.ok ? '✅' : '🔴'} 1/1 modifiée · RELU : ${rl.detail}`);
    return { ok: rl.ok, code: rl.ok ? 0 : 1, modifiees: 1, plan, lignes, message: rl.ok ? undefined : '🔴 la relecture ne concorde pas' };
}

module.exports = { lireArguments, lirePreuve, domaineEnregistrable, planifier, garderSousLot, releve, lireMonde, executer };

if (require.main === module) {
    const a = lireArguments(process.argv.slice(2));
    if (a.erreur) { console.error(`❌ ${a.erreur}`); process.exit(2); }
    require('dotenv').config({ quiet: true });
    if (a.ecrire) { try { garderSousLot(process.env, process.ppid); } catch (e) { console.error(`❌ ${e.message}`); process.exit(2); } }
    (async () => {
        let preuve;
        try { preuve = JSON.parse(require('fs').readFileSync(a.preuve, 'utf8')); } catch (e) { console.error(`❌ fichier de preuve illisible : ${e.message}`); process.exit(2); }
        const { ouvrirLecture } = require('./poser-fiches-prouvees');
        const cx = a.ecrire ? await require('./collecte-cartes/garde').ouvrirConnexions({ production: true, buckets: [] }) : await ouvrirLecture();
        try {
            const r = await executer(cx.cartes.db, a, preuve);
            for (const l of r.lignes) console.log(l);
            if (r.message) console.error(r.message);
            else if (!a.ecrire) console.log('(simulation seule — --ecrire sous lot-additif.js, feu vert nommé requis : modification)');
            if (r.code) process.exitCode = r.code;
        } finally { await cx.fermer(); }
    })().catch(e => { console.error('❌', e.message); process.exit(1); });
}
