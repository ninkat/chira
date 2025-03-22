import { GestureRecognizer } from '@mediapipe/tasks-vision';

/**
 * draws hand landmarks and connections for both hands
 * @param canvasCtx canvas 2d context to draw on
 * @param results mediapipe gesture recognition results
 * @param isRemote whether these are remote hands (uses different colors)
 */
export function drawHandLandmarks(
  canvasCtx: CanvasRenderingContext2D,
  results: {
    landmarks?: Array<Array<{ x: number; y: number }>>;
    handedness?: Array<Array<{ displayName: string }>>;
  },
  isRemote = false
): void {
  // @ts-expect-error: DrawingUtils is not recognized in @mediapipe/tasks-vision version 0.10.20.
  // But you can call with without importing it?
  const drawingUtils = new window.DrawingUtils(canvasCtx);

  // colors for local hands (green)
  const localConnectorColor = 'rgba(0, 255, 0, 0.4)'; // muted green with transparency
  const localLandmarkColor = 'rgba(255, 255, 255, 0.6)'; // semi-transparent white

  // colors for remote hands (blue/purple)
  const remoteConnectorColor = 'rgba(153, 102, 255, 0.4)'; // muted purple with transparency
  const remoteLandmarkColor = 'rgba(102, 204, 255, 0.6)'; // muted light blue with transparency

  // select colors based on whether these are remote hands
  const connectorColor = isRemote ? remoteConnectorColor : localConnectorColor;
  const landmarkColor = isRemote ? remoteLandmarkColor : localLandmarkColor;

  let leftDrawn = false;
  let rightDrawn = false;

  if (results.landmarks && results.handedness) {
    for (let i = 0; i < results.landmarks.length; i++) {
      const handLabel = results.handedness[i][0].displayName.toLowerCase();
      if (handLabel === 'left' && !leftDrawn) {
        drawingUtils.drawConnectors(
          results.landmarks[i],
          GestureRecognizer.HAND_CONNECTIONS,
          { color: connectorColor, lineWidth: 2 }
        );
        drawingUtils.drawLandmarks(results.landmarks[i], {
          color: landmarkColor,
          lineWidth: 0.5,
          radius: 3,
        });
        leftDrawn = true;
      } else if (handLabel === 'right' && !rightDrawn) {
        drawingUtils.drawConnectors(
          results.landmarks[i],
          GestureRecognizer.HAND_CONNECTIONS,
          { color: connectorColor, lineWidth: 2 }
        );
        drawingUtils.drawLandmarks(results.landmarks[i], {
          color: landmarkColor,
          lineWidth: 0.5,
          radius: 3,
        });
        rightDrawn = true;
      }
      if (leftDrawn && rightDrawn) break;
    }
  }
}
