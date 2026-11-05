let p1SelectedColor = localStorage.getItem('savedP1Color') || "#00d2ff";
let gameRunning = false; // The game starts "paused" at the menu
let time = 0;
const scene = new THREE.Scene();
let p1 = createCar("blue", "lightblue");
const defaultPlayerCar = p1;
let copLightState = 0; // 0 = all off, 1 = red on, 2 = blue on
let lastCopFlashTime = 0;
const flashInterval = 150; // Milliseconds between flashes (smaller is faster)

camera1 = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.1, 2000);
camera2 = new THREE.PerspectiveCamera(90, (window.innerWidth / 2) / window.innerHeight, 0.1, 2000);
let p1Juice = { zoom: 0, shake: 0, lean: 0 };
let p2Juice = { zoom: 0, shake: 0, lean: 0 };
let p2JumpsLeft = 2; // Add this near let jumpsLeft = 2;
let p2RotVel = 0;    // Add this near let p1RotVel = 0;

let cameraState = "FOLLOW"; // Modes: "FOLLOW", "CELEBRATE"
let goalFocusPoint = new THREE.Vector3();

const renderer = new THREE.WebGLRenderer({ antialias: true });

renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

let currentMode = 'practice';
let onlineSocket = null;
let onlineRole = null;
let onlineRoomPlayerLimit = 2;
let onlineStateTimer = 0;
let onlineGameStarted = false;
let onlineRoomCode = null;
let onlinePlayerNames = { p1: null, p2: null, p3: null, p4: null };
let onlineBallTarget = null;
let onlineCars = null;
const ONLINE_STATE_INTERVAL = 1000 / 60;
let onlinePendingHitId = null;
let onlineHitSequence = 0;
let onlineLastAcknowledgedHitIds = {};
let onlineAcknowledgedHitIds = {};
let onlineGoalEvent = null;
let onlineGoalSequence = 0;
let onlineLastGoalSequence = 0;
let onlineResetSequence = 0;
let onlineLastResetSequence = 0;
let onlineMatchSettings = null;
let onlineMatchEndsAt = 0;
let onlineMatchRemainingSeconds = 0;
let onlineMatchEnded = false;
let onlineEndRequestPending = false;
let onlineWinnerRewarded = false;
let onlineRankedWinRecorded = false;
let onlineRankedQueueActive = false;
let onlineExpectedClose = false;
const LEADERBOARD_SUPABASE_URL = 'https://myidxrqdedounumsclwz.supabase.co';
const LEADERBOARD_SUPABASE_ANON_KEY = 'sb_publishable_QWAcfCivd2NrKmyGp189qw_xNujc9aW';
const ONLINE_SERVER_URL = 'wss://corball-v2-online.onrender.com';
const RANK_DIVISIONS = [
    { name: 'Bronze I', tier: 'Bronze', numeral: 'I' },
    { name: 'Bronze II', tier: 'Bronze', numeral: 'II' },
    { name: 'Bronze III', tier: 'Bronze', numeral: 'III' },
    { name: 'Silver I', tier: 'Silver', numeral: 'I' },
    { name: 'Silver II', tier: 'Silver', numeral: 'II' },
    { name: 'Silver III', tier: 'Silver', numeral: 'III' },
    { name: 'Gold I', tier: 'Gold', numeral: 'I' },
    { name: 'Gold II', tier: 'Gold', numeral: 'II' },
    { name: 'Gold III', tier: 'Gold', numeral: 'III' },
    { name: 'Diamond I', tier: 'Diamond', numeral: 'I' },
    { name: 'Diamond II', tier: 'Diamond', numeral: 'II' },
    { name: 'Diamond III', tier: 'Diamond', numeral: 'III' },
    { name: 'Real I', tier: 'Real', numeral: 'I' },
    { name: 'Real II', tier: 'Real', numeral: 'II' },
    { name: 'Real III', tier: 'Real', numeral: 'III' }
];
const RANK_COLORS = {
    Bronze: '#b8733e',
    Silver: '#aab8c3',
    Gold: '#e2b63f',
    Diamond: '#43c4dc',
    Real: '#13c100'
};
const MAX_RANK_POINTS = RANK_DIVISIONS.length * 100 - 1;
let leaderboardMetric = 'goals';
let leaderboardSyncTimer;

function getLeaderboardPlayerId() {
    let playerId = localStorage.getItem('leaderboardPlayerId');
    if (!playerId) {
        playerId = typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `player-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem('leaderboardPlayerId', playerId);
    }
    return playerId;
}

function getLeaderboardPlayerName() {
    return localStorage.getItem('leaderboardPlayerName') || `Player ${getLeaderboardPlayerId().slice(0, 4)}`;
}

function getRankedWins() {
    const rankedWins = Number.parseInt(localStorage.getItem('rankedWins'), 10);
    return Number.isSafeInteger(rankedWins) && rankedWins > 0 ? rankedWins : 0;
}

function getRankPoints() {
    const rankPoints = Number.parseInt(localStorage.getItem('rankPoints'), 10);
    return Number.isSafeInteger(rankPoints) ? Math.max(0, Math.min(MAX_RANK_POINTS, rankPoints)) : 0;
}

function getRankInfo(rankPoints = getRankPoints()) {
    const tierIndex = Math.min(RANK_DIVISIONS.length - 1, Math.floor(rankPoints / 100));
    return {
        ...RANK_DIVISIONS[tierIndex],
        tierIndex,
        progress: rankPoints - tierIndex * 100,
        points: rankPoints
    };
}

const RANK_REWARDS = [
    'cone_bronze', 'viking_bronze',
    'cone_silver', 'tophat_silver', 'neon_silver',
    'cone_gold', 'coins', 'propeller_gold',
    'tophat_diamond', 'potato_diamond', 'exp_diamond',
    'tophat_real', 'real', 'exp_real'
];

// Reward for reaching rank index i (i >= 1) is RANK_REWARDS[i - 1]; unlocks are permanent.
function grantRankRewards(tierIndex = getRankInfo().tierIndex) {
    const newlyUnlocked = [];
    for (let i = 1; i <= tierIndex && i - 1 < RANK_REWARDS.length; i++) {
        const key = `secret_unlocked_${RANK_REWARDS[i - 1]}`;
        if (localStorage.getItem(key) !== 'true') {
            localStorage.setItem(key, 'true');
            newlyUnlocked.push(RANK_REWARDS[i - 1]);
        }
    }
    return newlyUnlocked;
}

function refreshRankUI() {
    grantRankRewards();
    refreshWheelUI();
    const panel = document.getElementById('rank-panel');
    if (!panel) return;
    const rank = getRankInfo();
    const color = RANK_COLORS[rank.tier];
    panel.style.setProperty('--rank-color', color);
    panel.setAttribute('aria-label', `Current rank: ${rank.name}`);
    document.getElementById('rank-emblem').setAttribute('aria-label', `${rank.name} shield`);
    document.getElementById('rank-emblem-mark').textContent = rank.numeral;
    document.getElementById('rank-name').textContent = rank.name;
    document.getElementById('rank-progress-fill').style.width = `${rank.progress}%`;
    document.getElementById('rank-progress-label').textContent = rank.tierIndex === RANK_DIVISIONS.length - 1
        ? 'MAX RANK'
        : `${rank.progress}% to next rank`;
}

function applyRankedResult(didWin, opponentRankTier) {
    const rankBefore = getRankInfo();
    const playerTier = Number.isInteger(onlineMatchSettings?.playerRankTier)
        ? onlineMatchSettings.playerRankTier
        : rankBefore.tierIndex;
    const opponentTier = Number.isInteger(opponentRankTier)
        ? Math.max(0, Math.min(RANK_DIVISIONS.length - 1, opponentRankTier))
        : playerTier;
    const tierGap = didWin
        ? Math.max(0, opponentTier - playerTier)
        : Math.max(0, playerTier - opponentTier);
    const rankChange = didWin ? 25 + tierGap * 7 : -(5 + tierGap * 2);
    const newRankPoints = Math.max(0, Math.min(MAX_RANK_POINTS, rankBefore.points + rankChange));
    localStorage.setItem('rankPoints', newRankPoints);
    scheduleLeaderboardSync();
    refreshRankUI();

    const rankAfter = getRankInfo(newRankPoints);
    if (!Number.isSafeInteger(Number.parseInt(localStorage.getItem('highestRankDropTier'), 10))) {
        localStorage.setItem('highestRankDropTier', rankBefore.tierIndex);
    }
    const rareDrops = checkRankDrops(rankAfter.tierIndex);
    const unlockedItems = grantRankRewards(rankAfter.tierIndex)
        .map(id => ALL_ITEMS.find(item => item.id === id)?.name || id);
    const changeLabel = rankAfter.tierIndex > rankBefore.tierIndex
        ? `RANK UP: ${rankAfter.name}${unlockedItems.length ? ` | Unlocked: ${unlockedItems.join(', ')}` : ''}${rareDrops ? ` | +${rareDrops} Rare Drop` : ''}`
        : rankAfter.tierIndex < rankBefore.tierIndex
            ? `RANK DOWN: ${rankAfter.name}`
            : `${didWin ? '+' : ''}${rankChange} points | ${rankAfter.name} (${rankAfter.progress}%)`;
    return `${changeLabel} (${didWin ? '+' : ''}${rankChange})`;
}

async function loadRankedWins() {
    const playerId = getLeaderboardPlayerId();
    const params = new URLSearchParams({
        select: 'ranked_wins',
        player_id: `eq.${playerId}`,
        limit: '1'
    });

    try {
        const response = await fetch(`${LEADERBOARD_SUPABASE_URL}/rest/v1/corball_leaderboard?${params}`, {
            headers: {
                apikey: LEADERBOARD_SUPABASE_ANON_KEY,
                Authorization: `Bearer ${LEADERBOARD_SUPABASE_ANON_KEY}`
            }
        });
        if (response.ok) {
            const entries = await response.json();
            if (entries.length && Number.isSafeInteger(entries[0].ranked_wins)) {
                localStorage.setItem('rankedWins', entries[0].ranked_wins);
                if (Number.isSafeInteger(entries[0].rank_points)) {
                    localStorage.setItem('rankPoints', entries[0].rank_points);
                }
                refreshRankUI();
                return entries[0].ranked_wins;
            }
        }
    } catch (error) {
        // Keep the locally saved count available if the leaderboard is offline.
    }
    return getRankedWins();
}

function setLeaderboardStatus(message) {
    const status = document.getElementById('leaderboard-status');
    if (status) status.textContent = message;
}

function setLeaderboardMetric(metric) {
    leaderboardMetric = ['goals', 'level', 'ranked'].includes(metric) ? metric : 'goals';
    document.querySelectorAll('.leaderboard-tab').forEach((tab) => {
        const isActive = tab.dataset.metric === leaderboardMetric;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', String(isActive));
    });
    loadLeaderboard();
}

function renderLeaderboard(entries) {
    const list = document.getElementById('leaderboard-list');
    if (!list) return;
    list.replaceChildren();

    entries.forEach((entry, index) => {
        const row = document.createElement('li');
        row.className = 'leaderboard-entry';

        const rank = document.createElement('span');
        rank.className = 'leaderboard-rank';
        rank.textContent = `${index + 1}.`;

        const name = document.createElement('span');
        name.className = 'leaderboard-player';
        name.textContent = entry.display_name;

        const value = document.createElement('span');
        value.className = 'leaderboard-value';
        value.textContent = leaderboardMetric === 'goals'
            ? `${entry.total_goals} goals`
            : leaderboardMetric === 'ranked'
                ? `${entry.ranked_wins} wins`
                : `Lv. ${entry.battle_pass_level}`;

        row.append(rank, name, value);
        list.appendChild(row);
    });
}

async function loadLeaderboard() {
    if (!LEADERBOARD_SUPABASE_URL || !LEADERBOARD_SUPABASE_ANON_KEY) {
        setLeaderboardStatus('Global rankings need a Supabase project. See README setup.');
        return;
    }

    setLeaderboardStatus('Loading rankings...');
    const orderBy = leaderboardMetric === 'goals'
        ? 'total_goals'
        : leaderboardMetric === 'ranked' ? 'ranked_wins' : 'battle_pass_level';
    const params = new URLSearchParams({
        select: 'display_name,total_goals,battle_pass_level,ranked_wins',
        order: `${orderBy}.desc`,
        limit: '10'
    });

    try {
        const response = await fetch(`${LEADERBOARD_SUPABASE_URL}/rest/v1/corball_leaderboard?${params}`, {
            headers: {
                apikey: LEADERBOARD_SUPABASE_ANON_KEY,
                Authorization: `Bearer ${LEADERBOARD_SUPABASE_ANON_KEY}`
            }
        });
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        const entries = await response.json();
        renderLeaderboard(entries);
        setLeaderboardStatus(entries.length ? 'Top 10 players' : 'No scores yet. Be the first on the board.');
    } catch (error) {
        setLeaderboardStatus('Could not load rankings. Check the connection and Supabase setup.');
    }
}

function saveLeaderboardName() {
    const input = document.getElementById('leaderboard-name');
    const playerName = input.value.trim().slice(0, 20);
    if (!playerName) {
        setLeaderboardStatus('Enter a player name first.');
        return;
    }
    localStorage.setItem('leaderboardPlayerName', playerName);
    scheduleLeaderboardSync();
    setLeaderboardStatus('Name saved on this device.');
}

function scheduleLeaderboardSync() {
    if (!LEADERBOARD_SUPABASE_URL || !LEADERBOARD_SUPABASE_ANON_KEY) return;
    clearTimeout(leaderboardSyncTimer);
    leaderboardSyncTimer = setTimeout(syncLeaderboardStats, 1000);
}

async function syncLeaderboardStats() {
    const playerId = getLeaderboardPlayerId();
    const payload = {
        player_id: playerId,
        display_name: getLeaderboardPlayerName(),
        total_goals: Math.max(0, parseInt(localStorage.getItem('totalGoals')) || 0),
        battle_pass_level: Math.max(1, parseInt(localStorage.getItem('playerLevel')) || 1),
        ranked_wins: getRankedWins(),
        rank_points: getRankPoints(),
        updated_at: new Date().toISOString()
    };

    try {
        const response = await fetch(`${LEADERBOARD_SUPABASE_URL}/rest/v1/corball_leaderboard?on_conflict=player_id`, {
            method: 'POST',
            headers: {
                apikey: LEADERBOARD_SUPABASE_ANON_KEY,
                Authorization: `Bearer ${LEADERBOARD_SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
                Prefer: 'resolution=merge-duplicates,return=minimal'
            },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        loadLeaderboard();
    } catch (error) {
        setLeaderboardStatus('Score sync failed. Your local progress is still saved.');
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const nameInput = document.getElementById('leaderboard-name');
    if (nameInput) nameInput.value = getLeaderboardPlayerName();
    if (LEADERBOARD_SUPABASE_URL && LEADERBOARD_SUPABASE_ANON_KEY) {
        await loadRankedWins();
        syncLeaderboardStats();
    } else {
        loadLeaderboard();
    }
    refreshRankUI();
});

// --- ALL CAR & BOT DECLARATIONS ---
let p1Teammate = null; // Teammate Bot (Blue Team)
let p2 = null;         // Enemy Bot 1 / P2 Player (Orange Team)
let p3 = null;         // Enemy Bot 2 (Orange Team)
let p4 = null;         // Enemy Bot 2 (For Co-op 2v2)

let p2Speed = 0;
let p2BoostAmount = 100;

// Velocity Vectors
let p1TeammateVel = new THREE.Vector3();
let p2Vel = new THREE.Vector3(0, 0, 0);
let p3Vel = new THREE.Vector3();
let p4Vel = new THREE.Vector3();

let p1SmoothQuat = new THREE.Quaternion();
let p2SmoothQuat = new THREE.Quaternion();

// --- 2V2 KICKOFF GRID ---
// Blue Goal is at X = -200 | Orange Goal is at X = +200
const SPOTS_2V2 = {
    p1:         { x: -100, z: -30, rot: -Math.PI / 2 }, // Human Player (Blue Left)
    p1Teammate: { x: -100, z:  30, rot: -Math.PI / 2 }, // AI Teammate  (Blue Right)
    p2:         { x:  100, z: -30, rot:  Math.PI / 2 }, // Enemy Bot 1   (Orange Left)
    p3:         { x:  100, z:  30, rot:  Math.PI / 2 }  // Enemy Bot 2   (Orange Right)
};

function refreshMenuStats() {
    const goalSpan = document.getElementById('goalDisplay');
    
    if (goalSpan) {
        // Pull from localStorage
        let savedGoals = localStorage.getItem('totalGoals') || 0;
        // Update the text on screen
        goalSpan.innerText = savedGoals;
    } else {
        console.warn("Could not find goalDisplay span on this screen.");
    }
    let xp = parseInt(localStorage.getItem('playerXP')) || 0;
    let level = parseInt(localStorage.getItem('playerLevel')) || 1;
    
    // Calculate percentage toward next level (e.g., progress toward next 1000)
    let progress = (xp % 1000) / 10; // Result is 0-100%
    document.getElementById('xp-fill').style.width = progress + "%";
    document.getElementById('levelDisplay').innerText = level;
    document.getElementById('xp-fillgui').style.width = progress + "%";
    document.getElementById('levelDisplaygui').innerText = level;
    refreshRankUI();
}
function showGarage() {
    document.getElementById('home-section').style.display = 'none';
    document.getElementById('garage-selection').style.display = 'block';
    
    // Build the lists
    updateGarageUI();
    
    // This will now either create the showroom OR just update the existing one
    initGarageShowroom();
}

function showHome() {
    document.getElementById('mode-selection').style.display = 'none';
    document.getElementById('ai-mode-selection').style.display = 'none'; // <--- ADD THIS LINE
    document.getElementById('online-mode-selection').style.display = 'none';
    document.getElementById('garage-selection').style.display = 'none';
    document.getElementById('settings-selection').style.display = 'none';
    rebindingAction = null;
    document.getElementById('home-section').style.display = 'flex';
    refreshMenuStats();
    
    // Force the main car to match the selected color right now
    if (p1) {
        updateCarColor(p1SelectedColor);
    }
}

function showModes() {
    document.getElementById('home-section').style.display = 'none';
    document.getElementById('ai-mode-selection').style.display = 'none'; // Ensure AI sub-menu is hidden
    document.getElementById('online-mode-selection').style.display = 'none';
    document.getElementById('mode-selection').style.display = 'block';
}
// --- NEW SUB-MENU TOGGLE FUNCTIONS ---
function showAIMenu() {
    document.getElementById('mode-selection').style.display = 'none';
    document.getElementById('online-mode-selection').style.display = 'none';
    document.getElementById('ai-mode-selection').style.display = 'block';
}

function showModeSelection() {
    document.getElementById('ai-mode-selection').style.display = 'none';
    document.getElementById('online-mode-selection').style.display = 'none';
    document.getElementById('mode-selection').style.display = 'block';
}

function showOnlineMenu() {
    document.getElementById('mode-selection').style.display = 'none';
    document.getElementById('ai-mode-selection').style.display = 'none';
    document.getElementById('online-mode-selection').style.display = 'block';
}

function setOnlineStatus(message) {
    const status = document.getElementById('online-status');
    if (status) status.textContent = message;
}

function hostOnlineRoom() {
    const playerLimit = Number(document.getElementById('online-player-limit').value);
    connectToOnlineRoom({ type: 'create-room', playerLimit });
}

async function joinRankedQueue() {
    if (onlineSocket && onlineSocket.readyState === WebSocket.OPEN) return;
    onlineRankedQueueActive = true;
    document.getElementById('ranked-queue-button').style.display = 'none';
    document.getElementById('online-standard-options').style.display = 'none';
    document.getElementById('ranked-queue-screen').style.display = 'block';
    document.getElementById('ranked-queue-status').textContent = 'Waiting for opponent...';
    setOnlineStatus('Joining ranked matchmaking...');

    const rankedWins = await loadRankedWins();
    if (!onlineRankedQueueActive) return;
    const rankPoints = getRankPoints();
    connectToOnlineRoom({
        type: 'find-ranked-match',
        playerId: getLeaderboardPlayerId(),
        rankedWins,
        rankPoints
    });
}

function cancelRankedQueue() {
    onlineRankedQueueActive = false;
    const queueSocket = onlineSocket;
    if (queueSocket) {
        onlineExpectedClose = true;
        queueSocket.close();
    }
    onlineSocket = null;
    onlineRole = null;
    document.getElementById('ranked-queue-screen').style.display = 'none';
    document.getElementById('ranked-queue-button').style.display = '';
    document.getElementById('online-standard-options').style.display = 'block';
    setOnlineStatus('Ranked queue cancelled.');
}

function updateOnlinePlayerNames(names = {}) {
    Object.keys(onlinePlayerNames).forEach(role => {
        if (names[role] !== undefined) onlinePlayerNames[role] = names[role];
    });
    const playerList = document.getElementById('online-lobby-player-list');
    const playerCount = onlineRoomPlayerLimit;
    playerList.replaceChildren();
    for (let index = 1; index <= playerCount; index++) {
        const role = `p${index}`;
        const team = playerCount === 2 ? (role === 'p1' ? 'BLUE' : 'ORANGE') : (index <= 2 ? 'BLUE' : 'ORANGE');
        const entry = document.createElement('div');
        entry.textContent = `${team}: ${onlinePlayerNames[role] || 'Waiting for player...'}`;
        playerList.appendChild(entry);
    }
    document.getElementById('online-lobby-count').textContent = `PLAYERS ${Object.values(onlinePlayerNames).filter(Boolean).length}/${onlineRoomPlayerLimit}`;
    document.getElementById('online-lobby-players').style.display = onlineRoomCode ? 'block' : 'none';
}

function createRankedScoreEmblem(rankTier) {
    const division = RANK_DIVISIONS[Math.max(0, Math.min(RANK_DIVISIONS.length - 1, rankTier))];
    const emblem = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    emblem.setAttribute('viewBox', '0 0 100 110');
    emblem.setAttribute('aria-hidden', 'true');
    emblem.classList.add('ranked-score-emblem');

    const shield = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shield.setAttribute('d', 'M50 3 91 18v29c0 26-16 44-41 60C25 91 9 73 9 47V18z');
    shield.setAttribute('fill', RANK_COLORS[division.tier]);
    shield.setAttribute('stroke', 'rgba(255,255,255,0.9)');
    shield.setAttribute('stroke-width', '6');
    emblem.appendChild(shield);
    return emblem;
}

function updateOnlineScoreNames() {
    const blueRoles = onlineRoomPlayerLimit === 4 ? ['p1', 'p2'] : ['p1'];
    const orangeRoles = onlineRoomPlayerLimit === 4 ? ['p3', 'p4'] : ['p2'];
    const isRankedMatch = currentMode === 'online' && onlineMatchSettings?.ranked;
    const rankByRole = onlineRole === 'p1'
        ? { p1: onlineMatchSettings?.playerRankTier, p2: onlineMatchSettings?.opponentRankTier }
        : { p1: onlineMatchSettings?.opponentRankTier, p2: onlineMatchSettings?.playerRankTier };

    const renderNames = (element, roles, fallback) => {
        element.replaceChildren();
        roles.forEach((role, index) => {
            if (index > 0) element.append(document.createTextNode(' / '));
            if (isRankedMatch && Number.isInteger(rankByRole[role])) {
                element.appendChild(createRankedScoreEmblem(rankByRole[role]));
            }
            const name = document.createElement('span');
            name.textContent = onlinePlayerNames[role] || fallback;
            element.appendChild(name);
        });
        element.classList.toggle('ranked-score-names', Boolean(isRankedMatch));
    };

    renderNames(document.getElementById('score-player-p1'), blueRoles, 'BLUE');
    renderNames(document.getElementById('score-player-p2'), orangeRoles, 'ORANGE');
}

function showJoinRoomForm() {
    document.getElementById('online-join-form').style.display = 'block';
    document.getElementById('online-room-input').focus();
}

function joinOnlineRoom() {
    const input = document.getElementById('online-room-input');
    const code = input.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
        setOnlineStatus('Enter the six-character room code.');
        input.focus();
        return;
    }
    connectToOnlineRoom({ type: 'join-room', code });
}

function updateOnlineLobbyUI(playerCount = 0, playerLimit = onlineRoomPlayerLimit) {
    const isHost = onlineRole === 'p1';
    const isGuest = Boolean(onlineRole && !isHost);
    document.getElementById('online-host-controls').style.display = isHost ? 'block' : 'none';
    document.getElementById('online-guest-waiting').style.display = isGuest ? 'block' : 'none';
    document.getElementById('online-host-room-button').style.display = onlineRole ? 'none' : '';
    document.getElementById('online-join-room-button').style.display = onlineRole ? 'none' : '';
    document.getElementById('online-host-setup').style.display = isGuest ? 'none' : 'block';
    document.getElementById('online-player-limit').disabled = Boolean(onlineRole);
    document.getElementById('online-join-form').style.display = isGuest ? 'none' : document.getElementById('online-join-form').style.display;
    document.getElementById('online-start-button').disabled = !isHost || playerCount < playerLimit;
}

function updateOnlineLimitLabel() {
    const rule = document.getElementById('online-match-rule').value;
    const mode = document.getElementById('online-match-mode').value;
    const limit = document.getElementById('online-match-limit');
    const maximum = rule === 'timer' ? 30 : mode === 'hot_potato' ? 100 : 20;
    document.getElementById('online-match-limit-label').textContent = rule === 'timer'
        ? 'Minutes'
        : mode === 'hot_potato' ? 'Points to win' : 'Goals to win';
    limit.max = String(maximum);
    if (Number(limit.value) > maximum) limit.value = String(maximum);
}

function hostStartOnlineMatch() {
    if (onlineRole !== 'p1' || !onlineSocket || onlineSocket.readyState !== WebSocket.OPEN) return;
    const mode = document.getElementById('online-match-mode').value;
    const rule = document.getElementById('online-match-rule').value;
    const limit = Number(document.getElementById('online-match-limit').value);
    const maximum = rule === 'timer' ? 30 : mode === 'hot_potato' ? 100 : 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > maximum) {
        const limitType = rule === 'timer' ? 'time' : mode === 'hot_potato' ? 'point' : 'goal';
        setOnlineStatus(`Choose a ${limitType} limit from 1 to ${maximum}.`);
        return;
    }
    document.getElementById('online-start-button').disabled = true;
    setOnlineStatus('Starting match...');
    onlineSocket.send(JSON.stringify({ type: 'start-match', settings: { mode, rule, limit } }));
}

function getOnlineTeam(role) {
    if (onlineRoomPlayerLimit === 2) return role === 'p1' ? 'blue' : 'orange';
    return role === 'p1' || role === 'p2' ? 'blue' : 'orange';
}

function getOnlineRoles() {
    return onlineRoomPlayerLimit === 4 ? ['p1', 'p2', 'p3', 'p4'] : ['p1', 'p2'];
}

function getOnlineScoreIndex(role) {
    return getOnlineTeam(role) === 'blue' ? 0 : 1;
}

function isHotPotatoMode() {
    return currentMode === 'hot_potato' || (currentMode === 'online' && onlineMatchSettings?.mode === 'hot_potato');
}

function setHotPotatoBallColor(hitterRole) {
    if (!isHotPotatoMode() || !hitterRole) return;
    const isBluePossession = currentMode === 'online'
        ? getOnlineTeam(hitterRole) === 'blue'
        : hitterRole === 'player' || hitterRole === 'p1';
    const color = isBluePossession ? 0x00cccc : 0xffaa00;
    ball.material.color.setHex(color);
    if (ball.material.emissive) ball.material.emissive.setHex(color);
}

function getOnlineWinnerRole() {
    if (score[0] === score[1]) return null;
    return score[0] > score[1] ? 'p1' : 'p2';
}

function hostEndOnlineMatch() {
    if (onlineRole !== 'p1' || onlineMatchSettings?.ranked || onlineMatchEnded || onlineEndRequestPending) return;
    if (!onlineSocket || onlineSocket.readyState !== WebSocket.OPEN) return;
    onlineEndRequestPending = true;
    onlineSocket.send(JSON.stringify({
        type: 'end-match',
        winnerRole: getOnlineWinnerRole(),
        score
    }));
}

function handleOnlineMatchEnd(message) {
    if (onlineMatchEnded) return;
    onlineMatchEnded = true;
    onlineEndRequestPending = false;
    score = message.score || score;
    document.getElementById('s1').textContent = score[0];
    document.getElementById('s2').textContent = score[1];
    gameRunning = false;
    document.getElementById('online-end-button').style.display = 'none';
    document.getElementById('online-match-hud').style.display = 'none';

    const winnerTeam = message.winnerTeam || (message.winnerRole ? getOnlineTeam(message.winnerRole) : null);
    const title = winnerTeam === null
        ? 'DRAW'
        : winnerTeam === getOnlineTeam(onlineRole) ? 'YOUR TEAM WINS' : 'OPPONENTS WIN';
    const didWin = winnerTeam !== null && winnerTeam === getOnlineTeam(onlineRole);
    document.getElementById('online-match-result-title').textContent = title;
    document.getElementById('online-match-result-score').textContent = `${score[0]} - ${score[1]}`;
    const rankedChange = document.getElementById('online-ranked-change');
    if (onlineMatchSettings?.ranked) {
        rankedChange.textContent = winnerTeam === null
            ? `NO RANK CHANGE | ${getRankInfo().name} (${getRankInfo().progress}%)`
            : applyRankedResult(didWin, onlineMatchSettings.opponentRankTier);
        rankedChange.style.display = 'block';
    } else {
        rankedChange.style.display = 'none';
    }
    document.getElementById('online-match-result').style.display = 'flex';
    let secondsUntilReload = 5;
    const leavingStatus = document.getElementById('online-leaving-status');
    leavingStatus.textContent = `Leaving match in ${secondsUntilReload}...`;
    const countdownTimer = window.setInterval(() => {
        secondsUntilReload--;
        if (secondsUntilReload === 0) {
            window.clearInterval(countdownTimer);
            window.location.reload();
            return;
        }
        leavingStatus.textContent = `Leaving match in ${secondsUntilReload}...`;
    }, 1000);

    if (onlineMatchSettings?.ranked && didWin && !onlineRankedWinRecorded) {
        onlineRankedWinRecorded = true;
        localStorage.setItem('rankedWins', getRankedWins() + 1);
        scheduleLeaderboardSync();
        if (leaderboardMetric === 'ranked') loadLeaderboard();
        if (new Date().getMonth() === 9) {
            addCrate('halloween');
            showMissionToast('HALLOWEEN DROP EARNED!');
        }
    }

    if (didWin && !onlineWinnerRewarded) {
        onlineWinnerRewarded = true;
        addXP(1500);
    }
}

function updateOnlineMatch() {
    if (currentMode !== 'online' || !onlineMatchSettings || onlineMatchEnded) return;

    if (onlineRole === 'p1') {
        if (onlineMatchSettings.rule === 'timer') {
            onlineMatchRemainingSeconds = Math.max(0, Math.ceil((onlineMatchEndsAt - Date.now()) / 1000));
            if (onlineMatchRemainingSeconds === 0) {
                hostEndOnlineMatch();
            }
        } else if (Math.max(score[0], score[1]) >= onlineMatchSettings.limit) {
            hostEndOnlineMatch();
        }
    }

    const clock = document.getElementById('online-match-clock');
    if (onlineMatchSettings.rule === 'timer') {
        const minutes = Math.floor(onlineMatchRemainingSeconds / 60);
        const seconds = onlineMatchRemainingSeconds % 60;
        clock.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
    } else {
        clock.textContent = `FIRST TO ${onlineMatchSettings.limit}`;
    }
}

