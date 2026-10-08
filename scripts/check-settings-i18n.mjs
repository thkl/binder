import { readFile } from 'node:fs/promises';

const constants = await readFile(
  new URL('../packages/api/src/features/settings/models/constants.ts', import.meta.url),
  'utf8',
);

const catalogs = Object.fromEntries(
  await Promise.all(
    ['en', 'de'].map(async (language) => {
      const catalog = JSON.parse(
        await readFile(
          new URL(
            `../packages/api/src/features/localization/catalogs/${language}.json`,
            import.meta.url,
          ),
          'utf8',
        ),
      );
      return [language, new Set(Object.keys(catalog.translations))];
    }),
  ),
);

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`Unable to locate ${start} … ${end}`);
  }
  return source.slice(startIndex + start.length, endIndex);
}

const settingsMap = between(constants, 'export const settingsMap: SettingsMapItem[] = [', '];');
const settingKeys = [...settingsMap.matchAll(/\n\s+key: '([^']+)'/g)].map((match) => match[1]);

const settingsSections = between(
  constants,
  'export const settingsSections: SettingsSection[] = [',
  '];',
);
const sectionKeys = [...settingsSections.matchAll(/\n\s+key: '([^']+)'/g)].map((match) => match[1]);
const missing = [];

for (const language of ['en', 'de']) {
  for (const key of settingKeys) {
    if (!catalogs[language].has(`setting.${key}`)) {
      missing.push(`${language}: setting.${key}`);
    }
  }
  for (const key of sectionKeys) {
    if (!catalogs[language].has(`settings.${key}`)) {
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
