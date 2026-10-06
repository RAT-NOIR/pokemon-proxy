// ============================================================
// LES IMPORTS QUOTIDIENS, LANCÉS PAR LE WORKER — catalogue Cardmarket et guide des prix, une fois par jour après 5 h UTC
// ============================================================
// 🔑 LA DEMANDE (testeur, 2026-10-06) : « sans cron Render payant : le WORKER lance lui-même, une fois par jour vers 5 h UTC, l'import du
// catalogue (import-catalogue-quotidien.js --base=test --confirmer-production) et celui du guide des prix, sous la garde de lot, avec une
// ligne au journal et une alerte en cas d'échec ».
// CE QUE CE MODULE FAIT, ET RIEN D'AUTRE : il LANCE les deux scripts tels qu'on les lance à la main (mêmes commandes, un processus enfant
// chacun) — c'est en eux que vivent les gardes de l'import (jugement du fichier avant toute écriture, sauvegarde relue sur R2, insertion
// additive, méta écrite en dernier, « rien de neuf » = sortie 0). Il ne réécrit aucune de ces gardes : une seule définition (§21 bis).
// · QUAND : à chaque tour de la boucle du worker, ENTRE deux unités (aucune image en cours de traitement : le worker tient sur 512 Mo,
//   et un import en tient lui-même plusieurs dizaines) ; après 5 h UTC ; une réussite par jour ; trois essais par jour au plus, une heure
//   entre deux — une panne longue reste une panne visible, pas une boucle (§29).
// · L'ESSAI SE COMPTE AVANT LE LANCEMENT : un worker tué au milieu d'un import (redéploiement) ne relance pas en boucle un import qui le
//   tue — il a consommé un essai.
// · LE JOURNAL : `collecte_images_etat`, document `import-quotidien/<nom>` (jour, essais, dernier code, fin de la sortie, 30 dernières
//   lignes) — la base du worker, celle que file-a-l-arret.js lit.
// · L'ALERTE : `alerte/import-<nom>`, ACTIVE dès un échec ; sa date `depuis` est celle de la PREMIÈRE panne (posée à chaque transition
//   vers l'état actif, jamais seulement à la création — §65), levée (`resolueLe`) à la première réussite.
// · LE PROCESSUS ENFANT est ASYNCHRONE : un `spawnSync` bloquerait la boucle d'événements, donc la minuterie de la balise du worker, et
//   la garde du commit lirait un worker mort (§52) pendant toute la durée de l'import.
const path = require('path');
const { spawn } = require('child_process');

const IMPORTS = [
    { nom: 'catalogue', script: 'import-catalogue-quotidien.js' },
    { nom: 'guide', script: 'import-guide-quotidien.js' }
];
const ARGS = ['--base=test', '--confirmer-production'];
const HEURE_UTC = 5, ESSAIS_PAR_JOUR = 3, PASSAGES_PAR_JOUR = 12, ENTRE_ESSAIS_MS = 60 * 60 * 1000, ENTRE_RIEN_DE_NEUF_MS = 2 * 60 * 60 * 1000;
const DELAI_MAX_MS = 30 * 60 * 1000, JOURNAL_MAX = 30;
const RACINE = path.join(__dirname, '..');
const jourUTC = d => d.toISOString().slice(0, 10);
// (relecture) « rien de neuf » n'est PAS la réussite du jour : le fichier Cardmarket du jour paraît vers 11 h 30 UTC (createdAt de
// l'export du 2026-10-06 : 13:31 +02:00) ; à 5 h, les deux scripts sortent 0 en disant « rien de neuf ». Le jour ne se clôt qu'à un
// import FAIT ; un « rien de neuf » fait repasser deux heures plus tard, sans compter d'échec — douze passages au plus par jour.
const RIEN_DE_NEUF = /ℹ️ rien de neuf/;
// (relecture) LA MÉMOIRE : le worker reste vivant pendant l'import, sur 512 Mo. Le tas de l'enfant est plafonné : au-delà, il échoue
// PROPREMENT (code non nul, alerte écrite) au lieu de faire tuer le conteneur entier par le système. Valeur mesurée : voir MESURE_MEMOIRE.
const NOEUD = ['--max-old-space-size=256'];
// 🔴 ÉTEINT PAR DÉFAUT (2026-10-07). MESURÉ en local (test_scratch, vrais exports) : l'import du catalogue seul monte à 190 Mo de RSS
// (61 Mo de tas) avec le fichier analysé et le diff, insertion NON comprise (la grappe bridée n'a inséré que quelques centaines de
// documents en dix minutes : le chemin complet n'a pas pu être mesuré). La mémoire du worker lui-même, sur Render, ne se lit pas d'ici :
// à deux processus sur 512 Mo, un conteneur tué par le système n'écrirait même pas son alerte. Le testeur l'active par UNE variable
// d'environnement du worker, après avoir regardé la mémoire du worker dans le tableau de bord : `IMPORTS_QUOTIDIENS=1`, et rien d'autre.
const actif = (env = process.env) => env.IMPORTS_QUOTIDIENS === '1';

