import { Point } from '@/types/types';
import { minEnclosingCircle, getLandmarkPosition } from '@/utils/mathUtils';
import {
  NormalizedLandmark,
  GestureRecognizerResult,
} from '@mediapipe/tasks-vision';
import { CanvasDimensions } from '@/types/types';
import { InteractionPoint } from '@/types/interactionTypes';
import {
  drawOneGestureFeedback,
  drawGrabbingGestureFeedback,
  drawGrabbingHoverPoint,
  drawThumbIndexGestureFeedback,
  drawOkGestureFeedback,
  drawZoomFeedback,
  drawFistGestureFeedback,
  drawRippleEffect,
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

// ripple effect animation state for remote hands
interface RemoteRippleState {
  active: boolean;
  point: InteractionPoint | null;
  startTime: number;
  progress: number;
}

// ripple state tracking per remote hand
const remoteRippleState: {
  left: RemoteRippleState;
  right: RemoteRippleState;
} = {
  left: {
    active: false,
    point: null,
    startTime: 0,
    progress: 0,
  },
  right: {
    active: false,
    point: null,
    startTime: 0,
    progress: 0,
  },
};

// duration of ripple animation in milliseconds
const RIPPLE_ANIMATION_DURATION = 500;

// click state tracking for remote hands
const remoteClickState: {
  left: { active: boolean };
  right: { active: boolean };
} = {
  left: { active: false },
  right: { active: false },
};

// state for tracking remote fist gesture dwell time per hand
const remoteFistDwellState = {
  left: {
    startTime: 0,
    active: false,
    dwellComplete: false,
  },
  right: {
    startTime: 0,
    active: false,
    dwellComplete: false,
  },
};

// dwell time in milliseconds (matching local implementation)
const FIST_DWELL_TIME = 500;

// helper function to draw a move tool indicator (four cardinal arrows)
function drawMoveToolIndicator(
  ctx: CanvasRenderingContext2D,
  point: InteractionPoint
): void {
  const arrowLength = 14;
  const arrowWidth = 6;
  const centerOffset = 8; // offset from center point

  // draw arrows in four directions
  // up arrow
  ctx.beginPath();
  ctx.moveTo(point.x, point.y - centerOffset);
  ctx.lineTo(point.x, point.y - centerOffset - arrowLength);
  ctx.lineTo(
    point.x - arrowWidth,
    point.y - centerOffset - arrowLength + arrowWidth
  );
  ctx.moveTo(point.x, point.y - centerOffset - arrowLength);
  ctx.lineTo(
    point.x + arrowWidth,
    point.y - centerOffset - arrowLength + arrowWidth
  );
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 2;
  ctx.stroke();

  // down arrow
  ctx.beginPath();
  ctx.moveTo(point.x, point.y + centerOffset);
  ctx.lineTo(point.x, point.y + centerOffset + arrowLength);
  ctx.lineTo(
    point.x - arrowWidth,
    point.y + centerOffset + arrowLength - arrowWidth
  );
  ctx.moveTo(point.x, point.y + centerOffset + arrowLength);
  ctx.lineTo(
    point.x + arrowWidth,
    point.y + centerOffset + arrowLength - arrowWidth
  );
  ctx.stroke();

  // left arrow
  ctx.beginPath();
  ctx.moveTo(point.x - centerOffset, point.y);
  ctx.lineTo(point.x - centerOffset - arrowLength, point.y);
  ctx.lineTo(
    point.x - centerOffset - arrowLength + arrowWidth,
    point.y - arrowWidth
  );
  ctx.moveTo(point.x - centerOffset - arrowLength, point.y);
  ctx.lineTo(
    point.x - centerOffset - arrowLength + arrowWidth,
    point.y + arrowWidth
  );
  ctx.stroke();

  // right arrow
  ctx.beginPath();
  ctx.moveTo(point.x + centerOffset, point.y);
  ctx.lineTo(point.x + centerOffset + arrowLength, point.y);
  ctx.lineTo(
    point.x + centerOffset + arrowLength - arrowWidth,
    point.y - arrowWidth
  );
  ctx.moveTo(point.x + centerOffset + arrowLength, point.y);
  ctx.lineTo(
    point.x + centerOffset + arrowLength - arrowWidth,
    point.y + arrowWidth
  );
  ctx.stroke();
}

// helper function to draw a zoom tool indicator (two outward arrows)
function drawZoomToolIndicator(
  ctx: CanvasRenderingContext2D,
  point: InteractionPoint
): void {
  const arrowLength = 14;
  const arrowWidth = 6;
  const centerOffset = 8; // offset from center point

  // draw diagonal outward arrows for zoom
  // top-right arrow
  ctx.beginPath();
  ctx.moveTo(point.x + centerOffset, point.y - centerOffset);
  ctx.lineTo(
    point.x + centerOffset + arrowLength,
    point.y - centerOffset - arrowLength
  );
  ctx.lineTo(
    point.x + centerOffset + arrowLength - arrowWidth,
    point.y - centerOffset - arrowLength + arrowWidth
  );
  ctx.moveTo(
    point.x + centerOffset + arrowLength,
    point.y - centerOffset - arrowLength
  );
  ctx.lineTo(
    point.x + centerOffset + arrowLength - arrowWidth,
    point.y - centerOffset - arrowLength
  );
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 2;
  ctx.stroke();

  // bottom-left arrow
  ctx.beginPath();
  ctx.moveTo(point.x - centerOffset, point.y + centerOffset);
  ctx.lineTo(
    point.x - centerOffset - arrowLength,
    point.y + centerOffset + arrowLength
  );
  ctx.lineTo(
    point.x - centerOffset - arrowLength + arrowWidth,
    point.y + centerOffset + arrowLength - arrowWidth
  );
  ctx.moveTo(
    point.x - centerOffset - arrowLength,
    point.y + centerOffset + arrowLength
  );
  ctx.lineTo(
    point.x - centerOffset - arrowLength,
    point.y + centerOffset + arrowLength - arrowWidth
  );
  ctx.stroke();
}

// remote handler for "one" gesture - purely visual with no event dispatching
export function handleOne(
  ctx: CanvasRenderingContext2D,
  results: GestureRecognizerResult,
  rect: DOMRect,
  dimensions: CanvasDimensions
): void {
  if (
    !results.landmarks?.length ||
    !results.handedness?.length ||
    !results.gestures?.length
  ) {
    return;
  }

  const now = Date.now();

  // process each hand
  results.handedness.forEach((hand, index) => {
    const handLabel = hand[0].displayName.toLowerCase() as 'left' | 'right';
    const gesture = results.gestures![index][0].categoryName;

    // Check and update ripple animation if active
    const handRippleState = remoteRippleState[handLabel];
    if (handRippleState.active && handRippleState.point) {
      const rippleElapsed = now - handRippleState.startTime;
      handRippleState.progress = Math.min(
        1,
        rippleElapsed / RIPPLE_ANIMATION_DURATION
      );

      // Draw the ripple effect
      drawRippleEffect(ctx, handRippleState.point, handRippleState.progress);

      // Deactivate ripple when animation completes
      if (handRippleState.progress >= 1) {
        handRippleState.active = false;
        handRippleState.point = null;
      }
    }

    // only process if gesture is "one"
    if (gesture !== 'one') return;

    const landmarks = results.landmarks![index];

    // get index fingertip position
    const indexTip = landmarks[8];
    const point = landmarkToInteractionPoint(indexTip, dimensions, rect);

    // draw visual feedback using the drawing utility - this is all we do for remote
    drawOneGestureFeedback(ctx, point);

    // Check if we need to trigger a ripple effect for a click transition
    const clickInfo = remoteClickState[handLabel];
    if (clickInfo.active) {
      // Start ripple animation at the current index finger position
      handRippleState.active = true;
      handRippleState.point = { ...point };
      handRippleState.startTime = now;
      handRippleState.progress = 0;

      // Reset click state
      clickInfo.active = false;
    }
  });
}

// remote handler for "grabbing" gesture - purely visual with no event dispatching
export function handleGrabbing(
  ctx: CanvasRenderingContext2D,
  results: GestureRecognizerResult,
  rect: DOMRect,
  dimensions: CanvasDimensions
): void {
  if (
    !results.landmarks?.length ||
    !results.handedness?.length ||
    !results.gestures?.length
  ) {
    return;
  }

  const currentTime = Date.now();

  // Check for active ripple animations and draw them
  for (const handLabel of ['left', 'right'] as const) {
    const handRippleState = remoteRippleState[handLabel];
    if (handRippleState.active && handRippleState.point) {
      const rippleElapsed = currentTime - handRippleState.startTime;
      handRippleState.progress = Math.min(
        1,
        rippleElapsed / RIPPLE_ANIMATION_DURATION
      );

      // Draw the ripple effect
      drawRippleEffect(ctx, handRippleState.point, handRippleState.progress);

      // Deactivate ripple when animation completes
      if (handRippleState.progress >= 1) {
        handRippleState.active = false;
        handRippleState.point = null;
      }
    }
  }

  // process each hand
  results.handedness.forEach((hand, index) => {
    const gesture = results.gestures![index][0].categoryName;

    // only process if gesture is "grabbing"
    if (gesture !== 'grabbing') return;

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
      // draw visual feedback for the hover area - this is all we do for remote
      drawGrabbingGestureFeedback(ctx, circle);

      // add some sample points for visual feedback
      const gridSize = Math.max(10, Math.floor(circle.radius / 10));
      const step = (circle.radius * 2) / gridSize;

      for (let x = -circle.radius; x <= circle.radius; x += step) {
        for (let y = -circle.radius; y <= circle.radius; y += step) {
          if (x * x + y * y <= circle.radius * circle.radius) {
            const point: InteractionPoint = {
              x: circle.center.x + x,
              y: circle.center.y + y,
              clientX: rect.left + (dimensions.width - (circle.center.x + x)),
              clientY: rect.top + (circle.center.y + y),
            };

            // draw some hover points for visual feedback
            if (Math.random() < 0.2) {
              // sparse sampling for performance
              drawGrabbingHoverPoint(ctx, point);
            }
          }
        }
      }
    }
  });
}

