// ==================== RAJ MISHRA ULTIMATE GUARD BOT ====================
// SINGLE COOKIE | NO AUTO REFRESH | ALL MEMBERS PROTECTION
// MQTT BASED | FILE BASED | PORT 4000

const fs = require('fs');
const path = require('path');
const express = require('express');
const api = require('fca-mafiya');

// ==================== CONFIG ====================
const PORT = 4000;
const REVERT_DELAY_MIN = 2000;  // 2 second min
const REVERT_DELAY_MAX = 5000;  // 5 second max
const MAX_LOGS = 30;
const NICKNAME_SET_DELAY = 1000; // 1 second gap (SAFE)
const HEALTH_CHECK_INTERVAL = 60000; // 1 minute
const MEMORY_LIMIT_MB = 500;

// ==================== DATA DIR ====================
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ==================== GLOBAL VARIABLES ====================
let activeApi = null;
let logs = [];
let healthInterval = null;
let isReconnecting = false;

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
    // Sirf pehli valid cookie lega
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 0 && !trimmed.startsWith('//') && trimmed.includes('c_user')) {
            addLog('✅ Cookie loaded successfully', 'success');
            return trimmed;
        }
    }
    addLog('❌ No valid cookie found in cookies.txt', 'error');
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

// ==================== SAFE COOKIE PARSER ====================
class SafeCookieParser {
    static parse(rawCookie) {
        if (!rawCookie || typeof rawCookie !== 'string') return null;
        
        try {
            // Try JSON format first
            if (rawCookie.trim().startsWith('{') || rawCookie.trim().startsWith('[')) {
                const parsed = JSON.parse(rawCookie);
                return Array.isArray(parsed) ? parsed : [parsed];
            }
            
            // Try cookie string format
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
            
            // Validate essential cookies
            const hasCUser = cookies.some(c => c.key === 'c_user');
            const hasDatr = cookies.some(c => c.key === 'datr');
            
            if (!hasCUser || !hasDatr) {
                addLog('⚠️ Cookie missing essential fields (c_user or datr)', 'warn');
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

// ==================== SESSION MANAGER (SINGLE COOKIE ONLY) ====================
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
        addLog(`🔐 Logging in... (Attempt ${retryCount + 1}/5)`, 'info');
        
        return new Promise((resolve) => {
            const formattedCookies = SafeCookieParser.parse(this.cookie);
            if (!formattedCookies) {
                addLog('❌ Invalid cookie format', 'error');
                this.isLoggingIn = false;
                resolve(false);
                return;
            }
            
            const timeout = setTimeout(() => {
                addLog('⏰ Login timeout (30s)', 'error');
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
                    
                    if (retryCount < 5) {
                        setTimeout(() => {
                            this.login(retryCount + 1).then(resolve);
                        }, 10000);
                    } else {
                        resolve(false);
                    }
                } else if (apiInstance && apiInstance.getCurrentUserID()) {
                    this.api = apiInstance;
                    activeApi = apiInstance;
                    this.isLoggingIn = false;
                    addLog(`✅ Login successful! User ID: ${apiInstance.getCurrentUserID()}`, 'success');
                    resolve(true);
                } else {
                    addLog('❌ Login returned invalid API instance', 'error');
                    this.isLoggingIn = false;
                    resolve(false);
                }
            });
        });
    }
    
    getApi() {
        return this.api;
    }
    
    isSessionAlive() {
        return new Promise((resolve) => {
            if (!this.api) {
                resolve(false);
                return;
            }
            
            const timeout = setTimeout(() => resolve(false), 10000);
            this.api.getUserInfo(this.api.getCurrentUserID(), (err) => {
                clearTimeout(timeout);
                resolve(!err);
            });
        });
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
            startTime: Date.now(),
            lastHealthCheck: Date.now()
        };
        this.processedEvents = new Set();
        this.memberCache = new Map();
        this.isSettingNicknames = false;
    }
    
