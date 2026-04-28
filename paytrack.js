import { subscribeToUserData, subscribeToProjectCard, updateGlobalCard } from './auth.js';
// --- CLOUD SYNC HELPERS ---

// 1. Sync User Profile (List of projects, global settings)
async function triggerCloudSync() {
    const username = localStorage.getItem('paytrackUsername');
    if (!username) return;

    try {
        const auth = await import('./auth.js');
        
        // 1. Sync the general profile (list of projects)
        await auth.syncDataToCloud();
        
        // 2. ONLY sync the current project card (Not all projects)
        const allProjects = JSON.parse(localStorage.getItem(PROJECTS_KEY)) || [];
        const currentProjectObj = allProjects.find(p => p.id == currentProjectId);
        
        if (currentProjectObj) {
            const instData = JSON.parse(localStorage.getItem(INSTALLMENT_STORAGE_KEY));
            const expData = JSON.parse(localStorage.getItem(EXPENSE_STORAGE_KEY));
            const sets = JSON.parse(localStorage.getItem(SETTINGS_KEY));
            const fullData = { installment: instData, expense: expData, settings: sets };
            
            await auth.updateGlobalCard(currentProjectObj, fullData);
        }
        
        console.log("Sync successful");
    } catch (e) {
        console.error("Sync failed:", e);
    }
}

// 2. Update specific Global Card in Database (Project Data Backup)
async function autoUpdateGlobalCard() {
    try {
        const auth = await import('./auth.js');
        const allProjects = JSON.parse(localStorage.getItem('allTrackerProjects')) || [];
        // Loose comparison (==) handles string/number mismatch for ID
        const currentProjectObj = allProjects.find(p => p.id == currentProjectId);
        
        if (currentProjectObj) {
            // Retrieve current data snapshots for this project
            const instData = JSON.parse(localStorage.getItem(`project_${currentProjectId}_installment`));
            const expData = JSON.parse(localStorage.getItem(`project_${currentProjectId}_expense`));
            const sets = JSON.parse(localStorage.getItem(`project_${currentProjectId}_settings`));

            const fullData = {
                installment: instData,
                expense: expData,
                settings: sets
            };

            // Call the auth function to push to Firestore "global_cards" collection
            await auth.updateGlobalCard(currentProjectObj, fullData);
        }
    } catch (e) {
        console.warn("Card Auto-update failed:", e);
    }
}

// --- APP STATE & VARIABLES ---
let currentDetailId = null; // Add this line near currentProjectId
let appState = {};
let currentSettings = {};
let currentPage = 'main';
let currentProjectId = null;
let undoCache = null;
let undoTimeoutId = null;
let isBalanceVisible = false;
let currentChartYear = null;
let currentChartType = null;
let activeCharts = {};
let globalSettings = {};

// Transaction Type State
let pendingTransactionType = 'income';
let currentTransactionType = 'income';

// Recipt gallery of installmnet tracker
let currentGalleryImages = [];
let currentGalleryIndex = 0;
let touchStartX = 0;
let touchEndX = 0;

// Storage Keys
let INSTALLMENT_STORAGE_KEY = '';
let EXPENSE_STORAGE_KEY = '';
let SETTINGS_KEY = '';
let VISIBILITY_KEY = '';
let SHORTCUTS_STORAGE_KEY = '';
let AUTO_TRANSACTIONS_STORAGE_KEY = '';
let tempInitReceipts = []; // Array to hold base64 strings for project setup
const PROJECTS_KEY = 'allTrackerProjects';
const DELETE_PASSWORD_KEY = 'dashboardDeletePassword';
const GLOBAL_SETTINGS_KEY = 'dashboardGlobalSettings';

// --- DOM ELEMENTS MAPPING ---
const elements = {
    //Installment tracker project detail modal
    projectDetailsModal: document.getElementById('projectDetailsModal'),
    closeProjectDetailsBtn: document.getElementById('closeProjectDetailsBtn'),
    viewDetailProjectName: document.getElementById('viewDetailProjectName'),
    viewDetailTotalCost: document.getElementById('viewDetailTotalCost'),
    viewDetailDate: document.getElementById('viewDetailDate'),
    viewDetailDesc: document.getElementById('viewDetailDesc'),
    viewDetailReceiptContainer: document.getElementById('viewDetailReceiptContainer'),
    viewDetailReceiptImg: document.getElementById('viewDetailReceiptImg'),
    projectSetupSection: document.getElementById('projectSetupSection'),
    //installment mode total amount form
     projectInitializationForm: document.getElementById('projectInitializationForm'),
    standardInstallmentForm: document.getElementById('standardInstallmentForm'),
    initTotalAmount: document.getElementById('initTotalAmount'),
    initDate: document.getElementById('initDate'),
    initDescription: document.getElementById('initDescription'),
    initReceipt: document.getElementById('initReceipt'),
    btnSaveInitialization: document.getElementById('btnSaveInitialization'),
    initAmountWords: document.getElementById('initAmountWords'),
    initReceiptPreview: document.getElementById('initReceiptPreview'),
    initReceiptPreviewContainer: document.getElementById('initReceiptPreviewContainer'),
    removeInitReceiptBtn: document.getElementById('removeInitReceiptBtn'),
    // Detail Page Elements
    paymentCategory: document.getElementById('paymentCategory'),
    installmentReceipt: document.getElementById('installmentReceipt'),
    installmentReceiptPreviewContainer: document.getElementById('installmentReceiptPreviewContainer'),
    installmentReceiptPreview: document.getElementById('installmentReceiptPreview'),
    removeInstallmentReceiptBtn: document.getElementById('removeInstallmentReceiptBtn'),
    detailPage: document.getElementById('detailPage'),
    detailBorderColor: document.getElementById('detailBorderColor'),
    detailAmount: document.getElementById('detailAmount'),
    detailDateTime: document.getElementById('detailDateTime'),
    detailDescription: document.getElementById('detailDescription'),
    detailCategory: document.getElementById('detailCategory'),
    detailType: document.getElementById('detailType'),
    detailMethod: document.getElementById('detailMethod'),
    detailBank: document.getElementById('detailBank'),
    detailBankContainer: document.getElementById('detailBankContainer'),
    detailReceiptContainer: document.getElementById('detailReceiptContainer'),
    detailReceiptLink: document.getElementById('detailReceiptLink'),
    detailReceiptThumbnail: document.getElementById('detailReceiptThumbnail'),
    detailEditBtn: document.getElementById('detailEditBtn'),
    detailDeleteBtn: document.getElementById('detailDeleteBtn'),
    backToHistoryBtn: document.getElementById('backToHistoryBtn'),
    //Standard page elements
    btnOpenTotalAmount: document.getElementById('btnOpenTotalAmount'),
btnOpenInstallmentForm: document.getElementById('btnOpenInstallmentForm'),
totalAmountInputArea: document.getElementById('totalAmountInputArea'),
actualInstallmentForm: document.getElementById('actualInstallmentForm'),
inputTotalProjectCost: document.getElementById('inputTotalProjectCost'),
btnSaveTotalAmount: document.getElementById('btnSaveTotalAmount'),
    btnOpenTotalAmount: document.getElementById('btnOpenTotalAmount'),
    btnOpenInstallmentForm: document.getElementById('btnOpenInstallmentForm'),
    totalAmountInputArea: document.getElementById('totalAmountInputArea'),
    actualInstallmentForm: document.getElementById('actualInstallmentForm'),
    inputTotalProjectCost: document.getElementById('inputTotalProjectCost'),
    btnSaveTotalAmount: document.getElementById('btnSaveTotalAmount'),
    addIncomeBtn: document.getElementById('addIncomeBtn'),
    addExpenseBtn: document.getElementById('addExpenseBtn'),
    shortcutTransactionsBtn: document.getElementById('shortcutTransactionsBtn'),
    viewHistoryBtnFinance: document.getElementById('viewHistoryBtnFinance'),
    viewChartBtn: document.getElementById('viewChartBtn'),
    viewCardBtn: document.getElementById('viewCardBtn'),
    shortcutTransactionsPage: document.getElementById('shortcutTransactionsPage'), // Important for Shortcuts
    inputTypeSelectionModal: document.getElementById('inputTypeSelectionModal'), // Important for Add Income
    body: document.body,
    mainHeaderText: document.getElementById('main-header-text'),
    headerSubtext: document.getElementById('header-subtext'),
    projectNameHeader: document.getElementById('project-name-header'),
    projectName: document.getElementById('projectName'),
    totalCost: document.getElementById('totalCost'),
    totalCostContainer: document.getElementById('totalCostContainer'),
    paymentAmount: document.getElementById('paymentAmount'),
    paymentAmountContainer: document.getElementById('paymentAmountContainer'),
    paymentDescription: document.getElementById('paymentDescription'),
    paymentDescriptionContainer: document.getElementById('paymentDescriptionContainer'),
    paymentMethod: document.getElementById('paymentMethod'),
    paymentMethodContainer: document.getElementById('paymentMethodContainer'),
    paymentDateContainer: document.getElementById('paymentDateContainer'),
    bankName: document.getElementById('bankName'),
    customBankName: document.getElementById('customBankName'),
    bankDropdownContainer: document.getElementById('bankDropdownContainer'),
    customBankContainer: document.getElementById('customBankContainer'),
    paymentDate: document.getElementById('paymentDate'),
    addPaymentBtn: document.getElementById('addPayment'),
    addPaymentText: document.getElementById('addPaymentText'),
    viewHistoryBtn: document.getElementById('viewHistory'),
    exportDataBtn: document.getElementById('exportData'),
    deleteRecordsBtn: document.getElementById('deleteRecords'),
    summaryCard1Label: document.getElementById('summaryCard1Label'),
    summaryCard2Label: document.getElementById('summaryCard2Label'),
    summaryCard3Label: document.getElementById('summaryCard3Label'),
    totalAmountDisplay: document.getElementById('totalAmount'),
    paidAmountDisplay: document.getElementById('paidAmount'),
    pendingAmountDisplay: document.getElementById('pendingAmount'),
    totalAmountWords: document.getElementById('totalAmountWords'),
    paidAmountWords: document.getElementById('paidAmountWords'),
    pendingAmountWords: document.getElementById('pendingAmountWords'),
    progressContainer: document.getElementById('progressContainer'),
    progressTitle: document.getElementById('progressTitle'),
    progressBar: document.getElementById('progressBar'),
    progressPercentage: document.getElementById('progressPercentage'),
    celebration: document.getElementById('celebration'),
    celebrationAudio: document.getElementById('celebrationAudio'),
    paymentForm: document.getElementById('paymentForm'),
    totalCostWords: document.getElementById('totalCostWords'),
    paymentAmountWords: document.getElementById('paymentAmountWords'),
    paymentCount: document.getElementById('paymentCount'),
    notification: document.getElementById('notification'),
    totalCostLabel: document.getElementById('totalCostLabel'),
    totalCostHelper: document.getElementById('totalCostHelper'),
    formTitle: document.getElementById('formTitle'),
    editPaymentId: document.getElementById('editPaymentId'),
    settingsFromMain: document.getElementById('settingsFromMain'),
    mainPage: document.getElementById('mainPage'),
    historyPage: document.getElementById('historyPage'),
    settingsPage: document.getElementById('settingsPage'),
    backToMainBtn: document.getElementById('backToMain'),
    settingsFromHistory: document.getElementById('settingsFromHistory'),
    goToTrackerBtn: document.getElementById('goToTracker'),
    searchInput: document.getElementById('searchInput'),
    methodFilter: document.getElementById('methodFilter'),
    dateFilter: document.getElementById('dateFilter'),
    historyTableHeader: document.getElementById('historyTableHeader'),
    historyTableBody: document.getElementById('historyTableBody'),
    noPaymentsHistory: document.getElementById('noPaymentsHistory'),
    noFilterResults: document.getElementById('noFilterResults'),
    filteredCount: document.getElementById('filteredCount'),
    totalCount: document.getElementById('totalCount'),
    avgPayment: document.getElementById('avgPayment'),
    maxPayment: document.getElementById('maxPayment'),
    minPayment: document.getElementById('minPayment'),
    lastPaymentDate: document.getElementById('lastPaymentDate'),
    backToMainFromSettings: document.getElementById('backToMainFromSettings'),
    expenseModeToggle: document.getElementById('expenseModeToggle'),
    dynamicColorToggle: document.getElementById('dynamicColorToggle'),
    manualColorSelector: document.getElementById('manualColorSelector'),
    themeSelector: document.getElementById('themeSelector'),
    formActionsDefault: document.getElementById('formActionsDefault'),
    formActionsEdit: document.getElementById('formActionsEdit'),
    updateRecordBtn: document.getElementById('updateRecordBtn'),
    cancelEditBtn: document.getElementById('cancelEditBtn'),
    toggleVisibilityBtn: document.getElementById('toggleVisibilityBtn'),
    installmentModeFormContainer: document.getElementById('installmentModeFormContainer'),
    expenseModeActionsContainer: document.getElementById('expenseModeActionsContainer'),
    addIncomeBtn: document.getElementById('addIncomeBtn'),
    addExpenseBtn: document.getElementById('addExpenseBtn'),
    viewHistoryBtnFinance: document.getElementById('viewHistoryBtnFinance'),
    viewChartBtn: document.getElementById('viewChartBtn'),
    shareBtn: document.getElementById('shareBtn'),
    exportExcelBtn: document.getElementById('exportExcelBtn'),
    deleteAllBtnFinance: document.getElementById('deleteAllBtnFinance'),
    transactionModal: document.getElementById('transactionModal'),
    closeTransactionModalBtn: document.getElementById('closeTransactionModalBtn'),
    transactionModalTitle: document.getElementById('transactionModalTitle'),
    modalTransactionForm: document.getElementById('modalTransactionForm'),
    modalEditId: document.getElementById('modalEditId'),
    modalAmount: document.getElementById('modalAmount'),
    modalAmountWords: document.getElementById('modalAmountWords'),
    modalDate: document.getElementById('modalDate'),
    modalDescription: document.getElementById('modalDescription'),
    modalCategory: document.getElementById('modalCategory'),
    modalCustomCategoryContainer: document.getElementById('modalCustomCategoryContainer'),
    modalCustomCategoryName: document.getElementById('modalCustomCategoryName'),
    modalPaymentMethod: document.getElementById('modalPaymentMethod'),
    modalBankDropdownContainer: document.getElementById('modalBankDropdownContainer'),
    modalBankName: document.getElementById('modalBankName'),
    modalCustomBankContainer: document.getElementById('modalCustomBankContainer'),
    modalCustomBankName: document.getElementById('modalCustomBankName'),
    modalReceipt: document.getElementById('modalReceipt'),
    saveTransactionBtn: document.getElementById('saveTransactionBtn'),
    speakAmountBtn: document.getElementById('speakAmountBtn'),
    modalReceiptPreviewContainer: document.getElementById('modalReceiptPreviewContainer'),
    modalReceiptPreview: document.getElementById('modalReceiptPreview'),
    removeReceiptBtn: document.getElementById('removeReceiptBtn'),
    receiptModal: document.getElementById('receiptModal'),
    receiptModalImage: document.getElementById('receiptModalImage'),
    closeReceiptModalBtn: document.getElementById('closeReceiptModalBtn'),
    deleteAllPasswordModal: document.getElementById('deleteAllPasswordModal'),
    deleteAllPasswordInput: document.getElementById('deleteAllPasswordInput'),
    deleteAllPasswordError: document.getElementById('deleteAllPasswordError'),
    cancelDeleteAllBtn: document.getElementById('cancelDeleteAllBtn'),
    confirmDeleteAllBtn: document.getElementById('confirmDeleteAllBtn'),
    detailPage: document.getElementById('detailPage'),
    backToHistoryBtn: document.getElementById('backToHistoryBtn'),
    detailAmount: document.getElementById('detailAmount'),
    detailDateTime: document.getElementById('detailDateTime'),
    detailDescription: document.getElementById('detailDescription'),
    detailCategory: document.getElementById('detailCategory'),
    detailType: document.getElementById('detailType'),
    detailMethod: document.getElementById('detailMethod'),
    detailBankContainer: document.getElementById('detailBankContainer'),
    detailBank: document.getElementById('detailBank'),
    detailReceiptContainer: document.getElementById('detailReceiptContainer'),
    detailReceiptLink: document.getElementById('detailReceiptLink'),
    detailEditBtn: document.getElementById('detailEditBtn'),
    detailDeleteBtn: document.getElementById('detailDeleteBtn'),
    yearlyChartPage: document.getElementById('yearlyChartPage'),
    yearlyChartsContainer: document.getElementById('yearlyChartsContainer'),
    backToMainFromYearly: document.getElementById('backToMainFromYearly'),
    monthlyChartPage: document.getElementById('monthlyChartPage'),
    monthlyChartTitle: document.getElementById('monthlyChartTitle'),
    monthlyIncomeChart: document.getElementById('monthlyIncomeChart'),
    monthlyExpenseChart: document.getElementById('monthlyExpenseChart'),
    backToYearly: document.getElementById('backToYearly'),
    cardPage: document.getElementById('cardPage'),
    projectCardDisplay: document.getElementById('projectCardDisplay'),
    cardPageNumber: document.getElementById('cardPageNumber'),
    cardPageName: document.getElementById('cardPageName'),
    cardPageValidThru: document.getElementById('cardPageValidThru'),
    backToMainFromCard: document.getElementById('backToMainFromCard'),
    viewCardBtn: document.getElementById('viewCardBtn'),
    viewCardBtnInstallment: document.getElementById('viewCardBtnInstallment'),
    shortcutTransactionsBtn: document.getElementById('shortcutTransactionsBtn'),
    shortcutTransactionsPage: document.getElementById('shortcutTransactionsPage'),
    backToMainFromShortcuts: document.getElementById('backToMainFromShortcuts'),
    shortcutListContainer: document.getElementById('shortcutListContainer'),
    noShortcutsMessage: document.getElementById('noShortcutsMessage'),
    makeShortcutBtn: document.getElementById('makeShortcutBtn'),
    shortcutSearchInput: document.getElementById('shortcutSearchInput'),
    noShortcutResultsMessage: document.getElementById('noShortcutResultsMessage'),
    shortcutEditModal: document.getElementById('shortcutEditModal'),
    autoTransactionModal: document.getElementById('autoTransactionModal'),
    autoTransactionForm: document.getElementById('autoTransactionForm'),
    autoShortcutId: document.getElementById('autoShortcutId'),
    autoFrequency: document.getElementById('autoFrequency'),
    autoDayOfWeekContainer: document.getElementById('autoDayOfWeekContainer'),
    autoDayOfWeek: document.getElementById('autoDayOfWeek'),
    autoDayOfMonthContainer: document.getElementById('autoDayOfMonthContainer'),
    autoDayOfMonth: document.getElementById('autoDayOfMonth'),
    autoTime: document.getElementById('autoTime'),
    cancelAutoBtn: document.getElementById('cancelAutoBtn'),
    saveAutoBtn: document.getElementById('saveAutoBtn'),
    viewAutoTransactionsBtn: document.getElementById('viewAutoTransactionsBtn'),
    autoTransactionsListPage: document.getElementById('autoTransactionsListPage'),
    backToShortcutsBtn: document.getElementById('backToShortcutsBtn'),
    autoTransactionListContainer: document.getElementById('autoTransactionListContainer'),
    noAutoTransactionsMessage: document.getElementById('noAutoTransactionsMessage'),

    // SELECTION MODAL & IMAGE PICKER
    inputTypeSelectionModal: document.getElementById('inputTypeSelectionModal'),
    closeSelectionModalBtn: document.getElementById('closeSelectionModalBtn'),
    btnSelectManual: document.getElementById('btnSelectManual'),
    btnSelectImage: document.getElementById('btnSelectImage'),
    globalImagePicker: document.getElementById('globalImagePicker'),

    // OCR ELEMENTS (Overlay)
    ocrLoadingOverlay: document.getElementById('ocrLoadingOverlay'),
    ocrStatusText: document.getElementById('ocrStatusText')
};