// remote handler for "thumb_index" gesture - purely visual with no event dispatching
export function handleThumbIndex(
  ctx: CanvasRenderingContext2D,
  results: GestureRecognizerResult,
  rect: DOMRect,
  dimensions: CanvasDimensions
): void {
  if (
    !results.landmarks?.length ||
    !results.handedness?.length ||
    !results.gestures?.length
  ) {
    return;
  }

  const now = Date.now();

  // process each hand
  results.handedness.forEach((hand, index) => {
    const handLabel = hand[0].displayName.toLowerCase() as 'left' | 'right';
    const gesture = results.gestures![index][0].categoryName;

    // Check and update ripple animation if active
    const handRippleState = remoteRippleState[handLabel];
    if (handRippleState.active && handRippleState.point) {
      const rippleElapsed = now - handRippleState.startTime;
      handRippleState.progress = Math.min(
        1,
        rippleElapsed / RIPPLE_ANIMATION_DURATION
      );

      // Draw the ripple effect
      drawRippleEffect(ctx, handRippleState.point, handRippleState.progress);

      // Deactivate ripple when animation completes
      if (handRippleState.progress >= 1) {
        handRippleState.active = false;
        handRippleState.point = null;
      }
    }

    // only process if gesture is "thumb_index"
    if (gesture !== 'thumb_index') {
      // If we were previously in thumb_index and now we're in "one" gesture,
      // simulate a click transition by marking active (point will be taken from current position)
      if (gesture === 'one') {
        const clickInfo = remoteClickState[handLabel];
        clickInfo.active = true;
      }
      return;
    }

    const landmarks = results.landmarks![index];
    const indexTip = landmarks[8];
    const point = landmarkToInteractionPoint(indexTip, dimensions, rect);

    // draw visual indicator only - this is all we do for remote
    drawThumbIndexGestureFeedback(ctx, point);
  });
}

