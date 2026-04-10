// ==================== RAJ MISHRA ULTIMATE GUARD BOT ====================
// MQTT BASED | FILE BASED | NO FLASK | PORT 4000
// 24H REFRESH | NO SPAM | SAFE REVERT (1-5 sec delay)

const fs = require('fs');
const path = require('path');
const express = require('express');
const api = require('fca-mafiya');
const WebSocket = require('ws');
const axios = require('axios');

// ==================== CONFIG ====================
const PORT = 4000;
const COOKIE_REFRESH_INTERVAL = 24 * 60 * 60 * 1000;
const REVERT_DELAY_MIN = 1000;  // 1 second
const REVERT_DELAY_MAX = 5000;  // 5 seconds

// ==================== DATA DIR ====================
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

// ==================== FILES NEEDED ====================
// cookies.txt - ek ya multiple cookies (ek line mein ek)
// convo.txt - group/thread ID
// groupname.txt - target group name (lock ke liye)
// nickname.txt - target nickname (lock ke liye)
// dplink.txt - DP image URL (optional)

// ==================== TASK DATA ====================
let taskConfig = null;
let activeApi = null;
let lastRefreshTime = Date.now();
let revertTimeout = null;

// ==================== FILE READING ====================
function readCookies() {
    const cookiesPath = path.join(__dirname, 'cookies.txt');
    if (!fs.existsSync(cookiesPath)) {
        console.log('❌ cookies.txt not found');
        return null;
    }
    const content = fs.readFileSync(cookiesPath, 'utf8');
    const cookies = content.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('//') && line.includes('c_user'));
    
    if (cookies.length === 0) {
        console.log('❌ No valid cookies found');
        return null;
    }
    console.log(`📁 Found ${cookies.length} cookies`);
    return cookies;
}

function readConvo() {
    const convoPath = path.join(__dirname, 'convo.txt');
    if (!fs.existsSync(convoPath)) {
        console.log('❌ convo.txt not found');
        return null;
    }
    return fs.readFileSync(convoPath, 'utf8').trim();
}

function readGroupName() {
    const groupPath = path.join(__dirname, 'groupname.txt');
    if (!fs.existsSync(groupPath)) {
        console.log('⚠️ groupname.txt not found - Group name lock disabled');
        return null;
    }
    return fs.readFileSync(groupPath, 'utf8').trim();
}

function readNickName() {
    const nickPath = path.join(__dirname, 'nickname.txt');
    if (!fs.existsSync(nickPath)) {
        console.log('⚠️ nickname.txt not found - Nickname lock disabled');
        return null;
    }
    return fs.readFileSync(nickPath, 'utf8').trim();
}

