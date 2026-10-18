// ============================================================
// LOT 2 — LA TABLE D'ALIAS DE SETS PROUVÉE, ET LA MESURE REJOUÉE (LECTURE SEULE : aucune écriture en base, aucun réseau)
// ============================================================
//   node mesurer-alias-sets.js                                   mesure : alias prouvés / refusés, impressions confirmées avant → après
//   node mesurer-alias-sets.js --table=<chemin.json>             écrit en plus la table fermée (un fichier du dépôt, pas la base)
//   node mesurer-alias-sets.js --sources=<dossier>               autres index de sources externes (défaut : couverture/S7/BULBA-REMPLACEMENT/)
// Un alias n'est retenu que s'il est PROUVÉ par le recouvrement (numéro, nom) du set entier (collecte-cartes/alias-sets-bulba.js). Les expansions déjà résolues par leur nom ne sont pas touchées.
require('dotenv').config();
const fs = require('fs');
const { ouvrirSimulation } = require('./collecte-cartes/ouvrir-lecture');
const { chargerSources, chargerBase } = require('./collecte-cartes/charger-bulba');
const { confronter, synthese, construireIndex, norm } = require('./collecte-cartes/confronter-bulba');
const { indexerExternes, prouverAlias, verifierTable, versTableConfronter } = require('./collecte-cartes/alias-sets-bulba');

