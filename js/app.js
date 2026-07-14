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
    aiBoundingBox: null,
    aiPolygon: null,
    stream: null,
    geminiKey: null,
    naverId: null,
    naverSecret: null,
    currentNaverData: null
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
    },
    carlyan: {
        name: '캐라리언',
        image: 'assets/clay_succulent_carlyan.png',
        theme: 'carlyan',
        waterInterval: 12
    }
};

// Badges list
const BADGES = [
    { id: 'first_plant', name: '첫 만남 🌱', desc: '첫 마이팟을 무사히 등록 완료!', icon: '🌱' },
    { id: 'oasis', name: '오아시스 💧', desc: '식물에게 첫 물주기 완료', icon: '💧' },
    { id: 'greenthumb', name: '초록손 👑', desc: '3개 이상의 마이팟 등록하기', icon: '👑' }
];

// --- Initializing App ---
document.addEventListener('DOMContentLoaded', () => {
    loadDataFromStorage();
    syncPlantsFromDatabase(); // Background sync from Vercel KV database
    initNavigation();
    initRegistrationFlow();
    initDetailModalFlow();
    renderArchive();
    renderBadges();
    updateUserBadgeUI();
    initGardenCalendarFlow();
    initActionSelectionFlow();
    initGrowthRecordFlow();
    
    // Set default date for date picker to today
    document.getElementById('plant-adoption').valueAsDate = new Date();
    
    // Onboarding Screen Start button click handler & dynamic label
    const onboardingStartBtn = document.getElementById('btn-onboarding-start');
    if (onboardingStartBtn) {
        if (AppState.plants && AppState.plants.length > 0) {
            onboardingStartBtn.textContent = '시작하기';
        } else {
            onboardingStartBtn.textContent = '첫 마이팟 등록하고 시작하기';
        }
        
        onboardingStartBtn.addEventListener('click', () => {
            const onboarding = document.getElementById('onboarding-screen');
            if (onboarding) {
                onboarding.classList.remove('active');
            }
            // Only open registration modal if user has no plants
            if (!AppState.plants || AppState.plants.length === 0) {
                openRegisterModal();
            }
        });
    }
    
    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('Service Worker registered successfully!', reg))
            .catch(err => console.log('Service Worker registration failed:', err));
    }
});

// --- Local Storage Handlers ---
function loadDataFromStorage() {
    let savedPlants = null;
    let savedUser = null;
    
    try {
        savedPlants = localStorage.getItem('pot2pot_plants');
        savedUser = localStorage.getItem('pot2pot_user');
    } catch (err) {
        console.error("Failed to read from localStorage:", err);
    }
    
    if (savedPlants) {
        try {
            AppState.plants = JSON.parse(savedPlants);
        } catch (e) {
            console.error("Failed to parse saved plants:", e);
            initializeDefaultPlants();
        }
    } else {
        initializeDefaultPlants();
    }
    
    if (savedUser) {
        try {
            AppState.user = JSON.parse(savedUser);
        } catch (e) {
            console.error("Failed to parse saved user:", e);
            initializeDefaultUser();
        }
    } else {
        initializeDefaultUser();
    }
    
    // Migrate and crop transparent borders from existing images (Gymnocalycium fix)
    migrateAndCropExistingPlants();
    
    // Migrate existing plants to 3D clay icons if applicable
    migrateExistingPlantsTo3D();
    
    try {
        const savedGeminiKey = localStorage.getItem('pot2pot_gemini_key');
        if (savedGeminiKey) {
            AppState.geminiKey = savedGeminiKey;
        }

        const savedNaverId = localStorage.getItem('pot2pot_naver_client_id');
        const savedNaverSecret = localStorage.getItem('pot2pot_naver_client_secret');
        if (savedNaverId) AppState.naverId = savedNaverId;
        if (savedNaverSecret) AppState.naverSecret = savedNaverSecret;
    } catch (err) {
        console.error("Failed to load settings keys from localStorage:", err);
    }
}

function initializeDefaultPlants() {
    AppState.plants = [];
    savePlantsToStorage();
}

function migrateAndCropExistingPlants() {
    if (!AppState.plants || AppState.plants.length === 0) return;
    
    let updated = false;
    const promises = AppState.plants.map(plant => {
        return new Promise((resolve) => {
            // Check if it is a base64 PNG image (cutout)
            if (!plant.image || !plant.image.startsWith('data:image/png;base64,')) {
                resolve();
                return;
            }
            
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth || img.width;
                    canvas.height = img.naturalHeight || img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    
                    if (window.cropTransparentCanvas) {
                        const croppedCanvas = window.cropTransparentCanvas(canvas);
                        // Only update if dimensions actually changed (i.e. margins were cropped)
                        if (croppedCanvas.width !== canvas.width || croppedCanvas.height !== canvas.height) {
                            plant.image = croppedCanvas.toDataURL('image/png');
                            updated = true;
                            console.log(`Cropped and centered existing plant: ${plant.nickname}`);
                        }
                    }
                } catch (e) {
                    console.error(`Failed to crop existing plant ${plant.nickname}:`, e);
                }
                resolve();
            };
            img.onerror = () => resolve();
            img.src = plant.image;
        });
    });
    
    Promise.all(promises).then(() => {
        if (updated) {
            savePlantsToStorage();
            renderArchive();
        }
    });
}

function migrateExistingPlantsTo3D() {
    if (!AppState.plants || AppState.plants.length === 0) return;
    
    let updated = false;
    AppState.plants.forEach(plant => {
        const species = plant.species || '';
        const nickname = plant.nickname || '';
        const theme = plant.theme || '';
        
        let target3D = null;
        
        if (species.includes('비모란') || nickname.includes('비모란')) {
            target3D = 'assets/clay_bimoran_sticker.png';
        } else if (species.includes('레드베리') || nickname.includes('레드베리')) {
            target3D = 'assets/clay_redberry_sticker.png';
        } else if (species.includes('오십령옥') || nickname.includes('오십령옥')) {
            target3D = 'assets/clay_babytoes_sticker.png';
        } else if (species.includes('크리스마스') || nickname.includes('크리스마스')) {
            target3D = 'assets/clay_christmas_sticker.png';
        } else if (species.includes('캐라리언') || nickname.includes('캐라리언') || theme === 'carlyan') {
            target3D = 'assets/clay_succulent_carlyan_sticker.png';
        } else if (species.includes('몬스테라') || nickname.includes('몬스테라') || theme === 'monstera') {
            target3D = 'assets/clay_monstera_sticker.png';
        } else if (species.includes('선인장') || nickname.includes('선인장') || theme === 'cactus') {
            target3D = 'assets/clay_cactus_sticker.png';
        } else if (species.includes('산세베리아') || nickname.includes('산세베리아') || theme === 'snake') {
            target3D = 'assets/clay_snake_sticker.png';
        } else {
            target3D = 'assets/clay_generic_sticker.png';
        }
        
        if (target3D && plant.image !== target3D) {
            if (!plant.originalImage) {
                plant.originalImage = plant.image;
            }
            plant.image = target3D;
            updated = true;
            console.log(`Migrated existing plant ${plant.nickname} to 3D thumbnail: ${target3D}`);
        }
    });
    
    if (updated) {
        savePlantsToStorage();
        renderArchive();
    }
}

function initializeDefaultUser() {
    AppState.user = {
        level: 1,
        xp: 0,
        title: "초보 식집사",
        unlockedBadges: []
    };
    saveUserToStorage();
}

function savePlantsToStorage() {
    try {
        localStorage.setItem('pot2pot_plants', JSON.stringify(AppState.plants));
    } catch (e) {
        console.error("Failed to save plants to localStorage:", e);
        if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
            // Trigger auto-compression of high-res image data
            compressStoredPlants();
        }
    }
    syncPlantsToDatabase(); // Sync with Vercel KV database in the background
}

function saveUserToStorage() {
    try {
        localStorage.setItem('pot2pot_user', JSON.stringify(AppState.user));
    } catch (e) {
        console.error("Failed to save user to localStorage:", e);
    }
}

function compressStoredPlants() {
    let compressedCount = 0;
    AppState.plants.forEach(plant => {
        if (plant.image && plant.image.startsWith('data:image') && plant.image.length > 150000) {
            const img = new Image();
            img.onload = () => {
                const maxDim = 300;
                const width = img.width;
                const height = img.height;
                if (width > maxDim || height > maxDim) {
                    const scale = maxDim / Math.max(width, height);
                    const w = Math.round(width * scale);
                    const h = Math.round(height * scale);
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    
                    plant.image = canvas.toDataURL('image/png');
                    compressedCount++;
                    
                    try {
                        localStorage.setItem('pot2pot_plants', JSON.stringify(AppState.plants));
                        console.log(`Compressed image for plant ${plant.nickname} to save storage space.`);
                    } catch (err) {
                        console.error("Still exceeding quota after compression:", err);
                    }
                }
            };
            img.src = plant.image;
        }
    });
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
        openActionSelectionModal();
    });
    
    // Trophy Button click to open unified garden calendar modal
    const heroTrophyBtn = document.getElementById('btn-hero-trophy');
    if (heroTrophyBtn) {
        heroTrophyBtn.addEventListener('click', () => {
            openGardenCalendarModal();
        });
    }
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
        
        // Reset scroll to top when switching views
        const scrollable = activeScreen.querySelector('.scrollable-content');
        if (scrollable) {
            scrollable.scrollTop = 0;
        }
    }
    
    const activeNavItem = document.querySelector(`.nav-item[data-view="${viewName}"]`);
    if (activeNavItem) {
        activeNavItem.classList.add('active');
    }
    
    // Render badges dynamically if settings is visited
    if (viewName === 'settings') {
        renderBadges();
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
        showAlert(`🏆 그린레벨 배지 획득! [${badge.name}] 배지를 획득했습니다.`);
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
    const userLvl = document.getElementById('user-lvl');
    const userTitle = document.getElementById('user-title');
    const heroUserLvl = document.getElementById('hero-user-lvl');
    
    if (userLvl) userLvl.textContent = AppState.user.level;
    if (userTitle) userTitle.textContent = AppState.user.title;
    if (heroUserLvl) heroUserLvl.textContent = AppState.user.level;
}

