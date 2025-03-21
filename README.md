# GestAR-M

A collaborative gesture-based visualization system that allows two users to interact with the same visualization simultaneously using hand gestures.

## Getting Started

### Install required packages

```sh
npm install
```

### Generate the locally-trusted certificates (requires mkcert)

```sh
./gencert.sh
```

### Starting the WebSocket server

```sh
npm run server
```

You can stop the server by pressing `Ctrl+C` in the terminal. The server will gracefully shut down by closing all active WebSocket connections before exiting.

### Starting the client dev server

```sh
npm run dev
```

You can stop the client dev server by pressing `q` in the terminal.

> ⚠️ Once the application is running, you may need to grant webcam access under your browsers settings. Otherwise the webcam feed may be empty.
> ⚠️ All video sources are limited to 30fps for performance reasons.

## WebSocket Connection

The application automatically establishes a secure WebSocket connection. The connection URL is dynamically determined based on your current browsing context:

- Protocol: Matches your current protocol (`wss://` for HTTPS, `ws://` for HTTP)
- Host: Uses your current hostname
- Port: Uses port 8080 by default (configurable via environment variable WS_PORT)

For example, when developing locally, it would connect to `wss://localhost:8080`.

## Code Structure (src)

```sh
src
|
+-- app               # contains main application component
|
+-- assets            # contains datasets and gesture recongition models
|
+-- components        # shared components used across the entire application
|
+-- hooks             # shared hooks used across the entire application
|
+-- server            # websocket server implementation
|
+-- types             # shared types used across the application
|
+-- utils             # shared utility functions
```
