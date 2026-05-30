/**
 * ASR Pipeline - Client-side only
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
    progress: number;
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

export class ASRPipeline {
    private callbacks: ASRCallbacks;
    private abortController: AbortController | null = null;
    private language: string | null;

    constructor(callbacks: ASRCallbacks, language: string | null = null) {
        this.callbacks = callbacks;
        this.language = language;
    }

    private updateProgress(progress: Partial<ASRProgress>): void {
        this.callbacks.onProgress({
            ...this.callbacks,
            ...progress
        } as ASRProgress);
    }

    async processUrl(url: string): Promise<void> {
        this.abortController = new AbortController();

        try {
            this.updateProgress({
                status: "fetching_info",
                progress: 10,
                message: "解析视频URL..."
            });

            const bvid = parseBilibiliUrl(url);
            if (!bvid) {
                throw new Error("无法解析B站视频URL");
            }

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

            // 获取音频流
            this.updateProgress({
                status: "downloading",
                progress: 40,
                message: "获取音频流..."
            });

            const audioInfo = await getAudioStream(bvid, videoInfo.cid);
            if (!audioInfo) {
                throw new Error("无法获取音频流。可能原因：1) 视频需要登录才能获取音频 2) 视频已下架 3) 网络问题");
            }

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

    private async downloadAndTranscribe(
        audioUrl: string,
        videoInfo: BilibiliVideoInfo
    ): Promise<void> {
        this.updateProgress({
            status: "downloading",
            progress: 50,
            message: "正在下载音频..."
        });

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

        const audioData = await audioResponse.arrayBuffer();

        this.updateProgress({
            status: "transcribing",
            progress: 70,
            message: "正在转写音频..."
        });

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

    abort(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }
}
