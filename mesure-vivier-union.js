// ============================================================================
// L'UNION DES DEUX VIVIERS — mesure seule, aucune écriture, aucun code touché
// ============================================================================
// USAGE : node mesure-vivier-union.js --base=<nom>
//
// LA QUESTION. La production construit son vivier avec le `nomExact` rendu par TCGdex ;
// le banc le construit avec le nom LU. Mesuré sur 65 lignes : ils diffèrent 3 fois, et
// les 3 fois c'est le vivier du nom lu qui contient la vérité. Plutôt que de choisir,
// on peut prendre l'UNION : le vivier ne peut alors que grossir, donc la bonne carte ne
// peut plus être perdue à l'entrée. Reste à savoir ce que les concurrents
// supplémentaires coûtent en aval.
//
// ⚠️ CE QUI EST REJOUÉ, ET CE QUI NE L'EST PAS. On rejoue la chaîne qui décide du
// gagnant : scoring réel -> départage par symbole -> refus sur égalité parfaite dont
// l'écart de prix dépasse le seuil. On ne rejoue PAS le veto par le nom, le chemin par
// setCode+numéro, ni l'identification locale : ces chemins construisent leur vivier
// autrement et l'union ne les concerne pas. Les lignes qui en relèvent sont comptées à
// part, jamais mélangées au verdict.
require('dotenv').config();

const BASE = process.argv.find(a => a.startsWith('--base='))?.split('=')[1];
if (!BASE) { console.error('❌ --base=<nom> obligatoire.'); process.exit(1); }
process.env.MONGODB_BASE = BASE;

const mongoose = require('mongoose');
const S = require('./scoring');
const { numeroEstUnDexId } = require('./pokedex');
const { EXPANSIONS_VINTAGE, departagerParSymbole } = require('./sets-vintage-japonais');
const { trouverProduitsLocaux, trouverCarteTCGdex, scorerCandidatsLocal, lireCodeSets } = require('./index');
const SEAUX = require('./banc-seaux');

const LANGUES_ASIATIQUES = ['JP', 'ZH', 'KR'];
const ECART_PRIX_TOLERABLE = 1.00;          // la valeur de production (index.js)
const pc = (n, d) => d ? `${(100 * n / d).toFixed(1)} %` : '—';
const mediane = a => { if (!a.length) return null; const t = [...a].sort((x, y) => x - y); const m = t.length >> 1; return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2; };

