import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `#toast-root` is `pointer-events: none`, and that is right: a `toast()` is a
 * transient notice that must not swallow clicks on the map for the 2.2 seconds
 * it is up. But `pointer-events` inherits, so **anything interactive dropped
 * into that root has to turn it back on for itself**.
 *
 * `suggest()` did not, and both of its buttons were dead — the "Gộp lại" that
 * is the whole reason the bar exists, and the "Bỏ qua" that dismisses it. A
 * suggestion bar deliberately has no auto-dismiss ("một toast KHÔNG tự tắt, vì
 * nó hỏi một câu"), so a stuck one stays on screen for the rest of the session.
 * It reads as an element sitting under the canvas, and `z-index` is no help
 * because paint order is not hit testing.
 *
 * No type checker sees this and neither does a `vm` — jsdom has no layout and
 * resolves no `pointer-events`. So this is a source scan, the same shape as the
 * seam tests in `tests/game/spells/`: derive from `ui.js` which toast variants
 * carry a control, and require each one's CSS to re-enable pointer events.
 */

const EDITOR = resolve(__dirname, '../../public/map-editor');
const SOURCE = resolve(__dirname, '../../src/mapEditor');
const css = readFileSync(resolve(EDITOR, 'css/style.css'), 'utf8');
const ui = readFileSync(resolve(SOURCE, 'ui.ts'), 'utf8');

/** The declarations of the first rule whose selector list contains `selector`. */
function ruleBody(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[,}])\\s*${escaped}\\s*(,[^{]*)?\\{([^}]*)\\}`, 'm');
  return re.exec(css)?.[3] ?? null;
}

function declares(selector: string, prop: string, value: string): boolean {
  const body = ruleBody(selector);
  if (body === null) return false;
  return new RegExp(`${prop}\\s*:\\s*${value}\\s*(;|$)`).test(body);
}

/**
 * Every `function name(...)` in `ui.js` that appends into `#toast-root`, paired
 * with the `class:` string it builds its element from and whether it creates a
 * control the user is meant to press.
 */
function toastVariants(): { fn: string; className: string; interactive: boolean }[] {
  const out: { fn: string; className: string; interactive: boolean }[] = [];
  const heads = [...ui.matchAll(/^\s*function\s+(\w+)\s*\(/gm)];
  heads.forEach((head, i) => {
    const start = head.index!;
    const end = i + 1 < heads.length ? heads[i + 1].index! : ui.length;
    const body = ui.slice(start, end);
    if (!body.includes('#toast-root')) return;
    const cls = /class:\s*"toast([^"]*)"/.exec(body);
    if (!cls) return;
    out.push({
      fn: head[1],
      className: `.toast${cls[1].trim().split(/\s+/).filter(Boolean).map((c) => `.${c}`).join('')}`,
      interactive: /el\(\s*"button"/.test(body) || /onclick\s*:/.test(body),
    });
  });
  return out;
}

describe('map editor: pointer events inside #toast-root', () => {
  it('keeps the root itself non-interactive, so a passing toast never eats a click', () => {
    expect(declares('#toast-root', 'pointer-events', 'none')).toBe(true);
  });

  it('finds the toast variants ui.js actually builds', () => {
    const variants = toastVariants();
    expect(variants.map((v) => v.fn).sort()).toEqual(['suggest', 'toast']);
    expect(variants.find((v) => v.fn === 'suggest')).toMatchObject({
      className: '.toast.suggest',
      interactive: true,
    });
    expect(variants.find((v) => v.fn === 'toast')!.interactive).toBe(false);
  });

  it('re-enables pointer events on every toast variant that carries a control', () => {
    const dead = toastVariants()
      .filter((v) => v.interactive)
      .filter((v) => !declares(v.className, 'pointer-events', 'auto'));

    expect(
      dead.map((v) => `${v.className} (built by ${v.fn}()) inherits pointer-events:none`),
    ).toEqual([]);
  });
});
