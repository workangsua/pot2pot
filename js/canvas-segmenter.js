/**
 * POT2POT Canvas-based Background Removal (누끼) Engine
 * Handles automatic white-background keying, magic wand color-keying,
 * and interactive brush masking (Erase & Restore).
 */
class PlantSegmenter {
    constructor(displayCanvas, originalImage) {
        this.displayCanvas = displayCanvas;
        this.ctx = displayCanvas.getContext('2d');
        this.originalImage = originalImage;

        // Create a hidden canvas to store the mask (white/opaque = keep, transparent/black = erase)
        this.maskCanvas = document.createElement('canvas');
        this.maskCtx = this.maskCanvas.getContext('2d');

        this.brushSize = 24;
        this.brushMode = 'erase'; // 'erase' or 'restore'
        this.isDrawing = false;
        this.lastX = 0;
        this.lastY = 0;

        this.init();
    }

    init() {
        const img = this.originalImage;
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;

        // Fit canvas to screen dimensions while maintaining aspect ratio
        const maxDim = 800; // max size for processing to keep it fast
        let scale = 1;
        if (width > maxDim || height > maxDim) {
            scale = maxDim / Math.max(width, height);
        }

        this.width = Math.round(width * scale);
        this.height = Math.round(height * scale);

        // Set dimensions for both canvases
        this.displayCanvas.width = this.width;
        this.displayCanvas.height = this.height;
        this.maskCanvas.width = this.width;
        this.maskCanvas.height = this.height;

        // Initialize mask canvas to solid white (everything visible)
        this.maskCtx.fillStyle = '#ffffff';
        this.maskCtx.fillRect(0, 0, this.width, this.height);

        // Pre-allocate helper canvases for high-performance outline rendering
        this.tempCanvas = document.createElement('canvas');
        this.tempCtx = this.tempCanvas.getContext('2d');
        this.silCanvas = document.createElement('canvas');
        this.silCtx = this.silCanvas.getContext('2d');

        this.tempCanvas.width = this.width;
        this.tempCanvas.height = this.height;
        this.silCanvas.width = this.width;
        this.silCanvas.height = this.height;

        this.render();
    }

