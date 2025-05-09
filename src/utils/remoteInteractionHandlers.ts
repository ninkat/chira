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

  // process each hand
  results.handedness.forEach((hand, index) => {
    const gesture = results.gestures![index][0].categoryName;

    // only process if gesture is "one"
    if (gesture !== 'one') return;

    const landmarks = results.landmarks![index];

    // get index fingertip position
    const indexTip = landmarks[8];
    const point = landmarkToInteractionPoint(indexTip, dimensions, rect);

    // draw visual feedback using the drawing utility - this is all we do for remote
    drawOneGestureFeedback(ctx, point);
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

  // process each hand
  results.handedness.forEach((hand, index) => {
    const gesture = results.gestures![index][0].categoryName;

    // only process if gesture is "thumb_index"
    if (gesture !== 'thumb_index') return;

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
    return;
  }

  // Draw fist gesture visualizations
  const fistHandIndices: number[] = [];
  results.handedness.forEach((hand, index) => {
    const gesture = results.gestures![index][0].categoryName;
    if (gesture === 'fist') {
      fistHandIndices.push(index);

      // Draw visual feedback for the palm center
      const landmarks = results.landmarks![index];
      const palmCenter = landmarkToInteractionPoint(
        landmarks[0],
        dimensions,
        rect
      );
      drawFistGestureFeedback(ctx, palmCenter);
    }
  });

  // If we have two hands with "fist" gesture, draw a zoom feedback
  if (fistHandIndices.length === 2) {
    const hand1 = results.landmarks![fistHandIndices[0]];
    const hand2 = results.landmarks![fistHandIndices[1]];

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

    // Draw zoom feedback
    drawZoomFeedback(ctx, point1, point2, center, dimensions);
  }
}
