// dashboard.js
// NOTE: auth.js (and the Firebase SDK it loads from gstatic.com) is loaded
// lazily via dynamic import() everywhere below, never as a static top-level
// `import ... from './auth.js'`. A static import is all-or-nothing: if the
// device is offline and that network fetch fails, the ENTIRE module fails to
// load and NONE of the code in this file runs — no rendering, no buttons,
// nothing. Loading it lazily means the dashboard always works from local
// data first, and cloud features simply sit out (and quietly retry) when
// there's no connection.

// Optimizes an uploaded image down to ~targetKB (default 30KB) by progressively
// lowering JPEG quality, then shrinking dimensions if that alone isn't enough.
async function compressImage(base64Str, targetKB = 30) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const targetBytes = targetKB * 1024;
            const MAX_WIDTH = 800;
            let width = img.width;
            let height = img.height;
            if (width > MAX_WIDTH) {
                height = Math.round((MAX_WIDTH / width) * height);
                width = MAX_WIDTH;
            }

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            const render = (w, h) => {
                canvas.width = w;
                canvas.height = h;
                ctx.clearRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);
            };
            const estimateBytes = (dataUrl) => Math.round(dataUrl.length * 0.75);

            render(width, height);
            let quality = 0.6;
            let result = canvas.toDataURL('image/jpeg', quality);

            while (estimateBytes(result) > targetBytes && quality > 0.1) {
                quality -= 0.1;
                result = canvas.toDataURL('image/jpeg', quality);
            }

            let safety = 0;
            while (estimateBytes(result) > targetBytes && width > 100 && safety < 10) {
                width = Math.round(width * 0.85);
                height = Math.round(height * 0.85);
                render(width, height);
                quality = 0.6;
                result = canvas.toDataURL('image/jpeg', quality);
                while (estimateBytes(result) > targetBytes && quality > 0.1) {
                    quality -= 0.1;
                    result = canvas.toDataURL('image/jpeg', quality);
                }
                safety++;
            }

            resolve(result);
        };
        img.onerror = () => resolve(base64Str);
        img.src = base64Str;
    });
}
// --- 1. CONSTANTS ---
const PROJECTS_KEY = 'allTrackerProjects';
const GLOBAL_SETTINGS_KEY = 'dashboardGlobalSettings';
const DELETE_PASSWORD_KEY = 'dashboardDeletePassword';

// --- 2. CLOUD SYNC HELPER ---
async function triggerCloudSync() {
    const username = localStorage.getItem('paytrackUsername');
    if (!username) return; 
    try {
        const auth = await import('./auth.js');
        await auth.syncDataToCloud();
        auth.syncLocalCardsToCloud();
        console.log("Dashboard: Auto-sync triggered");
    } catch (e) {
        console.log("Sync skipped (offline or error)");
        scheduleBackgroundSync();
    }
}

// Registers a Background Sync request so the browser retries the sync on
// our behalf the instant connectivity returns — even if this tab is in the
// background or the user has moved to another app — instead of relying
// solely on this page happening to still be open and its 'online' listener
// firing. Best-effort: not every browser supports Background Sync (notably
// iOS Safari/WebViews), so this silently does nothing there, and the
// existing 'online' listener below remains the primary sync path.
function scheduleBackgroundSync() {
    if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return;
    navigator.serviceWorker.ready
        .then((reg) => reg.sync.register('paytrack-sync'))
        .catch(() => {}); // unsupported or registration failed — no-op
}

// When the service worker's Background Sync fires (see sw.js), it messages
// every open PayTrack tab so it can flush any changes made while offline
// using the data and Firebase SDK already available here on the page.
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'PAYTRACK_FLUSH_SYNC') {
            triggerCloudSync();
        }
    });
}

// Wraps a promise so a slow/offline cloud sync can never block navigation
// forever — after `ms`, we give up waiting and let the caller proceed
// (the change is still saved locally and will retry sync on next load).
function withTimeout(promise, ms = 4000) {
    return Promise.race([
        Promise.resolve(promise),
        new Promise(resolve => setTimeout(resolve, ms))
    ]);
}

