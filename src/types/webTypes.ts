import { WebSocket as WSWebSocket } from 'ws';

// message types for client-server communication
export enum MessageType {
  CONNECT = 'connect',
  DISCONNECT = 'disconnect',
  USER_LIST = 'user_list',
  RTC_OFFER = 'rtc_offer',
  RTC_ANSWER = 'rtc_answer',
  RTC_ICE_CANDIDATE = 'rtc_ice_candidate',
  INITIATE_RTC = 'initiate_rtc',
  ERROR = 'error',
  PING = 'ping',
  PONG = 'pong',
}

// user interface
export interface User {
  id: string;
  username: string;
}

// message data interface
export interface MessageData {
  id?: string;
  username?: string;
  users?: User[];
  message?: string;
  targetClientId?: number;
  shouldInitiate?: boolean;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

// unified message interface
export interface Message {
  type: MessageType;
  clientId?: number;
  targetClientId?: number;
  sourceClientId?: number;
  data?: MessageData;
}

// interface for connected clients
export interface ConnectedClient {
  id: number;
  ws: WSWebSocket;
}
