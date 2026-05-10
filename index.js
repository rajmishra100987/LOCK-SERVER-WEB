// ==================== RAJ MISHRA ULTIMATE GUARD BOT ====================
// FINAL VERSION | 24/7 | AUTO RECONNECT | ONLY ON-CHANGE PROTECTION

const fs = require('fs');
const path = require('path');
const express = require('express');
const api = require('fca-mafiya');

// ==================== CONFIG ====================
const PORT = 4000;
const REVERT_DELAY_MIN = 2000;
const REVERT_DELAY_MAX = 5000;
const MAX_LOGS = 30;
const NICKNAME_SET_DELAY = 3000;
const HEALTH_CHECK_INTERVAL = 60000;
const MEMORY_LIMIT_MB = 500;
const MQTT_RECONNECT_DELAY = 5000;
const MAX_MQTT_RECONNECT = 20;

// ==================== DATA DIR ====================
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ==================== GLOBAL VARIABLES ====================
let activeApi = null;
let logs = [];
let healthInterval = null;

// ==================== LOG FUNCTION ====================
function addLog(message, type = 'info') {
    const time = new Date().toLocaleTimeString();
    const logEntry = { time, message, type };
    logs.unshift(logEntry);
    if (logs.length > MAX_LOGS) logs = logs.slice(0, MAX_LOGS);
    console.log(`[${time}] ${message}`);
}

// ==================== FILE READING FUNCTIONS ====================
function readCookies() {
    const cookiesPath = path.join(__dirname, 'cookies.txt');
    if (!fs.existsSync(cookiesPath)) {
        addLog('❌ cookies.txt not found', 'error');
        return null;
    }
    const content = fs.readFileSync(cookiesPath, 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 0 && !trimmed.startsWith('//') && trimmed.includes('c_user')) {
            addLog('✅ Cookie loaded', 'success');
            return trimmed;
        }
    }
    addLog('❌ No valid cookie found', 'error');
    return null;
}

function readConvo() {
    const convoPath = path.join(__dirname, 'convo.txt');
    if (!fs.existsSync(convoPath)) {
        addLog('❌ convo.txt not found', 'error');
        return null;
    }
    return fs.readFileSync(convoPath, 'utf8').trim();
}

function readGroupName() {
    const groupPath = path.join(__dirname, 'groupname.txt');
    if (!fs.existsSync(groupPath)) return null;
    return fs.readFileSync(groupPath, 'utf8').trim();
}

function readDefaultNickname() {
    const nickPath = path.join(__dirname, 'defaultnickname.txt');
    if (!fs.existsSync(nickPath)) return null;
    return fs.readFileSync(nickPath, 'utf8').trim();
}

// ==================== COOKIE PARSER ====================
class CookieParser {
    static parse(rawCookie) {
        if (!rawCookie || typeof rawCookie !== 'string') return null;
        
        try {
            if (rawCookie.trim().startsWith('{') || rawCookie.trim().startsWith('[')) {
                const parsed = JSON.parse(rawCookie);
                return Array.isArray(parsed) ? parsed : [parsed];
            }
            
            const cookies = [];
            const pairs = rawCookie.split(';');
            
            for (const pair of pairs) {
                const [key, value] = pair.split('=');
                if (key && value) {
                    cookies.push({
                        key: key.trim(),
                        value: value.trim(),
                        domain: ".facebook.com",
                        path: "/",
                        hostOnly: false,
                        secure: true
                    });
                }
            }
            
            const hasCUser = cookies.some(c => c.key === 'c_user');
            const hasDatr = cookies.some(c => c.key === 'datr');
            
            if (!hasCUser || !hasDatr) {
                addLog('⚠️ Cookie missing c_user or datr', 'warn');
                return null;
            }
            
            return cookies;
        } catch (e) {
            addLog(`❌ Cookie parse error: ${e.message}`, 'error');
            return null;
        }
    }
}

// ==================== RATE LIMITER ====================
class RateLimiter {
    constructor(delayMs = 1000) {
        this.queue = [];
        this.processing = false;
        this.delayMs = delayMs;
    }
    
