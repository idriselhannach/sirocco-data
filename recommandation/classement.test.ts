import { describe, expect, it } from 'vitest';
import {
  choisirDesSorties,
  classerLeFil,
  filAssezDense,
  type Contexte,
  type PostAClasser,
  type SortieAClasser,
} from './classement';
import {
  amorcerDesSorties,
  apprendreDuFil,
  journalVide,
  mettreEnAttente,
  noter,
  type Journal,
} from './journal';
import { momentDe, motsDe } from './traits';

/**
 * Le classement « Pour toi », eprouve sur des cas qu'on sait trancher a la
 * main. Ce qu'on protege ici, ce sont ses promesses : la fraicheur d'abord,
 * les proches ensuite, personne d'enferme, et rien qui ne se calcule deux
 * fois.
 */

const HEURE = 3_600_000;
const JOUR = 24 * HEURE;
const MAINTENANT = new Date('2026-09-11T12:00:00').getTime();

function post(id: string, auteur: string, ageH: number, extra: Partial<PostAClasser> = {}): PostAClasser {
  return {
    id,
    auteur,
    texte: '',
    creeLe: MAINTENANT - ageH * HEURE,
    likes: 0,
    commentaires: 0,
    signets: 0,
    ...extra,
  };
}

function contexte(journal: Journal = journalVide(MAINTENANT), amis: string[] = [], rencontres: string[] = []): Contexte {
  return { maintenant: MAINTENANT, moi: 'moi', amis: new Set(amis), rencontres: new Set(rencontres), journal };
}

const tel = <T,>(x: T) => x;
const ids = (liste: { id: string }[]) => liste.map((element) => element.id);

describe('les mots d’un post', () => {
  it('garde les noms, sans accents, pluriels ni mots vides', () => {
    expect(motsDe('Où trouver des restaurants marocains à Guéliz ? Merci !')).toEqual([
      'trouver',
      'restaurant',
      'marocain',
      'gueliz',
    ]);
  });

  it('dit le moment d’une sortie', () => {
    expect(momentDe('2026-09-12', '20:00')).toBe('weekend-soir');
    expect(momentDe('2026-09-15', '09:30')).toBe('semaine-matin');
  });
});

describe('le journal des goûts', () => {
  const aime = { id: 'p', auteur: 'a', texte: 'Randonnée dans l’Atlas' };

  it('ne compte un like qu’une fois, et le retire en entier', () => {
    const une = noter(journalVide(MAINTENANT), { quoi: 'like', post: aime }, MAINTENANT);
    const deux = noter(une, { quoi: 'like', post: aime }, MAINTENANT);
    expect(deux.auteurs.a).toBe(3);
    expect(deux.mots.randonnee).toBe(1);

    const retire = noter(deux, { quoi: 'like', post: aime, annule: true }, MAINTENANT);
    expect(retire.auteurs.a).toBeUndefined();
    expect(retire.comptes['p:p']).toBeUndefined();
  });

  it('laisse l’original intact', () => {
    const avant = journalVide(MAINTENANT);
    noter(avant, { quoi: 'like', post: aime }, MAINTENANT);
    expect(avant.auteurs).toEqual({});
  });

  it('use les goûts de moitié en trente jours', () => {
    const like = noter(journalVide(MAINTENANT), { quoi: 'like', post: aime }, MAINTENANT);
    const plusTard = noter(like, { quoi: 'vu', postId: 'z' }, MAINTENANT + 30 * JOUR);
    expect(plusTard.auteurs.a).toBeCloseTo(1.5, 5);
  });

  it('rattrape ce que le fil sait déjà, et défait ce qui a été défait ailleurs', () => {
    const charge = { ...aime, texte: '', aime: true, enregistre: false };
    const appris = apprendreDuFil(journalVide(MAINTENANT), [charge], 'moi', MAINTENANT);
    expect(appris.auteurs.a).toBe(3);

    const defait = apprendreDuFil(appris, [{ ...charge, aime: false }], 'moi', MAINTENANT);
    expect(defait.auteurs.a).toBeUndefined();

    const miens = apprendreDuFil(journalVide(MAINTENANT), [{ ...charge, auteur: 'moi' }], 'moi', MAINTENANT);
    expect(miens.auteurs).toEqual({});
  });

  it('compte un commentaire quand son post repasse', () => {
    const attente = mettreEnAttente(journalVide(MAINTENANT), 'p:q', 'c');
    const appris = apprendreDuFil(
      attente,
      [{ id: 'q', auteur: 'b', texte: '', aime: false, enregistre: false }],
      'moi',
      MAINTENANT,
    );
    expect(appris.auteurs.b).toBe(4);
    expect(appris.attente['p:q']).toBeUndefined();
  });
});