    /**
     * Automatic background removal using border-connected flood-fill
     * Densely samples border pixels, clusters them, and performs BFS region growing.
     * Optionally restricts cutout to the plant + pot bounding box detected by Gemini AI.
     */
    autoRemoveWhiteBackground(tolerance = 22, boundingBox = null, polygon = null) {
        try {
            // Draw image onto a temp canvas to inspect pixels
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = this.width;
            tempCanvas.height = this.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(this.originalImage, 0, 0, this.width, this.height);

            const imgData = tempCtx.getImageData(0, 0, this.width, this.height);
            const maskData = this.maskCtx.getImageData(0, 0, this.width, this.height);
            
            const pixels = imgData.data;
            const maskPixels = maskData.data;
            const width = this.width;
            const height = this.height;

            // Sample border colors (with a tiny inset to avoid absolute edge artifacts)
            const insetX = Math.max(2, Math.floor(width * 0.015));
            const insetY = Math.max(2, Math.floor(height * 0.015));
            
            const borderColors = [];
            const step = 6; // Densely sample every 6 pixels
            
            const addBorderColor = (x, y) => {
                const idx = (y * width + x) * 4;
                borderColors.push({
                    r: pixels[idx],
                    g: pixels[idx + 1],
                    b: pixels[idx + 2]
                });
            };
            
            // Sample border colors (only top and upper-sides to avoid pot/soil colors at the bottom)
            // 1. Sample Top border completely
            for (let x = insetX; x < width - insetX; x += step) {
                addBorderColor(x, insetY);
            }
            // 2. Sample Left & Right borders but ONLY up to 60% of the height to avoid the pot
            const maxHeightToSample = Math.floor(height * 0.60);
            for (let y = insetY; y < maxHeightToSample; y += step) {
                addBorderColor(insetX, y);
                addBorderColor(width - 1 - insetX, y);
            }

            // Cluster colors to find distinct background color profiles
            const uniqueColors = [];
            const colorDiff = (c1, c2) => {
                return Math.sqrt(
                    Math.pow(c1.r - c2.r, 2) +
                    Math.pow(c1.g - c2.g, 2) +
                    Math.pow(c1.b - c2.b, 2)
                );
            };

            borderColors.forEach(color => {
                let found = false;
                for (let uc of uniqueColors) {
                    if (colorDiff(color, uc) < 18) { // Threshold for clustering
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    uniqueColors.push(color);
                }
            });

            console.log(`Smart cutout: Sampled ${borderColors.length} border pixels, clustered into ${uniqueColors.length} unique colors.`);

            // Initialize visited array and BFS queue
            const visited = new Uint8Array(width * height);
            const queue = [];
            
            const pushToQueue = (x, y) => {
                const idx = y * width + x;
                if (!visited[idx]) {
                    visited[idx] = 1;
                    queue.push(x, y);
                }
            };

            // Calculate bounding box pixel boundaries if provided by Gemini AI
            let pxYmin = 0, pxXmin = 0, pxYmax = height - 1, pxXmax = width - 1;
            const hasBox = boundingBox && Array.isArray(boundingBox) && boundingBox.length === 4;
            
            if (hasBox) {
                const [ymin, xmin, ymax, xmax] = boundingBox;
                pxYmin = Math.max(0, Math.floor(ymin / 1000 * height));
                pxXmin = Math.max(0, Math.floor(xmin / 1000 * width));
                pxYmax = Math.min(height - 1, Math.floor(ymax / 1000 * height));
                pxXmax = Math.min(width - 1, Math.floor(xmax / 1000 * width));

                // 1. Mark everything OUTSIDE the bounding box as visited and transparent background in the mask
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        if (x < pxXmin || x > pxXmax || y < pxYmin || y > pxYmax) {
                            const idx = y * width + x;
                            visited[idx] = 1; // Mark as visited so BFS doesn't process it
                            
                            const pixelIdx = idx * 4;
                            maskPixels[pixelIdx] = 0;
                            maskPixels[pixelIdx + 1] = 0;
                            maskPixels[pixelIdx + 2] = 0;
                            maskPixels[pixelIdx + 3] = 0;
                        }
                    }
                }

                // 2. Seed BFS from the perimeter of the bounding box
                for (let x = pxXmin; x <= pxXmax; x++) {
                    pushToQueue(x, pxYmin);
                    pushToQueue(x, pxYmax);
                }
                for (let y = pxYmin; y <= pxYmax; y++) {
                    pushToQueue(pxXmin, y);
                    pushToQueue(pxXmax, y);
                }
            } else {
                // No bounding box: seed from the absolute outer borders of the canvas
                for (let x = 0; x < width; x++) {
                    pushToQueue(x, 0);
                    pushToQueue(x, height - 1);
                }
                for (let y = 1; y < height - 1; y++) {
                    pushToQueue(0, y);
                    pushToQueue(width - 1, y);
                }
            }

            let head = 0;
            const dx = [1, -1, 0, 0];
            const dy = [0, 0, 1, -1];
            
            // Run BFS flood fill
            while (head < queue.length) {
                const cx = queue[head++];
                const cy = queue[head++];
                
                // Mark as background in mask (transparent)
                const cPixelIdx = (cy * width + cx) * 4;
                maskPixels[cPixelIdx] = 0;
                maskPixels[cPixelIdx + 1] = 0;
                maskPixels[cPixelIdx + 2] = 0;
                maskPixels[cPixelIdx + 3] = 0;
                
                for (let i = 0; i < 4; i++) {
                    const nx = cx + dx[i];
                    const ny = cy + dy[i];
                    
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        const nIdx = ny * width + nx;
                        if (!visited[nIdx]) {
                            const nPixelIdx = nIdx * 4;
                            const nColor = {
                                r: pixels[nPixelIdx],
                                g: pixels[nPixelIdx + 1],
                                b: pixels[nPixelIdx + 2]
                            };
                            
                            // Check if neighbor matches any clustered border background color
                            let matchesBg = false;
                            for (let uc of uniqueColors) {
                                if (colorDiff(nColor, uc) < tolerance) {
                                    matchesBg = true;
                                    break;
                                }
                            }
                            
                            if (matchesBg) {
                                visited[nIdx] = 1;
                                queue.push(nx, ny);
                            }
                        }
                    }
                }
            }
            
