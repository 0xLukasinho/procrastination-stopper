// Initialize when the DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  // Set up tab navigation first
  setupTabs();
  
  // Set up all event listeners including sort
  setupEventListeners();
  
  // Load settings and data
  loadGeneralSettings();
  loadPomodoroSettings();
  
  // Set up initial sort state
  updateSortUI();
  
  // Initialize dark mode
  chrome.storage.local.get('settings', (result) => {
    if (result.settings && result.settings.darkMode) {
      document.body.classList.add('dark-mode');
    }
  });
});

// Constants for pagination
const ITEMS_PER_PAGE = 15;
let currentPage = 1;

// Track current sort state
let currentSort = {
  column: 'timeSpent',
  direction: 'desc'
};

// Load general settings
function loadGeneralSettings() {
  chrome.storage.local.get(['settings', 'pomodoroSettings'], (result) => {
    const settings = result.settings || {};
    const pomodoroSettings = result.pomodoroSettings || {};
    
    // Theme settings
    if (settings.darkMode) {
      document.getElementById('darkMode').checked = settings.darkMode;
      if (settings.darkMode) {
        document.body.classList.add('dark-mode');
      }
    }
    
    // Notification settings
    if (settings.showNotifications !== undefined) {
      document.getElementById('showNotifications').checked = settings.showNotifications;
    }
    
    if (settings.notificationSound !== undefined) {
      document.getElementById('notificationSound').checked = settings.notificationSound;
    }
    
    // Extension behavior
    if (settings.startAtBoot !== undefined) {
      document.getElementById('startAtBoot').checked = settings.startAtBoot;
    }
    
    if (settings.trackIncognito !== undefined) {
      document.getElementById('trackIncognito').checked = settings.trackIncognito;
    }
    
    // Timer settings
    if (pomodoroSettings.pomodoro) {
      document.getElementById('pomodoroTime').value = pomodoroSettings.pomodoro;
    }
    
    if (pomodoroSettings.shortBreak) {
      document.getElementById('shortBreakTime').value = pomodoroSettings.shortBreak;
    }
    
    if (pomodoroSettings.longBreak) {
      document.getElementById('longBreakTime').value = pomodoroSettings.longBreak;
    }
    
    if (pomodoroSettings.longBreakInterval) {
      document.getElementById('longBreakInterval').value = pomodoroSettings.longBreakInterval;
    }
    
    if (pomodoroSettings.autoStartBreaks !== undefined) {
      document.getElementById('autoStartBreaks').checked = pomodoroSettings.autoStartBreaks;
    }
    
    if (pomodoroSettings.autoStartPomodoros !== undefined) {
      document.getElementById('autoStartPomodoros').checked = pomodoroSettings.autoStartPomodoros;
    }
  });
}

