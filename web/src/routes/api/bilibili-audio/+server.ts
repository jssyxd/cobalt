import { json } from '@sveltejs/kit';
import { Video } from 'bilibili-api-ts/video';
import { Credential } from 'bilibili-api-ts/models/Credential';

export async function GET({ url }) {
    const bvid = url.searchParams.get('bvid');
    
    if (!bvid) {
        return json({ error: 'Missing bvid parameter' }, { status: 400 });
    }
    
    try {
        // 创建 Video 实例（不需要凭据）
        const video = new Video({ bvid });
        
        // 获取视频下载信息
        const playInfo = await video.get_download_url({});
        
        if (!playInfo || !playInfo.dash) {
            return json({ error: 'No play info available' }, { status: 404 });
        }
        
        const dash = playInfo.dash;
        
        // 查找音频流
        let audioUrl: string | null = null;
        let audioType = 'unknown';
        
        if (dash.audio && dash.audio.length > 0) {
            // 优先选择 FLAC 或 AAC
            const bestAudio = dash.audio.reduce((best: any, current: any) => {
                const currentQuality = current.quality || current.dash?.bandwidth || 0;
                const bestQuality = best.quality || best.dash?.bandwidth || 0;
                return currentQuality > bestQuality ? current : best;
            });
            audioUrl = bestAudio.baseUrl || bestAudio.url;
            audioType = bestAudio.codecs || 'audio/mp4';
        }
        
        // 如果没有音频，返回错误
        if (!audioUrl) {
            return json({ 
                error: 'No audio stream found',
                available: {
                    hasAudio: !!dash.audio?.length,
                    hasVideo: !!dash.video?.length
                }
            }, { status: 404 });
        }
        
        return json({
            success: true,
            audioUrl,
            audioType,
            title: playInfo.title || bvid,
            duration: playInfo.duration,
            thumbnail: playInfo.arc?.pic || playInfo.cover || null
        });
        
    } catch (error: any) {
        console.error('bilibili-api-ts error:', error.message || error);
        return json({ 
            error: 'Failed to get audio URL',
            details: error.message || String(error)
        }, { status: 500 });
    }
}
