// ============================================================================
// LE CHEMIN DE REJEU ET LE CHEMIN DE PRODUCTION NE SE COMPARENT NULLE PART
// ============================================================================
// ⚠️ C'EST LE DÉFAUT QUI A FAIT ANNONCER UNE RÉGRESSION AU BANC ALORS QU'IL Y AVAIT UN
// GAIN. Un outil qui rejoue la chaîne produit des chiffres qui RESSEMBLENT à ceux de la
// production, et rien ne vérifie jamais qu'ils en sont. Tant que la comparaison n'est pas
// écrite, chaque mesure de rejeu est une hypothèse déguisée en constat.
//
// CE QUE CET OUTIL FAIT : pour chaque ligne asiatique du journal, il rejoue la chaîne et
// compare à CE QUI EST DÉJÀ ÉCRIT — pas à ce qu'on croit qu'elle a fait.
//
// ⚠️ RÈGLE DE LECTURE DES CHAMPS ABSENTS. `nbCandidats` et `nbExAequo` n'existent que
// depuis le 2026-08-11 sur les refus ; `raisonReserve` n'existe pas du tout sur un refus
// (elle se calcule sur un prix qu'on livre). Un champ ABSENT n'est PAS une divergence :
// il est INCOMPARABLE, et compté comme tel. C'est le premier principe, et l'avoir violé
// dans un compteur m'a déjà donné 80 refus au lieu de 31.
//
// LECTURE SEULE. Aucun réseau, aucune installation, aucune écriture.
// USAGE : node mesure-rejeu-contre-journal.js --base=<nom>
process.env.MONGODB_BASE = process.argv.find(a => a.startsWith('--base='))?.split('=')[1] || '';
if (!process.env.MONGODB_BASE) { console.error('❌ --base=<nom> obligatoire.'); process.exit(1); }
require('dotenv').config();
const mongoose = require('mongoose');
const SCORING = require('./scoring');
const { sontExAequo } = SCORING;
const { EXPANSIONS_VINTAGE, setCodeCompatibleVintage } = require('./sets-vintage-japonais');
const { trouverProduitsLocaux, scorerCandidatsLocal, lireCodeSets } = require('./index');

const ASIAT = ['JP', 'ZH', 'KR'];
const pc = (n, d) => d ? `${(100 * n / d).toFixed(1)} %` : '—';

