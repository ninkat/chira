import { Point } from '@/types/types';
import { minEnclosingCircle, getLandmarkPosition } from '@/utils/mathUtils';
import {
  NormalizedLandmark,
  GestureRecognizerResult,
} from '@mediapipe/tasks-vision';
import { CanvasDimensions } from '@/types/types';
import {
  InteractionEventHandler,
  InteractionPoint,
} from '@/types/interactionTypes';
import {
  drawOneGestureFeedback,
  drawGrabbingGestureFeedback,
  drawGrabbingHoverPoint,
  drawThumbIndexGestureFeedback,
  drawOkGestureFeedback,
  drawZoomFeedback,
  drawFistGestureFeedback,
} from '@/utils/drawingUtils';

// converts a mediapipe landmark to our interaction point format
// this handles the coordinate space conversion from normalized (0-1) to pixel space
// and calculates both canvas and client coordinates
function landmarkToInteractionPoint(
  landmark: NormalizedLandmark,
  dimensions: CanvasDimensions,
  rect: DOMRect
): InteractionPoint {
  const canvasX = landmark.x * dimensions.width;
  const canvasY = landmark.y * dimensions.height;
  return {
    x: canvasX,
    y: canvasY,
    clientX: rect.left + (dimensions.width - canvasX),
    clientY: rect.top + canvasY,
  };
}

// state for tracking hover elements for each hand
let lastHoveredElementRight: Element | null = null;
let lastHoveredElementLeft: Element | null = null;

// state for tracking the last selected element in fine select mode per hand
const lastSelectedElementByHand: {
  left: Element | null;
  right: Element | null;
} = {
  left: null,
  right: null,
};

// state for tracking currently hovered elements for circle hover
const hoveredElementsByHand = {
  left: new Set<Element>(),
  right: new Set<Element>(),
};

// state machine for tracking clicks (thumb_index to one gesture)
type GestureState = 'idle' | 'potential_click';
interface GestureClickState {
  state: GestureState;
  startTime: number;
  startElement: Element | null;
  point: InteractionPoint | null;
}

// click gesture state tracking per hand
const gestureClickState: {
  left: GestureClickState;
  right: GestureClickState;
} = {
  left: {
    state: 'idle',
    startTime: 0,
    startElement: null,
    point: null,
  },
  right: {
    state: 'idle',
    startTime: 0,
    startElement: null,
    point: null,
  },
};

// time constraint for the click gesture (thumb_index → one) in milliseconds
const CLICK_GESTURE_TIME_CONSTRAINT = 200;

// transform state management
let currentTransform = {
  scale: 1,
  x: 0,
  y: 0,
};

const zoomState = {
  startCenter: null as Point | null,
  lastDistance: null as number | null,
  fixedPoint: null as Point | null,
};

// state for tracking drag operations per hand
const fineSelectDragState = {
  left: {
    element: null as Element | null,
    active: false,
    startX: 0,
    startY: 0,
    gestureStartedInsideBox: false,
  },
  right: {
    element: null as Element | null,
    active: false,
    startX: 0,
    startY: 0,
    gestureStartedInsideBox: false,
  },
};

// track when transitioning from two hands to one hand to prevent jumps
let wasZooming = false;
let lastZoomCenter: Point | null = null;
let lastHandCount = 0; // track the number of hands with gesture
let initialDragPosition: Point | null = null; // track initial position for smooth transition
let transitionInProgress = false; // track if we're in the middle of a transition

// helper function to check if element is interactable
// covers all common svg elements typically used in d3 visualizations
// note: we don't do text or 'g' because they intercept the event instead of the child elements
function isInteractableElement(element: Element | null): boolean {
  if (!element) return false;

  // check if element is any svg element
  const isSvgElement = element instanceof SVGElement;

  // list of common interactive svg elements used in d3
  const interactableSvgElements = [
    'circle', // nodes, points, bubbles
    'rect', // bars, boxes
    'path', // lines, curves, custom shapes
    'polyline', // connected lines
    'ellipse', // oval shapes
  ];

  return (
    isSvgElement &&
    interactableSvgElements.includes(element.tagName.toLowerCase())
  );
}