// --- INITIALIZATION ---

document.addEventListener('DOMContentLoaded', () => {
    // --- SECURITY CHECK ---
    if (sessionStorage.getItem('paytrackUserSession') !== 'true') {
        window.location.replace('lock.html');
        return;
    }

    currentProjectId = sessionStorage.getItem('currentProjectId');

    if (!currentProjectId) {
        alert('No project selected. Redirecting to dashboard.');
        window.location.href = 'dashboard.html';
        return;
    }

    // Set Keys
    INSTALLMENT_STORAGE_KEY = `project_${currentProjectId}_installment`;
    EXPENSE_STORAGE_KEY = `project_${currentProjectId}_expense`;
    SETTINGS_KEY = `project_${currentProjectId}_settings`;
    VISIBILITY_KEY = `project_${currentProjectId}_visibility`;
    SHORTCUTS_STORAGE_KEY = `project_${currentProjectId}_shortcuts`;
    AUTO_TRANSACTIONS_STORAGE_KEY = `project_${currentProjectId}_auto`;

    if(typeof translatePage === 'function') translatePage();

    globalSettings = JSON.parse(localStorage.getItem(GLOBAL_SETTINGS_KEY)) || {};
    populateDayOfMonthSelector();
    loadInitialData();
    setupEventListeners();
    showStorageStatus();
    checkAndRunAutoTransactions();

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('status') && urlParams.get('status') === 'success') {
        const message = urlParams.get('message');
        showNotification(decodeURIComponent(message), 'success');
        window.history.replaceState({}, document.title, window.location.pathname);
    }
     // --- REAL-TIME SYNC LISTENER ---
 // 1. Load your local data immediately for a fast start
    loadInitialData();

    // 2. Start the Real-Time Cloud Listener
    const username = localStorage.getItem('paytrackUsername');
    if (username) {
        // Find the Card Number for THIS specific project from the main project list
        const allProjects = JSON.parse(localStorage.getItem(PROJECTS_KEY)) || [];
        const projectInfo = allProjects.find(p => p.id == currentProjectId);

        if (projectInfo && projectInfo.cardNumber) {
            console.log("📡 PayTrack: Active sync on card:", projectInfo.cardNumber);
            
            // Note: We use the function imported at the top of the file
            subscribeToProjectCard(projectInfo.cardNumber, (remoteData) => {
                if (!remoteData) return;

                console.log("☁️ Real-time update received from cloud!");

                // A. Update LocalStorage so data persists on refresh
                if (remoteData.installment) localStorage.setItem(INSTALLMENT_STORAGE_KEY, JSON.stringify(remoteData.installment));
                if (remoteData.expense) localStorage.setItem(EXPENSE_STORAGE_KEY, JSON.stringify(remoteData.expense));
                if (remoteData.settings) localStorage.setItem(SETTINGS_KEY, JSON.stringify(remoteData.settings));

                // B. CRITICAL: Update LIVE variables in memory
                const isExpense = remoteData.settings?.expenseMode || false;
                const dataKey = isExpense ? EXPENSE_STORAGE_KEY : INSTALLMENT_STORAGE_KEY;
                const freshData = JSON.parse(localStorage.getItem(dataKey));
                
                if (freshData) {
                    // Update the global state variables
                    appState = { ...appState, ...freshData };
                    currentSettings = { ...currentSettings, ...remoteData.settings };
                    
                    // C. Refresh the UI immediately without a reload
                    updateUIMode(); // This updates labels/colors
                    updateSummary(); // This updates the totals on screen
                    
                    // Refresh sub-pages if the user is currently looking at them
                    if (currentPage === 'history') renderHistoryPage();
                    if (currentPage === 'yearlyChart') renderYearlyCharts();
                    if (currentPage === 'shortcuts') renderShortcutsPage();
                }
            });
        }
    }
});

// --- STATE MANAGEMENT ---

function getNewState(isExpenseMode) {
    return {
        totalAmount: 0,
        paidAmount: 0,
        pendingAmount: 0,
        initialBalance: 0,
        payments: [],
        projectName: '',
        expenseMode: isExpenseMode
    };
}

function loadInitialData() {
    const allProjects = JSON.parse(localStorage.getItem(PROJECTS_KEY)) || [];
    const currentProject = allProjects.find(p => p.id == currentProjectId);

    if (!currentProject) {
        window.location.href = 'dashboard.html';
        return;
    }

    const savedSettings = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || { 
    theme: 'blue', 
    expenseMode: currentProject.type === 'finance',
    customIncomeCategories: [], // Initialize these to prevent crashes
    customExpenseCategories: [],
    customBanks: [],
    progressBarColor: 'green'
};

// Safety check: ensure arrays exist even if settings were partially saved before
if (!savedSettings.customIncomeCategories) savedSettings.customIncomeCategories = [];
if (!savedSettings.customExpenseCategories) savedSettings.customExpenseCategories = [];
if (!savedSettings.customBanks) savedSettings.customBanks = [];

currentSettings = savedSettings;
    currentSettings = savedSettings;

    const dataKey = currentSettings.expenseMode ? EXPENSE_STORAGE_KEY : INSTALLMENT_STORAGE_KEY;
    const savedData = JSON.parse(localStorage.getItem(dataKey));

    appState = getNewState(currentSettings.expenseMode);
    if (savedData) {
        appState = { ...appState, ...savedData };
    }
    
    // Ensure the project name is always updated from the dashboard
    appState.projectName = currentProject.name;

    // --- MIGRATION CHECK ---
    // If Metadata is missing but we have a Total Amount, create basic metadata automatically
    if (!appState.projectMetaData && appState.totalAmount > 0) {
        appState.projectMetaData = {
            name: appState.projectName,
            totalCost: appState.totalAmount,
            agreementDate: "Original Setup",
            description: "Data migrated from initial setup.",
            receipt: null
        };
    }

    applyTheme(currentSettings.theme);
    updateUIMode(); 
    updateSummary();
    updateSettingsUI();
    setTodayDate();
    
    // Re-attach the double click listener here to be safe
    if (elements.projectSetupSection) {
        elements.projectSetupSection.addEventListener('dblclick', openProjectDetails);
    }
}

// --- CORE FUNCTIONS ---

// --- paytrack.js ---

async function saveData() {
    const dataKey = currentSettings.expenseMode ? EXPENSE_STORAGE_KEY : INSTALLMENT_STORAGE_KEY;
    
    // 1. Save to Local Storage
    localStorage.setItem(dataKey, JSON.stringify(appState));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(currentSettings));

    // 2. Push to Cloud User Profile (Dashboard sync)
    await syncDataToCloud(); 

    // 3. Push to Global Card (Real-time PayTrack sync)
    const allProjects = JSON.parse(localStorage.getItem(PROJECTS_KEY)) || [];
    const currentProjectObj = allProjects.find(p => p.id == currentProjectId);
    
    if (currentProjectObj) {
        const fullData = {
            installment: JSON.parse(localStorage.getItem(INSTALLMENT_STORAGE_KEY)),
            expense: JSON.parse(localStorage.getItem(EXPENSE_STORAGE_KEY)),
            settings: currentSettings
        };
        await updateGlobalCard(currentProjectObj, fullData);
    }
}

function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(currentSettings));
    triggerCloudSync();
}

function updateSummary() {
    elements.totalAmountDisplay.textContent = formatCurrency(appState.totalAmount);
    elements.paidAmountDisplay.textContent = formatCurrency(appState.paidAmount);
    elements.pendingAmountDisplay.textContent = formatCurrency(appState.pendingAmount);
    elements.totalAmountWords.textContent = numberToWords(appState.totalAmount);
    elements.paidAmountWords.textContent = numberToWords(appState.paidAmount);
    elements.pendingAmountWords.textContent = numberToWords(appState.pendingAmount);
    elements.paymentCount.textContent = appState.payments.length;
    updateProgressBarDisplay();
}

function clearForm() {
    elements.paymentForm.reset();
    
    // Maintain the fixed Project Name
    const allProjects = JSON.parse(localStorage.getItem(PROJECTS_KEY)) || [];
    const currentProject = allProjects.find(p => p.id == currentProjectId);
    if (currentProject) {
        elements.projectName.value = currentProject.name;
    }

    elements.paymentCategory.value = 'Installment';
    removeInstallmentReceiptPreview();
    elements.paymentDescription.value = '';
    handlePaymentMethodChange();
    elements.editPaymentId.value = '';
    updatePaymentAmountWords();
    updateTotalCostWords();

    setTodayDate(); // Default to today's date
    updateUIMode();
}

function openProjectDetails() {
    const data = appState.projectMetaData;
    if (!data) {
        showNotification("Agreement details not found.", "error");
        return;
    }

    // 1. Fill Text Data
    elements.viewDetailProjectName.textContent = data.name;
    elements.viewDetailTotalCost.textContent = formatCurrency(data.totalCost);
    elements.viewDetailDate.textContent = data.agreementDate;
    elements.viewDetailDesc.textContent = data.description;

    // 2. Handle Gallery
    const galleryContainer = document.getElementById('projectAgreementGallery');
    const containerWrapper = elements.viewDetailReceiptContainer;
    
    galleryContainer.innerHTML = ''; // Clear existing

    // Support both old data (receipt) and new data (receipts array)
    const imagesToShow = data.receipts || (data.receipt ? [data.receipt] : []);

    if (imagesToShow && imagesToShow.length > 0) {
        containerWrapper.classList.remove('hidden');
        
       imagesToShow.forEach((imageSrc, index) => {
    const img = document.createElement('img');
    img.src = imageSrc;
    img.className = 'agreement-gallery-thumb';
    
    img.addEventListener('click', (e) => {
        e.stopPropagation();
        // Pass ALL images and the starting index
        openImageGallery(imagesToShow, index);
    });
    
    galleryContainer.appendChild(img);
});
    } else {
        containerWrapper.classList.add('hidden');
    }

    // 3. Show Modal
    elements.projectDetailsModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden'; 
}

// Helper to update the modal structure if needed
function createDetailImageList() {
    const parent = elements.viewDetailReceiptContainer;
    // Remove the old single image tag if it exists
    if (elements.viewDetailReceiptImg) elements.viewDetailReceiptImg.remove();
    
    const newList = document.createElement('div');
    newList.id = 'viewDetailReceiptImgList';
    parent.appendChild(newList);
    return newList;
}

// --- INSTLLMNET TRACKER RECIPT GALLERY OF TOTAL AMOUNT --- 
function openImageGallery(images, startIndex) {
    currentGalleryImages = images;
    currentGalleryIndex = startIndex;
    
    updateGalleryUI();
    
    elements.receiptModal.classList.remove('hidden');
    elements.receiptModal.style.display = 'flex';
    document.body.style.overflow = 'hidden'; // Lock scroll
}

function updateGalleryUI() {
    if (currentGalleryImages.length === 0) return;
    
    const img = elements.receiptModalImage;
    img.className = ""; // Clear any animation classes
    img.src = currentGalleryImages[currentGalleryIndex];
    
    const counter = document.getElementById('receiptCounter');
    if (counter) {
        counter.textContent = `Receipt ${currentGalleryIndex + 1} of ${currentGalleryImages.length}`;
    }
    
    const showNav = currentGalleryImages.length > 1;
    document.getElementById('prevReceiptBtn').style.display = showNav ? 'flex' : 'none';
    document.getElementById('nextReceiptBtn').style.display = showNav ? 'flex' : 'none';
}


