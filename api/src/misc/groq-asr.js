/**
 * Groq Whisper API client (Node.js version of groq_client.py)
 * Handles audio transcription via Groq's Whisper large-v3-turbo model.
 */
import { FormData } from "undici";

const GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

export const GROQ_MODELS = {
    WHISPER_LARGE_V3: "whisper-large-v3",
    WHISPER_LARGE_V3_TURBO: "whisper-large-v3-turbo",
};

const DEFAULT_MODEL = GROQ_MODELS.WHISPER_LARGE_V3_TURBO;
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const MAX_RETRIES = 5;

/**
 * Transcribe audio bytes using Groq Whisper API.
 * @param {Buffer|Uint8Array} audioBytes - Raw audio data
 * @param {string} filename - Filename hint for the API
 * @param {string} language - ISO 639-1 language code (e.g. "zh", "en", "ja")
 * @param {string} model - Groq model name
 * @param {number} retryCount - Current retry attempt (internal)
 * @returns {Promise<{segments: Array<{start: number, end: number, text: string}>, error: null}>}
 */
export async function transcribeAudio(audioBytes, filename = "audio.m4a", language = null, model = DEFAULT_MODEL, retryCount = 0) {
    if (audioBytes.byteLength > MAX_FILE_SIZE) {
        return {
            segments: [],
            error: `Audio file exceeds ${MAX_FILE_SIZE / 1024 / 1024} MB limit (got ${(audioBytes.byteLength / 1024 / 1024).toFixed(1)} MB)`,
        };
    }

    const form = new FormData();
    form.append("file", new Blob([audioBytes]), filename);
    form.append("model", model);

    if (language) {
        form.append("language", language);
    }

    // Read GROQ_API_KEY from cobalt's config (hot-reloadable via env update)
    const { env } = await import("../../config.js");
    const apiKey = env.groqApiKey;
    if (!apiKey) {
        return { segments: [], error: "GROQ_API_KEY environment variable is not set" };
    }

    try {
        const response = await fetch(GROQ_API_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
            },
            body: form,
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorDetail = errorText;
            try {
                const errorJson = JSON.parse(errorText);
                errorDetail = errorJson.error?.message || errorDetail;
            } catch {}

            // Retry on server errors
            if (response.status >= 500 && retryCount < MAX_RETRIES) {
                const delay = (retryCount + 1) * 1000; // exponential backoff: 1s, 2s, 4s, 8s, 16s
                await sleep(delay);
                return transcribeAudio(audioBytes, filename, language, model, retryCount + 1);
            }

            return {
                segments: [],
                error: `Groq API error ${response.status}: ${errorDetail}`,
            };
        }

        const data = await response.json();

        if (!data.segments || data.segments.length === 0) {
            return { segments: [], error: null };
        }

        const segments = data.segments.map((seg) => ({
            start: seg.start,
            end: seg.end,
            text: seg.text?.trim() || "",
        })).filter((seg) => seg.text.length > 0);

        return { segments, error: null };
    } catch (err) {
        if (retryCount < MAX_RETRIES) {
            const delay = (retryCount + 1) * 1000;
            await sleep(delay);
            return transcribeAudio(audioBytes, filename, language, model, retryCount + 1);
        }

        return { segments: [], error: `Network error: ${err.message}` };
    }
}

/**
 * Sleep utility for retry backoff.
 * @param {number} ms - Milliseconds to sleep
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export { MAX_FILE_SIZE, MAX_RETRIES };