// ============================================================
// LA TABLE ET LA CALIBRATION DE LA JOINTURE « tcs » (T4) — lecture seule : le relevé du marché (fichier) + les produits Cardmarket (base en lecture seule, ou un fichier de dépôt)
// ============================================================
//   node calibrer-tcgcsv.js --releves=<releves-tcs.json> [--depuis=<cm.json>] [--sortie=<dossier>] [--slug]
//     1. la TABLE groupe -> expansion, MESURÉE (recouvrement des (numéro, nom), tirage compatible) -> table-groupes.json ; les groupes non appariés sont IMPRIMÉS ;
//     2. la CALIBRATION : la jointure rejouée sur les produits dont la carte est CONNUE (une fiche numérotée ET un visuel existant), la fiche n'entrant pas dans la clé -> justes / faux / muets -> calibration.json.
//   `--depuis` : un fichier { sets, cp, cartes, nc, cat } (le dépôt de la base, pour rejouer sans connexion). Sans lui : MONGODB_CARTES_LECTURE_URI et la production en lecture seule. AUCUNE écriture.
//   La clé n'est retenue (`retenue: true`) que si elle rend 0 faux ; sinon le rapport dit lesquels, et c'est la clé qu'on resserre.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const JT = require('./collecte-cartes/tcgcsv-jointure');
const D = require('./collecte-cartes/tcgcsv-donnees');

const arg = (args, nom) => args.find(a => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);
const groupesDuReleve = JT.groupesDuReleve, LANGUE_DE_CATEGORIE = JT.langueDeCategorieDe;
/** La calibration du NOM SEUL sur les lignes NUMÉROTÉES de la table : le numéro est caché à la clé, le témoin de la fiche le relit. Une ligne = un groupe contre l'ensemble de ses expansions. */
function calibrerNomSeulTout({ table, lus, cm }) {
    const total = { lignes: 0, lignesTaillesDifferentes: 0, produits: 0, justes: 0, faux: 0, muets: 0, nonJugeables: 0 }, fauxDetail = [];
    for (const l of table.lignes.filter(x => x.statut === 'apparie')) {
        const g = lus.get(l.groupId);
        const produits = [...new Set(l.expansions.map(e => e.idExpansion))].flatMap(id => cm.expansions.get(id)?.produits || []);
        const r = JT.calibrerNomSeul({ tcg: g.produits.filter(t => t.fort != null), cm: produits.map(p => ({ cm: p.lu, fiche: p.fiche && p.nImages > 0 ? p.fiche : null })) });
        total.lignes++;
        if (r.muetsParMotif['tailles-differentes']) { total.lignesTaillesDifferentes++; continue; }
        total.produits += r.total; total.justes += r.justes; total.faux += r.faux; total.muets += r.muets; total.nonJugeables += r.nonJugeables;
        for (const f of r.fauxDetail) fauxDetail.push({ groupId: l.groupId, nomGroupe: l.name, ...f, nomCm: cm.produits.get(f.idProduct)?.name });
    }
    return { ...total, retenue: total.justes > 0 && total.faux === 0, fauxDetail };
}
/** auxLus : { idProduct: raison } — les aux du témoin que l'OEIL a relus un à un (la jointure est juste, c'est la FICHE ou son nom qui diffère) ; ils sont comptés à part, jamais effacés. */
/** La calibration des decks de championnat du monde (groupe spécial 2282) : les produits WCD avec une fiche et un visuel jugent la clé (année, numéro d'origine, nom). */
function calibrerWcdTout({ rel, cm }) {
    const g = groupesDuReleve(rel).find(x => x.groupId === JT.GROUPE_WCD);
    if (!g) return { absent: true, retenue: false };
    const items = [...cm.produits.values()].filter(p => /^WCD-/.test(p.slugSet ?? '')).map(p => ({ cm: { idProduct: p.idProduct, name: p.name, slug: p.slug, slugSet: p.slugSet, codeSet: p.codeSet, idExpansion: p.idExpansion, numero: null }, fiche: p.fiche && p.nImages > 0 ? p.fiche : null }));
    return JT.calibrerWcd({ tcg: g.produits, cm: items });
}
function calibrerTout({ rel, cm, accepterSlug = false, fauxLus = {} }) {
    const groupes = groupesDuReleve(rel), langueDeCategorie = LANGUE_DE_CATEGORIE(rel.categories);
    const table = JT.construireTable({ groupes, expansions: D.expansionsPourTable(cm), langueDeCategorie });
    const lus = new Map(groupes.map(g => [g.groupId, { categoryId: g.categoryId, name: g.name, produits: g.produits.map(JT.lireTcg) }]));
    const jointure = JT.joindreTable({ table: table, groupes: lus, cm, accepterSlug });
    const tcgParId = new Map(); for (const g of lus.values()) for (const t of g.produits) tcgParId.set(t.productId, t);
    // la population de calibration : une fiche numérotée ET un visuel existant (la vérité est connue sans la jointure)
    const connus = [...cm.produits.values()].filter(p => p.fiche && p.nImages > 0 && p.fiche.impressions.some(i => i?.numero != null && /\d/.test(String(i.numero))));
    const compte = { population: connus.length, justes: 0, laches: 0, faux: 0, fauxLus: 0, muets: 0, nonJugeables: 0 }, fauxLusDetail = [], fauxDetail = [], lachesDetail = [], muetsParMotif = {}, fauxParCause = {}, lachesParCause = {};
    for (const p of connus) {
        const j = jointure.get(p.idProduct);
        if (!j?.joint) { compte.muets++; const m = j?.motif ?? 'inconnu'; muetsParMotif[m] = (muetsParMotif[m] || 0) + 1; continue; }
        const t = tcgParId.get(j.joint.productId), v = JT.temoinFiche(t, p.fiche, { cm: p.lu });
        const ligne = () => ({ idProduct: p.idProduct, nomCm: p.name, slugSet: p.slugSet, numero: p.numero, productId: t.productId, nomTcg: t.nomBrut, numeroTcg: t.numeroBrut, groupId: j.joint.groupId, niveau: j.joint.niveau, cause: v.cause });
        if (v.verdict === 'juste') compte.justes++;
        else if (v.verdict === 'non-jugeable') compte.nonJugeables++;
        else if (v.verdict === 'lache') { compte.laches++; const c = v.cause.split(' ')[0]; lachesParCause[c] = (lachesParCause[c] || 0) + 1; lachesDetail.push(ligne()); }
        else if (Object.hasOwn(fauxLus, p.idProduct)) { compte.fauxLus++; fauxLusDetail.push({ ...ligne(), lu: fauxLus[p.idProduct] }); }
        else { compte.faux++; const c = v.cause.split(' ')[0]; fauxParCause[c] = (fauxParCause[c] || 0) + 1; fauxDetail.push(ligne()); }
    }
    const tousJoints = [...jointure.values()].filter(x => x.joint).length;
    const nomSeul = calibrerNomSeulTout({ table, lus, cm });
    const wcd = calibrerWcdTout({ rel, cm });
    return { table, jointure, lus, nomSeul, wcd, calibration: { ...compte, retenue: compte.population > 0 && compte.justes > 0 && compte.faux === 0, muetsParMotif, fauxParCause, lachesParCause, fauxDetail, fauxLusDetail, lachesDetail, tousLesProduitsJoints: tousJoints, produitsCm: cm.produits.size, accepterSlug } };
}

