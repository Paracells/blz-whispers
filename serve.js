#!/usr/bin/env node
/*
 * A small zero-dependency web server for blz's whispers.
 *
 * The application uses AudioWorklet and fetches the XM modules at runtime,
 * both of which browsers refuse to do from file:// pages. This serves the
 * folder over http://127.0.0.1 and opens the default browser.
 *
 *   node serve.js
 *   node serve.js --port 9000
 *   node serve.js --no-open
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = __dirname;
const HOST = '127.0.0.1';
const DEFAULT_PORT = 8080;
const PORT_ATTEMPTS = 12;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.xm': 'application/octet-stream',
  '.mod': 'application/octet-stream',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
};

const args = process.argv.slice(2);
const noOpen = args.includes('--no-open') || process.env.NO_OPEN === '1';
const portArgIndex = args.findIndex((arg) => arg === '--port' || arg === '-p');
const portArg = portArgIndex >= 0 ? Number(args[portArgIndex + 1]) : NaN;
const inlinePort = args.find((arg) => /^--port=\d+$/.test(arg));
const preferredPort = Number.isInteger(portArg) && portArg > 0
  ? portArg
  : inlinePort
    ? Number(inlinePort.split('=')[1])
    : Number(process.env.PORT) || DEFAULT_PORT;

let activePort = preferredPort;

const server = http.createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, {
      Allow: 'GET, HEAD',
      'Content-Type': 'text/plain; charset=utf-8',
    });
    response.end('Method not allowed.\n');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${HOST}`).pathname);
  } catch (error) {
    sendError(response, 400, 'Bad request', 'That URL could not be decoded.');
    return;
  }

  if (pathname.includes('\0')) {
    sendError(response, 400, 'Bad request', 'That path is not valid.');
    return;
  }

  let relative = pathname.replace(/^[/\\]+/, '');
  if (!relative || pathname.endsWith('/')) relative = path.join(relative, 'index.html');

  const filePath = path.resolve(ROOT, relative);
  const rootPrefix = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;

  if (filePath !== ROOT && !filePath.startsWith(rootPrefix)) {
    sendError(response, 403, 'Forbidden', 'That path is outside the musicdisk folder.');
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError) {
      sendError(response, 404, 'Not found', 'There is no page or file at that address.');
      return;
    }

    let target = filePath;
    if (stats.isDirectory()) {
      target = path.join(filePath, 'index.html');
    }

    fs.stat(target, (targetError, targetStats) => {
      if (targetError || !targetStats.isFile()) {
        sendError(response, 404, 'Not found', 'There is no page or file at that address.');
        return;
      }

      const extension = path.extname(target).toLowerCase();
      const contentType = MIME[extension] || 'application/octet-stream';
      const headers = {
        'Content-Type': contentType,
        'Content-Length': targetStats.size,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Accept-Ranges': 'none',
      };

      response.writeHead(200, headers);

      if (request.method === 'HEAD') {
        response.end();
        return;
      }

      const stream = fs.createReadStream(target);
      stream.on('error', () => {
        if (!response.headersSent) {
          sendError(response, 500, 'Server error', 'The file could not be read.');
        } else {
          response.destroy();
        }
      });
      stream.pipe(response);
    });
  });
});

function sendError(response, status, title, detail) {
  if (response.headersSent) {
    response.end();
    return;
  }

  const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — whispers</title>
  <style>
    html, body { height: 100%; margin: 0; }
    body {
      display: grid;
      place-items: center;
      padding: 32px;
      color: #eee6d5;
      background: #0a0c0b;
      font-family: Georgia, serif;
    }
    main { max-width: 540px; text-align: center; }
    p { color: rgba(238, 230, 213, .62); line-height: 1.6; }
    a { color: #dfa05c; }
    code { color: #eee6d5; }
  </style>
</head>
<body>
  <main>
    <p>${status}</p>
    <h1>${title}</h1>
    <p>${detail}</p>
    <p><a href="/">Return to the calendar</a></p>
    <p><code>whispers</code> must be opened through <code>start.bat</code> or <code>node serve.js</code>.</p>
  </main>
</body>
</html>`;

  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function openBrowser(url) {
  if (noOpen) return;

  let command;
  let commandArgs;

  if (process.platform === 'win32') {
    command = 'cmd.exe';
    commandArgs = ['/c', 'start', '', url];
  } else if (process.platform === 'darwin') {
    command = 'open';
    commandArgs = [url];
  } else {
    command = 'xdg-open';
    commandArgs = [url];
  }

  execFile(command, commandArgs, { windowsHide: true }, (error) => {
    if (error) {
      console.log(`  Could not open the browser automatically. Open ${url}`);
    }
  });
}

function startListening(port, attemptsLeft) {
  const onError = (error) => {
    server.removeListener('listening', onListening);

    if (error.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`  Port ${port} is busy, trying ${port + 1}…`);
      startListening(port + 1, attemptsLeft - 1);
      return;
    }

    console.error(`\n  Could not start the whispers server: ${error.message}`);
    if (error.code === 'EADDRINUSE') {
      console.error('  Stop the program using that port, or run: node serve.js --port 9000');
    }
    process.exitCode = 1;
  };

  const onListening = () => {
    server.removeListener('error', onError);
    activePort = port;
    const url = `http://localhost:${port}/`;

    console.log('');
    console.log("  blz's whispers — local musicdisk");
    console.log('  --------------------------------------------------');
    console.log(`  playing at  ${url}`);
    console.log(`  serving     ${ROOT}`);
    console.log('  stop        Ctrl+C');
    console.log('');

    openBrowser(url);
  };

  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port, HOST);
}

startListening(preferredPort, PORT_ATTEMPTS);

function shutDown() {
  console.log('\n  Closing the whispers server.');
  server.close(() => process.exit(0));

  // Do not wait forever for keep-alive sockets.
  setTimeout(() => process.exit(0), 1200).unref();
}

process.on('SIGINT', shutDown);
process.on('SIGTERM', shutDown);

process.on('uncaughtException', (error) => {
  console.error('\n  whispers server error:', error);
  process.exitCode = 1;
  server.close(() => process.exit(1));
});
