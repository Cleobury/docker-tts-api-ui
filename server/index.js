const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios'); // Add this to your package.json: npm install axios
const ffmpeg = require('fluent-ffmpeg');
const keys = require('./keys.json');
const { DateTime } = require('luxon');
const { v4: uuidv4 } = require('uuid');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const app = express();
const port = 2902;
const pythonEngineUrl = 'http://127.0.0.1:5000/generate'; // The Resident Python process

// Use system ffmpeg for Blackwell compatibility
const ffmpegPath = '/usr/bin/ffmpeg';
ffmpeg.setFfmpegPath(ffmpegPath);

const voicesPath = '/shared/voices';
const publicPath = '/shared/server/public';

// Ensure the public directory exists for your 5090 to write to
if (!fs.existsSync(publicPath)) {
    fs.mkdirSync(publicPath, { recursive: true });
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Swagger Configuration
const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'XTTS v2 Blackwell API',
            version: '1.0.0',
            description: 'High-speed Neural TTS API optimized for RTX 50-series hardware.',
        },
        servers: [{ url: `http://localhost:${port}` }],
    },
    apis: ['./index.js'],
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Helper for logging
const log = (msg) => {
    const today = DateTime.now().setZone("Africa/Lagos").toISODate();
    const logDir = '/shared/logs';
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
    fs.appendFileSync(`${logDir}/${today}.log`, `${new Date().toLocaleString()}: ${JSON.stringify(msg)}\n`);
};

// Authentication Middleware - Removed as requested
// const authenticate = (apiKey) => {
//     return keys.some(key => key.key === apiKey);
// };

// Helper to find all audio clips (wav, mp3) OR a baked model (pth) for a speaker
const getSpeakerWavs = (speakerName, forceCloned = false) => {
    try {
        // 1. Check for a Baked Model (Priority unless forced cloned)
        const pthFile = path.join(voicesPath, `${speakerName}.pth`);
        if (fs.existsSync(pthFile) && !forceCloned) {
            return [pthFile];
        }

        const speakerDir = path.join(voicesPath, speakerName);
        const supportedExts = ['.wav', '.mp3'];
        
        // 2. Check if speaker is a folder (Explicit multi-clip)
        if (fs.existsSync(speakerDir) && fs.statSync(speakerDir).isDirectory()) {
            return fs.readdirSync(speakerDir)
                .filter(f => supportedExts.some(ext => f.toLowerCase().endsWith(ext)))
                .map(f => path.join(speakerDir, f));
        }

        // 3. Look for all matching files (Automatic prefix grouping)
        const allFiles = fs.readdirSync(voicesPath);
        const matches = allFiles.filter(f => {
            const hasSupportedExt = supportedExts.some(ext => f.toLowerCase().endsWith(ext));
            if (!hasSupportedExt) return false;

            const name = f.replace(/\.(wav|mp3)$/i, '').toLowerCase();
            const target = speakerName.toLowerCase();
            
            // Match exact name OR name with a suffix like _1, _v2
            return name === target || 
                   name.startsWith(`${target}_`) || 
                   name.startsWith(`${target} `); 
        }).map(f => path.join(voicesPath, f));

        return matches.length > 0 ? matches : null;
    } catch (e) {
        log(`Error getting speaker audio clips: ${e.message}`);
        return null;
    }
};

/**
 * @openapi
 * /use-voice:
 *   post:
 *     summary: Generate neural audio (JSON Response)
 *     description: Requests a voice stream from the Python engine and proxies it back to the client.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               prompt:
 *                 type: string
 *               speaker:
 *                 type: string
 *               language:
 *                 type: string
 *     responses:
 *       200:
 *         description: RAW WAV Audio Stream
 */
app.post('/use-voice', async (req, res) => {
    let { prompt, speaker, language } = req.body;

    if (!prompt?.trim()) {
        return res.status(400).json({ error: 'Prompt is empty.' });
    }

    let forceCloned = false;
    let actualSpeaker = speaker || '';
    if (actualSpeaker.endsWith('#cloned')) {
        forceCloned = true;
        actualSpeaker = actualSpeaker.replace('#cloned', '');
    }

    const speakerWavs = getSpeakerWavs(actualSpeaker, forceCloned);
    if (!speakerWavs || speakerWavs.length === 0) {
        return res.status(404).json({ error: 'Voice not found.' });
    }

    log(`Streaming Request (POST): ${prompt.substring(0, 30)}...`);

    try {
        const response = await axios({
            method: 'post',
            url: pythonEngineUrl,
            data: {
                text: prompt,
                speaker_wav: speakerWavs.length === 1 ? speakerWavs[0] : speakerWavs,
                language: language || 'en'
            },
            responseType: 'stream'
        });

        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Transfer-Encoding', 'chunked');
        response.data.pipe(res);
    } catch (error) {
        log(`Python Error: ${error.message}`);
        res.status(500).json({ error: 'AI Engine failed.' });
    }
});

/**
 * @openapi
 * /stream-voice:
 *   get:
 *     summary: Instant Stream (GET)
 *     description: Direct browser streaming for <audio> elements.
 *     parameters:
 *       - in: query
 *         name: prompt
 *         schema: { type: string }
 *       - in: query
 *         name: speaker
 *         schema: { type: string }
 *       - in: query
 *         name: language
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: RAW WAV Audio Stream
 */
