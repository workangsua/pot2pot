/**
 * POT2POT App Controller
 * Manages views, camera streams, modal workflows, achievements, and persistent storage.
 */

// --- Global App State ---
const AppState = {
    plants: [],
    user: {
        level: 1,
        xp: 0,
        title: "초보 식집사",
        unlockedBadges: []
    },
    currentView: 'archive', // 'archive', 'community', 'badges'
    registerStep: 1, // 1: Scan, 2: Cutout, 3: Profile
    capturedImageSrc: null,
    selectedPreset: null,
    segmenter: null,
    stream: null
};

// Preset Plant Definitions
const PLANT_PRESETS = {
    monstera: {
        name: '몬스테라',
        image: 'assets/monstera.png',
        theme: 'monstera',
        waterInterval: 7
    },
    cactus: {
        name: '꽃선인장',
        image: 'assets/cactus.png',
        theme: 'cactus',
        waterInterval: 14
    },
    snake: {
        name: '산세베리아',
        image: 'assets/snake.png',
        theme: 'snake',
        waterInterval: 10
    }
};

// Badges list
const BADGES = [
    { id: 'first_plant', name: '첫 만남 🌱', desc: '첫 반려식물을 무사히 등록 완료!', icon: '🌱' },
    { id: 'oasis', name: '오아시스 💧', desc: '식물에게 첫 물주기 완료', icon: '💧' },
    { id: 'greenthumb', name: '초록손 👑', desc: '3개 이상의 화분 등록하기', icon: '👑' }
];

// --- Initializing App ---
document.addEventListener('DOMContentLoaded', () => {
    loadDataFromStorage();
    initNavigation();
    initRegistrationFlow();
    initDetailModalFlow();
    renderArchive();
    renderBadges();
    renderCommunityFeed();
    updateUserBadgeUI();
    
    // Set default date for date picker to today
    document.getElementById('plant-adoption').valueAsDate = new Date();
});

// --- Local Storage Handlers ---
function loadDataFromStorage() {
    const savedPlants = localStorage.getItem('pot2pot_plants');
    const savedUser = localStorage.getItem('pot2pot_user');
    
    if (savedPlants) {
        AppState.plants = JSON.parse(savedPlants);
    } else {
        // Add one default plant to look nice at first load
        AppState.plants = [
            {
                id: 'default_1',
                nickname: '몬이',
                species: '몬스테라 델리시오사',
                theme: 'monstera',
                image: 'assets/monstera.png',
                waterInterval: 7,
                lastWatered: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
                adoptionDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
                records: [
                    {
                        id: 'rec_init_1',
                        date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
                        type: 'adopt',
                        memo: '🌱 몬이가 우리 집에 온 날! 앞으로 정성을 다해 키워봐야지.'
                    },
                    {
                        id: 'rec_init_2',
                        date: new Date(Date.now() - 24 * 24 * 60 * 60 * 1000).toISOString(),
                        type: 'water',
                        memo: '💧 첫 번째 물주기 완료. 배수가 아주 시원하게 잘 된다!'
                    },
                    {
                        id: 'rec_init_3',
                        date: new Date(Date.now() - 17 * 24 * 60 * 60 * 1000).toISOString(),
                        type: 'water',
                        memo: '💧 겉흙이 보슬보슬 말라서 두 번째 물주기 완료.'
                    },
                    {
                        id: 'rec_init_4',
                        date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
                        type: 'repot',
                        memo: '🪴 뿌리가 삐져나오려 해서 한 단계 더 넓고 쾌적한 화분으로 영양 흙 채워 분갈이를 해줬다!'
                    },
                    {
                        id: 'rec_init_5',
                        date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
                        type: 'diary',
                        memo: '📝 분갈이하고 났더니 돌돌 말린 귀여운 새 잎이 새로 돋아나고 있다! 대견해라 💚',
                        image: 'assets/monstera.png'
                    },
                    {
                        id: 'rec_init_6',
                        date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
                        type: 'water',
                        memo: '💧 물 듬뿍 주고 분무도 완료! 이파리 먼지도 살짝 닦아줬다.'
                    }
                ]
            }
        ];
        savePlantsToStorage();
    }
    
    if (savedUser) {
        AppState.user = JSON.parse(savedUser);
    } else {
        AppState.user = {
            level: 1,
            xp: 0,
            title: "초보 식집사",
            unlockedBadges: []
        };
        saveUserToStorage();
    }
}

function savePlantsToStorage() {
    localStorage.setItem('pot2pot_plants', JSON.stringify(AppState.plants));
}

function saveUserToStorage() {
    localStorage.setItem('pot2pot_user', JSON.stringify(AppState.user));
}

// --- Navigation ---
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item:not(.add-pot)');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            const view = item.getAttribute('data-view');
            switchView(view);
        });
    });
    
    // Add Plant FAB
    const addPlantBtn = document.querySelector('.nav-item.add-pot');
    addPlantBtn.addEventListener('click', () => {
        openRegisterModal();
    });
}

