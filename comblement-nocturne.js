'use strict';
// ============================================================
// LE JOB DE COMBLEMENT AUTOMATIQUE (point 5 du testeur, 25/10) — la ligne de commande ; le cœur testé est collecte-cartes/comblement.js
// ============================================================
//   node comblement-nocturne.js --plan [--limite=N]          lecture seule, 0 requête -> plan-comblement.json (population, candidats par produit, comptes 0 / 1 / ≥ 2 sources, sources bloquées)
//   node comblement-nocturne.js --telecharger --plafond=N    les images des SEULS produits à ≥ 2 sources libres, fournisseur par fournisseur (client poli de chacun) ; le maximum est imprimé AVANT la première requête
//   node comblement-nocturne.js --decider                    0 requête, 0 écriture -> decisions-comblement.json + l'--attendu par fournisseur et le total
//   node comblement-nocturne.js --ecrire --attendu=N         SEULEMENT sous lot-additif.js : les gagnants (un RC.ecrire par fournisseur), puis les trous nommés ; refus si --attendu ≠ réel
//   node comblement-nocturne.js --nuit [--a-blanc] [--limite=N] [--plafond=N]   gardes -> plan -> téléchargement -> décision -> (sauf --a-blanc) lot-additif.js -> compte rendu nuit-<date>.md
//   --dossier=<dossier>   (bancs) un autre dossier de sorties ; jamais un dossier d'apports manuels
//
// `--plafond=N` est un BUDGET de requêtes de CE lancement, par fournisseur (le plafond de recolte-hote.js est un total pour le dossier de cache ; le cache du comblement vit d'une nuit à l'autre, on lui ajoute donc ce qu'il contient déjà).
// Les fichiers vivent dans le dossier de sorties (S8\COMBLEMENT par défaut) : plan, décisions, STOP, dernier-passage.json, nuit-<date>.md, et pour chaque fournisseur son index d'images (images-<code>.json) et son cache (cache-<code>\).
// Le cache et l'index sont ceux du COMBLEMENT, pas ceux des récoltes : un comblement ne touche jamais les fichiers d'une récolte en cours. Les relevés (releves-<code>.json), eux, sont LUS dans le dossier de la récolte.
// Variable d'environnement facultative COMBLEMENT_ENV=<chemin d'un .env> : charger les variables d'un autre dépôt (le worktree n'a pas de .env).
require('dotenv').config();
if (process.env.COMBLEMENT_ENV) require('dotenv').config({ path: process.env.COMBLEMENT_ENV });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const CO = require('./collecte-cartes/comblement');
const RC = require('./collecte-cartes/recolte-commun');

const note = m => console.log(m);
const jour = (d = new Date()) => d.toISOString().slice(0, 10);

function lancerFileArret() { return spawnSync(process.execPath, [path.join(__dirname, 'file-a-l-arret.js')], { cwd: __dirname, encoding: 'utf8', env: process.env, timeout: 180000 }); }
function appliquerGardes(dossier) {
    const g = CO.verifierGardes({ dossier, existe: CO.existeStrict, lancerFileArret });
    if (!g.ok) { console.error(`❌ ${g.raison}`); process.exitCode = 3; }
    return g.ok;
}
const fichiersDe = (dossier) => (code) => require('./collecte-cartes/recolte-cli').fichiersDe(code, dossier);
const fichiersRecolte = (def) => require('./collecte-cartes/recolte-cli').fichiersDe(def.CODE, def.DOSSIER);
const arretDe = (hote) => { const RH = require('./collecte-cartes/reponse-hote'); return RH.hoteArrete(RH.hoteRacine(hote)); };
async function lectureOuRefus() {
    const l = await require('./collecte-cartes/ouvrir-lecture').ouvrirLecture();
    if (!l) throw new Error('MONGODB_CARTES_LECTURE_URI absente : le plan ne lit que par la connexion de lecture seule — refus, aucune connexion ouverte');
    return l;
}

