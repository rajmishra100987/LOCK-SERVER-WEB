// ==================== RAJ MISHRA ULTIMATE GUARD BOT ====================
// MQTT BASED | FILE BASED | PORT 4000
// ONLY SPECIFIC GROUP | LIMITED LOGS | NO SPAM

const fs = require('fs');
const path = require('path');
const express = require('express');
const api = require('fca-mafiya');
const WebSocket = require('ws');
const axios = require('axios');

// ==================== CONFIG ====================
const PORT = 4000;
const COOKIE_REFRESH_INTERVAL = 24 * 60 * 60 * 1000;
const REVERT_DELAY_MIN = 1000;
const REVERT_DELAY_MAX = 5000;
const MAX_LOGS = 20;  // Sirf 20 logs store honge

// ==================== DATA DIR ====================
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ==================== FILES NEEDED ====================
// cookies.txt - ek ya multiple cookies
// convo.txt - group/thread ID (SIRF YAHI GROUP LISTEN HOGA)
// groupname.txt - target group name
// nickname.txt - target nickname

// ==================== TASK DATA ====================
let taskConfig = null;
let activeApi = null;
let lastRefreshTime = Date.now();
let logs = [];  // Limited logs

// ==================== LOG FUNCTION (LIMITED) ====================
function addLog(message, type = 'info') {
    const time = new Date().toLocaleTimeString();
    const logEntry = { time, message, type };
    logs.unshift(logEntry);
    if (logs.length > MAX_LOGS) logs = logs.slice(0, MAX_LOGS);
    console.log(`[${time}] ${message}`);
}

// ==================== FILE READING ====================
function readCookies() {
    const cookiesPath = path.join(__dirname, 'cookies.txt');
    if (!fs.existsSync(cookiesPath)) {
        addLog('❌ cookies.txt not found', 'error');
        return null;
    }
    const content = fs.readFileSync(cookiesPath, 'utf8');
    const cookies = content.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('//') && line.includes('c_user'));
    
    if (cookies.length === 0) {
        addLog('❌ No valid cookies found', 'error');
        return null;
    }
    addLog(`📁 Found ${cookies.length} cookies`);
    return cookies;
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
    if (!fs.existsSync(groupPath)) {
        addLog('⚠️ groupname.txt not found - Group name lock disabled', 'warn');
        return null;
    }
    return fs.readFileSync(groupPath, 'utf8').trim();
}

function readNickName() {
    const nickPath = path.join(__dirname, 'nickname.txt');
    if (!fs.existsSync(nickPath)) {
        addLog('⚠️ nickname.txt not found - Nickname lock disabled', 'warn');
        return null;
    }
    return fs.readFileSync(nickPath, 'utf8').trim();
}

// ==================== COOKIE PARSER ====================
class CookieParser {
    static parse(raw) {
        if (!raw) return null;
        try {
            if (raw.trim().startsWith('[') || raw.trim().startsWith('{')) {
                const parsed = JSON.parse(raw);
                return Array.isArray(parsed) ? parsed : parsed;
            }
        } catch (e) {}
        
        if (raw.includes('=')) {
            return raw.split(';').map(pair => {
                const [key, value] = pair.split('=');
                if (key && value) {
                    return {
                        key: key.trim(),
                        value: value.trim(),
                        domain: "facebook.com",
                        path: "/",
                        hostOnly: false
                    };
                }
                return null;
            }).filter(c => c);
        }
        return null;
    }
}

// ==================== SESSION MANAGER ====================
class SessionManager {
    constructor() {
        this.cookies = [];
        this.currentIndex = 0;
        this.api = null;
    }

    async loadCookies() {
        this.cookies = readCookies();
        return this.cookies && this.cookies.length > 0;
    }