function switchView(viewName) {
    if (AppState.currentView === viewName) return;
    
    document.querySelectorAll('.screen-view').forEach(screen => {
        screen.classList.remove('active');
    });
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    
    const activeScreen = document.getElementById(`screen-${viewName}`);
    if (activeScreen) {
        activeScreen.classList.add('active');
        AppState.currentView = viewName;
    }
    
    const activeNavItem = document.querySelector(`.nav-item[data-view="${viewName}"]`);
    if (activeNavItem) {
        activeNavItem.classList.add('active');
    }
}

// --- Camera Access ---
async function startCamera() {
    const video = document.getElementById('camera-stream');
    const scannerBox = document.querySelector('.scan-scanner-box');
    const fallbackMsg = document.querySelector('.camera-fallback-msg');
    
    if (fallbackMsg) {
        fallbackMsg.style.display = 'none';
    }
    scannerBox.classList.add('scanning');
    
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('getUserMedia not supported in insecure context (HTTP)');
        }
        AppState.stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
            audio: false
        });
        video.srcObject = AppState.stream;
        video.style.display = 'block';
    } catch (err) {
        console.warn('Camera not accessible. Using fallback mock gallery/preset flow.', err);
        video.style.display = 'none';
        scannerBox.classList.remove('scanning');
        if (fallbackMsg) {
            fallbackMsg.style.display = 'flex';
        }
    }
}

function stopCamera() {
    if (AppState.stream) {
        AppState.stream.getTracks().forEach(track => track.stop());
        AppState.stream = null;
    }
    const scannerBox = document.querySelector('.scan-scanner-box');
    scannerBox.classList.remove('scanning');
}

// --- Custom Alert Popup ---
function showAlert(message, duration = 3000) {
    const alertBanner = document.getElementById('custom-alert');
    const alertMsg = document.getElementById('custom-alert-message');
    
    alertMsg.textContent = message;
    alertBanner.classList.add('active');
    
    setTimeout(() => {
        alertBanner.classList.remove('active');
    }, duration);
}

// Close alert button
document.getElementById('custom-alert-close').addEventListener('click', () => {
    document.getElementById('custom-alert').classList.remove('active');
});

// --- Gamification Engine ---
function addXP(amount) {
    AppState.user.xp += amount;
    const nextLevelXP = AppState.user.level * 100;
    
    let leveledUp = false;
    while (AppState.user.xp >= nextLevelXP) {
        AppState.user.xp -= nextLevelXP;
        AppState.user.level += 1;
        leveledUp = true;
    }
    
    // Update title based on level
    if (AppState.user.level >= 5) {
        AppState.user.title = "식물 마스터 👑";
    } else if (AppState.user.level >= 3) {
        AppState.user.title = "골드 핑거 🌿";
    } else if (AppState.user.level >= 2) {
        AppState.user.title = "그린 핑거 🌱";
    }
    
    saveUserToStorage();
    updateUserBadgeUI();
    
    if (leveledUp) {
        showAlert(`🎉 레벨 업! Level ${AppState.user.level} [${AppState.user.title}]이 되었습니다!`);
        renderBadges();
    }
}

function unlockBadge(badgeId) {
    if (AppState.user.unlockedBadges.includes(badgeId)) return;
    
    AppState.user.unlockedBadges.push(badgeId);
    saveUserToStorage();
    
    const badge = BADGES.find(b => b.id === badgeId);
    if (badge) {
        showAlert(`🏆 업적 달성! [${badge.name}] 뱃지를 획득했습니다.`);
        addXP(50);
        renderBadges();
    }
}

function checkBadgeTriggers() {
    // Check first plant
    if (AppState.plants.length >= 1) {
        unlockBadge('first_plant');
    }
    // Check green thumb (3+ plants)
    if (AppState.plants.length >= 3) {
        unlockBadge('greenthumb');
    }
}

function updateUserBadgeUI() {
    document.getElementById('user-lvl').textContent = AppState.user.level;
    document.getElementById('user-title').textContent = AppState.user.title;
}