// ── 1. LE PLAN ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function lireProduction(prodDb, ids) {
    const guide = new Map(), numeros = new Map(), dates = new Map();
    const lots = []; for (let i = 0; i < ids.length; i += 1000) lots.push(ids.slice(i, i + 1000));
    for (const lot of lots) {
        for (const x of await prodDb.collection('guide_prix').find({ idProduct: { $in: lot } }, { projection: { _id: 0, idProduct: 1, low: 1, lowHolo: 1, avg1: 1, avg7: 1, avg30: 1, trend: 1 } }).toArray()) guide.set(x.idProduct, x);
        for (const x of await prodDb.collection('numeros_cartes').find({ idProduct: { $in: lot } }, { projection: { _id: 0, idProduct: 1, codeSet: 1, numero: 1 } }).toArray()) numeros.set(x.idProduct, x);
        for (const x of await prodDb.collection('catalogue_produits').find({ idProduct: { $in: lot } }, { projection: { _id: 0, idProduct: 1, dateAdded: 1 } }).toArray()) if (x.dateAdded) dates.set(x.idProduct, x.dateAdded);
    }
    // §41 : un zéro sur une population non vide est une clé fausse, pas une absence
    if (ids.length && !guide.size) throw new Error(`guide_prix : 0 ligne sur ${ids.length} produits — clé fausse ou base vide`);
    if (ids.length && !numeros.size) throw new Error(`numeros_cartes : 0 ligne sur ${ids.length} produits — clé fausse ou base vide`);
    return { guide, numeros, dates };
}
async function etapePlan({ dossier, limite, etatNom = null }) {
    const lecture = await lectureOuRefus();                       // AVANT tout : sans lecture seule, rien ne s'ouvre
    let prod = null;
    try {
        const fournisseurs = CO.chargerFournisseurs();
        const ordre = fournisseurs.map(f => f.code);
        const dossierCompteurs = CO.DOSSIER_COMPTEURS;
        const etatFichier = etatNom ? CO.dernierEtat([etatNom]) : CO.dernierEtat(fs.readdirSync(dossierCompteurs));      // F3 : en --nuit, le fichier que le compteur vient d'écrire
        const etat = JSON.parse(fs.readFileSync(path.join(dossierCompteurs, etatFichier.fichier), 'utf8'));
        const base = etat.filter(p => p.classeVisuel === 'MANQUANT' && p.classeFiche !== 'SANS_LIGNE');
        const { ouvrirConnexions } = require('./collecte-cartes/garde');
        const cx = await ouvrirConnexions({ production: true, buckets: [], lectureSeule: true });
        prod = cx;
        const { guide, numeros, dates } = await lireProduction(cx.prod.db, [...new Set(base.map(p => p.idProduct))]);
        const dernier = RC.lireJson(path.join(dossier, 'dernier-passage.json'), null);
        const depuis = dernier?.le ? new Date(dernier.le) : null;
        const neufs = CO.calculerNeufs(dates, depuis);
        const avecDate = dates.size;
        const pop = CO.choisirPopulation({ etat, guide, numeros, neufs });
        const parFournisseur = await CO.recolterUnites({ fournisseurs, db: lecture.cartes.db, lireReleves: def => JSON.parse(fs.readFileSync(fichiersRecolte(def).releves, 'utf8')),         // I2 : LÈVE sur un relevé absent ou illisible (RC.lireJson le remplacerait par {})
             arret: arretDe, fichiersDe: fichiersRecolte });
        const pl = CO.planifier({ cibles: pop.cibles, parFournisseur, ordre, limite });
        const plan = {
            le: new Date().toISOString(), limite, ordre, etat: { fichier: etatFichier.fichier, le: etatFichier.le.toISOString() },
            population: { base: pop.base, cibles: pop.cibles.length, sansOffre: pop.sansOffre.length, reportes: pl.reportes.length },
            reportesPlafond: pl.reportes,
            neufs: { dernierPassage: depuis ? depuis.toISOString() : null, produitsAvecDateAdded: avecDate, neufs: neufs.size, note: depuis ? '' : 'aucun passage précédent : aucun produit n\'est dit neuf' + (avecDate ? '' : ' ; champ dateAdded ABSENT pour toute la population') },
            comptes: pl.comptes,
            fournisseurs: parFournisseur.map(f => ({ code: f.code, bloquee: f.bloquee, unites: f.unites.length, aAjouter: f.unites.filter(u => u.decision?.action === 'ajouter').length })),
            cibles: pop.cibles.map(c => ({ idProduct: c.idProduct, name: c.name, neuf: c.neuf, offres: c.pop.offres })),
            produits: pl.produits, trousDirects: pl.trousDirects.map(({ le: _le, ...t }) => t), sansOffre: pop.sansOffre.map(p => p.idProduct)
        };
        RC.ecrireJson(path.join(dossier, 'plan-comblement.json'), plan);
        note(`PLAN : état ${plan.etat.fichier} · population ${pop.base} · cherchés ${pop.cibles.length} (à télécharger ${pl.produits.length}, plafond ${limite} sur les produits à ≥ 2 sources, reportés ${pl.reportes.length}) · sans offre ${pop.sansOffre.length} · neufs ${neufs.size}`);
        note(`   classes : ${JSON.stringify(pl.comptes)} · fournisseurs : ${plan.fournisseurs.map(f => `${f.code}${f.bloquee ? ' ⛔' : ''} ${f.aAjouter}/${f.unites}`).join(' · ')}`);
        if (plan.neufs.note) note(`   neufs : ${plan.neufs.note}`);
        note(`   → ${path.join(dossier, 'plan-comblement.json')}`);
        return plan;
    } finally { await Promise.allSettled([lecture.fermer(), prod?.fermer()]); }
}
const lirePlan = (dossier) => { const p = RC.lireJson(path.join(dossier, 'plan-comblement.json'), null); if (!p?.produits) throw new Error('plan-comblement.json absent : lancer --plan d\'abord'); return p; };

