import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initiativeSchema,
  momentInputSchema,
  musicCommentInputSchema,
  providerModelsInputSchema,
} from '../packages/shared/dist/index.js';

test('initiative defaults are conservative', () => {
  const value = initiativeSchema.parse({});
  assert.equal(value.enabled, false);
  assert.equal(value.level, 'normal');
  assert.equal(value.dailyCap, 3);
  assert.equal(value.allowMoments, false);
  assert.equal(value.momentsPerDay, 1);
});

test('initiative rejects impossible caps and quiet-hour format', () => {
  assert.equal(initiativeSchema.safeParse({ dailyCap: 0 }).success, false);
  assert.equal(initiativeSchema.safeParse({ quietStart: '25:00' }).success, false);
});

test('moment input trims and validates content', () => {
  const value = momentInputSchema.parse({ content: '  今天很好  ', images: [] });
  assert.equal(value.content, '今天很好');
  assert.equal(momentInputSchema.safeParse({ content: '   ' }).success, false);
  assert.equal(momentInputSchema.safeParse({ content: 'x', images: ['1', '2', '3', '4', '5'] }).success, false);
});

test('music comment input applies defaults', () => {
  const value = musicCommentInputSchema.parse({
    characterId: 'c1',
    trackId: 't1',
    title: '歌',
  });
  assert.equal(value.reason, 'start');
  assert.equal(value.positionMs, 0);
  assert.equal(value.lyric, '');
});

test('provider models input needs a real url and known kind', () => {
  const value = providerModelsInputSchema.parse({
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
  });
  assert.equal(value.apiKey, undefined);
  assert.equal(providerModelsInputSchema.safeParse({ kind: 'openai', baseUrl: 'nope' }).success, false);
  assert.equal(
    providerModelsInputSchema.safeParse({ kind: 'claude', baseUrl: 'https://api.anthropic.com' })
      .success,
    false,
  );
});
