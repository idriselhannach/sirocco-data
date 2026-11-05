import { describe, expect, it } from 'vitest';
import {
  choisirLesLieux,
  ECART_DE_LOIN_PX,
  ECART_PX,
  importanceDuLieu,
  importanceMinimale,
  type Candidat,
  type Vue,
} from './choix';

/* Un ecran de telephone, et trois hauteurs de vue : de pres, a mi-hauteur, de loin. */
const CADRE = { width: 400, height: 800 };
const vueDe = (etendueLat: number): Vue => ({ lat: 48.93, lon: 2.04, etendueLat, etendueLon: etendueLat / 2 });
const PRES = vueDe(0.008);
const MI_HAUTEUR = vueDe(0.025);
const LOIN = vueDe(0.12);

/** Un lieu pose a tant de pixels du centre de la vue. */
function lieu(id: string, vue: Vue, px: number, py: number, importance = 8, famille = 'culture'): Candidat {
  return {
    id,
    lat: vue.lat + (py * vue.etendueLat) / CADRE.height,
    lon: vue.lon + (px * vue.etendueLon) / CADRE.width,
    importance,
    famille,
  };
}

const partout = { filtre: [], cherches: false, choisi: null, dedans: () => true };
const ids = (lieux: Candidat[]) => lieux.map((un) => un.id);

describe("l'importance d'un lieu", () => {
  it('vient surtout de son genre', () => {
    const stade = importanceDuLieu({ categorie: 'Stadium', site: false, telephone: false, rang: 1, decoupes: 0 });
    const boutique = importanceDuLieu({ categorie: 'Store', site: false, telephone: false, rang: 1, decoupes: 0 });
    expect(stade).toBe(10);
    expect(boutique).toBe(2);
  });

  it("monte avec ce qu'on sait de lui et son rang chez Apple", () => {
    expect(importanceDuLieu({ categorie: 'Stadium', site: true, telephone: true, rang: 0, decoupes: 0 })).toBe(14);
  });

  it("compte moins le rang d'une zone deja coupee", () => {
    expect(importanceDuLieu({ categorie: 'Cafe', site: false, telephone: false, rang: 0, decoupes: 1 })).toBe(5);
  });

  it("donne un poids moyen a un lieu sans genre", () => {
    expect(importanceDuLieu({ categorie: null, site: false, telephone: false, rang: 1, decoupes: 0 })).toBe(3);
  });
});

describe("l'importance demandee", () => {
  it('grandit quand on recule', () => {
    expect(importanceMinimale(PRES.etendueLat)).toBe(0);
    expect(importanceMinimale(MI_HAUTEUR.etendueLat)).toBe(5);
    expect(importanceMinimale(0.05)).toBe(5.5);
    expect(importanceMinimale(LOIN.etendueLat)).toBe(6.5);
  });
});

describe('les lieux montres', () => {
  it("ecarte le moins important quand deux se touchent", () => {
    const musee = lieu('musee', PRES, 0, 0, 10);
    const cafe = lieu('cafe', PRES, 10, 0, 4);
    expect(ids(choisirLesLieux([cafe, musee], PRES, CADRE, partout))).toEqual(['musee']);
  });

  it('garde les deux quand ils ont de la place', () => {
    const musee = lieu('musee', PRES, 0, 0, 10);
    const cafe = lieu('cafe', PRES, ECART_PX + 5, 0, 4);
    expect(ids(choisirLesLieux([cafe, musee], PRES, CADRE, partout))).toEqual(['musee', 'cafe']);
  });

  it('serre un peu plus les lieux de loin', () => {
    const entre = (ECART_DE_LOIN_PX + ECART_PX) / 2;
    expect(choisirLesLieux([lieu('a', LOIN, 0, 0, 10), lieu('b', LOIN, entre, 0, 10)], LOIN, CADRE, partout)).toHaveLength(2);
    expect(
      choisirLesLieux([lieu('a', MI_HAUTEUR, 0, 0, 10), lieu('b', MI_HAUTEUR, entre, 0, 10)], MI_HAUTEUR, CADRE, partout),
    ).toHaveLength(1);
  });

  it("cache de loin ce qui n'est pas assez important", () => {
    const boutique = lieu('boutique', LOIN, 0, 0, 4, 'commerces');
    const musee = lieu('musee', LOIN, 200, 0, 10);
    expect(ids(choisirLesLieux([boutique, musee], LOIN, CADRE, partout))).toEqual(['musee']);
  });

  it("montre ce qu'on a coche, et seulement cela, a toutes les hauteurs", () => {
    const boutique = lieu('boutique', LOIN, 0, 0, 4, 'commerces');
    const musee = lieu('musee', LOIN, 200, 0, 10);
    const coches = { ...partout, filtre: ['commerces'] };
    expect(ids(choisirLesLieux([boutique, musee], LOIN, CADRE, coches))).toEqual(['boutique']);
  });

  it("montre tous les resultats d'une recherche, juste sans les empiler", () => {
    const peu = lieu('peu', LOIN, 0, 0, 1);
    const voisin = lieu('voisin', LOIN, 38, 0, 1);
    const cherches = { ...partout, cherches: true };
    expect(ids(choisirLesLieux([peu, voisin], LOIN, CADRE, cherches))).toEqual(['peu', 'voisin']);
  });

  it('garde celui dont la fiche est ouverte, meme serre contre un plus grand', () => {
    const musee = lieu('musee', PRES, 0, 0, 10);
    const ouvert = lieu('ouvert', PRES, 5, 0, 2);
    const vus = choisirLesLieux([musee, ouvert], PRES, CADRE, { ...partout, choisi: ouvert });
    expect(ids(vus)).toEqual(['ouvert']);
  });

  it('ne montre rien hors de la ville, ni loin hors de la vue', () => {
    const dehors = lieu('dehors', PRES, 0, 0, 10);
    const ailleurs = lieu('ailleurs', PRES, 0, CADRE.height, 10);
    const dedans = lieu('dedans', PRES, 100, 0, 10);
    const zone = { ...partout, dedans: (un: Candidat) => un.id !== 'dehors' };
    expect(ids(choisirLesLieux([dehors, ailleurs, dedans], PRES, CADRE, zone))).toEqual(['dedans']);
  });

  it("tranche une egalite toujours de la meme facon", () => {
    const a = lieu('a', PRES, 0, 0, 7);
    const b = lieu('b', PRES, 5, 0, 7);
    expect(ids(choisirLesLieux([b, a], PRES, CADRE, partout))).toEqual(['a']);
    expect(ids(choisirLesLieux([a, b], PRES, CADRE, partout))).toEqual(['a']);
  });
});