    async execute(fn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ fn, resolve, reject });
            this.process();
        });
    }
    
    async process() {
        if (this.processing || this.queue.length === 0) return;
        this.processing = true;
        
        const { fn, resolve, reject } = this.queue.shift();
        try {
            const result = await fn();
            resolve(result);
        } catch (e) {
            reject(e);
        }
        
        setTimeout(() => {
            this.processing = false;
            this.process();
        }, this.delayMs);
    }
}

// ==================== MQTT MANAGER WITH AUTO RECONNECT ====================
class MQTTManager {
    constructor(apiInstance, onEvent) {
        this.api = apiInstance;
        this.onEvent = onEvent;
        this.isListening = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = MAX_MQTT_RECONNECT;
        this.reconnectDelay = MQTT_RECONNECT_DELAY;
        this.listenFunction = null;
    }
    
    start() {
        if (this.isListening) return;
        this.isListening = true;
        this.reconnectAttempts = 0;
        this.connect();
    }
    
    connect() {
        if (!this.api) {
            addLog('❌ No API for MQTT', 'error');
            setTimeout(() => this.reconnect(), 10000);
            return;
        }
        
        addLog(`🔌 MQTT connecting...`, 'info');
        
        try {
            this.listenFunction = this.api.listenMqtt(async (err, event) => {
                if (err) {
                    addLog(`⚠️ MQTT error: ${err.message || err}`, 'error');
                    this.handleDisconnect();
                    return;
                }
                
                if (this.reconnectAttempts > 0) {
                    addLog('✅ MQTT reconnected!', 'success');
                    this.reconnectAttempts = 0;
                }
                
                if (this.onEvent && !err) {
                    await this.onEvent(event);
                }
            });
            
            addLog('👂 MQTT listener active', 'success');
        } catch (e) {
            addLog(`❌ MQTT error: ${e.message}`, 'error');
            this.handleDisconnect();
        }
    }
    
    handleDisconnect() {
        if (!this.isListening) return;
        
        this.reconnectAttempts++;
        
        if (this.reconnectAttempts > this.maxReconnectAttempts) {
            addLog('❌ Max MQTT reconnect attempts reached', 'error');
            this.isListening = false;
            return;
        }
        
        let delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 5);
        addLog(`🔄 MQTT reconnect in ${delay/1000}s (${this.reconnectAttempts}/${this.maxReconnectAttempts})`, 'warn');
        
        setTimeout(() => {
            this.connect();
        }, delay);
    }
    
    stop() {
        this.isListening = false;
        if (this.listenFunction) {
            try { this.listenFunction.stop(); } catch(e) {}
        }
    }
}

// ==================== SESSION MANAGER ====================
class SessionManager {
    constructor() {
        this.cookie = null;
        this.api = null;
        this.isLoggingIn = false;
    }
    
    async loadCookie() {
        this.cookie = readCookies();
        return this.cookie !== null;
    }
    
    async login(retryCount = 0) {
        if (retryCount > 5) {
            addLog('❌ Max login retries reached', 'error');
            return false;
        }
        
        if (this.isLoggingIn) {
            await new Promise(r => setTimeout(r, 3000));
            return this.api !== null;
        }
        
        this.isLoggingIn = true;
        addLog(`🔐 Logging in... (${retryCount + 1}/5)`, 'info');
        
        return new Promise((resolve) => {
            const formattedCookies = CookieParser.parse(this.cookie);
            if (!formattedCookies) {
                addLog('❌ Invalid cookie format', 'error');
                this.isLoggingIn = false;
                resolve(false);
                return;
            }
            
            const timeout = setTimeout(() => {
                addLog('⏰ Login timeout', 'error');
                this.isLoggingIn = false;
                resolve(false);
            }, 30000);
            
            api.login(formattedCookies, {
                logLevel: "silent",
                forceLogin: true,
                selfListen: true,
                userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }, (err, apiInstance) => {
                clearTimeout(timeout);
                
                if (err) {
                    addLog(`❌ Login failed: ${err.error || err}`, 'error');
                    this.isLoggingIn = false;
                    setTimeout(() => {
                        this.login(retryCount + 1).then(resolve);
                    }, 10000);
                } else if (apiInstance) {
                    this.api = apiInstance;
                    activeApi = apiInstance;
                    this.isLoggingIn = false;
                    addLog(`✅ Login successful!`, 'success');
                    resolve(true);
                } else {
                    addLog('❌ Login returned invalid API', 'error');
                    this.isLoggingIn = false;
                    resolve(false);
                }
            });
        });
    }
    
