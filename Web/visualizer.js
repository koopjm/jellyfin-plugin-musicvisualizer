(function () {
    'use strict';

    const MODES = ['bars', 'wave', 'circle', 'spectrum-3d', 'particles', 'rainbow-road'];
    const MODE_NAMES = {
        'bars': 'Frequency Bars',
        'wave': 'Waveform',
        'circle': 'Circular Bars',
        'spectrum-3d': '3D Rotating Spectrum',
        'particles': '3D Starfield',
        'rainbow-road': 'Rainbow Road'
    };

    class MusicVisualizerPlugin {
        constructor({ events, playbackManager, appRouter, toast, ServerConnections }) {
            this.name = 'Music Visualizer Plugin';
            this.type = 'skin';
            this.id = 'musicVisualizerPlugin';
            this.events = events;
            this.playbackManager = playbackManager;
            this.appRouter = appRouter;
            this.toast = toast;
            this.ServerConnections = ServerConnections;

            this.overlay = null;
            this.isOpen = false;
            this.currentPlayer = null;
            this.analyser = null;
            this.canvas = null;
            this.canvasCtx = null;
            this.dataArray = null;
            this.animationId = null;
            this.slideshowInterval = null;
            this.currentItem = null;
            this.savedLyrics = [];
            this.isDynamicLyric = false;
            this.visualizerMode = localStorage.getItem('musicVisualizerMode') || 'bars';
            this.rotAngle = 0;
            this.particles = [];
            this.PARTICLE_COUNT = 150;

            this.init();
        }

        init() {
            window.JellyfinMusicVisualizer = {
                open: () => this.openOverlay(),
                close: () => this.closeOverlay(),
                toggle: () => this.toggleOverlay()
            };

            const observer = new MutationObserver(() => this.ensureNowPlayingButton());
            observer.observe(document.body, { childList: true, subtree: true });
            this.ensureNowPlayingButton();

            // Close on browser Back button (popstate) or route change
            window.addEventListener('popstate', () => {
                if (this.isOpen) {
                    this.closeOverlay(true);
                }
            });

            window.addEventListener('hashchange', () => {
                if (window.location.hash === '#/musicvisualizer') {
                    this.openOverlay(true);
                } else if (this.isOpen) {
                    this.closeOverlay(true);
                }
            });

            // Close on Escape key
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.isOpen) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.closeOverlay();
                }
            }, true);
        }

        ensureNowPlayingButton() {
            const bar = document.querySelector('.nowPlayingBar');
            if (!bar) return;

            let btn = bar.querySelector('.openVisualizerButton');
            if (!btn) {
                const lyricBtn = bar.querySelector('.openLyricsButton');
                if (!lyricBtn || !lyricBtn.parentElement) return;

                btn = document.createElement('button');
                btn.setAttribute('is', 'paper-icon-button-light');
                btn.className = 'openVisualizerButton mediaButton paper-icon-button-light';
                btn.title = 'Visualizer';
                btn.innerHTML = '<span class="material-icons view_agenda" aria-hidden="true"></span>';
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleOverlay();
                });
                lyricBtn.insertAdjacentElement('afterend', btn);
            }

            const player = this.playbackManager.getCurrentPlayer();
            const state = player ? this.playbackManager.getPlayerState(player) : null;
            const isAudio = !!(state && state.NowPlayingItem && state.NowPlayingItem.Type === 'Audio');
            btn.classList.toggle('hide', !isAudio);
            btn.classList.toggle('buttonActive', this.isOpen);
        }

        createOverlay() {
            if (this.overlay) return;

            const style = document.createElement('style');
            style.id = 'musicvisualizer-plugin-styles';
            style.textContent = `
                body.mv-visualizer-open {
                    overflow: hidden !important;
                }
                body.mv-visualizer-open .skinHeader,
                body.mv-visualizer-open .MuiAppBar-root,
                body.mv-visualizer-open .MuiDrawer-root,
                body.mv-visualizer-open .mainDrawer {
                    visibility: hidden !important;
                    pointer-events: none !important;
                }
                body.mv-visualizer-open .appfooter {
                    z-index: 20001 !important;
                    position: fixed !important;
                    bottom: 0 !important;
                    left: 0 !important;
                    right: 0 !important;
                }
                #musicvisualizer-plugin-overlay {
                    position: fixed;
                    inset: 0;
                    width: 100vw;
                    height: 100vh;
                    z-index: 20000;
                    background: #000;
                    display: none;
                    flex-direction: column;
                    overflow: hidden;
                    box-sizing: border-box;
                    padding-bottom: 4.2em;
                }
            `;
            document.head.appendChild(style);

            const div = document.createElement('div');
            div.id = 'musicvisualizer-plugin-overlay';
            div.innerHTML = `
                <button id="mvCloseBtn" type="button"
                    style="position:fixed;top:16px;left:16px;z-index:20005;background:rgba(20,20,20,0.8);color:#fff;border:1px solid rgba(255,255,255,0.2);border-radius:50%;width:44px;height:44px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,0.6);"
                    title="Close Visualizer (Esc)">
                    <span class="material-icons arrow_back" style="font-size:1.6rem;"></span>
                </button>
                <div class="mv-lyrics-section"
                    style="flex:1 1 0;min-height:0;width:100%;overflow:hidden;position:relative;display:flex;justify-content:center;align-items:center;background:rgba(0,0,0,0.3);">
                    <div class="lyricsContainer"
                        style="text-align:center;width:90%;max-height:90%;overflow-y:auto;mask-image:linear-gradient(to bottom, transparent, black 10%, black 90%, transparent);">
                    </div>
                </div>
                <div class="mv-slideshow-section"
                    style="flex:1 1 0;min-height:0;width:100%;overflow:hidden;position:relative;background-color:#000;">
                    <div class="mv-bg-1" style="position:absolute;top:0;left:0;width:100%;height:100%;background-size:cover;background-position:center;transition:opacity 2s ease-in-out;opacity:1;z-index:1;"></div>
                    <div class="mv-bg-2" style="position:absolute;top:0;left:0;width:100%;height:100%;background-size:cover;background-position:center;transition:opacity 2s ease-in-out;opacity:0;z-index:2;"></div>
                </div>
                <div class="mv-visualizer-section"
                    style="flex:1 1 0;min-height:0;width:100%;overflow:hidden;position:relative;background:black;">
                    <div class="mv-track-info" style="position:absolute;top:0;left:0;right:0;z-index:5;text-align:center;text-shadow:0 0 5px black;background:rgba(0,0,0,0.5);padding:6px 10px;pointer-events:none;">
                        <h2 class="mv-title" style="margin:0;color:#fff;"></h2>
                        <h3 class="mv-artist" style="margin:0;opacity:0.8;color:#fff;"></h3>
                    </div>
                    <canvas id="visualizerCanvas" style="display:block;width:100%;height:100%;"></canvas>
                    <button id="visualizerModeBtn" type="button"
                        style="position:fixed;top:16px;right:16px;z-index:20005;background:rgba(20,20,20,0.8);color:#fff;border:1px solid rgba(255,255,255,0.2);border-radius:50%;width:44px;height:44px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,0.6);"
                        title="Switch Visualizer Mode">
                        <span class="material-icons settings" style="font-size:1.5rem;"></span>
                    </button>
                </div>
            `;
            document.body.appendChild(div);
            this.overlay = div;

            div.querySelector('#mvCloseBtn').addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.closeOverlay();
            });
            div.querySelector('#visualizerModeBtn').addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const idx = MODES.indexOf(this.visualizerMode);
                this.visualizerMode = MODES[(idx + 1) % MODES.length];
                localStorage.setItem('musicVisualizerMode', this.visualizerMode);
                if (this.toast) this.toast(`Visualizer: ${MODE_NAMES[this.visualizerMode]}`);
            });
        }

        toggleOverlay() {
            if (this.isOpen) {
                this.closeOverlay();
            } else {
                this.openOverlay();
            }
        }

        openOverlay(fromHistory) {
            this.createOverlay();
            if (this.isOpen) return;
            this.isOpen = true;

            document.body.classList.add('mv-visualizer-open');
            this.overlay.style.display = 'flex';
            this.ensureNowPlayingButton();

            if (!fromHistory) {
                history.pushState({ jellyfinVisualizer: true }, '');
            }

            this.onPlayerChange = () => this.bindToPlayer(this.playbackManager.getCurrentPlayer());
            this.events.on(this.playbackManager, 'playerchange', this.onPlayerChange);
            this.onPlayerChange();
        }

        closeOverlay(fromPopState) {
            if (!this.isOpen) return;
            this.isOpen = false;

            document.body.classList.remove('mv-visualizer-open');
            if (this.overlay) {
                this.overlay.style.display = 'none';
            }
            this.ensureNowPlayingButton();

            if (this.onPlayerChange) {
                this.events.off(this.playbackManager, 'playerchange', this.onPlayerChange);
            }
            this.bindToPlayer(null);
            if (this.animationId) {
                cancelAnimationFrame(this.animationId);
                this.animationId = null;
            }
            if (this.slideshowInterval) {
                clearInterval(this.slideshowInterval);
                this.slideshowInterval = null;
            }
            if (this.analyser) {
                try { this.analyser.disconnect(); } catch (e) {}
                this.analyser = null;
            }
            this.currentItem = null;

            if (!fromPopState && history.state && history.state.jellyfinVisualizer) {
                history.back();
            }
        }

        bindToPlayer(player) {
            if (player === this.currentPlayer) return;
            if (this.currentPlayer) {
                this.events.off(this.currentPlayer, 'timeupdate', this._onTimeUpdate);
                this.events.off(this.currentPlayer, 'playbackstart', this._onPlaybackStart);
                this.events.off(this.currentPlayer, 'playbackstop', this._onPlaybackStop);
                this.currentPlayer = null;
            }
            this.currentPlayer = player;
            if (this.currentPlayer) {
                this._onTimeUpdate = () => this.onTimeUpdate();
                this._onPlaybackStart = (e, state) => this.onPlaybackStart(e, state);
                this._onPlaybackStop = (e, state) => {
                    if (!state || !state.NextMediaType) this.closeOverlay();
                };
                this.events.on(this.currentPlayer, 'timeupdate', this._onTimeUpdate);
                this.events.on(this.currentPlayer, 'playbackstart', this._onPlaybackStart);
                this.events.on(this.currentPlayer, 'playbackstop', this._onPlaybackStop);

                this.initAudioAnalyser();
                const state = this.playbackManager.getPlayerState(this.currentPlayer);
                if (state && state.NowPlayingItem) {
                    this.onPlaybackStart({ type: 'manual' }, state);
                }
            }
        }

        initAudioAnalyser() {
            const player = this.currentPlayer;
            if (!player) return;

            const gainNode = player.gainNode;
            const audioCtx = player.audioContext || (gainNode && gainNode.context);
            if (!audioCtx || !gainNode) return;

            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
            if (!this.analyser) {
                this.analyser = audioCtx.createAnalyser();
                this.analyser.fftSize = 2048;
                this.analyser.smoothingTimeConstant = 0.85;
                gainNode.connect(this.analyser);
            }
            this.canvas = this.overlay.querySelector('#visualizerCanvas');
            this.canvasCtx = this.canvas.getContext('2d');
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            if (!this.animationId) {
                this.drawVisualizer();
            }
        }

        drawVisualizer() {
            if (!this.canvas || !this.analyser || !this.isOpen) return;
            this.animationId = requestAnimationFrame(() => this.drawVisualizer());

            if (this.canvas.width !== this.canvas.clientWidth || this.canvas.height !== this.canvas.clientHeight) {
                this.canvas.width = this.canvas.clientWidth;
                this.canvas.height = this.canvas.clientHeight;
            }
            const width = this.canvas.width;
            const height = this.canvas.height;
            const ctx = this.canvasCtx;
            const dataArray = this.dataArray;
            ctx.clearRect(0, 0, width, height);

            if (this.visualizerMode === 'wave') {
                this.analyser.getByteTimeDomainData(dataArray);
                ctx.lineWidth = 2;
                ctx.strokeStyle = 'rgb(0, 255, 0)';
                ctx.beginPath();
                const sliceWidth = width / dataArray.length;
                let x = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    const y = (dataArray[i] / 128.0) * height / 2;
                    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                    x += sliceWidth;
                }
                ctx.lineTo(width, height / 2);
                ctx.stroke();
            } else if (this.visualizerMode === 'circle') {
                this.analyser.getByteFrequencyData(dataArray);
                const cx = width / 2, cy = height / 2, radius = Math.min(width, height) / 4;
                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
                ctx.strokeStyle = 'rgba(255,255,255,0.5)';
                ctx.stroke();
                const bars = 180;
                for (let i = 0; i < bars; i++) {
                    const val = dataArray[i * 4];
                    const h = (val / 255) * (radius * 1.5);
                    const angle = (i / bars) * 2 * Math.PI;
                    ctx.strokeStyle = `hsl(${(i / bars) * 360}, 100%, 50%)`;
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
                    ctx.lineTo(cx + Math.cos(angle) * (radius + h), cy + Math.sin(angle) * (radius + h));
                    ctx.stroke();
                }
            } else if (this.visualizerMode === 'spectrum-3d') {
                this.analyser.getByteFrequencyData(dataArray);
                this.rotAngle += 0.005;
                const cx = width / 2, cy = height / 2, cylR = Math.min(width, height) / 3;
                const fov = 300, barCount = 64, step = Math.floor(dataArray.length / barCount);
                const bars = [];
                for (let i = 0; i < barCount; i++) {
                    const angle = (i / barCount) * 2 * Math.PI + this.rotAngle;
                    bars.push({ index: i, x: Math.cos(angle) * cylR, z: Math.sin(angle) * cylR });
                }
                bars.sort((a, b) => a.z - b.z);
                for (const b of bars) {
                    const val = dataArray[b.index * step];
                    const scale = fov / (fov - b.z);
                    const x2d = b.x * scale + cx;
                    const bottomY = (cylR / 2) * scale + cy;
                    const h2d = ((val / 255) * height * 0.5) * scale;
                    const w2d = (width / barCount) * scale * 0.8;
                    const alpha = 0.3 + 0.7 * ((b.z + cylR) / (2 * cylR));
                    ctx.fillStyle = `hsla(${(b.index / barCount) * 300}, 100%, 50%, ${alpha})`;
                    ctx.fillRect(x2d - w2d / 2, bottomY - h2d, w2d, h2d);
                }
            } else if (this.visualizerMode === 'particles') {
                this.analyser.getByteFrequencyData(dataArray);
                let bassSum = 0;
                for (let i = 0; i < 20; i++) bassSum += dataArray[i];
                const boost = (bassSum / 20) / 255;
                const cx = width / 2, cy = height / 2;
                if (this.particles.length === 0) {
                    for (let i = 0; i < this.PARTICLE_COUNT; i++) {
                        this.particles.push({ x: (Math.random() - 0.5) * width, y: (Math.random() - 0.5) * height, z: Math.random() * width, color: Math.random() * 360 });
                    }
                }
                const speed = 5 + boost * 30;
                for (const p of this.particles) {
                    p.z -= speed;
                    if (p.z <= 0) {
                        p.z = width; p.x = (Math.random() - 0.5) * width; p.y = (Math.random() - 0.5) * height; p.color = Math.random() * 360;
                    }
                    const k = 128 / p.z, px = cx + p.x * k, py = cy + p.y * k;
                    if (px >= 0 && px <= width && py >= 0 && py <= height) {
                        const size = (1 - p.z / width) * 5 + boost * 5;
                        ctx.fillStyle = `hsla(${p.color}, 100%, 50%, ${1 - p.z / width})`;
                        ctx.beginPath();
                        ctx.arc(px, py, size, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            } else if (this.visualizerMode === 'rainbow-road') {
                this.analyser.getByteFrequencyData(dataArray);
                const bars = 64, step = Math.floor(dataArray.length / bars);
                for (let i = 0; i < bars; i++) {
                    const val = dataArray[i * step], p = i / bars;
                    const hue = (p * 360) + (performance.now() / 20);
                    const barW = width / bars, barH = (val / 255) * height;
                    ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
                    ctx.fillRect(i * barW, height - barH, barW, barH);
                    ctx.fillStyle = `hsla(${hue}, 100%, 50%, 0.2)`;
                    ctx.fillRect(i * barW, height - barH - 10, barW, -barH / 2);
                }

                const vpX = width / 2;
                const vpY = height * 0.2;
                const roadWidth = width * 2;
                const segmentCount = 30;
                this.rotAngle -= 0.05;

                for (let i = 0; i < segmentCount; i++) {
                    const depth = i / segmentCount;
                    const z = Math.pow(depth, 2);
                    const y = height - (z * (height - vpY));
                    const w = roadWidth * (1 - z);
                    const freqIdx = Math.floor((1 - depth) * 64);
                    const val = dataArray[freqIdx * 4];
                    const boost = val / 255;
                    const hue = (i * 10) + (performance.now() / 10);

                    ctx.fillStyle = `hsla(${hue}, 100%, 50%, ${0.1 + boost * 0.5})`;
                    ctx.fillRect(vpX - w / 2, y, w, (height / segmentCount) * (1 - z) + 2);
                }
            } else {
                this.analyser.getByteFrequencyData(dataArray);
                const barCount = 128, step = Math.floor(dataArray.length / barCount), barWidth = width / barCount;
                let x = 0;
                for (let i = 0; i < barCount; i++) {
                    const barHeight = (dataArray[i * step] / 255) * height;
                    ctx.fillStyle = `hsl(${(i / barCount) * 300}, 100%, 50%)`;
                    ctx.fillRect(x, height - barHeight, barWidth + 1, barHeight);
                    x += barWidth;
                }
            }
        }

        onPlaybackStart(e, state) {
            if (!state || !state.NowPlayingItem) return;
            const item = state.NowPlayingItem;
            if (this.currentItem && this.currentItem.Id === item.Id) return;
            this.currentItem = item;

            const title = this.overlay.querySelector('.mv-title');
            const artist = this.overlay.querySelector('.mv-artist');
            if (title) title.textContent = item.Name || 'Unknown Title';
            if (artist) artist.textContent = item.Artists ? item.Artists.join(', ') : (item.AlbumArtist || 'Unknown Artist');

            this.loadArtistImages(item);
            this.loadLyrics(item);
        }

        async loadLyrics(item) {
            this.savedLyrics = [];
            this.isDynamicLyric = false;
            this.renderLyrics([]);
            if (!item.HasLyrics) return;
            try {
                const apiClient = this.ServerConnections.getApiClient(item.ServerId);
                const resp = await apiClient.getJSON(apiClient.getUrl(`Audio/${item.Id}/Lyrics`));
                if (resp && resp.Lyrics && resp.Lyrics.length) {
                    this.savedLyrics = resp.Lyrics;
                    this.isDynamicLyric = true;
                    this.renderLyrics(this.savedLyrics);
                }
            } catch (err) {
                console.warn('[VisualizerPlugin] Lyrics fetch error', err);
            }
        }

        renderLyrics(lyrics) {
            const container = this.overlay?.querySelector('.lyricsContainer');
            if (!container) return;
            if (lyrics && lyrics.length) {
                container.innerHTML = lyrics.map((l, i) => {
                    const time = typeof l.Start !== 'undefined' ? `data-lyrictime="${l.Start}"` : '';
                    const text = (l.Text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    return `<div class="lyricsLine" id="mvLyric${i}" ${time} style="padding:10px 5px;font-size:1.5em;color:#fff;opacity:0.5;transition:all 0.2s ease-out;cursor:pointer;">${text}</div>`;
                }).join('');
                container.querySelectorAll('.lyricsLine').forEach(el => {
                    el.addEventListener('click', () => {
                        const time = el.getAttribute('data-lyrictime');
                        if (time) this.playbackManager.seek(parseInt(time, 10));
                    });
                });
            } else {
                container.innerHTML = '<h3 style="opacity:0.5;color:#fff;">No lyrics found</h3>';
            }
        }

        onTimeUpdate() {
            if (!this.currentPlayer || !this.isDynamicLyric || !this.savedLyrics.length) return;
            const timeMs = this.playbackManager.currentTime(this.currentPlayer);
            if (typeof timeMs !== 'number') return;
            const currentTicks = timeMs * 10000;
            let index = -1;
            for (let i = this.savedLyrics.length - 1; i >= 0; i--) {
                if (this.savedLyrics[i].Start <= currentTicks) { index = i; break; }
            }
            if (index !== -1 && this.overlay) {
                this.overlay.querySelectorAll('.lyricsLine').forEach((l, i) => {
                    if (i === index) {
                        if (!l.classList.contains('active')) {
                            l.classList.add('active');
                            l.style.opacity = '1';
                            l.style.fontSize = '2.2em';
                            l.style.fontWeight = 'bold';
                            l.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                    } else if (l.classList.contains('active')) {
                        l.classList.remove('active');
                        l.style.opacity = '0.5';
                        l.style.fontSize = '1.5em';
                        l.style.fontWeight = 'normal';
                    }
                });
            }
        }

        loadArtistImages(item) {
            if (!item || !this.overlay) return;

            const bg1 = this.overlay.querySelector('.mv-bg-1');
            const bg2 = this.overlay.querySelector('.mv-bg-2');

            if (this.slideshowInterval) {
                clearInterval(this.slideshowInterval);
                this.slideshowInterval = null;
            }

            const serverId = item.ServerId;
            const apiClient = this.ServerConnections.getApiClient(serverId);
            const artistId = item.ArtistItems?.[0]?.Id || item.AlbumArtists?.[0]?.Id;

            let showTop = false;
            if (bg1) bg1.style.opacity = '1';
            if (bg2) bg2.style.opacity = '0';

            const setBackground = (element, url) => {
                if (element) element.style.backgroundImage = url ? `url('${url}')` : 'none';
            };

            const getFallbackUrl = () => {
                if (item.BackdropImageTags && item.BackdropImageTags.length > 0) {
                    return apiClient.getUrl(`Items/${item.Id}/Images/Backdrop/0`, { tag: item.BackdropImageTags[0], maxWidth: 1920 });
                }
                if (item.ParentBackdropItemId && item.ParentBackdropImageTags && item.ParentBackdropImageTags.length > 0) {
                    return apiClient.getUrl(`Items/${item.ParentBackdropItemId}/Images/Backdrop/0`, { tag: item.ParentBackdropImageTags[0], maxWidth: 1920 });
                }
                if (item.ImageTags && item.ImageTags.Primary) {
                    return apiClient.getUrl(`Items/${item.Id}/Images/Primary`, { tag: item.ImageTags.Primary, maxWidth: 1920 });
                }
                if (item.AlbumId && item.AlbumPrimaryImageTag) {
                    return apiClient.getUrl(`Items/${item.AlbumId}/Images/Primary`, { tag: item.AlbumPrimaryImageTag, maxWidth: 1920 });
                }
                return null;
            };

            const startRotation = (urls) => {
                if (this.slideshowInterval) {
                    clearInterval(this.slideshowInterval);
                    this.slideshowInterval = null;
                }

                if (!urls || urls.length === 0) {
                    const fallback = getFallbackUrl();
                    setBackground(bg1, fallback);
                    if (bg2) bg2.style.opacity = '0';
                    return;
                }

                const shuffled = [...urls].sort(() => 0.5 - Math.random());
                let idx = 0;

                setBackground(bg1, shuffled[idx]);
                idx = (idx + 1) % shuffled.length;

                const rotate = () => {
                    const nextUrl = shuffled[idx];
                    if (showTop) {
                        setBackground(bg1, nextUrl);
                        if (bg2) bg2.style.opacity = '0';
                        showTop = false;
                    } else {
                        setBackground(bg2, nextUrl);
                        if (bg2) bg2.style.opacity = '1';
                        showTop = true;
                    }
                    idx = (idx + 1) % shuffled.length;
                };

                if (shuffled.length > 1) {
                    this.slideshowInterval = setInterval(rotate, 10000);
                }
            };

            if (artistId) {
                const userId = apiClient.getCurrentUserId();
                const localPromise = apiClient.getItem(userId, artistId).then(artist => {
                    const localUrls = [];
                    if (artist.BackdropImageTags && artist.BackdropImageTags.length) {
                        artist.BackdropImageTags.forEach((tag, i) => {
                            localUrls.push(apiClient.getUrl(`Items/${artistId}/Images/Backdrop/${i}`, { tag: tag, maxWidth: 1920 }));
                        });
                    } else if (artist.ImageTags && artist.ImageTags.Primary) {
                        localUrls.push(apiClient.getUrl(`Items/${artistId}/Images/Primary`, { tag: artist.ImageTags.Primary, maxWidth: 1920 }));
                    }
                    return localUrls;
                }).catch(() => []);

                const remotePromise = apiClient.getAvailableRemoteImages({
                    itemId: artistId,
                    type: 'Backdrop,Primary,Art',
                    startIndex: 0,
                    limit: 20
                }).then(result => {
                    return (result.Images || []).map(img => img.Url);
                }).catch(() => []);

                const albumsPromise = apiClient.getItems(userId, {
                    IncludeItemTypes: 'MusicAlbum',
                    AlbumArtistIds: artistId,
                    Recursive: true,
                    Fields: 'PrimaryImageAspectRatio',
                    EnableImageTypes: 'Primary,Backdrop',
                    Limit: 20
                }).then(result => {
                    const albumUrls = [];
                    (result.Items || []).forEach(album => {
                        if (album.BackdropImageTags && album.BackdropImageTags.length > 0) {
                            albumUrls.push(apiClient.getUrl(`Items/${album.Id}/Images/Backdrop/0`, { tag: album.BackdropImageTags[0], maxWidth: 1920 }));
                        } else if (album.ImageTags && album.ImageTags.Primary) {
                            albumUrls.push(apiClient.getUrl(`Items/${album.Id}/Images/Primary`, { tag: album.ImageTags.Primary, maxWidth: 1920 }));
                        }
                    });
                    return albumUrls;
                }).catch(() => []);

                Promise.all([localPromise, remotePromise, albumsPromise]).then(results => {
                    const allUrls = results.flat();
                    const uniqueUrls = [...new Set(allUrls)];
                    startRotation(uniqueUrls);
                });
            } else {
                startRotation(null);
            }
        }
    }

    window.musicVisualizerPlugin = async () => MusicVisualizerPlugin;
})();