document.addEventListener('DOMContentLoaded', () => {
    const username = localStorage.getItem('paytrackUsername');

    // --- 1. DOM ELEMENTS ---
    const newProjectForm = document.getElementById('newProjectForm');
    const newProjectNameInput = document.getElementById('newProjectName');
    newProjectNameInput?.addEventListener('input', () => {
        document.getElementById('newProjectNameError')?.classList.add('hidden');
        newProjectNameInput.classList.remove('border-red-500', 'ring-2', 'ring-red-500');
    });
    const newProjectType = document.getElementById('newProjectType');
    const projectListContainer = document.getElementById('projectList');
    const noProjectsMessage = document.getElementById('noProjects');
    const notificationElement = document.getElementById('notification');
    const settingsBtn = document.getElementById('dashboardSettingsBtn');
    const projectSearchInput = document.getElementById('projectSearchInput');
    const dashboardLogoWrapper = document.getElementById('dashboardLogoWrapper');
    
    // Tabs & Forms
    const tabCreate = document.getElementById('tabCreate');
    const tabImport = document.getElementById('tabImport');
    const importCardForm = document.getElementById('importCardForm');
    const importCardNumber = document.getElementById('importCardNumber');
    const importCardName = document.getElementById('importCardName');
    const importBtn = document.getElementById('importBtn');

    // Filters & Modals
    const filterButtons = document.querySelectorAll('.filter-btn');
    const passwordModal = document.getElementById('passwordModal');
    const deletePasswordInput = document.getElementById('deletePasswordInput');
    const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
    const confirmDeleteBtn = document.getElementById('confirmDeleteAllBtn'); // Fixed ID based on your HTML
    const passwordError = document.getElementById('passwordError');
    
    let projectToDeleteId = null;
    let currentFilter = 'all'; 
    let editTempImages = [];
    let logoEnlargeTimeout = null;
    
    // --- 2. SECURITY CHECK ---
    // If user isn't logged in, send them to the lock/login screen immediately
    if (sessionStorage.getItem('paytrackUserSession') !== 'true') {
        window.location.replace('lock.html');
        return;
    }
    
    // --- LOGO INTERACTION FEATURE ---
    // Toggle logo size on click with auto-shrink after 5 seconds
    if (dashboardLogoWrapper) {
        dashboardLogoWrapper.addEventListener('click', () => {
            const isEnlarged = dashboardLogoWrapper.classList.contains('enlarged');
            
            // Clear existing timeout
            if (logoEnlargeTimeout) {
                clearTimeout(logoEnlargeTimeout);
            }
            
            if (isEnlarged) {
                // If already enlarged, shrink immediately on click
                dashboardLogoWrapper.classList.remove('enlarged');
            } else {
                // If not enlarged, enlarge it
                dashboardLogoWrapper.classList.add('enlarged');
                
                // Auto-shrink after 5 seconds
                logoEnlargeTimeout = setTimeout(() => {
                    dashboardLogoWrapper.classList.remove('enlarged');
                }, 5000);
            }
        });
    }
     
    // --- BOTTOM NAVIGATION & SORT LOGIC ---
const nSearch = document.getElementById('navSearch');
const nSort = document.getElementById('navSort');
const nAdd = document.getElementById('navAdd');
const nSync = document.getElementById('navSync');
const nSettings = document.getElementById('navSettings');

// Helper to highlight the active nav button
function updateNavActive(activeBtn) {
    [nSearch, nAdd].forEach(btn => {
        if (!btn) return;
        btn.classList.toggle('text-blue-500', btn === activeBtn);
        btn.classList.toggle('text-gray-400', btn !== activeBtn);
    });
}

const sortSheet = document.getElementById('sortActionSheet');
const closeSheet = document.getElementById('closeSortSheet');
const navFilterButtons = document.querySelectorAll('.nav-filter-btn');

// 1. Search Logic — toggle find panel
nSearch?.addEventListener('click', () => {
    const findPanel = document.getElementById('findProjectPanel');
    const addPanel = document.getElementById('addProjectPanel');
    const isHidden = findPanel.classList.contains('hidden');

    // Close add panel if open
    addPanel.classList.add('hidden');
    addPanel.classList.remove('flex');
    updateNavActive(isHidden ? nSearch : null);

    if (isHidden) {
        findPanel.classList.remove('hidden');
        findPanel.classList.add('flex');
        document.body.style.overflow = 'hidden'; // Lock background scrolling behind the modal
        renderSearchResults(); // Show results (or all projects) as soon as it opens
        setTimeout(() => document.getElementById('projectSearchInput').focus(), 300);
    } else {
        findPanel.classList.add('hidden');
        findPanel.classList.remove('flex');
        document.body.style.overflow = 'auto';
    }
});

// Close find panel via X button
document.getElementById('closeFindPanel')?.addEventListener('click', () => {
    document.getElementById('findProjectPanel').classList.add('hidden');
    document.getElementById('findProjectPanel').classList.remove('flex');
    document.body.style.overflow = 'auto';
    updateNavActive(null);
});

// Close find panel by clicking the blurred backdrop
document.getElementById('findProjectPanel')?.addEventListener('click', (e) => {
    if (e.target.id === 'findProjectPanel') {
        e.target.classList.add('hidden');
        e.target.classList.remove('flex');
        document.body.style.overflow = 'auto';
        updateNavActive(null);
    }
});

// 2. Sort Logic (Action Sheet)
nSort?.addEventListener('click', () => {
    sortSheet.classList.remove('hidden');
    document.body.style.overflow = 'hidden'; // Lock scrolling
});

closeSheet?.addEventListener('click', () => {
    sortSheet.classList.add('hidden');
    document.body.style.overflow = 'auto';
});

// Link Bottom Nav Filters to Existing Dashboard Logic
navFilterButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        const filterValue = e.currentTarget.dataset.filter;
        
        // 1. Find the hidden top filter button and click it
        const originalFilterBtn = document.querySelector(`.filter-btn[data-filter="${filterValue}"]`);
        
        if (originalFilterBtn) {
            originalFilterBtn.click(); // This triggers the actual sorting logic
        } else {
            console.error("Filter mismatch: Could not find button for", filterValue);
        }

        // 2. Update the visual "Active" state for Bottom Nav buttons
        navFilterButtons.forEach(b => {
            b.classList.remove('bg-blue-600', 'text-white');
            b.classList.add('bg-gray-50', 'dark:bg-gray-800', 'text-gray-600', 'dark:text-gray-300');
        });
        
        e.currentTarget.classList.remove('bg-gray-50', 'dark:bg-gray-800', 'text-gray-600', 'dark:text-gray-300');
        e.currentTarget.classList.add('bg-blue-600', 'text-white');

        // 3. Close sheet with a slight delay for better UX
        setTimeout(() => {
            sortSheet.classList.add('hidden');
            document.body.style.overflow = 'auto';
        }, 200);
    });
});

