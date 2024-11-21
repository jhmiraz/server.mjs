import path from 'path';
import express from 'express';    
import dotenv from 'dotenv';
import cors from 'cors';
import OpenAI from 'openai'; 
import axios from 'axios';
import fs from 'fs';
import { exec, execSync } from 'child_process';

import { v4 as uuidv4 } from 'uuid'; 
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { ElevenLabsClient } from 'elevenlabs';





// Load environment variables from .env file
dotenv.config();




const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const port = 3001; // Use a different port to avoid conflict

const MAX_VIDEOS = 5;  
const MAX_DURATION = 40;


// Middleware to parse JSON

app.use(express.json());
app.use(cors({
    origin: 'http://localhost:3000', // Allow requests from the frontend
}));
app.use((req, res, next) => {
    console.log(`${req.method} request for '${req.url.trim()}'`); // Trim the URL
    console.log('Request Body:', req.body);
    next();
});

const openaiApiKey = process.env.OPENAI_API_KEY;
const pexelsApiKey = process.env.PEXELS_API_KEY;
const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;
const voiceApiUrl = process.env.VOICE_API_URL;
const VOICE_RSS_API_KEY= process.env.VOICE_RSS_API_KEY;




const client = new ElevenLabsClient({ apiKey: elevenLabsApiKey });


const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY, // Use OpenAI API key from .env
});

const PEXELS_API_KEY = process.env.PEXELS_API_KEY;

// Check if API keys are present
if (!process.env.OPENAI_API_KEY || !process.env.PEXELS_API_KEY) {
    console.error('Missing API keys in .env file');
    process.exit(1); // Exit if keys are missing
}

// Endpoint to generate script using OpenAI
app.post('/generate-video', async (req, res) => {
    const { script } = req.body;

    if (!script) {
        return res.status(400).json({ error: 'Script is required' });
    }

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: script }],
            max_tokens: 100,
        });

        const generatedScript = response.choices[0]?.message?.content.trim();
        console.log('Generated Script:', generatedScript); // Log the response for debugging
        res.json({ script: generatedScript });
    } catch (error) {
        console.error('Error generating video:', error);
        res.status(500).json({ error: 'Failed to generate video', details: error.message });
    }
});

// Helper function to download videos
const downloadVideo = async (url, outputPath) => {
    const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream' // Download as a stream
    });

    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer); // Pipe the video stream to the local file

    return new Promise((resolve, reject) => {
        writer.on('finish', resolve); // Resolve when finished
        writer.on('error', reject); // Reject if any error occurs
    });
};


const extractKeywordsFromScript = (script) => {
    const sentences = script.split('.').map((s) => s.trim());
    return sentences.map((s) => s.split(' ').slice(0, 2).join(' ')).filter(Boolean);
};

