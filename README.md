# Procrastination Stopper Chrome Extension

A Chrome extension that helps you manage your browsing habits by tracking time spent on websites, setting custom time limits, and providing a built-in Pomodoro timer for improved productivity.

## Features

- 📊 **Website Time Tracking**: Automatically monitors how long you spend on each website
- ⏱️ **Custom Time Limits**: Set daily time limits for distracting websites
- 🚫 **Distraction Blocking**: Automatically blocks websites once you reach your daily time limit
- 🍅 **Pomodoro Timer**: Built-in productivity timer with customizable work/break durations
- 🔄 **Smart Reset**: Daily time limits automatically reset at midnight
- 🔎 **Sortable Data**: View and sort your browsing statistics by time spent or time limits
- 💻 **Window Awareness**: Only tracks time when the browser window is active and in focus
- 📱 **Clean UI**: Modern, intuitive user interface with green and white theme
- 🌙 **Dark Mode**: Toggle between light and dark themes
- 💾 **Local Storage**: All data is stored locally on your device for privacy

## Installation

### Developer Mode Installation

1. Download or clone this repository to your local machine
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" using the toggle in the top-right corner
4. Click "Load unpacked" and select the `src` folder from this repository
5. The extension should now appear in your Chrome toolbar

## Usage

### Website Tracking & Limits

- The extension automatically tracks time spent on all websites you visit
- Time is only tracked when the browser window is active and in focus
- View your browsing statistics by clicking the extension icon
- Time data is displayed by today, current week, and 4-week average

### Setting Website Limits

1. Click the extension icon to open the popup
2. Go to the "Limited Pages" tab
3. Click "Add Limited Page"
4. Enter a website domain (e.g., `facebook.com`) and daily time limit
5. Once you reach your time limit, the site will be blocked

### Pomodoro Timer

1. Click the extension icon and navigate to the "Pomodoro Timer" tab
2. Customize your pomodoro settings:
   - Pomodoro duration (default: 25 minutes)
   - Short break duration (default: 5 minutes)
   - Long break duration (default: 15 minutes)
   - Long break interval (default: every 4 pomodoros)
3. Use the Start, Pause, and Reset buttons to control your timer
4. Toggle auto-start options for automatic transitions between work and break sessions
5. Receive alerts when each session completes

### Managing Your Data

Access the Options page by clicking the Settings icon in the extension popup:

- **General Settings**: Configure dark mode, notifications, and extension behavior
- **Website Management**: View all tracked websites, sort by time spent or limits, edit or remove sites
- **Data & Backup**: Export or import your data, or reset to defaults

## Privacy & Security

- All data is stored locally using Chrome's storage API
- No data is transmitted to external servers
- Extension only requires necessary permissions:
  - `storage`: To save your preferences and website data
  - `tabs`: To track active tabs and apply time limits
  - `alarms`: For midnight reset and timer functionality
  - `scripting`: To display alerts when timers complete

## Development

### Project Structure

```
src/
├── css/               # Stylesheets
├── html/              # HTML files for popup, options, and blocking page
├── images/            # Icons and images
├── js/                # JavaScript files
│   ├── background.js  # Service worker for tracking and background tasks
│   ├── content.js     # Content script for interacting with web pages
│   ├── options.js     # Options page functionality
│   └── popup.js       # Popup interface functionality
└── manifest.json      # Extension manifest
```

### Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the [Creative Commons Attribution-NonCommercial 4.0 International License (CC BY-NC 4.0)](https://creativecommons.org/licenses/by-nc/4.0/).

This means you are free to:
- Share — copy and redistribute the material in any medium or format
- Adapt — remix, transform, and build upon the material

Under the following terms:
- Attribution — You must give appropriate credit, provide a link to the license, and indicate if changes were made
- NonCommercial — You may not use the material for commercial purposes

See the [LICENSE](LICENSE) file for details.

## Credits

Created by 0xLukasinho