function connectToOnlineRoom(request) {
    if (onlineSocket && onlineSocket.readyState === WebSocket.OPEN) return;
    if (request.type !== 'find-ranked-match') {
        setOnlineStatus(request.type === 'create-room' ? 'Creating room...' : 'Joining room...');
    }
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.host || 'localhost:8000';
    const serverUrl = window.location.hostname === 'corbock.github.io'
        ? ONLINE_SERVER_URL
        : `${protocol}://${host}`;
    try {
        onlineSocket = new WebSocket(serverUrl);
    } catch (error) {
        onlineSocket = null;
        setOnlineStatus('Could not open the connection. Use http://localhost:8000.');
        return;
    }

    let fatalServerError = false;
    let connectionError = false;
    const namedRequest = { ...request, playerName: getLeaderboardPlayerName() };
    onlineSocket.addEventListener('open', () => onlineSocket.send(JSON.stringify(namedRequest)));
    onlineSocket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'role') {
            onlineRole = message.role;
            onlineRoomCode = message.code || onlineRoomCode;
            onlineRoomPlayerLimit = message.playerLimit || onlineRoomPlayerLimit;
            updateOnlinePlayerNames(message.playerNames);
            document.getElementById('online-room-code').style.display = 'block';
            document.getElementById('online-room-code-value').textContent = onlineRoomCode;
            setOnlineStatus(`Room ${onlineRoomCode}: ${message.playerCount}/${onlineRoomPlayerLimit} players online.`);
            updateOnlineLobbyUI(message.playerCount, onlineRoomPlayerLimit);
        } else if (message.type === 'room-created') {
            onlineRoomCode = message.code;
            onlineRoomPlayerLimit = message.playerLimit || onlineRoomPlayerLimit;
            updateOnlinePlayerNames(message.playerNames);
            document.getElementById('online-room-code').style.display = 'block';
            document.getElementById('online-room-code-value').textContent = message.code;
            setOnlineStatus(`Room ${message.code} created. Waiting for players...`);
        } else if (message.type === 'player-count') {
            onlineRoomPlayerLimit = message.playerLimit || onlineRoomPlayerLimit;
            updateOnlinePlayerNames(message.playerNames);
            setOnlineStatus(`Room ${onlineRoomCode}: ${message.playerCount}/${onlineRoomPlayerLimit} players online.`);
            updateOnlineLobbyUI(message.playerCount, onlineRoomPlayerLimit);
        } else if (message.type === 'match-start') {
            onlineRankedQueueActive = false;
            launchOnlineMatch(message.settings);
        } else if (message.type === 'ranked-waiting') {
            document.getElementById('ranked-queue-status').textContent = 'Waiting for opponent...';
            setOnlineStatus('Waiting for an available ranked opponent...');
        } else if (message.type === 'match-end') {
            handleOnlineMatchEnd(message);
        } else if (message.type === 'ranked-opponent-disconnected') {
            setOnlineStatus(`Opponent disconnected. Match awarded in ${message.graceSeconds} seconds.`);
        } else if (message.type === 'state') {
            applyOnlineState(message);
        } else if (message.type === 'hit') {
            handleOnlineHit(message);
        } else if (message.type === 'error') {
            setOnlineStatus(message.message);
            if (onlineRole === 'p1' && !message.fatal) updateOnlineLobbyUI(0, onlineRoomPlayerLimit);
            if (message.fatal) {
                fatalServerError = true;
                stopOnlineGame();
            }
        }
    });
    onlineSocket.addEventListener('close', () => {
        if (onlineExpectedClose) {
            onlineExpectedClose = false;
            return;
        }
        if (!fatalServerError && !connectionError) setOnlineStatus('Disconnected from lobby.');
    });
    onlineSocket.addEventListener('error', () => {
        connectionError = true;
        if (request.type === 'find-ranked-match') {
            document.getElementById('ranked-queue-status').textContent = 'Could not connect to ranked matchmaking.';
        }
        setOnlineStatus('Could not connect to the online lobby.');
    });
}

window.hostOnlineRoom = hostOnlineRoom;
window.joinRankedQueue = joinRankedQueue;
window.cancelRankedQueue = cancelRankedQueue;
window.showJoinRoomForm = showJoinRoomForm;
window.joinOnlineRoom = joinOnlineRoom;
window.updateOnlineLimitLabel = updateOnlineLimitLabel;
window.hostStartOnlineMatch = hostStartOnlineMatch;
window.hostEndOnlineMatch = hostEndOnlineMatch;

function launchOnlineMatch(settings) {
    if (onlineGameStarted) return;
    onlineMatchSettings = settings;
    onlineMatchEnded = false;
    onlineEndRequestPending = false;
    onlineWinnerRewarded = false;
    onlineRankedWinRecorded = false;
    onlineMatchEndsAt = settings.rule === 'timer' ? Date.now() + settings.limit * 60000 : 0;
    onlineMatchRemainingSeconds = settings.rule === 'timer' ? settings.limit * 60 : 0;
    possessionTimer = 0;
    lastHitter = null;
    score = [0, 0];
    document.getElementById('s1').textContent = '0';
    document.getElementById('s2').textContent = '0';
    onlineGameStarted = true;
    onlineBallTarget = null;
    onlinePendingHitId = null;
    onlineHitSequence = 0;
    onlineLastAcknowledgedHitIds = {};
    onlineAcknowledgedHitIds = { p1: 0, p2: 0, p3: 0, p4: 0 };
    onlineGoalEvent = null;
    onlineGoalSequence = 0;
    onlineLastGoalSequence = 0;
    onlineResetSequence = 0;
    onlineLastResetSequence = 0;
    startGame('online');
    updateOnlineScoreNames();
}

function setCarBodyColor(car, color) {
    if (!car) return;
    car.traverse((node) => {
        if (node.isMesh && node.name === 'bodyMesh') node.material.color.set(color);
    });
}

function getOnlineCosmetics() {
    return {
        bodyColor: localStorage.getItem('p1Color') || localStorage.getItem('savedP1Color') || p1SelectedColor,
        hat: localStorage.getItem('p1Hat') || 'none',
        decal: localStorage.getItem('p1Decal') || 'none',
        goalExplosion: currentExplosionType
    };
}

function normalizeOnlineExplosionType(type) {
    return type === 'none' || (typeof type === 'string' && /^exp_[a-z]+$/.test(type))
        ? type
        : 'none';
}

function applyOnlineCosmetics(car, cosmetics) {
    if (!car || !cosmetics) return;
    setCarBodyColor(car, cosmetics.bodyColor);

    const oldHat = car.getObjectByName('playerHat');
    if (oldHat) car.remove(oldHat);
    if (cosmetics.hat && cosmetics.hat !== 'none') {
        const hat = createHat(cosmetics.hat);
        hat.position.set(0, 2.5, -0.5);
        car.add(hat);
    }

    const oldDecal = car.getObjectByName('playerDecal');
    if (oldDecal) car.remove(oldDecal);
    if (cosmetics.decal && cosmetics.decal !== 'none') {
        const decal = createDecal(cosmetics.decal);
        decal.position.set(0, 0.5, 0);
        car.add(decal);
    }
}

function stopOnlineGame() {
    if (onlineSocket) onlineSocket.close();
    onlineSocket = null;
    onlineRole = null;
    onlineGameStarted = false;
    onlineRoomCode = null;
    onlineRoomPlayerLimit = 2;
    onlinePlayerNames = { p1: null, p2: null, p3: null, p4: null };
    onlineBallTarget = null;
    onlinePendingHitId = null;
    onlineHitSequence = 0;
    onlineLastAcknowledgedHitIds = {};
    onlineAcknowledgedHitIds = {};
    onlineGoalEvent = null;
    onlineGoalSequence = 0;
    onlineLastGoalSequence = 0;
    onlineResetSequence = 0;
    onlineLastResetSequence = 0;
    onlineMatchSettings = null;
    onlineMatchEndsAt = 0;
    onlineMatchRemainingSeconds = 0;
    onlineMatchEnded = false;
    onlineEndRequestPending = false;
    onlineWinnerRewarded = false;
    restoreDefaultPlayerCar();
    document.getElementById('online-room-code').style.display = 'none';
    document.getElementById('online-lobby-players').style.display = 'none';
    document.getElementById('online-join-form').style.display = 'none';
    document.getElementById('online-match-result').style.display = 'none';
    document.getElementById('online-match-hud').style.display = 'none';
    updateOnlineLobbyUI(0);
    updateOnlineScoreNames();
    gameRunning = false;
    document.getElementById('gui').style.display = 'none';
    document.getElementById('main-menu').style.display = 'flex';
    showOnlineMenu();
}

function getOnlineCarState(car, velocity) {
    return car ? {
        position: { x: car.position.x, y: car.position.y, z: car.position.z },
        rotation: { x: car.rotation.x, y: car.rotation.y, z: car.rotation.z },
        velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
        cosmetics: getOnlineCosmetics(),
        isBoosting: keys['ShiftLeft'] && boostAmount > 0,
        boostType: currentBoostType
    } : null;
}

function applyOnlineState(message) {
    const remote = message.player;
    const remotePlayer = onlineCars && onlineCars[message.playerRole];
    if (remote && remotePlayer && message.playerRole !== onlineRole) {
        remotePlayer.car.position.set(remote.position.x, remote.position.y, remote.position.z);
        remotePlayer.car.rotation.set(remote.rotation.x, remote.rotation.y, remote.rotation.z);
        remotePlayer.velocity.set(remote.velocity.x, remote.velocity.y, remote.velocity.z);
        remotePlayer.isBoosting = remote.isBoosting === true;
        remotePlayer.boostType = boostTextures[remote.boostType] ? remote.boostType : 'standard_orange';
        remotePlayer.goalExplosion = normalizeOnlineExplosionType(remote.cosmetics?.goalExplosion);
        const cosmeticsSignature = JSON.stringify(remote.cosmetics);
        if (remote.cosmetics && cosmeticsSignature !== remotePlayer.cosmeticsSignature) {
            applyOnlineCosmetics(remotePlayer.car, remote.cosmetics);
            remotePlayer.cosmeticsSignature = cosmeticsSignature;
        }
    }
    if (onlineRole !== 'p1' && message.ball) {
        lastHitter = message.lastHitter || null;
        setHotPotatoBallColor(lastHitter);
        if (onlinePendingHitId !== null && message.acknowledgedHitIds?.[onlineRole] === onlinePendingHitId) {
            onlinePendingHitId = null;
        }
        if (onlinePendingHitId === null) {
            onlineBallTarget = new THREE.Vector3(
                message.ball.position.x,
                message.ball.position.y,
                message.ball.position.z
            );
            ballVel.set(message.ball.velocity.x, message.ball.velocity.y, message.ball.velocity.z);
            ball.visible = message.ball.visible !== false;
        }
        if (message.score) {
            score = message.score;
            document.getElementById('s1').textContent = score[0];
            document.getElementById('s2').textContent = score[1];
        }
    }
    if (onlineRole !== 'p1' && Number.isFinite(message.remainingSeconds)) {
        onlineMatchRemainingSeconds = message.remainingSeconds;
    }

    if (onlineRole !== 'p1' && message.goalEvent && message.goalEvent.id > onlineLastGoalSequence) {
        const goalEvent = message.goalEvent;
        onlineLastGoalSequence = goalEvent.id;
        score = goalEvent.score;
        document.getElementById('s1').textContent = score[0];
        document.getElementById('s2').textContent = score[1];
        if (goalEvent.scorerRole === onlineRole) addXP(100);
        isGoalScored = true;
        ballVel.set(0, 0, 0);
        ball.visible = false;
        createGoalExplosion(goalEvent.x, 0, goalEvent.explosionType);
        celebrate(goalEvent.text);
    }

    if (onlineRole !== 'p1' && message.resetSequence > onlineLastResetSequence) {
        onlineLastResetSequence = message.resetSequence;
        refillBoost();
        setOnlineKickoffPositions();
        ball.position.set(0, 5, 0);
        ballVel.set(0, 0, 0);
        ball.material.color.setHex(0xffffff);
        if (ball.material.emissive) ball.material.emissive.setHex(0x000000);
        ball.visible = true;
        onlineBallTarget = null;
        lastHitter = null;
        isGoalScored = false;
    }
}

function recordOnlineGoal(text, x, color) {
    if (currentMode !== 'online' || onlineRole !== 'p1') return;
    const remotePlayers = getOnlineRoles()
        .filter(role => role !== onlineRole)
        .map(role => onlineCars?.[role])
        .find(Boolean);
    const otherPlayer = getOnlineRoles()
        .filter(role => role !== onlineRole && getOnlineTeam(role) !== 'blue')
        .map(role => onlineCars?.[role])
        .find(Boolean) || remotePlayers;
    const explosionType = x > 0
        ? currentExplosionType
        : otherPlayer?.goalExplosion || 'none';
    onlineGoalEvent = {
        id: ++onlineGoalSequence,
        text,
        x,
        color,
        explosionType,
        scorerRole: ['p1', 'p2', 'p3', 'p4'].includes(lastHitter) ? lastHitter : null,
        score: [...score]
    };
    if (onlineGoalEvent.scorerRole === onlineRole) addXP(100);
    return explosionType;
}

function handleOnlineHit(message) {
    if (onlineRole !== 'p1' || message.playerRole === 'p1' || !onlineCars || !Number.isSafeInteger(message.hitId)) return;
    const previousHitId = onlineLastAcknowledgedHitIds[message.playerRole] || 0;
    if (message.hitId <= previousHitId) return;

    const remotePlayer = onlineCars[message.playerRole];
    if (!remotePlayer) return;
    const remote = message.player;
    if (remote) {
        remotePlayer.car.position.set(remote.position.x, remote.position.y, remote.position.z);
        remotePlayer.car.rotation.set(remote.rotation.x, remote.rotation.y, remote.rotation.z);
        remotePlayer.velocity.set(remote.velocity.x, remote.velocity.y, remote.velocity.z);
    }

    const predictedBall = message.ball;
    if (!predictedBall || !Number.isFinite(predictedBall.position?.x) || !Number.isFinite(predictedBall.position?.y) || !Number.isFinite(predictedBall.position?.z) || !Number.isFinite(predictedBall.velocity?.x) || !Number.isFinite(predictedBall.velocity?.y) || !Number.isFinite(predictedBall.velocity?.z)) return;
    ball.position.set(predictedBall.position.x, predictedBall.position.y, predictedBall.position.z);
    ballVel.set(predictedBall.velocity.x, predictedBall.velocity.y, predictedBall.velocity.z);
    lastHitter = message.playerRole;
    lastHitPosition.copy(remotePlayer.car.position);
    setHotPotatoBallColor(lastHitter);
    onlineLastAcknowledgedHitIds[message.playerRole] = message.hitId;
    onlineAcknowledgedHitIds[message.playerRole] = message.hitId;
}

function syncOnlineState(timestamp) {
    if (currentMode !== 'online' || !onlineSocket || onlineSocket.readyState !== WebSocket.OPEN) return;
    if (timestamp - onlineStateTimer < ONLINE_STATE_INTERVAL) return;
    onlineStateTimer = timestamp;
    onlineSocket.send(JSON.stringify({
        type: 'state',
        role: onlineRole,
        playerRole: onlineRole,
        player: getOnlineCarState(p1, p1Vel),
        acknowledgedHitIds: onlineRole === 'p1' ? onlineAcknowledgedHitIds : null,
        ball: onlineRole === 'p1' ? {
            position: { x: ball.position.x, y: ball.position.y, z: ball.position.z },
            velocity: { x: ballVel.x, y: ballVel.y, z: ballVel.z },
            visible: ball.visible
        } : null,
        lastHitter: onlineRole === 'p1' ? lastHitter : null,
        score: onlineRole === 'p1' ? score : null,
        goalEvent: onlineRole === 'p1' ? onlineGoalEvent : null,
        resetSequence: onlineRole === 'p1' ? onlineResetSequence : null,
        remainingSeconds: onlineRole === 'p1' && onlineMatchSettings?.rule === 'timer'
            ? onlineMatchRemainingSeconds
            : null
    }));
}
// Gold Color - 179, 155, 000
// --- COLOR CUSTOMIZATION LOGIC ---
function updateCarColor(hexColor) {
    p1SelectedColor = hexColor;
    localStorage.setItem('p1Color', hexColor); 

    // Update Main Game Car
    if (p1) {
        p1.traverse((node) => {
            if (node.isMesh && node.name === "bodyMesh") {
                node.material.color.set(hexColor);
            }
        });
    }

    // Update Mannequin Car
    if (showroomCar) {
        showroomCar.traverse((node) => {
            if (node.isMesh && node.name === "bodyMesh") {
                node.material.color.set(hexColor);
            }
        });
    }
}


// --- APPLY SAVED COLOR AT STARTUP ---
const savedColor = localStorage.getItem('p1Color');
if (savedColor && p1) {
    // We look through the car parts to find the body
    p1.children.forEach(child => {
        if (child.name === "bodyMesh" && child.material) {
            child.material.color.set(savedColor);
        }
    });
}

let garageScene, garageCamera, garageRenderer, showroomCar;

function initGarageShowroom() {
    const container = document.getElementById('showroom-container');
    
    // IF THE RENDERER ALREADY EXISTS, DON'T INITIALIZE AGAIN
    if (garageRenderer) {
        // Just refresh the car's look and return
        updateShowroomAppearance(); 
        return;
    }

    garageScene = new THREE.Scene();
    garageCamera = new THREE.PerspectiveCamera(50, 300 / 200, 0.1, 1000);
    garageCamera.position.set(12, 8, 12);
    garageCamera.lookAt(0, 0, 0);

    garageRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    garageRenderer.setSize(300, 200);
    container.appendChild(garageRenderer.domElement);

    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(5, 10, 5);
    garageScene.add(sun);
    garageScene.add(new THREE.AmbientLight(0xffffff, 0.5));

    // Load saved color before creating
    const savedColor = localStorage.getItem('p1Color') || '#00d2ff';
    showroomCar = createCar(savedColor, "lightblue");
    garageScene.add(showroomCar);

    // After creating the car, apply saved cosmetics
    updateShowroomAppearance();

    animateGarage();
}
function updateShowroomAppearance() {
    if (!showroomCar) return;

    const savedHat = localStorage.getItem('p1Hat') || 'none';
    const savedDecal = localStorage.getItem('p1Decal') || 'none';
    const savedColor = localStorage.getItem('p1Color') || '#00d2ff';

    // Update Color
    updateCarColor(savedColor);

    // Update Hat (This calls your existing equipHat logic)
    equipHat(savedHat);

    // Update Decal (This calls your existing equipDecal logic)
    equipDecal(savedDecal);
}

function animateGarage() {
    requestAnimationFrame(animateGarage);
    if (showroomCar) {
        showroomCar.rotation.y += 0.01;
        
        // Search for the blades and spin them
        const blades = showroomCar.getObjectByName("propellerBlades");
        if (blades) blades.rotation.y += 0.2;
    }
    garageRenderer.render(garageScene, garageCamera);
}



function startGame(mode) {
    currentMode = mode;
    gameRunning = true;
    refillBoost();
    updateOnlineScoreNames();
    
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    // Camera Aspect: Only split the aspect ratio if we are in 'split' mode
    camera1.aspect = ((currentMode === 'split' || currentMode === '2v2_coop') ? (width / 2) : width) / height;
    camera1.updateProjectionMatrix();

    document.getElementById('main-menu').style.display = 'none';
    document.getElementById('gui').style.display = 'block';
    const onlineHud = document.getElementById('online-match-hud');
    onlineHud.style.display = currentMode === 'online' ? 'flex' : 'none';
    document.getElementById('online-end-button').style.display = currentMode === 'online' && onlineRole === 'p1' && !onlineMatchSettings?.ranked ? 'block' : 'none';
    document.getElementById('online-match-result').style.display = 'none';

    const p2Hud = document.getElementById('p2-gui');
    const splitLine = document.getElementById('split-line');
    const savedHat = localStorage.getItem('p1Hat');
    const savedDecal = localStorage.getItem('p1Decal');
    const savedBoost = localStorage.getItem('equippedBoost');
    
    if (savedHat) {
        equipHat(savedHat);
    }
    if (savedDecal) {
        equipDecal(savedDecal);
    }
    if (savedBoost) {
        currentBoostType = savedBoost; // Sync the active particle variable
    } else {
        currentBoostType = 'standard_orange'; // Default fallback
    }
    if (currentMode === 'online') {
        configureOnlineCars();
        setOnlineKickoffPositions();
        camera1.fov = 85;
        if (p2Hud) p2Hud.style.display = 'none';
        if (splitLine) splitLine.style.display = 'none';
    } else if (currentMode === 'split') {
    //if (p2 && (currentMode === 'split')) {
        // --- SPLIT SCREEN MODE ---
        initPlayer2();
        giveBotRandomHat(p2);
        camera1.fov = 95; 
        camera2.fov = 95;
        
        if (p2Hud) p2Hud.style.display = 'flex'; 
        if (splitLine) splitLine.style.display = 'block';
        
    } else if (currentMode === 'ai') {
        // --- VS. BOT MODE ---
        initPlayer2(); // We still need the P2 car for the AI to drive!
        giveBotRandomHat(p2);
        camera1.fov = 85; // Full screen FOV
        
        if (p2Hud) p2Hud.style.display = 'none'; // Hide P2 HUD for AI
        if (splitLine) splitLine.style.display = 'none';
                // AI Jump Logic: If the ball is higher than the bot, the bot jumps
        if (ball.position.y > p2.position.y + 2 && p2.position.y <= 1.05) {
            p2Vel.y = 0.5; // Bot Jumps!
        }
    } else if (currentMode === 'hot_potato') {
        // --- VS. BOT MODE ---
        initPlayer2(); // We still need the P2 car for the AI to drive!
        giveBotRandomHat(p2);
        camera1.fov = 85; // Full screen FOV
        
        if (p2Hud) p2Hud.style.display = 'none'; // Hide P2 HUD for AI
        if (splitLine) splitLine.style.display = 'none';
                // AI Jump Logic: If the ball is higher than the bot, the bot jumps
        if (ball.position.y > p2.position.y + 2 && p2.position.y <= 1.05) {
            p2Vel.y = 0.5; // Bot Jumps!
        }
    } else if (currentMode === '2v2_ai') {
        // --- 2V2 TEAM BOT MODE ---
        camera1.fov = 85; // Full screen view
        if (p2Hud) p2Hud.style.display = 'none';
        if (splitLine) splitLine.style.display = 'none';

        // 1. Create AI Teammate (Blue Team)
        if (!p1Teammate) {
            p1Teammate = createCar("blue", "lightblue");
            scene.add(p1Teammate);
        }

        // 2. Create Enemy Bot 1 (Orange Team)
        if (!p2) {
            p2 = createCar("orange", "#ffcc00");
            scene.add(p2);
        }

        // 3. Create Enemy Bot 2 (Orange Team)
        if (!p3) {
            p3 = createCar("red", "#ffcc00");
            scene.add(p3);
        }
        // --- EQUIP ALL 3 BOTS WITH RANDOM HATS ---
        giveBotRandomHat(p1Teammate);
        giveBotRandomHat(p2);
        giveBotRandomHat(p3);
        // Ensure all 3 AI cars are rendered
        p1Teammate.visible = true;
        p2.visible = true;
        p3.visible = true;

        // --- POSITION ALL 4 CARS ON THE 2V2 KICKOFF GRID ---
        p1.position.set(SPOTS_2V2.p1.x, 1, SPOTS_2V2.p1.z);
        p1.rotation.y = SPOTS_2V2.p1.rot;
        if (typeof p1Vel !== 'undefined') p1Vel.set(0, 0, 0);

        p1Teammate.position.set(SPOTS_2V2.p1Teammate.x, 1, SPOTS_2V2.p1Teammate.z);
        p1Teammate.rotation.y = SPOTS_2V2.p1Teammate.rot;
        p1TeammateVel.set(0, 0, 0);

        p2.position.set(SPOTS_2V2.p2.x, 1, SPOTS_2V2.p2.z);
        p2.rotation.y = SPOTS_2V2.p2.rot;
        p2Vel.set(0, 0, 0);

        p3.position.set(SPOTS_2V2.p3.x, 1, SPOTS_2V2.p3.z);
        p3.rotation.y = SPOTS_2V2.p3.rot;
        p3Vel.set(0, 0, 0);
    
    } else if (currentMode === '2v2_coop') {
        // 1. Enable Split-Screen View
        initPlayer2();
        camera1.fov = 95; 
        camera2.fov = 95;
        
        if (p2Hud) p2Hud.style.display = 'flex'; 
        if (splitLine) splitLine.style.display = 'block';
    
        // 2. Spawn Orange Enemy Bots
        if (!p3) { p3 = createCar("orange", "#ffcc00"); scene.add(p3); }
        if (!p4) { p4 = createCar("orange", "#ffcc00"); scene.add(p4); }
    
        p3.visible = true;
        p4.visible = true;
        if (p1Teammate) p1Teammate.visible = false; // Hide 1P mode teammate
        
        giveBotRandomHat(p2);
        giveBotRandomHat(p3);
        giveBotRandomHat(p4);
    
        // 3. Grid Kickoff Setup
        p1.position.set(SPOTS_2V2.p1.x, 1, SPOTS_2V2.p1.z);          // P1 (Blue Left)
        p1.rotation.y = SPOTS_2V2.p1.rot;
    
        p2.position.set(SPOTS_2V2.p1Teammate.x, 1, SPOTS_2V2.p1Teammate.z); // P2 (Blue Right)
        p2.rotation.y = SPOTS_2V2.p1Teammate.rot;
    
        p3.position.set(SPOTS_2V2.p2.x, 1, SPOTS_2V2.p2.z);          // Bot 1 (Orange Left)
        p3.rotation.y = SPOTS_2V2.p2.rot;
    
        p4.position.set(SPOTS_2V2.p3.x, 1, SPOTS_2V2.p3.z);          // Bot 2 (Orange Right)
        p4.rotation.y = SPOTS_2V2.p3.rot;
    
    } else {
        // --- PRACTICE (SOLO) MODE ---
        camera1.fov = 85;
        
        if (p2Hud) p2Hud.style.display = 'none';
        if (splitLine) splitLine.style.display = 'none';
        
        // Optional: Remove P2 if it exists from a previous game
        if (window.p2) {
            scene.remove(p2);
            p2 = null;
        }
    }
    
    camera1.updateProjectionMatrix();
    if (camera2) camera2.updateProjectionMatrix();
}

let boostAmount = 100;
let p1RotVel = 0; // Pitch velocity

function refillBoost() {
    boostAmount = 100;
    p2BoostAmount = 100;
}

const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(10, 20, 10);
scene.add(light);
scene.add(new THREE.AmbientLight(0x404040));

const loader = new THREE.TextureLoader();
const groundTexture = loader.load('https://codehs.com/uploads/dfb17a0a9f3de6a69b998ddc1dfd9eff'); 

const floor = new THREE.Mesh(
    new THREE.BoxGeometry(570, 1, 320), 
    new THREE.MeshPhongMaterial({
        map: groundTexture,  
        shininess: 10
    }) 
);

floor.position.y = -0.5;
scene.add(floor);

const BOOST_PAD_RADIUS = 9;
const BOOST_PAD_RECHARGE_PER_FRAME = 2.0;
const BOOST_PAD_POSITIONS = [
    { x: -170, z: -95, playerRole: 'p1', lastParticleTime: 0 },
    { x: 170, z: -95, playerRole: 'p2', lastParticleTime: 0 },
    { x: -170, z: 95, playerRole: 'p1', lastParticleTime: 0 },
    { x: 170, z: 95, playerRole: 'p2', lastParticleTime: 0 }
];

