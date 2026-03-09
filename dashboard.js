// dashboard.js
import { fetchProjectByCard, syncLocalCardsToCloud, subscribeToUserData } from './auth.js';

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

    // --- 2. SECURITY CHECK ---
    // If user isn't logged in, send them to the lock/login screen immediately
    if (sessionStorage.getItem('paytrackUserSession') !== 'true') {
        window.location.replace('lock.html');
        return;
    }

    // --- 3. INITIALIZATION & CLOUD SYNC ---
    // Rule 1: Apply theme and show local projects INSTANTLY
    applyTheme();
    renderProjects();

    // Rule 2: If logged in, Download Cloud Data FIRST, then start listening
    if (username) {
        import('./auth.js').then(async (auth) => {
            console.log("Sync: Checking for cloud updates...");
            
            // Wait for download to finish so we don't accidentally sync "0 projects" to cloud
            await auth.downloadUserData(username); 
            
            // Refresh UI with downloaded data
            renderProjects();
            applyTheme();

            // Start real-time listener for any changes made on other devices (like mobile)
            auth.subscribeToUserData(username, (newData) => {
                console.log("Sync: Real-time update applied");
                renderProjects();
                applyTheme();
                if(typeof translatePage === 'function') translatePage();
            });
        });
    }

    // --- 4. INTERNAL FUNCTIONS (Keep these as they are) ---
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
                            <span class="text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${project.type === 'expense' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'}">
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

    newProjectForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const projectName = newProjectNameInput.value.trim();
        if (projectName) {
            const projects = getProjects();
            const newProject = { id: Date.now(), displayId: generateNextDisplayId(projects), name: projectName, type: newProjectType.value };
            projects.push(newProject);
            saveProjects(projects);
            newProjectNameInput.value = '';
            renderProjects();
            showNotification("Project Created!");
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
        if (target.classList.contains('edit-project-btn')) {
            const projects = getProjects();
            const project = projects.find(p => p.id == projectId);
            const newName = prompt("New project name:", project.name);
            if (newName) { project.name = newName.trim(); saveProjects(projects); renderProjects(); }
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
});