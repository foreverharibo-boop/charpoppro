// CHAR-POP-PRO — Enhanced Character Switcher

const EXT_KEY = 'char-pop-pro'; // ST extensionSettings 키
const LS_KEY  = 'cpp_pro_data'; // 구 localStorage 키 (마이그레이션용)

// ── Context ──────────────────────────────────────────────────────────────────
function getCtx() { return SillyTavern.getContext(); }

function getAvatarUrl(character) {
    if (!character?.avatar) return 'img/ai4.png';
    try { return getCtx().getThumbnailUrl('avatar', character.avatar); }
    catch { return `thumbnails/avatar/${character.avatar}`; }
}

function isTap(sx, sy, ex, ey) {
    return Math.abs(ex - sx) < 10 && Math.abs(ey - sy) < 10;
}

// ── Storage (ST 서버 저장소) ──────────────────────────────────────────────────
// SillyTavern extensionSettings에 저장 → settings.json (서버)으로 유지
// localStorage는 브라우저 종속이라 날아갈 수 있어서 사용 안 함

function defaultData() {
    return {
        favorites: [],   // avatar filename[]
        folders: [],     // { id, name, chars: avatar[] }[]
        sort: 'default', // 'default' | 'name' | 'fav-first'
        cols: 4,         // 3 | 4 | 5
        bgOpacity: 0.97, // 0.1 ~ 1
        activeTab: 'all',
    };
}

function getData() {
    const ctx = getCtx();
    if (!ctx.extensionSettings[EXT_KEY]) {
        ctx.extensionSettings[EXT_KEY] = defaultData();
    }
    // 새 키 누락 시 기본값으로 채움 (버전 업 대비)
    const d = ctx.extensionSettings[EXT_KEY];
    const def = defaultData();
    for (const k of Object.keys(def)) {
        if (d[k] === undefined) d[k] = def[k];
    }
    return d;
}

function save() {
    getCtx().saveSettingsDebounced();
}

// localStorage → ST 서버 1회 마이그레이션
function migrateStorage() {
    const ctx = getCtx();
    if (ctx.extensionSettings[EXT_KEY]) return; // 이미 마이그레이션됨
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
            ctx.extensionSettings[EXT_KEY] = { ...defaultData(), ...JSON.parse(raw) };
            save();
            localStorage.removeItem(LS_KEY);
            console.log('[CHAR-POP-PRO] localStorage → ST 서버 마이그레이션 완료');
        }
    } catch(e) {
        console.warn('[CHAR-POP-PRO] 마이그레이션 실패:', e);
    }
}

// ── Favorites ──────────────────────────────────────────────────────────────────
function isFav(avatar) { return getData().favorites.includes(avatar); }

function toggleFav(avatar) {
    const d = getData();
    const i = d.favorites.indexOf(avatar);
    if (i === -1) d.favorites.push(avatar);
    else d.favorites.splice(i, 1);
    save();
}