// handles "one" gesture (replaces neutral mode)
// uses index finger (landmark 8) as pointer for hover interactions
export function handleOne(
  ctx: CanvasRenderingContext2D,
  results: GestureRecognizerResult,
  rect: DOMRect,
  dimensions: CanvasDimensions,
  onInteraction: InteractionEventHandler,
  drawOnly = false
): void {
  if (
    !results.landmarks?.length ||
    !results.handedness?.length ||
    !results.gestures?.length
  ) {
    return;
  }

  // process each hand
  results.handedness.forEach((hand, index) => {
    const handLabel = hand[0].displayName.toLowerCase() as 'left' | 'right';
    const gesture = results.gestures![index][0].categoryName;
    const clickState = gestureClickState[handLabel];
    const now = Date.now();

    // only process hovering if gesture is "one"
    if (gesture !== 'one') {
      // for any other gesture, check if we need to expire a potential click
      if (!drawOnly && clickState.state === 'potential_click') {
        const elapsedTime = now - clickState.startTime;

        // if we exceeded the time constraint, reset the click state
        if (elapsedTime > CLICK_GESTURE_TIME_CONSTRAINT) {
          clickState.state = 'idle';
          clickState.startElement = null;
          clickState.point = null;
        }
      }
      return;
    }

    const landmarks = results.landmarks![index];

    // get index fingertip position
    const indexTip = landmarks[8];
    const point = landmarkToInteractionPoint(indexTip, dimensions, rect);

    // if we were in potential click state and now see "one", complete the click gesture
    if (!drawOnly && clickState.state === 'potential_click') {
      const elapsedTime = now - clickState.startTime;

      // check if the transition happened within the time constraint
      if (
        elapsedTime <= CLICK_GESTURE_TIME_CONSTRAINT &&
        clickState.startElement
      ) {
        // get current element at position to verify we're still over the same element
        const currentElement = document.elementFromPoint(
          point.clientX,
          point.clientY
        );
        const isSameElement = currentElement === clickState.startElement;

        // complete click if we're on the same element or close enough
        if (isSameElement && clickState.point) {
          onInteraction({
            type: 'pointerselect',
            point: clickState.point, // use the original point from thumb_index
            timestamp: now,
            sourceType: 'gesture',
            handedness: handLabel,
            element: clickState.startElement,
          });
        }
      }

      // reset click state after handling
      clickState.state = 'idle';
      clickState.startElement = null;
      clickState.point = null;
    }

    // handle hover state based on hand if not in drawOnly mode
    if (!drawOnly) {
      // get element at current position
      const currentElement = document.elementFromPoint(
        point.clientX,
        point.clientY
      );

      if (handLabel === 'right') {
        // handle right hand hover
        if (currentElement !== lastHoveredElementRight && currentElement) {
          // send pointerout to previous element
          if (lastHoveredElementRight) {
            onInteraction({
              type: 'pointerout',
              point,
              timestamp: Date.now(),
              sourceType: 'gesture',
              handedness: 'right',
              element: lastHoveredElementRight,
            });
          }

          // send pointerover to new element
          if (isInteractableElement(currentElement)) {
            onInteraction({
              type: 'pointerover',
              point,
              timestamp: Date.now(),
              sourceType: 'gesture',
              handedness: 'right',
              element: currentElement,
            });
          }

          // update right hand hover state
          lastHoveredElementRight = currentElement;
        }
      } else {
        // handle left hand hover
        if (currentElement !== lastHoveredElementLeft && currentElement) {
          // send pointerout to previous element
          if (lastHoveredElementLeft) {
            onInteraction({
              type: 'pointerout',
              point,
              timestamp: Date.now(),
              sourceType: 'gesture',
              handedness: 'left',
              element: lastHoveredElementLeft,
            });
          }

          // send pointerover to new element
          if (isInteractableElement(currentElement)) {
            onInteraction({
              type: 'pointerover',
              point,
              timestamp: Date.now(),
              sourceType: 'gesture',
              handedness: 'left',
              element: currentElement,
            });
          }

          // update left hand hover state
          lastHoveredElementLeft = currentElement;
        }
      }
    }

    // draw visual feedback using the drawing utility
    drawOneGestureFeedback(ctx, point);
  });
}

