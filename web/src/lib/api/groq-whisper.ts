/**
 * Groq Whisper API Client
 * 用于语音转文字
 * 
 * 使用说明：
 * 1. 在 .env 文件中设置 VITE_GROQ_API_KEY=your_api_key
 * 2. 或在部署时通过环境变量配置
 */

// Groq API地址
const GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

// 从环境变量获取 API Key（前端使用）
const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY || "";

export interface WhisperTranscription {
    text: string;
    segments?: {
        start: number;
        end: number;
        text: string;
    }[];
    language?: string;
}

export interface WhisperError {
    error: {
        message: string;
        type: string;
        code: string;
    };
}

/**
 * 将音频Blob转为基础64编码
 */
function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result as string;
            // 移除 data:mime/type;base64, 前缀
            const base64Data = base64.split(',')[1];
            resolve(base64Data);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * 调用Groq Whisper API进行语音识别
 * @param audioBlob 音频数据
 * @param language 语言代码 (如 "zh", "en", "ja")
 * @param apiKey 可选的API Key
 */
export async function transcribeAudio(
    audioBlob: Blob,
    language: string | null = null,
    apiKey: string = GROQ_API_KEY
): Promise<WhisperTranscription> {
    // 将音频转为ArrayBuffer
    const arrayBuffer = await audioBlob.arrayBuffer();
    
    // 创建FormData
    const formData = new FormData();
    
    // 将音频作为文件添加
    formData.append("file", audioBlob, "audio.m4a");
    formData.append("model", "whisper-large-v3-turbo");
    
    // 添加语言参数（如果有指定）
    if (language) {
        formData.append("language", language);
    }

    // 添加响应格式
    formData.append("response_format", "verbose_json");

    // 发送请求
    const response = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`
        },
        body: formData
    });

    if (!response.ok) {
        const errorData = await response.json() as WhisperError;
        throw new Error(errorData.error?.message || `API Error: ${response.status}`);
    }

    return await response.json() as WhisperTranscription;
}

/**
 * 流式音频转写（分块发送）
 * 适用于长音频的分块处理
 */
export class StreamingTranscriber {
    private apiKey: string;
    private language: string | null;
    private segmentDuration = 60; // 每段60秒
    private overlapping = 5; // 重叠5秒用于衔接

    constructor(apiKey: string = GROQ_API_KEY, language: string | null = null) {
        this.apiKey = apiKey;
        this.language = language;
    }

    /**
     * 设置每段音频的时长（秒）
     */
    setSegmentDuration(seconds: number): void {
        this.segmentDuration = Math.min(Math.max(seconds, 10), 300); // 10-300秒
    }

    /**
     * 处理音频并返回所有转写结果
     * 这个是简化版本，实际应该边下载边处理
     */
    async processAudio(audioBlob: Blob): Promise<WhisperTranscription> {
        // 简化版本：直接转写整个音频
        // 实际生产环境需要分块处理
        return transcribeAudio(audioBlob, this.language, this.apiKey);
    }
}