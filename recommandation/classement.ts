import type { Journal } from './journal';
import { momentDe, motsDe } from './traits';

/**
 * Le classement « Pour toi ».
 *
 * # Ce qu'il fait
 *
 * Chaque post recoit une note pour celui qui regarde : sa fraicheur,
 * multipliee par ce qui le rapproche de lui. Un ami ou quelqu'un croise a
 * une sortie, un auteur qu'il a souvent like, des mots qui reviennent dans
 * ce qu'il enregistre ou lit jusqu'au bout, un post qui fait parler. Ce
 * qu'il a deja vu plusieurs fois descend, ce qu'il a masque s'enfonce.
 *
 * La fraicheur reste le premier facteur. Une ville parle de ce soir et de
 * demain : un post d'ami vieux de cinq jours ne passe pas devant la
 * question posee il y a une heure.
 *
 * # Ce qu'il ne fait pas
 *
 * Enfermer quelqu'un. Une place sur quatre revient au plus recent des
 * posts qu'il n'a jamais vus, quel qu'en soit l'auteur : sans elle, le
 * nouveau venu qui publie pour la premiere fois ne serait jamais lu par
 * ceux qui ne le connaissent pas encore. Et un meme auteur ne prend jamais
 * trois places de suite tant qu'il reste quelqu'un d'autre a montrer.
 *
 * # Quand il s'applique
 *
 * Seulement quand la ville publie plus qu'on ne peut lire en un passage.
 * En dessous, tout le monde voit tout, et le fil reste chronologique : un
 * classement ne ferait que brouiller un ordre que chacun comprend.
 *
 * Tout se calcule sur le telephone, a partir de ce qu'il a deja lu.
 */

const HEURE = 3_600_000;
const JOUR = 24 * HEURE;

/** Vingt publications en quarante-huit heures : au-dela, on ne voit plus tout d'un passage. */
export const DENSITE_DU_FIL = { publications: 20, heures: 48 };

/** Combien de posts recents entrent dans le classement. La suite reste chronologique. */
export const FENETRE_DU_FIL = 100;

/** Une place sur quatre revient a la nouveaute. */
const EXPLORATION = 4;

/** La fraicheur d'un post se divise par deux en trente heures. */
const DEMI_VIE_DU_POST_H = 30;

/** En dessous de six sorties proposables, la liste se lit d'un coup d'oeil. */
export const SORTIES_MINIMUM = 6;
export const SORTIES_PROPOSEES = 3;

export interface PostAClasser {
  id: string;
  auteur: string;
  texte: string;
  /** En millisecondes. */
  creeLe: number;
  likes: number;
  commentaires: number;
  signets: number;
}

export interface SortieAClasser {
  id: string;
  categorie: string;
  organisateur: string;
  date: string;
  heure: string;
  /** En millisecondes. */
  debut: number;
  participants: readonly string[];
  places: number;
  noteOrganisateur: number | null;
  /** Inscrit, en attente, ou refuse : dans tous les cas, plus rien a proposer. */
  inscrit: boolean;
  annulee: boolean;
}

export interface Contexte {
  maintenant: number;
  moi: string;
  amis: ReadonlySet<string>;
  /** Ceux que j'ai croises a une sortie, dans cette ville. */
  rencontres: ReadonlySet<string>;
  journal: Journal;
}

/**
 * La ville publie-t-elle assez pour qu'un classement ait un sens.
 *
 * `dates` sont celles de la premiere page, `pageComplete` dit si cette page
 * etait pleine. Pleine et toute entiere tenue en quarante-huit heures, c'est
 * au moins vingt publications dans ce delai.
 */
export function filAssezDense(
  dates: readonly number[],
  pageComplete: boolean,
  maintenant: number,
): boolean {
  if (!pageComplete || dates.length === 0) return false;
  return maintenant - Math.min(...dates) <= DENSITE_DU_FIL.heures * HEURE;
}

export function noteDuPost(post: PostAClasser, c: Contexte): number {
  const ageH = Math.max(0, (c.maintenant - post.creeLe) / HEURE);
  const fraicheur = Math.pow(0.5, ageH / DEMI_VIE_DU_POST_H);

  let affinite = 0;
  if (post.auteur === c.moi) {
    // Ce qu'on vient de publier reste en vue : on veut le voir parti.
    affinite += 1;
  } else {
    if (c.amis.has(post.auteur)) affinite += 1.2;
    if (c.rencontres.has(post.auteur)) affinite += 0.8;
    affinite += Math.tanh((c.journal.auteurs[post.auteur] ?? 0) / 6) * 1.5;
  }

  const mots = motsDe(post.texte);
  if (mots.length > 0) {
    const somme = mots.reduce((total, mot) => total + (c.journal.mots[mot] ?? 0), 0);
    // Divise par la racine du nombre de mots : un long post ne gagne pas a etre long.
    affinite += Math.tanh(somme / Math.sqrt(mots.length) / 4);
  }

  affinite += Math.min(1, Math.log2(1 + post.likes + 2 * post.commentaires + post.signets) * 0.25);
  affinite -= Math.min(3, c.journal.vus[post.id] ?? 0) * 0.35;

  return fraicheur * Math.max(0.15, 1 + affinite);
}