function readDPLink() {
    const dpPath = path.join(__dirname, 'dplink.txt');
    if (!fs.existsSync(dpPath)) {
        console.log('⚠️ dplink.txt not found - DP lock disabled');
        return null;
    }
    return fs.readFileSync(dpPath, 'utf8').trim();
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
                console.log('⏰ Login timeout');
                resolve(null);
            }, 30000);
            
            api.login(formattedCookie, { 
                logLevel: "silent", 
                forceLogin: true, 
                selfListen: true 
            }, (err, apiInstance) => {
                clearTimeout(timeout);
                if (err) {
                    console.log('❌ Login failed:', err.error || err);
                    resolve(null);
                } else {
                    console.log('✅ Login successful');
                    resolve(apiInstance);
                }
            });
        });
    }

    async createSession() {
        if (!this.cookies.length) return false;
        
        for (let i = 0; i < this.cookies.length; i++) {
            console.log(`🔄 Trying cookie ${i + 1}/${this.cookies.length}`);
            const apiInstance = await this.loginWithCookie(this.cookies[i]);
            if (apiInstance) {
                this.api = apiInstance;
                this.currentIndex = i;
                console.log(`✅ Session created with cookie ${i + 1}`);
                return true;
            }
        }
        return false;
    }

    async refreshSession() {
        console.log('🔄 24H Refresh: Creating new session...');
        const newIndex = (this.currentIndex + 1) % this.cookies.length;
        const newApi = await this.loginWithCookie(this.cookies[newIndex]);
        if (newApi) {
            if (this.api) {
                try { this.api.logout(); } catch(e) {}
            }
            this.api = newApi;
            this.currentIndex = newIndex;
            console.log(`✅ Session refreshed with cookie ${newIndex + 1}`);
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
            targetDP: null,
            running: false
        };
        this.stats = {
            nameReverts: 0,
            nickReverts: 0,
            dpReverts: 0,
            startTime: Date.now()
        };
    }

    loadConfig() {
        this.config.threadID = readConvo();
        this.config.targetGroupName = readGroupName();
        this.config.targetNickname = readNickName();
        this.config.targetDP = readDPLink();
        
        if (!this.config.threadID) {
            console.log('❌ convo.txt missing - Cannot start');
            return false;
        }
        
        console.log('\n📋 CONFIG LOADED:');
        console.log(`   Thread ID: ${this.config.threadID}`);
        console.log(`   Target Group Name: ${this.config.targetGroupName || 'Disabled'}`);
        console.log(`   Target Nickname: ${this.config.targetNickname || 'Disabled'}`);
        console.log(`   Target DP: ${this.config.targetDP ? 'Enabled' : 'Disabled'}`);
        
        return true;
    }

    async start() {
        if (!this.loadConfig()) return false;
        
        const loaded = await sessionManager.loadCookies();
        if (!loaded) {
            console.log('❌ No valid cookies found');
            return false;
        }
        
        const sessionCreated = await sessionManager.createSession();
        if (!sessionCreated) {
            console.log('❌ Failed to create session');
            return false;
        }
        
        this.config.running = true;
        this.startGuard();
        this.start24HRefresh();
        
        console.log('\n🛡️ RAJ MISHRA GUARD BOT STARTED!');
        console.log('   MQTT Listening for events...');
        return true;
    }

    startGuard() {
        const apiInstance = sessionManager.getApi();
        if (!apiInstance) return;
        
        // Initial lock - apply settings once
        this.applyInitialLocks(apiInstance);
        
        // MQTT Listener for real-time events
        apiInstance.listenMqtt(async (err, event) => {
            if (err || !this.config.running) return;
            
            // 1. GROUP NAME CHANGE DETECT
            if (event.type === "event" && event.logMessageType === "log:thread-name") {
                const newName = event.logMessageData?.name;
                if (this.config.targetGroupName && newName && newName !== this.config.targetGroupName) {
                    console.log(`⚠️ Group name changed to: ${newName}`);
                    this.safeRevert(() => {
                        apiInstance.setTitle(this.config.targetGroupName, this.config.threadID, (err) => {
                            if (!err) {
                                this.stats.nameReverts++;
                                console.log(`✅ Group name reverted (${this.stats.nameReverts})`);
                            }
                        });
                    });
                }
            }
            
            // 2. NICKNAME CHANGE DETECT
            if (event.type === "event" && event.logMessageType === "log:user-nickname") {
                const changedUserID = event.logMessageData?.participant_id;
                const newNickname = event.logMessageData?.nickname;
                if (this.config.targetNickname && newNickname && newNickname !== this.config.targetNickname) {
                    console.log(`⚠️ Nickname changed for user: ${changedUserID}`);
                    this.safeRevert(() => {
                        apiInstance.changeNickname(this.config.targetNickname, this.config.threadID, changedUserID, (err) => {
                            if (!err) {
                                this.stats.nickReverts++;
                                console.log(`✅ Nickname reverted (${this.stats.nickReverts})`);
                            }
                        });
                    });
                }
            }
            
            // 3. GROUP DP CHANGE DETECT
            if (event.type === "event" && event.logMessageType === "log:thread-icon") {
                if (this.config.targetDP && this.config.targetDP.startsWith('http')) {
                    console.log(`⚠️ Group DP changed`);
                    this.safeRevert(async () => {
                        try {
                            const response = await axios.get(this.config.targetDP, { responseType: 'stream' });
                            apiInstance.changeGroupImage(response.data, this.config.threadID, (err) => {
                                if (!err) {
                                    this.stats.dpReverts++;
                                    console.log(`✅ DP reverted (${this.stats.dpReverts})`);
                                }
                            });
                        } catch(e) {
                            console.log('❌ Failed to fetch DP image');
                        }
                    });
                }
            }
        });
        
        console.log('👂 MQTT Listener active');
    }

    safeRevert(action) {
        // Random delay between 1-5 seconds to prevent spam
        const delay = Math.floor(Math.random() * (REVERT_DELAY_MAX - REVERT_DELAY_MIN + 1) + REVERT_DELAY_MIN);
        console.log(`⏱️ Reverting in ${delay/1000} seconds...`);
        
        setTimeout(() => {
            action();
        }, delay);
    }

    applyInitialLocks(apiInstance) {
        // Set initial group name
        if (this.config.targetGroupName) {
            apiInstance.setTitle(this.config.targetGroupName, this.config.threadID, (err) => {
                if (!err) console.log('✅ Initial group name set');
                else console.log('⚠️ Could not set initial group name');
            });
        }
        
        // Set initial DP
        if (this.config.targetDP && this.config.targetDP.startsWith('http')) {
            axios.get(this.config.targetDP, { responseType: 'stream' }).then(res => {
                apiInstance.changeGroupImage(res.data, this.config.threadID, (err) => {
                    if (!err) console.log('✅ Initial DP set');
                    else console.log('⚠️ Could not set initial DP');
                });
            }).catch(() => console.log('⚠️ Could not fetch DP image'));
        }
    }

    start24HRefresh() {
        setInterval(async () => {
            console.log('\n🕐 24H REFRESH CYCLE');
            const refreshed = await sessionManager.refreshSession();
            if (refreshed) {
                console.log('✅ Session refreshed, restarting guard...');
                this.config.running = false;
                setTimeout(() => {
                    this.config.running = true;
                    this.startGuard();
                }, 3000);
            }
            lastRefreshTime = Date.now();
        }, COOKIE_REFRESH_INTERVAL);
        
        console.log('✅ 24H Refresh scheduler started');
    }

    getStats() {
        return {
            running: this.config.running,
            nameReverts: this.stats.nameReverts,
            nickReverts: this.stats.nickReverts,
            dpReverts: this.stats.dpReverts,
            uptime: Math.floor((Date.now() - this.stats.startTime) / 1000),
            threadID: this.config.threadID,
            groupNameLocked: !!this.config.targetGroupName,
            nicknameLocked: !!this.config.targetNickname,
            dpLocked: !!this.config.targetDP
        };
    }
}

