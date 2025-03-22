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

// state for tracking the last selected element in fine select mode
let lastSelectedElement: Element | null = null;

// state for tracking currently hovered elements for circle hover
const hoveredElementsByHand = {
  left: new Set<Element>(),
  right: new Set<Element>(),
};

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

// track where two-handed zoom gestures started
const twoHandedZoomState = {
  active: false,
  startedInsideBox: false,
};

// track when transitioning from two hands to one hand to prevent jumps
let wasZooming = false;
let lastZoomCenter: Point | null = null;
let lastHandCount = 0; // track the number of hands with "ok" gesture
let initialDragPosition: Point | null = null; // track initial position for smooth transition
let transitionInProgress = false; // track if we're in the middle of a transition

// state for tracking where each hand's ok gesture started
const gestureStartLocation = {
  left: { active: false, startedInside: false },
  right: { active: false, startedInside: false },
};

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
  onInteraction: InteractionEventHandler
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

    // only process if gesture is "one"
    if (gesture !== 'one') return;

    const landmarks = results.landmarks![index];

    // get index fingertip position
    const indexTip = landmarks[8];
    const point = landmarkToInteractionPoint(indexTip, dimensions, rect);

    // get element at current position
    const currentElement = document.elementFromPoint(
      point.clientX,
      point.clientY
    );

    // handle hover state based on hand
    if (handLabel === 'right') {
      // handle right hand hover
      if (currentElement !== lastHoveredElementRight) {
        // send pointerout to previous element
        if (lastHoveredElementRight) {
          onInteraction({
            type: 'pointerout',
            point,
            timestamp: Date.now(),
            sourceType: 'gesture',
            handedness: 'right',
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
          });
        }

        // update right hand hover state
        lastHoveredElementRight = currentElement;
      }
    } else {
      // handle left hand hover
      if (currentElement !== lastHoveredElementLeft) {
        // send pointerout to previous element
        if (lastHoveredElementLeft) {
          onInteraction({
            type: 'pointerout',
            point,
            timestamp: Date.now(),
            sourceType: 'gesture',
            handedness: 'left',
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
          });
        }

        // update left hand hover state
        lastHoveredElementLeft = currentElement;
      }
    }

    // draw visual feedback for each hand's hover point (index fingertip)
    ctx.beginPath();
    ctx.arc(point.x, point.y, 10, 0, 2 * Math.PI);
    ctx.fillStyle =
      handLabel === 'right' ? 'rgb(64, 224, 208)' : 'rgb(64, 224, 208)'; // solid turquoise
    ctx.fill();

    // draw a small ring around the point for better visibility
    ctx.beginPath();
    ctx.arc(point.x, point.y, 14, 0, 2 * Math.PI);
    ctx.strokeStyle =
      handLabel === 'right'
        ? 'rgba(64, 224, 208, 0.2)'
        : 'rgba(64, 224, 208, 0.2)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
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
  onInteraction: InteractionEventHandler
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
      ctx.beginPath();
      ctx.arc(circle.center.x, circle.center.y, circle.radius, 0, 2 * Math.PI);
      ctx.strokeStyle =
        handLabel === 'right'
          ? 'rgba(255, 140, 0, 0.3)'
          : 'rgba(255, 140, 0, 0.3)'; // dark orange
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // add a subtle fill to the circle
      ctx.fillStyle =
        handLabel === 'right'
          ? 'rgba(255, 140, 0, 0.1)'
          : 'rgba(255, 140, 0, 0.1)';
      ctx.fill();

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

              // draw hover point feedback with smaller, more subtle dots
              ctx.beginPath();
              ctx.arc(point.x, point.y, 1, 0, 2 * Math.PI);
              ctx.fillStyle =
                handLabel === 'right'
                  ? 'rgba(255, 140, 0, 0.15)'
                  : 'rgba(255, 140, 0, 0.15)';
              ctx.fill();
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
    } else {
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

// handles thumb_index gesture for precise selection
export function handleThumbIndex(
  ctx: CanvasRenderingContext2D,
  results: GestureRecognizerResult,
  rect: DOMRect,
  dimensions: CanvasDimensions,
  onInteraction: InteractionEventHandler
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

    // only process if gesture is "thumb_index"
    if (gesture !== 'thumb_index') return;

    const landmarks = results.landmarks![index];
    const indexTip = landmarks[8];
    const point = landmarkToInteractionPoint(indexTip, dimensions, rect);

    // draw visual indicator for index fingertip (landmark 8)
    ctx.beginPath();
    ctx.arc(point.x, point.y, 10, 0, 2 * Math.PI);
    ctx.fillStyle =
      handLabel === 'right' ? 'rgb(147, 112, 219)' : 'rgb(147, 112, 219)'; // solid medium purple
    ctx.fill();

    // handle selection
    const element = document.elementFromPoint(point.clientX, point.clientY);
    if (element !== lastSelectedElement && isInteractableElement(element)) {
      onInteraction({
        type: 'pointerselect',
        point,
        timestamp: Date.now(),
        sourceType: 'gesture',
        handedness: handLabel,
        element: element as Element,
      });
      lastSelectedElement = element;
    }
  });
}

