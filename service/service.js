const express = require('express');
const cors = require('cors');
const app = express();

const corsOptions = {
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    optionsSuccessStatus: 204
};

app.use(cors(corsOptions));

const PORT = 8085;

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'TFlix TV Service',
        version: '1.0.0'
    });
});

// API routes for TFlix
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        service: 'TFlix',
        timestamp: new Date().toISOString()
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`TFlix service listening on port ${PORT}`);
});

// Make the app accessible to tizen API
module.exports = app;
