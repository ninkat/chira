import React, { useRef, useState, useCallback, useEffect } from 'react';
import { GestureData } from '@/types/types';
import {
  setupCanvas,
  processVideoFrame,
  shouldProcessFrame,
} from '@/utils/canvasUtils';
import {
  handleOne as handleSvgOne,
  handleGrabbing as handleSvgGrabbing,
  handleThumbIndex as handleSvgThumbIndex,
  handleDrag as handleSvgDrag,
} from '@/utils/interactionHandlers';
import {
  handleOne as handleSvgOneRemote,
  handleGrabbing as handleSvgGrabbingRemote,
  handleThumbIndex as handleSvgThumbIndexRemote,
  handleDrag as handleSvgDragRemote,
} from '@/utils/remoteInteractionHandlers';
import { InteractionEventHandler } from '@/types/interactionTypes';
import DebugDashboard from '@/components/canvasui/DebugDashboard';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useGestureRecognizer } from '@/hooks/useGestureRecognizer';
import { useWebcamFeed } from '@/hooks/useWebcamFeed';
import { useMemoryUsage } from '@/hooks/useMemoryUsage';
import Senate from '@/components/yjs-vis/Senate';
import { YjsProvider } from '@/components/context/YjsContext';
import getWebsocketUrl from '@/utils/websocketUtils';

// get the dynamic websocket url with connection type parameter
const baseUrl = getWebsocketUrl();
const videoUrl = new URL(baseUrl);
videoUrl.searchParams.set('type', 'video');
const WS_URL = videoUrl.toString();