// Load website data
function loadWebsiteData() {
  chrome.storage.local.get(['websites', 'searchTerm', 'sortColumn', 'sortDirection'], (result) => {
    let websites = result.websites || [];
    const searchTerm = result.searchTerm || '';
    const sortColumn = result.sortColumn || 'timeSpent';
    const sortDirection = result.sortDirection || 'desc';
    
    // Apply search filter if exists
    if (searchTerm) {
      websites = websites.filter(site => 
        site.domain.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    // Sort websites using the same logic as sortWebsites
    websites.sort((a, b) => {
      let result = 0;
      
      // Sort based on column
      if (sortColumn === 'domain') {
        const domainA = String(a.domain || '').toLowerCase();
        const domainB = String(b.domain || '').toLowerCase();
        result = domainA.localeCompare(domainB);
      } 
      else if (sortColumn === 'timeSpent') {
        // Calculate total time from dailyUsage for both websites
        let timeA = 0;
        let timeB = 0;
        
        if (a.dailyUsage) {
          timeA = Object.values(a.dailyUsage).reduce((sum, time) => sum + time, 0);
        }
        if (b.dailyUsage) {
          timeB = Object.values(b.dailyUsage).reduce((sum, time) => sum + time, 0);
        }
        
        result = timeA - timeB;
      }
      else if (sortColumn === 'timeLimit') {
        // Special handling for timeLimit sorting
        // If both have limits, compare them normally
        if (a.timeLimit && b.timeLimit) {
          result = Number(a.timeLimit) - Number(b.timeLimit);
        }
        // If only a has a limit, a comes first
        else if (a.timeLimit && !b.timeLimit) {
          result = -1;
        }
        // If only b has a limit, b comes first
        else if (!a.timeLimit && b.timeLimit) {
          result = 1;
        }
        // If neither has a limit, they're equal
        else {
          result = 0;
        }
      }
      
      // Apply sort direction
      return sortDirection === 'asc' ? result : -result;
    });
    
    // Calculate max page and validate current page
    const maxPage = Math.ceil(websites.length / ITEMS_PER_PAGE) || 1;
    if (currentPage > maxPage) {
      currentPage = maxPage;
    }
    
    // Update table and pagination
    updateWebsiteTable(websites);
  });
}

// Update website table with pagination
function updateWebsiteTable(websites) {
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const pageItems = websites.slice(startIndex, endIndex);
  
  const tbody = document.getElementById('websiteTableBody');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  pageItems.forEach(website => {
    const row = document.createElement('tr');
    
    // Website domain cell
    const domainCell = document.createElement('td');
    domainCell.textContent = website.domain;
    row.appendChild(domainCell);
    
    // Time spent cell - calculate total from dailyUsage
    const timeSpentCell = document.createElement('td');
    let totalTime = 0;
    
    if (website.dailyUsage) {
      totalTime = Object.values(website.dailyUsage).reduce((sum, time) => sum + time, 0);
    }
    
    timeSpentCell.textContent = formatTime(totalTime);
    timeSpentCell.dataset.seconds = totalTime;
    row.appendChild(timeSpentCell);
    
    // Time limit cell
    const timeLimitCell = document.createElement('td');
    timeLimitCell.textContent = website.timeLimit ? `${website.timeLimit} minutes` : 'No limit';
    timeLimitCell.dataset.minutes = website.timeLimit || 0;
    row.appendChild(timeLimitCell);
    
    // Actions cell
    const actionsCell = document.createElement('td');
    
    const editBtn = document.createElement('button');
    editBtn.className = 'edit-btn';
    editBtn.innerHTML = '✎';
    editBtn.title = 'Edit';
    editBtn.onclick = () => showEditWebsiteModal(website.domain, website.timeLimit);
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.innerHTML = '×';
    deleteBtn.title = 'Delete';
    deleteBtn.onclick = () => deleteWebsite(website.domain);
    
    actionsCell.appendChild(editBtn);
    actionsCell.appendChild(deleteBtn);
    row.appendChild(actionsCell);
    
    tbody.appendChild(row);
  });
  
  // Update pagination UI
  const websiteList = document.querySelector('.website-list');
  if (!websiteList) return;
  
  const currentPageSpan = websiteList.querySelector('#currentPage');
  const prevBtn = websiteList.querySelector('.prev-page');
  const nextBtn = websiteList.querySelector('.next-page');
  
  if (currentPageSpan) currentPageSpan.textContent = currentPage;
  if (prevBtn) prevBtn.disabled = currentPage <= 1;
  if (nextBtn) nextBtn.disabled = endIndex >= websites.length;
  
  const pagination = websiteList.querySelector('.pagination');
  if (pagination) {
    pagination.style.display = websites.length > ITEMS_PER_PAGE ? 'flex' : 'none';
  }
}

// Setup pagination
function setupPagination() {
  const websiteList = document.querySelector('.website-list');
  if (!websiteList) return;
  
  const prevBtn = websiteList.querySelector('.prev-page');
  const nextBtn = websiteList.querySelector('.next-page');
  
  if (!prevBtn || !nextBtn) {
    console.error('Pagination elements not found');
    return;
  }
  
  // Previous page button
  prevBtn.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      loadWebsiteData();
    }
  });
  
  // Next page button
  nextBtn.addEventListener('click', () => {
    chrome.storage.local.get(['websites', 'searchTerm', 'sortColumn', 'sortDirection'], (result) => {
      let websites = result.websites || [];
      const searchTerm = result.searchTerm || '';
      const sortColumn = result.sortColumn || 'timeSpent';
      const sortDirection = result.sortDirection || 'desc';
      
      // Apply same filtering as in loadWebsiteData
      if (searchTerm) {
        websites = websites.filter(site => 
          site.domain.toLowerCase().includes(searchTerm.toLowerCase())
        );
      }
      
      // Apply same sorting as in loadWebsiteData
      websites.sort((a, b) => {
        const aValue = a[sortColumn];
        const bValue = b[sortColumn];
        if (sortDirection === 'asc') {
          return aValue > bValue ? 1 : -1;
        } else {
          return aValue < bValue ? 1 : -1;
        }
      });
      
      const maxPage = Math.ceil(websites.length / ITEMS_PER_PAGE);
      if (currentPage < maxPage) {
        currentPage++;
        loadWebsiteData();
      }
    });
  });
}

