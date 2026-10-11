import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'path';

interface PortableConfigPaths {
    appPath: string;
    isPackaged: boolean;
    resourcesPath: string;
}

interface BundledMpvPaths {
    appPath: string;
    execPath: string;
    isPackaged: boolean;
}

export function resolvePortableConfigDir(paths: PortableConfigPaths): string {
    const baseDir = paths.isPackaged
        ? path.dirname(paths.resourcesPath)
        : paths.appPath;
    return path.join(baseDir, 'third_party', 'fntv-mpv', 'portable_config');
}

export function resolveBundledMpvPath(paths: BundledMpvPaths): string {
    const baseDir = paths.isPackaged
        ? path.dirname(paths.execPath)
        : paths.appPath;
    return path.join(baseDir, 'third_party', 'fntv-mpv', 'mpv.exe');
}

export type MpvConfigSyncResult = 'initialized' | 'updated';

function copyDirectoryRecursive(
    source: string,
    destination: string,
    overwrite: boolean = true,
): void {
    fs.mkdirSync(destination, { recursive: true });

    for (const item of fs.readdirSync(source, { withFileTypes: true })) {
        const sourcePath = path.join(source, item.name);
        const destinationPath = path.join(destination, item.name);
        if (item.isDirectory()) {
            copyDirectoryRecursive(sourcePath, destinationPath, overwrite);
        } else if (overwrite || !fs.existsSync(destinationPath)) {
            fs.copyFileSync(sourcePath, destinationPath);
        }
    }
}

export function synchronizeMpvConfig(
    portableConfigDir: string,
    mpvConfigDir: string,
): MpvConfigSyncResult {
    if (!fs.existsSync(portableConfigDir)) {
        throw new Error(`Portable config directory not found: ${portableConfigDir}`);
    }

    const scriptsDir = path.join(mpvConfigDir, 'scripts');
    if (!fs.existsSync(scriptsDir)) {
        // Existing user files may predate managed scripts; seed missing bundle files only.
        copyDirectoryRecursive(portableConfigDir, mpvConfigDir, false);
        return 'initialized';
    }

    const managedPlugin = 'uosc_danmaku';
    const sourcePluginDir = path.join(portableConfigDir, 'scripts', managedPlugin);
    if (!fs.existsSync(sourcePluginDir) || !fs.statSync(sourcePluginDir).isDirectory()) {
        throw new Error(`Managed MPV plugin not found: ${sourcePluginDir}`);
    }

    const destinationPluginDir = path.join(scriptsDir, managedPlugin);
    fs.rmSync(destinationPluginDir, { recursive: true, force: true });
    copyDirectoryRecursive(sourcePluginDir, destinationPluginDir);
    return 'updated';
}

/**
 * 用户 MPV 配置目录（Windows 为 %APPDATA%\mpv）
 */
export function resolveMpvConfigDir(): string {
    const homeDir = os.homedir();
    if (process.platform === 'win32') {
        return path.join(homeDir, 'AppData', 'Roaming', 'mpv');
    }
    return path.join(homeDir, '.config', 'mpv');
}

/**
 * uosc_danmaku 插件配置文件路径
 */
export function resolveDanmakuConfPath(): string {
    return path.join(resolveMpvConfigDir(), 'script-opts', 'uosc_danmaku.conf');
}

const DANMAKU_API_KEY = 'api_server';
/** 生效行：行首无 # 的 api_server=... */
const DANMAKU_ACTIVE_RE = /^\s*api_server\s*=\s*(.*)$/;
/** 已注释的示例行：# api_server=... */
const DANMAKU_COMMENTED_RE = /^\s*#\s*api_server\s*=/;

export interface DanmakuConfState {
    /** 配置文件绝对路径 */
    confPath: string;
    /** 配置文件是否已存在 */
    exists: boolean;
    /** 当前生效的弹幕源地址；null 表示未设置（使用插件内置默认） */
    apiServer: string | null;
}

function readConfLines(confPath: string): { lines: string[]; eol: string } | null {
    if (!fs.existsSync(confPath)) return null;
    const raw = fs.readFileSync(confPath);
    const eol = raw.includes(Buffer.from('\r\n')) ? '\r\n' : '\n';
    const text = raw.toString('utf8').replace(/\r\n/g, '\n');
    return { lines: text.split('\n'), eol };
}

function writeConfLines(confPath: string, lines: string[], eol: string): void {
    fs.writeFileSync(confPath, Buffer.from(lines.join('\n').replace(/\n/g, eol), 'utf8'));
}

/** 去掉 api_server 值尾部的 |备注 / #备注 */
function stripServerNote(value: string): string {
    return value.split(/[|#]/)[0].trim();
}

/**
 * 读取当前生效的弹幕源地址。
 * 只认未注释的 api_server 行；被注释掉的示例行不算「已设置」。
 */
export function readDanmakuApiServer(): DanmakuConfState {
    const confPath = resolveDanmakuConfPath();
    const parsed = readConfLines(confPath);
    if (!parsed) return { confPath, exists: false, apiServer: null };
    for (const line of parsed.lines) {
        const matched = DANMAKU_ACTIVE_RE.exec(line);
        if (matched) {
            const value = stripServerNote(matched[1]);
            return { confPath, exists: true, apiServer: value || null };
        }
    }
    return { confPath, exists: true, apiServer: null };
}

/**
 * 写入弹幕源地址，全程保持原文件行尾风格，写完回读校验。
 *
 * · 传空字符串 = 清除：把生效行注释掉并保留原值（不能写成 api_server= 空值，
 *   那会让插件的 api_server 列表为空，等于禁用弹弹play 协议搜索）
 * · 传非空 = 覆盖生效行；没有生效行时优先替换注释示例行，否则追加到文件末尾
 */
export function writeDanmakuApiServer(input: string): DanmakuConfState {
    const confPath = resolveDanmakuConfPath();
    const dir = path.dirname(confPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const parsed = readConfLines(confPath);
    const lines = parsed ? parsed.lines : [''];
    const eol = parsed ? parsed.eol : process.platform === 'win32' ? '\r\n' : '\n';
    const value = input.trim();

    let activeIndex = -1;
    let commentedIndex = -1;
    lines.forEach((line, index) => {
        if (DANMAKU_ACTIVE_RE.test(line)) {
            activeIndex = index;
        } else if (commentedIndex === -1 && DANMAKU_COMMENTED_RE.test(line)) {
            commentedIndex = index;
        }
    });

    let replacement = '';
    if (value) {
        replacement = `${DANMAKU_API_KEY}=${value}`;
    } else if (activeIndex >= 0) {
        const previous = DANMAKU_ACTIVE_RE.exec(lines[activeIndex])?.[1].trim() ?? '';
        replacement = `# ${DANMAKU_API_KEY}=${previous}（已由应用清除，需要时删掉行首的 # ）`;
    }

    if (replacement) {
        if (activeIndex >= 0) {
            lines[activeIndex] = replacement;
        } else if (commentedIndex >= 0) {
            lines[commentedIndex] = replacement;
        } else {
            if (lines.length && lines[lines.length - 1] !== '') lines.push('');
            lines.push(replacement);
        }
        writeConfLines(confPath, lines, eol);
    }

    const state = readDanmakuApiServer();
    const expected = value ? stripServerNote(value) : null;
    if (state.apiServer !== expected) {
        throw new Error(`弹幕源地址写入后回读不一致：期望 ${expected}，实际 ${state.apiServer}`);
    }
    return state;
}