async function main(args = process.argv.slice(2)) {
    const releves = arg(args, 'releves');
    if (!releves) throw new Error('--releves=<releves-tcs.json> exigé');
    const sortie = arg(args, 'sortie') ?? path.dirname(releves);
    const rel = JSON.parse(fs.readFileSync(releves, 'utf8'));
    if (!rel.listes || !rel.categories) throw new Error(`${releves} : ni listes de groupes ni catégories — relevé incomplet`);
    let donnees = null;
    if (arg(args, 'depuis')) donnees = JSON.parse(fs.readFileSync(arg(args, 'depuis'), 'utf8'));
    else {
        const { ouvrirLecture } = require('./collecte-cartes/ouvrir-lecture');
        const { ouvrirConnexions } = require('./collecte-cartes/garde');
        const lecture = await ouvrirLecture();
        if (!lecture) throw new Error('MONGODB_CARTES_LECTURE_URI absente : lecture seule exigée, aucune connexion ouverte');
        const cx = await ouvrirConnexions({ production: true, buckets: [], lectureSeule: true });
        try { donnees = await D.lireCmDepuisBase(lecture, cx.prod.db); } finally { await lecture.fermer(); await cx.fermer(); }
    }
    const cm = D.assemblerCm(donnees);
    console.log(`DÉNOMINATEURS : ${JSON.stringify(cm.denominateurs)}`);
    const groupes = groupesDuReleve(rel);
    const nbGroupes = Object.values(rel.listes).reduce((n, l) => n + l.length, 0);
    console.log(`GROUPES : ${nbGroupes} listés, ${groupes.length} avec leurs produits lus${groupes.length < nbGroupes ? ' (⚠️ relevé incomplet)' : ''}`);
    const fichierLus = arg(args, 'faux-lus') ?? path.join(__dirname, 'collecte-cartes', 'tcgcsv-faux-lus.json');
    const fauxLus = fs.existsSync(fichierLus) ? JSON.parse(fs.readFileSync(fichierLus, 'utf8')).lus ?? {} : {};
    console.log(`FAUX RELUS À L'ŒIL (${path.basename(fichierLus)}) : ${Object.keys(fauxLus).length} produits (comptés à part, jamais effacés)`);
    const r = calibrerTout({ rel, cm, accepterSlug: args.includes('--slug'), fauxLus });
    const resume = r.table.resume;
    console.log(`TABLE : ${JSON.stringify(resume.parStatut)}`);
    fs.mkdirSync(sortie, { recursive: true });
    fs.writeFileSync(path.join(sortie, 'table-groupes.json'), JSON.stringify({ le: new Date().toISOString(), seuils: { MIN_COMMUNS: JT.MIN_COMMUNS, PART_GROUPE_MIN: JT.PART_GROUPE_MIN, PART_UNION_MIN: JT.PART_UNION_MIN, FAIBLE_SI_FORTE_SOUS: JT.FAIBLE_SI_FORTE_SOUS }, denominateurs: cm.denominateurs, resume: resume.parStatut, lignes: r.table.lignes }, null, 1));
    fs.writeFileSync(path.join(sortie, 'groupes-non-apparies.txt'), resume.nonAppariees.map(g => `${g.groupId} | ${g.statut} | ${g.name} | ${g.produits} produits / ${g.avecNumero} numérotés | meilleur ${g.meilleur.map(m => `${m.slugSet} ${m.communs} (${(m.partGroupe * 100).toFixed(0)} % du groupe)`).join(' ; ') || '—'}`).join('\n'));
    const c = r.calibration;
    console.log(`CALIBRATION (${c.accepterSlug ? 'numéro du slug admis' : 'numéro de la base seulement'}) : population ${c.population} (fiche numérotée + visuel existant) · JUSTES ${c.justes} · lâches ${c.laches} ${JSON.stringify(c.lachesParCause)} · FAUX ${c.faux} (+ ${c.fauxLus} relus à l'œil : jointure juste, fiche différente) · MUETS ${c.muets} · non jugeables ${c.nonJugeables} · clé ${c.retenue ? 'RETENUE (0 faux)' : 'NON retenue'}`);
    console.log(`   muets par motif : ${JSON.stringify(c.muetsParMotif)} · faux par cause : ${JSON.stringify(c.fauxParCause)} · tous produits Cardmarket joints : ${c.tousLesProduitsJoints} / ${c.produitsCm}`);
    fs.writeFileSync(path.join(sortie, `calibration${c.accepterSlug ? '-slug' : ''}.json`), JSON.stringify({ le: new Date().toISOString(), ...c }, null, 1));
    const ns = r.nomSeul;
    console.log(`NOM SEUL (numéro caché à la clé, relu par la fiche) : ${ns.lignes} lignes numérotées (${ns.lignesTaillesDifferentes} refusées par la garde de taille) · produits ${ns.produits} · JUSTES ${ns.justes} · FAUX ${ns.faux} · muets ${ns.muets} · non jugeables ${ns.nonJugeables} · ${ns.retenue ? 'RETENU (0 faux)' : 'NON retenu sur les ensembles numérotés'}`);
    fs.writeFileSync(path.join(sortie, 'calibration-nom-seul.json'), JSON.stringify({ le: new Date().toISOString(), ...ns }, null, 1));
    const w = r.wcd;
    console.log(`WCD (année + numéro d'origine + nom, une carte de chaque côté) : ${w.absent ? 'groupe 2282 absent' : `produits ${w.total} · JUSTES ${w.justes} · FAUX ${w.faux} · muets ${w.muets} ${JSON.stringify(w.muetsParMotif)} · non jugeables ${w.nonJugeables} · ${w.retenue ? 'RETENU (0 faux)' : 'NON retenu'}`}`);
    fs.writeFileSync(path.join(sortie, 'calibration-wcd.json'), JSON.stringify({ le: new Date().toISOString(), ...w }, null, 1));
    for (const f of (w.fauxDetail ?? []).slice(0, 12)) console.log(`   wcd faux : ${f.idProduct} <- ${f.productId} ${f.cause}`);
    for (const f of ns.fauxDetail.slice(0, 12)) console.log(`   nom-seul faux : ${f.nomGroupe} · ${f.idProduct} « ${f.nomCm} » <- ${f.productId} ${f.cause}`);
    for (const f of c.fauxDetail.slice(0, +(arg(args, 'faux') ?? 25))) console.log(`   faux : ${f.idProduct} « ${f.nomCm} » ${f.slugSet} n°${f.numero} <- ${f.productId} « ${f.nomTcg} » ${f.numeroTcg} [${f.niveau}] ${f.cause}`);
}
if (require.main === module) main().catch(e => { console.error('❌', e.message); process.exitCode = 1; });
module.exports = { calibrerWcdTout, calibrerNomSeulTout, calibrerTout, groupesDuReleve, LANGUE_DE_CATEGORIE };