// handles "grabbing" gesture (replaces coarse hover mode)
// calculates the minimum enclosing circle around all fingertips
// and sends pointerover events to elements within that area
export function handleGrabbing(
  ctx: CanvasRenderingContext2D,
  results: GestureRecognizerResult,
  rect: DOMRect,
  dimensions: CanvasDimensions,
  onInteraction: InteractionEventHandler,
  drawOnly = false
): void {
  if (
    !results.landmarks?.length ||
    !results.handedness?.length ||
    !results.gestures?.length
  ) {
    return;
  }

  // process each hand
  results.handedness.forEach((hand, index) => {
    const handLabel = hand[0].displayName.toLowerCase() as 'left' | 'right';
    const gesture = results.gestures![index][0].categoryName;

    // only process if gesture is "grabbing"
    if (gesture !== 'grabbing') {
      // if the gesture is no longer grabbing, clear all hover states for this hand
      if (!drawOnly) {
        const currentlyHovered = hoveredElementsByHand[handLabel];
        if (currentlyHovered.size > 0) {
          // send pointerout for each element
          Array.from(currentlyHovered).forEach((element) => {
            if (isInteractableElement(element)) {
              // use the center of the element as the pointer position
              const elementRect = element.getBoundingClientRect();
              const point: InteractionPoint = {
                x: 0,
                y: 0,
                clientX: elementRect.left + elementRect.width / 2,
                clientY: elementRect.top + elementRect.height / 2,
              };

              onInteraction({
                type: 'pointerout',
                point,
                timestamp: Date.now(),
                sourceType: 'gesture',
                handedness: handLabel,
                element, // explicitly pass the element to ensure proper cleanup
              });
            }
          });
          currentlyHovered.clear();
        }
      }
      return;
    }

    const landmarks = results.landmarks![index];

    // get all fingertip positions (thumb and all fingers)
    const tipIndices = [4, 8, 12, 16, 20];
    const tipPoints: Point[] = tipIndices.map((i) => ({
      x: landmarks[i].x * dimensions.width,
      y: landmarks[i].y * dimensions.height,
    }));

    // calculate the minimum circle that encloses all fingertips
    const circle = minEnclosingCircle(tipPoints);

    if (circle && circle.radius > 0) {
      // draw visual feedback for the hover area
      drawGrabbingGestureFeedback(ctx, circle);

      if (!drawOnly) {
        // find all elements within the circle
        const elementsInCircle = new Set<Element>();
        // increase sampling density by using a smaller grid size
        // original: const gridSize = Math.max(5, Math.floor(circle.radius / 20));
        const gridSize = Math.max(10, Math.floor(circle.radius / 10)); // doubled grid size for more points
        const step = (circle.radius * 2) / gridSize; // smaller step size

        // add additional sampling points by using a denser grid
        for (let x = -circle.radius; x <= circle.radius; x += step) {
          for (let y = -circle.radius; y <= circle.radius; y += step) {
            if (x * x + y * y <= circle.radius * circle.radius) {
              const point: InteractionPoint = {
                x: circle.center.x + x,
                y: circle.center.y + y,
                clientX: rect.left + (dimensions.width - (circle.center.x + x)),
                clientY: rect.top + (circle.center.y + y),
              };

              const element = document.elementFromPoint(
                point.clientX,
                point.clientY
              );
              if (element && isInteractableElement(element)) {
                elementsInCircle.add(element);

                // draw hover point feedback with the drawing utility
                drawGrabbingHoverPoint(ctx, point);
              }
            }
          }
        }

        // get arrays of elements to start and end hovering
        const currentlyHovered = hoveredElementsByHand[handLabel];
        const elementsToStartHovering = Array.from(elementsInCircle).filter(
          (element) => !currentlyHovered.has(element)
        );
        const elementsToStopHovering = Array.from(currentlyHovered).filter(
          (element) => !elementsInCircle.has(element)
        );

        // send hover events (using pointerover/pointerout for simplicity)
        if (elementsToStartHovering.length > 0) {
          // Only dispatch if there are interactable elements
          const interactableElements = elementsToStartHovering.filter(
            isInteractableElement
          );
          if (interactableElements.length > 0) {
            // send pointerover for each element instead of coarsehoverstart
            interactableElements.forEach((element) => {
              // use the center of the element as the pointer position
              const elementRect = element.getBoundingClientRect();
              const point: InteractionPoint = {
                x: circle.center.x, // use circle center for x
                y: circle.center.y, // use circle center for y
                clientX: elementRect.left + elementRect.width / 2,
                clientY: elementRect.top + elementRect.height / 2,
              };

              onInteraction({
                type: 'pointerover',
                point,
                timestamp: Date.now(),
                sourceType: 'gesture',
                handedness: handLabel,
                element, // explicitly pass the element for better tracking
              });
            });
          }
        }

        if (elementsToStopHovering.length > 0) {
          // Only dispatch if there are interactable elements
          const interactableElements = elementsToStopHovering.filter(
            isInteractableElement
          );
          if (interactableElements.length > 0) {
            // send pointerout for each element instead of coarsehoverend
            interactableElements.forEach((element) => {
              // use the center of the element as the pointer position
              const elementRect = element.getBoundingClientRect();
              const point: InteractionPoint = {
                x: circle.center.x, // use circle center for x
                y: circle.center.y, // use circle center for y
                clientX: elementRect.left + elementRect.width / 2,
                clientY: elementRect.top + elementRect.height / 2,
              };

              onInteraction({
                type: 'pointerout',
                point,
                timestamp: Date.now(),
                sourceType: 'gesture',
                handedness: handLabel,
                element, // explicitly pass the element to ensure proper cleanup
              });
            });
          }
        }

        // update hover state with only interactable elements
        hoveredElementsByHand[handLabel] = new Set(
          Array.from(elementsInCircle).filter(isInteractableElement)
        );
      }
    } else if (!drawOnly) {
      const currentlyHovered = hoveredElementsByHand[handLabel];
      if (currentlyHovered.size > 0) {
        // send pointerout for each element instead of coarsehoverend
        Array.from(currentlyHovered).forEach((element) => {
          if (isInteractableElement(element)) {
            // use the center of the element as the pointer position
            const elementRect = element.getBoundingClientRect();
            const point: InteractionPoint = {
              x: 0, // we don't have circle data here, so use default
              y: 0,
              clientX: elementRect.left + elementRect.width / 2,
              clientY: elementRect.top + elementRect.height / 2,
            };

            onInteraction({
              type: 'pointerout',
              point,
              timestamp: Date.now(),
              sourceType: 'gesture',
              handedness: handLabel,
              element, // explicitly pass the element to ensure proper cleanup
            });
          }
        });
        currentlyHovered.clear();
      }
    }
  });
}