// --- Plant Registration Flow ---
function initRegistrationFlow() {
    const modalOverlay = document.getElementById('register-modal');
    const closeBtn = document.getElementById('modal-close');
    const container = document.getElementById('step-container');
    
    // Close modal
    closeBtn.addEventListener('click', closeRegisterModal);
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeRegisterModal();
    });
    
    // Camera snap shutter click
    document.getElementById('btn-capture-shutter').addEventListener('click', () => {
        captureSnapshot();
    });
    
    // Local File Upload
    const fileInput = document.getElementById('file-upload-input');
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                AppState.selectedPreset = null;
                AppState.capturedImageSrc = event.target.result;
                goToStep(2);
            };
            reader.readAsDataURL(file);
        }
    });
    
    // Preset Plant Selector
    const presetChips = document.querySelectorAll('.preset-chip');
    presetChips.forEach(chip => {
        chip.addEventListener('click', () => {
            const presetKey = chip.getAttribute('data-preset');
            const preset = PLANT_PRESETS[presetKey];
            if (preset) {
                AppState.selectedPreset = presetKey;
                AppState.capturedImageSrc = preset.image;
                goToStep(2);
            }
        });
    });
    
    // Step 2 Canvas toolbar bindings
    const eraserBtn = document.getElementById('btn-tool-erase');
    const restoreBtn = document.getElementById('btn-tool-restore');
    const magicTapBtn = document.getElementById('btn-tool-magic-tap');
    const brushSlider = document.getElementById('brush-size');
    
    eraserBtn.addEventListener('click', () => {
        eraserBtn.classList.add('active');
        restoreBtn.classList.remove('active');
        magicTapBtn.classList.remove('active');
        if (AppState.segmenter) AppState.segmenter.brushMode = 'erase';
    });
    
    restoreBtn.addEventListener('click', () => {
        restoreBtn.classList.add('active');
        eraserBtn.classList.remove('active');
        magicTapBtn.classList.remove('active');
        if (AppState.segmenter) AppState.segmenter.brushMode = 'restore';
    });

    magicTapBtn.addEventListener('click', () => {
        magicTapBtn.classList.add('active');
        eraserBtn.classList.remove('active');
        restoreBtn.classList.remove('active');
        if (AppState.segmenter) AppState.segmenter.brushMode = 'magic';
    });
    
    brushSlider.addEventListener('input', (e) => {
        if (AppState.segmenter) AppState.segmenter.brushSize = parseInt(e.target.value);
    });
    
    // Step 2 Magic Wand Color Keying
    document.getElementById('btn-tool-magic').addEventListener('click', () => {
        if (AppState.segmenter) {
            // Magic-wand key out whatever was near center or general white keying
            AppState.segmenter.autoRemoveWhiteBackground(35);
            showAlert("🪄 마법봉으로 배경을 자동으로 제거했습니다.");
        }
    });
    
    document.getElementById('btn-tool-reset').addEventListener('click', () => {
        if (AppState.segmenter) {
            AppState.segmenter.resetMask();
            showAlert("↩️ 원본 상태로 복구되었습니다.");
        }
    });
    
    // Next to Step 3
    document.getElementById('btn-cutout-next').addEventListener('click', () => {
        if (AppState.segmenter) {
            const cutoutBase64 = AppState.segmenter.getMaskedBase64();
            document.getElementById('preview-cutout-img').src = cutoutBase64;
            
            // Auto populate form details if preset was chosen
            if (AppState.selectedPreset) {
                const preset = PLANT_PRESETS[AppState.selectedPreset];
                document.getElementById('plant-species').value = preset.name;
                document.getElementById('plant-nickname').value = preset.name + '이';
                document.getElementById('water-slider').value = preset.waterInterval;
                updateWaterIntervalValue(preset.waterInterval);
            } else {
                document.getElementById('plant-species').value = '';
                document.getElementById('plant-nickname').value = '';
                document.getElementById('water-slider').value = 7;
                updateWaterIntervalValue(7);
            }
            
            goToStep(3);
        }
    });
    
    // Step 3 slider change
    const waterSlider = document.getElementById('water-slider');
    waterSlider.addEventListener('input', (e) => {
        updateWaterIntervalValue(e.target.value);
    });
    
    // Form Submit
    document.getElementById('register-plant-form').addEventListener('submit', (e) => {
        e.preventDefault();
        saveNewPlant();
    });
}

function updateWaterIntervalValue(val) {
    document.getElementById('water-val').textContent = `${val}일`;
}

function openRegisterModal() {
    document.getElementById('register-modal').classList.add('active');
    goToStep(1);
}

function closeRegisterModal() {
    document.getElementById('register-modal').classList.remove('active');
    stopCamera();
}

function goToStep(stepNum) {
    AppState.registerStep = stepNum;
    const container = document.getElementById('step-container');
    const offset = -(stepNum - 1) * 33.333;
    container.style.transform = `translateX(${offset}%)`;
    
    // Update step dots
    document.querySelectorAll('.step-indicator-dot').forEach((dot, idx) => {
        if (idx < stepNum) {
            dot.classList.add('active');
        } else {
            dot.classList.remove('active');
        }
    });
    
    // Trigger step specific transitions
    if (stepNum === 1) {
        startCamera();
    } else {
        stopCamera();
    }
    
    if (stepNum === 2) {
        setupCanvasEditor();
    }
}

// Camera Capture
function captureSnapshot() {
    const video = document.getElementById('camera-stream');
    const canvas = document.createElement('canvas');
    
    if (AppState.stream) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        
        // Mirror horizontally back since the preview is mirrored
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0);
        
        AppState.selectedPreset = null;
        AppState.capturedImageSrc = canvas.toDataURL('image/jpeg');
        goToStep(2);
    } else {
        showAlert("⚠️ 카메라 피드를 사용할 수 없어 다육이 샘플로 진행합니다.");
        AppState.selectedPreset = 'cactus';
        AppState.capturedImageSrc = PLANT_PRESETS.cactus.image;
        goToStep(2);
    }
}

// Setup Step 2 Canvas Editor
function setupCanvasEditor() {
    const overlay = document.getElementById('editor-processing');
    overlay.classList.add('active');
    
    // Simulate AI cutout logic with scanner bar
    let progress = 0;
    const progressText = overlay.querySelector('p');
    
    const interval = setInterval(() => {
        progress += 10;
        progressText.textContent = `피사체 탐색 중... ${progress}%`;
        
        if (progress >= 100) {
            clearInterval(interval);
            overlay.classList.remove('active');
            initCanvasSegmenter();
        }
    }, 150);
}

