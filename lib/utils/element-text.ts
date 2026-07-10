/**
 * Client-safe plain-text extraction for a slide element (PPTElement).
 *
 * Mirrors the projection logic in lib/agent/tools/read-scene-content.ts but is
 * dependency-free so it can be imported into client components (the tool file
 * pulls server-only helpers). Used to build the "selected element" context for
 * the click-to-ask flow.
 */

import type { PPTElement } from '@openmaic/dsl';

const MAX_LEN = 80;

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(s: string): string {
  return s.length > MAX_LEN ? `${s.slice(0, MAX_LEN)}…` : s;
}

/** Chinese labels for element types that carry no meaningful text. */
const TYPE_LABELS: Record<string, string> = {
  image: '图片',
  chart: '图表',
  line: '线条',
  video: '视频',
  audio: '音频',
};

/**
 * Pull a short human-readable snippet out of a slide element. Falls back to a
 * type label (e.g. "图片") for elements with no text content.
 */
export function getElementText(el: PPTElement): string {
  const e = el as unknown as {
    type?: string;
    content?: unknown;
    text?: { content?: unknown };
    data?: unknown;
    lines?: unknown;
    latex?: unknown;
  };

  switch (e.type) {
    case 'text':
      return truncate(typeof e.content === 'string' ? stripHtml(e.content) : '');
    case 'shape':
      return truncate(typeof e.text?.content === 'string' ? stripHtml(e.text.content) : '图形');
    case 'table': {
      const rows = Array.isArray(e.data) ? (e.data as unknown[]) : [];
      const text = rows
        .flatMap((row) => (Array.isArray(row) ? (row as unknown[]) : []))
        .map((cell) => {
          const c = cell as { text?: unknown };
          return typeof c.text === 'string' ? stripHtml(c.text) : '';
        })
        .filter(Boolean)
        .join(' | ');
      return truncate(text || '表格');
    }
    case 'code': {
      const lines = Array.isArray(e.lines) ? (e.lines as unknown[]) : [];
      const text = lines
        .map((line) => {
          const l = line as { content?: unknown };
          return typeof l.content === 'string' ? l.content : '';
        })
        .join(' ')
        .trim();
      return truncate(text || '代码');
    }
    case 'latex':
      return truncate(typeof e.latex === 'string' ? e.latex.trim() : '公式');
    default:
      return TYPE_LABELS[e.type ?? ''] ?? '此处内容';
  }
}
