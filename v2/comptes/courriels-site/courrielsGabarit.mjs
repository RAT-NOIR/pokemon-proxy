/**
 * LE GABARIT DES COURRIELS — « de type MJML », écrit à la main, sans dépendance (lot L6, 2026-10-18).
 *
 * Module PUR : aucun import de Next ni de paquet. Il transforme un `Contenu` (un titre, des blocs) en deux rendus qui disent la même chose,
 * le texte brut et le HTML. Le HTML est écrit pour les moteurs les plus rudes des messageries :
 *  - Outlook de bureau lit le HTML avec Word : il ne connaît ni les marges fiables, ni `max-width`, ni les coins arrondis. D'où des tables
 *    imbriquées (`role="presentation"`, tout à 0), une largeur fixe de 600 dans un ENVELOPPE CONDITIONNEL (`<!--[if mso]>…<![endif]-->`) et
 *    `max-width:600px` ailleurs, des tailles en px, un `line-height` en px avec `mso-line-height-rule:exactly`, et un bouton qui existe DEUX
 *    fois (un rectangle VML pour Outlook, une cellule colorée portant un lien pour tous les autres) ;
 *  - Gmail réécrit ou retire une partie du `<style>` : tout le style utile est EN LIGNE, le `<style>` n'ajoute que le mode sombre et le
 *    téléphone (chaque règle y est `!important` : elle surcharge le style en ligne) ;
 *  - Apple Mail (WebKit) accepte presque tout, mais devine des liens (dates, adresses) : `format-detection` les coupe ;
 *  - le fond est posé en attribut (`bgcolor`) ET en style ; le mode sombre est annoncé par `color-scheme` et `supported-color-schemes`,
 *    et suivi par `prefers-color-scheme` (Apple Mail, Outlook.com) ou `[data-ogsc]` / `[data-ogsb]` (Outlook.com, Outlook mobile).
 * Aucune image indispensable : le logo a un `alt` vide (le nom est écrit à côté), des dimensions écrites et une URL absolue.
 * `lib/verifierGabaritCourriel.ts` tient ces règles pour CHAQUE courriel (lib/courrielsGabarit.test.ts) ; ce qu'aucun test d'ici ne dit,
 * c'est le rendu dans un VRAI client de messagerie : l'essai d'envoi viendra avec le service d'envoi (LANCEMENT-COMPTES.md).
 */
import { SITE } from "./site.mjs";

// ── La typographie ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const INSECABLE = String.fromCharCode(0xa0);

/**
 * Les espaces insécables du français : devant « : ; ! ? » et « % € », après « «, entre un nombre et son unité ou son mois. Appliquée à
 * chaque TEXTE (jamais à du balisage ni à une feuille de style : « 0 auto » doit rester une espace).
 */
export function typo(texte        )         {
  return texte
    .replace(/ (?=[:;!?»%€])/g, INSECABLE)
    .replace(/« /g, `«${INSECABLE}`)
    .replace(/(\d|\b1er) (?=[A-Za-zÀ-ÿ€])/g, `$1${INSECABLE}`)
    .replace(/(\d) (?=\d)/g, `$1${INSECABLE}`);
}