function nextGalleryImage() {
    performGalleryTransition('next');
}

function prevGalleryImage() {
    performGalleryTransition('prev');
}

function performGalleryTransition(direction) {
    if (currentGalleryImages.length <= 1) return;

    const img = elements.receiptModalImage;
    
    // 1. Apply the "Out" animation class based on direction
    const outClass = direction === 'next' ? 'gallery-anim-out-next' : 'gallery-anim-out-prev';
    img.classList.add(outClass);

    // 2. Wait for the "Out" animation to finish (400ms matches CSS)
    setTimeout(() => {
        // Update index
        if (direction === 'next') {
            currentGalleryIndex = (currentGalleryIndex + 1) % currentGalleryImages.length;
        } else {
            currentGalleryIndex = (currentGalleryIndex - 1 + currentGalleryImages.length) % currentGalleryImages.length;
        }

        // Change the image source while it's invisible
        img.src = currentGalleryImages[currentGalleryIndex];
        
        // Update the counter text
        const counter = document.getElementById('receiptCounter');
        if (counter) {
            counter.textContent = `Receipt ${currentGalleryIndex + 1} of ${currentGalleryImages.length}`;
        }

        // 3. Remove "Out" class and apply "Prep" class (instantly moves image to opposite side)
        img.classList.remove(outClass);
        const prepClass = direction === 'next' ? 'gallery-anim-prep-next' : 'gallery-anim-prep-prev';
        img.classList.add(prepClass);

        // 4. Use a tiny timeout to allow the browser to register the "Prep" position, then animate "In"
        requestAnimationFrame(() => {
            setTimeout(() => {
                img.classList.remove(prepClass);
                // Image will now naturally transition back to scale(1) and opacity 1
            }, 20);
        });

    }, 350); 
}
// --- EVENT LISTENERS SETUP ---

function setupEventListeners() {
    //Installment tracker total amount gallery
    // 1. Arrow Key Support
document.addEventListener('keydown', (e) => {
    if (elements.receiptModal.classList.contains('hidden')) return;
    
    if (e.key === 'ArrowRight') nextGalleryImage();
    if (e.key === 'ArrowLeft') prevGalleryImage();
    if (e.key === 'Escape') elements.receiptModal.classList.add('hidden');
});

// 2. Click Listeners for Buttons
document.getElementById('nextReceiptBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    nextGalleryImage();
});
document.getElementById('prevReceiptBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    prevGalleryImage();
});

// 3. Mobile Swipe Support
elements.receiptModal.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
}, {passive: true});

elements.receiptModal.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipe();
}, {passive: true});

function handleSwipe() {
    const swipeThreshold = 50;
    if (touchEndX < touchStartX - swipeThreshold) {
        nextGalleryImage(); // Swiped Left
    }
    if (touchEndX > touchStartX + swipeThreshold) {
        prevGalleryImage(); // Swiped Right
    }
}
     // EXISTING BUTTONS
    
    if (elements.addIncomeBtn) elements.addIncomeBtn.addEventListener('click', () => showInputSelectionModal('income'));
    if (elements.addExpenseBtn) elements.addExpenseBtn.addEventListener('click', () => showInputSelectionModal('expense'));
    
    // NEW INITIALIZATION LOGIC (Wrapped in checks so it doesn't break Finance Mode)
    if (elements.initTotalAmount) {
        elements.initTotalAmount.addEventListener('input', () => {
            const val = parseFloat(elements.initTotalAmount.value) || 0;
            elements.initAmountWords.textContent = numberToWords(val);
        });
    }

    if (elements.initReceipt) {
    elements.initReceipt.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        
        for (const file of files) {
            const base64 = await readFileAsDataURL(file);
            tempInitReceipts.push(base64);
        }
        renderInitReceiptPreviews();
        elements.initReceipt.value = ""; // Clear input to allow re-selection
    });
}
function renderInitReceiptPreviews() {
    elements.initReceiptPreviewContainer.innerHTML = '';
    if (tempInitReceipts.length > 0) {
        elements.initReceiptPreviewContainer.classList.remove('hidden');
        tempInitReceipts.forEach((src, index) => {
            const div = document.createElement('div');
            div.className = 'receipt-preview-item';
            div.innerHTML = `
                <img src="${src}" class="shadow-sm">
                <div class="remove-receipt-badge" onclick="removeTempInitReceipt(${index})">&times;</div>
            `;
            elements.initReceiptPreviewContainer.appendChild(div);
        });
    } else {
        elements.initReceiptPreviewContainer.classList.add('hidden');
    }
}

// Global window function for the "x" click
window.removeTempInitReceipt = (index) => {
    tempInitReceipts.splice(index, 1);
    renderInitReceiptPreviews();
};

    if (elements.btnSaveInitialization) {
        elements.btnSaveInitialization.addEventListener('click', handleProjectSetup);
    }

    // --- Initial Setup Receipt Logic ---
    if (elements.removeInitReceiptBtn) {
        elements.removeInitReceiptBtn.addEventListener('click', () => {
            elements.initReceipt.value = null;
            elements.initReceiptPreviewContainer.classList.add('hidden');
        });
    }

    // --- Navigation Buttons (Move these OUTSIDE any 'if' blocks) ---
    if (elements.settingsFromMain) {
        elements.settingsFromMain.addEventListener('click', () => showPage('settings'));
    }

    // --- PROJECT AGREEMENT MODAL CLOSE LOGIC (Move this OUTSIDE) ---
    if (elements.closeProjectDetailsBtn) {
        elements.closeProjectDetailsBtn.onclick = () => {
            console.log("Closing Project Modal");
            elements.projectDetailsModal.classList.add('hidden');
            document.body.style.overflow = 'auto';
        };
    }

    // Close modal when clicking on the dark background
    if (elements.projectDetailsModal) {
        elements.projectDetailsModal.addEventListener('click', (e) => {
            if (e.target === elements.projectDetailsModal || e.target.classList.contains('min-h-screen')) {
                elements.projectDetailsModal.classList.add('hidden');
                document.body.style.overflow = 'auto';
            }
        });
    }
    

// FIX: Ensure the Enlarge Modal (Black background) close button works too
if (elements.closeReceiptModalBtn) {
    elements.closeReceiptModalBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        elements.receiptModal.classList.add('hidden');
        elements.receiptModal.style.display = 'none';
    });
}

// Also close if clicking the black background of the receipt viewer
if (elements.receiptModal) {
    elements.receiptModal.addEventListener('click', (e) => {
        if (e.target === elements.receiptModal) {
            elements.receiptModal.classList.add('hidden');
            elements.receiptModal.style.display = 'none';
        }
    });
}
    // Basic Installment Form listeners
    elements.updateRecordBtn.addEventListener('click', handleUpdateRecord);
    elements.cancelEditBtn.addEventListener('click', clearForm);
    elements.viewHistoryBtn.addEventListener('click', () => showPage('history'));
    elements.exportDataBtn.addEventListener('click', exportData);
    elements.deleteRecordsBtn.addEventListener('click', confirmDeleteRecords);
    elements.paymentForm.onsubmit = (e) => { 
        e.preventDefault(); 
        // If the "Edit" buttons are hidden, we are adding a new record
        if (elements.formActionsEdit.classList.contains('hidden')) {
            processFormSubmission('income'); 
        }
    };
    
    // Recipt for Installment mode
     elements.installmentReceipt.addEventListener('change', handleInstallmentReceiptPreview);
    elements.removeInstallmentReceiptBtn.addEventListener('click', removeInstallmentReceiptPreview);

    // Installment Inputs
    elements.totalCost.addEventListener('input', updateTotalCostWords);
    elements.paymentAmount.addEventListener('input', updatePaymentAmountWords);
    elements.paymentMethod.addEventListener('change', handlePaymentMethodChange);
    elements.bankName.addEventListener('change', handleBankNameChange);

    // Finance Mode
    elements.addIncomeBtn.addEventListener('click', () => showInputSelectionModal('income'));
    elements.addExpenseBtn.addEventListener('click', () => showInputSelectionModal('expense'));

    // Input Type Selection Modal
    if (elements.closeSelectionModalBtn) {
        elements.closeSelectionModalBtn.addEventListener('click', () => {
            elements.inputTypeSelectionModal.classList.add('hidden');
        });
    }

    if (elements.btnSelectManual) {
        elements.btnSelectManual.addEventListener('click', () => {
            elements.inputTypeSelectionModal.classList.add('hidden');
            openTransactionModal(pendingTransactionType);
        });
    }

    if (elements.btnSelectImage) {
        elements.btnSelectImage.addEventListener('click', () => {
            elements.globalImagePicker.value = ''; // Reset input
            elements.globalImagePicker.click(); // Open Device File Picker/Gallery
        });
    }

    // --- GEMINI AI IMAGE SCANNING ---
    if (elements.globalImagePicker) {
        elements.globalImagePicker.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                // UI Updates
                elements.inputTypeSelectionModal.classList.add('hidden');
                if (elements.ocrLoadingOverlay) {
                    elements.ocrLoadingOverlay.classList.remove('hidden');
                    if(elements.ocrStatusText) elements.ocrStatusText.textContent = "AI is analyzing image...";
                }

                try {
                    // Prepare Image
                    const base64Data = await fileToGenerativePart(file);
                    
                    // Call API
                    const extractedData = await analyzeWithGemini(base64Data, file.type);

                    // --- POPULATE FORM ---
                    openTransactionModal(pendingTransactionType); // 'income' or 'expense'

                    // 1. Amount
                    if (extractedData.amount) {
                        elements.modalAmount.value = extractedData.amount;
                        if(typeof updateModalAmountWords === 'function') updateModalAmountWords();
                        
                        // Visual Flash Effect
                        elements.modalAmount.style.backgroundColor = "#d1fae5";
                        setTimeout(() => elements.modalAmount.style.backgroundColor = "", 1500);
                    }

                    // 2. Date
                    if (extractedData.date) {
                        elements.modalDate.value = extractedData.date;
                    }

                    // 3. Description (Merchant + Summary)
                    if (extractedData.merchant) {
                        let desc = extractedData.merchant;
                        if (extractedData.description) desc += ` - ${extractedData.description}`;
                        elements.modalDescription.value = desc;
                    }

                    // 4. Category (Smart Selection)
                    if (extractedData.category) {
                        // Try to find matching option in dropdown
                        let options = Array.from(elements.modalCategory.options);
                        let match = options.find(opt => opt.value.toLowerCase() === extractedData.category.toLowerCase());
                        
                        if (match) {
                            elements.modalCategory.value = match.value;
                        } else {
                            // If category doesn't exist, set to custom
                            elements.modalCategory.value = 'custom';
                            elements.modalCustomCategoryName.value = extractedData.category;
                            if(typeof handleModalCategoryChange === 'function') handleModalCategoryChange();
                        }
                    }

                    // 5. Payment Method
                    if (extractedData.paymentMethod) {
                        const method = extractedData.paymentMethod.toLowerCase().includes('cash') ? 'cash' : 'bank';
                        elements.modalPaymentMethod.value = method;
                        if(typeof handleModalPaymentMethodChange === 'function') handleModalPaymentMethodChange();
                    }

                    // 6. Attach Receipt Image Preview
                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(file);
                    elements.modalReceipt.files = dataTransfer.files;
                    if(typeof handleReceiptPreview === 'function') handleReceiptPreview();

                    // Success UI
                    if (elements.ocrLoadingOverlay) elements.ocrLoadingOverlay.classList.add('hidden');
                    showNotification('AI Analysis Complete!', 'success');

                } catch (err) {
                    console.error("Analysis Failed:", err);
                    if (elements.ocrLoadingOverlay) elements.ocrLoadingOverlay.classList.add('hidden');
                    showNotification('Analysis failed. Please fill details manually.', 'error');
                    
                    // Still open modal so user can fill manually
                    openTransactionModal(pendingTransactionType);
                }
            }
        });
    }

    // Nav and Actions
    elements.viewHistoryBtnFinance.addEventListener('click', () => showPage('history'));
    elements.deleteAllBtnFinance.addEventListener('click', confirmDeleteRecords);
    elements.viewChartBtn.addEventListener('click', () => showPage('yearlyChart'));
    elements.exportExcelBtn.addEventListener('click', exportToExcel);
    elements.shareBtn.addEventListener('click', shareFinancialSummary);
    elements.closeTransactionModalBtn.addEventListener('click', () => elements.transactionModal.classList.add('hidden'));

    elements.modalTransactionForm.addEventListener('submit', (e) => handleModalTransactionSubmit(e, false));
    elements.makeShortcutBtn.addEventListener('click', (e) => handleModalTransactionSubmit(e, true));

    elements.modalPaymentMethod.addEventListener('change', handleModalPaymentMethodChange);
    elements.modalBankName.addEventListener('change', handleModalBankNameChange);
    elements.modalCategory.addEventListener('change', handleModalCategoryChange);

    elements.speakAmountBtn.addEventListener('click', speakAmount);
    elements.modalAmount.addEventListener('input', () => {
        updateModalAmountWords();
        const amount = elements.modalAmount.value;
        elements.speakAmountBtn.classList.toggle('hidden', !(amount && parseFloat(amount) > 0));
    });

    elements.modalReceipt.addEventListener('change', handleReceiptPreview);
    elements.removeReceiptBtn.addEventListener('click', removeReceiptPreview);
    elements.closeReceiptModalBtn.addEventListener('click', () => elements.receiptModal.classList.add('hidden'));

    elements.cancelDeleteAllBtn.addEventListener('click', () => elements.deleteAllPasswordModal.classList.add('hidden'));
    elements.confirmDeleteAllBtn.addEventListener('click', handleDeleteAllWithPassword);

    // Navigation Buttons
    elements.settingsFromMain.addEventListener('click', () => showPage('settings'));
    elements.backToMainBtn.addEventListener('click', () => showPage('main'));
    elements.backToHistoryBtn.addEventListener('click', () => showPage('history'));
    elements.settingsFromHistory.addEventListener('click', () => showPage('settings'));
    elements.goToTrackerBtn.addEventListener('click', () => showPage('main'));
    elements.backToMainFromSettings.addEventListener('click', () => showPage('main'));
    elements.backToMainFromYearly.addEventListener('click', () => showPage('main'));
    elements.backToYearly.addEventListener('click', () => showPage('yearlyChart'));
    elements.backToMainFromCard.addEventListener('click', () => showPage('main'));
    elements.backToMainFromShortcuts.addEventListener('click', () => showPage('main'));
    elements.backToShortcutsBtn.addEventListener('click', () => showPage('shortcuts'));

    // Filters & Search
    elements.searchInput.addEventListener('input', filterPayments);
    elements.methodFilter.addEventListener('change', filterPayments);
    elements.dateFilter.addEventListener('change', filterPayments);

    // Settings Toggles
    elements.expenseModeToggle.addEventListener('change', handleExpenseModeToggle);
    elements.dynamicColorToggle.addEventListener('change', handleDynamicColorToggle);

    // Visibility
    elements.toggleVisibilityBtn.addEventListener('click', toggleVisibility);
    elements.totalAmountDisplay.addEventListener('click', () => { if (!isBalanceVisible) toggleVisibility(); });
    elements.paidAmountDisplay.addEventListener('click', () => { if (!isBalanceVisible) toggleVisibility(); });
    elements.pendingAmountDisplay.addEventListener('click', () => { if (!isBalanceVisible) toggleVisibility(); });

    // Card View
    elements.viewCardBtn.addEventListener('click', () => showPage('card'));
    elements.viewCardBtnInstallment.addEventListener('click', () => showPage('card'));

    // Shortcuts & Auto
    elements.shortcutTransactionsBtn.addEventListener('click', () => showPage('shortcuts'));
    elements.shortcutListContainer.addEventListener('click', handleShortcutListClick);
    elements.shortcutSearchInput.addEventListener('input', () => renderShortcutsPage());

    elements.autoTransactionForm.addEventListener('submit', handleSaveAutoSchedule);
    elements.cancelAutoBtn.addEventListener('click', () => elements.autoTransactionModal.classList.add('hidden'));
    elements.autoFrequency.addEventListener('change', (e) => {
        const frequency = e.target.value;
        elements.autoDayOfWeekContainer.classList.toggle('hidden', frequency !== 'weekly');
        elements.autoDayOfMonthContainer.classList.toggle('hidden', frequency !== 'monthly');
    });
    elements.viewAutoTransactionsBtn.addEventListener('click', () => showPage('autoTransactionsList'));

    // 3D Card Effect
    if (elements.projectCardDisplay) {
        elements.projectCardDisplay.addEventListener('mousemove', (e) => {
            const card = elements.projectCardDisplay;
            const { left, top, width, height } = card.getBoundingClientRect();
            const x = e.clientX - left;
            const y = e.clientY - top;
            const rotateX = -1 * ((y - height / 2) / (height / 2)) * 8;
            const rotateY = ((x - width / 2) / (width / 2)) * 8;
            card.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
            card.style.setProperty('--x', `${(x / width) * 100}%`);
            card.style.setProperty('--y', `${(y / height) * 100}%`);
        });
        elements.projectCardDisplay.addEventListener('mouseleave', () => {
            elements.projectCardDisplay.style.transform = 'rotateX(0) rotateY(0)';
        });
    }

    // Logo double-click listeners
    const logos = [
        document.getElementById('mainPageDesktopLogo'),
        document.getElementById('mainPageMobileLogo'),
        document.getElementById('historyPageDesktopLogo'),
        document.getElementById('historyPageMobileLogo'),
        document.getElementById('settingsPageDesktopLogo'),
        document.getElementById('settingsPageMobileLogo')
    ];

    const toggleLogo = (logo) => { if (logo) logo.classList.toggle('logo-enlarged'); };
    logos.forEach(logo => { if (logo) logo.addEventListener('dblclick', () => toggleLogo(logo)); });
