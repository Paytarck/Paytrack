// dashboard.js
import { fetchProjectByCard, syncLocalCardsToCloud, subscribeToUserData, downloadUserData } from './auth.js';

async function compressImage(base64Str) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = base64Str;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 800; 
            let width = img.width;
            let height = img.height;
            if (width > MAX_WIDTH) {
                height = (MAX_WIDTH / width) * height;
                width = MAX_WIDTH;
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.6)); // 60% quality to ensure it fits 1MB
        };
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
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const username = localStorage.getItem('paytrackUsername');

    // --- 1. DOM ELEMENTS ---
    const newProjectForm = document.getElementById('newProjectForm');
    const newProjectNameInput = document.getElementById('newProjectName');
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
    updateNavActive(isHidden ? nSearch : null);

    if (isHidden) {
        findPanel.classList.remove('hidden');
        // Scroll so the panel sits below the sticky header instead of behind it
        setTimeout(() => {
            const header = document.querySelector('.header-glass');
            const headerHeight = header ? header.offsetHeight : 80;
            const panelTop = findPanel.getBoundingClientRect().top + window.scrollY;
            window.scrollTo({ top: panelTop - headerHeight - 12, behavior: 'smooth' });
            document.getElementById('projectSearchInput').focus();
        }, 50);
    } else {
        findPanel.classList.add('hidden');
    }
});

// Close find panel via X button
document.getElementById('closeFindPanel')?.addEventListener('click', () => {
    document.getElementById('findProjectPanel').classList.add('hidden');
    updateNavActive(null);
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
    updateNavActive(isHidden ? nAdd : null);

    if (isHidden) {
        addPanel.classList.remove('hidden');
        document.getElementById('tabCreate').click();
        // Scroll so the panel sits below the sticky header instead of behind it
        setTimeout(() => {
            const header = document.querySelector('.header-glass');
            const headerHeight = header ? header.offsetHeight : 80;
            const panelTop = addPanel.getBoundingClientRect().top + window.scrollY;
            window.scrollTo({ top: panelTop - headerHeight - 12, behavior: 'smooth' });
            document.getElementById('newProjectName').focus();
        }, 50);
    } else {
        addPanel.classList.add('hidden');
    }
});

// Close add panel via X button
document.getElementById('closeAddPanel')?.addEventListener('click', () => {
    document.getElementById('addProjectPanel').classList.add('hidden');
    updateNavActive(null);
});

// (updateNavActive defined after nav elements are declared)

// 4. Sync Logic
nSync?.addEventListener('click', async () => {
    const icon = nSync.querySelector('i');
    icon.classList.add('fa-spin');
    try {
        await triggerCloudSync();
        showNotification("Sync Successful", "success");
    } catch (e) {
        showNotification("Sync Failed", "error");
    } finally {
        setTimeout(() => icon.classList.remove('fa-spin'), 1000);
    }
});

// 5. Settings Logic
nSettings?.addEventListener('click', () => {
    window.location.href = 'settings.html';
});
    // --- 3. INITIALIZATION & CLOUD SYNC ---
    // Rule 1: Apply theme and show local projects INSTANTLY
    applyTheme();
    renderProjects();

    // Rule 2: If logged in, Download Cloud Data FIRST, then start listening
    if (username) {
    import('./auth.js').then(async (auth) => {
        // Start real-time listener for the user profile
        auth.subscribeToUserData(username, (newData) => {
            console.log("☁️ Dashboard Cloud Update Detected");
            
            // This ensures the local list of projects is fresh
            if (newData.projects) {
                localStorage.setItem('allTrackerProjects', JSON.stringify(newData.projects));
            }
            
            // RE-RENDER THE LIST IMMEDIATELY
            renderProjects(); 
            applyTheme();
            if(typeof translatePage === 'function') translatePage();
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
        alert("Failed to sync. Please check your internet.");
    } finally {
        submitBtn.disabled = false;
        if(spinner) spinner.classList.add('hidden');
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
        if (themeName !== 'default') document.body.classList.add(`theme-${themeName}`);
    }

    function showNotification(message, type = 'success') {
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
        // This triggers the sync safely because data is now locally present
        triggerCloudSync();
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
                    <button class="btn-danger text-white w-10 h-10 flex items-center justify-center rounded-lg delete-project-btn" data-project-id="${project.id}"><i class="fas fa-trash"></i></button>
                </div>

            </div>
        </div>
    `;
    projectListContainer.appendChild(projectCard);
});
        }
    }

    // --- 5. EVENT LISTENERS ---
    projectSearchInput.addEventListener('input', renderProjects);

    filterButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            filterButtons.forEach(b => { b.classList.remove('bg-blue-600', 'text-white'); b.classList.add('bg-gray-200', 'text-gray-700'); });
            e.target.classList.remove('bg-gray-200', 'text-gray-700'); e.target.classList.add('bg-blue-600', 'text-white');
            currentFilter = e.target.dataset.filter;
            renderProjects();
        });
    });

  newProjectForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const projectName = newProjectNameInput.value.trim();
    const selectedType = newProjectType.value;

    if (projectName) {
        const projects = getProjects();
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
        
        // This saves locally AND triggers the sync to the user's cloud document
        saveProjects(projects); 

        // Initial empty data for the card
        const initialData = { 
            installment: { projectName: projectName, totalAmount: 0, payments: [] },
            expense: { projectName: projectName, payments: [] },
            settings: { expenseMode: (selectedType === 'finance') }
        };
        await updateGlobalCard(newProject, initialData);
        
        sessionStorage.setItem('currentProjectId', newProject.id);
        window.location.href = 'paytrack.html';
    }
});

    projectListContainer.addEventListener('click', (e) => {
        const target = e.target.closest('button');
        if (!target) return;
        const projectId = target.dataset.projectId;

        if (target.classList.contains('open-project-btn')) {
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
            saveProjects(projects);
            renderProjects();
            passwordModal.classList.add('hidden');
            showNotification("Deleted", "error");
        } else {
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
    const cardName = importCardName.value;

    try {
        const cloudCard = await fetchProjectByCard(cardNum, cardName);
        const projectId = cloudCard.projectId;
        const projectData = cloudCard.fullData;

        let localProjects = JSON.parse(localStorage.getItem(PROJECTS_KEY)) || [];
        if (localProjects.some(p => p.id == projectId)) {
            throw new Error("This project is already on your dashboard.");
        }

        // Save individual data parts
        if (projectData.installment) localStorage.setItem(`project_${projectId}_installment`, JSON.stringify(projectData.installment));
        if (projectData.expense) localStorage.setItem(`project_${projectId}_expense`, JSON.stringify(projectData.expense));
        if (projectData.settings) localStorage.setItem(`project_${projectId}_settings`, JSON.stringify(projectData.settings));

        // CRITICAL FIX: Ensure cardNumber is included here
        // Determine project type from the cloud card's own type field first,
        // then fall back to the expenseMode flag in settings.
        const resolvedType = cloudCard.type || (projectData.settings?.expenseMode ? 'finance' : 'installment');

        // importedFrom must show the OWNER's username (who the card belongs to),
        // NOT the current user who is doing the importing.
        const newProjectEntry = {
            id: projectId,
            displayId: generateNextDisplayId(localProjects),
            name: cloudCard.originalName,
            type: resolvedType,
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