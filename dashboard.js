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

    // --- 3. DOM ELEMENTS ---
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
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    const passwordError = document.getElementById('passwordError');
    
    let projectToDeleteId = null;
    let currentFilter = 'all'; 

    // --- 4. INITIALIZATION (NO DELAY) ---
    // Rule: Apply theme and show projects INSTANTLY from local storage
    applyTheme();
    renderProjects();

    // Background Sync: Update data once the internet responds
    if (username) {
        import('./auth.js').then(auth => {
            auth.downloadUserData(username).then(() => {
                applyTheme();
                renderProjects();
            });
            subscribeToUserData(username, (newData) => {
                applyTheme();
                renderProjects();
                if(typeof translatePage === 'function') translatePage();
            });
        });
    }

    // Security Check
    if (sessionStorage.getItem('paytrackUserSession') !== 'true') {
        window.location.replace('lock.html');
        return;
    }

    // --- 5. UTILITIES ---
    function applyTheme() {
        const settings = JSON.parse(localStorage.getItem(GLOBAL_SETTINGS_KEY)) || {};
        const themeName = settings.theme || 'default';
        document.body.className = document.body.className.replace(/theme-\w+/g, '').trim();
        document.body.style.cssText = '';
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
        triggerCloudSync();
    }

    function generateNextDisplayId(projects) {
        if (projects.length === 0) return 'P1';
        const ids = projects.map(p => parseInt(p.displayId?.replace('P', '') || 0, 10));
        return `P${Math.max(...ids) + 1}`;
    }

    // --- 6. RENDER LOGIC (RESTORED CLASSES + HORIZONTAL LINES) ---
    function renderProjects() {
        const projects = getProjects();
        if(!projectListContainer) return;
        projectListContainer.innerHTML = '';
        
        const searchTerm = projectSearchInput.value.toLowerCase().trim();

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
                
                // --- ADDED HORIZONTAL LINE LOGIC ---
                // Add a border unless it's the very last project in the list
                const isLast = index === filteredProjects.length - 1;
                const borderClass = isLast ? '' : 'border-b border-gray-200 dark:border-gray-700 pb-6 mb-6';
                
                projectCard.className = `project-card-container ${borderClass}`;
                projectCard.innerHTML = `
                    <div class="project-card bg-white flex items-center justify-between glass-effect p-4 rounded-2xl shadow-sm transition-all hover:translate-y-[-2px]">
                        <div class="project-card-content flex flex-col sm:flex-row items-center justify-between w-full">
                            <div class="text-center sm:text-left flex items-start gap-4">
                                <div class="hidden sm:flex flex-col items-center justify-center bg-gray-100 rounded-xl p-2 min-w-[3.5rem]">
                                    <span class="text-[10px] font-bold text-gray-400 uppercase">ID</span>
                                    <span class="text-lg font-black text-gray-700">${project.displayId || 'P'}</span>
                                </div>
                                <div>
                                    <h3 class="font-bold text-xl text-gray-800">${project.name}</h3>
                                    <div class="flex items-center justify-center sm:justify-start gap-2 mt-1">
                                        <span class="text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${project.type === 'expense' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'}">${project.type}</span>
                                    </div>
                                </div>
                            </div>
                            <div class="project-card-buttons flex-shrink-0 mt-4 sm:mt-0 flex gap-2">
                                <button class="btn-primary text-white w-10 h-10 flex items-center justify-center rounded-lg open-project-btn" data-project-id="${project.id}" title="Open Project"><i class="fas fa-folder-open"></i></button>
                                <button class="btn-secondary text-white w-10 h-10 flex items-center justify-center rounded-lg edit-project-btn" data-project-id="${project.id}" title="Edit Name"><i class="fas fa-edit"></i></button>
                                <button class="btn-danger text-white w-10 h-10 flex items-center justify-center rounded-lg delete-project-btn" data-project-id="${project.id}" title="Delete Project"><i class="fas fa-trash"></i></button>
                            </div>
                        </div>
                    </div>
                `;
                projectListContainer.appendChild(projectCard);
            });
        }
    }

    // --- 7. EVENT LISTENERS (FULL FEATURES) ---

    // Search
    projectSearchInput.addEventListener('input', renderProjects);

    // Filters
    filterButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            filterButtons.forEach(b => {
                b.classList.remove('bg-blue-600', 'text-white');
                b.classList.add('bg-gray-200', 'text-gray-700');
            });
            e.target.classList.remove('bg-gray-200', 'text-gray-700');
            e.target.classList.add('bg-blue-600', 'text-white');
            currentFilter = e.target.dataset.filter;
            renderProjects();
        });
    });

    // Create New
    newProjectForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const projectName = newProjectNameInput.value.trim();
        if (projectName) {
            const projects = getProjects();
            const newProject = {
                id: Date.now(),
                displayId: generateNextDisplayId(projects),
                name: projectName,
                type: newProjectType.value
            };
            projects.push(newProject);
            saveProjects(projects);
            newProjectNameInput.value = '';
            renderProjects();
            showNotification("Project Created Successfully!");
        }
    });

    // Project Actions (Open, Edit, Delete)
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
            const newName = prompt("Enter new project name:", project.name);
            if (newName && newName.trim() !== "") {
                project.name = newName.trim();
                saveProjects(projects);
                renderProjects();
                showNotification("Name updated!");
            }
        }

        if (target.classList.contains('delete-project-btn')) {
            projectToDeleteId = projectId;
            passwordModal.classList.remove('hidden');
            deletePasswordInput.value = '';
            deletePasswordInput.focus();
        }
    });

    // --- 8. DELETE WITH PASSWORD MODAL (RESTORED) ---
    confirmDeleteBtn.addEventListener('click', () => {
        const enteredPassword = deletePasswordInput.value;
        const correctPassword = localStorage.getItem(DELETE_PASSWORD_KEY) || '7739';

        if (enteredPassword === correctPassword) {
            let projects = getProjects();
            projects = projects.filter(p => p.id != projectToDeleteId);
            
            // Clean up related storage
            localStorage.removeItem(`project_${projectToDeleteId}_installment`);
            localStorage.removeItem(`project_${projectToDeleteId}_expense`);
            localStorage.removeItem(`project_${projectToDeleteId}_settings`);

            saveProjects(projects);
            renderProjects();
            
            passwordModal.classList.add('hidden');
            passwordError.classList.add('hidden');
            showNotification("Project Deleted", "error");
        } else {
            passwordError.classList.remove('hidden');
            deletePasswordInput.value = '';
        }
    });

    cancelDeleteBtn.addEventListener('click', () => {
        passwordModal.classList.add('hidden');
        passwordError.classList.add('hidden');
    });

    // --- 9. TABS (RESTORED) ---
    tabCreate.addEventListener('click', (e) => {
        e.preventDefault();
        tabCreate.className = "text-lg font-bold text-blue-600 border-b-2 border-blue-600 px-4 py-1 transition-all";
        tabImport.className = "text-lg font-bold text-gray-500 hover:text-blue-500 px-4 py-1 transition-all";
        newProjectForm.classList.remove('hidden');
        importCardForm.classList.add('hidden');
    });

    tabImport.addEventListener('click', (e) => {
        e.preventDefault();
        tabImport.className = "text-lg font-bold text-blue-600 border-b-2 border-blue-600 px-4 py-1 transition-all";
        tabCreate.className = "text-lg font-bold text-gray-500 hover:text-blue-500 px-4 py-1 transition-all";
        importCardForm.classList.remove('hidden');
        newProjectForm.classList.add('hidden');
    });

    // --- 10. IMPORT LOGIC (RESTORED) ---
    importCardNumber.addEventListener('input', (e) => {
        let val = e.target.value.replace(/\D/g, '');
        val = val.substring(0, 16);
        const groups = val.match(/.{1,4}/g);
        e.target.value = groups ? groups.join(' ') : val;
    });

    importCardForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const originalBtnText = importBtn.innerHTML;
        importBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Searching...`;
        importBtn.disabled = true;

        try {
            const cardNum = importCardNumber.value;
            const cardName = importCardName.value;
            const cardData = await fetchProjectByCard(cardNum, cardName);
            
            let projects = getProjects();
            if (projects.some(p => p.id === cardData.projectId)) {
                throw new Error("This project is already in your dashboard.");
            }

            const newProject = {
                id: cardData.projectId,
                displayId: generateNextDisplayId(projects),
                name: cardData.originalName,
                type: cardData.fullData.settings?.expenseMode ? 'expense' : 'installment' 
            };
            projects.push(newProject);
            saveProjects(projects);

            if(cardData.fullData.installment) localStorage.setItem(`project_${cardData.projectId}_installment`, JSON.stringify(cardData.fullData.installment));
            if(cardData.fullData.expense) localStorage.setItem(`project_${cardData.projectId}_expense`, JSON.stringify(cardData.fullData.expense));
            if(cardData.fullData.settings) localStorage.setItem(`project_${cardData.projectId}_settings`, JSON.stringify(cardData.fullData.settings));

            showNotification("Project imported successfully!", "success");
            renderProjects();
            importCardForm.reset();
        } catch (err) {
            showNotification(err.message, "error");
        } finally {
            importBtn.innerHTML = originalBtnText;
            importBtn.disabled = false;
        }
    });

    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => { window.location.href = 'settings.html'; });
    }
});