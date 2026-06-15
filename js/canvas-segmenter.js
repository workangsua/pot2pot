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
     * Automatic white background removal (ideal for white-bg presets)
     */
    autoRemoveWhiteBackground(tolerance = 30) {
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

            // Sample 4 corners of the image (with a tiny inset to avoid border shadows or absolute edge artifacts)
            const insetX = Math.max(2, Math.floor(this.width * 0.01));
            const insetY = Math.max(2, Math.floor(this.height * 0.01));
            
            const getPixel = (imgD, x, y) => {
                const idx = (y * imgD.width + x) * 4;
                return {
                    r: imgD.data[idx],
                    g: imgD.data[idx + 1],
                    b: imgD.data[idx + 2]
                };
            };

            const corners = [
                getPixel(imgData, insetX, insetY), // Top-left
                getPixel(imgData, this.width - 1 - insetX, insetY), // Top-right
                getPixel(imgData, insetX, this.height - 1 - insetY), // Bottom-left
                getPixel(imgData, this.width - 1 - insetX, this.height - 1 - insetY) // Bottom-right
            ];

            // Group corner colors to find the most common background color
            const groups = [];
            corners.forEach(color => {
                let found = false;
                for (let group of groups) {
                    const diff = Math.sqrt(
                        Math.pow(color.r - group.color.r, 2) +
                        Math.pow(color.g - group.color.g, 2) +
                        Math.pow(color.b - group.color.b, 2)
                    );
                    if (diff < 20) {
                        group.count++;
                        // Average color slightly
                        group.color.r = Math.round((group.color.r * (group.count - 1) + color.r) / group.count);
                        group.color.g = Math.round((group.color.g * (group.count - 1) + color.g) / group.count);
                        group.color.b = Math.round((group.color.b * (group.count - 1) + color.b) / group.count);
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    groups.push({ color: { ...color }, count: 1 });
                }
            });

            // Sort by count descending
            groups.sort((a, b) => b.count - a.count);

            // Default target color is white
            let targetR = 255, targetG = 255, targetB = 255;
            if (groups.length > 0) {
                targetR = groups[0].color.r;
                targetG = groups[0].color.g;
                targetB = groups[0].color.b;
            }

            console.log(`Auto-detected background color: RGB(${targetR}, ${targetG}, ${targetB})`);

            // Apply keying based on target color
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
                    maskPixels[i] = 0;     // R
                    maskPixels[i + 1] = 0; // G
                    maskPixels[i + 2] = 0; // B
                    maskPixels[i + 3] = 0; // A
                } else {
                    maskPixels[i] = 255;
                    maskPixels[i + 1] = 255;
                    maskPixels[i + 2] = 255;
                    maskPixels[i + 3] = 255;
                }
            }

            this.maskCtx.putImageData(maskData, 0, 0);
            this.filterMaskNoise(0.02);
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
     * Filter out small isolated islands/noise (e.g. status bar text, battery icon, small specks)
     * keeps only the large plant component.
     */
    filterMaskNoise(minSizePercent = 0.02) {
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
            const largestSize = components[0].length;
            const threshold = largestSize * minSizePercent; // Component must be at least 2% of the main component size

            const keepMap = new Uint8Array(width * height);
            components.forEach(comp => {
                // If it is smaller than threshold and not exceptionally large, discard it
                if (comp.length < threshold && comp.length < 800) {
                    return; 
                }
                
                // Keep these pixels
                comp.forEach(([cx, cy]) => {
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
            });

            // Apply filter to mask canvas
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