// Sort websites based on current sort settings
function sortWebsites(websites) {
  if (!websites || !Array.isArray(websites) || websites.length === 0) {
    return websites || [];
  }
  
  websites.sort((a, b) => {
    let result = 0;
    
    // Sort based on column
    if (currentSort.column === 'domain') {
      const domainA = String(a.domain || '').toLowerCase();
      const domainB = String(b.domain || '').toLowerCase();
      result = domainA.localeCompare(domainB);
    } 
    else if (currentSort.column === 'timeSpent') {
      // Calculate total time from dailyUsage for both websites
      let timeA = 0;
      let timeB = 0;
      
      if (a.dailyUsage) {
        timeA = Object.values(a.dailyUsage).reduce((sum, time) => sum + time, 0);
      }
      if (b.dailyUsage) {
        timeB = Object.values(b.dailyUsage).reduce((sum, time) => sum + time, 0);
      }
      
      result = timeA - timeB;
    }
    else if (currentSort.column === 'timeLimit') {
      // Special handling for timeLimit sorting
      // If both have limits, compare them normally
      if (a.timeLimit && b.timeLimit) {
        result = Number(a.timeLimit) - Number(b.timeLimit);
      }
      // If only a has a limit, a comes first
      else if (a.timeLimit && !b.timeLimit) {
        result = -1;
      }
      // If only b has a limit, b comes first
      else if (!a.timeLimit && b.timeLimit) {
        result = 1;
      }
      // If neither has a limit, they're equal
      else {
        result = 0;
      }
    }
    
    // Apply sort direction
    return currentSort.direction === 'asc' ? result : -result;
  });
  
  return websites;
}

