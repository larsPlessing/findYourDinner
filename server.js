const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const rootDirectory = __dirname;
const host = '127.0.0.1';
const port = Number(process.env.PORT || 4004);

const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.manifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

const server = http.createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' });
        response.end('Method not allowed');
        return;
    }

    let requestedPath;
    try {
        requestedPath = decodeURIComponent(new URL(request.url, `http://${host}`).pathname);
    } catch {
        response.writeHead(400);
        response.end('Bad request');
        return;
    }

    const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.slice(1);
    const filePath = path.resolve(rootDirectory, relativePath);
    const pathFromRoot = path.relative(rootDirectory, filePath);
    if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(pathFromRoot)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
    }

    fs.stat(filePath, (statError, stats) => {
        if (statError || !stats.isFile()) {
            response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('Not found');
            return;
        }

        response.writeHead(200, {
            'Content-Length': stats.size,
            'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff'
        });

        if (request.method === 'HEAD') {
            response.end();
            return;
        }

        fs.createReadStream(filePath).pipe(response);
    });
});

server.listen(port, host, () => {
    console.log(`Rezeptfinder läuft auf http://localhost:${port}`);
    console.log('Zum Beenden Strg+C drücken.');
});

server.on('error', error => {
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${port} wird bereits verwendet. Starte mit PORT=8001 node server.js für einen anderen Port.`);
    } else {
        console.error('Server konnte nicht gestartet werden:', error.message);
    }
    process.exitCode = 1;
});
