import React, { useEffect } from 'react';
import { GestureData } from '@/types/types';
import { User } from '@/types/webTypes';
import { useCameraDevices } from '@/hooks/useCameraDevices';

// props interface for the debug dashboard
interface DebugDashboardProps {
  // memory usage props
  memoryUsage: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
  };
  // gesture props
  leftGestureData: GestureData | null;
  rightGestureData: GestureData | null;
  // remote gesture props
  remoteLeftGestureData?: GestureData | null;
  remoteRightGestureData?: GestureData | null;
  // connection props
  isConnected: boolean;
  connectionError: string | null;
  currentUser: User | null;
  connectedUsers: User[];
  // webrtc props
  rtcConnected: boolean;
  rtcConnectionState: RTCPeerConnectionState | null;
  isLeader: boolean;
  // visibility props
  showDebug: boolean;
  onToggleDebug: () => void;
  // camera selection props
  onCameraSelect: (deviceId: string) => void;
  // feed toggle props
  showLocalFeed: boolean;
  onToggleFeed: () => void;
  // ping props
  currentPing: number | null;
  pingHistory: number[];
  // visualization selection props
  selectedVisualization: 'nodelink' | 'usmap' | 'ustile' | 'worldmap' | 'foaf';
  onVisualizationSelect: (
    visualization: 'nodelink' | 'usmap' | 'ustile' | 'worldmap' | 'foaf'
  ) => void;
}

// helper function to render gesture data
const renderGestureSection = (
  gestureData: GestureData | null | undefined,
  handLabel: string
) => {
  if (!gestureData) {
    return (
      <div className='gesture-section' style={{ minHeight: '40px' }}>
        <h4
          style={{
            margin: '0 0 4px 0',
            fontSize: '12px',
            whiteSpace: 'nowrap',
            color: '#888',
          }}
        >
          {handLabel}
        </h4>
        <p
          style={{
            margin: '0',
            fontSize: '11px',
            opacity: 0.7,
            fontStyle: 'italic',
          }}
        >
          not detected
        </p>
      </div>
    );
  }

  return (
    <div className='gesture-section' style={{ minHeight: '40px' }}>
      <h4
        style={{
          margin: '0 0 4px 0',
          fontSize: '12px',
          whiteSpace: 'nowrap',
          color: '#888',
        }}
      >
        {handLabel}
      </h4>
      <div style={{ height: '24px' }}>
        <p
          style={{
            margin: '0 0 6px 0',
            fontSize: '11px',
            whiteSpace: 'nowrap',
          }}
        >
          {gestureData.categoryName}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div
            style={{
              flex: 1,
              background: 'rgba(255, 255, 255, 0.1)',
              height: '4px',
              borderRadius: '2px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${gestureData.confidence * 100}%`,
                height: '100%',
                background: '#4CAF50',
                boxShadow: '0 0 4px rgba(76, 175, 80, 0.5)',
              }}
            />
          </div>
          <span
            style={{
              fontSize: '10px',
              opacity: 0.7,
              width: '22px',
              textAlign: 'right',
            }}
          >
            {(gestureData.confidence * 100).toFixed(0)}%
          </span>
        </div>
      </div>
    </div>
  );
};