function initCanvasSegmenter() {
    const canvas = document.getElementById('editor-canvas');
    const tempImg = new Image();
    
    tempImg.onload = () => {
        AppState.segmenter = new PlantSegmenter(canvas, tempImg);
        
        // Touch/Mouse draw binding for Canvas
        let isDrawing = false;
        
        const getMousePos = (evt) => {
            const rect = canvas.getBoundingClientRect();
            // Scaling factors
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            
            let clientX, clientY;
            if (evt.touches) {
                clientX = evt.touches[0].clientX;
                clientY = evt.touches[0].clientY;
            } else {
                clientX = evt.clientX;
                clientY = evt.clientY;
            }
            
            return {
                x: (clientX - rect.left) * scaleX,
                y: (clientY - rect.top) * scaleY
            };
        };
        
        const handleStart = (e) => {
            e.preventDefault();
            const pos = getMousePos(e);
            AppState.segmenter.startDrawing(pos.x, pos.y);
        };
        
        const handleMove = (e) => {
            e.preventDefault();
            if (AppState.segmenter.isDrawing) {
                const pos = getMousePos(e);
                AppState.segmenter.drawBrush(pos.x, pos.y);
            }
        };
        
        const handleEnd = () => {
            AppState.segmenter.stopDrawing();
        };
        
        canvas.onmousedown = handleStart;
        canvas.onmousemove = handleMove;
        window.onmouseup = handleEnd;
        
        canvas.ontouchstart = handleStart;
        canvas.ontouchmove = handleMove;
        window.ontouchend = handleEnd;
        
        // If it's a preset image or file with clear white background, run autokey
        if (AppState.selectedPreset || AppState.capturedImageSrc.startsWith('data:image')) {
            AppState.segmenter.autoRemoveWhiteBackground(25);
        }
    };
    
    tempImg.src = AppState.capturedImageSrc;
}

// Save Plant to Archive
function saveNewPlant() {
    const nickname = document.getElementById('plant-nickname').value.trim() || '내 식물';
    const species = document.getElementById('plant-species').value.trim() || '반려식물';
    const interval = parseInt(document.getElementById('water-slider').value);
    const adoptionDate = document.getElementById('plant-adoption').value || new Date().toISOString();
    
    const newPlant = {
        id: 'plant_' + Date.now(),
        nickname: nickname,
        species: species,
        theme: AppState.selectedPreset || 'custom',
        image: AppState.segmenter.getMaskedBase64(),
        waterInterval: interval,
        lastWatered: new Date().toISOString(), // set last watered to today
        adoptionDate: new Date(adoptionDate).toISOString(),
        records: [
            {
                id: 'rec_' + Date.now() + '_adopt',
                date: new Date(adoptionDate).toISOString(),
                type: 'adopt',
                memo: `🌱 [${nickname}] 입양 및 POT2POT 화분 등록 완료!`
            },
            {
                id: 'rec_' + Date.now() + '_water',
                date: new Date().toISOString(),
                type: 'water',
                memo: `💧 정원 등록과 함께 첫 물주기 완료! (D-Day 주기가 오늘을 기점으로 자동 갱신되었습니다.)`
            }
        ]
    };
    
    AppState.plants.push(newPlant);
    savePlantsToStorage();
    
    // Award XP
    addXP(100);
    checkBadgeTriggers();
    
    // Refresh GUI
    renderArchive();
    
    showAlert(`🌱 [${nickname}] 화분이 정상적으로 등록되었습니다!`);
    
    // Close Modal
    closeRegisterModal();
}

// --- D-Day Helper Calculations ---
function getDaysRemaining(plant) {
    const nextWaterDate = new Date(plant.lastWatered);
    nextWaterDate.setDate(nextWaterDate.getDate() + plant.waterInterval);
    
    const today = new Date();
    today.setHours(0,0,0,0);
    nextWaterDate.setHours(0,0,0,0);
    
    const diffTime = nextWaterDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays;
}

function getDDayClassAndText(days) {
    if (days < 0) {
        return { class: 'urgent', text: `D+${Math.abs(days)} (물주기 지남)` };
    } else if (days === 0) {
        return { class: 'urgent', text: 'D-Day (물주기!)' };
    } else if (days <= 2) {
        return { class: 'warning', text: `D-${days}` };
    } else {
        return { class: 'safe', text: `D-${days}` };
    }
}

// --- Render Main UI Components ---

