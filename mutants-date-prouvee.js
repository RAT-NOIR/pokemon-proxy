'use strict';
// MUTANTS de collecte-cartes/date-prouvee.js — chaque garde est CASSÉE à tour de rôle ; test-date-prouvee.js doit alors ÉCHOUER. Fichier toujours restauré (try/finally + copie .avant-mutants).
//   node mutants-date-prouvee.js      (un seul processus, séquentiel)
const fs = require('fs'), path = require('path');
const F = path.join(__dirname, 'collecte-cartes', 'date-prouvee.js');
const TEST = path.join(__dirname, 'test-date-prouvee.js');
const MUTANTS = [
    ['un set déjà daté est écrasé', "['dateSortie', 'dateSortieEn', 'dateSortieJa', 'dateSortieMois'].some(k => present(set[k]))", "false"],
    ['une seule source suffit', "sources.length >= 2 ||", "sources.length >= 1 ||"],
    ['la divergence n\'arrête plus', "|| toutes.some(s => present(s.valeur) && s.valeur !== d.valeur)) return R('divergence')", "|| false) return R('divergence')"],
    ['`contre` n\'arrête plus', "(Array.isArray(d.contre) && d.contre.length)", "false"],
    ['un rang inconnu compte', "!VOIX.has(s.rang) || ", ""],
    ['la même source compte deux fois', "if (!vues.has(s.site)) vues.set(s.site, s);", "vues.set(s.site + Math.random(), s);"],
    ['le mois écrit un jour', "dateSortieMois: { iso: d.valeur, texte: texteDeIso(d.valeur),", "[champ]: texteDeIso(d.valeur), dateSortieMois: { iso: d.valeur, texte: texteDeIso(d.valeur),"],
    ['la région intl écrit dans Ja', "intl: 'dateSortieEn'", "intl: 'dateSortieJa'"],
    ['l\'hôte n\'est plus refusé', "if (sources.some(s => RE_HOTE.test(s.code) || RE_HOTE.test(s.phrase))) return R('adresse-dans-la-phrase');", ""],
    ['l\'adresse entre dans la preuve', "code: s.code, rang: s.rang, phrase: s.phrase.trim() }", "code: s.code, rang: s.rang, phrase: s.phrase.trim(), adresse: s.adresse }"],
    ['base a une voix', "const VOIX = new Set(['officielle', 'boutique', 'wiki']);", "const VOIX = new Set(['officielle', 'boutique', 'wiki', 'base']);"],
    ['un code qui nomme un site passe', "RE_CODE_NEUTRE = /^S\\d+$/", "RE_CODE_NEUTRE = /^.*$/"],
    ['une phrase peut nommer une autre date', "const autre = datesDansTexte(s.phrase).find(x => !x.split('|').some(i => permises.has(i))); if (autre) return", "const autre = null; if (autre) return"],
    ['une lecture ambiguë suffit à refuser (some → every)', "!x.split('|').some(i => permises.has(i))", "!x.split('|').every(i => permises.has(i))"],
    ['les dates FR ne sont pas lues', "(?:of\\\\s+)?(${noms})", "(?:of\\\\s+)?(zzzz)"],
    ['le tirage vivant n\'est plus comparé', "(v.tirage ?? null) !== (d.tirage ?? null)", "false"],
    ['la région vivante n\'est plus comparée', "if (v.region !== d.region ||", "if (false ||"],
    ['le plan perd la région', "region: vivant.region, tirage", "region: null, tirage"],
    ['D1 : mois abrégés dec/dez non lus', "nov: 11, dec: 12, dez: 12 };", "nov: 11 };"],
    ['D1 : « sept » non lu', "sep: 9, sept: 9,", "sep: 9,"],
    ['D1 : « janv » non lu', "jan: 1, janv: 1,", "jan: 1,"],
    ['D1 : numérique d/m/y non lu', "/\\b(\\d{1,2})[/.](\\d{1,2})[/.](\\d{4})\\b/g", "/\\b(\\d{1,2})Z(\\d{1,2})Z(\\d{4})\\b/g"],
    ['D1 : numérique y/m/d non lu', "/\\b(\\d{4})[/.](\\d{1,2})[/.](\\d{1,2})\\b/g", "/\\b(\\d{4})Z(\\d{1,2})Z(\\d{1,2})\\b/g"],
    ['D1 : CJK non lu', "\\s*年\\s*", "\\s*Q\\s*"],
    ['D1 : « 4th of December » non lu', "(?:of\\\\s+)?", "(?:Q\\\\s+)?"],
    ['D1 : le point après un mois abrégé gêne', "(${noms})\\\\b\\\\.?\\\\s*,?\\\\s*(\\\\d{4})", "(${noms})\\\\b\\\\s*,?\\\\s*(\\\\d{4})"],
    ['D3 : deux codes du même site comptent deux fois', "if (!vues.has(s.site)) vues.set(s.site, s);", "vues.set(s.code, s);"],
    ['site absent : une source sans site vote (repli sur le code)', "if (typeof s.site !== 'string' || !s.site) { sansSite++; continue; }", "if (typeof s.site !== 'string' || !s.site) { vues.set(s.code, s); continue; }"],
    ['site absent : le refus ne le dit plus', "R(sansSite ? 'site-absent' : ", "R("],
    ['D2 : la note n\'est plus gardée contre un hôte', "if (RE_HOTE.test(n.phrase) || RE_HOTE.test(n.note)) return R('adresse-dans-la-phrase', 'note');", ""],
    ['D2 : la note n\'a plus à porter un code neutre', "if (!n || typeof n.code !== 'string' || !RE_CODE_NEUTRE.test(n.code)) return R('code-non-neutre', 'note');", ""],
    ['D2 : les notes ne sont pas écrites', "...notes.map(n => ({ code: n.code, rang: n.rang, phrase: n.phrase.trim(), note: n.note.trim() }))", ""],
    ['filtre : la région n\'y est plus', "region: plan.region, tirage", "tirage"],
    ['filtre : le tirage n\'y est plus', "tirage: plan.tirage ?? null, dateSortie: null", "dateSortie: null"],
    ['filtre : dateSortieJa n\'est plus nul', "dateSortieEn: null, dateSortieJa: null,", "dateSortieEn: null,"],
    ['filtre : la période n\'est plus gardée', "f.periodeDistribution = { $exists: false };", "f.periodeDistribution = { $exists: true };"],
    ['filtre : champ absent du document accepté', "|| !(champ in set)) throw", "|| false) throw"],
    ['la période sans fin est posée', "if (d.precision === 'periode' && !isoValide(d.fin)) return R('periode-non-etablie', 'fin : ' + d.fin);", ""],
    ['un jour impossible passe', "if (d.getUTCFullYear() !== a || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== j) return null;", ""]
];
let tues = 0; const vivants = [];
const SAUVEGARDE = `${F}.avant-mutants`, ORIGINAL = fs.readFileSync(F, 'utf8');
if (fs.existsSync(SAUVEGARDE)) { console.error(`❌ ${SAUVEGARDE} existe : restaurer à la main. Rien n'a été muté.`); process.exit(2); }
fs.writeFileSync(SAUVEGARDE, ORIGINAL);
try {
    for (const [nom, de, vers] of MUTANTS) {
        if (!ORIGINAL.includes(de)) { console.log(`  ⚠️ ${nom} : motif introuvable`); vivants.push(`${nom} (motif introuvable)`); continue; }
        try {
            fs.writeFileSync(F, ORIGINAL.replace(de, vers));
            // un seul processus : le banc est rejoué par require après purge du cache (module muté + banc), sa sortie est tue
            for (const k of Object.keys(require.cache)) if (k === F || k === TEST) delete require.cache[k];
            const log = console.log, err = console.error; console.log = () => {}; console.error = () => {};
            process.exitCode = 0;
            let echec = false;
            try { require(TEST); echec = process.exitCode === 1; } catch (e) { echec = true; } finally { console.log = log; console.error = err; process.exitCode = 0; }
            if (echec) { tues++; console.log(`  ✅ tué : ${nom}`); } else { vivants.push(nom); console.log(`  ❌ VIVANT : ${nom}`); }
        } finally { fs.writeFileSync(F, ORIGINAL); }
    }
} finally { fs.writeFileSync(F, ORIGINAL); fs.unlinkSync(SAUVEGARDE); }
console.log(`\n${tues} mutants tués sur ${MUTANTS.length}${vivants.length ? ` · vivants : ${vivants.join(' | ')}` : ''}`);
process.exitCode = vivants.length ? 1 : 0;
