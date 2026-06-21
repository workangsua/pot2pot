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
    
    // Set default date for date picker to today
    document.getElementById('plant-adoption').valueAsDate = new Date();
    
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
        openRegisterModal();
    });
    
    // Trophy Button click to go to settings
    const heroTrophyBtn = document.getElementById('btn-hero-trophy');
    if (heroTrophyBtn) {
        heroTrophyBtn.addEventListener('click', () => {
            switchView('settings');
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
    document.getElementById('btn-care-nutrient').addEventListener('click', () => addCareActivity('nutrient'));
    document.getElementById('btn-care-repot').addEventListener('click', () => addCareActivity('repot'));
    document.getElementById('btn-care-prune').addEventListener('click', () => addCareActivity('prune'));
    
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
    closeLogForm();
    
    document.getElementById('detail-modal').classList.add('active');
}

function closeDetailModal() {
    document.getElementById('detail-modal').classList.remove('active');
    currentDetailPlantId = null;
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



