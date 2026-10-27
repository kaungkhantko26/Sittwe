/**
 * Thadingyut, the Festival of Lights, is held on the full moon of the
 * Myanmar month Thadingyut (October) and the days around it.
 *
 * This is an approximation, not the Myanmar calendar: it takes the first
 * astronomical full moon on or after 1 October (Myanmar time), using the mean
 * lunar month. For 2019 and 2021–2025 it lands on the official holiday or
 * one day after it, so the festival window is two days either side. Years
 * with an extra (intercalary) Myanmar month can differ by a whole month,
 * so players can also switch the festival on or off by hand.
 */

const SYNODIC_DAYS = 29.530588853;
/** A reference full moon: 2000-01-21 04:40 UTC. */
const REF_FULL_MOON = Date.UTC(2000, 0, 21, 4, 40);
const DAY = 86_400_000;
/** Myanmar Standard Time, UTC+6:30. */
const MMT = 6.5 * 3_600_000;

/** Myanmar-time calendar day number (days since 1970-01-01 in MMT). */
function mmtDay(t: number): number {
  return Math.floor((t + MMT) / DAY);
}

/** Approximate full moon of Thadingyut for a year (UTC timestamp). */
export function thadingyutFullMoon(year: number): Date {
  const oct1 = Date.UTC(year, 9, 1) - MMT; // 1 Oct 00:00 Myanmar time
  const k = Math.ceil((oct1 - REF_FULL_MOON) / (SYNODIC_DAYS * DAY));
  return new Date(REF_FULL_MOON + k * SYNODIC_DAYS * DAY);
}

/** True during the festival: the full-moon day and two days either side (Myanmar dates). */
export function isThadingyut(now: Date, windowDays = 2): boolean {
  const year = new Date(now.getTime() + MMT).getUTCFullYear();
  const day = mmtDay(now.getTime());
  return Math.abs(day - mmtDay(thadingyutFullMoon(year).getTime())) <= windowDays;
}

export type FestivalSetting = 'auto' | 'on' | 'off';

export function festivalActive(setting: FestivalSetting, now: Date): boolean {
  return setting === 'on' || (setting === 'auto' && isThadingyut(now));
}
