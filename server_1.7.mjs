import path from 'path';
import express from 'express';    
import dotenv from 'dotenv';
import cors from 'cors';
import OpenAI from 'openai';
import axios from 'axios';
import fs from 'fs';
import { exec } from 'child_process';
import { v4 as uuidv4 } from 'uuid'; 
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import textToSpeech from '@google-cloud/text-to-speech';
import util from 'util';


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
app.use(
    cors({
    origin: 'http://localhost:3000', // Allow requests from the frontend
}));
app.use((req, res, next) => {
    console.log(`${req.method} request for '${req.url.trim()}'`); // Trim the URL
    console.log('Request Body:', req.body);
    next();
});

const openaiApiKey = process.env.OPENAI_API_KEY;
const pexelsApiKey = process.env.PEXELS_API_KEY;
const VOICE_RSS_API_KEY= process.env.VOICE_RSS_API_KEY;

const ttsClient = new textToSpeech.TextToSpeechClient();


const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY, // Your OpenAI API Key from .env
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


const generateKeywords = async (script, mainIdea) => {
    // Check if the main idea is provided; if not, you can try to extract it.
    if (!mainIdea) {
      // For simplicity, let's take the first sentence or a few words as the main idea
      mainIdea = script.split("\n")[0];  // You can refine this extraction method
    }
  
    const prompt = `Generate 10 unique, action-oriented, contextual keywords from the following text. Each keyword should be 3–4 words long, focusing on actions, emotions, and key topics that would relate to video content for YouTube Shorts. The main idea of the video is: "${mainIdea}". Please provide keywords related to the theme: 
  
    Text: ${script}
  
    Keywords:`;
  
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Ensure the model is correct
      messages: [{ role: "user", content: prompt }],
      max_tokens: 150,
      temperature: 0.7,
    });
  
    const keywords = response.choices[0].message.content
      .trim()
      .split("\n")
      .filter(Boolean);
  
    return keywords.slice(0, 10); // Get 10 keywords for more variety
  };
  
  
  
  



  const fetchVideosForKeywords = async (keywords) => {
    const videos = [];
    for (const keyword of keywords) {
      const response = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(keyword)}&per_page=1`, {
        headers: {
          Authorization: pexelsApiKey,
        },
      });
      const data = await response.json();
      if (data.videos && data.videos.length > 0) {
        videos.push(data.videos[0].video_files[0].link); // Use the first video file link
      }
    }
    return videos;
  };
  

  const extractAudioTimestamps = async (audioFilePath) => {
    try {
        const audioStream = fs.createReadStream(audioFilePath);

        const response = await axios.post(
            'https://api.openai.com/v1/audio/transcriptions',
            {
                model: 'whisper-1',
                file: audioStream,
                response_format: 'verbose_json',
            },
            {
                headers: {
                    Authorization: `Bearer ${openaiApiKey}`,
                    'Content-Type': 'multipart/form-data',
                },
            }
        );

        const transcription = response.data;
        console.log('Whisper Transcription:', transcription);

        if (!transcription.segments || transcription.segments.length === 0) {
            throw new Error('No segments found in Whisper transcription response.');
        }

        // Extract timestamps for all transcribed text
        const timestamps = transcription.segments.map((segment) => ({
            text: segment.text.trim(),
            start: segment.start,
            end: segment.end,
        }));

        return timestamps;
    } catch (error) {
        console.error('Error extracting timestamps:', error.message);
        throw new Error('Failed to extract timestamps from the audio.');
    }
};
  

app.post('/merge-videos', async (req, res) => {
    const { script, voiceAssistant, musicType, voiceType, videoType } = req.body;

    // Validate required fields
    if (!script || !voiceAssistant || !musicType || !voiceType || !videoType) {
      return res.status(400).json({ error: 'All fields (script, voiceAssistant, musicType, voiceType, videoType) are required.' });
    }

    const videoDirectory = path.join(__dirname, 'videos');
    const audioFilePath = path.join(videoDirectory, `voiceover-${uuidv4()}.mp3`);
    const outputFilePath = path.join(videoDirectory, `final-output-${uuidv4()}.mp4`);

    if (!fs.existsSync(videoDirectory)) {
      fs.mkdirSync(videoDirectory, { recursive: true });
    }

    try {
      console.log('1. Generating voiceover...');
      const { speed, pitch } = parseVoiceType(voiceType);

      const voiceResponse = await axios.post('http://localhost:3001/generate-voice', {
        script,
        voiceName: voiceAssistant,
        speed,
        pitch,
      });

      const voiceoverUrl = voiceResponse.data.audioPath;
      fs.copyFileSync(voiceoverUrl, audioFilePath); // Save generated voiceover locally

      console.log('2. Generating keywords...');
      const keywords = await generateKeywords(script);
      console.log('Keywords:', keywords);

      console.log('3. Fetching videos for keywords...');
      const videoLinks = await fetchVideosForKeywords(keywords);
      console.log('Fetched Videos:', videoLinks);

      console.log('4. Downloading videos...');
      const downloadedVideos = await Promise.all(
        videoLinks.map(async (link, index) => {
          const outputPath = path.join(videoDirectory, `clip-${index}.mp4`);
          await downloadVideo(link, outputPath);
          return { filePath: outputPath, start: 0, end: 10 }; // Add start and end for trimming (example values)
        })
      );

      console.log('5. Creating timestamps...');
      const timestamps = await extractAudioTimestamps(audioFilePath);

      // Step 1: Download videos with timestamps
const downloadedVideoss = await Promise.all(
    videoLinks.map(async (link, index) => {
      const outputPath = path.join(videoDirectory, `clip-${index}.mp4`);
      await downloadVideo(link, outputPath);
      // Use timestamps to determine start and end times for each video
      const timestamp = timestamps[index] || { start: 0, end: 10 }; // Fallback if no timestamp is found
      return { filePath: outputPath, start: timestamp.start, end: timestamp.end };
    })
  );
  
  // Step 2: Merging videos with correct trimming and alignment based on timestamps
  const filterComplex = downloadedVideoss
    .map(
      (file, index) =>
        `[${index}:v]scale=1080:1920,setdar=9/16,trim=start=${file.start}:end=${file.end},setpts=PTS-STARTPTS[v${index}];`
    )
    .join('') +
    downloadedVideoss.map((_, index) => `[v${index}]`).join('') +
    `concat=n=${downloadedVideoss.length}:v=1:a=0[outv]`;
  
  const ffmpegCommand = `ffmpeg ${downloadedVideoss.map((file) => `-i "${file.filePath}"`).join(' ')} -i "${audioFilePath}" \
    -filter_complex "${filterComplex}" -map "[outv]" -map ${downloadedVideoss.length}:a \
    -shortest -c:v libx264 -pix_fmt yuv420p -y "${outputFilePath}"`;
  
  console.log('Running FFmpeg command:', ffmpegCommand);
  exec(ffmpegCommand, (error, stdout, stderr) => {
    if (error) {
      console.error('FFmpeg error:', stderr);
      return res.status(500).json({ error: 'Error during video merging.', details: stderr });
    }
  
    console.log('Video merging completed.');
    res.download(outputFilePath, () => {
      // Cleanup temporary files
      [...downloadedVideos.map((file) => file.filePath), audioFilePath, outputFilePath].forEach((file) =>
        fs.unlink(file, () => {})
      );
    });
  });
  
    } catch (error) {
      console.error('Error generating video:', error.message);
      res.status(500).json({ error: 'An error occurred during video generation.', details: error.message });
    }
});

  function parseVoiceType(voiceTypeLabel) {
    const voiceTypeOptions = {
      'Engaging/Natural': { speed: 1.0, pitch: 0 },
      'Fast-Paced (Tech Reviews, Tips)': { speed: 1.2, pitch: 1 },
      'Calm/Explanatory (Tutorials)': { speed: 0.9, pitch: 0 },
      'Energetic (Announcements, Motivational)': { speed: 1.1, pitch: 2 },
      'Serious (Documentary/Narrative)': { speed: 0.85, pitch: -1 },
      'Cheerful (Entertainment, Kids Content)': { speed: 1.2, pitch: 3 },
      'Corporate (Professional Presentations)': { speed: 1.0, pitch: -0.5 },
    };
    return voiceTypeOptions[voiceTypeLabel] || { speed: 1.0, pitch: 0 };
  }


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
    const { script, voiceName } = req.body;

    if (!script || !voiceName) {
        return res.status(400).json({ error: 'Both script and voiceName are required' });
    }

    try {
        // Extract language code from the voice name (e.g., "en-US-Journey-D" -> "en-US")
        const languageCode = voiceName.split('-').slice(0, 2).join('-');

        // Set TTS parameters
        const voiceParams = {
            name: voiceName,
            languageCode: languageCode,
        };

        const audioConfig = {
            audioEncoding: 'MP3', // Output format
            speakingRate: 1.17,   // Optional: Adjust speaking rate
            pitch: 1,          // Optional: Adjust pitch
        };

        // Generate audio using Google Cloud TTS
        const [response] = await ttsClient.synthesizeSpeech({
            input: { text: script },
            voice: voiceParams,
            audioConfig,
        });

        // Save the audio file
        const audioFilePath = path.join(__dirname, `voiceover-${uuidv4()}.mp3`);
        const writeFile = util.promisify(fs.writeFile);
        await writeFile(audioFilePath, response.audioContent, 'binary');

        res.status(200).json({
            message: 'Voiceover generated successfully',
            audioPath: audioFilePath,
        });
    } catch (error) {
        console.error('Error generating voiceover:', error);
        res.status(500).json({
            error: 'Failed to generate voiceover',
            details: error.message,
        });
    }
});



app.post('/generate-script', async (req, res) => { 
    const { idea } = req.body;

    if (!idea) {
        return res.status(400).json({ message: 'Please provide an idea for the video.' });
    }

    try {
        // Define the prompt for GPT-3.5 to generate the video script
            const prompt = `
        You are a professional scriptwriter for platforms like YouTube Shorts and Instagram Reels. 
        Create a 1-minute video script based on the following idea: "${idea}". 
        The script should:
        - Start with a captivating hook to immediately grab attention.
        - Present the main idea in a fast-paced, engaging, and concise manner.
        - End with a compelling call-to-action to encourage interaction (e.g., like, share, or subscribe).
        Ensure the language is simple, the tone matches the idea's theme, and the pacing keeps viewers engaged throughout. 
        Do not include section headings like "Intro", "Body", or "Outro". Write it as plain text suitable for the short video format.
    `;


        // Generate the script using GPT-3.5 Turbo model with a max token limit
        const response = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [
                { role: 'system', content: 'You are a script generator for short videos.' },
                { role: 'user', content: prompt },
            ],
            max_tokens: 300,  // Set the token limit (300 tokens, you can adjust this)
            temperature: 0.7,  // Optional: Set the creativity level of the response
        });

        // Extract the generated script
        const script = response.choices[0].message.content.trim();

        // Send the generated script as the response
        res.json({ script });
    } catch (error) {
        console.error('Error generating script:', error);
        res.status(500).json({ message: 'Failed to generate script.', error: error.message });
    }
});


app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});