document.addEventListener('DOMContentLoaded', function () {
    const currentResetTimeSpan = document.getElementById('currentResetTime');
    const resetTimeInput = document.getElementById('resetTimeInput');
    const saveResetTimeButton = document.getElementById('saveResetTime');
    const exportDataButton = document.getElementById('exportData');
    const importDataButton = document.getElementById('importData');
    const importFileInput = document.getElementById('importFile');

    // New elements for scheduling blocking time
    const scheduleStartInput = document.getElementById('scheduleStartInput');
    const scheduleEndInput = document.getElementById('scheduleEndInput');
    const saveScheduleButton = document.getElementById('saveSchedule');
    const currentScheduleSpan = document.getElementById('currentSchedule');

    // Load current reset time
    browser.storage.local.get('resetTime').then((result) => {
        const resetTime = result.resetTime || '01:00';
        currentResetTimeSpan.textContent = resetTime;
        resetTimeInput.value = resetTime;
    });

    // Load current schedule
    browser.storage.local.get('blockSchedule').then((result) => {
        const schedule = result.blockSchedule || { start: '09:00', end: '17:00' };
        currentScheduleSpan.textContent = `${schedule.start} - ${schedule.end}`;
        scheduleStartInput.value = schedule.start;
        scheduleEndInput.value = schedule.end;
    });

    // Save reset time
    saveResetTimeButton.addEventListener('click', function () {
        const newResetTime = resetTimeInput.value;
        browser.storage.local.set({ resetTime: newResetTime }).then(() => {
            currentResetTimeSpan.textContent = newResetTime;
            alert('Reset time saved successfully!');
            browser.runtime.sendMessage({ action: "updateResetTime", resetTime: newResetTime });
        });
    });

    // Save schedule
    saveScheduleButton.addEventListener('click', function () {
        console.log("Save Schedule button clicked");
        const newSchedule = {
            start: scheduleStartInput.value,
            end: scheduleEndInput.value
        };
        console.log("New schedule to be saved:", newSchedule);

        browser.storage.local.set({ blockSchedule: newSchedule })
            .then(() => {
                console.log("Schedule saved to storage successfully");
                currentScheduleSpan.textContent = `${newSchedule.start} - ${newSchedule.end}`;
                alert('Blocking schedule saved successfully!');
                return browser.runtime.sendMessage({ action: "updateBlockSchedule", schedule: newSchedule });
            })
            .then(() => {
                console.log("Message sent to background script");
            })
            .catch(error => {
                console.error("Error saving blocking schedule:", error);
                alert('Error saving blocking schedule. Please try again.');
            });
    });

    // Export data
    exportDataButton.addEventListener('click', function () {
        browser.storage.local.get().then((data) => {
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'website_blocker_data.json';
            a.click();
            URL.revokeObjectURL(url);
        });
    });

    // Import data
    importDataButton.addEventListener('click', function () {
        importFileInput.click();
    });

    importFileInput.addEventListener('change', function (event) {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function (e) {
                try {
                    const data = JSON.parse(e.target.result);
                    browser.storage.local.set(data).then(() => {
                        alert('Data imported successfully!');
                        browser.runtime.sendMessage({ action: "updateAll" });
                    });
                } catch (error) {
                    alert('Error importing data. Please make sure the file is valid.');
                }
            };
            reader.readAsText(file);
        }
    });

    // New elements for individual site schedules
    const siteScheduleInput = document.getElementById('siteScheduleInput');
    const siteMorningStartInput = document.getElementById('siteMorningStartInput');
    const siteMorningEndInput = document.getElementById('siteMorningEndInput');
    const siteAfternoonStartInput = document.getElementById('siteAfternoonStartInput');
    const siteAfternoonEndInput = document.getElementById('siteAfternoonEndInput');
    const saveSiteScheduleButton = document.getElementById('saveSiteSchedule');
    const siteSchedulesList = document.getElementById('siteSchedulesList');

    // Load site schedules
    function loadSiteSchedules() {
        console.log("Loading site schedules...");
        browser.storage.local.get('siteSchedules').then((result) => {
            const siteSchedules = result.siteSchedules || {};
            console.log("Retrieved site schedules:", siteSchedules);
            siteSchedulesList.innerHTML = '';
            if (Object.keys(siteSchedules).length === 0) {
                console.log("No site schedules found.");
                const emptyMessage = document.createElement('li');
                emptyMessage.className = 'empty-message';
                emptyMessage.textContent = 'No site-specific schedules set';
                siteSchedulesList.appendChild(emptyMessage);
            } else {
                for (const [site, schedules] of Object.entries(siteSchedules)) {
                    console.log(`Adding schedule for ${site}:`, schedules);
                    addSiteScheduleToList(site, schedules);
                }
            }
        }).catch(error => {
            console.error("Error loading site schedules:", error);
        });
    }

    function addSiteScheduleToList(site, schedules) {
        console.log(`Adding ${site} to the list`);

        const listItem = document.createElement('li');
        listItem.className = 'site-item';

        const siteName = document.createElement('span');
        siteName.className = 'site-name';
        siteName.textContent = site;
        listItem.appendChild(siteName);

        const siteControls = document.createElement('div');
        siteControls.className = 'site-controls';

        const scheduleTimes = document.createElement('span');
        scheduleTimes.className = 'schedule-times';
        scheduleTimes.textContent = `Morning: ${schedules.morning.start} - ${schedules.morning.end}, Afternoon: ${schedules.afternoon.start} - ${schedules.afternoon.end}`;
        siteControls.appendChild(scheduleTimes);

        const removeButton = document.createElement('button');
        removeButton.className = 'remove-btn';
        removeButton.textContent = 'Remove';
        removeButton.onclick = () => removeSiteSchedule(site);
        siteControls.appendChild(removeButton);

        listItem.appendChild(siteControls);

        siteSchedulesList.appendChild(listItem);
        console.log(`Added ${site} to the list`);
    }

    function removeSiteSchedule(site) {
        browser.storage.local.get('siteSchedules').then((result) => {
            const siteSchedules = result.siteSchedules || {};
            delete siteSchedules[site];
            browser.storage.local.set({ siteSchedules }).then(() => {
                loadSiteSchedules();
                browser.runtime.sendMessage({ action: "updateSiteSchedules" });
            });
        });
    }

    saveSiteScheduleButton.addEventListener('click', function () {
        console.log("Save Site Schedule button clicked");
        const site = siteScheduleInput.value.toLowerCase().replace(/^www\./, '');
        if (!site) {
            console.log("No website entered");
            alert('Please enter a website');
            return;
        }
        const newSchedules = {
            morning: {
                start: siteMorningStartInput.value,
                end: siteMorningEndInput.value
            },
            afternoon: {
                start: siteAfternoonStartInput.value,
                end: siteAfternoonEndInput.value
            }
        };
        console.log(`Attempting to save schedule for ${site}:`, newSchedules);
        browser.storage.local.get('siteSchedules')
            .then((result) => {
                console.log("Retrieved existing site schedules:", result.siteSchedules);
                const siteSchedules = result.siteSchedules || {};
                siteSchedules[site] = newSchedules;
                console.log("Updated site schedules:", siteSchedules);
                return browser.storage.local.set({ siteSchedules });
            })
            .then(() => {
                console.log("Site schedules saved successfully");
                loadSiteSchedules();
                siteScheduleInput.value = '';
                siteMorningStartInput.value = '';
                siteMorningEndInput.value = '';
                siteAfternoonStartInput.value = '';
                siteAfternoonEndInput.value = '';
                alert('Site schedule saved successfully!');
                return browser.runtime.sendMessage({ action: "updateSiteSchedules" });
            })
            .then(() => {
                console.log("Message sent to background script");
            })
            .catch(error => {
                console.error("Error saving site schedules:", error);
                alert('Error saving site schedule. Please try again.');
            });
    });

    // Initial load
    console.log("Initial load of site schedules");
    loadSiteSchedules();

    // Add this function to log the current state of site schedules
    function logSiteSchedules() {
        browser.storage.local.get('siteSchedules').then((result) => {
            console.log("Current site schedules:", result.siteSchedules);
        }).catch(error => {
            console.error("Error retrieving site schedules:", error);
        });
    }

    // Call this function after saving a new schedule and on initial load
    logSiteSchedules();

    // Add this function to log the current state of block schedule
    function logBlockSchedule() {
        browser.storage.local.get('blockSchedule').then((result) => {
            console.log("Current block schedule:", result.blockSchedule);
        }).catch(error => {
            console.error("Error retrieving block schedule:", error);
        });
    }

    // Call this function after saving a new schedule and on initial load
    logBlockSchedule();
});