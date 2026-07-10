/**
 * Slide Q&A bridge store
 *
 * Bridges the slide canvas (ScreenCanvas / SlideQuestionPopover) and the
 * playback engine (owned by PlaybackChromeRoot). The canvas lives deep in the
 * tree (Stage > PlaybackChromeRoot > scene-renderer > SlideEditor > ScreenCanvas),
 * so instead of prop-drilling we let:
 *   - ScreenCanvas call `openFor()` when the user clicks a slide element
 *   - PlaybackChromeRoot register the real `ask` / `onOpen` handlers via `setHandlers`
 *   - SlideQuestionPopover read `selected` and call `ask()` on submit
 */

import { create } from 'zustand';

export interface SlideQnaSelection {
  /** Slide element id (matches PPTElement.id and DOM `screen-element-${id}`). */
  elementId: string;
  /** Human-readable text snippet of the selected element (for the LLM prompt). */
  text: string;
  /** Viewport rect of the selected element, used to position the popover. */
  rect: DOMRect;
}

interface SlideQnaState {
  selected: SlideQnaSelection | null;
  /** Registered by PlaybackChromeRoot: routes the question into the interrupt flow. */
  ask: (question: string) => void;
  /** Registered by PlaybackChromeRoot: pauses playback when the popover opens. */
  onOpen: () => void;
  openFor: (sel: SlideQnaSelection) => void;
  close: () => void;
  setHandlers: (handlers: {
    ask: (question: string) => void;
    onOpen: () => void;
  }) => void;
}

export const useSlideQnaStore = create<SlideQnaState>((set, get) => ({
  selected: null,
  ask: () => {},
  onOpen: () => {},
  openFor: (sel) => {
    set({ selected: sel });
    // Fire the pause hook synchronously so narration stops while the user types.
    get().onOpen();
  },
  close: () => set({ selected: null }),
  setHandlers: ({ ask, onOpen }) => set({ ask, onOpen }),
}));