// --- NEW VIEW TOGGLING LOGIC ---

// 1. Show Total Amount View
elements.btnOpenTotalAmount.addEventListener('click', () => {
    elements.totalAmountInputArea.classList.remove('hidden');
    elements.actualInstallmentForm.classList.add('hidden');
    
    // Pre-fill the input with current total
    elements.inputTotalProjectCost.value = appState.totalAmount;
    
    // Visual Tab Styling
    elements.btnOpenTotalAmount.classList.add('border-green-600', 'bg-green-100');
    elements.btnOpenInstallmentForm.classList.remove('border-blue-600', 'bg-blue-100');
});

// 2. Show Add Payment Form View
elements.btnOpenInstallmentForm.addEventListener('click', () => {
    elements.actualInstallmentForm.classList.remove('hidden');
    elements.totalAmountInputArea.classList.add('hidden');
    
    // Visual Tab Styling
    elements.btnOpenInstallmentForm.classList.add('border-blue-600', 'bg-blue-100');
    elements.btnOpenTotalAmount.classList.remove('border-green-600', 'bg-green-100');
});

// 3. Save Logic for the "Add Total Amount" section
elements.btnSaveTotalAmount.addEventListener('click', (e) => {
    e.preventDefault(); // Stop the form from submitting
    const newTotal = parseFloat(elements.inputTotalProjectCost.value);
    
    if (isNaN(newTotal) || newTotal <= 0) {
        showNotification("Please enter a valid positive number.", "error");
        return;
    }

    if (newTotal < appState.paidAmount) {
        showNotification("Total cost cannot be less than what you've already paid.", "error");
        return;
    }

    // Update App State
    appState.totalAmount = newTotal;
    
    // Save and Update UI
    recalculateTotals();
    saveData();
    updateSummary();
    
    showNotification("Total Project Cost updated successfully!", "success");
    elements.totalAmountInputArea.classList.add('hidden');
    elements.btnOpenTotalAmount.classList.remove('border-green-600', 'bg-green-100');

     // Trigger Project Details on Double Click
    if (elements.projectSetupSection) {
        elements.projectSetupSection.addEventListener('dblclick', openProjectDetails);
        // Add a tooltip so users know they can dblclick
        elements.projectSetupSection.title = "Double-click to view Agreement/Setup details";
    }

    
    

   


});
}

// --- UTILITIES ---

function showInputSelectionModal(type) {
    pendingTransactionType = type; // 'income' or 'expense'
    if (elements.inputTypeSelectionModal) {
        // Update the modal title to match the action
        const title = elements.inputTypeSelectionModal.querySelector('h3');
        if (title) title.textContent = type === 'income' ? 'Add Income' : 'Add Expense';
        
        elements.inputTypeSelectionModal.classList.remove('hidden');
    } else {
        // Fallback: If selection modal is missing, open manual modal directly
        openTransactionModal(type);
    }
}

function setTodayDate() {
    const today = new Date().toISOString().split('T')[0];
    elements.paymentDate.value = today;
    elements.modalDate.value = today;
}

function showPage(page) {
    // 1. Hide the Main Page containers
    elements.installmentModeFormContainer.classList.add('hidden');
    elements.expenseModeActionsContainer.classList.add('hidden');

    // 2. Hide ALL page sections
    document.querySelectorAll('.page').forEach(p => {
        p.classList.remove('active');
        p.style.display = 'none'; // Force hide everything
    });

    // 3. Mapping pages to IDs
    const pageMap = { 
        main: elements.mainPage, 
        history: elements.historyPage, 
        settings: elements.settingsPage, 
        detail: elements.detailPage, 
        yearlyChart: elements.yearlyChartPage, 
        monthlyChart: elements.monthlyChartPage, 
        card: elements.cardPage, 
        shortcuts: elements.shortcutTransactionsPage, // <--- Ensure this is correct
        autoTransactionsList: elements.autoTransactionsListPage 
    };

    // 4. Show the requested page
    const activePage = pageMap[page];
    if (activePage) {
        activePage.classList.add('active');
        activePage.style.display = 'block'; // Force show with display block
        currentPage = page;
        
        // 5. Run specific setup for the page
        if (page === 'main') updateUIMode();
        if (page === 'history') renderHistoryPage();
        if (page === 'card') renderCardPage();
        if (page === 'shortcuts') renderShortcutsPage(); // <--- This loads your shortcuts
        if (page === 'yearlyChart') renderYearlyCharts();
    }
}

function showStorageStatus() {
    if (typeof (Storage) === "undefined") showNotification('Warning: Data will not persist between sessions', 'error');
}

function numberToWords(num) {
    if(typeof window.getLanguage !== 'function') return num.toString();
    const lang = window.getLanguage();
    if (lang === 'es') return numberToWords_es(num);
    if (lang === 'ur') return numberToWords_ur(num);
    return numberToWords_en(num);
}

function numberToWords_en(num) {
    let currencyName;
    switch (globalSettings.currency || 'USD') {
        case 'PKR': case 'INR': currencyName = getTranslatedString('rupees'); break;
        case 'USD': currencyName = getTranslatedString('dollars'); break;
        case 'EUR': currencyName = getTranslatedString('euros'); break;
        case 'GBP': currencyName = getTranslatedString('pounds'); break;
        case 'JPY': currencyName = getTranslatedString('yen'); break;
        default: currencyName = '';
    }
    if (num === 0) return 'Zero';
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    function convertGroup(n) {
        let result = '';
        if (n >= 100) { result += ones[Math.floor(n / 100)] + ' Hundred '; n %= 100; }
        if (n >= 20) { result += tens[Math.floor(n / 10)] + ' '; n %= 10; }
        else if (n >= 10) { return result + teens[n - 10] + ' '; }
        if (n > 0) { result += ones[n] + ' '; }
        return result;
    }
    let result = '';
    if (num >= 10000000 && ['PKR', 'INR'].includes(globalSettings.currency)) { result += convertGroup(Math.floor(num / 10000000)) + 'Crore '; num %= 10000000; }
    if (num >= 100000 && ['PKR', 'INR'].includes(globalSettings.currency)) { result += convertGroup(Math.floor(num / 100000)) + 'Lakh '; num %= 100000; }
    if (num >= 1000000 && !['PKR', 'INR'].includes(globalSettings.currency)) { result += convertGroup(Math.floor(num / 1000000)) + 'Million '; num %= 1000000; }
    if (num >= 1000) { result += convertGroup(Math.floor(num / 1000)) + 'Thousand '; num %= 1000; }
    if (num > 0) { result += convertGroup(num); }
    return result.trim() + ' ' + currencyName;
}

function numberToWords_es(n) {
    if (n === 0) return 'cero';
    const unidades = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
    const especiales = ['diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve'];
    const decenas = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
    const centenas = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

    function convert(n) {
        if (n < 10) return unidades[n];
        if (n < 20) return especiales[n - 10];
        if (n < 30) return 'veinti' + unidades[n % 10];
        if (n < 100) return decenas[Math.floor(n / 10)] + (n % 10 > 0 ? ' y ' + unidades[n % 10] : '');
        if (n < 1000) return (n === 100 ? 'cien' : centenas[Math.floor(n / 100)]) + ' ' + (n % 100 > 0 ? convert(n % 100) : '');
        if (n < 1000000) return (n < 2000 ? 'mil' : convert(Math.floor(n / 1000)) + ' mil') + ' ' + (n % 1000 > 0 ? convert(n % 1000) : '');
        if (n < 2000000) return 'un millón ' + (n % 1000000 > 0 ? convert(n % 1000000) : '');
        return convert(Math.floor(n / 1000000)) + ' millones ' + (n % 1000000 > 0 ? convert(n % 1000000) : '');
    }
    return convert(n).replace(/\s+/g, ' ').trim();
}

function numberToWords_ur(num) {
    if (num === 0) return 'صفر';
    const units = ['', 'ایک', 'دو', 'تین', 'چار', 'پانچ', 'چھ', 'سات', 'آٹھ', 'نو'];
    const teens = ['دس', 'گیارہ', 'بارہ', 'تیرہ', 'چودہ', 'پندرہ', 'سولہ', 'سترہ', 'اٹھارہ', 'انیس'];
    const tens = ['', '', 'بیس', 'تیس', 'چالیس', 'پچاس', 'ساٹھ', 'ستر', 'اسی', 'نوے'];
    let result = '';
    function convert(n) {
        if (n < 10) return units[n];
        if (n < 20) return teens[n - 10];
        return tens[Math.floor(n / 10)] + ' ' + units[n % 10];
    }
    if (num >= 10000000) { result += convert(Math.floor(num / 10000000)) + ' کروڑ '; num %= 10000000; }
    if (num >= 100000) { result += convert(Math.floor(num / 100000)) + ' لاکھ '; num %= 100000; }
    if (num >= 1000) { result += convert(Math.floor(num / 1000)) + ' ہزار '; num %= 1000; }
    if (num >= 100) { result += units[Math.floor(num / 100)] + ' سو '; num %= 100; }
    if (num > 0) { result += convert(num); }
    return result.trim().replace(/\s+/g, ' ');
}


function updateTotalCostWords() {
    const value = parseFloat(elements.totalCost.value) || 0;
    elements.totalCostWords.textContent = numberToWords(value);
}

function updatePaymentAmountWords() {
    const value = parseFloat(elements.paymentAmount.value) || 0;
    elements.paymentAmountWords.textContent = numberToWords(value);
}

function updateModalAmountWords() {
    const value = parseFloat(elements.modalAmount.value) || 0;
    elements.modalAmountWords.textContent = numberToWords(value);
}

function formatNumber(num) {
    return new Intl.NumberFormat().format(num);
}

function formatCurrency(num) {
    const symbol = globalSettings.currencySymbol || '$';
    return `${symbol} ${formatNumber(num)}`;
}

function showNotification(message, type = 'success', undoCallback = null) {
    if (undoTimeoutId) {
        clearTimeout(undoTimeoutId);
        undoTimeoutId = null;
    }
    elements.notification.innerHTML = '';
    const messageSpan = document.createElement('span');
    messageSpan.innerHTML = message;
    elements.notification.appendChild(messageSpan);
    elements.notification.className = `notification ${type}`;

    if (undoCallback) {
        const undoButton = document.createElement('button');
        undoButton.textContent = 'Undo';
        undoButton.className = 'ml-4 font-bold underline';
        undoButton.onclick = () => {
            undoCallback();
            elements.notification.classList.remove('show');
            clearTimeout(undoTimeoutId);
            undoTimeoutId = null;
        };
        elements.notification.appendChild(undoButton);

        undoTimeoutId = setTimeout(() => {
            undoCache = null;
            undoTimeoutId = null;
            elements.notification.classList.remove('show');
        }, 7000);
    } else {
        setTimeout(() => {
            elements.notification.classList.remove('show');
        }, 3000);
    }
    elements.notification.classList.add('show');
}

function handleExpenseModeToggle() {
    saveData();
    currentSettings.expenseMode = elements.expenseModeToggle.checked;
    saveSettings();
    loadInitialData();
    const mode = getTranslatedString(currentSettings.expenseMode ? 'financeTracker' : 'installmentTracker');
    showNotification(`Switched to ${mode}.`, 'success');
}

function updateUIMode() {
    const isExpenseMode = currentSettings.expenseMode;
    const body = document.body;
    
    // Standard Mode Toggles
    body.classList.toggle('finance-mode-on', isExpenseMode);
    elements.installmentModeFormContainer.classList.toggle('hidden', isExpenseMode);
    elements.expenseModeActionsContainer.classList.toggle('hidden', !isExpenseMode);

    // LOGIC FOR INSTALLMENT TRACKER MODE
    if (!isExpenseMode) {
        // A project is considered "new" if totalAmount is 0
        const isProjectNew = appState.totalAmount === 0;

        // Toggle visibility between Setup Form and Standard Form
        elements.projectInitializationForm.classList.toggle('hidden', !isProjectNew);
        elements.standardInstallmentForm.classList.toggle('hidden', isProjectNew);

        if (isProjectNew) {
            // Set default date to today for the setup form
            elements.initDate.value = new Date().toISOString().split('T')[0];
        }
    } 
    // 1. Toggle Layout Class
    if (isExpenseMode) {
        body.classList.add('finance-mode-on');
    } else {
        body.classList.remove('finance-mode-on');
    }

    // 2. Toggle Mode Containers
    elements.installmentModeFormContainer.classList.toggle('hidden', isExpenseMode);
    elements.expenseModeActionsContainer.classList.toggle('hidden', !isExpenseMode);

    // 3. Header & Logo injection
    const logoSrc = "Paytrack-icon.png";
    // Inside your updateUIMode function in paytrack.js
const logoHTML = `<img src="${logoSrc}" class="header-icon" height="50" width="50" style="display:inline-block; vertical-align:middle; border-radius:50%; background:white; padding:4px;"/>`;

    if (isExpenseMode) {
        // Finance Header
        elements.mainHeaderText.innerHTML = `${logoHTML} <span>Income & Expense Tracker</span>`;
        elements.projectNameHeader.textContent = `Project: ${appState.projectName}`;
        elements.projectNameHeader.classList.remove('hidden');
        elements.headerSubtext.textContent = "Track your income and expenses with ease";

        // Card Labels (Matching Screenshot)
        elements.summaryCard1Label.textContent = "Current Balance";
        elements.summaryCard2Label.textContent = "Total Income";
        elements.summaryCard3Label.textContent = "Total Expenses";
        elements.progressTitle.textContent = "Balance Progress (% of Income Remaining)";
    } else {
        // Installment Header
        elements.mainHeaderText.innerHTML = `${logoHTML} <span>Installment Payment Tracker</span>`;
        elements.projectNameHeader.classList.add('hidden');
        elements.headerSubtext.textContent = "Track your payments with ease and precision";

        // Reset Labels
        elements.summaryCard1Label.textContent = "Total Amount";
        elements.summaryCard2Label.textContent = "Paid Amount";
        elements.summaryCard3Label.textContent = "Pending Amount";
        elements.progressTitle.textContent = "Payment Progress";
    }

    // Update data
    updateSummary();
    updateVisibilityUI();
    updateTotalCostFieldBehavior();
}