// Render Archive / Home dashboard
function renderArchive() {
    const grid = document.getElementById('plants-grid');
    grid.innerHTML = '';
    
    if (AppState.plants.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🌵</div>
                <h3>등록된 식물이 없습니다</h3>
                <p>아래 '+' 버튼을 눌러 첫 반려식물을 <br>누끼 따서 아카이빙해 보세요!</p>
            </div>
        `;
        return;
    }
    
    AppState.plants.forEach(plant => {
        const daysRemaining = getDaysRemaining(plant);
        const ddayInfo = getDDayClassAndText(daysRemaining);
        
        const card = document.createElement('div');
        card.className = 'plant-card';
        card.setAttribute('data-theme', plant.theme);
        card.setAttribute('data-id', plant.id);
        
        card.innerHTML = `
            <span class="d-day-badge ${ddayInfo.class}">${ddayInfo.text}</span>
            <div class="img-wrapper">
                <img src="${plant.image}" alt="${plant.nickname}">
            </div>
            <div class="info">
                <h4 class="nickname">${plant.nickname}</h4>
                <p class="species">${plant.species}</p>
                <button class="quick-care-btn" onclick="event.stopPropagation(); waterPlant('${plant.id}')">
                    원터치 물주기
                </button>
            </div>
        `;
        
        // Show detailed view overlay on click
        card.addEventListener('click', () => {
            openDetailModal(plant.id);
        });
        
        grid.appendChild(card);
    });
}

// Water Plant Care Logic
window.waterPlant = function(plantId) {
    const plant = AppState.plants.find(p => p.id === plantId);
    if (plant) {
        plant.lastWatered = new Date().toISOString();
        savePlantsToStorage();
        renderArchive();
        
        showAlert(`💧 [${plant.nickname}]에게 물을 주었습니다. 다음 D-Day 일정이 자동으로 갱신되었습니다!`);
        addXP(25);
        unlockBadge('oasis');
    }
};

// Prompt sharing to feed
function promptShareToCommunity(plant) {
    const share = confirm(`[${plant.nickname}]의 이쁜 누끼 사진을 식집사 전체 커뮤니티 피드에 자랑하시겠습니까?`);
    if (share) {
        shareToFeed(plant);
    }
}

function shareToFeed(plant) {
    // Save post locally
    const posts = JSON.parse(localStorage.getItem('pot2pot_feed') || '[]');
    const newPost = {
        id: 'post_' + Date.now(),
        user: AppState.user.title,
        avatar: '🌱',
        image: plant.image,
        nickname: plant.nickname,
        species: plant.species,
        timestamp: '방금 전',
        likes: 0
    };
    
    posts.unshift(newPost);
    localStorage.setItem('pot2pot_feed', JSON.stringify(posts));
    
    showAlert("💌 커뮤니티 피드에 식물 자랑글을 게시했습니다!");
    addXP(15);
    renderCommunityFeed();
    switchView('community');
}

// Render Badges View
function renderBadges() {
    const container = document.getElementById('badges-container');
    container.innerHTML = '';
    
    BADGES.forEach(badge => {
        const isUnlocked = AppState.user.unlockedBadges.includes(badge.id);
        const card = document.createElement('div');
        card.className = `badge-card ${isUnlocked ? '' : 'locked'}`;
        
        card.innerHTML = `
            <div class="badge-icon">${badge.icon}</div>
            <div class="badge-info">
                <h4>${badge.name}</h4>
                <p>${badge.desc}</p>
            </div>
        `;
        container.appendChild(card);
    });
}

// Render Community Feed
function renderCommunityFeed() {
    const container = document.getElementById('feed-container');
    container.innerHTML = '';
    
    const defaultPosts = [
        {
            id: 'mock_1',
            user: '초록손 마스터 👑',
            avatar: '🍀',
            image: 'assets/monstera.png',
            nickname: '몬몬이',
            species: '몬스테라 델리시오사',
            timestamp: '2시간 전',
            likes: 14
        },
        {
            id: 'mock_2',
            user: '선인장러버 🌵',
            avatar: '🌸',
            image: 'assets/cactus.png',
            nickname: '가시포포',
            species: '꽃선인장',
            timestamp: '5시간 전',
            likes: 8
        }
    ];
    
    const userPosts = JSON.parse(localStorage.getItem('pot2pot_feed') || '[]');
    const allPosts = [...userPosts, ...defaultPosts];
    
    allPosts.forEach(post => {
        const postCard = document.createElement('div');
        postCard.className = 'community-post';
        postCard.innerHTML = `
            <div class="post-header">
                <div class="post-avatar">${post.avatar}</div>
                <div class="post-user-info">
                    <h4>${post.user}</h4>
                    <span>${post.timestamp}</span>
                </div>
            </div>
            <div class="post-img checkerboard-bg">
                <img src="${post.image}" alt="${post.nickname}">
            </div>
            <div style="font-size:0.85rem; font-weight:700; margin-bottom: 6px;">
                ${post.nickname} (${post.species}) 자랑하기
            </div>
            <div class="post-actions">
                <button style="background:none; border:none; cursor:pointer; color:inherit; font-weight:inherit;" onclick="likePost('${post.id}')">
                    ❤️ <span>${post.likes}</span> 좋아요
                </button>
                <span>💬 댓글 달기</span>
            </div>
        `;
        container.appendChild(postCard);
    });
}

window.likePost = function(postId) {
    // Handle mock post liking
    const userPosts = JSON.parse(localStorage.getItem('pot2pot_feed') || '[]');
    const post = userPosts.find(p => p.id === postId);
    
    if (post) {
        post.likes += 1;
        localStorage.setItem('pot2pot_feed', JSON.stringify(userPosts));
    }
    
    showAlert("❤️ 게시글을 좋아합니다!");
    renderCommunityFeed();
};

// --- Plant Detail View & Event Listeners ---
let currentDetailPlantId = null;
let currentCalendarMonth = new Date();
let logPhotoBase64 = null;

function initDetailModalFlow() {
    const modal = document.getElementById('detail-modal');
    const closeBtn = document.getElementById('detail-modal-close');
    
    // Close modal
    closeBtn.addEventListener('click', closeDetailModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeDetailModal();
    });
    
    // Quick care actions
    document.getElementById('btn-care-water').addEventListener('click', () => addCareActivity('water'));
    document.getElementById('btn-care-nutrient').addEventListener('click', () => addCareActivity('nutrient'));
    document.getElementById('btn-care-repot').addEventListener('click', () => addCareActivity('repot'));
    document.getElementById('btn-care-prune').addEventListener('click', () => addCareActivity('prune'));
    
    // Tabs click
    document.querySelectorAll('#detail-modal .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-tab');
            switchDetailTab(tab);
        });
    });
    
    // Open/Close Growth Log Form
    document.getElementById('btn-open-log-form').addEventListener('click', openLogForm);
    document.getElementById('btn-cancel-log-form').addEventListener('click', closeLogForm);
    document.getElementById('btn-remove-log-photo').addEventListener('click', removeLogPhoto);
    
    // Log Photo Input
    const logPhotoInput = document.getElementById('log-photo-input');
    const logPhotoPreview = document.getElementById('log-photo-preview');
    const logPreviewImg = document.getElementById('log-preview-img');
    const logBgRemoveToggle = document.getElementById('log-bg-remove-label');
    const logBgRemoveCheckbox = document.getElementById('log-bg-remove-checkbox');
    
    logPhotoInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                logPhotoBase64 = event.target.result;
                logPreviewImg.src = logPhotoBase64;
                logPhotoPreview.style.display = 'flex';
                logBgRemoveToggle.style.display = 'flex';
                logBgRemoveCheckbox.checked = false;
            };
            reader.readAsDataURL(file);
        }
    });
    
    logBgRemoveCheckbox.addEventListener('change', () => {
        if (logBgRemoveCheckbox.checked && logPhotoBase64) {
            const tempImg = new Image();
            tempImg.onload = () => {
                const tempCanvas = document.createElement('canvas');
                const segmenter = new PlantSegmenter(tempCanvas, tempImg);
                segmenter.autoRemoveWhiteBackground(25);
                
                logPhotoBase64 = segmenter.getMaskedBase64();
                logPreviewImg.src = logPhotoBase64;
                showAlert("🪄 사진에서 배경을 자동으로 제거(누끼)했습니다.");
            };
            tempImg.src = logPhotoBase64;
        }
    });
    
    // Submit log form
    document.getElementById('growth-log-form').addEventListener('submit', saveGrowthLog);
    
    // Calendar Navigation
    document.getElementById('btn-cal-prev').addEventListener('click', () => navigateCalendar(-1));
    document.getElementById('btn-cal-next').addEventListener('click', () => navigateCalendar(1));
    
    // Share post
    document.getElementById('btn-share-post').addEventListener('click', () => {
        if (!currentDetailPlantId) return;
        const plant = AppState.plants.find(p => p.id === currentDetailPlantId);
        if (plant) {
            shareToFeed(plant);
            closeDetailModal();
        }
    });
}

function openDetailModal(plantId) {
    const plant = AppState.plants.find(p => p.id === plantId);
    if (!plant) return;
    
    currentDetailPlantId = plantId;
    currentCalendarMonth = new Date(); // Reset to current month
    
    // Ensure records exist (compatibility)
    if (!plant.records) {
        plant.records = [
            {
                id: 'rec_' + Date.now() + '_adopt',
                date: plant.adoptionDate || new Date().toISOString(),
                type: 'adopt',
                memo: `🌱 [${plant.nickname}] 입양 완료!`
            }
        ];
    }
    
    // Fill text details
    document.getElementById('detail-nickname').textContent = plant.nickname;
    document.getElementById('detail-species').textContent = plant.species;
    document.getElementById('detail-img').src = plant.image;
    
    // Calculate D-day stats
    const daysRemaining = getDaysRemaining(plant);
    const ddayInfo = getDDayClassAndText(daysRemaining);
    
    const ddayBadge = document.getElementById('detail-dday');
    ddayBadge.textContent = ddayInfo.text;
    ddayBadge.className = `stat-badge d-day ${ddayInfo.class}`;
    
    // Together age
    const adoptDate = new Date(plant.adoptionDate);
    const today = new Date();
    today.setHours(0,0,0,0);
    adoptDate.setHours(0,0,0,0);
    const diffTime = today.getTime() - adoptDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
    document.getElementById('detail-age').textContent = `함께한 지 ${diffDays}일째`;
    
    // Cycle
    document.getElementById('detail-cycle').textContent = `물주기: ${plant.waterInterval}일`;
    
    // Water index progress fill
    let progressPercent = 0;
    if (daysRemaining > 0) {
        progressPercent = Math.min(100, Math.round((daysRemaining / plant.waterInterval) * 100));
    }
    document.getElementById('water-progress-percent').textContent = `${progressPercent}%`;
    document.getElementById('water-progress-fill').style.width = `${progressPercent}%`;
    
    switchDetailTab('timeline');
    renderTimeline(plant);
    renderCalendar(plant);
    closeLogForm();
    
    document.getElementById('detail-modal').classList.add('active');
}

function closeDetailModal() {
    document.getElementById('detail-modal').classList.remove('active');
    currentDetailPlantId = null;
}

function switchDetailTab(tabName) {
    document.querySelectorAll('#detail-modal .tab-btn').forEach(btn => {
        if (btn.getAttribute('data-tab') === tabName) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    document.querySelectorAll('#detail-modal .tab-content').forEach(content => {
        if (content.id === `tab-content-${tabName}`) {
            content.classList.add('active');
        } else {
            content.classList.remove('active');
        }
    });
}

function renderTimeline(plant) {
    const stream = document.getElementById('timeline-stream');
    stream.innerHTML = '';
    
    const sortedRecords = [...plant.records].sort((a, b) => new Date(b.date) - new Date(a.date));
    
    if (sortedRecords.length === 0) {
        stream.innerHTML = '<div style="font-size:0.75rem; color:var(--text-muted); text-align:center; padding: 20px;">기록된 일지가 아직 없습니다.</div>';
        return;
    }
    
    sortedRecords.forEach(rec => {
        const ev = document.createElement('div');
        ev.className = `timeline-event ${rec.type}`;
        
        let typeLabel = '';
        let careEmoji = '';
        if (rec.type === 'adopt') { typeLabel = '정원 등록'; careEmoji = '🌱'; }
        else if (rec.type === 'water') { typeLabel = '물주기 완료'; careEmoji = '💧'; }
        else if (rec.type === 'nutrient') { typeLabel = '영양제 투여'; careEmoji = '💊'; }
        else if (rec.type === 'repot') { typeLabel = '분갈이 완료'; careEmoji = '🪴'; }
        else if (rec.type === 'prune') { typeLabel = '가지치기 완료'; careEmoji = '✂️'; }
        else if (rec.type === 'diary') { typeLabel = '성장 다이어리'; careEmoji = '📝'; }
        
        const dateStr = formatDate(new Date(rec.date));
        
        ev.innerHTML = `
            <div class="timeline-node" title="${typeLabel}">${careEmoji}</div>
            <span class="timeline-time">${dateStr}</span>
            <span class="timeline-title">${typeLabel}</span>
            ${rec.memo ? `<p class="timeline-memo">${rec.memo}</p>` : ''}
            ${rec.image ? `<img class="timeline-photo" src="${rec.image}" alt="성장기록 사진">` : ''}
        `;
        
        stream.appendChild(ev);
    });
}

function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const w = days[date.getDay()];
    return `${y}.${m}.${d} (${w})`;
}

function renderCalendar(plant) {
    const year = currentCalendarMonth.getFullYear();
    const month = currentCalendarMonth.getMonth(); // 0-indexed
    
    document.getElementById('calendar-title').textContent = `${year}년 ${month + 1}월`;
    
    const gridBody = document.getElementById('calendar-grid-body');
    gridBody.innerHTML = '';
    
    const firstDay = new Date(year, month, 1);
    const startDayOfWeek = firstDay.getDay(); // 0: Sun, 6: Sat
    
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevDaysInMonth = new Date(year, month, 0).getDate();
    
    // 1. Prev month days
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
        const dayNum = prevDaysInMonth - i;
        const cell = document.createElement('div');
        cell.className = 'calendar-cell inactive';
        cell.textContent = dayNum;
        gridBody.appendChild(cell);
    }
    
    // 2. Active month days
    const today = new Date();
    for (let d = 1; d <= daysInMonth; d++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-cell';
        cell.textContent = d;
        
        const cellDate = new Date(year, month, d);
        if (cellDate.getFullYear() === today.getFullYear() &&
            cellDate.getMonth() === today.getMonth() &&
            cellDate.getDate() === today.getDate()) {
            cell.classList.add('today');
        }
        
        // Find events
        const dayEvents = plant.records.filter(rec => {
            const recDate = new Date(rec.date);
            return recDate.getFullYear() === year &&
                   recDate.getMonth() === month &&
                   recDate.getDate() === d;
        });
        
        if (dayEvents.length > 0) {
            const dotsWrapper = document.createElement('div');
            dotsWrapper.className = 'calendar-event-dots';
            const uniqueTypes = [...new Set(dayEvents.map(e => e.type))];
            
            uniqueTypes.slice(0, 3).forEach(type => {
                const dot = document.createElement('div');
                dot.className = `cal-dot ${type}`;
                dotsWrapper.appendChild(dot);
            });
            cell.appendChild(dotsWrapper);
        }
        
        gridBody.appendChild(cell);
    }
    
    // 3. Next month days
    const totalCells = startDayOfWeek + daysInMonth;
    const remainingCells = (7 - (totalCells % 7)) % 7;
    for (let d = 1; d <= remainingCells; d++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-cell inactive';
        cell.textContent = d;
        gridBody.appendChild(cell);
    }
}

function navigateCalendar(offset) {
    if (!currentDetailPlantId) return;
    const plant = AppState.plants.find(p => p.id === currentDetailPlantId);
    if (!plant) return;
    
    currentCalendarMonth.setMonth(currentCalendarMonth.getMonth() + offset);
    renderCalendar(plant);
}

function addCareActivity(type, memo = '') {
    if (!currentDetailPlantId) return;
    const plant = AppState.plants.find(p => p.id === currentDetailPlantId);
    if (!plant) return;
    
    const now = new Date();
    const newRecord = {
        id: 'rec_' + Date.now(),
        date: now.toISOString(),
        type: type,
        memo: memo || getDefaultCareMemo(type, plant.nickname)
    };
    
    if (!plant.records) plant.records = [];
    plant.records.push(newRecord);
    
    if (type === 'water') {
        plant.lastWatered = now.toISOString();
    }
    
    savePlantsToStorage();
    renderArchive();
    openDetailModal(plant.id);
    
    let xpAward = 25;
    if (type === 'repot') xpAward = 40;
    else if (type === 'nutrient') xpAward = 30;
    else if (type === 'prune') xpAward = 20;
    addXP(xpAward);
    
    if (type === 'water') {
        unlockBadge('oasis');
    }
}

function getDefaultCareMemo(type, nickname) {
    switch(type) {
        case 'water': return `💧 ${nickname}에게 시원하게 물을 듬뿍 주었습니다.`;
        case 'nutrient': return `💊 ${nickname}에게 영양 풍부한 식물 영양제를 투여했습니다.`;
        case 'repot': return `🪴 ${nickname}에게 더 넓고 숨쉬기 편한 흙으로 이사시켜주었습니다. (분갈이)`;
        case 'prune': return `✂️ ${nickname}의 마르고 힘없는 줄기와 이파리를 이쁘게 가듬고 다듬었습니다.`;
        default: return '';
    }
}

function openLogForm() {
    document.getElementById('growth-log-form').style.display = 'flex';
    document.getElementById('btn-open-log-form').style.display = 'none';
    document.getElementById('log-date').valueAsDate = new Date();
    
    document.getElementById('log-photo-input').value = '';
    document.getElementById('log-photo-preview').style.display = 'none';
    document.getElementById('log-bg-remove-label').style.display = 'none';
    document.getElementById('log-bg-remove-checkbox').checked = false;
    logPhotoBase64 = null;
    
    document.getElementById('log-care-type').value = 'none';
    document.getElementById('log-memo').value = '';
}

function closeLogForm() {
    document.getElementById('growth-log-form').style.display = 'none';
    document.getElementById('btn-open-log-form').style.display = 'block';
    
    document.getElementById('log-photo-input').value = '';
    document.getElementById('log-photo-preview').style.display = 'none';
    document.getElementById('log-bg-remove-label').style.display = 'none';
    document.getElementById('log-bg-remove-checkbox').checked = false;
    logPhotoBase64 = null;
}

function removeLogPhoto() {
    document.getElementById('log-photo-input').value = '';
    document.getElementById('log-photo-preview').style.display = 'none';
    document.getElementById('log-bg-remove-label').style.display = 'none';
    document.getElementById('log-bg-remove-checkbox').checked = false;
    logPhotoBase64 = null;
}

function saveGrowthLog(e) {
    e.preventDefault();
    if (!currentDetailPlantId) return;
    
    const plant = AppState.plants.find(p => p.id === currentDetailPlantId);
    if (!plant) return;
    
    const logDate = document.getElementById('log-date').value;
    const careType = document.getElementById('log-care-type').value;
    const memo = document.getElementById('log-memo').value.trim();
    
    const isActivity = careType !== 'none';
    const type = isActivity ? careType : 'diary';
    
    const logDateObj = logDate ? new Date(logDate) : new Date();
    // Keep today's current time for accuracy unless user changed date, in which case default to noon
    const now = new Date();
    if (logDateObj.toDateString() !== now.toDateString()) {
        logDateObj.setHours(12, 0, 0, 0);
    } else {
        logDateObj.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
    }
    
    const newRecord = {
        id: 'rec_' + Date.now(),
        date: logDateObj.toISOString(),
        type: type,
        memo: memo || (isActivity ? getDefaultCareMemo(type, plant.nickname) : '📝 오늘 하루 성장 일지를 귀엽게 기록했습니다.'),
        image: logPhotoBase64 || null
    };
    
    if (!plant.records) plant.records = [];
    plant.records.push(newRecord);
    
    if (type === 'water') {
        // Overwrite lastWatered if this is newer
        if (!plant.lastWatered || new Date(newRecord.date) > new Date(plant.lastWatered)) {
            plant.lastWatered = newRecord.date;
        }
    }
    
    savePlantsToStorage();
    renderArchive();
    openDetailModal(plant.id);
    
    addXP(isActivity ? 30 : 20);
    if (type === 'water') {
        unlockBadge('oasis');
    }
    
    showAlert(`🌱 [${plant.nickname}]의 성장 다이어리를 정상적으로 보관했습니다!`);
    closeLogForm();
}