// ── 2. LE TÉLÉCHARGEMENT ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function etapeTelecharger({ dossier, budget }) {
    const plan = lirePlan(dossier), HOTE = require('./collecte-cartes/recolte-hote'), CLI = require('./collecte-cartes/recolte-cli');
    const fournisseurs = CO.chargerFournisseurs(), F = fichiersDe(dossier);
    const rapports = await CO.telechargerPlan({ plan, fournisseurs, plafond: code => HOTE.nbCache(F(code).cache) + budget, fichiersDe: F, telecharger: RC.telecharger, arret: arretDe, maximumImages: CLI.maximumImages, indexDe: Fi => RC.lireJson(Fi.images, {}) });
    const echec = rapports.filter(r => !['termine', 'plafond'].includes(r.etat));
    for (const r of echec) console.error(`❌ téléchargement ${r.code} : ${r.etat}${r.motif ? ` (${r.motif})` : ''}`);
    if (echec.length) process.exitCode = 1;
    return rapports;
}

// ── 3. LA DÉCISION ───────────────────────────────────────────────────────────────────────────────────────────────────────────
async function etapeDecider({ dossier, lecture = null }) {
    const plan = lirePlan(dossier), fournisseurs = CO.chargerFournisseurs(), F = fichiersDe(dossier), HOTE = require('./collecte-cartes/recolte-hote');
    const defs = new Map(fournisseurs.map(f => [f.code, f.def])), index = new Map(fournisseurs.map(f => [f.code, RC.lireJson(F(f.code).images, {})]));
    const le = new Date();
    const verdicts = [];
    for (const p of plan.produits) {
        const v = await CO.jugerProduit({ produit: p.produit, candidats: p.candidats, defs, ordre: plan.ordre,
            jugement: u => { const code = p.candidats.find(c => c.unite === u).code; return index.get(code)[u.url]; },
            octets: (code, u) => {
                const c = HOTE.lireDuCache(F(code).cache, u.url), ix = index.get(code)[u.url];
                return c && ix && crypto.createHash('sha256').update(c.octets).digest('hex') === ix.sha256 ? c.octets : null;    // un cache altéré (sha256) ne décide de rien
            } });
        verdicts.push({ idProduct: p.idProduct, name: p.name, sources: p.sources, ...v });
    }
    const asm = CO.assembler({ verdicts, trousDirects: plan.trousDirects.map(t => CO.construireTrou({ ...t, le })), sansOffre: plan.sansOffre.map(idProduct => ({ idProduct })), ordre: plan.ordre, le });
    // l'--attendu par fournisseur : la même décision d'écriture que l'écriture, depuis le cache seulement
    const attendu = {};
    const gagnantsCodes = Object.keys(asm.gagnants);
    let lect = lecture, ouvertIci = false;
    if (gagnantsCodes.length && !lect) { lect = await lectureOuRefus(); ouvertIci = true; }
    try {
        for (const code of gagnantsCodes) {
            const def = defs.get(code), Fi = F(code);
            const r = await RC.ecrire({ SRC: def.SRC, unites: asm.gagnants[code], M: { Carte: { db: { db: lect.cartes.db } } }, dossierCache: Fi.cache, indexImages: index.get(code), compterSeulement: true, lecteur: RC.lecteurNatif(lect.cartes.db) });
            attendu[code] = r.reel;
        }
    } finally { if (ouvertIci) await lect.fermer(); }
    const total = Object.values(attendu).reduce((n, x) => n + x, 0);
    const decisions = { le: le.toISOString(), etat: plan.etat, ordre: plan.ordre,
        produits: verdicts.map(v => ({ idProduct: v.idProduct, name: v.name, decision: v.decision, motif: v.motif ?? null, gagnant: v.gagnant ? { code: v.gagnant.code, largeur: v.gagnant.largeur } : null, preuve: v.preuve })),
        gagnants: asm.gagnants, trous: asm.trous.map(({ le: _le, ...t }) => t), reportes: asm.reportes, attendu, total };
    RC.ecrireJson(path.join(dossier, 'decisions-comblement.json'), decisions);
    const parMotif = asm.trous.reduce((m, t) => (m[t.motif] = (m[t.motif] || 0) + 1, m), {});
    note(`DÉCISIONS : visuels à écrire ${total} (--attendu=${total}${gagnantsCodes.length ? ` : ${gagnantsCodes.map(c => `${c} ${attendu[c]}`).join(' · ')}` : ''}) · trous nommés ${asm.trous.length} ${JSON.stringify(parMotif)} · reportés ${asm.reportes.length}`);
    note(`   → ${path.join(dossier, 'decisions-comblement.json')}`);
    return decisions;
}

