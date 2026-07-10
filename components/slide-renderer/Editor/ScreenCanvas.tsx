'use client';

import { ScreenElement } from './ScreenElement';
import { HighlightOverlay } from './HighlightOverlay';
import { SpotlightOverlay } from './SpotlightOverlay';
import { LaserOverlay } from './LaserOverlay';
import { SlideQuestionPopover } from '@/components/stage/SlideQuestionPopover';
import { getElementText } from '@/lib/utils/element-text';
import { useSlideQnaStore } from '@/lib/store/slide-qna';
import { useSlideBackgroundStyle } from '@/lib/hooks/use-slide-background-style';
import { useCanvasStore } from '@/lib/store';
import { useSceneSelector } from '@/lib/contexts/scene-context';
import { findElementGeometry } from '@/lib/utils/geometry';
import type { SlideContent } from '@/lib/types/stage';
import type { PPTElement, SlideBackground } from '@openmaic/dsl';
import type { PercentageGeometry } from '@/lib/types/action';
import { useViewportSize } from './Canvas/hooks/useViewportSize';
import { useRef, useMemo } from 'react';
import { AnimatePresence } from 'motion/react';

export function ScreenCanvas() {
  const canvasScale = useCanvasStore.use.canvasScale();
  const elements = useSceneSelector<SlideContent, PPTElement[]>(
    (content) => content.canvas.elements,
  );
  const canvasRef = useRef<HTMLDivElement>(null);

  // Viewport size and positioning
  const { viewportStyles } = useViewportSize(canvasRef);

  // Get background style
  const background = useSceneSelector<SlideContent, SlideBackground | undefined>(
    (content) => content.canvas.background,
  );
  const { backgroundStyle } = useSlideBackgroundStyle(background);

  // Get visual effect state
  const laserElementId = useCanvasStore.use.laserElementId();
  const laserOptions = useCanvasStore.use.laserOptions();
  const zoomTarget = useCanvasStore.use.zoomTarget();

  // Compute laser pointer geometry
  const laserGeometry = useMemo<PercentageGeometry | null>(() => {
    if (!laserElementId) return null;
    const element = elements.find((el) => el.id === laserElementId);
    if (!element) return null;
    return findElementGeometry(
      { type: 'slide', content: { canvas: { elements } } } as Record<string, unknown>,
      laserElementId,
    );
  }, [laserElementId, elements]);

  // Compute zoom target geometry
  const zoomGeometry = useMemo<PercentageGeometry | null>(() => {
    if (!zoomTarget) return null;
    const element = elements.find((el) => el.id === zoomTarget.elementId);
    if (!element) return null;
    return findElementGeometry(
      { type: 'slide', content: { canvas: { elements } } } as Record<string, unknown>,
      zoomTarget.elementId,
    );
  }, [zoomTarget, elements]);

  // Click-to-ask: clicking a slide element opens the in-place question popover.
  const handleElementClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest('[data-element-id]');
    if (!target) return;
    const elementId = target.getAttribute('data-element-id');
    if (!elementId) return;
    const element = elements.find((el) => el.id === elementId);
    if (!element) return;
    useCanvasStore.getState().setHighlight([elementId]);
    useSlideQnaStore.getState().openFor({
      elementId,
      text: getElementText(element),
      rect: target.getBoundingClientRect(),
    });
  };

  return (
    <div className="relative h-full w-full overflow-hidden select-none" ref={canvasRef}>
      <div
        className="absolute shadow-[0_0_0_1px_rgba(0,0,0,0.01),0_0_12px_0_rgba(0,0,0,0.1)] rounded-lg overflow-hidden transition-transform duration-700"
        style={{
          width: `${viewportStyles.width * canvasScale}px`,
          height: `${viewportStyles.height * canvasScale}px`,
          left: `${viewportStyles.left}px`,
          top: `${viewportStyles.top}px`,
          ...(zoomTarget && zoomGeometry
            ? {
                transform: `scale(${zoomTarget.scale})`,
                transformOrigin: `${zoomGeometry.centerX}% ${zoomGeometry.centerY}%`,
              }
            : {}),
        }}
      >
        {/* Background layer */}
        <div
          className="w-full h-full bg-position-center rounded-lg"
          style={{ ...backgroundStyle }}
        ></div>

        {/* Content layer - scaled */}
        <div
          className="absolute top-0 left-0 origin-top-left cursor-pointer"
          style={{
            width: `${viewportStyles.width}px`,
            height: `${viewportStyles.height}px`,
            transform: `scale(${canvasScale})`,
          }}
          onClick={handleElementClick}
        >
          {elements.map((element, index) => (
            <ScreenElement key={element.id} elementInfo={element} elementIndex={index + 1} />
          ))}

          {/* Highlight overlay - stacked above elements */}
          <HighlightOverlay />
        </div>

        {/* Spotlight overlay - covers the entire slide, positioned via DOM measurement */}
        <SpotlightOverlay />

        {/* Visual effects layer - outside the scale layer, using percentage coordinates */}
        <div className="absolute inset-0 pointer-events-none" style={{ padding: '5%' }}>
          <div className="relative w-full h-full">
            {/* Laser pointer overlay */}
            <AnimatePresence>
              {laserElementId && laserGeometry && (
                <LaserOverlay
                  key={`laser-${laserElementId}`}
                  geometry={laserGeometry}
                  color={laserOptions?.color}
                  duration={laserOptions?.duration}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Click-to-ask in-place question popover */}
      <SlideQuestionPopover />
    </div>
  );
}
