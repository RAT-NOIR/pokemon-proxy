// ============================================================
// UN LOT D'ÉCRITURES ADDITIVES : sauvegarde AVANT, commande, comptes avant/après, une ligne de journal (2026-09-24)
// ============================================================
//   node lot-additif.js --quoi="<ce que fait le lot>" --collections=a,b [--compte=coll[:champ=valeur]]… -- <commande…>
//   ex. node lot-additif.js --quoi="remise en file CRE, LOR" --collections=file_images --compte=file_images:etat=attente -- node remettre-en-file.js --ecrire
//
// 🔑 LA RÈGLE DU TESTEUR (2026-09-24) : les écritures ADDITIVES — images nouvelles, fiches nouvelles passées au contrôle
// du nom, remises en file — ont un feu vert PERMANENT, à deux conditions : une sauvegarde automatique avant chaque lot,
// et une ligne de journal par lot (quoi, combien, fichier de sauvegarde). Ce qui MODIFIE ou SUPPRIME une donnée
// existante (noms, fusions, détachements) attend toujours son feu vert : cet outil ne le décide pas, il ne fait que
// garantir les deux conditions. Le caractère additif se juge AVANT de le lancer.
//
// La ligne de commande s'écrit par ce qu'elle AUTORISE (§54) : un argument inconnu refuse avant toute connexion.
// La sauvegarde est `backup-collections.js --base=cartes` (la seule base que la collecte écrit) : si elle échoue, la
// commande ne part PAS. Les comptes sont imprimés avec leur filtre — un compte sans son filtre n'est pas un dénominateur.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const JOURNAL = path.join(__dirname, 'JOURNAL-LOTS.md');
const sep = process.argv.indexOf('--');
const options = sep < 0 ? process.argv.slice(2) : process.argv.slice(2, sep);
const commande = sep < 0 ? [] : process.argv.slice(sep + 1);
const AUTORISES = [/^--quoi=.+/, /^--collections=[\w,]+$/, /^--compte=\w+(:\w+=[^\s]+)?$/];
const inconnus = options.filter(a => !AUTORISES.some(r => r.test(a)));
const val = nom => options.find(a => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);
const quoi = val('quoi'), collections = val('collections');
// 🔴 « idExpansion=6395 » a compté 0 → 0 au premier lot (2026-09-24) : la valeur partait en CHAÎNE, le champ est un
// NOMBRE. Un filtre qui ne mord sur rien rend un zéro plausible (§41). Une valeur numérique cherche donc les deux types,
// et chaque compte s'imprime sur le total de sa collection : « 0 sur 64 000 » se voit, « 0 » non.
const comptes = options.filter(a => a.startsWith('--compte=')).map(a => {
    const [coll, filtre] = a.slice(9).split(':');
    const [champ, valeur] = filtre ? filtre.split('=') : [];
    const v = /^-?\d+$/.test(valeur ?? '') ? { $in: [Number(valeur), valeur] } : valeur;
    return { coll, filtre: champ ? { [champ]: v } : {}, libelle: a.slice(9) };
});
if (inconnus.length || !quoi || !collections || !commande.length) {
    console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}usage : --quoi="…" --collections=a,b [--compte=coll[:champ=valeur]]… -- <commande…>`);
    process.exit(2);
}

async function compter() {
    if (!comptes.length) return [];
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const r = [];
    for (const c of comptes) {
        const n = await cx.db.collection(c.coll).countDocuments(c.filtre), total = await cx.db.collection(c.coll).countDocuments({});
        if (!total) throw new Error(`collection « ${c.coll} » VIDE ou mal nommée : un compte sur elle ne mesure rien`);
        r.push(`${n}/${total}`);
    }
    await fermer();
    return r;
}

(async () => {
    const t = new Date().toISOString();
    const dossier = `backup-${t.slice(0, 10)}-lot-${t.slice(11, 19).replace(/:/g, '')}`;
    console.log(`\n══ LOT ADDITIF : ${quoi}\n   1. sauvegarde ${collections} → ${dossier}`);
    const s = spawnSync(process.execPath, ['backup-collections.js', '--base=cartes', `--collections=${collections}`, `--dossier=${dossier}`], { stdio: 'inherit', cwd: __dirname });
    if (s.status !== 0) { console.error(`❌ la sauvegarde a échoué (code ${s.status}) : la commande ne part pas.`); process.exit(1); }
    const avant = await compter();
    console.log(`   2. comptes avant : ${comptes.map((c, i) => `${c.libelle} = ${avant[i]}`).join(' · ') || '(aucun)'}\n   3. ${commande.join(' ')}`);
    const [exe, ...args] = commande;
    const c = spawnSync(exe === 'node' ? process.execPath : exe, args, { stdio: 'inherit', cwd: __dirname });
    const apres = await compter();
    const combien = comptes.map((x, i) => `${x.libelle} ${avant[i]} → ${apres[i]}`).join(' ; ') || '—';
    console.log(`   4. comptes après : ${combien} · code de sortie ${c.status}`);
    if (!fs.existsSync(JOURNAL)) fs.writeFileSync(JOURNAL, '# Journal des lots additifs\n\nUne ligne par lot : `lot-additif.js` sauvegarde, lance, compte, écrit ici.\n\n| date (UTC) | quoi | commande | combien (avant → après) | sauvegarde | sortie |\n|---|---|---|---|---|---|\n', 'utf8');
    const cellule = x => String(x).replace(/\|/g, '\\|');
    fs.appendFileSync(JOURNAL, `| ${t.slice(0, 19).replace('T', ' ')} | ${cellule(quoi)} | \`${cellule(commande.join(' '))}\` | ${cellule(combien)} | ${dossier} | ${c.status} |\n`, 'utf8');
    console.log(`   5. journal : ${path.basename(JOURNAL)}`);
    process.exit(c.status ?? 1);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