// ── 4. L'ÉCRITURE (sous lot-additif.js) ──────────────────────────────────────────────────────────────────────────────────────
async function etapeEcrire({ dossier, attendu }) {
    const D = RC.lireJson(path.join(dossier, 'decisions-comblement.json'), null);
    if (!D?.gagnants) throw new Error('decisions-comblement.json absent : lancer --decider d\'abord');
    if (CO.etatTropVieux(new Date(D.etat?.le))) throw new Error(`l'état A/B/C (${D.etat?.fichier ?? '?'}) a plus de ${CO.ETAT_AGE_MAX_JOURS} jours (ou sa date est illisible) : aucune écriture — relancer compteurs-abc.js puis le plan`);
    const fournisseurs = CO.chargerFournisseurs(), defs = new Map(fournisseurs.map(f => [f.code, f.def])), F = fichiersDe(dossier);
    const { ouvrirConnexions } = require('./collecte-cartes/garde'), { modeles } = require('./collecte-cartes/schemas'), r2 = require('./collecte-cartes/r2');
    const { vignetterApresJointure } = require('./collecte-cartes/vignettes-apres-jointure'), { fabriquerVerrou } = require('./collecte-cartes/verrou-source');
    if (Object.keys(D.gagnants).length && !process.env.R2_BUCKET_IMAGES) throw new Error('R2_BUCKET_IMAGES : nom de bucket absent — aucune écriture');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: Object.keys(D.gagnants).length ? ['R2_BUCKET_IMAGES'] : [] });
    try {
        if (Object.keys(D.gagnants).length) await r2.verifierBucket(process.env.R2_BUCKET_IMAGES);
        const le = new Date(D.le);
        const trous = D.trous.map(t => CO.construireTrou({ ...t, le }));
        // F4 : l'état du jour (celui de la décision) dit quels trous existants ne sont plus MANQUANTS
        const etatDuJour = JSON.parse(fs.readFileSync(path.join(CO.DOSSIER_COMPTEURS, D.etat.fichier), 'utf8'));
        const classeVisuelParId = new Map(etatDuJour.map(p => [p.idProduct, p.classeVisuel]));
        const r = await CO.executerEcriture({ gagnants: D.gagnants, defs, attendu, trous,
            ecrireFournisseur: (def, unites, opt) => {
                const Fi = F(def.CODE), indexImages = RC.lireJson(Fi.images, {});
                if (opt.compterSeulement) return RC.ecrire({ SRC: def.SRC, unites, M: modeles(cx), dossierCache: Fi.cache, indexImages, compterSeulement: true });
                return RC.ecrire({ SRC: def.SRC, unites, M: modeles(cx), dossierCache: Fi.cache, indexImages, attendu: opt.attendu, deposer: (b, c, d, t) => r2.deposerBinaire(b, c, d, t), vignetter: vignetterApresJointure,
                    fabriquerVerrouSet: ({ Modele, id }) => fabriquerVerrou({ Modele, id, dureeMs: 10 * 60 * 1000, surInsertion: { debute: new Date(), phase: 'plan' }, nom: `verrou de set ${id}` }) });
            },
            ecrireTrous: async (ts) => { const rt = await CO.ecrireTrous(cx.db, ts, { classeVisuelParId, le: new Date() }); RC.ecrireJson(path.join(dossier, 'rapport-ecriture.json'), { le: new Date().toISOString(), trous: rt }); return rt; } });
        note(`ÉCRITURE : ${r.etat} · attendu ${r.attendu} · réel ${r.reel} ${JSON.stringify(r.reels)} · visuels écrits ${r.ecrits} · trous nommés ${JSON.stringify(r.trous)} · REQUÊTES 0`);
        process.exitCode = r.code;
        return r;
    } finally { await fermer(); }
}