export function echapper(texte        )         {
  return texte.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ── Les blocs : une seule source pour le texte brut et pour le HTML ───────────────────────────────────────────────────────────

                  
                             
                                   
                                                
                                      
                                                  
                                 

                          
                
                                                                   
                 
                
                
                  
                                                                                                             
                           
 

export const COULEURS = {
  noir: "#090909",
  or: "#d4af37",
  orClair: "#e4be46",
  orSurBlanc: "#7a5f00",
  fondClair: "#f4f4f5",
  carteClair: "#ffffff",
  texteClair: "#18181b",
  doucClair: "#52525b",
  traitClair: "#e4e4e7",
  fondSombre: "#090909",
  carteSombre: "#141414",
  texteSombre: "#f4f4f5",
  doucSombre: "#a1a1aa",
  traitSombre: "#2e2e33",
}         ;

/** La police système : aucune police distante (un client qui ne la charge pas retombe sur la suivante). */
export const POLICE = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function pied(c         )           {
  return [
    typo(
      c.compteSupprime === true
        ? `Vous recevez ce message parce qu’un compte Rat-Market était associé à l’adresse ${c.adresse}. C’est un message de service, pas une publicité.`
        : `Vous recevez ce message parce qu’un compte Rat-Market est associé à l’adresse ${c.adresse}. C’est un message de service, pas une publicité.`,
    ),
    typo(`Une question ? Écrivez à ${SITE.contactEmail}.`),
    "Rat-Market · rat-market.fr",
  ];
}

export function rendreTexte(c         )         {
  const parties           = [typo(c.titre)];
  for (const b of c.blocs) {
    switch (b.t) {
      case "p":
      case "note":
      case "sous-titre":
        parties.push(typo(b.texte));
        break;
      case "liste":
        parties.push(b.items.map((i) => `- ${typo(i)}`).join("\n"));
        break;
      case "details":
        parties.push(b.lignes.map(([l, v]) => typo(`${l} : ${v}`)).join("\n"));
        break;
      case "bouton":
        parties.push(`${typo(b.libelle)}${INSECABLE}:\n${b.lien}`);
        break;
    }
  }
  parties.push(`--\n${pied(c).join("\n")}`);
  return `${parties.join("\n\n")}\n`;
}

// ── Le HTML ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const k = COULEURS;

/** Le style d'un texte : police, taille ET interligne en px, l'interligne figé pour Word (`mso-line-height-rule:exactly`). */
function styleTexte(px        , interligne        , couleur        , plus = "")         {
  return `font-family:${POLICE};font-size:${px}px;line-height:${interligne}px;mso-line-height-rule:exactly;color:${couleur}${plus}`;
}

/** Une table de mise en page : tout à 0, `role="presentation"` (un lecteur d'écran n'y lit pas un tableau de données). */
const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';

/** La largeur du rectangle VML d'un bouton (Outlook ne sait pas l'ajuster au texte) : ~9 px par lettre à 16 px, plus les marges. */
function largeurBouton(libelle        )         {
  return Math.max(220, Math.min(520, Math.round(libelle.length * 9.2 + 64)));
}

function blocHtml(b      )         {
  const e = (s        ) => echapper(typo(s));
  switch (b.t) {
    case "p":
      return `<tr><td class="tx pad" style="padding:0 32px 16px;${styleTexte(16, 24, k.texteClair)}">${e(b.texte)}</td></tr>`;
    case "sous-titre":
      return `<tr><td class="tx pad" style="padding:8px 32px 8px;${styleTexte(16, 24, k.texteClair, ";font-weight:700")}">${e(b.texte)}</td></tr>`;
    case "note":
      return `<tr><td class="tx-doux pad" style="padding:0 32px 16px;${styleTexte(14, 21, k.doucClair)}">${e(b.texte)}</td></tr>`;
    case "liste":
      return `<tr><td class="tx pad" style="padding:0 32px 16px;${styleTexte(16, 24, k.texteClair)}"><ul style="margin:0;padding:0 0 0 20px">${b.items
        .map((i) => `<li style="margin:0 0 6px;${styleTexte(16, 24, k.texteClair)}" class="tx">${e(i)}</li>`)
        .join("")}</ul></td></tr>`;
    case "details":
      return `<tr><td class="pad" style="padding:0 32px 20px"><table ${TABLE} width="100%" class="trait" style="border:1px solid ${k.traitClair};border-radius:8px">${b.lignes
        .map(
          ([l, v], i) =>
            `<tr><td class="tx-doux${i > 0 ? " trait-haut" : ""}" width="40%" style="padding:12px 16px;${i > 0 ? `border-top:1px solid ${k.traitClair};` : ""}${styleTexte(14, 20, k.doucClair)};width:40%;vertical-align:top">${e(l)}</td><td class="tx${i > 0 ? " trait-haut" : ""}" style="padding:12px 16px;${i > 0 ? `border-top:1px solid ${k.traitClair};` : ""}${styleTexte(15, 20, k.texteClair, ";font-weight:600")};vertical-align:top">${e(v)}</td></tr>`,
        )
        .join("")}</table></td></tr>`;
    case "bouton": {
      const href = echapper(b.lien);
      const libelle = e(b.libelle);
      const large = largeurBouton(b.libelle);
      // Le bouton « à l'épreuve des balles » : une cellule colorée portant le lien (tous les clients) ET un rectangle VML (Outlook de bureau,
      // qui ne dessine ni le fond ni les coins d'un lien). Chacun est caché à l'autre par un commentaire conditionnel.
      return `<tr><td class="pad" style="padding:4px 32px 20px"><table ${TABLE}><tr><td align="center" bgcolor="${k.or}" class="bouton" style="background-color:${k.or};border-radius:999px">
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:48px;v-text-anchor:middle;width:${large}px" arcsize="50%" stroke="f" fillcolor="${k.or}"><w:anchorlock/><center style="font-family:${POLICE};font-size:16px;font-weight:bold;color:${k.noir}">${libelle}</center></v:roundrect>
<![endif]-->
<!--[if !mso]><!-- -->
<a href="${href}" class="bouton-lien" style="display:inline-block;padding:14px 28px;${styleTexte(16, 20, k.noir, ";font-weight:700;text-decoration:none;border-radius:999px")}">${libelle}</a>
<!--<![endif]-->
</td></tr></table></td></tr><tr><td class="tx-doux pad" style="padding:0 32px 16px;${styleTexte(13, 19, k.doucClair)}">${e("Le bouton ne s’affiche pas ? Copiez ce lien dans votre navigateur :")}<br><a href="${href}" class="lien" style="color:${k.orSurBlanc};word-break:break-all">${href}</a></td></tr>`;
    }
  }
}

/** Le préentête : le texte que le client affiche à côté de l'objet, caché dans le message (écran ET Outlook), suivi d'espaces vides. */
function preentete(resume        )         {
  const cache = `display:none;mso-hide:all;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${k.fondClair}`;
  return `<table ${TABLE} width="100%" style="display:none;mso-hide:all;max-height:0;overflow:hidden;opacity:0"><tr><td style="${cache}">${echapper(typo(resume))}${"&#8204;&nbsp;".repeat(40)}</td></tr></table>`;
}

export function rendreHtml(c         )         {
  const corps = c.blocs.map(blocHtml).join("\n");
  const lignesPied = pied(c)
    .map((l) => `<p style="margin:0 0 6px">${echapper(l)}</p>`)
    .join("");
  return `<!doctype html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<title>${echapper(typo(c.objet))}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt}
td{border-collapse:collapse}
img{-ms-interpolation-mode:bicubic}
a[x-apple-data-detectors]{color:inherit !important;text-decoration:none !important}
@media (prefers-color-scheme: dark){
.fond{background-color:${k.fondSombre} !important}
.carte{background-color:${k.carteSombre} !important}
.tx{color:${k.texteSombre} !important}
.tx-doux{color:${k.doucSombre} !important}
.trait{border-color:${k.traitSombre} !important}
.trait-haut{border-top-color:${k.traitSombre} !important}
.lien{color:${k.orClair} !important}
}
[data-ogsb] .fond{background-color:${k.fondSombre} !important}
[data-ogsb] .carte{background-color:${k.carteSombre} !important}
[data-ogsc] .tx{color:${k.texteSombre} !important}
[data-ogsc] .tx-doux{color:${k.doucSombre} !important}
[data-ogsc] .lien{color:${k.orClair} !important}
@media (max-width:620px){
.cadre{width:100% !important}
.pad{padding-left:20px !important;padding-right:20px !important}
}
</style>
</head>
<body class="fond" bgcolor="${k.fondClair}" style="margin:0;padding:0;background-color:${k.fondClair}">
${preentete(c.resume)}
<table ${TABLE} width="100%" bgcolor="${k.fondClair}" class="fond" style="background-color:${k.fondClair}"><tr><td align="center" style="padding:24px 12px">
<!--[if mso]>
<table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td width="600">
<![endif]-->
<table ${TABLE} width="600" class="cadre" style="width:100%;max-width:600px">
<tr><td bgcolor="${k.noir}" style="background-color:${k.noir};padding:20px 32px;border-radius:12px 12px 0 0"><table ${TABLE}><tr><td style="padding:0 12px 0 0;vertical-align:middle"><img src="${SITE.url}/images/logo.png" alt="" width="40" height="40" style="display:block;border:0;outline:none;text-decoration:none;border-radius:20px;width:40px;height:40px"></td><td style="vertical-align:middle;${styleTexte(20, 24, k.or, ";font-weight:800")}">Rat-Market</td></tr></table></td></tr>
<tr><td class="carte" bgcolor="${k.carteClair}" style="background-color:${k.carteClair};border-radius:0 0 12px 12px"><table ${TABLE} width="100%">
<tr><td class="tx pad" style="padding:32px 32px 16px;${styleTexte(24, 30, k.texteClair, ";font-weight:800")}"><h1 class="tx" style="margin:0;${styleTexte(24, 30, k.texteClair, ";font-weight:800")}">${echapper(typo(c.titre))}</h1></td></tr>
${corps}
<tr><td class="trait-haut tx-doux pad" style="padding:20px 32px 28px;border-top:1px solid ${k.traitClair};${styleTexte(12, 18, k.doucClair)}">${lignesPied}</td></tr>
</table></td></tr>
</table>
<!--[if mso]>
</td></tr></table>
<![endif]-->
</td></tr></table>
</body>
</html>
`;
}
