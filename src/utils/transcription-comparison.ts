export const transcriptionErrorPattern =
  /error|failed|unsupported|not found|取得できません|読み込めません|見つかりません/i;

export const reportGenerationErrorPattern =
  /an error occurred|failed to|取得できません|読み込めません|見つかりません/i;

export const normalizeForTranscriptionComparison = (text: string): string => {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]/gu, "");
};

const calculateLevenshteinDistance = (left: string, right: string): number => {
  const previousRow = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );

  for (let leftIndex = 0; leftIndex < left.length; leftIndex++) {
    const currentRow = [leftIndex + 1];

    for (let rightIndex = 0; rightIndex < right.length; rightIndex++) {
      const insertionCost = currentRow[rightIndex] + 1;
      const deletionCost = previousRow[rightIndex + 1] + 1;
      const substitutionCost =
        previousRow[rightIndex] +
        (left[leftIndex] === right[rightIndex] ? 0 : 1);

      currentRow.push(Math.min(insertionCost, deletionCost, substitutionCost));
    }

    previousRow.splice(0, previousRow.length, ...currentRow);
  }

  return previousRow[right.length];
};

const calculateLongestCommonSubsequenceLength = (
  left: string,
  right: string,
): number => {
  const previousRow = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 0; leftIndex < left.length; leftIndex++) {
    const currentRow = [0];

    for (let rightIndex = 0; rightIndex < right.length; rightIndex++) {
      if (left[leftIndex] === right[rightIndex]) {
        currentRow.push(previousRow[rightIndex] + 1);
      } else {
        currentRow.push(
          Math.max(previousRow[rightIndex + 1], currentRow[rightIndex]),
        );
      }
    }

    previousRow.splice(0, previousRow.length, ...currentRow);
  }

  return previousRow[right.length];
};

export const calculateTranscriptionSimilarity = (
  expectedAnswer: string,
  actualTranscript: string,
): number => {
  const normalizedExpected =
    normalizeForTranscriptionComparison(expectedAnswer);
  const normalizedActual =
    normalizeForTranscriptionComparison(actualTranscript);
  const maximumLength = Math.max(
    normalizedExpected.length,
    normalizedActual.length,
  );

  if (maximumLength === 0) {
    return 1;
  }

  if (normalizedExpected.length === 0 || normalizedActual.length === 0) {
    return 0;
  }

  if (
    normalizedActual.includes(normalizedExpected) ||
    normalizedExpected.includes(normalizedActual)
  ) {
    return 1;
  }

  const levenshteinSimilarity =
    1 -
    calculateLevenshteinDistance(normalizedExpected, normalizedActual) /
      maximumLength;
  const lcsLength = calculateLongestCommonSubsequenceLength(
    normalizedExpected,
    normalizedActual,
  );
  const lcsRecall = lcsLength / normalizedExpected.length;
  const lcsDice =
    (2 * lcsLength) / (normalizedExpected.length + normalizedActual.length);

  return Math.max(levenshteinSimilarity, lcsRecall, lcsDice);
};