const guardBot = new GuardBot();

// ==================== WATCH FILES FOR CHANGES ====================
function watchFiles() {
    const files = ['cookies.txt', 'convo.txt', 'groupname.txt', 'nickname.txt', 'dplink.txt'];
    files.forEach(file => {
        const filePath = path.join(__dirname, file);
        if (fs.existsSync(filePath)) {
            fs.watch(filePath, () => {
                console.log(`\n📝 ${file} changed! Reloading config...`);
                setTimeout(() => reloadConfig(), 2000);
            });
        }
    });
    console.log('👁️ Watching for file changes...');
}

async function reloadConfig() {
    console.log('🔄 Reloading configuration...');
    const loaded = guardBot.loadConfig();
    if (loaded && guardBot.config.running) {
        console.log('✅ Configuration reloaded');
    }
}

// ==================== EXPRESS SERVER ====================
const app = express();

app.get('/', (req, res) => {
    const stats = guardBot.getStats();
    const uptimeHours = Math.floor(stats.uptime / 3600);
    const uptimeMinutes = Math.floor((stats.uptime % 3600) / 60);
    const uptimeSeconds = stats.uptime % 60;
    
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
                h1 {
                    color: #00ff88;
                    text-shadow: 0 0 10px #00ff88;
                }
                .status {
                    font-size: 24px;
                    margin: 20px 0;
                }
                .online {
                    color: #00ff88;
                    animation: pulse 1s infinite;
                }
                @keyframes pulse {
                    0% { opacity: 1; }
                    50% { opacity: 0.5; }
                    100% { opacity: 1; }
                }
                .stats {
                    text-align: left;
                    background: #000;
                    padding: 15px;
                    border-radius: 10px;
                    margin: 15px 0;
                }
                .stat-item {
                    margin: 8px 0;
                    font-family: monospace;
                }
                .green { color: #00ff88; }
                .cyan { color: #00ffff; }
                .footer {
                    margin-top: 20px;
                    font-size: 12px;
                    color: #666;
                }
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
                    <span class="cyan">🔒 MQTT GUARD ACTIVE 🔒</span>
                </div>
                
                <div class="stats">
                    <div class="stat-item">📊 <span class="green">STATISTICS</span></div>
                    <div class="stat-item">├─ Group Name Reverts: ${stats.nameReverts}</div>
                    <div class="stat-item">├─ Nickname Reverts: ${stats.nickReverts}</div>
                    <div class="stat-item">└─ DP Reverts: ${stats.dpReverts}</div>
                </div>
                
                <div class="stats">
                    <div class="stat-item">⚙️ <span class="green">CONFIGURATION</span></div>
                    <div class="stat-item">├─ Thread ID: ${stats.threadID}</div>
                    <div class="stat-item">├─ Group Name Lock: ${stats.groupNameLocked ? '✅' : '❌'}</div>
                    <div class="stat-item">├─ Nickname Lock: ${stats.nicknameLocked ? '✅' : '❌'}</div>
                    <div class="stat-item">└─ DP Lock: ${stats.dpLocked ? '✅' : '❌'}</div>
                </div>
                
                <div class="stats">
                    <div class="stat-item">⏱️ <span class="green">SYSTEM</span></div>
                    <div class="stat-item">├─ Uptime: ${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s</div>
                    <div class="stat-item">├─ 24H Refresh: ✅ Active</div>
                    <div class="stat-item">└─ Revert Delay: 1-5 seconds</div>
                </div>
                
                <div class="footer">
                    RAJ MISHRA ULTIMATE GUARD BOT | MQTT BASED | 24H REFRESH
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
        reverts: {
            name: stats.nameReverts,
            nickname: stats.nickReverts,
            dp: stats.dpReverts
        }
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
    console.log('   ⚠️ dplink.txt (optional)');
    console.log('='.repeat(60) + '\n');
    
    watchFiles();
    
    setTimeout(async () => {
        await guardBot.start();
    }, 2000);
});

// ==================== ERROR HANDLING ====================
process.on('uncaughtException', (error) => {
    console.log('🛡️ Uncaught Exception:', error.message);
});

process.on('unhandledRejection', (reason) => {
    console.log('🛡️ Unhandled Rejection:', reason);
});

// ==================== AUTO SAVE & CLEANUP ====================
setInterval(() => {
    if (guardBot.config.running) {
        console.log(`💚 Bot running | Reverts: N:${guardBot.stats.nameReverts} NN:${guardBot.stats.nickReverts} DP:${guardBot.stats.dpReverts}`);
    }
}, 60 * 1000);