function setTheme(themeName) {
    currentSettings.theme = themeName;
    saveSettings();
    applyTheme(themeName);
    updateSettingsUI();
}

function applyTheme(themeName) {
    elements.body.className = `min-h-screen theme-${themeName}`;
    updateTotalCostFieldBehavior();
}

function handleDynamicColorToggle() {
    currentSettings.dynamicProgressBar = elements.dynamicColorToggle.checked;
    saveSettings();
    updateProgressBarDisplay();
    toggleManualColorSelector();
}

function toggleManualColorSelector() {
    // Now it ONLY disables if "Dynamic Color" is turned ON. 
    // It will stay active in Finance mode.
    const isDisabled = currentSettings.dynamicProgressBar; 
    elements.manualColorSelector.style.opacity = isDisabled ? '0.5' : '1';
    elements.manualColorSelector.style.pointerEvents = isDisabled ? 'none' : 'auto';
}

function updateSettingsUI() {
    // 1. Theme Selection Highlight
    document.querySelectorAll('.theme-option').forEach(o => {
        o.classList.toggle('selected', o.dataset.theme === currentSettings.theme);
    });

    // 2. Toggle Switches
    elements.expenseModeToggle.checked = currentSettings.expenseMode;
    elements.dynamicColorToggle.checked = currentSettings.dynamicProgressBar;
    
    // 3. Manual Color Selector Visibility
    toggleManualColorSelector();

    // 4. --- ADD THIS: Progress Bar Color Highlight ---
    document.querySelectorAll('.color-option').forEach(button => {
        if (button.dataset.color === currentSettings.progressBarColor) {
            button.classList.add('selected');
        } else {
            button.classList.remove('selected');
        }
    });
}

function setProgressBarColor(color) {
    // 1. Update the setting
    currentSettings.progressBarColor = color;
    
    // 2. Automatically turn off "Dynamic Color" so the manual color shows up
    currentSettings.dynamicProgressBar = false;
    if (elements.dynamicColorToggle) elements.dynamicColorToggle.checked = false;

    // 3. Save the settings and update the Progress Bar
    saveSettings();
    updateProgressBarDisplay();
    updateSettingsUI(); // This highlights the button you just clicked
    
    showNotification(`Progress bar color changed to ${color}`, 'success');
}

function updateProgressBarDisplay() {
    let progress = 0;
    let color = 'green'; // Default

    if (currentSettings.expenseMode) {
        // Finance Mode Math: (Income - Expenses) / Income
        const income = appState.paidAmount || 0;
        const expenses = appState.pendingAmount || 0;
        
        if (income > 0) {
            progress = ((income - expenses) / income) * 100;
        } else {
            progress = 0; // 0% if no income added yet
        }
    } else {
        // Installment Mode Math: Paid / Total
        progress = appState.totalAmount > 0 ? (appState.paidAmount / appState.totalAmount) * 100 : 0;
    }

    // --- COLOR DECISION ---
    if (currentSettings.dynamicProgressBar) {
        // Dynamic ON: Logic stays the same
        if (progress <= 25) color = 'red';
        else if (progress <= 50) color = 'yellow';
        else if (progress <= 75) color = 'blue';
        else color = 'green';
    } else {
        // MANUAL ON: Use the color selected in settings
        // This line now works for BOTH modes
        color = currentSettings.progressBarColor || 'green';
    }

    const clampedProgress = Math.min(100, Math.max(0, progress));
    elements.progressBar.style.width = `${clampedProgress}%`;
    elements.progressPercentage.textContent = `${Math.round(clampedProgress)}%`;
    
    applyProgressBarStyles(color);
}

function applyProgressBarStyles(color) {
    const colors = {
        green: { from: 'from-green-400', to: 'to-green-600', glow: 'rgba(34, 197, 94, 0.3)' },
        blue: { from: 'from-blue-400', to: 'to-blue-600', glow: 'rgba(59, 130, 246, 0.3)' },
        red: { from: 'from-red-400', to: 'to-red-600', glow: 'rgba(239, 68, 68, 0.3)' },
        yellow: { from: 'from-yellow-400', to: 'to-yellow-600', glow: 'rgba(234, 179, 8, 0.3)' }
    };
    const selectedColor = colors[color] || colors.green;
    elements.progressBar.classList.remove(...Object.values(colors).flatMap(c => [c.from, c.to]));
    elements.progressBar.classList.add(selectedColor.from, selectedColor.to);
    elements.progressBar.style.boxShadow = `0 0 20px ${selectedColor.glow}`;
}

function handlePaymentMethodChange() {
    elements.bankDropdownContainer.classList.toggle('show', elements.paymentMethod.value === 'bank');
    if (elements.paymentMethod.value !== 'bank') elements.customBankContainer.classList.remove('show');
}

function handleBankNameChange() {
    elements.customBankContainer.classList.toggle('show', elements.bankName.value === 'custom');
    if (elements.bankName.value === 'custom') elements.customBankName.focus();
}

function addCustomBankToList(bankName) {
    if (!currentSettings.customBanks.includes(bankName)) {
        currentSettings.customBanks.push(bankName);
        saveSettings();
        loadCustomBanks();
    }
}

function loadCustomBanks() {
    const bankDropdowns = [elements.bankName, elements.modalBankName];
    bankDropdowns.forEach(dropdown => {
        if (!dropdown) return;
        const fragment = document.createDocumentFragment();
        const existingOptions = Array.from(dropdown.options);

        existingOptions.forEach(opt => {
            if (!opt.classList.contains('custom-bank')) {
                fragment.appendChild(opt.cloneNode(true));
            }
        });
        dropdown.innerHTML = '';
        dropdown.appendChild(fragment);

        const customOption = dropdown.querySelector('option[value="custom"]');
        if (currentSettings.customBanks) {
            currentSettings.customBanks.forEach(bank => {
                const newOption = document.createElement('option');
                newOption.value = bank;
                newOption.textContent = bank;
                newOption.classList.add('custom-bank');
                dropdown.insertBefore(newOption, customOption);
            });
        }
    });
}


function validateForm(isInitialSetup = false) {
    const data = {
        projectName: elements.projectName.value.trim(),
        paymentAmount: parseFloat(elements.paymentAmount.value),
        paymentDate: elements.paymentDate.value,
        totalCost: parseFloat(elements.totalCost.value),
        paymentMethod: elements.paymentMethod.value,
        description: elements.paymentDescription.value.trim(),
        bankName: '',
        category: elements.paymentCategory.value,
        receiptFile: elements.installmentReceipt.files[0],
        isReceiptRemoved: elements.installmentReceiptPreviewContainer.classList.contains('hidden') && !elements.installmentReceipt.files[0]
    };
    if (!data.projectName) { showNotification('Please enter a project/item name', 'error'); return null; }

    const amountToValidate = isInitialSetup ? data.totalCost : data.paymentAmount;
    if (isNaN(amountToValidate) || amountToValidate <= 0) {
        const fieldName = isInitialSetup ? 'initial balance' : 'amount';
        showNotification(`Please enter a valid, positive ${fieldName}`, 'error');
        return null;
    }

    if (!data.paymentDate) { showNotification('Please select a payment date', 'error'); return null; }
    if (!data.paymentMethod) { showNotification('Please select a payment method', 'error'); return null; }
    if (data.paymentMethod === 'bank') {
        data.bankName = elements.bankName.value === 'custom' ? elements.customBankName.value.trim() : elements.bankName.value;
        if (!data.bankName) { showNotification('Please select or enter a bank name', 'error'); return null; }
    }
    return data;
}