// ── Folders ────────────────────────────────────────────────────────────────────
function uid() { return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

function createFolder(name) {
    const folder = { id: uid(), name, chars: [] };
    getData().folders.push(folder);
    save();
    return folder;
}

function deleteFolder(id) {
    const d = getData();
    d.folders = d.folders.filter(f => f.id !== id);
    if (d.activeTab === id) d.activeTab = 'all';
    save();
}

function renameFolder(id, name) {
    const f = getData().folders.find(f => f.id === id);
    if (f) { f.name = name; save(); }
}

function addToFolder(folderId, avatar) {
    const f = getData().folders.find(f => f.id === folderId);
    if (f && !f.chars.includes(avatar)) { f.chars.push(avatar); save(); }
}

function removeFromAllFolders(avatar) {
    getData().folders.forEach(f => { f.chars = f.chars.filter(c => c !== avatar); });
    save();
}

function charFolder(avatar) {
    return getData().folders.find(f => f.chars.includes(avatar)) ?? null;
}

// ── UI State ───────────────────────────────────────────────────────────────────
let _ctxTarget = null;
let _query = '';          // 검색어

// ── Create UI ──────────────────────────────────────────────────────────────────
function createUI() {
    if ($('#cpp-avatar-btn').length) return;

    const $btn = $(`
        <div id="cpp-avatar-btn" title="캐릭터 전환">
            <img id="cpp-avatar-img" src="img/ai4.png" alt="캐릭터" />
        </div>`);

    const $picker = $(`
        <div id="cpp-picker" class="cpp-hidden">
            <div id="cpp-header">
                <div id="cpp-tabs"></div>
                <button id="cpp-settings-btn" title="설정">⚙</button>
            </div>
            <div id="cpp-search-wrap">
                <span class="cpp-search-icon">⌕</span>
                <input id="cpp-search" type="text" placeholder="캐릭터 검색…" autocomplete="off" spellcheck="false" />
                <button id="cpp-search-clear" class="cpp-hidden">✕</button>
            </div>
            <div id="cpp-settings-panel">
                <div class="cpp-srow">
                    <label>정렬</label>
                    <select id="cpp-sort">
                        <option value="default">기본</option>
                        <option value="name">이름순</option>
                        <option value="fav-first">즐겨찾기 우선</option>
                    </select>
                </div>
                <div class="cpp-srow">
                    <label>열 수</label>
                    <div class="cpp-col-group">
                        <button class="cpp-col-btn" data-cols="3">3열</button>
                        <button class="cpp-col-btn" data-cols="4">4열</button>
                        <button class="cpp-col-btn" data-cols="5">5열</button>
                    </div>
                </div>
                <div class="cpp-srow">
                    <label>투명도</label>
                    <div class="cpp-opacity-wrap">
                        <input type="range" id="cpp-opacity" min="0.1" max="1" step="0.05" value="0.97" />
                        <span id="cpp-opacity-val">97%</span>
                    </div>
                </div>
                <div class="cpp-divider"></div>
                <div class="cpp-section-label">폴더 관리</div>
                <div id="cpp-folder-list"></div>
                <button id="cpp-add-folder">+ 새 폴더</button>
            </div>
            <div id="cpp-grid"></div>
        </div>`);

    const $ctx = $(`
        <div id="cpp-ctx" class="cpp-hidden">
            <div class="cpp-ctx-item" id="cpp-ctx-fav"></div>
            <div class="cpp-ctx-sep"></div>
            <div class="cpp-ctx-label">📁 폴더</div>
            <div id="cpp-ctx-folders"></div>
            <div class="cpp-ctx-item cpp-ctx-danger" id="cpp-ctx-unfolder"></div>
        </div>`);

    const $form = $('#leftSendForm').length ? $('#leftSendForm') : $('#send_form');
    $form.prepend($btn);
    $('body').append($picker, $ctx);

    // ── 버튼 이벤트
    let _bs = null;
    $('#cpp-avatar-btn')[0].addEventListener('touchstart', e => {
        _bs = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }, { passive: true });

    $('#cpp-avatar-btn')[0].addEventListener('touchend', e => {
        if (!_bs) return;
        const t = e.changedTouches[0];
        if (isTap(_bs.x, _bs.y, t.clientX, t.clientY)) { e.preventDefault(); togglePicker(); }
        _bs = null;
    }, { passive: false });

    $('#cpp-avatar-btn').on('click', () => { if (!('ontouchstart' in window)) togglePicker(); });

    // ── 모바일 키보드 올라올 때 피커 위치 재계산
    // (검색바 탭 → 키보드 → viewport 높이 축소 → 피커 밀려남 방지)
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
            repositionPicker();
        });
    }

    // ── 바깥 닫기
    // document.contains() 체크: 탭 클릭 시 renderTabs()가 DOM을 재생성해서
    // 클릭한 요소가 DOM에서 사라지는 경우 오작동 방지
    document.addEventListener('touchend', e => {
        if (!document.contains(e.target)) return;
        if (!$(e.target).closest('#cpp-picker, #cpp-avatar-btn, #cpp-ctx').length) {
            closePicker(); closeCtx();
        }
    }, { passive: true });

    $(document).on('click.cpp', e => {
        if (!document.contains(e.target)) return;
        if (!$(e.target).closest('#cpp-picker, #cpp-avatar-btn, #cpp-ctx').length) {
            closePicker(); closeCtx();
        }
    });

    // ── 검색바 이벤트
    let _searchTimer = null;
    $('#cpp-search').on('input', function() {
        _query = this.value.trim();
        $('#cpp-search-clear').toggleClass('cpp-hidden', !_query);
        // 디바운스: 타이핑 멈춘 후 200ms 뒤에 렌더 (연속 호출 방지)
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(() => renderGrid(), 200);
    });

    // 검색바 터치 시 피커 닫힘 방지 (stopPropagation)
    $('#cpp-search').on('click touchstart', e => e.stopPropagation());

    // 키보드 올라온 직후 위치 재계산 (visualViewport 없는 구형 브라우저 대비)
    $('#cpp-search').on('focus', () => setTimeout(() => repositionPicker(), 350));

    $('#cpp-search-clear').on('click', () => {
        _query = '';
        $('#cpp-search').val('').focus();
        $('#cpp-search-clear').addClass('cpp-hidden');
        renderGrid();
    });

    // ── 설정 패널 아코디언 토글
    $('#cpp-settings-btn').on('click', e => {
        e.stopPropagation();
        const $panel = $('#cpp-settings-panel');
        const opening = !$panel.hasClass('cpp-open');
        $panel.toggleClass('cpp-open');
        if (opening) renderFolderManager();
        // 패널 열린 후 실제 높이로 위치 재계산
        setTimeout(() => repositionPicker(), 240);
    });

    // ── 정렬
    $('#cpp-sort').on('change', function() {
        getData().sort = this.value; save(); renderGrid();
    });

    // ── 열 수
    $(document).on('click.cpp', '.cpp-col-btn', function() {
        getData().cols = parseInt($(this).data('cols')); save();
        updateColBtns(); renderGrid();
    });

    // ── 투명도
    $('#cpp-opacity').on('input', function() {
        const v = parseFloat(this.value);
        getData().bgOpacity = v; save();
        applyOpacity(v);
        $('#cpp-opacity-val').text(Math.round(v * 100) + '%');
    });

    // ── 새 폴더
    $('#cpp-add-folder').on('click', () => {
        const name = prompt('폴더 이름:');
        if (name?.trim()) { createFolder(name.trim()); renderFolderManager(); renderTabs(); }
    });

    // ── 컨텍스트: 즐겨찾기 토글
    $('#cpp-ctx-fav').on('click', () => {
        if (!_ctxTarget) return;
        toggleFav(_ctxTarget); closeCtx(); renderGrid(); renderTabs();
    });

    // ── 컨텍스트: 폴더 제거
    $('#cpp-ctx-unfolder').on('click', () => {
        if (!_ctxTarget) return;
        removeFromAllFolders(_ctxTarget); closeCtx(); renderGrid();
    });

    const d = getData();
    $('#cpp-sort').val(d.sort);
    $('#cpp-opacity').val(d.bgOpacity);
    $('#cpp-opacity-val').text(Math.round(d.bgOpacity * 100) + '%');

    updateAvatar();
    renderTabs();
}

