import { describe, expect, it } from 'vitest';
import { dansLeBatiment, ramener, ramenerLesLieux } from './ramener.mjs';

/*
  Coordonnees en metres, dans le repere local du campus.
  Un batiment carre de 20 m de cote, et un autre de 30 m avec une cour au milieu.
*/
const carre = { campus: true, c: [[0, 0], [20, 0], [20, 20], [0, 20]] };
const avecCour = {
  campus: true,
  c: [[0, 0], [30, 0], [30, 30], [0, 30]],
  t: [[[10, 10], [20, 10], [20, 20], [10, 20]]],
};

describe('ramener une salle dans son batiment', () => {
  it('laisse une salle deja dans ses murs', () => {
    expect(ramener([5, 5], [carre])).toBeNull();
  });

  it('rentre une salle tombee juste dehors, 1,5 m derriere le mur', () => {
    const r = ramener([25, 10], [carre]);
    expect(r?.distance).toBe(5);
    expect(r?.p).toEqual([18.5, 10]);
    expect(dansLeBatiment(r.p, carre)).toBe(true);
  });

  it('sort une salle tombee dans la cour, vers le batiment', () => {
    const r = ramener([15, 15], [avecCour]);
    expect(r?.distance).toBe(5);
    expect(dansLeBatiment(r.p, avecCour)).toBe(true);
  });

  it('laisse un point trop loin de tout mur : un lieu dehors, ou une erreur a voir', () => {
    expect(ramener([60, 10], [carre])).toBeNull();
  });

  it('ne rentre pas un patio, qui est dehors par nature', () => {
    const { bouges } = ramenerLesLieux([{ nom: 'Patio D', p: [25, 10] }], [carre]);
    expect(bouges).toHaveLength(0);
  });
});
