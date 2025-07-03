/**
 * TFlix TizenBrew Service
 * Backend service for handling additional functionality
 */

const express = require('express');
const cors = require('cors');
const app = express();

// Enable CORS for cross-origin requests
app.use(cors());
app.use(express.json());

// Service configuration
const config = {
    port: process.env.PORT || 3000,
    name: 'TFlix TV Service',
    version: '1.0.0'
};

// Middleware for logging
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: config.name,
        version: config.version,
        timestamp: new Date().toISOString()
    });
});

// Service info endpoint
app.get('/info', (req, res) => {
    res.json({
        name: config.name,
        version: config.version,
        description: 'Backend service for TFlix TizenBrew module',
        features: [
            'Remote control support',
            'Enhanced navigation',
            'Video player controls',
            'TV-optimized interface'
        ]
    });
});

// Remote control event endpoint
app.post('/remote-control', (req, res) => {
    const { action, data } = req.body;
    
    console.log('Remote control action:', action, data);
    
    // Handle different remote control actions
    switch (action) {
        case 'navigate':
            handleNavigation(data);
            break;
        case 'video-control':
            handleVideoControl(data);
            break;
        case 'search':
            handleSearch(data);
            break;
        default:
            console.log('Unknown action:', action);
    }
    
    res.json({ success: true, action, data });
});

// Navigation handler
function handleNavigation(data) {
    console.log('Navigation:', data.direction || data.target);
    // This could be extended to handle complex navigation logic
}

// Video control handler
function handleVideoControl(data) {
    console.log('Video control:', data.command, data.params);
    // Handle video-specific commands like play, pause, seek, etc.
}

// Search handler
function handleSearch(data) {
    console.log('Search query:', data.query);
    // Could be extended to provide enhanced search functionality
}

// User preferences endpoint
app.get('/preferences', (req, res) => {
    // Default preferences for TV usage
    res.json({
        navigation: {
            focusTimeout: 300,
            scrollBehavior: 'smooth',
            autoFocus: true
        },
        video: {
            autoPlay: false,
            defaultVolume: 0.7,
            seekInterval: 10
        },
        ui: {
            theme: 'dark',
            fontSize: 'large',
            reduceMotion: false
        }
    });
});

// Update preferences endpoint
app.post('/preferences', (req, res) => {
    const preferences = req.body;
    console.log('Updated preferences:', preferences);
    
    // In a real implementation, you might save these to a file or database
    res.json({ success: true, preferences });
});

// Statistics endpoint for usage tracking
app.get('/stats', (req, res) => {
    res.json({
        totalSessions: 0,
        averageSessionTime: 0,
        mostUsedFeatures: [],
        lastAccessed: new Date().toISOString()
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Service error:', error);
    res.status(500).json({
        error: 'Internal server error',
        message: error.message
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Not found',
        message: `Endpoint ${req.url} not found`
    });
});

// Start the service
function startService() {
    try {
        app.listen(config.port, () => {
            console.log(`${config.name} v${config.version} running on port ${config.port}`);
            console.log('Available endpoints:');
            console.log('  GET  /health - Health check');
            console.log('  GET  /info - Service information');
            console.log('  POST /remote-control - Remote control actions');
            console.log('  GET  /preferences - Get user preferences');
            console.log('  POST /preferences - Update user preferences');
            console.log('  GET  /stats - Usage statistics');
        });
    } catch (error) {
        console.error('Failed to start service:', error);
        process.exit(1);
    }
}

// Graceful shutdown handling
process.on('SIGINT', () => {
    console.log('\nShutting down TFlix TV Service...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\nShutting down TFlix TV Service...');
    process.exit(0);
});

// Start the service if this file is run directly
if (require.main === module) {
    startService();
}

module.exports = {
    app,
    startService,
    config
};