app.get('/stream-voice', async (req, res) => {
    let { prompt, speaker, language } = req.query;
    if (!prompt) return res.status(400).send('Prompt is required');
    
    let forceCloned = false;
    let actualSpeaker = speaker || '';
    if (actualSpeaker.endsWith('#cloned')) {
        forceCloned = true;
        actualSpeaker = actualSpeaker.replace('#cloned', '');
    }

    const speakerWavs = getSpeakerWavs(actualSpeaker, forceCloned);
    if (!speakerWavs) return res.status(404).send('Voice not found');

    try {
        const response = await axios({
            method: 'post',
            url: pythonEngineUrl,
            data: {
                text: prompt,
                speaker_wav: speakerWavs.length === 1 ? speakerWavs[0] : speakerWavs,
                language: language || 'en'
            },
            responseType: 'stream'
        });

        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Transfer-Encoding', 'chunked');
        response.data.pipe(res);
    } catch (error) {
        res.status(500).send('Streaming failed');
    }
});

/**
 * @openapi
 * /bake-voice:
 *   post:
 *     summary: Bake a custom voice model (.pth)
 *     description: Extracts neural latents from all matched audio clips and saves a high-performance .pth model.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               speaker:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success message with model path
 */
// New Route: Bake Model
app.post('/bake-voice', async (req, res) => {
    let { speaker } = req.body;
    const speakerWavs = getSpeakerWavs(speaker, true); // Force cloned to get clips
    
    const clips = speakerWavs.filter(f => !f.endsWith('.pth'));
    
    if (!clips || clips.length === 0) {
        return res.status(400).json({ error: 'No audio clips found to bake for this speaker.' });
    }

    try {
        const bakeUrl = pythonEngineUrl.replace('/generate', '/bake');
        const response = await axios.post(bakeUrl, {
            speaker: speaker,
            speaker_wav: speakerWavs
        });
        res.status(200).json(response.data);
    } catch (error) {
        log(`Bake Error: ${error.message}`);
        res.status(500).json({ error: 'Model creation failed.' });
    }
});

/**
 * @openapi
 * /list-speaker-details:
 *   get:
 *     summary: List detailed speaker info
 *     description: Scans the voices directory and returns metadata about clips and baked models.
 *     responses:
 *       200:
 *         description: Array of speaker objects
 */
app.get('/list-speaker-details', (req, res) => {
    try {
        const items = fs.readdirSync(voicesPath);
        const speakerNames = new Set();
        
        // Pass 1: Get unique speaker names
        items.forEach(item => {
            const fullPath = path.join(voicesPath, item);
            const stats = fs.statSync(fullPath);
            if (stats.isDirectory()) {
                speakerNames.add(item);
            } else if (item.endsWith('.wav') || item.endsWith('.mp3')) {
                const name = item.replace(/\.(wav|mp3)$/i, '').replace(/(_\d+|_v\d+)$/i, '');
                speakerNames.add(name);
            }
        });

        // Pass 2: Collate details
        const details = Array.from(speakerNames).sort().map(name => {
            // Get clips explicitly
            const clips = getSpeakerWavs(name, true); 
            // Check for baked model separately
            const bakedFile = path.join(voicesPath, `${name}.pth`);
            const isBaked = fs.existsSync(bakedFile);

            return {
                name: name,
                clips: clips || [],
                bakedFile: isBaked ? bakedFile : null
            };
        });

        res.status(200).json({ speakers: details });
    } catch (e) {
        res.status(500).json({ error: 'Failed to list speaker details.' });
    }
});

/**
 * @openapi
 * /list-voices:
 *   get:
 *     summary: List available voices for dropdowns
 *     description: Returns a simplified list of voice names and their baked status.
 *     responses:
 *       200:
 *         description: Array of voice names
 */
app.get('/list-voices', (req, res) => {
    try {
        const items = fs.readdirSync(voicesPath);
        const speakersMap = new Map();

        items.forEach(item => {
            const fullPath = path.join(voicesPath, item);
            try {
                const stats = fs.statSync(fullPath);
                if (stats.isDirectory()) {
                    speakersMap.set(item, { hasClips: true });
                } else if (item.endsWith('.pth')) {
                    const name = item.replace('.pth', '');
                    const entry = speakersMap.get(name) || {};
                    speakersMap.set(name, { ...entry, hasBaked: true });
                } else if (item.endsWith('.wav') || item.endsWith('.mp3')) {
                    const name = item.replace(/\.(wav|mp3)$/i, '').replace(/(_\d+|_v\d+)$/i, '');
                    const entry = speakersMap.get(name) || {};
                    speakersMap.set(name, { ...entry, hasClips: true });
                }
            } catch (err) {}
        });

        const list = [];
        Array.from(speakersMap.entries()).sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, info]) => {
            if (info.hasBaked) {
                list.push({ name: name, isBaked: true });
            }
            if (info.hasClips) {
                list.push({ name: name, isBaked: false });
            }
        });

        res.status(200).json({ speakers: list });
    } catch (e) {
        res.status(500).json({ error: 'Failed to list voices.' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});