// handles thumb_index gesture for precise selection, tracking selection per hand
export function handleThumbIndex(
  ctx: CanvasRenderingContext2D,
  results: GestureRecognizerResult,
  rect: DOMRect,
  dimensions: CanvasDimensions,
  onInteraction: InteractionEventHandler,
  drawOnly = false
): void {
  if (
    !results.landmarks?.length ||
    !results.handedness?.length ||
    !results.gestures?.length
  ) {
    // clear selection state if no hands are detected
    if (!drawOnly) {
      lastSelectedElementByHand.left = null;
      lastSelectedElementByHand.right = null;
    }
    return;
  }

  // process each hand
  results.handedness.forEach((hand, index) => {
    const handLabel = hand[0].displayName.toLowerCase() as 'left' | 'right';
    const gesture = results.gestures![index][0].categoryName;
    const clickState = gestureClickState[handLabel];
    const now = Date.now();

    const landmarks = results.landmarks![index];
    const indexTip = landmarks[8];
    const point = landmarkToInteractionPoint(indexTip, dimensions, rect);

    if (gesture === 'thumb_index') {
      // draw visual indicator using the drawing utility
      drawThumbIndexGestureFeedback(ctx, point);

      // handle gesture state tracking if not in drawOnly mode
      if (!drawOnly) {
        // get element at current position
        const element = document.elementFromPoint(point.clientX, point.clientY);
        const interactableElement = isInteractableElement(element)
          ? element
          : null;

        // if we're in idle state and see thumb_index, start potential click
        if (clickState.state === 'idle' && interactableElement) {
          clickState.state = 'potential_click';
          clickState.startTime = now;
          clickState.startElement = interactableElement;
          clickState.point = { ...point };
        }
      }
    } else if (gesture === 'one') {
      // if we were in potential click state and now see "one", complete the click gesture
      if (!drawOnly && clickState.state === 'potential_click') {
        const elapsedTime = now - clickState.startTime;

        // check if the transition happened within the time constraint
        if (
          elapsedTime <= CLICK_GESTURE_TIME_CONSTRAINT &&
          clickState.startElement
        ) {
          // get current element at position to verify we're still over the same element
          const currentElement = document.elementFromPoint(
            point.clientX,
            point.clientY
          );
          const isSameElement = currentElement === clickState.startElement;

          // complete click if we're on the same element or close enough
          if (isSameElement && clickState.point) {
            onInteraction({
              type: 'pointerselect',
              point: clickState.point, // use the original point from thumb_index
              timestamp: now,
              sourceType: 'gesture',
              handedness: handLabel,
              element: clickState.startElement,
            });
          }
        }

        // reset click state after handling
        clickState.state = 'idle';
        clickState.startElement = null;
        clickState.point = null;
      }
    } else {
      // for any other gesture, check if we need to expire a potential click
      if (!drawOnly && clickState.state === 'potential_click') {
        const elapsedTime = now - clickState.startTime;

        // if we exceeded the time constraint, reset the click state
        if (elapsedTime > CLICK_GESTURE_TIME_CONSTRAINT) {
          clickState.state = 'idle';
          clickState.startElement = null;
          clickState.point = null;
        }
      }
    }
  });
}