// Format time in seconds to a human-readable format
function formatTime(seconds) {
  if (seconds < 60) {
    return `${seconds} seconds`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
}

// Set up event listeners
function setupEventListeners() {
  // Theme toggle
  document.getElementById('darkMode').addEventListener('change', (e) => {
    if (e.target.checked) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
    saveGeneralSettings();
  });
  
  // Notification settings
  document.getElementById('showNotifications').addEventListener('change', saveGeneralSettings);
  document.getElementById('notificationSound').addEventListener('change', saveGeneralSettings);
  
  // Extension behavior
  document.getElementById('startAtBoot').addEventListener('change', saveGeneralSettings);
  document.getElementById('trackIncognito').addEventListener('change', saveGeneralSettings);
  
  // Timer settings
  document.getElementById('pomodoroTime').addEventListener('change', savePomodoroSettings);
  document.getElementById('shortBreakTime').addEventListener('change', savePomodoroSettings);
  document.getElementById('longBreakTime').addEventListener('change', savePomodoroSettings);
  document.getElementById('longBreakInterval').addEventListener('change', savePomodoroSettings);
  document.getElementById('autoStartBreaks').addEventListener('change', savePomodoroSettings);
  document.getElementById('autoStartPomodoros').addEventListener('change', savePomodoroSettings);
  
  // Reset timer defaults
  document.getElementById('resetDefaultsBtn').addEventListener('click', resetPomodoroDefaults);
  
  // Website management
  document.getElementById('addWebsiteBtn').addEventListener('click', showAddWebsiteModal);
  document.getElementById('clearAllDataBtn').addEventListener('click', confirmClearAllData);
  
  // Data management
  document.getElementById('exportDataBtn').addEventListener('click', exportData);
  document.getElementById('importDataBtn').addEventListener('click', importData);
  document.getElementById('resetAllDataBtn').addEventListener('click', confirmResetAllData);
  
  // Search functionality
  document.getElementById('websiteSearch').addEventListener('input', filterWebsites);
  
  // Setup modals
  setupModals();
  
  // Setup sorting
  setupSortableColumns();
}

// Setup sortable columns
function setupSortableColumns() {
  document.querySelectorAll('th.sortable').forEach(header => {
    header.onclick = function() {
      const column = this.getAttribute('data-sort');
      
      // If clicking the same column, toggle direction
      if (currentSort.column === column) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        currentSort.column = column;
        currentSort.direction = (column === 'domain') ? 'asc' : 'desc';
      }
      
      // Save sort state to storage
      chrome.storage.local.set({
        sortColumn: currentSort.column,
        sortDirection: currentSort.direction
      }, () => {
        updateSortUI();
        loadWebsiteData();  // Reload data with new sort
      });
    };
  });
}

// Update sort UI indicators
function updateSortUI() {
  // Reset all headers
  document.querySelectorAll('th.sortable').forEach(header => {
    header.classList.remove('active', 'asc', 'desc');
    const icon = header.querySelector('.sort-icon');
    icon.textContent = '';
  });
  
  // Set active header
  const activeHeader = document.querySelector(`th[data-sort="${currentSort.column}"]`);
  if (activeHeader) {
    activeHeader.classList.add('active', currentSort.direction);
    const icon = activeHeader.querySelector('.sort-icon');
    icon.textContent = currentSort.direction === 'asc' ? '▲' : '▼';
  }
}

// Save general settings
function saveGeneralSettings() {
  const settings = {
    darkMode: document.getElementById('darkMode').checked,
    showNotifications: document.getElementById('showNotifications').checked,
    notificationSound: document.getElementById('notificationSound').checked,
    startAtBoot: document.getElementById('startAtBoot').checked,
    trackIncognito: document.getElementById('trackIncognito').checked
  };
  
  chrome.storage.local.set({ settings: settings });
}

// Save pomodoro settings
function savePomodoroSettings() {
  const settings = {
    pomodoro: parseInt(document.getElementById('pomodoroTime').value, 10),
    shortBreak: parseInt(document.getElementById('shortBreakTime').value, 10),
    longBreak: parseInt(document.getElementById('longBreakTime').value, 10),
    longBreakInterval: parseInt(document.getElementById('longBreakInterval').value, 10),
    autoStartBreaks: document.getElementById('autoStartBreaks').checked,
    autoStartPomodoros: document.getElementById('autoStartPomodoros').checked
  };
  
  chrome.storage.local.set({ pomodoroSettings: settings });
}

// Reset pomodoro settings to defaults
function resetPomodoroDefaults() {
  const defaultSettings = {
    pomodoro: 25,
    shortBreak: 5,
    longBreak: 15,
    longBreakInterval: 4,
    autoStartBreaks: false,
    autoStartPomodoros: true
  };
  
  chrome.storage.local.set({ pomodoroSettings: defaultSettings }, () => {
    // Update UI
    document.getElementById('pomodoroTime').value = defaultSettings.pomodoro;
    document.getElementById('shortBreakTime').value = defaultSettings.shortBreak;
    document.getElementById('longBreakTime').value = defaultSettings.longBreak;
    document.getElementById('longBreakInterval').value = defaultSettings.longBreakInterval;
    document.getElementById('autoStartBreaks').checked = defaultSettings.autoStartBreaks;
    document.getElementById('autoStartPomodoros').checked = defaultSettings.autoStartPomodoros;
  });
}