/**
 * handles all drag-based interactions using the "ok" gesture. the behavior depends on the number
 * of hands making the gesture and their positions relative to the visualization bounding box:
 *
 * important constraint:
 * - if an 'ok' gesture starts inside the visualization box, that hand is locked to element
 *   manipulation only until the gesture is released and started again
 * - this prevents accidental switching between element dragging and visualization manipulation
 *
 * single hand interactions:
 * - inside visualization box: can grab and drag individual elements (nodes)
 * - outside visualization box: drags the entire visualization (only if gesture started outside)
 *
 * two hand interactions:
 * - both hands outside box: performs zooming operation on visualization (only if both gestures started outside)
 * - both hands inside box: each hand can independently grab and drag elements
 * - mixed (one in, one out): hands work independently based on where each gesture started
 *   - inside hand: can grab and drag elements
 *   - outside hand: can drag the entire visualization (only if gesture started outside)
 *
 * visual feedback:
 * - orange circles show finger positions for drag operations
 * - yellow line shows distance between hands during zoom
 * - red circle shows zoom center point
 *
 * state management:
 * - tracks drag state per hand
 * - maintains zoom state for smooth transitions
 * - handles transitions between zoom and drag operations
 * - tracks where each gesture started (inside/outside box)
 * - automatically resets states when gestures end
 */