// ── 5. LA NUIT ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function assurerCollectionTrous() {
    // lot-additif.js SAUVEGARDE les collections nommées et refuse une collection qui n'existe pas (backup-collections.js : « collection(s) introuvable(s) »).
    // La plus petite solution sûre : créer la collection VIDE avant le lot (aucun document, idempotent), jamais retirer `trous_nommes` de la sauvegarde.
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    try {
        const presentes = (await cx.db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name);
        if (!presentes.includes('trous_nommes')) { await cx.db.createCollection('trous_nommes'); note('   collection trous_nommes créée (vide) : la sauvegarde du lot la lit'); }
    } finally { await fermer(); }
}
async function nuit({ dossier, aBlanc, limite, budget }) {
    const debut = new Date();                                  // M4 : « neuf » se mesure depuis le DÉBUT du passage (un produit ajouté pendant le passage reste neuf au suivant)
    const date = jour();
    const av = [];
    let plan = null, rapports = [], decisions = null, ecrit = null, lot = null, trousEcrits = null;
    try {
        // F3 : l'état est régénéré d'abord (compteur de production en processus fils) ; échec = arrêt, jamais un repli sur un ancien fichier
        const etatNom = CO.regenererEtat({ lister: () => fs.readdirSync(CO.DOSSIER_COMPTEURS), lancer: () => spawnSync(process.execPath, [path.join('audit-catalogue', 'compteurs-abc.js'), '--note=comblement-nocturne : file a l\'arret verifiee par les gardes'], { cwd: __dirname, stdio: 'inherit', env: process.env, timeout: 90 * 60 * 1000 }) });
        note(`ÉTAT FRAIS : ${etatNom}`);
        plan = await etapePlan({ dossier, limite, etatNom });
        const vieux = CO.etatTropVieux(new Date(plan.etat.le));
        if (vieux) {
            const m = `l'état A/B/C (${plan.etat.fichier}) a plus de ${CO.ETAT_AGE_MAX_JOURS} jours : ${aBlanc ? 'AVERTISSEMENT (à blanc)' : 'aucune écriture'} — relancer compteurs-abc.js`;
            if (!aBlanc) throw new Error(m);
            av.push(m);
        }
        rapports = await etapeTelecharger({ dossier, budget });
        if (process.exitCode) throw new Error('un téléchargement a échoué');
        decisions = await etapeDecider({ dossier });
        const N = decisions.total, M = decisions.trous.length;
        if (aBlanc) ecrit = 'À BLANC : aucune écriture';
        else if (!N && !M) ecrit = 'rien à écrire';
        else {
            await assurerCollectionTrous();
            const c = spawnSync(process.execPath, ['lot-additif.js', `--quoi=comblement ${date} : ${N} visuels, ${M} trous`, '--collections=cartes,images,sets,collecte_images_etat,trous_nommes', '--', 'node', 'comblement-nocturne.js', '--ecrire', `--attendu=${N}`, `--dossier=${dossier}`],
                { cwd: __dirname, stdio: 'inherit', env: process.env });
            lot = c.status;
            ecrit = lot === 0 ? `lot-additif.js : succès (${N} visuels, ${M} trous)` : `ÉCHEC : lot-additif.js a rendu le code ${lot}`;
            if (lot !== 0) { process.exitCode = lot ?? 1; throw new Error(ecrit); }
            trousEcrits = RC.lireJson(path.join(dossier, 'rapport-ecriture.json'), null)?.trous ?? null;
            RC.ecrireJson(path.join(dossier, 'dernier-passage.json'), { le: debut.toISOString(), visuels: N, trous: M, etat: plan.etat.fichier });
        }
    } catch (e) {
        console.error('❌', e.message); process.exitCode = process.exitCode || 1; av.push(`ÉCHEC : ${e.message}`);
    } finally {
        const md = CO.redigerCompteRendu({ date, aBlanc, etat: plan ? { fichier: plan.etat.fichier, le: new Date(plan.etat.le) } : null, population: plan?.population ?? { base: 0, cibles: 0, sansOffre: 0, reportes: 0 }, comptesPlan: plan?.comptes ?? {},
            rapportsTelechargement: rapports, bloquees: (plan?.fournisseurs ?? []).filter(f => f.bloquee).map(f => f.code), ecrit, trous: decisions?.trous ?? [], reportes: decisions?.reportes ?? [], visuels: decisions?.total ?? 0, attendu: decisions?.total ?? null, trousEcrits, avertissements: av });
        fs.mkdirSync(dossier, { recursive: true });
        fs.writeFileSync(path.join(dossier, `nuit-${date}.md`), md, 'utf8');
        note(`COMPTE RENDU → ${path.join(dossier, `nuit-${date}.md`)}`);
    }
}

