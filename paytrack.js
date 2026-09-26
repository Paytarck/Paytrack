// NOTE: auth.js (and the Firebase SDK it loads from gstatic.com) is loaded
// lazily via dynamic import() everywhere below, never as a static top-level
// `import ... from './auth.js'`. A static import is all-or-nothing: if the
// device is offline and that network fetch fails, the ENTIRE module fails to
// load and NONE of the code in this file runs — no rendering, no buttons,
// nothing. Loading it lazily means the app always works from local data
// first, and cloud features simply sit out (and quietly retry) when there's
// no connection.

// Helper to convert images to strings for storage
const readFileAsDataURL = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
    });
};
// Registers a Background Sync request so the browser retries a failed
// cloud push automatically once connectivity returns, even if this tab
// isn't focused — matching the same pattern used in dashboard.js and
// settings.js. Best-effort: unsupported browsers (notably iOS) simply
// no-op here; the periodic pull/online listener below remain the primary
// safety nets in that case.
function scheduleBackgroundSync() {
    if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return;
    navigator.serviceWorker.ready
        .then((reg) => reg.sync.register('paytrack-sync'))
        .catch(() => {});
}

// When Background Sync fires in the service worker, push this project's
// current local data back to the cloud so a record entered while offline
// (already saved locally the moment it was entered) actually makes it to
// other devices instead of just sitting queued forever.
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'PAYTRACK_FLUSH_SYNC') {
            triggerCloudSync();
        }
    });
}

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
            await auth.updateGlobalCard(currentProjectObj, buildCloudPackage());
        }
        
        console.log("Sync successful");
    } catch (e) {
        console.error("Sync failed:", e);
        scheduleBackgroundSync();
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
            // Call the auth function to push to Firestore "global_cards" collection
            await auth.updateGlobalCard(currentProjectObj, buildCloudPackage());
        }
    } catch (e) {
        console.warn("Card Auto-update failed:", e);
        scheduleBackgroundSync();
    }
}

// Reads EVERY locally-stored piece of the currently-open project — payments,
// settings, shortcuts, scheduled auto-transactions, and the balance-visibility
// toggle — into one package. Earlier versions of this package only included
// installment/expense/settings, which meant shortcuts and auto-transactions
// never made it to the cloud at all: opening the project on another device,
// or importing its card, always came up with that data missing.
function buildCloudPackage(extra = {}) {
    return {
        installment: JSON.parse(localStorage.getItem(INSTALLMENT_STORAGE_KEY) || 'null'),
        expense: JSON.parse(localStorage.getItem(EXPENSE_STORAGE_KEY) || 'null'),
        settings: JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'),
        shortcuts: JSON.parse(localStorage.getItem(SHORTCUTS_STORAGE_KEY) || 'null'),
        autoTransactions: JSON.parse(localStorage.getItem(AUTO_TRANSACTIONS_STORAGE_KEY) || 'null'),
        visibility: localStorage.getItem(VISIBILITY_KEY),
        ...extra
    };
}

// The inverse of buildCloudPackage: writes a package pulled from the cloud
// back into local storage for the currently-open project. Returns true if
// anything beyond installment/expense/settings was present, so callers can
// decide whether to re-render shortcuts/auto-transaction UI.
function applyCloudPackageLocally(cloudPackage) {
    if (!cloudPackage) return false;
    if (cloudPackage.installment) localStorage.setItem(INSTALLMENT_STORAGE_KEY, JSON.stringify(cloudPackage.installment));
    if (cloudPackage.expense) localStorage.setItem(EXPENSE_STORAGE_KEY, JSON.stringify(cloudPackage.expense));
    if (cloudPackage.settings) localStorage.setItem(SETTINGS_KEY, JSON.stringify(cloudPackage.settings));

    let hadExtras = false;
    if (cloudPackage.shortcuts) {
        localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(cloudPackage.shortcuts));
        hadExtras = true;
    }
    if (cloudPackage.autoTransactions) {
        localStorage.setItem(AUTO_TRANSACTIONS_STORAGE_KEY, JSON.stringify(cloudPackage.autoTransactions));
        hadExtras = true;
    }
    if (cloudPackage.visibility !== undefined && cloudPackage.visibility !== null) {
        localStorage.setItem(VISIBILITY_KEY, cloudPackage.visibility);
        hadExtras = true;
    }
    return hadExtras;
}

// --- APP STATE & VARIABLES ---
let currentDetailId = null; // Add this line near currentProjectId
let pendingHistoryHighlightId = null; // Row to scroll to & highlight next time the History page renders
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
// Prevent delayed Chart.js callbacks from creating charts after leaving a
// chart page. This also keeps the loading/navigation state clean on mobile.
let chartRenderVersion = 0;
let globalSettings = {};

// Transaction Type State
let currentTransactionType = 'income';
let pendingTransactionType = 'income';

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

// Currency codes the app's word-conversion (numberToWords) and speech features
// already understand, mapped to their default symbol.
const CURRENCY_SYMBOLS = { USD: '$', PKR: 'Rs', INR: '₹', EUR: '€', GBP: '£', JPY: '¥' };

// --- PER-PROJECT CURRENCY & LANGUAGE OVERRIDE ---
// By default every project follows the app's main (dashboard) currency & language
// and stays in sync automatically whenever those main settings change. A project
// can opt out of that from its own Settings page and lock itself to a currency/
// language of its own instead — see currentSettings.currencyOverride/language and
// applyEffectiveCurrencyAndLanguage() further down.
//
// Language is used app-wide (translations.js exposes window.getLanguage() and
// reads it to decide what to render everywhere - buttons, labels, amount-in-words,
// speech, etc.), so rather than touching every call site we wrap it once here: if
// THIS project has a language override, answer with that; otherwise defer to the
// app's own main-settings language, exactly as before.
const _appGetLanguage = (typeof window.getLanguage === 'function') ? window.getLanguage.bind(window) : () => 'en';
window.getLanguage = function () {
    if (currentSettings && currentSettings.languageOverride && currentSettings.language) {
        return currentSettings.language;
    }
    return _appGetLanguage();
};

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
    speakInitAmountBtn: document.getElementById('speakInitAmountBtn'),
    initReceiptPreview: document.getElementById('initReceiptPreview'),
    initReceiptPreviewContainer: document.getElementById('initReceiptPreviewContainer'),
    removeInitReceiptBtn: document.getElementById('removeInitReceiptBtn'),
    // Detail Page Elements
    paymentCategory: document.getElementById('paymentCategory'),
    installmentReceipt: document.getElementById('installmentReceipt'),
    scanInstallmentReceiptBtn: document.getElementById('scanInstallmentReceiptBtn'),
    installmentScanPicker: document.getElementById('installmentScanPicker'),
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
    speakTotalCostBtn: document.getElementById('speakTotalCostBtn'),
    speakPaymentAmountBtn: document.getElementById('speakPaymentAmountBtn'),
    paymentCount: document.getElementById('paymentCount'),
    notification: document.getElementById('notification'),
    totalCostLabel: document.getElementById('totalCostLabel'),
    totalCostHelper: document.getElementById('totalCostHelper'),
    formTitle: document.getElementById('formTitle'),
    editPaymentId: document.getElementById('editPaymentId'),
    settingsFromMain: document.getElementById('settingsFromMain'),
    manualSyncBtn: document.getElementById('manualSyncBtn'),
    manualSyncIcon: document.getElementById('manualSyncIcon'),
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
    dynamicColorToggle: document.getElementById('dynamicColorToggle'),
    manualColorSelector: document.getElementById('manualColorSelector'),
    themeSelector: document.getElementById('themeSelector'),
    projectCurrencyLanguageSection: document.getElementById('projectCurrencyLanguageSection'),
    projectLocaleOverrideToggle: document.getElementById('projectLocaleOverrideToggle'),
    projectLocaleOverrideFields: document.getElementById('projectLocaleOverrideFields'),
    projectCurrencyLanguageInheritedNote: document.getElementById('projectCurrencyLanguageInheritedNote'),
    projectCurrencySelect: document.getElementById('projectCurrencySelect'),
    projectLanguageSelect: document.getElementById('projectLanguageSelect'),
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

    // SELECTION MODAL & RECEIPT SCANNER
    inputTypeSelectionModal: document.getElementById('inputTypeSelectionModal'),
    closeSelectionModalBtn: document.getElementById('closeSelectionModalBtn'),
    btnSelectManual: document.getElementById('btnSelectManual'),
    btnSelectScan: document.getElementById('btnSelectScan'),
    globalImagePicker: document.getElementById('globalImagePicker'),
    ocrLoadingOverlay: document.getElementById('ocrLoadingOverlay'),
    ocrStatusText: document.getElementById('ocrStatusText')
};

// --- INITIALIZATION ---

document.addEventListener('DOMContentLoaded', async () => {
    currentProjectId = sessionStorage.getItem('currentProjectId');
    
    // SAFETY CHECK: If no project ID, go back to dashboard
    if (!currentProjectId) {
        window.location.href = 'dashboard.html';
        return;
    }

    // CRITICAL FIX 1: Initialize the Storage Keys with the Project ID
    INSTALLMENT_STORAGE_KEY = `project_${currentProjectId}_installment`;
    EXPENSE_STORAGE_KEY = `project_${currentProjectId}_expense`;
    SETTINGS_KEY = `project_${currentProjectId}_settings`;
    VISIBILITY_KEY = `project_${currentProjectId}_visibility`;
    SHORTCUTS_STORAGE_KEY = `project_${currentProjectId}_shortcuts`;
    AUTO_TRANSACTIONS_STORAGE_KEY = `project_${currentProjectId}_auto`;

    // 1. Load what we have locally first for instant UI
    loadInitialData();
    setupEventListeners();

    // Keep checking for due automations while the app stays open in the
    // background, instead of only checking once on page load.
    setInterval(() => {
        checkAndRunAutoTransactions();
        if (currentPage === 'shortcuts') renderShortcutsPage();
        if (currentPage === 'autoTransactionsList') renderAutoTransactionsPage();
    }, 5 * 60 * 1000); // every 5 minutes

    // Periodically pull the latest data from the cloud in the background so
    // changes made on another device show up here without needing a reload.
    // This runs on top of the real-time listener below as a safety net.
    setInterval(() => {
        if (document.visibilityState === 'visible') {
            pullCloudUpdates();
        }
    }, 60 * 1000); // every 60 seconds

    // Also do an immediate pull whenever the tab/app regains focus —
    // catches anything that happened while it was in the background.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            pullCloudUpdates();
        }
    });

    setTodayDate(); 

    const startSync = (projectList) => {
    const projectInfo = projectList.find(p => p.id == currentProjectId);
    
    // Prevent multiple listeners from running at once
    if (projectInfo && projectInfo.cardNumber && !window.hasStartedSync) {
        window.hasStartedSync = true;

       import('./auth.js').then(auth => auth.subscribeToProjectCard(projectInfo.cardNumber, (remoteData) => {
    if (!remoteData) return;

    // We check if the cloud data is different from our local state
    const remoteTS = remoteData.lastUpdated || 0;
    const localTS = appState.lastUpdated || 0;
    
    // We accept the update if the timestamp is newer OR if the payment count changed
    const remotePayments = (currentSettings.expenseMode ? remoteData.expense : remoteData.installment)?.payments || [];
    const localPayments = appState.payments || [];

    if (remoteTS > localTS || remotePayments.length !== localPayments.length) {
        console.log("🔄 Force Sync: Cloud update detected.");
        
        // 1. Update Storage for ALL modes — includes shortcuts, auto-transactions,
        // and the visibility toggle, not just installment/expense/settings
        applyCloudPackageLocally(remoteData);

        // 2. Refresh current Settings and active State
        currentSettings = remoteData.settings || currentSettings;
        if (currentSettings.currencyOverride === undefined) currentSettings.currencyOverride = false;
        if (currentSettings.languageOverride === undefined) currentSettings.languageOverride = false;
        applyEffectiveCurrencyAndLanguage();
        // Deep copy the incoming data so Device B has its own fresh object
        const incomingData = currentSettings.expenseMode ? remoteData.expense : remoteData.installment;
        appState = JSON.parse(JSON.stringify(incomingData)); 
        if (remoteData.visibility !== undefined && remoteData.visibility !== null) {
            isBalanceVisible = remoteData.visibility === 'true' || remoteData.visibility === true;
        }

        // 3. FORCE RECALCULATION (Crucial for final payment)
        // We sort and calculate totals before touching the UI
        recalculateTotals(); 

        // 4. REFRESH UI
        updateSummary(); // Updates the 3 cards (Total, Paid, Pending)
        updateUIMode();  // Updates the Progress Bar
        if (elements.toggleVisibilityBtn) updateVisibilityUI();
        
        if (currentPage === 'history') renderHistoryTable();
        if (currentPage === 'shortcuts') renderShortcutsPage();
        if (currentPage === 'autoTransactionsList') renderAutoTransactionsPage();
        if (currentPage === 'settings') renderProjectLocaleSettings();
        
        // 5. COMPLETION CHECK (Final Transaction Celebration)
        const isInstallmentMode = !currentSettings.expenseMode;
        // Use 0.1 safety margin for rounding
        const isFinished = appState.totalAmount > 0 && (appState.paidAmount >= appState.totalAmount - 0.1);
        
        if (isInstallmentMode && isFinished && elements.celebration.classList.contains('hidden')) {
            console.log("🎉 Final Payment Synced! Celebrating...");
            showCelebration();
        }

        // 6. Visual Status
        flashCloudStatus('Synced');

        if (typeof translatePage === 'function') translatePage();
    }
})).catch(e => console.log('Live card sync unavailable (offline?):', e));
    }
    };

    // Initialize Sync
    const initialProjects = JSON.parse(localStorage.getItem(PROJECTS_KEY)) || [];
    const foundLocal = initialProjects.find(p => p.id == currentProjectId);

    if (foundLocal && foundLocal.cardNumber) {
        startSync(initialProjects);
    } else {
        const username = localStorage.getItem('paytrackUsername');
        import('./auth.js').then(auth => {
            auth.subscribeToUserData(username, (newData) => {
                if (newData && newData.projects) startSync(newData.projects);
            });
        }).catch(e => console.log('User data sync unavailable (offline?):', e));
    }

    // Reconnect handling: as soon as the browser regains connectivity, push
    // anything changed while offline and pull the latest remote state, then
    // let the person know via the same status pill used for manual syncs.
    window.addEventListener('online', async () => {
        if (window.PayTrackNet) window.PayTrackNet.setStatus('syncing', 'Syncing…');
        try {
            await triggerCloudSync();
            await pullCloudUpdates();
            if (window.PayTrackNet) window.PayTrackNet.setStatus('online', 'Synced');
            else flashCloudStatus('Synced');
        } catch (e) {
            console.log('Reconnect sync failed:', e);
            if (window.PayTrackNet) window.PayTrackNet.setStatus('error', 'Sync failed');
        }
    });
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

