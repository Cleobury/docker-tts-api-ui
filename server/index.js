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
const fileUpload = require('express-fileupload');

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
app.use(fileUpload({
    useTempFiles: true,
    tempFileDir: '/tmp/'
}));
app.use(express.static('public'));
app.use('/voices', express.static(voicesPath));

// Swagger Configuration
const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'AI-Voice-Cloner (Blackwell Edition)',
            version: '1.0.0',
            description: 'High-speed Neural TTS & Audio Enhancer optimized for RTX 50-series hardware.',
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
    const formattedMsg = `${new Date().toLocaleString()}: ${JSON.stringify(msg)}`;
    fs.appendFileSync(`${logDir}/${today}.log`, `${formattedMsg}\n`);
    console.log(formattedMsg); // Forward to Docker Logs
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

            // Get the speaker prefix (everything before the first underscore)
            const baseName = f.replace(/\.(wav|mp3|pth)$/i, '');
            const prefix = baseName.includes('_') ? baseName.split('_')[0] : baseName;
            
            return prefix.toLowerCase() === speakerName.toLowerCase();
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
    let { prompt, speaker, language, temperature, repetition_penalty, speed } = req.body;

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
            params: {
                temperature: temperature || 0.65,
                repetition_penalty: repetition_penalty || 5.0,
                speed: speed || 1.0
            },
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
    let { prompt, speaker, language, temperature, repetition_penalty, speed } = req.query;
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
            params: {
                temperature: temperature || 0.65,
                repetition_penalty: repetition_penalty || 5.0,
                speed: speed || 1.0
            },
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
 * /enhance-audio:
 *   post:
 *     summary: Enhance audio quality (Music/Noise Removal)
 *     description: Triggers the Blackwell Neural Enhancer to clean up a voice clip.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               input_path:
 *                 type: string
 *               mode:
 *                 type: string
 *                 enum: [vocal_isolation, denoise]
 *     responses:
 *       200:
 *         description: Success message with enhanced file path
 */
app.post('/enhance-audio', async (req, res) => {
    const { input_path, mode } = req.body;

    if (!input_path || !fs.existsSync(input_path)) {
        return res.status(400).json({ error: 'Valid input file path is required.' });
    }

    try {
        const enhUrl = pythonEngineUrl.replace('/generate', '/enhance');
        
        // Generate a descriptive output path
        const ext = path.extname(input_path);
        const base = input_path.replace(ext, '');
        const suffix = mode === 'vocal_isolation' ? '_vocal' : '_clean';
        const outputPath = `${base}${suffix}${ext}`;

        const response = await axios.post(enhUrl, {
            input_path: input_path,
            output_path: outputPath,
            mode: mode
        });

        res.status(200).json({
            success: true,
            original: input_path,
            enhanced: outputPath,
            details: response.data
        });
    } catch (error) {
        log(`Enhancement Error: ${error.message}`);
        res.status(500).json({ error: 'Enhancement failed. Check engine logs.' });
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
        if (error.response) console.error(JSON.stringify(error.response.data));
        console.error(error.stack);
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
            if (item === 'instrumental') return; // Ignore archive
            const fullPath = path.join(voicesPath, item);
            try {
                const stats = fs.statSync(fullPath);
                if (stats.isDirectory()) {
                    const name = item.includes('_') ? item.split('_')[0] : item;
                    speakerNames.add(name);
                } else if (item.endsWith('.wav') || item.endsWith('.mp3') || item.endsWith('.pth')) {
                    const baseName = item.replace(/\.(wav|mp3|pth)$/i, '');
                    const name = baseName.includes('_') ? baseName.split('_')[0] : baseName;
                    speakerNames.add(name);
                }
            } catch (err) {}
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
        console.error("List Speaker Details Error:", e.stack);
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
            if (item === 'instrumental') return; // Ignore the instrumental archive
            const fullPath = path.join(voicesPath, item);
            try {
                const stats = fs.statSync(fullPath);
                if (stats.isDirectory()) {
                    const name = item.includes('_') ? item.split('_')[0] : item;
                    const entry = speakersMap.get(name) || {};
                    speakersMap.set(name, { ...entry, hasClips: true });
                } else if (item.endsWith('.pth')) {
                    const name = item.replace('.pth', '');
                    const entry = speakersMap.get(name) || {};
                    speakersMap.set(name, { ...entry, hasBaked: true });
                } else if (item.endsWith('.wav') || item.endsWith('.mp3')) {
                    // Extract prefix (Adam from Adam_1)
                    const baseName = item.replace(/\.(wav|mp3)$/i, '');
                    const name = baseName.includes('_') ? baseName.split('_')[0] : baseName;
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

/**
 * @openapi
 * /upload-voice:
 *   post:
 *     summary: Upload and Auto-Number a new voice sample
 *     description: Receives a raw audio file and automatically names it using the speaker prefix + next available number.
 */
app.post('/upload-voice', async (req, res) => {
    try {
        if (!req.files || !req.files.voice_file) {
            return res.status(400).json({ error: 'No files were uploaded.' });
        }

        const name = req.body.speaker?.trim() || 'New_Voice';
        const uploadedFile = req.files.voice_file;
        const ext = path.extname(uploadedFile.name) || '.wav';

        // 1. Scan for existing files with this prefix
        const files = fs.readdirSync(voicesPath);
        let maxIdx = 0;
        
        files.forEach(f => {
            if (f.toLowerCase().startsWith(name.toLowerCase() + '_')) {
                // Extract number after the underscore
                const parts = f.split('_');
                const lastPart = parts[parts.length - 1].split('.')[0];
                const idx = parseInt(lastPart);
                if (!isNaN(idx) && idx > maxIdx) maxIdx = idx;
            }
        });

        // 2. Generate new name (prefix + next number)
        const newName = `${name}_${maxIdx + 1}${ext}`;
        const finalPath = path.join(voicesPath, newName);

        // 3. Move file to voice bank
        await uploadedFile.mv(finalPath);

        log(`Uploaded new neural sample: ${newName}`);
        res.status(200).json({ success: true, filename: newName });
    } catch (e) {
        log(`Upload Error: ${e.message}`);
        res.status(500).json({ error: 'Failed to upload voice sample.' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