// --- Plant Registration Flow ---
function initRegistrationFlow() {
    const modalOverlay = document.getElementById('register-modal');
    const closeBtn = document.getElementById('modal-close');
    const modalBackBtn = document.getElementById('modal-back');
    const container = document.getElementById('step-container');
    
    // Close modal
    closeBtn.addEventListener('click', closeRegisterModal);
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeRegisterModal();
    });
    
    if (modalBackBtn) {
        modalBackBtn.addEventListener('click', () => {
            if (AppState.registerStep > 1) {
                goToStep(AppState.registerStep - 1);
            }
        });
    }
    
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
            AppState.segmenter.autoRemoveWhiteBackground(22, AppState.aiBoundingBox, AppState.aiPolygon);
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
                
                // Fetch Naver encyclopedia in background for presets
                AppState.currentNaverData = null;
                fetchNaverEncyclopedia(preset.name).then(naverResult => {
                    if (naverResult) AppState.currentNaverData = naverResult;
                });
            } else {
                document.getElementById('plant-species').value = 'AI 분석 중...';
                document.getElementById('plant-nickname').value = 'AI 분석 중...';
                document.getElementById('water-slider').value = 7;
                updateWaterIntervalValue(7);
                
                // Automatically run Gemini + NAVER AI plant analysis in background
                analyzePlantWithAI();
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

    // (Manual AI analyze button click listener removed as it is now automatic)

    // Step 3: Naver Search on species input change
    const speciesInput = document.getElementById('plant-species');
    if (speciesInput) {
        speciesInput.addEventListener('change', async (e) => {
            const val = e.target.value.trim();
            if (val) {
                const naverResult = await fetchNaverEncyclopedia(val);
                if (naverResult) {
                    AppState.currentNaverData = naverResult;
                }
            }
        });
    }
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
    
    // Toggle header back button visibility
    const modalBackBtn = document.getElementById('modal-back');
    if (modalBackBtn) {
        if (stepNum > 1) {
            modalBackBtn.style.visibility = 'visible';
        } else {
            modalBackBtn.style.visibility = 'hidden';
        }
    }
    
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
    
    // Clear previous AI Bounding Box & Polygon
    AppState.aiBoundingBox = null;
    AppState.aiPolygon = null;
    
    // Request plant bounding box/polygon in parallel if not preset
    let bboxPromise = Promise.resolve(null);
    if (!AppState.selectedPreset) {
        bboxPromise = detectPlantBoundingBoxWithAI();
    }
    
    // Simulate AI cutout logic with scanner bar
    let progress = 0;
    const progressText = overlay.querySelector('p');
    
    const interval = setInterval(async () => {
        progress += 10;
        progressText.textContent = `피사체 탐색 중... ${progress}%`;
        
        if (progress >= 100) {
            clearInterval(interval);
            
            // Await AI Bounding Box/Polygon with a timeout safety margin
            try {
                const aiResult = await Promise.race([
                    bboxPromise,
                    new Promise(resolve => setTimeout(() => resolve(null), 2500))
                ]);
                const badge = document.getElementById('ai-status-badge');
                if (AppState.selectedPreset) {
                    if (badge) {
                        badge.textContent = "🪴 샘플 이미지";
                        badge.className = "ai-status-badge ai-preset";
                    }
                } else if (aiResult) {
                    console.log("Gemini AI detected result:", aiResult);
                    AppState.aiBoundingBox = aiResult.box_2d || null;
                    AppState.aiPolygon = aiResult.polygon || null;
                    if (badge) {
                        badge.textContent = "✨ AI 스마트 누끼";
                        badge.className = "ai-status-badge ai-active";
                    }
                } else {
                    console.warn("Gemini AI detection failed or skipped. Falling back to local segmenter.");
                    AppState.aiBoundingBox = null;
                    AppState.aiPolygon = null;
                    if (badge) {
                        badge.textContent = "🪄 일반 색상 누끼";
                        badge.className = "ai-status-badge ai-inactive";
                    }
                }
            } catch (err) {
                console.error("Error awaiting bounding box/polygon:", err);
            }
            
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
            AppState.segmenter.autoRemoveWhiteBackground(22, AppState.aiBoundingBox, AppState.aiPolygon);
        }
    };
    
    tempImg.src = AppState.capturedImageSrc;
}

// --- On-the-fly 3D Clay Sticker Generation Canvas Helpers ---
function removeBackgroundCanvas(ctx, width, height) {
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    
    // Detect background color at top-left corner
    const bgR = data[0];
    const bgG = data[1];
    const bgB = data[2];
    
    const potRimY = Math.floor(height * 0.55);
    
    // BFS for lower part (shadows)
    const bfsMask = new Uint8Array(width * height);
    const visited = new Uint8Array(width * height);
    const queue = [];
    
    // Seed all edge pixels
    for (let x = 0; x < width; x++) {
        queue.push(0 * width + x); // top
        queue.push((height - 1) * width + x); // bottom
        visited[0 * width + x] = 1;
        visited[(height - 1) * width + x] = 1;
    }
    for (let y = 1; y < height - 1; y++) {
        queue.push(y * width + 0); // left
        queue.push(y * width + (width - 1)); // right
        visited[y * width + 0] = 1;
        visited[y * width + (width - 1)] = 1;
    }
    
    let head = 0;
    while (head < queue.length) {
        const curr = queue[head++];
        const cy = Math.floor(curr / width);
        const cx = curr % width;
        
        const idx = curr * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        
        const distBg = Math.sqrt((r - bgR)**2 + (g - bgG)**2 + (b - bgB)**2);
        const isBgColor = distBg < 50;
        
        const colorRange = Math.max(r, g, b) - Math.min(r, g, b);
        const isNeutralGray = colorRange < 20 && r > 80;
        
        if (isBgColor || isNeutralGray) {
            bfsMask[curr] = 1;
            for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                const nx = cx + dx;
                const ny = cy + dy;
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    const nidx = ny * width + nx;
                    if (visited[nidx] === 0) {
                        visited[nidx] = 1;
                        queue.push(nidx);
                    }
                }
            }
        }
    }
    
    // Apply hybrid mask
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            
            if (y < potRimY) {
                // Upper part: very tight global check (tolerance < 15)
                const distBg = Math.sqrt((r - bgR)**2 + (g - bgG)**2 + (b - bgB)**2);
                if (distBg < 15) {
                    data[idx + 3] = 0; // transparent
                }
            } else {
                // Lower part: BFS check
                if (bfsMask[y * width + x] === 1) {
                    data[idx + 3] = 0;
                }
            }
        }
    }
    
    ctx.putImageData(imgData, 0, 0);
}

function cleanCanvasStrayNoise(ctx, width, height) {
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    
    const compIds = new Int32Array(width * height).fill(-1);
    const compSizes = [];
    let currentId = 0;
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const alpha = data[idx + 3];
            
            if (alpha > 8 && compIds[y * width + x] === -1) {
                const component = [];
                const queue = [y * width + x];
                compIds[y * width + x] = currentId;
                
                let head = 0;
                while (head < queue.length) {
                    const curr = queue[head++];
                    component.push(curr);
                    
                    const cy = Math.floor(curr / width);
                    const cx = curr % width;
                    
                    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                        const nx = cx + dx;
                        const ny = cy + dy;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            const nidx = ny * width + nx;
                            const nPixelIdx = nidx * 4;
                            if (data[nPixelIdx + 3] > 8 && compIds[nidx] === -1) {
                                compIds[nidx] = currentId;
                                queue.push(nidx);
                            }
                        }
                    }
                }
                
                compSizes[currentId] = component.length;
                currentId++;
            }
        }
    }
    
    if (compSizes.length === 0) return;
    
    let largestId = 0;
    let maxVal = 0;
    for (let i = 0; i < compSizes.length; i++) {
        if (compSizes[i] > maxVal) {
            maxVal = compSizes[i];
            largestId = i;
        }
    }
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (compIds[idx] !== largestId) {
                const pixelIdx = idx * 4;
                data[pixelIdx + 3] = 0;
            }
        }
    }
    
    ctx.putImageData(imgData, 0, 0);
}

function cropCanvasTransparent(canvas) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    
    let minX = width, maxX = 0, minY = height, maxY = 0;
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const alpha = data[(y * width + x) * 4 + 3];
            if (alpha > 8) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    
    if (maxX < minX || maxY < minY) return canvas;
    
    const cropW = (maxX - minX) + 1;
    const cropH = (maxY - minY) + 1;
    
    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = cropW;
    croppedCanvas.height = cropH;
    croppedCanvas.getContext('2d').drawImage(canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
    
    return croppedCanvas;
}

