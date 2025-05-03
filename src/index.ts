import { WebClient } from '@slack/web-api';
import { schedule } from 'node-cron';
import { format, isWeekend, isToday, parseISO, addMinutes } from 'date-fns';
import dotenv from 'dotenv';
import config from '../config.js';

// Load environment variables
dotenv.config();

// Setup Slack clients for each workspace
const slackClients = config.workspaces.map(workspace => {
  const token = process.env[workspace.tokenEnvKey];
  if (!token) {
    console.warn(`Warning: No token found for workspace "${workspace.name}" (${workspace.tokenEnvKey})`);
    return null;
  }
  return {
    name: workspace.name,
    client: new WebClient(token)
  };
}).filter(client => client !== null);

if (slackClients.length === 0) {
  console.error('Error: No valid Slack tokens found. Please check your environment variables.');
  process.exit(1);
} else {
  console.log(`Initialized ${slackClients.length} Slack workspace connections`);
}

// Emojis from config file
const emojis = config.emojis;

/**
 * Get the appropriate status message based on the status type
 * @param {string} statusType - The type of status (active, away, lunch, etc.)
 * @param {string} defaultMessage - Default message if no custom message is found
 * @returns {string} The status message to display
 */
function getStatusMessage(statusType, defaultMessage) {
  return config.statusMessages && config.statusMessages[statusType] 
    ? config.statusMessages[statusType] 
    : defaultMessage;
}

/**
 * Get a random emoji from a category that changes daily but remains consistent throughout the day
 * @param {string} category - The emoji category to choose from
 * @returns {string} A random emoji from the specified category
 */
function getDailyEmoji(category) {
  // Select a random emoji from the category
  const index = Math.floor(Math.random() * emojis[category].length);
  return emojis[category][index];
}

/**
 * Update the Slack status
 * @param {string} statusText - The status text to set
 * @param {string} emoji - The emoji to use
 * @param {number} expirationMinutes - Minutes until the status expires (0 for no expiration)
 * @param {boolean} setAway - Whether to set user presence to away (true) or auto (false)
 */
async function updateSlackStatus(statusText, emoji, expirationMinutes = 0, setAway = false) {
  try {
    const profile = {
      status_text: statusText,
      status_emoji: emoji,
      status_expiration: 0
    };
    
    if (expirationMinutes > 0) {
      const expirationTime = Math.floor(Date.now() / 1000) + (expirationMinutes * 60);
      profile.status_expiration = expirationTime;
    }
    
    // Check if we're in debug mode
    const debugMode = process.env.DEBUG?.toLowerCase() === 'true';
    
    for (const workspace of slackClients) {
      try {
        // Only send actual updates to Slack if not in debug mode
        if (!debugMode) {
          await workspace.client.users.profile.set({
            profile: JSON.stringify(profile),
          });
          
          // Set user presence to away or auto
          await workspace.client.users.setPresence({
            presence: setAway ? 'away' : 'auto'
          });
        }
        
        // Always log the action
        console.log(
          `[${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}] ${debugMode ? '[DEBUG - NOT SENT] ' : ''}Slack status updated for workspace "${workspace.name}" to: ${statusText} ${emoji}${expirationMinutes > 0 ? ` (expires in ${expirationMinutes} minutes)` : ''} (Presence: ${setAway ? 'away' : 'auto'})`
        );
      } catch (workspaceError) {
        console.error(`Error updating status for workspace "${workspace.name}":`, workspaceError);
      }
    }
  } catch (error) {
    console.error('Error updating Slack status:', error);
  }
}

/**
 * Check if the current date is a holiday
 * @param {Date} date - The date to check
 * @returns {Object|null} - Holiday object if it's a holiday, null otherwise
 */
function getHoliday(date) {
  const currentDate = format(date, 'yyyy-MM-dd');
  const holiday = config.holidays.find(h => h.day === currentDate);
  return holiday || null;
}

/**
 * Check if the current date is a holiday
 * @param {Date} date - The date to check
 * @returns {boolean} - True if it's a holiday
 */
function isHoliday(date) {
  return getHoliday(date) !== null;
}

/**
 * Check if the current date is during a vacation period
 * @param {Date} date - The date to check
 * @returns {boolean} - True if it's during a vacation
 */
function isVacation(date) {
  const currentDate = format(date, 'yyyy-MM-dd');
  return config.vacationPeriods.some(period => 
    currentDate >= period.start && currentDate <= period.end
  );
}

/**
 * Check if the current time is within work hours
 * @returns {boolean} - True if it's during work hours
 */
function isDuringWorkHours() {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTime = currentHour * 60 + currentMinute;
  
  const [startHour, startMinute] = config.workHours.start.split(':').map(Number);
  const [endHour, endMinute] = config.workHours.end.split(':').map(Number);
  
  const startTime = startHour * 60 + startMinute;
  const endTime = endHour * 60 + endMinute;
  
  return currentTime >= startTime && currentTime < endTime;
}

/**
 * Check if the current time is during lunch break
 * @returns {boolean} - True if it's during lunch break
 */