    loadConfig() {
        this.config.threadID = readConvo();
        this.config.targetGroupName = readGroupName();
        this.config.defaultNickname = readDefaultNickname();
        
        if (!this.config.threadID) {
            addLog('❌ convo.txt missing - Cannot start', 'error');
            return false;
        }
        
        addLog(`📋 Target Thread: ${this.config.threadID}`, 'info');
        if (this.config.targetGroupName) {
            addLog(`📋 Group Name Lock: ${this.config.targetGroupName}`, 'info');
        }
        if (this.config.defaultNickname) {
            addLog(`📋 Default Nickname: ${this.config.defaultNickname}`, 'info');
        } else {
            addLog(`⚠️ defaultnickname.txt missing - Nickname protection disabled`, 'warn');
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
                    addLog(`❌ Could not get member list: ${err}`, 'error');
                    resolve([]);
                    return;
                }
                
                const botId = apiInstance.getCurrentUserID();
                const members = info.participantIDs.filter(id => id !== botId);
                addLog(`👥 Found ${members.length} members in group`, 'info');
                resolve(members);
            });
        });
    }
    
    async setMemberNickname(apiInstance, userID, nickname) {
        if (!apiInstance || !userID || !nickname) return false;
        if (userID === apiInstance.getCurrentUserID()) return false;
        
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve(false);
            }, 10000);
            
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
        if (this.isSettingNicknames) {
            addLog('⚠️ Already setting nicknames, skipping...', 'warn');
            return 0;
        }
        
        this.isSettingNicknames = true;
        
        const members = await this.getAllMembers(apiInstance);
        if (members.length === 0) {
            this.isSettingNicknames = false;
            return 0;
        }
        
        let successCount = 0;
        let failCount = 0;
        
        const estimatedTime = Math.ceil(members.length * NICKNAME_SET_DELAY / 1000);
        addLog(`🔄 Setting nicknames for ${members.length} members (~${estimatedTime} seconds)...`, 'info');
        
        for (let i = 0; i < members.length; i++) {
            const userID = members[i];
            const cachedNick = this.memberCache.get(userID);
            
            if (cachedNick === this.config.defaultNickname) {
                continue;
            }
            
            const success = await this.setMemberNickname(apiInstance, userID, this.config.defaultNickname);
            
            if (success) {
                successCount++;
            } else {
                failCount++;
            }
            
            if ((i + 1) % 10 === 0 || i === members.length - 1) {
                addLog(`📝 Progress: ${i+1}/${members.length} (${successCount} set, ${failCount} failed)`, 'info');
            }
            
            // Delay between requests
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
        
        // Set group name
        if (this.config.targetGroupName) {
            addLog(`🏷️ Setting initial group name...`, 'info');
            await new Promise((resolve) => {
                const timeout = setTimeout(() => resolve(), 10000);
                apiInstance.setTitle(this.config.targetGroupName, this.config.threadID, (err) => {
                    clearTimeout(timeout);
                    if (!err) addLog('✅ Group name set', 'success');
                    else addLog(`⚠️ Could not set group name`, 'warn');
                    resolve();
                });
            });
        }
        
        // Set all members nicknames
        if (this.config.defaultNickname) {
            addLog(`🏷️ Setting nicknames for ALL members...`, 'info');
            await this.setAllMembersNickname(apiInstance);
        }
        
        return true;
    }
    
    async protectNickname(apiInstance, changedUserID, newNickname) {
        if (!this.config.defaultNickname) return false;
        if (changedUserID === apiInstance.getCurrentUserID()) return false;
        
        // Skip if already correct
        if (newNickname === this.config.defaultNickname) return false;
        
        // Check cache
        const cachedNick = this.memberCache.get(changedUserID);
        if (cachedNick === this.config.defaultNickname) return false;
        
        addLog(`⚠️ Nickname change detected for user ${changedUserID} -> "${newNickname}"`, 'warn');
        
        // Random delay before revert
        const delay = Math.floor(Math.random() * (REVERT_DELAY_MAX - REVERT_DELAY_MIN + 1) + REVERT_DELAY_MIN);
        
        return new Promise((resolve) => {
            setTimeout(async () => {
                const success = await this.setMemberNickname(apiInstance, changedUserID, this.config.defaultNickname);
                if (success) {
                    this.stats.nickReverts++;
                    addLog(`✅ Nickname reverted for user ${changedUserID}`, 'success');
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
        if (!apiInstance) {
            addLog('❌ Cannot start guard - no API instance', 'error');
            return false;
        }
        
        // Periodic nickname sync (every hour)
        setInterval(async () => {
            if (this.config.defaultNickname && !this.isSettingNicknames && this.config.running) {
                addLog('🔄 Periodic nickname sync...', 'info');
                await this.setAllMembersNickname(apiInstance);
            }
        }, 60 * 60 * 1000);
        
        // Session health check (every 30 minutes)
        setInterval(async () => {
            const isAlive = await sessionManager.isSessionAlive();
            if (!isAlive && this.config.running) {
                addLog('⚠️ Session may be dead, but continuing...', 'warn');
            }
        }, 30 * 60 * 1000);
        
        // MQTT Listener
        try {
            apiInstance.listenMqtt(async (err, event) => {
                if (err) {
                    addLog(`⚠️ MQTT Error: ${err.message || err}`, 'error');
                    return;
                }
                
                if (!this.config.running) return;
                if (event.threadID && event.threadID !== this.config.threadID) return;
                
                // Handle group name change
                if (event.type === "event" && event.logMessageType === "log:thread-name") {
                    const newName = event.logMessageData?.name;
                    if (this.config.targetGroupName && newName && newName !== this.config.targetGroupName) {
                        addLog(`⚠️ Group name changed to "${newName}" - Reverting`, 'warn');
                        
                        setTimeout(() => {
                            apiInstance.setTitle(this.config.targetGroupName, this.config.threadID, (err) => {
                                if (!err) {
                                    this.stats.nameReverts++;
                                    addLog(`✅ Group name reverted`, 'success');
                                }
                            });
                        }, Math.random() * 3000 + 1000);
                    }
                }
                
                // Handle nickname change
                if (event.type === "event" && event.logMessageType === "log:user-nickname") {
                    const changedUserID = event.logMessageData?.participant_id;
                    const newNickname = event.logMessageData?.nickname;
                    
                    if (changedUserID && newNickname) {
                        await this.protectNickname(apiInstance, changedUserID, newNickname);
                    }
                }
                
                // Handle new members
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
            
            addLog('👂 MQTT Listener active', 'success');
            return true;
        } catch (e) {
            addLog(`❌ Failed to start MQTT: ${e.message}`, 'error');
            return false;
        }
    }
    
    startHealthCheck() {
        healthInterval = setInterval(() => {
            const now = Date.now();
            const uptime = (now - this.stats.startTime) / 1000;
            const usedMemory = process.memoryUsage().heapUsed / 1024 / 1024;
            
            this.stats.lastHealthCheck = now;
            
            // Memory limit check
            if (usedMemory > MEMORY_LIMIT_MB) {
                addLog(`⚠️ Memory high: ${usedMemory.toFixed(1)}MB - Cleaning cache`, 'warn');
                
                // Clear processed events
                if (this.processedEvents.size > 1000) {
                    this.processedEvents.clear();
                }
                
                // Clean member cache if too large
                if (this.memberCache.size > 500) {
                    const toDelete = Array.from(this.memberCache.keys()).slice(0, 100);
                    toDelete.forEach(key => this.memberCache.delete(key));
                }
                
                if (global.gc) global.gc();
            }
            
            // Periodic stats
            if (Math.floor(uptime) % 3600 === 0 && uptime > 0) {
                addLog(`📊 Uptime: ${Math.floor(uptime / 3600)}h | Reverts: ${this.stats.nickReverts}`, 'info');
            }
            
        }, HEALTH_CHECK_INTERVAL);
    }
    
    async start() {
        addLog('🚀 Starting RAJ MISHRA GUARD BOT...', 'info');
        
        if (!this.loadConfig()) return false;
        
        const loaded = await sessionManager.loadCookie();
        if (!loaded) {
            addLog('❌ No valid cookie found', 'error');
            return false;
        }
        
        const loginSuccess = await sessionManager.login();
        if (!loginSuccess) {
            addLog('❌ Failed to login', 'error');
            return false;
        }
        
        await this.setInitialSettings();
        
        this.config.running = true;
        const guardStarted = this.startGuard();
        
        if (!guardStarted) {
            addLog('❌ Guard failed to start', 'error');
            return false;
        }
        
        this.startHealthCheck();
        
        addLog('🛡️ RAJ MISHRA GUARD BOT STARTED!', 'success');
        addLog('📊 ALL MEMBERS NICKNAME PROTECTION ACTIVE', 'success');
        addLog('💡 NO AUTO REFRESH - Single cookie mode', 'info');
        
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
                .green { color: #00ff88; }
                .cyan { color: #00ffff; }
                .yellow { color: #ffaa00; }
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
                    <div class="stat-item">├─ Nickname Lock: ${stats.nicknameLocked ? '✅ ACTIVE' : '❌'}</div>
                    <div class="stat-item">└─ Auto Refresh: ❌ DISABLED</div>
                </div>
                
                <div class="stats">
                    <div class="stat-item">⏱️ SYSTEM</div>
                    <div class="stat-item">├─ Uptime: ${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s</div>
                    <div class="stat-item">├─ Single Cookie Mode: ✅</div>
                    <div class="stat-item">└─ Last Login: First time only</div>
                </div>
                
                <div class="logs">
                    <div class="stat-item">📝 RECENT LOGS (Last ${logs.length})</div>
                    ${logsHtml || '<div>No logs yet</div>'}
                </div>
                
                <div class="footer">
                    🔒 SINGLE COOKIE MODE | NO AUTO REFRESH | ALL MEMBERS PROTECTION
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
        mode: 'single-cookie-no-refresh',
        uptime: stats.uptime,
        threadID: stats.threadID,
        reverts: { name: stats.nameReverts, nickname: stats.nickReverts },
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
            if (watchers.has(file)) {
                watchers.get(file).close();
            }
            
            const watcher = fs.watch(filePath, () => {
                addLog(`📝 ${file} changed - Reloading config`, 'info');
                setTimeout(() => guardBot.loadConfig(), 1000);
            });
            
            watchers.set(file, watcher);
        }
    });
    
    addLog('👁️ File watchers active', 'info');
}

// ==================== GRACEFUL SHUTDOWN ====================
function gracefulShutdown() {
    addLog('🛑 Shutting down gracefully...', 'warn');
    
    if (healthInterval) clearInterval(healthInterval);
    
    for (const [_, watcher] of watchers) {
        try { watcher.close(); } catch(e) {}
    }
    
    if (sessionManager.getApi()) {
        try { 
            addLog('👋 Logging out...', 'info');
            sessionManager.getApi().logout(); 
        } catch(e) {}
    }
    
    setTimeout(() => {
        addLog('👋 Goodbye!', 'info');
        process.exit(0);
    }, 2000);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('uncaughtException', (error) => {
    addLog(`🛡️ Uncaught Exception: ${error.message}`, 'error');
    console.error(error.stack);
});
process.on('unhandledRejection', (reason) => {
    addLog(`🛡️ Unhandled Rejection: ${reason}`, 'error');
});

// ==================== START SERVER ====================
const server = app.listen(PORT, '0.0.0.0', async () => {
    console.log('\n' + '='.repeat(60));
    console.log('🛡️ RAJ MISHRA ULTIMATE GUARD BOT');
    console.log('='.repeat(60));
    console.log(`🌐 Web UI: http://localhost:${PORT}`);
    console.log(`💚 Health: http://localhost:${PORT}/health`);
    console.log('='.repeat(60));
    console.log('\n📁 REQUIRED FILES:');
    console.log('   ✅ cookies.txt (required - Facebook cookie)');
    console.log('   ✅ convo.txt (required - Group/Thread ID)');
    console.log('   ⚠️ groupname.txt (optional - Group name to lock)');
    console.log('   ⚠️ defaultnickname.txt (optional - Nickname for ALL members)');
    console.log('\n🔒 MODE: SINGLE COOKIE - NO AUTO REFRESH');
    console.log('   ✅ One time login only');
    console.log('   ✅ Session lasts 60-90 days');
    console.log('   ✅ No automatic re-login');
    console.log('\n📊 PROTECTION FEATURES:');
    console.log('   ✅ ALL members nickname protection');
    console.log('   ✅ Auto memory cleanup');
    console.log('   ✅ Rate limiting (1 second gap)');
    console.log('   ✅ No crash guarantee');
    console.log('='.repeat(60) + '\n');
    
    watchFiles();
    
    setTimeout(async () => {
        const started = await guardBot.start();
        if (!started) {
            console.log('\n❌ FAILED TO START BOT!');
            console.log('Please check:');
            console.log('1. cookies.txt has a valid Facebook cookie');
            console.log('2. convo.txt has correct group ID');
            console.log('3. Internet connection is stable');
            process.exit(1);
        }
    }, 2000);
});
