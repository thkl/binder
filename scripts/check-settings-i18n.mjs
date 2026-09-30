import { readFileSync } from 'node:fs';

const constants = readFileSync(
  new URL('../packages/api/src/features/settings/models/constants.ts', import.meta.url),
  'utf8',
);
const i18n = readFileSync(
  new URL('../packages/client/src/app/common/i18n/i18n.service.ts', import.meta.url),
  'utf8',
);

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`Unable to locate ${start} … ${end}`);
  }
  return source.slice(startIndex + start.length, endIndex);
}

function keys(source) {
  return new Set([...source.matchAll(/^\s*['"]([^'"]+)['"]\s*:/gm)].map((match) => match[1]));
}

function merge(...sets) {
  return new Set(sets.flatMap((set) => [...set]));
}

const settingsMap = between(constants, 'export const settingsMap: SettingsMapItem[] = [', '];');
const settingKeys = [...settingsMap.matchAll(/\n\s+key: '([^']+)'/g)].map((match) => match[1]);

const settingsSections = between(
  constants,
  'export const settingsSections: SettingsSection[] = [',
  '];',
);
const sectionKeys = [...settingsSections.matchAll(/\n\s+key: '([^']+)'/g)].map((match) => match[1]);

const baseEnglish = keys(
  between(i18n, 'const EN: TranslationMap = {', 'const DE: TranslationMap = {'),
);
const baseGerman = keys(between(i18n, 'const DE: TranslationMap = {', 'const CALMER_COPY'));
const calmer = between(
  i18n,
  'const CALMER_COPY: Record<string, TranslationMap> = {',
  'const EXTENDED_COPY',
);
const extended = between(
  i18n,
  'const EXTENDED_COPY: Record<string, TranslationMap> = {',
  '@Injectable',
);

const calmerEnglish = keys(between(calmer, 'en: {', '  },\n  de: {'));
const calmerGerman = keys(between(calmer, 'de: {', '\n  },\n};'));
const extendedEnglish = keys(between(extended, 'en: {', '  },\n  de: {'));
const extendedGerman = keys(between(extended, 'de: {', '\n  },\n};'));

const translations = {
  en: merge(baseEnglish, calmerEnglish, extendedEnglish),
  de: merge(baseGerman, calmerGerman, extendedGerman),
};
const missing = [];

for (const language of ['en', 'de']) {
  for (const key of settingKeys) {
    if (!translations[language].has(`setting.${key}`)) {
      missing.push(`${language}: setting.${key}`);
    }
  }
  for (const key of sectionKeys) {
    if (!translations[language].has(`settings.${key}`)) {
      missing.push(`${language}: settings.${key}`);
    }
  }
}

if (missing.length > 0) {
  console.error('Missing settings translations:');
  for (const key of missing) console.error(`- ${key}`);
  process.exit(1);
}

console.log(
  `All ${settingKeys.length} settings and ${sectionKeys.length} sections are localized in English and German.`,
);
