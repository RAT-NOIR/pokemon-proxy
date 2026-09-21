// ============================================================
// LE BANC DE LA GARDE DU COMMIT — « SAIT-ELLE REFUSER ? »
// ============================================================
//   node test-garde-worker.js
//
// 🔴 POURQUOI CE BANC EXISTE : cette garde a échoué VERS LE PASSANT trois fois en trois jours, sur
// trois causes indépendantes — une collection mal nommée, une règle surveillée au mauvais endroit,
// un verrou mort qui masquait le vivant. **Trois causes différentes, une seule direction.** Ce n'est
// pas une série de bogues, c'est la forme de la garde : elle énumérait ce qui BLOQUE, donc tout ce
// qu'elle n'avait pas prévu passait.
//
// 🔑 LA RÈGLE QUI EN SORT, ET ELLE VAUT POUR TOUTE GARDE NEUVE : le test n'est pas « refuse-t-elle
// quand il faut ? » mais « SAIT-ELLE refuser ? ». Un contrôle qu'on n'a jamais VU dire non n'a pas
// été vérifié, il a été supposé. Ce banc le lui fait dire huit fois, sur huit états fabriqués, et
// une seule fois oui.
//
// Aucune base n'est ouverte : la garde reçoit une fausse connexion. C'est ce qui permet de fabriquer
// les états qu'on ne saurait pas provoquer en vrai (deux pods sur deux commits, une balise sans
// commit, une collection vide).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { etatDuWorker, COLLECTION_VERROUS } = require('./remettre-en-file');
const { PREFIXE } = require('./collecte-cartes/balise-worker');

function git() {
    const base = path.join(process.env.LOCALAPPDATA || '', 'GitHubDesktop');
    const app = fs.readdirSync(base).filter(d => d.startsWith('app-')).sort().pop();
    return path.join(base, app, 'resources', 'app', 'git', 'cmd', 'git.exe');
}
const HEAD = execFileSync(git(), ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

const ilYA = min => new Date(Date.now() - min * 60 * 1000);

/** Une fausse connexion : `docs` est ce que la collection contient. */
function fausseCx(docs, { collectionVide = false } = {}) {
    const col = {
        collectionName: COLLECTION_VERROUS,
        find: (filtre = {}) => ({
            toArray: async () => {
                if (collectionVide) return [];
                const re = filtre._id instanceof RegExp ? filtre._id : null;
                return re ? docs.filter(d => re.test(d._id)) : docs;
            }
        }),
        countDocuments: async () => (collectionVide ? 0 : docs.length)
    };
    return { db: { collection: () => col } };
}

const cas = [];
const ajouter = (nom, cx, attenduBloque) => cas.push({ nom, cx, attenduBloque });

// ── LES SEPT ÉTATS QUI DOIVENT BLOQUER ───────────────────────────────────────────────────────────
ajouter('1. la collection est VIDE (ou mal nommée : c\'est le même symptôme)',
    fausseCx([], { collectionVide: true }), true);

ajouter('2. aucune balise du tout — « je ne sais pas », pas « tout va bien »',
    fausseCx([{ _id: 'artofpkm/Base-Set', phase: 'verifie' }]), true);

ajouter('3. une seule balise, PÉRIMÉE (le mort qui masquait le vivant, 2026-09-21)',
    fausseCx([{ _id: `${PREFIXE}DESKTOP/102820`, balise: { pid: 102820, hote: 'DESKTOP', commit: HEAD, etat: 'repos', depuis: ilYA(48) } }]), true);

ajouter('4. DEUX balises fraîches sur deux commits — chevauchement de rollout (§17)',
    fausseCx([
        { _id: `${PREFIXE}pod-a/52`, balise: { pid: 52, hote: 'pod-a', commit: HEAD, etat: 'travail', depuis: ilYA(0.2) } },
        { _id: `${PREFIXE}pod-b/53`, balise: { pid: 53, hote: 'pod-b', commit: '0000000000000000000000000000000000000000', etat: 'travail', depuis: ilYA(0.2) } }
    ]), true);

ajouter('5. une balise SANS commit — l\'absence du champ EST l\'information (§23)',
    fausseCx([{ _id: `${PREFIXE}pod-a/52`, balise: { pid: 52, hote: 'pod-a', etat: 'travail', depuis: ilYA(0.2) } }]), true);

ajouter('6. une balise dont le commit vaut « local » — un arbre de travail n\'est pas un commit',
    fausseCx([{ _id: `${PREFIXE}DESKTOP/9`, balise: { pid: 9, hote: 'DESKTOP', commit: 'local', etat: 'travail', depuis: ilYA(0.2) } }]), true);

ajouter('7. un commit INCONNU de ce dépôt — on ne peut pas dire ce qu\'il contient',
    fausseCx([{ _id: `${PREFIXE}pod-a/52`, balise: { pid: 52, hote: 'pod-a', commit: '0123456789abcdef0123456789abcdef01234567', etat: 'travail', depuis: ilYA(0.2) } }]), true);

// ── LE SEUL ÉTAT QUI DOIT PASSER ─────────────────────────────────────────────────────────────────
ajouter('8. une balise fraîche, unique, sur HEAD — qui contient les trois règles',
    fausseCx([{ _id: `${PREFIXE}pod-a/52`, balise: { pid: 52, hote: 'pod-a', commit: HEAD, etat: 'repos', depuis: ilYA(0.2) } }]), false);

(async () => {
    console.log(`\n════ LA GARDE SAIT-ELLE REFUSER ? ${cas.length} états fabriqués · HEAD = ${HEAD.slice(0, 12)} ════\n`);
    let ok = 0, ko = 0;
    for (const c of cas) {
        let r;
        try { r = await etatDuWorker(c.cx); }
        catch (e) { r = { bloque: null, phrase: `EXCEPTION NON RATTRAPÉE : ${e.message}` }; }
        const juste = r.bloque === c.attenduBloque;
        if (juste) ok++; else ko++;
        console.log(`   ${juste ? '✅' : '❌'} ${c.nom}`);
        console.log(`        attendu ${c.attenduBloque ? 'BLOQUE' : 'passe'} · obtenu ${r.bloque === null ? 'EXCEPTION' : r.bloque ? 'BLOQUE' : 'passe'}`);
        console.log(`        ${String(r.phrase).split('\n')[0].trim()}`);
    }
    console.log(`\n════ ${ok} passés · ${ko} en échec ════`);
    if (ko) {
        console.error(`\n🔴 UNE GARDE QUI NE SAIT PAS REFUSER N'EST PAS UNE GARDE. Elle a échoué vers le passant`);
        console.error(`   trois fois en trois jours ; ce banc existe pour que ça ne recommence pas en silence.`);
        process.exit(1);
    }
    console.log(`   🔑 Un seul chemin mène à « passe » : une balise fraîche, UNE seule, dont le commit contient les trois règles.`);
})();
