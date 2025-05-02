import { WebClient } from '@slack/web-api';
import { schedule } from 'node-cron';
import { format, isWeekend, isToday, parseISO, addMinutes } from 'date-fns';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const slackToken = process.env.SLACK_TOKEN;
const slackClient = new WebClient(slackToken);

// Configuration
const config = {
  workHours: { start: '08:00', end: '16:00' },
  lunchBreak: { start: '12:00', end: '13:00' },
  shortBreaks: [
    { time: '10:30', duration: 15 },
    { time: '15:00', duration: 15 }
  ],
  holidays: [
    '2025-01-01', // New Year's Day
    '2025-09-01', // Labor Day
    '2025-12-25', // Christmas
  ],
  // Add your vacation periods here
  vacationPeriods: [
    { start: '2025-12-24', end: '2025-12-31' }, // Example vacation
  ]
};

// Emojis for different statuses with daily rotation options
const emojis = {
  active: [':computer:', ':desktop_computer:', ':technologist:', ':nerd_face:'],
  away: [':x:', ':door:'],
  lunch: [':sandwich:', ':pizza:', ':hamburger:', ':ramen:', ':bento:', ':curry:', ':sushi:'],
  shortBreak: [':coffee:', ':tea:', ':walking:', ':brain:']
};

/**
 * Get a random emoji from a category that changes daily but remains consistent throughout the day
 * @param {string} category - The emoji category to choose from
 * @returns {string} A random emoji from the specified category
 */
function getDailyEmoji(category) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const seed = today.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const index = seed % emojis[category].length;
  return emojis[category][index];
}

/**
 * Update the Slack status
 * @param {string} statusText - The status text to set
 * @param {string} emoji - The emoji to use
 * @param {number} expirationMinutes - Minutes until the status expires (0 for no expiration)
 */
async function updateSlackStatus(statusText, emoji, expirationMinutes = 0) {
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
    
    await slackClient.users.profile.set({
      profile: JSON.stringify(profile),
    });
    
    console.log(`[${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}] Slack status updated to: ${statusText} ${emoji}${expirationMinutes > 0 ? ` (expires in ${expirationMinutes} minutes)` : ''}`);
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
 * Initial status check and setup when the script starts
 */
async function initialStatusCheck() {
  const now = new Date();
  
  if (isWeekend(now) || isHoliday(now) || isVacation(now)) {
    await updateSlackStatus('Away', getDailyEmoji('away'));
    return;
  }
  
  if (isDuringWorkHours()) {
    if (isDuringLunch()) {
      await updateSlackStatus('Lunch Break', getDailyEmoji('lunch'), 60);
    } else {
      await updateSlackStatus('Active', getDailyEmoji('active'));
    }
  } else {
    await updateSlackStatus('Away', getDailyEmoji('away'));
  }
}

// Run initial status check when the script starts
initialStatusCheck();

// Schedule start of workday status update (weekdays)
schedule('0 9 * * 1-5', async () => {
  const now = new Date();
  if (!isHoliday(now) && !isVacation(now)) {
    await updateSlackStatus('Active', getDailyEmoji('active'));
  }
});

// Schedule end of workday status update (weekdays)
schedule('0 17 * * 1-5', async () => {
  const now = new Date();
  if (!isHoliday(now) && !isVacation(now)) {
    await updateSlackStatus('Away', getDailyEmoji('away'));
  }
});

// Schedule lunch break status update (weekdays)
schedule('0 12 * * 1-5', async () => {
  const now = new Date();
  if (!isHoliday(now) && !isVacation(now) && !isWeekend(now)) {
    await updateSlackStatus('Lunch Break', getDailyEmoji('lunch'), 60);
  }
});

// Schedule return from lunch status update (weekdays)
schedule('0 13 * * 1-5', async () => {
  const now = new Date();
  if (!isHoliday(now) && !isVacation(now) && !isWeekend(now)) {
    await updateSlackStatus('Active', getDailyEmoji('active'));
  }
});

// Schedule short breaks
config.shortBreaks.forEach((breakInfo) => {
  const [hour, minute] = breakInfo.time.split(':');
  schedule(`${minute} ${hour} * * 1-5`, async () => {
    const now = new Date();
    if (!isHoliday(now) && !isVacation(now) && !isWeekend(now)) {
      await updateSlackStatus('Short Break', getDailyEmoji('shortBreak'), breakInfo.duration);
    }
  });
  
  // Schedule return from short break
  const returnTime = new Date(`2000-01-01T${hour}:${minute}`);
  const returnFromBreak = addMinutes(returnTime, breakInfo.duration);
  const returnHour = returnFromBreak.getHours();
  const returnMinute = returnFromBreak.getMinutes();
  
  schedule(`${returnMinute} ${returnHour} * * 1-5`, async () => {
    const now = new Date();
    if (!isHoliday(now) && !isVacation(now) && !isWeekend(now)) {
      await updateSlackStatus('Active', getDailyEmoji('active'));
    }
  });
});

// Set weekend status at midnight on Saturday and Sunday
schedule('0 0 * * 0,6', async () => {
  await updateSlackStatus('Away', getDailyEmoji('away'));
});

// Daily midnight check to reset status based on the new day
schedule('0 0 * * *', async () => {
  const now = new Date();
  
  if (isWeekend(now) || isHoliday(now) || isVacation(now)) {
    await updateSlackStatus('Away', getDailyEmoji('away'));
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