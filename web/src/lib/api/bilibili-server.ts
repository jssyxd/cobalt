/**
 * Bilibili API Client (Server-side)
 * 使用服务端 API 获取音频 URL
 */

export interface ServerAudioResponse {
    success: boolean;
    audioUrl?: string;
    title?: string;
    duration?: number;
    thumbnail?: string;
    error?: string;
}

/**
 * 通过服务端 API 获取音频 URL
 */
export async function getAudioUrlFromServer(bvid: string): Promise<ServerAudioResponse> {
    try {
        const apiUrl = `/api/bilibili-audio?bvid=${bvid}`;
        const response = await fetch(apiUrl);
        const data = await response.json();
        return data;
    } catch (error) {
        return {
            success: false,
            error: `Failed to call server API: ${error}`
        };
    }
}