async function handleProjectSetup() {
    const total = parseFloat(elements.initTotalAmount.value);
    const date = elements.initDate.value;
    const desc = elements.initDescription.value.trim();

    if (isNaN(total) || total <= 0) {
        showNotification("Please enter a valid Total Project Cost.", "error");
        return;
    }
    if (!date) {
        showNotification("Please select the Agreement/Start date.", "error");
        return;
    }

    // 1. Update Core State
    appState.totalAmount = total;
    appState.pendingAmount = total;
    appState.paidAmount = 0;

    // 2. SAVE AS METADATA (Storing the array tempInitReceipts)
    appState.projectMetaData = {
        name: appState.projectName,
        totalCost: total,
        agreementDate: date,
        description: desc || "No description provided.",
        receipts: [...tempInitReceipts] // Changed from 'receipt' to 'receipts'
    };

    saveData();
    tempInitReceipts = []; // Clear temp array
    updateSummary();
    updateUIMode(); 
    showNotification("Project successfully initialized!", "success");
}
function processFormSubmission(forceType) {
    const isFirstExpenseSetup = currentSettings.expenseMode && appState.payments.length === 0 && !elements.editPaymentId.value;

    if (isFirstExpenseSetup) {
        const formData = validateForm(true);
        if (!formData) return;

        appState.projectName = formData.projectName;
        appState.initialBalance = 0;

        appState.payments.push({
            id: Date.now(), projectName: formData.projectName, paymentDate: formData.paymentDate,
            paymentAmount: formData.totalCost,
            description: 'Initial Balance',
            paymentMethod: formData.paymentMethod, bankName: formData.bankName || '-',
            type: 'income',
            paymentTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
        finishTransaction('Tracker started successfully!');
        return;
    }

    const formData = validateForm();
    if (!formData) return;
    const type = currentSettings.expenseMode ? forceType : 'installment';
    addNewRecord(formData, type);
}

function handleUpdateRecord() {
    const editId = parseInt(elements.editPaymentId.value);
    if (!editId) return;
    const formData = validateForm();
    if (!formData) return;
    updateRecord(editId, formData);
}


async function addNewRecord(formData, type, isShortcut = false) {
    let { projectName, paymentAmount, paymentDate, totalCost, paymentMethod, bankName, description, category, receiptFile } = formData;

    if (appState.payments.length === 0 && !currentSettings.expenseMode) {
        if (paymentAmount > totalCost) {
            showNotification('Payment cannot exceed total amount', 'error');
            return;
        }
        appState.projectName = projectName;
        appState.totalAmount = totalCost;
        appState.pendingAmount = totalCost;
    }

    if (projectName && projectName !== appState.projectName) {
        appState.projectName = projectName;
    }

    const epsilon = 0.001;
    if (type === 'installment' && paymentAmount > appState.pendingAmount + epsilon) {
        showNotification('Payment cannot exceed pending amount', 'error');
        return;
    }
    if (type === 'expense' && paymentAmount > appState.totalAmount + epsilon) {
        showNotification('Expense cannot exceed current balance', 'error');
        return;
    }

    if (bankName) {
        const isInstallmentCustom = elements.paymentMethod.value === 'bank' && elements.bankName.value === 'custom';
        const isModalCustom = elements.modalPaymentMethod.value === 'bank' && elements.modalBankName.value === 'custom';
        if (isInstallmentCustom || isModalCustom) {
            addCustomBankToList(bankName);
        }
    }

    let receiptDataURL = null;
    if (receiptFile) {
        receiptDataURL = await readFileAsDataURL(receiptFile);
    }

    appState.payments.push({
        id: Date.now(), projectName: appState.projectName, paymentDate, paymentAmount, paymentMethod,
        description: description || '',
        bankName: bankName || '-', type,
        category: category || 'Uncategorized',
        receipt: receiptDataURL,
        paymentTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
    finishTransaction(getTranslatedString('recordAdded'), isShortcut);
}

async function updateRecord(id, formData, isShortcut = false) {
    const { projectName, paymentAmount, paymentDate, paymentMethod, bankName, description, category, receiptFile, isReceiptRemoved } = formData;
    const recordIndex = appState.payments.findIndex(p => p.id === id);
    if (recordIndex === -1) { showNotification('Error: Record not found', 'error'); return; }

    if (currentSettings.expenseMode && appState.payments[recordIndex].type === 'income' && recordIndex === 0) {
        appState.initialBalance = paymentAmount;
    }

    const originalType = appState.payments[recordIndex].type;
    const updatedRecord = { ...appState.payments[recordIndex], projectName, paymentAmount, paymentDate, paymentMethod, description: description || '', bankName: bankName || '-', type: originalType, category: category || 'Uncategorized' };

    if (receiptFile) {
        updatedRecord.receipt = await readFileAsDataURL(receiptFile);
    } else if (isReceiptRemoved) {
        updatedRecord.receipt = null;
    }

    appState.payments[recordIndex] = updatedRecord;
    finishTransaction(getTranslatedString('recordUpdated'), isShortcut);
}

function finishTransaction(message, isShortcut = false) {
    recalculateTotals();
    saveData();
    updateSummary();
    clearForm();
    if (currentPage === 'detail' && currentDetailId) {
        showTransactionDetail(currentDetailId);
    }
    if (isShortcut) {
        showNotification('Transaction saved and shortcut created!', 'success');
    } else {
        showNotification(message);
    }
    if (!currentSettings.expenseMode && appState.pendingAmount === 0 && appState.totalAmount > 0) showCelebration();
}

function getRecalculatedTotals(state) {
    state.payments.sort((a, b) => new Date(a.paymentDate + ' ' + a.paymentTime) - new Date(b.paymentDate + ' ' + b.paymentTime) || a.id - b.id);
    let tempBalance, tempPending, totalIncome, totalExpenses;
    if (state.expenseMode) {
        let currentBalance = 0;
        totalIncome = state.payments.filter(p => p.type === 'income').reduce((sum, p) => sum + p.paymentAmount, 0);
        totalExpenses = state.payments.filter(p => p.type === 'expense').reduce((sum, p) => sum + p.paymentAmount, 0);
        tempBalance = totalIncome - totalExpenses;

    } else {
        const paid = state.payments.reduce((sum, p) => sum + p.paymentAmount, 0);
        tempPending = state.totalAmount - paid;
    }
    return { tempBalance, tempPending, totalIncome, totalExpenses };
}

function recalculateTotals() {
    const { tempBalance, tempPending, totalIncome, totalExpenses } = getRecalculatedTotals(appState);
    if (currentSettings.expenseMode) {
        appState.paidAmount = totalIncome;
        appState.pendingAmount = totalExpenses;
        appState.totalAmount = tempBalance;
        appState.initialBalance = appState.payments.length > 0 && appState.payments[0].type === 'income' ? appState.payments[0].paymentAmount : 0;

        let runningBalance = 0;
        appState.payments.forEach(p => {
            runningBalance += (p.type === 'income' ? p.paymentAmount : -p.paymentAmount);
            p.remaining = runningBalance;
        });
    } else {
        appState.paidAmount = appState.payments.reduce((sum, p) => sum + p.paymentAmount, 0);
        appState.pendingAmount = appState.totalAmount - appState.paidAmount;
        let currentPending = appState.totalAmount;
        appState.payments.forEach(p => {
            currentPending -= p.paymentAmount;
            p.remaining = currentPending;
        });
    }
}

function updateTotalCostFieldBehavior() {
    const isInstallmentMode = !currentSettings.expenseMode;
    
    // 1. Ensure the fields are populated from the App State
    if (isInstallmentMode) {
        elements.projectName.value = appState.projectName || "";
        elements.totalCost.value = appState.totalAmount || "";
        updateTotalCostWords(); // Refresh the "Amount in words" display
    }

    // 2. Set styling for read-only (since these are changed via Initialization)
    elements.projectName.readOnly = true;
    elements.totalCost.readOnly = true;
    
    const isDark = document.body.classList.contains('theme-dark');
    const readOnlyBg = isDark ? '#1f2937' : '#f3f4f6';
    
    elements.projectName.style.backgroundColor = readOnlyBg;
    elements.totalCost.style.backgroundColor = readOnlyBg;
    
    // Hint to the user that they can double-click this area for info
    elements.projectName.style.cursor = 'help';
    elements.totalCost.style.cursor = 'help';
}


function confirmDeleteRecords() {
    elements.deleteAllPasswordModal.classList.remove('hidden');
    elements.deleteAllPasswordInput.focus();
}

function handleDeleteAllWithPassword() {
    const password = elements.deleteAllPasswordInput.value;
    const correctPassword = localStorage.getItem(DELETE_PASSWORD_KEY) || '7739';

    if (password === correctPassword) {
        deleteAllRecords();
        elements.deleteAllPasswordModal.classList.add('hidden');
        elements.deleteAllPasswordInput.value = '';
        elements.deleteAllPasswordError.classList.add('hidden');
    } else {
        elements.deleteAllPasswordError.classList.remove('hidden');
        elements.deleteAllPasswordInput.value = '';
    }
}

function deleteAllRecords() {
    undoCache = { allRecords: [...appState.payments] };
    const name = appState.projectName;
    appState = getNewState(currentSettings.expenseMode);
    appState.projectName = name;
    saveData();
    updateSummary();
    clearForm();
    showNotification('All records deleted.', 'success', undoDeleteAll);
}

function undoDeleteAll() {
    if (!undoCache || !undoCache.allRecords) return;
    appState.payments = undoCache.allRecords;
    recalculateTotals();
    saveData();
    updateSummary();
    showNotification('Records restored.', 'success');
    undoCache = null;
}

function exportData() {
    if (appState.payments.length === 0) { showNotification('No data to export', 'error'); return; }
    const dataStr = JSON.stringify({ settings: currentSettings, data: appState }, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${appState.projectName.replace(/\s+/g, '_')}-${currentSettings.expenseMode ? 'expense' : 'installment'}-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function showCelebration() {
    elements.celebration.classList.remove('hidden');
    elements.celebrationAudio.play().catch(console.warn);
    setTimeout(() => { elements.celebrationAudio.pause(); elements.celebrationAudio.currentTime = 0; }, 4000);
}

function closeCelebration() {
    elements.celebration.classList.add('hidden');
    elements.celebrationAudio.pause();
    elements.celebrationAudio.currentTime = 0;
}

function deletePayment(id) {
    if (!confirm(getTranslatedString('confirmDeleteTransaction'))) return;

    const recordIndex = appState.payments.findIndex(p => p.id === id);
    if (recordIndex === -1) return;

    appState.payments.splice(recordIndex, 1);
    recalculateTotals();
    saveData();
    updateSummary();
    showNotification('Record deleted.', 'success');
    showPage('history');
}

function editPayment(id) {
    if (!confirm('You are about to edit this transaction. Do you want to continue?')) return;

    const record = appState.payments.find(p => p.id === id);
    if (!record) { showNotification('Record not found', 'error'); return; }

    if (currentSettings.expenseMode) {
        openTransactionModal(record.type, false, record);
    } else {
        showPage('main');
        elements.editPaymentId.value = id;
        elements.projectName.value = record.projectName;
        elements.paymentCategory.value = record.category || 'Installment';
        elements.paymentDate.value = record.paymentDate;
        elements.paymentAmount.value = record.paymentAmount;
        elements.paymentDescription.value = record.description || '';
        elements.paymentMethod.value = record.paymentMethod;
        if (record.paymentMethod === 'bank') {
            handlePaymentMethodChange();
            const isKnownBank = [...elements.bankName.options].some(opt => opt.value === record.bankName);
            if (isKnownBank) { elements.bankName.value = record.bankName; }
            else { elements.bankName.value = 'custom'; elements.customBankName.value = record.bankName; }
            handleBankNameChange();
        } else {
            handlePaymentMethodChange();
        }
        if (record.receipt) {
            elements.installmentReceiptPreview.src = record.receipt;
            elements.installmentReceiptPreviewContainer.classList.remove('hidden');
        } else {
            removeInstallmentReceiptPreview();
        }
        updateUIMode();
        updatePaymentAmountWords();
        elements.paymentAmount.focus();
    }
}


function toggleVisibility() {
    isBalanceVisible = !isBalanceVisible;
    
    // Save the choice locally
    localStorage.setItem(VISIBILITY_KEY, isBalanceVisible); 
    
    updateVisibilityUI();
    
    // Sync this preference to the cloud so other devices see it
    triggerCloudSync(); 
}

function updateVisibilityUI() {
    const amounts = [elements.totalAmountDisplay, elements.paidAmountDisplay, elements.pendingAmountDisplay];
    const words = [elements.totalAmountWords, elements.paidAmountWords, elements.pendingAmountWords];
    const icon = elements.toggleVisibilityBtn.querySelector('i');

    if (isBalanceVisible) {
        amounts.forEach(el => el.classList.remove('amount-hidden'));
        words.forEach(el => el.classList.remove('amount-hidden'));
        icon.className = 'fas fa-eye-slash text-gray-800 dark:text-gray-200';
        elements.toggleVisibilityBtn.title = 'Hide Amounts';
    } else {
        amounts.forEach(el => el.classList.add('amount-hidden'));
        words.forEach(el => el.classList.add('amount-hidden'));
        icon.className = 'fas fa-eye text-gray-500';
        elements.toggleVisibilityBtn.title = 'Show Amounts';
    }
}

function handleReceiptPreview() {
    const file = elements.modalReceipt.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            elements.modalReceiptPreview.src = e.target.result;
            elements.modalReceiptPreviewContainer.classList.remove('hidden');
        }
        reader.readAsDataURL(file);
    } else {
        removeReceiptPreview();
    }
}

function removeReceiptPreview() {
    elements.modalReceipt.value = null;
    elements.modalReceiptPreview.src = '';
    elements.modalReceiptPreviewContainer.classList.add('hidden');
}

function speakAmount() {
    if ('speechSynthesis' in window) {
        const amountValue = elements.modalAmount.value;
        if (amountValue && !isNaN(amountValue)) {
            window.speechSynthesis.cancel();
            const textToSpeak = numberToWords(parseFloat(amountValue));
            const utterance = new SpeechSynthesisUtterance(textToSpeak);
            const lang = getLanguage();

            switch (lang) {
                case 'es': utterance.lang = 'es-ES'; break;
                case 'ur': utterance.lang = 'ur-PK'; break;
                default: utterance.lang = 'en-US';
            }

            utterance.rate = 0.9;
            window.speechSynthesis.speak(utterance);
        }
    } else {
        showNotification('Text-to-speech is not supported by your browser.', 'error');
    }
}

function handleModalPaymentMethodChange() {
    elements.modalBankDropdownContainer.classList.toggle('show', elements.modalPaymentMethod.value === 'bank');
    if (elements.modalPaymentMethod.value !== 'bank') {
        elements.modalCustomBankContainer.classList.remove('show');
    }
}

function handleModalBankNameChange() {
    elements.modalCustomBankContainer.classList.toggle('show', elements.modalBankName.value === 'custom');
    if (elements.modalBankName.value === 'custom') {
        elements.modalCustomBankName.focus();
    }
}

function handleModalCategoryChange() {
    elements.modalCustomCategoryContainer.classList.toggle('show', elements.modalCategory.value === 'custom');
    if (elements.modalCategory.value === 'custom') {
        elements.modalCustomCategoryName.focus();
    }
}

function addCustomCategory(categoryName, type) {
    const categoryKey = type === 'income' ? 'customIncomeCategories' : 'customExpenseCategories';
    if (!currentSettings[categoryKey].includes(categoryName)) {
        currentSettings[categoryKey].push(categoryName);
        saveSettings();
    }
}

function loadCategories(type) {
    const dropdown = elements.modalCategory;
    dropdown.innerHTML = '';

    const defaultCategories = {
        income: ['Salary', 'Freelance', 'Investment', 'Gift', 'Other'],
        expense: ['Food', 'Transport', 'Bills', 'Shopping', 'Health', 'Entertainment', 'Other']
    };

    const customCategories = type === 'income' ? currentSettings.customIncomeCategories : currentSettings.customExpenseCategories;

    defaultCategories[type].forEach(cat => {
        dropdown.add(new Option(cat, cat));
    });

    if (customCategories.length > 0) {
        const optGroup = document.createElement('optgroup');
        optGroup.label = 'Your Categories';
        customCategories.forEach(cat => {
            optGroup.appendChild(new Option(cat, cat));
        });
        dropdown.add(optGroup);
    }

    dropdown.add(new Option('+ Add Custom Category', 'custom'));
}

async function openTransactionModal(type, isInitial = false, record = null) {
    currentTransactionType = type;
    elements.modalTransactionForm.reset();
    removeReceiptPreview();
    setTodayDate();

    loadCategories(type);

    const defaultBanks = `<option value="">${getTranslatedString('chooseBank')}</option><option value="custom">${getTranslatedString('addCustomBank')}</option><option value="Habib Bank Limited">Habib Bank Limited</option><option value="MCB Bank Limited">MCB Bank Limited</option><option value="United Bank Limited">United Bank Limited</option><option value="Allied Bank Limited">Allied Bank Limited</option><option value="Bank Alfalah">Bank Alfalah</option><option value="Faysal Bank">Faysal Bank</option><option value="Standard Chartered Bank">Standard Chartered Bank</option><option value="Meezan Bank">Meezan Bank</option><option value="Bank Islami">Bank Islami</option>`;
    elements.modalBankName.innerHTML = defaultBanks;
    loadCustomBanks();

    const currencySymbol = globalSettings.currencySymbol || '$';
    document.querySelector('label[for="modalAmount"]').textContent = `${getTranslatedString('amount')} (${currencySymbol})`;

    if (isInitial) {
        elements.transactionModalTitle.textContent = 'Setup Initial Balance';
        elements.modalDescription.value = 'Initial Balance';
        elements.modalCategory.value = 'Other';
        elements.saveTransactionBtn.textContent = 'Start Tracking';
    } else if (record) {
        elements.transactionModalTitle.textContent = `${getTranslatedString('editTransaction')} - ${type.charAt(0).toUpperCase() + type.slice(1)}`;
        elements.saveTransactionBtn.textContent = getTranslatedString('updateTransaction');
        elements.modalEditId.value = record.id;
        elements.modalAmount.value = record.amount || record.paymentAmount;
        elements.modalDate.value = record.paymentDate;
        elements.modalDescription.value = record.description;

        const allCategoryOptions = Array.from(elements.modalCategory.options).map(o => o.value);
        if (allCategoryOptions.includes(record.category)) {
            elements.modalCategory.value = record.category;
        } else {
            elements.modalCategory.value = 'custom';
            elements.modalCustomCategoryName.value = record.category;
        }

        elements.modalPaymentMethod.value = record.paymentMethod;

        if (record.paymentMethod === 'bank') {
            const isKnownBank = [...elements.modalBankName.options].some(opt => opt.value === record.bankName);
            if (isKnownBank) {
                elements.modalBankName.value = record.bankName;
            } else if (record.bankName && record.bankName !== '-') {
                elements.modalBankName.value = 'custom';
                elements.modalCustomBankName.value = record.bankName;
            }
        }

        if (record.receipt) {
            elements.modalReceiptPreview.src = record.receipt;
            elements.modalReceiptPreviewContainer.classList.remove('hidden');
        }

    } else {
        elements.transactionModalTitle.textContent = `${getTranslatedString('addTransaction')} - ${type.charAt(0).toUpperCase() + type.slice(1)}`;
        elements.saveTransactionBtn.textContent = getTranslatedString('saveTransaction');
        elements.modalDescription.placeholder = 'e.g., Details about the transaction';
        elements.modalEditId.value = '';
    }

    elements.makeShortcutBtn.classList.toggle('hidden', !!record?.paymentAmount || isInitial);

    updateModalAmountWords();
    handleModalPaymentMethodChange();
    handleModalBankNameChange();
    handleModalCategoryChange();
    elements.speakAmountBtn.classList.toggle('hidden', !(elements.modalAmount.value && parseFloat(elements.modalAmount.value) > 0));

    elements.transactionModal.classList.remove('hidden');
    elements.modalAmount.focus();
}

async function handleModalTransactionSubmit(e, isShortcut = false) {
    e.preventDefault();
    const amount = parseFloat(elements.modalAmount.value);
    const date = elements.modalDate.value;
    const description = elements.modalDescription.value.trim();
    const method = elements.modalPaymentMethod.value;
    const editId = elements.modalEditId.value ? parseInt(elements.modalEditId.value) : null;
    const receiptFile = elements.modalReceipt.files[0];
    const isReceiptRemoved = !elements.modalReceiptPreview.src && !receiptFile;

    if (isNaN(amount) || amount <= 0) { showNotification('Please enter a valid amount.', 'error'); return; }
    if (!date) { showNotification('Please select a date.', 'error'); return; }

    let category = elements.modalCategory.value === 'custom'
        ? elements.modalCustomCategoryName.value.trim()
        : elements.modalCategory.value;
    if (!category) { showNotification('Please select or enter a category.', 'error'); return; }

    if (elements.modalCategory.value === 'custom') {
        addCustomCategory(category, currentTransactionType);
    }

    let bankName = '-';
    if (method === 'bank') {
        bankName = elements.modalBankName.value === 'custom'
            ? elements.modalCustomBankName.value.trim()
            : elements.modalBankName.value;
        if (!bankName) { showNotification('Please select or enter a bank name.', 'error'); return; }
    }

    const isShortcutEdit = !!editId && getShortcuts().some(s => s.id === editId);

    if (isShortcut) {
        const shortcut = {
            id: editId || Date.now(),
            type: currentTransactionType,
            amount,
            description,
            category,
            paymentMethod: method,
            bankName
        };
        let shortcuts = getShortcuts();
        if (isShortcutEdit) {
            const index = shortcuts.findIndex(s => s.id === editId);
            shortcuts[index] = shortcut;
        } else {
            shortcuts.push(shortcut);
        }
        localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(shortcuts));
    }

    const formData = {
        projectName: appState.projectName,
        paymentAmount: amount,
        paymentDate: date,
        paymentMethod: method,
        description: description,
        bankName: bankName,
        category: category,
        receiptFile: receiptFile,
        isReceiptRemoved: isReceiptRemoved
    };

    if (isShortcutEdit) {
        showNotification('Shortcut updated successfully!', 'success');
    } else if (editId) {
        await updateRecord(editId, formData, isShortcut);
    } else {
        if (appState.payments.length === 0 && currentTransactionType === 'expense') {
            showNotification('Cannot add an expense as the first transaction. Please add an income first.', 'error');
            return;
        }
        await addNewRecord(formData, currentTransactionType, isShortcut);
    }

    elements.transactionModal.classList.add('hidden');
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
    });
}

function exportToExcel() {
    if (appState.payments.length === 0) {
        showNotification('No data to export.', 'error');
        return;
    }

    const dataToExport = appState.payments.map(p => ({
        Date: p.paymentDate,
        Description: p.description,
        Category: p.category,
        Type: p.type,
        Amount: p.paymentAmount,
        Method: p.paymentMethod,
        Bank: p.bankName,
        'Balance After': p.remaining
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Transactions");

    worksheet["!cols"] = [{ wch: 12 }, { wch: 30 }, { wch: 15 }, { wch: 10 }, { wch: 15 }, { wch: 15 }, { wch: 20 }, { wch: 15 }];

    XLSX.writeFile(workbook, `${appState.projectName.replace(/\s+/g, '_')}_Export.xlsx`);
    showNotification('Data exported to Excel successfully!', 'success');
}

async function shareFinancialSummary() {
    const summaryText = `Financial Summary for ${appState.projectName}:\n- Total Income: ${formatCurrency(appState.paidAmount)}\n- Total Expenses: ${formatCurrency(appState.pendingAmount)}\n- Current Balance: ${formatCurrency(appState.totalAmount)}`;

    const shareData = { title: 'Financial Summary', text: summaryText };

    try {
        if (navigator.share && navigator.canShare(shareData)) {
            await navigator.share(shareData);
            showNotification('Summary shared successfully!', 'success');
        } else { throw new Error('Web Share API not supported.'); }
    } catch (err) {
        navigator.clipboard.writeText(summaryText).then(() => {
            showNotification('Web Share not available. Summary copied to clipboard!', 'success');
        }).catch(clipErr => {
            showNotification('Could not share or copy the summary.', 'error');
        });
    }
}


function renderHistoryPage() {
    renderHistoryTable();
    updateHistoryStats();
}

function setHistoryTableHeader() {
    const isExpense = currentSettings.expenseMode;
    let headers = [];
    
    if (isExpense) {
        // Finance Manager Mode: Date, Category, Type, Amount
        headers = [
            getTranslatedString('date'), 
            getTranslatedString('category'), 
            'Type', 
            getTranslatedString('amount')
        ];
    } else {
        // Installment Mode: Date, Category, Amount
        headers = [
            getTranslatedString('date'), 
            getTranslatedString('category'), 
            getTranslatedString('amount')
        ];
    }

    elements.historyTableHeader.innerHTML = `
        <tr class="bg-gray-50/50" role="row">
            ${headers.map(h => `<th class="px-4 py-4 text-left text-xs font-bold text-gray-400 uppercase tracking-widest border-b" scope="col">${h}</th>`).join('')}
        </tr>`;
}

function renderHistoryTable(filteredPayments = null) {
    setHistoryTableHeader();
    const isExpense = currentSettings.expenseMode;
    const payments = filteredPayments || [...appState.payments].sort((a, b) => b.id - a.id);
    elements.historyTableBody.innerHTML = '';

    const noRecordsToShow = payments.length === 0;
    elements.noPaymentsHistory.classList.toggle('hidden', !noRecordsToShow);
    elements.historyTableBody.parentElement.classList.toggle('hidden', noRecordsToShow);

    if (!noRecordsToShow) {
        payments.forEach((p) => {
            const tr = document.createElement('tr');
            tr.className = 'table-row transition-all hover:bg-blue-50/30 cursor-pointer';
            
            // CLEAN FIX: Only use the Event Listener
            tr.addEventListener('click', (e) => {
                e.preventDefault();
                showTransactionDetail(p.id);
            });

            if (isExpense) {
                const isIncome = p.type === 'income';
                tr.innerHTML = `
                    <td class="px-4 py-4 text-sm font-medium text-gray-600 border-b">${p.paymentDate}</td>
                    <td class="px-4 py-4 text-sm font-bold text-gray-800 border-b">${p.category || 'Other'}</td>
                    <td class="px-4 py-4 text-sm border-b">
                        <span class="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter ${isIncome ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
                            ${isIncome ? 'Income' : 'Expense'}
                        </span>
                    </td>
                    <td class="px-4 py-4 text-sm border-b font-black ${isIncome ? 'text-green-600' : 'text-red-600'}">
                        ${formatCurrency(p.paymentAmount)}
                    </td>`;
            } else {
                tr.innerHTML = `
                    <td class="px-4 py-4 text-sm font-medium text-gray-600 border-b">${p.paymentDate}</td>
                    <td class="px-4 py-4 text-sm font-bold text-gray-800 border-b">${p.category || 'Installment'}</td>
                    <td class="px-4 py-4 text-sm border-b font-black text-blue-600">
                        ${formatCurrency(p.paymentAmount)}
                    </td>`;
            }
            elements.historyTableBody.appendChild(tr);
        });
    }
    elements.totalCount.textContent = appState.payments.length;
    elements.filteredCount.textContent = payments.length;
}

function showTransactionDetail(id) {
    const record = appState.payments.find(p => p.id === id);
    if (!record) return;

    currentDetailId = id;
    const isExpenseMode = currentSettings.expenseMode;
    const isIncome = record.type === 'income' || (!isExpenseMode && record.paymentAmount > 0);

    // 1. Format Amount
    elements.detailAmount.textContent = formatCurrency(record.paymentAmount);
    // Red for Expense, Green for Income
    elements.detailAmount.className = `text-4xl font-bold mt-1 ${isIncome ? 'text-green-600' : 'text-red-600'}`;

    // 2. Format Date & Time (e.g. 2025-10-18 at 07:59 PM)
    const timeStr = record.paymentTime || "12:00 PM";
    elements.detailDateTime.textContent = `${record.paymentDate} at ${timeStr}`;

    // 3. Description & Category
    elements.detailDescription.textContent = record.description || "-";
    elements.detailCategory.textContent = isExpenseMode ? (record.category || "General") : (record.projectName || "Installment");

    // 4. Type Badge Styling
    const typeEl = elements.detailType;
    if (isExpenseMode) {
        typeEl.textContent = isIncome ? 'Income' : 'Expense';
        typeEl.className = `px-4 py-1 rounded-full text-sm font-bold ${isIncome ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`;
    } else {
        typeEl.textContent = 'Installment';
        typeEl.className = 'px-4 py-1 rounded-full text-sm font-bold bg-blue-100 text-blue-700';
    }

    // 5. Method & Bank
    elements.detailMethod.textContent = record.paymentMethod === 'cash' ? 'Cash' : 'Bank Transaction';
    if (record.paymentMethod === 'bank' && record.bankName !== '-') {
        elements.detailBank.textContent = record.bankName;
        elements.detailBankContainer.classList.remove('hidden');
    } else {
        elements.detailBankContainer.classList.add('hidden');
    }

    // 6. Receipt Handling
    if (record.receipt) {
        elements.detailReceiptContainer.classList.remove('hidden');
        elements.detailReceiptLink.onclick = () => {
            elements.receiptModalImage.src = record.receipt;
            elements.receiptModal.classList.remove('hidden');
        };
    } else {
        elements.detailReceiptContainer.classList.add('hidden');
    }

    // 7. Button Actions
    elements.detailEditBtn.onclick = () => editPayment(id);
    elements.detailDeleteBtn.onclick = () => deletePayment(id);

    showPage('detail');
}


function updateHistoryStats() {
    if (appState.payments.length === 0) {
        elements.avgPayment.textContent = formatCurrency(0);
        elements.maxPayment.textContent = formatCurrency(0);
        elements.minPayment.textContent = formatCurrency(0);
        elements.lastPaymentDate.textContent = '-';
        return;
    }
    const amounts = appState.payments.map(p => p.paymentAmount);
    const lastPayment = [...appState.payments].sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate))[0];

    elements.avgPayment.textContent = formatCurrency(Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length));
    elements.maxPayment.textContent = formatCurrency(Math.max(...amounts));
    elements.minPayment.textContent = formatCurrency(Math.min(...amounts));
    elements.lastPaymentDate.textContent = lastPayment.paymentDate;
}

function filterPayments() {
    const searchTerm = elements.searchInput.value.toLowerCase().trim();
    const methodFilter = elements.methodFilter.value;
    const dateFilter = elements.dateFilter.value;

    let filtered = appState.payments.filter(p => {
        const matchesSearch = !searchTerm ||
            (p.projectName && p.projectName.toLowerCase().includes(searchTerm)) ||
            p.paymentAmount.toString().includes(searchTerm) ||
            (p.description && p.description.toLowerCase().includes(searchTerm)) ||
            (p.category && p.category.toLowerCase().includes(searchTerm)) ||
            (p.bankName && p.bankName.toLowerCase().includes(searchTerm));
        const matchesMethod = !methodFilter || p.paymentMethod === methodFilter;
        let matchesDate = true;
        if (dateFilter) {
            const pDate = new Date(p.paymentDate + "T00:00:00");
            const today = new Date(); today.setHours(0, 0, 0, 0);
            if (dateFilter === 'today') matchesDate = pDate.getTime() === today.getTime();
            else if (dateFilter === 'week') { const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay()); matchesDate = pDate >= weekStart; }
            else if (dateFilter === 'month') { const monthStart = new Date(today.getFullYear(), today.getMonth(), 1); matchesDate = pDate >= monthStart; }
        }
        return matchesSearch && matchesMethod && matchesDate;
    });
    renderHistoryTable(filtered);
}

