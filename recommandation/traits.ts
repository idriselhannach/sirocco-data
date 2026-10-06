/**
 * Ce qu'on retient d'un post ou d'une sortie pour dire a quoi il ressemble.
 *
 * Pas d'analyse de la langue. Une publication de ville tient en deux
 * phrases, et ce qui la distingue d'une autre, ce sont ses noms : un
 * quartier, un plat, un sport, une demarche. On garde les mots d'au moins
 * quatre lettres, sans accents ni majuscules, moins ceux qu'on trouve dans
 * toutes les phrases. Le pluriel se ramene au singulier par sa derniere
 * lettre : « restaurants » et « restaurant » disent le meme gout.
 */

/** Un long texte ne pese pas plus qu'un court : ses premiers mots suffisent. */
const MOTS_PAR_TEXTE = 30;

/** Les mots qui ne disent rien du sujet, deja plies. */
const VIDES = new Set([
  'avec', 'pour', 'dans', 'mais', 'plus', 'moins', 'tout', 'tous', 'toute', 'toutes',
  'sont', 'etre', 'avoir', 'cette', 'ceux', 'celle', 'celles', 'celui', 'elle', 'elles',
  'nous', 'vous', 'leur', 'leurs', 'votre', 'notre', 'quel', 'quelle', 'quels', 'quelles',
  'quoi', 'comme', 'bien', 'tres', 'aussi', 'alors', 'donc', 'encore', 'deja', 'fait',
  'faire', 'peut', 'peux', 'veux', 'voir', 'quand', 'sans', 'chez', 'entre', 'apres',
  'avant', 'depuis', 'pendant', 'sous', 'vers', 'cela', 'ceci', 'rien', 'chose', 'merci',
  'bonjour', 'salut', 'hello', 'quelqu', 'quelque', 'chaque', 'autre', 'meme', 'juste',
  'vraiment', 'beaucoup', 'trop', 'jamais', 'toujours', 'souvent', 'etait', 'sera', 'avez',
  'avons', 'suis', 'sommes', 'etes', 'vais', 'allez', 'allons', 'dire', 'savoir', 'connait',
  'connais', 'besoin', 'cherche', 'recherche', 'aujourd', 'demain', 'voila', 'please',
  'cool', 'super',
  /* Et les memes en anglais : une ville ecrit aussi dans cette langue. */
  'with', 'from', 'that', 'this', 'they', 'them', 'their', 'there', 'what', 'when', 'where',
  'which', 'your', 'about', 'have', 'been', 'were', 'will', 'would', 'could', 'should', 'some',
  'than', 'then', 'into', 'only', 'over', 'here', 'like', 'want', 'need', 'know', 'today',
  'tomorrow', 'thanks', 'anyone', 'everyone', 'someone', 'something', 'looking', 'really',
]);

export function motsDe(texte: string): string[] {
  const plie = texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const mots = new Set<string>();
  for (const brut of plie.split(/[^a-z0-9]+/)) {
    if (brut.length < 4 || /^\d+$/.test(brut) || VIDES.has(brut)) continue;
    const mot = brut.length > 4 && /[sx]$/.test(brut) ? brut.slice(0, -1) : brut;
    if (VIDES.has(mot)) continue;
    mots.add(mot);
    if (mots.size === MOTS_PAR_TEXTE) break;
  }
  return [...mots];
}

/**
 * Le debut d'une sortie, en millisecondes, a l'heure du telephone.
 *
 * Une approximation assumee : la ville et le telephone peuvent ne pas
 * partager le meme fuseau, mais le classement ne compte qu'en jours.
 */
export function debutDe(date: string, heure: string): number {
  const horaire = /^\d{2}:\d{2}$/.test(heure) ? heure : '12:00';
  const instant = new Date(`${date}T${horaire}:00`).getTime();
  return Number.isFinite(instant) ? instant : 0;
}

/**
 * Le moment d'une sortie : semaine ou week-end, matin, apres-midi ou soir.
 *
 * C'est ce qui separe celui qui sort le samedi soir de celui qui court le
 * mardi matin, sans rien savoir d'autre de lui que ses sorties passees.
 */
export function momentDe(date: string, heure: string): string {
  // Midi, pour qu'aucun fuseau ne fasse basculer le jour.
  const jour = new Date(`${date}T12:00:00`).getDay();
  const h = Number(heure.slice(0, 2));
  const tranche = !/^\d{2}/.test(heure) ? 'journee' : h < 12 ? 'matin' : h < 18 ? 'aprem' : 'soir';
  return `${jour === 0 || jour === 6 ? 'weekend' : 'semaine'}-${tranche}`;
}