/** Faut-il lancer cet import maintenant ? Fonction pure : `etat` est le document `import-quotidien/<nom>` (ou null). */
function aLancer(etat, maintenant) {
    if (maintenant.getUTCHours() < HEURE_UTC) return { lancer: false, raison: `avant ${HEURE_UTC} h UTC` };
    const j = jourUTC(maintenant), memeJour = etat?.jour === j;
    if (etat?.succesLe === j) return { lancer: false, raison: 'déjà importé aujourd\'hui' };
    const essais = memeJour ? (etat.essais || 0) : 0, echecs = memeJour ? (etat.echecs ?? etat.essais ?? 0) : 0;
    if (echecs >= ESSAIS_PAR_JOUR) return { lancer: false, raison: `${echecs} échecs aujourd'hui : demain` };
    if (essais >= PASSAGES_PAR_JOUR) return { lancer: false, raison: `${essais} passages aujourd'hui : demain` };
    const attente = etat?.dernierResultat === 'rien-de-neuf' ? ENTRE_RIEN_DE_NEUF_MS : ENTRE_ESSAIS_MS;
    if (memeJour && etat.dernierEssai && maintenant - new Date(etat.dernierEssai) < attente) return { lancer: false, raison: `dernier passage il y a moins de ${attente / 3600000} h` };
    return { lancer: true, essai: essais + 1, echecs };
}

/** Un import doit-il tourner MAINTENANT ? (le worker ne rend son verrou global que dans ce cas) */
async function aFaire({ E, maintenant = () => new Date() }) {
    for (const { nom } of IMPORTS) if (aLancer(await E.findOne({ _id: `import-quotidien/${nom}` }), maintenant()).lancer) return true;
    return false;
}

/** Lance `node <script> <args>` dans la racine du dépôt, sans bloquer : { code, dureeS, extrait } (la fin de stdout+stderr). */
function lancerEnfant(script, args = ARGS, { racine = RACINE, delaiMs = DELAI_MAX_MS, noeud = NOEUD } = {}) {
    return new Promise(resolve => {
        const t0 = Date.now();
        let sortie = '', delaiDepasse = false;
        const garder = b => { sortie = (sortie + b.toString('utf8')).slice(-6000); };
        // (relecture) un GROUPE de processus sous Linux : l'import du guide lance lui-même import-price-guide.js ; tuer le seul script au
        // délai laissait ce petit-fils écrire les prix, et l'essai suivant en aurait lancé un second
        const groupe = process.platform !== 'win32';
        // (relecture) le plafond passe AUSSI par NODE_OPTIONS : import-guide-quotidien.js relance import-price-guide.js (spawnSync), et
        // les options de la ligne de commande ne se transmettent pas à un petit-fils — l'environnement, si
        const env = { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, ...noeud].filter(Boolean).join(' ') };
        const p = spawn(process.execPath, [...noeud, path.join(racine, script), ...args], { cwd: racine, env, stdio: ['ignore', 'pipe', 'pipe'], detached: groupe });
        p.stdout.on('data', garder); p.stderr.on('data', garder);
        const tuer = () => { try { if (groupe) process.kill(-p.pid, 'SIGKILL'); else p.kill('SIGKILL'); } catch { p.kill('SIGKILL'); } };
        const minuterie = setTimeout(() => { delaiDepasse = true; tuer(); }, delaiMs);
        const fin = code => { clearTimeout(minuterie); resolve({ code: delaiDepasse ? -1 : code, dureeS: Math.round((Date.now() - t0) / 1000), extrait: (delaiDepasse ? `🔴 délai de ${Math.round(delaiMs / 1000)} s dépassé : processus tué\n` : '') + sortie.slice(-2000) }); };
        p.on('error', e => { garder(Buffer.from(`🔴 ${e.message}`)); fin(-2); });
        p.on('close', fin);
    });
}

