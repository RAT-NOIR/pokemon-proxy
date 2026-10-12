// ============================================================
// LE nomJa DE SIX SETS JAPONAIS, PROUVÉ PAR DEUX SOURCES OUVERTES — pour que `collecter-logos-officiels.js` puisse confirmer le set d'un logo « ? »
// ============================================================
//   node poser-nomja-sets.js                                                              (SIMULATION : lit la base, le cache TCGdex, l'archive R2 des pages Bulbapedia ; n'écrit RIEN)
//   node lot-additif.js --quoi="nomJa de 6 sets (logos)" --collections=sets -- node poser-nomja-sets.js --ecrire
// POURQUOI : `promouvoir` (collecter-logos-officiels.js) ne confirme un set « ? » que si un set, et un seul, porte un nomJa ÉGAL au texte japonais du logo.
// Dark-Phantasma, Incandescent-Arcana, VMAX-Rising, Champion-Road (et Ultra-Force, Dream-League) ont nomJa null : la confirmation ne peut pas s'établir.
// LA PREUVE (deux sources qui ne se copient pas, liées à NOTRE set par le CODE, jamais par le nom) :
//   (1) TCGdex, liste japonaise en cache (`tcgdex_sets` ja/__liste__) : le set dont l'IDENTIFIANT est le code de notre set (S10a ↔ s10a, SM5+ ↔ sm5+) porte ce nom ;
//   (2) l'infobox de NOTRE page Bulbapedia archivée (sets.bulba.cleR2, R2 brut) : `setname` porte le même nom japonais, et le fichier `logo=` de la page commence
//       par le code du set (« S10a Dark Phantasma Logo.png », « SM5Plus Logo.png ») — la page est bien celle du set de ce code.
// Les deux doivent concorder ET égaler le texte que le coordinateur a lu sur le logo (SETS_NOMJA). Une divergence, une absence, un doublon : rien n'est écrit.
// ÉCRITURE : le SEUL champ `nomJa`, additif (absent ou null → valeur) ; une valeur déjà posée n'est jamais remplacée.
require('dotenv').config();

/** La liste FERMÉE : set → texte japonais lu à l'œil sur le logo (Pokécardex en référence visuelle, jamais copié). */
const SETS_NOMJA = {
    'Dark-Phantasma': 'ダークファンタズマ',
    'Incandescent-Arcana': '白熱のアルカナ',
    'VMAX-Rising': 'VMAXライジング',
    'Champion-Road': 'チャンピオンロード',
    'Ultra-Force': 'ウルトラフォース',
    'Dream-League': 'ドリームリーグ'
};
const CJK = /[぀-ヿ㐀-鿿]/;
const GAMMES = /^(強化拡張パック|拡張パック)\s*/;

/** Le nom japonais de l'infobox (`setname`, ou `jasetname`) sans le nom de la gamme, et le fichier `logo=`. Une valeur unique, ou une raison. */
function nomJaDeBulbapedia(wikitext) {
    const t = String(wikitext || '');
    const logo = ((/^\|\s*logo\s*=\s*(.+?)\s*$/m.exec(t) || [])[1] || '').replace(/\s*(?:<!--.*|-->)\s*$/, '').trim() || undefined;
    const brut = (/^\|\s*(?:ja)?setname\s*=(.*)$/m.exec(t) || [])[1];
    if (brut == null) return { logo, raison: 'aucun paramètre setname dans l\'infobox' };
    const segments = brut.replace(/<\/?small>/gi, '<br>').split(/<br\s*\/?>/i).map(s => s.trim()).filter(s => CJK.test(s)).map(s => s.replace(GAMMES, '').trim()).filter(Boolean);
    const distincts = [...new Set(segments)];
    if (!distincts.length) return { logo, raison: 'aucun nom japonais dans setname' };
    if (distincts.length > 1) return { logo, raison: `plusieurs noms japonais dans setname : ${distincts.join(' / ')}` };
    return { nomJa: distincts[0], logo };
}

/** Le nom japonais du set TCGdex dont l'IDENTIFIANT est `code` (casse ignorée) — un seul, sinon une raison. */
function nomJaDeTcgdex(liste, code) {
    if (!Array.isArray(liste) || !liste.length) return { raison: 'liste TCGdex ja vide ou absente : je ne conclus rien sur un vide' };
    const m = liste.filter(s => String(s.id).toLowerCase() === String(code).toLowerCase());
    if (m.length !== 1) return { raison: `${m.length} set(s) TCGdex d'identifiant « ${code} » (un seul attendu)` };
    return { id: m[0].id, nomJa: m[0].name };
}

/** Le fichier du logo commence-t-il par le code du set (frontière de mot : « s1a » ne se lit pas dans « S10a ») ? */
function logoCommenceParCode(logo, code) {
    if (!logo || !code) return false;
    const c = String(code).toLowerCase().replace(/\+/g, 'plus');
    const l = String(logo).toLowerCase().replace(/_/g, ' ');
    return l.startsWith(c) && !/[a-z0-9]/.test(l.charAt(c.length) || ' ');
}