// Endpoint to merge videos
// Endpoint to merge videos
app.post('/merge-videos', async (req, res) => {
    const { script, voiceAssistant } = req.body;

    if (!script || !voiceAssistant) {
        return res.status(400).json({ error: 'Script and Voice ID are required' });
    }

    const videoDirectory = path.join(__dirname, 'videos').replace(/\\/g, '/');
    const outputFilePath = path.join(videoDirectory, `output-${uuidv4()}.mp4`).replace(/\\/g, '/');
    const audioFilePath = path.join(videoDirectory, `voiceover-${uuidv4()}.mp3`).replace(/\\/g, '/');

    if (!fs.existsSync(videoDirectory)) {
        fs.mkdirSync(videoDirectory, { recursive: true });
    }

    const keywords = extractKeywordsFromScript(script);
    console.log('Keywords extracted:', keywords);

    try {
        // Step 1: Generate Voice-over
        console.log('Generating voice-over...');
        if (voiceAssistant.startsWith('voicerss_')) {
            const response = await axios.get('https://api.voicerss.org/', {
                params: {
                    key: VOICE_RSS_API_KEY,
                    hl: 'en-us',
                    src: script,
                    c: 'mp3',
                    f: '44khz_16bit_stereo',
                },
                responseType: 'stream',
            });

            const writer = fs.createWriteStream(audioFilePath);
            response.data.pipe(writer);
            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
            console.log('VoiceRSS voice-over generated.');
        } else {
            const voiceResponse = await axios.post(
                `https://api.elevenlabs.io/v1/text-to-speech/${voiceAssistant}`,
                {
                    text: script,
                    model_id: 'eleven_monolingual_v1',
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.5,
                    },
                },
                {
                    headers: {
                        'xi-api-key': process.env.ELEVEN_LABS_API_KEY,
                        'Content-Type': 'application/json',
                    },
                    responseType: 'stream',
                }
            );

            const writer = fs.createWriteStream(audioFilePath);
            voiceResponse.data.pipe(writer);
            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
            console.log('Eleven Labs voice-over generated.');
        }

        // Step 2: Download Videos
        console.log('Downloading videos...');
        const videoResults = await Promise.all(
            keywords.slice(0, MAX_VIDEOS).map(async (keyword) => {
                try {
                    const response = await axios.get('https://api.pexels.com/videos/search', {
                        headers: { Authorization: PEXELS_API_KEY },
                        params: { query: keyword, per_page: 1 },
                    });

                    const videos = response.data.videos
                        .filter((video) => video.duration <= MAX_DURATION)
                        .map((video) => video.video_files[0]?.link);

                    return videos.slice(0, 1);
                } catch (error) {
                    console.error(`Error fetching videos for "${keyword}":`, error.message);
                    return [];
                }
            })
        );

        const videoUrls = videoResults.flat().filter(Boolean);
        if (videoUrls.length === 0) {
            return res.status(404).json({ error: 'No videos found for the given script.' });
        }

        const videoFiles = await Promise.all(
            videoUrls.map(async (url, index) => {
                const outputPath = path.join(videoDirectory, `video${index}.mp4`).replace(/\\/g, '/');
                await downloadVideo(url, outputPath);
                return outputPath;
            })
        );

        // Step 3: Trim and Concatenate Videos
        const trimDuration = Math.min(MAX_DURATION, 5 * videoFiles.length); // Trim each video to fit within the total duration
        const filterComplex = videoFiles
            .map(
                (file, index) =>
                    `[${index}:v]scale=1080:1920,setdar=9/16,trim=duration=${trimDuration},setpts=PTS-STARTPTS[v${index}];`
            )
            .join('') +
            videoFiles.map((_, index) => `[v${index}]`).join('') +
            `concat=n=${videoFiles.length}:v=1:a=0[outv]`;

        const ffmpegCommand = `ffmpeg ${videoFiles.map((file) => `-i "${file}"`).join(' ')} -i "${audioFilePath}" \
            -filter_complex "${filterComplex}" -map "[outv]" -map ${videoFiles.length}:a \
            -shortest -c:v libx264 -pix_fmt yuv420p -y "${outputFilePath}"`;

        console.log('Running FFmpeg command...');
        exec(ffmpegCommand, (error, stdout, stderr) => {
            if (error) {
                console.error('FFmpeg error:', stderr);
                return res.status(500).json({ error: 'Error during video merging.', details: stderr });
            }

            console.log('Video merging completed.');
            res.download(outputFilePath, () => {
                [...videoFiles, audioFilePath, outputFilePath].forEach((file) => fs.unlink(file, () => {}));
            });
        });
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ error: 'An error occurred.', details: error.message });
    }
});