// Resolves globalSettings.currency/currencySymbol for the CURRENT project: uses
// this project's own override when set, otherwise reads the app's live main
// settings (GLOBAL_SETTINGS_KEY) so that projects which never opted out keep
// following whatever currency is set app-wide, even if it changes later.
function applyEffectiveCurrencyAndLanguage() {
    if (currentSettings.currencyOverride && currentSettings.currency) {
        globalSettings.currency = currentSettings.currency;
        globalSettings.currencySymbol = currentSettings.currencySymbol || CURRENCY_SYMBOLS[currentSettings.currency] || '$';
    } else {
        const globalData = JSON.parse(localStorage.getItem(GLOBAL_SETTINGS_KEY)) || {};
        globalSettings.currency = globalData.currency || 'USD';
        globalSettings.currencySymbol = globalData.currencySymbol || '$';
    }
    // Language itself is resolved on demand by the window.getLanguage() wrapper
    // defined near the top of this file, which already checks
    // currentSettings.languageOverride — nothing to do for it here.
}

// Live sync: if the app's main Settings (currency/language) change in another
// tab/window (e.g. the dashboard), pick that up immediately for any project
// that hasn't opted out with its own override — without needing a page reload.
window.addEventListener('storage', (e) => {
    if (e.key !== GLOBAL_SETTINGS_KEY) return;
    if (!currentSettings || (currentSettings.currencyOverride && currentSettings.languageOverride)) return;

    applyEffectiveCurrencyAndLanguage();
    recalculateTotals();
    updateSummary();
    if (typeof translatePage === 'function') translatePage();
    if (typeof updateTotalCostWords === 'function') updateTotalCostWords();
    if (typeof updatePaymentAmountWords === 'function') updatePaymentAmountWords();
    if (typeof updateModalAmountWords === 'function' && elements.modalAmount && elements.modalAmount.value) {
        updateModalAmountWords();
    }
    if (currentPage === 'history' && typeof renderHistoryTable === 'function') renderHistoryTable();
    if (currentPage === 'settings') renderProjectLocaleSettings();
});

async function loadInitialData() {
    const allProjects = JSON.parse(localStorage.getItem(PROJECTS_KEY)) || [];
    const currentProject = allProjects.find(p => p.id == currentProjectId);
    if (!currentProject) return;

    // 1. SET DEFAULTS IMMEDIATELY (Prevents blank blue screens)
    currentSettings = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || { 
        theme: 'blue', 
        expenseMode: currentProject.type === 'finance',
        customIncomeCategories: [],
        customExpenseCategories: [],
        customBanks: []
    };
    // Backfill for projects saved before the currency/language override existed,
    // so they correctly default to "follow the app's main settings".
    if (currentSettings.currencyOverride === undefined) currentSettings.currencyOverride = false;
    if (currentSettings.languageOverride === undefined) currentSettings.languageOverride = false;

    // Resolve the effective currency now that we know whether this project
    // overrides it, falling back to the app's main settings when it doesn't.
    applyEffectiveCurrencyAndLanguage();

    const dataKey = currentSettings.expenseMode ? EXPENSE_STORAGE_KEY : INSTALLMENT_STORAGE_KEY;
    let localData = JSON.parse(localStorage.getItem(dataKey)) || getNewState(currentSettings.expenseMode);
    
    // Set current state to local data first so UI draws something
    appState = localData;
    appState.projectName = currentProject.name;

    // 2. Initial UI Render (Shows buttons immediately)
    applyTheme(currentSettings.theme || 'blue');
    recalculateTotals();
    updateSummary();
    updateUIMode(); 

    setTodayDate();

    // 3. CLOUD SYNC IN BACKGROUND
    await pullCloudUpdates();

    // 4. RUN DUE AUTOMATIONS
    // This was previously defined but never invoked anywhere, so scheduled
    // shortcuts never actually fired. Run it once appState/shortcuts are loaded.
    checkAndRunAutoTransactions();

    // 5. PROCESS AN INCOMING SHARED RECEIPT, IF ANY
    // If the user got here by picking this project from the "select a
    // project" prompt after sharing a receipt image into PayTrack from
    // another app, scan it now automatically.
    processPendingSharedReceipt();
}

// Reads a receipt image handed to us by share-intent.js (stored as a tiny
// {uri, name, mimeType} pointer in sessionStorage — never the image bytes
// themselves, so this survives the page navigation from dashboard.html
// cheaply). Converts the native file URI back into a real File and feeds it
// straight into the same OCR pipeline the manual "Scan Receipt" button uses.
async function processPendingSharedReceipt() {
    const raw = sessionStorage.getItem('paytrackPendingSharedReceipt');
    if (!raw) return;
    sessionStorage.removeItem('paytrackPendingSharedReceipt'); // consume once, whatever happens next

    let shared;
    try { shared = JSON.parse(raw); } catch (e) { return; }
    if (!shared || !shared.uri) return;

    // Finance-tracker projects track both income and expenses, so ask which
    // this receipt is before scanning. Installment-tracker projects only
    // ever track payments, so there's nothing to ask — same as the manual
    // "Scan Receipt" button on that page, which is always expense-only.
    const type = currentSettings.expenseMode ? await askIncomeOrExpenseForSharedReceipt() : 'expense';
    if (!type) return; // user dismissed the chooser without picking

    try {
        showNotification('Scanning shared receipt...', 'success');
        // Capacitor.convertFileSrc() turns a native file:// / content:// path into
        // a URL the WebView is actually allowed to fetch() from.
        const webSrc = (window.Capacitor && window.Capacitor.convertFileSrc)
            ? window.Capacitor.convertFileSrc(shared.uri)
            : shared.uri;
        const response = await fetch(webSrc);
        const blob = await response.blob();
        const file = new File([blob], shared.name || 'receipt.jpg', { type: shared.mimeType || blob.type || 'image/jpeg' });

        if (elements.inputTypeSelectionModal) elements.inputTypeSelectionModal.classList.add('hidden');
        await processScannedReceiptFile(file, type);
    } catch (err) {
        console.error('Could not load shared receipt image:', err);
        showNotification("Couldn't open the shared receipt. Please try scanning it manually.", 'error');
    }
}

