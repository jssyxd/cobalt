<script lang="ts">
    import { t } from "$lib/i18n/translations";
    import { ASRPipeline, type ASRProgress } from "$lib/api/asr-pipeline";
    import { isBilibiliUrl } from "$lib/api/bilibili";

    let videoUrl = $state("");
    let language = $state("zh");
    let progress = $state<ASRProgress>({
        status: "idle",
        progress: 0,
        message: ""
    });
    let transcription = $state<string>("");
    let isProcessing = $state(false);
    let pipeline: ASRPipeline | null = null;

    const languages = [
        { code: "zh", name: "中文" },
        { code: "en", name: "English" },
        { code: "ja", name: "日本語" },
        { code: "ko", name: "한국어" },
    ];

    // Static fallback text
    const staticTitle = "Speech to Text";
    const staticDesc = "Convert Bilibili video audio to text using AI";
    const staticPlaceholder = "Paste Bilibili video URL here";
    const staticStartBtn = "Start Transcription";
    const staticStopBtn = "Stop";
    const staticCopyBtn = "Copy";
    const staticResultTitle = "Transcription Result";

    function isValidUrl(url: string): boolean {
        try {
            return /^https?\:/i.test(new URL(url).protocol);
        } catch {
            return false;
        }
    }

    async function startTranscription() {
        if (!isValidUrl(videoUrl) || !isBilibiliUrl(videoUrl)) {
            alert("请输入有效的B站视频链接");
            return;
        }

        isProcessing = true;
        transcription = "";

        const callbacks = {
            onProgress: (p: ASRProgress) => {
                progress = p;
            },
            onComplete: (result: { text: string }) => {
                transcription = result.text;
                isProcessing = false;
            },
            onError: (error: Error) => {
                progress = {
                    status: "error",
                    progress: 0,
                    message: error.message,
                    error: error.message
                };
                isProcessing = false;
            }
        };

        pipeline = new ASRPipeline(callbacks, language);
        await pipeline.processUrl(videoUrl);
    }

    function stopTranscription() {
        if (pipeline) {
            pipeline.abort();
            pipeline = null;
        }
        isProcessing = false;
    }

    function copyTranscription() {
        navigator.clipboard.writeText(transcription);
    }

    $effect(() => {
        return () => {
            if (pipeline) {
                pipeline.abort();
            }
        };
    });
</script>

<svelte:head>
    <title>{staticTitle} - Cobalt</title>
</svelte:head>

<div class="asr-container center-column-container">
    <h1 class="asr-title">{staticTitle}</h1>
    <p class="asr-description">{staticDesc}</p>

    <div class="asr-input-section">
        <input
            type="text"
            bind:value={videoUrl}
            placeholder={staticPlaceholder}
            class="asr-input"
            disabled={isProcessing}
        />
        
        <select bind:value={language} class="asr-select" disabled={isProcessing}>
            {#each languages as lang}
                <option value={lang.code}>{lang.name}</option>
            {/each}
        </select>

        {#if isProcessing}
            <button class="asr-button stop" onclick={stopTranscription}>
                {staticStopBtn}
            </button>
        {:else}
            <button 
                class="asr-button start" 
                onclick={startTranscription}
                disabled={!isValidUrl(videoUrl) || !isBilibiliUrl(videoUrl)}
            >
                {staticStartBtn}
            </button>
        {/if}
    </div>

    {#if progress.message}
        <div class="asr-progress" class:error={progress.status === "error"}>
            <div class="progress-bar">
                <div 
                    class="progress-fill" 
                    style="width: {progress.progress}%"
                ></div>
            </div>
            <p class="progress-message">{progress.message}</p>
            {#if progress.videoInfo}
                <p class="video-info">{progress.videoInfo.title}</p>
            {/if}
        </div>
    {/if}

    {#if transcription}
        <div class="asr-result">
            <div class="result-header">
                <h2>{staticResultTitle}</h2>
                <button class="copy-button" onclick={copyTranscription}>
                    {staticCopyBtn}
                </button>
            </div>
            <div class="result-content">
                <pre>{transcription}</pre>
            </div>
        </div>
    {/if}
</div>

<style>
    .asr-container {
        padding: var(--padding);
        max-width: 800px;
        margin: 0 auto;
        gap: 20px;
    }

    .asr-title {
        font-size: 2rem;
        font-weight: 700;
        margin: 0;
        color: var(--secondary);
    }

    .asr-description {
        color: var(--gray);
        margin: 0;
        text-align: center;
    }

    .asr-input-section {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        width: 100%;
    }

    .asr-input {
        flex: 1;
        min-width: 250px;
        padding: 12px 16px;
        border: 1.5px solid var(--input-border);
        border-radius: var(--border-radius);
        background: var(--primary);
        color: var(--secondary);
        font-size: 14px;
        font-family: inherit;
    }

    .asr-input:focus {
        outline: none;
        border-color: var(--secondary);
    }

    .asr-input:disabled {
        opacity: 0.6;
    }

    .asr-select {
        padding: 12px 16px;
        border: 1.5px solid var(--input-border);
        border-radius: var(--border-radius);
        background: var(--primary);
        color: var(--secondary);
        font-size: 14px;
        cursor: pointer;
    }

    .asr-select:disabled {
        opacity: 0.6;
    }

    .asr-button {
        padding: 12px 24px;
        border: none;
        border-radius: var(--border-radius);
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: background-color 0.2s, opacity 0.2s;
    }

    .asr-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .asr-button.start {
        background: var(--secondary);
        color: var(--primary);
    }

    .asr-button.start:hover:not(:disabled) {
        background: var(--accent);
    }

    .asr-button.stop {
        background: #e74c3c;
        color: white;
    }

    .asr-button.stop:hover {
        background: #c0392b;
    }

    .asr-progress {
        width: 100%;
        padding: 16px;
        background: var(--sidebar-bg);
        border-radius: var(--border-radius);
    }

    .asr-progress.error {
        background: rgba(231, 76, 60, 0.1);
    }

    .progress-bar {
        height: 8px;
        background: var(--input-border);
        border-radius: 4px;
        overflow: hidden;
        margin-bottom: 12px;
    }

    .progress-fill {
        height: 100%;
        background: var(--secondary);
        transition: width 0.3s ease;
    }

    .asr-progress.error .progress-fill {
        background: #e74c3c;
    }

    .progress-message {
        margin: 0;
        font-size: 14px;
        color: var(--secondary);
    }

    .video-info {
        margin: 8px 0 0;
        font-size: 12px;
        color: var(--gray);
    }

    .asr-result {
        width: 100%;
        background: var(--sidebar-bg);
        border-radius: var(--border-radius);
        overflow: hidden;
    }

    .result-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px;
        border-bottom: 1px solid var(--input-border);
    }

    .result-header h2 {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
    }

    .copy-button {
        padding: 8px 16px;
        border: 1px solid var(--input-border);
        border-radius: var(--border-radius);
        background: var(--primary);
        color: var(--secondary);
        font-size: 12px;
        cursor: pointer;
        transition: background-color 0.2s;
    }

    .copy-button:hover {
        background: var(--sidebar-bg);
    }

    .result-content {
        padding: 16px;
        max-height: 500px;
        overflow-y: auto;
    }

    .result-content pre {
        margin: 0;
        white-space: pre-wrap;
        word-wrap: break-word;
        font-size: 14px;
        line-height: 1.6;
        font-family: inherit;
    }
</style>