/**
 * handles 'ok' gesture for dragging elements
 * uses the 'ok' hand gesture to grab and manipulate individual elements
 */
export function handleOk(
  ctx: CanvasRenderingContext2D,
  results: GestureRecognizerResult,
  rect: DOMRect,
  dimensions: CanvasDimensions,
  onInteraction: InteractionEventHandler,
  drawOnly = false
): void {
  if (
    !results.landmarks?.length ||
    !results.handedness?.length ||
    !results.gestures?.length
  ) {
    // reset all states when no hands are detected (only if not in drawOnly mode)
    if (!drawOnly) {
      for (const handLabel of ['left', 'right'] as const) {
        const dragState = fineSelectDragState[handLabel];
        if (dragState.active && dragState.element) {
          onInteraction({
            type: 'pointerup',
            point: {
              x: 0,
              y: 0,
              clientX: 0,
              clientY: 0,
            },
            element: dragState.element,
            timestamp: Date.now(),
            sourceType: 'gesture',
            handedness: handLabel,
          });
          dragState.active = false;
          dragState.element = null;
        }
      }
    }
    return;
  }

  // draw orange points for any hand doing "ok" gesture
  results.handedness.forEach((hand, index) => {
    const gesture = results.gestures![index][0].categoryName;
    if (gesture === 'ok') {
      const landmarks = results.landmarks![index];

      // get fingertip positions
      const indexTip = landmarkToInteractionPoint(
        landmarks[8],
        dimensions,
        rect
      );
      const thumbTip = landmarkToInteractionPoint(
        landmarks[4],
        dimensions,
        rect
      );

      // use drawing utility for fingertips
      drawOkGestureFeedback(ctx, indexTip, thumbTip);
    }
  });

  // skip all interaction logic if in drawOnly mode
  if (drawOnly) return;

  // get current hand states
  const currentHands = results.handedness.map((hand, idx) => ({
    handedness: hand[0].displayName.toLowerCase() as 'left' | 'right',
    gesture: results.gestures![idx][0].categoryName,
    landmarks: results.landmarks![idx],
  }));

  // process each hand with 'ok' gesture for element dragging
  currentHands.forEach((hand) => {
    if (hand.gesture === 'ok') {
      const handLabel = hand.handedness;

      // handle element dragging with 'ok' gesture
      handleSingleHandDragInside(
        hand.landmarks,
        dimensions,
        rect,
        handLabel,
        onInteraction
      );
    } else {
      // if not making 'ok' gesture, reset drag state for this hand
      const handLabel = hand.handedness;
      const dragState = fineSelectDragState[handLabel];

      if (dragState.active && dragState.element) {
        // send pointerup to end the drag when gesture ends
        onInteraction({
          type: 'pointerup',
          point: { x: 0, y: 0, clientX: 0, clientY: 0 },
          element: dragState.element,
          timestamp: Date.now(),
          sourceType: 'gesture',
          handedness: handLabel,
        });
        dragState.active = false;
        dragState.element = null;
      }
    }
  });
}

/**
 * handles 'fist' gesture for panning and zooming
 * single fist: pans the visualization
 * two fists: zooms the visualization
 */