// Setup modals
function setupModals() {
  // Get modals
  const addWebsiteModal = document.getElementById('addWebsiteModal');
  const editWebsiteModal = document.getElementById('editWebsiteModal');
  
  // Get close buttons
  const closeButtons = document.querySelectorAll('.close');
  
  // Close modals when clicking the X
  closeButtons.forEach(button => {
    button.addEventListener('click', () => {
      addWebsiteModal.style.display = 'none';
      editWebsiteModal.style.display = 'none';
    });
  });
  
  // Close modals when clicking outside
  window.addEventListener('click', (e) => {
    if (e.target === addWebsiteModal) {
      addWebsiteModal.style.display = 'none';
    }
    if (e.target === editWebsiteModal) {
      editWebsiteModal.style.display = 'none';
    }
  });
  
  // Setup add website form
  document.getElementById('saveNewWebsiteBtn').addEventListener('click', saveNewWebsite);
  document.getElementById('cancelNewWebsiteBtn').addEventListener('click', () => {
    addWebsiteModal.style.display = 'none';
  });
  
  // Setup edit website form
  document.getElementById('saveEditWebsiteBtn').addEventListener('click', saveEditWebsite);
  document.getElementById('cancelEditWebsiteBtn').addEventListener('click', () => {
    editWebsiteModal.style.display = 'none';
  });
}

// Show add website modal
function showAddWebsiteModal() {
  document.getElementById('newWebsiteDomain').value = '';
  document.getElementById('newWebsiteLimit').value = '60';
  document.getElementById('addWebsiteModal').style.display = 'block';
}

// Save new website
function saveNewWebsite() {
  const domain = document.getElementById('newWebsiteDomain').value.trim();
  const timeLimit = parseInt(document.getElementById('newWebsiteLimit').value, 10);
  
  if (!domain) {
    alert('Please enter a domain name.');
    return;
  }
  
  chrome.storage.local.get('websites', (result) => {
    let websites = result.websites || [];
    
    // Check if website already exists
    const exists = websites.some(site => site.domain === domain);
    
    if (exists) {
      alert('This website is already in the list. Please edit the existing entry.');
      return;
    }
    
    // Add new website
    websites.push({
      domain: domain,
      timeSpent: 0,
      timeLimit: timeLimit,
      lastVisit: null,
      added: Date.now()
    });
    
    chrome.storage.local.set({ websites: websites }, () => {
      document.getElementById('addWebsiteModal').style.display = 'none';
    });
  });
}

// Show edit website modal
function showEditWebsiteModal(domain, timeLimit) {
  document.getElementById('editWebsiteDomain').value = domain;
  document.getElementById('editWebsiteLimit').value = timeLimit || '';
  document.getElementById('editWebsiteModal').style.display = 'block';
}

// Save edited website
function saveEditWebsite() {
  const domain = document.getElementById('editWebsiteDomain').value;
  const timeLimit = parseInt(document.getElementById('editWebsiteLimit').value, 10) || null;
  
  chrome.storage.local.get('websites', (result) => {
    let websites = result.websites || [];
    
    // Find website
    const index = websites.findIndex(site => site.domain === domain);
    
    if (index >= 0) {
      // Update website
      websites[index].timeLimit = timeLimit;
      
      chrome.storage.local.set({ websites: websites }, () => {
        document.getElementById('editWebsiteModal').style.display = 'none';
      });
    }
  });
}