// remote handler for "ok" gesture - purely visual with no event dispatching
export function handleOk(
  ctx: CanvasRenderingContext2D,
  results: GestureRecognizerResult,
  rect: DOMRect,
  dimensions: CanvasDimensions
): void {
  if (
    !results.landmarks?.length ||
    !results.handedness?.length ||
    !results.gestures?.length
  ) {
    return;
  }

  const currentTime = Date.now();

  // Check for active ripple animations and draw them
  for (const handLabel of ['left', 'right'] as const) {
    const handRippleState = remoteRippleState[handLabel];
    if (handRippleState.active && handRippleState.point) {
      const rippleElapsed = currentTime - handRippleState.startTime;
      handRippleState.progress = Math.min(
        1,
        rippleElapsed / RIPPLE_ANIMATION_DURATION
      );

      // Draw the ripple effect
      drawRippleEffect(ctx, handRippleState.point, handRippleState.progress);

      // Deactivate ripple when animation completes
      if (handRippleState.progress >= 1) {
        handRippleState.active = false;
        handRippleState.point = null;
      }
    }
  }

  // Draw orange points for any hand doing "ok" gesture
  results.handedness.forEach((hand, index) => {
    const gesture = results.gestures![index][0].categoryName;
    if (gesture === 'ok') {
      const landmarks = results.landmarks![index];

      // Get fingertip positions
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

      // Draw visual feedback only
      drawOkGestureFeedback(ctx, indexTip, thumbTip);
    }
  });
}