// 3. Add Logic — toggle add panel
nAdd?.addEventListener('click', () => {
    const addPanel = document.getElementById('addProjectPanel');
    const findPanel = document.getElementById('findProjectPanel');
    const isHidden = addPanel.classList.contains('hidden');

    // Close find panel if open
    findPanel.classList.add('hidden');
    findPanel.classList.remove('flex');
    updateNavActive(isHidden ? nAdd : null);

    if (isHidden) {
        addPanel.classList.remove('hidden');
        addPanel.classList.add('flex');
        document.body.style.overflow = 'hidden'; // Lock background scrolling behind the modal
        document.getElementById('tabCreate').click();
        setTimeout(() => document.getElementById('newProjectName').focus(), 300);
    } else {
        addPanel.classList.add('hidden');
        addPanel.classList.remove('flex');
        document.body.style.overflow = 'auto';
    }
});

// Close add panel via X button
document.getElementById('closeAddPanel')?.addEventListener('click', () => {
    document.getElementById('addProjectPanel').classList.add('hidden');
    document.getElementById('addProjectPanel').classList.remove('flex');
    document.body.style.overflow = 'auto';
    updateNavActive(null);
});

// Close add panel by clicking the blurred backdrop
document.getElementById('addProjectPanel')?.addEventListener('click', (e) => {
    if (e.target.id === 'addProjectPanel') {
        e.target.classList.add('hidden');
        e.target.classList.remove('flex');
        document.body.style.overflow = 'auto';
        updateNavActive(null);
    }
});

// (updateNavActive defined after nav elements are declared)

// 4. Sync Logic
nSync?.addEventListener('click', async () => {
    if (!navigator.onLine) {
        showNotification("You're offline — changes are saved locally and will sync automatically once you're back online", "error");
        return;
    }
    const icon = nSync.querySelector('i');
    icon.classList.add('fa-spin');
    try {
        await triggerCloudSync();   // push local changes up
        await pullDashboardData(true); // pull latest project list back down (throws on failure so we can report it honestly)
        showNotification("Sync Successful", "success");
    } catch (e) {
        showNotification("Sync Failed", "error");
    } finally {
        setTimeout(() => icon.classList.remove('fa-spin'), 1000);
    }
});

// 5. Settings Logic
nSettings?.addEventListener('click', () => {
    if (window.showLoading) window.showLoading('Opening settings...');
    window.location.href = 'settings.html';
});
    // --- 3. INITIALIZATION & CLOUD SYNC ---
    // Rule 1: Apply theme and show local projects INSTANTLY
    applyTheme();
    renderProjects();

    // Rule 2: If logged in, subscribe to user profile AND all project cards
    if (username) {
    import('./auth.js').then(async (auth) => {

        // Listener 1: User profile - keeps the project LIST and settings in sync
        auth.subscribeToUserData(username, (newData) => {
            console.log("☁️ Dashboard User Profile Update Detected");

            if (newData.projects) {
                localStorage.setItem('allTrackerProjects', JSON.stringify(newData.projects));
            }

            renderProjects();
            applyTheme();
            if(typeof translatePage === 'function') translatePage();

            // Re-subscribe to cards whenever the project list changes
            subscribeToAllProjectCards(auth);
        });

        // Listener 2: Subscribe to every project card immediately on load so that
        // edits made on another device (totalCost, metadata, receipts) are written
        // into localStorage here in real time - without needing a page refresh.
        subscribeToAllProjectCards(auth);
    }).catch(e => console.log('Dashboard cloud listeners unavailable (offline?):', e));

    // Belt-and-braces: periodically pull the project list directly, in case
    // the real-time listener above ever misses an update (dropped
    // connection, etc.). This is what makes a project created on another
    // device show up here automatically, without reloading this page.
    setInterval(() => {
        if (document.visibilityState === 'visible' && navigator.onLine) {
            pullDashboardData(true);
        }
    }, 60 * 1000); // every 60 seconds

    // Also refresh immediately whenever the user comes back to this tab/app.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && navigator.onLine) {
            pullDashboardData(true);
        }
    });
}

// Reconnect handling: the instant the browser regains connectivity, push
// anything changed while offline and pull the latest project list back
// down, then reflect it in the shared status pill.
window.addEventListener('online', async () => {
    if (window.PayTrackNet) window.PayTrackNet.setStatus('syncing', 'Syncing…');
    try {
        await triggerCloudSync();
        await pullDashboardData(true);
        if (window.PayTrackNet) window.PayTrackNet.setStatus('online', 'Synced');
    } catch (e) {
        console.log('Reconnect sync failed:', e);
        if (window.PayTrackNet) window.PayTrackNet.setStatus('error', 'Sync failed');
    }
});

