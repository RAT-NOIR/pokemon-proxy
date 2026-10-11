/**
 * QUELLE IMAGE MONTRE CETTE FICHE ? Celle de SON impression, jamais celle d'une
 * autre impression de la même carte dans le même set.
 *
 * Un document de carte porte souvent plusieurs impressions dans un set (la
 * commune n° 129 et la galerie TG24), et `cartes.images` plusieurs images pour
 * ce set. Le site prenait la PREMIÈRE image du set : mesuré le 2026-09-21,
 * 149 fiches montraient le visuel d'une autre impression — la fiche n° 129
 * d'Acerola's Premonition affichait la TG24. Rien ne le signalait : une image
 * de la bonne carte, du bon set, simplement pas la bonne.
 *
 * 13 823 images sur 30 857 portent un `numero` (celles de Bulbapedia). Règle :
 * 1. une image AU NUMÉRO de la fiche → elle ;
 * 2. sinon une image SANS numéro → elle (on ne sait pas, c'est l'état d'avant) ;
 * 3. sinon — toutes les images du set disent un AUTRE numéro — aucune : le
 *    visuel absent est honnête, le visuel d'une autre carte ne l'est pas.
 * Une fiche sans numéro (aucune impression rattachable) ne peut rien
 * contredire : elle garde la première image.
 *
 * C'est aussi la règle du modèle « une fiche par impression » : chaque fiche y
 * appellera cette fonction avec SON numéro.
 */
                                 
                
            
            
                                  
 

/** « 006 », « 6 » et 6 désignent le même numéro ; « tg24 » et « TG24 » aussi. */
export function normaliserNumero(numero                                    )                {
  if (numero === null || numero === undefined) return null;
  const n = String(numero).trim().toUpperCase().replace(/^0+(?=\d)/, "");
  return n === "" ? null : n;
}

export function imageDeLImpression                          (
  images              ,
  numero               ,
)           {
  const voulu = normaliserNumero(numero);
  if (voulu === null) return images[0] ?? null;
  return (
    images.find((m) => normaliserNumero(m.numero) === voulu) ??
    images.find((m) => normaliserNumero(m.numero) === null) ??
    null
  );
}