/** L'ordre « Pour toi ». Stable : les memes posts dans le meme etat donnent le meme fil. */
export function classerLeFil<T>(
  posts: readonly T[],
  vers: (post: T) => PostAClasser,
  c: Contexte,
): T[] {
  const lignes = posts.map((post) => {
    const p = vers(post);
    return { post, p, note: noteDuPost(p, c) };
  });
  type Ligne = (typeof lignes)[number];

  const departager = (a: Ligne, b: Ligne) => b.p.creeLe - a.p.creeLe || (a.p.id < b.p.id ? -1 : 1);
  const parNote = [...lignes].sort((a, b) => b.note - a.note || departager(a, b));
  const parDate = [...lignes].sort(departager);

  const places = new Set<string>();
  const fil: Ligne[] = [];
  const libre = (ligne: Ligne) => !places.has(ligne.p.id);

  while (fil.length < lignes.length) {
    let choisi: Ligne | undefined;

    if (fil.length % EXPLORATION === EXPLORATION - 1) {
      choisi = parDate.find((ligne) => libre(ligne) && (c.journal.vus[ligne.p.id] ?? 0) === 0);
    }

    if (!choisi) {
      const [avant, dernier] = fil.slice(-2).map((ligne) => ligne.p.auteur);
      const lasse = avant !== undefined && avant === dernier ? dernier : null;
      choisi =
        parNote.find((ligne) => libre(ligne) && ligne.p.auteur !== lasse) ?? parNote.find(libre);
    }

    if (!choisi) break;
    places.add(choisi.p.id);
    fil.push(choisi);
  }

  return fil.map((ligne) => ligne.post);
}

/** Ce qui me rapproche d'une sortie, sans ce qui vaut pour tout le monde. */
function affinitePersonnelle(s: SortieAClasser, c: Contexte): number {
  let affinite = Math.tanh((c.journal.categories[s.categorie] ?? 0) / 6) * 1.5;
  affinite += Math.tanh((c.journal.organisateurs[s.organisateur] ?? 0) / 5) * 1.2;
  if (c.amis.has(s.organisateur)) affinite += 0.8;
  const proches = s.participants.filter(
    (id) => id !== c.moi && (c.amis.has(id) || c.rencontres.has(id)),
  ).length;
  affinite += Math.min(3, proches) * 0.5;
  affinite += Math.tanh((c.journal.moments[momentDe(s.date, s.heure)] ?? 0) / 5) * 0.6;
  return affinite;
}

export function noteDeLaSortie(s: SortieAClasser, c: Contexte): number {
  const jours = Math.max(0, (s.debut - c.maintenant) / JOUR);
  // Ce qui a lieu dans les jours qui viennent passe devant le mois prochain.
  const proximite = 1 / (1 + jours / 4);
  let affinite = affinitePersonnelle(s, c);
  affinite += Math.min(1, s.participants.length / Math.max(2, s.places)) * 0.4;
  if ((s.noteOrganisateur ?? 0) >= 4) affinite += 0.3;
  return (0.35 + proximite) * Math.max(0.15, 1 + affinite);
}

/** Les sorties qu'on peut encore proposer : a venir, ouvertes, pas deja les miennes. */
export function sortiesProposables<T>(
  sorties: readonly T[],
  vers: (sortie: T) => SortieAClasser,
  moi: string,
  maintenant: number,
): T[] {
  return sorties.filter((sortie) => {
    const s = vers(sortie);
    return (
      s.organisateur !== moi &&
      !s.inscrit &&
      !s.annulee &&
      s.participants.length < s.places &&
      s.debut > maintenant
    );
  });
}

/**
 * Les sorties a mettre en avant, trois au plus.
 *
 * Seulement celles qui ressemblent a quelque chose que je connais : une
 * categorie ou j'ai l'habitude d'aller, un organisateur que j'apprecie, des
 * amis deja inscrits, mon moment de la semaine. Proposer « pour toi » ce qui
 * ne me ressemble en rien ne serait que l'agenda dans un autre ordre.
 */
export function choisirDesSorties<T>(
  sorties: readonly T[],
  vers: (sortie: T) => SortieAClasser,
  c: Contexte,
): T[] {
  const proposables = sortiesProposables(sorties, vers, c.moi, c.maintenant);
  if (proposables.length < SORTIES_MINIMUM) return [];

  return proposables
    .map((sortie) => {
      const s = vers(sortie);
      return { sortie, s, note: noteDeLaSortie(s, c), perso: affinitePersonnelle(s, c) };
    })
    .filter((ligne) => ligne.perso > 0)
    .sort((a, b) => b.note - a.note || a.s.debut - b.s.debut || (a.s.id < b.s.id ? -1 : 1))
    .slice(0, SORTIES_PROPOSEES)
    .map((ligne) => ligne.sortie);
}