function createStickerFromImage(croppedCanvas) {
    const w = croppedCanvas.width;
    const h = croppedCanvas.height;
    
    const outlineRadius = Math.max(6, Math.round(w * 0.022));
    const shadowBlur = Math.max(4, Math.round(w * 0.012));
    const shadowOffsetY = Math.max(2, Math.round(w * 0.008));
    
    const padding = outlineRadius + shadowBlur + shadowOffsetY + 15;
    const newW = w + padding * 2;
    const newH = h + padding * 2;
    
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = newW;
    finalCanvas.height = newH;
    const finalCtx = finalCanvas.getContext('2d');
    
    finalCtx.save();
    finalCtx.shadowColor = 'rgba(0, 0, 0, 0.22)';
    finalCtx.shadowBlur = shadowBlur;
    finalCtx.shadowOffsetY = shadowOffsetY;
    
    const silCanvas = document.createElement('canvas');
    silCanvas.width = newW;
    silCanvas.height = newH;
    const silCtx = silCanvas.getContext('2d');
    silCtx.drawImage(croppedCanvas, padding, padding);
    silCtx.globalCompositeOperation = 'source-in';
    silCtx.fillStyle = '#FFFFFF';
    silCtx.fillRect(0, 0, newW, newH);
    
    const steps = Math.max(16, Math.round(outlineRadius * 1.5));
    for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        const dx = Math.round(Math.cos(angle) * outlineRadius);
        const dy = Math.round(Math.sin(angle) * outlineRadius);
        finalCtx.drawImage(silCanvas, dx, dy);
    }
    
    for (let dx = -outlineRadius; dx <= outlineRadius; dx++) {
        for (let dy = -outlineRadius; dy <= outlineRadius; dy++) {
            if (dx*dx + dy*dy <= outlineRadius*outlineRadius) {
                finalCtx.drawImage(silCanvas, dx, dy);
            }
        }
    }
    finalCtx.restore();
    
    finalCtx.drawImage(croppedCanvas, padding, padding);
    return cropCanvasTransparent(finalCanvas);
}

async function generate3DClayStickerOnTheFly(speciesName) {
    const prompt = `Minimalist 3D render of a cute ${speciesName} plant in a simple smooth matte beige ceramic pot. Stylized, smooth matte plastic/clay textures, clean shading, rounded shapes, pure solid white background, isolated, soft lighting, 3D asset style.`;
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=500&height=500&nologo=true&private=true&enhance=false`;

    const res = await fetch(url);
    if (!res.ok) {
        throw new Error('Failed to generate image from Pollinations AI');
    }
    const blob = await res.blob();
    const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
    
    const stickerDataUrl = await new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                
                removeBackgroundCanvas(ctx, img.width, img.height);
                cleanCanvasStrayNoise(ctx, img.width, img.height);
                const croppedCanvas = cropCanvasTransparent(canvas);
                const stickerCanvas = createStickerFromImage(croppedCanvas);
                
                resolve(stickerCanvas.toDataURL('image/png'));
            } catch (err) {
                reject(err);
            }
        };
        img.onerror = () => reject(new Error('Failed to load generated image into canvas'));
        img.src = dataUrl;
    });
    
    return stickerDataUrl;
}

// Save Plant to Archive
async function saveNewPlant() {
    const btnSubmit = document.querySelector('.btn-submit-plant');
    const originalBtnHTML = btnSubmit.innerHTML;
    
    // Disable submit button and show spinner
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = `<div class="ai-spinner" style="display:inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.2); border-top: 2px solid #FFFFFF; border-radius: 50%; animation: ai-spin 0.8s linear infinite; margin-right: 8px; vertical-align: middle;"></div> 3D 캐릭터 화분 생성 중...`;
    
    try {
        const nickname = document.getElementById('plant-nickname').value.trim() || '내 식물';
        const species = document.getElementById('plant-species').value.trim() || '반려식물';
        const interval = parseInt(document.getElementById('water-slider').value);
        const adoptionDate = document.getElementById('plant-adoption').value || new Date().toISOString();
        
        const realCutout = AppState.segmenter.getMaskedBase64();
        let displayImage = null;
        let originalImage = realCutout;
        
        // Smart Semantic Mapping to Curated 3D Clay Plant Stickers
        const specLower = species.toLowerCase();
        const nickLower = nickname.toLowerCase();
        
        function matches(keywords) {
            return keywords.some(k => specLower.includes(k) || nickLower.includes(k));
        }

        if (matches(['비모란', 'graft cactus', 'bimoran'])) {
            displayImage = 'assets/clay_bimoran_sticker.png';
        } else if (matches(['레드베리', 'redberry', 'red berry'])) {
            displayImage = 'assets/clay_redberry_sticker.png';
        } else if (matches(['오십령옥', 'baby toes', 'babytoes', 'fenestraria'])) {
            displayImage = 'assets/clay_babytoes_sticker.png';
        } else if (matches(['크리스마스', 'christmas', 'echeveria christmas'])) {
            displayImage = 'assets/clay_christmas_sticker.png';
        } else if (matches(['캐라리언', 'carlyan', 'succulent carlyan'])) {
            displayImage = 'assets/clay_succulent_carlyan_sticker.png';
        } else if (matches(['몬스테라', 'monstera', '필로덴드론', 'philodendron', '안스리움', 'anthurium', '칼라테아', 'calathea', '알로카시아', 'alocasia'])) {
            displayImage = 'assets/clay_monstera_sticker.png';
        } else if (matches(['선인장', 'cactus', '다육', 'succulent', '용과'])) {
            displayImage = 'assets/clay_cactus_sticker.png';
        } else if (matches(['산세베리아', 'sansevieria', '금전수', '돈나무', '스투키', 'stuckyi', 'zz plant', '스네이크', 'snake plant'])) {
            displayImage = 'assets/clay_snake_sticker.png';
        } else if (matches(['페페', '필레아', '동전패패', 'pepe', 'pilea', 'peperomia'])) {
            displayImage = 'assets/clay_pepe_sticker.png';
        } else if (matches(['아이비', 'ivy', '스킨답서스', 'scindapsus', '포토스', 'pothos', '싱고니움', 'syngonium', '트리안'])) {
            displayImage = 'assets/clay_ivy_sticker.png';
        } else if (matches(['야자', 'palm', '테이블야자', '아레카', '켄차', '야자수'])) {
            displayImage = 'assets/clay_palm_sticker.png';
        } else if (matches(['로즈마리', 'rosemary', '라벤더', 'lavender', '허브', 'herb', '민트', 'mint', '바질', 'basil', '유칼립투스', 'eucalyptus'])) {
            displayImage = 'assets/clay_herb_sticker.png';
        } else if (AppState.selectedPreset === 'carlyan') {
            displayImage = 'assets/clay_succulent_carlyan_sticker.png';
        } else if (AppState.selectedPreset === 'monstera') {
            displayImage = 'assets/clay_monstera_sticker.png';
        } else if (AppState.selectedPreset === 'cactus') {
            displayImage = 'assets/clay_cactus_sticker.png';
        } else if (AppState.selectedPreset === 'snake') {
            displayImage = 'assets/clay_snake_sticker.png';
        } else {
            // Default fallback is the generic sprout, which is extremely cute and matches the style perfectly!
            displayImage = 'assets/clay_generic_sticker.png';
        }
    
        const newPlant = {
            id: 'plant_' + Date.now(),
            nickname: nickname,
            species: species,
            theme: AppState.selectedPreset || 'custom',
            image: displayImage,
            originalImage: originalImage,
            waterInterval: interval,
            lastWatered: new Date().toISOString(), // set last watered to today
            adoptionDate: new Date(adoptionDate).toISOString(),
            naverDesc: AppState.currentNaverData?.description || null,
            naverLink: AppState.currentNaverData?.link || null,
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
    } catch (err) {
        console.error("Failed to save plant:", err);
        showAlert("⚠️ 식물 등록 중에 오류가 발생했습니다.");
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = originalBtnHTML;
    }
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
    const overviewContainer = document.getElementById('garden-overview');
    
    // 1. Calculate and Render Overall Garden Status (Overview)
    if (overviewContainer) {
        let urgentCount = 0;
        let warningCount = 0;
        let safeCount = 0;
        const total = AppState.plants.length;
        
        AppState.plants.forEach(plant => {
            const daysRemaining = getDaysRemaining(plant);
            if (daysRemaining <= 0) {
                urgentCount++;
            } else if (daysRemaining <= 3) {
                warningCount++;
            } else {
                safeCount++;
            }
        });
        
        let score = 0;
        let emoji = '🌱';
        let summaryText = '';
        let tagText = '등록 대기';
        let tagClass = 'empty';
        let gardenStateName = '새로운 시작';
        
        if (total === 0) {
            score = 0;
            emoji = '🌱';
            summaryText = '<span class="summary-status-dot empty"></span> <strong>등록 대기</strong> : 아직 등록된 식물이 없습니다. 하단의 "+" 버튼을 눌러 첫 반려식물을 등록해 보세요!';
            tagText = '등록 대기';
            tagClass = 'empty';
            gardenStateName = '새로운 시작';
        } else {
            // Safe has weight 1.0, warning has weight 0.5, urgent has weight 0
            score = Math.round(((safeCount + warningCount * 0.5) / total) * 100);
            if (score >= 80) {
                emoji = '🌿';
                summaryText = '<span class="summary-status-dot safe"></span> <strong>안전함</strong> : 정원의 모든 식물들이 물을 듬뿍 머금고 건강하게 자라는 중입니다!';
                tagText = '정원 안전';
                tagClass = 'safe';
                gardenStateName = '싱그러운 초록숲';
            } else if (score >= 40) {
                emoji = '🪴';
                summaryText = `<span class="summary-status-dot warning"></span> <strong>주의</strong> : 조만간 물을 줘야 하는 식물이 <strong>${warningCount}개</strong> 있습니다. 일정을 체크해 주세요.`;
                tagText = '물주기 주의';
                tagClass = 'warning';
                gardenStateName = '목마른 꽃밭';
            } else {
                emoji = '🥀';
                summaryText = `<span class="summary-status-dot urgent"></span> <strong>경고</strong> : 목마른 식물이 <strong>${urgentCount}개</strong> 있습니다! 빠르게 물을 주어 돌봐주세요.`;
                tagText = '수분 부족 경고';
                tagClass = 'urgent';
                gardenStateName = '바짝 마른 사막';
            }
            
            // Overwrite summary/tag if urgent count is greater than 0
            if (urgentCount > 0) {
                emoji = '🥀';
                summaryText = `<span class="summary-status-dot urgent"></span> <strong>경고</strong> : 목마른 식물이 <strong>${urgentCount}개</strong> 있습니다! 빠르게 물을 주어 돌봐주세요.`;
                tagText = '수분 부족 경고';
                tagClass = 'urgent';
                gardenStateName = '바짝 마른 사막';
            }
        }
        
        const strokeDashOffset = total === 0 ? 251.2 : 251.2 - (251.2 * score) / 100;
        
        overviewContainer.innerHTML = `
            <div class="overview-card">
                <div class="overview-header">
                    <span class="overview-status-tag ${tagClass}">${tagText}</span>
                    <h3 class="overview-title">수아 님의 정원은 현재 <strong>${gardenStateName}</strong> 입니다</h3>
                </div>
                <div class="overview-main">
                    <div class="progress-circle-wrapper">
                        <svg viewBox="0 0 100 100" class="progress-circle">
                            <circle cx="50" cy="50" r="40" stroke="rgba(255, 255, 255, 0.06)" stroke-width="8" fill="transparent"></circle>
                            <circle cx="50" cy="50" r="40" stroke="#CDFF62" stroke-width="8" fill="transparent"
                                    stroke-dasharray="251.2" stroke-dashoffset="${strokeDashOffset}"
                                    stroke-linecap="round" class="progress-circle-bar" style="transform: rotate(-90deg); transform-origin: 50% 50%; transition: stroke-dashoffset 0.8s ease-out;"></circle>
                        </svg>
                        <div class="progress-inner-content">
                            <span class="progress-emoji">${emoji}</span>
                            <span class="progress-percent">${total === 0 ? '-' : score + '%'}</span>
                        </div>
                    </div>
                    
                    <div class="overview-legend">
                        <div class="legend-item safe">
                            <span class="dot"></span>
                            <span class="label">안전함</span>
                            <span class="count">${safeCount}개</span>
                        </div>
                        <div class="legend-item warning">
                            <span class="dot"></span>
                            <span class="label">주의 (3일 내)</span>
                            <span class="count">${warningCount}개</span>
                        </div>
                        <div class="legend-item urgent">
                            <span class="dot"></span>
                            <span class="label">물 필요</span>
                            <span class="count">${urgentCount}개</span>
                        </div>
                    </div>
                </div>
                <div class="overview-summary-box">
                    <p class="summary-text">${summaryText}</p>
                </div>
            </div>
        `;
    }
    
    // 2. Render Plants Grid
    if (grid) {
        grid.innerHTML = '';
        
        if (AppState.plants.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🪴</div>
                    <h3>마이팟을 등록해보세요!</h3>
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
                </div>
            `;
            
            // Show detailed view overlay on click
            card.addEventListener('click', () => {
                openDetailModal(plant.id);
            });
            
            grid.appendChild(card);
        });
    }
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

