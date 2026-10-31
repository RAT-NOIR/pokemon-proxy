// SIMULATION (LECTURE SEULE) de la PREUVE PAR LE SET avec des listes ANGLAISES à trois sources (SC + PC + ppr en cache) — décision du testeur, 2026-10-31. N'écrit RIEN en base, AUCUNE requête réseau.
// Lit : le cache des pages (GEMPACK-SOURCES/cache), le relevé ppr en cache, la production EN LECTURE SEULE (catalogue_produits, numeros_cartes, cartes, cartes_produits).
// Usage : node simuler-gempack-sources.js [--codes=CBB4C,CBB5C,CBB6C] [--sortie=<dossier>]      (lancé par un lanceur qui charge le .env de main ; NODE_PATH = node_modules du dépôt principal)
const fs = require('fs'), path = require('path');
const ARGS = Object.fromEntries(process.argv.slice(2).map(a => { const m = /^--([^=]+)=?(.*)$/.exec(a); return [m[1], m[2] === '' ? true : m[2]]; }));
const RACINE = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8';
const CACHE = RACINE + '/GEMPACK-SOURCES/cache', SORTIE = ARGS.sortie || RACINE + '/GEMPACK-SOURCES/simulation';
const G = require('./collecte-cartes/sources-gempack');
const FPS = require('./collecte-cartes/fiches-preuve-set');
const E = require('./ecrire-fiches-preuve-set');
const V5 = require('./poser-fiches-voie-deux-sources');
const { decomposerNomCardmarket, normaliserNom, cleNumero } = require('./collecte-cartes/jointure');

const SETS = [
    { code: 'CBB4C', exp: 6447, nom: 'Gem Pack Vol. 4 (CBB4C)', slug: 'gem-pack-vol-4-card-list' },
    { code: 'CBB5C', exp: 6544, nom: 'Gem Pack Vol. 5 (CBB5C)', slug: 'gem-pack-vol-5-card-list' },
    { code: 'CBB6C', exp: 6669, nom: 'Gem Pack Vol. 6 (CBB6C)', slug: 'gem-pack-vol-6-card-list' },
    { code: 'CBB3C', exp: 6292, nom: 'Gem Pack Vol. 3 (CBB3C)', slug: 'gem-pack-vol-3-card-list' },
    { code: 'CBB2C', exp: 6111, nom: 'Gem Pack Vol. 2 (CBB2C)', slug: 'gem-pack-vol-2-card-list' },
    { code: 'CBB1C', exp: 6001, nom: 'Gem Pack Vol. 1 (CBB1C)', slug: 'gem-pack-vol-1-card-list' }
].filter(s => !ARGS.codes || String(ARGS.codes).split(',').includes(s.code));

const lireTry = (f, lecteur) => { try { return { v: lecteur(fs.readFileSync(f, 'utf8')) }; } catch (e) { return { erreur: e.message }; } };
const resumerTypes = d => { const t = {}; for (const x of d) t[x.type] = (t[x.type] || 0) + 1; return t; };