            // Mark all unvisited pixels as foreground (white/opaque)
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = y * width + x;
                    if (!visited[idx]) {
                        const mIdx = idx * 4;
                        maskPixels[mIdx] = 255;
                        maskPixels[mIdx + 1] = 255;
                        maskPixels[mIdx + 2] = 255;
                        maskPixels[mIdx + 3] = 255;
                    }
                }
            }

            // Apply bounding box restriction if provided by Gemini AI (keeps only the plant + pot)
            if (boundingBox) {
                const [ymin, xmin, ymax, xmax] = boundingBox;
                const pxYmin = Math.floor(ymin / 1000 * height);
                const pxXmin = Math.floor(xmin / 1000 * width);
                const pxYmax = Math.floor(ymax / 1000 * height);
                const pxXmax = Math.floor(xmax / 1000 * width);
                
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        if (x < pxXmin || x > pxXmax || y < pxYmin || y > pxYmax) {
                            const idx = (y * width + x) * 4;
                            maskPixels[idx] = 0;
                            maskPixels[idx + 1] = 0;
                            maskPixels[idx + 2] = 0;
                            maskPixels[idx + 3] = 0;
                        }
                    }
                }
            }
            
            // Apply polygon restriction if provided by Gemini AI (keeps only the plant + pot outline)
            if (polygon && Array.isArray(polygon) && polygon.length >= 3) {
                const polyCanvas = document.createElement('canvas');
                polyCanvas.width = width;
                polyCanvas.height = height;
                const polyCtx = polyCanvas.getContext('2d');
                polyCtx.fillStyle = '#000000';
                polyCtx.fillRect(0, 0, width, height);
                polyCtx.fillStyle = '#ffffff';
                polyCtx.beginPath();
                polygon.forEach((pt, index) => {
                    const py = pt[0];
                    const px = pt[1];
                    const pxX = (px / 1000) * width;
                    const pyY = (py / 1000) * height;
                    if (index === 0) polyCtx.moveTo(pxX, pyY);
                    else polyCtx.lineTo(pxX, pyY);
                });
                polyCtx.closePath();
                polyCtx.fill();
                
                const polyData = polyCtx.getImageData(0, 0, width, height).data;
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        const idx = (y * width + x) * 4;
                        if (polyData[idx] === 0) { // If it's black (outside the polygon mask)
                            maskPixels[idx] = 0;
                            maskPixels[idx + 1] = 0;
                            maskPixels[idx + 2] = 0;
                            maskPixels[idx + 3] = 0;
                        }
                    }
                }
            }

            this.maskCtx.putImageData(maskData, 0, 0);
            this.filterMaskNoise();
            this.render();
        } catch (err) {
            console.error("CORS canvas error (file:// protocol):", err);
            if (window.showAlert) {
                window.showAlert("⚠️ 브라우저 보안 정책으로 인해 로컬 파일(file://) 모드에서는 누끼 기능이 불가능합니다. 웹 서버 주소(http://localhost:8000)로 접속해 주세요!");
            }
        }
    }

    /**
     * Color Keying (Magic Wand) based on a clicked point
     */
    keyOutColorAt(x, y, tolerance = 40) {
        try {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = this.width;
            tempCanvas.height = this.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(this.originalImage, 0, 0, this.width, this.height);

            // Get target pixel color
            const targetPixel = tempCtx.getImageData(x, y, 1, 1).data;
            const targetR = targetPixel[0];
            const targetG = targetPixel[1];
            const targetB = targetPixel[2];

            const imgData = tempCtx.getImageData(0, 0, this.width, this.height);
            const maskData = this.maskCtx.getImageData(0, 0, this.width, this.height);
            const pixels = imgData.data;
            const maskPixels = maskData.data;

            for (let i = 0; i < pixels.length; i += 4) {
                const r = pixels[i];
                const g = pixels[i + 1];
                const b = pixels[i + 2];

                const diff = Math.sqrt(
                    Math.pow(r - targetR, 2) + 
                    Math.pow(g - targetG, 2) + 
                    Math.pow(b - targetB, 2)
                );

                if (diff < tolerance) {
                    maskPixels[i + 3] = 0; // Set transparency to 0 on mask
                }
            }

            this.maskCtx.putImageData(maskData, 0, 0);
            this.render();
        } catch (err) {
            console.error("CORS canvas error (file:// protocol):", err);
            if (window.showAlert) {
                window.showAlert("⚠️ 브라우저 보안 정책으로 인해 로컬 파일(file://) 모드에서는 누끼 기능이 불가능합니다. 웹 서버 주소(http://localhost:8000)로 접속해 주세요!");
            }
        }
    }

    /**
     * Reset mask to fully visible
     */
    resetMask() {
        this.maskCtx.fillStyle = '#ffffff';
        this.maskCtx.fillRect(0, 0, this.width, this.height);
        this.render();
    }

    /**
     * Start brush drawing
     */
    startDrawing(x, y) {
        if (this.brushMode === 'magic') {
            this.keyOutColorAt(Math.round(x), Math.round(y), 32);
            return;
        }
        this.isDrawing = true;
        this.lastX = x;
        this.lastY = y;
        this.drawBrush(x, y);
    }

    /**
     * Draw with brush on the mask canvas
     */
    drawBrush(x, y) {
        if (!this.isDrawing) return;

        this.maskCtx.beginPath();
        this.maskCtx.lineWidth = this.brushSize;
        this.maskCtx.lineCap = 'round';
        this.maskCtx.lineJoin = 'round';

        if (this.brushMode === 'erase') {
            // Eraser: draw transparent on the mask
            this.maskCtx.globalCompositeOperation = 'destination-out';
            this.maskCtx.strokeStyle = 'rgba(0,0,0,1)';
        } else {
            // Restore: paint opaque white back onto the mask
            this.maskCtx.globalCompositeOperation = 'source-over';
            this.maskCtx.strokeStyle = '#ffffff';
        }

        this.maskCtx.moveTo(this.lastX, this.lastY);
        this.maskCtx.lineTo(x, y);
        this.maskCtx.stroke();

        this.lastX = x;
        this.lastY = y;

        // Reset blend mode to default
        this.maskCtx.globalCompositeOperation = 'source-over';

        this.render();
    }

    stopDrawing() {
        this.isDrawing = false;
    }

    /**
     * Filter out all components except the single largest connected component (plant + pot).
     * This enforces a unified "한 덩어리" sticker and removes any disjointed background clutter.
     */
    filterMaskNoise() {
        try {
            const maskData = this.maskCtx.getImageData(0, 0, this.width, this.height);
            const data = maskData.data;
            const width = this.width;
            const height = this.height;
            const visited = new Uint8Array(width * height);
            
            const components = [];
            const step = 4; // Step by 4 pixels to keep it extremely fast (<5ms)
            
            const isActive = (x, y) => {
                const idx = (y * width + x) * 4;
                return data[idx + 3] > 127; // alpha check
            };

            for (let y = 0; y < height; y += step) {
                for (let x = 0; x < width; x += step) {
                    const pixelIdx = y * width + x;
                    if (visited[pixelIdx]) continue;
                    if (!isActive(x, y)) continue;

                    // Start BFS to trace this component
                    const component = [];
                    const queue = [[x, y]];
                    visited[pixelIdx] = 1;

                    while (queue.length > 0) {
                        const [cx, cy] = queue.shift();
                        component.push([cx, cy]);

                        const neighbors = [
                            [cx + step, cy],
                            [cx - step, cy],
                            [cx, cy + step],
                            [cx, cy - step]
                        ];

                        for (let [nx, ny] of neighbors) {
                            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                                const nIdx = ny * width + nx;
                                if (!visited[nIdx] && isActive(nx, ny)) {
                                    visited[nIdx] = 1;
                                    queue.push([nx, ny]);
                                }
                            }
                        }
                    }
                    if (component.length > 0) {
                        components.push(component);
                    }
                }
            }

            if (components.length === 0) return;

            // Sort by component size descending
            components.sort((a, b) => b.length - a.length);
            
            // Keep ONLY the single largest component (the main plant + pot)
            const mainComponent = components[0];
            const keepMap = new Uint8Array(width * height);
            
            mainComponent.forEach(([cx, cy]) => {
                for (let dy = -Math.floor(step/2); dy <= Math.floor(step/2); dy++) {
                    for (let dx = -Math.floor(step/2); dx <= Math.floor(step/2); dx++) {
                        const px = cx + dx;
                        const py = cy + dy;
                        if (px >= 0 && px < width && py >= 0 && py < height) {
                            keepMap[py * width + px] = 1;
                        }
                    }
                }
            });

            // Apply filter to mask canvas (everything else becomes 100% transparent)
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = (y * width + x) * 4;
                    if (!keepMap[y * width + x]) {
                        data[idx] = 0;
                        data[idx + 1] = 0;
                        data[idx + 2] = 0;
                        data[idx + 3] = 0;
                    }
                }
            }

            this.maskCtx.putImageData(maskData, 0, 0);
        } catch (err) {
            console.error("Error filtering mask noise:", err);
        }
    }

    /**
     * Render the composited image with a bold white sticker outline and drop-shadow
     */
    render() {
        this.ctx.clearRect(0, 0, this.width, this.height);

        // 1. Draw the masked plant image onto the pre-allocated tempCanvas
        this.tempCtx.clearRect(0, 0, this.width, this.height);
        this.tempCtx.drawImage(this.maskCanvas, 0, 0);
        this.tempCtx.globalCompositeOperation = 'source-in';
        this.tempCtx.drawImage(this.originalImage, 0, 0, this.width, this.height);
        this.tempCtx.globalCompositeOperation = 'source-over';

        // 2. Create the solid white silhouette on the pre-allocated silCanvas
        this.silCtx.clearRect(0, 0, this.width, this.height);
        this.silCtx.drawImage(this.tempCanvas, 0, 0);
        this.silCtx.globalCompositeOperation = 'source-in';
        this.silCtx.fillStyle = '#ffffff';
        this.silCtx.fillRect(0, 0, this.width, this.height);
        this.silCtx.globalCompositeOperation = 'source-over';

        // 3. Draw the thick white outline on the display canvas by offsetting the silhouette
        // Calculate proportional outline thickness and shadow blur based on canvas width
        const outlineRadius = Math.max(6, Math.round(this.width * 0.022)); // Proportional to canvas width (~2.2%)
        const steps = Math.max(16, Math.min(32, Math.round(outlineRadius * 1.5))); // Smooth out circle offsets
        
        const shadowBlur = Math.max(4, Math.round(this.width * 0.012));
        const shadowOffsetY = Math.max(2, Math.round(this.width * 0.008));
        
        // Setup drop shadow on the display canvas to make the sticker pop!
        this.ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
        this.ctx.shadowBlur = shadowBlur;
        this.ctx.shadowOffsetX = 0;
        this.ctx.shadowOffsetY = shadowOffsetY;

        for (let i = 0; i < steps; i++) {
            const angle = (i / steps) * Math.PI * 2;
            const dx = Math.cos(angle) * outlineRadius;
            const dy = Math.sin(angle) * outlineRadius;
            
            this.ctx.drawImage(this.silCanvas, dx, dy);
            
            // Turn off shadow after the first draw to avoid compounding opacity
            if (i === 0) {
                this.ctx.shadowColor = 'transparent';
                this.ctx.shadowBlur = 0;
                this.ctx.shadowOffsetX = 0;
                this.ctx.shadowOffsetY = 0;
            }
        }

        // 4. Draw the original plant cutout on top in the center
        this.ctx.drawImage(this.tempCanvas, 0, 0);
    }

    /**
     * Export the final background-removed image as PNG base64
     */
    getMaskedBase64() {
        return this.displayCanvas.toDataURL('image/png');
    }
}