BOOST_PAD_POSITIONS.forEach((pad) => {
    const base = new THREE.Mesh(
        new THREE.CylinderGeometry(7.5, 7.5, 0.3, 32),
        new THREE.MeshStandardMaterial({
            color: 0x24d9d0,
            emissive: 0x087a78,
            emissiveIntensity: 1.4,
            metalness: 0.45,
            roughness: 0.3
        })
    );
    base.position.set(pad.x, 0.18, pad.z);
    scene.add(base);
    pad.base = base;

    const ring = new THREE.Mesh(
        new THREE.TorusGeometry(8.5, 0.65, 8, 32),
        new THREE.MeshBasicMaterial({ color: 0x8ffff5 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(pad.x, 0.4, pad.z);
    scene.add(ring);
    pad.ring = ring;
});

function updateBoostPadEffects(timestamp) {
    BOOST_PAD_POSITIONS.forEach((pad) => {
        const car = currentMode === 'online'
            ? onlineCars?.[pad.playerRole]?.car
            : pad.playerRole === 'p1' ? p1 : p2;
        const bodyColor = car?.getObjectByName('bodyMesh')?.material?.color;
        const padColor = bodyColor || new THREE.Color(pad.playerRole === 'p1' ? p1SelectedColor : '#ff9900');
        pad.base.material.color.copy(padColor);
        pad.base.material.emissive.copy(padColor).multiplyScalar(0.35);
        pad.ring.material.color.copy(padColor);

        if (timestamp - pad.lastParticleTime < 160) return;
        pad.lastParticleTime = timestamp;
        const boostType = currentMode === 'online' && pad.playerRole !== onlineRole
            ? onlineCars?.[pad.playerRole]?.boostType || 'standard_orange'
            : currentBoostType;
        const position = new THREE.Vector3(pad.x, 1.2, pad.z);

        for (let index = 0; index < 2; index++) {
            const angle = Math.random() * Math.PI * 2;
            const velocity = new THREE.Vector3(
                Math.cos(angle) * 0.12,
                0.04 + Math.random() * 0.1,
                Math.sin(angle) * 0.12
            );
            createBoostParticle(position, false, scene, boostType, velocity);
        }
    });
}

function updateBoostPadRecharge(playerId, car) {
    if (!car) return;
    const pad = car.position.y <= 3.5
        ? BOOST_PAD_POSITIONS.find((candidate) => {
            const xDistance = car.position.x - candidate.x;
            const zDistance = car.position.z - candidate.z;
            return xDistance * xDistance + zDistance * zDistance <= BOOST_PAD_RADIUS * BOOST_PAD_RADIUS;
        })
        : null;
    if (!pad) return;

    if (playerId === 'p1') {
        boostAmount = Math.min(100, boostAmount + BOOST_PAD_RECHARGE_PER_FRAME);
    } else {
        p2BoostAmount = Math.min(100, p2BoostAmount + BOOST_PAD_RECHARGE_PER_FRAME);
    }
}

const underTexture = loader.load('https://codehs.com/uploads/3f6d453cc26b5df3c9634d50175b82e1'); 
const floorUnder = new THREE.Mesh(
    new THREE.BoxGeometry(970, 0.1, 720), 
    new THREE.MeshPhongMaterial({
        map: underTexture,  
        shininess: 10
    }) 
);

floorUnder.position.y = -0.5;
scene.add(floorUnder);

// Add a "Glass Ceiling"
const ceilingGeo = new THREE.PlaneGeometry(400, 240); // Match your arena size
const ceilingMat = new THREE.MeshBasicMaterial({ 
    color: 0x00ffff, 
    transparent: true, 
    opacity: 0.05, 
    side: THREE.DoubleSide 
});
const ceiling = new THREE.Mesh(ceilingGeo, ceilingMat);
ceiling.rotation.x = Math.PI / 2;
ceiling.position.y = 70; // Match arenaHeight
scene.add(ceiling);

const ballTexture = loader.load('https://codehs.com/uploads/2a5fed409347f06bcc6bcfc782485fe1'); 

const ballGeo = new THREE.SphereGeometry(5, 32, 32); // 5, 32, 32 Increased segments for smoother texture
const ballMat = new THREE.MeshPhongMaterial({ 
    map: ballTexture,  // This applies the image
    shininess: 100     // Makes it look a bit reflective
});

const ball = new THREE.Mesh(ballGeo, ballMat);
let ballVel = new THREE.Vector3(0, 0, 0);
scene.add(ball);


scene.add(p1);
let p1Vel = new THREE.Vector3(0, 0, 0);

function initPlayer2() {
    // Determine body and accent color based on mode
    const isCoop = (currentMode === '2v2_coop');
    const bodyColor = isCoop ? "blue" : "orange";
    const accentColor = isCoop ? "#00d2ff" : "#ffcc00";

    p2 = createCar(bodyColor, accentColor); 
    p2.position.set(60, 1, 0);
    p2.rotation.y = currentMode === 'split' ? Math.PI / 2 : Math.PI;
    p2.rotation.order = 'YXZ';
    p2SmoothQuat.copy(p2.quaternion); 
    
    scene.add(p2);
}

function configureOnlineCars() {
    onlineCars = onlineCars || {};
    const roles = getOnlineRoles();
    roles.forEach((role) => {
        if (onlineCars[role]) return;
        const isBlue = getOnlineTeam(role) === 'blue';
        onlineCars[role] = {
            car: createCar(isBlue ? 'blue' : 'orange', isBlue ? 'lightblue' : '#ffcc00'),
            velocity: new THREE.Vector3(),
            juice: { zoom: 0, shake: 0, lean: 0 },
            goalExplosion: 'none'
        };
    });

    Object.entries(onlineCars).forEach(([role, player]) => {
        player.car.visible = roles.includes(role);
        player.car.rotation.order = 'YXZ';
        scene.add(player.car);
    });

    const localPlayer = onlineCars[onlineRole];
    const remoteRole = roles.find(role => role !== onlineRole);
    const remotePlayer = onlineCars[remoteRole];
    const localCosmetics = getOnlineCosmetics();
    applyOnlineCosmetics(localPlayer.car, localCosmetics);
    localPlayer.cosmeticsSignature = JSON.stringify(localCosmetics);
    defaultPlayerCar.visible = false;

    p1 = localPlayer.car;
    p1Vel = localPlayer.velocity;
    p1Juice = localPlayer.juice;
    p1SmoothQuat.copy(p1.quaternion);
    p2 = remotePlayer.car;
    p2Vel = remotePlayer.velocity;
    p2Juice = remotePlayer.juice;
    p2SmoothQuat.copy(p2.quaternion);
}

function restoreDefaultPlayerCar() {
    if (onlineCars) {
        Object.values(onlineCars).forEach(player => {
            scene.remove(player.car);
            player.velocity.set(0, 0, 0);
        });
    }
    defaultPlayerCar.visible = true;
    p1 = defaultPlayerCar;
    p1Vel = new THREE.Vector3();
    p1Juice = { zoom: 0, shake: 0, lean: 0 };
    p1SmoothQuat.copy(p1.quaternion);
    p2 = null;
    p2Vel = new THREE.Vector3();
    p2Juice = { zoom: 0, shake: 0, lean: 0 };
}

function setOnlineKickoffPositions() {
    getOnlineRoles().forEach((role, index) => {
        const player = onlineCars[role];
        if (!player) return;
        const isBlue = getOnlineTeam(role) === 'blue';
        const z = onlineRoomPlayerLimit === 2 ? 0 : index % 2 === 0 ? -30 : 30;
        const x = onlineRoomPlayerLimit === 2 ? (isBlue ? -60 : 60) : (isBlue ? -100 : 100);
        player.car.position.set(x, 1, z);
        player.car.rotation.set(0, isBlue ? -Math.PI / 2.001 : Math.PI / 2, 0);
        player.velocity.set(0, 0, 0);
    });
    p1SmoothQuat.copy(p1.quaternion);
    p2SmoothQuat.copy(p2.quaternion);
}

// --- UPGRADED 2V2 AI CONTROLLER WITH TACTICAL ROLES ---
function runAIBot(botMesh, botVel, targetGoalX, role = 'OFFENSE') {
    if (!botMesh || !ball) return;

    // 1. DYNAMIC TEAMMATE ROLE EVALUATION
    let activeRole = role;
    if (role === 'SMART_TEAMMATE') {
        const p1DistToBall = p1 ? p1.position.distanceTo(ball.position) : Infinity;
        const botDistToBall = botMesh.position.distanceTo(ball.position);

        // If the human player is closer to the ball or in the offensive zone, bot plays defense!
        if (p1DistToBall < botDistToBall || (p1 && p1.position.x > ball.position.x - 20)) {
            activeRole = 'DEFENSE';
        } else {
            activeRole = 'OFFENSE';
        }
    }

    // 2. DEFENSIVE POSITIONING LOGIC
    // Home goal post coordinates based on team target (Blue Goal is -200, Orange Goal is +200)
    const homeGoalX = (targetGoalX < 0) ? 120 : -120; // Goal being defended

    let targetPos;
    let aiDriveSpeed = 0.08;

    if (activeRole === 'DEFENSE') {
        // Defensive Trigger: Is the ball on our side of the pitch?
        const isBallThreatening = (targetGoalX < 0) ? (ball.position.x > 0) : (ball.position.x < 0);

        if (isBallThreatening) {
            // Ball is in our half! Intercept the ball
            targetPos = ball.position.clone();
            aiDriveSpeed = 0.14;
        } else {
            // Ball is safe downfield. Hold a defensive anchor position near home goal center
            targetPos = new THREE.Vector3(homeGoalX, 1, ball.position.z * 0.4); // Shadow ball Z-movement
            
            // Go easy on speed when idling in position
            let distToAnchor = botMesh.position.distanceTo(targetPos);
            aiDriveSpeed = distToAnchor > 15 ? 0.10 : 0.02; 
        }

    } else {
        // --- OFFENSIVE ROUTING (p3 & Active Teammate) ---
        const targetGoalPos = new THREE.Vector3(targetGoalX, 0, 0);
        let ballToGoal = new THREE.Vector3().subVectors(targetGoalPos, ball.position).normalize();

        let impactPoint = ball.position.clone().sub(ballToGoal.clone().multiplyScalar(2));
        let attackPoint = ball.position.clone().add(ballToGoal.clone().multiplyScalar(-20));

        let distToBall = botMesh.position.distanceTo(ball.position);

        let isOutOfPosition = (targetGoalX < 0) 
            ? botMesh.position.x < ball.position.x + 5   // Attacking Blue (-200)
            : botMesh.position.x > ball.position.x - 5;  // Attacking Orange (+200)

        if (isOutOfPosition) {
            let recoverX = (targetGoalX < 0) ? ball.position.x + 40 : ball.position.x - 40;
            targetPos = new THREE.Vector3(recoverX, 0, ball.position.z);
            aiDriveSpeed = 0.14;
        } else {
            let dirToImpact = new THREE.Vector3().subVectors(impactPoint, botMesh.position).normalize();
            let alignment = dirToImpact.dot(ballToGoal);

            if (alignment > 0.85 && distToBall < 60) {
                targetPos = impactPoint;
                aiDriveSpeed = (alignment < 0.95 && distToBall < 25) ? 0.04 : 0.16;
            } else {
                targetPos = attackPoint;
                aiDriveSpeed = 0.1;
            }
        }
    }

    // 3. STEERING & ROTATION MATH
    let dirToTarget = new THREE.Vector3().subVectors(targetPos, botMesh.position);
    let targetAngle = Math.atan2(dirToTarget.x, dirToTarget.z) + Math.PI;
    let angleDiff = targetAngle - botMesh.rotation.y;

    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;

    let currentSteer = (aiDriveSpeed < 0.05) ? 0.08 : 0.05;
    if (angleDiff > 0.05) botMesh.rotation.y += currentSteer;
    else if (angleDiff < -0.05) botMesh.rotation.y -= currentSteer;

    if (Math.abs(angleDiff) > 1.2) aiDriveSpeed = 0;

    // 4. MOVEMENT EXECUTION
    if (Math.abs(angleDiff) < 1.5) {
        botVel.z -= Math.cos(botMesh.rotation.y) * aiDriveSpeed;
        botVel.x -= Math.sin(botMesh.rotation.y) * aiDriveSpeed;
    }

    // 5. PHYSICS FLOOR & BOUNDARIES
    if (botMesh.position.y > 1.05) botVel.y -= 0.04;
    else { botMesh.position.y = 1; botVel.y = 0; }

    botMesh.position.add(botVel);
    botVel.x *= 0.95;
    botVel.z *= 0.95;

    botMesh.position.x = Math.max(-198, Math.min(198, botMesh.position.x));
    botMesh.position.z = Math.max(-118, Math.min(118, botMesh.position.z));
}
function createCar(color, cabinColor) {
    const group = new THREE.Group();

    const hitbox = new THREE.Mesh(
        new THREE.BoxGeometry(6, 4, 7),
        new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true, visible: false })
    );
    group.add(hitbox);

    // CHANGE: Use our global p1SelectedColor if this is the "blue" car
    let finalColor = color;
    if (color === "blue") finalColor = p1SelectedColor;

    const body = new THREE.Mesh(
        new THREE.BoxGeometry(4.5, 2, 6.5),
        new THREE.MeshStandardMaterial({ color: finalColor }) // Uses the variable
    );
    body.name = "bodyMesh"; // Add a name so we can find it later to change colors live
    body.position.y = 0.5;
    group.add(body);

    const cabin = new THREE.Mesh(
        new THREE.BoxGeometry(4, 1, 3),
        new THREE.MeshStandardMaterial({ color: cabinColor })
    );
    cabin.position.set(0, 2, -0.5);
    group.add(cabin);

    const spoiler = new THREE.Mesh(
        new THREE.BoxGeometry(5, 0.5, 1),
        new THREE.MeshStandardMaterial({ color: "black" })
    );
    spoiler.position.set(0, 2.2, 3);
    group.add(spoiler);

    const wheelGeom = new THREE.CylinderGeometry(1, 1, 1, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const wheelPositions = [[2.3, 2], [-2.3, 2], [2.3, -2], [-2.3, -2]];
    
    wheelPositions.forEach(pos => {
        const wheel = new THREE.Mesh(wheelGeom, wheelMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(pos[0], 0, pos[1]);
        group.add(wheel);
    });

    return group;
}

let cosmeticTime = 0;

const ALL_ITEMS = [
    // HATS
    { id: 'tophat', name: '🎩 Top Hat', type: 'hat', lvl: 1 },
    { id: 'cone', name: '🚧 Cone', type: 'hat', lvl: 1 },
    { id: 'viking', name: '🛡️ Viking', type: 'hat', lvl: 2 },
    { id: 'vikingRed', name: '🛡️ Viking: 🟥', type: 'hat', lvl: 80 },
    { id: 'pirate', name: '🏴‍☠ Pirate', type: 'hat', lvl: 13 },
    { id: 'wizard', name: '🪄 Wizard', type: 'hat', lvl: 14 },
    { id: 'crown', name: '👑 Crown', type: 'hat', lvl: 6 },
    { id: 'miniCar', name: '🚗 Mini-Car', type: 'hat', lvl: 9 },
    { id: 'propeller', name: '🚁 Propeller', type: 'hat', lvl: 12 },
    { id: 'propeller_black', name: '🚁 Propeller: ⬛', type: 'hat', lvl: 75 },
    { id: 'neon', name: '✨ Halo', type: 'hat', lvl: 10 },
    { id: 'police', name: '🚨 Police', type: 'hat', lvl: 15 },
    { id: 'customSign', name: 'Corbok', type: 'hat', lvl: 25 },
    { id: 'tophatGold', name: '🎩 Top Hat: 🟨', type: 'hat', lvl: 250 },
    
    // NEW: Secret Item entry 
    { id: 'potato_fire', name: '🔥 Fiery Potato', type: 'hat', isSecret: true },
    { id: 'clown_nose', name: '🤡 Clown Nose', type: 'hat', isSecret: true },
    { id: 'sniper_scope', name: '🎯 Sniper Scope', type: 'hat', isSecret: true },
    
    { id: 'ufo', name: '🛸 ufo', type: 'hat', isSecret: true },

    // RANKED ITEMS
    { id: 'cone_bronze', name: '🚧 Cone: 🟫', type: 'hat', isSecret: true },
    { id: 'viking_bronze', name: '🛡️ Viking: 🟫', type: 'hat', isSecret: true },
    { id: 'cone_silver', name: '🚧 Cone: Silver', type: 'hat', isSecret: true },
    { id: 'tophat_silver', name: '🎩 Top Hat: Silver', type: 'hat', isSecret: true },
    { id: 'neon_silver', name: '✨ Halo: Silver', type: 'hat', isSecret: true },
    { id: 'cone_gold', name: '🚧 Cone: 🟨', type: 'hat', isSecret: true },
    { id: 'coins', name: 'Coins', type: 'boost', isSecret: true },
    { id: 'propeller_gold', name: '🚁 Propeller: 🟨', type: 'hat', isSecret: true },
    { id: 'tophat_diamond', name: '🎩 Top Hat: 💎', type: 'hat', isSecret: true },
    { id: 'potato_diamond', name: '🥔 Potato: 💎', type: 'hat', isSecret: true },
    { id: 'exp_diamond', name: 'Diamondnova', type: 'explosion', isSecret: true },
    { id: 'tophat_real', name: '🎩 Top Hat: Real', type: 'hat', isSecret: true },
    { id: 'real', name: 'Real Boost', type: 'boost', isSecret: true },
    { id: 'exp_real', name: 'Diamondnova: Real', type: 'explosion', isSecret: true },
    
    // DROP ITEMS
    { id: 'plank_eyes', name: '👀 Plank', type: 'hat', isDropItem: true, rarity: 'common' },
    { id: 'plank_red', name: '👀 Plank: 🟥', type: 'hat', isDropItem: true, rarity: 'common' },
    { id: 'dirtDecal', name: 'Dirt', type: 'decal', isDropItem: true, rarity: 'common' },
    { id: 'rubber_duck', name: '🦆 Rubber Duck', type: 'hat', isDropItem: true, rarity: 'uncommon' },
    { id: 'camoDecal', name: 'Camo', type: 'decal', isDropItem: true, rarity: 'uncommon' },
    { id: 'double_tophat', name: '🎩🎩 Double Hat', type: 'hat', isDropItem: true, rarity: 'rare' },
    { id: 'bubbleDecal', name: 'Bubbles', type: 'decal', isDropItem: true, rarity: 'rare' },
    { id: 'satellite', name: '📡 Dish', type: 'hat', isDropItem: true, rarity: 'legendary' },
    { id: 'illusionDecal', name: 'Illusion', type: 'decal', isDropItem: true, rarity: 'legendary' },
    { id: 'rubber_duck_purple', name: '🦆 Rubber Duck: Exotic', type: 'hat', isDropItem: true, rarity: 'exotic' },
    { id: 'crown_purple', name: '👑 Crown: Exotic', type: 'hat', isDropItem: true, rarity: 'exotic' },
    { id: 'blackIceDecal', name: 'Black Ice: Exotic', type: 'decal', isDropItem: true, rarity: 'exotic' },
    { id: 'witch', name: '🪄 Witch Hat', type: 'hat', isDropItem: true, rarity: 'halloween' },
    { id: 'pumpkin', name: '🎃 Pumpkin Hat', type: 'hat', isDropItem: true, rarity: 'halloween' },
    { id: 'cauldron', name: 'Cauldron', type: 'hat', isDropItem: true, rarity: 'halloween' },
    { id: 'bloodst', name: 'Blood', type: 'boost', isDropItem: true, rarity: 'halloween' },
    { id: 'ghostDecal', name: 'Ghost', type: 'decal', isDropItem: true, rarity: 'halloween' },
    { id: 'leaves', name: 'Leaves', type: 'boost', isDropItem: true, rarity: 'halloween' },
    { id: 'exp_bat', name: 'Bats', type: 'explosion', isDropItem: true, rarity: 'halloween' },
    { id: 'exp_corn', name: 'Candy Corn', type: 'explosion', isDropItem: true, rarity: 'halloween' },

    // DECALS
    { id: 'woodDecal', name: 'Wood', type: 'decal', lvl: 3 },
    { id: 'leafDecal', name: 'Leaf', type: 'decal', lvl: 4 },
    { id: 'rectDecal', name: 'Edgy', type: 'decal', lvl: 7 },
    { id: 'hexDecal', name: 'Hex', type: 'decal', lvl: 8 },
    { id: 'galaxyDecal', name: 'Galaxy', type: 'decal', lvl: 21 },
    { id: 'flameDecal', name: 'Flame', type: 'decal', lvl: 23 },
    { id: 'corbokDecal', name: 'Corbok', type: 'decal', lvl: 50 },
    
    //boosts
    { id: 'standard_orange', name: 'Classic Flame', type: 'boost', lvl: 1 },
    { id: 'neon_blue', name: 'Plasma', type: 'boost', lvl: 11 },
    { id: 'neon_gold', name: 'Plasma: 🟨', type: 'boost', lvl: 300 },
    { id: 'neon_red', name: 'Lazer', type: 'boost', lvl: 16 },
    { id: 'void_white', name: 'Snow', type: 'boost', lvl: 5 },
    { id: 'void_black', name: 'Void', type: 'boost', lvl: 29 },
    { id: 'ghost_white', name: 'Ectoplasm', type: 'boost', lvl: 20 },
    
    // EXPLOSIONS  'exp_supernovared'
    { id: 'exp_standard', name: 'Ghost', type: 'explosion', lvl: 19 },
    { id: 'exp_supernova', name: 'Supernova', type: 'explosion', lvl: 30 },
    { id: 'exp_supernovawhite', name: 'Supervoid', type: 'explosion', lvl: 90 },
    { id: 'exp_supernovared', name: 'Supervoid: 🟥', type: 'explosion', lvl: 125 },
    { id: 'exp_ghost', name: 'Dueling Dragons', type: 'explosion', lvl: 45 },
    { id: 'exp_whiteduel', name: 'Dueling Dragons: ⬜', type: 'explosion', lvl: 100 },
    { id: 'exp_goldduel', name: 'Dueling Dragons: 🟨', type: 'explosion', lvl: 500 }
    
];
function createHat(type) {
    console.log("⚠️ createHat is running for type:", type);
    const hatGroup = new THREE.Group();
    hatGroup.name = "playerHat"; // So we can find and remove it later

    if (type === 'tophat') {
        // Brim
        const brim = new THREE.Mesh(
            new THREE.CylinderGeometry(1.5, 1.5, 0.1, 16),
            new THREE.MeshStandardMaterial({ color: 0x222222 })
        );
        hatGroup.add(brim);

        // Cylinder
        const top = new THREE.Mesh(
            new THREE.CylinderGeometry(1, 1, 2, 16),
            new THREE.MeshStandardMaterial({ color: 0x222222 })
        );
        top.position.y = 1;
        hatGroup.add(top);
    } 
    if (type === 'tophatGold') {
        // Brim
        const brim = new THREE.Mesh(
            new THREE.CylinderGeometry(1.5, 1.5, 0.1, 16),
            new THREE.MeshStandardMaterial({
                color: 0xD3AF37, // <--- Added comma here
                metalness: 0.6,
                roughness: 0.2
            })
        );
        hatGroup.add(brim);

        // Cylinder
        const top = new THREE.Mesh(
            new THREE.CylinderGeometry(1, 1, 2, 16),
            new THREE.MeshStandardMaterial({
                color: 0xFFFF00, // <--- Added comma here
                metalness: 0.6,
                roughness: 0.2
            })
        );
        top.position.y = 1;
        //hatGroup.rotation.x = Math.PI * -0.01;
        hatGroup.add(top);
    } 
    if (type === 'tophat_silver') {
        // Brim
        const brim = new THREE.Mesh(
            new THREE.CylinderGeometry(1.5, 1.5, 0.1, 16),
            new THREE.MeshStandardMaterial({
                color: 0xd3d3d3, // Silver color
                metalness: 0.6,
                roughness: 0.2
            })
        );
        hatGroup.add(brim);

        // Cylinder
        const top = new THREE.Mesh(
            new THREE.CylinderGeometry(1, 1, 2, 16),
            new THREE.MeshStandardMaterial({
                color: 0xd3d3d3, // Silver color
                metalness: 0.6,
                roughness: 0.2
            })
        );
        top.position.y = 1;
        hatGroup.rotation.x = Math.PI * 0.01;
        hatGroup.add(top);
    } 
    if (type === 'tophat_diamond') {
        // Brim
        const brim = new THREE.Mesh(
            new THREE.CylinderGeometry(1.5, 1.5, 0.1, 16),
            new THREE.MeshStandardMaterial({
                color: 0xB9F2FF, // Diamond color
                metalness: 0.6,
                roughness: 0.15,
                metalness: 0.1,
                transparent: true,
                opacity: 0.75
            })
        );
        hatGroup.add(brim);

        // Cylinder
        const top = new THREE.Mesh(
            new THREE.CylinderGeometry(1, 1, 2, 16),
            new THREE.MeshStandardMaterial({
                color: 0xB9F2FF, // Diamond color
                metalness: 0.6,
                roughness: 0.15,
                metalness: 0.1,
                transparent: true,
                opacity: 0.75
            })
        );
        top.position.y = 1;
        //hatGroup.rotation.x = Math.PI * -0.01;
        hatGroup.add(top);
    } 
    if (type === 'tophat_real') {
        // Brim
        const brim = new THREE.Mesh(
            new THREE.CylinderGeometry(1.5, 1.5, 0.1, 16),
            new THREE.MeshStandardMaterial({
                color: 0x01ff01, // Real color
                metalness: 0.6,
                roughness: 0.2
            })
        );
        hatGroup.add(brim);

        // Cylinder
        const top = new THREE.Mesh(
            new THREE.CylinderGeometry(1, 1, 2, 16),
            new THREE.MeshStandardMaterial({
                color: 0x01ff01, // Real color
                metalness: 0.6,
                roughness: 0.2
            })
        );
        top.position.y = 1;
        //hatGroup.rotation.x = Math.PI * -0.01;
        hatGroup.add(top);
    } 
    if (type === 'double_tophat') {
        const hatMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });

        // --- BOTTOM HAT ---
        // Bottom Brim
        const brim1 = new THREE.Mesh(
            new THREE.CylinderGeometry(1.5, 1.5, 0.1, 16),
            hatMaterial
        );
        hatGroup.add(brim1);

        // Bottom Cylinder (height 2, centered at y = 1)
        const top1 = new THREE.Mesh(
            new THREE.CylinderGeometry(1, 1, 2, 16),
            hatMaterial
        );
        top1.position.y = 1;
        hatGroup.add(top1);

        // --- TOP HAT (Stacked on top) ---
        // Top Brim (placed at y = 2.05, resting on top of the first cylinder)
        const brim2 = new THREE.Mesh(
            new THREE.CylinderGeometry(1.5, 1.5, 0.1, 16),
            hatMaterial
        );
        brim2.position.y = 2.05;
        hatGroup.add(brim2);

        // Top Cylinder (placed at y = 3.1)
        const top2 = new THREE.Mesh(
            new THREE.CylinderGeometry(1, 1, 2, 16),
            hatMaterial
        );
        top2.position.y = 3.1;
        hatGroup.add(top2);
    }
    if (type === 'rubber_duck') {
        const duckYellow = new THREE.MeshStandardMaterial({ 
            color: 0xFFD700, 
            roughness: 0.3, 
            metalness: 0.1 
        });
        const beakOrange = new THREE.MeshStandardMaterial({ 
            color: 0xFF4500, 
            roughness: 0.5 
        });
        const eyeBlack = new THREE.MeshBasicMaterial({ color: 0x000000 });

        // 1. Body
        const body = new THREE.Mesh(
            new THREE.SphereGeometry(0.8, 16, 16),
            duckYellow
        );
        body.scale.set(1, 0.8, 1.2); // Slightly squashed/elongated for a duck shape
        body.position.y = 0.6;
        hatGroup.add(body);

        // 2. Head
        const head = new THREE.Mesh(
            new THREE.SphereGeometry(0.5, 16, 16),
            duckYellow
        );
        head.position.set(0, 1.3, 0.3);
        hatGroup.add(head);

        // 3. Beak
        const beak = new THREE.Mesh(
            new THREE.ConeGeometry(0.2, 0.4, 16),
            beakOrange
        );
        beak.rotation.x = Math.PI / 2; // Point forward
        beak.position.set(0, 1.25, 0.8);
        hatGroup.add(beak);

        // 4. Eyes
        const eyeGeo = new THREE.SphereGeometry(0.06, 8, 8);
        
        const leftEye = new THREE.Mesh(eyeGeo, eyeBlack);
        leftEye.position.set(-0.25, 1.4, 0.6);
        hatGroup.add(leftEye);

        const rightEye = new THREE.Mesh(eyeGeo, eyeBlack);
        rightEye.position.set(0.25, 1.4, 0.6);
        hatGroup.add(rightEye);
    }
    if (type === 'rubber_duck_purple') {
        const duckYellow = new THREE.MeshStandardMaterial({ 
            color: 0xFF00FF, 
            roughness: 0.2, 
            metalness: 0.6,
            transparent: true,
            opacity: 0.9
        });
        const beakOrange = new THREE.MeshStandardMaterial({ 
            color: 0xFF4500, 
            roughness: 0.5 
        });
        const eyeBlack = new THREE.MeshBasicMaterial({
            color: 0x4c00b0,
            emissive: 0x4c00b0

         });

        // 1. Body
        const body = new THREE.Mesh(
            new THREE.SphereGeometry(0.8, 16, 16),
            duckYellow
        );
        body.scale.set(1, 0.8, 1.2); // Slightly squashed/elongated for a duck shape
        body.position.y = 0.6;
        hatGroup.add(body);

        // 2. Head
        const head = new THREE.Mesh(
            new THREE.SphereGeometry(0.5, 16, 16),
            duckYellow
        );
        head.position.set(0, 1.3, 0.3);
        hatGroup.add(head);

        // 3. Beak
        const beak = new THREE.Mesh(
            new THREE.ConeGeometry(0.2, 0.4, 16),
            beakOrange
        );
        beak.rotation.x = Math.PI / 2; // Point forward
        beak.position.set(0, 1.25, 0.8);
        hatGroup.add(beak);

        // 4. Eyes
        const eyeGeo = new THREE.SphereGeometry(0.2, 8, 8);
        
        const leftEye = new THREE.Mesh(eyeGeo, eyeBlack);
        leftEye.position.set(-0.25, 1.4, 0.6);
        hatGroup.add(leftEye);

        const rightEye = new THREE.Mesh(eyeGeo, eyeBlack);
        rightEye.position.set(0.25, 1.4, 0.6);
        hatGroup.add(rightEye);
    }
    if (type === 'plank_eyes') {
        // --- WOODEN BOARD ---
        const boardMat = new THREE.MeshStandardMaterial({ 
            color: 0x8B5A2B, // Wood brown
            roughness: 0.8,
            metalness: 0.1 
        });

        // Main wooden plank
        const board = new THREE.Mesh(
            new THREE.BoxGeometry(2.5, 0.2, 1.2), // width, height, depth
            boardMat
        );
        board.position.y = 0.1;
        hatGroup.add(board);

        // --- GOOGLY EYES ---
        const eyeWhiteMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF });
        const pupilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });

        // Helper function to create an eye
        const createGooglyEye = (xOffset) => {
            const eyeGroup = new THREE.Group();

            // White base
            const eyeBase = new THREE.Mesh(
                new THREE.CylinderGeometry(0.3, 0.3, 0.05, 16),
                eyeWhiteMat
            );
            eyeGroup.add(eyeBase);

            // Black pupil
            const pupil = new THREE.Mesh(
                new THREE.CylinderGeometry(0.12, 0.12, 0.06, 16),
                pupilMat
            );
            // Slightly offset the pupil position for a goofy look
            pupil.position.set(0.05, 0.01, -0.05);
            eyeGroup.add(pupil);

            // Position on top of the board
            eyeGroup.position.set(xOffset, 0.22, 0);
            return eyeGroup;
        };

        // Left Eye & Right Eye
        hatGroup.add(createGooglyEye(-0.5));
        hatGroup.add(createGooglyEye(0.5));
    }
    if (type === 'plank_red') {
        // --- WOODEN BOARD ---
        const boardMat = new THREE.MeshStandardMaterial({ 
            color: 0xff0000, // Red
            roughness: 0.8,
            metalness: 0.1 
        });

        // Main wooden plank
        const board = new THREE.Mesh(
            new THREE.BoxGeometry(2.5, 0.2, 1.2), // width, height, depth
            boardMat
        );
        board.position.y = 0.1;
        hatGroup.add(board);

        // --- GOOGLY EYES ---
        const eyeWhiteMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF });
        const pupilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });

        // Helper function to create an eye
        const createGooglyEye = (xOffset) => {
            const eyeGroup = new THREE.Group();

            // White base
            const eyeBase = new THREE.Mesh(
                new THREE.CylinderGeometry(0.3, 0.3, 0.05, 16),
                eyeWhiteMat
            );
            eyeGroup.add(eyeBase);

            // Black pupil
            const pupil = new THREE.Mesh(
                new THREE.CylinderGeometry(0.12, 0.12, 0.06, 16),
                pupilMat
            );
            // Slightly offset the pupil position for a goofy look
            pupil.position.set(0.05, 0.01, -0.05);
            eyeGroup.add(pupil);

            // Position on top of the board
            eyeGroup.position.set(xOffset, 0.22, 0);
            return eyeGroup;
        };

        // Left Eye & Right Eye
        hatGroup.add(createGooglyEye(-0.5));
        hatGroup.add(createGooglyEye(0.5));
    }
    if (type === 'cone') {
        const cone = new THREE.Mesh(
            new THREE.ConeGeometry(1, 2, 16),
            new THREE.MeshStandardMaterial({ color: 0xffa500 })
        );
        cone.position.y = 1;
        hatGroup.add(cone);
    }
    if (type === 'cone_silver') {
        const cone = new THREE.Mesh(
            new THREE.ConeGeometry(1, 2, 16),
            new THREE.MeshStandardMaterial({ color: 0xC0C0C0, metalness: 0.6, roughness: 0.2 })
        );
        cone.position.y = 1;
        hatGroup.add(cone);
    }
    if (type === 'cone_bronze') {
        const cone = new THREE.Mesh(
            new THREE.ConeGeometry(1, 2, 16),
            new THREE.MeshStandardMaterial({ color: 0xCD7F32, metalness: 0.6, roughness: 0.2 })
        );
        cone.position.y = 1;
        hatGroup.add(cone);
    }
    if (type === 'cone_gold') {
        const cone = new THREE.Mesh(
            new THREE.ConeGeometry(1, 2, 16),
            new THREE.MeshStandardMaterial({ color: 0xFFD700, metalness: 0.6, roughness: 0.2 })
        );
        cone.position.y = 1;
        hatGroup.add(cone);
    }
    if (type === 'crown') {
        // === 1. The Padded Base (Velvet Cushion) ===
        // This part sits on the car, giving the crown structure
        const baseGeo = new THREE.CylinderGeometry(1.0, 1.2, 0.6, 16); 
        const baseMat = new THREE.MeshStandardMaterial({ color: 0x881111, roughness: 1.0 }); // Deep crimson velvet
        const base = new THREE.Mesh(baseGeo, baseMat);
        base.position.y = 0.3; // Sit it up slightly
        base.scale.set(1.0, 1.0, 1.1); // Slightly elongated to fit better
        hatGroup.add(base);
    
        // === 2. The Gold Circlet (The Main Band) ===
        const bandGeo = new THREE.CylinderGeometry(1.5, 1.5, 0.4, 16); // Thin band open at ends
        const goldMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.2, side: THREE.DoubleSide });
        const band = new THREE.Mesh(bandGeo, goldMat);
        band.position.y = 0.3;
        band.scale.set(1.0, 1.0, 1.1); // Match base elongation
        hatGroup.add(band);
    
        // === 3. The Decorative Spikes (Fleur-de-lis points) ===
        const spikeGeo = new THREE.ConeGeometry(0.3, 0.8, 8); // Simple spikes
        const numSpikes = 8;
        for (let i = 0; i < numSpikes; i++) {
            const spike = new THREE.Mesh(spikeGeo, goldMat);
            const angle = (i / numSpikes) * Math.PI * 2;
            spike.position.set(Math.cos(angle) * 1.22, 0.8, Math.sin(angle) * 1.22 * 1.1);
            spike.rotation.y = angle; // Rotate spikes to point outward
            hatGroup.add(spike);
        }
    
        // === 4. The Gemstones ===
        const gemGeo = new THREE.IcosahedronGeometry(0.15, 1); // Faceted gem look
        const numGems = 8;
        
        // Add red and blue gems alternating
        for (let i = 0; i < numGems; i++) {
            let gemMat;
            if (i % 2 === 0) {
                gemMat = new THREE.MeshStandardMaterial({ color: 0xff0000, metalness: 0.8, roughness: 0.1, emissive: 0xaa0000 }); // Red gem
            } else {
                gemMat = new THREE.MeshStandardMaterial({ color: 0x0000ff, metalness: 0.8, roughness: 0.1, emissive: 0x0000aa }); // Blue gem
            }
    
            const gem = new THREE.Mesh(gemGeo, gemMat);
            const angle = (i / numGems) * Math.PI * 2;
            // Position gems slightly inset from the band edge
            gem.position.set(Math.cos(angle) * 1.5, 0.3, Math.sin(angle) * 1.5 * 1.1); 
            hatGroup.add(gem);
        }
    }
    if (type === 'crown_purple') {
        // === 1. The Padded Base (Velvet Cushion) ===
        // This part sits on the car, giving the crown structure
        const baseGeo = new THREE.CylinderGeometry(1.0, 1.2, 0.6, 16); 
        const baseMat = new THREE.MeshStandardMaterial({ 
            color: 0x4c00b0,
            metalness: 0.6,
            emissive: 0x4c00b0,
            roughness: 0.2
        }); 
        const base = new THREE.Mesh(baseGeo, baseMat);
        base.position.y = 0.3; // Sit it up slightly
        base.scale.set(1.0, 1.0, 1.1); // Slightly elongated to fit better
        hatGroup.add(base);
    
        // === 2. The Gold Circlet (The Main Band) ===
        const bandGeo = new THREE.CylinderGeometry(1.5, 1.5, 0.4, 16); // Thin band open at ends
        const goldMat = new THREE.MeshStandardMaterial({ 
            color: 0xFF00FF, 
            roughness: 0.2, 
            metalness: 0.6,
            transparent: true,
            opacity: 0.9 
        });
        const band = new THREE.Mesh(bandGeo, goldMat);
        band.position.y = 0.3;
        band.scale.set(1.0, 1.0, 1.1); // Match base elongation
        hatGroup.add(band);
    
        // === 3. The Decorative Spikes (Fleur-de-lis points) ===
        const spikeGeo = new THREE.ConeGeometry(0.3, 0.8, 8); // Simple spikes
        const numSpikes = 8;
        for (let i = 0; i < numSpikes; i++) {
            const spike = new THREE.Mesh(spikeGeo, goldMat);
            const angle = (i / numSpikes) * Math.PI * 2;
            spike.position.set(Math.cos(angle) * 1.22, 0.8, Math.sin(angle) * 1.22 * 1.1);
            spike.rotation.y = angle; // Rotate spikes to point outward
            hatGroup.add(spike);
        }
    
        // === 4. The Gemstones ===
        const gemGeo = new THREE.IcosahedronGeometry(0.15, 1); // Faceted gem look
        const numGems = 8;
        
        // Add red and blue gems alternating
        for (let i = 0; i < numGems; i++) {
            let gemMat;
            if (i % 2 === 0) {
                gemMat = new THREE.MeshStandardMaterial({ color: 0x4c00b0, metalness: 0.8, roughness: 0.1, emissive: 0x4c00b0 }); // Red gem
            } else {
                gemMat = new THREE.MeshStandardMaterial({ color: 0x0000ff, metalness: 0.8, roughness: 0.1, emissive: 0x0000aa }); // Blue gem
            }
    
            const gem = new THREE.Mesh(gemGeo, gemMat);
            const angle = (i / numGems) * Math.PI * 2;
            // Position gems slightly inset from the band edge
            gem.position.set(Math.cos(angle) * 1.5, 0.3, Math.sin(angle) * 1.5 * 1.1); 
            hatGroup.add(gem);
        }
    }
    if (type === 'wizard') {
        // === 1. The Wide Brim ===
        const texture = loader.load('https://codehs.com/uploads/cdf2f537f2e65dcfc13517a073d3e0ab');
        const brimGeo = new THREE.CylinderGeometry(1.8, 2.2, 0.1, 24);
        const wizardMat = new THREE.MeshStandardMaterial({ 
            map: texture,
            transparent: true // Useful if your image has a transparent background
        });
        const brim = new THREE.Mesh(brimGeo, wizardMat);
        brim.position.y = 0.05;
        brim.scale.set(1.2, 1.0, 1.3); // Elongated front-to-back to fit the car better
        hatGroup.add(brim);
    
        // === 2. The Tilted Magic Cone (FLIPPED TILT) ===
        const coneGeo = new THREE.ConeGeometry(1.0, 2.5, 16);
        const cone = new THREE.Mesh(coneGeo, wizardMat);
        
        // Positioned slightly forward and tilted forward instead of backward
        cone.position.set(0, 1.2, 0.2); 
        cone.rotation.x = Math.PI / 16; // Changed from negative to positive
        hatGroup.add(cone);
    
        // === 3. The Hat Band (FLIPPED TILT) ===
        const bandGeo = new THREE.CylinderGeometry(0.85, 0.95, 0.2, 16, 1, true);
        const bandMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.7, roughness: 0.3 });
        const band = new THREE.Mesh(bandGeo, bandMat);
        band.position.set(0, 0.25, 0.05);
        band.rotation.x = Math.PI / 16; // Match the new forward tilt
        band.scale.set(1.05, 1.0, 1.1);
        hatGroup.add(band);
    
        // === 4. The Glowing Star Charm (REPOSITIONED FOR NEW TILT) ===
        const starGeo = new THREE.IcosahedronGeometry(0.2, 0); 
        const starMat = new THREE.MeshStandardMaterial({ 
            color: 0x00ffff,       
            emissive: 0x00aaaa,    
            roughness: 0.1 
        });
        const star = new THREE.Mesh(starGeo, starMat);
        
        // Moved forward to hang off the new tip position
        star.position.set(0, 2.4, 0.5); 
        hatGroup.add(star);
    }
    if (type === 'witch') {
        // === 1. The Wide Brim ===
        const brimGeo = new THREE.CylinderGeometry(1.8, 2.2, 0.1, 24);
        const wizardMat = new THREE.MeshStandardMaterial({ 
            color: 0x000000,
            metalness: 0.7,
            roughness: 0.3,
            transparent: true // Useful if your image has a transparent background
        });
        const brim = new THREE.Mesh(brimGeo, wizardMat);
        brim.position.y = 0.05;
        brim.scale.set(1.2, 1.0, 1.3); // Elongated front-to-back to fit the car better
        hatGroup.add(brim);
    
        // === 2. The Tilted Magic Cone (FLIPPED TILT) ===
        const coneGeo = new THREE.ConeGeometry(1.0, 2.5, 16);
        const cone = new THREE.Mesh(coneGeo, wizardMat);
        
        // Positioned slightly forward and tilted forward instead of backward
        cone.position.set(0, 1.2, 0.2); 
        cone.rotation.x = Math.PI / 16; // Changed from negative to positive
        hatGroup.add(cone);
    
        // === 3. The Hat Band (FLIPPED TILT) ===
        const bandGeo = new THREE.CylinderGeometry(0.85, 0.95, 0.2, 16, 1, true);
        const bandMat = new THREE.MeshStandardMaterial({ color: 0xb100cd, metalness: 0.7, roughness: 0.3 });
        const band = new THREE.Mesh(bandGeo, bandMat);
        band.position.set(0, 0.25, 0.05);
        band.rotation.x = Math.PI / 16; // Match the new forward tilt
        band.scale.set(1.05, 1.0, 1.1);
        hatGroup.add(band);
    
        // === 4. The Glowing Star Charm (REPOSITIONED FOR NEW TILT) ===
        const starGeo = new THREE.IcosahedronGeometry(0.2, 0); 
        const starMat = new THREE.MeshStandardMaterial({ 
            color: 0xb100cd,       
            emissive: 0xb100cd,    
            roughness: 0.1 
        });
        const star = new THREE.Mesh(starGeo, starMat);
        
        // Moved forward to hang off the new tip position
        star.position.set(0, 2.4, 0.5); 
        hatGroup.add(star);
    }
    if (type === 'cauldron') {
        // --- MATERIALS ---
        const bellyGeo = new THREE.SphereGeometry(1.2, 16, 16, 0, Math.PI * 2, 0.9, Math.PI / 2);

        const ironMat = new THREE.MeshStandardMaterial({ 
            color: 0x1a1a1a, 
            roughness: 0.7, 
            metalness: 0.8,
            side: THREE.DoubleSide // Important: allows you to see inside the pot
        });
    
        const potionMat = new THREE.MeshStandardMaterial({ 
            color: 0x39ff14, 
            emissive: 0x1f990a, 
            emissiveIntensity: 2, 
            roughness: 0.2, 
            metalness: 0.1 
        });
    
        // === 1. The Main Cauldron Body ===
        const belly = new THREE.Mesh(bellyGeo, ironMat);
        belly.position.y = 0.8;
        belly.scale.set(1.2, 0.8, 1.2);
        hatGroup.add(belly);
    
        // === 2. The Rim / Lip ===
        const rim = new THREE.Mesh(
            new THREE.TorusGeometry(1.1, 0.15, 8, 24),
            ironMat
        );
        rim.position.y = 1.3;
        rim.rotation.x = Math.PI / 2;
        hatGroup.add(rim);
    
        // === 3. The Potion Liquid Surface ===
        const potionSurface = new THREE.Mesh(
            new THREE.CylinderGeometry(1.0, 1.0, 0.05, 16),
            potionMat
        );
        potionSurface.position.y = 1.25; // Sitting just inside the rim
        hatGroup.add(potionSurface);
    
        // === 4. Bubbles (Green Potion Bubbles) ===
        const bubbleGeo = new THREE.SphereGeometry(0.15, 8, 8);
        const numBubbles = 7;
    
        for (let i = 0; i < numBubbles; i++) {
            const bubble = new THREE.Mesh(bubbleGeo, potionMat);
            
            // Randomize placement across the liquid surface
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * 0.7;
            
            // Vary the height slightly so some pop out higher
            const yOffset = 1.28 + Math.random() * 0.12;
            const scale = 0.5 + Math.random() * 0.8;
    
            bubble.position.set(
                Math.cos(angle) * radius,
                yOffset,
                Math.sin(angle) * radius
            );
            bubble.scale.set(scale, scale, scale);
            hatGroup.add(bubble);
        }
    
        // === 5. Side Handles ===
        const handleGeo = new THREE.TorusGeometry(0.25, 0.05, 8, 16);
        
        // Left Handle
        const leftHandle = new THREE.Mesh(handleGeo, ironMat);
        leftHandle.position.set(-1.3, 0.9, 0);
        hatGroup.add(leftHandle);
    
        // Right Handle
        const rightHandle = new THREE.Mesh(handleGeo, ironMat);
        rightHandle.position.set(1.3, 0.9, 0);
        hatGroup.add(rightHandle);
    }
    if (type === 'pumpkin') {
        // --- MATERIALS ---
        const pumpkinMat = new THREE.MeshStandardMaterial({
            color: 0xEB8B0C,
            roughness: 0.7,
            metalness: 0.1,
            flatShading: true
        });
    
        const glowMat = new THREE.MeshBasicMaterial({
            color: 0xFFD700, // Bright glowing yellow/orange
            side: THREE.DoubleSide
        });
    
        const stemMat = new THREE.MeshStandardMaterial({
            color: 0x228B22,
            roughness: 0.9
        });
    
        // === 1. Main Pumpkin Body ===
        const body = new THREE.Mesh(
            new THREE.SphereGeometry(1.2, 16, 12),
            pumpkinMat
        );
        body.position.y = 0.9;
        body.scale.set(1.1, 0.9, 1.1);
        hatGroup.add(body);
    
        // === 2. Stem (Moved higher to sit on top) ===
        const stem = new THREE.Mesh(
            new THREE.CylinderGeometry(0.08, 0.15, 0.5, 8),
            stemMat
        );
        stem.position.set(0, 2, 0); // Moved up above top edge
        stem.rotation.z = -0.2;       // Tilted for character
        hatGroup.add(stem);
    
        // === 3. Glowing Eyes (Triangles) ===
        const eyeGeo = new THREE.ConeGeometry(0.2, 0.3, 3); // 3 sides = triangle
        
        // Left Eye
        const eyeL = new THREE.Mesh(eyeGeo, glowMat);
        eyeL.position.set(-0.4, 1.1, 1.15);
        eyeL.rotation.set(0.2, -0.3, -0.3);
        hatGroup.add(eyeL);
    
        // Right Eye
        const eyeR = new THREE.Mesh(eyeGeo, glowMat);
        eyeR.position.set(0.4, 1.1, 1.15);
        eyeR.rotation.set(0.2, 0.3, 0.3);
        hatGroup.add(eyeR);
    
        // === 4. Glowing Nose ===
        const nose = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.2, 3), glowMat);
        nose.position.set(0, 0.85, 1.22);
        nose.rotation.x = 0.2;
        hatGroup.add(nose);
    
        // === 5. Jagged Mouth ===
        const mouthGroup = new THREE.Group();
        const toothGeo = new THREE.BoxGeometry(0.12, 0.12, 0.05);
    
        // Arc of 5 teeth/blocks to form a smile
        for (let i = 0; i < 5; i++) {
            const tooth = new THREE.Mesh(toothGeo, glowMat);
            const offset = (i - 2) * 0.18;
            const yOffset = -Math.pow(offset, 2) * 1.5; // Curves upward into a smile
            tooth.position.set(offset, yOffset, 0);
            mouthGroup.add(tooth);
        }
    
        mouthGroup.position.set(0, 0.6, 1.2);
        mouthGroup.rotation.x = -0.1;
        hatGroup.add(mouthGroup);
    }
    if (type === 'viking') {
        // Main Helmet
        const helm = new THREE.Mesh(
            new THREE.SphereGeometry(1.2, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2),
            new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.7 })
        );
        hatGroup.add(helm);

        // Horns
        const hornGeo = new THREE.ConeGeometry(0.4, 1.5, 8);
        const hornMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
        
        const leftHorn = new THREE.Mesh(hornGeo, hornMat);
        leftHorn.position.set(-1, 0.8, 0);
        leftHorn.rotation.z = Math.PI / 4;
        hatGroup.add(leftHorn);

        const rightHorn = new THREE.Mesh(hornGeo, hornMat);
        rightHorn.position.set(1, 0.8, 0);
        rightHorn.rotation.z = -Math.PI / 4;
        hatGroup.add(rightHorn);
    }
    if (type === 'viking_bronze') {
        // Main Helmet
        const helm = new THREE.Mesh(
            new THREE.SphereGeometry(1.2, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2),
            new THREE.MeshStandardMaterial({ color: 0xCD7F32, metalness: 0.6, roughness: 0.2 })
        );
        hatGroup.add(helm);

        // Horns
        const hornGeo = new THREE.ConeGeometry(0.4, 1.5, 8);
        const hornMat = new THREE.MeshStandardMaterial({ color: 0xCD7F32, metalness: 0.6, roughness: 0.2 });
        
        const leftHorn = new THREE.Mesh(hornGeo, hornMat);
        leftHorn.position.set(-1, 0.8, 0);
        leftHorn.rotation.z = Math.PI / 4;
        hatGroup.add(leftHorn);

        const rightHorn = new THREE.Mesh(hornGeo, hornMat);
        rightHorn.position.set(1, 0.8, 0);
        rightHorn.rotation.z = -Math.PI / 4;
        hatGroup.add(rightHorn);
    }
    if (type === 'vikingRed') {
        // Main Helmet
        const helm = new THREE.Mesh(
            new THREE.SphereGeometry(1.2, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2),
            new THREE.MeshStandardMaterial({ color: 0x000000, metalness: 0.7 })
        );
        hatGroup.add(helm);

        // Horns
        const hornGeo = new THREE.ConeGeometry(0.4, 1.5, 8);
        const hornMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        
        const leftHorn = new THREE.Mesh(hornGeo, hornMat);
        leftHorn.position.set(-1, 0.8, 0);
        leftHorn.rotation.z = Math.PI / 4;
        hatGroup.add(leftHorn);

        const rightHorn = new THREE.Mesh(hornGeo, hornMat);
        rightHorn.position.set(1, 0.8, 0);
        rightHorn.rotation.z = -Math.PI / 4;
        hatGroup.add(rightHorn);
    }
    if (type === 'pirate') {
        // 1. Main Skull Cap
        const capGeo = new THREE.SphereGeometry(1.0, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2);
        const pirateMat = new THREE.MeshStandardMaterial({ 
            color: 0x111111, 
            roughness: 0.8 
        }); 
        const cap = new THREE.Mesh(capGeo, pirateMat);
        cap.scale.set(1, 0.8, 1.2);
        hatGroup.add(cap);
    
        // 2. The Tricorn Brim (ADDED DoubleSide HERE)
        const brimGeo = new THREE.CylinderGeometry(1.8, 2.0, 0.6, 3, 1, true);
        const brimMat = new THREE.MeshStandardMaterial({ 
            color: 0x111111, 
            roughness: 0.8,
            side: THREE.DoubleSide // <--- This forces both sides to render
        });
        const brim = new THREE.Mesh(brimGeo, brimMat);
        brim.position.y = 0.3;
        brim.rotation.y = Math.PI;
        brim.scale.set(1.2, 1, 1.4);
        hatGroup.add(brim);
        
        // 2.5 Brim Bottom (Seals the open underside of the triangle brim)
        const bottomGeo = new THREE.CircleGeometry(1.8, 3); // 3 segments makes a flat triangle
        const bottom = new THREE.Mesh(bottomGeo, brimMat); // Uses the same double-sided material
        bottom.position.y = 0.01; // Sits just slightly above the bottom edge to avoid clipping
        bottom.rotation.x = Math.PI / 2; // Rotate flat so it faces down/up
        bottom.rotation.z = Math.PI / 6; // Align it with the brim's rotation
        bottom.scale.set(1.5, 1.5, 1.5); // Match the tricorn flare scaling
        hatGroup.add(bottom);
    
        // 3. Gold Trim/Edging (ADDED DoubleSide HERE)
        const trimGeo = new THREE.CylinderGeometry(1.82, 2.02, 0.1, 3, 1, true);
        const goldMat = new THREE.MeshStandardMaterial({ 
            color: 0xd4af37, 
            metalness: 0.8, 
            roughness: 0.2,
            side: THREE.DoubleSide // <--- This forces both sides to render
        });
        const goldTrim = new THREE.Mesh(trimGeo, goldMat);
        goldTrim.position.y = 0.6;
        goldTrim.rotation.y = Math.PI;
        goldTrim.scale.set(1.2, 1, 1.4);
        hatGroup.add(goldTrim);
    
        // 4. A Fancy Feather
        const featherGeo = new THREE.ConeGeometry(0.15, 1.2, 4);
        const featherMat = new THREE.MeshStandardMaterial({ color: 0xcc1111, roughness: 0.9 });
        const feather = new THREE.Mesh(featherGeo, featherMat);
        feather.position.set(-0.5, 0.8, 0.2);
        feather.rotation.z = Math.PI / 6;
        feather.rotation.x = -Math.PI / 12;
        hatGroup.add(feather);
    }

    if (type === 'propeller') {
        // Cap
        const cap = new THREE.Mesh(
            new THREE.SphereGeometry(1, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2),
            new THREE.MeshStandardMaterial({ color: 0xff0000 })
        );
        hatGroup.add(cap);

        // Propeller blades
        const bladeGeo = new THREE.BoxGeometry(2.5, 0.1, 0.4);
        const bladeMat = new THREE.MeshStandardMaterial({ color: 0xffff00 });
        const blades = new THREE.Mesh(bladeGeo, bladeMat);
        blades.position.y = 1.1;
        blades.name = "propellerBlades"; // Name it so we can spin it later!
        hatGroup.add(blades);
    }
    if (type === 'propeller_gold') {
        // Cap
        const cap = new THREE.Mesh(
            new THREE.SphereGeometry(1, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2),
            new THREE.MeshStandardMaterial({ color: 0xFFD700, metalness: 0.6, roughness: 0.2 })
        );
        hatGroup.add(cap);

        // Propeller blades
        const bladeGeo = new THREE.BoxGeometry(2.5, 0.1, 0.4);
        const bladeMat = new THREE.MeshStandardMaterial({ color: 0xFFD700, metalness: 0.6, roughness: 0.2 });
        const blades = new THREE.Mesh(bladeGeo, bladeMat);
        blades.position.y = 1.1;
        blades.name = "propellerBlades"; // Name it so we can spin it later!
        hatGroup.add(blades);
    }
    if (type === 'propeller_black') {
        // Cap
        const cap = new THREE.Mesh(
            new THREE.SphereGeometry(1, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2),
            new THREE.MeshStandardMaterial({ color: 0x000000 })
        );
        hatGroup.add(cap);

        // Propeller blades
        const bladeGeo = new THREE.BoxGeometry(2.5, 0.1, 0.4);
        const bladeMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
        const blades = new THREE.Mesh(bladeGeo, bladeMat);
        blades.position.y = 1.1;
        blades.name = "propellerBlades"; // Name it so we can spin it later!
        hatGroup.add(blades);
    }
    if (type === 'neon') {
        // 1. The Glowing Ring
        const ringGeo = new THREE.TorusGeometry(1.2, 0.1, 16, 100);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xfcff00 }); // Cyan Neon
        const ring = new THREE.Mesh(ringGeo, ringMat);
        
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 1.5;
        hatGroup.add(ring);
    
        // 2. The Actual Light Source
        // This makes the hat "glow" onto the car and floor
        const glow = new THREE.PointLight(0xfcff00, 1, 15);
        glow.position.y = 2;
        glow.decay = 2; // Real-world light falloff
        hatGroup.add(glow);
    
    }
    if (type === 'neon_silver') {
        // 1. The Glowing Ring
        const ringGeo = new THREE.TorusGeometry(1.2, 0.1, 16, 100);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff }); // Silver Neon
        const ring = new THREE.Mesh(ringGeo, ringMat);
        
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 1.5;
        hatGroup.add(ring);
    
        // 2. The Actual Light Source
        // This makes the hat "glow" onto the car and floor
        const glow = new THREE.PointLight(0xffffff, 1, 15);
        glow.position.y = 2;
        glow.decay = 2; // Real-world light falloff
        hatGroup.add(glow);
    
    }
    if (type === 'miniCar') {
        // 1. Create a full car using your existing function
        // We use "blue" to match the original look
        const miniCar = createCar("blue", "white");
    
        // 2. Scale it down significantly
        // If your normal car is size 1, 0.25 makes it a perfect little toy
        miniCar.scale.set(0.25, 0.25, 0.25);
    
        // 3. Position it so it sits on the roof
        miniCar.position.y = 0.5;
    
        hatGroup.add(miniCar);
        
        // Optional: Make the mini-car spin slowly on the roof for extra flair
        //miniCar.name = "spinningMiniCar";
    }
    
    if (type === 'police') {
        // 1. The Main Lightbar Housing
        const barGeo = new THREE.BoxGeometry(2.5, 0.5, 0.8);
        const barMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.5 });
        const lightbar = new THREE.Mesh(barGeo, barMat);
        hatGroup.add(lightbar);
    
        // 2. The Red Lens (BasicMaterial so it looks "lit")
        const redLens = new THREE.Mesh(
            new THREE.BoxGeometry(1.2, 0.6, 0.9),
            new THREE.MeshBasicMaterial({ color: 0xff0000 })
        );
        redLens.position.set(-0.6, 0.05, 0);
        lightbar.add(redLens);
    
        // 3. The Blue Lens
        const blueLens = new THREE.Mesh(
            new THREE.BoxGeometry(1.2, 0.6, 0.9),
            new THREE.MeshBasicMaterial({ color: 0x0000ff })
        );
        blueLens.position.set(0.6, 0.05, 0);
        lightbar.add(blueLens);
    
        // 4. The *Actual* Lights (PointLights)
        // We name them so we can find them and make them flash
        const redLight = new THREE.PointLight(0xff0000, 0, 15); // Start at 0 intensity
        redLight.position.set(-0.6, 0.5, 0);
        redLight.name = "copLightRed";
        lightbar.add(redLight);
    
        const blueLight = new THREE.PointLight(0x0000ff, 0, 15); // Start at 0 intensity
        blueLight.position.set(0.6, 0.5, 0);
        blueLight.name = "copLightBlue";
        lightbar.add(blueLight);
    }
    if (type === 'customSign') {
        // 1. Create a Loader for the image
        const loader = new THREE.TextureLoader();
        
        // 2. Load your image (Replace 'your-image-url.jpg' with your actual link)
        // Use a square image or a 2:1 rectangle for the best fit!
        const texture = loader.load('https://codehs.com/uploads/d525ddbb52a0df18b1052b4aba517bda');
    
        // 3. Create the sign geometry and material
        const signGeo = new THREE.BoxGeometry(2, 1.2, 0.1); // Width, Height, Thickness
        const signMat = new THREE.MeshStandardMaterial({ 
            map: texture,
            transparent: true // Useful if your image has a transparent background
        });
    
        const sign = new THREE.Mesh(signGeo, signMat);
        
        // 4. Position it upright on the roof
        sign.position.y = 0.6;
        hatGroup.add(sign);
    
        
    }
    if (type === 'potato_fire') {
        // 1. Premium Spud Materials
        const potatoMat = new THREE.MeshStandardMaterial({ color: 0x6e471b, roughness: 0.95, metalness: 0.1 });
        const magmaMat = new THREE.MeshStandardMaterial({ color: 0xff3300, emissive: 0xff2200, emissiveIntensity: 3, roughness: 0.5 });
    
        // --- STRUCTURAL SWAP BREAKTHROUGH ---
        // Create two sub-containers inside the main hat group
        const staticGroup = new THREE.Group();
        staticGroup.name = "potatoSpudStatic";
        hatGroup.add(staticGroup);
    
        const flameGroup = new THREE.Group();
        flameGroup.name = "potatoSpudFlamesGroup"; // We will target THIS for the dancing!
        hatGroup.add(flameGroup);
        // -------------------------------------
    
        // 2. Base Potato Mesh (Add to staticGroup)
        const potatoBase = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 12), potatoMat);
        potatoBase.scale.set(1.4, 0.9, 0.9); 
        potatoBase.position.y = 0.5;
        staticGroup.add(potatoBase);
    
        // 3. Molten Magma Cracks (Add to staticGroup)
        for (let i = 0; i < 3; i++) {
            const crack = new THREE.Mesh(new THREE.SphereGeometry(0.79, 8, 8), magmaMat);
            crack.scale.set(1.38, 0.89, 0.89); 
            crack.position.set(
                (Math.random() - 0.5) * 0.1,
                0.5 + (Math.random() - 0.5) * 0.05,
                (Math.random() - 0.5) * 0.1
            );
            crack.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
            staticGroup.add(crack);
        }
    
        // 4. Dynamic Flame Embers (Add to flameGroup!)
        const fireGeo = new THREE.ConeGeometry(0.25, 1.5, 8);
        const fireMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    
        for (let i = 0; i < 5; i++) {
            const flame = new THREE.Mesh(fireGeo, fireMat);
            flame.position.set(
                (Math.random() - 0.5) * 0.6,
                0.7 + Math.random() * 0.3, 
                (Math.random() - 0.5) * 0.4
            );
            flame.rotation.x = Math.PI / 4 + (Math.random() * 0.2); 
            flame.scale.set(1, 1 + Math.random() * 0.5, 1);
            flameGroup.add(flame); // Nested safely inside the moving container
        }
    
        // 5. Light Source (Add to flameGroup so the light bounces with the fire)
        const fireGlow = new THREE.PointLight(0xff4500, 3, 8);
        fireGlow.position.set(0, 1.2, 0);
        flameGroup.add(fireGlow);
    
        // Final scaling
        hatGroup.scale.set(1.3, 1.3, 1.3);
    }
    if (type === 'potato_diamond') {
        // 1. Premium Spud Materials
        const potatoMat = new THREE.MeshStandardMaterial({ 
            color: 0xB9F2FF, 
            roughness: 0.15,      // Low roughness for a shiny, glossy finish
            metalness: 0.1, 
            transparent: true,    // Enables transparency
            opacity: 0.75         // Adjust between 0.0 and 1.0 (0.75 = 75% visible)
        });
        const magmaMat = new THREE.MeshStandardMaterial({ color: 0xB9F2FF, emissive: 0xB9F2FF, emissiveIntensity: 1, roughness: 0.5 });
    
        // --- STRUCTURAL SWAP BREAKTHROUGH ---
        // Create two sub-containers inside the main hat group
        const staticGroup = new THREE.Group();
        staticGroup.name = "potatoSpudStatic";
        hatGroup.add(staticGroup);
    
        const flameGroup = new THREE.Group();
        flameGroup.name = "potatoSpudFlamesGroup"; // We will target THIS for the dancing!
        hatGroup.add(flameGroup);
        // -------------------------------------
    
        // 2. Base Potato Mesh (Add to staticGroup)
        const potatoBase = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 12), potatoMat);
        potatoBase.scale.set(1.4, 0.9, 0.9); 
        potatoBase.position.y = 0.5;
        staticGroup.add(potatoBase);
    
        // 3. Molten Magma Cracks (Add to staticGroup)
        for (let i = 0; i < 3; i++) {
            const crack = new THREE.Mesh(new THREE.SphereGeometry(0.79, 8, 8), magmaMat);
            crack.scale.set(1.38, 0.89, 0.89); 
            crack.position.set(
                (Math.random() - 0.5) * 0.1,
                0.5 + (Math.random() - 0.5) * 0.05,
                (Math.random() - 0.5) * 0.1
            );
            crack.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
            staticGroup.add(crack);
        }
    
        // 4. Dynamic Flame Embers (Add to flameGroup!)
        const fireGeo = new THREE.ConeGeometry(0.25, 1.5, 8);
        const fireMat = new THREE.MeshBasicMaterial({ color: 0xb9f2ff });
    
        for (let i = 0; i < 5; i++) {
            const flame = new THREE.Mesh(fireGeo, fireMat);
            flame.position.set(
                (Math.random() - 0.5) * 0.6,
                0.7 + Math.random() * 0.3, 
                (Math.random() - 0.5) * 0.4
            );
            flame.rotation.x = Math.PI / 4 + (Math.random() * 0.2); 
            flame.scale.set(1, 1 + Math.random() * 0.5, 1);
            flameGroup.add(flame); // Nested safely inside the moving container
        }
    
        // 5. Light Source (Add to flameGroup so the light bounces with the fire)
        const fireGlow = new THREE.PointLight(0xb9f2ff, 3, 8);
        fireGlow.position.set(0, 1.2, 0);
        flameGroup.add(fireGlow);
    
        // Final scaling
        hatGroup.scale.set(1.3, 1.3, 1.3);
    }
    if (type === 'clown_nose') {
        // A bright red shiny sphere
        const nose = new THREE.Mesh(
            new THREE.SphereGeometry(0.6, 16, 16),
            new THREE.MeshStandardMaterial({ 
                color: 0xff0000, 
                roughness: 0.1, 
                metalness: 0.1 
            })
        );
        // Position it slightly forward so it looks like a nose on the grill
        nose.position.set(0, -2, -3.2); 
        hatGroup.add(nose);
    
        // Optional: Give it a tiny subtle neon red blink/glow
        const noseLight = new THREE.PointLight(0xff0000, 1, 3);
        noseLight.position.set(0, -2, -3.2);
        hatGroup.add(noseLight);
        
        const coner = new THREE.Mesh(
            new THREE.ConeGeometry(1, 2, 16),
            new THREE.MeshStandardMaterial({ color: 0xff0000 })
        );
        coner.position.y = 1;
        coner.position.x = 1;
        coner.rotation.z = Math.PI * -0.1;
        hatGroup.add(coner);
        
        const conel = new THREE.Mesh(
            new THREE.ConeGeometry(1, 2, 16),
            new THREE.MeshStandardMaterial({ color: 0xff0000 })
        );
        conel.position.y = 1;
        conel.position.x = -1;
        conel.rotation.z = Math.PI * 0.1;
        hatGroup.add(conel);
        
        // The "Potato" base shape (flattened sphere)
        const potator = new THREE.Mesh(
            new THREE.SphereGeometry(1.1, 10, 10),
            new THREE.MeshStandardMaterial({ color: 0xff0000 })
        );
        potator.scale.set(1.3, 0.5, 1); // Make it potato-shaped
        potator.position.y = 0.2;
        hatGroup.add(potator);
    }
    if (type === 'sniper_scope') {
        // Premium materials with metallic finishes
        const metalMat = new THREE.MeshStandardMaterial({ 
            color: 0xaaaaaa, 
            metalness: 0.85, 
            roughness: 0.25 
        });
        const accentMat = new THREE.MeshStandardMaterial({ 
            color: 0xcccccc, 
            metalness: 0.7, 
            roughness: 0.4 
        });
        const lensMat = new THREE.MeshBasicMaterial({ 
            color: 0x00ff66, // Futuristic holographic green glass
            transparent: true,
            opacity: 0.85
        });
    
        // 1. Central Scope Body (The main tube)
        const bodyTube = new THREE.Mesh(
            new THREE.CylinderGeometry(0.18, 0.18, 0.8, 16),
            metalMat
        );
        bodyTube.rotation.x = Math.PI / 2;
        bodyTube.position.y = 0.6;
        hatGroup.add(bodyTube);
    
        // 2. Objective Lens Bell (The larger front cone)
        const frontCone = new THREE.Mesh(
            new THREE.CylinderGeometry(0.28, 0.18, 0.3, 16),
            metalMat
        );
        frontCone.rotation.x = Math.PI / 2;
        frontCone.position.set(0, 0.6, -0.55); // Forward
        hatGroup.add(frontCone);
    
        // Front Lens Glass Piece
        const frontGlass = new THREE.Mesh(
            new THREE.CylinderGeometry(0.25, 0.25, 0.02, 16),
            lensMat
        );
        frontGlass.rotation.x = Math.PI / 2;
        frontGlass.position.set(0, 0.6, -0.7);
        hatGroup.add(frontGlass);
    
        // 3. Ocular Lens Bell (The tapered rear eyepiece)
        const rearCone = new THREE.Mesh(
            new THREE.CylinderGeometry(0.18, 0.24, 0.25, 16),
            metalMat
        );
        rearCone.rotation.x = Math.PI / 2;
        rearCone.position.set(0, 0.6, 0.5); // Rearward
        hatGroup.add(rearCone);
    
        // Rear Eye Glass Piece
        const rearGlass = new THREE.Mesh(
            new THREE.CylinderGeometry(0.22, 0.22, 0.02, 16),
            lensMat
        );
        rearGlass.rotation.x = Math.PI / 2;
        rearGlass.position.set(0, 0.6, 0.62);
        hatGroup.add(rearGlass);
    
        // 4. Tactical Adjustment Turrets (Top & Side Caps)
        const topTurret = new THREE.Mesh(
            new THREE.CylinderGeometry(0.08, 0.08, 0.1, 12),
            accentMat
        );
        topTurret.position.set(0, 0.8, 0); // Directly on top
        hatGroup.add(topTurret);
    
        const sideTurret = new THREE.Mesh(
            new THREE.CylinderGeometry(0.08, 0.08, 0.1, 12),
            accentMat
        );
        sideTurret.rotation.z = Math.PI / 2;
        sideTurret.position.set(0.2, 0.6, 0); // On the right side
        hatGroup.add(sideTurret);
    
        // 5. Heavy-Duty Dual Mounting Brackets
        const mountGeo = new THREE.BoxGeometry(0.12, 0.45, 0.15);
        
        const frontMount = new THREE.Mesh(mountGeo, accentMat);
        frontMount.position.set(0, 0.32, -0.25);
        hatGroup.add(frontMount);
    
        const rearMount = new THREE.Mesh(mountGeo, accentMat);
        rearMount.position.set(0, 0.32, 0.25);
        hatGroup.add(rearMount);
    
        // 6. Internal Glowing Laser Components
        const internalLaser = new THREE.PointLight(0x00ff66, 2, 4);
        internalLaser.position.set(0, 0.6, -0.65); // Right behind front lens
        hatGroup.add(internalLaser);
    
        const glowBack = new THREE.PointLight(0x00ff66, 1, 2);
        glowBack.position.set(0, 0.6, 0.55); // So it glows out the back eyepiece too
        hatGroup.add(glowBack);
        
        // Uniformly scale the entire scope assembly up by 50%
        hatGroup.scale.set(1.5, 1.5, 2.5);
        
        // Slightly nudge the entire group upward to compensate for the larger base
        //hatGroup.position.y += 0.2;
    }
    if (type === 'satellite') {
        // FIX 1: Added side: THREE.DoubleSide so the inside of the bowl is solid metal!
        const metalMat = new THREE.MeshStandardMaterial({ 
            color: 0xeeeeee, 
            metalness: 0.6, 
            roughness: 0.3,
            side: THREE.DoubleSide 
        });
        const accentMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 }); 
    
        // Base stand (Stays firmly planted on the car roof, doesn't rotate)
        const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.4, 12), metalMat);
        stand.position.y = 0.35;
        stand.position.z = 0.1;
        hatGroup.add(stand);
    
        // Master container for the moving parts
        const dishGroup = new THREE.Group();
        dishGroup.name = "satelliteDishContainer";
        dishGroup.position.set(0, 1.0, 0.3); // Rotation pivot point right above the stand
        hatGroup.add(dishGroup);
    
        // FIX 2: Better alignment by keeping the dish centered locally and angling the group instead
        const dish = new THREE.Mesh(
            new THREE.SphereGeometry(0.5, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), 
            metalMat
        );
        // Face the dish open side forward locally
        dish.rotation.x = -Math.PI / 2; 
        dishGroup.add(dish);
    
        // Receiver antenna pin (Shooting perfectly straight out of the center dish floor)
        const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 8), metalMat);
        pin.position.set(0, 0, 0.2); // Push it outward along the local Z axis
        pin.rotation.x = Math.PI / 2; // Point it forward out of the dish bowl
        dishGroup.add(pin);
    
        // Little glowing indicator tip locked to the end of the pin
        const indicator = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), accentMat);
        indicator.position.set(0, 0, 0.4); // Placed right at the tip of the 0.4 length pin
        dishGroup.add(indicator);
        
        // Default cinematic tilt: Point the entire group upward toward space
        dishGroup.rotation.x = -Math.PI / 5; 
    
        // Master scale adjustment
        hatGroup.scale.set(2, 2, 2);
    }
    if (type === 'ufo') {
        // 1. Premium Sci-Fi Materials
        const metalMat = new THREE.MeshStandardMaterial({ 
            color: 0x8899a6, 
            metalness: 0.9, 
            roughness: 0.2 
        });
        const glassMat = new THREE.MeshStandardMaterial({ 
            color: 0x00ff00, 
            emissive: 0x00aaff,
            emissiveIntensity: 1,
            transparent: true, 
            opacity: 0.6 
        });
        const beamMat = new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.25,
            side: THREE.DoubleSide
        });
        const neonMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
    
        // 2. Separate Sub-Groups for Targeted Animation Tracks
        const hoverGroup = new THREE.Group();
        hoverGroup.name = "ufoHoverContainer";
        hatGroup.add(hoverGroup);
    
        const ringGroup = new THREE.Group();
        ringGroup.name = "ufoRingContainer";
        hoverGroup.add(ringGroup); // Nested inside hover so it moves up/down AND spins!
    
        // 3. Build the Base Abduction Beam (Attached to hatGroup so it doesn't bounce)
        const beamGeo = new THREE.ConeGeometry(1.2, 2.5, 16, 1, true); // Open-ended cone
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.position.y = -0.5; // Shooting down toward the car roof
        beam.rotation.x = Math.PI; // Flip it upside down
        hatGroup.add(beam);
    
        // 4. Build the Saucer Hull (Added to hoverGroup)
        const saucerDisc = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.3, 16), metalMat);
        saucerDisc.scale.set(1, 1, 0.6); // Flatten it into a disc
        saucerDisc.position.y = 1.0;
        hoverGroup.add(saucerDisc);
    
        const cockpitDome = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2), glassMat);
        cockpitDome.position.y = 1.1;
        hoverGroup.add(cockpitDome);
    
        // 5. Build the Neon Orbs Orbiting Ring (Added to ringGroup)
        for (let i = 0; i < 4; i++) {
            const orb = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), neonMat);
            const angle = (i / 4) * Math.PI * 2;
            
            // Position them symmetrically in a circle around the hull
            orb.position.set(Math.cos(angle) * 1.6, 1.0, Math.sin(angle) * 1.6);
            ringGroup.add(orb);
        }
    
        // 6. Tractor Beam Center Light Source
        const tractorLight = new THREE.PointLight(0x00ffff, 4, 6);
        tractorLight.position.set(0, 0.5, 0);
        hoverGroup.add(tractorLight);
    
        // Master scaling
        hatGroup.scale.set(1.1, 1.1, 1.1);
    }
    return hatGroup;
}

