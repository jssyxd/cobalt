import { env } from "../../config.js";
import { resolveRedirectingURL } from "../url.js";
import { transcribeWithGroq, groqSegmentsToSubtitles } from "../asr-handler.js";

/**
 * Convert Bilibili subtitle JSON format to cobalt subtitle format.
 * Bilibili format: { body: [{ from, to, content }] }
 * Cobalt format: { start, end, text }
 */
function convertBilibiliSubtitles(subtitleJson, language) {
    const body = subtitleJson?.body;
    if (!Array.isArray(body)) return [];
    
    return body
        .filter(item => item.from !== undefined && item.to !== undefined && item.content)
        .map(item => ({
            start: item.from,
            end: item.to,
            text: item.content.trim()
        }))
        .filter(item => item.text.length > 0);
}

/**
 * Fetch official subtitles for a Bilibili video via player/v2 API.
 * @param {string|number} aid - Video AV ID
 * @param {string|number} cid - Chapter ID
 * @returns {Promise<Array>} Array of subtitle objects in cobalt format
 */
async function fetchBilibiliSubtitles(aid, cid) {
    try {
        const apiUrl = `https://api.bilibili.com/x/player/v2?aid=${aid}&cid=${cid}`;
        const response = await fetch(apiUrl, {
            headers: {
                "user-agent": "Mozilla/5.0 (compatible; cobalt/1.0)",
                "referer": "https://www.bilibili.com"
            }
        });

        if (!response.ok) {
            return [];
        }

        const data = await response.json();
        const subtitlesList = data?.data?.subtitle?.subtitles;

        if (!Array.isArray(subtitlesList) || subtitlesList.length === 0) {
            return [];
        }

        // Fetch each subtitle file and convert to cobalt format
        const cobaltSubtitles = [];

        for (const sub of subtitlesList) {
            try {
                const subtitleUrl = sub.url;
                const subLang = sub.lan_doc || sub.lan || "unknown";
                const subLabel = sub.lan_doc || sub.lan || "subtitle";

                if (!subtitleUrl) continue;

                const subResponse = await fetch(subtitleUrl, {
                    headers: {
                        "user-agent": "Mozilla/5.0 (compatible; cobalt/1.0)",
                        "referer": "https://www.bilibili.com"
                    }
                });

                if (!subResponse.ok) continue;

                const subtitleJson = await subResponse.json();
                const converted = convertBilibiliSubtitles(subtitleJson, subLang);

                if (converted.length > 0) {
                    cobaltSubtitles.push({
                        type: "official",
                        format: "text",
                        language: subLang,
                        url: subtitleUrl,
                        label: subLabel,
                        data: converted
                    });
                }
            } catch (e) {
                // Continue with next subtitle if one fails
                console.warn(`Failed to fetch subtitle: ${e.message}`);
            }
        }

        return cobaltSubtitles;
    } catch (e) {
        console.warn(`Failed to fetch Bilibili subtitles: ${e.message}`);
        return [];
    }
}

function getBest(content) {
    return content?.filter(v => v.baseUrl || v.url)
                .map(v => (v.baseUrl = v.baseUrl || v.url, v))
                .reduce((a, b) => a?.bandwidth > b?.bandwidth ? a : b);
}

function extractBestQuality(dashData) {
    const bestVideo = getBest(dashData.video),
          bestAudio = getBest(dashData.audio);

    if (!bestVideo || !bestAudio) return [];
    return [ bestVideo, bestAudio ];
}

async function com_download(id, partId) {
    const url = new URL(`https://bilibili.com/video/${id}`);

    if (partId) {
        url.searchParams.set('p', partId);
    }

    const html = await fetch(url, {
        headers: {
            "user-agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
        }
    })
    .then(r => r.text())
    .catch(() => {});

    if (!html) {
        return { error: "fetch.fail" }
    }

    if (!(html.includes('<script>window.__playinfo__=') && html.includes('"video_codecid"'))) {
        return { error: "fetch.empty" };
    }

    const streamData = JSON.parse(
        html.split('<script>window.__playinfo__=')[1].split('</script>')[0]
    );

    // Extract cid from page data for subtitle fetching
    let cid = null;
    const cidMatch = html.match(/"cid"\s*:\s*(\d+)/);
    if (cidMatch) {
        cid = cidMatch[1];
    }

    if (streamData.data.timelength > env.durationLimit * 1000) {
        return { error: "content.too_long" };
    }

    const [ video, audio ] = extractBestQuality(streamData.data.dash);
    if (!video || !audio) {
        return { error: "fetch.empty" };
    }

    let filenameBase = `bilibili_${id}`;
    if (partId) {
        filenameBase += `_${partId}`;
    }

    // Fetch official Bilibili subtitles
    const subtitles = cid ? await fetchBilibiliSubtitles(id, cid) : [];

    return {
        urls: [video.baseUrl, audio.baseUrl],
        audioFilename: `${filenameBase}_audio`,
        filename: `${filenameBase}_${video.width}x${video.height}.mp4`,
        subtitles: subtitles,
        originalSubtitles: subtitles,
        audioUrl: audio.baseUrl,
        audioHeaders: {},
    };
}

async function tv_download(id) {
    const url = new URL(
        'https://api.bilibili.tv/intl/gateway/web/playurl'
        + '?s_locale=en_US&platform=web&qn=64&type=0&device=wap'
        + '&tf=0&spm_id=bstar-web.ugc-video-detail.0.0&from_spm_id='
    );

    url.searchParams.set('aid', id);

    const { data } = await fetch(url).then(a => a.json());
    if (!data?.playurl?.video) {
        return { error: "fetch.empty" };
    }

    const [ video, audio ] = extractBestQuality({
        video: data.playurl.video.map(s => s.video_resource)
                                 .filter(s => s.codecs.includes('avc1')),
        audio: data.playurl.audio_resource
    });

    if (!video || !audio) {
        return { error: "fetch.empty" };
    }

    if (video.duration > env.durationLimit * 1000) {
        return { error: "content.too_long" };
    }

    return {
        urls: [video.url, audio.url],
        audioFilename: `bilibili_tv_${id}_audio`,
        filename: `bilibili_tv_${id}.mp4`,
        subtitles: [],
        originalSubtitles: [],
        audioUrl: audio.url,
        audioHeaders: {},
    };
}

export default async function({ comId, tvId, comShortLink, partId }) {
    if (comShortLink) {
        const patternMatch = await resolveRedirectingURL(`https://b23.tv/${comShortLink}`);
        comId = patternMatch?.comId;
    }

    if (comId) {
        return com_download(comId, partId);
    } else if (tvId) {
        return tv_download(tvId);
    }

    return { error: "fetch.fail" };
}