// Endpoint to generate script from an idea
app.post('/generate-script', async (req, res) => {
    const { idea } = req.body;

    if (!idea) {
        return res.status(400).json({ error: 'Idea is required' });
    }

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                {
                    role: "user",
                    content: `Generate a concise video script based on the following idea: ${idea}. 
                    Format: 
                    - [INTRO]: 1-2 sentences intro.
                    - [BODY]: Compare each person with a short description.
                    - [OUTRO]: End with a call to action, no mentions of additional video content or extended analysis.`
                }
            ],
            max_tokens: 125,
            temperature: 0.7,
        });

        let generatedScript = response.choices[0]?.message?.content.trim();

        // Define unwanted phrases and tags to remove with flexible regex patterns
        const unwantedPhrases = [
            /\[INTRO\]:?/gi,
            /\[BODY\]:?/gi,
            /\[OUTRO\]:?/gi,
            /watch the full video/gi,
            /in-depth analysis/gi
        ];

        // Remove unwanted phrases and tags from the generated script
        unwantedPhrases.forEach(phrase => {
            generatedScript = generatedScript.replace(phrase, '');
        });

        generatedScript = generatedScript.trim(); // Final trim to clean up extra spaces
        console.log('Generated Script from Idea:', generatedScript);
        res.json({ script: generatedScript });
    } catch (error) {
        console.error('Error generating script:', error);
        res.status(500).json({ error: 'Failed to generate script', details: error.message });
    }
});



// Endpoint to search videos using Pexels API
app.post('/search-videos', async (req, res) => {
    const { script } = req.body;

    if (!script) {
        return res.status(400).json({ error: 'Script is required to search for videos' });
    }

    const keywords = extractKeywordsFromScript(script);

    try {
        const videoResults = await Promise.all(keywords.map(async (keyword) => {
            try {
                const response = await axios.get('https://api.pexels.com/videos/search', {
                    headers: { Authorization: PEXELS_API_KEY },
                    params: { query: keyword, per_page: 5 }
                });
                
                return {
                    keyword,
                    videos: response.data.videos.map(video => ({
                        url: video.video_files[0]?.link,
                        duration: video.duration,
                        id: video.id
                    }))
                };
            } catch (apiError) {
                console.error(`Error fetching videos for keyword: ${keyword}`, apiError.response?.data || apiError.message);
                return { keyword, videos: [] }; 
            }
        }));

        res.json({ videoResults });

    } catch (error) {
        console.error('Error fetching videos from Pexels:', error);
        res.status(500).json({ error: 'Failed to fetch videos from Pexels', details: error.message });
    }
});

// Endpoint to generate SEO keywords
app.post('/generate-seo-keywords', async (req, res) => {
    const { topic } = req.body;
  
    if (!topic) {
      return res.status(400).json({ error: 'Topic is required' });
    }
  
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'user',
            content: `Generate SEO keywords for the following topic: ${topic}.`,
          },
        ],
        max_tokens: 100,
      });
  
      const keywords = response.choices[0]?.message?.content.trim();
      console.log('Generated Keywords:', keywords);
  
      res.json({ keywords });
    } catch (error) {
      console.error('Error generating SEO keywords:', error);
      res.status(500).json({ error: 'Failed to generate SEO keywords', details: error.message });
    }
  });



  app.post('/generate-voice', async (req, res) => {
    const { script, voiceId } = req.body;
  
    if (!script || !voiceId) {
      return res.status(400).json({ error: 'Script and Voice ID are required' });
    }
  
    try {
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
      const response = await axios.post(
        url,
        {
          text: script,
          model_id: 'eleven_monolingual_v1',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.5,
          },
        },
        {
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': process.env.ELEVEN_LABS_API_KEY,
          },
          responseType: 'stream',
        }
      );
  
      const audioFilePath = path.join(__dirname, 'output.mp3');
      const writer = fs.createWriteStream(audioFilePath);
  
      response.data.pipe(writer);
  
      writer.on('finish', () => {
        res.status(200).json({ message: 'Voiceover generated successfully', audioPath: audioFilePath });
      });
  
      writer.on('error', (err) => {
        console.error('Error saving audio:', err);
        res.status(500).json({ error: 'Failed to save voiceover', details: err.message });
      });
  
    } catch (error) {
      console.error('Error generating voice:', error);
      res.status(500).json({ error: 'Failed to generate voiceover', details: error.message });
    }
});


  

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});