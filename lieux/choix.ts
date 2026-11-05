/**
 * Quels lieux montrer, a quel zoom.
 *
 * Apple Plans connait des centaines de lieux dans une ville, et une carte de
 * telephone n'en porte qu'une trentaine sans devenir illisible. On ne les
 * regroupe pas sous un nombre : on en choisit, les plus importants d'abord, et
 * chacun garde un peu de place autour de lui.
 *
 * Tout ici est du calcul pur, sans carte ni reseau : c'est ce qui le rend
 * testable (`choix.test.ts`), et c'est `CarteDesLieux` qui le branche sur MapKit.
 */

/*
  Ce qui compte le plus sur une carte, faute de mieux.

  Apple ne donne ni note ni frequentation. Le genre du lieu dit donc l'essentiel : un
  stade ou un musee se cherchent, et il y en a peu ; une boutique, il y en a cent. Le
  reste de l'importance vient de ce qu'on sait du lieu et du rang que lui donne Apple.
*/
const POIDS_DES_CATEGORIES: Record<string, number> = {
  Stadium: 10, Museum: 10, Castle: 10, Fortress: 10, NationalMonument: 10, Landmark: 9,
  AmusementPark: 10, Zoo: 10, Aquarium: 10, Planetarium: 9, NationalPark: 9, Beach: 9,
  MovieTheater: 9, Theater: 9, MusicVenue: 8, Park: 7, Hiking: 6, Marina: 6,
  Swimming: 8, Golf: 7, Skating: 8, RockClimbing: 7, Soccer: 7, Tennis: 7, Basketball: 7,
  Volleyball: 6, SkatePark: 6, Bowling: 7, MiniGolf: 6, GoKart: 7, Library: 6,
  Nightlife: 6, Brewery: 6, Winery: 6, Distillery: 6, Restaurant: 5, FoodMarket: 5,
  Cafe: 4, Bakery: 3, FitnessCenter: 2, Store: 2,
};
const POIDS_INCONNU = 3;

/**
 * L'importance d'un lieu tel qu'Apple le rend.
 *
 * @param rang La place dans la reponse d'Apple, de 0 (la premiere) a 1 (la derniere).
 * @param decoupes Combien de fois la zone a ete coupee : etre premier d'une petite zone
 * dit moins qu'etre premier de toute la vue.
 */
export function importanceDuLieu(lieu: {
  categorie: string | null | undefined;
  site: boolean;
  telephone: boolean;
  rang: number;
  decoupes: number;
}): number {
  return (
    ((lieu.categorie && POIDS_DES_CATEGORIES[lieu.categorie]) || POIDS_INCONNU) +
    (lieu.site ? 1.5 : 0) +
    (lieu.telephone ? 0.5 : 0) +
    (2 * (1 - lieu.rang)) / (1 + lieu.decoupes)
  );
}

/*
  L'ecart minimal entre deux punaises a l'ecran : c'est lui qui dit combien on en montre.
  62 px puis 50 le 3 novembre 2026, a la demande d'Idris : un peu plus de lieux partout.
*/
export const ECART_PX = 50;
/*
  De loin, les lieux se tassent dans quelques centres-villes : 50 px n'en laissaient passer
  que 19 sur les 190 assez importants de la vue (Poissy, le 3 novembre 2026).
*/
export const ECART_DE_LOIN_PX = 40;
export const DE_LOIN = 0.08;
/* Ce qu'on a cherche se montre : l'ecart ne sert plus qu'a ne pas les empiler. */
export const ECART_RESULTATS_PX = 36;

/*
  L'ecart seul laissait les boutiques combler tous les trous : plus on est loin, plus
  il faut etre important pour paraitre. Rien ne s'applique quand on a coche des
  filtres : qui demande les commerces veut les commerces.
*/
export function importanceMinimale(etendueLat: number): number {
  if (etendueLat >= 0.08) return 6.5;
  if (etendueLat >= 0.035) return 5.5;
  if (etendueLat >= 0.012) return 5;
  return 0;
}

export interface Candidat {
  id: string;
  lat: number;
  lon: number;
  importance: number;
  famille: string;
}

export interface Vue {
  lat: number;
  lon: number;
  etendueLat: number;
  etendueLon: number;
}

/**
 * Pas tout : les plus importants, bien repartis.
 *
 * On parcourt les lieux du plus important au moins important, et l'on en garde un
 * s'il n'y en a pas deja un trop pres de lui a l'ecran. Les grands passent donc
 * toujours, les petits ne remplissent que les endroits libres, et chaque coin de la
 * carte a les siens. En se rapprochant, la meme distance a l'ecran represente moins
 * de terrain : ceux qui sont la restent, et d'autres apparaissent entre eux.
 */
export function choisirLesLieux<T extends Candidat>(
  tous: readonly T[],
  vue: Vue,
  cadre: { width: number; height: number },
  options: {
    /** Les familles cochees ; aucune, on voit tout. */
    filtre: readonly string[];
    /** Des resultats de recherche : on les montre tous, juste sans les empiler. */
    cherches: boolean;
    /** Celui dont la fiche est ouverte ne disparait pas sous elle. */
    choisi: T | null;
    /** La zone de la ville : rien n'est montre au-dehors. */
    dedans: (lieu: T) => boolean;
  },
): T[] {
  const { filtre, cherches, choisi, dedans } = options;
  const ecart = cherches ? ECART_RESULTATS_PX : vue.etendueLat >= DE_LOIN ? ECART_DE_LOIN_PX : ECART_PX;
  const parPixelX = vue.etendueLon / cadre.width;
  const parPixelY = vue.etendueLat / cadre.height;

  const seuil = filtre.length === 0 ? importanceMinimale(vue.etendueLat) : 0;
  const candidats = tous
    .filter((lieu) => cherches || (filtre.length === 0 ? lieu.importance >= seuil : filtre.includes(lieu.famille)))
    .filter(dedans)
    /* Ce qui se voit, et un peu autour pour ne rien voir arriver. */
    .filter(
      (lieu) =>
        Math.abs(lieu.lat - vue.lat) <= vue.etendueLat * 0.75 &&
        Math.abs(lieu.lon - vue.lon) <= vue.etendueLon * 0.75,
    )
    .sort((a, b) => b.importance - a.importance || a.id.localeCompare(b.id));
  if (choisi) candidats.unshift(choisi);

  const gardes: { lieu: T; x: number; y: number }[] = [];
  for (const lieu of candidats) {
    const x = lieu.lon / parPixelX;
    const y = lieu.lat / parPixelY;
    if (gardes.some((garde) => Math.hypot(garde.x - x, garde.y - y) < ecart)) continue;
    gardes.push({ lieu, x, y });
  }
  return gardes.map(({ lieu }) => lieu);
}