// Render Badges View
function renderBadges() {
    const container = document.getElementById('badges-container');
    if (!container) return;
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

// --- Plant Detail View & Event Listeners ---
let currentDetailPlantId = null;
let currentCalendarMonth = new Date();
let logPhotoBase64 = null;

function initDetailModalFlow() {
    const modal = document.getElementById('detail-modal');
    const closeBtn = document.getElementById('detail-modal-close');
    const deleteBtn = document.getElementById('btn-detail-delete');
    
    // Close modal
    closeBtn.addEventListener('click', closeDetailModal);
    if (deleteBtn) {
        deleteBtn.addEventListener('click', deleteCurrentPlant);
    }
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeDetailModal();
    });
    
    // Quick care actions
    document.getElementById('btn-care-water').addEventListener('click', () => addCareActivity('water'));
    document.getElementById('btn-care-rotate').addEventListener('click', () => addCareActivity('rotate'));
    document.getElementById('btn-care-trim').addEventListener('click', () => addCareActivity('trim'));
    
    const footerWaterBtn = document.getElementById('btn-footer-water-action');
    if (footerWaterBtn) {
        footerWaterBtn.addEventListener('click', () => addCareActivity('water'));
    }
    
    // Tabs click
    document.querySelectorAll('#detail-modal .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-tab');
            switchDetailTab(tab);
        });
    });
    
    // Open Growth Log Wizard Modal
    document.getElementById('btn-open-log-form').addEventListener('click', () => {
        closeDetailModal();
        openGrowthRecordModal(currentDetailPlantId);
    });
    
    // Calendar Navigation
    document.getElementById('btn-cal-prev').addEventListener('click', () => navigateCalendar(-1));
    document.getElementById('btn-cal-next').addEventListener('click', () => navigateCalendar(1));
    
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
    
    // Collect all archived background-removed sticker images
    const plantPhotos = [plant.originalImage || plant.image];
    if (plant.records) {
        const sortedRecsForPhotos = [...plant.records].sort((a, b) => new Date(a.date) - new Date(b.date));
        sortedRecsForPhotos.forEach(rec => {
            if (rec.image && !plantPhotos.includes(rec.image)) {
                plantPhotos.push(rec.image);
            }
        });
    }
    
    // Setup image carousel
    currentCarouselIdx = 0;
    setupDetailCarousel(plantPhotos);
    
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
    document.getElementById('detail-age').textContent = `${diffDays}일`;
    
    // Cycle
    document.getElementById('detail-cycle').textContent = `${plant.waterInterval}일`;
    
    // Water index progress fill
    let progressPercent = 0;
    if (daysRemaining > 0) {
        progressPercent = Math.min(100, Math.round((daysRemaining / plant.waterInterval) * 100));
    }
    document.getElementById('water-progress-percent').textContent = `${progressPercent}%`;
    document.getElementById('water-progress-fill').style.width = `${progressPercent}%`;
    
    const footerMoisture = document.getElementById('detail-footer-moisture');
    if (footerMoisture) {
        footerMoisture.textContent = `${progressPercent}%`;
    }
    
    // Render Naver Encyclopedia details
    const naverCard = document.getElementById('detail-naver-card');
    const naverDesc = document.getElementById('detail-naver-desc');
    const naverLink = document.getElementById('detail-naver-link');
    
    if (naverCard && naverDesc && naverLink) {
        if (plant.naverDesc) {
            naverCard.style.display = 'flex';
            naverDesc.textContent = plant.naverDesc;
            naverLink.href = plant.naverLink || '#';
        } else {
            naverCard.style.display = 'none';
        }
    }

    switchDetailTab('timeline');
    renderTimeline(plant);
    renderCalendar(plant);
    
    document.getElementById('detail-modal').classList.add('active');
}

function closeDetailModal() {
    document.getElementById('detail-modal').classList.remove('active');
    currentDetailPlantId = null;
}

let currentCarouselIdx = 0;

function setupDetailCarousel(photos) {
    const imgContainer = document.querySelector('#detail-modal .detail-img-container');
    if (!imgContainer) return;
    
    imgContainer.innerHTML = '';
    
    // Centered flex layout for single sticker, left-aligned scrollable for multiple stickers
    if (photos.length > 1) {
        imgContainer.style.justifyContent = 'flex-start';
    } else {
        imgContainer.style.justifyContent = 'center';
    }
    
    photos.forEach((photoSrc, idx) => {
        const img = document.createElement('img');
        img.src = photoSrc;
        img.alt = `식물 사진 ${idx + 1}`;
        img.style.animationDelay = `${idx * 0.4}s`;
        imgContainer.appendChild(img);
    });
    
    // Hide indicators because all stickers are displayed side-by-side
    const indicatorsContainer = document.querySelector('#detail-modal .detail-image-indicators');
    if (indicatorsContainer) {
        indicatorsContainer.style.display = 'none';
    }
}