function isDuringLunch() {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTime = currentHour * 60 + currentMinute;
  
  const [startHour, startMinute] = config.lunchBreak.start.split(':').map(Number);
  const [endHour, endMinute] = config.lunchBreak.end.split(':').map(Number);
  
  const startTime = startHour * 60 + startMinute;
  const endTime = endHour * 60 + endMinute;
  
  return currentTime >= startTime && currentTime < endTime;
}

/**
 * Check if a specific time is in an out of office period
 * @param {Object} options - Configuration options
 * @param {Date} [options.date] - The date to check (defaults to current date)
 * @param {string} [options.time] - The specific time to check in HH:MM format (overrides time from date if provided)
 * @param {string} [options.day] - The specific day to check (defaults to day from provided date)
 * @returns {boolean} - True if it's during an out of office period
 */
function isOutOfOffice(options: { date?: Date; time?: string; day?: string } = {}) {
  const now = options.date || new Date();
  const day = options.day || format(now, 'EEEE'); // Gets the full day name (Monday, Tuesday, etc.)
  
  // Calculate time in minutes
  let currentTime;
  if (options.time) {
    // If specific time provided, use it
    const [hour, minute] = options.time.split(':').map(Number);
    currentTime = hour * 60 + minute;
  } else {
    // Otherwise use time from date object
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    currentTime = currentHour * 60 + currentMinute;
  }
  
  // Check if current day and time is in any of the out of office day configurations
  for (const oooConfig of config.outOfOffice) {
    // Check day-specific out of office
    if (oooConfig.day && oooConfig.day === day) {
      return true;
    }
    
    // Check time-specific out of office
    if (oooConfig.time && oooConfig.duration) {
      const [hour, minute] = oooConfig.time.split(':').map(Number);
      const startTime = hour * 60 + minute;
      const endTime = startTime + oooConfig.duration;
      
      if (currentTime >= startTime && currentTime < endTime) {
        return true;
      }
    }
    
    // Check hour range out of office
    if (oooConfig.hour && oooConfig.hour.start && oooConfig.hour.end) {
      const [startHour, startMinute] = oooConfig.hour.start.split(':').map(Number);
      const [endHour, endMinute] = oooConfig.hour.end.split(':').map(Number);
      
      const startTime = startHour * 60 + startMinute;
      const endTime = endHour * 60 + endMinute;
      
      if (currentTime >= startTime && currentTime < endTime) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Convert workDays array to cron expression format
 * @returns {string} - Cron expression for work days (e.g., "1,2,3,4,5" for Monday-Friday)
 */
function getWorkDaysCronExpression() {
  const dayMap = {
    'Sunday': 0,
    'Monday': 1,
    'Tuesday': 2,
    'Wednesday': 3,
    'Thursday': 4,
    'Friday': 5,
    'Saturday': 6
  };
  
  const cronDays = config.workDays
    .map(day => dayMap[day])
    .sort((a, b) => a - b)
    .join(',');
    
  return cronDays;
}

/**
 * Get non-work days in cron expression format
 * @returns {string} - Cron expression for non-work days
 */
function getNonWorkDaysCronExpression() {
  const dayMap = {
    'Sunday': 0,
    'Monday': 1,
    'Tuesday': 2,
    'Wednesday': 3,
    'Thursday': 4,
    'Friday': 5,
    'Saturday': 6
  };
  
  const allDays = [0, 1, 2, 3, 4, 5, 6];
  const workDayNumbers = config.workDays.map(day => dayMap[day]);
  const nonWorkDays = allDays.filter(day => !workDayNumbers.includes(day));
  
  return nonWorkDays.sort().join(',');
}

/**
 * Initial status check and setup when the script starts
 */
async function initialStatusCheck() {
  const now = new Date();
  const currentDay = format(now, "EEEE"); // Gets the full day name (Monday, Tuesday, etc.)

  // Check for out of office periods
  if (isOutOfOffice()) {
    // Find the applicable OOO configuration to get the message
    const oooConfig = config.outOfOffice.find(
      (ooo) => ooo.day && ooo.day === currentDay
    );
    const message =
      oooConfig && oooConfig.message
        ? oooConfig.message
        : getStatusMessage("away", "Away");
    await updateSlackStatus(message, getDailyEmoji("away"), 0, true);
    return;
  }

  // Check for holiday
  const holiday = getHoliday(now);
  if (holiday) {
    await updateSlackStatus(
      getStatusMessage("holiday", holiday.message || "On Holiday"),
      getDailyEmoji("away"),
      0,
      true
    );
    return;
  }

  // Check for vacation
  if (isVacation(now)) {
    await updateSlackStatus(
      getStatusMessage("vacation", "On Vacation"),
      getDailyEmoji("away"),
      0,
      true
    );
    return;
  }

  // Check for weekend
  if (isWeekend(now)) {
    await updateSlackStatus(
      getStatusMessage("weekend", "Weekend Mode"),
      getDailyEmoji("away"),
      0,
      true
    );
    return;
  }

  // Regular work day checks
  if (isDuringWorkHours()) {
    if (isDuringLunch()) {
      await updateSlackStatus(
        getStatusMessage("lunch", "Lunch Break"),
        getDailyEmoji("lunch"),
        60,
        false
      );
    } else {
      await updateSlackStatus(
        getStatusMessage("active", "Active"),
        getDailyEmoji("active"),
        0,
        false
      );
    }
  } else {
    await updateSlackStatus(
      getStatusMessage("away", "Away"),
      getDailyEmoji("away"),
      0,
      true
    );
  }
}

// Run initial status check when the script starts
initialStatusCheck();

// Get the work days in cron format
const workDaysCron = getWorkDaysCronExpression();

// Schedule start of workday status update (work days)
schedule(`0 9 * * ${workDaysCron}`, async () => {
  const now = new Date();
  if (!isHoliday(now) && !isVacation(now) && !isOutOfOffice()) {
    await updateSlackStatus(getStatusMessage('active', 'Active'), getDailyEmoji('active'), 0, false);
  } else {
    await updateSlackStatus(getStatusMessage('away', 'Away'), getDailyEmoji('away'), 0, true);
  }
});

// Schedule end of workday status update (work days)
schedule(`0 17 * * ${workDaysCron}`, async () => {
  const now = new Date();
  if (!isHoliday(now) && !isVacation(now) && !isOutOfOffice()) {
    await updateSlackStatus(getStatusMessage('away', 'Away'), getDailyEmoji('away'), 0, true);
  }
});

// Schedule lunch break status update (work days)
schedule(`0 12 * * ${workDaysCron}`, async () => {
  const now = new Date();
  if (!isHoliday(now) && !isVacation(now) && !isWeekend(now) && !isOutOfOffice()) {
    await updateSlackStatus(getStatusMessage('lunch', 'Lunch Break'), getDailyEmoji('lunch'), 60, false);
  }
});

// Schedule return from lunch status update (work days)
schedule(`0 13 * * ${workDaysCron}`, async () => {
  const now = new Date();
  if (!isHoliday(now) && !isVacation(now) && !isWeekend(now) && !isOutOfOffice()) {
    await updateSlackStatus(getStatusMessage('active', 'Active'), getDailyEmoji('active'), 0, false);
  }
});

// Schedule short breaks
config.shortBreaks.forEach((breakInfo) => {
  const [hour, minute] = breakInfo.time.split(':');
  schedule(`${minute} ${hour} * * ${workDaysCron}`, async () => {
    const now = new Date();
    if (!isHoliday(now) && !isVacation(now) && !isWeekend(now) && !isOutOfOffice()) {
      await updateSlackStatus(getStatusMessage('shortBreak', 'Short Break'), getDailyEmoji('shortBreak'), breakInfo.duration, false);
    }
  });
  
  // Schedule return from short break
  const returnTime = new Date(`2000-01-01T${hour}:${minute}`);
  const returnFromBreak = addMinutes(returnTime, breakInfo.duration);
  const returnHour = returnFromBreak.getHours();
  const returnMinute = returnFromBreak.getMinutes();
  
  schedule(`${returnMinute} ${returnHour} * * ${workDaysCron}`, async () => {
    const now = new Date();
    if (!isHoliday(now) && !isVacation(now) && !isWeekend(now) && !isOutOfOffice()) {
      await updateSlackStatus(getStatusMessage('active', 'Active'), getDailyEmoji('active'), 0, false);
    }
  });
});

// Set status for non-work days at midnight
const nonWorkDaysCron = getNonWorkDaysCronExpression();
schedule(`0 0 * * ${nonWorkDaysCron}`, async () => {
  await updateSlackStatus(getStatusMessage('weekend', 'Weekend Mode'), getDailyEmoji('away'), 0, true);
});

// Daily midnight check to reset status based on the new day
schedule('0 0 * * *', async () => {
  const now = new Date();
  
  if (isWeekend(now)) {
    await updateSlackStatus(getStatusMessage('weekend', 'Weekend Mode'), getDailyEmoji('away'), 0, true);
  } else if (isHoliday(now)) {
    const holiday = getHoliday(now);
    await updateSlackStatus(getStatusMessage('holiday', holiday.message || 'On Holiday'), getDailyEmoji('away'), 0, true);
  } else if (isVacation(now)) {
    await updateSlackStatus(getStatusMessage('vacation', 'On Vacation'), getDailyEmoji('away'), 0, true);
  } else if (isOutOfOffice()) {
    const currentDay = format(now, 'EEEE');
    const oooConfig = config.outOfOffice.find(ooo => 
      ooo.day && ooo.day === currentDay
    );
    const message = oooConfig && oooConfig.message ? oooConfig.message : getStatusMessage('away', 'Away');
    await updateSlackStatus(message, getDailyEmoji('away'), 0, true);
  }
});

console.log(`[${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}] Slack Status Updater started successfully`);
console.log('Work hours:', config.workHours);
console.log('Lunch break:', config.lunchBreak);
console.log('Short breaks:', config.shortBreaks);
console.log('Holidays configured:', config.holidays.length);
console.log('Vacation periods configured:', config.vacationPeriods.length);

// Keep the Bun.js process running
setInterval(() => {}, 60000);