async function main(args = process.argv.slice(2)) {
    const refus = CO.verifierArguments(args);
    if (refus) { console.error(`❌ ${refus}`); process.exitCode = 2; return; }
    const mode = CO.MODES.find(m => args.includes(m));
    const val = nom => args.find(a => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);
    let dossier;
    try { dossier = CO.dossierDe(args); } catch (e) { console.error('❌', e.message); process.exitCode = 2; return; }
    try {
        if (mode === '--ecrire') require('./collecte-cartes/images-empruntees').garderSousLot(process.env, process.ppid);       // AVANT tout, même avant les gardes : hors lot-additif.js, rien ne s'ouvre
        if (['--telecharger', '--ecrire', '--nuit'].includes(mode) && !appliquerGardes(dossier)) return;
        const limite = val('limite') ? Number(val('limite')) : CO.PLAFOND_PAR_DEFAUT;
        const budget = val('plafond') ? Number(val('plafond')) : 400;
        if (mode === '--plan') await etapePlan({ dossier, limite });
        else if (mode === '--telecharger') await etapeTelecharger({ dossier, budget });
        else if (mode === '--decider') await etapeDecider({ dossier });
        else if (mode === '--ecrire') await etapeEcrire({ dossier, attendu: Number(val('attendu')) });
        else await nuit({ dossier, aBlanc: args.includes('--a-blanc'), limite, budget });
    } catch (e) { console.error('❌', e.message); process.exitCode = process.exitCode || 1; }
}

if (require.main === module) main();
module.exports = { main, etapePlan, etapeTelecharger, etapeDecider, etapeEcrire, nuit };
