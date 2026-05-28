/**
 * Groq ASR Handler — integrates into cobalt's match.js
 *
 * Logic: if official subtitles exist, use them.
 *         Otherwise, download audio and transcribe via Groq Whisper API.
 *
 * Robustness:
 *   - Retry up to 5 times with exponential backoff on transient failures
 *   - Audio > 25 MB is split into ~6-minute chunks before transcription
 *   - Each chunk is retried independently
 *   - If a chunk fails after 5 retries, it returns a partial warning
 *     and concatenates successful results
 */
import { fetch } from "undici";
import { createRequire } from "node:module";
import { Buffer } from "node:buffer";

import { transcribeAudio, MAX_FILE_SIZE, MAX_RETRIES } from "../misc/groq-asr.js";
import { createResponse } from "./request.js";

const require = createRequire(import.meta.url);

// Dynamically load ffmpeg for audio extraction (only when needed)
let ffmpeg;
const getFfmpeg = async () => {
    if (!ffmpeg) {
        ffmpeg = require("ffmpeg-static");
    }
    return ffmpeg;
};

/**
 * Download audio from a URL as a Buffer (in-memory, no disk).
 * Returns null on failure.
 */
async function downloadAudioBuffer(url, headers = {}, timeoutMs = 120_000) {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(url, {
            headers: {
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "referer": "https://www.bilibili.com/",
                ...headers,
            },
            signal: controller.signal,
        });

        clearTimeout(timer);

        if (!response.ok) {
            return null;
        }

        // Read into Buffer (suitable for < 25 MB files)
        const chunks = [];
        for await (const chunk of response.body) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    } catch {
        return null;
    }
}

/**
 * Split audio buffer into ~6-minute chunks.
 * Groq has a 25 MB limit; ~6 min of m4a at 128kbps ≈ 4.5 MB, well within limit.
 * @param {Buffer} audioBuffer
 * @param {number} chunkDurationMs - chunk duration in ms (default ~6 min)
 * @returns {Array<{buffer: Buffer, startMs: number, endMs: number}>}
 */
function splitAudioBuffer(audioBuffer, chunkDurationMs = 6 * 60 * 1000) {
    // We don't know the bitrate, so we guess based on buffer size vs duration.
    // For bilibili m4a at 128kbps: 128kbps * 360s = ~5.6 MB per 6-min chunk.
    // We target ~5 MB per chunk as a safe margin.
    const estimatedBitrateKbps = 128;
    const bytesPerChunk = Math.floor((estimatedBitrateKbps * 8 * (chunkDurationMs / 1000)) / 1024);

    const chunks = [];
    let offset = 0;
    let startMs = 0;

    while (offset < audioBuffer.length) {
        const chunkBytes = Math.min(bytesPerChunk, audioBuffer.length - offset);
        chunks.push({
            buffer: audioBuffer.slice(offset, offset + chunkBytes),
            startMs,
            endMs: startMs + (chunkDurationMs * chunkBytes / bytesPerChunk),
        });
        offset += chunkBytes;
        startMs += chunkDurationMs;
    }

    return chunks;
}

/**
 * Convert audio Buffer to a different format using ffmpeg.
 * Used when source audio is not m4a/mp3/ogg/wav (Groq accepts those natively).
 * @param {Buffer} inputBuffer - Input audio buffer
 * @param {string} inputExt - Original extension (e.g. "flac", "wav")
 * @param {string} outputExt - Target extension (e.g. "m4a", "mp3")
 * @returns {Promise<Buffer|null>}
 */
async function convertAudioFormat(inputBuffer, inputExt, outputExt = "m4a") {
    try {
        const ffmpegPath = await getFfmpeg();
        const { spawn } = await import("node:child_process");
        const { Readable } = await import("node:stream");

        return new Promise((resolve) => {
            const args = [
                "-f", inputExt === "ogg" ? "ogg" : inputExt,
                "-i", "pipe:0",
                "-c:a", outputExt === "m4a" ? "aac" : "libmp3lame",
                "-b:a", "128k",
                "-y",
                "pipe:1",
            ];

            const proc = spawn(ffmpegPath, args);
            const outputChunks = [];

            proc.stdout.on("data", (chunk) => outputChunks.push(chunk));
            proc.stderr.on("data", () => {}); // suppress ffmpeg stderr

            proc.on("close", (code) => {
                if (code === 0) {
                    resolve(Buffer.concat(outputChunks));
                } else {
                    resolve(null);
                }
            });

            proc.on("error", () => resolve(null));

            const inputStream = Readable.from(inputBuffer);
            inputStream.pipe(proc.stdin);
        });
    } catch {
        return null;
    }
}

/**
 * Main ASR function — tries Groq, with retry + chunking + fallback.
 *
 * @param {string} audioUrl - URL of the audio stream to transcribe
 * @param {object} options
 * @param {string} [options.audioHeaders] - Additional headers for audio fetch
 * @param {string} [options.language] - ISO language code hint
 * @param {string} [options.audioExt] - Audio format hint (default "m4a")
 * @param {string} [options.serviceName] - For error messages (e.g. "bilibili", "twitter")
 * @returns {Promise<{text: string, segments: Array, success: boolean, warning: string|null}>}
 */
export async function transcribeWithGroq(audioUrl, options = {}) {
    const {
        audioHeaders = {},
        language = null,
        audioExt = "m4a",
        serviceName = "video",
    } = options;

    // Step 1: Download audio
    const audioBuffer = await downloadAudioBuffer(audioUrl, audioHeaders);
    if (!audioBuffer) {
        return { text: "", segments: [], success: false, warning: `${serviceName}: failed to download audio` };
    }

    // Step 2: Check size
    if (audioBuffer.length > MAX_FILE_SIZE) {
        // Split into chunks
        const chunks = splitAudioBuffer(audioBuffer);
        const allSegments = [];
        let hasFailure = false;

        for (const chunk of chunks) {
            const result = await transcribeAudio(
                chunk.buffer,
                `chunk_${chunk.startMs}_${chunk.endMs}.m4a`,
                language
            );

            if (result.error && result.segments.length === 0) {
                // This chunk failed permanently
                hasFailure = true;
                continue;
            }

            // Adjust segment timestamps to be relative to full audio
            for (const seg of result.segments) {
                allSegments.push({
                    ...seg,
                    start: seg.start + chunk.startMs / 1000,
                    end: seg.end + chunk.startMs / 1000,
                });
            }
        }

        const text = allSegments.map((s) => s.text).join(" ").trim();
        return {
            text,
            segments: allSegments,
            success: !hasFailure,
            warning: hasFailure ? `Some audio chunks failed to transcribe` : null,
        };
    }

    // Step 3: Transcribe directly
    const result = await transcribeAudio(audioBuffer, `audio.${audioExt}`, language);

    if (result.error && result.segments.length === 0) {
        return {
            text: "",
            segments: [],
            success: false,
            warning: `${serviceName}: Groq transcription failed after ${MAX_RETRIES} retries: ${result.error}`,
        };
    }

    return {
        text: result.segments.map((s) => s.text).join(" ").trim(),
        segments: result.segments,
        success: result.error === null,
        warning: result.error ? `Partial transcription: ${result.error}` : null,
    };
}

/**
 * Build a subtitles object from Groq segments in cobalt's format.
 */
export function groqSegmentsToSubtitles(segments, language = "zh") {
    return {
        type: "subtitles",
        format: "text",
        language,
        url: null,
        data: segments.map((seg) => ({
            start: seg.start,
            end: seg.end,
            text: seg.text,
        })),
    };
}