(async () => {
    for (let i = 0; i < 60 && mongoose.connection.readyState !== 1; i++) await new Promise(r => setTimeout(r, 500));
    if (mongoose.connection.db.databaseName !== process.env.MONGODB_BASE) { console.error('❌ mauvaise base.'); process.exit(1); }
    const db = mongoose.connection.db;
    const J = db.collection('journal_scans'), CAT = db.collection('catalogue_produits'), NUM = db.collection('numeros_cartes');

    const lignes = (await J.find({ route: 'identifier' }).sort({ le: 1 }).toArray())
        .filter(l => ASIAT.includes(String(l.langue || '').toUpperCase()) && l.nom);
    console.log(`lignes asiatiques nommées : ${lignes.length}\n`);

    // Rejoue une ligne. `expansionsAttendues` est le paramètre suspect : on rejoue DEUX
    // FOIS, une fois vide (mon hypothèse) et une fois avec l'expansion du gagnant
    // journalisé, pour voir si c'est LUI qui explique un écart.
    async function rejouer(l, expAttendues) {
        const vivier = await trouverProduitsLocaux(l.nom);
        if (!vivier.length) return null;
        const compat = setCodeCompatibleVintage(l.setCode, SCORING);
        const dedans = vivier.filter(p => EXPANSIONS_VINTAGE.has(Number(p.idExpansion)));
        const effectif = (compat.compatible && dedans.length) ? dedans : vivier;
        const estDex = l.estDex === true || (l.numero != null && l.total == null);
        const cardInfo = { name: l.nom, number: estDex ? null : l.numero, total: l.total, setCode: l.setCode, language: l.langue, rarete: l.rarete, rareteElevee: false };
        const cs = await lireCodeSets(effectif.map(p => p.idExpansion));
        const r = await scorerCandidatsLocal(effectif, cardInfo, null, expAttendues, cs, { numeroBrutPourScoring: l.numero });
        if (!r.scores?.length) return null;
        const tete = r.scores[0].score;
        return {
            nbCandidats: effectif.length,
            nbExAequo: r.scores.filter(s => sontExAequo(s.score, tete)).length,
            gagnant: r.scores[0].candidat.idProduct,
            score: tete
        };
    }

    const cmp = [];
    for (const l of lignes) {
        const a = await rejouer(l, []);
        if (!a) { cmp.push({ l, rejeu: null }); continue; }
        cmp.push({ l, rejeu: a });
    }

    // ── LE TABLEAU À TROIS COLONNES ─────────────────────────────────────
    console.log('═'.repeat(104));
    console.log('PRODUCTION / REJEU / ÉCART — les champs réellement écrits au journal');
    console.log('═'.repeat(104));
    console.log(`${'carte'.padEnd(22)} ${'gagnant prod'.padStart(12)} ${'rejeu'.padStart(9)} ${'nbCand p/r'.padStart(12)} ${'exAequo p/r'.padStart(12)}   verdict`);
    console.log('─'.repeat(104));

    const compte = { gagnantOk: 0, gagnantDiv: 0, gagnantIncomp: 0, candOk: 0, candDiv: 0, candIncomp: 0, aeqOk: 0, aeqDiv: 0, aeqIncomp: 0, rejeuVide: 0 };
    const divergentes = [];
    for (const { l, rejeu } of cmp) {
        const etiq = `${String(l.nom).slice(0, 14).padEnd(14)} n°${String(l.numero ?? '—').padEnd(5)}`;
        if (!rejeu) { compte.rejeuVide++; console.log(`${etiq.padEnd(22)} ${'—'.padStart(12)} ${'VIDE'.padStart(9)} ${'—'.padStart(12)} ${'—'.padStart(12)}   ⚠️ le rejeu ne rend rien`); continue; }

        // gagnant : comparable seulement sur une ligne ABOUTIE (un refus n'en a pas)
        let vg = '';
        if (l.idProduct == null) { compte.gagnantIncomp++; vg = 'gagnant incomparable (refus)'; }
        else if (Number(l.idProduct) === Number(rejeu.gagnant)) { compte.gagnantOk++; vg = 'gagnant ✅'; }
        else { compte.gagnantDiv++; vg = '❌ GAGNANT DIVERGENT'; }

        // nbCandidats / nbExAequo : absents avant le 2026-08-11 -> INCOMPARABLES
        const cP = Number.isFinite(l.nbCandidats) ? l.nbCandidats : null;
        const aP = Number.isFinite(l.nbExAequo) ? l.nbExAequo : null;
        if (cP == null) compte.candIncomp++; else if (cP === rejeu.nbCandidats) compte.candOk++; else { compte.candDiv++; vg += ' · ❌ nbCandidats'; }
        if (aP == null) compte.aeqIncomp++; else if (aP === rejeu.nbExAequo) compte.aeqOk++; else { compte.aeqDiv++; vg += ' · ❌ nbExAequo'; }

        if (vg.includes('❌')) divergentes.push({ l, rejeu });
        console.log(`${etiq.padEnd(22)} ${String(l.idProduct ?? '—').padStart(12)} ${String(rejeu.gagnant).padStart(9)} ` +
            `${`${cP ?? '—'}/${rejeu.nbCandidats}`.padStart(12)} ${`${aP ?? '—'}/${rejeu.nbExAequo}`.padStart(12)}   ${vg}`);
    }

    console.log('\n' + '═'.repeat(104));
    console.log('LE COMPTE DES DIVERGENCES');
    console.log('═'.repeat(104));
    console.log(`   gagnant     : ${compte.gagnantOk} identiques · ${compte.gagnantDiv} DIVERGENTS · ${compte.gagnantIncomp} incomparables (refus, pas de gagnant)`);
    console.log(`   nbCandidats : ${compte.candOk} identiques · ${compte.candDiv} DIVERGENTS · ${compte.candIncomp} incomparables (champ absent avant le 2026-08-11)`);
    console.log(`   nbExAequo   : ${compte.aeqOk} identiques · ${compte.aeqDiv} DIVERGENTS · ${compte.aeqIncomp} incomparables`);
    console.log(`   rejeu vide  : ${compte.rejeuVide}`);
    const comparables = compte.gagnantOk + compte.gagnantDiv;
    console.log(`\n   -> sur les ${comparables} lignes où le GAGNANT est comparable : ${pc(compte.gagnantDiv, comparables)} de divergence`);

    // ── L'HYPOTHÈSE `expansionsAttendues` : ON LA TESTE, ON NE LA SUPPOSE PAS ──
    if (divergentes.length) {
        console.log('\n' + '═'.repeat(104));
        console.log('HYPOTHÈSE À ÉLIMINER — `expansionsAttendues` vide explique-t-il l\'écart ?');
        console.log('═'.repeat(104));
        console.log('   On rejoue chaque ligne divergente en passant l\'expansion du gagnant JOURNALISÉ.');
        console.log('   Si l\'écart disparaît, la cause est là. Sinon elle est ailleurs, et on le dit.\n');
        for (const { l, rejeu } of divergentes) {
            if (l.idProduct == null) { console.log(`   "${l.nom}" n°${l.numero ?? '—'} : refus, pas d'expansion journalisée -> hypothèse NON TESTABLE ici.`); continue; }
            const p = await CAT.findOne({ idProduct: Number(l.idProduct) });
            if (!p) { console.log(`   "${l.nom}" : gagnant ${l.idProduct} absent du catalogue -> non testable.`); continue; }
            const b = await rejouer(l, [Number(p.idExpansion)]);
            const resolu = b && Number(b.gagnant) === Number(l.idProduct);
            console.log(`   "${String(l.nom).padEnd(14)}" exp=${p.idExpansion} : rejeu vide -> ${rejeu.gagnant} · rejeu AVEC expansion -> ${b?.gagnant ?? 'vide'}` +
                `   ${resolu ? '✅ L\'HYPOTHÈSE TIENT' : '❌ l\'écart demeure — cause AILLEURS'}`);
        }
    } else {
        console.log('\n   Aucune divergence sur les champs comparables : l\'hypothèse `expansionsAttendues`');
        console.log('   n\'a rien à expliquer sur cet échantillon. ⚠️ Ça ne la valide pas — ça la rend sans objet ici.');
    }

    // ── POINT 2 : LE PLANTAGE, ET LA QUESTION DE L'ARGENT ───────────────
    console.log('\n' + '═'.repeat(104));
    console.log('LES `erreur-serveur` — QUELLE EXCEPTION, ET LE CRÉDIT A-T-IL ÉTÉ RENDU ?');
    console.log('═'.repeat(104));
    const plantages = await J.find({ motifEchec: 'erreur-serveur' }).sort({ le: 1 }).toArray();
    console.log(`   lignes 'erreur-serveur' au journal : ${plantages.length}\n`);
    for (const l of plantages) {
        console.log(`   ${String(l.le?.toISOString?.() ?? l.le).slice(0, 19)}  route=${l.route}  "${l.nom}" n°${l.numero ?? '—'} lg=${l.langue ?? '—'}`);
        console.log(`        rembourse=${l.rembourse}   idProduct=${l.idProduct ?? '—'}   voie=${l.voieCatalogue ?? '—'}   nomBrut=${l.nomBrut ?? '—'}`);
        console.log(`        setCode=${l.setCode ?? '—'} total=${l.total ?? '—'} rarete=${l.rarete ?? '—'} nomConfiance=${l.nomConfiance ?? '—'}`);
    }
    console.log('\n   ⚠️ LE MESSAGE D\'EXCEPTION N\'EST PAS AU JOURNAL. `enregistrerEchec` ne reçoit que');
    console.log('      le motif : la ligne dit QU\'il y a eu une exception, jamais LAQUELLE ni où.');
    console.log('      Le texte n\'existe que dans les logs Render, éphémères. C\'est une dette à part.');

    // Qu'a 698502 de particulier ? On regarde, on ne suppose pas.
    console.log('\n── LE PRODUIT VISÉ PAR LES DEUX PLANTAGES ──');
    for (const id of [...new Set(plantages.map(l => l.idProduct).filter(x => x != null))].concat([698502])) {
        const p = await CAT.findOne({ idProduct: Number(id) });
        const n = await NUM.findOne({ idProduct: Number(id) });
        const g = await db.collection('guide_prix').findOne({ idProduct: Number(id) });
        console.log(`   ${id} : catalogue=${p ? JSON.stringify({ name: p.name, idExpansion: p.idExpansion, idMetacard: p.idMetacard }) : 'ABSENT'}`);
        console.log(`        numeros_cartes=${n ? JSON.stringify({ numero: n.numero, numeroUrl: n.numeroUrl, codeSet: n.codeSet, slug: n.slug, nomFr: n.nomFr }) : 'ABSENT'}`);
        console.log(`        guide_prix=${g ? JSON.stringify({ trend: g.trend, trendHolo: g.trendHolo }) : 'ABSENT'}`);
    }
    await mongoose.connection.close();
})().catch(e => { console.error(e.stack); process.exit(1); });
