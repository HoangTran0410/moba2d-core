import { describe, expect, it } from 'vitest';
import { packUsage } from '@/scenes/packs/packUsage';

/**
 * The five things an installed row can truthfully say about a pack's bytes.
 *
 * Reported from a real install: the row said `83 tệp · ~168 KB` while 4.7MB
 * was still arriving, the player read that as the pack's total size, came back
 * later to a bigger number, and had no way to know a download had ever been
 * running. A numerator with no denominator and no verb is the whole bug — so
 * what is pinned here is the *stage*, not the wording, and the one wording
 * rule that matters: whenever a denominator is known, the sentence carries it.
 *
 * `packUsage` is a plain module rather than a method inside
 * `PacksScene.vue`'s `<script setup>` for exactly this reason: `<script
 * setup>` is the setup function (CLAUDE.md) and there is no way to reach one
 * of its consts from a test, and this suite has no DOM to mount a component
 * into.
 */
describe('packUsage', () => {
  it('says it is still measuring before the cache has answered', () => {
    const usage = packUsage({ entries: -1, bytes: 0 });
    expect(usage.stage).toBe('measuring');
  });

  it('says a download is running, with both halves of the fraction', () => {
    const usage = packUsage({
      entries: -1,
      bytes: 0,
      fileCount: 83,
      progress: { total: 83, done: 41, active: true },
    });
    expect(usage.stage).toBe('downloading');
    expect(usage.done).toBe(41);
    expect(usage.total).toBe(83);
    expect(usage.label).toContain('41/83');
  });

  it('prefers a live download over an unmeasured cache', () => {
    // The order these two arrive in is the install path: the row is added the
    // instant `installPackNow` returns, the prefetch is already running, and
    // `packCacheUsage` answers a round trip later. Reading `entries` first
    // would show "Đang xem dung lượng đã lưu…" over a live download.
    const usage = packUsage({
      entries: -1,
      bytes: 0,
      progress: { total: 12, done: 0, active: true },
    });
    expect(usage.stage).toBe('downloading');
  });

  it('says the pack is fully saved once nothing is left to fetch', () => {
    const usage = packUsage({
      entries: 84,
      bytes: 1_200_000,
      fileCount: 83,
      progress: { total: 83, done: 83, active: false },
    });
    expect(usage.stage).toBe('ready');
    expect(usage.label).toContain('83 tệp');
    expect(usage.label).toContain('~1.1 MB');
  });

  it('says a pack that declares no files saves nothing, rather than looking broken', () => {
    // Real and reachable: a manifest with no `files` installs and plays and
    // prefetches nothing, which is what the shipped default pack does.
    const usage = packUsage({ entries: 1, bytes: 400, fileCount: 0 });
    expect(usage.stage).toBe('empty');
    expect(usage.total).toBe(0);
  });

  it('says a stopped download is stopped, and how far it got', () => {
    const usage = packUsage({
      entries: 41,
      bytes: 168 * 1024,
      fileCount: 83,
      progress: { total: 83, done: 41, active: false },
    });
    expect(usage.stage).toBe('partial');
    expect(usage.label).toContain('41/83');
  });

  it('uses the persisted count as the denominator when no prefetch ran this session', () => {
    // The in-memory record dies with the page; `fileCount` is what survives a
    // reload, and without it this row is back to a bare numerator.
    const usage = packUsage({ entries: 41, bytes: 168 * 1024, fileCount: 83 });
    expect(usage.stage).toBe('partial');
    expect(usage.total).toBe(83);
    expect(usage.label).toContain('41/83');
  });

  it('counts a cache holding more entries than the manifest declared as complete', () => {
    // `packCacheUsage` counts every entry under the base, and the pinned
    // manifest is one of them — so a complete pack measures `files.length + 1`
    // and must not read as "still downloading" forever.
    const usage = packUsage({ entries: 84, bytes: 1_200_000, fileCount: 83 });
    expect(usage.stage).toBe('ready');
  });

  it('falls back to the old bare count for a record written before fileCount existed', () => {
    const usage = packUsage({ entries: 83, bytes: 168 * 1024 });
    expect(usage.stage).toBe('unknown');
    expect(usage.label).toContain('83 tệp');
    expect(usage.total).toBe(-1);
  });

  it('has no bar to draw without a denominator', () => {
    expect(packUsage({ entries: 83, bytes: 1000 }).ratio).toBe(-1);
    expect(packUsage({ entries: -1, bytes: 0 }).ratio).toBe(-1);
  });

  it('never reports a ratio outside 0..1', () => {
    const over = packUsage({ entries: 200, bytes: 0, fileCount: 83 });
    expect(over.ratio).toBe(1);
    const under = packUsage({
      entries: -1,
      bytes: 0,
      progress: { total: 83, done: 0, active: true },
    });
    expect(under.ratio).toBe(0);
  });

  it('marks the size approximate, because content-length is a floor', () => {
    const usage = packUsage({ entries: 41, bytes: 168 * 1024, fileCount: 83 });
    expect(usage.label).toContain('~168 KB');
  });
});