/**
 * Un passage : pour chaque import qui doit tourner, l'essai compté, le script lancé, le journal et l'alerte écrits. Ne lève pas : un
 * import en échec ne doit pas arrêter le worker (il crie dans l'alerte). @param E la collection `collecte_images_etat`.
 */
async function importsQuotidiens({ E, lancerScript = lancerEnfant, maintenant = () => new Date(), journal = console }) {
    for (const { nom, script } of IMPORTS) {
        const id = `import-quotidien/${nom}`, idAlerte = `alerte/import-${nom}`;
        const etat = await E.findOne({ _id: id });
        const now = maintenant(), d = aLancer(etat, now);
        if (!d.lancer) continue;
        const j = jourUTC(now);
        // l'essai ET un échec PROVISOIRE sont comptés AVANT le lancement : un conteneur tué au milieu (redéploiement, mémoire) a
        // consommé un essai d'échec, il ne relance pas en boucle l'import qui le tue
        await E.updateOne({ _id: id }, { $set: { jour: j, essais: d.essai, echecs: d.echecs + 1, dernierEssai: now, enCours: true, commande: `node ${script} ${ARGS.join(' ')}` } }, { upsert: true });
        journal.log(`📥 import quotidien « ${nom} » : passage ${d.essai} du ${j} (échecs ${d.echecs}/${ESSAIS_PAR_JOUR}) — node ${script} ${ARGS.join(' ')}`);
        let r;
        try { r = await lancerScript(script, ARGS); }
        catch (e) { r = { code: -3, dureeS: 0, extrait: `🔴 lancement impossible : ${e.message}` }; }
        const resultat = r.code !== 0 ? 'echec' : RIEN_DE_NEUF.test(String(r.extrait || '')) ? 'rien-de-neuf' : 'importe';
        await E.updateOne({ _id: id }, {
            $set: { enCours: false, dernierCode: r.code, dernierResultat: resultat, dernierExtrait: r.extrait, dureeS: r.dureeS, echecs: resultat === 'echec' ? d.echecs + 1 : d.echecs, ...(resultat === 'importe' ? { succesLe: j } : {}) },
            $push: { journal: { $each: [{ le: now, essai: d.essai, resultat, code: r.code, dureeS: r.dureeS, extrait: String(r.extrait || '').slice(-400) }], $slice: -JOURNAL_MAX } }
        });
        if (resultat !== 'echec') {
            await E.updateOne({ _id: idAlerte, active: true }, { $set: { active: false, resolueLe: now } });
            journal.log(`${resultat === 'importe' ? '✅' : 'ℹ️'} import quotidien « ${nom} » : ${resultat === 'importe' ? 'importé' : 'rien de neuf, nouveau passage dans 2 h'} (code 0, ${r.dureeS} s)`);
        } else {
            await E.updateOne({ _id: idAlerte, active: { $ne: true } }, { $set: { depuis: now } });
            await E.updateOne({ _id: idAlerte }, { $set: { active: true, constateLe: now, essais: d.echecs + 1, code: r.code, extrait: String(r.extrait || '').slice(-1000), commande: `node ${script} ${ARGS.join(' ')}` }, $setOnInsert: { depuis: now } }, { upsert: true });
            journal.error(`🔴 import quotidien « ${nom} » : code ${r.code} en ${r.dureeS} s (échec ${d.echecs + 1}/${ESSAIS_PAR_JOUR}) — alerte ${idAlerte}`);
        }
    }
}

module.exports = { actif, IMPORTS, ARGS, NOEUD, HEURE_UTC, ESSAIS_PAR_JOUR, aLancer, aFaire, lancerEnfant, importsQuotidiens, jourUTC };