// Fetches the latest project list straight from the user's cloud profile
// and merges it in. Used both by the periodic background timer and by the
// manual "Sync Now" button.
async function pullDashboardData(showErrors = false) {
    if (!username) return;
    try {
        const auth = await import('./auth.js');
        const newData = await auth.downloadUserData(username);
        if (newData && newData.projects) {
            localStorage.setItem('allTrackerProjects', JSON.stringify(newData.projects));
            renderProjects();
            applyTheme();
            if (typeof translatePage === 'function') translatePage();
            subscribeToAllProjectCards(auth);
        }
    } catch (e) {
        console.log("Dashboard pull skipped (offline or error)", e);
        if (showErrors) throw e;
    }
}

// Tracks active card listeners so we never create duplicates
const _cardListeners = {};

function subscribeToAllProjectCards(auth) {
    const projects = getProjects();
    projects.forEach(project => {
        if (!project.cardNumber) return;
        const cleanCard = project.cardNumber.replace(/\s+/g, '');
        if (_cardListeners[cleanCard]) return; // already listening

        _cardListeners[cleanCard] = auth.subscribeToProjectCard(cleanCard, (fullData) => {
            console.log('☁️ Card update for project', project.id);
            const id = project.id;

            // Push the updated data into localStorage so this device reflects
            // whatever the editing device just saved
            if (fullData.installment) {
                localStorage.setItem('project_' + id + '_installment', JSON.stringify(fullData.installment));
            }
            if (fullData.expense) {
                localStorage.setItem('project_' + id + '_expense', JSON.stringify(fullData.expense));
            }
            if (fullData.settings) {
                localStorage.setItem('project_' + id + '_settings', JSON.stringify(fullData.settings));
            }

            renderProjects();
        });
    });
}

    // --- 4. INTERNAL FUNCTIONS (Keep these as they are) ---

    // Helper to convert images to strings for localStorage
const readFileAsDataURL = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
    });
};
async function openEditProjectModal(projectId) {
    const projects = JSON.parse(localStorage.getItem('allTrackerProjects')) || [];
    const project = projects.find(p => p.id == projectId);
    if (!project) return;

    // 1. Set the basic ID and Name (shared by both types)
    document.getElementById('editProjectId').value = projectId;
    document.getElementById('editProjectNameInput').value = project.name;

    const installmentFields = document.getElementById('installmentEditFields');
    const previewContainer = document.getElementById('editImagePreviewContainer');
    
    previewContainer.innerHTML = ''; // Clear previous previews
    editTempImages = []; // Clear image array

    // 2. Logic for Installment Tracker
    if (project.type === 'installment') {
        installmentFields.classList.remove('hidden'); // Show Cost/Date/Images
        
        // Fetch existing deep data from project specific storage
        const projectData = JSON.parse(localStorage.getItem(`project_${projectId}_installment`)) || {};
        const meta = projectData.projectMetaData || {};

        document.getElementById('editProjectTotalCost').value = meta.totalCost || projectData.totalAmount || 0;
        document.getElementById('editProjectDate').value = meta.agreementDate || "";
        document.getElementById('editProjectDesc').value = meta.description || "";
        
        // Load existing images
        editTempImages = meta.receipts || (meta.receipt ? [meta.receipt] : []);
        renderEditImagePreviews();
    } 
    // 3. Logic for Finance Tracker (Hide specialized fields)
    else {
        installmentFields.classList.add('hidden');
    }

    document.getElementById('editProjectModal').classList.remove('hidden');
}
// dashboard.js - Update the Edit Form Submit Listener
// dashboard.js - Updated Edit Project Listener with Loader and Fixes
document.getElementById('editProjectForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById('saveEditBtn');
    const spinner = document.getElementById('saveEditSpinner');
    const now = Date.now(); // The unique key for this sync

    submitBtn.disabled = true;
    if(spinner) spinner.classList.remove('hidden');

    try {
        const id = document.getElementById('editProjectId').value;
        const newName = document.getElementById('editProjectNameInput').value.trim();

        // 1. Update the Main Project List (For Name/ID)
        let projects = JSON.parse(localStorage.getItem('allTrackerProjects')) || [];
        const pIndex = projects.findIndex(p => p.id == id);
        if (pIndex === -1) return;
        const projectType = projects[pIndex].type;
        projects[pIndex].name = newName;

        // 2. LOAD & UPDATE THE DEEP DATA (For Cost/Receipts/Date)
        // We MUST fetch the actual data object from LocalStorage first
        const dataKey = `project_${id}_${projectType}`;
        let projectData = JSON.parse(localStorage.getItem(dataKey)) || { payments: [] };

        // Update the internal state
        projectData.projectName = newName;
        projectData.lastUpdated = now; // CRITICAL

        if (projectType === 'installment') {
            const newTotal = parseFloat(document.getElementById('editProjectTotalCost').value) || 0;
            
            // This is what the "Agreement Modal" reads
            projectData.projectMetaData = {
                name: newName,
                totalCost: newTotal,
                agreementDate: document.getElementById('editProjectDate').value,
                description: document.getElementById('editProjectDesc').value,
                receipts: [...editTempImages] // The compressed images
            };
            
            projectData.totalAmount = newTotal;
            // Recalculate balance logic
            const paid = (projectData.payments || []).reduce((sum, p) => sum + p.paymentAmount, 0);
            projectData.paidAmount = paid;
            projectData.pendingAmount = newTotal - paid;
        }

        // 3. SAVE LOCALLY
        localStorage.setItem('allTrackerProjects', JSON.stringify(projects));
        localStorage.setItem(dataKey, JSON.stringify(projectData));

        // 4. SYNC BOTH PLACES TO CLOUD
        const auth = await import('./auth.js');
        
        // Sync the name change to the user profile
        await auth.syncDataToCloud(); 

        // Sync EVERYTHING (metadata, images, costs) to the project card
        const fullPackage = {
            installment: projectType === 'installment' ? projectData : JSON.parse(localStorage.getItem(`project_${id}_installment`)),
            expense: projectType === 'finance' ? projectData : JSON.parse(localStorage.getItem(`project_${id}_expense`)),
            settings: JSON.parse(localStorage.getItem(`project_${id}_settings`)),
            lastUpdated: now 
        };

        await auth.updateGlobalCard(projects[pIndex], fullPackage);

        document.getElementById('editProjectModal').classList.add('hidden');
        renderProjects();
        alert("Update Successful: Synced to all devices.");

    } catch (err) {
        console.error("Sync Error:", err);
        // The edit was already saved to localStorage above (step 3) before
        // any network call was attempted, so the user's change is NOT lost —
        // only the cloud push failed (most likely because they're offline).
        // A blocking alert() here would misleadingly suggest the edit itself
        // failed. Show a normal toast instead, and queue a background sync
        // so it retries automatically once connectivity returns.
        scheduleBackgroundSync();
        document.getElementById('editProjectModal').classList.add('hidden');
        renderProjects();
        showNotification("Saved locally — will sync when you're back online", "error");
    } finally {
        submitBtn.disabled = false;
        if(spinner) spinner.classList.add('hidden');
        if (window.hideLoading) window.hideLoading(); // guarantee the global loader always closes
    }
});
// A. Wire up the Dashboard "Edit" button
projectListContainer.addEventListener('click', (e) => {
    const target = e.target.closest('button');
    if (!target) return;
    const projectId = target.dataset.projectId;

    if (target.classList.contains('edit-project-btn')) {
        openEditProjectModal(projectId); // Open our new modal
    }
});

