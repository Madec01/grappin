/**
 * Tous les réglages chiffrés du jeu, en un seul endroit.
 *
 * Les valeurs viennent du tableau de la section 14 du GDD. Elles se règlent à
 * la main sur téléphone ; aucune autre partie de la simulation ne contient de
 * constante de jeu. Les unités sont le mètre, la seconde et le mètre par
 * seconde. L'axe Y pointe vers le haut.
 */
export interface Tuning {
  /** Gravité, en m/s², positive vers le bas. */
  readonly gravity: number;
  /** Durée d'un pas de simulation, en secondes. */
  readonly stepSeconds: number;
  /** Rayon du personnage, pour la brume et les contacts. */
  readonly heroRadius: number;
  /** Longueur minimale de corde : le treuil s'arrête là, et plus près la corde reste molle jusqu'à se tendre. */
  readonly ropeMin: number;
  /** Treuil : vitesse à laquelle la corde se raccourcit tant que le doigt reste posé, en m/s. 0 désactive. */
  readonly reelSpeed: number;
  /** Part de la conservation du moment cinétique quand la corde raccourcit : 0 garde la vitesse, 1 la multiplie par l'ancien rapport des longueurs. */
  readonly reelSpin: number;
  /** Portée du grappin : un point plus loin n'est jamais visé. */
  readonly ropeMax: number;
  /** Tolérance au-delà de la portée pendant le coyote time, en multiple de la portée. */
  readonly coyoteReach: number;
  /** Durée du coyote time, en secondes. */
  readonly coyoteSeconds: number;
  /** Mémoire d'appui : un tap reçu sans point visé reste valable ce temps, au cas où un point arrive. */
  readonly pressBufferSeconds: number;
  /** Vitesse maximale du personnage, toutes directions. */
  readonly maxSpeed: number;
  /** Sous cette vitesse tangentielle à l'accroche, le jeu donne une impulsion. */
  readonly minSwingSpeed: number;
  /** Vitesse tangentielle donnée par l'impulsion « jamais immobile ». */
  readonly kickSpeed: number;
  /** Durée pendue sous `minSwingSpeed` qui déclenche une nouvelle impulsion. */
  readonly hangSeconds: number;
  /** Pompage : accroché sous cette vitesse, le personnage accélère le long du cercle de `swingAssistAccel` m/s². 0 désactive. */
  readonly swingAssistSpeed: number;
  readonly swingAssistAccel: number;
  /** Horizon de la prédiction utilisée pour viser le point sur la trajectoire, en secondes. */
  readonly aimLookaheadSeconds: number;
  /** Un nouveau point remplace le point visé seulement si son score est sous ce ratio du score courant. */
  readonly aimHysteresis: number;
  /** Préférence pour les points plus hauts : mètres de score retirés par mètre de hauteur. */
  readonly aimHeightBias: number;
  /** Fenêtre du lâcher parfait : pente minimale et maximale de la vitesse (tangente de l'angle). */
  readonly perfectMinSlope: number;
  readonly perfectMaxSlope: number;
  /** Vitesse minimale pour qu'un lâcher compte comme parfait. */
  readonly perfectMinSpeed: number;
  /** Multiplicateur = 1 + comboStep × combo, plafonné. */
  readonly comboStep: number;
  readonly comboMaxMultiplier: number;
  /** Accroche fragile : elle casse après ce temps de tenue, en secondes. */
  readonly fragileSeconds: number;
  /** Accroche propulseuse : la vitesse au lâcher est multipliée par ce facteur. */
  readonly boostFactor: number;
  /** Frôlé : distance maximale entre le bord du personnage et un obstacle pour compter le bonus. */
  readonly grazeDistance: number;
  /** Points d'un frôlé et d'une étoile, multipliés par le multiplicateur courant. */
  readonly grazeScore: number;
  readonly pickupScore: number;
  /** Rayon de ramassage d'une étoile. */
  readonly pickupRadius: number;
  /** Ombre prédictive : durée de vol montrée au lâcher, en secondes. */
  readonly shadowSeconds: number;
  /** Hauteur d'un palier nommé, en mètres. */
  readonly tierHeight: number;
  /** Marge de génération du parcours au-dessus du personnage, en mètres. */
  readonly courseAhead: number;
  /** Vérificateur : tenue maximale simulée, durée de vol examinée, part de la portée exigée pour compter une accroche. */
  readonly verifyHoldSeconds: number;
  readonly verifyFlightSeconds: number;
  readonly verifyCatchRatio: number;
  /** Brume : vitesse de départ, gain tous les `fogStepHeight` mètres, plafond, niveau initial. */
  readonly fogBaseSpeed: number;
  readonly fogSpeedGain: number;
  readonly fogStepHeight: number;
  readonly fogMaxSpeed: number;
  readonly fogStart: number;
}

export const DEFAULT_TUNING: Tuning = {
  gravity: 7.5,
  stepSeconds: 1 / 120,
  heroRadius: 0.3,
  ropeMin: 1.5,
  reelSpeed: 3.5,
  reelSpin: 0.6,
  ropeMax: 7,
  coyoteReach: 1.2,
  coyoteSeconds: 0.12,
  pressBufferSeconds: 0.15,
  maxSpeed: 24,
  minSwingSpeed: 2,
  kickSpeed: 3,
  hangSeconds: 0.5,
  swingAssistSpeed: 4.5,
  swingAssistAccel: 4,
  aimLookaheadSeconds: 0.35,
  aimHysteresis: 0.7,
  aimHeightBias: 0.25,
  perfectMinSlope: 0.5774,
  perfectMaxSlope: 1.7321,
  perfectMinSpeed: 3,
  comboStep: 0.25,
  comboMaxMultiplier: 5,
  fragileSeconds: 1,
  boostFactor: 1.35,
  grazeDistance: 0.5,
  grazeScore: 5,
  pickupScore: 10,
  pickupRadius: 0.35,
  shadowSeconds: 0.25,
  tierHeight: 50,
  courseAhead: 40,
  verifyHoldSeconds: 2.5,
  verifyFlightSeconds: 1.5,
  verifyCatchRatio: 0.8,
  fogBaseSpeed: 0.8,
  fogSpeedGain: 0.1,
  fogStepHeight: 50,
  fogMaxSpeed: 3,
  fogStart: -3,
};

/**
 * Surcharge partielle des réglages, par exemple depuis les paramètres d'URL
 * pendant une séance de réglage sur téléphone. Les valeurs non numériques
 * sont ignorées sans erreur.
 */
export function withTuning(base: Tuning, overrides: Partial<Record<keyof Tuning, number | undefined>>): Tuning {
  const result: Record<string, number> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || !(key in base)) continue;
    // Un pas nul ou négatif bloquerait la boucle de jeu : on garde la valeur de base.
    if (key === 'stepSeconds' && value <= 0) continue;
    result[key] = value;
  }
  return result as unknown as Tuning;
}