    async loginWithCookie(cookie) {
        return new Promise((resolve) => {
            const formattedCookie = CookieParser.parse(cookie);
            if (!formattedCookie) {
                resolve(null);
                return;
            }
            
            const timeout = setTimeout(() => {
                addLog('⏰ Login timeout', 'error');
                resolve(null);
            }, 30000);
            
            api.login(formattedCookie, { 
                logLevel: "silent", 
                forceLogin: true, 
                selfListen: true 
            }, (err, apiInstance) => {
                clearTimeout(timeout);
                if (err) {
                    addLog(`❌ Login failed: ${err.error || err}`, 'error');
                    resolve(null);
                } else {
                    addLog('✅ Login successful', 'success');
                    resolve(apiInstance);
                }
            });
        });
    }

    async createSession() {
        if (!this.cookies.length) return false;
        
        for (let i = 0; i < this.cookies.length; i++) {
            addLog(`🔄 Trying cookie ${i + 1}/${this.cookies.length}`, 'info');
            const apiInstance = await this.loginWithCookie(this.cookies[i]);
            if (apiInstance) {
                this.api = apiInstance;
                this.currentIndex = i;
                addLog(`✅ Session created with cookie ${i + 1}`, 'success');
                return true;
            }
        }
        return false;
    }

    async refreshSession() {
        addLog('🔄 24H Refresh: Creating new session...', 'info');
        const newIndex = (this.currentIndex + 1) % this.cookies.length;
        const newApi = await this.loginWithCookie(this.cookies[newIndex]);
        if (newApi) {
            if (this.api) {
                try { this.api.logout(); } catch(e) {}
            }
            this.api = newApi;
            this.currentIndex = newIndex;
            addLog(`✅ Session refreshed with cookie ${newIndex + 1}`, 'success');
            return true;
        }
        return false;
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
            targetNickname: null,
            running: false
        };
        this.stats = {
            nameReverts: 0,
            nickReverts: 0,
            startTime: Date.now()
        };
        this.processedEvents = new Set(); // Duplicate events se bachne ke liye
    }

    loadConfig() {
        this.config.threadID = readConvo();
        this.config.targetGroupName = readGroupName();
        this.config.targetNickname = readNickName();
        
        if (!this.config.threadID) {
            addLog('❌ convo.txt missing - Cannot start', 'error');
            return false;
        }
        
        addLog(`📋 Target Thread: ${this.config.threadID}`, 'info');
        if (this.config.targetGroupName) {
            addLog(`📋 Target Group Name: ${this.config.targetGroupName}`, 'info');
        }
        if (this.config.targetNickname) {
            addLog(`📋 Target Nickname: ${this.config.targetNickname}`, 'info');
        }
        
        return true;
    }

    async start() {
        if (!this.loadConfig()) return false;
        
        const loaded = await sessionManager.loadCookies();
        if (!loaded) {
            addLog('❌ No valid cookies found', 'error');
            return false;
        }
        
        const sessionCreated = await sessionManager.createSession();
        if (!sessionCreated) {
            addLog('❌ Failed to create session', 'error');
            return false;
        }
        
        this.config.running = true;
        this.startGuard();
        this.start24HRefresh();
        
        addLog('🛡️ RAJ MISHRA GUARD BOT STARTED!', 'success');
        addLog('👂 MQTT Listening for events (specific group only)...', 'info');
        return true;
    }

    startGuard() {
        const apiInstance = sessionManager.getApi();
        if (!apiInstance) return;
        
        // Initial group name set (agar hai to)
        if (this.config.targetGroupName) {
            apiInstance.setTitle(this.config.targetGroupName, this.config.threadID, (err) => {
                if (!err) addLog('✅ Initial group name set', 'success');
                else addLog('⚠️ Could not set initial group name', 'warn');
            });
        }
        
        // MQTT Listener - SIRF SPECIFIC GROUP KE EVENTS
        apiInstance.listenMqtt(async (err, event) => {
            if (err || !this.config.running) return;
            
            // 🔥 CHECK: SIRF TARGET THREAD ID KE EVENTS PROCESS HO
            if (event.threadID && event.threadID !== this.config.threadID) {
                // Different group - IGNORE (log bhi nahi karega)
                return;
            }
            
            // GROUP NAME CHANGE (Sirf target group ka)
            if (event.type === "event" && event.logMessageType === "log:thread-name") {
                const newName = event.logMessageData?.name;
                if (this.config.targetGroupName && newName && newName !== this.config.targetGroupName) {
                    addLog(`⚠️ Group name changed to: ${newName.substring(0, 30)}...`, 'warn');
                    this.safeRevert(() => {
                        apiInstance.setTitle(this.config.targetGroupName, this.config.threadID, (err) => {
                            if (!err) {
                                this.stats.nameReverts++;
                                addLog(`✅ Group name reverted (${this.stats.nameReverts})`, 'success');
                            }
                        });
                    });
                }
            }
            
            // NICKNAME CHANGE (Sirf target group ka)
            if (event.type === "event" && event.logMessageType === "log:user-nickname") {
                const changedUserID = event.logMessageData?.participant_id;
                const newNickname = event.logMessageData?.nickname;
                
                // Sirf tab process karo jab nickname lock ON hai
                if (this.config.targetNickname && newNickname && newNickname !== this.config.targetNickname) {
                    addLog(`⚠️ Nickname changed for user: ${changedUserID}`, 'warn');
                    this.safeRevert(() => {
                        apiInstance.changeNickname(this.config.targetNickname, this.config.threadID, changedUserID, (err) => {
                            if (!err) {
                                this.stats.nickReverts++;
                                addLog(`✅ Nickname reverted (${this.stats.nickReverts})`, 'success');
                            }
                        });
                    });
                }
            }
        });
        
        addLog('👂 MQTT Listener active (only target group)', 'info');
    }

    safeRevert(action) {
        const delay = Math.floor(Math.random() * (REVERT_DELAY_MAX - REVERT_DELAY_MIN + 1) + REVERT_DELAY_MIN);
        setTimeout(() => action(), delay);
    }

    start24HRefresh() {
        setInterval(async () => {
            addLog('🕐 24H REFRESH CYCLE', 'info');
            const refreshed = await sessionManager.refreshSession();
            if (refreshed) {
                addLog('✅ Session refreshed, restarting guard...', 'success');
                this.config.running = false;
                setTimeout(() => {
                    this.config.running = true;
                    this.startGuard();
                }, 3000);
            }
            lastRefreshTime = Date.now();
        }, COOKIE_REFRESH_INTERVAL);
        
        addLog('✅ 24H Refresh scheduler started', 'success');
    }

    getStats() {
        return {
            running: this.config.running,
            nameReverts: this.stats.nameReverts,
            nickReverts: this.stats.nickReverts,
            uptime: Math.floor((Date.now() - this.stats.startTime) / 1000),
            threadID: this.config.threadID,
            groupNameLocked: !!this.config.targetGroupName,
            nicknameLocked: !!this.config.targetNickname,
            logs: logs.slice(0, 10)
        };
    }
}