    getApi() {
        return this.api;
    }
}

const sessionManager = new SessionManager();

// ==================== GUARD BOT ====================
class GuardBot {
    constructor() {
        this.config = {
            threadID: null,
            targetGroupName: null,
            defaultNickname: null,
            running: false
        };
        this.stats = {
            nameReverts: 0,
            nickReverts: 0,
            membersSet: 0,
            startTime: Date.now()
        };
        this.memberCache = new Map();
        this.isSettingNicknames = false;
        this.mqttManager = null;
    }
    
    loadConfig() {
        this.config.threadID = readConvo();
        this.config.targetGroupName = readGroupName();
        this.config.defaultNickname = readDefaultNickname();
        
        if (!this.config.threadID) {
            addLog('❌ convo.txt missing', 'error');
            return false;
        }
        
        addLog(`📋 Target Thread: ${this.config.threadID}`, 'info');
        if (this.config.targetGroupName) {
            addLog(`📋 Group Name Lock: ${this.config.targetGroupName}`, 'info');
        }
        if (this.config.defaultNickname) {
            addLog(`📋 Default Nickname: ${this.config.defaultNickname}`, 'info');
        }
        
        return true;
    }
    
    async getAllMembers(apiInstance) {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                addLog('⏰ Get members timeout', 'error');
                resolve([]);
            }, 15000);
            
            apiInstance.getThreadInfo(this.config.threadID, (err, info) => {
                clearTimeout(timeout);
                
                if (err || !info || !info.participantIDs) {
                    addLog(`❌ Could not get members: ${err}`, 'error');
                    resolve([]);
                    return;
                }
                
                const botId = apiInstance.getCurrentUserID();
                const members = info.participantIDs.filter(id => id !== botId);
                addLog(`👥 Found ${members.length} members`, 'info');
                resolve(members);
            });
        });
    }
    
    async setMemberNickname(apiInstance, userID, nickname) {
        if (!apiInstance || !userID || !nickname) return false;
        if (userID === apiInstance.getCurrentUserID()) return false;
        
        return new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(false), 10000);
            
            apiInstance.changeNickname(nickname, this.config.threadID, userID, (err) => {
                clearTimeout(timeout);
                if (!err) {
                    this.memberCache.set(userID, nickname);
                    resolve(true);
                } else {
                    resolve(false);
                }
            });
        });
    }
    
    async setAllMembersNickname(apiInstance) {
        if (!this.config.defaultNickname) return 0;
        if (this.isSettingNicknames) return 0;
        
        this.isSettingNicknames = true;
        
        const members = await this.getAllMembers(apiInstance);
        if (members.length === 0) {
            this.isSettingNicknames = false;
            return 0;
        }
        
        let successCount = 0;
        let failCount = 0;
        
        addLog(`🔄 Setting nicknames for ${members.length} members...`, 'info');
        
        for (let i = 0; i < members.length; i++) {
            const userID = members[i];
            const cachedNick = this.memberCache.get(userID);
            
            if (cachedNick === this.config.defaultNickname) continue;
            
            const success = await this.setMemberNickname(apiInstance, userID, this.config.defaultNickname);
            if (success) successCount++;
            else failCount++;
            
            if ((i + 1) % 10 === 0) {
                addLog(`📝 Progress: ${i+1}/${members.length}`, 'info');
            }
            
            await new Promise(r => setTimeout(r, NICKNAME_SET_DELAY));
        }
        
        addLog(`✅ Nicknames: ${successCount} set, ${failCount} failed`, 'success');
        this.stats.membersSet = successCount;
        this.isSettingNicknames = false;
        return successCount;
    }
    
    async setInitialSettings() {
        const apiInstance = sessionManager.getApi();
        if (!apiInstance) return false;
        
        if (this.config.targetGroupName) {
            addLog(`🏷️ Setting group name...`, 'info');
            await new Promise((resolve) => {
                const timeout = setTimeout(() => resolve(), 10000);
                apiInstance.setTitle(this.config.targetGroupName, this.config.threadID, (err) => {
                    clearTimeout(timeout);
                    if (!err) addLog('✅ Group name set', 'success');
                    resolve();
                });
            });
        }
        
        if (this.config.defaultNickname) {
            addLog(`🏷️ Setting nicknames for ALL members (ONCE AT START)...`, 'info');
            await this.setAllMembersNickname(apiInstance);
        }
        
        return true;
    }
    
    async protectNickname(apiInstance, changedUserID, newNickname) {
        if (!this.config.defaultNickname) return false;
        if (changedUserID === apiInstance.getCurrentUserID()) return false;
        if (newNickname === this.config.defaultNickname) return false;
        
        const cachedNick = this.memberCache.get(changedUserID);
        if (cachedNick === this.config.defaultNickname) return false;
        
        addLog(`⚠️ Nickname changed for ${changedUserID} -> "${newNickname}"`, 'warn');
        
        const delay = Math.floor(Math.random() * (REVERT_DELAY_MAX - REVERT_DELAY_MIN + 1) + REVERT_DELAY_MIN);
        
        return new Promise((resolve) => {
            setTimeout(async () => {
                const success = await this.setMemberNickname(apiInstance, changedUserID, this.config.defaultNickname);
                if (success) {
                    this.stats.nickReverts++;
                    addLog(`✅ Nickname reverted to "${this.config.defaultNickname}"`, 'success');
                    resolve(true);
                } else {
                    addLog(`❌ Failed to revert nickname`, 'error');
                    resolve(false);
                }
            }, delay);
        });
    }
    
    startGuard() {
        const apiInstance = sessionManager.getApi();
        if (!apiInstance) return false;
        
        // NO PERIODIC SYNC - Sirf tab kaam karega jab koi change karega
        
        // Setup MQTT with auto reconnect
        this.mqttManager = new MQTTManager(apiInstance, async (event) => {
            if (!this.config.running) return;
            if (event.threadID && event.threadID !== this.config.threadID) return;
            
            // Group name change protect
            if (event.type === "event" && event.logMessageType === "log:thread-name") {
                const newName = event.logMessageData?.name;
                if (this.config.targetGroupName && newName && newName !== this.config.targetGroupName) {
                    addLog(`⚠️ Group name changed to "${newName}" - Reverting`, 'warn');
                    setTimeout(() => {
                        apiInstance.setTitle(this.config.targetGroupName, this.config.threadID, (err) => {
                            if (!err) {
                                this.stats.nameReverts++;
                                addLog(`✅ Group name reverted to "${this.config.targetGroupName}"`, 'success');
                            }
                        });
                    }, Math.random() * 3000 + 1000);
                }
            }
            
            // Nickname change protect - Sirf tab jab KOI CHANGE KARE
            if (event.type === "event" && event.logMessageType === "log:user-nickname") {
                const changedUserID = event.logMessageData?.participant_id;
                const newNickname = event.logMessageData?.nickname;
                if (changedUserID && newNickname) {
                    await this.protectNickname(apiInstance, changedUserID, newNickname);
                }
            }
            
            // New member join - Auto set nickname
            if (event.type === "event" && event.logMessageType === "log:subscribe") {
                const newMembers = event.logMessageData?.addedParticipants || [];
                for (const member of newMembers) {
                    if (member.userId && this.config.defaultNickname) {
                        setTimeout(async () => {
                            await this.setMemberNickname(apiInstance, member.userId, this.config.defaultNickname);
                            addLog(`✅ Nickname set for new member`, 'success');
                        }, 2000);
                    }
                }
            }
        });
        
        this.mqttManager.start();
        addLog('🛡️ Guard active - Protecting on changes only', 'success');
        return true;
    }
    
    startHealthCheck() {
        healthInterval = setInterval(() => {
            const usedMemory = process.memoryUsage().heapUsed / 1024 / 1024;
            
            if (usedMemory > MEMORY_LIMIT_MB) {
                addLog(`⚠️ Memory: ${usedMemory.toFixed(1)}MB - Cleaning`, 'warn');
                if (this.memberCache.size > 500) {
                    const keys = Array.from(this.memberCache.keys());
                    for (let i = 0; i < 100; i++) {
                        this.memberCache.delete(keys[i]);
                    }
                }
                if (global.gc) global.gc();
            }
        }, HEALTH_CHECK_INTERVAL);
    }
    
    async start() {
        addLog('🚀 Starting Guard Bot...', 'info');
        
        if (!this.loadConfig()) return false;
        
        const loaded = await sessionManager.loadCookie();
        if (!loaded) return false;
        
        const loginSuccess = await sessionManager.login();
        if (!loginSuccess) return false;
        
        await this.setInitialSettings();
        
        this.config.running = true;
        const guardStarted = this.startGuard();
        
        if (!guardStarted) return false;
        
        this.startHealthCheck();
        
        addLog('🛡️ RAJ MISHRA GUARD BOT STARTED!', 'success');
        addLog('✅ Mode: Only revert when someone changes', 'success');
        addLog('✅ Auto-Reconnect: ENABLED', 'success');
        addLog('✅ 24/7 Ready: YES', 'success');
        
        return true;
    }
    
    getStats() {
        return {
            running: this.config.running,
            nameReverts: this.stats.nameReverts,
            nickReverts: this.stats.nickReverts,
            membersSet: this.stats.membersSet,
            membersInCache: this.memberCache.size,
            uptime: Math.floor((Date.now() - this.stats.startTime) / 1000),
            threadID: this.config.threadID,
            groupNameLocked: !!this.config.targetGroupName,
            nicknameLocked: !!this.config.defaultNickname,
            logs: logs.slice(0, 15)
        };
    }
}

