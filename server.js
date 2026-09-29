const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const os = require('os');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store active connections and data
const connections = new Map();
const activeFiles = new Map();
const networkTraffic = [];

// Middleware
app.use(express.json());
app.use(express.static('public'));

// API Routes
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        uptime: process.uptime(),
        servers: activeFiles.size,
        connections: connections.size,
        memory: process.memoryUsage(),
        cpu: os.loadavg(),
        network: os.networkInterfaces()
    });
});

app.get('/api/files', (req, res) => {
    const files = Array.from(activeFiles.values()).map(file => ({
        ...file,
        url: `http://${req.headers.host}/hosted/${file.id}`
    }));
    res.json(files);
});

app.post('/api/upload', (req, res) => {
    const { filename, content } = req.body;
    const id = Date.now().toString();
    
    const file = {
        id,
        filename,
        content,
        uploaded: new Date(),
        connections: 0,
        traffic: 0
    };
    
    activeFiles.set(id, file);
    
    // Create hosted endpoint
    app.get(`/hosted/${id}`, (req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.send(file.content);
        
        // Update stats
        file.connections++;
        file.traffic += Buffer.byteLength(file.content, 'utf8');
    });
    
    // Broadcast update
    broadcast({
        type: 'file_added',
        file: { ...file, content: undefined }
    });
    
    res.json({ id, url: `http://${req.headers.host}/hosted/${id}` });
});

app.get('/api/network', (req, res) => {
    res.json({
        interfaces: os.networkInterfaces(),
        traffic: networkTraffic.slice(-100),
        packets: networkTraffic.length
    });
});

app.get('/api/processes', (req, res) => {
    const processes = [
        {
            name: 'node',
            pid: process.pid,
            cpu: process.cpuUsage(),
            memory: process.memoryUsage(),
            status: 'running'
        },
        {
            name: 'system',
            pid: 'system',
            cpu: { user: 0, system: 0 },
            memory: { rss: os.totalmem() - os.freemem() },
            status: 'running'
        }
    ];
    
    res.json(processes);
});

// WebSocket for real-time updates
wss.on('connection', (ws) => {
    const id = Date.now();
    connections.set(id, ws);
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleWebSocketMessage(id, data);
        } catch (error) {
            console.error('WebSocket message error:', error);
        }
    });
    
    ws.on('close', () => {
        connections.delete(id);
    });
    
    // Send initial data
    ws.send(JSON.stringify({
        type: 'init',
        data: {
            servers: Array.from(activeFiles.values()),
            connections: connections.size,
            system: {
                memory: os.totalmem(),
                freeMemory: os.freemem(),
                cpus: os.cpus().length
            }
        }
    }));
});

function handleWebSocketMessage(clientId, data) {
    switch (data.type) {
        case 'traffic':
            networkTraffic.push({
                ...data.payload,
                timestamp: new Date(),
                clientId
            });
            
            if (networkTraffic.length > 1000) {
                networkTraffic.shift();
            }
            
            broadcast({
                type: 'traffic_update',
                data: data.payload
            });
            break;
            
        case 'command':
            handleCommand(data.command, data.args);
            break;
    }
}

function broadcast(message) {
    const data = JSON.stringify(message);
    connections.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

function handleCommand(command, args) {
    switch (command) {
        case 'start_server':
            // Start additional server instance
            break;
        case 'stop_server':
            // Stop server instance
            break;
        case 'clear_logs':
            networkTraffic.length = 0;
            broadcast({ type: 'logs_cleared' });
            break;
    }
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
    🚀 PRO Network Hosting System
    📍 Running on port ${PORT}
    
    📊 Dashboard: http://localhost:${PORT}
    📡 WebSocket: ws://localhost:${PORT}
    📁 API: http://localhost:${PORT}/api/status
    
    Press Ctrl+C to stop
    `);
    
    // Log network interfaces
    const interfaces = os.networkInterfaces();
    console.log('\n🌐 Network Interfaces:');
    Object.entries(interfaces).forEach(([name, addrs]) => {
        addrs.forEach(addr => {
            if (addr.family === 'IPv4' && !addr.internal) {
                console.log(`   ${name}: ${addr.address}`);
            }
        });
    });
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n🛑 Shutting down gracefully...');
    
    // Close all connections
    connections.forEach(client => client.close());
    wss.close();
    
    server.close(() => {
        console.log('✅ Server stopped');
        process.exit(0);
    });
});