function deleteCurrentPlant() {
    if (!currentDetailPlantId) return;
    
    const plant = AppState.plants.find(p => p.id === currentDetailPlantId);
    if (!plant) return;
    
    if (confirm(`정말 [${plant.nickname}] 화분을 정원에서 삭제하시겠습니까?\n등록된 성장 기록과 다이어리가 모두 삭제되며 복구할 수 없습니다.`)) {
        AppState.plants = AppState.plants.filter(p => p.id !== currentDetailPlantId);
        savePlantsToStorage();
        renderArchive();
        closeDetailModal();
        showAlert(`🪴 [${plant.nickname}] 화분이 안전하게 삭제되었습니다.`);
    }
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
        if (rec.type === 'adopt') { typeLabel = '정원 등록'; }
        else if (rec.type === 'water') { typeLabel = '물주기 완료'; }
        else if (rec.type === 'rotate') { typeLabel = '화분 돌리기'; }
        else if (rec.type === 'trim') { typeLabel = '하엽 정리'; }
        else if (rec.type === 'nutrient') { typeLabel = '영양제 투여'; }
        else if (rec.type === 'repot') { typeLabel = '분갈이 완료'; }
        else if (rec.type === 'prune') { typeLabel = '가지치기 완료'; }
        else if (rec.type === 'diary') { typeLabel = '성장 다이어리'; }
        
        const dateStr = formatDate(new Date(rec.date));
        
        ev.innerHTML = `
            <div class="timeline-node" title="${typeLabel}"></div>
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

// --- Unified Garden Calendar & Diary Modal Logic ---
let currentGardenCalendarMonth = new Date();

function initGardenCalendarFlow() {
    const modal = document.getElementById('garden-calendar-modal');
    const closeBtn = document.getElementById('btn-close-garden-calendar');
    if (!modal) return;
    
    closeBtn.addEventListener('click', closeGardenCalendarModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeGardenCalendarModal();
    });
    
    // Tab switching
    const tabTimeline = document.getElementById('btn-garden-tab-timeline');
    const tabCalendar = document.getElementById('btn-garden-tab-calendar');
    
    if (tabTimeline) {
        tabTimeline.addEventListener('click', () => {
            switchGardenTab('garden-timeline');
        });
    }
    if (tabCalendar) {
        tabCalendar.addEventListener('click', () => {
            switchGardenTab('garden-calendar');
        });
    }
    
    // Calendar prev/next buttons
    const calPrev = document.getElementById('btn-garden-cal-prev');
    const calNext = document.getElementById('btn-garden-cal-next');
    
    if (calPrev) {
        calPrev.addEventListener('click', () => {
            navigateGardenCalendar(-1);
        });
    }
    if (calNext) {
        calNext.addEventListener('click', () => {
            navigateGardenCalendar(1);
        });
    }
}

function openGardenCalendarModal() {
    const modal = document.getElementById('garden-calendar-modal');
    if (!modal) return;
    
    currentGardenCalendarMonth = new Date();
    modal.classList.add('active');
    
    // Default tab
    switchGardenTab('garden-timeline');
    renderGardenTimeline();
    renderGardenCalendar();
}

function closeGardenCalendarModal() {
    const modal = document.getElementById('garden-calendar-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

function switchGardenTab(tabName) {
    // Update tab buttons
    const tabs = document.querySelectorAll('#garden-calendar-modal .tab-btn');
    tabs.forEach(btn => {
        const tabAttr = btn.getAttribute('data-tab');
        if (tabAttr === tabName) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    // Update tab contents
    const contents = document.querySelectorAll('#garden-calendar-modal .tab-content');
    contents.forEach(content => {
        if (content.id === `tab-content-${tabName}`) {
            content.classList.add('active');
        } else {
            content.classList.remove('active');
        }
    });
}

function renderGardenTimeline() {
    const stream = document.getElementById('garden-timeline-stream');
    if (!stream) return;
    stream.innerHTML = '';
    
    // Aggregate all records from all plants
    const allRecords = [];
    AppState.plants.forEach(plant => {
        if (plant.records) {
            plant.records.forEach(rec => {
                allRecords.push({
                    ...rec,
                    plantId: plant.id,
                    plantNickname: plant.nickname,
                    plantImage: plant.image,
                    plantSpecies: plant.species
                });
            });
        }
    });
    
    const sortedRecords = allRecords.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    if (sortedRecords.length === 0) {
        stream.innerHTML = '<div style="font-size:0.75rem; color:var(--text-muted); text-align:center; padding: 20px;">기록된 일지가 아직 없습니다.</div>';
        return;
    }
    
    sortedRecords.forEach(rec => {
        const ev = document.createElement('div');
        ev.className = `timeline-event ${rec.type}`;
        
        let typeLabel = '';
        if (rec.type === 'adopt') { typeLabel = '정원 등록'; }
        else if (rec.type === 'water') { typeLabel = '물주기 완료'; }
        else if (rec.type === 'rotate') { typeLabel = '화분 돌리기'; }
        else if (rec.type === 'trim') { typeLabel = '하엽 정리'; }
        else if (rec.type === 'nutrient') { typeLabel = '영양제 투여'; }
        else if (rec.type === 'repot') { typeLabel = '분갈이 완료'; }
        else if (rec.type === 'prune') { typeLabel = '가지치기 완료'; }
        else if (rec.type === 'diary') { typeLabel = '성장 일기'; }
        
        const dateStr = formatDate(new Date(rec.date));
        
        ev.innerHTML = `
            <div class="timeline-node" title="${typeLabel}"></div>
            <div class="timeline-plant-header" style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                <img src="${rec.plantImage}" style="width: 24px; height: 24px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.1); object-fit: cover;">
                <span class="timeline-plant-nickname" style="font-size: 0.78rem; font-weight: 700; color: var(--forest-primary);">${rec.plantNickname}</span>
                <span style="font-size: 0.68rem; color: var(--text-muted);">(${rec.plantSpecies})</span>
            </div>
            <span class="timeline-time">${dateStr}</span>
            <span class="timeline-title">${typeLabel}</span>
            ${rec.memo ? `<p class="timeline-memo" style="margin-top: 4px; margin-bottom: 0;">${rec.memo}</p>` : ''}
            ${rec.image ? `
                <div class="timeline-photo-wrapper" style="margin-top: 8px;">
                    <img src="${rec.image}" alt="성장 사진" style="width: 100%; border-radius: 12px; object-fit: cover; max-height: 200px;">
                </div>
            ` : ''}
        `;
        stream.appendChild(ev);
    });
}

function renderGardenCalendar() {
    const year = currentGardenCalendarMonth.getFullYear();
    const month = currentGardenCalendarMonth.getMonth(); // 0-indexed
    
    const calTitle = document.getElementById('garden-calendar-title');
    if (calTitle) {
        calTitle.textContent = `${year}년 ${month + 1}월`;
    }
    
    const gridBody = document.getElementById('garden-calendar-grid-body');
    if (!gridBody) return;
    gridBody.innerHTML = '';
    
    // Hide details section initially
    const detailsContainer = document.getElementById('garden-calendar-day-details');
    if (detailsContainer) {
        detailsContainer.style.display = 'none';
    }
    
    const firstDay = new Date(year, month, 1);
    const startDayOfWeek = firstDay.getDay(); // 0: Sun, 6: Sat
    
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevDaysInMonth = new Date(year, month, 0).getDate();
    
    // Aggregate all records from all plants
    const allRecords = [];
    AppState.plants.forEach(plant => {
        if (plant.records) {
            plant.records.forEach(rec => {
                allRecords.push({
                    ...rec,
                    plantId: plant.id,
                    plantNickname: plant.nickname,
                    plantImage: plant.image,
                    plantSpecies: plant.species
                });
            });
        }
    });
    
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
        
        // Find events on this day
        const dayEvents = allRecords.filter(rec => {
            const recDate = new Date(rec.date);
            return recDate.getFullYear() === year &&
                   recDate.getMonth() === month &&
                   recDate.getDate() === d;
        });
        
        if (dayEvents.length > 0) {
            const dotsWrapper = document.createElement('div');
            dotsWrapper.className = 'calendar-event-dots';
            
            // Collect unique event types on this day
            const uniqueTypes = [...new Set(dayEvents.map(e => e.type))];
            uniqueTypes.slice(0, 3).forEach(type => {
                const dot = document.createElement('div');
                dot.className = `cal-dot ${type}`;
                dotsWrapper.appendChild(dot);
            });
            cell.appendChild(dotsWrapper);
            
            // Add click listener to show events of this day
            cell.style.cursor = 'pointer';
            cell.addEventListener('click', () => {
                // Highlight active cell
                document.querySelectorAll('#garden-calendar-grid-body .calendar-cell').forEach(c => {
                    c.classList.remove('selected');
                });
                cell.classList.add('selected');
                
                showGardenCalendarDayDetails(`${year}년 ${month + 1}월 ${d}일`, dayEvents);
            });
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

function navigateGardenCalendar(offset) {
    currentGardenCalendarMonth.setMonth(currentGardenCalendarMonth.getMonth() + offset);
    renderGardenCalendar();
}

function showGardenCalendarDayDetails(dateLabel, events) {
    const detailsContainer = document.getElementById('garden-calendar-day-details');
    const title = document.getElementById('garden-selected-date-title');
    const list = document.getElementById('garden-selected-date-list');
    
    if (!detailsContainer || !title || !list) return;
    
    title.textContent = `📅 ${dateLabel}의 정원 소식 (${events.length}건)`;
    list.innerHTML = '';
    
    events.forEach(rec => {
        let typeLabel = '';
        if (rec.type === 'adopt') { typeLabel = '정원 등록'; }
        else if (rec.type === 'water') { typeLabel = '💧 물주기'; }
        else if (rec.type === 'rotate') { typeLabel = '🔄 화분 돌리기'; }
        else if (rec.type === 'trim') { typeLabel = '✂️ 하엽 정리'; }
        else if (rec.type === 'nutrient') { typeLabel = '💊 영양제 투여'; }
        else if (rec.type === 'repot') { typeLabel = '🪴 분갈이'; }
        else if (rec.type === 'prune') { typeLabel = '🌿 가지치기'; }
        else if (rec.type === 'diary') { typeLabel = '📝 성장 일기'; }
        
        const item = document.createElement('div');
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.justifyContent = 'space-between';
        item.style.padding = '10px 12px';
        item.style.background = 'rgba(255, 255, 255, 0.03)';
        item.style.borderRadius = '12px';
        item.style.border = '1px solid rgba(255, 255, 255, 0.04)';
        
        item.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <img src="${rec.plantImage}" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover;">
                <div style="display: flex; flex-direction: column;">
                    <span style="font-size: 0.76rem; font-weight: 700; color: var(--text-dark);">${rec.plantNickname}</span>
                    ${rec.memo ? `<span style="font-size: 0.68rem; color: var(--text-muted);">${rec.memo}</span>` : ''}
                </div>
            </div>
            <span style="font-size: 0.72rem; font-weight: 700; color: var(--forest-primary);">${typeLabel}</span>
        `;
        
        list.appendChild(item);
    });
    
    detailsContainer.style.display = 'block';
    
    // Smooth scroll down to details
    detailsContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// --- Pot Action Selection Modal Flow ---