export function handleFist(
  ctx: CanvasRenderingContext2D,
  results: GestureRecognizerResult,
  rect: DOMRect,
  dimensions: CanvasDimensions,
  onInteraction: InteractionEventHandler,
  drawOnly = false
): void {
  if (
    !results.landmarks?.length ||
    !results.handedness?.length ||
    !results.gestures?.length
  ) {
    // reset states when no hands are detected
    if (!drawOnly) {
      if (!wasZooming) {
        resetZoomState();
      }

      lastHandCount = 0;
    }
    return;
  }

  // get current hands making fist gesture
  const fistHands = results.handedness
    .map((hand, idx) => ({
      index: idx,
      handedness: hand[0].displayName.toLowerCase() as 'left' | 'right',
      gesture: results.gestures![idx][0].categoryName,
    }))
    .filter((hand) => hand.gesture === 'fist');

  // skip if no fist gestures detected
  if (fistHands.length === 0) {
    if (!drawOnly) {
      resetZoomState();
      wasZooming = false;
      lastZoomCenter = null;
      initialDragPosition = null;
      transitionInProgress = false;
      lastHandCount = 0;
    }
    return;
  }

  // Draw visual feedback for each fist
  fistHands.forEach((hand) => {
    const landmarks = results.landmarks![hand.index];
    const palmCenter = landmarkToInteractionPoint(
      landmarks[0],
      dimensions,
      rect
    );
    drawFistGestureFeedback(ctx, palmCenter);
  });

  // check for transition from two hands to one hand
  if (lastHandCount === 2 && fistHands.length === 1) {
    wasZooming = true;
    transitionInProgress = true;
    if (!lastZoomCenter && zoomState.startCenter) {
      lastZoomCenter = { ...zoomState.startCenter };
    }
    initialDragPosition = null;
  }

  lastHandCount = fistHands.length;

  // handle two-handed fist gesture (zooming)
  if (fistHands.length === 2) {
    fistHands.sort((a, b) => a.handedness.localeCompare(b.handedness));
    const handLandmarks = fistHands.map(
      (hand) => results.landmarks![hand.index]
    );

    handleTwoHandedZoom(
      ctx,
      handLandmarks,
      dimensions,
      onInteraction,
      drawOnly
    );
  }
  // handle single-handed fist gesture (panning)
  else if (fistHands.length === 1) {
    const hand = fistHands[0];
    const landmarks = results.landmarks![hand.index];

    handleSingleHandedDrag(landmarks, dimensions, onInteraction);
  }
}

// handles two-handed zoom operation
function handleTwoHandedZoom(
  ctx: CanvasRenderingContext2D,
  hands: NormalizedLandmark[][],
  dimensions: CanvasDimensions,
  onInteraction: InteractionEventHandler,
  drawOnly = false
): void {
  // mark that we are zooming to help with transition to dragging
  if (!drawOnly) {
    wasZooming = true;
    initialDragPosition = null; // reset initial drag position when zooming
    transitionInProgress = false; // not in transition while actively zooming
  }

  // get index fingertip positions for both hands
  const point1 = getLandmarkPosition(
    hands[0][0],
    dimensions.width,
    dimensions.height
  );
  const point2 = getLandmarkPosition(
    hands[1][0],
    dimensions.width,
    dimensions.height
  );

  // calculate distance between hands
  const currentDistance = Math.sqrt(
    Math.pow(point2.x - point1.x, 2) + Math.pow(point2.y - point1.y, 2)
  );

  // calculate center point between hands
  const center = {
    x: dimensions.width - (point1.x + point2.x) / 2,
    y: (point1.y + point2.y) / 2,
  };

  // store initial zoom center if this is the start of a zoom
  if (!drawOnly && !zoomState.lastDistance) {
    zoomState.startCenter = center;
    zoomState.fixedPoint = {
      x: (center.x - currentTransform.x) / currentTransform.scale,
      y: (center.y - currentTransform.y) / currentTransform.scale,
    };
  }

  // always update lastZoomCenter with the current center
  // this ensures we have the most recent position for transition to drag
  if (!drawOnly) {
    lastZoomCenter = { ...center };
  }

  // Draw zoom feedback using the drawing utility
  drawZoomFeedback(ctx, point1, point2, center, dimensions);

  // calculate and dispatch zoom transform - only if not in drawOnly mode
  if (!drawOnly && zoomState.lastDistance) {
    const scale = currentDistance / zoomState.lastDistance;
    const newScale = Math.max(1, Math.min(4, currentTransform.scale * scale));

    if (zoomState.fixedPoint) {
      const fp = zoomState.fixedPoint;
      currentTransform = {
        scale: newScale,
        x: center.x - fp.x * newScale,
        y: center.y - fp.y * newScale,
      };
    }

    onInteraction({
      type: 'zoom',
      transform: currentTransform,
      timestamp: Date.now(),
      sourceType: 'gesture',
    });
  }

  if (!drawOnly) {
    zoomState.lastDistance = currentDistance;
  }
}

