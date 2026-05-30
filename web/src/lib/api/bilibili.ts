/**
 * Bilibili API Client
 * 获取B站视频信息和音频流地址
 */

// B站API基础地址
const BILIBILI_API_BASE = "https://api.bilibili.com";
const BILIBILI_PLAYER_BASE = "https://www.bilibili.com";

// B站视频URL正则
const BILIBILI_URL_REGEX = /(?:https?:\/\/)?(?:www\.)?bilibili\.com\/video\/(BV[\w]+)/i;

// 用户代理
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface BilibiliVideoInfo {
    bvid: string;
    title: string;
    aid: number;
    cid: number;
    duration: number;
    description: string;
    pic: string;
    owner: {
        name: string;
        mid: number;
    };
}

// B站API返回的原始音频信息
export interface BilibiliRawAudioInfo {
    audioUrl?: string;
    baseUrl?: string;
    bandwidth?: number;
    mimeType?: string;
    codecid?: number;
}

export interface BilibiliAudioInfo {
    audioUrl: string;
    bandwidth: number;
    mimeType: string;
    codec: string;
}

export interface BilibiliPlayUrlResponse {
    dash: {
        audio?: BilibiliRawAudioInfo[];
        video?: {
            baseUrl: string;
            bandwidth: number;
            mimeType: string;
            codecid: number;
        }[];
    };
}

/**
 * 解析B站视频URL获取BVID
 */
export function parseBilibiliUrl(url: string): string | null {
    const match = url.match(BILIBILI_URL_REGEX);
    return match ? match[1] : null;
}

/**
 * 获取视频基本信息
 */
export async function getVideoInfo(bvid: string): Promise<BilibiliVideoInfo | null> {
    try {
        const response = await fetch(
            `${BILIBILI_API_BASE}/x/web-interface/view?bvid=${bvid}`,
            {
                headers: {
                    "User-Agent": USER_AGENT,
                    "Referer": "https://www.bilibili.com"
                }
            }
        );

        if (!response.ok) {
            console.error(`Failed to fetch video info: ${response.status}`);
            return null;
        }

        const data = await response.json();
        
        if (data.code !== 0) {
            console.error(`API error: ${data.message}`);
            return null;
        }

        const videoData = data.data;
        const firstPage = videoData.pages?.[0];
        
        return {
            bvid: videoData.bvid,
            title: videoData.title,
            aid: videoData.aid,
            cid: firstPage?.cid || 0,
            duration: videoData.duration,
            description: videoData.desc,
            pic: videoData.pic,
            owner: {
                name: videoData.owner?.name || "Unknown",
                mid: videoData.owner?.mid || 0
            }
        };
    } catch (error) {
        console.error("Error fetching video info:", error);
        return null;
    }
}

/**
 * 获取视频播放地址（包含音频流）
 */
export async function getPlayUrl(bvid: string, cid: number): Promise<BilibiliPlayUrlResponse | null> {
    try {
        const response = await fetch(
            `${BILIBILI_API_BASE}/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=128&fnval=0&fnver=0&fourk=0`,
            {
                headers: {
                    "User-Agent": USER_AGENT,
                    "Referer": "https://www.bilibili.com"
                }
            }
        );

        if (!response.ok) {
            console.error(`Failed to fetch playurl: ${response.status}`);
            return null;
        }

        const data = await response.json();
        
        if (data.code !== 0) {
            console.error(`API error: ${data.message}`);
            return null;
        }

        return data.data;
    } catch (error) {
        console.error("Error fetching playurl:", error);
        return null;
    }
}

/**
 * 获取音频流信息
 */
export async function getAudioStream(bvid: string, cid: number): Promise<BilibiliAudioInfo | null> {
    const playUrl = await getPlayUrl(bvid, cid);
    
    if (!playUrl?.dash?.audio?.length) {
        console.error("No audio stream available");
        return null;
    }

    // 选择最高质量的音频
    const audioList = playUrl.dash.audio;
    const bestAudio = audioList.reduce((best, current) => 
        ((current.bandwidth || 0) > (best.bandwidth || 0)) ? current : best
    );

    return {
        audioUrl: bestAudio.baseUrl || bestAudio.audioUrl || "",
        bandwidth: bestAudio.bandwidth || 0,
        mimeType: bestAudio.mimeType || "audio/mp4",
        codec: getCodecName(bestAudio.codecid || 0)
    };
}

function getCodecName(codecid: number): string {
    const codecs: Record<number, string> = {
        0: "mp4a.40.2",      // AAC
        1: "mp4a.40.2",      // AAC
        2: "mp3",            // MP3
        3: "flac",           // FLAC
        12: "opus",          // Opus
    };
    return codecs[codecid] || "mp4a.40.2";
}

/**
 * 检查URL是否为B站视频
 */
export function isBilibiliUrl(url: string): boolean {
    return BILIBILI_URL_REGEX.test(url);
}