function initActionSelectionFlow() {
    const modal = document.getElementById('pot-action-selection-modal');
    const closeBtn = document.getElementById('btn-close-action-selection');
    if (!modal) return;
    
    closeBtn.addEventListener('click', closeActionSelectionModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeActionSelectionModal();
    });
    
    // "새로운 마이팟 등록" button
    document.getElementById('btn-select-register-new').addEventListener('click', () => {
        closeActionSelectionModal();
        openRegisterModal();
    });
    
    // "기존 마이팟에 기록" button
    document.getElementById('btn-select-record-existing').addEventListener('click', () => {
        const plantSection = document.getElementById('action-select-plant-section');
        if (plantSection.style.display === 'none') {
            renderActionSelectPlantList();
            plantSection.style.display = 'block';
        } else {
            plantSection.style.display = 'none';
        }
    });
}

function openActionSelectionModal() {
    const modal = document.getElementById('pot-action-selection-modal');
    if (!modal) return;
    
    // Reset plant list section
    document.getElementById('action-select-plant-section').style.display = 'none';
    modal.classList.add('active');
}

function closeActionSelectionModal() {
    const modal = document.getElementById('pot-action-selection-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

function renderActionSelectPlantList() {
    const list = document.getElementById('action-select-plant-list');
    if (!list) return;
    list.innerHTML = '';
    
    if (AppState.plants.length === 0) {
        list.innerHTML = '<div style="font-size:0.75rem; color:var(--text-muted); text-align:center; padding: 10px;">등록된 식물이 없습니다.</div>';
        return;
    }
    
    AppState.plants.forEach(plant => {
        const item = document.createElement('div');
        item.className = 'action-select-plant-item';
        
        item.innerHTML = `
            <div class="plant-info-left">
                <img src="${plant.image}" class="plant-avatar">
                <div style="display: flex; flex-direction: column;">
                    <span class="plant-nickname" style="font-size: 0.82rem; font-weight:700; color:var(--text-dark);">${plant.nickname}</span>
                    <span class="plant-species" style="font-size: 0.7rem; color:var(--text-muted);">${plant.species}</span>
                </div>
            </div>
        `;
        
        item.addEventListener('click', () => {
            closeActionSelectionModal();
            openGrowthRecordModal(plant.id);
        });
        
        list.appendChild(item);
    });
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
    if (type === 'rotate') xpAward = 20;
    else if (type === 'trim') xpAward = 25;
    else if (type === 'repot') xpAward = 40;
    else if (type === 'nutrient') xpAward = 30;
    else if (type === 'prune') xpAward = 20;
    addXP(xpAward);
    
    if (type === 'water') {
        unlockBadge('oasis');
    }
    
    // Trigger Success Modal with checkmark animation
    showCareSuccessModal(type, plant.nickname);
}

function showCareSuccessModal(type, nickname) {
    const successModal = document.getElementById('care-success-modal');
    const successTitle = document.getElementById('care-success-title');
    const successMessage = document.getElementById('care-success-message');
    
    if (!successModal || !successTitle || !successMessage) return;
    
    let title = '';
    let message = '';
    
    switch(type) {
        case 'water':
            title = '물주기 완료';
            message = `${nickname}에게 물을 주었습니다.`;
            break;
        case 'rotate':
            title = '화분 돌리기 완료';
            message = `${nickname}의 화분을 돌려주었습니다.`;
            break;
        case 'trim':
            title = '하엽 정리 완료';
            message = `${nickname}의 하엽을 정리했습니다.`;
            break;
        case 'nutrient':
            title = '영양제 투여';
            message = `${nickname}에게 영양제를 주었습니다.`;
            break;
        case 'repot':
            title = '분갈이 완료';
            message = `${nickname}의 분갈이를 완료했습니다.`;
            break;
        case 'prune':
            title = '가지치기 완료';
            message = `${nickname}의 가지치기를 완료했습니다.`;
            break;
        default:
            title = '기록 완료';
            message = `${nickname}의 돌봄 일지를 기록했습니다.`;
    }
    
    successTitle.textContent = title;
    successMessage.textContent = message;
    
    // Force reset checkmark SVG to trigger the keyframe animations from scratch
    const checkmarkWrapper = successModal.querySelector('.checkmark-wrapper');
    if (checkmarkWrapper) {
        checkmarkWrapper.innerHTML = `
            <svg class="checkmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
                <circle class="checkmark-circle" cx="26" cy="26" r="25" fill="none"/>
                <path class="checkmark-check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
            </svg>
        `;
    }
    
    // Show modal
    successModal.classList.add('active');
    
    // Hide automatically after 2.5 seconds
    setTimeout(() => {
        successModal.classList.remove('active');
    }, 2500);
}

function getDefaultCareMemo(type, nickname) {
    switch(type) {
        case 'water': return `${nickname}에게 물을 주었습니다.`;
        case 'rotate': return `${nickname}의 화분을 돌려 햇빛을 고르게 받게 해주었습니다.`;
        case 'trim': return `${nickname}의 시들고 마른 하엽을 다듬고 정리했습니다.`;
        case 'nutrient': return `${nickname}에게 영양제를 투여했습니다.`;
        case 'repot': return `${nickname}의 흙과 화분을 갈아주었습니다. (분갈이)`;
        case 'prune': return `${nickname}의 마른 줄기와 이파리를 다듬어 주었습니다.`;
        default: return '';
    }
}



// --- Gemini API & AI Plant Analysis Helpers ---
function getImageBase64(imgElement) {
    if (!imgElement || !imgElement.src) return null;
    if (imgElement.src.startsWith('data:')) {
        return imgElement.src.split(',')[1];
    }
    // If it is a relative/absolute URL, draw to canvas
    try {
        const canvas = document.createElement('canvas');
        canvas.width = imgElement.naturalWidth || imgElement.width || 300;
        canvas.height = imgElement.naturalHeight || imgElement.height || 300;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);
        const dataURL = canvas.toDataURL('image/png');
        return dataURL.split(',')[1];
    } catch (err) {
        console.error("Base64 conversion failed:", err);
        return null;
    }
}

async function detectPlantBoundingBoxWithAI() {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.');
    const apiKey = localStorage.getItem('pot2pot_gemini_key') || AppState.geminiKey;
    
    if (isLocal && !apiKey) {
        console.warn("Local environment has no Gemini API key. Skipping AI bounding box cutout.");
        return null;
    }

    const base64Data = AppState.capturedImageSrc.split(',')[1];
    if (!base64Data) return null;

    try {
        let response;
        if (isLocal || apiKey) {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
            const prompt = "Identify the plant and its pot (including the foliage/succulent and the container/pot). Return a JSON object with:\n" +
                           "\"box_2d\": [ymin, xmin, ymax, xmax],\n" +
                           "\"polygon\": [[y1, x1], [y2, x2], ..., [yn, xn]] (a list of 20 to 45 points outlining the boundary of the plant and pot in clockwise order, normalized to 0-1000 where 0 is top/left and 1000 is bottom/right).\n" +
                           "Make the polygon contour extremely tight, hugging the actual edges of the plant and pot as closely as possible. Be extremely precise to ONLY include the plant and pot, excluding any surrounding background, hands, floor, or phone frames/screens. Do not include any markdown formatting or other text, return ONLY the raw JSON.";

            response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: prompt },
                            {
                                inlineData: {
                                    mimeType: "image/png",
                                    data: base64Data
                                }
                            }
                        ]
                    }],
                    generationConfig: {
                        responseMimeType: "application/json"
                    }
                })
            });
        } else {
            // Production Vercel Proxy
            const headers = {
                'Content-Type': 'application/json'
            };
            if (apiKey) {
                headers['x-gemini-key'] = apiKey;
            }
            response = await fetch('/api/gemini-analysis', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    image: base64Data,
                    mode: 'bbox'
                })
            });
        }

        if (response.ok) {
            const data = await response.json();
            const text = data.candidates[0].content.parts[0].text;
            const parsed = JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
            if (parsed && parsed.box_2d) {
                return parsed; // Return the whole parsed object containing box_2d and polygon
            }
        }
    } catch (err) {
        console.error("AI bounding box detection error:", err);
    }
    return null;
}

