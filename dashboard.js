// dashboard.js
import { fetchProjectByCard, syncLocalCardsToCloud, subscribeToUserData, downloadUserData } from './auth.js';

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
    // --- 2. SECURITY CHECK ---
    // If user isn't logged in, send them to the lock/login screen immediately
    if (sessionStorage.getItem('paytrackUserSession') !== 'true') {
        window.location.replace('lock.html');
        return;
    }
     
    // --- BOTTOM NAVIGATION & SORT LOGIC ---
const nSearch = document.getElementById('navSearch');
const nSort = document.getElementById('navSort');
const nAdd = document.getElementById('navAdd');
const nSync = document.getElementById('navSync');
const nSettings = document.getElementById('navSettings');

const sortSheet = document.getElementById('sortActionSheet');
const closeSheet = document.getElementById('closeSortSheet');
const navFilterButtons = document.querySelectorAll('.nav-filter-btn');

// 1. Search Logic
nSearch?.addEventListener('click', () => {
    const input = document.getElementById('projectSearchInput');
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => input.focus(), 500);
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

// 3. Add Logic
nAdd?.addEventListener('click', () => {
    document.getElementById('tabCreate').click();
    const nameInput = document.getElementById('newProjectName');
    nameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => nameInput.focus(), 500);
});

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
        try {
            // ONLY start syncing if we actually have a username
            console.log("Sync: Checking for cloud updates for:", username);
            
            await auth.downloadUserData(username); 
            
            renderProjects();
            applyTheme();

            // Start real-time listener
            auth.subscribeToUserData(username, (newData) => {
                renderProjects();
                applyTheme();
                if(typeof translatePage === 'function') translatePage();
            });
        } catch (err) {
            console.error("Dashboard Sync Error:", err);
            // If it's a permission error, it's likely the Rules haven't published yet
        }
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
document.getElementById('editProjectForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('editProjectId').value;
    const newName = document.getElementById('editProjectNameInput').value.trim();
    
    let projects = JSON.parse(localStorage.getItem('allTrackerProjects')) || [];
    const pIndex = projects.findIndex(p => p.id == id);
    if (pIndex === -1) return;
    
    const projectType = projects[pIndex].type;
    projects[pIndex].name = newName;
    localStorage.setItem('allTrackerProjects', JSON.stringify(projects));

    const storageKey = `project_${id}_${projectType}`;
    let projectData = JSON.parse(localStorage.getItem(storageKey)) || {};

    if (projectType === 'installment') {
        const newTotal = parseFloat(document.getElementById('editProjectTotalCost').value) || 0;
        
        projectData.projectMetaData = {
            name: newName,
            totalCost: newTotal,
            agreementDate: document.getElementById('editProjectDate').value,
            description: document.getElementById('editProjectDesc').value,
            receipts: [...editTempImages] // This saves the added/removed receipts
        };
        
        projectData.projectName = newName;
        projectData.totalAmount = newTotal;
        const paid = (projectData.payments || []).reduce((sum, p) => sum + p.paymentAmount, 0);
        projectData.paidAmount = paid;
        projectData.pendingAmount = newTotal - paid;
    } else {
        projectData.projectName = newName;
    }

    localStorage.setItem(storageKey, JSON.stringify(projectData));
    
    // --- FIX: Trigger Cloud Sync immediately after editing ---
    try {
        const auth = await import('./auth.js');
        const currentProject = projects[pIndex];
        
        // 1. Sync the project list (for the name change)
        await auth.syncDataToCloud(); 
        
        // 2. Sync the specific project card (for receipts/metadata)
        await auth.updateGlobalCard(currentProject, projectData);
        
        console.log("Edit Synced to Cloud");
    } catch (err) {
        console.warn("Edit Cloud Sync failed:", err);
    }

    document.getElementById('editProjectModal').classList.add('hidden');
    renderProjects(); 
    showNotification("Project updated and synced!", "success");

    
    // 4. Cleanup UI
    document.getElementById('editProjectModal').classList.add('hidden');
    renderProjects(); // Refresh the Dashboard list
    if (typeof triggerCloudSync === 'function') triggerCloudSync();
    alert("Project saved successfully!");
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
    for (const file of files) {
        const base64 = await readFileAsDataURL(file);
        editTempImages.push(base64);
    }
    renderEditImagePreviews();
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
                        <div class="flex items-center gap-2 mt-1">
                            <span class="text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${project.type === 'finance' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}">
                                ${project.type}
                            </span>
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
        const newProjectEntry = {
            id: projectId,
            displayId: generateNextDisplayId(localProjects),
            name: cloudCard.originalName,
            type: projectData.settings?.expenseMode ? 'finance' : 'installment',
            cardNumber: cardNum // <--- THIS MUST BE HERE
        };

        localProjects.push(newProjectEntry);
        localStorage.setItem(PROJECTS_KEY, JSON.stringify(localProjects));

        // Sync the updated list to the user's cloud profile
        await triggerCloudSync(); 

        showNotification("Project imported successfully!", "success");
        renderProjects();
        tabCreate.click();
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