const guardBot = new GuardBot();

// ==================== WATCH FILES ====================
function watchFiles() {
    const files = ['cookies.txt', 'convo.txt', 'groupname.txt', 'nickname.txt'];
    files.forEach(file => {
        const filePath = path.join(__dirname, file);
        if (fs.existsSync(filePath)) {
            fs.watch(filePath, () => {
                addLog(`📝 ${file} changed! Reloading...`, 'info');
                setTimeout(() => reloadConfig(), 2000);
            });
        }
    });
    addLog('👁️ Watching for file changes...', 'info');
}

async function reloadConfig() {
    addLog('🔄 Reloading configuration...', 'info');
    const loaded = guardBot.loadConfig();
    if (loaded && guardBot.config.running) {
        addLog('✅ Configuration reloaded', 'success');
    }
}

// ==================== EXPRESS SERVER ====================
const app = express();

app.get('/', (req, res) => {
    const stats = guardBot.getStats();
    const uptimeHours = Math.floor(stats.uptime / 3600);
    const uptimeMinutes = Math.floor((stats.uptime % 3600) / 60);
    const uptimeSeconds = stats.uptime % 60;
    
    let logsHtml = '';
    for (const log of logs.slice(0, 10)) {
        const color = log.type === 'error' ? '#ff4444' : (log.type === 'success' ? '#00ff88' : '#00ffff');
        logsHtml += `<div style="color: ${color};">[${log.time}] ${log.message}</div>`;
    }
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>RAJ MISHRA GUARD BOT</title>
            <meta http-equiv="refresh" content="10">
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
                    background: rgba(0,0,0,0.7);
                    border-radius: 20px;
                    padding: 20px;
                    border: 1px solid #00ff88;
                }
                h1 { color: #00ff88; text-shadow: 0 0 10px #00ff88; }
                .status { font-size: 24px; margin: 20px 0; }
                .online { color: #00ff88; animation: pulse 1s infinite; }
                @keyframes pulse {
                    0% { opacity: 1; }
                    50% { opacity: 0.5; }
                    100% { opacity: 1; }
                }
                .stats, .logs {
                    text-align: left;
                    background: #000;
                    padding: 15px;
                    border-radius: 10px;
                    margin: 15px 0;
                }
                .stat-item { margin: 8px 0; font-family: monospace; }
                .green { color: #00ff88; }
                .cyan { color: #00ffff; }
                .logs { max-height: 200px; overflow-y: auto; font-size: 11px; }
                .footer { margin-top: 20px; font-size: 12px; color: #666; }
                .guard-badge {
                    border: 1px solid #ff00ff;
                    background: rgba(255,0,255,0.1);
                    padding: 10px;
                    border-radius: 10px;
                    margin: 15px 0;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🛡️ RAJ MISHRA</h1>
                <h2>ULTIMATE GUARD BOT</h2>
                
                <div class="status">
                    ${stats.running ? '<span class="online">● ONLINE</span>' : '<span style="color:#ff0000">● OFFLINE</span>'}
                </div>
                
                <div class="guard-badge">
                    <span class="cyan">🔒 SPECIFIC GROUP ONLY 🔒</span>
                </div>
                
                <div class="stats">
                    <div class="stat-item">📊 STATISTICS</div>
                    <div class="stat-item">├─ Group Name Reverts: ${stats.nameReverts}</div>
                    <div class="stat-item">└─ Nickname Reverts: ${stats.nickReverts}</div>
                </div>
                
                <div class="stats">
                    <div class="stat-item">⚙️ CONFIGURATION</div>
                    <div class="stat-item">├─ Target Thread: ${stats.threadID}</div>
                    <div class="stat-item">├─ Group Name Lock: ${stats.groupNameLocked ? '✅' : '❌'}</div>
                    <div class="stat-item">└─ Nickname Lock: ${stats.nicknameLocked ? '✅' : '❌'}</div>
                </div>
                
                <div class="stats">
                    <div class="stat-item">⏱️ SYSTEM</div>
                    <div class="stat-item">├─ Uptime: ${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s</div>
                    <div class="stat-item">├─ 24H Refresh: ✅ Active</div>
                    <div class="stat-item">└─ Logs Limit: ${MAX_LOGS}</div>
                </div>
                
                <div class="logs">
                    <div class="stat-item">📝 RECENT LOGS</div>
                    ${logsHtml || '<div>No logs yet</div>'}
                </div>
                
                <div class="footer">
                    RAJ MISHRA GUARD BOT | MQTT | ONLY SPECIFIC GROUP
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
        uptime: stats.uptime,
        threadID: stats.threadID,
        reverts: { name: stats.nameReverts, nickname: stats.nickReverts }
    });
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
    console.log('   ✅ cookies.txt (required)');
    console.log('   ✅ convo.txt (required)');
    console.log('   ⚠️ groupname.txt (optional)');
    console.log('   ⚠️ nickname.txt (optional)');
    console.log('\n🔒 FEATURES:');
    console.log('   ✅ Only specific group events');
    console.log('   ✅ Limited logs (memory safe)');
    console.log('   ✅ Nickname revert only when changed');
    console.log('   ✅ No initial nickname set');
    console.log('='.repeat(60) + '\n');
    
    watchFiles();
    
    setTimeout(async () => {
        await guardBot.start();
    }, 2000);
});

process.on('uncaughtException', (error) => {
    console.log('🛡️ Exception:', error.message);
});

process.on('unhandledRejection', (reason) => {
    console.log('🛡️ Rejection:', reason);
});