const guardBot = new GuardBot();

// ==================== EXPRESS SERVER ====================
const app = express();

app.get('/', (req, res) => {
    const stats = guardBot.getStats();
    const uptimeHours = Math.floor(stats.uptime / 3600);
    const uptimeMinutes = Math.floor((stats.uptime % 3600) / 60);
    const uptimeSeconds = stats.uptime % 60;
    
    let logsHtml = '';
    for (const log of logs.slice(0, 15)) {
        const color = log.type === 'error' ? '#ff4444' : (log.type === 'success' ? '#00ff88' : '#00ffff');
        logsHtml += `<div style="color: ${color};">[${log.time}] ${log.message}</div>`;
    }
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>RAJ MISHRA GUARD BOT</title>
            <meta http-equiv="refresh" content="15">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body {
                    font-family: 'Courier New', monospace;
                    background: linear-gradient(135deg, #0a0e27 0%, #1a1a3e 100%);
                    color: #00ff88;
                    padding: 20px;
                    text-align: center;
                }
                .container {
                    max-width: 500px;
                    margin: 0 auto;
                    background: rgba(0,0,0,0.8);
                    border-radius: 20px;
                    padding: 20px;
                    border: 1px solid #00ff88;
                }
                h1 { color: #00ff88; text-shadow: 0 0 10px #00ff88; }
                .status { font-size: 24px; margin: 20px 0; }
                .online { color: #00ff88; animation: pulse 1s infinite; }
                @keyframes pulse {
                    0% { opacity: 1; }
                    50% { opacity: 0.6; }
                    100% { opacity: 1; }
                }
                .stats, .logs {
                    text-align: left;
                    background: #000;
                    padding: 15px;
                    border-radius: 10px;
                    margin: 15px 0;
                }
                .stat-item { margin: 8px 0; font-family: monospace; font-size: 13px; }
                .logs { max-height: 250px; overflow-y: auto; font-size: 11px; }
                .footer { margin-top: 20px; font-size: 11px; color: #666; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🛡️ RAJ MISHRA</h1>
                <h3>ULTIMATE GUARD BOT</h3>
                
                <div class="status">
                    ${stats.running ? '<span class="online">● ONLINE & PROTECTING</span>' : '<span style="color:#ff0000">● OFFLINE</span>'}
                </div>
                
                <div class="stats">
                    <div class="stat-item">📊 STATISTICS</div>
                    <div class="stat-item">├─ Name Reverts: ${stats.nameReverts}</div>
                    <div class="stat-item">├─ Nickname Reverts: ${stats.nickReverts}</div>
                    <div class="stat-item">└─ Members Protected: ${stats.membersInCache}</div>
                </div>
                
                <div class="stats">
                    <div class="stat-item">⚙️ CONFIGURATION</div>
                    <div class="stat-item">├─ Group Name Lock: ${stats.groupNameLocked ? '✅' : '❌'}</div>
                    <div class="stat-item">├─ Nickname Lock: ${stats.nicknameLocked ? '✅' : '❌'}</div>
                    <div class="stat-item">└─ Mode: Only on change</div>
                </div>
                
                <div class="stats">
                    <div class="stat-item">⏱️ SYSTEM</div>
                    <div class="stat-item">├─ Uptime: ${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s</div>
                    <div class="stat-item">├─ Auto-Reconnect: ✅</div>
                    <div class="stat-item">└─ 24/7 Ready: ✅</div>
                </div>
                
                <div class="logs">
                    <div class="stat-item">📝 RECENT LOGS</div>
                    ${logsHtml || '<div>No logs yet</div>'}
                </div>
                
                <div class="footer">
                    🔒 PROTECTS ONLY WHEN SOMEONE CHANGES | AUTO-RECONNECT | 24/7
                </div>
            </div>
        </body>
        </html>
    `);
});

app.get('/health', (req, res) => {
    const stats = guardBot.getStats();
    res.json({
        status: stats.running ? 'active' : 'inactive',
        mode: 'on-change-only',
        uptime: stats.uptime,
        reverts: stats.nickReverts,
        membersProtected: stats.membersInCache
    });
});

// ==================== FILE WATCHER ====================
const watchers = new Map();

function watchFiles() {
    const files = ['cookies.txt', 'convo.txt', 'groupname.txt', 'defaultnickname.txt'];
    
    files.forEach(file => {
        const filePath = path.join(__dirname, file);
        if (fs.existsSync(filePath)) {
            if (watchers.has(file)) watchers.get(file).close();
            
            const watcher = fs.watch(filePath, () => {
                addLog(`📝 ${file} changed - Reloading config`, 'info');
                setTimeout(() => guardBot.loadConfig(), 1000);
            });
            watchers.set(file, watcher);
        }
    });
}

// ==================== GRACEFUL SHUTDOWN ====================
function gracefulShutdown() {
    addLog('🛑 Shutting down...', 'warn');
    
    if (healthInterval) clearInterval(healthInterval);
    
    for (const [_, watcher] of watchers) {
        try { watcher.close(); } catch(e) {}
    }
    
    if (guardBot.mqttManager) {
        guardBot.mqttManager.stop();
    }
    
    if (sessionManager.getApi()) {
        try { sessionManager.getApi().logout(); } catch(e) {}
    }
    
    setTimeout(() => process.exit(0), 2000);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('uncaughtException', (error) => {
    addLog(`Exception: ${error.message}`, 'error');
});
process.on('unhandledRejection', (reason) => {
    addLog(`Rejection: ${reason}`, 'error');
});

// ==================== START ====================
const server = app.listen(PORT, '0.0.0.0', async () => {
    console.log('\n' + '='.repeat(60));
    console.log('🛡️ RAJ MISHRA ULTIMATE GUARD BOT - FINAL');
    console.log('='.repeat(60));
    console.log(`🌐 Web UI: http://localhost:${PORT}`);
    console.log(`💚 Health: http://localhost:${PORT}/health`);
    console.log('='.repeat(60));
    console.log('\n📁 REQUIRED FILES:');
    console.log('   ✅ cookies.txt (Facebook cookie)');
    console.log('   ✅ convo.txt (Group ID)');
    console.log('   ⭕ groupname.txt (optional - Group name lock)');
    console.log('   ⭕ defaultnickname.txt (optional - Nickname for ALL)');
    console.log('\n🔒 HOW IT WORKS:');
    console.log('   1. Start me: Sabka nickname set (ek baar)');
    console.log('   2. Koi change karega: Turant revert');
    console.log('   3. Koi change nahi karega: Bot idle');
    console.log('   4. MQTT disconnect: Auto reconnect');
    console.log('='.repeat(60) + '\n');
    
    watchFiles();
    
    setTimeout(async () => {
        const started = await guardBot.start();
        if (!started) {
            console.log('\n❌ FAILED TO START!');
            console.log('Check cookies.txt and convo.txt');
            process.exit(1);
        }
    }, 2000);
});