(async () => {
    fs.mkdirSync(SORTIE, { recursive: true });
    const ppr = JSON.parse(fs.readFileSync(RACINE + '/RECOLTE/releves-ppr.json', 'utf8'));
    const cx = await V5.ouvrirLecture();
    const rapport = { date: new Date().toISOString(), sets: [], calibrationIndependante: { sets: 0, jugees: 0, justes: 0, faux: 0, nonJugees: 0, detailFaux: [] } };
    try {
        const lecture = await V5.lire({ cartesDb: cx.cartes.db, prodDb: cx.prod.db, expansions: SETS.map(s => s.exp) });
        const carteParId = new Map(lecture.cartes.map(c => [c._id, c]));
        const lignesParProduit = new Map(lecture.lignes.map(l => [l.idProduct, l]));
        const base = FPS.chargerSources('C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/AUDIT-31/FICHES-SET');
        const SETSL = {}, cibles = [], parSet = {};
        for (const s of SETS) {
            const produits = (lecture.produits.get(s.exp) || []).map(p => ({ idProduct: p.idProduct, name: p.name, numero: p.numero ?? null, variante: p.variante ?? null }));
            const sortie = { code: s.code, exp: s.exp, nom: s.nom, produits: produits.length, produitsAvecFiche: produits.filter(p => lignesParProduit.has(p.idProduct)).length };
            parSet[s.code] = sortie;
            const sc = lireTry(path.join(CACHE, `sc-${s.slug}.html`), G.lireSimplifiedCollector), pc = lireTry(path.join(CACHE, `pc-${s.slug}.html`), G.lirePokeCottage);
            sortie.sc = sc.erreur ? { erreur: sc.erreur } : { cartes: sc.v.cartes.length, groupes: new Set(sc.v.cartes.map(c => c.groupe)).size, anomalies: resumerTypes(sc.v.anomalies) };
            sortie.pc = pc.erreur ? { erreur: pc.erreur } : { cartes: pc.v.cartes.length, anomalies: resumerTypes(pc.v.anomalies) };
            const p = ppr[s.code] ? G.lirePpr(ppr[s.code]) : null;
            sortie.ppr = p ? { cartes: p.cartes.length, sansGroupe: p.sansGroupe } : null;
            console.log(`\n■ ${s.nom} · exp ${s.exp} · produits ${produits.length} (avec fiche déjà ${sortie.produitsAvecFiche})`);
            console.log(`   SC ${JSON.stringify(sortie.sc)} · PC ${JSON.stringify(sortie.pc)} · ppr ${JSON.stringify(sortie.ppr)}`);
            if (sc.erreur) { sortie.verdict = 'TOMBÉ'; sortie.motif = 'SC illisible : ' + sc.erreur; console.log('   → TOMBÉ : ' + sortie.motif); continue; }
            // les produits Cardmarket par numéro de groupe : la donnée INDÉPENDANTE de ppr qui corrobore (ou non) ses désaccords
            const pg = {}; for (const pr of produits) { const k = String(pr.numero ?? '').replace(/^0+/, ''); const g = (pg[k] ||= { noms: new Set(), effectif: 0 }); g.noms.add(base.cleProduit(pr.name)); g.effectif++; }
            const cr = G.croiserSources({ sc: sc.v, pc: pc.erreur ? null : pc.v, ppr: p, attendu: produits.length, produitsParGroupe: pg, cleNom: base.cleProduit });
            sortie.croisement = { ok: cr.ok, couverture: cr.couverture, discordances: resumerTypes(cr.discordances), reserves: cr.reserves, exemplesDiscordances: cr.discordances.slice(0, 8) };
            console.log(`   CROISEMENT ${cr.ok ? 'OK' : 'DISCORDANT'} · couverture ${JSON.stringify(cr.couverture)} · discordances ${JSON.stringify(resumerTypes(cr.discordances))} · réserves ${JSON.stringify(cr.reserves.map(r => r.type))}`);
            for (const r of cr.reserves) console.log('      réserve ' + JSON.stringify(r));
            for (const d of cr.discordances.slice(0, 6)) console.log('      discordance ' + JSON.stringify(d));
            if (pc.erreur) console.log('   (PC non lisible pour ce set : la preuve se fait à DEUX sources de liste — le témoin PC manque)');
            fs.writeFileSync(path.join(SORTIE, `croisement-${s.code}.json`), JSON.stringify({ code: s.code, exp: s.exp, ok: cr.ok, couverture: cr.couverture, discordances: cr.discordances, reserves: cr.reserves, cartes: cr.cartes }, null, 1));
            // les variantes : sans témoin Cardmarket, indiscernables
            const va = G.prouverVariantes({ croisement: cr, produits });
            sortie.variantes = { attributions: va.attributions.length, indiscernables: va.indiscernables.length, resume: va.resume };
            if (!cr.ok) { sortie.verdict = 'TOMBÉ'; sortie.motif = 'le croisement des sources discorde : ' + JSON.stringify(resumerTypes(cr.discordances)); console.log('   → TOMBÉ : ' + sortie.motif); continue; }
            if (pc.erreur) { sortie.verdict = 'TOMBÉ'; sortie.motif = 'PC non lisible : les trois numérotations ne peuvent pas toutes concorder (' + pc.erreur + ')'; console.log('   → TOMBÉ : ' + sortie.motif); continue; }
            // CALIBRATION INDÉPENDANTE : les produits qui ont DÉJÀ une fiche posée par la métacarte (nom + attaques, sans AUCUN numéro de source) — la carte désignée porte-t-elle le nom que la liste donne à son groupe ?
            const nomDuGroupe = new Map(); for (const c of cr.cartes) if (!nomDuGroupe.has(String(Number(c.groupe)))) nomDuGroupe.set(String(Number(c.groupe)), c.nom);
            let justes = 0, faux = 0, nonJugees = 0; const detailFaux = [];
            for (const pr of produits) {
                const l = lignesParProduit.get(pr.idProduct); if (!l || l.preuve !== 'metacarte+nom+attaques') continue;
                const carte = carteParId.get(l.carteId), attendu = nomDuGroupe.get(String(Number(pr.numero)));
                if (!carte || !carte.nomEn || attendu == null) { nonJugees++; continue; }
                if (base.cleProduit(carte.nomEn) === base.cleProduit(attendu)) justes++; else { faux++; detailFaux.push({ idProduct: pr.idProduct, groupe: pr.numero, liste: attendu, carte: carte.nomEn }); }
            }
            sortie.calibrationIndependante = { jugees: justes + faux, justes, faux, nonJugees, detailFaux: detailFaux.slice(0, 8) };
            const CI = rapport.calibrationIndependante; CI.sets++; CI.jugees += justes + faux; CI.justes += justes; CI.faux += faux; CI.nonJugees += nonJugees; CI.detailFaux.push(...detailFaux.map(x => ({ set: s.code, ...x })));
            console.log(`   CALIBRATION INDÉPENDANTE (fiches déjà posées par la métacarte, aucun numéro de liste utilisé) : jugées ${justes + faux} → JUSTES ${justes}, FAUX ${faux}, non jugées ${nonJugees}`);
            console.log(`   VARIANTES : ${va.resume}`);
            const jg = FPS.juger({ source: G.listeDuSet(cr), produits, traduire: base.traduire, cleProduit: base.cleProduit, groupeDe: FPS.groupeGem });
            sortie.jugement = { admis: jg.admis, raison: jg.raison, discordances: (jg.discordances || []).slice(0, 12) };
            console.log(`   JUGEMENT (preuve par le set) : ${jg.admis ? 'ADMIS' : 'REFUSÉ'} — ${jg.raison}`);
            for (const d of (jg.discordances || []).slice(0, 6)) console.log('      ' + JSON.stringify(d));
            if (!jg.admis && ARGS.hypothese) {   // HYPOTHÈSE (jamais appliquée) : « Timbur=Timburr » — le set ne tombe-t-il QUE pour ce nom ?
                const sub = Object.fromEntries(String(ARGS.hypothese).split(',').map(x => x.split('=')));
                const hj = FPS.juger({ source: G.listeDuSet(cr).map(e => ({ ...e, nomZh: sub[e.nomZh] ?? e.nomZh })), produits, traduire: base.traduire, cleProduit: base.cleProduit, groupeDe: FPS.groupeGem });
                sortie.hypothese = { substitutions: sub, admis: hj.admis, raison: hj.raison };
                console.log(`   HYPOTHÈSE (non appliquée) ${JSON.stringify(sub)} : ${hj.admis ? 'ADMIS => le set ne tombe QUE pour cette raison' : 'toujours refusé — ' + hj.raison}`);
            }
            const etiquette = `liste-externe:${s.code}`;
            SETSL[etiquette] = { etiquette, cartes: G.listeDuSet(cr) };
            cibles.push({ nom: s.nom, exp: s.exp, kado: [[etiquette, '']], groupeDe: FPS.groupeGem, role: 'vise', calibrable: true, etiquetteRef: etiquette, tolerance: true });   // décision de l'éditeur 31/10 : la tolérance d'orthographe (une lettre, même groupe, candidat unique, reste concordant)
        }
        // la chaîne de production : jugement (règle sans numéro, avec témoin, calibration, 4 contrôles négatifs) puis planificateur de la voie deux-sources
        const connexionPartagee = { cartes: cx.cartes, prod: cx.prod, fermer: async () => {} };
        const out = []; const log = l => { out.push(l); console.log(l); };
        const pret = path.join(SORTIE, 'pret-gempack.json'), plan = path.join(SORTIE, 'plan-gempack.json'), resume = path.join(SORTIE, 'resume-gempack.json');
        const code = await E.executer({ argv: ['--simuler', `--pret=${pret}`, `--plan=${plan}`, `--resume=${resume}`], ouvrirLecture: async () => connexionPartagee, cibles, chargerSources: () => ({ ...base, SETS: { ...base.SETS, ...SETSL } }), log });
        rapport.chaine = { code, lignes: out.length };
        if (fs.existsSync(resume)) {
            const rs = JSON.parse(fs.readFileSync(resume, 'utf8'));
            for (const v of rs.sets) { const s = SETS.find(x => x.exp === v.exp); if (s) { parSet[s.code].verdict = v.admis ? 'ADMIS' : 'TOMBÉ'; parSet[s.code].motif = v.raison; parSet[s.code].negatifs = v.negatifs; parSet[s.code].calibrationNumeros = v.calibration; } }
            for (const s of SETS) { const slugs = new Set(rs.lignes.filter(l => l.slugSet && lecture.sets.get(l.slugSet) && [].concat(lecture.sets.get(l.slugSet).idExpansion ?? []).includes(s.exp)).map(l => l.idProduct)); parSet[s.code].fichesPretes = slugs.size; }
            const refus = {}; for (const r of rs.refus) { const c = r.raison.replace(/\(.*?\)/g, '(…)').replace(/\d+/g, '#').slice(0, 140); refus[c] = (refus[c] || 0) + 1; }
            rapport.refusPlanificateur = refus; rapport.impressions = rs.impressions.length;
        }
        rapport.sets = Object.values(parSet);
    } finally { await cx.fermer(); }
    fs.writeFileSync(path.join(SORTIE, 'simulation-gempack.json'), JSON.stringify(rapport, null, 1));
    console.log('\n=== CALIBRATION INDÉPENDANTE (tous sets) : ' + JSON.stringify({ ...rapport.calibrationIndependante, detailFaux: rapport.calibrationIndependante.detailFaux.length }));
    if (rapport.calibrationIndependante.faux) process.exitCode = 3;
})().catch(e => { console.error('❌', e.stack || e.message); process.exitCode = 1; });
