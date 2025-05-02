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
    
    for (const workspace of slackClients) {
      try {
        await workspace.client.users.profile.set({
          profile: JSON.stringify(profile),
        });
        
        // Set user presence to away or auto
        await workspace.client.users.setPresence({
          presence: setAway ? 'away' : 'auto'
        });
        
        console.log(`[${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}] Slack status updated for workspace "${workspace.name}" to: ${statusText} ${emoji}${expirationMinutes > 0 ? ` (expires in ${expirationMinutes} minutes)` : ''} (Presence: ${setAway ? 'away' : 'auto'})`);
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
 * @returns {boolean} - True if it's a holiday
 */
function isHoliday(date) {
  return config.holidays.includes(format(date, 'yyyy-MM-dd'));
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
 * Check if the current time is in an out of office period
 * @returns {boolean} - True if it's during an out of office period
 */
function isOutOfOffice() {
  const now = new Date();
  const currentDay = format(now, 'EEEE'); // Gets the full day name (Monday, Tuesday, etc.)
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTime = currentHour * 60 + currentMinute;
  
  // Check if current day is in any of the out of office day configurations
  for (const oooConfig of config.outOfOffice) {
    // Check day-specific out of office
    if (oooConfig.days && oooConfig.days.includes(currentDay)) {
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
  
  if (isWeekend(now) || isHoliday(now) || isVacation(now) || isOutOfOffice()) {
    await updateSlackStatus('Away', getDailyEmoji('away'), 0, true);
    return;
  }
  
  if (isDuringWorkHours()) {
    if (isDuringLunch()) {
      await updateSlackStatus('Lunch Break', getDailyEmoji('lunch'), 60, false);
    } else {
      await updateSlackStatus('Active', getDailyEmoji('active'), 0, false);
    }
  } else {
    await updateSlackStatus('Away', getDailyEmoji('away'), 0, true);
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
    await updateSlackStatus('Active', getDailyEmoji('active'), 0, false);
  } else {
    await updateSlackStatus('Away', getDailyEmoji('away'), 0, true);
  }
});

// Schedule end of workday status update (work days)
schedule(`0 17 * * ${workDaysCron}`, async () => {
  const now = new Date();
  if (!isHoliday(now) && !isVacation(now) && !isOutOfOffice()) {
    await updateSlackStatus('Away', getDailyEmoji('away'), 0, true);
  }
});

// Schedule lunch break status update (work days)
schedule(`0 12 * * ${workDaysCron}`, async () => {
  const now = new Date();
  if (!isHoliday(now) && !isVacation(now) && !isWeekend(now) && !isOutOfOffice()) {
    await updateSlackStatus('Lunch Break', getDailyEmoji('lunch'), 60, false);
  }
});

// Schedule return from lunch status update (work days)
schedule(`0 13 * * ${workDaysCron}`, async () => {
  const now = new Date();
  if (!isHoliday(now) && !isVacation(now) && !isWeekend(now) && !isOutOfOffice()) {
    await updateSlackStatus('Active', getDailyEmoji('active'), 0, false);
  }
});

// Schedule short breaks
config.shortBreaks.forEach((breakInfo) => {
  const [hour, minute] = breakInfo.time.split(':');
  schedule(`${minute} ${hour} * * ${workDaysCron}`, async () => {
    const now = new Date();
    if (!isHoliday(now) && !isVacation(now) && !isWeekend(now) && !isOutOfOffice()) {
      await updateSlackStatus('Short Break', getDailyEmoji('shortBreak'), breakInfo.duration, false);
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
      await updateSlackStatus('Active', getDailyEmoji('active'), 0, false);
    }
  });
});

// Set status for non-work days at midnight
const nonWorkDaysCron = getNonWorkDaysCronExpression();
schedule(`0 0 * * ${nonWorkDaysCron}`, async () => {
  await updateSlackStatus('Away', getDailyEmoji('away'), 0, true);
});

// Daily midnight check to reset status based on the new day
schedule('0 0 * * *', async () => {
  const now = new Date();
  
  if (isWeekend(now) || isHoliday(now) || isVacation(now) || isOutOfOffice()) {
    await updateSlackStatus('Away', getDailyEmoji('away'), 0, true);
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