// B. Wire up the Image Upload button inside the Edit Modal
document.getElementById('editProjectImages').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    // Show a small loader or change button text so user knows it's working
    const btn = e.target.nextElementSibling;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';

    for (const file of files) {
        const reader = new FileReader();
        const rawBase64 = await new Promise(resolve => {
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(file);
        });
        
        // COMPRESS BEFORE PUSHING TO ARRAY
        const compressed = await compressImage(rawBase64);
        editTempImages.push(compressed);
    }
    
    renderEditImagePreviews();
    btn.innerHTML = originalText;
});
// C. Wire up the Cancel button
document.getElementById('closeEditModal').onclick = () => {
    document.getElementById('editProjectModal').classList.add('hidden');
};
function renderEditImagePreviews() {
    const container = document.getElementById('editImagePreviewContainer');
    container.innerHTML = '';
    editTempImages.forEach((src, index) => {
        const div = document.createElement('div');
        div.className = 'relative aspect-square';
        div.innerHTML = `
            <img src="${src}" class="w-full h-full object-cover rounded-lg border dark:border-gray-600">
            <button type="button" onclick="removeEditImage(${index})" class="absolute -top-2 -right-2 bg-red-500 text-white w-5 h-5 rounded-full text-xs flex items-center justify-center shadow-md">×</button>
        `;
        container.appendChild(div);
    });
}