async function analyzePlantWithAI() {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.');
    const apiKey = localStorage.getItem('pot2pot_gemini_key') || AppState.geminiKey;
    
    if (isLocal && !apiKey) {
        showAlert("⚠️ 로컬 개발 환경에서는 콘솔을 통해 API Key를 등록해야 AI 스캔이 가능합니다. (콘솔창에 localStorage.setItem('pot2pot_gemini_key', '발급받은_키') 입력)");
        // Clear placeholders so they don't say "AI 분석 중..." forever
        document.getElementById('plant-species').value = '';
        document.getElementById('plant-nickname').value = '';
        return;
    }

    // Use the original captured image base64 data for AI species identification rather than the transparent cutout image.
    // This keeps full visual details and prevents API errors from empty/transparent png inputs.
    const base64Data = AppState.capturedImageSrc ? AppState.capturedImageSrc.split(',')[1] : null;
    if (!base64Data) {
        showAlert("⚠️ 식물 이미지를 변환할 수 없습니다. 이미지를 다시 선택해 주세요.");
        // Clear placeholders
        document.getElementById('plant-species').value = '';
        document.getElementById('plant-nickname').value = '';
        return;
    }

    const btnAnalyze = document.getElementById('btn-ai-analyze');
    const loadingIndicator = document.getElementById('ai-loading-indicator');

    if (btnAnalyze) {
        btnAnalyze.disabled = true;
        btnAnalyze.style.display = 'none';
    }
    if (loadingIndicator) {
        loadingIndicator.style.display = 'flex';
    }

    try {
        let response;
        if (isLocal) {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
            const prompt = "이 식물 사진을 분석하여 다음 JSON 구조로만 정확하게 응답해주세요. 다른 부연 설명이나 마크다운 백틱(```json)을 절대 포함하지 마십시오.\n" +
                           "{\n" +
                           "  \"species\": \"식물의 정확한 종류/품종 국문명 (예: 몬스테라 델리시오사, 아레카야자 등)\",\n" +
                           "  \"nickname\": \"식물의 생김새나 특징에 어울리는 귀여운 4글자 이내의 한글 별명 추천 (예: 초록이, 선선이, 몬몬이 등)\",\n" +
                           "  \"waterInterval\": 식물의 품종별 권장 물주기 주기 (1에서 30 사이의 정수 일수)\n" +
                           "}";

            response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: prompt },
                            {
                                inlineData: {
                                    mimeType: "image/png",
                                    data: base64Data
                                }
                            }
                        ]
                    }],
                    generationConfig: {
                        responseMimeType: "application/json"
                    }
                })
            });
        } else {
            // Production Vercel Proxy
            const headers = {
                'Content-Type': 'application/json'
            };
            if (apiKey) {
                headers['x-gemini-key'] = apiKey;
            }
            response = await fetch('/api/gemini-analysis', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    image: base64Data
                })
            });
        }

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            const errMsg = errData.error?.message || errData.error || `HTTP 에러 ${response.status}`;
            throw new Error(errMsg);
        }

        const resData = await response.json();
        const textResponse = resData.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!textResponse) {
            throw new Error("API로부터 올바른 분석 결과를 받지 못했습니다.");
        }

        // Parse JSON response safely
        let result;
        const cleanedText = textResponse.trim();
        try {
            result = JSON.parse(cleanedText);
        } catch (e) {
            // Fallback: search for JSON block using regex if parsing failed
            const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                result = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error("응답 결과 형식을 분석할 수 없습니다.");
            }
        }

        if (result.species) {
            document.getElementById('plant-species').value = result.species;
            
            // Search NAVER Encyclopedia in background
            AppState.currentNaverData = null;
            fetchNaverEncyclopedia(result.species).then(naverResult => {
                if (naverResult) {
                    AppState.currentNaverData = naverResult;
                    console.log("NAVER Encyclopedia data fetched in background:", naverResult);
                }
            });
        }
        if (result.nickname) {
            document.getElementById('plant-nickname').value = result.nickname;
        }
        if (result.waterInterval) {
            const intervalVal = Math.min(30, Math.max(1, parseInt(result.waterInterval) || 7));
            document.getElementById('water-slider').value = intervalVal;
            updateWaterIntervalValue(intervalVal);
        }

        showAlert("✨ AI 분석이 완료되어 식물 프로필 정보가 자동 입력되었습니다!");
    } catch (error) {
        console.error("AI Analysis failed:", error);
        showAlert(`❌ AI 분석 실패: ${error.message}`);
        
        // If the error indicates missing API key, prompt to enter it in settings
        if (error.message.includes("Gemini API Key is missing") || error.message.includes("x-gemini-key") || error.message.includes("401")) {
            setTimeout(() => {
                showAlert("⚙️ Vercel 환경 변수(GEMINI_API_KEY) 설정을 확인해 주세요.");
            }, 1500);
        }
        
        // Clear placeholders on error
        document.getElementById('plant-species').value = '';
        document.getElementById('plant-nickname').value = '';
    } finally {
        if (btnAnalyze) {
            btnAnalyze.disabled = false;
            btnAnalyze.style.display = 'flex';
        }
        if (loadingIndicator) {
            loadingIndicator.style.display = 'none';
        }
    }
}

async function fetchNaverEncyclopedia(species) {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.');
    const naverId = localStorage.getItem('pot2pot_naver_client_id') || AppState.naverId;
    const naverSecret = localStorage.getItem('pot2pot_naver_client_secret') || AppState.naverSecret;
    
    // In local development, we skip calling NAVER API since Vercel Serverless proxy isn't available, and immediately return Mock DB data.
    if (isLocal) {
        console.log("Local development environment. Using mock encyclopedia data.");
        const cleanSpecies = species.replace(/[^가-힣a-zA-Z]/g, ''); // Clean special chars
        
        const mockDb = {
            '몬스테라': {
                description: "몬스테라(Monstera)는 천남성과의 한 속이다. 잎에 구멍이 뚫려 있거나 갈라져 있는 독특한 잎 모양을 가진 상록 덩굴성 관엽식물이다. 멕시코와 중앙아메리카가 원산지이며, 실내 환경에 적응을 잘하고 이국적인 분위기를 주어 반려식물 및 인테리어 식물로 인기가 높다.",
                link: "https://terms.naver.com/entry.naver?docId=1095039&cid=40942&categoryId=32696"
            },
            '선인장': {
                description: "선인장(Cactus)은 선인장과에 속하는 식물의 총칭이다. 건조한 사막과 고산지대 등 척박한 환경에 적응하기 위해 잎이 가시로 퇴화하고 줄기가 다육화되어 수분을 저장한다. 꽃이 아름답고 키우기 쉬워 반려식물로 많은 사랑을 받는다.",
                link: "https://terms.naver.com/entry.naver?docId=1112023&cid=40942&categoryId=32697"
            },
            '산세베리아': {
                description: "산세베리아(Sansevieria)는 아스파라거스과의 한 속이다. 건조에 극도로 강하여 몇 달 동안 물을 주지 않아도 죽지 않는 생명력을 자랑한다. 공기 정화 능력이 탁월하고 밤에 산소를 배출하는 특성이 있어 침실용 식물로 추천된다.",
                link: "https://terms.naver.com/entry.naver?docId=1108643&cid=40942&categoryId=32696"
            },
            '캐라리언': {
                description: "캐라리언(Carlyan)은 에케베리아(Echeveria) 속의 다육식물로, 장미꽃 모양으로 촘촘히 돋아나는 도톰한 잎이 특징입니다. 햇빛을 충분히 받으면 끝 부분이 붉고 화사한 핑크빛으로 물들며, 건조에 강하고 과습에 약해 흙이 바짝 말랐을 때 물을 주어야 합니다.",
                link: "https://terms.naver.com/search.naver?query=" + encodeURIComponent("다육 캐라리언")
            }
        };
        
        // Try to match key
        for (let key in mockDb) {
            if (cleanSpecies.includes(key) || key.includes(cleanSpecies)) {
                return mockDb[key];
            }
        }
        // Fallback mock description for other plants
        return {
            description: `네이버 백과사전에서 검색된 '${species}' 정보입니다. 이 식물은 쾌적한 실내 온도와 적절한 통풍이 유지되는 곳에서 가장 잘 자라며, 과습에 주의해야 하는 아름다운 반려식물입니다.`,
            link: "https://terms.naver.com/search.naver?query=" + encodeURIComponent(species)
        };
    }
    
    // In Production: Call Vercel Serverless Function Proxy
    try {
        const headers = {};
        if (naverId) headers['x-naver-client-id'] = naverId;
        if (naverSecret) headers['x-naver-client-secret'] = naverSecret;
        
        const response = await fetch(`/api/naver-search?query=${encodeURIComponent(species)}`, {
            method: 'GET',
            headers: headers
        });
        
        if (!response.ok) {
            throw new Error(`Naver search failed with status ${response.status}`);
        }
        
        const data = await response.json();
        if (data.items && data.items.length > 0) {
            const item = data.items[0];
            // Remove HTML bold tags from title/description
            const cleanDescription = item.description.replace(/<[^>]*>/g, '');
            return {
                description: cleanDescription,
                link: item.link
            };
        }
        return null;
    } catch (err) {
        console.error("NAVER API call failed:", err);
        return null;
    }
}

// --- Vercel KV Automatic Background Sync ---
async function syncPlantsFromDatabase() {
    try {
        const response = await fetch('/api/get-plants');
        if (!response.ok) {
            throw new Error(`DB fetch failed with status ${response.status}`);
        }
        const data = await response.json();
        if (data.plants && Array.isArray(data.plants)) {
            const currentStr = JSON.stringify(AppState.plants);
            const newStr = JSON.stringify(data.plants);
            
            if (data.plants.length === 0 && AppState.plants.length > 0) {
                // Database is empty but local storage has plants. Seed database!
                console.log("Database is empty. Seeding database with local plants...");
                syncPlantsToDatabase();
            } else if (currentStr !== newStr) {
                console.log("Syncing plants from Vercel KV database...", data.plants);
                AppState.plants = data.plants;
                try {
                    localStorage.setItem('pot2pot_plants', newStr);
                } catch (e) {
                    console.error("Failed to update local cache during DB sync:", e);
                }
                renderArchive();
            }
        }
    } catch (err) {
        console.warn("Database sync fetch failed (using local storage cache):", err);
    }
}

async function syncPlantsToDatabase() {
    try {
        const response = await fetch('/api/save-plants', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ plants: AppState.plants })
        });
        if (!response.ok) {
            throw new Error(`DB save failed with status ${response.status}`);
        }
        console.log("Successfully synced plants to Vercel KV database.");
    } catch (err) {
        console.warn("Database sync save failed (will retry on next change):", err);
    }
}


// --- Plant Growth Record Wizard (3-step Slider Flow) ---
let currentGrowthRecordPlantId = null;
let growthCameraStream = null;