export function handleDrag(
  ctx: CanvasRenderingContext2D,
  results: GestureRecognizerResult,
  rect: DOMRect,
  dimensions: CanvasDimensions,
  onInteraction: InteractionEventHandler
): void {
  if (
    !results.landmarks?.length ||
    !results.handedness?.length ||
    !results.gestures?.length
  ) {
    // reset all states when no hands are detected
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
      // reset gesture start location state
      gestureStartLocation[handLabel] = { active: false, startedInside: false };
    }

    if (!wasZooming) {
      resetZoomState();
    }

    twoHandedZoomState.active = false;
    twoHandedZoomState.startedInsideBox = false;
    return;
  }

  // Draw orange points for any hand doing "ok" gesture
  results.handedness.forEach((hand, index) => {
    const gesture = results.gestures![index][0].categoryName;
    if (gesture === 'ok') {
      const landmarks = results.landmarks![index];

      // Draw index fingertip (landmark 8)
      const indexTip = landmarkToInteractionPoint(
        landmarks[8],
        dimensions,
        rect
      );
      ctx.beginPath();
      ctx.arc(indexTip.x, indexTip.y, 10, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgb(255, 140, 0)'; // solid dark orange
      ctx.fill();

      // Draw thumb tip (landmark 4)
      const thumbTip = landmarkToInteractionPoint(
        landmarks[4],
        dimensions,
        rect
      );
      ctx.beginPath();
      ctx.arc(thumbTip.x, thumbTip.y, 10, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgb(255, 140, 0)'; // solid dark orange
      ctx.fill();
    }
  });

  // get current hand states and update gesture start locations
  const currentHands = results.handedness.map((hand, idx) => ({
    handedness: hand[0].displayName.toLowerCase() as 'left' | 'right',
    gesture: results.gestures![idx][0].categoryName,
    landmarks: results.landmarks![idx],
  }));

  // update gesture start locations for each hand
  currentHands.forEach((hand) => {
    const handLabel = hand.handedness;
    const isOk = hand.gesture === 'ok';
    const gestureState = gestureStartLocation[handLabel];

    // if not making ok gesture, reset the state
    if (!isOk) {
      gestureState.active = false;
      gestureState.startedInside = false;
      return;
    }

    // if this is the start of an ok gesture, record where it started
    if (!gestureState.active) {
      const indexTip = hand.landmarks[8];
      const point = landmarkToInteractionPoint(indexTip, dimensions, rect);
      const isInside = isPointInsideVisualization(point, rect);
      gestureState.active = true;
      gestureState.startedInside = isInside;
    }
  });

  // count hands making "ok" gesture
  const okHands = currentHands
    .filter((hand) => hand.gesture === 'ok')
    .map((hand) => ({
      index: currentHands.indexOf(hand),
      handedness: hand.handedness,
    }));

  // Check for transition from two hands to one hand
  if (lastHandCount === 2 && okHands.length === 1) {
    wasZooming = true;
    transitionInProgress = true;
    if (!lastZoomCenter && zoomState.startCenter) {
      lastZoomCenter = { ...zoomState.startCenter };
    }
    initialDragPosition = null;
  }

  lastHandCount = okHands.length;

  // handle two-handed "ok" gesture
  if (okHands.length === 2) {
    okHands.sort((a, b) => a.handedness.localeCompare(b.handedness));
    const handLandmarks = okHands.map((hand) => results.landmarks![hand.index]);

    const hand1IndexTip = landmarkToInteractionPoint(
      handLandmarks[0][8],
      dimensions,
      rect
    );
    const hand2IndexTip = landmarkToInteractionPoint(
      handLandmarks[1][8],
      dimensions,
      rect
    );

    const hand1Inside = isPointInsideVisualization(hand1IndexTip, rect);
    const hand2Inside = isPointInsideVisualization(hand2IndexTip, rect);

    // Check if either hand started inside
    const hand1StartedInside =
      gestureStartLocation[okHands[0].handedness].startedInside;
    const hand2StartedInside =
      gestureStartLocation[okHands[1].handedness].startedInside;

    // both hands started outside - can zoom
    if (
      !hand1StartedInside &&
      !hand2StartedInside &&
      !hand1Inside &&
      !hand2Inside
    ) {
      handleTwoHandedZoom(ctx, handLandmarks, dimensions, onInteraction);
    } else {
      // handle each hand based on where it started
      if (hand1StartedInside || hand1Inside) {
        handleSingleHandDragInside(
          handLandmarks[0],
          dimensions,
          rect,
          okHands[0].handedness,
          onInteraction
        );
      } else if (!hand1StartedInside) {
        handleSingleHandedDrag(handLandmarks[0], dimensions, onInteraction);
      }

      if (hand2StartedInside || hand2Inside) {
        handleSingleHandDragInside(
          handLandmarks[1],
          dimensions,
          rect,
          okHands[1].handedness,
          onInteraction
        );
      } else if (!hand2StartedInside) {
        handleSingleHandedDrag(handLandmarks[1], dimensions, onInteraction);
      }
    }
  }
  // handle single-handed "ok" gesture
  else if (okHands.length === 1) {
    const hand = okHands[0];
    const handLabel = hand.handedness;
    const landmarks = results.landmarks![hand.index];
    const indexTip = landmarks[8];
    const point = landmarkToInteractionPoint(indexTip, dimensions, rect);

    const isInsideVis = isPointInsideVisualization(point, rect);
    const startedInside = gestureStartLocation[handLabel].startedInside;

    // if started inside or currently inside, only allow element manipulation
    if (startedInside || isInsideVis) {
      handleSingleHandDragInside(
        landmarks,
        dimensions,
        rect,
        handLabel,
        onInteraction
      );
    } else if (!startedInside) {
      // only allow visualization drag if started outside
      handleSingleHandedDrag(landmarks, dimensions, onInteraction);
    }
  }
  // No "ok" gestures - reset all states
  else {
    for (const handLabel of ['left', 'right'] as const) {
      const dragState = fineSelectDragState[handLabel];
      if (dragState.active && dragState.element) {
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
      // reset gesture start location state
      gestureStartLocation[handLabel] = { active: false, startedInside: false };
    }
    resetZoomState();
    twoHandedZoomState.active = false;
    twoHandedZoomState.startedInsideBox = false;
    wasZooming = false;
    lastZoomCenter = null;
    initialDragPosition = null;
    transitionInProgress = false;
  }
}

// simplified helper to check if a point is inside the visualization
// in a real implementation, this would use the actual visualization dimensions
function isPointInsideVisualization(
  point: InteractionPoint,
  rect: DOMRect
): boolean {
  // Get the visualization element
  const visElement = document.querySelector('.vis-bounding-box');
  if (visElement instanceof SVGElement) {
    const bbox = visElement.getBoundingClientRect();
    return (
      point.clientX >= bbox.left &&
      point.clientX <= bbox.right &&
      point.clientY >= bbox.top &&
      point.clientY <= bbox.bottom
    );
  }

  // fallback - assume a centered visualization of 1280x720 in a 1920x1080 canvas
  const visWidth = 1280;
  const visHeight = 720;
  const visLeft = rect.left + (rect.width - visWidth) / 2;
  const visTop = rect.top + (rect.height - visHeight) / 2;

  return (
    point.clientX >= visLeft &&
    point.clientX <= visLeft + visWidth &&
    point.clientY >= visTop &&
    point.clientY <= visTop + visHeight
  );
}

// handles two-handed zoom operation
function handleTwoHandedZoom(
  ctx: CanvasRenderingContext2D,
  hands: NormalizedLandmark[][],
  dimensions: CanvasDimensions,
  onInteraction: InteractionEventHandler
): void {
  // mark that we are zooming to help with transition to dragging
  wasZooming = true;
  initialDragPosition = null; // reset initial drag position when zooming
  transitionInProgress = false; // not in transition while actively zooming

  // get index fingertip positions for both hands
  const point1 = getLandmarkPosition(
    hands[0][4],
    dimensions.width,
    dimensions.height
  );
  const point2 = getLandmarkPosition(
    hands[1][4],
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
  if (!zoomState.lastDistance) {
    zoomState.startCenter = center;
    zoomState.fixedPoint = {
      x: (center.x - currentTransform.x) / currentTransform.scale,
      y: (center.y - currentTransform.y) / currentTransform.scale,
    };
  }

  // always update lastZoomCenter with the current center
  // this ensures we have the most recent position for transition to drag
  lastZoomCenter = { ...center };

  // draw visual feedback for zoom operation
  // draw line between hands with gradient
  const gradient = ctx.createLinearGradient(
    point1.x,
    point1.y,
    point2.x,
    point2.y
  );
  gradient.addColorStop(0, 'rgba(50, 205, 50, 0.3)'); // limegreen
  gradient.addColorStop(0.5, 'rgba(50, 205, 50, 0.5)');
  gradient.addColorStop(1, 'rgba(50, 205, 50, 0.3)');

  ctx.beginPath();
  ctx.moveTo(point1.x, point1.y);
  ctx.lineTo(point2.x, point2.y);
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 1;
  ctx.stroke();

  // draw zoom center point with rings
  ctx.beginPath();
  ctx.arc(dimensions.width - center.x, center.y, 10, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgba(50, 205, 50, 0.3)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(50, 205, 50, 0.6)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // add outer ring with pulse effect
  const pulseRadius = 14 + Math.sin(Date.now() / 200) * 2;
  ctx.beginPath();
  ctx.arc(dimensions.width - center.x, center.y, pulseRadius, 0, 2 * Math.PI);
  ctx.strokeStyle = 'rgba(50, 205, 50, 0.2)';
  ctx.lineWidth = 0.5;
  ctx.stroke();

  // calculate and dispatch zoom transform
  if (zoomState.lastDistance) {
    const scale = currentDistance / zoomState.lastDistance;
    const newScale = Math.max(0.5, Math.min(8, currentTransform.scale * scale));

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

  zoomState.lastDistance = currentDistance;
}

// handles single-handed drag operation
function handleSingleHandedDrag(
  hand: NormalizedLandmark[],
  dimensions: CanvasDimensions,
  onInteraction: InteractionEventHandler
): void {
  const currentPosition = getLandmarkPosition(
    hand[4],
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