function createDecal(type) {
    const decalGroup = new THREE.Group();
    decalGroup.name = "playerDecal"; // Separate name from "playerHat"

    const loader = new THREE.TextureLoader();
    let textureUrl = '';

    if (type === 'woodDecal') textureUrl = 'https://codehs.com/uploads/517406ac73b722494e3a17758b3f5446';
    if (type === 'rectDecal') textureUrl = 'https://codehs.com/uploads/7df7a11aadc7fc5df8109582b1320698';
    if (type === 'leafDecal') textureUrl = 'https://codehs.com/uploads/85c58714b948018cef2d5847df155eb3';
    if (type === 'galaxyDecal') textureUrl = 'https://codehs.com/uploads/445bb8ee7601f9718c904d4c32c04653';
    if (type === 'hexDecal') textureUrl = 'https://codehs.com/uploads/9f077f0ed2027f67f7a5a7c11d935026';
    if (type === 'flameDecal') textureUrl = 'https://codehs.com/uploads/679d3e56af0f1ee02e561eb721b72113';
    if (type === 'corbokDecal') textureUrl = 'https://codehs.com/uploads/d525ddbb52a0df18b1052b4aba517bda';
    if (type === 'blackIceDecal') textureUrl = 'https://codehs.com/uploads/8c4f1fbafc3774703c0e78c51636dfed';
    if (type === 'brickDecal') textureUrl = 'https://codehs.com/uploads/f5db0e44b5b422bc570322a644b3b1ca';
    if (type === 'camoDecal') textureUrl = 'https://codehs.com/uploads/9d6527408f68877d0a30b32b85a88e81';
    if (type === 'dirtDecal') textureUrl = 'https://codehs.com/uploads/370c1c9a4f8e5772e8874f043260c1fe';
    if (type === 'exoticDecal') textureUrl = 'https://codehs.com/uploads/f0986561cd789a58a0dcc9af6e81fb57';
    if (type === 'illusionDecal') textureUrl = 'https://codehs.com/uploads/721afcaf84a17491b1cece506af6011d';
    if (type === 'bubbleDecal') textureUrl = 'https://codehs.com/uploads/50563309d3498e9dd6f46254da767008';
    if (type === 'ghostDecal') textureUrl = 'https://codehs.com/uploads/729c1aa5b46accba42e7d941ee64755e';
    

    if (textureUrl !== '') {
        const texture = loader.load(textureUrl);
        const decalGeo = new THREE.BoxGeometry(4.6, 2.1, 6.6); // Slightly larger than car to avoid clipping
        const decalMat = new THREE.MeshStandardMaterial({ 
            map: texture, 
            transparent: true,
            opacity: 0.6 // Optional: lets the base car color peek through
        });
        const decalMesh = new THREE.Mesh(decalGeo, decalMat);
        decalGroup.add(decalMesh);
    }
    return decalGroup;
}