// helper function to render ping chart
const renderPingChart = (pingHistory: number[]) => {
  if (pingHistory.length === 0) return null;

  const maxPing = Math.max(...pingHistory);
  const minPing = Math.min(...pingHistory);
  const height = 40;
  const width = 120;
  const padding = 2;

  return (
    <svg
      width={width}
      height={height}
      style={{
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        borderRadius: '3px',
      }}
    >
      {pingHistory.map((ping, i) => {
        const x = (i * (width - padding * 2)) / 29 + padding;
        const normalizedPing =
          maxPing === minPing ? 0.5 : (ping - minPing) / (maxPing - minPing);
        const y = height - (normalizedPing * (height - padding * 2) + padding);

        return (
          <circle key={i} cx={x} cy={y} r={1} fill='#2196F3' opacity={0.7} />
        );
      })}
      {pingHistory.length > 1 &&
        pingHistory.map((ping, i) => {
          if (i === 0) return null;
          const x1 = ((i - 1) * (width - padding * 2)) / 29 + padding;
          const x2 = (i * (width - padding * 2)) / 29 + padding;
          const normalizedPing1 =
            maxPing === minPing
              ? 0.5
              : (pingHistory[i - 1] - minPing) / (maxPing - minPing);
          const normalizedPing2 =
            maxPing === minPing ? 0.5 : (ping - minPing) / (maxPing - minPing);
          const y1 =
            height - (normalizedPing1 * (height - padding * 2) + padding);
          const y2 =
            height - (normalizedPing2 * (height - padding * 2) + padding);

          return (
            <line
              key={`line-${i}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke='#2196F3'
              strokeWidth={0.5}
              opacity={0.3}
            />
          );
        })}
    </svg>
  );
};

const DebugDashboard: React.FC<DebugDashboardProps> = ({
  memoryUsage,
  leftGestureData,
  rightGestureData,
  remoteLeftGestureData,
  remoteRightGestureData,
  isConnected,
  connectionError,
  currentUser,
  connectedUsers,
  rtcConnected,
  rtcConnectionState,
  isLeader,
  showDebug,
  onToggleDebug,
  onCameraSelect,
  showLocalFeed,
  onToggleFeed,
  currentPing,
  pingHistory,
  selectedVisualization,
  onVisualizationSelect,
}) => {
  // use the camera devices hook
  const {
    devices,
    selectedDevice,
    setSelectedDevice,
    error: cameraError,
  } = useCameraDevices();

  // handle device selection
  const handleDeviceChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const deviceId = event.target.value;
    setSelectedDevice(deviceId);
    onCameraSelect(deviceId);
  };

  // Add this effect to propagate the initial device selection
  useEffect(() => {
    if (selectedDevice) {
      onCameraSelect(selectedDevice);
    }
  }, [selectedDevice, onCameraSelect]);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        right: 0,
        backgroundColor: 'rgba(17, 17, 17, 0.95)',
        color: '#e0e0e0',
        padding: '8px 16px',
        borderTopLeftRadius: '12px',
        fontFamily: 'monospace',
        zIndex: 4,
        width: '280px',
        boxShadow:
          '0 -4px 20px rgba(0, 0, 0, 0.4), 0 0 16px rgba(0, 0, 0, 0.2)',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        borderRight: 'none',
        borderBottom: 'none',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div style={{ position: 'relative' }}>
        {/* toggle button */}
        <button
          onClick={onToggleDebug}
          style={{
            position: 'absolute',
            top: '-36px',
            left: 0,
            padding: '8px 14px',
            borderTopLeftRadius: '12px',
            borderTopRightRadius: '12px',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderBottom: 'none',
            backgroundColor: 'rgba(17, 17, 17, 0.95)',
            cursor: 'pointer',
            color: '#e0e0e0',
            fontFamily: 'monospace',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.2s ease',
            boxShadow: '0 -4px 12px rgba(0, 0, 0, 0.3)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <span>{showDebug ? '🔍' : '👁️'}</span>
          <span>{showDebug ? 'hide' : 'show'}</span>
        </button>

        {showDebug && (
          <>
            {/* visualization selection section */}
            <div
              style={{
                marginBottom: '16px',
                marginTop: '8px',
                padding: '8px 12px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.15)',
                minHeight: '40px',
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                borderRadius: '8px',
                boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.2)',
              }}
            >
              <h3
                style={{ margin: '0 0 4px 0', fontSize: '14px', color: '#888' }}
              >
                visualization selection
              </h3>
              <div style={{ fontSize: '12px' }}>
                <select
                  id='visualization-select'
                  value={selectedVisualization}
                  onChange={(e) =>
                    onVisualizationSelect(
                      e.target.value as
                        | 'nodelink'
                        | 'usmap'
                        | 'ustile'
                        | 'worldmap'
                        | 'foaf'
                    )
                  }
                  style={{
                    width: '100%',
                    background: 'rgba(0, 0, 0, 0.3)',
                    color: '#e0e0e0',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    cursor: 'pointer',
                    boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.2)',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <option value='nodelink'>node link diagram</option>
                  <option value='usmap'>us map</option>
                  <option value='ustile'>us tilemap</option>
                  <option value='worldmap'>world map</option>
                  <option value='foaf'>friend of a friend</option>
                </select>
              </div>
            </div>

            {/* camera selection section */}
            <div
              style={{
                marginBottom: '16px',
                padding: '8px 12px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.15)',
                minHeight: '40px',
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                borderRadius: '8px',
                boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.2)',
              }}
            >
              <h3
                style={{ margin: '0 0 4px 0', fontSize: '14px', color: '#888' }}
              >
                camera selection
              </h3>
              <div style={{ fontSize: '12px' }}>
                <select
                  id='camera-select'
                  value={selectedDevice}
                  onChange={handleDeviceChange}
                  style={{
                    width: '100%',
                    background: 'rgba(0, 0, 0, 0.3)',
                    color: '#e0e0e0',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    cursor: 'pointer',
                    boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.2)',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {devices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label ||
                        `camera ${device.deviceId.slice(0, 5)}...`}
                    </option>
                  ))}
                </select>
                {cameraError && (
                  <div
                    style={{
                      color: '#F44336',
                      fontSize: '11px',
                      marginTop: '4px',
                    }}
                  >
                    {cameraError}
                  </div>
                )}
              </div>
            </div>

            {/* memory section */}
            <div
              style={{
                marginBottom: '16px',
                padding: '8px 12px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.15)',
                minHeight: '40px',
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                borderRadius: '8px',
                boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.2)',
              }}
            >
              <h3
                style={{ margin: '0 0 4px 0', fontSize: '14px', color: '#888' }}
              >
                memory usage
              </h3>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '12px',
                }}
              >
                <span>
                  used:{' '}
                  {(memoryUsage.usedJSHeapSize / (1024 * 1024)).toFixed(1)} mb
                </span>
                <span>
                  total:{' '}
                  {(memoryUsage.totalJSHeapSize / (1024 * 1024)).toFixed(1)} mb
                </span>
              </div>
            </div>

            {/* gesture section */}
            <div
              style={{
                marginBottom: '16px',
                padding: '8px 12px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.15)',
                minHeight: '80px',
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                borderRadius: '8px',
                boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.2)',
              }}
            >
              <h3
                style={{ margin: '0 0 6px 0', fontSize: '14px', color: '#888' }}
              >
                gesture detection (local)
              </h3>
              <div style={{ display: 'flex', minHeight: '50px' }}>
                <div style={{ width: '50%', paddingRight: '8px' }}>
                  {renderGestureSection(leftGestureData, 'left hand')}
                </div>
                <div style={{ width: '50%', paddingLeft: '8px' }}>
                  {renderGestureSection(rightGestureData, 'right hand')}
                </div>
              </div>
            </div>

            {/* remote gesture section - only show when rtc is connected */}
            {rtcConnected && (
              <div
                style={{
                  marginBottom: '16px',
                  padding: '8px 12px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.15)',
                  minHeight: '80px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  borderRadius: '8px',
                  boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.2)',
                }}
              >
                <h3
                  style={{
                    margin: '0 0 6px 0',
                    fontSize: '14px',
                    color: '#888',
                  }}
                >
                  gesture detection (remote)
                </h3>
                <div style={{ display: 'flex', minHeight: '50px' }}>
                  <div style={{ width: '50%', paddingRight: '8px' }}>
                    {renderGestureSection(remoteLeftGestureData, 'left hand')}
                  </div>
                  <div style={{ width: '50%', paddingLeft: '8px' }}>
                    {renderGestureSection(remoteRightGestureData, 'right hand')}
                  </div>
                </div>
              </div>
            )}

            {/* connection section */}
            <div
              style={{
                padding: '8px 12px',
                minHeight: '40px',
                marginBottom: '16px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.15)',
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                borderRadius: '8px',
                boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.2)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '6px',
                }}
              >
                <h3 style={{ margin: '0', fontSize: '14px', color: '#888' }}>
                  websocket
                </h3>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '12px',
                    backgroundColor: isConnected
                      ? 'rgba(76, 175, 80, 0.15)'
                      : 'rgba(244, 67, 54, 0.15)',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    border: `1px solid ${isConnected ? '#4CAF50' : '#F44336'}`,
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
                  }}
                >
                  <div
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      backgroundColor: isConnected ? '#4CAF50' : '#F44336',
                    }}
                  />
                  <span style={{ color: isConnected ? '#4CAF50' : '#F44336' }}>
                    {isConnected ? 'connected' : 'disconnected'}
                  </span>
                </div>
              </div>

              {connectionError && (
                <div
                  style={{
                    color: '#F44336',
                    fontSize: '11px',
                    marginBottom: '6px',
                    padding: '6px 8px',
                    backgroundColor: 'rgba(244, 67, 54, 0.1)',
                    borderRadius: '6px',
                    boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.2)',
                  }}
                >
                  {connectionError}
                </div>
              )}

              {connectedUsers.length > 0 && (
                <div style={{ fontSize: '12px' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      marginBottom: '4px',
                    }}
                  >
                    <span style={{ color: '#888' }}>users online:</span>
                    <span
                      style={{
                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                        padding: '0 4px',
                        borderRadius: '4px',
                        fontSize: '11px',
                      }}
                    >
                      {connectedUsers.length}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '4px',
                      fontSize: '11px',
                    }}
                  >
                    {connectedUsers.map((user) => (
                      <span
                        key={user.id}
                        style={{
                          backgroundColor: 'rgba(255, 255, 255, 0.08)',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          color:
                            currentUser && user.id === currentUser.id
                              ? '#4CAF50'
                              : '#e0e0e0',
                          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
                        }}
                      >
                        {user.username}
                        {currentUser && user.id === currentUser.id && ' (you)'}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* webrtc section */}
            <div
              style={{
                marginBottom: '16px',
                padding: '8px 12px 4px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.15)',
                minHeight: '40px',
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                borderRadius: '8px',
                boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.2)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '6px',
                }}
              >
                <h3 style={{ margin: '0', fontSize: '14px', color: '#888' }}>
                  webrtc
                </h3>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '12px',
                    backgroundColor: rtcConnected
                      ? 'rgba(33, 150, 243, 0.15)'
                      : 'rgba(158, 158, 158, 0.15)',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    border: `1px solid ${rtcConnected ? '#2196F3' : '#9E9E9E'}`,
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
                  }}
                >
                  <div
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      backgroundColor: rtcConnected ? '#2196F3' : '#9E9E9E',
                    }}
                  />
                  <span style={{ color: rtcConnected ? '#2196F3' : '#9E9E9E' }}>
                    {rtcConnected ? 'active' : 'inactive'}
                  </span>
                </div>

                {/* leader indicator - show only when connected and there are two users */}
                {rtcConnected && connectedUsers.length === 2 && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '12px',
                      backgroundColor: isLeader
                        ? 'rgba(255, 215, 0, 0.15)'
                        : 'rgba(158, 158, 158, 0.15)',
                      padding: '4px 8px',
                      borderRadius: '6px',
                      border: `1px solid ${isLeader ? '#FFD700' : '#9E9E9E'}`,
                      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
                    }}
                  >
                    <div
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        backgroundColor: isLeader ? '#FFD700' : '#9E9E9E',
                      }}
                    />
                    <span style={{ color: isLeader ? '#FFD700' : '#9E9E9E' }}>
                      {isLeader ? 'leader' : 'follower'}
                    </span>
                  </div>
                )}
              </div>

              {rtcConnectionState && (
                <div style={{ fontSize: '12px', marginBottom: '2px' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <span style={{ color: '#888' }}>state:</span>
                    <span
                      style={{
                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
                        color:
                          rtcConnectionState === 'connected'
                            ? '#2196F3'
                            : rtcConnectionState === 'connecting'
                              ? '#FF9800'
                              : rtcConnectionState === 'disconnected'
                                ? '#F44336'
                                : rtcConnectionState === 'failed'
                                  ? '#F44336'
                                  : rtcConnectionState === 'closed'
                                    ? '#9E9E9E'
                                    : '#e0e0e0',
                      }}
                    >
                      {rtcConnectionState}
                    </span>
                  </div>
                </div>
              )}

              {/* feed toggle button */}
              {rtcConnected && (
                <div
                  style={{
                    fontSize: '12px',
                    marginTop: '6px',
                    marginBottom: '2px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      marginBottom: '4px',
                    }}
                  >
                    <span style={{ color: '#888' }}>active feed:</span>
                    <span
                      style={{
                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
                      }}
                    >
                      {rtcConnected && !showLocalFeed ? 'remote' : 'local'}
                    </span>
                  </div>
                  <button
                    onClick={onToggleFeed}
                    disabled={!rtcConnected}
                    style={{
                      width: '100%',
                      background: rtcConnected
                        ? 'rgba(33, 150, 243, 0.15)'
                        : 'rgba(158, 158, 158, 0.08)',
                      border: `1px solid ${rtcConnected ? '#2196F3' : '#9E9E9E'}`,
                      color: rtcConnected ? '#e0e0e0' : '#9E9E9E',
                      padding: '6px 10px',
                      borderRadius: '6px',
                      cursor: rtcConnected ? 'pointer' : 'not-allowed',
                      fontSize: '11px',
                      fontFamily: 'monospace',
                      marginTop: '4px',
                      boxShadow: rtcConnected
                        ? '0 1px 3px rgba(0, 0, 0, 0.2)'
                        : 'none',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    switch to {showLocalFeed ? 'remote' : 'local'} feed
                  </button>
                </div>
              )}

              {!rtcConnected && connectedUsers.length === 2 && (
                <div
                  style={{
                    fontSize: '11px',
                    backgroundColor: 'rgba(255, 152, 0, 0.1)',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    marginTop: '6px',
                    marginBottom: '2px',
                    boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.2)',
                  }}
                >
                  <span>establishing peer connection...</span>
                </div>
              )}

              {/* ping display - only show when rtc is connected */}
              {rtcConnected && (
                <div
                  style={{
                    fontSize: '12px',
                    marginTop: '6px',
                    marginBottom: '2px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginBottom: '4px',
                    }}
                  >
                    <span style={{ color: '#888' }}>ping:</span>
                    <span
                      style={{
                        backgroundColor: 'rgba(33, 150, 243, 0.1)',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        color: currentPing === null ? '#9E9E9E' : '#2196F3',
                        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
                      }}
                    >
                      {currentPing === null ? 'n/a' : `${currentPing}ms`}
                    </span>
                    <div style={{ marginLeft: 'auto' }}>
                      {renderPingChart(pingHistory)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default DebugDashboard;