// Make globally accessible for the "x" button click
window.removeEditImage = (index) => {
    editTempImages.splice(index, 1);
    renderEditImagePreviews();
};
    function applyTheme() {
        const settings = JSON.parse(localStorage.getItem(GLOBAL_SETTINGS_KEY)) || {};
        const themeName = settings.theme || 'default';
        document.body.className = document.body.className.replace(/theme-\w+/g, '').trim();
        // Clear any leftover inline custom-theme vars from a previous custom theme
        if (document.body.style.removeProperty) {
            ['--custom-color-start','--custom-color-end','--custom-background','--custom-header-text','--custom-header-subtext','--custom-button-bg','--custom-button-hover-bg','--custom-icon-filter'].forEach(v => document.body.style.removeProperty(v));
        }
        if (themeName === 'custom' && window.ThemeUtils) {
            window.ThemeUtils.applyActiveCustomTheme(settings.activeCustomThemeId);
        } else if (themeName !== 'default') {
            document.body.classList.add(`theme-${themeName}`);
        }
    }

    function showNotification(message, type = 'success') {
        if (window.hideLoading) window.hideLoading(); // action finished, dismiss the loader
        if(!notificationElement) return;
        notificationElement.textContent = message;
        notificationElement.className = `notification ${type} show`;
        setTimeout(() => notificationElement.classList.remove('show'), 3000);
    }

    function getProjects() {
        return JSON.parse(localStorage.getItem(PROJECTS_KEY)) || [];
    }

    function saveProjects(projects) {
        localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
        // Return the promise so callers that are about to navigate away can
        // await it — otherwise the browser can cancel the in-flight cloud
        // write and other devices never see the change.
        return triggerCloudSync();
    }

    function generateNextDisplayId(projects) {
        if (projects.length === 0) return 'P1';
        const ids = projects.map(p => parseInt(p.displayId?.replace('P', '') || 0, 10));
        return `P${Math.max(...ids) + 1}`;
    }

    function renderProjects() {
        const projects = getProjects();
        if(!projectListContainer) return;
        projectListContainer.innerHTML = '';
        
        const searchTerm = (projectSearchInput.value || '').toLowerCase().trim();

        const filteredProjects = projects.filter(p => {
    // This currentFilter comes from the data-filter attribute we just fixed
    const matchesType = currentFilter === 'all' || p.type === currentFilter; 
    const matchesSearch = p.name.toLowerCase().includes(searchTerm) || 
                          (p.displayId && p.displayId.toLowerCase().includes(searchTerm));
    return matchesType && matchesSearch;
});

        if (filteredProjects.length === 0) {
            noProjectsMessage.classList.remove('hidden');
            projectListContainer.classList.add('hidden');
        } else {
            noProjectsMessage.classList.add('hidden');
            projectListContainer.classList.remove('hidden');
            
            filteredProjects.forEach((project, index) => {
                const projectCard = document.createElement('div');
                const isLast = index === filteredProjects.length - 1;
                const borderClass = index === filteredProjects.length - 1 ? '' : 'border-b border-gray-300/50 dark:border-gray-600/50 mb-4 pb-4';
    
    projectCard.className = `project-card-container ${borderClass}`;
    projectCard.innerHTML = `
        <div class="project-card bg-white glass-effect p-4 rounded-2xl shadow-sm transition-all">
            <div class="flex flex-col sm:flex-row items-center justify-between w-full gap-4">
                
                <!-- Left Section: ID and Info -->
                <div class="flex items-center gap-4 w-full sm:w-auto">
                    <!-- FIXED: Removed 'hidden' so ID shows on mobile -->
                    <div class="flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-xl p-2 min-w-[3rem] h-12">
                        <span class="text-[9px] font-bold text-gray-400 uppercase leading-none">ID</span>
                        <span class="text-md font-black text-gray-700 dark:text-gray-200">${project.displayId || 'P'}</span>
                    </div>
                    
                    <div class="text-left">
                        <h3 class="font-bold text-lg text-gray-800 dark:text-white leading-tight">${project.name}</h3>
                        <div class="flex items-center gap-2 mt-1 flex-wrap">
                            <span class="text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${project.type === 'finance' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}">
                                ${project.type}
                            </span>
                            ${project.importedFrom ? `<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 flex items-center gap-1"><i class="fas fa-cloud-download-alt text-[8px]"></i> Imported from <strong>${project.importedFrom}</strong></span>` : ''}
                        </div>
                    </div>
                </div>

                <!-- Right Section: Buttons -->
                <div class="flex items-center justify-end gap-2 w-full sm:w-auto border-t sm:border-t-0 pt-3 sm:pt-0 border-gray-100">
                    <button class="btn-primary text-white w-10 h-10 flex items-center justify-center rounded-lg open-project-btn" data-project-id="${project.id}"><i class="fas fa-folder-open"></i></button>
                    <button class="btn-secondary text-white w-10 h-10 flex items-center justify-center rounded-lg edit-project-btn" data-project-id="${project.id}"><i class="fas fa-edit"></i></button>
                    <button class="btn-danger text-white w-10 h-10 flex items-center justify-center rounded-lg delete-project-btn" data-no-loading data-project-id="${project.id}"><i class="fas fa-trash"></i></button>
                </div>

            </div>
        </div>
    `;
    projectListContainer.appendChild(projectCard);
});
        }
    }

    // Live search results inside the Find Project modal
    function renderSearchResults() {
        const resultsContainer = document.getElementById('searchResultsContainer');
        const statusEl = document.getElementById('searchResultsStatus');
        if (!resultsContainer || !statusEl) return;

        const searchTerm = (projectSearchInput.value || '').toLowerCase().trim();
        const projects = getProjects();

        const matches = projects.filter(p => {
            const matchesType = currentFilter === 'all' || p.type === currentFilter;
            const matchesSearch = !searchTerm ||
                p.name.toLowerCase().includes(searchTerm) ||
                (p.displayId && p.displayId.toLowerCase().includes(searchTerm));
            return matchesType && matchesSearch;
        });

        if (matches.length === 0) {
            statusEl.innerHTML = searchTerm
                ? `<i class="fas fa-circle-exclamation text-red-500 mr-1"></i> No project found matching "<strong>${projectSearchInput.value.trim()}</strong>"`
                : `<i class="fas fa-folder-open text-gray-400 mr-1"></i> No projects yet.`;
            statusEl.className = 'text-sm font-semibold text-red-500 mb-2';
            resultsContainer.innerHTML = '';
            return;
        }

        statusEl.innerHTML = `<i class="fas fa-circle-check text-green-500 mr-1"></i> ${matches.length} project${matches.length === 1 ? '' : 's'} found`;
        statusEl.className = 'text-sm font-semibold text-green-600 mb-2';

        resultsContainer.innerHTML = matches.map(p => `
            <button type="button" class="search-result-btn open-project-btn w-full flex items-center justify-between gap-3 px-4 py-3 bg-white/80 dark:bg-gray-700/60 border border-gray-200 dark:border-gray-600 rounded-xl hover:border-green-400 hover:bg-green-50 dark:hover:bg-gray-700 transition-all text-left" data-project-id="${p.id}">
                <div class="flex items-center gap-3 min-w-0">
                    <div class="flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-600 rounded-lg px-2 py-1 shrink-0">
                        <span class="text-[8px] font-bold text-gray-400 uppercase leading-none">ID</span>
                        <span class="text-xs font-black text-gray-700 dark:text-gray-200">${p.displayId || 'P'}</span>
                    </div>
                    <div class="min-w-0">
                        <p class="font-bold text-gray-800 dark:text-white truncate">${p.name}</p>
                        <span class="text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${p.type === 'finance' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}">${p.type}</span>
                    </div>
                </div>
                <i class="fas fa-chevron-right text-gray-400 shrink-0"></i>
            </button>
        `).join('');
    }

    // --- 5. EVENT LISTENERS ---
    projectSearchInput.addEventListener('input', () => {
        renderProjects();
        renderSearchResults();
    });

    // Clicking a live search result opens that project directly
    document.getElementById('searchResultsContainer')?.addEventListener('click', (e) => {
        const target = e.target.closest('.search-result-btn');
        if (!target) return;
        if (window.showLoading) window.showLoading('Opening project...');
        sessionStorage.setItem('currentProjectId', target.dataset.projectId);
        window.location.href = 'paytrack.html';
    });

    filterButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            filterButtons.forEach(b => { b.classList.remove('bg-blue-600', 'text-white'); b.classList.add('bg-gray-200', 'text-gray-700'); });
            e.target.classList.remove('bg-gray-200', 'text-gray-700'); e.target.classList.add('bg-blue-600', 'text-white');
            currentFilter = e.target.dataset.filter;
            renderProjects();
            renderSearchResults();
        });
    });

  newProjectForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const projectName = newProjectNameInput.value.trim();
    const selectedType = newProjectType.value;
    const nameErrorEl = document.getElementById('newProjectNameError');

    if (projectName) {
        const projects = getProjects();

        // Prevent creating a project whose name already exists (case-insensitive)
        const nameTaken = projects.some(p => p.name.trim().toLowerCase() === projectName.toLowerCase());
        if (nameTaken) {
            if (nameErrorEl) nameErrorEl.classList.remove('hidden');
            newProjectNameInput.classList.add('border-red-500', 'ring-2', 'ring-red-500');
            newProjectNameInput.focus();
            return;
        }
        if (nameErrorEl) nameErrorEl.classList.add('hidden');
        newProjectNameInput.classList.remove('border-red-500', 'ring-2', 'ring-red-500');

        const projectId = Date.now();
        
        const { generateCardNumber, updateGlobalCard } = await import('./auth.js');
        const cardNumber = generateCardNumber(projectId);

        const newProject = { 
            id: projectId, 
            displayId: generateNextDisplayId(projects), 
            name: projectName, 
            type: selectedType,
            cardNumber: cardNumber // <--- Ensure this is exactly like this
        };
        
        projects.push(newProject);

        if (window.showLoading) window.showLoading('Setting up project...');

        // This saves locally AND triggers the sync to the user's cloud
        // document. We WAIT for it (with a safety timeout) before leaving
        // this page — otherwise the browser can cancel the in-flight write
        // when we navigate to paytrack.html, and the new project silently
        // never reaches other devices until something else re-syncs it.
        const syncPromise = Promise.all([
            withTimeout(saveProjects(projects)),
            updateGlobalCard(newProject, {
                installment: { projectName: projectName, totalAmount: 0, payments: [] },
                expense: { projectName: projectName, payments: [] },
                settings: { expenseMode: (selectedType === 'finance') }
            })
        ]);
        await withTimeout(syncPromise, 5000);

        sessionStorage.setItem('currentProjectId', newProject.id);
        window.location.href = 'paytrack.html';
    }
});

    projectListContainer.addEventListener('click', (e) => {
        const target = e.target.closest('button');
        if (!target) return;
        const projectId = target.dataset.projectId;

        if (target.classList.contains('open-project-btn')) {
            if (window.showLoading) window.showLoading('Opening project...');
            sessionStorage.setItem('currentProjectId', projectId);
            window.location.href = `paytrack.html`;
        }
       
        if (target.classList.contains('delete-project-btn')) {
            projectToDeleteId = projectId;
            passwordModal.classList.remove('hidden');
            deletePasswordInput.value = '';
        }
    });

    // Delete Modal Logic
    document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
        const entered = deletePasswordInput.value;
        const correct = localStorage.getItem(DELETE_PASSWORD_KEY) || '7739';
        if (entered === correct) {
            let projects = getProjects();
            projects = projects.filter(p => p.id != projectToDeleteId);
            localStorage.removeItem(`project_${projectToDeleteId}_installment`);
            localStorage.removeItem(`project_${projectToDeleteId}_expense`);
            localStorage.removeItem(`project_${projectToDeleteId}_settings`);
            localStorage.removeItem(`project_${projectToDeleteId}_shortcuts`);
            localStorage.removeItem(`project_${projectToDeleteId}_auto`);
            localStorage.removeItem(`project_${projectToDeleteId}_visibility`);
            saveProjects(projects);
            renderProjects();
            passwordModal.classList.add('hidden');
            showNotification("Deleted", "error");
        } else {
            if (window.hideLoading) window.hideLoading();
            passwordError.classList.remove('hidden');
        }
    });

    document.getElementById('cancelDeleteBtn').addEventListener('click', () => passwordModal.classList.add('hidden'));

    // Tab Logic
    tabCreate.onclick = () => {
        newProjectForm.classList.remove('hidden'); importCardForm.classList.add('hidden');
        tabCreate.className = "text-lg font-bold text-blue-600 border-b-2 border-blue-600 px-4 py-1";
        tabImport.className = "text-lg font-bold text-gray-500 px-4 py-1";
    };
    tabImport.onclick = () => {
        importCardForm.classList.remove('hidden'); newProjectForm.classList.add('hidden');
        tabImport.className = "text-lg font-bold text-blue-600 border-b-2 border-blue-600 px-4 py-1";
        tabCreate.className = "text-lg font-bold text-gray-500 px-4 py-1";
    };

    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => { window.location.href = 'settings.html'; });
    }

    // --- IMPORT CARD LOGIC ---
importCardForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const originalBtnText = importBtn.innerHTML;
    importBtn.disabled = true;
    importBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Searching...';

    const cardNum = importCardNumber.value.replace(/\s+/g, ''); // Clean spaces
    const cardName = importCardName.value.trim(); // Trim - trailing/leading spaces would break an exact-match lookup

    try {
        const auth = await import('./auth.js').catch(() => {
            throw new Error("You're offline — connect to the internet to import a card.");
        });
        const cloudCard = await auth.fetchProjectByCard(cardNum, cardName);
        const projectId = cloudCard.projectId;
        const projectData = cloudCard.fullData;

        let localProjects = JSON.parse(localStorage.getItem(PROJECTS_KEY)) || [];
        if (localProjects.some(p => p.id == projectId)) {
            throw new Error("This project is already on your dashboard.");
        }

        // Save individual data parts — includes shortcuts, scheduled
        // auto-transactions, and the balance-visibility toggle, not just
        // installment/expense/settings, so an imported card isn't missing data
        // that only lived in those extra fields.
        if (projectData.installment) localStorage.setItem(`project_${projectId}_installment`, JSON.stringify(projectData.installment));
        if (projectData.expense) localStorage.setItem(`project_${projectId}_expense`, JSON.stringify(projectData.expense));
        if (projectData.settings) localStorage.setItem(`project_${projectId}_settings`, JSON.stringify(projectData.settings));
        if (projectData.shortcuts) localStorage.setItem(`project_${projectId}_shortcuts`, JSON.stringify(projectData.shortcuts));
        if (projectData.autoTransactions) localStorage.setItem(`project_${projectId}_auto`, JSON.stringify(projectData.autoTransactions));
        if (projectData.visibility !== undefined && projectData.visibility !== null) {
            localStorage.setItem(`project_${projectId}_visibility`, projectData.visibility);
        }

        // CRITICAL FIX: Ensure cardNumber is included here
        const newProjectEntry = {
            id: projectId,
            displayId: generateNextDisplayId(localProjects),
            name: cloudCard.originalName,
            type: projectData.settings?.expenseMode ? 'finance' : 'installment',
            cardNumber: cardNum, // <--- THIS MUST BE HERE
            importedFrom: cloudCard.ownerUsername || null
        };

        localProjects.push(newProjectEntry);
        localStorage.setItem(PROJECTS_KEY, JSON.stringify(localProjects));

        // Sync the updated list to the user's cloud profile
        await triggerCloudSync(); 

        showNotification("Project imported successfully!", "success");
        renderProjects();
        tabCreate.click();
        // Close the add panel after a successful import
        document.getElementById('addProjectPanel').classList.add('hidden');
        document.getElementById('addProjectPanel').classList.remove('flex');
        document.body.style.overflow = 'auto';
        updateNavActive(null);
    } catch (error) {
        showNotification(error.message, "error");
    } finally {
        importBtn.disabled = false;
        importBtn.innerHTML = originalBtnText;
    }
});
// Automatically add spaces while typing the card number
importCardNumber.addEventListener('input', (e) => {
    let value = e.target.value.replace(/\D/g, '');
    let formattedValue = value.match(/.{1,4}/g)?.join(' ') || '';
    e.target.value = formattedValue.substring(0, 19);
});
});