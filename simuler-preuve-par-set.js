// SIMULATION (lecture seule) de la PREUVE PAR LE SET — décision du testeur, 2026-10-31. N'écrit RIEN en base, ne fait AUCUNE requête réseau.
// Lit : les listes kado.hk déjà en cache (scripts de lecture dans couverture/S8/AUDIT-31/FICHES-SET/scripts), les libellés anglais que la SOURCE publie (labels.json),
// la table zh-tw construite sur TCGdex (table-zh-tw.json), pokedex-dexids.json, et la production EN LECTURE SEULE (catalogue_produits + numeros_cartes via produitsDeLExpansion).
// Usage : node simuler-preuve-par-set.js [--dossier=<FICHES-SET>] [--variantes=hk,hant,hans]  (variantes Wikidata admises parmi hk,hant,hans,cn,tw,mo,sg,my,zh ; défaut toutes)   (NODE_PATH = node_modules du dépôt principal ; .env copié dans la copie de travail, à supprimer après)
const fs = require('fs'), path = require('path');
const ARGS = Object.fromEntries(process.argv.slice(2).map(a => { const m = /^--([^=]+)=(.*)$/.exec(a); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]; }));
const DOSSIER = ARGS.dossier || 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/AUDIT-31/FICHES-SET';
require('C:/Users/Yung/Desktop/pokemon-proxy/node_modules/dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { produitsDeLExpansion, cleNumero } = require('./collecte-cartes/jointure');
const LS = require('./collecte-cartes/lecture-sure');
const { prouverParSet } = require('./collecte-cartes/preuve-par-set');
const TZ = require('./collecte-cartes/table-zh');
const { chargerSources, CIBLES } = require('./collecte-cartes/fiches-preuve-set');

// UN SEUL chargement des tables pour la simulation et pour l'outil d'écriture (collecte-cartes/fiches-preuve-set.js::chargerSources, §21 bis) ; Wikidata (CC0) est lu seulement si son fichier daté existe
const { SETS, LABELS, TW, ESPECES, cleProduit, journal: JOURNAL_SOURCES } = chargerSources(DOSSIER, { variantes: typeof ARGS.variantes === 'string' ? ARGS.variantes.split(',').filter(Boolean) : null });   // --variantes=hk,hant,hans : restreint les variantes Wikidata (défaut : toutes)
for (const l of JOURNAL_SOURCES) console.log(l);
const pairesSource = Object.fromEntries(Object.entries(LABELS).filter(([, v]) => v && v.en).map(([zh, v]) => [zh.normalize('NFKC').replace(/\s+/g, ''), v.en]));
const traduireBase = TZ.fabriquerTraducteur({ tableEspeces: ESPECES.table, tableAutres: TW, cleProduit });
const traduire = traduireBase;   // PokeAPI (+ Wikidata si présent) pour les espèces, TCGdex/base pour le reste — AUCUNE table tirée de Cardmarket
// L'ORACLE (hypothèse, jamais appliquée) : le libellé anglais que la source publie sur la page de la carte. Il sert à CATÉGORISER les noms intraduisibles et à tester si un set ne tombe que pour cette raison.
const nz = s => String(s).normalize('NFKC').replace(/\s+/g, '');
const oracle = nomZh => { const en = pairesSource[nz(nomZh)]; return en ? cleProduit(en) : null; };
const categorie = nomZh => { const en = pairesSource[nz(nomZh)]; if (!en) return 'sans libellé'; if (/energy/i.test(en)) return 'énergie'; return cleProduit(en)[0] === 'D' ? 'espèce' : 'dresseur/objet'; };
// CIBLES : collecte-cartes/fiches-preuve-set.js (la même liste pour la simulation et l'écriture). rôle 'vise' : le numéro Cardmarket des produits sert de TÉMOIN ; rôle 'calibration' : le numéro connu est CACHÉ à la règle, puis comparé à ce qu'elle donne

const resumerDiscordances = d => { const t = {}; for (const x of d) t[x.type] = (t[x.type] || 0) + 1; return t; };
(async () => {
    const cx = await ouvrirConnexions({ production: true, buckets: [], lectureSeule: true });
    const rapport = { date: new Date().toISOString(), cibles: [], calibration: { sets_testes: 0, detail: [] } };
    try {
        for (const cible of CIBLES) {
            const manquants = cible.kado.filter(([e]) => !SETS[e]);
            if (manquants.length) { console.log(`\n■ ${cible.nom} : liste kado absente du cache (${manquants.map(x => x[0]).join(', ')})`); continue; }
            const source = cible.kado.flatMap(([e, pre]) => SETS[e].cartes.map(c => ({ numero: pre + c.numero, nomZh: c.nomZh })));
            const brut = await produitsDeLExpansion(cx.prod, cible.exp);
            LS.champSur(brut, 'numero', { collection: `produits exp ${cible.exp}`, videAutorise: 'un set peut avoir des produits sans numéro (30C : 30)' });
            const produits = brut.map(p => ({ idProduct: p.idProduct, name: p.name, numero: p.numero ?? null }));
            // DÉNOMINATEUR de la traduction : combien de noms de la source se retrouvent parmi les clés des produits (apparier lève sur une intersection vide)
            const clesProduits = produits.map(p => cleProduit(p.name)).filter(Boolean);
            const clesSource = source.map(e => traduire(e.nomZh)).filter(Boolean);
            const intraduisibles = source.filter(e => traduire(e.nomZh) == null);
            let ap = null; try { ap = LS.apparier(clesSource, clesProduits, { gauche: 'clés de la source', droite: 'clés des produits', cle: 'espèce/nom' }); } catch (e) { ap = { taux: 0, err: e.message.split('\n')[0] }; }
            console.log(`\n■ ${cible.nom} · exp ${cible.exp} · source ${source.length} entrées (${cible.kado.map(x => x[0]).join(' + ')}) · produits ${produits.length} (numérotés ${produits.filter(p => p.numero != null).length}) · noms intraduisibles ${intraduisibles.length}/${source.length} · clés source retrouvées chez les produits ${ap.taux != null ? (ap.taux * 100).toFixed(0) : '—'} %`);
            const sortie = { nom: cible.nom, exp: cible.exp, role: cible.role, source: source.length, produits: produits.length, intraduisibles: intraduisibles.length };
            // 1. la règle, numéros Cardmarket CACHÉS (c'est la mesure) puis, pour les sets visés, avec le témoin
            const cache = produits.map(p => ({ idProduct: p.idProduct, name: p.name }));
            const r = prouverParSet({ source, produits: cache, traduire, cleProduit, groupeDe: cible.groupeDe || null });
            sortie.admis = r.admis; sortie.raison = r.raison; sortie.discordances = resumerDiscordances(r.discordances);
            console.log(`   règle (numéros cachés) : ${r.admis ? 'ADMIS' : 'NON ADMIS'} — ${r.raison}`);
            let rr = r.admis ? r : null, tradRR = traduire, mode = 'PokeAPI + TCGdex';
            if (!r.admis) {
                const intr = [...new Set(r.discordances.filter(d => d.type === 'intraduisible').map(d => d.nomZh))];
                const cats = {}; for (const n of intr) (cats[categorie(n)] ||= []).push(n + (pairesSource[nz(n)] ? '=' + pairesSource[nz(n)] : ''));
                const r2 = prouverParSet({ source, produits: cache, traduire: n => traduire(n) ?? oracle(n), cleProduit, groupeDe: cible.groupeDe || null });
                sortie.nomsIntraduisibles = intr.length; sortie.parCategorie = cats; sortie.avecLibelles = r2.admis ? 'ADMIS' : r2.raison;
                console.log('   noms intraduisibles distincts : ' + intr.length + ' · si on les traduisait par le libellé de la source (hypothèse) : ' + (r2.admis ? 'le set serait ADMIS => il ne tombe QUE pour cette raison' : 'toujours refusé — ' + r2.raison));
                for (const [k, v] of Object.entries(cats)) console.log('      ' + k + ' (' + v.length + ') : ' + v.slice(0, 30).join(', '));
                const ex = r.discordances.filter(d => d.type !== 'effectif').slice(0, 4).map(d => `${d.type} ${d.numero ?? ''} ${d.nomZh ?? d.name ?? ''}`.trim());
                const eff = r.discordances.filter(d => d.type === 'effectif').slice(0, 5).map(d => `${d.cle}: source ${d.source}/produits ${d.produits}`);
                if (ex.length) console.log('   exemples (hors effectifs) : ' + ex.join(' | '));
                if (eff.length) console.log('   exemples d\'effectifs : ' + eff.join(' | '));
            }
            if (rr) {
                sortie.modeTraduction = mode;
                const ptr = new Map(produits.map(p => [p.idProduct, p]));
                let justes = 0, faux = 0; const fauxListe = [];
                for (const a of rr.attributions) { const vrai = cleNumero(ptr.get(a.idProduct).numero); if (vrai == null) continue; if (cleNumero(a.numero) === vrai) justes++; else { faux++; fauxListe.push({ idProduct: a.idProduct, regle: a.numero, connu: ptr.get(a.idProduct).numero }); } }
                sortie.attributions = rr.attributions.length; sortie.ambigus = rr.ambigus.length; sortie.jugees = justes + faux; sortie.justes = justes; sortie.faux = faux; sortie.fauxListe = fauxListe.slice(0, 10);
                console.log(`   attributions ${rr.attributions.length} (${rr.attributions.filter(a => a.niveau === 'exact').length} exactes, ${rr.attributions.filter(a => a.niveau === 'groupe').length} de groupe) · groupes de noms ambigus ${rr.ambigus.length} · confrontées au numéro Cardmarket connu : ${justes + faux} → JUSTES ${justes}, FAUX ${faux}`);
                // 2. contrôles NÉGATIFS : la règle sait-elle dire NON ? (retirer une entrée ; ajouter un produit orphelin ; remplacer un nom)
                const neg1 = prouverParSet({ source: source.slice(1), produits: cache, traduire: tradRR, cleProduit, groupeDe: cible.groupeDe || null }).admis;
                const neg2 = prouverParSet({ source, produits: cache.concat([{ idProduct: -1, name: 'Zzyzx Orphelin Inconnu' }]), traduire: tradRR, cleProduit, groupeDe: cible.groupeDe || null }).admis;
                const echange = source.map((e, i) => (i === 0 ? { ...e, nomZh: source[source.length - 1].nomZh } : e));
                const neg3 = source[0].nomZh === source[source.length - 1].nomZh ? false : prouverParSet({ source: echange, produits: cache, traduire: tradRR, cleProduit, groupeDe: cible.groupeDe || null }).admis;
                sortie.negatifs = { sansUneEntree: neg1, produitOrphelin: neg2, nomRemplace: neg3 };
                console.log(`   contrôles négatifs (doivent tous être false) : sans une entrée ${neg1} · produit orphelin ${neg2} · un nom remplacé ${neg3}`);
                // 3. avec le TÉMOIN (numéro Cardmarket de chaque produit) — c'est ce qu'utiliserait la chaîne d'écriture
                const t = prouverParSet({ source, produits, traduire: tradRR, cleProduit, groupeDe: cible.groupeDe || null });
                sortie.avecTemoin = { admis: t.admis, raison: t.raison, discordances: resumerDiscordances(t.discordances) };
                console.log(`   règle (avec le numéro Cardmarket en témoin) : ${t.admis ? 'ADMIS' : 'NON ADMIS'} — ${t.raison}`);
                if (cible.role === 'calibration' || cible.calibrable) {
                    const B = (rapport.calibration[mode] ||= { sets: 0, produits_juges: 0, justes: 0, faux: 0, non_attribues_ambigus: 0 }); B.sets++; B.produits_juges += justes + faux; B.justes += justes; B.faux += faux; B.non_attribues_ambigus += rr.ambigus.reduce((s, a) => s + a.produits.length, 0);
                    
                    rapport.calibration.detail.push({ set: cible.nom, mode, jugees: justes + faux, justes, faux });
                }
                sortie.fichesCreables = rr.attributions.length;
            }
            if (cible.role === 'calibration' || cible.calibrable) rapport.calibration.sets_testes++;
            rapport.cibles.push(sortie);
        }
    } finally { await cx.fermer(); }
    fs.writeFileSync(path.join(DOSSIER, 'simulation.json'), JSON.stringify(rapport, null, 1));
    const c = rapport.calibration;
    console.log(`\n=== CALIBRATION : sets testés ${c.sets_testes}`);
    for (const [mode, B] of Object.entries(c)) { if (typeof B !== 'object' || Array.isArray(B)) continue; console.log(`   traduction « ${mode} » : sets où la règle s'applique ${B.sets} · produits jugés ${B.produits_juges} · justes ${B.justes} · FAUX ${B.faux} · produits non attribués (noms ambigus) ${B.non_attribues_ambigus}`); if (B.faux) process.exitCode = 3; }
    for (const d of c.detail) console.log(`   - ${d.set} [${d.mode}] : jugés ${d.jugees}, justes ${d.justes}, faux ${d.faux}`);
})().catch(e => { console.error('❌', e.message); process.exitCode = 1; });