(async () => {
    for (let i = 0; i < 60 && mongoose.connection.readyState !== 1; i++) await new Promise(r => setTimeout(r, 500));
    if (mongoose.connection.readyState !== 1) { console.error('❌ Mongo non connecté.'); process.exit(1); }
    const reelle = mongoose.connection.db.databaseName;
    if (reelle !== BASE) { console.error(`❌ ARRÊT : connecté à « ${reelle} » alors que --base=${BASE}.`); process.exit(1); }

    const lignes = await mongoose.connection.db.collection('journal_scans')
        .find({ route: 'identifier' }).sort({ le: 1 }).toArray();
    const verites = require('./banc-verites.json').verites;
    const { lignes: numerotees } = SEAUX.numeroter(lignes);
    const { parIdentite } = SEAUX.rattacherVerites(numerotees, verites);
    const attachees = numerotees
        .map(l => ({ ...l.d, seau: l.seau, cle: l.cle, verite: parIdentite.get(SEAUX.identiteDe(l.d)) }))
        .filter(l => l.verite && l.verite.idProduct != null);

    console.log(`base : ${BASE}   ·   lignes avec vérité : ${attachees.length}\n`);

    // Le verdict d'un vivier donné, par la chaîne réelle.
    async function verdictDe(vivier, cardInfoEffectif, numeroBrut, symboleSet, verite) {
        if (!vivier.length) return { etat: 'refus', motif: 'aucun-candidat', gagnant: null, n: 0 };
        const cs = await lireCodeSets(vivier.map(p => p.idExpansion));
        if (vivier.length === 1) {
            const g = vivier[0].idProduct;
            return { etat: g === verite ? 'juste' : 'faux', gagnant: g, n: 1 };
        }
        const r = await scorerCandidatsLocal(vivier, cardInfoEffectif, null, [], cs, { numeroBrutPourScoring: numeroBrut });
        if (!r.scores.length) return { etat: 'refus', motif: 'aucun-score', gagnant: null, n: vivier.length };
        let gagnant = r.scores[0].candidat.idProduct;
        if (r.scores.length > 1 && S.sontExAequo(r.scores[0].score, r.scores[1].score)) {
            const exAequo = r.scores.filter(s => S.sontExAequo(s.score, r.scores[0].score));
            // 1) le symbole, avant le refus — l'ordre de production.
            const avis = departagerParSymbole(
                symboleSet,
                exAequo.map(s => ({ idProduct: s.candidat.idProduct, codeSet: cs.get(Number(s.candidat.idExpansion)) ?? null })),
                S
            );
            if (avis.gagnant) {
                gagnant = avis.gagnant.idProduct;
                return { etat: gagnant === verite ? 'juste' : 'faux', gagnant, n: vivier.length, departage: true };
            }
            // 2) l'écart de prix décide si l'égalité a un enjeu.
            const prix = exAequo.map(s => s.candidat.prix).filter(p => Number.isFinite(p) && p > 0);
            const ecart = prix.length >= 2 ? Math.max(...prix) - Math.min(...prix) : null;
            if (ecart == null || ecart >= ECART_PRIX_TOLERABLE) {
                return { etat: 'refus', motif: 'egalite-parfaite', gagnant: null, n: vivier.length, exAequo: exAequo.length };
            }
        }
        return { etat: gagnant === verite ? 'juste' : 'faux', gagnant, n: vivier.length };
    }

    const ajouts = [], transitions = new Map(), detailsBascule = [], horsPortee = [];
    const troisDuZeroTrois = ['Ross\'s Wailmer', 'Clair\'s Blastoise', 'Dark Ursaring'];
    const sauvetages = [];
    let comparees = 0;

    for (const l of attachees) {
        const voieOk = l.voieCatalogue === 'nom' || l.voieCatalogue === 'perimetre-vintage';
        const avis = numeroEstUnDexId({ nom: l.nom, numero: l.numero, total: l.total, langue: l.langue });
        const numeroCarte = avis.estDex ? null : l.numero;
        const cardInfoEffectif = {
            name: l.nom, number: numeroCarte, total: l.total, setCode: l.setCode,
            language: l.langue, rarete: l.rarete, rareteElevee: false, nomBrut: l.nomBrut
        };
        let nomExact = null, vProd = [], vLu = [];
        try {
            const t = await trouverCarteTCGdex(l.nom, numeroCarte, l.setCode, null, l.langue, l.total, l.nomBrut);
            nomExact = t ? t.nomExact : null;
            vLu = await trouverProduitsLocaux(l.nom);
            vProd = nomExact ? await trouverProduitsLocaux(nomExact) : [];
        } catch (e) { horsPortee.push({ cle: l.cle, nom: l.nom, raison: `TCGdex : ${e.message}` }); continue; }

        const filtrer = v => {
            if (!(numeroCarte == null && LANGUES_ASIATIQUES.includes(String(l.langue || '').toUpperCase()) && v.length > 1)) return v;
            const dedans = v.filter(p => EXPANSIONS_VINTAGE.has(Number(p.idExpansion)));
            return dedans.length ? dedans : v;
        };
        const P = filtrer(vProd), L = filtrer(vLu);
        const parId = new Map();
        for (const p of [...P, ...L]) if (!parId.has(p.idProduct)) parId.set(p.idProduct, p);
        const U = [...parId.values()];

        if (!voieOk) { horsPortee.push({ cle: l.cle, nom: l.nom, raison: `voie « ${l.voieCatalogue} » — l'union ne la concerne pas` }); continue; }
        comparees++;
        ajouts.push(U.length - P.length);

        const vp = await verdictDe(P, cardInfoEffectif, l.numero, l.symboleSet, l.verite.idProduct);
        const vu = await verdictDe(U, cardInfoEffectif, l.numero, l.symboleSet, l.verite.idProduct);
        const k = `${vp.etat} -> ${vu.etat}`;
        transitions.set(k, (transitions.get(k) || 0) + 1);
        if (vp.etat !== vu.etat) {
            detailsBascule.push({
                cle: l.cle, nom: l.nom, numero: l.numero, nomExact,
                nP: P.length, nU: U.length, de: vp.etat, vers: vu.etat,
                gP: vp.gagnant, gU: vu.gagnant, verite: l.verite.idProduct, veriteNom: l.verite.nom,
                motifU: vu.motif ?? null, exAequoU: vu.exAequo ?? null
            });
        }
        if (troisDuZeroTrois.some(n => String(l.nom).includes(n))) {
            sauvetages.push({ cle: l.cle, nom: l.nom, nomExact, nP: P.length, nU: U.length, vp, vu, verite: l.verite.idProduct });
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    console.log('═'.repeat(78));
    console.log('CE QUE L\'UNION AJOUTE COMME CANDIDATS');
    console.log('═'.repeat(78));
    const nonNuls = ajouts.filter(a => a > 0);
    console.log(`  lignes comparées : ${comparees}   ·   hors portée : ${horsPortee.length}`);
    console.log(`  lignes où l'union ajoute au moins un candidat : ${nonNuls.length}  (${pc(nonNuls.length, comparees)})`);
    console.log(`  candidats ajoutés — médiane sur TOUTES : ${mediane(ajouts)}   ·   médiane sur celles qui bougent : ${mediane(nonNuls) ?? '—'}`);
    console.log(`  candidats ajoutés — MAXIMUM : ${ajouts.length ? Math.max(...ajouts) : '—'}`);

    console.log('\n' + '═'.repeat(78));
    console.log('CE QUE L\'UNION CHANGE AU VERDICT');
    console.log('═'.repeat(78));
    for (const [k, n] of [...transitions].sort((a, b) => b[1] - a[1])) {
        const stable = k.split(' -> ')[0] === k.split(' -> ')[1];
        console.log(`  ${stable ? '  ' : '⚡'} ${k.padEnd(20)} ${n}`);
    }
    const gagne = detailsBascule.filter(d => d.vers === 'juste').length;
    const perdu = detailsBascule.filter(d => d.de === 'juste').length;
    const autre = detailsBascule.length - gagne - perdu;
    console.log(`\n  ✅ deviennent JUSTES (faux ou refus -> juste) : ${gagne}`);
    console.log(`  ❌ cessent d'être justes (juste -> faux/refus) : ${perdu}`);
    console.log(`  ⃝  autres bascules (faux <-> refus)            : ${autre}`);
    console.log(`\n  >>> L'UNION ${perdu === 0 && gagne > 0 ? 'NE CASSE RIEN ET GAGNE' : perdu === 0 ? 'NE CASSE RIEN' : 'CASSE ' + perdu + ' LIGNE(S)'}`);
    if (detailsBascule.length) {
        console.log('');
        for (const d of detailsBascule) {
            console.log(`   ${d.cle} "${d.nom}" #${d.numero}  nomExact="${d.nomExact}"  ${d.nP} -> ${d.nU} candidats`);
            console.log(`      ${d.de} (${d.gP}) -> ${d.vers} (${d.gU ?? d.motifU + (d.exAequoU ? ' ×' + d.exAequoU : '')})   vérité ${d.verite} "${d.veriteNom}"`);
        }
    }

    console.log('\n' + '═'.repeat(78));
    console.log('LES 3 LIGNES DU 3-0 — l\'union suffit-elle ?');
    console.log('═'.repeat(78));
    for (const s of sauvetages) {
        console.log(`   ${s.cle} "${s.nom}"  nomExact="${s.nomExact}"   ${s.nP} -> ${s.nU} candidats`);
        console.log(`      production : ${s.vp.etat} (${s.vp.gagnant ?? s.vp.motif})`);
        console.log(`      union      : ${s.vu.etat} (${s.vu.gagnant ?? s.vu.motif})   vérité ${s.verite}`);
        console.log(`      >>> ${s.vu.etat === 'juste' ? '✅ SAUVÉE PAR L\'UNION' : '❌ NON SAUVÉE — il faut autre chose'}`);
    }

    if (horsPortee.length) {
        console.log('\n── hors portée (comptées, jamais mélangées) ──');
        const par = new Map();
        for (const h of horsPortee) par.set(h.raison, (par.get(h.raison) || 0) + 1);
        for (const [r, n] of [...par].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(3)} × ${r}`);
    }

    await mongoose.disconnect();
})().catch(e => { console.error(e.stack); process.exit(1); });
