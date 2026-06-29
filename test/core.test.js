import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  snapToHour,
  snapToDay,
  validateSystem,
  getCurrentSegment,
  resolveSchedule,
  getTeamColor,
  BUILTIN_SYSTEMS,
  getSystemById,
  availableSystems,
} from '../src/core/index.js';

const MIN = 60_000;
const HOUR = 3_600_000;

const TEAMS = [
  { name: 'Port', crew: ['Alice', 'Bob'] },
  { name: 'Starboard', crew: ['Carol', 'Dave'] },
  { name: 'Standby', crew: ['Erin'] },
];

test('snapToHour rounds to a whole local hour', () => {
  const at1420 = new Date(2026, 0, 1, 14, 20, 0).getTime();
  const at1440 = new Date(2026, 0, 1, 14, 40, 0).getTime();
  const at1400 = new Date(2026, 0, 1, 14, 0, 0).getTime();

  assert.equal(snapToHour(at1420, 'nearest'), at1400);
  assert.equal(snapToHour(at1440, 'nearest'), at1400 + HOUR);
  assert.equal(snapToHour(at1420, 'up'), at1400 + HOUR);
  assert.equal(snapToHour(at1420, 'down'), at1400);
  assert.equal(snapToHour(at1400, 'up'), at1400, 'already on the hour stays put');
  // result is always a whole hour
  assert.equal(new Date(snapToHour(at1420)).getMinutes(), 0);
});

test('every built-in system is valid', () => {
  for (const sys of BUILTIN_SYSTEMS) {
    const { valid, errors } = validateSystem(sys);
    assert.ok(valid, `${sys.id} invalid: ${errors.join('; ')}`);
  }
});

test('validateSystem catches gaps, bad teams, and wrong cycle length', () => {
  assert.equal(validateSystem({ id: 'x', teamCount: 2, cycleDuration: 480, segments: [
    { offset: 0, duration: 240, teamIndex: 0 },
    { offset: 300, duration: 240, teamIndex: 1 }, // gap: expected offset 240
  ] }).valid, false);

  assert.equal(validateSystem({ id: 'x', teamCount: 2, cycleDuration: 480, segments: [
    { offset: 0, duration: 240, teamIndex: 0 },
    { offset: 240, duration: 240, teamIndex: 5 }, // teamIndex out of range
  ] }).valid, false);

  assert.equal(validateSystem({ id: 'x', teamCount: 2, cycleDuration: 999, segments: [
    { offset: 0, duration: 240, teamIndex: 0 },
    { offset: 240, duration: 240, teamIndex: 1 },
  ] }).valid, false);
});

test('getCurrentSegment is null before start, finds the active segment otherwise', () => {
  const sys = getSystemById('fixed-4-4');
  const start = new Date(2026, 0, 1, 0, 0, 0).getTime();

  assert.equal(getCurrentSegment(sys, start, start - MIN), null);
  assert.equal(getCurrentSegment(sys, null, start), null);

  assert.equal(getCurrentSegment(sys, start, start + 30 * MIN).segment.teamIndex, 0);
  assert.equal(getCurrentSegment(sys, start, start + 5 * HOUR).segment.teamIndex, 1);
  // wraps into the next cycle
  const wrapped = getCurrentSegment(sys, start, start + 9 * HOUR);
  assert.equal(wrapped.segment.teamIndex, 0);
  assert.equal(wrapped.cycleIndex, 1);
});

test('resolveSchedule starts with the current shift and walks the rotation', () => {
  const sys = getSystemById('fixed-4-4');
  const start = new Date(2026, 0, 1, 0, 0, 0).getTime();
  const now = start + 30 * MIN;
  const shifts = resolveSchedule(sys, TEAMS, start, now, { count: 4 });

  assert.equal(shifts.length, 4);

  // first shift is the active one
  assert.equal(shifts[0].isCurrent, true);
  assert.equal(shifts[0].teamIndex, 0);
  assert.equal(shifts[0].teamName, 'Port');
  assert.deepEqual(shifts[0].crew, ['Alice', 'Bob']);
  assert.equal(shifts[0].startTime, start);
  assert.equal(shifts[0].endTime, start + 4 * HOUR);
  assert.equal(shifts[0].color, getTeamColor(0));

  // only one is current
  assert.equal(shifts.filter((s) => s.isCurrent).length, 1);

  // alternation + cycle wrap
  assert.deepEqual(shifts.map((s) => s.teamIndex), [0, 1, 0, 1]);
  assert.equal(shifts[2].startTime, start + 8 * HOUR);
  assert.equal(shifts[2].cycleIndex, 1);
});