// handles single-handed drag operation
function handleSingleHandedDrag(
  hand: NormalizedLandmark[],
  dimensions: CanvasDimensions,
  onInteraction: InteractionEventHandler
): void {
  const currentPosition = getLandmarkPosition(
    hand[0],
    dimensions.width,
    dimensions.height
  );

  // if transitioning from zoom to drag, use the last zoom center as reference point
  if (wasZooming && lastZoomCenter && !initialDragPosition) {
    // store the initial position of the hand for the drag operation
    initialDragPosition = { ...currentPosition };
    transitionInProgress = true; // mark that we're in transition

    // on the first frame after transition, don't apply any movement
    // just send the current transform to maintain continuity
    onInteraction({
      type: 'drag',
      transform: currentTransform,
      timestamp: Date.now(),
      sourceType: 'gesture',
    });

    // set the start center for next frame's movement calculation
    zoomState.startCenter = { ...currentPosition };
    return;
  }

  if (zoomState.startCenter) {
    const movementX = currentPosition.x - zoomState.startCenter.x;
    const movementY = currentPosition.y - zoomState.startCenter.y;

    // update transform relative to current position
    currentTransform = {
      ...currentTransform,
      x: currentTransform.x - movementX,
      y: currentTransform.y + movementY,
    };

    onInteraction({
      type: 'drag',
      transform: currentTransform,
      timestamp: Date.now(),
      sourceType: 'gesture',
    });
  }

  // update start center for next frame
  zoomState.startCenter = currentPosition;

  // clear the zooming flags after we've successfully started dragging
  // only end the transition after a few frames of successful dragging
  if (wasZooming && initialDragPosition && transitionInProgress) {
    // after a few frames, consider the transition complete
    if (
      Math.abs(currentPosition.x - initialDragPosition.x) > 5 ||
      Math.abs(currentPosition.y - initialDragPosition.y) > 5
    ) {
      wasZooming = false;
      lastZoomCenter = null;
      transitionInProgress = false;
    }
  }

  // don't reset lastDistance and fixedPoint when in the middle of a transition
  if (!wasZooming) {
    zoomState.lastDistance = null;
    zoomState.fixedPoint = null;
  }
}

// resets zoom state
function resetZoomState(): void {
  // store the last zoom center when resetting zoom state
  // this helps with smooth transitions from zoom to drag
  if (zoomState.startCenter) {
    lastZoomCenter = { ...zoomState.startCenter };
  }
  zoomState.startCenter = null;
  zoomState.lastDistance = null;
  zoomState.fixedPoint = null;
  initialDragPosition = null; // reset initial drag position when resetting zoom state
  transitionInProgress = false; // reset transition flag
}

// helper function to handle dragging elements inside the visualization
function handleSingleHandDragInside(
  landmarks: NormalizedLandmark[],
  dimensions: CanvasDimensions,
  rect: DOMRect,
  handLabel: 'left' | 'right',
  onInteraction: InteractionEventHandler
): void {
  const indexTip = landmarks[8];
  const point = landmarkToInteractionPoint(indexTip, dimensions, rect);
  const dragState = fineSelectDragState[handLabel];

  // get element at current position
  const element = dragState.active
    ? dragState.element
    : document.elementFromPoint(point.clientX, point.clientY);

  if (element && isInteractableElement(element)) {
    // start drag if not already dragging
    if (!dragState.active) {
      dragState.active = true;
      dragState.element = element;
      dragState.startX = point.clientX;
      dragState.startY = point.clientY;
      onInteraction({
        type: 'pointerdown',
        point,
        element,
        timestamp: Date.now(),
        sourceType: 'gesture',
        handedness: handLabel,
      });
    }
    // continue drag if already dragging
    else if (dragState.element) {
      onInteraction({
        type: 'pointermove',
        point,
        element: dragState.element,
        timestamp: Date.now(),
        sourceType: 'gesture',
        handedness: handLabel,
      });
    }
  }
}