// ── 투명도 적용 (실제 페이지 배경색 기준) ────────────────────────────────────
function getPageBgRGB() {
    // send_form → 부모 순으로 올라가며 불투명한 배경색 찾기
    // (라이트/다크 테마 관계없이 실제 UI 배경색 사용)
    const candidates = [
        document.getElementById('leftSendForm'),
        document.getElementById('send_form'),
        document.getElementById('chat'),
        document.querySelector('#sheld'),
        document.body,
    ];
    for (const el of candidates) {
        if (!el) continue;
        let cur = el;
        while (cur && cur !== document.documentElement) {
            const bg = getComputedStyle(cur).backgroundColor;
            if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
                const m = bg.match(/(\d+),\s*(\d+),\s*(\d+)/);
                if (m) return [+m[1], +m[2], +m[3]];
            }
            cur = cur.parentElement;
        }
    }
    return null;
}

function applyOpacity(v) {
    const picker = document.getElementById('cpp-picker');
    if (!picker) return;
    const rgb = getPageBgRGB();
    if (rgb) {
        picker.style.background = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${v})`;
    } else {
        // 폴백: ST 변수 시도
        const st = getComputedStyle(document.documentElement)
            .getPropertyValue('--SmartThemeBlurTintColor').trim();
        const m = st.match(/(\d+\.?\d*)[,\s]+(\d+\.?\d*)[,\s]+(\d+\.?\d*)/);
        picker.style.background = m
            ? `rgba(${Math.round(m[1])},${Math.round(m[2])},${Math.round(m[3])},${v})`
            : `rgba(18,19,32,${v})`;
    }
}

// ── 탭 렌더링 ──────────────────────────────────────────────────────────────────
function renderTabs() {
    const $tabs = $('#cpp-tabs').empty();
    const d = getData();

    function makeTab(key, label) {
        const $t = $(`<button class="cpp-tab${d.activeTab === key ? ' cpp-tab-on' : ''}">${label}</button>`);
        $t.on('click', () => { d.activeTab = key; save(); _query = ''; $('#cpp-search').val(''); $('#cpp-search-clear').addClass('cpp-hidden'); renderTabs(); renderGrid(); });
        return $t;
    }

    $tabs.append(makeTab('all', '전체'));
    $tabs.append(makeTab('fav', `⭐${d.favorites.length ? ' ' + d.favorites.length : ''}`));
    d.folders.forEach(f => $tabs.append(makeTab(f.id, f.name)));
}

// ── 캐릭터 그리드 렌더링 ──────────────────────────────────────────────────────
function renderGrid() {
    const $grid = $('#cpp-grid').empty();
    const ctx = getCtx();
    const allChars = ctx.characters ?? [];
    const currentChid = ctx.characterId;
    const d = getData();

    $grid.attr('data-cols', d.cols);

    let chars = allChars.filter(c => c && c.name && c.avatar && c.avatar !== 'none');

    if (d.activeTab === 'fav') {
        chars = chars.filter(c => d.favorites.includes(c.avatar));
        if (!chars.length) { $grid.append('<div class="cpp-empty">즐겨찾기한 캐릭터가 없습니다</div>'); requestAnimationFrame(() => repositionPicker()); return; }
    } else if (d.activeTab !== 'all') {
        const folder = d.folders.find(f => f.id === d.activeTab);
        if (folder) {
            chars = chars.filter(c => folder.chars.includes(c.avatar));
            if (!chars.length) { $grid.append('<div class="cpp-empty">이 폴더에 캐릭터가 없습니다</div>'); requestAnimationFrame(() => repositionPicker()); return; }
        }
    }

    // 검색어 필터
    if (_query) {
        const q = _query.toLowerCase();
        chars = chars.filter(c => c.name.toLowerCase().includes(q));
        if (!chars.length) {
            $grid.append('<div class="cpp-empty">검색 결과가 없습니다</div>');
            requestAnimationFrame(() => repositionPicker());
            return;
        }
    }

    if (d.sort === 'name') {
        chars = [...chars].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    } else if (d.sort === 'fav-first') {
        chars = [...chars].sort((a, b) => (isFav(b.avatar) ? 1 : 0) - (isFav(a.avatar) ? 1 : 0));
    }

    if (!chars.length) { $grid.append('<div class="cpp-empty">캐릭터가 없습니다</div>'); requestAnimationFrame(() => repositionPicker()); return; }

    chars.forEach(char => {
        const idx = allChars.indexOf(char);
        const isActive = idx === currentChid;
        const fav = isFav(char.avatar);
        const safeName = $('<div>').text(char.name).html();

        const $item = $(`
            <div class="cpp-item${isActive ? ' cpp-active' : ''}" data-idx="${idx}" data-av="${char.avatar}" title="${safeName}">
                ${fav ? '<div class="cpp-star">⭐</div>' : ''}
                <img src="${getAvatarUrl(char)}" onerror="this.onerror=null;this.src='img/ai4.png'" />
                <span>${safeName}</span>
            </div>`);

        let _is = null, _lt = null;

        $item[0].addEventListener('touchstart', e => {
            _is = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            _lt = setTimeout(() => {
                openCtx(char.avatar, e.touches[0].clientX, e.touches[0].clientY);
                _is = null;
            }, 500);
        }, { passive: true });

        $item[0].addEventListener('touchmove', () => clearTimeout(_lt), { passive: true });

        $item[0].addEventListener('touchend', e => {
            clearTimeout(_lt);
            if (!_is) return;
            const t = e.changedTouches[0];
            if (isTap(_is.x, _is.y, t.clientX, t.clientY)) { e.preventDefault(); selectChar(idx); }
            _is = null;
        }, { passive: false });

        $item.on('click', () => { if (!('ontouchstart' in window)) selectChar(idx); });
        $item.on('contextmenu', e => { e.preventDefault(); openCtx(char.avatar, e.clientX, e.clientY); });

        $grid.append($item);
    });

    // 콘텐츠 높이가 바뀌었으므로 위치 재계산 (버튼 바로 위에 딥 붙게)
    requestAnimationFrame(() => repositionPicker());
}

// ── 폴더 매니저 ────────────────────────────────────────────────────────────────
function renderFolderManager() {
    const $list = $('#cpp-folder-list').empty();
    const d = getData();

    if (!d.folders.length) { $list.append('<div class="cpp-no-folder">폴더 없음</div>'); return; }

    d.folders.forEach(f => {
        const safeN = $('<div>').text(f.name).html();
        const $row = $(`
            <div class="cpp-folder-row">
                <span class="cpp-folder-name">${safeN}</span>
                <div class="cpp-folder-btns">
                    <button class="cpp-f-btn" data-id="${f.id}" data-action="rename" title="이름 변경">✏️</button>
                    <button class="cpp-f-btn" data-id="${f.id}" data-action="delete" title="삭제">🗑️</button>
                </div>
            </div>`);

        $row.find('[data-action="rename"]').on('click', () => {
            const n = prompt('새 폴더 이름:', f.name);
            if (n?.trim()) { renameFolder(f.id, n.trim()); renderFolderManager(); renderTabs(); }
        });
        $row.find('[data-action="delete"]').on('click', () => {
            if (confirm(`"${f.name}" 폴더를 삭제하시겠습니까?`)) {
                deleteFolder(f.id); renderFolderManager(); renderTabs(); renderGrid();
            }
        });
        $list.append($row);
    });
}

// ── 컨텍스트 메뉴 ──────────────────────────────────────────────────────────────
function openCtx(avatar, cx, cy) {
    _ctxTarget = avatar;
    const d = getData();
    const fav = isFav(avatar);
    const folder = charFolder(avatar);

    $('#cpp-ctx-fav').text(fav ? '⭐ 즐겨찾기 해제' : '☆ 즐겨찾기 추가');

    const $fl = $('#cpp-ctx-folders').empty();
    if (!d.folders.length) {
        $fl.append('<div class="cpp-ctx-nofolder">폴더 없음</div>');
    } else {
        d.folders.forEach(f => {
            const isCur = folder?.id === f.id;
            const $fi = $(`<div class="cpp-ctx-fi${isCur ? ' cpp-ctx-fi-on' : ''}">${isCur ? '✓ ' : ''}${$('<div>').text(f.name).html()}</div>`);
            $fi.on('click', () => {
                removeFromAllFolders(avatar);
                if (!isCur) addToFolder(f.id, avatar);
                closeCtx(); renderGrid(); renderTabs();
            });
            $fl.append($fi);
        });
    }

    if (folder) $('#cpp-ctx-unfolder').text(`📁 "${folder.name}"에서 제거`).show();
    else $('#cpp-ctx-unfolder').hide();

    const $ctx = $('#cpp-ctx').removeClass('cpp-hidden');
    const w = $ctx[0].offsetWidth || 165;
    const h = $ctx[0].offsetHeight || 160;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = cx + 6, top = cy + 6;
    if (left + w > vw - 8) left = cx - w - 6;
    if (top + h > vh - 8) top = cy - h - 6;
    $ctx.css({ left: Math.max(8, left) + 'px', top: Math.max(8, top) + 'px' });
}

function closeCtx() {
    $('#cpp-ctx').addClass('cpp-hidden');
    _ctxTarget = null;
}

// ── 열 수 버튼 상태 ────────────────────────────────────────────────────────────
function updateColBtns() {
    const cols = getData().cols;
    $('.cpp-col-btn').each(function() {
        $(this).toggleClass('cpp-col-on', parseInt($(this).data('cols')) === cols);
    });
}

// ── 피커 위치 계산 (실제 렌더링 높이 기반) ────────────────────────────────────
function calcPickerPos(pickerH, pickerW) {
    const btn = document.getElementById('cpp-avatar-btn');
    const vw = window.innerWidth, vh = window.innerHeight;
    const W = pickerW || 280;
    const H = pickerH || 280;

    if (!btn) {
        return { top: Math.max(8, vh - H - 80) + 'px', left: '8px', bottom: 'auto', right: 'auto' };
    }

    const r = btn.getBoundingClientRect();

    // 위에 충분한 공간이 있으면 위쪽, 없으면 아래쪽
    let top;
    if (r.top - H - 8 >= 8) {
        top = r.top - H - 8;          // 버튼 바로 위
    } else if (vh - r.bottom - 8 >= H) {
        top = r.bottom + 8;            // 버튼 바로 아래
    } else {
        top = Math.max(8, r.top - H - 8); // 최대한 위로
    }

    let left = r.left;
    if (left + W > vw - 8) left = vw - W - 8;
    left = Math.max(8, left);

    return { top: top + 'px', left: left + 'px', bottom: 'auto', right: 'auto' };
}

// ── 피커 열릴 때 실제 높이 측정 후 위치 결정 ──────────────────────────────────
function repositionPicker() {
    const $p = $('#cpp-picker');
    if ($p.hasClass('cpp-hidden')) return;
    const h = $p[0].offsetHeight;
    const w = $p[0].offsetWidth;
    $p.css(calcPickerPos(h, w));
}

function togglePicker() {
    const $p = $('#cpp-picker');
    if ($p.hasClass('cpp-hidden')) {
        const d = getData();
        renderTabs(); renderGrid(); updateColBtns();
        $('#cpp-sort').val(d.sort);
        $('#cpp-opacity').val(d.bgOpacity);
        $('#cpp-opacity-val').text(Math.round(d.bgOpacity * 100) + '%');
        applyOpacity(d.bgOpacity);

        // 실제 높이 측정을 위해 화면 밖에서 먼저 렌더링
        $p.css({ display: 'block', visibility: 'hidden', top: '-9999px', left: '-9999px', bottom: 'auto', right: 'auto' });
        const h = $p[0].offsetHeight;
        const w = $p[0].offsetWidth;

        // 버튼 바로 위/아래에 위치 설정 후 표시
        $p.css({ ...calcPickerPos(h, w), visibility: 'visible' });
        $p.removeClass('cpp-hidden').addClass('cpp-visible');
    } else {
        closePicker();
    }
}

function closePicker() {
    _query = '';
    $('#cpp-search').val('');
    $('#cpp-search-clear').addClass('cpp-hidden');
    $('#cpp-picker').removeClass('cpp-visible').addClass('cpp-hidden').css('display', '');
    closeCtx();
}

// ── 캐릭터 선택 ────────────────────────────────────────────────────────────────
async function selectChar(idx) {
    const ctx = getCtx();
    if (!ctx.characters?.[idx]) return;
    closePicker();
    try { await ctx.selectCharacterById(idx); setTimeout(updateAvatar, 400); }
    catch(e) { console.error('[CHAR-POP-PRO] 전환 실패:', e); }
}

// ── 버튼 아바타 업데이트 ───────────────────────────────────────────────────────
function updateAvatar() {
    const ctx = getCtx();
    const char = ctx.characters?.[ctx.characterId];
    const $img = $('#cpp-avatar-img');
    if (!$img.length) return;
    if (char) {
        $img.attr({ src: getAvatarUrl(char), alt: char.name });
        $('#cpp-avatar-btn').attr('title', char.name + ' (전환)');
    } else {
        $img.attr({ src: 'img/ai4.png', alt: '캐릭터' });
        $('#cpp-avatar-btn').attr('title', '캐릭터 전환');
    }
}

function registerEvents() {
    const { eventSource, event_types } = getCtx();
    if (!eventSource || !event_types) return;
    eventSource.on(event_types.CHAT_CHANGED, updateAvatar);
    eventSource.on(event_types.CHARACTER_SELECTED, updateAvatar);
}

// ── Init ───────────────────────────────────────────────────────────────────────
jQuery(async () => {
    migrateStorage(); // localStorage에 구 데이터 있으면 ST 서버로 이전

    const { eventSource, event_types } = getCtx();
    if (eventSource && event_types) {
        eventSource.on(event_types.APP_READY, () => { createUI(); registerEvents(); });
    } else {
        createUI();
    }
    console.log('[CHAR-POP-PRO] loaded ✓');
});
