/**
 * ASR Pipeline
 * 处理音频获取、分块和转写
 */

import {
    getVideoInfo,
    getAudioStream,
    parseBilibiliUrl,
    type BilibiliVideoInfo,
    type BilibiliAudioInfo
} from "./bilibili";

import {
    transcribeAudio,
    type WhisperTranscription
} from "./groq-whisper";

export interface ASRProgress {
    status: "idle" | "fetching_info" | "downloading" | "transcribing" | "completed" | "error";
    progress: number; // 0-100
    message: string;
    videoInfo?: BilibiliVideoInfo;
    transcription?: WhisperTranscription;
    error?: string;
}

export interface ASRCallbacks {
    onProgress: (progress: ASRProgress) => void;
    onComplete: (result: WhisperTranscription) => void;
    onError: (error: Error) => void;
}

/**
 * ASR Pipeline 类
 * 处理从B站视频URL到语音转文字的完整流程
 */
export class ASRPipeline {
    private callbacks: ASRCallbacks;
    private abortController: AbortController | null = null;
    private language: string | null;

    constructor(callbacks: ASRCallbacks, language: string | null = null) {
        this.callbacks = callbacks;
        this.language = language;
    }

    /**
     * 更新进度
     */
    private updateProgress(progress: Partial<ASRProgress>): void {
        this.callbacks.onProgress({
            status: "idle",
            progress: 0,
            message: "",
            ...progress
        } as ASRProgress);
    }

    /**
     * 从URL开始处理
     */
    async processUrl(url: string): Promise<void> {
        this.abortController = new AbortController();

        try {
            // 1. 解析URL获取BVID
            this.updateProgress({
                status: "fetching_info",
                progress: 10,
                message: "解析视频URL..."
            });

            const bvid = parseBilibiliUrl(url);
            if (!bvid) {
                throw new Error("无法解析B站视频URL");
            }

            // 2. 获取视频信息
            this.updateProgress({
                status: "fetching_info",
                progress: 20,
                message: "获取视频信息..."
            });

            const videoInfo = await getVideoInfo(bvid);
            if (!videoInfo) {
                throw new Error("无法获取视频信息，请检查URL是否正确");
            }

            this.updateProgress({
                status: "fetching_info",
                progress: 30,
                message: `正在处理: ${videoInfo.title}`,
                videoInfo
            });

            // 3. 获取音频流地址
            this.updateProgress({
                status: "downloading",
                progress: 40,
                message: "获取音频流..."
            });

            const audioInfo = await getAudioStream(bvid, videoInfo.cid);
            if (!audioInfo) {
                throw new Error("无法获取音频流，可能视频需要登录或已下架");
            }

            // 4. 下载并转写音频
            await this.downloadAndTranscribe(audioInfo.audioUrl, videoInfo);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "未知错误";
            this.updateProgress({
                status: "error",
                progress: 0,
                message: "处理失败",
                error: errorMessage
            });
            this.callbacks.onError(new Error(errorMessage));
        }
    }

    /**
     * 下载音频并转写
     */
    private async downloadAndTranscribe(
        audioUrl: string,
        videoInfo: BilibiliVideoInfo
    ): Promise<void> {
        this.updateProgress({
            status: "downloading",
            progress: 50,
            message: "正在下载音频..."
        });

        // 下载音频
        const audioResponse = await fetch(audioUrl, {
            headers: {
                "Referer": "https://www.bilibili.com",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            },
            signal: this.abortController?.signal
        });

        if (!audioResponse.ok) {
            throw new Error(`音频下载失败: ${audioResponse.status}`);
        }

        // 获取音频数据
        this.updateProgress({
            status: "transcribing",
            progress: 70,
            message: "正在转写，请稍候..."
        });

        const audioBlob = await audioResponse.blob();

        this.updateProgress({
            status: "transcribing",
            progress: 80,
            message: "调用语音识别API..."
        });

        // 调用Whisper API转写
        const transcription = await transcribeAudio(audioBlob, this.language);

        // 完成
        this.updateProgress({
            status: "completed",
            progress: 100,
            message: "转写完成",
            transcription
        });

        this.callbacks.onComplete(transcription);
    }

    /**
     * 停止处理
     */
    abort(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }
}

/**
 * 创建默认的ASR回调
 */
export function createDefaultCallbacks(
    onProgress?: (progress: ASRProgress) => void,
    onComplete?: (result: WhisperTranscription) => void,
    onError?: (error: Error) => void
): ASRCallbacks {
    return {
        onProgress: onProgress || ((p) => console.log("ASR Progress:", p)),
        onComplete: onComplete || ((r) => console.log("ASR Result:", r)),
        onError: onError || ((e) => console.error("ASR Error:", e))
    };
}