// Delete website
function deleteWebsite(domain) {
  if (confirm(`Are you sure you want to delete ${domain} from tracking?`)) {
    chrome.storage.local.get('websites', (result) => {
      let websites = result.websites || [];
      
      // Remove website
      websites = websites.filter(site => site.domain !== domain);
      
      chrome.storage.local.set({ websites: websites }, () => {
      });
    });
  }
}

// Filter websites based on search input
function filterWebsites() {
  const searchTerm = document.getElementById('websiteSearch').value.toLowerCase();
  chrome.storage.local.set({ searchTerm }, () => {
    currentPage = 1;
    loadWebsiteData();
  });
}

// Confirm clear all website data
function confirmClearAllData() {
  if (confirm('Are you sure you want to clear all website data? This will reset all time tracking information.')) {
    chrome.storage.local.set({ websites: [] }, () => {
    });
  }
}

// Export data
function exportData() {
  chrome.storage.local.get(null, (data) => {
    // Convert data to JSON string
    const jsonData = JSON.stringify(data, null, 2);
    
    // Create download link
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    // Create temporary link and click it
    const a = document.createElement('a');
    a.href = url;
    a.download = `procrastination_stopper_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    
    // Clean up
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  });
}

// Import data
function importData() {
  const fileInput = document.getElementById('importFile');
  
  if (!fileInput.files.length) {
    alert('Please select a file to import.');
    return;
  }
  
  const file = fileInput.files[0];
  const reader = new FileReader();
  
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      
      if (confirm('This will overwrite all your current data. Are you sure you want to continue?')) {
        chrome.storage.local.clear(() => {
          chrome.storage.local.set(data, () => {
            alert('Data imported successfully!');
            location.reload();
          });
        });
      }
    } catch (error) {
      alert('Invalid JSON file. Please select a valid backup file.');
    }
  };
  
  reader.readAsText(file);
}

// Confirm reset all data
function confirmResetAllData() {
  if (confirm('This will reset all data and settings to default values. This action cannot be undone. Are you sure you want to continue?')) {
    chrome.storage.local.clear(() => {
      // Set default settings
      const defaultSettings = {
        settings: {
          darkMode: false,
          showNotifications: true,
          notificationSound: false,
          startAtBoot: true,
          trackIncognito: false
        },
        pomodoroSettings: {
          pomodoro: 25,
          shortBreak: 5,
          longBreak: 15,
          longBreakInterval: 4,
          autoStartBreaks: false,
          autoStartPomodoros: true
        },
        websites: []
      };
      
      chrome.storage.local.set(defaultSettings, () => {
        alert('All data has been reset to default values.');
        location.reload();
      });
    });
  }
}

// Set up tab navigation
function setupTabs() {
  const generalBtn = document.getElementById('generalBtn');
  const websitesBtn = document.getElementById('websitesBtn');
  const dataBtn = document.getElementById('dataBtn');
  
  const generalSettings = document.getElementById('generalSettings');
  const websiteManagement = document.getElementById('websiteManagement');
  const dataBackup = document.getElementById('dataBackup');
  
  generalBtn.addEventListener('click', () => {
    generalBtn.classList.add('active');
    websitesBtn.classList.remove('active');
    dataBtn.classList.remove('active');
    
    generalSettings.classList.add('active');
    websiteManagement.classList.remove('active');
    dataBackup.classList.remove('active');
  });
  
  websitesBtn.addEventListener('click', () => {
    generalBtn.classList.remove('active');
    websitesBtn.classList.add('active');
    dataBtn.classList.remove('active');
    
    generalSettings.classList.remove('active');
    websiteManagement.classList.add('active');
    dataBackup.classList.remove('active');
    
    // Initialize website management tab
    currentPage = 1;
    setupPagination();
    loadWebsiteData();
  });
  
  dataBtn.addEventListener('click', () => {
    generalBtn.classList.remove('active');
    websitesBtn.classList.remove('active');
    dataBtn.classList.add('active');
    
    generalSettings.classList.remove('active');
    websiteManagement.classList.remove('active');
    dataBackup.classList.add('active');
  });
} 