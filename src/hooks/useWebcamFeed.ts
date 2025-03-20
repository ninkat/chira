import { useEffect, useState, useCallback } from 'react';

// custom hook for managing webcam video feed
// takes a video element ref and returns whether the feed has started
export const useWebcamFeed = (
  videoRef: React.RefObject<HTMLVideoElement>,
  selectedDeviceId?: string
) => {
  // track whether the video feed has successfully started
  const [isVideoFeedStarted, setIsVideoFeedStarted] = useState(false);

  // function to start the webcam feed
  const startWebcam = useCallback(async () => {
    try {
      // stop any existing stream
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
      }

      // request access to user's webcam with specific device if provided and limit to 30fps
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(selectedDeviceId
            ? { deviceId: { exact: selectedDeviceId } }
            : {}),
          frameRate: { max: 30 }, // limit to 30fps
        },
      });

      // if we have a video element, set up the stream
      if (videoRef.current) {
        // connect the webcam stream to the video element
        videoRef.current.srcObject = stream;

        // wait for the video to load its metadata and start playing
        videoRef.current.onloadeddata = () => {
          videoRef.current?.play();
          setIsVideoFeedStarted(true);
        };
      }
    } catch (error) {
      console.error('error accessing webcam:', error);
      setIsVideoFeedStarted(false);
    }
  }, [videoRef, selectedDeviceId]);

  // initialize webcam feed on component mount or when device changes
  useEffect(() => {
    startWebcam();

    // cleanup function to stop the stream when unmounting or changing devices
    return () => {
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [startWebcam]); // re-run when device selection changes

  return { isVideoFeedStarted, startWebcam };
};
