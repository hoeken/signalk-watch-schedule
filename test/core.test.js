import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  snapToHour,
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
  { id: 'team1', name: 'Port', crew: ['Alice', 'Bob'] },
  { id: 'team2', name: 'Starboard', crew: ['Carol', 'Dave'] },
  { id: 'team3', name: 'Standby', crew: ['Erin'] },
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

test('dog watches flip teams on the second day', () => {
  const sys = getSystemById('rn-dog-watches');
  const start = new Date(2026, 0, 1, 0, 0, 0).getTime();

  // first watch of day 1 vs first watch of day 2 are opposite teams
  assert.equal(getCurrentSegment(sys, start, start + 30 * MIN).segment.teamIndex, 0);
  assert.equal(getCurrentSegment(sys, start, start + 24 * HOUR + 30 * MIN).segment.teamIndex, 1);
});

test('availableSystems filters by configured team count', () => {
  const forTwo = availableSystems(2);
  assert.ok(forTwo.every((s) => s.teamCount <= 2));
  assert.ok(!forTwo.some((s) => s.id === 'swedish-5'), 'swedish needs 3 teams');

  const forThree = availableSystems(3);
  assert.ok(forThree.some((s) => s.id === 'swedish-5'));

  const custom = [{ id: 'c1', name: 'Custom', teamCount: 2, cycleDuration: 60, segments: [{ offset: 0, duration: 60, teamIndex: 0 }] }];
  assert.ok(availableSystems(2, custom).some((s) => s.id === 'c1'));
});
