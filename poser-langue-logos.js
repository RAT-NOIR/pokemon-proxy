// ============================================================
// LA LANGUE DES LOGOS REFUSÉS PAR LE SITE FAUTE DE PREUVE — lue à l'œil (demande du site, DEMANDE-SERVICE-PRODUITS.md 2026-10-04 ;
// feu vert du testeur le 2026-10-05 : « poser la langue des 31 logos refusés »)
// ============================================================
//   node poser-langue-logos.js            (plan : rien d'écrit)
//   node lot-additif.js --quoi="…" --collections=sets -- node poser-langue-logos.js --ecrire
// Le site lit `sets.logo.langue` comme PREUVE, contre le tirage du set (lib/visuelSet.ts, LANGUES_DU_LOGO). Une langue ne se pose que sur
// un logo REGARDÉ : la table LUS dit, pour chaque set, ce qui est écrit sur le fichier. LA GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE : seuls
// les sets de la table ; le fichier en base doit être CELUI qui a été lu (cleR2) ; la langue doit être admise pour le tirage du set ;
// `logo.langue` doit être vide (rien n'est remplacé). Écrit : `logo.langue` et `logo.langueLue` { le, lu }.
// ⚠️ ÉCARTÉS, et dits : Radiant-Energy-Vol-1, -2, -3 — leurs fichiers sont des PHOTOS DE BOOSTER (« 宝可梦 … 辉耀能量 »), pas des logos
// (§66 : un setlogo de Bulbapedia peut être une photo de produit) ; leur poser une langue les ferait afficher comme logos.
require('dotenv').config();
const AUTORISES = [/^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisé : --ecrire`); process.exit(2); }
const { ouvrirConnexions } = require('./collecte-cartes/garde');

const LE = '2026-10-05';
const zh = (cle, texte) => ({ cle, langue: 'zh-hans', lu: `« ${texte} » en sinogrammes SIMPLIFIÉS` });
const LUS = {
    'Stellar-Crystal': zh('bulbapedia/logos/csv9logoscpng.png', '星彩晶璃'),
    'Terastal-Gathering': zh('bulbapedia/logos/csv95logoscpng.png', '太晶盛聚'),
    'Blade-Awakening': zh('bulbapedia/logos/csv7logoscpng.png', '利刃猛醒'),
    'Bonus-Round': zh('bulbapedia/logos/csv4logoscpng.png', '嘉奖回合'),
    'Fearless-Terastal': zh('bulbapedia/logos/csv3logoscpng.png', '无畏太晶'),
    'Miracle-Journey': zh('bulbapedia/logos/csv2logoscpng.png', '奇迹启程'),
    'Striking-Competition': zh('bulbapedia/logos/strikingcompetitionlogopng.png', '炫奇争胜'),
    'Dynamax-Tactics': zh('bulbapedia/logos/cs15logopng.png', '极巨攻防'),
    'Scorching-Skies': zh('bulbapedia/logos/cs35logopng.png', '怒炎灼天'),
    'Battle-Elite': zh('bulbapedia/logos/battleelitelogopng.png', '对战精英'),
    'Brilliant-Counterattack': zh('bulbapedia/logos/cs25logopng.png', '璀璨反击'),
    'Brilliant-Fantasy': zh('bulbapedia/logos/csv8logoscpng.png', '璀璨诡幻'),
    'Return-of-the-Dragon': zh('bulbapedia/logos/csflogopng.png', '龙之再临'),
    'Eternal-Birth': zh('bulbapedia/logos/csv1logoscpng.png', '亘古开来, sous « 朱&紫 »'),
    'True-Mystery': zh('bulbapedia/logos/csv6logoscpng.png', '真实玄虚'),
    'Dark-Crystal-Blaze': zh('bulbapedia/logos/csv5logoscpng.png', '黑晶炽诚'),
    'Victory-Star-Guide': zh('bulbapedia/logos/cs65logopng.png', '胜象星引'),
    'Shadow-of-Glory': zh('bulbapedia/logos/cs55logopng.png', '暗影夺辉'),
    'Final-Flame-Dance': zh('bulbapedia/logos/cs45logopng.png', '终末炎舞'),
    'Chasing-Glory-Together': zh('bulbapedia/logos/csv10logoscpng.png', '共逐荣光'),
    'Collect-151': zh('bulbapedia/logos/collection151logopng.png', '收集啦151'),
    'Terastal-Festival-ex': { cle: 'bulbapedia/logos/sv8aterastalfestexlogopng.png', langue: 'ja', lu: '« テラスタルフェスex » en katakana' },
    'MEGA-Starter-Set-Mega-Diancie-ex': { cle: 'logos/ptcg-assets/ja_mbd-c7da35597e.png', langue: 'ja', lu: '« スターターセット MEGA / メガディアンシーex » en katakana' },
    'MEGA-Starter-Set-Mega-Gengar-ex': { cle: 'logos/ptcg-assets/ja_mbg-4bfa3ae6ef.png', langue: 'ja', lu: '« スターターセット MEGA / メガゲンガーex » en katakana' },
    'MEGA-Start-Deck-100-Battle-Collection': { cle: 'logos/ptcg-assets/ja_mc-3fe377321b.png', langue: 'ja', lu: '« スタートデッキ 100 バトルコレクション » en katakana' },
    'Black-White-IDTH': { cle: 'bulbapedia/logos/sv11sblackwhitelogoindonesianthaipng.png', langue: 'id', lu: '« HITAM & PUTIH » (indonésien) et « แบล็ก & ไวท์ » (thaï) : les deux langues du tirage idth ; « id » posé' },
    'Mega-Evolution-IDTH': { cle: 'bulbapedia/logos/ma1megaevolutionlogoindonesianthaipng.png', langue: 'id', lu: '« EVOLUSI MEGA » (indonésien) et le titre thaï : les deux langues du tirage idth ; « id » posé' },
    'Void-Blast': { cle: 'bulbapedia/logos/ma4voidblastlogoindonesianthaipng.png', langue: 'th', lu: '« วอยด์บลาสต์ » en écriture thaïe seule' }
};
// la règle du site (rat-market-site lib/visuelSet.ts, LANGUES_DU_LOGO), recopiée mot pour mot : une langue hors de la liste du tirage serait refusée
const LANGUES_DU_LOGO = { jp: ['ja'], intl: ['en', 'fr'], 'zh-hans': ['zh-hans'], 'zh-hant': ['zh-hant'], th: ['th'], id: ['id'], idth: ['id', 'th'] };

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const S = cx.db.collection('sets');
    const docs = new Map((await S.find({ _id: { $in: Object.keys(LUS) } }, { projection: { logo: 1, tirage: 1, region: 1 } }).toArray()).map(d => [d._id, d]));
    const plan = [];
    for (const [slug, l] of Object.entries(LUS)) {
        const d = docs.get(slug), t = d?.tirage ?? d?.region;
        const refus = !d ? 'set absent' : d.logo?.cleR2 !== l.cle ? `le logo en base n'est plus celui qui a été lu (${d.logo?.cleR2})` : d.logo?.langue ? `logo.langue déjà posée (${d.logo.langue})` : !(LANGUES_DU_LOGO[t] ?? []).includes(l.langue) ? `« ${l.langue} » n'est pas admise pour le tirage ${t}` : null;
        plan.push({ slug, ...l, tirage: t, refus });
        console.log(`${refus ? '✗' : '✓'} ${slug.padEnd(40)} ${String(t).padEnd(8)} → ${l.langue.padEnd(8)} ${refus ?? l.lu}`);
    }
    const ok = plan.filter(p => !p.refus);
    console.log(`DÉNOMINATEUR : ${Object.keys(LUS).length} logos lus · à écrire ${ok.length} · refusés ${plan.length - ok.length} · écartés (photos de booster) 3 : Radiant-Energy-Vol-1, -2, -3`);
    if (plan.some(p => p.refus)) { console.error('❌ un logo de la table est refusé : rien n\'est écrit'); await fermer(); process.exit(1); }
    if (!process.argv.includes('--ecrire')) { console.log('(plan seul — --ecrire sous lot-additif.js)'); await fermer(); return; }
    let ecrits = 0;
    for (const p of ok) {
        const u = await S.updateOne({ _id: p.slug, 'logo.cleR2': p.cle, 'logo.langue': null }, { $set: { 'logo.langue': p.langue, 'logo.langueLue': { le: LE, lu: p.lu } } });
        ecrits += u.modifiedCount;
    }
    const relus = await S.countDocuments({ _id: { $in: ok.map(p => p.slug) }, 'logo.langueLue.le': LE });
    console.log(`${ecrits === ok.length && relus === ok.length ? '✅' : '🔴'} écrits ${ecrits}/${ok.length} · RELU ${relus}`);
    console.log(`SETS : ${ok.map(p => p.slug).join(',')}`);
    if (ecrits !== ok.length) process.exitCode = 1;
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
