/**
 * ASR Pipeline
 * 处理音频获取、分块和转写
 * 支持服务端API获取音频URL
 */

import {
    getVideoInfo,
    getAudioStream,
    parseBilibiliUrl,
    type BilibiliVideoInfo,
    type BilibiliAudioInfo
} from "./bilibili";

import { getAudioUrlFromServer } from "./bilibili-server";

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
            ...this.callbacks,
            ...progress
        } as ASRProgress);
    }

    /**
     * 处理视频URL
     */
    async processUrl(url: string): Promise<void> {
        this.abortController = new AbortController();

        try {
            // 1. 解析URL
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

            // 3. 首先尝试通过服务端API获取音频URL
            this.updateProgress({
                status: "downloading",
                progress: 35,
                message: "通过服务端获取音频..."
            });

            let audioUrl: string | null = null;
            
            try {
                const serverResult = await getAudioUrlFromServer(bvid);
                if (serverResult.success && serverResult.audioUrl) {
                    audioUrl = serverResult.audioUrl;
                    console.log("Got audio URL from server API");
                }
            } catch (e) {
                console.log("Server API failed, trying direct API...");
            }

            // 4. 如果服务端API失败，尝试直接API获取
            if (!audioUrl) {
                this.updateProgress({
                    status: "downloading",
                    progress: 40,
                    message: "尝试直接获取音频流..."
                });

                const audioInfo = await getAudioStream(bvid, videoInfo.cid);
                if (audioInfo) {
                    audioUrl = audioInfo.audioUrl;
                }
            }

            // 5. 如果都无法获取，抛出错误
            if (!audioUrl) {
                throw new Error("无法获取音频流，可能视频需要登录或已下架");
            }

            // 6. 下载并转写音频
            await this.downloadAndTranscribe(audioUrl, videoInfo);

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
        const audioData = await audioResponse.arrayBuffer();

        this.updateProgress({
            status: "transcribing",
            progress: 70,
            message: "正在转写音频..."
        });

        // 转写音频
        const result = await transcribeAudio(
            audioData,
            this.language,
            (progress) => {
                this.updateProgress({
                    status: "transcribing",
                    progress: 70 + progress * 0.25,
                    message: `转写中... ${Math.round(progress * 100)}%`
                });
            }
        );

        this.updateProgress({
            status: "completed",
            progress: 100,
            message: "转写完成",
            transcription: result
        });

        this.callbacks.onComplete(result);
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