test('resolveSchedule before start shows upcoming shifts with none current', () => {
  const sys = getSystemById('fixed-4-4');
  const start = new Date(2026, 0, 1, 12, 0, 0).getTime();
  const shifts = resolveSchedule(sys, TEAMS, start, start - HOUR, { count: 2 });
  assert.equal(shifts[0].startTime, start);
  assert.equal(shifts.some((s) => s.isCurrent), false);
});

test('snapToDay floors to local midnight', () => {
  const at1530 = new Date(2026, 0, 1, 15, 30, 0).getTime();
  const midnight = new Date(2026, 0, 1, 0, 0, 0).getTime();
  assert.equal(snapToDay(at1530), midnight);
  assert.equal(snapToDay(midnight), midnight, 'already at midnight stays put');
});

test('validateSystem rejects a non-boolean anchored flag', () => {
  const base = { id: 'x', teamCount: 1, cycleDuration: 60, segments: [{ offset: 0, duration: 60, teamIndex: 0 }] };
  assert.equal(validateSystem({ ...base, anchored: true }).valid, true);
  assert.equal(validateSystem({ ...base, anchored: 'yes' }).valid, false);
});

test('anchored systems align to clock hours regardless of start time', () => {
  const sys = getSystemById('rn-dog-watches');
  assert.equal(sys.anchored, true);
  // Started mid-afternoon at 15:00; the cycle is still anchored to midnight.
  const start = new Date(2026, 0, 1, 15, 0, 0).getTime();
  const now = start + 5 * MIN;
  const [first] = resolveSchedule(sys, TEAMS, start, now, { count: 1 });
  // The current watch is the clock-anchored Afternoon watch (12:00–16:00),
  // even though we started at 15:00.
  assert.equal(first.label, 'Afternoon');
  assert.equal(first.startTime, new Date(2026, 0, 1, 12, 0, 0).getTime());
  assert.equal(first.endTime, new Date(2026, 0, 1, 16, 0, 0).getTime());
  assert.equal(first.isCurrent, true);
});

test('rotating systems start the cycle from startedAt, not the clock', () => {
  const sys = getSystemById('fixed-4-4');
  assert.equal(sys.anchored, false);
  const start = new Date(2026, 0, 1, 15, 0, 0).getTime();
  const [first] = resolveSchedule(sys, TEAMS, start, start + 5 * MIN, { count: 1 });
  assert.equal(first.startTime, start, 'offset 0 lands exactly at startedAt');
});

test('dog watches flip teams on the second day', () => {
  const sys = getSystemById('rn-dog-watches');
  const start = new Date(2026, 0, 1, 0, 0, 0).getTime();

  // first watch of day 1 vs first watch of day 2 are opposite teams
  assert.equal(getCurrentSegment(sys, start, start + 30 * MIN).segment.teamIndex, 0);
  assert.equal(getCurrentSegment(sys, start, start + 24 * HOUR + 30 * MIN).segment.teamIndex, 1);
});

test('availableSystems shows only systems matching the configured team count', () => {
  // Exact match: a crew sees only systems that need exactly that many teams.
  for (const n of [2, 3, 4, 5]) {
    const avail = availableSystems(n);
    assert.ok(avail.length > 0, `expected built-in rotations for ${n} teams`);
    assert.ok(avail.every((s) => s.teamCount === n), `${n}-team crew sees only ${n}-team systems`);
  }

  // A two-team rotation must not leak into a three-team crew's list.
  assert.ok(!availableSystems(3).some((s) => s.id === 'fixed-4-4'));
});