/** La preuve complète d'UN set : { ok, nomJa, sources } ou { ok: false, raison }. */
function prouver(set, liste, wikitext) {
    const attendu = SETS_NOMJA[set?._id];
    if (!attendu) return { ok: false, raison: `set « ${set?._id} » hors de la liste fermée` };
    if (!set.code) return { ok: false, raison: 'le set n\'a pas de code' };
    const a = nomJaDeTcgdex(liste, set.code);
    if (!a.nomJa) return { ok: false, raison: `TCGdex : ${a.raison}` };
    const b = nomJaDeBulbapedia(wikitext);
    if (!b.nomJa) return { ok: false, raison: `Bulbapedia : ${b.raison}` };
    if (!logoCommenceParCode(b.logo, set.code)) return { ok: false, raison: `la page Bulbapedia (logo « ${b.logo} ») ne porte pas le code « ${set.code} » : lien non tenu` };
    if (a.nomJa !== b.nomJa) return { ok: false, raison: `les sources divergent : TCGdex « ${a.nomJa} », Bulbapedia « ${b.nomJa} »` };
    if (a.nomJa !== attendu) return { ok: false, raison: `les sources concordent sur « ${a.nomJa} » mais le logo lu à l'œil dit « ${attendu} »` };
    return { ok: true, nomJa: a.nomJa, sources: { tcgdex: a.id, bulbapediaLogo: b.logo } };
}

/** L'écriture d'UN set : le seul champ nomJa, absent/null → valeur. `S` : la collection `sets`. */
async function ecrireNomJa(S, id, preuve) {
    if (!preuve?.ok) return { action: 'refus', raison: preuve?.raison ?? 'pas de preuve' };
    const doc = await S.findOne({ _id: id }, { projection: { nomJa: 1 } });
    if (!doc) return { action: 'refus', raison: `set ${id} absent` };
    if (doc.nomJa) return doc.nomJa === preuve.nomJa ? { action: 'deja' } : { action: 'refus', raison: `${id} porte déjà nomJa « ${doc.nomJa} » ≠ « ${preuve.nomJa} » : rien n'est remplacé` };
    const u = await S.updateOne({ _id: id, nomJa: null }, { $set: { nomJa: preuve.nomJa } });
    return u.modifiedCount === 1 ? { action: 'ecrit' } : { action: 'refus', raison: `${id} : le champ est apparu entre-temps` };
}

module.exports = { SETS_NOMJA, nomJaDeBulbapedia, nomJaDeTcgdex, logoCommenceParCode, prouver, ecrireNomJa };

if (require.main === module) (async () => {
    const inconnus = process.argv.slice(2).filter(a => a !== '--ecrire');
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisé : --ecrire`); process.exit(2); }
    const ECRIRE = process.argv.includes('--ecrire');
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const r2 = require('./collecte-cartes/r2');
    const cx = await ouvrirConnexions({ production: false, buckets: ['R2_BUCKET_BRUT'] });
    await r2.verifierBucket(process.env.R2_BUCKET_BRUT);
    const S = cx.cartes.db.collection('sets');
    const liste = (await cx.cartes.db.collection('tcgdex_sets').findOne({ _id: 'ja/__liste__' }))?.sets;
    if (!Array.isArray(liste) || !liste.length) throw new Error('tcgdex_sets ja/__liste__ absente ou vide : cache faux');
    const ids = Object.keys(SETS_NOMJA);
    const docs = await S.find({ _id: { $in: ids } }, { projection: { code: 1, nomJa: 1, tirage: 1, 'bulba.cleR2': 1 } }).toArray();
    console.log(`DÉNOMINATEUR : ${ids.length} sets de la liste fermée · ${docs.length} trouvés en base · ${liste.length} sets dans la liste TCGdex ja · 0 requête réseau`);
    if (docs.length !== ids.length) throw new Error(`sets manquants en base : ${ids.filter(i => !docs.some(d => d._id === i)).join(', ')}`);
    const bilan = {};
    for (const id of ids) {
        const d = docs.find(x => x._id === id);
        if (d.tirage !== 'jp') { console.log(`   🔴 ${id} : tirage ${d.tirage}, pas jp`); bilan.refus = (bilan.refus || 0) + 1; continue; }
        if (!d.bulba?.cleR2) { console.log(`   🔴 ${id} : pas de page Bulbapedia archivée`); bilan.refus = (bilan.refus || 0) + 1; continue; }
        const wt = await r2.lireTexte(process.env.R2_BUCKET_BRUT, d.bulba.cleR2);
        const p = prouver(d, liste, wt);
        const porteurs = p.ok ? await S.countDocuments({ nomJa: p.nomJa, _id: { $ne: id } }) : null;
        console.log(`   ${p.ok ? '✅' : '🔴'} ${id.padEnd(22)} code ${String(d.code).padEnd(6)} nomJa actuel ${JSON.stringify(d.nomJa)} → ${p.ok ? `« ${p.nomJa} » (TCGdex ${p.sources.tcgdex}, page ${p.sources.bulbapediaLogo}) · autres sets au même nomJa : ${porteurs}` : p.raison}`);
        if (p.ok && porteurs) console.log(`      ⚠️ ${porteurs} autre(s) set(s) portent déjà ce nomJa : la confirmation de collecter-logos-officiels.js exigera un set et un seul`);
        if (!ECRIRE) { bilan[p.ok ? 'prouve' : 'refus'] = (bilan[p.ok ? 'prouve' : 'refus'] || 0) + 1; continue; }
        const e = await ecrireNomJa(S, id, p);
        bilan[e.action] = (bilan[e.action] || 0) + 1;
        if (e.action === 'refus') console.log(`      🔴 ${e.raison}`);
    }
    console.log(`\n${ECRIRE ? 'ÉCRIT' : 'SIMULATION'} : ${JSON.stringify(bilan)}`);
    if (ECRIRE) console.log(`RELU : ${await S.countDocuments({ _id: { $in: ids }, nomJa: { $type: 'string', $ne: '' } })} / ${ids.length} sets portent un nomJa`);
    await cx.fermer();
    if (bilan.refus) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(1); });