function initGrowthRecordFlow() {
    const modal = document.getElementById('growth-record-modal');
    const closeBtn = document.getElementById('growth-modal-close');
    const backBtn = document.getElementById('growth-modal-back');
    const container = document.getElementById('growth-step-container');
    
    if (!modal) return;
    
    closeBtn.addEventListener('click', closeGrowthRecordModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeGrowthRecordModal();
    });
    
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            if (AppState.growthStep > 1) {
                goToGrowthStep(AppState.growthStep - 1);
            }
        });
    }
    
    // Shutter capture trigger
    document.getElementById('btn-growth-capture-shutter').addEventListener('click', () => {
        captureGrowthSnapshot();
    });
    
    // File Upload
    const fileInput = document.getElementById('growth-file-upload-input');
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                AppState.growthCapturedImageSrc = event.target.result;
                goToGrowthStep(2);
            };
            reader.readAsDataURL(file);
        }
    });
    
    // Brush buttons
    const eraserBtn = document.getElementById('btn-growth-tool-erase');
    const restoreBtn = document.getElementById('btn-growth-tool-restore');
    const magicTapBtn = document.getElementById('btn-growth-tool-magic-tap');
    const brushSlider = document.getElementById('growth-brush-size');
    
    eraserBtn.addEventListener('click', () => {
        eraserBtn.classList.add('active');
        restoreBtn.classList.remove('active');
        magicTapBtn.classList.remove('active');
        if (AppState.growthSegmenter) AppState.growthSegmenter.brushMode = 'erase';
    });
    
    restoreBtn.addEventListener('click', () => {
        restoreBtn.classList.add('active');
        eraserBtn.classList.remove('active');
        magicTapBtn.classList.remove('active');
        if (AppState.growthSegmenter) AppState.growthSegmenter.brushMode = 'restore';
    });
    
    magicTapBtn.addEventListener('click', () => {
        magicTapBtn.classList.add('active');
        eraserBtn.classList.remove('active');
        restoreBtn.classList.remove('active');
        if (AppState.growthSegmenter) AppState.growthSegmenter.brushMode = 'magic';
    });
    
    brushSlider.addEventListener('input', (e) => {
        if (AppState.growthSegmenter) AppState.growthSegmenter.brushSize = parseInt(e.target.value);
    });
    
    // Auto remove white bg
    document.getElementById('btn-growth-tool-magic').addEventListener('click', () => {
        if (AppState.growthSegmenter) {
            AppState.growthSegmenter.autoRemoveWhiteBackground(22);
            showAlert("🪄 마법봉으로 배경을 자동으로 제거했습니다.");
        }
    });
    
    document.getElementById('btn-growth-tool-reset').addEventListener('click', () => {
        if (AppState.growthSegmenter) {
            AppState.growthSegmenter.resetMask();
            showAlert("↩️ 원본 상태로 복구되었습니다.");
        }
    });
    
    // Step 2 next -> Step 3
    document.getElementById('btn-growth-cutout-next').addEventListener('click', () => {
        if (AppState.growthSegmenter) {
            const cutoutBase64 = AppState.growthSegmenter.getMaskedBase64();
            document.getElementById('growth-preview-cutout-img').src = cutoutBase64;
            
            const plant = AppState.plants.find(p => p.id === currentGrowthRecordPlantId);
            if (plant) {
                document.getElementById('growth-record-plant-name').textContent = `${plant.nickname} (${plant.species})`;
            }
            
            // Set date to today
            document.getElementById('growth-record-date').valueAsDate = new Date();
            
            goToGrowthStep(3);
        }
    });
    
    // Form submission
    document.getElementById('growth-record-plant-form').addEventListener('submit', saveGrowthRecordLog);
}

function openGrowthRecordModal(plantId) {
    currentGrowthRecordPlantId = plantId || currentDetailPlantId;
    if (!currentGrowthRecordPlantId) return;
    
    const modal = document.getElementById('growth-record-modal');
    if (modal) {
        modal.classList.add('active');
        goToGrowthStep(1);
    }
}

function closeGrowthRecordModal() {
    const modal = document.getElementById('growth-record-modal');
    if (modal) {
        modal.classList.remove('active');
    }
    stopGrowthCamera();
}

function goToGrowthStep(stepNum) {
    AppState.growthStep = stepNum;
    const container = document.getElementById('growth-step-container');
    if (container) {
        const offset = -(stepNum - 1) * 33.333;
        container.style.transform = `translateX(${offset}%)`;
    }
    
    // Dots
    const dots = document.querySelectorAll('#growth-record-modal .step-indicator-dot');
    dots.forEach((dot, idx) => {
        if (idx < stepNum) {
            dot.classList.add('active');
        } else {
            dot.classList.remove('active');
        }
    });
    
    // Back button visibility
    const backBtn = document.getElementById('growth-modal-back');
    if (backBtn) {
        backBtn.style.visibility = stepNum > 1 ? 'visible' : 'hidden';
    }
    
    // Actions based on step
    if (stepNum === 1) {
        startGrowthCamera();
    } else if (stepNum === 2) {
        stopGrowthCamera();
        
        // Show loading overlay
        const overlay = document.getElementById('growth-editor-processing');
        if (overlay) {
            overlay.classList.add('active');
            overlay.querySelector('p').textContent = "피사체 탐색 중... 0%";
        }
        
        // Simulate progress while loading model / segmenter
        let pct = 0;
        const interval = setInterval(() => {
            pct += 15;
            if (pct >= 90) {
                clearInterval(interval);
            } else {
                if (overlay) overlay.querySelector('p').textContent = `피사체 탐색 중... ${pct}%`;
            }
        }, 100);
        
        setTimeout(() => {
            clearInterval(interval);
            if (overlay) {
                overlay.querySelector('p').textContent = "피사체 탐색 중... 100%";
            }
            
            if (overlay) overlay.classList.remove('active');
            initGrowthCanvasSegmenter();
        }, 800);
    } else if (stepNum === 3) {
        stopGrowthCamera();
    }
}

function startGrowthCamera() {
    const video = document.getElementById('growth-camera-stream');
    const fallback = document.querySelector('#growth-step-1-view .camera-fallback-msg');
    
    if (!video) return;
    
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(stream => {
            growthCameraStream = stream;
            video.srcObject = stream;
            video.style.display = 'block';
            if (fallback) fallback.style.display = 'none';
        })
        .catch(err => {
            console.warn('Camera access failed:', err);
            video.style.display = 'none';
            if (fallback) fallback.style.display = 'block';
        });
}

function stopGrowthCamera() {
    if (growthCameraStream) {
        growthCameraStream.getTracks().forEach(track => track.stop());
        growthCameraStream = null;
    }
}

function captureGrowthSnapshot() {
    const video = document.getElementById('growth-camera-stream');
    if (!video || !growthCameraStream) return;
    
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    AppState.growthCapturedImageSrc = canvas.toDataURL('image/png');
    goToGrowthStep(2);
}

function initGrowthCanvasSegmenter() {
    const canvas = document.getElementById('growth-editor-canvas');
    const tempImg = new Image();
    
    tempImg.onload = () => {
        AppState.growthSegmenter = new PlantSegmenter(canvas, tempImg);
        
        // Touch/Mouse draw binding for Canvas
        const getMousePos = (evt) => {
            const rect = canvas.getBoundingClientRect();
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
            AppState.growthSegmenter.startDrawing(pos.x, pos.y);
        };
        
        const handleMove = (e) => {
            e.preventDefault();
            if (AppState.growthSegmenter.isDrawing) {
                const pos = getMousePos(e);
                AppState.growthSegmenter.drawBrush(pos.x, pos.y);
            }
        };
        
        const handleEnd = () => {
            AppState.growthSegmenter.stopDrawing();
        };
        
        canvas.onmousedown = handleStart;
        canvas.onmousemove = handleMove;
        window.onmouseup = handleEnd;
        
        canvas.ontouchstart = handleStart;
        canvas.ontouchmove = handleMove;
        window.ontouchend = handleEnd;
        
        // Auto remove white background for uploaded files
        if (AppState.growthCapturedImageSrc.startsWith('data:image')) {
            AppState.growthSegmenter.autoRemoveWhiteBackground(22);
        }
    };
    
    tempImg.src = AppState.growthCapturedImageSrc;
}

function saveGrowthRecordLog(e) {
    e.preventDefault();
    if (!currentGrowthRecordPlantId) return;
    
    const plant = AppState.plants.find(p => p.id === currentGrowthRecordPlantId);
    if (!plant) return;
    
    const logDate = document.getElementById('growth-record-date').value;
    const careType = document.getElementById('growth-record-care-type').value;
    const memo = document.getElementById('growth-record-memo').value.trim();
    
    const isActivity = careType !== 'none';
    const type = isActivity ? careType : 'diary';
    
    const logDateObj = logDate ? new Date(logDate) : new Date();
    const now = new Date();
    if (logDateObj.toDateString() !== now.toDateString()) {
        logDateObj.setHours(12, 0, 0, 0);
    } else {
        logDateObj.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
    }
    
    const cutoutBase64 = AppState.growthSegmenter ? AppState.growthSegmenter.getMaskedBase64() : null;
    
    const newRecord = {
        id: 'rec_' + Date.now(),
        date: logDateObj.toISOString(),
        type: type,
        memo: memo || (isActivity ? getDefaultCareMemo(type, plant.nickname) : '오늘 하루 성장 일지를 기록했습니다.'),
        image: cutoutBase64
    };
    
    if (!plant.records) plant.records = [];
    plant.records.push(newRecord);
    
    if (type === 'water') {
        if (!plant.lastWatered || new Date(newRecord.date) > new Date(plant.lastWatered)) {
            plant.lastWatered = newRecord.date;
        }
    }
    
    savePlantsToStorage();
    renderArchive();
    
    // Close growth record wizard
    closeGrowthRecordModal();
    
    // Open plant details modal for this plant to let user view the archived image in carousel!
    openDetailModal(plant.id);
    
    addXP(isActivity ? 30 : 20);
    if (type === 'water') {
        unlockBadge('oasis');
    }
    
    showCareSuccessModal(type, plant.nickname);
}