function generateChartData() {
    const dataByYear = {};
    appState.payments.forEach(p => {
        const year = new Date(p.paymentDate).getFullYear();
        if (!dataByYear[year]) {
            dataByYear[year] = { income: {}, expense: {} };
        }
        const categoryData = dataByYear[year][p.type];
        categoryData[p.category] = (categoryData[p.category] || 0) + p.paymentAmount;
    });
    return dataByYear;
}

function renderYearlyCharts() {
    const yearlyData = generateChartData();
    const container = elements.yearlyChartsContainer;
    container.innerHTML = '';
    const years = Object.keys(yearlyData).sort((a, b) => b - a);

    if (years.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-600 dark:text-gray-400">No transaction data available to display charts.</p>';
        return;
    }

    years.forEach(year => {
        const yearDiv = document.createElement('div');
        yearDiv.className = 'glass-effect rounded-2xl p-6';
        yearDiv.innerHTML = `<h2 class="text-2xl font-bold text-gray-800 mb-6 text-center">${year} Summary</h2>`;

        const chartsGrid = document.createElement('div');
        chartsGrid.className = 'grid grid-cols-1 lg:grid-cols-2 gap-8 items-center';

        const incomeData = yearlyData[year].income;
        const expenseData = yearlyData[year].expense;

        chartsGrid.appendChild(createPieChart(incomeData, `income-${year}`, `${year} Income`, year, 'income'));
        chartsGrid.appendChild(createPieChart(expenseData, `expense-${year}`, `${year} Expenses`, year, 'expense'));

        yearDiv.appendChild(chartsGrid);
        container.appendChild(yearDiv);
    });
}

function createPieChart(data, id, title, year, type) {
    const chartContainer = document.createElement('div');
    if (Object.keys(data).length === 0) {
        chartContainer.innerHTML = `<h3 class="text-lg font-semibold text-gray-700 mb-4 text-center">${title}</h3><p class="text-center text-gray-500">No data for this period.</p>`;
        return chartContainer;
    }

    const canvas = document.createElement('canvas');
    canvas.id = id;
    chartContainer.appendChild(canvas);

    const labels = Object.keys(data);
    const values = Object.values(data);
    const colors = generateColors(labels.length);

    setTimeout(() => {
        const ctx = canvas.getContext('2d');
        activeCharts[id] = new Chart(ctx, {
            type: 'pie',
            data: { labels: labels, datasets: [{ data: values, backgroundColor: colors }] },
            options: {
                onClick: (e) => {
                    currentChartYear = year;
                    currentChartType = type;
                    showPage('monthlyChart');
                },
                responsive: true,
                plugins: {
                    title: { display: true, text: title, font: { size: 18 }, padding: { bottom: 20 } },
                    legend: { position: 'bottom' },
                    tooltip: {
                        callbacks: {
                            label: (context) => `${context.label}: ${formatCurrency(context.raw)}`
                        }
                    },
                    datalabels: {
                        formatter: (value, ctx) => {
                            const sum = ctx.chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
                            const percentage = (value * 100 / sum).toFixed(1) + '%';
                            return percentage;
                        },
                        color: '#fff',
                        font: { weight: 'bold' }
                    }
                }
            },
            plugins: [ChartDataLabels]
        });
    }, 0);

    return chartContainer;
}

function renderMonthlyCharts() {
    elements.monthlyChartTitle.textContent = `Monthly Summary for ${currentChartYear}`;

    const incomeData = new Array(12).fill(0);
    const expenseData = new Array(12).fill(0);

    appState.payments.forEach(p => {
        const date = new Date(p.paymentDate);
        if (date.getFullYear() == currentChartYear) {
            const month = date.getMonth();
            if (p.type === 'income') {
                incomeData[month] += p.paymentAmount;
            } else {
                expenseData[month] += p.paymentAmount;
            }
        }
    });

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const incomeCtx = elements.monthlyIncomeChart.getContext('2d');
    activeCharts['monthlyIncome'] = new Chart(incomeCtx, {
        type: 'bar',
        data: {
            labels: months,
            datasets: [{
                label: `Total Income`,
                data: incomeData,
                backgroundColor: 'rgba(75, 192, 192, 0.6)',
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 1
            }]
        },
        options: getBarChartOptions()
    });

    const expenseCtx = elements.monthlyExpenseChart.getContext('2d');
    activeCharts['monthlyExpense'] = new Chart(expenseCtx, {
        type: 'bar',
        data: {
            labels: months,
            datasets: [{
                label: `Total Expenses`,
                data: expenseData,
                backgroundColor: 'rgba(255, 99, 132, 0.6)',
                borderColor: 'rgba(255, 99, 132, 1)',
                borderWidth: 1
            }]
        },
        options: getBarChartOptions()
    });
}

function getBarChartOptions() {
    return {
        responsive: true,
        plugins: {
            legend: { display: false },
            tooltip: {
                callbacks: {
                    label: (context) => `Total: ${formatCurrency(context.raw)}`
                }
            }
        },
        scales: { y: { beginAtZero: true, ticks: { callback: value => `${globalSettings.currencySymbol || '$'} ${formatNumber(value)}` } } }
    };
}

function generateColors(count) {
    const colors = [];
    const baseHues = [210, 140, 350, 45, 260, 180, 310, 80];
    for (let i = 0; i < count; i++) {
        const hue = baseHues[i % baseHues.length] + Math.floor(i / baseHues.length) * 20;
        colors.push(`hsl(${hue}, 70%, 50%)`);
    }
    return colors;
}

function renderCardPage() {
    const isExpenseMode = currentSettings.expenseMode;
    const card = elements.projectCardDisplay;

    // 1. Clear old classes and apply the correct one
    card.classList.remove('card-installment', 'card-finance');
    
    if (isExpenseMode) {
        card.classList.add('card-finance'); // Green for Finance Manager
    } else {
        card.classList.add('card-installment'); // Blue for Installment Tracker
    }

    // 2. Generate the same Card Number format as before
    const seed = parseInt(currentProjectId, 10);
    const part1 = (seed % 9000) + 1000;
    const part2 = ((seed * 3) % 9000) + 1000;
    const part3 = ((seed * 7) % 9000) + 1000;
    const part4 = ((seed * 11) % 9000) + 1000;
    const cardNumber = `${part1} ${part2} ${part3} ${part4}`;

    const validThruMonth = ((seed * 5) % 12) + 1;
    const validThruYear = new Date().getFullYear() + 4 - (seed % 3);

    // 3. Update Text Content
    elements.cardPageName.textContent = appState.projectName || 'Project Name';
    elements.cardPageNumber.textContent = cardNumber;
    elements.cardPageValidThru.textContent = `${String(validThruMonth).padStart(2, '0')}/${String(validThruYear).slice(-2)}`;
}

