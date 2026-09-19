// theme-utils.js — Shared custom-theme engine used by dashboard.html and settings.html.
// Include this BEFORE your page's own script.
//
// Storage: localStorage['dashboardCustomThemes'] = [{ id, name, type, color1, color2,
//          direction, image, headerText, headerSubtext, buttonBg, buttonHoverBg, iconFilter }]
// The active theme selection lives in the existing 'dashboardGlobalSettings' object as
// { theme: 'custom', activeCustomThemeId: '<id>' }.

(function () {
    const CUSTOM_THEMES_KEY = 'dashboardCustomThemes';

    function getCustomThemes() {
        try {
            return JSON.parse(localStorage.getItem(CUSTOM_THEMES_KEY)) || [];
        } catch (e) {
            return [];
        }
    }

    function saveCustomThemes(themes) {
        localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(themes));
    }

    function getCustomThemeById(id) {
        return getCustomThemes().find(t => t.id === id) || null;
    }

    // Resolves ANY css color string (hex, rgb(), rgba(), or a named color like "coral")
    // into a browser-normalized "rgb(r, g, b)" / "rgba(r, g, b, a)" string, or null if invalid.
    let probeEl = null;
    function resolveColor(input) {
        if (!input || typeof input !== 'string') return null;
        const str = input.trim();
        if (!str) return null;
        if (!probeEl) {
            probeEl = document.createElement('div');
            probeEl.style.display = 'none';
            document.body.appendChild(probeEl);
        }
        // Use a sentinel so we can detect a no-op assignment (i.e. an invalid color).
        probeEl.style.color = '';
        probeEl.style.color = 'rgb(1, 2, 3)';
        const baseline = probeEl.style.color;
        probeEl.style.color = str;
        const result = probeEl.style.color;
        if (result === baseline && str.replace(/\s+/g, '').toLowerCase() !== 'rgb(1,2,3)') {
            return null; // assignment was ignored -> invalid color string
        }
        return result || null;
    }

    // Converts a resolved "rgb(r, g, b)" string to "#rrggbb" (for the native color picker).
    function rgbStringToHex(rgbStr) {
        const m = /rgba?\(([^)]+)\)/.exec(rgbStr || '');
        if (!m) return null;
        const parts = m[1].split(',').map(s => parseFloat(s));
        const [r, g, b] = parts;
        const toHex = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }

    // Picks readable header text / subtext / button colors based on a background color's luminance.
    function getContrastProfile(rgbStr) {
        const m = /rgba?\(([^)]+)\)/.exec(rgbStr || '');
        if (!m) {
            return { headerText: '#ffffff', headerSubtext: 'rgba(255,255,255,0.85)', buttonBg: 'rgba(255,255,255,0.2)', buttonHoverBg: 'rgba(255,255,255,0.3)', iconFilter: 'brightness(0) invert(1)' };
        }
        const [r, g, b] = m[1].split(',').map(s => parseFloat(s));
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        if (luminance > 150) {
            return { headerText: '#1f2937', headerSubtext: 'rgba(31,41,55,0.75)', buttonBg: 'rgba(0,0,0,0.08)', buttonHoverBg: 'rgba(0,0,0,0.15)', iconFilter: 'none' };
        }
        return { headerText: '#ffffff', headerSubtext: 'rgba(255,255,255,0.85)', buttonBg: 'rgba(255,255,255,0.2)', buttonHoverBg: 'rgba(255,255,255,0.3)', iconFilter: 'brightness(0) invert(1)' };
    }

    // Builds the CSS `background` value for a theme object.
    function getBackgroundValue(theme) {
        if (theme.type === 'image' && theme.image) {
            return `url('${theme.image}') center / cover no-repeat fixed`;
        }
        if (theme.type === 'gradient' && theme.color2) {
            return `linear-gradient(${theme.direction || 'to right'}, ${theme.color1}, ${theme.color2})`;
        }
        return theme.color1;
    }

    // Applies a custom theme's CSS variables to <body>. Does NOT touch the theme-* class;
    // callers should add/remove `theme-custom` on body themselves alongside this call.
    function applyCustomThemeVars(theme) {
        if (!theme) return;
        const body = document.body;
        body.style.setProperty('--custom-color-start', theme.color1 || '#764ba2');
        body.style.setProperty('--custom-color-end', theme.color2 || theme.color1 || '#667eea');
        body.style.setProperty('--custom-background', getBackgroundValue(theme));
        body.style.setProperty('--custom-header-text', theme.headerText || '#ffffff');
        body.style.setProperty('--custom-header-subtext', theme.headerSubtext || 'rgba(255,255,255,0.85)');
        body.style.setProperty('--custom-button-bg', theme.buttonBg || 'rgba(255,255,255,0.2)');
        body.style.setProperty('--custom-button-hover-bg', theme.buttonHoverBg || 'rgba(255,255,255,0.3)');
        body.style.setProperty('--custom-icon-filter', theme.iconFilter || 'brightness(0) invert(1)');
    }

    // Convenience: apply whichever custom theme is currently marked active in settings,
    // adding the theme-custom class. Called on every page load when settings.theme === 'custom'.
    function applyActiveCustomTheme(activeCustomThemeId) {
        const theme = getCustomThemeById(activeCustomThemeId);
        if (!theme) return false;
        document.body.classList.add('theme-custom');
        applyCustomThemeVars(theme);
        return true;
    }

    window.ThemeUtils = {
        CUSTOM_THEMES_KEY,
        getCustomThemes,
        saveCustomThemes,
        getCustomThemeById,
        resolveColor,
        rgbStringToHex,
        getContrastProfile,
        getBackgroundValue,
        applyCustomThemeVars,
        applyActiveCustomTheme
    };
})();
