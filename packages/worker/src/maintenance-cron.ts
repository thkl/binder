type CronField = Set<number>;

const RANGES = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 6 },
] as const;

const WEEKDAYS = new Map([
  ['SUN', 0],
  ['MON', 1],
  ['TUE', 2],
  ['WED', 3],
  ['THU', 4],
  ['FRI', 5],
  ['SAT', 6],
]);

export class CronSchedule {
  private readonly fields: CronField[];

  constructor(expression: string) {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) throw new Error('Cron schedule must contain five fields');
    this.fields = parts.map((part, index) => this.parseField(part, RANGES[index], index === 4));
  }

  matches(date: Date, timezone: string): boolean {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    }).formatToParts(date);
    const values = new Map(parts.map((part) => [part.type, part.value]));
    const minute = Number(values.get('minute'));
    const hour = Number(values.get('hour'));
    const day = Number(values.get('day'));
    const month = Number(values.get('month'));
    const weekday = WEEKDAYS.get((values.get('weekday') ?? '').toUpperCase());
    if (weekday === undefined) return false;

    const dayMatches = this.fields[2].has(day);
    const weekdayMatches = this.fields[4].has(weekday);
    const dayFieldIsRestricted = this.fields[2].size < 31;
    const weekdayFieldIsRestricted = this.fields[4].size < 7;
    const calendarMatches =
      dayFieldIsRestricted && weekdayFieldIsRestricted
        ? dayMatches || weekdayMatches
        : dayMatches && weekdayMatches;

    return (
      this.fields[0].has(minute) &&
      this.fields[1].has(hour) &&
      this.fields[3].has(month) &&
      calendarMatches
    );
  }

  nextOccurrence(after: Date, timezone: string): Date | null {
    const start = new Date(Math.floor(after.getTime() / 60_000) * 60_000 + 60_000);
    for (let minute = 0; minute < 366 * 24 * 60; minute += 1) {
      const candidate = new Date(start.getTime() + minute * 60_000);
      if (this.matches(candidate, timezone)) return candidate;
    }
    return null;
  }

  private parseField(
    value: string,
    range: { min: number; max: number },
    weekday: boolean,
  ): CronField {
    const result = new Set<number>();
    for (const part of value.toUpperCase().split(',')) {
      const [rangePart, stepPart] = part.split('/');
      const step = stepPart ? Number(stepPart) : 1;
      if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid cron step '${part}'`);

      const [startText, endText] =
        rangePart === '*' ? [String(range.min), String(range.max)] : rangePart.split('-');
      const start = this.parseValue(startText, weekday);
      const end = this.parseValue(endText ?? startText, weekday);
      if (start < range.min || end > range.max || start > end)
        throw new Error(`Invalid cron range '${part}'`);

      for (let item = start; item <= end; item += step) result.add(item);
    }
    if (result.size === 0) throw new Error(`Empty cron field '${value}'`);
    return result;
  }

  private parseValue(value: string, weekday: boolean): number {
    if (weekday && WEEKDAYS.has(value)) return WEEKDAYS.get(value)!;
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) throw new Error(`Invalid cron value '${value}'`);
    return weekday && parsed === 7 ? 0 : parsed;
  }
}