let currentBoostType = 'standard_orange'; // Default

function equipBoost(boostId) {
    currentBoostType = boostId;
    localStorage.setItem('equippedBoost', boostId);
    
    // Trigger the 3D preview in the showroom!
    previewBoost(boostId);

    // Refresh UI to show the checkmark
    updateGarageUI();
    
    console.log("Boost equipped and previewed: " + boostId);
}
function previewBoost(boostId) {
    currentBoostType = boostId;

    let burstCount = 0;
    const burstInterval = setInterval(() => {
        if (showroomCar) {
            const boostPos = new THREE.Vector3();
            showroomCar.getWorldPosition(boostPos);

            const offset = new THREE.Vector3();
            showroomCar.getWorldDirection(offset);

            // --- THE FIX ---
            // If it was at the front, we flip the multiplier.
            // Change -2.5 to 2.5 (or vice versa)
            boostPos.add(offset.multiplyScalar(2.5)); 
            
            boostPos.y += 0.8;

            for(let i = 0; i < 3; i++) {
                createBoostParticle(boostPos, true, garageScene); 
            }
        }
        
        burstCount++;
        if (burstCount > 10) clearInterval(burstInterval);
    }, 50);
}
const textureLoader = new THREE.TextureLoader();
const boostTextures = {
    standard_orange: textureLoader.load('https://codehs.com/uploads/fceb7efdbf95bb2e9604cc5fb5c52f91'),
    neon_blue: textureLoader.load('https://codehs.com/uploads/3a585fd76ecd9f33926403389140477f'),
    neon_gold: textureLoader.load('https://codehs.com/uploads/1435a5002fd9649d7e648901751fe277'),
    neon_red: textureLoader.load('https://codehs.com/uploads/62f793480b79ac3ae0008a47ea8551d6'),
    void_white: textureLoader.load('https://codehs.com/uploads/b3a105151c2c450ee2568ee199ae89f6'),
    void_black: textureLoader.load('https://codehs.com/uploads/472aecbdbec7b0bb6a64e02d951e7f06'),
    ghost_white: textureLoader.load('https://codehs.com/uploads/0bab0704422e29307d576c4ee9588e35'),
    coins: textureLoader.load('https://codehs.com/uploads/56020e969c8c5bbaa9a8ac121edbbed2'),
    real: textureLoader.load('https://codehs.com/uploads/651a46bd37c1dcbf720238b5ee406ef3'),
    leaves: textureLoader.load('https://codehs.com/uploads/a2605a3b666467b9733622ede24582cd'),
    bloodst: textureLoader.load('https://codehs.com/uploads/c66c39f01d8e55e2cf622985286fdb70')
};
function createBoostParticle(carPosition, isShowroom = false, targetScene = scene, boostType = currentBoostType, emissionVelocity = null) {
    // 1. Use a flat plane instead of a sphere
    const geometry = new THREE.PlaneGeometry(3.5, 3.5); 
    
    // 2. Grab the texture based on the equipped boost
    const selectedTexture = boostTextures[boostType] || boostTextures.standard_orange;

    const material = new THREE.MeshBasicMaterial({ 
        map: selectedTexture,
        transparent: true,
        opacity: 0.8,
        depthWrite: false, // Prevents the 2D planes from "clipping" each other uglily
        //blending: THREE.AdditiveBlending // Makes the particles "glow" when they overlap
    });

    const particle = new THREE.Mesh(geometry, material);

    // 3. Position and Random Jitter
    particle.position.set(
        carPosition.x + (Math.random() - 0.5) * 0.4,
        carPosition.y + (Math.random() - 0.5) * 0.4,
        carPosition.z + (Math.random() - 0.5) * 0.4
    );

    // 4. IMPORTANT: Make the 2D plane face the camera
    const activeCamera = gameRunning ? camera1 : garageCamera;

    if (activeCamera) {
        particle.lookAt(activeCamera.position);
    }
    
    // --- THE FIX: VELOCITY ---
    // If it's the showroom, we shoot it "backwards" (positive Z-axis usually)
    // We add some randomness so it looks like a spray
    // 1. Create a vector to store the car's forward direction
    
    const direction = new THREE.Vector3();
    
    if (isShowroom && showroomCar) {
        // 2. Get the direction the showroom car is facing
        showroomCar.getWorldDirection(direction);
        
        // 3. Reverse it (so it shoots out the back) and add speed
        // If it shoots out the front, change 0.4 to -0.4
        direction.multiplyScalar(0.4); 
    } else {
        // Standard game logic (shooting backwards relative to world if car is simple)
        direction.set(0, 0, 0.05); 
    }
    particle.userData.velocity = emissionVelocity
        ? emissionVelocity.clone()
        : new THREE.Vector3(
            direction.x + (Math.random() - 0.5) * 0.1,
            direction.y + (Math.random() - 0.5) * 0.1,
            direction.z + (Math.random() - 0.5) * 0.1
        );
    
    targetScene.add(particle);

    // 5. Animation Logic
    let scale = 1.0;
    let rotation = Math.random() * Math.PI; // Random starting rotation

    const fadeOut = setInterval(() => {
        // --- THIS LINE IS THE ENGINE ---
        // Manually move the particle based on its velocity every 30ms
        particle.position.add(particle.userData.velocity);
        
        // Optional: add a little "gravity" or "drag"
        particle.userData.velocity.multiplyScalar(0.98); 

        scale -= 0.05;
        particle.scale.set(scale, scale, scale);
        particle.material.opacity -= 0.05;

        if (scale <= 0) {
            targetScene.remove(particle);
            geometry.dispose();
            material.dispose();
            clearInterval(fadeOut);
        }
    }, 30);
}
let currentExplosionType = localStorage.getItem('p1Explosion') || 'none';

const explosionTextures = {
    exp_standard: textureLoader.load('https://codehs.com/uploads/617a04e46173edafe3ccc22a05bac0c9'),
    exp_bat: textureLoader.load('https://codehs.com/uploads/f9f661297019b9e9593f6cd2d39fa77d'),
    exp_corn: textureLoader.load('https://codehs.com/uploads/55c477476a315d2cb7d99ee57ae1be75'),
    exp_supernova: textureLoader.load('https://codehs.com/uploads/64341fcc9834bddf48797901e01dfab8'),
    exp_ghost: textureLoader.load('https://codehs.com/uploads/617a04e46173edafe3ccc22a05bac0c9')
};

function equipExplosion(id) {
    currentExplosionType = id;
    localStorage.setItem('p1Explosion', id);

    updateGarageUI();
}



// ---------------- DAILY WHEEL ----------------
const WHEEL_SEGMENTS = [
    { label: '500 XP', color: '#2b6cb0', weight: 22, prize: { kind: 'xp', amount: 500 } },
    { label: 'Common Drop', color: '#6b7680', weight: 24, prize: { kind: 'crate', crate: 'common', amount: 1 } },
    { label: '1500 XP', color: '#2f855a', weight: 14, prize: { kind: 'xp', amount: 1500 } },
    { label: 'Drop Item', color: '#b7791f', weight: 10, prize: { kind: 'item' } },
    { label: '2x Common', color: '#4a5560', weight: 12, prize: { kind: 'crate', crate: 'common', amount: 2 } },
    { label: 'Rare Drop', color: '#3182ce', weight: 12, prize: { kind: 'crate', crate: 'rare', amount: 1 } },
    { label: '5000 XP', color: '#805ad5', weight: 3, prize: { kind: 'xp', amount: 5000 } },
    { label: 'Exotic Drop', color: '#d23cff', weight: 2, prize: { kind: 'crate', crate: 'exotic', amount: 1 } }
];
let wheelSpinning = false;
let wheelAngle = 0;
let wheelTestMode = false;

function canSpinWheel() {
    return wheelTestMode || localStorage.getItem('lastWheelSpinDate') !== new Date().toDateString();
}

function drawWheel() {
    const canvas = document.getElementById('wheel-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = canvas.width, r = size / 2;
    const arc = (Math.PI * 2) / WHEEL_SEGMENTS.length;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(wheelAngle);
    WHEEL_SEGMENTS.forEach((seg, i) => {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, r - 3, i * arc, (i + 1) * arc);
        ctx.closePath();
        ctx.fillStyle = seg.color;
        ctx.fill();
        ctx.strokeStyle = '#0b0f14';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.save();
        ctx.rotate(i * arc + arc / 2);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(seg.label, r - 10, 3);
        ctx.restore();
    });
    ctx.restore();
}

function refreshWheelUI() {
    const btn = document.getElementById('wheel-spin-btn');
    const status = document.getElementById('wheel-status');
    if (!btn) return;
    const ready = canSpinWheel();
    btn.disabled = wheelSpinning || !ready;
    btn.textContent = wheelTestMode ? 'SPIN (TEST)' : ready ? 'SPIN' : 'COME BACK TOMORROW';
    if (status) status.textContent = wheelTestMode ? 'Test mode: unlimited spins' : ready ? 'Free daily spin ready!' : 'Spun today';
    drawWheel();
}

function pickWheelSegment() {
    const total = WHEEL_SEGMENTS.reduce((sum, seg) => sum + seg.weight, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < WHEEL_SEGMENTS.length; i++) {
        roll -= WHEEL_SEGMENTS[i].weight;
        if (roll < 0) return i;
    }
    return 0;
}

