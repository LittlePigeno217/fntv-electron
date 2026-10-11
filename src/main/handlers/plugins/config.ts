import { IpcMainEvent } from 'electron';
import * as fnConfig from '../../../modules/fn_config/config';
import { isMpvPlaybackEnabled } from '../../../modules/fn_config/playbackPreference';
import * as mpvConfigHelpers from '../../common/mpvConfigHelpers';
import { registerHandler } from '../core/ipcHandler';

/**
 * 系统配置插件
 * 处理下载代理等系统配置功能
 */

interface ProxyConfig {
    enabled: boolean;
    proxyUrl: string;
}

interface PlayButtonConfig {
    hideOriginalPlayButton: boolean;
}

// 获取当前代理设置
function handleGetDownloadProxy(event: IpcMainEvent): void {
    const proxyConfig = fnConfig.getDownloadProxyConfig();
    event.reply('download-proxy-info', proxyConfig);
}

// 设置代理配置
function handleSetDownloadProxy(event: IpcMainEvent, { enabled, proxyUrl }: Partial<ProxyConfig>): void {
    try {
        fnConfig.setDownloadProxyConfig({ 
            enabled: enabled !== false, 
            proxyUrl: proxyUrl || 'https://ghfast.top' 
        });
        event.reply('download-proxy-set', { success: true });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        event.reply('download-proxy-set', { success: false, error: errorMessage });
    }
}

// 获取播放按钮配置
function handleGetPlayButtonConfig(event: IpcMainEvent): void {
    event.reply('play-button-config-info', {
        hideOriginalPlayButton: fnConfig.getHideOriginalPlayButton(),
    });
}

// 设置播放按钮配置
function handleSetPlayButtonConfig(event: IpcMainEvent, config?: Partial<PlayButtonConfig>): void {
    try {
        fnConfig.setHideOriginalPlayButton(isMpvPlaybackEnabled(config?.hideOriginalPlayButton));
        event.reply('play-button-config-set', { success: true });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        event.reply('play-button-config-set', { success: false, error: errorMessage });
    }
}

// 获取NAS代理配置
function handleGetNasProxyConfig(event: IpcMainEvent): void {
    const nasProxyEnabled = fnConfig.getNasProxyEnabled();
    event.reply('nas-proxy-info', { nasProxyEnabled });
}

// 设置NAS代理配置
function handleSetNasProxyConfig(event: IpcMainEvent, { nasProxyEnabled }: { nasProxyEnabled: boolean }): void {
    try {
        fnConfig.setNasProxyEnabled(nasProxyEnabled !== false);
        event.reply('nas-proxy-set', { success: true });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        event.reply('nas-proxy-set', { success: false, error: errorMessage });
    }
}

/**
 * 校验并规整弹幕源地址。
 * 约定与 uosc_danmaku 的 api_server 解析保持一致：
 *   · 逗号是「多服务器」分隔符，单个地址里不能出现
 *   · 竖线 / 井号后面是备注，取备注之前的部分做 URL 校验
 *   · 基址不要带 /api/v2，插件会自动拼接
 */
function normalizeDanmakuApiServer(input: string): string {
    const value = input.trim();
    if (!value) return '';
    if (value.includes(',')) {
        throw new Error('地址里不能出现逗号（插件会把逗号当成多个服务器的分隔符）');
    }
    const urlPart = value.split(/[|#]/)[0].trim();
    let parsed: URL;
    try {
        parsed = new URL(urlPart);
    } catch {
        throw new Error('地址格式不正确，示例：http://10.0.0.2:9321/87654321');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('只支持 http 或 https 地址');
    }
    if (parsed.pathname.replace(/\/+$/, '').endsWith('/api/v2')) {
        throw new Error('基址不要带 /api/v2，插件会自动拼接');
    }
    return value;
}

// 获取弹幕源地址
function handleGetDanmakuApiServer(event: IpcMainEvent): void {
    event.reply('danmaku-api-server-info', mpvConfigHelpers.readDanmakuApiServer());
}

// 设置弹幕源地址（传空字符串表示恢复为插件内置默认）
function handleSetDanmakuApiServer(event: IpcMainEvent, payload?: { apiServer?: string }): void {
    try {
        const value = normalizeDanmakuApiServer(payload?.apiServer ?? '');
        const state = mpvConfigHelpers.writeDanmakuApiServer(value);
        event.reply('danmaku-api-server-set', { success: true, state });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        event.reply('danmaku-api-server-set', { success: false, error: errorMessage });
    }
}

// 注册配置相关处理器
function init(): void {
    registerHandler('get-download-proxy', handleGetDownloadProxy);
    registerHandler('set-download-proxy', handleSetDownloadProxy);
    registerHandler('get-play-button-config', handleGetPlayButtonConfig);
    registerHandler('set-play-button-config', handleSetPlayButtonConfig);
    registerHandler('get-nas-proxy', handleGetNasProxyConfig);
    registerHandler('set-nas-proxy', handleSetNasProxyConfig);
    registerHandler('get-danmaku-api-server', handleGetDanmakuApiServer);
    registerHandler('set-danmaku-api-server', handleSetDanmakuApiServer);
}

export {
    init
};
