// dashboard.js
import { fetchProjectByCard, syncLocalCardsToCloud, subscribeToUserData } from './auth.js';

// --- CLOUD SYNC HELPER ---
async function triggerCloudSync() {
    // UPDATED: Check localStorage instead of sessionStorage
    if (localStorage.getItem('paytrackUsername')) {
        try {
            const auth = await import('./auth.js');
            await auth.syncDataToCloud();
            // Also sync card data in background
            auth.syncLocalCardsToCloud();
            console.log("Dashboard: Auto-sync triggered");
        } catch (e) {
            console.log("Sync skipped (auth module not found or network error)");
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const username = localStorage.getItem('paytrackUsername');

    // --- LIVE SYNC LOGIC ---
    if (username) {
        subscribeToUserData(username, (newData) => {
            console.log("Dashboard synced from another device!");
            
            // Re-run these functions to update the screen instantly
            const settings = JSON.parse(localStorage.getItem('dashboardGlobalSettings')) || {};
            applyTheme(settings.theme); // Update theme if it changed
            renderProjects();           // Update project list (adds/removes/renames projects)
            
            if(typeof translatePage === 'function') translatePage(); // Update language if changed
        });
    }
    // --- SECURITY CHECK ---
    // This stays sessionStorage because "Session" (unlocked state) should be temporary
    // but the username logic above handles the profile persistence.
    if (sessionStorage.getItem('paytrackUserSession') !== 'true') {
        window.location.replace('lock.html');
        return;
    } 

    
    if(typeof translatePage === 'function') translatePage();

    // DOM Elements
    const newProjectForm = document.getElementById('newProjectForm');
    const newProjectNameInput = document.getElementById('newProjectName');
    const newProjectType = document.getElementById('newProjectType');
    const projectListContainer = document.getElementById('projectList');
    const noProjectsMessage = document.getElementById('noProjects');
    const notificationElement = document.getElementById('notification');
    const settingsBtn = document.getElementById('dashboardSettingsBtn');
    const projectSearchInput = document.getElementById('projectSearchInput');
    const installmentReminderBanner = document.getElementById('installmentReminderBanner');
    const dismissReminderBtn = document.getElementById('dismissReminderBtn');
    
    // Import / Tabs Elements
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
    
    const PROJECTS_KEY = 'allTrackerProjects';
    const GLOBAL_SETTINGS_KEY = 'dashboardGlobalSettings';
    const DELETE_PASSWORD_KEY = 'dashboardDeletePassword';

    let undoCache = null;
    let undoTimeoutId = null;
    let projectToDeleteId = null;
    let currentFilter = 'all'; 

    // --- UTILITIES ---
    function applyTheme(themeName = 'default') {
        const settings = JSON.parse(localStorage.getItem(GLOBAL_SETTINGS_KEY)) || {};
        document.body.className = document.body.className.replace(/theme-\w+/g, '').trim();
        document.body.style.cssText = '';
        if (themeName !== 'default') document.body.classList.add(`theme-${themeName}`);
    }

    function showNotification(message, type = 'success', undoCallback = null) {
        if (undoTimeoutId) { clearTimeout(undoTimeoutId); undoTimeoutId = null; }
        notificationElement.innerHTML = message;
        notificationElement.className = `notification ${type} show`;
        setTimeout(() => notificationElement.classList.remove('show'), 3000);
    }

    // --- DATA MANAGEMENT ---
    function getProjects() {
        let projects = JSON.parse(localStorage.getItem(PROJECTS_KEY)) || [];
        // Migration logic for old projects without displayId
        let updated = false;
        projects.forEach((p, index) => {
            if (!p.displayId) {
                p.displayId = `P${index + 1}`;
                updated = true;
            }
        });
        if (updated) localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
        return projects;
    }

    function saveProjects(projects) {
        localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
        triggerCloudSync();
    }

    function generateNextDisplayId(projects) {
        if (projects.length === 0) return 'P1';
        const ids = projects.map(p => {
            if(!p.displayId) return 0;
            return parseInt(p.displayId.replace('P', ''), 10);
        });
        const maxId = Math.max(...ids);
        return `P${maxId + 1}`;
    }

    // --- RENDER LOGIC ---
    function renderProjects() {
        const projects = getProjects();
        projectListContainer.innerHTML = '';
        const lang = (JSON.parse(localStorage.getItem(GLOBAL_SETTINGS_KEY))?.language) || 'en';
        const searchTerm = projectSearchInput.value.toLowerCase().trim();

        const filteredProjects = projects.filter(p => {
            const matchesType = currentFilter === 'all' || p.type === currentFilter;
            const matchesSearch = p.name.toLowerCase().includes(searchTerm) || 
                                  (p.displayId && p.displayId.toLowerCase().includes(searchTerm));
            return matchesType && matchesSearch;
        });

        if (projects.length === 0) {
            noProjectsMessage.classList.remove('hidden');
            if(window.getTranslatedString) {
                noProjectsMessage.querySelector('h3').textContent = window.getTranslatedString('noProjectsYet');
                noProjectsMessage.querySelector('p').textContent = window.getTranslatedString('noProjectsDescription');
            }
            projectListContainer.classList.add('hidden');
        } else if (filteredProjects.length === 0) {
            noProjectsMessage.classList.remove('hidden');
            if(window.getTranslatedString) {
                noProjectsMessage.querySelector('h3').textContent = window.getTranslatedString('noProjectsFound');
                noProjectsMessage.querySelector('p').textContent = window.getTranslatedString('noProjectsFoundDescription');
            }
            projectListContainer.classList.add('hidden');
        } else {
            noProjectsMessage.classList.add('hidden');
            projectListContainer.classList.remove('hidden');
            
            filteredProjects.forEach(project => {
                const projectCard = document.createElement('div');
                projectCard.className = 'project-card bg-white flex items-center justify-between';
                const createdDate = new Date(project.id).toLocaleDateString(lang === 'ur' ? 'ar-SA' : lang);
                const projectType = project.type === 'expense' ? (window.getTranslatedString ? window.getTranslatedString('financeTracker') : 'Finance') : (window.getTranslatedString ? window.getTranslatedString('installmentTracker') : 'Installment');
                const typeClass = project.type === 'expense' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800';
                
                projectCard.innerHTML = `
                    <div class="project-card-content flex flex-col sm:flex-row items-center justify-between w-full">
                        <div class="text-center sm:text-left flex items-start gap-3">
                            <div class="hidden sm:flex flex-col items-center justify-center bg-gray-100 rounded-lg p-2 min-w-[3.5rem]">
                                <span class="text-xs font-bold text-gray-500">ID</span>
                                <span class="text-lg font-bold text-gray-800">${project.displayId}</span>
                            </div>
                            <div>
                                <div class="flex items-center gap-2 justify-center sm:justify-start">
                                    <h3 class="font-bold text-xl text-gray-800">${project.name}</h3>
                                    <span class="sm:hidden text-xs font-bold bg-gray-100 text-gray-600 px-2 py-0.5 rounded border border-gray-300">${project.displayId}</span>
                                </div>
                                <div class="flex items-center justify-center sm:justify-start gap-3 text-sm text-gray-500 mt-1 flex-wrap">
                                    <span>${createdDate}</span>
                                    <span class="font-semibold px-2 py-0.5 rounded-full ${typeClass}">${projectType}</span>
                                </div>
                            </div>
                        </div>
                        <div class="project-card-buttons flex-shrink-0 mt-4 sm:mt-0 flex gap-2">
                            <button class="btn-primary text-white font-semibold py-2 px-4 rounded-lg open-project-btn" data-project-id="${project.id}" title="Open Project"><i class="fas fa-folder-open"></i></button>
                            <button class="btn-secondary text-white font-semibold py-2 px-4 rounded-lg edit-project-btn" data-project-id="${project.id}" title="Edit Name"><i class="fas fa-edit"></i></button>
                            <button class="btn-danger text-white font-semibold py-2 px-4 rounded-lg delete-project-btn" data-project-id="${project.id}" title="Delete Project"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                `;
                projectListContainer.appendChild(projectCard);
            });
        }
    }

    // --- TAB SWITCHING ---
    tabCreate.addEventListener('click', (e) => {
        e.preventDefault();
        tabCreate.className = "text-lg font-bold text-blue-600 border-b-2 border-blue-600 px-4 py-1 transition-all";
        tabImport.className = "text-lg font-bold text-gray-500 hover:text-blue-500 px-4 py-1 transition-all";
        newProjectForm.classList.remove('hidden');
        newProjectForm.classList.add('flex');
        importCardForm.classList.add('hidden');
    });

    tabImport.addEventListener('click', (e) => {
        e.preventDefault();
        tabImport.className = "text-lg font-bold text-purple-600 border-b-2 border-purple-600 px-4 py-1 transition-all";
        tabCreate.className = "text-lg font-bold text-gray-500 hover:text-blue-500 px-4 py-1 transition-all";
        importCardForm.classList.remove('hidden');
        newProjectForm.classList.add('hidden');
        newProjectForm.classList.remove('flex');
    });

    // --- IMPORT CARD FORMATTING ---
    importCardNumber.addEventListener('input', (e) => {
        let val = e.target.value.replace(/\D/g, '');
        val = val.substring(0, 16);
        const groups = val.match(/.{1,4}/g);
        e.target.value = groups ? groups.join(' ') : val;
    });

    // --- HANDLE NEW PROJECT ---
    function handleNewProject(e) {
        e.preventDefault();
        const projectName = newProjectNameInput.value.trim();
        const projectType = newProjectType.value;

        if (projectName) {
            const projects = getProjects();
            const nameExists = projects.some(p => p.name.toLowerCase() === projectName.toLowerCase());
            if (nameExists) {
                showNotification(`A project named "${projectName}" already exists.`, 'error');
                return;
            }

            const newDisplayId = generateNextDisplayId(projects);
            const newProject = {
                id: Date.now(),
                displayId: newDisplayId,
                name: projectName,
                type: projectType
            };
            
            projects.push(newProject);
            saveProjects(projects);
            
            // Initialize settings
            const projectSettingsKey = `project_${newProject.id}_settings`;
            const initialSettings = {
                expenseMode: projectType === 'expense',
                theme: 'blue',
                dynamicProgressBar: false,
                progressBarColor: 'green',
                customBanks: [],
                customExpenseTypes: []
            };
            localStorage.setItem(projectSettingsKey, JSON.stringify(initialSettings));
            
            // Sync new project
            syncLocalCardsToCloud();
            triggerCloudSync();
            
            newProjectNameInput.value = '';
            sessionStorage.setItem('currentProjectId', newProject.id);
            const successMessage = encodeURIComponent(`Project '${projectName}' created!`);
            window.location.href = `paytrack.html?status=success&message=${successMessage}`;
        } else {
            showNotification('Please enter a valid project name.', 'error');
        }
    }

    // --- HANDLE IMPORT PROJECT ---
    importCardForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const originalText = importBtn.innerHTML;
        
        importBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Searching...`;
        importBtn.disabled = true;
    
        try {
            const cardNum = importCardNumber.value;
            const cardName = importCardName.value;
    
            const cardData = await fetchProjectByCard(cardNum, cardName);
            
            let projects = JSON.parse(localStorage.getItem('allTrackerProjects')) || [];
            if (projects.some(p => p.id === cardData.projectId)) {
                throw new Error("This project is already in your dashboard.");
            }
    
            // Add to Project List
            const newProject = {
                id: cardData.projectId,
                displayId: generateNextDisplayId(projects),
                name: cardData.originalName,
                type: cardData.fullData.settings?.expenseMode ? 'expense' : 'installment' 
            };
            projects.push(newProject);
            localStorage.setItem('allTrackerProjects', JSON.stringify(projects));
    
            // Save Data content
            if(cardData.fullData.installment) 
                localStorage.setItem(`project_${cardData.projectId}_installment`, JSON.stringify(cardData.fullData.installment));
            
            if(cardData.fullData.expense)
                localStorage.setItem(`project_${cardData.projectId}_expense`, JSON.stringify(cardData.fullData.expense));
    
            if(cardData.fullData.settings)
                localStorage.setItem(`project_${cardData.projectId}_settings`, JSON.stringify(cardData.fullData.settings));
    
            // Sync back to update User profile reference
            syncLocalCardsToCloud();
            triggerCloudSync();
    
            showNotification("Project imported successfully!", "success");
            
            setTimeout(() => {
                renderProjects();
                tabCreate.click(); 
                importCardForm.reset();
                importBtn.innerHTML = originalText;
                importBtn.disabled = false;
            }, 1000);
    
        } catch (err) {
            showNotification(err.message, "error");
            importBtn.innerHTML = originalText;
            importBtn.disabled = false;
        }
    });

    // --- EVENT LISTENERS ---
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

    projectSearchInput.addEventListener('input', renderProjects);

    projectListContainer.addEventListener('click', (e) => {
        const target = e.target.closest('button');
        if (!target) return;

        if (target.classList.contains('open-project-btn')) {
            sessionStorage.setItem('currentProjectId', target.dataset.projectId);
            window.location.href = `paytrack.html`;
        }
        if (target.classList.contains('edit-project-btn')) {
            const projectId = parseInt(target.dataset.projectId);
            handleEditProject(projectId);
        }
        if (target.classList.contains('delete-project-btn')) {
            projectToDeleteId = parseInt(target.dataset.projectId);
            passwordModal.classList.remove('hidden');
            deletePasswordInput.focus();
        }
    });

    newProjectForm.addEventListener('submit', handleNewProject);

    function handleEditProject(projectId) {
        let projects = getProjects();
        const projectIndex = projects.findIndex(p => p.id === projectId);
        if (projectIndex === -1) return;

        const currentName = projects[projectIndex].name;
        const newName = prompt("Enter the new project name:", currentName);

        if (newName && newName.trim() !== '' && newName.trim() !== currentName) {
            const nameExists = projects.some(p => p.id !== projectId && p.name.toLowerCase() === newName.trim().toLowerCase());
            if (nameExists) {
                showNotification('Name already taken by another project.', 'error');
                return;
            }

            projects[projectIndex].name = newName.trim();
            saveProjects(projects);
            renderProjects();
            
            // Sync Name Change to Cloud Card
            syncLocalCardsToCloud();
            
            showNotification('Project name updated successfully.', 'success');
        }
    }

    function handleDeleteProject(projectId) {
        let projects = getProjects();
        const projectIndex = projects.findIndex(p => p.id === projectId);
        if (projectIndex === -1) return;

        const projectToDelete = projects[projectIndex];
        
        undoCache = {
            project: projectToDelete,
            index: projectIndex,
            installmentData: localStorage.getItem(`project_${projectId}_installment`),
            expenseData: localStorage.getItem(`project_${projectId}_expense`),
            settingsData: localStorage.getItem(`project_${projectId}_settings`)
        };

        projects.splice(projectIndex, 1);
        saveProjects(projects); 

        localStorage.removeItem(`project_${projectId}_installment`);
        localStorage.removeItem(`project_${projectId}_expense`);
        localStorage.removeItem(`project_${projectId}_settings`);
        
        triggerCloudSync(); // Update user profile
        
        renderProjects();
        showNotification('Project deleted.', 'success', undoProjectDeletion);
    }

    function undoProjectDeletion() {
        if (!undoCache) return;
        const { project, index, installmentData, expenseData, settingsData } = undoCache;
        let projects = getProjects();
        
        if(projects.some(p => p.name.toLowerCase() === project.name.toLowerCase())) {
            project.name = project.name + " (Restored)";
        }

        projects.splice(index, 0, project);
        saveProjects(projects); 

        if (installmentData) localStorage.setItem(`project_${project.id}_installment`, installmentData);
        if (expenseData) localStorage.setItem(`project_${project.id}_expense`, expenseData);
        if (settingsData) localStorage.setItem(`project_${project.id}_settings`, settingsData);
        
        triggerCloudSync();
        syncLocalCardsToCloud();

        renderProjects();
        showNotification('Project restored.', 'success');
        undoCache = null;
    }
    
    cancelDeleteBtn.addEventListener('click', () => {
        passwordModal.classList.add('hidden');
        deletePasswordInput.value = '';
        passwordError.classList.add('hidden');
        projectToDeleteId = null;
    });

    confirmDeleteBtn.addEventListener('click', () => {
        const password = deletePasswordInput.value;
        const correctPassword = localStorage.getItem(DELETE_PASSWORD_KEY) || '7739';

        if (password === correctPassword) {
            handleDeleteProject(projectToDeleteId);
            passwordModal.classList.add('hidden');
            deletePasswordInput.value = '';
            passwordError.classList.add('hidden');
            projectToDeleteId = null;
        } else {
            passwordError.classList.remove('hidden');
            deletePasswordInput.value = '';
        }
    });

    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => { window.location.href = 'settings.html'; });
    }
    
    const settings = JSON.parse(localStorage.getItem(GLOBAL_SETTINGS_KEY)) || {};
    applyTheme(settings.theme);
    renderProjects();
});