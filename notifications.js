import { LocalNotifications } from '@capacitor/local-notifications';

export async function requestNotificationPermission() {
    const status = await LocalNotifications.requestPermissions();
    return status.display === 'granted';
}

export async function scheduleAppNotifications() {
    // 1. Clear all previous schedules to avoid duplicates
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length > 0) {
        await LocalNotifications.cancel(pending);
    }

    const settings = JSON.parse(localStorage.getItem('dashboardGlobalSettings')) || {};
    const projects = JSON.parse(localStorage.getItem('allTrackerProjects')) || [];
    const notificationsToSchedule = [];

    // --- 2. FINANCE REMINDER (DAILY @ 6 PM) ---
    const hasFinanceProject = projects.some(p => p.type === 'finance');
    if (hasFinanceProject && settings.financeReminderEnabled) {
        notificationsToSchedule.push({
            id: 101,
            title: "💰 PayTrack Finance",
            body: "Don't forget to add today's transactions to keep your balance updated!",
            schedule: { on: { hour: 18, minute: 0 }, repeats: true },
            sound: 'default',
            actionTypeId: 'OPEN_APP'
        });
    }

    // --- 3. INSTALLMENT REMINDER (USER CUSTOM) ---
    if (settings.installmentReminderEnabled) {
        const [hour, minute] = (settings.installmentReminderTime || "10:00").split(':').map(Number);
        notificationsToSchedule.push({
            id: 102,
            title: "📅 Installment Due",
            body: "It's your scheduled day to check and add your monthly installment payments.",
            schedule: { 
                on: { 
                    day: parseInt(settings.installmentReminderDay) || 1, 
                    hour: hour, 
                    minute: minute 
                }, 
                repeats: true 
            },
            sound: 'default'
        });
    }

    if (notificationsToSchedule.length > 0) {
        await LocalNotifications.schedule({ notifications: notificationsToSchedule });
        console.log("Notifications Scheduled:", notificationsToSchedule);
    }
}