describe('le fil « Pour toi »', () => {
  it('ne s’applique que si la ville publie plus qu’on ne lit', () => {
    const vingt = Array.from({ length: 20 }, (_, i) => MAINTENANT - i * 2 * HEURE);
    expect(filAssezDense(vingt, true, MAINTENANT)).toBe(true);
    expect(filAssezDense(vingt, false, MAINTENANT)).toBe(false);
    expect(filAssezDense([...vingt.slice(0, 19), MAINTENANT - 49 * HEURE], true, MAINTENANT)).toBe(false);
  });

  it('passe un ami devant un inconnu du même âge', () => {
    const fil = classerLeFil([post('inconnu', 's', 1), post('ami', 'f', 1)], tel, contexte(undefined, ['f']));
    expect(ids(fil)).toEqual(['ami', 'inconnu']);
  });

  it('laisse la fraîcheur l’emporter sur l’amitié au bout de quelques jours', () => {
    const fil = classerLeFil([post('vieux', 'f', 120), post('frais', 's', 1)], tel, contexte(undefined, ['f']));
    expect(ids(fil)).toEqual(['frais', 'vieux']);
  });

  it('enfonce l’auteur d’un post masqué', () => {
    const journal = noter(journalVide(MAINTENANT), { quoi: 'masque', post: { id: 'm', auteur: 'x', texte: '' } }, MAINTENANT);
    const fil = classerLeFil([post('px', 'x', 1), post('py', 'y', 3)], tel, contexte(journal));
    expect(ids(fil)).toEqual(['py', 'px']);
  });

  it('fait descendre ce qu’on a déjà vu', () => {
    let journal = journalVide(MAINTENANT);
    for (let i = 0; i < 3; i++) journal = noter(journal, { quoi: 'vu', postId: 'deja' }, MAINTENANT);
    const fil = classerLeFil([post('deja', 'a', 1), post('jamais', 'b', 2)], tel, contexte(journal));
    expect(ids(fil)).toEqual(['jamais', 'deja']);
  });

  it('garde en vue ce qu’on vient de publier', () => {
    const fil = classerLeFil([post('autre', 's', 1), post('mien', 'moi', 3)], tel, contexte());
    expect(ids(fil)).toEqual(['mien', 'autre']);
  });

  it('ne donne jamais trois places de suite au même auteur', () => {
    const fil = classerLeFil(
      [post('a1', 'A', 1), post('a2', 'A', 1.5), post('a3', 'A', 2), post('b1', 'B', 3)],
      tel,
      contexte(undefined, ['A']),
    );
    expect(ids(fil)).toEqual(['a1', 'a2', 'b1', 'a3']);
  });

  it('réserve la quatrième place au plus récent des posts jamais vus', () => {
    const populaires = [30, 31, 32, 33].map((age, i) => post(`f${i + 1}`, `f${i + 1}`, age, { likes: 10 }));
    const fil = classerLeFil(
      [...populaires, post('nouveau', 'inconnu', 2), post('ancien', 'autre', 40)],
      tel,
      contexte(undefined, ['f1', 'f2', 'f3', 'f4']),
    );
    expect(ids(fil)).toEqual(['f1', 'f2', 'f3', 'nouveau', 'f4', 'ancien']);
  });

  it('rend toujours le même ordre pour le même état', () => {
    const posts = [post('a', 'x', 5), post('b', 'y', 5), post('c', 'z', 5)];
    expect(ids(classerLeFil(posts, tel, contexte()))).toEqual(ids(classerLeFil(posts, tel, contexte())));
  });
});

describe('les sorties « Pour toi »', () => {
  function sortie(id: string, categorie: string, extra: Partial<SortieAClasser> = {}): SortieAClasser {
    return {
      id,
      categorie,
      organisateur: `org-${id}`,
      date: '2026-09-15',
      heure: '09:00',
      debut: MAINTENANT + 2 * JOUR,
      participants: ['quelquun'],
      places: 10,
      noteOrganisateur: null,
      inscrit: false,
      annulee: false,
      ...extra,
    };
  }

  /* J'ai deja fait une sortie sport, un samedi soir. */
  const historique = amorcerDesSorties(
    journalVide(MAINTENANT),
    {
      venues: [{ id: 'passee', categorie: 'sport', organisateur: 'org-x', date: '2026-09-05', heure: '19:00' }],
      inscrites: [],
      organisees: [],
    },
    MAINTENANT,
  );

  const agenda = [
    sortie('culture-amis', 'culture', { participants: ['ami1'] }),
    sortie('sport-samedi', 'sport', { date: '2026-09-12', heure: '19:00' }),
    sortie('food-1', 'food'),
    sortie('pro-1', 'pro'),
    sortie('culture-2', 'culture'),
    sortie('food-2', 'food'),
    sortie('sport-a-moi', 'sport', { organisateur: 'moi' }),
    sortie('sport-inscrit', 'sport', { inscrit: true }),
    sortie('sport-complet', 'sport', { participants: ['a', 'b'], places: 2 }),
    sortie('sport-annule', 'sport', { annulee: true }),
    sortie('sport-passe', 'sport', { debut: MAINTENANT - JOUR }),
  ];

  it('met en avant ce qui me ressemble, et seulement cela', () => {
    const choisies = choisirDesSorties(agenda, tel, contexte(historique, ['ami1']));
    expect(ids(choisies)).toEqual(['sport-samedi', 'culture-amis']);
  });

  it('ne propose rien quand la liste se lit d’un coup d’oeil', () => {
    const courte = agenda.filter((s) => s.id !== 'food-2');
    expect(choisirDesSorties(courte, tel, contexte(historique, ['ami1']))).toEqual([]);
  });

  it('ne propose rien à qui on ne connaît aucun goût', () => {
    expect(choisirDesSorties(agenda, tel, contexte())).toEqual([]);
  });
});