// remote handler for "fist" gesture - purely visual with no event dispatching
export function handleFist(
  ctx: CanvasRenderingContext2D,
  results: GestureRecognizerResult,
  rect: DOMRect,
  dimensions: CanvasDimensions
): void {
  if (
    !results.landmarks?.length ||
    !results.handedness?.length ||
    !results.gestures?.length
  ) {
    // Reset dwell states when no hands are detected
    remoteFistDwellState.left.active = false;
    remoteFistDwellState.left.dwellComplete = false;
    remoteFistDwellState.right.active = false;
    remoteFistDwellState.right.dwellComplete = false;
    return;
  }

  const currentTime = Date.now();

  // Check for active ripple animations and draw them
  for (const handLabel of ['left', 'right'] as const) {
    const handRippleState = remoteRippleState[handLabel];
    if (handRippleState.active && handRippleState.point) {
      const rippleElapsed = currentTime - handRippleState.startTime;
      handRippleState.progress = Math.min(
        1,
        rippleElapsed / RIPPLE_ANIMATION_DURATION
      );

      // Draw the ripple effect
      drawRippleEffect(ctx, handRippleState.point, handRippleState.progress);

      // Deactivate ripple when animation completes
      if (handRippleState.progress >= 1) {
        handRippleState.active = false;
        handRippleState.point = null;
      }
    }
  }

  // Track hands that are not making fist gesture to reset their dwell state
  results.handedness.forEach((hand, idx) => {
    const handedness = hand[0].displayName.toLowerCase() as 'left' | 'right';
    const gesture = results.gestures![idx][0].categoryName;

    // If hand is not making fist gesture, reset its dwell state
    if (gesture !== 'fist' && remoteFistDwellState[handedness].active) {
      remoteFistDwellState[handedness].active = false;
      remoteFistDwellState[handedness].dwellComplete = false;
    }
  });

  // Find hands with active fist gestures
  const fistHandsInfo = results.handedness
    .map((hand, idx) => ({
      index: idx,
      handedness: hand[0].displayName.toLowerCase() as 'left' | 'right',
      gesture: results.gestures![idx][0].categoryName,
    }))
    .filter((hand) => hand.gesture === 'fist');

  // Get hands that have completed the dwell time
  const activeFistHandIndices = fistHandsInfo
    .filter((hand) => remoteFistDwellState[hand.handedness].dwellComplete)
    .map((hand) => hand.index);

  // Draw fist gesture visualizations with dwell time indicators
  results.handedness.forEach((hand, index) => {
    const handedness = hand[0].displayName.toLowerCase() as 'left' | 'right';
    const gesture = results.gestures![index][0].categoryName;

    if (gesture === 'fist') {
      const dwellState = remoteFistDwellState[handedness];

      // Start timer if this is a new fist gesture
      if (!dwellState.active) {
        dwellState.startTime = currentTime;
        dwellState.active = true;
        dwellState.dwellComplete = false;
      }
      // Check if dwell time is complete
      else if (!dwellState.dwellComplete) {
        const elapsedTime = currentTime - dwellState.startTime;
        if (elapsedTime >= FIST_DWELL_TIME) {
          dwellState.dwellComplete = true;
        }
      }

      // Draw feedback for this fist
      const landmarks = results.landmarks![index];
      const palmCenter = landmarkToInteractionPoint(
        landmarks[0],
        dimensions,
        rect
      );

      // Draw dwell progress indicator along with fist feedback
      if (dwellState.active && !dwellState.dwellComplete) {
        // Calculate progress as a value between 0 and 1
        const progress = Math.min(
          1,
          (currentTime - dwellState.startTime) / FIST_DWELL_TIME
        );

        // For in-progress dwell, draw a partial circle that fills up
        const radius = 12; // Same radius as in drawFistGestureFeedback

        // First draw the outline circle
        ctx.beginPath();
        ctx.arc(palmCenter.x, palmCenter.y, radius, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(50, 205, 50, 0.8)'; // Green outline
        ctx.lineWidth = 2;
        ctx.stroke();

        // Then draw the progress as a filled sector
        ctx.beginPath();
        ctx.moveTo(palmCenter.x, palmCenter.y);
        ctx.arc(
          palmCenter.x,
          palmCenter.y,
          radius,
          -Math.PI / 2, // start at 12 o'clock position
          -Math.PI / 2 + progress * 2 * Math.PI, // end based on progress
          false // draw clockwise
        );
        ctx.fillStyle = 'rgba(50, 205, 50, 0.6)'; // Lighter green fill
        ctx.fill();

        // Draw the outer ring
        ctx.beginPath();
        ctx.arc(palmCenter.x, palmCenter.y, radius + 4, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(50, 205, 50, 0.3)';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (dwellState.dwellComplete) {
        // When dwell is complete, use the normal feedback which is a solid circle
        drawFistGestureFeedback(ctx, palmCenter);

        // If in zoom mode (two active fists), we'll draw the zoom indicator at the center point later
        // Only draw move indicator for single hand panning
        if (activeFistHandIndices.length === 1) {
          drawMoveToolIndicator(ctx, palmCenter);
        }
      } else {
        // Shouldn't reach here, but just in case, draw basic feedback
        drawFistGestureFeedback(ctx, palmCenter);
      }
    }
  });

  // If we have two hands with active "fist" gesture, draw a zoom feedback
  if (activeFistHandIndices.length === 2) {
    const hand1 = results.landmarks![activeFistHandIndices[0]];
    const hand2 = results.landmarks![activeFistHandIndices[1]];

    // get center of palm positions for both hands
    const point1 = getLandmarkPosition(
      hand1[0], // palm center
      dimensions.width,
      dimensions.height
    );
    const point2 = getLandmarkPosition(
      hand2[0], // palm center
      dimensions.width,
      dimensions.height
    );

    // calculate center point between hands
    const center = {
      x: dimensions.width - (point1.x + point2.x) / 2,
      y: (point1.y + point2.y) / 2,
    };

    // Create interaction point for the zoom center
    const zoomCenter: InteractionPoint = {
      x: (point1.x + point2.x) / 2,
      y: (point1.y + point2.y) / 2,
      clientX: 0, // not needed for drawing
      clientY: 0, // not needed for drawing
    };

    // Draw the zoom tool indicator at the center point
    drawZoomToolIndicator(ctx, zoomCenter);

    // Draw zoom feedback (lines connecting hands)
    drawZoomFeedback(ctx, point1, point2, center, dimensions);
  }
}