const AUTORISES = [/^--table=.+$/, /^--sources=.+$/, /^--sortie=.+$/, /^--lecture-via-ecriture$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || null;

/** Les sets externes sous la forme { cle, cartes:[{numero, nom}] }. */
function externes(sources) {
    const grouper = (liste, cle, num) => { const m = new Map(); for (const c of liste) { const k = cle(c); if (!m.has(k)) m.set(k, []); m.get(k).push({ numero: num(c), nom: c.name }); } return [...m].map(([cle, cartes]) => ({ cle, cartes })); };
    return {
        pkc: grouper(sources.pkc, c => c.dossier, c => c.number),
        tdx: grouper(sources.tdx.cartes, c => c.serie + '/' + c.dossierSet, c => c.numero),
        jp: grouper(sources.jp, c => c.dossier.toLowerCase(), c => c.number),
    };
}

(async () => {
    const cx = await ouvrirSimulation({ viaEcriture: process.argv.includes('--lecture-via-ecriture'), ouvrirConnexions: require('./collecte-cartes/garde').ouvrirConnexions });
    const { sets, cartes } = await chargerBase(cx.cartes.db);
    const sources = chargerSources(arg('sources') || undefined);
    const { IX } = construireIndex(sources);
    const EXT = externes(sources);
    const IDX = { pkc: indexerExternes(EXT.pkc), tdx: indexerExternes(EXT.tdx), jp: indexerExternes(EXT.jp) };

    // 1. les (tirage, expansion) de Bulbapedia et leurs (numéro, nom)
    const groupes = { intl: new Map(), jp: new Map() };
    for (const k of cartes) for (const im of k.impressions || []) {
        const t = im.tirage; if (t !== 'intl' && t !== 'jp') continue;
        const nom = t === 'intl' ? k.nomEn : k.nomJa; if (!nom || im.numero == null) continue;
        const g = groupes[t]; const kn = norm(im.expansion);
        if (!g.has(kn)) g.set(kn, { expansion: im.expansion, impr: 0, cartes: [] });
        g.get(kn).cartes.push({ numero: im.numero, nom });
    }
    const imprParExp = { intl: {}, jp: {} };
    for (const k of cartes) for (const im of k.impressions || []) if (im.tirage === 'intl' || im.tirage === 'jp') (imprParExp[im.tirage][norm(im.expansion)] = (imprParExp[im.tirage][norm(im.expansion)] || 0) + 1);

    // 2. la résolution de base (par le nom) : seuls les non résolus cherchent un alias
    const setParExp = new Map();
    for (const s of sets) { const e = s.bulba?.expansion; if (!e) continue; const k = (s.tirage || s.region) + '|' + norm(e); if (!setParExp.has(k)) setParExp.set(k, []); setParExp.get(k).push(s); }
    const resoluParNom = (src, expansion) => {
        const ix = IX[src]; const kn = norm(expansion);
        const alt = [kn, norm(String(expansion).replace(/^EX /, '')), norm(String(expansion).replace(/^Platinum: /, ''))];
        return alt.some(a => { const s = ix.noms.get(a); return s && s.size === 1; });
    };
    const resoluJp = expansion => { const ss = setParExp.get('jp|' + norm(expansion)); return !!(ss && ss.length === 1 && ss[0].code && IX.jp.compteur.has(String(ss[0].code).toLowerCase())); };

    const table = { version: 1, intl: {}, jp: {} }; const refus = [];
    const tente = { intl: 0, jp: 0 };
    for (const [kn, g] of groupes.intl) {
        for (const src of ['pkc', 'tdx']) {
            if (resoluParNom(src, g.expansion)) continue;
            tente.intl++;
            const r = prouverAlias(g.cartes, IDX[src]);
            if (r.refus) { refus.push({ tirage: 'intl', source: src, expansion: g.expansion, impressions: imprParExp.intl[kn], raison: r.refus, meilleurs: r.evalues }); continue; }
            (table.intl[kn] ||= { expansion: g.expansion })[src] = r.retenus;
        }
    }
    for (const [kn, g] of groupes.jp) {
        if (resoluJp(g.expansion)) continue;
        tente.jp++;
        const r = prouverAlias(g.cartes, IDX.jp);
        if (r.refus) { refus.push({ tirage: 'jp', source: 'jp', expansion: g.expansion, impressions: imprParExp.jp[kn], raison: r.refus, meilleurs: r.evalues }); continue; }
        table.jp[kn] = { expansion: g.expansion, dossiers: r.retenus };
    }
    const erreurs = verifierTable(table);
    if (erreurs.length) { console.error('❌ table rejetée par sa propre vérification :\n' + erreurs.slice(0, 10).join('\n')); process.exit(1); }

    // 3. la mesure rejouée
    const avant = confronter({ cartes, sets, sources, alias: null });
    const apres = confronter({ cartes, sets, sources, alias: versTableConfronter(table) });
    const sa = synthese(avant.lignes), sp = synthese(apres.lignes);

    const nbIntl = Object.keys(table.intl).length, nbJp = Object.keys(table.jp).length;
    console.log(`DÉNOMINATEURS : ${cartes.length} cartes Bulbapedia · ${sets.length} sets · sources pkc ${sources.pkc.length} · tdx ${sources.tdx.cartes.length} · jp ${sources.jp.length}`);
    console.log(`TENTÉS (non résolus par le nom) : intl ${tente.intl} (expansion × source) · jp ${tente.jp}`);
    console.log(`ALIAS RETENUS : intl ${nbIntl} expansions (pkc ${Object.values(table.intl).filter(e => e.pkc).length}, tdx ${Object.values(table.intl).filter(e => e.tdx).length}) · jp ${nbJp} expansions (${Object.values(table.jp).reduce((n, e) => n + e.dossiers.length, 0)} dossiers)`);
    const parRaison = {}; for (const r of refus) { const k = r.tirage + '/' + r.raison; parRaison[k] = (parRaison[k] || 0) + 1; }
    console.log(`REFUSÉS : ${refus.length} ${JSON.stringify(parRaison)}`);
    for (const t of ['intl', 'jp']) {
        const a = avant.appar[t], p = apres.appar[t];
        console.log(`IMPRESSIONS ${t} : ${a.impr} · clé trouvée ${a.cle} → ${p.cle} (${p.cle - a.cle >= 0 ? '+' : ''}${p.cle - a.cle}) · CONFIRMÉES (clé + nom) ${a.confirmees} → ${p.confirmees} (${p.confirmees - a.confirmees >= 0 ? '+' : ''}${p.confirmees - a.confirmees}) · non résolues ${a.non} → ${p.non} · doublons ${a.doublon} → ${p.doublon} · nom divergent ${a.nomDiff} → ${p.nomDiff}`);
    }
    console.log('CHAMPS (accord / désaccord seul / sans remplaçant) avant → après :');
    for (const ch of Object.keys(sa)) console.log(`   ${ch.padEnd(22)} ${sa[ch].accord}/${sa[ch].desaccordSeul}/${sa[ch].sansRemplacant} → ${sp[ch].accord}/${sp[ch].desaccordSeul}/${sp[ch].sansRemplacant}`);
    const regress = [];
    const avantParCle = new Map(avant.lignes.map(l => [l.champ + '\u0000' + l.cle, l.statut]));
    for (const l of apres.lignes) if (avantParCle.get(l.champ + '\u0000' + l.cle) === 'accord' && l.statut !== 'accord') regress.push(l.champ + ' ' + l.cle);
    console.log(`RÉGRESSIONS (accord avant → plus d'accord après) : ${regress.length}${regress.length ? ' ' + regress.slice(0, 5).join(', ') : ''}`);
    const gros = refus.filter(r => r.raison !== 'trop-peu').sort((a, b) => b.impressions - a.impressions).slice(0, 12);
    console.log('PLUS GROS REFUS (hors trop-peu) :'); for (const r of gros) console.log(`   ${r.tirage} « ${r.expansion} » ${r.impressions} impr. ${r.raison} ${JSON.stringify(r.meilleurs[0] || null)}`);

    if (arg('table')) { fs.writeFileSync(arg('table'), JSON.stringify(table, null, 1) + '\n'); console.log(`table écrite : ${arg('table')}`); }
    if (arg('sortie')) { fs.writeFileSync(arg('sortie'), JSON.stringify({ tente, retenus: { intl: nbIntl, jp: nbJp }, refus, avant: { appar: avant.appar, synthese: sa }, apres: { appar: apres.appar, synthese: sp }, regressions: regress }, null, 1)); console.log(`résultats écrits : ${arg('sortie')}`); }
    await cx.fermer();
})().catch(e => { console.error('❌', e.message); process.exit(1); });
