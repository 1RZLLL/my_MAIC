'use client';

import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { useSlideQnaStore } from '@/lib/store/slide-qna';
import { useCanvasStore } from '@/lib/store/canvas';

const POPOVER_WIDTH = 280;
const GAP = 8;

/**
 * In-place question popover for the click-to-ask flow.
 *
 * Rendered inside ScreenCanvas. When the user clicks a slide element,
 * `slideQna.selected` is set and this popover appears next to that element.
 * On submit it routes the question (with the element context) into the
 * playback interrupt flow via the registered `ask` handler.
 */
export function SlideQuestionPopover() {
  const selected = useSlideQnaStore((s) => s.selected);
  const ask = useSlideQnaStore((s) => s.ask);
  const close = useSlideQnaStore((s) => s.close);
  const clearHighlight = useCanvasStore((s) => s.clearHighlight);

  const [question, setQuestion] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset + focus whenever a new element is selected.
  useEffect(() => {
    if (selected) {
      setQuestion('');
      // Defer focus until after the popover mounts.
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [selected]);

  if (!selected) return null;

  const dismiss = () => {
    clearHighlight();
    close();
  };

  const submit = () => {
    const q = question.trim();
    if (!q) return;
    ask(q);
    clearHighlight();
    close();
  };

  const { rect } = selected;
  // Position below the element, clamped to the viewport.
  const top = Math.min(rect.bottom + GAP, window.innerHeight - 120);
  const left = Math.max(GAP, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - GAP));

  return (
    <>
      {/* Transparent backdrop: click outside to dismiss */}
      <div className="fixed inset-0 z-40" onClick={dismiss} />

      <div
        className="fixed z-50 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg p-2"
        style={{ top, left, width: POPOVER_WIDTH }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-1 pb-1.5 text-xs text-muted-foreground truncate">
          问关于「{selected.text}」
        </div>
        <div className="flex items-center gap-1.5">
          <input
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                dismiss();
              }
            }}
            placeholder="针对这里提问…"
            className="flex-1 h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2.5 text-sm text-gray-800 dark:text-gray-100 placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <button
            onClick={submit}
            disabled={!question.trim()}
            className="shrink-0 h-8 w-8 rounded-lg flex items-center justify-center bg-primary text-primary-foreground disabled:bg-muted disabled:text-muted-foreground/40 transition-colors"
            aria-label="发送"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </>
  );
}
