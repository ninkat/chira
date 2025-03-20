import { WebSocketServer, WebSocket } from 'ws';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { Message, MessageType, ConnectedClient } from '@/types/webTypes';
// port for the websocket server
const PORT = process.env.WS_PORT ? parseInt(process.env.WS_PORT, 10) : 8080;
// ssl certificate paths - these should be set in environment variables
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || './certificates/cert.pem';
const SSL_KEY_PATH = process.env.SSL_KEY_PATH || './certificates/key.pem';

// maximum number of allowed clients
const MAX_CLIENTS = 2;

class GestARServer {
  private wss: WebSocketServer;
  private httpsServer: https.Server;
  private clients: Set<ConnectedClient> = new Set();
  private nextClientId = 1;

  constructor() {
    // create https server with ssl certificates
    this.httpsServer = https.createServer({
      cert: fs.readFileSync(path.resolve(SSL_CERT_PATH)),
      key: fs.readFileSync(path.resolve(SSL_KEY_PATH)),
    });

    // create secure websocket server attached to https server
    this.wss = new WebSocketServer({ server: this.httpsServer });

    // start listening on the specified port
    this.httpsServer.listen(PORT, '0.0.0.0', () => {
      console.log(`secure websocket server running on port ${PORT}`);
    });

    // setup connection handler
    this.setupConnectionHandler();
  }

  // handle new connections
  private setupConnectionHandler(): void {
    // do this when connection attempt happens
    this.wss.on('connection', (ws: WebSocket, req) => {
      // log connection attempt with ip address
      const ip = req.socket.remoteAddress;
      console.log(`[server] connection attempt from ${ip}`);

      // check if max clients reached
      if (this.clients.size >= MAX_CLIENTS) {
        console.log(
          `[server] rejecting client connection: max clients (${MAX_CLIENTS}) reached`
        );
        this.sendToClient(ws, {
          type: MessageType.ERROR,
          data: { message: 'max clients reached' },
        });
        ws.close();
        return;
      }

      // create new client
      const clientId = this.nextClientId++;
      const client: ConnectedClient = {
        id: clientId,
        ws,
      };

      // add to clients set
      this.clients.add(client);

      console.log(
        `[server] client ${clientId} connected. total clients: ${this.clients.size}`
      );

      // notify client of their id
      this.sendToClient(ws, {
        type: MessageType.CONNECT,
        clientId,
        data: {
          id: clientId.toString(),
          username: `user ${clientId}`,
        },
      });

      // broadcast updated client list
      this.broadcastClientList();

      // if we now have exactly 2 clients, initiate webrtc connection
      if (this.clients.size === MAX_CLIENTS) {
        console.log(
          '[server] two clients connected, initiating webrtc connection'
        );
        this.initiateWebRTCConnection();
      }

      // handle messages from client
      ws.on('message', (message: string) => {
        try {
          const data = JSON.parse(message.toString()) as Message;
          this.handleClientMessage(client, data);
        } catch (error) {
          console.error('error processing message:', error);
        }
      });

      // handle client disconnect
      ws.on('close', () => {
        this.handleClientDisconnect(client);
      });
    });
  }

  // initiate webrtc connection between the two clients
  private initiateWebRTCConnection(): void {
    // get the two clients
    const clients = Array.from(this.clients);
    if (clients.length !== 2) return;

    // tell the first client to initiate the connection
    this.sendToClient(clients[0].ws, {
      type: MessageType.INITIATE_RTC,
      data: {
        targetClientId: clients[1].id,
        shouldInitiate: true,
      },
    });

    // tell the second client to expect an offer
    this.sendToClient(clients[1].ws, {
      type: MessageType.INITIATE_RTC,
      data: {
        targetClientId: clients[0].id,
        shouldInitiate: false,
      },
    });
  }

  // handle messages from clients
  private handleClientMessage(client: ConnectedClient, message: Message): void {
    // handle different message types
    switch (message.type) {
      case MessageType.RTC_OFFER:
      case MessageType.RTC_ANSWER:
      case MessageType.RTC_ICE_CANDIDATE:
        if (message.targetClientId) {
          const targetClient = Array.from(this.clients).find(
            (c) => c.id === message.targetClientId
          );
          if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
            this.sendToClient(targetClient.ws, {
              ...message,
              sourceClientId: client.id,
            });
          }
        }
        break;

      case MessageType.PING:
        // respond to ping with pong
        this.sendToClient(client.ws, { type: MessageType.PONG });
        break;

      default:
        console.log(
          `[server] received message from client ${client.id}:`,
          message
        );
    }
  }

  // handle client disconnect
  private handleClientDisconnect(client: ConnectedClient): void {
    this.clients.delete(client);
    console.log(
      `[server] client ${client.id} disconnected. total clients: ${this.clients.size}`
    );

    // notify remaining clients about the disconnection
    this.broadcast({
      type: MessageType.DISCONNECT,
      clientId: client.id,
    });

    // broadcast updated client list
    this.broadcastClientList();
  }

  // send message to specific client
  private sendToClient(ws: WebSocket, message: Message): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  // broadcast message to all clients
  private broadcast(message: Message): void {
    this.clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        this.sendToClient(client.ws, message);
      }
    });
  }

  // broadcast current client list to all clients
  private broadcastClientList(): void {
    const clientList = Array.from(this.clients).map((client) => ({
      id: client.id.toString(),
      username: `user ${client.id}`,
    }));

    this.broadcast({
      type: MessageType.USER_LIST,
      data: { users: clientList },
    });
  }

  // stop the server
  public stop(): void {
    this.wss.close();
    this.httpsServer.close();
    console.log('secure websocket server stopped');
  }
}

// create and export server instance
const server = new GestARServer();

// handle process termination
process.on('SIGINT', () => {
  server.stop();
  process.exit();
});

export default server;
