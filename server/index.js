const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios'); // Add this to your package.json: npm install axios
const ffmpeg = require('fluent-ffmpeg');
const keys = require('./keys.json');
const { DateTime } = require('luxon');
const { v4: uuidv4 } = require('uuid'); // Standard uuid package

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

// Helper for logging
const log = (msg) => {
    const today = DateTime.now().setZone("Africa/Lagos").toISODate();
    const logDir = '/shared/logs';
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
    fs.appendFileSync(`${logDir}/${today}.log`, `${new Date().toLocaleString()}: ${JSON.stringify(msg)}\n`);
};

// Authentication Middleware
const authenticate = (apiKey) => {
    return keys.some(key => key.key === apiKey);
};

// Main Generation Route (The Fast Path)
app.post('/use-voice', async (req, res) => {
    let { prompt, apiKey, speaker, language } = req.body;

    if (!authenticate(apiKey)) {
        return res.status(200).json({ error: 'Invalid API key.' });
    }
    if (!prompt?.trim()) {
        return res.status(200).json({ error: 'Prompt is empty.' });
    }

    const filename = `${speaker}_${uuidv4()}.wav`;
    const filePath = path.join(publicPath, filename);
    const modelFile = path.join(voicesPath, `${speaker}.wav`);

    if (!fs.existsSync(modelFile)) {
        return res.status(200).json({ error: 'Voice file not found.' });
    }

    log(`Request from ${apiKey}: ${prompt.substring(0, 30)}...`);

    try {
        // 1. Send request to the Resident Python Engine (Instant on 5090)
        await axios.post(pythonEngineUrl, {
            text: prompt,
            speaker_wav: modelFile,
            language: language || 'en',
            file_path: filePath
        });

        // 2. Convert to MP3
        const mp3FileName = `${filename}.mp3`;
        const mp3Path = path.join(publicPath, mp3FileName);

        ffmpeg(filePath)
            .toFormat('mp3')
            .on('error', (err) => {
                log(`FFmpeg Error: ${err.message}`);
                res.status(500).json({ error: 'Conversion failed' });
            })
            .on('end', () => {
                // Clean up the heavy .wav file, keep the .mp3
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                res.status(200).json({ filename: mp3FileName });
            })
            .save(mp3Path);

    } catch (error) {
        log(`Python Engine Error: ${error.message}`);
        res.status(500).json({ error: 'AI Engine is not responding. Check if Python is running.' });
    }
});

app.get('/list-voices', (req, res) => {
    const voices = fs.readdirSync(voicesPath);
    res.status(200).json({
        speakers: voices.filter(v => v.endsWith('.wav')).map(v => v.replace('.wav', ''))
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});