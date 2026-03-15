const KEY = "echolearn.phonetic_errors";

export type PhoneticErrorRecord = {
  category: string;
  word?: string;
  timestamp: number;
};

export const getPhoneticErrors = (): PhoneticErrorRecord[] => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PhoneticErrorRecord[]) : [];
  } catch {
    return [];
  }
};

export const recordPhoneticError = (category: string, word?: string): void => {
  const errors = getPhoneticErrors();
  errors.push({ category, word, timestamp: Date.now() });
  localStorage.setItem(KEY, JSON.stringify(errors));
};

export const clearPhoneticErrors = (): void => {
  localStorage.removeItem(KEY);
};

export type PhoneticErrorSummaryEntry = {
  category: string;
  count: number;
  words: string[];
};

export const getPhoneticErrorSummary = (): PhoneticErrorSummaryEntry[] => {
  const errors = getPhoneticErrors();
  const map = new Map<string, { count: number; words: Set<string> }>();
  for (const e of errors) {
    const slot = map.get(e.category) ?? { count: 0, words: new Set<string>() };
    slot.count++;
    if (e.word) slot.words.add(e.word);
    map.set(e.category, slot);
  }
  return Array.from(map.entries())
    .map(([category, { count, words }]) => ({
      category,
      count,
      words: Array.from(words),
    }))
    .sort((a, b) => b.count - a.count);
};