// main display component that:
// - manages webcam feed
// - handles gesture recognition
// - processes video frames
// - manages canvas overlay
// - handles interactions
// - displays debug information
const Display: React.FC = () => {
  // refs for video and canvas management
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const remoteCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastFrameTimeRef = useRef<number>(Date.now());
  const overlayRef = useRef<HTMLDivElement>(null);
  const rtcConnectedRef = useRef<boolean>(false);
  const remoteStreamRef = useRef<MediaStream | null>(null);

  // state for selected camera device
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');

  // state for feed toggle when remote feed is available
  const [showLocalFeed, setShowLocalFeed] = useState<boolean>(false);

  // gesture state management
  const [leftGestureData, setLeftGestureData] = useState<GestureData | null>(
    null
  );
  const [rightGestureData, setRightGestureData] = useState<GestureData | null>(
    null
  );

  // remote gesture state management
  const [remoteLeftGestureData, setRemoteLeftGestureData] =
    useState<GestureData | null>(null);
  const [remoteRightGestureData, setRemoteRightGestureData] =
    useState<GestureData | null>(null);

  // canvas dimensions
  const canvasWidth = 1920;
  const canvasHeight = 1080;

  // debug visibility state
  const [showDebug, setShowDebug] = useState<boolean>(true);

  // get gesture recognizer instances. one is for the local hands and the other is for the remote hands
  const gestureRecognizer = useGestureRecognizer();
  const gestureRecognizer2 = useGestureRecognizer();

  // start webcam feed
  const { isVideoFeedStarted, startWebcam } = useWebcamFeed(
    localVideoRef,
    selectedDeviceId
  );

  // websocket connection state - now only used for video feed
  const {
    isConnected,
    connectionError,
    currentUser,
    connectedUsers,
    rtcConnected,
    rtcConnectionState,
    remoteStream,
    currentPing,
    pingHistory,
  } = useWebSocket(WS_URL, selectedDeviceId);

  // get memory usage data
  const memoryUsage = useMemoryUsage();

  // handle camera selection
  const handleCameraSelect = useCallback((deviceId: string) => {
    setSelectedDeviceId(deviceId);
  }, []);

  // start local webcam feed
  useEffect(() => {
    startWebcam();
  }, [startWebcam]);

  // handle remote stream
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // add an effect to update the refs when rtcConnected changes
  useEffect(() => {
    rtcConnectedRef.current = rtcConnected;
  }, [rtcConnected]);

  useEffect(() => {
    remoteStreamRef.current = remoteStream;
  }, [remoteStream]);

  // main webcam processing effect for both local and remote feeds
  useEffect(() => {
    // combined webcam processing loop for both local and remote feeds
    const processWebcams = () => {
      // process local webcam feed first
      if (localVideoRef.current && gestureRecognizer && canvasRef.current) {
        // check frame rate for local feed
        if (shouldProcessFrame(lastFrameTimeRef.current)) {
          lastFrameTimeRef.current = Date.now();

          // get canvas context for local feed
          const canvasElement = canvasRef.current;
          const canvasCtx = canvasElement.getContext('2d');

          if (canvasCtx) {
            // setup canvas and process frame
            const dimensions = { width: canvasWidth, height: canvasHeight };
            setupCanvas(canvasCtx, canvasElement, dimensions);

            // process local video frame and get results
            const results = processVideoFrame(
              canvasCtx,
              localVideoRef.current,
              gestureRecognizer,
              dimensions,
              {
                setLeftGestureData,
                setRightGestureData,
              }
            );

            if (results?.landmarks && results.handedness) {
              // get overlay rect for coordinate conversion
              const rect =
                overlayRef.current?.getBoundingClientRect() || new DOMRect();

              // this function sends events to the overlay
              const handleInteraction: InteractionEventHandler = (event) => {
                // dispatch custom event that bubbles up through the overlay
                if (overlayRef.current) {
                  const customEvent = new CustomEvent('interaction', {
                    bubbles: true,
                    composed: true,
                    detail: event,
                  });
                  // find the current visualization element
                  const visElement = overlayRef.current.firstElementChild;
                  if (visElement) {
                    visElement.dispatchEvent(customEvent);
                  }
                }
              };

              // process "one" gesture for hovering
              handleSvgOne(
                canvasCtx,
                results,
                rect,
                dimensions,
                handleInteraction
              );

              // process "grabbing" gesture for area hovering
              handleSvgGrabbing(
                canvasCtx,
                results,
                rect,
                dimensions,
                handleInteraction
              );

              // process "thumb_index" gesture for selection
              handleSvgThumbIndex(
                canvasCtx,
                results,
                rect,
                dimensions,
                handleInteraction
              );

              // process "ok" gesture for dragging and zooming
              handleSvgDrag(
                canvasCtx,
                results,
                rect,
                dimensions,
                handleInteraction
              );
            }

            canvasCtx.restore();
          }
        }
      }

      // process remote webcam feed after local
      if (
        remoteVideoRef.current &&
        gestureRecognizer2 &&
        remoteCanvasRef.current &&
        remoteStreamRef.current &&
        rtcConnectedRef.current
      ) {
        // get canvas context for remote feed
        const canvasElement = remoteCanvasRef.current;
        const canvasCtx = canvasElement.getContext('2d');

        if (canvasCtx) {
          // setup canvas and process frame
          const dimensions = { width: canvasWidth, height: canvasHeight };
          setupCanvas(canvasCtx, canvasElement, dimensions);

          // process remote video frame and get results - pass isRemote=true
          const results = processVideoFrame(
            canvasCtx,
            remoteVideoRef.current,
            gestureRecognizer2,
            dimensions,
            {
              setLeftGestureData: setRemoteLeftGestureData,
              setRightGestureData: setRemoteRightGestureData,
            },
            true // mark as remote hands
          );

          if (results?.landmarks && results.handedness) {
            // get overlay rect for coordinate conversion
            const rect =
              overlayRef.current?.getBoundingClientRect() || new DOMRect();

            // process "one" gesture for hovering
            handleSvgOneRemote(canvasCtx, results, rect, dimensions);

            // process "grabbing" gesture for area hovering
            handleSvgGrabbingRemote(canvasCtx, results, rect, dimensions);

            // process "thumb_index" gesture for selection
            handleSvgThumbIndexRemote(canvasCtx, results, rect, dimensions);

            // process "ok" gesture for dragging and zooming
            handleSvgDragRemote(canvasCtx, results, rect, dimensions);
          }
          canvasCtx.restore();
        }
      }

      // continue the animation loop
      requestAnimationFrame(processWebcams);
    };

    // start the combined processing loop
    processWebcams();
  }, [gestureRecognizer, gestureRecognizer2]);

  return (
    <div
      style={{
        position: 'absolute',
        width: canvasWidth,
        height: canvasHeight,
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      }}
    >
      {!isVideoFeedStarted && <p>Loading video feed...</p>}

      {/* YjsProvider wraps the visualization for syncing */}
      <YjsProvider>
        {/* visualization layer */}
        <div
          ref={overlayRef}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 4,
            width: '100%',
            height: '100%',
          }}
        >
          {/* Use Senate visualization from yjs-vis */}
          <Senate />
        </div>
      </YjsProvider>

      {/* canvas for local hand tracking visualization */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          zIndex: 3,
          width: '100%',
          height: '100%',
        }}
      />

      {/* canvas for remote hand tracking visualization - same z-index as local */}
      <canvas
        ref={remoteCanvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          zIndex: 3,
          width: '100%',
          height: '100%',
        }}
      />

      {/* local video element for gesture processing - always hidden */}
      <video
        ref={localVideoRef}
        id='local-webcam'
        style={{ display: 'none' }}
        playsInline
        muted
      />

      {/* video feed layer - at the bottom */}
      <div
        style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          zIndex: 1,
        }}
      >
        {/* local video element for display */}
        <video
          ref={localVideoRef}
          style={{
            display: 'block',
            position: 'absolute',
            width: '100%',
            height: '100%',
            objectFit: 'fill',
            visibility:
              !rtcConnectedRef.current || !remoteStream || showLocalFeed
                ? 'visible'
                : 'hidden',
            transform: 'scaleX(-1)', // mirror the feed
            filter: 'grayscale(100%)', // convert to grayscale
          }}
          playsInline
          muted
        />

        {/* remote video element for display */}
        <video
          ref={remoteVideoRef}
          id='remote-webcam'
          style={{
            display: 'block',
            position: 'absolute',
            width: '100%',
            height: '100%',
            objectFit: 'fill',
            visibility:
              rtcConnectedRef.current && remoteStream && !showLocalFeed
                ? 'visible'
                : 'hidden',
            transform: 'scaleX(-1)', // mirror the feed
            filter: 'grayscale(100%)', // convert to grayscale
          }}
          playsInline
          autoPlay
        />
      </div>

      {/* debug dashboard */}
      <DebugDashboard
        memoryUsage={memoryUsage}
        leftGestureData={leftGestureData}
        rightGestureData={rightGestureData}
        isConnected={isConnected}
        connectionError={connectionError}
        currentUser={currentUser}
        connectedUsers={connectedUsers}
        rtcConnected={rtcConnected}
        rtcConnectionState={rtcConnectionState}
        showDebug={showDebug}
        onToggleDebug={() => setShowDebug(!showDebug)}
        onCameraSelect={handleCameraSelect}
        showLocalFeed={showLocalFeed}
        onToggleFeed={() => setShowLocalFeed(!showLocalFeed)}
        remoteLeftGestureData={remoteLeftGestureData}
        remoteRightGestureData={remoteRightGestureData}
        currentPing={currentPing}
        pingHistory={pingHistory}
      />
    </div>
  );
};

export default Display;