function spinWheel() {
    if (wheelSpinning || lootOpening || !canSpinWheel()) return;
    wheelSpinning = true;
    if (!wheelTestMode) localStorage.setItem('lastWheelSpinDate', new Date().toDateString());
    refreshWheelUI();

    const index = pickWheelSegment();
    const arc = (Math.PI * 2) / WHEEL_SEGMENTS.length;
    // The pointer sits at the top (-90deg); rotate so the winning segment's center lands there
    const target = -Math.PI / 2 - (index * arc + arc / 2);
    const current = ((wheelAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const finalAngle = wheelAngle + (Math.PI * 2 * 5) + ((((target - current) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
    const startAngle = wheelAngle;
    const duration = 4500;
    const startTime = performance.now();

    function frame(now) {
        const t = Math.min(1, (now - startTime) / duration);
        const eased = 1 - Math.pow(1 - t, 4);
        wheelAngle = startAngle + (finalAngle - startAngle) * eased;
        drawWheel();
        if (t < 1) return requestAnimationFrame(frame);
        wheelSpinning = false;
        awardWheelPrize(WHEEL_SEGMENTS[index]);
        refreshWheelUI();
    }
    requestAnimationFrame(frame);
}

function awardWheelPrize(seg) {
    const prize = seg.prize;
    if (prize.kind === 'xp') {
        addXP(prize.amount);
        showMissionToast(`DAILY WHEEL: +${prize.amount} XP`);
    } else if (prize.kind === 'crate') {
        addCrate(prize.crate, prize.amount);
        showMissionToast(`DAILY WHEEL: ${seg.label}!`);
    } else if (prize.kind === 'item') {
        const result = rollDrop('common');
        if (result) presentDrop('common', result);
    }
}

(function setupWheelSecret() {
    const sequence = ['KeyC', 'KeyO', 'KeyR', 'KeyB', 'KeyO', 'KeyK'];
    let progress = 0;
    window.addEventListener('keydown', (e) => {
        const home = document.getElementById('home-section');
        if (!home || getComputedStyle(home).display === 'none') { progress = 0; return; }
        progress = e.code === sequence[progress] ? progress + 1 : (e.code === sequence[0] ? 1 : 0);
        if (progress === sequence.length) {
            progress = 0;
            wheelTestMode = !wheelTestMode;
            showMissionToast(wheelTestMode ? 'WHEEL TEST MODE: UNLIMITED SPINS' : 'WHEEL TEST MODE OFF');
            refreshWheelUI();
        }
    });
})();

// ---------------- LOOT DROPS ----------------
const LOOT_RARITIES = ['common', 'uncommon', 'rare', 'legendary', 'exotic', 'halloween'];
const RARITY_COLORS = {
    common: '#b0b8c0', uncommon: '#4cd964', rare: '#3fa7ff', legendary: '#ffb02e', exotic: '#d23cff',
    halloween: '#ff7518'
};
const CRATE_TYPES = {
    common: { label: 'Common Drop', color: '#b0b8c0', source: 'Daily quests' },
    rare: { label: 'Rare Drop', color: '#3fa7ff', source: 'Ranking up' },
    exotic: { label: 'Exotic Drop', color: '#d23cff', source: 'Every 150 levels' },
    halloween: { label: 'Halloween Drop', color: '#ff7518', source: 'Ranked wins in October', icon: '🎃' }
};
// Better drops shift the odds toward higher rarities
const CRATE_ODDS = {
    common: { common: 75, uncommon: 23, rare: 1.8, legendary: 0.19, exotic: 0.01 },
    rare: { common: 10, uncommon: 30, rare: 40, legendary: 6.5, exotic: 6.5 },
    exotic: { common: 1, uncommon: 2, rare: 3, legendary: 35, exotic: 40 },
    halloween: { halloween: 100 }
};
const EXOTIC_DROP_LEVEL_INTERVAL = 150;
const DUPLICATE_XP = { common: 100, uncommon: 250, rare: 600, legendary: 1500, exotic: 5000, halloween: 5000 };
let lootOpening = false;

function getCrates() {
    let crates = {};
    try { crates = JSON.parse(localStorage.getItem('lootCrates')) || {}; } catch (e) { crates = {}; }
    const result = {};
    Object.keys(CRATE_TYPES).forEach(type => {
        const n = Number.parseInt(crates[type], 10);
        result[type] = Number.isSafeInteger(n) && n > 0 ? n : 0;
    });
    return result;
}

function addCrate(type, count = 1) {
    if (!CRATE_TYPES[type] || count < 1) return;
    const crates = getCrates();
    crates[type] += count;
    localStorage.setItem('lootCrates', JSON.stringify(crates));
    renderLootUI();
}

function isDropOwned(id) {
    return localStorage.getItem(`secret_unlocked_${id}`) === 'true';
}

function rollDrop(crateType) {
    const pool = ALL_ITEMS.filter(item => item.isDropItem);
    const odds = CRATE_ODDS[crateType];
    const available = LOOT_RARITIES.filter(r => odds[r] > 0 && pool.some(item => item.rarity === r));
    if (!available.length) return null;

    const total = available.reduce((sum, r) => sum + (odds[r] || 0), 0);
    let roll = Math.random() * total;
    let rarity = available[available.length - 1];
    for (const r of available) {
        roll -= odds[r] || 0;
        if (roll < 0) { rarity = r; break; }
    }

    const items = pool.filter(item => item.rarity === rarity);
    const unowned = items.filter(item => !isDropOwned(item.id));
    const chosen = (unowned.length ? unowned : items)[Math.floor(Math.random() * (unowned.length || items.length))];
    return { item: chosen, duplicate: unowned.length === 0 };
}

function renderLootUI() {
    const box = document.getElementById('loot-list');
    if (!box) return;
    const crates = getCrates();
    box.innerHTML = '';
    Object.keys(CRATE_TYPES).forEach(type => {
        const info = CRATE_TYPES[type];
        const btn = document.createElement('button');
        btn.className = 'loot-crate-btn';
        btn.style.setProperty('--crate-color', info.color);
        btn.disabled = crates[type] === 0 || lootOpening;
        btn.innerHTML = `<span class="loot-crate-icon">${info.icon || '🎁'}</span>
            <span class="loot-crate-name">${info.label}</span>
            <span class="loot-crate-count">x${crates[type]}</span>
            <span class="loot-crate-source">${info.source}</span>`;
        btn.onclick = () => openCrate(type);
        box.appendChild(btn);
    });
}

function openCrate(type) {
    if (lootOpening) return;
    const crates = getCrates();
    if (!crates[type]) return;

    const result = rollDrop(type);
    if (!result) return;
    crates[type]--;
    localStorage.setItem('lootCrates', JSON.stringify(crates));
    presentDrop(type, result);
}

function presentDrop(type, result) {
    lootOpening = true;
    const { item, duplicate } = result;
    localStorage.setItem(`secret_unlocked_${item.id}`, 'true');
    const color = RARITY_COLORS[item.rarity];

    const overlay = document.createElement('div');
    overlay.className = 'loot-overlay';
    overlay.style.setProperty('--crate-color', CRATE_TYPES[type].color);
    overlay.style.setProperty('--rarity-color', color);
    overlay.innerHTML = `
        <div class="loot-rays"></div>
        <div class="loot-crate">${CRATE_TYPES[type].icon || '🎁'}</div>
        <div class="loot-flash"></div>
        <div class="loot-reveal">
            <div class="loot-rarity">${item.rarity.toUpperCase()}</div>
            <div class="loot-item-name">${item.name}</div>
            <div class="loot-item-type">${item.type.toUpperCase()}</div>
            <div class="loot-dupe">${duplicate ? `DUPLICATE: +${DUPLICATE_XP[item.rarity]} XP` : 'NEW!'}</div>
            <button class="menu-btn small loot-close">AWESOME</button>
        </div>`;
    document.body.appendChild(overlay);

    const crateEl = overlay.querySelector('.loot-crate');
    const revealEl = overlay.querySelector('.loot-reveal');
    const flashEl = overlay.querySelector('.loot-flash');
    crateEl.classList.add('shaking');
    setTimeout(() => crateEl.classList.add('shaking-hard'), 1200);
    setTimeout(() => {
        flashEl.classList.add('go');
        crateEl.style.display = 'none';
        overlay.classList.add('revealed');
        revealEl.classList.add('show');
    }, 2400);

    const close = () => {
        overlay.remove();
        lootOpening = false;
        if (duplicate) addXP(DUPLICATE_XP[item.rarity]);
        updateGarageUI();
    };
    overlay.querySelector('.loot-close').onclick = close;
}

function checkLevelDrops(oldLevel, newLevel) {
    const earned = Math.floor(newLevel / EXOTIC_DROP_LEVEL_INTERVAL) - Math.floor(oldLevel / EXOTIC_DROP_LEVEL_INTERVAL);
    if (earned > 0) {
        addCrate('exotic', earned);
        showMissionToast(`EXOTIC DROP EARNED! (Level ${Math.floor(newLevel / EXOTIC_DROP_LEVEL_INTERVAL) * EXOTIC_DROP_LEVEL_INTERVAL})`);
    }
}

function checkRankDrops(tierIndex) {
    const stored = Number.parseInt(localStorage.getItem('highestRankDropTier'), 10);
    const highest = Number.isSafeInteger(stored) ? stored : 0;
    if (tierIndex > highest) {
        addCrate('rare', tierIndex - highest);
        localStorage.setItem('highestRankDropTier', tierIndex);
        return tierIndex - highest;
    }
    return 0;
}

function updateGarageUI() {
    let currentLevel = parseInt(localStorage.getItem('playerLevel')) || 1;
    
    const hatInv = document.getElementById('inventory-hats');
    const boostInv = document.getElementById('inventory-boosts');
    const decalInv = document.getElementById('inventory-decals');
    const explosionInv = document.getElementById('inventory-explosions');
    const bpTrack = document.getElementById('battle-pass-track');
    
    updateChallengeUI(); // update challenge stats
    renderLootUI();
    // Clear current lists
    hatInv.innerHTML = '<button class="menu-btn small" onclick="equipHat(\'none\')">None</button>';
    boostInv.innerHTML = '<button class="menu-btn small" onclick="equipBoost(\'standard_orange\')">Classic</button>';
    decalInv.innerHTML = '<button class="menu-btn small" onclick="equipDecal(\'none\')">None</button>';
    explosionInv.innerHTML = '<button class="menu-btn small" onclick="equipExplosion(\'none\')">Classic</button>';
    bpTrack.innerHTML = '';

    // --- THE FIX: Sort purely by level ---
    const battlePassOrder = [...ALL_ITEMS].sort((a, b) => {
        // Treat undefined or secret levels as Infinity so they always lose numerical comparisons
        const lvlA = (a.isSecret || a.isDropItem || a.lvl === undefined) ? Infinity : a.lvl;
        const lvlB = (b.isSecret || b.isDropItem || b.lvl === undefined) ? Infinity : b.lvl;
    
        return lvlA - lvlB;
    });

    battlePassOrder.forEach(item => {
        // --- UPDATED UNLOCK LOGIC ---
        let isUnlocked = false;
        
        if (item.isSecret || item.isDropItem) {
            // If it's a secret item, check if they completed its specific challenge
            isUnlocked = localStorage.getItem(`secret_unlocked_${item.id}`) === 'true';
        } else {
            // Standard items unlock by level
            isUnlocked = currentLevel >= item.lvl;
        }
        // ----------------------------
    
        // If it's a secret item and NOT unlocked, hide it completely from the garage/BP!
        if ((item.isSecret || item.isDropItem) && !isUnlocked) return;
    
        if (isUnlocked) {
            const btn = document.createElement('button');
            btn.className = "menu-btn small unlocked";
            btn.innerText = item.name;
            
            // --- ADD THE EXPLOSION CHECK HERE ---
            btn.onclick = () => {
                if (item.type === 'hat') equipHat(item.id);
                else if (item.type === 'boost') equipBoost(item.id);
                else if (item.type === 'decal') equipDecal(item.id);
                else if (item.type === 'explosion') equipExplosion(item.id); // <--- ADD THIS
            };
            
            if (item.type === 'hat') hatInv.appendChild(btn);
            else if (item.type === 'boost') boostInv.appendChild(btn);
            else if (item.type === 'decal') decalInv.appendChild(btn);
            else if (item.type === 'explosion') explosionInv.appendChild(btn);
        }

        // 2. Add to Battle Pass (The unified scrollable track)
        const card = document.createElement('div');
        card.className = `bp-item ${isUnlocked ? 'unlocked' : 'locked'}`;
        
        // Optional: Add a label so players know if it's a Hat or Decal in the BP
        const typeLabel = `[${item.type.toUpperCase()}]`;

        card.innerHTML = `
            <span class="bp-level">Lvl ${item.lvl}</span>
            <div class="bp-name">${item.name}</div>
            <div style="font-size: 10px; color: #555; margin: 4px 0;">${typeLabel}</div>
            <div class="bp-status">${isUnlocked ? '✅ OWNED' : '🔒 LOCKED'}</div>
        `;
        bpTrack.appendChild(card);
        // Render cleaner level tags on the card layout
        const levelText = item.isDropItem ? item.rarity.toUpperCase() : (item.isSecret || item.lvl === undefined ? 'SECRET' : `Lvl ${item.lvl}`);
        
        card.innerHTML = `
            <span class="bp-level">${levelText}</span>
            <div class="bp-name">${item.name}</div>
            <div style="font-size: 10px; color: #555; margin: 4px 0;">${typeLabel}</div>
            <div class="bp-status">${isUnlocked ? '✅ OWNED' : '🔒 LOCKED'}</div>
        `;
    });
}

function updateMissionProgress(type, amount) {
    // 1. Load current progress
    let progress = JSON.parse(localStorage.getItem('challengeProgress')) || {};

    // 2. Find all challenges of this type and add progress
    activeMissions.forEach(task => {
        if (task.type === type) {
            const oldVal = progress[task.id] || 0;
            const newVal = oldVal + amount;
            
            // Logic: If it wasn't finished before, but it is now, give XP!
            if (oldVal < task.goal && newVal >= task.goal) {
                addXP(task.reward);
                addCrate('common');
                showMissionToast(`CHALLENGE COMPLETE: ${task.text} (+${task.reward} XP + Common Drop)`);
                
                // Play a sound effect here if you have one!
                // achievementSound.play(); 
            }
            
            progress[task.id] = newVal;
        }
    });

    // 3. Save and Refresh UI
    localStorage.setItem('challengeProgress', JSON.stringify(progress));
    updateChallengeUI();
}

function equipHat(hatType) {
    localStorage.setItem('p1Hat', hatType); // Save the choice

    [p1, showroomCar].forEach(car => {
        if (car) {
            // 1. Remove old hat if it exists
            const oldHat = car.getObjectByName("playerHat");
            if (oldHat) car.remove(oldHat);

            // 2. Add the new hat
            if (hatType !== 'none') {
                const newHat = createHat(hatType);
                
                // Position it on the roof of the cabin
                // Based on your car dimensions: cabin is at y=2
                newHat.position.set(0, 2.5, -0.5); 
                car.add(newHat);
            }
        }
    });
}
function showMissionToast(text) {
    const toast = document.getElementById('mission-toast');
    toast.innerText = text;
    toast.style.top = "20px"; // Slide down

    setTimeout(() => {
        toast.style.top = "-100px"; // Slide back up
    }, 3000);
}

// variables needed for challenges
let lastHitPosition = new THREE.Vector3();
let lastHitter = null; // Can be 'player' or 'ai'
// for hot potato
const clock = new THREE.Clock();
let possessionTimer = 0;
const POINT_TICK_RATE = 1.0; // 1 second
// --- ABDUCTION QUEST STATE ENGINE ---
let abductionTimer = 0;
let isBeingAbducted = false;
let abductionBeamMesh = null;
let hasUfoUnlocked = false;


function equipDecal(decalType) {
    localStorage.setItem('p1Decal', decalType);

    [p1, showroomCar].forEach(car => {
        if (car) {
            // Remove ONLY the decal
            const oldDecal = car.getObjectByName("playerDecal");
            if (oldDecal) car.remove(oldDecal);

            if (decalType !== 'none') {
                const newDecal = createDecal(decalType);
                // Position it to wrap the car body
                newDecal.position.set(0, 0.5, 0); 
                car.add(newDecal);
            }
        }
    });
}
const skyLoader = new THREE.TextureLoader();
// night : https://codehs.com/uploads/445bb8ee7601f9718c904d4c32c04653
const night = skyLoader.load('https://codehs.com/uploads/445bb8ee7601f9718c904d4c32c04653'); 
const day = skyLoader.load('https://codehs.com/uploads/7ef0867b0ce3bd8c6eb4b93e69a4da6e'); 

const tod = Math.random() > 0.5 ? day : night;

const skyTexture = tod; 

const skyGeo = new THREE.SphereGeometry(500, 25, 25);
const skyMat = new THREE.MeshBasicMaterial({
    map: skyTexture,
    side: THREE.BackSide // CRITICAL: This renders the texture on the INSIDE of the sphere
});

const sky = new THREE.Mesh(skyGeo, skyMat);
scene.add(sky);

function createWheel(x, z) {
    const wheelGeom = new THREE.CylinderGeometry(1, 1, 1, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const wheel = new THREE.Mesh(wheelGeom, wheelMat);
    wheel.rotation.z = Math.PI / 2; // Flip cylinder on its side
    wheel.position.set(x, 0, z);
    return wheel;
}

p1.add(createWheel(2.3, 2));   // Front Right
p1.add(createWheel(-2.3, 2));  // Front Left
p1.add(createWheel(2.3, -2));  // Back Right
p1.add(createWheel(-2.3, -2)); // Back Left

function createWall(w, h, d, x, z, wallColor = 0xffffff) { // added wallColor
    const wall = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshPhongMaterial({ 
            color: wallColor, // use the parameter here
            transparent: true, 
            opacity: 0.65 
        })
    );
    wall.position.set(x, h/2, z);
    scene.add(wall);
}
createWall(400, 15, 1, 0, 120);  // North
createWall(400, 15, 1, 0, -120); // South

createWall(1, 15, 100, -200, 70);  // Upper segment
createWall(1, 15, 100, -200, -70); // Lower segment

createWall(1, 15, 100, 200, 70);   // Upper segment
createWall(1, 15, 100, 200, -70);  // Lower segment

const boostLight = new THREE.PointLight(0x00ffff, 0, 10);
scene.add(boostLight);

const ballArrow = new THREE.Mesh(new THREE.ConeGeometry(1, 3, 4), new THREE.MeshBasicMaterial({ color: 0xffff00 }));
ballArrow.rotation.x = Math.PI;
scene.add(ballArrow);

const blueGoalZone = new THREE.Box3(
    new THREE.Vector3(-215, 0, -20), 
    new THREE.Vector3(-200, 20, 20)
);
const orangeGoalZone = new THREE.Box3(
    new THREE.Vector3(200, 0, -20), 
    new THREE.Vector3(215, 20, 20)
);
const blueHelper = new THREE.Box3Helper(blueGoalZone, 0x3498db);
scene.add(blueHelper);
const orangeHelper = new THREE.Box3Helper(orangeGoalZone, 0xe67e22);
scene.add(orangeHelper);
const keys = {};
let ballCam = false;
let cameraTarget = new THREE.Vector3(0, 0, 0);
const aspect = (window.innerWidth / 2) / window.innerHeight;
let camera = camera1;

function render() {
    
    if (currentMode !== 'split' && currentMode !== '2v2_coop') {
        renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
        renderer.setScissorTest(false);
        if (p1) updateCamera(camera1, p1, p1SmoothQuat, p1Juice);
        renderer.render(scene, camera1);
        
    } else {
        renderer.setScissorTest(true);
        renderer.setViewport(0, 0, window.innerWidth / 2, window.innerHeight);
        renderer.setScissor(0, 0, window.innerWidth / 2, window.innerHeight);
        if (p1) updateCamera(camera1, p1, p1SmoothQuat, p1Juice);
        renderer.render(scene, camera1);
        renderer.setViewport(window.innerWidth / 2, 0, window.innerWidth / 2, window.innerHeight);
        renderer.setScissor(window.innerWidth / 2, 0, window.innerWidth / 2, window.innerHeight);
        
        if (p2) {
            updateCamera(camera2, p2, p2SmoothQuat, p2Juice);
            renderer.render(scene, camera2);
        } else {
            updateCamera(camera2, p1, p2SmoothQuat, p2Juice);
            renderer.render(scene, camera2);
        }
    }
}



let isGoalScored = false;
let jumpsLeft = 2; // Allows for a jump and a double jump
let dashParticles = [];
let explosionParticles = [];
const GOAL_COLORS = { blue: 0x00ffff, orange: 0xffa500 };
let score = [0, 0];
// --- SETTINGS: KEYBINDS & CAMERA ---
const DEFAULT_BINDS = {
    forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
    boost: 'ShiftLeft', drift: 'KeyC', jump: 'Space', reset: 'KeyR', ballCam: 'KeyF'
};
const BIND_LABELS = {
    forward: 'Accelerate', back: 'Brake / Reverse', left: 'Steer Left', right: 'Steer Right',
    boost: 'Boost', drift: 'Drift', jump: 'Jump / Flip', reset: 'Reset Car', ballCam: 'Ball Cam'
};
const DEFAULT_CAM = { height: 7, distance: 22, fov: 0 };
let keyBinds = Object.assign({}, DEFAULT_BINDS, JSON.parse(localStorage.getItem('keyBinds') || '{}'));
let camSettings = Object.assign({}, DEFAULT_CAM, JSON.parse(localStorage.getItem('camSettings') || '{}'));
let rebindingAction = null;

// Translate a physical key into the default code the game logic reads
function remapKey(code) {
    for (const action in keyBinds) {
        if (keyBinds[action] === code) return DEFAULT_BINDS[action];
    }
    // A default key whose action was moved elsewhere does nothing
    for (const action in DEFAULT_BINDS) {
        if (DEFAULT_BINDS[action] === code && keyBinds[action] !== code) return 'Unbound_' + code;
    }
    return code;
}

window.addEventListener('keydown', (e) => {
    if (rebindingAction) {
        e.preventDefault();
        if (e.code !== 'Escape') {
            for (const a in keyBinds) if (keyBinds[a] === e.code) keyBinds[a] = keyBinds[rebindingAction];
            keyBinds[rebindingAction] = e.code;
            localStorage.setItem('keyBinds', JSON.stringify(keyBinds));
        }
        rebindingAction = null;
        renderKeybindList();
        return;
    }
    const code = remapKey(e.code);
    keys[code] = true;
    
    // Safety for M key
    if (e.key.toLowerCase() === 'm') keys['KeyM'] = true;
    
    if (e.code === 'Slash') e.preventDefault(); 

    if (code === 'KeyF' && !e.repeat && !/INPUT|TEXTAREA/.test(e.target.tagName)) {
        ballCam = !ballCam;
    }
});
window.addEventListener('keyup', (e) => { keys[remapKey(e.code)] = false; });

function keyLabel(code) {
    return code.replace(/^Key/, '').replace(/^Digit/, '').replace('Arrow', '↔ ').replace('ShiftLeft', 'Left Shift')
        .replace('ShiftRight', 'Right Shift').replace('ControlLeft', 'Left Ctrl').replace('ControlRight', 'Right Ctrl');
}

function renderKeybindList() {
    const list = document.getElementById('keybind-list');
    if (!list) return;
    list.innerHTML = '';
    for (const action in DEFAULT_BINDS) {
        const row = document.createElement('div');
        row.className = 'settings-row';
        const label = document.createElement('span');
        label.textContent = BIND_LABELS[action];
        const btn = document.createElement('button');
        btn.className = 'menu-btn small';
        btn.textContent = rebindingAction === action ? 'Press a key...' : keyLabel(keyBinds[action]);
        btn.onclick = () => { rebindingAction = action; renderKeybindList(); };
        row.append(label, btn);
        list.appendChild(row);
    }
}

function updateCamSetting(name, value) {
    camSettings[name] = Number(value);
    localStorage.setItem('camSettings', JSON.stringify(camSettings));
    const out = document.getElementById('cam-' + name + '-value');
    if (out) out.textContent = value;
}

function syncCamSliders() {
    for (const name in camSettings) {
        const input = document.getElementById('cam-' + name);
        if (input) input.value = camSettings[name];
        const out = document.getElementById('cam-' + name + '-value');
        if (out) out.textContent = camSettings[name];
    }
}

function resetSettings() {
    keyBinds = Object.assign({}, DEFAULT_BINDS);
    camSettings = Object.assign({}, DEFAULT_CAM);
    localStorage.removeItem('keyBinds');
    localStorage.removeItem('camSettings');
    renderKeybindList();
    syncCamSliders();
}

function showSettings() {
    document.getElementById('home-section').style.display = 'none';
    document.getElementById('settings-selection').style.display = 'block';
    renderKeybindList();
    syncCamSliders();
}

function createStadiumLight(x, z) {
    const poleGeo = new THREE.CylinderGeometry(0.5, 0.5, 40);
    const poleMat = new THREE.MeshPhongMaterial({ color: 0x333333 });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(x, 20, z);
    scene.add(pole);

    const light = new THREE.PointLight(0xffffff, 1, 100);
    light.position.set(x, 40, z);
    scene.add(light);
    
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(2), new THREE.MeshBasicMaterial({color: 0xffffff}));
    bulb.position.set(x, 40, z);
    scene.add(bulb);
}

createStadiumLight(200, 120);
createStadiumLight(-200, 120);
createStadiumLight(200, -120);
createStadiumLight(-200, -120);

function fullReset() {
    refillBoost();
    if (currentMode === 'online' && onlineRole === 'p1' && onlineGameStarted) {
        onlineResetSequence++;
        onlineGoalEvent = null;
    }

    // 1. Reset Ball Physics & Appearance
    ball.position.set(0, 5, 0);
    ballVel.set(0, 0, 0);
    lastHitPosition.set(0, 0, 0);
    
    ball.material.color.setHex(0xffffff);
    if (ball.material.emissive) {
        ball.material.emissive.setHex(0x000000); // Turn off emission glow
    }
    lastHitter = null;
    ball.visible = true;

    // 2. Mode-Based Car Kickoff Grid
    if (currentMode === '2v2_ai') {
        // --- 2V2 KICKOFF POSITIONS ---
        
        // Player 1 (Blue Left)
        p1.position.set(SPOTS_2V2.p1.x, 1, SPOTS_2V2.p1.z);
        p1.rotation.y = SPOTS_2V2.p1.rot;
        if (typeof p1Vel !== 'undefined') p1Vel.set(0, 0, 0);
        p1SmoothQuat.copy(p1.quaternion);

        // Teammate Bot (Blue Right)
        if (p1Teammate) {
            p1Teammate.position.set(SPOTS_2V2.p1Teammate.x, 1, SPOTS_2V2.p1Teammate.z);
            p1Teammate.rotation.y = SPOTS_2V2.p1Teammate.rot;
            p1TeammateVel.set(0, 0, 0);
        }

        // Enemy Bot 1 (Orange Left)
        if (p2) {
            p2.position.set(SPOTS_2V2.p2.x, 1, SPOTS_2V2.p2.z);
            p2.rotation.y = SPOTS_2V2.p2.rot;
            p2Vel.set(0, 0, 0);
            p2SmoothQuat.copy(p2.quaternion);
        }

        // Enemy Bot 2 (Orange Right)
        if (p3) {
            p3.position.set(SPOTS_2V2.p3.x, 1, SPOTS_2V2.p3.z);
            p3.rotation.y = SPOTS_2V2.p3.rot;
            p3Vel.set(0, 0, 0);
        }

    } else if (currentMode === 'online') {
        setOnlineKickoffPositions();
    } else {
        // --- STANDARD 1V1 / SOLO KICKOFF POSITIONS ---
        
        // Reset Player 1
        p1.position.set(-60, 1, 0);
        if (typeof p1Vel !== 'undefined') p1Vel.set(0, 0, 0);
        p1.rotation.y = -Math.PI / 2.001; // Avoid goal farming offset
        p1SmoothQuat.copy(p1.quaternion);
        
        // Reset Player 2 / 1v1 Bot
        if (p2) {
            p2.position.set(60, 1, 0);
            p2Vel.set(0, 0, 0);
            p2.rotation.y = currentMode === 'split' ? Math.PI / 2 : Math.PI;
            p2SmoothQuat.copy(p2.quaternion);
        }
    }
}

function celebrate(text) {
    const banner = document.createElement('div');
    banner.style = "position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); font-size:60px; font-weight:bold; color:yellow; text-shadow:4px 4px 0px black; pointer-events:none;";
    banner.innerText = text;
    document.body.appendChild(banner);
    setTimeout(() => document.body.removeChild(banner), 2000);
}
function createDashTrail() {
    for (let i = 0; i < 10; i++) {
        const pGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        const pMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 1 });
        const p = new THREE.Mesh(pGeo, pMat);
        
        p.position.copy(p1.position);
        p.position.x += (Math.random() - 0.5) * 2;
        p.position.z += (Math.random() - 0.5) * 2;
        
        scene.add(p);
        dashParticles.push({ mesh: p, life: 1.0 });
    }
}

function updateParticles() {
    for (let i = dashParticles.length - 1; i >= 0; i--) {
        let p = dashParticles[i];
        p.life -= 0.02;
        p.mesh.material.opacity = p.life;
        p.mesh.scale.set(p.life, p.life, p.life);
        
        if (p.life <= 0) {
            scene.remove(p.mesh);
            dashParticles.splice(i, 1);
        }
    }
    for (let i = explosionParticles.length - 1; i >= 0; i--) {
        let p = explosionParticles[i];
        
        if (p.isFireball) {
            // Unique Fireball behavior: Grow huge then vanish
            p.mesh.scale.multiplyScalar(1.15);
            p.life -= 0.015;
            p.mesh.material.opacity = p.life;
        } else {
            // Your standard movement logic
            p.mesh.position.add(p.vel);
            p.vel.y -= 0.02; 
            p.life -= 0.01;
            p.mesh.material.opacity = p.life;
            p.mesh.scale.multiplyScalar(0.98);
        }
        
        // Simplified: Only look at the main game camera
        if (p.isTextured) {
            p.mesh.lookAt(camera1.position);
        }
        
        if (p.life <= 0) {
            scene.remove(p.mesh); // Only need to remove from main scene now
            p.mesh.geometry.dispose();
            p.mesh.material.dispose();
            explosionParticles.splice(i, 1);
        }
    }
}

function createGoalExplosion(x, z, explosionType) {
    const isBlueGoal = x < -150;
    const type = normalizeOnlineExplosionType(explosionType ?? currentExplosionType);
    const texture = explosionTextures[type];
    const isOrangeSide = x > 0;
    const useEquippedExplosion = currentMode === 'online' || !isBlueGoal;

    // --- STYLE A: THE SUPERNOVA (Upgraded) ---
    if (useEquippedExplosion && type === 'exp_supernova') {
        const coreColor = 0x800080; // Deep Purple
        const accentColor = 0xff00ff; // Bright Magenta/Pink

        // 1. THE MAIN CORE
        const pGeo = new THREE.SphereGeometry(1, 32, 32);
        const pMat = new THREE.MeshStandardMaterial({ 
            color: coreColor, 
            emissive: coreColor, 
            emissiveIntensity: 8,
            transparent: true 
        });
        const ball = new THREE.Mesh(pGeo, pMat);
        ball.position.set(x, 5, z);
        scene.add(ball);

        explosionParticles.push({
            mesh: ball,
            vel: new THREE.Vector3(0, 0, 0),
            life: 1.0,
            isFireball: true 
        });

        // 2. THE COSMIC RING (The "Saturn" Effect)
        // We spawn 20-30 flat planes in a circle that scale outward
        for (let i = 0; i < 30; i++) {
            const angle = (i / 30) * Math.PI * 2;
            const rGeo = new THREE.PlaneGeometry(4, 4);
            const rMat = new THREE.MeshBasicMaterial({
                color: accentColor,
                transparent: true,
                opacity: 0.8,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            const ringPart = new THREE.Mesh(rGeo, rMat);
            
            // Position them in a ring around the center
            ringPart.position.set(x, 5, z);
            
            // Rotate them to lie flat and face outward
            ringPart.rotation.x = Math.PI / 2;
            ringPart.rotation.z = angle;

            scene.add(ringPart);

            // Give them a "radial" velocity (moving away from center)
            const speed = 1.5;
            explosionParticles.push({
                mesh: ringPart,
                vel: new THREE.Vector3(Math.cos(angle) * speed, 0, Math.sin(angle) * speed),
                life: 1.0,
                isRing: true // We'll add a quick scale-up for this in updateParticles
            });
        }
        
        // 3. THE CENTER FLASH (A small, bright white sphere that disappears instantly)
        const flashGeo = new THREE.SphereGeometry(2, 16, 16);
        const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const flash = new THREE.Mesh(flashGeo, flashMat);
        flash.position.set(x, 5, z);
        scene.add(flash);
        setTimeout(() => scene.remove(flash), 100); 
    }
    
    if (useEquippedExplosion && type === 'exp_supernovawhite') {
        const coreColor = 0x000000; // black
        const accentColor = 0xffffff; // white

        // 1. THE MAIN CORE
        const pGeo = new THREE.SphereGeometry(1, 32, 32);
        const pMat = new THREE.MeshStandardMaterial({ 
            color: coreColor, 
            emissive: coreColor, 
            emissiveIntensity: 8,
            transparent: true 
        });
        const ball = new THREE.Mesh(pGeo, pMat);
        ball.position.set(x, 5, z);
        scene.add(ball);

        explosionParticles.push({
            mesh: ball,
            vel: new THREE.Vector3(0, 0, 0),
            life: 1.0,
            isFireball: true 
        });

        // 2. THE COSMIC RING (The "Saturn" Effect)
        // We spawn 20-30 flat planes in a circle that scale outward
        for (let i = 0; i < 80; i++) {
            const angle = (i / 80) * Math.PI * 2;
            const rGeo = new THREE.PlaneGeometry(4, 4);
            const rMat = new THREE.MeshBasicMaterial({
                color: accentColor,
                transparent: true,
                opacity: 0.8,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            const ringPart = new THREE.Mesh(rGeo, rMat);
            
            // Position them in a ring around the center
            ringPart.position.set(x, 5, z);
            
            // Rotate them to lie flat and face outward
            ringPart.rotation.x = Math.PI / 2;
            ringPart.rotation.z = angle;

            scene.add(ringPart);

            // Give them a "radial" velocity (moving away from center)
            const speed = 1.5;
            explosionParticles.push({
                mesh: ringPart,
                vel: new THREE.Vector3(Math.cos(angle) * speed, 0, Math.sin(angle) * speed),
                life: 1.0,
                isRing: true // We'll add a quick scale-up for this in updateParticles
            });
        }
        
        // 3. THE CENTER FLASH (A small, bright white sphere that disappears instantly)
        const flashGeo = new THREE.SphereGeometry(2, 16, 16);
        const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const flash = new THREE.Mesh(flashGeo, flashMat);
        flash.position.set(x, 5, z);
        scene.add(flash);
        setTimeout(() => scene.remove(flash), 100); 
    }
    if (useEquippedExplosion && type === 'exp_supernovared') {
        const coreColor = 0x000000; // black
        const accentColor = 0xff0000; // red

        // 1. THE MAIN CORE
        const pGeo = new THREE.SphereGeometry(1, 32, 32);
        const pMat = new THREE.MeshStandardMaterial({ 
            color: accentColor, 
            emissive: coreColor, 
            emissiveIntensity: 8,
            transparent: true 
        });
        const ball = new THREE.Mesh(pGeo, pMat);
        ball.position.set(x, 5, z);
        scene.add(ball);

        explosionParticles.push({
            mesh: ball,
            vel: new THREE.Vector3(0, 0, 0),
            life: 1.0,
            isFireball: true 
        });

        // 2. THE COSMIC RING (The "Saturn" Effect)
        // We spawn 20-30 flat planes in a circle that scale outward
        for (let i = 0; i < 80; i++) {
            const angle = (i / 80) * Math.PI * 2;
            const rGeo = new THREE.PlaneGeometry(4, 4);
            const rMat = new THREE.MeshBasicMaterial({
                color: accentColor,
                transparent: true,
                opacity: 1.0,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            const ringPart = new THREE.Mesh(rGeo, rMat);
            
            // Position them in a ring around the center
            ringPart.position.set(x, 5, z);
            
            // Rotate them to lie flat and face outward
            ringPart.rotation.x = Math.PI / 2;
            ringPart.rotation.z = angle;

            scene.add(ringPart);

            // Give them a "radial" velocity (moving away from center)
            const speed = 1.5;
            explosionParticles.push({
                mesh: ringPart,
                vel: new THREE.Vector3(Math.cos(angle) * speed, 0, Math.sin(angle) * speed),
                life: 1.0,
                isRing: true // We'll add a quick scale-up for this in updateParticles
            });
        }
        
        // 3. THE CENTER FLASH (A small, bright white sphere that disappears instantly)
        const flashGeo = new THREE.SphereGeometry(2, 16, 16);
        const flashMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const flash = new THREE.Mesh(flashGeo, flashMat);
        flash.position.set(x, 5, z);
        scene.add(flash);
        setTimeout(() => scene.remove(flash), 100); 
    }
    if (useEquippedExplosion && type === 'exp_diamond') {

        // Replaced Deep Purple & Magenta with Light Blue variants
        const coreColor = 0x00BFFF;   // Deep Light Blue (Deep Sky Blue)
        const accentColor = 0x87CEFA; // Bright Soft Light Blue (Light Sky Blue)

        // 1. THE MAIN CORE (Pavilion Facet Diamond Shape)
        // OctahedronGeometry gives a diamond/double-pyramid faceted shape instead of a Sphere
        const pGeo = new THREE.OctahedronGeometry(1.5, 0); 
        const pMat = new THREE.MeshStandardMaterial({ 
            color: coreColor, 
            emissive: coreColor, 
            emissiveIntensity: 8,
            flatShading: true, // Highlights the facets of the diamond shape
            transparent: true 
        });
        const ball = new THREE.Mesh(pGeo, pMat);
        ball.position.set(x, 5, z);
        scene.add(ball);

        explosionParticles.push({
            mesh: ball,
            vel: new THREE.Vector3(0, 0, 0),
            life: 1.0,
            isFireball: true 
        });

        // 2. THE COSMIC RING (The "Saturn" Effect)
        // We spawn 20-30 flat planes in a circle that scale outward
        for (let i = 0; i < 30; i++) {
            const angle = (i / 30) * Math.PI * 2;
            const rGeo = new THREE.PlaneGeometry(4, 4);
            const rMat = new THREE.MeshBasicMaterial({
                color: accentColor,
                transparent: true,
                opacity: 0.8,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            const ringPart = new THREE.Mesh(rGeo, rMat);
            
            // Position them in a ring around the center
            ringPart.position.set(x, 5, z);
            
            // Rotate them to lie flat and face outward
            ringPart.rotation.x = Math.PI / 2;
            ringPart.rotation.z = angle;

            scene.add(ringPart);

            // Give them a "radial" velocity (moving away from center)
            const speed = 1.5;
            explosionParticles.push({
                mesh: ringPart,
                vel: new THREE.Vector3(Math.cos(angle) * speed, 0, Math.sin(angle) * speed),
                life: 1.0,
                isRing: true // We'll add a quick scale-up for this in updateParticles
            });
        }
        
        // 3. THE CENTER FLASH
        // Changed flash geometry from sphere to diamond shape as well
        const flashGeo = new THREE.OctahedronGeometry(2.5, 0);
        const flashMat = new THREE.MeshBasicMaterial({ color: 0xE0FFFF }); // Light Cyan/White flash
        const flash = new THREE.Mesh(flashGeo, flashMat);
        flash.position.set(x, 5, z);
        scene.add(flash);
        setTimeout(() => scene.remove(flash), 100); 
    }
    if (useEquippedExplosion && type === 'exp_real') {

        // Replaced Deep Purple & Magenta with Light Blue variants
        const coreColor = 0x01ff01;   // real color
        const accentColor = 0x008000; // green color

        // 1. THE MAIN CORE (Pavilion Facet Diamond Shape)
        // OctahedronGeometry gives a diamond/double-pyramid faceted shape instead of a Sphere
        const pGeo = new THREE.OctahedronGeometry(1.5, 0); 
        const pMat = new THREE.MeshStandardMaterial({ 
            color: coreColor, 
            emissive: coreColor, 
            emissiveIntensity: 8,
            flatShading: true, // Highlights the facets of the diamond shape
            transparent: true 
        });
        const ball = new THREE.Mesh(pGeo, pMat);
        ball.position.set(x, 5, z);
        scene.add(ball);

        explosionParticles.push({
            mesh: ball,
            vel: new THREE.Vector3(0, 0, 0),
            life: 1.0,
            isFireball: true 
        });

        // 2. THE COSMIC RING (The "Saturn" Effect)
        // We spawn 20-30 flat planes in a circle that scale outward
        for (let i = 0; i < 30; i++) {
            const angle = (i / 30) * Math.PI * 2;
            const rGeo = new THREE.PlaneGeometry(4, 4);
            const rMat = new THREE.MeshBasicMaterial({
                color: accentColor,
                transparent: true,
                opacity: 0.8,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            const ringPart = new THREE.Mesh(rGeo, rMat);
            
            // Position them in a ring around the center
            ringPart.position.set(x, 5, z);
            
            // Rotate them to lie flat and face outward
            ringPart.rotation.x = Math.PI / 2;
            ringPart.rotation.z = angle;

            scene.add(ringPart);

            // Give them a "radial" velocity (moving away from center)
            const speed = 1.5;
            explosionParticles.push({
                mesh: ringPart,
                vel: new THREE.Vector3(Math.cos(angle) * speed, 0, Math.sin(angle) * speed),
                life: 1.0,
                isRing: true // We'll add a quick scale-up for this in updateParticles
            });
        }
        
        // 3. THE CENTER FLASH
        // Changed flash geometry from sphere to diamond shape as well
        const flashGeo = new THREE.OctahedronGeometry(2.5, 0);
        const flashMat = new THREE.MeshBasicMaterial({ color: 0x01ff01 }); // real flash
        const flash = new THREE.Mesh(flashGeo, flashMat);
        flash.position.set(x, 5, z);
        scene.add(flash);
        setTimeout(() => scene.remove(flash), 100); 
    }
    // --- STYLE B: THE TWIN SERPENTS (with Initial Blast) ---
    else if (useEquippedExplosion && type === 'exp_ghost') {
        // 1. THE INITIAL BLAST: Spawn two expanding spheres immediately
        const colors = [0x0088ff, 0xe6005c]; // Blue and Pink
        colors.forEach((col, index) => {
            const bGeo = new THREE.SphereGeometry(2, 32, 32);
            const bMat = new THREE.MeshStandardMaterial({ 
                color: col, 
                emissive: col, 
                emissiveIntensity: 4,
                transparent: true,
                opacity: 1.0
            });
            const shockwave = new THREE.Mesh(bGeo, bMat);
            
            // Offset them slightly so they aren't perfectly Z-fighting
            shockwave.position.set(x, 5, z + (index === 0 ? 2 : -2));
            scene.add(shockwave);

            explosionParticles.push({
                mesh: shockwave,
                vel: new THREE.Vector3(0, 0, 0),
                life:0.6,
                isFireball: true // This uses your existing expansion logic!
            });
        });

        // 2. THE SERPENTS: (Your existing serpent interval)
        let count = 0;
        const serpentInterval = setInterval(() => {
            const time = count * 0.3;
            const waveX = Math.sin(time) * 6;
            const waveY = Math.cos(time) * 4;
            
            const forwardDir = isOrangeSide ? -count : count;
            const spawnX = x + (forwardDir * 1.5);
            const spawnY = 5 + (count * 1.2);

            const spawnSegment = (color, offsetMult) => {
                const pGeo = new THREE.SphereGeometry(3, 8, 8);
                const pMat = new THREE.MeshStandardMaterial({ 
                    color: color, 
                    transparent: true, 
                    opacity: 0.8,
                    emissive: color,
                    emissiveIntensity: 1.5
                });
                const p = new THREE.Mesh(pGeo, pMat);
                p.position.set(spawnX, spawnY + (waveY * offsetMult), z + (waveX * offsetMult));
                
                scene.add(p);
                explosionParticles.push({ 
                    mesh: p, 
                    vel: new THREE.Vector3(0, 0.05, 0), 
                    life: 1.2 
                });
            };

            spawnSegment(0x0088ff, 1);  // Blue
            spawnSegment(0xe6005c, -1); // Pink

            count++;
            if (count > 25) clearInterval(serpentInterval);
        }, 60);
    }
    
    else if (useEquippedExplosion && type === 'exp_goldduel') {
        // 1. THE INITIAL BLAST: Spawn two expanding spheres immediately
        const colors = [0xFFD700, 0xD3AF37]; // Blue and Pink
        colors.forEach((col, index) => {
            const bGeo = new THREE.SphereGeometry(2, 32, 32);
            const bMat = new THREE.MeshStandardMaterial({ 
                color: col, 
                emissive: col, 
                emissiveIntensity: 4,
                transparent: true,
                opacity: 1.0
            });
            const shockwave = new THREE.Mesh(bGeo, bMat);
            
            // Offset them slightly so they aren't perfectly Z-fighting
            shockwave.position.set(x, 5, z + (index === 0 ? 2 : -2));
            scene.add(shockwave);

            explosionParticles.push({
                mesh: shockwave,
                vel: new THREE.Vector3(0, 0, 0),
                life:0.6,
                isFireball: true // This uses your existing expansion logic!
            });
        });

        // 2. THE SERPENTS: (Your existing serpent interval)
        let count = 0;
        const serpentInterval = setInterval(() => {
            const time = count * 0.3;
            const waveX = Math.sin(time) * 6;
            const waveY = Math.cos(time) * 4;
            
            const forwardDir = isOrangeSide ? -count : count;
            const spawnX = x + (forwardDir * 1.5);
            const spawnY = 5 + (count * 1.2);

            const spawnSegment = (color, offsetMult) => {
                const pGeo = new THREE.SphereGeometry(3, 8, 8);
                const pMat = new THREE.MeshStandardMaterial({ 
                    color: color, 
                    transparent: true, 
                    opacity: 0.8,
                    emissive: color,
                    emissiveIntensity: 1.5
                });
                const p = new THREE.Mesh(pGeo, pMat);
                p.position.set(spawnX, spawnY + (waveY * offsetMult), z + (waveX * offsetMult));
                
                scene.add(p);
                explosionParticles.push({ 
                    mesh: p, 
                    vel: new THREE.Vector3(0, 0.05, 0), 
                    life: 1.2 
                });
            };

            spawnSegment(0xFFD700, 1);  // Blue
            spawnSegment(0xD3AF37, -1); // Pink

            count++;
            if (count > 25) clearInterval(serpentInterval);
        }, 60);
    }
    else if (useEquippedExplosion && type === 'exp_whiteduel') {
        // 1. THE INITIAL BLAST: Spawn two expanding spheres immediately
        const colors = [0x000000, 0xFFFFFF]; // Blue and Pink
        colors.forEach((col, index) => {
            const bGeo = new THREE.SphereGeometry(2, 32, 32);
            const bMat = new THREE.MeshStandardMaterial({ 
                color: col, 
                emissive: col, 
                emissiveIntensity: 4,
                transparent: true,
                opacity: 1.0
            });
            const shockwave = new THREE.Mesh(bGeo, bMat);
            
            // Offset them slightly so they aren't perfectly Z-fighting
            shockwave.position.set(x, 5, z + (index === 0 ? 2 : -2));
            scene.add(shockwave);

            explosionParticles.push({
                mesh: shockwave,
                vel: new THREE.Vector3(0, 0, 0),
                life:0.6,
                isFireball: true // This uses your existing expansion logic!
            });
        });

        // 2. THE SERPENTS: (Your existing serpent interval)
        let count = 0;
        const serpentInterval = setInterval(() => {
            const time = count * 0.3;
            const waveX = Math.sin(time) * 6;
            const waveY = Math.cos(time) * 4;
            
            const forwardDir = isOrangeSide ? -count : count;
            const spawnX = x + (forwardDir * 1.5);
            const spawnY = 5 + (count * 1.2);

            const spawnSegment = (color, offsetMult) => {
                const pGeo = new THREE.SphereGeometry(3, 8, 8);
                const pMat = new THREE.MeshStandardMaterial({ 
                    color: color, 
                    transparent: true, 
                    opacity: 0.8,
                    emissive: color,
                    emissiveIntensity: 1.5
                });
                const p = new THREE.Mesh(pGeo, pMat);
                p.position.set(spawnX, spawnY + (waveY * offsetMult), z + (waveX * offsetMult));
                
                scene.add(p);
                explosionParticles.push({ 
                    mesh: p, 
                    vel: new THREE.Vector3(0, 0.05, 0), 
                    life: 1.2 
                });
            };

            spawnSegment(0x000000, 1);  // Blue
            spawnSegment(0xFFFFFF, -1); // Pink

            count++;
            if (count > 25) clearInterval(serpentInterval);
        }, 60);
    }

    // --- STYLE C: THE CLASSIC ---
    else {
        for (let i = 0; i < 60; i++) {
            let p;
            let pMat;

            if (isBlueGoal) {
                const pGeo = new THREE.BoxGeometry(1, 1, 1);
                pMat = new THREE.MeshStandardMaterial({ 
                    color: 0x0088ff, // Fixed to Blue for Blue Goal
                    emissive: 0x0088ff, 
                    emissiveIntensity: 2 
                });
                p = new THREE.Mesh(pGeo, pMat);
            } else if (texture) {
                const pGeo = new THREE.PlaneGeometry(12, 12);
                pMat = new THREE.MeshBasicMaterial({
                    map: texture,
                    transparent: true,
                    opacity: 1,
                    blending: THREE.NormalBlending,
                    depthWrite: false
                });
                p = new THREE.Mesh(pGeo, pMat);
            } else {
                const pGeo = new THREE.BoxGeometry(1, 1, 1);
                pMat = new THREE.MeshStandardMaterial({ 
                    color: p1SelectedColor, 
                    emissive: p1SelectedColor, 
                    emissiveIntensity: 2 
                });
                p = new THREE.Mesh(pGeo, pMat);
            }

            // --- THE MISSING LOGIC ---
            p.position.set(x, 5, z);
            
            // Velocity: Make them fly out of the goal
            const vx = (x > 0 ? -1 : 1) * (Math.random() * 2); 
            const vy = Math.random() * 1.5;
            const vz = (Math.random() - 0.5) * 2;
            
            scene.add(p);

            explosionParticles.push({ 
                mesh: p, 
                vel: new THREE.Vector3(vx, vy, vz), 
                life: 1.0,
                isTextured: !isBlueGoal && !!texture 
            });
        }
    }

    // --- CAMERA LOGIC (Remains the same) ---
    if (typeof gameRunning !== 'undefined' && gameRunning) {
        cameraState = "CELEBRATE";
        goalFocusPoint.set(x, 5, z);
        p1Juice.shake = 10;
        p1Juice.zoom = 15;
        setTimeout(() => { cameraState = "FOLLOW"; }, 3000);
    }
}

function updateGoalStats() {
    let totalGoals = parseInt(localStorage.getItem('totalGoals')) || 0;
    totalGoals++;
    localStorage.setItem('totalGoals', totalGoals);
    scheduleLeaderboardSync();
    
    console.log("Goal Scored! Total Career Goals: " + totalGoals);
    
    // ADD THIS LINE: Update the UI immediately so it's ready when they go back to the menu
    refreshMenuStats(); 
}

// CHALLENGES ------------------

// Initial Challenge Data
// A larger pool of potential quests
const MISSION_POOL = [
    { id: 'goals_10', text: 'Score Total Bot Goals', goal: 10, reward: 1500, type: 'goals' },
    { id: 'wins_3', text: '20 bot goals.', goal: 20, reward: 3500, type: 'goals' },
    { id: 'boost_50', text: 'Use Boost (50 Seconds)', goal: 50, reward: 1200, type: 'boost' },
    { id: 'goals_5', text: 'Corbok wants 5 ai Goals', goal: 5, reward: 1200, type: 'goals' },
    { id: 'wins_1', text: 'Daily Bot Goal', goal: 1, reward: 1000, type: 'goals' },
    { id: 'boost_100', text: 'Speed Demon (100s Boost)', goal: 100, reward: 2200, type: 'boost' },
    { id: 'trickster_2', text: 'Trickster (Force AI Own-Goal)', goal: 2, reward: 2000, type: 'trickster' },
    { id: 'long_shot_3', text: 'Score a Long-Shot goal', goal: 1, reward: 5500, type: 'long_shot' }
];

let activeMissions = [];

function checkDailyReset() {
    const now = new Date();
    const today = now.toDateString();
    const lastReset = localStorage.getItem('lastResetDate');
    const storedMissions = localStorage.getItem('activeMissions');

    if (lastReset !== today || !storedMissions || storedMissions === "[]") {
        console.log("New Day! Resetting Missions and Progress...");
        
        // 1. Pick 3 random missions
        const shuffled = [...MISSION_POOL].sort(() => 0.5 - Math.random());
        activeMissions = shuffled.slice(0, 3);

        // 2. Clear old progress for THESE SPECIFIC missions
        let progress = JSON.parse(localStorage.getItem('challengeProgress')) || {};
        
        activeMissions.forEach(m => {
            progress[m.id] = 0; // Force reset to zero for the new day
        });

        // 3. Save everything back to storage
        localStorage.setItem('activeMissions', JSON.stringify(activeMissions));
        localStorage.setItem('challengeProgress', JSON.stringify(progress));
        localStorage.setItem('lastResetDate', today);
        
        // Optional: If you want to be extra clean, you can clear ALL progress
        // localStorage.setItem('challengeProgress', JSON.stringify({}));
    } else {
        activeMissions = JSON.parse(storedMissions);
    }
}

function updateResetTimer() {
    const now = new Date();
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0); // Set to next midnight

    const diff = midnight - now;

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff / (1000 * 60)) % 60);
    const secs = Math.floor((diff / 1000) % 60);

    const timerStr = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    document.getElementById('reset-timer').innerText = timerStr;

    // If it hits exactly midnight, refresh the missions
    if (hours === 0 && mins === 0 && secs === 0) {
        checkDailyReset();
        updateChallengeUI();
    }
}

// Start the clock
setInterval(updateResetTimer, 1000);
function updateChallengeUI() {
    const list = document.getElementById('challenge-list');
    if (!list) return;
    list.innerHTML = '';
    
    // Check if activeMissions exists, if not, try to boot it
    if (!activeMissions || activeMissions.length === 0) {
        checkDailyReset(); 
    }
    let progress = JSON.parse(localStorage.getItem('challengeProgress')) || {};

    activeMissions.forEach(task => {
        let rawValue = progress[task.id] || 0;
        
        // FIX 1: Round the value for the display (e.g., 5.792... becomes 6)
        let displayValue = Math.round(rawValue);
        
        // FIX 2: Calculate percentage based on raw value for accuracy
        const percent = Math.min(100, (rawValue / task.goal) * 100);
        const isComplete = rawValue >= task.goal;

        const card = document.createElement('div');
        card.className = `challenge-card ${isComplete ? 'complete' : ''}`;
        
        card.innerHTML = `
            <div class="challenge-header">
                <span>${task.text}</span>
                <span class="xp-reward">+${task.reward} XP</span>
            </div>
            <div class="progress-bar-bg">
                <div class="progress-bar-fill" style="width: ${percent}%"></div>
            </div>
            <div class="challenge-status">
                ${isComplete ? '✅ COMPLETE' : `${displayValue} / ${task.goal}`}
            </div>
        `;
        
        list.appendChild(card);
    });
}

function addXP(amount) {
    let currentXP = parseInt(localStorage.getItem('playerXP')) || 0;
    let currentLevel = parseInt(localStorage.getItem('playerLevel')) || 1;

    currentXP += amount;

    // Logic: Level up every 1000 XP
    // Formula: Level = Floor(Total XP / 1000) + 1
    let newLevel = Math.floor(currentXP / 1000) + 1;

    if (newLevel > currentLevel) {
        console.log("LEVEL UP! You are now level " + newLevel);
        checkLevelDrops(currentLevel, newLevel);
        // You could trigger a cool sound effect or animation here
    }

    localStorage.setItem('playerXP', currentXP);
    localStorage.setItem('playerLevel', newLevel);
    scheduleLeaderboardSync();
    
    refreshMenuStats(); // Keep the menu updated
}


// --- RANDOM HAT FOR THE BOT ---
function giveBotRandomHat(botCar) {
    // Remove old hat if one is already equipped ---
    const oldHat = botCar.getObjectByName("playerHat");
    if (oldHat) botCar.remove(oldHat);
    // 1. Pick a random hat from the list
    // 1. Get a list of only the hats from our master item list
    const allHats = ALL_ITEMS.filter(item => item.type === 'hat');
    
    // 2. Pick a random index and select that hat's ID
    const randomIndex = Math.floor(Math.random() * allHats.length);
    const selectedHat = allHats[randomIndex].id;

    // 2. Only add it if it's not 'none'
    if (selectedHat !== 'none') {
        const botHat = createHat(selectedHat);
        
        // Use the same positioning logic as the player
        botHat.position.set(0, 2.5, -0.5); 
        botCar.add(botHat);
        
        // If the bot gets the neon hat, maybe make it a different color (Red/Orange)?
        botHat.traverse((node) => {
            if (node.isMesh && node.material && selectedHat === 'neon') {
                node.material.color.set(0xff4500); // Orange-Red Neon for "Enemy" vibes
            }
            if (node instanceof THREE.PointLight && selectedHat === 'neon') {
                node.color.set(0xff4500);
            }
        });
    }
}
function animatePoliceLights(currentTime) {
    if (currentTime - lastCopFlashTime > flashInterval) {
        lastCopFlashTime = currentTime;

        // Find ALL police lights in the scene (Player and Bot!)
        scene.traverse((node) => {
            if (node.name === "copLightRed" || node.name === "copLightBlue") {
                const isRed = node.name === "copLightRed";
                const isBlue = node.name === "copLightBlue";

                // Cycle states: Red -> Blue -> Red -> Blue
                if (copLightState === 1 && isRed) {
                    node.intensity = 2; // Bright flash
                } else if (copLightState === 2 && isBlue) {
                    node.intensity = 2; // Bright flash
                } else {
                    node.intensity = 0; // Off
                }
            }
        });

        // Advance to the next state
        copLightState = (copLightState % 2) + 1; // Alternates 1 and 2
    }
}
function updateCamera(cam, target, smoothTracker) {
    if (!target || !smoothTracker) return;

    // Mode code sets the base FOV; layer the user's offset on top
    if (cam.fov !== cam._appliedFov) cam._baseFov = cam.fov;
    const wantedFov = (cam._baseFov ?? cam.fov) + camSettings.fov;
    if (cam.fov !== wantedFov) {
        cam.fov = wantedFov;
        cam.updateProjectionMatrix();
    }
    cam._appliedFov = cam.fov;

    if (cameraState === "CELEBRATE") {
        const broadcastPos = new THREE.Vector3(
            goalFocusPoint.x > 0 ? 120 : -120, 
            30, 
            60 
        );
        
        cam.position.lerp(broadcastPos, 0.05);
        cam.lookAt(goalFocusPoint);
        
        const shake = (Math.random() - 0.5) * p1Juice.shake;
        cam.position.y += shake;

    } else if (ballCam) {
        // Sit behind the car on the ball->car line, looking at the ball
        const toCar = target.position.clone().sub(ball.position).setY(0);
        if (toCar.lengthSq() < 0.01) toCar.set(0, 0, 1);
        toCar.normalize();
        const targetPos = target.position.clone()
            .addScaledVector(toCar, camSettings.distance + p1Juice.zoom)
            .add(new THREE.Vector3(0, camSettings.height + 2, 0));
        cam.position.lerp(targetPos, 0.2);
        cam.lookAt(ball.position);
    } else {
        // Create a version of the rotation that ONLY has the Y-axis (the turn)
        const flatRotation = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0), 
            target.rotation.y
        );
        
        // Slerp the tracker to the flat rotation instead of the flipping car
        smoothTracker.slerp(flatRotation, 0.1);

        // Add leaning back in
        let targetLean = 0;
        if (target === p1) {
            if (keys['KeyA']) targetLean = -3;
            if (keys['KeyD']) targetLean = 3;
        } else if (p2 && target === p2) {
            if (keys['ArrowLeft']) targetLean = -3;
            if (keys['ArrowRight']) targetLean = 3;
        }
        p1Juice.lean = THREE.MathUtils.lerp(p1Juice.lean, targetLean, 0.05);
        p2Juice.lean = THREE.MathUtils.lerp(p2Juice.lean, targetLean, 0.05);
        
        const offset = new THREE.Vector3(p1Juice.lean, camSettings.height + p1Juice.zoom, camSettings.distance); 
        const relativeOffset = offset.applyQuaternion(smoothTracker);
        
        const targetPos = target.position.clone().add(relativeOffset);
        cam.position.lerp(targetPos, 0.2); 
        
        cam.lookAt(target.position.clone().add(new THREE.Vector3(0, 2, 0)));
    }
    // Force the camera to never go below 2 units above ground
    if (cam.position.y < 2) cam.position.y = 2;
    p1Juice.shake *= 0.9; // Reduces shake by 10% every frame
    p1Juice.zoom *= 0.9;  // Reduces zoom by 10% every frame
    p2Juice.shake *= 0.9; // Reduces shake by 10% every frame
    p2Juice.zoom *= 0.9;  // Reduces zoom by 10% every frame
}
// Call this once at the very bottom of your script
initGarageShowroom();

function endMatch(wording) {
    isGoalScored = true; // This safely pauses score ticking and goal checks
    
    // Stop all velocities
    p1Vel.set(0, 0, 0);
    if (p2Vel) p2Vel.set(0, 0, 0);
    ballVel.set(0, 0, 0);

    // Call your celebration text overlay (reusing your goal banner style)
    celebrate(wording); 

    // Open an Endgame Overlay after a brief delay
    setTimeout(() => {
        // Show a menu button or overlay to go back to the garage/main menu
        alert(`${wording}\nMatch Over! Heading back to the main menu.`);
        location.reload(); // Quick reset back to main screen for now
    }, 4000);
    
    if (wording === "BLUE VICTORY!") {
        addXP(1000); //  bonus for completing a full match
        showMissionToast("🏆 MATCH WIN BONUS +1000 XP");
    }
    
    if (wording === "BLUE VICTORY!" && currentMode === 'hot_potato') {
        // Tally the match win
        let potatoWins = parseInt(localStorage.getItem('stat_potato_wins')) || 0;
        potatoWins++;
        localStorage.setItem('stat_potato_wins', potatoWins);
    
        const isAlreadyUnlocked = localStorage.getItem('secret_unlocked_potato_fire') === 'true';
    
        if (potatoWins >= 10 && !isAlreadyUnlocked) {
            // UNLOCK IT!
            localStorage.setItem('secret_unlocked_potato_fire', 'true');
            
            // Show your beautiful custom sliding toast notification
            showMissionToast("SECRET UNLOCKED: 🔥 Fiery Potato Hat!");
        }
    }
}

function checkWinCondition() {
    // Define the target score for Hot Potato mode
    const targetScore = 100; 
    
    if (score[0] >= targetScore) {
        endMatch("BLUE VICTORY!");
        
    } else if (score[1] >= targetScore) {
        endMatch("ORANGE VICTORY!");
    }
}
// --- 1. REUSABLE CAR-TO-BALL COLLISION ---
function checkCarBallCollision(carMesh, carVel, hitterName) {
    if (!carMesh || !carMesh.visible) return false;

    const localBallPos = carMesh.worldToLocal(ball.position.clone());
    const localDiffX = Math.abs(localBallPos.x);
    const localDiffY = Math.abs(localBallPos.y);
    const localDiffZ = Math.abs(localBallPos.z);

    if (localDiffX >= 6 || localDiffZ >= 7 || localDiffY >= 5) return false;

    lastHitter = hitterName;
    lastHitPosition.copy(carMesh.position);
    setHotPotatoBallColor(hitterName);

    const distance = carMesh.position.distanceTo(ball.position);
    const hitDir = ball.position.clone().sub(carMesh.position).normalize();
    const impactPower = (carVel.length() * 1.2) + 0.5;
    ballVel.add(hitDir.clone().multiplyScalar(impactPower));
    ballVel.y += 0.2;

    const overlap = 8.1 - distance;
    if (overlap > 0) ball.position.add(hitDir.multiplyScalar(overlap));

    carVel.multiplyScalar(0.8);
    return true;
}

// --- 2. REUSABLE CAR-TO-CAR COLLISION ---
function checkCarToCarCollision(carA, velA, juiceA, carB, velB, juiceB) {
    if (!carA || !carB || !carA.visible || !carB.visible) return;

    const carDist = carA.position.distanceTo(carB.position);
    
    // If cars are closer than 7 units (your exact threshold)
    if (carDist < 7) {
        let bumpDir = new THREE.Vector3().subVectors(carA.position, carB.position).normalize();
        
        const bumpForce = 0.4;
        if (velA) velA.addScaledVector(bumpDir, bumpForce);
        if (velB) velB.addScaledVector(bumpDir, -bumpForce);
        
        // Visual feedback
        if (juiceA) juiceA.shake = 2;
        if (juiceB) juiceB.shake = 2;
        
        // Static resolution: prevent overlapping
        let overlap = 8 - carDist;
        carA.position.addScaledVector(bumpDir, overlap / 2);
        carB.position.addScaledVector(bumpDir, -overlap / 2);
    }
}

function update() {
    if (!gameRunning) {
        
        requestAnimationFrame(update);
        
        p1.rotation.y += 0.01; 
        
        return; // EXIT the function here so no driving happens
    }
    
    
    let displaySpeed = Math.sqrt(p1Vel.x ** 2 + p1Vel.z ** 2) * 100;
    // --- CLEANED & SLOWED PULSE BLOCK ---
    let deltaTime = clock.getDelta(); 
    if (deltaTime > 0.1) deltaTime = 0.1; // Cap it for safety
    
    // Lowered the multiplier from 5 to 3 to slow down the baseline time accumulation
    cosmeticTime += deltaTime * 3; 
    
    [p1, showroomCar].forEach(car => {
        if (car) {
            const activeHat = car.getObjectByName("playerHat");
            if (activeHat) {
                
                activeHat.traverse(child => {
                    // Target the Magma Cracks material brightness ONLY
                    if (child.material && child.material.emissive) {
                        if (child.name !== "ballMesh") {
                            // DROPPED FREQUENCY: Changed 1.5 to 0.8 for a slower, smoother glow
                            const brightness = 2.5 + Math.sin(cosmeticTime * 0.8) * 1.5;
                            child.material.emissiveIntensity = brightness;
                        }
                    }
                });
    
            }
        }
    });
    // --- COORD DEBUG TRACKER (NOW A LEGIT RADAR MECHANIC) ---
    const hudElement = document.getElementById('coordHud');
    
    if (hudElement && p1) {
        // NATIVE FIX: Read directly from your exact localStorage key!
        const activeHatType = localStorage.getItem('p1Hat'); 
        const isSatelliteEquipped = (activeHatType === 'satellite');
    
        // If they don't have the dish equipped, hide the radar entirely
        if (!isSatelliteEquipped) {
            hudElement.style.display = 'none';
        } else {
            hudElement.style.display = 'block'; // Reveal the radar app
            
            // Use your 3-unit wiggle room around (2, 1, 3)
            const atCenter = Math.abs(p1.position.x - 2) < 3.0 && Math.abs(p1.position.z - 3) < 3.0;
            
            hudElement.innerHTML = `
              <b>🛰️ SATELLITE UPLINK:</b><br>
              X: ${p1.position.x.toFixed(2)}<br>
              Y: ${p1.position.y.toFixed(2)}<br>
              Z: ${p1.position.z.toFixed(2)}<br>
              <span style="color: ${atCenter ? '#00ff00' : '#ffaa00'}">
                ${atCenter ? '🛸 SIGNAL LOCKED' : '📡 SCANNING FOR ANOMALY...'}
              </span>
            `;
        }
    }
    
    const boostFill = document.getElementById('boost-fill');
    if (boostFill) {
        boostFill.style.width = boostAmount + "%";
        
        boostFill.style.background = (boostAmount < 25) ? "#ff3300" : "linear-gradient(90deg, #ff8800, #ffff00)";
    }
    
    // --- Update Player 2 Boost Bar ---
    const boostFillP2 = document.getElementById('p2-boost-fill');
    if (boostFillP2 && p2) {
        // Update the width based on the variable
        boostFillP2.style.width = p2BoostAmount + "%";
        
        // Change color if low (less than 25%)
        if (p2BoostAmount < 25) {
            boostFillP2.style.background = "#ff3300"; // Red alert
        } else {
            boostFillP2.style.background = "linear-gradient(90deg, #0088ff, #00ffff)"; // Blue/Cyan for P2
        }
    }
    let isBoostActive = keys['ShiftLeft'] && boostAmount > 0;
    let isDrifting = keys['KeyC']; // Using KeyC as requested
    let driveSpeed = isBoostActive ? 0.07 : 0.05;
    
    let steerPower = isDrifting ? 0.07 : 0.045;
    if (keys['KeyA']) p1.rotation.y += steerPower;
    if (keys['KeyD']) p1.rotation.y -= steerPower;
    
    let targetTilt = 0;
    if (keys['KeyA']) targetTilt = 0.15;
    if (keys['KeyD']) targetTilt = -0.15;
    p1.rotation.z = THREE.MathUtils.lerp(p1.rotation.z, targetTilt, 0.1);

    if (keys['KeyW']) {
        p1Vel.z -= Math.cos(p1.rotation.y) * driveSpeed;
        p1Vel.x -= Math.sin(p1.rotation.y) * driveSpeed;
    }
    if (keys['KeyS']) {
        p1Vel.z += Math.cos(p1.rotation.y) * driveSpeed;
        p1Vel.x += Math.sin(p1.rotation.y) * driveSpeed;
    }
    // Check if 'R' is pressed
    if (keys['KeyR']) {
        // This allows the reset if the mode is 'practice' OR 'single'
        if (currentMode === 'practice' || currentMode === 'single') {
            fullReset();
            keys['KeyR'] = false;
        }
    }
    //if (!hasUfoUnlocked && p1) {
    if (p1) {
    
        // 1. Calculate distance to our target coordinate hub (2, 1, 3)
        const dx = p1.position.x - 0;
        const dy = p1.position.y - 1;
        const dz = p1.position.z - 0;
        const distanceToCenter = Math.sqrt(dx*dx + dy*dy + dz*dz);
    
        // 2. Check if they are within our 3-unit buffer zone AND actively holding 'D'
        // (Swap 'keys.d' with your engine's exact input variable if named differently)
        const isSpinningAtCenter = (distanceToCenter <= 3.0) && (keys && keys['KeyD']);
    
        if (isSpinningAtCenter && !isBeingAbducted) {
            abductionTimer += deltaTime;
    
            // Visual feedback: Make the coordinates on the right flash yellow while charging
            const hud = document.getElementById('coordHud');
            if (hud) hud.style.borderColor = '#ffff00';
    
            // Holding for 3 seconds of continuous spinning initiates the beam sequence!
            if (abductionTimer >= 3.0) {
                isBeingAbducted = true;
                abductionTimer = 0;
    
                // Spawn a temporary glowing cyan tractor beam geometry over the car
                const beamGeo = new THREE.CylinderGeometry(1.5, 12.0, 120.0, 24, 1, true);
                const beamMat = new THREE.MeshBasicMaterial({
                    color: 0x00ffff,
                    transparent: true,
                    opacity: 0.3,
                    side: THREE.DoubleSide
                });
                abductionBeamMesh = new THREE.Mesh(beamGeo, beamMat);
                abductionBeamMesh.position.set(2, 60.0, 3); // Centered over landing spot stretching upward
                scene.add(abductionBeamMesh);
            }
        } else if (!isBeingAbducted) {
            // Reset if they stop holding D or drift out of the zone before it triggers
            abductionTimer = 0;
            const hud = document.getElementById('coordHud');
            if (hud) hud.style.borderColor = distanceToCenter <= 3.0 ? '#00ff00' : '#00ffff';
        }
    
        // 3. RUN THE ZERO-GRAVITY SEQUENCE EFFECT
        if (isBeingAbducted) {
            abductionTimer += deltaTime;
    
            // Turn off car gravity forces/velocity calculations by hardcoding vertical pathing
            if (typeof p1Vel !== 'undefined') {
                p1Vel.x = 0;
                p1Vel.z = 0;
                p1Vel.y = 0; 
            }
    
            // --- BOOSTED LIFT ENGINE ---
            // Changed speed from 4.5 to 15.0 to rocket the car skyward!
            p1.position.y += 15.0 * deltaTime; 
            p1.rotation.y += 8.0 * deltaTime; // Faster, more violent spin velocity
            p1.rotation.z += 1.5 * deltaTime; // More erratic tumbling angle
    
            // Pulse the tractor beam mesh transparency so it flickers organically
            if (abductionBeamMesh) {
                abductionBeamMesh.material.opacity = 0.2 + Math.sin(performance.now() * 0.02) * 0.1;
            }
    
            // --- INCREASED FLIGHT TIME ---
            // Changed from 4.0 to 6.0 seconds so you spend more time climbing into the clouds!
            if (abductionTimer >= 6.0) {
                hasUfoUnlocked = true;
                isBeingAbducted = false;
                abductionTimer = 0;
    
                // Clean up the world space tractor beam mesh safely
                if (abductionBeamMesh) {
                    scene.remove(abductionBeamMesh);
                    abductionBeamMesh.geometry.dispose();
                    abductionBeamMesh.material.dispose();
                    abductionBeamMesh = null; 
                }
    
                // Restore physics position to ground level safely
                p1.position.set(2, 1, 3);
                if (typeof p1Vel !== 'undefined') {
                    p1Vel.set(0, 0, 0); 
                }
                p1.rotation.set(0, 0, 0);
    
                // MATCHING YOUR NATIVE COSMETIC UNLOCK SYSTEM:
                const isUfoUnlocked = localStorage.getItem('secret_unlocked_ufo') === 'true';
                
                if (!isUfoUnlocked) {
                    localStorage.setItem('secret_unlocked_ufo', 'true');
                    showMissionToast("🛸 SECRET UNLOCKED: Cosmic UFO Hat!");
                    addXP(500); 
                }
            }
        }
    }
    let forwardDir = new THREE.Vector3(-Math.sin(p1.rotation.y), 0, -Math.cos(p1.rotation.y)).normalize();
    let sideDir = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), forwardDir).normalize();
    let forwardMag = p1Vel.dot(forwardDir);
    let sideMag = p1Vel.dot(sideDir);
    let grip = isDrifting ? 0.20 : 0.98; 
    sideMag *= (1 - grip); 

    let currentY = p1Vel.y; 
    p1Vel.set(0,0,0)
        .add(forwardDir.multiplyScalar(forwardMag))
        .add(sideDir.multiplyScalar(sideMag));
    p1Vel.y = currentY; // Restore the Y speed after the reset

    // if (p1.position.y > 1.05) {
    //     p1.rotation.x = THREE.MathUtils.lerp(p1.rotation.x, 0, 0.1);
    //     p1.rotation.z = THREE.MathUtils.lerp(p1.rotation.z, 0, 0.1);
    // }

    if (p1.position.y <= 1.05) {
        jumpsLeft = 2;
    }
    p1.rotation.order = 'YXZ';
    // --- PLAYER 1 DASH ---
    if (keys['Space']) {
        if (jumpsLeft > 0) {
            p1Vel.y = 0.5; // JUMP HEIGHT
            
            if (jumpsLeft === 1) {
                let dashPower = 0.7;
                // Check for Frontflip
                if (keys['KeyW']) {
                    p1Vel.add(forwardDir.clone().multiplyScalar(dashPower));
                    p1RotVel = -0.45; // Fast Frontflip (matching P2's speed)
                } 
                // Check for Backflip
                else if (keys['KeyS']) {
                    p1Vel.add(forwardDir.clone().multiplyScalar(-dashPower));
                    p1RotVel = 0.45; // Fast Backflip
                }
                createDashTrail();
            }
    
            jumpsLeft--;
            keys['Space'] = false; 
        }
    }
    p1.rotation.x += p1RotVel;
    
    p1RotVel *= 0.9; 
    
    
    
    if (p1.position.y <= 1.05) {
        p1.rotation.x = 0;
        p1RotVel = 0; // Stop the spin instantly on landing
    }
    
    p1.position.add(p1Vel);

    if (p1.position.y > 1.05) {
        p1Vel.y -= 0.04; // Gravity
        
        p1.rotation.x = THREE.MathUtils.lerp(p1.rotation.x, 0, -0.013);
        p1.rotation.z = THREE.MathUtils.lerp(p1.rotation.z, 0, -0.013);
    } else {
        p1.position.y = 1;
        p1Vel.y = 0;

        p1.rotation.x = 0;
        p1.rotation.z = 0;
    }

    p1Vel.x *= 0.95; 
    p1Vel.z *= 0.95;

    p1.position.add(p1Vel);
    
    time += 0.05;
    scene.traverse((node) => {
        if (node.name === "propellerBlades") {
            node.rotation.y += 0.2;
        }
        
        if (node.name === "spinningMiniCar") {
            node.rotation.y += 0.03;
        }
        
        if (node.name === "potatoSpudFlamesGroup") {
            node.matrixAutoUpdate = true;
            
            // Fast volcanic jitter and wobble for the fire group container
            node.rotation.z = Math.sin(time * 4) * 0.05;
            node.rotation.x = Math.cos(time * 3) * 0.03;
            
            // Rhythmic scaling pulse that only affects the fire layer!
            const firePulse = 1.0 + Math.sin(time * 5) * 0.12;
            node.scale.set(firePulse, firePulse * 1.2, firePulse);
        }
        // --- SCENE TRAVERSE TRACK: SATELLITE DISH PANNING ---
        if (node.name === "satelliteDishContainer") {
            node.matrixAutoUpdate = true;
            
            // Smoothly sweep left and right using a sine wave
            node.rotation.y = Math.sin(time * 1.2) * 0.8; 
        }
        // --- SCENE TRAVERSE TRACK: UFO HULL HOVER ---
        if (node.name === "ufoHoverContainer") {
            node.matrixAutoUpdate = true;
            
            // Smooth cinematic floating floating up and down
            node.position.y = Math.sin(time * 1.5) * 0.15;
            
            // Add a slight futuristic tilt as it floats
            node.rotation.x = Math.sin(time * 0.8) * 0.05;
            node.rotation.z = Math.cos(time * 0.8) * 0.05;
        }
        
        // --- SCENE TRAVERSE TRACK: UFO NEON ORBIT SPIN ---
        if (node.name === "ufoRingContainer") {
            node.matrixAutoUpdate = true;
            
            // Spin the neon array rapidly around the saucer center line
            node.rotation.y += 0.08; 
        }
    });
    
    
    
    
    animatePoliceLights(Date.now());
    // --- AI LOGIC (COORDINATE FIXED VERSION) ---
    if ((currentMode === 'ai' || currentMode === 'hot_potato') && p2) {
        // 1. THE BIG FIX: Target the Blue Goal at -200 (The Player's Goal)
        const p1GoalPos = new THREE.Vector3(-200, 0, 0); 
        
        // Direction from the ball to the player's goal
        let ballToP1Goal = new THREE.Vector3().subVectors(p1GoalPos, ball.position).normalize();
        
        // 2. DEFINE THE KEY POINTS
        let impactPoint = ball.position.clone().sub(ballToP1Goal.clone().multiplyScalar(2)); 
        let attackPoint = ball.position.clone().add(ballToP1Goal.clone().multiplyScalar(-20));
    
        // 3. DISTANCES AND STATE
        let distToBall = p2.position.distanceTo(ball.position);
        
        // SAFETY CHECK: Am I "Out of Position"? 
        // Since we are attacking the NEGATIVE side (-200), being "past" the ball 
        // means the AI's X is LESS than the ball's X.
        let isOutOfPosition = p2.position.x < ball.position.x + 5; 
    
        // 4. CHOOSE TARGET AND SPEED
        let targetPos;
        let aiDriveSpeed = 0.08;
    
        if (isOutOfPosition) {
            // STATE: RECOVER (Loop back to the POSITIVE side to get behind the ball)
            targetPos = new THREE.Vector3(ball.position.x + 40, 0, ball.position.z);
            aiDriveSpeed = 0.14; 
        } else {
            // STATE: OFFENSE
            let dirToImpact = new THREE.Vector3().subVectors(impactPoint, p2.position).normalize();
            let alignment = dirToImpact.dot(ballToP1Goal);
            
            if (alignment > 0.85 && distToBall < 60) {
                targetPos = impactPoint; 
                if (alignment < 0.95 && distToBall < 25) {
                    aiDriveSpeed = 0.04; 
                } else {
                    aiDriveSpeed = 0.16; 
                }
            } else {
                targetPos = attackPoint;
                aiDriveSpeed = 0.1;
            }
        }
    
        // 5. ROTATION MATH
        let dirToTarget = new THREE.Vector3().subVectors(targetPos, p2.position);
        let targetAngle = Math.atan2(dirToTarget.x, dirToTarget.z) + Math.PI;
        let angleDiff = targetAngle - p2.rotation.y;
        
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    
        // 6. STEERING & BRAKE
        let currentSteer = (aiDriveSpeed < 0.05) ? 0.08 : 0.05;
        if (angleDiff > 0.05) p2.rotation.y += currentSteer;
        else if (angleDiff < -0.05) p2.rotation.y -= currentSteer;
    
        if (Math.abs(angleDiff) > 1.2) aiDriveSpeed = 0;
    
        // 7. EXECUTE MOVEMENT
        if (Math.abs(angleDiff) < 1.5) {
            p2Vel.z -= Math.cos(p2.rotation.y) * aiDriveSpeed;
            p2Vel.x -= Math.sin(p2.rotation.y) * aiDriveSpeed;
        }
    
        // 8. PHYSICS & BOUNDARIES
        if (p2.position.y > 1.05) p2Vel.y -= 0.04; 
        else { p2.position.y = 1; p2Vel.y = 0; }
    
        p2.position.add(p2Vel);
        p2Vel.x *= 0.95;
        p2Vel.z *= 0.95;
    
        p2.position.x = Math.max(-198, Math.min(198, p2.position.x));
        p2.position.z = Math.max(-118, Math.min(118, p2.position.z));
        
        if (!isGoalScored) { // Only check if a goal isn't already being celebrated
            if (orangeGoalZone.containsPoint(ball.position)) {
                addXP(100);
            }
        }
    }
    // --- RUN 2V2 AI CYCLE ---
    if (currentMode === '2v2_ai') {
        // 1. P1 Teammate: Smart adaptive role based on player position!
        runAIBot(p1Teammate, p1TeammateVel, 200, 'SMART_TEAMMATE');
    
        // 2. Enemy Bot 1 (p2): Dedicated Orange Team Goalie / Defense
        runAIBot(p2, p2Vel, -200, 'DEFENSE');
    
        // 3. Enemy Bot 2 (p3): Dedicated Orange Team Striker / Offense
        runAIBot(p3, p3Vel, -200, 'OFFENSE');
    
        // Collision check
        //handleVehicleCollisions();
    }
    if (currentMode === '2v2_coop') {
        // P1 and P2 are driven by player keyboard inputs
        
        // Enemy Bot 1 (Defender targeting Blue Goal)
        runAIBot(p3, p3Vel, -200, 'DEFENSE');
    
        // Enemy Bot 2 (Attacker targeting Blue Goal)
        runAIBot(p4, p4Vel, -200, 'OFFENSE');
    
        // Run collisions for all 4 cars
        //handleVehicleCollisions();
    }
    if (p2 && (currentMode === 'split' || currentMode === '2v2_coop')) {
        // --- 1. BOOST & SPEED LOGIC ---
        //if (keys['Numpad0'] || keys['Slash']) {
        let p2IsBoosting = (keys['ShiftRight'] || keys['Numpad3']) && p2BoostAmount > 0;
        let p2DriveSpeed = p2IsBoosting ? 0.15 : 0.1;
        let p2SteerPower = keys['ControlRight'] ? 0.07 : 0.045; // Using R-Ctrl for drift if needed
    
        if (p2IsBoosting) {
            p2BoostAmount = Math.max(0, p2BoostAmount - 0.8);
            p2Juice.zoom = THREE.MathUtils.lerp(p2Juice.zoom, 5, 0.1);
        } else {
            p2Juice.zoom = THREE.MathUtils.lerp(p2Juice.zoom, 0, 0.1);
        }
    
        // --- 2. STEERING & TILT ---
        if (keys['ArrowLeft']) p2.rotation.y += p2SteerPower;
        if (keys['ArrowRight']) p2.rotation.y -= p2SteerPower;
    
        let p2TargetTilt = 0;
        if (keys['ArrowLeft']) p2TargetTilt = 0.15;
        if (keys['ArrowRight']) p2TargetTilt = -0.15;
        p2.rotation.z = THREE.MathUtils.lerp(p2.rotation.z, p2TargetTilt, 0.1);
    
        // --- 3. DRIVING FORCES ---
        if (keys['ArrowUp']) {
            p2Vel.z -= Math.cos(p2.rotation.y) * p2DriveSpeed;
            p2Vel.x -= Math.sin(p2.rotation.y) * p2DriveSpeed;
        }
        if (keys['ArrowDown']) {
            p2Vel.z += Math.cos(p2.rotation.y) * p2DriveSpeed;
            p2Vel.x += Math.sin(p2.rotation.y) * p2DriveSpeed;
        }
    
        // --- 4. GRIP & DRIFT MATH ---
        let p2ForwardDir = new THREE.Vector3(-Math.sin(p2.rotation.y), 0, -Math.cos(p2.rotation.y)).normalize();
        let p2SideDir = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), p2ForwardDir).normalize();
        let p2ForwardMag = p2Vel.dot(p2ForwardDir);
        let p2SideMag = p2Vel.dot(p2SideDir);
        
        let p2Grip = 0.98; // Matches P1
        p2SideMag *= (1 - p2Grip);
    
        let p2CurrentY = p2Vel.y;
        p2Vel.set(0,0,0)
            .add(p2ForwardDir.multiplyScalar(p2ForwardMag))
            .add(p2SideDir.multiplyScalar(p2SideMag));
        p2Vel.y = p2CurrentY;
    
        // --- 5. JUMPING & DASHING ---
        if (p2.position.y <= 1.05) {
            p2JumpsLeft = 2;
        }
        
        // Check for the key
        if (keys['Numpad0'] || keys['Slash']) {
            if (p2JumpsLeft > 0) {
                p2Vel.y = 0.5; // This gives the upward boost
                
                if (p2JumpsLeft === 1) {
                    let p2Forward = new THREE.Vector3(-Math.sin(p2.rotation.y), 0, -Math.cos(p2.rotation.y)).normalize();
                    if (keys['ArrowUp']) {
                        p2Vel.add(p2Forward.multiplyScalar(0.7));
                        p2RotVel = -0.45; 
                    }
                }
                p2JumpsLeft--;
                
                // IMPORTANT: Reset BOTH keys immediately
                keys['KeyM'] = false;
                keys['Slash'] = false;
            }
        }
    
        // --- 6. AIR ROTATION & GRAVITY ---
        p2.rotation.x += p2RotVel;
        p2RotVel *= 0.9;
        
        if (p2.position.y > 1.0) {
            p2Vel.y -= 0.035; // Apply gravity to the velocity
            p2.rotation.x = THREE.MathUtils.lerp(p2.rotation.x, 0, -0.01);
            p2.rotation.z = THREE.MathUtils.lerp(p2.rotation.z, 0, -0.01);
        } else {
            p2.position.y = 1;
            if (p2Vel.y < 0) p2Vel.y = 0; // Stop falling when on ground
            p2.rotation.x = 0;
            p2RotVel = 0;
        }
        
        // Apply the final velocity ONCE
        p2.position.add(p2Vel);
        p2Vel.x *= 0.95;
        p2Vel.z *= 0.95;
    
        // --- 7. BOUNDARY CLAMPING ---
        p2.position.x = Math.max(-198, Math.min(198, p2.position.x));
        p2.position.z = Math.max(-118, Math.min(118, p2.position.z));
    }
    
    
    
    if (ball.position.y > 5) {
        ballVel.y -= 0.03; // GRAVITY STRENGTH
    } else {
        ball.position.y = 5;
        ballVel.x *= 0.98;
        ballVel.z *= 0.98;
        if (Math.abs(ballVel.y) > 0.1) ballVel.y *= -0.3;
        else ballVel.y = 0;
    }

    if (ball.position.y > 5.1) {
        if (ballVel.y > 0) {
            ballVel.y *= 0.96;
        }
        ballVel.y -= 0.02; // Standard Gravity
    }
    ball.position.add(ballVel);

    if (currentMode === 'online' && onlineRole !== 'p1' && onlineBallTarget && onlinePendingHitId === null) {
        const correction = onlineBallTarget.clone().sub(ball.position);
        if (correction.length() > 15) {
            ball.position.copy(onlineBallTarget);
        } else {
            ball.position.addScaledVector(correction, 0.2);
        }
        onlineBallTarget = null;
    }

    if (isBoostActive) {
        boostAmount = Math.max(0, boostAmount - 0.8);
    }
    
    if (isBoostActive) {
        boostLight.intensity = 2;
        boostLight.position.copy(p1.position);
        camera.position.x += (Math.random() - 0.5) * 0.15;
        camera.position.y += (Math.random() - 0.5) * 0.15;
    } else {
        boostLight.intensity = 0;
    }
    
    const boostFillP1 = document.getElementById('boost-fill');
    if (boostFillP1) {
        boostFillP1.style.width = boostAmount + "%";
    }
    
    
    // Ball - Car Collision

    if (currentMode !== 'online') {
        let localBallPos = p1.worldToLocal(ball.position.clone());

        let localDiffX = Math.abs(localBallPos.x);
        let localDiffY = Math.abs(localBallPos.y); // Add this line!
        let localDiffZ = Math.abs(localBallPos.z);

        if (localDiffX < 6.5 && localDiffZ < 7.5 && localDiffY < 5.5) {
            lastHitPosition.copy(p1.position);
            lastHitter = 'player'; // Tag as player
            if (currentMode === 'hot_potato') {
                ball.material.color.setHex(0x00cccc);    // Bright Neon Blue
                if (ball.material.emissive) {
                    ball.material.emissive.setHex(0x00cccc); // Make it self-illuminate
                }
            }
            let distance = p1.position.distanceTo(ball.position);
            let hitDir = ball.position.clone().sub(p1.position).normalize();

            let impactPower = (p1Vel.length() * 1.3) + 0.6;
            ballVel.add(hitDir.clone().multiplyScalar(impactPower));
            ballVel.y += 0.2; // Give it a nice "pop" upward
        
            let overlap = 8.1 - distance;
            if (overlap > 0) {
                ball.position.add(hitDir.multiplyScalar(overlap));
            }

            p1Vel.multiplyScalar(0.8);
        }
    }

    if (currentMode !== 'online' || onlineRole === 'p1') {
        // --- Ceiling Collision ---
        const arenaHeight = 70; // Adjust this based on how high you want the "roof"
        if (ball.position.y > arenaHeight) {
            ball.position.y = arenaHeight;
            ballVel.y *= -0.5; // Reflect velocity downward with some dampening (bounciness)
        }
        // --- Wall Collision ---
        if (Math.abs(ball.position.z) > 115) {
            ballVel.z *= -0.7;
            ball.position.z = ball.position.z > 0 ? 115 : -115;
        }

        if (Math.abs(ball.position.x) > 195) {
            if (Math.abs(ball.position.z) > 20) {
                ballVel.x *= -0.7;
                ball.position.x = ball.position.x > 0 ? 195 : -195;
            } else if (Math.abs(ball.position.x) > 215) {
                fullReset();
            }
        }
    }
    p1.position.x = Math.max(-198, Math.min(198, p1.position.x));
    p1.position.z = Math.max(-118, Math.min(118, p1.position.z));
    updateBoostPadRecharge('p1', p1);
    if (currentMode === 'split' || currentMode === '2v2_coop') {
        updateBoostPadRecharge('p2', p2);
    }
    updateBoostPadEffects(performance.now());
    explosionParticles.forEach((p, index) => {
        // 1. Move the particle
        p.mesh.position.add(p.vel);
        
        // 2. THE FIX: Always face the active camera
        // If you use camera1 for the celebration, use camera1.
        if (p.isTextured) {
            p.mesh.lookAt(camera1.position);
        }
    
        // 3. Update life and opacity
        p.life -= 0.01;
        p.mesh.material.opacity = p.life;
    
        // 4. Clean up finished particles
        if (p.life <= 0) {
            scene.remove(p.mesh);
            p.mesh.geometry.dispose();
            p.mesh.material.dispose();
            explosionParticles.splice(index, 1);
        }
    });
    
    // --- CENTRALIZED BALL COLLISIONS ---
    if (currentMode === 'online' && onlineRole !== 'p1') {
        if (onlinePendingHitId === null && onlineSocket && onlineSocket.readyState === WebSocket.OPEN) {
            if (checkCarBallCollision(p1, p1Vel, onlineRole)) {
                onlinePendingHitId = ++onlineHitSequence;
                onlineSocket.send(JSON.stringify({
                    type: 'hit',
                    playerRole: onlineRole,
                    hitId: onlinePendingHitId,
                    player: getOnlineCarState(p1, p1Vel),
                    ball: {
                        position: { x: ball.position.x, y: ball.position.y, z: ball.position.z },
                        velocity: { x: ballVel.x, y: ballVel.y, z: ballVel.z }
                    }
                }));
            }
        }
    } else {
        checkCarBallCollision(p1, p1Vel, currentMode === 'online' ? 'p1' : 'player');

        if (currentMode === 'online') {
            // Guest hits are applied by the host when its hit event arrives.
        } else if (currentMode === '2v2_ai') {
            checkCarBallCollision(p1Teammate, p1TeammateVel, 'p1Teammate');
            checkCarBallCollision(p2, p2Vel, 'ai');
            checkCarBallCollision(p3, p3Vel, 'ai');
        } else if (currentMode === '2v2_coop') {
            checkCarBallCollision(p2, p2Vel, 'p2'); // Human P2
            checkCarBallCollision(p3, p3Vel, 'ai'); // Enemy Bot 1
            checkCarBallCollision(p4, p4Vel, 'ai'); // Enemy Bot 2
        } else if (p2 && (currentMode === 'split' || currentMode === 'ai' || currentMode === 'hot_potato')) {
            checkCarBallCollision(p2, p2Vel, 'ai');
        }
    }
    // --- CENTRALIZED CAR-TO-CAR COLLISIONS ---
    if (currentMode === 'online' && onlineCars) {
        const onlinePlayers = getOnlineRoles().map(role => onlineCars[role]).filter(Boolean);
        for (let i = 0; i < onlinePlayers.length; i++) {
            for (let j = i + 1; j < onlinePlayers.length; j++) {
                checkCarToCarCollision(
                    onlinePlayers[i].car, onlinePlayers[i].velocity, onlinePlayers[i].juice,
                    onlinePlayers[j].car, onlinePlayers[j].velocity, onlinePlayers[j].juice
                );
            }
        }
    } else if (currentMode === '2v2_ai' || currentMode === '2v2_coop') {
        // Select the correct set of 4 cars depending on the 2v2 mode
        const allCars = (currentMode === '2v2_ai') ? [
            { mesh: p1, vel: p1Vel, juice: p1Juice },
            { mesh: p1Teammate, vel: p1TeammateVel, juice: null },
            { mesh: p2, vel: p2Vel, juice: p2Juice },
            { mesh: p3, vel: p3Vel, juice: null }
        ] : [
            { mesh: p1, vel: p1Vel, juice: p1Juice },
            { mesh: p2, vel: p2Vel, juice: p2Juice },
            { mesh: p3, vel: p3Vel, juice: null },
            { mesh: p4, vel: p4Vel, juice: null }
        ];
    
        // Loop through every unique pair of cars
        for (let i = 0; i < allCars.length; i++) {
            for (let j = i + 1; j < allCars.length; j++) {
                checkCarToCarCollision(
                    allCars[i].mesh, allCars[i].vel, allCars[i].juice,
                    allCars[j].mesh, allCars[j].vel, allCars[j].juice
                );
            }
        }
    } else if (p2 && (currentMode === 'split' || currentMode === 'ai' || currentMode === 'hot_potato' || currentMode === 'online')) {
        // Standard 1v1 bump handling
        checkCarToCarCollision(p1, p1Vel, p1Juice, p2, p2Vel, p2Juice);
    }
    
    if (!isGoalScored && (currentMode !== 'online' || onlineRole === 'p1')) {
        
        // ORANGE GOAL ZONE
        if (orangeGoalZone.containsPoint(ball.position)) { 
            isGoalScored = true;
            score[0]++; 
            document.getElementById('s1').innerText = score[0]; 
            if (currentMode === '2v2_ai') addXP(500);
            
            // --- LONG SHOT LOGIC START ---
            // 1. Get the center of the goal zone
            const goalCenter = new THREE.Vector3();
            orangeGoalZone.getCenter(goalCenter);
        
            // 2. Calculate distance from player's last hit to the goal
            const shotDistance = lastHitPosition.distanceTo(goalCenter);
        
            // 3. Check threshold (Adjust 180 to fit your arena size)
            if (currentMode !== 'online' && lastHitter && shotDistance > 180) {
                updateMissionProgress('long_shot', 1);
                showMissionToast(`🚀 LONGSHOT! (${Math.round(shotDistance)}m)`);
                addXP(500)
                // --- ADD THE SECRET DETECTOR HERE ---
                // Let's set a super deep target distance threshold (e.g., 200)
                const absoluteLaserDistance = 200;
                const isScopeUnlocked = localStorage.getItem('secret_unlocked_sniper_scope') === 'true';
        
                if (shotDistance >= absoluteLaserDistance && !isScopeUnlocked) {
                    localStorage.setItem('secret_unlocked_sniper_scope', 'true');
                    showMissionToast("SECRET UNLOCKED: 🎯 Sniper Scope Topper!");
                }
            }
            // --- LONG SHOT LOGIC END ---
            
            p1Juice.shake = 2; // Much lower value for a subtle hit
            p2Juice.shake = 2;
            p1Juice.zoom = 5;  // Slight pull back
            p2Juice.zoom = 5;
            
            const blueGoalExplosion = recordOnlineGoal('BLUE SCORED!', 200, GOAL_COLORS.blue);
            createGoalExplosion(200, 0, blueGoalExplosion);
            celebrate("BLUE SCORED!"); 
            ballVel.set(0, 0, 0); // Stop the ball movement
            ball.visible = false; // Optional: Hide the ball so only particles show
            
            setTimeout(() => {
                updateGoalStats();// Updates goal stats
                if (currentMode !== 'online') addXP(100);
                fullReset();
                isGoalScored = false; 
            }, 3000);
            if (currentMode === 'ai' || currentMode === 'hot_potato') {
                addXP(200)
                updateMissionProgress('goals', 1);
                if (lastHitter === 'ai') {
                    updateMissionProgress('trickster', 1);
                    showMissionToast("🃏 TRICKSTER! AI Own-Goal!");
                    addXP(100)
                    // --- ADD THE SECRET TRACKER HERE ---
                    let ownGoalForces = parseInt(localStorage.getItem('stat_forced_own_goals')) || 0;
                    ownGoalForces++;
                    localStorage.setItem('stat_forced_own_goals', ownGoalForces);
            
                    const isNoseUnlocked = localStorage.getItem('secret_unlocked_clown_nose') === 'true';
            
                    // Check milestone: 10 forced own goals
                    if (ownGoalForces >= 10 && !isNoseUnlocked) {
                        localStorage.setItem('secret_unlocked_clown_nose', 'true');
                        showMissionToast("SECRET UNLOCKED: 🤡 Clown Nose!");
                    }
                }
            }
            if (isHotPotatoMode()) {
                score[0] += 9;
                document.getElementById('s1').innerText = score[0];
            }
        }
        
        if (blueGoalZone.containsPoint(ball.position)) { 
            isGoalScored = true;
            score[1]++; 
            document.getElementById('s2').innerText = score[1]; 
            if (currentMode === '2v2_ai') addXP(500);
            
            cameraTarget.set(-200, 5, 0)
            
            const orangeGoalExplosion = recordOnlineGoal('ORANGE SCORED!', -200, GOAL_COLORS.orange);
            createGoalExplosion(-200, 0, orangeGoalExplosion);
            celebrate("ORANGE SCORED!"); 
            ballVel.set(0, 0, 0); // Stop the ball movement
            ball.visible = false; // Optional: Hide the ball so only particles show
            setTimeout(() => {
                fullReset();
                isGoalScored = false;
            }, 3000);
            if (isHotPotatoMode()) {
                score[1] += 9;
                document.getElementById('s2').innerText = score[1];
            }
        }
        
    
    }
    // Hot Potato Mode Ticker
    if (isHotPotatoMode() && !isGoalScored) {
        possessionTimer += deltaTime; 

        if (possessionTimer >= POINT_TICK_RATE) {
            possessionTimer = 0; 

            if (currentMode === 'online' && ['p1', 'p2', 'p3', 'p4'].includes(lastHitter)) {
                const scoreIndex = getOnlineScoreIndex(lastHitter);
                if (onlineRole === 'p1') {
                    score[scoreIndex]++;
                    document.getElementById(scoreIndex === 0 ? 's1' : 's2').innerText = score[scoreIndex];
                }
                if (getOnlineTeam(lastHitter) === getOnlineTeam(onlineRole)) addXP(5);
            } else if (lastHitter === 'player') {
                score[0] += 1;
                document.getElementById('s1').innerText = score[0];
                addXP(5);
            } else if (lastHitter === 'ai') {
                score[1] += 1;
                document.getElementById('s2').innerText = score[1];
            }
            if (currentMode === 'online') updateOnlineMatch();
            else checkWinCondition();
        }
    }
    if (isBoostActive) {
        let addedTime = 0.016; 
        updateMissionProgress('boost', addedTime);
        boostLight.intensity = 2; boostLight.position.copy(p1.position); 
        createBoostParticle(p1.position);
        createBoostParticle(p1.position);
        createBoostParticle(p1.position);
        camera.position.x += (Math.random()-0.5)*0.1;
        camera1.fov = THREE.MathUtils.lerp(camera1.fov, 105, 0.1);
    } else {
        boostLight.intensity = 0;
        let normalFOV = (currentMode === 'split' || currentMode === '2v2_coop') ? 95 : 85;
        camera1.fov = THREE.MathUtils.lerp(camera1.fov, normalFOV, 0.1);
    }
    if (currentMode === 'online' && onlineCars && onlineRole) {
        getOnlineRoles().filter(role => role !== onlineRole).forEach((remoteRole) => {
            const remotePlayer = onlineCars[remoteRole];
            if (!remotePlayer?.isBoosting) return;
            const trailPosition = remotePlayer.car.position.clone();
            const forward = new THREE.Vector3();
            remotePlayer.car.getWorldDirection(forward);
            trailPosition.addScaledVector(forward, -2.5);
            trailPosition.y += 0.8;
            for (let index = 0; index < 3; index++) {
                createBoostParticle(trailPosition, false, scene, remotePlayer.boostType);
            }
        });
    }
    camera1.updateProjectionMatrix();
    
    ballArrow.position.set(ball.position.x, ball.position.y + 10, ball.position.z);
    ballArrow.rotation.y += 0.05;
    ballArrow.visible = p1.position.distanceTo(ball.position) > 15;

    

    if (ballVel.length() > 2.5) ballVel.multiplyScalar(0.95);
    ball.rotation.x += ballVel.z * 0.1;
    ball.rotation.z -= ballVel.x * 0.1;
    
    let rawSpeed = p1Vel.length();
    
    let mph = Math.floor(rawSpeed * 55); 
    
    document.getElementById('speed').innerText = mph + " MPH";
    
    updateParticles();
    
    updateOnlineMatch();
    syncOnlineState(performance.now());
    requestAnimationFrame(update);
    scene.children.forEach(child => {
        if (child.isParticle) { // You can add a property .isParticle = true to your particles
            child.lookAt(camera.position);
        }
    });
    
    
    if (gameRunning && (currentMode === 'split' || currentMode === '2v2_coop')) {
        renderer.setScissorTest(true);
    
        // Player 1 Side
        renderer.setViewport(0, 0, window.innerWidth / 2, window.innerHeight);
        renderer.setScissor(0, 0, window.innerWidth / 2, window.innerHeight);
        updateCamera(camera1, p1, p1SmoothQuat, p1Juice); // Pass the tracker!
        renderer.render(scene, camera1);
    
        // Player 2 Side
        renderer.setViewport(window.innerWidth / 2, 0, window.innerWidth / 2, window.innerHeight);
        renderer.setScissor(window.innerWidth / 2, 0, window.innerWidth / 2, window.innerHeight);
        
        // Now following P2 properly!
        if (p2) {
            updateCamera(camera2, p2, p2SmoothQuat, p2Juice);
        } else {
            updateCamera(camera2, p1, p2SmoothQuat, p2Juice);
        }
        renderer.render(scene, camera2);
    } else {
        // Single Player
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
        updateCamera(camera1, p1, p1SmoothQuat, p1Juice);
        renderer.render(scene, camera1);
    }
    
    
}
window.addEventListener('resize', () => {
    const width = window.innerWidth;
    const height = window.innerHeight;

    renderer.setSize(width, height);

    let aspect1 = ((currentMode === 'split' || currentMode === '2v2_coop') ? (width / 2) : width) / height;
    camera1.aspect = aspect1;
    camera1.updateProjectionMatrix();

    let aspect2 = (width / 2) / height;
    camera2.aspect = aspect2;
    camera2.updateProjectionMatrix();
});

fullReset();
update();
// On page load, check if a color was previously saved

const startupColor = localStorage.getItem('p1Color');
if (startupColor && window.p1) {
    p1.children.forEach(child => {
        if (child.name === "bodyMesh" && child.material) {
            child.material.color.set(startupColor);
        }
    });
}
window.addEventListener('load', () => {
    const colorToLoad = localStorage.getItem('p1Color');
    if (colorToLoad) {
        p1SelectedColor = colorToLoad;
        const picker = document.getElementById('carColorPicker');
        if (picker) picker.value = colorToLoad;
    }
});
refreshMenuStats();