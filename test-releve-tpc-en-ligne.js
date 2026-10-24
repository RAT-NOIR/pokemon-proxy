// node test-releve-tpc-en-ligne.js — releve-tpc-en-ligne.js (D5 du 2026-10-24) avec un FAUX transport et une fausse base : aucun réseau, aucune vraie base, cadence nulle.
// TOOL_DIR=<dossier> rejoue le banc contre une copie MUTÉE de l'outil (le rouge se voit en cassant le code).
const fs = require('fs');
const os = require('os');
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const { executer } = require(path.join(DIR, 'releve-tpc-en-ligne.js'));
const T = require(path.join(DIR, 'collecte-cartes', 'tpc.js'));
const { lireCompteur, ecrireCompteur } = require(path.join(DIR, 'collecte-cartes', 'compteur-jour.js'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rat-banc-tpc-'));
const pauses = path.join(tmp, 'pauses'); fs.mkdirSync(pauses);

// ── le compteur du jour (pur) ──
const f0 = path.join(tmp, 'c0.json');
verifier('compteur : fichier absent → 0', lireCompteur(f0, 'pokemon-card-com', '2026-10-24'), 0);
ecrireCompteur(f0, 'pokemon-card-com', 40, '2026-10-24'); ecrireCompteur(f0, 'tpc-asie', 7, '2026-10-24');
verifier('compteur : écrit par source, les autres sont gardées ; relu le même jour', [lireCompteur(f0, 'pokemon-card-com', '2026-10-24'), lireCompteur(f0, 'tpc-asie', '2026-10-24')], [40, 7]);
verifier('compteur : un AUTRE jour → 0 (le plafond est celui de la journée)', lireCompteur(f0, 'pokemon-card-com', '2026-10-25'), 0);
fs.writeFileSync(path.join(tmp, 'c1.json'), 'pas du json');
verifier('compteur : un fichier illisible LÈVE (jamais un repli sur 0)', (() => { try { lireCompteur(path.join(tmp, 'c1.json'), 'x', '2026-10-24'); return 'passe'; } catch (e) { return /illisible/.test(e.message); } })(), true);
fs.writeFileSync(path.join(tmp, 'c2.json'), JSON.stringify({ sites: { x: { jour: '2026-10-24', n: -3 } } }));
verifier('compteur : un compte qui n\'est pas un entier ≥ 0 LÈVE', (() => { try { lireCompteur(path.join(tmp, 'c2.json'), 'x', '2026-10-24'); return 'passe'; } catch (e) { return /illisible/.test(e.message); } })(), true);

// ── le monde ──
const SITE = 'pokemon-card-com', HOTE = T.SITES[SITE].hote;
function monde({ alerte = false, tenu = null, statutListe = 200 } = {}) {
    const appels = [], requetes = [], ordre = [];
    const transport = { async get(url) {
        requetes.push(url.replace(HOTE, ''));
        if (/robots\.txt$/.test(url)) return { status: 404, type: 'text/plain', texte: '' };
        if (/resultAPI\.php/.test(url)) return statutListe === 200
            ? { status: 200, type: 'application/json', texte: JSON.stringify({ hitCnt: 3, maxPage: 1, cardList: [1, 2, 3].map(i => ({ cardID: String(i), cardThumbFile: `t${i}`, cardNameAltText: `Carte ${i}` })) }) }
            : { status: statutListe, type: 'text/html', texte: 'interdit' };
        const m = /card\/(\d+)\//.exec(url);
        return { status: 200, type: 'text/html', texte: `<h1 class="Heading1 x">Nom ${m?.[1]}</h1><div class="subtext x">${m?.[1]} / M-P</div>` };
    } };
    const db = { collection: nom => ({
        findOne: async f => (nom === 'collecte_images_etat' && alerte && f._id === T.idAlerteBloquee(SITE) && f.active === true) ? { _id: f._id, active: true, motif: 'HTTP 403' } : null,
        find: () => ({ toArray: async () => nom === 'tpc_fiches' ? [{ _id: `${SITE}/ja/1`, idFiche: '1', fiche: { nom: 'En cache', numero: '1', denominateur: 'M-P' } }] : [] })
    }) };
    const verrou = { tenu: false, perdu: false, async prendre() { ordre.push('prendre'); if (tenu) return tenu; this.tenu = true; return null; }, async rendre() { ordre.push('rendre'); this.tenu = false; } };
    let ouvertures = 0;
    return { transport, requetes, ordre, ouvertures: () => ouvertures,
        lancer: async (argv, { jour = '2026-10-24' } = {}) => {
            const sorties = [], erreurs = [];
            const code = await executer({ argv, jour, log: s => sorties.push(s), err: s => erreurs.push(s),
                ouvrir: async () => { ouvertures++; return { db, fermer: async () => { } }; }, verrouDe: () => verrou,
                clientDe: o => T.fabriquerClientTpc({ ...o, transport, cadenceMs: 0, reessaiMs: 0, dossierPauses: pauses }) }).catch(e => { erreurs.push(`EXCEPTION ${e.message}`); return 99; });
            return { code, sorties: sorties.join('\n'), erreurs: erreurs.join('\n') };
        } };
}
const ARGS = (compteur, sortie, max) => ['--site=pokemon-card-com', '--langue=ja', '--code=M-P', `--max=${max}`, `--compteur=${compteur}`, `--sortie=${sortie}`];

(async () => {
    // 1. un passage normal : verrou PRIS puis RENDU, 4 requêtes (robots, liste, fiches 2 et 3 ; la 1 est en cache), compteur écrit, sortie écrite
    let w = monde(); const cA = path.join(tmp, 'a.json'), sA = path.join(tmp, 'sa.json');
    let r = await w.lancer(ARGS(cA, sA, 20));
    verifier('passage normal : exit 0, verrou pris PUIS rendu, 4 requêtes (robots, liste, fiches 2 et 3), la fiche 1 vient du cache', [r.code, w.ordre, w.requetes.length, JSON.parse(fs.readFileSync(sA, 'utf8')).fiches.map(f => `${f.idFiche}${f.cache ? 'c' : ''}`)], [0, ['prendre', 'rendre'], 4, ['1c', '2', '3']]);
    verifier('   le compteur du jour a été écrit après chaque requête : 4', lireCompteur(cA, SITE, '2026-10-24'), 4);

    // 2. LE PLAFOND SE CUMULE SUR LA JOURNÉE : 4 déjà faites, --max=6 → 2 requêtes de plus (robots, liste), puis le client REFUSE la 7e
    w = monde(); r = await w.lancer(ARGS(cA, sA, 6));
    verifier('plafond du JOUR : un second lancement avec --max=6 ne fait que 2 requêtes (4 déjà faites), puis s\'arrête sur le plafond (exit 1), verrou rendu', [r.code, w.requetes.length, /plafond de 6/.test(r.sorties), w.ordre.at(-1)], [1, 2, true, 'rendre']);
    verifier('   le compteur du jour est à 6', lireCompteur(cA, SITE, '2026-10-24'), 6);
    w = monde(); r = await w.lancer(ARGS(cA, sA, 6));
    verifier('plafond atteint (6/6) : exit 1, AUCUNE requête, le verrou n\'est même pas pris, la base n\'est pas ouverte', [r.code, w.requetes.length, w.ordre, w.ouvertures()], [1, 0, [], 0]);
    w = monde(); r = await w.lancer(ARGS(cA, sA, 6), { jour: '2026-10-25' });
    verifier('le lendemain le compteur repart de 0 : le même --max=6 repart (robots, liste, fiches)', [r.code, w.requetes.length > 2, lireCompteur(cA, SITE, '2026-10-25') > 0], [0, true, true]);

    // 3. l'alerte « source bloquée » ACTIVE : on SORT sans rien demander, sans prendre le verrou
    w = monde({ alerte: true }); r = await w.lancer(ARGS(path.join(tmp, 'b.json'), path.join(tmp, 'sb.json'), 20));
    verifier('alerte « source bloquée » active → exit 1, AUCUNE requête, le verrou n\'est pas pris', [r.code, /alerte ACTIVE/.test(r.erreurs), w.requetes.length, w.ordre], [1, true, 0, []]);

    // 4. le verrou tenu par un autre : on SORT, sans le rendre (il n'est pas à nous)
    w = monde({ tenu: { pid: 99, hote: 'autre', ageS: 4 } }); r = await w.lancer(ARGS(path.join(tmp, 'c.json'), path.join(tmp, 'sc.json'), 20));
    verifier('verrou tenu par un autre (pid 99) → exit 1, AUCUNE requête, rien rendu', [r.code, /tenu par pid 99/.test(r.erreurs), w.requetes.length, w.ordre], [1, true, 0, ['prendre']]);

    // 5. une source qui BLOQUE (403 sur la liste) : exit 1, le verrou est RENDU quand même
    w = monde({ statutListe: 403 }); r = await w.lancer(ARGS(path.join(tmp, 'd.json'), path.join(tmp, 'sd.json'), 20));
    verifier('la source répond 403 → exit 1, plus aucune requête après, le verrou est RENDU', [r.code, w.requetes.length, w.ordre], [1, 2, ['prendre', 'rendre']]);

    // 6. des arguments
    w = monde(); fs.writeFileSync(path.join(tmp, 'e.json'), 'illisible');
    r = await w.lancer(ARGS(path.join(tmp, 'e.json'), path.join(tmp, 'se.json'), 20));
    verifier('un compteur du jour illisible → exit 2, la base n\'est pas ouverte, aucune requête', [r.code, /illisible/.test(r.erreurs), w.ouvertures(), w.requetes.length], [2, true, 0, 0]);
    r = await w.lancer(['--site=pokemon-card-com', '--langue=ja', '--code=M-P', '--max=5', `--sortie=${path.join(tmp, 'sf.json')}`]);
    verifier('sans --compteur → exit 2 (le plafond du jour exige son compteur)', [r.code, w.ouvertures()], [2, 0]);
    r = await w.lancer([...ARGS(cA, sA, 5), '--force']);
    verifier('un argument inconnu → exit 2', [r.code, /argument inconnu/.test(r.erreurs)], [2, true]);

    console.log(`\n${ok} passés, ${ko} en échec`);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ ERREUR DU BANC', e); process.exit(1); });