// Small injected modal asking "Add as Expense" or "Add as Income" for a
// shared receipt on a finance-tracker project. Resolves to 'expense',
// 'income', or null if the user dismisses it without choosing.
function askIncomeOrExpenseForSharedReceipt() {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.id = 'ptShareTypeChoiceOverlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:9995;background:rgba(0,0,0,0.55);' +
            'display:flex;align-items:center;justify-content:center;padding:20px;font-family:inherit;';
        overlay.innerHTML = `
            <div style="background:#fff;border-radius:20px;padding:24px;max-width:320px;width:100%;text-align:center;">
                <i class="fas fa-receipt" style="font-size:1.6rem;color:#764ba2;"></i>
                <p style="font-weight:700;font-size:1.05rem;margin:10px 0 4px;color:#1a202c;">Scan this receipt as...</p>
                <p style="font-size:0.85rem;color:#718096;margin:0 0 18px;">This project tracks both income and expenses — which is this?</p>
                <div style="display:flex;flex-direction:column;gap:10px;">
                    <button type="button" id="ptShareAsExpense" style="border:none;cursor:pointer;border-radius:12px;padding:12px;font-weight:700;font-size:0.95rem;background:#fee2e2;color:#b91c1c;">
                        <i class="fas fa-arrow-up mr-1"></i> Add as Expense
                    </button>
                    <button type="button" id="ptShareAsIncome" style="border:none;cursor:pointer;border-radius:12px;padding:12px;font-weight:700;font-size:0.95rem;background:#dcfce7;color:#15803d;">
                        <i class="fas fa-arrow-down mr-1"></i> Add as Income
                    </button>
                    <button type="button" id="ptShareCancel" style="border:none;cursor:pointer;background:transparent;color:#a0aec0;font-size:0.8rem;padding:6px;">Cancel</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        const cleanup = (result) => { overlay.remove(); resolve(result); };
        overlay.querySelector('#ptShareAsExpense').addEventListener('click', () => cleanup('expense'));
        overlay.querySelector('#ptShareAsIncome').addEventListener('click', () => cleanup('income'));
        overlay.querySelector('#ptShareCancel').addEventListener('click', () => cleanup(null));
    });
}

// Lets share-intent.js hand a receipt straight to this page when the app is
// already open on a project (no need to bounce through the project picker).
window.PayTrackReceiptIntake = { processPendingSharedReceipt };

// Flash the little "Synced" pill in the header so the user gets quiet
// visual confirmation whenever data moves to/from the cloud.
function flashCloudStatus(text = 'Synced', isError = false) {
    const status = document.getElementById('cloudStatus');
    if (!status) return;
    const textEl = document.getElementById('cloudStatusText');
    if (textEl) textEl.textContent = text;
    status.classList.toggle('sync-error', isError);
    status.classList.remove('opacity-0');
    clearTimeout(flashCloudStatus._t);
    flashCloudStatus._t = setTimeout(() => status.classList.add('opacity-0'), 2200);
}

// Pulls the latest project data from the cloud and, if it's newer than what
// we have locally, applies it to the UI immediately — no reload required.
// Used both by the periodic auto-sync timer and by loadInitialData().
async function pullCloudUpdates() {
    const allProjects = JSON.parse(localStorage.getItem(PROJECTS_KEY)) || [];
    const currentProject = allProjects.find(p => p.id == currentProjectId);
    if (!currentProject || !currentProject.cardNumber) return false;

    try {
        const { downloadProjectData } = await import('./auth.js');
        const cloudPackage = await downloadProjectData(currentProject.cardNumber);

        if (cloudPackage) {
            const cloudTS = cloudPackage.lastUpdated || 0;
            const localTS = appState.lastUpdated || 0;

            // Only update if Cloud is strictly newer
            if (cloudTS > localTS) {
                console.log("📥 Cloud is newer. Syncing UI...");

                // Save to storage — includes shortcuts, auto-transactions,
                // and the visibility toggle, not just installment/expense/settings
                applyCloudPackageLocally(cloudPackage);

                // Update App Memory
                currentSettings = cloudPackage.settings || currentSettings;
                if (currentSettings.currencyOverride === undefined) currentSettings.currencyOverride = false;
                if (currentSettings.languageOverride === undefined) currentSettings.languageOverride = false;
                applyEffectiveCurrencyAndLanguage();
                appState = currentSettings.expenseMode ? cloudPackage.expense : cloudPackage.installment;
                appState.projectName = currentProject.name;
                if (cloudPackage.visibility !== undefined && cloudPackage.visibility !== null) {
                    isBalanceVisible = cloudPackage.visibility === 'true' || cloudPackage.visibility === true;
                }

                // Final UI Refresh with Cloud Data
                recalculateTotals();
                updateSummary();
                updateUIMode();
                applyTheme(currentSettings.theme);
                if (elements.toggleVisibilityBtn) updateVisibilityUI();
                if (currentPage === 'history') renderHistoryTable();
                if (currentPage === 'shortcuts') renderShortcutsPage();
                if (currentPage === 'autoTransactionsList') renderAutoTransactionsPage();
                if (currentPage === 'settings') renderProjectLocaleSettings();
                if (typeof translatePage === 'function') translatePage();

                flashCloudStatus('Synced');
                return true;
            }
        }
        return false;
    } catch (e) {
        console.warn("Cloud sync background task failed:", e);
        return false;
    }
}

// Manual "Sync Now" button: pushes whatever is in local storage up to the
// cloud, then pulls the latest back down, so the button always reflects a
// full round-trip rather than just one direction.
async function performManualSync() {
    const btn = elements.manualSyncBtn;
    const icon = elements.manualSyncIcon;

    const username = localStorage.getItem('paytrackUsername');
    if (!username) {
        showNotification('Sign in to sync your data with the cloud.', 'error');
        return;
    }
    if (!navigator.onLine) {
        showNotification("You're offline — changes are saved locally and will sync automatically once you're back online", 'error');
        return;
    }

    if (btn) btn.disabled = true;
    if (icon) icon.classList.add('syncing-spin');
    flashCloudStatus('Syncing…');

    try {
        await triggerCloudSync();   // push local changes up
        const updated = await pullCloudUpdates(); // pull any newer remote changes down
        flashCloudStatus('Synced');
        showNotification(updated ? 'Synced! New data pulled from the cloud.' : 'Synced successfully!', 'success');
    } catch (e) {
        console.error('Manual sync failed:', e);
        flashCloudStatus('Sync failed', true);
        showNotification('Sync failed. Please check your internet connection.', 'error');
    } finally {
        if (btn) btn.disabled = false;
        if (icon) icon.classList.remove('syncing-spin');
    }
}

// --- CORE FUNCTIONS ---

// --- paytrack.js ---

async function saveData() {
    try {
        const now = Date.now();
        
        // Update the timestamp INSIDE the data object
        appState.lastUpdated = now; 

        const currentDataKey = currentSettings.expenseMode ? EXPENSE_STORAGE_KEY : INSTALLMENT_STORAGE_KEY;
        localStorage.setItem(currentDataKey, JSON.stringify(appState));
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(currentSettings));

        const allProjects = JSON.parse(localStorage.getItem(PROJECTS_KEY)) || [];
        const currentProjectObj = allProjects.find(p => p.id == currentProjectId);
        
        if (currentProjectObj && currentProjectObj.cardNumber) {
            const { updateGlobalCard } = await import('./auth.js');
            await updateGlobalCard(currentProjectObj, buildCloudPackage({ lastUpdated: now }));
        }
    } catch (error) {
        console.error("Save Error:", error);
        scheduleBackgroundSync();
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

    // TOGGLE BUTTON VISIBILITY: Show Add Buttons, Hide Edit Buttons
    elements.formActionsDefault.classList.remove('hidden');
    elements.formActionsEdit.classList.add('hidden');

    setTodayDate(); // Default to today's date
    updateUIMode();
}

function openProjectDetails() {
    // Read directly from appState (which is kept fresh by the listener)
    const data = appState.projectMetaData;
    if (!data) {
        showNotification("Agreement details not found.", "error");
        return;
    }

    elements.viewDetailProjectName.textContent = data.name || appState.projectName;
    elements.viewDetailTotalCost.textContent = formatCurrency(data.totalCost || appState.totalAmount);
    elements.viewDetailDate.textContent = data.agreementDate || "-";
    elements.viewDetailDesc.textContent = data.description || "-";

    const galleryContainer = document.getElementById('projectAgreementGallery');
    galleryContainer.innerHTML = ''; 

    const imagesToShow = data.receipts || [];
    if (imagesToShow.length > 0) {
        elements.viewDetailReceiptContainer.classList.remove('hidden');
        imagesToShow.forEach((src, idx) => {
            const img = document.createElement('img');
            img.src = src;
            img.className = 'agreement-gallery-thumb';
            img.onclick = () => openImageGallery(imagesToShow, idx);
            galleryContainer.appendChild(img);
        });
    } else {
        elements.viewDetailReceiptContainer.classList.add('hidden');
    }

    elements.projectDetailsModal.classList.remove('hidden');
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
    // FIX FOR BUG #2: Move this here so it works immediately on page load
    if (elements.projectSetupSection) {
        elements.projectSetupSection.addEventListener('dblclick', openProjectDetails);
        elements.projectSetupSection.title = "Double-click to view Agreement/Setup details";
    }
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
            if (elements.speakInitAmountBtn) {
                elements.speakInitAmountBtn.classList.toggle('hidden', !(val > 0));
            }
        });
    }
    if (elements.speakInitAmountBtn) {
        elements.speakInitAmountBtn.addEventListener('click', () => speakText(elements.initTotalAmount.value));
    }

    if (elements.initReceipt) {
    elements.initReceipt.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        const MAX_INIT_IMAGES = 4;

        // Enforce a maximum of 4 images when creating an installment project
        const remainingSlots = MAX_INIT_IMAGES - tempInitReceipts.length;
        if (remainingSlots <= 0) {
            showNotification(`You can upload a maximum of ${MAX_INIT_IMAGES} images.`, 'error');
            elements.initReceipt.value = "";
            return;
        }

        const filesToProcess = files.slice(0, remainingSlots);
        if (files.length > remainingSlots) {
            showNotification(`Only ${remainingSlots} more image(s) can be added (max ${MAX_INIT_IMAGES} total).`, 'error');
        }

        for (const file of filesToProcess) {
            // Optimize every uploaded image down to ~30KB before storing
            const optimized = await processImage(file);
            tempInitReceipts.push(optimized);
        }
        renderInitReceiptPreviews();
        elements.initReceipt.value = ""; // Clear input to allow re-selection
    });
}
function renderInitReceiptPreviews() {
    if (!elements.initReceiptPreviewContainer) return;
    
    elements.initReceiptPreviewContainer.innerHTML = '';
    if (tempInitReceipts.length > 0) {
        // Force the grid to show
        elements.initReceiptPreviewContainer.classList.remove('hidden');
        elements.initReceiptPreviewContainer.style.display = 'grid'; 
        
        tempInitReceipts.forEach((src, index) => {
            const div = document.createElement('div');
            div.className = 'receipt-preview-item';
            div.innerHTML = `
                <img src="${src}" class="w-full h-full object-cover rounded-lg border-2 border-blue-200">
                <div class="remove-receipt-badge" onclick="removeTempInitReceipt(${index})">&times;</div>
            `;
            elements.initReceiptPreviewContainer.appendChild(div);
        });
    } else {
        elements.initReceiptPreviewContainer.classList.add('hidden');
        elements.initReceiptPreviewContainer.style.display = 'none';
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
        
        // IMPORTANT: Clear the src so the next time it opens, 
        // the browser is forced to load the new image.
        elements.receiptModalImage.src = "";
        document.body.style.overflow = 'auto'; 
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
    elements.totalCost.addEventListener('input', () => {
        updateTotalCostWords();
        if (elements.speakTotalCostBtn) {
            elements.speakTotalCostBtn.classList.toggle('hidden', !(elements.totalCost.value && parseFloat(elements.totalCost.value) > 0));
        }
    });
    elements.paymentAmount.addEventListener('input', () => {
        updatePaymentAmountWords();
        if (elements.speakPaymentAmountBtn) {
            elements.speakPaymentAmountBtn.classList.toggle('hidden', !(elements.paymentAmount.value && parseFloat(elements.paymentAmount.value) > 0));
        }
    });
    if (elements.speakTotalCostBtn) {
        elements.speakTotalCostBtn.addEventListener('click', () => speakText(elements.totalCost.value));
    }
    if (elements.speakPaymentAmountBtn) {
        elements.speakPaymentAmountBtn.addEventListener('click', () => speakText(elements.paymentAmount.value));
    }
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

    if (elements.btnSelectScan) {
        elements.btnSelectScan.addEventListener('click', () => {
            elements.globalImagePicker.value = ''; // Reset input
            elements.globalImagePicker.click(); // Open Device File Picker/Gallery
        });
    }

    // --- RECEIPT SCANNING (on-device OCR via Tesseract.js) ---
    if (elements.globalImagePicker) {
        elements.globalImagePicker.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            elements.inputTypeSelectionModal.classList.add('hidden');
            await processScannedReceiptFile(file, pendingTransactionType);
        });
    }

    // --- RECEIPT SCANNING for Installment Tracker mode ("Scan Receipt to Auto-Fill") ---
    if (elements.scanInstallmentReceiptBtn) {
        elements.scanInstallmentReceiptBtn.addEventListener('click', () => {
            elements.installmentScanPicker.value = '';
            elements.installmentScanPicker.click();
        });
    }

    if (elements.installmentScanPicker) {
        elements.installmentScanPicker.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (elements.ocrLoadingOverlay) {
                elements.ocrLoadingOverlay.classList.remove('hidden');
                if (elements.ocrStatusText) elements.ocrStatusText.textContent = 'Reading text from image...';
            }

            try {
                const extractedData = await scanReceiptImage(file, 'expense');

                if (extractedData.amount) {
                    elements.paymentAmount.value = extractedData.amount;
                    if (typeof updatePaymentAmountWords === 'function') updatePaymentAmountWords();
                    if (elements.speakPaymentAmountBtn) {
                        elements.speakPaymentAmountBtn.classList.toggle('hidden', !(elements.paymentAmount.value && parseFloat(elements.paymentAmount.value) > 0));
                    }
                    elements.paymentAmount.style.backgroundColor = '#d1fae5';
                    setTimeout(() => elements.paymentAmount.style.backgroundColor = '', 1500);
                }

                if (extractedData.date) {
                    elements.paymentDate.value = extractedData.date;
                }

                if (extractedData.merchant) {
                    elements.paymentDescription.value = extractedData.merchant;
                }

                if (extractedData.paymentMethod) {
                    elements.paymentMethod.value = extractedData.paymentMethod;
                    if (typeof handlePaymentMethodChange === 'function') handlePaymentMethodChange();
                }

                // Auto-select the bank/wallet found on the receipt in the "Select Bank"
                // dropdown (or drop it into "+ Add Custom Bank" if it's not one of the
                // presets, e.g. JazzCash/EasyPaisa or a bank not in the default list).
                if (extractedData.bankName && elements.bankName) {
                    const bankOptions = Array.from(elements.bankName.options).map(opt => opt.value);
                    if (bankOptions.includes(extractedData.bankName)) {
                        elements.bankName.value = extractedData.bankName;
                    } else {
                        elements.bankName.value = 'custom';
                        elements.customBankName.value = extractedData.bankName;
                    }
                    if (typeof handleBankNameChange === 'function') handleBankNameChange();
                }

                // Attach the scanned image as the receipt (optimized to ~30KB on save)
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                elements.installmentReceipt.files = dataTransfer.files;
                if (typeof handleInstallmentReceiptPreview === 'function') handleInstallmentReceiptPreview();

                if (elements.ocrLoadingOverlay) elements.ocrLoadingOverlay.classList.add('hidden');

                if (extractedData.amount || extractedData.date || extractedData.merchant || extractedData.bankName) {
                    showNotification('Receipt scanned. Please review the details.', 'success');
                } else {
                    showNotification("Couldn't read the receipt clearly. Please fill in the details.", 'error');
                }

            } catch (err) {
                console.error('Receipt scan failed:', err);
                if (elements.ocrLoadingOverlay) elements.ocrLoadingOverlay.classList.add('hidden');
                showNotification('Scan failed. Please fill details manually.', 'error');
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
    if (elements.manualSyncBtn) {
        elements.manualSyncBtn.addEventListener('click', performManualSync);
    }
    elements.backToMainBtn.addEventListener('click', () => showPage('main'));
    elements.backToHistoryBtn.addEventListener('click', () => {
        pendingHistoryHighlightId = currentDetailId; // return to the exact row we came from
        showPage('history');
    });
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
    elements.dynamicColorToggle.addEventListener('change', handleDynamicColorToggle);
    if (elements.projectLocaleOverrideToggle) elements.projectLocaleOverrideToggle.addEventListener('change', handleProjectLocaleOverrideToggle);
    if (elements.projectCurrencySelect) elements.projectCurrencySelect.addEventListener('change', handleProjectCurrencyChange);
    if (elements.projectLanguageSelect) elements.projectLanguageSelect.addEventListener('change', handleProjectLanguageChange);

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
        const title = elements.inputTypeSelectionModal.querySelector('h3');
        if (title) title.textContent = type === 'income' ? 'Add Income' : 'Add Expense';
        elements.inputTypeSelectionModal.classList.remove('hidden');
    } else {
        // Fallback: If selection modal is missing, open manual modal directly
        openTransactionModal(type);
    }
}

function setTodayDate() {
    // Get date in YYYY-MM-DD format
    const today = new Date().toISOString().split('T')[0];
    
    // Set for Standard Installment Form
    if (elements.paymentDate) elements.paymentDate.value = today;
    
    // Set for Finance Mode Modal
    if (elements.modalDate) elements.modalDate.value = today;
    
    // SET FOR INITIALIZATION FORM (The total amount setup)
    if (elements.initDate) elements.initDate.value = today; 
}

function showPage(page) {
    // Navigation buttons must always be able to dismiss a loader started by
    // an action on the previous page (for example Auto Transactions or Chart).
    if (typeof window.hideLoading === 'function') {
        window.hideLoading();
    }

    // Invalidate any pending chart render before changing pages.
    chartRenderVersion++;

    // 1. Hide all using Tailwind class
    document.querySelectorAll('.page').forEach(p => {
        p.classList.add('hidden');
        p.classList.remove('active');
    });

    const pageMap = { 
        main: elements.mainPage, 
        history: elements.historyPage, 
        settings: elements.settingsPage, 
        detail: elements.detailPage, 
        yearlyChart: elements.yearlyChartPage, 
        monthlyChart: elements.monthlyChartPage, 
        card: elements.cardPage, 
        shortcuts: elements.shortcutTransactionsPage,
        autoTransactionsList: elements.autoTransactionsListPage 
    };

    const activePage = pageMap[page];
    if (activePage) {
        activePage.classList.remove('hidden');
        activePage.classList.add('active');
        currentPage = page;
        
        if (page === 'main') updateUIMode();
        if (page === 'history') renderHistoryPage();
        if (page === 'card') renderCardPage();
        if (page === 'shortcuts') renderShortcutsPage();
        if (page === 'settings') { renderProjectLocaleSettings(); }
        if (page === 'yearlyChart') renderYearlyCharts();
        if (page === 'monthlyChart') {
            if (activeCharts['monthlyIncome']) { activeCharts['monthlyIncome'].destroy(); delete activeCharts['monthlyIncome']; }
            if (activeCharts['monthlyExpense']) { activeCharts['monthlyExpense'].destroy(); delete activeCharts['monthlyExpense']; }
            renderMonthlyCharts();
        }
        
        if (page === 'history') {
            scrollHistoryPageIntoPosition();
        } else {
            window.scrollTo(0, 0);
        }

        // A page transition is complete only after the target page is
        // visible. Hide again here because some loader implementations attach
        // themselves to button clicks and finish asynchronously.
        if (typeof window.hideLoading === 'function') {
            window.hideLoading();
        }
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

    // Unlike English ("fifty" + "five" = "fifty-five"), Urdu numbers from
    // 11 to 99 are each their own standalone word (e.g. 55 is "پچپن"/pachpan,
    // not "پچاس پانچ"/fifty-five said as two separate numbers). Gluing
    // tens+units together like the old code did produced grammatically wrong
    // Urdu that both reads and sounds like two separate numbers being read
    // out ("fifty... five") instead of one ("fifty-five"). This lookup table
    // uses the correct, unique word for every value 0-99.
    const belowHundred = [
        'صفر', 'ایک', 'دو', 'تین', 'چار', 'پانچ', 'چھ', 'سات', 'آٹھ', 'نو',
        'دس', 'گیارہ', 'بارہ', 'تیرہ', 'چودہ', 'پندرہ', 'سولہ', 'سترہ', 'اٹھارہ', 'انیس',
        'بیس', 'اکیس', 'بائیس', 'تئیس', 'چوبیس', 'پچیس', 'چھبیس', 'ستائیس', 'اٹھائیس', 'انتیس',
        'تیس', 'اکتیس', 'بتیس', 'تینتیس', 'چونتیس', 'پینتیس', 'چھتیس', 'سینتیس', 'اڑتیس', 'انتالیس',
        'چالیس', 'اکتالیس', 'بیالیس', 'تینتالیس', 'چوالیس', 'پینتالیس', 'چھیالیس', 'سینتالیس', 'اڑتالیس', 'انچاس',
        'پچاس', 'اکاون', 'باون', 'ترپن', 'چون', 'پچپن', 'چھپن', 'ستاون', 'اٹھاون', 'انسٹھ',
        'ساٹھ', 'اکسٹھ', 'باسٹھ', 'تریسٹھ', 'چونسٹھ', 'پینسٹھ', 'چھیاسٹھ', 'سڑسٹھ', 'اڑسٹھ', 'انہتر',
        'ستر', 'اکہتر', 'بہتر', 'تہتر', 'چوہتر', 'پچہتر', 'چھہتر', 'ستتر', 'اٹھہتر', 'اناسی',
        'اسی', 'اکاسی', 'بیاسی', 'تراسی', 'چوراسی', 'پچاسی', 'چھیاسی', 'ستاسی', 'اٹھاسی', 'نواسی',
        'نوے', 'اکانوے', 'بانوے', 'ترانوے', 'چورانوے', 'پچانوے', 'چھیانوے', 'ستانوے', 'اٹھانوے', 'ننانوے'
    ];
    const units = belowHundred.slice(0, 10);

    let result = '';
    function convert(n) {
        if (n < 100) return belowHundred[n];
        return units[Math.floor(n / 100)] + ' سو ' + (n % 100 > 0 ? belowHundred[n % 100] : '');
    }
    if (num >= 10000000) { result += convert(Math.floor(num / 10000000)) + ' کروڑ '; num %= 10000000; }
    if (num >= 100000) { result += convert(Math.floor(num / 100000)) + ' لاکھ '; num %= 100000; }
    if (num >= 1000) { result += convert(Math.floor(num / 1000)) + ' ہزار '; num %= 1000; }
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
    if (window.hideLoading) window.hideLoading(); // action finished, dismiss the loader
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

function updateUIMode() {
    const isExpenseMode = currentSettings.expenseMode;
    const body = document.body;
    
    // 1. Set Layout Classes
    body.classList.toggle('finance-mode-on', isExpenseMode);
    elements.installmentModeFormContainer.classList.toggle('hidden', isExpenseMode);
    elements.expenseModeActionsContainer.classList.toggle('hidden', !isExpenseMode);

    // 2. Logic for Installment Forms
    if (!isExpenseMode) {
        const isProjectNew = (appState.totalAmount === 0);
        elements.projectInitializationForm.classList.toggle('hidden', !isProjectNew);
        elements.standardInstallmentForm.classList.toggle('hidden', isProjectNew);
    }

    // 3. Update Text ONLY (This prevents the blue-screen layout disturbance)
    const headerTitleSpan = elements.mainHeaderText.querySelector('span');
    if (headerTitleSpan) {
        headerTitleSpan.textContent = isExpenseMode 
            ? "Income & Expense Tracker" 
            : "Installment Payment Tracker";
    }

    if (isExpenseMode) {
        elements.projectNameHeader.textContent = `Project: ${appState.projectName}`;
        elements.projectNameHeader.classList.remove('hidden');
        elements.headerSubtext.textContent = "Track your income and expenses with ease";
        elements.summaryCard1Label.textContent = "Current Balance";
        elements.summaryCard2Label.textContent = "Total Income";
        elements.summaryCard3Label.textContent = "Total Expenses";
    } else {
        elements.projectNameHeader.classList.add('hidden');
        elements.headerSubtext.textContent = "Track your payments with ease and precision";
        elements.summaryCard1Label.textContent = "Total Amount";
        elements.summaryCard2Label.textContent = "Paid Amount";
        elements.summaryCard3Label.textContent = "Pending Amount";
    }

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

    // 5. Per-project Currency & Language override
    renderProjectLocaleSettings();
}

// --- PER-PROJECT CURRENCY & LANGUAGE OVERRIDE (Settings page UI) ---

function renderProjectLocaleSettings() {
    if (!elements.projectLocaleOverrideToggle) return;

    const hasOverride = !!(currentSettings.currencyOverride || currentSettings.languageOverride);

    elements.projectLocaleOverrideToggle.checked = hasOverride;
    elements.projectLocaleOverrideFields.classList.toggle('hidden', !hasOverride);
    elements.projectCurrencyLanguageInheritedNote.textContent = hasOverride
        ? "This project uses its own currency & language."
        : "Currently following the app's main settings.";

    // Pre-fill the dropdowns with whatever is effectively active right now
    // (the project's own override if set, otherwise the app's main settings)
    // so switching the toggle on starts from a sensible value.
    elements.projectCurrencySelect.value = currentSettings.currency || globalSettings.currency || 'USD';
    elements.projectLanguageSelect.value = currentSettings.language || _appGetLanguage() || 'en';
}

function saveProjectLocaleSettings() {
    saveSettings();
    applyEffectiveCurrencyAndLanguage();

    // Refresh anything on screen that depends on currency or language.
    recalculateTotals();
    updateSummary();
    renderProjectLocaleSettings();
    if (typeof translatePage === 'function') translatePage();
    if (typeof updateTotalCostWords === 'function') updateTotalCostWords();
    if (typeof updatePaymentAmountWords === 'function') updatePaymentAmountWords();
    if (typeof updateModalAmountWords === 'function' && elements.modalAmount && elements.modalAmount.value) {
        updateModalAmountWords();
    }
    if (currentPage === 'history') renderHistoryTable();
}

function handleProjectLocaleOverrideToggle() {
    const enabled = elements.projectLocaleOverrideToggle.checked;
    elements.projectLocaleOverrideFields.classList.toggle('hidden', !enabled);

    currentSettings.currencyOverride = enabled;
    currentSettings.languageOverride = enabled;

    if (enabled) {
        // Turning the override on: lock in whatever is currently shown in the
        // two dropdowns (which default to the app's current main settings).
        currentSettings.currency = elements.projectCurrencySelect.value;
        currentSettings.currencySymbol = CURRENCY_SYMBOLS[currentSettings.currency] || '$';
        currentSettings.language = elements.projectLanguageSelect.value;
    }
    // Turning it off intentionally leaves currentSettings.currency/language in
    // place (harmless while *Override is false) in case the user flips it back on.

    saveProjectLocaleSettings();
}

function handleProjectCurrencyChange() {
    currentSettings.currency = elements.projectCurrencySelect.value;
    currentSettings.currencySymbol = CURRENCY_SYMBOLS[currentSettings.currency] || '$';
    saveProjectLocaleSettings();
}

function handleProjectLanguageChange() {
    currentSettings.language = elements.projectLanguageSelect.value;
    saveProjectLocaleSettings();
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
        } else if (expenses > 0) {
            // No income recorded yet but there are expenses — still an overspend,
            // just express it as a full -100% rather than silently showing 0%.
            progress = -100;
        } else {
            progress = 0; // Nothing recorded yet
        }
    } else {
        // Installment Mode Math: Paid / Total
        progress = appState.totalAmount > 0 ? (appState.paidAmount / appState.totalAmount) * 100 : 0;
    }

    const isOverspent = currentSettings.expenseMode && progress < 0;

    // --- COLOR DECISION ---
    if (isOverspent) {
        // Overspending always shows red, regardless of the dynamic/manual color setting,
        // so a negative balance is unmistakable at a glance.
        color = 'red';
    } else if (currentSettings.dynamicProgressBar) {
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

    // The bar itself can't visually have negative width, so its fill is clamped to 0.
    // The percentage TEXT, however, is left unclamped so an overspent finance project
    // shows the real negative percentage (e.g. "-25%") instead of hiding it as "0%".
    const barWidth = Math.min(100, Math.max(0, progress));
    const displayProgress = isOverspent ? Math.round(progress) : Math.round(Math.min(100, Math.max(0, progress)));

    elements.progressBar.style.width = `${barWidth}%`;
    elements.progressPercentage.textContent = `${displayProgress}%`;
    elements.progressPercentage.classList.toggle('text-red-600', isOverspent);
    elements.progressPercentage.classList.toggle('font-bold', isOverspent);

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
        // ... (keep your existing setup logic) ...
        return;
    }

    const formData = validateForm();
    if (!formData) return;

    // --- THE FIX: START THE LOADER ---
    const addBtn = elements.addPaymentBtn;
    const spinner = document.getElementById('addPaymentSpinner');
    const btnText = elements.addPaymentText;

    if (addBtn && spinner) {
        addBtn.disabled = true;
        spinner.classList.remove('hidden');
        btnText.textContent = "Processing...";
    }
    // ---------------------------------

    const type = currentSettings.expenseMode ? forceType : 'installment';
    
    // We use a try/catch here to reset the button if something crashes
    try {
        addNewRecord(formData, type);
    } catch (err) {
        console.error("Payment failed", err);
        // Reset button on error
        addBtn.disabled = false;
        spinner.classList.add('hidden');
        btnText.textContent = getTranslatedString('addPayment');
    }
}

async function handleUpdateRecord() {
    const editId = parseInt(elements.editPaymentId.value);
    if (!editId) return;
    const formData = validateForm();
    if (!formData) return;

    // --- START LOADER ---
    const btn = elements.updateRecordBtn;
    const spinner = document.getElementById('updateRecordSpinner');
    const btnText = document.getElementById('updateRecordText');
    
    btn.disabled = true;
    spinner.classList.remove('hidden');
    btnText.textContent = "Updating...";

    try {
        await updateRecord(editId, formData);
        // finishTransaction (called inside updateRecord) handles resetting the UI
    } catch (err) {
        console.error("Update failed", err);
        btn.disabled = false;
        spinner.classList.add('hidden');
        btnText.textContent = getTranslatedString('updateTransaction');
    }
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
    // NOTE: The "expense cannot exceed current balance" check has been removed on purpose.
    // In Finance mode, expenses are now allowed even when the balance is 0 (or would go negative),
    // since a balance-of-0 shouldn't block logging real-world spending.

    if (bankName) {
        const isInstallmentCustom = elements.paymentMethod.value === 'bank' && elements.bankName.value === 'custom';
        const isModalCustom = elements.modalPaymentMethod.value === 'bank' && elements.modalBankName.value === 'custom';
        if (isInstallmentCustom || isModalCustom) {
            addCustomBankToList(bankName);
        }
    }

    let receiptDataURL = null;
    if (receiptFile) {
        receiptDataURL = await processImage(receiptFile);
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
        // Optimize the image to ~30KB before saving, same as new records
        updatedRecord.receipt = await processImage(receiptFile);
    } else if (isReceiptRemoved) {
        updatedRecord.receipt = null;
    }

    appState.payments[recordIndex] = updatedRecord;
    finishTransaction(getTranslatedString('recordUpdated'), isShortcut);
}

async function finishTransaction(message, isShortcut = false) {
    recalculateTotals();
    updateSummary();
    
    // 1. Await the cloud sync (This is where the button stays in loading state)
    await saveData(); 

    // 2. Check for completion (Celebration logic)
    const isInstallmentMode = !currentSettings.expenseMode;
    const isFinished = appState.totalAmount > 0 && (appState.paidAmount >= appState.totalAmount - 0.01);
    if (isInstallmentMode && isFinished) {
        showCelebration();
    }

    // --- THE FIX: RESET THE BUTTON UI ---
    const addBtn = elements.addPaymentBtn;
    const spinner = document.getElementById('addPaymentSpinner');
    const btnText = elements.addPaymentText;

    if (addBtn && spinner) {
        addBtn.disabled = false;
        spinner.classList.add('hidden');
        // Restore original text from translations
        btnText.textContent = getTranslatedString('addPayment');
    }
    // ------------------------------------

    clearForm();
    if (currentPage === 'detail' && currentDetailId) {
        showTransactionDetail(currentDetailId);
    }
    showNotification(isShortcut ? 'Shortcut created & synced!' : message);
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
        if (elements.speakTotalCostBtn) {
            elements.speakTotalCostBtn.classList.toggle('hidden', !(elements.totalCost.value && parseFloat(elements.totalCost.value) > 0));
        }
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

async function handleDeleteAllWithPassword() {
    const password = elements.deleteAllPasswordInput.value;
    const correctPassword = localStorage.getItem(DELETE_PASSWORD_KEY) || '7739';

    if (password === correctPassword) {
        await deleteAllRecords();
        elements.deleteAllPasswordModal.classList.add('hidden');
        elements.deleteAllPasswordInput.value = '';
        elements.deleteAllPasswordError.classList.add('hidden');
    } else {
        elements.deleteAllPasswordError.classList.remove('hidden');
        elements.deleteAllPasswordInput.value = '';
    }
}

async function deleteAllRecords() {
    undoCache = { allRecords: [...appState.payments] };
    const name = appState.projectName;
    appState = getNewState(currentSettings.expenseMode);
    appState.projectName = name;
    await saveData();
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
    // 1. Show the Modal
    if (elements.celebration) {
        elements.celebration.classList.remove('hidden');
    }

    // 2. Play the Sound
    const audio = elements.celebrationAudio;
    if (audio) {
        audio.currentTime = 0; // Reset to start
        audio.volume = 1.0;
        
        // Android requires a 'promise' catch for audio
        let playPromise = audio.play();
        if (playPromise !== undefined) {
            playPromise.then(_ => {
                console.log("Music playing successfully");
            }).catch(error => {
                console.warn("Music was blocked by Android system settings.");
            });
        }
    }
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
    pendingHistoryHighlightId = null; // record no longer exists, land on the default view
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
        updatePaymentAmountWords();
        if (elements.speakPaymentAmountBtn) {
            elements.speakPaymentAmountBtn.classList.toggle('hidden', !(elements.paymentAmount.value && parseFloat(elements.paymentAmount.value) > 0));
        }
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
        
        // TOGGLE BUTTON VISIBILITY: Show Edit Buttons, Hide Add Buttons
        elements.formActionsDefault.classList.add('hidden');
        elements.formActionsEdit.classList.remove('hidden');
        
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

// --- SPEECH SYNTHESIS SETUP ---
// Chrome (desktop + Android WebView) loads its voice list asynchronously.
// If speak() is called before voices are ready, the very first click can
// sit silently for several seconds before anything is heard. Priming the
// voice list as early as possible (and again once it finishes loading)
// avoids that first-click delay.
let speechVoicesPrimed = false;
function primeSpeechSynthesis() {
    if (!('speechSynthesis' in window) || speechVoicesPrimed) return;
    const voices = window.speechSynthesis.getVoices();
    if (voices && voices.length) {
        speechVoicesPrimed = true;
    }
    if ('onvoiceschanged' in window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = () => {
            window.speechSynthesis.getVoices();
            speechVoicesPrimed = true;
        };
    }
}
primeSpeechSynthesis();
document.addEventListener('DOMContentLoaded', primeSpeechSynthesis);

// Chrome has a long-standing bug where speechSynthesis silently stalls if
// the tab sat idle before speak() was called, and another where long
// utterances get cut off after ~15s. Nudging it with pause()/resume()
// right before speaking, and periodically while it's talking, keeps
// playback starting immediately and running to completion.
let speechKeepAliveTimer = null;
function stopSpeechKeepAlive() {
    if (speechKeepAliveTimer) {
        clearInterval(speechKeepAliveTimer);
        speechKeepAliveTimer = null;
    }
}

/**
 * Speaks the given numeric amount (in words) right away.
 * Shared by the finance-tracker modal and the installment-tracker fields.
 */
async function speakText(amountValue) {
    if (!amountValue || isNaN(amountValue) || parseFloat(amountValue) <= 0) return;

    const textToSpeak = numberToWords(parseFloat(amountValue));
    const lang = getLanguage(); // Get 'en', 'es', or 'ur' from your settings

    // Determine language code for TTS
    let langCode = 'en-US';
    if (lang === 'es') langCode = 'es-ES';
    if (lang === 'ur') langCode = 'ur-PK';

    // CHECK IF RUNNING AS AN APP (Capacitor)
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        try {
            const { TextToSpeech } = window.Capacitor.Plugins;
            // Stop anything already playing so the new amount is heard immediately
            await TextToSpeech.stop().catch(() => {});
            await TextToSpeech.speak({
                text: textToSpeak,
                lang: langCode,
                rate: 1.0,
                pitch: 1.0,
                volume: 1.0,
                category: 'ambient',
            });
        } catch (e) {
            console.error("Native TTS failed", e);
            showNotification('Native Speech failed. Try updating Google TTS on your phone.', 'error');
        }
    }
    // FALLBACK FOR COMPUTER BROWSER
    else if ('speechSynthesis' in window) {
        stopSpeechKeepAlive();

        // Clear any queued/stuck utterances, then nudge the engine out of a
        // stalled state before speaking so playback starts right away.
        window.speechSynthesis.cancel();
        window.speechSynthesis.resume();

        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        utterance.rate = 0.9;

        // Most desktop/Android browsers don't ship an Urdu voice out of the
        // box. Just setting utterance.lang = 'ur-PK' with no matching voice
        // installed is what caused "speak amount" to silently do nothing for
        // Urdu (Chrome in particular drops utterances for a language it has
        // no voice for, without firing a usable error). We now look for an
        // actual installed voice that matches, fall back to any voice that
        // shares the base language (e.g. any "ur-*"), and if truly nothing
        // is available, tell the user instead of failing silently, while
        // still attempting to speak with the device's default voice so
        // something is heard.
        const voices = window.speechSynthesis.getVoices() || [];
        const exactVoice = voices.find(v => v.lang && v.lang.toLowerCase() === langCode.toLowerCase());
        const baseLang = langCode.split('-')[0].toLowerCase();
        const baseVoice = exactVoice || voices.find(v => v.lang && v.lang.toLowerCase().startsWith(baseLang + '-'));

        if (baseVoice) {
            utterance.voice = baseVoice;
            utterance.lang = baseVoice.lang;
        } else {
            utterance.lang = langCode;
            if (baseLang !== 'en' && voices.length) {
                showNotification('No ' + baseLang.toUpperCase() + ' voice found on this device. Speaking with the default voice instead — install a language pack for accurate pronunciation.', 'error');
            }
        }

        utterance.onstart = () => {
            stopSpeechKeepAlive();
            speechKeepAliveTimer = setInterval(() => {
                if (!window.speechSynthesis.speaking) {
                    stopSpeechKeepAlive();
                    return;
                }
                window.speechSynthesis.pause();
                window.speechSynthesis.resume();
            }, 4000);
        };
        utterance.onend = stopSpeechKeepAlive;
        utterance.onerror = stopSpeechKeepAlive;

        // Queuing speak() in the same tick as cancel() is what causes the
        // "speaks after a long delay" bug on Chrome/Android: cancel() clears
        // the queue asynchronously, so an immediately-following speak() can
        // get dropped and only fire once the engine catches up later. Firing
        // speak() on the next tick lets the cancel finish first, so this
        // call starts speaking right away instead of after a long wait.
        setTimeout(() => {
            window.speechSynthesis.speak(utterance);
        }, 0);
    }
    else {
        showNotification('Speech is not supported on this device.', 'error');
    }
}

// Kept for the finance-tracker "Add Transaction" modal button
async function speakAmount() {
    await speakText(elements.modalAmount.value);
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
    if (!dropdown) return;
    dropdown.innerHTML = '';

    const defaultCategories = {
        income: ['Salary', 'Freelance', 'Investment', 'Gift', 'Other'],
        expense: ['Food', 'Transport', 'Bills', 'Shopping', 'Health', 'Entertainment', 'Other']
    };

    // FIX: Add safety check for undefined arrays
    const customCategories = (type === 'income') 
        ? (currentSettings.customIncomeCategories || []) 
        : (currentSettings.customExpenseCategories || []);

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

    // --- SHORTCUT-ONLY FLOW ---
    // Saving/updating a shortcut template should ONLY touch the shortcuts list.
    // It must never also create a real transaction record (that used to happen
    // as a side effect, which made "Make Shortcut" silently log a payment too).
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
        const index = shortcuts.findIndex(s => s.id === shortcut.id);
        if (index > -1) {
            shortcuts[index] = shortcut;
        } else {
            shortcuts.push(shortcut);
        }
        localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(shortcuts));

        showNotification(isShortcutEdit ? 'Shortcut updated successfully!' : 'Shortcut created successfully!', 'success');
        elements.transactionModal.classList.add('hidden');

        if (currentPage === 'shortcuts') renderShortcutsPage();
        triggerCloudSync();
        return;
    }

    // --- NORMAL TRANSACTION FLOW ---
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

    if (editId) {
        await updateRecord(editId, formData);
    } else {
        // An expense is a valid first transaction. The finance tracker keeps
        // the resulting balance negative until income is recorded later.
        await addNewRecord(formData, currentTransactionType);
    }

    elements.transactionModal.classList.add('hidden');
}

// This function shrinks big photos so they fit in the cloud.
// It progressively lowers JPEG quality, and if that isn't enough, shrinks
// the dimensions too, until the image is optimized down to ~targetKB (default 30KB).
async function compressImage(base64Str, targetKB = 30) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const targetBytes = targetKB * 1024;
            const MAX_WIDTH = 800; // Start by resizing to 800 pixels wide
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
            let quality = 0.7;
            let result = canvas.toDataURL('image/jpeg', quality);

            // Step 1: reduce quality first
            while (estimateBytes(result) > targetBytes && quality > 0.1) {
                quality -= 0.1;
                result = canvas.toDataURL('image/jpeg', quality);
            }

            // Step 2: if still too big, shrink dimensions and retry with quality
            let safety = 0;
            while (estimateBytes(result) > targetBytes && width > 100 && safety < 10) {
                width = Math.round(width * 0.85);
                height = Math.round(height * 0.85);
                render(width, height);
                quality = 0.7;
                result = canvas.toDataURL('image/jpeg', quality);
                while (estimateBytes(result) > targetBytes && quality > 0.1) {
                    quality -= 0.1;
                    result = canvas.toDataURL('image/jpeg', quality);
                }
                safety++;
            }

            resolve(result);
        };
        img.onerror = () => resolve(base64Str); // Fallback: return original if it fails to load
        img.src = base64Str;
    });
}

// Updated helper to use the compressor
async function processImage(file) {
    if (!file) return null;
    const rawBase64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
    });
    return await compressImage(rawBase64);
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

// ============================================================
// SHARE FINANCIAL REPORT (renders a beautiful receipt image and
// lets the user pick where to share it — WhatsApp, Telegram, etc.)
// ============================================================

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function getShareLogoSrc() {
    // Reuse a logo image already present on the page so it's already loaded/cached.
    const existing = document.querySelector('img[src*="Paytrack-icon"]');
    return existing ? existing.src : 'Paytrack-icon.png';
}

function loadImagePromise(src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
        // Safety timeout so a slow/broken logo never blocks the share flow
        setTimeout(() => resolve(img.complete ? img : null), 3000);
    });
}

function buildShareReceiptNode() {
    const isExpense = !!currentSettings.expenseMode;
    const projectName = appState.projectName || 'My Project';
    const now = new Date();
    const generatedStr = now.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) +
        ' at ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const stat1Label = isExpense ? 'Total Income' : 'Total Amount';
    const stat2Label = isExpense ? 'Total Expense' : 'Paid Amount';
    const stat3Label = isExpense ? 'Current Balance' : 'Pending Amount';
    const stat1Value = formatCurrency(isExpense ? (appState.paidAmount || 0) : (appState.totalAmount || 0));
    const stat2Value = formatCurrency(isExpense ? (appState.pendingAmount || 0) : (appState.paidAmount || 0));
    const stat3Value = formatCurrency(isExpense ? (appState.totalAmount || 0) : (appState.pendingAmount || 0));

    const payments = [...(appState.payments || [])].reverse();

    const wrapper = document.createElement('div');
    wrapper.id = 'shareReceiptOffscreenWrapper';

    const card = document.createElement('div');
    card.className = 'share-receipt';
    card.id = 'shareReceiptCard';

    card.innerHTML = `
        <div class="share-receipt-header">
            <div class="share-receipt-brand">
                <img class="share-receipt-logo" id="shareReceiptLogoImg" alt="PayTrack">
                <div>
                    <div class="share-receipt-brand-name">PayTrack</div>
                    <div class="share-receipt-brand-tag">Smart Finance Tracking</div>
                </div>
            </div>
            <div class="share-receipt-gen-date">Generated on ${escapeHtml(generatedStr)}</div>
            <div class="share-receipt-project-name">${escapeHtml(projectName)}</div>
            <div class="share-receipt-project-sub">Financial Statement</div>
        </div>
        <div class="share-receipt-stats">
            <div class="share-receipt-stat">
                <div class="share-receipt-stat-label">${escapeHtml(stat1Label)}</div>
                <div class="share-receipt-stat-value blue">${escapeHtml(stat1Value)}</div>
            </div>
            <div class="share-receipt-stat">
                <div class="share-receipt-stat-label">${escapeHtml(stat2Label)}</div>
                <div class="share-receipt-stat-value green">${escapeHtml(stat2Value)}</div>
            </div>
            <div class="share-receipt-stat">
                <div class="share-receipt-stat-label">${escapeHtml(stat3Label)}</div>
                <div class="share-receipt-stat-value red">${escapeHtml(stat3Value)}</div>
            </div>
        </div>
        <div class="share-receipt-list-title">
            <span>Transaction History</span>
            <span>${payments.length} record${payments.length === 1 ? '' : 's'}</span>
        </div>
        <div class="share-receipt-list" id="shareReceiptList"></div>
        <div class="share-receipt-footer">
            <div class="share-receipt-footer-brand">PAYTRACK</div>
            <div class="share-receipt-footer-tag">Track every rupee, with clarity.</div>
        </div>
    `;

    const listEl = card.querySelector('#shareReceiptList');

    if (payments.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'share-receipt-empty';
        empty.textContent = 'No transactions recorded yet.';
        listEl.appendChild(empty);
    } else {
        payments.forEach(p => {
            const isIncomeLike = isExpense ? p.type === 'income' : true;
            const dotClass = isExpense ? (isIncomeLike ? 'income' : 'expense') : 'neutral';
            const amountClass = isExpense ? (isIncomeLike ? 'pos' : 'neg') : 'neutral';
            const sign = isExpense ? (isIncomeLike ? '+' : '-') : '';
            const isBank = p.paymentMethod === 'bank';
            const titleText = isExpense
                ? (p.category || (isIncomeLike ? 'Income' : 'Expense'))
                : (p.category || 'Installment');
            const bankSuffix = isBank && p.bankName && p.bankName !== '-' ? ' • ' + escapeHtml(p.bankName) : '';

            const row = document.createElement('div');
            row.className = 'share-receipt-txn';
            row.innerHTML = `
                <div class="share-receipt-txn-left">
                    <div class="share-receipt-txn-dot ${dotClass}">${isBank ? '🏦' : '💵'}</div>
                    <div>
                        <div class="share-receipt-txn-title">${escapeHtml(titleText)}<span class="share-receipt-txn-method ${isBank ? 'bank' : 'cash'}">${isBank ? 'BANK' : 'CASH'}</span></div>
                        <div class="share-receipt-txn-meta">${escapeHtml(p.paymentDate || '')} • ${escapeHtml(p.paymentTime || '')}${bankSuffix}</div>
                    </div>
                </div>
                <div class="share-receipt-txn-amount ${amountClass}">${sign}${escapeHtml(formatCurrency(p.paymentAmount))}</div>
            `;
            listEl.appendChild(row);
        });
    }

    wrapper.appendChild(card);
    document.body.appendChild(wrapper);
    return { wrapper, card };
}

async function generateReceiptCanvas() {
    const { wrapper, card } = buildShareReceiptNode();
    try {
        // Make sure the logo has actually loaded before we snapshot the card
        const logo = card.querySelector('#shareReceiptLogoImg');
        if (logo) {
            const loaded = await loadImagePromise(getShareLogoSrc());
            if (loaded) logo.src = loaded.src;
        }
        // Give the browser a frame to apply layout/fonts before capture
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

        const canvas = await html2canvas(card, {
            scale: 2,
            backgroundColor: '#ffffff',
            useCORS: true,
            allowTaint: true,
            logging: false
        });
        return canvas;
    } finally {
        wrapper.remove();
    }
}

function canvasToBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 1));
}

function downloadCanvasImage(canvas, filename) {
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    link.remove();
}

function buildShareSummaryText() {
    const isExpense = !!currentSettings.expenseMode;
    const projectName = appState.projectName || 'My Project';
    if (isExpense) {
        return `Financial Summary for ${projectName}:\n- Total Income: ${formatCurrency(appState.paidAmount || 0)}\n- Total Expenses: ${formatCurrency(appState.pendingAmount || 0)}\n- Current Balance: ${formatCurrency(appState.totalAmount || 0)}`;
    }
    return `Financial Summary for ${projectName}:\n- Total Amount: ${formatCurrency(appState.totalAmount || 0)}\n- Paid Amount: ${formatCurrency(appState.paidAmount || 0)}\n- Pending Amount: ${formatCurrency(appState.pendingAmount || 0)}`;
}

// Fallback picker shown when the native share sheet (with image attachment)
// isn't available on this device/browser.
function showShareFallbackModal(dataUrl, filename, summaryText) {
    const existing = document.getElementById('shareFallbackModal');
    if (existing) existing.remove();

    const encodedText = encodeURIComponent(summaryText);
    const modal = document.createElement('div');
    modal.id = 'shareFallbackModal';
    modal.className = 'fixed inset-0 bg-black/60 flex items-center justify-center z-[3000] p-4';
    modal.innerHTML = `
        <div class="bg-white rounded-2xl p-6 max-w-sm w-full glass-effect text-center relative animate-slide-in">
            <button id="closeShareFallbackBtn" class="absolute top-4 right-4 text-gray-500 hover:text-gray-800">
                <i class="fas fa-times text-xl"></i>
            </button>
            <img src="${dataUrl}" alt="Report preview" class="w-full rounded-xl shadow-md mb-4 border border-gray-100 max-h-64 object-contain bg-gray-50">
            <h3 class="text-xl font-bold text-gray-800 mb-1">Share Report</h3>
            <p class="text-gray-500 text-sm mb-5">Your device doesn't support direct image sharing, so download the image first, then send it via:</p>
            <div class="grid grid-cols-3 gap-3 mb-4">
                <a href="https://wa.me/?text=${encodedText}" target="_blank" rel="noopener" class="flex flex-col items-center gap-1 p-3 rounded-xl bg-green-50 hover:bg-green-100 transition-colors">
                    <i class="fab fa-whatsapp text-2xl text-green-600"></i>
                    <span class="text-xs font-semibold text-gray-700">WhatsApp</span>
                </a>
                <a href="https://t.me/share/url?url=&text=${encodedText}" target="_blank" rel="noopener" class="flex flex-col items-center gap-1 p-3 rounded-xl bg-blue-50 hover:bg-blue-100 transition-colors">
                    <i class="fab fa-telegram text-2xl text-blue-500"></i>
                    <span class="text-xs font-semibold text-gray-700">Telegram</span>
                </a>
                <button id="shareFallbackEmailBtn" class="flex flex-col items-center gap-1 p-3 rounded-xl bg-purple-50 hover:bg-purple-100 transition-colors">
                    <i class="fas fa-envelope text-2xl text-purple-600"></i>
                    <span class="text-xs font-semibold text-gray-700">Email</span>
                </button>
            </div>
            <button id="shareFallbackDownloadBtn" class="w-full btn-primary text-white font-semibold py-3 rounded-lg flex items-center justify-center gap-2 mb-2">
                <i class="fas fa-download"></i> Download Image
            </button>
            <button id="shareFallbackCopyBtn" class="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 rounded-lg flex items-center justify-center gap-2">
                <i class="fas fa-copy"></i> Copy Summary Text
            </button>
        </div>
    `;
    document.body.appendChild(modal);

    const close = () => modal.remove();
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('#closeShareFallbackBtn').addEventListener('click', close);
    modal.querySelector('#shareFallbackDownloadBtn').addEventListener('click', () => {
        const link = document.createElement('a');
        link.download = filename;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        link.remove();
        showNotification('Report image downloaded! Attach it in your chat app.', 'success');
    });
    modal.querySelector('#shareFallbackCopyBtn').addEventListener('click', () => {
        navigator.clipboard.writeText(summaryText).then(() => {
            showNotification('Summary copied to clipboard!', 'success');
        }).catch(() => {
            showNotification('Could not copy summary.', 'error');
        });
    });
    modal.querySelector('#shareFallbackEmailBtn').addEventListener('click', () => {
        window.location.href = `mailto:?subject=${encodeURIComponent('PayTrack Financial Report')}&body=${encodedText}`;
    });
}

async function shareFinancialSummary() {
    if (!appState.payments || appState.payments.length === 0) {
        if (window.hideLoading) window.hideLoading();
        showNotification('No transactions to share yet.', 'error');
        return;
    }

    try {
        const canvas = await generateReceiptCanvas();
        const summaryText = buildShareSummaryText();
        const projectSlug = (appState.projectName || 'Report').replace(/\s+/g, '_');
        const filename = `PayTrack_${projectSlug}.png`;

        const blob = await canvasToBlob(canvas);
        if (!blob) throw new Error('Could not generate report image.');

        const file = new File([blob], filename, { type: 'image/png' });
        const shareData = { files: [file], title: 'PayTrack Financial Report', text: summaryText };

        if (navigator.canShare && navigator.canShare(shareData)) {
            try {
                await navigator.share(shareData);
                showNotification('Report shared successfully!', 'success');
            } catch (shareErr) {
                if (shareErr && shareErr.name === 'AbortError') {
                    // User cancelled the native share sheet — no error needed.
                    if (window.hideLoading) window.hideLoading();
                } else {
                    throw shareErr;
                }
            }
        } else {
            const dataUrl = canvas.toDataURL('image/png');
            showShareFallbackModal(dataUrl, filename, summaryText);
            if (window.hideLoading) window.hideLoading();
        }
    } catch (err) {
        console.error('Share failed', err);
        showNotification('Could not generate or share the report.', 'error');
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
            tr.dataset.recordId = p.id;
            
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

// After the History page becomes visible, land the user straight on the
// "Transaction Records" list (skipping past the search/filter card above it).
// If we're returning from a detail view, scroll to and highlight that exact
// row instead, so the user comes right back to where they left off.
function scrollHistoryPageIntoPosition() {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const highlightId = pendingHistoryHighlightId;
            pendingHistoryHighlightId = null;

            if (highlightId != null) {
                const row = elements.historyTableBody?.querySelector(`tr[data-record-id="${highlightId}"]`);
                if (row) {
                    row.scrollIntoView({ behavior: 'auto', block: 'center' });
                    row.classList.add('history-row-highlight');
                    return;
                }
            }

            const section = document.getElementById('transactionRecordsSection');
            if (section) {
                section.scrollIntoView({ behavior: 'auto', block: 'start' });
            } else {
                window.scrollTo(0, 0);
            }
        });
    });
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
   // 6. Receipt Handling
    if (record.receipt) {
        elements.detailReceiptContainer.classList.remove('hidden');
        elements.detailReceiptLink.onclick = (e) => {
            e.preventDefault();
            
            // A. Reset the Gallery State (prevents swipe/arrow bugs)
            currentGalleryImages = [record.receipt]; 
            currentGalleryIndex = 0;

            // B. RESET THE IMAGE ELEMENT COMPLETELY
            // This removes all 'hidden', 'blur', and 'opacity-0' animation classes
            elements.receiptModalImage.className = "max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"; 
            elements.receiptModalImage.style.opacity = "1";
            elements.receiptModalImage.style.transform = "none";
            elements.receiptModalImage.src = ""; // Clear old source first
            
            // C. Hide gallery-only buttons
            document.getElementById('prevReceiptBtn').style.display = 'none';
            document.getElementById('nextReceiptBtn').style.display = 'none';
            const counter = document.getElementById('receiptCounter');
            if (counter) counter.textContent = "Receipt 1 of 1";

            // D. Set the new image and show
            elements.receiptModalImage.src = record.receipt;
            elements.receiptModal.classList.remove('hidden');
            elements.receiptModal.style.display = 'flex'; // Force center
            document.body.style.overflow = 'hidden'; 
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
    const renderVersion = chartRenderVersion;
    Object.values(activeCharts).forEach(chart => {
        if (chart && typeof chart.destroy === 'function') chart.destroy();
    });
    activeCharts = {};

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

        chartsGrid.appendChild(createPieChart(incomeData, `income-${year}`, `${year} Income`, year, 'income', renderVersion));
        chartsGrid.appendChild(createPieChart(expenseData, `expense-${year}`, `${year} Expenses`, year, 'expense', renderVersion));

        yearDiv.appendChild(chartsGrid);
        container.appendChild(yearDiv);
    });
}

function createPieChart(data, id, title, year, type, renderVersion = chartRenderVersion) {
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
        // The user may have pressed Back before this deferred callback ran.
        // Do not create an orphaned chart or leave its page in a busy state.
        if (renderVersion !== chartRenderVersion ||
            currentPage !== 'yearlyChart' ||
            !elements.yearlyChartPage.classList.contains('active')) {
            return;
        }

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

    // Use one delegated listener per render container. Replacing the handler
    // avoids stacking listeners every time the list is opened/refreshed.
    container.onclick = e => {
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
    };
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

// Runs OCR on a picked/received image file, opens the transaction modal, and
// pre-fills whatever it found. Used by both the manual "Scan Receipt" file
// picker and by an incoming receipt shared in from another app (WhatsApp,
// Gallery, etc. — see share-intent.js).
async function processScannedReceiptFile(file, type = 'expense') {
    if (elements.ocrLoadingOverlay) {
        elements.ocrLoadingOverlay.classList.remove('hidden');
        if (elements.ocrStatusText) elements.ocrStatusText.textContent = 'Reading text from image...';
    }

    try {
        const extractedData = await scanReceiptImage(file, type);

        // Open the manual form and pre-fill it with whatever we found
        openTransactionModal(type);

        if (extractedData.amount) {
            elements.modalAmount.value = extractedData.amount;
            if (typeof updateModalAmountWords === 'function') updateModalAmountWords();
            elements.modalAmount.style.backgroundColor = '#d1fae5';
            setTimeout(() => elements.modalAmount.style.backgroundColor = '', 1500);
        }

        if (extractedData.date) {
            elements.modalDate.value = extractedData.date;
        }

        if (extractedData.merchant) {
            elements.modalDescription.value = extractedData.merchant;
        }

        if (extractedData.category) {
            let options = Array.from(elements.modalCategory.options);
            let match = options.find(opt => opt.value.toLowerCase() === extractedData.category.toLowerCase());
            if (match) {
                elements.modalCategory.value = match.value;
            } else {
                elements.modalCategory.value = 'custom';
                elements.modalCustomCategoryName.value = extractedData.category;
                if (typeof handleModalCategoryChange === 'function') handleModalCategoryChange();
            }
        }

        if (extractedData.paymentMethod) {
            elements.modalPaymentMethod.value = extractedData.paymentMethod;
            if (typeof handleModalPaymentMethodChange === 'function') handleModalPaymentMethodChange();
        }

        // Auto-select the bank/wallet found on the receipt in the "Select Bank"
        // dropdown (or drop it into "+ Add Custom Bank" if it's not one of the
        // presets, e.g. JazzCash/EasyPaisa or a bank not in the default list).
        if (extractedData.bankName) {
            const bankOptions = Array.from(elements.modalBankName.options).map(opt => opt.value);
            if (bankOptions.includes(extractedData.bankName)) {
                elements.modalBankName.value = extractedData.bankName;
            } else {
                elements.modalBankName.value = 'custom';
                elements.modalCustomBankName.value = extractedData.bankName;
            }
            if (typeof handleModalBankNameChange === 'function') handleModalBankNameChange();
        }

        // Attach the scanned image as the receipt (it will be optimized to ~30KB on save)
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        elements.modalReceipt.files = dataTransfer.files;
        if (typeof handleReceiptPreview === 'function') handleReceiptPreview();

        if (elements.ocrLoadingOverlay) elements.ocrLoadingOverlay.classList.add('hidden');

        if (extractedData.amount || extractedData.date || extractedData.merchant || extractedData.bankName) {
            showNotification('Receipt scanned. Please review the details.', 'success');
        } else {
            showNotification("Couldn't read the receipt clearly. Please fill in the details.", 'error');
        }

    } catch (err) {
        console.error('Receipt scan failed:', err);
        if (elements.ocrLoadingOverlay) elements.ocrLoadingOverlay.classList.add('hidden');
        showNotification('Scan failed. Please fill details manually.', 'error');
        openTransactionModal(type);
    }
}

// --- RECEIPT SCANNING (on-device OCR, no external API / no data leaves the device) ---
//
// Tuned against real Bank Alfalah, Allied Bank, BankIslami, DIB, EasyPaisa, HBL, and
// JazzCash receipt screenshots (Pakistani bank/wallet transaction confirmations), plus
// generic paper receipts. These UIs vary a lot in layout, so extraction is label-driven
// wherever possible (e.g. "Total Amount", "Sent to", "Transaction Date & Time") with
// sensible fallbacks when no label is found.

// 1. Run OCR on the picked file and parse the recognized text into form fields.
async function scanReceiptImage(file, type = 'expense') {
    if (typeof Tesseract === 'undefined') {
        throw new Error('OCR engine not available');
    }

    const setStatus = (msg) => { if (elements.ocrStatusText) elements.ocrStatusText.textContent = msg; };

    const worker = await Tesseract.createWorker('eng', 1, {
        logger: (m) => {
            if (m.status === 'recognizing text') {
                setStatus(`Reading text from image... ${Math.round((m.progress || 0) * 100)}%`);
            } else if (m.status) {
                setStatus('Preparing scanner...');
            }
        }
    });

    let primaryLines = [];
    let secondaryLines = null; // only computed if needed

    try {
        // Pass 1: treat the receipt as one uniform block of text. This reads most
        // app-style "label / value" receipts (bank & wallet screenshots) top-to-bottom
        // correctly, keeping each label next to its value.
        await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK });
        const { data: { text: blockText } } = await worker.recognize(file);
        primaryLines = toLines(blockText);

        let amount = extractReceiptAmountConfident(primaryLines);
        let date = extractReceiptDate(primaryLines.join('\n'));

        // Pass 2 (only if something important is still missing): automatic page
        // segmentation. This helps on busy backgrounds (e.g. chat-style screenshots)
        // or documents where pass 1 missed a line entirely.
        if (amount === null || date === null) {
            setStatus('Re-reading image...');
            await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.AUTO });
            const { data: { text: autoText } } = await worker.recognize(file);
            secondaryLines = toLines(autoText);

            if (amount === null) {
                const amountRetry = extractReceiptAmountConfident(secondaryLines);
                if (amountRetry !== null) amount = amountRetry;
            }
            if (date === null) {
                const dateRetry = extractReceiptDate(secondaryLines.join('\n'));
                if (dateRetry !== null) date = dateRetry;
            }
        }

        // Only guess a plain, unlabeled number once both passes have had a real chance.
        if (amount === null) {
            const allLines = secondaryLines ? primaryLines.concat(secondaryLines) : primaryLines;
            amount = extractReceiptAmountLastResort(allLines);
        }

        const merchant = extractReceiptMerchant(primaryLines, type) || (secondaryLines && extractReceiptMerchant(secondaryLines, type));
        const combinedLower = (primaryLines.join(' ') + ' ' + (secondaryLines ? secondaryLines.join(' ') : '')).toLowerCase();
        // Try the fixed-layout template fingerprints first (catches app receipts whose
        // wording could otherwise be misread as a different bank), then fall back to a
        // plain search for a recognizable bank/wallet name anywhere on the receipt.
        const bankName = detectReceiptTemplate(primaryLines)
            || (secondaryLines && detectReceiptTemplate(secondaryLines))
            || extractReceiptBankName(primaryLines)
            || (secondaryLines && extractReceiptBankName(secondaryLines));

        return {
            amount,
            date,
            merchant,
            bankName,
            category: guessReceiptCategory(combinedLower, type),
            // Finding a recognizable bank/wallet name is a strong signal this was a
            // bank transaction, even if no explicit "bank"/"transferred" keyword was seen.
            paymentMethod: bankName ? 'bank' : guessReceiptPaymentMethod(combinedLower)
        };
    } finally {
        await worker.terminate();
    }
}

function toLines(rawText) {
    return (rawText || '').split('\n').map(l => l.trim()).filter(Boolean);
}

// 2. Amount extraction: search for the most specific label first ("Grand Total"),
// falling back to progressively more generic labels, then to any currency-prefixed
// number on the receipt (skipping ones that sit next to "Fee"/"Charge"/"Fine").
const AMOUNT_LABEL_TIERS = [
    ['grand total'],
    ['total amount', 'net total', 'amount sent', 'amount received', 'transaction amount', 'amount paid'],
    ['amount']
];
const AMOUNT_EXCLUDE_KEYWORDS = ['fee', 'charge', 'fine', 'tax'];

function numberFromLine(line) {
    const m = line.match(/(?:rs\.?|pkr|₹|\$|€|£)?\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i);
    if (!m) return null;
    const val = parseFloat(m[1].replace(/,/g, ''));
    return isNaN(val) ? null : val;
}

// "Confident" extraction: only returns a value when a recognizable label (Amount,
// Total, etc.) or a currency symbol backs it up. Returns null rather than guessing,
// so the caller knows it can still be worth retrying with a different OCR pass.
function extractReceiptAmountConfident(lines) {
    for (const tier of AMOUNT_LABEL_TIERS) {
        for (let i = 0; i < lines.length; i++) {
            const lower = lines[i].toLowerCase();
            const hasLabel = tier.some(kw => lower.includes(kw));
            const isExcluded = AMOUNT_EXCLUDE_KEYWORDS.some(kw => lower.includes(kw));
            if (!hasLabel || isExcluded) continue;
            for (let j = i; j < Math.min(i + 3, lines.length); j++) {
                const val = numberFromLine(lines[j]);
                if (val !== null && val > 0) return val;
            }
        }
    }

    // Fallback: any currency-prefixed number, skipping ones near a fee/charge/fine label
    const candidates = [];
    for (let i = 0; i < lines.length; i++) {
        if (!/(?:rs\.?|pkr|₹)\s*[\d,]+/i.test(lines[i])) continue;
        const neighborhood = lines.slice(Math.max(0, i - 1), i + 2).join(' ').toLowerCase();
        if (AMOUNT_EXCLUDE_KEYWORDS.some(kw => neighborhood.includes(kw))) continue;
        const val = numberFromLine(lines[i]);
        if (val !== null && val > 0) candidates.push(val);
    }
    return candidates.length > 0 ? candidates[0] : null;
}

// True last resort: the largest plain number anywhere on the receipt (no label or
// currency symbol needed). Only used once both OCR passes have been tried and neither
// found a confident, labeled amount.
function extractReceiptAmountLastResort(lines) {
    const allNumbers = (lines.join(' ').match(/\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?/g) || [])
        .map(s => parseFloat(s.replace(/,/g, '')))
        .filter(v => !isNaN(v) && v > 0 && v < 10000000);
    return allNumbers.length ? Math.max(...allNumbers) : null;
}

// 3. Date extraction: tries several common formats seen on local bank/wallet receipts.
function extractReceiptDate(rawText) {
    const pad = (n) => String(n).padStart(2, '0');
    const monthNames = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
    const isValid = (y, mo, d) => y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31;

    // yyyy-mm-dd / yyyy/mm/dd
    let m = rawText.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
    if (m) {
        const y = +m[1], mo = +m[2], d = +m[3];
        if (isValid(y, mo, d)) return `${y}-${pad(mo)}-${pad(d)}`;
    }

    // "05 October 2024" / "12 Jan 2026"
    m = rawText.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
    if (m) {
        const mo = monthNames[m[2].slice(0, 3).toLowerCase()];
        const d = +m[1], y = +m[3];
        if (mo && isValid(y, mo, d)) return `${y}-${pad(mo)}-${pad(d)}`;
    }

    // "Jan 12, 2026"
    m = rawText.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/);
    if (m) {
        const mo = monthNames[m[1].slice(0, 3).toLowerCase()];
        const d = +m[2], y = +m[3];
        if (mo && isValid(y, mo, d)) return `${y}-${pad(mo)}-${pad(d)}`;
    }

    // dd/mm/yyyy, dd-mm-yy, etc. (day-first; flips only if day is clearly invalid as a day)
    m = rawText.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (m) {
        let d = +m[1], mo = +m[2];
        let y = +m[3];
        if (y < 100) y += 2000;
        if (d > 12 && mo <= 12) {
            // d is clearly the day
        } else if (mo > 12 && d <= 12) {
            [d, mo] = [mo, d];
        }
        if (isValid(y, mo, d)) return `${y}-${pad(mo)}-${pad(d)}`;
    }

    return null; // caller keeps today's date as default
}

// 4. Merchant / counterparty extraction: label-driven, tuned to "To / Sent to / Sending
// to / Billing Company Name / Bundle Name" (money going out) and "From / Sending from /
// Sent by / From Account" (money coming in), with guards against OCR noise so we don't
// hand back garbled text (masked account numbers, stray symbols, etc).
const EXPENSE_MERCHANT_LABELS = ['sending to', 'sent to', 'paid to', 'to account title', 'to account', 'billing company name', 'bundle name', 'to'];
const INCOME_MERCHANT_LABELS = ['sending from', 'sent by', 'from account', 'received from', 'from'];

function cleanCandidate(s) {
    let str = (s || '').trim().replace(/^[.,:;\-()\[\]\s]+|[.,:;\-()\[\]\s]+$/g, '');
    const words = str.split(/\s+/);
    while (words.length > 1 && words[0].length <= 2 && !/^\d+$/.test(words[0])) {
        words.shift();
    }
    return words.join(' ');
}

function looksLikeName(s) {
    if (!s) return false;
    const str = s.trim();
    if (str.includes('/')) return false;
    if (str.length < 2 || str.length > 60) return false;
    const letters = (str.match(/[A-Za-z]/g) || []).length;
    if (letters / str.length < 0.5) return false;
    if (/^(pkr|rs\.?|account|others?|raast|status|success(ful)?|transaction|amount|fee|charges?|free|purpose|type|date|time)$/i.test(str)) return false;
    if (/\b(\w+)\s+\1\b/i.test(str)) return false; // repeated word -> likely a garbled masked field
    const words = str.split(/\s+/);
    const shortWordRatio = words.filter(w => w.length <= 2).length / words.length;
    if (shortWordRatio > 0.6) return false;
    return true;
}

function findLabeledValue(lines, labels) {
    for (const label of labels) {
        const core = label.replace(/\s+/g, '\\s+');
        const re = new RegExp('\\b' + core + '\\b\\s*[:\\-]?\\s*(.*)$', 'i');
        for (let i = 0; i < lines.length; i++) {
            if (label === 'to' && /account|iban/i.test(lines[i])) continue;
            const m = lines[i].match(re);
            if (!m || m.index > 5) continue;
            const inline = cleanCandidate(m[1]);
            if (inline && looksLikeName(inline)) return inline;
            for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
                const candidate = cleanCandidate(lines[j]);
                if (looksLikeName(candidate)) return candidate;
            }
        }
    }
    return null;
}

function extractReceiptMerchant(lines, type) {
    const labels = type === 'income' ? INCOME_MERCHANT_LABELS : EXPENSE_MERCHANT_LABELS;
    const labeled = findLabeledValue(lines, labels);
    if (labeled) return labeled;

    // Fallback: the first plausible-looking line near the top (works for plain paper
    // receipts/invoices that don't use a label:value layout at all).
    const skipPattern = /^(receipt|invoice|tax\s*invoice|order\s*#|date|time|cashier|www\.|http|purpose|transaction\s*(type|successful)|reference|ref\s*#|account|iban)/i;
    for (let i = 0; i < Math.min(lines.length, 5); i++) {
        const line = lines[i];
        if (line.length < 6) continue;
        const digitRatio = (line.replace(/[^0-9]/g, '').length) / Math.max(line.length, 1);
        if (digitRatio > 0.4) continue;
        if (skipPattern.test(line)) continue;
        if (extractReceiptDate(line)) continue;
        return line.length > 60 ? line.slice(0, 60) : line;
    }
    return null;
}

// 5. Category guess: simple keyword matching against the recognized text.
function guessReceiptCategory(lowerText, type) {
    const categoryKeywords = type === 'income'
        ? {
            Salary: ['salary', 'payroll', 'wages'],
            Freelance: ['freelance', 'invoice', 'contract'],
            Investment: ['dividend', 'interest', 'investment', 'stocks'],
            Gift: ['gift']
        }
        : {
            Food: ['restaurant', 'cafe', 'coffee', 'food', 'pizza', 'burger', 'kitchen', 'bakery', 'grocery', 'supermarket', 'mart'],
            Transport: ['uber', 'careem', 'taxi', 'fuel', 'petrol', 'diesel', 'parking', 'transport', 'cng'],
            Bills: ['electricity', 'water bill', 'gas bill', 'internet', 'wifi', 'telecom', 'utility', 'bill payment', 'bundle', 'top-up', 'topup', 'airtime', 'tuition', 'dues', 'university', 'college', 'semester', 'fee challan'],
            Shopping: ['mall', 'store', 'fashion', 'clothing', 'shoes', 'electronics', 'apparel'],
            Health: ['pharmacy', 'hospital', 'clinic', 'medical', 'medicine', 'drug store'],
            Entertainment: ['cinema', 'movie', 'theatre', 'netflix', 'game', 'concert']
        };

    for (const [category, keywords] of Object.entries(categoryKeywords)) {
        if (keywords.some(kw => lowerText.includes(kw))) return category;
    }
    return null; // leave default category selection untouched
}

// 6. Payment method guess.
function guessReceiptPaymentMethod(lowerText) {
    const bankKeywords = ['visa', 'mastercard', 'debit', 'credit card', 'card payment', 'atm card', 'raast', 'ibft', 'transferred', 'transaction successful', 'bank transfer', 'account'];
    const cashKeywords = ['cash paid', 'cash received', 'change due'];
    if (cashKeywords.some(kw => lowerText.includes(kw))) return 'cash';
    if (bankKeywords.some(kw => lowerText.includes(kw))) return 'bank';
    if (lowerText.includes('cash')) return 'cash';
    return null; // leave default selection untouched
}

// 7. Bank / mobile-wallet name detection: matches the bank & wallet brand names that
// show up on real transaction receipts (bank app screenshots, wallet confirmations,
// fee challans) so the "Select Bank" dropdown can be auto-selected after a scan.
// Canonical names for the six banks already in the app's default dropdown match those
// option values exactly so they select directly; everything else falls back to the
// "+ Add Custom Bank" field, pre-filled with the detected name.
const BANK_NAME_PATTERNS = [
    // Already in the default "Select Bank" list -> select directly.
    { name: 'Habib Bank Limited', patterns: [/habib\s*bank/i, /\bhbl\b/i] },
    { name: 'MCB Bank Limited', patterns: [/\bmcb\b/i] },
    { name: 'United Bank Limited', patterns: [/united\s*bank/i, /\bubl\b/i] },
    { name: 'Allied Bank Limited', patterns: [/allied\s*bank/i] },
    { name: 'Bank Alfalah', patterns: [/bank\s*alfalah/i, /alfalah/i] },
    { name: 'Faysal Bank', patterns: [/faysal\s*bank/i] },
    { name: 'Standard Chartered Bank', patterns: [/standard\s*chartered/i] },
    { name: 'Meezan Bank', patterns: [/meezan/i] },
    { name: 'Bank Islami', patterns: [/bank\s*islami/i, /bankislami/i] },
    // Not in the default list -> land in the custom-bank field, pre-filled.
    { name: 'Dubai Islamic Bank', patterns: [/dubai\s*islamic/i, /\bdib\b/i] },
    { name: 'Bank of Punjab', patterns: [/bank\s*of\s*punjab/i, /\bbop\b/i] },
    { name: 'Askari Bank', patterns: [/askari\s*bank/i] },
    { name: 'JS Bank', patterns: [/\bjs\s*bank\b/i] },
    { name: 'Soneri Bank', patterns: [/soneri/i] },
    { name: 'Silk Bank', patterns: [/silk\s*bank/i] },
    { name: 'Habib Metropolitan Bank', patterns: [/habib\s*metro/i] },
    { name: 'Al Baraka Bank', patterns: [/al\s*baraka/i] },
    { name: 'National Bank of Pakistan', patterns: [/national\s*bank\s*of\s*pakistan/i, /\bnbp\b/i] },
    { name: 'JazzCash', patterns: [/jazz\s*cash/i, /jazzcash/i] },
    { name: 'EasyPaisa', patterns: [/easy\s*paisa/i, /easypaisa/i] },
    { name: 'SadaPay', patterns: [/sada\s*pay/i] },
    { name: 'NayaPay', patterns: [/naya\s*pay/i] },
    { name: 'UPaisa', patterns: [/u\s*paisa/i, /upaisa/i] }
];

// Scans top-to-bottom (a receipt's most prominent bank/wallet branding is usually the
// first one mentioned, e.g. a header logo or "Securely paid via" footer) and returns
// the canonical name of the first bank/wallet whose pattern matches. Returns null
// rather than guessing when nothing recognizable is found.
function extractReceiptBankName(lines) {
    for (const line of lines) {
        for (const bank of BANK_NAME_PATTERNS) {
            if (bank.patterns.some(re => re.test(line))) return bank.name;
        }
    }
    return null;
}

// --- APP-SPECIFIC RECEIPT TEMPLATE FINGERPRINTS ---
// A handful of banking apps' own receipt screenshots don't print the bank's own
// name anywhere reliable — or worse, print a *different* bank's name prominently
// (e.g. Dubai Islamic Bank's app receipt shows the recipient's bank, "BankIslami
// Aik", which would otherwise get misread as a BankIslami receipt). For those, the
// receipt's fixed layout/wording is a more reliable fingerprint than searching the
// text for a bank name. Checked before the generic name search below, and requires
// several matching labels (not just one) so a receipt only needs to share a single
// word with another template to still be told apart correctly.
const RECEIPT_TEMPLATE_FINGERPRINTS = [
    {
        // BankIslami app's own "Payment Receipt": Status/Success badge, From Account,
        // To Account, Transaction Date & Time, Purpose of Payment, Transaction Type, Fee Charges.
        name: 'Bank Islami',
        signals: [
            /from\s*account/i,
            /to\s*account/i,
            /transaction\s*date\s*&?\s*time/i,
            /purpose\s*of\s*payment/i,
            /fee\s*charges/i
        ],
        minSignals: 3
    },
    {
        // Dubai Islamic Bank (DIB) app's own "Transaction Successful" receipt:
        // Amount sent, Sending from, Sending to, Transaction Fee, Transaction Ref No.
        name: 'Dubai Islamic Bank',
        signals: [
            /transaction\s*successful/i,
            /amount\s*sent/i,
            /sending\s*from/i,
            /sending\s*to/i,
            /transaction\s*ref\s*no/i
        ],
        minSignals: 3
    }
];

function detectReceiptTemplate(lines) {
    const text = lines.join(' ');
    for (const tpl of RECEIPT_TEMPLATE_FINGERPRINTS) {
        const hits = tpl.signals.filter(re => re.test(text)).length;
        if (hits >= tpl.minSignals) return tpl.name;
    }
    return null;
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