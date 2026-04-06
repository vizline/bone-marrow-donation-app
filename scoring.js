const MEN_NORMS = {
  EXT: { mean: 12.7719, sd: 3.87306 },
  AGREE: { mean: 15.7193, sd: 2.3357 },
  CONS: { mean: 12.5614, sd: 3.30053 },
  STAB: { mean: 11.8596, sd: 3.38821 },
  INTELL: { mean: 16.0702, sd: 2.48466 },
};

const WOMEN_NORMS = {
  EXT: { mean: 12.3244, sd: 3.499 },
  AGREE: { mean: 15.8473, sd: 2.51881 },
  CONS: { mean: 12.4809, sd: 3.47482 },
  STAB: { mean: 10.0573, sd: 3.21642 },
  INTELL: { mean: 15.5, sd: 2.76507 },
};

const TRAIT_LABELS = {
  EXT: 'Ekstrawersja',
  AGREE: 'Ugodowość',
  CONS: 'Sumienność',
  STAB: 'Stabilność emocjonalna',
  INTELL: 'Intelekt',
};

const SCALE_KEYS = {
  EXT: [
    { item: 1, reverse: false },
    { item: 6, reverse: true },
    { item: 11, reverse: false },
    { item: 16, reverse: true },
  ],
  AGREE: [
    { item: 2, reverse: true },
    { item: 7, reverse: false },
    { item: 12, reverse: true },
    { item: 17, reverse: false },
  ],
  CONS: [
    { item: 3, reverse: true },
    { item: 8, reverse: false },
    { item: 13, reverse: true },
    { item: 18, reverse: false },
  ],
  STAB: [
    { item: 4, reverse: false },
    { item: 9, reverse: true },
    { item: 14, reverse: false },
    { item: 19, reverse: true },
  ],
  INTELL: [
    { item: 5, reverse: false },
    { item: 10, reverse: true },
    { item: 15, reverse: false },
    { item: 20, reverse: false },
  ],
};

function reverseScore(value) {
  return 6 - value;
}

function round(value, digits) {
  return Number(value.toFixed(digits));
}

function getNormsForGender(gender) {
  return gender === 'Mężczyzna' ? MEN_NORMS : WOMEN_NORMS;
}

function calculateRawScores(answers) {
  const rawScores = {};

  for (const [traitCode, items] of Object.entries(SCALE_KEYS)) {
    rawScores[traitCode] = items.reduce((sum, config) => {
      const originalValue = answers[config.item - 1];
      const scoredValue = config.reverse ? reverseScore(originalValue) : originalValue;
      return sum + scoredValue;
    }, 0);
  }

  return rawScores;
}

function calculateProfile(gender, answers) {
  const norms = getNormsForGender(gender);
  const rawScores = calculateRawScores(answers);

  const zScores = {
    EXT: (rawScores.EXT - norms.EXT.mean) / norms.EXT.sd,
    AGREE: (rawScores.AGREE - norms.AGREE.mean) / norms.AGREE.sd,
    CONS: (rawScores.CONS - norms.CONS.mean) / norms.CONS.sd,
    STAB: (rawScores.STAB - norms.STAB.mean) / norms.STAB.sd,
    INTELL: (rawScores.INTELL - norms.INTELL.mean) / norms.INTELL.sd,
  };

  const absoluteSum =
    Math.abs(zScores.EXT) +
    Math.abs(zScores.AGREE) +
    Math.abs(zScores.CONS) +
    Math.abs(zScores.STAB) +
    Math.abs(zScores.INTELL);

  let weights;
  let profileType;

  if (absoluteSum < 2.0) {
    weights = {
      EXT: 0.2,
      AGREE: 0.2,
      CONS: 0.2,
      STAB: 0.2,
      INTELL: 0.2,
    };
    profileType = 'FLAT';
  } else {
    weights = {
      EXT: Math.abs(zScores.EXT) / absoluteSum,
      AGREE: Math.abs(zScores.AGREE) / absoluteSum,
      CONS: Math.abs(zScores.CONS) / absoluteSum,
      STAB: Math.abs(zScores.STAB) / absoluteSum,
      INTELL: Math.abs(zScores.INTELL) / absoluteSum,
    };

    const sortedWeights = Object.entries(weights).sort((a, b) => b[1] - a[1]);
    profileType = sortedWeights[0][1] - sortedWeights[1][1] < 0.05 ? 'CO-DOMINANT' : 'DOMINANT';
  }

  const ranking = Object.keys(zScores)
    .map((traitCode) => ({
      code: traitCode,
      label: TRAIT_LABELS[traitCode],
      rawScore: rawScores[traitCode],
      zScore: round(zScores[traitCode], 4),
      direction: zScores[traitCode] >= 0 ? 'wysoki' : 'niski',
      weight: round(weights[traitCode], 4),
    }))
    .sort((a, b) => b.weight - a.weight);

  let dominantTrait = null;

  if (profileType === 'DOMINANT') {
    dominantTrait = ranking[0].label;
  }

  if (profileType === 'CO-DOMINANT') {
    dominantTrait = `${ranking[0].label} + ${ranking[1].label}`;
  }

  return {
    rawScores,
    zScores: Object.fromEntries(
      Object.entries(zScores).map(([key, value]) => [key, round(value, 4)])
    ),
    weights: Object.fromEntries(
      Object.entries(weights).map(([key, value]) => [key, round(value, 4)])
    ),
    profileType,
    dominantTrait,
    ranking,
  };
}

module.exports = {
  calculateProfile,
};