function getShortcuts() {
    return JSON.parse(localStorage.getItem(SHORTCUTS_STORAGE_KEY)) || [];
}

function getAutoTransactions() {
    return JSON.parse(localStorage.getItem(AUTO_TRANSACTIONS_STORAGE_KEY)) || [];
}


function renderShortcutsPage() {
    const searchTerm = elements.shortcutSearchInput.value.toLowerCase();
    const allShortcuts = getShortcuts();
    const autoTransactions = getAutoTransactions();

    const shortcuts = allShortcuts.filter(s =>
        (s.description && s.description.toLowerCase().includes(searchTerm)) ||
        (s.category && s.category.toLowerCase().includes(searchTerm)) ||
        s.amount.toString().includes(searchTerm)
    );

    const container = elements.shortcutListContainer;
    container.innerHTML = '';

    elements.noShortcutsMessage.classList.toggle('hidden', allShortcuts.length > 0);
    elements.noShortcutResultsMessage.classList.toggle('hidden', shortcuts.length > 0 || allShortcuts.length === 0);

    shortcuts.forEach(shortcut => {
        const isIncome = shortcut.type === 'income';
        const autoInfo = autoTransactions.find(auto => auto.id === shortcut.id);
        const isAuto = !!autoInfo;

        const card = document.createElement('div');
        card.className = 'p-4 rounded-lg flex items-center justify-between transition-all card-hover';
        card.style.border = '1px solid rgba(0,0,0,0.1)';

        card.innerHTML = `
                <div class="flex-grow cursor-pointer" data-action="use" data-id="${shortcut.id}">
                    <div class="flex items-center gap-3">
                        <span class="w-10 h-10 rounded-full flex items-center justify-center ${isIncome ? 'bg-green-100' : 'bg-red-100'}">
                            <i class="fas ${isIncome ? 'fa-plus text-green-600' : 'fa-minus text-red-600'}"></i>
                        </span>
                        <div>
                            <p class="font-bold text-gray-800">${shortcut.description || 'Shortcut'}</p>
                            <p class="text-sm text-gray-600">${shortcut.category} &bull; ${formatCurrency(shortcut.amount)}</p>
                        </div>
                    </div>
                </div>
                <div class="flex-shrink-0 flex items-center gap-1">
                    <button class="text-gray-500 hover:text-blue-700 w-10 h-10 rounded-full hover:bg-blue-50 transition-colors" data-action="edit" data-id="${shortcut.id}" title="Edit Shortcut">
                        <i class="fas fa-edit"></i>
                    </button>
                     <button class="w-10 h-10 rounded-full transition-colors ${isAuto ? 'text-green-600 hover:bg-green-50' : 'text-gray-500 hover:text-green-700 hover:bg-green-50'}" data-action="auto" data-id="${shortcut.id}" title="Schedule Automation">
                        <i class="fas fa-robot"></i>
                    </button>
                    <button class="text-gray-500 hover:text-red-700 w-10 h-10 rounded-full hover:bg-red-50 transition-colors" data-action="delete" data-id="${shortcut.id}" title="Delete Shortcut">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
        container.appendChild(card);
    });
}

function handleShortcutListClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    const id = parseInt(target.dataset.id);
    const shortcut = getShortcuts().find(s => s.id === id);
    if (!shortcut) return;


    if (action === 'use') {
        handleShortcutUse(id);
    } else if (action === 'delete') {
        handleShortcutDelete(id);
    } else if (action === 'edit') {
        openTransactionModal(shortcut.type, false, shortcut);
    } else if (action === 'auto') {
        openAutoScheduleModal(id);
    }
}

function handleShortcutUse(id) {
    const shortcut = getShortcuts().find(s => s.id === id);
    if (!shortcut) {
        showNotification('Shortcut not found.', 'error');
        return;
    }

    if (confirm(`Add this transaction?\n\n${shortcut.description}\n${formatCurrency(shortcut.amount)}`)) {
        const today = new Date();
        const newRecord = {
            id: Date.now(),
            projectName: appState.projectName,
            paymentDate: today.toISOString().split('T')[0],
            paymentTime: today.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            paymentAmount: shortcut.amount,
            paymentMethod: shortcut.paymentMethod,
            description: shortcut.description,
            bankName: shortcut.bankName,
            type: shortcut.type,
            category: shortcut.category,
            receipt: null
        };

        appState.payments.push(newRecord);
        finishTransaction('Transaction added from shortcut.');
        showPage('main');
    }
}

function handleShortcutDelete(id) {
    if (confirm('Are you sure you want to delete this shortcut? This will also remove any automation linked to it.')) {
        let shortcuts = getShortcuts();
        shortcuts = shortcuts.filter(s => s.id !== id);
        localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(shortcuts));

        let autoTransactions = getAutoTransactions();
        autoTransactions = autoTransactions.filter(auto => auto.id !== id);
        localStorage.setItem(AUTO_TRANSACTIONS_STORAGE_KEY, JSON.stringify(autoTransactions));

        showNotification('Shortcut deleted.', 'success');
        renderShortcutsPage();
    }
}

function populateDayOfMonthSelector() {
    const selector = elements.autoDayOfMonth;
    selector.innerHTML = '';
    for (let i = 1; i <= 28; i++) {
        selector.add(new Option(i, i));
    }
}

function openAutoScheduleModal(id) {
    const autoTransactions = getAutoTransactions();
    const existing = autoTransactions.find(auto => auto.id === id);

    elements.autoShortcutId.value = id;

    if (existing) {
        const { schedule } = existing;
        elements.autoFrequency.value = schedule.frequency;
        elements.autoTime.value = schedule.time;

        elements.autoDayOfWeekContainer.classList.toggle('hidden', schedule.frequency !== 'weekly');
        if (schedule.frequency === 'weekly') {
            elements.autoDayOfWeek.value = schedule.day;
        }

        elements.autoDayOfMonthContainer.classList.toggle('hidden', schedule.frequency !== 'monthly');
        if (schedule.frequency === 'monthly') {
            elements.autoDayOfMonth.value = schedule.dayOfMonth;
        }

    } else {
        elements.autoTransactionForm.reset();
        elements.autoDayOfWeekContainer.classList.add('hidden');
        elements.autoDayOfMonthContainer.classList.add('hidden');
    }

    elements.autoTransactionModal.classList.remove('hidden');
}

function handleSaveAutoSchedule(e) {
    e.preventDefault();
    const id = parseInt(elements.autoShortcutId.value);
    const frequency = elements.autoFrequency.value;
    const time = elements.autoTime.value;
    const day = frequency === 'weekly' ? parseInt(elements.autoDayOfWeek.value) : null;
    const dayOfMonth = frequency === 'monthly' ? parseInt(elements.autoDayOfMonth.value) : null;


    let autoTransactions = getAutoTransactions();
    const existingIndex = autoTransactions.findIndex(auto => auto.id === id);

    const newSchedule = {
        id,
        schedule: { frequency, time, day, dayOfMonth },
        lastRun: Date.now()
    };

    if (existingIndex > -1) {
        autoTransactions[existingIndex] = { ...autoTransactions[existingIndex], ...newSchedule };
    } else {
        autoTransactions.push(newSchedule);
    }

    localStorage.setItem(AUTO_TRANSACTIONS_STORAGE_KEY, JSON.stringify(autoTransactions));
    showNotification('Automation schedule saved!', 'success');
    elements.autoTransactionModal.classList.add('hidden');
    renderShortcutsPage();
}

function renderAutoTransactionsPage() {
    const autoTransactions = getAutoTransactions();
    const shortcuts = getShortcuts();
    const container = elements.autoTransactionListContainer;
    container.innerHTML = '';

    elements.noAutoTransactionsMessage.classList.toggle('hidden', autoTransactions.length > 0);

    autoTransactions.forEach(auto => {
        const shortcut = shortcuts.find(s => s.id === auto.id);
        if (!shortcut) return;

        const isIncome = shortcut.type === 'income';

        let scheduleText;
        if (auto.schedule.frequency === 'daily') {
            scheduleText = `Daily at ${auto.schedule.time}`;
        } else if (auto.schedule.frequency === 'weekly') {
            scheduleText = `Weekly on ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][auto.schedule.day]} at ${auto.schedule.time}`;
        } else if (auto.schedule.frequency === 'monthly') {
            scheduleText = `Monthly on day ${auto.schedule.dayOfMonth} at ${auto.schedule.time}`;
        }


        const card = document.createElement('div');
        card.className = 'p-4 rounded-lg flex items-center justify-between card-hover';
        card.style.border = '1px solid rgba(0,0,0,0.1)';
        card.innerHTML = `
            <div>
                <p class="font-bold text-gray-800">${shortcut.description || 'Shortcut'}</p>
                <p class="text-sm text-gray-600">${formatCurrency(shortcut.amount)} &bull; ${scheduleText}</p>
            </div>
            <button class="text-red-500 hover:text-red-700 w-10 h-10 rounded-full hover:bg-red-50 transition-colors" data-action="delete-auto" data-id="${auto.id}" title="Remove Automation">
                <i class="fas fa-trash"></i>
            </button>
        `;
        container.appendChild(card);
    });

    container.addEventListener('click', e => {
        const target = e.target.closest('[data-action="delete-auto"]');
        if (target) {
            const id = parseInt(target.dataset.id);
            if (confirm('Are you sure you want to remove this automation?')) {
                let autoTxns = getAutoTransactions();
                autoTxns = autoTxns.filter(auto => auto.id !== id);
                localStorage.setItem(AUTO_TRANSACTIONS_STORAGE_KEY, JSON.stringify(autoTxns));
                showNotification('Automation removed.', 'success');
                renderAutoTransactionsPage();
                renderShortcutsPage();
            }
        }
    });
}

function checkAndRunAutoTransactions() {
    const autoTransactions = getAutoTransactions();
    if (autoTransactions.length === 0) return;

    const shortcuts = getShortcuts();
    const now = new Date();
    let transactionsAdded = 0;
    let somethingChanged = false;

    let updatedAutoTransactions = autoTransactions.map(auto => {
        const schedule = auto.schedule;
        const lastRun = new Date(auto.lastRun);
        let latestRunForThisAuto = lastRun.getTime();

        let checkDate = new Date(lastRun);
        checkDate.setDate(checkDate.getDate() + 1);
        checkDate.setHours(0, 0, 0, 0);

        while (checkDate <= now) {
            let isRunDay = false;
            if (schedule.frequency === 'daily') {
                isRunDay = true;
            } else if (schedule.frequency === 'weekly') {
                if (checkDate.getDay() === schedule.day) isRunDay = true;
            } else if (schedule.frequency === 'monthly') {
                if (checkDate.getDate() === schedule.dayOfMonth) isRunDay = true;
            }

            if (isRunDay) {
                const [hours, minutes] = schedule.time.split(':');
                const runDateTime = new Date(checkDate);
                runDateTime.setHours(hours, minutes, 0, 0);

                if (runDateTime > lastRun && runDateTime <= now) {
                    const shortcut = shortcuts.find(s => s.id === auto.id);
                    if (shortcut) {
                        const newRecord = {
                            id: Date.now() + transactionsAdded,
                            projectName: appState.projectName,
                            paymentDate: runDateTime.toISOString().split('T')[0],
                            paymentTime: runDateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                            paymentAmount: shortcut.amount,
                            paymentMethod: shortcut.paymentMethod,
                            description: `(Auto) ${shortcut.description || ''}`.trim(),
                            bankName: shortcut.bankName,
                            type: shortcut.type,
                            category: shortcut.category,
                            receipt: null
                        };
                        appState.payments.push(newRecord);
                        transactionsAdded++;
                        latestRunForThisAuto = runDateTime.getTime();
                        somethingChanged = true;
                    }
                }
            }
            checkDate.setDate(checkDate.getDate() + 1);
        }

        auto.lastRun = latestRunForThisAuto;
        return auto;
    });

    if (transactionsAdded > 0) {
        localStorage.setItem(AUTO_TRANSACTIONS_STORAGE_KEY, JSON.stringify(updatedAutoTransactions));
        recalculateTotals();
        saveData();
        updateSummary();
        showNotification(`${transactionsAdded} automated transaction(s) were added.`, 'success');
    } else if (somethingChanged) {
        localStorage.setItem(AUTO_TRANSACTIONS_STORAGE_KEY, JSON.stringify(updatedAutoTransactions));
    }
}

// --- GEMINI AI IMAGE ANALYSIS (Replacing Tesseract) ---

// 1. Helper: Convert File to Base64 (Stripping Metadata)
const fileToGenerativePart = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            // Remove the "data:image/jpeg;base64," prefix for the API
            const base64String = reader.result.split(',')[1]; 
            resolve(base64String);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
};

// 2. The Gemini API Function
async function analyzeWithGemini(base64Image, mimeType) {
    // --------------------------------------------------------------------------------
    // WARNING: Replace "YOUR_GEMINI_API_KEY_HERE" with your actual Google Gemini API Key
    // You can get one for free at https://aistudio.google.com/
    // --------------------------------------------------------------------------------
    const API_KEY = "AIzaSyCUUY3reazjWurgDqVKJUG9WPaoqsLCiyI"; 
    

    // REPLACE THE OLD URL LINE WITH THIS:
     // FALLBACK URL (Use this if the one above fails):
// Try this specific version number:
const URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;

    // The Prompt: Instructions for the AI
    const promptText = `
        Analyze this image (receipt, invoice, or note). 
        Extract the following data into a pure JSON object (no markdown, no backticks):
        {
            "amount": Number (The grand total/final amount. If unsure, look for the largest number),
            "date": String (Format YYYY-MM-DD),
            "merchant": String (The name of the store or person),
            "category": String (Pick one: Food, Transport, Bills, Shopping, Health, Entertainment, Other),
            "description": String (A short 3-5 word summary of items purchased),
            "paymentMethod": String (Guess "cash" or "bank" based on text like 'VISA', 'Change', etc.)
        }
        If a field is missing, use null.
    `;

    const requestBody = {
        contents: [{
            parts: [
                { text: promptText },
                {
                    inline_data: {
                        mime_type: mimeType,
                        data: base64Image
                    }
                }
            ]
        }]
    };

    try {
        const response = await fetch(URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();
        
        // Error handling for API limits or bad keys
        if (data.error) throw new Error(data.error.message);

        // Extract the text response
        let textResponse = data.candidates[0].content.parts[0].text;

        // Clean up markdown formatting if the AI adds it (e.g., ```json ... ```)
        textResponse = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();

        return JSON.parse(textResponse);
    } catch (error) {
        console.error("Gemini API Error:", error);
        throw error;
    }
}

function handleInstallmentReceiptPreview() {
    const file = elements.installmentReceipt.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            elements.installmentReceiptPreview.src = e.target.result;
            elements.installmentReceiptPreviewContainer.classList.remove('hidden');
        }
        reader.readAsDataURL(file);
    }
}

function removeInstallmentReceiptPreview() {
    elements.installmentReceipt.value = null;
    elements.installmentReceiptPreview.src = '';
    elements.installmentReceiptPreviewContainer.classList.add('hidden');
}

// Window Globals for HTML event handlers
window.closeCelebration = closeCelebration;
window.editPayment = editPayment;
window.deletePayment = deletePayment;
window.setProgressBarColor = setProgressBarColor;
window.setTheme = setTheme;
window.showTransactionDetail = showTransactionDetail;